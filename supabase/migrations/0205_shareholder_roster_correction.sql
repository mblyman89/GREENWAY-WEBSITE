-- =============================================================================
-- 0205_shareholder_roster_correction.sql   (books-50)
--
-- CORRECTS THE SEEDED SHAREHOLDER ROSTER. This is a DATA correction, not a
-- schema change.
--
-- WHAT WAS WRONG
-- Migration 0172 seeded public.gl_shareholders for Greenway with THREE rows:
--
--     'Michael Lyman'   owner        85000  receives_distributions = true
--     'Mother'          mother       10000  receives_distributions = false
--     'Nicholas Mullan' grandfather   5000  receives_distributions = true
--
-- The filed Form 1120-S reports FOUR shareholders. Box I of the 2024 return -
-- "Enter the number of shareholders who were shareholders during any part of
-- the tax year" - reads 4, and there are four Schedule K-1s in both the 2024
-- and 2025 returns, each showing field G "Current year allocation percentage":
--
--     Michael B Lyman     85.000000%
--     Nicholas C Mullan    5.000000%
--     James H Becker       5.000000%
--     Theresa L Becker     5.000000%
--
-- Confirmed independently by the K-1 dollars, which do not depend on the stated
-- percentages: 2024 box 1 is $630,215 to Michael and $37,072 to each of the
-- other three, totalling the $741,431 on page 1 line 22. The 2025 return says
-- the same thing at a different scale ($34,151 each against $683,029).
--
-- The owner confirmed it in his own words in August 2026: "there is 4
-- individuals. My wife and I: 85%, my grandpa: 5%, and my mom and step father:
-- 5% each," and that this has been the case for nearly all twelve years the
-- shop has been open. So the roster was WRONG WHEN SEEDED. There is no stock
-- transfer to record and no effective date to straddle - this migration is a
-- correction of a recording error, not a change of ownership.
--
-- WHY THE 10% WAS NOT INVENTED, AND WHY IT STILL HAD TO GO
-- Washington is a community-property state. Theresa's 5% and James's 5% are one
-- 10% marital economic unit, which is why the old row said 10%. That reading is
-- true, and it is preserved in the notes below. What it may NOT do is stand in
-- for the legal roster, because things get COUNTED off this table - IRC 6699
-- multiplies a penalty by "the number of persons who were shareholders", and at
-- three instead of four that understated Greenway's twelve-month exposure by
-- $2,340: $7,020 [SUPERSEDED-ROSTER] against the correct $9,360 at the un-inflated base.
-- [SUPERSEDED-ROSTER: $7,020 is what the WRONG three-shareholder count produced.]
--
-- WHY 0172 COULD NOT SIMPLY BE RE-RUN
-- Two reasons. Its insert is guarded by `and not exists (select 1 from
-- public.gl_shareholders ...)`, so it is a one-shot seed and does nothing on a
-- database that already has rows. And 0172 is already applied to the live
-- database, so editing it would leave the file and the data disagreeing. The
-- comment in 0172 has been corrected for future readers; the DATA is fixed
-- here, forward-only.
--
-- WHY THE TOTAL-100% CHECK NEVER CAUGHT THIS
-- 85000 + 10000 + 5000 = 100000. The wrong roster BALANCES. [SUPERSEDED-ROSTER:
-- the filed roster is 85000 + 5000 + 5000 + 5000.] The statement-level
-- trigger gl_assert_ownership_sums() was correct and passed it every time. A
-- wrong roster is not an unbalanced roster; it is a balanced roster describing
-- the wrong people. That trigger is still right and still necessary - it simply
-- cannot police WHO the holders are. Hence the identity checks at the end.
--
-- IDEMPOTENT. Safe to run repeatedly (standing rule 62a). The delete-then-
-- insert is one statement pair inside the implicit transaction, so the
-- statement-level ownership trigger sees the finished set of four rows and
-- never an intermediate total.
-- =============================================================================

do $$
declare
  v_entity_id  uuid;
  v_before     integer;
  v_after      integer;
  v_total      integer;
