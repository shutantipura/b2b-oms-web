// Read-only grouped order item aggregation for Order Management audit.
// Never change the original item rows, their units or staff attribution.
export type PickedItem = {
  id: string;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_snapshot: string;
  unit_price_snapshot: number | string;
  piece_price_per_kg_snapshot?: number | string | null;
  requested_qty: number | string;
  confirmed_qty: number | string | null;
  actual_qty: number | string | null;
  products: { sku: string } | null;
};
export type CombinedItem = PickedItem & { sources: {order_id:string; requested_qty:number; confirmed_qty:number|null; actual_qty:number|null}[] };

export function combinePickedItems(items: PickedItem[]): CombinedItem[] {
  const byKey = new Map<string, CombinedItem>();
  const sums = new Map<string, { value: number; qty: number; fallbackPrice: number }>();
  for (const item of items) {
    const weighed = item.piece_price_per_kg_snapshot != null;
    // A line picked in kg can never be summed into a line picked in pcs.
    const key = [item.product_id, item.unit_snapshot, weighed ? "kg" : "pcs"].join("|");
    const requested = Number(item.requested_qty || 0);
    const confirmed = item.confirmed_qty == null ? null : Number(item.confirmed_qty);
    const picked = item.actual_qty == null ? null : Number(item.actual_qty);
    const price = Number(item.piece_price_per_kg_snapshot ?? item.unit_price_snapshot);
    const row = byKey.get(key);
    if (!row) {
      byKey.set(key, {
        ...item,
        id: `group:${key}`,
        requested_qty: requested,
        confirmed_qty: confirmed,
        actual_qty: picked,
        sources: [{ order_id: item.order_id, requested_qty: requested, confirmed_qty: confirmed, actual_qty: picked }]
      });
      sums.set(key,{value:(picked ?? 0)*price,qty:picked ?? 0,fallbackPrice:price});
    } else {
      row.requested_qty = Number(row.requested_qty) + requested;
      row.confirmed_qty = row.confirmed_qty === null && confirmed === null
        ? null : Number(row.confirmed_qty ?? 0) + Number(confirmed ?? 0);
      row.actual_qty = row.actual_qty === null && picked === null
        ? null : Number(row.actual_qty ?? 0) + Number(picked ?? 0);
      row.sources.push({order_id:item.order_id,requested_qty:requested,confirmed_qty:confirmed,actual_qty:picked});
      const sum = sums.get(key)!;
      sum.value += (picked ?? 0)*price;
      sum.qty += picked ?? 0;
    }
  }
  return [...byKey.entries()].map(([key,row]) => {
    const sum=sums.get(key)!;
    const price=sum.qty > 0 ? sum.value/sum.qty : sum.fallbackPrice;
    return { ...row,
      unit_price_snapshot: row.piece_price_per_kg_snapshot != null ? row.unit_price_snapshot : price,
      piece_price_per_kg_snapshot: row.piece_price_per_kg_snapshot != null ? price : null
    };
  }).sort((a,b)=>a.product_name_snapshot.localeCompare(b.product_name_snapshot,"th"));
}
