-- Manual manager-only SKU visibility, using the same products.is_customer_visible
-- source of truth as the existing Excel/CSV visible-products import.

CREATE OR REPLACE FUNCTION public.search_products_for_visibility(
  p_query text DEFAULT '',
  p_filter text DEFAULT 'all',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  sku text,
  product_name text,
  category text,
  unit text,
  normal_price numeric,
  is_customer_visible boolean,
  sales_score numeric,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_query text := left(trim(coalesce(p_query, '')), 200);
  v_filter text := lower(trim(coalesce(p_filter, 'all')));
BEGIN
  IF coalesce(public.is_current_manager(), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;
  IF v_filter NOT IN ('all', 'visible', 'hidden') THEN
    RAISE EXCEPTION 'Unknown visibility filter';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Invalid pagination settings';
  END IF;
  RETURN QUERY
    SELECT p.id, p.sku::text, p.product_name::text, p.category::text,
      p.unit::text, p.normal_price::numeric, p.is_customer_visible,
      p.sales_score::numeric, count(*) OVER ()::bigint
    FROM public.products p
    WHERE p.is_active = true
      AND (v_filter = 'all'
        OR (v_filter = 'visible' AND p.is_customer_visible = true)
        OR (v_filter = 'hidden' AND p.is_customer_visible = false))
      AND (v_query = ''
        OR p.sku::text ILIKE '%' || v_query || '%'
        OR p.product_name ILIKE '%' || v_query || '%'
        OR coalesce(p.category, '') ILIKE '%' || v_query || '%')
    ORDER BY
      CASE WHEN v_query <> '' AND lower(p.sku::text) = lower(v_query) THEN 0 ELSE 1 END,
      CASE WHEN v_query <> '' AND lower(p.product_name) = lower(v_query) THEN 0 ELSE 1 END,
      p.is_customer_visible DESC,
      p.sales_score DESC NULLS LAST,
      p.sku::text ASC
    OFFSET p_offset LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_product_customer_visibility(
  p_product_id uuid,
  p_visible boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_product public.products%rowtype;
BEGIN
  IF coalesce(public.is_current_manager(), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;
  IF p_product_id IS NULL OR p_visible IS NULL THEN
    RAISE EXCEPTION 'Product and visibility choice are required';
  END IF;

  -- Make a deliberate one-SKU update with no change to price, stock, or images.
  SELECT * INTO v_product FROM public.products p
    WHERE p.id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product no longer exists';
  END IF;
  IF v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Inactive products cannot be published';
  END IF;

  IF v_product.is_customer_visible IS DISTINCT FROM p_visible THEN
    UPDATE public.products p
      SET is_customer_visible = p_visible,
          catalogue_updated_at = now()
      WHERE p.id = p_product_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_product.id,
    'sku', v_product.sku,
    'is_customer_visible', p_visible,
    'changed', v_product.is_customer_visible IS DISTINCT FROM p_visible
  );
END;
$$;

REVOKE ALL ON FUNCTION public.search_products_for_visibility(text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_product_customer_visibility(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products_for_visibility(text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_customer_visibility(uuid,boolean) TO authenticated;
