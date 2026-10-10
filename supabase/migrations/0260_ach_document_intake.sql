-- =============================================================================
-- Migration 0260 - R39 S5: ACH document intake (accept / reject in one step)
-- =============================================================================
-- Owner request R39 (docs/roadmap/R39-ACH-INTEGRATION.md), slice S5. Managers
-- drop signed forms into the private ach-docs bucket (0258). Michael or
-- Stephen then re-keys the bank details BLIND and accepts the document.
--
-- Accepting an employee form writes four tables: the authorization, up to
-- three accounts, the document and the event log. 0258 forbids deleting
-- accounts and events, so a half-finished accept could never be cleaned up.
-- These functions do the whole thing in ONE transaction: all or nothing.
--
--   ach_intake_accept_employee  document -> new 'signed' authorization
--                               (wet_ink_upload) + unverified accounts.
--                               Payroll still will not pay until every
--                               account is verified (prenote / test credit,
--                               owner answer Q3) and the authorization is
--                               active (0258 / payroll-core).
--   ach_intake_finish           vendor accept (the bank numbers go through
--                               the 0259 vault, which puts them ON HOLD) or
--                               reject (any payee), with its event.
--
-- No new tables or columns. Each function pins search_path, is NOT security
-- definer, and is executable by service_role only (same pattern as 0249).
-- The document stays: rejected documents are kept as evidence (owner Q7/Q8).
--
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule), AFTER 0258 and 0259.
-- Rollback: supabase/rollbacks/0260_ach_document_intake.rollback.sql
-- =============================================================================

create or replace function public.ach_intake_accept_employee(
  p_document_id  uuid,
  p_actor        uuid,
  p_signed_on    date,
  p_payee_name   text,
  p_basis        text,
  p_replace_open boolean,
  p_accounts     jsonb
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  d        public.ach_authorization_documents%rowtype;
  old_auth public.ach_authorizations%rowtype;
  new_id   uuid;
  a        jsonb;
  n        int;
  i        int := 0;
  last4s   text[] := array[]::text[];
begin
  if p_basis is null or p_basis not in ('matches_form', 'two_blind_entries') then
    raise exception 'ACH_INTAKE_BASIS: accept needs a re-key basis (matches_form or two_blind_entries), got %.', coalesce(p_basis, 'null')
      using errcode = 'check_violation';
  end if;
  if p_actor is null then
    raise exception 'ACH_INTAKE_ACTOR: who accepted the document must be recorded.' using errcode = 'check_violation';
  end if;
  if p_signed_on is null or p_signed_on > current_date then
    raise exception 'ACH_INTAKE_SIGNED_ON: the signed date is missing or in the future.' using errcode = 'check_violation';
  end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' then
    raise exception 'ACH_INTAKE_ACCOUNTS: accounts must be a list.' using errcode = 'check_violation';
  end if;
  n := jsonb_array_length(p_accounts);
  if n < 1 or n > 3 then
    raise exception 'ACH_INTAKE_ACCOUNTS: an authorization has 1 to 3 accounts, got %.', n using errcode = 'check_violation';
  end if;

  select * into d from public.ach_authorization_documents where id = p_document_id for update;
  if not found then
    raise exception 'ACH_INTAKE_NOT_FOUND: document %.', p_document_id using errcode = 'check_violation';
  end if;
  if d.payee_type <> 'employee' then
    raise exception 'ACH_INTAKE_PAYEE: document % belongs to a vendor; vendor banking goes through the vault.', d.id
      using errcode = 'check_violation';
  end if;
  if d.archived_at is not null or d.authorization_id is not null
     or d.intake_status not in ('received', 'extracted') then
    raise exception 'ACH_INTAKE_STATE: document % is % and cannot be accepted again.', d.id, d.intake_status
      using errcode = 'check_violation';
  end if;
  if d.kind not in ('signed_form') then
    raise exception 'ACH_INTAKE_KIND: only a signed authorization form can create an authorization (this is a %).', d.kind
      using errcode = 'check_violation';
  end if;

  -- One open authorization per employee (0258). A new signed form replaces
  -- the open one only when the person accepting says so.
  select * into old_auth from public.ach_authorizations
   where payee_type = 'employee' and employee_id = d.employee_id
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
           ended_reason = format('Superseded by a new signed form (document %s).', d.id),
           updated_by = p_actor
     where id = old_auth.id;
    insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, event_kind, actor_id, detail)
    values (old_auth.id, 'employee', d.employee_id, 'authorization_superseded', p_actor,
            jsonb_build_object('document_id', d.id, 'previous_state', old_auth.state));
  end if;

  insert into public.ach_authorizations
    (payee_type, employee_id, payee_name, state, signature_method, signed_on, created_by, updated_by)
  values
    ('employee', d.employee_id, left(coalesce(trim(p_payee_name), ''), 200), 'signed', 'wet_ink_upload', p_signed_on, p_actor, p_actor)
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
     set intake_status = 'rekeyed' where id = d.id;
  update public.ach_authorization_documents
     set intake_status = 'accepted', authorization_id = new_id,
         intake_note = format('Accepted on %s.', replace(p_basis, '_', ' '))
   where id = d.id;

  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, event_kind, actor_id, detail)
  values
    (new_id, 'employee', d.employee_id, 'document_rekeyed', p_actor,
     jsonb_build_object('document_id', d.id, 'basis', p_basis)),
    (new_id, 'employee', d.employee_id, 'document_accepted', p_actor,
     jsonb_build_object('document_id', d.id, 'basis', p_basis, 'accounts', n, 'account_last4', to_jsonb(last4s),
                        'replaced', case when old_auth.id is null then null else old_auth.id end));
  return new_id;
