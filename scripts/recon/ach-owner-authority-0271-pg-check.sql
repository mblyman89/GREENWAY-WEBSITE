-- scripts/recon/ach-owner-authority-0271-pg-check.sql  (R41 S0 - migration 0271)
--
-- Scenario check for 0271_ach_owner_authority.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-owner-authority-0271-pg-check.sql
--
-- Owner decision D-6, option B (verbatim in the migration header): the owner
-- changes live ACH data alone; an admin's stop actions take effect at once and
-- land on the owner's review list; every other live admin change is a request
-- that waits for the owner. Each refusal MUST raise with the expected text and
-- sits beside a valid write that MUST be accepted.
-- "ACH 0271 CHECK PASSED" then ROLLBACK = all clear.
begin;

create or replace function pg_temp.must_fail(sql text, expect text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(expect in sqlerrm) = 0 and sqlstate <> expect then
      raise exception 'probe raised the WRONG error. expected %, got [%] %  -- %', expect, sqlstate, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'probe was ACCEPTED but must be refused (expected %): %', expect, sql;
end $$;

do $$
declare
  u_m   uuid := gen_random_uuid();   -- "Michael", owner
  u_s   uuid := gen_random_uuid();   -- "Stephen", admin
  u_g   uuid := gen_random_uuid();   -- a manager
  u_o2  uuid := gen_random_uuid();   -- a second, INACTIVE owner row
  emp   uuid;
  req   uuid;
  req2  uuid;
  req3  uuid;
  rv    uuid;
  r     record;
  t     text;
  n     int;
begin
  insert into auth.users (id, email) values (u_m, 'm0271@x.test'), (u_s, 's0271@x.test'), (u_g, 'g0271@x.test'), (u_o2, 'o0271@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0271@x.test', 'owner', true), (u_s, 's0271@x.test', 'admin', true),
    (u_g, 'g0271@x.test', 'manager', true), (u_o2, 'o0271@x.test', 'owner', false)
    on conflict (id) do update set role = excluded.role, active = excluded.active;

  -- 1. ach_actor_is_owner ---------------------------------------------------
  assert public.ach_actor_is_owner(u_m), 'active owner is the owner';
  assert not public.ach_actor_is_owner(u_s), 'admin is not the owner';
  assert not public.ach_actor_is_owner(u_g), 'manager is not the owner';
  assert not public.ach_actor_is_owner(u_o2), 'inactive owner is not the owner';
  assert not public.ach_actor_is_owner(null), 'nobody is not the owner';
  assert not public.ach_actor_is_owner(gen_random_uuid()), 'unknown id is not the owner';
  perform set_config('request.jwt.claim.sub', u_s::text, true);
  assert not public.ach_write_by_owner(u_m), 'owner stamp + admin JWT is not an owner write';
  perform set_config('request.jwt.claim.sub', u_m::text, true);
  assert public.ach_write_by_owner(u_m), 'owner stamp + owner JWT is an owner write';
  perform set_config('request.jwt.claim.sub', '', true);
  assert public.ach_write_by_owner(u_m), 'owner stamp + service role is an owner write';

  -- 2. employees bank columns: fresh owner stamp only -----------------------
  insert into public.employees (full_name) values ('Probe 0271 Employee') returning id into emp;
  perform pg_temp.must_fail(format($q$update public.employees set bank_routing = 'encv1:r', bank_account_number = 'encv1:a', bank_account_type = 'checking' where id = %L$q$, emp),
    'must be stamped');
  perform pg_temp.must_fail(format($q$update public.employees set bank_routing = 'encv1:r', bank_account_number = 'encv1:a', bank_account_type = 'checking', bank_changed_by = %L, bank_changed_at = now() where id = %L$q$, u_s, emp),
    'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$update public.employees set bank_routing = 'encv1:r', bank_account_number = 'encv1:a', bank_account_type = 'checking', bank_changed_by = %L, bank_changed_at = now() where id = %L$q$, u_o2, emp),
    'ACH_OWNER_ONLY');
  update public.employees set bank_routing = 'encv1:r', bank_account_number = 'encv1:a', bank_account_type = 'checking',
    bank_changed_by = u_m, bank_changed_at = clock_timestamp() where id = emp;
  select * into r from public.employees where id = emp;
  assert r.bank_routing = 'encv1:r' and r.bank_changed_by = u_m, 'owner bank save accepted';
  -- an old owner stamp cannot carry a later change (same bank_changed_at)
  perform pg_temp.must_fail(format($q$update public.employees set bank_account_number = 'encv1:b' where id = %L$q$, emp), 'must be stamped');
  perform pg_temp.must_fail(format($q$update public.employees set bank_account_number = 'encv1:b', bank_changed_by = %L where id = %L$q$, u_m, emp), 'must be stamped');
  -- non-bank edits pass with no stamp
  update public.employees set full_name = 'Probe 0271 Renamed' where id = emp;
  -- clearing banking is a change too
  perform pg_temp.must_fail(format($q$update public.employees set bank_routing = null, bank_account_number = null, bank_changed_by = %L, bank_changed_at = now() + interval '1 second' where id = %L$q$, u_s, emp),
    'ACH_OWNER_ONLY');
  update public.employees set bank_routing = null, bank_account_number = null, bank_account_type = null,
    bank_changed_by = u_m, bank_changed_at = clock_timestamp() + interval '1 second' where id = emp;
  -- inserting a new employee WITH banking needs the owner; without, no stamp
  perform pg_temp.must_fail($q$insert into public.employees (full_name, bank_routing) values ('Probe 0271 B', 'encv1:r')$q$, 'must be stamped');
  insert into public.employees (full_name) values ('Probe 0271 C');

  -- 3. company banking settings: owner updated_by only ----------------------
  perform pg_temp.must_fail(format($q$update public.ach_company_settings set company_name = 'Probe Co', updated_by = %L where id = true$q$, u_s), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail($q$update public.ach_company_settings set company_name = 'Probe Co', updated_by = null where id = true$q$, 'ACH_OWNER_ONLY');
  update public.ach_company_settings set company_name = 'Probe Co', updated_by = u_m where id = true;
  -- re-stamping with no real change is not a change
  update public.ach_company_settings set updated_by = u_s where id = true;

  -- 4. requests: forward-only, owner decides, requester withdraws -----------
  insert into public.ach_change_requests (kind, target_type, target_id, target_label, base_version, payload_enc, summary, reason, requested_by)
    values ('vendor_bank.save', 'vendor', 'v-1', 'Acme Farms', 'ver-1', 'encv1:p:x', '[{"label":"Account","value":"****4821"}]', 'Vendor letter', u_s)
    returning id into req;
  perform pg_temp.must_fail(format($q$insert into public.ach_change_requests (kind, target_type, payload_enc, requested_by, status) values ('vendor_bank.save', 'vendor', 'x1', %L, 'approved')$q$, u_s),
    'starts pending');
  perform pg_temp.must_fail(format($q$insert into public.ach_change_requests (kind, target_type, payload_enc, requested_by) values ('Vendor Bank', 'vendor', 'x1', %L)$q$, u_s),
    'ach_change_requests_kind_check');
  perform pg_temp.must_fail(format($q$insert into public.ach_change_requests (kind, target_type, payload_enc, requested_by) values ('vendor_bank.save', 'planet', 'x1', %L)$q$, u_s),
    'ach_change_requests_target_type_check');
  perform pg_temp.must_fail(format($q$delete from public.ach_change_requests where id = %L$q$, req), 'ACH_REQUEST_KEEP');
  perform pg_temp.must_fail(format($q$update public.ach_change_requests set payload_enc = 'encv1:p:y' where id = %L$q$, req), 'ACH_REQUEST_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_change_requests set base_version = 'ver-2' where id = %L$q$, req), 'ACH_REQUEST_IMMUTABLE');
  -- raw status writes go through the same guard
  perform pg_temp.must_fail(format($q$update public.ach_change_requests set status = 'approved', decided_by = %L, decided_at = now() where id = %L$q$, u_s, req), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$update public.ach_change_requests set status = 'withdrawn', decided_by = %L, decided_at = now() where id = %L$q$, u_m, req), 'ACH_REQUEST_WITHDRAW');
  perform pg_temp.must_fail(format($q$update public.ach_change_requests set status = 'approved' where id = %L$q$, req), 'ACH_OWNER_ONLY');

  -- decide(): who, what, stale
  t := $q$select public.ach_request_decide(%L, %L, %L, %L, %L)$q$;
  perform pg_temp.must_fail(format(t, req, null, 'approved', null, 'ver-1'), 'ACH_REQUEST_ACTOR');
  perform pg_temp.must_fail(format(t, req, u_m, 'maybe', null, 'ver-1'), 'ACH_REQUEST_DECISION');
  perform pg_temp.must_fail(format(t, gen_random_uuid(), u_m, 'approved', null, 'ver-1'), 'ACH_REQUEST_NOT_FOUND');
  perform pg_temp.must_fail(format(t, req, u_s, 'approved', null, 'ver-1'), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format(t, req, u_g, 'rejected', null, 'ver-1'), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format(t, req, u_o2, 'approved', null, 'ver-1'), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format(t, req, u_m, 'withdrawn', null, 'ver-1'), 'ACH_REQUEST_WITHDRAW');
  -- D-7: a request whose target changed since is refused (never applied blind)
  perform pg_temp.must_fail(format(t, req, u_m, 'approved', null, 'ver-2'), 'ACH_REQUEST_STALE');
  perform pg_temp.must_fail(format(t, req, u_m, 'approved', null, null), 'ACH_REQUEST_STALE');
  -- the stale refusal changed nothing
  select status into t from public.ach_change_requests where id = req;
  assert t = 'pending', 'stale refusal leaves it pending';
  -- result cannot be recorded on a pending request
  perform pg_temp.must_fail(format($q$select public.ach_request_record_result(%L, %L, 'ok', null)$q$, req, u_m), 'was not approved');
  t := public.ach_request_decide(req, u_m, 'approved', '', 'ver-1');
  assert t = 'approved', 'owner approves';
  select * into r from public.ach_change_requests where id = req;
  assert r.status = 'approved' and r.decided_by = u_m and r.decided_at is not null and r.decision_note is null,
    'decision recorded; an empty note is stored as no note';
  perform pg_temp.must_fail(format($q$select public.ach_request_decide(%L, %L, 'rejected', null, 'ver-1')$q$, req, u_m), 'ACH_REQUEST_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_change_requests set decision_note = 'changed my mind' where id = %L$q$, req), 'ACH_REQUEST_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_change_requests set status = 'rejected' where id = %L$q$, req), 'ACH_REQUEST_FINAL');
  -- result: once, by the owner who approved, ref XOR error
  perform pg_temp.must_fail(format($q$select public.ach_request_record_result(%L, %L, 'ok', null)$q$, req, u_s), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$select public.ach_request_record_result(%L, %L, 'ok', 'err')$q$, req, u_m), 'ACH_REQUEST_RESULT');
  perform pg_temp.must_fail(format($q$select public.ach_request_record_result(%L, %L, null, null)$q$, req, u_m), 'ACH_REQUEST_RESULT');
  perform public.ach_request_record_result(req, u_m, 'vendor_bank_details:v-1', null);
  perform pg_temp.must_fail(format($q$select public.ach_request_record_result(%L, %L, null, 'late error')$q$, req, u_m), 'ACH_REQUEST_FINAL');
  select count(*) into n from public.ach_change_request_events where request_id = req and event_kind in ('approved', 'applied');
  assert n = 2, format('approved + applied events, got %s', n);
  perform pg_temp.must_fail(format($q$update public.ach_change_request_events set detail = '{}' where request_id = %L$q$, req), 'APPEND_ONLY');
  perform pg_temp.must_fail(format($q$delete from public.ach_change_request_events where request_id = %L$q$, req), 'APPEND_ONLY');

  -- no base version (nothing to compare): approval is allowed
  insert into public.ach_change_requests (kind, target_type, target_id, payload_enc, requested_by)
    values ('vendor_contact.add', 'vendor', 'v-1', 'encv1:p:z', u_s) returning id into req2;
  -- requester withdraws; then it is final
  t := public.ach_request_decide(req2, u_s, 'withdrawn', 'Entered the wrong vendor', null);
  assert t = 'withdrawn', 'requester withdraws';
  perform pg_temp.must_fail(format($q$select public.ach_request_decide(%L, %L, 'approved', null, null)$q$, req2, u_m), 'ACH_REQUEST_FINAL');
  -- owner supersedes (he made the change himself) and rejects
  insert into public.ach_change_requests (kind, target_type, target_id, payload_enc, requested_by)
    values ('employee_bank.save', 'employee', emp::text, 'encv1:p:q', u_s) returning id into req3;
  t := public.ach_request_decide(req3, u_m, 'superseded', null, null);
  assert t = 'superseded', 'owner supersedes';
  insert into public.ach_change_requests (kind, target_type, target_id, payload_enc, requested_by)
    values ('banking_settings.save', 'company', 'company', 'encv1:p:w', u_s) returning id into req3;
  t := public.ach_request_decide(req3, u_m, 'rejected', 'Not now', null);
  assert t = 'rejected', 'owner rejects';
  perform pg_temp.must_fail(format($q$select public.ach_request_record_result(%L, %L, 'ok', null)$q$, req3, u_m), 'was not approved');

  -- 5. owner review list (admin STOP actions) -------------------------------
  insert into public.ach_owner_reviews (kind, target_label, summary, outcome, done_by)
    values ('vendor_bank.hold', 'Acme Farms', '[]', 'Banking put on hold: odd email', u_s) returning id into rv;
  perform pg_temp.must_fail(format($q$insert into public.ach_owner_reviews (kind, done_by, checked_off_by, checked_off_at) values ('vendor_bank.hold', %L, %L, now())$q$, u_s, u_m),
    'starts unchecked');
  perform pg_temp.must_fail(format($q$delete from public.ach_owner_reviews where id = %L$q$, rv), 'ACH_REVIEW_KEEP');
  perform pg_temp.must_fail(format($q$update public.ach_owner_reviews set outcome = 'nothing happened' where id = %L$q$, rv), 'ACH_REVIEW_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_owner_reviews set checked_off_by = %L, checked_off_at = now() where id = %L$q$, u_s, rv), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$update public.ach_owner_reviews set checked_off_by = %L where id = %L$q$, u_m, rv), 'aor_checked_shape');
  update public.ach_owner_reviews set checked_off_by = u_m, checked_off_at = now(), check_note = 'Called Acme, agreed' where id = rv;
  perform pg_temp.must_fail(format($q$update public.ach_owner_reviews set check_note = 'again' where id = %L$q$, rv), 'ACH_REVIEW_FINAL');

  -- 6. grants: server only ----------------------------------------------------
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('ach_change_requests', 'ach_change_request_events', 'ach_owner_reviews')
     and grantee in ('anon', 'authenticated');
  assert n = 0, format('anon/authenticated must hold nothing on the 0271 tables, hold %s', n);
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('ach_change_requests', 'ach_change_request_events', 'ach_owner_reviews')
     and grantee = 'service_role' and privilege_type = 'DELETE';
  assert n = 0, 'service_role must not hold DELETE on the 0271 tables';
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname in ('ach_change_requests', 'ach_change_request_events', 'ach_owner_reviews') and c.relrowsecurity;
  assert n = 3, 'RLS on all three 0271 tables';
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name in ('ach_request_decide', 'ach_request_record_result')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  assert n = 0, 'decide / record_result are not callable by API users';
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name in ('ach_request_decide', 'ach_request_record_result', 'ach_auth_release_hold')
     and grantee = 'service_role' and privilege_type = 'EXECUTE';
  assert n = 3, format('service_role executes the three functions, %s', n);
  select count(*) into n from pg_proc where proname in ('ach_actor_is_owner', 'ach_write_by_owner') and prosecdef
     and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%';
  assert n = 2, 'owner lookups are security definer with search_path pinned';

  -- 7. D-5 policies read is_admin(), not is_manager() -------------------------
  select count(*) into n from pg_policies
   where policyname in ('ach_docs_manager_drop', 'ach_documents_manager_drop', 'ach_events_insert')
     and coalesce(with_check, '') like '%is_admin()%' and coalesce(with_check, '') not like '%is_manager()%';
  assert n = 3, format('the three drop policies must use is_admin() only, %s do', n);

  raise notice 'ACH 0271 CHECK PASSED';
end $$;

rollback;
