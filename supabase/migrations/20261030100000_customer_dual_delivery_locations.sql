-- Add up to two named delivery locations per customer and reject cross-location grouped orders.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS delivery_location_1_name text NOT NULL DEFAULT 'จุดส่ง 1', ADD COLUMN IF NOT EXISTS delivery_map_url_2 text, ADD COLUMN IF NOT EXISTS delivery_location_2_name text NOT NULL DEFAULT 'จุดส่ง 2';

CREATE OR REPLACE FUNCTION public.create_group_suborder(p_customer_id uuid, p_primary_order_number bigint, p_delivery_date date, p_delivery_slot text, p_delivery_address text, p_customer_notes text, p_items jsonb, p_line_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 IF v_root.delivery_address IS DISTINCT FROM p_delivery_address THEN
   RAISE EXCEPTION 'Grouped orders must use the same delivery location';
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
$function$
;