import assert from "node:assert/strict";
import test from "node:test";
import { parseCalendarHeader, parseB2CDailySheet, weekdayLabel, dailyWeekdayBaseline } from "../lib/sharedStockInputs.ts";

test("date headers support different months, Excel serials and day-first Power BI headers", () => {
  assert.equal(parseCalendarHeader("15/09/2026"), "2026-09-15");
  assert.equal(parseCalendarHeader("10/14/2026", "MDY"), "2026-10-14");
  assert.equal(parseCalendarHeader("2026-11-07"), "2026-11-07");
  assert.equal(parseCalendarHeader(46302), "2026-10-07");
  assert.equal(parseCalendarHeader("31/02/2026"), null);
  assert.equal(weekdayLabel("2026-11-07"), "เสาร์");
});

test("Power BI month-first dates are detected across October and November", () => {
  const dates = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 9, 14 + index));
    return `${day.getUTCMonth() + 1}/${day.getUTCDate()}/${day.getUTCFullYear()}`;
  });
  const parsed = parseB2CDailySheet([["SKU", ...dates], [123, ...dates.map(() => "")]], true);
  assert.equal(parsed?.errors.length, 0);
  assert.equal(parsed?.dates[0], "2026-10-14");
  assert.equal(parsed?.dates.at(-1), "2026-11-12");
  assert.equal(parsed?.rows[0].quantities[0], 0);
});

test("SKU by date matrix accepts arbitrary consecutive dates and preserves zero vs missing", () => {
  const dates = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, 26 + i));
    return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
  });
  const sheet = parseB2CDailySheet([
    ["Item Code", "Item Name", "Unit", ...dates],
    [123, "Pork", "kg", ...dates.map((_, index) => index === 1 ? "" : index === 2 ? 0 : 10)],
  ]);
  assert.ok(sheet);
  assert.equal(sheet.errors.length, 0);
  assert.equal(sheet.dates[0], "2026-09-26");
  assert.equal(sheet.dates.at(-1), "2026-10-09");
  assert.equal(sheet.rows[0].sku, "000000123");
  assert.equal(sheet.rows[0].quantities[1], null);
  assert.equal(sheet.rows[0].quantities[2], 0);
});

test("weekday baseline shrinks small groups toward overall observed mean", () => {
  const dates = Array.from({ length: 14 }, (_, index) => new Date(Date.UTC(2026, 9, index + 1)).toISOString().slice(0, 10));
  const quantities = dates.map((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 6 ? 50 : 10);
  const saturday = dailyWeekdayBaseline(dates, quantities, "2026-11-07");
  const monday = dailyWeekdayBaseline(dates, quantities, "2026-11-09");
  assert.ok(saturday > monday);
  assert.ok(saturday < 50);
  assert.ok(monday > 10);
  assert.equal(dailyWeekdayBaseline(dates, dates.map(() => null), "2026-11-07"), null);
});

test("missing dates, duplicate SKUs and invalid quantities block daily import", () => {
  const dates = Array.from({ length: 7 }, (_, index) => `2026-10-${String(index + 1).padStart(2,"0")}`);
  const gap = parseB2CDailySheet([["SKU", ...dates.slice(0, 3), "2026-10-05", ...dates.slice(4)], ["123", 1, 1, 1, 1, 1, 1, 1]]);
  assert.ok(gap?.errors.some((issue) => issue.includes("ต่อเนื่อง")));
  const invalid = parseB2CDailySheet([["SKU", ...dates], ["123", 1, 1, 1, 1, 1, 1, -2], ["123", 1, 1, 1, 1, 1, 1, 1]]);
  assert.ok(invalid?.errors.length);
});
