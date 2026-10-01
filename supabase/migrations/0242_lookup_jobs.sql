-- ============================================================================
-- 0242 - LOOKUP JOBS (bible slice S13, Phase 2, Ring 1)
--
-- WHY THIS EXISTS
-- ---------------
-- Product Onboarding looks a product up one row at a time: open the panel,
-- press Search, wait up to five minutes, repeat (bible F-017). For a 40 line
-- manifest that is 40 clicks and a browser tab held open the whole time.
-- S13 adds one button per manifest. The work runs on the server from a
-- once a minute cron (/api/cron/lookup-jobs), so the tab can be closed.
--
-- WHAT THIS DOES
-- --------------
--   * lookup_jobs: one row per press of the button (manifest, status,
--     how many products, who pressed it, and a lease so only one run works
--     on a job at a time).
--   * lookup_job_items: one row per product in the job (status, the short
--     result, a plain error, attempts, and how many paid AI web lookups it
--     made, so the job can show its cost).
--   * At most ONE active (queued or running) job per manifest: a partial
--     unique index. Pressing the button twice returns the same job.
--   * At most one row per product per job.
--   * No foreign keys on purpose. manifest_id and draft_id are stamps (like
--     product_fact_provenance in 0235): the factory reset empties drafts and
--     manifests, and a kept table may not point into an emptied one.
--   * Row level security ON with NO policy: only the service role (server
--     code behind requirePermission('inventory.manage') and the cron secret)
--     reads or writes these tables. Same posture as 0235 and 0239.
--
-- Additive and idempotent. The code is safe BEFORE this runs: the button
-- explains that this migration is what turns it on, and the cron finds no
-- table and returns without doing anything.
--
-- ROLLBACK: supabase/rollbacks/0242_lookup_jobs.rollback.sql
-- ============================================================================

create table if not exists public.lookup_jobs (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'canceled')),
  total integer not null default 0 check (total >= 0),
  done integer not null default 0 check (done >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  updated_at timestamptz not null default now()
);

comment on table public.lookup_jobs is
  'S13: one batch lookup of a manifest (Look up all N products on this manifest). Worked by /api/cron/lookup-jobs under a lease.';
comment on column public.lookup_jobs.manifest_id is
  'S13: inbound_manifests.id as a stamp (no foreign key, so the factory reset can empty manifests).';
comment on column public.lookup_jobs.lease_until is
  'S13: a run holds the job until this time. Taken with a compare and swap, so a doubled cron tick never runs a job twice.';

create unique index if not exists lookup_jobs_one_active_per_manifest
  on public.lookup_jobs (manifest_id)
  where status in ('queued', 'running');

create index if not exists lookup_jobs_open_idx
  on public.lookup_jobs (created_at)
  where status in ('queued', 'running');

create table if not exists public.lookup_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.lookup_jobs(id) on delete cascade,
  draft_id uuid not null,
  position integer not null default 0,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  attempts integer not null default 0 check (attempts >= 0),
  ai_calls integer not null default 0 check (ai_calls >= 0),
  result_json jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint lookup_job_items_one_per_draft unique (job_id, draft_id)
);

comment on table public.lookup_job_items is
  'S13: one product inside a batch lookup. Claimed with a compare and swap on status and attempts.';
comment on column public.lookup_job_items.draft_id is
  'S13: catalog_product_drafts.id as a stamp (no foreign key, so the factory reset can empty drafts).';
comment on column public.lookup_job_items.ai_calls is
  'S13: paid AI web lookups this product used (0 when the knowledge base already had every fact).';

create index if not exists lookup_job_items_job_status_idx
  on public.lookup_job_items (job_id, status, position);

create index if not exists lookup_job_items_draft_idx
  on public.lookup_job_items (draft_id);

alter table public.lookup_jobs enable row level security;
alter table public.lookup_job_items enable row level security;
