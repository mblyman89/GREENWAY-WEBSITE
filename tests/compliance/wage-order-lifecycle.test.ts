/**
 * tests/compliance/wage-order-lifecycle.test.ts   (books-40b)
 *
 * THE GATE ON ENDING, PAUSING AND RESUMING A WAGE ORDER.
 *
 * WHY THIS FILE EXISTS
 *
 * Three server actions - terminate, suspend, resume - were written in books-36,
 * were correct, were fully tested, and were called by nothing. The books-38 gap
 * report and the books-40 report both ran the same probe and both printed the
 * same table:
 *
 *     createWageOrderAction      2
 *     terminateWageOrderAction   0
 *     suspendWageOrderAction     0
 *     resumeWageOrderAction      0
 *
 * Standing rule 50: dead code wearing a green check. books-40b wires them up.
 *
 * AND THE SECOND DEFECT, WHICH WAS WORSE
 *
 * While wiring them, `loadGarnishmentBoard()` turned out to filter
 * `.eq("status", "active")`. A suspended order was never rendered by any
 * screen. So a Resume button would have been attached to a row that could not
 * exist - a control no human being could ever reach - and the whole suite would
 * have stayed green while it shipped. Wiring the button without fixing the
 * reader would have replaced one instance of rule 50 with a subtler one.
 *
 * WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * It does not re-test the arithmetic of withholding; `garnishment-core` has its
 * own suite for that. It does not re-test the write store's guards;
 * `wage-order-write-store.test.ts` covers those. What had no gate is the
 * question this file answers: are the pieces CONNECTED, and do the three layers
 * that enforce the same rule enforce the SAME rule?
 *
 *   1) the gates can read every file they claim to read   (rule 39)
 *   2) the taught transitions match the enforced ones
 *   3) the TypeScript union matches the database CHECK
 *   4) the three actions are actually called now           (rule 50)
 *   5) the screen asks the core instead of re-deciding in JSX
 *   6) nothing anywhere deletes a wage order               (rule 66)
 *   7) the five-character rule is one number in three places
 *   8) the board shows the rows the buttons need
 *   9) every refusal the store can emit is explained       (rule 43)
 *  10) every quoted authority id resolves in the registry  (rule 24/25)
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import {
  LIFECYCLE_GATE_PATHS,
  controlDelegatesToCore,
  deletePathsInGarnishmentFeature,
  enforcedStatusGuards,
  lifecycleActionCallCounts,
  minimumReasonLengthByLayer,
  statusesPermittedByMigration,
  statusesReadByBoard,
} from "@/lib/payroll/wage-order-lifecycle-mentor-gates";

import {
  LIFECYCLE_OPTIONS,
  LIFECYCLE_TARGET_STATUS,
  MIN_TERMINATION_NOTE_CHARS,
  WAGE_ORDER_LIFECYCLE_STATUSES,
  WAGE_ORDER_NEVER_DELETED,
  lifecycleOptionsFor,
  noActionsExplanation,
  readLifecycleStatus,
  validateTerminationReason,
  type LifecycleActionKey,
  type WageOrderLifecycleStatus,
} from "@/lib/payroll/wage-order-lifecycle-core";

import {
  KIND_COMPARISON,
  LIFECYCLE_AUTHORITY_IDS,
  LIFECYCLE_CHECKS,
  LIFECYCLE_LESSONS,
  LIFECYCLE_REFUSAL_LESSONS,
  LIFECYCLE_WORKED_EXAMPLES,
} from "@/lib/payroll/wage-order-lifecycle-mentor";

import { WAGE_ORDER_ENTRY_AUTHORITIES } from "@/lib/payroll/wage-order-entry-authorities";

/* ═══════════════════════════════════════════════════════════════════════════
 * §0  THE GATES CAN READ WHAT THEY CLAIM TO READ  (standing rule 39)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every gate below is a `readFileSync` and a regex. If a path is wrong, or a
 * file is renamed, the regex matches nothing and the gate returns an empty
 * result - which several of the assertions further down would happily read as
 * "no problems found". That is a vacuous pass: a test that is green because it
 * looked at nothing. So the paths are proved first, before anything is
 * concluded from their contents.
 */

