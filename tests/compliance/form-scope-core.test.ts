/**
 * tests/compliance/form-scope-core.test.ts   (books-63)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE PERIOD SELECTOR, AND PROOF THAT IT IS ONLY ONE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Michael: "sorting and filtering per period/ employee/ qtr/ yr, etc would be
 * really handy on the forms pages in some way. ... Please make sure you are
 * building these features so I can sort and filter that works with the full form
 * workflow and all its tabs and pages."
 *
 * The last clause is the requirement that needs a GATE rather than a component.
 * A shared selector is easy to write and trivially easy to bypass: the next form
 * page copies the nearest neighbour's ad-hoc parsing, and six months later there
 * are two systems again. That is not hypothetical - it is what this slice found.
 * The period rule was written out SIX times and the year bounds THREE different
 * ways, and every test was green throughout.
 *
 * So the load-bearing assertions here walk the filesystem and hold EVERY form
 * page to the shared reader. Rule 23: fix the class, not the instance.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SCOPE_MAX_YEAR,
  SCOPE_MIN_YEAR,
  SCOPE_QUARTER_COUNT,
  SCOPE_YEAR_COUNT,
  __runFormScopeCoreTests,
  mostRecentlyClosedQuarter,
  mostRecentlyClosedYear,
  readScope,
  scopeHref,
  scopeLabel,
  scopeNotice,
  scopeQuarters,
  scopeYears,
} from "@/lib/payroll/form-scope-core";

const ROOT = process.cwd();
const BOOKS = join(ROOT, "src/app/admin/books");

/** 5 May 2026: closed quarter Q1 2026, closed year 2025. */
const MAY = new Date(Date.UTC(2026, 4, 5));

describe("form-scope-core: the embedded self-tests", () => {
  it("passes its own gates", () => {
    expect(() => __runFormScopeCoreTests()).not.toThrow();
  });
});

describe("form-scope-core: a wrong period is never shown as a right one", () => {
  /*
   * ═══ THE DEFECT THIS BLOCK EXISTS FOR ═══
   *
   * `?year=2025&q=7` used to render Q2 2026 under a heading reading "Q2 2026".
   * Self-consistent and wrong, which is the hardest kind of error to notice -
   * and these figures get typed into EFTPS.
   */
  it("discards BOTH halves of a quarter when one is nonsense", () => {
    const s = readScope({ year: "2025", q: "7" }, MAY, "quarter");
    expect(s.year).toBe(2026);
    expect(s.quarter).toBe(1);
    expect(s.defaulted).toBe(true);
  });

  it("says so, rather than substituting silently", () => {
    const s = readScope({ year: "2025", q: "7" }, MAY, "quarter");
    const notice = scopeNotice(s);
    expect(notice).not.toBeNull();
    // The notice must name the period ACTUALLY shown, not the one asked for.
    expect(notice).toContain("Q1 2026");
    expect(notice).toContain("not what the address asked for");
  });

  it("refuses a quarter on an annual form out loud instead of ignoring it", () => {
    // A person who typed ?q=2 on a 940 believes the 940 is quarterly. It is
    // not, and Part 5's four quarterly LIABILITIES on an annual RETURN are
    // exactly why that misunderstanding is common.
    const s = readScope({ year: "2025", q: "2" }, MAY, "year");
    expect(s.quarter).toBeNull();
    expect(s.year).toBe(2025);
    expect(scopeNotice(s)).toContain("whole year");
  });

  it("bounds the year instead of computing a return for the year 1", () => {
    // wa-quarterly and the tabbed 941 both validated with `Number.isFinite`
    // and no bounds, so `?year=1&q=1` was accepted by both.
    expect(readScope({ year: "1", q: "1" }, MAY, "quarter").defaulted).toBe(true);
    expect(readScope({ year: String(SCOPE_MIN_YEAR - 1) }, MAY, "year").defaulted).toBe(true);
    expect(readScope({ year: String(SCOPE_MAX_YEAR + 1) }, MAY, "year").defaulted).toBe(true);
    expect(readScope({ year: String(SCOPE_MIN_YEAR) }, MAY, "year").defaulted).toBe(false);
    expect(readScope({ year: String(SCOPE_MAX_YEAR) }, MAY, "year").defaulted).toBe(false);
  });

  it("never defaults to a period that has not finished", () => {
    /*
     * A form reports a CLOSED period. Defaulting to the current one would show
     * an incomplete quarter's figures as though they were the return - and a
     * partial quarter looks exactly like a finished one on paper.
     *
     * Checked across a whole year rather than at one instant, because a rule
     * that is right in May and wrong in January is the kind of bug that arrives
     * on the worst possible day: the filing deadline.
     */
    for (let month = 0; month < 12; month += 1) {
      const now = new Date(Date.UTC(2027, month, 15));
      const y = readScope({}, now, "year");
      expect(y.year).toBeLessThan(2027);

      const q = readScope({}, now, "quarter");
      const currentQ = Math.floor(month / 3) + 1;
      const isSamePeriod = q.year === 2027 && q.quarter === currentQ;
      expect(isSamePeriod, `month ${month} defaulted to the quarter still in progress`).toBe(false);
    }
  });
});

