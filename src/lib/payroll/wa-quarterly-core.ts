/**
 * src/lib/payroll/wa-quarterly-core.ts   (books-41)
 *
 * WASHINGTON'S QUARTERLY RETURNS: THE ARITHMETIC, AND NOTHING ELSE.
 *
 * WHAT THIS SLICE IS, VERBATIM (standing rule 1)
 *
 *   "Then - books-40: quarterly filings. 941 first, since it is due first and
 *    is mostly summation; then the ESD and L&I quarterly reports."
 *
 *   "The forms are an important step and I really want to make sure I
 *    understand everything that is happening on the forms in plain english."
 *
 * FOUR RETURNS, THREE WAYS OF COUNTING, ONE PAYROLL
 *
 * The 941 in books-40 was, as Michael put it, mostly summation. Washington is
 * not. The same quarter of payroll is measured three different ways here, and
 * the differences are the whole difficulty:
 *
 *   ESD unemployment  - a rate on WAGES, capped per person per year, paid
 *                       entirely by the employer, split across two funds that
 *                       round separately.
 *   PFML / WA Cares   - rates on WAGES, one capped and one not, paid almost
 *                       entirely by the employees, remitted by the employer as
 *                       their agent.
 *   L&I               - a rate on HOURS. Wages are irrelevant. Split between
 *                       employer and employee at figures the State computes and
 *                       prints, which this engine reads and never re-derives.
 *
 * A single number - Greenway's 68,923.45 of Q2 2026 wages - drives the first
 * two and is entirely absent from the third, where 3,558 hours takes over.
 *
 * WHY THE ROUNDING IS TREATED AS LOAD-BEARING
 *
 * It decides a cent on a return that was actually filed. RCW 50.24.010 and RCW
 * 50.24.014(2)(b) each command half-cent rounding on contributions under that
 * section, and the unemployment tax and the EAF are different sections. Round
 * each and add: 255.02 + 20.68 = 275.70, which is what ESD assessed. Add the
 * rates and round once: 275.69. The engine therefore rounds per fund, and a
 * test asserts the wrong method produces the wrong answer, so nobody can
 * "simplify" it back later without the suite objecting.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * No I/O, no Supabase, no React, no dates from the system clock. Everything
 * comes in through the request. Rates are NOT looked up here either - they are
 * passed in - because the registry already owns dated rate lookup and refuses
 * loudly when a rate is missing, and a second lookup path would be a second
 * place for a stale rate to hide.
 */