describe("books-40b - the lifecycle gates are reading real files", () => {
  it("every path the gate module reads exists on disk", () => {
    expect(LIFECYCLE_GATE_PATHS.length).toBe(8);
    for (const p of LIFECYCLE_GATE_PATHS) {
      expect(existsSync(p), `gate path does not exist: ${p}`).toBe(true);
      // Not merely present - non-trivial. An empty file would also "exist".
      expect(readFileSync(p, "utf8").length, `gate path is empty: ${p}`).toBeGreaterThan(500);
    }
  });

  it("the gates return findings rather than silence, so a green result means something", () => {
    // If any of these came back empty, the corresponding assertion later would
    // pass for the wrong reason. This is the anti-vacuity check.
    expect(Object.keys(enforcedStatusGuards()).length).toBe(3);
    expect(statusesPermittedByMigration().length).toBeGreaterThan(0);
    expect(Object.keys(lifecycleActionCallCounts()).length).toBe(4);
    expect(statusesReadByBoard().length).toBeGreaterThan(0);

    const lengths = minimumReasonLengthByLayer();
    expect(lengths.core, "core literal not found - the regex missed").not.toBeNull();
    expect(lengths.database, "database CHECK not found - the regex missed").not.toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE TAUGHT TRANSITIONS ARE THE ENFORCED TRANSITIONS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `lifecycleOptionsFor()` decides which buttons appear. The write store decides
 * which updates are permitted, with a PostgREST status filter. These are two
 * separate statements of one rule, and the day they disagree is the day either
 * a button does nothing when clicked, or an action exists that no button
 * offers. Neither failure is visible without this comparison.
 */

describe("books-40b - what the screen offers is what the server allows", () => {
  it("the union in the core is exactly the CHECK constraint in migration 0198", () => {
    // The database is the authority. The TypeScript union is the copy. Read the
    // authority, compare the copy - never the other way round (rule 62d: never
    // invent a default). If a fourth status is ever added to 0198, this fails
    // here rather than being silently treated as unrecognised at runtime.
    const fromMigration = [...statusesPermittedByMigration()].sort();
    const fromCore = [...WAGE_ORDER_LIFECYCLE_STATUSES].sort();
    expect(fromCore).toEqual(fromMigration);
    expect(fromMigration).toEqual(["active", "suspended", "terminated"]);
  });

  it("each write function guards on exactly the statuses the button table implies", () => {
    const guards = enforcedStatusGuards();

    // End is offered from active AND from suspended, so the server must accept
    // both. A paused order that could not be ended would strand it forever.
    expect(guards.terminateWageOrder).toBe("active,suspended");

    // Pause is offered only from active. Pausing a paused order is meaningless.
    expect(guards.suspendWageOrder).toBe("active");

    // Resume is offered only from suspended. There is deliberately no path from
    // terminated back to active anywhere in this system.
    expect(guards.resumeWageOrder).toBe("suspended");
  });

  it("the offered options and the server guards agree, checked mechanically", () => {
    // The two assertions above are hand-written mirrors. This one derives the
    // expectation from `lifecycleOptionsFor` itself, so if the table changes and
    // somebody updates the literals above to match, this still catches the case
    // where the SERVER was not updated too.
    const guards = enforcedStatusGuards();
    const fnFor: Readonly<Record<LifecycleActionKey, string>> = {
      end: "terminateWageOrder",
      pause: "suspendWageOrder",
      resume: "resumeWageOrder",
    };

    const offeredFrom: Record<string, string[]> = { end: [], pause: [], resume: [] };
    for (const status of WAGE_ORDER_LIFECYCLE_STATUSES) {
      for (const opt of lifecycleOptionsFor(status)) {
        offeredFrom[opt.key].push(status);
      }
    }

    for (const key of ["end", "pause", "resume"] as const) {
      const expected = offeredFrom[key].sort().join(",");
      expect(
        guards[fnFor[key]],
        `the screen offers "${key}" from [${expected}] but the server guards on ` +
          `[${guards[fnFor[key]]}] - one of the two is wrong`,
      ).toBe(expected);
    }
  });

  it("an ended order offers nothing at all, and says why instead of going blank", () => {
    expect(lifecycleOptionsFor("terminated")).toEqual([]);
    const why = noActionsExplanation("terminated");
    expect(why).not.toBeNull();
    // Rule 64a: detection is not explanation. A row with no buttons must state
    // which of the two reasons applies, not just render empty space.
    expect(why).toContain("cannot be");
    expect((why ?? "").length).toBeGreaterThan(120);
  });

  it("an unrecognised status offers nothing, and never falls back to active", () => {
    // The dangerous default. If a status the code does not understand were
    // treated as "active", the screen would offer Pause and End on a row whose
    // real state is unknown. `readLifecycleStatus` returns null instead.
    expect(readLifecycleStatus("garbage")).toBeNull();
    expect(readLifecycleStatus("")).toBeNull();
    expect(readLifecycleStatus("ACTIVE")).toBeNull(); // case matters; the DB is lowercase
    expect(lifecycleOptionsFor(null)).toEqual([]);
    expect(noActionsExplanation(null)).not.toBeNull();

    // And the happy path still works, so the above is not passing vacuously.
    expect(readLifecycleStatus("active")).toBe("active");
    expect(readLifecycleStatus("  suspended  ")).toBe("suspended");
  });

  it("the reversible option is always listed before the irreversible one", () => {
    // Not cosmetic. Ending is the only action that cannot be undone through this
    // screen, and a red button placed nearest the thumb is a design that will
    // eventually be clicked by accident.
    for (const status of WAGE_ORDER_LIFECYCLE_STATUSES) {
      const opts = lifecycleOptionsFor(status);
      if (opts.length < 2) continue;
      const firstIrreversible = opts.findIndex((o) => !o.reversible);
      if (firstIrreversible === -1) continue;
      expect(
        firstIrreversible,
        `status "${status}" lists an irreversible option before a reversible one`,
      ).toBe(opts.length - 1);
    }
  });

  it("only ending requires a written reason, and only ending is irreversible", () => {
    expect(LIFECYCLE_OPTIONS.end.requiresReason).toBe(true);
    expect(LIFECYCLE_OPTIONS.end.reversible).toBe(false);
    expect(LIFECYCLE_OPTIONS.end.variant).toBe("danger");

    expect(LIFECYCLE_OPTIONS.pause.reversible).toBe(true);
    expect(LIFECYCLE_OPTIONS.resume.reversible).toBe(true);

    // Every option must tell the truth before the click, not after it.
    for (const key of ["end", "pause", "resume"] as const) {
      const o = LIFECYCLE_OPTIONS[key];
      expect(o.whatHappens.length, `${key} has no consequence text`).toBeGreaterThan(80);
      expect(o.beforeYouClick.length, `${key} has no pre-flight check`).toBeGreaterThan(80);
    }
  });

  it("each action moves the order into the database status it claims to", () => {
    const expected: Record<LifecycleActionKey, WageOrderLifecycleStatus> = {
      end: "terminated",
      pause: "suspended",
      resume: "active",
    };
    expect(LIFECYCLE_TARGET_STATUS).toEqual(expected);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE WIRING ITSELF  (the whole point of books-40b)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b - the three actions are reachable by a human being", () => {
  it("terminate, suspend and resume are each called by the garnishment UI", () => {
    // This is the exact probe the books-38 and books-40 reports ran. They both
    // printed 0/0/0 for these three. If this ever returns to 0, the feature has
    // been silently unwired and both of those reports have become true again.
    const counts = lifecycleActionCallCounts();

    expect(counts.terminateWageOrderAction).toBeGreaterThan(0);
    expect(counts.suspendWageOrderAction).toBeGreaterThan(0);
    expect(counts.resumeWageOrderAction).toBeGreaterThan(0);

    // And the one that was always wired stays wired.
    expect(counts.createWageOrderAction).toBeGreaterThan(0);
  });

  it("the screen asks the core which buttons are lawful instead of deciding in JSX", () => {
    // The failure guarded against here would pass every other test in the repo:
    // somebody writes `status === "active" && <Button>Pause</Button>` inline. It
    // renders correctly the day it is written, it cannot be tested without a
    // browser, and it drifts the first time the transition rules change.
    const { callsCore, inlineStatusComparisons } = controlDelegatesToCore();

    expect(callsCore, "the control does not call lifecycleOptionsFor()").toBe(true);
    expect(
      inlineStatusComparisons,
      "the control re-decides the transition rules in JSX instead of asking the core",
    ).toEqual([]);
  });

  it("the board loads paused orders, so the Resume button is attached to a row that can appear", () => {
    // THE DEFECT THIS EXISTS TO PREVENT, WHICH WAS REAL BEFORE THIS SLICE.
    //
    // The reader filtered `.eq("status", "active")`. Wiring Resume under those
    // conditions ships a control nobody can reach: the only rows it applies to
    // are the only rows never rendered.
    const statuses = statusesReadByBoard();

    expect(statuses).toContain("active");
    expect(statuses).toContain("suspended");

    // And it must STILL exclude terminated. An ended order back on a live board
    // would eventually be withheld against, and withholding under a released
    // order is a conversion of the employee's wages - the more expensive of the
    // two mistakes, and the one that is hard to unwind.
    expect(statuses).not.toContain("terminated");
    expect([...statuses].sort()).toEqual(["active", "suspended"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE CLAIM THAT NOTHING IS EVER DELETED  (standing rule 66)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b - a wage order is never deleted", () => {
  it("no delete path exists anywhere in the garnishment feature", () => {
    // The owner report tells Michael in plain words that nothing in this system
    // can delete a wage order. Rule 66: an owner document makes checkable
    // claims. This is what makes that sentence checkable rather than a promise.
    const hits = deletePathsInGarnishmentFeature();
    expect(
      hits,
      `a delete path was introduced into the garnishment feature:\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("the promise is stated as a value the report can quote, not only as a comment", () => {
    expect(WAGE_ORDER_NEVER_DELETED).toContain("never deleted");
    expect(WAGE_ORDER_NEVER_DELETED).toContain("RCW 26.18.110(6)");
    expect(WAGE_ORDER_NEVER_DELETED.length).toBeGreaterThan(200);
  });

  it("no lifecycle option is a delete, in any of the three states", () => {
    for (const status of WAGE_ORDER_LIFECYCLE_STATUSES) {
      for (const opt of lifecycleOptionsFor(status)) {
        expect(["end", "pause", "resume"]).toContain(opt.key);
        expect(opt.label.toLowerCase()).not.toContain("delete");
        expect(opt.label.toLowerCase()).not.toContain("remove");
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  ONE RULE, THREE LAYERS, ONE NUMBER
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b - the written-reason rule is the same number everywhere", () => {
  it("the core, the server and the database all require the same minimum length", () => {
    const layers = minimumReasonLengthByLayer();

    expect(layers.core).toBe(MIN_TERMINATION_NOTE_CHARS);
    expect(layers.database).toBe(MIN_TERMINATION_NOTE_CHARS);
    expect(layers.core).toBe(layers.database);
  });

  it("the server imports the constant instead of hard-coding a rival copy", () => {
    // Three layers enforcing one rule is correct: a browser check is not a
    // control, and a server check is not a guarantee. Three layers enforcing
    // three DIFFERENT numbers is a defect, and it surfaces months later as a
    // refusal nobody can explain.
    const layers = minimumReasonLengthByLayer();
    expect(layers.storeImportsCore).toBe(true);
    expect(layers.storeHasRivalLiteral).toBe(false);
  });

  it("a reason of only whitespace is refused, because the database trims too", () => {
    const spaces = validateTerminationReason("        ");
    expect(spaces.ok).toBe(false);
    if (!spaces.ok) {
      expect(spaces.refusal.code).toBe("REASON_TOO_SHORT");
      // Rule 48 / 64a: the refusal must say what to do, not merely that it said no.
      expect(spaces.refusal.fix.length).toBeGreaterThan(120);
      // It must also say withholding did NOT change, so nobody assumes it stopped.
      expect(spaces.refusal.message).toContain("withholding continues");
    }
  });

  it("the boundary is exactly the database boundary, not one character either side", () => {
    const tooShort = "a".repeat(MIN_TERMINATION_NOTE_CHARS - 1);
    const justRight = "a".repeat(MIN_TERMINATION_NOTE_CHARS);

    expect(validateTerminationReason(tooShort).ok).toBe(false);

    const ok = validateTerminationReason(justRight);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.reason).toBe(justRight);

    // And the trim happens before the count, matching `length(btrim(...))`.
    const padded = validateTerminationReason(`   ${justRight}   `);
    expect(padded.ok).toBe(true);
    if (padded.ok) expect(padded.reason).toBe(justRight);
  });

  it("a real reason is accepted without the checker second-guessing the prose", () => {
    // There is deliberately no word list and no "must mention a date". A rule
    // that guesses at whether prose is meaningful refuses real reasons, and a
    // person blocked by a machine that will not say what it wants types "xxxxx"
    // and moves on - which puts a lie in the permanent record.
    const real = validateTerminationReason("released by the registry 2026-04-02");
    expect(real.ok).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  EVERY REFUSAL IS EXPLAINED  (standing rule 43)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b - every refusal the system can emit is explained to Michael", () => {
  it("every code the write store can return has a lesson", () => {
    // Read the store's own result union rather than trusting a list typed here.
    const storeSrc = readFileSync(
      LIFECYCLE_GATE_PATHS.find((p) => p.endsWith("wage-order-write-store.ts")) as string,
      "utf8",
    );
    const unionLine = storeSrc.match(/readonly code:\s*([^;]+);/);
    expect(unionLine, "could not find the refusal code union in the write store").not.toBeNull();

    const codes = [...(unionLine as RegExpMatchArray)[1].matchAll(/"([A-Z_]+)"/g)].map(
      (m) => m[1],
    );
    expect(codes.length).toBeGreaterThan(3);

    const explained = new Set(LIFECYCLE_REFUSAL_LESSONS.map((l) => l.code));
    for (const code of codes) {
      expect(explained.has(code), `refusal code ${code} has no plain-English lesson`).toBe(true);
    }

    // Plus the one the browser can raise before the server is ever called.
    expect(explained.has("REASON_TOO_SHORT")).toBe(true);
  });

  it("no lesson explains a code that cannot happen", () => {
    // The mirror image of the test above. A lesson for a code the system never
    // emits is documentation of a fiction, and it makes the list untrustworthy.
    const storeSrc = readFileSync(
      LIFECYCLE_GATE_PATHS.find((p) => p.endsWith("wage-order-write-store.ts")) as string,
      "utf8",
    );
    for (const lesson of LIFECYCLE_REFUSAL_LESSONS) {
      if (lesson.code === "REASON_TOO_SHORT") continue; // raised in the core, not the store
      expect(
        storeSrc.includes(`"${lesson.code}"`),
        `lesson explains ${lesson.code}, which the write store never emits`,
      ).toBe(true);
    }
  });

  it("each lesson says what to do, not just what went wrong", () => {
    for (const lesson of LIFECYCLE_REFUSAL_LESSONS) {
      expect(lesson.whatItMeans.length, `${lesson.code} whatItMeans too thin`).toBeGreaterThan(60);
      expect(lesson.whatToDo.length, `${lesson.code} whatToDo too thin`).toBeGreaterThan(60);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE TEACHING IS REAL  (standing rules 24 and 25)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40b - the lifecycle teaching quotes the real registry", () => {
  it("every lifecycle authority id resolves in the real registry", () => {
    // The mentor holds IDs, never its own copy of the statute text - rule 25,
    // one copy of every quotation in the repository. An id that resolves to
    // nothing renders as a blank card on the screen and nobody notices.
    //
    // `wage-order-lifecycle-mentor.ts` names this test in a comment and states
    // that it exists and is named accurately. It does, and it is.
    const known = new Set(WAGE_ORDER_ENTRY_AUTHORITIES.map((a) => a.id));
    expect(known.size).toBeGreaterThan(4);

    for (const id of LIFECYCLE_AUTHORITY_IDS) {
      expect(known.has(id), `lifecycle cites "${id}", which is in no registry`).toBe(true);
    }
  });

  it("each cited authority carries a verbatim quote and a source", () => {
    for (const id of LIFECYCLE_AUTHORITY_IDS) {
      const a = WAGE_ORDER_ENTRY_AUTHORITIES.find((x) => x.id === id);
      expect(a, `authority ${id} missing`).toBeDefined();
      if (!a) continue;
      expect(a.quote.length, `${id} has no quote`).toBeGreaterThan(40);
      expect(a.cite.length, `${id} has no citation`).toBeGreaterThan(5);
      expect(a.source.length, `${id} has no source`).toBeGreaterThan(5);
      expect(a.soWhat.length, `${id} has no plain-English translation`).toBeGreaterThan(40);
    }
  });

  it("the two kinds of order are contrasted, because confusing them is the costly mistake", () => {
    // A creditor writ expires. A support order does not. Ending a support order
    // because sixty days went by is the single most expensive thing a person can
    // do at this screen - RCW 26.18.110(6) puts the debt on the employer.
    expect(KIND_COMPARISON.length).toBeGreaterThanOrEqual(4);
    for (const row of KIND_COMPARISON) {
      expect(row.aspect.length).toBeGreaterThan(3);
      expect(row.creditorWrit.length).toBeGreaterThan(10);
      expect(row.supportOrder.length).toBeGreaterThan(10);
      // The whole value of the table is that the two columns differ.
      expect(row.creditorWrit).not.toBe(row.supportOrder);
    }
  });

  it("the checklist is ordered, unique and answerable", () => {
    expect(LIFECYCLE_CHECKS.length).toBeGreaterThanOrEqual(4);

    const keys = LIFECYCLE_CHECKS.map((c) => c.key);
    expect(new Set(keys).size, "duplicate checklist keys").toBe(keys.length);

    const orders = LIFECYCLE_CHECKS.map((c) => c.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(orders).size, "duplicate checklist order numbers").toBe(orders.length);

    for (const c of LIFECYCLE_CHECKS) {
      // Asked as a question, because a question is answerable and a heading is not.
      expect(c.question.endsWith("?"), `check "${c.key}" is not a question`).toBe(true);
      expect(c.whyThisOrder.length).toBeGreaterThan(40);
      expect(c.ifItFails.length, `check "${c.key}" does not say what to do`).toBeGreaterThan(40);
    }
  });

  it("the worked examples each name the trap, not just the answer", () => {
    expect(LIFECYCLE_WORKED_EXAMPLES.length).toBeGreaterThanOrEqual(3);
    const keys = LIFECYCLE_WORKED_EXAMPLES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const e of LIFECYCLE_WORKED_EXAMPLES) {
      expect(e.situation.length).toBeGreaterThan(40);
      expect(e.rightAnswer.length).toBeGreaterThan(20);
      // `whatToType` is the part that makes it usable: Michael can copy it.
      expect(e.whatToType.length, `example "${e.key}" does not show what to type`).toBeGreaterThan(
        10,
      );
      expect(e.theTrap.length, `example "${e.key}" names no trap`).toBeGreaterThan(40);
    }
  });

  it("the lessons are distinct and each says why it matters", () => {
    expect(LIFECYCLE_LESSONS.length).toBeGreaterThanOrEqual(5);
    const topics = LIFECYCLE_LESSONS.map((l) => l.topic);
    expect(new Set(topics).size, "duplicate lesson topics").toBe(topics.length);

    for (const l of LIFECYCLE_LESSONS) {
      expect(l.plainEnglish.length).toBeGreaterThan(60);
      expect(l.whyItMatters.length).toBeGreaterThan(60);
    }
  });

  it("the teaching uses straight apostrophes, matching the house convention", () => {
    // Curly quotes arrive by copy-paste from a PDF and then fail a string
    // comparison somewhere unrelated, months later.
    const mentorPath = LIFECYCLE_GATE_PATHS[0].replace(
      "wage-order-lifecycle-core.ts",
      "wage-order-lifecycle-mentor.ts",
    );
    const src = readFileSync(mentorPath, "utf8");
    const curly = [...src.matchAll(/[\u2018\u2019\u201C\u201D]/g)].map((m) => m[0]);
    expect(curly, "curly quotes found in the lifecycle mentor").toEqual([]);
  });
});
