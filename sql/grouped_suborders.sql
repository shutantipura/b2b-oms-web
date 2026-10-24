-- Grouped suborders: keep independent order IDs, quantities and cart photos.
-- Only a group root owns Billing/Delivery/Payment.
-- All changes in the same transaction as the associated RPC.
ALTER TABLE public.orders
 ADD COLUMN IF NOT EXISTS group_root_order_id uuid REFERENCES public.orders(id),
 ADD COLUMN IF NOT EXISTS group_sequence integer,
 ADD COLUMN IF NOT EXISTS group_request_id uuid;

ALTER TABLE public.orders
 ADD CONSTRAINT orders_group_sequence_valid CHECK (
   (group_root_order_id IS NULL AND group_sequence IS NULL)
   OR (group_root_order_id IS NOT NULL AND group_sequence >= 1)
 );

CREATE UNIQUE INDEX IF NOT EXISTS orders_group_root_sequence_unique
 ON public.orders(group_root_order_id,group_sequence)
 WHERE group_root_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orders_group_request_unique
 ON public.orders(group_request_id) WHERE group_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_group_root_lookup
 ON public.orders(group_root_order_id) WHERE group_root_order_id IS NOT NULL;

-- A complete breakdown is captured once at Billing claim time.
CREATE TABLE IF NOT EXISTS public.group_billing_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 root_order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 product_id uuid NOT NULL REFERENCES public.products(id),
 sku text NOT NULL,
 product_name_snapshot text NOT NULL,
 unit_snapshot text NOT NULL,
 requested_qty numeric NOT NULL,
 confirmed_qty numeric NOT NULL,
 actual_qty numeric NOT NULL,
 unit_price_snapshot numeric NOT NULL,
 line_total numeric NOT NULL,
 sources jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(root_order_id,product_id)
);
CREATE INDEX IF NOT EXISTS group_billing_lines_root_idx ON public.group_billing_lines(root_order_id);
ALTER TABLE public.group_billing_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_billing_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.group_billing_lines TO authenticated;
CREATE POLICY group_billing_lines_staff_read
 ON public.group_billing_lines FOR SELECT TO authenticated
 USING (EXISTS(
  SELECT 1 FROM public.staff s
  WHERE s.auth_user_id=(SELECT auth.uid()) AND s.is_active=true
 ));

