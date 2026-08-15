-- =============================================================================
-- 0080_discovery_competitors.sql
-- Local competitor & area benchmarking roster.
--
-- Adds a roster of licensed WA cannabis retailers in Greenway's competitive
-- footprint (Port Orchard, Bremerton, Silverdale, Tacoma, Key Peninsula/Gig
-- Harbor, nearby Kitsap). Each row maps a WSLCB LicenseNumber -> tradename ->
-- city -> area, plus a flag marking Greenway itself. This roster is the KEY that
-- lets us slice the uploaded CCRS Sale rows (which carry seller_license /
-- buyer_license) into per-competitor and per-area benchmarks:
--   * retail prices a competitor SELLS at  (their RecreationalRetail rows)
--   * wholesale cost a competitor PAYS     (Wholesale rows where they are buyer)
--   * who a competitor BUYS from           (the seller on those wholesale rows)
--
-- SOURCE OF TRUTH for the seeded roster: WSLCB "Frequently Requested Lists" ->
-- Cannabis License Applicants (public licensing info, NOT PRA transaction data,
-- so it carries no commercial-use caveat). Verified 2026-06-30 extract.
--
-- STANDING RULES honored:
--   * Idempotent: create ... if not exists / guarded enum / upsert seed on conflict.
--   * RLS: public.is_staff() read + write, matching 0078/0079.
--   * set_updated_at() trigger.
--   * Depends on: 0001 helpers is_staff()/set_updated_at(); 0079 discovery_ccrs_*.
-- Next migration after this is 0081.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum: competitive area buckets (stable keys)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'discovery_competitor_area') then
    create type public.discovery_competitor_area as enum
      ('port_orchard', 'bremerton', 'silverdale', 'tacoma', 'key_peninsula', 'kitsap_other', 'other');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- discovery_competitors — roster of local licensed retailers (the CCRS key)
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_competitors (
  license_number  text primary key,
  tradename       text not null,
  city            text,
  county          text,
  area            public.discovery_competitor_area not null default 'other',
  is_self         boolean not null default false,   -- true for Greenway (413541)
  is_active       boolean not null default true,    -- carry forward WSLCB status
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_disc_competitors_area on public.discovery_competitors (area);

drop trigger if exists trg_disc_competitors_updated on public.discovery_competitors;
create trigger trg_disc_competitors_updated
  before update on public.discovery_competitors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.discovery_competitors enable row level security;

drop policy if exists discovery_competitors_read on public.discovery_competitors;
create policy discovery_competitors_read on public.discovery_competitors
  for select using (public.is_staff());
drop policy if exists discovery_competitors_write on public.discovery_competitors;
create policy discovery_competitors_write on public.discovery_competitors
  for all using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Seed the verified roster (idempotent upsert). Re-running refreshes names/areas
-- but preserves any owner edits to note. Source: WSLCB Cannabis License
-- Applicants, "Retailers 6-30-2026" sheet.
-- ---------------------------------------------------------------------------
insert into public.discovery_competitors
  (license_number, tradename, city, county, area, is_self)
values
  ('414550','420 SPOT SHOP','PORT ORCHARD','KITSAP','port_orchard',false),
  ('414103','BLOOM','TACOMA','PIERCE','tacoma',false),
  ('420661','BUDEEZ','BREMERTON','KITSAP','bremerton',false),
  ('413358','CLEAR CHOICE CANNABIS','TACOMA','PIERCE','tacoma',false),
  ('421877','CLEAR CHOICE CANNABIS','BREMERTON','KITSAP','bremerton',false),
  ('439182','CLEAR CHOICE CANNABIS','TACOMA','PIERCE','tacoma',false),
  ('423372','CRAFT TACOMA','TACOMA','PIERCE','tacoma',false),
  ('441109','DANK''S TACOMA','TACOMA','PIERCE','tacoma',false),
  ('414503','DESTINATION HIGHWAY 420','BREMERTON','KITSAP','bremerton',false),
  ('413374','DIAMOND GREEN','TACOMA','PIERCE','tacoma',false),
  ('445189','DTC HOLDINGS','SILVERDALE','KITSAP','silverdale',false),
  ('437875','EMERALD COAST','BREMERTON','KITSAP','bremerton',false),
  ('434372','EMERALD LEAVES','TACOMA','PIERCE','tacoma',false),
  ('445745','FILLABONG','SILVERDALE','KITSAP','silverdale',false),
  ('446441','FILLABONG','BREMERTON','KITSAP','bremerton',false),
  ('081400','GREEN TIKI CANNABIS','KINGSTON','KITSAP','kitsap_other',false),
  ('413541','GREENWAY MARIJUANA','PORT ORCHARD','KITSAP','port_orchard',true),
  ('427457','HERBAN MARKET','PORT ORCHARD','KITSAP','port_orchard',false),
  ('434402','HOUSE OF CANNABIS - TACOMA','TACOMA','PIERCE','tacoma',false),
  ('413427','HWY 420','SILVERDALE','KITSAP','silverdale',false),
  ('437434','HWY 420','POULSBO','KITSAP','kitsap_other',false),
  ('435420','KITSAP CANNABIS PORT ORCHARD','PORT ORCHARD','KITSAP','port_orchard',false),
  ('417880','LEGAL MARIJUANA SUPERSTORE','PORT ORCHARD','KITSAP','port_orchard',false),
  ('442174','LIDZ CANNABIS TACOMA','TACOMA','PIERCE','tacoma',false),
  ('420785','LOCAL ROOTS TACOMA','TACOMA','PIERCE','tacoma',false),
  ('424311','MARY MART INC','TACOMA','PIERCE','tacoma',false),
  ('415229','POT ZONE','PORT ORCHARD','KITSAP','port_orchard',false),
  ('434030','POT ZONE','TACOMA','PIERCE','tacoma',false),
  ('423829','SWEET JANE','GIG HARBOR','PIERCE','key_peninsula',false),
  ('436145','THE GALLERY - GIG HARBOR','GIG HARBOR','PIERCE','key_peninsula',false),
  ('413258','THE GALLERY PARKLAND','TACOMA','PIERCE','tacoma',false),
  ('423634','THE HERBAL GARDENS','TACOMA','PIERCE','tacoma',false),
  ('434494','THE JOINT','TACOMA','PIERCE','tacoma',false),
  ('434843','THE NOVEL TREE','BREMERTON','KITSAP','bremerton',false),
  ('413870','THE REEF','BREMERTON','KITSAP','bremerton',false),
  ('414449','WORLD OF WEED','TACOMA','PIERCE','tacoma',false),
  ('358302','ZIPS CANNABIS','TACOMA','PIERCE','tacoma',false),
  ('362816','ZIPS CANNABIS','TACOMA','PIERCE','tacoma',false),
  ('435728','NATURAL CARE','TACOMA','PIERCE','tacoma',false)
on conflict (license_number) do update
  set tradename = excluded.tradename,
      city      = excluded.city,
      county    = excluded.county,
      area      = excluded.area,
      is_self   = excluded.is_self;
-- NOTE: `is_active` is deliberately NOT reset here.
--
-- This clause originally ended with `is_active = true`, which meant re-running
-- this migration RESURRECTED every competitor the owner had deactivated.
-- Reproduced on a real PostgreSQL 15.18 instance: deactivating 414550 and
-- re-applying this file flipped is_active back to true.
--
-- The roster is now owner-managed from the back office
-- (/admin/discovery/competitors), so a deactivation is a deliberate human
-- decision. A seed file must never silently overturn it.
