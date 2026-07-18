-- =============================================================================
-- Task GF-1 — GrowFlow vendor menus + unified smart-search memory
-- =============================================================================
-- Extends the vendor-menus command center to a SECOND wholesale marketplace,
-- GrowFlow (marketplace.growflow.com). The owner is an authenticated GrowFlow
-- BUYER (Greenway Marijuana, license 413541, BuyerVendorId 2368) whose rep
-- approved pulling vendor menus into the back office. The crawler logs in via
-- GrowFlow's Auth0 form politely (human-paced), calls GrowFlow's GraphQL API,
-- and persists a SNAPSHOT here so the buyer can browse it, save product media,
-- and stage lines for the PO builder — all without re-hitting GrowFlow.
--
--   1. growflow_menu_snapshots — ONE row per fetch of one store's menu. Mirrors
--      cultivera_menu_snapshots (0124): provenance (which GrowFlow store/vendor,
--      when, by whom), a status, an item_count, and the RAW payload jsonb.
--
--   2. growflow_menu_items — normalized line items of a snapshot. Money is stored
--      as INTEGER MINOR UNITS (cents), never floats. Potency percentages are
--      numeric; the raw potency blob is preserved. image_url / coa_url are source
--      URLs; media_asset_id / coa_media_asset_id link to the media library once
--      the buyer saves them (GF-6).
--
--   3. vendor_platform_map — SMART-SEARCH MEMORY. Remembers which marketplace a
--      given vendor's menu was last found on ('cultivera' | 'growflow') keyed by
--      a normalized vendor name and/or license number, so the unified search hits
--      the known platform FIRST instead of searching both every time.
--
-- Reuses: public.vendors(id), public.media_assets(id), public.staff_profiles(id),
--         public.is_staff(), public.set_updated_at() (earlier slices).
-- Money: INTEGER minor units (cents). Idempotent: create-if-not-exists +
--        drop-if-exists guards. APPLY MANUALLY (owner) — after 0124.
-- =============================================================================

create table if not exists public.growflow_menu_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  -- Optional link to our local vendor (a menu may be fetched before the vendor
  -- exists locally). Set-null so deleting a vendor never drops history.
  vendor_id             uuid references public.vendors(id) on delete set null,
  -- GrowFlow provenance (which storefront this snapshot came from).
  growflow_store_id     text,
  growflow_vendor_id    text,
  store_name            text,
  license_number        text,
  -- 'fetched' (success) | 'partial' | 'error'. Free text; app resolves.
  status                text not null default 'fetched',
  error_message         text,
  item_count            integer not null default 0,
  -- The buyer vendor context the fetch ran under (provenance). GrowFlow scopes
  -- everything by the buyer's BuyerVendorId (e.g. 2368 for Greenway).
  buyer_vendor_id       text,
  -- Full raw payload as returned by GrowFlow (revise parsers without re-fetch).
  raw                   jsonb not null default '{}'::jsonb,
  fetched_by            uuid references public.staff_profiles(id) on delete set null,
  fetched_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_growflow_snapshots_vendor
  on public.growflow_menu_snapshots (vendor_id);
create index if not exists idx_growflow_snapshots_fetched_at
  on public.growflow_menu_snapshots (fetched_at desc);
create index if not exists idx_growflow_snapshots_store
  on public.growflow_menu_snapshots (growflow_store_id);

drop trigger if exists trg_growflow_menu_snapshots_updated on public.growflow_menu_snapshots;
create trigger trg_growflow_menu_snapshots_updated
  before update on public.growflow_menu_snapshots
  for each row execute function public.set_updated_at();

alter table public.growflow_menu_snapshots enable row level security;

drop policy if exists growflow_menu_snapshots_staff_all on public.growflow_menu_snapshots;
create policy growflow_menu_snapshots_staff_all on public.growflow_menu_snapshots
  for all using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------

