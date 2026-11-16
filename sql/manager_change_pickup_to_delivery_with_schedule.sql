-- Atomic Manager pickup-to-delivery conversion with a new delivery window.
CREATE OR REPLACE FUNCTION public.manager_change_pickup_to_delivery_with_schedule(
  p_order_number bigint, p_delivery_address text,
  p_delivery_date date, p_delivery_slot text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_start timestamp;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff s
    WHERE s.auth_user_id = (SELECT auth.uid())
      AND s.account_type='manager' AND s.is_active=true) THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;
  SELECT * INTO v_order FROM public.orders
  WHERE order_number=p_order_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order does not exist'; END IF;
  IF v_order.fulfillment_method <> 'pickup'
     OR v_order.status NOT IN (
       'awaiting_confirmation','awaiting_picking','picking',
       'awaiting_billing','awaiting_payment'
     ) THEN
    RAISE EXCEPTION 'Pickup-to-delivery change is not allowed at this stage';
  END IF;
  -- Only the shop's existing saved delivery points may be selected.
  -- Revalidate within the transaction: client options may be stale.
  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = v_order.customer_id
      AND btrim(COALESCE(p_delivery_address,'')) = ANY(ARRAY[
        COALESCE(NULLIF(btrim(c.delivery_map_url),''),
                 NULLIF(btrim(c.delivery_address),'')),
        NULLIF(btrim(c.delivery_map_url_2),'')
      ])
  ) THEN
    RAISE EXCEPTION 'Select a delivery location saved on this shop first';
  END IF;
  IF p_delivery_date IS NULL OR p_delivery_slot IS NULL
     OR p_delivery_slot NOT IN (
       '07:00–09:00','09:00–11:00','11:00–13:00','13:00–15:00',
       '15:00–17:00','17:00–19:00','19:00–21:00'
     ) THEN
    RAISE EXCEPTION 'Choose a valid delivery date and window';
  END IF;
  v_start := p_delivery_date::timestamp + left(p_delivery_slot,5)::time;
  -- Match Manager rescheduling: the current slot is valid until its END.
  IF v_start + interval '2 hours' <= (transaction_timestamp() AT TIME ZONE 'Asia/Bangkok') THEN
    RAISE EXCEPTION 'The selected delivery window has already ended';
  END IF;

  -- Both RPCs, and their audit writes, commit or roll back together.
  IF v_order.delivery_date IS DISTINCT FROM p_delivery_date
    OR v_order.delivery_slot IS DISTINCT FROM p_delivery_slot THEN
    PERFORM public.manager_reschedule_delivery(
      p_order_number,p_delivery_date,p_delivery_slot);
  END IF;
  v_result := public.manager_change_order_fulfillment(
    p_order_number,'delivery',p_delivery_address);
  RETURN v_result || jsonb_build_object(
    'delivery_date',p_delivery_date,'delivery_slot',p_delivery_slot,
    'new_status',CASE WHEN v_order.status='awaiting_payment'
                  THEN 'ready_for_delivery' ELSE v_order.status END);
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_change_pickup_to_delivery_with_schedule(bigint,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_change_pickup_to_delivery_with_schedule(bigint,text,date,text) TO authenticated;
