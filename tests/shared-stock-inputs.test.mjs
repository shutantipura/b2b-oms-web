import test from "node:test";
import assert from "node:assert/strict";
import { b2cDailyMean, normalizeStockSku, parseB2CSales30DaySheet, validateSalesPeriod } from "../lib/sharedStockInputs.ts";

test("30-day sales import keeps exact zeroes, pads SKUs and detects duplicate rows", () => {
  const result = parseB2CSales30DaySheet([
    ["SKU", "Item Name", "B2C Sales (30 days)", "Unit"],
    [123, "Pork", 360, "kg"],
    [456, "Pork neck", 0, "กก."],
    ["000000123", "Duplicate", 50, "kg"],
  ]);
  assert.equal(result.rows[0].sku, "000000123");
  assert.equal(result.rows[0].soldQty, 360);
  assert.equal(result.rows[0].unit, "กก.");
  assert.equal(result.rows[1].soldQty, 0);
  assert.equal(result.errors.length, 1);
});

test("missing sale is not treated as a zero sale", () => {
  assert.equal(b2cDailyMean(null), null);
  assert.equal(b2cDailyMean(0), 0);
  assert.equal(b2cDailyMean(450), 15);
});

test("a B2C report date range must cover exactly 30 calendar days", () => {
  assert.equal(validateSalesPeriod("2026-10-09", "2026-11-07"), true);
  assert.equal(validateSalesPeriod("2026-10-08", "2026-11-07"), false);
  assert.equal(validateSalesPeriod("2026-02-29", "2026-03-30"), false);
});

test("reject incorrect item codes and malformed or negative quantities", () => {
  assert.equal(normalizeStockSku("AB123"), null);
  const result = parseB2CSales30DaySheet([
    ["รหัสสินค้า", "ยอดขาย30วัน"],
    ["ABC", 10],
    [123, -3],
    [456, "2.1234"],
  ]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 3);
});
