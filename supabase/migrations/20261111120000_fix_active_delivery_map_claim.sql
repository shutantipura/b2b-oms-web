-- Start Work creates an 'active' task claim. The prior rider map RPC checked
-- the nonexistent 'claimed' status, rejecting legitimate delivery riders.
CREATE OR REPLACE FUNCTION public.update_my_delivery_map(
  p_order_number bigint,
  p_map_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_staff_id uuid;
  v_url text := btrim(coalesce(p_map_url, ''));
  v_host text;
BEGIN
  SELECT id INTO v_staff_id
  FROM public.staff
  WHERE staff_code = public.current_staff_code()
    AND is_active = true
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Active staff account required';
  END IF;

  IF length(v_url) > 2048 OR v_url !~* '^https://[^/[:space:]]+' THEN
    RAISE EXCEPTION 'Invalid Google Maps URL';
  END IF;

  v_host := lower(split_part(split_part(substring(v_url from 9), '/', 1), ':', 1));
  IF v_host NOT IN (
    'maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.com',
    'maps.google.com', 'www.google.co.th', 'google.co.th'
  ) THEN
    RAISE EXCEPTION 'Only Google Maps links are allowed';
  END IF;

  IF v_host IN ('www.google.com', 'google.com', 'www.google.co.th', 'google.co.th')
     AND v_url !~* '(/maps|[?&]q=|[?&]query=)' THEN
    RAISE EXCEPTION 'Please provide a Google Maps location link';
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.order_number = p_order_number
    AND o.status NOT IN ('completed', 'cancelled')
    AND EXISTS (
      SELECT 1
      FROM public.task_claims c
      WHERE c.order_id = o.id
        AND c.staff_id = v_staff_id
        AND c.stage = 'delivery'
        AND c.claim_status = 'active'
    )
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'You must have an active delivery task for this order';
  END IF;

  UPDATE public.orders
  SET delivery_address = v_url
  WHERE id = v_order_id;

  RETURN jsonb_build_object('success', true, 'delivery_map_url', v_url);
END;
$function$;
