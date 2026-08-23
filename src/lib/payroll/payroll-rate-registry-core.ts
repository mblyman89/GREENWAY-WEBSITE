/**
 * src/lib/payroll/payroll-rate-registry-core.ts  (books-15)
 *
 * EVERY PAYROLL RATE, AS A DATED FACT WITH A RECEIPT.
 *
 * Michael's ask, verbatim: "rates change often and we will need a clever way to
 * update the system when they change."
 *
 * The clever way is boring on purpose: there are NO RATE CONSTANTS anywhere in
 * the payroll engine. A rate is a ROW. Every row carries the date range it is
 * good for, the authority that set it, and the document it was read off. You
 * look a rate up BY THE DATE OF THE PAY PERIOD, never by "current."
 *
 * WHY NOT JUST A CONSTANT? Because we can prove constants fail here. Three
 * separate cadences are in play at once, all verified this session from primary
 * sources:
 *
 *   PFML      changes ANNUALLY. ESD: "the Employment Security Department
 *             recalculates the premium rate annually in October." It went from
 *             0.92% (2025) to 1.13% (2026) - a 22.8% jump in one year. Anyone
 *             holding 0.92% in a constant under-withheld every single 2026
 *             paycheck and would not find out until a reconciliation.
 *
 *   WA Cares  changes BIENNIALLY, and the law changed WHO SETS IT effective
 *             2026-01-01. RCW 50B.04.080(1): "Beginning January 1, 2026, and
 *             biennially thereafter, the premium rate shall be set by the
 *             pension funding council at a rate no greater than .58 percent."
 *             Note that is a CEILING, not a fixed rate.
 *
 *   L&I/SUTA  change ANNUALLY and PER EMPLOYER. There is no public number to
 *             fall back on; the State computes Michael's own rate from his own
 *             history and mails it. Deriving it is not possible, so guessing is
 *             the only alternative, and guessing is forbidden.
 *
 * THE FAILURE MODE THIS FILE EXISTS TO PREVENT is not "wrong rate." It is
 * "STALE rate that still looks right." A wrong rate gets caught. A rate that
 * was correct last year produces arithmetic that reconciles perfectly against
 * itself and is silently wrong against the State. So:
 *
 *   - A lookup whose date falls in a GAP REFUSES. It does not fall back to the
 *     most recent row. (Rule 14: make the wrong thing impossible.)
 *   - A registry with OVERLAPPING rows for one rate is a defect and is rejected
 *     at construction, not at lookup. Two rows covering one day means the answer
 *     depends on iteration order, which is the definition of a silent bug.
 *   - Every row needs a document id. A rate nobody can point at a piece of paper
 *     for is not evidence, it is a memory. (Rule 11.)
 *
 * UNITS. Rates are integers, never floats (Rule 13e):
 *   - milli-percent   = percent x 1000.        100% = 100_000.  1.13% = 1_130.
 *   - milli-cents/hr  = one cent x 1000.       $1.00/hr = 100_000.
 * L&I is the reason for the second unit: the State quotes $0.16445/hr, which
 * integer cents physically cannot hold.
 *
 * DATES are ISO "YYYY-MM-DD" strings compared lexicographically. That is exact
 * for this format, needs no timezone, and cannot drift the way Date objects do
 * when a server runs in UTC and a pay period is local. `effectiveTo` is
 * INCLUSIVE, because that is how humans read "this rate is good through
 * December 31."
 *
 * PURE DATA + PURE FUNCTIONS. No I/O. No server imports.
 */

// ---------------------------------------------------------------------------
// 1) TYPES
// ---------------------------------------------------------------------------

/**
 * Which levy a row describes. Deliberately explicit rather than a free string:
 * a typo in a rate key is exactly the `GRWNY`/`GRNWY` class of bug that hid 18
 * live accounts in Michael's Sage file (Rule 19).
 */
