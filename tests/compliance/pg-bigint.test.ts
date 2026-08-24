/**
 * tests/compliance/pg-bigint.test.ts   (books-46 slice A)
 *
 * THE ONE PLACE A POSTGRES bigint BECOMES A JAVASCRIPT NUMBER.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS WORTH READING BEFORE THE MODULE IT TESTS
 * ───────────────────────────────────────────────────────────────────────────
 *
 * PostgREST returns a `bigint` as a JSON STRING, so every store that reads a
 * money column has to convert it back. Six stores had each written that
 * conversion themselves:
 *
 *   src/lib/payroll/ytd-store.ts                requiredBigintCents()
 *   src/lib/payroll/garnishment-store.ts        bigintCentsToNumber()
 *   src/lib/payroll/payroll-onboarding-store.ts centsFromColumn()
 *   src/lib/payroll/form-w2-store.ts            requiredBigint()
 *   src/lib/loans/loan-store.ts                 toNum()
 *   src/lib/atm/store.ts                        numOrNull()
 *
 * Six authors, six reviews, six careful explanatory comments - and the same two
 * defects in all six, because they all shared one reasonable-sounding but wrong
 * belief about what `Number()` does. That is what standing rule 25 is actually
 * about. The duplication was not the harm; the duplication is what allowed one
 * wrong idea to be wrong in six places at once and be checked off six times.
 *
 * Not one of the six was directly tested. Each was a private function inside a
 * `server-only` module, so the only way to reach it was through a Supabase
 * query, which no unit test performs. Six copies of an untested conversion sat
 * underneath every wage figure on every payroll screen. The module this file
 * tests is PURE, which is the whole point: it can be called directly, and so it
 * can be held to account.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW TO READ THIS FILE (it is organised as an argument, not a list)
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   §1  CONTROLS       - the values that MUST be accepted. Read these first.
 *   §2  DEFECT 1       - `Number("")` is 0, not NaN.
 *   §3  DEFECT 2       - `isInteger` does not mean the value survived.
 *   §4  NULL           - the one difference between the two functions...
 *   §5  NOT-NULL       - ...and the difference that must NOT exist.
 *   §6  MESSAGES       - a refusal nobody can act on is just an outage.
 *   §7  CALLERS        - the fix is only a fix if the six stores use it.
 *
 * §1 is first deliberately. A guard that refuses everything passes every
 * rejection test in §2 and §3 while being completely useless, so the refusals
 * below only mean something because the acceptances above them hold (rule 55).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  optionalBigint,
  requiredBigint,
  __runPgBigintTests,
  type BigintSource,
} from "@/lib/supabase/pg-bigint";

const SRC: BigintSource = {
  table: "payroll_ytd_accumulators",
  column: "oasdi_wages_cents",
  context: "employee e1",
};

/** The message of whatever was thrown, or null if nothing was. */
function refusal(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe("pg-bigint runs its own embedded self-tests", () => {
  it("passes them under vitest as well as under tsx", () => {
    // The module carries `__runPgBigintTests` so it is covered by
    // `scripts/compliance/run-pure-selftests.ts` too. Both runners are wired
    // on purpose: the tsx runner is what a developer runs by hand, this is
    // what CI runs, and a check that only one of them sees is a check that
    // will eventually be skipped by whoever is in a hurry.
    expect(() => __runPgBigintTests()).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  CONTROLS - what must be ACCEPTED
 *
 * These come first because they are what make the rest of the file mean
 * anything. Standing rule 55: a refusal has to DISCRIMINATE. If every one of
 * these failed, all of §2 and §3 would still pass, and the module would be
 * broken in a way no test could see.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§1 the values a wage column really does return", () => {
  it("reads a bigint string as a number", () => {
    expect(requiredBigint("900000", SRC)).toBe(900_000);
  });

  it("reads a JSON number unchanged", () => {
    // `int` and `smallint` columns arrive as numbers, not strings, so both
    // paths are real and both are exercised.
    expect(requiredBigint(900_000, SRC)).toBe(900_000);
  });

  it("accepts zero, because zero is a real wage figure", () => {
    // This is the control that matters most. Zero is exactly what the module
    // refuses to INVENT, and refusing to invent it is not the same as refusing
    // to read it: an employee hired in December genuinely has zero of some
    // figures, and a fourth-quarter 941 can genuinely report zero.
    expect(requiredBigint(0, SRC)).toBe(0);
    expect(requiredBigint("0", SRC)).toBe(0);
    expect(optionalBigint("0", SRC)).toBe(0);
  });

  it("accepts a negative, because a correction can be negative", () => {
    // The reader does not decide sign policy. The migrations' CHECK
    // constraints do, and the engine does. A reader that quietly rejected
    // negatives would be enforcing that rule in a third place, where nobody
    // would think to look for it.
    expect(requiredBigint(-500, SRC)).toBe(-500);
    expect(requiredBigint("-500", SRC)).toBe(-500);
  });

  it("accepts the largest and smallest values that survive exactly", () => {
    // The boundary, from both sides. Without this, §3 would pass for a reader
    // that refused all large numbers - a different bug, same green tick.
    expect(requiredBigint("9007199254740991", SRC)).toBe(9_007_199_254_740_991);
    expect(requiredBigint("-9007199254740991", SRC)).toBe(-9_007_199_254_740_991);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  DEFECT 1 - `Number("")` IS 0, NOT NaN
 *
 * All six stores guarded with `Number.isFinite(n) && Number.isInteger(n)`,
 * which reads like "reject anything that is not a clean whole number". It is
 * not. `Number()` performs JavaScript's numeric coercion, and coercion is
 * generous in ways that are easy to forget and impossible to see at a glance.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§2 a blank is not a zero", () => {
  it("REFUSES an empty string, which the old guard read as 0", () => {
    // This is the defect in its purest form, and the reason it is severe is
    // not that it is exotic - it is that the wrong answer is PLAUSIBLE. Every
    // one of those six stores carried a comment explaining that reading an
    // unreadable wage column as zero is the most dangerous possible outcome,
    // precisely because zero wages is indistinguishable from an employee who
    // has not been paid yet this year. Then the guard produced that zero.
    expect(refusal(() => requiredBigint("", SRC))).not.toBeNull();
    expect(() => requiredBigint("", SRC)).toThrow(/blank is not a zero/);
  });

  it("REFUSES whitespace, which also coerced to 0", () => {
    for (const blank of ["   ", "\t", "\n", " \t\n "]) {
      expect(
        refusal(() => requiredBigint(blank, SRC)),
        `whitespace ${JSON.stringify(blank)} must not read as a number`,
      ).not.toBeNull();
    }
  });

  it("REFUSES hex and exponent notation, which coerced to WRONG numbers", () => {
    // These are worse in kind than the blanks. A blank produced a refusal that
    // failed; these produce a number that SUCCEEDED and is wrong. Nothing
    // downstream can tell, because 31 and 1000 are perfectly ordinary values.
    expect(refusal(() => requiredBigint("0x1F", SRC))).not.toBeNull(); // was 31
    expect(refusal(() => requiredBigint("1e3", SRC))).not.toBeNull(); // was 1000
    expect(refusal(() => requiredBigint("0b11", SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint("0o17", SRC))).not.toBeNull();
  });

  it("REFUSES a leading plus and surrounding spaces", () => {
    // Not pedantry. A `bigint` column NEVER renders like this, so a value that
    // does means the caller has the wrong column or the data took an unusual
    // route into the table. Trimming it silently would hide that; both would
    // otherwise have been accepted.
    expect(refusal(() => requiredBigint("+900000", SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint(" 900000 ", SRC))).not.toBeNull();
  });

  it("REFUSES text, decimals and separators", () => {
    // These four were correctly refused before AND after the change. They are
    // here so that a future edit which loosens the shape check gets caught by
    // this file rather than by a wrong W-2.
    expect(refusal(() => requiredBigint("abc", SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint("12.34", SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint("1_000", SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint("Infinity", SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint(1234.5, SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint(Number.NaN, SRC))).not.toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  DEFECT 2 - `isInteger` DOES NOT MEAN THE VALUE SURVIVED
 *
 * This is the worse of the two, because all six comments NAMED the hazard and
 * then failed to guard it. Each said a bigint does not fit safely in a
 * JavaScript number. Each then asked `Number.isInteger`, which answers "is
 * this a whole number", never "is this the whole number that was sent".
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§3 a bigint that does not fit must not be silently reshaped", () => {
  it("REFUSES 2^53+1, which the old guard accepted as 2^53", () => {
    // Number("9007199254740993") === 9007199254740992. An integer. Finite.
    // Off by one. No null, no NaN, no throw - just a different number than the
    // database sent, forever.
    expect(refusal(() => requiredBigint("9007199254740993", SRC))).not.toBeNull();
    expect(() => requiredBigint("9007199254740993", SRC)).toThrow(/outside the range/);
  });

  it("REFUSES a full-width bigint, off by two and silent", () => {
    // Number("123456789012345678") === 123456789012345680.
    expect(refusal(() => requiredBigint("123456789012345678", SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint("9223372036854775807", SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint("-9223372036854775808", SRC))).not.toBeNull();
  });

  it("REFUSES an unsafe integer that arrives as a JSON number too", () => {
    // The number path needs the same guard as the string path. A view or a
    // computed column can send a JSON number that is already past 2^53.
    expect(refusal(() => requiredBigint(9_007_199_254_740_993, SRC))).not.toBeNull();
  });

  it("is not simply refusing everything large (rule 55 control)", () => {
    // Restating §1's boundary here, next to the refusals it validates, because
    // this is the exact pairing that makes the refusals above meaningful.
    expect(requiredBigint("9007199254740991", SRC)).toBe(9_007_199_254_740_991);
    expect(requiredBigint("9007199254740990", SRC)).toBe(9_007_199_254_740_990);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  NULL - the ONE way the two functions may differ
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§4 null means different things in different columns", () => {
  it("requiredBigint REFUSES null, because the migration says not null", () => {
    // A null in a `not null` column is not a missing value. It means the row
    // is not the shape the schema promises, which means something wrote it
    // outside the normal path - and that is worth an error, not a zero.
    expect(refusal(() => requiredBigint(null, SRC))).not.toBeNull();
    expect(refusal(() => requiredBigint(undefined, SRC))).not.toBeNull();
  });

  it("optionalBigint PASSES null through, because absence is information", () => {
    // A wage order with no recorded arrears, or a W-4 with Step 3 left blank,
    // is a fact about the document. Turning it into 0 would state an election
    // the employee never made (rule 62d).
    expect(optionalBigint(null, SRC)).toBeNull();
    expect(optionalBigint(undefined, SRC)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  ...AND THE DIFFERENCE THAT MUST NOT EXIST
 *
 * The third defect, specific to the nullable helpers. Two of the six returned
 * `null` for GARBAGE as well as for absence, which quietly merged "this column
 * is empty" with "this column contains something I cannot read".
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§5 unreadable is not the same as empty", () => {
  it("optionalBigint REFUSES a blank instead of nulling it", () => {
    // If a blank returned null, an empty string in `arrears_cents` would be
    // indistinguishable from a court order that recorded no arrears. Same
    // collapse as reading it as 0, one level up, and just as invisible.
    expect(refusal(() => optionalBigint("", SRC))).not.toBeNull();
    expect(refusal(() => optionalBigint("   ", SRC))).not.toBeNull();
  });

  it("optionalBigint REFUSES malformed and unsafe values instead of nulling", () => {
    expect(refusal(() => optionalBigint("abc", SRC))).not.toBeNull();
    expect(refusal(() => optionalBigint("0x1F", SRC))).not.toBeNull();
    expect(refusal(() => optionalBigint("12.34", SRC))).not.toBeNull();
    expect(refusal(() => optionalBigint("9007199254740993", SRC))).not.toBeNull();
  });

  it("agrees with requiredBigint on every value that is actually present", () => {
    // Proving the split is by NULLABILITY ALONE. If the two ever disagreed
    // about a present value, then which reader a store happened to call would
    // change the number on the form, which is a hidden second rule.
    for (const v of ["0", "1", "-1", "900000", "9007199254740991", 0, -500, 900_000]) {
      expect(optionalBigint(v, SRC)).toBe(requiredBigint(v, SRC));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  MESSAGES - a refusal nobody can act on is just an outage
 *
 * These functions throw, and the caller turns the throw into a READ_FAILED on
 * screen. That is only better than a wrong number if the message says enough
 * to find the row. Standing rule: a refusal has to be diagnosable.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§6 the message names the table, the column and the row", () => {
  it("names all three for a null", () => {
    const m = refusal(() => requiredBigint(null, SRC)) ?? "";
    expect(m).toContain("payroll_ytd_accumulators");
    expect(m).toContain("oasdi_wages_cents");
    expect(m).toContain("employee e1");
  });

  it("names all three for a malformed value, and quotes the value back", () => {
    // Quoting matters. "The column is unreadable" is not actionable;
    // `read as ""` tells you immediately that something wrote an empty string
    // where a number belonged, which is a different bug to go and fix.
    const m = refusal(() => requiredBigint("0x1F", SRC)) ?? "";
    expect(m).toContain("payroll_ytd_accumulators");
    expect(m).toContain("oasdi_wages_cents");
    expect(m).toContain('"0x1F"');
  });

  it("says that nothing was assumed, because that is the promise being kept", () => {
    expect(refusal(() => requiredBigint(null, SRC)) ?? "").toMatch(/[Nn]othing was assumed/);
    expect(refusal(() => requiredBigint("abc", SRC)) ?? "").toMatch(/[Nn]othing was assumed/);
  });

  it("explains WHY zero would be the dangerous answer, not just that it refused", () => {
    // Michael reads these. "Cannot read column" teaches nothing; "reading it
    // as zero would look exactly like an employee who has not been paid yet"
    // explains why the screen is refusing to help rather than guessing.
    expect(refusal(() => requiredBigint(null, SRC)) ?? "").toMatch(/not been paid yet/);
    expect(refusal(() => requiredBigint("", SRC)) ?? "").toMatch(/blank is not a zero/);
  });

  it("explains that digits would be lost, for the too-large case", () => {
    const m = refusal(() => requiredBigint("9007199254740993", SRC)) ?? "";
    expect(m).toMatch(/exactly/);
    expect(m).toMatch(/64-bit|2\^53/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  THE CALLERS - a shared fix that nobody calls is not a fix
 *
 * Standing rule 23: fix the class, then USE the fixed thing. Standing rule 50:
 * dead code wearing a green check. This module could be perfect and every
 * store could still carry its own broken copy, and every test above would
 * still pass. So the last section checks the stores.
 * ═══════════════════════════════════════════════════════════════════════════ */

const REPO = join(__dirname, "..", "..");
const CALLERS = [
  "src/lib/payroll/ytd-store.ts",
  "src/lib/payroll/garnishment-store.ts",
  "src/lib/payroll/payroll-onboarding-store.ts",
  "src/lib/payroll/form-w2-store.ts",
  "src/lib/loans/loan-store.ts",
  "src/lib/atm/store.ts",
] as const;

/** A file's source with comments stripped, so prose cannot satisfy a check. */
function codeOf(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("§7 every store that reads a bigint uses the shared reader", () => {
  it("all six import it", () => {
    for (const rel of CALLERS) {
      expect(codeOf(rel), `${rel} must import the shared reader`).toContain(
        "@/lib/supabase/pg-bigint",
      );
    }
  });

  it("none of them still carries the defective idiom", () => {
    // The exact line that was duplicated six times. Comment-stripped, so the
    // headers that now EXPLAIN the old idiom cannot satisfy this check - which
    // is the trap this assertion would otherwise fall into, given that several
    // of those headers quote the bad line verbatim.
    for (const rel of CALLERS) {
      const code = codeOf(rel);
      expect(code, `${rel} must not re-implement the conversion`).not.toContain(
        'typeof v === "string" ? Number(v) : v',
      );
      expect(code, `${rel} must not guard with isFinite alone`).not.toContain(
        "Number.isFinite(n) ? n : null",
      );
    }
  });

  it("the comment-stripper actually strips (rule 39 self-check)", () => {
    // Without this, a bug in `codeOf` returning "" would make the entire
    // section above pass vacuously - which is the precise failure mode these
    // gates exist to catch elsewhere.
    const code = codeOf("src/lib/payroll/form-w2-store.ts");
    expect(code.length).toBeGreaterThan(1_000);
    expect(code).toContain("export async function loadW2s");
    expect(code).not.toContain("connected to nothing");
  });

  it("is registered in the pure self-test runner, not just here", () => {
    const runner = readFileSync(
      join(REPO, "scripts", "compliance", "run-pure-selftests.ts"),
      "utf8",
    );
    expect(runner).toContain("__runPgBigintTests");
    // Imported AND invoked. An import alone is a module that loads and proves
    // nothing, which is exactly the shape of dead code with a green check.
    expect(runner).toContain("__runPgBigintTests()");
  });
});
