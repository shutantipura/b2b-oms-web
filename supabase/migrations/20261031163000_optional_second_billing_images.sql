-- Optional second image per bill and payment QR, preserving the first image and all existing orders.
-- Existing active-file uniqueness remains per (order_id,file_type): the two slots are independent.
alter table public.order_files drop constraint if exists order_files_file_type_check;
alter table public.order_files add constraint order_files_file_type_check
check (file_type in ('cart_photo','cart_photo_2','bill','bill_2','payment_qr','payment_qr_2','delivery_proof','delivery_proof_2','payment_slip'));
CREATE OR REPLACE FUNCTION public.register_my_order_file(p_order_number bigint, p_file_type text, p_storage_path text, p_original_filename text, p_mime_type text DEFAULT 'image/jpeg'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_order public.orders%rowtype;
 v_staff public.staff%rowtype;
 v_required_stage text;
 v_expected_prefix text;
 v_file_id uuid;
BEGIN
 SELECT * INTO v_staff FROM public.staff
 WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'No active staff account is linked to the logged-in user';
 END IF;
 SELECT * INTO v_order FROM public.orders
 WHERE order_number=p_order_number FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order % does not exist',p_order_number; END IF;
 CASE p_file_type
 WHEN 'cart_photo' THEN v_required_stage:='picking';
 WHEN 'cart_photo_2' THEN v_required_stage:='picking';
 WHEN 'bill' THEN v_required_stage:='billing';
 WHEN 'bill_2' THEN v_required_stage:='billing';
 WHEN 'payment_qr' THEN v_required_stage:='billing';
 WHEN 'payment_qr_2' THEN v_required_stage:='billing';
 WHEN 'delivery_proof' THEN v_required_stage:='delivery';
 WHEN 'delivery_proof_2' THEN v_required_stage:='delivery';
 ELSE RAISE EXCEPTION 'Invalid staff operational file type: %',p_file_type;
 END CASE;
 IF NOT EXISTS (
   SELECT 1 FROM public.task_claims tc
   WHERE tc.order_id=v_order.id AND tc.stage=v_required_stage
     AND tc.staff_id=v_staff.id AND tc.claim_status='active'
 ) THEN
   RAISE EXCEPTION '% does not own the active % task for Order %',
     v_staff.staff_name,v_required_stage,p_order_number;
 END IF;
 IF p_storage_path IS NULL OR trim(p_storage_path)='' THEN
   RAISE EXCEPTION 'Storage path is required';
 END IF;
 IF p_original_filename IS NULL OR trim(p_original_filename)='' THEN
   RAISE EXCEPTION 'Original filename is required';
 END IF;
 v_expected_prefix:='orders/'||p_order_number||'/'||p_file_type||'/';
 IF left(p_storage_path,length(v_expected_prefix))<>v_expected_prefix THEN
   RAISE EXCEPTION 'Storage path must begin with %',v_expected_prefix;
 END IF;
 UPDATE public.order_files SET is_current=false
 WHERE order_id=v_order.id AND file_type=p_file_type AND is_current=true;
 INSERT INTO public.order_files(
   order_id,file_type,storage_path,original_filename,mime_type,uploaded_by_staff_id,is_current
 ) VALUES(
   v_order.id,p_file_type,p_storage_path,p_original_filename,p_mime_type,v_staff.id,true
 ) RETURNING id INTO v_file_id;
 INSERT INTO public.order_history(order_id,action,stage,performed_by_staff_id,note,details)
 VALUES(
   v_order.id,'file_uploaded',v_required_stage,v_staff.id,p_file_type||' uploaded',
   jsonb_build_object('file_type',p_file_type,'storage_path',p_storage_path,'original_filename',p_original_filename)
 );
 RETURN jsonb_build_object(
   'success',true,'file_id',v_file_id,'order_number',p_order_number,
   'file_type',p_file_type,'uploaded_by',v_staff.staff_name,'storage_path',p_storage_path
 );
END;
$function$
;
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
      and not (g.done and (
        (not g.missing_time and g.end_time<=now()-interval '14 days')
        or (g.missing_time and g.end_time<=now()-interval '7 days')
      )))
   or (p_action='delete' and g.done and
      ((not g.missing_time and g.end_time<=now()-interval '14 days')
       or (g.missing_time and g.end_time<=now()-interval '7 days'))
      and s.id is not null and coalesce(s.metadata->>'mimetype',f.mime_type,'') like 'image/%')
   or (p_action='finalize_delete' and g.done and
      ((not g.missing_time and g.end_time<=now()-interval '14 days')
       or (g.missing_time and g.end_time<=now()-interval '7 days'))
      and s.id is null)
  )
order by g.end_time,f.storage_path
limit greatest(1,least(coalesce(p_limit,75),200));
$function$
;
