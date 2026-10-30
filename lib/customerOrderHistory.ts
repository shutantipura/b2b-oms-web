// Used only for completed/cancelled customer order history.
// A missing historical price must not be replaced by the current catalogue price.
export type HistoricalLineInput = {
  actual: number | null;
  actualUnit: string;
  isPiece?: boolean;
  unitPrice?: number | null;
  pricePerKg?: number | null;
  priceIsCurrentEstimate?: boolean;
};
export function historicalLineValues(item: HistoricalLineInput) {
  const unit = item.isPiece ? "กก." : (item.actualUnit || "หน่วย");
  const actual = item.actual !== null && Number.isFinite(item.actual) && item.actual >= 0
    ? item.actual : null;
  const savedPrice = item.isPiece ? item.pricePerKg : item.unitPrice;
  const unitPrice = !item.priceIsCurrentEstimate && savedPrice != null
    && Number.isFinite(savedPrice) && savedPrice >= 0 ? savedPrice : null;
  const lineValue = actual !== null && unitPrice !== null ? actual * unitPrice : null;
  return { actual, unit, unitPrice, lineValue };
}
