-- =============================================================================
-- 0090_kb_store_voice_faq.sql
-- Knowledge-Base STORE FACTS + FAQ pack (KB hardening v2, Slice 4 — LAST slice).
--
-- WHY: the KB now teaches the AI the FACTS of the product world (strains,
-- effects, product formats, WA compliance rules, terpene aroma cross-map). What
-- it still lacks is knowledge of GREENWAY ITSELF — our hours, address, phone,
-- payment (cash only + ATM), the fact we don't deliver, our price-match promise,
-- our loyalty program, our return policy, and how we talk. Without this the
-- concierge either guesses (forbidden) or answers "you" questions generically.
--
-- Two owner-extendable, staff-only tables:
--   * kb_store_facts — flexible key/label/body cards the owner can add to at
--     will (hours, address, phone, payment, delivery, mission statement,
--     "about us", parking, discounts, anything). Category groups them in the UI.
--   * kb_faqs — a curated Q&A pack (question + answer + tags) the owner can add
--     to manually. Retrieval injects applicable facts + FAQs into grounding.
--
-- DELIBERATELY NOT DUPLICATED / NOT HARD-CODED:
--   * The LIVE loyalty earn rate lives in `loyalty_config` (owner-editable). The
--     retrieval layer reads it at grounding time so the loyalty answer can never
--     drift from the real program. The seeded loyalty FAQ therefore carries NO
--     hard-coded rate — it is filled from loyalty_config at runtime.
--   * Price-match terms + return policy already live on the customer site
--     (price-match page + FAQ page). The seed mirrors the SAME verified copy so
--     the concierge and the website agree; the owner can edit here if the site
--     copy changes.
--
-- COMPLIANCE (WA I-502): every fact/FAQ answer passes the same checkCompliance
-- gate + banned-phrase checks as all KB copy. No medical/therapeutic claims, no
-- minor-appeal, no dosing directives. Store facts are policy/marketing language.
--
-- STANDING RULES:
--   * Idempotent (create if not exists; drop-then-add constraints/policies/
--     triggers). Safe to re-run. NON-DESTRUCTIVE: curated edits are never
--     clobbered (seed upserts on slug/key, gap-fill style).
--   * Applied MANUALLY by the owner.
--   * KB is internal grounding data: staff read/write, no public read
--     (public.is_staff(), same as every other kb_* table).
--   * Drafts/provenance parity mirrors kb_effects (0086) / kb_product_formats
--     (0087) / kb_compliance_rules (0088): curated rows default
--     status='published' + source='manual'; machine writers set status='draft'.
-- =============================================================================

