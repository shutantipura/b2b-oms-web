import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL("../"+path,import.meta.url),"utf8");
const sql = read("sql/checkout_delivery_pickup_idempotency_20261114.sql");
const api = read("app/api/line/checkout/route.ts");
const ui = read("app/miniapp/checkout/page.tsx");
const cron = read("app/api/cron/order-photo-retention/route.ts");

test("standalone and pickup orders use one atomic idempotent RPC",()=>{
 assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_request_unique/);
 assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\(p_request_id::text,0\)\)/);
 assert.match(sql,/checkout_request_fingerprint IS DISTINCT FROM v_fingerprint/);
 assert.match(sql,/checkout_request_id=p_request_id/);
 assert.match(sql,/create_customer_pickup_order\(/);
 assert.match(sql,/create_customer_order\(/);
 assert.match(sql,/ordered_by_line_user_id=p_line_user_id/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public.create_checkout_order_once/);
 assert.match(sql,/TO service_role/);
 assert.match(api,/const requestId = retryRequestId!/);
 assert.match(api,/retryRequestId = suppliedId/);
 assert.match(api,/create_checkout_order_once/);
 assert.match(api,/p_is_pickup: fulfillmentMethod === "pickup"/);
 assert.match(api,/p_request_id: requestId/);
 assert.doesNotMatch(api,/await supabase\.rpc\("create_customer_order"/);
 assert.doesNotMatch(api,/await supabase\.rpc\("create_customer_pickup_order"/);
});
test("retry key is preserved across lost responses and rotated for a changed intent",()=>{
 assert.match(ui,/b2b-checkout-attempt-/);
 assert.match(ui,/const attemptIntent = JSON\.stringify/);
 assert.match(ui,/saved\?\.intent === attemptIntent/);
 assert.match(ui,/localStorage\.setItem\(attemptKey/);
 assert.match(ui,/requestId,/);
 assert.match(ui,/localStorage\.removeItem\(attemptKey\)/);
 assert.match(ui,/if \(!response\.ok\)/);
 assert.match(sql,/p_line_user_id uuid/);
 assert.match(sql,/lu\.assigned_role='customer'/);
 assert.match(sql,/lu\.assigned_role IN \('manager','salesman'\)/);
});
test("expired missing photo references are reconciled before compression",()=>{
 const finalize=cron.indexOf('["finalize_delete", 100]');
 const removal=cron.indexOf('["delete", 70]');
 const compress=cron.indexOf('["compress", 120]');
 assert.ok(finalize>0 && removal>finalize && compress>removal);
 assert.match(cron,/stillEligible = \(await read\(action, 200\)\)/);
 assert.match(cron,/action === "delete"\)/);
 assert.match(cron,/db\.from\("order_files"\)\.delete\(\)/);
 assert.match(cron,/storage\.remove\(\[file\.storage_path\]\)/);
});
