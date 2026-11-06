import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateForecastByProduct, buildStockForecast, conditionalOrderProbability,
  describeCustomerOrderTime, estimatePieceWeights, isFreshMeat, mostLikelyAggregateQty, mostLikelyOrderQty,
  normaliseForecastQuantity,
  observedRepeatProbability, probabilityAfterNoOrderYet, recencyWeightedMedian,
  remainingOrderWindowShare,
} from "../lib/stockForecast.ts";

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

test("product-level modal demand combines small probabilities from many customers", () => {
  assert.equal(mostLikelyAggregateQty(Array.from({ length: 10 }, () => ({ probability: 0.4, quantity: 1 }))), 4);
  assert.equal(mostLikelyAggregateQty(Array.from({ length: 2 }, () => ({ probability: 0.4, quantity: 1 }))), 1);
  assert.equal(mostLikelyAggregateQty([{ probability: 0.5, quantity: 4 }]), 0);
  assert.equal(mostLikelyAggregateQty([{ probability: 1, quantity: 2.04 }, { probability: 1, quantity: 1.04 }]), 3.1);
  assert.equal(mostLikelyAggregateQty([{ probability: 1, quantity: 0.04 }, { probability: 1, quantity: 0.04 }]), 0.1);
});

test("observed delivery gaps inform hazard without trusting one or two intervals completely", () => {
  const priorDayOne = conditionalOrderProbability(1, 3);
  assert.ok(observedRepeatProbability(1, 3, [3, 3, 3]) < priorDayOne);
  assert.ok(observedRepeatProbability(3, 3, [3, 3, 3]) > conditionalOrderProbability(3, 3));
  assert.equal(observedRepeatProbability(2, 3, []), conditionalOrderProbability(2, 3));
});

test("no order yet updates the remaining-day probability using Bayes rule", () => {
  assert.ok(Math.abs(probabilityAfterNoOrderYet(0.8, 0.2) - 4 / 9) < 1e-10);
  assert.equal(probabilityAfterNoOrderYet(0.8, 1), 0.8);
  assert.equal(probabilityAfterNoOrderYet(0.8, 0), 0);
  assert.equal(probabilityAfterNoOrderYet(1, 0), 0);
});

test("typical requested quantity remains an observed size despite unusual large orders", () => {
  assert.equal(recencyWeightedMedian([10, 10, 10, 100]), 10);
  assert.equal(recencyWeightedMedian([10, 10, 10, 10, 100]), 10);
});

test("product mode is not the sum of the zero-valued customer modes", () => {
  const day = "2026-11-04";
  const rows = Array.from({ length: 10 }, (_, i) => ({
    customerId: `c${i}`, customerCode: `${i}`, customerName: `Restaurant ${i}`,
    sku: "rice", productName: "ข้าวสาร", unit: "กก.", freshMeat: false,
    yesterdayRequestedQty: 0, todayRequestedQty: 0,
    days: [{ date: day, knownQty: 0, projectedQty: 0, totalQty: 0, projectedProbability: 0.4, possibleQty: 1 }],
  }));
  const [product] = aggregateForecastByProduct(rows, [day]);
  assert.equal(product.units[0].days[0].projectedQty, 4);
  assert.equal(product.units[0].days[0].totalQty, 4);
  assert.ok(product.units[0].customers.every((c) => c.days[0].projectedQty === 0));
});

test("three-day ordering cadence changes probability as days pass without a new order", () => {
  const afterOneDay = conditionalOrderProbability(1, 3);
  const afterTwoDays = conditionalOrderProbability(2, 3);
  const afterThreeDays = conditionalOrderProbability(3, 3);
  assert.ok(afterOneDay < 0.15);
  assert.ok(afterTwoDays > afterOneDay && afterTwoDays < 0.5);
  assert.ok(afterThreeDays > 0.5);
  assert.equal(mostLikelyOrderQty(afterOneDay, 12), 0);
  assert.equal(mostLikelyOrderQty(afterThreeDays, 12), 12);
});

