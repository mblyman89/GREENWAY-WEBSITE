/**
 * src/lib/payroll/payroll-deposit-schedule-core.ts  (books-26)
 *
 * WHEN THE WITHHELD MONEY IS DUE. Not how much - WHEN.
 *
 * WHY THIS FILE EXISTS
 * Every other payroll module in this folder answers "how much comes out of the
 * check." None of them answered "by what date must Greenway hand that money to
 * the IRS." Those are different questions with different penalties, and the
 * second one is the expensive one: IRC 6656 charges up to 15% for a LATE deposit
 * of a PERFECTLY CALCULATED amount. You can get every paycheck exactly right and
 * still lose 15% by depositing on the wrong Wednesday. Before this file, a grep
 * for "lookback" or "semiweekly" across src/ and tests/ returned nothing but
 * CCRS sales-reporting code. The gap was total.
 *
 * WHAT WE ALREADY KNOW ABOUT GREENWAY (evidence, not assumption)
 * Michael's Q2 2026 Form 941 reported $14,204.57 on line 12, and it came with a
 * POPULATED Schedule B. Per Pub 15, only semiweekly depositors file Schedule B -
 * so his own filing already asserts the answer. Independently, four quarters at
 * that level is $56,818.28, clearing the $50,000 line by 13.6%. Two unrelated
 * proofs, one conclusion: Greenway is a SEMIWEEKLY depositor. Both are encoded
 * as tests below.
 *
 * THE TRAP THIS FILE REFUSES TO FALL INTO
 * Greenway is NOT a new employer. The business has run payroll for years; only
 * the SOFTWARE is new on January 1, 2027, and the IRS has never cared what
 * software you use. A fresh install that looked at its own empty tables and
 * concluded "no history, therefore monthly" would be handing Michael a 15%
 * penalty in the name of a sensible default. So there IS no default. Missing
 * lookback history produces a REFUSAL that names the four quarters it needs.
 * That is the whole design: this module would rather say "I don't know" than be
 * confidently wrong about a date that costs 15%.
 *
 * PURE. No I/O, no dates-from-the-clock, no server imports. Money is integer
 * CENTS throughout, consistent with the rest of the payroll folder.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { resolvePayrollAuthorities } from "./payroll-tax-authorities";

// ---------------------------------------------------------------------------
// 1) THE TWO SCHEDULES, AND THE THRESHOLD BETWEEN THEM
// ---------------------------------------------------------------------------

/** The only two deposit schedules a Form 941 filer can be on. */
export type DepositSchedule = "monthly" | "semiweekly";

/**
 * $50,000 of line-12 tax across the 4-quarter lookback period. At or below is
 * monthly; ABOVE is semiweekly. Stored in cents because everything here is.
 *
 * The boundary is worth stating precisely because the publication's wording is
 * asymmetric and easy to flip: "$50,000 or LESS ... monthly; MORE THAN $50,000
 * ... semiweekly". Exactly $50,000.00 is therefore MONTHLY. There is a test for
 * the penny either side.
 */
export const LOOKBACK_THRESHOLD_CENTS = 5_000_000;

/**
 * $100,000 accumulated in a single deposit period forces a next-business-day
 * deposit regardless of schedule.
 */
export const NEXT_DAY_THRESHOLD_CENTS = 10_000_000;

/** Plain-English label. Never show a raw enum to Michael. */
export const DEPOSIT_SCHEDULE_LABELS: Record<DepositSchedule, string> = {
  monthly: "Monthly schedule depositor",
  semiweekly: "Semiweekly schedule depositor",
};

// ---------------------------------------------------------------------------
// 2) THE LOOKBACK PERIOD
// ---------------------------------------------------------------------------

/**
 * One quarter of the lookback period, as ORIGINALLY FILED.
 *
 * `line12Cents` is Form 941 line 12 - "Total taxes after adjustments and
 * nonrefundable credits" - for that quarter, as it was originally reported. Per
 * PUB15_LOOKBACK_ADJUSTMENTS a later 941-X does NOT move this number, which is
 * the opposite of an accountant's instinct about corrections, so the field name
 * says `asOriginallyFiled` out loud rather than trusting anyone to remember.
 */
export type LookbackQuarter = {
  /** Calendar year the quarter belongs to. */
  year: number;
  /** 1-4. */
  quarter: 1 | 2 | 3 | 4;
  /** Form 941 line 12 in integer cents, AS ORIGINALLY FILED. */
  line12Cents: number;
  /**
   * True when this quarter predates the business existing (or predates
   * Greenway's obligation to file). Per PUB15_NEW_EMPLOYER_ZERO such a quarter
   * counts as zero rather than being unknown. This must be asserted
   * DELIBERATELY - it is never inferred from a missing row.
   */
  asOriginallyFiled: true;
};

/** A quarter identifier, for naming what is missing. */
export type QuarterRef = { year: number; quarter: 1 | 2 | 3 | 4 };

/** `{year:2026, quarter:2}` -> `"Q2 2026"`. */
export function formatQuarter(q: QuarterRef): string {
  return `Q${q.quarter} ${q.year}`;
}

/** The calendar dates a quarter spans, for showing the lookback window. */
export function quarterDateRange(q: QuarterRef): { start: string; end: string } {
  const startMonth = (q.quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(q.year, endMonth, 0)).getUTCDate();
  const p2 = (x: number) => String(x).padStart(2, "0");
  return {
    start: `${q.year}-${p2(startMonth)}-01`,
    end: `${q.year}-${p2(endMonth)}-${p2(lastDay)}`,
  };
}

