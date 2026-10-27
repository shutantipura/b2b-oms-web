-- A persistent all-customer authorization option per LINE account.
-- Customer access keeps using customer_line_users, so every current
-- customer-facing API and Supabase RLS check continues to work unchanged.
ALTER TABLE public.line_users
  ADD COLUMN IF NOT EXISTS all_customers_access boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_line_all_customer_access(
  p_line_user_row_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_codes jsonb;
  v_changed integer := 0;
BEGIN
  IF NOT public.is_current_manager() THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'p_enabled is required';
  END IF;
  -- Row lock synchronizes the grant with customer-creation triggers.
  PERFORM 1
  FROM public.line_users lu
  WHERE lu.id = p_line_user_row_id
    AND lu.is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active LINE account not found';
  END IF;

  UPDATE public.line_users lu
  SET all_customers_access = p_enabled,
      updated_at = now()
  WHERE lu.id = p_line_user_row_id;

  IF p_enabled THEN
    -- Idempotent: include every existing active customer, even if it has
    -- a previously disabled link. New customers are handled by the trigger.
    INSERT INTO public.customer_line_users (line_user_id, customer_id, can_order)
    SELECT p_line_user_row_id, c.id, true
    FROM public.customers c
    WHERE c.is_active = true
    ON CONFLICT (line_user_id, customer_id)
    DO UPDATE SET can_order = true
    WHERE customer_line_users.can_order IS DISTINCT FROM true;

    GET DIAGNOSTICS v_changed = ROW_COUNT;
  ELSE
    UPDATE public.customer_line_users clu
    SET can_order = false
    WHERE clu.line_user_id = p_line_user_row_id
      AND clu.can_order = true;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;

  SELECT coalesce(jsonb_agg(c.customer_code ORDER BY c.customer_code), '[]'::jsonb)
  INTO v_codes
  FROM public.customer_line_users clu
  JOIN public.customers c ON c.id = clu.customer_id
  WHERE clu.line_user_id = p_line_user_row_id AND clu.can_order = true;

  RETURN jsonb_build_object(
    'success', true,
    'changedCount', v_changed,
    'customerCodes', coalesce(v_codes, '[]'::jsonb),
    'allCustomersAccess', p_enabled
  );
END;
$function$;

-- Revoking a single customer explicitly exits "all customers" mode.
-- All other manually linked customers remain authorized.
CREATE OR REPLACE FUNCTION public.set_line_customer_access(
  p_line_user_row_id uuid,
  p_customer_code text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_customer_id uuid;
BEGIN
  IF NOT public.is_current_manager() THEN
    RAISE EXCEPTION 'Manager account required.';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'p_enabled is required';
  END IF;
  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE c.customer_code = p_customer_code;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;
  PERFORM 1 FROM public.line_users lu
    WHERE lu.id = p_line_user_row_id AND lu.is_active = true
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active LINE account not found';
  END IF;

  IF p_enabled THEN
    INSERT INTO public.customer_line_users (line_user_id, customer_id, can_order)
    VALUES (p_line_user_row_id, v_customer_id, true)
    ON CONFLICT (line_user_id, customer_id)
    DO UPDATE SET can_order = true;
  ELSE
    UPDATE public.line_users lu
    SET all_customers_access = false, updated_at = now()
    WHERE lu.id = p_line_user_row_id AND lu.all_customers_access = true;
    UPDATE public.customer_line_users clu
    SET can_order = false
    WHERE clu.line_user_id = p_line_user_row_id
      AND clu.customer_id = v_customer_id;
  END IF;
END;
$function$;

-- Link every new (or re-activated) customer to accounts in permanent
-- all-customer mode. The existing line_users.is_active and
-- customers.is_active checks still gate effective customer access.
CREATE OR REPLACE FUNCTION public.link_new_customer_to_all_line_accounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.is_active = true THEN
    INSERT INTO public.customer_line_users (line_user_id, customer_id, can_order)
    SELECT lu.id, NEW.id, true
    FROM public.line_users lu
    WHERE lu.all_customers_access = true
    FOR SHARE
    ON CONFLICT (line_user_id, customer_id)
    DO UPDATE SET can_order = true
    WHERE customer_line_users.can_order IS DISTINCT FROM true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_link_new_customer_to_all_line_accounts ON public.customers;
CREATE TRIGGER trg_link_new_customer_to_all_line_accounts
  AFTER INSERT OR UPDATE OF is_active ON public.customers
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION public.link_new_customer_to_all_line_accounts();

-- Add a true persisted-state field for the combined manager LINE-access UI.
CREATE OR REPLACE FUNCTION public.get_line_access_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_current_manager() THEN
    RAISE EXCEPTION 'Manager account required.';
  END IF;

  SELECT jsonb_build_object(
    'line_users', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'lineUserRowId', lu.id,
          'lineUserId', lu.line_user_id,
          'displayName', lu.display_name,
          'isActive', lu.is_active,
          'allCustomersAccess', lu.all_customers_access,
          'createdAt', lu.created_at,
          'customerCodes', coalesce((
            SELECT jsonb_agg(c.customer_code ORDER BY c.customer_code)
            FROM public.customer_line_users clu
            JOIN public.customers c ON c.id = clu.customer_id
            WHERE clu.line_user_id = lu.id AND clu.can_order = true
          ), '[]'::jsonb),
          'staff', (
            SELECT jsonb_build_object(
              'staffCode', s.staff_code,
              'staffName', s.staff_name,
              'accountType', s.account_type,
              'isAuthorized', slu.is_authorized
            )
            FROM public.staff_line_users slu
            JOIN public.staff s ON s.id = slu.staff_id
            WHERE slu.line_user_id = lu.line_user_id
            LIMIT 1
          )
        ) ORDER BY lu.created_at DESC
      ) FROM public.line_users lu
    ), '[]'::jsonb),
    'customers', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'customerCode', c.customer_code,
          'customerName', c.customer_name,
          'isActive', c.is_active
        ) ORDER BY c.customer_code
      ) FROM public.customers c
    ), '[]'::jsonb),
    'staff', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'staffCode', s.staff_code,
          'staffName', s.staff_name,
          'accountType', s.account_type,
          'isActive', s.is_active
        ) ORDER BY s.staff_code
      ) FROM public.staff s
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
