-- Test-customer orders should ring the same store alarm as normal customer orders.
-- This does not change customer order history, checkout, or order status.
CREATE OR REPLACE FUNCTION public.create_order_alarm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.order_alerts (order_id)
  VALUES (NEW.id)
  ON CONFLICT (order_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Recover exactly the user's current test order for an immediate real-device test.
-- Do not backfill old test orders, avoiding a flood of historical alerts.
INSERT INTO public.order_alerts (order_id)
SELECT o.id
FROM public.orders o
JOIN public.customers c ON c.id = o.customer_id
WHERE o.order_number = 117
  AND c.is_test_customer = true
  AND o.status = 'awaiting_confirmation'
  AND o.created_at >= now() - interval '24 hours'
ON CONFLICT (order_id) DO NOTHING;