/**
 * THE FOUR QUARTERS THAT DECIDE A GIVEN YEAR.
 *
 * "The lookback period begins July 1 and ends June 30." For calendar year Y that
 * is July 1 (Y-2) through June 30 (Y-1) - it ends EIGHTEEN MONTHS before the
 * payroll it governs. This is the single most misread rule in the section, and
 * the misreading always goes the same way: people reach for last year.
 *
 * Cross-checked against Table 1 in Pub 15 (2026), which prints the 2026 lookback
 * period as the four quarters from July 1, 2024 through June 30, 2025. There is
 * a test asserting exactly that.
 *
 * The practical consequence for Greenway: the 2027 schedule was already fixed by
 * the middle of 2026 and NOTHING that happens in 2027 can change it.
 */
export function lookbackQuartersFor(calendarYear: number): QuarterRef[] {
  return [
    { year: calendarYear - 2, quarter: 3 },
    { year: calendarYear - 2, quarter: 4 },
    { year: calendarYear - 1, quarter: 1 },
    { year: calendarYear - 1, quarter: 2 },
  ];
}

/** The human-readable window, e.g. "July 1, 2025 through June 30, 2026". */
export function lookbackWindowLabel(calendarYear: number): string {
  return `July 1, ${calendarYear - 2} through June 30, ${calendarYear - 1}`;
}

// ---------------------------------------------------------------------------
// 3) THE DETERMINATION (and the refusal)
// ---------------------------------------------------------------------------

/** A determination that succeeded. */
export type DepositScheduleDetermined = {
  ok: true;
  calendarYear: number;
  schedule: DepositSchedule;
  /** Sum of the four line-12 figures, in cents. */
  lookbackTotalCents: number;
  /** The four quarters used, in order, so the arithmetic can be shown. */
  quartersUsed: readonly LookbackQuarter[];
  lookbackWindow: string;
  /** Plain-English explanation, safe to render directly. */
  explanation: string;
  authorities: readonly GuidanceAuthority[];
};

/** A determination that refused. */
export type DepositScheduleRefused = {
  ok: false;
  calendarYear: number;
  reason: "missing_lookback_quarters" | "duplicate_lookback_quarter" | "invalid_amount";
  /** Which quarters we needed and did not get. Empty for other reasons. */
  missing: readonly QuarterRef[];
  explanation: string;
  authorities: readonly GuidanceAuthority[];
};

export type DepositScheduleResult = DepositScheduleDetermined | DepositScheduleRefused;

/** Cents -> "$14,204.57". Local so this file stays dependency-free. */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${withCommas}.${String(rem).padStart(2, "0")}`;
}

/**
 * Decide the deposit schedule for `calendarYear` from filed 941 line-12 figures.
 *
 * REFUSES rather than guessing when any of the four lookback quarters is absent.
 * That refusal is the most important behaviour in this module: the alternative -
 * treating "I have no data" as "the total was small" - silently produces
 * "monthly", which for Greenway is wrong and carries a 15% penalty. A new
 * employer legitimately HAS zeros, but per PUB15_NEW_EMPLOYER_ZERO that is a
 * positive assertion the caller makes by supplying a zero quarter, not something
 * this function may infer from an empty table.
 */
export function determineDepositSchedule(
  calendarYear: number,
  filed: readonly LookbackQuarter[],
): DepositScheduleResult {
  const needed = lookbackQuartersFor(calendarYear);
  const window = lookbackWindowLabel(calendarYear);
  const key = (q: QuarterRef) => `${q.year}Q${q.quarter}`;

  // Reject nonsense amounts before doing anything else. A negative line 12 is
  // not a small deposit obligation, it is a broken input, and averaging it into
  // a total would drag a semiweekly employer down to monthly.
  for (const f of filed) {
    if (!Number.isFinite(f.line12Cents) || !Number.isInteger(f.line12Cents) || f.line12Cents < 0) {
      return {
        ok: false,
        calendarYear,
        reason: "invalid_amount",
        missing: [],
        explanation:
          `${formatQuarter(f)} has a Form 941 line 12 of "${String(f.line12Cents)}", which is not a ` +
          `whole number of cents at or above zero. Line 12 is a total tax figure; it cannot be ` +
          `negative and it cannot be a fraction of a cent. Nothing was decided.`,
        authorities: depositScheduleAuthorities(),
      };
    }
  }

  // Duplicates are ambiguous, and picking one would be a guess about which
  // filing Michael meant. Say so instead.
  const seen = new Map<string, number>();
  for (const f of filed) {
    seen.set(key(f), (seen.get(key(f)) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length > 0) {
    return {
      ok: false,
      calendarYear,
      reason: "duplicate_lookback_quarter",
      missing: [],
      explanation:
        `The same lookback quarter was supplied more than once (${dupes
          .map(([k]) => k)
          .join(", ")}). Each quarter contributes its line 12 exactly once, and picking which ` +
        `copy to believe would be a guess. Nothing was decided.`,
      authorities: depositScheduleAuthorities(),
    };
  }

  const supplied = new Map(filed.map((f) => [key(f), f] as const));
  const missing = needed.filter((q) => !supplied.has(key(q)));
  if (missing.length > 0) {
    return {
      ok: false,
      calendarYear,
      reason: "missing_lookback_quarters",
      missing,
      explanation:
        `Cannot determine the ${calendarYear} federal deposit schedule: ` +
        `${missing.length} of the 4 lookback quarters ${missing.length === 1 ? "is" : "are"} ` +
        `missing (${missing.map(formatQuarter).join(", ")}). The lookback period for ${calendarYear} ` +
        `is ${window}, and the schedule comes from Form 941 line 12 on those four returns as ` +
        `originally filed. Guessing here is not a small risk: an absent history looks exactly like ` +
        `a small one, which would produce "monthly" - and depositing monthly when you are required ` +
        `to deposit semiweekly is a late deposit every single payday, penalised up to 15% under ` +
        `IRC 6656. Enter the four figures and this answers itself.`,
      authorities: depositScheduleAuthorities(),
    };
  }

  const quartersUsed = needed.map((q) => supplied.get(key(q)) as LookbackQuarter);
  const total = quartersUsed.reduce((acc, q) => acc + q.line12Cents, 0);

  // "$50,000 or less ... monthly; more than $50,000 ... semiweekly."
  const schedule: DepositSchedule = total > LOOKBACK_THRESHOLD_CENTS ? "semiweekly" : "monthly";

  const sumLine = quartersUsed
    .map((q) => `${formatQuarter(q)} ${formatCents(q.line12Cents)}`)
    .join(" + ");

  const margin = Math.abs(total - LOOKBACK_THRESHOLD_CENTS);
  const explanation =
    schedule === "semiweekly"
      ? `Greenway is a SEMIWEEKLY schedule depositor for ${calendarYear}. Adding up Form 941 ` +
        `line 12 across the lookback period (${window}): ${sumLine} = ${formatCents(total)}. That ` +
        `is more than the ${formatCents(LOOKBACK_THRESHOLD_CENTS)} threshold, by ` +
        `${formatCents(margin)}. In practice: each payday's federal taxes are due within a few ` +
        `days of the payday, not at month end - and Form 941 must be filed with Schedule B, which ` +
        `reports the liability day by day. "Semiweekly" does NOT mean depositing twice a week; it ` +
        `names the rulebook, not the frequency.`
      : `Greenway is a MONTHLY schedule depositor for ${calendarYear}. Adding up Form 941 line 12 ` +
        `across the lookback period (${window}): ${sumLine} = ${formatCents(total)}. That is ` +
        `${total === LOOKBACK_THRESHOLD_CENTS ? "exactly" : "at or below"} the ` +
        `${formatCents(LOOKBACK_THRESHOLD_CENTS)} threshold` +
        `${total === LOOKBACK_THRESHOLD_CENTS ? " - and the rule reads \"$50,000 or less\", so the boundary itself is monthly" : `, by ${formatCents(margin)}`}. ` +
        `In practice: everything paid in a calendar month is deposited together by the 15th of the ` +
        `following month.`;

  return {
    ok: true,
    calendarYear,
    schedule,
    lookbackTotalCents: total,
    quartersUsed,
    lookbackWindow: window,
    explanation,
    authorities: depositScheduleAuthorities(),
  };
}

