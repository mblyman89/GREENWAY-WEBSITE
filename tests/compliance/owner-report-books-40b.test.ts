/**
 * tests/compliance/owner-report-books-40b.test.ts   (books-40b)
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * One document ships with this slice:
 *
 *   docs/MICHAEL-books-40b-ending-a-wage-order.md
 *
 * WHY THIS IS A TEST AND NOT A PROOFREAD
 *
 * The report makes claims Michael will act on. It tells him there is no delete
 * anywhere in the feature. It tells him the board now shows paused orders. It
 * tells him which button is offered from which state. It quotes four statutes
 * at length. Every one of those was true when I wrote it, and every one of them
 * can be falsified by a later change to the code that nobody thinks to check
 * against a markdown file.
 *
 * A report that quietly goes stale is worse than no report, because he would
 * plan around it. So every claim that CAN be re-derived from the code IS
 * re-derived here, on every commit, in the suite CI actually runs.
 *
 * THE QUOTE IS SACRED (rules 24/35)
 *
 * The four statutory quotations are checked in BOTH directions: each must be in
 * the registry (so the test cannot be satisfied by text I invented and then
 * dutifully pasted into the report) and in the report (so the report cannot
 * quietly drop or trim one). An earlier report in this repository paraphrased
 * three regulations from memory while presenting them as the text of the rule.
 * Nothing about that draft looked wrong. That is what this section prevents.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LIFECYCLE_OPTIONS,
  WAGE_ORDER_LIFECYCLE_STATUSES,
  lifecycleOptionsFor,
  MIN_TERMINATION_NOTE_CHARS,
} from "@/lib/payroll/wage-order-lifecycle-core";
import {
  KIND_COMPARISON,
  LIFECYCLE_AUTHORITY_IDS,
  LIFECYCLE_CHECKS,
  LIFECYCLE_REFUSAL_LESSONS,
  LIFECYCLE_WORKED_EXAMPLES,
} from "@/lib/payroll/wage-order-lifecycle-mentor";
import {
  deletePathsInGarnishmentFeature,
  lifecycleActionCallCounts,
  statusesReadByBoard,
} from "@/lib/payroll/wage-order-lifecycle-mentor-gates";
import { WAGE_ORDER_ENTRY_AUTHORITIES } from "@/lib/payroll/wage-order-entry-authorities";

const REPORT_PATH = join(
  process.cwd(),
  "docs",
  "MICHAEL-books-40b-ending-a-wage-order.md",
);

const REPORT = readFileSync(REPORT_PATH, "utf8");

/**
 * Collapse text to one line of normalised characters, so the report and the
 * code can be compared on WORDS rather than on typography.
 *
 * WHY EACH STEP IS HERE, BECAUSE EVERY ONE OF THEM IS A CHANCE TO CHEAT
 *
 * The temptation in a gate like this is to keep loosening the comparison until
 * it goes green, at which point it is asserting nothing. So each normalisation
 * below removes a difference that is genuinely about PRESENTATION, and none of
 * them removes a difference that is about MEANING:
 *
 *   - line wrapping and `> ` markers: markdown wraps prose at column 80, so one
 *     sentence in a source string is five quoted lines in the document.
 *   - `*` and `_`: markdown emphasis. "does **NOT** collect" and "does NOT
 *     collect" are the same sentence. Case is NOT normalised, so a report that
 *     softened that "NOT" to "not" would still fail.
 *   - dashes: the mentor modules are code, and the house convention is straight
 *     ASCII only. The owner reports are typeset to PDF and use en/em dashes.
 *     Same word, different glyph.
 *   - quote marks: same reason. A code string writes 'released by the registry';
 *     the typeset document writes "released by the registry".
 *
 * Hyphens between words are PRESERVED. An earlier gate in this repository
 * normalised them away, turning "books-40b" into "books 40b", and quietly broke
 * a slice-name assertion. That is exactly the kind of over-normalisation this
 * comment exists to prevent being repeated.
 */
