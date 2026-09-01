/**
 * tests/compliance/migration-execution-gate.test.ts   (books-26)
 *
 * READING SQL IS NOT RUNNING SQL.
 *
 * Every migration in this repo has text-reading "drift alarm" tests. 0195 alone
 * has 545 lines of them, and every one was green when Michael tried to apply the
 * file by hand and got:
 *
 *     Failed to run sql query: ERROR: 42P01: relation "a" does not exist
 *
 * The file was fine. Proven the only way that claim can honestly be made: all
 * 195 migrations were applied in order to a real PostgreSQL 15.18 server, where
 * 0195 applied cleanly, applied a SECOND time cleanly, and returned an empty
 * audit -- exactly the pass he was told to expect. The corruption happened
 * between the file and the database, not in the file.
 *
 * But nothing in this repo could have established that, because nothing in this
 * repo had ever EXECUTED a migration. 545 lines of tests could prove the file
 * still said the right words and could not prove Postgres would accept them.
 * That is the gap this gate closes.
 *
 * These tests cover the parts that are pure logic -- the ordering, and the
 * translator that turns Postgres's unhelpful `relation "a" does not exist` into
 * a sentence naming the actual cause. The EXECUTION half needs a live server and
 * is run by scripts/compliance/verify-migrations-execute.ts, whose results are
 * recorded in the commit message rather than asserted here, because a test that
 * silently passes when postgres is absent would be the same lie in a new place
 * (rule 48).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  explainRelationError,
  migrationFilesInOrder,
} from "../../scripts/compliance/verify-migrations-execute";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

// ===========================================================================
describe("the migration list is ordered the way the database will see it", () => {
  it("returns every .sql file, and nothing else", () => {
    const onDisk = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const listed = migrationFilesInOrder(MIGRATIONS_DIR);
    expect(listed.length).toBe(onDisk.length);
    // rule 39: guard a vacuous read. An empty list would make every
    // ordering assertion below trivially true.
    expect(listed.length).toBeGreaterThan(190);
  });

  it("is sorted numerically, because 0195 must not run before 0188", () => {
    const listed = migrationFilesInOrder(MIGRATIONS_DIR);
    const numbers = listed.map((f) => Number(f.slice(0, 4)));
    const sorted = [...numbers].sort((a, b) => a - b);
    expect(numbers).toEqual(sorted);
  });

  /**
   * RULE 49, EARNED HERE. The test above passes whether or not the function
   * calls .sort(). I proved that by deleting the .sort() and watching all ten
   * tests stay green: on this filesystem Node's readdirSync happens to hand
   * back names already in order, so the sorted and unsorted implementations
   * return the same value TODAY. That is not a guarantee -- readdir order is
   * filesystem- and platform-dependent, and the day it changes, migrations
   * would be applied out of order and 0195 would run before the 0188 tables it
   * points a foreign key at.
   *
   * When right and wrong return the same value today, constrain HOW the answer
   * is produced. So this reads the source and requires the sort to be there.
   */
  it("SORTS EXPLICITLY rather than trusting the filesystem's order", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../scripts/compliance/verify-migrations-execute.ts"),
      "utf8",
    );
    // rule 39: a read that came back empty would make the assertion vacuous.
    expect(src.length).toBeGreaterThan(2_000);
    expect(src).toMatch(/\.sort\(\)/);
  });

  it("the ordering claim is not vacuous: the list really is out of order on disk", () => {
    // Guards the guard. If migrationFilesInOrder ever returned [] or a
    // one-element list, "it is sorted" would be true and meaningless.
    const listed = migrationFilesInOrder(MIGRATIONS_DIR);
    expect(listed[0]).toMatch(/^0001_/);
    // books-34 made 0199 the last file. Asserted as the CURRENT highest rather
    // than a moving target, because the point of this test is that the list
    // really is sorted numerically and really does end where the directory
    // ends - a vacuous version of it would prove nothing about the ordering.
    //
    // This assertion is SUPPOSED to fail every time a migration is added. That
    // is not friction, it is the tripwire doing its job: it forces whoever adds
    // 0199 to look at this file and confirm the ordering guarantee still holds
    // rather than letting the highest-numbered migration drift unwatched.
    //
    // IT FIRED ON 0198 AND IT WAS HONOURED, not silenced. Re-verified against
    // the directory at that point: 198 files, every one zero-padded to four
    // digits, `ls | sort -c` clean, so the string sort this module relies on is
    // still identical to a numeric sort. Only then was the number advanced.
    //
    // IT FIRED AGAIN ON 0199 (books-34, the year-to-date accumulators) AND WAS
    // HONOURED THE SAME WAY. Re-verified before touching this line: 199 files,
    // `ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'` returns 0 so every name is still
    // zero-padded to four digits, and `ls [0-9]*.sql | sort -c` exits clean so
    // the on-disk order and the string sort still agree. Only then was 0198
    // changed to 0199.
    //
    // IT FIRED A THIRD TIME ON 0200 (books-35, the repair to the one-usage-per-
    // request index) AND WAS HONOURED, NOT SILENCED. Re-verified against the
    // directory before this line was touched: 200 files;
    // `ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'` returns 0, so every name is
    // still zero-padded to four digits; and `ls [0-9]*.sql | sort -c` exits
    // clean, so the on-disk order and the string sort this module relies on are
    // still the same order. Only then was 0199 advanced to 0200.
    //
    // IT FIRED A FOURTH TIME ON 0201 (books-38, the served_date column that the
    // twenty-day answer deadline and the sixty-day continuing lien are both
    // measured from) AND WAS HONOURED, NOT SILENCED. Re-verified against the
    // directory before this line was touched: 201 files;
    // `ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'` returns 0, so every name is
    // still zero-padded to four digits; and `ls [0-9]*.sql | sort -c` exits
    // clean, so the on-disk order and the string sort this module relies on
    // are still the same order.
    //
    // 0201 was additionally EXECUTED, not merely read: all 201 migrations were
    // applied in order to a real PostgreSQL 15.18 with exit 0, and each of the
    // four branches of its conditional NOT NULL block was driven and observed.
    // Only then was 0200 advanced to 0201.
    //
    // IT FIRED A FIFTH TIME ON 0202 (books-40c, the answer log -- the fact that
    // lets the twenty-day reminder STOP) AND WAS HONOURED, NOT SILENCED.
    // Re-verified against the directory before this line was touched:
    // 202 files; `ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'` returns 0, so every
    // name is still zero-padded to four digits; and `ls [0-9]*.sql | sort -c`
    // exits clean, so the on-disk order and the string sort this module relies
    // on are still the same order.
    //
    // 0202 was likewise EXECUTED, not merely read. All 202 migrations were
    // applied in order to a real PostgreSQL 15.18 (Debian 15.18-0+deb12u1)
    // with exit 0, and 0202 was then applied a SECOND time cleanly, because
    // Michael applies these by hand and a hand can slip.
    //
    // Executing it is still not enough: a CHECK constraint that exists but has
    // never refused anything is a constraint nobody has tested (rule 50 -- dead
    // code wearing a green check). So every constraint 0202 adds was DRIVEN and
    // its refusal OBSERVED, each inside its own savepoint so that one expected
    // failure could not poison the transaction and make the later probes pass
    // vacuously:
    //   - wage_orders_answer_after_served REFUSED answer_filed_at one day
    //     before served_date, and ACCEPTED it on the served date itself;
    //   - wage_orders_answer_xor_waiver REFUSED a row that was both answered
    //     and marked exempt;
    //   - wage_orders_waiver_has_reason REFUSED a waiver with a NULL reason and
    //     again with a 3-character reason, then ACCEPTED a real one;
    //   - the outstanding-answer worklist predicate returned 1 for an
    //     unanswered order and 0 for an exempt one -- checked BOTH ways, so the
    //     filter is not vacuous in either direction (rule 39);
    //   - `explain` confirmed wage_orders_answer_outstanding_idx is genuinely
    //     chosen by the planner for that predicate, rather than merely existing.
    // Only then was 0201 advanced to 0202.
    //
    // IT FIRED A SIXTH TIME ON 0203 (books-46, the four facts a W-2 needs that
    // this database could not state) AND WAS HONOURED, NOT SILENCED.
    // Re-verified against the directory before this line was touched:
    // 203 files; `ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'` returns 0, so every
    // name is still zero-padded to four digits; and `ls [0-9]*.sql | sort -c`
    // exits clean, so the on-disk order and the string sort this module relies
    // on are still the same order.
    //
    // 0203 was EXECUTED, not merely read. All 203 migrations were applied in
    // order to a real PostgreSQL 15.18 (Debian 15.18-0+deb12u1) with exit 0,
    // and 0203 was then applied a SECOND and THIRD time with zero errors,
    // because Michael applies these by hand and a hand can slip.
    //
    // EXECUTING IT IMMEDIATELY FOUND A DEFECT THAT READING IT HAD NOT. The
    // ordering guard's gl_shareholders branch contained the literal text
    // "2% shareholder-employee". RAISE treats % as a parameter placeholder, so
    // PL/pgSQL refused to COMPILE the block: "too few parameters specified for
    // RAISE". The whole precheck therefore failed before checking anything,
    // which means the ordering guard could never have fired. Fixed to %% and
    // then DRIVEN: with gl_shareholders dropped, the guard raises and the
    // message renders "2%" correctly.
    //
    // Every constraint 0203 adds was driven and its refusal OBSERVED, each
    // inside its own savepoint so one expected failure could not poison the
    // transaction and make later probes pass vacuously (rule 39):
    //   - the three legal-name CHECKs each REFUSED a whitespace-only value and
    //     ACCEPTED a real name ("Michael" / "Lyman");
    //   - employees_one_per_shareholder_idx REFUSED a second employee claiming
    //     the same gl_shareholders row, which would have put one person's
    //     shareholder-employee status on two W-2s;
    //   - the FK REFUSED a link to a non-existent owner, and ON DELETE RESTRICT
    //     REFUSED deleting an owner still referenced by an employee;
    //   - w2_void was observed defaulting to false rather than null;
    //   - premium_cents REFUSED -1; source_note REFUSED whitespace; tax_year
    //     REFUSED 1999; a valid row was ACCEPTED; a SECOND row for the same
    //     (employee, year) was REFUSED because it would double box 1; and the
    //     same employee in a DIFFERENT year was ACCEPTED.
    //
    // THE COLUMN-PRIVILEGE RERUN IN §6 WAS PROVED LOAD-BEARING RATHER THAN
    // DECORATIVE, which is the part most worth recording. 0195 revokes SELECT
    // on public.employees and grants it back column by column; column
    // privileges do not extend to columns added later. So 0203 was applied
    // twice to two freshly initialised clusters:
    //   - WITHOUT §6: `set role authenticated; select w2_last_name from
    //     public.employees` returns "permission denied for table employees",
    //     while ssn_last_four still reads fine. The new columns are
    //     unreachable to every ordinary screen.
    //   - WITH §6: the same select returns rows, and ssn_full is STILL denied.
    // That is the identical trap 0195 documents about ssn_last_four, and it was
    // checked BOTH ways rather than assumed.
    // Only then was 0202 advanced to 0203.
    //
    // IT FIRED A SEVENTH TIME ON 0204 (books-46, what was actually filed on the
    // four 941s) AND WAS HONOURED, NOT SILENCED.
    // Re-verified against the directory before this line was touched:
    // 204 files; `ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'` returns 0, so every
    // name is still zero-padded to four digits; and `ls [0-9]*.sql | sort -c`
    // exits clean, so the on-disk order and the string sort this module relies
    // on are still the same order.
    //
    // WHY 0204 EXISTS AT ALL IS THE PART WORTH RECORDING, because it was found
    // by wiring, not by planning. `reconcileW3To941s` in form-w2-core.ts takes a
    // `Form941YearTotals`. Grepping the whole repository for producers of that
    // type returned exactly two hits, BOTH inside form-w2-core.test.ts. Nothing
    // in src/ had ever built one. The reconciliation engine - the single most
    // important thing on the W-2 screen, because a W-2 is an information return
    // whose real question is "does it agree with the four 941s" - was fully
    // written, fully tested, mutation tested, and UNREACHABLE from the running
    // application. Standing rule 50: dead code wearing a green check. The tests
    // passed because the tests supplied the input the application could not.
    //
    // THE OBVIOUS FIX WAS REJECTED FOR A MEASURED REASON. Summing
    // payroll_run_lines for the year would have compiled and would have
    // destroyed the check: the W-2 side already descends from
    // payroll_ytd_accumulators, which is fed from payroll_run_lines, so both
    // sides would have shared one ancestor and agreed TRIVIALLY, ALWAYS -
    // including in the quarter where a 941 was filed with a transposed figure.
    // That is rule 39 on the highest-stakes screen in the payroll module. The
    // comparison is worth something only because the two sides are INDEPENDENT,
    // so 0204 stores what Michael actually filed, transcribed from the return in
    // his hand. `grep -rn "create table.*form_941\|create table.*filed_return"`
    // over supabase/migrations returned nothing: no table anywhere recorded what
    // had left the building, and loadForm941 recomputes the quarter from the pay
    // runs every time it is opened. It is a calculator, not a filing cabinet.
    //
    // 0204 was EXECUTED, not merely read, against a real PostgreSQL 15.18
    // (Debian 15.18-0+deb12u1) cluster carrying all 203 prior migrations, and
    // then applied a SECOND time with zero errors, because Michael applies these
    // by hand and a hand can slip.
    //
    // BOTH ordering guards were DRIVEN rather than trusted - the whole lesson of
    // 0203, whose guard looked correct and could never compile. With is_owner()
    // dropped inside a transaction the guard raised and its message rendered in
    // full; likewise with set_updated_at() dropped. Both probes were rolled
    // back and the objects re-verified present afterwards.
    //
    // Every constraint was driven, and a CONTROL was driven alongside each so
    // the refusals are known to DISCRIMINATE rather than merely to fire
    // (rule 55):
    //   - a legitimate Q1 2027 row was ACCEPTED;
    //   - the (tax_year, quarter) unique constraint REFUSED a second Q1, which
    //     would have let a four-quarter total silently double one quarter;
    //   - the quarter CHECK REFUSED 5, which would have made a "four-quarter"
    //     reconciliation span five quarters of wages;
    //   - the >= 0 CHECK REFUSED -1 on line 3;
    //   - source_note REFUSED a whitespace-only string, which would otherwise
    //     pass a NOT NULL test while being just as absent;
    //   - filed_on REFUSED null, so no row can claim to describe a filing
    //     without naming when the filing happened;
    //   - line_5d_addl_medicare_tax_cents was OBSERVED defaulting to 0 rather
    //     than null.
    //
    // THE TRIGGER AND THE RLS POLICY WERE PROVED LOAD-BEARING, not merely
    // present. On insert, updated_at equalled created_at; after an update it was
    // strictly GREATER, so set_updated_at is actually firing. And the owner-only
    // policy was checked BOTH ways: as superuser the table showed 1 row, and
    // after `set role authenticated` with SELECT granted it showed 0. A policy
    // that denies everyone and a policy that denies no one both look like a
    // pass if only one direction is measured.
    // Only then was 0203 advanced to 0204.
    //
    // IT FIRED AN EIGHTH TIME ON 0205 (books-50, the four-shareholder roster
    // correction) AND WAS HONOURED, NOT SILENCED.
    // Re-verified against the directory before this line was touched:
    // 205 files; `ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'` returns 0, so every
    // name is still zero-padded to four digits; and `ls [0-9]*.sql | sort -c`
    // exits clean, so the on-disk order and the string sort this module relies
    // on are still the same order.
    //
    // WHY 0205 EXISTS: 0172 seeded the greenway roster as three people -
    // 85/10/5, with one row literally named 'Mother' - and the owner states the [SUPERSEDED-ROSTER]
    // filed Schedule K-1s show FOUR: himself and his wife at 85%, his
    // grandfather at 5%, and his mother and step-father at 5% each. The count is
    // not cosmetic. IRC §6699 charges $195 per shareholder per month, so a
    // wrong count of 3 understates a full-year late-filing exposure as $7,020 [SUPERSEDED-ROSTER]
    // when it is $9,360.
    //
    // 0205 WAS EXECUTED, not merely read, by
    // scripts/accounting/verify-shareholder-roster-fix.sh against a real
    // PostgreSQL 15 cluster, and that script exits 0 with ALL CHECKS PASSED.
    // What it proves, in the order it proves it:
    //   - THE PRE-STATE IS THE BUG (rule 39d). It applies 0172 first and asserts
    //     the roster really is the wrong three rows, one of them named 'Mother',
    //     BEFORE correcting anything. Without this the whole run would be
    //     vacuous, because inserting a correct roster into an empty table would
    //     pass just as well.
    //   - THE PRE-STATE TOTALS EXACTLY 100000 milli-percent. This is the finding
    //     worth keeping: gl_assert_ownership_sums() only checks that ownership
    //     SUMS to 100%, so the wrong roster balanced perfectly and the existing
    //     trigger could never have caught it. A correct total is not a correct
    //     roster.
    //   - It applies 0205 a first, SECOND and THIRD time with zero errors,
    //     because Michael applies these by hand and a hand can slip - and
    //     because twice can hide a bug that alternates.
    //   - IT WAS ATTACKED (rule 39b). The 85/10/5 roster was re-introduced and [SUPERSEDED-ROSTER]
    //     0205 re-corrected it; then EVERY shareholder was deleted and 0205
    //     rebuilt all four from empty.
    //   - A SECOND BLIND SPOT IN THE SAME TRIGGER was found while building that
    //     attack, and is recorded rather than assumed: deleting every
    //     shareholder of an entity raises NOTHING, because `group by e.code
    //     having sum(...) <> 100000` over zero rows yields zero groups for
    //     HAVING to reject. Widening the trigger is a schema change and a
    //     separate slice (rule 4).
    //   - 0205's OWN GUARD WAS SEEN TO FIRE (rule 15). Removing the greenway
    //     entity cannot be done by renaming it - gl_entities.code carries
    //     `check (code in ('greenway','atm','landholding','personal'))`, so a
    //     rename is structurally impossible, not merely awkward - so the row was
    //     really deleted, after its dependents were enumerated from
    //     pg_constraint rather than guessed (12 gl_periods, 1
    //     gl_journal_sequences, all ON DELETE RESTRICT; the RESTRICT was itself
    //     driven and observed). 0205 then refused with a non-zero exit and its
    //     GL_ROSTER_FIX message, and WROTE NOTHING while refusing.
    //
    // THE VERIFY SCRIPT ITSELF HAD A DEFECT WORTH RECORDING, because it is the
    // same class of bug this whole module exists to catch. It called initdb
    // directly; initdb refuses to run as root; so run the documented way it died
    // on its first command - and it died inside a `... | tail` pipeline, where
    // the exit status belongs to tail and a total failure can read as a pass. It
    // now drops to the postgres account for the server-side commands, exactly as
    // the other eleven verify scripts in that directory already did, and it POLLS
    // for a server that answers a real query instead of sleeping a fixed two
    // seconds and hoping. Only then was 0204 advanced to 0205.
    //
    // ─── IT FIRED A NINTH TIME, ON 0206 (books-51) ───────────────────────────
    //
    // 0206_ownership_requires_a_roster.sql closes the SECOND blind spot recorded
    // seven paragraphs above - the one this very comment said was "a schema
    // change and a separate slice". This is that slice, so the note above is now
    // discharged rather than outstanding.
    //
    // WHAT 0206 DOES: an S-corporation entity may not be left with zero active
    // shareholders. The existing sum trigger cannot catch that, because GROUP BY
    // over zero rows yields zero groups and HAVING cannot reject a group that
    // does not exist. It matters because emptiness is not read downstream as
    // "unknown", it is read as ZERO, and IRC §6699(b)(2) MULTIPLIES by the
    // shareholder count - so an empty roster prices a real twelve-month penalty
    // at $0.00. That is the identical silent-zero failure books-21 was created
    // to remove.
    //
    // 0206 WAS EXECUTED, not merely read, by
    // scripts/accounting/verify-empty-roster-guard.sh against a real PostgreSQL
    // 15 cluster: 44 checks, 0 failures, exit 0, ALL CHECKS PASSED. What it
    // proves, in the order it proves it:
    //   - THE PRE-STATE IS THE BUG (rule 39d). BEFORE 0206, `delete from
    //     gl_shareholders` returns rc=0 and leaves count(*) = 0. Without this
    //     the guard might be defending a gap that was never open.
    //   - AFTER 0206 the same delete is refused with rc=3 and GL_ROSTER_EMPTY,
    //     and the four rows are STILL THERE, so the transaction really rolled
    //     back rather than the message merely being printed.
    //   - THE SOFT DOORWAY IS SHUT TOO: `update ... set active = false` on every
    //     row is refused. A guard that only watches DELETE has a side entrance.
    //   - TRUNCATE, honestly attributed (rule 106). Plain TRUNCATE is refused by
    //     a PRE-EXISTING foreign key from gl_journal_lines, NOT by 0206 - so the
    //     script says so instead of taking the credit, and then drives
    //     TRUNCATE ... CASCADE, which IS refused by 0206's own truncate trigger.
    //   - IT DOES NOT BREAK 0205 (the whole design question). 0205 replaces the
    //     roster by DELETE-then-INSERT, so it is legitimately empty for a moment
    //     inside one transaction. A naive statement-level emptiness check BREAKS
    //     it - measured, it failed - which is why the shipped guard is a
    //     DEFERRABLE INITIALLY DEFERRED constraint trigger that fires at commit.
    //     PostgreSQL also refuses to make a constraint trigger FOR EACH
    //     STATEMENT, so FOR EACH ROW is forced, not chosen (rule 107).
    //   - APPLIED THREE TIMES, still exactly one guard trigger, roster untouched.
    //   - THE THREE NON-S-CORP ENTITIES ARE UNAFFECTED. atm, landholding and
    //     personal hold zero shareholders CORRECTLY - a Schedule C business has
    //     an owner, not a roster - so the guard keys on tax_form = '1120S'. A
    //     false alarm teaches the owner to ignore the alarm.
    //   - IT REFUSES TO INSTALL over data it would immediately contradict, and
    //     an inactive-only roster does NOT satisfy it (emptiness in disguise).
    //
    // 0206 HAD A REAL BUG, AND THE VERIFY SCRIPT FOUND IT, NOT REVIEW. The first
    // draft created the triggers and validated afterwards. Every statement in a
    // migration auto-commits, so a FAILED validation still left both triggers
    // installed: the migration said "no" and had done it anyway. These
    // migrations are applied BY HAND by the owner, so the only reader of that
    // contradiction is the person least able to spot it. 0206 now validates
    // first and wraps the file in one begin/commit, and the script asserts the
    // post-state of the failure path - zero guard triggers after a refused
    // install. That is standing rule 105, and rule 39a's point that a pre-state
    // is evidence, extended to the path you hope never runs.
    // ─── IT FIRED A TENTH TIME, ON 0207 (books-64) ────────────────────────
    //
    // 0207_employee_esd_upload_fields.sql adds the three columns an ESD upload
    // needs and this database could not state: date_of_birth, wa_cares_exempt
    // and soc_code. It exists because the store was written first and its
    // column list was then CHECKED against the migrations rather than assumed:
    // `grep -rln` over supabase/migrations for all three names returned nothing.
    //
    // WHY IT HAD TO BE EXECUTED AND NOT MERELY READ: 0207 carries a CHECK with
    // a regular expression, and PostgreSQL's `~` is POSIX, not JavaScript. `~`
    // is UNANCHORED by default, so a pattern missing its ^ and $ would MATCH
    // the first six digits of a seven-digit string and accept it - sending ESD
    // a truncated occupation code that looks plausible. That is unreadable from
    // the page; it is only knowable by running it.
    //
    // 0207 WAS EXECUTED by scripts/payroll/verify-esd-upload-fields.sh against
    // a real PostgreSQL 15 cluster: 21 checks, 0 failures, ALL CHECKS PASSED.
    //   - THE PRE-STATE IS THE GAP (rule 39d). Before 0207 the store's own
    //     nine-column select fails with 42703, naming date_of_birth.
    //   - AFTER 0207 that select succeeds - and the script reads the column list
    //     OUT OF EMPLOYEE_COLUMNS in esd-upload-store.ts rather than restating
    //     it, so the migration and the store cannot drift apart silently.
    //   - THE ANCHORS HOLD: '4120310' is REFUSED. This is the check the
    //     unanchored-regex mistake fails, and the reason the script exists.
    //     '41-2031' (as printed on Greenway's filed 5208B) and bare '412031'
    //     are both accepted, so the refusals discriminate (rule 55).
    //   - BLANK HAS EXACTLY ONE REPRESENTATION: NULL is accepted and '' is
    //     refused, so `(e.soc_code ?? "").trim()` in the store cannot be
    //     reading two different spellings of "no SOC code".
    //   - date_of_birth accepts NULL, which is what lets buildEsdUpload refuse
    //     BY NAME instead of inventing a birth date WA Cares eligibility turns
    //     on; and it refuses '13/45/1999' because it is a real date type.
    //   - wa_cares_exempt reads back FALSE on a row that never mentions it and
    //     REFUSES an explicit NULL, so "unknown" cannot masquerade as "no".
    //   - IDEMPOTENT over three applications: 3 columns, and exactly ONE CHECK.
    //
    // The script found a bug in ITSELF before it found anything about 0207: the
    // first draft built its labels by interpolating the value into a second
    // quoted string, nesting apostrophes, and eight inserts died of syntax
    // errors. Six of those were in the REFUSE set, where a syntax error is a
    // non-zero exit status and would have been banked as "the CHECK refused it"
    // by a laxer assertion. It reported FAIL instead, because the refuse branch
    // requires the words "violates check constraint" and classifies "syntax
    // error" as a harness bug - standing rule 48: a check that cannot classify
    // must FAIL, not skip, and not accept the right answer for the wrong reason.
    // ─── IT FIRED AN ELEVENTH TIME, ON 0208 (books-68) ──────────────────────
    //
    // 0208_employee_home_address.sql adds home_street, home_city, home_state
    // and home_zip. It exists for the same reason 0207 did, and was found the
    // same way: the DSHS 18-463 new-hire report prints an employee's address,
    // RCW 26.23.040(3)(a) requires "The employee's name, address, social
    // security number, and date of birth", and a grep of every migration for
    // address|street|city|zip|postal returned hits only on vendors, billing,
    // shipping and locations. `public.employees` had no address column at all,
    // so the report could not have been produced complete. Checked, not assumed.
    //
    // Nullable with no defaults, following 0207 exactly, so that "not captured"
    // stays distinguishable from a value and the builder can refuse BY NAME
    // rather than printing a blank line onto a legal report. Deliberately NOT
    // defaulted to 'WA': an employee's home state is a fact about a person, not
    // about the employer, and a default would state it on everyone's behalf.
    //
    // ─── IT FIRED A TWELFTH TIME, ON 0209 (books-80) ──────────────────────
    //
    // 0209_factory_reset.sql adds gl_factory_reset_preview(),
    // gl_factory_reset(confirm_phrase, acknowledge_wac_314_55_087) and
    // gl_audit_factory_reset() — the clean-slate button for the November 1st
    // go-live (D-62). This assertion fired exactly as designed the moment the
    // file landed, which is the whole point of it: it is the one place in the
    // suite that CANNOT be satisfied by a passing build alone, so a new
    // migration is forced to announce itself to a human rather than slipping in
    // behind a green check. An anchor that auto-followed the highest file on
    // disk would assert nothing at all (rule 13c: a test that cannot fail is
    // worse than no test).
    //
    // HONOURED THE SAME WAY AS 0198, 0199, 0207 AND 0208, re-verified by running
    // the commands before this line was touched, not by trusting the previous
    // slice's note: `ls [0-9]*.sql | wc -l` returns 209; `ls [0-9]*.sql |
    // grep -cvE '^[0-9]{4}_'` returns 0, so every name is still zero-padded to
    // four digits; `ls [0-9]*.sql | sort -c` exits clean, so the on-disk order
    // and the string sort still agree. Only then was 0208 changed to 0209.
    //
    // ─── IT FIRED A THIRTEENTH TIME, ON 0210 (books-87) ────────────────────
    //
    // 0210_separate_logins_from_employees.sql exists because migration 0037
    // contained a one-time seed that copied every active back-office login into
    // `public.employees`. That is measured, not inferred: 0037 lines 125-132
    // read `insert into public.employees (full_name, staff_id, job_role) select
    // ... from public.staff_profiles sp where sp.active = true`. Nothing else in
    // the app couples the two - `createEmployeeAction` never sets staff_id,
    // `inviteUser` writes staff_profiles only, and a grep for triggers on either
    // table returns none. The seed was the whole of it (D-69).
    //
    // 0210 records the retired policy in a one-row table so a fresh database
    // cannot repeat it, quarantines the seeded rows, and states the payroll
    // roster once as the view `employees_on_payroll`.
    //
    // HONOURED THE SAME WAY AS 0198, 0199, 0207, 0208 AND 0209, re-verified by
    // running the commands before this line was touched rather than trusting the
    // previous slice's note: `ls [0-9]*.sql | wc -l` returns 210; `ls [0-9]*.sql
    // | grep -cvE '^[0-9]{4}_'` returns 0, so every name is still zero-padded to
    // four digits; `ls [0-9]*.sql | sort -c` exits clean, so the on-disk order
    // and the string sort still agree. Only then was 0209 changed to 0210.
    //
    // ─── IT FIRED A FOURTEENTH TIME, ON 0211 (books-89) ──────────────────
    //
    // 0211_owner_operator_self_approval.sql exists because Michael asked for it
    // in these words: "I will need you to turn off the over 5k approval feature.
    // I am the one and only owner operator that will have access to the books."
    // Migration 0174 gave one switch to two different things — a WARNING at
    // threshold_cents, which he likes, and a BLOCK on self-approval at the same
    // figure, which he cannot satisfy because segregation of duties needs a
    // second person and there is exactly one. 0211 sets allow_self_approval and
    // leaves threshold_cents alone, so the flag survives the block being lifted.
    //
    // RE-VERIFIED, not inherited: `ls [0-9]*.sql | wc -l` returns 211;
    // `ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'` returns 0; `ls [0-9]*.sql |
    // sort -c` exits clean. Only then was 0210 changed to 0211.
    //
    // ─── IT FIRED A FIFTEENTH TIME, ON 0212 (books-98) ──────────────────────
    //
    // 0212_deposit_bags.sql exists because Michael described his real cash
    // workflow in these words: "The end of the day, the safe money goes into
    // the deposit bag with an id." Before it, a bank credit was matched to the
    // cash it came from by FIFO on DATE alone, which is a convention rather
    // than evidence: two bags sealed on one day, or a bag held over a weekend,
    // cannot be told apart by their date. The bag number can tell them apart,
    // because it is written on the bag AND on the bank's deposit slip.
    //
    // 0213_plaid_account_owner_and_books.sql exists because nothing on a Plaid
    // account said whose it was (D-80), so the entity of a posted expense came
    // from the merchant rule alone and a personal charge landed in a 280E
    // business. Michael: "I want to make sure we are very deliberate and clear
    // about what accounts are for business and which ones are my wife and my
    // personal accounts."
    //
    // ─── IT FIRED A SIXTEENTH TIME, ON 0214 (SLICE 2) ─────────────────────
    //
    // 0214_inventory_lot_received_date.sql exists because Michael said, of the
    // lots the Cultivera export left undated: "For lots that don't have a
    // receive date, I want them flagged for me to add one... this is a
    // compliance issue and we can't be breaking the rules."
    //
    // Before it, `inventory_lots` had no received-date column at all, so CCRS
    // Inventory.CreatedDate was sourced from `created_at` — the instant of the
    // import. For the lots whose POS export had a blank received date, that
    // would have told the LCB the lot was created on migration day. 0214 adds
    // `received_on` (plus provenance, actor and timestamp) as a SEPARATE,
    // nullable column: NULL means "not known", it is never backfilled from
    // `created_at`, and it is surfaced to the owner as a worklist instead —
    // the same discipline migration 0191 set for `last_counted_at`.
    //
    // RE-VERIFIED, not inherited: `ls [0-9]*.sql | wc -l` returns 214;
    // `ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'` returns 0; `ls [0-9]*.sql |
    // sort -c` exits clean. Only then was 0213 changed to 0214.
    expect(listed[listed.length - 1]).toMatch(/^0214_/);
  });

  it("every filename is zero-padded, which is WHY a string sort is safe", () => {
    // If a file were ever named `195_x.sql` instead of `0195_x.sql`, a string
    // sort would put it before `0001`, and the whole ordering guarantee above
    // would be quietly wrong while still looking sorted.
    for (const f of migrationFilesInOrder(MIGRATIONS_DIR)) {
      expect(f).toMatch(/^\d{4}_/);
    }
  });
});

