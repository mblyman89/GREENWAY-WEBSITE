-- scripts/accounting/gl-schema-tests.sql
-- =============================================================================
-- ADVERSARIAL TEST SUITE FOR MIGRATION 0172. LOCAL VERIFICATION ONLY.
-- =============================================================================
-- The pure core (src/lib/accounting/ledger-core.ts) proves the RULES are right.
-- This file proves the DATABASE actually enforces them, which is what matters:
-- a user interface can be bypassed, a constraint cannot.
--
-- Every test below tries to do something that would have been possible in the
-- old Sage books and asserts that this ledger REFUSES it. Where a test expects
-- failure, we capture the error and assert on the error code we designed for it,
-- so a test can never "pass" because something unrelated went wrong.
--
-- Run against a throwaway database ONLY, after gl-schema-harness.sql and
-- 0172_gl_foundation.sql. Never against production.
-- =============================================================================

\set ON_ERROR_STOP on

do $suite$
declare
  -- test bookkeeping
  v_pass        integer := 0;
  v_fail        integer := 0;
  v_failures    text[]  := array[]::text[];

  -- fixtures
  v_user        uuid;
  v_greenway    uuid;
  v_landhold    uuid;
  v_atm         uuid;

  a_cash        uuid;   -- 10100 asset, not a control account
  a_inventory   uuid;   -- 12000 asset, CONTROL (inventory subledger)
  a_ap          uuid;   -- 20100 liability, CONTROL (ap subledger)
  a_equity      uuid;   -- 30900 equity (opening balance equity)
  a_sales       uuid;   -- 40100 income, requires cost class
  a_rent        uuid;   -- 60100 expense, requires cost class
  a_atmfee      uuid;   -- 70100 income, restricted to the atm entity

  v_j           uuid;
  v_j2          uuid;
  v_no          bigint;
  v_no2         bigint;
  v_period      uuid;
  v_count       integer;
  v_sum         bigint;
  v_status      text;
  v_err         text;

  -- helper state
  v_tmp         uuid;
