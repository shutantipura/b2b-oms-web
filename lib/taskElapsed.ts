// A task's elapsed clock is anchored to the persisted claim time, not page-load time.
// Epoch arithmetic remains correct across midnight and Bangkok time-zone boundaries.
export function formatActiveTaskDuration(claimedAt: string | null | undefined, nowMs: number): string | null {
  const startedMs = Date.parse(claimedAt ?? "");
  if (!Number.isFinite(startedMs) || !Number.isFinite(nowMs)) return null;
  const totalMinutes = Math.max(0, Math.floor((nowMs - startedMs) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
