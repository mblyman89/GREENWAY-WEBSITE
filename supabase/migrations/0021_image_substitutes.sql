-- =============================================================================
-- Greenway Back Office — Migration 0021: approved image-substitute KB
--
-- Purpose (owner request): a product card must NEVER be blank. When we can't
-- find an exact product photo, we fall back — honestly — to an APPROVED
-- substitute image chosen by the product's category and/or inventory type
-- (and optionally by brand/vendor for a branded-but-untitled shot, e.g. a
-- branded joint tube / flower jar / boxed edible photographed without a name).
--
-- This table is the curated, owner-editable library of those approved
-- fallbacks. Each row points at a media_assets image and is tagged to a SCOPE:
--   • category        — key = a product Category (e.g. 'flower', 'pre-roll')
--   • inventory_type  — key = an Inventory Type (e.g. 'usable marijuana',
--                       'concentrate for inhalation', 'solid edible')
--   • brand           — key = a brand slug (branded generic shot)
--   • vendor          — key = a vendor slug (vendor generic shot)
--   • global          — key = '*' (last-resort house fallback)
--
-- The product image resolver (built in DF-3) tries, in order:
--   exact product image → brand/vendor approved shot → honest substitute →
--   category match → inventory_type match → global.
--
-- WA I-502 / honesty: substitutes must be obviously category-representative and
-- never misrepresent a specific product. The front end shows a "representative
-- image" cue when a fallback is used (handled in app code, not here).
--
-- Idempotent: create-if-not-exists + drop-policy/trigger-if-exists. Safe to run
-- more than once. APPLY MANUALLY in the Supabase SQL editor.
-- =============================================================================

-- ---------- kb_image_substitutes --------------------------------------------
create table if not exists public.kb_image_substitutes (
  id            uuid primary key default gen_random_uuid(),
  -- What this fallback applies to.
  scope         text not null
                  check (scope in ('category','inventory_type','brand','vendor','global')),
  -- Normalized lookup key: lowercased category / inventory type / brand slug /
  -- vendor slug, or '*' for the global last-resort fallback.
  key           text not null,
  -- The approved image.
  media_id      uuid not null references public.media_assets(id) on delete cascade,
  -- Optional human label for the admin grid (e.g. "Neutral flower jar").
  label         text,
  -- Lower number = preferred when several match the same scope+key.
  priority      integer not null default 100,
  active        boolean not null default true,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  updated_by    uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One image can only be registered once per (scope, key).
  unique (scope, key, media_id)
);

create index if not exists idx_kb_imgsub_lookup
  on public.kb_image_substitutes(scope, key)
  where active;
create index if not exists idx_kb_imgsub_priority
  on public.kb_image_substitutes(scope, key, priority);

-- ---------- updated_at trigger -----------------------------------------------
drop trigger if exists trg_kb_imgsub_updated on public.kb_image_substitutes;
create trigger trg_kb_imgsub_updated before update on public.kb_image_substitutes
  for each row execute function public.set_updated_at();

-- ---------- RLS (staff-only, matches the kb_* convention) --------------------
alter table public.kb_image_substitutes enable row level security;

drop policy if exists kb_imgsub_staff_all on public.kb_image_substitutes;
create policy kb_imgsub_staff_all on public.kb_image_substitutes
  for all using (public.is_staff()) with check (public.is_staff());

-- Note: reads for the public website happen server-side via the service role
-- (the resolver resolves a public_url), so no public SELECT policy is needed.
