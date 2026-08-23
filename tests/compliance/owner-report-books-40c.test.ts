/**
 * tests/compliance/owner-report-books-40c.test.ts   (books-40c)
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * One document ships with this slice:
 *
 *   docs/MICHAEL-books-40c-the-watchman.md
 *
 * WHY THIS IS A TEST AND NOT A PROOFREAD
 *
 * This report tells Michael, in a table he will plan around, exactly when he
 * will be interrupted: ten days out, five days out, two days out, then daily
 * and forever. It tells him there is no snooze anywhere in the feature. It
 * tells him a support order can never be marked exempt. It tells him twenty-
 * four sabotage runs are all caught. Every one of those was true the day it was
 * written, and every one of them can be quietly falsified by a later change to
 * the code that nobody thinks to check against a markdown file.
 *
 * A stale report is worse than no report, because he would plan around it. A
 * report promising ten days of warning while the system gives seven is not a
 * documentation bug; it is a missed filing. So every claim that CAN be
 * re-derived from the running code IS re-derived here, on every commit.
 *
 * THE QUOTE IS SACRED (rules 24/35)
 *
 * The four statutes are checked in BOTH directions: each must be in the
 * registry (so the test cannot be satisfied by text invented for the report and
 * then dutifully pasted into the code) and in the report (so the report cannot
 * quietly drop or trim one). An earlier report in this repository paraphrased
 * three regulations from memory while presenting them as the text of the rule.
 * Nothing about that draft looked wrong. That is what this section prevents.
 *
 * WHERE THE ELLIPSES COME IN, AND WHY THEY ARE NOT A LOOPHOLE
 *
 * RCW 6.27.350(1) is a single sentence of over a thousand characters. Printing
 * it whole in an owner report would guarantee it goes unread, so the report
 * elides the procedural middle with "...". That is legitimate quotation and it
 * is also the obvious way to smuggle in a misquote. So the gate splits each
 * blockquote on the ellipsis and requires EVERY REMAINING FRAGMENT to appear
 * verbatim in the registry text. Eliding is allowed; editing inside a fragment
 * is not.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ANSWER_CRITICAL_DAYS,
  ANSWER_INFO_DAYS,
  ANSWER_WARNING_DAYS,
  CREDITOR_DIARY_PROMPT_DAYS,
  EXPIRY_CRITICAL_DAYS,
  EXPIRY_WARNING_DAYS,
  ALL_WAGE_ORDER_ALERT_KINDS,
} from "@/lib/payroll/wage-order-watch-core";
import {
  SUPPORT_ANSWER_DAYS,
  CREDITOR_LIEN_DAYS,
} from "@/lib/payroll/wage-order-entry-core";
import {
  ALL_ANSWER_RECORD_REFUSAL_CODES,
  ANSWER_NEVER_WAIVABLE_KINDS,
  MIN_ANSWER_WAIVER_REASON_CHARS,
} from "@/lib/payroll/wage-order-lifecycle-core";
import {
  WATCH_AUTHORITY_IDS,
  WATCH_LADDER,
} from "@/lib/payroll/wage-order-watch-mentor";
import {
  answerWriteChain,
  disabledRenderBranches,
  mutationCount,
  snoozeDetectorSelfTest,
  snoozePathsInAnswerFlow,
  watchmanWiring,
} from "@/lib/payroll/wage-order-watch-mentor-gates";
import { WAGE_ORDER_ENTRY_AUTHORITIES } from "@/lib/payroll/wage-order-entry-authorities";

const REPORT_PATH = join(
  process.cwd(),
  "docs",
  "MICHAEL-books-40c-the-watchman.md",
);

const REPORT = readFileSync(REPORT_PATH, "utf8");

/**
 * Collapse text to one line of normalised characters, so the report and the
 * code can be compared on WORDS rather than on typography.
 *
 * Every step removes a difference that is about PRESENTATION. None removes a
 * difference that is about MEANING. Hyphens, case and whole words all survive,
 * because an earlier gate in this repository normalised hyphens away, turned
 * "books-40b" into "books 40b", and quietly broke its own slice-name check.
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

/** The registry's quote for an id, flattened the same way. */
function registryQuote(id: string): string {
  const a = WAGE_ORDER_ENTRY_AUTHORITIES.find((x) => x.id === id);
  if (!a) return "";
  return flatten(a.quote);
}

