-- Power BI store-level sales can already contain B2B transactions. Never
-- silently treat an unidentified sales extract as additive B2C demand.
alter table public.b2c_daily_sales_imports
  add column if not exists sales_scope text not null default 'unverified';
alter table public.b2c_daily_sales_imports
  add constraint b2c_daily_sales_scope_valid
  check (sales_scope in ('unverified', 'b2c_only', 'all_store'));

alter table public.b2c_sales_30d_imports
  add column if not exists sales_scope text not null default 'unverified';
alter table public.b2c_sales_30d_imports
  add constraint b2c_30d_sales_scope_valid
  check (sales_scope in ('unverified', 'b2c_only', 'all_store'));
