import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPaymentReadyOrders, summarizeOutstandingPayments } from "../lib/customerPayNow.ts";

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

test("customer home sums two unpaid invoices in satang, not floating-point baht", () => {
  const orders = getPaymentReadyOrders([
    row(257, "awaiting_payment", null, 681),
    row(258, "awaiting_payment", null, 425),
  ]);
  assert.deepEqual(summarizeOutstandingPayments(orders), { count: 2, totalAmount: 1106 });
  assert.deepEqual(summarizeOutstandingPayments([
    { orderNumber: 1, finalAmount: 0.1 },
    { orderNumber: 2, finalAmount: 0.2 },
  ]), { count: 2, totalAmount: 0.3 });
});

test("unknown invoice value does not produce a misleading partial total", () => {
  assert.deepEqual(summarizeOutstandingPayments([
    { orderNumber: 1, finalAmount: 100 },
    { orderNumber: 2, finalAmount: null },
  ]), { count: 2, totalAmount: null });
  assert.deepEqual(summarizeOutstandingPayments([]), { count: 0, totalAmount: 0 });
  assert.deepEqual(summarizeOutstandingPayments([
    { orderNumber: 3, finalAmount: -5 },
  ]), { count: 1, totalAmount: null });
});

test("grouped children count once when combined with another payable bill", () => {
  const root = new Map([["root-1", { order_number: 500, final_amount: 681 }]]);
  const orders = getPaymentReadyOrders([
    { ...row(501, "awaiting_payment", 1, 300), group_root_order_id: "root-1" },
    { ...row(502, "awaiting_payment", 2, 381), group_root_order_id: "root-1" },
    row(503, "awaiting_payment", null, 425),
  ], root);
  assert.deepEqual(summarizeOutstandingPayments(orders), { count: 2, totalAmount: 1106 });
});

test("customer home fetches only authorized pending-payment summaries", () => {
  const home = readFileSync(new URL("../app/miniapp/page.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/line/orders/route.ts", import.meta.url), "utf8");
  assert.match(home, /summaryOnly:\s*true/);
  assert.match(home, /\/miniapp\/payment\?customer=/);
  assert.match(home, /\/miniapp\/payments\?customer=/);
  assert.match(home, /payableOrders\.length === 1/);
  assert.match(home, /summarizeOutstandingPayments\(payableOrders\)/);
  assert.match(home, /ยอดค้างชำระรวม/);
  assert.match(home, /ชำระเงิน \/ อัปโหลดสลิป/);
  assert.match(home, /<PaymentSlipIcon \/>/);
  assert.match(home, /text-\[22px\] font-extrabold leading-tight">ชำระเงิน \/ อัปโหลดสลิป/);
  assert.match(home, /text-\[clamp\(22px,6\.5vw,30px\)\] font-black leading-tight tabular-nums/);
  const paymentCard = home.split("{payableOrders.length > 0 && (")[1]?.split("{paymentCheckFailed && (")[0] ?? "";
  assert.ok(paymentCard.indexOf("ยอดชำระ") < paymentCard.indexOf("<NavigationArrow prominent />"));
  assert.doesNotMatch(paymentCard, /mt-3 rounded-xl bg-white\/35/);
  assert.doesNotMatch(paymentCard, /payableOrders\.map/);
  assert.match(api, /summaryOnly\s*=\s*body\.summaryOnly\s*===\s*true/);
  assert.match(api, /\.eq\("status",\s*"awaiting_payment"\)/);
  assert.match(api, /getPaymentReadyOrders\(orders, rootsById\)/);
});

test("bill selection refreshes authorized invoices and routes to individual payments", () => {
  const selector = readFileSync(new URL("../app/miniapp/payments/page.tsx", import.meta.url), "utf8");
  const payment = readFileSync(new URL("../app/miniapp/payment/page.tsx", import.meta.url), "utf8");
  assert.match(selector, /lineApiFetch\("\/api\/line\/orders"/);
  assert.match(selector, /summaryOnly: true/);
  assert.match(selector, /idToken,/);
  assert.match(selector, /เลือกบิลที่ต้องการชำระ/);
  assert.match(selector, /orders\.map\(\(order\) =>/);
  assert.match(selector, /&order=\$\{orderNumber\}&from=payments/);
  assert.match(payment, /params\.get\("from"\) === "payments"/);
  assert.match(payment, /miniapp\/payments\?customer=/);
});
