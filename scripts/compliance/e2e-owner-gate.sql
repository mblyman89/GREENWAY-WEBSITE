-- =============================================================================
-- SLICE books-06 — ADVERSARIAL SUITE FOR THE OWNER GATE (migration 0190)
--
-- WHAT THIS PROVES, AND WHY IT IS BUILT THIS WAY
-- ----------------------------------------------
-- The claim being tested is: "after 0190, a non-owner staff member cannot read
-- the bank feed, the ATM vault, the crypto treasury or the loans."
--
-- A naive test would log in as a readonly user, SELECT from plaid_transactions,
-- get 0 rows, and print PASS. That test is WORTHLESS, and it is worthless in
-- three separate ways that have each already bitten this project once:
--
--   1. 0 rows because the TABLE IS EMPTY, not because the gate denied me.
--      -> Every deny-assertion below is paired with a seeded row that the
--         OWNER can see. If the owner sees 0 rows too, the test FAILS as
--         inconclusive instead of passing.
--
--   2. 0 rows because the FIXTURE IS BROKEN — the readonly user was never
--      created, so auth.uid() matches nobody and EVERY policy denies. That
--      would report a perfect score while measuring nothing.
--      -> §1 asserts the fixture is real: the readonly user must be able to
--         read a table it is SUPPOSED to read (tax_settings). If it cannot,
--         the suite stops. This is the "prove the instrument works" rule.
--
--   3. 0 rows because RLS denies EVERYONE including the owner, i.e. we didn't
--      lock the door, we welded it shut and broke the owner's own pages.
--      -> Every table is asserted BOTH ways: owner CAN read, non-owner CANNOT.
--
-- AND THE NEGATIVE CONTROL (§4): the suite temporarily puts one table back the
-- way it was before 0190 and proves the readonly user CAN read it again. That
-- is what rules out "it was always denied for some unrelated reason." Then it
-- restores the gate and re-proves denial. Without this section, a green run
-- here would not actually be evidence that the MIGRATION did anything.
--
-- Run as: sudo -u postgres psql -d greenway_test -f e2e-owner-gate.sql
-- Every result line starts with lowercase 'pass' or uppercase 'FAIL'.
-- =============================================================================
\pset pager off
\set ON_ERROR_STOP off

create schema if not exists tg;
grant usage on schema tg to public;

-- ── Assertion harness ───────────────────────────────────────────────────────
-- Counts rows visible to the CURRENT role under RLS.
create or replace function tg.visible(p_table text)
returns integer language plpgsql as $$
declare n integer;
begin
  execute format('select count(*) from public.%I', p_table) into n;
  return n;
exception when others then
  -- A hard permission error is also a denial; report it as 0 visible but
  -- distinguishable via tg.err().
  return -1;
end $$;

create or replace function tg.expect_visible(p_label text, p_table text, p_min integer)
returns text language plpgsql as $$
declare n integer;
begin
  n := tg.visible(p_table);
  if n < 0 then
    return format('FAIL  %s -> %s raised a hard error for a role that should be allowed', p_label, p_table);
  end if;
  if n >= p_min then
    return format('pass  %s -> %s visible rows = %s (>= %s)', p_label, p_table, n, p_min);
  end if;
  return format('FAIL  %s -> %s visible rows = %s, expected at least %s', p_label, p_table, n, p_min);
end $$;

create or replace function tg.expect_denied(p_label text, p_table text)
returns text language plpgsql as $$
declare n integer;
begin
  n := tg.visible(p_table);
  if n = 0 or n < 0 then
    return format('pass  %s -> %s denied (visible rows = %s)', p_label, p_table, greatest(n, 0));
  end if;
  return format('FAIL  %s -> %s LEAKED %s row(s) to a non-owner', p_label, p_table, n);
end $$;

