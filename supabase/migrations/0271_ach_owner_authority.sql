-- =============================================================================
-- Migration 0271 - R41 S0: the owner acts alone; an admin asks the owner
-- =============================================================================
-- Owner request, round 6 (R41-TIMBERLAND-SLICE-PLAN.md v4, decisions D-4..D-9),
-- verbatim:
--
--   "D-6, I trust Stephen, he can make and and approve all actions, it should
--    send me alerts and let me know in the back office to review them and
--    check them off the list."
--
-- and, after the two options were laid out:
--
--   "I think I like option b better now that I think of it. Please build it
--    that way."
--
-- Option B, as built here and in src/lib/auth/ach-authority-core.ts:
--   * The OWNER changes live ACH data alone, at once (a "Was this you?"
--     receipt is emailed; that is a record, not an approval).
--   * An ADMIN's two STOP actions (put vendor banking on hold; log a return
--     or change notice, which puts the payee on hold) take effect at once,
--     and leave an item on the owner's review list to check off.
--   * Every other live ADMIN change becomes a REQUEST that waits for the
--     owner. Nothing live changes until he approves (D-7: requests never
--     expire; a request whose target changed since it was made is refused).
--   * D-5: only owner and admin may drop ACH documents (managers no longer).
--
-- Why the database checks this too (and not only the screens): the ACH stores
-- write with the service-role client, where auth.uid() is empty. So the guard
-- reads the STAMPED actor (released_by, updated_by, verified_by, p_actor, or
-- the new employees.bank_changed_by) and asks staff_profiles whether that
-- person is the active owner. When a real user JWT is present (auth.uid() not
-- null, i.e. someone calling the Data API directly), that user must be the
-- owner as well, so a stale owner stamp cannot be borrowed.
--
-- Sources for the control (mirrored in docs/authorities/ach/):
--   WA State Auditor, "Best Practices for ACH Electronic Payments":
--     "Management should review and approve verification documentation
--      before anyone makes system changes." and "Require approvals or
--      notifications of changes".
--   GAO Green Book (GAO-14-704G) 10.14, segregation of duties.
--
-- What changes on purpose (each older scenario script is updated to match):
--   - 0259 vendor_bank_guard: going ACTIVE needs an owner release
--     (release_mode 'owner', callback method + 10-char note, NO 20-char
--     reason). ARCHIVE and VERIFIED need the owner. Bank changes still land
--     ON HOLD for anyone (e-sign and intake gather evidence; holding is safe).
--   - 0263 ach_auth_release_hold: owner only; returns 'owner' and logs
--     hold_released_owner. The dual / solo split is retired for new releases
--     (old rows keep their recorded mode).
--   - ach_authorizations -> active and ach_authorization_accounts -> verified
--     need an owner actor (0263 ach_verification_finish and 0262
--     vendor_esign_countersign stamp p_actor, so they need the owner).
--   - employees bank columns need a fresh owner stamp (bank_changed_by/at).
--   - ach_company_settings changes need an owner updated_by.
--   - 0258 manager drop policies narrow from is_manager() to is_admin().
--
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule), AFTER 0270.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Who is the owner?
-- -----------------------------------------------------------------------------
create or replace function public.ach_actor_is_owner(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_actor is not null and exists (
    select 1 from public.staff_profiles
     where id = p_actor and active = true and role = 'owner'
  );
$$;

comment on function public.ach_actor_is_owner(uuid) is
  'R41 S0 (0271): true only when the given staff id is the ACTIVE OWNER. Used by the ACH guards, which run under the service role where auth.uid() is empty, so they check the stamped actor instead.';

-- The stamped actor must be the owner, and so must the signed-in user when a
-- real user JWT is present (direct Data API call).
create or replace function public.ach_write_by_owner(p_stamped uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.ach_actor_is_owner(p_stamped)
     and (auth.uid() is null or public.ach_actor_is_owner(auth.uid()));
$$;

comment on function public.ach_write_by_owner(uuid) is
  'R41 S0 (0271): the stamped actor is the active owner AND (no user JWT, or the JWT user is the active owner).';

revoke all on function public.ach_actor_is_owner(uuid) from public, anon;
revoke all on function public.ach_write_by_owner(uuid) from public, anon;
grant execute on function public.ach_actor_is_owner(uuid) to authenticated, service_role;
grant execute on function public.ach_write_by_owner(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Vendor vault: owner releases, archives and verifies
-- -----------------------------------------------------------------------------
alter table public.vendor_bank_details drop constraint if exists vbd_release_mode_shape;
alter table public.vendor_bank_details add constraint vbd_release_mode_shape
  check (release_mode is null or release_mode in ('dual', 'solo', 'owner'));

create or replace function public.vendor_bank_guard()
returns trigger language plpgsql as $$
declare
  bank_changed boolean;
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
  --    Anyone may do this: holding is the safe direction (0259, unchanged).
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

  -- 0271: marking banking verified is a live change, so only the owner.
  if new.verified_at is not null and new.verified_at is distinct from old.verified_at
     and not public.ach_write_by_owner(new.updated_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner marks vendor banking verified. Send it as a request for owner approval.';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;
  -- Unknown status values fall through to vendor_bank_details_status_check.
  if new.status not in ('active', 'on_hold', 'revoked', 'archived') then
    return new;
  end if;

  -- 4. Archived / revoked come back only through on_hold (0259, unchanged).
  if old.status = 'archived' and new.status <> 'on_hold' then
    raise exception 'VAULT_TRANSITION: archived banking can only be re-opened on hold (% -> %).', old.status, new.status;
  end if;
  if old.status = 'revoked' and new.status not in ('on_hold', 'archived') then
    raise exception 'VAULT_TRANSITION: revoked banking can only be re-opened on hold or archived (% -> %).', old.status, new.status;
  end if;

  -- 2. Going active: a fresh, complete release record by the OWNER.
  if new.status = 'active' then
    if new.released_by is null or new.released_at is null
       or (old.released_at is not null and new.released_at <= old.released_at) then
      raise exception 'VAULT_RELEASE: record who released the hold and when.';
    end if;
    if not public.ach_write_by_owner(new.released_by) then
      raise exception 'ACH_OWNER_ONLY: only the owner releases vendor banking. Send it as a request for owner approval.';
    end if;
    if new.release_callback_method is null or coalesce(length(trim(new.release_callback_note)), 0) < 10 then
      raise exception 'VAULT_RELEASE: record how the payee confirmed the details (phone or in person) and a note of 10+ characters.';
    end if;
    if new.release_mode is distinct from 'owner' then
      raise exception 'VAULT_RELEASE: an owner release is recorded with release_mode owner.';
    end if;
  end if;

  if new.status = 'on_hold' and new.hold_reason is not distinct from old.hold_reason then
    raise exception 'VAULT_HOLD: putting banking on hold needs a new reason.';
  end if;

  -- 0271: archiving (the "delete" button) is a live change, so only the owner.
  if new.status = 'archived' then
    if not public.ach_write_by_owner(new.archived_by) then
      raise exception 'ACH_OWNER_ONLY: only the owner archives vendor banking. Send it as a request for owner approval.';
    end if;
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_vendor_bank_guard on public.vendor_bank_details;
create trigger trg_vendor_bank_guard
  before insert or update or delete on public.vendor_bank_details
  for each row execute function public.vendor_bank_guard();

comment on function public.vendor_bank_guard() is
  'R39 0259 + R41 0271: new/changed banking -> on_hold with author (anyone); release -> active only by the OWNER (release_mode owner, callback method + 10-char note); archive and verified only by the owner; no deletes; archived/revoked re-open only on hold.';

-- -----------------------------------------------------------------------------
-- 3. Employee direct deposit (employees bank columns)
-- -----------------------------------------------------------------------------
alter table public.employees add column if not exists bank_changed_by uuid references public.staff_profiles (id) on delete set null;
alter table public.employees add column if not exists bank_changed_at timestamptz;

create or replace function public.employees_bank_owner_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.bank_routing is null and new.bank_account_number is null and new.bank_account_type is null then
      return new;
    end if;
  elsif new.bank_routing is not distinct from old.bank_routing
    and new.bank_account_number is not distinct from old.bank_account_number
    and new.bank_account_type is not distinct from old.bank_account_type then
    return new;
  end if;
  -- A bank change needs a FRESH stamp in this same write, so an old owner
  -- stamp left on the row can never carry a later change through.
  if new.bank_changed_at is null
     or (tg_op = 'UPDATE' and new.bank_changed_at is not distinct from old.bank_changed_at) then
    raise exception 'ACH_OWNER_ONLY: an employee bank change must be stamped with who made it (bank_changed_by, bank_changed_at).';
  end if;
  if not public.ach_write_by_owner(new.bank_changed_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner changes employee direct deposit. Send it as a request for owner approval.';
  end if;
  return new;
end $$;

drop trigger if exists trg_employees_bank_owner_guard on public.employees;
create trigger trg_employees_bank_owner_guard
  before insert or update on public.employees
  for each row execute function public.employees_bank_owner_guard();

comment on function public.employees_bank_owner_guard() is
  'R41 S0 (0271): employees.bank_routing / bank_account_number / bank_account_type change only with a fresh owner stamp (bank_changed_by, bank_changed_at).';

-- -----------------------------------------------------------------------------
-- 4. Company banking settings (the originator block in every ACH file)
-- -----------------------------------------------------------------------------
create or replace function public.ach_company_settings_owner_guard()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then
    return new;
  end if;
  if not public.ach_write_by_owner(new.updated_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner changes the company banking settings. Send it as a request for owner approval.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_company_settings_owner_guard on public.ach_company_settings;
create trigger trg_ach_company_settings_owner_guard
  before update on public.ach_company_settings
  for each row execute function public.ach_company_settings_owner_guard();

-- -----------------------------------------------------------------------------
-- 5. Authorizations go active, accounts go verified: owner only
-- -----------------------------------------------------------------------------
create or replace function public.ach_auth_owner_guard()
returns trigger language plpgsql as $$
begin
  if new.state = 'active'
     and (tg_op = 'INSERT' or old.state is distinct from 'active')
     and not public.ach_write_by_owner(coalesce(new.updated_by, case when tg_op = 'INSERT' then new.created_by end)) then
    raise exception 'ACH_OWNER_ONLY: only the owner makes an ACH authorization active. Send it as a request for owner approval.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_auth_owner_guard on public.ach_authorizations;
create trigger trg_ach_auth_owner_guard
  before insert or update on public.ach_authorizations
  for each row execute function public.ach_auth_owner_guard();

create or replace function public.ach_acct_owner_guard()
returns trigger language plpgsql as $$
begin
  if new.verification_status = 'verified'
     and (tg_op = 'INSERT' or old.verification_status is distinct from 'verified')
     and not public.ach_write_by_owner(new.verified_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner marks an ACH account verified. Send it as a request for owner approval.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_acct_owner_guard on public.ach_authorization_accounts;
create trigger trg_ach_acct_owner_guard
  before insert or update on public.ach_authorization_accounts
  for each row execute function public.ach_acct_owner_guard();

-- -----------------------------------------------------------------------------
-- 6. Employee hold release: owner only (replaces the 0263 dual / solo split)
-- -----------------------------------------------------------------------------
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
  a          public.ach_authorizations%rowtype;
  unverified int;
  live       int;
  next_state text;
begin
  if p_actor is null then
    raise exception 'ACH_RELEASE_ACTOR: who released the hold must be recorded.' using errcode = 'check_violation';
  end if;
  if not public.ach_write_by_owner(p_actor) then
    raise exception 'ACH_OWNER_ONLY: only the owner releases an employee banking hold. Send it as a request for owner approval.'
      using errcode = 'check_violation';
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
  values (a.id, 'employee', a.employee_id, 'hold_released_owner', p_actor,
          jsonb_build_object('method', p_method, 'note', left(trim(p_note), 500), 'reason', nullif(left(trim(coalesce(p_reason, '')), 500), ''),
                             'hold_reason', a.hold_reason, 'hold_entered_by', a.hold_entered_by, 'next_state', next_state));
  return 'owner';
end $$;

revoke all on function public.ach_auth_release_hold(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.ach_auth_release_hold(uuid, uuid, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 7. D-5: managers no longer drop ACH documents (0258 policies, same names)
-- -----------------------------------------------------------------------------
drop policy if exists ach_docs_manager_drop on storage.objects;
create policy ach_docs_manager_drop on storage.objects
  for insert with check (bucket_id = 'ach-docs' and public.is_admin());

drop policy if exists ach_documents_manager_drop on public.ach_authorization_documents;
create policy ach_documents_manager_drop on public.ach_authorization_documents
  for insert with check (
    public.is_admin()
    and intake_status = 'received'
    and authorization_id is null
    and archived_at is null
    and uploaded_by = auth.uid()
  );

drop policy if exists ach_events_insert on public.ach_authorization_events;
create policy ach_events_insert on public.ach_authorization_events
  for insert with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 8. Requests that wait for the owner
-- -----------------------------------------------------------------------------
create table if not exists public.ach_change_requests (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind ~ '^[a-z_]{3,40}\.[a-z_]{3,40}$'),
  target_type     text not null check (target_type in ('vendor', 'employee', 'authorization', 'account', 'verification',
                                                       'notice', 'document', 'contact', 'invite', 'payroll_run',
                                                       'company', 'vendor_payment')),
  target_id       text,
  target_label    text not null default '' check (length(target_label) <= 200),
  -- Fingerprint of the target when the request was made. Approval is refused
  -- if the target has changed since (D-7: stale requests are refused). Null
  -- only when there is nothing to compare (for example a brand-new record).
  base_version    text check (base_version is null or length(base_version) between 1 and 200),
  -- The submitted form fields. Bank numbers and other secrets are inside
  -- payload_enc (encv1 envelope, same key as the vault); summary carries
  -- only masked values (last 4) for the owner's screen and email.
  payload_enc     text not null check (length(payload_enc) between 2 and 200000),
  summary         jsonb not null default '[]'::jsonb check (jsonb_typeof(summary) = 'array'),
  reason          text check (reason is null or length(reason) <= 1000),
  requested_by    uuid not null references public.staff_profiles (id) on delete restrict,
  requested_at    timestamptz not null default now(),
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'superseded')),
  decided_by      uuid references public.staff_profiles (id) on delete restrict,
  decided_at      timestamptz,
  decision_note   text check (decision_note is null or length(decision_note) <= 1000),
  applied_at      timestamptz,
  applied_ref     text check (applied_ref is null or length(applied_ref) <= 500),
  apply_error     text check (apply_error is null or length(apply_error) <= 1000),
  last_reminded_on date,
  constraint acr_decided_shape check ((status = 'pending') = (decided_at is null and decided_by is null)),
  constraint acr_applied_only_if_approved check ((applied_at is null and apply_error is null) or status = 'approved')
);

create index if not exists acr_pending_idx on public.ach_change_requests (requested_at) where status = 'pending';
create index if not exists acr_target_idx on public.ach_change_requests (target_type, target_id, status);

create table if not exists public.ach_change_request_events (
  id          bigserial primary key,
  request_id  uuid not null references public.ach_change_requests (id) on delete restrict,
  event_kind  text not null check (event_kind ~ '^[a-z][a-z_]{2,40}$'),
  actor_id    uuid references public.staff_profiles (id) on delete set null,
  detail      jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists acre_request_idx on public.ach_change_request_events (request_id, occurred_at);

create or replace function public.ach_change_request_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'ACH_REQUEST_EVENTS_APPEND_ONLY: ach_change_request_events cannot be changed or deleted.';
end $$;

drop trigger if exists trg_ach_change_request_events_append_only on public.ach_change_request_events;
create trigger trg_ach_change_request_events_append_only
  before update or delete on public.ach_change_request_events
  for each row execute function public.ach_change_request_events_append_only();

-- Requests are records: never deleted, the facts never change, the status only
-- moves forward once, and the apply result is written once.
create or replace function public.ach_change_requests_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ACH_REQUEST_KEEP: request % is a record and is never deleted.', old.id;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'ACH_REQUEST_TRANSITION: a new request starts pending.';
    end if;
    return new;
  end if;
  if new.kind is distinct from old.kind or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id or new.target_label is distinct from old.target_label
     or new.base_version is distinct from old.base_version or new.payload_enc is distinct from old.payload_enc
     or new.summary is distinct from old.summary or new.reason is distinct from old.reason
     or new.requested_by is distinct from old.requested_by or new.requested_at is distinct from old.requested_at then
    raise exception 'ACH_REQUEST_IMMUTABLE: what was asked for in request % cannot change.', old.id;
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'ACH_REQUEST_FINAL: request % is % and cannot change.', old.id, old.status;
    end if;
    if new.status = 'withdrawn' then
      if new.decided_by is distinct from old.requested_by then
        raise exception 'ACH_REQUEST_WITHDRAW: only the person who asked can withdraw request %.', old.id;
      end if;
    elsif not public.ach_write_by_owner(new.decided_by) then
      raise exception 'ACH_OWNER_ONLY: only the owner approves, rejects or supersedes request %.', old.id;
    end if;
  elsif old.status <> 'pending' and (new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
                                     or new.decision_note is distinct from old.decision_note) then
    raise exception 'ACH_REQUEST_FINAL: the decision on request % cannot change.', old.id;
  end if;
  if (old.applied_at is not null or old.apply_error is not null)
     and (new.applied_at is distinct from old.applied_at or new.applied_ref is distinct from old.applied_ref
          or new.apply_error is distinct from old.apply_error) then
    raise exception 'ACH_REQUEST_FINAL: the result of request % is already recorded.', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_change_requests_guard on public.ach_change_requests;
create trigger trg_ach_change_requests_guard
  before insert or update or delete on public.ach_change_requests
  for each row execute function public.ach_change_requests_guard();

-- Decide a request. p_current_version is the target's fingerprint NOW, worked
-- out by the server the same way base_version was; approval is refused if
-- they differ. Returns the new status.
create or replace function public.ach_request_decide(
  p_request_id      uuid,
  p_actor           uuid,
  p_decision        text,
  p_note            text,
  p_current_version text
) returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r public.ach_change_requests%rowtype;
begin
  if p_actor is null then
    raise exception 'ACH_REQUEST_ACTOR: who decided must be recorded.' using errcode = 'check_violation';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected', 'withdrawn', 'superseded') then
    raise exception 'ACH_REQUEST_DECISION: approved, rejected, withdrawn or superseded.' using errcode = 'check_violation';
  end if;
  select * into r from public.ach_change_requests where id = p_request_id for update;
  if not found then
    raise exception 'ACH_REQUEST_NOT_FOUND: request %.', p_request_id using errcode = 'check_violation';
  end if;
  if r.status <> 'pending' then
    raise exception 'ACH_REQUEST_FINAL: request % is already %.', r.id, r.status using errcode = 'check_violation';
  end if;
  if p_decision = 'withdrawn' then
    if p_actor is distinct from r.requested_by then
      raise exception 'ACH_REQUEST_WITHDRAW: only the person who asked can withdraw it.' using errcode = 'check_violation';
    end if;
  elsif not public.ach_write_by_owner(p_actor) then
    raise exception 'ACH_OWNER_ONLY: only the owner approves, rejects or supersedes a request.' using errcode = 'check_violation';
  end if;
  if p_decision = 'approved' and r.base_version is not null and r.base_version is distinct from p_current_version then
    raise exception 'ACH_REQUEST_STALE: the record changed after this request was made. Reject it and ask for a fresh one.'
      using errcode = 'check_violation';
  end if;
  update public.ach_change_requests
     set status = p_decision, decided_by = p_actor, decided_at = now(),
         decision_note = nullif(left(trim(coalesce(p_note, '')), 1000), '')
   where id = r.id;
  insert into public.ach_change_request_events (request_id, event_kind, actor_id, detail)
  values (r.id, p_decision, p_actor,
          jsonb_build_object('kind', r.kind, 'target_type', r.target_type, 'target_id', r.target_id,
                             'note', nullif(left(trim(coalesce(p_note, '')), 500), '')));
  return p_decision;
end $$;

-- After an approved request is carried out (as the owner), record the result
-- once: either a reference to what changed or the error that stopped it.
create or replace function public.ach_request_record_result(
  p_request_id uuid,
  p_actor      uuid,
  p_ref        text,
  p_error      text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r public.ach_change_requests%rowtype;
begin
  if not public.ach_write_by_owner(p_actor) then
    raise exception 'ACH_OWNER_ONLY: only the owner records the result of a request.' using errcode = 'check_violation';
  end if;
  if (p_ref is null) = (p_error is null) then
    raise exception 'ACH_REQUEST_RESULT: give either what changed or the error, not both.' using errcode = 'check_violation';
  end if;
  select * into r from public.ach_change_requests where id = p_request_id for update;
  if not found then
    raise exception 'ACH_REQUEST_NOT_FOUND: request %.', p_request_id using errcode = 'check_violation';
  end if;
  if r.status <> 'approved' or r.decided_by is distinct from p_actor then
    raise exception 'ACH_REQUEST_RESULT: request % was not approved by this owner.', r.id using errcode = 'check_violation';
  end if;
  update public.ach_change_requests
     set applied_at = case when p_ref is not null then now() end,
         applied_ref = left(p_ref, 500),
         apply_error = left(p_error, 1000)
   where id = r.id;
  insert into public.ach_change_request_events (request_id, event_kind, actor_id, detail)
  values (r.id, case when p_ref is not null then 'applied' else 'apply_failed' end, p_actor,
          jsonb_build_object('ref', left(p_ref, 500), 'error', left(p_error, 500)));
end $$;

-- -----------------------------------------------------------------------------
-- 9. Owner review list (admin STOP actions, checked off by the owner)
-- -----------------------------------------------------------------------------
create table if not exists public.ach_owner_reviews (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind ~ '^[a-z_]{3,40}\.[a-z_]{3,40}$'),
  target_label    text not null default '' check (length(target_label) <= 200),
  summary         jsonb not null default '[]'::jsonb check (jsonb_typeof(summary) = 'array'),
  outcome         text not null default '' check (length(outcome) <= 1000),
  done_by         uuid not null references public.staff_profiles (id) on delete restrict,
  done_at         timestamptz not null default now(),
  checked_off_by  uuid references public.staff_profiles (id) on delete restrict,
  checked_off_at  timestamptz,
  check_note      text check (check_note is null or length(check_note) <= 1000),
  constraint aor_checked_shape check ((checked_off_at is null) = (checked_off_by is null))
);
create index if not exists aor_open_idx on public.ach_owner_reviews (done_at) where checked_off_at is null;

create or replace function public.ach_owner_reviews_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ACH_REVIEW_KEEP: review item % is a record and is never deleted.', old.id;
  end if;
  if tg_op = 'INSERT' then
    if new.checked_off_at is not null then
      raise exception 'ACH_REVIEW_FINAL: a new review item starts unchecked.';
    end if;
    return new;
  end if;
  if new.kind is distinct from old.kind or new.target_label is distinct from old.target_label
     or new.summary is distinct from old.summary or new.outcome is distinct from old.outcome
     or new.done_by is distinct from old.done_by or new.done_at is distinct from old.done_at then
    raise exception 'ACH_REVIEW_IMMUTABLE: what was done in review item % cannot change.', old.id;
  end if;
  if old.checked_off_at is not null then
    raise exception 'ACH_REVIEW_FINAL: review item % is already checked off.', old.id;
  end if;
  if new.checked_off_at is not null and not public.ach_write_by_owner(new.checked_off_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner checks off a review item.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_owner_reviews_guard on public.ach_owner_reviews;
create trigger trg_ach_owner_reviews_guard
  before insert or update or delete on public.ach_owner_reviews
  for each row execute function public.ach_owner_reviews_guard();

-- -----------------------------------------------------------------------------
-- 10. RLS and grants: the server (service_role) only
-- -----------------------------------------------------------------------------
alter table public.ach_change_requests       enable row level security;
alter table public.ach_change_request_events enable row level security;
alter table public.ach_owner_reviews         enable row level security;

revoke all on table public.ach_change_requests, public.ach_change_request_events, public.ach_owner_reviews from anon, authenticated;
revoke delete on table public.ach_change_requests, public.ach_change_request_events, public.ach_owner_reviews from service_role;
grant select, insert, update on table public.ach_change_requests, public.ach_change_request_events, public.ach_owner_reviews to service_role;
revoke all on sequence public.ach_change_request_events_id_seq from anon, authenticated;
grant usage, select on sequence public.ach_change_request_events_id_seq to service_role;

revoke all on function public.ach_request_decide(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.ach_request_record_result(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.ach_request_decide(uuid, uuid, text, text, text) to service_role;
grant execute on function public.ach_request_record_result(uuid, uuid, text, text) to service_role;

comment on table public.ach_change_requests is
  'R41 S0 (0271): an admin''s live ACH change waiting for the owner. Never deleted; facts immutable; pending -> approved | rejected | withdrawn | superseded once. Secrets only inside payload_enc (encv1).';
comment on table public.ach_change_request_events is 'R41 S0 (0271): append-only log of request decisions and results.';
comment on table public.ach_owner_reviews is
  'R41 S0 (0271): admin STOP actions (hold, return/change notice) that took effect at once; the owner checks each off.';

notify pgrst, 'reload schema';
