import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  aggregateForecastByProduct,
  bangkokDateKey,
  buildStockForecast,
  describeCustomerOrderTime,
  FORECAST_DAYS,
  FORECAST_HISTORY_DAYS,
  type ForecastCustomerInput,
  type ForecastItemInput,
  type ForecastOrderInput,
  type StockForecast,
} from "@/lib/stockForecast";
import { BACKTEST_DAYS, backtestStockForecast } from "@/lib/stockForecastBacktest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbOrder = {
  id: string;
  customer_id: string;
  created_at: string;
  delivery_date: string | null;
  group_root_order_id: string | null;
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
      .select("id, customer_id, created_at, delivery_date, group_root_order_id, status")
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
      if (customer.is_active === false) continue;
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

async function loadForecast(admin: SupabaseClient, extraHistoryDays = 0) {
  const now = new Date();
  const today = bangkokDateKey(now);
  const dateMillis = Date.parse(`${today}T00:00:00Z`);
  const startDate = new Date(dateMillis - (FORECAST_HISTORY_DAYS + extraHistoryDays) * 86_400_000).toISOString().slice(0, 10);
  const endDate = new Date(dateMillis + (FORECAST_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const orders = await ordersForDeliveryDates(admin, startDate, endDate);
  const liveOrders = orders.filter((order) => order.status !== "cancelled");
  const [items, customers] = await Promise.all([
    itemsForOrders(admin, liveOrders.map((order) => order.id)),
    customersById(admin, [...new Set(liveOrders.map((order) => order.customer_id))]),
  ]);
  const products = await productsById(admin, [...new Set(items.map((item) => item.product_id))]);
  const inputOrders: ForecastOrderInput[] = liveOrders.map((order) => ({
    id: order.id,
    customerId: order.customer_id,
    createdAt: order.created_at,
    deliveryDate: order.delivery_date,
    groupRootOrderId: order.group_root_order_id,
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
    orders: inputOrders,
    items: inputItems,
    customers,
    now,
  };
}

function excelResponse(forecast: StockForecast) {
  const products = aggregateForecastByProduct(forecast.rows, forecast.dates);
  const summaryHeaders = [
    "SKU", "ชื่อสินค้า", "หน่วย", "จำนวนลูกค้า", "เนื้อสด",
    `${forecast.yesterdayDate} ยอดสั่ง`, `${forecast.dates[0]} สั่งแล้วถึงตอนนี้`,
    `${forecast.dates[0]} คาดยอดสั่งปิดวัน`, `${forecast.dates[1]} คาดความต้องการ`, `${forecast.dates[2]} คาดความต้องการ`,
    "เทียบ กก./ชิ้น", "แหล่งน้ำหนักต่อชิ้น", "จำนวนตัวอย่าง", "ยอดขอสั่งเดิมวันนี้ (ชิ้น)",
  ];
  const summaryRows: (number | string)[][] = [
    ["Lotus’s B2B · พยากรณ์ความต้องการรวมตามสินค้า (ทุกลูกค้า)"],
    [`อัปเดต ${forecast.asOf} · ใช้ requested_qty · รายการที่สั่งเป็นชิ้นแต่ขายตามน้ำหนักจะแปลงเป็น กก.โดยประมาณจากหลักฐานชั่งน้ำหนักในอดีต · ไม่ใช้ปริมาณที่หยิบจริงแทนยอดขอสั่ง`],
    [],
    summaryHeaders,
    ...products.flatMap((product) => product.units.map((unit) => [
      product.sku, product.productName, unit.unit, product.customerCount, product.freshMeat ? "ใช่" : "ไม่ใช่",
      unit.yesterdayRequestedQty, unit.todayRequestedQty, ...unit.days.map((day) => day.totalQty),
      forecast.weightConversions[product.sku]?.kgPerPiece ?? "",
      forecast.weightConversions[product.sku]?.source === "measured" ? "ชั่งจริง" : forecast.weightConversions[product.sku] ? "อนุมานจากบิลเก่า" : "",
      forecast.weightConversions[product.sku]?.sampleCount ?? "",
      forecast.originalPieceDemand[product.sku]?.today ?? "",
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
    ...forecast.dates.flatMap((date) => [`${date} รับออเดอร์แล้ว`, `${date} คาดการณ์เพิ่ม`, `${date} โอกาสสั่งเพิ่ม (%)`, `${date} ปริมาณหากสั่ง`]),
    "เวลาที่ลูกค้ามักสั่ง (เทียบวันส่ง)", "ตัวอย่างเวลาออเดอร์ (ครั้ง)",
    "เทียบ กก./ชิ้น", "แหล่งน้ำหนักต่อชิ้น", "จำนวนตัวอย่างน้ำหนัก",
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
  ];
  for (let r = 4; r < sheetRows.length; r++) {
    for (const c of [5, 6, 7, 8, 9, 15, 30, ...Array.from({ length: 12 }, (_, index) => 16 + index)]) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
       if (cell) cell.z = "#,##0.0";
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summary, "รวมตามสินค้า");
  XLSX.utils.book_append_sheet(workbook, sheet, "รายละเอียดรายลูกค้า");
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
    const inputs = await loadForecast(admin, format === "backtest" ? BACKTEST_DAYS + 1 : 0);
    if (format === "backtest") {
      return NextResponse.json(
        backtestStockForecast(inputs.orders, inputs.items, inputs.customers, inputs.now),
        { headers: { "Cache-Control": "private, no-store, max-age=0" } }
      );
    }
    if (format === "xlsx") return excelResponse(inputs.forecast);
    return NextResponse.json(inputs.forecast, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
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
