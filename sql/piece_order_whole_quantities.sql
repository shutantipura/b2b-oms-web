-- Piece-count orders retain per-kg price in separate snapshot metadata,
-- but requested/confirmed/picked quantities are counts, never fractional kg.
ALTER TABLE public.order_items
ADD CONSTRAINT piece_order_whole_quantities CHECK (
  piece_price_per_kg_snapshot IS NULL
  OR (
    unit_snapshot = 'ชิ้น'
    AND unit_price_snapshot = 0
    AND requested_qty = trunc(requested_qty)
    AND requested_qty >= 1
    AND (confirmed_qty IS NULL OR (confirmed_qty >= 0 AND confirmed_qty = trunc(confirmed_qty)))
    AND (actual_qty IS NULL OR (actual_qty >= 0 AND actual_qty = trunc(actual_qty)))
    AND addon_requested_qty = trunc(addon_requested_qty)
    AND (addon_confirmed_qty IS NULL OR addon_confirmed_qty = trunc(addon_confirmed_qty))
    AND (addon_picked_qty IS NULL OR addon_picked_qty = trunc(addon_picked_qty))
  )
);