create table if not exists public.growflow_menu_items (
  id                       uuid primary key default gen_random_uuid(),
  snapshot_id              uuid not null references public.growflow_menu_snapshots(id) on delete cascade,
  -- GrowFlow's stable numeric product id for this listing (for re-fetch diffing).
  growflow_item_id         text,
  name                     text,
  brand                    text,
  category                 text,
  inventory_type           text,
  strain_type              text,
  size_label               text,
  unit_count               integer,
  -- Wholesale price in INTEGER MINOR UNITS (cents). Never a float. Mapped from
  -- GrowFlow's `Price` (dollar float) at fetch time.
  wholesale_price_minor    integer,
  -- MSRP in cents (GrowFlow exposes MSRP + DefaultPrice + Discount as dollars).
  msrp_minor               integer,
  available_qty            numeric,
  thc_pct                  numeric,
  cbd_pct                  numeric,
  total_cannabinoids_pct   numeric,
  -- Raw potency structure exactly as GrowFlow returned it (Min/Max THC/CBD/etc).
  potency_raw              jsonb not null default '{}'::jsonb,
  description              text,
  image_url                text,
  coa_url                  text,
  -- Media library links, set when the buyer saves them (GF-6).
  media_asset_id           uuid references public.media_assets(id) on delete set null,
  coa_media_asset_id       uuid references public.media_assets(id) on delete set null,
  -- Full raw line item (revise parsers without re-fetch).
  raw                      jsonb not null default '{}'::jsonb,
  -- Display order within the snapshot.
  position                 integer not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_growflow_items_snapshot
  on public.growflow_menu_items (snapshot_id);

drop trigger if exists trg_growflow_menu_items_updated on public.growflow_menu_items;
create trigger trg_growflow_menu_items_updated
  before update on public.growflow_menu_items
  for each row execute function public.set_updated_at();

alter table public.growflow_menu_items enable row level security;

drop policy if exists growflow_menu_items_staff_all on public.growflow_menu_items;
create policy growflow_menu_items_staff_all on public.growflow_menu_items
  for all using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- 3. vendor_platform_map — smart-search memory
-- -----------------------------------------------------------------------------
-- Remembers which marketplace a vendor's menu was last found on so the unified
-- search hits the known platform FIRST. Keyed by a normalized (lowercased,
-- trimmed) vendor name; license_number is stored when known for a stronger key.
-- `platform` is 'cultivera' | 'growflow'. `platform_ref` is that platform's
-- store/market id so we can jump straight to the menu without re-searching.

create table if not exists public.vendor_platform_map (
  id                 uuid primary key default gen_random_uuid(),
  -- Normalized vendor name (lowercase, collapsed whitespace). The lookup key.
  vendor_key         text not null,
  -- Original display name as seen on the platform (for UI).
  vendor_name        text,
  license_number     text,
  -- 'cultivera' | 'growflow'. Free text; app resolves.
  platform           text not null,
  -- That platform's store/market id (Cultivera market Id, GrowFlow store Id).
  platform_ref       text,
  -- That platform's slug (Cultivera UniqueSlug) when applicable.
  platform_slug      text,
  -- Optional link to our local vendor.
  vendor_id          uuid references public.vendors(id) on delete set null,
  -- Bump every time we confirm a menu on this platform (recency for tie-break).
  last_seen_at       timestamptz not null default now(),
  hit_count          integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One remembered platform per (vendor_key, platform) pair; upsert bumps recency.
create unique index if not exists uq_vendor_platform_map_key_platform
  on public.vendor_platform_map (vendor_key, platform);
create index if not exists idx_vendor_platform_map_key
  on public.vendor_platform_map (vendor_key);
create index if not exists idx_vendor_platform_map_last_seen
  on public.vendor_platform_map (last_seen_at desc);

drop trigger if exists trg_vendor_platform_map_updated on public.vendor_platform_map;
create trigger trg_vendor_platform_map_updated
  before update on public.vendor_platform_map
  for each row execute function public.set_updated_at();

alter table public.vendor_platform_map enable row level security;

drop policy if exists vendor_platform_map_staff_all on public.vendor_platform_map;
create policy vendor_platform_map_staff_all on public.vendor_platform_map
  for all using (public.is_staff()) with check (public.is_staff());
