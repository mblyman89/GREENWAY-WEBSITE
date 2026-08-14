-- =====================================================================
-- prove-gl-indelible.sql
--
-- ONE QUESTION, ANSWERED WITH EVIDENCE RATHER THAN OPINION:
--
--   "Michael has been testing on the site he calls a development site.
--    It is wired to a real Supabase project. If he keeps testing the
--    BOOKS there, can the test entries be cleaned up afterwards?"
--
-- This is not a style question. Michael's instinct -- "there's no real
-- data in there other than photos, and if I have to re-accumulate a few
-- pictures, so be it" -- is a perfectly sound instinct about a WEBSITE.
-- It is the wrong instinct about a LEDGER, and the difference is the
-- whole point of this script.
--
-- A website is a pile of content. Wrong content is replaced with right
-- content and no trace remains, which is exactly what you want.
--
-- A general ledger is deliberately built so nothing can be quietly
-- replaced. That is not a limitation; it is the property that makes the
-- books worth anything to the IRS. We BUILT it that way on purpose
-- (0172 GL_IMMUTABLE, ASC 250, append-only audit trail).
--
-- So the question is empirical: once a test entry is posted, can it be
-- removed? This script finds out by TRYING.
--
-- Run:  TESTS_OVERRIDE=/workspace/repo/scripts/accounting/prove-gl-indelible.sql \
--         PGPORT=5440 bash scripts/accounting/verify-owner-override.sh
-- =====================================================================

\set ON_ERROR_STOP on

-- Identity, using the same harness convention as the rest of the suite.
insert into auth.users (email) values ('michael@greenway.test')
  on conflict do nothing;
select set_config('harness.is_admin', 'true', false);
select set_config('harness.user_id',
  (select id::text from auth.users where email = 'michael@greenway.test'), false);

