-- Incremental customer add-ons (2026-10-24)
-- Existing confirmation, picked quantity, and cart photos remain untouched on merge.
-- Same-SKU customer add-ons are tracked as increments rather than a second product row.
ALTER TABLE public.order_items
 ADD COLUMN IF NOT EXISTS addon_requested_qty numeric NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS addon_confirmed_qty numeric,
 ADD COLUMN IF NOT EXISTS addon_picked_qty numeric;
ALTER TABLE public.order_items
 ADD CONSTRAINT addon_requested_qty_nonnegative CHECK (addon_requested_qty>=0),
 ADD CONSTRAINT addon_confirmed_qty_nonnegative CHECK (addon_confirmed_qty IS NULL OR addon_confirmed_qty>=0),
 ADD CONSTRAINT addon_picked_qty_nonnegative CHECK (addon_picked_qty IS NULL OR addon_picked_qty>=0);


CREATE OR REPLACE FUNCTION public.complete_addon_confirmation(
  p_order_number bigint, p_staff_code text, p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $addon_confirmation$
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
BEGIN
  SELECT * INTO v_order FROM public.orders
  WHERE order_number = p_order_number FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'awaiting_confirmation' THEN
    RAISE EXCEPTION 'Order is not awaiting add-on confirmation';
  END IF;

  SELECT * INTO v_staff FROM public.staff
  WHERE staff_code = p_staff_code AND auth_user_id = auth.uid()
    AND is_active = true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'An active, matching staff login is required'; END IF;

  SELECT id INTO v_claim_id FROM public.task_claims
  WHERE order_id = v_order.id AND stage = 'confirmation'
    AND staff_id = v_staff.id AND claim_status = 'active'
  LIMIT 1;
  IF v_claim_id IS NULL THEN RAISE EXCEPTION 'You must own the confirmation task'; END IF;

  SELECT count(*) INTO v_needed FROM public.order_items
  WHERE order_id = v_order.id AND addon_requested_qty > 0;
  IF v_needed = 0 THEN RAISE EXCEPTION 'No new items require confirmation'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) <> v_needed THEN
    RAISE EXCEPTION 'Confirm exactly % added products', v_needed;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_sku := v_line->>'sku';
    v_qty := (v_line->>'confirmed_qty')::numeric;
    IF v_sku IS NULL OR v_qty IS NULL OR v_qty < 0 OR v_qty = 'NaN'::numeric THEN
      RAISE EXCEPTION 'Invalid additional confirmed quantity for SKU %', v_sku;
    END IF;

    SELECT oi.id INTO v_line_id
    FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
    WHERE oi.order_id=v_order.id AND p.sku=v_sku
      AND oi.addon_requested_qty > 0 AND oi.addon_confirmed_qty IS NULL
    LIMIT 1;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'SKU % is not a pending add-on or appears twice', v_sku;
    END IF;
    UPDATE public.order_items SET addon_confirmed_qty = v_qty, updated_at = now()
    WHERE id = v_line_id;
    v_line_id := NULL;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id=v_order.id
      AND addon_requested_qty > 0 AND addon_confirmed_qty IS NULL
  ) THEN RAISE EXCEPTION 'Every new product must have an additional confirmation'; END IF;

  -- Only now increase totals. Previously confirmed quantities are untouched.
  UPDATE public.order_items
  SET confirmed_qty=coalesce(confirmed_qty,0)+addon_confirmed_qty,
      updated_at=now()
  WHERE order_id=v_order.id AND addon_requested_qty > 0;
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  UPDATE public.task_claims SET claim_status='completed', completed_at=now()
  WHERE id=v_claim_id;
  UPDATE public.orders SET status='awaiting_picking',updated_at=now()
  WHERE id=v_order.id;

  INSERT INTO public.order_history (
    order_id,action,stage,from_status,to_status,performed_by_staff_id,note,details
  ) VALUES (
    v_order.id,'addons_confirmed','confirmation','awaiting_confirmation',
    'awaiting_picking',v_staff.id,
    'Confirmed only newly added product quantities; previous totals preserved',
    jsonb_build_object('additional_confirmations',p_items,'line_count',v_affected)
  );

  RETURN jsonb_build_object('success',true,'order_number',p_order_number,
    'new_status','awaiting_picking','additional_items_confirmed',v_affected);
