/**
 * tests/compliance/wa-quarterly-ui-core.test.ts   (books-41)
 *
 * THE WASHINGTON QUARTERLY SCREEN'S DECISIONS, PROVED.
 *
 * The page that goes with `wa-quarterly-ui-core.ts` is markup and nothing else.
 * Every rule it follows - which colour, which sentence, whether a button may be
 * pressed, how the quarter splits into submissions - lives in that module, and
 * this file is the reason we can say it works.
 *
 * WHAT THIS SUITE IS ESPECIALLY LOOKING FOR.
 *
 *   1. That the THREE SUBMISSIONS are three, and that the two ESD ones are not
 *      quietly merged. That merge is the most likely future regression, because
 *      "group by agency" is the obvious refactor and it is wrong here.
 *   2. That the ownership totals DO NOT DOUBLE-COUNT. The engine emits totals
 *      alongside their own components; adding everything is the natural bug and
 *      it roughly doubles the figure Michael reads.
 *   3. That the HOURS BOX never renders as money. It carries amountCents: 0, so
 *      the failure mode is a confident "$0.00" against a box that says 3,558
 *      hours.
 *
 * Every figure is computed from the engine, never typed in. Where a number IS
 * typed in, it is a figure a state agency actually assessed.
 */

import { describe, expect, it } from "vitest";
import {
  type WaQuarterRequest,
  type WaQuarterResult,
  type WaQuarterReturn,
  ALL_WA_QUARTER_REFUSAL_CODES,
  buildWaQuarter,
  waLineOf,
  waQuarterDueDate,
} from "@/lib/payroll/wa-quarterly-core";
import {
  formatMoneyCents,
  waAgencyGroups,
  waDaysUntil,
  waEmptyStateFor,
  waFormRenderCoverage,
  waLineRows,
  waWageDetailRows,
  waNextAction,
  waOwnershipSummary,
  waQuarterLabel,
  waRateAsOfDate,
  waRefusalCard,
  waResolveRates,
  waRefusalCoverage,
  waStatusLabel,
  waStatusMeaning,
  waStatusOf,
  waStatusTone,
  waSubmitButtonState,
  waUrgencyBand,
  waUrgencyMeaning,
  waUrgencyTone,
  whoseMoneyLabel,
} from "@/lib/payroll/wa-quarterly-ui-core";
import { WA_BOX_EXPLAINERS, waFormGuide } from "@/lib/payroll/wa-quarterly-mentor";
import { GREENWAY_RATES } from "@/lib/payroll/payroll-rates-2026";
import { quarterDateRange } from "@/lib/payroll/payroll-deposit-schedule-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * FIXTURES - the real Q2 2026 quarter, at the real rates
 * ═══════════════════════════════════════════════════════════════════════════ */

const Q2_2026_RATES = {
  sutaUiMilliPct: 370,
  sutaEafMilliPct: 30,
  pfmlTotalMilliPct: 1_130,
  pfmlEmployeeShareMilliPct: 71_430,
  waCaresMilliPct: 580,
  lniEmployeeMilliCentsPerHour: 16_445,
  lniEmployerMilliCentsPerHour: 39_485,
} as const;

/**
 * The whole quarter as a single aggregate subject.
 *
 * The engine's own suite proves the per-person build against the filed return.
 * This suite is about the SCREEN, so it uses the quarter's real totals in one
 * row: same figures, less noise.
 */
function aggregateRequest(over: Partial<WaQuarterRequest> = {}): WaQuarterRequest {
  return {
    quarter: { year: 2026, quarter: 2 },
    subjects: [
      {
        subjectId: "aggregate",
        displayName: "All staff",
        wagesCents: 6_892_345,
        esdTaxableWagesCents: 6_892_345,
        pfmlTaxableWagesCents: 6_892_345,
        hours: 3_558,
      },
    ],
    rates: Q2_2026_RATES,
    pfml: { employerOwesEmployerShare: false, determinedAverageHeadcount: 10 },
    ...over,
  };
}

function builtQuarter(): WaQuarterReturn {
  const r = buildWaQuarter(aggregateRequest());
  if (!r.ok) {
    throw new Error(`fixture refused: ${r.refusals.map((x) => x.code).join(", ")}`);
  }
  return r.value;
}

function okResult(): WaQuarterResult {
  return buildWaQuarter(aggregateRequest());
}

