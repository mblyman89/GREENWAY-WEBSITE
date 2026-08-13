-- scripts/accounting/coa-schema-tests.sql
-- =============================================================================
-- ADVERSARIAL SUITE FOR MIGRATION 0173 (chart of accounts). NOT A MIGRATION.
-- =============================================================================
-- Owner directive: "Battle test it before shipping it. Real world tests from now
-- on. Try your absolute hardest to break it. Break it like a pro would try and
-- break it."
--
-- So this file does not check that the chart LOOKS right. It replays the exact
-- ways Michael's real books were actually broken over twelve years, using the
-- real numbers out of his own Sage exports, and asserts the database now refuses
-- them BY SPECIFIC ERROR CODE. Asserting merely "something threw" is worthless:
-- a typo in a test also throws.
--
-- STRUCTURE: the whole suite runs in ONE transaction that is rolled back at the
-- end, so it leaves the database exactly as it found it. Each attack sits
-- between psql-level SAVEPOINTs so one attack cannot contaminate the next.
-- (SAVEPOINT is deliberately NOT used inside the DO blocks -- PL/pgSQL has no
-- savepoint statement, and pretending otherwise is a syntax error.)
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- --- test scaffolding --------------------------------------------------------
-- Asserts that a statement fails with a specific error TEXT fragment. If it
-- succeeds, that is a failure. If it fails with a DIFFERENT error, that is also
-- a failure -- otherwise a test could "pass" because of a typo in itself.
create or replace function pg_temp.expect_error(
  p_sql        text,
  p_fragment   text,
  p_label      text
) returns void language plpgsql as $$
declare
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := SQLERRM;
    if position(p_fragment in v_msg) = 0 then
      raise exception 'FAIL [%]: expected error containing "%", got "%"', p_label, p_fragment, v_msg;
    end if;
    raise notice '  pass: % (refused: %)', p_label, p_fragment;
    return;
  end;
  raise exception 'FAIL [%]: statement was ACCEPTED but should have been refused. SQL: %', p_label, p_sql;
end $$;

-- Asserts a statement SUCCEEDS. Guards against a suite that "passes" because
-- everything is broken and every single write fails.
create or replace function pg_temp.expect_ok(
  p_sql text, p_label text
) returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice '  pass: % (accepted, as it should be)', p_label;
exception when others then
  raise exception 'FAIL [%]: statement was REFUSED but should have been accepted: % | SQL: %', p_label, SQLERRM, p_sql;
end $$;

-- Builds a draft journal and returns its id.
create or replace function pg_temp.mk_journal(
  p_entity text default 'greenway',
  p_date   date default date '2026-03-15',
  p_memo   text default 'battle test journal',
  p_source text default 'manual'
) returns uuid language plpgsql as $$
declare v_id uuid; v_entity uuid;
begin
  select id into v_entity from public.gl_entities where code = p_entity;
  insert into public.gl_journals (entity_id, journal_date, memo, source_kind)
  values (v_entity, p_date, p_memo, p_source)
  returning id into v_id;
  return v_id;
end $$;

-- Adds a line by ACCOUNT CODE, so tests read the way the books read.
create or replace function pg_temp.add_line(
  p_journal uuid, p_line int, p_code text, p_cents bigint,
  p_cost_class text default 'none', p_entity text default 'greenway'
) returns void language plpgsql as $$
declare v_acct uuid; v_entity uuid;
begin
  select id into v_acct from public.gl_accounts where code = p_code;
  if v_acct is null then
    raise exception 'test bug: no account with code %', p_code;
  end if;
  select id into v_entity from public.gl_entities where code = p_entity;
  insert into public.gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (p_journal, p_line, v_acct, v_entity, p_cents, p_cost_class);
end $$;

-- Looks up an account id BY CODE and refuses to return NULL.
-- Without this, a test that referenced a code which does not exist would quietly
-- pass NULL into the statement under test and "pass" for the wrong reason. A
-- test that can lie is worse than no test at all.
create or replace function pg_temp.acct(p_code text) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from public.gl_accounts where code = p_code;
  if v is null then
    raise exception 'test bug: no account with code % exists in the seeded chart', p_code;
  end if;
  return v;
end $$;