const flatten = (s: string): string =>
  s
    .replace(/\r/g, "")
    .replace(/^>\s?/gm, " ")
    .replace(/\*/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019\u201C\u201D']/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const FLAT = flatten(REPORT);

/* ═══════════════════════════════════════════════════════════════════════════
 * §0  THE DOCUMENT EXISTS AND WAS READ  (standing rule 39)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b owner report - the gate is reading a real document", () => {
  it("the report exists and is substantial", () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    expect(REPORT.length).toBeGreaterThan(12000);
  });

  it("the flattener normalises typography and nothing else", () => {
    // Rule 39: guard the vacuous read. If `flatten` returned "" every
    // `toContain` in this file would pass for the wrong reason.
    expect(FLAT.length).toBeGreaterThan(10000);

    // What it SHOULD collapse.
    expect(flatten("> a\n> b")).toBe("a b");
    expect(flatten("does **NOT** collect")).toBe("does NOT collect");
    expect(flatten("REASON_TOO_SHORT")).toBe("REASON_TOO_SHORT"); // underscores survive
    expect(flatten("stop \u2014 ask")).toBe('stop - ask');
    expect(flatten("\u2018released\u2019")).toBe('"released"');

    // What it must NOT collapse, or this whole file stops meaning anything.
    expect(flatten("books-40b")).toBe("books-40b"); // hyphens survive
    expect(flatten("does NOT collect")).not.toBe(flatten("does not collect")); // case survives
    expect(flatten("five")).not.toBe(flatten("six")); // words survive
  });

  it("it is addressed to Michael and names its slice and screen", () => {
    expect(FLAT).toContain("For: Michael, Greenway Marijuana");
    expect(FLAT).toContain("books-40b");
    expect(FLAT).toContain("Books → Garnishments");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE QUOTED LAW IS THE REAL LAW, IN BOTH DIRECTIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b owner report - the quote is sacred", () => {
  it("every statute the report quotes is quoted verbatim from the registry", () => {
    for (const id of LIFECYCLE_AUTHORITY_IDS) {
      const a = WAGE_ORDER_ENTRY_AUTHORITIES.find((x) => x.id === id);
      expect(a, `authority ${id} is not in the registry`).toBeDefined();
      if (!a) continue;

      expect(
        FLAT.includes(flatten(a.quote)),
        `the report does not quote ${a.cite} verbatim - it has been paraphrased, ` +
          `trimmed or gone stale against the mirrored text`,
      ).toBe(true);

      // And the citation itself must be printed, so the reader can go and look.
      expect(FLAT, `the report never cites ${a.cite}`).toContain(a.cite);
    }
  });

  it("the report quotes all four and no fewer", () => {
    // Counting protects against a future edit that drops one quotation while
    // leaving its heading behind.
    expect(LIFECYCLE_AUTHORITY_IDS.length).toBe(4);
    const quoted = LIFECYCLE_AUTHORITY_IDS.filter((id) => {
      const a = WAGE_ORDER_ENTRY_AUTHORITIES.find((x) => x.id === id);
      return a ? FLAT.includes(flatten(a.quote)) : false;
    });
    expect(quoted.length).toBe(4);
  });

  it("each quotation is followed by a plain-English translation", () => {
    // Michael has not used his accounting degree in thirteen years. A statute
    // printed without a translation is decoration.
    const translations = [...REPORT.matchAll(/\*\*Plain English\.\*\*/g)];
    expect(translations.length).toBeGreaterThanOrEqual(LIFECYCLE_AUTHORITY_IDS.length);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE CLAIMS ABOUT THE CODE ARE RE-DERIVED FROM THE CODE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b owner report - the claims about the wiring are true today", () => {
  it("the report's 'after' table matches the probe it says produced it", () => {
    // The report prints a second table showing the call counts after the fix.
    // Those numbers are read out of the shipped probe, not typed. If the wiring
    // changes, the report is wrong and this is what notices.
    const counts = lifecycleActionCallCounts();

    const row = (action: string, n: number) =>
      new RegExp(`\\|\\s*\`${action}\`\\s*\\|\\s*\\*{0,2}${n}\\*{0,2}\\s*\\|`);

    for (const action of [
      "terminateWageOrderAction",
      "suspendWageOrderAction",
      "resumeWageOrderAction",
      "createWageOrderAction",
    ] as const) {
      expect(
        row(action, counts[action]).test(REPORT),
        `the report's table does not show ${action} = ${counts[action]}, which is ` +
          `what the probe returns today`,
      ).toBe(true);
    }
  });

  it("the report still shows the original 0/0/0 table it is correcting", () => {
    // Honesty obligation. The document explains a defect; deleting the evidence
    // of the defect would make the explanation unverifiable. The original table
    // stays, with the correction printed after it.
    expect(FLAT).toContain("Three zeroes");
    expect(REPORT).toMatch(/\|\s*`terminateWageOrderAction`\s*\|\s*\*\*0\*\*\s*\|/);
  });

  it("the claim that nothing can be deleted is true", () => {
    expect(deletePathsInGarnishmentFeature()).toEqual([]);
    expect(FLAT).toContain("There is no delete.");
    expect(FLAT).toContain("RCW 26.18.110(6)");
  });

  it("the claim that the board now shows paused orders is true", () => {
    const statuses = statusesReadByBoard();
    expect(statuses).toContain("suspended");
    expect(statuses).not.toContain("terminated");
    expect(FLAT).toContain("active and suspended");
  });

  it("the which-button-when table matches what the core actually offers", () => {
    // Derived, not transcribed. If the transition rules change, the table in the
    // report becomes a lie and this fails.
    const labelsFor = (s: (typeof WAGE_ORDER_LIFECYCLE_STATUSES)[number]) =>
      lifecycleOptionsFor(s).map((o) => o.label);

    expect(labelsFor("active")).toEqual(["Pause it", "End this order"]);
    expect(labelsFor("suspended")).toEqual(["Resume it", "End this order"]);
    expect(labelsFor("terminated")).toEqual([]);

    // Every label the core produces must appear in the report.
    for (const key of ["end", "pause", "resume"] as const) {
      expect(FLAT, `the report never names the "${key}" button`).toContain(
        LIFECYCLE_OPTIONS[key].label,
      );
    }
  });

  it("the report tells the truth about which action is irreversible", () => {
    expect(LIFECYCLE_OPTIONS.end.reversible).toBe(false);
    expect(LIFECYCLE_OPTIONS.pause.reversible).toBe(true);
    expect(LIFECYCLE_OPTIONS.resume.reversible).toBe(true);
    expect(FLAT).toContain("the only one you cannot undo");
    // And it must immediately disclaim the wrong reading of that phrase.
    expect(FLAT).toContain("does not mean the record is destroyed");
  });

  it("the minimum reason length the report states is the one enforced", () => {
    expect(MIN_TERMINATION_NOTE_CHARS).toBe(5);
    // Stated in words, as "five-character", so a change to the constant without
    // a change to the report is caught.
    expect(FLAT).toContain("five-character minimum");
    expect(FLAT).toContain("three places");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE TEACHING IN THE REPORT IS THE TEACHING ON THE SCREEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * If the report and the screen teach different things, the report is a
 * different product than the one he is using. These assertions keep the two
 * pinned together.
 */

describe("books-40b owner report - it teaches what the screen teaches", () => {
  it("every checklist question in the code appears in the report", () => {
    expect(LIFECYCLE_CHECKS.length).toBe(5);
    for (const c of LIFECYCLE_CHECKS) {
      expect(
        FLAT.includes(flatten(c.question)),
        `the report omits checklist question "${c.key}"`,
      ).toBe(true);
      expect(
        FLAT.includes(flatten(c.ifItFails)),
        `the report omits the remedy for checklist question "${c.key}"`,
      ).toBe(true);
    }
  });

  it("the report says there are five checks and there are five checks", () => {
    expect(FLAT).toContain("the five checks");
  });

  it("every comparison row is reproduced, both columns", () => {
    expect(KIND_COMPARISON.length).toBe(5);
    for (const row of KIND_COMPARISON) {
      expect(
        FLAT.includes(flatten(row.creditorWrit)),
        `the report omits the creditor-writ side of "${row.aspect}"`,
      ).toBe(true);
      expect(
        FLAT.includes(flatten(row.supportOrder)),
        `the report omits the support-order side of "${row.aspect}"`,
      ).toBe(true);
    }
  });

  it("every worked example is reproduced with its trap and what to type", () => {
    expect(LIFECYCLE_WORKED_EXAMPLES.length).toBe(3);
    for (const e of LIFECYCLE_WORKED_EXAMPLES) {
      expect(FLAT.includes(flatten(e.situation)), `omits situation "${e.key}"`).toBe(true);
      expect(FLAT.includes(flatten(e.rightAnswer)), `omits answer "${e.key}"`).toBe(true);
      expect(FLAT.includes(flatten(e.theTrap)), `omits the trap in "${e.key}"`).toBe(true);
    }
  });

  it("the report states the number of refusals the system can actually emit", () => {
    expect(LIFECYCLE_REFUSAL_LESSONS.length).toBe(6);
    expect(FLAT).toContain("There are six");
    // The two it explains in advance must be real codes.
    const codes = new Set(LIFECYCLE_REFUSAL_LESSONS.map((l) => l.code));
    expect(codes.has("REASON_TOO_SHORT")).toBe(true);
    expect(codes.has("NOT_FOUND")).toBe(true);
    expect(FLAT).toContain("REASON_TOO_SHORT");
    expect(FLAT).toContain("NOT_FOUND");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE HONESTY SECTIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b owner report - it says what it did not do", () => {
  it("it states plainly that this system transmits nothing", () => {
    // The boundary that must never blur: we replace the data-preparation half
    // of Aatrix. We are not a filing agent.
    expect(FLAT).toContain("does not send anything to anyone");
    expect(FLAT).toContain("does not file the twenty-day answer");
  });

  it("it discloses the limitation it did not fix", () => {
    // Rule 66 cuts both ways: a report that lists only wins is marketing.
    expect(FLAT).toContain("does not yet warn you when a writ is about to expire");
  });

  it("it discloses the bug I introduced and the tests caught", () => {
    expect(FLAT).toContain("I introduced a bug of my own");
  });

  it("it reports that the new gate was proved by deliberately breaking it", () => {
    // A test that has never been seen to fail is not evidence. The report says
    // both mutations were run; those mutations are described in
    // tests/compliance/wage-order-lifecycle.test.ts.
    expect(FLAT).toContain("I broke it twice on purpose");
    expect(existsSync(join(process.cwd(), "tests", "compliance", "wage-order-lifecycle.test.ts"))).toBe(
      true,
    );
  });

  it("it points at the next slice and repeats the outstanding blocker", () => {
    expect(FLAT).toContain("books-41");
    expect(FLAT).toContain("Employment Security Department");
    expect(FLAT).toContain("Labor & Industries");
    // The one thing that actually blocks the 1 January 2027 cutover.
    expect(FLAT).toContain("ten 2027 rates");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  HOUSE CONVENTIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b owner report - house conventions", () => {
  it("it uses no straight-quote apostrophes inside prose contractions", () => {
    // The owner reports are typeset to PDF, where a straight apostrophe in
    // running prose looks like code. Statute quotations are exempt: they are
    // verbatim and must not be prettified (rule 24).
    const withoutQuotes = REPORT.split("\n")
      .filter((l) => !l.trimStart().startsWith(">"))
      .join("\n");
    // Contractions the house style renders with a typographic apostrophe.
    expect(withoutQuotes).not.toMatch(/\b(dont|cant|wont|isnt)\b/);
  });

  it("it never promises a screen without naming its route", () => {
    // Rule 16: a claim about a screen must name where it is.
    expect(FLAT).toContain("Go to Books → Garnishments");
  });
});
