-- 2026-10-27: allow grouped billing to be claimed again after release.
-- Previously prepare_group_billing rejected ANY historic billing claim,
-- including released/completed ones, despite the task being available again.
-- Only an active billing claim should block a concurrent new claim.
-- Keep other grouped-order validation and the original function's privileges.
DO $migration$
DECLARE
  original_definition text;
  updated_definition text;
  search_fragment constant text :=
    'WHERE child.group_root_order_id=v_root.id AND tc.stage=''billing''';
  replacement_fragment constant text :=
    'WHERE child.group_root_order_id=v_root.id AND tc.stage=''billing'' AND tc.claim_status=''active''';
BEGIN
  SELECT pg_get_functiondef('public.prepare_group_billing(bigint,text)'::regprocedure)
    INTO original_definition;

  IF original_definition IS NULL OR position(search_fragment in original_definition) = 0 THEN
    RAISE EXCEPTION 'Expected grouped-billing guard not found';
  END IF;

  -- Idempotent if this migration has already been installed.
  IF position(replacement_fragment in original_definition) > 0 THEN
    RETURN;
  END IF;

  updated_definition := replace(original_definition, search_fragment, replacement_fragment);
  EXECUTE updated_definition;
END
$migration$;
