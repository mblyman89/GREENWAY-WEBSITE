-- =============================================================================
-- scripts/accounting/trial-balance-tests.sql   (slice F4)
--
-- THE ADVERSARIAL SUITE FOR THE TRIAL BALANCE.
--
-- Its job is to BREAK the reports, not to confirm they work (standing rule 13b).
-- Every assertion states its SPECIFIC expectation (rule 13c) so a test can never
-- pass because something unrelated broke.
--
-- THE HEADLINE ATTACK is #2: build the exact reversal scenario and prove the
-- trial balance reports the TRUTH, while separately proving that the naive
-- status='posted' filter produces a balanced, fictional answer. If the naive
-- filter ever stops being wrong, the headline test has become a tautology and
-- the negative control fails loudly (rule 15b).
-- =============================================================================
\set ON_ERROR_STOP on
set search_path = public;

select set_config('harness.user_id', (select id::text from auth.users limit 1), false);

-- Act as an ADMIN by default. This used to be implicit -- the harness defaulted
-- is_admin() to true -- and that silence hid the 0175 GL_FORBIDDEN defect, which
-- only surfaced when Michael pasted the migration into the real SQL editor. The
-- harness now defaults to FALSE (an honest picture of the SQL editor), so any
-- suite that needs admin has to SAY SO. The tests below that check refusals flip
-- this to 'false' deliberately and flip it back.
select set_config('harness.is_admin', 'true', false);

create or replace function pg_temp.ok(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond then
    raise notice '  PASS  %', p_label;
  else
    raise exception 'ASSERTION FAILED: %', p_label;
  end if;
end $$;

create or replace function pg_temp.eqi(p_actual bigint, p_expected bigint, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then
    raise notice '  PASS  % (= %)', p_label, p_expected;
  else
    raise exception 'ASSERTION FAILED: % (expected %, got %)', p_label, p_expected, p_actual;
  end if;
end $$;

/** Assert a statement raises an error whose text contains p_needle. */
create or replace function pg_temp.raises(p_sql text, p_needle text, p_label text)
returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := SQLERRM;
    if position(p_needle in v_msg) > 0 then
      raise notice '  PASS  % [%]', p_label, p_needle;
      return;
    end if;
    raise exception 'WRONG ERROR for %: expected to contain %, got: %', p_label, p_needle, v_msg;
  end;
  raise exception 'NOTHING RAISED for % (expected %)', p_label, p_needle;
end $$;

create or replace function pg_temp.uid() returns uuid language sql stable as
$$ select nullif(current_setting('harness.user_id', true), '')::uuid $$;

/** Post a two-line journal and return its id. */
create or replace function pg_temp.mkj(
  p_entity text, p_date date, p_memo text,
  p_acct_a text, p_amt_a bigint,
  p_acct_b text, p_amt_b bigint,
  p_class_b text default 'none',
  p_kind text default 'manual'
) returns uuid language plpgsql as $$
declare v_e uuid; v_a uuid; v_b uuid; v_j uuid;
begin
  select id into v_e from public.gl_entities where code = p_entity;
  select id into v_a from public.gl_accounts where code = p_acct_a;
  select id into v_b from public.gl_accounts where code = p_acct_b;
  insert into public.gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_e, p_date, p_kind, p_memo, pg_temp.uid())
  returning id into v_j;
  insert into public.gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_j, 1, v_a, v_e, p_amt_a, 'none'),
         (v_j, 2, v_b, v_e, p_amt_b, p_class_b);
  perform public.gl_post_journal(v_j);
  return v_j;
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 1 — the plumbing: does a simple trial balance tell the truth?'
\echo '==========================================================================='
do $$
declare v_tb jsonb; v_cash bigint; v_rev bigint;
begin
  perform pg_temp.mkj('greenway', date '2026-03-01', 'A1 real sale',
                      '10100', 100000, '50010', -100000, 'nondeductible_280e');

  select balance_cents into v_cash from public.gl_trial_balance
   where entity_code = 'greenway' and account_code = '10100';
  select balance_cents into v_rev from public.gl_trial_balance
   where entity_code = 'greenway' and account_code = '50010';

  perform pg_temp.eqi(v_cash, 100000, 'cash is a 100000 debit');
  perform pg_temp.eqi(v_rev, -100000, 'revenue is a 100000 credit');

  v_tb := public.gl_trial_balance_check('greenway');
  perform pg_temp.ok((v_tb->>'balanced')::boolean, 'the trial balance balances');
  perform pg_temp.ok((v_tb->>'certified')::boolean, 'and it certifies');
  perform pg_temp.eqi((v_tb->>'total_debit_cents')::bigint, 100000, 'total debits');
  perform pg_temp.eqi((v_tb->>'total_credit_cents')::bigint, 100000, 'total credits');
  perform pg_temp.eqi((v_tb->>'difference_cents')::bigint, 0, 'no difference');
  perform pg_temp.eqi((v_tb->>'abnormal_count')::bigint, 0, 'nothing abnormal');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 2 — ***THE HEADLINE***: the reversal must not invent money.'
