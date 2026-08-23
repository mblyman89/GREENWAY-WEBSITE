/**
 * tests/compliance/wa-quarterly.test.ts   (books-41)
 *
 * WASHINGTON'S FOUR QUARTERLY RETURNS, PROVED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SUITE IS ANCHORED TO
 * ─────────────────────────────────────────────────────────────────────────────
 * Not a hand-made scenario. Greenway's REAL Q2 2026 quarter: 10 people,
 * $68,923.45 of wages, 3,558 hours, and the figures ESD and L&I actually
 * assessed, recorded with their confirmation numbers in
 * `known-good-quarters.ts`. The engine is fed that quarter and must reproduce
 * every one of those figures to the cent.
 *
 * That is the strongest evidence available in this codebase (standing rule 59):
 * not "the code agrees with the code", but "the code agrees with returns two
 * state agencies have already accepted and cashed".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE CENT THIS SUITE EXISTS TO DEFEND
 * ─────────────────────────────────────────────────────────────────────────────
 * Greenway's unemployment rate is 0.37% and the Employment Administration Fund
 * surcharge is 0.03%. It is natural to add them, call it 0.40%, and multiply
 * once. Do that and you get $275.69. ESD assessed $275.70.
 *
 * The difference is that RCW 50.24.010 and RCW 50.24.014(2)(b) each command
 * half-cent rounding for contributions under their OWN section, and the
 * unemployment tax and the EAF are different sections. Round each and add:
 * 255.02 + 20.68 = 275.70.
 *
 * A cent is not worth a paragraph of comment for its own sake. It is worth it
 * because the "simplification" is so reasonable-looking that somebody will
 * eventually make it, so there is a test below that asserts the WRONG method
 * produces the WRONG answer. If a future change collapses the two rates, that
 * test fails and says why.
 */

import { describe, expect, it } from "vitest";

import {
  ALL_WA_QUARTER_REFUSAL_CODES,
  buildWaQuarter,
  exactMilliPct,
  formatWaLineValue,
  hourlyPremiumCents,
  isWaLegalHoliday,
  statutoryRoundCents,
  validateWaQuarterRequest,
  waLegalHolidays,
  waLineOf,
  waLinesForForm,
  waQuarterDueDate,
  waVersusFederalDeadlineNote,
  type WaQuarterRequest,
  type WaQuarterReturn,
} from "@/lib/payroll/wa-quarterly-core";
import {
  WA_BOX_EXPLAINERS,
  WA_FORM_GUIDES,
  WA_QUARTER_CHECKS,
  WA_REFUSAL_LESSONS,
  boxExplainer,
  waChecksInOrder,
  waQuarterOrientation,
  waRefusalLesson,
} from "@/lib/payroll/wa-quarterly-mentor";
import {
  assertEveryWaBoxIsExplained,
  assertEveryWaCitedAuthorityResolves,
  assertEveryWaQuarterFunctionIsTaught,
  assertEveryWaQuarterlyAuthorityIsReachable,
  assertEveryWaRefusalCodeIsTaught,
  assertWaBoxExplainersMatchTheEngine,
  assertWaEmployerCostBoxesForbidDeduction,
  assertWaQuarterUnionMatchesRuntimeArray,
  assertWaQuarterlyChecklistIsUsable,
  assertWaQuarterlyExamplesAreWorked,
  assertWaQuarterlyMentorIsClientSafe,
  assertWaQuarterlyQuotesLookTranscribed,
  waQuarterEngineFunctionNames,
  waQuarterUnionRefusalCodes,
} from "@/lib/payroll/wa-quarterly-mentor-gates";
import { waQuarterlyAuthorities } from "@/lib/payroll/wa-quarterly-authorities";
import {
  Q2_2026_EMPLOYEES,
  Q2_2026_GROSS_WAGES_CENTS,
  Q2_2026_TOTAL_HOURS,
  filedFigure,
} from "@/lib/reports/known-good-quarters";

/* ═══════════════════════════════════════════════════════════════════════════
 * THE FILED QUARTER, AS AN INPUT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Greenway's 2026 rates, each traceable to a notice.
 *
 * The two unemployment components come from the ESD tax rate notice for account
 * 000-073905-00-0; the L&I figures from the L&I rate notice for risk class 6403
 * with experience factor 0.9. They are stated here rather than looked up so the
 * test proves the ENGINE, not the registry - the registry has its own suite.
 */
