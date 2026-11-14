import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");

test("Manager home navigation prioritizes everyday work while keeping all cards", () => {
  const match = source.match(/const MANAGER_NAVIGATION: NavigationItem\[\] = \[([\s\S]*?)\n\];/);
  assert.ok(match, "Manager navigation must be defined");
  const hrefs = [...match[1].matchAll(/href: "([^"]+)"/g)].map(item => item[1]);
  assert.deepEqual(hrefs, [
    "/tasks", // Main daily-work CTA, excluded from shortcut cards
    "/orders",
    "/miniapp?portal=customer",
    "/customers",
    "/catalog",
    "/stock-management",
    "/salesman/reviews",
    "/kpi",
    ...(hrefs.includes("/miniapp?portal=accountant") ? ["/miniapp?portal=accountant"] : []),
    "/line-access",
    "/terminals",
  ]);
  assert.match(source, /const STAFF_NAVIGATION = MANAGER_NAVIGATION.slice\(0, 2\)/);
  assert.match(source, /navigation.filter\(\(item\) => item.href === "\/orders"\)/);
  assert.match(source, /oms-dashboard-tile group relative flex min-h-\[130px\]/);
  assert.match(source, /index === 0 \? "h-1.5 w-9 rounded-full bg-\[#FDBC16\]"/);
});
