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

  -- Blank cost preserves the old value; N/A explicitly clears it.
  -- Numeric values with extra decimal places are rounded to two.
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where nullif(trim(coalesce(item->>'cost','')), '') is not null
      and upper(trim(item->>'cost')) not in ('N/A','NA','#N/A')
      and not (trim(item->>'cost') ~ '^[0-9]{1,10}([.][0-9]+)?$')
  ) then
    raise exception 'Invalid cost: use a nonnegative number or N/A';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where trim(coalesce(item->>'cost','')) ~ '^[0-9]{1,10}([.][0-9]+)?$'
      and round((item->>'cost')::numeric, 2) >= 10000000000
  ) then
    raise exception 'Cost exceeds the supported range after rounding';
  end if;

  -- Keep this batch in a temporary table so products is scanned/joined
  -- once per batch instead of once per SKU.
  create temporary table product_master_import_rows (
    sku text not null,
    sku_key text primary key,
    product_name text not null,
    unit text not null,
    normal_price numeric not null,
    cost numeric,
    cost_unavailable boolean not null,
    category text
  ) on commit drop;

  insert into pg_temp.product_master_import_rows (
    sku,
    sku_key,
    product_name,
    unit,
    normal_price,
    cost,
    cost_unavailable,
    category
  )
  select distinct on (sku_key)
    sku,
    sku_key,
    product_name,
    unit,
    normal_price,
    cost,
    cost_unavailable,
    category
  from (
    select
      trim(coalesce(item ->> 'sku', '')) as sku,
      public.normalize_b2b_sku(trim(coalesce(item ->> 'sku', ''))) as sku_key,
      trim(coalesce(item ->> 'product_name', '')) as product_name,
      trim(coalesce(item ->> 'unit', '')) as unit,

      case
        when trim(coalesce(item ->> 'normal_price', ''))
             ~ '^[0-9]+([.][0-9]+)?$'
        then (item ->> 'normal_price')::numeric
        else null
      end as normal_price,

      case
        when nullif(trim(coalesce(item->>'cost','')), '') is null
          or upper(trim(item->>'cost')) in ('N/A','NA','#N/A') then null
        else round((item->>'cost')::numeric, 2)
      end as cost,
      (upper(trim(coalesce(item->>'cost',''))) in ('N/A','NA','#N/A')) as cost_unavailable,

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
  order by sku_key;

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
    where p.catalogue_sku_key = i.sku_key
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
  where p.catalogue_sku_key = i.sku_key;

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
    where p.catalogue_sku_key = i.sku_key
  );

  get diagnostics
    v_inserted_count = row_count;

  insert into public.product_costs(product_id,cost,updated_at)
  select p.id,i.cost,now()
  from public.products p
  join pg_temp.product_master_import_rows i on i.sku_key=p.catalogue_sku_key
  where i.cost is not null
  on conflict(product_id) do update
  set cost=excluded.cost,updated_at=excluded.updated_at;

  -- Only explicit N/A clears an old cost; an empty cell never does.
  delete from public.product_costs c
  using public.products p, pg_temp.product_master_import_rows i
  where c.product_id = p.id
    and p.catalogue_sku_key = i.sku_key
    and i.cost_unavailable;

  return jsonb_build_object(
    'success', true,
    'receivedCount', v_received_count,
    'insertedCount', v_inserted_count,
    'updatedCount', v_updated_count,
    'invalidCount', v_invalid_count
  );

end;
$function$;
