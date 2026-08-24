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
    expect(listed[listed.length - 1]).toMatch(/^0203_/);
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
