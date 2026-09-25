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
    // ─── IT FIRED A SEVENTEENTH TIME, ON 0215 (SLICE 8) ───────────────────
    //
    // 0215_inventory_lot_bulk_fill_provenance.sql exists because Michael said,
    // of the fields the Cultivera export never carried: "Cultivera's data is
    // garbage, and we will need a way to add those fields if they don't exist
    // in the Cultivera data... allow me to enter that data the one time and
    // then it respects the locked fields rules that protect my license from
    // compliance issues."
    //
    // It does NOT unlock anything. `lot-edit-core.ts:33-45` still locks
    // expires_on, unit_cost_minor_units and pos_product_key against
    // hand-editing, because those values come from COAs, invoices and
    // manifests. What 0215 adds is the PROVENANCE trio per field
    // (`*_source` / `*_set_by` / `*_set_at`, the exact shape 0214 established),
    // so that a value the import never delivered can be supplied once, from the
    // paperwork, and thereafter carry evidence of who supplied it and when.
    //
    // The authority for treating those blanks as fillable is the importer's own
    // note (src/lib/pos/import-lot-core.ts:291-302), which stamped every
    // migrated lot with "Expiration date not provided by POS export — set
    // during enrichment." The import recorded the gap and deferred it; this is
    // that deferred step. Same doctrine as 0214: a value the export failed to
    // carry is a fact from the paperwork, not a derived number.
    //
    // ─── IT FIRED AN EIGHTEENTH TIME, ON 0216 (SLICE 16) ─────────────────
    //
    // 0216_low_thc_liquid_limit.sql exists because Washington gives low-THC
    // beverages their own transaction limit, and the system had no way to
    // express it. WAC 314-55-095(1)(d)(i)(E) caps liquid infused product at 72
    // ounces "unless the product is packaged in individual units containing no
    // more than four milligrams of active delta-9 THC per unit", in which case
    // (F) applies instead: "Two hundred mg of active delta-9 THC".
    //
    // The migration adds the two owner-tunable maxima beside the four that
    // already existed, and the per-product classification the engine routes on.
    // It does NOT derive that classification from the 0138 serving facts,
    // because it cannot: the owner's own rule is that "one can is one unit, and
    // a 4 pack of cans is 4 units", while "a single product that has 16 mg in
    // total, even if it says the dose is 4, 4 mg servings does not qualify."
    // Identical serving arithmetic, opposite legal answers — so the trigger is
    // an explicit fact captured at intake from the label and invoice, and an
    // unclassified liquid stays in the stricter 72 oz bucket.
    //
    // RE-VERIFIED, not inherited. Re-ran from scratch rather than trusting the
    // previous line: `ls [0-9]*.sql | wc -l` returns 216; `ls [0-9]*.sql |
    // grep -cvE '^[0-9]{4}_'` returns 0; `ls [0-9]*.sql | sort -c` exits clean.
    // Added to the ritual this time: `ls [0-9]*.sql | cut -c1-4 | sort |
    // uniq -d | wc -l` returns 0, proving no two migrations claim the same
    // number — the failure a parallel branch actually produces, which none of
    // the three older checks would have caught.
    //
    // SLICE 17 re-ran the ENTIRE ritual above from scratch rather than
    // inheriting the previous line's numbers, exactly as that paragraph
    // demands. Fresh results: `ls [0-9]*.sql | wc -l` returns 217 (was 216,
    // +1 for 0217_otherwise_taken_limit.sql); the malformed-name count is 0;
    // `sort -c` exits clean; and the duplicate-number check returns 0.
    //
    // 0217 adds the ten-unit "otherwise taken into the body" limit
    // (WAC 314-55-095(1)(d)(i)(D)) and ALSO repairs a defect from 0216: that
    // migration added low_thc_liquid/unit_thc_mg to menu_items and
    // inventory_lots but never to order_lines, even though orders-store.ts
    // writes them there and order-pricing.ts reads them back at the pickup
    // gate. The missing-column ladder swallowed the error, so the snapshot was
    // silently dropped on every order.
    //
    // ─── IT FIRED A TWENTIETH TIME, ON 0218 (SLICE 18-0) ────────────────
    //
    // SLICE 18-0 re-ran the ENTIRE ritual from scratch rather than inheriting
    // the line above, exactly as that paragraph demands. Fresh results, from
    // supabase/migrations: `ls [0-9]*.sql | wc -l` returns 219 (was 218, +1 for
    // 0219_classification_provenance_doctrine.sql); `ls [0-9]*.sql | grep -cvE
    // '^[0-9]{4}_'` returns 0; `ls [0-9]*.sql | sort -c` exits clean; and
    // `ls [0-9]*.sql | cut -c1-4 | sort | uniq -d | wc -l` returns 0.
    //
    // The same NEW fact re-confirmed in 18E, worth keeping because it briefly
    // looked like a discrepancy: `ls supabase/migrations | wc -l` returns 220,
    // one more than the migration count. The extra entry is a pre-existing
    // `editor-safe` DIRECTORY, not a migration.
    // That is why every command in this ritual globs `[0-9]*.sql` rather than
    // listing the directory — a raw count would drift the moment anyone adds a
    // subfolder, and a drifting number in a compliance ritual is worse than no
    // number, because it gets explained away instead of investigated.
    //
    // 0219 exists because the lot-side copies of the four classification
    // columns were commented 'See menu_items.low_thc_liquid', which reads as
    // "these two columns mean the same thing". They do not: menu_items is what
    // the register enforces from, and inventory_lots is provenance that nothing
    // reads to decide a limit. A reader who trusted that comment could write
    // the lot column, see it succeed, and change nothing at the point of sale.
    // 0219 rewrites those four comments (and states the enforcement role on the
    // menu side) so the doctrine travels WITH the database. It changes no data
    // and no structure - it is comments only, asserted in
    // tests/compliance/classification-provenance.test.ts.
    //
    // 0218 exists because SLICES 16 and 17 were both unreachable for anything
    // received after the Cultivera cutover. Their rules were correct and their
    // unit tests were green, but the only place a human could set
    // low_thc_liquid or otherwise_taken was the menu-import facts screen — a
    // screen received goods never pass through. Every product arriving on a
    // manifest therefore entered the system unclassified forever. 0218 adds the
    // five choice/provenance columns to catalog_product_drafts so the receiving
    // door can ask the question at Product Onboarding, and so the answer
    // records WHO decided: a person, or a machine default.
    // SLICE 23 re-ran the ritual rather than bumping the number. Fresh results,
    // from supabase/migrations: `ls [0-9]*.sql | wc -l` returns 221 (was 220,
    // +1 for 0221_order_name_rotation.sql); `ls [0-9]*.sql |
    // grep -cvE '^[0-9]{4}_'` returns 0; `ls [0-9]*.sql | sort -c` exits clean;
    // and `ls [0-9]*.sql | cut -c1-4 | sort | uniq -d | wc -l` returns 0. The
    // raw directory listing is 222, one more than the migration count, and the
    // extra entry is still the pre-existing `editor-safe` DIRECTORY - which is
    // exactly why every command here globs `[0-9]*.sql`.
    //
    // 0221 exists because the fun receipt name had no way to ROTATE. 0147 gave
    // the store a pool and a nullable, non-unique orders.display_name, but the
    // picker read the least-recently-used row and then wrote it back - a
    // read-then-write that two concurrent sales can interleave, handing the
    // same name to both. It also stamped a wall-clock time, which cannot answer
    // the question the owner actually asked: "no two of the same overlays ...
    // within a certain number of uses between each other". Uses are countable;
    // clock time is not. 0221 adds a monotonic last_assigned_seq plus a global
    // order_name_assignment_seq, and moves the pick into assign_order_name(),
    // an atomic function serialised by a transaction-scoped
    // pg_advisory_xact_lock that returns the chosen name AND its gap.
    //
    // PROVEN to execute by applying all 221 migrations IN ORDER to a real
    // PostgreSQL 15 (initdb + pg_ctl in this sandbox, after stubbing only the
    // Supabase-managed prerequisites vanilla Postgres lacks: the auth and
    // storage schemas, auth.uid()/auth.role(), and the authenticated/anon/
    // service_role roles). 221 files applied, ZERO failures; 0221 re-applied a
    // second time for idempotency and produced only "already exists, skipping"
    // notices. Behaviour was then exercised against that live database rather
    // than assumed: 12 draws from a 5-name pool returned a perfect round robin
    // (Alpha Bravo Charlie Delta Echo Alpha ...), i.e. the maximum spacing the
    // arithmetic permits; the reported gap was 5 on a 5-name pool; 4 CONCURRENT
    // psql clients drawing 25 names each (100 draws) landed exactly 20/20/20/
    // 20/20 across the five names, which is what the advisory lock is for; a
    // fully disabled pool returned ZERO rows, which the store reads as "no
    // name" and the receipt prints the real number - the owner's stated offline
    // fallback; and a pool narrowed to ONE enabled name kept returning that
    // name rather than wedging.
    //
    // 0220 exists because 0218 documented a THREE-value vocabulary on
    // catalog_product_drafts.chosen_classification_provenance, and SLICE 18F
    // added a fourth: 'remembered', for an operator confirming a value
    // pre-filled from their own earlier decision about the same product. The
    // column is jsonb with no check constraint, so the new value was accepted
    // immediately and nothing broke - which is precisely the danger. The
    // comment silently became a list a reader would trust as exhaustive, and
    // 'remembered' would look like corruption to anyone auditing the table
    // against it. Nothing executable depended on the stale comment, and that is
    // why it needed fixing on purpose rather than "next time we touch this
    // file": a wrong comment fails silently and only ever misleads a human.
    // 0220 changes no data and no structure - one column comment, asserted in
    // tests/compliance/classification-memory.test.ts, and PROVEN to execute by
    // applying all 220 migrations in order to a real PostgreSQL 15 and
    // re-applying 0220 a second time for idempotency.
    //
    // 0222 (SLICE 27) adds the online order announcer: five tables, a private
    // storage bucket for uploaded audio, staff-read RLS on all five, and two
    // functions -- announcer_claim_work, which hands a Raspberry Pi its jobs
    // using FOR UPDATE SKIP LOCKED under a short lease, and
    // announcer_expire_stale. It also edits 0209 in place to empty the two
    // announcer tables that record events, the same way 0212's deposit_bags
    // is emptied by 0209 despite being created three migrations later.
    // PROVEN to execute by applying all 222 migrations in order to a real
    // PostgreSQL, then re-applying 0222 a second time for idempotency, then
    // exercising announcer_claim_work against the live database rather than
    // assuming it: two concurrent claimers over one device's queue split the
    // rows with zero overlap, a live lease was not re-handed out, a lapsed
    // lease WAS re-handed out, and a row past its TTL was never handed out at
    // all.
    //
    // 0223 (SLICE L4) adds ONE nullable column, order_lines.unit_volume_ml
    // (numeric(12,3)), plus its comment. No data, no structure, no backfill.
    //
    // It exists because an order is judged TWICE and the two evaluations were
    // about to disagree. Placement re-prices against the live menu; the pickup
    // completion gate does not re-price, it re-reads order_lines. That is why
    // the weight (0122), the category (0096) and both classifications (0217)
    // are already snapshotted there. Volume was not, and a 1.5 L bottle has no
    // parseable weight at all -- so it would meter as 1500 ml online and on a
    // 28 g category default at the counter.
    //
    // PROVEN to execute by applying all 223 migrations in order to a real
    // PostgreSQL 15, then re-applying 0223 a second time for idempotency
    // (223 applied / 0 failed; the re-apply emits the expected
    // "column already exists, skipping" notice and succeeds), then INSPECTING
    // the result rather than assuming the DDL did what it reads like:
    // information_schema reports numeric(12,3) nullable, and a live insert
    // round-trips 1500.000, 750.000 and 354.882 -- the last one confirming the
    // scale actually holds a fluid-ounce conversion without rounding it away
    // -- while a null stays null rather than being coerced to 0, which is the
    // distinction the whole fallback depends on.
    // Harness: scripts/compliance/prove-0223-executes.sh
    //
    // 0224 (SLICE L5) adds ONE nullable column,
    // catalog_product_drafts.chosen_net_volume_ml (numeric(12,3)), plus its
    // comment. No data, no structure, no backfill.
    //
    // It exists because L5 makes receiving REFUSE to onboard a liquid whose
    // package volume nothing can establish, and the receiver answers that
    // refusal on a DRAFT -- which had nowhere to put the answer. Verified by
    // grepping every migration before writing it: inventory_lots and
    // menu_items carry net_volume_ml (0138), catalog_product_drafts did not.
    // Nullable with no backfill is deliberate: a draft already in flight must
    // not be retro-blocked by a column that appeared underneath it.
    //
    // PROVEN to execute by applying all 224 migrations in order to a real
    // PostgreSQL 15, then re-applying 0224 a second time for idempotency
    // (224 applied / 0 failed; the re-apply emits the expected
    // "column already exists, skipping" notice and succeeds), then INSPECTING
    // the result rather than assuming the DDL did what it reads like:
    // information_schema reports numeric(12,3), is_nullable YES, and NO column
    // default; a live insert round-trips 1500.000, 750.000 and 354.882 -- the
    // last one being 12 fl oz converted, confirming the scale holds a
    // fluid-ounce conversion instead of rounding a statutory limit away --
    // while an unmeasured row stays NULL rather than being coerced to 0
    // (1 unmeasured, 0 zero-rows over 4 rows). A draft inserted the pre-0224
    // way, naming no volume at all, also lands NULL, which is the proof that
    // nothing was backfilled. A 0 here would read downstream as "measured,
    // holds nothing" and would silently switch the 72 fl oz cap off, so that
    // distinction is the one the whole slice rests on.
    // Harness: scripts/compliance/prove-0224-executes.sh
    //
    // 0225 (SLICE L5) adds the RECEIVING side of the Leafly Order API: two
    // credential columns on integration_credentials (leafly_hmac_key,
    // leafly_order_integration_key), public.leafly_webhook_events -- the
    // append-only delivery log -- and public.leafly_orders, our own copy of
    // each Leafly order. It also edits 0209 in place to empty both new tables,
    // the same way 0222 edited it for the announcer tables and 0212 for
    // deposit_bags: 0209 is `create or replace` and that is the established
    // pattern in this repo, not an improvisation.
    //
    // It exists because six webhooks now arrive from outside, and the Order API
    // spec permits exactly ONE response code -- 200 -- for every one of them.
    // That single fact drives the whole schema. We cannot tell Leafly "that was
    // malformed" or "I could not store that", so anything we cannot answer
    // properly has to be answered 200 and recorded for a human. Hence an
    // append-only log rather than a status field we overwrite.
    //
    // PROVEN to execute by applying all 225 migrations in order to a real
    // PostgreSQL 15.19, then re-applying 0225 a second time for idempotency
    // (225 applied / 0 failed; the re-apply emits the expected "already
    // exists, skipping" notices for both columns, both tables and all six
    // indexes, and succeeds), then INSPECTING the result rather than assuming
    // the DDL did what it reads like. Ten things were measured, each of which
    // fails SILENTLY if wrong:
    //
    //   * The UNIQUE index on body_sha256 really refuses a second insert of the
    //     same hash, and the SQLSTATE it raises is 23505 -- read back from psql
    //     under \set VERBOSITY verbose, because the route branches on the
    //     STRING '23505' to turn a Leafly retry into a no-op. If the database
    //     ever raised a different code, that branch would never run and a
    //     retried delivery would be processed twice, duplicating a customer's
    //     order. The code the app looks for is therefore proven to be the code
    //     the database emits, not assumed to be.
    //
    //   * event_type and order_id are NULLABLE (information_schema: YES). The
    //     activation and deactivation webhooks carry no orderId at all; a NOT
    //     NULL here would make a genuine, correctly signed delivery impossible
    //     to store -- and impossible to report, since only 200 is permitted. A
    //     live insert naming neither column succeeds and both read back null.
    //
    //   * signature_verified is `boolean not null default false`. Measured over
    //     the inserted rows: 2 defaulted false, 0 defaulted true. A default of
    //     true would mean a row written before verification finishes reads as
    //     authenticated, which is the worst possible direction for this field
    //     to fail in.
    //
    //   * The two new credential columns are `text not null default ''`, which
    //     MATCHES the sibling leafly_menu_integration_key (0053) rather than
    //     inventing a nullable variant for one member of a set of three. A
    //     draft of the harness asserted "nullable, no default" on the reasoning
    //     that NULL must stay distinguishable from ''; the reasoning was sound
    //     but the premise was wrong, and it was corrected after measuring
    //     rather than by changing the migration to match the guess.
    //
    //     That shape is only safe because the refusal lives in the CODE, so the
    //     two are proven together in one run: verifyLeaflySignature with
    //     hmacKey: "" returns { ok: false, reason: "missing_key" } -- it
    //     DECLINES to verify -- while the same body signed with a real key
    //     still returns ok: true. The control case matters, because a core that
    //     refused everything would also satisfy the first half.
    //
    //   * The factory-reset door (0209) can actually empty both tables: seeded
    //     4 events and 2 orders, called gl_factory_reset for real, and got both
    //     the function's own reported counts (4 and 2) and the tables' actual
    //     counts (0 and 0). Both are checked, because a DELETE aimed at the
    //     wrong table could still report a plausible number.
    //
    //   * The reset does NOT clear integration_credentials. Seeded Leafly keys
    //     survive a reset verbatim, which is the point: a rehearsal reset
    //     discards test ORDERS, and silently de-authenticating the integration
    //     would look like Leafly had revoked us.
    //
    //   * The owner guard on the reset is real, checked as five separate
    //     refusals rather than one: no session identity, an ACTIVE manager, an
    //     INACTIVE owner (is_owner() requires role = 'owner' AND active, and
    //     those are two conditions, so one test could not say which held), the
    //     right identity with the phrase in lowercase, and -- as the owner with
    //     the correct phrase -- the WAC 314-55-087(1) five-year retention guard
    //     firing on a single completed sale. All five refused. This was added
    //     because the harness's first run hit RESET_NOT_OWNER and the tempting
    //     response was to work around it; the correct response was to recognise
    //     0209's guard doing its job and assert it, establishing a real owner
    //     identity via auth.uid() rather than redefining is_owner() -- which
    //     would have "proved" the DELETEs against a function that no longer
    //     resembled production.
    //
    // THE HARNESS WAS ITSELF TESTED, by three sabotages of a throwaway copy,
    // each restored and diffed byte-identical afterwards:
    //   1. `delete from leafly_webhook_events where true` -> `where false`:
    //      section 8 reported MISMATCH (before 4 events, after 4 events).
    //   2. is_owner() body replaced with `select true`: exactly the 3 identity
    //      refusals broke and the phrase and retention gates correctly still
    //      held, which is the discriminating result -- a harness that reported
    //      all 5 broken would have been measuring one thing, not five.
    //   3. the empty-key refusal disabled in hmac-core: section 10 failed, and
    //      informatively -- an empty key then returned reason "mismatch",
    //      meaning it had actually computed an HMAC keyed on "". That is
    //      precisely the behaviour the `default ''` column relies on never
    //      happening.
    // Two harness DEFECTS were found and fixed this way, both of which had
    // produced false alarms that looked like schema faults: a `psql | grep ||`
    // idiom that cannot work under `set -o pipefail` (psql exits non-zero when
    // the query raises, which here is the SUCCESS case, so the failure banner
    // fired alongside the pass), and a SQLSTATE grep for the literal word
    // "SQLSTATE", which psql never prints -- it renders `ERROR:  23505:`.
    // Harness: scripts/compliance/prove-0225-executes.sh
    //
    // 0226 (SLICE L6) adds the SENDING side of the same API, plus the column
    // whose absence was a latent bug. Two jobs:
    //   1. public.leafly_outbound_attempts -- an append-only log of every call
    //      we make TO Leafly (acknowledge / status / cart), including the ones
    //      we REFUSED to make. A refusal is stored with response_status NULL,
    //      which is why that column is nullable: "we decided not to send this"
    //      and "we sent it and got nothing back" are different facts, and a
    //      NOT NULL would have forced them to share a representation.
    //   2. public.orders.origin -- text NOT NULL DEFAULT 'greenway', with a
    //      CHECK over exactly ORDER_ORIGINS from src/lib/orders/order-origin-core.ts.
    //
    // WHY (2) MATTERS MORE THAN IT LOOKS. public.orders was created in 0007 to
    // hold website orders and has never had an origin column -- measured
    // across all 225 preceding migrations, not assumed. So "this is a Greenway
    // order" was never RECORDED anywhere; it was implied by the row existing.
    // That implication was true for 225 migrations and stops being true the
    // moment Leafly orders share the table. Without the column, the checkout
    // confirmation email would fire for Leafly shoppers, breaching Leafly's
    // requirement to be "the sole originator of automated consumer facing
    // communications" -- invisibly, because the complaint goes to Leafly, not
    // to us. The DEFAULT is what makes the 225 migrations of existing history
    // correct rather than null: every order already in the table genuinely was
    // a Greenway order, so 'greenway' is a measurement, not a guess.
    //
    // The CHECK is added in a separate idempotent `do $$` block rather than
    // inline on the column, because `add column if not exists` silently skips
    // its inline constraints on a second run -- so an inline CHECK would exist
    // on a fresh database and be absent on an upgraded one. That asymmetry is
    // exactly the kind that passes every test and then fails in production.
    //
    // PROVEN to execute by applying all 226 migrations in order to a real
    // PostgreSQL 15.19 (applied 226 / failed 0), re-applying 0226 for
    // idempotency (5 "already exists, skipping" notices), and then measuring,
    // among other things:
    //   * a legacy-style insert naming no origin lands 'greenway';
    //   * 'Leafly', 'doordash' and '' are each rejected with SQLSTATE 23514,
    //     and the row's prior value survives the rejected UPDATE;
    //   * the operation CHECK rejects 'cancel' with 23514 while 0225's inbound
    //     event_type ACCEPTS an invented 'order_teleport' -- the asymmetry
    //     proven in BOTH directions, because 0225 must store anything Leafly
    //     sends (it owes them a 200) and 0226 must not send anything Leafly
    //     never defined;
    //   * created_by's FK is confdeltype 'n', and the attempt row survives
    //     deletion of the staff member with created_by set to NULL -- an audit
    //     log that vanishes when someone leaves is not an audit log;
    //   * the partial trouble index's predicate read back from pg_indexes;
    //   * RLS enabled with 0 policies and 0 anon/authenticated grants;
    //   * 0209's factory reset empties the log (12 -> 0, reported as
    //     "leafly_outbound_attempts": 12) while integration_credentials and
    //     the origin column survive -- and, before that, that the WAC
    //     314-55-087(1) retention guard and the confirmation-phrase guard both
    //     still fire, so the reset assertions are not vacuous.
    //
    // FIVE HARNESS DEFECTS were found and fixed while writing that proof, all
    // mine, and the first is the one worth remembering: section 3 inserted into
    // orders with GUESSED columns and silenced both attempts with 2>/dev/null,
    // so both inserts failed and the section then reported "rows with
    // null/empty origin (must be 0): 0" -- which READS AS A PASS while
    // counting zero rows. It now measures 0007's real shape and asserts the
    // seed count first. The others: passing `\set VERBOSITY verbose` as a
    // separate -c captured the word "SET" instead of the error (fixed with a
    // heredoc feeding both statements over one STDIN session); staff_profiles
    // was seeded with guessed columns when 0127's trigger already creates the
    // row readonly/inactive, so `on conflict do nothing` did nothing and
    // is_owner() returned f, presenting as "the reset is broken"; the reset
    // confirmation phrase was invented rather than read ('ERASE ALL TEST DATA'
    // with a second acknowledge_wac_314_55_087 argument); and a
    // `grep -qiE "ERROR|RESET_"` banner matched `reset_at` inside the SUCCESS
    // json and printed "*** reset raised ***" over a perfect run -- false
    // alarms train readers to skim the real ones, so it is now anchored and
    // case-sensitive.
    // Harness: scripts/compliance/prove-0226-executes.sh
    //
    // 0227 (SLICE L7) adds public.leafly_sync_runs -- the log of every menu
    // sync ATTEMPT, from both the schedule and the manual button, including
    // the attempts the pure core refused to make.
    //
    // WHY A TABLE AND NOT AN ADVISORY LOCK. The owner asked for "both
    // automation and a manual push button". Either one alone is easy; the hard
    // part is making them coexist, because a Leafly menu POST is a FULL sync
    // that DELETES anything its payload omits. Two of those racing is not a
    // slow page -- it is a menu that loses items depending on which request
    // Leafly finishes reading last. The obvious fix is pg_try_advisory_lock,
    // and it does not work here: Supabase's pooled HTTP interface gives no
    // session affinity, so a session-scoped lock would be taken and released
    // on whichever pooled connection happened to answer, i.e. it would not be
    // a lock at all. So the lock is a real row with `finished_at is null`, and
    // that NULL is load-bearing rather than missing data.
    //
    // WHY THE NULLABLE COLUMNS ARE THE POINT. `disposition` is nullable
    // because NULL means in flight. `method` and `http_status` are nullable
    // because a REFUSED run has neither -- and refusals are the overwhelming
    // majority of ticks. Without a storable refusal, "the cron fired and
    // correctly decided not to push" and "the cron never fired at all" are
    // indistinguishable, and those two need opposite fixes. A NOT NULL on any
    // of the three would have forced the log to drop exactly the rows that
    // make it worth keeping.
    //
    // PROVEN to execute by applying all 227 migrations in order to a real
    // PostgreSQL 15.19 (applied 227 / failed 0), re-applying 0227 for
    // idempotency (4 "already exists, skipping" notices), and then measuring:
    //   * a refused run stores with disposition='refused', method NULL and
    //     http_status NULL;
    //   * an in-flight run stores with disposition NULL, the lock query finds
    //     exactly 1, and the partial index's predicate is read back from
    //     pg_indexes and matched as text against `finished_at IS NULL` -- the
    //     index is not merely present, it indexes the right thing;
    //   * decision_code's CHECK accepts all ten codes PARSED OUT OF
    //     ALL_SCHEDULED_RUN_CODES in src/lib/leafly/schedule-core.ts (the
    //     harness asserts it parsed exactly 10, so a regex that silently
    //     matched nothing cannot read as a pass) plus 'manual_requested', and
    //     rejects 'teleport' with 23514. Measured against the code's own
    //     exported list rather than retyped, because a constraint that
    //     disagrees with the code rejects a legitimate write from inside the
    //     scheduler and destroys the evidence of why a sync did not happen;
    //   * disposition's CHECK accepts exactly four values and REJECTS
    //     'blocked' with 23514. That asymmetry is deliberate and is asserted
    //     rather than left as a comment: 'blocked' is returned in memory when
    //     no row could be opened at all, so there is nothing to write it to.
    //     Widening the CHECK would invite a writer to store a state that means
    //     "I could not store anything"; widening the writer's type would push
    //     a constraint violation into a catch block. See CloseRunArgs in
    //     schedule-server.ts;
    //   * 'skipped' is distinguishable from 'failed', which is what makes the
    //     backoff query correct -- a no-op sync must never count as a failure,
    //     or a healthy shop with an unchanged menu would back itself off;
    //   * leafly_sync_runs_trigger_actor_coherent rejects a 'schedule' run
    //     that names a staff member (nobody presses anything at 4am) while
    //     ACCEPTING a 'manual' run with a NULL actor -- both directions,
    //     because the button must never be blocked by its own logging;
    //   * leafly_sync_runs_pushed_has_method rejects pushed=true with no
    //     method AND pushed=false claiming a POST, rejects 'PATCH' (not a
    //     Leafly menu write), and accepts POST/PUT/DELETE;
    //   * created_by's FK is confdeltype 'n', proven by deleting the staff row
    //     and watching created_by become NULL while the run row survives;
    //   * RLS enabled with 0 policies and 0 anon/authenticated grants;
    //   * 0209's factory reset empties the log (25 -> 0, reported as
    //     "leafly_sync_runs": 25) while integration_credentials and
    //     syndication_sync_settings survive -- and is_owner() is asserted to
    //     be true FIRST, so the reset assertions cannot pass vacuously by the
    //     reset having been refused.
    //
    // No harness defects were found this time, because the three that cost the
    // most on 0225/0226 were carried across as fixtures rather than rewritten:
    // the `\set VERBOSITY verbose` heredoc that keeps VERBOSITY and the
    // statement in ONE psql session (a separate -c captures the word "SET"
    // instead of the SQLSTATE, which presents as a missing constraint), the
    // knowledge that 0127's trigger already creates the staff_profiles row
    // readonly/inactive so the fixture must UPDATE rather than insert (an
    // `on conflict do nothing` does nothing and is_owner() returns f, which
    // presents as "the reset is broken"), and the anchored case-sensitive
    // reset grep (an unanchored /ERROR|RESET_/i matches `reset_at` inside the
    // SUCCESS json and prints a failure banner over a perfect run).
    // Harness: scripts/compliance/prove-0227-executes.sh
    //
    // SLICE L-10 adds 0228_leafly_bridge_to_the_floor.sql — the migration that
    // lets a Leafly order reach the shop floor. Proven the only way the claim
    // can honestly be made: all 228 migrations applied in order to a real
    // PostgreSQL 15.19, 0228 re-applied cleanly (idempotent), and 26 live
    // property checks passed. The ones worth naming:
    //
    //   * announced_at is NULLABLE WITH NO DEFAULT. This is the whole
    //     idempotency guarantee, not a style choice: the bridge claims arrival
    //     work with `.is("announced_at", null)`, so a default of now() would
    //     mean every row is born already "announced", the claim would match
    //     zero rows forever, and NO Leafly order would EVER ring the bell or
    //     print a ticket. Every text-reading test in this repo would still be
    //     green. Only executing it can catch that;
    //   * the retry race proven with TWO REAL CONCURRENT TRANSACTIONS rather
    //     than by reasoning: the second delivery claims 0 rows while the first
    //     holds the lock, so a Leafly webhook retry cannot print a second
    //     ticket for the same customer;
    //   * the partial index exists AND its predicate really is
    //     `(announced_at IS NULL)` — a partial index with the wrong predicate
    //     still exists, still shows in \d, and still silently fails to serve
    //     the query it was built for;
    //   * first_seen_at, the column the index sorts by, actually exists;
    //   * all four announcer_settings per-origin sound columns are nullable
    //     and default NULL, because NULL is the SIGNAL meaning "use the origin
    //     default" — that is what lets an existing shop's settings survive;
    //   * NO foreign key from the custom sound paths to announcer_sounds,
    //     asserted rather than commented, because "we chose not to" and "we
    //     forgot to" look identical six months later. A deleted upload must
    //     degrade to a built-in, never block the delete;
    //   * 0226's orders.origin CHECK still rejects an unknown value with 23514
    //     AND still accepts 'leafly' — a constraint that rejected everything
    //     would pass the negative test while breaking the feature;
    //   * 0209's factory reset still runs, with is_owner() asserted TRUE first
    //     so the reset assertions cannot pass vacuously.
    //
    // THREE HARNESS DEFECTS FOUND AND FIXED, all one psql behaviour: `-tAc` on
    // an `INSERT ... RETURNING` prints the returned value AND the "INSERT 0 1"
    // command tag. Capturing both made $OWNER into "<uuid> INSERT 0 1", every
    // later query died with "invalid input syntax for type uuid", and the
    // harness reported the FACTORY RESET as broken when nothing was broken.
    // A fourth: staff_profiles' column is `active`, not `is_active` — the
    // wrong name does not error, the UPDATE simply matches nothing and
    // is_owner() returns f. Recorded because every one of these presents as a
    // migration defect and none of them is one.
    // Harness: scripts/compliance/prove-0228-executes.sh
    //
    // SLICE L-14 adds 0229_leafly_register_claim.sql — the claim columns on
    // leafly_orders plus leafly_register_interrupts, the table behind the
    // blocking cancellation modal. Proven the same way: all 229 migrations
    // applied in order to a real PostgreSQL 15.19, 0229 re-applied cleanly
    // (idempotent, which matters because the owner pastes these BY HAND per
    // AGENTS rule 6), and 39 live property checks passed. The ones worth
    // naming, each with the floor consequence that justifies it:
    //
    //   * resolved_at is NULLABLE WITH NO DEFAULT. Exactly the same class of
    //     defect as 0228's announced_at, and exactly as invisible to a
    //     text-reading test: `resolved_at is null` IS the definition of "this
    //     interrupt is still blocking a register". A default of now() would
    //     mean every interrupt is born already resolved, the modal would never
    //     block anything, and a CANCELLED order would be bagged and handed to
    //     the customer. Only executing it can catch that;
    //   * the retry guard proven by DOING IT: inserting a second open
    //     interrupt for the same order really is rejected with 23505. Leafly
    //     retries webhooks, and without this a budtender dismisses the same
    //     cancellation three times — which is how people learn to dismiss
    //     modals without reading them;
    //   * and proven PARTIAL by resolving the first row and inserting again,
    //     which must SUCCEED. A non-partial unique index passes the 23505 test
    //     above while permanently blocking every later cancellation of that
    //     order. The two assertions only mean something together;
    //   * both indexes carry their PREDICATES, read out of pg_indexes.indexdef
    //     rather than assumed from their names — an index with the wrong
    //     predicate still exists and still shows in \d;
    //   * disposition is an ALLOWLIST (23514 on an undesigned value, 'void'
    //     and 'walk_in' accepted) while cancel_reason_code is UNCONSTRAINED.
    //     That asymmetry is the point and both halves are tested: values WE
    //     invent are constrained because an unexpected one is our own bug;
    //     values LEAFLY sends are stored verbatim because a CHECK there would
    //     reject the inbound truth the first time they add a code;
    //   * interrupts CASCADE away with their order. An interrupt pointing at a
    //     deleted order is a modal no employee can ever clear;
    //   * register_device_id has NO foreign key, asserted rather than
    //     commented, for 0228's reason: "we chose not to" and "we forgot to"
    //     look identical six months later. Retiring a till must not block the
    //     delete or orphan the audit trail;
    //   * RLS enabled with ZERO policies (the register reaches this table
    //     through /api/pos/pickup with the admin client), so the table is
    //     unreachable from a browser holding the anon key;
    //   * 0209's factory reset still runs, with is_owner() asserted TRUE first
    //     so the reset assertions cannot pass vacuously.
    //
    // THREE HARNESS DEFECTS FOUND AND FIXED, recorded because every one
    // presented as a migration defect and none of them was one:
    //   1. the fixture insert was silently rejected (public.orders
    //      .customer_first_name is NOT NULL with no default), so the behaviour
    //      tests ran against a table with no rows. Now the fixture failure is
    //      fatal and loud, and a non-vacuity check asserts the row exists;
    //   2. `psql -tAc` on `INSERT ... RETURNING` prints the value AND the
    //      command tag — the SAME defect 0228's ledger above records as the
    //      costliest on 0225/0226/0227. There it corrupted a uuid; here it made
    //      "inserted\nINSERT 0 1" compare unequal to "inserted". Carried
    //      across properly this time with a helper that takes only the
    //      sentinel line;
    //   3. the SQLSTATE parser anchored on a "SQLSTATE" label that psql does
    //      NOT print (verbose format is `ERROR:  23514: ...`), so both negative
    //      tests yielded "" — failing SAFELY while proving nothing at all.
    //      Fixed, and the function no longer returns "" on any path: it returns
    //      NO_ERROR when the statement wrongly succeeded (a migration defect)
    //      and UNPARSED when it failed but the code did not parse (a harness
    //      defect), because conflating those two sends you to the wrong file.
    //
    // AND THE PROOF ITSELF WAS TESTED. scripts/compliance/sabotage-0229-proof.sh
    // damages 0229 in 13 ways that would each hurt the floor and requires the
    // proof to go RED for every one; it verifies the baseline is green first
    // (so a red cannot be credited to the wrong cause), restores the migration
    // sha256-verified afterwards, and re-runs to confirm green. Its first run
    // found THREE REAL HOLES in a proof that was reporting "33 passed, 0
    // failed": the hot poll index's predicate was never checked, the CHECK on
    // `kind` was never exercised, and `title not null` was never asserted.
    // Sections 5b and 5c exist because of that run. Now 13 caught, 0 survived.
    // Harness: scripts/compliance/prove-0229-executes.sh
    //          scripts/compliance/sabotage-0229-proof.sh
    //
    // SLICE L-33 added 0230_leafly_auto_acknowledge.sql, so the tail moves.
    // The ledger above about 0229's execution proof is unchanged and still
    // applies to 0229; only the "which file is last" pin is updated.
    //
    // NOTE ON WHAT THIS PIN IS AND IS NOT: it is a tripwire that forces any
    // slice adding a migration to come and read this block, which is where
    // the gapless/padded/duplicate rules below are explained. It is NOT a
    // claim that 0230 has been executed against a real Postgres in CI. 0230
    // WAS verified against a real Postgres during L-33 (all three statements,
    // including the CHECK constraint rejecting a bad `acknowledged_by_kind`
    // and the partial index's predicate), but that was a one-off run in the
    // build sandbox, not a committed harness like prove-0229-executes.sh.
    // Recorded plainly rather than implied, so nobody later mistakes this
    // line for the stronger guarantee 0229 has.
    //
    // SLICE L-47 added 0231_leafly_certification_proof.sql (widens the
    // outbound-attempt operation CHECK to the three READ endpoints so Fetch
    // Order and the ID images leave certification evidence, plus two
    // IF NOT EXISTS indexes). Verified in the build sandbox against Postgres
    // 15 bootstrapped exactly as CI does: all 231 migrations executed via
    // scripts/compliance/verify-migrations-execute.ts, 0231 applied twice
    // cleanly, the new operation names accepted and a bogus one rejected by
    // the CHECK. Again a one-off run, recorded plainly, not a committed
    // harness; tests/compliance/leafly-l47-certification-proof.test.ts pins
    // the CHECK's list to the code's.
    expect(listed[listed.length - 1]).toMatch(/^0231_/);

    // STRENGTHENED in 18-0: pinning only the last filename lets a slice bump
    // this line while leaving a hole earlier in the sequence. The numbers must
    // also be GAPLESS and start at 0001 — a skipped number means a migration
    // was written, referenced in code, and never committed, which presents at
    // runtime as the missing-column ladder swallowing an error exactly the way
    // 0216 did on order_lines.
    const asInts = listed.map((f) => Number(f.slice(0, 4)));
    expect(asInts[0]).toBe(1);
    for (let i = 1; i < asInts.length; i += 1) {
      expect(asInts[i]).toBe(asInts[i - 1] + 1);
    }

    // The duplicate-number check above, enforced rather than merely recorded:
    // two files numbered 0216 would still sort cleanly and still be padded, so
    // only this assertion can see it.
    const numbers = listed.map((f) => f.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
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
