import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {defaultLinePortal,shouldAutoOpenLineStaff} from "../lib/linePortalRouting.ts";
const app=readFileSync(new URL("../app/miniapp/page.tsx",import.meta.url),"utf8");
const home=readFileSync(new URL("../app/login/page.tsx",import.meta.url),"utf8");
const salesman=readFileSync(new URL("../app/salesman/page.tsx",import.meta.url),"utf8");

test("all operational roles skip the intermediate role selection and staff login card",()=>{
  for (const role of ["manager","salesman","staff"]) {
    const a={hasStaffAccess:true,hasCustomerAccess:role!=="staff",staff:{accountType:role}};
    assert.equal(defaultLinePortal(a),"staff");
    assert.equal(shouldAutoOpenLineStaff(a,"staff"),true);
    assert.equal(shouldAutoOpenLineStaff(a,"customer"),false);
  }
  assert.match(app,/if \(portal === "staff" && access.hasStaffAccess && access.staff\)/);
  assert.match(app,/return <LotusLoading message=\{staffLoginStep \|\| "กำลังเปิดหน้าหลักตามสิทธิ์ของคุณ\.\.\."\} \/>/);
  assert.doesNotMatch(home,/เปลี่ยนประเภทการใช้งาน/);
});

test("customer homes remain direct; multiple shops still require selecting a shop",()=>{
  assert.equal(defaultLinePortal({hasCustomerAccess:true,hasStaffAccess:false}),"customer");
  assert.match(app,/customers.length ===\s*1/);
  assert.match(app,/portal === "customer" &&\s*!selectedCustomer &&\s*\(access.customers \?\? \[\]\).length > 1/);
  assert.match(app,/requestedPortal ===\s*"customer" &&\s*data.hasCustomerAccess/);
});

test("order for customer stays accessible to Manager and Salesman and returns to their role home",()=>{
  assert.match(app,/router.replace\("\/miniapp\?portal=staff"\)/);
  assert.match(app,/กลับหน้าผู้จัดการ/);
  assert.match(app,/กลับหน้าฝ่ายขาย/);
  assert.match(home,/name: "สั่งสินค้าแทนลูกค้า", href: "\/miniapp\?portal=customer"/);
  assert.match(salesman,/href="\/miniapp\?portal=customer"/);
});

test("staff home still requires full LINE and Supabase authentication",()=>{
  assert.match(app,/fetch\("\/api\/line\/staff-session"/);
  assert.match(app,/supabase.auth.verifyOtp/);
  assert.match(app,/window.location.assign\(new URL\("\/login"/);
});
