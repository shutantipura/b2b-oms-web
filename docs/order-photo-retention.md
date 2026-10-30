# Lotus's B2B OMS — order photo retention

Photo policy (Bangkok local usage; intervals are exact elapsed hours):

- Compress order images at upload time, with no additional user action.
- Existing order images are eligible for server-side compression, including photos on open orders.
- QR image compression is lossless when practical; JPEG QR is not re-encoded.
- PDF bills and slips are not photo files and remain unchanged.
- Original order rows, quantities, statuses, staff tasks, and financial records remain forever.
- Delete **only photo objects and their order_files references** after 14 days following whole-group completion/cancellation.
- If the entire order/group is final but a terminal timestamp is missing, delete photos after the latest known or created timestamp becomes 7 days old.
- Preserve customer CV image folders and product images.
- Legacy files that cannot be verified against an order record are left untouched.

## Daily processing

Vercel Cron calls /api/cron/order-photo-retention at 19:00 UTC (02:00 Thailand time).
**Required before activation:** set production-only CRON_SECRET as a cryptographically random secret in the Vercel project environment and redeploy. Without it, the endpoint returns 503 and will NOT modify anything.

The job requires existing server-only SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_URL. Only service_role can execute order_photo_retention_candidates().
Every batch performs a fresh eligibility check immediately before replacement/deletion. Compression is in place to keep signed URLs and order-file paths consistent. Deletions occur via the official Supabase Storage API and only then remove order_files references. Any interrupted run resumes next day, and already missing objects can have their stale file reference removed.

## Verification

Use SQL to check eligible candidates without changing data:

```sql
SELECT 'compress' action, count(*) files, coalesce(sum(bytes),0) bytes
FROM public.order_photo_retention_candidates('compress',200)
UNION ALL
SELECT 'delete',count(*),coalesce(sum(bytes),0)
FROM public.order_photo_retention_candidates('delete',200);
```

Before enabling the cron, check real cart, bill and payment QR image outputs in live OMS; validate that bill text remains readable and QR codes scan. The backend refuses to run without CRON_SECRET.

This retention strategy is space-aware, not a promise of 80% reduction: existing losslessly encoded PNGs and small images may see little/no change.
