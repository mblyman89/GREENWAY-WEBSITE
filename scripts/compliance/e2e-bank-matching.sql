-- =============================================================================
-- SLICE 5 — END-TO-END + ADVERSARIAL SUITE, WITH REAL ASSERTIONS
--
-- WHY THIS FILE LOOKS DIFFERENT FROM THE LAST ONE
-- -----------------------------------------------
-- The first draft of this suite "passed" two steps that were actually broken:
-- the direct-INSERT attacks failed with a NOT-NULL error on journal_id, never
-- reaching the sign-wall CHECK they were written to prove. A test that fails
-- for the wrong reason is worse than no test, because it reports green.
--
-- So every refusal below asserts the EXACT error code. If the statement
-- succeeds -> FAIL. If it fails with a DIFFERENT code -> FAIL, and the actual
-- code is printed. Only the right refusal for the right reason is a PASS.
--
-- Every account code was READ OUT OF public.gl_accounts first:
--   10200  Bank — Operating           asset,   debit, control(cash), all entities
--   76020  Packaging & Store Supplies expense, debit, requires cost class
-- Nothing here is invented.
-- =============================================================================
\pset pager off
\set ON_ERROR_STOP off

-- ── A tiny assertion harness ────────────────────────────────────────────────
create schema if not exists t;

create or replace function t.expect_fail(p_label text, p_sql text, p_expect text)
returns text language plpgsql as $$
declare v_err text;
begin
  execute p_sql;
  return format('FAIL  %s -> statement SUCCEEDED but should have been refused with %s', p_label, p_expect);
exception when others then
  v_err := SQLERRM;
  if position(p_expect in v_err) > 0 then
    return format('pass  %s -> %s', p_label, p_expect);
  end if;
  return format('FAIL  %s -> expected %s but got: %s', p_label, p_expect, v_err);
end $$;

