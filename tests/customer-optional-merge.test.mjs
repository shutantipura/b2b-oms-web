import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findChosenMerge, listEligibleMergeChoices } from "../lib/orderMergeChoices.ts";

const candidate = (number, date="2026-11-14", slot="09:00–11:00", address="https://maps.google.com/?q=1") => ({
  orderNumber:number, deliveryDate:date, deliverySlot:slot, deliveryAddress:address, status:"awaiting_picking",
});

test("list all eligible orders, including different slots, with no automatic choice", () => {
  const candidates=[candidate(80),candidate(81,"2026-11-14","11:00–13:00")];
  assert.deepEqual(listEligibleMergeChoices(candidates,"2026-11-14",candidates[0].deliveryAddress,
    ["09:00–11:00","11:00–13:00"]).map(x=>x.orderNumber),[80,81]);
  assert.equal(findChosenMerge(candidates,81,"2026-11-14",candidates[0].deliveryAddress,
    ["09:00–11:00","11:00–13:00"])?.deliverySlot,"11:00–13:00");
});

test("never offer orders for a different location, date, or expired slot", () => {
  const candidates=[candidate(80),candidate(81,"2026-11-15","09:00–11:00"),
    candidate(82,"2026-11-14","09:00–11:00","https://maps.google.com/?q=2"),
    candidate(83,"2026-11-14","07:00–09:00")];
  assert.deepEqual(listEligibleMergeChoices(candidates,"2026-11-14",candidates[0].deliveryAddress,
    ["09:00–11:00"]).map(x=>x.orderNumber),[80]);
  assert.equal(findChosenMerge(candidates,82,"2026-11-14",candidates[0].deliveryAddress,
    ["09:00–11:00"]),null);
});

test("server only groups an explicitly chosen order and rejects stale choices", () => {
  const api=readFileSync(new URL("../app/api/line/checkout/route.ts",import.meta.url),"utf8");
  assert.match(api,/rawMerge = body.mergeIntoOrderNumber/);
  assert.match(api,/rawMerge !== null && rawMerge !== undefined/);
  assert.match(api,/chosenMerge = requestedMergeNumber !== null/);
  assert.match(api,/findChosenMerge\(/);
  assert.match(api,/requestedMergeNumber !== null && !chosenMerge/);
  assert.doesNotMatch(api,/chosenMerge.deliverySlot !== deliverySlot/);
  assert.match(api,/const effectiveDeliverySlot = chosenMerge\?\.deliverySlot \?\? deliverySlot/);
  assert.match(api,/mergeIntoOrderNumber = chosenMerge\?\.orderNumber \?\? null/);
  assert.match(api,/p_primary_order_number: mergeIntoOrderNumber/);
  assert.match(api,/p_delivery_slot: effectiveDeliverySlot/);
  assert.match(api,/\.eq\("delivery_address", deliveryAddress\)/);
  assert.doesNotMatch(api,/chooseAutomaticMerge|automaticMerge/);
});

test("checkout offers separate-by-default radio and explicit grouping for each eligible order", () => {
  const page=readFileSync(new URL("../app/miniapp/checkout/page.tsx",import.meta.url),"utf8");
  assert.match(page,/selectedMergeOrderNumber, setSelectedMergeOrderNumber/);
  assert.match(page,/name="merge-choice"/);
  assert.match(page,/สร้างคำสั่งซื้อแยก \(ค่าเริ่มต้น\)/);
  assert.match(page,/eligibleMergeCandidates.map/);
  assert.match(page,/chosenMerge = eligibleMergeCandidates.find/);
  assert.match(page,/selectedDeliverySlot = chosenMerge\?\.deliverySlot \?\? deliverySlot/);
  assert.match(page,/setSelectedMergeOrderNumber\(null\)/);
  assert.match(page,/mergeIntoOrderNumber: chosenMerge\?\.orderNumber \?\? null/);
  assert.doesNotMatch(page,/chooseAutomaticMerge|automaticMerge|จัดส่งร่วมกับคำสั่งซื้อเดิมอัตโนมัติ/);
  assert.match(page,/ตรวจสอบคำสั่งซื้อเดิมไม่ได้ แต่ยังสั่งซื้อแยกได้ตามปกติ/);
});

test("server still locks the order at billing and preserves independent picks", () => {
  const sql=readFileSync(new URL("../sql/grouped_suborders.sql",import.meta.url),"utf8");
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/Billing has begun for this delivery/);
  assert.match(sql,/Cannot start Billing until every suborder is picked/);
  assert.match(sql,/p_delivery_address text/);
});
