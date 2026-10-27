-- Store pickup reuses the same Bangkok schedule as delivery, but it has
-- no rider task: all supported billing methods move directly to payment.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_method text NOT NULL DEFAULT 'delivery';
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_fulfillment_method_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_fulfillment_method_check CHECK (fulfillment_method IN ('delivery','pickup'));

-- An atomic wrapper ensures an order cannot be created as delivery and then
-- fail to be marked pickup due to a second API/database request.
CREATE OR REPLACE FUNCTION public.create_customer_pickup_order(
  p_customer_code text,
  p_delivery_date date,
  p_delivery_slot text,
  p_customer_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_id uuid;
BEGIN
  v_result := public.create_customer_order(
    p_customer_code, p_delivery_date, p_delivery_slot,
    'รับสินค้าที่สาขา', p_customer_notes, p_items
  );
  v_id := (v_result->>'order_id')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'New pickup order ID is missing';
  END IF;
  UPDATE public.orders
  SET fulfillment_method = 'pickup', updated_at = now()
  WHERE id = v_id
    AND status = 'awaiting_confirmation'
    AND group_root_order_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not configure pickup order';
  END IF;
  RETURN v_result || jsonb_build_object('fulfillment_method', 'pickup');
END;
$function$;

-- Preserve all existing bill, QR, CV and group-validation mechanics.
-- The only status transition change is awaiting_billing -> awaiting_payment
-- for pickup orders, in each of the three billing modes.
DO $migration$
DECLARE
  v_name text;
  v_current text;
  v_updated text;
  v_status_case constant text := 'CASE WHEN v_order.fulfillment_method = ''pickup'' THEN ''awaiting_payment'' ELSE ''ready_for_delivery'' END';
  v_count int;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'complete_billing',
    'complete_my_billing_no_cv',
    'complete_my_billing_suspended'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_current
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=v_name LIMIT 1;
    IF v_current IS NULL THEN
      RAISE EXCEPTION 'Expected billing function % missing', v_name;
    END IF;

    -- Audit row and returned new_status must agree with the actual new status.
    v_count := (length(v_current) - length(replace(v_current, '''ready_for_delivery''', ''))) / length('''ready_for_delivery''');
    IF v_count <> 3 THEN
      RAISE EXCEPTION '%: unexpected number of billing status assignments: %', v_name, v_count;
    END IF;
    v_updated := replace(v_current, '''ready_for_delivery''', v_status_case);
    EXECUTE v_updated;
  END LOOP;
END;
$migration$;
