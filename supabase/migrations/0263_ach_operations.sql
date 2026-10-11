-- =============================================================================
-- Migration 0263 - R39 S7: ACH operations (returns / NOC log, verification,
-- employee hold release, legal hold, annual review)
-- =============================================================================
-- Owner answers (docs/roadmap/R39-ACH-INTEGRATION.md): Q3 verify by prenote or
-- a test credit; Q7 archive, never delete; Q8 retention + legal hold; Q9 tell
-- Stephen, Michael or the store; Q13 90-day look-back for callbacks.
--
-- 0258 created the tables. This adds what is needed to USE them safely. Every
-- function below writes the append-only event log (ach_authorization_events)
-- together with the change it records, in ONE transaction, so a half-done
-- step can never leave an event that did not happen (or a change with no
-- event).
--
--   ach_notice_log            Timberland sent a return (R..) or a change
--                             notice (C..). The notice is filed against the
--                             payee, and the money stops: vendor vault banking
--                             goes ON HOLD (0259), an employee's open
--                             authorization goes ON HOLD. If the notice is the
--                             answer to a prenote or test credit, that check
--                             FAILS. A notice is never edited or deleted.
--   ach_notice_resolve        Says what was done (10+ characters). Final.
--   ach_auth_release_hold     Employee hold release: a callback (phone or in
--                             person) with a note, and the same two-person
--                             rule as the vendor vault (0259): the person who
--                             caused the hold releasing it is SOLO and needs a
--                             written reason of 20+ characters.
--   ach_verification_start    Plan a prenote ($0, codes 23/33) or a test
--                             credit (1-99 cents, ACCTVERIFY), or record a
--                             callback. One open check per account.
--   ach_verification_mark_sent  The prenote / test-credit file was sent to
--                             Timberland: records dates and the first day a
--                             live payment is allowed (3 banking days after
--                             settlement for a prenote; computed by the app's
--                             FedACH calendar and checked here to be later).
--   ach_verification_finish   Passed or failed. A prenote may pass only on or
--                             after its eligible day with no open notice; a
--                             test credit only when the payee read back the
--                             exact cents. When every live account is
--                             verified the authorization becomes ACTIVE and
--                             gets its annual review date.
--   ach_auth_set_legal_hold   Put on / take off a legal hold, with a reason.
--   ach_auth_review_done      The annual review was done: next one in a year.
--
-- Vendors: vault banking (0143/0259) is what pays a vendor, so a vendor notice
-- holds the VAULT, and release stays on the vault page (callback, dual/solo).
--
-- New columns are nullable / defaulted; nothing is backfilled. Functions pin
-- search_path, are NOT security definer, and only service_role may run them.
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule), AFTER 0258, 0259, 0260, 0261 and 0262.
-- Rollback: supabase/rollbacks/0263_ach_operations.rollback.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.ach_return_notices add column if not exists payee_type text;
alter table public.ach_return_notices add column if not exists employee_id uuid references public.employees (id) on delete restrict;
alter table public.ach_return_notices add column if not exists vendor_id uuid references public.vendors (id) on delete restrict;
alter table public.ach_return_notices add column if not exists verification_id uuid references public.ach_verifications (id) on delete restrict;
alter table public.ach_return_notices add column if not exists corrected_last4 text;
alter table public.ach_return_notices add column if not exists hold_applied text;

alter table public.ach_return_notices drop constraint if exists ach_notice_payee_shape;
alter table public.ach_return_notices add constraint ach_notice_payee_shape check (
  payee_type is null
  or (payee_type = 'employee' and employee_id is not null and vendor_id is null)
  or (payee_type = 'vendor' and vendor_id is not null and employee_id is null)
);
alter table public.ach_return_notices drop constraint if exists ach_notice_corrected_shape;
alter table public.ach_return_notices add constraint ach_notice_corrected_shape check (
  (corrected_data_enc is null or notice_kind = 'noc')
  and (corrected_last4 is null or corrected_last4 ~ '^[0-9]{1,4}$')
);
alter table public.ach_return_notices drop constraint if exists ach_notice_hold_applied_shape;
alter table public.ach_return_notices add constraint ach_notice_hold_applied_shape check (
  hold_applied is null or hold_applied in ('vault', 'authorization', 'already_on_hold', 'none')
);
alter table public.ach_return_notices drop constraint if exists ach_notice_note_shape;
alter table public.ach_return_notices add constraint ach_notice_note_shape check (
  resolution_note is null or length(trim(resolution_note)) >= 10
);
create index if not exists ach_notice_payee_idx on public.ach_return_notices (payee_type, employee_id, vendor_id);

