/**
 * tests/compliance/leafly-setup-panel-render.test.tsx
 *
 * SLICE L-20 — THE LEAFLY SETUP PANEL, ACTUALLY RENDERED.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * The mutation probe's last survivor was this:
 *
 *     "the step count disappears from the collapsed bar"
 *
 * Deleting the badge from `LeaflyOrderSetupPanel` left the shared component
 * perfect, the pure core perfect, and every source-grep assertion passing —
 * while the owner lost the one thing that tells him whether a collapsed
 * panel is worth opening. A panel that folds away its own "3 steps left" is
 * a panel he will never open, which makes collapsing it a regression rather
 * than the tidy-up he asked for.
 *
 * The shared primitive is render-tested in `disclosure-panel-render.test.tsx`.
 * This file renders the REAL PANEL with a realistic setup state, because the
 * wiring between the two is where that survivor lived.
 *
 * The fixture is deliberately complete and typed as `LeaflyOrderSetupState`,
 * so if the shape of that state ever changes, this test fails to COMPILE
 * rather than silently drifting out of date.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeaflyOrderSetupPanel } from "@/components/admin/orders/LeaflyOrderSetupPanel";
import type { LeaflyOrderSetupState } from "@/lib/leafly/order-readiness-server";
import { assessOrderReadiness } from "@/lib/leafly/order-readiness-core";

/** Everything between <summary> and </summary> — the bar while collapsed. */
function summaryInner(html: string): string {
  const m = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
  return m ? m[1] : "";
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const READY_INPUT = {
  menuConfigured: true,
  hmacKeyPresent: true,
  orderIntegrationKeyPresent: true,
  verifiedDeliveryEverReceived: true,
  anyOrderEverReceived: true,
  speakerReady: true,
  printerReady: true,
  pickupAvailabilityEnabled: true,
};

/** A complete, typed setup state. Overridable per test. */
function stateFor(input: Partial<typeof READY_INPUT>): LeaflyOrderSetupState {
  const readiness = assessOrderReadiness({ ...READY_INPUT, ...input });
  return {
    readiness,
    destinations: [
      { event: "order_create", url: "https://example.com/api/leafly/orders", requirement: "required" },
    ],
    destinationProblem: null,
    originSource: "configured",
    origin: "https://example.com",
    evidence: {
      verifiedDeliveryEverReceived: true,
      totalDeliveries: 4,
      rejectedDeliveries: 0,
      lastDeliveryAt: "2026-09-01T10:00:00.000Z",
      lastVerifiedDeliveryAt: "2026-09-01T10:00:00.000Z",
      eventTypesSeen: ["order_create"],
      refusals: [],
      refusalDiagnosis: {
        verdict: "healthy",
        headline: "No refusals.",
        detail: "Nothing has been turned away.",
        contactLeafly: false,
        actionIsOurs: false,
        breakdown: {
          total: 0,
          keyMismatchCount: 0,
          oursCount: 0,
          notLeaflyCount: 0,
          unknownCount: 0,
          buckets: [],
        },
      },
      signatureRefusalBlockingNow: false,
      problem: "",
    },
    explanation: "Nothing is wrong.",
    pickupAvailabilityEnabled: true,
    publishedVariantCount: 12,
    emptyCart: {
      cause: "none",
      headline: "Nothing should be emptying the cart.",
      detail: "All clear.",
      blocking: false,
    },
    problems: [],
  };
}

/*
 * ─────────────────────────────────────────────────────────────────────────
 * THE SURVIVOR: the collapsed bar must carry its own status.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-20 the collapsed Leafly panel tells you whether to open it", () => {
  it("an unfinished setup shows its step count ON THE BAR", () => {
    // Two blocking steps missing: no HMAC key and no order integration key.
    const html = renderToStaticMarkup(
      <LeaflyOrderSetupPanel
        setup={stateFor({
          hmacKeyPresent: false,
          orderIntegrationKeyPresent: false,
          anyOrderEverReceived: false,
        })}
      />,
    );
    const bar = textOf(summaryInner(html));
    expect(bar).toMatch(/\d+ steps? left/);
  });

  it("the count is the real number of blocking steps, not a guess", () => {
    const setup = stateFor({
      hmacKeyPresent: false,
      orderIntegrationKeyPresent: false,
      anyOrderEverReceived: false,
    });
    const expected = setup.readiness.steps.filter((s) => !s.done && s.blocking).length;
    expect(expected).toBeGreaterThan(0);
    const bar = textOf(summaryInner(renderToStaticMarkup(<LeaflyOrderSetupPanel setup={setup} />)));
    expect(bar).toContain(`${expected} step`);
  });

  it("singular when exactly one step is left", () => {
    const setup = stateFor({ orderIntegrationKeyPresent: false, anyOrderEverReceived: false });
    const remaining = setup.readiness.steps.filter((s) => !s.done && s.blocking).length;
    const bar = textOf(summaryInner(renderToStaticMarkup(<LeaflyOrderSetupPanel setup={setup} />)));
    if (remaining === 1) {
      expect(bar).toContain("1 step left");
      expect(bar).not.toContain("1 steps left");
    } else {
      expect(bar).toContain(`${remaining} steps left`);
    }
  });

  it("a finished setup says 'ready' on the bar", () => {
    const bar = textOf(
      summaryInner(renderToStaticMarkup(<LeaflyOrderSetupPanel setup={stateFor({})} />)),
    );
    expect(bar).toContain("ready");
  });

  it("the bar always names what it is", () => {
    const bar = textOf(
      summaryInner(renderToStaticMarkup(<LeaflyOrderSetupPanel setup={stateFor({})} />)),
    );
    expect(bar).toContain("Leafly orders");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * COLLAPSING MUST NOT HIDE A PROBLEM (the M-2 regression).
 * ─────────────────────────────────────────────────────────────────────────
 */
describe("L-20 open when it matters, collapsed when it does not", () => {
  it("a broken, never-used integration renders OPEN", () => {
    const html = renderToStaticMarkup(
      <LeaflyOrderSetupPanel
        setup={stateFor({
          menuConfigured: false,
          hmacKeyPresent: false,
          orderIntegrationKeyPresent: false,
          verifiedDeliveryEverReceived: false,
          anyOrderEverReceived: false,
        })}
      />,
    );
    expect(/<details[^>]*\sopen/.test(html)).toBe(true);
  });

  it("a working shop renders COLLAPSED, which is what was asked for", () => {
    const html = renderToStaticMarkup(<LeaflyOrderSetupPanel setup={stateFor({})} />);
    expect(/<details[^>]*\sopen/.test(html)).toBe(false);
  });

  it("orders arriving collapses the panel even with optional steps left", () => {
    const html = renderToStaticMarkup(
      <LeaflyOrderSetupPanel
        setup={stateFor({ speakerReady: false, printerReady: false, anyOrderEverReceived: true })}
      />,
    );
    expect(/<details[^>]*\sopen/.test(html)).toBe(false);
  });

  it("the panel keeps its deep-link anchor so the handbook can point at it", () => {
    const html = renderToStaticMarkup(<LeaflyOrderSetupPanel setup={stateFor({})} />);
    expect(html).toContain("leafly-order-setup");
  });

  it("the body is still there once expanded — nothing was deleted", () => {
    const setup = stateFor({});
    const full = textOf(renderToStaticMarkup(<LeaflyOrderSetupPanel setup={setup} />));
    // The headline lives in the CardHeader inside the panel body.
    expect(full).toContain(setup.readiness.headline);
  });
});
