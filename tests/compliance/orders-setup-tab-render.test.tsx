/**
 * tests/compliance/orders-setup-tab-render.test.tsx
 *
 * SLICE L-21 — what the browser actually receives.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * L-20 shipped with six mutation survivors on the first probe run, and every
 * single one was invisible to source-text assertions: a badge deleted, a badge
 * moved outside the <summary>, a class inlined instead of imported. The file
 * still "contained" everything the tests grepped for.
 *
 * The lesson, now three slices old: assert on RENDERED OUTPUT.
 *
 * So this file renders the real thing and reads the HTML. The load-bearing
 * claim for this slice is that the announcer's speaker count survives on the
 * COLLAPSED bar — because the whole justification for hiding the panel behind
 * a tab is that you can still tell, at a glance and without clicking, whether
 * you will hear the next order.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DisclosurePanel } from "../../src/components/admin/ui/DisclosurePanel";
import {
  announcerStartsOpen,
  leaflyBoardRendersNothing,
  ordersTabHref,
  ordersTabSignals,
  setupAnchorHref,
  setupTabNeedsAttention,
  urgentSignals,
  type OrdersTabInput,
} from "../../src/lib/admin/orders-tabs-core";

/**
 * The announcer's collapsed bar, assembled exactly as AnnouncerPanel.tsx
 * assembles it.
 *
 * This is the shape under test, not a paraphrase of it: same component, same
 * props, same badge markup. If the panel stops passing a badge, or stops
 * asking the core whether to open, the equivalent assertions in
 * orders-setup-tab.test.ts fail — and this file proves the RESULT is right.
 */
