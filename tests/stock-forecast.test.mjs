import test from "node:test";
import assert from "node:assert/strict";
import { aggregateForecastByProduct, buildStockForecast, describeCustomerOrderTime, isFreshMeat, mostLikelyOrderQty, remainingOrderWindowShare } from "../lib/stockForecast.ts";

const now = new Date("2026-11-03T20:00:00Z"); // 03:00 on 4 Nov Bangkok time
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
    requestedQty: quantity,
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

test("a customer whose usual deadline is 22:00 the previous day cannot generate speculative demand after it passes", () => {
  const offsets = [-120, -120, -120, -120]; // 22:00 the day before delivery
  assert.equal(describeCustomerOrderTime(-120, offsets.length), "วันก่อนส่ง 22:00");
  assert.equal(remainingOrderWindowShare(new Date("2026-11-03T14:59:00Z"), "2026-11-04", offsets), 1);
  assert.equal(remainingOrderWindowShare(new Date("2026-11-03T15:01:00Z"), "2026-11-04", offsets), 0);
});

test("same-day customer remains eligible until their usual order time, with mixed patterns weighted", () => {
  const sameDay = [780, 780, 780]; // 13:00 on the delivery day
  assert.equal(describeCustomerOrderTime(780, sameDay.length), "วันส่ง 13:00");
  assert.equal(remainingOrderWindowShare(new Date("2026-11-04T05:00:00Z"), "2026-11-04", sameDay), 1);
  assert.equal(remainingOrderWindowShare(new Date("2026-11-04T07:00:00Z"), "2026-11-04", sameDay), 0);
  assert.equal(remainingOrderWindowShare(new Date("2026-11-04T05:00:00Z"), "2026-11-04", [-120, -120, 780]), 1 / 3);
  assert.equal(remainingOrderWindowShare(new Date("2026-11-04T07:00:00Z"), "2026-11-04", [780]), 1);
});

test("delivery dates, not creation dates, determine customer and SKU ordering cadence", () => {
  const orders = historicDays.map((deliveryDate, i) => ({
    ...makeOrder(`o${i}`, deliveryDate),
    createdAt: `${["2026-10-24", "2026-10-27", "2026-11-01"][i]}T22:00:00+07:00`,
  }));
  const result = buildStockForecast(orders, orders.map((order) => makeItem(order.id, "meat", 20, "Fresh Meat", "หมูสด")), [customer], now);
  assert.equal(result.rows[0].customerCadenceDays, 4);
  assert.equal(result.rows[0].skuCadenceDays, 4);
});

test("an order placed the previous evening contributes to today's delivery demand, not yesterday's", () => {
  const order = {
    ...makeOrder("overnight", "2026-11-03", "awaiting_picking", "2026-11-04"),
    createdAt: "2026-11-03T22:00:00+07:00",
  };
  const result = buildStockForecast([order], [makeItem("overnight", "rice", 8, "Dry Goods", "ข้าว")], [customer], now);
  assert.equal(result.rows[0].yesterdayRequestedQty, 0);
  assert.equal(result.rows[0].todayRequestedQty, 8);
  assert.equal(result.rows[0].days[0].knownQty, 8);
});

test("the customer's observed ordering deadline suppresses unbooked today demand but not tomorrow", () => {
  const deliveries = ["2026-10-31", "2026-11-01", "2026-11-02"];
  const orders = deliveries.map((deliveryDate, i) => ({
    ...makeOrder(`h${i}`, deliveryDate),
    createdAt: `${["2026-10-30", "2026-10-31", "2026-11-01"][i]}T22:00:00+07:00`,
  }));
  const items = orders.map((order) => makeItem(order.id, "rice", 10, "อาหารแห้ง", "ข้าว"));
  const lateToday = new Date("2026-11-04T07:00:00Z"); // 14:00 Bangkok; yesterday's 22:00 deadline has passed
  const result = buildStockForecast(orders, items, [customer], lateToday);
  assert.equal(result.rows[0].days[0].projectedQty, 0);
  assert.ok(result.rows[0].days[1].projectedQty > 0);
  const booked = { ...makeOrder("booked", "2026-11-04"), createdAt: "2026-11-03T22:00:00+07:00" };
  const withKnown = buildStockForecast([...orders, booked], [...items, makeItem("booked", "rice", 6, "อาหารแห้ง", "ข้าว")], [customer], lateToday);
  assert.equal(withKnown.rows[0].days[0].knownQty, 6);
  assert.equal(withKnown.rows[0].days[0].totalQty, 6);
});