/**
 * NOTE ON WHAT IS DELIBERATELY ABSENT.
 *
 * There is no `pfml_wage_base` key, and that is not an oversight. RCW
 * 50A.10.030(4) does not state a Paid Leave ceiling - it POINTS AT the Social
 * Security one: the commissioner "must annually set a maximum limit ... that is
 * equal to the maximum wages subject to taxation for social security as
 * determined by the social security administration." Because the statute makes
 * the two numbers legally identical, storing them separately would create two
 * places to update and exactly one of them would get updated. Paid Leave reads
 * `fica_oasdi_wage_base`.
 *
 * There is likewise no `wa_cares_wage_base`. WA Cares has NO CAP AT ALL. An
 * absent row would refuse (correct); a row copied from PFML would silently
 * under-withhold every high earner (catastrophic). So the key does not exist.
 */
export type PayrollRateKey =
  | "pfml_total"
  | "pfml_employee_share_of_total"
  | "pfml_employer_share_of_total"
  | "wa_cares_total"
  | "wa_suta_total"
  /**
   * THE UNEMPLOYMENT TAX RATE PROPER, ON ITS OWN.
   *
   * WHY THIS EXISTS SEPARATELY FROM `wa_suta_total` (books-41).
   *
   * `wa_suta_total` carries 0.40%, which is 0.37% unemployment insurance plus
   * the 0.03% Employment Administration Fund surcharge, and its note used to
   * say the EAF "is not separately reportable, so the total is what gets
   * applied". Greenway's filed Q2 2026 return says otherwise on both counts.
   * It reports the two as SEPARATE LINES - UI $255.02 and EAF $20.68 - and the
   * two lines are not merely presentational, because each is rounded on its
   * own:
   *
   *   0.37% of 68,923.45 = 255.016765 -> 255.02
   *   0.03% of 68,923.45 =  20.677035 ->  20.68
   *                                      -------
   *                                       275.70   <- the filed total
   *
   *   0.40% of 68,923.45 = 275.6938   -> 275.69   <- one cent SHORT
   *
   * The single combined rate cannot reproduce the return. That is not a
   * rounding nicety: RCW 50.24.010 and RCW 50.24.014(2)(b) each separately
   * command half-cent rounding on "any contributions" under that section, so
   * the law itself requires two roundings, and doing one produces a figure the
   * State did not assess.
   *
   * `wa_suta_total` is KEPT rather than deleted, because the readiness screen
   * and the onboarding screen both quote a single headline rate off the ESD
   * notice and that is a real thing the notice prints. It is now guarded by
   * `findSutaComponentViolations`, which insists the parts equal the whole.
   */
  | "wa_suta_ui"
  /**
   * The Employment Administration Fund surcharge, on its own.
   *
   * NOT one account but two, stacked, and the statute never states the sum.
   * RCW 50.24.014(1)(a) sets "a basic rate of two one-hundredths of one
   * percent" and RCW 50.24.014(1)(b) sets "a basic rate of one one-hundredth
   * of one percent". 0.02% + 0.01% = 0.03%, which is the figure that
   * reproduces the filed EAF exactly. The arithmetic is done here, once, in
   * the open, rather than left as a number nobody can trace to a statute.
   */
  | "wa_suta_eaf"
  | "wa_suta_wage_base"
  | "lni_employee_rate"
  | "lni_employer_rate"
  | "fica_oasdi_wage_base"
  | "wa_minimum_wage"
  /**
   * The FEDERAL minimum hourly wage. Distinct from `wa_minimum_wage`, and the
   * two are never interchangeable.
   *
   * WHY BOTH EXIST. 15 U.S.C. 1673(a)(2) measures the federal garnishment floor
   * against thirty times the FEDERAL wage; RCW 6.27.150 measures Washington's
   * against thirty-five times the STATE wage. Washington's is more than double
   * the federal one, so the state floor almost always binds at Greenway — but
   * "almost always" is not a rule the software may assume, so both are supplied
   * and the garnishment engine decides which governs.
   *
   * Added in books-37 after running the assembled net-pay chain and watching
   * every garnishment refuse for want of this single number.
   */
  | "federal_minimum_wage";

