import test from "node:test";
import assert from "node:assert/strict";
import { bangkokToday, isPaymentOverdue, overdueOrderNumbers, shopWarnings } from "../lib/shopWarnings.ts";

test("payment becomes overdue after 21:00 Bangkok on the delivery date", () => {
  // 21:00 Bangkok = 14:00 UTC
  assert.equal(isPaymentOverdue("2026-11-16", new Date("2026-11-16T13:59:00Z")), false);
  assert.equal(isPaymentOverdue("2026-11-16", new Date("2026-11-16T14:00:00Z")), false);
  assert.equal(isPaymentOverdue("2026-11-16", new Date("2026-11-16T14:01:00Z")), true);
  assert.equal(isPaymentOverdue("not-a-date", new Date()), false);
});

test("Bangkok today rolls over at 17:00 UTC", () => {
  assert.equal(bangkokToday(new Date("2026-11-16T16:59:00Z")), "2026-11-16");
  assert.equal(bangkokToday(new Date("2026-11-16T17:00:00Z")), "2026-11-17");
});

test("grouped bills count once and only overdue orders are listed", () => {
  const now = new Date("2026-11-16T15:00:00Z");
  assert.deepEqual(overdueOrderNumbers([
    { order_number: 12, delivery_date: "2026-11-15", group_sequence: null },
    { order_number: 10, delivery_date: "2026-11-14", group_sequence: 1 },
    { order_number: 11, delivery_date: "2026-11-14", group_sequence: 2 },
    { order_number: 13, delivery_date: "2026-11-17", group_sequence: null },
  ], now), [10, 12]);
});

test("shop warnings cover missing/suspended CV, no LINE access and overdue payments", () => {
  assert.deepEqual(shopWarnings({ cvAccount: { status: "approved" }, lineLinked: true, overdueOrders: [] }), []);
  assert.deepEqual(shopWarnings({ cvAccount: null, lineLinked: false, overdueOrders: [5] }),
    ["no_cv", "no_line", "overdue_payment"]);
  assert.deepEqual(shopWarnings({ cvAccount: { status: "deactivated" }, lineLinked: true, overdueOrders: [] }), ["no_cv"]);
});
