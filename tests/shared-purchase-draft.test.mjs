import test from "node:test";
import assert from "node:assert/strict";
import { sharedPurchaseDraft } from "../lib/sharedStockPurchaseDraft.ts";

const input = { sku: "000123456", productName: "Pork", b2bTodayMeanKg: 20,
  b2bTomorrowP90Kg: 60, b2cTodayMeanKg: 10, b2cTomorrowMeanKg: 20, morningOnHandKg: 35 };

test("shared working estimate preserves today's demand and subtracts expected available stock", () => {
  const result = sharedPurchaseDraft(input);
  assert.equal(result.usableStockTomorrowKg, 5);
  assert.equal(result.expectedDemandTomorrowKg, 80);
  assert.equal(result.orderKg, 75);
  assert.ok(!("shortageProbabilityPct" in result));
});

test("missing data stays unavailable rather than zero", () => {
  const missingRetail = sharedPurchaseDraft({ ...input, b2cTomorrowMeanKg: null });
  assert.equal(missingRetail.orderKg, null);
  assert.ok(missingRetail.missing.includes("b2c_history"));
  const missingStock = sharedPurchaseDraft({ ...input, morningOnHandKg: null });
  assert.equal(missingStock.orderKg, null);
  assert.ok(missingStock.missing.includes("morning_stock"));
});

test("working estimate never suggests a negative order", () => {
  assert.equal(sharedPurchaseDraft({ ...input, morningOnHandKg: 1000 }).orderKg, 0);
});
