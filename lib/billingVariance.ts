export type BillingReferenceLine = {
  actual_qty?: number | string | null;
  unit_price_snapshot?: number | string | null;
  piece_price_per_kg_snapshot?: number | string | null;
  line_total?: number | string | null;
};

/**
 * Estimated bill at the Billing stage (not the original order estimate).
 * Ordinary lines use picked quantity × the frozen selling price. Grouped
 * orders use group_billing_lines.line_total, as the Billing RPC does.
 */
export function calculateBillingStageReferenceTotal(items: BillingReferenceLine[]): number {
  const sum = items.reduce((total, item) => {
    if (item.line_total != null) return total + Number(item.line_total);
    const qty = Number(item.actual_qty ?? 0);
    const price = Number(item.piece_price_per_kg_snapshot ?? item.unit_price_snapshot ?? 0);
    return total + qty * price;
  }, 0);
  return Math.round(sum * 100) / 100;
}

export function billingVarianceCents(finalAmount: number, referenceAmount: number): number {
  return Math.round(finalAmount * 100) - Math.round(referenceAmount * 100);
}

export function isBillingVarianceAboveOneBaht(finalAmount: number, referenceAmount: number): boolean {
  return Number.isFinite(finalAmount) && Number.isFinite(referenceAmount) &&
    Math.abs(billingVarianceCents(finalAmount, referenceAmount)) > 100;
}