// ===========================================================================
describe("the error translator names the real cause, not the literal one", () => {
  it("recognises Michael's exact error", () => {
    const hint = explainRelationError('ERROR:  relation "a" does not exist');
    expect(hint).not.toBeNull();
    expect(hint).toContain("English word");
    expect(hint).toContain("Re-send the WHOLE file");
  });

  it("tells the reader the FILE is probably fine, because it was", () => {
    // This is the sentence that would have saved the afternoon. Postgres says
    // "relation a does not exist", which sends you hunting for a missing table.
    // The actual cause is prose reaching the parser.
    const hint = explainRelationError('relation "a" does not exist');
    expect(hint).toContain("migration file itself is probably fine");
    expect(hint?.toLowerCase()).toContain("transport");
  });

  it("fires for the other English words a lost comment marker can strand", () => {
    // 0195 has eight comment lines ending in a bare "a", plus others ending in
    // "the", "not", "is". Any of them can land in a table slot.
    for (const w of ["a", "an", "the", "it", "is", "this", "that", "not", "of", "to"]) {
      expect(explainRelationError(`relation "${w}" does not exist`), w).not.toBeNull();
    }
  });

  it("is case-insensitive about the word, since Postgres echoes what it got", () => {
    expect(explainRelationError('relation "A" does not exist')).not.toBeNull();
    expect(explainRelationError('RELATION "The" DOES NOT EXIST')).not.toBeNull();
  });

  // ---- the negative controls (rule 15a). A translator that fires on
  // everything is a translator that says nothing. -------------------------
  it("stays SILENT for a genuinely missing table, which is a real bug", () => {
    // This is the case where Postgres's own message is the right one and an
    // "it's probably your clipboard" hint would actively mislead.
    expect(explainRelationError('relation "employee_pay" does not exist')).toBeNull();
    expect(explainRelationError('relation "public.employees" does not exist')).toBeNull();
    expect(explainRelationError('relation "gl_payroll_labor_roles" does not exist')).toBeNull();
  });

  it("stays silent for errors that are not about relations at all", () => {
    expect(explainRelationError('syntax error at or near "the"')).toBeNull();
    expect(explainRelationError("permission denied for table employees")).toBeNull();
    expect(explainRelationError("")).toBeNull();
  });

  it("does not fire on a table whose name merely CONTAINS an English word", () => {
    // "a_ledger" contains "a"; "the_books" contains "the". Substring matching
    // here would produce a confident, wrong explanation.
    expect(explainRelationError('relation "a_ledger" does not exist')).toBeNull();
    expect(explainRelationError('relation "the_books" does not exist')).toBeNull();
    expect(explainRelationError('relation "data" does not exist')).toBeNull();
  });
});