\echo '  A mistaken 2,500.00 sale is posted, then reversed.'
\echo '  TRUTH: cash 1,000.00 / revenue -1,000.00 (only the first real sale).'
\echo '  The NAIVE status=posted filter yields -1,500.00 / +1,500.00 AND BALANCES.'
\echo '==========================================================================='
do $$
declare
  v_j uuid; v_rj uuid; v_tb jsonb;
  v_cash bigint; v_rev bigint;
  v_naive_cash bigint; v_naive_rev bigint; v_naive_sum bigint;
begin
  v_j := pg_temp.mkj('greenway', date '2026-03-05', 'A2 mistaken sale',
                     '10100', 250000, '50010', -250000, 'nondeductible_280e');
  select (public.gl_reverse_journal(v_j, 'A2 reversing the mistake'))::uuid into v_rj;
  perform public.gl_post_journal(v_rj);

  -- The original must now be flipped to 'reversed' by 0174's trigger.
  perform pg_temp.ok(
    (select status from public.gl_journals where id = v_j) = 'reversed',
    'the original journal is marked reversed');
  perform pg_temp.ok(
    (select status from public.gl_journals where id = v_rj) = 'posted',
    'the reversal itself stays posted — which is exactly why status=posted alone is wrong');

  -- Both journals KEEP their lines. If they did not, this whole slice would be moot.
  perform pg_temp.eqi(
    (select count(*) from public.gl_journal_lines where journal_id = v_j), 2,
    'the reversed original still carries its lines');

  -- THE TRUTH, via our view.
  select balance_cents into v_cash from public.gl_trial_balance
   where entity_code = 'greenway' and account_code = '10100';
  select balance_cents into v_rev from public.gl_trial_balance
   where entity_code = 'greenway' and account_code = '50010';
  perform pg_temp.eqi(v_cash, 100000, 'THE MONEY PROOF: cash is 100000, the one real sale');
  perform pg_temp.eqi(v_rev, -100000, 'THE MONEY PROOF: revenue is -100000, the one real sale');

  -- NEGATIVE CONTROL (rule 15a/15b): prove the naive filter is WRONG *and*
  -- that it still foots to zero. If this ever passes, the test above is a lie.
  select coalesce(sum(l.amount_cents),0) into v_naive_cash
  from public.gl_journal_lines l
  join public.gl_journals j on j.id = l.journal_id
  join public.gl_accounts a on a.id = l.account_id
  where j.status = 'posted' and a.code = '10100';

  select coalesce(sum(l.amount_cents),0) into v_naive_rev
  from public.gl_journal_lines l
  join public.gl_journals j on j.id = l.journal_id
  join public.gl_accounts a on a.id = l.account_id
  where j.status = 'posted' and a.code = '50010';

  select coalesce(sum(l.amount_cents),0) into v_naive_sum
  from public.gl_journal_lines l
  join public.gl_journals j on j.id = l.journal_id
  where j.status = 'posted';

  perform pg_temp.eqi(v_naive_cash, -150000,
    'NEGATIVE CONTROL: the naive filter invents -150000 of cash');
  perform pg_temp.eqi(v_naive_rev, 150000,
    'NEGATIVE CONTROL: the naive filter invents +150000 of revenue');
  perform pg_temp.eqi(v_naive_sum, 0,
    'NEGATIVE CONTROL: ...AND IT STILL FOOTS TO ZERO. This is why "it balances" proves nothing.');

  -- The certified report is still balanced and still correct.
  v_tb := public.gl_trial_balance_check('greenway');
  perform pg_temp.ok((v_tb->>'certified')::boolean, 'the real trial balance still certifies');
  perform pg_temp.eqi((v_tb->>'total_debit_cents')::bigint, 100000, 'debits reflect only the real sale');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 3 — drafts must NEVER reach a report.'
