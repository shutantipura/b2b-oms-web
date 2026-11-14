-- Signed-in customers must be able to recover a successfully committed
-- checkout even after its delivery slot has passed or catalogue prices change.
-- Backward-compatible V2 RPCs leave existing Android / LINE sessions working.
ALTER TABLE public.orders
 ADD COLUMN IF NOT EXISTS checkout_intent_hash text;
ALTER TABLE public.orders
 ADD CONSTRAINT orders_checkout_intent_hash_format
 CHECK (checkout_intent_hash IS NULL OR checkout_intent_hash ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION public.lookup_checkout_order_retry(
 p_request_id uuid,p_customer_id uuid,p_line_user_id uuid,p_intent_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $retry_lookup$
DECLARE v_order public.orders%rowtype; v_root_number bigint;
BEGIN
 IF p_request_id IS NULL OR p_customer_id IS NULL OR p_line_user_id IS NULL
   OR p_intent_hash IS NULL OR p_intent_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Invalid checkout retry request';
 END IF;
 SELECT * INTO v_order FROM public.orders
 WHERE checkout_request_id=p_request_id OR group_request_id=p_request_id
 LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_order.customer_id IS DISTINCT FROM p_customer_id
 OR v_order.ordered_by_line_user_id IS DISTINCT FROM p_line_user_id
 OR v_order.checkout_intent_hash IS DISTINCT FROM p_intent_hash THEN
  RAISE EXCEPTION 'Checkout request ID has already been used for different order details';
 END IF;
 IF v_order.group_sequence IS NOT NULL AND v_order.group_sequence>1 THEN
  SELECT order_number INTO v_root_number FROM public.orders WHERE id=v_order.group_root_order_id;
 END IF;
 RETURN jsonb_build_object(
  'order_id',v_order.id,'order_number',v_order.order_number,
  'fulfillment_method',v_order.fulfillment_method,
  'already_processed',true,'grouped',v_root_number IS NOT NULL,
  'group_root_number',v_root_number,
  'display_number',CASE WHEN v_root_number IS NOT NULL
    THEN v_root_number::text||'/'||v_order.group_sequence::text
    ELSE v_order.order_number::text END);
END $retry_lookup$;

-- For new orders, the original transactional RPC remains responsible for
-- authorization, request locking, pricing, order items and history.
CREATE OR REPLACE FUNCTION public.create_checkout_order_once_v2(
 p_customer_id uuid,p_line_user_id uuid,p_customer_code text,
 p_delivery_date date,p_delivery_slot text,p_delivery_address text,
 p_customer_notes text,p_items jsonb,p_request_id uuid,p_is_pickup boolean,
 p_intent_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $checkout_v2$
DECLARE v_result jsonb;v_order_id uuid;
BEGIN
 IF p_intent_hash IS NULL OR p_intent_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Invalid checkout intent';
 END IF;
 v_result:=public.create_checkout_order_once(p_customer_id,p_line_user_id,
  p_customer_code,p_delivery_date,p_delivery_slot,p_delivery_address,
  p_customer_notes,p_items,p_request_id,p_is_pickup);
 v_order_id:=(v_result->>'order_id')::uuid;
 UPDATE public.orders SET checkout_intent_hash=p_intent_hash
 WHERE id=v_order_id AND customer_id=p_customer_id AND ordered_by_line_user_id=p_line_user_id
 AND (checkout_intent_hash IS NULL OR checkout_intent_hash=p_intent_hash);
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkout retry intent does not match original order'; END IF;
 RETURN v_result;
END $checkout_v2$;

CREATE OR REPLACE FUNCTION public.create_group_suborder_v2(
 p_customer_id uuid,p_primary_order_number bigint,p_delivery_date date,
 p_delivery_slot text,p_delivery_address text,p_customer_notes text,
 p_items jsonb,p_line_user_id uuid,p_request_id uuid,p_intent_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $group_v2$
DECLARE v_result jsonb;v_order_id uuid;
BEGIN
 IF p_intent_hash IS NULL OR p_intent_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Invalid grouped checkout intent';
 END IF;
 v_result:=public.create_group_suborder(p_customer_id,p_primary_order_number,
  p_delivery_date,p_delivery_slot,p_delivery_address,p_customer_notes,
  p_items,p_line_user_id,p_request_id);
 v_order_id:=(v_result->>'order_id')::uuid;
 UPDATE public.orders SET checkout_intent_hash=p_intent_hash
 WHERE id=v_order_id AND customer_id=p_customer_id AND ordered_by_line_user_id=p_line_user_id
 AND (checkout_intent_hash IS NULL OR checkout_intent_hash=p_intent_hash);
 IF NOT FOUND THEN RAISE EXCEPTION 'Grouped checkout retry intent does not match original order'; END IF;
 RETURN v_result;
END $group_v2$;

-- Never expose privileged retry/creation functions to client JWT roles.
REVOKE ALL ON FUNCTION public.lookup_checkout_order_retry(uuid,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_checkout_order_once_v2(
 uuid,uuid,text,date,text,text,text,jsonb,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_group_suborder_v2(
 uuid,bigint,date,text,text,text,jsonb,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_checkout_order_retry(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_checkout_order_once_v2(
 uuid,uuid,text,date,text,text,text,jsonb,uuid,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_group_suborder_v2(
 uuid,bigint,date,text,text,text,jsonb,uuid,uuid,text) TO service_role;