alter table public.ach_authorizations add column if not exists hold_entered_by uuid references public.staff_profiles (id) on delete set null;
alter table public.ach_authorizations add column if not exists hold_entered_at timestamptz;
create index if not exists ach_auth_review_due_idx on public.ach_authorizations (annual_review_due_on)
  where state = 'active';

-- One open check (planned or sent) per account.
create unique index if not exists ach_ver_one_open_per_account
  on public.ach_verifications (account_id) where status in ('planned', 'sent');
alter table public.ach_verifications drop constraint if exists ach_ver_sent_shape;
alter table public.ach_verifications add constraint ach_ver_sent_shape check (
  status not in ('sent') or method = 'voided_check_callback'
  or (effective_date is not null and settlement_date is not null and eligible_on is not null
      and settlement_date >= effective_date and eligible_on > settlement_date)
);
alter table public.ach_verifications drop constraint if exists ach_ver_note_shape;
alter table public.ach_verifications add constraint ach_ver_note_shape check (
  status not in ('failed', 'cancelled') or length(trim(coalesce(note, ''))) >= 5
);

-- -----------------------------------------------------------------------------
-- 2. Guards: a notice and a verification are records. Never deleted; the facts
--    never change; only the resolution / the next status may be added.
-- -----------------------------------------------------------------------------
create or replace function public.ach_notice_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ACH_NOTICE_KEEP: return / NOC notice % is a payment record and is never deleted.', old.id;
  end if;
  if old.resolved_at is not null then
    raise exception 'ACH_NOTICE_FINAL: notice % is resolved and cannot change.', old.id;
  end if;
  if new.notice_kind is distinct from old.notice_kind or new.code is distinct from old.code
     or new.received_on is distinct from old.received_on or new.entry_settlement_date is distinct from old.entry_settlement_date
     or new.amount_cents is distinct from old.amount_cents or new.trace_number is distinct from old.trace_number
     or new.corrected_data_enc is distinct from old.corrected_data_enc or new.corrected_last4 is distinct from old.corrected_last4
     or new.apply_by is distinct from old.apply_by or new.payee_type is distinct from old.payee_type
     or new.employee_id is distinct from old.employee_id or new.vendor_id is distinct from old.vendor_id
     or new.authorization_id is distinct from old.authorization_id or new.account_id is distinct from old.account_id
     or new.verification_id is distinct from old.verification_id or new.hold_applied is distinct from old.hold_applied
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'ACH_NOTICE_IMMUTABLE: the facts of notice % cannot change. Resolve it with a note instead.', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_notice_guard on public.ach_return_notices;
create trigger trg_ach_notice_guard
  before update or delete on public.ach_return_notices
  for each row execute function public.ach_notice_guard();

create or replace function public.ach_verification_guard()
returns trigger language plpgsql as $$
declare
  allowed text[];
begin
  if tg_op = 'DELETE' then
    raise exception 'ACH_VERIFICATION_KEEP: verification % is evidence the account was checked and is never deleted.', old.id;
  end if;
  if new.account_id is distinct from old.account_id or new.method is distinct from old.method
     or new.micro_amount_cents is distinct from old.micro_amount_cents or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'ACH_VERIFICATION_IMMUTABLE: verification % keeps its account, method and amount.', old.id;
  end if;
  if old.status in ('passed', 'failed', 'cancelled') then
    raise exception 'ACH_VERIFICATION_FINAL: verification % is % and cannot change.', old.id, old.status;
  end if;
  if new.status is distinct from old.status then
    allowed := case old.status
      when 'planned' then case when old.method = 'voided_check_callback'
                               then array['passed', 'failed', 'cancelled']
                               else array['sent', 'cancelled'] end
      when 'sent'    then array['passed', 'failed', 'cancelled']
      else array[]::text[]
    end;
    if not (new.status = any (allowed)) then
      raise exception 'ACH_VERIFICATION_TRANSITION: % -> % is not allowed for a %.', old.status, new.status, old.method;
    end if;
  elsif old.status = 'sent' and (new.effective_date is distinct from old.effective_date
        or new.settlement_date is distinct from old.settlement_date or new.eligible_on is distinct from old.eligible_on) then
    raise exception 'ACH_VERIFICATION_IMMUTABLE: the sent dates of verification % cannot change.', old.id;
  end if;
  if new.status = 'passed' and new.method = 'micro_entry'
     and new.payee_confirmed_cents is distinct from new.micro_amount_cents then
    raise exception 'ACH_VERIFICATION_AMOUNT: the payee must read back the exact test amount.';
  end if;
  if new.status = 'passed' and new.method = 'prenote'
     and (new.eligible_on is null or new.eligible_on > (now() at time zone 'America/Los_Angeles')::date) then
    raise exception 'ACH_VERIFICATION_EARLY: a prenote passes only on or after its eligible day (%).', coalesce(new.eligible_on::text, 'not sent');
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_verification_guard on public.ach_verifications;
create trigger trg_ach_verification_guard
  before update or delete on public.ach_verifications
  for each row execute function public.ach_verification_guard();

