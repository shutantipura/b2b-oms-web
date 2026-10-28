-- Preserve original per-kg price when a kg-priced SKU is ordered in pieces.
-- The order item uses unit_snapshot='ชิ้น' and unit_price_snapshot=0
-- so existing totals never multiply a piece count by a per-kg price.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS piece_price_per_kg_snapshot numeric;
ALTER TABLE public.order_items
  ADD CONSTRAINT piece_price_snapshot_nonnegative
  CHECK (piece_price_per_kg_snapshot IS NULL OR piece_price_per_kg_snapshot >= 0);
COMMENT ON COLUMN public.order_items.piece_price_per_kg_snapshot IS
  'Original price per kg on customer piece orders; amount due is determined after weighing. NULL for standard units.';