\echo '==========================================================================='
do $$
declare v_e uuid; v_a uuid; v_b uuid; v_j uuid; v_before bigint; v_after bigint;
begin
  select coalesce(sum(amount_cents),0) into v_before
  from public.gl_reportable_lines where account_code = '10100';

  select id into v_e from public.gl_entities where code = 'greenway';
  select id into v_a from public.gl_accounts where code = '10100';
  select id into v_b from public.gl_accounts where code = '50010';
  insert into public.gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_e, date '2026-03-09', 'manual', 'A3 a draft that must never be reported', pg_temp.uid())
  returning id into v_j;
  insert into public.gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_j, 1, v_a, v_e, 9999900, 'none'),
         (v_j, 2, v_b, v_e, -9999900, 'nondeductible_280e');

  select coalesce(sum(amount_cents),0) into v_after
  from public.gl_reportable_lines where account_code = '10100';

  perform pg_temp.eqi(v_after, v_before, 'a 99,999.00 DRAFT changes no reported balance');
  perform pg_temp.eqi(
    (select count(*) from public.gl_reportable_lines where journal_id = v_j), 0,
    'the draft contributes zero reportable lines');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 4 — entities must never be mixed. Four entities, four tax forms.'
\echo '==========================================================================='
do $$
declare v_tb_gw jsonb; v_tb_lh jsonb; v_leak bigint;
begin
  -- Rental income in the landholding entity only (52000 is landholding-only).
  -- NOTE: 10200/10300 are CONTROL accounts (F2 refuses manual posts to them),
  -- and 10100 is restricted to greenway. 10400 Undeposited Funds is an
  -- unrestricted, non-control asset — the correct account for this test.
  perform pg_temp.mkj('landholding', date '2026-03-01', 'A4 rent received',
                      '10400', 200000, '52000', -200000, 'separate_business');

  v_tb_gw := public.gl_trial_balance_check('greenway');
  v_tb_lh := public.gl_trial_balance_check('landholding');

  perform pg_temp.ok((v_tb_gw->>'certified')::boolean, 'greenway still certifies');
  perform pg_temp.ok((v_tb_lh->>'certified')::boolean, 'landholding certifies');
  perform pg_temp.eqi((v_tb_lh->>'total_debit_cents')::bigint, 200000, 'landholding debits are its own');
  perform pg_temp.eqi((v_tb_gw->>'total_debit_cents')::bigint, 100000, 'greenway is UNAFFECTED by landholding activity');

  select count(*) into v_leak from public.gl_trial_balance
   where entity_code = 'greenway' and account_code = '52000';
  perform pg_temp.eqi(v_leak, 0, 'landholding rental income does NOT appear under greenway');

  perform pg_temp.raises(
    $q$ select public.gl_trial_balance_check('nonexistent_entity') $q$,
    'TB_UNKNOWN_ENTITY', 'an unknown entity is refused');
  perform pg_temp.raises(
    $q$ select public.gl_trial_balance_check('') $q$,
    'TB_NO_ENTITY', 'a blank entity is refused');
  perform pg_temp.raises(
    $q$ select public.gl_trial_balance_check(null) $q$,
    'TB_NO_ENTITY', 'a null entity is refused');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 5 — date ranges: boundaries, backwards ranges, leap day.'
