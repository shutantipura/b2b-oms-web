// Per-shop analytics for Manager/Salesman. Pure functions so the rules are testable.
// Short pick, stock-check shortage, DOT and payment rules mirror
// public.get_operational_kpi_orders so a shop's numbers match the KPI page.

import { paymentDueAt } from "./shopWarnings.ts";

export type AnalyticsOrder = {
  id: string;
  order_number: number;
  status: string;
  created_at: string;
  delivery_date: string | null;
  delivery_slot: string | null;
  final_amount: number | string | null;
  group_sequence: number | null;
  fulfillment_method: string | null;
};

export type AnalyticsItem = {
  order_id: string;
  product_id: string | null;
  product_name_snapshot: string | null;
  unit_snapshot: string | null;
  requested_qty: number | string | null;
  confirmed_qty: number | string | null;
  actual_qty: number | string | null;
  actual_piece_qty: number | string | null;
  piece_price_per_kg_snapshot: number | string | null;
};

export type AnalyticsHistory = {
  order_id: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
};

export type Rate = { hit: number; measured: number; rate: number | null };

export type ProductStat = {
  key: string;
  name: string;
  unit: string;
  orderCount: number;
  totalQty: number;
  shortCount: number;
  lastDeliveryDate: string | null;
};

export type ShopAnalytics = {
  orderCount: number;
  cancelledCount: number;
  firstDeliveryDate: string | null;
  lastDeliveryDate: string | null;
  daysSinceLastOrder: number | null;
  ordersPerWeek: number | null;
  avgDaysBetweenOrders: number | null;
  avgBasketAmount: number | null;
  billedOrderCount: number;
  totalBilledAmount: number;
  avgLinesPerOrder: number | null;
  shortPick: Rate;
  stockShortage: Rate;
  deliveryOnTime: Rate;
  paymentOnTime: Rate;
  topProducts: ProductStat[];
  shortedProducts: ProductStat[];
  weekdayCounts: number[]; // Sunday..Saturday by delivery date
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isKg = (unit: string) => unit.toLowerCase().includes("kg") || unit.includes("กก");

// null = not measurable, mirroring the KPI SQL.
export function itemShortPick(item: AnalyticsItem): boolean | null {
  const confirmed = num(item.confirmed_qty);
  if (confirmed === null) return null;
  if (item.piece_price_per_kg_snapshot !== null && item.piece_price_per_kg_snapshot !== undefined) {
    const pieces = num(item.actual_piece_qty);
    return pieces === null ? null : pieces < confirmed;
  }
  const actual = num(item.actual_qty);
  if (actual === null) return null;
  return isKg(item.unit_snapshot ?? "") ? actual < confirmed - 0.5 : actual < confirmed;
}

export function itemStockShortage(item: AnalyticsItem): boolean | null {
  const confirmed = num(item.confirmed_qty), requested = num(item.requested_qty);
  if (confirmed === null || requested === null) return null;
  return confirmed < requested;
}

// bool_or semantics: any true -> true; else any null -> null; else false.
function rollup(values: (boolean | null)[]): boolean | null {
  if (!values.length) return null;
  if (values.some(v => v === true)) return true;
  if (values.some(v => v === null)) return null;
  return false;
}

export function slotEndAt(deliveryDate: string | null, slot: string | null): Date | null {
  if (!deliveryDate || !slot) return null;
  const end = /([0-2][0-9]):([0-5][0-9])\s*$/.exec(slot);
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deliveryDate);
  if (!end || !date) return null;
  const [, y, m, d] = date.map(Number);
  return new Date(Date.UTC(y, m - 1, d, Number(end[1]) - 7, Number(end[2])));
}

const rate = (hit: number, measured: number): Rate =>
  ({ hit, measured, rate: measured ? hit / measured : null });

const DAY = 86_400_000;
const dayNumber = (date: string) => Math.floor(Date.parse(date + "T00:00:00Z") / DAY);

