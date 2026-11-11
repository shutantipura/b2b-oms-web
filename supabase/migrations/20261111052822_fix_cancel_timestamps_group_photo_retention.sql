-- Keep manager cancellation audit metadata and grouped order lifecycle timestamps
-- aligned with the 14-day order-photo retention policy.

CREATE OR REPLACE FUNCTION public.manager_cancel_order(
  p_order_number bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_manager public.staff%rowtype;
  v_stage text;
  v_reason text;
BEGIN
  SELECT * INTO v_manager
  FROM public.staff
  WHERE auth_user_id = auth.uid()
    AND is_active = true
    AND account_type = 'manager'
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

  IF v_order.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Order % is already %', p_order_number, v_order.status;
  END IF;

  IF v_order.group_root_order_id IS NOT NULL
    AND v_order.group_root_order_id <> v_order.id
    AND EXISTS (
      SELECT 1 FROM public.task_claims
      WHERE order_id = v_order.group_root_order_id AND stage = 'billing'
    ) THEN
    RAISE EXCEPTION 'Grouped delivery already entered Billing; cancel the whole group if necessary';
  END IF;

  v_reason := trim(coalesce(p_reason, ''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'Cancellation reason is required';
  END IF;

  v_stage := CASE
    WHEN v_order.status = 'awaiting_confirmation' THEN 'confirmation'
    WHEN v_order.status IN ('awaiting_picking', 'picking') THEN 'picking'
    WHEN v_order.status = 'awaiting_billing' THEN 'billing'
    WHEN v_order.status IN ('ready_for_delivery', 'out_for_delivery') THEN 'delivery'
    WHEN v_order.status IN ('awaiting_payment', 'payment_submitted') THEN 'payment_verification'
    ELSE NULL
  END;

  UPDATE public.task_claims
  SET claim_status = 'released', released_at = now()
  WHERE order_id = v_order.id AND claim_status = 'active';

  -- An order's cancellation clock starts when the manager cancels it,
  -- not when it was originally submitted.
  UPDATE public.orders
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by_staff_id = v_manager.id,
      cancellation_reason = v_reason,
      updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.order_history (
    order_id, action, stage, from_status, to_status,
    performed_by_staff_id, note, details
  ) VALUES (
    v_order.id, 'manager_cancelled', v_stage, v_order.status, 'cancelled',
    v_manager.id, 'Order cancelled by Manager',
    jsonb_build_object('reason', v_reason, 'manager_name', v_manager.staff_name)
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_number', p_order_number,
    'new_status', 'cancelled',
    'cancelled_by', v_manager.staff_name,
    'reason', v_reason
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_group_delivery_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.group_root_order_id = NEW.id
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN (
      'ready_for_delivery', 'out_for_delivery',
      'awaiting_payment', 'payment_submitted', 'completed', 'cancelled'
    ) THEN
    UPDATE public.orders member
    SET status = NEW.status,
        completed_at = CASE WHEN NEW.status = 'completed'
          THEN NEW.completed_at ELSE member.completed_at END,
        cancelled_at = CASE WHEN NEW.status = 'cancelled'
          THEN NEW.cancelled_at ELSE member.cancelled_at END,
        cancelled_by_staff_id = CASE WHEN NEW.status = 'cancelled'
          THEN NEW.cancelled_by_staff_id ELSE member.cancelled_by_staff_id END,
        updated_at = now()
    WHERE member.group_root_order_id = NEW.id
      AND member.id <> NEW.id
      AND member.status <> 'cancelled';
  END IF;
  RETURN NEW;
END;
$function$;

-- Backfill only from existing permanent audit events. No inferred dates.
WITH cancellation_events AS (
  SELECT DISTINCT ON (h.order_id)
    h.order_id, h.created_at, h.performed_by_staff_id
  FROM public.order_history h
  WHERE h.to_status = 'cancelled'
    AND h.performed_by_staff_id IS NOT NULL
  ORDER BY h.order_id, h.created_at DESC, h.id DESC
)
UPDATE public.orders o
SET cancelled_at = e.created_at,
    cancelled_by_staff_id = coalesce(o.cancelled_by_staff_id, e.performed_by_staff_id)
FROM cancellation_events e
WHERE o.id = e.order_id
  AND o.status = 'cancelled'
  AND o.cancelled_at IS NULL;

-- Existing grouped children inherited the parent's terminal status without
-- inheriting the timestamp; their lifecycle ended with the parent's event.
UPDATE public.orders child
SET cancelled_at = root.cancelled_at,
    cancelled_by_staff_id = coalesce(child.cancelled_by_staff_id, root.cancelled_by_staff_id)
FROM public.orders root
WHERE child.group_root_order_id = root.id
  AND child.id <> root.id
  AND child.status = 'cancelled'
  AND child.cancelled_at IS NULL
  AND root.status = 'cancelled'
  AND root.cancelled_at IS NOT NULL;

UPDATE public.orders child
SET completed_at = root.completed_at
FROM public.orders root
WHERE child.group_root_order_id = root.id
  AND child.id <> root.id
  AND child.status = 'completed'
  AND child.completed_at IS NULL
  AND root.status = 'completed'
  AND root.completed_at IS NOT NULL;

-- In future, use the canonical parent's timestamp when evaluating the whole
-- grouped order. A structural /x child must not trigger the 7-day fallback.
CREATE OR REPLACE FUNCTION public.order_photo_retention_candidates(
  p_action text, p_limit integer DEFAULT 75
)
RETURNS TABLE(
  file_id uuid, storage_path text, file_type text, mime_type text,
  bytes bigint, finished_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
WITH grouped AS (
  SELECT coalesce(group_root_order_id, id) gid,
    bool_and(status IN ('completed', 'cancelled')) done,
    bool_or(CASE WHEN id = coalesce(group_root_order_id, id) THEN
      CASE WHEN status = 'completed' THEN completed_at IS NULL
           WHEN status = 'cancelled' THEN cancelled_at IS NULL
           ELSE true END
      ELSE false END) missing_time,
    max(CASE WHEN status = 'completed' THEN coalesce(completed_at, created_at)
             WHEN status = 'cancelled' THEN coalesce(cancelled_at, created_at)
             ELSE created_at END) end_time
  FROM public.orders
  GROUP BY 1
), eligible AS (
  SELECT o.id, o.order_number, g.done, g.missing_time, g.end_time
  FROM public.orders o
  JOIN grouped g ON g.gid = coalesce(o.group_root_order_id, o.id)
)
SELECT f.id, f.storage_path, f.file_type,
  coalesce(s.metadata->>'mimetype', f.mime_type, '')::text,
  CASE WHEN coalesce(s.metadata->>'size', '') ~ '^[0-9]+$'
    THEN (s.metadata->>'size')::bigint END,
  g.end_time
FROM public.order_files f
JOIN eligible g ON f.order_id = g.id
LEFT JOIN storage.objects s ON s.bucket_id = 'order-files' AND s.name = f.storage_path
LEFT JOIN public.order_photo_retention_log l ON l.storage_path = f.storage_path
WHERE g.end_time IS NOT NULL
  AND f.storage_path LIKE 'orders/' || g.order_number::text || '/%'
  AND f.file_type IN (
    'cart_photo', 'cart_photo_2', 'bill', 'bill_2',
    'payment_qr', 'payment_qr_2', 'payment_slip', 'payment_slip_2',
    'delivery_proof', 'delivery_proof_2'
  )
  AND (
    (p_action = 'compress' AND s.id IS NOT NULL
      AND coalesce(s.metadata->>'mimetype', f.mime_type, '') LIKE 'image/%'
      AND l.compressed_at IS NULL
      AND NOT (g.done AND (
        (NOT g.missing_time AND g.end_time <= now() - interval '14 days') OR
        (g.missing_time AND g.end_time <= now() - interval '7 days')
      ) AND NOT ((
        f.storage_path LIKE 'orders/' || g.order_number::text || '/bill/manager/%' OR
        f.storage_path LIKE 'orders/' || g.order_number::text || '/bill_2/manager/%' OR
        f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_qr/manager/%' OR
        f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_qr_2/manager/%' OR
        f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_slip/manager/%' OR
        f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_slip_2/manager/%'
      ) AND f.created_at > now() - interval '14 days')))
    OR (p_action = 'delete' AND g.done AND (
      (NOT g.missing_time AND g.end_time <= now() - interval '14 days') OR
      (g.missing_time AND g.end_time <= now() - interval '7 days')
    ) AND NOT ((
      f.storage_path LIKE 'orders/' || g.order_number::text || '/bill/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/bill_2/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_qr/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_qr_2/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_slip/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_slip_2/manager/%'
    ) AND f.created_at > now() - interval '14 days')
      AND s.id IS NOT NULL AND coalesce(s.metadata->>'mimetype', f.mime_type, '') LIKE 'image/%')
    OR (p_action = 'finalize_delete' AND g.done AND (
      (NOT g.missing_time AND g.end_time <= now() - interval '14 days') OR
      (g.missing_time AND g.end_time <= now() - interval '7 days')
    ) AND NOT ((
      f.storage_path LIKE 'orders/' || g.order_number::text || '/bill/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/bill_2/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_qr/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_qr_2/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_slip/manager/%' OR
      f.storage_path LIKE 'orders/' || g.order_number::text || '/payment_slip_2/manager/%'
    ) AND f.created_at > now() - interval '14 days') AND s.id IS NULL)
  )
ORDER BY g.end_time, f.storage_path
LIMIT greatest(1, least(coalesce(p_limit, 75), 200));
$function$;

-- Preserve existing privilege boundaries when replacing the SECURITY DEFINER RPC.
REVOKE ALL ON FUNCTION public.order_photo_retention_candidates(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_photo_retention_candidates(text, integer)
  TO service_role;