export const ALL_PAYROLL_RATE_KEYS: readonly PayrollRateKey[] = [
  "pfml_total",
  "pfml_employee_share_of_total",
  "pfml_employer_share_of_total",
  "wa_cares_total",
  "wa_suta_total",
  "wa_suta_ui",
  "wa_suta_eaf",
  "wa_suta_wage_base",
  "lni_employee_rate",
  "lni_employer_rate",
  "fica_oasdi_wage_base",
  "wa_minimum_wage",
  "federal_minimum_wage",
];

/**
 * What the integer in `value` actually means. Getting this wrong is the single
 * most dangerous mistake available here, because 1_130 is a perfectly plausible
 * number in every one of these units and none of them agree.
 */
export type PayrollRateUnit =
  /** percent x 1000. 1.13% = 1_130. 100% = 100_000. */
  | "milli_percent"
  /** one cent x 1000. $0.16445/hr = 16_445. */
  | "milli_cents_per_hour"
  /** whole cents. $78,200.00 = 7_820_000. */
  | "cents";

export type PayrollRateRow = {
  key: PayrollRateKey;
  /** Inclusive ISO date "YYYY-MM-DD" the rate starts applying. */
  effectiveFrom: string;
  /**
   * INCLUSIVE ISO date the rate stops applying, or null for "still in force."
   * Inclusive because that is how the agencies write it and how Michael reads
   * it. An exclusive end date here would be a one-day-a-year bug.
   */
  effectiveTo: string | null;
  value: number;
  unit: PayrollRateUnit;
  /** Authority record id in payroll-tax-authorities.ts. Never blank. */
  authorityId: string;
  /**
   * The piece of paper. A rate notice id, a news release, a statute cite.
   * Rule 11: opening facts come from evidence, not from memory.
   */
  documentId: string;
  /** Plain English, for Michael and for the future concierge. */
  note: string;
};

export type RateLookupRefusalCode =
  | "rate_not_evidenced_for_date"
  | "rate_registry_overlap"
  | "rate_registry_malformed";

export type RateLookupRefusal = {
  code: RateLookupRefusalCode;
  /** What Michael reads. Plain English, no jargon, no blame. */
  message: string;
  /** The single concrete action that unblocks it. */
  whatToDo: string;
  authorityId: string | null;
};

export type RateLookup<T> = { ok: true; value: T } | { ok: false; refusal: RateLookupRefusal };

// ---------------------------------------------------------------------------
// 2) VALIDATION
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date in "YYYY-MM-DD".
 *
 * The round-trip through Date is what catches 2026-02-30 and 2025-02-29, which
 * a regex alone happily accepts. Rule 13f asks for leap-day handling explicitly,
 * and a payroll system that accepts February 30th will eventually be asked to
 * pay someone on it.
 */
export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map((p) => Number(p));
  if (!y || !m || !d) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/**
 * Structural check on one row. Returns a human-readable problem or null.
 *
 * Everything here is a REFUSAL rather than a warning. A malformed rate row is
 * not a cosmetic issue: it is a number that will be multiplied by somebody's
 * wages.
 */
export function validateRateRow(row: PayrollRateRow): string | null {
  if (!ALL_PAYROLL_RATE_KEYS.includes(row.key)) {
    return `unknown rate key "${row.key}"`;
  }
  if (!isValidIsoDate(row.effectiveFrom)) {
    return `${row.key}: effectiveFrom "${row.effectiveFrom}" is not a real YYYY-MM-DD date`;
  }
  if (row.effectiveTo !== null && !isValidIsoDate(row.effectiveTo)) {
    return `${row.key}: effectiveTo "${row.effectiveTo}" is not a real YYYY-MM-DD date`;
  }
  if (row.effectiveTo !== null && row.effectiveTo < row.effectiveFrom) {
    return `${row.key}: effectiveTo "${row.effectiveTo}" is before effectiveFrom "${row.effectiveFrom}"`;
  }
  if (!Number.isInteger(row.value)) {
    // Rule 13e. A float here is how 1.13% becomes 1.1299999999999999.
    return `${row.key}: value ${row.value} must be an integer (floats are forbidden in money paths)`;
  }
  if (row.value < 0) {
    return `${row.key}: value ${row.value} cannot be negative`;
  }
  if (row.unit === "milli_percent" && row.value > 100_000) {
    // 100_000 milli-percent = 100%. Anything above is a units mistake, and the
    // most likely one: someone entering 1.13 as 113_000 instead of 1_130.
    return `${row.key}: ${row.value} milli-percent is over 100% - check the units`;
  }
  if (row.authorityId.trim().length === 0) {
    return `${row.key}: authorityId is blank - every rate must cite the law that set it`;
  }
  if (row.documentId.trim().length === 0) {
    return `${row.key}: documentId is blank - every rate must point at the paper it was read from`;
  }
  if (row.note.trim().length === 0) {
    return `${row.key}: note is blank - Michael has to be able to read this`;
  }
  return null;
}

