/**
 * tests/compliance/form-w2-store.test.ts   (books-46 slice A)
 *
 * THE GATE OVER THE W-2 STORE - the layer between the database rows and the
 * wage report that goes to the Social Security Administration.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS SEPARATELY FROM THE ENGINE TESTS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `form-w2-core.ts` is proven to build a W-2 correctly. That proof is worth
 * nothing if the rows handed to it are the wrong rows. Standing rule 63d says
 * the handoff is where the defect lives, and writing this store proved it twice
 * over:
 *
 *   1. `reconcileW3To941s` HAD NO CALLER IN src/. Two callers in tests, none in
 *      the application. The single most important function on the W-2 screen -
 *      the one that answers the only question a W-2 can still get wrong - was
 *      unreachable from the running program, and the suite was green because
 *      the tests supplied the input the program could not build. Standing rule
 *      50, dead code wearing a green check. Migration 0204 is the fix.
 *
 *   2. BOX 14's WASHINGTON FIGURES WERE NOT IN THE ACCUMULATOR. PFML and WA
 *      Cares appear in `payroll_ytd_accumulators` only as WAGES; the amounts
 *      actually withheld exist solely on `payroll_run_lines`. A store that read
 *      only the accumulator would have shipped a W-2 with an empty box 14 and
 *      no indication anything was missing.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT IS ASSERTED HERE THAT THE ENGINE CANNOT ASSERT ABOUT ITSELF
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   - The pure mappers (`toAccumulator`, `requiredBigint`, `summariseFiled`,
 *     `boxFourteenEntries`, `reconciliationReadiness`) refuse or report unknown
 *     rather than defaulting.
 *   - SOURCE-LEVEL rules that no runtime test can reach without a live
 *     database: that the "filed" side of the reconciliation is READ and never
 *     COMPUTED, that the employee query is not filtered on `active`, that
 *     voided pay runs are excluded, that `full_name` is never split into a
 *     legal name, and that the store's return type cannot carry a full SSN.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE STAKES
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * This layer decides who gets a W-2 and what it says. A person this layer fails
 * to select is not an error on a screen - it is a missing federal information
 * return, penalised per form under IRC 6721 and again under IRC 6722, and the
 * omission is invisible precisely because the form that would have shown it is
 * the form that does not exist.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  boxFourteenEntries,
  reconciliationReadiness,
  requiredBigint,
  summariseFiled,
  toAccumulator,
  type AccumulatorRow,
  type BoxFourteenTotals,
  type FiledRow,
} from "@/lib/payroll/form-w2-store";

const REPO = join(__dirname, "..", "..");
const STORE_PATH = join(REPO, "src", "lib", "payroll", "form-w2-store.ts");
const storeSrc = readFileSync(STORE_PATH, "utf8");

/**
 * The source with comments stripped, so a rule merely DESCRIBED in prose cannot
 * satisfy a test looking for the rule IMPLEMENTED in code.
 *
 * This matters more here than almost anywhere else in the repo: this store's
 * header explains at length why the filed-941 side must never be computed from
 * pay runs. Without stripping, that very explanation would satisfy a test
 * looking for the absence of such a computation, while the computation sat ten
 * lines below it.
 */
