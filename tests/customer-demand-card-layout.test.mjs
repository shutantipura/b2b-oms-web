import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/stock-management/page.tsx", import.meta.url), "utf8");
const breakdown = page.slice(page.indexOf('ดูที่มาจากลูกค้าทุกราย'));
const timeline = page.slice(page.indexOf("function DemandTimeline("), page.indexOf("export default function StockManagementPage()"));

test("each customer keeps tomorrow's modal forecast as the large yellow hero value", () => {
  assert.match(breakdown, /พรุ่งนี้ \{forecast\.dates\[1\]\.slice\(5\)\} · คาดความต้องการ/);
  assert.match(breakdown, /text-\[27px\] font-black/);
  assert.match(breakdown, /bg-\[#FFBE16\]/);
  assert.match(breakdown, /\{oneDay\(day, "totalQty"\)\}/);
  assert.match(breakdown, /\{oneDay\(day, "knownQty"\)\}/);
  assert.match(breakdown, /\{oneDay\(day, "projectedQty"\)\}/);
});

test("the customer card uses the same six-metric timeline as the SKU card", () => {
  assert.match(breakdown, /<DemandTimeline forecast=\{forecast\} data=\{customer\} unit=\{product\.unitName\} \/>/);
  assert.match(page, /<DemandTimeline forecast=\{forecast\} data=\{product\.unit\} unit=\{product\.unitName\} \/>/);
  assert.match(timeline, /grid grid-cols-3 gap-1\.5/);
  assert.match(timeline, /grid grid-cols-1 gap-1\.5 md:grid-cols-2/);
  assert.match(timeline, /title: "ย้อนหลัง"/);
  assert.match(timeline, /title: "วันนี้"/);
  assert.match(timeline, /title: "ล่วงหน้า"/);
  assert.match(timeline, /groups\.map/);
  assert.match(timeline, /group\.metrics\.map/);
});

test("all six labels and quantities have distinct meanings and use the product unit", () => {
  for (const field of [
    "data.twoDaysAgoRequestedQty",
    "data.yesterdayRequestedQty",
    "data.todayRequestedQty",
    "data.days[0]?.totalQty",
    "data.days[1]?.totalQty",
    "data.days[2]?.totalQty",
  ]) assert.ok(timeline.includes(field), field);
  assert.match(timeline, /2 วันก่อน/);
  assert.match(timeline, /เมื่อวาน/);
  assert.match(timeline, /ขอสั่งแล้ว/);
  assert.match(timeline, /คาดรวม \(Mode\)/);
  assert.match(timeline, /พรุ่งนี้/);
  assert.match(timeline, /มะรืน/);
  assert.match(timeline, /<CustomerMiniMetric/);
  assert.match(timeline, /unit=\{unit\}/);
  assert.match(breakdown, /customer\.effectiveCadenceDays/);
  assert.match(breakdown, /describeCustomerOrderTime/);
});
