-- Customer ordering is available at any hour. Deliver in the earliest
-- not-yet-started 2-hour window among the existing daily windows.
-- Examples: 06:00 -> 07:00-09:00; 14:50 -> 15:00-17:00;
-- after 15:00 -> the next day's first window.
-- The UI and database compare the slot START against actual Bangkok time.
-- The existing orders trigger remains installed and calls this function.
-- Customer add-on merges must follow the same slot-start rule.

CREATE OR REPLACE FUNCTION public.validate_delivery_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $schedule$
DECLARE
  v_slot_start_text text;
  v_slot_start time;
  v_now_bkk timestamp without time zone;
BEGIN
  -- Do not retroactively invalidate an already accepted schedule when
  -- unrelated fields are edited or a form resubmits identical date/slot.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.delivery_date IS NOT DISTINCT FROM OLD.delivery_date
      AND NEW.delivery_slot IS NOT DISTINCT FROM OLD.delivery_slot THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.delivery_date IS NULL OR NULLIF(btrim(coalesce(NEW.delivery_slot, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Delivery date and time slot are required';
  END IF;

  -- Accept existing formats: 07:00–09:00, 07:00 - 09:00, 10:00-12:00, etc.
  v_slot_start_text := left(btrim(NEW.delivery_slot), 5);
  IF v_slot_start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Delivery slot must begin with a valid 24-hour HH:MM time';
  END IF;
  v_slot_start := v_slot_start_text::time;

  -- clock_timestamp() uses the actual submission instant rather than
  -- transaction-start time, so a window that has already begun is rejected.
  v_now_bkk := timezone('Asia/Bangkok', clock_timestamp());

  IF (NEW.delivery_date + v_slot_start) < v_now_bkk THEN
    RAISE EXCEPTION 'Delivery slot has already started; choose the next available window';
  END IF;

  RETURN NEW;
END;
$schedule$;

-- Keep the merge RPC synchronized with the next-window trigger policy.
-- No function permissions are broadened: this remains service_role-only.

-- Source for the deployed Supabase migration: customer_order_merge_before_billing.
-- This RPC must only be invoked by a server that has verified LINE authorization.
-- Apply on a test project before updating production; checkout API requires this RPC.

CREATE OR REPLACE FUNCTION public.merge_customer_order(p_customer_id uuid, p_primary_order_number bigint, p_delivery_date date, p_delivery_slot text, p_customer_notes text, p_items jsonb, p_line_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_qty numeric;
  v_price numeric;
  v_item_count int := 0;
  v_previous_items jsonb;
  v_previous_photos jsonb;
  v_merge_result jsonb;
  v_now_bkk timestamp;
  v_start time;
BEGIN
  IF p_customer_id IS NULL OR p_line_user_id IS NULL OR p_request_id IS NULL
    OR p_primary_order_number IS NULL THEN
    RAISE EXCEPTION 'Missing customer, LINE account, order or merge request';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'The added basket must contain between 1 and 200 products';
  END IF;

  -- Only a LINE user authorized to place orders for this customer can merge.
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_line_users clu
    JOIN public.line_users lu ON lu.id = clu.line_user_id
    JOIN public.customers c ON c.id = clu.customer_id
    WHERE clu.customer_id = p_customer_id
      AND clu.line_user_id = p_line_user_id
      AND clu.can_order = true
      AND lu.is_active = true
      AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'This LINE account cannot order for the selected customer';
  END IF;

  -- Locks serialize against claim_task(), which also locks the order first.
  SELECT * INTO v_order
  FROM public.orders
  WHERE order_number = p_primary_order_number
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Primary order not found for this customer';
  END IF;

  -- Idempotency: retrying the exact submitted request does not add quantities twice.
  SELECT jsonb_build_object(
      'success', true,
      'merged', true,
      'order_number', v_order.order_number,
      'new_status', v_order.status,
      'already_processed', true
    )
  INTO v_merge_result
  FROM public.order_history h
  WHERE h.order_id = v_order.id
    AND h.action = 'items_merged'
    AND h.details->>'merge_request_id' = p_request_id::text
  LIMIT 1;

  IF v_merge_result IS NOT NULL THEN RETURN v_merge_result; END IF;

  IF v_order.status <> 'awaiting_billing'
    OR v_order.final_amount IS NOT NULL
    OR v_order.cancelled_at IS NOT NULL
    OR v_order.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This order is no longer awaiting billing; please place a separate order';
  END IF;

  -- Never modify a primary that any staff member has already claimed for billing,
  -- even if a claim was later released. A draft bill may have been prepared.
  IF EXISTS (
    SELECT 1 FROM public.task_claims
    WHERE order_id = v_order.id AND stage = 'billing'
  ) OR EXISTS (
    SELECT 1 FROM public.order_files
    WHERE order_id = v_order.id AND file_type IN ('bill', 'payment_qr')
  ) THEN
    RAISE EXCEPTION 'Billing has already started for this order; please place a separate order';
  END IF;

  IF v_order.delivery_date IS DISTINCT FROM p_delivery_date
    OR v_order.delivery_slot IS DISTINCT FROM p_delivery_slot THEN
    RAISE EXCEPTION 'A merged order must keep the primary delivery date and time slot';
  END IF;

  -- Adding products counts as a new submission. Only merge while the
  -- original delivery window has not yet started.
  v_now_bkk := timezone('Asia/Bangkok', clock_timestamp());
  v_start := substring(v_order.delivery_slot FROM '([0-2][0-9]:[0-5][0-9])')::time;
  IF v_order.delivery_date IS NULL OR v_start IS NULL
    OR (v_order.delivery_date + v_start) < v_now_bkk THEN
    RAISE EXCEPTION 'The primary delivery window has already started';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'product_id', oi.product_id,
    'requested_qty', oi.requested_qty,
    'confirmed_qty', oi.confirmed_qty,
    'actual_qty', oi.actual_qty,
    'unit_price_snapshot', oi.unit_price_snapshot
  )), '[]'::jsonb)
  INTO v_previous_items
  FROM public.order_items oi WHERE oi.order_id = v_order.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'file_type', f.file_type, 'storage_path', f.storage_path
  )), '[]'::jsonb)
  INTO v_previous_photos
  FROM public.order_files f
  WHERE f.order_id = v_order.id
    AND f.file_type IN ('cart_photo', 'cart_photo_2')
    AND f.is_current = true;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Every added item must be an object';
    END IF;

    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_qty > 100000 THEN
      RAISE EXCEPTION 'A valid product and positive quantity are required';
    END IF;

    SELECT * INTO v_product FROM public.products
    WHERE id = v_product_id AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An added product is no longer active';
    END IF;

    SELECT coalesce((
      SELECT cp.agreed_price
      FROM public.customer_prices cp
      WHERE cp.customer_id = p_customer_id
        AND cp.product_id = v_product_id
        AND cp.is_active = true
      LIMIT 1
    ), v_product.normal_price) INTO v_price;

    -- Weighted snapshot honours the old price for originally ordered units.
    -- Newly added units use today's agreed price.
    INSERT INTO public.order_items AS oi (
      order_id, product_id, product_name_snapshot, unit_snapshot,
      requested_qty, confirmed_qty, actual_qty, unit_price_snapshot
    ) VALUES (
      v_order.id, v_product_id, v_product.product_name, v_product.unit,
      v_qty, v_qty, null, v_price
    )
    ON CONFLICT (order_id, product_id) DO UPDATE SET
      unit_price_snapshot = (
        (oi.requested_qty * oi.unit_price_snapshot) +
        (excluded.requested_qty * excluded.unit_price_snapshot)
      ) / (oi.requested_qty + excluded.requested_qty),
      requested_qty = oi.requested_qty + excluded.requested_qty,
      confirmed_qty = coalesce(oi.confirmed_qty, oi.requested_qty) + excluded.requested_qty,
      actual_qty = NULL,
      updated_at = now();

    v_item_count := v_item_count + 1;
  END LOOP;

  -- Previous pick quantities remain in history, but must not count as new picking.
  UPDATE public.order_items SET actual_qty = NULL, updated_at = now()
  WHERE order_id = v_order.id;

  -- Keep the stored photos as historical records, but require new current photo(s).
  UPDATE public.order_files SET is_current = false
  WHERE order_id = v_order.id
    AND file_type IN ('cart_photo', 'cart_photo_2')
    AND is_current = true;

  UPDATE public.orders
  SET status = 'awaiting_picking', updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.order_history (
    order_id, action, stage, from_status, to_status,
    performed_by_line_user_id, note, details
  ) VALUES (
    v_order.id, 'items_merged', 'picking', 'awaiting_billing',
    'awaiting_picking', p_line_user_id,
    'Customer added ' || v_item_count || ' items to the existing delivery; picking must be repeated',
    jsonb_build_object(
      'merge_request_id', p_request_id,
      'added_items', p_items,
      'previous_items', v_previous_items,
      'previous_cart_photos', v_previous_photos,
      'customer_notes', coalesce(p_customer_notes, ''),
      'delivery_date', v_order.delivery_date,
      'delivery_slot', v_order.delivery_slot
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'merged', true,
    'order_number', v_order.order_number,
    'new_status', 'awaiting_picking',
    'added_item_count', v_item_count
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.merge_customer_order(uuid,bigint,date,text,text,jsonb,uuid,uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_customer_order(uuid,bigint,date,text,text,jsonb,uuid,uuid)
TO service_role;

COMMENT ON FUNCTION public.merge_customer_order(uuid,bigint,date,text,text,jsonb,uuid,uuid)
IS 'Merge a verified LINE customer basket into an awaiting_billing order with no prior billing claim; reset to picking atomically.';

