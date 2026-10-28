-- Piece-ordered weighted SKU:
-- ordered and stock-confirmed quantities are integer pieces;
-- actual_qty and addon_picked_qty represent measured KG (up to 3 dp).
-- For other SKUs all quantities continue to use unit_snapshot.
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS piece_order_whole_quantities;

ALTER TABLE public.order_items
  ADD CONSTRAINT piece_order_confirm_pieces_pick_kg CHECK (
    piece_price_per_kg_snapshot IS NULL OR (
      unit_snapshot = 'ชิ้น'
      AND unit_price_snapshot = 0
      AND requested_qty >= 1
      AND requested_qty = trunc(requested_qty)
      AND (confirmed_qty IS NULL OR (confirmed_qty >= 0 AND confirmed_qty = trunc(confirmed_qty)))
      AND addon_requested_qty >= 0 AND addon_requested_qty = trunc(addon_requested_qty)
      AND (addon_confirmed_qty IS NULL OR (addon_confirmed_qty >= 0 AND addon_confirmed_qty = trunc(addon_confirmed_qty)))
      AND (actual_qty IS NULL OR (actual_qty >= 0 AND actual_qty = round(actual_qty, 3)))
      AND (addon_picked_qty IS NULL OR (addon_picked_qty >= 0 AND addon_picked_qty = round(addon_picked_qty, 3)))
    )
  );

COMMENT ON COLUMN public.order_items.piece_price_per_kg_snapshot IS
  'When non-null: requested_qty/confirmed_qty are pieces; actual_qty/addon_picked_qty are measured kg (0.001 precision); per-kg price is here. unit_price_snapshot remains 0 to avoid multiplying piece count by per-kg price.';
