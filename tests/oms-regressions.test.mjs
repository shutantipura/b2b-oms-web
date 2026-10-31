import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupOrdersForManagement, orderDisplayNumber } from "../lib/groupOrderDisplay.ts";
import { combinePickedItems } from "../lib/groupedOrderItems.ts";
import {
  DELIVERY_RULES,
  getAvailableSlots,
  getManagerDeliveryOptions,
  validateDeliverySelection,
  getOrderDeliveryUrgency,
} from "../lib/deliveryRules.ts";
import {
  clearLineSessionReload,
  isLineIdTokenExpired,
  lineApiFetch,
} from "../lib/lineSession.ts";

const day = "2026-10-26";
const bangkokTime = (hour, minute = 0) =>
  new Date(Date.UTC(2026, 9, 26, hour - 7, minute));

test("customer sees 11:00–13:00 at 10:00 Bangkok time", () => {
  const options = getAvailableSlots(day, bangkokTime(10));
  assert.ok(options.some((slot) => slot.value === "11:00–13:00"));
  assert.equal(validateDeliverySelection(day, "11:00–13:00", bangkokTime(10)).valid, true);
  assert.equal(validateDeliverySelection(day, "09:00–11:00", bangkokTime(10)).valid, false);
});

test("manager rescheduling observes two-hour lead and all seven windows", () => {
  assert.equal(DELIVERY_RULES.slots.length, 7);
  assert.ok(DELIVERY_RULES.slots.some((slot) => slot.value === "19:00–21:00"));
  const today = getManagerDeliveryOptions(bangkokTime(10, 4))[0];
  assert.equal(today.date, day);
  assert.ok(today.slots.some((slot) => slot.value === "11:00–13:00"));
});

test("completed delivery never displays an overdue alarm", () => {
  assert.equal(
    getOrderDeliveryUrgency(
      { status: "completed", delivery_date: "2026-10-25", delivery_slot: "09:00–11:00" },
      { date: day, minutes: 14 * 60 }
    ),
    "none"
  );
});

function fakeIdToken(exp) {
  return "header." + Buffer.from(JSON.stringify({ exp })).toString("base64url") + ".signature";
}

function fakeBrowser() {
  const values = new Map();
  let reloadCount = 0;
  return {
    window: {
      sessionStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
      location: { reload: () => { reloadCount += 1; } },
    },
    getReloadCount: () => reloadCount,
  };
}