-- Helper: run a statement, capture whatever the database says back.
-- Without this the FIRST refusal aborts the script and every assertion
-- after it is silently SKIPPED -- a suite that "passes" because it
-- stopped running. That is defect D-13 from the F6 campaign, and it is
-- not making a return appearance.
create or replace function public.pv_try(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return SQLERRM;
end $$;

do $$
declare
  v_res     jsonb;
  v_journal uuid;
  v_rev     uuid;
  v_draft   uuid;
  v_result  text;
  v_count   bigint;
  v_passed  int := 0;
begin
  raise notice '';
  raise notice '=== CAN A POSTED TEST ENTRY EVER BE CLEANED UP? ===';
  raise notice '';

  ---------------------------------------------------------------------
  -- STEP 1: post an entry, exactly as "just poking around" would.
  --         $123.45. Harmless-looking. That is precisely the point.
  ---------------------------------------------------------------------
  v_res := public.gl_submit_journal(
    p_entity_code  := 'greenway',
    p_journal_date := date '2026-06-15',
    p_source_kind  := 'manual',
    p_source_ref   := 'PROVE-INDELIBLE-1',
    p_memo         := 'TEST ENTRY typed while poking around the site',
    p_lines        := jsonb_build_array(
      jsonb_build_object('account_code','10400','amount_cents', 12345,
                         'cost_class','none','description','test debit'),
      jsonb_build_object('account_code','40300','amount_cents',-12345,
                         'cost_class','none','description','test credit')),
    p_auto_post    := false);

  v_journal := (v_res->>'journal_id')::uuid;
  if v_journal is null then
    raise exception 'SETUP FAILED: no journal_id came back from gl_submit_journal';
  end if;

  perform public.gl_post_journal(v_journal);

  select count(*) into v_count
    from public.gl_journals where id = v_journal and status = 'posted';
  if v_count <> 1 then
    raise exception 'ASSERTION FAILED: the test entry did not post, so nothing below proves anything';
  end if;
  v_passed := v_passed + 1;
  raise notice 'OK   a $123.45 TEST entry is now posted to the real books.';

  ---------------------------------------------------------------------
  -- STEP 2: try to DELETE it. This is the "I'll just clean it up later"
  --         assumption, tested rather than believed.
  ---------------------------------------------------------------------
  v_result := public.pv_try(format('delete from public.gl_journals where id = %L', v_journal));

  if v_result = 'ok' then
    raise exception 'ASSERTION FAILED: the posted entry WAS deleted. The ledger is not immutable and my report to Michael would be wrong.';
  end if;
  -- IT IS NOT ENOUGH THAT THE DELETE FAILED.
  -- The first version of this test only checked for the 'GL_IMMUTABLE:'
  -- prefix, and a mutation that disabled the journal delete-guard STILL
  -- PASSED -- because the delete was then refused by a DIFFERENT rule
  -- (the append-only audit trail), which is not the protection being
  -- claimed here. A test that accepts any refusal cannot tell "the rule
  -- works" from "some unrelated rule happened to fire first".
  -- So: the refusal must name THIS JOURNAL and say it is posted.
  if v_result not like 'GL_IMMUTABLE: journal%' then
    raise exception 'ASSERTION FAILED: delete refused, but NOT by the posted-journal guard. Got: %', v_result;
  end if;
  if position(v_journal::text in v_result) = 0 then
    raise exception 'ASSERTION FAILED: the refusal did not name the journal we tried to delete (%). Got: %', v_journal, v_result;
  end if;
  if v_result not like '%cannot be deleted%' then
    raise exception 'ASSERTION FAILED: the refusal was not the DELETE guard. Got: %', v_result;
  end if;
  v_passed := v_passed + 1;
  raise notice 'OK   DELETE refused -> %', left(v_result, 78);

  ---------------------------------------------------------------------
  -- STEP 3: try to EDIT it -- the quieter, more tempting "cleanup".
  ---------------------------------------------------------------------
  v_result := public.pv_try(format(
    'update public.gl_journals set memo = ''nothing to see here'' where id = %L', v_journal));

  if v_result = 'ok' then
    raise exception 'ASSERTION FAILED: a posted entry was edited. Posted entries must be frozen.';
  end if;
  if v_result not like 'GL_IMMUTABLE: journal%' then
    raise exception 'ASSERTION FAILED: update refused, but NOT by the posted-journal guard. Got: %', v_result;
  end if;
  if position(v_journal::text in v_result) = 0 then
    raise exception 'ASSERTION FAILED: the refusal did not name the journal we tried to edit (%). Got: %', v_journal, v_result;
  end if;
  if v_result not like '%cannot be edited%' then
    raise exception 'ASSERTION FAILED: the refusal was not the EDIT guard. Got: %', v_result;
  end if;
  v_passed := v_passed + 1;
  raise notice 'OK   UPDATE refused -> %', left(v_result, 78);

  ---------------------------------------------------------------------
  -- STEP 4: try to pull the LINES out from under it, leaving a shell.
  ---------------------------------------------------------------------
  v_result := public.pv_try(format(
    'delete from public.gl_journal_lines where journal_id = %L', v_journal));

  if v_result = 'ok' then
    raise exception 'ASSERTION FAILED: the lines were deleted, leaving a hollow entry.';
  end if;
  if v_result not like 'GL_IMMUTABLE: journal%' then
    raise exception 'ASSERTION FAILED: line delete refused, but NOT by the posted-lines guard. Got: %', v_result;
  end if;
  if position(v_journal::text in v_result) = 0 then
    raise exception 'ASSERTION FAILED: the refusal did not name the journal whose lines we attacked (%). Got: %', v_journal, v_result;
  end if;
  if v_result not like '%lines cannot be%' then
    raise exception 'ASSERTION FAILED: the refusal was not the LINES guard. Got: %', v_result;
  end if;
  v_passed := v_passed + 1;
  raise notice 'OK   deleting the LINES refused -> %', left(v_result, 78);

  ---------------------------------------------------------------------
  -- STEP 5: so what IS the sanctioned undo? A REVERSAL. Prove it works,
  --         and prove what it leaves behind.
  ---------------------------------------------------------------------
  v_rev := public.gl_reverse_journal(v_journal, 'reversing a test entry', date '2026-06-16');
  if v_rev is null then
    raise exception 'ASSERTION FAILED: reversal produced nothing';
  end if;
  v_passed := v_passed + 1;
  raise notice 'OK   a reversal was created (the sanctioned undo).';

  -- The original MUST still be there and MUST still be posted.
  select count(*) into v_count
    from public.gl_journals where id = v_journal and status = 'posted';
  if v_count <> 1 then
    raise exception 'ASSERTION FAILED: the original entry did not survive its own reversal';
  end if;
  v_passed := v_passed + 1;
  raise notice 'OK   the ORIGINAL test entry is STILL THERE, still posted.';

  ---------------------------------------------------------------------
  -- STEP 6: THE POINT. After a full, textbook-correct cleanup, how many
  --         permanent rows still mention this "harmless" test?
  ---------------------------------------------------------------------
  select count(*) into v_count
    from public.gl_journals
   where id in (v_journal, v_rev);

  if v_count < 2 then
    raise exception 'ASSERTION FAILED: expected BOTH the entry and its reversal to persist, found %', v_count;
  end if;
  v_passed := v_passed + 1;
  raise notice 'OK   after the CORRECT cleanup, % permanent rows still record the test.', v_count;

  ---------------------------------------------------------------------
  -- STEP 7: NEGATIVE CONTROL (rule 15b).
  --   Every refusal above would ALSO appear if this database simply
  --   rejected all writes for some unrelated reason -- a suite that
  --   looks strict but is merely broken. Prove deletes genuinely work
  --   by deleting an UNPOSTED draft, which the rules do permit.
  ---------------------------------------------------------------------
  v_res := public.gl_submit_journal(
    p_entity_code  := 'greenway',
    p_journal_date := date '2026-06-17',
    p_source_kind  := 'manual',
    p_source_ref   := 'PROVE-INDELIBLE-DRAFT',
    p_memo         := 'a draft, never posted',
    p_lines        := jsonb_build_array(
      jsonb_build_object('account_code','10400','amount_cents', 500,
                         'cost_class','none','description','d'),
      jsonb_build_object('account_code','40300','amount_cents',-500,
                         'cost_class','none','description','c')),
    p_auto_post    := false);
  v_draft := (v_res->>'journal_id')::uuid;

  v_result := public.pv_try(format('delete from public.gl_journals where id = %L', v_draft));

  if v_result <> 'ok' then
    raise exception 'ASSERTION FAILED (NEGATIVE CONTROL): an UNPOSTED draft could not be deleted either (%). That means the refusals above prove nothing about immutability -- this database is just refusing everything.', v_result;
  end if;
  v_passed := v_passed + 1;
  raise notice 'OK   NEGATIVE CONTROL: an unposted DRAFT deletes cleanly.';
  raise notice '     So the refusals above are specific to POSTED entries, not a broken database.';

  raise notice '';
  raise notice '=== % assertions passed ===', v_passed;
  raise notice '';
  raise notice 'CONCLUSION: a posted entry cannot be deleted or edited. The only';
  raise notice 'sanctioned undo is a reversal, which ADDS a row rather than removing';
  raise notice 'one. Test entries posted into a real ledger are PERMANENT, and they';
  raise notice 'are permanent BY DESIGN -- that is the property that makes the books';
  raise notice 'defensible. It also means a ledger is the one place where "I''ll just';
  raise notice 'clean it up later" is not available.';
  raise notice '';
end $$;

drop function if exists public.pv_try(text);