\echo '==========================================================================='
do $$
declare v_in jsonb; v_out jsonb; v_edge jsonb;
begin
  -- Inclusive at both ends.
  v_in := public.gl_trial_balance_check('greenway', date '2026-03-01', date '2026-03-01');
  perform pg_temp.ok((v_in->>'line_count')::bigint > 0, 'a single-day range includes that day (inclusive start)');

  v_edge := public.gl_trial_balance_check('greenway', date '2026-03-05', date '2026-03-05');
  perform pg_temp.ok((v_edge->>'line_count')::bigint > 0, 'the reversal day is included (inclusive end)');

  -- A period with no activity is EMPTY, and empty is NOT certified.
  v_out := public.gl_trial_balance_check('greenway', date '2026-07-01', date '2026-07-31');
  perform pg_temp.ok(not (v_out->>'certified')::boolean, 'an empty period does NOT certify');
  perform pg_temp.ok((v_out->>'verdict') like 'TB_EMPTY%', 'and it says TB_EMPTY explicitly');
  perform pg_temp.ok((v_out->>'verdict') like '%NOT evidence%',
    'the empty verdict explicitly warns that balancing proves nothing');

  perform pg_temp.raises(
    $q$ select public.gl_trial_balance_check('greenway', date '2026-03-31', date '2026-03-01') $q$,
    'TB_RANGE_BACKWARDS', 'a backwards range is refused rather than silently returning nothing');

  -- Leap day moved to ATTACK 14: posting on 2028-02-29 failed with
  -- GL_NO_PERIOD, which turned out to be nothing to do with dates and
  -- everything to do with fiscal years never being opened past 2026.
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 6 — THE $4,624,697.31 LAZY INVENTORY PLUG (standing rule 19).'
\echo '  It cannot be posted at all; and it must therefore never be reportable.'
\echo '==========================================================================='
do $$
declare v_e uuid; v_a uuid; v_b uuid; v_j uuid; v_cnt bigint;
begin
  select id into v_e from public.gl_entities where code = 'greenway';
  select id into v_a from public.gl_accounts where code = '10100';
  select id into v_b from public.gl_accounts where code = '50010';

  -- An UNBALANCED plug: 4,624,697.31 debit against a 1.00 credit.
  insert into public.gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_e, date '2026-03-20', 'manual', 'A6 LAZY INVENTORY ENTRY', pg_temp.uid())
  returning id into v_j;
  insert into public.gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_j, 1, v_a, v_e, 462469731, 'none'),
         (v_j, 2, v_b, v_e, -100, 'nondeductible_280e');

  perform pg_temp.raises(
    format('select public.gl_post_journal(%L::uuid)', v_j),
    'GL_OUT_OF_BALANCE', 'the lazy plug cannot post');

  select count(*) into v_cnt from public.gl_reportable_lines where journal_id = v_j;
  perform pg_temp.eqi(v_cnt, 0, 'and being unposted, it is not reportable');

  -- The trial balance is untouched by the attempt.
  perform pg_temp.ok(
    (public.gl_trial_balance_check('greenway')->>'certified')::boolean,
    'the books still certify after the plug attempt');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 7 — abnormal balances must be SURFACED, never hidden.'
