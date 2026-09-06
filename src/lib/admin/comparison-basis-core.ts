/**
 * comparison-basis-core.ts (Slice 21) — PURE. What "vs" means on the cockpit.
 *
 * Michael, verbatim:
 *
 *   "I want the comparison number that compares the previous day to today is
 *    good, but we can make it better. I want to be able to switch between
 *    different comparison metrics. For example, I want to see an average for
 *    that particular day of the week going back in history to average all of
 *    that specific day to compare with today. Or maybe I want to see last weeks
 *    specific day of the week as a comparison. Is there any other useful
 *    comparison measures we can add to make it more powerful and insightful?"
 *
 * Before this slice the cockpit compared today to yesterday and nothing else
 * (`cockpit-data.ts` built `yestYmd = addPacificDays(todayYmd, -1)` and fed it
 * straight into `computeDelta`). That is a fine default and a poor only-option:
 * a Tuesday compared to a Monday is comparing two different businesses.
 *
 * This module owns ONLY the arithmetic of "which past days am I comparing
 * against, and how do I combine them". It touches no database and no clock —
 * every function takes the current business day as an argument so the caller
 * (and the tests) decide what "today" is. That is deliberate: a comparison
 * engine that reads the wall clock cannot be tested for the interesting cases
 * (leap days, month ends, the Sunday/Monday weekday wrap).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO RULES THIS MODULE WILL NOT BREAK
 *
 *  1. TODAY IS NEVER IN ITS OWN BASELINE. Averaging "every Tuesday" must not
 *     include the Tuesday you are standing in, or the comparison is diluted by
 *     the very number it is judging, and a record-breaking day looks average.
 *     Every window generator here walks strictly BACKWARDS from today.
 *
 *  2. A PARTIAL DAY IS NOT COMPARED TO WHOLE ONES SILENTLY. At 10am, today has
 *     two hours of trade in it and yesterday has twelve. Reporting "▼ 84% vs
 *     yesterday" is arithmetically true and operationally useless. Each basis
 *     therefore declares whether it is `wholeDayBaseline`, and the caller is
 *     given `paceNote` text to say so out loud. We do not silently rescale
 *     anyone's revenue — we tell them what they are looking at.
 */

// ── Basis catalogue ─────────────────────────────────────────────────────────

/**
 * The comparison bases the cockpit offers. Every one of these is computable
 * from whole Pacific business days, which is the only granularity the sales
 * report aggregates cleanly over (`getSalesReport(startISO, endISO)`).
 */
export type ComparisonBasis =
  | "yesterday"
  | "same_day_last_week"
  | "dow_average_4"
  | "dow_average_12"
  | "trailing_7_avg"
  | "trailing_28_avg"
  | "same_day_last_month"
  | "same_day_last_year"
  | "best_same_dow";

export type BasisSpec = {
  id: ComparisonBasis;
  /** Short label for the selector chip. */
  label: string;
  /** What this answers, in the owner's language, for the help text. */
  description: string;
  /** How the baseline days combine into one number. */
  mode: "single" | "average" | "max";
  /**
   * True when the baseline is made of COMPLETE past days. Today is always
   * partial until close, so the UI must say so rather than imply a fair fight.
   */
  wholeDayBaseline: true;
};

/**
 * Ordered for the selector: the two the owner named first, then the averages
 * that smooth out noise, then the long-range ones.
 *
 * `dow_average_4` and `dow_average_12` are both offered on purpose. Four weeks
 * answers "how am I doing lately"; twelve weeks answers "how am I doing for a
 * Tuesday, in general". A single "day of week average" would have to silently
 * pick one of those meanings.
 */