-- A stable admin user id for "who decided this" fields.
create or replace function pg_temp.admin_id() returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from auth.users where email = 'battletest@example.com';
  if v is null then
    insert into auth.users (email) values ('battletest@example.com') returning id into v;
  end if;
  return v;
end $$;


-- =============================================================================
\echo ''
\echo '=== ATTACK 1: THE $4,624,697.31 PLUG =============================='
\echo 'The single number that hid twelve years of drift. Replayed exactly.'
savepoint s1;
do $$
declare v_j uuid;
begin
  -- The real plug, in integer cents, from "20009 LAZY INVENTORY ENTRY".
  -- If the new chart accepts this, F2 has failed and nothing else matters.
  --
  -- Note the entry cannot even be WRITTEN, let alone posted: the inventory guard
  -- fires on the line insert. The bad number never reaches the books at all,
  -- which is the difference between a rule and a review.
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'lazy inventory entry');
  perform pg_temp.expect_error(
    format('select pg_temp.add_line(%L::uuid, 1, ''20000'', 462469731)', v_j),
    'GL_INVENTORY_MANUAL',
    'the $4,624,697.31 plug straight into inventory control');
end $$;
rollback to savepoint s1;

-- Michael's ACTUAL manoeuvre, replayed literally: "I debited a/p and credited
-- revenue." Both legs are now refused, and it is worth seeing which leg trips
-- first -- A/P is itself a control account, so the entry cannot even be typed.
savepoint s1b;
do $$
declare v_j uuid;
begin
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'zero out the payables');
  perform pg_temp.add_line(v_j, 1, '30000',  462469731);   -- debit A/P
  perform pg_temp.add_line(v_j, 2, '50010', -462469731);   -- credit revenue
  perform pg_temp.expect_error(
    format('select public.gl_post_journal(%L::uuid)', v_j),
    'GL_CONTROL_ACCOUNT',
    'debit A/P and credit revenue (the twelve-year excise workaround)');
end $$;
rollback to savepoint s1b;

-- The same plug, hunting for a back door: try EVERY category account by hand. A
-- determined user (or a buggy importer) will not stop at the obvious account, so
-- neither do we. Every one must be refused for a manual entry, because manual
-- typing into inventory is exactly how the original hole was dug.
savepoint s2;
do $$
declare v_j uuid; v_cat record; v_n int := 0;
begin
  for v_cat in
    select code, category_slug from public.gl_accounts
    where code like '2%' and category_slug is not null order by code
  loop
    v_j := pg_temp.mk_journal('greenway', date '2026-03-15',
             'plug attempt into ' || v_cat.category_slug, 'manual');
    perform pg_temp.expect_error(
      format('select pg_temp.add_line(%L::uuid, 1, %L, 462469731)', v_j, v_cat.code),
      'GL_INVENTORY_MANUAL',
      format('a hand-typed plug into %s', v_cat.category_slug));
    v_n := v_n + 1;
  end loop;
  raise notice '  pass: all % inventory categories refuse hand-typed entries', v_n;
end $$;
rollback to savepoint s2;

-- ...but the LAWFUL path must still work, or the business stops. A journal
-- sourced from the inventory subledger (a real, evidenced intake) posts.
savepoint s2b;
do $$
declare v_j uuid;
begin
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15',
           'receive lot from licensed producer', 'purchase');
  perform pg_temp.add_line(v_j, 1, '20010',  100000);
  perform pg_temp.add_line(v_j, 2, '30000', -100000);
  perform pg_temp.expect_ok(format('select public.gl_post_journal(%L::uuid)', v_j),
    'a real evidenced intake posting through the purchase subledger');
end $$;
rollback to savepoint s2b;


\echo ''
\echo '=== ATTACK 2: EXCISE AS REVENUE (RCW 69.50.535(4)) ================'
\echo 'The exact mechanism Michael described: debit A/P, credit REVENUE.'
savepoint s3;
do $$
begin
  -- 2a. Excise is trust money, so it cannot be an income account at all.
  --     Try to recreate the old "50009 EXCISE TAX ADJUSTMENTS".
  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('50009', 'EXCISE TAX ADJUSTMENTS', 'liability', 'credit')
  $q$, 'gl_accounts_block_type_chk',
  'a liability wearing a revenue code (50009)');

  -- 2b. And the reverse: revenue cannot hide in the liability block either.
  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('32900', 'Excise recovered (income)', 'income', 'credit')
  $q$, 'gl_accounts_block_type_chk',
  'revenue hiding in the liability block');
