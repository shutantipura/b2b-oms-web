import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chooseAutomaticMerge } from "../lib/automaticOrderMerge.ts";

const candidate = (orderNumber, deliveryDate, deliverySlot = "09:00–11:00", deliveryAddress = "https://maps.google.com/?q=1") => ({
  orderNumber, deliveryDate, deliverySlot, deliveryAddress,
});

test("same delivery date and location automatically chooses the oldest eligible root", () => {
  const candidates = [
    candidate(267, "2026-11-13"),
    candidate(281, "2026-11-13", "11:00–13:00"),
  ];
  assert.equal(chooseAutomaticMerge(candidates, "2026-11-13", candidates[0].deliveryAddress, ["09:00–11:00", "11:00–13:00"])?.orderNumber, 267);
});

test("choosing another delivery date does not force the previous day's group", () => {
  const candidates = [candidate(267, "2026-11-13")];
  assert.equal(chooseAutomaticMerge(candidates, "2026-11-14", candidates[0].deliveryAddress, ["09:00–11:00"]), null);
});

test("a different saved delivery location or unavailable primary slot does not merge", () => {
  const candidates = [candidate(267, "2026-11-13")];
  assert.equal(chooseAutomaticMerge(candidates, "2026-11-13", "https://maps.google.com/?q=2", ["09:00–11:00"]), null);
  assert.equal(chooseAutomaticMerge(candidates, "2026-11-13", candidates[0].deliveryAddress, ["11:00–13:00"]), null);
});

test("skip ineligible earlier candidate and choose next eligible group", () => {
  const candidates = [
    candidate(267, "2026-11-13", "07:00–09:00"),
    candidate(268, "2026-11-13", "09:00–11:00"),
  ];
  assert.equal(chooseAutomaticMerge(candidates, "2026-11-13", candidates[0].deliveryAddress, ["09:00–11:00"])?.orderNumber, 268);
});

test("checkout automatically uses the original time slot and keeps the date picker editable", () => {
  const checkout = readFileSync(new URL("../app/miniapp/checkout/page.tsx", import.meta.url), "utf8");
  assert.match(checkout, /chooseAutomaticMerge\(mergeCandidates, deliveryDate, deliveryAddress/);
  assert.match(checkout, /selectedDeliverySlot = automaticMerge\?\.deliverySlot \?\? deliverySlot/);
  assert.match(checkout, /<select value=\{deliveryDate\} onChange=\{\(event\) => changeDate/);
  assert.match(checkout, /<select value=\{selectedDeliverySlot\} disabled=\{Boolean\(automaticMerge\)\}/);
  assert.match(checkout, /จัดส่งร่วมกับคำสั่งซื้อเดิมอัตโนมัติ/);
  assert.doesNotMatch(checkout, /mergeDecisionMade|name="merge-choice"|ไม่จัดส่งร่วม — สร้างคำสั่งซื้ออิสระ/);
  assert.match(checkout, /requestId: chosenMerge \? mergeRequestIdRef\.current : null/);
});

test("server enforces automatic grouping even if old client omits merge choice", () => {
  const route = readFileSync(new URL("../app/api/line/checkout/route.ts", import.meta.url), "utf8");
  assert.match(route, /await findMergeCandidates\(supabase, customer\.id, deliveryDate, deliveryAddress\)/);
  assert.match(route, /chooseAutomaticMerge\(/);
  assert.match(route, /const mergeIntoOrderNumber = automaticMerge\?\.orderNumber \?\? null/);
  assert.match(route, /const effectiveDeliverySlot = automaticMerge\?\.deliverySlot \?\? deliverySlot/);
  assert.match(route, /p_primary_order_number: mergeIntoOrderNumber/);
  assert.match(route, /p_delivery_slot: effectiveDeliverySlot/);
  assert.match(route, /requestedMergeNumber !== automaticMerge\?\.orderNumber/);
  assert.match(route, /status: 409/);
  assert.match(route, /fulfillmentMethod === "pickup"/);
});
