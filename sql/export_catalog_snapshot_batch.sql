-- Live, re-importable Excel snapshots for the four catalogue import workflows.
-- One manager-checked RPC returns bounded UUID-keyset pages; cost is never exposed
-- through public product reads or to non-manager sessions.
create or replace function public.export_catalog_snapshot_batch(
  p_dataset text,
  p_after_id uuid default null,
  p_limit integer default 2000
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $function$
declare
  v_rows jsonb;
  v_last_id uuid;
  v_limit integer := coalesce(p_limit, 2000);
  v_after uuid := coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid);
begin
  if not public.can_read_product_costs() then
    raise exception 'Manager access required';
  end if;
  if p_dataset is null or p_dataset not in ('master', 'visible', 'pictures', 'special') then
    raise exception 'Unknown export dataset';
  end if;
  if v_limit < 1 or v_limit > 2000 then
    raise exception 'Export page size must be between 1 and 2000';
  end if;

  if p_dataset = 'master' then
    select coalesce(jsonb_agg(page.item order by page.id), '[]'::jsonb), (array_agg(page.id order by page.id desc))[1]
    into v_rows, v_last_id
    from (
      select p.id, jsonb_build_object(
        'sku', p.sku,
        'product', p.product_name,
        'unit', p.unit,
        'normal_price', p.normal_price,
        'cost', pc.cost
      ) as item
      from public.products p
      left join public.product_costs pc on pc.product_id = p.id
      where p.id > v_after and p.is_active = true
      order by p.id
      limit v_limit
    ) page;

  elsif p_dataset = 'visible' then
    select coalesce(jsonb_agg(page.item order by page.id), '[]'::jsonb), (array_agg(page.id order by page.id desc))[1]
    into v_rows, v_last_id
    from (
      select p.id, jsonb_build_object(
        'sku', p.sku,
        'sales', p.sales_score,
        'department', p.category
      ) as item
      from public.products p
      where p.id > v_after and p.is_active = true
        and p.is_customer_visible = true
      order by p.id
      limit v_limit
    ) page;

  elsif p_dataset = 'pictures' then
    select coalesce(jsonb_agg(page.item order by page.id), '[]'::jsonb), (array_agg(page.id order by page.id desc))[1]
    into v_rows, v_last_id
    from (
      select p.id, jsonb_build_object(
        'sku', p.sku,
        'thumbnail_image', p.image_url
      ) as item
      from public.products p
      where p.id > v_after and p.image_url is not null
        and trim(p.image_url) <> ''
      order by p.id
      limit v_limit
    ) page;

  else
    select coalesce(jsonb_agg(page.item order by page.id), '[]'::jsonb), (array_agg(page.id order by page.id desc))[1]
    into v_rows, v_last_id
    from (
      select cp.id, jsonb_build_object(
        'customer_code', c.customer_code,
        'sku', p.sku,
        'agreed_price', cp.agreed_price
      ) as item
      from public.customer_prices cp
      join public.customers c on c.id = cp.customer_id
      join public.products p on p.id = cp.product_id
      where cp.id > v_after and cp.is_active = true
      order by cp.id
      limit v_limit
    ) page;
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'nextCursor', v_last_id,
    'done', v_last_id is null or jsonb_array_length(v_rows) < v_limit
  );
end;
$function$;

revoke all on function public.export_catalog_snapshot_batch(text,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.export_catalog_snapshot_batch(text,uuid,integer)
  to authenticated;