test("ordering another SKU yesterday resets the customer clock for all other SKUs", () => {
  const dates = ["2026-10-25", "2026-10-28", "2026-10-31"];
  const historical = dates.map((day, i) => makeOrder(`h${i}`, day));
  const historicalItems = historical.map((order) => makeItem(order.id, "dry", 12, "Dry Goods", "ข้าวสาร"));
  const overdue = buildStockForecast(historical, historicalItems, [customer], now);
  assert.ok(overdue.rows.find((row) => row.sku === "dry").days[0].projectedQty > 0);

  const yesterdayOther = makeOrder("yesterday-other", "2026-11-03");
  const updated = buildStockForecast(
    [...historical, yesterdayOther],
    [...historicalItems, makeItem(yesterdayOther.id, "other", 5, "Dry Goods", "น้ำตาล")],
    [customer], now
  );
  const originalSku = updated.rows.find((row) => row.sku === "dry");
  assert.ok(originalSku);
  assert.equal(originalSku.customerCadenceDays, 3);
  assert.equal(originalSku.days[0].projectedQty, 0);
  assert.equal(originalSku.days[1].projectedQty, 0);
  assert.equal(originalSku.days[2].projectedQty, 12);
});

test("a known different-SKU basket today is counted but does not generate another speculative basket", () => {
  const dates = ["2026-10-25", "2026-10-28", "2026-10-31"];
  const historical = dates.map((day, i) => makeOrder(`h${i}`, day));
  const known = makeOrder("known-other", "2026-11-04", "awaiting_picking");
  const result = buildStockForecast(
    [...historical, known],
    [
      ...historical.map((order) => makeItem(order.id, "dry", 12, "Dry Goods", "ข้าวสาร")),
      makeItem(known.id, "other", 7, "Dry Goods", "น้ำตาล"),
    ],
    [customer], now
  );
  const dry = result.rows.find((row) => row.sku === "dry");
  const other = result.rows.find((row) => row.sku === "other");
  assert.equal(dry?.days[0].totalQty ?? 0, 0);
  assert.equal(other.days[0].knownQty, 7);
  assert.equal(other.days[0].projectedQty, 0);
});

test("a confirmed future basket suppresses speculative demand before its delivery day", () => {
  const dates = ["2026-10-25", "2026-10-28", "2026-10-31"];
  const historical = dates.map((day, i) => makeOrder(`h${i}`, day));
  const future = { ...makeOrder("future-other", "2026-11-03", "awaiting_picking", "2026-11-05"), createdAt: "2026-11-03T22:00:00+07:00" };
  const result = buildStockForecast(
    [...historical, future],
    [
      ...historical.map((order) => makeItem(order.id, "dry", 12, "Dry Goods", "ข้าวสาร")),
      makeItem(future.id, "other", 7, "Dry Goods", "น้ำตาล"),
    ],
    [customer], now
  );
  const dry = result.rows.find((row) => row.sku === "dry");
  const other = result.rows.find((row) => row.sku === "other");
  assert.equal(dry?.days[0].totalQty ?? 0, 0);
  assert.equal(dry?.days[1].totalQty ?? 0, 0);
  assert.equal(other.days[1].knownQty, 7);
});

test("a zero-request record does not reset the customer ordering cycle", () => {
  const dates = ["2026-10-25", "2026-10-28", "2026-10-31"];
  const historical = dates.map((day, i) => makeOrder(`h${i}`, day));
  const zeroOrder = makeOrder("zero", "2026-11-03");
  const result = buildStockForecast(
    [...historical, zeroOrder],
    [
      ...historical.map((order) => makeItem(order.id, "dry", 12, "Dry Goods", "ข้าวสาร")),
      makeItem(zeroOrder.id, "other", 0, "Dry Goods", "น้ำตาล"),
    ],
    [customer], now
  );
  assert.ok(result.rows.find((row) => row.sku === "dry").days[0].projectedQty > 0);
});