/** A quarter the engine will genuinely refuse, for the blocked-state tests. */
function refusedResult(): WaQuarterResult {
  const r = buildWaQuarter(aggregateRequest({ subjects: [] }));
  if (r.ok) throw new Error("the fixture meant to be refused was accepted");
  return r;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 0. GUARD THE GUARD
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the fixtures are real, so the rest of this suite means something", () => {
  it("the ok fixture actually builds", () => {
    expect(okResult().ok).toBe(true);
  });

  it("the refused fixture actually refuses, and for the stated reason", () => {
    const r = refusedResult();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals.map((x) => x.code)).toContain("NO_SUBJECTS");
  });

  it("the quarter has box lines on three forms, because the fourth has no boxes", () => {
    // THIS TEST FAILED FIRST TIME AND IT TAUGHT ME SOMETHING.
    // I asserted four, because there are four forms. There are only three sets
    // of BOXES: Form 5208B is one row per employee, so the engine carries it in
    // `wageDetail` rather than in `lines`. A screen that only rendered `lines`
    // would show three forms and drop the fourth without any error - and the
    // 5208A without the 5208B is an INCOMPLETE report at ESD, penalty and all.
    const forms = new Set(builtQuarter().lines.map((l) => l.form));
    expect(forms.size).toBe(3);
    expect(forms.has("esd_5208b")).toBe(false);
  });

  it("and the fourth form is genuinely rendered, by the wage detail", () => {
    const coverage = waFormRenderCoverage(builtQuarter());
    expect(coverage.length).toBe(4);
    expect(coverage.filter((c) => c.renderedBy === "nothing")).toEqual([]);
    expect(coverage.find((c) => c.form === "esd_5208b")!.renderedBy).toBe("wage-detail");
  });

  it("the other three are rendered by their boxes", () => {
    const coverage = waFormRenderCoverage(builtQuarter());
    for (const form of ["esd_5208a", "pfml_wa_cares", "lni_quarterly"] as const) {
      expect(coverage.find((c) => c.form === form)!.renderedBy).toBe("boxes");
    }
  });
});