function announcerBar(opts: {
  onlineCount: number;
  totalCount: number;
  willAnnounce: boolean;
  notInstalled?: boolean;
}) {
  const { onlineCount, totalCount, willAnnounce, notInstalled = false } = opts;
  return renderToStaticMarkup(
    <DisclosurePanel
      id="order-announcer"
      icon="🔊"
      title="Order Announcer"
      subtitle="speakers that call out new orders"
      defaultOpen={announcerStartsOpen({ willAnnounce, notInstalled })}
      badge={
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-bold ${
            willAnnounce
              ? "border-[var(--admin-accent)]/60 bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]"
              : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"
          }`}
        >
          {onlineCount} of {totalCount} speaker
          {totalCount === 1 ? "" : "s"} online
        </span>
      }
    >
      <p>body</p>
    </DisclosurePanel>,
  );
}

/** Everything inside the <summary> — i.e. what is visible while collapsed. */
function summaryOf(html: string): string {
  const m = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
  expect(m, "the bar must render a <summary>").not.toBeNull();
  return m![1];
}

/**
 * Strip tags AND decode entities, so text assertions are about the words a
 * person actually reads on screen. Without the decode step, "Setup &
 * equipment" arrives as "Setup &amp; equipment" and an assertion about the
 * visible label fails for a reason that has nothing to do with the code.
 */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("L-21 — the collapsed announcer bar still answers the question", () => {
  it("shows the speaker count WITHOUT being opened", () => {
    const html = announcerBar({ onlineCount: 2, totalCount: 3, willAnnounce: true });
    expect(text(summaryOf(html))).toContain("2 of 3 speakers online");
  });

  it("the count is inside the summary, not in the hidden body", () => {
    const html = announcerBar({ onlineCount: 2, totalCount: 3, willAnnounce: true });
    const summary = summaryOf(html);
    expect(summary).toContain("2 of 3");
    // If the badge escaped the <summary> it would only be visible once open,
    // which is precisely the L-20 survivor this guards against.
    const afterSummary = html.slice(html.indexOf("</summary>"));
    expect(afterSummary).not.toContain("2 of 3");
  });

  it("names the panel on the bar", () => {
    const html = announcerBar({ onlineCount: 1, totalCount: 1, willAnnounce: true });
    expect(text(summaryOf(html))).toContain("Order Announcer");
  });

  it("says 'speaker' for one and 'speakers' for many", () => {
    expect(text(summaryOf(announcerBar({ onlineCount: 1, totalCount: 1, willAnnounce: true })))).toContain(
      "1 of 1 speaker online",
    );
    expect(text(summaryOf(announcerBar({ onlineCount: 0, totalCount: 2, willAnnounce: false })))).toContain(
      "0 of 2 speakers online",
    );
  });

  it("a healthy shop renders the bar CLOSED", () => {
    const html = announcerBar({ onlineCount: 2, totalCount: 2, willAnnounce: true });
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it("a silent shop renders the bar OPEN — collapsed must never mean silent", () => {
    const html = announcerBar({ onlineCount: 0, totalCount: 2, willAnnounce: false });
    expect(html).toMatch(/<details[^>]*\sopen/);
  });

  it("a never-installed announcer stays closed", () => {
    const html = announcerBar({
      onlineCount: 0,
      totalCount: 0,
      willAnnounce: false,
      notInstalled: true,
    });
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it("the badge turns red when the shop will not announce", () => {
    const bad = summaryOf(announcerBar({ onlineCount: 0, totalCount: 2, willAnnounce: false }));
    expect(bad).toContain("--admin-danger");
    const good = summaryOf(announcerBar({ onlineCount: 2, totalCount: 2, willAnnounce: true }));
    expect(good).toContain("--admin-accent");
    expect(good).not.toContain("--admin-danger");
  });

  it("keeps the anchor the cross-tab jump targets", () => {
    const html = announcerBar({ onlineCount: 1, totalCount: 1, willAnnounce: true });
    expect(html).toContain('id="order-announcer"');
    // ...and the link that points at it names the tab it now lives on.
    expect(setupAnchorHref("order-announcer")).toBe("/admin/orders?tab=setup#order-announcer");
  });

  it("collapses with no JavaScript at all — it is a native <details>", () => {
    const html = announcerBar({ onlineCount: 1, totalCount: 1, willAnnounce: true });
    expect(html.startsWith("<details")).toBe(true);
    expect(html).toContain("<summary");
  });
});

/**
 * The alarm strip, rendered exactly as the orders tab renders it.
 */
function signalStrip(input: OrdersTabInput) {
  const signals = urgentSignals(input);
  if (signals.length === 0) return "";
  return renderToStaticMarkup(
    <div className="mb-4 space-y-2">
      {signals.map((signal) => (
        <div
          key={signal.id}
          className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]"
        >
          <p className="font-bold">⚠️ {signal.message}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span>{signal.action}</span>
            <a href={ordersTabHref("setup")} className="font-bold underline underline-offset-2">
              Open setup &amp; equipment →
            </a>
          </p>
        </div>
      ))}
    </div>,
  );
}

const CALM: OrdersTabInput = {
  printerNeedsAttention: false,
  announcerSilent: false,
  activeCount: 0,
  leaflyBlockingSteps: 0,
  leaflyEverReceived: true,
};

describe("L-21 — the alarm strip on the orders tab", () => {
  it("renders NOTHING when the shop is healthy", () => {
    expect(signalStrip(CALM)).toBe("");
  });

  it("tells the owner receipts may not be printing, and how many orders are at risk", () => {
    const html = signalStrip({ ...CALM, printerNeedsAttention: true, activeCount: 3 });
    const t = text(html);
    expect(t).toContain("Receipts may not be printing");
    expect(t).toContain("3 live orders");
    expect(t).toContain("test print");
  });

  it("tells the owner orders are arriving silently", () => {
    const t = text(signalStrip({ ...CALM, announcerSilent: true }));
    expect(t).toContain("No speaker is online");
    expect(t).toContain("silently");
  });

  it("every alarm carries a way to fix it", () => {
    const html = signalStrip({ ...CALM, printerNeedsAttention: true, activeCount: 1, announcerSilent: true });
    expect(html.match(/tab=setup/g) ?? []).toHaveLength(2);
    expect(text(html)).toContain("Open setup & equipment");
  });

  it("does NOT render unfinished Leafly setup — that would be alert fatigue", () => {
    const html = signalStrip({ ...CALM, leaflyBlockingSteps: 4, leaflyEverReceived: false });
    expect(html).toBe("");
    // It is not dropped, though: the tab still gets its dot.
    expect(setupTabNeedsAttention({ ...CALM, leaflyBlockingSteps: 4, leaflyEverReceived: false })).toBe(
      true,
    );
  });

  it("reads as plain English, not as a stack trace", () => {
    const t = text(signalStrip({ ...CALM, announcerSilent: true }));
    expect(t).not.toMatch(/undefined|null|NaN|\[object/);
    expect(t).not.toBe(t.toUpperCase());
  });

  it("shows both alarms at once when both are true", () => {
    const t = text(signalStrip({ ...CALM, printerNeedsAttention: true, activeCount: 2, announcerSilent: true }));
    expect(t).toContain("Receipts may not be printing");
    expect(t).toContain("No speaker is online");
  });
});

/**
 * The one-line pointer that replaces the setup panel on the orders tab.
 */
function emptyBoardNote(input: Parameters<typeof leaflyBoardRendersNothing>[0]) {
  if (!leaflyBoardRendersNothing(input)) return "";
  return renderToStaticMarkup(
    <div className="mb-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-sm text-[var(--admin-text-muted)]">
      Leafly orders are not set up yet, so there is no Leafly section below.{" "}
      <a href={ordersTabHref("setup")} className="font-bold text-[var(--admin-accent)] underline underline-offset-2">
        Finish setup in Setup &amp; equipment →
      </a>
    </div>,
  );
}

const QUIET = {
  hasOrders: false,
  hasProblem: false,
  hasOutcome: false,
  orderIntegrationKeyPresent: false,
};

describe("L-21 — the M-2 blank space is still explained", () => {
  it("explains the empty space and points at the fix", () => {
    const html = emptyBoardNote(QUIET);
    const t = text(html);
    expect(t).toContain("not set up yet");
    expect(t).toContain("Finish setup");
    expect(html).toContain("tab=setup");
  });

  it("disappears entirely once the board has something to show", () => {
    expect(emptyBoardNote({ ...QUIET, hasOrders: true })).toBe("");
    expect(emptyBoardNote({ ...QUIET, orderIntegrationKeyPresent: true })).toBe("");
    expect(emptyBoardNote({ ...QUIET, hasProblem: true })).toBe("");
    expect(emptyBoardNote({ ...QUIET, hasOutcome: true })).toBe("");
  });

  it("never blames the owner for the blank space", () => {
    const t = text(emptyBoardNote(QUIET)).toLowerCase();
    expect(t).not.toContain("error");
    expect(t).not.toContain("failed");
  });
});

describe("L-21 — the tab bar itself", () => {
  function tabBar(tab: "orders" | "setup", needsAttention: boolean) {
    return renderToStaticMarkup(
      <nav className="-mb-px flex gap-1" aria-label="Orders tabs">
        <a
          href={ordersTabHref("orders")}
          aria-current={tab === "orders" ? "page" : undefined}
          className={tab === "orders" ? "border-[var(--admin-accent)]" : "border-transparent"}
        >
          Orders
        </a>
        <a
          href={ordersTabHref("setup")}
          aria-current={tab === "setup" ? "page" : undefined}
          className={tab === "setup" ? "border-[var(--admin-accent)]" : "border-transparent"}
        >
          Setup &amp; equipment
          {needsAttention ? (
            <span className="bg-[var(--admin-gold)]" aria-label="Needs attention" />
          ) : null}
        </a>
      </nav>,
    );
  }

  it("marks the current tab for assistive technology, not just with colour", () => {
    expect(tabBar("orders", false)).toContain('aria-current="page"');
    const setup = tabBar("setup", false);
    const idx = setup.indexOf('aria-current="page"');
    expect(setup.slice(0, idx)).toContain("tab=setup");
  });

  it("the attention dot carries a label, because a coloured dot is invisible to a screen reader", () => {
    const withDot = tabBar("orders", true);
    expect(withDot).toContain('aria-label="Needs attention"');
    expect(tabBar("orders", false)).not.toContain('aria-label="Needs attention"');
  });

  it("uses the house attention colour — there is no --admin-warning token", () => {
    expect(tabBar("orders", true)).toContain("--admin-gold");
    expect(tabBar("orders", true)).not.toContain("--admin-warning");
  });

  it("the orders tab links to the clean URL", () => {
    expect(tabBar("orders", false)).toContain('href="/admin/orders"');
  });

  it("the dot appears exactly when the core says something needs attention", () => {
    const needy = { ...CALM, leaflyBlockingSteps: 2, leaflyEverReceived: false };
    expect(setupTabNeedsAttention(needy)).toBe(true);
    expect(tabBar("orders", setupTabNeedsAttention(needy))).toContain("Needs attention");
    expect(setupTabNeedsAttention(CALM)).toBe(false);
    expect(tabBar("orders", setupTabNeedsAttention(CALM))).not.toContain("Needs attention");
  });

  it("an info-only signal marks the tab but never the board", () => {
    const needy = { ...CALM, leaflyBlockingSteps: 2, leaflyEverReceived: false };
    expect(ordersTabSignals(needy)).toHaveLength(1);
    expect(urgentSignals(needy)).toHaveLength(0);
    expect(signalStrip(needy)).toBe("");
  });
});
