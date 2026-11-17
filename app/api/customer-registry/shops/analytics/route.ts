import { NextRequest } from "next/server";
import { requireSalesRole, salesApiError } from "@/lib/server/salesAuth";

export const runtime = "nodejs";

type Order = {
  id: string; order_number: number; customer_id: string; status: string;
  created_at: string; completed_at: string | null; delivery_date: string | null;
  delivery_slot: string | null; fulfillment_method: string | null;
  final_amount: number | string | null; group_root_order_id: string | null;
};
type History = {
  id: string; order_id: string; action: string; from_status: string | null;
  to_status: string | null; created_at: string;
};
type Item = {
  id: string; order_id: string; product_id: string; product_name_snapshot: string;
  unit_snapshot: string; requested_qty: number | string | null;
  confirmed_qty: number | string | null; actual_qty: number | string | null;
  actual_piece_qty: number | string | null; piece_price_per_kg_snapshot: number | string | null;
};
type DemandProduct = {
  productId: string; name: string; sku: string | null; unit: string;
  requestedQty: number; pickedQty: number; measuredLines: number;
  orderCount: number; unfilledCompletedLines: number;
};
type SalesBucket = { startDate: string; sales: number; bills: number };
type Insight = { kind: "problem" | "opportunity" | "observation"; text: string };
type Period = "week" | "month" | "all";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});
function bangkokDate(value: string | Date): string {
  const parts = dateFormatter.formatToParts(new Date(value));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}
