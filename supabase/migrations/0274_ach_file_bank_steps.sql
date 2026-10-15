-- =============================================================================
-- Migration 0274 - R41 S6: the Timberland steps on a released ACH file
-- =============================================================================
-- Plan: R41-TIMBERLAND-SLICE-PLAN v4 section S6.
--
-- 0273 gave ach_files the status flow released -> uploaded -> bank_approved
-- (plus voided) and the stamp columns (uploaded_by/at, approved_at_bank_by/
-- at), but nothing wrote them: no function, and the guard checked the owner
-- only on insert and void. From now on:
--
--   ach_file_mark_uploaded(file, actor)
--       released -> uploaded. Stamps uploaded_by = actor, uploaded_at = now().
--   ach_file_mark_bank_approved(file, actor)
--       uploaded -> bank_approved. Stamps approved_at_bank_by/at.
--
-- Who: the owner (0271 public.ach_actor_is_owner). Michael is Greenway's only
-- Timberland user (signed Appendix B) and Timberland's dual approval is off
-- (signed Schedule C, "Dual Approval Required: No"). So the same person may
-- upload and approve; there is NO uploader-is-not-approver rule here. An admin
-- asks through the 0271 request flow and the owner's approval replays the
-- step as the owner.
--
-- These rows RECORD what Michael did in Timberland's portal. They never block
-- a step at the bank, and a late mark is still recorded (the app warns).
--
-- The guard (replaced, everything 0273 checked is kept) now also refuses:
--   * moving to uploaded without an owner in uploaded_by, or to
--     bank_approved without an owner in approved_at_bank_by;
--   * reaching bank_approved with no upload stamp;
--   * changing an upload or bank-approval stamp once it is set;
--   * a stamp on a file whose status has not reached that step.
--
-- Add-only (two functions, one function body replaced). Functions pin
-- search_path, are NOT security definer, and only service_role may run them.
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule), AFTER 0273.
-- Rollback: supabase/rollbacks/0274_ach_file_bank_steps.rollback.sql
-- Check:    scripts/recon/ach-file-bank-steps-0274-pg-check.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Guard: 0273's rules, plus the owner and set-once rules for the bank steps
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
-- 2. The two bank steps
-- -----------------------------------------------------------------------------
create or replace function public.ach_file_mark_uploaded(p_file_id uuid, p_actor uuid)
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
  if f.status <> 'released' then
    raise exception 'ACH_FILE_TRANSITION: ACH file % is %, not released, so it cannot be marked uploaded.', p_file_id, f.status;
  end if;
  update public.ach_files
     set status = 'uploaded', uploaded_by = p_actor, uploaded_at = now()
   where id = p_file_id;
  return f.kind;
end $$;

create or replace function public.ach_file_mark_bank_approved(p_file_id uuid, p_actor uuid)
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
  if f.status <> 'uploaded' then
    raise exception 'ACH_FILE_TRANSITION: ACH file % is %, not uploaded, so it cannot be marked approved at the bank.', p_file_id, f.status;
  end if;
  update public.ach_files
     set status = 'bank_approved', approved_at_bank_by = p_actor, approved_at_bank_at = now()
   where id = p_file_id;
  return f.kind;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Grants: server only (same pattern as 0273)
-- -----------------------------------------------------------------------------
revoke all on function public.ach_files_guard() from public, anon, authenticated;
revoke all on function public.ach_file_mark_uploaded(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ach_file_mark_bank_approved(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ach_file_mark_uploaded(uuid, uuid) to service_role;
grant execute on function public.ach_file_mark_bank_approved(uuid, uuid) to service_role;

comment on function public.ach_file_mark_uploaded(uuid, uuid) is
  'R41 S6: the owner records that a released ACH file was uploaded to Timberland (released -> uploaded, stamped once).';
comment on function public.ach_file_mark_bank_approved(uuid, uuid) is
  'R41 S6: the owner records that an uploaded ACH file was approved in the Timberland portal (uploaded -> bank_approved, stamped once). Same person may upload and approve: dual approval is off (signed Schedule C).';
