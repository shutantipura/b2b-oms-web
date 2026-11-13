import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path=>readFileSync(new URL(path,import.meta.url),"utf8");
const ui=read("../app/line-access/page.tsx");
const sql=read("../sql/unified_line_role_onboarding.sql");
const home=read("../app/login/page.tsx");
const staff=read("../app/staff/page.tsx");
const staffSession=read("../app/api/line/staff-session/route.ts");
const lineCustomer=read("../app/api/line/customer/route.ts");
const access=read("../lib/server/lineCustomerAccess.ts");

test("LINE authorization is the sole onboarding menu; old staff page redirects",()=>{
 assert.doesNotMatch(home, /href: "\/staff"/);
 assert.match(home, /href: "\/line-access"/);
 assert.match(staff, /redirect\("\/line-access"\)/);
 assert.match(ui, /get_line_roles_admin/);
 assert.match(ui, /set_line_account_role/);
 assert.doesNotMatch(ui, /set_line_staff_access|set_line_customer_access|set_line_all_customer_access/);
});
test("LINE activation/deactivation remains available without deleting history",()=>{
 assert.match(ui,/async function setLineActive/);
 assert.match(ui,/set_line_user_active_status/);
 assert.match(ui,/if\(!active&&user.role\)/);
 assert.match(ui,/ปิดใช้งานบัญชี LINE/);
 assert.match(ui,/เปิดใช้งานบัญชี LINE/);
});
test("one role selector, with staff records created automatically",()=>{
 for(const role of ["manager","salesman","staff","customer"]) {
   assert.ok(ui.includes('id:"'+role+'"'));
 }
 assert.match(ui,/type Role = "manager" \| "salesman" \| "staff" \| "customer"/);
 assert.match(sql,/line_users_assigned_role_check/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public.set_line_account_role/);
 assert.match(sql,/INSERT INTO public.staff\(staff_code,staff_name,account_type,is_active\)/);
 assert.match(sql,/ON CONFLICT\(line_user_id\) DO UPDATE/);
});
test("granular staff tasks are granted atomically, and revoked on role changes",()=>{
 for(const stage of ["confirmation","picking","billing","delivery","payment_verification"]){
   assert.ok(ui.includes('id: "'+stage+'"'));
 }
 assert.match(ui,/selectedRole==="staff"/);
 assert.match(sql,/DELETE FROM public.staff_task_permissions WHERE staff_id=target_staff_id/);
 assert.match(sql,/ELSIF p_role='staff' THEN/);
 assert.match(sql,/IF p_role='manager' THEN/);
 assert.match(sql,/UPDATE public.staff_line_users SET is_authorized=false/);
});
test("customer permissions remain individually selected",()=>{
 assert.match(ui,/selectedRole==="customer"/);
 assert.match(ui,/draft.customerCodes.includes/);
 assert.match(ui,/selectedRole==="manager"\|\|selectedRole==="salesman"/);
 assert.match(sql,/INSERT INTO public.customer_line_users\(line_user_id,customer_id,can_order\)/);
 assert.match(sql,/UPDATE public.customer_line_users SET can_order=false/);
 assert.match(access,/identity.assigned_role === "staff"/);
 assert.match(access,/identity.assigned_role !== "customer"/);
});
test("staff sessions and manager privileges require current LINE role",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public.is_current_manager/);
 assert.match(sql,/lu.assigned_role='manager'/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public.current_staff_id/);
 assert.match(sql,/lu.assigned_role=s.account_type/);
 assert.match(sql,/previous_staff_id=mgr_id/);
 assert.match(sql,/Cannot revoke the last Manager/);
 assert.match(staffSession,/lineIdentity.assigned_role !== staff.account_type/);
 assert.match(lineCustomer,/lineUser.assigned_role === staff.account_type/);
 assert.match(sql,/REVOKE EXECUTE ON FUNCTION public.set_line_staff_access/);
});
test("four previously mixed accounts become Staff only after another Manager exists, without changing tasks",()=>{
 assert.match(sql,/S001','S005','S006','S021/);
 assert.match(sql,/remaining_managers < 1/);
 assert.match(sql,/Cannot convert all four accounts to Staff without another authorized Manager/);
 assert.match(sql,/UPDATE public\.staff SET account_type='staff'/);
 const block = sql.slice(sql.indexOf("DO $convert_four_to_staff$"),sql.indexOf("END $convert_four_to_staff$"));
 assert.doesNotMatch(block,/DELETE FROM public\.staff_task_permissions|UPDATE public\.staff_task_permissions/);
});
test("legacy shared staff accounts are split without deleting past task history",()=>{
 assert.match(sql,/One staff identity per authorized LINE account/);
 assert.match(sql,/new_staff,stage FROM public.staff_task_permissions/);
 assert.match(sql,/UPDATE public.staff_line_users SET staff_id=new_staff/);
 assert.doesNotMatch(sql,/DELETE FROM public.staff WHERE/);
});
