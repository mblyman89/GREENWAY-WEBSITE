-- 0078_discovery.sql
-- Product & Vendor Discovery — the leads funnel at the top of Product Intake.
--
-- Purpose: capture and qualify candidate VENDORS and PRODUCTS to pursue, then
-- promote a qualified lead straight into the existing Purchasing pipeline
-- (purchase_orders / purchase_order_lines, migration 0048). This is the DIRECT
-- (no web-crawler) implementation described in docs/RESEARCH_CRAWL4AI_DISCOVERY.md
-- and planned in docs/ROADMAP_DISCOVERY_FEATURE.md.
--
-- Sources of truth this builds on (already in the DB):
--   * vendors          — display_name, legal_name, license_number, email, status
--                        (migrations 0003 + 0064) → reconciliation target.
--   * purchase_orders  — a promoted product lead becomes a PO (migration 0048).
--
-- Design rules honored here:
--   * DRAFTS-ONLY: leads never auto-insert into vendors/catalog/POs. FKs into
--     vendors/purchase_orders are ON DELETE SET NULL and Discovery only READS
--     those tables, so the whole feature is cleanly removable.
--   * REMOVABLE: a discovery_settings.enabled kill-switch turns the feature off
--     without touching purchasing.
--   * Money in MINOR UNITS (cents).
--   * Idempotent: safe to re-run in the Supabase SQL editor.
--
-- Depends on Slice 1 (0001): helper fns is_staff() and set_updated_at(),
-- and staff_profiles for created_by/updated_by.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'discovery_source_kind') then
    create type public.discovery_source_kind as enum (
      'wslcb_license_list', -- WA LCB public licensed-vendor lists (see commercial-use note)
      'market_data',        -- paid market intelligence (Headset/BDSA) — future
      'vendor_site',        -- a public vendor/producer catalog page
      'trade_show',         -- captured at an event
      'manual',             -- typed in by staff
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'discovery_vendor_status') then
    create type public.discovery_vendor_status as enum (
      'new', 'reviewing', 'contacted', 'qualified', 'onboarded', 'dismissed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'discovery_product_status') then
    create type public.discovery_product_status as enum (
      'new', 'reviewing', 'shortlisted', 'ordered', 'dismissed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'discovery_match_state') then
    create type public.discovery_match_state as enum (
      'unmatched',  -- no existing vendor found — a genuinely new prospect
      'possible',   -- a fuzzy name match — needs a human to confirm
      'existing'    -- confident match (license number) — we already know them
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'discovery_priority') then
    create type public.discovery_priority as enum ('high', 'med', 'low');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- discovery_settings: singleton — global kill-switch + defaults.
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_settings (
  id                smallint primary key default 1,
  -- master on/off. When false, the app shows a disabled notice and skips reads.
  enabled           boolean not null default true,
  -- default WA market label used when creating leads (informational).
  default_market    text not null default 'Washington',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint discovery_settings_singleton check (id = 1)
);

insert into public.discovery_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- discovery_sources: where a lead can come from, with a per-source
-- commercial-use flag + note (holds the RCW 42.56.070(8) caveat for LCB data).
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_sources (
  id                 uuid primary key default gen_random_uuid(),
  kind               public.discovery_source_kind not null default 'manual',
  name               text not null,
  url                text,
  -- whether this source's data is cleared for COMMERCIAL use (see note).
  commercial_use_ok  boolean not null default true,
  notes              text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists discovery_sources_kind_idx on public.discovery_sources (kind, active);

-- Seed the two baseline sources (idempotent via name uniqueness check).
insert into public.discovery_sources (kind, name, url, commercial_use_ok, notes)
select 'manual', 'Manual entry', null, true, 'Leads typed in by staff.'
where not exists (select 1 from public.discovery_sources where name = 'Manual entry');

insert into public.discovery_sources (kind, name, url, commercial_use_ok, notes)
select
  'wslcb_license_list',
  'WSLCB — Cannabis License Applicants',
  'https://lcb.wa.gov/records/frequently-requested-lists',
  false,
  'Authoritative WA licensed producer/processor + retailer list. CAVEAT: per RCW 42.56.070(8), records received through the Public Records Act may not be used for commercial purposes. Confirm commercial-use clearance before relying on this for purchasing decisions.'
where not exists (select 1 from public.discovery_sources where name = 'WSLCB — Cannabis License Applicants');

-- ---------------------------------------------------------------------------
-- discovery_vendor_leads: candidate VENDORS to pursue.
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_vendor_leads (
  id                 uuid primary key default gen_random_uuid(),
  source_id          uuid references public.discovery_sources (id) on delete set null,
  legal_name         text,
  display_name       text not null,
  license_number     text,
  city               text,
  website            text,
  email              text,
  status             public.discovery_vendor_status not null default 'new',
  priority           public.discovery_priority not null default 'med',
  -- reconciliation against existing vendors (drafts-only; never auto-merges).
  matched_vendor_id  uuid references public.vendors (id) on delete set null,
  match_state        public.discovery_match_state not null default 'unmatched',
  note               text,
  -- normalized uniqueness key (license number, else slug of legal/display name)
  -- so the same lead isn't imported twice.
  dedupe_key         text unique,
  created_by         uuid references public.staff_profiles (id) on delete set null,
  updated_by         uuid references public.staff_profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists discovery_vendor_leads_status_idx on public.discovery_vendor_leads (status, priority);
create index if not exists discovery_vendor_leads_match_idx on public.discovery_vendor_leads (match_state);
create index if not exists discovery_vendor_leads_source_idx on public.discovery_vendor_leads (source_id);

-- ---------------------------------------------------------------------------
-- discovery_product_leads: candidate PRODUCTS to pursue.
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_product_leads (
  id                        uuid primary key default gen_random_uuid(),
  source_id                 uuid references public.discovery_sources (id) on delete set null,
  -- optionally tied to a vendor lead (who makes/sells it).
  vendor_lead_id            uuid references public.discovery_vendor_leads (id) on delete set null,
  product_name              text not null,
  brand                     text,
  category                  text,
  pack_size                 text,
  -- estimated economics in MINOR UNITS (cents); nullable when unknown.
  est_unit_cost_minor_units integer,
  est_retail_minor_units    integer,
  -- free-text "why pursue this" (e.g. rising category, customer requests).
  demand_signal             text,
  status                    public.discovery_product_status not null default 'new',
  priority                  public.discovery_priority not null default 'med',
  note                      text,
  -- when promoted into a PO, the resulting purchase order (read-only link).
  promoted_po_id            uuid references public.purchase_orders (id) on delete set null,
  dedupe_key                text unique,
  created_by                uuid references public.staff_profiles (id) on delete set null,
  updated_by                uuid references public.staff_profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists discovery_product_leads_status_idx on public.discovery_product_leads (status, priority);
create index if not exists discovery_product_leads_vendorlead_idx on public.discovery_product_leads (vendor_lead_id);
create index if not exists discovery_product_leads_source_idx on public.discovery_product_leads (source_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse shared helper)
-- ---------------------------------------------------------------------------
drop trigger if exists set_updated_at_discovery_settings on public.discovery_settings;
create trigger set_updated_at_discovery_settings
  before update on public.discovery_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_discovery_sources on public.discovery_sources;
create trigger set_updated_at_discovery_sources
  before update on public.discovery_sources
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_discovery_vendor_leads on public.discovery_vendor_leads;
create trigger set_updated_at_discovery_vendor_leads
  before update on public.discovery_vendor_leads
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_discovery_product_leads on public.discovery_product_leads;
create trigger set_updated_at_discovery_product_leads
  before update on public.discovery_product_leads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — staff read + write (discovery is inventory/purchasing-side work).
-- ---------------------------------------------------------------------------
alter table public.discovery_settings       enable row level security;
alter table public.discovery_sources        enable row level security;
alter table public.discovery_vendor_leads   enable row level security;
alter table public.discovery_product_leads  enable row level security;

drop policy if exists discovery_settings_read on public.discovery_settings;
create policy discovery_settings_read on public.discovery_settings
  for select using (public.is_staff());
drop policy if exists discovery_settings_write on public.discovery_settings;
create policy discovery_settings_write on public.discovery_settings
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists discovery_sources_read on public.discovery_sources;
create policy discovery_sources_read on public.discovery_sources
  for select using (public.is_staff());
drop policy if exists discovery_sources_write on public.discovery_sources;
create policy discovery_sources_write on public.discovery_sources
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists discovery_vendor_leads_read on public.discovery_vendor_leads;
create policy discovery_vendor_leads_read on public.discovery_vendor_leads
  for select using (public.is_staff());
drop policy if exists discovery_vendor_leads_write on public.discovery_vendor_leads;
create policy discovery_vendor_leads_write on public.discovery_vendor_leads
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists discovery_product_leads_read on public.discovery_product_leads;
create policy discovery_product_leads_read on public.discovery_product_leads
  for select using (public.is_staff());
drop policy if exists discovery_product_leads_write on public.discovery_product_leads;
create policy discovery_product_leads_write on public.discovery_product_leads
  for all using (public.is_staff()) with check (public.is_staff());
