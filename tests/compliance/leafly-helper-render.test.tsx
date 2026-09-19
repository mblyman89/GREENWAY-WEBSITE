/**
 * tests/compliance/leafly-helper-render.test.tsx   (Slice B)
 *
 * PROVING THE HANDBOOK ACTUALLY RENDERS.
 *
 * Three things were already true before this file existed:
 *
 *   * `tsc` said the components type-check,
 *   * `next build` said the route compiles,
 *   * `leafly-helper.test.ts` said the CONTENT is correct.
 *
 * None of those is the same as "a person opening this page sees the words".
 * A component can type-check, compile, and hold perfect data while rendering
 * an empty div.
 *
 * The obvious check -- open the page -- could not be completed in this
 * sandbox: every admin route stops at "Back Office - setup required" because
 * no database is configured. That gate sits upstream of the page, so it
 * proves nothing either way about the handbook. (Verified by requesting
 * /admin/orders and /admin/integrations/leafly, which are long-standing pages
 * and produce exactly the same gate.)
 *
 * So rather than claim a verification that did not happen, this file renders
 * the components to HTML and asserts the words are really in the output. It
 * needs no database, because the handbook needs no database: its content is
 * static data compiled into the bundle, which is precisely why it was built
 * that way.
 *
 * WHY renderToStaticMarkup AND NOT A DOM LIBRARY
 * ----------------------------------------------
 * @testing-library is not a dependency of this repo, and adding one to make a
 * test possible is a cost paid by every future install. `react-dom/server` is
 * already here because Next.js uses it. The trade is honest and stated below.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 * ------------------------------
 * CAN:    the text reaches the markup; the counts match the data; the
 *         irreversible badges and the live/rehearsal boundary are rendered;
 *         the content that must not be hidden is present on first paint.
 * CANNOT: that a click opens a tab (this is static markup, so the collapsed
 *         panels are genuinely absent, and that is asserted rather than
 *         glossed over); that the colours have contrast; that a keyboard can
 *         reach the controls. Those need a human and a real browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeaflyFirstTimeChecklist } from "@/components/admin/leafly/LeaflyFirstTimeChecklist";
import { LeaflyWalkthrough } from "@/components/admin/leafly/LeaflyWalkthrough";
import {
  ALL_WALKTHROUGHS,
  FIRST_TIME_CHECKLIST,
  ORDERS_DASHBOARD,
  PUSH_AND_PREVIEW,
} from "@/lib/leafly/helper-core";

/** Render to markup and strip tags, so assertions are about VISIBLE words. */
function renderText(node: React.ReactElement): string {
  const html = renderToStaticMarkup(node);
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

function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("every walkthrough renders without throwing", () => {
  it.each(ALL_WALKTHROUGHS.map((w) => [w.id, w] as const))("%s", (_id, w) => {
    const text = renderText(<LeaflyWalkthrough walkthrough={w} />);
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain(normalise(w.title));
    expect(text).toContain(normalise(w.purpose));
  });
});

describe("the things that must not be hidden are visible on first paint", () => {
  it("the read-first warning is outside the tabs", () => {
    // If this ever moves behind a tab it becomes optional reading, and it is
    // not optional: it carries the irreversible or time-limited fact.
    for (const w of [PUSH_AND_PREVIEW, ORDERS_DASHBOARD]) {
      const text = renderText(<LeaflyWalkthrough walkthrough={w} />);
      expect(text, w.id).toContain("Read this first:");
      expect(text, w.id).toContain(normalise(w.readFirst));
    }
  });

  it("every step is listed immediately, with no click required", () => {
    const text = renderText(<LeaflyWalkthrough walkthrough={PUSH_AND_PREVIEW} />);
    for (const step of PUSH_AND_PREVIEW.steps) {
      expect(text, step.do).toContain(normalise(step.do));
    }
  });

  it("irreversible steps carry a visible badge, not just a data flag", () => {
    const html = renderToStaticMarkup(
      <LeaflyWalkthrough walkthrough={PUSH_AND_PREVIEW} />,
    );
    const badges = html.split("Cannot be undone").length - 1;
    const flagged = PUSH_AND_PREVIEW.steps.filter((s) => s.irreversible).length;
    expect(flagged).toBeGreaterThan(0);
    expect(badges).toBe(flagged);
  });

  it("the tab labels advertise how much is behind each one", () => {
    const text = renderText(<LeaflyWalkthrough walkthrough={PUSH_AND_PREVIEW} />);
    expect(text).toContain(`Walk me through it (${PUSH_AND_PREVIEW.steps.length})`);
    expect(text).toContain(
      `What every control does (${PUSH_AND_PREVIEW.features.length})`,
    );
    expect(text).toContain(
      `When something looks wrong (${PUSH_AND_PREVIEW.fixes.length})`,
    );
    expect(text).toContain(`Questions (${PUSH_AND_PREVIEW.faq.length})`);
  });

  it("the sources are shown so any claim can be checked", () => {
    const text = renderText(<LeaflyWalkthrough walkthrough={PUSH_AND_PREVIEW} />);
    expect(text).toContain(
      `Where these facts come from (${PUSH_AND_PREVIEW.source.length} files)`,
    );
    for (const s of PUSH_AND_PREVIEW.source) {
      expect(text, s).toContain(s);
    }
  });

  it("the collapsed detail really is collapsed, not merely styled away", () => {
    // Honesty about the limits of this harness: the "why" text is absent from
    // first-paint markup because the panel is closed, and that is the correct
    // behaviour for "one baby step at a time". Asserting it here stops anyone
    // reading the suite above and assuming a click was simulated.
    const text = renderText(<LeaflyWalkthrough walkthrough={PUSH_AND_PREVIEW} />);
    expect(text).not.toContain(normalise(PUSH_AND_PREVIEW.steps[0]!.why));
  });
});

describe("the orders dashboard shows the dangerous controls by their real names", () => {
  it("renders the acknowledge and picked-up labels imported from the core", () => {
    // These strings are imported from order-ack-core, so if a button is ever
    // renamed this test renders the NEW name and the content test proves it
    // matches the source. A hard-coded label could pass both while being wrong.
    const text = renderText(
      <LeaflyWalkthrough walkthrough={ORDERS_DASHBOARD} defaultTab="features" />,
    );
    expect(text).toContain("Acknowledge to Leafly");
    expect(text).toContain("Mark picked up");
    expect(text).toContain("Confirm order");
  });

  it("puts the ID-image consequence on the screen", () => {
    const text = renderText(
      <LeaflyWalkthrough walkthrough={ORDERS_DASHBOARD} defaultTab="features" />,
    );
    const ack = ORDERS_DASHBOARD.features.find(
      (f) => f.control === "Acknowledge to Leafly",
    );
    expect(ack?.caution).toBeTruthy();
    expect(text).toContain(normalise(ack!.caution!));
  });

  it("marks unsafe controls Careful and safe ones Safe to click", () => {
    const html = renderToStaticMarkup(
      <LeaflyWalkthrough walkthrough={ORDERS_DASHBOARD} defaultTab="features" />,
    );
    const careful = html.split("Careful").length - 1;
    const safe = html.split("Safe to click").length - 1;
    expect(careful).toBe(ORDERS_DASHBOARD.features.filter((f) => !f.safe).length);
    expect(safe).toBe(ORDERS_DASHBOARD.features.filter((f) => f.safe).length);
  });
});

describe("the first-time checklist renders its ordering as a visible boundary", () => {
  it("draws the line between rehearsal and live", () => {
    const text = renderText(<LeaflyFirstTimeChecklist />);
    expect(text).toContain("Below here, customers can see it");
  });

  it("labels every item, and the counts match the data exactly", () => {
    const html = renderToStaticMarkup(<LeaflyFirstTimeChecklist />);
    const live = FIRST_TIME_CHECKLIST.filter((c) => c.live).length;
    const safe = FIRST_TIME_CHECKLIST.length - live;
    expect(html.split("Customers can see this").length - 1).toBe(live);
    expect(html.split(">Rehearsal<").length - 1).toBe(safe);
  });

  it("shows every item and the reason it sits where it does", () => {
    const text = renderText(<LeaflyFirstTimeChecklist />);
    for (const item of FIRST_TIME_CHECKLIST) {
      expect(text, item.id).toContain(normalise(item.label));
      expect(text, `${item.id} why`).toContain(normalise(item.why));
    }
  });

  it("says plainly that ticks are not evidence", () => {
    // A checklist that looked authoritative would become a second, weaker
    // source of truth competing with the sync log and the evidence panel.
    const text = renderText(<LeaflyFirstTimeChecklist />);
    expect(text).toContain("they are not saved, and they are not evidence");
  });

  it("renders one checkbox per item", () => {
    const html = renderToStaticMarkup(<LeaflyFirstTimeChecklist />);
    expect(html.split('type="checkbox"').length - 1).toBe(
      FIRST_TIME_CHECKLIST.length,
    );
  });
});