end $$;
rollback to savepoint s3;

-- 2c. The lawful path must still work. A system that only says "no" is useless.
savepoint s4;
do $$
declare v_j uuid;
begin
  -- Sourced from the excise subledger, because both legs are control accounts:
  -- the bank feed and the trust liability. That is the designed path.
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'pay excise to LCB', 'excise');
  perform pg_temp.add_line(v_j, 1, '32000',  150000000);  -- debit excise payable
  perform pg_temp.add_line(v_j, 2, '10200', -150000000);  -- credit bank
  perform pg_temp.expect_ok(format('select public.gl_post_journal(%L::uuid)', v_j),
    'paying the 37% excise out of the trust liability');
end $$;
rollback to savepoint s4;


\echo ''
\echo '=== ATTACK 3: 280E DISCIPLINE ====================================='
savepoint s5;
do $$
declare v_j uuid; v_code text;
begin
  -- 3a. An expense that requires a cost class must not post without one.
  select code into v_code from public.gl_accounts
   where type = 'expense' and requires_cost_class and code like '7%' limit 1;
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'expense with no 280E class');
  perform pg_temp.add_line(v_j, 1, v_code, 10000, 'none');
  perform pg_temp.add_line(v_j, 2, '35000', -10000);   -- accrued liability, not a control account
  perform pg_temp.expect_error(format('select public.gl_post_journal(%L::uuid)', v_j),
    'GL_COST_CLASS_REQUIRED', 'a deductible expense with no 280E character');
end $$;
rollback to savepoint s5;

savepoint s6;
do $$
declare v_j uuid;
begin
  -- 3b. A balance-sheet line must NOT carry a cost class. 280E is about the
  --     character of a DEDUCTION; an asset balance is not a deduction.
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'asset wearing a cost class');
  perform pg_temp.add_line(v_j, 1, '10100',  10000, 'cogs_direct');  -- vault cash
  perform pg_temp.add_line(v_j, 2, '10110', -10000);                 -- till cash
  perform pg_temp.expect_error(format('select public.gl_post_journal(%L::uuid)', v_j),
    'GL_COST_CLASS_NOT_ALLOWED', 'a bank account tagged as cost of goods sold');
end $$;
rollback to savepoint s6;

savepoint s7;
do $$
begin
  -- 3c. No COGS account may be declared non-deductible. A cost disallowed by
  --     280E is by definition not cost of goods sold; letting both be true of
  --     one account is how a 280E audit becomes unwinnable.
  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance,
                                    requires_cost_class, default_cost_class)
    values ('69999', 'Advertising (as COGS)', 'cogs', 'debit', true, 'nondeductible_280e')
  $q$, 'gl_accounts_cogs_cost_class_chk',
  'a COGS account declared non-deductible under 280E');
end $$;
rollback to savepoint s7;


\echo ''
\echo '=== ATTACK 4: THE GRWNY TYPO (18 live accounts, silently dropped) =='
savepoint s8;
do $$
begin
  -- The real bug: 18 accounts were tagged "GRWNY", a typo of "GRNWY", and the
  -- entire payroll-expense block silently vanished from suffix-filtered reports.
  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance, allowed_entity_codes)
    values ('79998', 'Payroll (typo entity)', 'expense', 'debit', array['GRWNY'])
  $q$, 'GL_ENTITY_UNKNOWN',
  'an account restricted to the misspelled entity GRWNY');

  -- An empty list is not "no restriction" -- it forbids every entity, which
  -- hides the account from everything. That must be refused too.
  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance, allowed_entity_codes)
    values ('79996', 'Forbidden everywhere', 'expense', 'debit', array[]::text[])
  $q$, 'GL_ENTITY_UNKNOWN',
  'an empty entity restriction that would hide the account from every report');

  -- The correct spelling must of course still work.
  perform pg_temp.expect_ok($q$
    insert into public.gl_accounts (code, name, type, normal_balance,
                                    allowed_entity_codes, requires_cost_class, default_cost_class)
    values ('79995', 'Payroll (correct entity)', 'expense', 'debit',
            array['greenway'], true, 'cogs_allocable')
  $q$, 'the correctly spelled entity restriction');
end $$;
rollback to savepoint s8;


