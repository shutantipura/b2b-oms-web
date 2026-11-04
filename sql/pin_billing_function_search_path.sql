-- Pin the search path for the two internal Billing functions.
-- These functions already schema-qualify every table and view they access.
-- Neither function is directly callable by anon or authenticated clients.
ALTER FUNCTION public.complete_billing(bigint, text, numeric)
  SET search_path TO '';

ALTER FUNCTION public.complete_billing_with_reason(bigint, text, numeric, text)
  SET search_path TO '';
