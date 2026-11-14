import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {cartHasPositiveQuantity} from "../lib/customerCart.ts";

const checkout=readFileSync(new URL("../app/miniapp/checkout/page.tsx",import.meta.url),"utf8");
const shop=readFileSync(new URL("../app/miniapp/shop/page.tsx",import.meta.url),"utf8");

test("missing, empty, removed and zero-quantity carts count as empty",()=>{
  for(const cart of [null,undefined,{},{"123":0},{"123":-1},{"123":0,"456":0},[],false])
    assert.equal(cartHasPositiveQuantity(cart),false);
  assert.equal(cartHasPositiveQuantity({"123":1}),true);
  assert.equal(cartHasPositiveQuantity({"123":0,"456":0.5}),true);
});

test("empty carts do not throw a failed-order message or initialize LINE checkout",()=>{
  assert.match(checkout,/if \(!stored\) \{\s*if \(!cancelled\) setEmptyCart\(true\);\s*return;/);
  assert.match(checkout,/if \(!cartHasPositiveQuantity\(loadedCart\)\) \{\s*if \(!cancelled\) setEmptyCart\(true\);\s*return;/);
  assert.doesNotMatch(checkout,/throw new Error\("ตะกร้าสินค้าว่าง"\)/);
  assert.match(checkout,/if \(!data.items\?\.length\) \{\s*setEmptyCart\(true\);\s*return;/);
});

test("empty checkout displays a friendly Thai basket and returns to the selected shop",()=>{
  assert.match(checkout,/if \(emptyCart\) \{/);
  assert.match(checkout,/ยังไม่มีสินค้าในตะกร้า/);
  assert.match(checkout,/onClick=\{goShop\}/);
  assert.match(checkout,/เลือกสินค้า/);
  assert.match(checkout,/customer\?\.customerCode \?\? checkoutCustomerCode/);
  assert.match(checkout,/\/miniapp\/shop\?customer=\$\{encodeURIComponent\(code\)\}/);
  assert.match(shop,/cartProducts\.length === 0 \? \(/);
  assert.match(shop,/ยังไม่มีสินค้าในตะกร้า/);
});

test("genuine checkout failures still show their original error UI",()=>{
  assert.match(checkout,/if \(!customer\) \{/);
  assert.match(checkout,/ไม่สามารถดำเนินการสั่งซื้อได้/);
  assert.match(checkout,/setMessage\(error instanceof Error \? error.message/);
});
