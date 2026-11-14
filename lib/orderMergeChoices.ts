export type MergeCandidate = {
  orderNumber: number;
  deliveryDate: string;
  deliverySlot: string;
  deliveryAddress?: string;
};

// An existing order's delivery window may have passed. Availability of that
// old window is NOT an eligibility criterion: the server must instead verify
// that billing has never started and the complete group is still mergeable.
export function listEligibleMergeChoices<T extends MergeCandidate>(
  candidates: readonly T[], date: string, address: string,
): T[] {
  return candidates.filter(candidate =>
    candidate.deliveryDate === date &&
    candidate.deliveryAddress === address
  );
}

export function findChosenMerge<T extends MergeCandidate>(
  candidates: readonly T[], number: number, date: string, address: string,
): T | null {
  return listEligibleMergeChoices(candidates, date, address)
    .find(candidate => candidate.orderNumber === number) ?? null;
}

// Used for clear customer warnings only; the server checks all merge eligibility.
export function isMergeWindowOverdue(candidate: MergeCandidate, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (key: string) => parts.find(part => part.type === key)?.value ?? "00";
  const today = get("year") + "-" + get("month") + "-" + get("day");
  if (candidate.deliveryDate !== today) return candidate.deliveryDate < today;
  const times = [...candidate.deliverySlot.matchAll(/([01]?\d|2[0-3]):([0-5]\d)/g)];
  if (times.length < 2) return false;
  const end = Number(times[1][1]) * 60 + Number(times[1][2]);
  const current = Number(get("hour")) * 60 + Number(get("minute"));
  return current >= end;
}
