/**
 * tests/compliance/leafly-setup-collapsible.test.ts
 *
 * SLICE L-20 — "make the Leafly setup panel collapsible, with a green bar
 * IDENTICAL to 'Set up a speaker — full step-by-step guide'."
 *
 * The pure core proves the class contract. This file proves the two things a
 * core cannot see:
 *
 *   1. that BOTH panels actually render the shared bar (so "identical" is
 *      structural, not a coincidence that survives until someone edits one),
 *      and
 *   2. that collapsing the panel did not hide a problem — the M-2 bug was a
 *      blank Leafly board with nothing on screen to explain it, and a setup
 *      panel that folds itself shut during setup would bring that straight
 *      back.
 *
 * Every assertion here is broken on purpose by
 * `mutate-leafly-l20-collapsible.py`. A test that cannot fail is worse than
 * no test (rule 13c).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DISCLOSURE_SHELL_CLASS,
  DISCLOSURE_SUMMARY_CLASS,
  DISCLOSURE_TOKENS,
  disclosureLabel,
  shouldStartOpen,
  __runDisclosureTests,
} from "../../src/lib/admin/disclosure-core";
import { assessOrderReadiness } from "../../src/lib/leafly/order-readiness-core";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Strip comments — these files quote the old markup in their headers. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const CORE = "src/lib/admin/disclosure-core.ts";
const PANEL = "src/components/admin/ui/DisclosurePanel.tsx";
const SPEAKER = "src/components/admin/orders/AnnouncerSetupGuide.tsx";
const LEAFLY = "src/components/admin/orders/LeaflyOrderSetupPanel.tsx";
const GLOBALS = "src/app/globals.css";

describe("L-20 the pure core", () => {
  it("passes its own self-tests", () => {
    const r = __runDisclosureTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });

  it("the core stays pure — no runtime imports", () => {
    const importLines = read(CORE)
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l));
    expect(importLines).toEqual([]);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * THE WORD THAT DEFINES THIS SLICE: "IDENTICAL".
 *
 * Copying a class string makes two bars that are identical today. Rendering
 * one component makes two bars that are identical permanently. These tests
 * assert the second, because the first cannot be enforced.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-20 one bar, not two that look alike", () => {
  it("BOTH panels render the shared component", () => {
    for (const f of [SPEAKER, LEAFLY]) {
      const code = codeOnly(read(f));
      expect(code, `${f} must render DisclosurePanel`).toContain("<DisclosurePanel");
      expect(code, `${f} must import it`).toContain("DisclosurePanel");
    }
  });

  it("NEITHER panel hand-rolls its own <details> bar any more", () => {
    // This is the assertion that actually prevents drift. If somebody adds a
    // bespoke <details> back into either file, the two bars can diverge again
    // and the owner's "identical" quietly stops being true.
    for (const f of [SPEAKER, LEAFLY]) {
      const code = codeOnly(read(f));
      expect(code, `${f} must not hand-roll a <details>`).not.toContain("<details");
      expect(code, `${f} must not hand-roll a <summary>`).not.toContain("<summary");
    }
  });

  it("neither panel re-declares the bar's classes inline", () => {
    // A copy of the shell class string sitting in a component is the exact
    // drift this slice removes.
    for (const f of [SPEAKER, LEAFLY]) {
      const code = codeOnly(read(f));
      expect(code).not.toContain("bg-[var(--admin-accent)]/[0.06]");
    }
  });

  it("the shared component reads its classes from the core, not literals", () => {
    const code = codeOnly(read(PANEL));
    expect(code).toContain("DISCLOSURE_SHELL_CLASS");
    expect(code).toContain("DISCLOSURE_SUMMARY_CLASS");
    expect(code).toContain("disclosureLabel");
    // The literal must live in the core only.
    expect(code).not.toContain("rounded-[var(--admin-radius-lg)] border border-");
  });

  it("the speaker guide's wording is unchanged for the owner", () => {
    // He recognises this bar by its text. The refactor must be invisible.
    expect(disclosureLabel("📖", "Set up a speaker", "full step-by-step guide")).toBe(
      "📖 Set up a speaker — full step-by-step guide",
    );
    const code = codeOnly(read(SPEAKER));
    expect(code).toContain('title="Set up a speaker"');
    expect(code).toContain('subtitle="full step-by-step guide"');
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * THE TRAP: A PANEL THAT HIDES THE THING IT EXISTS TO EXPLAIN.
 *
 * M-2 was reported as "my Leafly order vanished and the page said nothing".
 * The board renders nothing until setup is complete, so this panel is the
 * only thing that can explain the empty space. Collapsing it by default
 * during setup would re-create that bug with a nicer UI.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-20 collapsing must not re-create the bug it replaced", () => {
  it("an unfinished, never-used integration starts OPEN", () => {
    expect(shouldStartOpen(3, false)).toBe(true);
    expect(shouldStartOpen(1, false)).toBe(true);
  });

  it("a working shop gets it collapsed, which is what was asked for", () => {
    expect(shouldStartOpen(0, false)).toBe(false);
    expect(shouldStartOpen(0, true)).toBe(false);
  });

  it("real orders outrank an unfinished checklist", () => {
    // Optional steps (speaker, printer) stay outstanding for a long time in a
    // happy shop. They must not force the panel open forever.
    expect(shouldStartOpen(5, true)).toBe(false);
  });

  it("the panel asks the shared rule rather than inventing its own", () => {
    const code = codeOnly(read(LEAFLY));
    expect(code).toContain("shouldStartOpen(");
    // `open` must be driven, never hard-coded — either value is a bug.
    expect(code).not.toMatch(/defaultOpen=\{(true|false)\}/);
  });

  it("the step count is visible WITHOUT opening the panel", () => {
    // The owner should be able to tell at a glance whether he needs to look
    // inside. A collapsed panel with no badge is a panel nobody opens.
    const code = codeOnly(read(LEAFLY));
    const bar = code.slice(code.indexOf("<DisclosurePanel"), code.indexOf("<Card"));
    expect(bar).toContain("badge=");
    expect(bar).toContain("steps");
  });

  it("the badge is rendered inside the summary, not after it", () => {
    const code = codeOnly(read(PANEL));
    const summaryStart = code.indexOf("<summary");
    const summaryEnd = code.indexOf("</summary>");
    expect(summaryStart).toBeGreaterThan(-1);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    expect(code.slice(summaryStart, summaryEnd)).toContain("badge");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * THE FLAG THE PANEL READS.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-20 anyOrderEverReceived is an echo, not a second opinion", () => {
  const BASE = {
    menuConfigured: true,
    hmacKeyPresent: true,
    orderIntegrationKeyPresent: true,
    verifiedDeliveryEverReceived: true,
    anyOrderEverReceived: false,
    speakerReady: true,
    printerReady: true,
    pickupAvailabilityEnabled: true,
  };

  it("reports exactly what it was told", () => {
    expect(assessOrderReadiness({ ...BASE, anyOrderEverReceived: true }).anyOrderEverReceived).toBe(
      true,
    );
    expect(
      assessOrderReadiness({ ...BASE, anyOrderEverReceived: false }).anyOrderEverReceived,
    ).toBe(false);
  });

  it("does not quietly follow `ready` instead", () => {
    // If this were derived from readiness, a fully-configured shop that has
    // never received an order would wrongly report evidence it does not have.
    const readyButQuiet = assessOrderReadiness({ ...BASE, anyOrderEverReceived: false });
    expect(readyButQuiet.ready).toBe(true);
    expect(readyButQuiet.anyOrderEverReceived).toBe(false);
  });

  it("survives a shop where nothing is configured but an order once landed", () => {
    const odd = assessOrderReadiness({
      ...BASE,
      menuConfigured: false,
      orderIntegrationKeyPresent: false,
      anyOrderEverReceived: true,
    });
    expect(odd.ready).toBe(false);
    expect(odd.anyOrderEverReceived).toBe(true);
    // And therefore the panel folds — evidence beats the checklist.
    expect(shouldStartOpen(2, odd.anyOrderEverReceived)).toBe(false);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * INVISIBLE FAILURES.
 *
 * A misspelled CSS token does not throw. The browser drops the declaration
 * and renders a panel with no border — which looks like a layout glitch, not
 * a bug, so it never gets reported.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-20 the green bar is actually green", () => {
  it("every token the bar names exists in globals.css", () => {
    const css = read(GLOBALS);
    for (const token of DISCLOSURE_TOKENS) {
      expect(css, `${token} must be declared`).toContain(`${token}:`);
    }
  });

  it("the token list matches the classes it claims to describe", () => {
    const used = new Set(
      [...`${DISCLOSURE_SHELL_CLASS} ${DISCLOSURE_SUMMARY_CLASS}`.matchAll(/(--admin-[a-z-]+)/g)].map(
        (m) => m[1],
      ),
    );
    expect([...used].sort()).toEqual([...DISCLOSURE_TOKENS].sort());
  });

  it("the bar uses the accent colour, which is what makes it the GREEN bar", () => {
    expect(DISCLOSURE_SHELL_CLASS).toContain("border-[var(--admin-accent)]");
    expect(DISCLOSURE_SHELL_CLASS).not.toContain("--admin-danger");
  });

  it("it works without JavaScript — a native <details>, no 'use client'", () => {
    // The orders board is a tablet left open all day. A bar that needs
    // hydration before it can be opened is stuck during first paint.
    // Comments are stripped first: the file's own header EXPLAINS that it is
    // deliberately not a client component, and a naive substring search would
    // match that prose and fail on a correct file. What matters is the
    // directive, which must be the first statement if present at all.
    const code = codeOnly(read(PANEL));
    expect(code).not.toContain('"use client"');
    expect(code).not.toContain("'use client'");
    expect(code).toContain("<details");
  });

  it("the core is registered in the self-test harness with a floor", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runDisclosureTests");
    const call = runner.slice(runner.indexOf('assertRan("disclosure-core"'));
    const line = call.slice(0, call.indexOf(");") + 1);
    const floor = Number((line.match(/,\s*(\d+)\s*\)/) ?? [])[1]);
    expect(Number.isInteger(floor)).toBe(true);
    expect(floor).toBeGreaterThanOrEqual(25);
    const measured = __runDisclosureTests().passed;
    expect(floor).toBeLessThanOrEqual(measured);
    expect(floor).toBeGreaterThanOrEqual(Math.floor(measured * 0.8));
  });
});
