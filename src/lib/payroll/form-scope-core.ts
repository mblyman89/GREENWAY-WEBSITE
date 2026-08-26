/**
 * src/lib/payroll/form-scope-core.ts   (books-63)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE ANSWER TO "WHICH PERIOD, WHOSE FIGURES?" FOR EVERY FORM PAGE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Michael:
 *
 *   "Also, if not already being done, sorting and filtering per period/
 *    employee/ qtr/ yr, etc would be really handy on the forms pages in some
 *    way. I am not sure the smart industry standard or professional way to do
 *    it. Our system is set up a little different with regard to the books and
 *    forms. We have the main page with all the learning lessons and main
 *    functions and such, then we have a button to go to the physical form pages.
 *    Please make sure you are building these features so I can sort and filter
 *    that works with the full form workflow and all its tabs and pages."
 *
 * The last sentence is the requirement, and it is the one an ad-hoc picker fails.
 * "Works with the full form workflow and all its tabs and pages" means the answer
 * to "which quarter?" must survive walking from the tabbed 941 to the 941 on
 * paper and back, and must mean the same thing on both.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE MEASUREMENT THAT DECIDED THE DESIGN
 * ──────────────────────────────────────────────────────────────────────────────
 * Before writing anything, I counted what the six form pages already do. The
 * rule "a form reports a CLOSED period, so today's period is never the default"
 * was written out SIX SEPARATE TIMES:
 *
 *     src/app/admin/books/form-940/page.tsx:77        mostRecentlyClosedYear
 *     src/app/admin/books/form-w2/page.tsx:179        mostRecentlyClosedYear
 *     src/app/admin/books/form-w2/sheet/page.tsx:111  mostRecentlyClosedYear
 *     src/app/admin/books/form-941/page.tsx:123       mostRecentlyClosedQuarter
 *     src/app/admin/books/form-941/sheet/page.tsx:144 mostRecentlyClosedQuarter
 *     src/app/admin/books/wa-quarterly/page.tsx:159   mostRecentlyClosedQuarter
 *
 * and the VALIDATION of `?year=` was written three different ways: `> 2000 &&
 * < 2100` on the 940, `>= 2020 && <= 2100` on both W-2 screens, `>= 2020 &&
 * <= 2100` on the 941. Three spellings of one rule means at least two of them
 * are wrong, and nobody can say which. That is the whole argument for this file.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY GRAIN IS AN ARGUMENT AND NOT A DEFAULT
 * ──────────────────────────────────────────────────────────────────────────────
 * A 941 reports a QUARTER and a 940 reports a YEAR. If grain defaulted, an
 * annual page would inherit quarter handling by accident and a quarterly page
 * would inherit year handling by omission - and the second of those prints a
 * heading that agrees with itself while showing the wrong three months.
 *
 * So every caller states its grain. There is no default, because there is no
 * grain that is right when nobody has thought about it.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY A REFUSED PARAMETER IS REPORTED AND NOT JUST DROPPED
 * ──────────────────────────────────────────────────────────────────────────────
 * The 941 sheet already had the important half of this right, in its own words:
 *
 *   "Both halves of the quarter must be valid or NEITHER is used. Accepting a
 *    good year with a nonsense quarter would silently show a different period
 *    than the URL asked for, and the heading would agree with itself while
 *    being wrong -- the hardest kind of error to notice."
 *
 * Correct, and still incomplete: it substituted silently. `?year=2025&q=7`
 * showed Q2 2026 with a heading reading "Q2 2026", so the substitution was
 * invisible unless you re-read the URL. On a page whose figures get typed into
 * EFTPS that is not a cosmetic problem.
 *
 * So `readScope` records what it refused. The bar says so out loud.
 */

/** Year or quarter. Stated by the caller; see the docblock above. */
export type ScopeGrain = "year" | "quarter";

export type QuarterNumber = 1 | 2 | 3 | 4;

/**
 * What period, and whose figures, a form page is showing.
 *
 * `quarter` is null exactly when `grain` is "year" - the type cannot express
 * that, so `readScope` guarantees it and a gate pins it.
 */