test("one-off SKUs in repeat customers retain a small uncertain probability instead of disappearing", () => {
  const days = ["2026-10-20", "2026-10-24", "2026-10-28", "2026-11-01"];
  const orders = days.map((day, i) => makeOrder(`h${i}`, day));
  const result = buildStockForecast(
    orders,
    [
      ...orders.map((order) => makeItem(order.id, "staple", 10, "Dry Goods", "ข้าวสาร")),
      makeItem(orders[0].id, "occasional", 4, "Dry Goods", "น้ำตาล"),
    ],
    [customer], now
  );
  const occasional = result.rows.find((row) => row.sku === "occasional");
  assert.ok(occasional);
  assert.equal(occasional.confidence, "insufficient");
  assert.ok(occasional.days.some((day) => day.projectedProbability > 0));
  assert.ok(occasional.days.every((day) => day.projectedQty === 0));
});

test("two split orders for one delivery day count as one lead-time sample", () => {
  const days = ["2026-10-25", "2026-10-29", "2026-11-02"];
  const orders = days.map((day, i) => makeOrder(`o${i}`, day));
  const split = { ...makeOrder("split", "2026-11-02"), createdAt: "2026-11-02T06:00:00+07:00" };
  const forecast = buildStockForecast(
    [...orders, split],
    [...orders.map((order) => makeItem(order.id, "rice", 10, "Dry Goods", "ข้าว")), makeItem("split", "rice", 4, "Dry Goods", "ข้าว")],
    [customer], now
  );
  assert.equal(forecast.rows[0].customerOrderTimingSamples, 3);
  assert.equal(forecast.rows[0].skuCadenceDays, 4);
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

test("fresh meat demand follows actual customer ordering cadence, not an artificial two-day replenishment rule", () => {
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
  assert.equal(meat.effectiveCadenceDays, 4);
  assert.equal(meat.confidence, "low");
  assert.equal(rice.effectiveCadenceDays, 4);
  // The customer historically requested 20kg every 4 days, not 10kg every 2.
  assert.deepEqual(meat.days.map((day) => day.possibleQty), [20, 20, 20]);
  assert.deepEqual(rice.days.map((day) => day.possibleQty), [10, 10, 10]);
  assert.deepEqual(meat.days.map((day) => day.projectedQty), rice.days.map((day) => day.projectedQty * 2));
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
  assert.deepEqual(result.rows[0].days.map((day) => day.possibleQty), [20, 20, 20]);
  assert.ok(result.rows[0].days.every((day) => day.projectedProbability >= 0));
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
  assert.equal(result[0].units.length, 1);
  const kilos = result[0].units[0];
  assert.equal(kilos.yesterdayRequestedQty, 8);
  assert.equal(kilos.todayRequestedQty, 13.25);
  assert.deepEqual(kilos.days.map((day) => [day.knownQty, day.projectedQty, day.totalQty]), [
    [13.25, 4, 17.25], [2, 3.5, 5.5], [4, 3, 7],
  ]);
  assert.equal(kilos.customers.length, 2);
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
  assert.equal(result.length, 1);
  assert.equal(result[0].units.length, 2);
  assert.equal(result[0].customerCount, 2);
  const kilos = result[0].units.find((row) => row.unit === "กก.");
  const pieces = result[0].units.find((row) => row.unit === "ชิ้น");
  assert.equal(kilos.customers.length, 2);
  assert.equal(kilos.yesterdayRequestedQty, 4);
  assert.equal(pieces.yesterdayRequestedQty, 2);
  assert.equal(kilos.days[0].totalQty, 1.36);
  assert.equal(kilos.days[1].totalQty, 0);
  assert.equal(pieces.days[0].totalQty, 0);
  assert.equal(pieces.days[1].totalQty, 2);
});

test("unit switching preserves one periodic customer-SKU event and conditions the unit choice", () => {
  const days = ["2026-10-18", "2026-10-21", "2026-10-24", "2026-10-27", "2026-10-30", "2026-11-02"];
  const orders = days.map((day, i) => makeOrder(`shift${i}`, day));
  const items = days.map((_, i) => ({
    ...makeItem(`shift${i}`, "051262358", i < 3 ? 20 : 8, "Fresh Meat", "ซีพี คากิ"),
    unit: i < 3 ? "กก." : "ชิ้น",
  }));
  const forecast = buildStockForecast(orders, items, [customer], now);
  const rows = forecast.rows.filter((row) => row.sku === "051262358");
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.unit)), new Set(["กก.", "ชิ้น"]));
  assert.ok(rows.every((row) => row.skuCadenceDays === 3));
  assert.ok(rows.every((row) => row.purchaseDays === 6));
  const kg = rows.find((row) => row.unit === "กก.");
  const pieces = rows.find((row) => row.unit === "ชิ้น");
  assert.ok(Math.abs(kg.conditionalUnitShare + pieces.conditionalUnitShare - 1) < 1e-12);
  assert.ok(pieces.conditionalUnitShare > kg.conditionalUnitShare);
  for (let i = 0; i < forecast.dates.length; i++) {
    assert.ok((kg.days[i].projectedProbability ?? 0) + (pieces.days[i].projectedProbability ?? 0) <= 1 + 1e-12);
    assert.ok(!(kg.days[i].projectedQty > 0 && pieces.days[i].projectedQty > 0), "one customer cannot have two speculative unit modes");
  }
  assert.ok(pieces.days[1].projectedProbability > kg.days[1].projectedProbability, "recent pieces should be more probable");
  assert.equal(aggregateForecastByProduct(rows, forecast.dates).length, 1);
});

