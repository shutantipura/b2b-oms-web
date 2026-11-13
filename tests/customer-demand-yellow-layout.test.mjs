import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/stock-management/page.tsx", import.meta.url), "utf8");
const productStart = page.indexOf('{visibleProducts.map((product) =>');
const customerStart = page.indexOf('const day = customer.days[1];', productStart);
const customerEnd = page.indexOf('<div className="mt-2 grid grid-cols-4', customerStart);
const productArea = page.slice(productStart, customerStart);
const customerArea = page.slice(customerStart, customerEnd);

test("SKU tomorrow total stays teal while each customer contribution is Lotus's yellow", () => {
  assert.ok(productStart > 0 && customerStart > productStart && customerEnd > customerStart);
  assert.match(productArea, /bg-\[#E7F8F4\]/);
  assert.match(productArea, /text-\[#008B8B\]/);
  assert.match(customerArea, /bg-\[#FFBE16\]/);
  assert.match(customerArea, /border-\[#E1A100\]/);
  assert.match(customerArea, /text-\[#17453F\]/);
  assert.doesNotMatch(customerArea, /bg-\[#E7F8F4\]/);
});

test("customer panel is slightly shorter and contains accessible dark-colored copy", () => {
  assert.match(customerArea, /px-3 py-2\.5/);
  assert.match(customerArea, /text-\[#4A3900\]/);
  assert.match(customerArea, /text-\[#594400\]/);
});

test("customer data and confidence remain unchanged", () => {
  assert.match(customerArea, /confidence\.color/);
  assert.match(customerArea, /oneDay\(day, "totalQty"\)/);
  assert.match(customerArea, /oneDay\(day, "knownQty"\)/);
  assert.match(customerArea, /oneDay\(day, "projectedQty"\)/);
  assert.match(page, /customer\.yesterdayRequestedQty/);
  assert.match(page, /customer\.todayRequestedQty/);
});
