-- ============================================================================
-- 0364 - BUDALERTS BRAND MENUS  (D241)
--
-- WHY. Some vendors we carry sell on none of Cultivera, GrowFlow or LeafLink,
-- so the Vendor Menus page has no menu for them. Budalerts (budalerts.com)
-- lists the products of those brands at Washington stores with photos and
-- prices. Owner, verbatim (D241): "I have received permission from them to
-- use their brand photos and descriptions and prices for the brands I carry
-- currently. so long as we do not advertise or sell the info, we are fine to
-- use it internally." INTERNAL USE ONLY. Nothing here is read by the public
-- site, Leafly, Weedmaps or any syndication.
--
-- WHAT.
--   1. public.budalerts_brand_links: which Budalerts brand page (slug) belongs
--      to which vendor card. A person links it (exact-slug suggestions only).
--   2. public.budalerts_brand_snapshots: one row per polite pull of one brand
--      (main page plus its category pages), with what the page said.
--   3. public.budalerts_menu_items: the listings of a pull. Money in INTEGER
--      MINOR UNITS (cents). description stays null unless a page carries one
--      (none do today). media_asset_id is set when a photo is saved to the
--      media library (kept as a draft, never auto-published).
--   4. public.budalerts_fetch_state: one row (id 1). The time of the last
--      request to budalerts.com (the 3 second gap holds across servers), a
--      run lease so two runs never overlap, and the background switch.
--
-- RESET. KEEP in the factory reset core. FKs only to vendors and media_assets
-- (both KEEP) and to our own tables.
--
-- Service role only, RLS on. Idempotent: safe to run more than once.
-- ROLLBACK: supabase/rollbacks/0364_budalerts_menus.rollback.sql
-- ============================================================================

-- 1. brand links -------------------------------------------------------------
create table if not exists public.budalerts_brand_links (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  slug        text not null,
  brand_name  text,
  linked_by   uuid,
  linked_at   timestamptz not null default now(),
  constraint budalerts_brand_links_slug_chk check (slug ~ '^[a-z0-9]([a-z0-9-]{0,118}[a-z0-9])?$'),
  constraint budalerts_brand_links_uq unique (vendor_id, slug)
);

create index if not exists idx_budalerts_brand_links_slug on public.budalerts_brand_links (slug);

alter table public.budalerts_brand_links enable row level security;
revoke all on table public.budalerts_brand_links from public, anon, authenticated;
grant select, insert, update, delete on table public.budalerts_brand_links to service_role;

comment on table public.budalerts_brand_links is
  'D241 (0364): Budalerts brand page (slug) to vendor card, linked by a person. Internal use only (owner permission from Budalerts). Service role only.';

-- 2. brand snapshots ---------------------------------------------------------
create table if not exists public.budalerts_brand_snapshots (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null,
  brand_name        text,
  status            text not null default 'fetched',
  error_message     text,
  item_count        integer not null default 0,
  image_count       integer not null default 0,
  listing_count     integer,
  dispensary_count  integer,
  checked_text      text,
  logo_url          text,
  pages_fetched     integer not null default 0,
  categories        jsonb not null default '[]'::jsonb,
  warnings          jsonb not null default '[]'::jsonb,
  fetched_by        uuid,
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint budalerts_brand_snapshots_slug_chk check (slug ~ '^[a-z0-9]([a-z0-9-]{0,118}[a-z0-9])?$'),
  constraint budalerts_brand_snapshots_status_chk check (status in ('fetched', 'partial', 'empty', 'error')),
  constraint budalerts_brand_snapshots_counts_chk check (item_count >= 0 and image_count >= 0 and pages_fetched >= 0),
  constraint budalerts_brand_snapshots_error_chk check (error_message is null or length(error_message) <= 1000)
);

create index if not exists idx_budalerts_snapshots_slug_fetched
  on public.budalerts_brand_snapshots (slug, fetched_at desc);
create index if not exists idx_budalerts_snapshots_fetched
  on public.budalerts_brand_snapshots (fetched_at desc);

alter table public.budalerts_brand_snapshots enable row level security;
revoke all on table public.budalerts_brand_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.budalerts_brand_snapshots to service_role;

comment on table public.budalerts_brand_snapshots is
  'D241 (0364): one polite pull of one Budalerts brand (main page + category pages). Internal use only. Service role only.';

-- 3. menu items --------------------------------------------------------------
create table if not exists public.budalerts_menu_items (
  id                    uuid primary key default gen_random_uuid(),
  snapshot_id           uuid not null references public.budalerts_brand_snapshots(id) on delete cascade,
  product_id            text not null,
  name                  text not null,
  brand                 text,
  category              text,
  size_label            text,
  strain                text,
  price_minor           integer,
  price_per_gram_minor  integer,
  below_similar_pct     integer,
  availability          text,
  seller_name           text,
  seller_url            text,
  product_url           text,
  image_url             text,
  description           text,
  media_asset_id        uuid references public.media_assets(id) on delete set null,
  seen_on               text[] not null default '{}'::text[],
  position              integer not null default 0,
  created_at            timestamptz not null default now(),
  constraint budalerts_menu_items_price_chk check (price_minor is null or price_minor >= 0),
  constraint budalerts_menu_items_ppg_chk check (price_per_gram_minor is null or price_per_gram_minor >= 0),
  constraint budalerts_menu_items_pct_chk check (below_similar_pct is null or below_similar_pct between 0 and 100),
  constraint budalerts_menu_items_uq unique (snapshot_id, product_id)
);

create index if not exists idx_budalerts_items_snapshot on public.budalerts_menu_items (snapshot_id, position);
create index if not exists idx_budalerts_items_media on public.budalerts_menu_items (media_asset_id) where media_asset_id is not null;

alter table public.budalerts_menu_items enable row level security;
revoke all on table public.budalerts_menu_items from public, anon, authenticated;
grant select, insert, update, delete on table public.budalerts_menu_items to service_role;

comment on table public.budalerts_menu_items is
  'D241 (0364): listings of a Budalerts pull. price_minor in cents. description only when a page carries one. Internal use only. Service role only.';

-- 4. fetch state (one row) ---------------------------------------------------
create table if not exists public.budalerts_fetch_state (
  id               integer primary key default 1,
  last_request_at  timestamptz,
  lease_owner      text,
  lease_until      timestamptz,
  auto_enabled     boolean not null default false,
  last_run_at      timestamptz,
  last_run_note    text,
  updated_at       timestamptz not null default now(),
  constraint budalerts_fetch_state_one_row_chk check (id = 1),
  constraint budalerts_fetch_state_note_chk check (last_run_note is null or length(last_run_note) <= 1000)
);

insert into public.budalerts_fetch_state (id) values (1) on conflict (id) do nothing;

alter table public.budalerts_fetch_state enable row level security;
revoke all on table public.budalerts_fetch_state from public, anon, authenticated;
grant select, insert, update, delete on table public.budalerts_fetch_state to service_role;

comment on table public.budalerts_fetch_state is
  'D241 (0364): one row. Last request time to budalerts.com (3 second gap across servers), run lease, background switch (off by default). Service role only.';

notify pgrst, 'reload schema';
