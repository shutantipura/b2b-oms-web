-- Staff-uploaded slips are accepted immediately; customer-uploaded slips
-- remain payment_submitted until verify_my_payment is called by staff.
-- The previous global auto-complete trigger remains removed.
CREATE OR REPLACE FUNCTION public.submit_payment_slip_as_staff(
  p_order_number bigint,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text DEFAULT 'image/jpeg'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff_id uuid;
  v_staff_code text;
  v_order_id uuid;
  v_status text;
  v_final_amount numeric;
BEGIN
  v_staff_code := public.current_staff_code();
  IF v_staff_code IS NULL THEN
    RAISE EXCEPTION 'No active staff account is linked to the logged-in user';
  END IF;

  SELECT s.id INTO v_staff_id
  FROM public.staff s
  WHERE s.staff_code = v_staff_code
    AND s.auth_user_id = (SELECT auth.uid())
    AND s.is_active = true;
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Staff account is not authorized';
  END IF;

  SELECT o.id, o.status, o.final_amount
  INTO v_order_id, v_status, v_final_amount
  FROM public.orders o
  WHERE o.order_number = p_order_number
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order % does not exist', p_order_number;
  END IF;
  IF v_status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Staff may submit payment only while awaiting_payment; current status: %', v_status;
  END IF;
  IF v_final_amount IS NULL THEN
    RAISE EXCEPTION 'A final bill amount is required before completing payment';
  END IF;

  -- The existing function registers the current slip, records the staff actor,
  -- and temporarily moves status to payment_submitted within this transaction.
  PERFORM public.submit_payment_slip(
    p_order_number, 'staff', v_staff_code,
    p_storage_path, p_original_filename, p_mime_type
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.order_files f
    WHERE f.order_id = v_order_id
      AND f.file_type = 'payment_slip'
      AND f.is_current = true
      AND f.uploaded_by_staff_id = v_staff_id
  ) THEN
    RAISE EXCEPTION 'A current payment slip uploaded by this staff member is required';
  END IF;

  UPDATE public.orders
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = v_order_id
    AND status = 'payment_submitted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment status changed unexpectedly';
  END IF;

  INSERT INTO public.order_history (
    order_id, action, stage, from_status, to_status,
    performed_by_staff_id, note, details
  ) VALUES (
    v_order_id, 'staff_payment_accepted', 'payment_verification',
    'payment_submitted', 'completed', v_staff_id,
    'Staff uploaded payment slip; completed without separate verification',
    jsonb_build_object(
      'final_amount', v_final_amount,
      'verification_mode', 'staff_submitted'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'new_status', 'completed',
    'actor_type', 'staff'
  );
END;
$function$;

-- Keep calling permission limited to the existing authenticated staff wrapper.
REVOKE ALL ON FUNCTION public.submit_payment_slip_as_staff(bigint,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_payment_slip_as_staff(bigint,text,text,text) TO authenticated, service_role;
