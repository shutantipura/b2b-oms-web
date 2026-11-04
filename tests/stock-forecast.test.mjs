import test from "node:test";
import assert from "node:assert/strict";
import { aggregateForecastByProduct, buildStockForecast, isFreshMeat, mostLikelyOrderQty } from "../lib/stockForecast.ts";

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

test("modal forecast chooses the full likely quantity instead of probability-weighting it", () => {
  assert.equal(mostLikelyOrderQty(0.8, 1), 1);
  assert.equal(mostLikelyOrderQty(0.2, 1), 0);
  assert.equal(mostLikelyOrderQty(0.5, 1), 0);
  assert.equal(mostLikelyOrderQty(0.75, 3.125), 3.125);
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
  // Capping the meat cycle at two days preserves the historical daily consumption:
  // a 20kg order every four days becomes a 10kg modal order every two days.
  assert.deepEqual(meat.days.map((day) => day.projectedQty), [10, 0, 10]);
  assert.deepEqual(rice.days.map((day) => day.projectedQty), [0, 0, 10]);
  assert.deepEqual(forecast.dates, ["2026-11-04", "2026-11-05", "2026-11-06"]);
  assert.equal(forecast.yesterdayDate, "2026-11-03");
});

test("actual yesterday and today use billed quantity, and today's closing forecast includes billed units once", () => {
  const orders = [
    ...historicDays.map((day, i) => makeOrder(`o${i}`, day)),
    makeOrder("yesterday", "2026-11-03"),
    makeOrder("today-billed", "2026-11-04"),
    makeOrder("today-pending", "2026-11-04", "awaiting_billing"),
  ];
  const items = [
    ...historicDays.map((_, i) => makeItem(`o${i}`, "meat", 20, "Fresh Meat", "หมูสด")),
    makeItem("yesterday", "meat", 4, "Fresh Meat", "หมูสด"),
    makeItem("today-billed", "meat", 3, "Fresh Meat", "หมูสด"),
    makeItem("today-pending", "meat", 7, "Fresh Meat", "หมูสด"),
  ];
  const billed = new Set(["o0", "o1", "o2", "yesterday", "today-billed"]);
  const forecast = buildStockForecast(orders, items, [customer], billed, now);
  const meat = forecast.rows.find((row) => row.sku === "meat");
  assert.equal(meat.yesterdayActualQty, 4);
  assert.equal(meat.todayActualQty, 3);
  // Pending-picked 7kg is booked but not actual; 3kg billed is already part of the 10kg total.
  assert.equal(meat.days[0].knownQty, 10);
  assert.equal(meat.days[0].projectedQty, 0);
  assert.equal(meat.days[0].totalQty, 10);
});

test("yesterday's one-off sale remains visible even without a forward prediction", () => {
  const orders = [makeOrder("one", "2026-11-03")];
  const items = [makeItem("one", "meat", 5, "Fresh Meat", "หมูสด")];
  const forecast = buildStockForecast(orders, items, [customer], new Set(["one"]), now);
  assert.equal(forecast.rows.length, 1);
  assert.equal(forecast.rows[0].yesterdayActualQty, 5);
  assert.equal(forecast.rows[0].todayActualQty, 0);
  assert.ok(forecast.rows[0].days.every((day) => day.totalQty === 0));
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

test("product forecast sums all customers into the same SKU for each of three days", () => {
  const dates = ["2026-11-04", "2026-11-05", "2026-11-06"];
  const makeForecastRow = (id, name, quantities) => ({
    customerId: id, customerCode: id, customerName: name,
    sku: "051262358", productName: "หมูสด", unit: "กก.", freshMeat: true,
    yesterdayActualQty: id === "c1" ? 5 : 3,
    todayActualQty: id === "c1" ? 10 : 3.25,
    confidence: "medium", days: quantities.map(([knownQty, projectedQty], index) => ({
      date: dates[index], knownQty, projectedQty, totalQty: knownQty + projectedQty,
    })),
  });
  const result = aggregateForecastByProduct([
    makeForecastRow("c1", "ร้าน ก", [[10, 1.5], [0, 2], [4, 0]]),
    makeForecastRow("c2", "ร้าน ข", [[3.25, 2.5], [2, 1.5], [0, 3]]),
  ], dates);
  assert.equal(result.length, 1);
  assert.equal(result[0].customerCount, 2);
  assert.equal(result[0].freshMeat, true);
  assert.equal(result[0].yesterdayActualQty, 8);
  assert.equal(result[0].todayActualQty, 13.25);
  assert.deepEqual(result[0].days.map((day) => [day.knownQty, day.projectedQty, day.totalQty]), [
    [13.25, 4, 17.25], [2, 3.5, 5.5], [4, 3, 7],
  ]);
  assert.equal(result[0].customers.length, 2);
});

test("SKU totals never combine incompatible units or mismatched dates", () => {
  const dates = ["2026-11-04", "2026-11-05", "2026-11-06"];
  const base = {
    customerId: "c1", customerCode: "1", customerName: "Restaurant A",
    sku: "123456789", productName: "ไก่", freshMeat: false, confidence: "low",
    yesterdayActualQty: 2, todayActualQty: 1,
  };
  const result = aggregateForecastByProduct([
    { ...base, unit: "กก.", days: [{ date: dates[0], knownQty: 0, projectedQty: 1.235, totalQty: 1.235 }] },
    { ...base, unit: "ชิ้น", days: [{ date: dates[1], knownQty: 2, projectedQty: 0, totalQty: 2 }] },
    { ...base, customerId: "c2", unit: "กก.", days: [{ date: dates[0], knownQty: 0, projectedQty: 0.125, totalQty: 0.125 }] },
  ], dates);
  assert.equal(result.length, 2);
  const kilos = result.find((row) => row.unit === "กก.");
  const pieces = result.find((row) => row.unit === "ชิ้น");
  assert.equal(kilos.customerCount, 2);
  assert.equal(kilos.yesterdayActualQty, 4);
  assert.equal(pieces.yesterdayActualQty, 2);
  assert.equal(kilos.days[0].totalQty, 1.36);
  assert.equal(kilos.days[1].totalQty, 0);
  assert.equal(pieces.days[0].totalQty, 0);
  assert.equal(pieces.days[1].totalQty, 2);
});
