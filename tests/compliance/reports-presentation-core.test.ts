/**
 * tests/compliance/reports-presentation-core.test.ts   (slice books-27)
 *
 * THE GATE OVER THE REPORTS ENGINE.
 *
 * Standing rule 22 says the test is a SUSPECT, not a witness, so the organising
 * question here is not "does the formatter work?" but "what is the most
 * expensive lie this engine could tell, and is there a test that stops it?"
 *
 * For a REPORTING engine the expensive lies are different from the ones a
 * calculation engine tells. A calculation engine gets a number wrong. A
 * reporting engine gets the number right and causes the reader to draw the
 * wrong conclusion — which is worse, because there is nothing to find later.
 * The five that matter here:
 *
 *   1. A CONFIDENT PERCENTAGE ACROSS A BROKEN COMPARISON. The rate changed,
 *      the report says "up 73%", and Michael believes something happened in his
 *      business. ASC 205-10-45-3 says comparability shall be brought out; the
 *      refusal path must be unfakeable.
 *   2. A MISLABELLED COLUMN. SS and SS_C are different money with different
 *      payers. Decoding _C after _COGS silently mislabels employer tax as
 *      employee tax, and the total still foots.
 *   3. SILENT SUPPRESSION. Hiding sixteen empty rows is a service. Hiding them
 *      without saying so is a lie of omission (CON 8 QC31).
 *   4. AN EMPTY REPORT THAT LOOKS LIKE A CLEAN ONE. "Nothing happened" and
 *      "this was never switched on" must never render identically.
 *   5. FLOAT MONEY. One decimal amount reaching a money path and two pages
 *      disagree by a cent forever.
 *
 * Every numeric assertion below was proven capable of failing by deliberately
 * breaking the engine and confirming the test noticed (standing rule 15c).
 */
import { describe, expect, it } from "vitest";

import {
  LAYOUT_RULES,
  SAGE_FIELD_DICTIONARY,
  comparePeriods,
  decodeSageToken,
  emptyStateFor,
  formatBasisPoints,
  formatCents,
  formatLeaveBalance,
  signedCents,
  suppressEmptySubjects,
} from "@/lib/reports/reports-presentation-core";
import {
  REPORTS_PRESENTATION_LESSONS,
  assertEveryExportedFunctionIsTaught,
  citedAuthorityIds,
  exportedCoreFunctionNames,
  lessonFor,
  taughtFunctionNames,
} from "@/lib/reports/reports-presentation-mentor";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// 1) THE MISLABELLED COLUMN
// ---------------------------------------------------------------------------

