/**
 * Schedule B (Form 941). Rule 129(e): this is money, and it is filed with a
 * government, so it is tested without economising.
 *
 * The anchor is Michael's own filed Q2 2026 Schedule B, read out of
 * 2ND_QTR_FORM_941.pdf, not an invented example.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  scheduleBLiability,
  type ScheduleBPayday,
} from "@/lib/payroll/form-941-schedule-b-core";
import { pageArt, copiesOnSheet, facsimileBoxes } from "@/lib/payroll/form-facsimile-core";
import {
  FORM_ID_941_SB,
  SCHEDULE_B_LESSONS,
  scheduleBIdentityText,
  scheduleBBoxes,
  scheduleBTeachingBoxes,
} from "@/lib/payroll/form-941-schedule-b-boxes";

const REPO = join(__dirname, "..", "..");
const boxMap = JSON.parse(
  readFileSync(join(REPO, "src/lib/payroll/form-box-map.generated.json"), "utf8"),
) as Record<
  string,
  {
    placed: Record<string, string[]>;
    unclaimed?: string[];
    unclaimedReasons?: Record<string, string>;
    centsMaxLen?: number;
  }
>;

const Q2 = { year: 2026, quarter: 2 as const };

/**
 * His filed Q2: seven paydays, and the liabilities the paper shows.
 *
 * Wage bases are apportioned evenly across the seven because the filed return
 * states only the quarter total (68923.45); what is being tested here is the
 * RECONCILIATION and the day placement, both of which hold for any split.
 */
const Q2_LINE12_CENTS = 1_420_457;
const Q2_OASDI_BASE_CENTS = 6_892_345;

function q2Paydays(): ScheduleBPayday[] {
  const dates = [
    "2026-04-03",
    "2026-04-17",
    "2026-05-01",
    "2026-05-15",
    "2026-05-29",
    "2026-06-12",
    "2026-06-26",
  ];
  // Split the quarter's base into seven whole-cent parts that sum exactly.
  const each = Math.floor(Q2_OASDI_BASE_CENTS / dates.length);
  const bases = dates.map((_, i) =>
    i === dates.length - 1 ? Q2_OASDI_BASE_CENTS - each * (dates.length - 1) : each,
  );
  /*
   * Employee FICA as it actually came off the cheques: OASDI and Medicare
   * rounded SEPARATELY on each payday, which is what payroll does and is the
   * origin of the fractions-of-cents drift.
   *
   * His filed line 7 is -7 cents, so the quarter's actual withholding is 7
   * cents under the by-rate figure. Per-payday rounding already accounts for
   * 2 of those cents (527,262 against 527,264), so the remaining 5 are taken
   * off the last cheque - the same shape as real drift, and it makes line 12
   * come out at exactly the 14,204.57 he filed.
   */
  const half = (b: number, milli: number) => Math.floor((b * milli + 50_000) / 100_000);
  const withheld = bases.map((b) => half(b, 6_200) + half(b, 1_450));
  withheld[withheld.length - 1] -= 5;
  const fitEach = Math.floor(365_935 / dates.length);
  const fits = bases.map((_, i) =>
    i === dates.length - 1 ? 365_935 - fitEach * (dates.length - 1) : fitEach,
  );
  return dates.map((payDate, i) => ({
    payDate,
    federalIncomeTaxCents: fits[i],
    employeeFicaWithheldCents: withheld[i],
    oasdiWagesCents: bases[i],
    medicareWagesCents: bases[i],
  }));
}

