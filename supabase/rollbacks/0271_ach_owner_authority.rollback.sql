-- Rollback for 0271_ach_owner_authority.sql (R41 S0).
--
-- REFUSES once 0271 has been USED, because these are records the owner keeps
-- (R39 owner Q7 "archive, never delete"; Q8 retention):
--   * any row in ach_change_requests or ach_owner_reviews;
--   * any vendor banking released in 'owner' mode (the 0259 shape check only
--     allows 'dual' / 'solo', so it could not be restored);
--   * any 'hold_released_owner' event;
--   * any employee bank change stamped by 0271 (bank_changed_by / _at).
--
-- Otherwise it restores, VERBATIM from the earlier migrations:
--   * vendor_bank_guard() and vbd_release_mode_shape from 0259;
--   * ach_auth_release_hold() from 0263;
--   * the three 0258 policies that let a manager drop ACH documents (D-5 undone).
-- and drops everything 0271 added. Safe to re-run.
do $$
declare
  used boolean;
begin
  if to_regclass('public.ach_change_requests') is not null then
    execute 'select exists (select 1 from public.ach_change_requests)' into used;
    if used then
      raise exception 'ROLLBACK REFUSED: ach_change_requests holds owner-approval requests (records). Export them first; do not drop.';
    end if;
  end if;
  if to_regclass('public.ach_owner_reviews') is not null then
    execute 'select exists (select 1 from public.ach_owner_reviews)' into used;
    if used then
      raise exception 'ROLLBACK REFUSED: ach_owner_reviews holds the owner review list (records). Export it first; do not drop.';
    end if;
  end if;
  if exists (select 1 from public.vendor_bank_details where release_mode = 'owner') then
    raise exception 'ROLLBACK REFUSED: vendor banking was released in owner mode; the 0259 shape (dual / solo) cannot hold it.';
  end if;
  if exists (select 1 from public.ach_authorization_events where event_kind = 'hold_released_owner') then
    raise exception 'ROLLBACK REFUSED: owner hold releases are logged (hold_released_owner). They are payment records.';
  end if;
  used := false;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees' and column_name = 'bank_changed_by') then
    execute 'select exists (select 1 from public.employees where bank_changed_by is not null or bank_changed_at is not null)' into used;
  end if;
  if used then
    raise exception 'ROLLBACK REFUSED: employee bank changes carry 0271 owner stamps (bank_changed_by / bank_changed_at). Export them first.';
  end if;
end $$;

-- New tables (empty, checked above) and their functions.
drop table if exists public.ach_change_request_events;
drop table if exists public.ach_change_requests;
drop table if exists public.ach_owner_reviews;
drop function if exists public.ach_request_record_result(uuid, uuid, text, text);
drop function if exists public.ach_request_decide(uuid, uuid, text, text, text);
drop function if exists public.ach_change_requests_guard();
drop function if exists public.ach_change_request_events_append_only();
drop function if exists public.ach_owner_reviews_guard();

-- Owner guards on existing tables.
drop trigger if exists trg_employees_bank_owner_guard on public.employees;
drop function if exists public.employees_bank_owner_guard();
alter table public.employees drop column if exists bank_changed_at;
alter table public.employees drop column if exists bank_changed_by;
drop trigger if exists trg_ach_company_settings_owner_guard on public.ach_company_settings;
drop function if exists public.ach_company_settings_owner_guard();
drop trigger if exists trg_ach_auth_owner_guard on public.ach_authorizations;
drop function if exists public.ach_auth_owner_guard();
drop trigger if exists trg_ach_acct_owner_guard on public.ach_authorization_accounts;
drop function if exists public.ach_acct_owner_guard();

-- 0259 vendor vault guard and release-mode shape, verbatim.
alter table public.vendor_bank_details drop constraint if exists vbd_release_mode_shape;
alter table public.vendor_bank_details add constraint vbd_release_mode_shape
  check (release_mode is null or release_mode in ('dual', 'solo'));