-- -----------------------------------------------------------------------------
-- 3. ach_notice_log
-- -----------------------------------------------------------------------------
create or replace function public.ach_notice_log(
  p_actor           uuid,
  p_payee_type      text,
  p_payee_id        uuid,
  p_code            text,
  p_received_on     date,
  p_settlement_date date,
  p_amount_cents    bigint,
  p_trace           text,
  p_corrected_enc   text,
  p_corrected_last4 text,
  p_apply_by        date,
  p_hold_reason     text,
  p_verification_id uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  kind     text;
  a        public.ach_authorizations%rowtype;
  vb       public.vendor_bank_details%rowtype;
  v        public.ach_verifications%rowtype;
  acct     public.ach_authorization_accounts%rowtype;
  held     text := 'none';
  nid      uuid;
  today    date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if p_actor is null then
    raise exception 'ACH_NOTICE_ACTOR: who logged the notice must be recorded.' using errcode = 'check_violation';
  end if;
  if p_payee_type is null or p_payee_type not in ('employee', 'vendor') or p_payee_id is null then
    raise exception 'ACH_NOTICE_PAYEE: pick the employee or vendor the payment was for.' using errcode = 'check_violation';
  end if;
  if p_code is null or p_code !~ '^[RC][0-9]{2}$' then
    raise exception 'ACH_NOTICE_CODE: the code is R or C and two digits.' using errcode = 'check_violation';
  end if;
  kind := case when left(p_code, 1) = 'C' then 'noc' else 'return' end;
  if p_received_on is null or p_received_on > today or p_received_on < today - 400 then
    raise exception 'ACH_NOTICE_DATE: the notice date must be within the last 400 days and not in the future.' using errcode = 'check_violation';
  end if;
  if p_settlement_date is not null and p_settlement_date > p_received_on then
    raise exception 'ACH_NOTICE_DATE: the payment settled before the notice came, not after.' using errcode = 'check_violation';
  end if;
  if kind = 'noc' and (p_corrected_enc is null or p_apply_by is null or p_apply_by < p_received_on) then
    raise exception 'ACH_NOTICE_NOC: a change notice needs the corrected information (encrypted) and an apply-by date.' using errcode = 'check_violation';
  end if;
  if kind = 'return' and (p_corrected_enc is not null or p_apply_by is not null) then
    raise exception 'ACH_NOTICE_NOC: a return has no corrected information or apply-by date.' using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_hold_reason)), 0) < 10 then
    raise exception 'ACH_NOTICE_REASON: the hold reason must say what came back (10+ characters).' using errcode = 'check_violation';
  end if;

  if p_payee_type = 'employee' then
    perform 1 from public.employees where id = p_payee_id;
    if not found then
      raise exception 'ACH_NOTICE_PAYEE: employee % not found.', p_payee_id using errcode = 'check_violation';
    end if;
    select * into a from public.ach_authorizations
     where payee_type = 'employee' and employee_id = p_payee_id and state not in ('revoked', 'archived')
     for update;
    if found then
      if a.state = 'on_hold' then
        held := 'already_on_hold';
      elsif a.state in ('signed', 'verifying', 'active') then
        update public.ach_authorizations
           set state = 'on_hold', hold_reason = left(trim(p_hold_reason), 500),
               hold_entered_by = p_actor, hold_entered_at = now(), updated_by = p_actor
         where id = a.id;
        held := 'authorization';
      end if;
    end if;
  else
    perform 1 from public.vendors where id = p_payee_id;
    if not found then
      raise exception 'ACH_NOTICE_PAYEE: vendor % not found.', p_payee_id using errcode = 'check_violation';
    end if;
    select * into vb from public.vendor_bank_details where vendor_id = p_payee_id for update;
    if found then
      if vb.status = 'on_hold' then
        held := 'already_on_hold';
      elsif vb.status = 'active' then
        update public.vendor_bank_details
           set status = 'on_hold',
               -- 0259 needs a NEW reason to go on hold; the same words again get the time added.
               hold_reason = case when left(trim(p_hold_reason), 500) is distinct from vb.hold_reason
                                  then left(trim(p_hold_reason), 500)
                                  else left(trim(p_hold_reason), 470) || to_char(now() at time zone 'America/Los_Angeles', ' (YYYY-MM-DD HH24:MI:SS)') end,
               updated_by = p_actor
         where id = vb.id;
        held := 'vault';
      end if;
    end if;
    select * into a from public.ach_authorizations
     where payee_type = 'vendor' and vendor_id = p_payee_id and state not in ('revoked', 'archived');
  end if;

  -- The answer to a prenote or test credit: that check fails.
  if p_verification_id is not null then
    select * into v from public.ach_verifications where id = p_verification_id for update;
    if not found then
      raise exception 'ACH_NOTICE_VERIFICATION: verification % not found.', p_verification_id using errcode = 'check_violation';
    end if;
    select * into acct from public.ach_authorization_accounts where id = v.account_id;
    if p_payee_type <> 'employee' or a.id is null or acct.authorization_id is distinct from a.id then
      raise exception 'ACH_NOTICE_VERIFICATION: that verification belongs to a different payee.' using errcode = 'check_violation';
    end if;
    if v.status <> 'sent' then
      raise exception 'ACH_NOTICE_VERIFICATION: verification % is %, not waiting for an answer.', v.id, v.status using errcode = 'check_violation';
    end if;
    update public.ach_verifications
       set status = 'failed', result_code = p_code,
           note = left(format('Bank answered %s on %s.', p_code, p_received_on), 500)
     where id = v.id;
    update public.ach_authorization_accounts
       set verification_status = 'failed', verification_method = null, verified_at = null, verified_by = null
     where id = acct.id and archived_at is null;
  end if;

  insert into public.ach_return_notices
    (authorization_id, account_id, notice_kind, code, received_on, entry_settlement_date, amount_cents, trace_number,
     corrected_data_enc, corrected_last4, apply_by, payee_type, employee_id, vendor_id, verification_id, hold_applied, created_by)
  values
    (a.id, acct.id, kind, p_code, p_received_on, p_settlement_date, p_amount_cents, nullif(p_trace, ''),
     p_corrected_enc, p_corrected_last4, p_apply_by, p_payee_type,
     case when p_payee_type = 'employee' then p_payee_id end,
     case when p_payee_type = 'vendor' then p_payee_id end,
     p_verification_id, held, p_actor)
  returning id into nid;

  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, vendor_id, event_kind, actor_id, detail)
  values (a.id, p_payee_type,
          case when p_payee_type = 'employee' then p_payee_id end,
          case when p_payee_type = 'vendor' then p_payee_id end,
          case when kind = 'noc' then 'noc_logged' else 'return_logged' end, p_actor,
          jsonb_build_object('notice_id', nid, 'code', p_code, 'received_on', p_received_on, 'hold', held,
                             'apply_by', p_apply_by, 'verification_id', p_verification_id,
                             'corrected_last4', p_corrected_last4));

  return jsonb_build_object('notice_id', nid, 'hold', held, 'authorization_id', a.id);