-- Called ONLY after the LINE ID token and customer were independently
-- verified on the server. The RPC repeats LINE/customer access checks.
-- New orders are created as standalone orders and are only linked to the
-- existing group; no original item row or cart photo is ever modified.
CREATE OR REPLACE FUNCTION public.create_group_suborder(
 p_customer_id uuid,
 p_primary_order_number bigint,
 p_delivery_date date,
 p_delivery_slot text,
 p_delivery_address text,
 p_customer_notes text,
 p_items jsonb,
 p_line_user_id uuid,
 p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $group_suborder$
DECLARE
 v_root public.orders%rowtype;
 v_created jsonb;
 v_customer_code text;
 v_new_id uuid;
 v_new_number bigint;
 v_next_seq int;
 v_existing public.orders%rowtype;
BEGIN
 IF p_request_id IS NULL OR p_customer_id IS NULL OR p_line_user_id IS NULL
    OR p_primary_order_number IS NULL THEN
  RAISE EXCEPTION 'Missing group order reference or authorization';
 END IF;

 SELECT c.customer_code INTO v_customer_code
 FROM public.customers c
 JOIN public.customer_line_users clu ON clu.customer_id=c.id
 JOIN public.line_users lu ON lu.id=clu.line_user_id
 WHERE c.id=p_customer_id AND c.is_active=true
   AND clu.line_user_id=p_line_user_id AND clu.can_order=true
   AND lu.is_active=true;
 IF v_customer_code IS NULL THEN
   RAISE EXCEPTION 'LINE user is not authorized for this customer';
 END IF;

 -- Both Billing claim and customer addition lock the same root.
 SELECT * INTO v_root FROM public.orders
 WHERE order_number=p_primary_order_number AND customer_id=p_customer_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Primary order does not belong to this customer'; END IF;
 IF v_root.group_root_order_id IS NOT NULL AND v_root.group_root_order_id<>v_root.id THEN
  RAISE EXCEPTION 'Select the primary order of an existing group';
 END IF;

 -- Idempotent retry after a timeout; never create the same suborder twice.
 SELECT * INTO v_existing FROM public.orders
 WHERE group_request_id=p_request_id AND customer_id=p_customer_id;
 IF FOUND THEN
  IF v_existing.group_root_order_id IS DISTINCT FROM v_root.id THEN
    RAISE EXCEPTION 'This order request belongs to another group';
  END IF;
  RETURN jsonb_build_object(
    'order_number',v_existing.order_number,
    'order_id',v_existing.id,
    'group_root_number',v_root.order_number,
    'group_sequence',v_existing.group_sequence,
    'display_number',v_root.order_number||'/'||v_existing.group_sequence,
    'already_processed',true,
    'grouped',true
  );
 END IF;

 IF v_root.status NOT IN ('awaiting_confirmation','awaiting_picking','picking','awaiting_billing')
   OR v_root.final_amount IS NOT NULL OR v_root.cancelled_at IS NOT NULL THEN
  RAISE EXCEPTION 'The primary order has already entered Billing or later processing';
 END IF;
 IF v_root.delivery_date IS DISTINCT FROM p_delivery_date
   OR v_root.delivery_slot IS DISTINCT FROM p_delivery_slot THEN
  RAISE EXCEPTION 'Grouped orders must share the primary delivery date and slot';
 END IF;
 -- Group's original delivery address remains authoritative and is inherited
 -- by the new suborder, even when the customer's default address has changed.
 -- Do not admit new suborders after billing has EVER been claimed,
 -- or even if a document was uploaded before the claim was released.
 IF EXISTS (
   SELECT 1 FROM public.task_claims t
   WHERE t.order_id=v_root.id AND t.stage='billing'
 ) OR EXISTS (
   SELECT 1 FROM public.order_files f
   WHERE f.order_id=v_root.id AND f.file_type IN ('bill','payment_qr')
 ) OR EXISTS (
   SELECT 1 FROM public.orders child
   WHERE child.group_root_order_id=v_root.id
      AND child.status <> 'cancelled'
     AND (child.status NOT IN ('awaiting_confirmation','awaiting_picking','picking','awaiting_billing')
           OR child.final_amount IS NOT NULL)
 ) THEN
   RAISE EXCEPTION 'Billing has begun for this delivery; create a separate order';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.orders child
   JOIN public.task_claims claim ON claim.order_id=child.id
   WHERE child.group_root_order_id=v_root.id AND claim.stage='billing'
 ) THEN RAISE EXCEPTION 'Billing was already claimed by this group'; END IF;

 -- Lock held on root through suborder creation prevents concurrent Billing.
 IF v_root.group_root_order_id IS NULL THEN
   UPDATE public.orders SET group_root_order_id=v_root.id,group_sequence=1
   WHERE id=v_root.id;
 END IF;

 SELECT COALESCE(MAX(group_sequence),1)+1 INTO v_next_seq FROM public.orders
 WHERE group_root_order_id=v_root.id;

 v_created:=public.create_customer_order(v_customer_code,p_delivery_date,p_delivery_slot,
                                         v_root.delivery_address,p_customer_notes,p_items);
 v_new_id:=(v_created->>'order_id')::uuid;
 v_new_number:=(v_created->>'order_number')::bigint;
 IF v_new_id IS NULL THEN RAISE EXCEPTION 'Unable to create additional suborder'; END IF;

 UPDATE public.orders SET
    group_root_order_id=v_root.id,
    group_sequence=v_next_seq,
    group_request_id=p_request_id,
    ordered_by_line_user_id=p_line_user_id
 WHERE id=v_new_id;

 INSERT INTO public.order_history(order_id,action,stage,from_status,to_status,
   performed_by_line_user_id,note,details)
 VALUES(v_new_id,'suborder_joined','confirmation','awaiting_confirmation','awaiting_confirmation',
 p_line_user_id,'Customer created a linked suborder; confirmation and picking remain independent',
 jsonb_build_object('group_root_number',v_root.order_number,'group_sequence',v_next_seq));
 INSERT INTO public.order_history(order_id,action,stage,note,details)
 VALUES(v_root.id,'suborder_added','confirmation',
   'An additional customer order was linked to this delivery',
   jsonb_build_object('new_order_number',v_new_number,'group_sequence',v_next_seq));
 RETURN jsonb_build_object(
   'order_number',v_new_number,
   'order_id',v_new_id,
   'group_root_number',v_root.order_number,
   'group_sequence',v_next_seq,
   'display_number',v_root.order_number||'/'||v_next_seq,
   'grouped',true
 );
