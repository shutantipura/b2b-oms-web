-- Targeted hot-path indexes; avoid indiscriminately indexing all 17 advisory FKs.
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_history_staff_id ON public.order_history(performed_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_order_history_action_created_order ON public.order_history(action,created_at,order_id);
CREATE INDEX IF NOT EXISTS idx_order_files_uploaded_staff_id ON public.order_files(uploaded_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_group_billing_lines_product_id ON public.group_billing_lines(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_ordered_by_line_user_id ON public.orders(ordered_by_line_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_ordered_by_staff_id ON public.orders(ordered_by_staff_id);