test("orders without delivery dates and deliveries outside the 90-day window are excluded", () => {
  const orders = [
    { ...makeOrder("undated", "2026-11-03"), deliveryDate: null },
    makeOrder("old", "2026-07-01"),
    makeOrder("today", "2026-11-04"),
  ];
  const items = orders.map((o) => makeItem(o.id, "meat", 2, "Fresh Meat", "หมูสด"));
  const result = buildStockForecast(orders, items, [customer], now);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].todayRequestedQty, 2);
});

test("meat capped at two days without doubling historical consumption", () => {
  const orders = historicDays.map((day, i) => makeOrder(`o${i}`, day));
  const items = orders.flatMap((order) => [
    makeItem(order.id, "meat", 20, "Fresh Meat", "หมูสด"),
    makeItem(order.id, "rice", 10, "อาหารและวัตถุดิบพื้นฐาน", "ข้าว"),
  ]);
  const forecast = buildStockForecast(orders, items, [customer], now);
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

test("yesterday and today count requested quantities even when stock check or billing reduced the amount", () => {
  const orders = [
    ...historicDays.map((day, i) => makeOrder(`o${i}`, day)),
    makeOrder("yesterday", "2026-11-03"),
    makeOrder("today-billed", "2026-11-04"),
    makeOrder("today-pending", "2026-11-04", "awaiting_billing"),
  ];
  const items = [
    ...historicDays.map((_, i) => makeItem(`o${i}`, "meat", 20, "Fresh Meat", "หมูสด")),
    { ...makeItem("yesterday", "meat", 4, "Fresh Meat", "หมูสด"), confirmedQty: 0, actualQty: 0 },
    { ...makeItem("today-billed", "meat", 3, "Fresh Meat", "หมูสด"), confirmedQty: 1, actualQty: 1 },
    { ...makeItem("today-pending", "meat", 7, "Fresh Meat", "หมูสด"), confirmedQty: 0, actualQty: 0 },
  ];
  const forecast = buildStockForecast(orders, items, [customer], now);
  const meat = forecast.rows.find((row) => row.sku === "meat");
  assert.equal(meat.yesterdayRequestedQty, 4);
  assert.equal(meat.todayRequestedQty, 10);
  // Requested 3kg and 7kg are counted even though both were short-picked.
  assert.equal(meat.days[0].knownQty, 10);
  assert.equal(meat.days[0].projectedQty, 0);
  assert.equal(meat.days[0].totalQty, 10);
});

test("yesterday's one-off request remains visible even without a forward prediction", () => {
  const orders = [makeOrder("one", "2026-11-03")];
  const items = [makeItem("one", "meat", 5, "Fresh Meat", "หมูสด")];
  const forecast = buildStockForecast(orders, items, [customer], now);
  assert.equal(forecast.rows.length, 1);
  assert.equal(forecast.rows[0].yesterdayRequestedQty, 5);
  assert.equal(forecast.rows[0].todayRequestedQty, 0);
  assert.ok(forecast.rows[0].days.every((day) => day.totalQty === 0));
});

test("known future demand is included once and resets the cycle", () => {
  const orders = [
    ...historicDays.map((day, i) => makeOrder(`o${i}`, day)),
    makeOrder("future", "2026-11-04", "awaiting_picking", "2026-11-05"),
  ];
  const items = [
    ...historicDays.map((_, i) => makeItem(`o${i}`, "meat", 20, "Fresh Meat", "หมูสด")),
    { ...makeItem("future", "meat", 6, "Fresh Meat", "หมูสด"), confirmedQty: 0, actualQty: 0 },
  ];
  const forecast = buildStockForecast(orders, items, [customer], now);
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
  const result = buildStockForecast(orders, items, [customer], now);
  assert.equal(result.rows.length, 0);
  const hidden = buildStockForecast(orders, items, [{ ...customer, isTest: true }], now);
  assert.equal(hidden.rows.length, 0);
});

test("a piece-priced-by-weight order stays in pieces without depending on billed kg", () => {
  const orders = [makeOrder("pending", "2026-11-04", "awaiting_picking")];
  const items = [{
    ...makeItem("pending", "meat", 5, "Fresh Meat", "คากิ"),
    unit: "ชิ้น", confirmedQty: 0, actualQty: 0, piecePricePerKg: 51,
  }];
  const result = buildStockForecast(orders, items, [customer], now);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].unit, "ชิ้น");
  assert.equal(result.rows[0].todayRequestedQty, 5);
  assert.equal(result.rows[0].days[0].knownQty, 5);
});

