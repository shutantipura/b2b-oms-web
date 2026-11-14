import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = path => readFileSync(new URL("../"+path,import.meta.url),"utf8");
const api = read("app/api/line/checkout/route.ts");
const sql = read("sql/20261114_checkout_retry_replay.sql");
const manager = read("app/login/page.tsx");
const health = read("app/api/admin/operational-health/route.ts");

test("lost response replays before catalogue and expiry checks",()=>{
  const authenticate=api.indexOf("await verifyLineAndCustomer(");
  const lookup=api.indexOf('"lookup_checkout_order_retry"');
  const build=api.indexOf("await buildCart(");
  const validate=api.indexOf("validateDeliverySelection(deliveryDate");
  assert.ok(authenticate>=0&&lookup>authenticate&&build>lookup&&validate>lookup);
  assert.match(api,/createHash\("sha256"\)/);
  assert.match(api,/alreadyProcessed: true/);
  assert.match(api,/create_checkout_order_once_v2/);
  assert.match(api,/create_group_suborder_v2/);
  assert.match(api,/p_intent_hash: intentHash/);
  assert.match(api,/conflicting \? 409 : 503/);
});
test("replay is scoped to verified LINE identity, customer and immutable checkout intent",()=>{
  assert.match(sql,/ordered_by_line_user_id IS DISTINCT FROM p_line_user_id/);
  assert.match(sql,/checkout_intent_hash IS DISTINCT FROM p_intent_hash/);
  assert.match(sql,/customer_id IS DISTINCT FROM p_customer_id/);
  assert.match(sql,/checkout_request_id=p_request_id OR group_request_id=p_request_id/);
  assert.match(sql,/public\.create_checkout_order_once\(/);
  assert.match(sql,/public\.create_group_suborder\(/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.lookup_checkout_order_retry/);
  assert.match(sql,/TO service_role/);
});
test("manager-only health reports offline devices and missing bills without modifying orders",()=>{
  assert.match(health,/db\.auth\.getUser/);
  assert.match(health,/\.eq\("account_type", "manager"\)/);
  assert.match(health,/\.eq\("is_active", true\)/);
  assert.match(health,/\.is\("revoked_at", null\)/);
  assert.match(health,/\.is\("final_amount", null\)/);
  assert.match(health,/\.eq\("status", "completed"\)/);
  assert.match(health,/90_000/);
  assert.match(health,/120_000/);
  assert.doesNotMatch(health,/\.update\(|\.delete\(|\.insert\(/);
  assert.match(manager,/staff\?\.account_type !== "manager"/);
  assert.match(manager,/\/api\/admin\/operational-health/);
  assert.match(manager,/href="\/alarm-stations"/);
  assert.match(manager,/\/orders\//);
});