import type { QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";

/* ══════════════════════════════════════════════════════════════════════════
 * §1  MONEY, AND THE TWO WAYS WASHINGTON ROUNDS IT
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Half-cent rounding, in the words of RCW 50.24.010 and RCW 50.24.014(2)(b).
 *
 * "a fractional part of a cent shall be disregarded unless it amounts to
 *  one-half cent or more, in which case it shall be increased to one cent."
 *
 * Note what the statute does NOT say. It does not mention negative amounts,
 * because a contribution is never negative. Rather than invent a rule the
 * legislature did not write (standing rule 62d), this refuses: a negative
 * contribution is a bug upstream, and rounding it silently would hide the bug.
 */
export function statutoryRoundCents(exactCents: number): number {
  if (!Number.isFinite(exactCents)) {
    throw new Error(`wa-quarterly: cannot round a non-finite amount (${exactCents}).`);
  }
  if (exactCents < 0) {
    throw new Error(
      `wa-quarterly: asked to round a negative contribution (${exactCents}). RCW 50.24.010 ` +
        `describes rounding a fractional part of a cent upward at one-half; it says nothing ` +
        `about negative amounts because a contribution cannot be negative. This is an upstream ` +
        `defect, not a rounding question.`,
    );
  }
  const whole = Math.floor(exactCents);
  return exactCents - whole >= 0.5 ? whole + 1 : whole;
}

/**
 * A rate on wages, in milli-percent (1.13% = 1_130), applied WITHOUT rounding.
 *
 * Kept separate from the rounding so that a two-step calculation - PFML is a
 * percentage OF a percentage - can round once at the end rather than twice in
 * the middle. Rounding an intermediate is how 556.32 becomes 556.33.
 */
export function exactMilliPct(cents: number, milliPct: number): number {
  if (!Number.isInteger(cents)) {
    throw new Error(`wa-quarterly: expected integer cents, got ${cents}.`);
  }
  return (cents * milliPct) / 100_000;
}

/**
 * L&I money: hours times a rate quoted in MILLI-CENTS per hour.
 *
 * $0.5593/hr is stored as 55_930 milli-cents because integer cents physically
 * cannot hold five decimal places of a dollar, and the State quotes five. This
 * was the books-14 defect and it is not repeated here.
 *
 * L&I rounds to the nearest cent in the ordinary way. It is NOT under RCW
 * 50.24.010, which is an unemployment statute, so the half-cent language does
 * not reach it - a distinction worth stating out loud, because the two rules
 * agree on every figure Greenway has ever filed and would diverge only on an
 * exact half.
 */
export function hourlyPremiumCents(hours: number, milliCentsPerHour: number): number {
  if (!Number.isInteger(hours)) {
    throw new Error(
      `wa-quarterly: expected whole hours, got ${hours}. Both ESD and L&I collect whole hours ` +
        `for this employer; a fraction here means hours were averaged somewhere upstream.`,
    );
  }
  if (hours < 0) {
    throw new Error(`wa-quarterly: hours cannot be negative (${hours}).`);
  }
  return Math.round((hours * milliCentsPerHour) / 1_000);
}

/* ══════════════════════════════════════════════════════════════════════════
 * §2  WHAT THE ENGINE MUST BE TOLD
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * One person's quarter, as Washington wants to see it.
 *
 * `wagesCents` and `hours` are BOTH required and neither is derived from the
 * other, because they land on different returns and are charged at different
 * things. `esdTaxableWagesCents` is carried separately from `wagesCents`
 * because the unemployment wage base caps per person per year, and that cap is
 * a year-to-date fact this quarter-shaped engine cannot see. Whoever calls it
 * has the YTD figures; making them state the taxable amount is honest, whereas
 * assuming taxable equals total would silently overcharge every high earner in
 * Q4 (standing rule 62d).
 */
export type WaQuarterSubject = {
  readonly subjectId: string;
  readonly displayName: string;
  readonly wagesCents: number;
  /** Wages still under the annual ESD wage base. Equal to `wagesCents` until someone crosses it. */
  readonly esdTaxableWagesCents: number;
  /** Wages still under the PFML cap, which is the Social Security base by RCW 50A.10.030(4). */
  readonly pfmlTaxableWagesCents: number;
  readonly hours: number;
};

/**
 * The rates, all read from the dated registry by the caller.
 *
 * Passed in rather than looked up so this file stays pure and so there is
 * exactly one rate-lookup path in the system.
 */
export type WaQuarterRates = {
  /** Unemployment insurance, milli-percent. Greenway 2026: 370 (0.37%). */
  readonly sutaUiMilliPct: number;
  /** Employment Administration Fund, milli-percent. Greenway 2026: 30 (0.03%). */
  readonly sutaEafMilliPct: number;
  /** Total PFML premium, milli-percent of wages. 2026: 1_130 (1.13%). */
  readonly pfmlTotalMilliPct: number;
  /** Employee's share OF THE PREMIUM, milli-percent. 2026: 71_430 (71.43%). */
  readonly pfmlEmployeeShareMilliPct: number;
  /** WA Cares, milli-percent of uncapped wages. 2026: 580 (0.58%). */
  readonly waCaresMilliPct: number;
  /** L&I employee share, milli-cents per hour. Greenway 2026: 16_445 ($0.16445). */
  readonly lniEmployeeMilliCentsPerHour: number;
  /** L&I employer share, milli-cents per hour. Greenway 2026: 39_485 ($0.39485). */
  readonly lniEmployerMilliCentsPerHour: number;
};

/**
 * Whether Greenway owes the employer half of Paid Leave this quarter.
 *
 * An explicit input rather than a headcount comparison done here, because RCW
 * 50A.10.030(7)(c) does not measure size on the day you file. It measures it on
 * 30 September, from an average of four quarter-end counts, and fixes the
 * answer for the whole of the FOLLOWING calendar year. An engine that counted
 * `subjects.length` would get the right answer at Greenway today and the wrong
 * answer for any employer who crossed fifty, at exactly the moment it mattered.
 */
export type PfmlEmployerLiability = {
  /** True only if the 30 September determination said fifty or more. */
  readonly employerOwesEmployerShare: boolean;
  /** The averaged headcount ESD determined, for display. Null if never determined. */
  readonly determinedAverageHeadcount: number | null;
};

export type WaQuarterRequest = {
  readonly quarter: QuarterRef;
  readonly subjects: readonly WaQuarterSubject[];
  readonly rates: WaQuarterRates;
  readonly pfml: PfmlEmployerLiability;
};

/* ══════════════════════════════════════════════════════════════════════════
 * §3  REFUSING, RATHER THAN GUESSING
 * ══════════════════════════════════════════════════════════════════════════ */

export type WaQuarterRefusalCode =
  | "NO_SUBJECTS"
  | "NEGATIVE_WAGES"
  | "NEGATIVE_HOURS"
  | "TAXABLE_EXCEEDS_TOTAL"
  | "FRACTIONAL_HOURS"
  | "MISSING_RATE"
  | "PFML_SHARE_NOT_A_SHARE"
  | "WAGES_WITHOUT_HOURS"
  | "HOURS_WITHOUT_WAGES"
  | "PFML_SIZE_UNDETERMINED";

export const ALL_WA_QUARTER_REFUSAL_CODES: readonly WaQuarterRefusalCode[] = [
  "NO_SUBJECTS",
  "NEGATIVE_WAGES",
  "NEGATIVE_HOURS",
  "TAXABLE_EXCEEDS_TOTAL",
  "FRACTIONAL_HOURS",
  "MISSING_RATE",
  "PFML_SHARE_NOT_A_SHARE",
  "WAGES_WITHOUT_HOURS",
  "HOURS_WITHOUT_WAGES",
  "PFML_SIZE_UNDETERMINED",
];

export type WaQuarterRefusal = {
  readonly code: WaQuarterRefusalCode;
  /** Plain English, naming the person or field at fault. */
  readonly because: string;
  /** The one thing to do about it. */
  readonly fix: string;
  readonly subjectId?: string;
};

/* ══════════════════════════════════════════════════════════════════════════
 * §4  WHAT COMES OUT - A LINE THAT KNOWS WHOSE MONEY IT IS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Who actually bears a line.
 *
 * This is not decoration. RCW 50.24.010 and RCW 50.24.014(2)(a) make deducting
 * the unemployment levies from a worker UNLAWFUL, while RCW 50A.10.030(7)(b)
 * makes the employer the AGENT of employees for Paid Leave money. Those are
 * opposite legal relationships and the screen must never blur them, so the
 * distinction is carried in the data rather than left to a caption someone
 * might reword.
 */
export type WhoseMoney =
  /** Employer's own cost. Deducting it from staff is unlawful. */
  | "employer_cost"
  /** Already withheld from staff. Held as their agent, in trust. */
  | "employee_money"
  /** Both sides contribute; the split is set by the State. */
  | "shared";

/**
 * What a box is actually MEASURED in.
 *
 * Not every box on these returns is money. The L&I return's first box is a
 * count of hours, and the whole point of workers' compensation is that hours,
 * not wages, are what you are charged on. A box measured in hours still has to
 * live in the same list as the money boxes so the form can be printed in order.
 *
 * This field exists because the alternative was worse. The hours line carried
 * `amountCents: 0` as a quiet stand-in for "not money", which is a sentinel, and
 * a sentinel is a bug waiting for a caller who does not know the convention: any
 * screen that formats `amountCents` would print "$0.00" next to a box that
 * really says 3,558 hours. Making the unit explicit means a caller cannot format
 * the line wrongly without ignoring a field that is right there.
 */
export type WaBoxMeasure = "money" | "hours";

export type WaQuarterLine = {
  /** Stable id, used to tie a line to its teaching and to the filed figure. */
  readonly id: string;
  /** Which return this line appears on. */
  readonly form: WaQuarterFormId;
  /** The label as the form itself prints it. */
  readonly boxLabel: string;
  /** Whether this box is denominated in money or in hours. */
  readonly measure: WaBoxMeasure;
  /**
   * The amount in integer cents. Always 0 when `measure` is "hours" - read
   * `quantity` instead, and see `WaBoxMeasure` for why this is not a sentinel.
   */
  readonly amountCents: number;
  /** The count when `measure` is "hours". Null for money boxes. */
  readonly quantity: number | null;
  readonly whoseMoney: WhoseMoney;
  /** The arithmetic, in English, with the actual numbers substituted. */
  readonly shownAs: string;
};

/**
 * The one correct way to render a line, whatever it is measured in.
 *
 * Provided so that no caller has to remember the rule. A screen that calls this
 * cannot print "$0.00" for an hours box.
 */
export function formatWaLineValue(line: WaQuarterLine): string {
  if (line.measure === "hours") {
    const n = line.quantity ?? 0;
    return `${n.toLocaleString("en-US")} ${n === 1 ? "hour" : "hours"}`;
  }
  const sign = line.amountCents < 0 ? "-" : "";
  const abs = Math.abs(line.amountCents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export type WaQuarterFormId = "esd_5208a" | "esd_5208b" | "pfml_wa_cares" | "lni_quarterly";

/** One person's row on the 5208B wage detail. */
export type WageDetailRow = {
  readonly subjectId: string;
  readonly displayName: string;
  readonly wagesCents: number;
  readonly hours: number;
};

export type WaQuarterReturn = {
  readonly quarter: QuarterRef;
  /** The single wage figure every ESD line is a percentage of. */
  readonly grossWagesCents: number;
  /** The hour count the L&I premium is charged on, and which the 5208B must also show. */
  readonly totalHours: number;
  readonly headcount: number;
  readonly lines: readonly WaQuarterLine[];
  readonly wageDetail: readonly WageDetailRow[];
  /** Money leaving the business, by agency. */
  readonly esdTotalCents: number;
  readonly pfmlWaCaresTotalCents: number;
  readonly lniTotalCents: number;
  /** How much of the whole quarter's bill was withheld from staff rather than borne by Greenway. */
  readonly employeeFundedCents: number;
  readonly employerFundedCents: number;
};

export type WaQuarterResult =
  | { readonly ok: true; readonly value: WaQuarterReturn }
  | { readonly ok: false; readonly refusals: readonly WaQuarterRefusal[] };

export function waLineOf(ret: WaQuarterReturn, id: string): WaQuarterLine | undefined {
  return ret.lines.find((l) => l.id === id);
}

/** Every line on one form, in the order the form prints them. */
export function waLinesForForm(
  ret: WaQuarterReturn,
  form: WaQuarterFormId,
): readonly WaQuarterLine[] {
  return ret.lines.filter((l) => l.form === form);
}

/* ══════════════════════════════════════════════════════════════════════════
 * §5  THE VALIDATION PASS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything wrong with the request, all at once.
 *
 * Deliberately collects rather than throwing on the first problem. Michael
 * fixes a quarter once; being told about one bad row, fixing it, and being told
 * about the next is six trips through the same screen.
 */
export function validateWaQuarterRequest(req: WaQuarterRequest): readonly WaQuarterRefusal[] {
  const refusals: WaQuarterRefusal[] = [];

  if (req.subjects.length === 0) {
    refusals.push({
      code: "NO_SUBJECTS",
      because: "This quarter has nobody on it at all.",
      fix:
        "If nobody was paid, that is still a return: file it marked 'no payroll'. WAC " +
        "296-17-31023 says L&I will otherwise estimate the premium and pursue the estimate. If " +
        "somebody WAS paid, the pay runs for this quarter have not reached this screen yet.",
    });
  }

  for (const s of req.subjects) {
    if (s.wagesCents < 0) {
      refusals.push({
        code: "NEGATIVE_WAGES",
        subjectId: s.subjectId,
        because: `${s.displayName} has negative wages of ${s.wagesCents} cents this quarter.`,
        fix:
          "A quarter cannot pay somebody a negative amount. This is usually a reversal that was " +
          "entered as a fresh pay run instead of being voided. Fix the pay run, not this screen.",
      });
    }
    if (s.hours < 0) {
      refusals.push({
        code: "NEGATIVE_HOURS",
        subjectId: s.subjectId,
        because: `${s.displayName} has negative hours (${s.hours}).`,
        fix: "Correct the timesheet for the quarter. Hours drive the L&I premium directly.",
      });
    }
    if (!Number.isInteger(s.hours)) {
      refusals.push({
        code: "FRACTIONAL_HOURS",
        subjectId: s.subjectId,
        because: `${s.displayName} has ${s.hours} hours, which is not a whole number.`,
        fix:
          "Both ESD and L&I collect whole hours for this employer. A fraction means hours were " +
          "averaged or split somewhere upstream; round at the timesheet, where the decision is " +
          "visible, rather than here.",
      });
    }
    if (s.esdTaxableWagesCents > s.wagesCents) {
      refusals.push({
        code: "TAXABLE_EXCEEDS_TOTAL",
        subjectId: s.subjectId,
        because:
          `${s.displayName} has ESD taxable wages of ${s.esdTaxableWagesCents} cents but total ` +
          `wages of only ${s.wagesCents}.`,
        fix:
          "Taxable wages are a subset of total wages - the part still under the annual wage base " +
          "- so they can never exceed them. Check the year-to-date figures feeding this quarter.",
      });
    }
    if (s.pfmlTaxableWagesCents > s.wagesCents) {
      refusals.push({
        code: "TAXABLE_EXCEEDS_TOTAL",
        subjectId: s.subjectId,
        because:
          `${s.displayName} has PFML taxable wages of ${s.pfmlTaxableWagesCents} cents but ` +
          `total wages of only ${s.wagesCents}.`,
        fix:
          "Paid Leave stops at the Social Security wage base (RCW 50A.10.030(4)), so its taxable " +
          "figure is at most the total. Check the year-to-date figures feeding this quarter.",
      });
    }
    if (s.wagesCents > 0 && s.hours === 0) {
      refusals.push({
        code: "WAGES_WITHOUT_HOURS",
        subjectId: s.subjectId,
        because: `${s.displayName} was paid ${s.wagesCents} cents but reported zero hours.`,
        fix:
          "Washington wants hours per person (WAC 192-310-010(3)(b)) and L&I charges premium on " +
          "them, so zero hours against real pay understates the premium. If this person is " +
          "salaried, WAC 296-17-31021(2) requires choosing actual hours or a flat 160 per month " +
          "for EVERY salaried person - record the choice rather than reporting nothing.",
      });
    }
    if (s.hours > 0 && s.wagesCents === 0) {
      refusals.push({
        code: "HOURS_WITHOUT_WAGES",
        subjectId: s.subjectId,
        because: `${s.displayName} reported ${s.hours} hours but no pay at all.`,
        fix:
          "Hours worked without wages is either unpaid work, which is a much larger problem than " +
          "a tax return, or a pay run that has not posted. Resolve it before filing.",
      });
    }
  }

  const r = req.rates;
  const missing: string[] = [];
  if (!Number.isFinite(r.sutaUiMilliPct)) missing.push("unemployment insurance rate");
  if (!Number.isFinite(r.sutaEafMilliPct)) missing.push("Employment Administration Fund rate");
  if (!Number.isFinite(r.pfmlTotalMilliPct)) missing.push("Paid Leave premium rate");
  if (!Number.isFinite(r.pfmlEmployeeShareMilliPct)) missing.push("Paid Leave employee share");
  if (!Number.isFinite(r.waCaresMilliPct)) missing.push("WA Cares rate");
  if (!Number.isFinite(r.lniEmployeeMilliCentsPerHour)) missing.push("L&I employee hourly rate");
  if (!Number.isFinite(r.lniEmployerMilliCentsPerHour)) missing.push("L&I employer hourly rate");
  if (missing.length > 0) {
    refusals.push({
      code: "MISSING_RATE",
      because: `The engine was not given: ${missing.join(", ")}.`,
      fix:
        "These come from the dated rate registry, which refuses rather than guessing when a year " +
        "has no rate on file. Enter the figures from the ESD tax rate notice and the L&I rate " +
        "notice for this year.",
    });
  }

  // A share of a premium must be a share. 71.43% is 71_430; a rate on WAGES of
  // 0.8% would be 800, which is a perfectly plausible-looking number and would
  // silently under-withhold by a factor of ninety.
  if (
    Number.isFinite(r.pfmlEmployeeShareMilliPct) &&
    (r.pfmlEmployeeShareMilliPct < 0 || r.pfmlEmployeeShareMilliPct > 100_000)
  ) {
    refusals.push({
      code: "PFML_SHARE_NOT_A_SHARE",
      because:
        `The Paid Leave employee share is ${r.pfmlEmployeeShareMilliPct} milli-percent, which ` +
        `is outside 0% to 100%.`,
      fix:
        "This field is a share OF THE PREMIUM, not a rate on wages. 71.43% is entered as 71_430. " +
        "A number like 800 would be 0.8% of the premium and would collect almost nothing.",
    });
  }

  if (req.pfml.employerOwesEmployerShare && req.pfml.determinedAverageHeadcount === null) {
    refusals.push({
      code: "PFML_SIZE_UNDETERMINED",
      because:
        "The return says Greenway owes the employer share of Paid Leave, but no averaged " +
        "headcount from ESD's 30 September determination has been recorded.",
      fix:
        "RCW 50A.10.030(7)(c) fixes employer size once a year from the average of four " +
        "quarter-end counts. Record the determined figure, so the reason for paying the employer " +
        "share is on the file rather than in somebody's memory.",
    });
  }

  return refusals;
}

/* ══════════════════════════════════════════════════════════════════════════
 * §6  BUILDING THE RETURNS
 * ══════════════════════════════════════════════════════════════════════════ */

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

function pct(milliPct: number): string {
  return `${(milliPct / 1_000).toFixed(2)}%`;
}

/**
 * Build all four Washington returns for one quarter.
 *
 * THE ORDER OF OPERATIONS IS THE POINT. Three places in here, doing the
 * arithmetic in the obvious order gives the wrong answer:
 *
 *   1. UI and EAF round SEPARATELY, then add. Adding the rates and rounding
 *      once loses a cent against the filed return.
 *   2. PFML is a percentage OF a percentage. The premium is computed on wages
 *      and only then split, with a single rounding at the end. Collapsing
 *      1.13% x 71.43% into one rate does not reproduce 556.32.
 *   3. L&I is charged on HOURS. Wages never enter it.
 */
export function buildWaQuarter(req: WaQuarterRequest): WaQuarterResult {
  const refusals = validateWaQuarterRequest(req);
  if (refusals.length > 0) return { ok: false, refusals };

  const { rates: r, subjects } = req;

  const grossWagesCents = subjects.reduce((a, s) => a + s.wagesCents, 0);
  const esdTaxableCents = subjects.reduce((a, s) => a + s.esdTaxableWagesCents, 0);
  const pfmlTaxableCents = subjects.reduce((a, s) => a + s.pfmlTaxableWagesCents, 0);
  const totalHours = subjects.reduce((a, s) => a + s.hours, 0);

  const lines: WaQuarterLine[] = [];

  /* ---- ESD 5208A: two funds, two roundings ------------------------------ */

  const uiCents = statutoryRoundCents(exactMilliPct(esdTaxableCents, r.sutaUiMilliPct));
  lines.push({
    id: "esd-ui",
    form: "esd_5208a",
    boxLabel: "UI tax due",
    amountCents: uiCents,
    measure: "money",
    quantity: null,
    whoseMoney: "employer_cost",
    shownAs:
      `${money(esdTaxableCents)} of taxable wages x ${pct(r.sutaUiMilliPct)} = ` +
      `${money(uiCents)}. Employer's own money: RCW 50.24.010 makes deducting any part of it ` +
      `from a worker unlawful.`,
  });

  const eafCents = statutoryRoundCents(exactMilliPct(esdTaxableCents, r.sutaEafMilliPct));
  lines.push({
    id: "esd-eaf",
    form: "esd_5208a",
    boxLabel: "EAF tax due",
    amountCents: eafCents,
    measure: "money",
    quantity: null,
    whoseMoney: "employer_cost",
    shownAs:
      `${money(esdTaxableCents)} x ${pct(r.sutaEafMilliPct)} = ${money(eafCents)}. The 0.03% is ` +
      `itself two statutory accounts - 0.02% under RCW 50.24.014(1)(a) and 0.01% under (1)(b).`,
  });

  const esdTotalCents = uiCents + eafCents;
  lines.push({
    id: "esd-total",
    form: "esd_5208a",
    boxLabel: "Total due",
    amountCents: esdTotalCents,
    measure: "money",
    quantity: null,
    whoseMoney: "employer_cost",
    shownAs:
      `${money(uiCents)} + ${money(eafCents)} = ${money(esdTotalCents)}. Each fund is rounded ` +
      `to the cent on its own figure before they are added, because RCW 50.24.010 and RCW ` +
      `50.24.014(2)(b) each command that rounding for their own section.`,
  });

  /* ---- PFML: a percentage of a percentage ------------------------------- */

  const pfmlPremiumExact = exactMilliPct(pfmlTaxableCents, r.pfmlTotalMilliPct);
  const pfmlEmployeeCents = Math.round(
    (pfmlPremiumExact * r.pfmlEmployeeShareMilliPct) / 100_000,
  );
  lines.push({
    id: "pfml-employee",
    form: "pfml_wa_cares",
    boxLabel: "Paid Leave premiums withheld from employees",
    amountCents: pfmlEmployeeCents,
    measure: "money",
    quantity: null,
    whoseMoney: "employee_money",
    shownAs:
      `Two steps, and the order matters. The whole premium is ${money(pfmlTaxableCents)} x ` +
      `${pct(r.pfmlTotalMilliPct)} = ${money(Math.round(pfmlPremiumExact))}; the employees pay ` +
      `${(r.pfmlEmployeeShareMilliPct / 1_000).toFixed(2)}% OF THAT PREMIUM = ` +
      `${money(pfmlEmployeeCents)}. Already withheld from paycheques and held as their agent ` +
      `under RCW 50A.10.030(7)(b).`,
  });

  const pfmlEmployerShareMilliPct = 100_000 - r.pfmlEmployeeShareMilliPct;
  const pfmlEmployerIfOwedCents = Math.round(
    (pfmlPremiumExact * pfmlEmployerShareMilliPct) / 100_000,
  );
  const pfmlEmployerCents = req.pfml.employerOwesEmployerShare ? pfmlEmployerIfOwedCents : 0;
  lines.push({
    id: "pfml-employer",
    form: "pfml_wa_cares",
    boxLabel: "Employer Medical + Employer Family",
    amountCents: pfmlEmployerCents,
    measure: "money",
    quantity: null,
    whoseMoney: "employer_cost",
    shownAs: req.pfml.employerOwesEmployerShare
      ? `${(pfmlEmployerShareMilliPct / 1_000).toFixed(2)}% of the ` +
        `${money(Math.round(pfmlPremiumExact))} premium = ${money(pfmlEmployerCents)}.`
      : `0.00, and that zero is a legal position rather than an omission. RCW ` +
        `50A.10.030(5)(a) relieves employers with fewer than fifty Washington employees of the ` +
        `employer portion. Had it been owed it would have been ` +
        `${money(pfmlEmployerIfOwedCents)}.`,
  });

  /* ---- WA Cares: no cap, all employee money ----------------------------- */

  const waCaresCents = Math.round(exactMilliPct(grossWagesCents, r.waCaresMilliPct));
  lines.push({
    id: "wa-cares",
    form: "pfml_wa_cares",
    boxLabel: "Total WA Cares premiums",
    amountCents: waCaresCents,
    measure: "money",
    quantity: null,
    whoseMoney: "employee_money",
    shownAs:
      `${money(grossWagesCents)} x ${pct(r.waCaresMilliPct)} = ${money(waCaresCents)}. Charged ` +
      `on GROSS wages with no ceiling at all - unlike Paid Leave, which stops at the Social ` +
      `Security wage base. All of it employee money.`,
  });

  const pfmlWaCaresTotalCents = pfmlEmployeeCents + pfmlEmployerCents + waCaresCents;

  /* ---- L&I: hours, not wages -------------------------------------------- */

  const lniEmployeeCents = hourlyPremiumCents(totalHours, r.lniEmployeeMilliCentsPerHour);
  const lniEmployerCents = hourlyPremiumCents(totalHours, r.lniEmployerMilliCentsPerHour);
  const lniTotalCents = hourlyPremiumCents(
    totalHours,
    r.lniEmployeeMilliCentsPerHour + r.lniEmployerMilliCentsPerHour,
  );

  lines.push({
    id: "lni-hours",
    form: "lni_quarterly",
    boxLabel: "Hours reported, risk class",
    measure: "hours",
    amountCents: 0,
    quantity: totalHours,
    whoseMoney: "shared",
    shownAs:
      `${totalHours.toLocaleString("en-US")} hours. This is the 'unit of exposure' of WAC ` +
      `296-17-31021(1): workers' compensation is charged on time at work, not on pay, so wages ` +
      `play no part in this return. The same hour count appears on the 5208B wage detail.`,
  });
  lines.push({
    id: "lni-employee",
    form: "lni_quarterly",
    boxLabel: "Employee share withheld",
    amountCents: lniEmployeeCents,
    measure: "money",
    quantity: null,
    whoseMoney: "employee_money",
    shownAs:
      `${totalHours.toLocaleString("en-US")} hours x ` +
      `$${(r.lniEmployeeMilliCentsPerHour / 100_000).toFixed(5)} per hour = ` +
      `${money(lniEmployeeCents)}. RCW 51.16.140 permits withholding this half; the rate is read ` +
      `off the L&I notice and never derived.`,
  });
  lines.push({
    id: "lni-employer",
    form: "lni_quarterly",
    boxLabel: "Employer share",
    amountCents: lniEmployerCents,
    measure: "money",
    quantity: null,
    whoseMoney: "employer_cost",
    shownAs:
      `${totalHours.toLocaleString("en-US")} hours x ` +
      `$${(r.lniEmployerMilliCentsPerHour / 100_000).toFixed(5)} per hour = ` +
      `${money(lniEmployerCents)}.`,
  });
  lines.push({
    id: "lni-premium",
    form: "lni_quarterly",
    boxLabel: "Amount owed",
    amountCents: lniTotalCents,
    measure: "money",
    quantity: null,
    whoseMoney: "shared",
    shownAs:
      `${totalHours.toLocaleString("en-US")} hours x ` +
      `$${((r.lniEmployeeMilliCentsPerHour + r.lniEmployerMilliCentsPerHour) / 100_000).toFixed(5)} ` +
      `per hour = ${money(lniTotalCents)}. Computed on the combined rate, which is how the ` +
      `notice quotes it and how L&I bills it.`,
  });

  /* ---- The 5208B detail -------------------------------------------------- */

  const wageDetail: WageDetailRow[] = subjects.map((s) => ({
    subjectId: s.subjectId,
    displayName: s.displayName,
    wagesCents: s.wagesCents,
    hours: s.hours,
  }));

  /* ---- Whose money, in total -------------------------------------------- */

  const employeeFundedCents = pfmlEmployeeCents + waCaresCents + lniEmployeeCents;
  const employerFundedCents = esdTotalCents + pfmlEmployerCents + lniEmployerCents;

  return {
    ok: true,
    value: {
      quarter: req.quarter,
      grossWagesCents,
      totalHours,
      headcount: subjects.length,
      lines,
      wageDetail,
      esdTotalCents,
      pfmlWaCaresTotalCents,
      lniTotalCents,
      employeeFundedCents,
      employerFundedCents,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §7  DUE DATES
 * ══════════════════════════════════════════════════════════════════════════ */

/** Last calendar day of the month after the quarter ends. */
function quarterEndPlusOneMonthLastDay(q: QuarterRef): string {
  const endMonth = q.quarter * 3; // 3, 6, 9, 12
  const dueMonth = endMonth + 1; // 4, 7, 10, 13
  const year = dueMonth > 12 ? q.year + 1 : q.year;
  const month = dueMonth > 12 ? 1 : dueMonth;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * ═══ WASHINGTON LEGAL HOLIDAYS - AND WHY THE FEDERAL TABLE CANNOT BE REUSED ═══
 *
 * There is already a holiday table in this codebase:
 * `payroll-deposit-schedule-core.ts::federalHolidays`. It is deliberately NOT
 * used here, and the reason is written down so nobody "consolidates" the two.
 *
 * That table's own docblock says the federal deposit rule means "a legal holiday
 * in the DISTRICT OF COLUMBIA". Washington's list, RCW 1.16.050(1), is a
 * different list:
 *
 *   - Washington has NO Columbus / Indigenous Peoples' Day. RCW 1.16.050(7)(r)
 *     recognizes 12 October as Columbus day and then says in the same breath
 *     that the days in subsection (7) "may not be considered legal holidays for
 *     any purpose."
 *   - Washington has NO District of Columbia Emancipation Day, which the federal
 *     table carries because a DC holiday moves an IRS deposit.
 *   - Washington ADDS Native American Heritage Day, RCW 1.16.050(1)(k), "[t]he
 *     Friday immediately following the fourth Thursday in November." There is no
 *     federal equivalent.
 *
 * Two tables that differ in three places are two tables, not one.
 *
 * WHY THIS FUNCTION EXISTS AT ALL. As it happens, no Washington holiday can ever
 * land on 30 April, 31 July, 31 October or 31 January, so in practice only a
 * weekend moves a quarterly return. It would therefore be "simpler" to write
 * `return false`. That is exactly what this function used to do, and it was
 * wrong twice over: it was a claim taken on trust (standing rule 1), and it was
 * a branch that could never fire (standing rule 50 - dead code wearing a green
 * check). The check now genuinely runs against a real table, and a test walks a
 * wide span of years to PROVE the holiday branch never fires. If Washington ever
 * adds a holiday on one of those dates, the engine already handles it and the
 * test tells us the world changed.
 */

/** The n-th given weekday of a month (weekday: 0=Sun..6=Sat), as UTC ms. */
function nthWeekdayUtc(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + shift + 7 * (n - 1)));
}

/** The last given weekday of a month. */
function lastWeekdayUtc(year: number, month: number, weekday: number): Date {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month - 1, lastDay - back));
}

/**
 * RCW 1.16.050(5), applied: "Whenever any state legal holiday: (a) Other than
 * Sunday, falls upon a Sunday, the following Monday is the legal holiday; or
 * (b) Falls upon a Saturday, the preceding Friday is the legal holiday."
 */
function waObserved(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - 86_400_000);
  if (dow === 0) return new Date(d.getTime() + 86_400_000);
  return d;
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type WaLegalHoliday = { readonly date: string; readonly name: string };

/**
 * Every Washington state legal holiday in a calendar year, per RCW 1.16.050(1),
 * with the subsection (5) observed-day shift already applied.
 *
 * Subsection (1)(a) makes "Sunday" itself a legal holiday. It is not listed as a
 * dated entry because every Sunday is already not a business day; folding it in
 * would add 52 rows that change no outcome.
 */
export function waLegalHolidays(year: number): readonly WaLegalHoliday[] {
  const list: WaLegalHoliday[] = [
    { date: isoOf(waObserved(new Date(Date.UTC(year, 0, 1)))), name: "New Year's Day" },
    {
      date: isoOf(nthWeekdayUtc(year, 1, 1, 3)),
      name: "Martin Luther King, Jr. Day",
    },
    { date: isoOf(nthWeekdayUtc(year, 2, 1, 3)), name: "Presidents' Day" },
    { date: isoOf(lastWeekdayUtc(year, 5, 1)), name: "Memorial Day" },
    { date: isoOf(waObserved(new Date(Date.UTC(year, 5, 19)))), name: "Juneteenth" },
    { date: isoOf(waObserved(new Date(Date.UTC(year, 6, 4)))), name: "Independence Day" },
    { date: isoOf(nthWeekdayUtc(year, 9, 1, 1)), name: "Labor Day" },
    { date: isoOf(waObserved(new Date(Date.UTC(year, 10, 11)))), name: "Veterans Day" },
    { date: isoOf(nthWeekdayUtc(year, 11, 4, 4)), name: "Thanksgiving Day" },
    {
      // RCW 1.16.050(1)(k): the Friday immediately following the fourth Thursday
      // in November. No federal equivalent.
      date: isoOf(new Date(nthWeekdayUtc(year, 11, 4, 4).getTime() + 86_400_000)),
      name: "Native American Heritage Day",
    },
    { date: isoOf(waObserved(new Date(Date.UTC(year, 11, 25)))), name: "Christmas Day" },
  ];
  return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Is this ISO date a Washington state legal holiday? */
export function isWaLegalHoliday(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  // Neighbouring years are consulted because an observed shift can carry a
  // holiday across a year boundary (1 January on a Saturday becomes 31 December).
  for (const y of [year - 1, year, year + 1]) {
    for (const h of waLegalHolidays(y)) {
      if (h.date === isoDate) return true;
    }
  }
  return false;
}

export type WaQuarterDueDate = {
  /** The date the rule names, before any shift. */
  readonly calendarDate: string;
  /** The date it is actually due, after the weekend and holiday shift. */
  readonly dueDate: string;
  readonly shifted: boolean;
  /**
   * WHAT moved the date. Recorded rather than inferred, because "shifted: true"
   * alone cannot tell you whether a weekend or a holiday did it, and those have
   * different consequences if the rule ever changes.
   */
  readonly shiftedBy: "none" | "weekend" | "holiday";
  readonly why: string;
};

/**
 * The ESD and L&I due date for a quarter, including the weekend shift.
 *
 * WAC 192-310-010(3)(d) states the four dates and then says: "If these dates
 * fall on a Saturday, Sunday, or a legal holiday, the reports will be due on
 * the next business day." Computed rather than assumed, because 31 October 2027
 * is a Sunday and Greenway will meet that one in its first year.
 */
export function waQuarterDueDate(q: QuarterRef): WaQuarterDueDate {
  const calendarDate = quarterEndPlusOneMonthLastDay(q);
  const d = new Date(`${calendarDate}T00:00:00Z`);

  // What, if anything, disqualifies the named date. Both tests genuinely run:
  // the holiday table is real, not a stub that always says no.
  const namedDow = d.getUTCDay();
  const namedIsWeekend = namedDow === 0 || namedDow === 6;
  const namedIsHoliday = isWaLegalHoliday(calendarDate);

  let shiftDays = 0;
  for (;;) {
    const probe = new Date(d.getTime() + shiftDays * 86_400_000);
    const probeIso = probe.toISOString().slice(0, 10);
    const dow = probe.getUTCDay();
    if (dow !== 0 && dow !== 6 && !isWaLegalHoliday(probeIso)) break;
    shiftDays += 1;
  }
  const due = new Date(d.getTime() + shiftDays * 86_400_000);
  const dueDate = due.toISOString().slice(0, 10);
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    namedDow
  ];

  // Weekend is reported first when both apply, because a weekend is the reason a
  // reader will recognise and the holiday would be redundant information.
  const shiftedBy: "none" | "weekend" | "holiday" =
    shiftDays === 0 ? "none" : namedIsWeekend ? "weekend" : namedIsHoliday ? "holiday" : "weekend";

  let why: string;
  if (shiftDays === 0) {
    why =
      `${calendarDate} is a ${dayName}, a business day and not a Washington legal holiday, so ` +
      `the return is due on the date the rule names.`;
  } else if (shiftedBy === "holiday") {
    why =
      `${calendarDate} is a Washington legal holiday under RCW 1.16.050, so ` +
      `WAC 192-310-010(3)(d) moves the deadline to the next business day, ${dueDate}.`;
  } else {
    why =
      `${calendarDate} is a ${dayName}, so WAC 192-310-010(3)(d) moves the deadline to the ` +
      `next business day, ${dueDate}.`;
  }

  return { calendarDate, dueDate, shifted: shiftDays > 0, shiftedBy, why };
}

/**
 * How the Washington deadline differs from the federal one for the same quarter.
 *
 * Exists because the two are the SAME calendar date and a reader will
 * reasonably assume they behave the same way. They do not: the 941 has a second
 * date you can earn by depositing on time, and Washington has no such thing.
 */
export function waVersusFederalDeadlineNote(): string {
  return (
    "Washington's quarterly returns share the federal 941's four dates - 30 April, 31 July, 31 " +
    "October, 31 January - but not its escape hatch. The 941 can be filed ten days later if " +
    "every deposit for the quarter was made in full and on time; WAC 192-310-010(3)(d) offers " +
    "nothing equivalent. There is one Washington date, and only a weekend or a legal holiday " +
    "moves it."
  );
}
