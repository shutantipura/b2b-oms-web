-- Hardening pass following the November OMS security/performance audit.
-- These legacy functions are SECURITY INVOKER; a fixed search_path prevents
-- caller-controlled name resolution without changing their execution grants.
-- Keep public before pg_temp because the bodies use public-qualified tables
-- and the extension/function helpers are available in public.
ALTER FUNCTION public.cancel_order(bigint, text, text) SET search_path TO public, pg_temp;
ALTER FUNCTION public.claim_task(bigint, text, text) SET search_path TO public, pg_temp;
ALTER FUNCTION public.complete_confirmation(bigint, text, jsonb) SET search_path TO public, pg_temp;
ALTER FUNCTION public.complete_delivery(bigint, text) SET search_path TO public, pg_temp;
ALTER FUNCTION public.complete_picking(bigint, text, jsonb) SET search_path TO public, pg_temp;
ALTER FUNCTION public.force_complete_order(bigint, text, text) SET search_path TO public, pg_temp;
ALTER FUNCTION public.normalize_b2b_sku(text) SET search_path TO public, pg_temp;
ALTER FUNCTION public.release_task(bigint, text) SET search_path TO public, pg_temp;
ALTER FUNCTION public.submit_payment_slip(bigint, text, text, text, text, text) SET search_path TO public, pg_temp;
ALTER FUNCTION public.verify_payment(bigint, text) SET search_path TO public, pg_temp;

-- These SECURITY DEFINER functions are attached only to database triggers,
-- not intended for direct calls as authenticated or anonymous RPC methods.
-- Revoking EXECUTE does not disable triggers which already reference them.
REVOKE EXECUTE ON FUNCTION public.enforce_task_claim_permission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_group_delivery_status() FROM PUBLIC, anon, authenticated;

-- Reference columns identified by Supabase's unindexed foreign-key advisor.
-- No data changes; indexes make future deletes/updates of referenced rows safer.
CREATE INDEX IF NOT EXISTS idx_alarm_station_pairing_codes_dedicated_staff_id
  ON public.alarm_station_pairing_codes (dedicated_staff_id);
CREATE INDEX IF NOT EXISTS idx_alarm_station_pairing_codes_station_id
  ON public.alarm_station_pairing_codes (station_id);
CREATE INDEX IF NOT EXISTS idx_b2c_daily_sales_imports_imported_by_staff_id
  ON public.b2c_daily_sales_imports (imported_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_b2c_sales_30d_imports_imported_by_staff_id
  ON public.b2c_sales_30d_imports (imported_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_favourites_product_id
  ON public.favourites (product_id);
CREATE INDEX IF NOT EXISTS idx_order_alerts_acknowledged_by
  ON public.order_alerts (acknowledged_by);
CREATE INDEX IF NOT EXISTS idx_order_files_uploaded_by_line_user_id
  ON public.order_files (uploaded_by_line_user_id);
CREATE INDEX IF NOT EXISTS idx_order_history_performed_by_line_user_id
  ON public.order_history (performed_by_line_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_by_staff_id
  ON public.orders (cancelled_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_orders_cv_card_resolved_by_staff_id
  ON public.orders (cv_card_resolved_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_orders_force_completed_by_staff_id
  ON public.orders (force_completed_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_line_users_authorized_by
  ON public.staff_line_users (authorized_by);
CREATE INDEX IF NOT EXISTS idx_staff_line_users_deauthorized_by
  ON public.staff_line_users (deauthorized_by);
CREATE INDEX IF NOT EXISTS idx_stock_morning_counts_counted_by_staff_id
  ON public.stock_morning_counts (counted_by_staff_id);

-- pg_trgm is relocatable and extensions is a shared, non-writable schema for
-- API roles. Existing GIN trigram indexes retain their operator-class OIDs.
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
