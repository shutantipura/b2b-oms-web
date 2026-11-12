-- Temporary B2B online-sale availability is distinct from physical store stock.
-- All existing SKUs remain orderable on rollout; master-price imports should not
-- reset this manager-controlled flag.
alter table public.products
  add column if not exists is_customer_out_of_stock boolean not null default false;

comment on column public.products.is_customer_out_of_stock is
  'Manager-controlled temporary unavailability in the B2B customer MINI App; independent of inventory and product visibility.';

create or replace function public.set_product_customer_out_of_stock(
  p_product_id uuid,
  p_out_of_stock boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sku text;
  v_name text;
  v_out_of_stock boolean;
begin
  if not public.can_read_product_costs() then
    raise exception 'Manager access required';
  end if;
  if p_product_id is null or p_out_of_stock is null then
    raise exception 'Product and availability state are required';
  end if;

  update public.products p
     set is_customer_out_of_stock = p_out_of_stock,
         catalogue_updated_at = now(),
         updated_at = now()
   where p.id = p_product_id
   returning p.sku, p.product_name, p.is_customer_out_of_stock
        into v_sku, v_name, v_out_of_stock;

  if not found then
    raise exception 'Product not found';
  end if;

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'sku', v_sku,
    'product_name', v_name,
    'is_out_of_stock', v_out_of_stock
  );
end;
$function$;

revoke all on function public.set_product_customer_out_of_stock(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_product_customer_out_of_stock(uuid, boolean)
  to authenticated;
