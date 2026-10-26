-- Manager-only post-completion recovery for temporary CV Card billing.
-- Preserve the original CV Card method, completed status, amount, and audit trail.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cv_card_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS cv_card_resolved_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.manager_resolve_cv_card_bill(
  p_order_number bigint,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_manager public.staff%rowtype;
  v_order public.orders%rowtype;
  v_file_id uuid;
  v_prefix text;
  v_suffix text;
  v_resolved_at timestamptz;
BEGIN
  SELECT * INTO v_manager
  FROM public.staff
  WHERE auth_user_id = (SELECT auth.uid())
    AND is_active = true AND account_type = 'manager'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE order_number = p_order_number
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % does not exist', p_order_number;
  END IF;
  IF v_order.status <> 'completed' OR NOT v_order.billing_account_suspended THEN
    RAISE EXCEPTION 'Only completed CV Card orders can receive a reprinted bill';
  END IF;

  IF p_original_filename IS NULL OR length(trim(p_original_filename)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Invalid bill filename';
  END IF;
  IF coalesce(lower(p_mime_type), '') NOT IN (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'
  ) THEN
    RAISE EXCEPTION 'Reprinted bill must be an image';
  END IF;
  v_prefix := 'orders/' || p_order_number || '/bill/reprint/';
  IF p_storage_path IS NULL OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Invalid reprinted bill storage path';
  END IF;
  v_suffix := substring(p_storage_path FROM length(v_prefix) + 1);
  IF v_suffix !~ '^[a-f0-9-]{36}\.(jpg|png|webp|heic|heif|avif)$' THEN
    RAISE EXCEPTION 'Invalid reprinted bill filename in storage';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'order-files' AND name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'Uploaded bill image was not found in Storage';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_files WHERE storage_path = p_storage_path
  ) THEN
    RAISE EXCEPTION 'This bill image was already registered';
  END IF;

  UPDATE public.order_files
  SET is_current = false
  WHERE order_id = v_order.id AND file_type = 'bill' AND is_current = true;

  INSERT INTO public.order_files (
    order_id, file_type, storage_path, original_filename,
    mime_type, uploaded_by_staff_id, is_current
  ) VALUES (
    v_order.id, 'bill', p_storage_path, trim(p_original_filename),
    lower(p_mime_type), v_manager.id, true
  ) RETURNING id INTO v_file_id;

  v_resolved_at := now();
  UPDATE public.orders
  SET cv_card_resolved_at = v_resolved_at,
      cv_card_resolved_by_staff_id = v_manager.id,
      updated_at = v_resolved_at
  WHERE id = v_order.id;

  INSERT INTO public.order_history (
    order_id, action, stage, from_status, to_status,
    performed_by_staff_id, note, details
  ) VALUES (
    v_order.id, 'cv_card_bill_resolved', 'billing', 'completed', 'completed',
    v_manager.id, 'Reprinted bill uploaded after completion; CV Card issue resolved',
    jsonb_build_object(
      'file_id', v_file_id,
      'storage_path', p_storage_path,
      'original_filename', trim(p_original_filename),
      'manager_name', v_manager.staff_name,
      'previously_resolved_at', v_order.cv_card_resolved_at
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'file_id', v_file_id,
    'resolved_at', v_resolved_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manager_resolve_cv_card_bill(bigint,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manager_resolve_cv_card_bill(bigint,text,text,text)
  TO authenticated;