\echo '  Negative inventory is on the permanent failure corpus (rule 19).'
\echo '==========================================================================='
do $$
declare v_tb jsonb; v_abn boolean;
begin
  -- Drive an asset account credit (negative inventory shape) via a real,
  -- balanced entry: CREDIT inventory, DEBIT cost of goods sold.
  --
  -- Account choice is not arbitrary and was verified against 0173, not assumed:
  --   20000 Inventory — Cannabis IS the control account (subledger 'inventory'),
  --         so a manual journal against it correctly raises GL_CONTROL_ACCOUNT.
  --         The child 20010 Inventory — Flower is non-control and is what a real
  --         category-level relief actually hits.
  --   60010 COGS — Flower has requires_cost_class = true, so it must carry a
  --         real cost class; mkj applies p_class_b to the SECOND account only,
  --         which is why COGS is the second leg here.
  -- This is the true shape of the owner's historical negative-inventory failure
  -- (rule 19): relieving more stock than was ever received.
  --
  -- SOURCE KIND MATTERS. F2's gl_guard_inventory_manual refuses ANY 2%-coded
  -- asset account on a source_kind='manual' journal: "Inventory moves only with
  -- goods." That guard is correct and was left alone. A real inventory relief
  -- is not typed by hand — it arrives as a sale, so this posts as 'pos_sale',
  -- which is exactly how the negative balance appeared on the real books.
  perform pg_temp.mkj('greenway', date '2026-04-02', 'A7 inventory relief exceeding stock',
                      '20010', -500000, '60010', 500000, 'cogs_direct', 'pos_sale');

  select is_abnormal into v_abn from public.gl_trial_balance
   where entity_code = 'greenway' and account_code = '20010';
  perform pg_temp.ok(v_abn, 'an asset account with a credit balance is flagged ABNORMAL');

  v_tb := public.gl_trial_balance_check('greenway');
  perform pg_temp.ok((v_tb->>'abnormal_count')::bigint >= 1, 'the check counts the abnormal account');
  perform pg_temp.ok((v_tb->>'verdict') like '%opposite side%',
    'and the verdict tells a human to review it');
  -- Crucially, an abnormal balance does NOT stop certification: it is a real
  -- balance, honestly reported. Hiding it would be the defect.
  perform pg_temp.ok((v_tb->>'certified')::boolean,
    'an abnormal balance is reported, not suppressed, and does not block the report');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 8 — the general ledger drill-down must reconcile to the TB.'
\echo '  Every number a human sees must be traceable. This proves it ties.'
\echo '==========================================================================='
do $$
declare v_tb_bal bigint; v_gl_last bigint; v_gl_sum bigint; v_rows bigint;
begin
  select balance_cents into v_tb_bal from public.gl_trial_balance
   where entity_code = 'greenway' and account_code = '10100';

  -- The final running balance of the GL report must equal the TB balance.
  select running_balance_cents into v_gl_last
  from public.gl_general_ledger('greenway', '10100')
  order by journal_date desc, journal_no desc limit 1;

  select coalesce(sum(debit_cents - credit_cents), 0), count(*)
    into v_gl_sum, v_rows
  from public.gl_general_ledger('greenway', '10100');

  perform pg_temp.eqi(v_gl_last, v_tb_bal, 'GL running balance ties to the trial balance');
  perform pg_temp.eqi(v_gl_sum, v_tb_bal, 'GL debits minus credits ties to the trial balance');
  perform pg_temp.ok(v_rows > 0, 'the drill-down actually returned lines');

  perform pg_temp.raises(
    $q$ select * from public.gl_general_ledger('greenway', '10100', date '2026-12-31', date '2026-01-01') $q$,
    'GL_RANGE_BACKWARDS', 'the GL report refuses a backwards range');
  perform pg_temp.raises(
    $q$ select * from public.gl_general_ledger('nope', '10100') $q$,
    'GL_UNKNOWN_ENTITY', 'the GL report refuses an unknown entity');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 9 — the whole ledger must ALWAYS foot to zero, per entity and'
\echo '  across every entity, no matter what has happened above.'
\echo '==========================================================================='
do $$
declare r record; v_total bigint;
begin
  for r in select code from public.gl_entities loop
    select coalesce(sum(amount_cents),0) into v_total
    from public.gl_reportable_lines where entity_code = r.code;
    perform pg_temp.eqi(v_total, 0, format('entity %s foots to zero', r.code));
  end loop;

  select coalesce(sum(amount_cents),0) into v_total from public.gl_reportable_lines;
  perform pg_temp.eqi(v_total, 0, 'the entire reportable ledger foots to zero');

  -- And the TB view's own columns must agree with the signed sum.
  select coalesce(sum(debit_cents),0) - coalesce(sum(credit_cents),0) into v_total
  from public.gl_trial_balance;
  perform pg_temp.eqi(v_total, 0, 'the trial balance view''s debit and credit columns agree');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 10 — a period with real activity that nets to ZERO must NOT be'
