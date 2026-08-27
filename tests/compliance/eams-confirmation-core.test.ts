/**
 * tests/compliance/eams-confirmation-core.test.ts   (books-66)
 *
 * The confirmation preview is a VISUALISATION, which is exactly why it needs
 * gates. A page that looks like an official ESD receipt and quietly shows the
 * wrong number is worse than no page: Michael would compare it against Sage,
 * see a match in the layout, and trust the figures.
 *
 * Every expectation below is anchored to a PRIMARY DOCUMENT — his own filed Q1
 * 2026 EAMS confirmation (`1ST QUARTER FORM 5208A.pdf`, extracted with
 * `pdftotext -layout`) or the known-good Q2 fixtures.
 */

import { describe, expect, it } from "vitest";

import {
  buildEamsConfirmation,
  confirmationHours,
  confirmationMoney,
  confirmationQuarterLabel,
  deriveExcessWagesCents,
  maskEin,
  maskSsn,
  rateNote,
  type BuildConfirmationInput,
} from "@/lib/payroll/eams-confirmation-core";
import { lessonFor } from "@/lib/payroll/form-box-core";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";
import { type WaQuarterReturn } from "@/lib/payroll/wa-quarterly-core";

/* ── Michael's filed Q1 2026, read off the PDF ─────────────────────────────
 *
 *   Gross wages                 $61,531.21
 *   Excess wages                     $0.00
 *   Annual taxable wage base:   $78,200.00
 *   Total taxable wages         $61,531.21
 *   UI tax due                     $227.66   Rate 0.37%
 *   EAF tax due                     $18.46   Rate 0.03%
 *   UI and EAF charges             $246.12
 *   Total employees: 11  Total hours: 3027  Total wages: $61,531.21
 */
const Q1_GROSS_CENTS = 6_153_121;
const Q1_UI_CENTS = 22_766;
const Q1_EAF_CENTS = 1_846;
const Q1_TOTAL_CENTS = 24_612;
const Q1_HOURS = 3_027;
const Q1_HEADCOUNT = 11;

function line(id: string, boxLabel: string, amountCents: number) {
  return {
    id,
    form: "esd_5208a" as const,
    boxLabel,
    amountCents,
    measure: "money" as const,
    quantity: null,
    whoseMoney: "employer_cost" as const,
    shownAs: `${boxLabel} test line`,
  };
}

const Q1_RETURN = {
  quarter: { year: 2026, quarter: 1 as const },
  grossWagesCents: Q1_GROSS_CENTS,
  subjectsEsdTaxableCents: Q1_GROSS_CENTS,
  totalHours: Q1_HOURS,
  headcount: Q1_HEADCOUNT,
  lines: [
    line("esd-ui", "UI tax due", Q1_UI_CENTS),
    line("esd-eaf", "EAF tax due", Q1_EAF_CENTS),
    line("esd-total", "Total due", Q1_TOTAL_CENTS),
  ],
  wageDetail: [
    { subjectId: "benoit", displayName: "Stephen Benoit", wagesCents: 1_399_650, hours: 451 },
    { subjectId: "britton", displayName: "Angela Britton", wagesCents: 950_347, hours: 490 },
  ],
  esdTotalCents: Q1_TOTAL_CENTS,
  pfmlWaCaresTotalCents: 0,
  lniTotalCents: 0,
} as unknown as WaQuarterReturn;

const BASE_INPUT: BuildConfirmationInput = {
  quarter: { year: 2026, quarter: 1 },
  ret: Q1_RETURN,
  profile: {
    legalName: "LYMAN'S MARIJUANA L.L.C.",
    tradeName: "GREENWAY MARIJUANA",
    ein: "46-4217016",
    esdAccount: "000-073905-00-0",
    ubi: "603-353-555",
    businessStructure: "llc_s_corp",
    mailingCityStateZip: "PORT ORCHARD WA 98366",
    preparerName: "Michael Lyman",
    preparerPhone: "(360) 204-1119",
    preparerEmail: "michael@greenwaymarijuana.com",
  },
  uiRateMilliPct: 370,
  eafRateMilliPct: 30,
  wageBaseCents: 7_820_000,
  socCodeBySubject: { benoit: "41-2031", britton: "41-2031" },
  ssnBySubject: { benoit: "123-45-1883", britton: "123-45-0724" },
  monthlyHeadcount: [10, 11, 9],
};

