/**
 * tests/compliance/oversold-report-core.test.ts  (SLICE 15)
 *
 * The back-office "Stock needing recount" report reads a note that ANOTHER
 * module writes (`summarizeDecrement`, sale-decrement-core.ts:312). That is a
 * silent-breakage risk: if the wording of the note ever changes, the parser
 * keeps running, finds nothing, and the recount list quietly goes empty. An
 * empty list looks exactly like "no problems", which is the most dangerous
 * possible failure for a WAC 314-55-087 audit trail.
 *
 * So the important tests here do NOT parse strings typed by hand. They build a
 * real oversold plan with the real writer and parse ITS output, which means the
 * writer and the reader can never drift apart without a red test.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  __runOversoldReportCoreTests,
  OVERSOLD_MARKER,
  buildOversoldReport,
  extractOversoldSection,
  groupOversoldByProduct,
  parseOversoldSentence,
  splitOversoldSentences,
} from "@/lib/inventory/oversold-report-core";
import {
  buildLotDecrementPlan,
  buildVariantDecrementPlan,
  summarizeDecrement,
  type ItemForDecrement,
  type SaleLineForDecrement,
  type VariantForDecrement,
} from "@/lib/inventory/sale-decrement-core";

describe("embedded self-tests", () => {
  it("run clean", () => {
    expect(() => __runOversoldReportCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// THE ROUND TRIP — writer and reader must never drift apart
// ---------------------------------------------------------------------------

/**
 * Sell 3 of a product tracked at 1, and 2 of a product tracked at 0 — the
 * exact situation the register's "Sell anyway" override creates.
 */
function realOversoldNote(opts: { withTrailingMarker: boolean }): string {
  const lines: SaleLineForDecrement[] = [
    { lineId: "l1", productId: "item-blue", variantId: "var-blue", productName: "Blue Dream 1g", quantity: 3 },
    { lineId: "l2", productId: "item-gone", variantId: "var-gone", productName: "Gone 3.5g", quantity: 2 },
  ];
  const items: ItemForDecrement[] = [
    { rowId: "ir-blue", sourceItemId: "item-blue", inventoryStatus: "in-stock" },
    { rowId: "ir-gone", sourceItemId: "item-gone", inventoryStatus: "in-stock" },
  ];
  const variants: VariantForDecrement[] = [
    { rowId: "vr-blue", menuItemRowId: "ir-blue", sourceVariantId: "var-blue", label: "1g", inventoryLevel: 1 },
    { rowId: "vr-gone", menuItemRowId: "ir-gone", sourceVariantId: "var-gone", label: "3.5g", inventoryLevel: 0 },
  ];
  const variantPlan = buildVariantDecrementPlan(lines, items, variants);
  // Passing the lines with NO lots produces a LOT SHORTFALL section, which is
  // how we prove the oversold section stops where it should.
  const lotPlan = opts.withTrailingMarker ? buildLotDecrementPlan(lines, []) : buildLotDecrementPlan([], []);
  return summarizeDecrement({ variantPlan, lotPlan, lineCount: lines.length });
}

