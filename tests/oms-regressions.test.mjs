import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(gradle, /versionCode 11/);
  assert.match(gradle, /noCompress \+= \['webm'\]/);
  const hours = readFileSync(new URL("../android-alarm/app/src/main/java/com/lotusb2b/alarm/AlarmHours.java", import.meta.url), "utf8");
  assert.match(hours, /hour >= 22 \|\| hour < 7/);
  const service = readFileSync(new URL("../android-alarm/app/src/main/java/com/lotusb2b/alarm/AlarmMonitorService.java", import.meta.url), "utf8");
  assert.match(service, /private void silenceUrgentAlarm\(\) \{\s*alarm\.stop\(\)/);
  assert.match(service, /acknowledgementInProgress = true;[\s\S]*?silenceUrgentAlarm\(\)/);
});
