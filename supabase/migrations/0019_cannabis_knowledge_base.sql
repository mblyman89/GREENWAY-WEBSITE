-- =============================================================================
-- 0019 — Cannabis knowledge base (grounded enrichment facts)
-- =============================================================================
-- The AI enrichment is only as good as the FACTS we feed it. The POS data is
-- thin (often just a name + category), so to write genuinely expert, grounded,
-- WA I-502-compliant copy we maintain a small curated knowledge base that the
-- prompt builder injects as "the only allowed facts."
--
-- Four tables, all owner-editable from the admin (no code change to add facts):
--   • kb_strains          — strain families & lineage (Blue Dream, OG Kush, …),
--                           strain TYPE (indica/sativa/hybrid) and aroma/flavor
--                           descriptors. SENSORY ONLY — never effects/medical.
--   • kb_terpenes         — terpene → aroma/flavor descriptor map (limonene =>
--                           citrus/bright). NON-MEDICAL: we deliberately store
--                           NO effect/therapeutic columns.
--   • kb_category_terms   — vocabulary per product category (flower, vape,
--                           edible, concentrate, preroll, …): typical formats,
--                           texture/format words, sensory descriptors.
--   • kb_brands           — brand/vendor facts (house style, signature lines,
--                           "known for" sensory notes). Distinct from the
--                           operational vendors/brands tables: this is the
--                           COPY-GROUNDING layer the model is allowed to quote.
--
-- Plus kb_banned_phrases: an owner-editable extra blocklist layered on top of
-- the hardcoded compliance regex (so staff can add phrases without a deploy).
--
-- All sensory/marketing only. There is intentionally NO place to record medical
-- or effect claims, because WA I-502 forbids them in advertising.
--
-- Idempotent: create if not exists + drop policy/trigger if exists. Safe to
-- run more than once. Apply manually in the Supabase SQL editor.
-- =============================================================================

-- ---------- kb_strains -------------------------------------------------------
create table if not exists public.kb_strains (
  id            uuid primary key default gen_random_uuid(),
  -- Lowercase, trimmed, unique lookup key (e.g. 'blue dream').
  slug          text not null unique,
  name          text not null,                         -- display name
  aliases       text[] not null default '{}',          -- alternate spellings/nicknames
  strain_type   text,                                  -- indica | sativa | hybrid | unknown
  lineage       text,                                  -- e.g. "Blueberry x Haze" (factual cross)
  aroma_notes   text[] not null default '{}',          -- citrus, pine, earthy, … (SENSORY ONLY)
  flavor_notes  text[] not null default '{}',
  terpenes      text[] not null default '{}',          -- dominant terpene names (no effects)
  summary       text,                                  -- 1-2 sentence factual, non-medical blurb
  active        boolean not null default true,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  updated_by    uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_kb_strains_slug on public.kb_strains(slug);
create index if not exists idx_kb_strains_active on public.kb_strains(active) where active;

-- ---------- kb_terpenes ------------------------------------------------------
create table if not exists public.kb_terpenes (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,                  -- 'limonene'
  name          text not null,                         -- 'Limonene'
  aroma_notes   text[] not null default '{}',          -- citrus, lemon, bright
  flavor_notes  text[] not null default '{}',
  also_found_in text,                                  -- "citrus peel, juniper" (botanical, non-medical)
  active        boolean not null default true,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  updated_by    uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_kb_terpenes_slug on public.kb_terpenes(slug);
create index if not exists idx_kb_terpenes_active on public.kb_terpenes(active) where active;

-- ---------- kb_category_terms ------------------------------------------------
create table if not exists public.kb_category_terms (
  id            uuid primary key default gen_random_uuid(),
  category      text not null unique,                  -- flower | vape | edible | concentrate | preroll | …
  display_name  text,
  formats       text[] not null default '{}',          -- eighth, gram, cart, disposable, gummy, …
  format_words  text[] not null default '{}',          -- texture/format descriptors (sticky, frosty, smooth)
  sensory_words text[] not null default '{}',          -- legal sensory descriptors typical of the category
  notes         text,                                  -- guidance for copy (non-medical)
  active        boolean not null default true,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  updated_by    uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_kb_cat_terms_category on public.kb_category_terms(category);
create index if not exists idx_kb_cat_terms_active on public.kb_category_terms(active) where active;

-- ---------- kb_brands --------------------------------------------------------
create table if not exists public.kb_brands (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,                  -- 'avitas'
  name          text not null,
  aliases       text[] not null default '{}',
  -- Optional link to the operational vendor/brand row (loose; nullable).
  vendor_id     uuid references public.vendors(id) on delete set null,
  brand_id      uuid references public.brands(id) on delete set null,
  known_for     text,                                  -- "solventless hash rosin" (factual)
  house_style   text,                                  -- copy voice / signature notes (non-medical)
  signature_lines text[] not null default '{}',        -- product line names
  sensory_notes text[] not null default '{}',          -- legal sensory descriptors
  active        boolean not null default true,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  updated_by    uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_kb_brands_slug on public.kb_brands(slug);
create index if not exists idx_kb_brands_vendor on public.kb_brands(vendor_id);
create index if not exists idx_kb_brands_active on public.kb_brands(active) where active;

-- ---------- kb_banned_phrases ------------------------------------------------
-- Owner-editable extra blocklist layered on top of the hardcoded compliance
-- regex. A match flags the draft as needing an edit before acceptance.
create table if not exists public.kb_banned_phrases (
  id          uuid primary key default gen_random_uuid(),
  phrase      text not null unique,                    -- matched case-insensitive, word-ish
  severity    text not null default 'block',           -- block | warn
  reason      text,                                    -- why it's banned (for staff)
  active      boolean not null default true,
  created_by  uuid references public.staff_profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_kb_banned_active on public.kb_banned_phrases(active) where active;

-- ---------- updated_at triggers ---------------------------------------------
drop trigger if exists trg_kb_strains_updated on public.kb_strains;
create trigger trg_kb_strains_updated before update on public.kb_strains
  for each row execute function public.set_updated_at();

drop trigger if exists trg_kb_terpenes_updated on public.kb_terpenes;
create trigger trg_kb_terpenes_updated before update on public.kb_terpenes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_kb_cat_terms_updated on public.kb_category_terms;
create trigger trg_kb_cat_terms_updated before update on public.kb_category_terms
  for each row execute function public.set_updated_at();

drop trigger if exists trg_kb_brands_updated on public.kb_brands;
create trigger trg_kb_brands_updated before update on public.kb_brands
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
-- The KB is internal copy-grounding data. Staff read/write; no public read
-- (the public site only ever sees the FINISHED, accepted enrichment copy).
alter table public.kb_strains        enable row level security;
alter table public.kb_terpenes       enable row level security;
alter table public.kb_category_terms enable row level security;
alter table public.kb_brands         enable row level security;
alter table public.kb_banned_phrases enable row level security;

drop policy if exists kb_strains_staff_all on public.kb_strains;
create policy kb_strains_staff_all on public.kb_strains
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists kb_terpenes_staff_all on public.kb_terpenes;
create policy kb_terpenes_staff_all on public.kb_terpenes
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists kb_cat_terms_staff_all on public.kb_category_terms;
create policy kb_cat_terms_staff_all on public.kb_category_terms
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists kb_brands_staff_all on public.kb_brands;
create policy kb_brands_staff_all on public.kb_brands
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists kb_banned_staff_all on public.kb_banned_phrases;
create policy kb_banned_staff_all on public.kb_banned_phrases
  for all using (public.is_staff()) with check (public.is_staff());