describe("round trip against the REAL note writer", () => {
  it("the writer still emits the marker this parser looks for", () => {
    expect(realOversoldNote({ withTrailingMarker: false })).toContain(OVERSOLD_MARKER);
  });

  it("both oversold products survive the trip from writer to report", () => {
    const report = buildOversoldReport([
      { orderId: "ord-1", note: realOversoldNote({ withTrailingMarker: false }) },
    ]);
    expect(report.map((r) => r.productName)).toEqual(["Blue Dream 1g", "Gone 3.5g"]);
  });

  it("the numbers the writer recorded are the numbers the report shows", () => {
    const report = buildOversoldReport([
      { orderId: "ord-1", note: realOversoldNote({ withTrailingMarker: false }) },
    ]);
    expect(report[0]).toMatchObject({ sold: 3, tracked: 1, shortfall: 2 });
    expect(report[1]).toMatchObject({ sold: 2, tracked: 0, shortfall: 2 });
  });

  it("a product name containing a period does not split into two rows", () => {
    // "Gone 3.5g" is the trap: splitting on ". " would cut it in half.
    const report = buildOversoldReport([
      { orderId: "ord-1", note: realOversoldNote({ withTrailingMarker: false }) },
    ]);
    expect(report).toHaveLength(2);
    expect(report.some((r) => r.productName === "Gone 3.5g")).toBe(true);
  });

  it("a following LOT SHORTFALL section is never mistaken for an oversold product", () => {
    const report = buildOversoldReport([
      { orderId: "ord-1", note: realOversoldNote({ withTrailingMarker: true }) },
    ]);
    expect(report).toHaveLength(2);
    expect(report.every((r) => !r.productName.includes("Product key"))).toBe(true);
    expect(report.every((r) => !r.raw.includes("no active lot"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A CLEAN SALE MUST STAY INVISIBLE
// ---------------------------------------------------------------------------

describe("clean sales never appear on the recount list", () => {
  it("a fully-stocked sale produces no oversold section at all", () => {
    const lines: SaleLineForDecrement[] = [
      { lineId: "l1", productId: "item-blue", variantId: "var-blue", productName: "Blue Dream 1g", quantity: 1 },
    ];
    const note = summarizeDecrement({
      variantPlan: buildVariantDecrementPlan(
        lines,
        [{ rowId: "ir-blue", sourceItemId: "item-blue", inventoryStatus: "in-stock" }],
        [
          {
            rowId: "vr-blue",
            menuItemRowId: "ir-blue",
            sourceVariantId: "var-blue",
            label: "1g",
            inventoryLevel: 40,
          },
        ],
      ),
      lotPlan: buildLotDecrementPlan([], []),
      lineCount: 1,
    });
    expect(note).not.toContain(OVERSOLD_MARKER);
    expect(buildOversoldReport([{ orderId: "ord-1", note }])).toHaveLength(0);
  });

  it("passing the whole decrement history is safe and returns only the exceptions", () => {
    const rows = [
      { orderId: "o1", note: "Inventory decremented for 1 line(s): 1 menu variant(s), 0 lot touch(es)." },
      { orderId: "o2", note: realOversoldNote({ withTrailingMarker: false }) },
      { orderId: "o3", note: null },
    ];
    expect(buildOversoldReport(rows)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// NOTHING MAY VANISH — an unreadable note must still surface
// ---------------------------------------------------------------------------

describe("a malformed note surfaces rather than disappearing", () => {
  it("drifted wording still produces a row, with raw text preserved", () => {
    const rows = buildOversoldReport([
      { orderId: "o1", note: 'OVERSOLD: something the parser has never seen before.' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.raw).toContain("never seen before");
  });

  it("unreadable numbers come back null instead of a wrong number", () => {
    const parsed = parseOversoldSentence('"Mystery" — sold lots, only some tracked.');
    expect(parsed.sold).toBeNull();
    expect(parsed.tracked).toBeNull();
  });

  it("a row that cannot be traced to a sale is not reported as fact", () => {
    // WAC 314-55-087(2)(b) requires tracing back to the source. A row with no
    // order id cannot be traced, so it must not sit on the list pretending to be.
    expect(buildOversoldReport([{ orderId: "", note: realOversoldNote({ withTrailingMarker: false }) }])).toHaveLength(0);
  });

  it("never throws on hostile input", () => {
    expect(() => extractOversoldSection(null)).not.toThrow();
    expect(() => extractOversoldSection(undefined)).not.toThrow();
    expect(() => splitOversoldSentences("")).not.toThrow();
    expect(() => parseOversoldSentence("")).not.toThrow();
    // @ts-expect-error — proving runtime safety against a bad database read
    expect(() => buildOversoldReport(null)).not.toThrow();
    // @ts-expect-error — proving runtime safety against a bad database read
    expect(() => groupOversoldByProduct(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// THE PERSISTENT PER-PRODUCT FLAG (owner's Fix B, option 3)
// ---------------------------------------------------------------------------

describe("per-product flag", () => {
  const note = realOversoldNote({ withTrailingMarker: false });

  it("the same product oversold in three sales is one flag, counted three times", () => {
    const flags = groupOversoldByProduct(
      buildOversoldReport([
        { orderId: "o1", note, occurredAt: "2026-09-01T10:00:00Z" },
        { orderId: "o2", note, occurredAt: "2026-09-02T10:00:00Z" },
        { orderId: "o3", note, occurredAt: "2026-09-03T10:00:00Z" },
      ]),
    );
    const blue = flags.find((f) => f.productName === "Blue Dream 1g")!;
    expect(blue.occurrences).toBe(3);
    expect(blue.totalShortfall).toBe(6);
    expect(blue.lastSeenAt).toBe("2026-09-03T10:00:00Z");
  });

  it("the worst offender sorts to the top so it gets counted first", () => {
    const flags = groupOversoldByProduct([
      { productName: "Minor", sold: 2, tracked: 1, shortfall: 1, orderId: "o1", actorLabel: null, occurredAt: null, raw: "" },
      { productName: "Major", sold: 20, tracked: 1, shortfall: 19, orderId: "o2", actorLabel: null, occurredAt: null, raw: "" },
    ]);
    expect(flags[0]!.productName).toBe("Major");
  });

  it("every flagged unit is accounted for — no shortfall is lost in grouping", () => {
    const rows = buildOversoldReport([
      { orderId: "o1", note },
      { orderId: "o2", note },
    ]);
    const rowTotal = rows.reduce((sum, r) => sum + (r.shortfall ?? 0), 0);
    const flagTotal = groupOversoldByProduct(rows).reduce((sum, f) => sum + f.totalShortfall, 0);
    expect(flagTotal).toBe(rowTotal);
  });
});

// ---------------------------------------------------------------------------
// THE AUDIT TRAIL — WAC 314-55-087(2)(a)/(b)
// ---------------------------------------------------------------------------

describe("audit attribution", () => {
  it("each row carries who, when, and which sale", () => {
    const rows = buildOversoldReport([
      {
        orderId: "ord-42",
        note: realOversoldNote({ withTrailingMarker: false }),
        actorLabel: "Michael",
        occurredAt: "2026-09-03T18:00:00Z",
      },
    ]);
    for (const r of rows) {
      expect(r.orderId).toBe("ord-42");
      expect(r.actorLabel).toBe("Michael");
      expect(r.occurredAt).toBe("2026-09-03T18:00:00Z");
    }
  });

  it("the back office never prints the server's 'system' label as a staff name", () => {
    // The decrement runs server-side and stamps actor_label "system". Printing
    // that beside a sale would read as a person and imply an attribution the
    // row does not carry, so the page filters it out and relies on the link
    // to the sale for the real trace.
    const page = readFileSync("src/app/admin/inventory/cycle-counts/page.tsx", "utf8");
    expect(page).toContain('r.actorLabel !== "system"');
    expect(page).toContain("/admin/orders/");
  });

  it("a blank operator becomes null, never an empty label pretending to be a name", () => {
    const rows = buildOversoldReport([
      { orderId: "o1", note: realOversoldNote({ withTrailingMarker: false }), actorLabel: "   " },
    ]);
    expect(rows[0]!.actorLabel).toBeNull();
  });
});
