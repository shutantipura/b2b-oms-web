// Client-only checks for a non-blocking call reminder before task completion.
// These do not replace server-side validation or the manager's formal KPI results.
export type ShortageItem = {
  id: string;
  product_name_snapshot: string;
  requested_qty: number | string;
  confirmed_qty: number | string | null;
  addon_requested_qty?: number | string | null;
  addon_confirmed_qty?: number | string | null;
  actual_qty?: number | string | null;
  actual_piece_qty?: number | string | null;
  unit_snapshot: string;
  piece_price_per_kg_snapshot?: number | string | null;
};

function qty(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function isNativeKg(item: ShortageItem): boolean {
  const unit = item.unit_snapshot.toLowerCase();
  return unit.includes("kg") || unit.includes("กก");
}

// During Stock Check, confirmed is still in the form rather than the database.
// There is no tolerance, even for kilogram items.
export function confirmationCallShortages(
  items: ShortageItem[],
  confirmedDraft: Record<string, string>,
  addonMode: boolean,
): string[] {
  return items.filter(item => {
    const requested = qty(item.requested_qty);
    const added = qty(item.addon_requested_qty) ?? 0;
    if (!addonMode) {
      const confirmed = qty(confirmedDraft[item.id]);
      return requested !== null && confirmed !== null && confirmed < requested;
    }
    const priorConfirmed = qty(item.confirmed_qty);
    const priorRequested = requested === null ? null : requested - added;
    const previousShort = priorRequested !== null && priorConfirmed !== null
      && priorConfirmed < priorRequested;
    const addedConfirmed = qty(confirmedDraft[item.id]);
    const addedShort = added > 0 && addedConfirmed !== null && addedConfirmed < added;
    return previousShort || addedShort;
  }).map(item => item.product_name_snapshot);
}

export function pickingCallShortages(
  items: ShortageItem[],
  pickedDraft: Record<string, string>,
  piecesDraft: Record<string, string>,
  addonMode: boolean,
  actionableIds: ReadonlySet<string>,
): { stock: string[]; pick: string[] } {
  const stock: string[] = [];
  const pick: string[] = [];
  for (const item of items) {
    const requested = qty(item.requested_qty);
    const confirmed = qty(item.confirmed_qty);
    if (requested !== null && confirmed !== null && confirmed < requested) {
      stock.push(item.product_name_snapshot);
    }
    if (confirmed === null) continue;
    const actionable = actionableIds.has(item.id);
    const mixed = item.piece_price_per_kg_snapshot != null;
    let picked: number | null;
    let target = confirmed;
    if (mixed && addonMode && actionable && (qty(item.addon_requested_qty) ?? 0) > 0) {
      // For a repeat picking pass, new piece counts are incremental.
      const newlyConfirmed = qty(item.addon_confirmed_qty);
      const newPieces = qty(piecesDraft[item.id]);
      if (newlyConfirmed !== null && newPieces !== null && newPieces < newlyConfirmed) {
        pick.push(item.product_name_snapshot);
        continue;
      }
      // Preserve visibility of any pre-existing short pick where the old count exists.
      const oldPieces = qty(item.actual_piece_qty);
      const oldConfirmed = newlyConfirmed === null ? null : confirmed - newlyConfirmed;
      if (oldPieces !== null && oldConfirmed !== null && oldPieces < oldConfirmed) {
        pick.push(item.product_name_snapshot);
      }
      continue;
    }
    if (mixed) {
      picked = actionable ? qty(piecesDraft[item.id]) : qty(item.actual_piece_qty);
    } else {
      picked = actionable ? qty(pickedDraft[item.id]) : qty(item.actual_qty);
    }
    if (picked === null) continue;
    const tolerance = !mixed && isNativeKg(item) ? 0.5 : 0;
    if (picked < target - tolerance - 1e-9) pick.push(item.product_name_snapshot);
  }
  return { stock, pick };
}
