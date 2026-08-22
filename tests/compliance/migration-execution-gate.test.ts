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
    // books-33 made 0198 the last file. Asserted as the CURRENT highest rather
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
    expect(listed[listed.length - 1]).toMatch(/^0198_/);
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
