-- =============================================================================
-- Greenway Back Office — Slice 3: Vendor / Brand database + media publishing
-- Tables: vendors, vendor_aliases, brands, brand_aliases. Plus a public-read
-- policy for PUBLISHED media assets so vendor/brand logos can be served.
--
-- Depends on Slice 1 (0001): staff_profiles, media_assets, helper fns
-- is_staff()/is_admin(), set_updated_at(), the private `media` storage bucket,
-- and the asset_status enum ('draft','published','archived').
--
-- Vendors and brands are seeded from the Slice 0 folder database
-- (back-office/GREENWAY WEBSITE/database/vendors/**) via scripts/seed/seed_vendors_brands.ts.
-- POS source strings are recorded as aliases so the importer can map any future
-- POS vendor/brand label back to a canonical vendor/brand record.
-- =============================================================================

-- ---------- vendors ----------------------------------------------------------
create table if not exists public.vendors (
  id                uuid primary key default gen_random_uuid(),
  display_name      text not null,
  slug              text not null unique,
  legal_name        text,
  mission_statement text,
  about             text,
  website           text,
  email             text,
  phone             text,
  social_json       jsonb not null default '{}'::jsonb,
  internal_notes    text,
  vendor_day_notes  text,
  logo_media_id     uuid references public.media_assets(id) on delete set null,
  hero_media_id     uuid references public.media_assets(id) on delete set null,
  product_count     integer not null default 0,
  brand_count       integer not null default 0,
  status            asset_status not null default 'draft',
  sort_order        integer not null default 0,
  created_by        uuid references public.staff_profiles(id) on delete set null,
  updated_by        uuid references public.staff_profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_vendors_status on public.vendors(status);
create index if not exists idx_vendors_slug on public.vendors(slug);

-- ---------- vendor_aliases ---------------------------------------------------
-- Maps a raw POS vendor string (or any source-system label) to a canonical
-- vendor. Used by the importer + the alias-merge tool.
create table if not exists public.vendor_aliases (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  source_name   text not null,
  source_system text not null default 'pos',
  created_at    timestamptz not null default now(),
  unique (source_system, source_name)
);
create index if not exists idx_vendor_aliases_vendor on public.vendor_aliases(vendor_id);
create index if not exists idx_vendor_aliases_source on public.vendor_aliases(lower(source_name));

-- ---------- brands -----------------------------------------------------------
create table if not exists public.brands (
  id                  uuid primary key default gen_random_uuid(),
  display_name        text not null,
  slug                text not null unique,
  vendor_id           uuid references public.vendors(id) on delete set null,
  logo_media_id       uuid references public.media_assets(id) on delete set null,
  about               text,
  mission_statement   text,
  product_philosophy  text,
  website             text,
  social_json         jsonb not null default '{}'::jsonb,
  product_count       integer not null default 0,
  status              asset_status not null default 'draft',
  sort_order          integer not null default 0,
  created_by          uuid references public.staff_profiles(id) on delete set null,
  updated_by          uuid references public.staff_profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_brands_status on public.brands(status);
create index if not exists idx_brands_vendor on public.brands(vendor_id);
create index if not exists idx_brands_slug on public.brands(slug);

-- ---------- brand_aliases ----------------------------------------------------
create table if not exists public.brand_aliases (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id) on delete cascade,
  source_name   text not null,
  source_system text not null default 'pos',
  created_at    timestamptz not null default now(),
  unique (source_system, source_name)
);
create index if not exists idx_brand_aliases_brand on public.brand_aliases(brand_id);
create index if not exists idx_brand_aliases_source on public.brand_aliases(lower(source_name));

-- ---------- updated_at triggers (reuse Slice 1 set_updated_at) ---------------
drop trigger if exists trg_vendors_updated on public.vendors;
create trigger trg_vendors_updated before update on public.vendors
  for each row execute function public.set_updated_at();

drop trigger if exists trg_brands_updated on public.brands;
create trigger trg_brands_updated before update on public.brands
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.vendors        enable row level security;
alter table public.vendor_aliases enable row level security;
alter table public.brands         enable row level security;
alter table public.brand_aliases  enable row level security;

-- vendors: staff read all; PUBLIC reads only PUBLISHED vendors (powers the
-- public vendors page). Writes via service role / app-gated server actions.
drop policy if exists vendors_staff_read on public.vendors;
create policy vendors_staff_read on public.vendors
  for select using (public.is_staff());
drop policy if exists vendors_public_read_published on public.vendors;
create policy vendors_public_read_published on public.vendors
  for select using (status = 'published');
drop policy if exists vendors_staff_write on public.vendors;
create policy vendors_staff_write on public.vendors
  for all using (public.is_staff()) with check (public.is_staff());

-- brands: same visibility model.
drop policy if exists brands_staff_read on public.brands;
create policy brands_staff_read on public.brands
  for select using (public.is_staff());
drop policy if exists brands_public_read_published on public.brands;
create policy brands_public_read_published on public.brands
  for select using (status = 'published');
drop policy if exists brands_staff_write on public.brands;
create policy brands_staff_write on public.brands
  for all using (public.is_staff()) with check (public.is_staff());

-- aliases: staff read/write; public can read aliases of published vendors/brands
-- so the front end can resolve a POS label to a published profile.
drop policy if exists vendor_aliases_staff on public.vendor_aliases;
create policy vendor_aliases_staff on public.vendor_aliases
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists vendor_aliases_public_read on public.vendor_aliases;
create policy vendor_aliases_public_read on public.vendor_aliases
  for select using (
    exists (select 1 from public.vendors v where v.id = vendor_aliases.vendor_id and v.status = 'published')
  );

drop policy if exists brand_aliases_staff on public.brand_aliases;
create policy brand_aliases_staff on public.brand_aliases
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists brand_aliases_public_read on public.brand_aliases;
create policy brand_aliases_public_read on public.brand_aliases
  for select using (
    exists (select 1 from public.brands b where b.id = brand_aliases.brand_id and b.status = 'published')
  );

-- =============================================================================
-- Media: allow PUBLIC read of PUBLISHED media assets + their storage objects so
-- logos/banners can be served on the public site. Draft assets stay staff-only.
-- =============================================================================
drop policy if exists media_public_read_published on public.media_assets;
create policy media_public_read_published on public.media_assets
  for select using (status = 'published');

-- Storage objects in the `media` bucket: public read when the linked asset is
-- published. We match on the object name == media_assets.storage_key.
drop policy if exists media_bucket_public_read_published on storage.objects;
create policy media_bucket_public_read_published on storage.objects
  for select using (
    bucket_id = 'media'
    and exists (
      select 1 from public.media_assets ma
      where ma.storage_key = storage.objects.name and ma.status = 'published'
    )
  );
