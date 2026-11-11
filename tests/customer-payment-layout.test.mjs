import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/miniapp/payment/page.tsx", import.meta.url), "utf8");

test("the payment page presents amount, expandable bill, QR and slip upload in order", () => {
  const amount = page.indexOf("ยอดที่ต้องชำระ");
  const bill = page.indexOf('<details id="bill-details"');
  const qr = page.indexOf("สแกน QR เพื่อชำระเงิน");
  const upload = page.indexOf('id="upload-slip"');

  assert.ok(amount >= 0 && amount < bill);
  assert.ok(bill < qr && qr < upload);
  assert.match(page, /group-open:rotate-180/);
  assert.match(page, /max-h-\[315px\]/);
  assert.match(page, /เปิดรูป QR เต็มขนาด/);
});

test("the redesigned page retains authenticated one-bill slip submission and review", () => {
  assert.match(page, /lineApiFetch\("\/api\/line\/payment"/);
  assert.match(page, /prepareOrderPhoto\(slipFile, "payment_slip"\)/);
  assert.match(page, /formData\.append\("orderNumber", String\(data\.order\.orderNumber\)\)/);
  assert.match(page, /data\.order\.status !== "awaiting_payment"/);
  assert.match(page, /status: "payment_submitted"/);
  assert.match(page, /window\.confirm\(/);
  assert.match(page, /accept="image\/\*,application\/pdf"/);
  assert.match(page, /files\.paymentQr2/);
  assert.match(page, /files\.bill2/);
  assert.match(page, /fromBillSelection/);
});