/**
 * Finds rows of the same key whose date ranges touch.
 *
 * WHY THIS IS A HARD ERROR AND NOT A WARNING: if two rows cover one day, the
 * answer depends on which one the search happens to hit first. That is a bug
 * whose output is a plausible number, which is the worst kind. It also hides
 * the most common real-world editing mistake - adding next year's rate without
 * closing out this year's - and that mistake produces a system that quietly
 * keeps using the old rate forever.
 */
export function findRateOverlaps(rows: readonly PayrollRateRow[]): string[] {
  const problems: string[] = [];
  const byKey = new Map<PayrollRateKey, PayrollRateRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.key);
    if (list) list.push(r);
    else byKey.set(r.key, [r]);
  }
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i]!;
      const next = sorted[i + 1]!;
      // An open-ended row followed by anything is always an overlap: "forever"
      // and "starting next year" cannot both be true.
      if (cur.effectiveTo === null) {
        problems.push(
          `${key}: row starting ${cur.effectiveFrom} never ends, but another row starts ${next.effectiveFrom}`,
        );
        continue;
      }
      if (cur.effectiveTo >= next.effectiveFrom) {
        problems.push(
          `${key}: ${cur.effectiveFrom}..${cur.effectiveTo} overlaps ${next.effectiveFrom}..${next.effectiveTo ?? "open"}`,
        );
      }
    }
  }
  return problems;
}

/**
 * HARD LEGAL CEILINGS, taken verbatim from statute.
 *
 * These are not policy preferences or sanity guesses - they are numbers the
 * legislature said the rate MAY NOT EXCEED. A row above one of them is not
 * merely suspicious, it describes something that cannot lawfully happen, which
 * means it is a typo or a units error every single time.
 *
 *   PFML     RCW 50A.10.030(6)(b)(ii): "The total premium rate must not exceed
 *            1.20 percent."  ->  1_200 milli-percent.
 *
 *   WA Cares RCW 50B.04.080(1): "Beginning January 1, 2026, and biennially
 *            thereafter, the premium rate shall be set by the pension funding
 *            council at a rate no greater than .58 percent."  ->  580.
 *
 *   SUTA     RCW 50.29.025 caps the experience-rate component at 5.4%, but the
 *            total an employer actually pays also carries the social-cost tax
 *            and the 0.03% Employment Administration Fund surcharge, so there
 *            is no single statutory number for the TOTAL. Deliberately absent:
 *            inventing a ceiling would be exactly the assumption Rule 1 forbids.
 *
 *   L&I      Set per risk class by rule, not capped by statute. Absent for the
 *            same reason.
 *
 * A ceiling is only asserted where a statute states one. Silence in this map
 * means the law is silent, never that the check was forgotten.
 */
export const STATUTORY_RATE_CEILINGS_MILLI_PERCENT: Partial<
  Record<PayrollRateKey, { ceiling: number; cite: string }>
> = {
  pfml_total: { ceiling: 1_200, cite: "RCW 50A.10.030(6)(b)(ii)" },
  wa_cares_total: { ceiling: 580, cite: "RCW 50B.04.080(1)" },
};

/**
 * Rows that exceed a ceiling the legislature actually wrote down.
 *
 * Catches the realistic disaster: someone reading "1.13%" off a notice and
 * typing 11_300 instead of 1_130. That is 11.3% - ten times the real premium,
 * still under the generic 100% guard, and it would sail straight into a
 * paycheck. The statutory ceiling stops it at construction.
 */
