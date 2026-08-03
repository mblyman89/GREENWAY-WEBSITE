-- =============================================================================
-- Slice T-310 — About page "Our Values" cards (owner-managed, reorderable)
-- =============================================================================
-- Table: about_core_values
--
-- Makes the four (or more) "Our Values" cards on the About page owner-editable:
-- change the text, add a card, delete a card, and reorder them — while keeping
-- the exact same look. Michael: "I love the way they look, I want to be able to
-- change them or add / delete them."
--
-- Design notes:
--  * SINGLE-DOCUMENT model. The WHOLE ordered list of cards lives in one row
--    (doc_key = 'about-core-values') as a JSON array, with a published copy
--    (`values`) and a draft copy (`draft_values`). Editing / reordering /
--    adding / deleting cards is therefore an ATOMIC draft → publish of the
--    entire set — which matches how the owner thinks about the list and avoids
--    per-row publish state. (Contrast: shop_carousel_slides is one-row-per-
--    slide because each slide is an independently schedulable banner; the
--    values are a small tightly-coupled set edited together, so one document is
--    the cleaner, more professional fit here.)
--  * Each array element is { key, number, title, summary }, shaped + normalized
--    by src/lib/about/core-values-core.ts (CoreValue). Keeping the list as one
--    JSON blob means adding a new field to a card never needs another migration.
--  * Public reads the PUBLISHED `values`; staff preview (Draft Mode) reads
--    `draft_values`.
--
-- Reuses: public.set_updated_at(), public.is_staff(), public.staff_profiles,
--         public.post_status enum (from slice 5).
-- Idempotent: create if not exists + drop policy/trigger if exists.
-- Code ships WORKING PRE-MIGRATION: the store (core-values-store.ts) falls back
-- to FALLBACK_CORE_VALUES (the four shipped cards, byte-identical) until this
-- table exists + is seeded, so the About page never blanks and stays identical
-- until the owner edits + publishes.
-- =============================================================================

create table if not exists public.about_core_values (
  id             uuid primary key default gen_random_uuid(),
  -- Stable key for the single document row; unique so seeds + the editor can
  -- address it deterministically. Always 'about-core-values'.
  doc_key        text not null unique default 'about-core-values',

  -- Lifecycle: 'published' means the values array can be read publicly.
  status         public.post_status not null default 'draft',
  -- Whether the values are turned on at all (kept for symmetry with the other
  -- CMS tables; the About page always shows values, falling back to defaults).
  enabled        boolean not null default true,
  draft_enabled  boolean not null default true,

  -- ----- Published value (what the public sees) -----
  -- JSON array of CoreValue objects: [{ key, number, title, summary }, ...],
  -- in display order. Parsed + normalized by core-values-core.
  values         jsonb not null default '[]'::jsonb,

  -- ----- Draft value (what the editor is staging before publish) -----
  draft_values   jsonb,

  -- Provenance.
  last_edited_by     uuid references public.staff_profiles(id) on delete set null,
  last_published_by  uuid references public.staff_profiles(id) on delete set null,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_about_core_values_status on public.about_core_values(status);

-- updated_at trigger
drop trigger if exists trg_about_core_values_updated on public.about_core_values;
create trigger trg_about_core_values_updated before update on public.about_core_values
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.about_core_values enable row level security;

-- Staff: full read/write.
drop policy if exists about_core_values_staff_all on public.about_core_values;
create policy about_core_values_staff_all on public.about_core_values
  for all using (public.is_staff()) with check (public.is_staff());

-- Public: read PUBLISHED + ENABLED document only.
drop policy if exists about_core_values_public_read on public.about_core_values;
create policy about_core_values_public_read on public.about_core_values
  for select using (status = 'published' and enabled = true);
