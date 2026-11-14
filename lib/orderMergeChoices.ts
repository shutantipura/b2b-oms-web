export type MergeCandidate = {
  orderNumber: number;
  deliveryDate: string;
  deliverySlot: string;
  deliveryAddress?: string;
};

// Suggest all eligible groups but never choose on behalf of the customer.
export function listEligibleMergeChoices<T extends MergeCandidate>(
  candidates: readonly T[], date: string, address: string,
  availableSlots: readonly string[],
): T[] {
  return candidates.filter(candidate =>
    candidate.deliveryDate === date &&
    candidate.deliveryAddress === address &&
    availableSlots.includes(candidate.deliverySlot)
  );
}

export function findChosenMerge<T extends MergeCandidate>(
  candidates: readonly T[], number: number, date: string, address: string,
  availableSlots: readonly string[],
): T | null {
  return listEligibleMergeChoices(candidates, date, address, availableSlots)
    .find(candidate => candidate.orderNumber === number) ?? null;
}
