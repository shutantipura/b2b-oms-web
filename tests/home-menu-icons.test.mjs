import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync("app/login/page.tsx", "utf8");
const icon = readFileSync("components/HomeMenuIcon.tsx", "utf8");

test("All role shortcuts get a meaningful decorative icon without altering their routes", () => {
  const hrefs = [
    "/tasks", "/orders", "/miniapp?portal=customer", "/customers", "/catalog",
    "/stock-management", "/salesman/reviews", "/kpi", "/line-access", "/terminals",
    "/salesman", "/miniapp?portal=accountant",
  ];
  for (const href of hrefs) {
    assert.ok(icon.includes(JSON.stringify(href) + ": <>"), "missing icon for " + href);
  }
  assert.match(home, /<HomeMenuIcon href=\{item.href\} \/>/);
  assert.match(home, /<HomeMenuIcon href=\{isSalesman \? "\/salesman" : "\/tasks"\} size=\{18\} \/>/);
  assert.match(home, /const STAFF_NAVIGATION = MANAGER_NAVIGATION.slice\(0, 2\)/);
  assert.match(home, /const navigation = isManager \? MANAGER_NAVIGATION : isSalesman \? SALESMAN_NAVIGATION : STAFF_NAVIGATION/);
  assert.match(home, /oms-dashboard-tile group relative flex min-h-\[130px\]/);
  assert.match(home, /grid h-9 w-9 place-items-center rounded-xl bg-\[#E8F8F5\]/);
  assert.match(icon, /aria-hidden="true"/);
});