-- ---------- kb_store_facts (owner-extendable "about us" cards) ---------------
create table if not exists public.kb_store_facts (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,                   -- stable slug: 'hours' | 'address' | 'mission' | ...
  label           text not null,                          -- display heading, e.g. 'Store hours'
  -- Loose grouping for the UI only:
  --   'basics' | 'payment' | 'policies' | 'about' | 'other'
  category        text not null default 'basics',
  -- The fact itself, in Greenway's voice. Policy / marketing language only.
  body            text not null,
  -- Optional lowercase tags for retrieval targeting (e.g. 'hours', 'payment').
  tags            text[] not null default '{}',
  -- Ordering within a category (lower = earlier).
  sort_order      integer not null default 100,
  sources         text[] not null default '{}',           -- where the fact came from (site page, owner, etc.)
  confidence      numeric,                                 -- 0..1 curator confidence
  -- Drafts/provenance parity (mirrors kb_product_formats 0087):
  source          text,                                    -- 'manual' (curated) | 'site' | 'enrichment' | ...
  status          text not null default 'published',       -- draft | published | archived
  active          boolean not null default true,
  created_by      uuid references public.staff_profiles(id) on delete set null,
  updated_by      uuid references public.staff_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.kb_store_facts
  drop constraint if exists kb_store_facts_status_check;
alter table public.kb_store_facts
  add constraint kb_store_facts_status_check
  check (status in ('draft', 'published', 'archived'));

create index if not exists idx_kb_store_facts_key       on public.kb_store_facts(key);
create index if not exists idx_kb_store_facts_active     on public.kb_store_facts(active) where active;
create index if not exists idx_kb_store_facts_status     on public.kb_store_facts(status);
create index if not exists idx_kb_store_facts_category   on public.kb_store_facts(category);
create index if not exists idx_kb_store_facts_tags       on public.kb_store_facts using gin (tags);

comment on table  public.kb_store_facts            is 'KB store/brand facts: owner-extendable "about us" cards (hours, address, phone, payment, delivery, mission, etc.). Policy/marketing language only, no medical claims. Staff-only.';
comment on column public.kb_store_facts.key        is 'Stable slug key (unique). Seed upserts on this key so curated edits are never clobbered.';
comment on column public.kb_store_facts.category   is 'UI grouping only: basics | payment | policies | about | other.';
comment on column public.kb_store_facts.body       is 'The fact itself in Greenway voice. Compliance-gated on surface.';
comment on column public.kb_store_facts.source     is 'Provenance: manual (curated) | site (mirrored from a site page) | enrichment. Backfilled to manual for curated rows.';
comment on column public.kb_store_facts.status     is 'Lifecycle: draft (machine) | published (curated) | archived.';

update public.kb_store_facts
   set source = 'manual'
 where source is null;

drop trigger if exists trg_kb_store_facts_updated on public.kb_store_facts;
create trigger trg_kb_store_facts_updated before update on public.kb_store_facts
  for each row execute function public.set_updated_at();

alter table public.kb_store_facts enable row level security;

drop policy if exists kb_store_facts_staff_all on public.kb_store_facts;
create policy kb_store_facts_staff_all on public.kb_store_facts
  for all using (public.is_staff()) with check (public.is_staff());

-- ---------- kb_faqs (curated + owner-extendable Q&A pack) --------------------
create table if not exists public.kb_faqs (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,                   -- 'store-hours' | 'payment' | 'returns' | ...
  question        text not null,
  answer          text not null,                          -- Greenway-voice answer, compliance-gated
  -- Loose grouping for the UI only:
  --   'basics' | 'buying' | 'compliance' | 'products' | 'loyalty' | 'other'
  category        text not null default 'basics',
  -- Optional lowercase tags for retrieval targeting / matching.
  tags            text[] not null default '{}',
  sort_order      integer not null default 100,
  sources         text[] not null default '{}',
  confidence      numeric,
  source          text,                                    -- 'manual' | 'site' | 'enrichment'
  status          text not null default 'published',
  active          boolean not null default true,
  created_by      uuid references public.staff_profiles(id) on delete set null,
  updated_by      uuid references public.staff_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.kb_faqs
  drop constraint if exists kb_faqs_status_check;
alter table public.kb_faqs
  add constraint kb_faqs_status_check
  check (status in ('draft', 'published', 'archived'));

create index if not exists idx_kb_faqs_slug     on public.kb_faqs(slug);
create index if not exists idx_kb_faqs_active    on public.kb_faqs(active) where active;
create index if not exists idx_kb_faqs_status    on public.kb_faqs(status);
create index if not exists idx_kb_faqs_category  on public.kb_faqs(category);
create index if not exists idx_kb_faqs_tags      on public.kb_faqs using gin (tags);

comment on table  public.kb_faqs           is 'KB FAQ pack: curated + owner-extendable Q&A the concierge can answer from. Greenway voice, WA I-502 compliant, no medical claims. Staff-only.';
comment on column public.kb_faqs.slug      is 'Stable slug (unique). Seed upserts on this slug so curated edits are never clobbered.';
comment on column public.kb_faqs.category  is 'UI grouping only: basics | buying | compliance | products | loyalty | other.';
comment on column public.kb_faqs.answer    is 'Greenway-voice answer. Compliance-gated on surface. Live loyalty/price-match/return values may be composed at runtime from the real source.';
comment on column public.kb_faqs.source    is 'Provenance: manual (curated) | site (mirrored) | enrichment. Backfilled to manual for curated rows.';
comment on column public.kb_faqs.status    is 'Lifecycle: draft (machine) | published (curated) | archived.';

update public.kb_faqs
   set source = 'manual'
 where source is null;

drop trigger if exists trg_kb_faqs_updated on public.kb_faqs;
create trigger trg_kb_faqs_updated before update on public.kb_faqs
  for each row execute function public.set_updated_at();

alter table public.kb_faqs enable row level security;

drop policy if exists kb_faqs_staff_all on public.kb_faqs;
create policy kb_faqs_staff_all on public.kb_faqs
  for all using (public.is_staff()) with check (public.is_staff());
