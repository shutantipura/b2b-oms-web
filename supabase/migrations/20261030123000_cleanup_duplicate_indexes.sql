-- Remove only redundant policies and non-constraint indexes.
DROP POLICY IF EXISTS "authenticated users can delete customer prices" ON public.customer_prices;
DROP POLICY IF EXISTS "authenticated users can insert customer prices" ON public.customer_prices;
DROP POLICY IF EXISTS "authenticated users can update customer prices" ON public.customer_prices;
DROP INDEX IF EXISTS public.customer_prices_customer_product_unique;
DROP INDEX IF EXISTS public.favourites_customer_product_unique;
DROP INDEX IF EXISTS public.idx_products_sku;
DROP INDEX IF EXISTS public.products_sku_lookup_idx;
DROP INDEX IF EXISTS public.products_sku_unique;
DROP INDEX IF EXISTS public.idx_products_customer_visible;
-- Constraint-backed unique indexes remain untouched.