describe("EAMS confirmation preview — formatting matches the filed document", () => {
  it("prints money exactly as EAMS does, including the thousands separator", () => {
    expect(confirmationMoney(Q1_GROSS_CENTS)).toBe("$61,531.21");
    expect(confirmationMoney(Q1_UI_CENTS)).toBe("$227.66");
    expect(confirmationMoney(Q1_EAF_CENTS)).toBe("$18.46");
    expect(confirmationMoney(Q1_TOTAL_CENTS)).toBe("$246.12");
    expect(confirmationMoney(7_820_000)).toBe("$78,200.00");
    expect(confirmationMoney(0)).toBe("$0.00");
  });

  it("keeps the two-decimal shape when the cents are a round number", () => {
    // "$1,000.00", never "$1,000.0" or "$1,000".
    expect(confirmationMoney(100_000)).toBe("$1,000.00");
    expect(confirmationMoney(5)).toBe("$0.05");
  });

  it("masks the SSN to the shape the real confirmation prints", () => {
    // The filed PDF shows "***-**-1883" for the first employee.
    expect(maskSsn("123-45-1883")).toBe("***-**-1883");
    expect(maskSsn("123451883")).toBe("***-**-1883");
  });

  it("refuses to half-mask a malformed SSN", () => {
    // A partially masked bad number invites the reader to trust the rest.
    expect(maskSsn("12345")).toBe("***-**-????");
    expect(maskSsn("")).toBe("***-**-????");
  });

  it("masks the EIN the way the filed confirmation does", () => {
    // Michael's EIN is 46-4217016 and his confirmation prints "**-***7016".
    expect(maskEin("46-4217016")).toBe("**-***7016");
    expect(maskEin("464217016")).toBe("**-***7016");
  });

  it("prints the quarter caption in EAMS's own wording", () => {
    expect(confirmationQuarterLabel({ year: 2026, quarter: 1 })).toBe("Q1, 2026 (JAN \u2014 MAR)");
    expect(confirmationQuarterLabel({ year: 2026, quarter: 4 })).toBe("Q4, 2026 (OCT \u2014 DEC)");
  });

  it("prints the rate notes at the precision the confirmation uses", () => {
    expect(rateNote("Unemployment Insurance", 370)).toBe("Unemployment Insurance - Rate 0.37%");
    expect(rateNote("Employment Administration Fund", 30)).toBe(
      "Employment Administration Fund - Rate 0.03%",
    );
  });

  it("omits the rate note entirely when the rate is unknown, rather than printing 0%", () => {
    // "Rate 0%" is a claim. Absence is the truth.
    expect(rateNote("Unemployment Insurance", null)).toBeNull();
  });
});

describe("EAMS confirmation preview — hours are asserted, never re-rounded", () => {
  it("passes a whole number straight through", () => {
    expect(confirmationHours(451)).toBe("451");
    expect(confirmationHours(0)).toBe("0");
  });

  it("THROWS on a fractional hour instead of quietly rounding it", () => {
    /*
     * This is the whole point of the function. ESD says three separate times
     * that hours must be whole and rounded UP; the ceiling is applied once, in
     * `eamsHours`. If this display rounded independently, the figure on screen
     * and the figure in the upload file could differ and nothing would catch
     * it. So a fraction arriving here is an upstream bug and must be loud.
     */
    expect(() => confirmationHours(9.75)).toThrow(/not a whole number/);
    expect(() => confirmationHours(450.5)).toThrow(/eams-confirmation/);
  });
});

describe("EAMS confirmation preview — excess wages by subtraction", () => {
  it("reproduces the $0.00 excess on Michael's filed Q1", () => {
    // Gross and taxable were identical that quarter; nobody had crossed $78,200.
    expect(deriveExcessWagesCents(Q1_GROSS_CENTS, Q1_GROSS_CENTS)).toBe(0);
  });

  it("uses the agency's own definition, rearranged", () => {
    /*
     * ICESA Bulk Format Specification, field name verbatim:
     *   "Total Taxable Wages for this Employer (total gross wages - total
     *    excess wages)"
     * so excess = gross - taxable.
     */
    expect(deriveExcessWagesCents(10_000_00, 7_820_000 / 1)).toBe(10_000_00 - 7_820_000);
    expect(deriveExcessWagesCents(9_000_000, 7_820_000)).toBe(1_180_000);
  });
});

