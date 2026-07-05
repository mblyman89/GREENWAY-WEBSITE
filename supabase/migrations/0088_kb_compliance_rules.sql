-- =============================================================================
-- 0088_kb_compliance_rules.sql
-- Knowledge-Base COMPLIANCE-RULES reference (KB hardening v2, Slice 3).
--
-- WHY: The repo ALREADY enforces WA single-transaction purchase limits
-- operationally (src/lib/compliance/sales-limits-core.ts -> RECREATIONAL_LIMITS
-- / MEDICAL_LIMITS, checked at checkout; /admin/compliance/sales-limits). This
-- table is deliberately NOT a second enforcement mechanism. It is a curated
-- REFERENCE / EDUCATION layer: the Washington safety, purchase, and use FACTS
-- the AI (and staff) can surface HELPFULLY to keep customers safe -- the "know
-- before you go / know before you consume" layer (21+, purchase & possession
-- limits, no public use, don't drive impaired, edibles start-low-go-slow, store
-- away from kids/pets, don't cross state lines).
--
-- The purchase-limit NUMBERS are NOT re-stored here as free text; the seed
-- derives them at runtime from RECREATIONAL_LIMITS so the KB reference can never
-- drift from what checkout enforces. Every rule is sourced from WA statute/rule
-- -- see docs/KB_COMPLIANCE_RULES_SEED_SOURCES.md (WSLCB, WAC 314-55-095, RCW
-- 69.50.360 / .4013 / .445).
--
-- COMPLIANCE (WA I-502): factual legal/safety EDUCATION only. No
-- medical/therapeutic claims, no product-specific dosing directive. The edible
-- serving cap + "start low, go slow" are stated as safety facts about the WA
-- rule and how ingestion behaves, not advice to consume a specific amount. All
-- surfaced prose is routed through checkCompliance before it can appear.
--
-- STANDING RULES:
--   * Idempotent (create ... if not exists / drop policy if exists /
--     backfill only-when-null). Safe to re-run.
--   * Applied MANUALLY by the owner.
--   * KB is internal copy-grounding data: staff read/write, no public read
--     (same RLS shape as every other kb_* table -> public.is_staff()).
--   * Drafts/provenance parity mirrors kb_effects (0086) / kb_product_formats
--     (0087): curated rows default status='published' + source='manual'.
-- =============================================================================

-- ---------- kb_compliance_rules ---------------------------------------------
create table if not exists public.kb_compliance_rules (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,                  -- 'age-21-plus' | 'purchase-limits' | ...
  title           text not null,                         -- display label 'Adults 21 and over only'
  -- Loose grouping for the UI (NOT a medical category):
  --   'age' | 'purchase-limit' | 'possession' | 'public-use' | 'driving'
  --   | 'edibles-safety' | 'storage' | 'transport'
  category        text,
  -- The factual rule statement (neutral, legal/safety education).
  rule            text,
  -- Friendly plain-language "what that means for you" (house voice, non-medical).
  house_note      text,
  -- UI emphasis only: 'info' | 'important' | 'critical'. Not a legal grade.
  severity        text not null default 'info',
  -- Statute / rule citation string (e.g. 'WAC 314-55-095', 'RCW 69.50.360').
  citation        text,
  sources         text[] not null default '{}',          -- citations backing the rule
  confidence      numeric,                                -- 0..1 curator confidence
  sort_order      integer not null default 100,           -- stable display order
  -- Drafts/provenance parity (mirrors kb_effects 0086):
  source          text,                                   -- 'manual' (curated) | 'enrichment' | ...
  status          text not null default 'published',      -- draft | published | archived
  active          boolean not null default true,
  created_by      uuid references public.staff_profiles(id) on delete set null,
  updated_by      uuid references public.staff_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Guard the status value set (idempotent: drop-then-add).
alter table public.kb_compliance_rules
  drop constraint if exists kb_compliance_rules_status_check;
alter table public.kb_compliance_rules
  add constraint kb_compliance_rules_status_check
  check (status in ('draft', 'published', 'archived'));

-- Guard the severity value set.
alter table public.kb_compliance_rules
  drop constraint if exists kb_compliance_rules_severity_check;
alter table public.kb_compliance_rules
  add constraint kb_compliance_rules_severity_check
  check (severity in ('info', 'important', 'critical'));

create index if not exists idx_kb_compliance_rules_slug     on public.kb_compliance_rules(slug);
create index if not exists idx_kb_compliance_rules_active    on public.kb_compliance_rules(active) where active;
create index if not exists idx_kb_compliance_rules_status    on public.kb_compliance_rules(status);
create index if not exists idx_kb_compliance_rules_category  on public.kb_compliance_rules(category);

comment on table  public.kb_compliance_rules            is 'KB compliance/safety REFERENCE (education, not enforcement). WA purchase/use/safety facts surfaced helpfully. Purchase-limit numbers derive from sales-limits-core at seed time. Staff-only.';
comment on column public.kb_compliance_rules.category   is 'Loose grouping for the UI ONLY (age | purchase-limit | possession | public-use | driving | edibles-safety | storage | transport).';
comment on column public.kb_compliance_rules.rule       is 'Factual legal/safety statement (neutral education). Surfaced only after the application compliance gate.';
comment on column public.kb_compliance_rules.house_note is 'Friendly plain-language "what that means for you" (house voice, non-medical). Compliance-gated on surface.';
comment on column public.kb_compliance_rules.severity   is 'UI emphasis only: info | important | critical. NOT a legal grade.';
comment on column public.kb_compliance_rules.citation   is 'Statute/rule citation string (e.g. WAC 314-55-095, RCW 69.50.360).';
comment on column public.kb_compliance_rules.source     is 'Provenance: manual (curated) | enrichment | etc. Backfilled to manual for curated rows.';
comment on column public.kb_compliance_rules.status     is 'Lifecycle: draft (machine) | published (curated/promoted) | archived.';

-- ---------- backfill (gap-fill only; never clobber curated data) -------------
update public.kb_compliance_rules
   set source = 'manual'
 where source is null;

-- ---------- updated_at trigger ----------------------------------------------
drop trigger if exists trg_kb_compliance_rules_updated on public.kb_compliance_rules;
create trigger trg_kb_compliance_rules_updated before update on public.kb_compliance_rules
  for each row execute function public.set_updated_at();

-- ---------- Row-Level Security ----------------------------------------------
alter table public.kb_compliance_rules enable row level security;

drop policy if exists kb_compliance_rules_staff_all on public.kb_compliance_rules;
create policy kb_compliance_rules_staff_all on public.kb_compliance_rules
  for all using (public.is_staff()) with check (public.is_staff());
