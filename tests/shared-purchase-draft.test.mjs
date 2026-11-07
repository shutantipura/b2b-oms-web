import test from "node:test";
import assert from "node:assert/strict";
import { sharedPurchaseDraft } from "../lib/sharedStockPurchaseDraft.ts";

const input = { sku: "000123456", productName: "Pork", b2bTodayMeanKg: 20,
  b2bTomorrowMeanKg: 60, b2bDayAfterMeanKg: 55, b2bConfirmedTomorrowKg: 50,
  b2cTodayMeanKg: 10, b2cTomorrowMeanKg: 20, b2cDayAfterMeanKg: 15, morningOnHandKg: 35 };

test("two-day DOH target uses two date-specific forecasts and subtracts projected remaining stock", () => {
  const result = sharedPurchaseDraft(input);
  assert.equal(result.usableStockTomorrowKg, 5);
  assert.equal(result.expectedDemandTomorrowKg, 80);
  assert.equal(result.targetStockKg, 150);
  assert.equal(result.orderKg, 145);
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

test("confirmed B2B orders cannot fall below the planning target", () => {
  const result = sharedPurchaseDraft({ ...input, b2bTomorrowMeanKg: 30, b2bConfirmedTomorrowKg: 80 });
  assert.equal(result.expectedDemandTomorrowKg, 100);
  assert.equal(result.targetStockKg, 170);
});
