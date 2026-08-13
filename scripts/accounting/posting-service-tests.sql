-- scripts/accounting/posting-service-tests.sql
-- =============================================================================
-- ADVERSARIAL SUITE FOR MIGRATION 0174 (the posting service). NOT A MIGRATION.
-- =============================================================================
-- Owner directive: "test and break and harden and validate."
--
-- 0172 built the vault and 0174 built the door. This file tries to get through
-- the door improperly: post the same sale twice, edit an invoice after the fact,
-- auto-post an accrual, sneak a $4.6M plug past the ceiling, half-post an
-- intercompany transfer, widen a tolerance without saying why, and rewrite the
-- change log afterwards to hide it.
--
-- Every assertion names the SPECIFIC error code it expects. A test that passes
-- because something unrelated broke is worse than no test (standing rule 13c).
--
-- The whole suite runs in ONE transaction that is rolled back at the end, so it
-- leaves the database exactly as it found it.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- --- scaffolding -------------------------------------------------------------
create or replace function pg_temp.expect_error(
  p_sql text, p_fragment text, p_label text
) returns void language plpgsql as $$
declare v_msg text;
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

create or replace function pg_temp.expect_ok(
  p_sql text, p_label text
) returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice '  pass: % (accepted, as it should be)', p_label;
exception when others then
  raise exception 'FAIL [%]: statement was REFUSED but should have been accepted: % | SQL: %', p_label, SQLERRM, p_sql;
end $$;

create or replace function pg_temp.assert(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'FAIL [%]', p_label;
  end if;
  raise notice '  pass: %', p_label;
end $$;

create or replace function pg_temp.admin_id() returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from auth.users limit 1;
  if v is null then
    insert into auth.users (email) values ('michael@greenwaymarijuana.com') returning id into v;
  end if;
  return v;
end $$;

-- Two real, balanced lines against the seeded chart, so every test below is
-- exercising the door rather than tripping over a bad account code.
create or replace function pg_temp.sale_lines(p_cents bigint default 5000)
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('account_code', '10100', 'amount_cents',  p_cents),
    jsonb_build_object('account_code', '50010', 'amount_cents', -p_cents)
  );
$$;

-- A fully approved, active bank template, returned by code.
create or replace function pg_temp.mk_template(
  p_code text default 'UTIL-PSE',
  p_kind text default 'bank',
  p_entity text default 'greenway',
  p_max bigint default 500000,
  p_abs bigint default 500,
  p_pct integer default 1000,
  p_active boolean default true
) returns text language plpgsql as $$
declare v_entity uuid;
begin
  select id into v_entity from public.gl_entities where code = p_entity;
  insert into public.gl_posting_templates
    (code, entity_id, source_kind, description, is_active, approved_by, approved_at,
     effective_from, tol_abs_cents, tol_milli_pct, max_autopost_cents, change_reason)
  values
    (p_code, v_entity, p_kind, 'battle-test template for ' || p_kind, p_active,
     case when p_active then pg_temp.admin_id() else null end,
     case when p_active then now() else null end,
     date '2026-01-01', p_abs, p_pct, p_max,
     'created by the adversarial suite to prove the gate holds');
  return p_code;
end $$;

\echo ''
\echo '=================================================================='
\echo 'ATTACKING THE POSTING SERVICE (migration 0174)'
\echo '=================================================================='

-- =============================================================================
-- ATTACK 1: post the same sale twice.
-- =============================================================================
\echo ''
\echo '--- 1. the same real-world event, submitted repeatedly ---'
savepoint s1;
do $$
declare
  v1 jsonb; v2 jsonb; v_count int;
begin
  v1 := public.gl_submit_journal(
    'greenway', date '2026-03-15', 'pos_sale', 'S-2026-03-15-0042',
    'retail sale', pg_temp.sale_lines(5000));
  perform pg_temp.assert(v1->>'outcome' = 'created', 'the first submission creates a journal');

  -- Same event again: a webhook redelivery, a double-click, a replayed import.
  v2 := public.gl_submit_journal(
    'greenway', date '2026-03-15', 'pos_sale', 'S-2026-03-15-0042',
    'retail sale', pg_temp.sale_lines(5000));
  perform pg_temp.assert(v2->>'outcome' = 'duplicate', 'the second submission is recognised as a duplicate');
  perform pg_temp.assert(v2->>'journal_id' = v1->>'journal_id', 'the duplicate returns the ORIGINAL journal, not a new one');

  -- Eight more times for good measure.
  for i in 1..8 loop
    perform public.gl_submit_journal(
      'greenway', date '2026-03-15', 'pos_sale', 'S-2026-03-15-0042',
      'retail sale', pg_temp.sale_lines(5000));
  end loop;

  select count(*) into v_count from public.gl_journals where source_ref = 'S-2026-03-15-0042';
  perform pg_temp.assert(v_count = 1, 'ten submissions of one sale produced exactly ONE journal');

  select count(*) into v_count from public.gl_journal_lines l
    join public.gl_journals j on j.id = l.journal_id
   where j.source_ref = 'S-2026-03-15-0042';
  perform pg_temp.assert(v_count = 2, 'and exactly TWO lines, not twenty');
end $$;
rollback to savepoint s1;

