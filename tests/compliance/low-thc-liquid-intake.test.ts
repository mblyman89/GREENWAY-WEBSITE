/**
 * SLICE 16 — THE INTAKE GUARD.
 *
 * Michael: "Every product has a lot number for traceability. So it should be
 * very easy for the system to identify these. They are well marked on the
 * invoices and would get intaken with the data needed to flag them."
 *
 * This file pins the screen where that intake decision is actually recorded,
 * and specifically the validation that stands between a reviewer's typo and a
 * real over-sale.
 *
 * THE BUG THIS GUARD EXISTS TO PREVENT
 * ------------------------------------
 * A reviewer picks up a 16 mg bottle. The label says "4 servings x 4 mg". They
 * type 4 into the per-container box and tick "yes, low-THC".
 *
 * The register now believes each bottle holds 4 mg. 200 / 4 = 50, so it will
 * cheerfully sell FIFTY bottles. Fifty bottles x 16 mg actual = 800 mg of
 * active delta-9 THC against a 200 mg statutory cap. FOUR TIMES the legal
 * limit, with a clean receipt, a green compliance dashboard, and nothing
 * anywhere in the system that noticed.
 *
 * That is a Category III violation (WAC 314-55-522) on every such basket.
 * Hence the guard, and hence these tests.
 */
import { describe, it, expect } from "vitest";

import {
  parseLowThcClassification,
  menuItemRowToFactReviewItem,
  FACT_REVIEW_CSV_HEADER,
} from "@/lib/pos/fact-review-core";
import { LOW_THC_UNIT_MAX_MG, qualifiesAsLowThcLiquid } from "@/lib/compliance/sales-limits-core";

// ───────────────────────────────────────────────────────────────────────────
// The tri-state
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 16 — the reviewer's decision is TRI-state, not a checkbox", () => {
  it("blank means LEAVE ALONE — it writes nothing at all", () => {
    const r = parseLowThcClassification("", "");
    expect(r.ok).toBe(true);
    // Not `{ lowThcLiquid: false }`. Untouched. The existing screen contract is
    // "only the fields you fill in are changed" and this must honour it.
    expect(r.ok && r.facts).toEqual({});
  });

  it("'no' is a REAL decision and is recorded as false, distinct from blank", () => {
    const r = parseLowThcClassification("no", "");
    expect(r.ok && r.facts).toEqual({ lowThcLiquid: false });
  });

  it("'no' can take a flag back off — a mis-classification must be reversible", () => {
    // If this were a checkbox, "unticked" and "didn't touch it" would be the
    // same POST and a wrong flag could never be removed from the screen.
    const r = parseLowThcClassification("no", "");
    expect(r.ok).toBe(true);
    expect(r.ok && r.facts.lowThcLiquid).toBe(false);
  });

  it("garbage in the select is refused, not silently coerced", () => {
    for (const bad of ["true", "1", "YES", "maybe", "y"]) {
      const r = parseLowThcClassification(bad, "4");
      expect(r.ok, `"${bad}" should be refused`).toBe(false);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The over-sale guard
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 16 — flagging low-THC requires a per-container figure", () => {
  it("'yes' with no milligrams is REFUSED", () => {
    const r = parseLowThcClassification("yes", "");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/ONE SEALED CONTAINER/);
  });

  it("without this guard the register would count 0 mg per can and never stop", () => {
    // Proof the guard is load-bearing rather than decorative: a flagged line
    // with no mg figure does not even qualify at the register, so it would
    // silently fall back into the 72 oz bucket while the screen claimed it was
    // classified. Two surfaces disagreeing is exactly the failure mode.
    expect(
      qualifiesAsLowThcLiquid({
        category: "edible-liquid",
        quantity: 1,
        lowThcLiquid: true,
        unitThcMg: null,
      } as never),
    ).toBe(false);
  });

  it("a valid flag round-trips into facts the store can persist", () => {
    const r = parseLowThcClassification("yes", "4");
    expect(r.ok && r.facts).toEqual({ lowThcLiquid: true, unitThcMg: 4 });
  });
});

