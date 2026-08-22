/**
 * tests/compliance/garnishment-screen.test.ts   (books-36)
 *
 * THE GATE ON THE GARNISHMENTS SCREEN.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * Michael asked one question:
 *
 *   "in the summary report, will you check and confirm that the child support
 *    is included in the garnishments page. I will need it as well."
 *
 * Answering it honestly turned up the largest instance of standing rule 50 -
 * dead code wearing a green check - in this repository. `garnishment-core.ts`
 * (the full CCPA 50/55/60/65 support matrix, RCW 26.18.090(2)'s stricter
 * Washington cap, the 30x-minimum-wage floor), `garnishment-authorities.ts`
 * (eleven verbatim legal texts) and `garnishment-mentor.ts` (862 lines of
 * teaching) were all complete, all tested, all green - and imported by NO
 * screen. `grep -rln garnishment src/app src/components` returned nothing.
 *
 * Every test passed. Nothing was red. Michael could not reach a word of it.
 *
 * WHAT THIS FILE THEREFORE HAS TO DO
 *
 * Prove the wiring, not the arithmetic. The arithmetic already has gates
 * (garnishment-core's own suite). What had no gate was the question "can a
 * human being actually SEE this?" - so that is what is asserted here:
 *
 *   1) the stripper works              (rule 39 - no vacuous pass)
 *   2) the owner gate is real          (rule 16 - prove it is WIRED)
 *   3) the read failure is not an empty state
 *   4) blocked orders are shown, never silently dropped
 *   5) the screen does no arithmetic of its own
 *   6) every selected authority id resolves in the real registry
 *   7) the mentor layer reaches the screen  (rule 26 + the whole point)
 *   8) child support is on the page by name (Michael's actual question)
 *   9) no invented defaults on unknown data (rule 62d)
 *  10) the page is reachable from the nav  (rule 50, closing the loop)
 *
 * A NOTE ON HONESTY, RECORDED ON PURPOSE
 *
 * The first draft of `GarnishmentWorkbench.tsx` carried a comment claiming
 * "the ids are checked at build time by tests/compliance/garnishment-screen.test.ts
 * ... that gate genuinely exists - it is section 6 of that file". This file did
 * not exist when that sentence was written. A comment asserting a verification
 * nobody performed is the exact defect the phase A audit was built to detect,
 * and it was caught by re-reading the file rather than trusting it. The claim
 * was corrected AND this gate was written before either file was committed, so
 * the sentence is now true and checkable. Section 6 below is the section it
 * names.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adminNav } from "@/components/admin/admin-nav-data";
import { GARNISHMENT_AUTHORITIES } from "@/lib/payroll/garnishment-authorities";
import {
  GARNISHMENT_REVIEW_CHECKS,
  GARNISHMENT_SCREEN_LESSONS,
} from "@/lib/payroll/garnishment-mentor";

const ROOT = join(__dirname, "..", "..");
const PAGE_PATH = join(ROOT, "src/app/admin/books/garnishments/page.tsx");
const VIEW_PATH = join(ROOT, "src/components/admin/books/GarnishmentWorkbench.tsx");
const STORE_PATH = join(ROOT, "src/lib/payroll/garnishment-store.ts");

const pageSrc = readFileSync(PAGE_PATH, "utf8");
const viewSrc = readFileSync(VIEW_PATH, "utf8");
const storeSrc = readFileSync(STORE_PATH, "utf8");

/**
 * Comments stripped, so a rule merely DESCRIBED in prose cannot satisfy a test
 * looking for the rule IMPLEMENTED in code.
 *
 * These three files carry very long headers by design - Michael asked for the
 * teaching to live in the code - and those headers name almost every identifier
 * asserted below. Without this step most of this file would pass on the
 * strength of its own commentary.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const pageCode = stripComments(pageSrc);
const viewCode = stripComments(viewSrc);
const storeCode = stripComments(storeSrc);

/* ══════════════════════════════════════════════════════════════════════════
 * 0) THE STRIPPER ITSELF (standing rule 39: guard the vacuous read)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("0 the comment-stripping helper actually strips", () => {
  it("leaves real code behind", () => {
    // If any of these were empty, every source assertion below would pass
    // vacuously and this entire file would be theatre.
    expect(pageCode.length).toBeGreaterThan(400);
    expect(viewCode.length).toBeGreaterThan(2000);
    expect(storeCode.length).toBeGreaterThan(2000);
  });

  it("removes block comments and line comments", () => {
    const sample = "/* hidden */ const a = 1; // trailing\nconst b = 2;";
    const out = stripComments(sample);
    expect(out).not.toContain("hidden");
    expect(out).not.toContain("trailing");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
  });

  it("does not eat the // inside a URL", () => {
    // The `[^:]` guard exists for this. If it regressed, "https://..." would
    // truncate and unrelated assertions would start failing mysteriously.
    expect(stripComments('const u = "https://example.com/x";')).toContain("https://example.com/x");
  });

  it("the headers really were stripped, not just shortened", () => {
    // Positive control: a phrase that exists ONLY in prose must be gone.
    expect(viewSrc).toContain("wall of text nobody reads");
    expect(viewCode).not.toContain("wall of text nobody reads");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1) THE OWNER GATE (standing rule 16: prove the gate is WIRED)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("1 the owner gate protects the render", () => {
  it("the page calls requireBooksAccess before it reads anything", () => {
    /*
     * A wage order names the employee, the case number, the custodial parent
     * and the amount owed. It is among the most sensitive rows in the system.
     * The store runs as the SERVICE ROLE, which bypasses 0198's RLS policies
     * entirely - so this call is the real gate, not a second opinion.
     */
    expect(pageCode).toContain("await requireBooksAccess()");

    const gateAt = pageCode.indexOf("requireBooksAccess()");
    const readAt = pageCode.indexOf("loadGarnishmentBoard(");
    expect(gateAt, "requireBooksAccess is not called on this page").toBeGreaterThan(-1);
    expect(readAt, "loadGarnishmentBoard is not called on this page").toBeGreaterThan(-1);
    expect(
      gateAt,
      "the data is read BEFORE the permission check - reordering these two lines " +
        "silently exposes every wage order to any signed-in staff member",
    ).toBeLessThan(readAt);
  });

  it("the page is force-dynamic, so the gate cannot be cached away", () => {
    // A statically rendered page runs its gate at BUILD time, once, as nobody.
    // The result would then be served to everyone.
    expect(pageCode).toContain('export const dynamic = "force-dynamic"');
  });

  it("the store is server-only, so this data cannot be pulled into a bundle", () => {
    expect(storeCode).toContain('import "server-only"');
  });

  it("the view is a client component and never imports the store's runtime", () => {
    // It may import the store's TYPES - erased at compile time - but importing
    // the module itself would drag service-role credentials toward the browser.
    expect(viewCode).toContain('"use client"');
    expect(viewCode).toContain('import type { WageOrderDetail, WorkedExample }');
    expect(
      viewCode,
      "the workbench imports the store as a VALUE, not just a type - that is a " +
        "service-role module heading for the client bundle",
    ).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+"@\/lib\/payroll\/garnishment-store"/m);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) A READ FAILURE IS A READ FAILURE, NOT AN EMPTY LIST
 * ══════════════════════════════════════════════════════════════════════════ */

describe("2 a failed read never renders as 'no garnishments on file'", () => {
  it("the page branches on board.ok before rendering the workbench", () => {
    /*
     * "There are no orders" and "the orders could not be read" look identical
     * on screen and mean opposite things. One of them means a live court order
     * is being ignored, and the penalty for ignoring an income withholding
     * order lands on the EMPLOYER.
     */
    expect(pageCode).toContain("!board.ok");
    const branchAt = pageCode.indexOf("!board.ok");
    const renderAt = pageCode.indexOf("<GarnishmentWorkbench");
    expect(renderAt).toBeGreaterThan(-1);
    expect(branchAt).toBeLessThan(renderAt);
  });

  it("the failure card shows the real message and says nothing was calculated", () => {
    expect(pageCode).toContain("{board.message}");
    expect(pageSrc).toContain("could not load its data");
    expect(pageSrc).toContain("NOT confirmation that there are no orders");
  });

  it("the store returns a typed failure rather than throwing", () => {
    // A throw here becomes a 500, and a 500 is indistinguishable from "the
    // whole site is down" to the person who needs to run payroll today.
    expect(storeCode).toContain('code: "NOT_CONFIGURED"');
    expect(storeCode).toContain('code: "READ_FAILED"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) BLOCKED ORDERS ARE SHOWN LOUDLY, NEVER DROPPED
 * ══════════════════════════════════════════════════════════════════════════ */

describe("3 an order the calculator cannot handle is shown, not hidden", () => {
  it("an unrecognised order_kind becomes a BLOCKED row, not a skipped one", () => {
    /*
     * `toWageOrder` returns null for a kind the engine does not know. The
     * tempting implementation is `if (order === null) continue;`. That would
     * drop a live legal obligation off the board with no error anywhere.
     */
    expect(storeCode).toContain("if (order === null)");
    expect(storeCode).toContain("which the calculator does not");
    expect(storeCode).toContain("Do not withhold against it");

    const nullAt = storeCode.indexOf("if (order === null)");
    const pushAt = storeCode.indexOf("details.push(", nullAt);
    const continueAt = storeCode.indexOf("continue;", nullAt);
    expect(pushAt, "the null branch does not push a row at all").toBeGreaterThan(nullAt);
    expect(
      pushAt,
      "the null branch skips the order instead of reporting it as blocked",
    ).toBeLessThan(continueAt);
  });

  it("a support order missing either determining fact is blocked with the question", () => {
    // These two booleans are the ENTIRE difference between a 50% ceiling and a
    // 65% one. Guessing either way is a wrong answer about a child's support.
    expect(storeCode).toContain("supports_second_family === null");
    expect(storeCode).toContain("arrears_over_twelve_weeks === null");
    expect(storeSrc).toContain("difference between a 50% ceiling and a 60% one");
    expect(storeSrc).toContain("rises");
  });

  it("only orders with nothing missing are handed to the engine", () => {
    expect(storeCode).toMatch(/\.filter\(\s*\(d\)\s*=>\s*d\.missingFacts\.length === 0\s*\)/);
  });

  it("the screen shows the missing questions next to the order they block", () => {
    expect(viewCode).toContain("o.missingFacts.map(");
    expect(viewSrc).toContain("This order is not being calculated yet");
    expect(viewSrc).toContain("under-withholds");
  });

  it("blockedCount counts, and the header reports it", () => {
    expect(storeCode).toMatch(/blockedCount:\s*details\.filter/);
    expect(viewCode).toContain("blockedCount");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) THE SCREEN DOES NO ARITHMETIC
 * ══════════════════════════════════════════════════════════════════════════ */

describe("4 every cent on screen came from the engine", () => {
  it("the view never mentions a legal percentage as a number it could apply", () => {
    /*
     * If this file did its own sums they would eventually disagree with the
     * engine's, silently, on somebody's child support. The percentages appear
     * on this screen only inside chip TEXT and prose - never as an operand.
     *
     * So: no multiplication or division by a bare numeric literal anywhere in
     * the code (comments and strings excluded by the stripper). The two
     * arithmetic operations the view IS allowed are in `money()`, which is
     * cents-to-dollars formatting, and the basis-points-to-percent display
     * conversion - both are re-expressions of a number the engine already
     * decided, not new decisions. They are asserted individually below.
     */
    const allowed = new Set([
      "/ 100",  // basis points -> percent, and cents -> dollars, display only
      "% 100",  // cents -> the pence part
    ]);
    const operations = [...viewCode.matchAll(/[*/%]\s*\d+/g)].map((m) =>
      m[0].replace(/\s+/g, " "),
    );
    const unexpected = operations.filter((op) => !allowed.has(op));
    expect(
      unexpected,
      `The workbench performs arithmetic the engine did not authorise: ${unexpected.join(", ")}. ` +
        `Percentages, caps and floors are garnishment-core's job.`,
    ).toEqual([]);
  });

  it("the extractor is not vacuous - it did find the permitted operations", () => {
    // Rule 39 again: if the regex silently matched nothing, the assertion above
    // would pass on an empty list forever, including after someone added a cap.
    expect([...viewCode.matchAll(/[*/%]\s*\d+/g)].length).toBeGreaterThanOrEqual(2);
  });

  it("withheld, requested, maximum and shortfall are all read from the engine's line", () => {
    expect(viewCode).toContain("line.withheldCents");
    expect(viewCode).toContain("line.requestedCents");
    expect(viewCode).toContain("line.lawfulMaximumCents");
    expect(viewCode).toContain("line.shortfallCents");
  });

  it("the engine's own explanation is rendered, not a re-worded version", () => {
    // The explanation string is where the reasoning lives. Paraphrasing it in
    // JSX is how the screen and the calculation start telling different stories.
    expect(viewCode).toContain("{line.explanation}");
    expect(viewCode).toContain("worked.result.disposable.explanation");
  });

  it("the shortfall is described as still owed, because it is", () => {
    // A capped garnishment is not a discharged one. Telling Michael otherwise
    // would let arrears build silently.
    expect(viewSrc).toContain("stays owed");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) THE PAGE DOES NOT INVENT A PAY PERIOD
 * ══════════════════════════════════════════════════════════════════════════ */

describe("5 no fabricated pay facts", () => {
  it("the page calls loadGarnishmentBoard with no arguments", () => {
    /*
     * Disposable earnings under 15 USC 1672(b) are gross pay minus amounts
     * REQUIRED BY LAW to be withheld, and that figure is produced by the net
     * pay slice, which does not exist yet. Passing an invented gross in to make
     * the screen look finished would print a fabricated number next to a real
     * child's support order.
     */
    expect(pageCode).toContain("loadGarnishmentBoard()");
  });

  it("the store only computes when BOTH pay and wages are supplied", () => {
    expect(storeCode).toMatch(/if\s*\(\s*args\?\.pay\s*&&\s*args\?\.wages\s*\)/);
  });

  it("worked is null until then, and the view renders nothing rather than zeros", () => {
    expect(storeCode).toContain("let worked: WorkedExample | null = null");
    expect(viewCode).toContain("{worked ? (");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6) THE AUTHORITIES ON SCREEN ARE REAL
 *
 * This is the section named by the comment in GarnishmentWorkbench.tsx. If you
 * rename or delete it, correct that comment in the same commit.
 * ══════════════════════════════════════════════════════════════════════════ */

function selectedAuthorityIds(): string[] {
  const start = viewSrc.indexOf("const SELECTED_AUTHORITY_IDS = [");
  expect(start, "SELECTED_AUTHORITY_IDS was renamed or deleted").toBeGreaterThan(-1);
  const end = viewSrc.indexOf("] as const;", start);
  expect(end, "SELECTED_AUTHORITY_IDS is no longer an `as const` array").toBeGreaterThan(start);
  return [...viewSrc.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("6 every authority quoted on this screen actually exists", () => {
  const ids = selectedAuthorityIds();

  it("the extractor found ids at all (rule 39: no vacuous pass)", () => {
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it("every selected authority id resolves in the real registry", () => {
    // A typo here renders a blank card where the law should be - and the JSX
    // uses `if (!a) return null`, so it fails SILENTLY. This is the only thing
    // standing between a typo and a missing statute on Michael's screen.
    const known = new Set(GARNISHMENT_AUTHORITIES.map((a) => a.id));
    const missing = ids.filter((id) => !known.has(id));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `These ids are quoted by GarnishmentWorkbench but do not exist in ` +
            `GARNISHMENT_AUTHORITIES, so the screen renders nothing where the law should ` +
            `be: ${missing.join(", ")}. Real ids: ${[...known].sort().join(", ")}`,
    ).toEqual([]);
  });

  it("each resolved authority carries a real quote, citation and gloss", () => {
    for (const id of ids) {
      const a = GARNISHMENT_AUTHORITIES.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      expect(a!.quote.length, `${id} quote`).toBeGreaterThan(40);
      expect(a!.cite.length, `${id} cite`).toBeGreaterThan(5);
      expect(a!.soWhat.length, `${id} soWhat`).toBeGreaterThan(20);
    }
  });

  it("the four that decide the answer are all present", () => {
    /*
     * Not an arbitrary list. These are the base, the ordinary ceiling, the
     * support ceiling and Washington's stricter support cap - the four texts
     * that between them determine every number this screen can display.
     */
    expect(ids).toContain("usc-15-1672-disposable");
    expect(ids).toContain("usc-15-1673-max-garnishment");
    expect(ids).toContain("usc-15-1673-support-cap");
    expect(ids).toContain("rcw-26-18-090-fifty-percent");
  });

  it("the quote is rendered VERBATIM from the registry, not retyped into JSX", () => {
    // Michael, verbatim: "Please keep including that including the verbatim
    // source text." Retyping it into JSX is how a quotation drifts from the
    // statute it claims to be.
    expect(viewCode).toContain("SELECTED_AUTHORITY_IDS.map(");
    expect(viewCode).toContain("{a.quote}");
    expect(viewCode).toContain("{a.cite}");
    expect(viewCode).toContain("{a.soWhat}");
    expect(viewCode).toContain("<blockquote");
  });

  it("the screen says which part is the law and which part is us", () => {
    expect(viewSrc).toContain("which is the law and which is us");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7) THE MENTOR LAYER REACHES THE SCREEN (rule 26, and the whole point)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("7 the 862 lines of teaching are actually rendered", () => {
  it("the review checklist is imported AND mapped", () => {
    /*
     * Importing it is not enough - phase A found modules that were imported by
     * nothing at all, but an import with no render is the same darkness one
     * step further in. So: assert the map, not the import.
     */
    expect(viewCode).toContain("GARNISHMENT_REVIEW_CHECKS");
    expect(viewCode).toMatch(/GARNISHMENT_REVIEW_CHECKS[\s\S]{0,120}\.map\(/);
  });

  it("the checklist renders in the mentor's stated order, not array order", () => {
    // Relying on array position silently reorders Michael's decision process
    // the next time somebody inserts a check in the middle of the module.
    expect(viewCode).toMatch(/\.sort\(\s*\(a,\s*b\)\s*=>\s*a\.order\s*-\s*b\.order\s*\)/);
  });

  it("each check shows the question, why it is asked there, and the failure path", () => {
    expect(viewCode).toContain("{check.question}");
    expect(viewCode).toContain("{check.whyThisOrder}");
    expect(viewCode).toContain("{check.ifItFails}");
  });

  it("the review checks exist and are non-trivial in the module itself", () => {
    // Guards the reverse failure: a rendered map over an emptied array.
    expect(GARNISHMENT_REVIEW_CHECKS.length).toBeGreaterThanOrEqual(5);
    for (const c of GARNISHMENT_REVIEW_CHECKS) {
      expect(c.question.length, c.key).toBeGreaterThan(10);
      expect(c.whyThisOrder.length, c.key).toBeGreaterThan(20);
      expect(c.ifItFails.length, c.key).toBeGreaterThan(20);
    }
  });

  it("the review checks have a strict order with no duplicates and no gaps", () => {
    // Two checks numbered 3 render as "3." twice, which reads as a bug in the
    // procedure rather than a bug in the data.
    const orders = GARNISHMENT_REVIEW_CHECKS.map((c) => c.order).sort((a, b) => a - b);
    expect(new Set(orders).size, "two review checks share an order number").toBe(orders.length);
    expect(orders).toEqual(orders.map((_, i) => i + 1));
  });

  it("the screen lessons - the traps - are rendered too", () => {
    expect(viewCode).toContain("GARNISHMENT_SCREEN_LESSONS.map(");
    expect(viewCode).toContain("{lesson.topic}");
    expect(viewCode).toContain("{lesson.plainEnglish}");
    expect(viewCode).toContain("{lesson.whyItMatters}");
    expect(GARNISHMENT_SCREEN_LESSONS.length).toBeGreaterThanOrEqual(3);
  });

  it("the refusal shows the fix, not just the complaint", () => {
    // Standing rule 64a: detection is not explanation. A refusal that says
    // "cannot compute" and stops is a dead end for the person holding a court
    // order and a deadline.
    expect(viewCode).toContain("{refusal.message}");
    expect(viewCode).toContain("{refusal.fix}");
    expect(viewSrc).toContain("What to do");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8) CHILD SUPPORT IS ON THE PAGE, BY NAME - MICHAEL'S ACTUAL QUESTION
 * ══════════════════════════════════════════════════════════════════════════ */

describe("8 child support is first-class on this screen", () => {
  it("child support is labelled in Michael's language, with its own ceiling", () => {
    expect(viewCode).toContain("child_support:");
    expect(viewSrc).toContain("Child support");
    expect(viewSrc).toContain("50-65% ceiling, not 25%");
  });

  it("the screen corrects the 25% misconception explicitly", () => {
    /*
     * This is the single most common garnishment error made by competent
     * bookkeepers: applying the familiar 25% consumer-credit ceiling of
     * 15 USC 1673(a) to a support order, which is governed by 1673(b) and can
     * reach 65%. Under-withholding a support order is something an employer can
     * be ordered to pay personally, so the correction is on the screen, not
     * buried in a module.
     */
    expect(viewSrc).toContain("Child support does not stop at 25%");
    expect(viewSrc).toContain("50, 55, 60 or 65");
  });

  it("Washington's stricter 50% cap and the 'kinder ceiling wins' rule are stated", () => {
    expect(viewSrc).toContain("caps support withholding at 50%");
    expect(viewSrc).toContain("stricter");
  });

  it("support-first priority is stated, because two orders can compete", () => {
    expect(viewSrc).toContain("paid FIRST");
  });

  it("the support card only appears when a support order is actually on file", () => {
    // Guidance that is always on screen regardless of context becomes wallpaper.
    // Michael: "as clean as possible so I don't get lost in the guidance helpers."
    expect(viewCode).toContain("supportOrders.length > 0");
    expect(viewCode).toMatch(/orderKind === "child_support"/);
    expect(viewCode).toMatch(/orderKind === "spousal_support"/);
  });

  it("spousal support is treated as a support order too, not as a creditor", () => {
    // 15 USC 1673(b)(1)(A) covers "support of any person", not children only.
    // Filing spousal maintenance under the 25% creditor ceiling would
    // under-withhold it.
    expect(viewCode).toContain("spousal_support:");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9) NO INVENTED DEFAULTS (standing rule 62d)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("9 unknown data is reported as unknown", () => {
  it("an unrecognised order kind prints the raw value, not a friendly guess", () => {
    /*
     * If 0198's CHECK constraint ever gains a sixth kind, Michael must see the
     * unfamiliar value and ask about it - not a confident label sitting over a
     * number nobody validated.
     */
    expect(viewCode).toMatch(/KIND_WORDING\[kind\]\?\.label\s*\?\?/);
    expect(viewCode).toContain("Recorded as");
  });

  it("an unrecognised kind shows NO ceiling chip rather than a wrong one", () => {
    // A wrong ceiling chip is worse than none: it looks authoritative.
    expect(viewCode).toMatch(/KIND_WORDING\[kind\]\?\.ceiling\s*\?\?\s*null/);
    expect(viewCode).toContain("ceiling ? <Badge");
  });

  it("an order stating no amount says so instead of showing $0.00", () => {
    // $0.00 reads as "withhold nothing", which is a withholding instruction.
    // "Not stated" reads as "go and look at the paperwork", which is the truth.
    expect(viewSrc).toContain("Not stated on the order");
  });

  it("a missing employee name is labelled, never left blank", () => {
    expect(storeCode).toContain("(no name on file)");
  });

  it("the store passes the two determining booleans through untouched", () => {
    /*
     * The single most dangerous line that could be written in this codebase is
     * `supportsSecondFamily: row.supports_second_family ?? false`. It is one
     * token long, it type-checks, and it silently converts "we do not know"
     * into "we know, and the answer is no" - which raises the ceiling from 50%
     * to 60% on a real person's paycheque.
     */
    expect(storeCode).toContain("arrearsOverTwelveWeeks: row.arrears_over_twelve_weeks,");
    expect(storeCode).toContain("supportsSecondFamily: row.supports_second_family,");
    expect(storeCode).not.toMatch(/supports_second_family\s*\?\?/);
    expect(storeCode).not.toMatch(/arrears_over_twelve_weeks\s*\?\?/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10) THE PAGE IS REACHABLE (rule 50, closing the loop this slice opened)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("10 a human being can actually get to this screen", () => {
  it("the nav has an entry pointing at the page", () => {
    /*
     * THE ENTIRE REASON THIS SLICE EXISTS. The garnishment engine was complete,
     * correct, tested and green for weeks, and unreachable. This assertion is
     * the one that would have been red the whole time.
     */
    const item = adminNav.find((i) => i.href === "/admin/books/garnishments");
    expect(
      item,
      "there is no nav entry for /admin/books/garnishments - the page exists and " +
        "works and nobody can reach it, which is exactly the defect books-36 was " +
        "opened to fix",
    ).toBeDefined();
  });

  it("it sits in Accounting behind books.view, like every other ledger screen", () => {
    const item = adminNav.find((i) => i.href === "/admin/books/garnishments");
    expect(item!.group).toBe("Accounting");
    expect(item!.permission).toBe("books.view");
    expect(item!.label.length).toBeGreaterThan(3);
  });

  it("the page renders the workbench, so the nav entry does not lead to an empty shell", () => {
    // Reachable and blank is not better than unreachable.
    expect(pageCode).toContain("<GarnishmentWorkbench");
    expect(pageCode).toContain("orders={board.orders}");
    expect(pageCode).toContain("worked={board.worked}");
  });
});