-- =============================================================================
-- ATTACK 2: the conflict — same invoice number, different money.
-- =============================================================================
\echo ''
\echo '--- 2. an invoice edited after the fact ---'
savepoint s2;
do $$
begin
  perform public.gl_submit_journal(
    'greenway', date '2026-03-15', 'purchase', 'INV-77',
    'vendor bill', pg_temp.sale_lines(250000));

  -- Same invoice number, different amount. Returning the original would hide
  -- it; posting the new one would double-count it. Both are drift.
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal(
      'greenway', date '2026-03-15', 'purchase', 'INV-77',
      'vendor bill (revised)', pg_temp.sale_lines(260000))
  $q$, 'GL_POST_CONFLICT',
  'the same invoice number arriving with a different amount');

  -- A changed ACCOUNT with the same amount is equally a conflict.
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal(
      'greenway', date '2026-03-15', 'purchase', 'INV-77', 'vendor bill (re-coded)',
      jsonb_build_array(
        jsonb_build_object('account_code','10110','amount_cents', 250000),
        jsonb_build_object('account_code','50010','amount_cents',-250000)))
  $q$, 'GL_POST_CONFLICT',
  'the same invoice re-coded to a different account');
end $$;
rollback to savepoint s2;

-- =============================================================================
-- ATTACK 3: automate the things that must never automate.
-- =============================================================================
\echo ''
\echo '--- 3. auto-posting judgment calls ---'
savepoint s3;
do $$
declare k text;
begin
  -- Every non-evidence-derived kind, swept. Not a sample: ALL of them.
  foreach k in array array['manual','opening_balance','payroll','inventory','loan',
                           'crypto','atm','intercompany','depreciation','accrual',
                           'close','reversal']
  loop
    perform pg_temp.expect_error(format($q$
      select public.gl_submit_journal(
        'greenway', date '2026-03-15', %L, 'REF-%s', 'attempt to automate',
        pg_temp.sale_lines(5000), 'ANY-TEMPLATE', 5000, true, null, null, true)
    $q$, k, k), 'GL_AUTOPOST_NOT_ELIGIBLE',
    format('auto-posting a %s entry', k));
  end loop;

  -- And the table itself refuses to even HOLD a template for them, so no future
  -- code can create one. This is the structural guarantee behind the check above.
  foreach k in array array['manual','opening_balance','payroll','inventory','loan',
                           'crypto','atm','intercompany','depreciation','accrual',
                           'close','reversal']
  loop
    perform pg_temp.expect_error(format($q$
      insert into public.gl_posting_templates
        (code, entity_id, source_kind, description, effective_from,
         max_autopost_cents, change_reason)
      values ('T-%s', (select id from public.gl_entities where code='greenway'), %L,
              'a template that should not be creatable', date '2026-01-01',
              100000, 'trying to create a forbidden template')
    $q$, k, k), 'gl_posting_templates_source_kind_check',
    format('creating a posting template for %s at all', k));
  end loop;
end $$;
rollback to savepoint s3;

-- =============================================================================
-- ATTACK 4: the template gauntlet.
-- =============================================================================
\echo ''
\echo '--- 4. every way a template can fail to authorise a post ---'
savepoint s4;
do $$
begin
  perform pg_temp.mk_template('UTIL-PSE');

  -- NEGATIVE CONTROL FIRST. If the happy path does not work, every refusal
  -- below would "pass" for the wrong reason and this suite would be worthless.
  perform pg_temp.expect_ok($q$
    select public.gl_submit_journal(
      'greenway', date '2026-03-15', 'bank', 'PSE-OK', 'the electric bill',
      pg_temp.sale_lines(42350), 'UTIL-PSE', 42350, true)
  $q$, 'CONTROL: a clean, approved, in-tolerance bank entry DOES auto-post');

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'X1', 'no template named',
      pg_temp.sale_lines(5000), null, 5000, true)
  $q$, 'GL_AUTOPOST_NO_TEMPLATE', 'auto-posting with no template at all');

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'X2', 'template does not exist',
      pg_temp.sale_lines(5000), 'NO-SUCH-TEMPLATE', 5000, true)
  $q$, 'GL_AUTOPOST_NO_TEMPLATE', 'auto-posting through a template that does not exist');

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('landholding', date '2026-03-15', 'bank', 'X3', 'wrong books',
      jsonb_build_array(
        jsonb_build_object('account_code','10100','amount_cents', 5000),
        jsonb_build_object('account_code','50010','amount_cents',-5000)),
      'UTIL-PSE', 5000, true)
  $q$, 'GL_AUTOPOST_WRONG_ENTITY',
  'using a Greenway template to post into the landholding books');

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'excise', 'X4', 'excise on a utility template',
      pg_temp.sale_lines(5000), 'UTIL-PSE', 5000, true)
  $q$, 'GL_AUTOPOST_WRONG_SOURCE_KIND',
  'posting cannabis excise through a template built for utilities');

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'purchase', 'X5', 'no three-way match',
      pg_temp.sale_lines(5000), 'UTIL-PSE', 5000, true, null, null, false)
  $q$, 'GL_AUTOPOST_NO_THREE_WAY_MATCH',
  'auto-posting a bill whose PO, receipt and invoice do not agree');
end $$;
rollback to savepoint s4;