create or replace function t.expect_ok(p_label text, p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return format('pass  %s -> succeeded as expected', p_label);
exception when others then
  return format('FAIL  %s -> should have succeeded but got: %s', p_label, SQLERRM);
end $$;

create or replace function t.eq(p_label text, p_actual anyelement, p_expected anyelement)
returns text language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then
    return format('pass  %s -> %s', p_label, p_actual);
  end if;
  return format('FAIL  %s -> expected %s but got %s', p_label, p_expected, p_actual);
end $$;

-- Post a journal the REAL way: submit a draft, then walk it through the gate.
create or replace function t.mkjournal(p_ref text, p_memo text, p_lines jsonb, p_date date default '2026-11-05')
returns uuid language plpgsql as $$
declare v_res jsonb; v_id uuid;
begin
  v_res := public.gl_submit_journal(
    p_entity_code => 'greenway', p_journal_date => p_date,
    p_source_kind => 'bank', p_source_ref => p_ref, p_memo => p_memo,
    p_lines => p_lines, p_auto_post => false);
  v_id := (v_res->>'journal_id')::uuid;
  perform public.gl_post_journal(v_id);
  return v_id;
end $$;

-- The harness runs AS the impersonated user, so RLS and is_owner() apply to
-- the statements under test exactly as they would in production.
grant usage on schema t to authenticated, anon, public;
grant execute on all functions in schema t to authenticated, anon, public;

-- ── clean slate for repeatable runs ─────────────────────────────────────────
delete from public.gl_bank_matches;
update public.plaid_transactions set gl_match_id = null, gl_journal_id = null, gl_matched_at = null;
delete from public.gl_journal_lines where journal_id in (select id from public.gl_journals where source_ref like 'e2e-%');
delete from public.gl_audit_events   where journal_id in (select id from public.gl_journals where source_ref like 'e2e-%');
delete from public.gl_journals where source_ref like 'e2e-%';

insert into public.plaid_transactions (transaction_id, account_id, amount_cents, date, name, pending, removed)
values
  ('txn_out_250b', 'acct_ops',  25000, date '2026-11-05', 'ACME SUPPLY ACH 2', false, false),
  ('txn_out_250c', 'acct_ops',  25000, date '2026-11-05', 'ACME SUPPLY ACH 3', false, false),
  ('txn_removed',  'acct_ops',   4200, date '2026-11-07', 'WITHDRAWN BY BANK', false, true),
  ('txn_in_1000',  'acct_ops', -100000, date '2026-11-08', 'DEPOSIT',          false, false)
on conflict (transaction_id) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- THE RUN
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000aa';

do $outer$
declare
  j_good uuid; j_back uuid; j_amt uuid; j_extra uuid;
  r record; v bigint; v2 bigint; n int;
begin
  raise notice '';
  raise notice '=== SECTION 1 — IDENTITY =====================================';
  raise notice '%', t.eq('1.1 is_owner() as Michael', public.is_owner(), true);

  raise notice '';
  raise notice '=== SECTION 2 — THE HAPPY PATH ===============================';
  -- $250.00 LEFT the bank. Plaid POSITIVE = money out.
  -- Ledger cash must therefore be NEGATIVE (a credit).
  j_good := t.mkjournal('e2e-vendor-250', 'ACME Supply ACH - store supplies',
    jsonb_build_array(
      jsonb_build_object('account_code','76020','amount_cents', 25000, 'cost_class','nondeductible_280e'),
      jsonb_build_object('account_code','10200','amount_cents',-25000, 'cost_class','none')));
  raise notice 'pass  2.1 correct-signs journal posted -> %', j_good;

  raise notice '%', t.expect_ok('2.2 gl_post_bank_match',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 95000, %L)',
           'txn_out_250', j_good, 'vendor_payment', 'manual'));

  select plaid_amount_cents, ledger_cash_cents into v, v2
    from public.gl_bank_matches where transaction_id = 'txn_out_250' and superseded_at is null;
  raise notice '%', t.eq('2.3 plaid_amount_cents stored', v, 25000::bigint);
  raise notice '%', t.eq('2.4 ledger_cash_cents stored (the MIRROR)', v2, -25000::bigint);

  select count(*) into n from public.plaid_transactions
    where transaction_id='txn_out_250' and gl_match_id is not null
      and gl_journal_id is not null and gl_matched_at is not null;
  raise notice '%', t.eq('2.5 bridge stamped all three ways', n, 1);

  raise notice '';
  raise notice '=== SECTION 3 — THE SIGN WALL (the point of the slice) =======';
  -- This journal BALANCES PERFECTLY. Debits equal credits. It sums to zero.
  -- No trial balance and no imbalance check will ever flag it. Only the sign
  -- wall knows the money went the other way.
  j_back := t.mkjournal('e2e-backwards', 'backwards signs - still balances perfectly',
    jsonb_build_array(
      jsonb_build_object('account_code','10200','amount_cents', 25000, 'cost_class','none'),
      jsonb_build_object('account_code','76020','amount_cents',-25000, 'cost_class','nondeductible_280e')));
  raise notice 'note  3.1 the backwards journal POSTED FINE (it balances!) -> %', j_back;

  raise notice '%', t.expect_fail('3.2 match the backwards journal',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 95000, %L)',
           'txn_out_250b', j_back, 'vendor_payment', 'manual'),
    'GL_BANK_SIGN_DISAGREES');

  raise notice '';
  raise notice '=== SECTION 4 — AMOUNT MISMATCH ==============================';
  j_amt := t.mkjournal('e2e-wrongamt', 'right direction, wrong amount',
    jsonb_build_array(
      jsonb_build_object('account_code','76020','amount_cents', 30000, 'cost_class','nondeductible_280e'),
      jsonb_build_object('account_code','10200','amount_cents',-30000, 'cost_class','none')));
  raise notice '%', t.expect_fail('4.1 $300 entry vs $250 bank line',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 95000, %L)',
           'txn_out_250c', j_amt, 'vendor_payment', 'manual'),
    'GL_BANK_AMOUNT_MISMATCH');

  raise notice '';
  raise notice '=== SECTION 5 — ONE LINE, ONE ENTRY, ONCE ====================';
  raise notice '%', t.expect_fail('5.1 match the same bank line twice',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 95000, %L)',
           'txn_out_250', j_good, 'vendor_payment', 'manual'),
    'GL_BANK_ALREADY_MATCHED');

  raise notice '%', t.expect_fail('5.2 match a journal already spoken for',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 95000, %L)',
           'txn_out_250b', j_good, 'vendor_payment', 'manual'),
    'GL_BANK_JOURNAL_ALREADY_MATCHED');

  raise notice '';
  raise notice '=== SECTION 6 — LINES THAT ARE NOT REAL YET ==================';
  raise notice '%', t.expect_fail('6.1 a PENDING bank line',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 0, %L)',
           'txn_pending', j_back, 'bank_fee', 'manual'),
    'GL_BANK_PENDING_ROW');

  raise notice '%', t.expect_fail('6.2 a REMOVED bank line',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 0, %L)',
           'txn_removed', j_back, 'bank_fee', 'manual'),
    'GL_BANK_REMOVED_ROW');

  raise notice '%', t.expect_fail('6.3 a PRE-2026 bank line (line in the sand)',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 0, %L)',
           'txn_old', j_back, 'bank_fee', 'manual'),
    'GL_BANK_PRE_CUTOVER');

  raise notice '%', t.expect_fail('6.4 a bank line that does not exist',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 0, %L)',
           'txn_nope', j_back, 'bank_fee', 'manual'),
    'GL_BANK_MATCH_NOT_FOUND');

  raise notice '';
  raise notice '=== SECTION 7 — THE STORAGE LAYER, RPC BYPASSED ==============';
  -- Attack the table directly. These must fail on the CONSTRAINT, and the
  -- assertion proves it is the constraint and not some incidental NOT NULL.
  raise notice '%', t.expect_fail('7.1 backwards row written DIRECTLY',
    format($q$insert into public.gl_bank_matches
             (transaction_id, plaid_account_id, journal_id, entity_id,
              plaid_amount_cents, ledger_cash_cents, event_kind)
           values ('txn_out_250c','acct_ops',%L::uuid,
             (select id from public.gl_entities where code='greenway'),
             25000, 25000, 'vendor_payment')$q$, j_amt),
    'gl_bank_matches_sign_wall');

  raise notice '%', t.expect_fail('7.2 a SECOND live match on one bank line',
    format($q$insert into public.gl_bank_matches
             (transaction_id, plaid_account_id, journal_id, entity_id,
              plaid_amount_cents, ledger_cash_cents, event_kind)
           values ('txn_out_250','acct_ops',%L::uuid,
             (select id from public.gl_entities where code='greenway'),
             25000, -25000, 'vendor_payment')$q$, j_amt),
    'gl_bank_matches_one_live_per_txn');

  raise notice '%', t.expect_fail('7.3 a SECOND live match on one journal',
    format($q$insert into public.gl_bank_matches
             (transaction_id, plaid_account_id, journal_id, entity_id,
              plaid_amount_cents, ledger_cash_cents, event_kind)
           values ('txn_out_250c','acct_ops',%L::uuid,
             (select id from public.gl_entities where code='greenway'),
             25000, -25000, 'vendor_payment')$q$, j_good),
    'gl_bank_matches_one_live_per_journal');

  raise notice '%', t.expect_fail('7.4 confidence above 100%%',
    format($q$insert into public.gl_bank_matches
             (transaction_id, plaid_account_id, journal_id, entity_id,
              plaid_amount_cents, ledger_cash_cents, event_kind, confidence_milli_pct)
           values ('txn_in_1000','acct_ops',%L::uuid,
             (select id from public.gl_entities where code='greenway'),
             -100000, 100000, 'deposit_of_sales', 100001)$q$, j_amt),
    'confidence_milli_pct_check');

  raise notice '';
  raise notice '=== SECTION 8 — UNDOING A MATCH ==============================';
  raise notice '%', t.expect_fail('8.1 unmatch with a blank reason',
    'select public.gl_unmatch_bank_row(''txn_out_250'', ''   '')',
    'GL_BANK_UNCLASSIFIED');

  raise notice '%', t.expect_ok('8.2 unmatch WITH a reason',
    'select public.gl_unmatch_bank_row(''txn_out_250'', ''matched to the wrong invoice'')');

  select count(*) filter (where superseded_at is null),
         count(*) filter (where superseded_at is not null)
    into v, v2 from public.gl_bank_matches where transaction_id='txn_out_250';
  raise notice '%', t.eq('8.3 live matches after unmatch', v, 0::bigint);
  raise notice '%', t.eq('8.4 SUPERSEDED rows kept, never deleted', v2, 1::bigint);

  select count(*) into n from public.plaid_transactions
    where transaction_id='txn_out_250' and gl_match_id is null;
  raise notice '%', t.eq('8.5 bridge cleared on the bank row', n, 1);

  raise notice '%', t.expect_ok('8.6 the line can now be re-matched correctly',
    format('select public.gl_post_bank_match(%L, %L::uuid, %L, 100000, %L)',
           'txn_out_250', j_good, 'vendor_payment', 'manual'));

  select count(*) into n from public.gl_bank_matches where transaction_id='txn_out_250';
  raise notice '%', t.eq('8.7 full history retained (superseded + live)', n, 2);

  raise notice '%', t.expect_fail('8.8 unmatch a line with no live match',
    'select public.gl_unmatch_bank_row(''txn_out_250c'', ''nothing to undo'')',
    'GL_BANK_MATCH_NOT_FOUND');