describe("decodeSageToken — the column that says the wrong thing", () => {
  it("separates the employee half from the employer half", () => {
    const employee = decodeSageToken("SS");
    const employer = decodeSageToken("SS_C");
    expect(employee).not.toBeNull();
    expect(employer).not.toBeNull();
    expect(employee!.isEmployerSide).toBe(false);
    expect(employer!.isEmployerSide).toBe(true);
    // The whole point: they must not resolve to the same meaning.
    expect(employee!.meaning.sageToken).not.toBe(employer!.meaning.sageToken);
  });

  it("strips _C BEFORE the cost side, which is the ordering bug that mislabels money", () => {
    // If _COGS were stripped first, "SS_COGS_C" would keep a dangling "_C" and
    // either fail to resolve or resolve to the employee row. Both are wrong.
    const d = decodeSageToken("SS_COGS_C");
    expect(d).not.toBeNull();
    expect(d!.isEmployerSide).toBe(true);
    expect(d!.costSide).toBe("cogs");
  });

  it("handles both of Sage's inconsistent spellings of the same suffix", () => {
    expect(decodeSageToken("MED_COG")!.costSide).toBe("cogs");
    expect(decodeSageToken("MED_COGS")!.costSide).toBe("cogs");
    expect(decodeSageToken("MED_SAL")!.costSide).toBe("selling");
    expect(decodeSageToken("MED_SALES")!.costSide).toBe("selling");
  });

  it("returns null rather than inventing a meaning for a token it does not know", () => {
    expect(decodeSageToken("WIDGET_QQQ")).toBeNull();
    expect(decodeSageToken("")).toBeNull();
    expect(decodeSageToken("   ")).toBeNull();
  });

  it("decodes the worst real token on Michael's report", () => {
    const d = decodeSageToken("SUI2_COGS_C");
    expect(d).not.toBeNull();
    expect(d!.isEmployerSide).toBe(true);
    expect(d!.costSide).toBe("cogs");
  });

  it("the dictionary is non-empty and every entry is fully populated", () => {
    // Guards rule 39: a dictionary that quietly emptied would make every
    // decode return null and several tests above would still be arguable.
    expect(SAGE_FIELD_DICTIONARY.length).toBeGreaterThanOrEqual(15);
    for (const f of SAGE_FIELD_DICTIONARY) {
      expect(f.sageToken.length).toBeGreaterThan(0);
      expect(f.plain.length).toBeGreaterThan(0);
      expect(f.expanded.length).toBeGreaterThan(0);
      expect(f.bornBy.length).toBeGreaterThan(0);
    }
  });

  it("every dictionary token round-trips through the decoder", () => {
    for (const f of SAGE_FIELD_DICTIONARY) {
      const d = decodeSageToken(f.sageToken);
      expect(d, `token ${f.sageToken} failed to decode`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 2) THE CONFIDENT PERCENTAGE ACROSS A BROKEN COMPARISON
// ---------------------------------------------------------------------------

describe("comparePeriods — the percentage that describes the wrong thing", () => {
  it("computes a clean comparison in exact basis points", () => {
    const c = comparePeriods(11_000, 10_000);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error("unreachable");
    expect(c.changeCents).toBe(1_000);
    expect(c.changeBasisPoints).toBe(1_000); // 10.00%
    expect(c.direction).toBe("up");
  });

  it("REFUSES a percentage when the caller declares a comparability break", () => {
    const c = comparePeriods(44_111, 25_502, [
      { what: "the unemployment rate changed from 0.64% to 0.37%", why: "the base rate moved" },
    ]);
    expect(c.ok).toBe(false);
    if (c.ok) throw new Error("unreachable");
    // The dollars survive, because they are still true.
    expect(c.currentCents).toBe(44_111);
    expect(c.priorCents).toBe(25_502);
    expect(c.changeCents).toBe(18_609);
    // NO COMPUTED percentage appears. The sentence may quote a rate as part of
    // the NAMED REASON — that is the point of the refusal — so the assertion
    // has to be about the computed change, not about the character "%".
    // (An earlier version of this test asserted no "%" at all and contradicted
    // itself on the very next line. Standing rule 22: the test is a suspect.)
    expect(c.plain).not.toMatch(/\b(up|down)\s+[\d.]+%/);
    expect(c).not.toHaveProperty("changeBasisPoints");
    expect(c.plain).toContain("0.64%"); // present only as the NAMED REASON
    expect(c.refusalReason.length).toBeGreaterThan(0);
  });

  it("the refusal is not fakeable by passing an empty break list", () => {
    const c = comparePeriods(11_000, 10_000, []);
    expect(c.ok).toBe(true);
  });

  it("returns a null percentage rather than Infinity when there is no prior period", () => {
    const c = comparePeriods(10_000, 0);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error("unreachable");
    expect(c.changeBasisPoints).toBeNull();
    expect(Number.isFinite(c.changeCents)).toBe(true);
    expect(c.plain).toMatch(/no prior period/i);
  });

  it("both periods empty reads as flat, not as an error", () => {
    const c = comparePeriods(0, 0);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error("unreachable");
    expect(c.direction).toBe("flat");
    expect(c.changeBasisPoints).toBeNull();
  });

  it("rounds half AWAY FROM ZERO so a half-basis-point fall does not read as flat", () => {
    // 19,999 vs 20,000 is exactly -0.5 bp. It must not collapse to 0.
    const down = comparePeriods(19_999, 20_000);
    expect(down.ok).toBe(true);
    if (!down.ok) throw new Error("unreachable");
    expect(down.direction).toBe("down");
    expect(down.changeBasisPoints).toBe(-1);
  });

  it("never prints the self-contradicting phrase 'down 0%'", () => {
    // A penny off $2,000 is 0.005% — it rounds to zero basis points, but the
    // money genuinely moved. Found by this suite while writing it, and fixed
    // in the engine rather than papered over in the test (standing rule 28b).
    const tiny = comparePeriods(199_999, 200_000);
    expect(tiny.ok).toBe(true);
    if (!tiny.ok) throw new Error("unreachable");
    expect(tiny.direction).toBe("down"); // the direction is still true
    expect(tiny.changeCents).toBe(-1); // the dollars are still exact
    expect(tiny.plain).not.toMatch(/down 0%/);
    expect(tiny.plain).toMatch(/less than 0\.01%/);
  });

  it("never emits negative zero, which formats with a leading minus", () => {
    const tiny = comparePeriods(199_999, 200_000);
    expect(tiny.ok).toBe(true);
    if (!tiny.ok) throw new Error("unreachable");
    // Object.is distinguishes -0 from 0 where === does not.
    expect(Object.is(tiny.changeBasisPoints, -0)).toBe(false);
    expect(tiny.plain).not.toContain("-0%");
  });

  it("throws rather than rounding when a float reaches a money path", () => {
    expect(() => comparePeriods(10_000.5, 10_000)).toThrow(/integer cents/i);
    expect(() => comparePeriods(10_000, 9_999.99)).toThrow(/integer cents/i);
  });

  it("a real Greenway figure: Q2 UI at the correct rate versus the stale one", () => {
    // 255.02 filed at 0.37%; 441.11 is what 0.64% would have produced.
    const c = comparePeriods(25_502, 44_111, [
      { what: "Sage was using a stale 0.64% rate", why: "the rate, not the wages, changed" },
    ]);
    expect(c.ok).toBe(false);
    if (c.ok) throw new Error("unreachable");
    expect(c.changeCents).toBe(-18_609);
  });
});

// ---------------------------------------------------------------------------
// 3) FORMATTING — small, boring, and load-bearing
// ---------------------------------------------------------------------------

describe("formatters", () => {
  it("formats the filed 941 line 12 exactly", () => {
    expect(formatCents(1_420_457)).toBe("$14,204.57");
  });

  it("uses a minus sign, never accounting parentheses", () => {
    expect(formatCents(-41_230)).toBe("-$412.30");
    expect(formatCents(-41_230)).not.toContain("(");
  });

  it("pads the cents so $5.05 never renders as $5.5", () => {
    expect(formatCents(505)).toBe("$5.05");
    expect(formatCents(500)).toBe("$5.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("groups thousands", () => {
    expect(formatCents(100_000_000)).toBe("$1,000,000.00");
  });

  it("throws on a fractional cent", () => {
    expect(() => formatCents(1.5)).toThrow(/integer cents/i);
  });

  it("signedCents says 'no change' rather than printing an ambiguous zero", () => {
    expect(signedCents(0)).toBe("no change");
    expect(signedCents(1_000)).toBe("+$10.00");
    expect(signedCents(-1_000)).toBe("-$10.00");
  });

  it("formatBasisPoints trims trailing zeros but keeps real precision", () => {
    expect(formatBasisPoints(1_200)).toBe("12%");
    expect(formatBasisPoints(1_234)).toBe("12.34%");
    expect(formatBasisPoints(1_230)).toBe("12.3%");
    expect(formatBasisPoints(0)).toBe("0%");
  });

  it("formatBasisPoints renders Greenway's real Washington rates", () => {
    expect(formatBasisPoints(37)).toBe("0.37%"); // UI, as filed
    expect(formatBasisPoints(3)).toBe("0.03%"); // EAF, as filed
    expect(formatBasisPoints(58)).toBe("0.58%"); // WA Cares
  });

  it("formatBasisPoints throws on a float", () => {
    expect(() => formatBasisPoints(12.5)).toThrow(/integer basis points/i);
  });

  it("formatLeaveBalance NAMES a negative balance instead of printing a bare minus", () => {
    expect(formatLeaveBalance(-4_801)).toBe("48.01 hours advanced");
    expect(formatLeaveBalance(4_801)).toBe("48.01 hours available");
    expect(formatLeaveBalance(0)).toBe("none available");
  });

  it("formatLeaveBalance throws on a float", () => {
    expect(() => formatLeaveBalance(48.01)).toThrow(/integer hundredths/i);
  });
});

// ---------------------------------------------------------------------------
// 4) SILENT SUPPRESSION
// ---------------------------------------------------------------------------

describe("suppressEmptySubjects — hiding is fine, hiding silently is not", () => {
  type Row = { name: string; cents: number };
  const sage26: Row[] = [
    ...Array.from({ length: 10 }, (_, i) => ({ name: `active-${i}`, cents: 100 })),
    ...Array.from({ length: 16 }, (_, i) => ({ name: `inactive-${i}`, cents: 0 })),
  ];

  it("reproduces the §8.3 defect: 26 rows to tell you about 10", () => {
    const r = suppressEmptySubjects(sage26, (x) => x.cents !== 0);
    expect(r.shown).toHaveLength(10);
    expect(r.hiddenCount).toBe(16);
  });

  it("ALWAYS discloses when anything was hidden", () => {
    const r = suppressEmptySubjects(sage26, (x) => x.cents !== 0);
    expect(r.disclosure).not.toBeNull();
    expect(r.disclosure).toContain("16");
    expect(r.disclosure).toContain("26");
  });

  it("does not nag when nothing was hidden", () => {
    const r = suppressEmptySubjects(sage26.slice(0, 10), (x) => x.cents !== 0);
    expect(r.hiddenCount).toBe(0);
    expect(r.disclosure).toBeNull();
  });

  it("hiding everything still discloses rather than rendering a blank page silently", () => {
    const r = suppressEmptySubjects(sage26, () => false);
    expect(r.shown).toHaveLength(0);
    expect(r.disclosure).not.toBeNull();
    expect(r.disclosure).toContain("26");
  });

  it("shown + hidden always equals the input, so nothing can vanish", () => {
    for (const pred of [() => true, () => false, (x: Row) => x.cents !== 0]) {
      const r = suppressEmptySubjects(sage26, pred);
      expect(r.shown.length + r.hiddenCount).toBe(sage26.length);
    }
  });
});

// ---------------------------------------------------------------------------
// 5) THE EMPTY REPORT THAT LOOKS CLEAN
// ---------------------------------------------------------------------------

describe("emptyStateFor — 'quiet' and 'never switched on' are different facts", () => {
  it("distinguishes the two cases in words, not just in a flag", () => {
    const quiet = emptyStateFor("Employee Compensation", "a payroll run in this period", true);
    const never = emptyStateFor("Employee Compensation", "a payroll run in this period", false);
    expect(quiet.whyEmpty).not.toBe(never.whyEmpty);
    expect(never.whyEmpty).toMatch(/never/i);
  });

  it("always tells the reader what would fill it", () => {
    const e = emptyStateFor("Direct Deposit Pre-Sync", "an approved payroll run", false);
    expect(e.whatWouldFillIt).toContain("payroll run");
    expect(e.headline).toContain("Direct Deposit Pre-Sync");
  });

  it("every field is a non-empty sentence, so nothing renders as a blank panel", () => {
    for (const ever of [true, false]) {
      const e = emptyStateFor("Any Report", "some data", ever);
      expect(e.headline.length).toBeGreaterThan(0);
      expect(e.whyEmpty.length).toBeGreaterThan(0);
      expect(e.whatWouldFillIt.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 6) THE LAYOUT RULES MUST STAY ANSWERABLE
// ---------------------------------------------------------------------------

describe("LAYOUT_RULES — a preference is not an engineering rule", () => {
  it("there are rules at all (rule 39: guard the vacuous read)", () => {
    expect(LAYOUT_RULES.length).toBeGreaterThanOrEqual(8);
  });

  it("every rule names a measured Sage defect AND a baseline section", () => {
    for (const r of LAYOUT_RULES) {
      expect(r.sageDefect.length, `${r.id} has no defect`).toBeGreaterThan(0);
      expect(r.baselineSection, `${r.id} has no baseline section`).toMatch(/8\.\d|§|\d/);
    }
  });

  it("every rule cites at least one authority that actually resolves", () => {
    for (const r of LAYOUT_RULES) {
      expect(r.authorityIds.length, `${r.id} cites nothing`).toBeGreaterThan(0);
      for (const id of r.authorityIds) {
        expect(findGuidanceAuthority(id), `${r.id} cites unknown authority ${id}`).toBeDefined();
      }
    }
  });

  it("rule ids are unique", () => {
    const ids = LAYOUT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// 7) THE MENTOR COVERAGE GATE (standing rule 26)
// ---------------------------------------------------------------------------

describe("reports-presentation-mentor", () => {
  it("teaches every exported function in the core", () => {
    expect(() => assertEveryExportedFunctionIsTaught()).not.toThrow();
  });

  it("the gate reads a non-empty function list, so it cannot pass vacuously", () => {
    expect(exportedCoreFunctionNames().length).toBeGreaterThanOrEqual(8);
  });

  it("cites no authority that does not exist", () => {
    const dangling = citedAuthorityIds().filter((id) => findGuidanceAuthority(id) === undefined);
    expect(dangling).toEqual([]);
  });

  it("every lesson has all five fields filled in, not just declared", () => {
    for (const l of REPORTS_PRESENTATION_LESSONS) {
      expect(l.plainEnglish.length, `${l.fn}.plainEnglish`).toBeGreaterThan(40);
      expect(l.whyItExists.length, `${l.fn}.whyItExists`).toBeGreaterThan(40);
      expect(l.theTrap.length, `${l.fn}.theTrap`).toBeGreaterThan(40);
      expect(l.whatIWouldDo.length, `${l.fn}.whatIWouldDo`).toBeGreaterThan(40);
      expect(l.authorityIds.length, `${l.fn}.authorityIds`).toBeGreaterThan(0);
    }
  });

  it("lessonFor finds a real lesson and misses a fake one", () => {
    expect(lessonFor("comparePeriods")).toBeDefined();
    expect(lessonFor("notARealFunction")).toBeUndefined();
  });

  it("no function is taught twice", () => {
    const names = taughtFunctionNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
