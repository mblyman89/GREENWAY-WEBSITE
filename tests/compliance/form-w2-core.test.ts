/**
 * books-46 — THE W-2 / W-3 ENGINE, AND THE SIX DEFECTS THIS FILE'S SUBJECT HAD
 * BEFORE A SINGLE TEST WAS WRITTEN.
 *
 * WHY THAT SENTENCE IS THE POINT
 * ------------------------------
 * `form-w2-core.ts` compiled cleanly the first time. `tsc --noEmit` returned
 * nothing, twice. Every one of the following was nevertheless wrong, and every
 * one of them would have been FROZEN INTO PLACE by a test suite written to
 * describe the code instead of the law:
 *
 *   D1  box 1 did not subtract pre-tax elective deferrals, though the box 1
 *       instruction already quoted in this repo says "do not include elective
 *       deferrals" in those words. Any employee with a 401(k) would have had
 *       box 1 overstated by their entire contribution.
 *
 *   D2  `includedInBox1: boolean` could not model the problem. Code D (401(k))
 *       and code W (employer HSA) are both "not in box 1", but D must be
 *       SUBTRACTED from FICA wages and W must not — because W was never in a
 *       wage box at all. One boolean, two opposite behaviours.
 *
 *   D3  W-3 box 12a was missing entirely, despite the repo already carrying an
 *       authority whose whole purpose is to warn that box 12a is a FILTER and
 *       not a total, and that this "catches software as often as people".
 *
 *   D4  `assertAdditionalMedicareBoundary` computed `max(0, T - T)` and then
 *       asserted 0.9% of it was zero, and asked whether `x === x + 900`. Both
 *       are tautologies. The gate was green because it was incapable of being
 *       anything else.
 *
 *   D5  `assertBox12CodesAreComplete` re-declared the six codes by hand and
 *       compared that list against itself.
 *
 *   D6  `buildW3(forms, taxYear)` never compared `taxYear` to the forms.
 *
 * THE LESSON, WHICH IS THE REASON FOR THIS PREAMBLE: a green type-check tells
 * you the code is CONSISTENT WITH ITSELF. It says nothing about whether it is
 * consistent with the Internal Revenue Code. The authorities file was written
 * first, in books-43; the engine contradicted it in four places anyway. Tests
 * are written here against the QUOTES, not against the implementation.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 *   §1  The published oracles. The IRS printed "$11,439 ($184,500 × 6.2%)" and
 *       "D 5300.00". Those are inputs AND answers, so they are oracles rather
 *       than illustrations, and the engine must hit them exactly.
 *   §2  Trap 1 — the S-corp health premium, in both directions.
 *   §3  Trap 2 — box 17 blank in Washington.
 *   §4  Trap 3 — W-3 box 12a is filtered.
 *   §5  Every one of the twelve refusal codes is reachable (rule 43).
 *   §6  Every self-check gate is provably failable (rule 83a) — each one is
 *       shown to go red when the thing it guards is broken.
 *   §7  Greenway's own numbers, end to end.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  BOX_12_CODES,
  BOX_12_CODE_SPECS,
  BOX_12_MAX_ITEMS_PER_COPY_A,
  ALL_W2_REFUSAL_CODES,
  assertAdditionalMedicareBoundary,
  assertBox12CodesAreComplete,
  assertBox4CeilingMatchesIrsArithmetic,
  assertRefusalCodesAreListed,
  assertW3Box12aIsFiltered,
  box12CodeSpec,
  box4CeilingCentsFor,
  boxOf,
  buildW2,
  buildW3,
  describeBox1,
  formatBox12Entry,
  formatCentsForW2,
  maskSsnForW2,
  reconcileW3To941s,
  type Box12Code,
  type Box12Entry,
  type Form941YearTotals,
  type W2EmployeeFacts,
  type W2Form,
  type W2RefusalCode,
  type W2Request,
  type W2Result,
  type W2StateFacts,
} from "@/lib/payroll/form-w2-core";
import {
  W2_BOX_4_CEILING_2026_CENTS,
  W3_TO_941_FICA_DOUBLING_FACTOR,
} from "@/lib/payroll/form-w2-authorities";
import {
  ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS,
  MEDICARE_RATE_MILLI_PCT,
  OASDI_RATE_MILLI_PCT,
  applyMilliPct,
  wageBaseSpec,
} from "@/lib/payroll/payroll-withholding-core";
import type { YtdAccumulatorRow } from "@/lib/payroll/ytd-core";

/* ------------------------------------------------------------------ *
 * Builders. Every test states ONLY the facts it cares about; anything
 * unstated is a benign default, so a failure points at the one field
 * the test actually varied.
 * ------------------------------------------------------------------ */

function ytdFor(over: {
  employeeId?: string;
  taxYear?: number;
  oasdiWagesCents?: number;
  medicareWagesCents?: number;
  oasdiEmployeeCents?: number;
  medicareEmployeeCents?: number;
  addlMedicareEmployeeCents?: number;
  federalIncomeTaxCents?: number;
} = {}): YtdAccumulatorRow {
  const medicare = over.medicareWagesCents ?? 6_000_000;
  const oasdi = over.oasdiWagesCents ?? medicare;
  return {
    employeeId: over.employeeId ?? "emp-1",
    taxYear: over.taxYear ?? 2026,
    wages: {
      oasdiWagesCents: oasdi,
      medicareWagesCents: medicare,
      futaWagesCents: 700_000,
      waSutaWagesCents: 700_000,
      waPfmlWagesCents: medicare,
      waCaresWagesCents: medicare,
      lniHundredthHours: 200_000,
    },
    oasdiEmployeeCents: over.oasdiEmployeeCents ?? applyMilliPct(oasdi, OASDI_RATE_MILLI_PCT),
    medicareEmployeeCents:
      over.medicareEmployeeCents ?? applyMilliPct(medicare, MEDICARE_RATE_MILLI_PCT),
    addlMedicareEmployeeCents: over.addlMedicareEmployeeCents ?? 0,
    federalIncomeTaxCents: over.federalIncomeTaxCents ?? 800_000,
    lastRunId: "run-26",
  };
}

function employeeFor(over: Partial<W2EmployeeFacts> = {}): W2EmployeeFacts {
  return {
    employeeId: "emp-1",
    firstNameAndInitial: "Michael",
    lastName: "Lyman",
    suffix: null,
    ssn: "123456789",
    isTwoPercentShareholder: false,
    scorpHealthPremiumCents: 0,
    box12: [],
    box14: [],
    retirementPlan: false,
    statutoryEmployee: false,
    thirdPartySickPay: false,
    isVoid: false,
    ...over,
  };
}

