import test from "node:test";
import assert from "node:assert/strict";
import {
  extendForecastForExpiry,
  FRESH_MEAT_SHELF_LIFE_DAYS,
  MAX_SHORTAGE_PROBABILITY,
  optimizeFreshMeatSku,
} from "../lib/stockOrderOptimizer.ts";

const start = "2026-11-07";

function row(demands, confidence = "high") {
  return {
    customerId: "customer-a", sku: "000000001", productName: "Fresh meat", unit: "กก.", freshMeat: true,
    customerCode: "a", customerName: "Example", confidence, customerCadenceDays: 1, skuCadenceDays: 1,
    effectiveCadenceDays: 1, purchaseDays: 10, conditionalUnitShare: 1, customerUsualOrderOffsetMinutes: 0,
    customerOrderTimingSamples: 10, yesterdayRequestedQty: 0, todayRequestedQty: 0,
    days: [{ date: start, knownQty: 0, projectedQty: 0, totalQty: 0 },
      ...demands.map(({ known = 0, probability = 0, quantity = 0 }, index) => ({
        date: `2026-11-${String(8 + index).padStart(2, "0")}`,
        knownQty: known, projectedQty: probability * quantity, totalQty: known + probability * quantity,
        projectedProbability: probability, possibleQty: quantity,
      }))],
  };
}

test("three-day expiry and 5% shortage are fixed per SKU", () => {
  assert.equal(FRESH_MEAT_SHELF_LIFE_DAYS, 3);
  assert.equal(MAX_SHORTAGE_PROBABILITY, 0.05);
});

test("known meat demand is ordered; FIFO consumes the batch before expiry", () => {
  const result = optimizeFreshMeatSku("000000001", "Fresh meat", [row([
    { known: 3 }, { known: 2 }, { known: 1 },
  ])], { price: 30, cost: 20 }, "2026-11-08", 1024);
  assert.equal(result.status, "estimated");
  assert.equal(result.recommendedOrderKg, 3);
  assert.equal(result.shortageProbabilityPct, 0);
  assert.equal(result.expiryProbabilityPct, 0);
  assert.equal(result.expectedExpiredKg, 0);
});

test("highly intermittent demand keeps 5% availability even if spoilage is costly", () => {
  const result = optimizeFreshMeatSku("000000001", "Fresh meat", [row([
    { probability: 0.1, quantity: 5 }, {}, {},
  ])], { price: 60, cost: 40 }, "2026-11-08", 4096);
  assert.equal(result.recommendedOrderKg, 5);
  assert.ok(result.shortageProbabilityPct <= 5);
  assert.ok(result.expiryProbabilityPct > 80);
  assert.ok(result.expectedExpiredKg > 4);
});

test("lost gross margin can justify an order above the minimum 95th percentile", () => {
  const first = row([{ probability: 0.06, quantity: 5 }, {}, {}]);
  const second = { ...row([{ probability: 0.06, quantity: 5 }, {}, {}]), customerId: "customer-b" };
  const scarceMargin = optimizeFreshMeatSku("000000001", "Fresh meat", [first, second],
    { price: 6, cost: 5 }, "2026-11-08", 8192);
  const valuableMargin = optimizeFreshMeatSku("000000001", "Fresh meat", [first, second],
    { price: 2000, cost: 5 }, "2026-11-08", 8192);
  assert.ok((scarceMargin.recommendedOrderKg ?? 0) >= 5);
  assert.ok((valuableMargin.recommendedOrderKg ?? 0) > (scarceMargin.recommendedOrderKg ?? 0));
  assert.ok((valuableMargin.shortageProbabilityPct ?? 100) <= 5);
});

test("master-list price and cost are required for a monetary order recommendation", () => {
  const result = optimizeFreshMeatSku("000000001", "Fresh meat", [row([
    { known: 1 }, {}, {},
  ])], { price: 25, cost: null }, "2026-11-08", 1024);
  assert.equal(result.status, "missing_price_or_cost");
  assert.equal(result.recommendedOrderKg, null);
  assert.equal(result.expectedFinancialLossBaht, null);
});

test("no expiry probability is invented without three complete future days", () => {
  const result = optimizeFreshMeatSku("000000001", "Fresh meat", [row([
    { known: 1 }, {},
  ])], { price: 25, cost: 10 }, "2026-11-08", 1024);
  assert.equal(result.status, "missing_three_day_forecast");
  assert.equal(result.recommendedOrderKg, null);
});

test("simulated probabilities and recommended order do not change on refresh", () => {
  const input = [row([
    { probability: 0.32, quantity: 4 },
    { probability: 0.32, quantity: 4 },
    { probability: 0.32, quantity: 4 },
  ], "low")];
  const first = optimizeFreshMeatSku("000000001", "Fresh meat", input, { price: 20, cost: 10 }, "2026-11-08", 2048);
  const again = optimizeFreshMeatSku("000000001", "Fresh meat", input, { price: 20, cost: 10 }, "2026-11-08", 2048);
  assert.deepEqual(first, again);
  assert.equal(first.confidence, "limited");
  assert.ok((first.shortageProbabilityPct ?? 100) <= 5);
});

test("expiry extension cannot alter the official first three forecast days", () => {
  const originalRow = row([{ known: 2 }, { known: 3 }]);
  const extendedRow = row([{ known: 20 }, { known: 30 }, { known: 4 }]);
  const original = { dates: ["2026-11-07", "2026-11-08", "2026-11-09"], rows: [originalRow] };
  const extension = { dates: [...original.dates, "2026-11-10"], rows: [extendedRow] };
  const merged = extendForecastForExpiry(original, extension);
  assert.deepEqual(merged.rows[0].days.slice(0, 3), originalRow.days);
  assert.equal(merged.rows[0].days[3].knownQty, 4);
  assert.equal(merged.dates[3], "2026-11-10");
});