test("historical modal quantity and order cadence use unfulfilled requests, not completed sales", () => {
  const orders = historicDays.map((day, i) => makeOrder(`o${i}`, day));
  const items = orders.map((order) => ({
    ...makeItem(order.id, "meat", 20, "Fresh Meat", "หมูสด"),
    actualQty: 0, confirmedQty: 0,
  }));
  const result = buildStockForecast(orders, items, [customer], now);
  assert.equal(result.rows[0].skuCadenceDays, 4);
  assert.deepEqual(result.rows[0].days.map((day) => day.projectedQty), [10, 0, 10]);
});

test("cancelled requests never contribute to demand", () => {
  const orders = [makeOrder("valid", "2026-11-04", "awaiting_picking"), makeOrder("void", "2026-11-04", "cancelled")];
  const items = [makeItem("valid", "meat", 3, "Fresh Meat", "หมูสด"), makeItem("void", "meat", 99, "Fresh Meat", "หมูสด")];
  const result = buildStockForecast(orders, items, [customer], now);
  assert.equal(result.rows[0].todayRequestedQty, 3);
});

test("product forecast sums all customers into the same SKU for each of three days", () => {
  const dates = ["2026-11-04", "2026-11-05", "2026-11-06"];
  const makeForecastRow = (id, name, quantities) => ({
    customerId: id, customerCode: id, customerName: name,
    sku: "051262358", productName: "หมูสด", unit: "กก.", freshMeat: true,
    yesterdayRequestedQty: id === "c1" ? 5 : 3,
    todayRequestedQty: id === "c1" ? 10 : 3.25,
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
  assert.equal(result[0].yesterdayRequestedQty, 8);
  assert.equal(result[0].todayRequestedQty, 13.25);
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
    yesterdayRequestedQty: 2, todayRequestedQty: 1,
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
  assert.equal(kilos.yesterdayRequestedQty, 4);
  assert.equal(pieces.yesterdayRequestedQty, 2);
  assert.equal(kilos.days[0].totalQty, 1.36);
  assert.equal(kilos.days[1].totalQty, 0);
  assert.equal(pieces.days[0].totalQty, 0);
  assert.equal(pieces.days[1].totalQty, 2);
});

test("product list is prioritised by tomorrow's forecast volume, highest first", () => {
  const dates = ["2026-11-04", "2026-11-05", "2026-11-06"];
  const row = (sku, tomorrow) => ({
    customerId: "c1", customerCode: "1", customerName: "Restaurant A", sku,
    productName: sku, unit: "กก.", freshMeat: false, yesterdayRequestedQty: 0, todayRequestedQty: 0,
    days: dates.map((date, i) => ({ date, knownQty: 0, projectedQty: i === 1 ? tomorrow : 0, totalQty: i === 1 ? tomorrow : 0 })),
  });
  assert.deepEqual(aggregateForecastByProduct([row("001", 1), row("999", 9)], dates).map((p) => p.sku), ["999", "001"]);
});
