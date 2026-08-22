/**
 * tests/compliance/migration-editor-safe-copy.test.ts
 *
 * A SECOND COPY OF A FILE IS A SECOND CHANCE TO BE WRONG.
 *
 * Michael applies migrations by hand, by pasting text into the Supabase SQL
 * editor. 0195 is 734 lines and 334 of them are comments, which makes it
 * fragile in transit: any client that splits the text into statements itself
 * must simultaneously honour single-quoted strings, dollar-quoted bodies, and
 * -- comments. 0195 contains 8 comment lines with an odd number of
 * apostrophes, 15 comment lines containing a semicolon, and 4 dollar-quoted
 * bodies that themselves contain '--'.
 *
 * So the repo also ships a comment-free copy under supabase/migrations/
 * editor-safe/. That copy is a convenience, and every convenience of that kind
 * is a drift risk: the day someone edits the real migration and forgets the
 * copy, Michael pastes stale SQL and we have manufactured the exact class of
 * silent failure he asked us to make impossible.
 *
 * This suite exists so that cannot happen quietly. The copy is not trusted --
 * it is REGENERATED from the real migration here and compared byte for byte.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  stripSqlComments,
  transitHazards,
} from "../../scripts/compliance/strip-comments-for-sql-editor";

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");
const SOURCE = path.join(MIGRATIONS, "0195_employee_payroll_setup.sql");
const COPY = path.join(
  MIGRATIONS,
  "editor-safe",
  "0195_employee_payroll_setup.EDITOR_SAFE.sql",
);

describe("the editor-safe copy cannot drift from the migration it copies", () => {
  it("both files exist", () => {
    expect(existsSync(SOURCE)).toBe(true);
    expect(existsSync(COPY)).toBe(true);
  });

  it("the copy is EXACTLY what stripping the source produces", () => {
    // Regenerated, not trusted. If someone edits 0195 and forgets the copy,
    // this fails and names the reason.
    const regenerated = stripSqlComments(readFileSync(SOURCE, "utf8"));
    const onDisk = readFileSync(COPY, "utf8");
    expect(onDisk).toBe(regenerated);
  });

  it("the copy carries no comments at all, which is its whole purpose", () => {
    const after = transitHazards(readFileSync(COPY, "utf8"));
    expect(after.commentLines).toBe(0);
    expect(after.oddApostrophe).toBe(0);
    expect(after.withSemicolon).toBe(0);
  });

  it("the SOURCE really does carry the hazards, or this copy is pointless", () => {
    // Guard against a vacuous pass (standing rule 39): if 0195 ever stopped
    // containing risky comments, the assertions above would hold trivially and
    // prove nothing. Measured values at the time of writing: 334 / 8 / 15.
    const before = transitHazards(readFileSync(SOURCE, "utf8"));
    expect(before.commentLines).toBeGreaterThan(100);
    expect(before.oddApostrophe).toBeGreaterThan(0);
    expect(before.withSemicolon).toBeGreaterThan(0);
  });

  it("stripping does not remove SQL: every statement keyword survives", () => {
    const stripped = stripSqlComments(readFileSync(SOURCE, "utf8"));
    // Counted from the real file. These are the statements that DO the work.
    for (const [needle, atLeast] of [
      ["create table if not exists", 4],
      ["alter table public.employees", 2],
      ["enable row level security", 4],
      ["create or replace function", 1],
      ["do $", 3],
    ] as [string, number][]) {
      const found = stripped.split(needle).length - 1;
      expect(found, `expected at least ${atLeast} of "${needle}"`).toBeGreaterThanOrEqual(
        atLeast,
      );
    }
  });

  it("does NOT strip '--' that lives inside a dollar-quoted body's SQL string", () => {
    // The lexer must not treat characters inside a literal as a comment.
    const sample =
      "do $x$ begin\n  raise notice 'a -- b';\n  -- real comment\nend $x$;\n";
    const out = stripSqlComments(sample);
    expect(out).toContain("'a -- b'");
    expect(out).not.toContain("real comment");
  });

  it("preserves a doubled apostrophe inside a string literal", () => {
    const sample = "select 'it''s fine'; -- gone\n";
    const out = stripSqlComments(sample);
    expect(out).toContain("'it''s fine'");
    expect(out).not.toContain("gone");
  });
});

/**
 * RULE 40. These guard the SECOND round of this defect, and they exist because
 * removing comments was NOT enough: Michael ran the comment-free copy and got
 * the SAME `42P01: relation "a" does not exist`.
 *
 * The editor-safe file applies with exit 0 on a FIRST application against a
 * real PostgreSQL 15 behind a real 0001-0194 pre-state, and its catalogue was
 * compared row for row against the commented original (491 rows vs 491,
 * identical). So the SQL is valid and the mangling happens IN TRANSIT. The only
 * defence we control is to leave nothing in the shipped file that a mangled
 * read can turn into a valid-looking bare identifier.
 */
