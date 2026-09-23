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
  decideBoardLayout,
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
describe("L-22 — the sections reach the screen in the core's order", () => {
  /**
   * The page's own render expression, reproduced with the two sections stood
   * in for by markers. If the page stops mapping the core's list, or renders
   * one section twice, this shape is what changes.
   */
  const board = (leaflyPendingAck: number | null) => {
    const layout = decideBoardLayout({ leaflyPendingAck });
    const section = (s: BoardSection) =>
      s === "leafly" ? <div key={s}>LEAFLY-BOARD</div> : <div key={s}>GREENWAY-CARDS</div>;
    return renderToStaticMarkup(
      <>
        {layout.leaflyPromoted ? <div role="status">{layout.reason}</div> : null}
        {layout.sections.map(section)}
      </>,
    );
  };

  it("puts our orders first in the ordinary case, as the owner asked", () => {
    const html = board(0);
    expect(html.indexOf("GREENWAY-CARDS")).toBeLessThan(html.indexOf("LEAFLY-BOARD"));
  });

  it("promotes Leafly above them while an acknowledgement is outstanding", () => {
    const html = board(2);
    expect(html.indexOf("LEAFLY-BOARD")).toBeLessThan(html.indexOf("GREENWAY-CARDS"));
  });

  it("keeps our orders on the page even when Leafly is promoted", () => {
    expect(board(2)).toContain("GREENWAY-CARDS");
  });

  it("renders each section exactly once, in every state", () => {
    for (const n of [null, 0, 1, 7]) {
      const html = board(n);
      expect((html.match(/LEAFLY-BOARD/g) ?? []).length).toBe(1);
      expect((html.match(/GREENWAY-CARDS/g) ?? []).length).toBe(1);
    }
  });

  it("a failed count renders the ordinary layout and no banner", () => {
    const html = board(null);
    expect(html.indexOf("GREENWAY-CARDS")).toBeLessThan(html.indexOf("LEAFLY-BOARD"));
    expect(html).not.toContain('role="status"');
  });

  it("explains the promotion on screen, in words, whenever it reorders", () => {
    const html = board(1);
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("1 Leafly order is waiting to be acknowledged");
    expect(text(html)).toContain("15 minutes");
  });

  it("the explanation is grammatical for one and for many", () => {
    expect(text(board(1))).toContain("1 Leafly order is waiting");
    expect(text(board(4))).toContain("4 Leafly orders are waiting");
  });

  it("stays silent when it has not reordered anything", () => {
    // Asserts on the BANNER specifically, not on the whole render: the two
    // section markers are always present, and a test written against the full
    // text would have to be loosened later, which is how a test quietly stops
    // meaning anything.
    for (const n of [null, 0]) {
      const html = board(n);
      expect(html).not.toContain('role="status"');
      expect(text(html)).not.toMatch(/waiting to be acknowledged|15 minutes/);
    }
  });
});
