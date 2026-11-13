import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/stock-management/page.tsx", import.meta.url), "utf8");
const product = page.slice(page.indexOf('{visibleProducts.map((product) =>'), page.indexOf('<details className="group border-t', page.indexOf('{visibleProducts.map((product) =>')));

test("SKU-level metrics use a four-column row on narrow and wide screens", () => {
  assert.match(product, /grid grid-cols-4 gap-1\.5 sm:gap-2/);
  assert.match(product, /aria-label="ความต้องการ SKU เมื่อวาน วันนี้ คาดปิดวันนี้ และมะรืน"/);
  assert.equal((product.match(/<CustomerMiniMetric\b/g) ?? []).length, 4);
  assert.doesNotMatch(product, /grid-cols-2 gap-2 sm:grid-cols-4/);
  assert.doesNotMatch(product, /<SmallMetric/);
});

test("SKU row retains actual yesterday/today orders and later forecasts", () => {
  assert.match(product, /value=\{product\.unit\.yesterdayRequestedQty\}/);
  assert.match(product, /value=\{product\.unit\.todayRequestedQty\}/);
  assert.match(product, /value=\{product\.unit\.days\[0\]\?\.totalQty \?\? 0\}/);
  assert.match(product, /value=\{product\.unit\.days\[2\]\?\.totalQty \?\? 0\}/);
  assert.match(product, /เมื่อวาน \$\{forecast\.yesterdayDate\.slice\(5\)\} สั่งแล้ว/);
  assert.match(product, /วันนี้ \$\{forecast\.dates\[0\]\.slice\(5\)\} สั่งแล้ว/);
  assert.match(product, /มะรืน \$\{forecast\.dates\[2\]\.slice\(5\)\} คาดรวม/);
});

test("main SKU tomorrow forecast and customer breakdown are unchanged", () => {
  assert.match(product, /พรุ่งนี้ \{tomorrow\?\.date \?\? ""\} · คาดความต้องการ B2B/);
  assert.match(product, /oneDay\(tomorrow, "totalQty"\)/);
  assert.match(product, /oneDay\(tomorrow, "knownQty"\)/);
  assert.match(product, /oneDay\(tomorrow, "projectedQty"\)/);
  assert.match(page, /ดูที่มาจากลูกค้าทุกราย/);
  assert.match(page, /customer\.yesterdayRequestedQty/);
  assert.match(page, /customer\.todayRequestedQty/);
});
