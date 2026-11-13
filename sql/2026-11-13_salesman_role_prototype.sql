-- Salesman prototype: a separate OMS staff role with no operational task privileges.
-- Existing staff / manager behavior is unchanged.
ALTER TABLE public.staff
  DROP CONSTRAINT IF EXISTS staff_account_type_check;
ALTER TABLE public.staff
  ADD CONSTRAINT staff_account_type_check
  CHECK (account_type = ANY (ARRAY['staff'::text, 'manager'::text, 'salesman'::text]));

-- Defense in depth: even if permissions are inserted outside the manager UI,
-- salesman accounts cannot claim or perform OMS task stages.
CREATE OR REPLACE FUNCTION public.staff_can_access_stage(p_stage text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    COALESCE(p_stage = ANY (ARRAY[
      'confirmation'::text, 'picking'::text, 'billing'::text,
      'delivery'::text, 'payment_verification'::text
    ]), false)
    AND EXISTS (
      SELECT 1
      FROM public.staff s
      JOIN public.staff_task_permissions stp ON stp.staff_id = s.id
      WHERE s.auth_user_id = (SELECT auth.uid())
        AND s.is_active = true
        AND s.account_type IN ('staff', 'manager')
        AND stp.stage = p_stage
    );
$$;