-- =============================================================================
-- ATTACK 5: inactive / unapproved / expired templates.
-- =============================================================================
\echo ''
\echo '--- 5. templates that must not fire ---'
savepoint s5;
do $$
declare v_entity uuid;
begin
  select id into v_entity from public.gl_entities where code = 'greenway';

  -- The database refuses to store an ACTIVE template nobody approved.
  perform pg_temp.expect_error($q$
    insert into public.gl_posting_templates
      (code, entity_id, source_kind, description, is_active, effective_from,
       max_autopost_cents, change_reason)
    values ('ROGUE', (select id from public.gl_entities where code='greenway'), 'bank',
            'active but never approved', true, date '2026-01-01', 100000,
            'attempting to activate without approval')
  $q$, 'gl_posting_templates_active_requires_approval',
  'storing an ACTIVE template that nobody ever approved');

  -- Half an approval is no approval.
  perform pg_temp.expect_error($q$
    insert into public.gl_posting_templates
      (code, entity_id, source_kind, description, approved_by, effective_from,
       max_autopost_cents, change_reason)
    values ('HALF', (select id from public.gl_entities where code='greenway'), 'bank',
            'approved by somebody at no particular time', pg_temp.admin_id(),
            date '2026-01-01', 100000, 'half an approval')
  $q$, 'gl_posting_templates_approval_pairing',
  'an approver with no approval date');

  -- An inactive template does not fire.
  perform pg_temp.mk_template('PARKED', 'bank', 'greenway', 500000, 500, 1000, false);
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'X6', 'parked template',
      pg_temp.sale_lines(5000), 'PARKED', 5000, true)
  $q$, 'GL_AUTOPOST_TEMPLATE_INACTIVE', 'firing a template that was switched off');

  -- Effective window, both edges.
  insert into public.gl_posting_templates
    (code, entity_id, source_kind, description, is_active, approved_by, approved_at,
     effective_from, effective_to, tol_abs_cents, tol_milli_pct, max_autopost_cents, change_reason)
  values ('WINDOW', v_entity, 'bank', 'a template with a closed window', true,
          pg_temp.admin_id(), now(), date '2026-06-01', date '2026-06-30',
          500, 1000, 500000, 'window template for the adversarial suite');

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-05-31', 'bank', 'X7', 'one day early',
      pg_temp.sale_lines(5000), 'WINDOW', 5000, true)
  $q$, 'GL_AUTOPOST_TEMPLATE_NOT_YET_EFFECTIVE', 'firing one day before the template begins');

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-07-01', 'bank', 'X8', 'one day late',
      pg_temp.sale_lines(5000), 'WINDOW', 5000, true)
  $q$, 'GL_AUTOPOST_TEMPLATE_EXPIRED', 'firing one day after the template expires');

  -- NEGATIVE CONTROL: the edges themselves are inclusive and DO work.
  perform pg_temp.expect_ok($q$
    select public.gl_submit_journal('greenway', date '2026-06-01', 'bank', 'X9', 'first valid day',
      pg_temp.sale_lines(5000), 'WINDOW', 5000, true)
  $q$, 'CONTROL: the first day of the window works');
  perform pg_temp.expect_ok($q$
    select public.gl_submit_journal('greenway', date '2026-06-30', 'bank', 'X10', 'last valid day',
      pg_temp.sale_lines(5000), 'WINDOW', 5000, true)
  $q$, 'CONTROL: the last day of the window works');

  -- A template cannot be made effective before the books begin.
  perform pg_temp.expect_error($q$
    insert into public.gl_posting_templates
      (code, entity_id, source_kind, description, effective_from,
       max_autopost_cents, change_reason)
    values ('PREHISTORIC', (select id from public.gl_entities where code='greenway'), 'bank',
            'effective before the line in the sand', date '2025-12-01', 100000,
            'attempting to predate the books')
  $q$, 'gl_posting_templates_line_in_the_sand',
  'a template effective before 2026-01-01');
end $$;
rollback to savepoint s5;

-- =============================================================================
-- ATTACK 6: the ceiling and the tolerance — THE $4.6M REPLAY.
-- =============================================================================
\echo ''
\echo '--- 6. the ceiling, the tolerance, and the LAZY INVENTORY ENTRY ---'
savepoint s6;
do $$
begin
  perform pg_temp.mk_template('UTIL-PSE', 'bank', 'greenway', 100000, 500, 1500);

  -- THE HEADLINE REPLAY. $4,624,697.31 — the actual plug from the old Sage
  -- file — wearing a disguise as an ordinary bank entry with a valid, approved
  -- template. The ceiling stops it.
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'LAZY-INVENTORY-ENTRY',
      'the 4.6 million dollar plug, in disguise', pg_temp.sale_lines(462469731),
      'UTIL-PSE', 462469731, true)
  $q$, 'GL_AUTOPOST_OVER_LIMIT',
  'THE $4,624,697.31 PLUG auto-posting through an approved template');

  -- Boundary: exactly on the ceiling is fine, one cent over is not.
  perform pg_temp.expect_ok($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'CEIL-EXACT',
      'exactly at the ceiling', pg_temp.sale_lines(100000), 'UTIL-PSE', 100000, true)
  $q$, 'CONTROL: an entry exactly ON the ceiling posts');

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'CEIL-OVER',
      'one cent over the ceiling', pg_temp.sale_lines(100001), 'UTIL-PSE', 100001, true)
  $q$, 'GL_AUTOPOST_OVER_LIMIT', 'an entry one cent over the ceiling');

  -- Tolerance boundary. 1.5% of 100000 = 1500 cents allowance.
  perform pg_temp.expect_ok($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'TOL-EDGE',
      'exactly on the tolerance edge', pg_temp.sale_lines(98500), 'UTIL-PSE', 100000, true)
  $q$, 'CONTROL: a variance exactly on the tolerance edge posts');

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'TOL-OVER',
      'one cent past the tolerance', pg_temp.sale_lines(98499), 'UTIL-PSE', 100000, true)
  $q$, 'GL_AUTOPOST_OUT_OF_TOLERANCE', 'a variance one cent past the tolerance');
end $$;
rollback to savepoint s6;

