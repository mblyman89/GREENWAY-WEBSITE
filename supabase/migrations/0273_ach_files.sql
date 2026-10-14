-- =============================================================================
-- Migration 0273 - R41 S3: the ACH file ledger (release once, duplicate block)
-- =============================================================================
-- Plan: R41-TIMBERLAND-SLICE-PLAN v4 section S3 (v2 section S3 for the detail).
--
-- Before this, every download of a payroll file REBUILT it: the download
-- route called generatePayrollNacha again, which re-ran the guardrails and
-- re-stamped approved_by, approved_at and generated_at on the run. A file the
-- owner already uploaded could come back different, and the record of who
-- released it was overwritten by whoever downloaded it last.
--
-- From now on an ACH file is RELEASED ONCE and kept:
--   ach_files            one row per released file. The exact bytes served to
--                        the bank (CRLF), encrypted (body_enc, encv1, because
--                        they hold account numbers) with their SHA-256. A
--                        download decrypts, re-checks the SHA-256 and serves
--                        the bytes. It writes nothing and rebuilds nothing.
--   file_id_modifier     File Header position 34, one of A-Z or 0-9, unique
--                        per Pacific day (file_date) INCLUDING voided files:
--                        a voided file may already be at the bank, so its
--                        letter is never handed out again that day. The app
--                        picks the next free one (ach-file-ledger-core).
--                        Sources: docs/authorities/ach/odfi-hometrust-ach-
--                        format-2023.txt and odfi-banc-of-california-nacha-
--                        file-format.txt (bank summaries, not the Rules).
--   duplicate block      Timberland answered that the portal will NOT reject
--                        two files with the same date and file ID (Brenda,
--                        answer 9, docs/authorities/ach/timberland-brenda-
--                        2026-10.txt). So the database refuses a second live
--                        file with exactly the same payments (keyed HMAC of
--                        the sorted routing, account and amount list) and
--                        the same effective date, a second live file with the
--                        same bytes, and a second live file for the same
--                        source (one payroll run, one file).
--   void                 owner only, with a reason of 10+ characters. The row
--                        and its bytes stay. A re-release is a new row with
--                        a new letter.
--   never deleted        the trigger refuses DELETE (Timberland agreement
--                        section 12 asks for one calendar year, the owner
--                        rule is forever).
--
-- ach_file_release_payroll locks the payroll run, refuses a run that already
-- has a live file, and in ONE transaction writes the ledger row and stamps the
-- run (file_generated, filename, generated, approved, guardrail override).
-- That is the only place a payroll run is stamped from now on.
--
-- Who: the stamped actor (released_by, voided_by) must be the active owner
-- (0271 public.ach_actor_is_owner). An admin asks through the 0271 request
-- flow, and the owner approval replays the action as the owner.
--
-- Also: the 0271 ach_change_requests.target_type list gains ach_file (the
-- target of the new void request).
--
-- Add-only. Functions pin search_path, are NOT security definer, and only
-- service_role may run them. Idempotent: safe to paste and re-run in the
-- Supabase SQL editor. Apply MANUALLY (standing rule), AFTER 0272.
-- Rollback: supabase/rollbacks/0273_ach_files.rollback.sql
-- Check:    scripts/recon/ach-files-0273-pg-check.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table
-- -----------------------------------------------------------------------------
create table if not exists public.ach_files (
  id                             uuid primary key default gen_random_uuid(),
  kind                           text not null check (kind in ('payroll', 'vendor', 'prenote', 'micro_entry')),
  source_id                      text not null check (length(source_id) between 1 and 200),
  file_date                      date not null,
  file_id_modifier               text not null check (file_id_modifier ~ '^[A-Z0-9]$'),
  filename                       text not null check (filename ~ '^[A-Za-z0-9_.-]{1,120}$'),
  effective_date                 date not null,
  entry_count                    integer not null check (entry_count >= 1),
  total_cents                    bigint not null check (total_cents >= 0),
  counts_toward_limit            boolean not null,
  sha256                         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  entry_set_hmac                 text not null check (entry_set_hmac ~ '^[0-9a-f]{64}$'),
  body_enc                       text not null check (body_enc like 'encv1:%'),
  status                         text not null default 'released'
                                   check (status in ('released', 'uploaded', 'bank_approved', 'voided')),
  released_by                    uuid not null references public.staff_profiles (id) on delete restrict,
  released_at                    timestamptz not null default now(),
  uploaded_by                    uuid references public.staff_profiles (id) on delete restrict,
  uploaded_at                    timestamptz,
  approved_at_bank_by            uuid references public.staff_profiles (id) on delete restrict,
  approved_at_bank_at            timestamptz,
  voided_by                      uuid references public.staff_profiles (id) on delete restrict,
  voided_at                      timestamptz,
  voided_reason                  text,
  upload_deadline_at             timestamptz,
  settlement_date                date,
  funding_confirmed_by           uuid references public.staff_profiles (id) on delete restrict,
  funding_confirmed_at           timestamptz,
  funding_confirmed_amount_cents bigint check (funding_confirmed_amount_cents is null or funding_confirmed_amount_cents >= 0),
  created_at                     timestamptz not null default now(),
  constraint ach_files_kind_limit check (counts_toward_limit = (kind <> 'prenote')),
  constraint ach_files_prenote_zero check (kind <> 'prenote' or total_cents = 0),
  constraint ach_files_void_shape check (
    (status = 'voided') = (voided_at is not null)
    and (voided_at is null) = (voided_by is null)
    and (voided_at is null) = (voided_reason is null)
    and (voided_reason is null or length(trim(voided_reason)) between 10 and 500)
  ),
  constraint ach_files_uploaded_shape check ((uploaded_at is null) = (uploaded_by is null)),
  constraint ach_files_approved_shape check ((approved_at_bank_at is null) = (approved_at_bank_by is null)),
  constraint ach_files_funding_shape check (
    (funding_confirmed_at is null) = (funding_confirmed_by is null)
    and (funding_confirmed_at is null) = (funding_confirmed_amount_cents is null)
  )
);

