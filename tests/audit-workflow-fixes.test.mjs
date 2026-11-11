import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("delivery map updates require the actual active delivery claim", () => {
  const sql = read("../supabase/migrations/20261111120000_fix_active_delivery_map_claim.sql");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.update_my_delivery_map/);
  assert.match(sql, /c\.stage = 'delivery'/);
  assert.match(sql, /c\.staff_id = v_staff_id/);
  assert.match(sql, /c\.claim_status = 'active'/);
  assert.doesNotMatch(sql, /claim_status\s*=\s*'claimed'/);
  assert.match(sql, /o\.status NOT IN \('completed', 'cancelled'\)/);
});

test("customer slip submission remains pending until staff verification", () => {
  const api = read("../app/api/line/payment/route.ts");
  const page = read("../app/miniapp/payment/page.tsx");
  assert.match(api, /status: "payment_submitted"/);
  assert.match(page, /status: "payment_submitted"/);
  assert.doesNotMatch(page, /status: "completed" \}/);
  assert.match(page, /กำลังรอเจ้าหน้าที่ตรวจสอบ/);
  assert.doesNotMatch(page, /ส่งหลักฐานการชำระเงินและปิดคำสั่งซื้อเรียบร้อยแล้ว/);
});

test("storage orphan preview has no deletion and avoids customer CV images", () => {
  const sql = read("../supabase/diagnostics/20261111_orphan_order_file_dry_run.sql");
  assert.match(sql, /s\.bucket_id = 'order-files'/);
  assert.match(sql, /s\.name LIKE 'orders\/%'/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /interval '48 hours'/);
  const statements = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(statements, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b|storage\.delete|storage\.remove/i);
});
