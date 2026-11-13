import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/stock-management/page.tsx", import.meta.url), "utf8");
const breakdown = page.slice(page.indexOf('ดูที่มาจากลูกค้าทุกราย'));

test("each customer shows tomorrow's total forecast as the primary large number", () => {
  assert.match(breakdown, /พรุ่งนี้ \{forecast\.dates\[1\]\.slice\(5\)\} · คาดความต้องการ/);
  assert.match(breakdown, /text-\[27px\] font-black/);
  assert.match(breakdown, /\{oneDay\(day, "totalQty"\)\}/);
  assert.match(breakdown, /\{oneDay\(day, "knownQty"\)\}/);
  assert.match(breakdown, /\{oneDay\(day, "projectedQty"\)\}/);
});

test("historical and remaining forecast quantities fit in one compact row", () => {
  assert.match(breakdown, /grid grid-cols-4 gap-1\.5/);
  assert.match(breakdown, /value=\{customer\.yesterdayRequestedQty\}/);
  assert.match(breakdown, /value=\{customer\.todayRequestedQty\}/);
  assert.match(breakdown, /value=\{customer\.days\[0\]\?\.totalQty \?\? 0\}/);
  assert.match(breakdown, /value=\{customer\.days\[2\]\?\.totalQty \?\? 0\}/);
  assert.doesNotMatch(breakdown, /<div className="mt-3 grid grid-cols-3 gap-2">/);
});

test("compact figures remain correctly labelled and keep each product's unit", () => {
  assert.match(breakdown, /เมื่อวาน \$\{forecast\.yesterdayDate\.slice\(5\)\} สั่งแล้ว/);
  assert.match(breakdown, /วันนี้ \$\{forecast\.dates\[0\]\.slice\(5\)\} สั่งแล้ว/);
  assert.match(breakdown, /มะรืน \$\{forecast\.dates\[2\]\.slice\(5\)\} คาดรวม/);
  assert.match(page, /function CustomerMiniMetric/);
  assert.match(page, /\{amount\(value\)\} <span className="text-\[9px\] font-bold">\{unit\}<\/span>/);
  assert.match(breakdown, /customer\.effectiveCadenceDays/);
  assert.match(breakdown, /describeCustomerOrderTime/);
});