test("expired LINE token triggers at most one reload before actionable error", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const mock = fakeBrowser();
  globalThis.window = mock.window;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; throw new Error("unexpected network request"); };
  try {
    const expired = fakeIdToken(Math.floor(Date.now() / 1000) - 300);
    assert.equal(isLineIdTokenExpired(expired), true);
    const options = { method: "POST", body: JSON.stringify({ idToken: expired }) };
    await assert.rejects(lineApiFetch("/api/line/catalog", options), /กำลังเชื่อมต่อใหม่/);
    await assert.rejects(lineApiFetch("/api/line/catalog", options), /กรุณาปิดแล้วเปิด/);
    assert.equal(mock.getReloadCount(), 1);
    assert.equal(fetchCount, 0);
  } finally {
    clearLineSessionReload();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("server-side LINE rejection triggers bounded reinitialization", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const mock = fakeBrowser();
  globalThis.window = mock.window;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ code: "LINE_ID_TOKEN_INVALID" }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
  try {
    const valid = fakeIdToken(Math.floor(Date.now() / 1000) + 3600);
    assert.equal(isLineIdTokenExpired(valid), false);
    const options = { method: "POST", body: JSON.stringify({ idToken: valid }) };
    await assert.rejects(lineApiFetch("/api/line/orders", options), /กำลังเชื่อมต่อใหม่/);
    await assert.rejects(lineApiFetch("/api/line/orders", options), /กรุณาปิดแล้วเปิด/);
    assert.equal(mock.getReloadCount(), 1);
  } finally {
    clearLineSessionReload();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("rider page includes products for both grouped and standalone orders", () => {
  const source = readFileSync(new URL("../app/tasks/delivery/[orderNumber]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /from\("group_billing_lines"\)/);
  assert.match(source, /from\("order_items"\)/);
  assert.match(source, /deliveryItems\.map/);
  assert.match(source, /item\.product_name_snapshot/);
  assert.match(source, /item\.actual_qty/);
});

test("public browser alarm uses a read-only feed and local acknowledgements", () => {
  const source = readFileSync(new URL("../app/order-alarm/page.tsx", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/order-alarm\/feed"/);
  assert.match(source, /window\.localStorage\.setItem\(LOCAL_ACK_STORAGE_KEY/);
  assert.doesNotMatch(source, /rpc\("acknowledge_order_alarm"/);
  assert.match(source, /setInterval\(\(\) => void refresh\(\), 5000\)/);
  assert.match(source, /setInterval\(playPulse, 1550\)/);
  assert.match(source, /alarmsRef\.current\.length > 0/);
  assert.match(source, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(source, /function testSound\(/);
});

test("native Android cross-device acknowledgement uses a station bearer token", () => {
  const source = readFileSync(new URL("../android-alarm/app/src/main/java/com/lotusb2b/alarm/StationHealth.java", import.meta.url), "utf8");
  const server = readFileSync(new URL("../app/api/alarm-station/ack/route.ts", import.meta.url), "utf8");
  assert.match(source, /post\("ack", token,/);
  assert.match(server, /\.is\("revoked_at", null\)/);
  assert.match(server, /\.eq\("secret_hash", tokenHash\)/);
});

test("unpairing revokes the old station and clears the Android OMS session", () => {
  const native = readFileSync(new URL("../android-alarm/app/src/main/java/com/lotusb2b/alarm/StationHealth.java", import.meta.url), "utf8");
  const server = readFileSync(new URL("../app/api/alarm-station/unpair/route.ts", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../app/api/admin/terminals/route.ts", import.meta.url), "utf8");
  assert.match(native, /post\("unpair", token,/);
  assert.match(native, /WebStorage\.getInstance\(\)\.deleteAllData\(\)/);
  assert.match(server, /if \(station\.revoked_at\)/);
  assert.match(server, /update\(\{ revoked_at: now \}\)/);
  assert.match(manager, /activateStaffId/);
});

test("No CV customer profiles use internal IDs and default billing to B2B Barcode", () => {
  const create = readFileSync(new URL("../app/customers/new/page.tsx", import.meta.url), "utf8");
  const edit = readFileSync(new URL("../app/customers/[customerCode]/page.tsx", import.meta.url), "utf8");
  const billing = readFileSync(new URL("../app/tasks/billing/[orderNumber]/page.tsx", import.meta.url), "utf8");
  assert.match(create, /"NCV-" \+ crypto\.randomUUID\(\)/);
  assert.match(create, /has_no_cv: noCv/);
  assert.match(edit, /setNoCv\(Boolean\(loadedCustomer\.has_no_cv\)\)/);
  assert.match(edit, /has_no_cv: noCv/);
  assert.match(billing, /setBillingMode\(loadedOrder\.customers\?\.has_no_cv \? "no_cv" : "normal"\)/);
});

test("completed task reporting uses Bangkok day boundaries and counts finished claims by type", async () => {
  const {
    bangkokCalendarDate,
    addCalendarDays,
    completedTaskDateWindow,
    summarizeCompletedTasks,
  } = await import("../lib/staffTaskReport.ts");

  assert.equal(
    bangkokCalendarDate(new Date("2026-10-28T18:00:00.000Z")),
    "2026-10-29"
  );
  assert.equal(addCalendarDays("2026-10-30", 2), "2026-11-01");
  assert.deepEqual(
    completedTaskDateWindow("2026-10-29", "2026-10-29"),
    {
      fromInclusive: "2026-10-28T17:00:00.000Z",
      toExclusive: "2026-10-29T17:00:00.000Z",
    }
  );
  assert.throws(
    () => completedTaskDateWindow("2026-10-30", "2026-10-29"),
    /วันที่เริ่มต้น/
  );

  const tasks = [
    { id: "1", staff_id: "s1", stage: "confirmation", claim_status: "completed", completed_at: "2026-10-29T01:00:00Z" },
    { id: "2", staff_id: "s1", stage: "picking", claim_status: "completed", completed_at: "2026-10-29T02:00:00Z" },
    { id: "3", staff_id: "s2", stage: "billing", claim_status: "completed", completed_at: "2026-10-29T03:00:00Z" },
    { id: "4", staff_id: "s1", stage: "picking", claim_status: "released", completed_at: null },
  ];
  const counts = summarizeCompletedTasks(tasks);
  assert.equal(counts.overall.total, 3);
  assert.equal(counts.overall.byStage.picking, 1);
  assert.equal(counts.overall.byStage.billing, 1);
  assert.equal(counts.byStaff.get("s1")?.total, 2);
  assert.equal(counts.byStaff.get("s2")?.byStage.billing, 1);

  const page = readFileSync(new URL("../components/StaffResponsibilities.tsx", import.meta.url), "utf8");
  assert.match(page, /\.eq\("claim_status", "completed"\)/);
  assert.match(page, /\.gte\("completed_at", fromInclusive\)/);
  assert.match(page, /\.lt\("completed_at", toExclusive\)/);
  assert.match(page, /\.range\(page \* PAGE_SIZE,/);
});


test("historical customer order lines use actual picked quantities and saved unit prices", async () => {
  const { historicalLineValues } = await import("../lib/customerOrderHistory.ts");
  assert.deepEqual(historicalLineValues({ actual: 3.066, actualUnit: "กก.", unitPrice: 121 }),
    { actual: 3.066, unit: "กก.", unitPrice: 121, lineValue: 370.986 });
  assert.deepEqual(historicalLineValues({ actual: 2, actualUnit: "ชิ้น", unitPrice: 127 }),
    { actual: 2, unit: "ชิ้น", unitPrice: 127, lineValue: 254 });
  assert.deepEqual(historicalLineValues({ actual: 1.104, actualUnit: "กก.", isPiece: true, unitPrice: 0, pricePerKg: 119 }),
    { actual: 1.104, unit: "กก.", unitPrice: 119, lineValue: 131.376 });
  assert.deepEqual(historicalLineValues({ actual: null, actualUnit: "ชิ้น", unitPrice: 141 }),
    { actual: null, unit: "ชิ้น", unitPrice: 141, lineValue: null });
  assert.deepEqual(historicalLineValues({ actual: 0, actualUnit: "กก.", unitPrice: 95 }),
    { actual: 0, unit: "กก.", unitPrice: 95, lineValue: 0 });
  assert.deepEqual(historicalLineValues({ actual: 5, actualUnit: "ชิ้น", unitPrice: 20, priceIsCurrentEstimate: true }),
    { actual: 5, unit: "ชิ้น", unitPrice: null, lineValue: null });
  const page = readFileSync(new URL("../app/miniapp/orders/page.tsx", import.meta.url), "utf8");
  assert.match(page, /mode === "history" \? \([\s\S]*?<HistoricalOrderItemCard/);
  assert.match(page, /values\.lineValue/);
  assert.match(page, />สั่งซื้อ<\/p>/);
  assert.match(page, />ยืนยัน<\/p>/);
  assert.match(page, />หยิบจริง<\/p>/);
});

test("customer delivery locations are saved, selectable, and validated during checkout", () => {
  const edit = readFileSync(new URL("../app/customers/[customerCode]/page.tsx", import.meta.url), "utf8");
  const create = readFileSync(new URL("../app/customers/new/page.tsx", import.meta.url), "utf8");
  const checkout = readFileSync(new URL("../app/miniapp/checkout/page.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/line/checkout/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20261030100000_customer_dual_delivery_locations.sql", import.meta.url), "utf8");
  for (const page of [edit, create]) {
    assert.match(page, /delivery_map_url_2:/);
    assert.match(page, /delivery_location_1_name:/);
    assert.match(page, /delivery_location_2_name:/);
  }
  assert.match(checkout, /deliveryLocations\?\.\[0\]\?\.url/);
  assert.match(checkout, /aria-pressed=\{deliveryAddress === location\.url\}/);
  assert.match(checkout, /deliveryAddress,\s*cart,/);
  assert.match(api, /allowedAddresses\.includes\(chosenAddress\)/);
  assert.match(api, /allowedAddresses\.includes\(deliveryAddress\)/);
  assert.match(api, /order\.delivery_address === deliveryAddress/);
  assert.match(migration, /v_root\.delivery_address IS DISTINCT FROM p_delivery_address/);
  // The old rider override stays available for an order already in delivery.
  const rider = readFileSync(new URL("../app/tasks/delivery/[orderNumber]/page.tsx", import.meta.url), "utf8");
  assert.match(rider, /update_my_delivery_map/);
});

test("shortage call reminder follows stock and picking KPI thresholds", async () => {
  const { confirmationCallShortages, pickingCallShortages } =
    await import("../lib/shortageCallReminder.ts");
  const line = (id, unit, requested, confirmed, extra = {}) => ({
    id, product_name_snapshot: id, unit_snapshot: unit,
    requested_qty: requested, confirmed_qty: confirmed,
    addon_requested_qty: 0, addon_confirmed_qty: null,
    actual_qty: null, actual_piece_qty: null, piece_price_per_kg_snapshot: null,
    ...extra,
  });

  const kg = line("fresh-pork", "กก.", 10, 10);
  const pieces = line("eggs", "ชิ้น", 10, 10);
  const mixed = line("whole-chicken", "ชิ้น", 3, 3, { piece_price_per_kg_snapshot: 80 });

  // Stock Check has no tolerance, even for a 0.01 kg shortage.
  assert.deepEqual(
    confirmationCallShortages([kg], { "fresh-pork": "9.99" }, false),
    ["fresh-pork"]
  );
  assert.deepEqual(
    confirmationCallShortages([pieces], { eggs: "10" }, false),
    []
  );
  assert.deepEqual(
    confirmationCallShortages([mixed], { "whole-chicken": "2" }, false),
    ["whole-chicken"]
  );

  const acted = (...ids) => new Set(ids);
  assert.deepEqual(
    pickingCallShortages([kg], { "fresh-pork": "9.5" }, {}, false, acted("fresh-pork")),
    { stock: [], pick: [] }
  );
  assert.deepEqual(
    pickingCallShortages([kg], { "fresh-pork": "9.49" }, {}, false, acted("fresh-pork")),
    { stock: [], pick: ["fresh-pork"] }
  );
  assert.deepEqual(
    pickingCallShortages([pieces], { eggs: "9" }, {}, false, acted("eggs")),
    { stock: [], pick: ["eggs"] }
  );
  // Kilograms (2.4) must never be compared to confirmed pieces (3).
  assert.deepEqual(
    pickingCallShortages([mixed], { "whole-chicken": "2.4" }, { "whole-chicken": "3" }, false, acted("whole-chicken")),
    { stock: [], pick: [] }
  );
  assert.deepEqual(
    pickingCallShortages([mixed], { "whole-chicken": "2.4" }, { "whole-chicken": "2" }, false, acted("whole-chicken")),
    { stock: [], pick: ["whole-chicken"] }
  );
  assert.deepEqual(
    pickingCallShortages([line("short-stock", "กก.", 10, 9.99)], { "short-stock": "9.99" }, {}, false, acted("short-stock")),
    { stock: ["short-stock"], pick: [] }
  );

  const addon = line("addon", "ชิ้น", 8, 6, {
    actual_qty: 6, addon_requested_qty: 2, addon_confirmed_qty: 1,
  });
  assert.deepEqual(
    confirmationCallShortages([addon], { addon: "1" }, true),
    ["addon"]
  );
  assert.deepEqual(
    pickingCallShortages([addon], { addon: "7" }, {}, true, acted("addon")),
    { stock: ["addon"], pick: [] }
  );
  const mixedAddon = line("mixed-addon", "ชิ้น", 5, 5, {
    addon_requested_qty: 2, addon_confirmed_qty: 2, actual_piece_qty: 3,
    piece_price_per_kg_snapshot: 95,
  });
  assert.deepEqual(
    pickingCallShortages([mixedAddon], { "mixed-addon": "4.5" },
      { "mixed-addon": "1" }, true, acted("mixed-addon")),
    { stock: [], pick: ["mixed-addon"] }
  );
});

test("stock and picking prompts are non-blocking and contain telephone action", () => {
  const dialog = readFileSync(new URL("../components/ShortageCallReminder.tsx", import.meta.url), "utf8");
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /tel:/);
  assert.match(dialog, /onContinue/);
  assert.match(dialog, /onSkip/);
  assert.match(dialog, /\(ไม่บังคับ\)/);
  assert.match(dialog, /โทรแล้ว · ปิดงาน/);
  assert.match(dialog, /ข้ามการโทร · ปิดงาน/);
  const confirm = readFileSync(new URL("../app/tasks/confirmation/[orderNumber]/page.tsx", import.meta.url), "utf8");
  const pick = readFileSync(new URL("../app/tasks/picking/[orderNumber]/page.tsx", import.meta.url), "utf8");
  assert.match(confirm, /confirmationCallShortages\(items, confirmed, addonMode\)/);
  assert.match(pick, /pickingCallShortages\(/);
  assert.match(confirm, /completeConfirmation\(true\)/);
  assert.match(pick, /completePicking\(true\)/);
  assert.match(pick, /if \(\s*!photoUploaded\[0\]/);
});

test("Android voice alarm repeats with four-second spacing and stops promptly", () => {
  const sound = readFileSync(new URL("../android-alarm/app/src/main/java/com/lotusb2b/alarm/AlarmSound.java", import.meta.url), "utf8");
  const gradle = readFileSync(new URL("../android-alarm/app/build.gradle", import.meta.url), "utf8");
  assert.match(sound, /PAUSE_MS = 4000L/);
  assert.match(sound, /private int callsLeft = 3/);
  assert.match(sound, /R\.raw\.lotus_b2b_voice_call/);
  assert.match(sound, /AudioAttributes\.USAGE_ALARM/);
  assert.match(sound, /main\.removeCallbacks\(scheduledReplay\)/);
  assert.match(sound, /boolean isActive\(\) \{\s*return repeating;/);
  assert.match(sound, /AlarmHours\.isQuiet\(\)/);
  assert.doesNotMatch(sound, /Three-beep alarm/);
  assert.match(gradle, /versionCode 13/);
  assert.match(gradle, /noCompress \+= \['webm'\]/);
  const hours = readFileSync(new URL("../android-alarm/app/src/main/java/com/lotusb2b/alarm/AlarmHours.java", import.meta.url), "utf8");
  assert.match(hours, /hour >= 22 \|\| hour < 7/);
  const service = readFileSync(new URL("../android-alarm/app/src/main/java/com/lotusb2b/alarm/AlarmMonitorService.java", import.meta.url), "utf8");
  assert.match(service, /private void silenceUrgentAlarm\(\) \{\s*alarm\.stop\(\)/);
  assert.match(service, /acknowledgementInProgress = true;[\s\S]*?silenceUrgentAlarm\(\)/);
});

test("production audit: alarm feed excludes completed/cancelled orders without falsifying acknowledgements", () => {
  const source = readFileSync(new URL("../app/api/order-alarm/feed/route.ts", import.meta.url), "utf8");
  assert.match(source, /orders!inner\(order_number,status\)/);
  assert.match(source, /\.neq\("orders\.status", "completed"\)/);
  assert.match(source, /\.neq\("orders\.status", "cancelled"\)/);
  assert.match(source, /\.is\("acknowledged_at", null\)/);
  assert.doesNotMatch(source, /\.update\(\s*\{\s*acknowledged_at/);
});
test("production audit: financial KPI marks suspicious/historical costs without using them as exact", () => {
  const page = readFileSync(new URL("../app/kpi/page.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20261030121000_billing_cost_snapshots.sql", import.meta.url), "utf8");
  assert.match(page, /financialSummary\.suspicious_cost_lines > 0/);
  assert.match(page, /financialSummary\.unsnapshotted_cost_lines > 0/);
  assert.match(migration, /unit_cost_at_billing/);
  assert.match(migration, /NEW\.action='billing_completed'/);
  assert.match(migration, /sum\(suspicious_cost_lines\)/);
});
test("production audit: privileged RPCs no longer accessible to anonymous clients", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261030120000_security_hardening.sql", import.meta.url), "utf8");
  assert.match(sql, /create_customer_pickup_order[\s\S]*?FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.favourites FROM anon/);
  assert.match(sql, /managers can update favourites/);
});

test("production audit: redundant indexes and customer-price RLS policies are cleaned safely", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261030123000_cleanup_duplicate_indexes.sql", import.meta.url), "utf8");
  assert.match(sql, /DROP POLICY IF EXISTS "authenticated users can update customer prices"/);
  assert.match(sql, /DROP INDEX IF EXISTS public\.favourites_customer_product_unique/);
  assert.doesNotMatch(sql, /DROP INDEX IF EXISTS public\.products_sku_key/);
});

test("Android launcher uses the B2B teal adaptive icon without a white tile", () => {
  const manifest = readFileSync(new URL("../android-alarm/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const adaptive = readFileSync(new URL("../android-alarm/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml", import.meta.url), "utf8");
  const round = readFileSync(new URL("../android-alarm/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml", import.meta.url), "utf8");
  const foreground = readFileSync(new URL("../android-alarm/app/src/main/res/drawable/ic_b2b_foreground.xml", import.meta.url), "utf8");
  const background = readFileSync(new URL("../android-alarm/app/src/main/res/values/ic_launcher_background.xml", import.meta.url), "utf8");
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(adaptive, /@color\/ic_launcher_background/);
  assert.match(adaptive, /@drawable\/ic_b2b_foreground/);
  assert.equal(adaptive, round);
  assert.match(foreground, /android:fillColor="#FFFFFF"/);
  assert.match(background, /#02B0AF/);
});

test("financial KPIs include only fully completed bills, including all /x members", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261030143000_financial_kpis_completed_only.sql", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/kpi/page.tsx", import.meta.url), "utf8");
  assert.match(sql, /where o\.status = 'completed'/);
  assert.match(sql, /member_check\.status is distinct from 'completed'/);
  assert.match(sql, /o\.final_amount is not null/);
  assert.match(sql, /group_root_order_id is null or o\.group_root_order_id = o\.id/);
  assert.match(sql, /h\.action = 'billing_completed'/);
  assert.match(sql, /p_bill_date::timestamp at time zone 'Asia\/Bangkok'/);
  assert.match(sql, /public\.can_read_product_costs\(\)/);
  assert.doesNotMatch(sql, /where o\.status <> 'cancelled'/);
  assert.match(page, /4 KPIs · Completed เท่านั้น/);
  assert.match(page, /งานค้างชำระ\/รอจัดส่งไม่นับ/);
});

test("order photos are compressed before uploading without changing staff task flow", () => {
  const helper = readFileSync(new URL("../lib/orderPhotoUpload.ts", import.meta.url), "utf8");
  assert.match(helper, /prepareOrderPhoto\(file: File/);
  assert.match(helper, /!file\.type\.startsWith\("image\/"\)/);
  assert.match(helper, /optimized\.size >= file\.size \* 0\.98/);
  assert.match(helper, /kind === "payment_qr"/);
  for (const filename of [
    "../app/tasks/picking/[orderNumber]/page.tsx",
    "../app/tasks/delivery/[orderNumber]/page.tsx",
    "../app/tasks/billing/[orderNumber]/page.tsx",
    "../app/orders/[orderNumber]/payment/page.tsx",
    "../app/miniapp/payment/page.tsx"
  ]) {
    const src = readFileSync(new URL(filename, import.meta.url), "utf8");
    assert.match(src, /prepareOrderPhoto\(/, filename);
  }
  const paymentApi = readFileSync(new URL("../app/api/line/payment/route.ts", import.meta.url), "utf8");
  assert.match(paymentApi, /import sharp from "sharp"/);
  assert.match(paymentApi, /uploadBytes/);
  assert.match(paymentApi, /uploadMimeType/);
});

test("14-day image expiry and 7-day missing-timestamp fallback never delete orders", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261030170000_immediate_photo_compression.sql", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/cron/order-photo-retention/route.ts", import.meta.url), "utf8");
  const cron = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(cron.crons, [{path:"/api/cron/order-photo-retention",schedule:"0 19 * * *"}]);
  assert.match(sql, /p_action='compress'/);
  assert.match(sql, /and not \(g\.done/);
  assert.match(sql, /p_action='delete' and g\.done/);
  assert.match(sql, /g\.end_time<=now\(\)-interval '14 days'/);
  assert.match(sql, /g\.end_time<=now\(\)-interval '7 days'/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /order_photo_retention_candidates/);
  assert.match(route, /storage\.remove/);
  assert.match(route, /\.from\("order_files"\)\.delete\(\)/);
  assert.doesNotMatch(route, /\.from\("orders"\)\.delete\(/);
  assert.match(route, /payment_qr"/);
});

test("No CV customer displays hide internal identifiers without changing customer routing", () => {
  const label = readFileSync(new URL("../lib/customerCodeDisplay.ts", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/miniapp/page.tsx", import.meta.url), "utf8");
  const tracking = readFileSync(new URL("../app/miniapp/orders/page.tsx", import.meta.url), "utf8");
  const legacy = readFileSync(new URL("../app/shop/[customerCode]/page.tsx", import.meta.url), "utf8");
  const access = readFileSync(new URL("../app/api/line/customer/route.ts", import.meta.url), "utf8");
  const orders = readFileSync(new URL("../app/api/line/orders/route.ts", import.meta.url), "utf8");
  assert.match(label, /"ไม่มี CV"/);
  assert.match(label, /\^NCV-/);
  assert.match(home, /displayCustomerCode\(selectedCustomer\.customerCode, selectedCustomer\.hasNoCv\)/);
  assert.match(home, /displayCustomerCode\(customer\.customerCode, customer\.hasNoCv\)/);
  assert.match(tracking, /displayCustomerCode\(option\.customerCode, option\.hasNoCv\)/);
  assert.match(legacy, /displayCustomerCode\(customer\.customer_code, customer\.has_no_cv\)/);
  assert.match(access, /has_no_cv,/);
  assert.match(orders, /has_no_cv,/);
  assert.match(home, /\`\/miniapp\/shop\?customer=\$\{selectedCustomer\.customerCode\}\`/);
});

test("grouped order list merges only when every /x member has finished picking", () => {
  const root = { id:"root",order_number:143,group_root_order_id:"root",group_sequence:1,status:"awaiting_billing" };
  const child = {id:"child",order_number:147,group_root_order_id:"root",group_sequence:2,status:"picking"};
  const independent = {id:"solo",order_number:149,group_root_order_id:null,group_sequence:null,status:"completed"};
  let rows = groupOrdersForManagement([root,child,independent]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].consolidated, false);
  assert.equal(rows[1].consolidated, false);
  assert.equal(orderDisplayNumber(child,143), "143/2");
  rows = groupOrdersForManagement([root,{...child,status:"awaiting_billing"},independent]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].consolidated, true);
  assert.deepEqual(rows[0].members.map(x=>x.order_number),[143,147]);
  assert.equal(rows[0].order.order_number, 143);
  assert.equal(rows[1].order.order_number, 149);
  assert.equal(groupOrdersForManagement([root,{...child,status:"cancelled"}]).length,2);
  assert.equal(groupOrdersForManagement([{...root,status:"completed"},{...child,status:"completed"}]).length,1);
  // Never hide a child when the root is absent from a filtered result.
  assert.equal(groupOrdersForManagement([child]).length,1);
});

test("order summary aggregates weighed and piece products without mixing kg with pcs", () => {
  const base = {product_id:"salmon",unit_snapshot:"ชิ้น",product_name_snapshot:"Salmon",products:{sku:"111"}};
  const picked = combinePickedItems([
    {...base,id:"a",order_id:"root",unit_price_snapshot:10,piece_price_per_kg_snapshot:100,requested_qty:1,confirmed_qty:1,actual_qty:1.5},
    {...base,id:"b",order_id:"child",unit_price_snapshot:10,piece_price_per_kg_snapshot:200,requested_qty:2,confirmed_qty:2,actual_qty:2},
    {...base,id:"c",order_id:"child",unit_price_snapshot:10,piece_price_per_kg_snapshot:null,requested_qty:3,confirmed_qty:3,actual_qty:3}
  ]);
  assert.equal(picked.length,2);
  const weighed=picked.find(x=>x.piece_price_per_kg_snapshot != null);
  const pcs=picked.find(x=>x.piece_price_per_kg_snapshot == null);
  assert.equal(Number(weighed.requested_qty),3);
  assert.equal(Number(weighed.confirmed_qty),3);
  assert.equal(Number(weighed.actual_qty),3.5);
  assert.ok(Math.abs(Number(weighed.piece_price_per_kg_snapshot)-(550/3.5))<0.0001);
  assert.equal(weighed.sources.length,2);
  assert.equal(Number(pcs.actual_qty),3);
});

test("group detail displays consolidated goods and inline /x origin audit", () => {
  const list = readFileSync(new URL("../app/orders/page.tsx",import.meta.url),"utf8");
  const detail = readFileSync(new URL("../app/orders/[orderNumber]/page.tsx",import.meta.url),"utf8");
  assert.match(list,/groupOrdersForManagement\(orders\)/);
  assert.match(list,/data-testid="consolidated-order-audit"/);
  assert.match(detail,/isConsolidatedGroup\(members/);
  assert.match(detail,/combinePickedItems\(pickedLines/);
  assert.match(detail,/data-testid="grouped-order-audit"/);
  assert.match(detail,/\.eq\("stage", "picking"\)/);
  assert.match(detail,/\/orders\/\$\{member.order_number\}/);
});

test("billing supports an optional second bill photo and QR without changing required first files", () => {
  const billing = readFileSync(new URL("../app/tasks/billing/[orderNumber]/page.tsx", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../lib/orderPhotoUpload.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/line/payment/route.ts", import.meta.url), "utf8");
  const customer = readFileSync(new URL("../app/miniapp/payment/page.tsx", import.meta.url), "utf8");
  const staff = readFileSync(new URL("../app/orders/[orderNumber]/payment/page.tsx", import.meta.url), "utf8");
  const details = readFileSync(new URL("../app/orders/[orderNumber]/page.tsx", import.meta.url), "utf8");
  const retention = readFileSync(new URL("../app/api/cron/order-photo-retention/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20261031163000_optional_second_billing_images.sql", import.meta.url), "utf8");
  assert.match(billing, /uploadOptionalBillingFile\(file, "bill_2"\)/);
  assert.match(billing, /uploadOptionalBillingFile\(file, "payment_qr_2"\)/);
  assert.match(billing, /ไม่บังคับ/);
  assert.match(billing, /!billUploaded/);
  assert.match(billing, /!qrUploaded/);
  assert.match(helper, /"bill_2"/);
  assert.match(helper, /"payment_qr_2"/);
  assert.match(api, /bill2File/);
  assert.match(api, /qr2File/);
  assert.match(api, /bill2,/);
  assert.match(api, /paymentQr2,/);
  assert.match(customer, /files\.paymentQr2/);
  assert.match(customer, /files\.bill2/);
  assert.match(staff, /bill2Url/);
  assert.match(staff, /qr2Url/);
  assert.match(details, /bill_2: "บิลรูปที่ 2"/);
  assert.match(retention, /"bill_2"/);
  assert.match(retention, /"payment_qr_2"/);
  assert.match(migration, /WHEN 'bill_2' THEN v_required_stage:='billing'/);
  assert.match(migration, /WHEN 'payment_qr_2' THEN v_required_stage:='billing'/);
  assert.match(migration, /order_files_file_type_check/);
});