describe("the editor-safe copy carries NO transit hazard", () => {
  const EDITOR_SAFE = path.join(
    process.cwd(),
    "supabase/migrations/editor-safe/0195_employee_payroll_setup.EDITOR_SAFE.sql",
  );

  it("reads a real, non-empty file (rule 39: no vacuous pass)", () => {
    const text = readFileSync(EDITOR_SAFE, "utf8");
    expect(text.length).toBeGreaterThan(5_000);
    expect(text).toContain("employee_ssn_reveals");
  });

  it("has ZERO of every transit hazard", () => {
    const h = transitHazards(readFileSync(EDITOR_SAFE, "utf8"));
    expect(h.commentLines).toBe(0);
    expect(h.oddApostrophe).toBe(0);
    expect(h.withSemicolon).toBe(0);
    // The three that the first fix missed entirely.
    expect(h.bareRelationWord).toBe(0);
    expect(h.nonAscii).toBe(0);
    expect(h.semicolonInString).toBe(0);
  });

  it("contains no character above U+007F anywhere", () => {
    const text = readFileSync(EDITOR_SAFE, "utf8");
    const wide = text.match(/[^\u0000-\u007F]/g) ?? [];
    expect(wide, `found ${wide.length} non-ASCII: ${JSON.stringify(wide.slice(0, 5))}`).toEqual(
      [],
    );
  });

  it("never puts a single-letter word after a relation keyword", () => {
    // "select this into a list view" parses as relation "a" the moment a client
    // loses quote tracking. That phrase WAS in this file, and it was the only
    // site in it that could produce Michael's exact error.
    const text = readFileSync(EDITOR_SAFE, "utf8");
    const hits = text.match(/\b(?:from|into|join|update|table)\s+[a-z]\b/gi) ?? [];
    expect(hits, `bare relation words: ${JSON.stringify(hits)}`).toEqual([]);
  });

  it("DETECTS the hazard it is meant to detect (rule 16: prove the gate fires)", () => {
    // Control: the exact prose that broke Michael's run must be flagged.
    const broken = transitHazards(
      "comment on column t.c is 'Never select this into a list view.';\n",
    );
    expect(broken.bareRelationWord).toBe(1);

    const emDash = transitHazards("comment on column t.c is 'a \u2014 b';\n");
    expect(emDash.nonAscii).toBe(1);

    const semi = transitHazards("comment on column t.c is 'do this; then that';\n");
    expect(semi.semicolonInString).toBe(1);

    // And a clean file must NOT be flagged, so the check discriminates.
    const clean = transitHazards("comment on column t.c is 'Never select this column.';\n");
    expect(clean.bareRelationWord).toBe(0);
    expect(clean.nonAscii).toBe(0);
    expect(clean.semicolonInString).toBe(0);
  });

  it("does not count a semicolon that is genuinely between statements", () => {
    const h = transitHazards("select 1;\nselect 2;\n");
    expect(h.semicolonInString).toBe(0);
  });

  it("ignores hazards inside a dollar-quoted body, which is opaque to splitters", () => {
    // A $tag$ body is not a single-quoted literal, so a ';' in it is not the
    // hazard this check is about. Miscounting here would make the gate noisy
    // and eventually ignored.
    const h = transitHazards("do $x$ begin raise notice 'a; b'; end $x$;\n");
    expect(h.semicolonInString).toBe(0);
  });
});

/**
 * books-31. EVERY editor-safe pair, discovered rather than listed.
 *
 * WHY THIS BLOCK EXISTS. Everything above names 0195 in a constant. That was
 * right when 0195 was the only migration with an editor-safe copy, and it
 * became wrong the moment 0196 shipped with one: a hardcoded suite passes
 * cheerfully while a brand-new copy drifts, which is precisely the silent
 * failure the file's own header says it exists to prevent.
 *
 * So this walks the editor-safe DIRECTORY instead. Adding a copy automatically
 * puts it under test; forgetting to regenerate one fails here by name. Nothing
 * has to be remembered.
 *
 * Standing rule 25: this EXTENDS the suite rather than starting a second file
 * that would slowly disagree with this one.
 */