describe("EAMS confirmation preview — the assembled view", () => {
  const view = buildEamsConfirmation(BASE_INPUT);

  it("reproduces every money figure on Michael's filed Q1 charges column", () => {
    const byLabel = new Map(view.charges.map((c) => [c.label, c.amount]));
    expect(byLabel.get("Gross wages")).toBe("$61,531.21");
    expect(byLabel.get("Excess wages")).toBe("$0.00");
    expect(byLabel.get("Total taxable wages")).toBe("$61,531.21");
    expect(byLabel.get("UI tax due")).toBe("$227.66");
    expect(byLabel.get("EAF tax due")).toBe("$18.46");
    expect(byLabel.get("UI and EAF charges")).toBe("$246.12");
    expect(byLabel.get("Charges this quarter")).toBe("$246.12");
  });

  it("gets the SIGN of excess wages right when gross and taxable differ", () => {
    /*
     * WRITTEN BECAUSE A MUTATION SURVIVED. The first version of this gate only
     * checked Michael's Q1, where gross and taxable are both $61,531.21 and
     * excess is $0.00. Flipping the subtraction to `taxable - gross` still
     * produced 0, so the gate passed against a genuinely broken engine.
     *
     * Q1 is a degenerate case: nobody had crossed the $78,200 base yet. Excess
     * only becomes visible in Q3/Q4 — the handbook says so directly: excess
     * wages "are most often paid during Q3 or Q4, after employees may have
     * earned enough wages to meet the current taxable wage base." Which means
     * the sign error would have shipped and first appeared on a Q3 return, as
     * a large negative number on a filed-looking document.
     *
     * So this asserts against the handbook's OWN worked example (the "correct
     * way to report excess wages" table): Q3 quarterly wages $18,000, taxable
     * $12,000, excess $6,000.
     */
    const q3 = buildEamsConfirmation({
      ...BASE_INPUT,
      quarter: { year: 2026, quarter: 3 },
      ret: {
        ...Q1_RETURN,
        grossWagesCents: 1_800_000,
        subjectsEsdTaxableCents: 1_200_000,
      } as unknown as WaQuarterReturn,
    });
    const excess = q3.charges.find((c) => c.label === "Excess wages");
    expect(excess?.amount).toBe("$6,000.00");
    // And positively NOT the flipped sign, which is the bug this gate exists for.
    expect(excess?.amount).not.toBe("-$6,000.00");

    const taxable = q3.charges.find((c) => c.label === "Total taxable wages");
    expect(taxable?.amount).toBe("$12,000.00");
    const gross = q3.charges.find((c) => c.label === "Gross wages");
    expect(gross?.amount).toBe("$18,000.00");
  });

  it("formats a negative amount with the sign in front of the dollar mark", () => {
    // Guards the branch the sign test above depends on.
    expect(confirmationMoney(-600_000)).toBe("-$6,000.00");
  });

  it("shows the wage base ESD printed on that very form", () => {
    const taxable = view.charges.find((c) => c.label === "Total taxable wages");
    expect(taxable?.note).toBe("Annual taxable wage base: $78,200.00");
  });

  it("carries the SOC code Michael says every employee has", () => {
    // "all of my employees are and will be the same 41-2031 soc code."
    expect(view.wageRows.length).toBe(2);
    for (const row of view.wageRows) {
      expect(row.socCode).toBe("41-2031");
    }
  });

  it("marks a missing SOC code rather than printing an empty cell", () => {
    /*
     * The handbook lists "Failure to include SOC code or job title or
     * submitting invalid SOC codes" as a common error carrying a penalty, so a
     * blank must be conspicuous, not invisible.
     */
    const withGap = buildEamsConfirmation({
      ...BASE_INPUT,
      socCodeBySubject: { benoit: "41-2031" },
    });
    const britton = withGap.wageRows.find((r) => r.lastName === "Angela Britton");
    expect(britton).toBeDefined();
    expect(britton?.socCode).toBe("missing");
  });

  it("flags absent identity fields instead of rendering a blank slot", () => {
    /*
     * D-15's lesson: a computed value with no visible box reads as a zero. An
     * absent EIN must SAY it is absent.
     */
    const noEin = buildEamsConfirmation({
      ...BASE_INPUT,
      profile: { ...BASE_INPUT.profile, ein: null },
    });
    const einPair = noEin.identity.find((p) => p.label === "EIN");
    expect(einPair).toBeDefined();
    expect(einPair?.missing).toBe(true);
    expect(einPair?.value).toBe("not on file");
  });

  it("always carries the not-a-filing notice, naming the actual quarter", () => {
    expect(view.notFiledNotice).toContain("not a filing");
    expect(view.notFiledNotice).toContain("Q1 2026");
    // The two things only ESD can produce must be named as absent.
    expect(view.notFiledNotice).toMatch(/code/i);
  });

  it("never invents a confirmation code field on the view at all", () => {
    /*
     * Asserting the SHAPE, not just the text. If somebody later adds a
     * `confirmationCode` to the view type they must confront this gate, because
     * the only honest value is one ESD issued.
     */
    expect(Object.keys(view)).not.toContain("confirmationCode");
    expect(Object.keys(view)).not.toContain("submittedOn");
  });

  it("prints an em dash, not a zero, for an undetermined monthly headcount", () => {
    /*
     * Zero employees in a month is a real and meaningful state that changes
     * benefit charging. "Not determined" is a different state.
     */
    const undetermined = buildEamsConfirmation({
      ...BASE_INPUT,
      monthlyHeadcount: [null, null, null],
    });
    for (const m of undetermined.monthlyCounts) {
      expect(m.count).toBe("\u2014");
    }
    // And it still prints a real count when there is one.
    expect(view.monthlyCounts.map((m) => m.count)).toEqual(["10", "11", "9"]);
  });

  it("names the months of the quarter it was asked for", () => {
    expect(view.monthlyCounts.map((m) => m.month)).toEqual(["JANUARY", "FEBRUARY", "MARCH"]);
    const q3 = buildEamsConfirmation({
      ...BASE_INPUT,
      quarter: { year: 2026, quarter: 3 },
    });
    expect(q3.monthlyCounts.map((m) => m.month)).toEqual(["JULY", "AUGUST", "SEPTEMBER"]);
  });

  it("shows an em dash rather than a zero when the engine produced no tax line", () => {
    // An absent line is not a claim that no tax is due.
    const noLines = buildEamsConfirmation({
      ...BASE_INPUT,
      ret: { ...Q1_RETURN, lines: [] } as unknown as WaQuarterReturn,
    });
    const ui = noLines.charges.find((c) => c.label === "UI tax due");
    expect(ui?.amount).toBe("\u2014");
  });

  it("totals the wage table to the figure ESD printed", () => {
    expect(view.totalWages).toBe("$61,531.21");
    expect(view.totalEmployees).toBe(Q1_HEADCOUNT);
    expect(view.totalHours).toBe(Q1_HOURS);
  });
});

