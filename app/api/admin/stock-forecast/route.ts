import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  aggregateForecastByProduct,
  bangkokDateKey,
  buildStockForecast,
  isFreshMeat,
  describeCustomerOrderTime,
  FORECAST_DAYS,
  FORECAST_HISTORY_DAYS,
  procurementForecastAsOf,
  type ForecastCustomerInput,
  type ForecastItemInput,
  type ForecastOrderInput,
  type StockForecast,
} from "@/lib/stockForecast";
import { BACKTEST_DAYS, backtestStockForecast } from "@/lib/stockForecastBacktest";
import { extendForecastForExpiry, optimizeFreshMeatOrders, type SkuEconomics, type StockOrderRecommendation } from "@/lib/stockOrderOptimizer";
import { dailyWeekdayBaseline } from "@/lib/sharedStockInputs";
import { analyseDailyDemand, salesScopeIsUsable, type DemandPattern, type SalesScope } from "@/lib/sharedStockDiagnostics";
import { sharedPurchaseDraft, type SharedPurchaseDraft } from "@/lib/sharedStockPurchaseDraft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbOrder = {
  id: string;
  customer_id: string;
  created_at: string;
  delivery_date: string | null;
  group_root_order_id: string | null;
  group_sequence: number | null;
  status: string;
};
type DbItem = {
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_snapshot: string;
  requested_qty: number | string | null;
  confirmed_qty: number | string | null;
  actual_qty: number | string | null;
  actual_piece_qty: number | string | null;
  piece_price_per_kg_snapshot: number | string | null;
  updated_at: string | null;
};
type DbProduct = { id: string; sku: string | null; product_name: string | null; category: string | null; unit: string | null };
type DbCustomer = {
  id: string;
  customer_code: string | null;
  customer_name: string | null;
  is_test_customer: boolean | null;
  is_active: boolean | null;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server configuration is incomplete.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireManager(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new Error("UNAUTHORIZED");
  const admin = adminClient();
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) throw new Error("UNAUTHORIZED");
  const { data: staff, error: staffError } = await admin
    .from("staff")
    .select("account_type, is_active")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (staffError || staff?.account_type !== "manager" || staff.is_active !== true) throw new Error("FORBIDDEN");
  return admin;
}