export const COMPARISON_BASES: readonly BasisSpec[] = [
  {
    id: "yesterday",
    label: "Yesterday",
    description: "The single day before today. Fastest read on momentum, but it compares a Tuesday to a Monday.",
    mode: "single",
    wholeDayBaseline: true,
  },
  {
    id: "same_day_last_week",
    label: "Same day last week",
    description: "The same weekday, 7 days ago. Like-for-like trading pattern, but one day is a small sample.",
    mode: "single",
    wholeDayBaseline: true,
  },
  {
    id: "dow_average_4",
    label: "This weekday, 4-wk avg",
    description: "Average of the last 4 of this same weekday. Like-for-like, and one odd week cannot dominate it.",
    mode: "average",
    wholeDayBaseline: true,
  },
  {
    id: "dow_average_12",
    label: "This weekday, 12-wk avg",
    description: "Average of the last 12 of this same weekday. The long-run shape of a typical one of these days.",
    mode: "average",
    wholeDayBaseline: true,
  },
  {
    id: "trailing_7_avg",
    label: "Trailing 7-day avg",
    description: "Average of the last 7 days, all weekdays mixed. Answers 'is today a normal day for us right now'.",
    mode: "average",
    wholeDayBaseline: true,
  },
  {
    id: "trailing_28_avg",
    label: "Trailing 28-day avg",
    description: "Average of the last 28 days. A stable baseline that covers four of every weekday.",
    mode: "average",
    wholeDayBaseline: true,
  },
  {
    id: "same_day_last_month",
    label: "Same weekday, 4 wks ago",
    description: "The same weekday 28 days back — a month-ago read that stays on the same weekday.",
    mode: "single",
    wholeDayBaseline: true,
  },
  {
    id: "same_day_last_year",
    label: "Same weekday, 1 yr ago",
    description: "The nearest same weekday about a year back (364 days). Year-over-year without a weekday mismatch.",
    mode: "single",
    wholeDayBaseline: true,
  },
  {
    id: "best_same_dow",
    label: "Best ever (this weekday)",
    description: "Your best single day among the last 12 of this weekday — the record today is chasing.",
    mode: "max",
    wholeDayBaseline: true,
  },
] as const;

export const DEFAULT_BASIS: ComparisonBasis = "yesterday";

/**
 * Parse a URL parameter into a basis. NEVER throws and never guesses at a
 * near-miss: anything unrecognised falls back to the historical default so a
 * hand-edited or stale URL shows the number the cockpit has always shown,
 * rather than an error page or a silently different metric.
 */
export function parseComparisonBasis(raw: unknown): ComparisonBasis {
  if (typeof raw !== "string") return DEFAULT_BASIS;
  const v = raw.trim().toLowerCase();
  const hit = COMPARISON_BASES.find((b) => b.id === v);
  return hit ? hit.id : DEFAULT_BASIS;
}

export function basisSpec(id: ComparisonBasis): BasisSpec {
  const hit = COMPARISON_BASES.find((b) => b.id === id);
  // Unreachable for a parsed basis; kept total so the type never lies.
  return hit ?? COMPARISON_BASES[0];
}

// ── Pacific-day arithmetic (pure, no Date-now) ──────────────────────────────

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `ymd` is a well-formed calendar date (rejects 2026-02-30). */
export function isYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map((n) => Number(n));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * Shift a YYYY-MM-DD by whole days using UTC math.
 *
 * Using UTC here is correct rather than sloppy: a Pacific business DAY KEY is
 * a calendar label, not an instant, so "the day before 2026-11-02" is a
 * calendar question with no DST component. Doing this in local time is exactly
 * how the 1am-on-a-fall-back-Sunday bug gets written.
 */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** Day of week for a day key: 0 = Sunday … 6 = Saturday. */
export function ymdWeekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function weekdayName(ymd: string): string {
  return WEEKDAY_NAMES[ymdWeekday(ymd)];
}

// ── Window generation ───────────────────────────────────────────────────────

export type ComparisonWindow = {
  basis: ComparisonBasis;
  /**
   * The baseline business days, most recent first. ALWAYS strictly before
   * `today` — see rule 1 at the top of this file.
   */
  days: string[];
  mode: "single" | "average" | "max";
  /** Selector label, e.g. "Same day last week". */
  label: string;
  /** Sentence for the delta pill, e.g. "vs the last 4 Tuesdays". */
  comparisonLabel: string;
  /** Plain-language warning that today is still in progress. */
  paceNote: string;
};

