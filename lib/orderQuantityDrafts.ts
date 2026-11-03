/**
 * Refresh the order after adding a product without discarding quantity edits.
 * Keep drafts for the refreshed row IDs and use database defaults for new rows.
 */
export function preserveOrderQuantityDrafts(
  freshValues: Record<string, string>,
  currentDrafts: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = { ...freshValues };

  for (const id of Object.keys(next)) {
    if (Object.prototype.hasOwnProperty.call(currentDrafts, id)) {
      next[id] = currentDrafts[id];
    }
  }

  return next;
}