-- =============================================================================
-- ATTACK 7: nothing may bypass gl_post_journal's own rules.
-- =============================================================================
\echo ''
\echo '--- 7. the door does not weaken the vault ---'
savepoint s7;
do $$
begin
  perform pg_temp.mk_template('UTIL-PSE');

  -- Out of balance.
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'UNBAL', 'does not balance',
      jsonb_build_array(
        jsonb_build_object('account_code','10100','amount_cents', 5000),
        jsonb_build_object('account_code','50010','amount_cents',-4000)),
      'UTIL-PSE', 5000, true)
  $q$, 'GL_OUT_OF_BALANCE', 'auto-posting an entry whose debits do not equal its credits');

  -- One line is not double-entry.
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'ONELINE', 'single sided',
      jsonb_build_array(jsonb_build_object('account_code','10100','amount_cents', 5000)),
      'UTIL-PSE', 5000, true)
  $q$, 'GL_TOO_FEW_LINES', 'a single-sided entry');

  -- The line in the sand still holds through the new door.
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2025-11-30', 'bank', 'PREHIST', 'before the books began',
      pg_temp.sale_lines(5000), 'UTIL-PSE', 5000, true)
  $q$, 'gl_journals_line_in_the_sand', 'an entry dated before the line in the sand');

  -- An account that does not exist is a hard failure, never a skipped line.
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'BADACCT', 'bad account code',
      jsonb_build_array(
        jsonb_build_object('account_code','99999','amount_cents', 5000),
        jsonb_build_object('account_code','50010','amount_cents',-5000)),
      'UTIL-PSE', 5000, true)
  $q$, 'GL_UNKNOWN_ACCOUNT', 'a line referring to an account that is not in the chart');

  -- Unknown entity.
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('not_a_business', date '2026-03-15', 'bank', 'BADENT', 'no such books',
      pg_temp.sale_lines(5000), 'UTIL-PSE', 5000, true)
  $q$, 'GL_UNKNOWN_ENTITY', 'posting into a set of books that does not exist');

  -- A closed period still refuses, even through the automatic door.
  update public.gl_periods set status = 'closed'
   where entity_id = (select id from public.gl_entities where code='greenway')
     and fiscal_year = 2026 and period_no = 3;

  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'CLOSEDP', 'into a closed month',
      pg_temp.sale_lines(5000), 'UTIL-PSE', 5000, true)
  $q$, 'GL_PERIOD_CLOSED', 'auto-posting into a month that has been closed');
end $$;
rollback to savepoint s7;

-- =============================================================================
-- ATTACK 8: nothing is left behind when a post is refused.
-- =============================================================================
\echo ''
\echo '--- 8. atomicity: a refused post leaves NO trace ---'
savepoint s8;
do $$
declare v_before int; v_after int; v_lines_before int; v_lines_after int;
begin
  perform pg_temp.mk_template('UTIL-PSE', 'bank', 'greenway', 100000);

  select count(*) into v_before from public.gl_journals;
  select count(*) into v_lines_before from public.gl_journal_lines;

  -- This fails at the ceiling check, which happens AFTER the header and lines
  -- have been inserted. If the function were not atomic, an orphaned draft
  -- would be left behind every time an automatic entry was rejected — and the
  -- books would slowly fill with phantom drafts nobody ever created.
  begin
    perform public.gl_submit_journal('greenway', date '2026-03-15', 'bank', 'ORPHAN',
      'should leave nothing behind', pg_temp.sale_lines(900000), 'UTIL-PSE', 900000, true);
  exception when others then
    null;
  end;

  select count(*) into v_after from public.gl_journals;
  select count(*) into v_lines_after from public.gl_journal_lines;

  perform pg_temp.assert(v_before = v_after, 'a refused auto-post leaves no orphan journal header');
  perform pg_temp.assert(v_lines_before = v_lines_after, 'a refused auto-post leaves no orphan journal lines');
end $$;
rollback to savepoint s8;

-- =============================================================================
-- ATTACK 9: intercompany — both halves or neither.
-- =============================================================================
\echo ''
\echo '--- 9. the Geiger rent: both halves or neither ---'
savepoint s9;
do $$
declare v_ref uuid := gen_random_uuid(); v_count int;
begin
  -- The happy path: $2,000 rent, expense in greenway, income in landholding.
  -- Real codes from the seeded chart: 70010 Rent (expense, requires a 280E cost
  -- class), 10200 Bank — Operating (open to every entity), 52000 Rental Income
  -- (restricted to landholding, which is exactly right).
  perform public.gl_submit_intercompany_pair(
    v_ref, date '2026-03-01', 'March rent, Geiger property',
    'greenway', jsonb_build_array(
      jsonb_build_object('account_code','70010','amount_cents', 200000, 'cost_class','nondeductible_280e'),
      jsonb_build_object('account_code','10200','amount_cents',-200000)), 'RENT-2026-03-GW',
    'landholding', jsonb_build_array(
      jsonb_build_object('account_code','10200','amount_cents', 200000),
      jsonb_build_object('account_code','52000','amount_cents',-200000)), 'RENT-2026-03-LH');

  select count(*) into v_count from public.gl_journals where intercompany_ref = v_ref;
  perform pg_temp.assert(v_count = 2, 'a valid intercompany transfer creates exactly two halves');

  select count(*) into v_count from public.gl_journals
   where intercompany_ref = v_ref and status = 'draft';
  perform pg_temp.assert(v_count = 2, 'and BOTH halves are drafts — intercompany never auto-posts');

  -- Now break the second half. Neither half may survive.
  perform pg_temp.expect_error($q$
    select public.gl_submit_intercompany_pair(
      gen_random_uuid(), date '2026-03-01', 'a transfer whose second half is broken',
      'greenway', jsonb_build_array(
        jsonb_build_object('account_code','70010','amount_cents', 200000, 'cost_class','nondeductible_280e'),
        jsonb_build_object('account_code','10200','amount_cents',-200000)), 'HALF-A-OK',
      'landholding', jsonb_build_array(
        jsonb_build_object('account_code','99999','amount_cents', 200000),
        jsonb_build_object('account_code','52000','amount_cents',-200000)), 'HALF-B-BAD')
  $q$, 'GL_UNKNOWN_ACCOUNT', 'an intercompany transfer whose second half is invalid');

  select count(*) into v_count from public.gl_journals where source_ref = 'HALF-A-OK';
  perform pg_temp.assert(v_count = 0, 'the GOOD first half was rolled back too — no orphaned half-transfer');

  -- A transfer must have two different sets of books, and a shared reference.
  perform pg_temp.expect_error($q$
    select public.gl_submit_intercompany_pair(
      gen_random_uuid(), date '2026-03-01', 'same books both sides',
      'greenway', pg_temp.sale_lines(1000), 'A1',
      'greenway', pg_temp.sale_lines(1000), 'B1')
  $q$, 'GL_INTERCOMPANY_SAME_ENTITY', 'an intercompany transfer between one entity and itself');

  perform pg_temp.expect_error($q$
    select public.gl_submit_intercompany_pair(
      null, date '2026-03-01', 'no shared reference',
      'greenway', pg_temp.sale_lines(1000), 'A2',
      'landholding', jsonb_build_array(
        jsonb_build_object('account_code','10200','amount_cents', 1000),
        jsonb_build_object('account_code','52000','amount_cents',-1000)), 'B2')
  $q$, 'GL_INTERCOMPANY_NO_REF', 'an intercompany transfer with no shared reference');