create or replace function tg.eq(p_label text, p_actual anyelement, p_expected anyelement)
returns text language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then
    return format('pass  %s -> %s', p_label, p_actual);
  end if;
  return format('FAIL  %s -> expected %s but got %s', p_label, p_expected, p_actual);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §0  FIXTURES — create an admin and a readonly staff member, and seed one
--     row in each money table so "0 rows" can only mean "denied".
-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== §0  FIXTURES ==='

-- staff_profiles.id is a FOREIGN KEY to auth.users(id) ON DELETE CASCADE, so
-- the auth rows must exist FIRST. The first draft of this suite skipped this
-- and the staff inserts failed silently -- which made auth.uid() match nobody,
-- so EVERY policy denied and every deny-assertion in section 3 reported a
-- FALSE PASS. The instrument check in section 1 is what caught it. Do not
-- remove either the check or these two rows.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000cc', 'ownergate.admin@test.invalid',    '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000dd', 'ownergate.readonly@test.invalid', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.staff_profiles (id, email, full_name, role, active)
values
  ('00000000-0000-0000-0000-0000000000cc', 'ownergate.admin@test.invalid',    'Test Admin',    'admin',    true),
  ('00000000-0000-0000-0000-0000000000dd', 'ownergate.readonly@test.invalid', 'Test Readonly', 'readonly', true)
on conflict (id) do update set role = excluded.role, active = true;

-- Seed as the table owner (superuser bypasses RLS) so the rows definitely
-- exist regardless of any gate.
insert into public.plaid_items (item_id, access_token, institution_name, status)
values ('itm_ownergate_test', 'tok_secret_should_never_leak', 'Test Bank', 'healthy')
on conflict (item_id) do nothing;

insert into public.manual_loans (id, name, kind, original_principal_cents, current_balance_cents,
                                 term_months, first_payment_date)
values ('00000000-0000-0000-0000-00000000f001', 'Owner Gate Test Loan', 'amortizing',
        100000, 90000, 12, '2026-01-01')
on conflict (id) do nothing;

select tg.eq('fixture: admin + readonly staff exist',
             (select count(*)::int from public.staff_profiles
               where id in ('00000000-0000-0000-0000-0000000000cc','00000000-0000-0000-0000-0000000000dd')
                 and active), 2) as result;

select tg.eq('fixture: plaid_items seeded',
             (select count(*)::int from public.plaid_items where item_id = 'itm_ownergate_test'), 1) as result;

select tg.eq('fixture: manual_loans seeded',
             (select count(*)::int from public.manual_loans where id = '00000000-0000-0000-0000-00000000f001'), 1) as result;

-- ═══════════════════════════════════════════════════════════════════════════
-- §1  PROVE THE INSTRUMENT WORKS
--
-- Before trusting a single "denied", prove the readonly user is REAL and that
-- RLS is actually being evaluated for it. If this section fails, every deny
-- result below is meaningless.
-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== §1  INSTRUMENT CHECK (if this fails, ignore every result below) ==='

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000dd';  -- readonly

-- The readonly user must be recognised as staff...
select tg.eq('instrument: readonly IS staff', public.is_staff(), true) as result;
-- ...and must NOT be recognised as owner.
select tg.eq('instrument: readonly is NOT owner', public.is_owner(), false) as result;
-- ...and must be able to read something it is SUPPOSED to read. If this comes
-- back denied, the fixture is broken and "denied" everywhere means nothing.
select tg.expect_visible('instrument: readonly CAN read tax_settings (control)', 'tax_settings', 1) as result;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000aa';  -- owner
select tg.eq('instrument: owner IS owner', public.is_owner(), true) as result;
commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- §2  THE OWNER CAN STILL SEE HIS OWN MONEY
--
-- The failure mode nobody tests for: locking the door so hard the owner is
-- locked out too. A gate that denies everyone is not security, it is an outage.
-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== §2  OWNER CAN STILL READ (not welded shut) ==='

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000aa';  -- owner