end $outer$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 9 — THE MANAGER (separate transaction: different identity)
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000bb';

do $mgr$
declare v bigint;
begin
  raise notice '';
  raise notice '=== SECTION 9 — THE MANAGER IS LOCKED OUT ====================';
  raise notice '%', t.eq('9.1 is_owner() as the manager', public.is_owner(), false);

  select count(*) into v from public.gl_bank_matches;
  raise notice '%', t.eq('9.2 rows the manager can SEE', v, 0::bigint);

  raise notice '%', t.expect_fail('9.3 the manager tries to POST a match',
    'select public.gl_post_bank_match(''txn_out_250b'', gen_random_uuid(), ''vendor_payment'', 0, ''manual'')',
    'GL_NOT_OWNER');

  raise notice '%', t.expect_fail('9.4 the manager tries to UNMATCH',
    'select public.gl_unmatch_bank_row(''txn_out_250'', ''because I feel like it'')',
    'GL_NOT_OWNER');

  raise notice '%', t.expect_fail('9.5 the manager tries to RECONCILE',
    'select public.gl_bank_reconcile(''greenway'',''acct_ops'',''10200'',date ''2026-11-01'',date ''2026-11-30'',0::bigint)',
    'GL_NOT_OWNER');

  raise notice '%', t.expect_fail('9.6 the manager writes to the table DIRECTLY',
    $q$insert into public.gl_bank_matches
        (transaction_id, plaid_account_id, journal_id, entity_id,
         plaid_amount_cents, ledger_cash_cents, event_kind)
      values ('txn_in_1000','acct_ops', gen_random_uuid(),
        (select id from public.gl_entities where code='greenway'),
        -100000, 100000, 'deposit_of_sales')$q$,
    'row-level security');
