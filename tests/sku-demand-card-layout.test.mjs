import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/stock-management/page.tsx", import.meta.url), "utf8");
const product = page.slice(page.indexOf('{visibleProducts.map((product) =>'), page.indexOf('<details className="group border-t', page.indexOf('{visibleProducts.map((product) =>')));
const timeline = page.slice(page.indexOf("function DemandTimeline("), page.indexOf("export default function StockManagementPage()"));

test("SKU and customer use the same grouped six-point demand timeline", () => {
  assert.match(product, /<DemandTimeline forecast=\{forecast\} data=\{product\.unit\} unit=\{product\.unitName\} \/>/);
  assert.match(page, /<DemandTimeline forecast=\{forecast\} data=\{customer\} unit=\{product\.unitName\} \/>/);
  assert.match(timeline, /grid grid-cols-3/);
  assert.match(timeline, /grid grid-cols-1 gap-1\.5 md:grid-cols-2/);
  assert.doesNotMatch(product, /grid-cols-4 gap-1\.5/);
  assert.doesNotMatch(product, /<SmallMetric/);
});

test("SKU timeline correctly uses past actuals, today's requested/total, and 2 future modal values", () => {
  for (const field of [
    "data.twoDaysAgoRequestedQty",
    "data.yesterdayRequestedQty",
    "data.todayRequestedQty",
    "data.days[0]?.totalQty",
    "data.days[1]?.totalQty",
    "data.days[2]?.totalQty",
  ]) assert.ok(timeline.includes(field), field);
  assert.match(timeline, /forecast\.twoDaysAgoDate\.slice\(5\)/);
  assert.match(timeline, /forecast\.yesterdayDate\.slice\(5\)/);
  assert.match(timeline, /forecast\.dates\[1\]\.slice\(5\)/);
  assert.match(timeline, /forecast\.dates\[2\]\.slice\(5\)/);
  assert.match(timeline, /title: "ย้อนหลัง"/);
  assert.match(timeline, /title: "วันนี้"/);
  assert.match(timeline, /title: "ล่วงหน้า"/);
});

test("tomorrow's primary modal demand remains highlighted and source customers expandable", () => {
  assert.match(product, /พรุ่งนี้ \{tomorrow\?\.date \?\? ""\} · คาดความต้องการ B2B/);
  assert.match(product, /oneDay\(tomorrow, "totalQty"\)/);
  assert.match(product, /oneDay\(tomorrow, "knownQty"\)/);
  assert.match(product, /oneDay\(tomorrow, "projectedQty"\)/);
  assert.match(page, /ดูที่มาจากลูกค้าทุกราย/);
});
