import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
const sql=source("../sql/salesman_customer_revisions_and_gp_approval.sql");
const auth=source("../lib/server/salesAuth.ts");
const line=source("../lib/server/lineCustomerAccess.ts");
const cust=source("../app/api/sales/customer-changes/route.ts");
const prices=source("../app/api/sales/prices/route.ts");
const manager=source("../app/salesman/reviews/page.tsx");
const editor=source("../app/salesman/customer/[customerId]/page.tsx");
const home=source("../app/login/page.tsx");
const salesman=source("../app/salesman/page.tsx");

test("manager and salesman get dynamic all-customer access, revoked with their staff link",()=>{
 assert.match(line,/staff_line_users/);
 assert.match(line,/is_authorized", true/);
 assert.match(line,/staff\?\.is_active/);
 assert.match(line,/staff\.account_type === identity\.assigned_role/);
 assert.match(line,/\["manager", "salesman"\]\.includes\(staff\.account_type\)/);
 assert.match(line,/\.from\("customers"\)/);
 assert.match(line,/\.eq\("is_active", true\)/);
 assert.match(line,/\.from\("customer_line_users"\)/);
 for(const name of ["customer","checkout","catalog","orders","payment"]){
   const route=source("../app/api/line/"+name+"/route.ts");
   assert.match(route,/loadAuthorizedLineCustomerLinks/,name);
 }
 assert.match(source("../app/api/line/favourites/route.ts"),/hasAutomaticLineCustomerAccess/);
});

test("customer change records are lightweight, field-based and safe to reject after multiple edits",()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.sales_customer_change_audit/);
 assert.match(sql,/previous_value jsonb/);
 assert.match(sql,/proposed_value jsonb/);
 assert.match(sql,/approved_baseline jsonb/);
 assert.match(sql,/status='superseded'/);
 assert.match(sql,/v_prior\.approved_baseline/);
 assert.match(sql,/to_jsonb\(v_customer\)->v_change\.field_name IS DISTINCT FROM v_change\.proposed_value/);
 assert.match(sql,/THEN 'approved' ELSE 'rejected'/);
 assert.match(sql,/updated_at=now/);
 assert.match(cust,/EDITABLE/);
 assert.doesNotMatch(cust,/is_active",?\s*false/);
 assert.match(editor,/changes:dirty/);
 assert.match(editor,/result\.delivery_address = result\.delivery_map_url/);
});

test("salesmen cannot alter activation or bypass approvals",()=>{
 assert.match(auth,/admin\.auth\.getUser\(token\)/);
 assert.match(auth,/staff\?\.is_active/);
 assert.match(cust,/requireSalesRole\(request, \["salesman"\]\)/);
 assert.match(prices,/requireSalesRole\(request, \["salesman"\]\)/);
 assert.match(cust,/requireSalesRole\(request, \["manager"\]\)/);
 assert.match(prices,/requireSalesRole\(request, \["manager"\]\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.sales_submit_customer_changes/);
 assert.match(sql,/REVOKE ALL ON public\.sales_customer_change_audit FROM PUBLIC, anon, authenticated/);
 assert.match(sql,/REVOKE ALL ON public\.sales_special_price_requests FROM PUBLIC, anon, authenticated/);
 assert.doesNotMatch(editor,/\.from\("customer_prices"\)\.update/);
});

test("special price rule uses unrounded GP > 7, missing cost holds price for manager",()=>{
 assert.match(sql,/v_gp := CASE WHEN v_cost IS NOT NULL AND v_cost>=0/);
 assert.match(sql,/\(p_price-v_cost\)\*100\/p_price/);
 assert.match(sql,/v_status := CASE WHEN v_gp>7 THEN 'auto_applied' ELSE 'pending' END/);
 assert.match(sql,/IF v_status='auto_applied' THEN/);
 assert.match(sql,/IF p_approve THEN/);
 assert.match(sql,/status='pending'/);
 assert.match(prices,/admin\.rpc\("sales_submit_special_price"/);
 assert.match(prices,/admin\.rpc\("sales_review_special_price"/);
 assert.doesNotMatch(prices,/body\.cost|body\.margin|body\.gp/);
});

test("salesman and manager have access to their new workflows",()=>{
 assert.match(salesman,/\/salesman\/customer\/\$\{customer\.id\}/);
 assert.match(home,/href: "\/salesman\/reviews"/);
 assert.match(manager,/\/api\/sales\/customer-changes/);
 assert.match(manager,/\/api\/sales\/prices/);
 assert.match(manager,/คืนค่าเดิม/);
 assert.match(editor,/รอ Manager อนุมัติ/);
});
