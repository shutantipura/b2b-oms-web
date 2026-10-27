-- Allow a grouped order's primary bill/QR files to survive releasing and
-- re-claiming the billing task. Only documents on true child suborders block it.
-- This migration modifies only the file-location guard in the existing
-- SECURITY DEFINER function and retains its other checks and permissions.
DO $migration$
DECLARE
  current_definition text;
  prior_guard constant text :=
    'WHERE child.group_root_order_id=v_root.id AND f.file_type IN (''bill'',''payment_qr'')';
  fixed_guard constant text :=
    'WHERE child.group_root_order_id=v_root.id AND child.id<>v_root.id AND f.file_type IN (''bill'',''payment_qr'')';
BEGIN
  SELECT pg_get_functiondef('public.prepare_group_billing(bigint,text)'::regprocedure)
  INTO current_definition;

  IF current_definition IS NULL THEN
    RAISE EXCEPTION 'Grouped billing function is missing';
  END IF;

  IF position(fixed_guard in current_definition)>0 THEN
    RETURN; -- idempotent
  END IF;

  IF position(prior_guard in current_definition)=0 THEN
    RAISE EXCEPTION 'Unexpected grouped billing guard; refusing to modify function';
  END IF;

  EXECUTE replace(current_definition,prior_guard,fixed_guard);
END
$migration$;
