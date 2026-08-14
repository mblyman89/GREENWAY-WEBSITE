-- =============================================================================
-- scripts/accounting/opening-balance-tests.sql   (slice F5)
--
-- THE ADVERSARIAL SUITE FOR THE OPENING BALANCE WORKSHEET.
--
-- Its job is to BREAK the cut-over, not to confirm it works (standing rule 13b).
-- Every assertion states its SPECIFIC expectation (rule 13c) so a test can never
-- pass because something unrelated broke.
--
-- WHY THIS SUITE IS LONGER THAN THE FEATURE
-- Because this is the entry every other number in the business rests on. An
-- error here is invisible: the books still balance, the reports still render,
-- and the number is simply wrong forever. The IRS does not check whether the
-- books balance. It checks whether they are TRUE.
--
-- THE HEADLINE ATTACKS
--   #4  bless twice -> exactly ONE journal (a double cut-over would double the
--       entire balance sheet)
--   #8  THE MONEY TEST. A blessed entry is a DRAFT and must be INVISIBLE to
--       every report. Only after approve AND post does it reach the ledger.
--   #10 after the OBE close, 40400 is EXACTLY zero -- proven by reading the
--       ledger, never from the function's own return value
--
-- A NOTE ON WHY #8 AND #10 LOOK PARANOID
-- An earlier draft of this suite called gl_approve_journal() and then asserted
-- "40400 is now zero". gl_approve_journal STAMPS an approval; it does not POST.
-- The journal was still a draft, drafts are excluded from the ledger, so the sum
-- was zero and the assertion PASSED -- against an empty ledger, proving nothing.
-- That is exactly the "silent failure passed off as success" this suite exists
-- to prevent, so every ledger assertion below is now preceded by a NEGATIVE
-- control that proves the number was NOT already what we wanted it to be.
-- =============================================================================

\set ON_ERROR_STOP on
set search_path = public;

-- A real signed-in human. Blessing refuses an anonymous actor by design, so the
-- suite must have one to test anything at all.
insert into auth.users (email) values ('michael@greenway.test');

-- Act as a signed-in admin. Explicit, because the harness now defaults to
-- "nobody" (the honest SQL-editor picture) after the 0175 lesson.
select set_config('harness.is_admin', 'true', false);
select set_config('harness.user_id', (select id::text from auth.users limit 1), false);

-- -----------------------------------------------------------------------------
-- Assertion helpers. Every check names its expectation.
-- -----------------------------------------------------------------------------
create or replace function public.ob_assert(label text, got boolean)
returns void language plpgsql as $$
begin
  if got is not true then
    raise exception 'ASSERTION FAILED: %', label;
  end if;
  raise notice '   PASS  %', label;
end $$;

create or replace function public.ob_assert_eq(label text, got bigint, want bigint)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', label, want, got;
  end if;
  raise notice '   PASS  % (= %)', label, got;
end $$;

-- Runs a statement and asserts it raises, with the expected error TEXT.
-- Matching on the message means a test cannot pass because something unrelated
-- failed -- the single most common way an adversarial suite lies to you.
create or replace function public.ob_assert_refuses(label text, stmt text, expect_fragment text)
returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute stmt;
  exception when others then
    v_msg := SQLERRM;
    if position(expect_fragment in v_msg) = 0 then
      raise exception 'ASSERTION FAILED: % -- it DID refuse, but for the wrong reason. Expected to see "%", got "%"',
        label, expect_fragment, v_msg;
    end if;
    raise notice '   PASS  % (refused: %)', label, expect_fragment;
    return;
  end;
  raise exception 'ASSERTION FAILED: % -- THE ATTACK SUCCEEDED. It should have been refused.', label;
end $$;