describe("SLICE 16 — THE 16 MG BOTTLE: the exact mistake Michael described", () => {
  it("a 16 mg container is REFUSED even though its label says 4 x 4 mg servings", () => {
    const r = parseLowThcClassification("yes", "16");
    expect(r.ok).toBe(false);
    // The message has to teach, not just reject \u2014 the reviewer's instinct here
    // is reasonable and the rule is genuinely counter-intuitive.
    expect(!r.ok && r.error).toMatch(/not one serving/i);
    expect(!r.ok && r.error).toMatch(/16 mg bottle/i);
    expect(!r.ok && r.error).toMatch(/72 oz/);
  });

  it("the boundary is inclusive: exactly 4 mg qualifies, 4.001 does not", () => {
    expect(parseLowThcClassification("yes", String(LOW_THC_UNIT_MAX_MG)).ok).toBe(true);
    expect(parseLowThcClassification("yes", String(LOW_THC_UNIT_MAX_MG + 0.001)).ok).toBe(false);
  });

  it("the refusal threshold is DERIVED from the statute constant, not retyped", () => {
    const r = parseLowThcClassification("yes", "16");
    expect(!r.ok && r.error).toContain(`${LOW_THC_UNIT_MAX_MG} mg limit`);
  });

  it("zero and negative milligrams are refused", () => {
    for (const bad of ["0", "-1", "-4"]) {
      expect(parseLowThcClassification("yes", bad).ok, bad).toBe(false);
    }
  });

  it("non-numeric milligrams are refused rather than coerced to NaN or 0", () => {
    for (const bad of ["4mg", "four", "abc", "1/2"]) {
      const r = parseLowThcClassification("yes", bad);
      expect(r.ok, bad).toBe(false);
      expect(!r.ok && r.error).toMatch(/not a valid/i);
    }
  });

  it("an out-of-range figure is refused even when the reviewer did NOT tick yes", () => {
    // Entering the mg alone is legitimate (it is a useful fact regardless), and
    // it must be stored \u2014 but it must never imply qualification on its own.
    const r = parseLowThcClassification("", "16");
    expect(r.ok).toBe(true);
    expect(r.ok && r.facts).toEqual({ unitThcMg: 16 });
    expect(r.ok && "lowThcLiquid" in r.facts).toBe(false);
  });
});

describe("SLICE 16 — the screen's guard and the register's rule cannot disagree", () => {
  it("everything the screen accepts, the register also qualifies", () => {
    for (const mg of [0.5, 1, 2, 2.5, 4]) {
      const parsed = parseLowThcClassification("yes", String(mg));
      expect(parsed.ok, `${mg} should be accepted by the screen`).toBe(true);
      expect(
        qualifiesAsLowThcLiquid({
          category: "edible-liquid",
          quantity: 1,
          lowThcLiquid: true,
          unitThcMg: mg,
        } as never),
        `${mg} should qualify at the register`,
      ).toBe(true);
    }
  });

  it("everything the screen refuses, the register also refuses", () => {
    for (const mg of [4.5, 10, 16, 100]) {
      expect(parseLowThcClassification("yes", String(mg)).ok, `${mg} screen`).toBe(false);
      expect(
        qualifiesAsLowThcLiquid({
          category: "edible-liquid",
          quantity: 1,
          lowThcLiquid: true,
          unitThcMg: mg,
        } as never),
        `${mg} register`,
      ).toBe(false);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The facts survive the DB row -> screen adapter
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 16 — the classification survives the trip from the database", () => {
  const row = (over: Record<string, unknown>) =>
    ({
      id: "x",
      source_item_id: "pos-1",
      name: "Test Drink",
      product_name: null,
      brand_name: "B",
      category: "edible-liquid",
      pos_inventory_type: "Liquid Edible",
      hidden: false,
      hidden_reason: null,
      thc: null,
      cbd: null,
      servings_per_pack: null,
      mg_per_serving: null,
      package_thc_mg: null,
      package_cbd_mg: null,
      ratio_label: null,
      net_weight_grams: null,
      net_volume_ml: null,
      low_thc_liquid: null,
      unit_thc_mg: null,
      fact_provenance: null,
      ...over,
    }) as never;

  it("a flagged 4 mg can arrives at the screen as flagged", () => {
    const r = menuItemRowToFactReviewItem(row({ low_thc_liquid: true, unit_thc_mg: "4" }));
    expect(r.lowThcLiquid).toBe(true);
    // PostgREST returns `numeric` as a STRING. If this coercion were missing,
    // "4" would flow to the register and fail its `typeof === "number"` guard,
    // silently un-classifying the product.
    expect(r.unitThcMg).toBe(4);
  });

  it("NULL stays NULL — unclassified must not collapse into a reviewed 'no'", () => {
    const r = menuItemRowToFactReviewItem(row({}));
    expect(r.lowThcLiquid).toBeNull();
    expect(r.unitThcMg).toBeNull();
  });

  it("an explicit false stays false", () => {
    const r = menuItemRowToFactReviewItem(row({ low_thc_liquid: false }));
    expect(r.lowThcLiquid).toBe(false);
  });
});

describe("SLICE 16 — the reviewer's CSV export carries the classification", () => {
  it("the header names both new columns", () => {
    expect(FACT_REVIEW_CSV_HEADER).toContain("Low-THC Beverage");
    expect(FACT_REVIEW_CSV_HEADER).toContain("THC mg per container");
  });

  it("the header stays free of duplicates after the insertion", () => {
    expect(new Set(FACT_REVIEW_CSV_HEADER).size).toBe(FACT_REVIEW_CSV_HEADER.length);
  });
});
