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
