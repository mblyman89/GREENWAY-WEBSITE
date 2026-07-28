-- =============================================================================
-- SLICE 84 — LeafLink vendor menus (third marketplace)
-- =============================================================================
-- Extends the vendor-menus command center to a THIRD wholesale marketplace,
-- LeafLink (app.leaflink.com). The owner is an authenticated LeafLink RETAILER
-- (Greenway Marijuana, company slug greenway-marijuana, company id 3053). The
-- crawler logs in via LeafLink's Auth0 form politely (human-paced), calls
-- LeafLink's cookie-authenticated internal API (pinned live — see
-- crawler/docs/LEAFLINK_PINNED.md), and persists a SNAPSHOT here so the buyer
-- can browse it, save product media, and stage lines for the PO builder — all
-- without re-hitting LeafLink.
--
--   1. leaflink_menu_snapshots — ONE row per fetch of one BRAND's menu.
--      Mirrors growflow_menu_snapshots (0125): provenance (which LeafLink
--      brand/company, when, by whom), a status, an item_count, and the RAW
--      payload jsonb. LeafLink's menu unit is the BRAND (its product search
--      groups by brand {id, name, company}); sellers don't expose license
--      numbers through the pinned endpoints, so identity is brand + company.
--
--   2. leaflink_menu_items — normalized line items of a snapshot. Money is
--      stored as INTEGER MINOR UNITS (cents), never floats — LeafLink's
--      wholesale_price arrives as {amount:"112.50"} / 60 / "60.00" (pinned)
--      and is converted by the LL-1 normalizers at fetch time. Descriptions
--      arrive as HTML and are stored as plain text. image_url is the first of
--      the pinned `images` array (plain CloudFront URL strings);
--      media_asset_id links to the media library once the buyer saves it.
--
-- vendor_platform_map (0125) already stores `platform` as FREE TEXT, so the
-- smart-search memory accepts 'leaflink' rows with NO schema change here.
--
-- Reuses: public.vendors(id), public.media_assets(id), public.staff_profiles(id),
--         public.is_staff(), public.set_updated_at() (earlier slices).
-- Money: INTEGER minor units (cents). Idempotent: create-if-not-exists +
--        drop-if-exists guards. APPLY MANUALLY (owner) — after 0144.
-- =============================================================================

create table if not exists public.leaflink_menu_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  -- Optional link to our local vendor (a menu may be fetched before the vendor
  -- exists locally). Set-null so deleting a vendor never drops history.
  vendor_id             uuid references public.vendors(id) on delete set null,
  -- LeafLink provenance (which brand this snapshot came from).
  leaflink_brand_id     text,
  brand_name            text,
  -- The SELLING company behind the brand (LeafLink brands belong to companies;
  -- a distributor may sell several brands). Pinned: brand.company {id, name}.
  company_name          text,
  -- The brand's own description (pinned: brands/<id> header), plain text.
  brand_description     text,
  -- 'fetched' (success) | 'empty' | 'error'. Free text; app resolves.
  status                text not null default 'fetched',
  error_message         text,
  item_count            integer not null default 0,
  -- Full raw payload as returned by the worker (revise parsers without re-fetch).
  raw                   jsonb not null default '{}'::jsonb,
  fetched_by            uuid references public.staff_profiles(id) on delete set null,
  fetched_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_leaflink_snapshots_vendor
  on public.leaflink_menu_snapshots (vendor_id);
create index if not exists idx_leaflink_snapshots_fetched_at
  on public.leaflink_menu_snapshots (fetched_at desc);
create index if not exists idx_leaflink_snapshots_brand
  on public.leaflink_menu_snapshots (leaflink_brand_id);

drop trigger if exists trg_leaflink_menu_snapshots_updated on public.leaflink_menu_snapshots;
create trigger trg_leaflink_menu_snapshots_updated
  before update on public.leaflink_menu_snapshots
  for each row execute function public.set_updated_at();

alter table public.leaflink_menu_snapshots enable row level security;

drop policy if exists leaflink_menu_snapshots_staff_all on public.leaflink_menu_snapshots;
create policy leaflink_menu_snapshots_staff_all on public.leaflink_menu_snapshots
  for all using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------

create table if not exists public.leaflink_menu_items (
  id                       uuid primary key default gen_random_uuid(),
  snapshot_id              uuid not null references public.leaflink_menu_snapshots(id) on delete cascade,
  -- LeafLink's stable numeric product id for this listing (for re-fetch diffing).
  leaflink_item_id         text,
  name                     text,
  brand                    text,
  category                 text,
  inventory_type           text,
  strain_type              text,
  size_label               text,
  unit_count               integer,
  -- Wholesale price in INTEGER MINOR UNITS (cents). Never a float. Mapped from
  -- LeafLink's `wholesale_price` ({amount:"112.50"} / 60 / "60.00" — pinned).
  wholesale_price_minor    integer,
  -- Suggested retail in cents (LeafLink `retail_price`), when exposed.
  msrp_minor               integer,
  -- Pinned: `quantity` arrives as a stringified decimal ("1857.000000").
  available_qty            numeric,
  thc_pct                  numeric,
  cbd_pct                  numeric,
  total_cannabinoids_pct   numeric,
  -- Raw potency/spec structure exactly as LeafLink returned it
  -- (product_specs [{name:"THC", value:"100 mg"}] — often mg, not %).
  potency_raw              jsonb not null default '{}'::jsonb,
  -- Product description (HTML at the source, stored as plain text).
  description              text,
  image_url                text,
  coa_url                  text,
  -- Media library link, set when the buyer saves the image.
  media_asset_id           uuid references public.media_assets(id) on delete set null,
  coa_media_asset_id       uuid references public.media_assets(id) on delete set null,
  -- LeafLink product-line grouping ("Fruit Chews") and SKU, when known.
  product_line             text,
  sku                      text,
  -- Full raw line item (revise parsers without re-fetch).
  raw                      jsonb not null default '{}'::jsonb,
  -- Display order within the snapshot.
  position                 integer not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_leaflink_items_snapshot
  on public.leaflink_menu_items (snapshot_id);

drop trigger if exists trg_leaflink_menu_items_updated on public.leaflink_menu_items;
create trigger trg_leaflink_menu_items_updated
  before update on public.leaflink_menu_items
  for each row execute function public.set_updated_at();

alter table public.leaflink_menu_items enable row level security;

drop policy if exists leaflink_menu_items_staff_all on public.leaflink_menu_items;
create policy leaflink_menu_items_staff_all on public.leaflink_menu_items
  for all using (public.is_staff()) with check (public.is_staff());