end $$;

-- -----------------------------------------------------------------------------
-- 4. ach_notice_resolve
-- -----------------------------------------------------------------------------
create or replace function public.ach_notice_resolve(p_notice_id uuid, p_actor uuid, p_note text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  n public.ach_return_notices%rowtype;
begin
  if p_actor is null then
    raise exception 'ACH_NOTICE_ACTOR: who resolved the notice must be recorded.' using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    raise exception 'ACH_NOTICE_REASON: say what was done (10+ characters).' using errcode = 'check_violation';
  end if;
  select * into n from public.ach_return_notices where id = p_notice_id for update;
  if not found then
    raise exception 'ACH_NOTICE_NOT_FOUND: notice %.', p_notice_id using errcode = 'check_violation';
  end if;
  if n.resolved_at is not null then
    raise exception 'ACH_NOTICE_FINAL: notice % is already resolved.', n.id using errcode = 'check_violation';
  end if;
  if n.payee_type is null then
    raise exception 'ACH_NOTICE_PAYEE: notice % has no payee; it was not logged through ach_notice_log.', n.id using errcode = 'check_violation';
  end if;
  update public.ach_return_notices
     set resolved_at = now(), resolved_by = p_actor, resolution_note = left(trim(p_note), 500)
   where id = n.id;
  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, vendor_id, event_kind, actor_id, detail)
  values (n.authorization_id, n.payee_type, n.employee_id, n.vendor_id, 'notice_resolved', p_actor,
          jsonb_build_object('notice_id', n.id, 'code', n.code, 'note', left(trim(p_note), 500)));