\echo ''
\echo '=== ATTACK 5: FORCED AUTO-POST AT 100% CONFIDENCE ================='
\echo 'Owner directive: gate everything, block everything.'
savepoint s9;
do $$
declare v_j uuid; v_acct uuid;
begin
  -- 5a. A draft suggestion may not carry a journal, no matter how confident.
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'auto post attempt');
  v_acct := pg_temp.acct('71010');
  perform pg_temp.expect_error(format($q$
    insert into public.gl_classification_suggestions
      (plaid_transaction_id, suggested_account_id, confidence_milli_pct, status, journal_id)
    values ('txn_forced_1', %L::uuid, 100000, 'draft', %L::uuid)
  $q$, v_acct, v_j), 'GL_NOT_APPROVED',
  'a 100%-confidence draft trying to attach itself to a journal');

  -- 5b. Approval requires a NAMED human and a timestamp.
  perform pg_temp.expect_error(format($q$
    insert into public.gl_classification_suggestions
      (plaid_transaction_id, suggested_account_id, confidence_milli_pct, status)
    values ('txn_forced_2', %L::uuid, 100000, 'approved')
  $q$, v_acct), 'GL_DECISION_REQUIRED',
  'an approval with nobody''s name on it');

  -- 5c. No suggestion may target a control account, at ANY confidence.
  v_acct := pg_temp.acct('20000');
  perform pg_temp.expect_error(format($q$
    insert into public.gl_classification_suggestions
      (plaid_transaction_id, suggested_account_id, confidence_milli_pct, status)
    values ('txn_forced_3', %L::uuid, 100000, 'draft')
  $q$, v_acct), 'GL_CONTROL_ACCOUNT',
  'a 100%-confidence suggestion aimed at inventory control');

  -- 5d. Nor may a learned RULE target a control account.
  perform pg_temp.expect_error(format($q$
    insert into public.gl_account_rules (match_kind, match_value, account_id)
    values ('merchant_exact', 'CLARITY FARMS', %L::uuid)
  $q$, v_acct), 'GL_CONTROL_ACCOUNT',
  'a permanent rule aimed at inventory control');
end $$;
rollback to savepoint s9;

savepoint s10;
do $$
declare v_acct uuid; v_admin uuid;
begin
  -- 5e. The lawful path: draft -> owner approves -> journal may attach.
  v_acct := pg_temp.acct('71010');
  v_admin := pg_temp.admin_id();

  perform pg_temp.expect_ok(format($q$
    insert into public.gl_classification_suggestions
      (plaid_transaction_id, suggested_account_id, confidence_milli_pct, status)
    values ('txn_lawful', %L::uuid, 92000, 'draft')
  $q$, v_acct), 'a high-confidence draft awaiting the owner');

  perform pg_temp.expect_ok(format($q$
    update public.gl_classification_suggestions
       set status = 'approved', decided_by = %L::uuid, decided_at = now()
     where plaid_transaction_id = 'txn_lawful'
  $q$, v_admin), 'the owner approving that draft by name');
end $$;
rollback to savepoint s10;

savepoint s11;
do $$
declare v_acct uuid; v_admin uuid;
begin
  -- 5f. History is unlimited: a transaction may be rejected more than once.
  --     This is the bug the original unique(txn, status) constraint would have
  --     shipped: the SECOND rejection for a charge would have failed.
  v_acct := pg_temp.acct('71010');
  v_admin := pg_temp.admin_id();

  execute format($q$
    insert into public.gl_classification_suggestions
      (plaid_transaction_id, suggested_account_id, status, decided_by, decided_at)
    values ('txn_repeat', %L::uuid, 'rejected', %L::uuid, now())
  $q$, v_acct, v_admin);

  perform pg_temp.expect_ok(format($q$
    insert into public.gl_classification_suggestions
      (plaid_transaction_id, suggested_account_id, status, decided_by, decided_at)
    values ('txn_repeat', %L::uuid, 'rejected', %L::uuid, now())
  $q$, v_acct, v_admin), 'rejecting a second guess for the same charge');

  -- But only ONE live draft may exist per transaction.
  execute format($q$
    insert into public.gl_classification_suggestions
      (plaid_transaction_id, suggested_account_id, status)
    values ('txn_one_draft', %L::uuid, 'draft')
  $q$, v_acct);

  perform pg_temp.expect_error(format($q$
    insert into public.gl_classification_suggestions
      (plaid_transaction_id, suggested_account_id, status)
    values ('txn_one_draft', %L::uuid, 'draft')
  $q$, v_acct), 'gl_class_sugg_one_draft_idx',
  'two competing live drafts for one bank transaction');
