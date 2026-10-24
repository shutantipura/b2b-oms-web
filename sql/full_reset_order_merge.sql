-- When new products are merged into a primary order:
-- 1. Increment a persistent adjustment flag (operational status stays normal).
-- 2. Null out ALL confirmed and actually picked quantities across the whole order.
-- 3. Clear incremental add-on fields so the normal existing RPCs handle every SKU.
-- 4. Invalidate every old cart photo; the LINE checkout service then deletes
--    each Storage object and its file metadata by explicit ID.
-- 5. Preserve the old details in order_history for auditing, without retaining
--    obsolete images as active picking evidence.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS adjustment_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_adjustment_count_nonnegative CHECK (adjustment_count >= 0);

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
  v_released_tasks int := 0;
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
      'already_processed', true,
      'retired_cart_photos', coalesce(h.details->'previous_cart_photos', '[]'::jsonb)
    )
  INTO v_merge_result
  FROM public.order_history h
  WHERE h.order_id = v_order.id
    AND h.action IN ('items_merged', 'order_adjusted')
    AND h.details->>'merge_request_id' = p_request_id::text
  LIMIT 1;

  IF v_merge_result IS NOT NULL THEN RETURN v_merge_result; END IF;

  -- Any prebilling task may receive additions. The only hard stage cutoff is
  -- that Billing must NEVER have been claimed or begun (enforced below).
  IF v_order.status NOT IN ('awaiting_confirmation','awaiting_picking','picking','awaiting_billing')
    OR v_order.final_amount IS NOT NULL
    OR v_order.cancelled_at IS NOT NULL
    OR v_order.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This order is no longer eligible for additions; please place a separate order';
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

  -- The merge completely invalidates the previous Confirmation/Picking work.
  -- Release ongoing tasks so stale staff forms can no longer submit quantities
  -- calculated from the original order.
  UPDATE public.task_claims
  SET claim_status='released',released_at=now(),
      release_reason='customer_adjusted_order_full_reset'
  WHERE order_id=v_order.id AND claim_status='active'
    AND stage IN ('confirmation','picking');
  GET DIAGNOSTICS v_released_tasks = ROW_COUNT;

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
;

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
      requested_qty, confirmed_qty, actual_qty, unit_price_snapshot,
      addon_requested_qty, addon_confirmed_qty, addon_picked_qty
    ) VALUES (
      v_order.id, v_product_id, v_product.product_name, v_product.unit,
      v_qty, null, null, v_price,
      0,
      null, null
    )
    ON CONFLICT (order_id, product_id) DO UPDATE SET
      unit_price_snapshot = (
        (oi.requested_qty * oi.unit_price_snapshot) +
        (excluded.requested_qty * excluded.unit_price_snapshot)
      ) / (oi.requested_qty + excluded.requested_qty),
      requested_qty = oi.requested_qty + excluded.requested_qty,
      addon_requested_qty = oi.addon_requested_qty + excluded.addon_requested_qty,
      addon_confirmed_qty = NULL,
      addon_picked_qty = NULL,
      -- Force normal full-order Confirmation and Picking on every merged SKU.
      confirmed_qty = NULL, actual_qty = NULL,
      updated_at = now();

    v_item_count := v_item_count + 1;
  END LOOP;

  -- Reset the entire merged order, including original SKUs which were not
  -- present in this additional basket. Zero pending add-on fields ensures
  -- existing ordinary Confirmation/Picking functions are used unchanged.
  UPDATE public.order_items
  SET confirmed_qty = NULL,
      actual_qty = NULL,
      addon_requested_qty = 0,
      addon_confirmed_qty = NULL,
      addon_picked_qty = NULL,
      updated_at = now()
  WHERE order_id = v_order.id;

  -- Retire ALL previous cart pictures from the active order. The verified
  -- server-side checkout handler deletes physical Storage objects and their
  -- file records using the returned IDs/paths after the DB commit.
  UPDATE public.order_files
  SET is_current = false
  WHERE order_id = v_order.id
    AND file_type IN ('cart_photo', 'cart_photo_2');

  UPDATE public.orders
  SET status = 'awaiting_confirmation',
      adjustment_count = adjustment_count + 1,
      updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.order_history (
    order_id, action, stage, from_status, to_status,
    performed_by_line_user_id, note, details
  ) VALUES (
    v_order.id, 'order_adjusted', 'confirmation', v_order.status,
    'awaiting_confirmation', p_line_user_id,
    'Customer adjusted order by adding ' || v_item_count ||
    ' items; ALL merged products must be reconfirmed and repicked with new cart pictures',
    jsonb_build_object(
      'merge_request_id', p_request_id,
      'added_items', p_items,
      'original_stage', v_order.status,
      'released_active_tasks', v_released_tasks,
      'adjustment_mode', 'full_reset',
      'adjustment_count', v_order.adjustment_count + 1,
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
    'new_status', 'awaiting_confirmation',
    'added_item_count', v_item_count,
    'released_active_tasks', v_released_tasks,
    'adjustment_count', v_order.adjustment_count + 1,
    'retired_cart_photos', v_previous_photos,
    'estimated_amount', (
      SELECT coalesce(sum(oi.requested_qty * oi.unit_price_snapshot), 0)
      FROM public.order_items oi WHERE oi.order_id = v_order.id
    )
  );
END;
$function$;

-- Keep this privileged workflow callable ONLY by the verified LINE API server.
REVOKE ALL ON FUNCTION public.merge_customer_order(uuid,bigint,date,text,text,jsonb,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_customer_order(uuid,bigint,date,text,text,jsonb,uuid,uuid)
  TO service_role;