end $$;

-- -----------------------------------------------------------------------------
-- 5. ach_auth_release_hold (employees; vendors release on the vault)
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

-- -----------------------------------------------------------------------------
-- 6. Verification
-- -----------------------------------------------------------------------------
create or replace function public.ach_verification_start(
  p_account_id  uuid,
  p_actor       uuid,
  p_method      text,
  p_micro_cents integer
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  acct public.ach_authorization_accounts%rowtype;
  a    public.ach_authorizations%rowtype;
  vid  uuid;
begin
  if p_actor is null then
    raise exception 'ACH_VERIFICATION_ACTOR: who started the check must be recorded.' using errcode = 'check_violation';
  end if;
  if p_method is null or p_method not in ('prenote', 'micro_entry', 'voided_check_callback') then
    raise exception 'ACH_VERIFICATION_METHOD: prenote, micro_entry or voided_check_callback.' using errcode = 'check_violation';
  end if;
  select * into acct from public.ach_authorization_accounts where id = p_account_id for update;
  if not found or acct.archived_at is not null then
    raise exception 'ACH_VERIFICATION_ACCOUNT: account % is not a live account.', p_account_id using errcode = 'check_violation';
  end if;
  if acct.verification_status = 'verified' then
    raise exception 'ACH_VERIFICATION_ACCOUNT: account % is already verified.', acct.id using errcode = 'check_violation';
  end if;
  select * into a from public.ach_authorizations where id = acct.authorization_id for update;
  if a.state not in ('signed', 'verifying') then
    raise exception 'ACH_VERIFICATION_STATE: the authorization is %; only a signed or verifying authorization is checked (release a hold first).', a.state
      using errcode = 'check_violation';
  end if;
  insert into public.ach_verifications (account_id, method, micro_amount_cents, created_by)
  values (acct.id, p_method, case when p_method = 'micro_entry' then p_micro_cents end, p_actor)
  returning id into vid;
  update public.ach_authorization_accounts set verification_status = 'pending' where id = acct.id;
  if a.state = 'signed' then
    update public.ach_authorizations set state = 'verifying', updated_by = p_actor where id = a.id;
  end if;
  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, vendor_id, event_kind, actor_id, detail)
  values (a.id, a.payee_type, a.employee_id, a.vendor_id, 'verification_started', p_actor,
          jsonb_build_object('verification_id', vid, 'account_id', acct.id, 'method', p_method, 'account_last4', acct.account_last4));
  return vid;
end $$;

create or replace function public.ach_verification_mark_sent(
  p_ids        uuid[],
  p_actor      uuid,
  p_effective  date,
  p_settlement date,
  p_eligible   date,
  p_filename   text
) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v    public.ach_verifications%rowtype;
  a    public.ach_authorizations%rowtype;
  n    int := 0;