describe("EAMS confirmation preview — every clickable charge really teaches", () => {
  /*
   * Rule 26: an export or a surface without a lesson is half a feature. The
   * sheet decides clickability from a label-to-lesson table; if a lesson id in
   * that table does not resolve, the box would look clickable and do nothing —
   * which Michael explicitly called out as worse than no box.
   *
   * The table is duplicated here deliberately, as the gate's own statement of
   * what must exist. If the component's table changes without a lesson being
   * written, this fails.
   */
  const REQUIRED = [
    { formId: "esd_5208a", box: "esd-ui" },
    { formId: "esd_5208a", box: "esd-eaf" },
    { formId: "esd_5208a", box: "esd-total" },
  ];

  it("finds a real lesson for every charge row the sheet makes clickable", () => {
    // Assert existence before absence (rule 66c).
    expect(WA_QUARTERLY_LESSONS.length).toBeGreaterThan(0);
    for (const want of REQUIRED) {
      const lesson = lessonFor(WA_QUARTERLY_LESSONS, want.formId, want.box);
      expect(lesson, `no lesson for ${want.formId}/${want.box}`).toBeDefined();
      expect(lesson?.plainEnglish.length).toBeGreaterThan(40);
      expect(lesson?.whatToDo.length).toBeGreaterThan(20);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * books-67 — AN EMPTY QUARTER DRAWS THE FORM, IT DOES NOT REFUSE
 *
 * Michael: "the esd form page says it refuses to draw the form because there is
 * 1 problem, no payroll yet ... Ideally I'd like to see the form like all the
 * others, even with no payroll data to fill it with."
 *
 * The danger in granting that request is printing $0.00 where the books simply
 * have no answer. A zero on an unemployment report is a claim that no wages
 * were paid; an em dash is the absence of a claim. These gates hold that line.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("EAMS confirmation preview — a quarter with no payroll still draws", () => {
  const empty = buildEamsConfirmation({ ...BASE_INPUT, ret: null });

  it("builds a view instead of throwing", () => {
    // Assert existence before absence (rule 66c).
    expect(empty).toBeDefined();
    expect(empty.charges.length).toBeGreaterThan(0);
    expect(empty.identity.length).toBeGreaterThan(0);
  });

  it("shows an em dash for EVERY money figure, and never a zero", () => {
    /*
     * The whole point of the slice. If any of these ever reads "$0.00" the page
     * is asserting, on a document formatted to look filed, that Greenway paid
     * wages of nothing and owes tax of nothing.
     */
    for (const row of empty.charges) {
      expect(row.amount, `charge "${row.label}" must not print a zero`).not.toBe("$0.00");
      expect(row.amount, `charge "${row.label}" must be an em dash`).toBe("\u2014");
    }
    expect(empty.totalWages).toBe("\u2014");
  });

  it("keeps the full layout so the blank form matches the filled one", () => {
    /*
     * Michael asked to see the form "like all the others". A blank form that
     * dropped half its rows would not teach him where anything goes, which is
     * the only reason to show it at all. Same labels, same order, same count.
     */
    const filled = buildEamsConfirmation(BASE_INPUT);
    expect(empty.charges.map((c) => c.label)).toEqual(filled.charges.map((c) => c.label));
    expect(empty.identity.map((p) => p.label)).toEqual(filled.identity.map((p) => p.label));
    expect(empty.preparer.map((p) => p.label)).toEqual(filled.preparer.map((p) => p.label));
    expect(empty.monthlyCounts.length).toBe(filled.monthlyCounts.length);
  });

  it("explains WHY it is blank, and only when it is blank", () => {
    expect(empty.emptyReason).not.toBeNull();
    expect(empty.emptyReason ?? "").toContain("no pay run");
    // It must tell him the empty state is normal, not a fault.
    expect(empty.emptyReason ?? "").toMatch(/on purpose|not because anything is wrong/i);
    // And it must not appear on a quarter that HAS figures.
    expect(buildEamsConfirmation(BASE_INPUT).emptyReason).toBeNull();
  });

  it("has no employee rows, and reports that as a count rather than a dash", () => {
    /*
     * Counts and money are treated differently ON PURPOSE. "No rows in the
     * table" is a fact about the table and 0 states it correctly. "$0.00 of
     * wages" is a claim about the quarter, so money gets a dash instead.
     */
    expect(empty.wageRows).toEqual([]);
    expect(empty.totalEmployees).toBe(0);
    expect(empty.totalHours).toBe(0);
  });

  it("D-19: the monthly counts cannot contradict the employee total", () => {
    /*
     * ═══ FOUND BY LOOKING, NOT BY TESTING ═══
     *
     * The first screenshot of the empty form showed "TOTAL EMPLOYEES 0" and,
     * two lines below it, "JANUARY 10  FEBRUARY 11  MARCH 9". Both halves were
     * behaving correctly in isolation: the totals described an empty wage table,
     * and the monthly counts faithfully echoed the `monthlyHeadcount` input,
     * which is passed independently of `ret`.
     *
     * ESD cross-checks those two figures against each other, so a form that
     * disagrees with itself there is a form that invites a notice. Every one of
     * the 11,658 tests passing at that moment was blind to it, because no test
     * compared the two regions of the page.
     *
     * This gate is deliberately fed a NON-EMPTY headcount alongside a null
     * return — the exact combination that produced the contradiction — rather
     * than the nulls the page happens to pass today. A gate that only exercises
     * today's caller proves nothing about tomorrow's.
     */
    const contradictory = buildEamsConfirmation({
      ...BASE_INPUT,
      ret: null,
      monthlyHeadcount: [10, 11, 9],
    });
    expect(contradictory.totalEmployees).toBe(0);
    for (const m of contradictory.monthlyCounts) {
      expect(
        m.count,
        `${m.month} reported "${m.count}" employees on a quarter whose employee total is 0`,
      ).toBe("\u2014");
    }
  });

  it("still says it is not a filing", () => {
    // The blank form is the one most likely to be printed and shown to someone.
    expect(empty.notFiledNotice.length).toBeGreaterThan(40);
    expect(empty.notFiledNotice).toMatch(/not a filing/i);
  });
});
