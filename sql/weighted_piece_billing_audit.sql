-- Preserve different ordering units for the same SKU in /x billing.
-- All referenced grouped rows remain; this only expands the unique key.
ALTER TABLE public.group_billing_lines
 DROP CONSTRAINT group_billing_lines_root_order_id_product_id_key;
ALTER TABLE public.group_billing_lines
 ADD CONSTRAINT group_billing_lines_root_product_order_unit_unique
 UNIQUE(root_order_id,product_id,unit_snapshot);

-- Keep human-entered final_amount authoritative; correct reference/audit prices.
CREATE OR REPLACE FUNCTION public.complete_billing(p_order_number bigint, p_staff_code text, p_final_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders%rowtype;
  v_staff public.staff%rowtype;
  v_claim public.task_claims%rowtype;

  v_expected_amount numeric(12,2);
  v_difference numeric(12,2);

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
  -- 2. Order must currently be Awaiting Billing
  ------------------------------------------------------------
  if v_order.status <> 'awaiting_billing' then
    raise exception
      'Order % is currently %, not awaiting_billing',
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
  -- 4. Staff must own the active Billing task
  ------------------------------------------------------------
  select *
  into v_claim
  from public.task_claims
  where order_id = v_order.id
    and stage = 'billing'
    and staff_id = v_staff.id
    and claim_status = 'active'
  limit 1;

  if not found then
    raise exception
      '% does not own the active Billing task for Order %',
      v_staff.staff_name,
      p_order_number;
  end if;


  ------------------------------------------------------------
  -- 5. Final bill amount must be valid
  ------------------------------------------------------------
  if p_final_amount is null then
    raise exception
      'Final bill amount is required';
  end if;

  if p_final_amount < 0 then
    raise exception
      'Final bill amount cannot be negative';
  end if;


  ------------------------------------------------------------
  -- 6. Sanity check: Picking must contain actual quantities
  ------------------------------------------------------------
  if exists (
    select 1
    from public.order_items oi
    join public.orders m on m.id=oi.order_id
    where ((m.id=v_order.id and v_order.group_root_order_id is null)
        or (m.group_root_order_id=v_order.id and m.status<>'cancelled'))
      and oi.actual_qty is null
  ) then
    raise exception
      'All Actual Picked quantities must be available before Billing can be completed';
  end if;


  ------------------------------------------------------------
  -- 7. Bill must have been uploaded by Billing worker
  ------------------------------------------------------------
  if not exists (
    select 1
    from public.order_files
    where order_id = v_order.id
      and file_type = 'bill'
      and is_current = true
      -- Current bill/QR can come from an earlier authorized billing worker.
  ) then
    raise exception
      'A current Bill uploaded by the Billing worker is required';
  end if;


  ------------------------------------------------------------
  -- 8. Payment QR must have been uploaded by Billing worker
  ------------------------------------------------------------
  if not exists (
    select 1
    from public.order_files
    where order_id = v_order.id
      and file_type = 'payment_qr'
      and is_current = true
      -- Current bill/QR can come from an earlier authorized billing worker.
  ) then
    raise exception
      'A current Payment QR uploaded by the Billing worker is required';
  end if;


  ------------------------------------------------------------
  -- 9. Calculate expected amount for comparison only
  --
  -- IMPORTANT:
  -- This DOES NOT determine the official bill amount.
  -- The staff-entered bill amount remains authoritative.
  ------------------------------------------------------------
  if v_order.group_root_order_id=v_order.id then
    select round(coalesce(sum(line_total),0),2) into v_expected_amount
    from public.group_billing_lines where root_order_id=v_order.id;
  else
    select round(coalesce(sum(actual_qty*coalesce(piece_price_per_kg_snapshot,unit_price_snapshot)),0),2)
    into v_expected_amount from public.order_items where order_id=v_order.id;
  end if;


  v_difference :=
    round(p_final_amount - v_expected_amount, 2);


  ------------------------------------------------------------
  -- 10. Save official manually-entered bill amount
  ------------------------------------------------------------
  update public.orders
  set
    final_amount = p_final_amount,
    status = CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END,
    updated_at = now()
  where id = v_order.id;


  ------------------------------------------------------------
  -- 11. Complete Billing task
  ------------------------------------------------------------
  update public.task_claims
  set
    claim_status = 'completed',
    completed_at = now()
  where id = v_claim.id;


  ------------------------------------------------------------
  -- 12. Write audit history
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
    'billing_completed',
    'billing',
    'awaiting_billing',
    CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END,
    v_staff.id,
    'Final bill amount entered; Bill and Payment QR verified',
    jsonb_build_object(
      'final_bill_amount', p_final_amount,
      'expected_amount', v_expected_amount,
      'difference', v_difference
    )
  );


  ------------------------------------------------------------
  -- 13. Return useful information to OMS
  ------------------------------------------------------------
  return jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'billing_completed_by', v_staff.staff_name,
    'final_bill_amount', p_final_amount,
    'expected_amount', v_expected_amount,
    'difference', v_difference,
    'new_status', CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END
  );

