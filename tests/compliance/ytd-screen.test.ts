/**
 * tests/compliance/ytd-screen.test.ts   (books-37)
 *
 * THE GATE ON THE YEAR-TO-DATE SCREEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "The 16 inactive employees are no longer working for me. I will keep their
 *    data in my sage backups, I only need the active employees I currently
 *    have. Please proceed with the net pay and the deferred ytd store slice."
 *
 * Two requirements, and this file asserts both in code rather than in prose:
 * the board shows ACTIVE employees only, and the departed employees' rows are
 * COUNTED rather than silently dropped - because "the screen shows 8 people and
 * the 941 shows 11" is a frightening thing to discover in April.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SCREEN MATTERS MORE THAN IT LOOKS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Year-to-date is an INPUT to payroll, not a report produced after it. Whether
 * Social Security comes out of this Friday's cheque depends entirely on what
 * the employee has already been paid this year. Before books-37 the only
 * non-test caller of `computePaycheckTaxes` passed `ZERO_YTD`, so the ceiling
 * could never engage and a high earner would have been over-withheld all the
 * way to December.
 *
 * `ytd-mentor.ts` is 1,052 lines and, until this slice, no human could reach a
 * word of it. That is standing rule 50, and section 8 is what keeps it fixed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adminNav } from "@/components/admin/admin-nav-data";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import {
  emptyAccumulator,
  oasdiRoomRemaining,
  type YtdAccumulatorRow,
} from "@/lib/payroll/ytd-core";
import { YTD_SCREEN_LESSONS, YTD_YEAR_END_CHECKS } from "@/lib/payroll/ytd-mentor";
import { OASDI_WAGE_BASE_2026_CENTS } from "@/lib/payroll/payroll-withholding-core";

const ROOT = join(__dirname, "..", "..");
const PAGE_PATH = join(ROOT, "src/app/admin/books/ytd/page.tsx");
const VIEW_PATH = join(ROOT, "src/components/admin/books/YtdBoard.tsx");
const STORE_PATH = join(ROOT, "src/lib/payroll/ytd-store.ts");

const pageSrc = readFileSync(PAGE_PATH, "utf8");
const viewSrc = readFileSync(VIEW_PATH, "utf8");
const storeSrc = readFileSync(STORE_PATH, "utf8");

/** Strip comments so a promise in prose cannot satisfy a claim about code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const pageCode = stripComments(pageSrc);
const viewCode = stripComments(viewSrc);
const storeCode = stripComments(storeSrc);

/** A row with a given amount of Social Security wages already paid. */
function rowWithOasdi(cents: number): YtdAccumulatorRow {
  const base = emptyAccumulator("e1", 2026);
  return { ...base, wages: { ...base.wages, oasdiWagesCents: cents } };
}