/**
 * The days a basis compares against, for a given business day.
 *
 * Every branch subtracts from `today`, so today can never appear in its own
 * baseline. `count` is fixed per basis rather than caller-supplied, so a UI
 * cannot ask for "the last 400 Tuesdays" and quietly issue 400 queries.
 */
export function comparisonWindowFor(
  basis: ComparisonBasis,
  today: string,
): ComparisonWindow {
  const spec = basisSpec(basis);
  const dow = weekdayName(today);
  let days: string[];
  let comparisonLabel: string;

  switch (basis) {
    case "yesterday":
      days = [shiftYmd(today, -1)];
      comparisonLabel = "vs yesterday";
      break;

    case "same_day_last_week":
      days = [shiftYmd(today, -7)];
      comparisonLabel = `vs last ${dow}`;
      break;

    case "dow_average_4":
      days = sameWeekdaysBack(today, 4);
      comparisonLabel = `vs the last 4 ${dow}s`;
      break;

    case "dow_average_12":
      days = sameWeekdaysBack(today, 12);
      comparisonLabel = `vs the last 12 ${dow}s`;
      break;

    case "trailing_7_avg":
      days = consecutiveDaysBack(today, 7);
      comparisonLabel = "vs the trailing 7-day average";
      break;

    case "trailing_28_avg":
      days = consecutiveDaysBack(today, 28);
      comparisonLabel = "vs the trailing 28-day average";
      break;

    case "same_day_last_month":
      // 28 days, not "one calendar month": a calendar month lands on a
      // different weekday and reintroduces exactly the mismatch the owner is
      // trying to escape. Four weeks back is the same weekday, always.
      days = [shiftYmd(today, -28)];
      comparisonLabel = `vs the ${dow} four weeks ago`;
      break;

    case "same_day_last_year":
      // 364 = 52 × 7, so it is the SAME WEEKDAY roughly one year back. Using
      // 365 would drift the weekday by one and compare a Saturday to a Friday.
      days = [shiftYmd(today, -364)];
      comparisonLabel = `vs the ${dow} a year ago`;
      break;

    case "best_same_dow":
      days = sameWeekdaysBack(today, 12);
      comparisonLabel = `vs your best ${dow} (last 12)`;
      break;
  }

  return {
    basis,
    days,
    mode: spec.mode,
    label: spec.label,
    comparisonLabel,
    paceNote:
      spec.mode === "average"
        ? "Baseline is complete past days; today is still in progress."
        : "Baseline is a complete past day; today is still in progress.",
  };
}

/** The `count` most recent days sharing today's weekday, excluding today. */
export function sameWeekdaysBack(today: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) out.push(shiftYmd(today, -7 * i));
  return out;
}

/** The `count` consecutive days immediately before today, excluding today. */
export function consecutiveDaysBack(today: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) out.push(shiftYmd(today, -i));
  return out;
}

/** Every distinct day any basis could ask for, so a caller can fetch once. */
export function allBaselineDays(today: string): string[] {
  const seen = new Set<string>();
  for (const b of COMPARISON_BASES) {
    for (const d of comparisonWindowFor(b.id, today).days) seen.add(d);
  }
  return [...seen].sort().reverse();
}

// ── Combining a baseline into one number ────────────────────────────────────

export type BaselineResult = {
  /** The single comparison value, or null when there is nothing to compare to. */
  value: number | null;
  /** How many baseline days actually carried data. */
  daysWithData: number;
  /** How many days the basis asked for. */
  daysRequested: number;
  /**
   * True when SOME requested days were missing. A four-week average built from
   * two weeks is still useful, but the operator must be told it is thinner
   * than advertised rather than shown a confident-looking number.
   */
  partial: boolean;
};