test("a booked SKU in another unit suppresses alternative speculative demand but keeps exact requested quantities", () => {
  const days = ["2026-10-18", "2026-10-21", "2026-10-24", "2026-10-27", "2026-10-30", "2026-11-02"];
  const priorOrders = days.map((day, i) => makeOrder(`shift${i}`, day));
  const orders = [
    ...priorOrders,
    { ...makeOrder("today-pieces", "2026-11-04", "awaiting_picking"), createdAt: "2026-11-03T19:00:00+07:00" },
    { ...makeOrder("today-kg", "2026-11-04", "awaiting_picking"), createdAt: "2026-11-03T20:00:00+07:00" },
  ];
  const items = [
    ...priorOrders.map((order, i) => ({ ...makeItem(order.id, "051262358", 20, "Fresh Meat", "คากิ"), unit: i < 3 ? "กก." : "ชิ้น" })),
    { ...makeItem("today-pieces", "051262358", 12, "Fresh Meat", "คากิ"), unit: "ชิ้น", confirmedQty: 0, actualQty: 0 },
    { ...makeItem("today-kg", "051262358", 4, "Fresh Meat", "คากิ"), unit: "กก.", confirmedQty: 0, actualQty: 0 },
  ];
  const forecast = buildStockForecast(orders, items, [customer], now);
  const product = aggregateForecastByProduct(forecast.rows, forecast.dates)[0];
  assert.equal(product.units.find((unit) => unit.unit === "ชิ้น").days[0].knownQty, 12);
  assert.equal(product.units.find((unit) => unit.unit === "กก.").days[0].knownQty, 4);
  assert.ok(product.units.every((unit) => unit.days[0].projectedQty === 0));
  assert.ok(product.units.every((unit) => unit.days[0].projectedProbability === undefined || unit.days[0].projectedProbability === 0));
});

