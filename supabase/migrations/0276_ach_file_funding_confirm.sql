-- =============================================================================
-- Migration 0276 - R41 S9: the owner confirms the funding of a released ACH file
-- =============================================================================
-- Plan: R41-TIMBERLAND-SLICE-PLAN v4 section S9, point 4 (funding helper).
--
-- Timberland's ACH agreement, section 14: "Company shall provide Financial
-- Institution with immediately available funds not later than 9:00 a.m. PST
-- on each Settlement Date". Section 16: "Company will maintain in the Account
-- immediately available funds sufficient to cover all credit Entries
-- originated". The app cannot read the balance (no bank feed, and none is
-- assumed), so the owner looks, then records what he saw:
--
--   ach_file_confirm_funding(file, actor, amount_cents)
--       released or uploaded only; once per file; the amount must cover the
--       file total. Stamps funding_confirmed_by/at/amount_cents (the 0273
--       columns, until now never written).
--
-- Who: the owner (0271 public.ach_actor_is_owner). An admin asks through the
-- 0271 request flow and the owner's approval replays it as the owner.
--
-- A confirmation RECORDS what the owner checked. It never blocks an upload or
-- a payment by check; the app warns when it is missing.
--
-- The guard is replaced. Its body is the 0274 guard CUT by code (every 0273
-- and 0274 rule kept byte for byte) plus:
--   * a new file carries no funding confirmation;
--   * the confirmation, once set, never changes;
--   * a new confirmation only on a released or uploaded file, with no status
--     change, by the owner, for at least the file total.
--
-- Add-only (one function, one function body replaced). Functions pin
-- search_path, are NOT security definer, and only service_role may run them.
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule), AFTER 0275.
-- Rollback: supabase/rollbacks/0276_ach_file_funding_confirm.rollback.sql
-- Check:    scripts/recon/ach-file-funding-0276-pg-check.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Guard: 0274's rules (cut by code), plus the funding rules
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
    if new.uploaded_by is not null or new.uploaded_at is not null
       or new.approved_at_bank_by is not null or new.approved_at_bank_at is not null then
      raise exception 'ACH_BANK_STEP: a new ACH file has not been uploaded or approved at the bank yet.';
    end if;
    -- R41 S9 (0276): a new file has no funding confirmation yet.
    if new.funding_confirmed_by is not null or new.funding_confirmed_at is not null
       or new.funding_confirmed_amount_cents is not null then
      raise exception 'ACH_FUNDING: a new ACH file has no funding confirmation yet.';
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
  -- R41 S6 (0274): a stamp, once set, never changes.
  if (old.uploaded_by is not null and new.uploaded_by is distinct from old.uploaded_by)
     or (old.uploaded_at is not null and new.uploaded_at is distinct from old.uploaded_at)
     or (old.approved_at_bank_by is not null and new.approved_at_bank_by is distinct from old.approved_at_bank_by)
     or (old.approved_at_bank_at is not null and new.approved_at_bank_at is distinct from old.approved_at_bank_at) then
    raise exception 'ACH_BANK_STEP_FINAL: who uploaded or approved ACH file % at the bank, and when, never changes.', old.id;
  end if;
  -- R41 S6 (0274): a new stamp only with its step, by the owner.
  if old.uploaded_by is null and new.uploaded_by is not null then
    if not (old.status = 'released' and new.status = 'uploaded') then
      raise exception 'ACH_BANK_STEP: the upload is recorded only when a released file moves to uploaded.';
    end if;
  end if;
  if old.approved_at_bank_by is null and new.approved_at_bank_by is not null then
    if not (old.status = 'uploaded' and new.status = 'bank_approved') then
      raise exception 'ACH_BANK_STEP: the bank approval is recorded only when an uploaded file moves to bank_approved.';
    end if;
  end if;
  -- R41 S9 (0276): the funding confirmation is set once, by the owner, while the
  -- file is released or uploaded, without a status change, and the amount the
  -- owner saw collected covers the file.
  if (old.funding_confirmed_by is not null and new.funding_confirmed_by is distinct from old.funding_confirmed_by)
     or (old.funding_confirmed_at is not null and new.funding_confirmed_at is distinct from old.funding_confirmed_at)
     or (old.funding_confirmed_amount_cents is not null and new.funding_confirmed_amount_cents is distinct from old.funding_confirmed_amount_cents) then
    raise exception 'ACH_FUNDING_FINAL: who confirmed the funding for ACH file %, when, and the amount, never change.', old.id;
  end if;
  if old.funding_confirmed_by is null and new.funding_confirmed_by is not null then
    if not (old.status in ('released', 'uploaded') and new.status = old.status) then
      raise exception 'ACH_FUNDING: funding is confirmed only on a released or uploaded file, on its own (status %).', old.status;
    end if;
    if not public.ach_actor_is_owner(new.funding_confirmed_by) then
      raise exception 'ACH_OWNER_ONLY: only the owner confirms the funding. Send it as a request for owner approval.';
    end if;
    if new.funding_confirmed_amount_cents < old.total_cents then
      raise exception 'ACH_FUNDING_SHORT: the amount confirmed is less than the file total.';
    end if;
  end if;
  if new.status = 'uploaded' and old.status = 'released' then
    if not public.ach_actor_is_owner(new.uploaded_by) then
      raise exception 'ACH_OWNER_ONLY: only the owner records the upload to Timberland. Send it as a request for owner approval.';
    end if;
  end if;
  if new.status = 'bank_approved' and old.status = 'uploaded' then
    if new.uploaded_by is null then
      raise exception 'ACH_BANK_STEP: ACH file % has no upload recorded, so it cannot be approved at the bank.', old.id;
    end if;
    if not public.ach_actor_is_owner(new.approved_at_bank_by) then
      raise exception 'ACH_OWNER_ONLY: only the owner records the approval at Timberland. Send it as a request for owner approval.';
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

-- -----------------------------------------------------------------------------
-- 2. The funding confirmation
-- -----------------------------------------------------------------------------
create or replace function public.ach_file_confirm_funding(p_file_id uuid, p_actor uuid, p_amount_cents bigint)
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
  if f.status not in ('released', 'uploaded') then
    raise exception 'ACH_FILE_TRANSITION: ACH file % is %, so its funding cannot be confirmed.', p_file_id, f.status;
  end if;
  if not public.ach_actor_is_owner(p_actor) then
    raise exception 'ACH_OWNER_ONLY: only the owner confirms the funding. Send it as a request for owner approval.';
  end if;
  if f.funding_confirmed_at is not null then
    raise exception 'ACH_FUNDING_FINAL: the funding for ACH file % was already confirmed.', p_file_id;
  end if;
  if p_amount_cents is null or p_amount_cents < f.total_cents then
    raise exception 'ACH_FUNDING_SHORT: the amount confirmed is less than the file total.';
  end if;
  update public.ach_files
     set funding_confirmed_by = p_actor, funding_confirmed_at = now(), funding_confirmed_amount_cents = p_amount_cents
   where id = p_file_id;
  return f.kind;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Grants: server only (same pattern as 0273 and 0274)
-- -----------------------------------------------------------------------------
revoke all on function public.ach_files_guard() from public, anon, authenticated;
revoke all on function public.ach_file_confirm_funding(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.ach_file_confirm_funding(uuid, uuid, bigint) to service_role;

comment on function public.ach_file_confirm_funding(uuid, uuid, bigint) is
  'R41 S9: the owner records that at least this amount was collected in the account for a released or uploaded ACH file (Timberland sections 14 and 16; stamped once).';
