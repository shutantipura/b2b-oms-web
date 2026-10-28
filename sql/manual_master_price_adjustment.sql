-- Manager-only, item-level normal-price and cost adjustments.
-- Search returns cost only after checking the caller's active manager account.
create or replace function public.search_master_price_adjustments(p_query text)
returns table (
  product_id uuid,
  sku text,
  product_name text,
  unit text,
  normal_price numeric,
  cost numeric,
  is_active boolean
)
language plpgsql stable security definer
set search_path = ''
as $function$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_key text;
begin
  if not public.can_read_product_costs() then
    raise exception 'Manager access required';
  end if;

  if length(v_query) < 2 then
    return;
  end if;
  if length(v_query) > 100 then
    raise exception 'Search query is too long';
  end if;

  v_key := public.normalize_b2b_sku(v_query);

  return query
  select p.id, p.sku, p.product_name, p.unit, p.normal_price, c.cost, p.is_active
  from public.products p
  left join public.product_costs c on c.product_id = p.id
  where p.catalogue_sku_key = v_key
     or p.sku ilike v_query || '%'
     or p.product_name ilike '%' || v_query || '%'
  order by
    case
      when p.catalogue_sku_key = v_key then 0
      when p.sku ilike v_query || '%' then 1
      when p.product_name ilike v_query || '%' then 2
      else 3
    end,
    p.sales_score desc nulls last,
    p.product_name,
    p.sku
  limit 20;
end;
$function$;

revoke all on function public.search_master_price_adjustments(text)
  from public, anon, authenticated;
grant execute on function public.search_master_price_adjustments(text)
  to authenticated;

-- NULL normal price = keep existing; cost mode = keep, set, or na.
-- A single transaction updates only the requested field(s).
create or replace function public.adjust_product_master_price(
  p_product_id uuid,
  p_normal_price numeric,
  p_cost_mode text,
  p_cost_value numeric
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $function$
declare
  v_sku text;
  v_normal numeric;
  v_cost numeric;
begin
  if not public.can_read_product_costs() then
    raise exception 'Manager access required';
  end if;

  if p_product_id is null then
    raise exception 'Product ID is required';
  end if;
  if p_cost_mode is null or p_cost_mode not in ('keep','set','na') then
    raise exception 'Invalid cost mode';
  end if;
  if p_normal_price is null and p_cost_mode = 'keep' then
    raise exception 'No adjustment supplied';
  end if;

  if p_normal_price is not null and (
    p_normal_price < 0 or round(p_normal_price, 2) >= 10000000000
  ) then
    raise exception 'Normal price must be nonnegative and within range';
  end if;

  if p_cost_mode = 'set' then
    if p_cost_value is null or p_cost_value < 0
       or round(p_cost_value, 2) >= 10000000000 then
      raise exception 'Cost must be nonnegative and within range';
    end if;
  elsif p_cost_value is not null then
    raise exception 'Cost value is only accepted in set mode';
  end if;

  select p.sku into v_sku
  from public.products p
  where p.id = p_product_id
  for update;
  if not found then
    raise exception 'Product not found';
  end if;

  if p_normal_price is not null then
    update public.products p
    set normal_price = round(p_normal_price, 2),
        catalogue_updated_at = now(),
        updated_at = now()
    where p.id = p_product_id;
  end if;

  if p_cost_mode = 'set' then
    insert into public.product_costs(product_id, cost, updated_at)
    values (p_product_id, round(p_cost_value, 2), now())
    on conflict(product_id) do update
      set cost = excluded.cost, updated_at = excluded.updated_at;
  elsif p_cost_mode = 'na' then
    delete from public.product_costs c
    where c.product_id = p_product_id;
  end if;

  select p.normal_price, c.cost into v_normal, v_cost
  from public.products p
  left join public.product_costs c on c.product_id = p.id
  where p.id = p_product_id;

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'sku', v_sku,
    'normal_price', v_normal,
    'cost', v_cost
  );
end;
$function$;

revoke all on function public.adjust_product_master_price(uuid,numeric,text,numeric)
  from public, anon, authenticated;
grant execute on function public.adjust_product_master_price(uuid,numeric,text,numeric)
  to authenticated;