/**
 * Reduce the baseline day values to one number according to the basis mode.
 *
 * `values` may contain nulls for days with no data at all. Those are DROPPED,
 * not treated as zero. This is the difference between "we were shut that day"
 * and "we opened and sold nothing" — averaging a closed day in as £0 would
 * drag the baseline down and manufacture a fake win for today. A store that is
 * closed Sundays would otherwise show a permanent Sunday triumph.
 *
 * If the caller genuinely knows a day was open and empty, it passes 0, which
 * IS counted. The distinction is the caller's to make and this module honours
 * whichever it is handed.
 */
export function combineBaseline(
  values: (number | null)[],
  mode: "single" | "average" | "max",
): BaselineResult {
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const daysRequested = values.length;
  const daysWithData = present.length;
  const partial = daysWithData < daysRequested;

  if (daysWithData === 0) {
    return { value: null, daysWithData: 0, daysRequested, partial: daysRequested > 0 };
  }
  if (mode === "single") {
    return { value: present[0], daysWithData, daysRequested, partial };
  }
  if (mode === "max") {
    return { value: Math.max(...present), daysWithData, daysRequested, partial };
  }
  const sum = present.reduce((a, b) => a + b, 0);
  // Integer cents in, integer cents out — a fractional cent baseline would
  // render as $12.3456 somewhere downstream.
  return { value: Math.round(sum / daysWithData), daysWithData, daysRequested, partial };
}

/**
 * Honest suffix describing how thin a baseline turned out to be, or "" when
 * it is exactly what was advertised. Rendered next to the delta so a 4-week
 * average built from one week cannot masquerade as four.
 */
