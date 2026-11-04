-- Billing-stage variance is calculated from picked quantities and frozen prices,
-- including grouped orders (group_billing_lines.line_total).
-- The manually entered final amount is still the official bill.
CREATE OR REPLACE FUNCTION public.billing_difference_reason(
  p_expected_amount numeric,
  p_final_amount numeric,
  p_reason text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF round(abs(p_final_amount - p_expected_amount), 2) > 1.00 THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'ยอดบิลต่างจากยอดที่หยิบจริงเกิน 1 บาท กรุณาระบุเหตุผลก่อนยืนยันการออกบิล'
        USING ERRCODE = '22023';
    END IF;
    IF char_length(v_reason) > 500 THEN
      RAISE EXCEPTION 'เหตุผลส่วนต่างยอดบิลต้องไม่เกิน 500 ตัวอักษร'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_reason;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.billing_difference_reason(numeric,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_difference_reason(numeric,numeric,text) TO service_role;

-- Preserve existing two-argument RPC names for clients with <= ฿1.00 difference;
-- legacy requests with greater difference now fail transactionally.

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

  -- Block old two-argument clients from silently bypassing the new reason requirement.
  PERFORM public.billing_difference_reason(v_expected_amount, p_final_amount, NULL);


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
$function$;

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

  -- The legacy RPC cannot bypass mandatory billing variance explanations.
  PERFORM public.billing_difference_reason(v_expected_amount, p_final_amount, NULL);

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
$function$;

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

  -- The legacy RPC cannot bypass mandatory billing variance explanations.
  PERFORM public.billing_difference_reason(v_expected_amount, p_final_amount, NULL);

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
$function$;

-- New reason-aware RPCs (kept separate to avoid ambiguous PostgREST overloads).

CREATE OR REPLACE FUNCTION public.complete_billing_with_reason(p_order_number bigint, p_staff_code text, p_final_amount numeric, p_difference_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders%rowtype;
  v_staff public.staff%rowtype;
  v_claim public.task_claims%rowtype;

  v_expected_amount numeric(12,2);
  v_difference numeric(12,2);
  v_variance_reason text;

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

  v_variance_reason := public.billing_difference_reason(
    v_expected_amount, p_final_amount, p_difference_reason
  );


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
    'Final bill amount entered; Bill and Payment QR verified' ||
    CASE WHEN v_variance_reason IS NULL THEN '' ELSE ' | เหตุผลส่วนต่างยอดบิล: ' || v_variance_reason END,
    jsonb_build_object(
      'final_bill_amount', p_final_amount,
      'expected_amount', v_expected_amount,
      'difference', v_difference,
      'difference_reason', v_variance_reason
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
    'difference_reason', v_variance_reason,
    'new_status', CASE WHEN v_order.fulfillment_method = 'pickup' THEN 'awaiting_payment' ELSE 'ready_for_delivery' END
  );

end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_my_billing_with_reason(p_order_number bigint, p_final_amount numeric, p_difference_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff_code text;
begin

  v_staff_code := public.current_staff_code();

  if v_staff_code is null then
    raise exception
      'No active staff account is linked to the logged-in user';
  end if;

  return public.complete_billing_with_reason(
    p_order_number,
    v_staff_code,
    p_final_amount,
    p_difference_reason
  );

end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_my_billing_no_cv_with_reason(p_order_number bigint, p_final_amount numeric, p_difference_reason text)
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
  v_variance_reason text;
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

  v_variance_reason := public.billing_difference_reason(
    v_expected_amount, p_final_amount, p_difference_reason
  );

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
    'No-CV billing: POS parked-bill photo recorded; payment QR not required; rider notified' ||
    CASE WHEN v_variance_reason IS NULL THEN '' ELSE ' | เหตุผลส่วนต่างยอดบิล: ' || v_variance_reason END,
    jsonb_build_object(
      'billing_mode', 'no_cv',
      'bill_required', true,
      'payment_qr_required', false,
      'bill_file_id', v_bill.id,
      'rider_notice', 'ลูกค้าไม่มีCV',
      'final_bill_amount', p_final_amount,
      'expected_amount', v_expected_amount,
      'difference', round(p_final_amount - v_expected_amount, 2),
      'difference_reason', v_variance_reason
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
$function$;

CREATE OR REPLACE FUNCTION public.complete_my_billing_suspended_with_reason(p_order_number bigint, p_final_amount numeric, p_difference_reason text)
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
  v_variance_reason text;
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

  v_variance_reason := public.billing_difference_reason(
    v_expected_amount, p_final_amount, p_difference_reason
  );

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
    'Billing completed under suspended-account exception; CV card used instead of QR; bill photo optional' ||
    CASE WHEN v_variance_reason IS NULL THEN '' ELSE ' | เหตุผลส่วนต่างยอดบิล: ' || v_variance_reason END,
    jsonb_build_object(
      'billing_mode', 'account_suspended',
      'bill_optional', true,
      'payment_qr_source', 'customer_cv_card',
      'cv_card_file_id', v_file_id,
      'final_bill_amount', p_final_amount,
      'expected_amount', v_expected_amount,
      'difference', round(p_final_amount - v_expected_amount, 2),
      'difference_reason', v_variance_reason
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
$function$;

-- Match the existing public API privileges, and keep the internal staff-code RPC private.
REVOKE ALL ON FUNCTION public.complete_billing_with_reason(bigint,text,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_billing_with_reason(bigint,text,numeric,text) TO service_role;

REVOKE ALL ON FUNCTION public.complete_my_billing_with_reason(bigint,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_my_billing_no_cv_with_reason(bigint,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_my_billing_suspended_with_reason(bigint,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_my_billing_with_reason(bigint,numeric,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_my_billing_no_cv_with_reason(bigint,numeric,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_my_billing_suspended_with_reason(bigint,numeric,text) TO authenticated, service_role;
