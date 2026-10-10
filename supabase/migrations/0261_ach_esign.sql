-- =============================================================================
-- Migration 0261 - R39 S6: in-person e-sign of the employee direct deposit form
-- =============================================================================
-- Owner request R39 (docs/roadmap/R39-ACH-INTEGRATION.md): Q5 "add e-sign
-- now"; Q10 every employee signs and the form goes in the file and the vault;
-- Q12 no self-service, so signing is in person on the store device.
--
-- Flow (src/lib/payments/ach-esign-core.ts and ach-esign-store.ts):
--   started    Michael or Stephen checks the photo ID (form Part 7) and starts
--              the session for one employee.
--   code_sent  The employee types an email address and gets a 6-digit code.
--              Only a keyed hash of the code is stored (otp_digest).
--   consented  The employee read the E-SIGN 7001(c) disclosure and typed the
--              code back. That shows they can open electronic records.
--   signed     The employee typed their accounts (each number twice) and their
--              name under the intent statement. The server built the record
--              PDF and the certificate PDF, stored both in ach-docs, and
--              called ach_esign_complete, which writes everything at once.
--   cancelled  Any time before signing, with a reason.
--
-- One table, one guard trigger, one function. The function is all or nothing,
-- like 0260: accounts, documents and events can never be deleted (0258), so a
-- half-written signing could never be cleaned up.
--
-- The new authorization is 'signed' with signature_method 'esign'. Payroll
-- still will not pay until every account is verified (prenote or $1 test,
-- owner Q3) and the authorization is active (0258 / payroll-core).
--
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule), AFTER 0258, 0259 and 0260.
-- Rollback: supabase/rollbacks/0261_ach_esign.rollback.sql
-- =============================================================================

create table if not exists public.ach_esign_sessions (
  id                      uuid primary key default gen_random_uuid(),
  employee_id             uuid not null references public.employees (id) on delete restrict,
  state                   text not null default 'started'
                            check (state in ('started', 'code_sent', 'consented', 'signed', 'cancelled')),
  started_by              uuid not null references public.staff_profiles (id) on delete restrict,
  started_at              timestamptz not null default now(),
  -- Form Part 7: ID type and "ID last 4 / expiry". Never a full ID number.
  id_type                 text not null check (id_type in ('wa_dl_id', 'passport', 'other_gov_photo_id')),
  id_detail               text not null check (length(id_detail) between 4 and 40 and id_detail !~ '[0-9]{5,}'),
  legal_name              text not null check (length(trim(legal_name)) between 3 and 120),
  -- The address the code went to: encrypted, plus a masked copy for screens.
  email_enc               text check (email_enc is null or email_enc like 'encv1:%'),
  email_masked            text,
  otp_digest              text check (otp_digest is null or otp_digest ~ '^[0-9a-f]{64}$'),
  otp_sent_at             timestamptz,
  otp_sends               smallint not null default 0 check (otp_sends between 0 and 3),
  otp_attempts            smallint not null default 0 check (otp_attempts between 0 and 5),
  code_verified_at        timestamptz,
  disclosure_version      text,
  disclosure_sha256       text check (disclosure_sha256 is null or disclosure_sha256 ~ '^[0-9a-f]{64}$'),
  consented_at            timestamptz,
  signed_at               timestamptz,
  typed_signature         text,
  signer_ip               text check (signer_ip is null or length(signer_ip) <= 45),
  signer_user_agent       text check (signer_user_agent is null or length(signer_user_agent) <= 400),
  record_document_id      uuid references public.ach_authorization_documents (id) on delete restrict,
  certificate_document_id uuid references public.ach_authorization_documents (id) on delete restrict,
  authorization_id        uuid references public.ach_authorizations (id) on delete restrict,
  cancelled_at            timestamptz,
  cancel_reason           text,
  constraint esign_code_sent_shape check (
    state in ('started', 'cancelled') or (email_enc is not null and email_masked is not null and otp_digest is not null and otp_sent_at is not null and otp_sends >= 1)
  ),
  constraint esign_consented_shape check (
    state not in ('consented', 'signed')
    or (code_verified_at is not null and consented_at is not null and disclosure_version is not null and disclosure_sha256 is not null)
  ),
  constraint esign_signed_shape check (
    state <> 'signed'
    or (signed_at is not null and coalesce(length(trim(typed_signature)), 0) >= 3 and record_document_id is not null
        and certificate_document_id is not null and authorization_id is not null and record_document_id <> certificate_document_id)
  ),
  constraint esign_cancelled_shape check (
    (state = 'cancelled') = (cancelled_at is not null) and (state <> 'cancelled' or coalesce(length(trim(cancel_reason)), 0) >= 5)
  )
);

-- One live signing per employee at a time.
create unique index if not exists ach_esign_one_live_per_employee
  on public.ach_esign_sessions (employee_id)
  where state in ('started', 'code_sent', 'consented');
create index if not exists ach_esign_employee_idx on public.ach_esign_sessions (employee_id, started_at desc);