\echo '  reported as "empty". (My own first draft got this wrong.)'
\echo '==========================================================================='
do $$
declare v_j uuid; v_rj uuid; v_tb jsonb;
begin
  -- June 2026: a sale and its reversal, and nothing else. Every account nets 0.
  -- Amount is deliberately UNDER F2's 5,000.00 approval threshold: an entry at
  -- or above it raises GL_APPROVAL_REQUIRED and never posts. That guard is
  -- correct and stays; this attack is about empty-vs-cancelled reporting, not
  -- about approvals, so it uses an amount a real retail sale would actually be.
  v_j := pg_temp.mkj('greenway', date '2026-06-10', 'A10 sale that gets reversed same period',
                     '10100', 47700, '50010', -47700, 'nondeductible_280e');
  select (public.gl_reverse_journal(v_j, 'A10 reversing in the same period'))::uuid into v_rj;
  update public.gl_journals set journal_date = date '2026-06-11' where id = v_rj;
  perform public.gl_post_journal(v_rj);

  v_tb := public.gl_trial_balance_check('greenway', date '2026-06-01', date '2026-06-30');

  perform pg_temp.eqi((v_tb->>'line_count')::bigint, 4,
    'four real lines exist in the period even though every account nets to zero');
  perform pg_temp.ok((v_tb->>'verdict') not like 'TB_EMPTY%',
    'the period is NOT reported as empty — there WAS activity, it simply cancelled');
  perform pg_temp.ok((v_tb->>'certified')::boolean, 'and it certifies as balanced');
  perform pg_temp.eqi((v_tb->>'account_count')::bigint, 0,
    'no account carries a balance, which is correct and different from "no activity"');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 11 — money precision: no cent invented or lost across many lines.'
\echo '==========================================================================='
do $$
declare
  i int; v_running bigint := 0; v_amt bigint;
  v_e uuid; v_a uuid; v_b uuid; v_j uuid;
  v_tb bigint;
begin
  -- Account choice verified against 0173, not assumed. The atm entity is a
  -- SEPARATE trade or business (CHAMP), so it cannot touch the store's accounts:
  --   10100 Cash on Hand — Vault is array['greenway'] and 50010 Sales — Flower
  --   is array['greenway'], so both are correctly refused for atm with
  --   GL_ACCOUNT_NOT_ALLOWED_FOR_ENTITY. That guard is right and stays.
  --   10400 Undeposited Funds has no entity restriction and is non-control.
  --   51000 ATM Surcharge Income is the atm entity's own revenue account.
  select id into v_e from public.gl_entities where code = 'atm';
  select id into v_a from public.gl_accounts where code = '10400';
  select id into v_b from public.gl_accounts where code = '51000';

  -- 150 awkward amounts (primes, odd cents) in one entity.
  for i in 1..150 loop
    v_amt := (i * 37) + 1;
    v_running := v_running + v_amt;
    insert into public.gl_journals (entity_id, journal_date, source_kind, memo, created_by)
    values (v_e, date '2026-05-01' + (i % 28), 'manual', 'A11 precision line ' || i, pg_temp.uid())
    returning id into v_j;
    insert into public.gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
    values (v_j, 1, v_a, v_e, v_amt, 'none'),
           (v_j, 2, v_b, v_e, -v_amt, 'separate_business');
    perform public.gl_post_journal(v_j);
  end loop;

  select balance_cents into v_tb from public.gl_trial_balance
   where entity_code = 'atm' and account_code = '10400';

  perform pg_temp.eqi(v_tb, v_running,
    format('150 awkward amounts aggregate to exactly %s cents', v_running));
  perform pg_temp.ok(
    (public.gl_trial_balance_check('atm')->>'certified')::boolean,
    'the atm entity certifies after 150 entries');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 12 — the view must not be bypassable: prove gl_reportable_lines'
\echo '  and a hand-written correct query agree exactly.'
\echo '==========================================================================='
do $$
declare v_view bigint; v_manual bigint; v_naive bigint;
begin
  select count(*) into v_view from public.gl_reportable_lines;

  select count(*) into v_manual
  from public.gl_journal_lines l
  join public.gl_journals j on j.id = l.journal_id
  where j.status in ('posted','reversed');

  select count(*) into v_naive
  from public.gl_journal_lines l
  join public.gl_journals j on j.id = l.journal_id
  where j.status = 'posted';

  perform pg_temp.eqi(v_view, v_manual, 'the view matches the correct hand-written filter');
  perform pg_temp.ok(v_view > v_naive,
    'and it strictly includes MORE lines than the naive filter — proving reversed originals are retained');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 13 — ACCESS CONTROL: a budtender must not be able to read the books.'