create or replace function public.vendor_bank_guard()
returns trigger language plpgsql as $$
declare
  bank_changed boolean;
  is_solo boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'VAULT_ARCHIVE_ONLY: vendor banking % is never deleted. Archive it instead.', old.id;
  end if;

  if tg_op = 'INSERT' then
    bank_changed := true;
  else
    bank_changed := new.bank_routing is distinct from old.bank_routing
                 or new.bank_account_number is distinct from old.bank_account_number
                 or new.bank_account_type is distinct from old.bank_account_type;
  end if;

  -- 1. New or changed banking always lands on hold, stamped with its author.
  if bank_changed then
    new.status := 'on_hold';
    new.change_entered_by := coalesce(new.updated_by, new.created_by);
    new.change_entered_at := now();
    if coalesce(length(trim(new.hold_reason)), 0) = 0
       or (tg_op = 'UPDATE' and new.hold_reason is not distinct from old.hold_reason) then
      new.hold_reason := case when tg_op = 'INSERT' then 'New banking added' else 'Bank details changed' end;
    end if;
    new.released_by := null;
    new.released_at := null;
    new.release_mode := null;
    new.release_callback_method := null;
    new.release_callback_note := null;
    new.release_reason := null;
    new.verified_at := null;
    new.verified_note := null;
    return new;
  end if;

  if tg_op = 'INSERT' or new.status is not distinct from old.status then
    return new;
  end if;
  -- Unknown status values fall through to vendor_bank_details_status_check.
  if new.status not in ('active', 'on_hold', 'revoked', 'archived') then
    return new;
  end if;

  -- 4. Archived / revoked come back only through on_hold.
  if old.status = 'archived' and new.status <> 'on_hold' then
    raise exception 'VAULT_TRANSITION: archived banking can only be re-opened on hold (% -> %).', old.status, new.status;
  end if;
  if old.status = 'revoked' and new.status not in ('on_hold', 'archived') then
    raise exception 'VAULT_TRANSITION: revoked banking can only be re-opened on hold or archived (% -> %).', old.status, new.status;
  end if;

  -- 2. Going active needs a fresh, complete release record.
  if new.status = 'active' then
    if new.released_by is null or new.released_at is null
       or (old.released_at is not null and new.released_at <= old.released_at) then
      raise exception 'VAULT_RELEASE: record who released the hold and when.';
    end if;
    if new.release_callback_method is null or coalesce(length(trim(new.release_callback_note)), 0) < 10 then
      raise exception 'VAULT_RELEASE: record how the payee confirmed the details (phone or in person) and a note of 10+ characters.';
    end if;
    is_solo := new.change_entered_by is null or new.change_entered_by = new.released_by;
    if is_solo and new.release_mode is distinct from 'solo' then
      raise exception 'VAULT_RELEASE: the person who entered the change (or an unknown author) releasing it is a SOLO release.';
    end if;
    if not is_solo and new.release_mode is distinct from 'dual' then
      raise exception 'VAULT_RELEASE: a release by a different person is a DUAL release.';
    end if;
    if is_solo and coalesce(length(trim(new.release_reason)), 0) < 20 then
      raise exception 'VAULT_RELEASE: a solo release needs a written reason of 20+ characters.';
    end if;
  end if;

  if new.status = 'on_hold' and new.hold_reason is not distinct from old.hold_reason then
    raise exception 'VAULT_HOLD: putting banking on hold needs a new reason.';
  end if;

  if new.status = 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_vendor_bank_guard on public.vendor_bank_details;
create trigger trg_vendor_bank_guard
  before insert or update or delete on public.vendor_bank_details
  for each row execute function public.vendor_bank_guard();

comment on function public.vendor_bank_guard() is
  'R39 0259: vendor vault change control. New/changed banking -> on_hold with author; release needs callback method + note, solo needs 20+ char reason, dual must be a different person; no deletes (archive); archived/revoked re-open only on hold. Mirrors releaseVerdict() in ach-authorization-core.ts.';

