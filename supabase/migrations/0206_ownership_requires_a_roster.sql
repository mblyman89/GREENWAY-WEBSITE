-- =============================================================================
-- 0206_ownership_requires_a_roster.sql   (books-51)
--
-- CLOSES THE SECOND HOLE IN THE OWNERSHIP CHECK. This is a SCHEMA change (a new
-- trigger); it moves no data and changes no existing row.
--
-- ─── WHAT WAS WRONG ────────────────────────────────────────────────────────
--
-- 0172 installed gl_assert_ownership_sums(), which groups the active
-- shareholders by entity and rejects any entity whose ownership does not total
-- exactly 100000 milli-percent. That check is correct and stays exactly as it
-- is. It has one blind spot, found while writing the books-50 verify script and
-- deliberately recorded there rather than patched in the middle of a data fix
-- (standing rule 4, one feature per PR):
--
--     GROUP BY over zero rows yields zero groups, and HAVING cannot reject a
--     group that does not exist.
--
-- So deleting EVERY shareholder is accepted in silence. Measured, not assumed:
-- against a real PostgreSQL 15 running 0172 -> 0205, `delete from
-- gl_shareholders` returned rc=0 and left `count(*) = 0`.
--
-- ─── WHY AN EMPTY ROSTER IS NOT A HARMLESS EMPTY TABLE ─────────────────────
--
-- Things are COUNTED off this table. IRC 6699(b)(2) multiplies the late-filing
-- penalty by "the number of persons who were shareholders in the S corporation
-- during any part of the taxable year". An empty roster does not read as
-- "unknown"; it reads as ZERO, and zero shareholders x $195 x 12 months = $0.
-- That is the same failure mode books-21 was created to remove, where a
-- year-late 1120-S was reported as costing nothing. A system that answers $0
-- does not merely fail to warn - it recommends the behaviour it exists to
-- prevent.
--
-- It is also not a state that can legally exist. An S corporation with no
-- shareholders is not an S corporation; IRC 1361(b)(1) defines a small business
-- corporation by reference to the shareholders it has.
--
-- ─── WHY THIS IS A DEFERRED CONSTRAINT TRIGGER, AND NOT THE OBVIOUS FIX ────
--
-- The obvious fix is to add an emptiness test to the existing statement-level
-- trigger. THAT FIX IS WRONG, AND IT WAS PROVEN WRONG BEFORE THIS FILE WAS
-- WRITTEN rather than after.
--
-- 0205 replaces the roster wholesale: DELETE every row, then INSERT four. It
-- does that deliberately, so it lands the same four rows whatever it starts
-- from. The existing trigger is FOR EACH STATEMENT, so it fires on the
-- intermediate state - after the DELETE, before the INSERT - where the table is
-- legitimately empty for a moment inside one transaction. A statement-level
-- emptiness check therefore breaks 0205 itself. Measured: with a naive
-- statement-level check installed, re-running 0205 FAILED.
--
-- The mechanism that tolerates a transient state and still enforces the final
-- one is a DEFERRABLE INITIALLY DEFERRED constraint trigger, which fires at
-- COMMIT. Two facts about PostgreSQL had to be established first, and both were
-- established by asking PostgreSQL rather than by reasoning:
--
--   1. A constraint trigger MAY NOT be FOR EACH STATEMENT. PostgreSQL rejects
--      it outright. It must be FOR EACH ROW. So this trigger is per row and the
--      function is written to be cheap and idempotent - it re-checks the same
--      small NOT EXISTS regardless of which row fired it.
--   2. Under that deferred trigger, 0205's delete-then-insert SUCCEEDS
--      (verified rc=0, four active holders), while a real emptying is REFUSED
--      (verified rc=3, GL_ROSTER_EMPTY raised, and the rows still present
--      because the transaction rolled back).
--
-- ─── WHY IT KEYS ON tax_form = '1120S' AND NOT ON "every entity" ───────────
--
-- Four entities are tracked here and only ONE of them has shareholders:
--
--     greenway     1120S        4 holders   <- the S corporation
--     atm          1040_SCH_C   0 holders   <- sole proprietorship, correctly 0
--     landholding  1040_SCH_C   0 holders   <- sole proprietorship, correctly 0
--     personal     1040         0 holders   <- not a business entity at all
--
-- A blanket "every entity must have shareholders" rule would refuse three
-- entities that are RIGHT to be empty, and the first thing a false alarm
-- teaches is to ignore the alarm. A Schedule C business has an owner, not
-- shareholders; there is no roster to keep and nothing counts one. So the
-- requirement attaches to the thing that actually creates it - being taxed as
-- an S corporation - and it will attach itself automatically to any future
-- entity whose tax_form is set to 1120S, without anyone remembering to come
-- back here.
--
-- ─── WHAT THIS DOES NOT CLAIM TO STOP ─────────────────────────────────────
--
-- TRUNCATE does not fire INSERT/UPDATE/DELETE triggers at all. On this table a
-- plain TRUNCATE is already refused for an unrelated reason - gl_journal_lines
-- holds a foreign key to gl_shareholders, so PostgreSQL blocks it - but
-- TRUNCATE ... CASCADE would not be blocked by that. A separate AFTER TRUNCATE
-- statement trigger is therefore installed below as well. Stated plainly
-- because an unstated limit is a limit nobody tests (standing rule 87).
--
-- This trigger also does NOT police WHO is on the roster. Nothing can, from
-- inside the database - that is what the identity check in 0205 and the filed
-- Schedule K-1s are for. Standing rule 101: a wrong roster still adds up to
-- 100%. This closes the ZERO case only, and says so.
--
-- ─── A PRE-EXISTING LIMITATION FOUND WHILE PROVING THIS, NOT INTRODUCED BY IT
--
-- The existing statement-level sum trigger refuses a legitimate multi-statement
-- reshuffle inside one transaction. Reducing one holder from 85% to 80% and
-- then inserting a new 5% holder fails on the FIRST statement with
-- "GL_OWNERSHIP: ... totals 95000", even though the transaction as a whole
-- would end at exactly 100000. Verified against the SHIPPED schema with no new
-- trigger installed, so it is not caused by this migration.
--
-- It is not fixed here, because fixing it means converting that trigger to
-- deferred too, which changes the failure timing of an existing safety check
-- and belongs in its own slice with its own proof (rule 4). Recorded so it is
-- a known property rather than a surprise: today, ownership changes must be
-- written as a single statement.
--
-- Idempotent: safe to run repeatedly (drop if exists / create).
-- =============================================================================

