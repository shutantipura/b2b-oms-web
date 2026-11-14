import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const role=readFileSync("app/line-access/page.tsx","utf8");
const customer=readFileSync("app/api/line/customer/route.ts","utf8");
const mini=readFileSync("app/miniapp/page.tsx","utf8");
const home=readFileSync("app/login/page.tsx","utf8");
const api=readFileSync("app/api/line/accountant/route.ts","utf8");
const page=readFileSync("app/miniapp/accountant/page.tsx","utf8");
const sql=readFileSync("sql/accountant_role_and_historical_costs.sql","utf8");

test("LINE roles include Accountant, renamed Account & Access menu",()=>{
 assert.match(role,/type Role = "manager" \| "salesman" \| "staff" \| "customer" \| "accountant"/);
 assert.match(role,/id:"accountant"/);
 assert.match(role,/จัดการบัญชีและสิทธิ์/);
 assert.match(home,/name: "จัดการบัญชีและสิทธิ์"/);
 assert.match(home,/name: "การเงินและบัญชี"/);
 assert.match(customer,/accountRole: lineUser.assigned_role/);
 assert.match(customer,/lineUser.assigned_role === "accountant"/);
 assert.match(mini,/data.accountRole === "accountant"/);
 assert.match(mini,/router.replace\("\/miniapp\/accountant"\)/);
});

test("Accountant cannot obtain staff task sessions or customer ordering",()=>{
 assert.match(role,/p_stages:role==="staff"\?draft.stages:\[\]/);
 assert.match(role,/p_customer_codes:role==="customer"\?draft.customerCodes:\[\]/);
 assert.match(sql,/p_role IN \('staff','manager','salesman'\)/);
 assert.match(sql,/p_role NOT IN \('manager','staff','salesman','customer','accountant'\)/);
 assert.match(api,/user.assigned_role === "accountant"/);
 assert.match(api,/hasAutomaticLineCustomerAccess\(admin, identity.sub\)/);
 assert.match(api,/role!=="accountant"/);
 assert.match(api,/LINE identity could not be verified/);
 assert.match(api,/Cache-Control": "private, no-store/);
});

test("only accountant can add missing historical costs with audit trail",()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public.accountant_order_item_costs/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public.accountant_cost_entry_audit/);
 assert.match(sql,/ALTER TABLE public.accountant_order_item_costs ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public.accountant_fill_missing_costs/);
 assert.match(sql,/p_actor_line_user_row_id uuid/);
 assert.match(sql,/assigned_role='accountant' AND is_active/);
 assert.match(sql,/oi.unit_cost_at_billing IS NULL/);
 assert.match(sql,/cardinality\(p_order_item_ids\)/);
 assert.match(sql,/count\(DISTINCT oi.product_id\)/);
 assert.match(sql,/INSERT INTO public.accountant_cost_entry_audit/);
 assert.doesNotMatch(sql,/UPDATE public.product_costs/);
 assert.match(api,/admin.rpc\("accountant_fill_missing_costs"/);
 assert.match(api,/p_actor_line_user_row_id:user.id/);
});

test("financial reporting is completed billing-date only with audit and bills",()=>{
 assert.match(api,/event.action!=="billing_completed"/);
 assert.match(api,/order.status==="completed"/);
 assert.match(api,/members.every\(m=>m.status==="completed"\)/);
 assert.match(api,/timeZone:"Asia\/Bangkok"/);
 assert.match(api,/createSignedUrl\(file.storage_path,600\)/);
 assert.match(api,/memberIds=\[\.\.\.new Set\(\[root,orderId/);
 assert.match(api,/\.in\("order_id",memberIds\)/);
 assert.match(api,/const unitCost=billed\?\?assigned/);
 assert.doesNotMatch(api,/const unitCost=billed\?\?assigned\?\?money\(currentCost/);
 assert.match(api,/piece_price_per_kg_snapshot\)!==null\?"กก."/);
 assert.match(api,/file_type",\["bill","bill_2","payment_slip","payment_slip_2"\]/);
 assert.match(page,/idToken,action/);
 assert.match(page,/cash\(financial.allGP\)/);
 assert.match(page,/exportXlsx/);
 assert.match(page,/save-cost/);
 assert.match(page,/Accountant/);
 assert.match(page,/ไม่สามารถยืนยันชำระเงิน/);
});

test("Financial GP needs historical evidence; current master costs remain reference-only",()=>{
 assert.match(api,/const unitCost=billed\?\?assigned/);
 assert.match(sql,/coalesce\(oi\.unit_cost_at_billing, ac\.unit_cost\)/);
 assert.doesNotMatch(sql,/coalesce\(oi\.unit_cost_at_billing, ac\.unit_cost, pc\.cost\)/);
 assert.match(sql,/historical_costs_missing/);
 assert.match(sql,/CREATE TRIGGER accountant_cost_audit_immutable/);
 assert.match(sql,/CREATE TRIGGER accountant_cost_entries_immutable/);
});
test("Manager bill changes use audited before/after events, not arbitrary subtotal differences",()=>{
 assert.match(api,/event.action!=="manager_adjusted_final_amount"/);
 assert.match(api,/old_amount/);
 assert.match(api,/new_amount/);
 assert.match(api,/otherBillDifference:unexplainedDifference/);
 assert.match(page,/Manager bill adjustment/);
 assert.match(page,/Other bill difference/);
});
