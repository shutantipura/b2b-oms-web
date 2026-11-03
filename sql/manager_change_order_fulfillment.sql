-- Manager-only fulfillment change. No changes to already dispatched or paid orders.
CREATE OR REPLACE FUNCTION public.manager_change_order_fulfillment(
  p_order_number bigint,
  p_fulfillment_method text,
  p_delivery_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_manager_id uuid;
  v_order public.orders%ROWTYPE;
  v_member record;
  v_new_address text;
  v_next_status text;
  v_slot_start_text text;
  v_delivery_start timestamp;
  v_now_bangkok timestamp;
  v_count integer := 0;
BEGIN
  SELECT s.id INTO v_manager_id
  FROM public.staff s
  WHERE s.auth_user_id = (SELECT auth.uid())
    AND s.account_type = 'manager'
    AND s.is_active = true
  LIMIT 1;
  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;

  IF p_fulfillment_method NOT IN ('delivery','pickup') OR p_fulfillment_method IS NULL THEN
    RAISE EXCEPTION 'Select delivery or pickup';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE order_number = p_order_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % does not exist', p_order_number;
  END IF;
  IF v_order.group_root_order_id IS NOT NULL
     AND v_order.group_root_order_id <> v_order.id THEN
    RAISE EXCEPTION 'Change the fulfillment method on the group primary order';
  END IF;
  IF v_order.fulfillment_method = p_fulfillment_method THEN
    RAISE EXCEPTION 'Fulfillment method is unchanged';
  END IF;

  -- Serialize every active group member with picking, billing and task claims.
  PERFORM 1 FROM public.orders o
  WHERE o.id = v_order.id
     OR (o.group_root_order_id = v_order.id AND o.status <> 'cancelled')
  ORDER BY o.id
  FOR UPDATE;

  FOR v_member IN
    SELECT o.id,o.status,o.fulfillment_method,o.delivery_address
    FROM public.orders o
    WHERE o.id = v_order.id
       OR (o.group_root_order_id = v_order.id AND o.status <> 'cancelled')
    ORDER BY o.id
  LOOP
    IF v_member.fulfillment_method IS DISTINCT FROM v_order.fulfillment_method THEN
      RAISE EXCEPTION 'Group members have different fulfillment methods';
    END IF;
    IF v_member.status NOT IN (
      'awaiting_confirmation','awaiting_picking','picking','awaiting_billing',
      'ready_for_delivery','awaiting_payment'
    ) THEN
      RAISE EXCEPTION 'Fulfillment cannot change after dispatch, payment submission, or completion';
    END IF;
    IF v_member.status = 'ready_for_delivery'
       AND v_member.fulfillment_method <> 'delivery' THEN
      RAISE EXCEPTION 'Inconsistent delivery status for group member';
    END IF;
    IF v_member.status = 'awaiting_payment'
       AND v_member.fulfillment_method <> 'pickup' THEN
      RAISE EXCEPTION 'An already-delivered order cannot be converted to pickup';
    END IF;
  END LOOP;

  -- A grouped bill is a single post-billing workflow. The status sync
  -- trigger propagates changes from its primary order, so require every
  -- active member to have reached the same stage before switching it.
  IF v_order.group_root_order_id = v_order.id
     AND v_order.status IN ('ready_for_delivery','awaiting_payment')
     AND EXISTS (
       SELECT 1 FROM public.orders o
       WHERE o.group_root_order_id = v_order.id
         AND o.status <> 'cancelled'
         AND o.status <> v_order.status
     ) THEN
    RAISE EXCEPTION 'Grouped orders must be at the same post-billing stage';
  END IF;

  -- Do not strand a rider or payment verifier already handling this order.
  IF EXISTS (
    SELECT 1
    FROM public.task_claims tc
    JOIN public.orders o ON o.id = tc.order_id
    WHERE (o.id = v_order.id
       OR (o.group_root_order_id = v_order.id AND o.status <> 'cancelled'))
      AND tc.claim_status = 'active'
      AND tc.stage IN ('delivery','payment_verification')
  ) THEN
    RAISE EXCEPTION 'An active delivery or payment task must be finished or released first';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.order_files f
    JOIN public.orders o ON o.id = f.order_id
    WHERE (o.id = v_order.id
       OR (o.group_root_order_id = v_order.id AND o.status <> 'cancelled'))
      AND f.is_current = true
      AND f.file_type IN ('delivery_proof','delivery_proof_2','payment_slip','payment_slip_2')
  ) THEN
    RAISE EXCEPTION 'Fulfillment cannot change after delivery proof or payment slip submission';
  END IF;

  IF p_fulfillment_method = 'delivery' THEN
    v_new_address := NULLIF(btrim(COALESCE(p_delivery_address,'')),'');
    IF v_new_address IS NULL
       AND v_order.delivery_address IS NOT NULL
       AND btrim(v_order.delivery_address) <> 'รับสินค้าที่สาขา' THEN
      v_new_address := btrim(v_order.delivery_address);
    END IF;
    IF v_new_address IS NULL OR v_new_address = 'รับสินค้าที่สาขา' THEN
      RAISE EXCEPTION 'A real delivery address is required';
    END IF;
    IF length(v_new_address) > 1000 THEN
      RAISE EXCEPTION 'Delivery address is too long';
    END IF;

    -- Manager rescheduling enforces a two-hour lead time. Reuse that policy
    -- if a pickup becomes a delivery, even when the original slot is stale.
    v_slot_start_text := left(btrim(COALESCE(v_order.delivery_slot,'')),5);
    IF v_order.delivery_date IS NULL
       OR v_slot_start_text !~ '^[0-2][0-9]:[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Set a valid delivery date and time first';
    END IF;
    v_delivery_start := v_order.delivery_date + v_slot_start_text::time;
    v_now_bangkok := transaction_timestamp() AT TIME ZONE 'Asia/Bangkok';
    IF v_delivery_start < v_now_bangkok + interval '2 hours' THEN
      RAISE EXCEPTION 'Reschedule to a delivery slot at least two hours from now first';
    END IF;
  END IF;

  -- Each UPDATE and history write is in the same transaction. Group members
  -- remain consistent, and no completed picking, billing or photo work is lost.
  FOR v_member IN
    SELECT o.id,o.status,o.fulfillment_method,o.delivery_address
    FROM public.orders o
    WHERE o.id = v_order.id
       OR (o.group_root_order_id = v_order.id AND o.status <> 'cancelled')
    ORDER BY o.id
  LOOP
    v_next_status := CASE
      WHEN v_member.status = 'ready_for_delivery'
           AND p_fulfillment_method = 'pickup' THEN 'awaiting_payment'
      WHEN v_member.status = 'awaiting_payment'
           AND p_fulfillment_method = 'delivery' THEN 'ready_for_delivery'
      ELSE v_member.status
    END;

    UPDATE public.orders
    SET fulfillment_method = p_fulfillment_method,
        delivery_address = CASE
          WHEN p_fulfillment_method = 'delivery' THEN v_new_address
          ELSE delivery_address
        END,
        status = v_next_status,
        updated_at = now()
    WHERE id = v_member.id;

    INSERT INTO public.order_history (
      order_id,action,stage,from_status,to_status,performed_by_staff_id,note,details
    ) VALUES (
      v_member.id,'manager_changed_fulfillment',NULL,
      v_member.status,v_next_status,v_manager_id,
      'Manager changed pickup/delivery fulfillment',
      jsonb_build_object(
        'old_method',v_member.fulfillment_method,
        'new_method',p_fulfillment_method,
        'old_address',v_member.delivery_address,
        'new_address',CASE WHEN p_fulfillment_method='delivery'
          THEN v_new_address ELSE v_member.delivery_address END,
        'group_primary_order_number',p_order_number
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,'order_number',p_order_number,
    'fulfillment_method',p_fulfillment_method,
    'orders_updated',v_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_change_order_fulfillment(bigint,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_change_order_fulfillment(bigint,text,text)
  TO authenticated, service_role;