test("weighed-by-piece requests join kg demand using historical kg per picked piece, never today's short pick", () => {
  const orders = [
    makeOrder("kg-old", "2026-10-25"),
    makeOrder("piece-old", "2026-10-29"),
    { ...makeOrder("piece-today", "2026-11-04", "awaiting_payment"), createdAt: "2026-11-03T18:00:00+07:00" },
  ];
  const items = [
    { ...makeItem("kg-old", "051262358", 8, "Fresh Meat", "คากิ"), masterUnit: "กก." },
    { ...makeItem("piece-old", "051262358", 10, "Fresh Meat", "คากิ"), unit: "ชิ้น", masterUnit: "กก.",
      confirmedQty: 10, actualPieceQty: 8, actualQty: 16, piecePricePerKg: 51, updatedAt: "2026-10-29T09:00:00+07:00" },
    { ...makeItem("piece-today", "051262358", 12, "Fresh Meat", "คากิ"), unit: "ชิ้น", masterUnit: "กก.",
      confirmedQty: 12, actualPieceQty: 10, actualQty: 19, piecePricePerKg: 51, updatedAt: "2026-11-04T12:00:00+07:00" },
  ];
  const result = buildStockForecast(orders, items, [customer], now);
  const product = aggregateForecastByProduct(result.rows, result.dates)[0];
  assert.deepEqual(product.units.map((unit) => unit.unit), ["กก."]);
  assert.equal(product.units[0].todayRequestedQty, 24);
  assert.equal(product.units[0].days[0].knownQty, 24);
  assert.equal(result.originalPieceDemand["051262358"].today, 12);
  assert.equal(result.weightConversions["051262358"].kgPerPiece, 2);
  assert.equal(result.weightConversions["051262358"].source, "measured");
  assert.equal(result.weightConversions["051262358"].confidence, "low");
  assert.deepEqual(normaliseForecastQuantity("051262358", "ชิ้น", 12, result.weightConversions), { unit: "กก.", quantity: 24 });
});

test("historical weight estimator prefers measured piece counts and resists a one-off heavy leg", () => {
  const ratios = [2.06, 2.188, 2.037, 2.005, 2.148, 2.084, 2.213, 2.530, 2.536, 2.857];
  const orders = ratios.map((_, index) => makeOrder(`w${index}`, "2026-10-29"));
  const items = ratios.map((ratio, index) => ({
    ...makeItem(`w${index}`, "051262358", 1, "Fresh Meat", "คากิ"), unit: "ชิ้น", masterUnit: "กก.",
    actualQty: ratio, actualPieceQty: 1, confirmedQty: 1, piecePricePerKg: 51,
    updatedAt: `2026-10-${String(21 + index).padStart(2, "0")}T12:00:00+07:00`,
  }));
  const { conversions } = estimatePieceWeights(orders, items, [customer], now);
  assert.equal(conversions["051262358"].kgPerPiece, 2.213);
  assert.equal(conversions["051262358"].source, "measured");
  assert.equal(conversions["051262358"].sampleCount, 10);
});

test("legacy missing piece-count weighing can provide a visibly low-confidence estimate", () => {
  const orders = [makeOrder("legacy", "2026-10-28")];
  const items = [{
    ...makeItem("legacy", "051262821", 2, "Fresh Meat", "สะโพกแต่งตัดชิ้น"),
    unit: "ชิ้น", masterUnit: "กก.", confirmedQty: 2, actualPieceQty: null,
    actualQty: 1.104, piecePricePerKg: 119, updatedAt: "2026-10-28T09:00:00+07:00",
  }];
  const result = buildStockForecast(orders, items, [customer], now);
  assert.equal(result.weightConversions["051262821"].kgPerPiece, 0.552);
  assert.equal(result.weightConversions["051262821"].source, "legacy_estimate");
  assert.equal(result.weightConversions["051262821"].confidence, "low");
  assert.deepEqual(normaliseForecastQuantity("051262821", "ชิ้น", 2, result.weightConversions),
    { unit: "กก.", quantity: 1.104 });
});

test("a weight recorded after the as-of time must not leak into earlier demand forecasts", () => {
  const orders = [makeOrder("future-weight", "2026-10-29")];
  const items = [{
    ...makeItem("future-weight", "051262358", 8, "Fresh Meat", "คากิ"),
    unit: "ชิ้น", masterUnit: "กก.", confirmedQty: 8, actualQty: 16,
    actualPieceQty: 8, piecePricePerKg: 51, updatedAt: "2026-11-05T10:00:00+07:00",
  }];
  const result = buildStockForecast(orders, items, [customer], now);
  assert.equal(result.weightConversions["051262358"], undefined);
  assert.deepEqual(result.missingWeightConversions, ["051262358"]);
  assert.deepEqual(normaliseForecastQuantity("051262358", "ชิ้น", 8, result.weightConversions),
    { unit: "ชิ้น", quantity: 8 });
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
