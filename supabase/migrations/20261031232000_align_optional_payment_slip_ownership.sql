-- Align optional slip 2 with required slip 1 authorization during awaiting_payment.
-- Manager retrospective uploads require no active task claim.
-- Staff adding to submitted customer payments must own verification task.
-- No order state / payment amount updates.
CREATE OR REPLACE FUNCTION public.attach_additional_payment_slip(p_order_number bigint, p_file_type text, p_storage_path text, p_original_filename text, p_mime_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_staff public.staff%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_prefix text;
  v_suffix text;
  v_extension text;
  v_file_id uuid;
  v_previous_id uuid;
  v_size bigint;
  v_actor text;
BEGIN
  SELECT * INTO v_staff FROM public.staff
    WHERE auth_user_id=(SELECT auth.uid()) AND is_active=true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active staff session required'; END IF;
  SELECT * INTO v_order FROM public.orders
    WHERE order_number=p_order_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.group_root_order_id IS NOT NULL AND v_order.group_root_order_id<>v_order.id THEN
    RAISE EXCEPTION 'Upload payment evidence on the grouped parent order';
  END IF;
  IF p_file_type IS NULL OR p_file_type NOT IN ('payment_slip','payment_slip_2') THEN
    RAISE EXCEPTION 'Invalid payment slip slot';
  END IF;
  -- A manager may attach evidence retrospectively without task ownership.
  -- When they submit an optional slip during ordinary awaiting_payment,
  -- follow the same claim-free pre-payment authorization as slip 1.
  IF v_staff.account_type='manager' AND v_order.status IN ('completed','payment_submitted') THEN
    v_actor:='manager';
    IF v_order.status NOT IN ('completed','payment_submitted') THEN
      RAISE EXCEPTION 'Manager can add retrospective slips only after payment submission';
    END IF;
    IF v_order.final_amount IS NULL THEN RAISE EXCEPTION 'Bill amount missing'; END IF;
  ELSE
    v_actor:='staff';
    IF p_file_type<>'payment_slip_2' THEN
      RAISE EXCEPTION 'Staff may only attach optional payment slip 2';
    END IF;
    IF v_order.status = 'awaiting_payment' THEN
      -- Same rule as submit_payment_slip_as_staff (the required first slip):
      -- an active authenticated staff account and a billed order suffice.
      -- Claim ownership is not required before a payment task exists.
      IF v_order.final_amount IS NULL THEN
        RAISE EXCEPTION 'A final bill amount is required before attaching a payment slip';
      END IF;
    ELSIF v_order.status = 'payment_submitted' THEN
      -- Customer has submitted evidence; staff verification is a claimed task.
      -- Managers were handled above and require no active task claim.
      IF NOT EXISTS (
        SELECT 1 FROM public.task_claims c
        WHERE c.order_id=v_order.id AND c.stage='payment_verification'
          AND c.staff_id=v_staff.id AND c.claim_status='active'
      ) THEN
        RAISE EXCEPTION 'Claim the payment verification task before adding slip 2';
      END IF;
    ELSE
      RAISE EXCEPTION 'Payment task is no longer pending';
    END IF;
  END IF;
  IF p_original_filename IS NULL OR length(trim(p_original_filename)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Invalid filename'; END IF;
  IF lower(coalesce(p_mime_type,'')) NOT IN (
    'image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif'
  ) THEN RAISE EXCEPTION 'Payment slip must be an image'; END IF;
  v_extension := CASE lower(p_mime_type)
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp'
    WHEN 'image/heic' THEN 'heic'
    WHEN 'image/heif' THEN 'heif'
    WHEN 'image/avif' THEN 'avif'
  END;
  v_prefix:='orders/'||p_order_number||'/'||p_file_type||'/'||v_actor||'/';
  IF p_storage_path IS NULL OR left(p_storage_path,length(v_prefix))<>v_prefix THEN
    RAISE EXCEPTION 'Invalid storage path'; END IF;
  v_suffix:=substring(p_storage_path from length(v_prefix)+1);
  IF v_suffix !~ ('^[a-f0-9-]{36}\.'||v_extension||'$') THEN
    RAISE EXCEPTION 'Invalid storage filename'; END IF;
  SELECT (metadata->>'size')::bigint INTO v_size FROM storage.objects
    WHERE bucket_id='order-files' AND name=p_storage_path
      AND lower(coalesce(metadata->>'mimetype',''))=lower(p_mime_type)
    LIMIT 1;
  IF v_size IS NULL OR v_size<1 OR v_size>15*1024*1024 THEN
    RAISE EXCEPTION 'Uploaded image missing or larger than 15 MB'; END IF;
  IF EXISTS(SELECT 1 FROM public.order_files WHERE storage_path=p_storage_path) THEN
    RAISE EXCEPTION 'Image already registered'; END IF;
  SELECT id INTO v_previous_id FROM public.order_files
    WHERE order_id=v_order.id AND file_type=p_file_type AND is_current=true LIMIT 1;
  UPDATE public.order_files SET is_current=false
    WHERE order_id=v_order.id AND file_type=p_file_type AND is_current=true;
  INSERT INTO public.order_files(
     order_id,file_type,storage_path,original_filename,
     mime_type,uploaded_by_staff_id,is_current
  ) VALUES(
     v_order.id,p_file_type,p_storage_path,trim(p_original_filename),
     lower(p_mime_type),v_staff.id,true
  ) RETURNING id INTO v_file_id;
  INSERT INTO public.order_history(
    order_id,action,stage,from_status,to_status,performed_by_staff_id,note,details
  ) VALUES(
    v_order.id, CASE WHEN v_actor='manager' THEN 'manager_payment_slip_added'
                     ELSE 'staff_secondary_payment_slip_added' END,
    'payment_verification',v_order.status,v_order.status,v_staff.id,
    'Payment slip photo added without changing order/payment status',
    jsonb_build_object('file_id',v_file_id,'file_type',p_file_type,
      'storage_path',p_storage_path,'previous_file_id',v_previous_id,
      'filename',trim(p_original_filename),'manager_name',v_staff.staff_name)
  );
  RETURN jsonb_build_object('success',true,'file_id',v_file_id,
     'order_number',p_order_number,'file_type',p_file_type,
     'status_unchanged',v_order.status);
END;
$function$
;
REVOKE ALL ON FUNCTION public.attach_additional_payment_slip(bigint,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attach_additional_payment_slip(bigint,text,text,text,text)
  TO authenticated,service_role;