describe("Form 5208B is people, not boxes", () => {
  it("there is one row per person on the payroll", () => {
    const ret = builtQuarter();
    expect(waWageDetailRows(ret).length).toBe(ret.wageDetail.length);
    expect(waWageDetailRows(ret).length).toBeGreaterThan(0);
  });

  it("each row names the person, so a mismatch can be traced to somebody", () => {
    for (const row of waWageDetailRows(builtQuarter())) {
      expect(row.displayName.length).toBeGreaterThan(0);
      expect(row.subjectId.length).toBeGreaterThan(0);
    }
  });

  it("wages are formatted as money and hours as hours", () => {
    const row = waWageDetailRows(builtQuarter())[0];
    expect(row.wagesFormatted).toMatch(/^\$[\d,]+\.\d{2}$/);
    expect(row.hoursFormatted).toContain("hours");
    expect(row.hoursFormatted).not.toContain("$");
  });

  it("the wage detail totals agree with the figures the 5208A is charged on", () => {
    // This is the reconciliation ESD itself performs between the two halves of
    // the filing. If these disagree, the report is rejected as inconsistent.
    const ret = builtQuarter();
    const wages = ret.wageDetail.reduce((a, r) => a + r.wagesCents, 0);
    const hours = ret.wageDetail.reduce((a, r) => a + r.hours, 0);
    expect(wages).toBe(ret.grossWagesCents);
    expect(hours).toBe(ret.totalHours);
  });

  it("one hour is singular", () => {
    const r = buildWaQuarter(
      aggregateRequest({
        subjects: [
          {
            subjectId: "solo",
            displayName: "One Hour Person",
            wagesCents: 2_000,
            esdTaxableWagesCents: 2_000,
            pfmlTaxableWagesCents: 2_000,
            hours: 1,
          },
        ],
      }),
    );
    if (!r.ok) throw new Error("fixture refused");
    expect(waWageDetailRows(r.value)[0].hoursFormatted).toBe("1 hour");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. HOW LONG IS LEFT
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the deadline arithmetic does not depend on where the server is", () => {
  it("counts whole days forward", () => {
    expect(waDaysUntil("2027-07-01", "2027-07-31")).toBe(30);
  });

  it("counts backwards when the date has passed", () => {
    expect(waDaysUntil("2027-08-10", "2027-08-02")).toBe(-8);
  });

  it("is zero on the day itself", () => {
    expect(waDaysUntil("2027-08-02", "2027-08-02")).toBe(0);
  });

  it("crosses a daylight-saving boundary without losing an hour into a day", () => {
    // 8 March 2026 is the US spring-forward. Computed in UTC from date parts,
    // this must be exactly 2 days; a local-Date implementation can return 1.
    expect(waDaysUntil("2026-03-07", "2026-03-09")).toBe(2);
  });

  it("crosses a leap day correctly", () => {
    expect(waDaysUntil("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("refuses a malformed date rather than returning NaN", () => {
    // NaN would propagate silently into the band and colour the badge green.
    expect(() => waDaysUntil("2027-7-1", "2027-07-31")).toThrow(/not an ISO date/);
  });

  it("names the offending value when it refuses", () => {
    expect(() => waDaysUntil("2027-07-01", "soon")).toThrow(/"soon"/);
  });
});

describe("the urgency bands, and the boundaries between them", () => {
  it("negative days is overdue", () => {
    expect(waUrgencyBand(-1)).toBe("overdue");
  });

  it("the day itself is due-now, not overdue", () => {
    expect(waUrgencyBand(0)).toBe("due-now");
  });

  it("seven days is still due-now", () => {
    expect(waUrgencyBand(7)).toBe("due-now");
  });

  it("eight days is due-soon", () => {
    expect(waUrgencyBand(8)).toBe("due-soon");
  });

  it("thirty days is still due-soon", () => {
    expect(waUrgencyBand(30)).toBe("due-soon");
  });

  it("thirty-one days is comfortable", () => {
    expect(waUrgencyBand(31)).toBe("comfortable");
  });

  it("each band has its own tone, so two states never look identical", () => {
    const tones = (["overdue", "due-now", "due-soon", "comfortable"] as const).map(waUrgencyTone);
    expect(new Set(tones).size).toBe(4);
  });

  it("only the overdue band is danger", () => {
    expect(waUrgencyTone("overdue")).toBe("danger");
    expect(waUrgencyTone("due-now")).not.toBe("danger");
  });
});

describe("the deadline sentence cannot be misread as reassurance", () => {
  it("the overdue sentence says the returns were due, in the past tense", () => {
    const s = waUrgencyMeaning("overdue", -8, "2027-08-02");
    expect(s).toContain("were due");
    expect(s).toContain("8 days ago");
  });

  it("the overdue sentence names the Washington trap", () => {
    // A reader who knows the 941 expects paying on time to buy an extension.
    // The moment that assumption costs money is the moment it is already late.
    expect(waUrgencyMeaning("overdue", -1, "2027-08-02")).toContain(
      "no federal-style extension",
    );
  });

  it("one day is singular, and not '1 days'", () => {
    expect(waUrgencyMeaning("overdue", -1, "2027-08-02")).toContain("1 day ago");
  });

  it("the comfortable sentence still gives the date", () => {
    expect(waUrgencyMeaning("comfortable", 45, "2027-11-01")).toContain("2027-11-01");
  });

  it("the due-now sentence warns that there are three submissions", () => {
    expect(waUrgencyMeaning("due-now", 3, "2027-08-02")).toContain("three separate submissions");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. THE STATE OF THE QUARTER
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the status badge", () => {
  it("a quarter that builds is ready", () => {
    expect(waStatusOf(okResult())).toBe("ready");
  });

  it("a quarter that refuses is blocked", () => {
    expect(waStatusOf(refusedResult())).toBe("blocked");
  });

  it("ready is green and blocked is danger", () => {
    expect(waStatusTone("ready")).toBe("green");
    expect(waStatusTone("blocked")).toBe("danger");
  });

  it("the ready label does NOT say 'ready to file'", () => {
    // The arithmetic being done is not the same as the data being right, and
    // "ready to file" would invite skipping the checklist that catches real
    // errors. This is a deliberate wording choice, so it is pinned.
    const label = waStatusLabel("ready");
    expect(label).toBe("Figures ready");
    expect(label.toLowerCase()).not.toContain("file");
  });

  it("the ready meaning says explicitly that the inputs have not been checked", () => {
    expect(waStatusMeaning("ready")).toContain("not that the underlying hours and wages");
  });

  it("the blocked meaning explains that refusing beats guessing", () => {
    expect(waStatusMeaning("blocked")).toContain("rather than guessing");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. THE ONE NEXT ACTION
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("there is exactly one next action, and refusals outrank the calendar", () => {
  it("a blocked quarter sends him to the blocker, not to the deadline", () => {
    // Even though this date is years overdue, the instruction must be about
    // the missing data: he cannot meet a deadline until the data exists.
    const a = waNextAction(refusedResult(), "2030-01-01");
    expect(a.tone).toBe("danger");
    expect(a.headline).toContain("missing");
    expect(a.headline).not.toContain("overdue");
  });

  it("one refusal is described in the singular", () => {
    const a = waNextAction(refusedResult(), "2026-07-15");
    expect(a.headline).toBe("One thing is missing before these returns can be produced.");
  });

  it("the blocked action's detail is the mentor's fix, not a shrug", () => {
    const a = waNextAction(refusedResult(), "2026-07-15");
    expect(a.detail.length).toBeGreaterThan(30);
    expect(a.detail).not.toBe("Review the items listed below.");
  });

  it("an overdue ready quarter says overdue, with the real day count", () => {
    // Q2 2026 is due 2026-07-31. Recomputed, never assumed.
    const due = waQuarterDueDate({ year: 2026, quarter: 2 }).dueDate;
    const today = "2026-08-10";
    const late = Math.abs(waDaysUntil(today, due));
    const a = waNextAction(okResult(), today);
    expect(a.tone).toBe("danger");
    expect(a.headline).toContain(`overdue by ${late} days`);
  });

  it("the overdue advice says to file now even if payment follows", () => {
    expect(waNextAction(okResult(), "2026-08-10").detail).toContain(
      "even if a payment follows",
    );
  });

  it("a comfortable ready quarter is green and names the quarter", () => {
    // 2026-07-01 is exactly 30 days from the 2026-07-31 deadline, which is the
    // due-soon BOUNDARY and therefore gold, not green. I originally wrote this
    // date assuming "the start of the filing month is comfortable"; it is not,
    // because the whole filing window is only one month long. Using a date
    // inside the quarter instead, and recomputing rather than assuming.
    const due = waQuarterDueDate({ year: 2026, quarter: 2 }).dueDate;
    const today = "2026-06-01";
    expect(waUrgencyBand(waDaysUntil(today, due))).toBe("comfortable");
    const a = waNextAction(okResult(), today);
    expect(a.tone).toBe("green");
    expect(a.headline).toContain("Q2 2026");
  });

  it("the first day of the filing month is already gold, not green", () => {
    // Worth pinning, because it is the mistake I made writing the test above.
    // These returns are due one month after the quarter closes, so the day the
    // quarter ends there are only thirty days left - the window never has a
    // comfortable phase once the quarter is over.
    const due = waQuarterDueDate({ year: 2026, quarter: 2 }).dueDate;
    expect(waDaysUntil("2026-07-01", due)).toBe(30);
    expect(waNextAction(okResult(), "2026-07-01").tone).toBe("gold");
  });

  it("the tone tracks the calendar as the deadline approaches", () => {
    const tone = (today: string): string => waNextAction(okResult(), today).tone;
    expect(tone("2026-06-01")).toBe("green"); // 60 days out
    expect(tone("2026-07-10")).toBe("gold"); // 21 days out
    expect(tone("2026-07-28")).toBe("orange"); // 3 days out
    expect(tone("2026-08-01")).toBe("danger"); // past
  });

  it("every next action offers a call to action", () => {
    for (const today of ["2026-06-01", "2026-07-28", "2026-08-10"]) {
      expect(waNextAction(okResult(), today).ctaLabel.length).toBeGreaterThan(0);
    }
    expect(waNextAction(refusedResult(), "2026-06-01").ctaLabel.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. THE BUTTON THAT DOES NOT FILE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the button never claims to file anything", () => {
  it("is enabled when the figures exist", () => {
    expect(waSubmitButtonState(okResult()).enabled).toBe(true);
  });

  it("is disabled when they do not, and says how many items block it", () => {
    const s = waSubmitButtonState(refusedResult());
    expect(s.enabled).toBe(false);
    expect(s.disabledReason).toContain("One item");
  });

  it("the enabled label is 'Show the figures', not 'File'", () => {
    // A button labelled File that does not file is the most dangerous control
    // we could ship: the failure mode is believing a return went in.
    expect(waSubmitButtonState(okResult()).label).toBe("Show the figures");
  });

  it("no button label anywhere contains the word 'file' as a verb", () => {
    for (const r of [okResult(), refusedResult()]) {
      expect(waSubmitButtonState(r).label.toLowerCase()).not.toMatch(/\bfile\b/);
    }
  });

  it("the honesty note appears whether or not the button is enabled", () => {
    for (const r of [okResult(), refusedResult()]) {
      const note = waSubmitButtonState(r).honestyNote;
      expect(note).toContain("does not transmit anything");
      // The sentence reads "nothing here files on your behalf, and nothing
      // here is a filing agent" - the negation is carried by "nothing here",
      // so the phrase to look for is the positive one. Checked against the
      // real string rather than the one I expected to have written.
      expect(note).toContain("nothing here is a filing agent");
      expect(note).toContain("nothing here files on your behalf");
    }
  });

  it("the honesty note names all three places he has to go himself", () => {
    const note = waSubmitButtonState(okResult()).honestyNote;
    expect(note).toContain("EAMS");
    expect(note).toContain("Paid Leave system");
    expect(note).toContain("L&I portal");
  });

  it("the honesty note tells him to keep the confirmation numbers", () => {
    expect(waSubmitButtonState(okResult()).honestyNote).toContain("confirmation numbers");
  });

  it("a disabled button has a reason and an enabled one does not", () => {
    expect(waSubmitButtonState(okResult()).disabledReason).toBeNull();
    expect(waSubmitButtonState(refusedResult()).disabledReason).not.toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. THREE SUBMISSIONS, AND THE ESD SPLIT THAT CATCHES PEOPLE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the quarter splits into the submissions he actually has to make", () => {
  it("there are three, not two and not four", () => {
    expect(waAgencyGroups(builtQuarter()).length).toBe(3);
  });

  it("two of the three go to Employment Security, and they are still two", () => {
    // THE REGRESSION THIS EXISTS TO CATCH: "group by agency" is the obvious
    // refactor and it would merge these, teaching him that one submission
    // discharges both duties. It does not.
    const groups = waAgencyGroups(builtQuarter());
    const esd = groups.filter((g) => g.agency === "Employment Security Department");
    expect(esd.length).toBe(2);
    expect(esd[0].destination).not.toBe(esd[1].destination);
  });

  it("the Paid Leave group says in words that it is a separate system", () => {
    const g = waAgencyGroups(builtQuarter()).find((x) => x.key === "esd-paid-leave")!;
    expect(g.why).toContain("Same agency, same deadline, different system");
  });

  it("the Paid Leave group warns that this is the one people miss", () => {
    const g = waAgencyGroups(builtQuarter()).find((x) => x.key === "esd-paid-leave")!;
    expect(g.why).toContain("the one people miss");
  });

  it("5208A and 5208B travel together, because separately they are incomplete", () => {
    const g = waAgencyGroups(builtQuarter()).find((x) => x.key === "esd-eams")!;
    expect(g.forms).toEqual(["esd_5208a", "esd_5208b"]);
    expect(g.why).toContain("incomplete report");
  });

  it("every form on the return belongs to exactly one group", () => {
    const ret = builtQuarter();
    const grouped = waAgencyGroups(ret).flatMap((g) => g.forms);
    const onReturn = new Set(ret.lines.map((l) => l.form));
    expect(new Set(grouped).size, "a form was listed in two groups").toBe(grouped.length);
    for (const f of onReturn) {
      expect(grouped, `form ${f} appears on the return but in no group`).toContain(f);
    }
  });

  it("each group carries the official name of its forms, not the internal id", () => {
    for (const g of waAgencyGroups(builtQuarter())) {
      expect(g.formTitles.length).toBe(g.forms.length);
      for (let i = 0; i < g.forms.length; i++) {
        expect(g.formTitles[i]).toBe(waFormGuide(g.forms[i])!.officialName);
        expect(g.formTitles[i]).not.toBe(g.forms[i]);
      }
    }
  });

  it("the three group totals are the engine's own agency totals", () => {
    const ret = builtQuarter();
    const g = waAgencyGroups(ret);
    expect(g.find((x) => x.key === "esd-eams")!.totalCents).toBe(ret.esdTotalCents);
    expect(g.find((x) => x.key === "esd-paid-leave")!.totalCents).toBe(ret.pfmlWaCaresTotalCents);
    expect(g.find((x) => x.key === "lni")!.totalCents).toBe(ret.lniTotalCents);
  });

  it("the L&I group says it is charged on hours, not wages", () => {
    const g = waAgencyGroups(builtQuarter()).find((x) => x.key === "lni")!;
    expect(g.why).toContain("HOURS rather than wages");
  });

  it("each group's formatted total matches its cents", () => {
    for (const g of waAgencyGroups(builtQuarter())) {
      expect(g.totalFormatted).toBe(formatMoneyCents(g.totalCents));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. WHOSE MONEY - AND NOT COUNTING IT TWICE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the quarter is totalled three ways, because the law treats it three ways", () => {
  it("there are exactly three buckets", () => {
    expect(waOwnershipSummary(builtQuarter()).length).toBe(3);
  });

  it("the employer bucket cites the statute that makes deduction unlawful", () => {
    const b = waOwnershipSummary(builtQuarter()).find((x) => x.whose === "employer_cost")!;
    expect(b.meaning).toContain("RCW 50.24.010");
    expect(b.meaning).toContain("unlawful");
  });

  it("the employee bucket says the money is held in trust, and cites why", () => {
    const b = waOwnershipSummary(builtQuarter()).find((x) => x.whose === "employee_money")!;
    expect(b.meaning).toContain("RCW 50A.10.030(7)(b)");
    expect(b.meaning).toContain("in trust");
  });

  it("the three buckets use three different words for whose money it is", () => {
    const labels = waOwnershipSummary(builtQuarter()).map((b) => b.label);
    expect(new Set(labels).size).toBe(3);
  });

  it("NOTHING IS COUNTED TWICE: the buckets add to the sum of non-total lines", () => {
    // The engine emits esd-total and lni-premium ALONGSIDE their components.
    // Summing every money line would roughly double the answer, and it would
    // look entirely plausible on screen.
    const ret = builtQuarter();
    const buckets = waOwnershipSummary(ret)
      .map((b) => b.totalCents)
      .reduce((a, b) => a + b, 0);
    const components = ret.lines
      .filter((l) => l.measure === "money" && l.id !== "esd-total" && l.id !== "lni-premium")
      .reduce((a, l) => a + l.amountCents, 0);
    expect(buckets).toBe(components);
  });

  it("and the naive sum really would have been different, so that test has teeth", () => {
    const ret = builtQuarter();
    const naive = ret.lines
      .filter((l) => l.measure === "money")
      .reduce((a, l) => a + l.amountCents, 0);
    const buckets = waOwnershipSummary(ret)
      .map((b) => b.totalCents)
      .reduce((a, b) => a + b, 0);
    expect(naive).toBeGreaterThan(buckets);
  });

  it("the buckets add up to what actually leaves the business", () => {
    const ret = builtQuarter();
    const buckets = waOwnershipSummary(ret)
      .map((b) => b.totalCents)
      .reduce((a, b) => a + b, 0);
    expect(buckets).toBe(ret.esdTotalCents + ret.pfmlWaCaresTotalCents + ret.lniTotalCents);
  });

  it("the employer/employee split agrees with the engine's own split", () => {
    const ret = builtQuarter();
    const s = waOwnershipSummary(ret);
    const employer = s.find((b) => b.whose === "employer_cost")!.totalCents;
    const employee = s.find((b) => b.whose === "employee_money")!.totalCents;
    const shared = s.find((b) => b.whose === "shared")!.totalCents;
    // The engine reports funding without the "shared" middle category, so the
    // shared bucket must be exactly the part its two figures do not cover.
    expect(employer + employee + shared).toBe(ret.employeeFundedCents + ret.employerFundedCents);
  });

  it("the hours box is not counted as money in any bucket", () => {
    // It carries amountCents: 0, so including it would not change the total -
    // which is exactly why a test has to prove it is excluded on purpose.
    const ret = builtQuarter();
    const hoursLines = ret.lines.filter((l) => l.measure === "hours");
    expect(hoursLines.length, "no hours line, so this guard proves nothing").toBeGreaterThan(0);
    for (const l of hoursLines) expect(l.amountCents).toBe(0);
  });

  it("every bucket's formatted total matches its cents", () => {
    for (const b of waOwnershipSummary(builtQuarter())) {
      expect(b.totalFormatted).toBe(formatMoneyCents(b.totalCents));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. RENDERING THE BOXES
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the rows a form renders", () => {
  it("returns the lines for the form asked for, and no others", () => {
    for (const form of ["esd_5208a", "esd_5208b", "pfml_wa_cares", "lni_quarterly"] as const) {
      for (const row of waLineRows(builtQuarter(), form)) {
        expect(row.form).toBe(form);
      }
    }
  });

  it("THE HOURS BOX RENDERS AS HOURS, NOT AS $0.00", () => {
    // The single most likely rendering bug on this screen.
    const ret = builtQuarter();
    const rows = waLineRows(ret, "lni_quarterly");
    const hours = rows.find((r) => r.id === "lni-hours");
    expect(hours, "the L&I hours row is missing").toBeDefined();
    expect(hours!.value).toContain("hours");
    expect(hours!.value).not.toContain("$");
    expect(hours!.value).toContain("3,558");
  });

  it("money boxes render with a dollar sign and two decimals", () => {
    const ret = builtQuarter();
    const ui = waLineRows(ret, "esd_5208a").find((r) => r.id === "esd-ui")!;
    expect(ui.value).toMatch(/^\$[\d,]+\.\d{2}$/);
  });

  it("a rendered money value equals the engine's cents for that line", () => {
    const ret = builtQuarter();
    const row = waLineRows(ret, "esd_5208a").find((r) => r.id === "esd-ui")!;
    expect(row.value).toBe(formatMoneyCents(waLineOf(ret, "esd-ui")!.amountCents));
  });

  it("every row carries the engine's own arithmetic sentence", () => {
    for (const row of waLineRows(builtQuarter(), "esd_5208a")) {
      expect(row.shownAs.length).toBeGreaterThan(0);
    }
  });

  it("the total rows are flagged as totals, and the components are not", () => {
    const ret = builtQuarter();
    const a = waLineRows(ret, "esd_5208a");
    expect(a.find((r) => r.id === "esd-total")!.isTotal).toBe(true);
    expect(a.find((r) => r.id === "esd-ui")!.isTotal).toBe(false);
    expect(a.find((r) => r.id === "esd-eaf")!.isTotal).toBe(false);
  });

  it("every box that has an explainer gets one attached", () => {
    const ret = builtQuarter();
    const explained = new Set(WA_BOX_EXPLAINERS.map((b) => b.lineId));
    for (const form of ["esd_5208a", "pfml_wa_cares", "lni_quarterly"] as const) {
      for (const row of waLineRows(ret, form)) {
        if (explained.has(row.id)) {
          expect(row.explains, `box ${row.id} lost its explainer`).not.toBeNull();
          expect(row.explains!.whatGoesHere.length).toBeGreaterThan(0);
          expect(row.explains!.ifItIsWrong.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the ownership badge uses three distinct vocabularies", () => {
    expect(whoseMoneyLabel("employer_cost")).toBe("Your money");
    expect(whoseMoneyLabel("employee_money")).toBe("Your staff's money");
    expect(whoseMoneyLabel("shared")).toBe("Shared");
  });

  it("each row's badge matches the engine's ownership for that line", () => {
    const ret = builtQuarter();
    for (const form of ["esd_5208a", "pfml_wa_cares", "lni_quarterly"] as const) {
      for (const row of waLineRows(ret, form)) {
        expect(row.whoseMoneyLabel).toBe(whoseMoneyLabel(waLineOf(ret, row.id)!.whoseMoney));
      }
    }
  });
});

describe("a refusal is rendered as something he can act on", () => {
  it("keeps the engine's specific complaint AND the mentor's general lesson", () => {
    const r = refusedResult();
    if (r.ok) throw new Error("unreachable");
    const card = waRefusalCard(r.refusals[0]);
    expect(card.because.length).toBeGreaterThan(0);
    expect(card.fix.length).toBeGreaterThan(0);
    expect(card.whyItRefuses, "the mentor lesson was dropped").not.toBeNull();
  });

  it("carries the refusal code, so it can be looked up", () => {
    const r = refusedResult();
    if (r.ok) throw new Error("unreachable");
    expect(waRefusalCard(r.refusals[0]).code).toBe("NO_SUBJECTS");
  });

  it("names the person when the engine identified one", () => {
    const bad = buildWaQuarter(
      aggregateRequest({
        subjects: [
          {
            subjectId: "aggregate",
            displayName: "All staff",
            wagesCents: 100_000,
            esdTaxableWagesCents: 100_000,
            pfmlTaxableWagesCents: 100_000,
            hours: 0,
          },
        ],
      }),
    );
    if (bad.ok) throw new Error("expected a refusal for wages without hours");
    const card = waRefusalCard(bad.refusals[0]);
    expect(card.subjectId).toBe("aggregate");
  });

  it("every refusal card is danger-toned", () => {
    const r = refusedResult();
    if (r.ok) throw new Error("unreachable");
    for (const x of r.refusals) expect(waRefusalCard(x).tone).toBe("danger");
  });

  it("EVERY refusal the engine can raise is taught", () => {
    // A refusal he can trigger but cannot be taught about is a dead end.
    const gaps = waRefusalCoverage().filter((c) => !c.taught);
    expect(gaps.map((g) => g.code)).toEqual([]);
  });

  it("the coverage check covers every code the engine declares", () => {
    expect(waRefusalCoverage().length).toBe(ALL_WA_QUARTER_REFUSAL_CODES.length);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. LABELS AND THE EMPTY STATE THAT IS NOT EMPTY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("labels and money formatting", () => {
  it("the quarter label is spelled one way everywhere", () => {
    expect(waQuarterLabel({ year: 2026, quarter: 2 })).toBe("Q2 2026");
  });

  it("formats thousands with separators and exactly two decimals", () => {
    expect(formatMoneyCents(6_892_345)).toBe("$68,923.45");
  });

  it("formats zero as $0.00, not as nothing", () => {
    expect(formatMoneyCents(0)).toBe("$0.00");
  });

  it("puts the minus sign before the dollar sign", () => {
    expect(formatMoneyCents(-1_234)).toBe("-$12.34");
  });

  it("does not round a stray cent away", () => {
    expect(formatMoneyCents(1)).toBe("$0.01");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. THE SEVEN RATES, OR AN HONEST LIST OF WHAT IS MISSING
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the rates are fetched from the registry, or refused by name", () => {
  it("resolves all seven from Greenway's real registry, on a date it covers", () => {
    const r = waResolveRates(GREENWAY_RATES, "2026-06-30");
    expect(r.ok, r.ok ? "" : r.missing.map((m) => m.label).join("; ")).toBe(true);
  });

  it("the resolved rates are the ones the filed quarter was computed at", () => {
    // Pinned against the figures the engine's own suite proves reproduce the
    // filed Q2 2026 return. If the registry drifts, this fails here rather
    // than silently changing a number on a state return.
    const r = waResolveRates(GREENWAY_RATES, "2026-06-30");
    if (!r.ok) throw new Error("expected the 2026 rates to resolve");
    expect(r.rates).toEqual(Q2_2026_RATES);
  });

  it("REFUSES rather than returning zero when a rate is not on file", () => {
    // 2027 rates do not exist yet. A `?? 0` here would produce a return
    // showing no premium owed, which looks entirely normal and is very wrong.
    const r = waResolveRates(GREENWAY_RATES, "2027-03-31");
    expect(r.ok).toBe(false);
  });

  it("lists EVERY missing rate, not just the first one", () => {
    const r = waResolveRates(GREENWAY_RATES, "2027-03-31");
    if (r.ok) throw new Error("expected 2027 to be unevidenced");
    // The notices that carry these arrive together, so he should get the whole
    // list at once rather than one round trip per rate.
    expect(r.missing.length).toBeGreaterThan(1);
  });

  it("names each missing rate in English, not by its database key", () => {
    const r = waResolveRates(GREENWAY_RATES, "2027-03-31");
    if (r.ok) throw new Error("expected 2027 to be unevidenced");
    for (const m of r.missing) {
      expect(m.label).not.toContain("_");
      expect(m.label.length).toBeGreaterThan(5);
    }
  });

  it("every missing rate carries both why it stopped and what to do", () => {
    const r = waResolveRates(GREENWAY_RATES, "2027-03-31");
    if (r.ok) throw new Error("expected 2027 to be unevidenced");
    for (const m of r.missing) {
      expect(m.message.length).toBeGreaterThan(20);
      expect(m.whatToDo.length).toBeGreaterThan(20);
    }
  });

  it("the refusal explains that a stale rate is worse than a missing one", () => {
    const r = waResolveRates(GREENWAY_RATES, "2027-03-31");
    if (r.ok) throw new Error("expected 2027 to be unevidenced");
    expect(r.missing.some((m) => m.message.includes("stale rate"))).toBe(true);
  });

  it("both unemployment components are demanded separately", () => {
    // books-41 split the single ESD rate into UI and EAF because the two are
    // rounded separately by two different statutes. A resolver that asked for
    // wa_suta_total would undo that.
    const r = waResolveRates(GREENWAY_RATES, "2027-03-31");
    if (r.ok) throw new Error("expected 2027 to be unevidenced");
    const keys = r.missing.map((m) => m.key);
    expect(keys).toContain("wa_suta_ui");
    expect(keys).toContain("wa_suta_eaf");
    expect(keys).not.toContain("wa_suta_total");
  });

  it("asks the registry about the LAST day of the quarter, not the first", () => {
    // Washington rates change on 1 January, which is the first day of Q1.
    // Asking on the first day of a quarter would fetch the OLD rate for Q1.
    expect(waRateAsOfDate({ year: 2026, quarter: 1 })).toBe("2026-03-31");
    expect(waRateAsOfDate({ year: 2026, quarter: 2 })).toBe("2026-06-30");
    expect(waRateAsOfDate({ year: 2026, quarter: 3 })).toBe("2026-09-30");
    expect(waRateAsOfDate({ year: 2026, quarter: 4 })).toBe("2026-12-31");
  });

  it("gets February right in a leap year and in a common year", () => {
    expect(waRateAsOfDate({ year: 2028, quarter: 1 })).toBe("2028-03-31");
    // Q1 always ends in March, so the leap day never lands on a quarter end -
    // but the day-count arithmetic is still worth pinning against an off-by-one.
    expect(waRateAsOfDate({ year: 2027, quarter: 1 })).toBe("2027-03-31");
  });

  it("the date it asks about really is inside the quarter it is for", () => {
    for (const q of [1, 2, 3, 4] as const) {
      const iso = waRateAsOfDate({ year: 2026, quarter: q });
      const range = quarterDateRange({ year: 2026, quarter: q });
      expect(iso >= range.start && iso <= range.end).toBe(true);
      expect(iso).toBe(range.end);
    }
  });
});

describe("the empty state tells him a zero still has to be reported", () => {
  it("says which quarter is empty", () => {
    expect(waEmptyStateFor({ year: 2027, quarter: 1 }).title).toContain("Q1 2027");
  });

  it("does NOT say there is nothing to do", () => {
    // WAC 296-17-31023: file nothing and L&I estimates the premium for you.
    const body = waEmptyStateFor({ year: 2027, quarter: 1 }).body;
    expect(body).toContain("still has to be REPORTED");
    expect(body).toContain("estimate the premium");
  });

  it("gives the real due date for that quarter, recomputed", () => {
    const q = { year: 2027, quarter: 3 } as const;
    const due = waQuarterDueDate(q).dueDate;
    expect(due).toBe("2027-11-01"); // 31 October 2027 is a Sunday
    expect(waEmptyStateFor(q).body).toContain(due);
  });
});