-- ─── WHY THE VALIDATION COMES FIRST, AND WHY THIS FILE IS ONE TRANSACTION ──
--
-- The first draft of this migration created the two triggers and THEN checked
-- that the current data satisfied them. The verify script caught what that
-- costs: when the check failed, psql had already committed the CREATE TRIGGER
-- statements, because every statement in a migration auto-commits on its own.
-- So a migration that reported failure had still HALF INSTALLED itself, leaving
-- a live guard behind while telling the reader it had refused.
--
-- That is worse than either outcome on its own. "It refused" and "it installed"
-- are both survivable; "it refused AND installed" means the operator's mental
-- model and the database disagree, and nothing in the output says so.
--
-- Two changes fix it, and both matter:
--   1. VALIDATE BEFORE CREATING. The precondition is checked while the database
--      is still untouched, so a refusal happens before anything exists to leave
--      behind.
--   2. WRAP THE FILE IN ONE TRANSACTION. begin/commit makes the whole migration
--      atomic, so a failure anywhere - including inside the trigger creation -
--      rolls the file back as a unit rather than stopping halfway.
--
-- Found by the verify script, not by review, and only because check 8 asked the
-- awkward question "what does the database look like AFTER it refuses?"
-- (standing rule 39a - the pre-state and the post-state are both evidence).

begin;

-- ---------------------------------------------------------------------------
-- STEP 1 - refuse before touching anything.
--
-- Prove the guard is satisfiable against the data actually present. A migration
-- that installs a guard the current data already violates has only moved the
-- discovery to the owner's live database.
-- ---------------------------------------------------------------------------
do $$
declare
  v_scorps    integer;
  v_empty     integer;
  v_greenway  integer;
