import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateTaskEntry } from "../lib/taskEntryValidation.ts";

const ready = (status, ownerStaffId = null, ownerStaffName = null) => ({
  status, ownerStaffId, ownerStaffName,
});

test("every task stage checks the up-to-date status before starting", () => {
  const expected = {
    confirmation: "awaiting_confirmation",
    picking: "awaiting_picking",
    billing: "awaiting_billing",
    delivery: "ready_for_delivery",
    payment_verification: "payment_submitted",
  };
  for (const [stage, status] of Object.entries(expected)) {
    assert.equal(evaluateTaskEntry(stage, "start", ready(status), "s1").allowed, true, stage);
    assert.equal(evaluateTaskEntry(stage, "start", ready("completed"), "s1").allowed, false, stage);
    assert.equal(evaluateTaskEntry(stage, "start", ready("cancelled"), "s1").allowed, false, stage);
  }
});

test("a stale start button cannot override another employee's claim", () => {
  const decision = evaluateTaskEntry("billing", "start", ready("awaiting_billing", "s2", "พนักงานบี"), "s1");
  assert.equal(decision.allowed, false);
  assert.match(decision.message, /พนักงานบี/);
});

test("a second Start click by the current owner does not create a second claim", () => {
  const decision = evaluateTaskEntry("confirmation", "start", ready("awaiting_confirmation", "s1"), "s1");
  assert.equal(decision.allowed, false);
  assert.match(decision.message, /ทำต่อ/);
});

test("Continue requires this employee to remain the owner and the task to remain open", () => {
  const expected = {
    confirmation: "awaiting_confirmation",
    picking: "picking",
    billing: "awaiting_billing",
    delivery: "out_for_delivery",
    payment_verification: "payment_submitted",
  };
  for (const [stage, status] of Object.entries(expected)) {
    assert.equal(evaluateTaskEntry(stage, "continue", ready(status, "s1"), "s1").allowed, true);
    assert.equal(evaluateTaskEntry(stage, "continue", ready(status, "s2", "พนักงานบี"), "s1").allowed, false);
    assert.equal(evaluateTaskEntry(stage, "continue", ready(status), "s1").allowed, false);
    assert.equal(evaluateTaskEntry(stage, "continue", ready("completed", "s1"), "s1").allowed, false);
  }
});

test("stale task cards are rechecked on both entry buttons, without a timed page refresh", () => {
  const page = readFileSync(new URL("../app/tasks/page.tsx", import.meta.url), "utf8");
  assert.match(page, /async function readLatestTaskState/);
  assert.match(page, /\.from\("orders"\)\s*\.select\("id,status"\)/);
  assert.match(page, /\.from\("task_claims"\)\s*\.select\("staff_id"\)/);
  assert.match(page, /evaluateTaskEntry\(stage, "start"/);
  assert.match(page, /evaluateTaskEntry\(stage, "continue"/);
  assert.match(page, /supabase\.rpc\("claim_my_task"/);
  assert.match(page, /onClick=\{\(\) => void continueWork\(/);
  assert.doesNotMatch(page, /useAutoRefresh/);
});