create or replace function public.ach_esign_guard()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  allowed text[];
begin
  if tg_op = 'DELETE' then
    if old.state = 'signed' then
      raise exception 'ACH_ESIGN_KEEP: signed session % is evidence and is kept with the authorization.', old.id;
    end if;
    return old;
  end if;
  if old.state in ('signed', 'cancelled') then
    raise exception 'ACH_ESIGN_FINAL: session % is % and cannot change.', old.id, old.state;
  end if;
  if new.employee_id is distinct from old.employee_id
     or new.started_by is distinct from old.started_by
     or new.started_at is distinct from old.started_at
     or new.id_type is distinct from old.id_type
     or new.id_detail is distinct from old.id_detail
     or new.legal_name is distinct from old.legal_name then
    raise exception 'ACH_ESIGN_IMMUTABLE: who, when and the ID check of session % cannot change.', old.id;
  end if;
  if new.otp_attempts < old.otp_attempts or new.otp_sends < old.otp_sends then
    raise exception 'ACH_ESIGN_COUNTERS: code counters of session % only go up.', old.id;
  end if;
  if old.code_verified_at is not null and (new.email_enc is distinct from old.email_enc or new.code_verified_at is distinct from old.code_verified_at) then
    raise exception 'ACH_ESIGN_IMMUTABLE: the confirmed email of session % cannot change.', old.id;
  end if;
  if new.state is distinct from old.state then
    allowed := case old.state
      when 'started'   then array['code_sent', 'cancelled']
      when 'code_sent' then array['consented', 'cancelled']
      when 'consented' then array['signed', 'cancelled']
      else array[]::text[]
    end;
    if not (new.state = any (allowed)) then
      raise exception 'ACH_ESIGN_TRANSITION: % -> % is not allowed.', old.state, new.state;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_esign_guard on public.ach_esign_sessions;
create trigger trg_ach_esign_guard
  before update or delete on public.ach_esign_sessions
  for each row execute function public.ach_esign_guard();