export function baselineQualifier(r: BaselineResult): string {
  if (r.value === null) return "no baseline data";
  if (!r.partial) return "";
  if (r.daysRequested === 1) return "";
  return `${r.daysWithData} of ${r.daysRequested} days had data`;
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runComparisonBasisCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`comparison-basis-core: ${msg}`);
    passed += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) => {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa !== sb) throw new Error(`comparison-basis-core: ${msg} (got ${sa}, want ${sb})`);
    passed += 1;
  };

  // ── Parsing never throws and never guesses ────────────────────────────────
  eq(parseComparisonBasis("yesterday"), "yesterday", "exact id parses");
  eq(parseComparisonBasis("  DOW_AVERAGE_4 "), "dow_average_4", "trimmed + case-insensitive");
  eq(parseComparisonBasis("nonsense"), DEFAULT_BASIS, "unknown falls back to default");
  eq(parseComparisonBasis(""), DEFAULT_BASIS, "empty falls back");
  eq(parseComparisonBasis(null), DEFAULT_BASIS, "null falls back");
  eq(parseComparisonBasis(undefined), DEFAULT_BASIS, "undefined falls back");
  eq(parseComparisonBasis(7), DEFAULT_BASIS, "number falls back");
  eq(parseComparisonBasis("dow_average"), DEFAULT_BASIS, "near-miss is NOT guessed into a real basis");

  // ── Day arithmetic ────────────────────────────────────────────────────────
  eq(shiftYmd("2026-01-01", -1), "2025-12-31", "shift crosses new year backwards");
  eq(shiftYmd("2026-03-01", -1), "2026-02-28", "non-leap February end");
  eq(shiftYmd("2024-03-01", -1), "2024-02-29", "leap day is real");
  eq(shiftYmd("2026-09-06", -7), "2026-08-30", "week back crosses month");
  eq(shiftYmd("2026-09-06", 0), "2026-09-06", "zero shift is identity");
  ok(isYmd("2026-09-06"), "valid ymd accepted");
  ok(!isYmd("2026-02-30"), "impossible date rejected");
  ok(!isYmd("2026-13-01"), "month 13 rejected");
  ok(!isYmd("26-09-06"), "short year rejected");
  ok(!isYmd(""), "empty rejected");
  ok(!isYmd(20260906), "number rejected");

  // DST: Nov 1 2026 is a Pacific fall-back Sunday. Day keys are calendar
  // labels, so the day before must be Oct 31 with no 23/25-hour weirdness.
  eq(shiftYmd("2026-11-01", -1), "2026-10-31", "fall-back Sunday shifts cleanly");
  eq(shiftYmd("2026-03-08", -1), "2026-03-07", "spring-forward Sunday shifts cleanly");

  // ── Weekday naming ────────────────────────────────────────────────────────
  eq(weekdayName("2026-09-06"), "Sunday", "2026-09-06 is a Sunday");
  eq(weekdayName("2026-09-07"), "Monday", "2026-09-07 is a Monday");
  eq(ymdWeekday("2026-09-06"), 0, "Sunday is 0");

  // ── RULE 1: today is NEVER in its own baseline ────────────────────────────
  const TODAY = "2026-09-06"; // a Sunday
  for (const b of COMPARISON_BASES) {
    const w = comparisonWindowFor(b.id, TODAY);
    ok(!w.days.includes(TODAY), `${b.id}: today excluded from its own baseline`);
    ok(w.days.length > 0, `${b.id}: baseline is not empty`);
    ok(
      w.days.every((d) => d < TODAY),
      `${b.id}: every baseline day is strictly before today`,
    );
  }

  // ── Weekday-locked bases really stay on the weekday ───────────────────────
  for (const id of ["same_day_last_week", "dow_average_4", "dow_average_12", "same_day_last_month", "same_day_last_year", "best_same_dow"] as const) {
    const w = comparisonWindowFor(id, TODAY);
    ok(
      w.days.every((d) => ymdWeekday(d) === ymdWeekday(TODAY)),
      `${id}: every baseline day shares today's weekday`,
    );
  }

  // The specific trap: 365 days would drift the weekday, 364 does not.
  eq(comparisonWindowFor("same_day_last_year", TODAY).days, ["2025-09-07"], "a year back is 364 days, same weekday");
  eq(ymdWeekday("2025-09-07"), 0, "and that day really is a Sunday");

  eq(comparisonWindowFor("yesterday", TODAY).days, ["2026-09-05"], "yesterday is one day");
  eq(comparisonWindowFor("same_day_last_week", TODAY).days, ["2026-08-30"], "last week same day");
  eq(comparisonWindowFor("dow_average_4", TODAY).days.length, 4, "4-week dow avg asks for 4 days");
  eq(comparisonWindowFor("dow_average_12", TODAY).days.length, 12, "12-week dow avg asks for 12 days");
  eq(comparisonWindowFor("trailing_7_avg", TODAY).days.length, 7, "trailing 7 asks for 7 days");
  eq(comparisonWindowFor("trailing_28_avg", TODAY).days.length, 28, "trailing 28 asks for 28 days");
  eq(
    comparisonWindowFor("trailing_7_avg", TODAY).days[0],
    "2026-09-05",
    "trailing window starts at yesterday, not today",
  );
  eq(comparisonWindowFor("same_day_last_month", TODAY).days, ["2026-08-09"], "four weeks back stays Sunday");

  // Trailing windows are consecutive with no gaps or repeats.
  const t7 = comparisonWindowFor("trailing_7_avg", TODAY).days;
  eq(new Set(t7).size, 7, "trailing 7 has no duplicate days");
  eq(t7[6], "2026-08-30", "trailing 7 ends 7 days back");

  // ── Labels are weekday-aware, not generic ────────────────────────────────
  ok(
    comparisonWindowFor("dow_average_4", TODAY).comparisonLabel.includes("Sunday"),
    "dow average label names the actual weekday",
  );
  ok(
    comparisonWindowFor("yesterday", TODAY).comparisonLabel === "vs yesterday",
    "yesterday keeps its familiar wording",
  );
  for (const b of COMPARISON_BASES) {
    const w = comparisonWindowFor(b.id, TODAY);
    ok(w.paceNote.includes("still in progress"), `${b.id}: pace note warns today is partial`);
    ok(w.label.length > 0 && w.comparisonLabel.length > 0, `${b.id}: has labels`);
  }

  // Every catalogued basis is reachable by parsing its own id, and the
  // catalogue has no duplicate ids.
  eq(new Set(COMPARISON_BASES.map((b) => b.id)).size, COMPARISON_BASES.length, "basis ids are unique");
  for (const b of COMPARISON_BASES) {
    eq(parseComparisonBasis(b.id), b.id, `${b.id} round-trips through the parser`);
    eq(basisSpec(b.id).id, b.id, `${b.id} resolves its own spec`);
    eq(comparisonWindowFor(b.id, TODAY).mode, b.mode, `${b.id} window mode matches spec`);
  }

  // allBaselineDays covers every basis so one fetch can serve the selector.
  const all = allBaselineDays(TODAY);
  for (const b of COMPARISON_BASES) {
    for (const d of comparisonWindowFor(b.id, TODAY).days) {
      ok(all.includes(d), `allBaselineDays covers ${b.id} day ${d}`);
    }
  }
  ok(!all.includes(TODAY), "allBaselineDays never includes today");
  eq(new Set(all).size, all.length, "allBaselineDays is de-duplicated");

  // ── combineBaseline ───────────────────────────────────────────────────────
  eq(combineBaseline([100], "single").value, 100, "single takes the one value");
  eq(combineBaseline([100, 200, 300], "single").value, 100, "single takes the FIRST (most recent)");
  eq(combineBaseline([100, 200, 300], "average").value, 200, "average is the mean");
  eq(combineBaseline([100, 200, 300], "max").value, 300, "max takes the best");
  eq(combineBaseline([], "average").value, null, "no values yields null, not 0");
  eq(combineBaseline([null, null], "average").value, null, "all-null yields null, not 0");

  // THE CLOSED-DAY RULE: nulls are dropped, never averaged in as zero.
  const closedSundays = combineBaseline([null, 1000, null, 2000], "average");
  eq(closedSundays.value, 1500, "closed days are dropped, not counted as 0");
  eq(closedSundays.daysWithData, 2, "only days with data are counted");
  eq(closedSundays.daysRequested, 4, "requested count is preserved for honesty");
  ok(closedSundays.partial, "a thinned baseline is flagged partial");

  // A real zero IS counted — "open and sold nothing" is a fact, not a gap.
  const openButEmpty = combineBaseline([0, 1000], "average");
  eq(openButEmpty.value, 500, "a genuine 0 is averaged in");
  eq(openButEmpty.daysWithData, 2, "a genuine 0 counts as data");
  ok(!openButEmpty.partial, "a full baseline is not flagged partial");

  // Rounding stays in whole cents.
  eq(combineBaseline([100, 101], "average").value, 101, "average rounds to whole cents");
  eq(combineBaseline([1, 2], "average").value, 2, "0.5 rounds up, never fractional");
  ok(Number.isInteger(combineBaseline([1, 1, 1], "average").value!), "average is an integer");

  // Non-finite garbage is dropped rather than poisoning the mean with NaN.
  eq(combineBaseline([Number.NaN, 100], "average").value, 100, "NaN dropped from average");
  eq(combineBaseline([Number.POSITIVE_INFINITY, 100], "average").value, 100, "Infinity dropped");

  // ── baselineQualifier is honest ───────────────────────────────────────────
  eq(baselineQualifier(combineBaseline([100, 200], "average")), "", "complete baseline needs no caveat");
  eq(
    baselineQualifier(combineBaseline([null, 200, null, null], "average")),
    "1 of 4 days had data",
    "thin baseline says exactly how thin",
  );
  eq(baselineQualifier(combineBaseline([], "average")), "no baseline data", "empty says so plainly");
  eq(baselineQualifier(combineBaseline([null], "single")), "no baseline data", "missing single day says so");

  return { passed };
}
