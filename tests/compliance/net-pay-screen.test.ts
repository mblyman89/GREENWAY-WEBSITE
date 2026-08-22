/**
 * tests/compliance/net-pay-screen.test.ts   (books-37)
 *
 * THE GATE ON THE NET PAY WALKTHROUGH SCREEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "Please proceed with the net pay and the deferred ytd store slice. Please
 *    make sure to include the same level of verbatim authoritative text and
 *    their plain english explanations."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sections 1-4 are BEHAVIOURAL: they run the real engines and check the
 * arithmetic and the refusals. Sections 5-10 are STRUCTURAL: they read the
 * screen's own source and check the wiring.
 *
 * Both halves are necessary, and books-36 is why. `garnishment-core` was
 * correct, tested and reachable from nowhere - 2,500 green lines no human
 * could open. A behavioural test alone would have stayed green through that
 * entire defect. So does a structural test alone, if the engine is wrong.
 *
 * Every assertion below is written to be FAILABLE (standing rule 15). Where an
 * assertion could pass vacuously - a filter that matches nothing, a registry
 * lookup that silently returns undefined - the count is asserted first.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adminNav } from "@/components/admin/admin-nav-data";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import {
  NET_PAY_FIELD_LESSONS,
  NET_PAY_REFUSAL_LESSONS,
  NET_PAY_REVIEW_CHECKS,
  NET_PAY_SCREEN_LESSONS,
} from "@/lib/payroll/net-pay-mentor";
import {
  buildIllustrationScenario,
  buildNetPayWorkedExample,
  orderingHolds,
  payDateReadiness,
} from "@/lib/payroll/net-pay-ui-core";

const ROOT = join(__dirname, "..", "..");
const PAGE_PATH = join(ROOT, "src/app/admin/books/net-pay/page.tsx");
const VIEW_PATH = join(ROOT, "src/components/admin/books/NetPayWorkbench.tsx");
const UI_CORE_PATH = join(ROOT, "src/lib/payroll/net-pay-ui-core.ts");

const pageSrc = readFileSync(PAGE_PATH, "utf8");
const viewSrc = readFileSync(VIEW_PATH, "utf8");
const uiCoreSrc = readFileSync(UI_CORE_PATH, "utf8");

/**
 * Strip comments so a claim made in PROSE cannot satisfy an assertion about
 * CODE. Without this, a file that merely promises to call the access gate in a
 * header comment would pass the test that checks the gate is called.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const pageCode = stripComments(pageSrc);
const viewCode = stripComments(viewSrc);
const uiCoreCode = stripComments(uiCoreSrc);

/**
 * Blank out the CONTENTS of every string literal, keeping the quotes.
 *
 * Needed because the first draft of the "no rate literals" assertion below
 * matched `mt-0.5` and `bg-white/[0.02]` - Tailwind class names, not
 * arithmetic. The tempting fix was to delete the assertion. That would have
 * thrown away the only thing standing between this screen and a hard-coded
 * 0.25 that silently disagrees with the engine.
 *
 * So the assertion was made SHARPER instead. A rate used in arithmetic is bare
 * code; a CSS class is inside a string. Removing string contents keeps the
 * dangerous case detectable and drops the false positive.
 */
