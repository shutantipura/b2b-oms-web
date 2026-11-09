-- CV Card is resolved when the first real bill is registered by a manager
-- after billing, without waiting for delivery and payment to complete.
-- Keep the existing manager check, file validation, audit and amount safeguards.
DO $migration$
DECLARE
  v_definition text;
  v_before text := 'IF p_file_type=''bill'' AND v_order.status=''completed''';
  v_after text := 'IF p_file_type=''bill'' AND v_order.status IN (''ready_for_delivery'',''out_for_delivery'',''awaiting_payment'',''payment_submitted'',''completed'')';
BEGIN
  SELECT pg_get_functiondef(
    'public.manager_upload_order_bill_photo(bigint,text,text,text,text)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Manager bill upload function does not exist';
  END IF;

  IF position(v_before IN v_definition) > 0 THEN
    EXECUTE replace(v_definition, v_before, v_after);
  ELSIF position(v_after IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected manager bill upload function; refusing unsafe replacement';
  END IF;
END
$migration$;

-- This is a SECURITY DEFINER RPC. Preserve the original authorization scope.
REVOKE ALL ON FUNCTION public.manager_upload_order_bill_photo(bigint,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_upload_order_bill_photo(bigint,text,text,text,text)
  TO authenticated, service_role;

-- One-time, idempotent repair: #210 had a verified manager-uploaded reprinted
-- bill after billing at 20:02 ICT, then reached completed at 20:19 ICT.
-- The old rule incorrectly left the flag unresolved because the upload came
-- before full completion. Never modify amount, payment, or task status.
WITH verified_bill AS (
  SELECT
    o.id AS order_id,
    o.order_number,
    f.id AS bill_file_id,
    f.uploaded_by_staff_id,
    f.original_filename,
    f.created_at AS bill_uploaded_at
  FROM public.orders o
  JOIN public.order_files f ON f.order_id = o.id
  JOIN public.staff s ON s.id = f.uploaded_by_staff_id
  WHERE o.order_number = 210
    AND o.status = 'completed'
    AND o.billing_account_suspended = true
    AND o.cv_card_resolved_at IS NULL
    AND o.final_amount IS NOT NULL
    AND f.file_type = 'bill'
    AND f.is_current = true
    AND f.original_filename = 'IMG_3205.jpeg'
    AND f.storage_path = 'orders/210/bill/manager/cd4702bc-ccc5-4550-9794-e2f5d512c926.jpg'
    AND s.account_type = 'manager'
    AND EXISTS (
      SELECT 1 FROM public.order_history h
      WHERE h.order_id = o.id AND h.action = 'billing_completed'
        AND h.created_at <= f.created_at
    )
    AND EXISTS (
      SELECT 1 FROM storage.objects so
      WHERE so.bucket_id = 'order-files' AND so.name = f.storage_path
    )
), resolved AS (
  UPDATE public.orders o
  SET cv_card_resolved_at = now(),
      cv_card_resolved_by_staff_id = v.uploaded_by_staff_id,
      updated_at = now()
  FROM verified_bill v
  WHERE o.id = v.order_id AND o.cv_card_resolved_at IS NULL
  RETURNING o.id, o.order_number, o.cv_card_resolved_at
)
INSERT INTO public.order_history (
  order_id, action, stage, from_status, to_status,
  performed_by_staff_id, note, details
)
SELECT
  r.id, 'cv_card_bill_resolved', 'billing', 'completed', 'completed',
  NULL, 'System reconciled a manager bill uploaded after billing but before order completion',
  jsonb_build_object(
    'reconciled', true,
    'bill_file_id', v.bill_file_id,
    'original_filename', v.original_filename,
    'bill_uploaded_at', v.bill_uploaded_at,
    'original_manager_id', v.uploaded_by_staff_id,
    'cv_card_resolved', true
  )
FROM resolved r
JOIN verified_bill v ON v.order_id = r.id;