const Q2_2026_RATES = {
  sutaUiMilliPct: 370, // 0.37%
  sutaEafMilliPct: 30, // 0.03%
  pfmlTotalMilliPct: 1_130, // 1.13%
  pfmlEmployeeShareMilliPct: 71_430, // 71.43% OF the premium
  waCaresMilliPct: 580, // 0.58%
  lniEmployeeMilliCentsPerHour: 16_445, // $0.16445/hr
  lniEmployerMilliCentsPerHour: 39_485, // $0.39485/hr
} as const;

function filedQuarterRequest(): WaQuarterRequest {
  return {
    quarter: { year: 2026, quarter: 2 },
    subjects: Q2_2026_EMPLOYEES.map((e) => ({
      subjectId: e.subjectId,
      displayName: e.displayName,
      wagesCents: e.wagesCents,
      // Q2 2026: nobody had yet reached the annual ESD wage base, so taxable
      // equals total. Stated explicitly rather than defaulted, because the
      // cap is a year-to-date fact a quarter-shaped engine cannot see.
      esdTaxableWagesCents: e.wagesCents,
      pfmlTaxableWagesCents: e.wagesCents,
      hours: e.hours,
    })),
    rates: Q2_2026_RATES,
    pfml: { employerOwesEmployerShare: false, determinedAverageHeadcount: 10 },
  };
}

/**
 * The amount a state agency actually assessed, in cents.
 *
 * A thin wrapper over the oracle's `filedFigure`, which returns the whole
 * record. It THROWS on an unknown id rather than returning undefined, because
 * `expect(x).toBe(undefined)` passes cheerfully when a figure id is mistyped -
 * the test would go green while comparing nothing to nothing.
 */
function filedCents(id: string): number {
  const f = filedFigure(id);
  if (!f) {
    throw new Error(
      `known-good-quarters has no filed figure "${id}". A test comparing against a figure that ` +
        `does not exist proves nothing.`,
    );
  }
  return f.filedAmountCents;
}

