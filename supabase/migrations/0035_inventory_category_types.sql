-- =============================================================================
-- 0035_inventory_category_types.sql  (Run 6 / Slice 23)
--
-- DB-backed, employee-manageable type registries for the back office:
--
--   * public.website_category_types  -- the curated "website category" taxonomy
--       that drives how POS items are grouped on the public menu. Historically
--       this lived only as a hardcoded array (websiteCategoryDefinitions in
--       src/lib/pos/category-taxonomy.ts). We promote it to a table so non-
--       technical staff can rename labels, edit helper text, reorder, and
--       activate/deactivate categories without a code deploy. The app falls
--       back to the hardcoded taxonomy when this table is empty / DB not set up.
--
--   * public.inventory_types       -- the free-text POS "inventory type" /
--       "inventory category" strings that arrive on imported lots/items. We let
--       staff catalog the canonical set, give each a friendly label + notes, and
--       map it to a website_category for grouping. This is the manageable
--       version of what used to be an uncontrolled free-text field.
--
-- Both tables seed from the current hardcoded defaults (idempotent) so the very
-- first deploy looks identical to today. Deletion guards live in the app layer
-- (a type that is referenced by live data is deactivated, never hard-deleted).
--
-- Money: n/a.  Rates: n/a.
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Website category types (curated grouping taxonomy)
-- ---------------------------------------------------------------------------
create table if not exists public.website_category_types (
  -- Stable slug value (matches GreenwayCategory). Primary key so the app can key
  -- off it exactly like the old hardcoded `value`.
  value        text primary key,
  label        text not null,
  helper       text not null default '',
  -- Lower sorts first; mirrors the order of the original hardcoded array.
  sort_order   integer not null default 0,
  -- Inactive categories stay in the DB (so historical references resolve) but
  -- are hidden from new-assignment pickers.
  is_active    boolean not null default true,
  -- True for the original seeded rows; lets the UI warn before deactivating a
  -- system category and prevents accidental hard-deletes of built-ins.
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Inventory types (canonical POS inventory_type / inventory_category strings)
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_types (
  id           uuid primary key default gen_random_uuid(),
  -- Canonical key, lower/trimmed form of the source string used for matching.
  key          text not null unique,
  -- Friendly display label staff can edit.
  label        text not null,
  notes        text,
  -- Optional mapping to a website category for menu grouping.
  website_category text references public.website_category_types (value)
                   on update cascade on delete set null,
  is_active    boolean not null default true,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists inventory_types_website_category_idx
  on public.inventory_types (website_category);

-- updated_at triggers (reuse shared helper).
drop trigger if exists website_category_types_set_updated_at on public.website_category_types;
create trigger website_category_types_set_updated_at
  before update on public.website_category_types
  for each row execute function public.set_updated_at();

drop trigger if exists inventory_types_set_updated_at on public.inventory_types;
create trigger inventory_types_set_updated_at
  before update on public.inventory_types
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed website categories from the current hardcoded taxonomy (idempotent).
-- sort_order preserves the original array order. is_system = true marks builtins.
-- We DO NOT overwrite label/helper on conflict so staff edits are preserved.
-- ---------------------------------------------------------------------------
insert into public.website_category_types (value, label, helper, sort_order, is_system) values
  ('flower',                'Flower',                'Premium and regular usable marijuana flower categories (popcorn bud and infused flower excluded)', 10, true),
  ('popcorn-bud',           'Popcorn Bud',           'Popcorn bud, small bud, b-bud, snappers, bong buddies, and budget flower categories', 20, true),
  ('infused-flower',        'Infused Flower',        'Moon rocks, caviar, THC Iceberg, and other infused/coated flower products', 30, true),
  ('accessories',           'Accessories',           'Browse broad accessory sections like glass, rolling gear, batteries, dab tools, and lighters', 40, true),
  ('merch',                 'Greenway Merch',        'Official Greenway apparel and gear — tees, hoodies, hats, beanies, socks, and lanyards', 50, true),
  ('paraphernalia',         'Paraphernalia',         'POS-sourced accessories, devices, glass, pipes, batteries, wraps, and non-cannabis gear', 60, true),
  ('preroll',               'Preroll',               'Single non-infused prerolls', 70, true),
  ('blunt',                 'Blunt',                 'Raw POS Blunt rows, kept separate from standard prerolls for focused browsing', 80, true),
  ('preroll-pack',          'Preroll Pack',          'Non-infused multi-pack prerolls', 90, true),
  ('infused-preroll',       'Infused Preroll',       'Single infused prerolls', 100, true),
  ('infused-blunt',         'Infused Blunt',         'Raw POS Infused Blunt rows, kept separate from standard infused prerolls', 110, true),
  ('infused-preroll-pack',  'Infused Preroll Pack',  'Multi-pack infused prerolls and infused blunts', 120, true),
  ('cartridge',             'Cartridge',             'Cartridge categories, including live resin cartridge rows', 130, true),
  ('disposable-cartridge',  'Disposable Cartridge',  'Disposable vape/cartridge category rows', 140, true),
  ('concentrate',           'Concentrate',           'Concentrate family including carts, disposables, rosin, resin, badder, hash, RSO, and related concentrate-for-inhalation categories', 150, true),
  ('rso',                   'RSO',                   'Raw POS RSO rows, also available inside the broader concentrate family', 160, true),
  ('edible-solid',          'Edible (Solid)',        'Solid edible categories such as gummies, chocolates, chews, mints, capsules, and candies', 170, true),
  ('edible-liquid',         'Edible (Liquid)',       'Beverages, shots, soda, and other liquid edible rows', 180, true),
  ('tincture',              'Tincture',              'Raw POS Tincture rows, also available inside liquid edibles', 190, true),
  ('topical',               'Topical',               'Topicals, transdermals, bath salts, balms, lotions, and salves', 200, true),
  ('trim',                  'Trim',                  'Trim, shake, and mix flower categories', 210, true)
on conflict (value) do nothing;

-- ---------------------------------------------------------------------------
-- Backfill inventory_types from any distinct POS strings already in the data.
-- We pull from inventory_lots.category (free-text) when present, normalising to
-- a trimmed/lower key. Safe + idempotent (on conflict do nothing).
-- ---------------------------------------------------------------------------
insert into public.inventory_types (key, label)
select distinct
  lower(trim(category)) as key,
  trim(category)        as label
from public.inventory_lots
where category is not null
  and trim(category) <> ''
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Row-Level Security: staff may read; only admins may write.
-- (Mirrors tax_settings policy convention from 0030.)
-- ---------------------------------------------------------------------------
alter table public.website_category_types enable row level security;
alter table public.inventory_types        enable row level security;

drop policy if exists website_category_types_read on public.website_category_types;
create policy website_category_types_read on public.website_category_types
  for select using (public.is_staff());

drop policy if exists website_category_types_write on public.website_category_types;
create policy website_category_types_write on public.website_category_types
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists inventory_types_read on public.inventory_types;
create policy inventory_types_read on public.inventory_types
  for select using (public.is_staff());

drop policy if exists inventory_types_write on public.inventory_types;
create policy inventory_types_write on public.inventory_types
  for all using (public.is_admin()) with check (public.is_admin());