export function findCeilingViolations(rows: readonly PayrollRateRow[]): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    const limit = STATUTORY_RATE_CEILINGS_MILLI_PERCENT[r.key];
    if (!limit) continue;
    if (r.unit !== "milli_percent") continue;
    if (r.value > limit.ceiling) {
      problems.push(
        `${r.key}: ${r.value} milli-percent starting ${r.effectiveFrom} exceeds the statutory ` +
          `maximum of ${limit.ceiling} (${limit.cite}). A rate above the legal cap is a typo or a ` +
          `units error, not a rate.`,
      );
    }
  }
  return problems;
}

/**
 * The PFML employee and employer shares must add to exactly 100% on every day
 * both are on file.
 *
 * ESD publishes them as a pair - 71.43% and 28.57% - and they are shares OF THE
 * PREMIUM. If someone updates one in a future year and forgets the other, the
 * split silently stops summing to the whole premium and Greenway either
 * over-collects from staff or under-remits to the State. Neither shows up as an
 * error anywhere else in the system, so it is checked here, at construction.
 */
export function findShareSumViolations(rows: readonly PayrollRateRow[]): string[] {
  const problems: string[] = [];
  const ee = rows.filter((r) => r.key === "pfml_employee_share_of_total");
  const er = rows.filter((r) => r.key === "pfml_employer_share_of_total");
  for (const a of ee) {
    for (const b of er) {
      // Do the two rows share any day at all?
      const start = a.effectiveFrom > b.effectiveFrom ? a.effectiveFrom : b.effectiveFrom;
      const aEnd = a.effectiveTo;
      const bEnd = b.effectiveTo;
      const end =
        aEnd === null ? bEnd : bEnd === null ? aEnd : aEnd < bEnd ? aEnd : bEnd;
      if (end !== null && end < start) continue; // no shared day
      if (a.value + b.value !== 100_000) {
        problems.push(
          `pfml shares: employee ${a.value} + employer ${b.value} = ${a.value + b.value} ` +
            `milli-percent on ${start}, but the two shares of one premium must total exactly ` +
            `100_000 (100%).`,
        );
      }
    }
  }
  return problems;
}

/**
 * The two unemployment components must add to exactly the headline total on
 * every day all three are on file.
 *
 * WHY THIS IS NOT THE SAME CHECK AS `findShareSumViolations` (books-41).
 *
 * That one asserts two SHARES sum to 100% of a premium. This one asserts two
 * RATES ON WAGES sum to a third rate on wages. They are different arithmetic
 * with a different failure mode, and merging them would force one function to
 * mean two things.
 *
 * WHY IT MATTERS ENOUGH TO CHECK. The ESD notice prints all three numbers, and
 * a human copying them in has three chances to fumble one. If the parts stop
 * agreeing with the whole, nothing else in the system notices: the return would
 * be built from the components and the readiness screens would quote the total,
 * so Michael would be shown one rate and would file another. That is precisely
 * the class of defect that survives a green test suite, so it is caught at
 * construction where it cannot be ignored.
 *
 * Deliberately silent when any of the three is missing. An absent row is
 * already handled - a lookup for it refuses loudly - and reporting it twice
 * would train the reader to skim these messages.
 */