end $$;
rollback to savepoint s9;

-- =============================================================================
-- ATTACK 10: rewriting the rules quietly.
-- =============================================================================
\echo ''
\echo '--- 10. widening a tolerance without saying why ---'
savepoint s10;
do $$
declare v_count int; v_before int;
begin
  perform pg_temp.mk_template('UTIL-PSE');

  select count(*) into v_count from public.gl_template_changes where template_code = 'UTIL-PSE';
  perform pg_temp.assert(v_count = 1, 'creating a template records a change with its reason');

  -- THE PUSHBACK, ENFORCED. Michael asked for tolerances that loosen themselves
  -- once the system has learned the patterns. A tolerance can still be widened —
  -- but only by a person, and only with a NEW sentence explaining why, which is
  -- then on the record permanently.
  perform pg_temp.expect_error($q$
    update public.gl_posting_templates
       set tol_milli_pct = 50000
     where code = 'UTIL-PSE'
  $q$, 'GL_TEMPLATE_NEEDS_REASON',
  'widening a tolerance by 50x without writing down why');

  perform pg_temp.expect_ok($q$
    update public.gl_posting_templates
       set tol_milli_pct = 2000,
           change_reason = 'PSE billing varies seasonally; twelve months of history reviewed with Nicholas on 2026-11-01'
     where code = 'UTIL-PSE'
  $q$, 'CONTROL: widening a tolerance WITH a written reason is allowed');

  select count(*) into v_count from public.gl_template_changes where template_code = 'UTIL-PSE';
  perform pg_temp.assert(v_count = 2, 'the widening is now permanently on the record');

  -- And the record cannot be rewritten to hide it.
  perform pg_temp.expect_error($q$
    update public.gl_template_changes set reason = 'nothing to see here' where template_code = 'UTIL-PSE'
  $q$, 'GL_APPEND_ONLY', 'editing the template change log to hide a widening');

  perform pg_temp.expect_error($q$
    delete from public.gl_template_changes where template_code = 'UTIL-PSE'
  $q$, 'GL_APPEND_ONLY', 'deleting the template change log');

  -- A ceiling of zero or less would disable the backstop entirely.
  perform pg_temp.expect_error($q$
    update public.gl_posting_templates
       set max_autopost_cents = 0,
           change_reason = 'attempting to disable the ceiling'
     where code = 'UTIL-PSE'
  $q$, 'gl_posting_templates_max_autopost_cents_check', 'setting the ceiling to zero');
end $$;
rollback to savepoint s10;

-- =============================================================================
-- ATTACK 11: idempotency keys that try to collide.
-- =============================================================================
\echo ''
\echo '--- 11. forging an idempotency key ---'
savepoint s11;
do $$
begin
  -- ("bank","a:b") must not collide with ("bank:a","b").
  perform pg_temp.assert(
    public.gl_idempotency_key('greenway','bank','a:b') <> public.gl_idempotency_key('greenway','bank:a','b'),
    'a colon smuggled into a component cannot forge another key');

  perform pg_temp.assert(
    public.gl_idempotency_key('  GREENWAY ',' Bank ',' S-1 ') = public.gl_idempotency_key('greenway','bank','S-1'),
    'casing and whitespace cannot dodge the key');

  perform pg_temp.expect_error($q$
    select public.gl_idempotency_key('greenway','bank','   ')
  $q$, 'GL_NO_IDEMPOTENCY_KEY', 'building a key from a blank source reference');

  -- An automatic entry with no source reference is refused outright: without one
  -- there is nothing to be idempotent ON, so a retry would post twice.
  perform pg_temp.mk_template('UTIL-PSE');
  perform pg_temp.expect_error($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'bank', null, 'no reference at all',
      pg_temp.sale_lines(5000), 'UTIL-PSE', 5000, true)
  $q$, 'GL_NO_IDEMPOTENCY_KEY', 'an automatic entry carrying no source reference');

  -- A hand-keyed manual DRAFT, however, is allowed without one.
  perform pg_temp.expect_ok($q$
    select public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
      'a hand-keyed adjusting entry', pg_temp.sale_lines(5000))
  $q$, 'CONTROL: a hand-keyed manual draft needs no source reference');
end $$;
rollback to savepoint s11;