end $$;
rollback to savepoint s11;


\echo ''
\echo '=== ATTACK 6: THE SELF-INVENTING CHART ============================'
savepoint s12;
do $$
declare v_acct uuid;
begin
  v_acct := pg_temp.acct('71010');

  -- 6a. A proposal may not quietly become an account.
  perform pg_temp.expect_error(format($q$
    insert into public.gl_account_proposals
      (proposed_code, proposed_name, proposed_type, rationale, created_account_id)
    values ('70999', 'Invented By Machine', 'expense',
            'saw three charges from a new vendor', %L::uuid)
  $q$, v_acct), 'GL_NOT_APPROVED',
  'a proposal claiming an account before anyone approved it');

  -- 6b. A proposal must be justified. No rationale, no account.
  perform pg_temp.expect_error($q$
    insert into public.gl_account_proposals
      (proposed_code, proposed_name, proposed_type, rationale)
    values ('70998', 'Mystery', 'expense', 'idk')
  $q$, 'gl_account_proposals_rationale_check',
  'an account nobody can justify');

  -- 6c. A proposal cannot violate the block firewall either.
  perform pg_temp.expect_error($q$
    insert into public.gl_account_proposals
      (proposed_code, proposed_name, proposed_type, rationale)
    values ('50998', 'Excise clearing', 'liability',
            'the machine wants somewhere to dump the excise true-up')
  $q$, 'GL_ACCOUNT_BLOCK',
  'a proposal smuggling a liability into the revenue block');

  -- 6d. A proposal cannot squat on an existing code.
  perform pg_temp.expect_error($q$
    insert into public.gl_account_proposals
      (proposed_code, proposed_name, proposed_type, rationale)
    values ('71010', 'Duplicate payroll', 'expense',
            'the machine did not check whether this already existed')
  $q$, 'GL_ACCOUNT_EXISTS',
  'a proposal duplicating a live account code');
end $$;
rollback to savepoint s12;


\echo ''
\echo '=== ATTACK 7: RENUMBERING A LIVE CHART ============================'
savepoint s13;
do $$
declare v_j uuid;
begin
  -- Deloitte's rule: never renumber a live chart. Post history, then try.
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'establish history', 'purchase');
  perform pg_temp.add_line(v_j, 1, '20010',  50000);
  perform pg_temp.add_line(v_j, 2, '30000', -50000);
  perform public.gl_post_journal(v_j);

  perform pg_temp.expect_error($q$
    update public.gl_accounts set code = '20011' where code = '20010'
  $q$, 'GL_ACCOUNT_IMMUTABLE',
  'renumbering an account that already has posted history');

  perform pg_temp.expect_error($q$
    delete from public.gl_accounts where code = '20010'
  $q$, 'GL_ACCOUNT_IN_USE',
  'deleting an account that already has posted history');

  -- Retiring it is the correct move, and must work.
  perform pg_temp.expect_ok($q$
    update public.gl_accounts set active = false where code = '20010'
  $q$, 'retiring that account instead (the correct move)');
end $$;
rollback to savepoint s13;

savepoint s14;
do $$
begin
  -- A system account is structural and may never be deleted.
  perform pg_temp.expect_error($q$
    delete from public.gl_accounts where code = '20000'
  $q$, 'GL_ACCOUNT_IMMUTABLE',
  'deleting the inventory control account');
end $$;
rollback to savepoint s14;