begin
  if p_actor is null then
    raise exception 'ACH_VERIFICATION_ACTOR: who sent the file must be recorded.' using errcode = 'check_violation';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'ACH_VERIFICATION_EMPTY: no checks to mark as sent.' using errcode = 'check_violation';
  end if;
  if p_effective is null or p_settlement is null or p_eligible is null
     or p_settlement < p_effective or p_eligible <= p_settlement then
    raise exception 'ACH_VERIFICATION_DATES: give the effective date, the settlement date (same day or later) and the first live day (after settlement).'
      using errcode = 'check_violation';
  end if;
  for v in select * from public.ach_verifications where id = any (p_ids) order by id for update loop
    if v.status <> 'planned' or v.method = 'voided_check_callback' then
      raise exception 'ACH_VERIFICATION_STATE: verification % is a % that is %, not a planned file entry.', v.id, v.method, v.status
        using errcode = 'check_violation';
    end if;
    update public.ach_verifications
       set status = 'sent', effective_date = p_effective, settlement_date = p_settlement,
           eligible_on = case when v.method = 'prenote' then p_eligible else p_settlement + 1 end
     where id = v.id;
    select a2.* into a from public.ach_authorizations a2
      join public.ach_authorization_accounts c on c.authorization_id = a2.id where c.id = v.account_id;
    insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, vendor_id, event_kind, actor_id, detail)
    values (a.id, a.payee_type, a.employee_id, a.vendor_id, 'verification_sent', p_actor,
            jsonb_build_object('verification_id', v.id, 'method', v.method, 'effective_date', p_effective,
                               'settlement_date', p_settlement,
                               'eligible_on', case when v.method = 'prenote' then p_eligible else p_settlement + 1 end, 'file', left(coalesce(p_filename, ''), 120)));
    n := n + 1;
  end loop;
  if n <> cardinality(p_ids) then
    raise exception 'ACH_VERIFICATION_NOT_FOUND: % of % checks were found.', n, cardinality(p_ids) using errcode = 'check_violation';
  end if;
  return n;
end $$;

create or replace function public.ach_verification_finish(
  p_id             uuid,
  p_actor          uuid,
  p_outcome        text,
  p_confirmed_cents integer,
  p_note           text
) returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v    public.ach_verifications%rowtype;
  acct public.ach_authorization_accounts%rowtype;
  a    public.ach_authorizations%rowtype;
  left_unverified int;
  result_state text;
  today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if p_actor is null then
    raise exception 'ACH_VERIFICATION_ACTOR: who finished the check must be recorded.' using errcode = 'check_violation';
  end if;
  if p_outcome is null or p_outcome not in ('passed', 'failed', 'cancelled') then
    raise exception 'ACH_VERIFICATION_OUTCOME: passed, failed or cancelled.' using errcode = 'check_violation';
  end if;
  select * into v from public.ach_verifications where id = p_id for update;
  if not found then
    raise exception 'ACH_VERIFICATION_NOT_FOUND: verification %.', p_id using errcode = 'check_violation';
  end if;
  select * into acct from public.ach_authorization_accounts where id = v.account_id for update;
  select * into a from public.ach_authorizations where id = acct.authorization_id for update;
  if p_outcome = 'passed' then
    if a.state not in ('signed', 'verifying') then
      raise exception 'ACH_VERIFICATION_STATE: the authorization is %; release the hold before passing a check.', a.state using errcode = 'check_violation';
    end if;
    if acct.archived_at is not null then
      raise exception 'ACH_VERIFICATION_ACCOUNT: account % was archived.', acct.id using errcode = 'check_violation';
    end if;
    if v.method = 'voided_check_callback' and coalesce(length(trim(p_note)), 0) < 10 then
      raise exception 'ACH_VERIFICATION_NOTE: say who confirmed the account and how (10+ characters).' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.ach_return_notices where verification_id = v.id) then
      raise exception 'ACH_VERIFICATION_NOTICE: the bank answered this check with a return or change notice.' using errcode = 'check_violation';
    end if;
  end if;
  update public.ach_verifications
     set status = p_outcome, payee_confirmed_cents = coalesce(p_confirmed_cents, payee_confirmed_cents),
         note = coalesce(nullif(left(trim(coalesce(p_note, '')), 500), ''), note)
   where id = v.id;
  if p_outcome = 'passed' then
    update public.ach_authorization_accounts
       set verification_status = 'verified', verification_method = v.method, verified_at = now(), verified_by = p_actor
     where id = acct.id;
    select count(*) into left_unverified from public.ach_authorization_accounts
     where authorization_id = a.id and archived_at is null and verification_status <> 'verified';
    if left_unverified = 0 then
      update public.ach_authorizations
         set state = 'active', updated_by = p_actor,
             annual_review_due_on = coalesce(a.annual_review_due_on, (today + interval '1 year')::date)
       where id = a.id;
      result_state := 'active';
    else
      result_state := a.state;
    end if;
  else
    update public.ach_authorization_accounts
       set verification_status = case when p_outcome = 'failed' then 'failed' else 'unverified' end
     where id = acct.id and verification_status = 'pending' and archived_at is null;
    result_state := a.state;
  end if;
  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, vendor_id, event_kind, actor_id, detail)
  values (a.id, a.payee_type, a.employee_id, a.vendor_id, 'verification_' || p_outcome, p_actor,
          jsonb_build_object('verification_id', v.id, 'method', v.method, 'account_last4', acct.account_last4,
                             'note', nullif(left(trim(coalesce(p_note, '')), 500), ''), 'authorization_state', result_state));
  return result_state;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Legal hold and annual review
