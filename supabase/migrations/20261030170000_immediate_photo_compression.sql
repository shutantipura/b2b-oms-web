-- All order images are eligible for immediate compression, regardless of age/status.
-- Preserve all order records; 14-day final-group expiration and 7-day
-- final-group missing-timestamp exception apply to PHOTOS ONLY.
CREATE TABLE IF NOT EXISTS public.order_photo_retention_log (
  storage_path text PRIMARY KEY,
  order_file_id uuid NOT NULL,
  compressed_at timestamptz,
  original_size_bytes bigint,
  stored_size_bytes bigint,
  compression_note text,
  deleted_at timestamptz,
  last_attempt_at timestamptz DEFAULT now()
);
ALTER TABLE public.order_photo_retention_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_photo_retention_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.order_photo_retention_log TO service_role;

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
  and f.file_type in ('cart_photo','cart_photo_2','bill','payment_qr','payment_slip','delivery_proof','delivery_proof_2')
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
REVOKE ALL ON FUNCTION public.order_photo_retention_candidates(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.order_photo_retention_candidates(text,integer) TO service_role;
