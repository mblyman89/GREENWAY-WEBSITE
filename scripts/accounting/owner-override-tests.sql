-- =============================================================================
-- scripts/accounting/owner-override-tests.sql   (slice F6)
--
-- THE ADVERSARIAL SUITE FOR THE SOLE-OPERATOR OVERRIDE.
--
-- Its job is to BREAK the override, not to confirm it works (standing rule 13b).
--
-- WHY THIS SUITE IS PARANOID ABOUT THE LOG RATHER THAN THE PERMISSION
-- Granting the owner the right to approve his own work is easy and it is what he
-- asked for. The DANGEROUS failure is not "the override does not work" -- he
-- would notice that in ten seconds. The dangerous failure is "the override works
-- and quietly leaves no trace", because he would never notice, and the first
-- person to notice would be an examiner asking why a sole operator approved
-- $500,000 of his own entries with nothing on file.
--
-- So the headline attacks are:
--   #3  the override WORKS (it must, or the books are unusable)
--   #4  EVERY use is logged, with who, how much, and why
--   #5  the log CANNOT be edited or deleted, by anyone, ever
--   #8  turning the override OFF actually restores the control
--   #9  the override does NOT weaken anything it was not meant to weaken
--
-- Every ledger assertion is preceded by a NEGATIVE CONTROL proving the state was
-- not already what we wanted (standing rule 15b), because the F5 campaign proved
-- that an assertion which cannot fail is worse than no assertion at all.
-- =============================================================================

\set ON_ERROR_STOP on
set search_path = public;

-- Two real humans. The override is a claim about WHICH human, so the suite needs
-- more than one to say anything meaningful.
insert into auth.users (email) values ('michael@greenway.test');
insert into auth.users (email) values ('bookkeeper@greenway.test');

select set_config('harness.is_admin', 'true', false);
select set_config('harness.user_id',
  (select id::text from auth.users where email = 'michael@greenway.test'), false);

-- -----------------------------------------------------------------------------
-- Assertion helpers. Every check names its expectation.
-- -----------------------------------------------------------------------------
create or replace function public.ov_assert(label text, got boolean)
returns void language plpgsql as $$
begin
  if got is not true then
    raise exception 'ASSERTION FAILED: %', label;
  end if;
  raise notice '   PASS  %', label;
end $$;

create or replace function public.ov_assert_eq(label text, got bigint, want bigint)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', label, want, got;
  end if;
  raise notice '   PASS  % (= %)', label, got;
end $$;

create or replace function public.ov_assert_refuses(label text, stmt text, expect_fragment text)
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

-- Become a specific person.
create or replace function public.ov_be(p_email text)
returns void language plpgsql as $$
begin
  perform set_config('harness.user_id',
    (select id::text from auth.users where email = p_email), false);
end $$;

-- Build a draft journal of a given size, authored by whoever is signed in.
-- Returns the journal id. Uses gl_submit_journal -- the one door -- so these
-- entries are built exactly the way the real application builds them.
create or replace function public.ov_draft(p_entity text, p_cents bigint, p_ref text)
returns uuid language plpgsql as $$
declare v_res jsonb;
begin
  v_res := public.gl_submit_journal(
    p_entity_code := p_entity,
    p_journal_date := date '2026-03-15',
    p_source_kind := 'manual',
    p_source_ref  := p_ref,
    p_memo        := 'override suite test entry',
    p_lines       := jsonb_build_array(
      jsonb_build_object('account_code','10400','amount_cents', p_cents,
                         'cost_class','none','description','debit side'),
      jsonb_build_object('account_code','40300','amount_cents', -p_cents,
                         'cost_class','none','description','credit side')),
    p_auto_post   := false);
  return (v_res->>'journal_id')::uuid;
end $$;

-- How many override rows exist right now.
create or replace function public.ov_log_count()
returns bigint language sql stable as $$
  select count(*) from public.gl_override_log;
$$;

