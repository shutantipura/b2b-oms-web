/**
 * An awaiting-billing order has completed Picking. Calculate its provisional
 * bill from actual picked quantities and the prices frozen on each order line.
 * Piece-ordered, weight-priced products store their measured kilograms in
 * actual_qty and their THB/kg price in piece_price_per_kg_snapshot.
 */
export function calculatePickedOrderEstimate(
  items: readonly Record<string, unknown>[]
): number | null {
  if (items.length === 0) return null;

  let total = 0;
  for (const item of items) {
    const quantity = nonNegativeNumber(item.actual_qty);
    const price = nonNegativeNumber(
      item.piece_price_per_kg_snapshot ?? item.unit_price_snapshot
    );
    if (quantity === null || price === null) return null;
    total += quantity * price;
  }

  return Number.isFinite(total) ? total : null;
}

function nonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
