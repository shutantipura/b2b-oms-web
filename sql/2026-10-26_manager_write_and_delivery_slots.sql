-- High-priority security and delivery-window alignment (26 October 2026).
-- Matches the seven slots in lib/deliveryRules.ts.
-- Non-managers retain catalogue read access and existing task permissions.
BEGIN;

-- Restrict all existing authenticated write policies to active Managers.
-- Altering policies preserves their names and avoids destructive policy drops.
ALTER POLICY "authenticated users can insert products"
ON public.products WITH CHECK ((SELECT public.is_manager()));

ALTER POLICY "authenticated users can update products"
ON public.products
USING ((SELECT public.is_manager()))
WITH CHECK ((SELECT public.is_manager()));

-- Existing Manager policies remain, but these old broad policies no longer bypass them.
ALTER POLICY "authenticated users can insert customer prices"
ON public.customer_prices WITH CHECK ((SELECT public.is_manager()));

ALTER POLICY "authenticated users can update customer prices"
ON public.customer_prices
USING ((SELECT public.is_manager()))
WITH CHECK ((SELECT public.is_manager()));

ALTER POLICY "authenticated users can delete customer prices"
ON public.customer_prices
USING ((SELECT public.is_manager()));

-- Retain the manager-only check, pending-order constraints, two-hour cutoff,
-- grouped-order updates and audit history from the current live function.

CREATE OR REPLACE FUNCTION public.manager_reschedule_delivery(p_order_number bigint, p_delivery_date date, p_delivery_slot text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_manager_id uuid;
  v_order public.orders%rowtype;
  v_now_bkk timestamp;
  v_cutoff timestamp;
  v_first_date date;
  v_slot_start_min int;
  v_slot_end timestamp;
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
    WHEN '17:00–19:00' THEN 1020
    WHEN '19:00–21:00' THEN 1140
    ELSE NULL
  END;
  IF v_slot_start_min IS NULL THEN
    RAISE EXCEPTION 'Invalid delivery slot';
  END IF;

  v_now_bkk := transaction_timestamp() AT TIME ZONE 'Asia/Bangkok';
  v_cutoff := v_now_bkk + interval '2 hours';
  v_first_date := v_now_bkk::date;
  IF (v_first_date::timestamp + interval '21 hours') <= v_cutoff THEN
    v_first_date := v_first_date + 1;
  END IF;
  IF p_delivery_date < v_first_date OR p_delivery_date > v_first_date + 6 THEN
    RAISE EXCEPTION 'Select a delivery date within the next seven available dates';
  END IF;
  v_slot_end := p_delivery_date::timestamp + make_interval(mins => v_slot_start_min + 120);
  IF v_slot_end <= v_cutoff THEN
    RAISE EXCEPTION 'Delivery slot must contain delivery time later than the two-hour preparation cutoff';
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

-- Preserve the existing least-privilege function execution model.
REVOKE ALL ON FUNCTION public.manager_reschedule_delivery(bigint, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_reschedule_delivery(bigint, date, text) TO authenticated;

COMMIT;