describe("every editor-safe copy in the directory, discovered not listed", () => {
  const EDITOR_SAFE_DIR = path.join(MIGRATIONS, "editor-safe");
  const SUFFIX = ".EDITOR_SAFE.sql";

  /** Each copy paired with the migration it claims to be a copy OF. */
  function pairs(): Array<{ copy: string; source: string; base: string }> {
    return readdirSync(EDITOR_SAFE_DIR)
      .filter((f) => f.endsWith(SUFFIX))
      .sort()
      .map((f) => {
        const base = f.slice(0, -SUFFIX.length);
        return {
          base,
          copy: path.join(EDITOR_SAFE_DIR, f),
          source: path.join(MIGRATIONS, `${base}.sql`),
        };
      });
  }

  it("finds at least the five pairs known to exist (rule 39: no vacuous pass)", () => {
    // A directory walk that finds nothing would make every test below pass
    // without asserting anything. Measured at the time of writing: 0195, 0196,
    // 0197, 0198 and 0199. The floor rises with each new copy on purpose - a
    // floor of 1 would still pass after four of the five copies were deleted,
    // which is exactly the silent hole this block exists to close.
    const found = pairs().map((p) => p.base);
    expect(found.length).toBeGreaterThanOrEqual(5);
    expect(found).toContain("0195_employee_payroll_setup");
    expect(found).toContain("0196_company_profile");
    expect(found).toContain("0197_timesheet_workweek");
    expect(found).toContain("0198_sick_leave_and_garnishments");
    // books-34. The year-to-date accumulators. Generating this copy caught a
    // real hazard the four before it did not have: two semicolons inside
    // `comment on` prose, which a splitter that does not track quotes would
    // have cut the statement at. The prose was rewritten rather than the
    // hazard counted as acceptable.
    expect(found).toContain("0199_payroll_ytd_accumulators");
  });

  it("every copy has a real migration behind it", () => {
    for (const p of pairs()) {
      expect(existsSync(p.source), `${p.base}: no migration at ${p.source}`).toBe(true);
    }
  });

  it("every copy is EXACTLY what stripping its source produces", () => {
    for (const p of pairs()) {
      const regenerated = stripSqlComments(readFileSync(p.source, "utf8"));
      const onDisk = readFileSync(p.copy, "utf8");
      expect(
        onDisk,
        `${p.base}: the editor-safe copy has drifted from the migration. ` +
          `Regenerate it - Michael pastes this file by hand and stale SQL is a silent failure.`,
      ).toBe(regenerated);
    }
  });

  it("every copy has ZERO of all six transit hazards", () => {
    for (const p of pairs()) {
      const h = transitHazards(readFileSync(p.copy, "utf8"));
      expect(h.commentLines, `${p.base}: commentLines`).toBe(0);
      expect(h.oddApostrophe, `${p.base}: oddApostrophe`).toBe(0);
      expect(h.withSemicolon, `${p.base}: withSemicolon`).toBe(0);
      // The three that the first 0195 fix missed entirely, and that cost
      // Michael two failed attempts in the Supabase editor.
      expect(h.bareRelationWord, `${p.base}: bareRelationWord`).toBe(0);
      expect(h.nonAscii, `${p.base}: nonAscii`).toBe(0);
      expect(h.semicolonInString, `${p.base}: semicolonInString`).toBe(0);
    }
  });

  it("every copy is substantial, so none is an empty placeholder", () => {
    for (const p of pairs()) {
      expect(readFileSync(p.copy, "utf8").length, `${p.base} is suspiciously small`).toBeGreaterThan(
        2_000,
      );
    }
  });

  it("every SOURCE really does carry hazards, or its copy is pointless", () => {
    // The other half of rule 39. If a migration had no risky comments, its
    // editor-safe copy would be identical to it and the assertions above would
    // hold trivially.
    for (const p of pairs()) {
      const before = transitHazards(readFileSync(p.source, "utf8"));
      expect(before.commentLines, `${p.base}: source has no comments to strip`).toBeGreaterThan(50);
    }
  });
});