export type FormScope = {
  readonly grain: ScopeGrain;
  readonly year: number;
  readonly quarter: QuarterNumber | null;
  readonly employee: string | null;
  /** True when nothing usable was supplied and the closed-period default won. */
  readonly defaulted: boolean;
  /** Plain-English descriptions of parameters that were supplied and refused. */
  readonly refused: readonly string[];
};

export type ScopeParams = Readonly<Record<string, string | undefined>>;

/**
 * The earliest year this product will accept on a form.
 *
 * Greenway's books start in 2020 and its first payroll under this system is
 * 1 January 2027. A `?year=1970` is not a period, it is a typo or a probe, and
 * answering it with a blank 1970 form invites somebody to believe in it.
 */
export const SCOPE_MIN_YEAR = 2020;

/**
 * The latest year this product will accept on a form.
 *
 * Not "this year": a 940 for next year is a legitimate thing to look at in
 * December, and pinning the ceiling to the clock would make that a refusal.
 */
export const SCOPE_MAX_YEAR = 2100;

/**
 * How many closed years the year picker offers.
 *
 * FOUR, because that is the retention window the IRS states, quoted verbatim in
 * `IW2W3_2026_WHO_MUST_FILE_W3`: "Make a copy of Form W-3 and a copy of each
 * Form W-2 Copy A (For SSA) to keep for your records for at least 4 years."
 * A picker offering fewer years than he is required to keep would be a picker
 * that cannot reach a year an auditor can ask for.
 */
export const SCOPE_YEAR_COUNT = 4;

/**
 * How many closed quarters the quarter picker offers.
 *
 * EIGHT, carried over from the 941 sheet's own reasoning rather than re-decided:
 * two years is the IRS lookback window that determines whether a business
 * deposits monthly or semiweekly, so anybody checking their deposit schedule
 * needs two years of returns visible at once. `lookbackQuartersFor` in
 * payroll-deposit-schedule-core works on exactly that window.
 */
export const SCOPE_QUARTER_COUNT = 8;

/**
 * An employee id longer than this is not an id.
 *
 * A UUID is 36 characters. This is a bound on what gets echoed into a link and
 * a heading, not a claim about the roster - the core cannot know the roster.
 */
export const SCOPE_MAX_EMPLOYEE_ID_LEN = 64;

/**
 * The most recently CLOSED calendar year.
 *
 * A form reports a finished period, so on 3 March 2027 the W-2 a person wants is
 * the 2026 one. Was written out three times before this file existed.
 */
export function mostRecentlyClosedYear(now: Date): number {
  return now.getUTCFullYear() - 1;
}

/**
 * The most recently CLOSED calendar quarter.
 *
 * On 5 May the return a person wants is Q1's. Was written out three times before
 * this file existed, in two different files that had to agree and could not.
 */
export function mostRecentlyClosedQuarter(now: Date): {
  readonly year: number;
  readonly quarter: QuarterNumber;
} {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  if (q === 1) return { year: y - 1, quarter: 4 };
  return { year: y, quarter: (q - 1) as QuarterNumber };
}

/** A year that could name a form period, or null. Shared by every caller. */
function parseYear(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  if (!/^[0-9]{4}$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  if (n < SCOPE_MIN_YEAR || n > SCOPE_MAX_YEAR) return null;
  return n;
}

/** A quarter number, or null. `/^[1-4]$/` and nothing else: "01" is a typo. */
function parseQuarter(raw: string | undefined): QuarterNumber | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  if (!/^[1-4]$/.test(t)) return null;
  return Number.parseInt(t, 10) as QuarterNumber;
}

/**
 * An employee id, or null.
 *
 * Deliberately NOT validated against a roster: this module is pure and has no
 * database. The caller matches it and reports a miss - see `scopeNotice`.
 */