-- One letter per Pacific day, voided files included (a constraint, so the
-- app retry can name it).
alter table public.ach_files drop constraint if exists ach_files_day_modifier_key;
alter table public.ach_files add constraint ach_files_day_modifier_key unique (file_date, file_id_modifier);

-- Live (not voided) uniqueness.
create unique index if not exists ach_files_sha_live
  on public.ach_files (sha256) where status <> 'voided';
create unique index if not exists ach_files_no_duplicate_entries
  on public.ach_files (entry_set_hmac, effective_date) where status <> 'voided';
create unique index if not exists ach_files_one_live_per_source
  on public.ach_files (kind, source_id) where status <> 'voided';

create index if not exists ach_files_released_idx on public.ach_files (released_at desc);
create index if not exists ach_files_open_idx on public.ach_files (effective_date) where status in ('released', 'uploaded');

-- -----------------------------------------------------------------------------
-- 2. Guard: never deleted, the facts never change, only forward moves
-- -----------------------------------------------------------------------------
create or replace function public.ach_files_guard()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ACH_FILE_KEEP: ACH file % is a payment record and is never deleted. Void it instead.', old.id;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'released' then
      raise exception 'ACH_FILE_TRANSITION: a new ACH file starts as released, not %.', new.status;
    end if;
    if not public.ach_actor_is_owner(new.released_by) then
      raise exception 'ACH_OWNER_ONLY: only the owner releases an ACH file. Send it as a request for owner approval.';
    end if;
    return new;
  end if;
  -- UPDATE
  if old.status = 'voided' then
    raise exception 'ACH_FILE_FINAL: ACH file % is voided and never changes.', old.id;
  end if;
  if new.id <> old.id or new.kind <> old.kind or new.source_id <> old.source_id
     or new.file_date <> old.file_date or new.file_id_modifier <> old.file_id_modifier
     or new.filename <> old.filename or new.effective_date <> old.effective_date
     or new.entry_count <> old.entry_count or new.total_cents <> old.total_cents
     or new.counts_toward_limit <> old.counts_toward_limit or new.sha256 <> old.sha256
     or new.entry_set_hmac <> old.entry_set_hmac or new.body_enc <> old.body_enc
     or new.released_by <> old.released_by or new.released_at <> old.released_at
     or new.created_at <> old.created_at then
    raise exception 'ACH_FILE_IMMUTABLE: the bytes, date, letter, totals and releaser of ACH file % never change.', old.id;
  end if;
  if new.status <> old.status then
    if not (
         (old.status = 'released' and new.status in ('uploaded', 'voided'))
      or (old.status = 'uploaded' and new.status in ('bank_approved', 'voided'))
      or (old.status = 'bank_approved' and new.status = 'voided')
    ) then
      raise exception 'ACH_FILE_TRANSITION: % -> % is not allowed.', old.status, new.status;
    end if;
  end if;
  if new.status = 'voided' then
    if length(trim(coalesce(new.voided_reason, ''))) < 10 then
      raise exception 'ACH_FILE_REASON: say why ACH file % is voided (10+ characters).', old.id;
    end if;
    if not public.ach_actor_is_owner(new.voided_by) then
      raise exception 'ACH_OWNER_ONLY: only the owner voids an ACH file. Send it as a request for owner approval.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_files_guard on public.ach_files;
