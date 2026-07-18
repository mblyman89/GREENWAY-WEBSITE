-- =============================================================================
-- Task CV-1 — Cultivera vendor menus (command center data model)
-- =============================================================================
-- Backs the new "vendor menus command center". The owner is an authenticated
-- Cultivera Market customer; the crawler logs in politely (human-paced), fetches
-- a vendor's LIVE menu over Cultivera's JSON API, and persists a SNAPSHOT here so
-- the buyer can browse it, save product media to the media library, and stage
-- lines for the purchase-order builder — all without re-hitting Cultivera.
--
--   1. cultivera_menu_snapshots — ONE row per fetch of one vendor's menu. Holds
--      provenance (which Cultivera market/seller, when, by whom), a status, an
--      item_count, and the RAW payload jsonb (so parsers can be revised later
--      without re-fetching). Optionally linked to our local vendors row.
--
--   2. cultivera_menu_items — the normalized line items of a snapshot. Money is
--      stored as INTEGER MINOR UNITS (cents), never floats. Potency percentages
--      are numeric; the raw potency blob is preserved. image_url / coa_url are
--      the source URLs; media_asset_id / coa_media_asset_id link to the media
--      library once the buyer saves them (CV-5).
--
-- Reuses: public.vendors(id), public.media_assets(id), public.staff_profiles(id),
--         public.is_staff(), public.set_updated_at() (earlier slices).
-- Money: INTEGER minor units (cents). Idempotent: create-if-not-exists +
--        drop-if-exists guards. APPLY MANUALLY (owner) — after 0123.
-- =============================================================================

create table if not exists public.cultivera_menu_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  -- Optional link to our local vendor (the buyer may fetch a menu before the
  -- vendor exists locally). Set-null so deleting a vendor never drops history.
  vendor_id             uuid references public.vendors(id) on delete set null,
  -- Cultivera provenance (which marketplace seller this snapshot came from).
  cultivera_market_id   text,
  cultivera_market_slug text,
  seller_name           text,
  -- 'fetched' (success) | 'partial' | 'error'. Free text; app resolves.
  status                text not null default 'fetched',
  error_message         text,
  item_count            integer not null default 0,
  -- The buyer's active Cultivera location the fetch ran under (provenance).
  location_id           text,
  -- Full raw payload as returned by Cultivera (revise parsers without re-fetch).
  raw                   jsonb not null default '{}'::jsonb,
  fetched_by            uuid references public.staff_profiles(id) on delete set null,
  fetched_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_cultivera_snapshots_vendor
  on public.cultivera_menu_snapshots (vendor_id);
create index if not exists idx_cultivera_snapshots_fetched_at
  on public.cultivera_menu_snapshots (fetched_at desc);
create index if not exists idx_cultivera_snapshots_slug
  on public.cultivera_menu_snapshots (cultivera_market_slug);

drop trigger if exists trg_cultivera_menu_snapshots_updated on public.cultivera_menu_snapshots;
create trigger trg_cultivera_menu_snapshots_updated
  before update on public.cultivera_menu_snapshots
  for each row execute function public.set_updated_at();

alter table public.cultivera_menu_snapshots enable row level security;

drop policy if exists cultivera_menu_snapshots_staff_all on public.cultivera_menu_snapshots;
create policy cultivera_menu_snapshots_staff_all on public.cultivera_menu_snapshots
  for all using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------

create table if not exists public.cultivera_menu_items (
  id                       uuid primary key default gen_random_uuid(),
  snapshot_id              uuid not null references public.cultivera_menu_snapshots(id) on delete cascade,
  -- Cultivera's stable id for this listing/product (for re-fetch diffing).
  cultivera_item_id        text,
  name                     text,
  brand                    text,
  category                 text,
  inventory_type           text,
  strain_type              text,
  size_label               text,
  unit_count               integer,
  -- Wholesale price in INTEGER MINOR UNITS (cents). Never a float.
  wholesale_price_minor    integer,
  available_qty            numeric,
  thc_pct                  numeric,
  cbd_pct                  numeric,
  total_cannabinoids_pct   numeric,
  -- Raw potency structure exactly as Cultivera returned it.
  potency_raw              jsonb not null default '{}'::jsonb,
  description              text,
  image_url                text,
  coa_url                  text,
  -- Media library links, set when the buyer saves them (CV-5).
  media_asset_id           uuid references public.media_assets(id) on delete set null,
  coa_media_asset_id       uuid references public.media_assets(id) on delete set null,
  -- Full raw line item (revise parsers without re-fetch).
  raw                      jsonb not null default '{}'::jsonb,
  -- Display order within the snapshot.
  position                 integer not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_cultivera_items_snapshot
  on public.cultivera_menu_items (snapshot_id, position);
create index if not exists idx_cultivera_items_cultivera_id
  on public.cultivera_menu_items (cultivera_item_id);

drop trigger if exists trg_cultivera_menu_items_updated on public.cultivera_menu_items;
create trigger trg_cultivera_menu_items_updated
  before update on public.cultivera_menu_items
  for each row execute function public.set_updated_at();

alter table public.cultivera_menu_items enable row level security;

drop policy if exists cultivera_menu_items_staff_all on public.cultivera_menu_items;
create policy cultivera_menu_items_staff_all on public.cultivera_menu_items
  for all using (public.is_staff()) with check (public.is_staff());