END;
$group_suborder$;

-- Runs inside claim_task's transaction, holding the locked root row.
-- Marks the group immutable and freezes aggregate picked quantities for
-- Billing. No original order_items rows are rewritten.
CREATE OR REPLACE FUNCTION public.prepare_group_billing(
 p_order_number bigint,p_staff_code text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $group_bill$
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
   WHERE child.group_root_order_id=v_root.id AND tc.stage='billing'
 ) THEN RAISE EXCEPTION 'Billing has already been claimed'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.orders child
   JOIN public.order_files f ON f.order_id=child.id
   WHERE child.group_root_order_id=v_root.id AND f.file_type IN ('bill','payment_qr')
 ) THEN RAISE EXCEPTION 'Billing documents already exist on a suborder'; END IF;

 DELETE FROM public.group_billing_lines WHERE root_order_id=v_root.id;
 INSERT INTO public.group_billing_lines (
   root_order_id,product_id,sku,product_name_snapshot,unit_snapshot,
   requested_qty,confirmed_qty,actual_qty,unit_price_snapshot,line_total,sources
 )
 SELECT v_root.id,oi.product_id,MIN(p.sku),MIN(oi.product_name_snapshot),
   MIN(oi.unit_snapshot),SUM(oi.requested_qty),SUM(oi.confirmed_qty),
   SUM(oi.actual_qty),
   CASE WHEN SUM(oi.actual_qty)>0
        THEN SUM(oi.actual_qty*oi.unit_price_snapshot)/SUM(oi.actual_qty)
        ELSE SUM(oi.requested_qty*oi.unit_price_snapshot)/NULLIF(SUM(oi.requested_qty),0)
   END,
   SUM(oi.actual_qty*oi.unit_price_snapshot),
   jsonb_agg(jsonb_build_object(
      'order_number',member.order_number,
      'display_number',v_root.order_number||'/'||member.group_sequence,
      'picked_qty',oi.actual_qty,
      'unit_price',oi.unit_price_snapshot
   ) ORDER BY member.group_sequence)
 FROM public.orders member
 JOIN public.order_items oi ON oi.order_id=member.id
 JOIN public.products p ON p.id=oi.product_id
 WHERE member.group_root_order_id=v_root.id
   AND member.status<>'cancelled'
 GROUP BY oi.product_id;

 INSERT INTO public.order_history(order_id,action,stage,note,details)
 VALUES(v_root.id,'group_billing_prepared','billing',
    'All grouped suborders were picked; frozen combined billing items',
    jsonb_build_object('suborder_count',(
      SELECT COUNT(*) FROM public.orders WHERE group_root_order_id=v_root.id
    ),'expected_amount',(
      SELECT SUM(line_total) FROM public.group_billing_lines WHERE root_order_id=v_root.id
    )));
END;
$group_bill$;

