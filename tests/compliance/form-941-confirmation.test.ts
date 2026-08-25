/**
 * tests/compliance/form-941-confirmation.test.ts   (books-48)
 *
 * THE GATE ON THE FILED-TOTALS CONFIRMATION STEP.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS PROTECTING, AND WHY IT IS WORTH A FILE OF ITS OWN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The confirmation step exists to supply the INDEPENDENT side of every 941
 * reconciliation. Migration 0204 spells out why that independence is the whole
 * mechanism:
 *
 *     "The comparison has value for exactly one reason: THE TWO SIDES ARE
 *      INDEPENDENT. ... Remove it and there is no check, only its appearance."
 *
 * So the failure mode this file guards is not "the arithmetic is wrong". It is
 * "the independence quietly went away" - somebody pre-fills the form from the
 * computed return to save Michael typing, or a null gets treated as a zero, and
 * the screen keeps showing green ticks that no longer mean anything. That
 * failure is invisible by construction: everything still compiles, every row
 * still renders, and the ticks look exactly like the ticks that were earned.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 83: EVERY GATE HERE WAS DRIVEN WITH A BROKEN INPUT FIRST
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each refusal test below was written by first constructing the draft that
 * SHOULD be refused and confirming the validator refuses it for the RIGHT
 * reason - not merely that it refused. A test asserting `ok === false` passes
 * when the validator refuses everything, including the good draft, which is a
 * gate that approves nothing and therefore checks nothing (the inverse of rule
 * 39 and just as useless). Every refusal assertion below therefore also
 * asserts that the GOOD draft is accepted, and the codes are compared exactly.
 *
 * The proven-failable evidence for the structural assertions is recorded in
 * scripts/prove-941-confirmation.sh, which mutates the source and requires this
 * file to fail.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALL_FILED_941_REFUSAL_CODES,
  ALL_FILED_941_WARNING_CODES,
  EMPTY_FILED_941_DRAFT,
  FICA_PLAUSIBILITY_TOLERANCE_CENTS,
  FILED_941_COLUMN_MAP,
  FILED_941_MAX_YEAR,
  FILED_941_MIN_YEAR,
  FILED_941_YEAR_BOUNDS_MATCH_MIGRATION,
  assertFiledForm941CodeListsAreWellFormed,
  filedForm941Row,
  quarterEndIso,
  validateFiledForm941Draft,
  type FiledForm941Draft,
  type FiledForm941RefusalCode,
  type FiledForm941WarningCode,
} from "@/lib/payroll/form-941-confirmation-core";
import {
  AS_FILED_2025_BOX_14_HEALTH_CENTS,
  AS_FILED_2025_BOX_4_CENTS,
  AS_FILED_2025_BOX_6_CENTS,
  AS_FILED_2025_SS_WAGES_CENTS,
  FILED_941_FORM_ID,
  FORM_941_CONFIRMATION_LESSONS,
  assertAsFiledFiguresReconcile,
  assertForm941ConfirmationLessonsAreWellFormed,
  checkAsFiledFigures,
  type AsFiledW2Figures,
} from "@/lib/payroll/form-941-confirmation-lessons";
import { filedTotalTax, form941Checks } from "@/lib/payroll/form-941-checks";
import { FORM_941_SOURCE_PATH } from "@/lib/payroll/form-941-authorities";
import { FORM_W2_SOURCE_PATH } from "@/lib/payroll/form-w2-authorities";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/* ═══════════════════════════════════════════════════════════════════════════
 * A DRAFT THAT IS ACTUALLY GOOD
 *
 * Built on Greenway's own 2025 W-2 figures scaled to one quarter, so the FICA
 * plausibility warnings do not fire on the baseline. If the good draft tripped
 * a warning, every warning test below would pass for the wrong reason.
 *
 * 12.4% of 1,000,000 cents = 124,000. 2.9% of 1,000,000 = 29,000.
 * ═══════════════════════════════════════════════════════════════════════════ */

const GOOD: FiledForm941Draft = {
  taxYearText: "2027",
  quarterText: "1",
  line3Text: "800.00",
  line5aWagesText: "10000.00",
  line5aTaxText: "1240.00",
  line5cWagesText: "10000.00",
  line5cAnd5dTaxText: "290.00",
  line5dAddlTaxText: "0.00",
  filedOnText: "2027-04-30",
  sourceNoteText: "Aatrix Q1 2027, confirmation 0-053-958-352",
};

function withField(
  patch: Partial<FiledForm941Draft>,
): FiledForm941Draft {
  return { ...GOOD, ...patch };
}

/** The codes a draft is refused for, sorted so comparisons are stable. */
function refusalCodesOf(draft: FiledForm941Draft): readonly FiledForm941RefusalCode[] {
  const res = validateFiledForm941Draft(draft);
  return res.ok ? [] : [...res.refusals.map((r) => r.code)].sort();
}

