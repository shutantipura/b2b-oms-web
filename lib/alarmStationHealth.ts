/** Shared interpretation of Android terminal health for API and Manager UI.
 * The 90-second heartbeat threshold allows an expected 60-second quiet-hour poll.
 * Quiet hours mute audio, not the monitoring service or its heartbeat.
 */
export type AlarmStationCondition = "revoked" | "awaiting" | "offline" |
  "disabled" | "degraded" | "healthy";

export type AlarmStationHeartbeat = {
  last_seen_at: string | null;
  last_success_at: string | null;
  monitor_active: boolean;
  revoked_at?: string | null;
};

export function classifyAlarmStation(
  station: AlarmStationHeartbeat,
  now: number,
): AlarmStationCondition {
  if (station.revoked_at) return "revoked";
  if (!station.last_seen_at) return "awaiting";
  const seen = Date.parse(station.last_seen_at);
  if (!Number.isFinite(seen) || now - seen > 90_000) return "offline";
  // A heartbeat alone is not proof that the alarm is monitoring.
  if (!station.monitor_active) return "disabled";
  const lastOk = station.last_success_at ? Date.parse(station.last_success_at) : NaN;
  if (!Number.isFinite(lastOk) || now - lastOk > 120_000) return "degraded";
  return "healthy";
}