-- -----------------------------------------------------------------------------
-- ach_esign_complete: the signing, all at once.
-- -----------------------------------------------------------------------------
create or replace function public.ach_esign_complete(
  p_session_id   uuid,
  p_actor        uuid,
  p_signed_at    timestamptz,
  p_ip           text,
  p_user_agent   text,
  p_typed_name   text,
  p_replace_open boolean,
  p_accounts     jsonb,
  p_record       jsonb,
  p_certificate  jsonb
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  s        public.ach_esign_sessions%rowtype;
  old_auth public.ach_authorizations%rowtype;
  new_id   uuid;
  rec_id   uuid;
  cert_id  uuid;
  a        jsonb;
  n        int;
  i        int := 0;
  last4s   text[] := array[]::text[];
  signed_d date;
begin
  if p_actor is null then
    raise exception 'ACH_ESIGN_ACTOR: the staff account on the device must be recorded.' using errcode = 'check_violation';
  end if;
  if p_signed_at is null or p_signed_at > now() + interval '1 minute' then
    raise exception 'ACH_ESIGN_TIME: the signing time is missing or in the future.' using errcode = 'check_violation';
  end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' then
    raise exception 'ACH_INTAKE_ACCOUNTS: accounts must be a list.' using errcode = 'check_violation';
  end if;
  n := jsonb_array_length(p_accounts);
  if n < 1 or n > 3 then
    raise exception 'ACH_INTAKE_ACCOUNTS: an authorization has 1 to 3 accounts, got %.', n using errcode = 'check_violation';
  end if;
  if p_record is null or p_certificate is null
     or coalesce(p_record->>'storage_path', '') not like 'ach-docs/employee/%'
     or coalesce(p_certificate->>'storage_path', '') not like 'ach-docs/employee/%'
     or (p_record->>'sha256') = (p_certificate->>'sha256') then
    raise exception 'ACH_ESIGN_FILES: the record and the certificate must be two stored employee PDFs.' using errcode = 'check_violation';
  end if;

  select * into s from public.ach_esign_sessions where id = p_session_id for update;
  if not found then
    raise exception 'ACH_ESIGN_NOT_FOUND: session %.', p_session_id using errcode = 'check_violation';
  end if;
  if s.state <> 'consented' then
    raise exception 'ACH_ESIGN_STATE: session % is %, not ready to sign.', s.id, s.state using errcode = 'check_violation';
  end if;
  if s.started_at < now() - interval '30 minutes' then
    raise exception 'ACH_ESIGN_EXPIRED: session % is older than 30 minutes. Start again.', s.id using errcode = 'check_violation';
  end if;
  if lower(regexp_replace(trim(coalesce(p_typed_name, '')), '\s+', ' ', 'g'))
     <> lower(regexp_replace(trim(s.legal_name), '\s+', ' ', 'g')) then
    raise exception 'ACH_ESIGN_NAME: the typed signature must be the legal name on the form.' using errcode = 'check_violation';
  end if;
  signed_d := (p_signed_at at time zone 'America/Los_Angeles')::date;

  insert into public.ach_authorization_documents
    (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, original_filename, intake_status, intake_note, uploaded_by)
  values
    ('employee', s.employee_id, 'signed_form', p_record->>'storage_path', p_record->>'sha256', (p_record->>'byte_size')::bigint,
     'application/pdf', 'GW-ACH-E-esigned.pdf', 'received', null, p_actor)
  returning id into rec_id;
  insert into public.ach_authorization_documents
    (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, original_filename, intake_status, intake_note, uploaded_by)
  values
    ('employee', s.employee_id, 'esign_certificate', p_certificate->>'storage_path', p_certificate->>'sha256', (p_certificate->>'byte_size')::bigint,
     'application/pdf', 'GW-ACH-E-esign-certificate.pdf', 'received', null, p_actor)
  returning id into cert_id;

  select * into old_auth from public.ach_authorizations
   where payee_type = 'employee' and employee_id = s.employee_id
     and state not in ('revoked', 'archived')
   for update;
  if found then
    if not coalesce(p_replace_open, false) then
      raise exception 'ACH_INTAKE_OPEN_EXISTS: this employee already has an open authorization (%). Tick "replace" to archive it.', old_auth.id
        using errcode = 'check_violation';
    end if;
    update public.ach_authorization_accounts
       set archived_at = now()
     where authorization_id = old_auth.id and archived_at is null;
    update public.ach_authorizations
       set state = 'archived',
           ended_on = greatest(current_date, coalesce(old_auth.signed_on, current_date)),
           ended_reason = format('Superseded by an e-signed form (session %s).', s.id),
           updated_by = p_actor
     where id = old_auth.id;
    insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, event_kind, actor_id, detail)
    values (old_auth.id, 'employee', s.employee_id, 'authorization_superseded', p_actor,
            jsonb_build_object('esign_session_id', s.id, 'document_id', rec_id, 'previous_state', old_auth.state));
  end if;

  insert into public.ach_authorizations
    (payee_type, employee_id, payee_name, state, signature_method, signed_on, created_by, updated_by)
  values
    ('employee', s.employee_id, left(trim(s.legal_name), 200), 'signed', 'esign', signed_d, p_actor, p_actor)
  returning id into new_id;

  for a in select * from jsonb_array_elements(p_accounts) loop
    i := i + 1;
    if (a->>'priority')::int is distinct from i then
      raise exception 'ACH_INTAKE_ACCOUNTS: account priorities must be 1..n in order.' using errcode = 'check_violation';
    end if;
    insert into public.ach_authorization_accounts
      (authorization_id, priority, rule_kind, fixed_cents, basis_points, bank_name,
       routing_enc, account_enc, account_type, account_last4, routing_last4, account_key_hmac, created_by)
    values
      (new_id, i, a->>'rule_kind', (a->>'fixed_cents')::bigint, (a->>'basis_points')::int, coalesce(a->>'bank_name', ''),
       a->>'routing_enc', a->>'account_enc', a->>'account_type', a->>'account_last4', a->>'routing_last4',
       a->>'account_key_hmac', p_actor);
    last4s := last4s || (a->>'account_last4');
  end loop;

  update public.ach_authorization_documents
     set intake_status = 'accepted', authorization_id = new_id,
         intake_note = format('E-signed in person (session %s).', s.id)
   where id in (rec_id, cert_id);

  update public.ach_esign_sessions
     set state = 'signed', signed_at = p_signed_at, typed_signature = left(trim(p_typed_name), 120),
         signer_ip = left(p_ip, 45), signer_user_agent = left(p_user_agent, 400),
         record_document_id = rec_id, certificate_document_id = cert_id, authorization_id = new_id
   where id = s.id;

  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, event_kind, actor_id, detail)
  values
    (new_id, 'employee', s.employee_id, 'esign_signed', p_actor,
     jsonb_build_object('esign_session_id', s.id, 'document_id', rec_id, 'certificate_document_id', cert_id,
                        'record_sha256', p_record->>'sha256', 'accounts', n, 'account_last4', to_jsonb(last4s),
                        'replaced', case when old_auth.id is null then null else old_auth.id end));
  return new_id;
end $$;

-- -----------------------------------------------------------------------------
-- RLS + grants (same least-privilege pattern as 0258 / 0260)
-- -----------------------------------------------------------------------------
alter table public.ach_esign_sessions enable row level security;
drop policy if exists ach_esign_sessions_admin on public.ach_esign_sessions;
create policy ach_esign_sessions_admin on public.ach_esign_sessions
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on table public.ach_esign_sessions from anon;
revoke delete on table public.ach_esign_sessions from authenticated;
grant select, insert, update on table public.ach_esign_sessions to authenticated;
grant select, insert, update, delete on table public.ach_esign_sessions to service_role;

revoke all on function public.ach_esign_complete(uuid, uuid, timestamptz, text, text, text, boolean, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ach_esign_complete(uuid, uuid, timestamptz, text, text, text, boolean, jsonb, jsonb, jsonb) to service_role;
