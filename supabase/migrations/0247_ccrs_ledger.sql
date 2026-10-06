-- 0247_ccrs_ledger.sql  (CCRS Bible v2, slice S-12a — Part 03 §D.2, Part 05 §A)
--
-- The filed-identifier ledger: what CCRS holds (per environment), every file we
-- assemble, what each file said about each record, and every finding.
--
--   ccrs_filed_entities  what CCRS holds, per (env, file_type, exact external id)
--   ccrs_files           every file we assembled, whether or not it was uploaded
--   ccrs_file_rows       what each file asserted about each entity
--   ccrs_file_issues     pre-flight and CCRS findings, uncapped
--
-- Grounding (verbatim, Bible v2 Part 01):
--   Brian A21 "They are separate environments."            -> env column
--   Brian A29 "The exact same file name will not be accepted twice, nor would
--             the data."                                     -> unique file_name,
--                                                               unique (env, sha256)
--   Brian A24 per-row acceptance (U-17 CLOSED FALSE, PREprod P20261006A)
--                                                             -> per-row states
--   Upload Guide [G L0247] Update alters "an existing record indicated by
--   external identifier" -> external_id is stored EXACTLY (never case-folded,
--   never trimmed): `unique (env, file_type, external_id)`.
--
-- Differences from the Part 03 §D.2 sketch, each deliberate:
--   * ccrs_files is created first (entities reference it).
--   * sha256 / number_records / storage_path are NULL while a file is `draft`
--     (Part 05 §A: draft = "nothing written") and REQUIRED in every other
--     state (check constraint), instead of `not null` from birth.
--   * product_external_id (Inventory: the filed "Product Identifier" the lot
--     points at; ccrs-ledger-core.ts LedgerEntry.productExternalId) and
--     seed_conflicts (Part 03 §D.4: Product id `1` x4, duplicate Strain rows)
--     are explicit columns.
--   * purpose 'seed' is allowed (Part 03 §D.4: each delivery source file is
--     recorded as a pseudo-file, state 'closed').
--   * DB guards mirror src/lib/compliance/ccrs-file-state-core.ts: legal state
--     transitions only; sha256 / file_name / number_records / env / file_type
--     immutable once a file leaves `draft`; a file that left `draft` can never
--     be deleted (it is a record of what we sent the State).
--
-- Factory reset: all four tables are KEEP (factory-reset-core.ts TABLE_RULES):
-- they mirror the State's records, and emptying them would make the next batch
-- re-Insert lots CCRS already holds.
--
-- Idempotent (if not exists / drop ... if exists / create or replace). Safe on
-- an empty database. Rollback: supabase/rollbacks/0247_ccrs_ledger.rollback.sql.
-- Check: scripts/recon/ccrs-ledger-pg-check.sql. Owner applies MANUALLY in the
-- Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- 1) ccrs_files
-- ---------------------------------------------------------------------------
create table if not exists public.ccrs_files (
  id                uuid primary key default gen_random_uuid(),
  env               text not null check (env in ('preprod', 'prod')),
  file_type         text not null check (file_type in
                      ('Strain', 'Area', 'Product', 'Inventory', 'Sale',
                       'InventoryAdjustment', 'InventoryTransfer')),
  purpose           text not null check (purpose in
                      ('weekly', 'cleanup:stale', 'cleanup:cost', 'cleanup:area',
                       'probe', 'strain-backfill', 'seed')),
  wave              text,
  chunk_no          integer not null default 1 check (chunk_no >= 1),
  chunk_of          integer not null default 1 check (chunk_of >= 1),
  file_name         text not null unique,
  sha256            text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  number_records    integer check (number_records is null or number_records >= 0),
  sum_qoh           numeric,
  sum_total_cost    numeric,
  distinct_ids      integer,
  storage_path      text,
  state             text not null default 'draft' check (state in
                      ('draft', 'emitted', 'uploaded', 'succeeded', 'errored',
                       'reconciling', 'closed', 'abandoned')),
  emitted_at        timestamptz,
  uploaded_at       timestamptz,
  uploaded_by       uuid references public.staff_profiles(id) on delete set null,
  success_email_at  timestamptz,
  error_email_at    timestamptz,
  error_messages    text[],
  copy_requested_at timestamptz,
  copy_received_at  timestamptz,
  reconciled_at     timestamptz,
  supersedes_file_id uuid references public.ccrs_files(id) on delete restrict,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ccrs_files_chunk_in_range check (chunk_no <= chunk_of),
  constraint ccrs_files_bytes_fixed_after_draft check (
    state = 'draft'
    or (sha256 is not null and number_records is not null and storage_path is not null)
  )
);