-- =============================================================================
-- ATTACK 12: the fingerprint must not confuse different entries.
-- =============================================================================
\echo ''
\echo '--- 12. the fingerprint ---'
savepoint s12;
do $$
begin
  perform pg_temp.assert(
    public.gl_line_fingerprint(jsonb_build_array(
      jsonb_build_object('account_code','10100','amount_cents',1000),
      jsonb_build_object('account_code','50010','amount_cents',-1000)))
    =
    public.gl_line_fingerprint(jsonb_build_array(
      jsonb_build_object('account_code','50010','amount_cents',-1000),
      jsonb_build_object('account_code','10100','amount_cents',1000))),
    'line order does not change the fingerprint');

  perform pg_temp.assert(
    public.gl_line_fingerprint(jsonb_build_array(
      jsonb_build_object('account_code','60010','amount_cents',5000,'cost_class','cogs_direct')))
    <>
    public.gl_line_fingerprint(jsonb_build_array(
      jsonb_build_object('account_code','60010','amount_cents',5000,'cost_class','nondeductible_280e'))),
    'the same money with a DIFFERENT 280E cost class is a different entry');

  perform pg_temp.assert(
    public.gl_line_fingerprint(jsonb_build_array(jsonb_build_object('account_code','10120','amount_cents',5000)))
    <>
    public.gl_line_fingerprint(jsonb_build_array(jsonb_build_object('account_code','10120','amount_cents',-5000))),
    'a backwards sign is a different entry, not a duplicate');

  -- The SQL fingerprint must agree with the TypeScript one, or the database and
  -- the application would disagree about what "the same event" means.
  perform pg_temp.assert(
    public.gl_line_fingerprint(jsonb_build_array(
      jsonb_build_object('account_code','10100','amount_cents',1000),
      jsonb_build_object('account_code','50010','amount_cents',-1000)))
    = '10100|1000|none;50010|-1000|none',
    'the SQL fingerprint format matches fingerprintLines() in posting-core.ts');
end $$;
rollback to savepoint s12;

-- =============================================================================
-- ATTACK 13: gapless journal numbers under repeated posting.
-- =============================================================================
\echo ''
\echo '--- 13. journal numbers stay gapless ---'
savepoint s13;
do $$
declare v_min bigint; v_max bigint; v_count bigint; v_distinct bigint;
begin
  perform pg_temp.mk_template('UTIL-PSE', 'bank', 'greenway', 100000000);

  for i in 1..25 loop
    perform public.gl_submit_journal('greenway', date '2026-03-15', 'bank',
      'SEQ-' || i::text, 'sequence test entry ' || i::text,
      pg_temp.sale_lines(1000 + i), 'UTIL-PSE', 1000 + i, true);
  end loop;

  select count(*), count(distinct journal_no), min(journal_no), max(journal_no)
    into v_count, v_distinct, v_min, v_max
  from public.gl_journals
  where status = 'posted'
    and entity_id = (select id from public.gl_entities where code='greenway');

  perform pg_temp.assert(v_count = v_distinct, 'no two posted journals share a number');
  perform pg_temp.assert(v_max - v_min + 1 = v_count, 'the journal numbers have no gaps');
end $$;
rollback to savepoint s13;

\echo ''
\echo '--- 14. THE BOUNCER: segregation of duties on the manual path ---'
savepoint s14;
do $$
declare
  v_author  uuid := pg_temp.admin_id();
  v_other   uuid;
  v_ent     uuid := (select id from public.gl_entities where code='greenway');
  v_jid     uuid;
  v_res     jsonb;
  v_thr     bigint;
begin
  insert into auth.users (email) values ('grandpa@example.com') returning id into v_other;

  -- Act as a real signed-in person, because segregation of duties is a claim
  -- about WHO: with nobody signed in there is no author to compare against.
  perform set_config('harness.user_id', v_author::text, true);

  -- The policy must have been seeded for EVERY entity, or the guard fails open
  -- for whichever one was missed.
  perform pg_temp.assert(
    (select count(*) from public.gl_entities) = (select count(*) from public.gl_approval_policy),
    'every set of books got an approval policy');

  select threshold_cents into v_thr from public.gl_approval_policy where entity_id = v_ent;
  perform pg_temp.assert(v_thr = 500000, 'the default threshold is $5,000.00');

  -- ---- BELOW the threshold: no approver needed. This is the NEGATIVE CONTROL.
  -- If this fails, the guard is refusing everything and the "passes" below are
  -- meaningless (standing rule 15b).
  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'small manual entry, under the threshold', pg_temp.sale_lines(1000));
  v_jid := (v_res->>'journal_id')::uuid;
  perform pg_temp.assert((v_res->>'needs_second_approver')::boolean = false,
    'CONTROL: a small entry is told up front it needs no second approver');
  perform pg_temp.expect_ok(
    format('select public.gl_post_journal(%L)', v_jid),
    'CONTROL: a small manual entry posts with no approval at all');

  -- ---- AT the threshold, unapproved: refused. (Boundary: exactly at, not over.)
  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'manual entry exactly at the threshold', pg_temp.sale_lines(500000));
  v_jid := (v_res->>'journal_id')::uuid;
  perform pg_temp.assert((v_res->>'needs_second_approver')::boolean = true,
    'THE VESTIBULE: a large draft is warned at creation that it needs a second approver');
  perform pg_temp.expect_error(
    format('select public.gl_post_journal(%L)', v_jid),
    'GL_APPROVAL_REQUIRED',
    'posting a large manual entry that nobody approved');

  -- ---- One cent BELOW the threshold still posts freely.
  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'one cent under the threshold', pg_temp.sale_lines(499999));
  perform pg_temp.expect_ok(
    format('select public.gl_post_journal(%L)', (v_res->>'journal_id')::uuid),
    'CONTROL: one cent under the threshold needs no approver');

  -- ---- SELF-APPROVAL above the threshold: refused, at the approve step.
  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'large entry the author will try to bless himself', pg_temp.sale_lines(900000));
  v_jid := (v_res->>'journal_id')::uuid;
  perform pg_temp.expect_error(
    format('select public.gl_approve_journal(%L)', v_jid),
    'GL_SELF_APPROVAL_REFUSED',
    'the author approving his own large entry');

  -- ---- ...and refused again at the POSTING step, even if the approval column
  --      is written directly. This is the attack that matters: the trigger, not
  --      the function, is the control.
  update public.gl_journals
     set approved_by = v_author, approved_at = now()
   where id = v_jid;
  perform pg_temp.expect_error(
    format('select public.gl_post_journal(%L)', v_jid),
    'GL_SELF_APPROVAL_REFUSED',
    'forging your own approval directly into the row, bypassing gl_approve_journal');

  -- ---- A DIFFERENT person approving it works.
  update public.gl_journals
     set approved_by = v_other, approved_at = now()
   where id = v_jid;
  perform pg_temp.expect_ok(
    format('select public.gl_post_journal(%L)', v_jid),
    'CONTROL: a second person approves the large entry and it posts');

  -- ---- Automatic kinds are exempt: the approved template IS the approval.
  perform pg_temp.mk_template('BOUNCER-BANK', 'bank', 'greenway', 100000000);
  perform pg_temp.expect_ok(
    $q$select public.gl_submit_journal('greenway', date '2026-03-15', 'bank',
        'BOUNCER-AUTO-1', 'a large automatic bank entry', pg_temp.sale_lines(900000),
        'BOUNCER-BANK', 900000, true)$q$,
    'CONTROL: a large AUTOMATIC entry still posts, because its template was approved in advance');
