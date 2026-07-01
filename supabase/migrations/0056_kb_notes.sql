-- =============================================================================
-- 0056 — Knowledge base: owner uploads / free-form reference notes
-- =============================================================================
-- Item 14 (Slice 75): the curated kb_strains / kb_terpenes / kb_category_terms
-- / kb_brands tables cover the STRUCTURED facts the model may use. But the
-- owner also wants to drop in their own free-form reference material — a house
-- style note, a "how we describe our exclusive drops" paragraph, vendor-
-- specific quirks, store policy language, etc. — WITHOUT touching code.
--
-- kb_notes is that catch-all: a title + body the owner writes, optional tags
-- (used to target which products the note applies to) and an optional source.
-- The retrieval layer matches active notes to a product (by tag or keyword)
-- and injects them into the grounded-facts block, exactly like the structured
-- rows. It is still SENSORY / marketing / policy language only — the same
-- WA I-502 compliance rules and banned-phrase checks apply downstream.
--
-- Idempotent: create if not exists + drop policy/trigger if exists. Safe to
-- run more than once. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

create table if not exists public.kb_notes (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,                          -- short label for the note
  body         text not null,                          -- the reference text itself
  -- Optional targeting: lowercase tags (strain slug, category, brand, vendor,
  -- or any keyword). Empty = a general note that applies to everything.
  tags         text[] not null default '{}',
  source       text,                                   -- where it came from (optional)
  active       boolean not null default true,
  created_by   uuid references public.staff_profiles(id) on delete set null,
  updated_by   uuid references public.staff_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_kb_notes_active on public.kb_notes(active) where active;
create index if not exists idx_kb_notes_tags   on public.kb_notes using gin (tags);

-- updated_at trigger (shared helper from earlier migrations)
drop trigger if exists trg_kb_notes_updated on public.kb_notes;
create trigger trg_kb_notes_updated before update on public.kb_notes
  for each row execute function public.set_updated_at();

-- RLS: staff-only, same as the rest of the KB.
alter table public.kb_notes enable row level security;

drop policy if exists kb_notes_staff_all on public.kb_notes;
create policy kb_notes_staff_all on public.kb_notes
  for all using (public.is_staff()) with check (public.is_staff());
