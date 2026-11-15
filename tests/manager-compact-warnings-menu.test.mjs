import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const home = read("app/login/page.tsx");
const icons = read("components/HomeMenuIcon.tsx");
const api = read("app/api/admin/operational-health/route.ts");
test("Manager warnings menu and background polling are completely removed", () => {
  assert.doesNotMatch(home, /\/manager\/warnings/);
  assert.doesNotMatch(home, /รายการที่ต้องตรวจสอบ|warningsToCheck|operationalHealth|loadOperationalHealth|healthError/);
  assert.doesNotMatch(home, /\/api\/admin\/operational-health/);
  assert.doesNotMatch(home, /aria-label="การแจ้งเตือนการปฏิบัติงาน"/);
  assert.doesNotMatch(icons, /\/manager\/warnings/);
  assert.match(home, /const STAFF_NAVIGATION = MANAGER_NAVIGATION.slice\(0, 2\)/);
  assert.match(home, /href=\{item.href\}/);
});
test("Underlying operational health endpoint remains read-only and Manager-only", () => {
  assert.match(api,/\.eq\("account_type", "manager"\)/);
  assert.match(api,/\.eq\("is_active", true\)/);
  assert.doesNotMatch(api,/\.update\(|\.delete\(|\.insert\(/);
});