end $$;
rollback to savepoint s14;

\echo ''
\echo '--- 15. the bouncer cannot be talked around ---'
savepoint s15;
do $$
declare
  v_ent uuid := (select id from public.gl_entities where code='greenway');
  v_jid uuid;
  v_res jsonb;
begin
  perform set_config('harness.user_id', pg_temp.admin_id()::text, true);

  -- Deleting the policy row must FAIL CLOSED, not open. "No policy" is the
  -- state an attacker would engineer, and the state a new entity starts in.
  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'entry whose policy is about to vanish', pg_temp.sale_lines(900000));
  v_jid := (v_res->>'journal_id')::uuid;
  delete from public.gl_approval_policy where entity_id = v_ent;
  perform pg_temp.expect_error(
    format('select public.gl_post_journal(%L)', v_jid),
    'GL_NO_APPROVAL_POLICY',
    'deleting the approval policy to escape it (fails CLOSED, not open)');
  perform pg_temp.expect_error(
    format('select public.gl_approve_journal(%L)', v_jid),
    'GL_NO_APPROVAL_POLICY',
    'approving with no policy in place');

  insert into public.gl_approval_policy (entity_id, threshold_cents, change_reason)
  values (v_ent, 500000, 'restored by the adversarial suite for the next attack');

  -- Turning on self-approval without a written reason must be impossible.
  perform pg_temp.expect_error(
    format('update public.gl_approval_policy set allow_self_approval = true, change_reason = ''trying to switch this on quietly'' where entity_id = %L', v_ent),
    'gl_approval_policy_self_needs_reason',
    'switching on self-approval without explaining why');

  -- A one-word excuse is not an explanation either.
  perform pg_temp.expect_error(
    format('update public.gl_approval_policy set allow_self_approval = true, self_approval_reason = ''because'', change_reason = ''trying a one word excuse'' where entity_id = %L', v_ent),
    'gl_approval_policy_self_needs_reason',
    'a one-word excuse for self-approval');

  -- A negative threshold (which would make every entry "below" it) is refused.
  perform pg_temp.expect_error(
    format('update public.gl_approval_policy set threshold_cents = -1, change_reason = ''trying to disable the bouncer with a negative number'' where entity_id = %L', v_ent),
    'gl_approval_policy_threshold_cents_check',
    'setting a negative threshold to disable the bouncer');

  -- A half-written approval (approver but no timestamp) is refused.
  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'entry for the half-approval attack', pg_temp.sale_lines(900000));
  perform pg_temp.expect_error(
    format('update public.gl_journals set approved_by = %L where id = %L', pg_temp.admin_id(), (v_res->>'journal_id')::uuid),
    'gl_journals_approval_pairing',
    'a half-written approval with no timestamp');

  -- AN ANONYMOUS APPROVAL IS NOT AN APPROVAL. This defect was found by this
  -- suite: with nobody signed in, gl_approve_journal wrote a null approver and
  -- tripped the pairing constraint with a database-jargon error instead of
  -- refusing in plain English. Fixed at the source; pinned here forever.
  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'entry nobody is signed in to approve', pg_temp.sale_lines(900000));
  perform set_config('harness.user_id', '', true);
  perform pg_temp.expect_error(
    format('select public.gl_approve_journal(%L)', (v_res->>'journal_id')::uuid),
    'GL_NO_APPROVER_IDENTITY',
    'approving while nobody is signed in');
  perform set_config('harness.user_id', pg_temp.admin_id()::text, true);

  -- The guard must be a TRIGGER, not merely a function somebody remembers to
  -- call. This is the difference between a control and a suggestion.
  perform pg_temp.assert(
    (select count(*) from pg_trigger where tgname = 'trg_gl_guard_journal_approval') = 1,
    'the approval guard is installed as a trigger, not merely as a function');
end $$;
rollback to savepoint s15;

\echo ''
\echo '--- 16. self-approval, switched on deliberately, works ---'
savepoint s16;
do $$
declare
  v_ent uuid := (select id from public.gl_entities where code='greenway');
  v_res jsonb;
