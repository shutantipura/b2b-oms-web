import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync("app/api/line/checkout/route.ts", "utf8");
const page = readFileSync("app/miniapp/checkout/page.tsx", "utf8");
const access = readFileSync("lib/server/lineCustomerAccess.ts", "utf8");
const validation = readFileSync("lib/deliveryLocations.ts", "utf8");

test("LINE customer authorization guards location mutations", () => {
  assert.ok(api.indexOf("await verifyLineAndCustomer(") < api.indexOf('if (action === "save-locations")'));
  assert.match(api, /expectedLocationsVersion !== customer.updated_at/);
  assert.match(api, /\.eq\("id", customer.id\)/);
  assert.match(api, /\.eq\("updated_at", customer.updated_at\)/);
  assert.match(api, /validateDeliveryLocations\(body.locations\)/);
  assert.match(api, /delivery_address: locations\[0\]\?\.url \?\? null/);
  assert.match(api, /delivery_map_url_2: locations\[1\]\?\.url \?\? null/);
});

test("Google Maps validation is narrowly scoped", () => {
  assert.match(validation, /MAX_DELIVERY_LOCATIONS = 2/);
  assert.match(validation, /url.protocol !== "https:"/);
  assert.match(validation, /maps.app.goo.gl/);
  assert.match(validation, /new Set\(items.map/);
  assert.match(validation, /label.length > 60/);
});

test("checkout can add rename and delete; existing orders remain separate", () => {
  assert.match(page, /function openLocationEditor/);
  assert.match(page, /async function saveLocation/);
  assert.match(page, /async function deleteLocation/);
  assert.match(page, /setCustomer\(data.customer\)/);
  assert.match(page, /action: "save-locations"/);
  assert.match(api, /p_delivery_address: deliveryAddress/);
  assert.match(access, /updated_at/);
});
