import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  aggregateStockSales,
  bangkokDateKey,
  normalizeSalesUnit,
  stockReportDates,
  type StockSalesLine,
} from "@/lib/stockSalesReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_SIZE = 100;
const PAGE_SIZE = 500;

type BillingEvent = { order_id: string; created_at: string };
type ReportOrder = {
  id: string;
  customer_id: string;
  group_root_order_id: string | null;
  status: string;
};
type Item = {
  order_id: string;
  product_id: string;
  product_name_snapshot: string | null;
  unit_snapshot: string | null;
  actual_qty: number | string | null;
  piece_price_per_kg_snapshot: number | string | null;
};
type Customer = { id: string; customer_code: string | null; customer_name: string | null };
type Product = { id: string; sku: string | null };

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server configuration is incomplete.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireManager(request: NextRequest) {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new Error("UNAUTHORIZED");
  const admin = getAdminClient();
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) throw new Error("UNAUTHORIZED");
  const { data: staff, error: staffError } = await admin
    .from("staff")
    .select("account_type, is_active")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (staffError || staff?.account_type !== "manager" || staff.is_active !== true) {
    throw new Error("FORBIDDEN");
  }
  return admin;
}

function batches<T>(values: T[], size = BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

async function getBillingEvents(admin: SupabaseClient, start: string, end: string) {
  const result: BillingEvent[] = [];
  // PostgREST has a default 1000-row cap. Page explicitly for larger reporting periods.
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from("order_history")
      .select("order_id, created_at")
      .eq("action", "billing_completed")
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    result.push(...((data ?? []) as BillingEvent[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return result;
}

async function getOrdersById(admin: SupabaseClient, ids: string[]) {
  const found: ReportOrder[] = [];
  for (const chunk of batches(ids)) {
    const { data, error } = await admin
      .from("orders")
      .select("id, customer_id, group_root_order_id, status")
      .in("id", chunk);
    if (error) throw error;
    found.push(...((data ?? []) as ReportOrder[]));
  }
  return found;
}

async function getOrderGroupMembers(admin: SupabaseClient, rootIds: string[]) {
  const found: ReportOrder[] = [];
  for (const chunk of batches(rootIds)) {
    const { data, error } = await admin
      .from("orders")
      .select("id, customer_id, group_root_order_id, status")
      .in("group_root_order_id", chunk);
    if (error) throw error;
    found.push(...((data ?? []) as ReportOrder[]));
  }
  return found;
}

async function getItems(admin: SupabaseClient, orderIds: string[]) {
  const found: Item[] = [];
  for (const chunk of batches(orderIds)) {
    // Range through item lines in case a single batch has over 1000 SKU entries.
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await admin
        .from("order_items")
        .select("order_id, product_id, product_name_snapshot, unit_snapshot, actual_qty, piece_price_per_kg_snapshot")
        .in("order_id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      found.push(...((data ?? []) as Item[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return found;
}

async function getProducts(admin: SupabaseClient, ids: string[]) {
  const found: Product[] = [];
  for (const chunk of batches(ids)) {
    const { data, error } = await admin.from("products").select("id, sku").in("id", chunk);
    if (error) throw error;
    found.push(...((data ?? []) as Product[]));
  }
  return found;
}

async function getCustomers(admin: SupabaseClient, ids: string[]) {
  const found: Customer[] = [];
  for (const chunk of batches(ids)) {
    const { data, error } = await admin
      .from("customers")
      .select("id, customer_code, customer_name")
      .in("id", chunk);
    if (error) throw error;
    found.push(...((data ?? []) as Customer[]));
  }
  return found;
}

function nextDay(day: string) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    // Always authorize before looking up any sales or customer records.
    const admin = await requireManager(request);
    const dates = stockReportDates();
    const firstDay = dates[0];
    const lastDay = dates[dates.length - 1];
    const start = new Date(`${firstDay}T00:00:00+07:00`).toISOString();
    const end = new Date(`${nextDay(lastDay)}T00:00:00+07:00`).toISOString();

    const events = await getBillingEvents(admin, start, end);
    // If billing was retried, use the most recent completed event once per root order.
    const billedAt = new Map<string, string>();
    for (const event of events) billedAt.set(event.order_id, bangkokDateKey(event.created_at));

    const roots = (await getOrdersById(admin, [...billedAt.keys()]))
      .filter((order) => order.status !== "cancelled")
      .filter((order) => !order.group_root_order_id || order.group_root_order_id === order.id);
    const rootsById = new Map(roots.map((order) => [order.id, order]));

    // Each child contributes its own picked lines, but only the root billing event
    // determines the sale date. Fetch group members once, never bill children twice.
    const members = await getOrderGroupMembers(admin, roots.map((root) => root.id));
    const owners = new Map<string, ReportOrder>();
    for (const root of roots) owners.set(root.id, root);
    for (const member of members) {
      if (member.status === "cancelled") continue;
      const root = member.group_root_order_id && rootsById.get(member.group_root_order_id);
      if (root && member.customer_id === root.customer_id) owners.set(member.id, root);
    }

    const items = await getItems(admin, [...owners.keys()]);
    const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))];
    const customerIds = [...new Set(roots.map((root) => root.customer_id).filter(Boolean))];
    const [products, customers] = await Promise.all([
      getProducts(admin, productIds),
      getCustomers(admin, customerIds),
    ]);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const customersById = new Map(customers.map((customer) => [customer.id, customer]));

    const salesLines: StockSalesLine[] = [];
    for (const item of items) {
      const root = owners.get(item.order_id);
      if (!root) continue;
      const quantity = Number(item.actual_qty);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const product = productsById.get(item.product_id);
      const customer = customersById.get(root.customer_id);
      const billingDate = billedAt.get(root.id);
      if (!billingDate) continue;
      const sku = (product?.sku ?? "").trim();
      salesLines.push({
        customerId: root.customer_id,
        customerCode: customer?.customer_code ?? "",
        customerName: customer?.customer_name?.trim() || "ไม่ระบุชื่อลูกค้า",
        sku: /^\d{1,9}$/.test(sku) ? sku.padStart(9, "0") : (sku || item.product_id),
        productName: item.product_name_snapshot?.trim() || "ไม่ระบุชื่อสินค้า",
        unit: normalizeSalesUnit(item.unit_snapshot ?? "", item.piece_price_per_kg_snapshot !== null),
        quantity,
        billingDate,
      });
    }

    const rows = aggregateStockSales(salesLines, dates);
    const columns = ["รหัสลูกค้า", "ชื่อลูกค้า", "รหัสสินค้า (SKU)", "ชื่อสินค้า", "หน่วย", ...dates, "รวม 14 วัน"];
    const sheetData: (string | number)[][] = [
      ["Lotus’s B2B · รายงานปริมาณขายรายวันย้อนหลัง 14 วัน"],
      [`${firstDay} ถึง ${lastDay} (เวลาไทย) · วันที่ขาย = วันที่ปิดงาน Billing · ปริมาณ = จำนวนที่หยิบจริง`],
      [],
      columns,
      ...rows.map((row) => [
        row.customerCode, row.customerName, row.sku, row.productName, row.unit,
        ...row.dailyQuantities.map((n) => Math.round(n * 1000) / 1000),
        Math.round(row.totalQuantity * 1000) / 1000,
      ]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    worksheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: columns.length - 1 } },
    ];
    worksheet["!cols"] = [
      { wch: 17 }, { wch: 34 }, { wch: 19 }, { wch: 48 }, { wch: 13 },
      ...dates.map(() => ({ wch: 13 })), { wch: 18 },
    ];
    for (let rowIndex = 4; rowIndex < sheetData.length; rowIndex++) {
      for (let colIndex = 5; colIndex < columns.length; colIndex++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
        if (cell) cell.z = "#,##0.###";
      }
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "ยอดขาย 14 วัน");
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const filename = `stock_sales_${firstDay}_${lastDay}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "เฉพาะผู้จัดการเท่านั้น" }, { status: 403 });
    }
    console.error("Stock sales export failed", error);
    return NextResponse.json({ error: "ไม่สามารถจัดทำรายงานได้ กรุณาลองอีกครั้ง" }, { status: 500 });
  }
}
