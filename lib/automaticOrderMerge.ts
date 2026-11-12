export type AutomaticMergeCandidate = {
  orderNumber: number;
  deliveryDate: string;
  deliverySlot: string;
  deliveryAddress?: string;
};

// Candidates arrive oldest first from the server. Reuse the earliest eligible
// primary order, but never silently merge across dates, locations, or closed slots.
export function chooseAutomaticMerge<T extends AutomaticMergeCandidate>(
  candidates: T[],
  date: string,
  address: string,
  availableSlots: readonly string[],
): T | null {
  return candidates.find(candidate =>
    candidate.deliveryDate === date &&
    candidate.deliveryAddress === address &&
    availableSlots.includes(candidate.deliverySlot)
  ) ?? null;
}
