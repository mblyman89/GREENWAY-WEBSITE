-- 0295_ai_batches.sql  (R74 S34: Gemini Batch API lookups)
--
-- WHY. Owner (R74 round 15): "Ideally I'd like to get them all done before
-- the price doubles in January ... 2700 unique lots ... several are the same
-- product, just a use second or third, or is a variant in size so the same
-- product with the same facts." With AI_LOOKUP_ENGINE=batch the background
-- lookup sends queued products to the Gemini Batch API (half price, no
-- spend-per-10-minute 429s, answers within ~24 h), ONE question per product
-- family; the answer fans out to every lot of that family.
--
--   * ai_batches: one row per submitted Gemini batch - Google's name
--     (batches/...), state, what was asked (request_keys: key -> the lookup
--     items it answers), counts, tokens, search queries and the estimated
--     cost at Batch prices (the cost ledger).
--   * lookup_job_items.batch_id: the batch a product is waiting on.
--
-- Rows are written by the service role only. RLS: staff read.
-- Idempotent: safe to run more than once.
-- Rollback: supabase/rollbacks/0295_ai_batches.rollback.sql

create table if not exists public.ai_batches (
  id              uuid primary key default gen_random_uuid(),
  name            text unique,
  model           text not null,
  state           text not null default 'submitting'
    check (state in ('submitting', 'pending', 'running', 'succeeded', 'failed', 'canceled', 'expired', 'ingesting', 'ingested')),
  families        integer not null default 0 check (families >= 0),
  items           integer not null default 0 check (items >= 0),
  answered        integer not null default 0 check (answered >= 0),
  failed          integer not null default 0 check (failed >= 0),
  prompt_tokens   bigint not null default 0 check (prompt_tokens >= 0),
  output_tokens   bigint not null default 0 check (output_tokens >= 0),
  search_queries  integer not null default 0 check (search_queries >= 0),
  cost_cents      numeric(12, 2) not null default 0 check (cost_cents >= 0),
  request_keys    jsonb not null default '{}'::jsonb,
  error           text,
  lease_until     timestamptz,
  created_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  finished_at     timestamptz,
  ingested_at     timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.ai_batches is
  'R74 S34: one Gemini Batch API job of product lookups (one request per product family) and its cost.';

create index if not exists ai_batches_open_idx
  on public.ai_batches (state, created_at)
  where state in ('submitting', 'pending', 'running', 'succeeded', 'failed', 'canceled', 'expired', 'ingesting');

alter table public.lookup_job_items add column if not exists batch_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lookup_job_items_batch_id_fkey') then
    alter table public.lookup_job_items
      add constraint lookup_job_items_batch_id_fkey foreign key (batch_id) references public.ai_batches (id) on delete set null;
  end if;
end $$;

create index if not exists lookup_job_items_batch_idx
  on public.lookup_job_items (batch_id)
  where batch_id is not null;

alter table public.ai_batches enable row level security;

drop policy if exists "ai_batches staff read" on public.ai_batches;
create policy "ai_batches staff read" on public.ai_batches
  for select using (public.is_staff());

notify pgrst, 'reload schema';
