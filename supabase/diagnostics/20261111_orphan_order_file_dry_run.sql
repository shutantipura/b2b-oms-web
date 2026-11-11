-- READ ONLY: candidate orphan objects inside the order-files bucket.
-- Excludes customer-cv images and excludes recent uploads (< 48 hours),
-- which may still be in-flight or awaiting a database record.
-- A missing order_files record alone is not approval to delete any image.
WITH unlinked AS (
  SELECT
    s.name AS storage_path,
    s.created_at,
    COALESCE((s.metadata->>'size')::bigint, 0) AS bytes
  FROM storage.objects s
  WHERE s.bucket_id = 'order-files'
    AND s.name LIKE 'orders/%'
    AND s.created_at < now() - interval '48 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.order_files f
      WHERE f.storage_path = s.name
    )
)
SELECT
  CASE WHEN created_at < now() - interval '14 days'
    THEN 'older_than_14_days'
    ELSE '48_hours_to_14_days'
  END AS age_group,
  count(*) AS object_count,
  round(sum(bytes)::numeric / 1024 / 1024, 2) AS size_mb,
  array_agg(storage_path ORDER BY created_at, storage_path) AS paths_for_manual_review
FROM unlinked
GROUP BY 1
ORDER BY 1;