-- Existing claim_task is unchanged for normal orders.
-- For grouped orders it invokes a locked, validated Billing preparation
-- BEFORE inserting the active claim.
-- These functions are only called via verified LINE service or staff workflow.
REVOKE ALL ON FUNCTION public.create_group_suborder(uuid,bigint,date,text,text,text,jsonb,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_group_suborder(uuid,bigint,date,text,text,text,jsonb,uuid,uuid)
 TO service_role;
REVOKE ALL ON FUNCTION public.prepare_group_billing(bigint,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_group_billing(bigint,text) TO authenticated;


-- Child statuses follow root ONLY after the group has been billed.
-- Independent item/photos remain attached to each original suborder.
CREATE OR REPLACE FUNCTION public.sync_group_delivery_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $group_status$
BEGIN
 IF NEW.group_root_order_id=NEW.id
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('ready_for_delivery','out_for_delivery',
         'awaiting_payment','payment_submitted','completed','cancelled') THEN
   UPDATE public.orders member SET status=NEW.status,updated_at=now()
   WHERE member.group_root_order_id=NEW.id AND member.id<>NEW.id
     AND member.status<>'cancelled';
 END IF;
 RETURN NEW;
END;
$group_status$;
DROP TRIGGER IF EXISTS sync_group_delivery_status_trigger ON public.orders;
CREATE TRIGGER sync_group_delivery_status_trigger
 AFTER UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.sync_group_delivery_status();

CREATE OR REPLACE FUNCTION public.claim_task(p_order_number bigint, p_staff_code text, p_stage text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders%rowtype;
  v_staff public.staff%rowtype;

  v_expected_status text;
  v_new_status text;

  v_claim_id uuid;
begin

  -- Find and lock the order
  select *
  into v_order
  from public.orders
  where order_number = p_order_number
  for update;

  if not found then
    raise exception 'Order % does not exist', p_order_number;
  end if;


  -- Find active staff member
  select *
  into v_staff
  from public.staff
  where staff_code = p_staff_code
    and is_active = true;

  if not found then
    raise exception 'Active staff member % does not exist', p_staff_code;
  end if;


  -- Define which order status is allowed for each stage
  case p_stage

    when 'confirmation' then
      v_expected_status := 'awaiting_confirmation';
      v_new_status := 'awaiting_confirmation';

    when 'picking' then
      v_expected_status := 'awaiting_picking';
      v_new_status := 'picking';

    when 'billing' then
      v_expected_status := 'awaiting_billing';
      v_new_status := 'awaiting_billing';

    when 'delivery' then
      v_expected_status := 'ready_for_delivery';
      v_new_status := 'out_for_delivery';

    when 'payment_verification' then
      v_expected_status := 'payment_submitted';
      v_new_status := 'payment_submitted';

    else
      raise exception 'Invalid task stage: %', p_stage;

  end case;


  -- Make sure the order is actually ready for this task
  if v_order.status <> v_expected_status then
    raise exception
      'Order % has status %, so % cannot be started',
      p_order_number,
      v_order.status,
      p_stage;
  end if;


  -- Check whether somebody already owns this stage
  if exists (
    select 1
    from public.task_claims
    where order_id = v_order.id
      and stage = p_stage
      and claim_status = 'active'
  ) then
    raise exception
      'This task is already being worked on by another staff member';
  end if;


  -- Check whether this staff member already has another task
  if exists (
    select 1
    from public.task_claims
    where staff_id = v_staff.id
      and claim_status = 'active'
  ) then
    raise exception
      'Staff member % already has an active task',
      v_staff.staff_name;
  end if;


  -- Billing can only be claimed by a group root after every member
  -- has completed Picking. This order row is locked against new suborders.
  if p_stage in ('billing','delivery','payment_verification')
    and v_order.group_root_order_id is not null
    and v_order.group_root_order_id<>v_order.id then
    raise exception 'Use group primary for billing and delivery';
  end if;
  if p_stage='billing' and v_order.group_root_order_id=v_order.id then
    perform public.prepare_group_billing(p_order_number,p_staff_code);
  end if;

  -- Claim the task
  insert into public.task_claims (
    order_id,
    stage,
    staff_id
  )
  values (
    v_order.id,
    p_stage,
    v_staff.id
  )
  returning id into v_claim_id;


  -- Some stages change order status immediately on START WORK
  if v_new_status <> v_order.status then

    update public.orders
    set
      status = v_new_status,
      updated_at = now()
    where id = v_order.id;

  end if;


  -- Audit trail
  insert into public.order_history (
    order_id,
    action,
    stage,
    from_status,
    to_status,
    performed_by_staff_id,
    note
  )
  values (
    v_order.id,
    'task_started',
    p_stage,
    v_order.status,
    v_new_status,
    v_staff.id,
    p_stage || ' task started'
  );


  return jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'stage', p_stage,
    'staff', v_staff.staff_name,
    'claim_id', v_claim_id,
    'status', v_new_status
  );


exception
  when unique_violation then
    raise exception
      'Task could not be claimed because it was claimed by someone else at the same time';
end;
$function$;

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
    select round(coalesce(sum(actual_qty*unit_price_snapshot),0),2)
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
    status = 'ready_for_delivery',
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
    'ready_for_delivery',
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
    'new_status', 'ready_for_delivery'
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
    select round(coalesce(sum(actual_qty*unit_price_snapshot),0),2)
    into v_expected_amount from public.order_items where order_id=v_order.id;
  end if;

  update public.orders
  set final_amount = p_final_amount,
      billing_no_cv = true,
      billing_account_suspended = false,
      status = 'ready_for_delivery',
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
    'awaiting_billing', 'ready_for_delivery',
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
    'new_status', 'ready_for_delivery',
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
    select round(coalesce(sum(actual_qty*unit_price_snapshot),0),2)
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
      status = 'ready_for_delivery',
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
    'awaiting_billing', 'ready_for_delivery',
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
    'new_status', 'ready_for_delivery',
    'billing_mode', 'account_suspended',
    'payment_qr_file_id', v_file_id
  );
end;
$function$;

-- Prevent late child cancellations from contradicting a frozen group bill.
CREATE OR REPLACE FUNCTION public.manager_cancel_order(p_order_number bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_manager public.staff%rowtype;
  v_stage text;
  v_reason text;
begin
  select *
  into v_manager
  from public.staff
  where auth_user_id = auth.uid()
    and is_active = true
    and account_type = 'manager'
  limit 1;

  if not found then
    raise exception 'Manager access required';
  end if;

  select *
  into v_order
  from public.orders
  where order_number = p_order_number
  for update;

  if not found then
    raise exception 'Order % does not exist', p_order_number;
  end if;

  if v_order.status in ('completed', 'cancelled') then
    raise exception
      'Order % is already %',
      p_order_number,
      v_order.status;
  end if;

  -- Once the group Billing task has been claimed, a suborder cannot be
  -- cancelled independently. The financial snapshot already includes it.
  IF v_order.group_root_order_id IS NOT NULL
     AND v_order.group_root_order_id <> v_order.id
     AND EXISTS(
       SELECT 1 FROM public.task_claims
       WHERE order_id=v_order.group_root_order_id AND stage='billing'
     ) THEN
       RAISE EXCEPTION 'Grouped delivery already entered Billing; cancel the whole group if necessary';
  END IF;

  v_reason := trim(coalesce(p_reason, ''));

  if v_reason = '' then
    raise exception 'Cancellation reason is required';
  end if;

  v_stage :=
    case
      when v_order.status = 'awaiting_confirmation'
        then 'confirmation'
      when v_order.status in ('awaiting_picking', 'picking')
        then 'picking'
      when v_order.status = 'awaiting_billing'
        then 'billing'
      when v_order.status in ('ready_for_delivery', 'out_for_delivery')
        then 'delivery'
      when v_order.status in ('awaiting_payment', 'payment_submitted')
        then 'payment_verification'
      else null
    end;

  update public.task_claims
  set
    claim_status = 'released',
    released_at = now()
  where order_id = v_order.id
    and claim_status = 'active';

  update public.orders
  set
    status = 'cancelled',
    cancellation_reason = v_reason,
    updated_at = now()
  where id = v_order.id;

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
    'manager_cancelled',
    v_stage,
    v_order.status,
    'cancelled',
    v_manager.id,
    'Order cancelled by Manager',
    jsonb_build_object(
      'reason', v_reason,
      'manager_name', v_manager.staff_name
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'new_status', 'cancelled',
    'cancelled_by', v_manager.staff_name,
    'reason', v_reason
  );
end;
$function$;

-- Legacy manager overrides must respect a locked group bill.
CREATE OR REPLACE FUNCTION public.force_complete_order(p_order_number bigint, p_manager_code text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders%rowtype;
  v_manager public.staff%rowtype;
  v_previous_status text;

begin

  ------------------------------------------------------------
  -- 1. Find and lock order
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
  -- 2. Find active Manager
  ------------------------------------------------------------
  select *
  into v_manager
  from public.staff
  where staff_code = p_manager_code
    and is_active = true
    and account_type = 'manager';

  if not found then
    raise exception
      'Active Manager % does not exist or does not have Manager permission',
      p_manager_code;
  end if;


  ------------------------------------------------------------
  -- 3. Validate order
  ------------------------------------------------------------
  if v_order.group_root_order_id is not null
    and v_order.group_root_order_id <> v_order.id then
    raise exception 'Cannot force-complete a grouped suborder individually; use the primary';
  end if;

  if v_order.status = 'completed' then
    raise exception
      'Order % is already completed',
      p_order_number;
  end if;

  if v_order.status = 'cancelled' then
    raise exception
      'Cancelled orders cannot be force completed';
  end if;


  ------------------------------------------------------------
  -- 4. Require override reason
  ------------------------------------------------------------
  if p_reason is null
     or trim(p_reason) = '' then
    raise exception
      'Force Complete reason is required';
  end if;

  v_previous_status := v_order.status;


  ------------------------------------------------------------
  -- 5. Release any task somebody is currently working on
  ------------------------------------------------------------
  update public.task_claims
  set
    claim_status = 'released',
    released_at = now(),
    release_reason = 'Order force completed by Manager'
  where order_id = v_order.id
    and claim_status = 'active';


  ------------------------------------------------------------
  -- 6. Immediately complete order
  ------------------------------------------------------------
  update public.orders
  set
    status = 'completed',

    force_completed_at = now(),
    force_completed_by_staff_id = v_manager.id,
    force_complete_reason = p_reason,

    completed_at = now(),
    updated_at = now()

  where id = v_order.id;


  ------------------------------------------------------------
  -- 7. Audit trail
  ------------------------------------------------------------
  insert into public.order_history (
    order_id,
    action,
    from_status,
    to_status,
    performed_by_staff_id,
    note,
    details
  )
  values (
    v_order.id,
    'order_force_completed',
    v_previous_status,
    'completed',
    v_manager.id,
    'Order force completed by Manager: ' || p_reason,
    jsonb_build_object(
      'reason', p_reason,
      'previous_status', v_previous_status
    )
  );


  ------------------------------------------------------------
  -- 8. Return result
  ------------------------------------------------------------
  return jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'force_completed_by', v_manager.staff_name,
    'previous_status', v_previous_status,
    'new_status', 'completed',
    'reason', p_reason
  );

end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_number bigint, p_manager_code text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders%rowtype;
  v_manager public.staff%rowtype;
  v_previous_status text;

begin

  ------------------------------------------------------------
  -- 1. Find and lock order
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
  -- 2. Find Manager
  ------------------------------------------------------------
  select *
  into v_manager
  from public.staff
  where staff_code = p_manager_code
    and is_active = true
    and account_type = 'manager';

  if not found then
    raise exception
      'Active Manager % does not exist or does not have Manager permission',
      p_manager_code;
  end if;


  ------------------------------------------------------------
  -- 3. Validate current order state
  ------------------------------------------------------------
  if v_order.group_root_order_id is not null
    and v_order.group_root_order_id<>v_order.id
    and exists (select 1 from public.task_claims
      where order_id=v_order.group_root_order_id and stage='billing') then
    raise exception 'Group is already being billed; cancel the primary rather than an individual suborder';
  end if;

  if v_order.status = 'completed' then
    raise exception
      'Completed orders cannot be cancelled';
  end if;

  if v_order.status = 'cancelled' then
    raise exception
      'Order % is already cancelled',
      p_order_number;
  end if;


  ------------------------------------------------------------
  -- 4. Cancellation reason is mandatory
  ------------------------------------------------------------
  if p_reason is null
     or trim(p_reason) = '' then
    raise exception
      'Cancellation reason is required';
  end if;

  v_previous_status := v_order.status;


  ------------------------------------------------------------
  -- 5. Release any active work on this order
  ------------------------------------------------------------
  update public.task_claims
  set
    claim_status = 'released',
    released_at = now(),
    release_reason = 'Order cancelled by Manager'
  where order_id = v_order.id
    and claim_status = 'active';


  ------------------------------------------------------------
  -- 6. Cancel the order
  ------------------------------------------------------------
  update public.orders
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by_staff_id = v_manager.id,
    cancellation_reason = p_reason,
    updated_at = now()
  where id = v_order.id;


  ------------------------------------------------------------
  -- 7. Write permanent audit history
  ------------------------------------------------------------
  insert into public.order_history (
    order_id,
    action,
    from_status,
    to_status,
    performed_by_staff_id,
    note,
    details
  )
  values (
    v_order.id,
    'order_cancelled',
    v_previous_status,
    'cancelled',
    v_manager.id,
    'Order cancelled by Manager: ' || p_reason,
    jsonb_build_object(
      'reason', p_reason
    )
  );


  ------------------------------------------------------------
  -- 8. Return result
  ------------------------------------------------------------
  return jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'cancelled_by', v_manager.staff_name,
    'previous_status', v_previous_status,
    'new_status', 'cancelled',
    'reason', p_reason
  );

end;
$function$;