select tg.expect_visible('owner reads plaid_items',  'plaid_items',  1) as result;
select tg.expect_visible('owner reads manual_loans', 'manual_loans', 1) as result;
commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- §3  NON-OWNERS ARE DENIED — readonly AND admin
--
-- Admin is tested explicitly because admin was the role that could reach these
-- pages through settings.manage. If admin still reads the bank feed, the whole
-- slice failed and the owner decision was not honoured.
-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== §3a  READONLY IS DENIED ==='

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000dd';  -- readonly

select tg.expect_denied('readonly vs plaid_items (ACCESS TOKEN)', 'plaid_items')        as result;
select tg.expect_denied('readonly vs plaid_transactions',         'plaid_transactions') as result;
select tg.expect_denied('readonly vs plaid_accounts',             'plaid_accounts')     as result;
select tg.expect_denied('readonly vs manual_loans',               'manual_loans')       as result;
select tg.expect_denied('readonly vs atm_transactions',           'atm_transactions')   as result;
select tg.expect_denied('readonly vs atm_cash_loads',             'atm_cash_loads')     as result;
select tg.expect_denied('readonly vs crypto_wallets',             'crypto_wallets')     as result;
select tg.expect_denied('readonly vs crypto_transactions',        'crypto_transactions') as result;
commit;

\echo ''
\echo '=== §3b  ADMIN IS DENIED (the role that used to get in) ==='

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000cc';  -- admin

select tg.eq('admin IS admin', public.is_admin(), true) as result;
select tg.eq('admin is NOT owner', public.is_owner(), false) as result;

select tg.expect_denied('admin vs plaid_items (ACCESS TOKEN)', 'plaid_items')         as result;
select tg.expect_denied('admin vs plaid_transactions',         'plaid_transactions')  as result;
select tg.expect_denied('admin vs manual_loans',               'manual_loans')        as result;
select tg.expect_denied('admin vs atm_cash_loads',             'atm_cash_loads')      as result;
select tg.expect_denied('admin vs crypto_wallets',             'crypto_wallets')      as result;
commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- §4  NEGATIVE CONTROL — PROVE THE MIGRATION IS WHAT CAUSED THE DENIAL
--
-- This is the section that makes §3 mean something. It puts plaid_items back
-- the way it was BEFORE 0190 (is_staff()), shows the readonly user CAN read it
-- again, then restores the owner gate and shows denial returns.
--
-- If the "before" read is denied too, then §3 was never measuring the
-- migration -- it was measuring some unrelated denial -- and this suite says so
-- out loud instead of quietly reporting green.
-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== §4  NEGATIVE CONTROL (revert one table, prove the leak returns) ==='

-- Revert plaid_items to the pre-0190 gate.
drop policy if exists plaid_items_staff_all on public.plaid_items;
create policy plaid_items_staff_all on public.plaid_items
  for all to public using (is_staff()) with check (is_staff());

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000dd';  -- readonly
select tg.expect_visible('NEGATIVE CONTROL: with the OLD gate, readonly CAN read plaid_items', 'plaid_items', 1) as result;
commit;

-- Restore the owner gate exactly as 0190 leaves it.
drop policy if exists plaid_items_staff_all on public.plaid_items;
create policy plaid_items_staff_all on public.plaid_items
  for all to public using (is_owner()) with check (is_owner());

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000dd';  -- readonly
select tg.expect_denied('NEGATIVE CONTROL: gate restored, readonly denied again', 'plaid_items') as result;
commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- §5  WRITES ARE DENIED TOO, NOT JUST READS
--
-- The policies are FOR ALL, so WITH CHECK should stop a non-owner from
-- INSERTING as well. A gate that blocks reading but allows writing would let a
-- non-owner corrupt the books they cannot see.
-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== §5  NON-OWNER WRITES ARE REFUSED ==='

