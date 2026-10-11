-- Rollback for 0263_ach_operations.sql (R39 S7).
--
-- Refuses once 0263 has been USED: a notice logged through ach_notice_log
-- (payee_type set) or a verification past 'planned' is a payment record /
-- evidence the account was checked (owner Q7 archive never delete, Q8
-- retention). Dropping the columns would lose who/what it was for.
--
-- Not touched: the 0258 tables and their rows, the vault (0259), the event
-- log (append-only). Authorizations that 0263 made active stay active.
-- Dynamic SQL: the 0263 columns may already be gone (rollback re-run).
do $$
declare
  used boolean;
begin
  used := false;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ach_return_notices' and column_name = 'payee_type') then
    execute 'select exists (select 1 from public.ach_return_notices where payee_type is not null)' into used;
  end if;
  if used then
    raise exception 'ROLLBACK REFUSED: ach_return_notices holds notices logged through 0263 (payment records). Export them first; do not drop.';
  end if;
  if exists (select 1 from public.ach_verifications where status <> 'planned') then
    raise exception 'ROLLBACK REFUSED: ach_verifications holds sent/finished checks (verification evidence). Export them first; do not drop.';
  end if;
  used := false;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ach_authorizations' and column_name = 'hold_entered_by') then
    execute 'select exists (select 1 from public.ach_authorizations where hold_entered_by is not null)' into used;
  end if;
  if used then
    raise exception 'ROLLBACK REFUSED: ach_authorizations has holds recorded by 0263 (hold_entered_by). Release them first.';
  end if;
end $$;

drop function if exists public.ach_auth_review_done(uuid, uuid, text);
drop function if exists public.ach_auth_set_legal_hold(uuid, uuid, boolean, text);
drop function if exists public.ach_verification_finish(uuid, uuid, text, integer, text);
drop function if exists public.ach_verification_mark_sent(uuid[], uuid, date, date, date, text);
drop function if exists public.ach_verification_start(uuid, uuid, text, integer);
drop function if exists public.ach_auth_release_hold(uuid, uuid, text, text, text);
drop function if exists public.ach_notice_resolve(uuid, uuid, text);
drop function if exists public.ach_notice_log(uuid, text, uuid, text, date, date, bigint, text, text, text, date, text, uuid);

drop trigger if exists trg_ach_verification_guard on public.ach_verifications;
drop function if exists public.ach_verification_guard();
drop trigger if exists trg_ach_notice_guard on public.ach_return_notices;
drop function if exists public.ach_notice_guard();

alter table public.ach_verifications drop constraint if exists ach_ver_note_shape;
alter table public.ach_verifications drop constraint if exists ach_ver_sent_shape;
drop index if exists public.ach_ver_one_open_per_account;

drop index if exists public.ach_auth_review_due_idx;
alter table public.ach_authorizations drop column if exists hold_entered_at;
alter table public.ach_authorizations drop column if exists hold_entered_by;

drop index if exists public.ach_notice_payee_idx;
alter table public.ach_return_notices drop constraint if exists ach_notice_note_shape;
alter table public.ach_return_notices drop constraint if exists ach_notice_hold_applied_shape;
alter table public.ach_return_notices drop constraint if exists ach_notice_corrected_shape;
alter table public.ach_return_notices drop constraint if exists ach_notice_payee_shape;
alter table public.ach_return_notices drop column if exists hold_applied;
alter table public.ach_return_notices drop column if exists corrected_last4;
alter table public.ach_return_notices drop column if exists verification_id;
alter table public.ach_return_notices drop column if exists vendor_id;
alter table public.ach_return_notices drop column if exists employee_id;
alter table public.ach_return_notices drop column if exists payee_type;

notify pgrst, 'reload schema';