-- Attempt an action that is EXPECTED TO SUCCEED, without letting a refusal
-- abort the whole run. Returns 'ok', or the error message.
--
-- WHY THIS EXISTS (defect D-13, a defect in this suite, found by mutation M2).
-- Attack 3 used to call gl_approve_journal directly and then assert that the
-- approval had landed. When a mutation broke the override, the approve call
-- raised, the entire DO block aborted, and the assertion named
-- "THE POINT: Michael CAN now approve his own $250,000 entry" NEVER RAN. The
-- suite still went red -- but on a raw Postgres error, not on the assertion
-- written to catch exactly that. So the assertion could pass and could be
-- skipped, but could never FAIL. Standing rule 15 says every assertion must be
-- proven capable of failing; one that can only be skipped is decoration.
--
-- Routing the call through here converts a refusal into a plain value, so the
-- assertion that follows actually gets to run and fail BY NAME.
create or replace function public.ov_try(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return SQLERRM;
end $$;


do $$
declare
  v_entity   uuid;
  v_mike     uuid;
  v_book     uuid;
  v_jid      uuid;
  v_jid2     uuid;
  v_cnt      bigint;
  v_before   bigint;
  v_res      jsonb;
  v_err      text;
  v_pol      public.gl_approval_policy%rowtype;
begin
  select id into v_entity from public.gl_entities where code = 'greenway';
  select id into v_mike   from auth.users where email = 'michael@greenway.test';
  select id into v_book   from auth.users where email = 'bookkeeper@greenway.test';

  -- VACUITY GUARDS. Every assertion below is meaningless without these.
  if v_entity is null then
    raise exception 'VACUITY GUARD: no greenway entity — every test below would pass trivially.';
  end if;
  if v_mike is null or v_book is null then
    raise exception 'VACUITY GUARD: need two distinct users to say anything about segregation of duties.';
  end if;
  if v_mike = v_book then
    raise exception 'VACUITY GUARD: the two test users are the same person.';
  end if;

  select * into v_pol from public.gl_approval_policy where entity_id = v_entity;
  if not found then
    raise exception 'VACUITY GUARD: no approval policy for greenway — the control being tested does not exist.';
  end if;

  -- The whole suite is about a $5,000 threshold. If 0174 ever changes it, these
  -- numbers stop meaning what they say, so assert it rather than trust it.
  perform public.ov_assert_eq('the seeded threshold is $5,000.00 as 0174 documents',
    v_pol.threshold_cents, 500000);
  perform public.ov_assert('the override starts OFF (it is not a default)',
    v_pol.owner_override_enabled = false);


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 1 — the control still WORKS before we touch anything';
  raise notice '===========================================================================';

  -- NEGATIVE CONTROL FOR THE ENTIRE SUITE (rule 15b).
  -- If self-approval were somehow already possible, every "the override enabled
  -- this" assertion below would be a lie. Prove the door is shut first.
  perform public.ov_be('michael@greenway.test');
  v_jid := public.ov_draft('greenway', 25000000, 'OV-BASELINE-1');

  perform public.ov_assert_refuses(
    'BASELINE: without the override, Michael cannot approve his own $250,000 entry',
    format('select public.gl_approve_journal(%L::uuid, %L)', v_jid, 'trying to self-approve'),
    'GL_SELF_APPROVAL_REFUSED');

  -- And a SECOND person genuinely can approve it -- proving the refusal above is
  -- about WHO, not about the entry being broken in some unrelated way.
  perform public.ov_be('bookkeeper@greenway.test');
  perform public.gl_approve_journal(v_jid, 'second pair of eyes');
  perform public.ov_assert(
    'BASELINE: a different person CAN approve it (the refusal was about who, not what)',
    exists (select 1 from public.gl_journals where id = v_jid and approved_by = v_book));

  -- Nothing was logged, because no override was used.
  perform public.ov_assert_eq(
    'BASELINE: a normal two-person approval writes NOTHING to the override log',
    public.ov_log_count(), 0);


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 2 — switching the override on is not something that just happens';
  raise notice '===========================================================================';

  perform public.ov_be('michael@greenway.test');

  perform public.ov_assert_refuses(
    'the override cannot be switched on without a written reason',
    $q$ select public.gl_set_owner_override('greenway', true, 'because') $q$,
    'GL_OVERRIDE_REASON_REQUIRED');

  perform public.ov_assert_refuses(
    'the override cannot be switched on with a null reason',
    $q$ select public.gl_set_owner_override('greenway', true, null) $q$,
    'GL_OVERRIDE_REASON_REQUIRED');

  perform public.ov_assert_refuses(
    'the override cannot be set on books that do not exist',
    $q$ select public.gl_set_owner_override('not_a_real_entity', true,
          'a perfectly long and reasonable justification goes here') $q$,
    'GL_UNKNOWN_ENTITY');

  -- Still off after all those failures.
  select * into v_pol from public.gl_approval_policy where entity_id = v_entity;
  perform public.ov_assert('after three refused attempts the override is STILL off',
    v_pol.owner_override_enabled = false);


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 3 — THE HEADLINE: the override must actually WORK';
  raise notice '===========================================================================';

  -- This is what Michael asked for. If this fails, he cannot run his own books.
  v_res := public.gl_set_owner_override('greenway', true,
    'Sole operator: owner performs all administrative and accounting work; no second approver exists in the business.');

  perform public.ov_assert('turning the override on reports success',
    (v_res->>'outcome') = 'override_enabled');
  perform public.ov_assert('it reports that it was previously off',
    (v_res->>'was_enabled')::boolean = false);

  select * into v_pol from public.gl_approval_policy where entity_id = v_entity;
  perform public.ov_assert('the policy row really says the override is on',
    v_pol.owner_override_enabled = true);
  perform public.ov_assert('the written reason was stored',
    length(btrim(coalesce(v_pol.owner_override_reason,''))) >= 20);
  perform public.ov_assert('the policy records WHO switched it on',
    v_pol.owner_override_set_by = v_mike);

  -- NOW the thing that was refused in Attack 1 must succeed.
  --
  -- Both calls go through ov_try so that a REFUSAL becomes a value instead of
  -- aborting the run. See the note on ov_try: this is defect D-13. Previously a
  -- broken override killed the block on a raw error and the two assertions below
  -- never executed at all.
  v_before := public.ov_log_count();
  v_jid := public.ov_draft('greenway', 25000000, 'OV-OVERRIDE-1');
  v_err  := public.ov_try(format('select public.gl_approve_journal(%L, %L)',
                                 v_jid, 'Reviewed against the bank statement myself.'));

  perform public.ov_assert(
    'THE POINT: Michael CAN now approve his own $250,000 entry',
    v_err = 'ok'
      and exists (select 1 from public.gl_journals where id = v_jid and approved_by = v_mike));

  -- and it must actually POST, not merely be approved. The F5 slice proved that
  -- approving and posting are different things and conflating them produces a
  -- false pass.
  v_err := public.ov_try(format('select public.gl_post_journal(%L)', v_jid));
  perform public.ov_assert(
    'and it POSTS — the trigger agrees with the function (no D-1 style dead end)',
    v_err = 'ok'
      and exists (select 1 from public.gl_journals where id = v_jid and status = 'posted'));


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 4 — EVERY use of the override is recorded';
  raise notice '===========================================================================';

  -- The single most important test in this file. An override that leaves no
  -- trace is indistinguishable from having no control at all.
  perform public.ov_assert_eq(
    'using the override wrote EXACTLY ONE row to the override log',
    public.ov_log_count(), v_before + 1);

  perform public.ov_assert(
    'the log names WHO did it',
    exists (select 1 from public.gl_override_log
             where journal_id = v_jid and actor = v_mike));

  perform public.ov_assert(
    'the log records HOW MUCH, and it matches the entry',
    exists (select 1 from public.gl_override_log
             where journal_id = v_jid and amount_cents = 25000000));

  perform public.ov_assert(
    'the log records the threshold that was exceeded',
    exists (select 1 from public.gl_override_log
             where journal_id = v_jid and threshold_cents = 500000));

  perform public.ov_assert(
    'the log records WHY, using the note the approver actually typed',
    exists (select 1 from public.gl_override_log
             where journal_id = v_jid
               and reason = 'Reviewed against the bank statement myself.'));

  perform public.ov_assert(
    'the log classifies it as a self-approval',
    exists (select 1 from public.gl_override_log
             where journal_id = v_jid and override_kind = 'self_approval'));

  -- The report is the artefact an examiner would actually be handed.
  v_res := public.gl_override_report('greenway');
  perform public.ov_assert_eq('the override report counts it',
    (v_res->>'override_count')::bigint, 1);
  perform public.ov_assert('the report explains it in plain English',
    (v_res->'overrides'->0->>'plain_english') like '%approved an entry he wrote himself%');
  perform public.ov_assert('the report names the person by email',
    (v_res->'overrides'->0->>'approved_by') = 'michael@greenway.test');


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 5 — the override log CANNOT be tidied up afterwards';
  raise notice '===========================================================================';

  -- If the log can be edited, it is worth nothing: it would be rewritten exactly
  -- when it mattered. This is the same stance 0176 takes on posted rows.
  perform public.ov_assert_refuses(
    'an override log row cannot be UPDATED',
    $q$ update public.gl_override_log set reason = 'nothing to see here' $q$,
    'GL_OVERRIDE_LOG_APPEND_ONLY');

  perform public.ov_assert_refuses(
    'an override log row cannot be DELETED',
    $q$ delete from public.gl_override_log $q$,
    'GL_OVERRIDE_LOG_APPEND_ONLY');

  perform public.ov_assert_refuses(
    'the amount on a log row cannot be quietly reduced',
    $q$ update public.gl_override_log set amount_cents = 1 $q$,
    'GL_OVERRIDE_LOG_APPEND_ONLY');

  -- NEGATIVE CONTROL: the row is still there and still says what it said.
  perform public.ov_assert(
    'after three tampering attempts the original record is intact',
    exists (select 1 from public.gl_override_log
             where journal_id = v_jid
               and amount_cents = 25000000
               and reason = 'Reviewed against the bank statement myself.'));

  -- A reason cannot be a shrug in the first place.
  perform public.ov_assert_refuses(
    'a log row cannot be written with a meaningless reason',
    format($q$ insert into public.gl_override_log
             (entity_id, journal_id, override_kind, amount_cents, threshold_cents, actor, reason)
           values (%L::uuid, %L::uuid, 'self_approval', 1, 1, %L::uuid, 'ok') $q$,
           v_entity, v_jid, v_mike),
    'gl_override_log_reason_check');


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 6 — the opening balance exemption works WITHOUT the override';
  raise notice '===========================================================================';

  -- Michael asked for two separate things: a one-time exemption for the cut-over,
  -- and a standing override. They must work INDEPENDENTLY, or the "one-time"
  -- exemption is really just the standing override wearing a hat.
  v_res := public.gl_set_owner_override('greenway', false, 'testing the opening balance exemption on its own');
  select * into v_pol from public.gl_approval_policy where entity_id = v_entity;
  perform public.ov_assert('override is off again',
    v_pol.owner_override_enabled = false);

  -- NEGATIVE CONTROL: with the override off, an ordinary entry is refused again.
  v_jid2 := public.ov_draft('greenway', 25000000, 'OV-CONTROL-OFF');
  perform public.ov_assert_refuses(
    'CONTROL: with the override off, a manual self-approval is refused once more',
    format('select public.gl_approve_journal(%L::uuid, %L)', v_jid2, 'should fail'),
    'GL_SELF_APPROVAL_REFUSED');

  -- But the opening balance cut-over is still approvable by its author, because
  -- that exemption is about the SOURCE KIND, not about the override flag.
  declare
    v_ob_jid uuid;
  begin
    select j.id into v_ob_jid
    from public.gl_journals j
    where j.entity_id = v_entity
      and j.source_kind = 'opening_balance'
      and j.status = 'draft'
    limit 1;

    if v_ob_jid is null then
      -- Build one, so this attack never passes vacuously.
      insert into public.gl_opening_balances
        (entity_id, account_code, amount_cents, evidence_kind, evidence_ref, prepared_by)
      values (v_entity, '10400', 90000000, 'sage_trial_balance', 'SAGE-TB-2025-12-31', v_mike),
             (v_entity, '40300', -90000000, 'k1_or_return',      'K1-2025',            v_mike);
      v_res := public.gl_bless_opening_balances('greenway', 'cut-over for the exemption test');
      v_ob_jid := (v_res->>'journal_id')::uuid;
    end if;

    if v_ob_jid is null then
      raise exception 'VACUITY GUARD: no opening balance journal to test the exemption against.';
    end if;

    v_before := public.ov_log_count();
    perform public.gl_approve_journal(v_ob_jid, 'Cut-over reviewed line by line against Sage.');

    perform public.ov_assert(
      'THE EXEMPTION: the owner can approve the cut-over even with the override OFF',
      exists (select 1 from public.gl_journals where id = v_ob_jid and approved_by = v_mike));

    perform public.ov_assert_eq(
      'and that use is logged too — the exemption is not a blind spot',
      public.ov_log_count(), v_before + 1);

    perform public.ov_assert(
      'the log distinguishes a cut-over approval from an ordinary override',
      exists (select 1 from public.gl_override_log
               where journal_id = v_ob_jid
                 and override_kind = 'opening_balance_self_approval'));

    -- AND IT MUST POST (defect D-14, a defect in this suite, found by mutation M4).
    --
    -- This attack used to stop at "approved" and never post. But the approval
    -- TRIGGER only fires on post, so the opening-balance exemption inside the
    -- trigger was never executed by any test: M4 deleted it outright and all 54
    -- assertions still passed.
    --
    -- What that would mean in real life is the worst version of this bug. With
    -- the override off, Michael approves the cut-over -- the single entry every
    -- other number in the business is measured from -- clicks post, and is
    -- refused by a rule the approval step told him did not apply. Approving and
    -- posting are different doors (F5 established this); a test that only opens
    -- the first one is testing half a feature.
    v_err := public.ov_try(format('select public.gl_post_journal(%L)', v_ob_jid));
    perform public.ov_assert(
      'THE EXEMPTION HOLDS AT THE POST DOOR TOO — the cut-over actually reaches the ledger',
      v_err = 'ok'
        and exists (select 1 from public.gl_journals
                     where id = v_ob_jid and status = 'posted'));
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 7 — the override does NOT weaken what it was never meant to touch';
  raise notice '===========================================================================';

  -- Michael asked to approve his own work. He did NOT ask to be able to write
  -- books that do not balance, post into a closed period, or reach back before
  -- the line in the sand. Those refusals protect him from mistakes rather than
  -- from other people, and they stay absolute.
  v_res := public.gl_set_owner_override('greenway', true,
    'Sole operator override re-enabled for the remainder of the adversarial suite.');

  -- WHERE THE BALANCE RULE ACTUALLY LIVES (probed, not assumed).
  -- My first draft of this attack asserted that gl_submit_journal refuses an
  -- unbalanced entry. It does not, and the suite caught me. Probing the real
  -- functions showed the rule lives in gl_post_journal: an unbalanced entry can
  -- be DRAFTED, and is refused at the moment it would reach the ledger, staying
  -- a draft forever. That is the correct design -- a half-keyed entry should be
  -- savable -- and asserting it at the wrong stage would have been a test that
  -- described a system that does not exist.
  declare
    v_unbal uuid;
    v_res6  jsonb;
  begin
    v_res6 := public.gl_submit_journal(
      p_entity_code := 'greenway',
      p_journal_date := date '2026-03-15',
      p_source_kind := 'manual',
      p_source_ref  := 'OV-UNBALANCED',
      p_memo        := 'this must never reach the ledger',
      p_lines       := jsonb_build_array(
        jsonb_build_object('account_code','10400','amount_cents',100,'cost_class','none'),
        jsonb_build_object('account_code','40300','amount_cents',-99,'cost_class','none')),
      p_auto_post   := false);
    v_unbal := (v_res6->>'journal_id')::uuid;

    perform public.gl_approve_journal(v_unbal, 'approving an entry that does not balance');

    perform public.ov_assert_refuses(
      'even WITH the override, an unbalanced entry cannot POST',
      format('select public.gl_post_journal(%L::uuid)', v_unbal),
      'GL_OUT_OF_BALANCE');

    perform public.ov_assert(
      'and it is still a draft — approving it did not sneak it into the ledger',
      exists (select 1 from public.gl_journals where id = v_unbal and status = 'draft'));
  end;

  perform public.ov_assert_refuses(
    'even WITH the override, an entry cannot reach back before the line in the sand',
    $q$ select public.gl_submit_journal(
          p_entity_code := 'greenway',
          p_journal_date := date '2025-06-30',
          p_source_kind := 'manual',
          p_source_ref  := 'OV-BACKDATED',
          p_memo        := 'this must never post',
          p_lines       := jsonb_build_array(
            jsonb_build_object('account_code','10400','amount_cents',100,'cost_class','none'),
            jsonb_build_object('account_code','40300','amount_cents',-100,'cost_class','none')),
          p_auto_post   := false) $q$,
    'line_in_the_sand');

  -- Approval still requires SOMEBODY. The override says which human, never
  -- whether a human is named at all.
  declare
    v_anon uuid;
  begin
    v_anon := public.ov_draft('greenway', 25000000, 'OV-ANON-1');
    perform set_config('harness.user_id', '', false);
    perform public.ov_assert_refuses(
      'even WITH the override, nobody-at-all cannot approve',
      format('select public.gl_approve_journal(%L::uuid, %L)', v_anon, 'ghost approval'),
      'GL_NO_APPROVER_IDENTITY');
    perform public.ov_be('michael@greenway.test');
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 8 — the override cannot be posted around, only used openly';
  raise notice '===========================================================================';

  -- 0174 put the real enforcement in a trigger so the rule could not be walked
  -- around by updating gl_journals directly. Prove that is still true: an
  -- unapproved entry must not reach the ledger even with the override on.
  declare
    v_sneaky uuid;
  begin
    v_sneaky := public.ov_draft('greenway', 25000000, 'OV-SNEAKY-1');

    perform public.ov_assert_refuses(
      'an UNAPPROVED entry cannot be posted, override or not',
      format('select public.gl_post_journal(%L::uuid)', v_sneaky),
      'GL_APPROVAL_REQUIRED');

    perform public.ov_assert_refuses(
      'and it cannot be flipped to posted by updating the table directly',
      format($q$ update public.gl_journals set status = 'posted' where id = %L::uuid $q$, v_sneaky),
      'GL_APPROVAL_REQUIRED');

    -- NEGATIVE CONTROL: approve it properly and it goes through, proving the
    -- refusals above were about the missing approval and nothing else.
    perform public.gl_approve_journal(v_sneaky, 'Approved openly, using the override as intended.');
    perform public.gl_post_journal(v_sneaky);
    perform public.ov_assert(
      'CONTROL: once approved openly it posts normally',
      exists (select 1 from public.gl_journals where id = v_sneaky and status = 'posted'));
  end;

  -- ---------------------------------------------------------------------------
  -- THE SAME BOUNDARY, AT THE POST DOOR (defect D-16, found by mutation M14).
  --
  -- Attack 8 above proves an unapproved entry cannot post -- but it uses
  -- $250,000, which is so far above the line that the exact comparison never
  -- matters. M14 changed the trigger's `<` to `<=` and every assertion still
  -- passed.
  --
  -- What that mutation actually does is let an UNAPPROVED entry of exactly
  -- $5,000.00 post straight to the ledger with no review at all. The approval
  -- function and the posting trigger each carry their own copy of the threshold
  -- comparison, so each one needs its own boundary test; proving one is correct
  -- says nothing about the other.
  -- ---------------------------------------------------------------------------
  declare
    v_edge_post uuid;
    v_thr2      bigint;
  begin
    select threshold_cents into v_thr2
    from public.gl_approval_policy where entity_id = v_entity;

    if v_thr2 is null or v_thr2 <= 1 then
      raise exception 'VACUITY GUARD: threshold is % — the post-door boundary test is meaningless.', v_thr2;
    end if;

    v_edge_post := public.ov_draft('greenway', v_thr2, 'OV-EDGE-POST');
    perform public.ov_assert_refuses(
      'THE POST BOUNDARY: an UNAPPROVED entry of exactly the threshold cannot reach the ledger',
      format('select public.gl_post_journal(%L::uuid)', v_edge_post),
      'GL_APPROVAL_REQUIRED');

    perform public.ov_assert(
      'and it really is still sitting as a draft, not quietly posted',
      exists (select 1 from public.gl_journals
               where id = v_edge_post and status = 'draft'));
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 9 — turning the override OFF really restores the control';
  raise notice '===========================================================================';

  -- A control you cannot re-arm is not a control, it is a one-way door.
  v_res := public.gl_set_owner_override('greenway', false, 'standing down the override');
  perform public.ov_assert('turning it off reports success',
    (v_res->>'outcome') = 'override_disabled');

  v_jid2 := public.ov_draft('greenway', 25000000, 'OV-REARMED-1');
  perform public.ov_assert_refuses(
    'THE RE-ARM: with the override off, self-approval is refused again',
    format('select public.gl_approve_journal(%L::uuid, %L)', v_jid2, 'should fail again'),
    'GL_SELF_APPROVAL_REFUSED');

  -- and the historical log survived being switched off
  perform public.ov_assert(
    'the record of past overrides survives switching the override off',
    public.ov_log_count() >= 2);


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 10 — below the threshold nothing changed at all';
  raise notice '===========================================================================';

  -- The override is about entries AT OR ABOVE $5,000. Small entries never needed
  -- a second approver and must not start needing one, or start being logged as
  -- overrides, which would bury the real overrides in noise.
  v_before := public.ov_log_count();
  declare
    v_small uuid;
  begin
    v_small := public.ov_draft('greenway', 100000, 'OV-SMALL-1');  -- $1,000.00
    perform public.gl_approve_journal(v_small, 'small entry, no second approver needed');
    perform public.gl_post_journal(v_small);
    perform public.ov_assert(
      'a $1,000 entry self-approves and posts exactly as it always did',
      exists (select 1 from public.gl_journals where id = v_small and status = 'posted'));
    perform public.ov_assert_eq(
      'and it is NOT written to the override log — small entries are not overrides',
      public.ov_log_count(), v_before);
  end;

  -- ---------------------------------------------------------------------------
  -- THE BOUNDARY ITSELF (defect D-15, a defect in this suite, found by mutation
  -- M13).
  --
  -- The suite tested $1,000 (clearly below) and $250,000 (clearly above) and
  -- never once tested an entry sitting EXACTLY on the $5,000.00 line. So when
  -- M13 changed `>=` to `>`, every assertion still passed.
  --
  -- The policy says "at or above $5,000 needs a second pair of eyes". Under that
  -- one-character change, an entry of exactly $5,000.00 would quietly become
  -- self-approvable and would never appear in the override log at all. That is
  -- the most dangerous shape of bug in this whole slice: it does not break
  -- anything visible, it just silently moves the line, and the entries that slip
  -- through are invisible precisely because they were never recorded as
  -- overrides. Nobody would ever notice from the outside.
  --
  -- The override is OFF at this point (Attack 9 stood it down), so an entry ON
  -- the line must be REFUSED.
  -- ---------------------------------------------------------------------------
  declare
    v_edge  uuid;
    v_under uuid;
    v_thr   bigint;
  begin
    select threshold_cents into v_thr
    from public.gl_approval_policy where entity_id = v_entity;

    -- VACUITY GUARD: if the threshold were null or zero the two cases below
    -- would collapse into each other and prove nothing.
    if v_thr is null or v_thr <= 1 then
      raise exception 'VACUITY GUARD: threshold is % — the boundary test is meaningless.', v_thr;
    end if;

    perform public.ov_assert('the override is still OFF for the boundary test',
      not exists (select 1 from public.gl_approval_policy
                   where entity_id = v_entity and owner_override_enabled));

    -- EXACTLY ON THE LINE: must be refused. "At or above" includes "at".
    v_edge := public.ov_draft('greenway', v_thr, 'OV-EDGE-EXACT');
    perform public.ov_assert_refuses(
      'THE BOUNDARY: an entry of EXACTLY the threshold still needs a second pair of eyes',
      format('select public.gl_approve_journal(%L::uuid, %L)', v_edge, 'exactly on the line'),
      'GL_SELF_APPROVAL_REFUSED');

    -- NEGATIVE CONTROL (rule 15b): one cent BELOW the line must still sail
    -- through. Without this, the assertion above would also pass if the code
    -- simply refused everything, which would be a different bug entirely.
    v_before := public.ov_log_count();
    v_under  := public.ov_draft('greenway', v_thr - 1, 'OV-EDGE-UNDER');
    v_err    := public.ov_try(format('select public.gl_approve_journal(%L, %L)',
                                     v_under, 'one cent below the line'));
    perform public.ov_assert(
      'CONTROL: one cent BELOW the threshold is still freely self-approved',
      v_err = 'ok');
    perform public.ov_assert_eq(
      'and one cent below the line is NOT logged as an override',
      public.ov_log_count(), v_before);
  end;


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ATTACK 11 — only an admin may grant himself the override';
  raise notice '===========================================================================';

  perform set_config('harness.is_admin', 'false', false);

  perform public.ov_assert_refuses(
    'a non-admin cannot switch the override on',
    $q$ select public.gl_set_owner_override('greenway', true,
          'granting myself permission which I should not have') $q$,
    'GL_FORBIDDEN');

  perform public.ov_assert_refuses(
    'a non-admin cannot read the override report',
    $q$ select public.gl_override_report('greenway') $q$,
    'GL_FORBIDDEN');

  -- WHY THIS IS ASSERTED STRUCTURALLY RATHER THAN BY ATTEMPTING A READ.
  -- My first version of this attack tried to SELECT the log as a non-admin and
  -- expected "permission denied". It never denied, and the suite caught it.
  -- Probing showed why: this harness runs as `postgres`, a SUPERUSER, and
  -- superusers BYPASS row level security entirely. So the read would have
  -- succeeded no matter how the policy was written -- including if the policy
  -- were missing altogether. That assertion could only ever have tested the
  -- harness, never the protection, which is precisely the "silent failure passed
  -- off as success" this suite exists to prevent.
  --
  -- What CAN be proven here is that the protection is really in place: RLS
  -- switched on, and exactly one read policy gated on is_admin(). Whether
  -- PostgreSQL then enforces RLS correctly is PostgreSQL's own guarantee.
  perform public.ov_assert(
    'row level security is switched ON for the override log',
    (select relrowsecurity from pg_class where relname = 'gl_override_log'));

  perform public.ov_assert(
    'the only policy on the override log is a read policy',
    (select count(*) from pg_policy
      where polrelid = 'public.gl_override_log'::regclass) = 1);

  perform public.ov_assert(
    'that policy is gated on is_admin()',
    (select pg_get_expr(polqual, polrelid) from pg_policy
      where polrelid = 'public.gl_override_log'::regclass) like '%is_admin%');

  perform public.ov_assert(
    'there is NO insert, update or delete policy — rows arrive only via the approval function',
    not exists (select 1 from pg_policy
                 where polrelid = 'public.gl_override_log'::regclass
                   and polcmd in ('a','w','d')));

  perform set_config('harness.is_admin', 'true', false);

  -- VACUITY GUARD: prove the admin flag is what made the difference, not some
  -- unrelated breakage that would make every refusal above meaningless.
  perform public.ov_assert('CONTROL: as an admin again, the report reads fine',
    (public.gl_override_report('greenway')->>'override_count')::bigint >= 2);


  raise notice '';
  raise notice '===========================================================================';
  raise notice 'ALL OWNER OVERRIDE ATTACKS REPELLED';
  raise notice '===========================================================================';
end $$;