END;
$addon_confirmation$;


CREATE OR REPLACE FUNCTION public.complete_addon_picking(
  p_order_number bigint, p_staff_code text, p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $addon_picking$
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
  WHERE order_id=v_order.id AND addon_requested_qty > 0;
  IF v_needed=0 THEN RAISE EXCEPTION 'No new items require picking'; END IF;
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
    SELECT oi.id INTO v_line_id
    FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
    WHERE oi.order_id=v_order.id AND p.sku=v_sku
      AND oi.addon_requested_qty > 0 AND oi.addon_picked_qty IS NULL
    LIMIT 1;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'SKU % is not a pending add-on or appears twice',v_sku;
    END IF;
    UPDATE public.order_items SET addon_picked_qty=v_qty,updated_at=now()
    WHERE id=v_line_id;
    v_line_id := NULL;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id=v_order.id
      AND addon_requested_qty > 0 AND addon_picked_qty IS NULL
  ) THEN RAISE EXCEPTION 'Every additional SKU must have a picked quantity'; END IF;

  -- Previously picked units remain in actual_qty. Only add the extra units.
  -- The merge archived all old photos; this current image must be freshly taken.
  IF NOT EXISTS (
    SELECT 1 FROM public.order_files f WHERE f.order_id=v_order.id
      AND f.file_type='cart_photo' AND f.is_current=true
      AND f.uploaded_by_staff_id=v_staff.id
  ) THEN RAISE EXCEPTION 'A NEW cart photo is required for the additional picking'; END IF;

  UPDATE public.order_items
  SET actual_qty=coalesce(actual_qty,0)+addon_picked_qty,
      addon_requested_qty=0,addon_confirmed_qty=NULL,addon_picked_qty=NULL,
      updated_at=now()
  WHERE order_id=v_order.id AND addon_requested_qty > 0;
  GET DIAGNOSTICS v_affected = ROW_COUNT;

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
$addon_picking$;