const storeCode = storeSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the comment-stripping helper actually strips (rule 39)", () => {
  it("leaves real code behind and removes prose", () => {
    // If this ever produced an empty string, every source-level assertion below
    // would pass vacuously - which is the exact failure this suite is written
    // to prevent elsewhere.
    expect(storeCode.length).toBeGreaterThan(1_000);
    expect(storeCode).toContain("export async function loadW2s");
    // A phrase that appears ONLY inside the block comments must be gone.
    // A phrase that appears ONLY inside the block comments must be gone. It is
    // asserted present in the raw source first, so that this check cannot pass
    // by the phrase having been edited away - which is how a stripping test
    // quietly stops testing stripping.
    expect(storeSrc).toContain("connected to nothing");
    expect(storeCode).not.toContain("connected to nothing");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * §1  requiredBigint - the bigint that arrives as a string
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("requiredBigint", () => {
  it("reads a PostgREST bigint string as an integer", () => {
    // Postgres bigint arrives over the wire as a STRING. Reading it with a bare
    // Number() and not saying so is how a money column becomes a float.
    expect(requiredBigint("900000", "t", "c", "who")).toBe(900_000);
  });

  it("reads a plain number unchanged", () => {
    expect(requiredBigint(900_000, "t", "c", "who")).toBe(900_000);
  });

  it("accepts zero, because zero is a real wage figure", () => {
    // CONTROL for the refusals below (rule 55). A helper that threw on
    // everything falsy would pass every rejection test and be useless: an
    // employee hired in December really can have zero of some figure.
    expect(requiredBigint(0, "t", "c", "who")).toBe(0);
    expect(requiredBigint("0", "t", "c", "who")).toBe(0);
  });

  it("accepts a negative, because a correcting figure can be negative", () => {
    // The store does not decide sign policy; the migrations' CHECK constraints
    // and the engine do. A reader that silently rejected negatives would be
    // enforcing a rule in a third place.
    expect(requiredBigint(-500, "t", "c", "who")).toBe(-500);
  });

  it("REFUSES null, naming the table, the column and who it was for", () => {
    // Not "returns 0". A null in a not-null column does not mean unknown, it
    // means the row is not the shape the schema promises - and zero there looks
    // exactly like an employee who has not been paid yet.
    expect(() =>
      requiredBigint(null, "payroll_ytd_accumulators", "oasdi_wages_cents", "employee e1"),
    ).toThrow(/payroll_ytd_accumulators\.oasdi_wages_cents/);
    expect(() => requiredBigint(null, "t", "c", "employee e1")).toThrow(/employee e1/);
  });

  it("explains WHY zero would be dangerous, in the message Michael sees", () => {
    // A refusal without a reason is an obstacle. This one has to explain that
    // the wrong answer is plausible, because that is what makes it dangerous.
    expect(() => requiredBigint(null, "t", "c", "w")).toThrow(/not been paid yet/);
    expect(() => requiredBigint(null, "t", "c", "w")).toThrow(/[Nn]othing was assumed/);
  });

  it("REFUSES a non-integer, because every money figure is whole cents", () => {
    expect(() => requiredBigint(1234.5, "t", "c", "w")).toThrow(/not a whole number/);
    expect(() => requiredBigint("12.34", "t", "c", "w")).toThrow(/not a plain integer/);
  });

  it("REFUSES text that is not a number at all", () => {
    expect(() => requiredBigint("abc", "t", "c", "w")).toThrow(/not a plain integer/);
    expect(() => requiredBigint("1_000", "t", "c", "w")).toThrow(/not a plain integer/);
    expect(() => requiredBigint("Infinity", "t", "c", "w")).toThrow(/not a plain integer/);
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * THE TWO DEFECTS THIS FUNCTION SHIPPED WITH, EACH PINNED BY A TEST
   *
   * This file's first run is what found them. The original body guarded with
   * `Number.isFinite(n) && Number.isInteger(n)`, which reads like a thorough
   * check and is not, and the same body had been written independently in six
   * stores. The tests below are the ones that failed, and they stay here as
   * the reason the shared reader is allowed to be trusted.
   * ───────────────────────────────────────────────────────────────────────── */

  it("REFUSES a blank, which the original guard read as zero", () => {
    // DEFECT 1. `Number("")` is 0, not NaN. The old guard therefore accepted an
    // empty string and returned a zero - the precise wrong answer its own
    // comment said was the most dangerous one available, because zero wages is
    // indistinguishable from an employee who has not been paid yet this year.
    expect(() => requiredBigint("", "t", "c", "w")).toThrow(/blank is not a zero/);
    expect(() => requiredBigint("   ", "t", "c", "w")).toThrow(/blank is not a zero/);
    expect(() => requiredBigint("\t\n", "t", "c", "w")).toThrow(/blank is not a zero/);
  });

  it("REFUSES numbers JavaScript would read in another base or notation", () => {
    // Also defect 1, and worse in kind: these are not refusals that failed,
    // they are WRONG NUMBERS that succeeded. The old guard read "0x1F" as 31
    // and "1e3" as 1000, both finite, both integers, both silently accepted.
    expect(() => requiredBigint("0x1F", "t", "c", "w")).toThrow(/not a plain integer/);
    expect(() => requiredBigint("1e3", "t", "c", "w")).toThrow(/not a plain integer/);
    expect(() => requiredBigint("+900000", "t", "c", "w")).toThrow(/not a plain integer/);
    expect(() => requiredBigint(" 900000 ", "t", "c", "w")).toThrow(/not a plain integer/);
  });

  it("REFUSES a bigint too large to survive the trip, off by one and silent", () => {
    // DEFECT 2, and the one the old comments explicitly claimed to guard. They
    // said - correctly - that a 64-bit bigint does not fit safely in a
    // JavaScript number. They then checked `Number.isInteger`, which asks "is
    // this a whole number", never "is this the whole number that was sent".
    //   Number("9007199254740993")   === 9007199254740992   (off by one)
    //   Number("123456789012345678") === 123456789012345680 (off by two)
    // Both are integers. Both are finite. Both are the wrong value, with no
    // null, no NaN and no throw anywhere downstream.
    expect(() => requiredBigint("9007199254740993", "t", "c", "w")).toThrow(/outside the range/);
    expect(() => requiredBigint("123456789012345678", "t", "c", "w")).toThrow(/exactly/);
  });

  it("still ACCEPTS the largest value that does survive (rule 55 control)", () => {
    // Without this control the test above would pass for a reader that refused
    // every large number, which would be a different bug wearing the same
    // green tick. 2^53-1 is exactly representable and must come through.
    expect(requiredBigint("9007199254740991", "t", "c", "w")).toBe(9_007_199_254_740_991);
    expect(requiredBigint("-9007199254740991", "t", "c", "w")).toBe(-9_007_199_254_740_991);
  });

  it("delegates to the one shared reader rather than validating here again", () => {
    // Rule 25. Six stores had each written this conversion, and all six carried
    // both defects above - the duplication is what let one wrong idea about
    // `Number()` be wrong in six places and be reviewed six times. The body
    // here must be an adapter, not a fifth opinion.
    const at = storeCode.indexOf("export function requiredBigint");
    expect(at).toBeGreaterThan(-1);
    const fn = storeCode.slice(at, storeCode.indexOf("\n}", at));
    expect(fn).toContain("readRequiredBigint");
    expect(
      /Number\.is(Finite|Integer|SafeInteger)/.test(fn),
      "this wrapper must not re-implement the guard - pg-bigint owns it",
    ).toBe(false);
    expect(storeCode).toContain('from "@/lib/supabase/pg-bigint"');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * §2  toAccumulator - the mapping standing rule 63d warns about
 * ═════════════════════════════════════════════════════════════════════════════ */

/** A row where every column carries a DIFFERENT value, so a swap is visible. */
function accRow(over: Partial<AccumulatorRow> = {}): AccumulatorRow {
  return {
    employee_id: "e1",
    tax_year: 2027,
    // Deliberately all distinct. If two columns held the same number, a
    // transposition between them would be undetectable - which is precisely
    // the defect class this mapping is most exposed to.
    oasdi_wages_cents: 900_001,
    medicare_wages_cents: 900_002,
    futa_wages_cents: 700_003,
    wa_suta_wages_cents: 680_004,
    wa_pfml_wages_cents: 900_005,
    wa_cares_wages_cents: 900_006,
    lni_hundredth_hours: 208_007,
    oasdi_employee_cents: 55_800,
    medicare_employee_cents: 13_050,
    addl_medicare_employee_cents: 900,
    federal_income_tax_cents: 120_000,
    last_run_id: "run-1",
    ...over,
  };
}

describe("toAccumulator", () => {
  it("puts every column in its own field, with no two transposed", () => {
    const a = toAccumulator(accRow());
    expect(a.employeeId).toBe("e1");
    expect(a.taxYear).toBe(2027);
    expect(a.wages.oasdiWagesCents).toBe(900_001);
    expect(a.wages.medicareWagesCents).toBe(900_002);
    expect(a.wages.futaWagesCents).toBe(700_003);
    expect(a.wages.waSutaWagesCents).toBe(680_004);
    expect(a.wages.waPfmlWagesCents).toBe(900_005);
    expect(a.wages.waCaresWagesCents).toBe(900_006);
    expect(a.wages.lniHundredthHours).toBe(208_007);
    expect(a.oasdiEmployeeCents).toBe(55_800);
    expect(a.medicareEmployeeCents).toBe(13_050);
    expect(a.addlMedicareEmployeeCents).toBe(900);
    expect(a.federalIncomeTaxCents).toBe(120_000);
    expect(a.lastRunId).toBe("run-1");
  });

  it("reads string bigints throughout, not just in one field", () => {
    // PostgREST returns ALL bigints as strings. A mapper that handled one
    // numerically and one textually would work in tests and fail in production.
    const a = toAccumulator(
      accRow({ oasdi_wages_cents: "900001", federal_income_tax_cents: "120000" }),
    );
    expect(a.wages.oasdiWagesCents).toBe(900_001);
    expect(a.federalIncomeTaxCents).toBe(120_000);
  });

  it("keeps lastRunId null when no run has fed the year", () => {
    // Null here is a real state - nobody has been paid yet - and must NOT
    // become an empty string, because a caller checking `!== null` would then
    // believe a run had happened.
    expect(toAccumulator(accRow({ last_run_id: null })).lastRunId).toBeNull();
  });

  it("THROWS rather than zeroing when a not-null column is null", () => {
    expect(() => toAccumulator(accRow({ medicare_wages_cents: null }))).toThrow(
      /medicare_wages_cents/,
    );
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * §3  boxFourteenEntries - the Washington money that must not reach box 17
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("boxFourteenEntries", () => {
  const some: BoxFourteenTotals = {
    pfmlEmployeeCents: 12_345,
    caresEmployeeCents: 6_789,
    linesMissingWaDetail: 0,
  };

  it("labels both Washington deductions, with their real amounts", () => {
    const rows = boxFourteenEntries(some);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.label).toBe("WA PFML");
    expect(rows[0]?.amountCents).toBe(12_345);
    expect(rows[1]?.label).toBe("WA CARES");
    expect(rows[1]?.amountCents).toBe(6_789);
  });

  it("emits nothing when nothing was withheld", () => {
    // Box 14 is free text with limited room. A line reading "WA PFML $0.00"
    // invites "why is this zero" on a form where the honest answer is better
    // conveyed by the box's absence.
    expect(
      boxFourteenEntries({ pfmlEmployeeCents: 0, caresEmployeeCents: 0, linesMissingWaDetail: 0 }),
    ).toHaveLength(0);
  });

  it("emits only the one that has an amount", () => {
    // CONTROL against a function that emits both or neither (rule 55). WA Cares
    // has exemptions PFML does not, so one-of-two is a real Greenway state.
    const only = boxFourteenEntries({
      pfmlEmployeeCents: 500,
      caresEmployeeCents: 0,
      linesMissingWaDetail: 0,
    });
    expect(only).toHaveLength(1);
    expect(only[0]?.label).toBe("WA PFML");
  });

  it("never produces a label containing the words state income tax", () => {
    // TRAP 2, ASSERTED. These amounts are state money and box 17 is labelled
    // "state income tax withheld". Washington levies no income tax, so a label
    // hinting at one would encourage exactly the misfiling the authorities file
    // warns about at length.
    for (const r of boxFourteenEntries(some)) {
      expect(r.label.toLowerCase()).not.toContain("income tax");
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * §4  summariseFiled - the INDEPENDENT side of the comparison
 * ═════════════════════════════════════════════════════════════════════════════ */

function filedRow(quarter: number, over: Partial<FiledRow> = {}): FiledRow {
  return {
    tax_year: 2027,
    quarter,
    line_3_federal_income_tax_cents: 30_000,
    line_5a_ss_wages_cents: 225_000,
    line_5a_ss_tax_cents: 27_900,
    line_5c_medicare_wages_cents: 225_000,
    line_5c_5d_medicare_tax_cents: 6_525,
    line_5d_addl_medicare_tax_cents: 0,
    filed_on: `2027-0${quarter}-30`,
    source_note: `Filed 941 Q${quarter} 2027`,
    ...over,
  };
}

describe("summariseFiled", () => {
  it("adds the four quarters into one year", () => {
    const s = summariseFiled([filedRow(1), filedRow(2), filedRow(3), filedRow(4)], 2027);
    expect(s.totals.federalIncomeTaxWithheldCents).toBe(120_000);
    expect(s.totals.socialSecurityWagesCents).toBe(900_000);
    expect(s.totals.socialSecurityTaxCents).toBe(111_600);
    expect(s.totals.medicareWagesCents).toBe(900_000);
    expect(s.totals.medicareTaxCents).toBe(26_100);
    expect(s.totals.quartersIncluded).toBe(4);
    expect(s.quartersMissing).toHaveLength(0);
  });

  it("reports the TRUE number of quarters, never rounding up to four", () => {
    // THE MOST IMPORTANT ASSERTION IN THIS SECTION. The engine uses
    // quartersIncluded to decide whether the comparison is COMPLETE. Reporting
    // four when two were supplied would convert "incomplete" into a confident
    // wrong answer, which is the single failure mode this whole layer is
    // written against.
    const s = summariseFiled([filedRow(1), filedRow(2)], 2027);
    expect(s.totals.quartersIncluded).toBe(2);
  });

  it("names exactly which quarters are missing", () => {
    // "Two are missing" sends Michael to look through four returns. "Q2 and Q4
    // are missing" sends him to two.
    const s = summariseFiled([filedRow(1), filedRow(3)], 2027);
    expect(s.quartersMissing).toEqual([2, 4]);
  });

  it("lists the quarters in order regardless of the order they arrive", () => {
    // A database returns rows in whatever order it likes. The screen shows them
    // to a human, and Q3 above Q1 reads as a bug.
    const s = summariseFiled([filedRow(3), filedRow(1), filedRow(4), filedRow(2)], 2027);
    expect(s.quartersFound.map((q) => q.quarter)).toEqual([1, 2, 3, 4]);
  });

  it("carries the filing date and the source note for every quarter", () => {
    // This is the provenance. A figure that decides whether a federal return
    // gets filed must be traceable to the document it was copied from.
    const s = summariseFiled([filedRow(1)], 2027);
    expect(s.quartersFound[0]?.filedOn).toBe("2027-01-30");
    expect(s.quartersFound[0]?.sourceNote).toContain("941");
  });

  it("keeps Additional Medicare separate so it is counted once, not twice", () => {
    // The one FICA figure with no employer match. Every other figure doubles
    // between the W-3 and the 941; this one does not. Folded in, a perfectly
    // correct return would report a difference equal to this amount - a false
    // alarm, which teaches Michael the red line is usually wrong.
    const s = summariseFiled(
      [filedRow(1, { line_5d_addl_medicare_tax_cents: 900 }), filedRow(2)],
      2027,
    );
    expect(s.unmatchedAdditionalMedicareCents).toBe(900);
  });

  it("reports zero unmatched Additional Medicare for an ordinary year", () => {
    // CONTROL (rule 55). Greenway pays nobody above the threshold, so zero is
    // the normal case, and a function that always reported a non-zero figure
    // would break the reconciliation for everybody.
    const s = summariseFiled([filedRow(1)], 2027);
    expect(s.unmatchedAdditionalMedicareCents).toBe(0);
  });

  it("THROWS rather than zeroing when a filed figure is null", () => {
    expect(() => summariseFiled([filedRow(1, { line_5a_ss_wages_cents: null })], 2027)).toThrow(
      /line_5a_ss_wages_cents/,
    );
  });

  it("names the year and quarter in the refusal, so the row is findable", () => {
    expect(() => summariseFiled([filedRow(3, { line_3_federal_income_tax_cents: null })], 2027))
      .toThrow(/2027 Q3/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * §5  reconciliationReadiness - "cannot run yet" is not "failed"
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("reconciliationReadiness", () => {
  it("says the check cannot run at all when no return is recorded", () => {
    const r = reconciliationReadiness(null);
    expect(r.canRun).toBe(false);
    expect(r.quartersRecorded).toBe(0);
    expect(r.quartersMissing).toEqual([1, 2, 3, 4]);
  });

  it("explains that typing the figures in by hand IS the point", () => {
    // Somebody will eventually try to import this. The reason not to has to be
    // written where they will read it, not only in the migration.
    const r = reconciliationReadiness(null);
    expect(r.plain).toContain("different places");
  });

  it("runs, and says it is complete, on four quarters", () => {
    const filed = summariseFiled([filedRow(1), filedRow(2), filedRow(3), filedRow(4)], 2027);
    const r = reconciliationReadiness(filed);
    expect(r.canRun).toBe(true);
    expect(r.quartersRecorded).toBe(4);
    expect(r.quartersMissing).toHaveLength(0);
  });

  it("REFUSES to run on three quarters, and says which one is missing", () => {
    // A comparison short by one quarter reports a difference that is really
    // absent data. Running it anyway would send Michael hunting a pay run that
    // was never lost.
    const filed = summariseFiled([filedRow(1), filedRow(2), filedRow(4)], 2027);
    const r = reconciliationReadiness(filed);
    expect(r.canRun).toBe(false);
    expect(r.quartersRecorded).toBe(3);
    expect(r.plain).toContain("Q3");
    expect(r.plain).toContain("3 of the 4");
  });

  it("uses singular grammar for one missing quarter and plural for two", () => {
    // "Q3 are missing" makes Michael doubt every other number on the screen.
    const one = reconciliationReadiness(
      summariseFiled([filedRow(1), filedRow(2), filedRow(3)], 2027),
    );
    expect(one.plain).toContain("Q4 is missing");
    const two = reconciliationReadiness(summariseFiled([filedRow(1), filedRow(2)], 2027));
    expect(two.plain).toContain("Q3 and Q4 are missing");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * §6  SOURCE-LEVEL RULES - the ones no runtime test can reach
 *
 * Every assertion below is made against the COMMENT-STRIPPED source, so a rule
 * explained in prose cannot satisfy a test looking for it in code.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the store reads the filed 941s and never computes them", () => {
  /**
   * ═══ THE LOAD-BEARING ASSERTION OF THIS ENTIRE FILE. ═══
   *
   * The W-2 side of the comparison descends from payroll_ytd_accumulators,
   * which is fed from payroll_run_lines. If the "filed 941" side were also
   * derived from pay runs, both sides would share one ancestor and would agree
   * TRIVIALLY, ALWAYS - including in the quarter where a 941 went out with a
   * transposed digit. Five green ticks forever: standing rule 39 on the
   * highest-stakes screen in the payroll module.
   */
  it("reads the filed figures from their own table", () => {
    expect(storeCode).toContain('.from("filed_form_941_totals")');
  });

  it("passes the engine the figures it READ, not figures it derived", () => {
    // The reconcile call must take its totals from the filed summary object.
    const at = storeCode.indexOf("reconcileW3To941s({");
    expect(at, "the store no longer calls the reconciliation engine").toBeGreaterThan(-1);
    const call = storeCode.slice(at, at + 400);
    expect(call).toContain("form941: filed.totals");
    expect(call).toContain("unmatchedAdditionalMedicareCents: filed.unmatchedAdditionalMedicareCents");
  });

  it("does not build the 941 totals out of pay run lines", () => {
    // Scoped to the function that produces Form941YearTotals, because the store
    // DOES legitimately read payroll_run_lines elsewhere - for box 14, which is
    // a different question with a different correct answer. A blanket ban would
    // forbid the correct code along with the wrong code.
    const at = storeCode.indexOf("export function summariseFiled");
    expect(at).toBeGreaterThan(-1);
    const fn = storeCode.slice(at, storeCode.indexOf("\n}", at));
    expect(fn).toContain("filed_form_941_totals");
    expect(
      fn.includes("payroll_run_lines"),
      "the filed side must never be summed from pay runs - both sides would then agree trivially",
    ).toBe(false);
    expect(fn.includes("payroll_ytd_accumulators")).toBe(false);
  });

  it("reports not-run as null rather than as an agreement", () => {
    // Zeros against zeros come back ALL GREEN, which is a vacuous agreement
    // presented as a clean bill of health.
    expect(storeCode).toMatch(/filed === null \|\| w3 === null[\s\S]{0,40}\? null/);
  });
});

describe("the store cannot forget a person who is owed a form", () => {
  it("does not filter the employee query on active", () => {
    // Somebody who left in March is still owed a W-2 for the wages they were
    // paid. Filtering on `active` is the single easiest way to omit an entire
    // federal information return, and the omission is invisible because the
    // form that would show it is the form that does not exist.
    const at = storeCode.indexOf('.from("employees")');
    expect(at).toBeGreaterThan(-1);
    const query = storeCode.slice(at, at + 300);
    expect(
      query.includes('.eq("active"'),
      "the employee read must not exclude inactive people - they are still owed a W-2",
    ).toBe(false);
  });

  it("counts the inactive people who still have wages, rather than hiding them", () => {
    expect(storeCode).toContain("inactiveWithWages");
  });

  it("counts the people it skipped for having no wages", () => {
    // An unexplained gap between the headcount and the form count is exactly
    // what makes Michael wonder whether somebody was missed.
    expect(storeCode).toContain("employeesWithNoWages");
  });
});

describe("the store never invents a fact it was not given", () => {
  it("never splits full_name into a legal first and last name", () => {
    // Splitting on the last space is wrong for compound surnames, surnames
    // recorded first, suffixes and single-word legal names - and the cost is an
    // SSA name/SSN mismatch, a per-form 6721 penalty, and a W-2c.
    expect(storeCode).not.toMatch(/full_name[^\n]*\.split\(/);
    expect(storeCode).not.toMatch(/split\((["'`]) \1\)/);
  });

  it("reads the legal name from the columns 0203 added, and passes it as stored", () => {
    expect(storeCode).toContain("w2_first_name_and_initial");
    expect(storeCode).toContain("w2_last_name");
    expect(storeCode).toContain("w2_name_suffix");
  });

  it("answers shareholder status from the LINK, never from a name match", () => {
    expect(storeCode).toContain("isTwoPercentShareholder: e.gl_shareholder_id !== null");
    expect(
      storeCode.includes('.from("gl_shareholders")'),
      "shareholder status comes from the employees link, not from matching names against the owners table",
    ).toBe(false);
  });

  it("passes box 17 as zero and lets the engine police it", () => {
    expect(storeCode).toContain("stateIncomeTaxCents: 0");
  });

  it("uses the SUTA state, not the mailing-address state, for box 15", () => {
    // company_profile has both and they are deliberately different fields. A
    // business can be headquartered in one state and pay unemployment tax in
    // another; conflating them is how a wrong box 15 happens.
    expect(storeCode).toContain("suta_state_code");
    expect(
      /select\("state_code/.test(storeCode),
      "box 15 must not come from the mailing address state",
    ).toBe(false);
  });

  it("does not hard-code WA as a fallback state", () => {
    // Everyone knows Greenway is in Washington. Writing it in as a fallback
    // would still be the store stating a fact nobody entered (rule 62d), and
    // it would make an incomplete profile look like a finished form.
    expect(storeCode).not.toMatch(/suta_state_code[^\n]*\?\?\s*["'`]WA/);
    expect(storeCode).not.toContain('stateCode: "WA"');
  });

  it("excludes voided pay runs from the box 14 sum", () => {
    // A voided run is not a correction, it is a run that never happened.
    expect(storeCode).toContain('r.status !== "void"');
  });

  it("counts pay lines that cannot state their own Washington split", () => {
    // Treating a null as zero would understate box 14 silently, and box 14 is
    // what Michael checks against his own PFML remittances.
    expect(storeCode).toContain("linesMissingWaDetail");
    expect(storeCode).toMatch(/wa_pfml_employee_cents === null/);
  });

  it("passes box 12 as empty rather than inventing a plan", () => {
    expect(storeCode).toContain("box12: []");
  });
});

describe("the store cannot leak a Social Security number", () => {
  /**
   * A store whose return type cannot EXPRESS a secret cannot leak one by
   * accident, which is a stronger guarantee than remembering not to. The digits
   * are read, handed to a pure function, and go out of scope; `W2Form` carries
   * only `ssnMasked`.
   */
  it("reads ssn_full only to hand it to the engine", () => {
    expect(storeCode).toContain("ssn_full");
    expect(storeCode).toContain("ssn: (e.ssn_full ?? \"\").trim()");
  });

  it("has no field anywhere in its result types that could carry the full number", () => {
    // Assert on the TYPE declarations, not the whole file, so the read above
    // does not satisfy this.
    for (const typeName of ["W2Loaded", "W2PersonRefusal"]) {
      const at = storeCode.indexOf(`export type ${typeName} = {`);
      expect(at, `${typeName} not found`).toBeGreaterThan(-1);
      const body = storeCode.slice(at, storeCode.indexOf("\n};", at));
      expect(body.toLowerCase()).not.toContain("ssn");
    }
  });

  it("identifies a refused person by their DISPLAY name", () => {
    // The refusal frequently IS that the legal name is missing, so the legal
    // name cannot be what identifies the person in the message.
    expect(storeCode).toContain("displayName: e.full_name ?? e.id");
  });
});

describe("the store does no tax arithmetic of its own", () => {
  it("delegates every box, total and comparison to the engine", () => {
    for (const fn of ["buildW2(", "buildW3(", "reconcileW3To941s("]) {
      expect(storeCode, `the store must call ${fn}`).toContain(fn);
    }
  });

  it("contains no tax rate, cap or percentage constant", () => {
    // If this file did its own sums they would eventually disagree with the
    // engine's, silently, on a form that goes to the federal government.
    expect(storeCode).not.toMatch(/0\.062|0\.0145|0\.124|0\.029|0\.009/);
    expect(storeCode).not.toMatch(/\b6\.2\b|\b1\.45\b|\b12\.4\b|\b2\.9\b/);
    // The Social Security wage base, in any plausible spelling.
    expect(storeCode).not.toMatch(/wageBase|WAGE_BASE|184_500|184500/);
  });

  it("does not pre-filter voided forms out of the W-3", () => {
    // The engine excludes them itself. Doing it here too would put the
    // exclusion in two places, where the two can disagree.
    const at = storeCode.indexOf("buildW3(forms");
    expect(at).toBeGreaterThan(-1);
  });

  it("writes nothing and transmits nothing", () => {
    // Reading and filing are separate acts, and this project is not a filing
    // agent. Michael files every return himself.
    for (const write of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      expect(storeCode, `the store must not call ${write}`).not.toContain(write);
    }
  });

  it("is server-only, because it reads SSNs and filed returns", () => {
    expect(storeCode).toContain('import "server-only"');
  });
});

describe("the store refuses an impossible year before it reads anything", () => {
  it("bounds the year the same way the migrations do", () => {
    // A four-digit typo is caught here rather than producing a year's worth of
    // forms nobody asked for.
    expect(storeCode).toContain("taxYear < 2020");
    expect(storeCode).toContain("taxYear > 2100");
    const guardAt = storeCode.indexOf("taxYear < 2020");
    const readAt = storeCode.indexOf("createSupabaseAdminClient()");
    expect(guardAt).toBeLessThan(readAt);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * §7  MIGRATION 0204 - the table that made the engine reachable
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("migration 0204 records what was filed", () => {
  const sql = readFileSync(
    join(REPO, "supabase", "migrations", "0204_filed_form_941_totals.sql"),
    "utf8",
  );

  it("creates the table the reconciliation reads", () => {
    expect(sql).toContain("create table if not exists public.filed_form_941_totals");
  });

  it("carries all five figures Form941YearTotals needs, plus the 5d part", () => {
    for (const col of [
      "line_3_federal_income_tax_cents",
      "line_5a_ss_wages_cents",
      "line_5a_ss_tax_cents",
      "line_5c_medicare_wages_cents",
      "line_5c_5d_medicare_tax_cents",
      "line_5d_addl_medicare_tax_cents",
    ]) {
      expect(sql, `0204 must define ${col}`).toContain(col);
    }
  });

  it("allows only one filed return per quarter", () => {
    // A second row would let a four-quarter total silently double one quarter,
    // and the difference would look like a missing pay run.
    expect(sql).toContain("unique (tax_year, quarter)");
  });

  it("requires a filing date and a source note", () => {
    expect(sql).toContain("filed_on    date not null");
    expect(sql).toMatch(/source_note text not null check \(length\(btrim\(source_note\)\) > 0\)/);
  });

  it("is owner-only, like the accumulators and the premiums", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("public.is_owner()");
  });

  it("guards its own ordering rather than half-applying", () => {
    expect(sql).toContain("MIGRATION_OUT_OF_ORDER");
  });

  it("explains why the figures are typed in rather than imported", () => {
    // The reason must live in the schema, because the schema is what someone
    // reads before deciding to "improve" it with an import.
    expect(sql).toContain("independent");
  });

  it("populates nothing", () => {
    // Greenway's first payroll is 1 January 2027. No 941 has been filed under
    // this system, so there is nothing truthful to insert.
    expect(sql).not.toMatch(/^\s*insert into/im);
  });
});
