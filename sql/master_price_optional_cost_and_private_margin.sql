-- Manager-only costs outside the public product catalogue.
create table if not exists public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  cost numeric(14,4) not null check (cost >= 0),
  updated_at timestamptz not null default now()
);
alter table public.product_costs enable row level security;
revoke all on public.product_costs from public,anon,authenticated;
grant select on public.product_costs to authenticated;
create or replace function public.can_read_product_costs()
returns boolean language sql stable security definer set search_path=''
as $$
 select exists (select 1 from public.staff s
 where s.auth_user_id=(select auth.uid())
 and s.account_type='manager' and s.is_active=true);
$$;
revoke all on function public.can_read_product_costs() from public,anon;
grant execute on function public.can_read_product_costs() to authenticated;
drop policy if exists manager_read_product_costs on public.product_costs;
create policy manager_read_product_costs on public.product_costs
for select to authenticated using ((select public.can_read_product_costs()));

CREATE OR REPLACE FUNCTION public.import_product_master_with_category_batch(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_received_count integer := 0;
  v_valid_count integer := 0;
  v_invalid_count integer := 0;
  v_updated_count integer := 0;
  v_inserted_count integer := 0;
begin

  if not public.can_read_product_costs() then
    raise exception 'Manager access required';
  end if;

  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  v_received_count := jsonb_array_length(p_rows);

  -- Preserve prior cost if missing or blank; reject malformed supplied costs.
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where item ? 'cost'
      and nullif(trim(coalesce(item->>'cost','')), '') is not null
      and not (trim(item->>'cost') ~ '^[0-9]{1,10}([.][0-9]{1,4})?$')
  ) then
    raise exception 'Invalid cost: use a nonnegative value with up to 4 decimals';
  end if;

  -- Keep this batch in a temporary table so products is scanned/joined
  -- once per batch instead of once per SKU.
  create temporary table product_master_import_rows (
    sku text primary key,
    product_name text not null,
    unit text not null,
    normal_price numeric not null,
    cost numeric,
    category text
  ) on commit drop;

  insert into pg_temp.product_master_import_rows (
    sku,
    product_name,
    unit,
    normal_price,
    cost,
    category
  )
  select distinct on (sku)
    sku,
    product_name,
    unit,
    normal_price,
    cost,
    category
  from (
    select
      trim(coalesce(item ->> 'sku', '')) as sku,
      trim(coalesce(item ->> 'product_name', '')) as product_name,
      trim(coalesce(item ->> 'unit', '')) as unit,

      case
        when trim(coalesce(item ->> 'normal_price', ''))
             ~ '^[0-9]+([.][0-9]+)?$'
        then (item ->> 'normal_price')::numeric
        else null
      end as normal_price,

      case when nullif(trim(coalesce(item->>'cost','')), '') is null
        then null
        else (item->>'cost')::numeric
      end as cost,

      nullif(
        trim(coalesce(item ->> 'category', '')),
        ''
      ) as category

    from jsonb_array_elements(p_rows) as item
  ) parsed
  where
    sku <> ''
    and product_name <> ''
    and unit <> ''
    and normal_price is not null
    and normal_price >= 0
  order by sku;

  select count(*)
  into v_valid_count
  from pg_temp.product_master_import_rows;

  v_invalid_count :=
    greatest(
      v_received_count - v_valid_count,
      0
    );

  -- Count existing logical SKUs before the update.
  select count(*)
  into v_updated_count
  from pg_temp.product_master_import_rows i
  where exists (
    select 1
    from public.products p
    where p.sku = i.sku
  );

  -- Update all existing SKUs in one statement.
  update public.products p
  set
    product_name = i.product_name,
    unit = i.unit,
    normal_price = i.normal_price,
    is_active = true,
    catalogue_updated_at = now()
  from pg_temp.product_master_import_rows i
  where p.sku = i.sku;

  -- Insert only SKUs that do not already exist.
  insert into public.products (
    sku,
    product_name,
    unit,
    normal_price,
    category,
    is_active,
    is_customer_visible,
    sales_score,
    catalogue_updated_at
  )
  select
    i.sku,
    i.product_name,
    i.unit,
    i.normal_price,
    null,
    true,
    false,
    0,
    now()
  from pg_temp.product_master_import_rows i
  where not exists (
    select 1
    from public.products p
    where p.sku = i.sku
  );

  get diagnostics
    v_inserted_count = row_count;

  insert into public.product_costs(product_id,cost,updated_at)
  select p.id,i.cost,now()
  from public.products p
  join pg_temp.product_master_import_rows i on i.sku=p.sku
  where i.cost is not null
  on conflict(product_id) do update
  set cost=excluded.cost,updated_at=excluded.updated_at;

  return jsonb_build_object(
    'success', true,
    'receivedCount', v_received_count,
    'insertedCount', v_inserted_count,
    'updatedCount', v_updated_count,
    'invalidCount', v_invalid_count
  );

end;
$function$;
