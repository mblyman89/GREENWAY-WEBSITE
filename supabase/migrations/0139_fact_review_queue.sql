-- =============================================================================
-- PROGRAM 3 / SLICE 57 - Golden-record exception review queue
--
-- One table: pos_fact_reviews. Stores the HUMAN decision for each row in the
-- import fact-review queue (docs/data-governance.md Rule 3.1: never
-- auto-commit uncertain data; Rule 2.2: every fact carries provenance - a
-- reviewer is a legitimate, named source).
--
--   action = 'approve' : the facts stand as staged.
--   action = 'fix'     : corrected_facts_json carries the reviewer's values;
--                        the staged menu_items row is updated server-side with
--                        provenance "reviewer" so publish reflects the fix.
--   action = 'reject'  : the staged item is hidden (documented reject -
--                        Rule 3.3: rows in = created + resolved + rejected).
--
-- One decision per (import, source item) - re-deciding upserts (latest wins),
-- with updated_at tracking the change. Depends on 0001 (staff_profiles,
-- is_staff(), set_updated_at()) and 0002 (pos_imports).
-- Apply manually (owner). Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.pos_fact_reviews (
  id                   uuid primary key default gen_random_uuid(),
  import_id            uuid not null references public.pos_imports(id) on delete cascade,
  -- Menu source id ("pos-..."), or the synthetic "flag:<code>:<name>" id used
  -- for review flags that matched no staged card (never lose a flag).
  source_item_id       text not null,
  action               text not null check (action in ('approve','fix','reject')),
  note                 text,
  corrected_facts_json jsonb,
  reviewed_by          uuid references public.staff_profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (import_id, source_item_id)
);

create index if not exists idx_pos_fact_reviews_import on public.pos_fact_reviews(import_id);

alter table public.pos_fact_reviews enable row level security;

-- Staff may read the decision log; all writes go through the server with the
-- service role (same posture as pos_imports / pos_import_diagnostics).
drop policy if exists pos_fact_reviews_staff_read on public.pos_fact_reviews;
create policy pos_fact_reviews_staff_read on public.pos_fact_reviews
  for select using (public.is_staff());

drop trigger if exists trg_pos_fact_reviews_updated on public.pos_fact_reviews;
create trigger trg_pos_fact_reviews_updated before update on public.pos_fact_reviews
  for each row execute function public.set_updated_at();