-- The existing staff-facing RPCs dispatch to the incremental branch only
-- when a customer's add-on quantity is still pending. Other orders are unchanged.
CREATE OR REPLACE FUNCTION public.complete_confirmation(p_order_number bigint, p_staff_code text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders%rowtype;
  v_staff public.staff%rowtype;
  v_claim public.task_claims%rowtype;

  v_item jsonb;
  v_sku text;
  v_confirmed_qty numeric;

  v_order_item_id uuid;
  v_requested_qty numeric;

begin

  ------------------------------------------------------------
  -- 1. Find and lock the order
  ------------------------------------------------------------
  select *
  into v_order
  from public.orders
  where order_number = p_order_number
  for update;

  if not found then
    raise exception 'Order % does not exist', p_order_number;
  end if;


  ------------------------------------------------------------
  -- 2. Make sure order is actually awaiting confirmation
  ------------------------------------------------------------
  if v_order.status <> 'awaiting_confirmation' then
    raise exception
      'Order % is currently %, not awaiting_confirmation',
      p_order_number,
      v_order.status;
  end if;


  ------------------------------------------------------------
  -- 3. Find the staff member
  ------------------------------------------------------------
  select *
  into v_staff
  from public.staff
  where staff_code = p_staff_code
    and is_active = true;

  if not found then
    raise exception
      'Active staff member % does not exist',
      p_staff_code;
  end if;


  ------------------------------------------------------------
  -- 4. Make sure this staff member owns the active task
  ------------------------------------------------------------
  select *
  into v_claim
  from public.task_claims
  where order_id = v_order.id
    and stage = 'confirmation'
    and staff_id = v_staff.id
    and claim_status = 'active'
  limit 1;

  if not found then
    raise exception
      '% does not own the active Confirmation task for Order %',
      v_staff.staff_name,
      p_order_number;
  end if;


  ------------------------------------------------------------
  -- 5. Make sure p_items is an array
  ------------------------------------------------------------
  if jsonb_typeof(p_items) <> 'array' then
    raise exception
      'p_items must be a JSON array';
  end if;


  ------------------------------------------------------------
  -- 6. Process each confirmed quantity
  ------------------------------------------------------------
  -- Add-on orders require confirmation of additional units only.
  if exists (
    select 1 from public.order_items
    where order_id = v_order.id and addon_requested_qty > 0
  ) then
    return public.complete_addon_confirmation(p_order_number, p_staff_code, p_items);
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    v_sku := v_item ->> 'sku';

    v_confirmed_qty :=
      (v_item ->> 'confirmed_qty')::numeric;


    if v_sku is null then
      raise exception 'Every item must contain an SKU';
    end if;


    if v_confirmed_qty is null then
      raise exception
        'Confirmed quantity missing for SKU %',
        v_sku;
    end if;


    if v_confirmed_qty < 0 then
      raise exception
        'Confirmed quantity cannot be negative for SKU %',
        v_sku;
    end if;


    ----------------------------------------------------------
    -- Find the matching order item
    ----------------------------------------------------------
    select
      oi.id,
      oi.requested_qty
    into
      v_order_item_id,
      v_requested_qty
    from public.order_items oi
    join public.products p
      on oi.product_id = p.id
    where oi.order_id = v_order.id
      and p.sku = v_sku;


    if not found then
      raise exception
        'SKU % is not part of Order %',
        v_sku,
        p_order_number;
    end if;


    ----------------------------------------------------------
    -- Staff may reduce but may NOT increase customer request
    ----------------------------------------------------------
    if v_confirmed_qty > v_requested_qty then
      raise exception
        'SKU % requested quantity is %, so confirmed quantity cannot be %',
        v_sku,
        v_requested_qty,
        v_confirmed_qty;
    end if;


    ----------------------------------------------------------
    -- Save confirmed quantity
    ----------------------------------------------------------
    update public.order_items
    set
      confirmed_qty = v_confirmed_qty,
      updated_at = now()
    where id = v_order_item_id;

  end loop;


  ------------------------------------------------------------
  -- 7. Make sure every item now has a confirmed quantity
  ------------------------------------------------------------
  if exists (
    select 1
    from public.order_items
    where order_id = v_order.id
      and confirmed_qty is null
  ) then
    raise exception
      'Every item must have a confirmed quantity before Confirmation can be completed';
  end if;


  ------------------------------------------------------------
  -- 8. Complete Confirmation task
  ------------------------------------------------------------
  update public.task_claims
  set
    claim_status = 'completed',
    completed_at = now()
  where id = v_claim.id;


  ------------------------------------------------------------
  -- 9. Move order to Picking queue
  ------------------------------------------------------------
  update public.orders
  set
    status = 'awaiting_picking',
    updated_at = now()
  where id = v_order.id;


  ------------------------------------------------------------
  -- 10. Write audit history
  ------------------------------------------------------------
  insert into public.order_history (
    order_id,
    action,
    stage,
    from_status,
    to_status,
    performed_by_staff_id,
    note,
    details
  )
  values (
    v_order.id,
    'order_confirmed',
    'confirmation',
    'awaiting_confirmation',
    'awaiting_picking',
    v_staff.id,
    'Confirmed quantities saved and order sent to Picking',
    p_items
  );


  ------------------------------------------------------------
  -- 11. Return useful information to the website
  ------------------------------------------------------------
  return jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'confirmed_by', v_staff.staff_name,
    'new_status', 'awaiting_picking'
  );

