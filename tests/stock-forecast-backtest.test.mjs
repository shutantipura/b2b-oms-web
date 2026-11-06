import test from "node:test";
import assert from "node:assert/strict";
import { backtestStockForecast, BACKTEST_CUTOFF_HOUR } from "../lib/stockForecastBacktest.ts";

const customers = [
  { id: "restaurant", code: "001", name: "Restaurant", isTest: false },
  { id: "test", code: "002", name: "Test", isTest: true },
];

function order(id, deliveryDate, createdAt, customerId = "restaurant", status = "completed") {
  return { id, customerId, deliveryDate, createdAt, status, groupRootOrderId: null };
}

function item(orderId, sku, quantity, unit = "กก.") {
  return {
    orderId, sku, requestedQty: quantity, unit,
    productName: sku, category: "Dry Goods",
  };
}

const asOf = new Date("2026-11-06T05:00:00Z"); // 12:00 in Bangkok
const priorOrders = [
  order("h0", "2026-10-19", "2026-10-18T10:00:00+07:00"),
  order("h1", "2026-10-22", "2026-10-21T10:00:00+07:00"),
  order("h2", "2026-10-25", "2026-10-24T10:00:00+07:00"),
  order("h3", "2026-10-28", "2026-10-27T10:00:00+07:00"),
  order("h4", "2026-10-31", "2026-10-30T10:00:00+07:00"),
  order("h5", "2026-11-03", "2026-11-02T10:00:00+07:00"),
];
const priorItems = priorOrders.map(({ id }) => item(id, "pork", 5));

test("backtest replays historical forecasts at 16:00 previous day, without looking at late orders", () => {
  const early = order("early", "2026-11-05", "2026-11-04T15:00:00+07:00");
  const late = order("late", "2026-11-05", "2026-11-05T08:00:00+07:00");
  const earlyOnly = backtestStockForecast(
    [...priorOrders, early], [...priorItems, item("early", "pork", 4)], customers, asOf
  );
  const withLate = backtestStockForecast(
    [...priorOrders, early, late], [...priorItems, item("early", "pork", 4), item("late", "pork", 2)], customers, asOf
  );
  const before = earlyOnly.days.find((day) => day.deliveryDate === "2026-11-05" && day.unit === "กก.");
  const after = withLate.days.find((day) => day.deliveryDate === "2026-11-05" && day.unit === "กก.");
  assert.ok(before && after);
  assert.equal(BACKTEST_CUTOFF_HOUR, 16);
  assert.equal(after.cutoffAt, "2026-11-04T09:00:00.000Z");
  assert.equal(after.bookedOnlyQty, 4);
  assert.equal(before.forecastQty, after.forecastQty);
  assert.equal(after.actualQty, before.actualQty + 2);
});

test("requested quantities are scored by delivery date, excluding tests and cancellations", () => {
  const live = order("live", "2026-11-05", "2026-11-04T12:00:00+07:00");
  const cancelled = order("cancelled", "2026-11-05", "2026-11-04T11:00:00+07:00", "restaurant", "cancelled");
  const testing = order("testorder", "2026-11-05", "2026-11-04T10:00:00+07:00", "test");
  const report = backtestStockForecast(
    [...priorOrders, live, cancelled, testing],
    [...priorItems, item("live", "rice", 7, "ชิ้น"), item("cancelled", "rice", 100, "ชิ้น"), item("testorder", "rice", 200, "ชิ้น")],
    customers, asOf
  );
  const day = report.days.find((row) => row.deliveryDate === "2026-11-05" && row.unit === "ชิ้น");
  assert.ok(day);
  assert.equal(day.actualQty, 7);
  assert.equal(day.bookedOnlyQty, 7);
  assert.equal(report.byUnit.find((unit) => unit.unit === "ชิ้น")?.actualQty, 7);
  assert.ok(report.byUnit.some((unit) => unit.unit === "กก."));
  assert.ok(report.byUnit.every((unit) => unit.modelWape === null || unit.modelWape >= 0));
});

test("days with insufficient prior history are skipped, and score types remain valid", () => {
  const shortOrders = [
    order("a", "2026-11-02", "2026-11-01T10:00:00+07:00"),
    order("b", "2026-11-05", "2026-11-04T10:00:00+07:00"),
  ];
  const report = backtestStockForecast(shortOrders, shortOrders.map((row) => item(row.id, "pork", 3)), customers, asOf);
  assert.equal(report.evaluatedDays, 0);
  assert.equal(report.byUnit.length, 0);
  assert.equal(report.skuOccurrenceBrier, null);
  assert.ok(report.limitations.length >= 2);
});
