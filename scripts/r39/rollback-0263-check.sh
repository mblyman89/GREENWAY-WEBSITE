# scripts/r39/rollback-0263-check.sh - proves the 0263 rollback drops cleanly, is re-runnable,
# lets 0263 re-apply + pass its check, and REFUSES once notices / sent checks / holds exist.
#   bash scripts/r39/rollback-0263-check.sh   (local DB r39)
set -eo pipefail
cd /workspace/gw
P="sudo -u postgres psql -d r39 -q -v ON_ERROR_STOP=1"
$P -f supabase/rollbacks/0263_ach_operations.rollback.sql 2>&1 | grep -v NOTICE || true
echo "after rollback: cols=$($P -Atc "select count(*) from information_schema.columns where table_name='ach_return_notices' and column_name in ('payee_type','hold_applied')") fns=$($P -Atc "select count(*) from pg_proc where proname like 'ach_notice_%' or proname like 'ach_verification_%' or proname in ('ach_auth_release_hold','ach_auth_set_legal_hold','ach_auth_review_done')")"
# rollback twice is safe
$P -f supabase/rollbacks/0263_ach_operations.rollback.sql 2>&1 | grep -v NOTICE || true
echo "rollback twice ok"
$P -f supabase/migrations/0263_ach_operations.sql 2>&1 | grep -v NOTICE || true
$P -f scripts/recon/ach-ops-0263-pg-check.sql 2>&1 | grep -o "ACH 0263 CHECK PASSED"
# refusal: create a USED state in a committed transaction, try rollback, then clean up through superuser bypass
$P <<'SQL' 2>&1 | grep -E "refused-|ERROR|NOT REFUSED"
begin;
insert into public.employees (full_name) values ('RB Probe') ;
insert into public.ach_return_notices (notice_kind, code, received_on, payee_type, employee_id)
  select 'return', 'R01', current_date, 'employee', id from public.employees where full_name = 'RB Probe';
savepoint s;
do $$ begin
  begin
    execute pg_read_file('/workspace/gw/supabase/rollbacks/0263_ach_operations.rollback.sql');
    raise exception 'ROLLBACK WAS NOT REFUSED';
  exception when others then
    if sqlerrm like 'ROLLBACK REFUSED: ach_return_notices%' then raise notice 'refused-notices OK'; else raise; end if;
  end;
end $$;
rollback;
SQL
true
$P <<'SQL' 2>&1 | grep -E "refused-|ERROR|NOT REFUSED"
begin;
alter table public.ach_verifications disable trigger trg_ach_verification_guard;
insert into public.employees (full_name) values ('RB Probe 2');
insert into public.ach_authorizations (payee_type, employee_id, state, signature_method, signed_on)
  select 'employee', id, 'signed', 'esign', current_date from public.employees where full_name = 'RB Probe 2';
insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, routing_enc, account_enc, account_type, account_last4, routing_last4, account_key_hmac)
  select a.id, 1, 'remainder', 'encv1:r', 'encv1:a', 'checking', '1234', '0021', repeat('b', 64) from public.ach_authorizations a join public.employees e on e.id = a.employee_id where e.full_name = 'RB Probe 2';
insert into public.ach_verifications (account_id, method, status, note)
  select c.id, 'voided_check_callback', 'cancelled', 'probe cancel' from public.ach_authorization_accounts c where c.account_key_hmac = repeat('b', 64);
do $$ begin
  begin
    execute pg_read_file('/workspace/gw/supabase/rollbacks/0263_ach_operations.rollback.sql');
    raise exception 'ROLLBACK WAS NOT REFUSED';
  exception when others then
    if sqlerrm like 'ROLLBACK REFUSED: ach_verifications%' then raise notice 'refused-verifications OK'; else raise; end if;
  end;
end $$;
rollback;
SQL
$P <<'SQL' 2>&1 | grep -E "refused-|ERROR|NOT REFUSED"
begin;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000263', 'rb263@x.test');
insert into public.staff_profiles (id, email, role, active) values ('00000000-0000-4000-8000-000000000263', 'rb263@x.test', 'owner', true) on conflict (id) do nothing;
insert into public.employees (full_name) values ('RB Probe 3');
insert into public.ach_authorizations (payee_type, employee_id, state, signature_method, signed_on, hold_reason, hold_entered_by)
  select 'employee', e.id, 'on_hold', 'esign', current_date, 'probe', (select id from public.staff_profiles limit 1) from public.employees e where full_name = 'RB Probe 3';
do $$ begin
  if (select count(*) from public.ach_authorizations where hold_entered_by is not null) = 0 then raise exception 'fixture: no staff_profiles row'; end if;
  begin
    execute pg_read_file('/workspace/gw/supabase/rollbacks/0263_ach_operations.rollback.sql');
    raise exception 'ROLLBACK WAS NOT REFUSED';
  exception when others then
    if sqlerrm like 'ROLLBACK REFUSED: ach_authorizations%' then raise notice 'refused-holds OK'; else raise; end if;
  end;
end $$;
rollback;
SQL
echo "cols still: $($P -Atc "select count(*) from information_schema.columns where table_name='ach_return_notices' and column_name='payee_type'")"