\echo ''
\echo '=== ATTACK 8: MALFORMED AND HOSTILE ACCOUNT CODES ================='
savepoint s15;
do $$
begin
  -- NOTE ON ASSERTIONS: a code like '01000' or '1O000' violates BOTH the shape
  -- check and the block/type firewall (block '0' and block 'O' permit nothing).
  -- PostgreSQL reports whichever constraint it evaluates first, and that order
  -- is not contractual. So these two assert "violates check constraint" -- the
  -- guarantee that matters is that the row is refused. Where exactly one guard
  -- can fire, the tests below name it precisely.
  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('01000', 'Leading zero', 'asset', 'debit')
  $q$, 'violates check constraint', 'a leading-zero code (01000)');

  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('1000', 'Too short', 'asset', 'debit')
  $q$, 'gl_accounts_code_shape_chk', 'a four-digit code');

  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('100000', 'Too long', 'asset', 'debit')
  $q$, 'gl_accounts_code_shape_chk', 'a six-digit code');

  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('10009-GRNWY', 'Sage style', 'asset', 'debit')
  $q$, 'gl_accounts_code_shape_chk', 'the old Sage entity-suffixed code style');

  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('1O000', 'Letter O for zero', 'asset', 'debit')
  $q$, 'violates check constraint', 'letter O masquerading as a zero');
end $$;
rollback to savepoint s15;

-- SQL injection, kept separate: the payload must be stored as inert TEXT and
-- refused by the shape check, and the tables must all still be standing.
savepoint s16;
do $$
declare v_n int;
begin
  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('1000''); drop table public.gl_journals; --', 'Injection', 'asset', 'debit')
  $q$, 'gl_accounts_code_shape_chk', 'a SQL-injection-shaped account code');

  select count(*) into v_n from public.gl_journals;
  raise notice '  pass: gl_journals still exists after the injection attempt';
end $$;
rollback to savepoint s16;


\echo ''
\echo '=== ATTACK 9: BROKEN HIERARCHY ===================================='
savepoint s17;
do $$
begin
  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance, parent_code)
    values ('70997', 'Expense under an asset', 'expense', 'debit', '10000')
  $q$, 'GL_ACCOUNT_PARENT',
  'an expense rolling up into a cash parent');

  perform pg_temp.expect_error($q$
    update public.gl_accounts set parent_code = code where code = '20010'
  $q$, 'GL_ACCOUNT_PARENT',
  'an account adopting itself as its own parent');
end $$;
rollback to savepoint s17;


\echo ''
\echo '=== ATTACK 10: THE FULL SWEEP -- BUY, SELL, RECONCILE ============='
\echo 'Every one of the 21 categories, end to end, to the cent.'
savepoint s18;
do $$
declare v_j uuid; v_cat record; v_n int := 0; v_sum bigint;
begin
  -- Proves the mirror WORKS, not merely that the accounts exist: buy into each
  -- inventory category, sell it, relieve COGS, and confirm margin by category is
  -- a subtraction with no residue anywhere.
  for v_cat in
    select i.code as inv_code, i.category_slug,
           '5' || right(i.code, 4) as rev_code,
           '6' || right(i.code, 4) as cogs_code
    from public.gl_accounts i
    where i.code like '2%' and i.category_slug is not null
    order by i.code
  loop
    -- Buy 1,000.00 of stock on account.
    v_j := pg_temp.mk_journal('greenway', date '2026-04-10',
             'purchase ' || v_cat.category_slug, 'purchase');
    perform pg_temp.add_line(v_j, 1, v_cat.inv_code,  100000);
    perform pg_temp.add_line(v_j, 2, '30000',        -100000);
    perform public.gl_post_journal(v_j);

    -- Sell it for 1,800.00 cash, and relieve inventory into COGS.
    v_j := pg_temp.mk_journal('greenway', date '2026-04-11',
             'sale of ' || v_cat.category_slug, 'pos_sale');
    perform pg_temp.add_line(v_j, 1, '10200',         180000);
    perform pg_temp.add_line(v_j, 2, v_cat.rev_code, -180000);
    perform pg_temp.add_line(v_j, 3, v_cat.cogs_code, 100000, 'cogs_direct');
    perform pg_temp.add_line(v_j, 4, v_cat.inv_code, -100000);
    perform public.gl_post_journal(v_j);

    v_n := v_n + 1;
  end loop;

  -- Inventory must be flat: everything bought was sold.
  select coalesce(sum(l.amount_cents), 0) into v_sum
  from public.gl_journal_lines l
  join public.gl_accounts a on a.id = l.account_id
  join public.gl_journals j on j.id = l.journal_id
  where a.code like '2%' and a.category_slug is not null and j.status = 'posted';
  if v_sum <> 0 then
    raise exception 'FAIL: inventory did not return to zero after the sweep: % cents', v_sum;
  end if;

  -- Margin must be exactly 800.00 per category, by subtraction: no allocation
  -- step, no spreadsheet, no month-end project.
  select count(*) into v_n
  from (
    select a.category_slug,
           -sum(case when a.type = 'income' then l.amount_cents else 0 end)
           - sum(case when a.type = 'cogs' then l.amount_cents else 0 end) as margin
    from public.gl_journal_lines l
    join public.gl_accounts a on a.id = l.account_id
    join public.gl_journals j on j.id = l.journal_id
    where j.status = 'posted' and a.category_slug is not null
      and a.type in ('income','cogs')
    group by a.category_slug
  ) m
  where m.margin <> 80000;
  if v_n <> 0 then
    raise exception 'FAIL: % categories reported the wrong margin', v_n;
  end if;

  select count(distinct a.category_slug) into v_n
  from public.gl_journal_lines l
  join public.gl_accounts a on a.id = l.account_id
  where a.category_slug is not null and a.type = 'income';
  raise notice '  pass: % categories swept buy->sell->reconcile; margin exact to the cent', v_n;

  -- And the whole ledger must still balance across every posted line.
  select coalesce(sum(amount_cents), 0) into v_sum
  from public.gl_journal_lines l
  join public.gl_journals j on j.id = l.journal_id where j.status = 'posted';
  if v_sum <> 0 then
    raise exception 'FAIL: the ledger as a whole is out of balance by % cents', v_sum;
  end if;
  raise notice '  pass: entire ledger sums to exactly zero after the sweep';
