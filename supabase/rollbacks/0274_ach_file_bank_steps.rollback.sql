-- Rollback for 0274_ach_file_bank_steps.sql (R41 S6).
--
-- Drops the two bank-step functions and puts the 0273 guard back VERBATIM
-- (cut from 0273_ach_files.sql by code, not retyped). Rows already marked
-- uploaded or bank_approved stay as they are: 0273 allows those statuses and
-- the 0273 shape constraints still pair each stamp with its time. Nothing is
-- deleted. Safe to re-run.

drop function if exists public.ach_file_mark_bank_approved(uuid, uuid);
drop function if exists public.ach_file_mark_uploaded(uuid, uuid);

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

revoke all on function public.ach_files_guard() from public, anon, authenticated;