/** The codes a draft is warned about. Empty when the draft is refused. */
function warningCodesOf(draft: FiledForm941Draft): readonly FiledForm941WarningCode[] {
  const res = validateFiledForm941Draft(draft);
  return res.ok ? [...res.warnings.map((w) => w.code)].sort() : [];
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE BASELINE MUST BE CLEAN, OR NOTHING BELOW MEANS ANYTHING
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-48: the good draft is accepted, so the refusals below are real", () => {
  it("accepts a correctly transcribed return", () => {
    const res = validateFiledForm941Draft(GOOD);
    expect(res.ok, res.ok ? "" : JSON.stringify(res.refusals, null, 2)).toBe(true);
  });

  it("raises no warnings on a plausible return", () => {
    // If the baseline warned, every warning test would be indistinguishable
    // from the baseline noise and would pass without proving anything.
    expect(warningCodesOf(GOOD)).toEqual([]);
  });

  it("parses the money into cents rather than dollars", () => {
    const res = validateFiledForm941Draft(GOOD);
    if (!res.ok) throw new Error("baseline draft must validate");
    // 800.00 dollars is 80,000 cents. A parser returning 800 here would put
    // every figure out by a factor of 100 and nothing else would notice,
    // because 800 is a perfectly plausible number of cents.
    expect(res.value.line3FederalIncomeTaxCents).toBe(80_000);
    expect(res.value.line5aSsWagesCents).toBe(1_000_000);
    expect(res.value.line5aSsTaxCents).toBe(124_000);
  });

  it("the empty draft is refused, so a blank submit cannot store zeroes", () => {
    // A row of zeroes stored as "what was filed" is the worst possible outcome:
    // it is indistinguishable from a genuinely zero quarter and it would make
    // every check row disagree by the entire return.
    const res = validateFiledForm941Draft(EMPTY_FILED_941_DRAFT);
    expect(res.ok).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  ALL NINE REFUSALS ARE REACHABLE
 *
 * Rule 40: an unreachable guard is an untested guard. A refusal code that no
 * input can produce is a branch that has never run, and the first time it runs
 * will be in front of Michael.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-48: every refusal code is reachable with a specific bad draft", () => {
  const CASES: readonly {
    readonly code: FiledForm941RefusalCode;
    readonly draft: FiledForm941Draft;
    readonly why: string;
  }[] = [
    {
      code: "YEAR_NOT_VALID",
      draft: withField({ taxYearText: "not a year" }),
      why: "a year that is not a number",
    },
    {
      code: "YEAR_NOT_VALID",
      draft: withField({ taxYearText: String(FILED_941_MIN_YEAR - 1) }),
      why: "a year below the migration's own lower bound",
    },
    {
      code: "YEAR_NOT_VALID",
      draft: withField({ taxYearText: String(FILED_941_MAX_YEAR + 1) }),
      why: "a year above the migration's own upper bound",
    },
    {
      code: "QUARTER_NOT_VALID",
      draft: withField({ quarterText: "5" }),
      why: "a fifth quarter, which does not exist",
    },
    {
      code: "QUARTER_NOT_VALID",
      draft: withField({ quarterText: "" }),
      why: "no quarter chosen at all",
    },
    {
      code: "AMOUNT_NOT_A_NUMBER",
      draft: withField({ line3Text: "eight hundred" }),
      why: "money written as words",
    },
    {
      code: "AMOUNT_NEGATIVE",
      draft: withField({ line3Text: "-800.00" }),
      why: "a negative withholding, which the column forbids",
    },
    {
      code: "FILED_ON_NOT_VALID",
      draft: withField({ filedOnText: "4/30/2027" }),
      why: "an ambiguous US-format date",
    },
    {
      code: "FILED_ON_NOT_VALID",
      draft: withField({ filedOnText: "2027-02-30" }),
      why: "a date that is not on the calendar",
    },
    {
      code: "FILED_ON_BEFORE_QUARTER_END",
      draft: withField({ filedOnText: "2027-02-01" }),
      why: "filed before the quarter it reports had even ended",
    },
    {
      code: "SOURCE_NOTE_MISSING",
      draft: withField({ sourceNoteText: "   " }),
      why: "a note of nothing but spaces",
    },
    {
      code: "ADDL_MEDICARE_EXCEEDS_TOTAL",
      draft: withField({ line5cAnd5dTaxText: "290.00", line5dAddlTaxText: "500.00" }),
      why: "a 5d part larger than the 5c+5d total it is part of",
    },
    {
      code: "SS_WAGES_EXCEED_MEDICARE_WAGES",
      draft: withField({ line5aWagesText: "20000.00", line5cWagesText: "10000.00" }),
      why: "social security wages above Medicare wages, which no quarter produces",
    },
  ];

  for (const c of CASES) {
    it(`refuses ${c.why} with ${c.code}`, () => {
      expect(refusalCodesOf(c.draft)).toContain(c.code);
    });
  }

  it("reaches every code in ALL_FILED_941_REFUSAL_CODES", () => {
    /*
     * THE COMPLETENESS CHECK.
     *
     * Without this, a tenth refusal code could be added to the union and to
     * the exported list and never be exercised by anything. The union would
     * grow, the list would grow, and the gate would keep passing - which is
     * standing rule 39 in its purest form.
     */
    const reached = new Set<string>();
    for (const c of CASES) for (const code of refusalCodesOf(c.draft)) reached.add(code);
    const unreached = ALL_FILED_941_REFUSAL_CODES.filter((c) => !reached.has(c));
    expect(unreached, `these refusal codes have no test that produces them: ${unreached.join(", ")}`).toEqual([]);
  });

  it("every refusal names a fix that is not 'correct the data'", () => {
    for (const c of CASES) {
      const res = validateFiledForm941Draft(c.draft);
      if (res.ok) throw new Error(`${c.why} was accepted`);
      for (const r of res.refusals) {
        expect(r.what.length, `${r.code} has no explanation`).toBeGreaterThan(20);
        expect(r.fix.length, `${r.code} has no fix`).toBeGreaterThan(20);
        // A "fix" that just says to fix it is the message Michael's complaint
        // about Sage is about: stopped, with nothing to act on.
        expect(r.fix.toLowerCase()).not.toMatch(/^(correct|fix) the (data|value|entry)\.?$/);
      }
    }
  });

  it("attaches each refusal to a real field of the draft, or to nothing", () => {
    const keys = new Set(Object.keys(EMPTY_FILED_941_DRAFT));
    for (const c of CASES) {
      const res = validateFiledForm941Draft(c.draft);
      if (res.ok) continue;
      for (const r of res.refusals) {
        if (r.field === null) continue;
        // A refusal attached to a field that does not exist renders nowhere.
        // The form filters by field name, so a typo here is a silent
        // disappearance rather than an error.
        expect(keys.has(r.field), `${r.code} points at unknown field ${String(r.field)}`).toBe(true);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  ALL FOUR WARNINGS ARE REACHABLE, AND NONE OF THEM BLOCK
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-48: every warning code is reachable and none of them refuse", () => {
  const CASES: readonly {
    readonly code: FiledForm941WarningCode;
    readonly draft: FiledForm941Draft;
    readonly why: string;
  }[] = [
    {
      code: "SS_TAX_NOT_TWELVE_POINT_FOUR",
      // The classic error: the EMPLOYEE half only, 6.2% instead of 12.4%.
      draft: withField({ line5aTaxText: "620.00" }),
      why: "social security tax entered as one half instead of both",
    },
    {
      code: "MEDICARE_TAX_NOT_TWO_POINT_NINE",
      draft: withField({ line5cAnd5dTaxText: "145.00" }),
      why: "Medicare tax entered as one half instead of both",
    },
    {
      code: "ENTIRELY_ZERO_RETURN",
      draft: withField({
        line3Text: "0.00",
        line5aWagesText: "0.00",
        line5aTaxText: "0.00",
        line5cWagesText: "0.00",
        line5cAnd5dTaxText: "0.00",
        line5dAddlTaxText: "0.00",
      }),
      why: "a return where every figure is zero",
    },
    {
      code: "FILED_VERY_LATE",
      draft: withField({ filedOnText: "2029-04-30" }),
      why: "a return filed two years after the quarter ended",
    },
  ];

  for (const c of CASES) {
    it(`warns about ${c.why} with ${c.code}`, () => {
      expect(warningCodesOf(c.draft)).toContain(c.code);
    });

    it(`stores ${c.why} anyway - a warning is not a refusal`, () => {
      /*
       * THE DISTINCTION THAT MAKES WARNINGS USEFUL.
       *
       * If a warning blocked the save, it would be a refusal with a softer
       * colour, and Michael could not record a return that was genuinely
       * filed late or genuinely zero. The whole point of this table is that it
       * records WHAT HAPPENED, including the things that were unusual.
       */
      const res = validateFiledForm941Draft(c.draft);
      expect(res.ok, `${c.code} blocked the save`).toBe(true);
    });
  }

  it("reaches every code in ALL_FILED_941_WARNING_CODES", () => {
    const reached = new Set<string>();
    for (const c of CASES) for (const code of warningCodesOf(c.draft)) reached.add(code);
    const unreached = ALL_FILED_941_WARNING_CODES.filter((c) => !reached.has(c));
    expect(unreached, `unreachable warning codes: ${unreached.join(", ")}`).toEqual([]);
  });

  it("does not warn about drift smaller than the stated tolerance", () => {
    /*
     * THE OTHER DIRECTION (rule 34).
     *
     * Line 7 exists because per-paycheque rounding makes the quarter's total
     * differ from the statutory computation by a few cents. If the tolerance
     * did not hold, this warning would fire on almost every real return and
     * would teach Michael to ignore it.
     */
    const oneCentOff = withField({ line5aTaxText: "1239.99" });
    expect(warningCodesOf(oneCentOff)).not.toContain("SS_TAX_NOT_TWELVE_POINT_FOUR");
    expect(FICA_PLAUSIBILITY_TOLERANCE_CENTS).toBeGreaterThan(0);
  });

  it("still warns once the drift exceeds the tolerance", () => {
    // Proves the tolerance is a threshold and not a blanket amnesty.
    const wellOver = withField({ line5aTaxText: "1200.00" });
    expect(warningCodesOf(wellOver)).toContain("SS_TAX_NOT_TWELVE_POINT_FOUR");
  });

  it("every warning says what it usually turns out to be", () => {
    for (const c of CASES) {
      const res = validateFiledForm941Draft(c.draft);
      if (!res.ok) throw new Error(`${c.why} was refused`);
      for (const w of res.warnings) {
        expect(w.what.length, `${w.code} has no explanation`).toBeGreaterThan(20);
        expect(
          w.whatItUsuallyIs.length,
          `${w.code} does not say what it usually is`,
        ).toBeGreaterThan(20);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE COLUMN MAP AGAINST THE MIGRATION ITSELF
 *
 * Rule 35: verbatim claims are checked MECHANICALLY. The map claims to mirror
 * migration 0204, and this reads the SQL rather than trusting the comment.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-48: the column map matches the migration it claims to mirror", () => {
  const SQL = read("supabase/migrations/0204_filed_form_941_totals.sql");

  it("every mapped column really exists in the migration", () => {
    /*
     * WHY A WRONG NAME HERE WOULD NOT ERROR LOUDLY.
     *
     * These are all bigint columns holding plausible money. A row written with
     * ss tax into the medicare column inserts cleanly, reads back cleanly, and
     * is simply wrong forever. Postgres cannot help; only this can.
     */
    for (const { column } of FILED_941_COLUMN_MAP) {
      expect(SQL, `${column} is mapped but is not in migration 0204`).toContain(column);
    }
  });

  it("maps every field of the validated row, so none can silently vanish", () => {
    const res = validateFiledForm941Draft(GOOD);
    if (!res.ok) throw new Error("baseline must validate");
    const mapped = new Set(FILED_941_COLUMN_MAP.map((m) => m.field));
    for (const key of Object.keys(res.value)) {
      expect(mapped.has(key as never), `${key} is validated but never written`).toBe(true);
    }
  });

  it("builds the insert row entirely through the map", () => {
    const res = validateFiledForm941Draft(GOOD);
    if (!res.ok) throw new Error("baseline must validate");
    const row = filedForm941Row(res.value);
    expect(Object.keys(row).sort()).toEqual(
      [...FILED_941_COLUMN_MAP.map((m) => m.column)].sort(),
    );
    // Spot-check that values travelled to the right columns rather than merely
    // that the key set matches - a transposed pair would satisfy the key check.
    expect(row.tax_year).toBe(2027);
    expect(row.quarter).toBe(1);
    expect(row.line_5a_ss_tax_cents).toBe(124_000);
    expect(row.source_note).toBe(GOOD.sourceNoteText);
  });

  it("uses no column the migration does not declare", () => {
    const declared = new Set(
      [...SQL.matchAll(/^\s{2}(?:add column if not exists\s+)?([a-z0-9_]+)\s+(?:uuid|integer|smallint|bigint|text|date|timestamptz)/gim)].map(
        (m) => m[1],
      ),
    );
    // The regex has to find something, or this test approves everything.
    expect(declared.size, "the migration parser matched no columns at all").toBeGreaterThan(8);
    for (const { column } of FILED_941_COLUMN_MAP) {
      expect(declared.has(column), `${column} is not declared in 0204`).toBe(true);
    }
  });

  it("mirrors the migration's own year bounds", () => {
    /*
     * `FILED_941_YEAR_BOUNDS_MATCH_MIGRATION` is the CONSTRAINT TEXT, not a
     * boolean - my first draft of this test asserted it was `true`, which was
     * my error and not the module's. The constant exists so the exact SQL can
     * be grepped for, which is stronger than a boolean would have been: a
     * boolean would have to be maintained by hand and could be left saying
     * true after the bounds diverged.
     */
    expect(SQL).toContain(FILED_941_YEAR_BOUNDS_MATCH_MIGRATION);
    // And the constant must really describe the constants the form enforces,
    // or it could match the SQL while the validator used different numbers.
    expect(FILED_941_YEAR_BOUNDS_MATCH_MIGRATION).toBe(
      `tax_year between ${FILED_941_MIN_YEAR} and ${FILED_941_MAX_YEAR}`,
    );
  });

  it("the code lists are complete and unique", () => {
    // Throws rather than returning a boolean (rule 48).
    expect(() => assertFiledForm941CodeListsAreWellFormed()).not.toThrow();
  });

  it("quarter ends are the real calendar quarter ends", () => {
    expect(quarterEndIso(2027, 1)).toBe("2027-03-31");
    expect(quarterEndIso(2027, 2)).toBe("2027-06-30");
    expect(quarterEndIso(2027, 3)).toBe("2027-09-30");
    expect(quarterEndIso(2027, 4)).toBe("2027-12-31");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE INDEPENDENCE OF THE TWO SIDES
 *
 * This is the section migration 0204 was written to demand. It checks the thing
 * that cannot be seen on screen: that the figures being compared came from two
 * different places.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-48: the two sides of the comparison stay independent", () => {
  const STORE = read("src/lib/payroll/form-941-confirmation-store.ts");
  const FORM = read("src/components/admin/books/FiledForm941EntryForm.tsx");
  const PAGE = read("src/app/admin/books/form-941/page.tsx");

  it("the entry form never imports the computed return", () => {
    /*
     * ═══ THE ASSERTION THIS WHOLE FEATURE RESTS ON. ═══
     *
     * The moment the form can see the computed figures, somebody will pre-fill
     * with them - it is the obvious kindness, it saves Michael typing, and it
     * silently destroys every check on the screen. Both sides would then
     * descend from one source and would agree trivially, always, including on
     * the quarter that was filed wrong.
     */
    expect(FORM).not.toContain("form-941-store");
    expect(FORM).not.toContain("loadForm941");
    expect(FORM).not.toContain("form941Boxes");
    expect(FORM).not.toContain("form-941-core");
  });

  it("the store writes only to the filed table", () => {
    expect(STORE).toContain('"filed_form_941_totals"');
    // It must not write anywhere else - a write to the pay run tables from the
    // confirmation path would make the "independent" record derived after all.
    expect(STORE).not.toContain("payroll_run_lines");
    expect(STORE).not.toContain("payroll_ytd_accumulators");
  });

  it("the store is server-only, because it writes filed federal returns", () => {
    expect(STORE).toContain('import "server-only"');
  });

  it("the page passes the FILED figures into the checks, not the computed ones", () => {
    /*
     * ═══ WHY THIS SEARCHES FOR `form941Checks(` AND NOT `checks={form941Checks(` ═══
     *
     * The original assertion looked for the literal `checks={form941Checks(`,
     * which pinned the CALL SITE'S PUNCTUATION rather than the behaviour it
     * cares about. books-49 had to make the explorer render unconditionally
     * (the tabs were nested inside `{result.ok ? ... : null}` and therefore
     * invisible until Greenway's first payroll in January 2027), and the checks
     * prop legitimately became:
     *
     *     checks={result.ok ? form941Checks(result, filedForThisQuarter) : []}
     *
     * which is the same wiring with a guard in front of it - a reconciliation
     * needs a computed return on one side, so when the engine refused there is
     * genuinely nothing to reconcile.
     *
     * The old assertion failed on that, and the tempting "fix" was to widen the
     * string until it passed. That would have been fitting the test to the code.
     * Instead the assertion now states the thing that actually matters and is
     * unchanged: wherever `form941Checks` is called, the FILED figures are what
     * is handed to it. If someone ever passes the computed return on both sides,
     * this still fails - which is the whole point of the books-48 gate.
     */
    const at = PAGE.indexOf("form941Checks(");
    expect(at, "the 941 page no longer wires the Check tab").toBeGreaterThan(-1);
    const call = PAGE.slice(at, at + 120);
    expect(call).toContain("filedForThisQuarter");
    // And it is still passed as the `checks` prop rather than merely computed
    // and dropped, which would be a call with no rendering behind it.
    expect(PAGE).toContain("checks={");
  });

  it("the page reads the filed figures from the confirmation store", () => {
    expect(PAGE).toContain("loadRecordedForm941Quarters");
  });

  it("a quarter with nothing recorded is passed as null, never as zeroes", () => {
    /*
     * WHY THIS MATTERS MORE THAN IT LOOKS.
     *
     * Zeroes would make every row disagree by the entire return and scream
     * about a catastrophe that has not happened - and after the second false
     * alarm nobody reads the rows again.
     */
    expect(PAGE).toMatch(/filedForThisQuarter[\s\S]{0,200}\?\?\s*null/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE CHECK ROWS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-48: the check rows compare what they claim to compare", () => {
  /**
   * A minimal computed return, built by hand rather than by the engine.
   *
   * Deliberately NOT produced by `buildForm941`: this section is testing
   * `form941Checks`, and feeding it engine output would mean a change in the
   * engine could silently change what this test is asserting.
   */
  const ret = {
    ok: true as const,
    quarterLabel: "Q1 2027",
    lines: [
      { line: "3", amountCents: 80_000 },
      { line: "5a", amountCents: 124_000 },
      { line: "5c", amountCents: 29_000 },
      { line: "12", amountCents: 233_000 },
    ],
    /*
     * THE TWO WAGE FIGURES ARE NOT LINES, AND LEAVING THEM OUT WAS MY BUG.
     *
     * `form941Checks` reads `oasdiTaxableWagesCents` and
     * `medicareTaxableWagesCents` off the return object directly, because
     * column 1 of lines 5a and 5c is a WAGE BASE rather than a tax and the
     * engine carries it separately. My first draft of this fixture omitted
     * them, so two rows compared a real filed figure against `undefined` and
     * the "identical figures agree" test failed - correctly. Worth recording:
     * the test was wrong and the module was right, which is the outcome a gate
     * is supposed to be able to produce.
     */
    oasdiTaxableWagesCents: 1_000_000,
    medicareTaxableWagesCents: 1_000_000,
  };

  const filed = {
    quarter: 1,
    filedOn: "2027-04-30",
    sourceNote: "Aatrix Q1 2027",
    line3FederalIncomeTaxCents: 80_000,
    line5aSsWagesCents: 1_000_000,
    line5aSsTaxCents: 124_000,
    line5cMedicareWagesCents: 1_000_000,
    line5c5dMedicareTaxCents: 29_000,
    line5dAddlMedicareTaxCents: 0,
  };

  it("produces rows when nothing has been recorded, and none of them agree", () => {
    /*
     * A MISSING RECORD MUST NOT LOOK LIKE AGREEMENT.
     *
     * The tempting implementation returns no rows when there is nothing to
     * compare, and an empty Check tab reads as "nothing to worry about". The
     * rows must exist and must SAY that the comparison has not been made.
     */
    const rows = form941Checks(ret as never, null);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tone, `a row went green with nothing to compare against`).not.toBe("green");
    }
  });

  it("reports an unsupplied figure as absent, never as a zero to compare", () => {
    /*
     * ═══ THE HOLE THE MUTATION CAMPAIGN FOUND. ═══
     *
     * scripts/prove-941-confirmation.sh mutation 8 changed
     *
     *     rightCents: filed?.line3FederalIncomeTaxCents ?? null
     * to
     *     rightCents: filed?.line3FederalIncomeTaxCents ?? 0
     *
     * and the gate still passed. Every assertion in this section happened to
     * be about tone, and a zero against a real figure produces a DISAGREEMENT,
     * which is not green - so nothing noticed that the row had stopped saying
     * "not supplied" and started asserting that the IRS was told zero.
     *
     * That is the exact defect `checkRow` documents as the most tempting one
     * to introduce: "treating the missing side as zero makes the two sides
     * differ by the whole amount and reports a catastrophe". The distinction
     * is carried by `outcome` and by `rightCents` being null, so those are
     * what must be asserted. Recorded here because a hole found by mutation is
     * the only kind of hole anybody ever finds.
     */
    const rows = form941Checks(ret as never, null);
    for (const row of rows) {
      expect(
        row.rightCents,
        `${row.title} invented a figure for a return nobody has recorded`,
      ).toBeNull();
      expect(
        row.outcome,
        `${row.title} claims a comparison was performed against nothing`,
      ).toBe("cannot_check");
      expect(
        row.differenceCents,
        `${row.title} computed a difference from a figure that does not exist`,
      ).toBeNull();
    }
  });

  it("still reports absence when only ONE figure is missing", () => {
    /*
     * The partial case, which is the one that actually happens: a row was
     * written by an older version, or a column was added later. The rows with
     * data must compare, and the row without must say so - not quietly read
     * as zero because its neighbours were fine.
     */
    const partial = { ...filed, line3FederalIncomeTaxCents: null } as unknown as typeof filed;
    const rows = form941Checks(ret as never, partial);
    const line3 = rows.find((r) => r.title.includes("Line 3"));
    expect(line3, "the line 3 row vanished").toBeDefined();
    expect(line3?.rightCents, "a null figure was compared as zero").toBeNull();
    expect(line3?.outcome).toBe("cannot_check");
  });

  it("says how to fix it rather than merely that it is missing", () => {
    const rows = form941Checks(ret as never, null);
    const joined = rows.map((r) => r.meaning).join(" ");
    expect(joined).toMatch(/has not been recorded yet/i);
    // And it must explain WHY it is typed in by hand, because otherwise the
    // instruction looks like pointless duplicate data entry and gets skipped.
    expect(joined).toMatch(/comparing itself to itself/i);
  });

  it("agrees when the filed figures match the computed ones", () => {
    const rows = form941Checks(ret as never, filed);
    expect(rows.length).toBeGreaterThan(0);
    const disagreeing = rows.filter((r) => r.tone === "danger");
    expect(
      disagreeing.map((r) => r.title),
      "identical figures produced a disagreement",
    ).toEqual([]);
  });

  it("disagrees when a single figure is transposed", () => {
    /*
     * THE GATE, DRIVEN BROKEN (rule 83).
     *
     * 80,000 becomes 08,000 - a digit transposition, which is the error this
     * whole screen exists to catch. If this passes with a green row, the
     * feature is decoration.
     */
    const rows = form941Checks(ret as never, {
      ...filed,
      line3FederalIncomeTaxCents: 8_000,
    });
    const flagged = rows.filter((r) => r.tone === "danger");
    expect(flagged.length, "a transposed figure was not flagged").toBeGreaterThan(0);
  });

  it("totals the filed tax from its three components", () => {
    expect(filedTotalTax(filed)).toBe(80_000 + 124_000 + 29_000);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  THE LESSONS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-48: the confirmation lessons teach, and cite real authority", () => {
  it("is well formed by its own assertion", () => {
    expect(() => assertForm941ConfirmationLessonsAreWellFormed()).not.toThrow();
  });

  it("has a lesson for each question the step raises", () => {
    expect(FORM_941_CONFIRMATION_LESSONS.length).toBeGreaterThanOrEqual(4);
    const boxes = FORM_941_CONFIRMATION_LESSONS.map((l) => l.box);
    expect(new Set(boxes).size, "two lessons share a box key").toBe(boxes.length);
  });

  it("uses its own form id, so it cannot shadow a real 941 line lesson", () => {
    /*
     * Rule 50. If these lessons carried formId "form_941", `lessonFor` would
     * match them against line numbers on the actual return and one of the two
     * sets would silently never render.
     */
    expect(FILED_941_FORM_ID).toBe("filed_941");
    for (const l of FORM_941_CONFIRMATION_LESSONS) {
      expect(l.formId).toBe(FILED_941_FORM_ID);
    }
  });

  it("answers the question a person actually has: why type this at all", () => {
    const all = FORM_941_CONFIRMATION_LESSONS.map(
      (l) => `${l.headline} ${l.plainEnglish} ${l.howToReadIt} ${l.whatToDo}`,
    ).join(" ");
    expect(all).toMatch(/independent|two sides|itself/i);
  });

  it("every lesson carries at least one worked example and one quote", () => {
    for (const l of FORM_941_CONFIRMATION_LESSONS) {
      expect(l.examples.length, `${l.box} teaches without an example`).toBeGreaterThan(0);
      expect(l.quotes.length, `${l.box} asserts without an authority`).toBeGreaterThan(0);
    }
  });

  it("every quote points at a mirrored corpus file that exists", () => {
    /*
     * WHY THIS IS HERE RATHER THAN LEFT TO THE CENTRAL VERIFIER.
     *
     * `scripts/verify-verbatim-quotes.ts` walks the AUTHORITY REGISTRIES. A
     * quote hand-typed into a lesson file is not in a registry, so the central
     * verifier never sees it - which is precisely how the four Form 941 cites
     * repaired earlier in this slice went eight slices unverified. Every quote
     * in the lessons file is therefore REUSED from a registry authority, and
     * this asserts the source path is one of the two mirrored files rather
     * than a plausible-looking string.
     */
    const allowed = new Set([FORM_941_SOURCE_PATH, FORM_W2_SOURCE_PATH]);
    for (const l of FORM_941_CONFIRMATION_LESSONS) {
      for (const q of l.quotes) {
        expect(
          allowed.has(q.sourcePath),
          `${l.box} quotes ${q.sourcePath}, which is not a mirrored corpus file`,
        ).toBe(true);
      }
    }
  });

  it("every quote is verbatim in the mirrored corpus", () => {
    /*
     * THE MECHANICAL CHECK (rule 35).
     *
     * Read the corpus and look for the text. Normalisation is deliberately
     * NARROW - curly quotes and whitespace only - because folding dashes is
     * exactly what let three wrong transcriptions survive in the central
     * verifier for eight slices.
     */
    const corpora = new Map<string, string>();
    const normalise = (s: string) =>
      s
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/\s+/g, " ")
        .trim();

    let checked = 0;
    for (const l of FORM_941_CONFIRMATION_LESSONS) {
      for (const q of l.quotes) {
        if (!corpora.has(q.sourcePath)) {
          corpora.set(q.sourcePath, normalise(read(q.sourcePath)));
        }
        const corpus = corpora.get(q.sourcePath) as string;
        // Segments split on the elision marker, so a quote may skip material
        // as long as each retained run appears in order.
        const segments = normalise(q.quote)
          .split(/\s*\.\.\.\s*/)
          .filter((s) => s.length > 0);
        let from = 0;
        for (const seg of segments) {
          const at = corpus.indexOf(seg, from);
          expect(
            at,
            `${l.box}: this text is not in ${q.sourcePath} as written:\n  ${seg}`,
          ).toBeGreaterThan(-1);
          from = at + seg.length;
        }
        checked += 1;
      }
    }
    // Rule 39: if nothing was checked, the loop above approved everything.
    expect(checked, "no lesson quotes were checked at all").toBeGreaterThan(0);
  });

  it("rejects a fabricated quote, or the check above proves nothing", () => {
    // The inverse direction (rule 34). If this invented sentence were found,
    // the search is not actually searching.
    const corpus = read(FORM_941_SOURCE_PATH);
    expect(corpus).not.toContain(
      "Employers must confirm each quarterly return against the payroll ledger before filing.",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §8  THE SCREEN AND THE SERVER ACTION
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
 * books-55 — THE GATE THE books-48 DOCBLOCK PROMISED AND NOBODY WROTE.
 *
 * The comment above the figures read off Michael's filed 2025 W-2 said "a gate
 * multiplies these out and checks the answers". There was no gate.
 * `grep -rn "MICHAEL_2025" --include=*.ts .` returned three lines: the three
 * declarations. Nothing imported them. Meanwhile the worked example re-typed the
 * same amounts as prose inside strings, so the repository held two copies of
 * every figure and read neither.
 *
 * That is standing rule 39 exactly — a verifier that cannot see something has
 * approved it — with an aggravating feature: the false comment actively told the
 * next reader to stop checking.
 *
 * These tests exist so the replacement gate is not the same promise twice.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("books-55: the as-filed figures are recomputed, not merely restated", () => {
  /** The real figures, and prose that satisfies every branch. */
  const GOOD: AsFiledW2Figures = {
    ssWagesCents: AS_FILED_2025_SS_WAGES_CENTS,
    box4Cents: AS_FILED_2025_BOX_4_CENTS,
    box6Cents: AS_FILED_2025_BOX_6_CENTS,
    box14HealthCents: AS_FILED_2025_BOX_14_HEALTH_CENTS,
  };

  /**
   * Built from the module's own real lesson, so these negatives are mutations of
   * the SHIPPING text rather than of a convenient fixture. A fixture would let
   * the tests pass while the real prose rotted, which is the whole defect class
   * under repair here.
   */
  function realProse(): string {
    const doubling = FORM_941_CONFIRMATION_LESSONS.find((l) => l.box === "doubling");
    expect(doubling, "the doubling lesson carries the worked example").toBeDefined();
    return doubling!.examples.flatMap((e) => [...e.steps, e.answer, e.moral]).join(" \u0001 ");
  }

  it("passes on the figures and prose the module actually ships", () => {
    expect(() => assertAsFiledFiguresReconcile()).not.toThrow();
    expect(() => checkAsFiledFigures(GOOD, realProse())).not.toThrow();
  });

  it("recomputes box 4 from box 3 at 6.2% and rejects a mistyped cent", () => {
    /*
     * This is the check the false comment claimed existed. $53,530.16 x 6.2% is
     * $3,318.87 and the filed W-2 says $3,318.87 - they agree to the cent, which
     * is how we know FICA was computed on the FULL amount including the health
     * premium. That agreement is a FACT ABOUT WHAT WAS FILED, not a blessing of
     * it; see the separate open-question tests below.
     */
    expect(() =>
      checkAsFiledFigures({ ...GOOD, box4Cents: GOOD.box4Cents + 1 }, realProse()),
    ).toThrow(/do not reconcile/);
  });

  it("recomputes box 6 from box 5 at 1.45%", () => {
    expect(() =>
      checkAsFiledFigures({ ...GOOD, box6Cents: GOOD.box6Cents - 19 }, realProse()),
    ).toThrow(/at 1\.45%/);
  });

  it("refuses a zeroed health premium, because the whole question rests on it", () => {
    expect(() => checkAsFiledFigures({ ...GOOD, box14HealthCents: 0 }, realProse())).toThrow(
      /only exists because the premium is a real, positive amount/,
    );
  });

  it("catches a figure that disappears from the prose", () => {
    const gutted = realProse().replaceAll("$30,980.16", "some amount");
    expect(() => checkAsFiledFigures(GOOD, gutted)).toThrow(/no longer mentions \$30,980\.16/);
  });

  it("catches a typo in ONE of the seven places a figure is repeated", () => {
    /*
     * ═══ THIS TEST EXISTS BECAUSE THE FIRST VERSION OF THE GATE FAILED IT. ═══
     *
     * The gate originally asked only whether each figure appeared SOMEWHERE in
     * the prose. The wage figure appears seven times in this example, so a
     * mutation that corrupted one copy left six intact and the gate went green
     * on a lesson that now contradicted itself on screen, in front of Michael.
     *
     * "At least one copy is right" is not the property worth having. The fix was
     * to check in BOTH directions: every derived figure must appear, and every
     * dollars-and-cents figure in the prose must be derivable. A typo is then
     * caught as an UNRECOGNISED figure rather than missed as a surviving one.
     */
    const oneTypo = realProse().replace("$53,530.16", "$53,530.99");
    expect(oneTypo, "the mutation must actually change the text").not.toBe(realProse());
    expect(oneTypo).toContain("$53,530.16"); // six copies still intact
    expect(() => checkAsFiledFigures(GOOD, oneTypo)).toThrow(/cannot derive/);
  });

  it("rejects a plausible but underivable figure rather than trusting it", () => {
    const invented = `${realProse()} And the total came to $9,999.99.`;
    expect(() => checkAsFiledFigures(GOOD, invented)).toThrow(/\$9,999\.99, which this gate/);
  });

  it("ignores round statutory thresholds, which are not computed from his payroll", () => {
    /*
     * $200,000 (the Additional Medicare threshold) and $7,000 (the FUTA base)
     * appear in this teaching material and are NOT derivable from Michael's
     * figures - they are quoted from statute and verified against the mirrored
     * corpus elsewhere. The gate deliberately matches only amounts written with
     * cents, so it must not fire on these.
     */
    const withThresholds = `${realProse()} Nobody is near $200,000 and FUTA stops at $7,000.`;
    expect(() => checkAsFiledFigures(GOOD, withThresholds)).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * books-55 — A FILED FORM IS EVIDENCE, NEVER AUTHORITY.
 *
 * Michael stopped the previous slice to say this, and he was right to:
 *
 *   "it was me that produced all the w-2s and w-3 for my business, not my
 *    grandfather. It's very likely I did it wrong... I want true accuracy, not
 *    taking my bad form filling and calling it source material."
 *
 * The lesson had been asserting, in the indicative, that his box 1 was larger
 * than his box 3 because the health premium is "carved out of FICA". On the form
 * he actually filed, boxes 1, 3 and 5 are all $53,530.16 - the premium went
 * THROUGH FICA. So the teaching material described a form that does not exist
 * and, worse, presented the outcome as automatic when §3121(a)(2) makes it
 * conditional on a plan or system covering employees generally or a class of
 * them. Nobody has produced such a plan for Greenway.
 *
 * These tests keep the question open. They are the only assertions in this file
 * about MEANING rather than arithmetic, and that is deliberate: the arithmetic
 * can be settled by multiplication, and this cannot be settled by us at all.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("books-55: the lesson states the law and flags the open question", () => {
  const GOOD: AsFiledW2Figures = {
    ssWagesCents: AS_FILED_2025_SS_WAGES_CENTS,
    box4Cents: AS_FILED_2025_BOX_4_CENTS,
    box6Cents: AS_FILED_2025_BOX_6_CENTS,
    box14HealthCents: AS_FILED_2025_BOX_14_HEALTH_CENTS,
  };

  function realProse(): string {
    const doubling = FORM_941_CONFIRMATION_LESSONS.find((l) => l.box === "doubling");
    return doubling!.examples.flatMap((e) => [...e.steps, e.answer, e.moral]).join(" \u0001 ");
  }

  it("names the statute and its condition, not just the conclusion", () => {
    const prose = realProse();
    expect(prose).toContain("3121(a)(2)");
    expect(prose.toLowerCase()).toContain("plan or system");
  });

  it("refuses prose that drops the statute, leaving a bare conclusion", () => {
    const stripped = realProse().replaceAll("3121(a)(2)", "the rules");
    expect(() => checkAsFiledFigures(GOOD, stripped)).toThrow(
      /must name section 3121\(a\)\(2\) AND the words "plan or system"/,
    );
  });

  it("refuses prose that drops the plan-or-system condition", () => {
    const stripped = realProse().replaceAll("plan or system", "arrangement");
    expect(() => checkAsFiledFigures(GOOD, stripped)).toThrow(/plan or system/);
  });

  it('refuses the old claim that the premium is simply "carved out of FICA"', () => {
    /*
     * The exact wording that used to ship. Pinned as a string so that if anyone
     * reintroduces it - including a future me, tidying - the build stops and
     * says why.
     */
    const regressed = `${realProse()} The premium is income-taxable but carved out of FICA.`;
    expect(() => checkAsFiledFigures(GOOD, regressed)).toThrow(/It is not a plain fact/);
  });

  it("reports what the form shows without deciding whether it was right", () => {
    /*
     * The lesson must tell Michael the premium WAS run through FICA - that is an
     * observation off his own paperwork and he needs it. What it must not do is
     * announce a verdict. So: the observation is required to be present, and the
     * words that would settle the legal question are required to be absent.
     */
    const prose = realProse();
    expect(prose).toContain("$30,980.16");
    expect(prose).toMatch(/boxes 1, 3 and 5 are all the same/);
    expect(prose).toMatch(/Nicholas Mullan/);
    // No verdict. The condition is a fact about Greenway nobody has evidenced.
    expect(prose.toLowerCase()).not.toMatch(/you (over)?paid too much|was wrong|is incorrect/);
    expect(prose).toMatch(/Do not change anything on the strength of this note/);
  });

  it("warns that the same answer moves the 941s and the 940 too", () => {
    /*
     * §3121(a)(2) and §3306(b)(2) carry the same plan-or-system condition, so
     * one answer governs the W-2 boxes 3 and 5, the 941 lines 5a and 5c, and the
     * 940 line 3. A lesson that fixed only the W-2 would leave two forms
     * inconsistent with it - which is a worse position than the one he is in.
     */
    const prose = realProse();
    expect(prose).toMatch(/also moves your 941s and your 940/);
  });
});

describe("books-48: the confirmation step is actually reachable on the screen", () => {
  const PAGE = read("src/app/admin/books/form-941/page.tsx");
  const ACTION = read("src/app/admin/books/form-941/actions.ts");
  const PANEL = read("src/components/admin/books/FiledForm941ConfirmationPanel.tsx");

  it("the page renders the confirmation panel", () => {
    // Rule 50: a form nothing renders is a form nobody can fill in, and the
    // whole feature would be dead code passing its unit tests.
    expect(PAGE).toContain("FiledForm941ConfirmationPanel");
  });

  it("the panel renders both the lessons and the entry form", () => {
    expect(PANEL).toContain("FORM_941_CONFIRMATION_LESSONS");
    expect(PANEL).toContain("FiledForm941EntryForm");
  });

  it("the server action checks access before it does anything else", () => {
    /*
     * A server action is a PUBLIC HTTP ENDPOINT, and the store uses the
     * service role, which ignores the owner-only RLS policy on this table. So
     * this one call is the entire protection on this path.
     */
    expect(ACTION).toContain("requireBooksAccess()");
    const gate = ACTION.indexOf("await requireBooksAccess()");
    const write = ACTION.indexOf("saveFiledForm941(");
    expect(gate, "the action does not gate access at all").toBeGreaterThan(-1);
    expect(write, "the action does not save anything").toBeGreaterThan(-1);
    expect(gate, "access is checked AFTER the write").toBeLessThan(write);
  });

  it("the server action revalidates the page so the checks stop saying 'not recorded'", () => {
    expect(ACTION).toContain("revalidatePath");
  });

  it("the server action returns problems instead of throwing them", () => {
    // A thrown error renders an error boundary: a blank screen with no
    // indication whether the write happened.
    expect(ACTION).not.toMatch(/\bthrow new Error\b/);
    expect(ACTION).toContain("ok: false");
  });

  it("the entry form uses text inputs, not number inputs", () => {
    /*
     * `type="number"` discards what it cannot parse BEFORE any code sees it,
     * so "1,234.56" can arrive as an empty string and the refusal would read
     * "this is not a number" about a box that visibly contains one.
     */
    const FORM = read("src/components/admin/books/FiledForm941EntryForm.tsx");
    /*
     * SEARCHED WITH THE JSX BRACE, NOT AS BARE TEXT.
     *
     * My first draft grepped for `type="number"` anywhere in the file and
     * failed - on the COMMENT that explains why number inputs are not used.
     * A gate that cannot tell an attribute from a sentence about that
     * attribute would forbid documenting the decision, which is the opposite
     * of what this repository wants. Stripping block comments first means the
     * assertion is about the markup only.
     */
    const code = FORM.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toContain('type="number"');
    expect(code).toContain('type="text"');
    // Rule 39: if the strip removed everything, the assertion above is vacuous.
    expect(code.length, "comment stripping removed the whole file").toBeGreaterThan(2000);
  });

  it("the entry form shows the fix for every refusal, not just the complaint", () => {
    const FORM = read("src/components/admin/books/FiledForm941EntryForm.tsx");
    expect(FORM).toContain("r.what");
    expect(FORM).toContain("r.fix");
  });

  it("every refusal attaches to a field this form renders an input for", () => {
    /*
     * ═══ THE ASSERTION THAT REPLACED A DEAD PANEL. ═══
     *
     * The first draft of the form carried a general-refusal panel for
     * refusals with `field: null`. It could never render: every refusal the
     * core produces names a field. That is rule 40 - an unreachable guard is
     * an untested guard - so the panel was deleted and this took its place.
     *
     * This is the assertion that actually protects Michael. It walks every
     * refusal reachable in §2 and proves the form contains an input bound to
     * the field it names. A refusal pointing at a field with no input would
     * block the save while displaying NOTHING, which is the worst screen in
     * the building, and it would do so silently.
     */
    const FORM = read("src/components/admin/books/FiledForm941EntryForm.tsx");
    const drafts = [
      withField({ taxYearText: "nope" }),
      withField({ quarterText: "9" }),
      withField({ line3Text: "eight hundred" }),
      withField({ line3Text: "-1.00" }),
      withField({ filedOnText: "4/30/2027" }),
      withField({ filedOnText: "2027-02-01" }),
      withField({ sourceNoteText: "  " }),
      withField({ line5cAnd5dTaxText: "290.00", line5dAddlTaxText: "500.00" }),
      withField({ line5aWagesText: "20000.00", line5cWagesText: "10000.00" }),
    ];

    const fieldsSeen = new Set<string>();
    for (const d of drafts) {
      const res = validateFiledForm941Draft(d);
      if (res.ok) continue;
      for (const r of res.refusals) {
        expect(
          r.field,
          `${r.code} has no field, but the form has no panel for unattached refusals`,
        ).not.toBeNull();
        fieldsSeen.add(String(r.field));
      }
    }

    // Rule 39: if the loop above collected nothing it approved everything.
    expect(fieldsSeen.size, "no refusals were produced at all").toBeGreaterThan(4);

    for (const field of fieldsSeen) {
      // The form filters refusals by field name, so an input must exist for
      // the message to have somewhere to appear.
      expect(
        FORM.includes(`refusalsFor(refusals, "${field}")`),
        `${field} can be refused but the form never renders that refusal`,
      ).toBe(true);
    }
  });

  it("renders the one warning that genuinely has no field", () => {
    /*
     * ENTIRELY_ZERO_RETURN carries `field: null` - it is about the whole
     * return, and there is no single box to blame. So unlike the refusal
     * panel, the general WARNING panel really does reach, and this proves it
     * rather than assuming it (rule 40 in the other direction).
     */
    const FORM = read("src/components/admin/books/FiledForm941EntryForm.tsx");
    expect(FORM).toMatch(/w\.field === null/);

    const zero = withField({
      line3Text: "0.00",
      line5aWagesText: "0.00",
      line5aTaxText: "0.00",
      line5cWagesText: "0.00",
      line5cAnd5dTaxText: "0.00",
      line5dAddlTaxText: "0.00",
    });
    const res = validateFiledForm941Draft(zero);
    if (!res.ok) throw new Error("the all-zero return must be accepted, not refused");
    const general = res.warnings.filter((w) => w.field === null);
    expect(
      general.length,
      "no warning is general, so the general warning panel is dead code",
    ).toBeGreaterThan(0);
  });
});