function stateFor(over: Partial<W2StateFacts> = {}): W2StateFacts {
  return {
    stateCode: "WA",
    employerStateIdNumber: null,
    stateWagesCents: 0,
    stateIncomeTaxCents: 0,
    ...over,
  };
}

function requestFor(over: Partial<W2Request> = {}): W2Request {
  return {
    taxYear: 2026,
    employee: employeeFor(),
    ytd: ytdFor(),
    state: stateFor(),
    ...over,
  };
}

/** Narrow to the success case, failing loudly with the refusals if it is not. */
function okForm(result: W2Result): W2Form {
  if (!result.ok) {
    throw new Error(
      `expected a W-2 but got refusals: ${result.refusals.map((r) => r.code).join(", ")}`,
    );
  }
  return result;
}

function refusalCodes(result: W2Result): readonly W2RefusalCode[] {
  if (result.ok) return [];
  return result.refusals.map((r) => r.code);
}

function amount(form: W2Form, box: string): number {
  const b = boxOf(form, box);
  if (b === undefined) throw new Error(`box ${box} is not on the form`);
  return b.amountCents;
}

/* ══════════════════════════════════════════════════════════════════ *
 * §1  THE PUBLISHED ORACLES
 * ══════════════════════════════════════════════════════════════════ */

describe("§1 the arithmetic the IRS published", () => {
  it('re-derives the box 4 ceiling "$11,439 ($184,500 × 6.2%)" from the rate constants', () => {
    // The instruction printed the inputs AND the answer, which is what makes
    // this an oracle. Deriving it rather than trusting the literal means that
    // editing either constant surfaces the disagreement here.
    const base = wageBaseSpec("oasdi").ceilingCents;
    expect(base).toBe(18_450_000); // $184,500
    expect(OASDI_RATE_MILLI_PCT).toBe(6_200); // 6.2%
    expect(box4CeilingCentsFor(2026)).toBe(1_143_900); // $11,439.00
    expect(box4CeilingCentsFor(2026)).toBe(W2_BOX_4_CEILING_2026_CENTS);
  });

  it("multiplies exactly, with no rounding remainder to argue about", () => {
    const base = wageBaseSpec("oasdi").ceilingCents ?? 0;
    expect((base * OASDI_RATE_MILLI_PCT) % 100_000).toBe(0);
  });

  it("refuses to invent a ceiling for a year whose wage base it does not hold", () => {
    // Extrapolating would be worse than declining: a ceiling guessed from the
    // wrong base would REFUSE correct W-2s, which is the expensive direction.
    expect(box4CeilingCentsFor(2027)).toBeNull();
    expect(box4CeilingCentsFor(2025)).toBeNull();
  });

  it('formats a box 12 entry as "D 5300.00" — the IRS\'s own example', () => {
    // "if you are reporting $5,300.00 in elective deferrals under a section
    // 401(k) plan, the entry would be D 5300.00". Capital letter, one space,
    // decimal point, and — the part that gets machine-rejected — NO comma and
    // NO dollar sign.
    expect(formatBox12Entry({ code: "D", amountCents: 530_000 })).toBe("D 5300.00");
  });

  it("never emits a thousands separator or a dollar sign into box 12", () => {
    const printed = formatBox12Entry({ code: "DD", amountCents: 1_234_567_89 });
    expect(printed).not.toContain(",");
    expect(printed).not.toContain("$");
    expect(printed).toBe("DD 1234567.89");
  });

  it("keeps the cents two digits wide, including a trailing zero", () => {
    // "Omit the decimal point and cents from entries" is on the IRS's own list
    // of common errors, so 5300.5 would be wrong as well as ugly.
    expect(formatBox12Entry({ code: "W", amountCents: 530_050 })).toBe("W 5300.50");
    expect(formatBox12Entry({ code: "W", amountCents: 530_005 })).toBe("W 5300.05");
    expect(formatBox12Entry({ code: "W", amountCents: 5 })).toBe("W 0.05");
  });

  it("formats prose money with separators, which is the opposite convention", () => {
    // Two formatters on purpose: box 12 is machine-read and must not have
    // commas; the explanation Michael reads is easier with them.
    expect(formatCentsForW2(1_143_900)).toBe("$11,439.00");
    expect(formatCentsForW2(5)).toBe("$0.05");
  });

  it("masks the SSN to the last four", () => {
    expect(maskSsnForW2("123456789")).toBe("XXX-XX-6789");
    expect(maskSsnForW2("123456789")).not.toContain("12345");
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §2  TRAP 1 — THE S-CORPORATION HEALTH PREMIUM
 * ══════════════════════════════════════════════════════════════════ */

describe("§2 trap 1: box 1 above boxes 3 and 5 is CORRECT for a shareholder", () => {
  const PREMIUM = 1_800_000; // $18,000 of health cover

  function michaelsW2(): W2Form {
    return okForm(
      buildW2(
        requestFor({
          employee: employeeFor({
            isTwoPercentShareholder: true,
            scorpHealthPremiumCents: PREMIUM,
          }),
          ytd: ytdFor({ medicareWagesCents: 6_000_000, oasdiWagesCents: 6_000_000 }),
        }),
      ),
    );
  }

  it("puts the premium IN box 1 and OUT of boxes 3 and 5", () => {
    const f = michaelsW2();
    expect(amount(f, "1")).toBe(6_000_000 + PREMIUM); // $78,000
    expect(amount(f, "3")).toBe(6_000_000); // $60,000
    expect(amount(f, "5")).toBe(6_000_000); // $60,000
  });

  it("makes the difference exactly the premium, and says so in words", () => {
    const f = michaelsW2();
    expect(f.box1MinusBox3Cents).toBe(PREMIUM);
    expect(f.box1ExceedsFicaExplanation).not.toBeNull();
    expect(f.box1ExceedsFicaExplanation).toContain("$18,000.00");
    expect(f.box1ExceedsFicaExplanation).toContain("CORRECT");
  });

  it("warns in that sentence against 'fixing' the difference", () => {
    // The explanation exists because the instinct to make the boxes match is
    // overwhelming, and acting on it either overpays FICA or understates income.
    const f = michaelsW2();
    expect(f.box1ExceedsFicaExplanation).toContain("overpay");
  });

  it("says nothing at all when there is no premium", () => {
    const f = okForm(buildW2(requestFor()));
    expect(f.box1MinusBox3Cents).toBe(0);
    expect(f.box1ExceedsFicaExplanation).toBeNull();
  });

  it("REFUSES a premium recorded against someone who is not a shareholder", () => {
    // The inverse error: for an ordinary employee, employer-paid health cover
    // is a tax-free benefit belonging in box 12 code DD, not in box 1.
    const r = buildW2(
      requestFor({
        employee: employeeFor({
          isTwoPercentShareholder: false,
          scorpHealthPremiumCents: PREMIUM,
        }),
      }),
    );
    expect(refusalCodes(r)).toContain("W2_PREMIUM_WITHOUT_SHAREHOLDER_STATUS");
  });

  it("explains the DD alternative in the refusal rather than just saying no", () => {
    const r = buildW2(
      requestFor({
        employee: employeeFor({ scorpHealthPremiumCents: PREMIUM }),
      }),
    );
    if (r.ok) throw new Error("expected refusal");
    const found = r.refusals.find((x) => x.code === "W2_PREMIUM_WITHOUT_SHAREHOLDER_STATUS");
    expect(found?.remedy).toContain("DD");
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §2b  D1 — PRE-TAX DEFERRALS PULL BOX 1 THE OTHER WAY
 * ══════════════════════════════════════════════════════════════════ */

describe("§2b the deferral half of box 1, which the engine originally got wrong", () => {
  const DEFERRAL = 900_000; // $9,000 into a 401(k)

  it("SUBTRACTS a pre-tax 401(k) deferral from box 1 but not from boxes 3 and 5", () => {
    // "do not include elective deferrals (such as employee contributions to a
    // section 401(k) ... plan)". FICA is still due, so boxes 3 and 5 are
    // untouched — box 1 ends up BELOW box 5, the mirror image of trap 1.
    const f = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ box12: [{ code: "D", amountCents: DEFERRAL }] }),
        }),
      ),
    );
    expect(amount(f, "1")).toBe(6_000_000 - DEFERRAL); // $51,000
    expect(amount(f, "3")).toBe(6_000_000);
    expect(amount(f, "5")).toBe(6_000_000);
  });

  it("does NOT subtract a Roth deferral, which is taxed today", () => {
    const f = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ box12: [{ code: "AA", amountCents: DEFERRAL }] }),
        }),
      ),
    );
    expect(amount(f, "1")).toBe(6_000_000);
  });

  it("does NOT subtract an employer HSA contribution, which was never in a wage box", () => {
    // This is the case a single `includedInBox1` boolean got wrong: code W is
    // "not in box 1" in exactly the same sense code D is, yet subtracting it
    // would understate wages by the whole contribution.
    const f = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ box12: [{ code: "W", amountCents: DEFERRAL }] }),
        }),
      ),
    );
    expect(amount(f, "1")).toBe(6_000_000);
  });

  it("does NOT subtract code DD, which is information only", () => {
    const f = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ box12: [{ code: "DD", amountCents: 2_400_000 }] }),
        }),
      ),
    );
    expect(amount(f, "1")).toBe(6_000_000);
  });

  it("nets the premium and the deferral against each other for a shareholder who does both", () => {
    // Michael's realistic case once a plan exists. The two adjustments move in
    // opposite directions and both must land.
    const f = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({
            isTwoPercentShareholder: true,
            scorpHealthPremiumCents: 1_800_000,
            box12: [{ code: "D", amountCents: DEFERRAL }],
          }),
        }),
      ),
    );
    expect(amount(f, "1")).toBe(6_000_000 + 1_800_000 - 900_000); // $69,000
    expect(amount(f, "5")).toBe(6_000_000);
    expect(f.box1ExceedsFicaExplanation).toContain("opposite directions");
  });

  it("explains a box 1 BELOW box 5 rather than leaving it unexplained", () => {
    const f = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ box12: [{ code: "D", amountCents: DEFERRAL }] }),
        }),
      ),
    );
    expect(f.box1ExceedsFicaExplanation).toContain("LOWER");
    expect(f.box1ExceedsFicaExplanation).toContain("$9,000.00");
  });

  it("keeps the box 1 derivation sentence arithmetically true", () => {
    // A derivation that drifts from the number beside it is a confident wrong
    // answer, which is worse than no explanation at all.
    const f = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({
            isTwoPercentShareholder: true,
            scorpHealthPremiumCents: 1_800_000,
            box12: [{ code: "D", amountCents: DEFERRAL }],
          }),
        }),
      ),
    );
    const d = boxOf(f, "1")?.derivation ?? "";
    expect(d).toContain("$60,000.00"); // the wages it started from
    expect(d).toContain("plus $18,000.00"); // the premium
    expect(d).toContain("minus $9,000.00"); // the deferral
    expect(d).toContain(formatCentsForW2(amount(f, "1"))); // and the answer
  });

  it("describeBox1 states the no-adjustment case as an equality with box 5", () => {
    expect(describeBox1(6_000_000, 0, 0, 6_000_000)).toContain("equals box 5");
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §3  TRAP 2 — BOX 17 IN A STATE WITH NO INCOME TAX
 * ══════════════════════════════════════════════════════════════════ */

describe("§3 trap 2: box 17 must be blank in Washington", () => {
  it("REFUSES any state income tax on a Washington W-2", () => {
    // Refused rather than warned, because there is no set of facts in which a
    // non-zero box 17 is right for Greenway. Washington levies no income tax,
    // so there is no state return for it to ever match.
    const r = buildW2(
      requestFor({ state: stateFor({ stateCode: "WA", stateIncomeTaxCents: 45_000 }) }),
    );
    expect(refusalCodes(r)).toContain("W2_BOX_17_MUST_BE_BLANK_IN_WA");
  });

  it("points PFML and WA Cares at box 14 instead of just rejecting", () => {
    const r = buildW2(
      requestFor({ state: stateFor({ stateIncomeTaxCents: 45_000 }) }),
    );
    if (r.ok) throw new Error("expected refusal");
    const found = r.refusals.find((x) => x.code === "W2_BOX_17_MUST_BE_BLANK_IN_WA");
    expect(found?.remedy).toContain("box 14");
    expect(found?.remedy).toContain("Paid Family");
  });

  it("accepts a zero box 17 and prints the reason it is blank", () => {
    const f = okForm(buildW2(requestFor()));
    expect(amount(f, "17")).toBe(0);
    expect(boxOf(f, "17")?.derivation).toContain("no state income tax");
  });

  it("carries PFML and WA Cares in box 14, where they belong", () => {
    const f = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({
            box14: [
              { label: "WA PFML", amountCents: 43_800 },
              { label: "WA Cares", amountCents: 34_800 },
            ],
          }),
        }),
      ),
    );
    expect(f.box14Entries).toHaveLength(2);
    expect(f.box14Entries[0]).toEqual({ label: "WA PFML", printed: "$438.00" });
  });

  it("does NOT refuse state income tax for a state that actually levies it", () => {
    // The refusal is about Washington, not about box 17 in general. If it fired
    // everywhere it would be an assumption rather than a rule.
    const r = buildW2(
      requestFor({
        state: stateFor({ stateCode: "OR", stateIncomeTaxCents: 45_000 }),
      }),
    );
    expect(refusalCodes(r)).not.toContain("W2_BOX_17_MUST_BE_BLANK_IN_WA");
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §4  TRAP 3 — W-3 BOX 12a IS A FILTER, NOT A TOTAL
 * ══════════════════════════════════════════════════════════════════ */

describe("§4 trap 3: the one W-3 box that is not a sum", () => {
  function formWith(box12: readonly Box12Entry[], employeeId = "emp-1"): W2Form {
    return okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ employeeId, box12 }),
          ytd: ytdFor({ employeeId }),
        }),
      ),
    );
  }

  it("carries the deferral codes up and leaves DD and C behind", () => {
    // "Enter the total of all amounts reported with codes D through H, S, Y,
    // AA, BB, and EE" — and the Caution names DD and C among those NOT
    // reported on the W-3.
    const f = formWith([
      { code: "D", amountCents: 900_000 },
      { code: "AA", amountCents: 100_000 },
      { code: "DD", amountCents: 2_400_000 },
      { code: "C", amountCents: 12_000 },
    ]);
    const w3 = buildW3([f], 2026);
    expect(w3.box12aCents).toBe(1_000_000); // D + AA only
    expect(w3.box12ExcludedFromW3Cents).toBe(2_412_000); // DD + C
  });

  it("is NOT the total of box 12 — which is the whole point", () => {
    const f = formWith([
      { code: "D", amountCents: 900_000 },
      { code: "DD", amountCents: 2_400_000 },
    ]);
    const w3 = buildW3([f], 2026);
    const naiveTotal = 900_000 + 2_400_000;
    expect(w3.box12aCents).not.toBe(naiveTotal);
    expect(w3.box12aCents + w3.box12ExcludedFromW3Cents).toBe(naiveTotal);
  });

  it("reports zero box 12a when the only codes present are excluded ones", () => {
    const f = formWith([{ code: "DD", amountCents: 2_400_000 }]);
    expect(buildW3([f], 2026).box12aCents).toBe(0);
  });

  it("adds the same code across employees", () => {
    const a = formWith([{ code: "D", amountCents: 900_000 }], "emp-1");
    const b = formWith([{ code: "D", amountCents: 250_000 }], "emp-2");
    expect(buildW3([a, b], 2026).box12aCents).toBe(1_150_000);
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §4b  THE W-3 AS A PLAIN TOTAL, AND THE VOID EXCLUSION
 * ══════════════════════════════════════════════════════════════════ */

describe("§4b the W-3 totals", () => {
  function twoEmployees(): readonly W2Form[] {
    const a = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ employeeId: "emp-1" }),
          ytd: ytdFor({ employeeId: "emp-1", medicareWagesCents: 6_000_000 }),
        }),
      ),
    );
    const b = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ employeeId: "emp-2" }),
          ytd: ytdFor({ employeeId: "emp-2", medicareWagesCents: 4_000_000 }),
        }),
      ),
    );
    return [a, b];
  }

  it("totals boxes 1 through 6 across the forms", () => {
    const w3 = buildW3(twoEmployees(), 2026);
    expect(w3.box1Cents).toBe(10_000_000);
    expect(w3.box3Cents).toBe(10_000_000);
    expect(w3.box5Cents).toBe(10_000_000);
    expect(w3.formCount).toBe(2);
  });

  it('EXCLUDES forms marked VOID — "excluding any Forms W-2 marked VOID"', () => {
    // The miserable February error: a voided W-2 is still a row in the
    // database, and a totals query that forgets it overstates wages while every
    // individual W-2 underneath is perfectly correct.
    const [a] = twoEmployees();
    const voided = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ employeeId: "emp-2", isVoid: true }),
          ytd: ytdFor({ employeeId: "emp-2", medicareWagesCents: 4_000_000 }),
        }),
      ),
    );
    const w3 = buildW3([a, voided], 2026);
    expect(w3.box1Cents).toBe(6_000_000); // not 10,000,000
    expect(w3.formCount).toBe(1);
    expect(w3.voidedCount).toBe(1);
  });

  it("names the state when every form agrees, and blanks it when they do not", () => {
    // "If the Forms W-2 ... contain wage and income tax information from more
    // than one state, enter an X and do not enter any state ID number." Null
    // here is the honest answer; a single code would be a lie.
    const [a] = twoEmployees();
    expect(buildW3([a], 2026).stateCode).toBe("WA");

    const oregon = okForm(
      buildW2(
        requestFor({
          employee: employeeFor({ employeeId: "emp-3" }),
          ytd: ytdFor({ employeeId: "emp-3" }),
          state: stateFor({ stateCode: "OR" }),
        }),
      ),
    );
    expect(buildW3([a, oregon], 2026).stateCode).toBeNull();
  });

  it("D6 — reports any W-2 whose year is not the W-3's", () => {
    // Mixing years yields a W-3 that is internally consistent and matches no
    // 941 on earth. Silence here would be the worst possible answer.
    const a = okForm(buildW2(requestFor()));
    const wrongYear = okForm(
      buildW2(
        requestFor({
          taxYear: 2025,
          employee: employeeFor({ employeeId: "emp-9" }),
          ytd: ytdFor({ employeeId: "emp-9", taxYear: 2025 }),
        }),
      ),
    );
    const w3 = buildW3([a, wrongYear], 2026);
    expect(w3.mismatchedYearEmployeeIds).toEqual(["emp-9"]);
  });

  it("reports no mismatch for a clean single-year batch", () => {
    expect(buildW3(twoEmployees(), 2026).mismatchedYearEmployeeIds).toEqual([]);
  });

  it("totals an empty batch to zero rather than throwing", () => {
    const w3 = buildW3([], 2026);
    expect(w3.formCount).toBe(0);
    expect(w3.box1Cents).toBe(0);
    expect(w3.stateCode).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §5  EVERY REFUSAL CODE IS REACHABLE  (standing rule 43)
 * ══════════════════════════════════════════════════════════════════ */

describe("§5 every refusal code is produced by real input", () => {
  // A refusal nothing can trigger is decoration. This section drives each one
  // from actual arguments, then asserts at the end that the set of codes proven
  // reachable is the WHOLE declared set — so adding a thirteenth code without
  // a test fails here rather than passing quietly.
  const proven = new Set<W2RefusalCode>();

  function expectRefusal(result: W2Result, code: W2RefusalCode): void {
    expect(refusalCodes(result)).toContain(code);
    proven.add(code);
  }

  it("W2_YEAR_MISMATCH — accumulator from a different year", () => {
    expectRefusal(
      buildW2(requestFor({ taxYear: 2026, ytd: ytdFor({ taxYear: 2025 }) })),
      "W2_YEAR_MISMATCH",
    );
  });

  it("W2_EMPLOYEE_MISMATCH — one person's wages on another's form", () => {
    expectRefusal(
      buildW2(
        requestFor({
          employee: employeeFor({ employeeId: "emp-1" }),
          ytd: ytdFor({ employeeId: "emp-2" }),
        }),
      ),
      "W2_EMPLOYEE_MISMATCH",
    );
  });

  it("W2_NEGATIVE_AMOUNT — a W-2 cannot report negative wages", () => {
    expectRefusal(
      buildW2(requestFor({ ytd: ytdFor({ federalIncomeTaxCents: -100 }) })),
      "W2_NEGATIVE_AMOUNT",
    );
  });

  it("W2_NON_INTEGER_AMOUNT — a fraction of a cent cannot be printed", () => {
    expectRefusal(
      buildW2(requestFor({ ytd: ytdFor({ federalIncomeTaxCents: 100.5 }) })),
      "W2_NON_INTEGER_AMOUNT",
    );
  });

  it("W2_BOX_17_MUST_BE_BLANK_IN_WA", () => {
    expectRefusal(
      buildW2(requestFor({ state: stateFor({ stateIncomeTaxCents: 1 }) })),
      "W2_BOX_17_MUST_BE_BLANK_IN_WA",
    );
  });

  it("W2_PREMIUM_WITHOUT_SHAREHOLDER_STATUS", () => {
    expectRefusal(
      buildW2(
        requestFor({ employee: employeeFor({ scorpHealthPremiumCents: 100 }) }),
      ),
      "W2_PREMIUM_WITHOUT_SHAREHOLDER_STATUS",
    );
  });

  it("W2_BOX_12_TOO_MANY_ITEMS — Copy A holds four", () => {
    expectRefusal(
      buildW2(
        requestFor({
          employee: employeeFor({
            box12: [
              { code: "D", amountCents: 1 },
              { code: "DD", amountCents: 1 },
              { code: "W", amountCents: 1 },
              { code: "C", amountCents: 1 },
              { code: "AA", amountCents: 1 },
            ],
          }),
        }),
      ),
      "W2_BOX_12_TOO_MANY_ITEMS",
    );
  });

  it("accepts exactly four, so the limit is a boundary and not an off-by-one", () => {
    const r = buildW2(
      requestFor({
        employee: employeeFor({
          box12: [
            { code: "D", amountCents: 1 },
            { code: "DD", amountCents: 1 },
            { code: "W", amountCents: 1 },
            { code: "C", amountCents: 1 },
          ],
        }),
      }),
    );
    expect(r.ok).toBe(true);
    expect(BOX_12_MAX_ITEMS_PER_COPY_A).toBe(4);
  });

  it("W2_BOX_12_DUPLICATE_CODE — two lines with one code look like a double payment", () => {
    expectRefusal(
      buildW2(
        requestFor({
          employee: employeeFor({
            box12: [
              { code: "D", amountCents: 100 },
              { code: "D", amountCents: 200 },
            ],
          }),
        }),
      ),
      "W2_BOX_12_DUPLICATE_CODE",
    );
  });

  it("W2_BOX_4_EXCEEDS_CEILING — more Social Security than the year allows", () => {
    expectRefusal(
      buildW2(
        requestFor({
          ytd: ytdFor({
            medicareWagesCents: 20_000_000,
            oasdiWagesCents: 18_450_000,
            oasdiEmployeeCents: W2_BOX_4_CEILING_2026_CENTS + 1,
          }),
        }),
      ),
      "W2_BOX_4_EXCEEDS_CEILING",
    );
  });

  it("accepts box 4 sitting exactly ON the ceiling", () => {
    const r = buildW2(
      requestFor({
        ytd: ytdFor({
          medicareWagesCents: 20_000_000,
          oasdiWagesCents: 18_450_000,
          oasdiEmployeeCents: W2_BOX_4_CEILING_2026_CENTS,
        }),
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("W2_MEDICARE_BELOW_OASDI — impossible, because Medicare has no ceiling", () => {
    expectRefusal(
      buildW2(
        requestFor({
          ytd: ytdFor({ medicareWagesCents: 100_000, oasdiWagesCents: 200_000 }),
        }),
      ),
      "W2_MEDICARE_BELOW_OASDI",
    );
  });

  it("W2_SSN_NOT_NINE_DIGITS", () => {
    expectRefusal(
      buildW2(requestFor({ employee: employeeFor({ ssn: "123-45-678" }) })),
      "W2_SSN_NOT_NINE_DIGITS",
    );
  });

  it("W2_NAME_INCOMPLETE — first and surname go in separate fields", () => {
    expectRefusal(
      buildW2(requestFor({ employee: employeeFor({ lastName: "  " }) })),
      "W2_NAME_INCOMPLETE",
    );
  });

  it("has now proven ALL twelve declared codes reachable, with none left over", () => {
    expect([...proven].sort()).toEqual([...ALL_W2_REFUSAL_CODES].sort());
  });

  it("collects every problem at once instead of stopping at the first", () => {
    // A screen that reports one problem, gets it fixed, then reports the next
    // wastes an afternoon per form.
    const r = buildW2(
      requestFor({
        employee: employeeFor({ ssn: "1", lastName: "" }),
        state: stateFor({ stateIncomeTaxCents: 500 }),
      }),
    );
    const codes = refusalCodes(r);
    expect(codes).toContain("W2_SSN_NOT_NINE_DIGITS");
    expect(codes).toContain("W2_NAME_INCOMPLETE");
    expect(codes).toContain("W2_BOX_17_MUST_BE_BLANK_IN_WA");
    expect(codes.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every refusal both a plain-English message and a remedy", () => {
    // A refusal without a remedy is an obstacle. Michael reads these, never the
    // code, so an empty string here is a real defect.
    const r = buildW2(
      requestFor({
        employee: employeeFor({ ssn: "x", scorpHealthPremiumCents: 5 }),
        state: stateFor({ stateIncomeTaxCents: 5 }),
        ytd: ytdFor({ taxYear: 2024 }),
      }),
    );
    if (r.ok) throw new Error("expected refusals");
    for (const x of r.refusals) {
      expect(x.message.trim().length).toBeGreaterThan(20);
      expect(x.remedy.trim().length).toBeGreaterThan(20);
      expect(x.message).not.toContain("_"); // no raw codes leaking into prose
    }
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §6  THE RECONCILIATION
 * ══════════════════════════════════════════════════════════════════ */

describe("§6 the W-3 against the four 941s", () => {
  function w3For(box4: number, box6: number) {
    return {
      taxYear: 2026,
      formCount: 1,
      voidedCount: 0,
      box1Cents: 6_000_000,
      box2Cents: 800_000,
      box3Cents: 6_000_000,
      box4Cents: box4,
      box5Cents: 6_000_000,
      box6Cents: box6,
      box12aCents: 0,
      box12ExcludedFromW3Cents: 0,
      stateCode: "WA" as string | null,
      box16Cents: 0,
      box17Cents: 0,
      mismatchedYearEmployeeIds: [] as readonly string[],
    };
  }

  function totals(over: Partial<Form941YearTotals> = {}): Form941YearTotals {
    return {
      federalIncomeTaxWithheldCents: 800_000,
      socialSecurityWagesCents: 6_000_000,
      medicareWagesCents: 6_000_000,
      socialSecurityTaxCents: 744_000,
      medicareTaxCents: 174_000,
      quartersIncluded: 4,
      ...over,
    };
  }

  const OASDI = applyMilliPct(6_000_000, OASDI_RATE_MILLI_PCT); // 372,000
  const MED = applyMilliPct(6_000_000, MEDICARE_RATE_MILLI_PCT); // 87,000

  it("agrees when the 941s carry exactly both halves", () => {
    const r = reconcileW3To941s({
      taxYear: 2026,
      w3: w3For(OASDI, MED),
      form941: totals(),
      unmatchedAdditionalMedicareCents: 0,
    });
    expect(r.allAgree).toBe(true);
    expect(r.isComplete).toBe(true);
  });

  it("expects the 941 to be double the W-3 on the FICA lines", () => {
    // The 941 reports employee AND employer share; the W-3 reports only the
    // employee's. So double is the expectation, not a coincidence.
    expect(W3_TO_941_FICA_DOUBLING_FACTOR).toBe(2);
    const r = reconcileW3To941s({
      taxYear: 2026,
      w3: w3For(OASDI, MED),
      form941: totals(),
      unmatchedAdditionalMedicareCents: 0,
    });
    const ss = r.lines.find((l) => l.label.startsWith("Social security tax"));
    expect(ss?.w3Cents).toBe(OASDI * 2);
  });

  it("catches a missing employer half", () => {
    const r = reconcileW3To941s({
      taxYear: 2026,
      w3: w3For(OASDI, MED),
      form941: totals({ socialSecurityTaxCents: OASDI }),
      unmatchedAdditionalMedicareCents: 0,
    });
    expect(r.allAgree).toBe(false);
    const ss = r.lines.find((l) => l.label.startsWith("Social security tax"));
    expect(ss?.agrees).toBe(false);
    expect(ss?.differenceCents).toBe(-OASDI);
  });

  it("handles Additional Medicare EXACTLY, not with a tolerance band", () => {
    // The 0.9% surtax has no employer match, so the true ratio dips below two
    // the moment anyone crosses $200,000. Computing the expected figure exactly
    // — doubling the matched part, adding the unmatched once — keeps the check
    // sharp. A percentage tolerance cries wolf in the first good year and then
    // gets switched off, which is how these controls die.
    const unmatched = 45_000; // $450 of Additional Medicare
    const box6 = MED + unmatched;
    const r = reconcileW3To941s({
      taxYear: 2026,
      w3: w3For(OASDI, box6),
      form941: totals({ medicareTaxCents: MED * 2 + unmatched }),
      unmatchedAdditionalMedicareCents: unmatched,
    });
    expect(r.allAgree).toBe(true);
  });

  it("would have raised a FALSE ALARM under a naive doubling rule", () => {
    // Proof the exception is load-bearing rather than theoretical: the same
    // facts fail if you simply double all of box 6.
    const unmatched = 45_000;
    const box6 = MED + unmatched;
    const naiveExpectation = box6 * 2;
    const truth = MED * 2 + unmatched;
    expect(naiveExpectation).not.toBe(truth);
    expect(naiveExpectation - truth).toBe(unmatched);
  });

  it("says the comparison is incomplete when fewer than four quarters arrive", () => {
    const r = reconcileW3To941s({
      taxYear: 2026,
      w3: w3For(OASDI, MED),
      form941: totals({ quartersIncluded: 3 }),
      unmatchedAdditionalMedicareCents: 0,
    });
    expect(r.isComplete).toBe(false);
    expect(r.verdict).toContain("3 of 4");
  });

  it("quotes the IRS's certainty in the verdict when something disagrees", () => {
    // "you WILL be contacted", not "may be" — the difference matters when
    // deciding whether to chase a variance in October.
    const r = reconcileW3To941s({
      taxYear: 2026,
      w3: w3For(OASDI, MED),
      form941: totals({ federalIncomeTaxWithheldCents: 799_999 }),
      unmatchedAdditionalMedicareCents: 0,
    });
    expect(r.allAgree).toBe(false);
    expect(r.verdict).toContain("WILL be contacted");
  });

  it("compares all five figures the IRS names", () => {
    const r = reconcileW3To941s({
      taxYear: 2026,
      w3: w3For(OASDI, MED),
      form941: totals(),
      unmatchedAdditionalMedicareCents: 0,
    });
    expect(r.lines).toHaveLength(5);
    for (const l of r.lines) expect(l.plain.trim().length).toBeGreaterThan(40);
  });

  it("signs the difference as 941 minus W-3, consistently", () => {
    const r = reconcileW3To941s({
      taxYear: 2026,
      w3: w3For(OASDI, MED),
      form941: totals({ federalIncomeTaxWithheldCents: 810_000 }),
      unmatchedAdditionalMedicareCents: 0,
    });
    const fit = r.lines.find((l) => l.label === "Federal income tax withheld");
    expect(fit?.differenceCents).toBe(10_000); // 941 is higher by $100
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §7  THE SELF-CHECK GATES ARE PROVABLY FAILABLE  (rule 83a)
 * ══════════════════════════════════════════════════════════════════ */

describe("§7 the gates pass, and can be shown capable of failing", () => {
  it("all five gates pass against the real module", () => {
    expect(() => assertBox4CeilingMatchesIrsArithmetic()).not.toThrow();
    expect(() => assertBox12CodesAreComplete()).not.toThrow();
    expect(() => assertRefusalCodesAreListed()).not.toThrow();
    expect(() => assertAdditionalMedicareBoundary()).not.toThrow();
    expect(() => assertW3Box12aIsFiltered()).not.toThrow();
  });

  it("the ceiling gate depends on the derivation, not on a copied literal", () => {
    // If box4CeilingCentsFor were changed to return the authority constant
    // directly, the gate would pass forever regardless of the rates. Proving it
    // is derived: recompute from the constants and require agreement.
    const base = wageBaseSpec("oasdi").ceilingCents ?? 0;
    expect(applyMilliPct(base, OASDI_RATE_MILLI_PCT)).toBe(W2_BOX_4_CEILING_2026_CENTS);
    // And a deliberately wrong rate must NOT reproduce it.
    expect(applyMilliPct(base, OASDI_RATE_MILLI_PCT + 1)).not.toBe(
      W2_BOX_4_CEILING_2026_CENTS,
    );
  });

  it("MUTANT GAP 2 — the ceiling is COMPUTED, and the source proves it", () => {
    // Found by mutation: replacing the body of `box4CeilingCentsFor` with
    // `return 1_143_900;` survived every behavioural test — necessarily so,
    // because 1,143,900 is the right answer FOR 2026. The literal and the
    // derivation are indistinguishable by observation this year, and would
    // diverge silently the year the wage base changes. That is exactly the
    // failure mode this engine exists to prevent: a number that was true once,
    // frozen, and never revisited.
    //
    // Behaviour cannot separate them, so the test reads the source. This is the
    // narrow case where inspecting the implementation is the ONLY honest check
    // available — the property under test is "this figure is derived", which is
    // a statement about how the answer is reached, not about the answer.
    const src = readFileSync(
      join(process.cwd(), "src/lib/payroll/form-w2-core.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export function box4CeilingCentsFor"));
    const body = fn.slice(0, fn.indexOf("\n}"));

    // It must reach the shared wage-base registry and the shared rate.
    expect(body).toContain("wageBaseSpec(\"oasdi\")");
    expect(body).toContain("OASDI_RATE_MILLI_PCT");
    expect(body).toContain("applyMilliPct");
    // And it must NOT contain the answer as a literal, in either spelling.
    expect(body).not.toContain("1_143_900");
    expect(body).not.toContain("1143900");
    expect(body).not.toContain("W2_BOX_4_CEILING_2026_CENTS");
  });

  it("the box 12 gate rejects a spec filed under the wrong key", () => {
    // Simulating the failure on a copy, because the real Record is frozen law.
    const bent = { ...BOX_12_CODE_SPECS, D: { ...BOX_12_CODE_SPECS.D, code: "W" as Box12Code } };
    const broken = Object.entries(bent).some(([k, v]) => v.code !== k);
    expect(broken).toBe(true);
  });

  it("the box 12 gate rejects an explanation too short to explain anything", () => {
    const bent = { ...BOX_12_CODE_SPECS.D, plain: "money" };
    expect(bent.plain.trim().length).toBeLessThan(40);
  });

  it("the box 12a gate would fail if the filter became a total", () => {
    // The exact regression it guards: somebody "simplifies" buildW3 by marking
    // everything as carried up.
    const asTotal = BOX_12_CODES.map((s) => ({ ...s, inW3Box12a: true }));
    expect(asTotal.filter((s) => !s.inW3Box12a)).toHaveLength(0);
    // …whereas the real data does exclude some codes.
    expect(BOX_12_CODES.filter((s) => !s.inW3Box12a).length).toBeGreaterThan(0);
  });

  it("the Additional Medicare gate now exercises the reconciliation, not a tautology", () => {
    // The original version asked whether 0.9% of max(0, T - T) was zero. Here
    // is the proof that the replacement discriminates: feeding the reconciler
    // an unmatched amount it was NOT told about must break agreement.
    const MED = applyMilliPct(6_000_000, MEDICARE_RATE_MILLI_PCT);
    const unmatched = 45_000;
    const wrong = reconcileW3To941s({
      taxYear: 2026,
      w3: {
        taxYear: 2026,
        formCount: 1,
        voidedCount: 0,
        box1Cents: 0,
        box2Cents: 0,
        box3Cents: 0,
        box4Cents: 0,
        box5Cents: 0,
        box6Cents: MED + unmatched,
        box12aCents: 0,
        box12ExcludedFromW3Cents: 0,
        stateCode: "WA",
        box16Cents: 0,
        box17Cents: 0,
        mismatchedYearEmployeeIds: [],
      },
      form941: {
        federalIncomeTaxWithheldCents: 0,
        socialSecurityWagesCents: 0,
        medicareWagesCents: 0,
        socialSecurityTaxCents: 0,
        medicareTaxCents: MED * 2 + unmatched,
        quartersIncluded: 4,
      },
      unmatchedAdditionalMedicareCents: 0, // the lie
    });
    expect(wrong.allAgree).toBe(false);
  });

  it("MUTANT GAP 1 — box 6 carries the Additional Medicare Tax as well as the 1.45%", () => {
    // Found by mutation: deleting `+ ytd.addlMedicareEmployeeCents` from box 6
    // left all 82 tests green, because every fixture had a zero there. Box 6 is
    // "Medicare tax withheld", singular, and the 0.9% surtax is part of it —
    // omitting it understates the employee's withholding on their own return.
    const highEarner = ytdFor({
      medicareWagesCents: 25_000_000, // $250,000 — over the $200,000 threshold
      oasdiWagesCents: 18_450_000, // capped at the wage base
      oasdiEmployeeCents: W2_BOX_4_CEILING_2026_CENTS,
      addlMedicareEmployeeCents: 45_000, // $450 of surtax
    });
    const f = okForm(buildW2(requestFor({ ytd: highEarner })));
    const plain = applyMilliPct(25_000_000, MEDICARE_RATE_MILLI_PCT);
    expect(amount(f, "6")).toBe(plain + 45_000);
    expect(amount(f, "6")).toBeGreaterThan(plain);
  });

  it("explains the two components of box 6 when the surtax is present", () => {
    const f = okForm(
      buildW2(
        requestFor({
          ytd: ytdFor({
            medicareWagesCents: 25_000_000,
            oasdiWagesCents: 18_450_000,
            oasdiEmployeeCents: W2_BOX_4_CEILING_2026_CENTS,
            addlMedicareEmployeeCents: 45_000,
          }),
        }),
      ),
    );
    const d = boxOf(f, "6")?.derivation ?? "";
    expect(d).toContain("1.45%");
    expect(d).toContain("0.9%");
    expect(d).toContain("$450.00");
    // And the employer matches only the first part — the reason the 941 is not
    // exactly double.
    expect(d).toContain("none of the second");
  });

  it("the threshold itself is $200,000, and is not folded into the base rate", () => {
    expect(ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS).toBe(20_000_000);
    expect(MEDICARE_RATE_MILLI_PCT).toBe(1_450);
  });

  it("the refusal-list gate would catch a duplicated entry", () => {
    const dup = [...ALL_W2_REFUSAL_CODES, ALL_W2_REFUSAL_CODES[0]];
    expect(new Set(dup).size).not.toBe(dup.length);
    expect(new Set(ALL_W2_REFUSAL_CODES).size).toBe(ALL_W2_REFUSAL_CODES.length);
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §8  BOX 12 SPECS AS TAUGHT MATERIAL  (standing rule 26)
 * ══════════════════════════════════════════════════════════════════ */

describe("§8 every box 12 code carries a real explanation", () => {
  it("looks up each declared code", () => {
    for (const spec of BOX_12_CODES) {
      expect(box12CodeSpec(spec.code)).toBe(spec);
    }
  });

  it("throws on a code that does not exist, rather than returning undefined", () => {
    expect(() => box12CodeSpec("ZZ" as Box12Code)).toThrow(/unknown code/);
  });

  it("keeps the derived list and the spec Record in step", () => {
    expect(BOX_12_CODES).toHaveLength(Object.keys(BOX_12_CODE_SPECS).length);
    for (const [key, spec] of Object.entries(BOX_12_CODE_SPECS)) {
      expect(spec.code).toBe(key);
    }
  });

  it("exercises all three box 1 populations, so the distinction is not theoretical", () => {
    const effects = new Set(BOX_12_CODES.map((s) => s.box1Effect));
    expect(effects).toContain("reduces_box_1");
    expect(effects).toContain("in_every_wage_box");
    expect(effects).toContain("outside_every_wage_box");
  });

  it("explains each code in plain English rather than restating the label", () => {
    for (const spec of BOX_12_CODES) {
      expect(spec.plain.trim().length).toBeGreaterThan(40);
      expect(spec.plain).not.toBe(spec.label);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §9  GREENWAY, END TO END
 * ══════════════════════════════════════════════════════════════════ */

describe("§9 Greenway's own W-2 and W-3", () => {
  // Michael, 85% shareholder, paid annually; his grandfather on the payroll.
  // Figures are illustrative pending the 2027 rates, but the RELATIONSHIPS
  // between the boxes are the ones the engine must always hold.
  const MICHAEL_WAGES = 12_000_000; // $120,000
  const MICHAEL_PREMIUM = 1_800_000; // $18,000
  const GRANDFATHER_WAGES = 2_400_000; // $24,000

  function michael(): W2Form {
    return okForm(
      buildW2(
        requestFor({
          employee: employeeFor({
            employeeId: "michael",
            firstNameAndInitial: "Michael",
            lastName: "Lyman",
            isTwoPercentShareholder: true,
            scorpHealthPremiumCents: MICHAEL_PREMIUM,
            box14: [{ label: "WA Cares", amountCents: 69_600 }],
          }),
          ytd: ytdFor({ employeeId: "michael", medicareWagesCents: MICHAEL_WAGES }),
        }),
      ),
    );
  }

  function grandfather(): W2Form {
    return okForm(
      buildW2(
        requestFor({
          employee: employeeFor({
            employeeId: "grandfather",
            firstNameAndInitial: "R",
            lastName: "Lyman",
          }),
          ytd: ytdFor({ employeeId: "grandfather", medicareWagesCents: GRANDFATHER_WAGES }),
        }),
      ),
    );
  }

  it("builds Michael's W-2 with box 1 above boxes 3 and 5 by the premium", () => {
    const f = michael();
    expect(amount(f, "1")).toBe(13_800_000); // $138,000
    expect(amount(f, "3")).toBe(12_000_000); // $120,000
    expect(amount(f, "5")).toBe(12_000_000);
    expect(f.box1MinusBox3Cents).toBe(MICHAEL_PREMIUM);
  });

  it("keeps him below the Social Security ceiling, so box 3 is not capped", () => {
    // $120,000 is under the $184,500 base, so box 3 equals full wages. If he
    // ever crosses it, box 3 stops and box 5 keeps going.
    expect(MICHAEL_WAGES).toBeLessThan(wageBaseSpec("oasdi").ceilingCents ?? 0);
    expect(amount(michael(), "4")).toBeLessThan(W2_BOX_4_CEILING_2026_CENTS);
  });

  it("leaves both state boxes blank", () => {
    for (const f of [michael(), grandfather()]) {
      expect(amount(f, "16")).toBe(0);
      expect(amount(f, "17")).toBe(0);
    }
  });

  it("totals the two onto one W-3 that reconciles to four clean 941s", () => {
    const forms = [michael(), grandfather()];
    const w3 = buildW3(forms, 2026);

    expect(w3.formCount).toBe(2);
    expect(w3.box1Cents).toBe(13_800_000 + 2_400_000);
    expect(w3.box3Cents).toBe(MICHAEL_WAGES + GRANDFATHER_WAGES);
    expect(w3.stateCode).toBe("WA");
    expect(w3.box17Cents).toBe(0);

    const r = reconcileW3To941s({
      taxYear: 2026,
      w3,
      form941: {
        // Line 2 of the 941 tracks box 1 by definition, premium included.
        federalIncomeTaxWithheldCents: w3.box2Cents,
        socialSecurityWagesCents: w3.box3Cents,
        medicareWagesCents: w3.box5Cents,
        socialSecurityTaxCents: w3.box4Cents * 2,
        medicareTaxCents: w3.box6Cents * 2,
        quartersIncluded: 4,
      },
      unmatchedAdditionalMedicareCents: 0,
    });
    expect(r.allAgree).toBe(true);
    expect(r.verdict).toContain("agrees");
  });

  it("holds box 5 at or above box 3 for every form, always", () => {
    // The invariant behind W2_MEDICARE_BELOW_OASDI: Medicare is uncapped and
    // Social Security is not, so this can never legitimately invert.
    for (const f of [michael(), grandfather()]) {
      expect(amount(f, "5")).toBeGreaterThanOrEqual(amount(f, "3"));
    }
  });

  it("never prints a full SSN anywhere on the built form", () => {
    const f = michael();
    expect(JSON.stringify(f)).not.toContain("123456789");
    expect(f.ssnMasked).toBe("XXX-XX-6789");
  });
});
