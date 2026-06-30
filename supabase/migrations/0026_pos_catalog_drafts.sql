-- 0026_pos_catalog_drafts.sql
-- Slice 8: when a received lot has no matching product in the published menu,
-- we seed a DRAFT catalog product from the transfer JSON for an employee to
-- validate (and later publish). Nothing here is customer-facing until promoted.
--
-- We do NOT write to menu_items: that table is a version-locked snapshot of a
-- published POS menu. Drafts live in their own table so employees can review,
-- edit, and approve before anything reaches the live menu.
--
-- Idempotent: safe to run more than once.

create table if not exists public.catalog_product_drafts (
  id                  uuid primary key default gen_random_uuid(),
  -- The POS key we tried to match against menu_items.source_item_id.
  pos_product_key     text,
  source_item_id      text,           -- alias kept for clarity / future joins
  name                text not null default '',
  brand_name          text,
  vendor_name         text,
  category            text,
  inventory_type      text,
  strain_name         text,
  -- Potency carried from the COA so the draft is pre-filled.
  thc_pct             numeric,
  cbd_pct             numeric,
  total_thc_pct       numeric,
  total_cannabinoids_pct numeric,
  potency_json        jsonb,
  -- Provenance: which manifest / lot suggested this draft.
  manifest_id         uuid references public.inbound_manifests(id) on delete set null,
  lot_id              uuid references public.inventory_lots(id) on delete set null,
  lab_result_id       uuid references public.lab_results(id) on delete set null,
  -- lifecycle: draft (needs review) | approved (validated) | dismissed
  status              text not null default 'draft',
  notes               text,
  created_by          uuid references public.staff_profiles(id) on delete set null,
  updated_by          uuid references public.staff_profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists catalog_drafts_status_idx   on public.catalog_product_drafts (status);
create index if not exists catalog_drafts_poskey_idx   on public.catalog_product_drafts (pos_product_key);
create index if not exists catalog_drafts_manifest_idx on public.catalog_product_drafts (manifest_id);

-- Avoid piling up duplicate drafts for the same POS key while one is still open.
create unique index if not exists catalog_drafts_open_poskey_uidx
  on public.catalog_product_drafts (pos_product_key)
  where status = 'draft' and pos_product_key is not null;

drop trigger if exists catalog_product_drafts_set_updated_at on public.catalog_product_drafts;
create trigger catalog_product_drafts_set_updated_at
  before update on public.catalog_product_drafts
  for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.catalog_product_drafts enable row level security;

drop policy if exists catalog_drafts_staff_all on public.catalog_product_drafts;
create policy catalog_drafts_staff_all on public.catalog_product_drafts
  for all
  using (public.is_staff())
  with check (public.is_staff());
