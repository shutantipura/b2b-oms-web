-- B2C 30-day sales baselines and timestamped staff stock counts.
-- All access is through authenticated, role-checked server routes using the
-- server-only service key. No browser role has direct Data API permissions.

create table if not exists public.b2c_sales_30d_imports (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  source_filename text,
  row_count integer not null default 0 check (row_count >= 0),
  imported_by_staff_id uuid references public.staff(id) on delete set null,
  imported_at timestamptz not null default now(),
  is_active boolean not null default false,
  constraint b2c_sales_period_exactly_30_days check (period_end - period_start = 29)
);

create unique index if not exists b2c_sales_one_active_batch
  on public.b2c_sales_30d_imports (is_active) where is_active;

create table if not exists public.b2c_sales_30d_rows (
  import_id uuid not null references public.b2c_sales_30d_imports(id) on delete cascade,
  sku text not null,
  sold_qty numeric(18, 3) not null check (sold_qty >= 0),
  unit text,
  primary key (import_id, sku),
  constraint b2c_sales_sku_format check (sku ~ '^[0-9]{9}$')
);

create index if not exists b2c_sales_rows_sku
  on public.b2c_sales_30d_rows (sku);

create table if not exists public.stock_morning_counts (
  count_date date not null,
  sku text not null,
  quantity_kg numeric(18, 3) not null check (quantity_kg >= 0),
  counted_by_staff_id uuid references public.staff(id) on delete set null,
  counted_at timestamptz not null default now(),
  primary key (count_date, sku),
  constraint stock_morning_sku_format check (sku ~ '^[0-9]{9}$')
);

create index if not exists stock_morning_counts_recent
  on public.stock_morning_counts (count_date desc);

alter table public.b2c_sales_30d_imports enable row level security;
alter table public.b2c_sales_30d_rows enable row level security;
alter table public.stock_morning_counts enable row level security;

revoke all on public.b2c_sales_30d_imports from anon, authenticated;
revoke all on public.b2c_sales_30d_rows from anon, authenticated;
revoke all on public.stock_morning_counts from anon, authenticated;
grant select, insert, update, delete on public.b2c_sales_30d_imports to service_role;
grant select, insert, update, delete on public.b2c_sales_30d_rows to service_role;
grant select, insert, update, delete on public.stock_morning_counts to service_role;

-- The changeover to a new baseline must be atomic. If an import fails partway
-- through, its inactive rows cannot replace the previous active baseline.
create or replace function public.activate_b2c_sales_30d_import(p_import_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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
end;
$$;

revoke all on function public.activate_b2c_sales_30d_import(uuid) from public, anon, authenticated;
grant execute on function public.activate_b2c_sales_30d_import(uuid) to service_role;
