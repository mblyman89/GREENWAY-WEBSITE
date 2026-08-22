/**
 * tests/compliance/generosity-board.test.ts   (books-36)
 *
 * THE GATE ON THE SICK LEAVE BALANCES / GENEROSITY SCREEN.
 *
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 *
 *   "I use the legally required minimum, it's easier that way, I give extra on
 *    demand, I don't want to try and figure out a complex formula to accumulate
 *    sick time. I just need a smart and easy to use tool that tracks their sick
 *    time, including if it goes negative. I want to keep track of how generous
 *    I am being."
 *
 * Four requirements. This file asserts all four are true in code, not in prose:
 *
 *   1. accrual stays at the statutory floor and is not silently changed
 *   2. gifts are recorded as gifts and stay in their own bucket
 *   3. the generosity is totalled - given, used, outstanding
 *   4. a negative balance is SHOWN, never clamped to zero
 *
 * Sections 1-4 are behavioural: they run the real engine against constructed
 * ledgers and check the arithmetic. Sections 5-10 are structural: they read the
 * screen's source and check the wiring. Both are needed, because a correct
 * engine nobody can see is exactly the defect books-36 was opened to fix.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adminNav } from "@/components/admin/admin-nav-data";
import { SICK_LEAVE_AUTHORITIES } from "@/lib/payroll/sick-leave-authorities";
import { SICK_LEAVE_SCREEN_LESSONS } from "@/lib/payroll/sick-leave-mentor";
import {
  computeBalance,
  generosityLineFor,
  planAward,
  planDraw,
  summariseGenerosity,
  STATUTORY_ACCRUAL_HUNDREDTH_MINUTES_PER_HOUR,
  type SickLeaveLedgerEntry,
} from "@/lib/payroll/sick-leave-core";

const ROOT = join(__dirname, "..", "..");
const PAGE_PATH = join(ROOT, "src/app/admin/books/sick-leave-balances/page.tsx");
const VIEW_PATH = join(ROOT, "src/components/admin/books/SickLeaveGenerosityBoard.tsx");
const STORE_PATH = join(ROOT, "src/lib/payroll/sick-leave-store.ts");
const CORE_PATH = join(ROOT, "src/lib/payroll/sick-leave-core.ts");

const pageSrc = readFileSync(PAGE_PATH, "utf8");
const viewSrc = readFileSync(VIEW_PATH, "utf8");
const storeSrc = readFileSync(STORE_PATH, "utf8");
const coreSrc = readFileSync(CORE_PATH, "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const pageCode = stripComments(pageSrc);
const viewCode = stripComments(viewSrc);
const storeCode = stripComments(storeSrc);
const coreCode = stripComments(coreSrc);

/** Build a ledger entry without repeating the shape fifteen times. */
let seq = 0;
function entry(
  kind: SickLeaveLedgerEntry["entryKind"],
  minutes: number,
  drawnFrom: SickLeaveLedgerEntry["drawnFrom"] = null,
): SickLeaveLedgerEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    entryKind: kind,
    minutes,
    drawnFrom,
    effectiveDate: "2027-03-01",
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 0) THE STRIPPER (rule 39: no vacuous pass)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("0 the comment-stripping helper actually strips", () => {
  it("leaves real code behind", () => {
    expect(pageCode.length).toBeGreaterThan(400);
    expect(viewCode.length).toBeGreaterThan(2000);
    expect(storeCode.length).toBeGreaterThan(2000);
    expect(coreCode.length).toBeGreaterThan(2000);
  });

  it("the headers really were stripped, not merely shortened", () => {
    expect(viewSrc).toContain("one character of tidying");
    expect(viewCode).not.toContain("one character of tidying");
  });

  it("does not eat the // inside a URL", () => {
    expect(stripComments('const u = "https://example.com/x";')).toContain("https://example.com/x");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1) REQUIREMENT 1 - THE STATUTORY FLOOR
 * ══════════════════════════════════════════════════════════════════════════ */

describe("1 the legal minimum is the legal minimum", () => {
  it("the floor is 150 hundredth-minutes per hour, which IS one hour per forty", () => {
    /*
     * RCW 49.46.210(1)(a): one hour of paid sick leave for every forty hours
     * worked. Forty hours x 1.50 hundredth-minutes = 60 hundredth-minutes...
     * no. Work it in the units the schema actually uses:
     *
     *   150 hundredth-minutes per hour = 1.50 minutes per hour worked
     *   1.50 minutes x 40 hours = 60 minutes = one hour.
     *
     * Exactly the statute. This assertion exists because that conversion is
     * easy to get wrong by a factor of ten, and a factor of ten here is a
     * wage-and-hour violation on every paycheque.
     */
    expect(STATUTORY_ACCRUAL_HUNDREDTH_MINUTES_PER_HOUR).toBe(150);
    expect((STATUTORY_ACCRUAL_HUNDREDTH_MINUTES_PER_HOUR / 100) * 40).toBe(60);
  });

  it("the store recognises the floor and says so, rather than assuming it", () => {
    expect(storeCode).toContain("STATUTORY_ACCRUAL_HUNDREDTH_MINUTES_PER_HOUR");
    expect(storeCode).toContain("accruesAtStatutoryFloor");
  });

  it("an unset accrual rate reports as unknown, not as 'at the minimum'", () => {
    /*
     * Standing rule 62d. "No rate on file" and "on the legal floor" are
     * different facts, and conflating them would tell Michael he is compliant
     * when in fact nothing is accruing at all.
     */
    expect(storeCode).toContain("let accruesAtStatutoryFloor: boolean | null = null");
    expect(storeSrc).toContain("No accrual rate has been set yet, so nothing is accruing");
  });

  it("the screen distinguishes all three states with different chips", () => {
    expect(viewCode).toContain("accruesAtStatutoryFloor === true");
    expect(viewCode).toContain("accruesAtStatutoryFloor === false");
    expect(viewSrc).toContain("At the legal minimum");
    expect(viewSrc).toContain("Above the legal minimum");
    expect(viewSrc).toContain("Accrual rate unknown");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) REQUIREMENT 2 - A GIFT STAYS A GIFT
 * ══════════════════════════════════════════════════════════════════════════ */

describe("2 gifted leave never becomes earned leave", () => {
  it("an award lands in the awarded bucket, not the statutory one", () => {
    const b = computeBalance([entry("accrual", 600), entry("award", 480)]);
    expect(b.statutoryMinutes).toBe(600);
    expect(b.awardedMinutes).toBe(480);
    expect(b.totalMinutes).toBe(1080);
  });

  it("earned hours are spent before gifted hours", () => {
    /*
     * THIS IS THE RULE THAT MAKES GENEROSITY AFFORDABLE. Earned leave must be
     * carried over at year end under WAC 296-128-620(4); gifted leave need not
     * be. Spending earned first means the balance left at 31 December is as
     * heavily gifted as possible, which is the balance Michael is NOT required
     * to carry. Reverse the draw order and every gift silently converts into a
     * permanent obligation.
     */
    const balance = computeBalance([entry("accrual", 600), entry("award", 480)]);
    const plan = planDraw(balance, 720);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.fromStatutoryMinutes).toBe(600);
    expect(plan.value.fromAwardedMinutes).toBe(120);
  });

  it("an award with no written reason is refused", () => {
    // A positive adjustment with no explanation cannot be told apart from a
    // typing mistake six months later, and it is exactly what an auditor asks
    // about. Standing rule 64a.
    const bad = planAward({ minutes: 480, reason: "" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.refusals.some((r) => r.code === "AWARD_WITHOUT_REASON")).toBe(true);
  });

  it("a good award is accepted and explains itself", () => {
    const good = planAward({ minutes: 480, reason: "covered a shift when his kid was sick" });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.value.bucket).toBe("awarded");
    expect(good.value.minutes).toBe(480);
    expect(good.value.explanation.length).toBeGreaterThan(40);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) REQUIREMENT 3 - THE GENEROSITY IS TOTALLED
 * ══════════════════════════════════════════════════════════════════════════ */

describe("3 how generous have I been, answered three ways", () => {
  const entries = [
    entry("accrual", 600),
    entry("award", 480),
    entry("award", 120),
    entry("usage", -300, "statutory"),
    entry("usage", -240, "awarded"),
  ];

  it("gross, used and outstanding are three DIFFERENT numbers, all reported", () => {
    /*
     * "How generous have I been" has three defensible answers and they differ.
     * Reporting only one would answer a question Michael did not ask.
     */
    const line = generosityLineFor({ employeeId: "u1", employeeName: "Angela", entries });
    expect(line.awardedEverMinutes).toBe(600); // 480 + 120 ever given
    expect(line.awardedUsedMinutes).toBe(240); // spent out of the gift
    expect(line.awardedMinutes).toBe(360); // still sitting there
    expect(line.statutoryMinutes).toBe(300); // 600 earned - 300 used
    expect(line.totalMinutes).toBe(660);
  });

  it("outstanding really is ever-minus-used, so the three cannot disagree", () => {
    const line = generosityLineFor({ employeeId: "u1", employeeName: "Angela", entries });
    expect(line.awardedMinutes).toBe(line.awardedEverMinutes - line.awardedUsedMinutes);
  });

  it("the roll-up adds up across people", () => {
    const a = generosityLineFor({ employeeId: "u1", employeeName: "Angela", entries });
    const b = generosityLineFor({
      employeeId: "u2",
      employeeName: "Ben",
      entries: [entry("accrual", 1200), entry("award", 60)],
    });
    const s = summariseGenerosity([a, b]);
    expect(s.totalAwardedEverMinutes).toBe(660);
    expect(s.totalAwardedUsedMinutes).toBe(240);
    expect(s.totalAwardedOutstandingMinutes).toBe(420);
    expect(s.totalStatutoryOutstandingMinutes).toBe(1500);
    expect(s.negativeCount).toBe(0);
  });

  it("having given nothing is stated plainly, not shown as a blank", () => {
    const s = summariseGenerosity([
      generosityLineFor({
        employeeId: "u1",
        employeeName: "Angela",
        entries: [entry("accrual", 600)],
      }),
    ]);
    expect(s.totalAwardedEverMinutes).toBe(0);
    expect(s.explanation).toContain("have not given any sick leave beyond what the law requires");
  });

  it("the explanation states that gifted hours need not be carried over", () => {
    // The single fact that makes the whole two-bucket design worth having.
    const s = summariseGenerosity([
      generosityLineFor({
        employeeId: "u1",
        employeeName: "Angela",
        entries: [entry("award", 480)],
      }),
    ]);
    expect(s.explanation).toContain("not");
    expect(s.explanation).toContain("carry them over");
  });

  it("a forfeit is NOT counted as generosity used", () => {
    /*
     * 0198's `sick_leave_ledger_draw_only_on_usage` permits `drawn_from` on
     * usage rows only, so a forfeit carries no bucket and section 6 charges it
     * to statutory. It must never inflate the "gift used" figure - forfeiting
     * hours at a carryover cap is not an act of generosity.
     */
    const line = generosityLineFor({
      employeeId: "u1",
      employeeName: "Angela",
      entries: [entry("accrual", 3000), entry("forfeit", -600)],
    });
    expect(line.awardedUsedMinutes).toBe(0);
    expect(line.awardedEverMinutes).toBe(0);
    expect(line.statutoryMinutes).toBe(2400);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) REQUIREMENT 4 - NEGATIVE MEANS NEGATIVE
 * ══════════════════════════════════════════════════════════════════════════ */

describe("4 a negative balance is shown, never clamped", () => {
  it("an over-sized payout drives the earned bucket below zero and says so", () => {
    const line = generosityLineFor({
      employeeId: "u1",
      employeeName: "Angela",
      entries: [entry("accrual", 600), entry("payout", -900)],
    });
    expect(line.statutoryMinutes).toBe(-300);
    expect(line.isNegative).toBe(true);
    expect(line.negativeExplanation).toContain("Angela");
    expect(line.negativeExplanation).toContain("below zero");
  });

  it("a negative correction against the gift is caught too", () => {
    const line = generosityLineFor({
      employeeId: "u2",
      employeeName: "Ben",
      entries: [entry("award", 60), entry("usage", -600, "awarded")],
    });
    expect(line.awardedMinutes).toBe(-540);
    expect(line.isNegative).toBe(true);
    expect(line.negativeExplanation).toContain("gifted leave");
  });

  it("the explanation says WHERE it came from, not just THAT it happened", () => {
    // Standing rule 64a: detection is not explanation. "Balance is negative"
    // with no next step is a dead end for the person who has to fix it.
    const line = generosityLineFor({
      employeeId: "u1",
      employeeName: "Angela",
      entries: [entry("accrual", 600), entry("payout", -900)],
    });
    expect(line.negativeExplanation).toContain("correction");
    expect(line.negativeExplanation).toContain("payout");
    expect(line.negativeExplanation).toContain("before the next pay run");
  });

  it("a healthy balance produces NO false alarm", () => {
    // The other half of rule 15: a detector that always fires is as useless as
    // one that never does.
    const line = generosityLineFor({
      employeeId: "u1",
      employeeName: "Angela",
      entries: [entry("accrual", 600), entry("usage", -60, "statutory")],
    });
    expect(line.isNegative).toBe(false);
    expect(line.negativeExplanation).toBe("");
  });

  it("the two REPORTING functions never clamp a balance at zero", () => {
    /*
     * WHY THIS ASSERTION IS SCOPED, AND WHY THE FIRST VERSION OF IT WAS WRONG.
     *
     * This started life as `expect(coreCode).not.toMatch(/Math\.max\(\s*0\s*,/)`
     * across the whole engine, and it went red immediately - on eleven entirely
     * correct lines. That was a defect in the TEST, not in the code, and the
     * lazy repair would have been to delete the assertion.
     *
     * There are two completely different uses of `Math.max(0, x)` in this file:
     *
     *   LEGITIMATE - clamping an INPUT or a SPENDABLE amount. Nobody works
     *   negative hours (`hoursThatCountTowardAccrual`), nobody can draw against
     *   a balance that is already below zero (`planDraw`), and nobody carries a
     *   negative balance into next year (`planYearEndCarryover`). Those clamps
     *   are the correct answer to a real question.
     *
     *   DANGEROUS - clamping what is REPORTED. Hiding a negative balance behind
     *   a tidy zero permanently conceals an error in a wage record, and Michael
     *   asked for the opposite by name: "including if it goes negative."
     *
     * So the assertion is scoped to the two functions whose entire job is to
     * report - `computeBalance` and `generosityLineFor`. A clamp appearing in
     * either of those is always the dangerous kind.
     */
    function bodyOf(name: string): string {
      const start = coreCode.indexOf(`export function ${name}(`);
      expect(start, `${name} was renamed or deleted`).toBeGreaterThan(-1);
      const next = coreCode.indexOf("\nexport ", start + 10);
      return coreCode.slice(start, next === -1 ? undefined : next);
    }

    const balanceBody = bodyOf("computeBalance");
    const lineBody = bodyOf("generosityLineFor");

    // Rule 39: prove the slices are real before asserting on their contents.
    expect(balanceBody).toContain("statutoryMinutes:");
    expect(lineBody).toContain("negativeExplanation");
    expect(balanceBody.length).toBeGreaterThan(200);
    expect(lineBody.length).toBeGreaterThan(200);

    expect(
      balanceBody,
      "computeBalance clamps a bucket at zero - a negative balance would be hidden",
    ).not.toMatch(/Math\.max\(\s*0\s*,/);
    expect(
      lineBody,
      "generosityLineFor clamps a bucket at zero - Michael asked to SEE negatives",
    ).not.toMatch(/Math\.max\(\s*0\s*,/);
  });

  it("the screen renders negatives in the danger colour and counts them", () => {
    expect(viewCode).toContain("l.statutoryMinutes < 0");
    expect(viewCode).toContain("l.awardedMinutes < 0");
    expect(viewCode).toContain("--admin-danger");
    expect(viewCode).toContain("negativeExplanation");
    expect(viewSrc).toContain("Balances below zero");
  });

  it("the hours formatter preserves the minus sign", () => {
    // A balance shown as "5.00 h" when it is -5.00 h is worse than showing
    // nothing at all.
    expect(viewCode).toContain('const sign = minutes < 0 ? "-" : ""');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) THE OWNER GATE (rule 16)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("5 the owner gate protects the render", () => {
  it("requireBooksAccess is called BEFORE the read", () => {
    // This screen lists every employee's balance on one page - exactly the
    // aggregate a shift lead must never see.
    const gateAt = pageCode.indexOf("requireBooksAccess()");
    const readAt = pageCode.indexOf("loadGenerosityBoard(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(-1);
    expect(gateAt, "the balances are read before the permission check").toBeLessThan(readAt);
  });

  it("the page is force-dynamic so the gate cannot be cached away", () => {
    expect(pageCode).toContain('export const dynamic = "force-dynamic"');
  });

  it("the view is a client component that imports only TYPES from the store", () => {
    expect(viewCode).toContain('"use client"');
    expect(
      viewCode,
      "the board imports the service-role store as a VALUE - that module is heading " +
        "for the client bundle",
    ).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+"@\/lib\/payroll\/sick-leave-store"/m);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6) A READ FAILURE IS A READ FAILURE
 * ══════════════════════════════════════════════════════════════════════════ */

describe("6 a failed read never renders as 'nobody has any leave'", () => {
  it("the page branches on board.ok before rendering the board", () => {
    const branchAt = pageCode.indexOf("!board.ok");
    const renderAt = pageCode.indexOf("<SickLeaveGenerosityBoard");
    expect(branchAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(-1);
    expect(branchAt).toBeLessThan(renderAt);
  });

  it("the failure card warns against reading a blank screen as a zero balance", () => {
    expect(pageCode).toContain("{board.message}");
    expect(pageSrc).toContain("Do not treat a blank screen as");
  });

  it("a ledger read failure refuses the whole board rather than showing part of it", () => {
    /*
     * A PARTIALLY READ LEDGER IS THE DANGEROUS CASE. Missing rows are almost
     * all positive - accruals - so a partial read produces balances that are
     * too LOW, which is how an employee gets told they have no sick leave left
     * when they have three days. So the whole board refuses.
     */
    expect(storeSrc).toContain("a partly-read ledger would show balances that are too low");
    const errAt = storeCode.indexOf("if (ledgerErr)");
    expect(errAt).toBeGreaterThan(-1);
    const after = storeCode.slice(errAt, errAt + 400);
    expect(after).toContain("return");
    expect(after).toContain("READ_FAILED");
  });

  it("a POLICY read failure does not hide the balances", () => {
    // The policy note is a nicety; the balances are the point. Refusing the
    // whole screen because one auxiliary read failed would be the opposite
    // mistake - unavailability dressed up as caution.
    expect(storeSrc).toContain("NON-FATAL");
    expect(storeCode).toContain("if (!policyErr && policyData)");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7) THE SCREEN DOES NO ARITHMETIC OF ITS OWN
 * ══════════════════════════════════════════════════════════════════════════ */

describe("7 every number on screen came from the engine", () => {
  it("the only arithmetic in the view is minutes-to-hours for display", () => {
    const allowed = new Set(["/ 60"]);
    const operations = [...viewCode.matchAll(/[*/%]\s*\d+/g)].map((m) =>
      m[0].replace(/\s+/g, " "),
    );
    const unexpected = operations.filter((op) => !allowed.has(op));
    expect(
      unexpected,
      `The board performs arithmetic the engine did not authorise: ${unexpected.join(", ")}`,
    ).toEqual([]);
  });

  it("the extractor is not vacuous - it did find the permitted operation", () => {
    expect([...viewCode.matchAll(/[*/%]\s*\d+/g)].length).toBeGreaterThanOrEqual(1);
  });

  it("the totals are read from the summary, never re-added in JSX", () => {
    expect(viewCode).toContain("summary.totalAwardedEverMinutes");
    expect(viewCode).toContain("summary.totalAwardedUsedMinutes");
    expect(viewCode).toContain("summary.totalAwardedOutstandingMinutes");
    expect(viewCode).not.toContain(".reduce(");
  });

  it("the engine's own sentence is rendered, not a re-worded copy", () => {
    expect(viewCode).toContain("{summary.explanation}");
  });

  it("the store recomputes from the ledger instead of reading a stored balance", () => {
    // A stored balance can drift from the rows meant to explain it, and when it
    // drifts nobody can tell which is wrong.
    expect(storeCode).toContain("generosityLineFor(");
    expect(storeCode).toContain("summariseGenerosity(");
    expect(storeSrc).toContain("There is no balance column anywhere in 0198");
  });

  it("the ledger is read in ONE query, not one per employee", () => {
    // N round trips is slow, but the real problem is that a partial failure
    // would look like a zero balance for one specific person.
    expect(storeCode).toContain('.in("employee_id", ids)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8) THE AUTHORITIES ON SCREEN ARE REAL
 * ══════════════════════════════════════════════════════════════════════════ */

function selectedAuthorityIds(): string[] {
  const start = viewSrc.indexOf("const SELECTED_AUTHORITY_IDS = [");
  expect(start, "SELECTED_AUTHORITY_IDS was renamed or deleted").toBeGreaterThan(-1);
  const end = viewSrc.indexOf("] as const;", start);
  expect(end).toBeGreaterThan(start);
  return [...viewSrc.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("8 every authority quoted on this screen actually exists", () => {
  const ids = selectedAuthorityIds();

  it("the extractor found ids at all (rule 39)", () => {
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("every selected authority id resolves in the real registry", () => {
    // The JSX uses `if (!a) return null`, so a typo fails SILENTLY - a blank
    // space where the regulation should be.
    const known = new Set(SICK_LEAVE_AUTHORITIES.map((a) => a.id));
    const missing = ids.filter((id) => !known.has(id));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `Quoted by SickLeaveGenerosityBoard but absent from SICK_LEAVE_AUTHORITIES: ` +
            `${missing.join(", ")}. Real ids: ${[...known].sort().join(", ")}`,
    ).toEqual([]);
  });

  it("each resolved authority carries a real quote, citation and gloss", () => {
    for (const id of ids) {
      const a = SICK_LEAVE_AUTHORITIES.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      expect(a!.quote.length, `${id} quote`).toBeGreaterThan(40);
      expect(a!.cite.length, `${id} cite`).toBeGreaterThan(5);
      expect(a!.soWhat.length, `${id} soWhat`).toBeGreaterThan(20);
    }
  });

  it("the carryover rule is on screen, because it is why the buckets exist", () => {
    expect(ids).toContain("wac-296-128-620-carryover");
    expect(ids).toContain("wac-296-128-620-accrual");
  });

  it("the quote is rendered VERBATIM from the registry", () => {
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
 * 9) THE MENTOR LAYER REACHES THE SCREEN (rule 26)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("9 the teaching is rendered, and selected by topic not by index", () => {
  function selectedTopics(): string[] {
    const start = viewSrc.indexOf("const SELECTED_LESSON_TOPICS = [");
    expect(start, "SELECTED_LESSON_TOPICS was renamed or deleted").toBeGreaterThan(-1);
    const end = viewSrc.indexOf("] as const;", start);
    expect(end).toBeGreaterThan(start);
    return [...viewSrc.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }

  it("every selected topic exists in the real mentor module", () => {
    /*
     * Selected by TOPIC rather than by array index on purpose: an index would
     * silently point at a different lesson the moment somebody inserts one
     * above it, and the screen would confidently teach the wrong thing.
     */
    const topics = selectedTopics();
    expect(topics.length).toBeGreaterThanOrEqual(2);
    const known = new Set(SICK_LEAVE_SCREEN_LESSONS.map((l) => l.topic));
    const missing = topics.filter((t) => !known.has(t));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `These lesson topics are requested by the board but do not exist, so the card ` +
            `renders empty: ${missing.join(" | ")}`,
    ).toEqual([]);
  });

  it("the two-bucket lesson is one of them, because it explains this screen", () => {
    expect(selectedTopics()).toContain(
      "Two buckets, and why spending the earned one first is worth real money",
    );
  });

  it("the lesson body is rendered, not just its title", () => {
    expect(viewCode).toContain("{lesson.topic}");
    expect(viewCode).toContain("{lesson.plainEnglish}");
    expect(viewCode).toContain("{lesson.whyItMatters}");
  });

  it("the screen explains WHY the legal minimum is the safer choice", () => {
    // Michael chose the floor because it was "easier". It is also safer, and he
    // should know why rather than having to trust that it is.
    expect(viewSrc).toContain("Why you are on the legal minimum");
    expect(viewSrc).toContain("carry over");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10) THE PAGE IS REACHABLE (rule 50)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("10 a human being can get to this screen", () => {
  it("the nav has an entry pointing at the page", () => {
    const item = adminNav.find((i) => i.href === "/admin/books/sick-leave-balances");
    expect(
      item,
      "no nav entry for /admin/books/sick-leave-balances - the page exists and nobody " +
        "can reach it",
    ).toBeDefined();
  });

  it("it sits in Accounting behind books.view", () => {
    const item = adminNav.find((i) => i.href === "/admin/books/sick-leave-balances");
    expect(item!.group).toBe("Accounting");
    expect(item!.permission).toBe("books.view");
  });

  it("the page renders the board, so the nav entry does not lead to an empty shell", () => {
    expect(pageCode).toContain("<SickLeaveGenerosityBoard");
    expect(pageCode).toContain("summary={board.summary}");
    expect(pageCode).toContain("accruesAtStatutoryFloor={board.accruesAtStatutoryFloor}");
  });
});