begin
  select id into v_entity_id from public.gl_entities where code = 'greenway';

  if v_entity_id is null then
    raise exception
      'GL_ROSTER_FIX: no entity with code ''greenway'' exists. Migration 0172 seeds it; '
      'this migration must run after it.';
  end if;

  select count(*) into v_before
  from public.gl_shareholders where entity_id = v_entity_id;

  -- Replace the roster wholesale rather than patching row by row. Patching
  -- would mean an UPDATE that momentarily leaves the total at something other
  -- than 100000, and there is a statement-level trigger watching for exactly
  -- that. A clean delete-and-insert also means this migration produces the same
  -- four rows whether it is run against the original three-row seed, against
  -- its own output, or against a hand-edited table.
  delete from public.gl_shareholders where entity_id = v_entity_id;

  insert into public.gl_shareholders
    (entity_id, name, relationship, ownership_milli_pct, receives_distributions, notes)
  values
    (v_entity_id, 'Michael B Lyman', 'owner', 85000, true,
     'Verified 85.000000% on Schedule K-1 field G for 2024 and 2025, and by box 1 '
     'dollars ($630,215 of $741,431 in 2024). The owner describes this holding as '
     '"my wife and I": Washington is a community-property state, so his wife '
     'Alyssa has a community interest in it. She is NOT a separate shareholder - '
     'she appears nowhere on the 1120-S, and IRC 1361(c)(1)(A)(i) treats a husband '
     'and wife as one shareholder only "for purposes of subsection (b)(1)(A)", the '
     '100-shareholder eligibility ceiling. Recorded as fact; nothing is computed '
     'from it.'),
    (v_entity_id, 'Nicholas C Mullan', 'grandfather', 5000, true,
     'Grandfather, and the preparer of the returns; 5% for performing the tax work, '
     'and is paid his share. Verified 5.000000% on Schedule K-1 field G for 2024 '
     'and 2025.'),
    (v_entity_id, 'James H Becker', 'step-father', 5000, false,
     'Step-father. Verified 5.000000% on Schedule K-1 field G for 2024 and 2025. '
     'Was NOT a separate row before books-50: his interest was folded into a single '
     '10% "Mother" row, because under Washington community-property law his 5% and '
     'his wife Theresa''s 5% are one 10% marital economic unit. True economically, '
     'wrong legally - and wrong for anything that COUNTS shareholders. '
     'receives_distributions is set false pending owner confirmation, which is the '
     'conservative setting: the books must never silently assume a holder was paid. '
     'FLAGGED FOR OWNER CONFIRMATION.'),
    (v_entity_id, 'Theresa L Becker', 'mother', 5000, false,
     'Mother. Verified 5.000000% on Schedule K-1 field G for 2024 and 2025. Holds '
     '5%, not the 10% recorded before books-50; the 10% is the Becker household '
     'total across two shareholders. Allocated income but not paid distributions, '
     'with Michael covering the resulting tax personally. That is a '
     'one-class-of-stock question under Treas. Reg. 1.1361-1(l) and a possible '
     'gift-tax question, both of which are for his grandfather to weigh in on. '
     'FLAGGED FOR OWNER CONFIRMATION.');

  -- ---------------------------------------------------------------------------
  -- PROVE IT. A migration that reports success without checking its own result
  -- is a claim, not a fact (standing rule 96).
  -- ---------------------------------------------------------------------------

  select count(*) into v_after
  from public.gl_shareholders where entity_id = v_entity_id;

  if v_after <> 4 then
    raise exception
      'GL_ROSTER_FIX: expected exactly 4 shareholder rows after the correction, found %. '
      'Box I of the filed 2024 Form 1120-S reads 4.', v_after;
  end if;

  -- The aggregate check, which the trigger also enforces.
  select sum(ownership_milli_pct) into v_total
  from public.gl_shareholders
  where entity_id = v_entity_id and active is true;

  if v_total <> 100000 then
    raise exception
      'GL_ROSTER_FIX: ownership totals % milli-percent, not 100000.', v_total;
  end if;

  -- THE IDENTITY CHECK, which is the one that would have caught the original
  -- error. Every name and percentage must match the filed Schedule K-1s
  -- exactly. Note that the superseded roster passed the two checks above.
  if exists (
    select 1
    from (values
      ('Michael B Lyman',   85000),
      ('Nicholas C Mullan',  5000),
      ('James H Becker',     5000),
      ('Theresa L Becker',   5000)
    ) as want(name, pct)
    full outer join public.gl_shareholders s
      on s.entity_id = v_entity_id and s.name = want.name
    where s.id is null
       or want.name is null
       or s.ownership_milli_pct <> want.pct
  ) then
    raise exception
      'GL_ROSTER_FIX: the roster does not match the filed Schedule K-1s '
      '(Michael B Lyman 85%%, Nicholas C Mullan 5%%, James H Becker 5%%, '
      'Theresa L Becker 5%%).';
  end if;

  -- Nobody at 10%. Asserted as an absence because it is the specific defect
  -- being corrected (standing rule 87).
  if exists (
    select 1 from public.gl_shareholders
    where entity_id = v_entity_id and ownership_milli_pct = 10000
  ) then
    raise exception
      'GL_ROSTER_FIX: a shareholder is still recorded at 10%%. The 10%% figure is '
      'the Becker HOUSEHOLD across two shareholders, not any one person''s holding.';
  end if;

  raise notice
    'GL_ROSTER_FIX: Greenway roster corrected from % row(s) to 4 (85/5/5/5), '
    'identity verified against the filed Schedule K-1s.', v_before;
end $$;

-- Keep the column comment honest: it previously stated the mother's holding as
-- 10%, which was the error itself.
comment on column public.gl_shareholders.receives_distributions is
  'FALSE where a shareholder is ALLOCATED income but is not actually PAID a '
  'distribution. At Greenway this is true of the two 5% Becker interests, with '
  'Michael covering the resulting tax personally. Recorded rather than assumed: '
  'a one-class-of-stock question under Treas. Reg. 1.1361-1(l) turns on it, and '
  'the books must never silently assume a holder was paid.';
