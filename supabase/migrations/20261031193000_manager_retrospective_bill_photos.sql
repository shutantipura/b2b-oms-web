-- Manager can attach bill slots 1/2 even after billing and full order completion.
-- Retrospectively uploaded bill photos are retained at least 14 days from upload.
-- The existing order financials, task state, quantities and delivery status remain unchanged.
CREATE OR REPLACE FUNCTION public.manager_upload_order_bill_photo(
    p_order_number bigint,
    p_file_type text,
    p_storage_path text,
    p_original_filename text,
    p_mime_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_manager public.staff%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_file_id uuid;
  v_previous_id uuid;
  v_prefix text;
  v_suffix text;
  v_expected_extension text;
  v_size bigint;
  v_cv_resolved boolean := false;
BEGIN
  SELECT * INTO v_manager FROM public.staff
  WHERE auth_user_id = (SELECT auth.uid()) AND is_active = true AND account_type = 'manager'
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manager access required'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE order_number = p_order_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF v_order.group_root_order_id IS NOT NULL AND v_order.group_root_order_id <> v_order.id THEN
    RAISE EXCEPTION 'Upload a bill to the parent order, not a grouped child';
  END IF;

  -- Billing must already have finished. Never let a photo upload complete a task or alter money.
  IF v_order.final_amount IS NULL
     OR NOT (
       EXISTS (SELECT 1 FROM public.order_history
               WHERE order_id = v_order.id AND action = 'billing_completed')
       OR v_order.status IN ('ready_for_delivery','out_for_delivery','awaiting_payment',
                             'payment_submitted','completed')
       OR (v_order.status = 'cancelled' AND v_order.final_amount IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'Bill photos can only be added after billing is completed';
  END IF;

  IF p_file_type NOT IN ('bill','bill_2') OR p_file_type IS NULL THEN
    RAISE EXCEPTION 'Only bill and bill_2 are supported';
  END IF;
  IF p_original_filename IS NULL OR length(trim(p_original_filename)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Invalid original filename';
  END IF;

  IF lower(coalesce(p_mime_type,'')) NOT IN (
    'image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif'
  ) THEN
    RAISE EXCEPTION 'A bill image (JPG, PNG, WEBP, HEIC or AVIF) is required';
  END IF;
  v_expected_extension := CASE lower(p_mime_type)
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp'
    WHEN 'image/heic' THEN 'heic'
    WHEN 'image/heif' THEN 'heif'
    WHEN 'image/avif' THEN 'avif'
  END;
  v_prefix := 'orders/' || p_order_number || '/' || p_file_type || '/manager/';
  IF p_storage_path IS NULL OR left(p_storage_path,length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Invalid manager bill image storage path';
  END IF;
  v_suffix := substring(p_storage_path from length(v_prefix)+1);
  IF v_suffix !~ ('^[a-f0-9-]{36}\.'||v_expected_extension||'$') THEN
    RAISE EXCEPTION 'Invalid storage filename';
  END IF;

  SELECT (metadata->>'size')::bigint INTO v_size
  FROM storage.objects
  WHERE bucket_id = 'order-files'
    AND name = p_storage_path
    AND lower(coalesce(metadata->>'mimetype','')) = lower(p_mime_type)
  LIMIT 1;
  IF v_size IS NULL OR v_size < 1 OR v_size > 15*1024*1024 THEN
    RAISE EXCEPTION 'Uploaded image missing or larger than 15 MB';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_files WHERE storage_path = p_storage_path) THEN
    RAISE EXCEPTION 'Image was already registered';
  END IF;

  SELECT id INTO v_previous_id FROM public.order_files
  WHERE order_id=v_order.id AND file_type=p_file_type AND is_current=true LIMIT 1;
  UPDATE public.order_files SET is_current=false
  WHERE order_id=v_order.id AND file_type=p_file_type AND is_current=true;

  INSERT INTO public.order_files (
    order_id,file_type,storage_path,original_filename,mime_type,uploaded_by_staff_id,is_current
  ) VALUES (
    v_order.id,p_file_type,p_storage_path,trim(p_original_filename),lower(p_mime_type),v_manager.id,true
  ) RETURNING id INTO v_file_id;

  -- Keep the existing CV Card resolution behavior when a manager supplies its first real bill.
  IF p_file_type='bill' AND v_order.status='completed'
     AND v_order.billing_account_suspended AND v_order.cv_card_resolved_at IS NULL THEN
    UPDATE public.orders
    SET cv_card_resolved_at = now(), cv_card_resolved_by_staff_id=v_manager.id,
        updated_at=now()
    WHERE id=v_order.id;
    v_cv_resolved := true;
  END IF;

  INSERT INTO public.order_history (
    order_id,action,stage,from_status,to_status,performed_by_staff_id,note,details
  ) VALUES (
    v_order.id,
    CASE WHEN v_cv_resolved THEN 'cv_card_bill_resolved' ELSE 'manager_bill_photo_added' END,
    'billing',v_order.status,v_order.status,v_manager.id,
    CASE WHEN v_cv_resolved THEN 'Manager added bill after completion and resolved CV Card'
         ELSE 'Manager uploaded or replaced a bill photo after billing completion' END,
    jsonb_build_object(
      'file_type',p_file_type,'file_id',v_file_id,'storage_path',p_storage_path,
      'original_filename',trim(p_original_filename),'previous_file_id',v_previous_id,
      'manager_name',v_manager.staff_name,'cv_card_resolved',v_cv_resolved
    )
  );

  RETURN jsonb_build_object(
    'success',true,'order_number',p_order_number,'file_type',p_file_type,
    'file_id',v_file_id,'cv_card_resolved',v_cv_resolved
  );
END
$function$;

REVOKE ALL ON FUNCTION public.manager_upload_order_bill_photo(bigint,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manager_upload_order_bill_photo(bigint,text,text,text,text)
  TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.order_photo_retention_candidates(p_action text, p_limit integer DEFAULT 75)
 RETURNS TABLE(file_id uuid, storage_path text, file_type text, mime_type text, bytes bigint, finished_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
with grouped as (
select coalesce(group_root_order_id,id) gid,
bool_and(status in ('completed','cancelled')) done,
bool_or(case when status='completed' then completed_at is null when status='cancelled' then cancelled_at is null else true end) missing_time,
max(case when status='completed' then coalesce(completed_at,created_at)
         when status='cancelled' then coalesce(cancelled_at,created_at)
         else created_at end) end_time
from public.orders group by 1
), eligible as (
select o.id,o.order_number,g.done,g.missing_time,g.end_time
from public.orders o join grouped g on g.gid=coalesce(o.group_root_order_id,o.id)
)
select f.id,f.storage_path,f.file_type,
 coalesce(s.metadata->>'mimetype',f.mime_type,'')::text,
 case when coalesce(s.metadata->>'size','') ~ '^[0-9]+$' then (s.metadata->>'size')::bigint end,
 g.end_time
from public.order_files f join eligible g on f.order_id=g.id
left join storage.objects s on s.bucket_id='order-files' and s.name=f.storage_path
left join public.order_photo_retention_log l on l.storage_path=f.storage_path
where g.end_time is not null
  and f.storage_path like 'orders/'||g.order_number::text||'/%'
  and f.file_type in ('cart_photo','cart_photo_2','bill','bill_2','payment_qr','payment_qr_2','payment_slip','delivery_proof','delivery_proof_2')
  and (
   (p_action='compress' and s.id is not null
      and coalesce(s.metadata->>'mimetype',f.mime_type,'') like 'image/%'
      and l.compressed_at is null
      -- Compress even live and recent orders, but never mutate images already expired.
      and not (g.done and ((not g.missing_time and g.end_time<=now()-interval '14 days')
       or (g.missing_time and g.end_time<=now()-interval '7 days')) and not ((
        f.storage_path like 'orders/'||g.order_number::text||'/bill/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/bill_2/manager/%'
      ) and f.created_at > now()-interval '14 days')))
   or (p_action='delete' and g.done and
      ((not g.missing_time and g.end_time<=now()-interval '14 days')
       or (g.missing_time and g.end_time<=now()-interval '7 days')) and not ((
        f.storage_path like 'orders/'||g.order_number::text||'/bill/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/bill_2/manager/%'
      ) and f.created_at > now()-interval '14 days')
      and s.id is not null and coalesce(s.metadata->>'mimetype',f.mime_type,'') like 'image/%')
   or (p_action='finalize_delete' and g.done and
      ((not g.missing_time and g.end_time<=now()-interval '14 days')
       or (g.missing_time and g.end_time<=now()-interval '7 days')) and not ((
        f.storage_path like 'orders/'||g.order_number::text||'/bill/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/bill_2/manager/%'
      ) and f.created_at > now()-interval '14 days')
      and s.id is null)
  )
order by g.end_time,f.storage_path
limit greatest(1,least(coalesce(p_limit,75),200));
$function$
;
REVOKE ALL ON FUNCTION public.order_photo_retention_candidates(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.order_photo_retention_candidates(text,integer) TO service_role;
