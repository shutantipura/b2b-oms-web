import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const catalog = readFileSync(new URL("../app/catalog/page.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../app/catalog/ManualMasterPriceEditor.tsx", import.meta.url), "utf8");

const start = catalog.indexOf('<section id="catalog-master"');
const end = catalog.indexOf('{/* 2. VISIBLE SKU */}', start);
const section = catalog.slice(start, end);

test("Product Master shows availability control openly before Excel upload", () => {
  assert.ok(start !== -1 && end > start);
  const control = section.indexOf("<ManualMasterPriceEditor");
  const excel = section.indexOf("<CatalogExportButton");
  assert.ok(control >= 0 && control < excel, "SKU control must come before Excel tools");
  assert.match(section, /id="catalog-master-availability"/);
  assert.equal(section.split("<ManualMasterPriceEditor").length - 1, 1);
});

test("availability is not hidden under an unrelated price-only accordion", () => {
  const control = section.indexOf("<ManualMasterPriceEditor");
  const prefix = section.slice(0, control);
  assert.doesNotMatch(prefix, /<details\b/);
  assert.doesNotMatch(section, /ต้องการแก้ไขเพียงสินค้าเดียว\?/);
  assert.match(section, /สินค้าหมดชั่วคราว \(Out of Stock\)/);
  assert.match(catalog, /01<\/span> สินค้าหมด \/ ราคา/);
});

test("the visible editor retains manager-only reversible SKU controls", () => {
  assert.match(editor, /สินค้าหมดชั่วคราว \(Out of Stock\)/);
  assert.match(editor, /search_master_price_adjustments/);
  assert.match(editor, /set_product_customer_out_of_stock/);
  assert.match(editor, /เปิดให้สั่งซื้ออีกครั้ง/);
  assert.match(editor, /ปิดรับออเดอร์/);
});
