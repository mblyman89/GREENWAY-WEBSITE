-- =============================================================================
-- 0045_sales_limits.sql  (Run 6 / Slice 34, Feature S)
--
-- CCRS sales-limits window. Owner-tunable single-transaction limits per the WA
-- statutory buckets (WAC 314-55-095, effective 1/7/2025; RCW 69.50.360). The
-- pure engine in src/lib/compliance/sales-limits-core.ts ships with the legal
-- defaults; this singleton lets staff tighten the maximums and adjust per-
-- category grams-per-unit equivalents without a code deploy.
--
-- Limits stored in GRAMS (statute mixes ounces & grams; the engine normalises
-- everything to grams: 1 oz = 28 g). unit_grams_json maps website-category slug
-- -> grams contributed by one unit, overriding the engine defaults.
--
-- Money: n/a.  Rates: n/a.
-- Idempotent: safe to re-run in the Supabase SQL editor.
-- =============================================================================

create table if not exists public.sales_limit_settings (
  id                       boolean primary key default true check (id = true),
  -- Master switch. When false the POS does not evaluate limits.
  enforce                  boolean not null default true,
  -- true  = block over-limit sales; false = warn only (drafts-style soft gate).
  hard_block               boolean not null default true,
  -- Recreational single-transaction maxima (grams). Defaults = statute.
  rec_usable_grams         numeric(10,3) not null default 28,      -- 1 oz
  rec_solid_grams          numeric(10,3) not null default 448,     -- 16 oz
  rec_concentrate_grams    numeric(10,3) not null default 7,       -- 7 g
  rec_liquid_grams         numeric(10,3) not null default 2016,    -- 72 oz
  -- Medical (DOH-database) single-transaction maxima (grams).
  med_usable_grams         numeric(10,3) not null default 84,      -- 3 oz
  med_solid_grams          numeric(10,3) not null default 1344,    -- 48 oz
  med_concentrate_grams    numeric(10,3) not null default 21,      -- 21 g
  med_liquid_grams         numeric(10,3) not null default 6048,    -- 216 oz
  -- Per-category grams-per-unit overrides: { "flower": 3.5, ... }.
  unit_grams_json          jsonb not null default '{}'::jsonb,
  notes                    text,
  updated_by               uuid references public.staff_profiles(id) on delete set null,
  updated_at               timestamptz not null default now()
);

insert into public.sales_limit_settings (id)
values (true)
on conflict (id) do nothing;

drop trigger if exists sales_limit_settings_set_updated_at on public.sales_limit_settings;
create trigger sales_limit_settings_set_updated_at
  before update on public.sales_limit_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Optional audit of evaluations that tripped the limit (for reporting).
-- ---------------------------------------------------------------------------
create table if not exists public.sales_limit_events (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid,
  customer_type text not null default 'recreational',
  blocked       boolean not null default false,
  reasons       jsonb not null default '[]'::jsonb,
  buckets       jsonb not null default '[]'::jsonb,
  actor_id      uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists sales_limit_events_created_idx
  on public.sales_limit_events (created_at desc);

-- =============================================================================
-- Row-Level Security — STAFF read, ADMIN write for settings; staff for events.
-- =============================================================================
alter table public.sales_limit_settings enable row level security;
alter table public.sales_limit_events   enable row level security;

drop policy if exists sales_limit_settings_staff_read on public.sales_limit_settings;
create policy sales_limit_settings_staff_read on public.sales_limit_settings
  for select using (public.is_staff());

drop policy if exists sales_limit_settings_admin_write on public.sales_limit_settings;
create policy sales_limit_settings_admin_write on public.sales_limit_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists sales_limit_events_staff_all on public.sales_limit_events;
create policy sales_limit_events_staff_all on public.sales_limit_events
  for all using (public.is_staff()) with check (public.is_staff());
