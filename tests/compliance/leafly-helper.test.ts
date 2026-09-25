/**
 * tests/compliance/leafly-helper.test.ts   (Slice B)
 *
 * A HANDBOOK THAT DESCRIBES A BUTTON NOBODY CAN FIND IS WORSE THAN NO HANDBOOK.
 *
 * THE INCIDENT THESE TESTS EXIST BECAUSE OF
 * -----------------------------------------
 * The first draft of `helper-core.ts` shipped with 321 passing self-tests and
 * four wrong button names. It told the owner to click:
 *
 *     "Reset sync state"   -- the button says "Reset sync memory..."
 *     "Acknowledge"        -- the button says "Acknowledge to Leafly"
 *     "Confirmed"          -- the button says "Confirm order"
 *     "Picked up"          -- the button says "Mark picked up"
 *
 * Every one of those 321 self-tests passed before the correction AND after it,
 * because they are pure: they check that the prose is long enough, that
 * dangerous controls carry a caution, that the checklist never returns to
 * safety. None of them can see the actual screen. Purity is what makes them
 * fast and total; it is also exactly why they were blind here.
 *
 * WHY THAT PARTICULAR BUG IS SO EXPENSIVE
 * ---------------------------------------
 * Three of the four wrong names are on the ORDERS dashboard, and the first
 * thing that happens on that screen is a fifteen-minute countdown to an
 * automatic cancellation. A handbook that sends someone hunting for a button
 * called "Acknowledge" while the screen says "Acknowledge to Leafly" spends
 * the one resource that screen does not have. Helper text is read by people
 * who are already lost; it is load-bearing precisely when it is wrong.
 *
 * WHAT THESE TESTS DO THAT THE SELF-TESTS CANNOT
 * ----------------------------------------------
 * They read the real files off disk and check the handbook against them:
 *
 *   1. Every file the handbook cites as a source EXISTS. A citation to a
 *      moved file is a dead reference, and dead references are how a document
 *      quietly stops being true.
 *   2. Every quoted control name is either imported from the module that
 *      defines it, or literally present in one of the cited source files.
 *      This is the check that would have caught all four names above.
 *   3. Every `href` the handbook points at corresponds to a real route.
 *   4. The numbers in the prose match the constants in the code.
 *
 * WHAT THESE TESTS HONESTLY CANNOT DO
 * -----------------------------------
 * They prove a string is PRESENT in a file. They cannot prove it is rendered,
 * or visible, or reachable. A label inside dead code would still satisfy them.
 * Claiming otherwise would repeat the mistake this file exists to prevent, so
 * it is written down instead.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALL_WALKTHROUGHS,
  BIG_IDEAS,
  FIRST_TIME_CHECKLIST,
  ORDERS_DASHBOARD,
  OTHER_SURFACES,
  PUSH_AND_PREVIEW,
  helperCoverage,
  searchHelper,
  walkthroughById,
  __runLeaflyHelperTests,
} from "@/lib/leafly/helper-core";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readIfPresent(rel: string): string | null {
  const abs = path.join(REPO_ROOT, rel);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** The concatenated text of every file a walkthrough cites. */
function sourceTextFor(w: (typeof ALL_WALKTHROUGHS)[number]): string {
  return w.source.map((s) => readIfPresent(s) ?? "").join("\n");
}

/**
 * Control names that are deliberately DESCRIPTIVE rather than quoted.
 *
 * Not every entry in `features` is a button. Some describe a region of the
 * screen ("the three boxes at the top") or a behaviour ("the countdown"),
 * which have no single literal in the source. Those are listed here
 * EXPLICITLY, one by one, so that the exemption is a decision someone made
 * rather than a hole in the check. Anything not on this list must be findable
 * in the source it claims to come from.
 */
const DESCRIPTIVE_CONTROLS: readonly string[] = [
  "Items in feed / Environment / Credentials (the three boxes)",
  "Payload preview (first N of M)",
  "The countdown on each unacknowledged order",
  // Descriptive phrase that QUOTES a real label inside itself; the quoted
  // portion comes from LEAFLY_STATUS_ACTION_WORDING, so it cannot drift.
  "Forward status buttons (e.g. \u201cMark ready for pickup\u201d)",
  "Interrupt notices",
  "Signature verification",
  "Order submit / preview / status / cancel / activate / deactivate",
  "Menu integration key + OAuth Client ID / Secret",
  "Environment (sandbox / production)",
  "Announcer sound per origin",
  "Register interrupt",
  "Pickup list",
  "Evidence panel",
  "Evidence export",
  "Recent sync activity",
  "Automatic syncing / schedule",
  "Sync settings",
  "Leafly menu certification card",
  "Leafly ordering card",
];

