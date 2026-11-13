import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const admin = read("../app/api/admin/staff/route.ts");
const staff = read("../app/staff/page.tsx");
const home = read("../app/login/page.tsx");
const sales = read("../app/salesman/page.tsx");
const taskLayout = read("../app/tasks/layout.tsx");
const line = read("../app/miniapp/page.tsx");
const migration = read("../sql/2026-11-13_salesman_role_prototype.sql");

test("salesman is a separate staff account type, editable by managers", () => {
  assert.match(admin, /type AccountType =[\s\S]*?\| "salesman"/);
  assert.match(admin, /value === "salesman"/);
  assert.match(staff, /<option value="salesman">/);
  assert.match(staff, /Salesman \(ฝ่ายขาย\)/);
  assert.match(staff, /accountType === "salesman"/);
  assert.match(staff, /disabled=\{createRole === "salesman"\}/);
  assert.match(staff, /disabled=\{editRole === "salesman"\}/);
});

test("backend clears all task permissions for salesman on create and role updates", () => {
  assert.match(admin, /const taskPermissions = accountType === "salesman" \? \[\]/);
  assert.match(admin, /const finalPermissions = accountType === "salesman" \? \[\]/);
  assert.match(migration, /staff_account_type_check/);
  assert.match(migration, /'salesman'::text/);
  assert.match(migration, /s\.account_type IN \('staff', 'manager'\)/);
  assert.match(migration, /staff_can_access_stage/);
});

test("salesmen get a customer-service dashboard instead of the operational task queue", () => {
  assert.match(home, /const SALESMAN_NAVIGATION/);
  assert.match(home, /isSalesman \? SALESMAN_NAVIGATION/);
  assert.match(home, /href=\{isSalesman \? "\/salesman" : "\/tasks"\}/);
  assert.match(taskLayout, /account\.account_type === "salesman"/);
  assert.match(taskLayout, /บัญชีฝ่ายขายไม่มีสิทธิ์เข้าถึงงานปฏิบัติการ/);
  assert.match(line, /access\.staff\.accountType === "salesman"/);
});

test("salesman workspace checks the logged-in role and exposes only read-only customer and order data", () => {
  assert.match(sales, /\["salesman", "manager"\]\.includes\(staff\.account_type\)/);
  assert.match(sales, /\.from\("customers"\)/);
  assert.match(sales, /\.from\("orders"\)/);
  assert.match(sales, /\.eq\("is_active", true\)/);
  assert.doesNotMatch(sales, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.doesNotMatch(sales, /product_costs|staff_task_permissions|customer_prices/);
  assert.match(sales, /href="\/miniapp\?portal=customer"/);
  assert.match(sales, /href="\/orders"/);
});

test("LINE customer selection is manual across authorized customers and not privilege escalation", () => {
  assert.match(line, /function enterCustomerPortal\(\)/);
  assert.match(line, /setSelectedCustomer\(\s*null\s*\)/);
  assert.match(line, /"\/miniapp\?portal=customer"/);
  assert.match(line, /availableCustomers\.filter/);
  assert.match(line, /customer\.customerCode/);
});
