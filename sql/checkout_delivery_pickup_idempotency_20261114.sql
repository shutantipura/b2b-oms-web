-- Client checkout retries must be atomic, including concurrent requests.
-- Existing grouped orders retain their separate group_request_id idempotency rule.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_request_id uuid,
  ADD COLUMN IF NOT EXISTS checkout_request_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_request_unique
  ON public.orders(checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_checkout_order_once(
  p_customer_id uuid,
  p_line_user_id uuid,
  p_customer_code text,
  p_delivery_date date,
  p_delivery_slot text,
  p_delivery_address text,
  p_customer_notes text,
  p_items jsonb,
  p_request_id uuid,
  p_is_pickup boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_customer_code text;
  v_existing public.orders%rowtype;
  v_fingerprint text;
  v_items jsonb;
  v_result jsonb;
  v_order_id uuid;
BEGIN
  IF p_request_id IS NULL OR p_customer_id IS NULL OR p_line_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing checkout request identifier';
  END IF;
  IF p_is_pickup IS NULL THEN
    RAISE EXCEPTION 'Pickup setting must be explicit';
  END IF;

  -- Independently recheck the LINE identity and shop access in the database.
  -- Do not rely on a customer ID passed from the browser.
  SELECT c.customer_code INTO v_customer_code
  FROM public.customers c
  JOIN public.line_users lu ON lu.id=p_line_user_id AND lu.is_active=true
  WHERE c.id=p_customer_id AND c.is_active=true
    AND upper(c.customer_code)=upper(trim(p_customer_code))
    AND (
      (lu.assigned_role='customer' AND EXISTS (
        SELECT 1 FROM public.customer_line_users clu
        WHERE clu.line_user_id=lu.id AND clu.customer_id=c.id AND clu.can_order=true
      ))
      OR (lu.assigned_role IN ('manager','salesman') AND EXISTS (
        SELECT 1 FROM public.staff_line_users slu
        JOIN public.staff s ON s.id=slu.staff_id
        WHERE slu.line_user_id=lu.line_user_id AND slu.is_authorized=true
          AND s.is_active=true AND s.account_type=lu.assigned_role
      ))
    );
  IF v_customer_code IS NULL THEN
    RAISE EXCEPTION 'LINE user is not authorized for this active shop';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array'
    OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'Order items must be a nonempty array';
  END IF;

  -- Deterministic fingerprint: retry with the same key cannot silently
  -- substitute another basket, location, customer, slot or fulfilment mode.
  SELECT jsonb_agg(item ORDER BY item->>'product_id',item->>'order_unit')
    INTO v_items
  FROM jsonb_array_elements(p_items) item;
  v_fingerprint := md5(jsonb_build_object(
      'customer',p_customer_id,
      'lineUser',p_line_user_id,
      'date',p_delivery_date,
      'slot',trim(coalesce(p_delivery_slot,'')),
      'address',CASE WHEN p_is_pickup THEN 'รับสินค้าที่สาขา' ELSE trim(coalesce(p_delivery_address,'')) END,
      'notes',trim(coalesce(p_customer_notes,'')),
      'items',v_items,
      'pickup',p_is_pickup
    )::text);

  -- A transaction-scoped advisory lock serializes concurrent first submissions
  -- of one request ID; the unique index is an additional backstop.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  SELECT * INTO v_existing FROM public.orders
   WHERE checkout_request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.customer_id IS DISTINCT FROM p_customer_id
       OR v_existing.checkout_request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Checkout request key was used for different order details';
    END IF;
    RETURN jsonb_build_object(
      'order_id',v_existing.id,
      'order_number',v_existing.order_number,
      'fulfillment_method',v_existing.fulfillment_method,
      'already_processed',true
    );
  END IF;

  -- Reuse the proven legacy checkout RPCs; insert, items, history, the
  -- idempotency fields and the LINE actor commit in ONE transaction.
  IF p_is_pickup THEN
    v_result := public.create_customer_pickup_order(
      v_customer_code,p_delivery_date,p_delivery_slot,p_customer_notes,p_items);
  ELSE
    v_result := public.create_customer_order(
      v_customer_code,p_delivery_date,p_delivery_slot,p_delivery_address,p_customer_notes,p_items);
  END IF;
  v_order_id := (v_result->>'order_id')::uuid;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order created without an ID';
  END IF;
  UPDATE public.orders SET
    checkout_request_id=p_request_id,
    checkout_request_fingerprint=v_fingerprint,
    ordered_by_line_user_id=p_line_user_id
  WHERE id=v_order_id AND customer_id=p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'New checkout order did not belong to selected customer';
  END IF;
  RETURN v_result || jsonb_build_object('already_processed',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_checkout_order_once(
  uuid,uuid,text,date,text,text,text,jsonb,uuid,boolean
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_order_once(
  uuid,uuid,text,date,text,text,text,jsonb,uuid,boolean
) TO service_role;
