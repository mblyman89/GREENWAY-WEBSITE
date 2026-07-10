/**
 * tests/compliance/draft-injection-core.test.ts
 *
 * W7 (Decision B) — pins the approved-drafts → staged-menu injection contract:
 *   - DRAFTS-ONLY: this module only PLANS rows for a *staged* version — the
 *     human still publishes; nothing goes live here;
 *   - POS IS SOURCE OF TRUTH: a key already in the export is never injected
 *     (superseded diagnostic instead);
 *   - NEVER GUESS: no POS key / unmapped category / no approved price → SKIP
 *     with a warning diagnostic, never invented data;
 *   - duplicate approved rows for one key: newest updated_at wins;
 *   - price label, potency strings, inventory thresholds mirror the POS
 *     transform's conventions.
 */
import { describe, expect, it } from "vitest";
import {
  buildDraftInjectionPlan,
  statusForOnHand,
  __runDraftInjectionCoreTests,
  type ApprovedDraftForInjection,
  type DraftEnrichment,
} from "@/lib/pos/draft-injection-core";

function draft(over: Partial<ApprovedDraftForInjection>): ApprovedDraftForInjection {
  return {
    id: "d1",
    pos_product_key: "KEY-1",
    name: "Blue Dream 1g",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    strain_name: "Blue Dream",
    thc_pct: 21.5,
    cbd_pct: 0.4,
    total_thc_pct: 24.113,
    potency_json: { thc: 21.5, thca: 2.9, mystery: 3 },
    price_minor_units: 3500,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function enrich(over: Partial<DraftEnrichment>): DraftEnrichment {
  return {
    websiteCategory: "flower",
    strainType: "hybrid",
    onHandQty: 24,
    packageLabel: "1g",
    ...over,
  };
}

function plan(
  drafts: ApprovedDraftForInjection[],
  e: Map<string, DraftEnrichment>,
  existing: string[] = [],
) {
  return buildDraftInjectionPlan({
    drafts,
    existingKeys: new Set(existing),
    enrichmentByDraftId: e,
    baseSortOrder: 100,
  });
}

describe("draft-injection-core: happy path", () => {
  it("injects an approved draft as a complete, visible menu item", () => {
    const p = plan([draft({})], new Map([["d1", enrich({})]]));
    expect(p.items).toHaveLength(1);
    const it = p.items[0];
    expect(it.source_item_id).toBe("KEY-1");
    expect(it.category).toBe("flower");
    expect(it.filter_categories).toEqual(["flower"]);
    expect(it.thc).toBe("24.11%"); // total THC preferred, rounded to 2dp
    expect(it.cbd).toBe("0.4%");
    expect(it.price_label).toBe("$35.00 1g");
    expect(it.price_minor_units).toBe(3500);
    expect(it.hidden).toBe(false);
    expect(it.sort_order).toBe(100); // appended after POS items
    expect(it.strain_type).toBe("hybrid");
  });

  it("attaches a single variant carrying the lot's package + on-hand", () => {
    const p = plan([draft({})], new Map([["d1", enrich({})]]));
    expect(p.items[0].variant).toMatchObject({
      source_variant_id: "KEY-1-onboarded",
      label: "1g",
      price_minor_units: 3500,
      inventory_level: 24,
      medical: false,
    });
  });

  it("keeps only recognized compound keys from potency_json", () => {
    const p = plan([draft({})], new Map([["d1", enrich({})]]));
    expect(p.items[0].compounds_json.map((c) => c.type).sort()).toEqual(["thc", "thca"]);
  });

  it("emits an info diagnostic naming each injected product", () => {
    const p = plan([draft({})], new Map([["d1", enrich({})]]));
    const d = p.diagnostics.find((x) => x.code === "draft_injected");
    expect(d?.severity).toBe("info");
    expect(d?.message).toContain("Blue Dream 1g");
    expect(d?.message).toContain("publish");
  });
});

describe("draft-injection-core: POS is source of truth", () => {
  it("skips keys already staged from the POS export", () => {
    const p = plan([draft({})], new Map([["d1", enrich({})]]), ["KEY-1"]);
    expect(p.items).toHaveLength(0);
    const d = p.diagnostics.find((x) => x.code === "draft_superseded_by_pos");
    expect(d?.severity).toBe("info");
  });
});

describe("draft-injection-core: never guess", () => {
  it("skips a keyless draft with a warning", () => {
    const p = plan([draft({ pos_product_key: null })], new Map([["d1", enrich({})]]));
    expect(p.items).toHaveLength(0);
    expect(p.diagnostics[0]).toMatchObject({ code: "draft_inject_no_pos_key", severity: "warning" });
  });

  it("skips an unmapped category with a warning pointing at Settings → Types", () => {
    const p = plan([draft({})], new Map([["d1", enrich({ websiteCategory: null })]]));
    expect(p.items).toHaveLength(0);
    const d = p.diagnostics.find((x) => x.code === "draft_inject_unmapped_category");
    expect(d?.severity).toBe("warning");
    expect(d?.message).toContain("Settings");
  });

  it("skips a priceless draft with a warning", () => {
    const p = plan([draft({ price_minor_units: null })], new Map([["d1", enrich({})]]));
    expect(p.items).toHaveLength(0);
    expect(p.diagnostics.some((x) => x.code === "draft_inject_no_price")).toBe(true);
  });
});

describe("draft-injection-core: dedupe & fallbacks", () => {
  it("newest approved row wins when one key has duplicates", () => {
    const p = plan(
      [
        draft({ id: "old", price_minor_units: 1000, updated_at: "2025-01-01T00:00:00Z" }),
        draft({ id: "new", price_minor_units: 2000, updated_at: "2026-01-01T00:00:00Z" }),
      ],
      new Map([
        ["old", enrich({})],
        ["new", enrich({})],
      ]),
    );
    expect(p.items).toHaveLength(1);
    expect(p.items[0].price_minor_units).toBe(2000);
  });

  it("uses honest fallbacks: unknown strain, 'each' label, in-stock default", () => {
    const p = plan(
      [draft({})],
      new Map([["d1", enrich({ strainType: null, packageLabel: null, onHandQty: null })]]),
    );
    expect(p.items[0].strain_type).toBe("unknown");
    expect(p.items[0].variant?.label).toBe("each");
    expect(p.items[0].inventory_status).toBe("in-stock");
  });

  it("mirrors transform.ts inventory thresholds", () => {
    expect(statusForOnHand(0)).toBe("unavailable");
    expect(statusForOnHand(3)).toBe("low-stock");
    expect(statusForOnHand(4)).toBe("in-stock");
  });
});

describe("draft-injection-core: embedded self-tests", () => {
  it("pass", () => {
    expect(__runDraftInjectionCoreTests().passed).toBeGreaterThan(0);
  });
});
