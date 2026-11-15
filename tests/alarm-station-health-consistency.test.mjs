import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyAlarmStation } from "../lib/alarmStationHealth.ts";

const now = Date.parse("2026-11-14T16:00:00Z");
const heartbeat = (seen, ok, monitoring=true, revoked=null) => ({
  last_seen_at: seen,
  last_success_at: ok,
  monitor_active: monitoring,
  revoked_at: revoked,
});
const ago = seconds => new Date(now - seconds * 1000).toISOString();

test("online but disabled terminal is not considered healthy", () => {
  assert.equal(classifyAlarmStation(heartbeat(ago(20),ago(20),false),now),"disabled");
  assert.equal(classifyAlarmStation(heartbeat(ago(20),ago(200),true),now),"degraded");
  assert.equal(classifyAlarmStation(heartbeat(ago(20),ago(20),true),now),"healthy");
});
test("stale terminal and never-paired terminal are distinct, including during quiet hours",()=>{
  assert.equal(classifyAlarmStation(heartbeat(ago(91),ago(20)),now),"offline");
  assert.equal(classifyAlarmStation(heartbeat(ago(90),ago(90)),now),"healthy");
  assert.equal(classifyAlarmStation(heartbeat(null,null),now),"awaiting");
  assert.equal(classifyAlarmStation(heartbeat("invalid",null),now),"offline");
  assert.equal(classifyAlarmStation(heartbeat(ago(120),ago(20),false,ago(20)),now),"revoked");
});
test("Manager health and station detail share the same status function",()=>{
  const health=readFileSync(new URL("../app/api/admin/operational-health/route.ts",import.meta.url),"utf8");
  const station=readFileSync(new URL("../app/alarm-stations/page.tsx",import.meta.url),"utf8");
  assert.match(health,/classifyAlarmStation\(station, now\)/);
  assert.match(station,/classifyAlarmStation\(station, now\)/);
  assert.match(station,/ต้องจับคู่เครื่องด้วยรหัส 6 หลัก/);
  assert.doesNotMatch(station,/การจับคู่เป็นทางเลือกเท่านั้น/);
  assert.doesNotMatch(station,/เสียงเตือน OMS ยังทำงานบนเครื่องได้เหมือนเดิม/);
});