begin
  select count(*) into v_scorps
  from public.gl_entities where active and tax_form = '1120S';

  select count(*) into v_empty
  from public.gl_entities e
  where e.active and e.tax_form = '1120S'
    and not exists (
      select 1 from public.gl_shareholders s
      where s.entity_id = e.id and s.active
    );

  select count(*) into v_greenway
  from public.gl_shareholders s
  join public.gl_entities e on e.id = s.entity_id
  where e.code = 'greenway' and s.active;

  if v_scorps = 0 then
    raise exception
      'GL_ROSTER_EMPTY: no active entity is taxed as an S corporation, so there is nothing for '
      'this guard to protect. Migration 0172 seeds the greenway entity with tax_form 1120S; this '
      'migration must run after it.'
      using errcode = 'check_violation';
  end if;

  if v_empty > 0 then
    raise exception
      'GL_ROSTER_EMPTY: % of % S-corporation entit(ies) already have an empty roster, so this '
      'guard cannot be installed against the current data. Load the roster first (0205 rebuilds '
      'Greenway''s from the filed Schedule K-1s), then re-run this migration. Nothing has been '
      'installed by this attempt.',
      v_empty, v_scorps
      using errcode = 'check_violation';
  end if;

  raise notice
    'GL_ROSTER_EMPTY precondition satisfied: % active S-corporation entit(ies), 0 empty; greenway holds % active shareholder(s).',
    v_scorps, v_greenway;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 2 - gl_assert_roster_not_empty - an S corporation must have shareholders.
--
-- Deliberately a SEPARATE function from gl_assert_ownership_sums(). They answer
-- different questions and they must be able to fail independently and say so in
-- different words: one is "the percentages are wrong", this one is "there is
-- nobody here". Merging them would produce a single message that has to hedge
-- about which of the two happened.
-- ---------------------------------------------------------------------------
create or replace function public.gl_assert_roster_not_empty()
returns trigger language plpgsql as $$
declare
  bad record;
begin
  for bad in
    select e.code, e.name
    from public.gl_entities e
    where e.active
      and e.tax_form = '1120S'
      and not exists (
        select 1
        from public.gl_shareholders s
        where s.entity_id = e.id
          and s.active
      )
  loop
    raise exception
      'GL_ROSTER_EMPTY: entity % (%) is taxed as an S corporation but has no active shareholders. '
      'An S corporation cannot have zero shareholders, and IRC 6699(b)(2) multiplies the '
      'late-filing penalty by the number of shareholders - so an empty roster is read as ZERO '
      'and prices a real penalty at $0.00.',
      bad.code, bad.name
      using errcode = 'check_violation';
  end loop;

  return null;
end $$;

comment on function public.gl_assert_roster_not_empty() is
  'Refuses to leave an 1120S entity with zero active shareholders. Deferred to '
  'COMMIT so a wholesale roster replacement (delete-then-insert, as migration '
  '0205 does) is still permitted. Does not police WHO the shareholders are.';

-- The deferred check. FOR EACH ROW is not a preference: PostgreSQL refuses to
-- create a constraint trigger that is FOR EACH STATEMENT.
drop trigger if exists trg_gl_shareholders_not_empty on public.gl_shareholders;
create constraint trigger trg_gl_shareholders_not_empty
  after insert or update or delete on public.gl_shareholders
  deferrable initially deferred
  for each row execute function public.gl_assert_roster_not_empty();

-- TRUNCATE fires neither of the above. Covered separately; see the header.
drop trigger if exists trg_gl_shareholders_not_empty_truncate on public.gl_shareholders;
create trigger trg_gl_shareholders_not_empty_truncate
  after truncate on public.gl_shareholders
  for each statement execute function public.gl_assert_roster_not_empty();

-- ---------------------------------------------------------------------------
-- STEP 3 - confirm on the way out what is now installed.
--
-- Reads pg_trigger rather than restating the intent of the statements above: a
-- migration should report what the database HAS, not what the file asked for.
-- ---------------------------------------------------------------------------
do $$
declare
  v_row      integer;
  v_trunc    integer;
  v_greenway integer;
begin
  select count(*) into v_row
  from pg_trigger
  where tgrelid = 'public.gl_shareholders'::regclass
    and tgname = 'trg_gl_shareholders_not_empty';

  select count(*) into v_trunc
  from pg_trigger
  where tgrelid = 'public.gl_shareholders'::regclass
    and tgname = 'trg_gl_shareholders_not_empty_truncate';

  select count(*) into v_greenway
  from public.gl_shareholders s
  join public.gl_entities e on e.id = s.entity_id
  where e.code = 'greenway' and s.active;

  if v_row <> 1 or v_trunc <> 1 then
    raise exception
      'GL_ROSTER_EMPTY: expected both guard triggers to exist after this migration, found '
      'row-level=% truncate=%.', v_row, v_trunc
      using errcode = 'check_violation';
  end if;

  raise notice
    'GL_ROSTER_EMPTY guard installed and verified: both triggers present; greenway holds % active shareholder(s).',
    v_greenway;
end $$;

commit;