describe("form-scope-core: changing one dimension keeps the others", () => {
  /*
   * ═══ THE REAL DEFECT IN THE OLD W-2 SHEET ═══
   *
   * Its "Show all" link was `?year=${taxYear}`, so every year link was ALSO a
   * hidden clear-the-employee link. A person who filtered to one employee and
   * then changed year silently got the whole run back with no explanation.
   */
  it("a year change does not silently clear the employee filter", () => {
    const s = readScope({ year: "2025", employee: "emp-7" }, MAY, "year");
    const href = scopeHref("/admin/books/form-w2/sheet", s, { year: 2024 });
    expect(href).toContain("year=2024");
    expect(href).toContain("employee=emp-7");
  });

  it("a quarter change does not clear the year, and vice versa", () => {
    const s = readScope({ year: "2024", q: "3" }, MAY, "quarter");
    expect(scopeHref("/x", s, { quarter: 1 })).toBe("/x?year=2024&q=1");
    expect(scopeHref("/x", s, { year: 2023 })).toBe("/x?year=2023&q=3");
  });

  it("clearing the employee is possible, and explicit", () => {
    const s = readScope({ year: "2025", employee: "emp-7" }, MAY, "year");
    expect(scopeHref("/x", s, { employee: null })).toBe("/x?year=2025");
  });

  it("an annual href never carries a quarter, so it cannot be misread", () => {
    const s = readScope({ year: "2025" }, MAY, "year");
    expect(scopeHref("/x", s)).not.toContain("q=");
  });

  it("an employee id is url-encoded before it reaches an href", () => {
    const s = readScope({ employee: "a b&c=d" }, MAY, "year");
    const href = scopeHref("/x", s);
    // The separators must survive as separators and the id must not add any.
    expect(href.split("&")).toHaveLength(2);
    expect(href).toContain("a%20b%26c%3Dd");
  });
});