/* ═════════════════════════════════════════════════════════════════════════
 * §0  THE DOCUMENT EXISTS AND WAS READ  (standing rule 39)
 * ═════════════════════════════════════════════════════════════════════════ */

describe("books-40c owner report - the gate is reading a real document", () => {
  it("the report exists and is substantial", () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    expect(REPORT.length).toBeGreaterThan(12000);
  });

  it("the flattener normalises typography and nothing else", () => {
    // Rule 39: guard the vacuous read. If `flatten` returned "" then every
    // `toContain` below would pass for the wrong reason and this file would be
    // an elaborate way of asserting nothing.
    expect(FLAT.length).toBeGreaterThan(10000);

    // What it SHOULD collapse.
    expect(flatten("> a\n> b")).toBe("a b");
    expect(flatten("does **NOT** collect")).toBe("does NOT collect");
    expect(flatten("stop \u2014 ask")).toBe("stop - ask");
    expect(flatten("\u2018released\u2019")).toBe('"released"');

    // What it must NOT collapse.
    expect(flatten("books-40c")).toBe("books-40c");
    expect(flatten("does NOT collect")).not.toBe(flatten("does not collect"));
    expect(flatten("ten")).not.toBe(flatten("seven"));
  });

  it("it is addressed to Michael and names its slice and screen", () => {
    expect(FLAT).toContain("For: Michael, Greenway Marijuana");
    expect(FLAT).toContain("books-40c");
    expect(FLAT).toContain("Books \u2192 Garnishments");
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §1  THE QUOTED LAW IS THE REAL LAW, IN BOTH DIRECTIONS
 * ═════════════════════════════════════════════════════════════════════════ */

describe("books-40c owner report - the quote is sacred", () => {
  it("every authority the watch screen names is in the registry", () => {
    // Direction one. If the report quoted something the product never shows
    // him, he would be reassured by law that is nowhere in the software.
    for (const id of WATCH_AUTHORITY_IDS) {
      const a = WAGE_ORDER_ENTRY_AUTHORITIES.find((x) => x.id === id);
      expect(a, `authority ${id} is not in the registry`).toBeDefined();
      expect(registryQuote(id).length, `${id} has an empty quote`).toBeGreaterThan(80);
    }
  });

  it("every statute the report quotes is quoted verbatim, ellipses aside", () => {
    // Direction two, and the one that matters. Each blockquote is split on the
    // ellipsis; every surviving fragment must appear character-for-character
    // inside one registry quote. Eliding the procedural middle of a
    // thousand-character sentence is legitimate. Editing inside a fragment is
    // not, and this is where that would be caught.
    const blocks = REPORT.split("\n\n").filter((b) => b.trim().startsWith(">"));
    expect(blocks.length, "the report has stopped quoting the law").toBe(4);

    const registry = WATCH_AUTHORITY_IDS.map(registryQuote);
    let fragmentsChecked = 0;

    for (const block of blocks) {
      const fragments = flatten(block)
        .split(/\s*\.\.\.\s*/)
        .map((f) => f.replace(/^"+|"+$/g, "").replace(/\.$/, "").trim())
        .filter((f) => f.length > 20);

      expect(fragments.length, "a blockquote produced no checkable text").toBeGreaterThan(0);

      for (const fragment of fragments) {
        const found = registry.some((q) => q.includes(fragment));
        expect(found, `NOT VERBATIM in any registry quote: "${fragment.slice(0, 90)}..."`).toBe(
          true,
        );
        fragmentsChecked += 1;
      }
    }

    // Rule 39 again: prove the loop above actually ran on real text rather
    // than iterating over an empty list and reporting success.
    expect(fragmentsChecked).toBeGreaterThanOrEqual(4);
  });

  it("it cites all four statutes by number", () => {
    for (const cite of [
      "RCW 26.18.110(1)",
      "RCW 26.18.110(6)",
      "RCW 6.27.200",
      "RCW 6.27.350(1)",
    ]) {
      expect(FLAT, `the report stopped citing ${cite}`).toContain(cite);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §2  THE PROMISED SCHEDULE IS THE REAL SCHEDULE
 * ═════════════════════════════════════════════════════════════════════════ */

describe("books-40c owner report - the escalation table matches the code", () => {
  it("every day-count the report promises is the constant the watchman uses", () => {
    // THE FAILURE THIS PREVENTS IS NOT A TYPO. Michael will plan around this
    // table. If somebody tunes ANSWER_INFO_DAYS from 10 down to 7 to reduce
    // noise, the document silently becomes a promise the software no longer
    // keeps - and the first time he finds out is the week he was relying on
    // three days that no longer exist.
    expect(ANSWER_INFO_DAYS).toBe(10);
    expect(ANSWER_WARNING_DAYS).toBe(5);
    expect(ANSWER_CRITICAL_DAYS).toBe(2);
    expect(CREDITOR_DIARY_PROMPT_DAYS).toBe(3);
    expect(EXPIRY_WARNING_DAYS).toBe(10);
    expect(EXPIRY_CRITICAL_DAYS).toBe(3);

    // Now assert the DOCUMENT says the same, in the words it actually uses.
    expect(FLAT).toContain(`Days 1 to ${SUPPORT_ANSWER_DAYS - ANSWER_INFO_DAYS} after service`);
    expect(FLAT).toContain(`${ANSWER_INFO_DAYS} days before the deadline`);
    expect(FLAT).toContain(`${ANSWER_WARNING_DAYS} days before`);
    expect(FLAT).toContain(`${ANSWER_CRITICAL_DAYS} days before, and on the day`);
    expect(FLAT).toContain(`${CREDITOR_DIARY_PROMPT_DAYS} days after a creditor writ is entered`);
    expect(FLAT).toContain(
      `${EXPIRY_WARNING_DAYS} days, then ${EXPIRY_CRITICAL_DAYS} days before a creditor writ expires`,
    );
  });

  it("the report and the on-screen ladder describe the same ladder", () => {
    // The screen teaches a ladder and the report prints a table. Two
    // descriptions of one mechanism drift apart the moment somebody edits one
    // of them, and the reader has no way to tell which is current.
    expect(WATCH_LADDER.length).toBe(7);
    const rungs = WATCH_LADDER.map((r) => flatten(r.when));
    for (const rung of rungs) {
      expect(FLAT, `the report omits the "${rung}" rung`).toContain(rung);
    }
  });

  it("the statutory day counts are stated correctly", () => {
    expect(SUPPORT_ANSWER_DAYS).toBe(20);
    expect(CREDITOR_LIEN_DAYS).toBe(60);
    expect(FLAT).toContain("twenty-day");
    expect(FLAT).toContain("sixty days");
  });

  it("it promises the overdue alarm never gives up, because it does not", () => {
    // If somebody ever caps the daily nagging, the mutation suite catches the
    // code change - and this catches the report still promising otherwise.
    expect(FLAT).toContain("never stops on its own");
    expect(FLAT.toLowerCase()).toContain("does not expire");
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §3  THE PROMISES ABOUT BEHAVIOUR ARE STILL TRUE
 * ═════════════════════════════════════════════════════════════════════════ */

describe("books-40c owner report - what it promises is what the code does", () => {
  it("it promises no snooze, and there is still no snooze", () => {
    // The single strongest claim in the document. It must be re-proved against
    // the source, not against my memory of having written it that way.
    expect(snoozePathsInAnswerFlow()).toEqual([]);

    // And the detector that produced that empty array must still be capable of
    // producing a non-empty one, or the claim rests on a blind check.
    const self = snoozeDetectorSelfTest();
    expect(self.mutantsCaught).toBe(self.mutantsTried);
    expect(self.proseFalsePositives).toEqual([]);

    expect(FLAT).toContain("There is no snooze anywhere in this feature");
    expect(FLAT).toContain(
      "Dismissing records that you saw a message. It does not record that you did the thing.",
    );
  });

  it("it promises support orders can never be waived, and they cannot", () => {
    expect([...ANSWER_NEVER_WAIVABLE_KINDS].sort()).toEqual([
      "child_support",
      "spousal_support",
    ]);
    expect(FLAT).toContain("The answer requirement cannot be waived");
  });

  it("it promises the notifications are wired, and they are", () => {
    // "You will be emailed" is the load-bearing promise of the whole slice.
    // If the planner is ever unplugged, the only symptom is silence - and
    // silence is also what a compliant month looks like. So the report's
    // promise is re-derived from the shipped source of the cron engine.
    const w = watchmanWiring();
    expect(w.engineImportsPlanner).toBe(true);
    expect(w.engineCallsPlanner).toBe(true);
    expect(w.plannerHasOwnTryCatch).toBe(true);
    expect(w.plannerCallCount).toBeGreaterThanOrEqual(4);

    expect(FLAT).toContain("fourth");
    expect(FLAT).toContain("CCRS");
    expect(FLAT).toContain("LIQ-1295");
  });

  it("it promises the button reaches the database, and it still does", () => {
    // The report tells Michael that recording the answer stops the reminders.
    // That is only true if all four hops are connected, and a disconnected
    // chain is invisible on screen.
    const c = answerWriteChain();
    expect(c.pageWiresAction).toBe(true);
    expect(c.workbenchPassesToControl).toBe(true);
    expect(c.controlInvokesCallback).toBe(true);
    expect(c.actionInvokesStore).toBe(true);
  });

  it("it promises nothing is switched off behind the scenes", () => {
    expect(disabledRenderBranches()).toEqual([]);
  });

  it("it describes every way the form can refuse, and there are no others", () => {
    // Rule 26: every refusal Michael can meet must be explained somewhere he
    // will look. If a seventh refusal is added later, this fails and forces
    // the report to grow with the code.
    expect(ALL_ANSWER_RECORD_REFUSAL_CODES.length).toBe(6);
    expect(FLAT).toContain("Five ways the form refuses you");

    // The report groups the two NO_ANSWER_GIVEN causes under one heading, so
    // five headings cover six codes. Spot-check the wording of each.
    for (const phrase of [
      "You have said both that you filed it and that no answer was required",
      "The answer requirement cannot be waived",
      "The reason is too short",
      "You have entered a date before the order was served",
      "That date is in the future",
    ]) {
      expect(FLAT, `the report stopped explaining: ${phrase}`).toContain(phrase);
    }
  });

  it("the waiver reason floor it describes is the floor in force", () => {
    expect(MIN_ANSWER_WAIVER_REASON_CHARS).toBe(5);
    expect(FLAT).toContain("The reason is too short");
  });

  it("every alert kind Michael can receive is accounted for", () => {
    expect(ALL_WAGE_ORDER_ALERT_KINDS.length).toBe(6);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §4  IT IS HONEST ABOUT LIMITS AND ABOUT MISTAKES
 * ═════════════════════════════════════════════════════════════════════════ */

describe("books-40c owner report - it tells him the parts he will not enjoy", () => {
  it("it states the filing boundary, unchanged since books-10", () => {
    // Michael must never form the belief that this files for him. The boundary
    // is that we replace the data-preparation half of Aatrix and do not become
    // a filing agent.
    expect(FLAT).toContain("It does not file anything for you");
  });

  it("it admits the feature was dead code before this slice", () => {
    // Standing rule 50 reporting. The temptation in an owner report is to
    // describe only what was built. He is owed the finding that the deadline
    // maths already existed and reached nobody.
    expect(FLAT.toLowerCase()).toContain("correct code that nothing calls");
    expect(FLAT).toContain("answerDeadlineFor()");
    expect(FLAT).toContain("expiryOutlookFor()");
  });

  it("it admits the sabotage runs that got through on the first attempt", () => {
    // The most valuable paragraphs in the document are the ones admitting that
    // four mutations survived, including one that was my own bad experiment.
    // A report that only lists successes teaches him nothing about how much to
    // trust the next green tick.
    // The "twenty-four" is re-derived from the script rather than trusted.
    // WRITTEN BECAUSE A SABOTAGE OF THIS VERY TEST GOT THROUGH: changing the
    // report to claim three sabotage runs instead of twenty-four left the
    // suite green, because nothing tied the boast to the script. Deleting six
    // mutations while tidying would have done the same damage silently.
    expect(mutationCount(), "the mutation script no longer holds 24 mutations").toBe(24);
    expect(FLAT).toContain("twenty-four deliberate acts");
    expect(FLAT).toContain("in twenty-four different ways");
    expect(FLAT).toContain("All twenty-four are caught");

    expect(FLAT).toContain("five mutations survived");
    expect(FLAT.toLowerCase()).toContain("my own mistake");
  });

  it("it explains the one place the system refuses to help", () => {
    // RCW 6.27.200 sets the creditor deadline as "the time prescribed in the
    // writ". Rule 62d: never invent a default. He needs to know WHY there is
    // no countdown there, or he will read the silence as a bug.
    expect(FLAT).toContain("the time prescribed in the writ");
    expect(FLAT).toContain("read the writ");
  });
});