function parseEmployee(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  if (t === "") return null;
  if (t.length > SCOPE_MAX_EMPLOYEE_ID_LEN) return null;
  // Control characters would end up in an href and a heading.
  if (/[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}

/**
 * Read the period and employee a form page should show.
 *
 * ═══ THE ONE RULE WORTH READING TWICE ═══
 *
 * On a QUARTERLY form, both halves must be valid or NEITHER is used. Accepting
 * `?year=2025&q=7` as "2025, default quarter" would show three months the URL
 * did not ask for under a heading that agrees with itself. That was already the
 * 941 sheet's rule; this makes it every quarterly page's rule, and adds the part
 * it was missing - saying so.
 *
 * On an ANNUAL form a `q` is meaningless, and supplying one is refused rather
 * than ignored, because a person who typed `?q=2` on a 940 believes something
 * false about the form and should be told.
 */
export function readScope(sp: ScopeParams, now: Date, grain: ScopeGrain): FormScope {
  const refused: string[] = [];

  const rawYear = sp["year"];
  const rawQ = sp["q"];
  const rawEmp = sp["employee"];

  const year = parseYear(rawYear);
  if (rawYear !== undefined && rawYear.trim() !== "" && year === null) {
    refused.push(
      `the year "${rawYear.trim()}" is not a year this system holds forms for ` +
        `(${SCOPE_MIN_YEAR}-${SCOPE_MAX_YEAR})`,
    );
  }

  const employee = parseEmployee(rawEmp);
  if (rawEmp !== undefined && rawEmp.trim() !== "" && employee === null) {
    refused.push("the employee in the address was not a usable id");
  }

  if (grain === "year") {
    if (rawQ !== undefined && rawQ.trim() !== "") {
      refused.push("this form covers a whole year, so the quarter in the address was ignored");
    }
    const fallback = mostRecentlyClosedYear(now);
    return {
      grain,
      year: year ?? fallback,
      quarter: null,
      employee,
      defaulted: year === null,
      refused,
    };
  }

  const quarter = parseQuarter(rawQ);
  if (rawQ !== undefined && rawQ.trim() !== "" && quarter === null) {
    refused.push(`"${rawQ.trim()}" is not a quarter - a quarter is 1, 2, 3 or 4`);
  }

  const fallback = mostRecentlyClosedQuarter(now);

  /*
   * Both or neither. If one half is bad the whole period is discarded, and the
   * refusal above already says which half - so the reader is told that the
   * period on screen is the default and not what they asked for.
   */
  if (year === null || quarter === null) {
    if (year !== null && quarter === null) {
      refused.push(
        `so the whole period was discarded rather than showing ${year} with a guessed quarter`,
      );
    }
    return {
      grain,
      year: fallback.year,
      quarter: fallback.quarter,
      employee,
      defaulted: true,
      refused,
    };
  }

  return { grain, year, quarter, employee, defaulted: false, refused };
}

/**
 * The years the picker offers, newest first, with the selected year guaranteed
 * present.
 *
 * The union matters: without it, following a link to 2021 would produce a picker
 * that does not contain 2021, so the current selection would be unhighlighted
 * and unreachable - a picker that cannot show where you are.
 */
export function scopeYears(
  scope: FormScope,
  now: Date,
  count: number = SCOPE_YEAR_COUNT,
): readonly number[] {
  const newest = mostRecentlyClosedYear(now);
  const set = new Set<number>();
  for (let i = 0; i < count; i += 1) set.add(newest - i);
  set.add(scope.year);
  return [...set].sort((a, b) => b - a);
}

/**
 * The quarters the picker offers, newest first, with the selected quarter
 * guaranteed present. Same union argument as `scopeYears`.
 */
export function scopeQuarters(
  scope: FormScope,
  now: Date,
  count: number = SCOPE_QUARTER_COUNT,
): readonly { readonly year: number; readonly quarter: QuarterNumber }[] {
  const out: { year: number; quarter: QuarterNumber }[] = [];
  let { year, quarter } = mostRecentlyClosedQuarter(now);
  for (let i = 0; i < count; i += 1) {
    out.push({ year, quarter });
    if (quarter === 1) {
      year -= 1;
      quarter = 4;
    } else {
      quarter = (quarter - 1) as QuarterNumber;
    }
  }
  if (scope.quarter !== null) {
    const has = out.some((q) => q.year === scope.year && q.quarter === scope.quarter);
    if (!has) out.push({ year: scope.year, quarter: scope.quarter });
  }
  return out.sort((a, b) => (a.year === b.year ? b.quarter - a.quarter : b.year - a.year));
}

/** What to change when a link is clicked. Absent key = keep, null = clear. */
export type ScopePatch = {
  readonly year?: number;
  readonly quarter?: QuarterNumber | null;
  readonly employee?: string | null;
};

/**
 * The address for a scope with one dimension changed and the others KEPT.
 *
 * ═══ WHY THIS FUNCTION IS THE POINT OF THE WHOLE FILE ═══
 *
 * "Sort and filter that works with the full form workflow and all its tabs and
 * pages." Changing the year must not silently drop the employee. Before this,
 * the W-2 sheet's own year links did exactly that: `?year=${taxYear}` was how it
 * built the "all employees" link, so every year link was also a hidden
 * clear-the-employee link, and a person who filtered to one employee and then
 * changed year got the whole run back without being told why.
 */
export function scopeHref(basePath: string, scope: FormScope, patch: ScopePatch = {}): string {
  const year = patch.year ?? scope.year;
  const quarter = patch.quarter === undefined ? scope.quarter : patch.quarter;
  const employee = patch.employee === undefined ? scope.employee : patch.employee;

  const parts: string[] = [`year=${year}`];
  if (scope.grain === "quarter" && quarter !== null) parts.push(`q=${quarter}`);
  if (employee !== null) parts.push(`employee=${encodeURIComponent(employee)}`);
  return `${basePath}?${parts.join("&")}`;
}

/** "Q2 2026" or "2026". The label a heading and a pill must agree on. */
export function scopeLabel(scope: FormScope): string {
  return scope.quarter === null ? String(scope.year) : `Q${scope.quarter} ${scope.year}`;
}

/**
 * The sentence the bar shows when something was refused or substituted, or null.
 *
 * `unmatchedEmployee` is passed in by the page, which is the only layer that
 * knows the roster. An id that matches nobody used to show the WHOLE run with no
 * explanation, which is the same silent-substitution defect as `?q=7`.
 */
export function scopeNotice(scope: FormScope, unmatchedEmployee: boolean = false): string | null {
  const bits: string[] = [...scope.refused];
  if (unmatchedEmployee) {
    bits.push("nobody on this form matches the employee in the address, so everybody is shown");
  }
  if (bits.length === 0) return null;
  const joined = bits.join("; ");
  return scope.defaulted
    ? `Showing ${scopeLabel(scope)}, which is not what the address asked for: ${joined}.`
    : `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * SELF-TESTS
 * ══════════════════════════════════════════════════════════════════════════════ */

export function __runFormScopeCoreTests(): void {
  const fail: string[] = [];
  const check = (name: string, ok: boolean): void => {
    if (!ok) fail.push(name);
  };

  // 5 May 2026: the closed quarter is Q1 2026, the closed year is 2025.
  const may = new Date(Date.UTC(2026, 4, 5));
  const jan = new Date(Date.UTC(2027, 0, 9));

  check("closed year", mostRecentlyClosedYear(may) === 2025);
  const q = mostRecentlyClosedQuarter(may);
  check("closed quarter", q.year === 2026 && q.quarter === 1);
  const jq = mostRecentlyClosedQuarter(jan);
  check("january rolls back a year", jq.year === 2026 && jq.quarter === 4);

  // A quarterly page given a good year and a nonsense quarter must discard BOTH.
  const bad = readScope({ year: "2025", q: "7" }, may, "quarter");
  check("bad quarter discards the year too", bad.year === 2026 && bad.quarter === 1);
  check("bad quarter is reported", bad.refused.length >= 2 && bad.defaulted);
  check("bad quarter has a notice", scopeNotice(bad) !== null);

  // An annual page must not silently swallow a quarter.
  const annual = readScope({ year: "2025", q: "2" }, may, "year");
  check("annual keeps its year", annual.year === 2025 && annual.quarter === null);
  check("annual refuses the quarter out loud", annual.refused.length === 1);
  check("annual is not 'defaulted'", !annual.defaulted);

  // The employee dimension survives a year change. This is the defect fixed.
  const scoped = readScope({ year: "2025", employee: "emp-7" }, may, "year");
  check("employee read", scoped.employee === "emp-7");
  check(
    "year change keeps the employee",
    scopeHref("/x", scoped, { year: 2024 }) === "/x?year=2024&employee=emp-7",
  );
  check(
    "employee can be cleared deliberately",
    scopeHref("/x", scoped, { employee: null }) === "/x?year=2025",
  );

  // A quarterly href carries q; an annual one never does, even if asked.
  const qs = readScope({ year: "2026", q: "2" }, may, "quarter");
  check("quarterly href", scopeHref("/x", qs, { quarter: 3 }) === "/x?year=2026&q=3");
  check("annual href has no q", !scopeHref("/x", annual).includes("q="));

  // Out-of-range and malformed years are refused, not clamped.
  check("year 1970 refused", readScope({ year: "1970" }, may, "year").year === 2025);
  check("year 'abc' refused", readScope({ year: "abc" }, may, "year").defaulted);
  check("year '02026' refused", readScope({ year: "02026" }, may, "year").defaulted);
  check("quarter '01' refused", readScope({ year: "2026", q: "01" }, may, "quarter").defaulted);
  check("empty year is not a refusal", readScope({ year: "" }, may, "year").refused.length === 0);

  // The picker must always contain where you are, or it cannot show where you are.
  const old = readScope({ year: "2021" }, may, "year");
  const years = scopeYears(old, may);
  check("year picker contains the selection", years.includes(2021));
  check("year picker is newest first", years[0] === 2025);
  check("year picker offers the retention window", years.includes(2022));
  const oldQ = readScope({ year: "2021", q: "3" }, may, "quarter");
  const quarters = scopeQuarters(oldQ, may);
  check(
    "quarter picker contains the selection",
    quarters.some((x) => x.year === 2021 && x.quarter === 3),
  );
  check("quarter picker is newest first", quarters[0].year === 2026 && quarters[0].quarter === 1);
  check("quarter picker spans the IRS lookback", quarters.length >= SCOPE_QUARTER_COUNT + 1);

  // No duplicates: a pill list with two 2025s is two links to one place.
  check("year picker has no duplicates", new Set(years).size === years.length);
  const keys = quarters.map((x) => `${x.year}Q${x.quarter}`);
  check("quarter picker has no duplicates", new Set(keys).size === keys.length);

  // Labels agree with the grain.
  check("quarter label", scopeLabel(qs) === "Q2 2026");
  check("year label", scopeLabel(annual) === "2025");

  // A clean scope says nothing; an unmatched employee says something.
  check("clean scope is quiet", scopeNotice(readScope({ year: "2025" }, may, "year")) === null);
  /*
   * Capital N, and the assertion says so rather than being made case-blind.
   * `scoped` is a VALID scope, so the notice takes the not-defaulted branch,
   * which capitalises the first letter because the string is a whole sentence
   * shown on its own. Written lowercase first and the self-test caught it.
   */
  check(
    "unmatched employee speaks",
    (scopeNotice(scoped, true) ?? "").startsWith("Nobody on this form matches"),
  );

  // Control characters and absurd ids never reach an href.
  check("control chars refused", readScope({ employee: "a\u0000b" }, may, "year").employee === null);
  check(
    "long id refused",
    readScope({ employee: "x".repeat(SCOPE_MAX_EMPLOYEE_ID_LEN + 1) }, may, "year").employee ===
      null,
  );
  check(
    "id is url-encoded",
    scopeHref("/x", readScope({ employee: "a b&c" }, may, "year")).includes("a%20b%26c"),
  );

  if (fail.length > 0) {
    throw new Error(`form-scope-core self-tests failed: ${fail.join(", ")}`);
  }
}
