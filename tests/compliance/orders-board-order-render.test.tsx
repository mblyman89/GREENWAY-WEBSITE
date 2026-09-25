/**
 * tests/compliance/orders-board-order-render.test.tsx
 *
 * SLICE L-22 — what the browser actually receives.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * L-20 shipped with six mutation survivors on its first probe run, and L-21
 * with six more. Every one of them was invisible to source-text assertions:
 * markup still present in the file, but wired so it could never reach the
 * screen, or a class inlined instead of imported.
 *
 * The lesson, now four slices old: assert on RENDERED OUTPUT.
 *
 * The load-bearing claim for this slice is that a website order in a mixed
 * list is LABELLED. Not that the page passes a prop — that a reader looking at
 * the screen can see the word. The whole reason for changing L-12's behaviour
 * is that "unlabelled" is not a label, and only rendering can prove a label is
 * there.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderOriginBadge } from "../../src/components/admin/orders/OrderOriginBadge";
import {
  BOARD_SECTIONS,
  describeOriginMix,
  shouldLabelWebsiteRows,
  tallyOrigins,
  type BoardSection,
} from "../../src/lib/admin/orders-board-order-core";
import { orderOriginLabel } from "../../src/lib/orders/order-origin-core";

/** Strip tags and decode entities, so assertions are about words a person reads. */
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

/**
 * A row's badge, rendered exactly as page.tsx renders it — the real component,
 * the real prop expression (`hideWebsite={!labelWebsiteRows}`), driven by the
 * real core. This is the shape under test, not a paraphrase of it.
 */
function rowBadge(origin: string | null, labelWebsiteRows: boolean): string {
  return renderToStaticMarkup(
    <OrderOriginBadge origin={origin} hideWebsite={!labelWebsiteRows} />,
  );
}

/** A whole list of rows, as the reader sees it. */
function renderList(rows: (string | null)[], shopReceivesLeaflyOrders: boolean): string[] {
  const label = shouldLabelWebsiteRows({
    shopReceivesLeaflyOrders,
    originsOnScreen: rows,
  });
  return rows.map((r) => text(rowBadge(r, label)));
}

// ===========================================================================
describe("L-22 — a mixed list labels every row, so no row is identified by absence", () => {
  it("a website row in a Leafly-enabled shop actually SHOWS the word", () => {
    // THE CLAIM OF THIS SLICE. Not "the prop is passed" — the word is on screen.
    expect(text(rowBadge("greenway", true))).toBe(orderOriginLabel("greenway"));
    expect(text(rowBadge("greenway", true))).toBe("Website");
  });

  it("a Leafly row shows its word too", () => {
    expect(text(rowBadge("leafly", true))).toBe("Leafly");
  });

  it("no row in a mixed list renders empty — absence is never the label", () => {
    const rendered = renderList(["greenway", "leafly", null, "greenway"], true);
    expect(rendered).toEqual(["Website", "Leafly", "Website", "Website"]);
    for (const r of rendered) expect(r.length).toBeGreaterThan(0);
  });

  it("the quiet L-12 behaviour is intact for a shop that never sees Leafly", () => {
    const rendered = renderList(["greenway", "greenway", null], false);
    expect(rendered).toEqual(["", "", ""]);
  });

  it("the safety valve renders BOTH when the flag is wrong but a Leafly row is visible", () => {
    // anyOrderEverReceived degrades a failed count to false. The screen must
    // not end up half-labelled because a count failed.
    const rendered = renderList(["greenway", "leafly"], false);
    expect(rendered).toEqual(["Website", "Leafly"]);
  });

  it("an unrecognised origin renders as Website rather than as a blank gap", () => {
    expect(text(rowBadge("martian", true))).toBe("Website");
  });

  it("every rendered badge carries a spelled-out title for screen readers", () => {
    for (const o of ["greenway", "leafly", "register"]) {
      const html = rowBadge(o, true);
      expect(html).toContain('title="This order came from: ');
      expect(html).toContain(orderOriginLabel(o as "greenway"));
    }
  });

  it("labelling is all-or-nothing across a page — never a partial column", () => {
    for (const rows of [
      ["greenway", "greenway"],
      ["greenway", "leafly"],
      ["leafly", "leafly"],
      [null, "greenway", "leafly"],
    ]) {
      for (const flag of [true, false]) {
        const rendered = renderList(rows as (string | null)[], flag);
        const blanks = rendered.filter((r) => r === "").length;
        // Either every row is labelled, or none is. A mixed column means a
        // reader has to infer an origin from an empty space.
        expect(blanks === 0 || blanks === rendered.length).toBe(true);
      }
    }
  });
});

// ===========================================================================
describe("L-22 — the mix summary, as rendered", () => {
  /** The summary paragraph exactly as page.tsx renders it. */
  const summary = (rows: (string | null)[]) => {
    const s = describeOriginMix(tallyOrigins(rows), orderOriginLabel);
    return s
      ? text(
          renderToStaticMarkup(
            <p className="mt-2 text-xs font-semibold text-[var(--admin-text-muted)]">{s}</p>,
          ),
        )
      : "";
  };

  it("reads as a sentence about this page", () => {
    expect(summary(["greenway", "greenway", "leafly"])).toBe("On this page: 2 Website · 1 Leafly");
  });

  it("uses the same words as the badges beside it", () => {
    const s = summary(["greenway", "leafly"]);
    expect(s).toContain(text(rowBadge("greenway", true)));
    expect(s).toContain(text(rowBadge("leafly", true)));
  });

  it("renders nothing at all for a single-origin page", () => {
    expect(summary(["greenway", "greenway"])).toBe("");
    expect(summary([])).toBe("");
  });

  it("never claims to be a shop total", () => {
    const s = summary(["greenway", "leafly"]);
    expect(s.startsWith("On this page:")).toBe(true);
    expect(s).not.toMatch(/total|all time|overall/i);
  });
});

// ===========================================================================
describe("L-40 — the sections reach the screen in a fixed order", () => {
  /**
   * SLICE L-40 — L-22 rendered the sections from decideBoardLayout(), which
   * put Leafly first (with a gold banner) while an order was unacknowledged.
   * The owner removed that: Leafly orders are accepted automatically, so the
   * order is fixed. This renders the core's fixed list with markers; the real
   * panels are rendered side by side in orders-panels-l40.test.tsx.
   */
  const board = () => {
    const section = (s: BoardSection) =>
      s === "leafly" ? <div key={s}>LEAFLY-BOARD</div> : <div key={s}>GREENWAY-CARDS</div>;
    return renderToStaticMarkup(<>{BOARD_SECTIONS.map(section)}</>);
  };

  it("puts our orders first, as the owner asked", () => {
    const html = board();
    expect(html.indexOf("GREENWAY-CARDS")).toBeLessThan(html.indexOf("LEAFLY-BOARD"));
  });

  it("renders each section exactly once", () => {
    const html = board();
    expect((html.match(/LEAFLY-BOARD/g) ?? []).length).toBe(1);
    expect((html.match(/GREENWAY-CARDS/g) ?? []).length).toBe(1);
  });

  it("carries no promotion banner and no deadline wording", () => {
    const html = board();
    expect(html).not.toContain('role="status"');
    expect(text(html)).not.toMatch(/waiting to be acknowledged|15 minutes/);
  });
});