describe("Schedule B reconciles to line 12, or refuses", () => {
  /*
   * WITHOUT THIS: a Schedule B ships that is a few cents off line 12. It adds
   * up down every column, looks perfect, and produces an IRS notice months
   * later. This is D-05 and it is the only reason this file exists.
   */
  it("ties to line 12 exactly on his real filed quarter, and places each payday on the printed day", () => {
    const r = scheduleBLiability({
      quarter: Q2,
      paydays: q2Paydays(),
      line12Cents: Q2_LINE12_CENTS,
    });
    expect(r.ok, r.ok ? "" : r.explanation).toBe(true);
    if (!r.ok) return;

    expect(r.quarterTotalCents).toBe(Q2_LINE12_CENTS);
    expect(r.monthTotalsCents[0] + r.monthTotalsCents[1] + r.monthTotalsCents[2]).toBe(
      Q2_LINE12_CENTS,
    );
    expect(r.days).toHaveLength(7);

    // April 3 is month 1 day 3; June 26 is month 3 day 26. His filed schedule
    // has entries on exactly those spaces.
    expect(r.days[0]).toMatchObject({ month: 1, day: 3, payDate: "2026-04-03" });
    expect(r.days.at(-1)).toMatchObject({ month: 3, day: 26, payDate: "2026-06-26" });
    // Two paydays in month 1, three in month 2, two in month 3 - matching the
    // filed paper.
    expect(r.days.filter((d) => d.month === 1)).toHaveLength(2);
    expect(r.days.filter((d) => d.month === 2)).toHaveLength(3);
    expect(r.days.filter((d) => d.month === 3)).toHaveLength(2);
    // Every entry positive: the IRS forbids a negative daily figure.
    expect(r.days.every((d) => d.liabilityCents > 0)).toBe(true);
  });

  /*
   * WITHOUT THIS: the reconciliation guard is decoration. A wrong line 12 must
   * stop the schedule rather than be absorbed silently into a day.
   */
  it("refuses rather than forcing when the payroll records disagree with line 12", () => {
    const r = scheduleBLiability({
      quarter: Q2,
      paydays: q2Paydays(),
      line12Cents: Q2_LINE12_CENTS + 100,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("does_not_reconcile");
    expect(r.explanation).toContain("must equal line 12");
  });

  /*
   * WITHOUT THIS: a pay date one day outside the quarter vanishes from the grid
   * (there is no numbered space for it) and the schedule still adds up while
   * understating the quarter.
   */
  it("refuses a pay date outside the quarter instead of dropping it", () => {
    const r = scheduleBLiability({
      quarter: Q2,
      paydays: [{ ...q2Paydays()[0], payDate: "2026-07-01" }],
      line12Cents: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("pay_date_outside_quarter");
  });

  /*
   * WITHOUT THIS: an empty quarter renders a grid of zeros, which tells the IRS
   * this business paid nobody - a claim, not an absence of data.
   */
  it("refuses an empty quarter rather than filing a grid of zeros", () => {
    const r = scheduleBLiability({ quarter: Q2, paydays: [], line12Cents: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_paydays");
  });

  /*
   * WITHOUT THIS: two paydays on one calendar date silently overwrite each
   * other, halving that day's reported liability. The grid has one space per
   * day, so they must SUM.
   */
  it("sums two paydays that fall on the same calendar day", () => {
    const base = q2Paydays();
    const twice = [base[0], { ...base[1], payDate: base[0].payDate }, ...base.slice(2)];
    const r = scheduleBLiability({
      quarter: Q2,
      paydays: twice,
      line12Cents: Q2_LINE12_CENTS,
    });
    expect(r.ok, r.ok ? "" : r.explanation).toBe(true);
    if (!r.ok) return;
    expect(r.days).toHaveLength(6);
    expect(r.quarterTotalCents).toBe(Q2_LINE12_CENTS);
  });
});

describe("Schedule B geometry: every printed space accounted for", () => {
  /*
   * WITHOUT THIS: a liability lands on the wrong numbered space. The columns
   * run down-then-across (1-8, 9-16, 17-24, 25-31), which is not the order a
   * reader assumes, and a wrong day is a late-deposit penalty.
   */
  it("binds 31 days x 3 months plus four totals and a header, with every rect used or reasoned", () => {
    const sb = boxMap["941sb"];
    expect(sb).toBeDefined();

    const dayBoxes = Object.keys(sb.placed).filter((b) => /^m[123]d\d+$/.test(b));
    expect(dayBoxes).toHaveLength(93);
    for (const month of [1, 2, 3]) {
      for (let day = 1; day <= 31; day += 1) {
        expect(sb.placed[`m${month}d${day}`], `m${month}d${day} missing`).toHaveLength(2);
      }
    }
    for (const total of ["m1Total", "m2Total", "m3Total", "quarterTotal"]) {
      expect(sb.placed[total], total).toHaveLength(2);
    }
    // The EIN is nine one-character cells here, not the 941's two combs.
    expect(sb.placed["ein"]).toHaveLength(9);
    expect(sb.placed["calendarYear"]).toHaveLength(4);
    expect(sb.placed["name"]).toHaveLength(1);

    // Rule 123: every rectangle on the page is filled or recorded blank with a
    // reason worth reading.
    const art = pageArt("941sb");
    const claimed = new Set(Object.values(sb.placed).flat());
    for (const f of art.fields) {
      const isBlank = (sb.unclaimed ?? []).includes(f.name);
      expect(claimed.has(f.name) || isBlank, `${f.name} unaccounted for`).toBe(true);
      if (isBlank) {
        expect((sb.unclaimedReasons ?? {})[f.name]?.length ?? 0).toBeGreaterThan(30);
      }
    }
    expect(copiesOnSheet("941sb")).toBe(1);
  });

  /*
   * WITHOUT THIS: D-04. `CENTS_MAX_LEN` was a single global 3. Schedule B uses
   * 2, so all 97 of its cents boxes would have stayed empty while the dollars
   * box held the whole figure. Widening the constant globally is also wrong -
   * W-2 box 12 uses /MaxLen 2 for its CODE boxes.
   */
  it("reads the cents /MaxLen per form: Schedule B is 2, the 941 pages are 3, the W-2 does not split", () => {
    expect(boxMap["941sb"].centsMaxLen).toBe(2);
    const art = pageArt("941sb");
    const byName = new Map(art.fields.map((f) => [f.name, f]));
    // Every money box is a (dollars, cents) pair and the cents half says 2.
    for (const box of ["m1d3", "m2d15", "m3d31", "quarterTotal"]) {
      const [dollars, cents] = boxMap["941sb"].placed[box];
      expect(byName.get(dollars)?.maxLen).toBeNull();
      expect(byName.get(cents)?.maxLen).toBe(2);
    }
  });
});

/* ══ THE ADAPTER AND THE PAGE IT FILLS ═══════════════════════════════════ */

describe("Schedule B's boxes and lessons agree with the measured grid", () => {
  const SB = boxMap["941sb"].placed;

  /*
   * WITHOUT THIS: a day cell renders with no lesson behind it, so Michael
   * clicks a space on the calendar and an empty overlay opens - the exact
   * failure his "click to see and click to un see" requirement is about. Or a
   * lesson exists for a box the grid does not render, and is unreachable.
   */
  it("covers every box the grid renders with exactly one lesson, and no others", () => {
    const rendered = scheduleBTeachingBoxes(Q2).map((b) => b.box);
    const taught = SCHEDULE_B_LESSONS.map((l) => l.box);
    expect(new Set(rendered).size).toBe(rendered.length);
    expect(new Set(taught).size).toBe(taught.length);
    expect([...taught].sort()).toEqual([...rendered].sort());
    // And the population is the measured one, not an accident of both sides
    // being empty: 93 day cells + 3 month totals + quarter total + 3 header.
    expect(rendered.length).toBe(Object.keys(SB).length);
    expect(rendered.length).toBe(100);
    for (const l of SCHEDULE_B_LESSONS) expect(l.formId).toBe(FORM_ID_941_SB);
  });

  /*
   * WITHOUT THIS: the EIN prints as nine digits crammed into the first of the
   * nine one-character squares, or the year into the first of four. Both are
   * comb-style fields, and a schedule the IRS cannot match to its return
   * counts as not filed. See D-01 for the class.
   */
  it("splits the EIN and the year one character per rectangle", () => {
    const identity = scheduleBIdentityText(
      { ein: "46-4217016", legalName: "LYMAN'S MARIJUANA", street: null, city: null, state: null, zip: null },
      Q2,
    );
    expect(SB["ein"].length).toBe(9);
    expect(identity["ein"]).toEqual(["4", "6", "4", "2", "1", "7", "0", "1", "6"]);
    expect(SB["calendarYear"].length).toBe(4);
    expect(identity["calendarYear"]).toEqual(["2", "0", "2", "6"]);
    // One string per rectangle, or the renderer silently drops the remainder.
    expect(identity["ein"].length).toBe(SB["ein"].length);
    expect(identity["calendarYear"].length).toBe(SB["calendarYear"].length);
    // A malformed EIN must not be padded into the squares as a partial number.
    const bad = scheduleBIdentityText(
      { ein: "46-421", legalName: "X", street: null, city: null, state: null, zip: null },
      Q2,
    );
    expect(bad["ein"]).toBeUndefined();
  });

  /*
   * WITHOUT THIS: D-06. Only the first of line 16's three ticks was bound, so
   * the semiweekly tick - the one that declares this schedule is attached, and
   * the one Michael's return actually uses - could not be clicked. Bound by
   * CAPTION because c2_1[1] and c2_1[2] are indistinguishable by name and
   * transposing them tells the IRS a semiweekly depositor is a monthly one.
   */
  it("places all three of line 16's ticks, in the order the form prints them", () => {
    const line16 = boxMap["941-p2"].placed["16"];
    const P2 = "topmostSubform[0].Page2[0].";
    expect(line16).toEqual([`${P2}c2_1[0]`, `${P2}c2_1[1]`, `${P2}c2_1[2]`]);
    // And none of them is left in the unclaimed list, which is where the two
    // missing ticks were hiding, described as "not ticked".
    for (const name of line16) {
      expect((boxMap["941-p2"].unclaimed ?? []).includes(name), `${name} still unclaimed`).toBe(
        false,
      );
    }
    // The monthly liability grid STAYS blank and reasoned: Michael is a
    // semiweekly filer, so filling it would misreport his deposit schedule.
    for (const f of [`${P2}f2_1[0]`, `${P2}f2_7[0]`]) {
      expect((boxMap["941-p2"].unclaimed ?? []).includes(f), `${f} should stay blank`).toBe(true);
    }
  });

  /*
   * WITHOUT THIS: the blank specimen shows a zero quarter total under 93 empty
   * spaces, which reads as a filed schedule declaring this business paid
   * nobody - a statement to the IRS rather than an absence of data.
   */
  it("states no figure at all on the blank specimen, including the totals", () => {
    const boxes = scheduleBTeachingBoxes(Q2);
    const money = boxes.filter((b) => b.measure === "money");
    expect(money.length).toBeGreaterThan(90);
    for (const b of money) {
      expect(b.notComputedYet, `${b.box} claims a figure`).not.toBeNull();
      expect(b.amountCents).toBe(0);
    }
  });
});

/* ══ D-07: A BLANK DAY PRINTS NOTHING, NOT ZERO ══════════════════════════ */

describe("Schedule B prints a figure only on days wages were paid", () => {
  /*
   * WITHOUT THIS: D-07. 86 of the 93 day cells printed "0 00", which on a
   * DAILY liability form is a positive statement that wages were paid on 86
   * days and the tax due was nil. Every arithmetic test stayed green because
   * the quarter total was always right; the defect is in the rendering.
   */
  it("emits no text at all in either rectangle of a day with no payday", () => {
    const r = scheduleBLiability({
      quarter: Q2,
      paydays: q2Paydays(),
      line12Cents: Q2_LINE12_CENTS,
    });
    expect(r.ok, r.ok ? "" : r.explanation).toBe(true);
    if (!r.ok) return;

    const employer = {
      ein: "46-4217016",
      legalName: "LYMAN'S MARIJUANA",
      street: "4851 GEIGER RD SE",
      city: "PORT ORCHARD",
      state: "WA",
      zip: "98366",
    };
    const placed = facsimileBoxes(
      "941sb",
      scheduleBBoxes(r, employer),
      SCHEDULE_B_LESSONS,
      {},
      0,
      scheduleBIdentityText(employer, Q2),
    );

    // `days` carries only the days that HAVE liability - one per payday.
    const paydayBoxes = new Set(r.days.map((d) => `m${d.month}d${d.day}`));
    // Rule 66d: the fixture must actually contain paydays and blank days, or
    // this proves nothing about either.
    expect(paydayBoxes.size).toBe(7);

    let blankDays = 0;
    for (const b of placed) {
      if (!/^m[123]d\d+$/.test(b.box.box)) continue;
      const text = b.slots.map((s) => s.text).join("");
      if (paydayBoxes.has(b.box.box)) {
        expect(text.length, `${b.box.box} is a payday and printed nothing`).toBeGreaterThan(0);
      } else {
        expect(text, `${b.box.box} printed a figure on a day with no payday`).toBe("");
        blankDays += 1;
      }
    }
    expect(blankDays).toBe(93 - 7);

    // And the whole sheet prints only what it should: 7 paydays + 4 totals,
    // each a (dollars, cents) pair, plus 9 EIN digits + 4 year digits + name.
    const filled = placed.flatMap((b) => b.slots).filter((s) => s.text !== "").length;
    expect(filled).toBe((7 + 4) * 2 + 9 + 4 + 1);
  });
});