end $$;
rollback to savepoint s18;


\echo ''
\echo '=== ATTACK 11: THE OCTOBER 31 2026 CUT-OVER ======================='
\echo 'Michael moved cut-over from January to October 31, 2026.'
savepoint s19;
do $$
declare v_j uuid;
begin
  -- 0172 hard-codes a "line in the sand" CHECK. Does it block the real
  -- cut-over date? Asserted, never assumed.
  v_j := pg_temp.mk_journal('greenway', date '2026-10-31', 'cut-over day entry', 'bank');
  perform pg_temp.add_line(v_j, 1, '10200',  100000);
  perform pg_temp.add_line(v_j, 2, '40000', -100000);
  perform pg_temp.expect_ok(format('select public.gl_post_journal(%L::uuid)', v_j),
    'posting ON the October 31, 2026 cut-over date');
end $$;
rollback to savepoint s19;

savepoint s20;
do $$
declare v_j uuid;
begin
  v_j := pg_temp.mk_journal('greenway', date '2026-11-01', 'day after cut-over', 'bank');
  perform pg_temp.add_line(v_j, 1, '10200',  100000);
  perform pg_temp.add_line(v_j, 2, '40000', -100000);
  perform pg_temp.expect_ok(format('select public.gl_post_journal(%L::uuid)', v_j),
    'posting the day AFTER cut-over');
end $$;
rollback to savepoint s20;

savepoint s21;
do $$
begin
  -- History before the line in the sand must still be refused.
  perform pg_temp.expect_error($q$
    insert into public.gl_journals (entity_id, journal_date, memo, source_kind)
    select id, date '2019-06-01', 'backdated into the Sage years', 'manual'
    from public.gl_entities where code = 'greenway'
  $q$, 'gl_journals_line_in_the_sand',
  'backdating an entry into the twelve broken years');
end $$;
rollback to savepoint s21;


\echo ''
\echo '=== ATTACK 12: OUT-OF-BALANCE AND SINGLE-SIDED ENTRIES ============'
savepoint s22;
do $$
declare v_j uuid;
begin
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'one penny out');
  perform pg_temp.add_line(v_j, 1, '10100',  100000);   -- vault cash (postable)
  perform pg_temp.add_line(v_j, 2, '40000',  -99999);
  perform pg_temp.expect_error(format('select public.gl_post_journal(%L::uuid)', v_j),
    'GL_OUT_OF_BALANCE', 'an entry out of balance by a single penny');
end $$;
rollback to savepoint s22;

savepoint s23;
do $$
declare v_j uuid;
begin
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'single sided entry');
  perform pg_temp.add_line(v_j, 1, '10100', 100000);
  perform pg_temp.expect_error(format('select public.gl_post_journal(%L::uuid)', v_j),
    'GL_TOO_FEW_LINES', 'a one-sided entry pretending to be double-entry');
