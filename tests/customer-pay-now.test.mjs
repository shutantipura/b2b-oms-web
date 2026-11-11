import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPaymentReadyOrders } from "../lib/customerPayNow.ts";

const row = (order_number, status, group_sequence = null, final_amount = 540) => ({
  order_number, status, group_sequence, final_amount,
});

test("Pay now is available only after delivery/billing has reached awaiting_payment", () => {
  assert.deepEqual(getPaymentReadyOrders([
    row(101, "ready_for_delivery"),
    row(102, "out_for_delivery"),
    row(103, "awaiting_payment"),
    row(104, "payment_submitted"),
    row(105, "completed"),
    row(106, "cancelled"),
  ]), [{ orderNumber: 103, finalAmount: 540 }]);
});

test("grouped children do not create duplicate payment destinations", () => {
  assert.deepEqual(getPaymentReadyOrders([
    row(200, "awaiting_payment", 1, "850.50"),
    row(201, "awaiting_payment", 2),
    row(202, "awaiting_payment", 3),
    row(200, "awaiting_payment", 1),
  ]), [{ orderNumber: 200, finalAmount: 850.5 }]);
});

test("grouped invoices link to the parent payment order and show its bill total", () => {
  const roots = new Map([["root-1", { order_number: 900, final_amount: 1200.75 }]]);
  assert.deepEqual(getPaymentReadyOrders([
    { ...row(901, "awaiting_payment", 1, 400), group_root_order_id: "root-1" },
    { ...row(902, "awaiting_payment", 2, 800), group_root_order_id: "root-1" },
  ], roots), [{ orderNumber: 900, finalAmount: 1200.75 }]);
});

test("multiple independent unpaid orders keep their own links, including store pickup", () => {
  assert.deepEqual(getPaymentReadyOrders([
    row(301, "awaiting_payment", null, null),
    row(302, "awaiting_payment", null, 120.25),
  ]), [
    { orderNumber: 301, finalAmount: null },
    { orderNumber: 302, finalAmount: 120.25 },
  ]);
});

test("customer home fetches only authorized pending-payment summaries", () => {
  const home = readFileSync(new URL("../app/miniapp/page.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/line/orders/route.ts", import.meta.url), "utf8");
  assert.match(home, /summaryOnly:\s*true/);
  assert.match(home, /\/miniapp\/payment\?customer=/);
  assert.match(home, /ชำระเงิน \/ อัปโหลดสลิป/);
  assert.match(home, /<PaymentSlipIcon \/>/);
  assert.match(home, /text-\[22px\] font-extrabold leading-tight">ชำระเงิน \/ อัปโหลดสลิป/);
  assert.match(home, /text-\[34px\] font-black leading-tight tabular-nums/);
  assert.match(api, /summaryOnly\s*=\s*body\.summaryOnly\s*===\s*true/);
  assert.match(api, /\.eq\("status",\s*"awaiting_payment"\)/);
  assert.match(api, /getPaymentReadyOrders\(orders, rootsById\)/);
});
