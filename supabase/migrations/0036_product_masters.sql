-- =============================================================================
-- 0036_product_masters.sql  (Run 6 / Slice 24)
--
-- PRODUCT MASTERING / VARIANT GROUPING  (Feature A).
--
-- Context: the POS import already collapses obvious same-strain/same-brand rows
-- into one menu_item with several menu_variants (see src/lib/pos/transform.ts,
-- groupingIdentity()). What that deterministic key CANNOT catch is when the
-- SAME real product is split across multiple menu_items because of messy POS
-- data — e.g. brand spelled two ways, "OG Kush" vs "OG Kush #18", a 1g cart and
-- a 0.5g disposable of the same line, etc. A human (or AI) recognises these as
-- "one product, several variants"; the import key does not.
--
-- This slice adds a curated MERGE layer on top of the live menu:
--
--   * product_masters        -- one logical product (a card on the menu).
--   * product_master_members -- the menu_items (by stable pos_product_key) that
--                               roll up into a master, each as a "variant".
--   * product_master_suggestions -- AI DRAFT grouping proposals, employee-
--                               validated before they create/modify a master.
--
-- STANDING RULE: AI output is DRAFTS ONLY. A suggestion never changes the public
-- menu until a staff member accepts it. Masters created/edited by staff are the
-- only thing the public menu reads.
--
-- We key members by pos_product_key (menu_items.source_item_id) rather than the
-- menu_items.id, because menu_items.id changes every time a new menu version is
-- imported, whereas the POS key is stable across imports. This keeps masters
-- durable across re-imports.
--
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- product_masters: one logical product.
-- ---------------------------------------------------------------------------
create table if not exists public.product_masters (
  id              uuid primary key default gen_random_uuid(),
  -- Display name shown on the public menu card.
  display_name    text not null,
  brand_name      text,
  vendor_name     text,
  -- Website category value (matches website_category_types.value).
  category        text,
  strain_name     text,
  strain_type     text,
  notes           text,
  -- draft  -> not shown on the public menu yet (employee still curating)
  -- published -> the public menu groups these members into one card
  status          text not null default 'draft'
                    check (status in ('draft', 'published', 'archived')),
  -- Provenance: where this master came from.
  created_origin  text not null default 'manual'
                    check (created_origin in ('manual', 'ai_suggestion')),
  created_by      uuid references public.staff_profiles(id) on delete set null,
  updated_by      uuid references public.staff_profiles(id) on delete set null,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists product_masters_status_idx on public.product_masters (status);
create index if not exists product_masters_category_idx on public.product_masters (category);

-- ---------------------------------------------------------------------------
-- product_master_members: the menu items that roll up into a master.
-- One pos_product_key may belong to at most one master (unique).
-- ---------------------------------------------------------------------------
create table if not exists public.product_master_members (
  id               uuid primary key default gen_random_uuid(),
  master_id        uuid not null references public.product_masters(id) on delete cascade,
  -- Stable POS key (menu_items.source_item_id). Durable across re-imports.
  pos_product_key  text not null unique,
  -- A human-friendly label for this variant on the card (e.g. "1g", "3.5g").
  variant_label    text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists product_master_members_master_idx
  on public.product_master_members (master_id);

-- ---------------------------------------------------------------------------
-- product_master_suggestions: AI DRAFT grouping proposals.
-- members_json is an array of { pos_product_key, name, variant_label } the AI
-- proposes grouping together. status gates whether it has been acted on.
-- ---------------------------------------------------------------------------
create table if not exists public.product_master_suggestions (
  id               uuid primary key default gen_random_uuid(),
  -- Proposed master display name + grouping metadata.
  display_name     text not null,
  brand_name       text,
  category         text,
  -- The proposed members (array of objects). Validated in the app layer.
  members_json     jsonb not null default '[]'::jsonb,
  -- Why the AI thinks these belong together (short, PII-free).
  rationale        text,
  -- 0..1 confidence reported by the model.
  confidence       numeric,
  -- pending | accepted | rejected | edited
  status           text not null default 'pending'
                     check (status in ('pending', 'accepted', 'rejected', 'edited')),
  -- If accepted, the master it produced.
  resulting_master_id uuid references public.product_masters(id) on delete set null,
  -- Provenance.
  model            text,
  prompt_version   text,
  input_summary    text,
  generated_by     uuid references public.staff_profiles(id) on delete set null,
  reviewed_by      uuid references public.staff_profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists product_master_suggestions_status_idx
  on public.product_master_suggestions (status);

-- updated_at triggers.
drop trigger if exists product_masters_set_updated_at on public.product_masters;
create trigger product_masters_set_updated_at
  before update on public.product_masters
  for each row execute function public.set_updated_at();

drop trigger if exists product_master_members_set_updated_at on public.product_master_members;
create trigger product_master_members_set_updated_at
  before update on public.product_master_members
  for each row execute function public.set_updated_at();

drop trigger if exists product_master_suggestions_set_updated_at on public.product_master_suggestions;
create trigger product_master_suggestions_set_updated_at
  before update on public.product_master_suggestions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security:
--   * staff may read everything;
--   * staff (inventory managers) may write masters + members;
--   * suggestions are staff read/write;
--   * PUBLIC may read ONLY published masters + their members (so the public
--     menu can group cards) — drafts never leak.
-- ---------------------------------------------------------------------------
alter table public.product_masters             enable row level security;
alter table public.product_master_members      enable row level security;
alter table public.product_master_suggestions  enable row level security;

drop policy if exists product_masters_staff_read on public.product_masters;
create policy product_masters_staff_read on public.product_masters
  for select using (public.is_staff());

drop policy if exists product_masters_public_read_published on public.product_masters;
create policy product_masters_public_read_published on public.product_masters
  for select using (status = 'published');

drop policy if exists product_masters_staff_write on public.product_masters;
create policy product_masters_staff_write on public.product_masters
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists product_master_members_staff_read on public.product_master_members;
create policy product_master_members_staff_read on public.product_master_members
  for select using (public.is_staff());

-- Public can read members whose master is published.
drop policy if exists product_master_members_public_read on public.product_master_members;
create policy product_master_members_public_read on public.product_master_members
  for select using (
    exists (
      select 1 from public.product_masters m
      where m.id = product_master_members.master_id
        and m.status = 'published'
    )
  );

drop policy if exists product_master_members_staff_write on public.product_master_members;
create policy product_master_members_staff_write on public.product_master_members
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists product_master_suggestions_staff_read on public.product_master_suggestions;
create policy product_master_suggestions_staff_read on public.product_master_suggestions
  for select using (public.is_staff());

drop policy if exists product_master_suggestions_staff_write on public.product_master_suggestions;
create policy product_master_suggestions_staff_write on public.product_master_suggestions
  for all using (public.is_staff()) with check (public.is_staff());
