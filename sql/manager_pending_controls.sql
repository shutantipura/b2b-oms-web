
-- Managers may amend pending orders only. Completed and cancelled bills are immutable.
CREATE OR REPLACE FUNCTION public.manager_adjust_final_amount(p_order_number bigint, p_new_amount numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_manager public.staff%rowtype;
  v_order public.orders%rowtype;
  v_reason text;
BEGIN
  SELECT * INTO v_manager FROM public.staff
  WHERE auth_user_id = auth.uid() AND is_active = true AND account_type = 'manager'
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manager access required'; END IF;
  IF p_new_amount IS NULL OR p_new_amount < 0 OR p_new_amount > 999999999.99 OR p_new_amount <> round(p_new_amount,2) THEN
    RAISE EXCEPTION 'Invalid final amount';
  END IF;
  v_reason := trim(coalesce(p_reason,''));
  IF v_reason = '' THEN RAISE EXCEPTION 'Adjustment reason is required'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE order_number = p_order_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % does not exist', p_order_number; END IF;
  IF v_order.status IN ('cancelled','completed') THEN RAISE EXCEPTION 'Cannot adjust a completed or cancelled order'; END IF;
  IF v_order.final_amount IS NULL THEN RAISE EXCEPTION 'Order has not been billed yet'; END IF;
  IF v_order.final_amount = p_new_amount THEN RAISE EXCEPTION 'New amount is unchanged'; END IF;
  UPDATE public.orders SET final_amount = p_new_amount, updated_at = now() WHERE id = v_order.id;
  INSERT INTO public.order_history (
    order_id,action,stage,from_status,to_status,performed_by_staff_id,note,details
  ) VALUES (
    v_order.id,'manager_adjusted_final_amount','billing',v_order.status,v_order.status,
    v_manager.id,'Final billed amount adjusted by Manager',
    jsonb_build_object('old_amount',v_order.final_amount,'new_amount',p_new_amount,'reason',v_reason,'manager_name',v_manager.staff_name)
  );
  RETURN jsonb_build_object('success',true,'order_number',p_order_number,'old_amount',v_order.final_amount,'new_amount',p_new_amount);
END;
$function$
;

-- Managers may rebook pending orders into the standard B2B delivery slots.
-- The selected slot must begin >= 2 hours after this transaction begins,
-- measured in Asia/Bangkok, and within the seven-date customer horizon.
CREATE OR REPLACE FUNCTION public.manager_reschedule_delivery(
  p_order_number bigint,
  p_delivery_date date,
  p_delivery_slot text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_manager_id uuid;
  v_order public.orders%rowtype;
  v_now_bkk timestamp;
  v_cutoff timestamp;
  v_first_date date;
  v_slot_start_min int;
  v_start timestamp;
  v_changed record;
  v_count int := 0;
BEGIN
  SELECT s.id INTO v_manager_id
  FROM public.staff s
  WHERE s.auth_user_id = (SELECT auth.uid())
    AND s.is_active = true AND s.account_type = 'manager'
  LIMIT 1;
  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders WHERE order_number = p_order_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % does not exist', p_order_number;
  END IF;
  IF v_order.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'Cannot reschedule a completed or cancelled order';
  END IF;
  IF v_order.group_root_order_id IS NOT NULL
     AND v_order.group_root_order_id <> v_order.id THEN
    RAISE EXCEPTION 'Reschedule the group primary order instead';
  END IF;
  IF p_delivery_date IS NULL OR p_delivery_slot IS NULL THEN
    RAISE EXCEPTION 'Delivery date and slot are required';
  END IF;

  v_slot_start_min := CASE p_delivery_slot
    WHEN '07:00–09:00' THEN 420
    WHEN '09:00–11:00' THEN 540
    WHEN '11:00–13:00' THEN 660
    WHEN '13:00–15:00' THEN 780
    WHEN '15:00–17:00' THEN 900
    ELSE NULL
  END;
  IF v_slot_start_min IS NULL THEN
    RAISE EXCEPTION 'Invalid delivery slot';
  END IF;

  v_now_bkk := transaction_timestamp() AT TIME ZONE 'Asia/Bangkok';
  v_cutoff := v_now_bkk + interval '2 hours';
  v_first_date := v_now_bkk::date;
  IF (v_first_date::timestamp + interval '15 hours') < v_cutoff THEN
    v_first_date := v_first_date + 1;
  END IF;
  IF p_delivery_date < v_first_date OR p_delivery_date > v_first_date + 6 THEN
    RAISE EXCEPTION 'Select a delivery date within the next seven available dates';
  END IF;
  v_start := p_delivery_date::timestamp + make_interval(mins => v_slot_start_min);
  IF v_start < v_cutoff THEN
    RAISE EXCEPTION 'Delivery slot must begin at least two hours after rescheduling';
  END IF;
  IF v_order.delivery_date = p_delivery_date
     AND v_order.delivery_slot = p_delivery_slot THEN
    RAISE EXCEPTION 'Delivery time is unchanged';
  END IF;

  -- Lock members before any changes; prevent a partially rescheduled group.
  PERFORM 1 FROM public.orders o
  WHERE o.group_root_order_id = v_order.id AND o.status <> 'cancelled'
  FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.group_root_order_id = v_order.id
      AND o.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Cannot reschedule a group with a completed suborder';
  END IF;

  FOR v_changed IN
    UPDATE public.orders o
    SET delivery_date = p_delivery_date,
        delivery_slot = p_delivery_slot,
        updated_at = now()
    WHERE o.id = v_order.id
       OR (o.group_root_order_id = v_order.id AND o.status <> 'cancelled')
    RETURNING o.id, o.status
  LOOP
    INSERT INTO public.order_history (
      order_id,action,stage,from_status,to_status,
      performed_by_staff_id,note,details
    ) VALUES (
      v_changed.id,'manager_rescheduled_delivery',null,
      v_changed.status,v_changed.status,v_manager_id,
      'Manager changed scheduled delivery',
      jsonb_build_object(
        'old_date',v_order.delivery_date,
        'old_slot',v_order.delivery_slot,
        'new_date',p_delivery_date,
        'new_slot',p_delivery_slot,
        'group_primary_order_number',p_order_number
      )
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object(
    'success',true,'order_number',p_order_number,
    'delivery_date',p_delivery_date,'delivery_slot',p_delivery_slot,
    'orders_updated',v_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_reschedule_delivery(bigint,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_reschedule_delivery(bigint,date,text) TO authenticated, service_role;