describe("0 the comment-stripping helper actually strips", () => {
  it("leaves real code behind", () => {
    expect(pageCode.length).toBeGreaterThan(800);
    expect(viewCode.length).toBeGreaterThan(3000);
    expect(storeCode.length).toBeGreaterThan(4000);
  });

  it("the headers really were stripped, not merely shortened", () => {
    expect(pageSrc).toContain("YEAR-TO-DATE IS AN INPUT, NOT A REPORT");
    expect(pageCode).not.toContain("YEAR-TO-DATE IS AN INPUT, NOT A REPORT");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) ROOM REMAINING IS THE NUMBER THAT MATTERS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("1 the Social Security ceiling can actually be reached", () => {
  it("an employee below the base has room, and is not flagged", () => {
    const r = oasdiRoomRemaining(rowWithOasdi(1_000_000));
    expect(r.ceilingReached).toBe(false);
    expect(r.roomCents).toBe(OASDI_WAGE_BASE_2026_CENTS - 1_000_000);
  });

  it("an employee exactly AT the base has reached it", () => {
    // The boundary is the whole point. `>=` versus `>` here is the difference
    // between withholding one extra period of Social Security and not.
    const r = oasdiRoomRemaining(rowWithOasdi(OASDI_WAGE_BASE_2026_CENTS));
    expect(r.ceilingReached).toBe(true);
    expect(r.roomCents).toBe(0);
  });

  it("room never goes negative, because negative room is not a thing", () => {
    const r = oasdiRoomRemaining(rowWithOasdi(OASDI_WAGE_BASE_2026_CENTS + 500_000));
    expect(r.ceilingReached).toBe(true);
    expect(r.roomCents).toBe(0);
  });

  it("the wage base is an argument, so a later year is not measured wrongly", () => {
    // It is indexed and moves most years. A hard-coded base would silently
    // measure 2027 wages against the 2026 ceiling.
    const custom = 20_000_000;
    const r = oasdiRoomRemaining(rowWithOasdi(1_000_000), custom);
    expect(r.roomCents).toBe(custom - 1_000_000);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) ACTIVE EMPLOYEES ONLY, AND THE REST ARE COUNTED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("2 Michael's instruction is enforced in the store", () => {
  it("the employee query filters to active", () => {
    expect(storeCode).toContain('.eq("active", true)');
  });

  it("inactive rows are COUNTED, not filtered away in SQL", () => {
    // Counting them requires reading them. If the accumulator query filtered
    // by active employee, the count could only ever be zero - which would look
    // identical to "there are none" and hide a real discrepancy against a 941.
    expect(storeCode).toContain("inactiveRowsNotShown += 1");
    expect(storeCode).not.toMatch(/from\("payroll_ytd_accumulators"\)[\s\S]{0,300}\.eq\("active"/);
  });

  it("the screen surfaces that count rather than swallowing it", () => {
    expect(viewCode).toContain("inactiveRowsNotShown");
  });

  it("an employee with no stored row is distinguished from one paid zero", () => {
    // These look identical on a page of numbers and mean very different things:
    // one has not been paid yet, the other may have a missing accumulator.
    expect(storeCode).toContain("neverPaidThisYear: stored === undefined");
    expect(viewCode).toContain("neverPaidThisYear");
  });

  it("a missing name is reported as missing, never blanked or guessed", () => {
    expect(storeCode).toContain("has no name on file");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE WAGE-BASE CAVEAT
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("3 measuring one year against another year's base is disclosed", () => {
  it("the store emits a caveat only when the years differ", () => {
    expect(storeCode).toContain("taxYear === wageBaseYear");
  });

  it("the screen renders the caveat rather than dropping it", () => {
    expect(viewCode).toContain("wageBaseCaveat");
  });

  it("the page pins the wage-base year to the evidence, not to the clock", () => {
    // On 2027-01-01 the clock says 2027 while the mirrored SSA figure is 2026.
    // Silently measuring one against the other is the drift this prevents.
    expect(pageCode).toContain("VERIFIED_WAGE_BASE_YEAR = 2026");
    expect(pageCode).toContain("loadYtdBoard(taxYear, VERIFIED_WAGE_BASE_YEAR)");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) THE OWNER GATE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("4 the owner gate protects the render", () => {
  it("requireBooksAccess is called BEFORE the read", () => {
    // These rows are every employee's annual earnings and tax withheld - W-2
    // data - and the store runs as the service role, bypassing RLS entirely.
    const gateAt = pageCode.indexOf("requireBooksAccess()");
    const readAt = pageCode.indexOf("loadYtdBoard(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(-1);
    expect(gateAt, "the totals are read before the permission check").toBeLessThan(readAt);
  });

  it("the page is force-dynamic so the gate cannot be cached away", () => {
    expect(pageCode).toContain('export const dynamic = "force-dynamic"');
  });

  it("the store is server-only and the view imports only TYPES from it", () => {
    expect(storeCode).toContain('import "server-only"');
    expect(viewCode).toContain('"use client"');
    // Standing rule 65b: a VALUE import of the service-role store from a client
    // component drags it toward the browser bundle.
    expect(viewCode).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+"@\/lib\/payroll\/ytd-store"/m);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) A READ FAILURE IS A READ FAILURE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("5 a failed read never renders as 'nobody has been paid'", () => {
  it("the page branches on board.ok before rendering the board", () => {
    const branchAt = pageCode.indexOf("!board.ok");
    const renderAt = pageCode.indexOf("<YtdBoard");
    expect(branchAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(-1);
    expect(branchAt).toBeLessThan(renderAt);
  });

  it("the failure card says so, and warns against the wrong reading", () => {
    // Standing rule 39. An empty board and a failed read look identical and
    // mean opposite things; one of them precedes a wrong W-2.
    expect(pageCode).toContain("{board.message}");
    expect(pageSrc).toContain("NOT confirmation that nobody has been paid");
  });

  it("the store's own read failure says the same thing", () => {
    expect(storeSrc).toContain('do not read the blank screen as "nobody has been paid"');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) THE SCREEN DOES NO ARITHMETIC OF ITS OWN
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("6 every number on screen came from the engine", () => {
  it("the board does not recompute room or the ceiling", () => {
    // If the view subtracted its own wage base it would eventually disagree
    // with the engine - silently, on the screen that drives W-2s.
    expect(viewCode).not.toContain("OASDI_WAGE_BASE");
    expect(viewCode).not.toMatch(/Cents\s*-\s*\w*Cents/);
  });

  it("it reads the nested wage fields, not invented flat ones", () => {
    /*
     * THIS ASSERTION EXISTS BECAUSE THE FIRST DRAFT GOT IT WRONG.
     *
     * It read `l.row.oasdiWagesCents`, recalling the field name from a sibling
     * type. The real shape nests the seven wage measures under `row.wages`, so
     * every one of those reads was `undefined` - and `undefined` formats
     * without throwing. The screen would have rendered a confident, blank
     * column. A field name recalled from a sibling type is a GUESS.
     */
    expect(viewCode).toContain("l.row.wages.oasdiWagesCents");
    expect(viewCode).toContain("l.row.wages.medicareWagesCents");
    expect(viewCode).not.toMatch(/row\.oasdiWagesCents/);
    expect(viewCode).not.toMatch(/row\.medicareWagesCents/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7) EVERY AUTHORITY QUOTED ON THIS SCREEN EXISTS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("7 the authority ids resolve against the real registry", () => {
  function selectedAuthorityIds(): string[] {
    const block = viewCode.match(/SELECTED_AUTHORITY_IDS\s*=\s*\[([\s\S]*?)\]/);
    if (!block) return [];
    return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }

  it("the extractor actually found ids", () => {
    // Rule 39: without this the loop below could iterate zero times and pass.
    expect(selectedAuthorityIds().length).toBeGreaterThanOrEqual(3);
  });

  it("every id resolves to a real authority with a real citation", () => {
    for (const id of selectedAuthorityIds()) {
      const found = findGuidanceAuthority(id);
      expect(found, `authority "${id}" is quoted on screen but does not exist`).toBeDefined();
      expect(found!.cite.length).toBeGreaterThan(5);
    }
  });

  it("every authority cited by a year-end check exists too", () => {
    let checked = 0;
    for (const check of YTD_YEAR_END_CHECKS) {
      for (const id of check.authorityIds) {
        expect(findGuidanceAuthority(id), `check "${check.key}" cites missing "${id}"`).toBeDefined();
        checked += 1;
      }
    }
    // Guard the vacuous pass: if no check cited anything, the loop proves nothing.
    expect(checked).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8) 1,052 LINES OF TEACHING ARE FINALLY REACHABLE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("8 the mentor layer actually reaches the screen", () => {
  function selectedTopics(): string[] {
    const block = viewCode.match(/SELECTED_LESSON_TOPICS\s*=\s*\[([\s\S]*?)\]/);
    if (!block) return [];
    return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }

  it("the extractor actually found topics", () => {
    expect(selectedTopics().length).toBeGreaterThanOrEqual(2);
  });

  it("every selected topic matches exactly one real lesson", () => {
    for (const topic of selectedTopics()) {
      const hits = YTD_SCREEN_LESSONS.filter((l) => l.topic === topic);
      expect(hits, `topic "${topic}" resolves to ${hits.length} lessons`).toHaveLength(1);
    }
  });

  it("lessons are chosen by topic string, never by array index", () => {
    expect(viewCode).toContain("SELECTED_LESSON_TOPICS");
    expect(viewCode).not.toMatch(/YTD_SCREEN_LESSONS\[\d+\]/);
  });

  it("all six year-end checks are rendered, not a chosen few", () => {
    // The checks are ORDERED and each depends on the ones before it. Showing a
    // subset would teach a sequence that skips a step.
    expect(YTD_YEAR_END_CHECKS.length).toBe(6);
    expect(viewCode).toContain("YTD_YEAR_END_CHECKS.map");
  });

  it("the checks that block a filing are marked as such on screen", () => {
    const blocking = YTD_YEAR_END_CHECKS.filter((c) => c.blocksFiling);
    expect(blocking.length).toBeGreaterThan(0);
    expect(viewCode).toContain("blocksFiling");
  });

  it("the first check depends on nothing and the rest build on it", () => {
    // Checking a wage base against totals that have drifted tells you about the
    // drift, not the wage base. The order is load-bearing.
    expect(YTD_YEAR_END_CHECKS[0].requires).toEqual([]);
    const dependent = YTD_YEAR_END_CHECKS.filter((c) => c.requires.length > 0);
    expect(dependent.length).toBeGreaterThan(0);
    const keys = new Set(YTD_YEAR_END_CHECKS.map((c) => c.key));
    for (const c of YTD_YEAR_END_CHECKS) {
      for (const need of c.requires) {
        expect(keys.has(need), `check "${c.key}" requires unknown "${need}"`).toBe(true);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9) A HUMAN BEING CAN GET TO THIS SCREEN
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("9 the screen is reachable and guarded", () => {
  it("a nav entry points at it", () => {
    const item = adminNav.filter((i) => i.href === "/admin/books/ytd");
    expect(item).toHaveLength(1);
    expect(item[0].permission).toBe("books.view");
    expect(item[0].group).toBe("Accounting");
  });

  it("the board tells the reader what it is NOT showing", () => {
    // A page of totals that quietly omits people is worse than no page.
    expect(viewCode).toContain("inactiveRowsNotShown");
    expect(viewCode).toContain("neverPaidThisYear");
  });
});
