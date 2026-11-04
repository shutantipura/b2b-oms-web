import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  aggregateForecastByProduct,
  buildStockForecast,
  FORECAST_HISTORY_DAYS,
  type ForecastCustomerInput,
  type ForecastItemInput,
  type ForecastOrderInput,
  type StockForecast,
} from "@/lib/stockForecast";

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
  actual_qty: number | string | null;
  confirmed_qty: number | string | null;
  requested_qty: number | string | null;
  actual_piece_qty: number | string | null;
  piece_price_per_kg_snapshot: number | string | null;
};
type DbProduct = { id: string; sku: string | null; product_name: string | null; category: string | null };
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

async function ordersSince(admin: SupabaseClient, start: string) {
  const result: DbOrder[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin
      .from("orders")
      .select("id, customer_id, created_at, delivery_date, group_root_order_id, status")
      .gte("created_at", start)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    result.push(...((data ?? []) as DbOrder[]));
    if (!data || data.length < 500) break;
  }
  return result;
}

async function billedRootsSince(admin: SupabaseClient, start: string) {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin
      .from("order_history")
      .select("order_id, created_at")
      .eq("action", "billing_completed")
      .gte("created_at", start)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) ids.add(row.order_id);
    if (!data || data.length < 500) break;
  }
  return ids;
}

async function itemsForOrders(admin: SupabaseClient, ids: string[]) {
  const result: DbItem[] = [];
  for (const chunk of batch(ids)) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await admin
        .from("order_items")
        .select("order_id, product_id, product_name_snapshot, unit_snapshot, actual_qty, confirmed_qty, requested_qty, actual_piece_qty, piece_price_per_kg_snapshot")
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
    const { data, error } = await admin.from("products").select("id, sku, product_name, category").in("id", chunk);
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

async function loadForecast(admin: SupabaseClient) {
  const now = new Date();
  const start = new Date(now.getTime() - FORECAST_HISTORY_DAYS * 86_400_000).toISOString();
  const [orders, billedIds] = await Promise.all([
    ordersSince(admin, start),
    billedRootsSince(admin, start),
  ]);
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
      productId: item.product_id,
      sku: /^\d{1,9}$/.test(rawSku) ? rawSku.padStart(9, "0") : rawSku || item.product_id,
      productName: item.product_name_snapshot || product?.product_name || "ไม่ระบุสินค้า",
      unit: item.unit_snapshot ?? "",
      category: product?.category ?? null,
      actualQty: numeric(item.actual_qty),
      confirmedQty: numeric(item.confirmed_qty),
      requestedQty: numeric(item.requested_qty),
      actualPieceQty: numeric(item.actual_piece_qty),
      piecePricePerKg: numeric(item.piece_price_per_kg_snapshot),
    };
  });
  return buildStockForecast(inputOrders, inputItems, customers, billedIds, now);
}

function excelResponse(forecast: StockForecast) {
  const products = aggregateForecastByProduct(forecast.rows, forecast.dates);
  const summaryHeaders = [
    "SKU", "ชื่อสินค้า", "หน่วย", "จำนวนลูกค้า", "เนื้อสด",
    `${forecast.yesterdayDate} ยอดจริง`, `${forecast.dates[0]} ยอดจริงถึงตอนนี้`,
    `${forecast.dates[0]} คาดยอดปิด`, `${forecast.dates[1]} คาดการณ์`, `${forecast.dates[2]} คาดการณ์`,
    "รวม 3 วัน",
  ];
  const summaryRows: (number | string)[][] = [
    ["Lotus’s B2B · ยอดคาดการณ์รวมตามสินค้า (ทุกลูกค้า)"],
    [`อัปเดต ${forecast.asOf} · ยอดจริงคือปริมาณที่ปิด Billing แล้วตามวันส่ง/รับสินค้า · ยอดคาดปิดวันนี้รวมยอดจริงแล้ว`],
    [],
    summaryHeaders,
    ...products.map((product) => [
      product.sku, product.productName, product.unit, product.customerCount, product.freshMeat ? "ใช่" : "ไม่ใช่",
      product.yesterdayActualQty, product.todayActualQty, ...product.days.map((day) => day.totalQty),
      Math.round(product.days.reduce((sum, day) => sum + day.totalQty, 0) * 1000) / 1000,
    ]),
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryRows);
  summary["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: summaryHeaders.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: summaryHeaders.length - 1 } },
  ];
  summary["!cols"] = [
    { wch: 17 }, { wch: 48 }, { wch: 13 }, { wch: 17 }, { wch: 12 },
    ...Array.from({ length: 5 }, () => ({ wch: 23 })),
    { wch: 17 },
  ];
  for (let r = 4; r < summaryRows.length; r++) {
    for (let c = 5; c < summaryHeaders.length; c++) {
      const cell = summary[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.z = "#,##0.###";
    }
  }

  const headers = [
    "รหัสลูกค้า", "ชื่อลูกค้า", "SKU", "ชื่อสินค้า", "หน่วย",
    `${forecast.yesterdayDate} ยอดจริง`, `${forecast.dates[0]} ยอดจริงถึงตอนนี้`,
    `${forecast.dates[0]} คาดยอดปิด`, `${forecast.dates[1]} คาดการณ์`, `${forecast.dates[2]} คาดการณ์`,
    "เนื้อสด", "รอบสั่งลูกค้า (วัน)", "รอบซื้อ SKU (วัน)", "รอบคาดการณ์ (วัน)", "ความเชื่อมั่น",
    ...forecast.dates.flatMap((date) => [`${date} รับออเดอร์แล้ว`, `${date} คาดการณ์เพิ่ม`]),
  ];
  const sheetRows: (number | string)[][] = [
    ["Lotus’s B2B · พยากรณ์ปริมาณขาย 3 วัน (สำหรับวางแผนเท่านั้น)"],
    [`อัปเดต ${forecast.asOf} · รับแล้ว + ปริมาณสั่งที่มีโอกาสเกิดมากที่สุด (>50%) · เนื้อสดใช้รอบไม่เกิน 2 วัน`],
    [],
    headers,
    ...forecast.rows.map((row) => [
      row.customerCode, row.customerName, row.sku, row.productName, row.unit,
      row.yesterdayActualQty, row.todayActualQty, ...row.days.map((day) => day.totalQty),
      row.freshMeat ? "ใช่" : "ไม่ใช่", row.customerCadenceDays ?? "", row.skuCadenceDays ?? "",
      row.effectiveCadenceDays ?? "", row.confidence,
      ...row.days.flatMap((day) => [day.knownQty, day.projectedQty]),
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
    { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 14 },
    ...forecast.dates.flatMap(() => [{ wch: 20 }, { wch: 20 }]),
  ];
  for (let r = 4; r < sheetRows.length; r++) {
    for (const c of [5, 6, 7, 8, 9, 15, 16, 17, 18, 19, 20]) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.z = "#,##0.###";
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
      "Content-Disposition": `attachment; filename="stock_forecast_${forecast.dates[0]}_${forecast.dates[2]}.xlsx"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireManager(request);
    const forecast = await loadForecast(admin);
    if (request.nextUrl.searchParams.get("format") === "xlsx") return excelResponse(forecast);
    return NextResponse.json(forecast, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
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
