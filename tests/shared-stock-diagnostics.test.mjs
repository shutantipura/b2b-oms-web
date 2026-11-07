import test from "node:test";
import assert from "node:assert/strict";
import { analyseDailyDemand, inventoryDiagnostics, salesScopeIsUsable, inventoryFinancialExposure } from "../lib/sharedStockDiagnostics.ts";

const dates = Array.from({ length: 28 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));

test("zero sales on a zero-stock morning do not artificially reduce the baseline", () => {
  const observations = dates.map(() => 10);
  observations[3] = 0;
  const result = analyseDailyDemand(dates, observations, new Set([dates[3]]));
  assert.equal(result.suspectedCensoredDays, 1);
  assert.equal(result.adjustedQuantities[3], null);
  assert.equal(result.sampleDays, 27);
  assert.equal(result.pattern, "regular");
});

test("slow and variable SKUs are flagged with enough observations", () => {
  assert.equal(analyseDailyDemand(dates, dates.map((_, i) => i % 7 === 0 ? 20 : 0)).pattern, "slow");
  assert.equal(analyseDailyDemand(dates, dates.map((_, i) => i % 3 === 0 ? 50 : 1)).pattern, "volatile");
  assert.equal(analyseDailyDemand(dates.slice(0, 10), Array(10).fill(3)).pattern, "limited");
});

test("DOH warnings identify excess and pre-order coverage gaps without calling them probabilities", () => {
  const excess = inventoryDiagnostics({ usableStockTomorrowKg: 100, expectedDemandTomorrowKg: 15, dayAfterDemandKg: 15, orderKg: 0 });
  assert.equal(excess.status, "excess");
  assert.equal(excess.preOrderDoh, 6.7);
  const gap = inventoryDiagnostics({ usableStockTomorrowKg: 5, expectedDemandTomorrowKg: 20, dayAfterDemandKg: 20, orderKg: 35 });
  assert.equal(gap.status, "cover_gap");
  assert.equal(gap.projectedDoh, 2);
});

test("unverified and all-store sales cannot be silently treated as B2C-only", () => {
  assert.equal(salesScopeIsUsable("b2c_only"), true);
  assert.equal(salesScopeIsUsable("unverified"), false);
  assert.equal(salesScopeIsUsable("all_store"), false);
});

test("financial exposure respects missing prices and never presents a predicted loss", () => {
  const excess = inventoryFinancialExposure({ usableStockTomorrowKg: 50, targetStockKg: 30, expectedDemandTomorrowKg: 12,
    costBahtPerKg: 100, priceBahtPerKg: 140 });
  assert.equal(excess.excessInventoryValueBaht, 2000);
  assert.equal(excess.potentialUncoveredGrossProfitBaht, 0);
  const missing = inventoryFinancialExposure({ usableStockTomorrowKg: 4, targetStockKg: 30, expectedDemandTomorrowKg: 12,
    costBahtPerKg: null, priceBahtPerKg: 140 });
  assert.equal(missing.excessInventoryValueBaht, null);
  assert.equal(missing.potentialUncoveredGrossProfitBaht, null);
});