end;
$function$


CREATE OR REPLACE FUNCTION public.complete_my_billing_no_cv(p_order_number bigint, p_final_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_staff public.staff%rowtype;
  v_claim public.task_claims%rowtype;
  v_bill public.order_files%rowtype;
  v_expected_amount numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_staff
  from public.staff
  where auth_user_id = auth.uid() and is_active = true
  limit 1;
  if not found then
    raise exception 'No active staff account is linked to the logged-in user';
  end if;

  select * into v_order
  from public.orders
  where order_number = p_order_number
  for update;
  if not found then
    raise exception 'Order % does not exist', p_order_number;
  end if;
  if v_order.status <> 'awaiting_billing' then
    raise exception 'Order % is not awaiting billing', p_order_number;
  end if;

  select * into v_claim
  from public.task_claims
  where order_id = v_order.id
    and stage = 'billing'
    and staff_id = v_staff.id
    and claim_status = 'active'
  limit 1;
  if not found then
    raise exception 'You do not own the active Billing task for Order %', p_order_number;
  end if;

  if p_final_amount is null or p_final_amount < 0
    or p_final_amount > 9999999999.99
    or round(p_final_amount, 2) <> p_final_amount then
    raise exception 'Enter a valid non-negative final bill amount (two decimals maximum)';
  end if;

  if exists (
    select 1 from public.order_items oi
    join public.orders m on m.id=oi.order_id
    where ((m.id=v_order.id and v_order.group_root_order_id is null)
        or (m.group_root_order_id=v_order.id and m.status<>'cancelled'))
      and oi.actual_qty is null
  ) then
    raise exception 'All actual picked quantities must be available before billing';
  end if;

  select * into v_bill
  from public.order_files
  where order_id = v_order.id
    and file_type = 'bill'
    and is_current = true;
  if not found then
    raise exception 'A POS parked-bill photo is required for customers without CV';
  end if;
  if v_bill.mime_type is null or v_bill.mime_type not like 'image/%' then
    raise exception 'Upload a picture of the POS parked bill (not a PDF)';
  end if;

  -- Prevent any earlier QR for this order from being shown as current
  -- after selecting the no-CV mode.
  update public.order_files
  set is_current = false
  where order_id = v_order.id
    and file_type = 'payment_qr'
    and is_current = true;

  if v_order.group_root_order_id=v_order.id then
    select round(coalesce(sum(line_total),0),2) into v_expected_amount
    from public.group_billing_lines where root_order_id=v_order.id;
  else
    select round(coalesce(sum(actual_qty*coalesce(piece_price_per_kg_snapshot,unit_price_snapshot)),0),2)
    into v_expected_amount from public.order_items where order_id=v_order.id;
  end if;

  update public.orders
  set final_amount = p_final_amount,
      billing_no_cv = true,
      billing_account_suspended = false,
      status = CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END,
      updated_at = now()
  where id = v_order.id;

  update public.task_claims
  set claim_status = 'completed',
      completed_at = now()
  where id = v_claim.id;

  insert into public.order_history (
    order_id, action, stage, from_status, to_status,
    performed_by_staff_id, note, details
  ) values (
    v_order.id, 'billing_completed', 'billing',
    'awaiting_billing', CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END,
    v_staff.id,
    'No-CV billing: POS parked-bill photo recorded; payment QR not required; rider notified',
    jsonb_build_object(
      'billing_mode', 'no_cv',
      'bill_required', true,
      'payment_qr_required', false,
      'bill_file_id', v_bill.id,
      'rider_notice', 'ลูกค้าไม่มีCV',
      'final_bill_amount', p_final_amount,
      'expected_amount', v_expected_amount,
      'difference', round(p_final_amount - v_expected_amount, 2)
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'new_status', CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END,
    'billing_mode', 'no_cv',
    'bill_file_id', v_bill.id,
    'final_bill_amount', p_final_amount
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.complete_my_billing_suspended(p_order_number bigint, p_final_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_staff public.staff%rowtype;
  v_claim public.task_claims%rowtype;
  v_cv_path text;
  v_cv_mime text;
  v_expected_prefix text;
  v_expected_amount numeric(12,2);
  v_file_id uuid;
  v_old_status text;
begin
  -- Authenticate the staff member before looking at any customer's files.
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select * into v_staff
  from public.staff
  where auth_user_id = auth.uid() and is_active = true
  limit 1;
  if not found then
    raise exception 'No active staff account is linked to the logged-in user';
  end if;

  select * into v_order
  from public.orders
  where order_number = p_order_number
  for update;
  if not found then
    raise exception 'Order % does not exist', p_order_number;
  end if;
  if v_order.status <> 'awaiting_billing' then
    raise exception 'Order % is not awaiting billing', p_order_number;
  end if;

  select * into v_claim
  from public.task_claims
  where order_id = v_order.id and stage = 'billing'
    and staff_id = v_staff.id and claim_status = 'active'
  limit 1;
  if not found then
    raise exception 'You do not own the active Billing task for Order %', p_order_number;
  end if;

  if p_final_amount is null or p_final_amount < 0 or p_final_amount > 9999999999.99
     or round(p_final_amount, 2) <> p_final_amount then
    raise exception 'Enter a valid non-negative final bill amount (two decimals maximum)';
  end if;

  if exists (
    select 1 from public.order_items oi
    join public.orders m on m.id=oi.order_id
    where ((m.id=v_order.id and v_order.group_root_order_id is null)
        or (m.group_root_order_id=v_order.id and m.status<>'cancelled'))
      and oi.actual_qty is null
  ) then
    raise exception 'All actual picked quantities must be available before billing';
  end if;

  select cv_card_storage_path into v_cv_path
  from public.customers
  where id = v_order.customer_id;
  if v_cv_path is null or btrim(v_cv_path) = '' then
    raise exception 'Customer CV card is missing. Upload it in the customer profile first.';
  end if;

  v_expected_prefix := 'customer-cv/' || v_order.customer_id::text || '/';
  if left(v_cv_path, length(v_expected_prefix)) <> v_expected_prefix then
    raise exception 'Customer CV card storage path is invalid';
  end if;
  select metadata ->> 'mimetype' into v_cv_mime
  from storage.objects
  where bucket_id = 'order-files' and name = v_cv_path;
  if v_cv_mime is null then
    raise exception 'Customer CV card image cannot be found in storage';
  end if;
  if v_cv_mime not in ('image/jpeg','image/png','image/webp') then
    raise exception 'Customer CV card must be a JPG, PNG or WebP image';
  end if;

  if v_order.group_root_order_id=v_order.id then
    select round(coalesce(sum(line_total),0),2) into v_expected_amount
    from public.group_billing_lines where root_order_id=v_order.id;
  else
    select round(coalesce(sum(actual_qty*coalesce(piece_price_per_kg_snapshot,unit_price_snapshot)),0),2)
    into v_expected_amount from public.order_items where order_id=v_order.id;
  end if;

  -- The private CV card is attached to THIS order's payment_qr slot.
  -- A fresh order_files row preserves the historical image even if
  -- the customer's CV card is subsequently replaced.
  update public.order_files
  set is_current = false
  where order_id = v_order.id
    and file_type = 'payment_qr'
    and is_current = true;

  insert into public.order_files (
    order_id, file_type, storage_path,
    original_filename, mime_type, uploaded_by_staff_id, is_current
  ) values (
    v_order.id, 'payment_qr', v_cv_path,
    'CV card - ' || v_order.customer_id::text, v_cv_mime, v_staff.id, true
  ) returning id into v_file_id;

  update public.orders
  set final_amount = p_final_amount,
      billing_account_suspended = true,
      status = CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END,
      updated_at = now()
  where id = v_order.id;

  update public.task_claims
  set claim_status = 'completed', completed_at = now()
  where id = v_claim.id;

  insert into public.order_history (
    order_id, action, stage, from_status, to_status,
    performed_by_staff_id, note, details
  ) values (
    v_order.id, 'billing_completed', 'billing',
    'awaiting_billing', CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END,
    v_staff.id,
    'Billing completed under suspended-account exception; CV card used instead of QR; bill photo optional',
    jsonb_build_object(
      'billing_mode', 'account_suspended',
      'bill_optional', true,
      'payment_qr_source', 'customer_cv_card',
      'cv_card_file_id', v_file_id,
      'final_bill_amount', p_final_amount,
      'expected_amount', v_expected_amount,
      'difference', round(p_final_amount - v_expected_amount, 2)
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'new_status', CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END,
    'billing_mode', 'account_suspended',
    'payment_qr_file_id', v_file_id
  );
end;
$function$


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
      SELECT coalesce(sum(coalesce(oi.actual_qty,0)*coalesce(oi.piece_price_per_kg_snapshot,oi.unit_price_snapshot)),0)
      FROM public.order_items oi WHERE oi.order_id=v_order.id
    )
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.prepare_group_billing(p_order_number bigint, p_staff_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_root public.orders%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.staff
  WHERE auth_user_id=auth.uid() AND staff_code=p_staff_code AND is_active=true
 ) THEN RAISE EXCEPTION 'Active staff authentication required'; END IF;

 SELECT * INTO v_root FROM public.orders
 WHERE order_number=p_order_number FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Primary order not found'; END IF;
 IF v_root.group_root_order_id IS NULL THEN RETURN; END IF;
 IF v_root.group_root_order_id<>v_root.id THEN
  RAISE EXCEPTION 'Billing is handled only by the group primary';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.orders member
   WHERE member.group_root_order_id=v_root.id
     AND member.status<>'cancelled'
     AND (member.status<>'awaiting_billing'
          OR EXISTS(SELECT 1 FROM public.order_items oi
                    WHERE oi.order_id=member.id AND oi.actual_qty IS NULL))
 ) THEN
    RAISE EXCEPTION 'Cannot start Billing until every suborder is picked';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.orders child
   JOIN public.task_claims tc ON tc.order_id=child.id
   WHERE child.group_root_order_id=v_root.id AND tc.stage='billing' AND tc.claim_status='active'
 ) THEN RAISE EXCEPTION 'Billing has already been claimed'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.orders child
   JOIN public.order_files f ON f.order_id=child.id
   WHERE child.group_root_order_id=v_root.id AND child.id<>v_root.id AND f.file_type IN ('bill','payment_qr')
 ) THEN RAISE EXCEPTION 'Billing documents already exist on a suborder'; END IF;

 DELETE FROM public.group_billing_lines WHERE root_order_id=v_root.id;
 INSERT INTO public.group_billing_lines (
   root_order_id,product_id,sku,product_name_snapshot,unit_snapshot,
   requested_qty,confirmed_qty,actual_qty,unit_price_snapshot,line_total,sources
 )
 SELECT v_root.id,oi.product_id,MIN(p.sku),MIN(oi.product_name_snapshot),
   oi.unit_snapshot,SUM(oi.requested_qty),SUM(oi.confirmed_qty),
   SUM(oi.actual_qty),
   CASE WHEN SUM(oi.actual_qty)>0
        THEN SUM(oi.actual_qty*coalesce(oi.piece_price_per_kg_snapshot,oi.unit_price_snapshot))/SUM(oi.actual_qty)
        ELSE SUM(oi.requested_qty*coalesce(oi.piece_price_per_kg_snapshot,oi.unit_price_snapshot))/NULLIF(SUM(oi.requested_qty),0)
   END,
   SUM(oi.actual_qty*coalesce(oi.piece_price_per_kg_snapshot,oi.unit_price_snapshot)),
   jsonb_agg(jsonb_build_object(
      'order_number',member.order_number,
      'display_number',v_root.order_number||'/'||member.group_sequence,
      'requested_qty',oi.requested_qty,
      'requested_unit',oi.unit_snapshot,
      'picked_qty',oi.actual_qty,
      'picked_unit',CASE WHEN oi.piece_price_per_kg_snapshot IS NOT NULL THEN 'กก.' ELSE oi.unit_snapshot END,
      'unit_price',coalesce(oi.piece_price_per_kg_snapshot,oi.unit_price_snapshot)
   ) ORDER BY member.group_sequence)
 FROM public.orders member
 JOIN public.order_items oi ON oi.order_id=member.id
 JOIN public.products p ON p.id=oi.product_id
 WHERE member.group_root_order_id=v_root.id
   AND member.status<>'cancelled'
 GROUP BY oi.product_id,oi.unit_snapshot;

 INSERT INTO public.order_history(order_id,action,stage,note,details)
 VALUES(v_root.id,'group_billing_prepared','billing',
    'All grouped suborders were picked; frozen combined billing items',
    jsonb_build_object('suborder_count',(
      SELECT COUNT(*) FROM public.orders WHERE group_root_order_id=v_root.id
    ),'expected_amount',(
      SELECT SUM(line_total) FROM public.group_billing_lines WHERE root_order_id=v_root.id
    )));
END;
$function$

