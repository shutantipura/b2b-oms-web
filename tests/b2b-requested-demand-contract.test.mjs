import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/admin/stock-forecast/route.ts", import.meta.url), "utf8");
const model = readFileSync(new URL("../lib/stockForecast.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../app/stock-management/page.tsx", import.meta.url), "utf8");

test("forecast API fetches requested quantities from all orders without sales-status filtering", () => {
  const start = route.indexOf("async function loadForecast(");
  const end = route.indexOf("type SnapshotRecord", start);
  const loader = route.slice(start, end);
  assert.match(loader, /const orders = await ordersForDeliveryDates/);
  assert.match(loader, /const demandOrders = orders/);
  assert.match(loader, /itemsForOrders\(admin, demandOrders\.map/);
  assert.match(loader, /requestedQty: numeric\(item\.requested_qty\)/);
  assert.doesNotMatch(loader, /\.filter\(\(order\) => order\.status !== "cancelled"\)/);
  assert.match(route, /isTest: customer\.is_test_customer === true/);
});

test("grouped B2B order source identifies first child so the original parent is not counted twice", () => {
  assert.match(route, /group_root_order_id, group_sequence, status/);
  assert.match(route, /groupSequence: order\.group_sequence/);
  assert.match(model, /groupSequence\?: number \| null/);
  assert.match(model, /const representedParents = new Set\(orders/);
  assert.match(model, /o\.groupRootOrderId && o\.groupSequence === 1/);
  assert.match(model, /!representedParents\.has\(o\.id\)/);
});

test("forecast model treats all statuses as demand but excludes the Test restaurant", () => {
  const start = model.indexOf("export function buildStockForecast(");
  const run = model.slice(start);
  const filter = run.slice(run.indexOf("const activeOrders ="), run.indexOf("const orderById ="));
  assert.match(run, /customers\.filter\(\(c\) => !c\.isTest\)/);
  assert.match(filter, /customerById\.has\(o\.customerId\)/);
  assert.doesNotMatch(filter, /o\.status/);
  assert.match(run, /const quantity = item\.requestedQty/);
  assert.match(run, /normaliseForecastQuantity\(item\.sku, item\.unit, quantity, weightConversions\)/);
});

test("customer and SKU demand cards identify requested demand rather than fulfilled sales", () => {
  assert.match(view, /คำนวณจากจำนวนที่ลูกค้าขอสั่ง ไม่ใช่จำนวนที่ขายหรือส่งมอบ/);
  assert.match(view, /รวมถึงออเดอร์ที่ยกเลิกหรือขายได้ไม่ครบ/);
  assert.match(view, /ไม่รวมลูกค้าทดสอบ/);
  assert.match(view, /คาดรวม = ขอสั่งแล้ว/);
});

test("customer Excel includes cancelled requests and not supplier quantities", () => {
  const a = route.indexOf("function b2bDemandExcelResponse");
  const b = route.indexOf("function excelResponse", a);
  const scoped = route.slice(a, b);
  assert.match(scoped, /รวมออเดอร์ยกเลิก\/ขายได้ไม่ครบ/);
  assert.match(scoped, /ไม่รวมลูกค้าทดสอบ/);
  assert.match(scoped, /พรุ่งนี้ขอสั่งแล้ว/);
  assert.match(scoped, /row\.yesterdayRequestedQty, row\.todayRequestedQty/);
  assert.doesNotMatch(scoped, /recommendedOrderKg|sharedPurchaseDrafts/);
});
