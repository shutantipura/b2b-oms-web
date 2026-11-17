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
type TopProduct = { productId: string; name: string; sku: string | null;
  unit: string; quantity: number; bills: number };

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
function validWeekIndex(date: string, start: number, weeks: number) {
  const index = Math.floor((utcDate(date) - start) / WEEK);
  return index >= 0 && index < weeks ? index : -1;
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
    const weeks = Number(request.nextUrl.searchParams.get("weeks") ?? 4);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shopId) || ![4, 8, 12].includes(weeks))
      return Response.json({ error: "Invalid shop or period" }, { status: 400 });

    const { data: shop, error: shopError } = await admin.from("customers")
      .select("id,customer_name,is_test_customer").eq("id", shopId).maybeSingle();
    if (shopError) throw shopError;
    if (!shop) return Response.json({ error: "Shop not found" }, { status: 404 });

    const thisMonday = utcDate(bangkokDate(new Date()));
    const todayDay = new Date(thisMonday).getUTCDay();
    const monday = thisMonday - ((todayDay + 6) % 7) * DAY;
    const start = monday - (weeks - 1) * WEEK;
    const startDay = new Date(start).toISOString().slice(0, 10);
    const startInstant = new Date(start - 7 * 60 * 60_000).toISOString();
    const weeklySales = Array.from({ length: weeks }, (_, index) => ({
      weekStart: new Date(start + index * WEEK).toISOString().slice(0, 10),
      sales: 0, bills: 0,
    }));

    // No test-shop orders contribute to customer KPIs.
    const orderRows: Order[] = [];
    if (!shop.is_test_customer) {
      for (let offset = 0; offset < 10000; offset += 1000) {
        const { data, error } = await admin.from("orders")
          .select("id,order_number,customer_id,status,created_at,completed_at,delivery_date,delivery_slot,fulfillment_method,final_amount,group_root_order_id")
          .eq("customer_id", shopId)
          .or("created_at.gte." + startInstant + ",completed_at.gte." + startInstant +
            ",delivery_date.gte." + startDay)
          .order("created_at", { ascending: false }).range(offset, offset + 999);
        if (error) throw error;
        orderRows.push(...(data ?? []) as Order[]);
        if ((data ?? []).length < 1000) break;
        if (offset === 9000) throw new Error("Too many orders to calculate safely");
      }
    }

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
    const purchasedDays = new Set<string>();
    let totalSales = 0;
    let lastBilledAt: string | null = null;
    for (const root of roots) {
      if (root.status !== "completed" || root.final_amount === null) continue;
      const members = membersByRoot.get(root.id) ?? [root];
      if (!members.every(order => order.status === "completed")) continue;
      const billedAt = (historyByOrder.get(root.id) ?? [])
        .filter(h => h.action === "billing_completed").map(h => h.created_at).sort()[0];
      if (!billedAt) continue; // Match the OMS financial KPI's completed-bill rule.
      const date = bangkokDate(billedAt);
      const week = validWeekIndex(date, start, weeks);
      const amount = numeric(root.final_amount);
      if (week < 0 || amount === null) continue;
      weeklySales[week].sales += amount;
      weeklySales[week].bills++;
      totalSales += amount;
      qualifyingBills.set(root.id, { date, amount, created: root.created_at });
      purchasedDays.add(bangkokDate(root.created_at));
      if (lastBilledAt === null || billedAt > lastBilledAt) lastBilledAt = billedAt;
    }
    for (const bucket of weeklySales) bucket.sales = Math.round(bucket.sales * 100) / 100;
    const billCount = qualifyingBills.size;
    const days = Array.from(purchasedDays).sort();
    const averageGapDays = days.length > 1
      ? Math.round((utcDate(days[days.length - 1]) - utcDate(days[0])) /
        DAY / (days.length - 1) * 10) / 10 : null;

    const topMap = new Map<string, TopProduct & { billIds: Set<string> }>();
    for (const order of orderRows) {
      const root = groupId(order);
      if (!qualifyingBills.has(root) || order.status !== "completed") continue;
      for (const line of itemsByOrder.get(order.id) ?? []) {
        const qty = numeric(line.actual_qty);
        if (qty === null || qty <= 0) continue;
        const unit = line.piece_price_per_kg_snapshot !== null ? "กก." : (line.unit_snapshot || "หน่วย");
        const key = line.product_id + "|" + unit;
        const product = topMap.get(key) ?? {
          productId: line.product_id, name: line.product_name_snapshot, sku: null,
          unit, quantity: 0, bills: 0, billIds: new Set<string>(),
        };
        product.quantity += qty;
        product.billIds.add(root);
        product.bills = product.billIds.size;
        topMap.set(key, product);
      }
    }
    const top = Array.from(topMap.values()).sort((a, b) =>
      b.bills - a.bills || b.quantity - a.quantity).slice(0, 8);
    if (top.length) {
      const { data: products, error } = await admin.from("products")
        .select("id,sku").in("id", Array.from(new Set(top.map(p => p.productId))));
      if (error) throw error;
      const skuById = new Map((products ?? []).map(p => [p.id, p.sku]));
      for (const product of top) product.sku = skuById.get(product.productId) ?? null;
    }

    let shortPickHits = 0, shortPickMeasured = 0, stockHits = 0, stockMeasured = 0;
    for (const order of orderRows) {
      if (order.status === "cancelled" || !order.delivery_date ||
        order.delivery_date < startDay) continue;
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
        !root.delivery_date || root.delivery_date < startDay) continue;
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
      o.status !== "cancelled" && o.created_at >= startInstant).length;
    return Response.json({
      shop: { id: shop.id, name: shop.customer_name, excludedTest: shop.is_test_customer },
      weeks, startDate: startDay, endDate: bangkokDate(new Date()),
      totalSales: Math.round(totalSales * 100) / 100, completedBills: billCount,
      averageBill: billCount ? Math.round(totalSales / billCount * 100) / 100 : null,
      billsPerWeek: Math.round(billCount / weeks * 10) / 10,
      buyingDays: days.length, averageGapDays, lastBilledAt, pendingOrders,
      activeWeeks: weeklySales.filter(row => row.bills > 0).length,
      shortPick: { percent: percent(shortPickHits, shortPickMeasured),
        affected: shortPickHits, measured: shortPickMeasured },
      shortStock: { percent: percent(stockHits, stockMeasured),
        affected: stockHits, measured: stockMeasured },
      dot: { percent: percent(dotOnTime, dotMeasured),
        onTime: dotOnTime, measured: dotMeasured },
      weeklySales, topProducts: top.map(({ billIds: _billIds, ...data }) =>
        ({ ...data, quantity: Math.round(data.quantity * 1000) / 1000 })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return salesApiError(error);
  }
}
