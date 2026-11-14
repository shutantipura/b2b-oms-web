import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync("app/miniapp/page.tsx", "utf8");
const managerMenu = readFileSync("app/login/page.tsx", "utf8");
const accessPage = readFileSync("app/line-access/page.tsx", "utf8");
const authorization = readFileSync("lib/server/lineCustomerAccess.ts", "utf8");
const customerApi = readFileSync("app/api/line/customer/route.ts", "utf8");
const checkoutApi = readFileSync("app/api/line/checkout/route.ts", "utf8");

test("Customer role supports multiple shops without misleading one-shop count", () => {
  assert.match(accessPage, /<p className="font-black">สิทธิ์ลูกค้า<\/p>/);
  assert.doesNotMatch(accessPage, /สิทธิ์ลูกค้า \(\{draft.customerCodes.length\} ร้าน\)/);
  assert.match(accessPage, /เลือกได้หลายร้าน/);
  assert.match(accessPage, /checked=\{draft.customerCodes.includes\(customer.code\)\}/);
  assert.match(accessPage, /toggle\(user.id,"customerCodes",customer.code,e.target.checked\)/);
});

test("Managers and Salesmen enter OMS directly; customer ordering remains explicit", () => {
  assert.match(home, /const destination = defaultLinePortal\(data\)/);
  assert.match(home, /shouldAutoOpenLineStaff\(access, portal\)/);
  assert.match(home, /if \(access\?\.hasStaffAccess\)/);
  assert.match(home, /router.replace\("\/miniapp\?portal=staff"\)/);
  assert.match(home, /access.hasCustomerAccess && \(/);
  assert.match(home, /onClick=\{enterCustomerPortal\}/);
  assert.match(home, /onClick=\{openStaffOms\}/);
  assert.match(home, /requestedPortal ===\s*"customer" &&\s*data.hasCustomerAccess/);
  assert.match(home, /requestedPortal ===\s*"staff" &&\s*data.hasStaffAccess/);
});

test("Staff-only still auto-routes to OMS and customer-only auto-routes to their shop", () => {
  assert.match(home, /const destination = defaultLinePortal\(data\)/);
  assert.match(home, /shouldAutoOpenLineStaff\(access, portal\)/);
  assert.match(home, /customers.length ===\s*1/);
});

test("Manager dashboard offers customer ordering entry without granting Staff customer rights", () => {
  const start = managerMenu.indexOf("const MANAGER_NAVIGATION");
  const staff = managerMenu.indexOf("const STAFF_NAVIGATION");
  assert.ok(start >= 0 && staff > start);
  assert.match(managerMenu.slice(start,staff), /href: "\/miniapp\?portal=customer"/);
  assert.match(managerMenu, /const STAFF_NAVIGATION = MANAGER_NAVIGATION.slice\(0, 2\)/);
});

test("Automatic customer access requires active matching Manager/Salesman role and verified LINE", () => {
  assert.match(authorization, /identity\?\.is_active/);
  assert.match(authorization, /staff\?\.is_active &&\s*staff.account_type === identity.assigned_role/);
  assert.match(authorization, /\["manager", "salesman"\]\.includes\(staff.account_type\)/);
  assert.match(authorization, /identity.assigned_role === "staff"/);
  assert.match(authorization, /\.eq\("is_active", true\)/);
  assert.match(customerApi, /loadAuthorizedLineCustomerLinks\(supabase, lineData.sub, lineUser.id\)/);
  assert.match(checkoutApi, /verifyLineAndCustomer/);
});