function utcDate(day: string) { return Date.parse(day + "T00:00:00Z"); }
function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function round1(n: number) { return Math.round(n * 10) / 10; }
function round3(n: number) { return Math.round(n * 1000) / 1000; }
function monthKey(day: string) { return day.slice(0, 7); }
function inclusiveDays(start: string, end: string) {
  return Math.max(1, Math.round((utcDate(end) - utcDate(start)) / DAY) + 1);
}
function makeBuckets(period: Period, start: string, end: string): SalesBucket[] {
  const buckets: SalesBucket[] = [];
  const from = utcDate(start), to = utcDate(end);
  if (period === "all") {
    const [firstYear, firstMonth] = start.split("-").map(Number);
    const [lastYear, lastMonth] = end.split("-").map(Number);
    for (let year = firstYear, month = firstMonth; year < lastYear || (year === lastYear && month <= lastMonth); ) {
      buckets.push({ startDate: year + "-" + String(month).padStart(2,"0") + "-01", sales: 0, bills: 0 });
      if (++month === 13) { month = 1; year++; }
    }
  } else {
    for (let day = from; day <= to; day += period === "week" ? DAY : WEEK) {
      buckets.push({ startDate: new Date(day).toISOString().slice(0, 10), sales: 0, bills: 0 });
    }
  }
  return buckets;
}
function bucketIndex(period: Period, date: string, start: string): number {
  if (period === "all") {
    const [year, month] = date.split("-").map(Number);
    const [firstYear, firstMonth] = start.split("-").map(Number);
    return (year - firstYear) * 12 + month - firstMonth;
  }
  return Math.floor((utcDate(date) - utcDate(start)) / (period === "week" ? DAY : WEEK));
}
function deliveryEnd(order: Order): number | null {
  if (!order.delivery_date || !order.delivery_slot) return null;
  const match = order.delivery_slot.match(/([01]?\d|2[0-3]):([0-5]\d)\s*$/);
  if (!match) return null;
  const date = Date.parse(order.delivery_date + "T" + match[1].padStart(2, "0") +
    ":" + match[2] + ":00+07:00");
  return Number.isFinite(date) ? date : null;
}
function compareShortPick(lines: Item[]): boolean | null {
  if (!lines.length) return null;
  let missing = false;
  let short = false;
  for (const line of lines) {
    const confirmed = numeric(line.confirmed_qty);
    const piecePriced = line.piece_price_per_kg_snapshot !== null;
    const actual = numeric(piecePriced ? line.actual_piece_qty : line.actual_qty);
    if (confirmed === null || actual === null) { missing = true; continue; }
    const kg = /kg|กก/i.test(line.unit_snapshot || "");
    if (actual < confirmed - (!piecePriced && kg ? 0.5 : 0)) short = true;
  }
  return short ? true : missing ? null : false;
}
function compareShortStock(lines: Item[]): boolean | null {
  if (!lines.length) return null;
  let missing = false;
  let short = false;
  for (const line of lines) {
    const requested = numeric(line.requested_qty);
    const confirmed = numeric(line.confirmed_qty);
    if (requested === null || confirmed === null) { missing = true; continue; }
    if (confirmed < requested) short = true;
  }
  return short ? true : missing ? null : false;
}
function percent(numerator: number, denominator: number): number | null {
  return denominator ? Math.round(numerator / denominator * 1000) / 10 : null;
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireSalesRole(request, ["manager", "salesman"]);
    const shopId = request.nextUrl.searchParams.get("shopId") ?? "";
    const period = request.nextUrl.searchParams.get("period") ?? "month";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shopId)
      || !["week", "month", "all"].includes(period))
      return Response.json({ error: "Invalid shop or period" }, { status: 400 });
    const selectedPeriod = period as Period;

    const { data: shop, error: shopError } = await admin.from("customers")
      .select("id,customer_name,is_test_customer").eq("id", shopId).maybeSingle();
    if (shopError) throw shopError;
    if (!shop) return Response.json({ error: "Shop not found" }, { status: 404 });

    const today = bangkokDate(new Date());
    const todayMs = utcDate(today);
    // Rolling Bangkok calendar dates, including today. "All" starts at the first OMS order.
    const fixedStart = selectedPeriod === "week"
      ? new Date(todayMs - 6 * DAY).toISOString().slice(0, 10)
      : selectedPeriod === "month"
      ? new Date(todayMs - 29 * DAY).toISOString().slice(0, 10) : null;

    // No test-shop orders contribute to customer KPIs.
    const orderRows: Order[] = [];
    if (!shop.is_test_customer) {
      for (let offset = 0; offset < 10000; offset += 1000) {
        const { data, error } = await admin.from("orders")
          .select("id,order_number,customer_id,status,created_at,completed_at,delivery_date,delivery_slot,fulfillment_method,final_amount,group_root_order_id")
          .eq("customer_id", shopId)
          // Read whole order history so /x siblings and completed bills stay consistent
          // even when order creation and billing fall in different periods.
          .order("created_at", { ascending: false }).range(offset, offset + 999);
        if (error) throw error;
        orderRows.push(...(data ?? []) as Order[]);
        if ((data ?? []).length < 1000) break;
        if (offset === 9000) throw new Error("Too many orders to calculate safely");
      }
    }

    const firstOrderDay = orderRows.length
      ? orderRows.map(o => bangkokDate(o.created_at)).sort()[0] : today;
    const startDay = fixedStart ?? firstOrderDay;
    const salesTrend = makeBuckets(selectedPeriod, startDay, today);
    const effectiveStart = utcDate(startDay);
    const orderIsInPeriod = (order: Order) => {
      const day = bangkokDate(order.created_at);
      return day >= startDay && day <= today;
    };
    const ids = orderRows.map(o => o.id);
    async function related<T>(table: "order_history" | "order_items", fields: string): Promise<T[]> {
      const all: T[] = [];
      for (let index = 0; index < ids.length; index += 30) {
        const chunk = ids.slice(index, index + 30);
        for (let offset = 0; offset < 10000; offset += 1000) {
          const { data, error } = await admin.from(table).select(fields)
            .in("order_id", chunk).order("id", { ascending: true }).range(offset, offset + 999);
          if (error) throw error;
          all.push(...(data ?? []) as T[]);
          if ((data ?? []).length < 1000) break;
          if (offset === 9000) throw new Error("Too many order records to calculate safely");
        }
      }
      return all;
    }
    const [history, items] = await Promise.all([
      related<History>("order_history", "id,order_id,action,from_status,to_status,created_at"),
      related<Item>("order_items",
        "id,order_id,product_id,product_name_snapshot,unit_snapshot,requested_qty,confirmed_qty,actual_qty,actual_piece_qty,piece_price_per_kg_snapshot"),
    ]);

    const historyByOrder = new Map<string, History[]>();
    for (const h of history) {
      const rows = historyByOrder.get(h.order_id) ?? [];
      rows.push(h); historyByOrder.set(h.order_id, rows);
    }
    const itemsByOrder = new Map<string, Item[]>();
    for (const line of items) {
      const rows = itemsByOrder.get(line.order_id) ?? [];
      rows.push(line); itemsByOrder.set(line.order_id, rows);
    }
    const groupId = (order: Order) => order.group_root_order_id ?? order.id;
    const membersByRoot = new Map<string, Order[]>();
    for (const order of orderRows) {
      const key = groupId(order);
      const rows = membersByRoot.get(key) ?? [];
      rows.push(order); membersByRoot.set(key, rows);
    }
    const roots = orderRows.filter(order => groupId(order) === order.id);
    const now = Date.now();
    const qualifyingBills = new Map<string, { date: string; amount: number; created: string }>();
    const demandDays = new Set<string>();
    const requestedRoots = new Set<string>();
    let totalSales = 0;
    let lastBilledAt: string | null = null;
    for (const order of orderRows) {
      if (orderIsInPeriod(order)) {
        requestedRoots.add(groupId(order));
        demandDays.add(bangkokDate(order.created_at));
      }
    }
    for (const root of roots) {
      if (root.status !== "completed" || root.final_amount === null) continue;
      const members = membersByRoot.get(root.id) ?? [root];
      if (!members.every(order => order.status === "completed")) continue;
      const billedAt = (historyByOrder.get(root.id) ?? [])
        .filter(h => h.action === "billing_completed").map(h => h.created_at).sort()[0];
      if (!billedAt) continue; // Match the OMS financial KPI's completed-bill rule.
      const date = bangkokDate(billedAt);
      const bucket = bucketIndex(selectedPeriod, date, startDay);
      const amount = numeric(root.final_amount);
      if (date < startDay || date > today || !salesTrend[bucket] || amount === null) continue;
      salesTrend[bucket].sales += amount;
      salesTrend[bucket].bills++;
      totalSales += amount;
      qualifyingBills.set(root.id, { date, amount, created: root.created_at });
      if (lastBilledAt === null || billedAt > lastBilledAt) lastBilledAt = billedAt;
    }
    for (const bucket of salesTrend) bucket.sales = Math.round(bucket.sales * 100) / 100;
    const billCount = qualifyingBills.size;
    const days = Array.from(demandDays).sort();
    const averageGapDays = days.length > 1
      ? round1((utcDate(days[days.length - 1]) - utcDate(days[0])) /
        DAY / (days.length - 1)) : null;
    const periodDays = inclusiveDays(startDay, today);
    const orderCount = requestedRoots.size;

    // All recorded customer demand, including pending, unfilled and cancelled orders.
    // Requested quantities use the unit the customer ordered in; do not mix pcs and kg.
    const demandMap = new Map<string, DemandProduct & { orderIds: Set<string> }>();
    for (const order of orderRows) {
      if (!orderIsInPeriod(order)) continue;
      for (const line of itemsByOrder.get(order.id) ?? []) {
        const requested = numeric(line.requested_qty);
        if (requested === null || requested <= 0) continue;
        const unit = line.unit_snapshot || "หน่วย";
        const key = line.product_id + "|" + unit;
        const entry = demandMap.get(key) ?? {
          productId: line.product_id, name: line.product_name_snapshot, sku: null,
          unit, requestedQty: 0, pickedQty: 0, measuredLines: 0,
          orderCount: 0, unfilledCompletedLines: 0, orderIds: new Set<string>(),
        };
        entry.requestedQty += requested;
        // Piece-priced meat is picked in kilograms but demanded in pieces.
        const actual = numeric(line.piece_price_per_kg_snapshot !== null
          ? line.actual_piece_qty : line.actual_qty);
        if (actual !== null) {
          entry.measuredLines++;
          entry.pickedQty += Math.max(0, actual);
          if (order.status === "completed" && actual === 0) entry.unfilledCompletedLines++;
        }
        entry.orderIds.add(groupId(order));
        entry.orderCount = entry.orderIds.size;
        demandMap.set(key, entry);
      }
    }
    const products = Array.from(demandMap.values())
      .sort((a, b) => b.orderCount - a.orderCount ||
        b.requestedQty - a.requestedQty || a.name.localeCompare(b.name, "th"));
    // Fetch catalogue SKU codes only for demanded products; not for the 89k-item master list.
    const productIds = Array.from(new Set(products.map(p => p.productId)));
    const skuById = new Map<string, string | null>();
    for (let index = 0; index < productIds.length; index += 100) {
      const { data, error } = await admin.from("products")
        .select("id,sku").in("id", productIds.slice(index, index + 100));
      if (error) throw error;
      for (const product of data ?? []) skuById.set(product.id, product.sku);
    }
    for (const product of products) product.sku = skuById.get(product.productId) ?? null;

    let shortPickHits = 0, shortPickMeasured = 0, stockHits = 0, stockMeasured = 0;
    for (const order of orderRows) {
      if (order.status === "cancelled" || !order.delivery_date ||
        order.delivery_date < startDay || order.delivery_date > today) continue;
      const stages = historyByOrder.get(order.id) ?? [];
      const lines = itemsByOrder.get(order.id) ?? [];
      // Match OMS operational KPIs: measure only after picking has finished.
      if (stages.some(h => h.to_status === "awaiting_billing")) {
        const pickedShort = compareShortPick(lines);
        const confirmedShort = compareShortStock(lines);
        if (pickedShort !== null) { shortPickMeasured++; if (pickedShort) shortPickHits++; }
        // "Short Stock" combines the stock-check shortage and short-picked lines.
        const stockShort = pickedShort === true || confirmedShort === true ? true
          : pickedShort === null || confirmedShort === null ? null : false;
        if (stockShort !== null) { stockMeasured++; if (stockShort) stockHits++; }
      }
    }

    let dotOnTime = 0, dotMeasured = 0;
    for (const root of roots) {
      if (root.status === "cancelled" || root.fulfillment_method === "pickup" ||
        !root.delivery_date || root.delivery_date < startDay || root.delivery_date > today) continue;
      const deadline = deliveryEnd(root);
      if (deadline === null) continue;
      const deliveredAt = (historyByOrder.get(root.id) ?? [])
        .filter(h => h.from_status === "out_for_delivery" && h.to_status === "awaiting_payment")
        .map(h => Date.parse(h.created_at)).filter(Number.isFinite).sort((a, b) => a - b)[0];
      if (deliveredAt !== undefined) {
        dotMeasured++;
        if (deliveredAt <= deadline) dotOnTime++;
      } else if (now > deadline) {
        dotMeasured++; // Overdue, including a task still awaiting delivery.
      }
    }

    const pendingOrders = roots.filter(o => o.status !== "completed" &&
      o.status !== "cancelled" && orderIsInPeriod(o)).length;
    const cancelledOrders = roots.filter(o => o.status === "cancelled" &&
      orderIsInPeriod(o)).length;

    const insights: Insight[] = [];
    if (stockMeasured >= 2 && stockHits > 0) insights.push({
      kind: "problem",
      text: "พบออเดอร์ที่สินค้าไม่ครบ " + stockHits + "/" + stockMeasured +
        " รายการ (" + percent(stockHits, stockMeasured) +
        "%) หลังจบ Picking — ควรทบทวนสต็อกและขั้นตอนหยิบสินค้า",
    });
    if (dotMeasured >= 2 && dotOnTime < dotMeasured) insights.push({
      kind: "problem",
      text: "จัดส่งเกินช่วงเวลาที่เลือก " + (dotMeasured - dotOnTime) +
        "/" + dotMeasured + " ออเดอร์ — ตรวจสอบช่วงเวลาที่เกิดปัญหา",
    });
    const unfilled = products.filter(p => p.unfilledCompletedLines > 0)
      .sort((a,b) => b.unfilledCompletedLines - a.unfilledCompletedLines);
    if (unfilled.length) insights.push({
      kind: "opportunity",
      text: "มีความต้องการ " + unfilled[0].name +
        " แต่มี " + unfilled[0].unfilledCompletedLines +
        " รายการที่ปิดงานแล้วและบันทึกว่าหยิบได้ 0 — ตรวจสอบความพร้อมของสินค้า",
    });
    if (products[0] && products[0].orderCount >= 2) insights.push({
      kind: "opportunity",
      text: "สินค้า " + products[0].name + " ถูกสั่ง " +
        products[0].orderCount + " ออเดอร์ (" + round3(products[0].requestedQty) +
        " " + products[0].unit + ") — เหมาะกับการเตรียมสต็อกตามรอบสั่ง",
    });
    if (periodDays >= 14 && orderCount > 0 &&
      !Array.from(demandDays).some(day => utcDate(day) >= todayMs - 6 * DAY)) insights.push({
      kind: "opportunity",
      text: "ไม่มีคำสั่งซื้อใน 7 วันล่าสุดของช่วงที่วิเคราะห์ — มีโอกาสติดต่อสอบถามความต้องการล่าสุด",
    });
    if (pendingOrders > 0) insights.push({
      kind: "observation",
      text: "มี " + pendingOrders +
        " ออเดอร์ที่ยังดำเนินการอยู่ — ยอดสั่งยังไม่ใช่ยอดขาย และไม่ควรถือว่าเป็นสินค้าขาด",
    });
    if (orderCount === 0) insights.push({
      kind: "observation", text: "ยังไม่มีคำสั่งซื้อในช่วงที่เลือก จึงยังไม่สามารถสรุปปัญหาหรือโอกาสจากพฤติกรรมการซื้อได้",
    });
    if (insights.length === 0) insights.push({
      kind: "observation", text: "ยังไม่พบรูปแบบปัญหาชัดเจนจากข้อมูลในช่วงนี้ — ติดตามความถี่ซื้อและสินค้าเป้าหมายต่อเนื่อง",
    });

    return Response.json({
      shop: { id: shop.id, name: shop.customer_name, excludedTest: shop.is_test_customer },
      period: selectedPeriod, startDate: startDay, endDate: today,
      periodDays, totalSales: Math.round(totalSales * 100) / 100,
      completedBills: billCount,
      averageBill: billCount ? Math.round(totalSales / billCount * 100) / 100 : null,
      requestedOrders: orderCount,
      ordersPerWeek: round1(orderCount / periodDays * 7),
      buyingDays: days.length, averageGapDays, lastBilledAt, pendingOrders,
      cancelledOrders,
      activeBuckets: salesTrend.filter(row => row.bills > 0).length,
      shortPick: { percent: percent(shortPickHits, shortPickMeasured),
        affected: shortPickHits, measured: shortPickMeasured },
      shortStock: { percent: percent(stockHits, stockMeasured),
        affected: stockHits, measured: stockMeasured },
      dot: { percent: percent(dotOnTime, dotMeasured),
        onTime: dotOnTime, measured: dotMeasured },
      salesTrend, demandProducts: products.map(product => ({
        productId: product.productId, name: product.name, sku: product.sku,
        unit: product.unit, orderCount: product.orderCount,
        requestedQty: round3(product.requestedQty),
        pickedQty: round3(product.pickedQty),
        measuredLines: product.measuredLines,
      })), insights: insights.slice(0, 5),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return salesApiError(error);
  }
}