end $$;

create or replace function public.ach_intake_finish(
  p_document_id uuid,
  p_actor       uuid,
  p_outcome     text,
  p_note        text,
  p_detail      jsonb
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  d public.ach_authorization_documents%rowtype;
begin
  if p_outcome is null or p_outcome not in ('accepted', 'rejected') then
    raise exception 'ACH_INTAKE_OUTCOME: outcome must be accepted or rejected.' using errcode = 'check_violation';
  end if;
  if p_actor is null then
    raise exception 'ACH_INTAKE_ACTOR: who decided must be recorded.' using errcode = 'check_violation';
  end if;
  select * into d from public.ach_authorization_documents where id = p_document_id for update;
  if not found then
    raise exception 'ACH_INTAKE_NOT_FOUND: document %.', p_document_id using errcode = 'check_violation';
  end if;
  if d.archived_at is not null or d.intake_status not in ('received', 'extracted') then
    raise exception 'ACH_INTAKE_STATE: document % is % and is already decided.', d.id, d.intake_status
      using errcode = 'check_violation';
  end if;
  if p_outcome = 'rejected' and coalesce(length(trim(p_note)), 0) < 10 then
    raise exception 'ACH_INTAKE_REASON: say why the document is rejected (10+ characters).' using errcode = 'check_violation';
  end if;
  if p_outcome = 'accepted' then
    if d.payee_type <> 'vendor' then
      raise exception 'ACH_INTAKE_PAYEE: employee documents are accepted with ach_intake_accept_employee.' using errcode = 'check_violation';
    end if;
    if p_detail is null or (p_detail->>'basis') is null or (p_detail->>'basis') not in ('matches_form', 'two_blind_entries') then
      raise exception 'ACH_INTAKE_BASIS: accept needs a re-key basis.' using errcode = 'check_violation';
    end if;
    update public.ach_authorization_documents set intake_status = 'rekeyed' where id = d.id;
    update public.ach_authorization_documents
       set intake_status = 'accepted', intake_note = left(coalesce(trim(p_note), ''), 500)
     where id = d.id;
    insert into public.ach_authorization_events (payee_type, vendor_id, event_kind, actor_id, detail)
    values ('vendor', d.vendor_id, 'document_rekeyed', p_actor, jsonb_build_object('document_id', d.id, 'basis', p_detail->>'basis')),
           ('vendor', d.vendor_id, 'document_accepted', p_actor, coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('document_id', d.id));
    return;
  end if;
  update public.ach_authorization_documents
     set intake_status = 'rejected', intake_note = left(trim(p_note), 500)
   where id = d.id;
  insert into public.ach_authorization_events (payee_type, employee_id, vendor_id, event_kind, actor_id, detail)
  values (d.payee_type, d.employee_id, d.vendor_id, 'document_rejected', p_actor,
          jsonb_build_object('document_id', d.id, 'reason', left(trim(p_note), 500)));
end $$;

-- Service role only: these write the payment-authorization record.
revoke all on function public.ach_intake_accept_employee(uuid, uuid, date, text, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.ach_intake_finish(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ach_intake_accept_employee(uuid, uuid, date, text, text, boolean, jsonb) to service_role;
grant execute on function public.ach_intake_finish(uuid, uuid, text, text, jsonb) to service_role;