function blankStrings(src: string): string {
  return src
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const viewCodeNoStrings = blankStrings(viewCode);

/** The date the screen's illustration is worked on. Must match the page. */
const ILLUSTRATION_DATE = "2026-12-18";
/** Michael's first payroll, biweekly Fridays from 1 January 2027. */
const FIRST_PAYROLL_DATE = "2027-01-01";

describe("0 the comment-stripping helper actually strips", () => {
  it("leaves real code behind", () => {
    // A stripper that ate everything would make every `not.toContain` below
    // pass for the wrong reason. This is the guard on the guard.
    expect(pageCode.length).toBeGreaterThan(1000);
    expect(viewCode.length).toBeGreaterThan(3000);
    expect(uiCoreCode.length).toBeGreaterThan(5000);
  });

  it("the headers really were stripped, not merely shortened", () => {
    expect(pageSrc).toContain("cannot yet be a report of real cheques");
    expect(pageCode).not.toContain("cannot yet be a report of real cheques");
  });

  it("does not eat the // inside a URL", () => {
    expect(stripComments('const u = "https://example.com/x";')).toContain("https://example.com/x");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) THE WATERFALL IS IN STATUTORY ORDER
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("1 gross, less required by law, gives disposable earnings", () => {
  const built = buildIllustrationScenario(ILLUSTRATION_DATE, "child_support");
  const worked = buildNetPayWorkedExample(built.scenario);

  it("the illustration computes on a date whose rates are all on file", () => {
    expect(payDateReadiness(ILLUSTRATION_DATE).canRun).toBe(true);
    expect(worked.ok, "the worked example refused on a date that should compute").toBe(true);
  });

  it("disposable earnings is gross minus the required bucket, exactly", () => {
    if (!worked.ok) throw new Error("precondition: the example must compute");
    const b = worked.breakdown;
    expect(b.disposableEarningsCents).toBe(b.grossWagesCents - b.requiredByLaw.totalCents);
  });

  it("disposable earnings sits strictly between net pay and gross", () => {
    if (!worked.ok) throw new Error("precondition: the example must compute");
    const b = worked.breakdown;
    // Not a tautology: this is only true when the garnishment came off AFTER
    // disposable earnings was struck. If a voluntary deduction were wrongly
    // folded into the required bucket, disposable would collapse toward net.
    expect(b.netPayCents).toBeLessThan(b.disposableEarningsCents);
    expect(b.disposableEarningsCents).toBeLessThan(b.grossWagesCents);
    expect(orderingHolds(b)).toBe(true);
  });

  it("the parts add back up to net pay with no rounding drift", () => {
    if (!worked.ok) throw new Error("precondition: the example must compute");
    expect(worked.reconciliation.balanced).toBe(true);
    expect(worked.reconciliation.differenceCents).toBe(0);
  });

  it("the garnishment is the lesser of the statutory tests, checked by hand", () => {
    if (!worked.ok) throw new Error("precondition: the example must compute");
    const b = worked.breakdown;
    const disposable = b.disposableEarningsCents;

    // 25% of disposable, as the order asks.
    const asked = Math.floor(disposable * 0.25);
    // RCW 26.18.090(2) caps a support order at 50% of disposable in Washington,
    // which is stricter than the 60% the CCPA would allow for this employee.
    const stateCeiling = Math.floor(disposable * 0.5);

    expect(b.totalGarnishedCents).toBe(Math.min(asked, stateCeiling));
    expect(b.totalGarnishedCents).toBeLessThan(stateCeiling);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) THE L&I PREMIUM IS INSIDE THE REQUIRED BUCKET
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("2 the L&I premium is required by law, not voluntary", () => {
  const built = buildIllustrationScenario(ILLUSTRATION_DATE, "child_support");
  const worked = buildNetPayWorkedExample(built.scenario);

  it("an L&I line is present in the required-by-law itemisation", () => {
    if (!worked.ok) throw new Error("precondition: the example must compute");
    // Rule 39: assert the filter matched before asserting anything about it.
    const lni = worked.requiredLines.filter((l) => /L&I/.test(l.label));
    expect(lni).toHaveLength(1);
    expect(lni[0].amountCents).toBeGreaterThan(0);
  });

  it("the L&I line cites RCW 51.16.140, which is what makes it required", () => {
    if (!worked.ok) throw new Error("precondition: the example must compute");
    const lni = worked.requiredLines.find((l) => /L&I/.test(l.label));
    expect(lni).toBeDefined();
    expect(lni!.authorityId).toBe("rcw-51-16-140-lni-deduction");
    // The authority must RESOLVE. An id that points at nothing renders a blank.
    expect(findGuidanceAuthority(lni!.authorityId)).toBeDefined();
  });

  it("omitting it would over-garnish, which is why it is in the base", () => {
    if (!worked.ok) throw new Error("precondition: the example must compute");
    const b = worked.breakdown;
    const lni = worked.requiredLines.find((l) => /L&I/.test(l.label))!;

    // If L&I were left out, disposable earnings would be HIGHER by exactly the
    // premium - and 25% of a higher base takes more from the employee. This
    // quantifies the defect books-37 fixed rather than asserting it in prose.
    const wrongDisposable = b.disposableEarningsCents + lni.amountCents;
    expect(wrongDisposable).toBeGreaterThan(b.disposableEarningsCents);
    expect(Math.floor(wrongDisposable * 0.25)).toBeGreaterThan(b.totalGarnishedCents);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) A MISSING RATE REFUSES; IT NEVER WITHHOLDS ZERO
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("3 an unevidenced rate stops the cheque", () => {
  it("Michael's first payroll date refuses rather than computing", () => {
    // THE DEFECT THIS GUARDS. With `?? 0`, this date returned ok:true with PFML
    // withheld at $0.00 - a tidy cheque, silently wrong, and with disposable
    // earnings too HIGH so the garnishment took too much.
    const built = buildIllustrationScenario(FIRST_PAYROLL_DATE, "child_support");
    const worked = buildNetPayWorkedExample(built.scenario);
    expect(worked.ok).toBe(false);
    if (worked.ok) throw new Error("unreachable");
    expect(worked.refusals.length).toBeGreaterThan(0);
    expect(worked.missingRates.length).toBeGreaterThan(0);
  });

  it("every refusal names a code the mentor layer can explain", () => {
    const built = buildIllustrationScenario(FIRST_PAYROLL_DATE, "child_support");
    const worked = buildNetPayWorkedExample(built.scenario);
    if (worked.ok) throw new Error("precondition: this date must refuse");
    const taught = new Set(NET_PAY_REFUSAL_LESSONS.map((l) => l.code as string));
    for (const r of worked.refusals) {
      expect(taught.has(r.code), `refusal ${r.code} reaches the screen unexplained`).toBe(true);
    }
  });

  it("every refusal carries a concrete action, not just a diagnosis", () => {
    // Standing rule 64a: detection is not explanation.
    const built = buildIllustrationScenario(FIRST_PAYROLL_DATE, "child_support");
    const worked = buildNetPayWorkedExample(built.scenario);
    if (worked.ok) throw new Error("precondition: this date must refuse");
    for (const r of worked.refusals) {
      expect(r.message.length).toBeGreaterThan(40);
      expect(r.whatToDo.length).toBeGreaterThan(10);
    }
  });

  it("the ui-core never falls back to a zero rate", () => {
    // The literal `?? 0` on a rate is the defect. It must not come back.
    expect(uiCoreCode).not.toMatch(/pfmlTotal\s*\?\?\s*0/);
    expect(uiCoreCode).not.toMatch(/waCares\s*\?\?\s*0/);
    expect(uiCoreCode).toContain("SILENTLY_ZEROABLE");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) READINESS IS A FUNCTION OF A DATE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("4 whether the first payroll can run is computed, not remembered", () => {
  it("a fully-evidenced date reports that it can run", () => {
    const r = payDateReadiness(ILLUSTRATION_DATE);
    expect(r.canRun).toBe(true);
    expect(r.missingCount).toBe(0);
    expect(r.rates.length).toBeGreaterThan(5);
  });

  it("Michael's first payroll date reports that it cannot", () => {
    const r = payDateReadiness(FIRST_PAYROLL_DATE);
    expect(r.canRun).toBe(false);
    expect(r.missingCount).toBeGreaterThan(0);
  });

  it("the summary NAMES the missing rates instead of counting them", () => {
    // "7 rates missing" says there is a problem. Naming them says which
    // agencies to chase, which is the difference between a warning and a task.
    const r = payDateReadiness(FIRST_PAYROLL_DATE);
    const missing = r.rates.filter((x) => !x.onFile);
    expect(missing.length).toBeGreaterThan(0);
    for (const m of missing) {
      expect(r.summary).toContain(m.label);
      expect(m.why).toBeTruthy();
      expect(m.whatToDo).toBeTruthy();
    }
  });

  it("a date nobody has any rate for is fully missing, not partly", () => {
    // Proves the check can reach its extreme rather than always finding a few.
    const r = payDateReadiness("2099-01-01");
    expect(r.canRun).toBe(false);
    expect(r.missingCount).toBe(r.rates.length);
  });

  it("the check iterates the registry rather than a hand-typed list", () => {
    // A hand-typed list silently skips the twelfth rate somebody adds later.
    expect(uiCoreCode).toContain("ALL_PAYROLL_RATE_KEYS.map");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) THE OWNER GATE PROTECTS THE RENDER
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("5 the owner gate protects the render", () => {
  it("requireBooksAccess is called BEFORE anything is computed", () => {
    const gateAt = pageCode.indexOf("requireBooksAccess()");
    const workAt = pageCode.indexOf("payDateReadiness(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(workAt).toBeGreaterThan(-1);
    expect(gateAt, "work happens before the permission check").toBeLessThan(workAt);
  });

  it("the page is force-dynamic so the gate cannot be cached away", () => {
    expect(pageCode).toContain('export const dynamic = "force-dynamic"');
  });

  it("the workbench is a client component doing no server work", () => {
    expect(viewCode).toContain('"use client"');
    // Standing rule 65b: a service-role or node-only module imported as a VALUE
    // from a client component is heading for the browser bundle.
    expect(viewCode).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+"@\/lib\/payroll\/ytd-store"/m);
    expect(viewCode).not.toContain("node:fs");
    expect(viewCode).not.toContain("server-only");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) THE SCREEN DOES NO ARITHMETIC OF ITS OWN
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("6 every number on screen came from the engine", () => {
  it("the workbench contains no percentage, cap or subtraction of money", () => {
    /*
     * If the component did its own sums they would eventually disagree with the
     * engine's - silently, on somebody's paycheque. So it may FORMAT money and
     * nothing else. `i + 1` for a list ordinal is not money.
     */
    expect(viewCodeNoStrings).not.toMatch(/\d*\.\d+/); // a rate literal
    expect(viewCodeNoStrings).not.toMatch(/Cents\s*[-+*/]\s*\w*Cents/); // money arithmetic
    expect(viewCodeNoStrings).not.toMatch(/Math\.(floor|round|min|max)\s*\(/);
  });

  it("the no-arithmetic check can actually FAIL", () => {
    /*
     * Standing rule 15. A `not.toMatch` that can never match is decoration.
     * These prove each pattern bites on the code it is meant to catch, and that
     * `blankStrings` did not simply erase the whole file.
     */
    expect(blankStrings('const x = "mt-0.5";')).not.toMatch(/\d*\.\d+/);
    expect(blankStrings("const rate = 0.25;")).toMatch(/\d*\.\d+/);
    expect(blankStrings("const d = grossCents - taxCents;")).toMatch(
      /Cents\s*[-+*/]\s*\w*Cents/,
    );
    expect(blankStrings("Math.floor(x)")).toMatch(/Math\.(floor|round|min|max)\s*\(/);
    expect(viewCodeNoStrings.length).toBeGreaterThan(1500);
  });

  it("it formats money through the shared helper rather than toFixed", () => {
    expect(viewCode).toContain("formatCentsPlain");
    expect(viewCode).not.toContain("toFixed");
  });

  it("the reconciliation shown is the engine's, run and reported", () => {
    // Not asserted quietly and not hidden behind a green tick.
    expect(viewCode).toContain("worked.reconciliation.balanced");
    expect(viewCode).toContain("orderingHolds");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7) NOTHING ON THE SCREEN IS INVENTED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("7 the illustration derives its inputs from evidence", () => {
  it("the pay rate is the minimum wage row, not a typed figure", () => {
    const built = buildIllustrationScenario(ILLUSTRATION_DATE, "child_support");
    expect(built.hourlyRateMilliCents).not.toBeNull();
    // Gross must equal rate x 80 hours exactly. A typed gross would not.
    expect(built.scenario.grossWagesCents).toBe(
      Math.round((built.hourlyRateMilliCents! * 80) / 1000),
    );
  });

  it("hours charged to L&I match the hours the gross was built from", () => {
    // L&I is charged per HOUR. A mismatch here would misstate the premium.
    const built = buildIllustrationScenario(ILLUSTRATION_DATE, "child_support");
    expect(built.scenario.hundredthHours).toBe(80 * 100);
    expect(built.scenario.workweeksInPeriod).toBe(2);
  });

  it("with no minimum wage on file it derives nothing and refuses", () => {
    // The honest failure: no rate means no gross, not a plausible-looking one.
    const built = buildIllustrationScenario(FIRST_PAYROLL_DATE, "child_support");
    expect(built.hourlyRateMilliCents).toBeNull();
    expect(built.scenario.grossWagesCents).toBe(0);
  });

  it("the screen says out loud that it is an illustration", () => {
    // The reader must never mistake this for a record of a real cheque.
    const built = buildIllustrationScenario(ILLUSTRATION_DATE, "child_support");
    expect(built.provenance).toContain("ILLUSTRATION");
    expect(built.provenance).toContain("not a record of a cheque anybody was paid");
    expect(built.provenance).toContain("17.13");
  });

  it("the support order's two determining facts are both supplied", () => {
    // A support order with either fact null REFUSES, because those two pick the
    // row of the 15 USC 1673(b)(2) matrix. Supplying them is what lets the
    // example demonstrate arithmetic instead of a refusal.
    const built = buildIllustrationScenario(ILLUSTRATION_DATE, "child_support");
    expect(built.scenario.orders).toHaveLength(1);
    const o = built.scenario.orders[0];
    expect(o.orderKind).toBe("child_support");
    expect(o.arrearsOverTwelveWeeks).not.toBeNull();
    expect(o.supportsSecondFamily).not.toBeNull();
    expect(o.caseNumber).toContain("NOT A REAL CASE");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8) EVERY AUTHORITY QUOTED ON THIS SCREEN EXISTS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("8 the authority ids resolve against the real registry", () => {
  /**
   * Read the ids out of the component's own source rather than re-typing them
   * here. A hand-copied list in the test drifts from the screen and then proves
   * nothing about the screen (standing rule 50).
   */
  function selectedAuthorityIds(): string[] {
    const block = viewCode.match(/SELECTED_AUTHORITY_IDS\s*=\s*\[([\s\S]*?)\]/);
    if (!block) return [];
    return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }

  it("the extractor actually found ids", () => {
    // Rule 39: without this, an extractor that matched nothing would make the
    // loop below iterate zero times and pass.
    expect(selectedAuthorityIds().length).toBeGreaterThanOrEqual(4);
  });

  it("every id resolves to a real authority with a real citation", () => {
    for (const id of selectedAuthorityIds()) {
      const found = findGuidanceAuthority(id);
      expect(found, `authority "${id}" is quoted on screen but does not exist`).toBeDefined();
      expect(found!.cite.length).toBeGreaterThan(5);
    }
  });

  it("the statutory base of disposable earnings is among them", () => {
    // 15 USC 1672(b) is the definition the whole screen turns on. If it ever
    // stopped being cited here, the screen would teach the order without the
    // authority for it.
    expect(selectedAuthorityIds()).toContain("net-pay-usc-15-1672-base");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9) THE TEACHING IS RENDERED, AND SELECTED BY TOPIC NOT BY INDEX
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("9 the mentor layer actually reaches the screen", () => {
  function selectedTopics(): string[] {
    const block = viewCode.match(/SELECTED_LESSON_TOPICS\s*=\s*\[([\s\S]*?)\]/);
    if (!block) return [];
    return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }

  it("the extractor actually found topics", () => {
    expect(selectedTopics().length).toBeGreaterThanOrEqual(3);
  });

  it("every selected topic matches exactly one real lesson", () => {
    // Exactly one, not at least one: two lessons sharing a topic would render
    // twice and hide the duplicate.
    for (const topic of selectedTopics()) {
      const hits = NET_PAY_SCREEN_LESSONS.filter((l) => l.topic === topic);
      expect(hits, `topic "${topic}" resolves to ${hits.length} lessons`).toHaveLength(1);
    }
  });

  it("lessons are chosen by topic string, never by array index", () => {
    // An index quietly points at a different lesson the moment somebody inserts
    // one above it - and nothing goes red, because a lesson still renders.
    expect(viewCode).toContain("SELECTED_LESSON_TOPICS");
    expect(viewCode).not.toMatch(/NET_PAY_SCREEN_LESSONS\[\d+\]/);
    expect(viewCode).not.toMatch(/NET_PAY_FIELD_LESSONS\[\d+\]/);
  });

  it("the two figures people confuse both carry a trap lesson", () => {
    for (const field of ["disposableEarningsCents", "netPayCents"]) {
      const hits = NET_PAY_FIELD_LESSONS.filter((l) => l.field === field);
      expect(hits, `field "${field}" has ${hits.length} lessons`).toHaveLength(1);
      expect(hits[0].theTrap.length).toBeGreaterThan(30);
      expect(hits[0].howToBeSure.length).toBeGreaterThan(20);
    }
    expect(viewCode).toContain("disposableEarningsCents");
    expect(viewCode).toContain("netPayCents");
  });

  it("the pre-flight checks are rendered as questions, and there are some", () => {
    expect(NET_PAY_REVIEW_CHECKS.length).toBeGreaterThanOrEqual(5);
    for (const c of NET_PAY_REVIEW_CHECKS) {
      expect(c.question.endsWith("?"), `"${c.question}" is not a question`).toBe(true);
      expect(c.howToCheck.length).toBeGreaterThan(20);
    }
    expect(viewCode).toContain("NET_PAY_REVIEW_CHECKS");
  });

  it("a refusal is paired with its lesson, so it is never a bare code", () => {
    expect(viewCode).toContain("NET_PAY_REFUSAL_LESSONS.find");
    expect(viewCode).toContain("l.code === r.code");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10) A HUMAN BEING CAN GET TO THIS SCREEN
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("10 the screen is reachable and guarded", () => {
  it("a nav entry points at it", () => {
    // The books-36 lesson: a correct, tested engine with no door is dead code
    // wearing a green check (standing rule 50).
    const item = adminNav.filter((i) => i.href === "/admin/books/net-pay");
    expect(item).toHaveLength(1);
    expect(item[0].permission).toBe("books.view");
    expect(item[0].group).toBe("Accounting");
  });

  it("the year-to-date screen is reachable too, since it feeds this one", () => {
    const item = adminNav.filter((i) => i.href === "/admin/books/ytd");
    expect(item).toHaveLength(1);
    expect(item[0].permission).toBe("books.view");
  });

  it("the readiness banner is rendered above the worked example", () => {
    // Order matters. The example proves the arithmetic; the banner answers the
    // question Michael needs answered before January.
    const bannerAt = pageCode.indexOf("readiness.canRun");
    const exampleAt = pageCode.indexOf("<NetPayWorkbench");
    expect(bannerAt).toBeGreaterThan(-1);
    expect(exampleAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeLessThan(exampleAt);
  });

  it("the missing-rate list on the page is driven by the check, not typed", () => {
    expect(pageCode).toContain("readiness.rates");
    expect(pageCode).toContain("filter((r) => !r.onFile)");
  });
});