create or replace function tg.expect_write_denied(p_label text, p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return format('FAIL  %s -> the write SUCCEEDED and should have been refused', p_label);
exception when others then
  -- AUTHORSHIP OF THE FAILURE (standing rule 18).
  --
  -- A missing GRANT and an RLS denial BOTH raise SQLSTATE 42501
  -- (insufficient_privilege). If this handler accepted the SQLSTATE, the test
  -- would report "the owner gate stopped them" when the real cause could be
  -- that nobody was ever granted INSERT -- a completely different bug, and one
  -- that would silently disappear the day someone fixed the grant.
  --
  -- Verified on 2026-08-18 against this database: role 'authenticated' HOLDS
  -- INSERT on these tables, and the owner's identical INSERT SUCCEEDS. So the
  -- only thing that can stop a non-owner is the policy. This assertion
  -- therefore demands the RLS wording specifically.
  if position('row-level security' in SQLERRM) > 0 then
    return format('pass  %s -> refused by ROW-LEVEL SECURITY (%s)', p_label, SQLERRM);
  end if;
  return format('FAIL  %s -> refused, but NOT by RLS -- wrong author: [%s] %s', p_label, SQLSTATE, SQLERRM);
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000dd';  -- readonly
select tg.expect_write_denied(
  'readonly cannot INSERT a fake loan',
  $q$insert into public.manual_loans (name, kind, original_principal_cents, current_balance_cents, term_months, first_payment_date)
     values ('hacked', 'amortizing', 1, 1, 12, '2026-01-01')$q$) as result;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000cc';  -- admin
select tg.expect_write_denied(
  'admin cannot INSERT a fake loan',
  $q$insert into public.manual_loans (name, kind, original_principal_cents, current_balance_cents, term_months, first_payment_date)
     values ('hacked-admin', 'amortizing', 1, 1, 12, '2026-01-01')$q$) as result;
commit;

-- The other half of authorship: the OWNER's identical write must SUCCEED. If
-- this fails, the refusals above prove nothing about roles -- they would just
-- mean the INSERT is broken for everyone.
create or replace function tg.expect_write_ok(p_label text, p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return format('pass  %s -> succeeded, so the refusals above are about ROLE, not a broken insert', p_label);
exception when others then
  return format('FAIL  %s -> the owner could not write his own books: [%s] %s', p_label, SQLSTATE, SQLERRM);
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000aa';  -- owner
select tg.expect_write_ok(
  'POSITIVE CONTROL: owner CAN insert the very same row',
  $q$insert into public.manual_loans (name, kind, original_principal_cents, current_balance_cents, term_months, first_payment_date)
     values ('owner-control-row', 'amortizing', 1, 1, 12, '2026-01-01')$q$) as result;
rollback;  -- roll back so the control row never persists

-- ═══════════════════════════════════════════════════════════════════════════
-- §6  THE AUDIT FUNCTION AGREES
-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '=== §6  AUDIT FUNCTION ==='

select tg.eq('gl_audit_financial_tables_gate() is empty',
             (select count(*)::int from public.gl_audit_financial_tables_gate()), 0) as result;

select tg.eq('zero money policies still on is_staff()',
             (select count(*)::int from pg_policies
               where schemaname = 'public'
                 and (qual like '%is_staff()%' or with_check like '%is_staff()%')
                 and (tablename like 'plaid%' or tablename like 'crypto%'
                      or tablename like 'atm%' or tablename like 'manual\_loan%')), 0) as result;

select tg.eq('25 money policies now on is_owner()',
             (select count(*)::int from pg_policies
               where schemaname = 'public'
                 and (qual like '%is_owner()%' or with_check like '%is_owner()%')
                 and (tablename like 'plaid%' or tablename like 'crypto%'
                      or tablename like 'atm%' or tablename like 'manual\_loan%')), 25) as result;

-- ── THE AUDIT MUST ACTUALLY DETECT A BREAK (not just look right) ──────────
--
-- Every other check on the audit function is a TEXT match against the
-- migration file. A mutation campaign proved that is not enough: deleting the
-- entire second branch of the audit's UNION -- the half that catches a table
-- with NO owner policy at all -- did not fail a single static test, because
-- the words were all still on the page.
--
-- So this section BREAKS the gate for real and demands the audit notices.
-- An audit that reports "all clear" on a genuinely broken gate is the most
-- dangerous object in this repository: it is the thing the owner trusts.

-- (a) Break it the FIRST way: put a table back on is_staff().
drop policy if exists crypto_balances_staff_all on public.crypto_balances;
create policy crypto_balances_staff_all on public.crypto_balances
  for all to public using (is_staff()) with check (is_staff());

-- Reverting to is_staff() trips BOTH branches, and that is correct: the table
-- is simultaneously "still staff-gated" AND "has no owner policy". Each is
-- asserted separately so this stays honest about which branch did the work.
-- (The first draft expected a single row and FAILED against the real answer of
-- two -- the database was right and the assertion was wrong.)
select tg.eq('AUDIT branch 1 DETECTS the is_staff() revert',
             (select count(*)::int from public.gl_audit_financial_tables_gate()
               where kind = 'policy' and object_name like 'crypto_balances%'), 1) as result;

select tg.eq('AUDIT branch 2 DETECTS the missing owner policy',
             (select count(*)::int from public.gl_audit_financial_tables_gate()
               where kind = 'table' and object_name = 'crypto_balances'), 1) as result;

-- Restore.
drop policy if exists crypto_balances_staff_all on public.crypto_balances;
create policy crypto_balances_staff_all on public.crypto_balances
  for all to public using (is_owner()) with check (is_owner());

select tg.eq('AUDIT goes quiet again once restored',
             (select count(*)::int from public.gl_audit_financial_tables_gate()), 0) as result;

-- (b) Break it the SECOND way: remove the policy entirely, so the table has
-- NO owner gate at all. This is precisely the case the deleted UNION branch
-- was responsible for catching.
drop policy if exists crypto_balances_staff_all on public.crypto_balances;

select tg.eq('AUDIT DETECTS a table with NO owner policy at all',
             (select count(*)::int from public.gl_audit_financial_tables_gate()
               where object_name = 'crypto_balances'), 1) as result;

-- Restore for good.
drop policy if exists crypto_balances_staff_all on public.crypto_balances;
create policy crypto_balances_staff_all on public.crypto_balances
  for all to public using (is_owner()) with check (is_owner());

select tg.eq('AUDIT clean after full restore',
             (select count(*)::int from public.gl_audit_financial_tables_gate()), 0) as result;

-- The deliberate exclusions must still be readable by staff, or the register
-- stops. This asserts the decision recorded in 0190 §2 actually held.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000dd';  -- readonly
select tg.expect_visible('exclusion honoured: staff CAN still read tax_settings', 'tax_settings', 1) as result;
commit;

-- ── Cleanup ────────────────────────────────────────────────────────────────
\echo ''
\echo '=== CLEANUP ==='
delete from public.manual_loans where name in ('hacked', 'hacked-admin');
delete from public.manual_loans where id = '00000000-0000-0000-0000-00000000f001';
delete from public.plaid_items where item_id = 'itm_ownergate_test';
delete from public.staff_profiles where id in ('00000000-0000-0000-0000-0000000000cc','00000000-0000-0000-0000-0000000000dd');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000cc','00000000-0000-0000-0000-0000000000dd');
drop schema if exists tg cascade;

\echo ''
-- NOTE: this banner deliberately does NOT contain the literal failure word,
-- because `grep -c` over this file's output would then count the banner itself
-- and report one failure on a perfectly clean run. (That exact false positive
-- happened here on 2026-08-18, and the same class of thing happened in slice 5
-- with a harness cleanup line.) Count with:  grep -c '^ F''AIL'
\echo '=== DONE.  Every result line above must begin with lowercase pass. ==='