begin
  -- =========================================================================
  -- helpers
  -- =========================================================================
  -- ok(condition, label)
  create temporary table if not exists _t (dummy int) on commit drop;

  -- We inline pass/fail rather than defining nested functions (not possible in
  -- a DO block), using a small pattern: set v_ok, then record.

  -- ---- fixtures -----------------------------------------------------------
  insert into auth.users (email) values ('michael@greenway.test') returning id into v_user;
  perform set_config('harness.user_id', v_user::text, false);

  select id into v_greenway from gl_entities where code = 'greenway';
  select id into v_landhold from gl_entities where code = 'landholding';
  select id into v_atm      from gl_entities where code = 'atm';

  -- Seed a MINIMAL chart of accounts purely for testing. The real chart is F2,
  -- which Michael approves account by account.
  insert into gl_accounts (code, name, type, normal_balance, is_control, control_subledger, requires_cost_class)
  values ('10100', 'Cash on Hand', 'asset', 'debit', false, null, false)
  on conflict (code) do nothing;
  select id into a_cash from gl_accounts where code = '10100';

  insert into gl_accounts (code, name, type, normal_balance, is_control, control_subledger, requires_cost_class)
  values ('12000', 'Inventory', 'asset', 'debit', true, 'inventory', false)
  on conflict (code) do nothing;
  select id into a_inventory from gl_accounts where code = '12000';

  insert into gl_accounts (code, name, type, normal_balance, is_control, control_subledger, requires_cost_class)
  values ('20100', 'Accounts Payable', 'liability', 'credit', true, 'ap', false)
  on conflict (code) do nothing;
  select id into a_ap from gl_accounts where code = '20100';

  insert into gl_accounts (code, name, type, normal_balance, is_control, control_subledger, requires_cost_class)
  values ('30900', 'Opening Balance Equity', 'equity', 'credit', false, null, false)
  on conflict (code) do nothing;
  select id into a_equity from gl_accounts where code = '30900';

  insert into gl_accounts (code, name, type, normal_balance, is_control, control_subledger, requires_cost_class)
  values ('40100', 'Retail Sales', 'income', 'credit', false, null, true)
  on conflict (code) do nothing;
  select id into a_sales from gl_accounts where code = '40100';

  insert into gl_accounts (code, name, type, normal_balance, is_control, control_subledger, requires_cost_class)
  values ('60100', 'Rent Expense', 'expense', 'debit', false, null, true)
  on conflict (code) do nothing;
  select id into a_rent from gl_accounts where code = '60100';

  insert into gl_accounts (code, name, type, normal_balance, is_control, control_subledger,
                           requires_cost_class, allowed_entity_codes)
  values ('70100', 'ATM Fee Income', 'income', 'credit', false, null, true, array['atm'])
  on conflict (code) do nothing;
  select id into a_atmfee from gl_accounts where code = '70100';

  raise notice '--- fixtures ready ---';

  -- =========================================================================
  -- T1. SEED INTEGRITY
  -- =========================================================================
  select count(*) into v_count from gl_entities;
  if v_count = 4 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T1a expected 4 entities, got %s', v_count); end if;

  select coalesce(sum(ownership_milli_pct), 0) into v_sum from gl_shareholders where active;
  if v_sum = 100000 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T1b ownership sums to %s, expected 100000', v_sum); end if;

  -- Mom is flagged as NOT receiving distributions (Michael covers her tax).
  select count(*) into v_count from gl_shareholders where not receives_distributions;
  if v_count = 1 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T1c expected 1 non-distribution shareholder, got %s', v_count); end if;

  select count(*) into v_count from gl_periods where fiscal_year = 2026;
  if v_count = 48 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T1d expected 48 periods (12 x 4 entities), got %s', v_count); end if;

  -- =========================================================================
  -- T2. OWNERSHIP MUST ALWAYS TOTAL 100%
  -- =========================================================================
  begin
    update gl_shareholders set ownership_milli_pct = 90000 where ownership_milli_pct = 85000;
    v_fail := v_fail + 1; v_failures := v_failures || 'T2 ownership changed to total 105% and was ALLOWED';
  exception when others then
    if sqlerrm like '%GL_OWNERSHIP%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T2 wrong error: %s', sqlerrm); end if;
  end;

  -- =========================================================================
  -- T3. NORMAL BALANCE MUST MATCH ACCOUNT TYPE
  -- =========================================================================
  begin
    insert into gl_accounts (code, name, type, normal_balance)
    values ('99999', 'Backwards Account', 'asset', 'credit');
    v_fail := v_fail + 1; v_failures := v_failures || 'T3 a credit-normal asset was ALLOWED';
  exception when others then
    if sqlerrm like '%GL_NORMAL_BALANCE%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T3 wrong error: %s', sqlerrm); end if;
  end;

  -- A contra asset legitimately inverts, and must be accepted.
  begin
    insert into gl_accounts (code, name, type, normal_balance, is_contra)
    values ('17900', 'Accumulated Depreciation', 'asset', 'credit', true);
    v_pass := v_pass + 1;
  exception when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T3b contra asset REJECTED: %s', sqlerrm);
  end;

  -- =========================================================================
  -- T4. THE LINE IN THE SAND (2026-01-01)
  -- =========================================================================
  begin
    insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
    values (v_greenway, date '2025-11-30', 'manual', 'Sneaking old Sage history in', v_user);
    v_fail := v_fail + 1; v_failures := v_failures || 'T4a a pre-2026 journal was ALLOWED';
  exception when check_violation then v_pass := v_pass + 1;
  when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T4a wrong error: %s', sqlerrm);
  end;

  -- The opening-balance entry may be dated 2025-12-31, and only that date.
  begin
    insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
    values (v_greenway, date '2025-12-31', 'opening_balance', 'Opening balances at cut-over', v_user)
    returning id into v_tmp;
    v_pass := v_pass + 1;
    delete from gl_journals where id = v_tmp;
  exception when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T4b opening balance at 2025-12-31 REJECTED: %s', sqlerrm);
  end;

  begin
    insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
    values (v_greenway, date '2025-06-30', 'opening_balance', 'Opening balance on the wrong date', v_user);
    v_fail := v_fail + 1; v_failures := v_failures || 'T4c opening balance on a non-cutover date was ALLOWED';
  exception when check_violation then v_pass := v_pass + 1;
  when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T4c wrong error: %s', sqlerrm);
  end;

  -- =========================================================================
  -- T5. MEMO IS MANDATORY
  -- =========================================================================
  begin
    insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
    values (v_greenway, date '2026-03-15', 'manual', '  ', v_user);
    v_fail := v_fail + 1; v_failures := v_failures || 'T5 a blank memo was ALLOWED';
  exception when check_violation then v_pass := v_pass + 1;
  when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T5 wrong error: %s', sqlerrm);
  end;

  -- =========================================================================
  -- T6. OUT-OF-BALANCE ENTRIES CANNOT POST
  -- =========================================================================
  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-15', 'manual', 'Deliberately unbalanced', v_user)
  returning id into v_j;

  insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_j, 1, a_rent, v_greenway, 200000, 'nondeductible_280e'),
         (v_j, 2, a_cash, v_greenway, -150000, 'none');

  begin
    perform gl_post_journal(v_j);
    v_fail := v_fail + 1; v_failures := v_failures || 'T6 an out-of-balance journal POSTED';
  exception when others then
    if sqlerrm like '%GL_OUT_OF_BALANCE%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T6 wrong error: %s', sqlerrm); end if;
  end;

  -- it must still be a draft, untouched
  select status into v_status from gl_journals where id = v_j;
  if v_status = 'draft' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T6b failed post left status %s', v_status); end if;

  -- =========================================================================
  -- T7. A CORRECT ENTRY POSTS, AND NUMBERING IS GAPLESS
  -- =========================================================================
  update gl_journal_lines set amount_cents = -200000 where journal_id = v_j and line_no = 2;

  begin
    v_no := gl_post_journal(v_j);
    v_pass := v_pass + 1;
  exception when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T7 a valid journal FAILED to post: %s', sqlerrm);
  end;

  if v_no = 1 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T7b first journal number was %s, expected 1', v_no); end if;

  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-16', 'manual', 'Second valid entry', v_user)
  returning id into v_j2;
  insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_j2, 1, a_rent, v_greenway, 100000, 'nondeductible_280e'),
         (v_j2, 2, a_cash, v_greenway, -100000, 'none');
  v_no2 := gl_post_journal(v_j2);

  if v_no2 = 2 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T7c second journal number was %s, expected 2', v_no2); end if;

  -- =========================================================================
  -- T8. POSTED ENTRIES ARE IMMUTABLE (ASC 250: reverse and repost)
  -- =========================================================================
  begin
    update gl_journals set memo = 'quietly rewriting history' where id = v_j;
    v_fail := v_fail + 1; v_failures := v_failures || 'T8a a POSTED journal was edited';
  exception when others then
    if sqlerrm like '%GL_IMMUTABLE%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T8a wrong error: %s', sqlerrm); end if;
  end;

  begin
    update gl_journal_lines set amount_cents = 999999 where journal_id = v_j and line_no = 1;
    v_fail := v_fail + 1; v_failures := v_failures || 'T8b a POSTED journal line was edited';
  exception when others then
    if sqlerrm like '%GL_IMMUTABLE%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T8b wrong error: %s', sqlerrm); end if;
  end;

  begin
    delete from gl_journal_lines where journal_id = v_j and line_no = 1;
    v_fail := v_fail + 1; v_failures := v_failures || 'T8c a POSTED journal line was DELETED';
  exception when others then
    if sqlerrm like '%GL_IMMUTABLE%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T8c wrong error: %s', sqlerrm); end if;
  end;

  begin
    delete from gl_journals where id = v_j;
    v_fail := v_fail + 1; v_failures := v_failures || 'T8d a POSTED journal was DELETED';
  exception when others then
    if sqlerrm like '%GL_IMMUTABLE%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T8d wrong error: %s', sqlerrm); end if;
  end;

  begin
    insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
    values (v_j, 3, a_cash, v_greenway, 500, 'none');
    v_fail := v_fail + 1; v_failures := v_failures || 'T8e a line was ADDED to a posted journal';
  exception when others then
    if sqlerrm like '%GL_IMMUTABLE%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T8e wrong error: %s', sqlerrm); end if;
  end;

  -- =========================================================================
  -- T9. THE LAZY INVENTORY ENTRY DEFENCE (control accounts)
  -- =========================================================================
  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-17', 'manual', 'LAZY INVENTORY ENTRY (the $4.6M plug)', v_user)
  returning id into v_tmp;
  insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_tmp, 1, a_inventory, v_greenway, 462469731, 'none'),
         (v_tmp, 2, a_cash,      v_greenway, -462469731, 'none');

  begin
    perform gl_post_journal(v_tmp);
    v_fail := v_fail + 1; v_failures := v_failures || 'T9a a MANUAL plug into inventory POSTED (the exact Sage failure)';
  exception when others then
    if sqlerrm like '%GL_CONTROL_ACCOUNT%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T9a wrong error: %s', sqlerrm); end if;
  end;

  -- ...but the owning subledger IS allowed to post there.
  update gl_journals set source_kind = 'inventory', memo = 'Receipt of lot 12345 from subledger'
  where id = v_tmp;
  begin
    perform gl_post_journal(v_tmp);
    v_pass := v_pass + 1;
  exception when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T9b the inventory subledger was BLOCKED from its own control account: %s', sqlerrm);
  end;

  -- =========================================================================
  -- T10. 280E COST-CLASS TAGGING
  -- =========================================================================
  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-18', 'manual', 'Expense with no 280E tag', v_user)
  returning id into v_tmp;
  insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_tmp, 1, a_rent, v_greenway, 50000, 'none'),
         (v_tmp, 2, a_cash, v_greenway, -50000, 'none');

  begin
    perform gl_post_journal(v_tmp);
    v_fail := v_fail + 1; v_failures := v_failures || 'T10a an untagged 280E expense POSTED';
  exception when others then
    if sqlerrm like '%GL_COST_CLASS_REQUIRED%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T10a wrong error: %s', sqlerrm); end if;
  end;

  -- a cost class on a balance-sheet line is meaningless and must be refused
  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-18', 'manual', 'Cost class on a balance sheet line', v_user)
  returning id into v_tmp;
  insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_tmp, 1, a_rent, v_greenway, 50000, 'nondeductible_280e'),
         (v_tmp, 2, a_cash, v_greenway, -50000, 'cogs_direct');

  begin
    perform gl_post_journal(v_tmp);
    v_fail := v_fail + 1; v_failures := v_failures || 'T10b a cost class on a balance-sheet line POSTED';
  exception when others then
    if sqlerrm like '%GL_COST_CLASS_NOT_ALLOWED%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T10b wrong error: %s', sqlerrm); end if;
  end;

  -- =========================================================================
  -- T11. ENTITY DISCIPLINE
  -- =========================================================================
  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-19', 'manual', 'Entry spanning two sets of books', v_user)
  returning id into v_tmp;
  insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_tmp, 1, a_rent, v_greenway, 50000, 'nondeductible_280e'),
         (v_tmp, 2, a_cash, v_landhold, -50000, 'none');

  begin
    perform gl_post_journal(v_tmp);
    v_fail := v_fail + 1; v_failures := v_failures || 'T11a an entry spanning two entities POSTED';
  exception when others then
    if sqlerrm like '%GL_ENTITY_MISMATCH%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T11a wrong error: %s', sqlerrm); end if;
  end;

  -- an account restricted to the ATM entity cannot be used by greenway
  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-19', 'manual', 'ATM income booked in the wrong entity', v_user)
  returning id into v_tmp;
  insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_tmp, 1, a_cash,   v_greenway, 5000, 'none'),
         (v_tmp, 2, a_atmfee, v_greenway, -5000, 'separate_business');

  begin
    perform gl_post_journal(v_tmp);
    v_fail := v_fail + 1; v_failures := v_failures || 'T11b an entity-restricted account was used elsewhere';
  exception when others then
    if sqlerrm like '%GL_ACCOUNT_NOT_ALLOWED%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T11b wrong error: %s', sqlerrm); end if;
  end;

  -- =========================================================================
  -- T12. SINGLE-SIDED ENTRIES AND ZERO AMOUNTS
  -- =========================================================================
  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-20', 'manual', 'One-legged entry', v_user)
  returning id into v_tmp;
  insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_tmp, 1, a_cash, v_greenway, 10000, 'none');

  begin
    perform gl_post_journal(v_tmp);
    v_fail := v_fail + 1; v_failures := v_failures || 'T12a a single-sided entry POSTED';
  exception when others then
    if sqlerrm like '%GL_TOO_FEW_LINES%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T12a wrong error: %s', sqlerrm); end if;
  end;

  begin
    insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
    values (v_tmp, 2, a_cash, v_greenway, 0, 'none');
    v_fail := v_fail + 1; v_failures := v_failures || 'T12b a zero-amount line was ALLOWED';
  exception when check_violation then v_pass := v_pass + 1;
  when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T12b wrong error: %s', sqlerrm);
  end;

  -- =========================================================================
  -- T13. REVERSAL IS THE ONLY CORRECTION MECHANISM
  -- =========================================================================
  begin
    v_tmp := gl_reverse_journal(v_j, 'Booked to the wrong month', date '2026-03-21');
    v_pass := v_pass + 1;
  exception when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T13a reversal FAILED: %s', sqlerrm);
  end;

  -- the reversal arrives as a DRAFT (a human still reviews it)
  select status into v_status from gl_journals where id = v_tmp;
  if v_status = 'draft' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T13b reversal status was %s, expected draft', v_status); end if;

  -- and it is the exact mirror image: the two together net to zero
  select coalesce(sum(amount_cents), 0) into v_sum
  from gl_journal_lines where journal_id in (v_j, v_tmp);
  if v_sum = 0 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T13c original + reversal netted %s, expected 0', v_sum); end if;

  -- a reversal needs a stated reason
  begin
    perform gl_reverse_journal(v_j2, '   ', date '2026-03-21');
    v_fail := v_fail + 1; v_failures := v_failures || 'T13d a reversal with no reason was ALLOWED';
  exception when others then
    if sqlerrm like '%GL_REASON_REQUIRED%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T13d wrong error: %s', sqlerrm); end if;
  end;

  -- a draft cannot be reversed; there is nothing to reverse
  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-22', 'manual', 'Still a draft', v_user)
  returning id into v_j2;
  begin
    perform gl_reverse_journal(v_j2, 'trying to reverse a draft', date '2026-03-22');
    v_fail := v_fail + 1; v_failures := v_failures || 'T13e a DRAFT was reversed';
  exception when others then
    if sqlerrm like '%GL_NOT_POSTED%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T13e wrong error: %s', sqlerrm); end if;
  end;

  -- =========================================================================
  -- T14. PERIOD CLOSE AND LOCK
  -- =========================================================================
  -- Clean up drafts in March so the period is closable.
  delete from gl_journal_lines
  where journal_id in (select id from gl_journals where status = 'draft');
  delete from gl_journals where status = 'draft';

  select id into v_period from gl_periods
  where entity_id = v_greenway and fiscal_year = 2026 and period_no = 3;

  begin
    perform gl_close_period(v_period, 'March 2026 close');
    v_pass := v_pass + 1;
  exception when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T14a close FAILED: %s', sqlerrm);
  end;

  -- nothing may post into a closed period
  insert into gl_journals (entity_id, journal_date, source_kind, memo, created_by)
  values (v_greenway, date '2026-03-25', 'manual', 'Backdating into a closed month', v_user)
  returning id into v_tmp;
  insert into gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents, cost_class)
  values (v_tmp, 1, a_rent, v_greenway, 1000, 'nondeductible_280e'),
         (v_tmp, 2, a_cash, v_greenway, -1000, 'none');

  begin
    perform gl_post_journal(v_tmp);
    v_fail := v_fail + 1; v_failures := v_failures || 'T14b an entry POSTED into a CLOSED period';
  exception when others then
    if sqlerrm like '%GL_PERIOD_CLOSED%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T14b wrong error: %s', sqlerrm); end if;
  end;

  -- reopening is possible (with a reason) while merely closed
  begin
    perform gl_reopen_period(v_period, 'Late vendor invoice discovered');
    v_pass := v_pass + 1;
  exception when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T14c reopen FAILED: %s', sqlerrm);
  end;

  -- once LOCKED, it is permanent
  update gl_periods set status = 'locked' where id = v_period;
  begin
    perform gl_reopen_period(v_period, 'trying to reopen a locked period');
    v_fail := v_fail + 1; v_failures := v_failures || 'T14d a LOCKED period was reopened';
  exception when others then
    if sqlerrm like '%GL_PERIOD_LOCKED%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T14d wrong error: %s', sqlerrm); end if;
  end;

  -- =========================================================================
  -- T15. THE AUDIT TRAIL IS APPEND-ONLY
  -- =========================================================================
  select count(*) into v_count from gl_audit_events;
  if v_count > 0 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || 'T15a no audit events were recorded'; end if;

  begin
    update gl_audit_events set detail = 'tampered' where id = (select id from gl_audit_events limit 1);
    v_fail := v_fail + 1; v_failures := v_failures || 'T15b an audit event was EDITED';
  exception when others then
    if sqlerrm like '%GL_IMMUTABLE%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T15b wrong error: %s', sqlerrm); end if;
  end;

  begin
    delete from gl_audit_events where id = (select id from gl_audit_events limit 1);
    v_fail := v_fail + 1; v_failures := v_failures || 'T15c an audit event was DELETED';
  exception when others then
    if sqlerrm like '%GL_IMMUTABLE%' then v_pass := v_pass + 1;
    else v_fail := v_fail + 1; v_failures := v_failures || format('T15c wrong error: %s', sqlerrm); end if;
  end;

  -- =========================================================================
  -- T16. ALLOCATION CONFIGS REQUIRE DOCUMENTATION (CHAMP doctrine)
  -- =========================================================================
  begin
    insert into gl_allocation_configs
      (entity_id, code, name, rate_milli_pct, effective_from, document_ref, basis_note)
    values (v_greenway, 'rent_cogs_pct', 'Rent split to COGS', 35000, date '2026-01-01', '', 'square footage study');
    v_fail := v_fail + 1; v_failures := v_failures || 'T16a an allocation with no document reference was ALLOWED';
  exception when check_violation then v_pass := v_pass + 1;
  when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T16a wrong error: %s', sqlerrm);
  end;

  -- ...and one with a written basis and a document reference is accepted.
  begin
    insert into gl_allocation_configs
      (entity_id, code, name, rate_milli_pct, effective_from, document_ref, basis_note, approved_by)
    values (v_greenway, 'rent_cogs_pct', 'Rent split to COGS', 35000, date '2026-01-01',
            'DOC-2026-001 square footage study',
            'Processing and storage areas measured at 35% of leased square footage.',
            'Nicholas Mullan');
    v_pass := v_pass + 1;
  exception when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T16b a documented allocation was REJECTED: %s', sqlerrm);
  end;

  -- a rate above 100% is nonsense and must be refused
  begin
    insert into gl_allocation_configs
      (entity_id, code, name, rate_milli_pct, effective_from, document_ref, basis_note)
    values (v_greenway, 'bad_rate', 'Impossible rate', 150000, date '2026-01-01',
            'DOC-X', 'over one hundred percent');
    v_fail := v_fail + 1; v_failures := v_failures || 'T16c an allocation rate above 100% was ALLOWED';
  exception when check_violation then v_pass := v_pass + 1;
  when others then
    v_fail := v_fail + 1; v_failures := v_failures || format('T16c wrong error: %s', sqlerrm);
  end;

  -- =========================================================================
  -- T17. THE LEDGER AS A WHOLE ALWAYS BALANCES
  -- =========================================================================
  select coalesce(sum(amount_cents), 0) into v_sum
  from gl_journal_lines l
  join gl_journals j on j.id = l.journal_id
  where j.status = 'posted';

  if v_sum = 0 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; v_failures := v_failures || format('T17 THE POSTED LEDGER DOES NOT BALANCE: off by %s cents', v_sum); end if;

  -- =========================================================================
  -- results
  -- =========================================================================
  raise notice '';
  raise notice '==========================================================';
  if v_fail = 0 then
    raise notice 'GL SCHEMA TESTS: ALL % PASSED', v_pass;
    raise notice '==========================================================';
  else
    raise notice 'GL SCHEMA TESTS: % passed, % FAILED', v_pass, v_fail;
    raise notice '----------------------------------------------------------';
    for v_count in 1 .. array_length(v_failures, 1) loop
      raise notice '  FAIL: %', v_failures[v_count];
    end loop;
    raise notice '==========================================================';
    raise exception 'GL SCHEMA TESTS FAILED (% failures)', v_fail;
  end if;
end
$suite$;