\echo '  This attack exists because the first draft of 0175 FAILED it. The'
\echo '  migration granted select on the reporting views to `authenticated` under'
\echo '  the comment "views inherit RLS from their base tables". They do not.'
\echo '  A view runs with its OWNER''s rights unless security_invoker is set, so'
\echo '  every logged-in budtender would have been handed the general ledger.'
\echo '==========================================================================='
do $$
declare v_visible bigint; v_msg text;
begin
  -- Sanity: as admin, there IS something to protect. A test that proves a
  -- budtender sees zero rows is worthless if there are zero rows to see.
  select count(*) into v_visible from public.gl_reportable_lines;
  perform pg_temp.ok(v_visible > 0,
    format('PRECONDITION: there are %s real ledger lines to protect', v_visible));
end $$;

-- Become a budtender: a logged-in, non-admin session.
--
-- TWO THINGS HAVE TO BE TRUE FOR THIS TEST TO MEAN ANYTHING, and getting either
-- wrong makes it silently vacuous:
--
--  (1) SET ROLE, not SET LOCAL ROLE. psql runs in autocommit, so SET LOCAL
--      outside an explicit transaction emits only "WARNING: SET LOCAL can only
--      be used in transaction blocks" and DOES NOTHING. The first version of
--      this attack did exactly that, stayed superuser, and reported 314 rows.
--
--  (2) The role must not be a superuser and must not own the tables. Superusers
--      and table owners BYPASS row-level security entirely, so asserting "the
--      books are protected" while connected as postgres proves nothing whatever.
--      `authenticated` is a plain NOLOGIN role created by the harness, exactly
--      as Supabase provides it.
--
-- set_config's third argument is is_local; it must be FALSE here for the same
-- autocommit reason as (1).
select set_config('harness.is_admin', 'false', false);
set role authenticated;

do $$
declare v_n bigint; v_msg text; v_denied boolean;
begin
  -- Guard the guard: if this somehow still runs with RLS-bypassing rights, say
  -- so loudly instead of quietly "passing".
  if (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'TEST IS VACUOUS: still running as a superuser (%), which bypasses RLS', current_user;
  end if;

  -- (a) The views. RLS on the base tables must actually bite through them.
  begin
    select count(*) into v_n from public.gl_reportable_lines;
    perform pg_temp.eqi(v_n, 0, 'a budtender selecting gl_reportable_lines sees NOTHING');
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'a budtender is denied gl_reportable_lines outright');
  end;

  begin
    select count(*) into v_n from public.gl_trial_balance;
    perform pg_temp.eqi(v_n, 0, 'a budtender selecting gl_trial_balance sees NOTHING');
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'a budtender is denied gl_trial_balance outright');
  end;

  begin
    select count(*) into v_n from public.gl_account_activity;
    perform pg_temp.eqi(v_n, 0, 'a budtender selecting gl_account_activity sees NOTHING');
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'a budtender is denied gl_account_activity outright');
  end;

  -- (b) The SECURITY DEFINER functions. These are the wider hole: SECURITY
  --     DEFINER bypasses RLS entirely, so security_invoker does not help here
  --     and the check must be explicit in the function body.
  v_denied := false;
  begin
    perform public.gl_trial_balance_check('greenway');
  exception when others then
    v_msg := SQLERRM; v_denied := true;
  end;
  perform pg_temp.ok(v_denied and position('TB_FORBIDDEN' in v_msg) > 0,
    'gl_trial_balance_check REFUSES a non-admin (TB_FORBIDDEN)');

  v_denied := false;
  begin
    perform * from public.gl_general_ledger('greenway');
  exception when others then
    v_msg := SQLERRM; v_denied := true;
  end;
  perform pg_temp.ok(v_denied and position('GL_FORBIDDEN' in v_msg) > 0,
    'gl_general_ledger REFUSES a non-admin (GL_FORBIDDEN)');

  -- (c) And the raw tables, for completeness.
  begin
    select count(*) into v_n from public.gl_journal_lines;
    perform pg_temp.eqi(v_n, 0, 'a budtender reading gl_journal_lines directly sees NOTHING');
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'a budtender is denied gl_journal_lines outright');
  end;
