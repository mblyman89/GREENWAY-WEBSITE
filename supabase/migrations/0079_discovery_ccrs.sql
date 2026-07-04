-- =============================================================================
-- 0079_discovery_ccrs.sql
-- Discovery CCRS Benchmark & Insights Command Center.
--
-- Adds storage for uploaded WSLCB CCRS public-records extracts and the
-- benchmarks computed from them. The owner files a Public Records Request
-- (RCW 42.56), receives raw CSVs, and uploads them into /admin/discovery/ccrs;
-- the system normalizes rows, computes percentile benchmarks, and generates
-- vendor leads. Compared against Greenway's own live POS/PO/inventory data.
--
-- STANDING RULES honored:
--   * Idempotent: create ... if not exists / add column if not exists / guarded enum.
--   * RLS: public.is_staff() read + write, matching 0078.
--   * set_updated_at() triggers where a table has updated_at.
--   * Money in MINOR UNITS (integer cents). CCRS dollar columns are converted on import.
--   * Removable: all objects are discovery_* and gated by the Discovery kill-switch.
--   * NEVER GUESS: columns mirror the VERIFIED CCRS data model (docs/CCRS_VERIFIED_SCHEMA.md).
--
-- Depends on: 0001 helpers public.is_staff() + public.set_updated_at(); 0078 discovery_*.
-- Next migration after this is 0080.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'discovery_dataset_status') then
    create type public.discovery_dataset_status as enum ('uploading', 'ready', 'error');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'discovery_ccrs_sale_type') then
    -- Mirrors CCRS Sale.SaleType valid values, plus 'other' for anything unmapped.
    create type public.discovery_ccrs_sale_type as enum
      ('retail', 'medical', 'wholesale', 'other');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'discovery_licensee_role') then
    create type public.discovery_licensee_role as enum
      ('producer', 'processor', 'producer_processor', 'retailer', 'lab', 'unknown');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- discovery_datasets — one row per uploaded CCRS extract batch
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_datasets (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  period_start   date,
  period_end     date,
  status         public.discovery_dataset_status not null default 'uploading',
  source_note    text,
  -- per-file ingested row counts
  sales_rows     integer not null default 0,
  product_rows   integer not null default 0,
  inventory_rows integer not null default 0,
  lab_rows       integer not null default 0,
  strain_rows    integer not null default 0,
  error          text,
  benchmarks_computed_at timestamptz,
  uploaded_by    uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- discovery_ccrs_sales — normalized Sale rows (Product fields denormalized in)
-- Money in MINOR UNITS. quantity is a decimal (grams/units) so stored as numeric.
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_ccrs_sales (
  id                 bigint generated always as identity primary key,
  dataset_id         uuid not null references public.discovery_datasets(id) on delete cascade,
  seller_license     text,
  buyer_license      text,
  sale_type          public.discovery_ccrs_sale_type not null default 'other',
  sale_date          date,
  quantity_num       numeric,
  unit_price_minor   integer,   -- cents
  discount_minor     integer,   -- cents
  sales_tax_minor    integer,   -- cents
  other_tax_minor    integer,   -- cents
  inventory_ext_id   text,
  sale_ext_id        text,
  -- denormalized product context (joined from Product on import when available)
  product_category   text,
  product_type       text,
  product_name       text,
  brand              text,
  unit_weight_grams  numeric,
  price_per_gram_minor integer, -- cents per gram (derived), null when weight unknown
  created_at         timestamptz not null default now()
);
create index if not exists idx_disc_ccrs_sales_dataset       on public.discovery_ccrs_sales (dataset_id);
create index if not exists idx_disc_ccrs_sales_type           on public.discovery_ccrs_sales (dataset_id, sale_type);
create index if not exists idx_disc_ccrs_sales_category       on public.discovery_ccrs_sales (dataset_id, product_category);
create index if not exists idx_disc_ccrs_sales_seller         on public.discovery_ccrs_sales (dataset_id, seller_license);
create index if not exists idx_disc_ccrs_sales_inv_ext        on public.discovery_ccrs_sales (dataset_id, inventory_ext_id);

-- ---------------------------------------------------------------------------
-- discovery_ccrs_products — Product rows
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_ccrs_products (
  id                 bigint generated always as identity primary key,
  dataset_id         uuid not null references public.discovery_datasets(id) on delete cascade,
  license_number     text,
  category           text,
  product_type       text,
  name               text,
  brand              text,
  description        text,
  unit_weight_grams  numeric,
  ext_id             text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_disc_ccrs_products_dataset on public.discovery_ccrs_products (dataset_id);
create index if not exists idx_disc_ccrs_products_ext      on public.discovery_ccrs_products (dataset_id, ext_id);

-- ---------------------------------------------------------------------------
-- discovery_ccrs_lab — LabTest rows (potency benchmarks)
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_ccrs_lab (
  id                 bigint generated always as identity primary key,
  dataset_id         uuid not null references public.discovery_datasets(id) on delete cascade,
  inventory_ext_id   text,
  lab_license_number text,
  test_name          text,
  test_value_num     numeric,
  test_date          date,
  created_at         timestamptz not null default now()
);
create index if not exists idx_disc_ccrs_lab_dataset on public.discovery_ccrs_lab (dataset_id);
create index if not exists idx_disc_ccrs_lab_inv_ext  on public.discovery_ccrs_lab (dataset_id, inventory_ext_id);

-- ---------------------------------------------------------------------------
-- discovery_ccrs_licensees — derived supplier roster (populated on compute)
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_ccrs_licensees (
  id                    bigint generated always as identity primary key,
  dataset_id            uuid not null references public.discovery_datasets(id) on delete cascade,
  license_number        text not null,
  name                  text,
  role                  public.discovery_licensee_role not null default 'unknown',
  wholesale_out_units   numeric not null default 0,
  wholesale_out_minor   bigint not null default 0,   -- cents
  created_at            timestamptz not null default now(),
  unique (dataset_id, license_number)
);
create index if not exists idx_disc_ccrs_licensees_dataset on public.discovery_ccrs_licensees (dataset_id);

-- ---------------------------------------------------------------------------
-- discovery_benchmarks — computed percentile rollups (the durable artifact)
-- One row per (dataset, scope, scope_key, metric). Money percentiles in MINOR
-- UNITS; value_num used for non-money metrics (units, revenue in dollars? no —
-- revenue kept in minor too via *_minor columns; value_num is for potency %/counts).
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_benchmarks (
  id            bigint generated always as identity primary key,
  dataset_id    uuid not null references public.discovery_datasets(id) on delete cascade,
  scope         text not null,           -- category | type | category_type | brand | strain | overall
  scope_key     text not null,           -- e.g. 'Flower Lot' or 'Flower Lot|Usable Marijuana'
  metric        text not null,           -- wholesale_unit_price | retail_unit_price | price_per_gram
                                          -- | units | revenue | thc_pct | cbd_pct
  sample_size   integer not null default 0,
  min_minor     integer,
  p25_minor     integer,
  median_minor  integer,
  p75_minor     integer,
  max_minor     integer,
  avg_minor     integer,
  value_num     numeric,                 -- for non-money metrics (avg potency %, unit totals)
  period_start  date,
  period_end    date,
  computed_at   timestamptz not null default now(),
  unique (dataset_id, scope, scope_key, metric)
);
create index if not exists idx_disc_benchmarks_dataset on public.discovery_benchmarks (dataset_id);
create index if not exists idx_disc_benchmarks_lookup  on public.discovery_benchmarks (dataset_id, scope, metric);

-- ---------------------------------------------------------------------------
-- updated_at triggers (only discovery_datasets has updated_at)
-- ---------------------------------------------------------------------------
drop trigger if exists set_updated_at_discovery_datasets on public.discovery_datasets;
create trigger set_updated_at_discovery_datasets
  before update on public.discovery_datasets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — staff read + write (matches 0078)
-- ---------------------------------------------------------------------------
alter table public.discovery_datasets        enable row level security;
alter table public.discovery_ccrs_sales      enable row level security;
alter table public.discovery_ccrs_products   enable row level security;
alter table public.discovery_ccrs_lab        enable row level security;
alter table public.discovery_ccrs_licensees  enable row level security;
alter table public.discovery_benchmarks      enable row level security;

drop policy if exists discovery_datasets_read on public.discovery_datasets;
create policy discovery_datasets_read on public.discovery_datasets
  for select using (public.is_staff());
drop policy if exists discovery_datasets_write on public.discovery_datasets;
create policy discovery_datasets_write on public.discovery_datasets
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists discovery_ccrs_sales_read on public.discovery_ccrs_sales;
create policy discovery_ccrs_sales_read on public.discovery_ccrs_sales
  for select using (public.is_staff());
drop policy if exists discovery_ccrs_sales_write on public.discovery_ccrs_sales;
create policy discovery_ccrs_sales_write on public.discovery_ccrs_sales
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists discovery_ccrs_products_read on public.discovery_ccrs_products;
create policy discovery_ccrs_products_read on public.discovery_ccrs_products
  for select using (public.is_staff());
drop policy if exists discovery_ccrs_products_write on public.discovery_ccrs_products;
create policy discovery_ccrs_products_write on public.discovery_ccrs_products
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists discovery_ccrs_lab_read on public.discovery_ccrs_lab;
create policy discovery_ccrs_lab_read on public.discovery_ccrs_lab
  for select using (public.is_staff());
drop policy if exists discovery_ccrs_lab_write on public.discovery_ccrs_lab;
create policy discovery_ccrs_lab_write on public.discovery_ccrs_lab
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists discovery_ccrs_licensees_read on public.discovery_ccrs_licensees;
create policy discovery_ccrs_licensees_read on public.discovery_ccrs_licensees
  for select using (public.is_staff());
drop policy if exists discovery_ccrs_licensees_write on public.discovery_ccrs_licensees;
create policy discovery_ccrs_licensees_write on public.discovery_ccrs_licensees
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists discovery_benchmarks_read on public.discovery_benchmarks;
create policy discovery_benchmarks_read on public.discovery_benchmarks
  for select using (public.is_staff());
drop policy if exists discovery_benchmarks_write on public.discovery_benchmarks;
create policy discovery_benchmarks_write on public.discovery_benchmarks
  for all using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- End 0079_discovery_ccrs.sql
-- =============================================================================
