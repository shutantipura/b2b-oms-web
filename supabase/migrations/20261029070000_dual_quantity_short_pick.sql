-- Lotus's B2B OMS: capture picked pieces separately from measured KG.
-- Safe to reapply; production first applied 2026-10-29.
-- Historical mixed-unit rows intentionally remain NULL / KPI N/A.
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS actual_piece_qty numeric;
DO $guardrail$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='order_items_actual_piece_qty_valid' AND conrelid='public.order_items'::regclass) THEN
    ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_actual_piece_qty_valid CHECK (
      actual_piece_qty IS NULL OR (
        actual_piece_qty >= 0
        AND actual_piece_qty = trunc(actual_piece_qty)
        AND actual_piece_qty <> 'NaN'::numeric
      )
    );
  END IF;
END;
$guardrail$;
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
  v_actual_piece_qty numeric;
  v_is_mixed boolean;

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
    v_actual_piece_qty := (v_item ->> 'actual_piece_qty')::numeric;


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
    select oi.id, oi.piece_price_per_kg_snapshot IS NOT NULL
    into v_order_item_id, v_is_mixed
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


    if v_is_mixed and v_actual_piece_qty is not null and (
      v_actual_piece_qty < 0 or v_actual_piece_qty <> trunc(v_actual_piece_qty)
    ) then
      raise exception 'Picked piece count must be a non-negative integer for SKU %', v_sku;
    end if;

    ----------------------------------------------------------
    -- Save actual picked quantity.
    -- Picker may enter any non-negative quantity.
    ----------------------------------------------------------
    update public.order_items
    set
      actual_qty = v_actual_qty,
      actual_piece_qty = case when v_is_mixed then v_actual_piece_qty else null end,
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
$function$
;
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
  v_original_piece_qty numeric;
  v_piece_qty numeric;
  v_is_mixed boolean;
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
    v_piece_qty := (v_line->>'actual_piece_qty')::numeric;
    IF v_sku IS NULL OR v_qty IS NULL OR v_qty < 0 OR v_qty = 'NaN'::numeric THEN
      RAISE EXCEPTION 'Invalid additional picked quantity for SKU %',v_sku;
    END IF;
    SELECT oi.id, oi.actual_qty, oi.addon_requested_qty,
           oi.actual_piece_qty, oi.piece_price_per_kg_snapshot IS NOT NULL
      INTO v_line_id, v_original_actual, v_addon_requested,
           v_original_piece_qty, v_is_mixed
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
    IF v_is_mixed AND v_piece_qty IS NOT NULL AND (
      v_piece_qty < 0 OR v_piece_qty <> trunc(v_piece_qty)
    ) THEN
      RAISE EXCEPTION 'Picked piece count must be a non-negative integer for SKU %', v_sku;
    END IF;
    IF v_addon_requested>0 THEN
      -- If original actual_qty exists, the submitted number is ONLY the
      -- additional picked quantity. Otherwise the picker enters the whole
      -- unpicked confirmed quantity (original + customer add-on).
      UPDATE public.order_items
      SET addon_picked_qty=v_qty,
          actual_piece_qty=CASE
            WHEN NOT v_is_mixed THEN NULL
            WHEN v_original_actual IS NULL THEN v_piece_qty
            WHEN v_original_piece_qty IS NULL OR v_piece_qty IS NULL THEN NULL
            ELSE v_original_piece_qty + v_piece_qty
          END,
          updated_at=now()
      WHERE id=v_line_id;
    ELSE
      -- No add-on for this SKU, but it was awaiting picking before merge.
      UPDATE public.order_items
      SET actual_qty=v_qty,
          actual_piece_qty=CASE WHEN v_is_mixed THEN v_piece_qty ELSE NULL END,
          updated_at=now()
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
      SELECT coalesce(sum(coalesce(oi.actual_qty,0)*coalesce(oi.piece_price_per_kg_snapshot,oi.unit_price_snapshot)),0)
      FROM public.order_items oi WHERE oi.order_id=v_order.id
    )
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_operational_kpi_orders(p_delivery_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin

  if not public.is_current_manager() then
    raise exception 'Manager access required';
  end if;

  with history_base as (

    select
      h.order_id,
      h.from_status,
      h.to_status,

      coalesce(
        nullif(to_jsonb(h) ->> 'created_at', ''),
        nullif(to_jsonb(h) ->> 'changed_at', ''),
        nullif(to_jsonb(h) ->> 'recorded_at', ''),
        nullif(to_jsonb(h) ->> 'action_at', ''),
        nullif(to_jsonb(h) ->> 'timestamp', '')
      )::timestamptz as event_at

    from public.order_history h
  ),

  history_rollup as (

    select
      order_id,

      min(event_at) filter (
        where from_status = 'awaiting_confirmation'
          and to_status = 'awaiting_picking'
      ) as confirmation_at,

      min(event_at) filter (
        where to_status = 'awaiting_billing'
      ) as picking_completed_at,

      min(event_at) filter (
        where from_status = 'out_for_delivery'
          and to_status = 'awaiting_payment'
      ) as delivery_at,

      min(event_at) filter (
        where from_status = 'payment_submitted'
          and to_status = 'completed'
      ) as payment_completed_at

    from history_base
    group by order_id
  ),

  item_base as (

    select
      oi.order_id,

      nullif(
        coalesce(
          to_jsonb(oi) ->> 'confirmed_qty',
          to_jsonb(oi) ->> 'confirmed_quantity'
        ),
        ''
      )::numeric as confirmed_qty,

      nullif(
        coalesce(
          to_jsonb(oi) ->> 'actual_qty',
          to_jsonb(oi) ->> 'actual_picked_qty',
          to_jsonb(oi) ->> 'actual_quantity',
          to_jsonb(oi) ->> 'picked_qty'
        ),
        ''
      )::numeric as actual_qty,

      oi.actual_piece_qty,
      oi.piece_price_per_kg_snapshot IS NOT NULL AS confirmed_in_pieces_picked_in_kg,

      coalesce(
        nullif(to_jsonb(oi) ->> 'unit_snapshot', ''),
        nullif(to_jsonb(oi) ->> 'unit', ''),
        p.unit,
        ''
      ) as unit_name

    from public.order_items oi

    left join public.products p
      on p.id = oi.product_id
  ),

  item_rollup as (

    select
      order_id,

      case
        -- A definite short pick can be reported even if another line lacks data.
        when bool_or(
          case
            when confirmed_qty is null then null
            -- Mixed units: compare pieces to pieces; KG is for billing only.
            when confirmed_in_pieces_picked_in_kg then
              case when actual_piece_qty is null then null
                   else actual_piece_qty < confirmed_qty end
            when actual_qty is null then null
            -- Native KG lines retain the existing 0.5 KG tolerance.
            when lower(unit_name) like '%kg%' or unit_name like '%กก%' then
              actual_qty < confirmed_qty - 0.5
            else actual_qty < confirmed_qty
          end
        ) is true then true
        -- Missing measurements (including historical mixed-unit lines) are N/A.
        when bool_or(
          confirmed_qty is null
          or (confirmed_in_pieces_picked_in_kg and actual_piece_qty is null)
          or (not confirmed_in_pieces_picked_in_kg and actual_qty is null)
        ) then null
        else false
      end as short_pick

    from item_base
    group by order_id
  ),

  base as (

    select
      o.id,
      o.order_number,
      o.status,
      o.created_at,
      o.delivery_date,
      o.delivery_slot,

      c.customer_name,

      hr.confirmation_at,
      hr.picking_completed_at,
      hr.delivery_at,
      hr.payment_completed_at,

      ir.short_pick,

      -- End of customer's selected delivery slot
      case
        when o.delivery_slot is not null
         and substring(
           o.delivery_slot
           from '([0-2][0-9]:[0-5][0-9])[[:space:]]*$'
         ) is not null
        then
          (
            o.delivery_date
            +
            substring(
              o.delivery_slot
              from '([0-2][0-9]:[0-5][0-9])[[:space:]]*$'
            )::time
          )
          at time zone 'Asia/Bangkok'
        else null
      end as delivery_due_at,

      (
        o.delivery_date + time '21:00'
      ) at time zone 'Asia/Bangkok'
        as payment_due_at

    from public.orders o

    left join public.customers c
      on c.id = o.customer_id

    left join history_rollup hr
      on hr.order_id = o.id

    left join item_rollup ir
      on ir.order_id = o.id

    where o.delivery_date = p_delivery_date
      and o.status <> 'cancelled'
  ),

  scored as (

    select
      *,

      created_at + interval '30 minutes'
        as confirmation_due_at,

      case
        when confirmation_at is not null
        then
          confirmation_at
          <= created_at + interval '30 minutes'

        when now() > created_at + interval '30 minutes'
        then false

        else null
      end as confirmation_on_time,

      case
        when delivery_due_at is null
        then null

        when delivery_at is not null
        then delivery_at <= delivery_due_at

        when now() > delivery_due_at
        then false

        else null
      end as delivery_on_time,

      case
        when picking_completed_at is null
        then null

        else short_pick
      end as short_pick_result,

      case
        when payment_completed_at is not null
        then payment_completed_at <= payment_due_at

        when now() > payment_due_at
        then false

        else null
      end as payment_on_time

    from base
  )

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_id', id,
        'order_number', order_number,
        'customer_name', customer_name,
        'status', status,

        'created_at', created_at,

        'confirmation_at', confirmation_at,
        'confirmation_due_at', confirmation_due_at,
        'confirmation_on_time', confirmation_on_time,

        'delivery_slot', delivery_slot,
        'delivery_at', delivery_at,
        'delivery_due_at', delivery_due_at,
        'delivery_on_time', delivery_on_time,

        'picking_completed_at', picking_completed_at,
        'short_pick', short_pick_result,

        'payment_completed_at', payment_completed_at,
        'payment_due_at', payment_due_at,
        'payment_on_time', payment_on_time
      )
      order by order_number
    ),
    '[]'::jsonb
  )
  into v_result
  from scored;

  return v_result;

end;
$function$
;