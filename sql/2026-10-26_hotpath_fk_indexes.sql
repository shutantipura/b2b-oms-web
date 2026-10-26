-- Cover high-traffic customer and order relationships without indexing every FK.
-- Existing tables are small; non-concurrent creation is short and migration-safe.
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_order_history_order_id ON public.order_history (order_id);
CREATE INDEX IF NOT EXISTS idx_customer_line_users_customer_id ON public.customer_line_users (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_prices_product_id ON public.customer_prices (product_id);
