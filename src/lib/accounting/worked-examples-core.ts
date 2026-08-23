/**
 * src/lib/accounting/worked-examples-core.ts  (books-45, slice C continued)
 *
 * WORKED EXAMPLES — THE NUMBERS, NOT THE PARAGRAPHS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ────────────────────────────────────────────────────────────────────────────
 * books-44 made 82 lessons reachable. Measuring what those lessons actually
 * contain produced an uncomfortable number: 14,562 words of prose, a median of
 * 173 words per lesson, and only 25 of the 82 mention a single concrete figure.
 * Michael's own words about an earlier screen were that it was "hard to digest
 * as there is a wall of words and color", and he has said plainly that he
 * learns visually. Four paragraphs per lesson is that wall, rebuilt.
 *
 * He asked for worked examples. This is the layer that supplies them: for a
 * given lesson, a small table of GIVEN → OUTPUT rows, each with one line saying
 * what the row proves.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULE THAT MAKES THIS TRUSTWORTHY: NOTHING HERE IS TYPED BY HAND
 * ────────────────────────────────────────────────────────────────────────────
 * Every `output` in this file is produced by CALLING THE REAL ENGINE FUNCTION
 * the lesson teaches. Not a copy of what it returns. Not a number remembered
 * from a test. The function itself, at render time.
 *
 * This is not fussiness, and this file can prove it. Building it caught a
 * teaching error that had survived my own review: the SSN example was written
 * around "078-05-1120" (the famous wallet-card number) as the one the engine
 * REFUSES, and around "123-45-6789" as the one it accepts. Calling
 * `ssnProblems()` shows the exact opposite — the engine flags 123-45-6789 as
 * `sequential_placeholder` and has nothing to say about 078-05-1120, because
 * SSA's randomisation FAQ (the mirrored source it is written against) speaks to
 * structural impossibility, not to famous misuse. Had that example been
 * hand-typed prose it would have taught Michael a fact that is backwards, and
 * nothing in the test suite would ever have contradicted it.
 *
 * A hand-typed example is a SECOND implementation of the engine — one with no
 * tests, which drifts silently the moment the real one changes (rule 25: extend,
 * never duplicate). The consequence is the whole design: if an engine changes
 * its behaviour these examples change with it, and if it changes in a way that
 * breaks a documented expectation the gate in the sibling `-gates.ts` fails.
 * The teaching cannot rot away from the code.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE EXAMPLES ARE GREENWAY'S OWN NUMBERS
 * ────────────────────────────────────────────────────────────────────────────
 * Michael: "i don't need to know how to account for any other business... i
 * need to know everything there is to know about accounting for greenway."
 *
 * So the inputs are Greenway's: real WA agencies, real filing deadlines, wages
 * at the scale this shop actually pays, and dates in 2027 because that is when
 * the first payroll runs. No "Company A sells widgets".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE MAY NOT DO: INVENT AN INPUT THE SYSTEM REFUSES TO GUESS
 * ────────────────────────────────────────────────────────────────────────────
 * `computeDorPenalty` REFUSES to compute interest unless it is handed the
 * evidenced annual rate, because RCW 82.32.050(2) sets that rate from federal
 * short-term rates the system does not hold. A worked example is not a licence
 * to slip a plausible number past that gate (rule 12). The rate used below is
 * read from `DOR_ANNUAL_RATES` in `interest-rates-evidenced.ts` — the same
 * evidenced table the real screens use — and if that table ever stops covering
 * the example's year, the example REFUSES too, out loud, on screen.
 *
 * PURE MODULE. No `node:fs`, no `server-only`, no React, no ambient clock.
 * Safe in the client bundle; every date is a literal argument.
 */
import {
  computeDorPenalty,
  computeEsdPenalty,
  computeLniPenalty,
  computeLcbPenalty,
  computeIrsFilePayPenalty,
  dorPenaltyStep,
  monthsOrPartThereof,
  daysBetween,
  lcbDueDateForSalesMonth,
  type PenaltyResult,
} from "@/lib/accounting/tax-penalty-core";
import { DOR_ANNUAL_RATES } from "@/lib/accounting/interest-rates-evidenced";
import {
  maskSsn,
  normalizeSsn,
  ssnProblems,
  salaryGrossForPeriodCents,
  onboardingDeadlines,
  type SsnProblem,
} from "@/lib/payroll/payroll-onboarding-core";
import { formatMilliCentsAsRate } from "@/lib/payroll/payroll-onboarding-ui-core";
import {
  computePeriodHours,
  DEFAULT_OVERTIME_RULES,
  WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS,
  formatHundredthHours,
  type RawPunch,
} from "@/lib/payroll/timesheet-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * WHAT A WORKED EXAMPLE IS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One row of a worked example: what went in, what came out, what it proves.
 *
 * `output` is deliberately a STRING even when the engine returns a number,
 * because the row is a display artefact. The formatting happens here, once,
 * rather than in the page — keeping the page a renderer of data (house
 * architecture) and keeping this testable without a DOM.
 */
