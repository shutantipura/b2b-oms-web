-- Eligible for customer merge until Billing is FIRST claimed.
-- Order stage and active task claims are revalidated and locked in the DB;
-- prior committed confirmed/picked totals and cart photo objects are retained.
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
  v_standard_confirmation boolean := false;
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
      'already_processed', true
    )
  INTO v_merge_result
  FROM public.order_history h
  WHERE h.order_id = v_order.id
    AND h.action = 'items_merged'
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

  -- If the original Confirmation is not yet finished, simply extend the
  -- original requested quantities. The normal Confirmation task then covers
  -- all items (not just the new ones). On a previously confirmed order, track
  -- only incremental units using addon_requested_qty.
  v_standard_confirmation := v_order.status='awaiting_confirmation'
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id=v_order.id AND oi.addon_requested_qty>0
    );

  -- If a previously added batch has already been confirmed but is still
  -- waiting for picking, roll back JUST that batch's confirmation and return
  -- it to the new Confirmation task. Never touch the previously completed
  -- quantities/picks.
  UPDATE public.order_items oi
  SET confirmed_qty=coalesce(oi.confirmed_qty,0)-coalesce(oi.addon_confirmed_qty,0),
      addon_confirmed_qty=NULL, addon_picked_qty=NULL, updated_at=now()
  WHERE oi.order_id=v_order.id
    AND oi.addon_requested_qty>0 AND oi.addon_confirmed_qty IS NOT NULL;

  -- A staff member may be working in Confirmation or Picking right now.
  -- Release the active task claim in the SAME transaction as the merge.
  -- Their stale form can no longer submit, and the updated task re-enters
  -- the shared Confirmation pool. Previously committed picks are preserved.
  UPDATE public.task_claims
  SET claim_status='released',released_at=now(),
      release_reason='customer_merged_additional_items'
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
      requested_qty, confirmed_qty, actual_qty, unit_price_snapshot,
      addon_requested_qty, addon_confirmed_qty, addon_picked_qty
    ) VALUES (
      v_order.id, v_product_id, v_product.product_name, v_product.unit,
      v_qty, null, null, v_price,
      CASE WHEN v_standard_confirmation THEN 0 ELSE v_qty END,
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
      -- NEVER change original confirmed_qty or actual_qty when an add-on arrives.
      updated_at = now();

    v_item_count := v_item_count + 1;
  END LOOP;

  -- Existing confirmed/picked totals are preserved. Only new quantities
  -- marked by addon_requested_qty enter Confirmation and Picking.

  -- Keep the stored photos as historical records, but require new current photo(s).
  UPDATE public.order_files SET is_current = false
  WHERE order_id = v_order.id
    AND file_type IN ('cart_photo', 'cart_photo_2')
    AND is_current = true;

  UPDATE public.orders
  SET status = 'awaiting_confirmation', updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.order_history (
    order_id, action, stage, from_status, to_status,
    performed_by_line_user_id, note, details
  ) VALUES (
    v_order.id, 'items_merged', 'confirmation', v_order.status,
    'awaiting_confirmation', p_line_user_id,
    'Customer added ' || v_item_count || ' items; only the extra units require confirmation and picking',
    jsonb_build_object(
      'merge_request_id', p_request_id,
      'added_items', p_items,
      'original_stage', v_order.status,
      'released_active_tasks', v_released_tasks,
      'standard_confirmation', v_standard_confirmation,
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
    'estimated_amount', (
      SELECT coalesce(sum(oi.requested_qty * oi.unit_price_snapshot), 0)
      FROM public.order_items oi WHERE oi.order_id = v_order.id
    )
  );
END;
$function$;

-- Add-on picking must also finish previously unpicked items, e.g. if the
-- original order was actively being picked when the customer added goods.
CREATE OR REPLACE FUNCTION public.complete_addon_picking(p_order_number bigint, p_staff_code text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_staff public.staff%rowtype;
  v_claim_id uuid;
  v_line jsonb;
  v_sku text;
  v_qty numeric;
  v_line_id uuid;
  v_needed int;
  v_affected int;
  v_original_actual numeric;
  v_addon_requested numeric;
BEGIN
  SELECT * INTO v_order FROM public.orders
  WHERE order_number=p_order_number FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'picking' THEN
    RAISE EXCEPTION 'Order is not in add-on picking';
  END IF;

  SELECT * INTO v_staff FROM public.staff
  WHERE staff_code=p_staff_code AND auth_user_id=auth.uid()
    AND is_active=true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'An active, matching staff login is required'; END IF;

  SELECT id INTO v_claim_id FROM public.task_claims
  WHERE order_id=v_order.id AND stage='picking'
    AND staff_id=v_staff.id AND claim_status='active' LIMIT 1;
  IF v_claim_id IS NULL THEN RAISE EXCEPTION 'You must own the picking task'; END IF;

  SELECT count(*) INTO v_needed FROM public.order_items
  WHERE order_id=v_order.id
    AND (addon_requested_qty > 0 OR actual_qty IS NULL);
  IF v_needed=0 THEN RAISE EXCEPTION 'No outstanding items require picking'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id=v_order.id
      AND addon_requested_qty > 0 AND addon_confirmed_qty IS NULL
  ) THEN RAISE EXCEPTION 'Additional quantities must be confirmed first'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array'
    OR jsonb_array_length(p_items)<>v_needed THEN
    RAISE EXCEPTION 'Pick exactly % added products',v_needed;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_sku := v_line->>'sku';
    v_qty := (v_line->>'actual_qty')::numeric;
    IF v_sku IS NULL OR v_qty IS NULL OR v_qty < 0 OR v_qty = 'NaN'::numeric THEN
      RAISE EXCEPTION 'Invalid additional picked quantity for SKU %',v_sku;
    END IF;
    SELECT oi.id, oi.actual_qty, oi.addon_requested_qty
      INTO v_line_id, v_original_actual, v_addon_requested
    FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
    WHERE oi.order_id=v_order.id AND p.sku=v_sku
      AND (
        (oi.addon_requested_qty > 0 AND oi.addon_picked_qty IS NULL)
        OR (oi.addon_requested_qty = 0 AND oi.actual_qty IS NULL)
      )
    LIMIT 1;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'SKU % is not pending picking or appears twice',v_sku;
    END IF;
    IF v_addon_requested>0 THEN
      -- If original actual_qty exists, the submitted number is ONLY the
      -- additional picked quantity. Otherwise the picker enters the whole
      -- unpicked confirmed quantity (original + customer add-on).
      UPDATE public.order_items SET addon_picked_qty=v_qty,updated_at=now()
      WHERE id=v_line_id;
    ELSE
      -- No add-on for this SKU, but it was awaiting picking before merge.
      UPDATE public.order_items SET actual_qty=v_qty,updated_at=now()
      WHERE id=v_line_id;
    END IF;
    v_line_id := NULL;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id=v_order.id
      AND ((addon_requested_qty > 0 AND addon_picked_qty IS NULL)
           OR (addon_requested_qty=0 AND actual_qty IS NULL))
  ) THEN RAISE EXCEPTION 'All outstanding SKUs must have a picked quantity'; END IF;

  -- Previously picked units remain in actual_qty. Only add the extra units.
  -- The merge archived all old photos; this current image must be freshly taken.
  IF NOT EXISTS (
    SELECT 1 FROM public.order_files f WHERE f.order_id=v_order.id
      AND f.file_type='cart_photo' AND f.is_current=true
      AND f.uploaded_by_staff_id=v_staff.id
  ) THEN RAISE EXCEPTION 'A NEW cart photo is required for the additional picking'; END IF;

  UPDATE public.order_items
  SET actual_qty=CASE
        WHEN actual_qty IS NULL THEN addon_picked_qty
        ELSE actual_qty+addon_picked_qty END,
      addon_requested_qty=0,addon_confirmed_qty=NULL,addon_picked_qty=NULL,
      updated_at=now()
  WHERE order_id=v_order.id AND addon_requested_qty > 0;
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id=v_order.id AND actual_qty IS NULL
  ) THEN RAISE EXCEPTION 'One or more original items have not yet been picked'; END IF;

  UPDATE public.task_claims SET claim_status='completed',completed_at=now()
  WHERE id=v_claim_id;
  UPDATE public.orders SET status='awaiting_billing',updated_at=now()
  WHERE id=v_order.id;

  INSERT INTO public.order_history(
    order_id,action,stage,from_status,to_status,performed_by_staff_id,note,details
  ) VALUES (
    v_order.id,'addons_picked','picking','picking','awaiting_billing',v_staff.id,
    'Picked only newly added quantities; original cart photos retained',
    jsonb_build_object('additional_picks',p_items,'line_count',v_affected)
  );

  RETURN jsonb_build_object('success',true,'order_number',p_order_number,
    'new_status','awaiting_billing','additional_items_picked',v_affected,
    'combined_picked_amount',(
      SELECT coalesce(sum(coalesce(oi.actual_qty,0)*oi.unit_price_snapshot),0)
      FROM public.order_items oi WHERE oi.order_id=v_order.id
    )
  );
END;
$function$;