function batch<T>(values: T[], size = 100) {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

function numeric(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ordersForDeliveryDates(admin: SupabaseClient, startDate: string, endDate: string) {
  const result: DbOrder[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin
      .from("orders")
      .select("id, customer_id, created_at, delivery_date, group_root_order_id, group_sequence, status")
      .gte("delivery_date", startDate)
      .lte("delivery_date", endDate)
      .order("delivery_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    result.push(...((data ?? []) as DbOrder[]));
    if (!data || data.length < 500) break;
  }
  return result;
}

async function itemsForOrders(admin: SupabaseClient, ids: string[]) {
  const result: DbItem[] = [];
  for (const chunk of batch(ids)) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await admin
        .from("order_items")
        .select("order_id, product_id, product_name_snapshot, unit_snapshot, requested_qty, confirmed_qty, actual_qty, actual_piece_qty, piece_price_per_kg_snapshot, updated_at")
        .in("order_id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + 499);
      if (error) throw error;
      result.push(...((data ?? []) as DbItem[]));
      if (!data || data.length < 500) break;
    }
  }
  return result;
}

async function productsById(admin: SupabaseClient, ids: string[]) {
  const result = new Map<string, DbProduct>();
  for (const chunk of batch(ids)) {
    const { data, error } = await admin.from("products").select("id, sku, product_name, category, unit").in("id", chunk);
    if (error) throw error;
    for (const row of (data ?? []) as DbProduct[]) result.set(row.id, row);
  }
  return result;
}

async function customersById(admin: SupabaseClient, ids: string[]) {
  const result: ForecastCustomerInput[] = [];
  for (const chunk of batch(ids)) {
    const { data, error } = await admin
      .from("customers")
      .select("id, customer_code, customer_name, is_test_customer, is_active")
      .in("id", chunk);
    if (error) throw error;
    for (const customer of (data ?? []) as DbCustomer[]) {
      // Keep historical requests from real customers, even after account deactivation.
      // The model excludes is_test_customer accounts from learning and display.
      result.push({
        id: customer.id,
        code: customer.customer_code ?? "",
        name: customer.customer_name ?? "ไม่ระบุชื่อลูกค้า",
        isTest: customer.is_test_customer === true,
      });
    }
  }
  return result;
}

async function masterEconomicsBySku(admin: SupabaseClient, skus: string[]) {
  const prices: Record<string, SkuEconomics> = {};
  const products: { id: string; sku: string; normal_price: number | string | null }[] = [];
  for (const chunk of batch([...new Set(skus)])) {
    const { data, error } = await admin.from("products")
      .select("id, sku, normal_price").in("sku", chunk);
    if (error) throw error;
    products.push(...(data ?? []));
  }
  const costs = new Map<string, number | null>();
  for (const chunk of batch(products.map((product) => product.id))) {
    const { data, error } = await admin.from("product_costs")
      .select("product_id, cost").in("product_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) costs.set(row.product_id, numeric(row.cost));
  }
  for (const product of products) {
    const price = numeric(product.normal_price);
    const cost = costs.get(product.id) ?? null;
    prices[product.sku] = {
      price: price !== null && price > 0 ? price : null,
      cost: cost !== null && cost >= 0 ? cost : null,
    };
  }
  return prices;
}

async function loadForecast(admin: SupabaseClient, extraHistoryDays = 0) {
  const now = new Date();
  const today = bangkokDateKey(now);
  // Staff need a final forecast at 10:00 Bangkok to enter orders by 12:00.
  // Later requests replay the cutoff, excluding orders submitted after 10:00.
  const procurementAsOf = procurementForecastAsOf(now);
  const dateMillis = Date.parse(`${today}T00:00:00Z`);
  const startDate = new Date(dateMillis - (FORECAST_HISTORY_DAYS + extraHistoryDays) * 86_400_000).toISOString().slice(0, 10);
  // The replenishment forecast is three visible dates, but tomorrow's new
  // meat batch needs tomorrow PLUS two more days to assess its expiry.
  const endDate = new Date(dateMillis + FORECAST_DAYS * 86_400_000).toISOString().slice(0, 10);
  const orders = await ordersForDeliveryDates(admin, startDate, endDate);
  // Cancelled requests are still demand, even when none of the goods were sold.
  const demandOrders = orders;
  const [items, customers] = await Promise.all([
    itemsForOrders(admin, demandOrders.map((order) => order.id)),
    customersById(admin, [...new Set(demandOrders.map((order) => order.customer_id))]),
  ]);
  const products = await productsById(admin, [...new Set(items.map((item) => item.product_id))]);
  const inputOrders: ForecastOrderInput[] = demandOrders.map((order) => ({
    id: order.id,
    customerId: order.customer_id,
    createdAt: order.created_at,
    deliveryDate: order.delivery_date,
    groupRootOrderId: order.group_root_order_id,
    groupSequence: order.group_sequence,
    status: order.status,
  }));
  const inputItems: ForecastItemInput[] = items.map((item) => {
    const product = products.get(item.product_id);
    const rawSku = (product?.sku ?? "").trim();
    return {
      orderId: item.order_id,
      sku: /^\d{1,9}$/.test(rawSku) ? rawSku.padStart(9, "0") : rawSku || item.product_id,
      productName: item.product_name_snapshot || product?.product_name || "ไม่ระบุสินค้า",
      unit: item.unit_snapshot ?? "",
      masterUnit: product?.unit ?? null,
      category: product?.category ?? null,
      requestedQty: numeric(item.requested_qty),
      confirmedQty: numeric(item.confirmed_qty),
      actualQty: numeric(item.actual_qty),
      actualPieceQty: numeric(item.actual_piece_qty),
      piecePricePerKg: numeric(item.piece_price_per_kg_snapshot),
      updatedAt: item.updated_at,
    };
  });
  return {
    forecast: buildStockForecast(inputOrders, inputItems, customers, now),
    noonForecast: buildStockForecast(inputOrders, inputItems, customers, procurementAsOf),
    livePlanningHorizon: buildStockForecast(inputOrders, inputItems, customers, now, FORECAST_DAYS + 1),
    noonPlanningHorizon: buildStockForecast(inputOrders, inputItems, customers, procurementAsOf, FORECAST_DAYS + 1),
    orders: inputOrders,
    items: inputItems,
    customers,
    now,
  };
}

type SnapshotRecord = {
  snapshot_date: string;
  cutoff_at: string;
  captured_at: string;
  forecast: StockForecast & { stockPlanningHorizon?: StockForecast; stockOrderPlan?: StockOrderRecommendation[]; sharedStockInputs?: SharedStockInputs; sharedPurchaseDrafts?: SharedPurchaseDraft[] };
  is_late: boolean;
};

type SharedStockInputs = {
  sourcePeriod: { start: string; end: string } | null;
  sourceFormat: "daily" | "total" | null;
  sourceScope: SalesScope;
  countDate: string;
  products: { sku: string; productName: string }[];
  bySku: Record<string, { b2cDailyKg: number | null; b2cByDateKg: Record<string, number | null>; onHandKg: number | null; countedAt: string | null;
    demandPattern: DemandPattern | null; observedDays: number; suspectedStockoutDays: number; coefficientOfVariation: number | null }>;
};

async function loadSharedStockInputs(admin: SupabaseClient, skuList: string[], today: string, targetDates: string[]): Promise<SharedStockInputs> {
  const [imports, dailyImports, catalogue] = await Promise.all([
    admin.from("b2c_sales_30d_imports").select("id, period_start, period_end, sales_scope").eq("is_active", true).maybeSingle(),
    admin.from("b2c_daily_sales_imports").select("id, period_start, period_end, dates, sales_scope").eq("is_active", true).maybeSingle(),
    admin.from("products").select("sku, product_name, category").in("category", ["Fresh Meat", "เนื้อสัตว์และอาหารทะเล", "MEAT+SEAFOOD", "B2B-MEAT+SEAFOOD"])
      .eq("is_active", true).limit(1500),
  ]);
  if (imports.error || dailyImports.error || catalogue.error) throw imports.error ?? dailyImports.error ?? catalogue.error;
  const dailySource = dailyImports.data;
  const source = dailySource ?? imports.data;
  const sourceScope: SalesScope = source?.sales_scope === "b2c_only" || source?.sales_scope === "all_store" ? source.sales_scope : "unverified";
  const verifiedB2C = salesScopeIsUsable(sourceScope);
  const products = [...new Map((catalogue.data ?? [])
    .filter((product) => product.sku && isFreshMeat(product.category, product.product_name ?? ""))
    .map((product) => [product.sku, { sku: product.sku, productName: product.product_name ?? product.sku }])).values()];
  skuList = [...new Set([...skuList, ...products.map((product) => product.sku)])];
  const bySku: SharedStockInputs["bySku"] = {};
  for (const sku of skuList) bySku[sku] = { b2cDailyKg: null, b2cByDateKg: {}, onHandKg: null, countedAt: null,
    demandPattern: null, observedDays: 0, suspectedStockoutDays: 0, coefficientOfVariation: null };
  for (const skus of batch(skuList, 150)) {
    const [sales, dailySales, counts, zeroStock] = await Promise.all([
      verifiedB2C && !dailySource && source ? admin.from("b2c_sales_30d_rows").select("sku, sold_qty, unit")
        .eq("import_id", source.id).in("sku", skus) : Promise.resolve({ data: [], error: null }),
      verifiedB2C && dailySource ? admin.from("b2c_daily_sales_profiles").select("sku, unit, daily_qty")
        .eq("import_id", dailySource.id).in("sku", skus) : Promise.resolve({ data: [], error: null }),
      admin.from("stock_morning_counts").select("sku, quantity_kg, counted_at")
        .eq("count_date", today).in("sku", skus),
      verifiedB2C && dailySource ? admin.from("stock_morning_counts").select("sku, count_date")
        .gte("count_date", dailySource.period_start).lte("count_date", dailySource.period_end)
        .eq("quantity_kg", 0).in("sku", skus) : Promise.resolve({ data: [], error: null }),
    ]);
    if (sales.error || dailySales.error || zeroStock.error) throw sales.error ?? dailySales.error ?? zeroStock.error;
    if (counts.error) throw counts.error;
    const zeroStockBySku = new Map<string, Set<string>>();
    for (const row of zeroStock.data ?? []) {
      if (!zeroStockBySku.has(row.sku)) zeroStockBySku.set(row.sku, new Set());
      zeroStockBySku.get(row.sku)!.add(row.count_date);
    }
    for (const row of sales.data ?? []) {
      // One 30-day total supports a daily mean, not a B2C variance or P95.
      // If the optional unit disagrees with kg, do not silently add quantities.
      if (bySku[row.sku] && (!row.unit || ["กก.", "กก", "kg", "KG"].includes(row.unit))) {
        bySku[row.sku].b2cDailyKg = Number(row.sold_qty) / 30;
        for (const date of targetDates) bySku[row.sku].b2cByDateKg[date] = Number(row.sold_qty) / 30;
      }
    }
    for (const row of dailySales.data ?? []) {
      if (!bySku[row.sku] || (row.unit && !["กก.", "กก", "kg", "KG"].includes(row.unit))) continue;
      const dateHistory = dailySource?.dates;
      const quantities = row.daily_qty;
      if (!Array.isArray(dateHistory) || !Array.isArray(quantities) || quantities.length !== dateHistory.length) continue;
      const diagnostics = analyseDailyDemand(dateHistory, quantities, zeroStockBySku.get(row.sku));
      bySku[row.sku].demandPattern = diagnostics.pattern;
      bySku[row.sku].observedDays = diagnostics.sampleDays;
      bySku[row.sku].suspectedStockoutDays = diagnostics.suspectedCensoredDays;
      bySku[row.sku].coefficientOfVariation = diagnostics.coefficientOfVariation;
      const validQuantities = diagnostics.adjustedQuantities.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      if (!validQuantities.length) continue;
      bySku[row.sku].b2cDailyKg = validQuantities.reduce((sum, value) => sum + value, 0) / validQuantities.length;
      for (const date of targetDates) bySku[row.sku].b2cByDateKg[date] = dailyWeekdayBaseline(dateHistory, diagnostics.adjustedQuantities, date);
    }
    for (const row of counts.data ?? []) if (bySku[row.sku]) {
      bySku[row.sku].onHandKg = Number(row.quantity_kg);
      bySku[row.sku].countedAt = row.counted_at;
    }
  }
  return { sourcePeriod: source ? { start: source.period_start, end: source.period_end } : null,
    sourceFormat: dailySource ? "daily" : source ? "total" : null, sourceScope, countDate: today, products, bySku };
}

/** Store the actual purchasing numbers in the immutable 10:00 audit record.
 * Prior snapshots only stored forecasts and source inputs, not quantities to buy.
 */
function buildPurchasingDrafts(forecast: StockForecast, shared: SharedStockInputs): SharedPurchaseDraft[] {
  const productMap = new Map(aggregateForecastByProduct(forecast.rows, forecast.dates)
    .filter((product) => product.freshMeat).map((product) => [product.sku, product]));
  const allSkus = new Set([...productMap.keys(), ...shared.products.map((product) => product.sku)]);
  return [...allSkus].map((sku) => {
    const product = productMap.get(sku);
    const kg = product?.units.filter((unit) => unit.unit === "กก.") ?? [];
    const sum = (index: number, field: "knownQty" | "totalQty") => kg.reduce((total, unit) => total + (unit.days[index]?.[field] ?? 0), 0);
    const retail = shared.bySku[sku];
    return sharedPurchaseDraft({ sku, productName: product?.productName ?? shared.products.find((item) => item.sku === sku)?.productName ?? sku,
      b2bTodayMeanKg: sum(0, "totalQty"), b2bTomorrowMeanKg: sum(1, "totalQty"), b2bDayAfterMeanKg: sum(2, "totalQty"),
      b2bConfirmedTomorrowKg: sum(1, "knownQty"),
      b2cTodayMeanKg: retail?.b2cByDateKg[forecast.dates[0]] ?? retail?.b2cDailyKg ?? null,
      b2cTomorrowMeanKg: retail?.b2cByDateKg[forecast.dates[1]] ?? retail?.b2cDailyKg ?? null,
      b2cDayAfterMeanKg: retail?.b2cByDateKg[forecast.dates[2]] ?? retail?.b2cDailyKg ?? null,
      morningOnHandKg: retail?.onHandKg ?? null });
  });
}

async function officialSnapshot(admin: SupabaseClient, date: string): Promise<SnapshotRecord | null> {
  const { data, error } = await admin.from("b2b_demand_forecast_snapshots")
    .select("snapshot_date, cutoff_at, captured_at, forecast, is_late")
    .eq("snapshot_date", date).maybeSingle();
  if (error) throw error;
  return (data as SnapshotRecord | null) ?? null;
}

function isSnapshotRequestAuthorized(request: NextRequest) {
  const secret = process.env.FORECAST_SNAPSHOT_SECRET;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!secret || !token) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// Called by Supabase Cron at 03:00 UTC (10:00 Bangkok). Each day is immutable:
// retries return the original snapshot instead of overwriting purchasing history.
export async function POST(request: NextRequest) {
  if (!isSnapshotRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const now = new Date();
    const today = bangkokDateKey(now);
    const cutoffAt = new Date(`${today}T10:00:00+07:00`);
    if (now < cutoffAt) return NextResponse.json({ error: "The 10:00 Bangkok cutoff has not passed" }, { status: 425 });
    const admin = adminClient();
    const existing = await officialSnapshot(admin, today);
    if (existing) return NextResponse.json({ snapshotDate: today, capturedAt: existing.captured_at, alreadyRecorded: true });
    const inputs = await loadForecast(admin);
    // B2B-only mode: retain demand snapshots, but stop creating incomplete
    // supplier purchasing recommendations until shared inventory data is ready.
    const { error } = await admin.from("b2b_demand_forecast_snapshots").insert({
      snapshot_date: today,
      target_delivery_date: inputs.noonForecast.dates[1],
      cutoff_at: cutoffAt.toISOString(),
      captured_at: now.toISOString(),
      is_late: now.getTime() - cutoffAt.getTime() > 120_000,
      model_version: "b2b-demand-only-10am-v1",
      forecast: inputs.noonForecast,
    });
    // A simultaneous retry must never replace the snapshot that won the race.
    if (error?.code === "23505") return NextResponse.json({ snapshotDate: today, alreadyRecorded: true });
    if (error) throw error;
    return NextResponse.json({ snapshotDate: today, capturedAt: now.toISOString(), recorded: true });
  } catch (error) {
    console.error("Stock forecast 10:00 snapshot capture failed", error);
    return NextResponse.json({ error: "Snapshot could not be recorded" }, { status: 500 });
  }
}

/** B2B demand only: SKU totals and customer contribution. No purchase plans. */
function b2bDemandExcelResponse(forecast: StockForecast) {
  const products = aggregateForecastByProduct(forecast.rows, forecast.dates);
  const summaryRows: (string | number)[][] = [
    ["Lotus’s B2B · ความต้องการตามสินค้า (ไม่ใช่ปริมาณสั่งซัพพลายเออร์)"],
    ["อ้างอิงจำนวนที่ลูกค้าขอสั่งตามวันส่งจาก OMS รวมออเดอร์ยกเลิก/ขายได้ไม่ครบ · ไม่รวมลูกค้าทดสอบ B2C หรือสต็อก"],
    [],
    ["SKU", "สินค้า", "หน่วย", "จำนวนลูกค้า", "ขอสั่งเมื่อวาน", "ขอสั่งวันนี้", "คาดปิดวันนี้ (Mode)",
      "พรุ่งนี้ขอสั่งแล้ว", "พรุ่งนี้คาดเพิ่ม (Mode)", "พรุ่งนี้คาดรวม (Mode)", "มะรืนคาดรวม (Mode)"],
    ...products.flatMap((product) => product.units.map((unit) => [
      product.sku, product.productName, unit.unit, unit.customers.length,
      unit.yesterdayRequestedQty, unit.todayRequestedQty, unit.days[0]?.totalQty ?? 0,
      unit.days[1]?.knownQty ?? 0, unit.days[1]?.projectedQty ?? 0,
      unit.days[1]?.totalQty ?? 0, unit.days[2]?.totalQty ?? 0,
    ])),
  ];
  const customerRows: (string | number)[][] = [
    ["Lotus’s B2B · ที่มาของความต้องการจากลูกค้าทุกราย"],
    ["การคาดการณ์ตามวันส่ง = ขอสั่งแล้ว (รวมยกเลิก) + ค่าที่มีโอกาสเกิดขึ้นมากที่สุด (Mode) · ไม่ใช่ค่าเฉลี่ยหรือยอดขาย"],
    [],
    ["SKU", "สินค้า", "หน่วย", "รหัสลูกค้า", "ชื่อลูกค้า", "ความเชื่อมั่น",
      "ขอสั่งเมื่อวาน", "ขอสั่งวันนี้", "คาดปิดวันนี้ (Mode)",
      "พรุ่งนี้ขอสั่งแล้ว", "พรุ่งนี้คาดเพิ่ม (Mode)", "พรุ่งนี้คาดรวม (Mode)", "มะรืนคาดรวม (Mode)",
      "รอบสั่ง SKU (วัน)", "เวลาที่มักสั่ง"],
    ...forecast.rows.map((row) => [
      row.sku, row.productName, row.unit, row.customerCode, row.customerName, row.confidence,
      row.yesterdayRequestedQty, row.todayRequestedQty, row.days[0]?.totalQty ?? 0,
      row.days[1]?.knownQty ?? 0, row.days[1]?.projectedQty ?? 0,
      row.days[1]?.totalQty ?? 0, row.days[2]?.totalQty ?? 0,
      row.effectiveCadenceDays ?? "",
      describeCustomerOrderTime(row.customerUsualOrderOffsetMinutes, row.customerOrderTimingSamples),
    ]),
  ];
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of [["รวมตาม SKU", summaryRows], ["แยกรายลูกค้า", customerRows]] as const) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: rows[3].length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: rows[3].length - 1 } },
    ];
    sheet["!cols"] = rows[3].map((_, column) =>
      ({ wch: column === 1 || (name === "แยกรายลูกค้า" && column === 4) ? 38 : 20 }));
    for (let row = 4; row < rows.length; row++) {
      for (let column = 0; column < rows[row].length; column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell && typeof cell.v === "number" &&
            column >= (name === "รวมตาม SKU" ? 4 : 7)) cell.z = "#,##0.0";
      }
    }
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="b2b_demand_' + forecast.dates[0] + '.xlsx"',
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function excelResponse(forecast: StockForecast, recommendations: StockOrderRecommendation[] = []) {
  const products = aggregateForecastByProduct(forecast.rows, forecast.dates);
  const summaryHeaders = [
    "SKU", "ชื่อสินค้า", "หน่วย", "จำนวนลูกค้า", "เนื้อสด",
    `${forecast.yesterdayDate} ยอดสั่ง`, `${forecast.dates[0]} สั่งแล้วถึงตอนนี้`,
    `${forecast.dates[0]} คาดยอดสั่งปิดวัน`, `${forecast.dates[1]} คาดความต้องการ`, `${forecast.dates[2]} คาดความต้องการ`,
    "เทียบ กก./ชิ้น", "แหล่งน้ำหนักต่อชิ้น", "จำนวนตัวอย่าง", "ยอดขอสั่งเดิมวันนี้ (ชิ้น)",
    ...forecast.dates.map((date) => `${date} แผน P${Math.round(forecast.planningPercentile * 100)}`),
  ];
  const summaryRows: (number | string)[][] = [
    ["Lotus’s B2B · พยากรณ์ความต้องการรวมตามสินค้า (ทุกลูกค้า)"],
    [`อัปเดต ${forecast.asOf} · คาดเฉลี่ยจากยอดขอสั่ง + โอกาสและขนาดออเดอร์ที่อาจสั่งเพิ่ม · แผน P${Math.round(forecast.planningPercentile * 100)} เผื่อความเสี่ยงขาดสินค้า · ยอดที่สั่งเป็นชิ้นแต่ขายตามน้ำหนักเทียบเป็น กก.จากหลักฐานชั่งจริง`],
    [],
    summaryHeaders,
    ...products.flatMap((product) => product.units.map((unit) => [
      product.sku, product.productName, unit.unit, product.customerCount, product.freshMeat ? "ใช่" : "ไม่ใช่",
      unit.yesterdayRequestedQty, unit.todayRequestedQty, ...unit.days.map((day) => day.totalQty),
      forecast.weightConversions[product.sku]?.kgPerPiece ?? "",
      forecast.weightConversions[product.sku]?.source === "measured" ? "ชั่งจริง" : forecast.weightConversions[product.sku] ? "อนุมานจากบิลเก่า" : "",
      forecast.weightConversions[product.sku]?.sampleCount ?? "",
      forecast.originalPieceDemand[product.sku]?.today ?? "",
      ...unit.days.map((day) => day.planningQty ?? day.totalQty),
    ])),
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryRows);
  summary["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: summaryHeaders.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: summaryHeaders.length - 1 } },
  ];
  summary["!cols"] = [
    { wch: 17 }, { wch: 48 }, { wch: 13 }, { wch: 17 }, { wch: 12 },
    ...Array.from({ length: 5 }, () => ({ wch: 23 })),
    { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 28 },
    ...forecast.dates.map(() => ({ wch: 23 })),
  ];
  for (let r = 4; r < summaryRows.length; r++) {
    for (let c = 5; c < summaryHeaders.length; c++) {
      const cell = summary[XLSX.utils.encode_cell({ r, c })];
       if (cell) cell.z = "#,##0.0";
    }
  }

  const headers = [
    "รหัสลูกค้า", "ชื่อลูกค้า", "SKU", "ชื่อสินค้า", "หน่วย",
    `${forecast.yesterdayDate} ยอดสั่ง`, `${forecast.dates[0]} สั่งแล้วถึงตอนนี้`,
    `${forecast.dates[0]} คาดยอดสั่งปิดวัน`, `${forecast.dates[1]} คาดความต้องการ`, `${forecast.dates[2]} คาดความต้องการ`,
    "เนื้อสด", "รอบสั่งลูกค้า (วัน)", "รอบซื้อ SKU (วัน)", "รอบคาดการณ์ (วัน)", "ความเชื่อมั่น", "โอกาสเลือกหน่วยนี้เมื่อสั่ง SKU (%)",
    ...forecast.dates.flatMap((date) => [`${date} รับออเดอร์แล้ว`, `${date} คาดการณ์เพิ่ม`, `${date} โอกาสสั่งเพิ่ม (%)`, `${date} ค่ากลางปริมาณหากสั่ง`]),
    "เวลาที่ลูกค้ามักสั่ง (เทียบวันส่ง)", "ตัวอย่างเวลาออเดอร์ (ครั้ง)",
    "เทียบ กก./ชิ้น", "แหล่งน้ำหนักต่อชิ้น", "จำนวนตัวอย่างน้ำหนัก",
    ...forecast.dates.map((date) => `${date} แผน P${Math.round(forecast.planningPercentile * 100)}`),
  ];
  const sheetRows: (number | string)[][] = [
    ["Lotus’s B2B · พยากรณ์ความต้องการสินค้า 3 วัน (สำหรับวางแผนเท่านั้น)"],
    [`อัปเดต ${forecast.asOf} · ยอดขอสั่งตามวันส่ง · SKU ชั่งน้ำหนักที่ขอเป็นชิ้นเทียบ กก. จากน้ำหนักชั่งจริงในประวัติก่อนเวลาคาดการณ์ · ใช้รอบสั่งลูกค้า + รอบ SKU + เวลาออเดอร์`],
    [],
    headers,
    ...forecast.rows.map((row) => [
      row.customerCode, row.customerName, row.sku, row.productName, row.unit,
       row.yesterdayRequestedQty, row.todayRequestedQty, ...row.days.map((day) => day.totalQty),
      row.freshMeat ? "ใช่" : "ไม่ใช่", row.customerCadenceDays ?? "", row.skuCadenceDays ?? "",
      row.effectiveCadenceDays ?? "", row.confidence, Math.round(row.conditionalUnitShare * 1000) / 10,
      ...row.days.flatMap((day) => [day.knownQty, day.projectedQty, Math.round((day.projectedProbability ?? 0) * 1000) / 10, day.possibleQty ?? 0]),
      describeCustomerOrderTime(row.customerUsualOrderOffsetMinutes, row.customerOrderTimingSamples), row.customerOrderTimingSamples,
      forecast.weightConversions[row.sku]?.kgPerPiece ?? "",
      forecast.weightConversions[row.sku]?.source === "measured" ? "ชั่งจริง" : forecast.weightConversions[row.sku] ? "อนุมานจากบิลเก่า" : "",
      forecast.weightConversions[row.sku]?.sampleCount ?? "",
      ...row.days.map((day) => day.planningQty ?? day.totalQty),
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];
  sheet["!cols"] = [
    { wch: 17 }, { wch: 35 }, { wch: 17 }, { wch: 44 }, { wch: 12 },
    ...Array.from({ length: 5 }, () => ({ wch: 23 })),
    { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 33 },
    ...forecast.dates.flatMap(() => [{ wch: 20 }, { wch: 20 }, { wch: 23 }, { wch: 20 }]),
    { wch: 30 }, { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 20 },
    ...forecast.dates.map(() => ({ wch: 23 })),
  ];
  for (let r = 4; r < sheetRows.length; r++) {
    for (const c of [5, 6, 7, 8, 9, 15, 30, 33, 34, 35, ...Array.from({ length: 12 }, (_, index) => 16 + index)]) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
       if (cell) cell.z = "#,##0.0";
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summary, "รวมตามสินค้า");
  XLSX.utils.book_append_sheet(workbook, sheet, "รายละเอียดรายลูกค้า");
  if (recommendations.length) {
    const planRows: (number | string)[][] = [
      ["แผนสั่งซื้อเนื้อสดจำลอง · เป้าหมายขาดสินค้าไม่เกิน 5% · FIFO อายุ 3 วัน · สมมติสต็อกต้นงวดเป็นศูนย์"],
      ["ยังไม่ใช่คำสั่งซื้อจริง · การขายอื่นนอก OMS และสต็อกที่มีอยู่ยังไม่ถูกรวม · ความเสี่ยงเป็นเพียงประมาณการ"],
      [],
      ["SKU", "ชื่อสินค้า", "ราคาขาย ฿/กก.", "ต้นทุน ฿/กก.", "คาดเฉลี่ย กก.", "แผน P90 กก.", "แนะนำสั่ง กก.", "เสี่ยงขาด %", "เสี่ยงหมดอายุ %", "ขาดเฉลี่ย กก.", "หมดอายุเฉลี่ย กก.", "ผลเสียทางการเงิน ฿", "สถานะ"],
      ...recommendations.map((row) => [
        row.sku, row.productName, row.sellingPriceBahtPerKg ?? "N/A", row.costBahtPerKg ?? "N/A",
        row.expectedDemandKg, row.originalP90Kg, row.recommendedOrderKg ?? "N/A",
        row.shortageProbabilityPct ?? "N/A", row.expiryProbabilityPct ?? "N/A",
        row.expectedShortageKg ?? "N/A", row.expectedExpiredKg ?? "N/A",
        row.expectedFinancialLossBaht ?? "N/A", row.confidence === "limited" ? "ประวัติน้อย" : "เบื้องต้น",
      ]),
    ];
    const planSheet = XLSX.utils.aoa_to_sheet(planRows);
    planSheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 12 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } },
    ];
    planSheet["!cols"] = [{ wch: 16 }, { wch: 44 }, ...Array.from({ length: 10 }, () => ({ wch: 21 })), { wch: 18 }];
    for (let r = 4; r < planRows.length; r++) {
      for (let c = 2; c <= 11; c++) {
        const cell = planSheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
      }
    }
    XLSX.utils.book_append_sheet(workbook, planSheet, "สั่งซื้อจำลอง FIFO");
  }
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="demand_forecast_${forecast.dates[0]}_${forecast.dates[2]}.xlsx"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireManager(request);
    const format = request.nextUrl.searchParams.get("format");
    if (format === "sku-economics") {
      const { data, error } = await admin.from("products")
        .select("sku, product_name, category")
        .in("category", ["Fresh Meat", "เนื้อสัตว์และอาหารทะเล", "MEAT+SEAFOOD", "B2B-MEAT+SEAFOOD"])
        .eq("is_active", true).limit(1500);
      if (error) throw error;
      const skus = (data ?? []).filter((product) => product.sku && isFreshMeat(product.category, product.product_name ?? ""))
        .map((product) => product.sku as string);
      return NextResponse.json({ economics: await masterEconomicsBySku(admin, skus) },
        { headers: { "Cache-Control": "private, no-store" } });
    }
    if (format === "plan-history") {
      // Read on demand, not during the 60-second live forecast refresh.
      const { data, error } = await admin.from("b2b_demand_forecast_snapshots")
        .select("snapshot_date, captured_at, is_late, forecast")
        .order("snapshot_date", { ascending: false }).limit(14);
      if (error) throw error;
      return NextResponse.json({ history: (data ?? []).map((record) => {
        const drafts = (record.forecast as SnapshotRecord["forecast"])?.sharedPurchaseDrafts;
        return { date: record.snapshot_date, capturedAt: record.captured_at, late: record.is_late,
          available: Array.isArray(drafts),
          readySkuCount: drafts?.filter((row) => row.orderKg !== null).length ?? null,
          missingSkuCount: drafts?.filter((row) => row.orderKg === null).length ?? null,
          recommendedKg: drafts ? Math.round(drafts.reduce((sum, row) => sum + (row.orderKg ?? 0), 0) * 10) / 10 : null,
          scope: record.forecast?.sharedStockInputs?.sourceScope ?? "unverified" };
      }) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const inputs = await loadForecast(admin, format === "backtest" ? BACKTEST_DAYS + 1 : 0);
    if (format === "backtest") {
      return NextResponse.json(
        backtestStockForecast(inputs.orders, inputs.items, inputs.customers, inputs.now),
        { headers: { "Cache-Control": "private, no-store, max-age=0" } }
      );
    }
    // B2B demand only: no B2C history, stock counts, cost inputs or buying plan.
    if (format === "b2b-demand") {
      return NextResponse.json(inputs.forecast, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
    if (format === "b2b-demand-xlsx") return b2bDemandExcelResponse(inputs.forecast);
    const today = bangkokDateKey(inputs.now);
    const snapshot = await officialSnapshot(admin, today);
    const savedForecast = snapshot?.forecast ?? inputs.noonForecast;
    // Do not duplicate the four-day internal simulation inputs in the public
    // forecast payload. Existing snapshots retain their original 3-day data.
    const { stockPlanningHorizon: savedHorizon, stockOrderPlan: savedOrderPlan, sharedStockInputs: savedSharedInputs,
      sharedPurchaseDrafts: savedPurchaseDrafts, ...officialForecast } = savedForecast as StockForecast & {
      stockPlanningHorizon?: StockForecast; stockOrderPlan?: StockOrderRecommendation[]; sharedStockInputs?: SharedStockInputs; sharedPurchaseDrafts?: SharedPurchaseDraft[];
    };
    const noonPlanningHorizon = savedHorizon ?? extendForecastForExpiry(officialForecast, inputs.noonPlanningHorizon);
    const livePlanningHorizon = extendForecastForExpiry(inputs.forecast, inputs.livePlanningHorizon);
    const skuList = [...new Set([...noonPlanningHorizon.rows, ...livePlanningHorizon.rows]
      .filter((row) => row.freshMeat && row.unit === "กก.").map((row) => row.sku))];
    const [economics, liveSharedInputs] = await Promise.all([
      masterEconomicsBySku(admin, skuList), loadSharedStockInputs(admin, skuList, today, inputs.forecast.dates),
    ]);
    const noonOrders = savedOrderPlan ?? optimizeFreshMeatOrders(noonPlanningHorizon, economics);
    const liveOrders = optimizeFreshMeatOrders(livePlanningHorizon, economics);
    if (format === "xlsx") return excelResponse(inputs.forecast, liveOrders);
    if (format === "noon-xlsx") return excelResponse(officialForecast, noonOrders);
    return NextResponse.json(
      {
        ...inputs.forecast,
        noonForecast: officialForecast,
        stockOrderPlans: {
          noon: noonOrders,
          live: liveOrders,
          /** Old snapshots predate four-day freezing; explain the fallback. */
          noonHorizonFrozen: !!savedHorizon && !!savedOrderPlan || !snapshot,
        },
        sharedStockInputs: {
          noon: savedSharedInputs ?? liveSharedInputs,
          live: liveSharedInputs,
          noonFrozen: !!savedSharedInputs || !snapshot,
        },
        officialPurchaseDrafts: savedPurchaseDrafts ?? null,
        snapshotStatus: snapshot ? "saved" : inputs.now < new Date(`${today}T10:00:00+07:00`) ? "preview" : "missing",
        snapshotCapturedAt: snapshot?.captured_at ?? null,
        snapshotWasLate: snapshot?.is_late ?? false,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "เฉพาะผู้จัดการเท่านั้น" }, { status: 403 });
    }
    console.error("Stock forecast failed", error);
    return NextResponse.json({ error: "ไม่สามารถคำนวณคาดการณ์ได้ กรุณาลองอีกครั้ง" }, { status: 500 });
  }
}
