import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateStockSales,
  bangkokDateKey,
  normalizeSalesUnit,
  stockReportDates,
} from "../lib/stockSalesReport.ts";

test("last 14 Bangkok calendar dates include today and handle UTC rollover", () => {
  const dates = stockReportDates(new Date("2026-11-03T18:00:00Z"));
  assert.equal(dates.length, 14);
  assert.equal(dates[0], "2026-10-22");
  assert.equal(dates.at(-1), "2026-11-04");
  assert.equal(bangkokDateKey("2026-11-03T18:00:00Z"), "2026-11-04");
});

test("sales aggregate by customer, SKU, unit and billing day, not by product name", () => {
  const dates = ["2026-11-03", "2026-11-04"];
  const original = {
    customerId: "customer-1", customerCode: "0000000001", customerName: "ร้าน ก",
    sku: "000000123", productName: "เนื้อ A", unit: "กก.", billingDate: "2026-11-03",
  };
  const rows = aggregateStockSales([
    { ...original, quantity: 1.25 },
    { ...original, productName: "เนื้อ A ชื่อใหม่", quantity: 0.5 },
    { ...original, billingDate: "2026-11-04", quantity: 2 },
    { ...original, unit: "ชิ้น", quantity: 3 },
    { ...original, customerId: "customer-2", customerCode: "0000000002", quantity: 4 },
    { ...original, billingDate: "2026-11-02", quantity: 99 },
    { ...original, quantity: 0 },
  ], dates);
  assert.equal(rows.length, 3);
  const primary = rows.find((row) => row.customerCode === "0000000001" && row.unit === "กก.");
  assert.deepEqual(primary?.dailyQuantities, [1.75, 2]);
  assert.equal(primary?.totalQuantity, 3.75);
  assert.equal(primary?.sku, "000000123");
  assert.deepEqual(rows.find((row) => row.unit === "ชิ้น")?.dailyQuantities, [3, 0]);
});

test("weighted piece-priced items are reported as kilograms", () => {
  assert.equal(normalizeSalesUnit("ชิ้น", true), "กก.");
  assert.equal(normalizeSalesUnit("kg", false), "กก.");
  assert.equal(normalizeSalesUnit("แพ็ค", false), "แพ็ค");
});
