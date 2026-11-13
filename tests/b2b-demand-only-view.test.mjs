import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateForecastByProduct } from "../lib/stockForecast.ts";

const page = readFileSync(new URL("../app/stock-management/page.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/stock-forecast/route.ts", import.meta.url), "utf8");

test("Stock Management is live B2B demand and never asks for shared stock inputs", () => {
  assert.match(page, /format=b2b-demand"/);
  assert.match(page, /setInterval\(\(\) => void refresh\(true\), 60_000\)/);
  assert.match(page, /รีเฟรชอัตโนมัติทุก 1 นาที ไม่ผูกกับเวลา cut-off ซัพพลายเออร์/);
  assert.match(page, /คาดการณ์ความต้องการ B2B/);
  assert.match(page, /ดูที่มาจากลูกค้าทุกราย/);
  assert.match(page, /customer\.customerName/);
  assert.match(page, /customer\.customerCode/);
  assert.match(page, /knownQty/);
  assert.match(page, /projectedQty/);
  assert.doesNotMatch(page, /B2CSalesImportPanel|sharedPurchaseDraft|sharedStockInputs|stock_morning_counts|officialPurchaseDrafts|TARGET_STOCK_DAYS/);
});

test("B2B API handles real-time demand before any snapshot, B2C, costs or inventory calculation", () => {
  const start = route.indexOf("export async function GET");
  const scoped = route.slice(start);
  const live = scoped.indexOf('if (format === "b2b-demand")');
  const combined = scoped.indexOf("loadSharedStockInputs(admin");
  assert.ok(live > 0 && combined > live);
  assert.match(scoped.slice(live, live + 230), /NextResponse\.json\(inputs\.forecast/);
  assert.match(scoped, /if \(format === "b2b-demand-xlsx"\) return b2bDemandExcelResponse\(inputs\.forecast\)/);
  assert.match(route, /const admin = await requireManager\(request\)/);
});

test("B2B-only Excel has product and customer sheets without purchasing plans", () => {
  const start = route.indexOf("function b2bDemandExcelResponse");
  const end = route.indexOf("function excelResponse", start);
  assert.ok(start >= 0 && end > start);
  const excel = route.slice(start, end);
  assert.match(excel, /aggregateForecastByProduct/);
  assert.match(excel, /รวมตาม SKU/);
  assert.match(excel, /แยกรายลูกค้า/);
  assert.match(excel, /row\.customerCode, row\.customerName/);
  assert.match(excel, /row\.days\[1\]\?\.knownQty/);
  assert.match(excel, /row\.days\[1\]\?\.projectedQty/);
  assert.doesNotMatch(excel, /stockOrderPlans|sharedPurchaseDrafts|recommendedOrderKg/);
});

test("new 10:00 snapshots preserve B2B demand only, not purchase recommendations", () => {
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("function b2bDemandExcelResponse"));
  assert.match(post, /model_version: "b2b-demand-only-10am-v1"/);
  assert.match(post, /forecast: inputs\.noonForecast/);
  assert.doesNotMatch(post, /stockOrderPlan = |sharedPurchaseDrafts = |loadSharedStockInputs\(/);
});

test("SKU forecast retains all customer contributions and keeps units separate", () => {
  const dates = ["2026-11-13", "2026-11-14", "2026-11-15"];
  const make = (customerId, unit, known, projected) => ({
    customerId, customerCode: customerId, customerName: customerId, sku: "000123456",
    productName: "ทดสอบเนื้อหมู", unit, freshMeat: true,
    customerCadenceDays: 2, skuCadenceDays: 2, effectiveCadenceDays: 2,
    purchaseDays: 10, confidence: "high", conditionalUnitShare: 1,
    customerUsualOrderOffsetMinutes: 0, customerOrderTimingSamples: 4,
    yesterdayRequestedQty: 0, todayRequestedQty: 0,
    days: dates.map((date, i) => ({
      date, knownQty: i === 1 ? known : 0, projectedQty: i === 1 ? projected : 0,
      totalQty: i === 1 ? known + projected : 0,\n      projectedProbability: i === 1 ? 1 : 0, possibleQty: i === 1 ? projected : 0,
    })),
  });
  const [product] = aggregateForecastByProduct([
    make("customer-a", "กก.", 8, 2), make("customer-b", "กก.", 5, 3),
    make("customer-c", "ชิ้น", 4, 1),
  ], dates);
  assert.equal(product.customerCount, 3);
  assert.equal(product.units.length, 2);
  const kg = product.units.find(unit => unit.unit === "กก.");
  const pieces = product.units.find(unit => unit.unit === "ชิ้น");
  assert.equal(kg.customers.length, 2);
  assert.equal(kg.days[1].knownQty, 13);
  assert.equal(kg.days[1].projectedQty, 5);
  assert.equal(pieces.customers.length, 1);
  assert.equal(pieces.days[1].knownQty, 4);
});