export function buildShopAnalytics(
  orders: AnalyticsOrder[],
  items: AnalyticsItem[],
  history: AnalyticsHistory[],
  now = new Date(),
  todayBangkok = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10),
): ShopAnalytics {
  const active = orders.filter(o => o.status !== "cancelled");
  const activeIds = new Set(active.map(o => o.id));
  const itemsByOrder = new Map<string, AnalyticsItem[]>();
  for (const item of items) {
    if (!activeIds.has(item.order_id)) continue;
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  const firstEvent = (orderId: string, match: (h: AnalyticsHistory) => boolean) => {
    let best: number | null = null;
    for (const h of historyByOrder.get(orderId) ?? []) {
      if (!match(h)) continue;
      const t = Date.parse(h.created_at);
      if (Number.isFinite(t) && (best === null || t < best)) best = t;
    }
    return best;
  };
  const historyByOrder = new Map<string, AnalyticsHistory[]>();
  for (const h of history) {
    const list = historyByOrder.get(h.order_id) ?? [];
    list.push(h);
    historyByOrder.set(h.order_id, list);
  }

  let shortHit = 0, shortMeasured = 0, stockHit = 0, stockMeasured = 0;
  let dotHit = 0, dotMeasured = 0, payHit = 0, payMeasured = 0;
  const products = new Map<string, ProductStat>();
  let lineTotal = 0;

  for (const order of active) {
    const orderItems = itemsByOrder.get(order.id) ?? [];
    lineTotal += orderItems.length;

    const pickedAt = firstEvent(order.id, h => h.to_status === "awaiting_billing");
    if (pickedAt !== null) {
      const sp = rollup(orderItems.map(itemShortPick));
      const ss = rollup(orderItems.map(itemStockShortage));
      const shortage = sp === true || ss === true ? true : sp === null || ss === null ? null : false;
      if (sp !== null) { shortMeasured++; if (sp) shortHit++; }
      if (shortage !== null) { stockMeasured++; if (shortage) stockHit++; }
    }

    const due = slotEndAt(order.delivery_date, order.delivery_slot);
    if (due) {
      const deliveredAt = firstEvent(order.id,
        h => h.from_status === "out_for_delivery" && h.to_status === "awaiting_payment");
      if (deliveredAt !== null) { dotMeasured++; if (deliveredAt <= due.getTime()) dotHit++; }
      else if (now.getTime() > due.getTime()) dotMeasured++;
    }

    const payDue = order.delivery_date ? paymentDueAt(order.delivery_date) : null;
    if (payDue) {
      const paidAt = firstEvent(order.id,
        h => h.from_status === "payment_submitted" && h.to_status === "completed");
      if (paidAt !== null) { payMeasured++; if (paidAt <= payDue.getTime()) payHit++; }
      else if (now.getTime() > payDue.getTime()) payMeasured++;
    }

    for (const item of orderItems) {
      const name = item.product_name_snapshot?.trim() || "ไม่ระบุสินค้า";
      const key = item.product_id ?? "name:" + name;
      const stat = products.get(key) ?? {
        key, name, unit: item.unit_snapshot ?? "", orderCount: 0, totalQty: 0,
        shortCount: 0, lastDeliveryDate: null,
      };
      stat.orderCount++;
      stat.totalQty += num(item.actual_qty) ?? num(item.confirmed_qty) ?? num(item.requested_qty) ?? 0;
      if (itemShortPick(item) === true || itemStockShortage(item) === true) stat.shortCount++;
      if (order.delivery_date && (!stat.lastDeliveryDate || order.delivery_date > stat.lastDeliveryDate))
        stat.lastDeliveryDate = order.delivery_date;
      products.set(key, stat);
    }
  }

  // Frequency is by distinct delivery dates; grouped add-on orders share a date.
  const dates = [...new Set(active.map(o => o.delivery_date).filter((d): d is string => !!d))].sort();
  const first = dates[0] ?? null, last = dates.at(-1) ?? null;
  const pastDates = dates.filter(d => d <= todayBangkok);
  const lastPast = pastDates.at(-1) ?? null;
  const spanDays = first && last ? dayNumber(last) - dayNumber(first) : 0;
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dates) weekdayCounts[new Date(d + "T00:00:00Z").getUTCDay()]++;

  // Basket: one bill per group (main /1 order), only billed amounts.
  let billedSatang = 0, billedCount = 0;
  for (const o of active) {
    if (o.group_sequence !== null && Number(o.group_sequence) !== 1) continue;
    const amount = num(o.final_amount);
    if (amount === null || amount <= 0) continue;
    billedSatang += Math.round(amount * 100);
    billedCount++;
  }

  const productList = [...products.values()];
  return {
    orderCount: active.length,
    cancelledCount: orders.length - active.length,
    firstDeliveryDate: first,
    lastDeliveryDate: last,
    daysSinceLastOrder: lastPast ? dayNumber(todayBangkok) - dayNumber(lastPast) : null,
    ordersPerWeek: dates.length >= 2 && spanDays > 0 ? (dates.length - 1) / (spanDays / 7) : null,
    avgDaysBetweenOrders: dates.length >= 2 ? spanDays / (dates.length - 1) : null,
    avgBasketAmount: billedCount ? billedSatang / billedCount / 100 : null,
    billedOrderCount: billedCount,
    totalBilledAmount: billedSatang / 100,
    avgLinesPerOrder: active.length ? lineTotal / active.length : null,
    shortPick: rate(shortHit, shortMeasured),
    stockShortage: rate(stockHit, stockMeasured),
    deliveryOnTime: rate(dotHit, dotMeasured),
    paymentOnTime: rate(payHit, payMeasured),
    topProducts: [...productList]
      .sort((a, b) => b.orderCount - a.orderCount || b.totalQty - a.totalQty || a.name.localeCompare(b.name))
      .slice(0, 10),
    shortedProducts: productList.filter(p => p.shortCount > 0)
      .sort((a, b) => b.shortCount - a.shortCount || a.name.localeCompare(b.name))
      .slice(0, 5),
    weekdayCounts,
  };
}
