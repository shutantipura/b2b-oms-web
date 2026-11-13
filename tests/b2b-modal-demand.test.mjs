import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aggregateDemandDistribution,
  aggregateForecastByProduct,
  buildStockForecast,
  mostLikelyAggregateQty,
} from "../lib/stockForecast.ts";

const page = readFileSync(new URL("../app/stock-management/page.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/stock-forecast/route.ts", import.meta.url), "utf8");
const model = readFileSync(new URL("../lib/stockForecast.ts", import.meta.url), "utf8");

test("live customer forecast uses modal demand, never weighted mean", () => {
  const date = "2026-11-14";
  const now = new Date("2026-11-13T05:00:00Z");
  const orders = ["2026-11-01", "2026-11-04", "2026-11-07", "2026-11-10"].map((deliveryDate, i) => ({
    id: "o" + i, customerId: "c1", createdAt: deliveryDate + "T01:00:00Z",
    deliveryDate, status: "cancelled", groupRootOrderId: null,
  }));
  const items = orders.map((order) => ({
    orderId: order.id, sku: "000001234", productName: "หมูสด", unit: "กก.",
    category: "Fresh Meat", requestedQty: 10, actualQty: 0,
  }));
  const forecast = buildStockForecast(orders, items, [{ id: "c1", code: "C1", name: "Restaurant", isTest: false }], now);
  const row = forecast.rows.find((r) => r.sku === "000001234");
  assert.ok(row);
  for (const day of row.days) {
    const modal = aggregateDemandDistribution([{
      probability: day.projectedProbability ?? 0, quantity: day.possibleQty ?? 0,
      sizeOptions: day.possibleSizes,
    }]).mode;
    assert.equal(day.projectedQty, modal, "per-customer projectedQty must be mode on " + day.date);
    assert.equal(day.totalQty, Math.round((day.knownQty + modal) * 10) / 10,
      "confirmed demand plus modal additional demand on " + day.date);
  }
});

test("SKU mode is the mode of the sum, not the sum of customer modes", () => {
  const dates = ["2026-11-13", "2026-11-14", "2026-11-15"];
  const customers = ["A", "B"].map((id) => ({
    customerId: id, customerCode: id, customerName: id,
    sku: "000001234", productName: "หมูสด", unit: "กก.", freshMeat: true,
    yesterdayRequestedQty: 0, todayRequestedQty: 0,
    days: dates.map((date, i) => ({
      date, knownQty: i === 1 ? 10 : 0,
      projectedQty: 0, totalQty: i === 1 ? 10 : 0,
      projectedProbability: i === 1 ? 0.4 : 0,
      possibleQty: i === 1 ? 1 : 0,
    })),
  }));
  const [product] = aggregateForecastByProduct(customers, dates);
  const customerModeSum = customers.reduce((sum, customer) => sum + customer.days[1].projectedQty, 0);
  assert.equal(customerModeSum, 0);
  assert.equal(product.units[0].days[1].knownQty, 20);
  assert.equal(product.units[0].days[1].projectedQty, 1,
    "two 40% 1kg orders have a combined mode of 1 kg");
  assert.equal(product.units[0].days[1].totalQty, 21);
  assert.equal(aggregateDemandDistribution([
    { probability: 0.4, quantity: 1 }, { probability: 0.4, quantity: 1 },
  ]).expected, 0.8);
});

test("modal quantity considers conditional order size distribution, not just median", () => {
  const candidates = [
    { probability: 0.9, quantity: 10, sizeOptions: [
      { quantity: 10, weight: 1 }, { quantity: 30, weight: 4 },
    ] },
  ];
  assert.equal(aggregateDemandDistribution(candidates).mode, 30);
  assert.equal(mostLikelyAggregateQty(candidates), 30);
});

test("exactly equal outcome probabilities break ties toward less demand", () => {
  const result = aggregateDemandDistribution([{ probability: 0.5, quantity: 8 }]);
  assert.equal(result.mode, 0);
  assert.equal(result.expected, 4);
});

test("the live screen, daily summaries, and Excel show Mode rather than Mean", () => {
  assert.match(page, /ค่าที่มีโอกาสเกิดขึ้นมากที่สุด \(Mode\) ไม่ใช่ค่าเฉลี่ย \(Mean\)/);
  assert.match(page, /คาดความต้องการ B2B \(Mode\)/);
  assert.match(page, /คาดความต้องการ \(Mode\)/);
  assert.match(route, /พรุ่งนี้คาดรวม \(Mode\)/);
  assert.match(route, /พรุ่งนี้คาดเพิ่ม \(Mode\)/);
  assert.match(model, /day\.projectedQty = distribution\.mode/);
  assert.match(model, /const projectedQty = distribution\.mode/);
  assert.match(model, /projectedQty: distribution\.mode, totalQty: distribution\.mode/);
  assert.doesNotMatch(model, /projectedQty = distribution\.expected|projectedQty: distribution\.expected/);
});
