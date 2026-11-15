import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const home = read("app/login/page.tsx");
const warnings = read("app/manager/warnings/page.tsx");
const api = read("app/api/admin/operational-health/route.ts");

test("Manager home has a single compact warnings menu and no expanded warning panel",()=>{
  assert.match(home,/name: "รายการที่ต้องตรวจสอบ", href: "\/manager\/warnings"/);
  assert.match(home,/warningsToCheck = operationalHealth/);
  assert.match(home,/item.href === "\/manager\/warnings" && warningsToCheck > 0/);
  assert.doesNotMatch(home,/aria-label="การแจ้งเตือนการปฏิบัติงาน"/);
  assert.doesNotMatch(home,/manualClosedWithoutBillOrders\.map/);
  assert.match(home,/href=\{item.href\}/);
});
test("Manager-only warnings page contains actionable checks and neutral historical audit",()=>{
  assert.match(warnings,/staff\?\.account_type !== "manager"/);
  assert.match(warnings,/\/api\/admin\/operational-health/);
  assert.match(warnings,/Authorization: "Bearer "/);
  assert.match(warnings,/href="\/alarm-stations"/);
  assert.match(warnings,/href=\{"\/orders\/" \+ order.orderNumber\}/);
  assert.match(warnings,/manualClosedWithoutBillCount/);
  assert.match(warnings,/<details/);
  assert.match(warnings,/ไม่รวมใน KPI การเงิน/);
  assert.match(warnings,/รายรายการที่ต้องตรวจสอบ|รายการที่ต้องตรวจสอบ/);
  assert.match(api,/\.eq\("account_type", "manager"\)/);
});
