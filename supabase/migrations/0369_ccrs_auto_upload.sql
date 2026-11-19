-- 0369_ccrs_auto_upload.sql  (D253 - assisted CCRS uploader, owner option A)
--
-- The owner logs into CCRS himself in his own Chrome. A small Greenway Chrome
-- extension (tools/ccrs-uploader-extension) uploads the files of a run through
-- the same CCRS web form he would use, one file at a time, Group 1 -> 2 -> 3,
-- each group only after the CCRS email answered every file of the group before
-- (owner, D253 verbatim: "I will log in, and then you can upload the three
-- batches, waiting for each email response before uploading the next set").
-- His WA.gov password is never seen or stored. The decisions are made by
-- src/lib/compliance/ccrs-auto-upload-core.ts (pure, self-tested).
--
--   (all three tables: RLS on, no policies, service role only - the hub and
--   the /api/ccrs-uploader routes read them on the server)
--   ccrs_uploader_devices   the browsers paired to the back office. Only the
--                           sha256 of each pairing key is stored, and the key is
--                           shown once. Revoked = refused at once. (KEEP)
--   ccrs_upload_runs        one row per run the owner started (KEEP: what was
--                           sent to the State, when, and by whose authority)
--   ccrs_upload_run_files   the files of a run, in upload order, with what
--                           the CCRS answer page said for each (KEEP)
--
-- Guards in the database (the code also checks them, and these hold even if it
-- does not): one active run at a time, one file in the hands of the browser at a
-- time across every run, and a file is waiting in at most one run.

create table if not exists public.ccrs_uploader_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(label) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_tabs jsonb,
  last_version text check (last_version is null or length(last_version) <= 40),
  revoked_at timestamptz,
  revoked_by uuid,
  silent_alerted_at timestamptz
);
alter table public.ccrs_uploader_devices enable row level security;

create table if not exists public.ccrs_upload_runs (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('prod', 'preprod')),
  state text not null default 'running' check (state in ('running', 'paused', 'stopped', 'done', 'failed')),
  ccrs_username text not null check (ccrs_username ~ '^[^@\s]+@[^@\s]+$'),
  gap_minutes integer not null default 10 check (gap_minutes between 0 and 240),
  accepted_file_ids uuid[] not null default '{}',
  started_by uuid not null,
  started_by_email text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text check (ended_reason is null or length(ended_reason) <= 2000),
  last_decision text check (last_decision is null or length(last_decision) <= 2000),
  last_decision_at timestamptz,
  last_mail_check_at timestamptz,
  alerted_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state in ('running', 'paused')) = (ended_at is null))
);
create unique index if not exists ccrs_upload_runs_one_active on public.ccrs_upload_runs ((true)) where state in ('running', 'paused');
create index if not exists idx_ccrs_upload_runs_started on public.ccrs_upload_runs (started_at desc);
alter table public.ccrs_upload_runs enable row level security;

create table if not exists public.ccrs_upload_run_files (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ccrs_upload_runs(id) on delete restrict,
  file_id uuid not null references public.ccrs_files(id) on delete restrict,
  seq integer not null check (seq >= 1),
  grp integer not null check (grp between 1 and 3),
  file_name text not null,
  file_type text not null check (file_type in ('Strain', 'Area', 'Product', 'Inventory', 'InventoryAdjustment', 'InventoryTransfer', 'Sale')),
  step text not null default 'pending' check (step in ('pending', 'claimed', 'posted', 'refused', 'unknown', 'skipped')),
  claimed_at timestamptz,
  claimed_by_device uuid,
  posted_at timestamptz,
  ccrs_received_at timestamptz,
  receipt text check (receipt is null or length(receipt) <= 2000),
  report jsonb,
  note text check (note is null or length(note) <= 2000),
  updated_at timestamptz not null default now(),
  unique (run_id, file_id),
  unique (run_id, seq),
  check (case step when 'pending' then claimed_at is null when 'skipped' then true else claimed_at is not null end),
  check (step <> 'posted' or posted_at is not null)
);
create unique index if not exists ccrs_upload_run_files_one_claimed on public.ccrs_upload_run_files ((true)) where step = 'claimed';
create unique index if not exists ccrs_upload_run_files_one_waiting on public.ccrs_upload_run_files (file_id) where step in ('pending', 'claimed');
create index if not exists idx_ccrs_upload_run_files_run on public.ccrs_upload_run_files (run_id, seq);
alter table public.ccrs_upload_run_files enable row level security;

revoke all on table public.ccrs_uploader_devices from public, anon, authenticated;
revoke all on table public.ccrs_upload_runs from public, anon, authenticated;
revoke all on table public.ccrs_upload_run_files from public, anon, authenticated;
grant select, insert, update, delete on table public.ccrs_uploader_devices to service_role;
grant select, insert, update, delete on table public.ccrs_upload_runs to service_role;
grant select, insert, update, delete on table public.ccrs_upload_run_files to service_role;