create trigger trg_ach_files_guard
  before insert or update or delete on public.ach_files
  for each row execute function public.ach_files_guard();

-- -----------------------------------------------------------------------------
-- 3. Release a payroll file: the ledger row and the run stamp, together, once
-- -----------------------------------------------------------------------------
create or replace function public.ach_file_release_payroll(
  p_run_id           uuid,
  p_actor            uuid,
  p_file_date        date,
  p_modifier         text,
  p_filename         text,
  p_effective        date,
  p_entry_count      integer,
  p_total_cents      bigint,
  p_sha256           text,
  p_entry_set_hmac   text,
  p_body_enc         text,
  p_override         boolean,
  p_override_reason  text
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r      public.payroll_runs%rowtype;
  new_id uuid;
begin
  select * into r from public.payroll_runs where id = p_run_id for update;
  if not found then
    raise exception 'ACH_FILE_NOT_FOUND: payroll run %.', p_run_id using errcode = 'check_violation';
  end if;
  if r.status <> 'draft' then
    raise exception 'ACH_FILE_ALREADY_RELEASED: payroll run % is %, not a draft.', p_run_id, r.status using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ach_files where kind = 'payroll' and source_id = p_run_id::text and status <> 'voided') then
    raise exception 'ACH_FILE_ALREADY_RELEASED: payroll run % already has a live file.', p_run_id using errcode = 'check_violation';
  end if;

  insert into public.ach_files (kind, source_id, file_date, file_id_modifier, filename, effective_date,
                                entry_count, total_cents, counts_toward_limit, sha256, entry_set_hmac,
                                body_enc, released_by)
  values ('payroll', p_run_id::text, p_file_date, p_modifier, p_filename, p_effective,
          p_entry_count, p_total_cents, true, p_sha256, p_entry_set_hmac, p_body_enc, p_actor)
  returning id into new_id;

  update public.payroll_runs
     set status = 'file_generated',
         nacha_filename = p_filename,
         file_id_modifier = p_modifier,
         generated_at = now(),
         approved_by = p_actor,
         approved_at = now(),
         guardrail_override = coalesce(p_override, false),
         guardrail_override_reason = case when coalesce(p_override, false) then p_override_reason else null end,
         guardrail_override_by = case when coalesce(p_override, false) then p_actor else null end,
         updated_by = p_actor
   where id = p_run_id;

  return new_id;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Void: owner, with a reason. A voided payroll file puts its run back to
