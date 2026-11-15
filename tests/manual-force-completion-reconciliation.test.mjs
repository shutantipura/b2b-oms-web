import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = path => readFileSync(new URL("../"+path,import.meta.url),"utf8");
const sql=read("sql/20261115_legacy_force_complete_integrity.sql");
const orders=read("app/orders/page.tsx");
const api=read("app/api/admin/operational-health/route.ts");
const home=read("app/login/page.tsx");
const detail=read("app/orders/[orderNumber]/page.tsx");
test("legacy Manager overrides are reconstructed from audited events only",()=>{
  assert.match(sql,/h.action='manager_force_completed'/);
  assert.match(sql,/h.to_status='completed'/);
  assert.match(sql,/o.completed_at=h.action_at/);
  assert.match(sql,/force_completed_by_staff_id=h.performed_by_staff_id/);
  assert.doesNotMatch(sql,/final_amount\s*=/);
});
test("Manager completion now requires a reason and uses protected RPC",()=>{
  assert.match(orders,/window.prompt\(/);
  assert.match(orders,/reason.length < 8/);
  assert.match(orders,/"force_complete_as_manager"/);
  assert.match(orders,/p_reason: reason/);
  assert.doesNotMatch(orders,/"manager_force_complete_order"/);
  assert.match(sql,/public.force_complete_as_manager\(/);
});
test("audited manual closures and unexplained missing bills are distinct",()=>{
  assert.match(api,/\.is\("force_completed_at", null\)/);
  assert.match(api,/\.not\("force_completed_at", "is", null\)/);
  assert.match(api,/missingBillCount: unexplained.count/);
  assert.match(api,/manualClosedWithoutBillCount/);
  const warnings = read("app/manager/warnings/page.tsx");
  assert.match(warnings,/manualClosedWithoutBillCount/);
  assert.match(detail,/Manager บังคับปิดงานก่อนมีบิล/);
});
