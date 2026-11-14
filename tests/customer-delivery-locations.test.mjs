import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isGoogleMapsUrl, validateDeliveryLocations } from "../lib/deliveryLocations.ts";

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

test("accepts real Google Maps formats but blocks lookalike or insecure hosts", () => {
  assert.equal(isGoogleMapsUrl("https://maps.app.goo.gl/ExampleLocation?g_st=ic"), true);
  assert.equal(isGoogleMapsUrl("https://www.google.com/maps/place/Example"), true);
  assert.equal(isGoogleMapsUrl("https://maps.google.co.th/?q=13.5,100.6"), true);
  assert.equal(isGoogleMapsUrl("https://goo.gl/maps/Example"), true);
  assert.equal(isGoogleMapsUrl("https://google.com.evil.test/maps/place/Example"), false);
  assert.equal(isGoogleMapsUrl("http://maps.app.goo.gl/Example"), false);
  assert.equal(isGoogleMapsUrl("https://example.com/maps/place/Example"), false);
});

test("allows removal of all locations and rejects invalid batches", () => {
  assert.deepEqual(validateDeliveryLocations([]), []);
  assert.deepEqual(
    validateDeliveryLocations([{label:" หน้าร้าน ",url:" https://maps.app.goo.gl/Test1 "}]),
    [{label:"หน้าร้าน",url:"https://maps.app.goo.gl/Test1"}]
  );
  assert.throws(() => validateDeliveryLocations([{label:"",url:"https://maps.app.goo.gl/Test1"}]));
  assert.throws(() => validateDeliveryLocations([{label:"A",url:"https://phishing.example/maps"}]));
  assert.throws(() => validateDeliveryLocations([
    {label:"A",url:"https://maps.app.goo.gl/Test1"},
    {label:"B",url:"https://maps.app.goo.gl/Test1"},
  ]));
  assert.throws(() => validateDeliveryLocations([
    {label:"A",url:"https://maps.app.goo.gl/Test1"},
    {label:"B",url:"https://maps.app.goo.gl/Test2"},
    {label:"C",url:"https://maps.app.goo.gl/Test3"},
  ]));
});

test("primary location defaults to the shop name, without overwriting customized names", () => {
  const api = readFileSync("app/api/line/checkout/route.ts", "utf8");
  const create = readFileSync("app/customers/new/page.tsx", "utf8");
  const managerEdit = readFileSync("app/customers/[customerCode]/page.tsx", "utf8");
  const checkout = readFileSync("app/miniapp/checkout/page.tsx", "utf8");
  assert.match(api, /customer\.customer_name : customer\.delivery_location_1_name\.trim\(\)/);
  assert.match(create, /delivery_location_1_name: locationName1\.trim\(\) \|\| name/);
  assert.match(managerEdit, /delivery_location_1_name: locationName1\.trim\(\) \|\| customerName\.trim\(\)/);
  assert.match(checkout, /placeholder=\{locationEditIndex === 0 \? customer\.customerName/);
});

test("compact delivery card has selection and separate edit, delete, maps actions", () => {
  const checkout = readFileSync("app/miniapp/checkout/page.tsx", "utf8");
  assert.match(checkout, /const selected = deliveryAddress === location\.url/);
  assert.match(checkout, /aria-pressed=\{selected\}/);
  assert.match(checkout, /ดูใน Google Maps/);
  assert.match(checkout, /onClick=\{\(\) => openLocationEditor\(index\)\}/);
  assert.match(checkout, /onClick=\{\(\) => void deleteLocation\(index\)\}/);
  assert.match(checkout, /MAX_DELIVERY_LOCATIONS/);
});
