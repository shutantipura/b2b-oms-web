-- RLS on public.products already allows UPDATE only for managers.
-- Use caller permissions so this setting adds no new SECURITY DEFINER entrypoint.
alter function public.set_product_customer_out_of_stock(uuid, boolean)
  security invoker;
