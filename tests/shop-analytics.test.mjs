import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildShopAnalytics, itemShortPick, itemStockShortage, slotEndAt } from "../lib/shopAnalytics.ts";

const order = (id, n, date, extra = {}) => ({
  id, order_number: n, status: "completed", created_at: date + "T01:00:00Z",
  delivery_date: date, delivery_slot: "10:00–12:00", final_amount: 1000,
  group_sequence: null, fulfillment_method: "delivery", ...extra,
});
const item = (order_id, name, extra = {}) => ({
  order_id, product_id: "p-" + name, product_name_snapshot: name, unit_snapshot: "kg",
  requested_qty: 5, confirmed_qty: 5, actual_qty: 5, actual_piece_qty: null,
  piece_price_per_kg_snapshot: null, ...extra,
});
const h = (order_id, from_status, to_status, created_at) => ({ order_id, from_status, to_status, created_at });

test("short pick follows KPI tolerance: 0.5 KG, exact for pieces, pieces for mixed units", () => {
  assert.equal(itemShortPick(item("o", "a", { actual_qty: 4.6 })), false);
  assert.equal(itemShortPick(item("o", "a", { actual_qty: 4.4 })), true);
  assert.equal(itemShortPick(item("o", "a", { unit_snapshot: "ชิ้น", actual_qty: 4.9 })), true);
  assert.equal(itemShortPick(item("o", "a", { piece_price_per_kg_snapshot: 90, actual_qty: 1, actual_piece_qty: 5 })), false);
  assert.equal(itemShortPick(item("o", "a", { piece_price_per_kg_snapshot: 90, actual_piece_qty: null })), null);
  assert.equal(itemShortPick(item("o", "a", { confirmed_qty: null })), null);
  assert.equal(itemStockShortage(item("o", "a", { confirmed_qty: 4.9 })), true);
});

test("slot end is read in Bangkok time", () => {
  assert.equal(slotEndAt("2026-11-16", "10:00–12:00").toISOString(), "2026-11-16T05:00:00.000Z");
  assert.equal(slotEndAt("2026-11-16", "ด่วน"), null);
});

test("builds frequency, basket, DOT, payment and product stats for one shop", () => {
  const orders = [
    order("a", 1, "2026-11-02"),
    order("b", 2, "2026-11-09", { final_amount: 2000 }),
    order("b2", 3, "2026-11-09", { group_sequence: 2, final_amount: 999 }),
    order("c", 4, "2026-11-16", { status: "cancelled" }),
  ];
  const items = [
    item("a", "Pork"), item("a", "Rice"),
    item("b", "Pork", { actual_qty: 3 }), item("b2", "Egg", { unit_snapshot: "ฟอง", confirmed_qty: 8, requested_qty: 10, actual_qty: 8 }),
    item("c", "Cancelled item"),
  ];
  const history = [
    h("a", "picking", "awaiting_billing", "2026-11-02T01:00:00Z"),
    h("a", "out_for_delivery", "awaiting_payment", "2026-11-02T04:00:00Z"),
    h("a", "payment_submitted", "completed", "2026-11-02T10:00:00Z"),
    h("b", "picking", "awaiting_billing", "2026-11-09T01:00:00Z"),
    h("b", "out_for_delivery", "awaiting_payment", "2026-11-09T06:00:00Z"),
    h("b2", "picking", "awaiting_billing", "2026-11-09T01:00:00Z"),
  ];
  const a = buildShopAnalytics(orders, items, history, new Date("2026-11-16T08:00:00Z"), "2026-11-16");
  assert.equal(a.orderCount, 3);
  assert.equal(a.cancelledCount, 1);
  assert.equal(a.avgDaysBetweenOrders, 7);
  assert.equal(a.ordersPerWeek, 1);
  assert.equal(a.daysSinceLastOrder, 7);
  assert.equal(a.avgBasketAmount, 1500); // group child /2 is not a separate bill
  assert.deepEqual(a.shortPick, { hit: 1, measured: 3, rate: 1 / 3 });
  assert.deepEqual(a.stockShortage, { hit: 2, measured: 3, rate: 2 / 3 });
  // a on time; b delivered after 12:00; b2 not delivered and slot passed
  assert.deepEqual(a.deliveryOnTime, { hit: 1, measured: 3, rate: 1 / 3 });
  assert.equal(a.paymentOnTime.hit, 1);
  assert.equal(a.topProducts[0].name, "Pork");
  assert.equal(a.topProducts[0].orderCount, 2);
  assert.equal(a.topProducts[0].totalQty, 8);
  assert.deepEqual(a.shortedProducts.map(p => p.name), ["Egg", "Pork"]);
  assert.equal(a.weekdayCounts[1], 2); // both delivery dates are Mondays
  assert.ok(!a.topProducts.some(p => p.name === "Cancelled item"));
});

test("shops list links each shop to its analytics page; API is Manager/Salesman only", () => {
  const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
  assert.match(read("app/customers/shops/page.tsx"), /href=\{`\/customers\/shops\/\$\{shop\.id\}\/analytics`\}/);
  assert.match(read("app/customers/shops/page.tsx"), /ดูข้อมูลวิเคราะห์/);
  assert.match(read("app/api/customer-registry/shops/analytics/route.ts"), /requireSalesRole\(request, \["manager","salesman"\]\)/);
});