create unique index if not exists ccrs_files_env_sha256_key
  on public.ccrs_files (env, sha256);
create index if not exists idx_ccrs_files_env_state
  on public.ccrs_files (env, state, created_at desc);

comment on table public.ccrs_files is
  'Every CCRS file we assembled (S-12a, Bible v2 Part 03 §D.2 / Part 05 §A). '
  'Same name or same bytes never twice per env (Brian A29). Legal transitions and '
  'post-draft immutability enforced by ccrs_files_guard().';

-- ---------------------------------------------------------------------------
-- 2) ccrs_filed_entities
-- ---------------------------------------------------------------------------
create table if not exists public.ccrs_filed_entities (
  id                  uuid primary key default gen_random_uuid(),
  env                 text not null check (env in ('preprod', 'prod')),
  file_type           text not null check (file_type in
                        ('Strain', 'Area', 'Product', 'Inventory', 'Sale',
                         'InventoryAdjustment', 'InventoryTransfer')),
  external_id         text not null check (external_id <> ''),
  filed_name          text,
  product_external_id text,
  state               text not null check (state in
                        ('seed', 'filed', 'confirmed', 'uncertain', 'closed',
                         'deleted', 'unknown')),
  source              text not null,
  first_filed_at      timestamptz,
  last_operation      text check (last_operation in ('Insert', 'Update', 'Delete')),
  last_file_id        uuid references public.ccrs_files(id) on delete restrict,
  last_payload        jsonb,
  seed_payload        jsonb,
  seed_conflicts      jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ccrs_filed_entities_env_type_id_key unique (env, file_type, external_id)
);

create index if not exists idx_ccrs_filed_entities_name
  on public.ccrs_filed_entities (env, file_type, filed_name);
create index if not exists idx_ccrs_filed_entities_product
  on public.ccrs_filed_entities (env, product_external_id)
  where product_external_id is not null;

comment on table public.ccrs_filed_entities is
  'What CCRS holds, per env, per file type, per EXACT external id (never case-folded '
  'or trimmed; [G L0247]). For Strain the external_id is the strain name. Seeded from '
  'the LCB Service Desk delivery (S-12a); routing reads it (ccrs-ledger-core.ts).';
comment on column public.ccrs_filed_entities.product_external_id is
  'Inventory only: the filed Product Identifier this lot points at. The Product.Name '
  'it must carry comes from that Product entity, never from the Inventory report display (U-42).';
comment on column public.ccrs_filed_entities.seed_conflicts is
  'Every delivery row that collapsed onto this (env,file_type,external_id) when there was more '
  'than one (Product id 1 x4; duplicate Strain rows). Null when the source had one row.';

-- ---------------------------------------------------------------------------
-- 3) ccrs_file_rows
-- ---------------------------------------------------------------------------
create table if not exists public.ccrs_file_rows (
  id            uuid primary key default gen_random_uuid(),
  file_id       uuid not null references public.ccrs_files(id) on delete cascade,
  row_no        integer not null check (row_no >= 1),
  entity_id     uuid references public.ccrs_filed_entities(id) on delete restrict,
  external_id   text not null,
  operation     text check (operation in ('Insert', 'Update', 'Delete')),
  payload       jsonb not null,
  state         text not null check (state in
                  ('planned', 'emitted', 'submitted', 'confirmed', 'rejected',
                   'uncertain', 'withheld')),
  withheld_code text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ccrs_file_rows_file_row_key unique (file_id, row_no),
  constraint ccrs_file_rows_withheld_has_code check (
    (state = 'withheld') = (withheld_code is not null)
  )
);

create index if not exists idx_ccrs_file_rows_external
  on public.ccrs_file_rows (external_id);

comment on table public.ccrs_file_rows is
  'What each file asserted about each record. operation is null only for Strain rows, '
  'which have no Operation column [G L0319]. on delete cascade only ever fires for a '
  'draft file: ccrs_files_guard() refuses to delete any file that left draft.';

