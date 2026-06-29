-- =============================================================================
-- 0018 — AI suggestion provenance: confidence + source
-- =============================================================================
-- Adds two optional columns to ai_suggestions so every AI/crawler draft carries
--   • confidence: 0..1 — how grounded the output was in the provided facts.
--                 Used to surface high-confidence drafts first and route
--                 low-confidence ones to a "needs a closer look" queue.
--   • source:     where the facts came from — 'model' | 'kb' | 'pos' |
--                 'crawl:<url>'. Lets us measure accept-rate per source and
--                 down-rank crawl domains that produce rejected junk.
--
-- This is the foundation for the SPRINT-mode enrichment push: we want to know,
-- per draft, how trustworthy it is and where it came from.
--
-- Idempotent: add column if not exists. Safe to run more than once.
-- =============================================================================

alter table public.ai_suggestions
  add column if not exists confidence numeric;        -- 0..1, nullable

alter table public.ai_suggestions
  add column if not exists source text default 'model';

-- Helpful for the review queue: filter pending by confidence/source quickly.
create index if not exists idx_ai_sugg_confidence
  on public.ai_suggestions(confidence);
create index if not exists idx_ai_sugg_source
  on public.ai_suggestions(source);

-- Backfill existing rows so older drafts have a sensible source.
update public.ai_suggestions set source = 'model' where source is null;
