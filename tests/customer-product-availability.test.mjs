import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261112134000_customer_out_of_stock_control.sql", import.meta.url), "utf8");
const editor = readFileSync(new URL("../app/catalog/ManualMasterPriceEditor.tsx", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../app/api/line/catalog/route.ts", import.meta.url), "utf8");
const shop = readFileSync(new URL("../app/miniapp/shop/page.tsx", import.meta.url), "utf8");
const checkout = readFileSync(new URL("../app/api/line/checkout/route.ts", import.meta.url), "utf8");

test("stock label is optional and preserves existing SKU orderability on migration", () => {
  assert.match(migration, /add column if not exists is_customer_out_of_stock boolean not null default false/i);
  assert.match(migration, /create or replace function public\.set_product_customer_out_of_stock/);
  assert.match(migration, /if not public\.can_read_product_costs\(\)/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.set_product_customer_out_of_stock/);
  assert.match(migration, /to authenticated/);
});

test("manager can mark an individual SKU unavailable or restore it", () => {
  assert.match(editor, /set_product_customer_out_of_stock/);
  assert.match(editor, /p_product_id: productId/);
  assert.match(editor, /p_out_of_stock: nextState/);
  assert.match(editor, /is_customer_out_of_stock/);
  assert.match(editor, /สินค้าหมดชั่วคราว — ปิดรับออเดอร์/);
  assert.match(editor, /เปิดให้สั่งซื้ออีกครั้ง/);
  assert.match(editor, /availabilitySaving/);
});

test("customer catalog includes status in search, favourites, and saved basket", () => {
  assert.match(catalogue, /const outOfStockIds = new Set<string>\(\)/);
  assert.match(catalogue, /\.select\("id, is_customer_out_of_stock"\)/);
  assert.match(catalogue, /allProductIds/);
  assert.match(catalogue, /isOutOfStock: outOfStockIds\.has\(product\.id\)/);
  assert.match(catalogue, /const favourites =/);
  assert.match(catalogue, /const cartProducts =/);
});

test("unavailable items stay visible but are not added to the basket", () => {
  assert.match(shop, /สินค้าหมดชั่วคราว/);
  assert.match(shop, /product\.isOutOfStock \? \(/);
  assert.match(shop, /if \(product\.isOutOfStock && direction > 0\) return/);
  assert.match(shop, /const hasUnavailableCartItems = cartProducts\.some/);
  assert.match(shop, /disabled=\{cartProducts\.length === 0 \|\| hasUnavailableCartItems\}/);
  assert.match(shop, /delete nextCart\[product\.id\]/);
  assert.match(shop, /นำออกจากตะกร้า/);
});

test("checkout validates the live flag server-side, not just the customer card", () => {
  assert.match(checkout, /is_customer_out_of_stock/);
  assert.match(checkout, /products\.filter\(product => product\.is_customer_out_of_stock\)/);
  assert.match(checkout, /สินค้าหมดชั่วคราว กรุณากลับไปนำออกจากตะกร้า/);
  assert.match(checkout, /unavailableProduct \? 409 : 500/);
});