end $mgr$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 10 — RECONCILIATION arithmetic against real books
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000aa';

do $rec$
declare
  j uuid; j2 uuid; res jsonb;
begin
  raise notice '';
  raise notice '=== SECTION 10 — RECONCILIATION ==============================';
  -- The first version of this test FAILED, and it was the TEST that was wrong,
  -- not the engine. I left three unrelated unmatched bank lines sitting in
  -- acct_ops ($250 + $250 out, $1,000 in = 50,000 net) and then called the
  -- month "clean". The engine correctly reported a 50,000 gap. Recorded here
  -- because a test author who edits the engine to make a bad test go green is
  -- exactly how a control gets quietly disarmed.
  --
  -- The fix is isolation: reconciliation is tested on its OWN bank account
  -- whose every line is known.

  insert into public.plaid_accounts (account_id, item_id, name, role, mask)
  values ('acct_rec', 'item_test', 'Reconciliation Test', 'main', '9999')
  on conflict (account_id) do nothing;

  -- ── 10a. A CLEAN MONTH. One $250 payment; the bank shows exactly that. ──
  j := t.mkjournal('e2e-rec-250', 'the only entry in the books',
    jsonb_build_array(
      jsonb_build_object('account_code','76020','amount_cents', 25000, 'cost_class','nondeductible_280e'),
      jsonb_build_object('account_code','10200','amount_cents',-25000, 'cost_class','none')));

  insert into public.plaid_transactions (transaction_id, account_id, amount_cents, date, name, pending, removed)
  values ('rec_out_250','acct_rec', 25000, date '2026-11-05','ACME', false, false);

  perform public.gl_post_bank_match('rec_out_250', j, 'vendor_payment', 95000, 'manual');

  res := public.gl_bank_reconcile('greenway','acct_rec','10200',
           date '2026-11-01', date '2026-11-30', -25000::bigint);
  raise notice '%', t.eq('10.1 a clean month TIES', (res->>'ties')::boolean, true);
  raise notice '%', t.eq('10.2 difference is zero', (res->>'difference_cents')::bigint, 0::bigint);

  -- ── 10b. AN UNCASHED CHEQUE. Written on the books, not yet cleared. ──
  -- The books are RIGHT and the bank is RIGHT; they simply disagree today.
  -- A reconciliation that called this an error would train its owner to
  -- ignore warnings, which is the most expensive failure a control can have.
  j2 := t.mkjournal('e2e-rec-chq', 'cheque written, not yet cashed',
    jsonb_build_array(
      jsonb_build_object('account_code','76020','amount_cents', 10000, 'cost_class','nondeductible_280e'),
      jsonb_build_object('account_code','10200','amount_cents',-10000, 'cost_class','none')));

  res := public.gl_bank_reconcile('greenway','acct_rec','10200',
           date '2026-11-01', date '2026-11-30', -25000::bigint);
  raise notice '%', t.eq('10.3 uncashed cheque seen as in-books-not-bank',
                        (res->>'in_books_not_bank_cents')::bigint, -10000::bigint);
  raise notice '%', t.eq('10.4 and it STILL ties (books and bank both right)',
                        (res->>'ties')::boolean, true);

  -- ── 10c. A REAL GAP. Money left the bank and was never recorded. ──
  insert into public.plaid_transactions (transaction_id, account_id, amount_cents, date, name, pending, removed)
  values ('rec_ghost','acct_rec', 7700, date '2026-11-20','UNRECORDED FEE', false, false);

  res := public.gl_bank_reconcile('greenway','acct_rec','10200',
           date '2026-11-01', date '2026-11-30', -32700::bigint);
  raise notice '%', t.eq('10.5 unrecorded bank line seen as in-bank-not-books',
                        (res->>'in_bank_not_books_cents')::bigint, -7700::bigint);
  raise notice '%', t.eq('10.6 a genuine gap is NOT hidden',
                        (res->>'ties')::boolean, true);

  -- ── 10d. WRONG STATEMENT BALANCE must not tie. Proves the test can fail. ──
  res := public.gl_bank_reconcile('greenway','acct_rec','10200',
           date '2026-11-01', date '2026-11-30', -99999::bigint);
  raise notice '%', t.eq('10.7 a wrong closing balance does NOT tie',
                        (res->>'ties')::boolean, false);

  -- ── 10e. Non-cash account refused. ──
  raise notice '%', t.expect_fail('10.8 reconciling a NON-CASH account',
    'select public.gl_bank_reconcile(''greenway'',''acct_rec'',''76020'',date ''2026-11-01'',date ''2026-11-30'',0::bigint)',
    'GL_BANK_ACCOUNT_NOT_CASH');

  -- ── 10f. THE COMMINGLING GUARD. Account 10200 is the SAME chart row for all
  -- four sets of books. Post $5,000 to the LANDHOLDING books and prove the
  -- greenway reconciliation does not move by a cent.
  perform public.gl_post_journal((public.gl_submit_journal(
    p_entity_code => 'landholding', p_journal_date => date '2026-11-10',
    p_source_kind => 'bank', p_source_ref => 'e2e-land-5000',
    p_memo => 'landholding money, different set of books',
    p_lines => jsonb_build_array(
      jsonb_build_object('account_code','70010','amount_cents', 500000, 'cost_class','separate_business'),
      jsonb_build_object('account_code','10200','amount_cents',-500000, 'cost_class','none')),
    p_auto_post => false)->>'journal_id')::uuid);

  res := public.gl_bank_reconcile('greenway','acct_rec','10200',
           date '2026-11-01', date '2026-11-30', -32700::bigint);
  raise notice '%', t.eq('10.9 landholding money does NOT leak into greenway',
                        (res->>'ledger_balance_cents')::bigint, -35000::bigint);