end $$;
rollback to savepoint s23;


\echo ''
\echo '=== ATTACK 13: POSTED HISTORY IS IMMUTABLE (ASC 250) =============='
savepoint s24;
do $$
declare v_j uuid;
begin
  v_j := pg_temp.mk_journal('greenway', date '2026-03-15', 'to be tampered with');
  perform pg_temp.add_line(v_j, 1, '10100',  100000);
  perform pg_temp.add_line(v_j, 2, '40000', -100000);
  perform public.gl_post_journal(v_j);

  perform pg_temp.expect_error(
    format('update public.gl_journal_lines set amount_cents = 999 where journal_id = %L::uuid', v_j),
    'GL_IMMUTABLE', 'editing the amount on a posted entry');

  perform pg_temp.expect_error(
    format('delete from public.gl_journals where id = %L::uuid', v_j),
    'GL_IMMUTABLE', 'deleting a posted journal outright');
end $$;
rollback to savepoint s24;


\echo ''
\echo '=== ATTACK 14: HOSTILE TEXT INPUT ================================='
savepoint s25;
do $$
declare v_n int;
begin
  -- A 10,000-character name must not silently truncate into an unreadable chart.
  perform pg_temp.expect_ok(format($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('79990', %L, 'expense', 'debit')
  $q$, repeat('A', 10000)), 'a 10,000-character account name');

  select length(name) into v_n from public.gl_accounts where code = '79990';
  if v_n <> 10000 then
    raise exception 'FAIL: account name was silently truncated to % chars', v_n;
  end if;
  raise notice '  pass: stored whole (% chars), not silently truncated', v_n;

  -- Unicode, emoji and RTL text must survive a round trip intact.
  perform pg_temp.expect_ok($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('79991', 'Café ☕ Ünïcode — عربى 中文', 'expense', 'debit')
  $q$, 'unicode, emoji and RTL text in an account name');

  select count(*) into v_n from public.gl_accounts
   where code = '79991' and name = 'Café ☕ Ünïcode — عربى 中文';
  if v_n <> 1 then
    raise exception 'FAIL: unicode account name did not survive the round trip';
  end if;
  raise notice '  pass: unicode survived the round trip byte for byte';

  -- An empty or whitespace-only name is not a name.
  perform pg_temp.expect_error($q$
    insert into public.gl_accounts (code, name, type, normal_balance)
    values ('79992', '   ', 'expense', 'debit')
  $q$, 'gl_accounts_name_not_blank_chk', 'a whitespace-only account name');
end $$;
rollback to savepoint s25;


\echo ''
\echo '=== ATTACK 15: THE MIGRATION MAP =================================='
savepoint s26;
do $$
begin
  -- Every old Sage account must land somewhere deliberate. A map entry pointing
  -- nowhere is how a balance quietly evaporates during cut-over.
  perform pg_temp.expect_error($q$
    insert into public.gl_account_migration_map
      (old_code, old_name, new_code, disposition, rationale)
    values ('99999-GRNWY', 'Ghost account', '79997', 'rename',
            'target code was mistyped and never existed')
  $q$, 'GL_MAP_TARGET',
  'a migration mapping pointing at an account that does not exist');

  -- Moving a real balance requires a named approver. Nobody's balance moves
  -- because a script felt like it.
  perform pg_temp.expect_error($q$
    insert into public.gl_account_migration_map
      (old_code, old_name, new_code, disposition, rationale, carries_balance)
    values ('20009-GRNWY', 'LAZY INVENTORY ENTRY', '20890', 'rename',
            'the plug account is quarantined pending the October 31 count', true)
  $q$, 'GL_APPROVAL_REQUIRED',
  'carrying a balance forward with nobody approving it');

  -- A mapping that moves nothing needs no approval, and must work.
  perform pg_temp.expect_ok($q$
    insert into public.gl_account_migration_map
      (old_code, old_name, new_code, disposition, rationale)
    values ('20009-TEST', 'LAZY INVENTORY ENTRY', '20890', 'rename',
            'quarantined; balance to be re-derived from the physical count')
  $q$, 'a mapping that carries no balance forward');
end $$;
rollback to savepoint s26;


\echo ''
\echo '=================================================================='
\echo 'ALL ATTACKS REPELLED.'
\echo '=================================================================='

rollback;