export function findSutaComponentViolations(rows: readonly PayrollRateRow[]): string[] {
  const problems: string[] = [];
  const totals = rows.filter((r) => r.key === "wa_suta_total" && r.unit === "milli_percent");
  const uis = rows.filter((r) => r.key === "wa_suta_ui" && r.unit === "milli_percent");
  const eafs = rows.filter((r) => r.key === "wa_suta_eaf" && r.unit === "milli_percent");

  for (const total of totals) {
    for (const ui of uis) {
      for (const eaf of eafs) {
        // The latest start and the earliest end of the three ranges. If the
        // window is empty, these rows never coexist and there is nothing to say.
        let start = total.effectiveFrom;
        if (ui.effectiveFrom > start) start = ui.effectiveFrom;
        if (eaf.effectiveFrom > start) start = eaf.effectiveFrom;

        let end: string | null = total.effectiveTo;
        for (const candidate of [ui.effectiveTo, eaf.effectiveTo]) {
          if (candidate === null) continue;
          if (end === null || candidate < end) end = candidate;
        }
        if (end !== null && end < start) continue; // never overlap

        if (ui.value + eaf.value !== total.value) {
          problems.push(
            `wa unemployment components: UI ${ui.value} + EAF ${eaf.value} = ` +
              `${ui.value + eaf.value} milli-percent on ${start}, but wa_suta_total says ` +
              `${total.value}. The parts must equal the whole, or the return is built from one ` +
              `rate while the screens quote another.`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * Reports date ranges where a key has NO row between its first and last.
 *
 * Deliberately NOT an error. A gap is legitimate - Michael was not an employer
 * before he hired anyone, and WA Cares premiums genuinely did not exist before
 * 2023-07-01. What matters is that a lookup INTO a gap refuses loudly rather
 * than reaching for the nearest row. This function exists so the UI can show
 * him where the holes are before he runs payroll into one.
 */
export function findRateGaps(rows: readonly PayrollRateRow[]): string[] {
  const gaps: string[] = [];
  const byKey = new Map<PayrollRateKey, PayrollRateRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.key);
    if (list) list.push(r);
    else byKey.set(r.key, [r]);
  }
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i]!;
      const next = sorted[i + 1]!;
      if (cur.effectiveTo === null) continue; // overlap check owns this case
      const dayAfter = addOneDay(cur.effectiveTo);
      if (dayAfter < next.effectiveFrom) {
        gaps.push(`${key}: nothing covers ${dayAfter} through ${addDays(next.effectiveFrom, -1)}`);
      }
    }
  }
  return gaps;
}

/** Calendar-correct day arithmetic on an ISO date string. Leap years included. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((p) => Number(p));
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  const yy = dt.getUTCFullYear().toString().padStart(4, "0");
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addOneDay(iso: string): string {
  return addDays(iso, 1);
}

// ---------------------------------------------------------------------------
// 3) THE REGISTRY
// ---------------------------------------------------------------------------

/**
 * A validated set of rate rows.
 *
 * Construction validates. Lookup does not, because a registry that could be
 * invalid at lookup time would force every caller to handle a case that should
 * have been impossible three layers earlier.
 */
export class PayrollRateRegistry {
  private readonly rows: readonly PayrollRateRow[];

  private constructor(rows: readonly PayrollRateRow[]) {
    this.rows = rows;
  }

  /**
   * Builds a registry, or explains exactly what is wrong with the input.
   *
   * Throws rather than returning a partial registry. There is no useful
   * "mostly valid" state for a table of tax rates.
   */
  static create(rows: readonly PayrollRateRow[]): PayrollRateRegistry {
    const problems: string[] = [];
    for (const r of rows) {
      const p = validateRateRow(r);
      if (p) problems.push(p);
    }
    problems.push(...findRateOverlaps(rows));
    problems.push(...findCeilingViolations(rows));
    problems.push(...findShareSumViolations(rows));
    problems.push(...findSutaComponentViolations(rows));
    if (problems.length > 0) {
      throw new Error(
        `PayrollRateRegistry: ${problems.length} problem(s) in the rate table\n  - ${problems.join("\n  - ")}`,
      );
    }
    return new PayrollRateRegistry([...rows]);
  }

  /** Every row, for display and for reconciliation. */
  all(): readonly PayrollRateRow[] {
    return this.rows;
  }

  /** Every row for one levy, oldest first. This is the audit trail Michael shows. */
  history(key: PayrollRateKey): readonly PayrollRateRow[] {
    return this.rows
      .filter((r) => r.key === key)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  }

  /**
   * THE ONLY WAY TO GET A RATE.
   *
   * There is deliberately no `current()`, no `latest()`, and no default. Those
   * three functions are how a payroll system computes a 2025 paycheck with 2026
   * rates during a January catch-up run, and they are how a corrected prior
   * quarter gets recomputed with numbers that never applied to it.
   *
   * A date with no row REFUSES (Rule 14). It does not reach for the nearest row.
   */
  lookup(key: PayrollRateKey, onIsoDate: string): RateLookup<PayrollRateRow> {
    if (!isValidIsoDate(onIsoDate)) {
      return {
        ok: false,
        refusal: {
          code: "rate_registry_malformed",
          message:
            `I was asked for the ${describeKey(key)} on "${onIsoDate}", but that is not a real ` +
            `calendar date, so I cannot tell which rate applied.`,
          whatToDo: "Give the date as YYYY-MM-DD, for example 2026-03-15.",
          authorityId: null,
        },
      };
    }

    const hit = this.rows.find(
      (r) =>
        r.key === key &&
        r.effectiveFrom <= onIsoDate &&
        (r.effectiveTo === null || onIsoDate <= r.effectiveTo),
    );

    if (!hit) {
      const known = this.history(key);
      const coverage =
        known.length === 0
          ? "I have no rate on file for it at all."
          : `What I do have on file: ${known
              .map((r) => `${r.effectiveFrom} to ${r.effectiveTo ?? "open-ended"}`)
              .join("; ")}.`;
      return {
        ok: false,
        refusal: {
          code: "rate_not_evidenced_for_date",
          message:
            `I do not have an evidenced ${describeKey(key)} covering ${onIsoDate}. ${coverage} ` +
            `I am refusing rather than reusing the closest one, because a stale rate produces a ` +
            `paycheck that adds up perfectly and is still wrong against the State.`,
          whatToDo:
            `Add the ${describeKey(key)} that was in force on ${onIsoDate}, with the notice or ` +
            `news release it came from. Until then this pay period cannot be computed.`,
          authorityId: null,
        },
      };
    }

    return { ok: true, value: hit };
  }

  /**
   * Convenience wrapper that also proves the unit is what the caller expects.
   *
   * This exists because the most dangerous bug in this whole file is a unit
   * mix-up: every one of these rates is a small integer and 1_130 is plausible
   * as milli-percent, as cents, and as milli-cents per hour. Asking callers to
   * state the unit they want turns a silent 1000x error into a refusal.
   */
  lookupValue(
    key: PayrollRateKey,
    onIsoDate: string,
    expectUnit: PayrollRateUnit,
  ): RateLookup<number> {
    const row = this.lookup(key, onIsoDate);
    if (!row.ok) return row;
    if (row.value.unit !== expectUnit) {
      return {
        ok: false,
        refusal: {
          code: "rate_registry_malformed",
          message:
            `The ${describeKey(key)} on file for ${onIsoDate} is recorded in ${row.value.unit}, but ` +
            `the calculation asked for ${expectUnit}. I stopped instead of converting, because ` +
            `guessing at units is how a rate ends up a thousand times too big.`,
          whatToDo:
            `Check the unit on the ${describeKey(key)} row starting ${row.value.effectiveFrom}.`,
          authorityId: row.value.authorityId,
        },
      };
    }
    return { ok: true, value: row.value.value };
  }
}

/** Plain-English name for a rate key. Used in every refusal message. */
export function describeKey(key: PayrollRateKey): string {
  switch (key) {
    case "pfml_total":
      return "WA Paid Leave total premium rate";
    case "pfml_employee_share_of_total":
      return "WA Paid Leave employee share of the premium";
    case "pfml_employer_share_of_total":
      return "WA Paid Leave employer share of the premium";
    case "wa_cares_total":
      return "WA Cares premium rate";
    case "wa_suta_total":
      return "WA unemployment tax rate";
    case "wa_suta_ui":
      return "WA unemployment insurance rate";
    case "wa_suta_eaf":
      return "WA Employment Administration Fund surcharge";
    case "wa_suta_wage_base":
      return "WA unemployment wage base";
    case "lni_employee_rate":
      return "L&I employee hourly rate";
    case "lni_employer_rate":
      return "L&I employer hourly rate";
    case "fica_oasdi_wage_base":
      return "Social Security wage base";
    case "wa_minimum_wage":
      return "Washington minimum wage";
    case "federal_minimum_wage":
      // Said as "federal", explicitly, because the refusal message this feeds
      // is read next to the Washington one and the two floors are different
      // statutes with different multipliers. "Minimum wage" alone would leave
      // Michael guessing which of the two is missing.
      return "federal minimum wage";
  }
}
