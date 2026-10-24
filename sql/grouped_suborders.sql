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
 IF btrim(coalesce(v_root.delivery_address,'')) <> btrim(coalesce(p_delivery_address,'')) THEN
  RAISE EXCEPTION 'Grouped orders must share the primary delivery address';
 END IF;
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
                                         p_delivery_address,p_customer_notes,p_items);
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
     AND (member.status<>'awaiting_billing'
          OR member.cancelled_at IS NOT NULL
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