end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_picking(p_order_number bigint, p_staff_code text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders%rowtype;
  v_staff public.staff%rowtype;
  v_claim public.task_claims%rowtype;

  v_item jsonb;
  v_sku text;
  v_actual_qty numeric;

  v_order_item_id uuid;

begin

  ------------------------------------------------------------
  -- 1. Find and lock the order
  ------------------------------------------------------------
  select *
  into v_order
  from public.orders
  where order_number = p_order_number
  for update;

  if not found then
    raise exception
      'Order % does not exist',
      p_order_number;
  end if;


  ------------------------------------------------------------
  -- 2. Order must currently be in Picking
  ------------------------------------------------------------
  if v_order.status <> 'picking' then
    raise exception
      'Order % is currently %, not picking',
      p_order_number,
      v_order.status;
  end if;


  ------------------------------------------------------------
  -- 3. Find active staff member
  ------------------------------------------------------------
  select *
  into v_staff
  from public.staff
  where staff_code = p_staff_code
    and is_active = true;

  if not found then
    raise exception
      'Active staff member % does not exist',
      p_staff_code;
  end if;


  ------------------------------------------------------------
  -- 4. Staff must own the active Picking task
  ------------------------------------------------------------
  select *
  into v_claim
  from public.task_claims
  where order_id = v_order.id
    and stage = 'picking'
    and staff_id = v_staff.id
    and claim_status = 'active'
  limit 1;

  if not found then
    raise exception
      '% does not own the active Picking task for Order %',
      v_staff.staff_name,
      p_order_number;
  end if;


  ------------------------------------------------------------
  -- 5. Make sure the submitted item data is an array
  ------------------------------------------------------------
  if jsonb_typeof(p_items) <> 'array' then
    raise exception
      'p_items must be a JSON array';
  end if;


  ------------------------------------------------------------
  -- 6. Process each actual picked quantity
  ------------------------------------------------------------
  -- Add-on orders require picking of additional units only.
  if exists (
    select 1 from public.order_items
    where order_id = v_order.id and addon_requested_qty > 0
  ) then
    return public.complete_addon_picking(p_order_number, p_staff_code, p_items);
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    v_sku := v_item ->> 'sku';

    v_actual_qty :=
      (v_item ->> 'actual_qty')::numeric;


    if v_sku is null then
      raise exception
        'Every item must contain an SKU';
    end if;


    if v_actual_qty is null then
      raise exception
        'Actual quantity missing for SKU %',
        v_sku;
    end if;


    if v_actual_qty < 0 then
      raise exception
        'Actual quantity cannot be negative for SKU %',
        v_sku;
    end if;


    ----------------------------------------------------------
    -- Find matching item on this order
    ----------------------------------------------------------
    select oi.id
    into v_order_item_id
    from public.order_items oi
    join public.products p
      on oi.product_id = p.id
    where oi.order_id = v_order.id
      and p.sku = v_sku;


    if not found then
      raise exception
        'SKU % is not part of Order %',
        v_sku,
        p_order_number;
    end if;


    ----------------------------------------------------------
    -- Save actual picked quantity.
    -- Picker may enter any non-negative quantity.
    ----------------------------------------------------------
    update public.order_items
    set
      actual_qty = v_actual_qty,
      updated_at = now()
    where id = v_order_item_id;

  end loop;


  ------------------------------------------------------------
  -- 7. Every item must have an actual quantity
  ------------------------------------------------------------
  if exists (
    select 1
    from public.order_items
    where order_id = v_order.id
      and actual_qty is null
  ) then
    raise exception
      'Every item must have an actual picked quantity before Picking can be completed';
  end if;


  ------------------------------------------------------------
  -- 8. Picker must have uploaded the current Cart Photo
  ------------------------------------------------------------
  if not exists (
    select 1
    from public.order_files
    where order_id = v_order.id
      and file_type = 'cart_photo'
      and is_current = true
      and uploaded_by_staff_id = v_staff.id
  ) then
    raise exception
      'A cart photo uploaded by the Picker is required before Picking can be completed';
  end if;


  ------------------------------------------------------------
  -- 9. Complete the Picking task
  ------------------------------------------------------------
  update public.task_claims
  set
    claim_status = 'completed',
    completed_at = now()
  where id = v_claim.id;


  ------------------------------------------------------------
  -- 10. Move order into Billing queue
  ------------------------------------------------------------
  update public.orders
  set
    status = 'awaiting_billing',
    updated_at = now()
  where id = v_order.id;


  ------------------------------------------------------------
  -- 11. Write audit history
  ------------------------------------------------------------
  insert into public.order_history (
    order_id,
    action,
    stage,
    from_status,
    to_status,
    performed_by_staff_id,
    note,
    details
  )
  values (
    v_order.id,
    'picking_completed',
    'picking',
    'picking',
    'awaiting_billing',
    v_staff.id,
    'Actual picked quantities saved and cart photo verified',
    p_items
  );


  ------------------------------------------------------------
  -- 12. Return useful information to the website
  ------------------------------------------------------------
  return jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'picked_by', v_staff.staff_name,
    'new_status', 'awaiting_billing'
  );

