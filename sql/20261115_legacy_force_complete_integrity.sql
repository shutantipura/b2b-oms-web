-- Reconcile historic Manager manual closes from immutable order_history events.
-- They are NOT sales bills. No price, status, task, or payment data is inferred.
WITH historical AS (
  SELECT DISTINCT ON (h.order_id)
    h.order_id, h.created_at AS action_at, h.performed_by_staff_id
  FROM public.order_history h
  WHERE h.action='manager_force_completed'
    AND h.to_status='completed'
    AND h.performed_by_staff_id IS NOT NULL
  ORDER BY h.order_id,h.created_at DESC
)
UPDATE public.orders o
SET force_completed_at=h.action_at,
    force_completed_by_staff_id=h.performed_by_staff_id
FROM historical h
WHERE o.id=h.order_id
  AND o.status='completed'
  AND o.force_completed_at IS NULL
  AND o.completed_at=h.action_at;

-- The old one-argument client RPC previously bypassed force-completion
-- metadata entirely. Route legacy clients through the protected Manager path,
-- explicitly identifying that the older client did not capture a reason.
CREATE OR REPLACE FUNCTION public.manager_force_complete_order(p_order_number bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $legacy_force_complete$
BEGIN
  RETURN public.force_complete_as_manager(
    p_order_number,
    'Legacy Manager force-completion (older client did not capture a reason)'
  );
END
$legacy_force_complete$;
