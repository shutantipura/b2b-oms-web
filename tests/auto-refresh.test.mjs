import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTO_REFRESH_INTERVAL_MS, isAutoRefreshDue } from "../lib/useAutoRefresh.ts";

test("OMS data refresh uses a 15-minute interval and refreshes a resumed tab", () => {
  assert.equal(AUTO_REFRESH_INTERVAL_MS, 900_000);
  assert.equal(isAutoRefreshDue(0, 899_999, AUTO_REFRESH_INTERVAL_MS), false);
  assert.equal(isAutoRefreshDue(0, 900_000, AUTO_REFRESH_INTERVAL_MS), true);
  assert.equal(isAutoRefreshDue(0, 29_999, 30_000), false);
  assert.equal(isAutoRefreshDue(0, 30_000, 30_000), true);

  const hook = readFileSync(new URL("../lib/useAutoRefresh.ts", import.meta.url), "utf8");
  assert.match(hook, /document\.hidden/);
  assert.match(hook, /addEventListener\("visibilitychange", onResume\)/);
  assert.match(hook, /addEventListener\("focus", onResume\)/);
  assert.doesNotMatch(hook, /location\.reload\(/);
});

test("operational dashboards and order photos re-fetch data instead of reloading forms", () => {
  for (const file of [
    "../app/tasks/page.tsx",
    "../app/orders/page.tsx",
    "../app/kpi/page.tsx",
    "../components/StaffResponsibilities.tsx",
    "../app/orders/[orderNumber]/page.tsx",
    "../app/miniapp/payment/page.tsx",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /useAutoRefresh\(/, file);
  }

  const orderDetails = readFileSync(new URL("../app/orders/[orderNumber]/page.tsx", import.meta.url), "utf8");
  assert.match(orderDetails, /\.from\("order_files"\)/);
  assert.match(orderDetails, /setFiles\(freshFiles\.sort\(compareOrderFiles\)\)/);
});
