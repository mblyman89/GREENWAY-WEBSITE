-- Rollback for 0276_ach_file_funding_confirm.sql (R41 S9).
--
-- Drops the funding function and puts the 0274 guard back VERBATIM (cut from
-- 0274_ach_file_bank_steps.sql by code, not retyped). Funding stamps already
-- written stay as they are: the 0273 shape constraint still pairs who, when
-- and amount. Nothing is deleted. Safe to re-run.

drop function if exists public.ach_file_confirm_funding(uuid, uuid, bigint);

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

revoke all on function public.ach_files_guard() from public, anon, authenticated;