export type ExampleRow = {
  /** The input, written the way Michael would say it out loud. */
  readonly given: string;
  /** What the engine returned, formatted for reading. */
  readonly output: string;
  /** One sentence: why this row is here and what it demonstrates. */
  readonly soWhat: string;
  /**
   * True when this row is the trap the lesson warns about — the case that looks
   * wrong but is right, or looks fine and is a mistake. Rendered in the orange
   * that already means "what goes wrong here" on the lesson card, so the colour
   * keeps meaning one thing across the whole screen.
   */
  readonly isTrap?: boolean;
};

/** A complete worked example attached to one lesson. */
export type WorkedExample = {
  /** `source:fn` — the same key `lessonKey()` builds in learning-path-core. */
  readonly lessonKey: string;
  /** A short title, e.g. "A DOR payment three months late". */
  readonly title: string;
  /** One or two sentences of setup before the table. */
  readonly setup: string;
  readonly rows: readonly ExampleRow[];
  /** The single sentence to remember. Rendered as the closing line. */
  readonly takeaway: string;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * SMALL FORMATTERS — shared so every example reads the same way
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Integer cents to "$1,234.56". Never floats: cents divided for DISPLAY only. */
export function money(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(
      `money() requires integer cents, got ${cents}. A float reaching a display ` +
        `path usually means it reached a money path first.`,
    );
  }
  const neg = cents < 0;
  const a = Math.abs(cents);
  const whole = Math.floor(a / 100);
  const part = a - whole * 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${grouped}.${String(part).padStart(2, "0")}`;
}

/**
 * The evidenced WA DOR annual interest rate for a year, in MILLI-PERCENT, or
 * null when the evidence table does not cover that year.
 *
 * `DOR_ANNUAL_RATES` stores BASIS POINTS (600 = 6%). `computeDorPenalty` wants
 * MILLI-PERCENT (6_000 = 6%). Those two units differ by a factor of ten and
 * both are plausible-looking integers, which is exactly the sort of silent
 * mismatch that produces a wrong answer with no error. The conversion is done
 * here, once, named, rather than inline at a call site where 600 would look
 * fine and quietly bill Michael 0.6% interest.
 */
export function dorAnnualRateMilliPercentFor(year: number): number | null {
  const row = DOR_ANNUAL_RATES.find((r) => r.year === year);
  if (row === undefined) return null;
  // basis points -> milli-percent: 1 bp = 0.01% = 10 milli-percent.
  return row.basisPoints * 10;
}

/**
 * The marker an example emits when an ENGINE could not answer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SENTINEL AND NOT JUST THE WORD "REFUSED"
 * ────────────────────────────────────────────────────────────────────────────
 * There are two completely different things in this module that both read as a
 * refusal in plain English, and the gate has to tell them apart:
 *
 *   1. AN ENGINE COULD NOT ANSWER. `computeDorPenalty` returning `ok: false`
 *      because no evidenced interest rate exists for the year. This is a broken
 *      example. It must fail CI and must never reach Michael's screen.
 *
 *   2. AN ENGINE ANSWERED, AND THE ANSWER IS "NO". `ssnProblems()` rejecting
 *      123-45-6789 is the entire point of that example. The word "refused" is
 *      the TEACHING, not a fault.
 *
 * The first draft of the gate grepped output text for /refus/i and therefore
 * failed the SSN example — the one place where a refusal is the correct thing
 * to show. Fixing that by exempting the SSN example would have been fixing the
 * instance; the class of defect is that "an engine broke" was being inferred
 * from English prose instead of being stated in machine terms (standing rule
 * 23). So the broken case now emits a token no sentence would ever contain, and
 * the gate looks for the token.
 */
export const ENGINE_REFUSAL_MARKER = "⟪ENGINE-REFUSAL⟫";

/**
 * Read a penalty result for display, refusing to fabricate on refusal.
 *
 * The engines return a discriminated union and a refusal is a REAL outcome, not
 * an error case to be swallowed. If a worked example papered over a refusal
 * with a zero it would teach Michael that being late is free.
 */
function penaltyLine(result: PenaltyResult): string {
  if (!result.ok) return `${ENGINE_REFUSAL_MARKER} ${result.refusal.code}`;
  const a = result.assessment;
  if (a.totalInterestCents === 0) return `${money(a.totalPenaltyCents)} penalty`;
  return (
    `${money(a.totalAddedCents)} total — ${money(a.totalPenaltyCents)} penalty ` +
    `plus ${money(a.totalInterestCents)} interest`
  );
}

/** SSN problem codes are machine words. Michael reads English. */
const SSN_PROBLEM_ENGLISH: Readonly<Record<SsnProblem, string>> = {
  not_nine_digits: "that is not nine digits",
  area_000: "no SSN starts 000",
  area_666: "no SSN starts 666",
  area_900_999: "900-999 is an ITIN range, not an SSN",
  group_00: "the middle pair is never 00",
  serial_0000: "the last four are never 0000",
  sequential_placeholder: "123-45-6789 is the number people type to get past a required field",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * THE EXAMPLES
 *
 * Each builder CALLS the engine. Read any one of them and you are reading the
 * same code path the real screens use.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * DOR late payment — the three-step ladder, and where the steps actually fall.
 *
 * Greenway files the DOR combined excise return monthly, so this is the single
 * most likely penalty for this business to incur: it is the most frequent
 * filing, and Michael has said the ones he forgets are the routine ones.
 *
 * THE POINT OF THE FOUR ROWS is that the ladder is keyed to CALENDAR MONTH-ENDS,
 * not to elapsed time. One day late and five weeks late are both step 1.
 */
function dorLadder(): WorkedExample {
  const tax = 4_820_00;
  const due = "2027-01-25";
  const rate = dorAnnualRateMilliPercentFor(2027);

  const cases: readonly { readonly paid: string; readonly said: string }[] = [
    { paid: "2027-01-26", said: "Paid the very next day" },
    { paid: "2027-02-10", said: "Paid two weeks later" },
    { paid: "2027-03-05", said: "Paid after the end of February" },
    { paid: "2027-07-01", said: "Paid five months later" },
  ];

  const rows: ExampleRow[] = cases.map(({ paid, said }) => {
    const step = dorPenaltyStep(due, paid);
    const late = daysBetween(due, paid);
    const result =
      rate === null
        ? null
        : computeDorPenalty({
            taxCents: tax,
            dueDate: due,
            paidDate: paid,
            annualInterestMilliPercent: rate,
          });
    return {
      given: `${said} (${paid}, ${late} day${late === 1 ? "" : "s"} late)`,
      output:
        result === null
          ? `${ENGINE_REFUSAL_MARKER} no evidenced DOR interest rate for 2027`
          : `Step ${step} · ${penaltyLine(result)}`,
      soWhat:
        step === 1 && paid === "2027-01-26"
          ? "One day late is already the full first step. There is no grace period and no daily proration."
          : step === 1
            ? "Two weeks later and it costs exactly the same as one day. The clock is not counting days."
            : step === 2
              ? "The month turned. Crossing 28 February moved this up a whole step overnight."
              : "Step 3 is the last one. The penalty stops climbing, but the interest does not.",
      isTrap: paid === "2027-02-10",
    };
  });

  return {
    lessonKey: "penalties:computeDorPenalty",
    title: "A Department of Revenue payment, at four different degrees of late",
    setup:
      `Greenway owes ${money(tax)} on a monthly combined excise return due ${due}. ` +
      `Watch which day changes the answer — it is not the one you would expect.`,
    rows,
    takeaway:
      "The expensive move is crossing a MONTH-END, not adding days. If a payment is going " +
      "to be late anyway, getting it in before the last day of the month is worth a full " +
      "ten percent of the tax.",
  };
}

/**
 * The same lateness, priced by five different agencies.
 *
 * THIS IS THE EXAMPLE MICHAEL MOST NEEDS and no single lesson can show it,
 * because each agency's rule lives in its own function. Seeing them side by side
 * is the point: they disagree, and treating "late is late" as one concept is how
 * a business with limited cash pays the wrong one first.
 */
function fiveAgenciesOneLateness(): WorkedExample {
  const tax = 10_000_00;
  const due = "2027-01-25";
  const paid = "2027-03-25";
  const rate = dorAnnualRateMilliPercentFor(2027);

  const dor =
    rate === null
      ? null
      : computeDorPenalty({
          taxCents: tax,
          dueDate: due,
          paidDate: paid,
          annualInterestMilliPercent: rate,
        });
  const esd = computeEsdPenalty({ taxCents: tax, dueDate: due, paidDate: paid });
  const lni = computeLniPenalty({ taxCents: tax, dueDate: due, paidDate: paid });
  const irs = computeIrsFilePayPenalty({
    taxCents: tax,
    dueDate: due,
    filedDate: paid,
    paidDate: paid,
  });
  // The LCB deadline is a RULE, not a caller-supplied date: the 20th of the
  // month after the month of sale. So this one is asked a different question.
  const lcb = computeLcbPenalty({ taxCents: tax, salesMonth: "2027-01-15", paidDate: paid });

  return {
    lessonKey: "penalties:AGENCY_CLOCKS",
    title: "One amount, two months late, five different agencies",
    setup:
      `Exactly ${money(tax)} owed to each of five agencies, all of it paid ${paid}. ` +
      `If "late" were one idea these would match. They are not even close.`,
    rows: [
      {
        given: "Department of Revenue — sales tax and B&O",
        output:
          dor === null
            ? `${ENGINE_REFUSAL_MARKER} no evidenced DOR interest rate for 2027`
            : penaltyLine(dor),
        soWhat:
          "The steepest schedule of the five: 9 / 19 / 29 percent, keyed to calendar month-ends.",
        isTrap: true,
      },
      {
        given: "Employment Security — unemployment tax",
        output: penaltyLine(esd),
        soWhat:
          "5 / 10 / 20 percent counted in elapsed months 'or part thereof', plus 1 percent a month simple interest.",
      },
      {
        given: "Labor & Industries — workers' compensation",
        output: penaltyLine(lni),
        soWhat:
          "The same 5 / 10 / 20 shape as Employment Security, which is why it is tempting to treat WA as one clock. It is two.",
      },
      {
        given: "IRS — filed late and paid late",
        output: penaltyLine(irs),
        soWhat:
          "Counted in DAYS, not months, and the failure-to-file and failure-to-pay penalties interact rather than simply adding.",
      },
      {
        given: "Liquor & Cannabis Board — January cannabis excise",
        output: penaltyLine(lcb),
        soWhat:
          "2 percent per month that keeps accumulating with no stated cap — the only one of the five that never stops growing.",
      },
    ],
    takeaway:
      "There is no such thing as 'the late penalty'. Same money, same delay, five different " +
      "answers. When cash is short, the order you pay in is a real decision worth real money.",
  };
}

/**
 * The LCB return and the weekend roll — a date trap with a real cost.
 */
function lcbWeekendRoll(): WorkedExample {
  const months: readonly { readonly iso: string; readonly said: string }[] = [
    { iso: "2027-01-15", said: "January 2027" },
    { iso: "2027-04-15", said: "April 2027" },
    { iso: "2027-05-15", said: "May 2027" },
  ];

  const rows: ExampleRow[] = months.map(({ iso, said }) => {
    const due = lcbDueDateForSalesMonth(iso);
    const rolled = due.rolledDays > 0;
    return {
      given: `Cannabis sold in ${said}`,
      output: rolled
        ? `Due ${due.effective} — the 20th (${due.original}) is a ${due.rolledReason}`
        : `Due ${due.effective}`,
      soWhat: rolled
        ? `The deadline moves FORWARD ${due.rolledDays} day${due.rolledDays === 1 ? "" : "s"} to the next business day. It never moves earlier.`
        : "The 20th is a weekday, so the deadline is simply the 20th.",
      isTrap: rolled,
    };
  });

  return {
    lessonKey: "penalties:lcbDueDateForSalesMonth",
    title: "When is the cannabis excise return actually due?",
    setup:
      "The rule is 'the 20th of the month following the month of sale'. That is not the same " +
      "as a fixed date, because some 20ths land on a weekend.",
    rows,
    takeaway:
      "Never diary 'the 20th'. Diary the computed date. A deadline that moves is exactly the " +
      "deadline that gets missed by someone working from memory — and note the engine still " +
      "has not checked HOLIDAYS, which it says out loud rather than pretending.",
  };
}

/**
 * Overtime is per WEEK, never per pay period. The costliest payroll trap here.
 *
 * Built on `computePeriodHours`, the real timesheet engine, with real punches —
 * NOT on arithmetic invented in this file. That matters: an earlier draft of
 * this example called `hourlyGrossCents` twice and subtracted, which computes
 * straight time only and would have shown a difference of ZERO, teaching the
 * precise opposite of the lesson.
 */
function overtimeIsWeekly(): WorkedExample {
  // Thousandths of a cent per hour: 2_450_000 = $24.50/hour. Written as the
  // engine's own unit, and DISPLAYED through the shared formatter below, so the
  // rate in the sentence can never drift from the rate in the calculation.
  const rateMilliCents = 2_450_000;
  const rateShown = formatMilliCentsAsRate(rateMilliCents);
  const employee = {
    employeeId: "example-budtender",
    fullName: "A budtender",
    flsaStatus: "non_exempt",
    basis: "hourly",
    hourlyRateMilliCents: rateMilliCents,
  } as const;
  // A real Greenway biweekly period: Sunday 3 Jan 2027 to Saturday 16 Jan 2027.
  const period = { startDate: "2027-01-03", endDate: "2027-01-16" };
  const settings = { workweekStartsOn: 0 as const, ...DEFAULT_OVERTIME_RULES };

  const weekOneDays = ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08"];
  const weekTwoDays = ["2027-01-11", "2027-01-12", "2027-01-13", "2027-01-14", "2027-01-15"];

  /** A 09:00 Pacific shift of `hours` length, as the punch pair the engine reads. */
  function shift(id: string, day: string, hours: number): RawPunch {
    // January is PST (UTC-8), so 09:00 Pacific is 17:00Z. Written as a literal
    // instant because this module holds no clock and no timezone database.
    const clockInAt = `${day}T17:00:00.000Z`;
    const clockOutAt = new Date(Date.parse(clockInAt) + hours * 3_600_000).toISOString();
    return { id, employeeId: employee.employeeId, punchKind: "work", clockInAt, clockOutAt, minutes: null };
  }

  function grossFor(weekOne: number, weekTwo: number): number | null {
    const punches: RawPunch[] = [
      ...weekOneDays.map((d, i) => shift(`w1-${i}`, d, weekOne)),
      ...weekTwoDays.map((d, i) => shift(`w2-${i}`, d, weekTwo)),
    ];
    const r = computePeriodHours({ employee, period, punches, settings });
    return r.ok ? r.value.grossCents : null;
  }

  const even = grossFor(8, 8); // 40 + 40
  const lopsided = grossFor(9, 7); // 45 + 35
  const threshold = formatHundredthHours(WA_OVERTIME_THRESHOLD_HUNDREDTH_HOURS);

  return {
    lessonKey: "onboarding:hourlyGrossCents",
    title: "Eighty hours is not always eighty hours",
    setup:
      `A budtender at ${rateShown} an hour works 80 hours across one biweekly period. Two ways ` +
      `to arrive at 80 — and the payroll engine does not price them the same.`,
    rows: [
      {
        given: "Five 8-hour days, then five more (40 + 40)",
        output: even === null ? `${ENGINE_REFUSAL_MARKER} timesheet` : money(even),
        soWhat: `Neither week crossed ${threshold} hours, so every hour is straight time.`,
      },
      {
        given: "Five 9-hour days, then five 7-hour days (45 + 35)",
        output: lopsided === null ? `${ENGINE_REFUSAL_MARKER} timesheet` : money(lopsided),
        soWhat:
          `Identical 80 hours — but week one crossed ${threshold}, so five of those hours carry a half-rate premium on top.`,
        isTrap: true,
      },
      {
        given: "What the second roster costs over the first",
        output:
          even === null || lopsided === null ? `${ENGINE_REFUSAL_MARKER} timesheet` : money(lopsided - even),
        soWhat:
          "This is what an employer underpays every single period if they add two weeks together before checking for overtime.",
      },
    ],
    takeaway:
      "Each workweek stands alone (29 CFR §778.104, RCW 49.46.130). Averaging two weeks to 80 " +
      "hours is a wage claim, not a rounding difference — and it repeats quietly every period " +
      "until somebody finally adds it up.",
  };
}

/**
 * A social security number is never fully displayed, and never guessed at.
 *
 * THE ROW THAT MATTERS is the third one, and it is the reason this whole module
 * calls engines instead of quoting them: the number everybody "knows" is invalid
 * sails through, and the one that looks perfectly ordinary is refused.
 */
function ssnHandling(): WorkedExample {
  const typed = "531-88-4021";
  const placeholder = "123-45-6789";
  const famous = "078-05-1120";

  function verdict(raw: string): string {
    const problems = ssnProblems(raw);
    if (problems.length === 0) return "Accepted";
    return `Refused — ${problems.map((p) => SSN_PROBLEM_ENGLISH[p]).join("; ")}`;
  }

  return {
    lessonKey: "onboarding:maskSsn",
    title: "What Greenway stores, what it shows, and what it refuses",
    setup:
      "A new hire's SSN goes through three different treatments, and the checks catch a " +
      "different number than most people expect.",
    rows: [
      {
        given: `Typed on the W-4 as "${typed}"`,
        output: `Stored as ${normalizeSsn(typed) ?? "(rejected)"}`,
        soWhat: "Punctuation stripped on the way in, so one person cannot end up in the file twice.",
      },
      {
        given: "Shown back on any screen afterwards",
        output: maskSsn(normalizeSsn(typed) ?? ""),
        soWhat: "Only the last four. That is enough to tell two employees apart, and nobody needs the rest.",
      },
      {
        given: `Typed as "${placeholder}"`,
        output: verdict(placeholder),
        soWhat:
          "The number people type to get past a required field. Structurally fine, obviously not real, refused at the keyboard.",
      },
      {
        given: `Typed as "${famous}" — the 1938 wallet-card number`,
        output: verdict(famous),
        soWhat:
          "ACCEPTED. These checks prove a number is IMPOSSIBLE, never that it is right — only SSA can do that.",
        isTrap: true,
      },
    ],
    takeaway:
      "A wrong SSN is not discovered by you. It is discovered by the Social Security " +
      "Administration months later, after the W-2s have gone out — so catch what you can at " +
      "the keyboard and never mistake 'accepted' for 'verified'.",
  };
}

/**
 * The owner's own paycheque: an annual salary split into whole cents.
 */
function ownerSalary(): WorkedExample {
  const annual = 55_000_00;
  const first = salaryGrossForPeriodCents(annual, "biweekly", 0);
  const rest = salaryGrossForPeriodCents(annual, "biweekly", 1);
  const monthlyFirst = salaryGrossForPeriodCents(annual, "monthly", 0);
  const monthlyRest = salaryGrossForPeriodCents(annual, "monthly", 1);

  let total = 0;
  for (let i = 0; i < 26; i += 1) total += salaryGrossForPeriodCents(annual, "biweekly", i);

  return {
    lessonKey: "onboarding:salaryGrossForPeriodCents",
    title: "Splitting a salary 26 ways without losing a penny",
    setup:
      `A ${money(annual)} salary has to divide into whole cents 26 times. It does not divide ` +
      `evenly, and where the leftover lands is a decision rather than an accident.`,
    rows: [
      {
        given: "The FIRST biweekly cheque of the year",
        output: money(first),
        soWhat: "The remainder is paid out here, at the start, rather than drifting through the year.",
        isTrap: true,
      },
      {
        given: "Every other biweekly cheque",
        output: money(rest),
        soWhat: `${money(annual)} ÷ 26, floored to whole cents.`,
      },
      {
        given: "All 26 cheques added back up",
        output: `${money(total)} against a ${money(annual)} salary`,
        soWhat:
          total === annual
            ? "Exactly the salary. Not approximately — exactly, which is the only acceptable answer."
            : "A mismatch, which would be a defect.",
      },
      {
        given: "The same salary paid monthly instead",
        output:
          monthlyFirst === monthlyRest
            ? `${money(monthlyFirst)} every month`
            : `${money(monthlyFirst)} in January, then ${money(monthlyRest)}`,
        soWhat:
          monthlyFirst === monthlyRest
            ? "Twelve divides this salary cleanly, so there is nothing left over to place."
            : "Twelve does not divide it cleanly either — so the same rule applies, and January again absorbs the remainder.",
      },
    ],
    takeaway:
      "Money is integer cents everywhere in this system. Fractions of a cent do not exist, so " +
      "every division has to say out loud who gets the remainder — and prove the pieces add " +
      "back to the whole.",
  };
}

/**
 * Counting months the way a penalty statute counts them.
 */
function partialMonths(): WorkedExample {
  const pairs: readonly (readonly [string, string])[] = [
    ["2027-01-31", "2027-02-01"],
    ["2027-01-31", "2027-02-28"],
    ["2027-01-31", "2027-03-01"],
  ];

  const rows: ExampleRow[] = pairs.map(([from, to]) => {
    const months = monthsOrPartThereof(from, to);
    const days = daysBetween(from, to);
    return {
      given: `Due ${from}, paid ${to} — ${days} day${days === 1 ? "" : "s"} late`,
      output: `${months} month${months === 1 ? "" : "s"} for penalty purposes`,
      soWhat:
        days === 1
          ? "One day late already counts as a whole month. 'Or part thereof' means exactly that."
          : days === 28
            ? "Twenty-eight days and one day are both 'one month'. Nothing changed in between."
            : "One more day and it is two months. The step happens all at once.",
      isTrap: days === 29,
    };
  });

  return {
    lessonKey: "penalties:monthsOrPartThereof",
    title: '"Or part thereof" — the three most expensive words on the page',
    setup:
      "Penalty statutes count months, and they count a month that has barely started as a whole " +
      "one. Watch the middle row and then the one after it.",
    rows,
    takeaway:
      "Between the 1st and the 28th of the same month, the cost of being late does not change " +
      "at all. On the 29th it jumps. If you are going to be late, the DAY matters far more than " +
      "the number of days.",
  };
}

/**
 * Hiring deadlines — three clocks that start on the same day and count differently.
 */
function hireDayClocks(): WorkedExample {
  const hire = "2027-01-04"; // a Monday
  const deadlines = onboardingDeadlines(hire);

  const rows: ExampleRow[] = deadlines.map((d) => ({
    given: d.label,
    output: d.dueYmd,
    soWhat: d.help,
    isTrap: d.key === "i9_section2",
  }));

  return {
    lessonKey: "onboarding:onboardingDeadlines",
    title: "Somebody starts on Monday. What is already running?",
    setup:
      `A new budtender's first day is ${hire}. Three separate clocks start that morning, and ` +
      `no two of them count the same way.`,
    rows,
    takeaway:
      "Three days, twenty days, three years — and the short one counts BUSINESS days while the " +
      "middle one counts calendar days. Every one of these is computed rather than counted on " +
      "fingers, because the I-9 clock is the shortest and the most expensive to miss.",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every worked example, built by calling the engines.
 *
 * A FUNCTION, not a constant, and that is deliberate: a module-level constant
 * would run every engine call at import time, so one throw anywhere would take
 * down any page that so much as imported this file. Built on demand, a broken
 * example is a broken example rather than a broken screen.
 */
export function allWorkedExamples(): readonly WorkedExample[] {
  return [
    dorLadder(),
    fiveAgenciesOneLateness(),
    lcbWeekendRoll(),
    overtimeIsWeekly(),
    ssnHandling(),
    ownerSalary(),
    partialMonths(),
    hireDayClocks(),
  ];
}

/** The worked example for one lesson, or null when that lesson has none yet. */
export function workedExampleFor(key: string): WorkedExample | null {
  return allWorkedExamples().find((e) => e.lessonKey === key) ?? null;
}

/** Lesson keys that currently carry a worked example. */
export function lessonsWithWorkedExamples(): readonly string[] {
  return allWorkedExamples().map((e) => e.lessonKey);
}

/**
 * HONEST COVERAGE. Not every lesson has an example yet, and the screen says so
 * rather than implying the course is more finished than it is (rule 12).
 */
export function workedExampleCoverage(totalLessons: number): {
  readonly withExample: number;
  readonly totalLessons: number;
  readonly sentence: string;
} {
  if (!Number.isInteger(totalLessons) || totalLessons <= 0) {
    throw new Error(
      `workedExampleCoverage needs a real lesson count, got ${totalLessons}. ` +
        `Reporting coverage against zero would render a cheerful "0 of 0".`,
    );
  }
  const withExample = allWorkedExamples().length;
  return {
    withExample,
    totalLessons,
    sentence:
      `${withExample} of the ${totalLessons} lessons carry a worked example so far. ` +
      `The rest explain in words only — that is a gap, and it is named here rather than hidden.`,
  };
}