end $$;

reset role;
select set_config('harness.is_admin', 'true', false);

do $$
declare v_n bigint;
begin
  -- NEGATIVE CONTROL: prove the assertions above were not passing simply
  -- because everything is empty or broken for everyone. Admin must still see
  -- the data. If this fails, attack 13 proved nothing at all.
  select count(*) into v_n from public.gl_reportable_lines;
  perform pg_temp.ok(v_n > 0,
    'NEGATIVE CONTROL: an admin still sees the ledger — the denial above was real, not universal breakage');
  perform pg_temp.ok((public.gl_trial_balance_check('greenway')->>'certified')::boolean,
    'NEGATIVE CONTROL: an admin still gets a certified trial balance');
end $$;


\echo ''
\echo '==========================================================================='
\echo 'ATTACK 14 — THE 2027 CLIFF: a place to post must exist next year.'
\echo '  0172 seeded fiscal periods for 2026 ONLY and nothing opened another'
\echo '  year, so every posting would have begun failing on 2027-01-01.'
\echo '  Found by a leap-day test that could not post at all.'
\echo '==========================================================================='
do $$
declare v_j uuid; v_tb bigint; v_created integer; v_yr integer;
begin
  -- The original symptom: a 2028 leap-day entry could not be posted.
  perform pg_temp.mkj('greenway', date '2028-02-29', 'A14 leap day sale',
                      '10100', 12345, '50010', -12345, 'nondeductible_280e');
  select (public.gl_trial_balance_check('greenway', date '2028-02-29', date '2028-02-29')
          ->>'total_debit_cents')::bigint into v_tb;
  perform pg_temp.eqi(v_tb, 12345, 'a leap-day (2028-02-29) entry posts and reports correctly');

  -- New Year's Day 2027 — the exact moment the business would have stopped.
  perform pg_temp.mkj('greenway', date '2027-01-01', 'A14 new years day sale',
                      '10100', 5000, '50010', -5000, 'nondeductible_280e');
  select (public.gl_trial_balance_check('greenway', date '2027-01-01', date '2027-01-01')
          ->>'total_debit_cents')::bigint into v_tb;
  perform pg_temp.eqi(v_tb, 5000, 'January 1st 2027 accepts a posting');

  -- Every entity, every month, for the whole runway.
  for v_yr in 2026..2030 loop
    perform pg_temp.eqi(
      (select count(*) from public.gl_periods p
        join public.gl_entities e on e.id = p.entity_id
       where p.fiscal_year = v_yr),
      (select count(*) * 12 from public.gl_entities),
      format('fiscal year %s is fully open for every entity', v_yr));
  end loop;

  -- Idempotency: re-opening a year already open creates nothing and throws nothing.
  select public.gl_open_fiscal_year(2027) into v_created;
  perform pg_temp.eqi(v_created::bigint, 0::bigint,
    're-opening an already-open fiscal year is a no-op');

  -- The far future stays REFUSED. An open period is a place a typo can land,
  -- so the runway is deliberately finite: a sale fat-fingered to 2071 must fail.
  perform pg_temp.raises(
    $q$ select pg_temp.mkj('greenway', date '2071-06-15', 'A14 fat-fingered year',
                           '10100', 100, '50010', -100, 'nondeductible_280e') $q$,
    'GL_NO_PERIOD', 'a wildly wrong year is still refused, so the guard was not weakened');

  -- And a non-admin cannot open periods.
  perform pg_temp.raises(
    $q$ select set_config('harness.is_admin','false',true); select public.gl_open_fiscal_year(2031) $q$,
    'GL_FORBIDDEN', 'a non-admin cannot open a fiscal year');
end $$;
select set_config('harness.is_admin', 'true', true);


\echo ''
\echo '==========================================================================='
\echo 'ALL TRIAL BALANCE ATTACKS REPELLED'
\echo '==========================================================================='
