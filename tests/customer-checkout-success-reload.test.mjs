import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkoutReceiptKey, parseCheckoutReceipt, CHECKOUT_RECEIPT_MAX_AGE_MS } from "../lib/checkoutReceipt.ts";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const checkout = read("app/miniapp/checkout/page.tsx");
const shop = read("app/miniapp/shop/page.tsx");

const now = Date.parse("2026-11-15T09:00:00Z");
const receipt = (extras={}) => JSON.stringify({
  customerCode: "SHOP-ABC", orderNumber: 215, displayNumber: "215/2",
  grouped: true, savedAt: now, ...extras,
});

test("receipt survives reload for the correct customer only", () => {
  assert.equal(checkoutReceiptKey(" shop-abc "), "b2b-checkout-receipt-SHOP-ABC");
  assert.deepEqual(parseCheckoutReceipt(receipt(), "shop-abc", now), {
    customerCode: "SHOP-ABC", orderNumber: 215,
    displayNumber: "215/2", grouped: true, savedAt: now,
  });
  assert.equal(parseCheckoutReceipt(receipt(), "SHOP-OTHER", now), null);
  assert.equal(parseCheckoutReceipt("invalid json", "SHOP-ABC", now), null);
  assert.equal(parseCheckoutReceipt("", "SHOP-ABC", now), null);
  assert.equal(parseCheckoutReceipt(receipt({orderNumber:0}), "SHOP-ABC", now), null);
  assert.equal(parseCheckoutReceipt(receipt({displayNumber:"<script>"}), "SHOP-ABC", now), null);
  assert.equal(parseCheckoutReceipt(receipt({savedAt:now-CHECKOUT_RECEIPT_MAX_AGE_MS-1}),"SHOP-ABC",now),null);
  assert.equal(parseCheckoutReceipt(receipt({savedAt:now+60_001}),"SHOP-ABC",now),null);
});

test("checkout restores the confirmation before empty-cart and LIFF initialization",()=>{
  const restore=checkout.indexOf("const receipt = parseCheckoutReceipt(");
  const cartRead=checkout.indexOf("const stored = localStorage.getItem(");
  const liff=checkout.indexOf('import("@line/liff")');
  assert.ok(restore>0&&cartRead>restore&&liff>cartRead);
  const success=checkout.indexOf("if (createdOrderNumber !== null)");
  const empty=checkout.indexOf("if (emptyCart)");
  const noCustomer=checkout.indexOf("if (!customer) {");
  assert.ok(success>0&&empty>success&&noCustomer>empty);
  assert.match(checkout,/customer\?\.customerCode \?\? checkoutCustomerCode/);
  assert.match(checkout,/setCreatedOrderNumber\(receipt.orderNumber\)/);
  assert.match(checkout,/setCreatedDisplayNumber\(receipt.displayNumber\)/);
});

test("submission persists receipt before clearing cart, without re-submitting",()=>{
  const saved=checkout.indexOf("localStorage.setItem(receiptKey");
  const cleared=checkout.indexOf("localStorage.removeItem(\x60b2b-cart-");
  assert.ok(saved>0&&cleared>saved);
  assert.match(checkout,/if \(savedReceipt\) \{/);
  assert.match(checkout,/sessionStorage.setItem\(receiptKey/);
  assert.match(checkout,/b2b-checkout-attempt-/);
  assert.match(checkout,/setCreatedOrderNumber\(receipt.orderNumber\)/);
  assert.doesNotMatch(checkout,/router.push\(\x60\/miniapp\/checkout/);
});

test("adding products for another order invalidates the previous receipt",()=>{
  assert.match(shop,/if \(cartHasPositiveQuantity\(newCart\)\) \{/);
  assert.match(shop,/localStorage.removeItem\(receiptKey\)/);
  assert.match(shop,/sessionStorage.removeItem\(receiptKey\)/);
});
