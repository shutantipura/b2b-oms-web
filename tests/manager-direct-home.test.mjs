import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultLinePortal, shouldAutoOpenLineStaff } from "../lib/linePortalRouting.ts";

const mixedManager = {
  hasStaffAccess: true, hasCustomerAccess: true, staff: { accountType: "manager" },
};
const mixedSalesman = {
  hasStaffAccess: true, hasCustomerAccess: true, staff: { accountType: "salesman" },
};
const staffOnly = {
  hasStaffAccess: true, hasCustomerAccess: false, staff: { accountType: "staff" },
};
const customerOnly = { hasStaffAccess: false, hasCustomerAccess: true };

test("Manager defaults straight to OMS even with access to all customers", () => {
  assert.equal(defaultLinePortal(mixedManager), "staff");
  assert.equal(shouldAutoOpenLineStaff(mixedManager, "staff"), true);
  assert.equal(shouldAutoOpenLineStaff(mixedManager, "customer"), false);
});

test("Customer, Staff, and mixed Salesman flows stay unchanged", () => {
  assert.equal(defaultLinePortal(staffOnly), "staff");
  assert.equal(shouldAutoOpenLineStaff(staffOnly, "staff"), true);
  assert.equal(defaultLinePortal(customerOnly), "customer");
  assert.equal(shouldAutoOpenLineStaff(customerOnly, "customer"), false);
  assert.equal(defaultLinePortal(mixedSalesman), "choose");
  assert.equal(shouldAutoOpenLineStaff(mixedSalesman, "staff"), false);
});

test("explicit Manager customer-order portal and Manager home shortcut remain available", () => {
  const page = readFileSync(new URL("../app/miniapp/page.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.match(page, /requestedPortal ===[\s\S]*?"customer" &&[\s\S]*?data.hasCustomerAccess/);
  assert.match(page, /const destination = defaultLinePortal\(data\)/);
  assert.match(page, /shouldAutoOpenLineStaff\(access, portal\)/);
  // A Manager opening customer ordering must not lose that query parameter if
  // LIFF requires a fresh authentication round trip.
  assert.match(page, /requestedPortal === "customer" \|\| requestedPortal === "accountant" \? window.location.search : ""/);
  assert.match(page, /router.replace\("\/miniapp\?portal=staff"\)/);
  assert.match(home, /name: "สั่งสินค้าแทนลูกค้า", href: "\/miniapp\?portal=customer"/);
  assert.match(home, /const navigation = isManager \? MANAGER_NAVIGATION/);
  assert.match(home, /!fixedTerminal && !isManager/);
  assert.match(page, /"กลับหน้าผู้จัดการ"/);
});