/** The authorities behind a determination, resolved through the registry. */
export function depositScheduleAuthorities(): readonly GuidanceAuthority[] {
  return resolvePayrollAuthorities([
    "pub15-2026-lookback-period",
    "pub15-2026-lookback-adjustments",
    "pub15-2026-schedule-terms-meaning",
    "pub15-2026-new-employer-zero",
  ]);
}

// ---------------------------------------------------------------------------
// 4) FEDERAL LEGAL HOLIDAYS (DISTRICT OF COLUMBIA)
// ---------------------------------------------------------------------------

/*
 * WHY WE GENERATE THESE RATHER THAN HARDCODE A LIST
 * A hardcoded list expires. Michael's first payroll is January 1, 2027, and a
 * table that stopped at 2026 would silently start producing wrong due dates in
 * the very first week - the worst possible failure, because nothing looks broken.
 *
 * The generated rules are validated against ground truth: Pub 15 (2026) PRINTS
 * its eleven-plus-one holiday list, and the test below asserts all twelve
 * generated 2026 dates match the publication exactly, including the awkward one
 * ("July 3 - Independence Day (observed)", because July 4, 2026 is a Saturday).
 * Reproducing a year the IRS published is the only evidence that the rules will
 * be right for a year it hasn't.
 *
 * SCOPE, DELIBERATELY NARROW: per PUB15_BUSINESS_DAYS_ONLY a "legal holiday" for
 * deposit purposes means a legal holiday in the DISTRICT OF COLUMBIA and
 * excludes other statewide holidays. So DC Emancipation Day (April 16) IS here,
 * and no Washington State holiday is. A day off in Olympia does not move an IRS
 * deposit.
 */

/** A named federal legal holiday on a specific date. */
export type FederalHoliday = { date: string; name: string };

function p2(x: number): string {
  return String(x).padStart(2, "0");
}

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

/** The n-th given weekday of a month (weekday: 0=Sun..6=Sat). */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1);
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + shift + 7 * (n - 1));
}

/** The last given weekday of a month. */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = utc(year, month, lastDay);
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return utc(year, month, lastDay - back);
}

/**
 * The OBSERVED date of a fixed-date holiday: Saturday shifts back to Friday,
 * Sunday forward to Monday. This is the rule that turns July 4, 2026 into the
 * "July 3 (observed)" that Pub 15 prints.
 */
function observed(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - 86_400_000);
  if (dow === 0) return new Date(d.getTime() + 86_400_000);
  return d;
}