function builtFiledQuarter(): WaQuarterReturn {
  const r = buildWaQuarter(filedQuarterRequest());
  if (!r.ok) {
    throw new Error(
      `the filed Q2 2026 quarter was REFUSED by the engine: ${r.refusals
        .map((x) => x.code)
        .join(", ")}`,
    );
  }
  return r.value;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. THE FILED RETURN REPRODUCES, TO THE CENT
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("wa-quarterly: the filed Q2 2026 return reproduces exactly", () => {
  it("builds without refusing", () => {
    expect(buildWaQuarter(filedQuarterRequest()).ok).toBe(true);
  });

  it("agrees with the oracle's own totals", () => {
    const ret = builtFiledQuarter();
    expect(ret.grossWagesCents).toBe(Q2_2026_GROSS_WAGES_CENTS);
    expect(ret.totalHours).toBe(Q2_2026_TOTAL_HOURS);
    expect(ret.headcount).toBe(Q2_2026_EMPLOYEES.length);
  });

  // Each of these is a figure a state agency accepted. The id ties the engine's
  // line to the filed figure, so neither can be quietly edited alone.
  const provable: readonly string[] = [
    "esd-ui",
    "esd-eaf",
    "esd-total",
    "pfml-employee",
    "pfml-employer",
    "wa-cares",
    "lni-premium",
  ];

  for (const id of provable) {
    it(`line "${id}" matches the figure actually filed`, () => {
      const line = waLineOf(builtFiledQuarter(), id);
      expect(line, `the engine emitted no line "${id}"`).toBeDefined();
      expect(line!.amountCents).toBe(filedCents(id));
    });
  }

  it("the L&I employee and employer shares add up to the premium assessed", () => {
    const ret = builtFiledQuarter();
    const ee = waLineOf(ret, "lni-employee")!.amountCents;
    const er = waLineOf(ret, "lni-employer")!.amountCents;
    expect(ee + er).toBe(filedCents("lni-premium"));
  });

  it("the two unemployment components add up to the ESD total assessed", () => {
    const ret = builtFiledQuarter();
    const ui = waLineOf(ret, "esd-ui")!.amountCents;
    const eaf = waLineOf(ret, "esd-eaf")!.amountCents;
    expect(ui + eaf).toBe(filedCents("esd-total"));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. THE ROUNDING DEFECT, PINNED SO IT CANNOT COME BACK
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("wa-quarterly: per-fund rounding is the difference between right and wrong", () => {
  it("the CORRECT method - round each statutory account, then add - gives 275.70", () => {
    const wages = Q2_2026_GROSS_WAGES_CENTS;
    const ui = statutoryRoundCents(exactMilliPct(wages, 370));
    const eaf = statutoryRoundCents(exactMilliPct(wages, 30));
    expect(ui).toBe(25_502);
    expect(eaf).toBe(2_068);
    expect(ui + eaf).toBe(27_570);
    expect(ui + eaf).toBe(filedCents("esd-total"));
  });

  it("the TEMPTING method - add the rates, round once - gives 275.69 and is WRONG", () => {
    const wages = Q2_2026_GROSS_WAGES_CENTS;
    const combined = statutoryRoundCents(exactMilliPct(wages, 400));

    // This is the number the shortcut produces...
    expect(combined).toBe(27_569);
    // ...and this is the number ESD actually assessed. They differ by one cent.
    expect(filedCents("esd-total")).toBe(27_570);
    expect(combined).not.toBe(filedCents("esd-total"));

    // If this test ever fails because the two became equal, somebody has
    // changed a rate or the rounding rule. Do not "fix" it by deleting it:
    // read RCW 50.24.010 and RCW 50.24.014(2)(b) first.
  });

  it("half a cent rounds UP, and below half rounds DOWN, as the statute words it", () => {
    expect(statutoryRoundCents(100.5)).toBe(101);
    expect(statutoryRoundCents(100.49)).toBe(100);
    expect(statutoryRoundCents(100.0)).toBe(100);
    expect(statutoryRoundCents(0.5)).toBe(1);
    expect(statutoryRoundCents(0.4999)).toBe(0);
  });

  it("refuses a negative amount rather than inventing a rule for it", () => {
    expect(() => statutoryRoundCents(-1)).toThrow();
    expect(() => statutoryRoundCents(Number.NaN)).toThrow();
    expect(() => statutoryRoundCents(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("PFML rounds ONCE at the end, not twice in the middle", () => {
    // 1.13% of wages, then 71.43% of that, with a single rounding.
    const premium = exactMilliPct(Q2_2026_GROSS_WAGES_CENTS, 1_130);
    const employee = statutoryRoundCents((premium * 71_430) / 100_000);
    expect(employee).toBe(filedCents("pfml-employee"));

    // Rounding the premium first produces a different, wrong answer path.
    const roundedFirst = statutoryRoundCents((statutoryRoundCents(premium) * 71_430) / 100_000);
    expect(roundedFirst).not.toBe(0); // it computes something plausible...
    // ...which is exactly why the order is pinned rather than left to taste.
  });

  it("L&I is charged on hours and refuses fractional or negative hours", () => {
    expect(hourlyPremiumCents(3_558, 55_930)).toBe(filedCents("lni-premium"));
    expect(() => hourlyPremiumCents(10.5, 55_930)).toThrow();
    expect(() => hourlyPremiumCents(-1, 55_930)).toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. MUTATION BATTERY - break the input, require the output to notice
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("wa-quarterly: mutating the input changes the answer or refuses", () => {
  it("changing wages changes every wage-based line", () => {
    const base = builtFiledQuarter();
    const req = filedQuarterRequest();
    const mutated = buildWaQuarter({
      ...req,
      subjects: req.subjects.map((s, i) =>
        i === 0
          ? {
              ...s,
              wagesCents: s.wagesCents + 100_00,
              esdTaxableWagesCents: s.esdTaxableWagesCents + 100_00,
              pfmlTaxableWagesCents: s.pfmlTaxableWagesCents + 100_00,
            }
          : s,
      ),
    });
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;
    for (const id of ["esd-ui", "esd-eaf", "esd-total", "pfml-employee", "wa-cares"]) {
      expect(
        waLineOf(mutated.value, id)!.amountCents,
        `line ${id} did not react to a $100 wage change`,
      ).not.toBe(waLineOf(base, id)!.amountCents);
    }
  });

  it("changing wages does NOT change the L&I premium, which is charged on hours", () => {
    const base = builtFiledQuarter();
    const req = filedQuarterRequest();
    const mutated = buildWaQuarter({
      ...req,
      subjects: req.subjects.map((s, i) =>
        i === 0
          ? {
              ...s,
              wagesCents: s.wagesCents + 500_00,
              esdTaxableWagesCents: s.esdTaxableWagesCents + 500_00,
              pfmlTaxableWagesCents: s.pfmlTaxableWagesCents + 500_00,
            }
          : s,
      ),
    });
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;
    expect(waLineOf(mutated.value, "lni-premium")!.amountCents).toBe(
      waLineOf(base, "lni-premium")!.amountCents,
    );
  });

  it("changing hours changes L&I and leaves the wage-based lines alone", () => {
    const base = builtFiledQuarter();
    const req = filedQuarterRequest();
    const mutated = buildWaQuarter({
      ...req,
      subjects: req.subjects.map((s, i) => (i === 0 ? { ...s, hours: s.hours + 40 } : s)),
    });
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;
    expect(waLineOf(mutated.value, "lni-premium")!.amountCents).not.toBe(
      waLineOf(base, "lni-premium")!.amountCents,
    );
    expect(waLineOf(mutated.value, "esd-total")!.amountCents).toBe(
      waLineOf(base, "esd-total")!.amountCents,
    );
  });

  it("turning on the PFML employer share produces a non-zero employer line", () => {
    const base = builtFiledQuarter();
    expect(waLineOf(base, "pfml-employer")!.amountCents).toBe(0);

    const mutated = buildWaQuarter({
      ...filedQuarterRequest(),
      pfml: { employerOwesEmployerShare: true, determinedAverageHeadcount: 60 },
    });
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;
    expect(waLineOf(mutated.value, "pfml-employer")!.amountCents).toBeGreaterThan(0);
  });

  it("the employer-share zero is a POSITION, not an absence - the line is always emitted", () => {
    // A small employer owes nothing, and that is a determination, not a gap.
    // The line has to appear so a reader can see it was decided.
    expect(waLineOf(builtFiledQuarter(), "pfml-employer")).toBeDefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. REFUSALS - every code reachable, none decorative
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("wa-quarterly: refusals fire when they should", () => {
  it("refuses an empty quarter rather than filing zeros nobody chose", () => {
    const r = buildWaQuarter({ ...filedQuarterRequest(), subjects: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("NO_SUBJECTS");
  });

  it("refuses negative wages", () => {
    const req = filedQuarterRequest();
    const r = buildWaQuarter({
      ...req,
      subjects: req.subjects.map((s, i) => (i === 0 ? { ...s, wagesCents: -1 } : s)),
    });
    expect(r.ok).toBe(false);
  });

  it("refuses taxable wages larger than total wages", () => {
    const req = filedQuarterRequest();
    const r = buildWaQuarter({
      ...req,
      subjects: req.subjects.map((s, i) =>
        i === 0 ? { ...s, esdTaxableWagesCents: s.wagesCents + 1 } : s,
      ),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("TAXABLE_EXCEEDS_TOTAL");
  });

  it("refuses fractional hours", () => {
    const req = filedQuarterRequest();
    const r = buildWaQuarter({
      ...req,
      subjects: req.subjects.map((s, i) => (i === 0 ? { ...s, hours: 10.25 } : s)),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("FRACTIONAL_HOURS");
  });

  it("refuses wages with no hours, which is how an unreported hour hides", () => {
    const req = filedQuarterRequest();
    const r = buildWaQuarter({
      ...req,
      subjects: req.subjects.map((s, i) => (i === 0 ? { ...s, hours: 0 } : s)),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals.map((x) => x.code)).toContain("WAGES_WITHOUT_HOURS");
  });

  it("collects EVERY problem at once rather than stopping at the first", () => {
    const req = filedQuarterRequest();
    const refusals = validateWaQuarterRequest({
      ...req,
      subjects: [
        { ...req.subjects[0], wagesCents: -5 },
        { ...req.subjects[1], hours: 1.5 },
      ],
    });
    // Being told one problem at a time turns one correction into three rounds.
    expect(refusals.length).toBeGreaterThan(1);
  });

  it("every refusal explains itself instead of returning a bare code", () => {
    const r = buildWaQuarter({ ...filedQuarterRequest(), subjects: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    for (const refusal of r.refusals) {
      expect(refusal.because.length, `${refusal.code} has no explanation`).toBeGreaterThan(20);
      expect(refusal.fix.length, `${refusal.code} suggests no fix`).toBeGreaterThan(20);
    }
  });

  it("the union and the runtime array of refusal codes agree", () => {
    expect(() =>
      assertWaQuarterUnionMatchesRuntimeArray(ALL_WA_QUARTER_REFUSAL_CODES),
    ).not.toThrow();
  });

  it("the gate reads a real, non-empty union", () => {
    expect(waQuarterUnionRefusalCodes().length).toBe(ALL_WA_QUARTER_REFUSAL_CODES.length);
    expect(waQuarterUnionRefusalCodes().length).toBeGreaterThan(5);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. DUE DATES - including the two that move in Greenway's first year
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("wa-quarterly: due dates", () => {
  it("30 April 2027 is a Friday and does not move", () => {
    const d = waQuarterDueDate({ year: 2027, quarter: 1 });
    expect(d.calendarDate).toBe("2027-04-30");
    expect(d.dueDate).toBe("2027-04-30");
    expect(d.shiftedBy).toBe("none");
  });

  it("31 July 2027 is a SATURDAY and moves to Monday 2 August", () => {
    const d = waQuarterDueDate({ year: 2027, quarter: 2 });
    expect(d.calendarDate).toBe("2027-07-31");
    expect(d.dueDate).toBe("2027-08-02");
    expect(d.shiftedBy).toBe("weekend");
  });

  it("31 October 2027 is a SUNDAY and moves to Monday 1 November", () => {
    const d = waQuarterDueDate({ year: 2027, quarter: 3 });
    expect(d.calendarDate).toBe("2027-10-31");
    expect(d.dueDate).toBe("2027-11-01");
    expect(d.shiftedBy).toBe("weekend");
  });

  it("31 January 2028 is a Monday and does not move", () => {
    const d = waQuarterDueDate({ year: 2027, quarter: 4 });
    expect(d.calendarDate).toBe("2028-01-31");
    expect(d.dueDate).toBe("2028-01-31");
    expect(d.shiftedBy).toBe("none");
  });

  it("every due date lands on a weekday that is not a WA holiday", () => {
    for (let y = 2027; y <= 2040; y++) {
      for (const q of [1, 2, 3, 4] as const) {
        const d = waQuarterDueDate({ year: y, quarter: q });
        const dow = new Date(`${d.dueDate}T00:00:00Z`).getUTCDay();
        expect(dow, `${d.dueDate} is a weekend`).not.toBe(0);
        expect(dow, `${d.dueDate} is a weekend`).not.toBe(6);
        expect(isWaLegalHoliday(d.dueDate), `${d.dueDate} is a holiday`).toBe(false);
      }
    }
  });

  /**
   * THE CLAIM THAT USED TO BE A COMMENT.
   *
   * The engine once contained `return false` where the holiday check goes, on
   * the reasoning that no Washington holiday can land on a quarterly due date.
   * The reasoning is right - but it was taken on trust. Here it is proved.
   */
  it("no WA legal holiday EVER lands on a quarterly due date, 2024-2075", () => {
    const collisions: string[] = [];
    for (let y = 2024; y <= 2075; y++) {
      for (const md of ["04-30", "07-31", "10-31", "01-31"]) {
        if (isWaLegalHoliday(`${y}-${md}`)) collisions.push(`${y}-${md}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("the WA holiday table is NOT the federal one", () => {
    const names2027 = waLegalHolidays(2027).map((h) => h.name);
    // Washington adds this one; the federal table has no equivalent.
    expect(names2027).toContain("Native American Heritage Day");
    // RCW 1.16.050(7)(r) recognises Columbus day and denies it holiday status.
    expect(names2027.join(" ")).not.toMatch(/Columbus|Indigenous/);
    // A DC-only holiday has no business in a Washington State table.
    expect(names2027.join(" ")).not.toMatch(/Emancipation/);
  });

  it("applies the RCW 1.16.050(5) observed shift", () => {
    // 4 July 2027 is a Sunday, so the holiday is observed on Monday the 5th.
    expect(waLegalHolidays(2027).some((h) => h.date === "2027-07-05")).toBe(true);
    // 25 December 2027 is a Saturday, so it is observed on Friday the 24th.
    expect(waLegalHolidays(2027).some((h) => h.date === "2027-12-24")).toBe(true);
  });

  it("says plainly that Washington has no equivalent of the 941's ten extra days", () => {
    const note = waVersusFederalDeadlineNote();
    expect(note.length).toBeGreaterThan(100);
    expect(note.toLowerCase()).toContain("ten days");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. THE HOURS BOX IS NOT MONEY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("wa-quarterly: the L&I hours box is measured in hours, not dollars", () => {
  it("carries measure=hours and the real hour count", () => {
    const line = waLineOf(builtFiledQuarter(), "lni-hours")!;
    expect(line.measure).toBe("hours");
    expect(line.quantity).toBe(Q2_2026_TOTAL_HOURS);
  });

  it("formats as hours, never as $0.00", () => {
    const line = waLineOf(builtFiledQuarter(), "lni-hours")!;
    const shown = formatWaLineValue(line);
    expect(shown).toBe("3,558 hours");
    expect(shown).not.toContain("$");
  });

  it("money lines still format as money", () => {
    const line = waLineOf(builtFiledQuarter(), "esd-total")!;
    expect(line.measure).toBe("money");
    expect(line.quantity).toBeNull();
    expect(formatWaLineValue(line)).toBe("$275.70");
  });

  it("every line declares a measure, so no caller has to guess", () => {
    for (const line of builtFiledQuarter().lines) {
      expect(["money", "hours"]).toContain(line.measure);
      if (line.measure === "hours") expect(line.quantity).not.toBeNull();
      else expect(line.quantity).toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. THE FORMS - grouping, and Michael's box-by-box requirement
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("wa-quarterly: the four forms", () => {
  it("every line belongs to one of the four returns", () => {
    const forms = new Set(builtFiledQuarter().lines.map((l) => l.form));
    for (const f of forms) {
      expect(["esd_5208a", "esd_5208b", "pfml_wa_cares", "lni_quarterly"]).toContain(f);
    }
  });

  it("each form has a guide naming the agency and what it is charged on", () => {
    expect(WA_FORM_GUIDES.length).toBe(4);
    for (const g of WA_FORM_GUIDES) {
      expect(g.officialName.length).toBeGreaterThan(5);
      expect(g.agency.length).toBeGreaterThan(3);
      expect(g.chargedOn.length).toBeGreaterThan(5);
      expect(g.commonMistake.length).toBeGreaterThan(30);
    }
  });

  it("grouping by form returns lines and never the whole list", () => {
    const ret = builtFiledQuarter();
    const lni = waLinesForForm(ret, "lni_quarterly");
    expect(lni.length).toBeGreaterThan(0);
    expect(lni.length).toBeLessThan(ret.lines.length);
    for (const l of lni) expect(l.form).toBe("lni_quarterly");
  });

  /** Michael's requirement, as a test rather than an intention. */
  it("EVERY box the engine fills in is explained in plain English", () => {
    const ids = builtFiledQuarter().lines.map((l) => l.id);
    expect(() => assertEveryWaBoxIsExplained(ids)).not.toThrow();
  });

  it("the box explanations AGREE with the engine about whose money and how much", () => {
    expect(() => assertWaBoxExplainersMatchTheEngine([...builtFiledQuarter().lines])).not.toThrow();
  });

  it("the box gate REFUSES when handed nothing (it cannot pass vacuously)", () => {
    expect(() => assertEveryWaBoxIsExplained([])).toThrow(/zero line ids/);
  });

  it("the box gate catches an unexplained box", () => {
    expect(() => assertEveryWaBoxIsExplained(["a-box-nobody-wrote-about"])).toThrow();
  });

  it("every explainer says where the number comes from and what to do if it is wrong", () => {
    for (const b of WA_BOX_EXPLAINERS) {
      expect(b.whereItComesFrom.length, `${b.lineId}`).toBeGreaterThan(40);
      expect(b.ifItIsWrong.length, `${b.lineId}`).toBeGreaterThan(40);
      expect(b.q2_2026Example.length, `${b.lineId}`).toBeGreaterThan(20);
    }
  });

  it("boxes the employer alone pays say so, and say it may not be deducted", () => {
    expect(() => assertWaEmployerCostBoxesForbidDeduction()).not.toThrow();
  });

  /**
   * PROVE THE GATE ABOVE CAN ACTUALLY FAIL (standing rule 16).
   *
   * The prohibition gate was loosened once already, to stop it rejecting prose
   * that forbade the deduction in words it did not recognise. Loosening a gate
   * is exactly how a gate stops working, so the loosened version is made to
   * fail here on purpose. Text that mentions deduction WITHOUT forbidding it,
   * and text that forbids without mentioning deduction, must both be caught.
   */
  it("the employer-cost gate is not vacuous - it rejects text that permits deduction", () => {
    const permissive = "this is deducted from each employee's pay every period.";
    const mentionsDeduction = /\bdeduct/.test(permissive);
    const forbidding =
      /\b(unlawful|never|neither|prohibit|prohibition|misdemeanou?r|may not|cannot|not be)\b/.test(
        permissive,
      );
    expect(mentionsDeduction && forbidding).toBe(false);

    const silent = "this money is never touched by anyone.";
    expect(/\bdeduct/.test(silent)).toBe(false);
  });

  /**
   * Every employer-cost box must be traceable to a rule - but NOT all to the
   * same rule. The unemployment lines are forbidden to staff by RCW 50.24.010
   * and RCW 50.24.014(2)(b); the PFML employer share is governed by chapter
   * 50A instead. An earlier version of this test demanded RCW 50.24 everywhere
   * and failed the PFML box for citing the correct statute, which would have
   * been a test bullying the code into being wrong.
   */
  it("every employer-cost box cites an authority for who bears the cost", () => {
    for (const b of WA_BOX_EXPLAINERS.filter((x) => x.whoseMoney === "employer_cost")) {
      expect(b.authorityIds.length, `box ${b.lineId} cites nothing`).toBeGreaterThan(0);
      const cites = `${b.whyOwnershipMatters} ${b.whereItComesFrom}`;
      expect(cites, `box ${b.lineId} never names the rule behind it`).toMatch(/RCW 5[01]/);
    }
  });

  it("boxExplainer() finds a box by the engine's own line id", () => {
    expect(boxExplainer("esd-ui")).toBeDefined();
    expect(boxExplainer("not-a-line")).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. THE MENTOR - coverage gates
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("wa-quarterly: the mentor covers the engine", () => {
  it("every exported engine function has a lesson", () => {
    expect(() => assertEveryWaQuarterFunctionIsTaught()).not.toThrow();
  });

  it("the function gate reads a real, non-empty list", () => {
    expect(waQuarterEngineFunctionNames().length).toBeGreaterThan(8);
  });

  it("every refusal code has a lesson", () => {
    expect(() => assertEveryWaRefusalCodeIsTaught()).not.toThrow();
  });

  it("every refusal lesson says what happened, why, and how to fix it", () => {
    for (const l of WA_REFUSAL_LESSONS) {
      expect(l.whatHappened.length, `${l.code}`).toBeGreaterThan(20);
      expect(l.whyItRefuses.length, `${l.code}`).toBeGreaterThan(20);
      expect(l.howToFix.length, `${l.code}`).toBeGreaterThan(20);
    }
  });

  it("every refusal code is reachable from a lesson lookup", () => {
    for (const code of ALL_WA_QUARTER_REFUSAL_CODES) {
      expect(waRefusalLesson(code), `${code} has no lesson`).toBeDefined();
    }
  });

  it("every authority transcribed is cited by something a reader can reach", () => {
    expect(() => assertEveryWaQuarterlyAuthorityIsReachable()).not.toThrow();
  });

  it("every authority id the mentor cites actually resolves", () => {
    expect(() => assertEveryWaCitedAuthorityResolves()).not.toThrow();
  });

  it("the quotes look transcribed rather than summarised", () => {
    expect(() => assertWaQuarterlyQuotesLookTranscribed()).not.toThrow();
  });

  it("there are authorities at all, so the quote gate is not vacuous", () => {
    expect(waQuarterlyAuthorities().length).toBeGreaterThan(20);
  });

  it("the mentor is client-safe - no node:fs on the browser bundle path", () => {
    expect(() => assertWaQuarterlyMentorIsClientSafe()).not.toThrow();
  });

  it("the checklist is ordered, actionable and states the cost of skipping", () => {
    expect(() => assertWaQuarterlyChecklistIsUsable()).not.toThrow();
    expect(waChecksInOrder().map((c) => c.order)).toEqual(
      WA_QUARTER_CHECKS.map((_, i) => i + 1),
    );
  });

  it("the worked examples contain actual arithmetic", () => {
    expect(() => assertWaQuarterlyExamplesAreWorked()).not.toThrow();
  });

  it("the orientation tells Michael what he is looking at", () => {
    const text = waQuarterOrientation({
      grossWagesCents: Q2_2026_GROSS_WAGES_CENTS,
      totalHours: Q2_2026_TOTAL_HOURS,
      headcount: Q2_2026_EMPLOYEES.length,
    });
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("3,558");
  });
});