describe("the handbook cites files that actually exist", () => {
  it("every source path resolves to a real file", () => {
    const missing: string[] = [];
    for (const w of ALL_WALKTHROUGHS) {
      for (const rel of w.source) {
        if (!existsSync(path.join(REPO_ROOT, rel))) {
          missing.push(`${w.id} -> ${rel}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every walkthrough cites at least two sources", () => {
    // One source is usually the component; the rules almost always live
    // somewhere else. A single citation is a sign the research stopped early.
    for (const w of ALL_WALKTHROUGHS) {
      expect(w.source.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("every quoted control name exists in the source it claims to come from", () => {
  // THIS is the test that would have caught the four wrong button names.
  it.each(ALL_WALKTHROUGHS.map((w) => [w.id, w] as const))(
    "%s",
    (_id, w) => {
      const haystack = sourceTextFor(w);
      const notFound: string[] = [];

      for (const f of w.features) {
        if (DESCRIPTIVE_CONTROLS.includes(f.control)) continue;
        // Strip a trailing ellipsis so "Reset sync memory..." matches the JSX,
        // which may store it as a \u2026 escape or as the literal character.
        const needle = f.control.replace(/[\u2026.]+$/, "").trim();
        if (needle.length < 4) continue;

        // WHOLE-LABEL match, not substring. A plain `includes` accepted
        // "Acknowledge" as evidence for a button actually named "Acknowledge
        // to Leafly" -- the precise bug this suite exists to catch. The label
        // must be followed by something that genuinely ends it: a quote, a
        // JSX close, a brace, or an ellipsis.
        const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const whole = new RegExp(`${esc}(?:\\\\u2026|\u2026)?\\s*(?:["'\`<{(]|\\s|$)`, "m");
        if (!whole.test(haystack)) notFound.push(f.control);
      }

      expect(notFound).toEqual([]);
    },
  );
});

describe("the handbook points at routes that exist", () => {
  it("every href maps to a page or is an anchor on one", () => {
    const bad: string[] = [];
    for (const w of ALL_WALKTHROUGHS) {
      const route = w.href.split("#")[0].replace(/\/$/, "");
      if (!route.startsWith("/")) {
        bad.push(`${w.id}: href is not absolute (${w.href})`);
        continue;
      }
      const candidates = [
        path.join(REPO_ROOT, "src/app", route, "page.tsx"),
        path.join(REPO_ROOT, "src/app", route, "page.ts"),
      ];
      if (!candidates.some((c) => existsSync(c))) {
        bad.push(`${w.id}: no page for ${route}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("the numbers in the prose are the numbers in the code", () => {
  it("the acknowledge window is quoted from the constant, not retyped", () => {
    const ackCore = readIfPresent("src/lib/leafly/order-ack-core.ts") ?? "";
    const m = ackCore.match(/LEAFLY_ACK_WINDOW_MINUTES\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    const real = m![1];

    const prose = JSON.stringify(ORDERS_DASHBOARD);
    expect(prose).toContain(`${real} minute`);

    // And NO minute-figure anywhere in the handbook may disagree with the
    // constants. Checking only that the right number appears is satisfiable
    // while a second, wrong number sits three lines below it -- verified by
    // mutation, where exactly that defect survived the earlier assertion.
    const scheduleCore = readIfPresent("src/lib/leafly/schedule-core.ts") ?? "";
    const gap = scheduleCore.match(/MIN_RUN_GAP_MINUTES\s*=\s*(\d+)/);
    expect(gap).not.toBeNull();

    const allowed = new Set([real, gap![1]]);
    const everything = ALL_WALKTHROUGHS.map((w) => JSON.stringify(w)).join("\n");
    const offenders = [...everything.matchAll(/(\d+)\s*minutes?\b/g)]
      .map((m) => m[1])
      .filter((n) => !allowed.has(n));
    expect(offenders, "minute figures not backed by a constant").toEqual([]);
  });

  it("the helper imports its numbers rather than hard-coding them", () => {
    const src = readIfPresent("src/lib/leafly/helper-core.ts") ?? "";
    expect(src).toContain("LEAFLY_ACK_WINDOW_MINUTES");
    expect(src).toContain("MIN_RUN_GAP_MINUTES");
    // A bare "15 minutes" in the prose would be a second, driftable copy.
    expect(src).not.toMatch(/"[^"]*\b15 minutes\b[^"]*"/);
  });
});

describe("labels that a module already owns are imported, never retyped", () => {
  // This is the rule that makes the drift IMPOSSIBLE rather than merely
  // detectable. `order-ack-core.ts` decides what the order buttons say; the
  // handbook must quote it by reference. A literal here is a second copy, and
  // a second copy is free to drift the moment someone renames a button.
  it("the order-action labels come from order-ack-core", () => {
    const src = readIfPresent("src/lib/leafly/helper-core.ts") ?? "";
    expect(src).toContain("LEAFLY_ACK_ACTION_LABEL");
    expect(src).toContain("LEAFLY_STATUS_ACTION_WORDING");
  });

  it("no order-action label is hard-coded as a literal", () => {
    const src = readIfPresent("src/lib/leafly/helper-core.ts") ?? "";
    // The exact literals that were wrong in the first draft, plus the correct
    // spellings -- because hard-coding the RIGHT string today is what creates
    // the wrong one tomorrow.
    const banned = [
      'control: "Acknowledge"',
      'control: "Acknowledge to Leafly"',
      'control: "Confirmed"',
      'control: "Confirm order"',
      'control: "Picked up"',
      'control: "Mark picked up"',
      'control: "Cancel on Leafly"',
    ];
    const found = banned.filter((b) => src.includes(b));
    expect(found, "these must be imported from order-ack-core").toEqual([]);
  });
});

describe("the irreversible actions are marked as irreversible", () => {
  it("acknowledging is never described as safe", () => {
    const ack = ORDERS_DASHBOARD.features.find((f) =>
      f.control.toLowerCase().startsWith("acknowledge"),
    );
    expect(ack).toBeDefined();
    expect(ack!.safe).toBe(false);
    expect(ack!.caution ?? "").toMatch(/irreversible|cannot be undone|permanently/i);
  });

  it("every unsafe control carries a caution", () => {
    for (const w of ALL_WALKTHROUGHS) {
      for (const f of w.features) {
        if (!f.safe) {
          expect(f.caution, `${w.id} / ${f.control}`).toBeTruthy();
        }
      }
    }
  });

  it("the ID-image consequence is stated, because it cannot be reversed", () => {
    // Leafly revokes media access on acknowledgement. If the handbook does not
    // say so, the shop learns it the first time they need an ID they no longer
    // have.
    const prose = JSON.stringify(ORDERS_DASHBOARD).toLowerCase();
    expect(prose).toMatch(/id image|identification image|id photo/);
  });
});

describe("the owner's stated priorities are honoured in the ordering", () => {
  it("push & preview is first, the orders dashboard second", () => {
    expect(ALL_WALKTHROUGHS[0]!.id).toBe(PUSH_AND_PREVIEW.id);
    expect(ALL_WALKTHROUGHS[1]!.id).toBe(ORDERS_DASHBOARD.id);
  });

  it("the first-time checklist never returns to a safe step after going live", () => {
    const firstLive = FIRST_TIME_CHECKLIST.findIndex((c) => c.live);
    expect(firstLive).toBeGreaterThan(0);
    for (let i = firstLive; i < FIRST_TIME_CHECKLIST.length; i += 1) {
      // Once you are live you stay live; a checklist that flips back teaches
      // people that the live steps are not special.
      expect(FIRST_TIME_CHECKLIST[i]!.live).toBe(true);
    }
  });
});

describe("coverage: every Leafly surface a person can open is documented", () => {
  it("the four secondary surfaces are all present", () => {
    expect(OTHER_SURFACES.length).toBeGreaterThanOrEqual(4);
    const ids = OTHER_SURFACES.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("coverage reports real totals", () => {
    const c = helperCoverage();
    expect(c.walkthroughs).toBe(ALL_WALKTHROUGHS.length);
    expect(c.steps).toBeGreaterThan(20);
    expect(c.features).toBeGreaterThan(20);
  });

  it("lookup by id works for every walkthrough and fails for nonsense", () => {
    for (const w of ALL_WALKTHROUGHS) {
      expect(walkthroughById(w.id)).toBe(w);
    }
    expect(walkthroughById("no-such-walkthrough")).toBeNull();
  });

  it("search finds the acknowledge deadline, which is what people panic about", () => {
    const hits = searchHelper("acknowledge");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.id)).toContain(ORDERS_DASHBOARD.id);
  });

  it("search is not a firehose: an unrelated word returns nothing", () => {
    expect(searchHelper("zzzzz-not-a-real-word").length).toBe(0);
  });
});

describe("the big ideas explain WHY, which is what the owner asked for", () => {
  it("there are several, and each actually explains something", () => {
    expect(BIG_IDEAS.length).toBeGreaterThanOrEqual(5);
    for (const b of BIG_IDEAS) {
      expect(b.title.length).toBeGreaterThan(8);
      expect(b.body.length).toBeGreaterThan(120);
    }
  });

  it("the acknowledge-vs-confirm distinction is taught explicitly", () => {
    // This is the single most confusable pair in the whole integration:
    // one is a receipt, the other is business acceptance.
    const all = JSON.stringify(BIG_IDEAS).toLowerCase();
    expect(all).toContain("acknowledge");
    expect(all).toContain("confirm");
  });
});

describe("every step explains itself", () => {
  it("no step ships without a reason", () => {
    for (const w of ALL_WALKTHROUGHS) {
      for (const s of w.steps) {
        expect(s.why, `${w.id}: ${s.do}`).toBeTruthy();
        expect(s.why.length).toBeGreaterThan(30);
      }
    }
  });

  it("the two priority walkthroughs are genuinely step-by-step", () => {
    expect(PUSH_AND_PREVIEW.steps.length).toBeGreaterThanOrEqual(10);
    expect(ORDERS_DASHBOARD.steps.length).toBeGreaterThanOrEqual(8);
  });

  it("every walkthrough has troubleshooting and questions", () => {
    for (const w of ALL_WALKTHROUGHS) {
      expect(w.fixes.length, `${w.id} fixes`).toBeGreaterThan(0);
      expect(w.faq.length, `${w.id} faq`).toBeGreaterThan(0);
    }
  });
});

describe("the pure self-tests still run", () => {
  it("passes, and is not an empty suite", () => {
    // Rule 39 / L-10: "no failures" is also true of a suite that was deleted.
    const r = __runLeaflyHelperTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(300);
  });
});