-- ---------------------------------------------------------------------------
-- 4) ccrs_file_issues
-- ---------------------------------------------------------------------------
create table if not exists public.ccrs_file_issues (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid references public.ccrs_files(id) on delete cascade,
  row_id     uuid references public.ccrs_file_rows(id) on delete cascade,
  severity   text not null check (severity in ('info', 'warning', 'error')),
  code       text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ccrs_file_issues_file
  on public.ccrs_file_issues (file_id);

comment on table public.ccrs_file_issues is
  'Pre-flight and CCRS findings, uncapped (replaces the .slice(0,25) and '
  'WARNING_CAP_PER_FILE caps in S-12b).';

-- ---------------------------------------------------------------------------
-- 5) Guard: legal transitions, post-draft immutability, no delete after draft.
--    The transition set is IDENTICAL to CCRS_FILE_TRANSITIONS in
--    src/lib/compliance/ccrs-file-state-core.ts (a vitest parses both).
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_files_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  legal constant text[] := array[
    'draft>emitted',
    'emitted>uploaded',
    'emitted>abandoned',
    'uploaded>succeeded',
    'uploaded>errored',
    'uploaded>reconciling',
    'succeeded>closed',
    'errored>closed',
    'errored>reconciling',
    'reconciling>closed'
  ];
begin
  if tg_op = 'INSERT' then
    if new.state <> 'draft' and not (new.purpose = 'seed' and new.state = 'closed') then
      raise exception 'CCRS_FILE_BAD_BIRTH: a file is born draft (seed pseudo-files closed); got %', new.state
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.state <> 'draft' then
      raise exception 'CCRS_FILE_IS_RECORD: file % left draft (state %) and can never be deleted', old.file_name, old.state
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.state is distinct from old.state
     and not ((old.state || '>' || new.state) = any (legal)) then
    raise exception 'CCRS_FILE_BAD_TRANSITION: % -> % is not a legal file transition', old.state, new.state
      using errcode = 'check_violation';
  end if;
  if old.state <> 'draft' and (
       new.sha256 is distinct from old.sha256
    or new.file_name is distinct from old.file_name
    or new.number_records is distinct from old.number_records
    or new.env is distinct from old.env
    or new.file_type is distinct from old.file_type
    or new.storage_path is distinct from old.storage_path
  ) then
    raise exception 'CCRS_FILE_IMMUTABLE: file % left draft; its name, bytes, hash, count, env and type are fixed', old.file_name
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function public.ccrs_files_guard() is
  'S-12a: Part 05 §A file state machine at the database. Mirrors ccrs-file-state-core.ts.';

drop trigger if exists trg_ccrs_files_guard on public.ccrs_files;
create trigger trg_ccrs_files_guard
  before insert or update or delete on public.ccrs_files
  for each row execute function public.ccrs_files_guard();

drop trigger if exists trg_ccrs_files_updated on public.ccrs_files;
create trigger trg_ccrs_files_updated
  before update on public.ccrs_files
  for each row execute function public.set_updated_at();

drop trigger if exists trg_ccrs_filed_entities_updated on public.ccrs_filed_entities;
create trigger trg_ccrs_filed_entities_updated
  before update on public.ccrs_filed_entities
  for each row execute function public.set_updated_at();

drop trigger if exists trg_ccrs_file_rows_updated on public.ccrs_file_rows;
create trigger trg_ccrs_file_rows_updated
  before update on public.ccrs_file_rows
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) RLS — mirrors ccrs_week_submissions (0118): staff read, admin write.
-- ---------------------------------------------------------------------------
alter table public.ccrs_files          enable row level security;
alter table public.ccrs_filed_entities enable row level security;
alter table public.ccrs_file_rows      enable row level security;
alter table public.ccrs_file_issues    enable row level security;

drop policy if exists "ccrs_files staff read" on public.ccrs_files;
create policy "ccrs_files staff read" on public.ccrs_files
  for select using (public.is_staff());
drop policy if exists "ccrs_files admin write" on public.ccrs_files;
create policy "ccrs_files admin write" on public.ccrs_files
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ccrs_filed_entities staff read" on public.ccrs_filed_entities;
create policy "ccrs_filed_entities staff read" on public.ccrs_filed_entities
  for select using (public.is_staff());
drop policy if exists "ccrs_filed_entities admin write" on public.ccrs_filed_entities;
create policy "ccrs_filed_entities admin write" on public.ccrs_filed_entities
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ccrs_file_rows staff read" on public.ccrs_file_rows;
create policy "ccrs_file_rows staff read" on public.ccrs_file_rows
  for select using (public.is_staff());
drop policy if exists "ccrs_file_rows admin write" on public.ccrs_file_rows;
create policy "ccrs_file_rows admin write" on public.ccrs_file_rows
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ccrs_file_issues staff read" on public.ccrs_file_issues;
create policy "ccrs_file_issues staff read" on public.ccrs_file_issues
  for select using (public.is_staff());
drop policy if exists "ccrs_file_issues admin write" on public.ccrs_file_issues;
create policy "ccrs_file_issues admin write" on public.ccrs_file_issues
  for all using (public.is_admin()) with check (public.is_admin());
