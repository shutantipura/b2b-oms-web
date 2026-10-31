-- Optional second payment slip, staff pre-confirmation and manager retrospective edits.
-- Do not change payment status, order amounts, task stages or the billing record.
ALTER TABLE public.order_files DROP CONSTRAINT IF EXISTS order_files_file_type_check;
ALTER TABLE public.order_files ADD CONSTRAINT order_files_file_type_check CHECK (
  file_type IN ('cart_photo','cart_photo_2','bill','bill_2','payment_qr','payment_qr_2',
     'delivery_proof','delivery_proof_2','payment_slip','payment_slip_2')
);

CREATE OR REPLACE FUNCTION public.attach_additional_payment_slip(
 p_order_number bigint, p_file_type text, p_storage_path text,
 p_original_filename text, p_mime_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
  IF v_staff.account_type='manager' THEN
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
    IF v_order.status NOT IN ('awaiting_payment','payment_submitted') THEN
      RAISE EXCEPTION 'Payment task is no longer pending';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.task_claims c
      WHERE c.order_id=v_order.id AND c.stage='payment_verification'
        AND c.staff_id=v_staff.id AND c.claim_status='active'
    ) THEN RAISE EXCEPTION 'Active payment task ownership required'; END IF;
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
$function$;
REVOKE ALL ON FUNCTION public.attach_additional_payment_slip(bigint,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attach_additional_payment_slip(bigint,text,text,text,text)
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
  and f.file_type in ('cart_photo','cart_photo_2','bill','bill_2','payment_qr','payment_qr_2','payment_slip','payment_slip_2','delivery_proof','delivery_proof_2')
  and (
   (p_action='compress' and s.id is not null
      and coalesce(s.metadata->>'mimetype',f.mime_type,'') like 'image/%'
      and l.compressed_at is null
      -- Compress even live and recent orders, but never mutate images already expired.
      and not (g.done and ((not g.missing_time and g.end_time<=now()-interval '14 days')
       or (g.missing_time and g.end_time<=now()-interval '7 days')) and not ((
        f.storage_path like 'orders/'||g.order_number::text||'/bill/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/bill_2/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/payment_slip/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/payment_slip_2/manager/%'
      ) and f.created_at > now()-interval '14 days')))
   or (p_action='delete' and g.done and
      ((not g.missing_time and g.end_time<=now()-interval '14 days')
       or (g.missing_time and g.end_time<=now()-interval '7 days')) and not ((
        f.storage_path like 'orders/'||g.order_number::text||'/bill/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/bill_2/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/payment_slip/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/payment_slip_2/manager/%'
      ) and f.created_at > now()-interval '14 days')
      and s.id is not null and coalesce(s.metadata->>'mimetype',f.mime_type,'') like 'image/%')
   or (p_action='finalize_delete' and g.done and
      ((not g.missing_time and g.end_time<=now()-interval '14 days')
       or (g.missing_time and g.end_time<=now()-interval '7 days')) and not ((
        f.storage_path like 'orders/'||g.order_number::text||'/bill/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/bill_2/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/payment_slip/manager/%'
        or f.storage_path like 'orders/'||g.order_number::text||'/payment_slip_2/manager/%'
      ) and f.created_at > now()-interval '14 days')
      and s.id is null)
  )
order by g.end_time,f.storage_path
limit greatest(1,least(coalesce(p_limit,75),200));
$function$
;
REVOKE ALL ON FUNCTION public.order_photo_retention_candidates(text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.order_photo_retention_candidates(text,integer)
  TO service_role;