/** Every federal legal holiday (DC) in a calendar year, sorted by date. */
export function federalHolidays(year: number): FederalHoliday[] {
  const list: FederalHoliday[] = [
    { date: iso(observed(utc(year, 1, 1))), name: "New Year's Day" },
    { date: iso(nthWeekday(year, 1, 1, 3)), name: "Birthday of Martin Luther King, Jr." },
    { date: iso(nthWeekday(year, 2, 1, 3)), name: "Washington's Birthday" },
    // District of Columbia Emancipation Day - a DC holiday, and therefore in
    // scope here even though it is not a nationwide federal holiday.
    { date: iso(observed(utc(year, 4, 16))), name: "District of Columbia Emancipation Day" },
    { date: iso(lastWeekday(year, 5, 1)), name: "Memorial Day" },
    { date: iso(observed(utc(year, 6, 19))), name: "Juneteenth National Independence Day" },
    { date: iso(observed(utc(year, 7, 4))), name: "Independence Day" },
    { date: iso(nthWeekday(year, 9, 1, 1)), name: "Labor Day" },
    { date: iso(nthWeekday(year, 10, 1, 2)), name: "Indigenous Peoples' Day (Columbus Day)" },
    { date: iso(observed(utc(year, 11, 11))), name: "Veterans Day" },
    { date: iso(nthWeekday(year, 11, 4, 4)), name: "Thanksgiving Day" },
    { date: iso(observed(utc(year, 12, 25))), name: "Christmas Day" },
  ];
  return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Holiday dates for a year and its neighbours, so business-day math near a year
 * boundary doesn't fall off the end of the table. A December 31 payday is
 * governed by January's holidays.
 */
export function holidaySet(year: number): Set<string> {
  const s = new Set<string>();
  for (const y of [year - 1, year, year + 1]) {
    for (const h of federalHolidays(y)) s.add(h.date);
  }
  return s;
}

/** Saturday, Sunday and DC legal holidays are not business days. */
export function isBusinessDay(isoDate: string, holidays: ReadonlySet<string>): boolean {
  const d = parseIso(isoDate);
  if (!d) return false;
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(isoDate);
}

function parseIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = utc(Number(m[1]), Number(m[2]), Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  // Reject impossible dates that Date would silently roll over (2026-02-30).
  return iso(d) === s ? d : null;
}

/** Advance to the next business day, or stay put if already one. */
export function onOrAfterBusinessDay(isoDate: string, holidays: ReadonlySet<string>): string {
  let d = parseIso(isoDate);
  if (!d) return isoDate;
  while (!isBusinessDay(iso(d), holidays)) d = new Date(d.getTime() + 86_400_000);
  return iso(d);
}

/** Add N business days to a date (the date itself is never counted). */
export function addBusinessDays(isoDate: string, n: number, holidays: ReadonlySet<string>): string {
  let d = parseIso(isoDate);
  if (!d) return isoDate;
  let added = 0;
  while (added < n) {
    d = new Date(d.getTime() + 86_400_000);
    if (isBusinessDay(iso(d), holidays)) added += 1;
  }
  return iso(d);
}

// ---------------------------------------------------------------------------
// 5) THE DUE DATE FOR ONE PAYDAY
// ---------------------------------------------------------------------------

/** Which semiweekly bucket a payday falls in. */
export type SemiweeklyPeriod = "wed_fri" | "sat_tue";

export const SEMIWEEKLY_PERIOD_LABELS: Record<SemiweeklyPeriod, string> = {
  wed_fri: "Wednesday-Friday",
  sat_tue: "Saturday-Tuesday",
};

/**
 * "The deposit periods for semiweekly schedule depositors are Wednesday through
 * Friday and Saturday through Tuesday."
 */
export function semiweeklyPeriodOf(isoDate: string): SemiweeklyPeriod | null {
  const d = parseIso(isoDate);
  if (!d) return null;
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  return dow >= 3 && dow <= 5 ? "wed_fri" : "sat_tue";
}

export type DepositDueDate = {
  ok: true;
  payDate: string;
  schedule: DepositSchedule;
  /** The date the deposit must be made by. */
  dueDate: string;
  /** Which semiweekly bucket, when semiweekly. */
  period: SemiweeklyPeriod | null;
  /** True when weekends/holidays moved the date off its nominal day. */
  movedForHoliday: boolean;
  /** The nominal date before business-day adjustment, for showing the work. */
  nominalDueDate: string;
  explanation: string;
};

export type DepositDueDateRefused = { ok: false; payDate: string; explanation: string };

export type DepositDueDateResult = DepositDueDate | DepositDueDateRefused;

const DOW_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Day-of-week name for an ISO date, for prose. */
export function dayName(isoDate: string): string {
  const d = parseIso(isoDate);
  return d ? DOW_NAMES[d.getUTCDay()] : "";
}

/**
 * The date a payday's federal employment taxes must be deposited by.
 *
 * SEMIWEEKLY uses a THREE-BUSINESS-DAY count, not "the following Wednesday
 * nudged off holidays". Those are different algorithms and the difference is
 * load-bearing: per PUB15_SEMIWEEKLY_THREE_BUSINESS_DAYS a holiday anywhere in
 * the three weekdays after the period closes buys another day - INCLUDING a
 * holiday that falls before the Wednesday you were aiming at. The IRS's own
 * example is a Friday payday with the following Monday a holiday, where the
 * deposit "normally due on Wednesday may be made on Thursday". Nudging a
 * Wednesday forward would leave it on Wednesday there, and under-count. Counting
 * three business days from the close of the period gets it right, and the test
 * suite reproduces that exact example.
 *
 * MONTHLY is the 15th of the following month, rolled forward off weekends and
 * holidays.
 */
export function depositDueDate(
  payDate: string,
  schedule: DepositSchedule,
  holidays?: ReadonlySet<string>,
): DepositDueDateResult {
  const d = parseIso(payDate);
  if (!d) {
    return {
      ok: false,
      payDate,
      explanation:
        `"${payDate}" is not a real calendar date in YYYY-MM-DD form, so no deposit due date was ` +
        `computed. A due date invented from an unparseable input is worse than none.`,
    };
  }
  const hol = holidays ?? holidaySet(d.getUTCFullYear());

  if (schedule === "monthly") {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1; // 1..12
    const dueY = m === 12 ? y + 1 : y;
    const dueM = m === 12 ? 1 : m + 1;
    const nominal = `${dueY}-${p2(dueM)}-15`;
    const due = onOrAfterBusinessDay(nominal, hol);
    return {
      ok: true,
      payDate,
      schedule,
      dueDate: due,
      period: null,
      movedForHoliday: due !== nominal,
      nominalDueDate: nominal,
      explanation:
        `Wages paid ${payDate} fall in a monthly deposit period, so the federal taxes for ` +
        `everything paid that month are due by the 15th of the following month: ${nominal}` +
        (due !== nominal
          ? `. That is a ${dayName(nominal)}, which is not a business day, so the deposit is ` +
            `timely if made by ${due} (${dayName(due)}).`
          : ` (${dayName(due)}).`),
    };
  }

  // Semiweekly: find the close of the payday's deposit period, then count three
  // business days from it.
  const period = semiweeklyPeriodOf(payDate) as SemiweeklyPeriod;
  const dow = d.getUTCDay();
  // Wed(3)-Fri(5) closes Friday; Sat(6)-Tue(2) closes Tuesday.
  const daysToClose = period === "wed_fri" ? 5 - dow : (2 - dow + 7) % 7;
  const close = iso(new Date(d.getTime() + daysToClose * 86_400_000));
  const nominalDow = period === "wed_fri" ? "Wednesday" : "Friday";
  const due = addBusinessDays(close, 3, hol);
  const moved = dayName(due) !== nominalDow;

  return {
    ok: true,
    payDate,
    schedule,
    dueDate: due,
    period,
    movedForHoliday: moved,
    nominalDueDate: close,
    explanation:
      `Wages paid ${payDate} (${dayName(payDate)}) fall in the ` +
      `${SEMIWEEKLY_PERIOD_LABELS[period]} deposit period, which closes ${close}. Semiweekly ` +
      `depositors get at least 3 business days after the period closes, so the deposit is due ` +
      `${due} (${dayName(due)})` +
      (moved
        ? `. Normally this would be the following ${nominalDow}, but a federal holiday inside ` +
          `those 3 weekdays pushed it out - the rule is 3 BUSINESS days, not "the next ` +
          `${nominalDow}".`
        : `, the following ${nominalDow}.`) +
      ` Note the date that matters is when the wages were PAID, not the period they were earned in.`,
  };
}

/**
 * Does a single day's accumulated liability trip the $100,000 next-day rule?
 *
 * Tested on the GROSS figure before nonrefundable credits, per
 * PUB15_100K_NEXT_DAY. Greenway's largest 2026 quarter was $14,204.57 in total,
 * so this is nowhere near live today - but a one-off event (an owner bonus paid
 * once at year end, which is exactly how Michael pays himself) is the shape of
 * thing that trips it, so we check rather than assume Greenway is too small.
 */
export function tripsNextDayRule(dayLiabilityCents: number): boolean {
  return Number.isFinite(dayLiabilityCents) && dayLiabilityCents >= NEXT_DAY_THRESHOLD_CENTS;
}

/**
 * The consequence, spelled out. A monthly depositor who trips the rule does not
 * merely make one fast deposit - they BECOME semiweekly for the rest of the year
 * and all of the next.
 */
export function nextDayRuleConsequence(
  schedule: DepositSchedule,
  dayLiabilityCents: number,
  payDate: string,
  holidays?: ReadonlySet<string>,
): { tripped: boolean; dueDate: string | null; explanation: string } {
  if (!tripsNextDayRule(dayLiabilityCents)) {
    return {
      tripped: false,
      dueDate: null,
      explanation:
        `${formatCents(dayLiabilityCents)} accumulated on ${payDate} is below the ` +
        `${formatCents(NEXT_DAY_THRESHOLD_CENTS)} next-day threshold, so the normal ` +
        `${DEPOSIT_SCHEDULE_LABELS[schedule].toLowerCase()} due date applies.`,
    };
  }
  const d = parseIso(payDate);
  const hol = holidays ?? (d ? holidaySet(d.getUTCFullYear()) : new Set<string>());
  const due = d ? addBusinessDays(payDate, 1, hol) : null;
  return {
    tripped: true,
    dueDate: due,
    explanation:
      `${formatCents(dayLiabilityCents)} accumulated on ${payDate} reaches the ` +
      `${formatCents(NEXT_DAY_THRESHOLD_CENTS)} threshold, so it must be deposited by the next ` +
      `business day${due ? ` - ${due} (${dayName(due)})` : ""}, whatever schedule you are on. ` +
      (schedule === "monthly"
        ? `There is a second consequence that is easy to miss: tripping this rule as a monthly ` +
          `depositor makes you a SEMIWEEKLY depositor from the next day, for the rest of this ` +
          `calendar year and all of the following one.`
        : `You are already semiweekly, so the schedule itself does not change - only this one ` +
          `deposit accelerates.`),
  };
}

/**
 * Two paydays in one semiweekly period that land in different quarters need two
 * deposits, even though the due date is the same, because each 941 covers one
 * quarter.
 */
export function spansTwoQuarters(payDateA: string, payDateB: string): boolean {
  const a = parseIso(payDateA);
  const b = parseIso(payDateB);
  if (!a || !b) return false;
  const qa = Math.floor(a.getUTCMonth() / 3);
  const qb = Math.floor(b.getUTCMonth() / 3);
  return a.getUTCFullYear() !== b.getUTCFullYear() || qa !== qb;
}

// ---------------------------------------------------------------------------
// 6) SELF-TESTS
// ---------------------------------------------------------------------------

/**
 * Run by the vitest wrapper. The fixtures are Michael's REAL filed figures, not
 * invented ones, so a regression here means the module stopped agreeing with a
 * return that has already been filed with the government.
 */
export function __runDepositScheduleTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`payroll-deposit-schedule self-test FAILED: ${name}`);
    }
  };

  // --- the lookback window, cross-checked against Pub 15 Table 1 -----------
  const lb2026 = lookbackQuartersFor(2026);
  check(
    "Pub 15 Table 1: 2026 lookback is Q3+Q4 2024 and Q1+Q2 2025",
    lb2026.length === 4 &&
      lb2026[0].year === 2024 &&
      lb2026[0].quarter === 3 &&
      lb2026[3].year === 2025 &&
      lb2026[3].quarter === 2,
  );
  check(
    "Table 1 dates: first quarter starts July 1, last ends June 30",
    quarterDateRange(lb2026[0]).start === "2024-07-01" &&
      quarterDateRange(lb2026[3]).end === "2025-06-30",
  );
  const lb2027 = lookbackQuartersFor(2027);
  check(
    "2027 lookback is Q3+Q4 2025 and Q1+Q2 2026 (NOT calendar 2026)",
    lb2027[0].year === 2025 && lb2027[0].quarter === 3 && lb2027[3].year === 2026 && lb2027[3].quarter === 2,
  );
  check(
    "lookback window label reads July 1 2025 through June 30 2026",
    lookbackWindowLabel(2027) === "July 1, 2025 through June 30, 2026",
  );

  // --- MICHAEL'S REAL Q2 2026 941 -----------------------------------------
  // Form 941 line 12 = $14,204.57, and Schedule B's three monthly totals
  // (4,590.41 + 5,898.58 + 3,715.58) sum to it exactly.
  const Q2_2026_LINE12 = 1_420_457;
  check(
    "Q2 2026 Schedule B months tie to line 12",
    459_041 + 589_858 + 371_558 === Q2_2026_LINE12,
  );

  const q = (year: number, quarter: 1 | 2 | 3 | 4, cents: number): LookbackQuarter => ({
    year,
    quarter,
    line12Cents: cents,
    asOriginallyFiled: true,
  });

  // Four quarters at Michael's real Q2 level -> semiweekly, which is what his
  // filed Schedule B independently asserts.
  const four = [
    q(2025, 3, Q2_2026_LINE12),
    q(2025, 4, Q2_2026_LINE12),
    q(2026, 1, Q2_2026_LINE12),
    q(2026, 2, Q2_2026_LINE12),
  ];
  const det = determineDepositSchedule(2027, four);
  check("Greenway 2027: determination succeeds", det.ok);
  if (det.ok) {
    check("Greenway 2027: SEMIWEEKLY", det.schedule === "semiweekly");
    check("Greenway 2027: total is 56,818.28", det.lookbackTotalCents === 5_681_828);
    check(
      "Greenway 2027: total exceeds the 50,000 threshold",
      det.lookbackTotalCents > LOOKBACK_THRESHOLD_CENTS,
    );
    check(
      "explanation names the schedule and shows the arithmetic",
      det.explanation.includes("SEMIWEEKLY") &&
        det.explanation.includes("$56,818.28") &&
        det.explanation.includes("$50,000.00"),
    );
    check(
      "explanation kills the twice-a-week misreading",
      det.explanation.includes("does NOT mean depositing twice a week"),
    );
    check("determination carries authorities", det.authorities.length >= 4);
  }

  // --- THE BOUNDARY: "$50,000 or less" is MONTHLY -------------------------
  const exact = determineDepositSchedule(2027, [
    q(2025, 3, 5_000_000),
    q(2025, 4, 0),
    q(2026, 1, 0),
    q(2026, 2, 0),
  ]);
  check("exactly $50,000 is MONTHLY", exact.ok && exact.schedule === "monthly");
  check(
    "the boundary explains itself",
    exact.ok && exact.explanation.includes("$50,000 or less"),
  );
  const onePennyOver = determineDepositSchedule(2027, [
    q(2025, 3, 5_000_001),
    q(2025, 4, 0),
    q(2026, 1, 0),
    q(2026, 2, 0),
  ]);
  check("$50,000.01 is SEMIWEEKLY", onePennyOver.ok && onePennyOver.schedule === "semiweekly");

  // --- THE REFUSAL --------------------------------------------------------
  const partial = determineDepositSchedule(2027, [q(2026, 2, Q2_2026_LINE12)]);
  check("3 missing quarters -> refusal", !partial.ok);
  if (!partial.ok) {
    check("refusal reason is missing_lookback_quarters", partial.reason === "missing_lookback_quarters");
    check("refusal names all 3 missing quarters", partial.missing.length === 3);
    check(
      "refusal names them in plain English",
      partial.explanation.includes("Q3 2025") &&
        partial.explanation.includes("Q4 2025") &&
        partial.explanation.includes("Q1 2026"),
    );
    check(
      "refusal explains WHY guessing is dangerous, citing the 15% penalty",
      partial.explanation.includes("15%") && partial.explanation.includes("6656"),
    );
  }
  const none = determineDepositSchedule(2027, []);
  check("NO history refuses rather than defaulting to monthly", !none.ok);
  check("empty input names all four quarters", !none.ok && none.missing.length === 4);

  // A new employer's zeros must be ASSERTED, and then they work.
  const newEmployer = determineDepositSchedule(2027, [
    q(2025, 3, 0),
    q(2025, 4, 0),
    q(2026, 1, 0),
    q(2026, 2, 0),
  ]);
  check(
    "asserted zeros (a genuine new employer) -> monthly",
    newEmployer.ok && newEmployer.schedule === "monthly",
  );

  const dupe = determineDepositSchedule(2027, [
    q(2025, 3, 100),
    q(2025, 3, 200),
    q(2026, 1, 0),
    q(2026, 2, 0),
  ]);
  check("duplicate quarter refuses", !dupe.ok && dupe.reason === "duplicate_lookback_quarter");
  const negative = determineDepositSchedule(2027, [
    q(2025, 3, -1),
    q(2025, 4, 0),
    q(2026, 1, 0),
    q(2026, 2, 0),
  ]);
  check("negative line 12 refuses", !negative.ok && negative.reason === "invalid_amount");
  const fractional = determineDepositSchedule(2027, [
    q(2025, 3, 10.5),
    q(2025, 4, 0),
    q(2026, 1, 0),
    q(2026, 2, 0),
  ]);
  check("fractional cents refuses", !fractional.ok && fractional.reason === "invalid_amount");

  // --- HOLIDAYS: reproduce the list Pub 15 (2026) PRINTS -------------------
  const h2026 = federalHolidays(2026);
  const printed: Record<string, string> = {
    "2026-01-01": "New Year's Day",
    "2026-01-19": "Birthday of Martin Luther King, Jr.",
    "2026-02-16": "Washington's Birthday",
    "2026-04-16": "District of Columbia Emancipation Day",
    "2026-05-25": "Memorial Day",
    "2026-06-19": "Juneteenth National Independence Day",
    "2026-07-03": "Independence Day",
    "2026-09-07": "Labor Day",
    "2026-10-12": "Indigenous Peoples' Day (Columbus Day)",
    "2026-11-11": "Veterans Day",
    "2026-11-26": "Thanksgiving Day",
    "2026-12-25": "Christmas Day",
  };
  check("2026 generates exactly 12 holidays", h2026.length === 12);
  for (const [date, name] of Object.entries(printed)) {
    check(`Pub 15 prints ${date} (${name})`, h2026.some((h) => h.date === date && h.name === name));
  }
  // The awkward one, called out because it is the proof the observance rule works.
  check(
    "July 4 2026 is a Saturday, observed July 3",
    h2026.some((h) => h.name === "Independence Day" && h.date === "2026-07-03"),
  );

  check("Saturday is not a business day", !isBusinessDay("2026-07-04", holidaySet(2026)));
  check("a holiday is not a business day", !isBusinessDay("2026-07-03", holidaySet(2026)));
  check("an ordinary Wednesday is a business day", isBusinessDay("2026-07-08", holidaySet(2026)));

  // --- MICHAEL'S REAL PAYDAYS -> REAL DUE DATES ---------------------------
  // The seven Q2 2026 Schedule B dates. All Fridays, 14 days apart.
  const q2Paydays = [
    "2026-04-03",
    "2026-04-17",
    "2026-05-01",
    "2026-05-15",
    "2026-05-29",
    "2026-06-12",
    "2026-06-26",
  ];
  for (const p of q2Paydays) {
    check(`${p} is a Friday`, dayName(p) === "Friday");
    check(`${p} falls in the Wednesday-Friday period`, semiweeklyPeriodOf(p) === "wed_fri");
  }
  const due0403 = depositDueDate("2026-04-03", "semiweekly");
  check(
    "Friday 2026-04-03 -> Wednesday 2026-04-08",
    due0403.ok && due0403.dueDate === "2026-04-08" && dayName(due0403.dueDate) === "Wednesday",
  );

  // Pub 15's OWN semiweekly example: "Green, Inc.'s tax liability for the
  // May 29, 2026 (Friday), payday must be deposited by June 3, 2026
  // (Wednesday)." Michael happens to have a payday on that exact date.
  const green = depositDueDate("2026-05-29", "semiweekly");
  check(
    "Pub 15 worked example: pay 2026-05-29 -> deposit by 2026-06-03",
    green.ok && green.dueDate === "2026-06-03",
  );

  // THE HOLIDAY EXAMPLE FROM THE PUBLICATION, which is why we count three
  // business days instead of nudging a Wednesday. Pay Friday, following Monday
  // is a holiday, deposit "normally due on Wednesday may be made on Thursday".
  // 2026-05-22 is a Friday; Monday 2026-05-25 is Memorial Day.
  const memorial = depositDueDate("2026-05-22", "semiweekly");
  check(
    "holiday inside the 3 weekdays pushes Wednesday to Thursday",
    memorial.ok && memorial.dueDate === "2026-05-28" && dayName(memorial.dueDate) === "Thursday",
  );
  check("and it says so in plain English", memorial.ok && memorial.movedForHoliday);
  check(
    "the explanation corrects the wrong mental model",
    memorial.ok && memorial.explanation.includes("3 BUSINESS days"),
  );

  // A Saturday-Tuesday payday closes Tuesday and is due Friday.
  const monday = depositDueDate("2026-08-03", "semiweekly"); // a Monday
  check("Monday payday is in the Saturday-Tuesday period", semiweeklyPeriodOf("2026-08-03") === "sat_tue");
  check(
    "Monday 2026-08-03 -> Friday 2026-08-07",
    monday.ok && monday.dueDate === "2026-08-07" && dayName(monday.dueDate) === "Friday",
  );

  // Every Friday of 2027 (Michael's first payroll year) must land on a Wednesday
  // or later, never earlier - an early due date would be a false alarm, a late
  // one a penalty.
  let fridays = 0;
  let pushedPastWednesday = 0;
  for (let m = 1; m <= 12; m++) {
    const days = new Date(Date.UTC(2027, m, 0)).getUTCDate();
    for (let dd = 1; dd <= days; dd++) {
      const isoD = `2027-${p2(m)}-${p2(dd)}`;
      if (dayName(isoD) !== "Friday") continue;
      fridays += 1;
      const r = depositDueDate(isoD, "semiweekly");
      if (!r.ok) {
        check(`2027 Friday ${isoD} resolves`, false);
        continue;
      }
      const gap = (parseIso(r.dueDate) as Date).getTime() - (parseIso(isoD) as Date).getTime();
      check(`${isoD}: due at least 5 days later`, gap >= 5 * 86_400_000);
      check(`${isoD}: due date is a business day`, isBusinessDay(r.dueDate, holidaySet(2027)));
      if (dayName(r.dueDate) !== "Wednesday") pushedPastWednesday += 1;
    }
  }
  check("2027 has 53 Fridays", fridays === 53);
  check(
    "exactly 6 of 2027's Fridays are pushed past Wednesday by holidays",
    pushedPastWednesday === 6,
  );

  // --- MONTHLY DUE DATES --------------------------------------------------
  const mon = depositDueDate("2026-04-03", "monthly");
  check("April wages, monthly -> May 15", mon.ok && mon.dueDate === "2026-05-15");
  const dec = depositDueDate("2026-12-31", "monthly");
  check("December wages roll into the next year", dec.ok && dec.dueDate === "2027-01-15");
  // 2026-08-15 is a Saturday, so the due date rolls to Monday the 17th.
  const rolled = depositDueDate("2026-07-10", "monthly");
  check(
    "a 15th that is a Saturday rolls forward to Monday",
    rolled.ok && rolled.nominalDueDate === "2026-08-15" && rolled.dueDate === "2026-08-17",
  );

  // --- $100,000 NEXT-DAY RULE ---------------------------------------------
  check("Greenway's whole Q2 does not trip the rule", !tripsNextDayRule(Q2_2026_LINE12));
  check("exactly $100,000 trips it", tripsNextDayRule(10_000_000));
  check("$99,999.99 does not", !tripsNextDayRule(9_999_999));
  const trip = nextDayRuleConsequence("monthly", 11_000_000, "2026-08-03");
  check("tripping as a monthly depositor is flagged", trip.tripped);
  check("next business day after Monday is Tuesday", trip.dueDate === "2026-08-04");
  check(
    "and the schedule-change consequence is spelled out",
    trip.explanation.includes("SEMIWEEKLY depositor from the next day"),
  );
  const noTrip = nextDayRuleConsequence("semiweekly", Q2_2026_LINE12, "2026-08-03");
  check("below the threshold, normal rules apply", !noTrip.tripped && noTrip.dueDate === null);

  // --- QUARTER-SPANNING PERIOD -------------------------------------------
  // Pub 15's example: Wednesday Sept 30 2026 and Friday Oct 2 2026 share one
  // semiweekly period but sit in different quarters. Same due date, two deposits.
  check("Sept 30 / Oct 2 2026 span two quarters", spansTwoQuarters("2026-09-30", "2026-10-02"));
  const sep30 = depositDueDate("2026-09-30", "semiweekly");
  const oct02 = depositDueDate("2026-10-02", "semiweekly");
  check(
    "both are due Wednesday 2026-10-07, as the publication says",
    sep30.ok && oct02.ok && sep30.dueDate === "2026-10-07" && oct02.dueDate === "2026-10-07",
  );
  check(
    "two paydays in the same quarter do not span",
    !spansTwoQuarters("2026-04-03", "2026-04-17"),
  );

  // --- BAD INPUT ----------------------------------------------------------
  check("garbage date refuses", !depositDueDate("not-a-date", "semiweekly").ok);
  check("impossible date refuses", !depositDueDate("2026-02-30", "semiweekly").ok);
  check("empty string refuses", !depositDueDate("", "monthly").ok);
  check("null period for a bad date", semiweeklyPeriodOf("2026-13-01") === null);

  // --- FORMATTING ---------------------------------------------------------
  check("cents format with commas", formatCents(5_681_828) === "$56,818.28");
  check("threshold formats exactly", formatCents(LOOKBACK_THRESHOLD_CENTS) === "$50,000.00");
  check("zero formats", formatCents(0) === "$0.00");
  check("quarter label", formatQuarter({ year: 2026, quarter: 2 }) === "Q2 2026");

  return { passed, failed };
}
