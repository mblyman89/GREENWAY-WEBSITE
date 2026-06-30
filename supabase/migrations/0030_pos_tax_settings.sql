-- =============================================================================
-- 0030_pos_tax_settings.sql  (Run 4 / Slice 13)
--
-- Tax configuration for the Greenway back office reporting + POS tax engine.
--
-- Washington / Port Orchard reality (confirmed by owner):
--   * Cannabis EXCISE tax = 37% on CANNABIS products only (not accessories/merch).
--     In CCRS this is the "OtherTax"/CannabisExciseTax field; must equal 37% of
--     unit price (except medical, which is exempt).
--   * Combined SALES tax = state 6.5% + local (Port Orchard) 2.8% = 9.3%.
--     Sales tax applies to BOTH cannabis and non-cannabis retail goods.
--   * Medical sales (valid card + med endorsement + medically-compliant product)
--     are EXEMPT from BOTH sales and excise tax. The exemption is NOT a discount.
--
-- Single-row settings table (id = TRUE) so there is exactly one config. Rates are
-- stored as basis points (integer) to avoid float drift: 3700 = 37.00%.
-- All idempotent: safe to run repeatedly in the Supabase SQL editor.
-- =============================================================================

create table if not exists public.tax_settings (
  id                         boolean primary key default true,
  -- Cannabis excise rate in basis points. 3700 = 37.00%.
  excise_rate_bps            integer not null default 3700,
  -- State sales tax in basis points. 650 = 6.50%.
  state_sales_rate_bps       integer not null default 650,
  -- Local (Port Orchard) sales tax in basis points. 280 = 2.80%.
  local_sales_rate_bps       integer not null default 280,
  -- Whether the store currently holds a DOH medical endorsement (enables the
  -- medical excise/sales exemption path in the tax engine + reports).
  medical_endorsement        boolean not null default false,
  -- Whether excise applies before sales tax is computed (WA: excise & sales are
  -- both itemized on the pre-tax price; sales tax base does NOT include excise).
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint tax_settings_singleton check (id = true)
);

-- Per-category cannabis flag: which Greenway categories are cannabis (excise-eligible).
-- Non-cannabis categories (accessories/paraphernalia/merch) get sales tax only.
-- Seeded with sensible defaults; admin can override in the UI later.
create table if not exists public.tax_category_rules (
  category        text primary key,             -- GreenwayCategory value
  is_cannabis     boolean not null default true, -- subject to 37% excise
  updated_at      timestamptz not null default now()
);

-- updated_at triggers (reuse shared helper).
drop trigger if exists tax_settings_set_updated_at on public.tax_settings;
create trigger tax_settings_set_updated_at
  before update on public.tax_settings
  for each row execute function public.set_updated_at();

drop trigger if exists tax_category_rules_set_updated_at on public.tax_category_rules;
create trigger tax_category_rules_set_updated_at
  before update on public.tax_category_rules
  for each row execute function public.set_updated_at();

-- Seed the singleton row (idempotent).
insert into public.tax_settings (id)
values (true)
on conflict (id) do nothing;

-- Seed category rules. Non-cannabis categories are flagged is_cannabis = false.
insert into public.tax_category_rules (category, is_cannabis) values
  ('flower', true),
  ('popcorn-bud', true),
  ('infused-flower', true),
  ('blunt', true),
  ('infused-blunt', true),
  ('tincture', true),
  ('rso', true),
  ('preroll', true),
  ('preroll-pack', true),
  ('infused-preroll', true),
  ('infused-preroll-pack', true),
  ('cartridge', true),
  ('disposable-cartridge', true),
  ('edible-solid', true),
  ('edible-liquid', true),
  ('concentrate', true),
  ('topical', true),
  ('trim', true),
  ('paraphernalia', false),
  ('accessories', false),
  ('merch', false)
on conflict (category) do nothing;

-- ---------------------------------------------------------------------------
-- Row-Level Security: staff may read; only admins may write.
-- ---------------------------------------------------------------------------
alter table public.tax_settings       enable row level security;
alter table public.tax_category_rules enable row level security;

drop policy if exists tax_settings_read on public.tax_settings;
create policy tax_settings_read on public.tax_settings
  for select using (public.is_staff());

drop policy if exists tax_settings_write on public.tax_settings;
create policy tax_settings_write on public.tax_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists tax_category_rules_read on public.tax_category_rules;
create policy tax_category_rules_read on public.tax_category_rules
  for select using (public.is_staff());

drop policy if exists tax_category_rules_write on public.tax_category_rules;
create policy tax_category_rules_write on public.tax_category_rules
  for all using (public.is_admin()) with check (public.is_admin());
