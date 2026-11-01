/**
 * Display order evidence in workflow order, not by the time each photo was added.
 * This also covers manager uploads made after billing or order completion.
 */
export type OrderFileSortKey = {
  id: string;
  file_type: string;
  is_current: boolean;
  created_at: string;
};

export const orderFileStageRank: Readonly<Record<string, number>> = {
  cart_photo: 0,
  cart_photo_2: 1,
  bill: 2,
  bill_2: 3,
  payment_qr: 4,
  payment_qr_2: 5,
  delivery_proof: 6,
  delivery_proof_2: 7,
  payment_slip: 8,
  payment_slip_2: 9,
};

export function compareOrderFiles(a: OrderFileSortKey, b: OrderFileSortKey): number {
  const rankDifference =
    (orderFileStageRank[a.file_type] ?? 99) -
    (orderFileStageRank[b.file_type] ?? 99);
  if (rankDifference !== 0) return rankDifference;
  // Current picking photos come before historical photos from merged orders.
  if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}
