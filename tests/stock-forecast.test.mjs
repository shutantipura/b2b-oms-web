import test from "node:test";
import assert from "node:assert/strict";
import { buildStockForecast, isFreshMeat } from "../lib/stockForecast.ts";

const now = new Date("2026-11-04T07:00:00Z");
const customer = { id: "c1", code: "0000000001", name: "Restaurant A", isTest: false };
const historicDays = ["2026-10-25", "2026-10-29", "2026-11-02"];

function makeOrder(id, day, status = "completed", deliveryDate = day) {
  return {
    id, customerId: "c1", createdAt: `${day}T03:00:00+07:00`, deliveryDate,
    status, groupRootOrderId: null,
  };
}

function makeItem(orderId, productId, quantity, category, productName) {
  return {
    orderId, productId, sku: productId, productName, unit: "กก.", category,
    actualQty: quantity, confirmedQty: null, requestedQty: quantity,
    piecePricePerKg: null, actualPieceQty: null,
  };
}

test("fresh meat classification excludes eggs, fish, frozen products", () => {
  assert.equal(isFreshMeat("เนื้อสัตว์และอาหารทะเล", "ซีพี สันนอกหมู กก.ละ"), true);
  assert.equal(isFreshMeat("เนื้อสัตว์และอาหารทะเล", "ไข่ไก่แพ็ค"), false);
  assert.equal(isFreshMeat("เนื้อสัตว์และอาหารทะเล", "ปลาทับทิม"), false);
  assert.equal(isFreshMeat("อาหารแช่แข็ง", "หมูแช่แข็ง"), false);
  assert.equal(isFreshMeat("Fresh Meat", "เนื้อวัว กก."), true);
});

test("meat capped at two days without doubling historical consumption", () => {
  const orders = historicDays.map((day, i) => makeOrder(`o${i}`, day));
  const items = orders.flatMap((order) => [
    makeItem(order.id, "meat", 20, "Fresh Meat", "หมูสด"),
    makeItem(order.id, "rice", 10, "อาหารและวัตถุดิบพื้นฐาน", "ข้าว"),
  ]);
  const forecast = buildStockForecast(orders, items, [customer], new Set(orders.map((o) => o.id)), now);
  const meat = forecast.rows.find((row) => row.sku === "meat");
  const rice = forecast.rows.find((row) => row.sku === "rice");
  assert.ok(meat);
  assert.ok(rice);
  assert.equal(meat.skuCadenceDays, 4);
  assert.equal(meat.effectiveCadenceDays, 2);
  assert.equal(meat.confidence, "low");
  assert.equal(rice.effectiveCadenceDays, 4);
  // Two-day expected cycle is 10kg; any single day's expected value must be <= 10kg.
  assert.ok(meat.days.every((day) => day.projectedQty <= 10));
  assert.deepEqual(forecast.dates, ["2026-11-04", "2026-11-05", "2026-11-06"]);
});

test("known future demand is included once and resets the cycle", () => {
  const orders = [
    ...historicDays.map((day, i) => makeOrder(`o${i}`, day)),
    makeOrder("future", "2026-11-04", "awaiting_picking", "2026-11-05"),
  ];
  const items = [
    ...historicDays.map((_, i) => makeItem(`o${i}`, "meat", 20, "Fresh Meat", "หมูสด")),
    { ...makeItem("future", "meat", null, "Fresh Meat", "หมูสด"), confirmedQty: 6, requestedQty: 6 },
  ];
  const forecast = buildStockForecast(orders, items, [customer], new Set(["o0", "o1", "o2"]), now);
  const meat = forecast.rows[0];
  assert.equal(meat.days[0].projectedQty, 0);
  assert.equal(meat.days[1].knownQty, 6);
  assert.equal(meat.days[1].projectedQty, 0);
  assert.equal(meat.days[1].totalQty, 6);
  assert.ok(meat.days[2].projectedQty < 10);
});

test("one-off SKUs do not create speculative forecasts; test customers excluded", () => {
  const orders = [makeOrder("one", "2026-11-02")];
  const items = [makeItem("one", "meat", 10, "Fresh Meat", "หมูสด")];
  const result = buildStockForecast(orders, items, [customer], new Set(["one"]), now);
  assert.equal(result.rows.length, 0);
  const hidden = buildStockForecast(orders, items, [{ ...customer, isTest: true }], new Set(["one"]), now);
  assert.equal(hidden.rows.length, 0);
});

test("unmeasured piece-priced-by-weight orders are flagged rather than counted as kg", () => {
  const orders = [makeOrder("pending", "2026-11-04", "awaiting_picking")];
  const items = [{
    ...makeItem("pending", "meat", null, "Fresh Meat", "คากิ"),
    unit: "ชิ้น", requestedQty: 5, confirmedQty: 5, piecePricePerKg: 51,
  }];
  const result = buildStockForecast(orders, items, [customer], new Set(), now);
  assert.equal(result.unmeasuredPieceOrders, 1);
  assert.equal(result.rows.length, 0);
});
