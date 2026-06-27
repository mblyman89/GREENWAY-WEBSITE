-- =============================================================================
-- Slice 4 — Product enrichment + AI suggestions
-- =============================================================================
-- Tables: product_enrichments, ai_suggestions
--
-- product_enrichments holds the MARKETING layer keyed by the stable POS product
-- key (menu_items.source_item_id). It is intentionally separate from POS truth:
-- price/stock always come from the published menu_version; enrichment is merged
-- on top at read time and NEVER overrides price/inventory.
--
-- ai_suggestions stores AI-generated DRAFTS with full provenance. Nothing here
-- reaches the public site until a staff member accepts it (status='accepted'),
-- mirroring the menu staged-publish gate.
--
-- Idempotent: create if not exists + drop policy/trigger if exists.
-- =============================================================================

-- ---------- product_enrichments --------------------------------------------
create table if not exists public.product_enrichments (
  id                  uuid primary key default gen_random_uuid(),
  -- Stable POS product key (menu_items.source_item_id). One enrichment per key.
  pos_product_key     text not null unique,
  -- Optional last-seen POS facts for display in the editor (not source of truth).
  last_seen_name      text,
  last_seen_brand     text,
  last_seen_category  text,
  -- Marketing overrides (all optional; null = fall back to POS value).
  display_name        text,
  description         text,
  short_description   text,
  -- Curated image gallery: array of media_assets ids (first = primary).
  image_media_ids     uuid[] not null default '{}',
  primary_media_id    uuid references public.media_assets(id) on delete set null,
  -- Relationships to the vendor/brand DB (Slice 3).
  brand_id            uuid references public.brands(id) on delete set null,
  vendor_id           uuid references public.vendors(id) on delete set null,
  -- Merchandising.
  tags                text[] not null default '{}',   -- new-arrival, best-seller, staff-pick, local, high-cbd, ...
  staff_pick          boolean not null default false,
  featured            boolean not null default false,
  staff_note          text,                            -- shown as "why we love it"
  -- Visibility override (independent of POS hidden flag).
  hidden_override     boolean,                         -- null = inherit POS; true/false = force
  hidden_reason       text,
  -- SEO.
  seo_title           text,
  seo_description     text,
  -- Publish gate for the enrichment itself.
  status              asset_status not null default 'draft',
  created_by          uuid references public.staff_profiles(id) on delete set null,
  updated_by          uuid references public.staff_profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_prod_enrich_key on public.product_enrichments(pos_product_key);
create index if not exists idx_prod_enrich_status on public.product_enrichments(status);
create index if not exists idx_prod_enrich_brand on public.product_enrichments(brand_id);
create index if not exists idx_prod_enrich_staffpick on public.product_enrichments(staff_pick) where staff_pick;
create index if not exists idx_prod_enrich_featured on public.product_enrichments(featured) where featured;

-- ---------- ai_suggestions ---------------------------------------------------
create table if not exists public.ai_suggestions (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null,                       -- product | vendor | brand | strain | media
  entity_id       text not null,                       -- pos_product_key / vendor id / brand id / strain key / media id
  field_key       text not null,                       -- description | tags | mission_statement | alt_text | ...
  suggested_value text,                                -- proposed text (or JSON for structured fields)
  status          text not null default 'pending',     -- pending | accepted | rejected | edited
  -- Provenance.
  model           text,                                -- e.g. provider/model id
  prompt_version  text,                                -- our internal template version
  input_summary   text,                                -- short note of the inputs used (no PII)
  generated_by    uuid references public.staff_profiles(id) on delete set null,
  reviewed_by     uuid references public.staff_profiles(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ai_sugg_entity on public.ai_suggestions(entity_type, entity_id);
create index if not exists idx_ai_sugg_status on public.ai_suggestions(status);
create index if not exists idx_ai_sugg_field on public.ai_suggestions(entity_type, entity_id, field_key);

-- ---------- updated_at trigger ----------------------------------------------
drop trigger if exists trg_product_enrichments_updated on public.product_enrichments;
create trigger trg_product_enrichments_updated before update on public.product_enrichments
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.product_enrichments enable row level security;
alter table public.ai_suggestions      enable row level security;

-- product_enrichments: staff read/write all; PUBLIC reads only PUBLISHED rows
-- so the front end can merge marketing copy over the live menu.
drop policy if exists prod_enrich_staff_read on public.product_enrichments;
create policy prod_enrich_staff_read on public.product_enrichments
  for select using (public.is_staff());
drop policy if exists prod_enrich_public_read_published on public.product_enrichments;
create policy prod_enrich_public_read_published on public.product_enrichments
  for select using (status = 'published');
drop policy if exists prod_enrich_staff_write on public.product_enrichments;
create policy prod_enrich_staff_write on public.product_enrichments
  for all using (public.is_staff()) with check (public.is_staff());

-- ai_suggestions: staff only (drafts are internal until accepted into the
-- target entity, which has its own public-read policy).
drop policy if exists ai_sugg_staff_all on public.ai_suggestions;
create policy ai_sugg_staff_all on public.ai_suggestions
  for all using (public.is_staff()) with check (public.is_staff());