-- -----------------------------------------------------------------------------
create or replace function public.ach_auth_set_legal_hold(p_auth_id uuid, p_actor uuid, p_on boolean, p_reason text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  a public.ach_authorizations%rowtype;
begin
  if p_actor is null or p_on is null then
    raise exception 'ACH_LEGAL_HOLD: who and on/off must be recorded.' using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'ACH_LEGAL_HOLD: give the reason (10+ characters), for example the matter or who asked.' using errcode = 'check_violation';
  end if;
  select * into a from public.ach_authorizations where id = p_auth_id for update;
  if not found then
    raise exception 'ACH_LEGAL_HOLD: authorization % not found.', p_auth_id using errcode = 'check_violation';
  end if;
  if a.legal_hold = p_on then
    raise exception 'ACH_LEGAL_HOLD: authorization % is already %.', a.id, case when p_on then 'on legal hold' else 'off legal hold' end
      using errcode = 'check_violation';
  end if;
  update public.ach_authorizations
     set legal_hold = p_on, legal_hold_reason = case when p_on then left(trim(p_reason), 500) else null end, updated_by = p_actor
   where id = a.id;
  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, vendor_id, event_kind, actor_id, detail)
  values (a.id, a.payee_type, a.employee_id, a.vendor_id, case when p_on then 'legal_hold_on' else 'legal_hold_off' end, p_actor,
          jsonb_build_object('reason', left(trim(p_reason), 500), 'previous_reason', a.legal_hold_reason));
end $$;

create or replace function public.ach_auth_review_done(p_auth_id uuid, p_actor uuid, p_note text)
returns date
language plpgsql
set search_path = public, pg_temp
as $$
declare
  a    public.ach_authorizations%rowtype;
  nxt  date := ((now() at time zone 'America/Los_Angeles')::date + interval '1 year')::date;
begin
  if p_actor is null then
    raise exception 'ACH_REVIEW: who reviewed must be recorded.' using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    raise exception 'ACH_REVIEW: say what was checked (10+ characters).' using errcode = 'check_violation';
  end if;
  select * into a from public.ach_authorizations where id = p_auth_id for update;
  if not found or a.state <> 'active' then
    raise exception 'ACH_REVIEW: only an active authorization is reviewed.' using errcode = 'check_violation';
  end if;
  update public.ach_authorizations set annual_review_due_on = nxt, updated_by = p_actor where id = a.id;
  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, vendor_id, event_kind, actor_id, detail)
  values (a.id, a.payee_type, a.employee_id, a.vendor_id, 'annual_review_done', p_actor,
          jsonb_build_object('note', left(trim(p_note), 500), 'previous_due', a.annual_review_due_on, 'next_due', nxt));
  return nxt;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Grants: service_role only (same pattern as 0260 / 0261 / 0262)
-- -----------------------------------------------------------------------------
revoke all on function public.ach_notice_log(uuid, text, uuid, text, date, date, bigint, text, text, text, date, text, uuid) from public, anon, authenticated;
revoke all on function public.ach_notice_resolve(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ach_auth_release_hold(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.ach_verification_start(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.ach_verification_mark_sent(uuid[], uuid, date, date, date, text) from public, anon, authenticated;
revoke all on function public.ach_verification_finish(uuid, uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.ach_auth_set_legal_hold(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.ach_auth_review_done(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ach_notice_log(uuid, text, uuid, text, date, date, bigint, text, text, text, date, text, uuid) to service_role;
grant execute on function public.ach_notice_resolve(uuid, uuid, text) to service_role;
grant execute on function public.ach_auth_release_hold(uuid, uuid, text, text, text) to service_role;
grant execute on function public.ach_verification_start(uuid, uuid, text, integer) to service_role;
grant execute on function public.ach_verification_mark_sent(uuid[], uuid, date, date, date, text) to service_role;
grant execute on function public.ach_verification_finish(uuid, uuid, text, integer, text) to service_role;
grant execute on function public.ach_auth_set_legal_hold(uuid, uuid, boolean, text) to service_role;
grant execute on function public.ach_auth_review_done(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