end;
$function$;

-- Staff-added SKUs during an add-on pass become incremental lines as well.
CREATE OR REPLACE FUNCTION public.add_product_to_my_order(p_order_number bigint, p_product_id uuid, p_qty numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_staff public.staff%rowtype;
  v_product public.products%rowtype;

  v_stage text;
  v_price numeric;
  v_order_item_id uuid;
  v_is_addon boolean := false;
begin

  ------------------------------------------------------------
  -- Validate quantity
  ------------------------------------------------------------

  if p_qty is null
     or p_qty <= 0 then
    raise exception
      'Quantity must be greater than zero';
  end if;


  ------------------------------------------------------------
  -- Current staff
  ------------------------------------------------------------

  select *
  into v_staff
  from public.staff
  where staff_code = public.current_staff_code()
    and is_active = true
  limit 1;

  if not found then
    raise exception
      'No active staff account is linked to the logged-in user';
  end if;


  ------------------------------------------------------------
  -- Find + lock order
  ------------------------------------------------------------

  select *
  into v_order
  from public.orders
  where order_number = p_order_number
  for update;

  if not found then
    raise exception
      'Order % does not exist',
      p_order_number;
  end if;


  ------------------------------------------------------------
  -- Determine operational stage
  ------------------------------------------------------------

  if v_order.status = 'awaiting_confirmation' then
    v_stage := 'confirmation';

  elsif v_order.status = 'picking' then
    v_stage := 'picking';

  else
    raise exception
      'Products may only be added during Confirmation or Picking. Current status: %',
      v_order.status;
  end if;


  ------------------------------------------------------------
  -- Staff must own that active task
  ------------------------------------------------------------

  if not exists (
    select 1
    from public.task_claims tc
    where tc.order_id = v_order.id
      and tc.stage = v_stage
      and tc.staff_id = v_staff.id
      and tc.claim_status = 'active'
  ) then
    raise exception
      'You do not own the active % task for Order %',
      v_stage,
      p_order_number;
  end if;


  ------------------------------------------------------------
  -- Product must be active
  ------------------------------------------------------------

  select *
  into v_product
  from public.products
  where id = p_product_id
    and is_active = true;

  if not found then
    raise exception
      'Selected product does not exist or is inactive';
  end if;


  ------------------------------------------------------------
  -- Product cannot already be on order
  ------------------------------------------------------------

  if exists (
    select 1
    from public.order_items oi
    where oi.order_id = v_order.id
      and oi.product_id = v_product.id
  ) then
    raise exception
      'SKU % is already part of Order %',
      v_product.sku,
      p_order_number;
  end if;


  ------------------------------------------------------------
  -- Determine effective customer price
  ------------------------------------------------------------

  select cp.agreed_price
  into v_price
  from public.customer_prices cp
  where cp.customer_id = v_order.customer_id
    and cp.product_id = v_product.id
    and cp.is_active = true
  limit 1;

  if v_price is null then
    v_price :=
      v_product.normal_price;
  end if;

  if v_price is null then
    raise exception
      'No price is available for SKU %',
      v_product.sku;
  end if;


  ------------------------------------------------------------
  -- Add product
  --
  -- requested_qty must be > 0 in the existing schema.
  --
  -- For a staff-added product we therefore snapshot the
  -- quantity entered by staff into requested_qty and
  -- confirmed_qty.
  --
  -- actual_qty remains NULL so Picking can enter/edit the
  -- real picked quantity normally.
  ------------------------------------------------------------

  -- A staff-added SKU during an add-on pass belongs to that pass.
  -- When added during picking, staff confirmation is implicit as before.
  select exists (
    select 1 from public.order_items
    where order_id = v_order.id and addon_requested_qty > 0
  ) into v_is_addon;

  insert into public.order_items (
    order_id, product_id, product_name_snapshot, unit_snapshot,
    unit_price_snapshot, requested_qty, confirmed_qty, actual_qty,
    addon_requested_qty, addon_confirmed_qty, addon_picked_qty, staff_note
  )
  values (
    v_order.id, v_product.id, v_product.product_name, v_product.unit,
    v_price, p_qty,
    case when v_is_addon and v_stage = 'confirmation' then null else p_qty end,
    null,
    case when v_is_addon then p_qty else 0 end,
    case when v_is_addon and v_stage = 'picking' then p_qty else null end,
    null,
    'Added by staff during ' || v_stage
  )
  returning id
  into v_order_item_id;


  ------------------------------------------------------------
  -- Audit history
  ------------------------------------------------------------

  insert into public.order_history (
    order_id,
    action,
    stage,
    from_status,
    to_status,
    performed_by_staff_id,
    note,
    details
  )
  values (
    v_order.id,
    'product_added',
    v_stage,
    v_order.status,
    v_order.status,
    v_staff.id,
    'Product added to order by staff during ' || v_stage,
    jsonb_build_object(
      'order_item_id',
      v_order_item_id,
      'product_id',
      v_product.id,
      'sku',
      v_product.sku,
      'product_name',
      v_product.product_name,
      'quantity',
      p_qty,
      'unit',
      v_product.unit,
      'unit_price',
      v_price
    )
  );


  ------------------------------------------------------------
  -- Return added product
  ------------------------------------------------------------

  return jsonb_build_object(
    'success', true,
    'orderItemId', v_order_item_id,
    'stage', v_stage,
    'sku', v_product.sku,
    'productName', v_product.product_name,
    'quantity', p_qty,
    'unit', v_product.unit,
    'unitPrice', v_price
  );

end;
$function$;

-- This RPC remains restricted to service_role via its existing grants.
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
      requested_qty, confirmed_qty, actual_qty, unit_price_snapshot,
      addon_requested_qty, addon_confirmed_qty, addon_picked_qty
    ) VALUES (
      v_order.id, v_product_id, v_product.product_name, v_product.unit,
      v_qty, null, null, v_price, v_qty, null, null
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
    v_order.id, 'items_merged', 'confirmation', 'awaiting_billing',
    'awaiting_confirmation', p_line_user_id,
    'Customer added ' || v_item_count || ' items; only the extra units require confirmation and picking',
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
    'new_status', 'awaiting_confirmation',
    'added_item_count', v_item_count,
    'estimated_amount', (
      SELECT coalesce(sum(oi.requested_qty * oi.unit_price_snapshot), 0)
      FROM public.order_items oi WHERE oi.order_id = v_order.id
    )
  );
END;
$function$;

-- Revoke direct addon worker access: the owning staff must use the
-- existing complete_my_confirmation / complete_my_picking authenticated RPCs.
REVOKE ALL ON FUNCTION public.complete_addon_confirmation(bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_addon_picking(bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