-- 0263 employee hold release, verbatim.
create or replace function public.ach_auth_release_hold(
  p_auth_id uuid,
  p_actor   uuid,
  p_method  text,
  p_note    text,
  p_reason  text
) returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  a        public.ach_authorizations%rowtype;
  is_solo  boolean;
  unverified int;
  live     int;
  next_state text;
begin
  if p_actor is null then
    raise exception 'ACH_RELEASE_ACTOR: who released the hold must be recorded.' using errcode = 'check_violation';
  end if;
  select * into a from public.ach_authorizations where id = p_auth_id for update;
  if not found then
    raise exception 'ACH_RELEASE_NOT_FOUND: authorization %.', p_auth_id using errcode = 'check_violation';
  end if;
  if a.payee_type <> 'employee' then
    raise exception 'ACH_RELEASE_PAYEE: vendor holds are released on the banking vault page.' using errcode = 'check_violation';
  end if;
  if a.state <> 'on_hold' then
    raise exception 'ACH_RELEASE_STATE: authorization % is %, not on hold.', a.id, a.state using errcode = 'check_violation';
  end if;
  if p_method is null or p_method not in ('phone', 'in_person') then
    raise exception 'ACH_RELEASE_CALLBACK: record how the employee confirmed (phone or in person).' using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    raise exception 'ACH_RELEASE_CALLBACK: write a callback note of 10+ characters.' using errcode = 'check_violation';
  end if;
  is_solo := a.hold_entered_by is null or a.hold_entered_by = p_actor;
  if is_solo and coalesce(length(trim(p_reason)), 0) < 20 then
    raise exception 'ACH_RELEASE_SOLO: the person who put it on hold (or an unknown author) releasing it is a SOLO release and needs a written reason of 20+ characters.'
      using errcode = 'check_violation';
  end if;
  select count(*) filter (where verification_status <> 'verified'), count(*) into unverified, live
    from public.ach_authorization_accounts where authorization_id = a.id and archived_at is null;
  next_state := case when live > 0 and unverified = 0 then 'active' else 'verifying' end;
  update public.ach_authorizations
     set state = next_state, hold_reason = null, updated_by = p_actor,
         annual_review_due_on = case when next_state = 'active'
                                     then coalesce(a.annual_review_due_on, ((now() at time zone 'America/Los_Angeles')::date + interval '1 year')::date)
                                     else a.annual_review_due_on end
   where id = a.id;
  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, event_kind, actor_id, detail)
  values (a.id, 'employee', a.employee_id, case when is_solo then 'hold_released_solo' else 'hold_released' end, p_actor,
          jsonb_build_object('method', p_method, 'note', left(trim(p_note), 500), 'reason', nullif(left(trim(coalesce(p_reason, '')), 500), ''),
                             'hold_reason', a.hold_reason, 'hold_entered_by', a.hold_entered_by, 'next_state', next_state));
  return case when is_solo then 'solo' else 'dual' end;
end $$;

revoke all on function public.ach_auth_release_hold(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.ach_auth_release_hold(uuid, uuid, text, text, text) to service_role;

-- 0258 drop policies, verbatim (managers may drop again).
drop policy if exists ach_docs_manager_drop on storage.objects;
create policy ach_docs_manager_drop on storage.objects
  for insert with check (bucket_id = 'ach-docs' and public.is_manager());

drop policy if exists ach_documents_manager_drop on public.ach_authorization_documents;
create policy ach_documents_manager_drop on public.ach_authorization_documents
  for insert with check (
    public.is_manager()
    and intake_status = 'received'
    and authorization_id is null
    and archived_at is null
    and uploaded_by = auth.uid()
  );

drop policy if exists ach_events_insert on public.ach_authorization_events;
create policy ach_events_insert on public.ach_authorization_events
  for insert with check (
    public.is_admin()
    or (public.is_manager() and event_kind = 'document_dropped' and actor_id = auth.uid())
  );

-- Helpers last: nothing above depends on them any more.
drop function if exists public.ach_write_by_owner(uuid);
drop function if exists public.ach_actor_is_owner(uuid);

notify pgrst, 'reload schema';