begin
  perform set_config('harness.user_id', pg_temp.admin_id()::text, true);

  update public.gl_approval_policy
     set allow_self_approval  = true,
         self_approval_reason = 'Michael is the sole operator of these books and there is no second admin available at this time.',
         change_reason        = 'sole operator: enabling self-approval deliberately, with a reason on the record'
   where entity_id = v_ent;

  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'large entry under an explicit sole-operator policy', pg_temp.sale_lines(900000));

  perform pg_temp.expect_ok(
    format('select public.gl_approve_journal(%L)', (v_res->>'journal_id')::uuid),
    'the author CAN approve his own entry once self-approval is deliberately switched on');
  perform pg_temp.expect_ok(
    format('select public.gl_post_journal(%L)', (v_res->>'journal_id')::uuid),
    'and it posts');

  -- The escape hatch is on the record, permanently.
  perform pg_temp.assert(
    (select count(*) from public.gl_audit_events where event_kind = 'journal_approved') >= 1,
    'the approval is written to the audit trail');
end $$;
rollback to savepoint s16;

\echo ''
\echo '--- 17. the bouncer must never trap a bad entry in the books ---'
savepoint s17;
do $$
declare
  v_ent    uuid := (select id from public.gl_entities where code='greenway');
  v_author uuid := pg_temp.admin_id();
  v_other  uuid;
  v_res    jsonb;
  v_jid    uuid;
  v_rev    uuid;
begin
  insert into auth.users (email) values ('secondperson@example.com') returning id into v_other;
  perform set_config('harness.user_id', v_author::text, true);

  -- Post a large entry properly, with a genuine second approver.
  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'a large entry that will turn out to be wrong', pg_temp.sale_lines(900000));
  v_jid := (v_res->>'journal_id')::uuid;
  update public.gl_journals set approved_by = v_other, approved_at = now() where id = v_jid;
  perform public.gl_post_journal(v_jid);

  -- Now discover it was wrong. Reversing it must NOT require a fresh approval
  -- dance: if the control blocked the correction, it would be actively
  -- PRESERVING the error, which is the opposite of its purpose. ASC 250 says
  -- correct by reversal, so reversal must always be available.
  -- gl_reverse_journal creates a mirror-image DRAFT; it must still be posted.
  -- That draft is where the trap would spring: the reversal is the same large
  -- amount, so without the source_kind='reversal' exemption in the guard it
  -- would demand its own second approver and the error would stay in the books.
  v_rev := public.gl_reverse_journal(v_jid, 'found to be wrong during review');
  perform pg_temp.assert(v_rev is not null, 'reversing a large entry produces a draft');

  perform pg_temp.expect_ok(
    format('select public.gl_post_journal(%L)', v_rev),
    'THE TRAP TEST: the reversal of a large entry posts WITHOUT a second approver, so a control can never preserve an error');

  perform pg_temp.assert(
    (select status from public.gl_journals where id = v_jid) = 'reversed',
    'the original is marked reversed');

  -- And the books are flat again: the pair nets to zero.
  perform pg_temp.assert(
    (select coalesce(sum(l.amount_cents), 0)
       from public.gl_journal_lines l
       join public.gl_journals j on j.id = l.journal_id
      where j.entity_id = v_ent and j.status in ('posted','reversed')) = 0,
    'the entry and its reversal cancel exactly, to the cent');
end $$;
rollback to savepoint s17;

\echo ''
\echo '--- 18. an entry cannot be reversed TWICE (defect found in 0172) ---'
savepoint s18;
do $$
declare
  v_u    uuid;
  v_res  jsonb;
  v_jid  uuid;
  v_r1   uuid;
  v_rev  bigint;
begin
  insert into auth.users (email) values ('doublerev@example.com') returning id into v_u;
  perform set_config('harness.user_id', v_u::text, true);

  -- 0172 declared reversed_by_journal_id and READ it to refuse a second
  -- reversal, but nothing ever WROTE it, so that guard could never fire. A
  -- $10.00 sale could be posted, reversed, and reversed again — finishing with
  -- cash at -1,000 and revenue of 1,000 cents nobody ever paid. That is the
  -- exact shape of the negative inventory and negative ATM cash in the Sage
  -- data. Found by executing it, not by reading it.
  v_res := public.gl_submit_journal('greenway', date '2026-03-15', 'manual', null,
    'a sale that will be reversed twice if we let it', pg_temp.sale_lines(1000));
  v_jid := (v_res->>'journal_id')::uuid;
  perform public.gl_post_journal(v_jid);

  v_r1 := public.gl_reverse_journal(v_jid, 'first correction');
  perform public.gl_post_journal(v_r1);

  perform pg_temp.assert(
    (select status from public.gl_journals where id = v_jid) = 'reversed',
    'once its reversal posts, the original flips to reversed');
  perform pg_temp.assert(
    (select reversed_by_journal_id from public.gl_journals where id = v_jid) = v_r1,
    'the original is linked to the reversal that killed it');

  perform pg_temp.expect_error(
    format('select public.gl_reverse_journal(%L, %L)', v_jid, 'second correction, out of caution'),
    'GL_NOT_POSTED',
    'reversing the SAME entry a second time (this used to INVENT money)');

  -- The money proof. Reading the revenue account directly, because "the sum of
  -- all lines is zero" would still be true with a double reversal — both sides
  -- were doubled. Only the account balance shows the invented money.
  select coalesce(sum(l.amount_cents), 0) into v_rev
  from public.gl_journal_lines l
  join public.gl_journals j on j.id = l.journal_id
  join public.gl_accounts a on a.id = l.account_id
  where j.status in ('posted','reversed') and a.code = '50010';

  perform pg_temp.assert(v_rev = 0,
    'THE MONEY PROOF: revenue is exactly 0 after the reversal, not overstated by a phantom sale');
end $$;
rollback to savepoint s18;

\echo ''
\echo '=================================================================='
\echo 'ALL ATTACKS REPELLED.'
\echo '=================================================================='

rollback;