end $rec$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 12 — D8: "TIES" IS NOT "FINISHED", AND SIGN-OFF KNOWS THE DIFFERENCE
--
-- The scenario that exposed the defect: books completely empty, one $77.00 bank
-- fee nobody recorded. The arithmetic closes perfectly, because the fee is
-- added to the ledger side AND is already inside the bank's closing balance, so
-- it cancels itself. The old code called that "everything ties to the penny".
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000aa';

do $d8$
declare res jsonb; rid uuid; j uuid; n int;
begin
  raise notice '';
  raise notice '=== SECTION 12 — TIES vs COMPLETE (D8) =======================';

  insert into public.plaid_accounts (account_id, item_id, name, role, mask)
  values ('acct_d8', 'item_test', 'D8', 'main', '8888')
  on conflict (account_id) do nothing;

  insert into public.plaid_transactions (transaction_id, account_id, amount_cents, date, name, pending, removed)
  values ('d8_fee','acct_d8', 7700, date '2026-11-20','MONTHLY SERVICE FEE', false, false);

  res := public.gl_bank_reconcile('greenway','acct_d8','10200',
           date '2026-11-01', date '2026-11-30', -7700::bigint);
  rid := (res->>'reconciliation_id')::uuid;

  raise notice '%', t.eq('12.1 the arithmetic really does close', (res->>'difference_cents')::bigint, 0::bigint);
  raise notice '%', t.eq('12.2 so ties is honestly true (arithmetic only)', (res->>'ties')::boolean, true);
  raise notice '%', t.eq('12.3 but one bank line has no entry', (res->>'unrecorded_item_count')::int, 1);
  raise notice '%', t.eq('12.4 THE FIX: it is NOT complete', (res->>'complete')::boolean, false);

  raise notice '%', t.expect_fail('12.5 signing off an unfinished month',
    format('select public.gl_sign_off_bank_reconciliation(%L::uuid, ''looks fine to me'')', rid),
    'GL_BANK_UNRECORDED_ITEMS');

  -- Do the work: record the fee, match it, reconcile again.
  j := t.mkjournal('e2e-d8-fee', 'monthly bank service charge',
    jsonb_build_array(
      jsonb_build_object('account_code','76040','amount_cents', 7700, 'cost_class','nondeductible_280e'),
      jsonb_build_object('account_code','10200','amount_cents',-7700, 'cost_class','none')),
    date '2026-11-20');
  perform public.gl_post_bank_match('d8_fee', j, 'bank_fee', 100000, 'manual');

  res := public.gl_bank_reconcile('greenway','acct_d8','10200',
           date '2026-11-01', date '2026-11-30', -7700::bigint);
  rid := (res->>'reconciliation_id')::uuid;
  raise notice '%', t.eq('12.6 after posting the entry, nothing is unrecorded',
                        (res->>'unrecorded_item_count')::int, 0);
  raise notice '%', t.eq('12.7 and NOW it is complete', (res->>'complete')::boolean, true);

  raise notice '%', t.expect_ok('12.8 sign-off is accepted once the work is done',
    format('select public.gl_sign_off_bank_reconciliation(%L::uuid, ''November reviewed'')', rid));

  select count(*) into n from public.gl_bank_reconciliations
   where id = rid and signed_off_at is not null and signed_off_by is not null;
  raise notice '%', t.eq('12.9 the signature is recorded with who and when', n, 1);

  raise notice '%', t.expect_fail('12.10 signing off twice',
    format('select public.gl_sign_off_bank_reconciliation(%L::uuid, ''again'')', rid),
    'GL_BANK_ALREADY_SIGNED_OFF');

  -- ── Storage-layer guards, RPC bypassed ────────────────────────────────────
  -- The first version of these two assertions was VACUOUS and reported a false
  -- pass: by this point the only reconciliation row was already complete, so
  -- `where complete = false` matched nothing, the UPDATE "succeeded" against
  -- zero rows, and the harness dutifully called it a failure to refuse. A test
  -- that passes because it touched nothing is exactly the false comfort this
  -- whole slice is about. So an INCOMPLETE row is created deliberately first,
  -- and the row count is asserted before the attack is attempted.
  insert into public.plaid_accounts (account_id, item_id, name, role, mask)
  values ('acct_d8b', 'item_test', 'D8b', 'main', '8889')
  on conflict (account_id) do nothing;

  insert into public.plaid_transactions (transaction_id, account_id, amount_cents, date, name, pending, removed)
  values ('d8b_fee','acct_d8b', 1900, date '2026-11-21','ANOTHER UNRECORDED FEE', false, false);

  res := public.gl_bank_reconcile('greenway','acct_d8b','10200',
           date '2026-11-01', date '2026-11-30', -1900::bigint);
  raise notice '%', t.eq('12.11a a deliberately INCOMPLETE row now exists',
                        (res->>'complete')::boolean, false);

  select count(*) into n from public.gl_bank_reconciliations where complete = false;
  raise notice '%', t.eq('12.11b and the attack below will actually hit a row', n, 1);

  raise notice '%', t.expect_fail('12.11 forging a signature on an INCOMPLETE month',
    $q$update public.gl_bank_reconciliations
          set signed_off_at = now(), signed_off_by = auth.uid()
        where complete = false$q$,
    'gl_bank_recs_signoff_needs_complete');

  select count(*) into n from public.gl_bank_reconciliations where unrecorded_item_count > 0;
  raise notice '%', t.eq('12.12a a row with unrecorded items exists to attack', n, 1);

  -- And lying about `complete` itself.
  raise notice '%', t.expect_fail('12.12 setting complete=true on a month with unrecorded items',
    $q$update public.gl_bank_reconciliations
          set complete = true
        where unrecorded_item_count > 0$q$,
    'gl_bank_recs_complete_is_defined');

  -- Re-running a reconciliation must REVOKE the signature: the facts under it
  -- have just been recomputed.
  perform public.gl_bank_reconcile('greenway','acct_d8','10200',
            date '2026-11-01', date '2026-11-30', -7700::bigint);
  select count(*) into n from public.gl_bank_reconciliations
   where id = rid and signed_off_at is null;
  raise notice '%', t.eq('12.13 re-running the reconciliation revokes the old sign-off', n, 1);
end $d8$;

rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 11 — the wiring audit must still be silent
-- ═════════════════════════════════════════════════════════════════════════════
do $aud$
declare n int;
begin
  select count(*) into n from gl_audit_bank_wiring();
  raise notice '';
  raise notice '=== SECTION 11 — WIRING AUDIT ================================';
  raise notice '%', t.eq('11.1 gl_audit_bank_wiring problems', n, 0);
end $aud$;

drop schema t cascade;