describe("form-scope-core: the picker can always show where you are", () => {
  it("includes the selected year even when it is outside the default window", () => {
    // Otherwise following a link to 2021 renders a picker with no 2021 in it:
    // nothing highlighted, and no way back to where you already are.
    const s = readScope({ year: "2021" }, MAY, "year");
    expect(scopeYears(s, MAY)).toContain(2021);
  });

  it("includes the selected quarter even when it is outside the window", () => {
    const s = readScope({ year: "2019", q: "2" }, MAY, "quarter");
    // 2019 is below SCOPE_MIN_YEAR, so this one defaults - which must ALSO be
    // in the list. Asserted against whatever it defaulted to rather than a
    // guess, so this stays true if the bounds move.
    const list = scopeQuarters(s, MAY);
    expect(list.some((q) => q.year === s.year && q.quarter === s.quarter)).toBe(true);
  });

  it("offers at least the IRS retention window in years", () => {
    // Four years, quoted verbatim in IW2W3_2026_WHO_MUST_FILE_W3: "keep for
    // your records for at least 4 years". A picker offering fewer years than he
    // must keep cannot reach a year an auditor can ask about.
    const s = readScope({}, MAY, "year");
    expect(scopeYears(s, MAY).length).toBeGreaterThanOrEqual(SCOPE_YEAR_COUNT);
  });

  it("offers at least the IRS deposit-schedule lookback in quarters", () => {
    // Eight = two years, which is the window `lookbackQuartersFor` works on.
    const s = readScope({}, MAY, "quarter");
    expect(scopeQuarters(s, MAY).length).toBeGreaterThanOrEqual(SCOPE_QUARTER_COUNT);
  });

  it("offers no duplicates, because two pills to one place is a bug", () => {
    const s = readScope({ year: "2025" }, MAY, "year");
    const years = scopeYears(s, MAY);
    expect(new Set(years).size).toBe(years.length);

    const qs = readScope({ year: "2026", q: "1" }, MAY, "quarter");
    const quarters = scopeQuarters(qs, MAY).map((q) => `${q.year}Q${q.quarter}`);
    expect(new Set(quarters).size).toBe(quarters.length);
  });

  it("is ordered newest first, which is the order a person files in", () => {
    const s = readScope({}, MAY, "year");
    const years = scopeYears(s, MAY);
    expect([...years].sort((a, b) => b - a)).toEqual([...years]);
  });

  it("labels agree with the grain, so a heading cannot contradict a pill", () => {
    expect(scopeLabel(readScope({ year: "2026", q: "2" }, MAY, "quarter"))).toBe("Q2 2026");
    expect(scopeLabel(readScope({ year: "2025" }, MAY, "year"))).toBe("2025");
  });

  it("says nothing when there is nothing to say", () => {
    // A bar that always shows a warning trains people to ignore warnings.
    expect(scopeNotice(readScope({ year: "2025" }, MAY, "year"))).toBeNull();
    expect(scopeNotice(readScope({ year: "2026", q: "1" }, MAY, "quarter"))).toBeNull();
  });

  it("speaks when an employee matches nobody", () => {
    /*
     * This used to show the WHOLE run with no explanation - the same silent
     * substitution as ?q=7, applied to people instead of periods.
     *
     * Capital N: this scope is VALID, so the notice takes the not-defaulted
     * branch, which capitalises the sentence's first letter. Asserted as the
     * reader sees it rather than made case-insensitive - a case-blind assertion
     * here would also pass on a notice welded into the middle of another
     * sentence, which is not what is being promised.
     */
    const s = readScope({ year: "2025", employee: "ghost" }, MAY, "year");
    expect(scopeNotice(s, true)).toBe(
      "Nobody on this form matches the employee in the address, so everybody is shown.",
    );
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * EVERY FORM PAGE USES THE SHARED READER - DISCOVERED, NOT LISTED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This is the block that makes his "all its tabs and pages" a promise rather
 * than a hope. A seventh form page gets held to it by existing.
 */
describe("form-scope-core: one selector, proved across every form page", () => {
  /**
   * Every books route that reads searchParams AND is a form surface.
   *
   * Discovered by walking, then filtered to pages that render a form: a form
   * page is one that imports a lesson set or a facsimile. That keeps the ledger
   * and journal screens - which have their own filters and their own vocabulary
   * - out of a gate written about FORMS.
   */
  const formPages: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith("[")) continue;
      const page = join(dir, e.name, "page.tsx");
      if (existsSync(page)) {
        const src = readFileSync(page, "utf8");
        const isForm =
          /form-box-lessons-|FormFacsimile|FormBoxExplorer/.test(src) &&
          /searchParams/.test(src);
        if (isForm) formPages.push(`${rel}/${e.name}`);
      }
      walk(join(dir, e.name), `${rel}/${e.name}`);
    }
  };
  walk(BOOKS, "");

  it("finds the form pages, so nothing below can pass over an empty list", () => {
    // Rule 39/66d: a glob that silently matches nothing passes forever.
    expect(formPages.length).toBeGreaterThanOrEqual(6);
    // Named too, so DELETING a page is a decision rather than a quiet
    // reduction in what is being checked.
    expect(formPages).toContain("/form-941");
    expect(formPages).toContain("/form-941/sheet");
    expect(formPages).toContain("/form-940");
    expect(formPages).toContain("/form-940/sheet");
    expect(formPages).toContain("/form-w2");
    expect(formPages).toContain("/form-w2/sheet");
    expect(formPages).toContain("/wa-quarterly");
  });

  for (const rel of formPages) {
    describe(rel, () => {
      const src = readFileSync(join(BOOKS, rel, "page.tsx"), "utf8");

      it("reads its period through readScope rather than its own parsing", () => {
        expect(src).toMatch(/readScope\(/);
      });

      it("states its grain explicitly", () => {
        // No default grain exists, so this cannot be omitted - but it CAN be
        // passed a variable, which would move the decision somewhere this gate
        // cannot see it. The grain must be a literal at the call site.
        // No `s` flag: this project targets ES2017, which does not have it, and
        // vitest's transpiler accepts it while `tsc` refuses - so the flag would
        // be a green test that fails the build. `[^)]` already spans newlines.
        expect(src).toMatch(/readScope\([^)]*"(year|quarter)"\s*\)/);
      });

      it("does not keep a private copy of the closed-period rule", () => {
        /*
         * THE ASSERTION THAT WOULD HAVE CAUGHT THIS SLICE'S FINDING.
         *
         * Six copies of `getUTCFullYear() - 1` and `Math.floor(month / 3) + 1`
         * existed across these files, and the year bounds were spelled three
         * different ways. A shared reader that pages are free to bypass is a
         * shared reader that pages will bypass.
         *
         * Comments are stripped first: this file's own docblocks quote the old
         * code on purpose, and so do the "moved to form-scope-core" notes left
         * behind in each page.
         */
        const code = src
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        expect(code, "a private copy of the closed-year rule").not.toMatch(
          /getUTCFullYear\(\)\s*-\s*1/,
        );
        expect(code, "a private copy of the closed-quarter rule").not.toMatch(
          /Math\.floor\([^)]*getUTCMonth\(\)\s*\/\s*3\)/,
        );
        expect(code, "a private year-bounds check").not.toMatch(/2100/);
      });

      it("renders the shared bar, so the period is visible and changeable", () => {
        // Rule 125(d): a run needs a way in that is not a URL. Before this
        // slice a quarter picker existed on exactly ONE of these pages.
        expect(src).toMatch(/<FormScopeBar/);
      });

      it("builds any link to its own sheet with scopeHref, keeping the period", () => {
        /*
         * A hardcoded `?year=` on the door sends a reader viewing 2024 to the
         * paper for last year. Only asserted for pages that HAVE such a link,
         * because the sheet routes do not link to themselves.
         */
        const linksToSheet = /href=\{[^}]*\/sheet/.test(src);
        if (linksToSheet) {
          expect(src).toMatch(/scopeHref\(["'][^"']*\/sheet["']/);
        }
      });
    });
  }
});

describe("form-scope-core: the bar itself keeps its promises", () => {
  const BAR = readFileSync(join(ROOT, "src/components/admin/books/FormScopeBar.tsx"), "utf8");

  /*
   * Source-text assertions, for the reason form-box-explorer-wiring.test.ts
   * gives: these failures are ABSENCES in a component that cannot be rendered
   * in this suite without Supabase, cookies and a live session.
   */
  it("does not print, because he prints these pages for his CPA", () => {
    // A row of navigation pills on a filed 941 makes it obvious the document
    // came out of a web browser.
    expect(BAR).toMatch(/print:hidden/);
  });

  it("needs no client JavaScript", () => {
    // This whole form workflow is server components. A <select> that requires
    // hydration to change the period is a picker that does nothing while the
    // page is loading.
    expect(BAR).not.toMatch(/"use client"/);
    expect(BAR).not.toMatch(/useState|onChange|onClick/);
  });

  it("keeps the selection in the address, so a link can be sent to a CPA", () => {
    expect(BAR).toMatch(/scopeHref/);
    expect(BAR).toMatch(/next\/link/);
  });

  it("marks the current selection for a screen reader, not only in colour", () => {
    expect(BAR).toMatch(/aria-current/);
  });

  it("shows what is selected in words, not only as a highlighted pill", () => {
    expect(BAR).toMatch(/scopeLabel/);
    expect(BAR).toMatch(/Showing/);
  });

  it("shows the refusal notice, which is the whole point of recording one", () => {
    expect(BAR).toMatch(/scopeNotice/);
  });
});

describe("form-scope-core: the moved helpers still behave as their old callers expected", () => {
  /*
   * Rule 115 in spirit: the old code was working. Extracting it must not change
   * an answer. These are the exact behaviours the six deleted copies had.
   */
  it("mostRecentlyClosedYear matches the deleted copies", () => {
    expect(mostRecentlyClosedYear(new Date(Date.UTC(2027, 2, 3)))).toBe(2026);
    expect(mostRecentlyClosedYear(new Date(Date.UTC(2027, 11, 31)))).toBe(2026);
  });

  it("mostRecentlyClosedQuarter matches the deleted copies", () => {
    expect(mostRecentlyClosedQuarter(new Date(Date.UTC(2026, 4, 5)))).toEqual({
      year: 2026,
      quarter: 1,
    });
    // January rolls back a YEAR as well as a quarter. This was the one line
    // most at risk of being extracted wrongly.
    expect(mostRecentlyClosedQuarter(new Date(Date.UTC(2026, 0, 9)))).toEqual({
      year: 2025,
      quarter: 4,
    });
    expect(mostRecentlyClosedQuarter(new Date(Date.UTC(2026, 3, 1)))).toEqual({
      year: 2026,
      quarter: 1,
    });
    expect(mostRecentlyClosedQuarter(new Date(Date.UTC(2026, 11, 31)))).toEqual({
      year: 2026,
      quarter: 3,
    });
  });
});
