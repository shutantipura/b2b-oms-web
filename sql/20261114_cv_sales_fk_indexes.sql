-- Cover foreign-key columns used by CV approvals and salesman audit queries.
-- All affected tables are small, and the migration is additive.
-- Keeps the existing RLS and SECURITY DEFINER authorization boundaries unchanged.
CREATE INDEX IF NOT EXISTS idx_cv_account_events_actor_staff_id_fk ON public.cv_account_events (actor_staff_id);
CREATE INDEX IF NOT EXISTS idx_cv_account_events_cv_account_id_fk ON public.cv_account_events (cv_account_id);
CREATE INDEX IF NOT EXISTS idx_cv_account_events_request_id_fk ON public.cv_account_events (request_id);
CREATE INDEX IF NOT EXISTS idx_cv_account_requests_created_by_fk ON public.cv_account_requests (created_by);
CREATE INDEX IF NOT EXISTS idx_cv_account_requests_reviewed_by_fk ON public.cv_account_requests (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_cv_accounts_approved_by_fk ON public.cv_accounts (approved_by);
CREATE INDEX IF NOT EXISTS idx_cv_accounts_created_by_fk ON public.cv_accounts (created_by);
CREATE INDEX IF NOT EXISTS idx_cv_accounts_deactivated_by_fk ON public.cv_accounts (deactivated_by);
CREATE INDEX IF NOT EXISTS idx_sales_customer_change_audit_reviewed_by_fk ON public.sales_customer_change_audit (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_sales_customer_change_audit_staff_id_fk ON public.sales_customer_change_audit (staff_id);
CREATE INDEX IF NOT EXISTS idx_sales_special_price_requests_product_id_fk ON public.sales_special_price_requests (product_id);
CREATE INDEX IF NOT EXISTS idx_sales_special_price_requests_reviewed_by_fk ON public.sales_special_price_requests (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_sales_special_price_requests_staff_id_fk ON public.sales_special_price_requests (staff_id);
