-- Daily SKU sales matrix with compact per-SKU age-independent history.
-- Preserve existing 30-day aggregate imports. A daily import supersedes that
-- baseline for forecasts only after its entire data set has been written.
create table if not exists public.b2c_daily_sales_imports (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  dates jsonb not null,
  source_filename text,
  sku_count integer not null check (sku_count > 0),
  imported_by_staff_id uuid references public.staff(id) on delete set null,
  imported_at timestamptz not null default now(),
  is_active boolean not null default false,
  constraint b2c_daily_period_range check (period_end >= period_start and period_end - period_start between 6 and 119),
  constraint b2c_daily_dates_array check (jsonb_typeof(dates) = 'array')
);
create unique index if not exists b2c_daily_one_active on public.b2c_daily_sales_imports (is_active) where is_active;

create table if not exists public.b2c_daily_sales_profiles (
  import_id uuid not null references public.b2c_daily_sales_imports(id) on delete cascade,
  sku text not null check (sku ~ '^[0-9]{9}$'),
  unit text,
  daily_qty jsonb not null check (jsonb_typeof(daily_qty) = 'array'),
  primary key (import_id, sku)
);

alter table public.b2c_daily_sales_imports enable row level security;
alter table public.b2c_daily_sales_profiles enable row level security;
revoke all on public.b2c_daily_sales_imports from anon, authenticated;
revoke all on public.b2c_daily_sales_profiles from anon, authenticated;
grant select, insert, update, delete on public.b2c_daily_sales_imports to service_role;
grant select, insert, update, delete on public.b2c_daily_sales_profiles to service_role;

create or replace function public.activate_b2c_daily_sales_import(p_import_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.b2c_daily_sales_imports b
    where b.id = p_import_id and
      (select count(*) from public.b2c_daily_sales_profiles p where p.import_id = b.id) = b.sku_count
  ) then
    raise exception 'Daily B2C import missing or incomplete';
  end if;
  update public.b2c_daily_sales_imports set is_active = false where is_active;
  update public.b2c_daily_sales_imports set is_active = true where id = p_import_id;
  update public.b2c_sales_30d_imports set is_active = false where is_active;
end;
$$;
revoke all on function public.activate_b2c_daily_sales_import(uuid) from public, anon, authenticated;
grant execute on function public.activate_b2c_daily_sales_import(uuid) to service_role;

-- Keep one authoritative active source when a manager switches back to a
-- legacy 30-day-total import.
create or replace function public.activate_b2c_sales_30d_import(p_import_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.b2c_sales_30d_imports b
    where b.id = p_import_id and b.row_count > 0 and
      (select count(*) from public.b2c_sales_30d_rows r where r.import_id = p_import_id) = b.row_count
  ) then
    raise exception 'B2C import does not exist or is incomplete';
  end if;
  update public.b2c_sales_30d_imports set is_active = false where is_active;
  update public.b2c_sales_30d_imports set is_active = true where id = p_import_id;
  update public.b2c_daily_sales_imports set is_active = false where is_active;
end;
$$;
revoke all on function public.activate_b2c_sales_30d_import(uuid) from public, anon, authenticated;
grant execute on function public.activate_b2c_sales_30d_import(uuid) to service_role;