--    draft so a corrected file can be released (with a new letter).
-- -----------------------------------------------------------------------------
create or replace function public.ach_file_void(p_file_id uuid, p_actor uuid, p_reason text)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  f public.ach_files%rowtype;
begin
  select * into f from public.ach_files where id = p_file_id for update;
  if not found then
    raise exception 'ACH_FILE_NOT_FOUND: ACH file %.', p_file_id using errcode = 'check_violation';
  end if;
  update public.ach_files
     set status = 'voided', voided_by = p_actor, voided_at = now(), voided_reason = trim(p_reason)
   where id = p_file_id;
  if f.kind = 'payroll' then
    update public.payroll_runs
       set status = 'draft', updated_by = p_actor
     where id::text = f.source_id and status = 'file_generated';
  end if;
  return f.kind;
end $$;

-- -----------------------------------------------------------------------------
-- 5. 0271 request target: the ACH file (void requests)
-- -----------------------------------------------------------------------------
alter table public.ach_change_requests drop constraint if exists ach_change_requests_target_type_check;
alter table public.ach_change_requests add constraint ach_change_requests_target_type_check
  check (target_type in ('vendor', 'employee', 'authorization', 'account', 'verification',
                         'notice', 'document', 'contact', 'invite', 'payroll_run',
                         'company', 'vendor_payment', 'ach_file'));

-- -----------------------------------------------------------------------------
-- 6. RLS and grants (same pattern as 0258 / 0263)
-- -----------------------------------------------------------------------------
alter table public.ach_files enable row level security;

drop policy if exists ach_files_admin_read on public.ach_files;
create policy ach_files_admin_read on public.ach_files
  for select using (public.is_admin());

-- Writes go through the server (service_role) and the functions above only.
-- The 0258 grant note applies: Supabase stops exposing new tables to the
-- API roles automatically, so the grants are explicit. Least privilege:
--   anon           nothing.
--   authenticated  select, narrowed by RLS to admins. No insert, update or
--                  delete: a browser session can never write the ledger.
--   service_role   select, insert, update (the triggers still refuse every
--                  change to the facts of a released file, and every delete).
revoke all on table public.ach_files from anon;
revoke all on table public.ach_files from authenticated;
grant select on table public.ach_files to authenticated;
revoke delete on table public.ach_files from service_role;
grant select, insert, update on table public.ach_files to service_role;

revoke all on function public.ach_files_guard() from public, anon, authenticated;
revoke all on function public.ach_file_release_payroll(uuid, uuid, date, text, text, date, integer, bigint, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.ach_file_void(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ach_file_release_payroll(uuid, uuid, date, text, text, date, integer, bigint, text, text, text, boolean, text) to service_role;
grant execute on function public.ach_file_void(uuid, uuid, text) to service_role;

comment on table public.ach_files is
  'R41 S3: every released ACH file, once. Encrypted bytes (encv1) + sha256 re-checked on download. File ID Modifier A-Z/0-9 unique per Pacific day incl. voided. Never deleted; void (owner, reason) and re-release.';
comment on column public.ach_files.entry_set_hmac is
  'Keyed HMAC (HKDF from DATA_ENCRYPTION_KEY) of the sorted routing|account|cents list. Same payments + same effective date while live = refused (Brenda answer 9: the portal does not catch repeats).';
comment on function public.ach_file_release_payroll(uuid, uuid, date, text, text, date, integer, bigint, text, text, text, boolean, text) is
  'R41 S3: writes the payroll ledger row and stamps the run in one transaction. Refuses a run that is not a draft or already has a live file.';
comment on function public.ach_file_void(uuid, uuid, text) is
  'R41 S3: owner voids a file with a 10+ character reason; a voided payroll file returns its run to draft.';