-- Convenience: stage a valid row on greenway.
create or replace function public.ob_stage(p_code text, p_cents bigint, p_kind text default 'sage_trial_balance', p_ref text default 'SAGE-TB-2025-12-31')
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.gl_opening_balances
    (entity_id, account_code, amount_cents, evidence_kind, evidence_ref, prepared_by)
  values
    ((select id from public.gl_entities where code = 'greenway'),
     p_code, p_cents, p_kind, p_ref, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ob_clear()
returns void language plpgsql as $$
begin
  -- only clears NON-posted rows; posted rows are frozen by design
  delete from public.gl_opening_balances where status <> 'posted';
end $$;

-- Reads the REAL ledger balance of an account, through 0175's gl_reportable_lines
-- (the single definition of "a line that counts"). Used for every money proof.
create or replace function public.ob_ledger(p_entity_code text, p_account_code text)
returns bigint language sql stable as $$
  select coalesce(sum(l.amount_cents), 0)
  from public.gl_reportable_lines l
  where l.entity_code = p_entity_code and l.account_code = p_account_code;
$$;

-- Approve AND POST a draft. Two distinct functions in 0172/0174, and conflating
-- them is precisely how this suite previously fooled itself (see header).
create or replace function public.ob_approve_and_post(p_jid uuid, p_note text)
returns void language plpgsql as $$
begin
  perform public.gl_approve_journal(p_jid, p_note);
  perform public.gl_post_journal(p_jid);
end $$;


do $$
declare
  v_entity uuid;
  v_sum    jsonb;
  v_res    jsonb;
  v_res2   jsonb;
  v_jid    uuid;
  v_jid2   uuid;
  v_cnt    integer;
  v_bal    bigint;
begin
  select id into v_entity from public.gl_entities where code = 'greenway';
  if v_entity is null then
    raise exception 'VACUITY GUARD: no greenway entity — every test below would pass trivially.';
  end if;

  -- THE SOLE-OPERATOR REALITY (see f5-defects.md D-4).
  -- gl_approval_policy seeds threshold 500000 with allow_self_approval=false for
  -- every entity, and 'opening_balance' is NOT in the guard's exempt list. Any
  -- real opening balance sheet exceeds $5,000, and Michael is the only person
  -- with access. So the author cannot approve his own cut-over and is
  -- structurally locked out.
  --
  -- This suite does NOT paper over that. It sets the flag the way the schema
  -- demands one be set -- deliberately, with a written reason of real length --
  -- so the money path can be exercised at all. The underlying policy question is
  -- Michael's to answer, and it is written up rather than silently patched.
  update public.gl_approval_policy
     set allow_self_approval  = true,
         self_approval_reason = 'Sole-operator cut-over: Greenway has one administrator, so the opening balance entry has no available second approver. Recorded deliberately for the F5 test suite.',
         change_reason        = 'F5 adversarial suite: exercise the full bless -> approve -> post money path.';

  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 1 — the worksheet refuses nonsense at the door';
  raise notice '===========================================================================';

  perform public.ob_clear();

  -- 1a. zero amount
  perform public.ob_assert_refuses(
    'a zero-cent opening balance is refused',
    $q$ select public.ob_stage('10100', 0) $q$,
    'amount_cents');

  -- 1b. unknown account
  perform public.ob_assert_refuses(
    'an opening balance on a nonexistent account is refused',
    $q$ select public.ob_stage('99999', 100) $q$,
    'GL_OB_UNKNOWN_ACCOUNT');

  -- 1c. parent/header account
  perform public.ob_assert_refuses(
    'an opening balance on a HEADER account is refused',
    $q$ select public.ob_stage('40000', 100) $q$,
    'GL_OB_PARENT_ACCOUNT');

  -- 1d. income statement account
  perform public.ob_assert_refuses(
    'an opening balance on a REVENUE account is refused (P&L is not a balance)',
    $q$ select public.ob_stage('50010', 100) $q$,
    'GL_OB_NOT_BALANCE_SHEET');

  -- 1e. blank evidence
  perform public.ob_assert_refuses(
    'an opening balance with blank evidence is refused',
    $q$ insert into public.gl_opening_balances
          (entity_id, account_code, amount_cents, evidence_kind, evidence_ref)
        values ((select id from public.gl_entities where code='greenway'),
                '10100', 100, 'bank_statement', '  ') $q$,
    'evidence_ref');

  -- 1j. A RETIRED (inactive) account cannot carry an opening balance.
  --
  -- WHY THIS TEST EXISTS AND WHY IT WAS ADDED LATE
  -- It was not here at first. The mutation campaign disabled the inactive-account
  -- guard in the migration entirely and THE WHOLE SUITE STILL PASSED -- 65 green
  -- assertions and not one of them noticed the guard was gone. That is the exact
  -- "silent failure passed off as success" this suite is supposed to prevent, and
  -- it was sitting inside the suite itself.
  --
  -- Why it matters in real life: a retired account is one Sage stopped using.
  -- Carrying a balance onto it at cut-over parks real money on a line nobody
  -- reviews, and no report will ever draw attention to it.
  --
  -- Nothing in 0173 seeds an inactive account (they all default to active), so
  -- the test has to create the condition it wants to attack.
  update public.gl_accounts set active = false where code = '12200';

  -- NEGATIVE CONTROL FIRST (rule 15b): prove '12200' is a genuinely usable
  -- account, so the refusal below is caused by 'retired' and not by the account
  -- being unusable for some unrelated reason.
  perform public.ob_assert(
    'control: 12200 is a real, allowed, non-parent balance-sheet account',
    exists (select 1 from public.gl_accounts a
             where a.code = '12200' and a.allowed_entity_codes is null
               and a.type not in ('income','expense','cogs','other_income','other_expense')
               and not exists (select 1 from public.gl_accounts c where c.parent_code = a.code)));

  perform public.ob_assert_refuses(
    'a RETIRED account cannot carry an opening balance',
    $q$ insert into public.gl_opening_balances
          (entity_id, account_code, amount_cents, evidence_kind, evidence_ref)
        values ((select id from public.gl_entities where code='greenway'),
                '12200', 12345, 'sage_trial_balance', 'SAGE-TB-2025-12-31') $q$,
    'GL_OB_INACTIVE_ACCOUNT');

  -- Put it back, so no later attack inherits a retired account by accident.
  update public.gl_accounts set active = true where code = '12200';

  -- NEGATIVE CONTROL: the very same row is accepted once the account is active
  -- again. Without this, the refusal above could be permanent breakage rather
  -- than the guard doing its job.
  insert into public.gl_opening_balances
    (entity_id, account_code, amount_cents, evidence_kind, evidence_ref)
  values ((select id from public.gl_entities where code='greenway'),
          '12200', 12345, 'sage_trial_balance', 'SAGE-TB-2025-12-31');
  perform public.ob_assert(
    'the identical row IS accepted once the account is active again',
    exists (select 1 from public.gl_opening_balances
             where account_code = '12200' and amount_cents = 12345));
  delete from public.gl_opening_balances where account_code = '12200';

  -- 1f. excluded row with no reason
  perform public.ob_assert_refuses(
    'setting a row aside without saying why is refused',
    $q$ insert into public.gl_opening_balances
          (entity_id, account_code, amount_cents, evidence_kind, evidence_ref, status)
        values ((select id from public.gl_entities where code='greenway'),
                '10100', 100, 'bank_statement', 'STMT-1', 'excluded') $q$,
    'gl_ob_excluded_needs_reason');

  -- 1g. an account that belongs to ANOTHER set of books (defect D-6, found by
  --     probe: the worksheet used to accept this silently and it would only have
  --     blown up at POST time, weeks later, with a line number instead of a
  --     document reference).
  perform public.ob_assert_refuses(
    'greenway-only vault cash cannot carry an opening balance on the landholding books',
    $q$ insert into public.gl_opening_balances
          (entity_id, account_code, amount_cents, evidence_kind, evidence_ref)
        values ((select id from public.gl_entities where code='landholding'),
                '10100', 100, 'bank_statement', 'WRONG-BOOKS') $q$,
    'GL_OB_ACCOUNT_NOT_ALLOWED_FOR_ENTITY');

  -- 1h. NEGATIVE CONTROL for 1g (rule 15b). If the entity check were written too
  --     broadly it would reject everything and 1g would pass for the wrong
  --     reason. An UNRESTRICTED account on the same books must still be accepted.
  declare v_probe uuid;
  begin
    insert into public.gl_opening_balances
      (entity_id, account_code, amount_cents, evidence_kind, evidence_ref)
    values ((select id from public.gl_entities where code='landholding'),
            '10400', 100, 'bank_statement', 'RIGHT-BOOKS')
    returning id into v_probe;
    perform public.ob_assert('an UNRESTRICTED account is still accepted on those books (the check is not over-broad)',
      v_probe is not null);
    delete from public.gl_opening_balances where id = v_probe;
  end;

  -- 1i. a control account IS allowed (D-7). Opening balances are exactly where
  --     A/P and inventory legitimately start. If someone "hardens" this later,
  --     this test tells them they broke the cut-over.
  declare v_ctl uuid;
  begin
    v_ctl := public.ob_stage('30000', -500000, 'ap_aging', 'AP-AGING-2025-12-31');
    perform public.ob_assert('a CONTROL account (A/P) may carry an opening balance — a cut-over without opening A/P is useless',
      v_ctl is not null);
    delete from public.gl_opening_balances where id = v_ctl;
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 2 — an EMPTY worksheet must not become a journal';
  raise notice '===========================================================================';

  perform public.ob_clear();
  perform public.ob_assert_refuses(
    'blessing an empty worksheet is refused',
    $q$ select public.gl_bless_opening_balances('greenway') $q$,
    'GL_OB_EMPTY');


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 3 — evidence cannot be removed after the fact';
  raise notice '===========================================================================';

  -- WHAT THIS TEST USED TO DO, AND WHY IT WAS WRONG.
  -- It tried to blank the evidence on a staged row and then prove that blessing
  -- refused with GL_OB_NO_EVIDENCE. But the column carries
  --     CHECK (length(btrim(evidence_ref)) >= 3)
  -- and a column CHECK applies to UPDATE as well as INSERT, so the setup itself
  -- was impossible and the whole suite aborted. Probed four ways -- blank,
  -- two-character, NULL, and whitespace-padded -- all four are refused.
  --
  -- So GL_OB_NO_EVIDENCE inside gl_bless_opening_balances is UNREACHABLE through
  -- ordinary SQL. It stays as defence in depth, but it is not pretended to be
  -- tested: a test that cannot reach its target is a green light wired to
  -- nothing (standing rule 15). What IS tested here is the defender that
  -- genuinely stands between Michael and an unevidenced number.
  perform public.ob_clear();
  declare v_ev uuid;
  begin
    v_ev := public.ob_stage('10100', 500000);

    perform public.ob_assert_refuses(
      'evidence cannot be blanked out after the row was created',
      format($q$ update public.gl_opening_balances set evidence_ref='  ' where id=%L $q$, v_ev),
      'evidence_ref_check');

    perform public.ob_assert_refuses(
      'evidence cannot be whittled down to something meaningless either',
      format($q$ update public.gl_opening_balances set evidence_ref=' a ' where id=%L $q$, v_ev),
      'evidence_ref_check');

    perform public.ob_assert_refuses(
      'evidence cannot be set to NULL',
      format($q$ update public.gl_opening_balances set evidence_ref=null where id=%L $q$, v_ev),
      'not-null');

    -- NEGATIVE CONTROL (rule 15b): a REAL replacement reference must still be
    -- accepted, otherwise the three refusals above could just mean the row is
    -- read-only and would prove nothing about evidence.
    update public.gl_opening_balances
       set evidence_ref = 'WF-STATEMENT-2025-12-31' where id = v_ev;
    perform public.ob_assert('a genuine evidence reference can still be corrected',
      exists (select 1 from public.gl_opening_balances
               where id = v_ev and evidence_ref = 'WF-STATEMENT-2025-12-31'));

    -- And the evidence KIND is a closed list, not free text.
    perform public.ob_assert_refuses(
      'an invented evidence kind is refused',
      format($q$ update public.gl_opening_balances set evidence_kind='vibes' where id=%L $q$, v_ev),
      'evidence_kind_check');
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 4 — THE HEADLINE: blessing twice must not double the balance sheet';
  raise notice '===========================================================================';

  perform public.ob_clear();
  perform public.ob_stage('10100',  10000000, 'bank_statement',   'WF-2025-12-31');   -- cash 100,000.00 DR
  perform public.ob_stage('40300', -10000000, 'k1_or_return',     'K1-2025');         -- RE  100,000.00 CR

  v_res := public.gl_bless_opening_balances('greenway');
  perform public.ob_assert('first blessing reports outcome=blessed',
    (v_res->>'outcome') = 'blessed');

  v_jid := (v_res->>'journal_id')::uuid;

  v_res2 := public.gl_bless_opening_balances('greenway');
  perform public.ob_assert('second blessing reports already_blessed, not a new entry',
    (v_res2->>'outcome') = 'already_blessed');
  perform public.ob_assert('second blessing returns the SAME journal id',
    (v_res2->>'journal_id')::uuid = v_jid);

  select count(*) into v_cnt
  from public.gl_journals
  where entity_id = v_entity and source_kind = 'opening_balance';
  perform public.ob_assert_eq('exactly ONE opening balance journal exists', v_cnt, 1);

  -- And the money did not double either. Counted on the ENTRY itself, since it
  -- is still a draft and deliberately invisible to the ledger (see Attack 8).
  select coalesce(sum(l.amount_cents), 0) into v_bal
  from public.gl_journal_lines l
  join public.gl_accounts a on a.id = l.account_id
  where l.journal_id = v_jid and a.code = '10100';
  perform public.ob_assert_eq('cash on the entry is 100,000.00 exactly, not doubled', v_bal, 10000000);


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 5 — posted worksheet rows are FROZEN';
  raise notice '===========================================================================';

  perform public.ob_assert_refuses(
    'editing a posted opening balance row is refused',
    $q$ update public.gl_opening_balances set amount_cents = 1 where status = 'posted' $q$,
    'GL_OB_FROZEN');

  perform public.ob_assert_refuses(
    'deleting a posted opening balance row is refused',
    $q$ delete from public.gl_opening_balances where status = 'posted' $q$,
    'GL_OB_FROZEN');


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 6 — the entry landed on the RIGHT DATE and KIND';
  raise notice '===========================================================================';

  perform public.ob_assert('the opening entry is dated 2025-12-31 (the only pre-cut-over date allowed)',
    exists (select 1 from public.gl_journals
            where id = v_jid and journal_date = date '2025-12-31'));

  perform public.ob_assert('the opening entry is source_kind=opening_balance',
    exists (select 1 from public.gl_journals
            where id = v_jid and source_kind = 'opening_balance'));

  perform public.ob_assert('the opening entry is a DRAFT — the cut-over is never auto-posted',
    exists (select 1 from public.gl_journals where id = v_jid and status = 'draft'));

  perform public.ob_assert('every posted worksheet row points at that journal',
    not exists (select 1 from public.gl_opening_balances
                where status = 'posted' and journal_id is distinct from v_jid));


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 7 — a worksheet that does NOT balance is plugged VISIBLY';
  raise notice '===========================================================================';

  -- Use the LANDHOLDING books so this is independent of greenway's entry above.
  -- 10400 Undeposited Funds is unrestricted, so it is legitimate there.
  declare
    v_lh uuid;
    v_res3 jsonb;
    v_plug bigint;
  begin
    select id into v_lh from public.gl_entities where code = 'landholding';
    if v_lh is null then
      raise exception 'VACUITY GUARD: need the landholding entity to test the plug independently.';
    end if;

    insert into public.gl_opening_balances
      (entity_id, account_code, amount_cents, evidence_kind, evidence_ref, prepared_by)
    values (v_lh, '10400', 2500000, 'bank_statement', 'LH-BANK-2025-12-31', auth.uid());

    v_sum := public.gl_opening_balance_summary('landholding');

    perform public.ob_assert('summary says the worksheet is NOT balanced',
      (v_sum->>'balanced')::boolean = false);
    perform public.ob_assert_eq('summary predicts the exact 40400 plug',
      (v_sum->>'obe_plug_cents')::bigint, -2500000);

    v_res3 := public.gl_bless_opening_balances('landholding');
    v_plug := (v_res3->>'plug_cents')::bigint;
    perform public.ob_assert_eq('the plug actually written matches what was predicted',
      v_plug, -2500000);

    -- and the plug is REALLY in 40400 on the entry
    select coalesce(sum(l.amount_cents),0) into v_bal
    from public.gl_journal_lines l
    join public.gl_accounts a on a.id = l.account_id
    where l.journal_id = (v_res3->>'journal_id')::uuid and a.code = '40400';
    perform public.ob_assert_eq('40400 carries the plug on the entry', v_bal, -2500000);

    -- rule 12: the judgement call was RECORDED, not applied silently
    perform public.ob_assert('the imbalance was recorded as an assumption_note (rule 12)',
      exists (select 1 from public.gl_journals
              where id = (v_res3->>'journal_id')::uuid
                and assumption_note is not null
                and assumption_note like '%did not balance%'));
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 8 — THE MONEY TEST: a DRAFT must be invisible; only a POST is real';
  raise notice '===========================================================================';

  -- THE NEGATIVE CONTROL FIRST (rule 15b). This is the assertion that makes the
  -- one after it mean something. A previous version of this suite skipped it,
  -- called gl_approve_journal (which does NOT post), and then "proved" a ledger
  -- balance that was zero simply because nothing had ever been posted.
  perform public.ob_assert_eq(
    'BEFORE posting, the blessed draft is INVISIBLE to the ledger (0 cents of cash)',
    public.ob_ledger('greenway', '10100'), 0);

  perform public.ob_assert('and the trial balance does not show it either',
    not exists (select 1 from public.gl_trial_balance
                where entity_code = 'greenway' and account_code = '10100'));

  -- Now approve AND post. Two distinct steps, deliberately.
  perform public.ob_approve_and_post(v_jid,
    'Cut-over reviewed against Sage trial balance and bank statements.');

  perform public.ob_assert('after posting, the journal status is posted',
    exists (select 1 from public.gl_journals where id = v_jid and status = 'posted'));

  perform public.ob_assert_eq(
    'AFTER posting, cash in the ledger is exactly 100,000.00',
    public.ob_ledger('greenway', '10100'), 10000000);

  perform public.ob_assert_eq(
    'AFTER posting, retained earnings is exactly 100,000.00 credit',
    public.ob_ledger('greenway', '40300'), -10000000);

  -- A balanced worksheet must have created NO plug at all.
  perform public.ob_assert_eq(
    'a worksheet that balanced left 40400 Opening Balance Equity at ZERO',
    public.ob_ledger('greenway', '40400'), 0);

  -- And 0175's own report agrees, end to end.
  declare v_tb jsonb;
  begin
    v_tb := public.gl_trial_balance_check('greenway');
    perform public.ob_assert('0175 trial balance says greenway balances', (v_tb->>'balanced')::boolean);
    perform public.ob_assert('0175 trial balance CERTIFIES greenway', (v_tb->>'certified')::boolean);
    perform public.ob_assert_eq('0175 reports exactly the debits we staged',
      (v_tb->>'total_debit_cents')::bigint, 10000000);
    perform public.ob_assert_eq('0175 reports exactly the credits we staged',
      (v_tb->>'total_credit_cents')::bigint, 10000000);
    perform public.ob_assert_eq('0175 sees nothing abnormal',
      (v_tb->>'abnormal_count')::bigint, 0);
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 9 — closing OBE when there is nothing to close';
  raise notice '===========================================================================';

  -- greenway balanced exactly, so 40400 is genuinely zero there. Proven above
  -- from the ledger, not assumed.
  v_res := public.gl_close_opening_balance_equity('greenway');
  perform public.ob_assert('closing a zero OBE is a no-op, not an empty journal',
    (v_res->>'outcome') = 'nothing_to_close');

  select count(*) into v_cnt
  from public.gl_journals
  where entity_id = v_entity and source_ref = 'obe-close:greenway';
  perform public.ob_assert_eq('no close journal was created for a zero balance', v_cnt, 0);


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 10 — the OBE close drives 40400 to EXACTLY zero';
  raise notice '===========================================================================';

  declare
    v_lh   uuid;
    v_res4 jsonb;
    v_cjid uuid;
  begin
    select id into v_lh from public.gl_entities where code = 'landholding';

    -- Post the landholding opening entry so its 40400 plug becomes REAL.
    select j.id into v_jid from public.gl_journals j
     where j.entity_id = v_lh and j.source_kind = 'opening_balance'
       and j.source_ref = 'opening-balance:landholding' limit 1;
    perform public.ob_approve_and_post(v_jid, 'Landholding cut-over reviewed.');

    -- NEGATIVE CONTROL. The plug must actually BE in the ledger before we can
    -- claim to have cleared it. Without this, "40400 is zero" at the end would
    -- pass against a ledger where nothing was ever posted.
    perform public.ob_assert_eq(
      'the plug is REALLY in the ledger before we try to close it',
      public.ob_ledger('landholding', '40400'), -2500000);

    v_res4 := public.gl_close_opening_balance_equity('landholding');
    perform public.ob_assert('the close reports outcome=closed',
      (v_res4->>'outcome') = 'closed');
    perform public.ob_assert_eq('the close moved exactly the plug amount',
      (v_res4->>'moved_cents')::bigint, -2500000);

    v_cjid := (v_res4->>'journal_id')::uuid;

    -- The close is a DRAFT too. Until it posts, nothing has changed.
    perform public.ob_assert_eq(
      'the close is a draft, so 40400 has NOT moved yet',
      public.ob_ledger('landholding', '40400'), -2500000);

    perform public.ob_approve_and_post(v_cjid, 'OBE close reviewed.');

    -- THE PROOF, taken from the LEDGER and not from the function's own claim.
    perform public.ob_assert_eq('40400 Opening Balance Equity is now EXACTLY zero',
      public.ob_ledger('landholding', '40400'), 0);

    -- and the money went to retained earnings, not into thin air
    perform public.ob_assert_eq('40300 Retained Earnings received it',
      public.ob_ledger('landholding', '40300'), -2500000);

    -- the landholding books still balance after all that
    declare v_tb2 jsonb;
    begin
      v_tb2 := public.gl_trial_balance_check('landholding');
      perform public.ob_assert('landholding still balances after the close',
        (v_tb2->>'balanced')::boolean);
    end;

    -- closing twice must not create a second close
    v_res4 := public.gl_close_opening_balance_equity('landholding');
    perform public.ob_assert('closing again is a no-op',
      (v_res4->>'outcome') = 'nothing_to_close');

    select count(*) into v_cnt from public.gl_journals
     where entity_id = v_lh and source_ref = 'obe-close:landholding';
    perform public.ob_assert_eq('and there is still exactly ONE close journal', v_cnt, 1);
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 11 — unknown entity, and injection through free text';
  raise notice '===========================================================================';

  perform public.ob_assert_refuses(
    'blessing a set of books that does not exist is refused',
    $q$ select public.gl_bless_opening_balances('no-such-entity') $q$,
    'GL_UNKNOWN_ENTITY');

  -- Injection attempt through evidence_ref. It must be stored as DATA, verbatim.
  perform public.ob_clear();
  declare
    v_evil text := ''';drop table public.gl_journals;--';
    v_id   uuid;
    v_back text;
  begin
    insert into public.gl_opening_balances
      (entity_id, account_code, amount_cents, evidence_kind, evidence_ref, prepared_by)
    values (v_entity, '10100', 12345, 'other', v_evil, auth.uid())
    returning id into v_id;

    select evidence_ref into v_back from public.gl_opening_balances where id = v_id;
    perform public.ob_assert('a SQL-injection string is stored verbatim as data', v_back = v_evil);
    perform public.ob_assert('gl_journals still exists — nothing was executed',
      to_regclass('public.gl_journals') is not null);
    delete from public.gl_opening_balances where id = v_id;
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 12 — arithmetic cannot drift (integer cents only)';
  raise notice '===========================================================================';

  perform public.ob_clear();
  -- Three thirds of a penny-odd number: if anything anywhere used floats, this
  -- is where it would show up as a 1-cent drift. 10400/10900/12200 are
  -- unrestricted, non-parent balance-sheet accounts.
  perform public.ob_stage('10400',  3333333, 'bank_statement', 'DRIFT-A');
  perform public.ob_stage('10900',  3333333, 'bank_statement', 'DRIFT-B');
  perform public.ob_stage('12200',  3333334, 'bank_statement', 'DRIFT-C');
  perform public.ob_stage('40200', -10000000, 'k1_or_return',  'DRIFT-APIC');

  v_sum := public.gl_opening_balance_summary('greenway');
  perform public.ob_assert_eq('three odd thirds plus the credit still nets to exactly zero',
    (v_sum->>'difference_cents')::bigint, 0);
  perform public.ob_assert('summary reports balanced',
    (v_sum->>'balanced')::boolean = true);
  perform public.ob_clear();


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 13 — the frozen worksheet cannot be laundered through an UPDATE';
  raise notice '===========================================================================';

  -- Posted rows are frozen. Try to sneak one back to 'staged' so it could be
  -- blessed a second time -- which would post the same money twice.
  perform public.ob_assert_refuses(
    'a posted row cannot be reset to staged to be blessed again',
    $q$ update public.gl_opening_balances set status='staged', journal_id=null
         where status='posted' $q$,
    'GL_OB_FROZEN');

  -- And the constraint holds even if the trigger were somehow bypassed: a posted
  -- row with no journal is not a representable state.
  perform public.ob_assert('every posted row still points at a real journal',
    not exists (select 1 from public.gl_opening_balances
                 where status = 'posted' and journal_id is null));


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 16 — THE REVERSAL TRAP: the close must read gl_reportable_lines';
  raise notice '===========================================================================';

  -- WHY THIS ATTACK EXISTS
  -- The original 0176 computed the 40400 balance by reading gl_journal_lines
  -- directly with "j.status in ('posted','reversed') and j.reversed_by_journal_id
  -- is null". That was found and fixed (defect D-2). But the mutation campaign
  -- then put the bug BACK and the entire suite still passed, 68 green -- because
  -- nothing in it had ever reversed a journal, and the correct query and the
  -- broken one give IDENTICAL answers until a reversal exists.
  --
  -- What the broken filter actually does: it EXCLUDES a reversed original while
  -- still INCLUDING the reversal that cancelled it. The pair should net to zero;
  -- instead only the -X half is counted, so the balance is wrong by the full
  -- amount of the reversal, in the wrong direction. Nothing looks broken. The
  -- books still balance. The number is simply false.
  --
  -- This is the defect class 0175's gl_reportable_lines view exists to make
  -- impossible, and this attack is what makes that guarantee real for F5.

  -- NOTE ON SETUP: by this point greenway ALREADY has a posted opening balance
  -- journal from Attack 8, and blessing is idempotent, so staging more rows here
  -- would simply return that same journal. Rather than fight it, this attack
  -- reverses the REAL posted cut-over -- which is exactly the situation being
  -- modelled: the cut-over was posted, then had to be restated.
  select j.id into v_jid
  from public.gl_journals j
  where j.entity_id = v_entity
    and j.source_ref = 'opening-balance:greenway'
    and j.status = 'posted'
  limit 1;

  if v_jid is null then
    raise exception 'VACUITY GUARD: Attack 16 needs a POSTED greenway opening journal to reverse. Without one, every assertion below would pass against an empty ledger and prove nothing.';
  end if;

  -- NEGATIVE CONTROL (rule 15b): the money is really in the ledger right now.
  -- Without this, "zero after reversal" could just mean "nothing ever posted".
  v_bal := public.ob_ledger('greenway','10100');
  perform public.ob_assert(
    'control: the posted cut-over really has cash in the ledger before reversal',
    v_bal <> 0);

  -- Now reverse it. A reversal is normal accounting hygiene, not an exotic edge
  -- case: it is how ASC 250 says you correct posted history.
  v_jid2 := public.gl_reverse_journal(v_jid, 'cut-over restated after finding a second bank statement');
  perform public.ob_approve_and_post(v_jid2, 'posting the reversal');

  -- THE POINT OF THE WHOLE ATTACK.
  -- Original (+5,000,000) and reversal (-5,000,000) must NET TO ZERO. Read
  -- through gl_reportable_lines, which counts both halves. The broken query
  -- drops the original and keeps the reversal, and would report -5,000,000.
  perform public.ob_assert_eq(
    'a reversed opening entry and its reversal NET TO ZERO in the ledger',
    public.ob_ledger('greenway','10100'), 0);

  -- Both journals must still be VISIBLE to reporting. A reversal does not erase
  -- history; it records the correction. If either vanished, the audit trail is
  -- gone even though the balance happens to be right.
  select count(distinct journal_id) into v_cnt
  from public.gl_reportable_lines
  where journal_id in (v_jid, v_jid2);
  perform public.ob_assert_eq(
    'BOTH the original and its reversal remain visible in the ledger (audit trail intact)',
    v_cnt, 2);

  -- And the original is marked reversed rather than deleted.
  perform public.ob_assert(
    'the original entry is stamped reversed, not erased',
    exists (select 1 from public.gl_journals
             where id = v_jid and status = 'reversed'
               and reversed_by_journal_id = v_jid2));

  -- THE DEFECT D-2 KILL SHOT.
  --
  -- Everything above proves the LEDGER reads correctly through the view. This
  -- last part proves gl_close_opening_balance_equity() ITSELF reads through the
  -- view, which is where D-2 actually lived.
  --
  -- HOW THE KILL WORKS. greenway's opening entry has just been reversed, so its
  -- 40400 pair (original + reversal) nets to exactly zero and the close must
  -- report 'nothing_to_close' and create NO journal.
  --
  -- The broken query -- "...and j.reversed_by_journal_id is null" -- drops the
  -- reversed ORIGINAL while keeping its REVERSAL. It therefore sees only the
  -- -X half of a cancelled pair and believes 40400 holds a balance that does not
  -- exist. It then writes a correcting journal for phantom money, moving it into
  -- Retained Earnings. The books still balance. Retained Earnings is simply
  -- wrong, permanently, with a plausible-looking entry explaining it.
  --
  -- Attack 9 already asserts 'nothing_to_close' for greenway, but it runs BEFORE
  -- any reversal exists, when the correct and broken queries agree. Only here,
  -- with a reversal in history, do the two answers diverge.
  -- greenway's 40400 was never used (its worksheet balanced exactly), so reading
  -- it proves nothing about D-2: an account with no lines returns zero under the
  -- correct query AND the broken one. The divergence can only appear on an
  -- account that HAS a reversed line. That account is landholding's 40400, which
  -- carried the plug and was cleared by a close journal in Attack 10.
  declare
    v_lh2    uuid;
    v_close  uuid;
    v_rev    uuid;
    v_res5   jsonb;
  begin
    select id into v_lh2 from public.gl_entities where code = 'landholding';

    select j.id into v_close
    from public.gl_journals j
    where j.entity_id = v_lh2
      and j.source_ref = 'obe-close:landholding'
      and j.status = 'posted'
    limit 1;

    if v_close is null then
      raise exception 'VACUITY GUARD: Attack 16 needs the POSTED landholding OBE close from Attack 10 in order to reverse it. Without it the D-2 assertions below would prove nothing.';
    end if;

    -- NEGATIVE CONTROL: right now the close has done its job and 40400 is zero.
    perform public.ob_assert_eq(
      'control: landholding 40400 is zero before we reverse the close',
      public.ob_ledger('landholding','40400'), 0);

    -- Reverse the CLOSE. Real-world reason: the residual was reclassified to
    -- Retained Earnings, then evidence turned up showing what it actually was,
    -- so the reclassification has to be undone.
    v_rev := public.gl_reverse_journal(v_close, 'evidence located; OBE reclassification withdrawn');
    perform public.ob_approve_and_post(v_rev, 'posting the reversal of the close');

    -- THE DIVERGENCE.
    -- Read correctly (posted + reversed, both halves counted), 40400 now holds:
    --   original plug -2,500,000, close +2,500,000, reversal-of-close -2,500,000
    --   = -2,500,000. The residual is BACK, which is the whole point of undoing
    --   the close.
    -- Read with the D-2 filter, the reversed CLOSE is dropped while its reversal
    -- is kept, giving -2,500,000 + -2,500,000 = -5,000,000: money that never
    -- existed, waiting to be moved into Retained Earnings by the next close.
    perform public.ob_assert_eq(
      'D-2 GUARD: after reversing the close, 40400 shows the residual ONCE (not doubled)',
      public.ob_ledger('landholding','40400'), -2500000);

    -- And the function itself must agree with the ledger. This is the assertion
    -- that actually kills D-2: gl_close_opening_balance_equity computes the
    -- balance internally, and if it uses the broken filter it will report moving
    -- -5,000,000 instead of -2,500,000.
    v_res5 := public.gl_close_opening_balance_equity('landholding', 'closing again after the withdrawal');
    perform public.ob_assert_eq(
      'D-2 GUARD: the close moves the REAL residual, not a phantom doubled one',
      (v_res5->>'moved_cents')::bigint, -2500000);
  end;

  perform public.ob_clear();


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ALL OPENING BALANCE ATTACKS REPELLED';
  raise notice '===========================================================================';
end $$;


-- -----------------------------------------------------------------------------
-- ATTACK 14 — PRIVILEGE. Run as a NON-admin.
-- Kept outside the block above so the privilege change is unmistakable.
-- -----------------------------------------------------------------------------
select set_config('harness.is_admin', 'false', false);

do $$
begin
  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 14 — a non-admin must not touch the cut-over';
  raise notice '===========================================================================';

  if public.is_admin() then
    raise exception 'VACUITY GUARD: this section is meaningless while is_admin() is true.';
  end if;

  perform public.ob_assert_refuses(
    'a non-admin cannot bless the opening balances',
    $q$ select public.gl_bless_opening_balances('greenway') $q$,
    'GL_FORBIDDEN');

  perform public.ob_assert_refuses(
    'a non-admin cannot close Opening Balance Equity',
    $q$ select public.gl_close_opening_balance_equity('greenway') $q$,
    'GL_FORBIDDEN');

  perform public.ob_assert_refuses(
    'a non-admin cannot even read the worksheet summary',
    $q$ select public.gl_opening_balance_summary('greenway') $q$,
    'GL_FORBIDDEN');
end $$;

select set_config('harness.is_admin', 'true', false);

-- -----------------------------------------------------------------------------
-- ATTACK 15 — an ANONYMOUS admin (no auth.uid()) must not bless.
-- Segregation of duties is a claim about WHO. An unattributable cut-over is
-- worthless. This mirrors the defect the F3 suite found in gl_approve_journal.
-- -----------------------------------------------------------------------------
select set_config('harness.user_id', '', false);

do $$
begin
  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 15 — an anonymous admin must not bless the cut-over';
  raise notice '===========================================================================';

  if auth.uid() is not null then
    raise exception 'VACUITY GUARD: this section is meaningless while there is a session user.';
  end if;

  perform public.ob_assert_refuses(
    'blessing with no signed-in human is refused',
    $q$ select public.gl_bless_opening_balances('greenway') $q$,
    'GL_OB_NO_ACTOR');

  perform public.ob_assert_refuses(
    'closing OBE with no signed-in human is refused',
    $q$ select public.gl_close_opening_balance_equity('greenway') $q$,
    'GL_OB_NO_ACTOR');

  raise notice '';
  raise notice 'OPENING BALANCE PRIVILEGE CHECKS PASSED';
  raise notice '===========================================================================';
end $$;
