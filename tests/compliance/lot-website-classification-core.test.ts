/**
 * tests/compliance/lot-website-classification-core.test.ts
 *
 * Inventory Detail "corrections" — per-product website Type/Category override
 * (Option A). The stakes: this gatekeeper must NEVER touch the CCRS/LCB
 * columns and must refuse anything not in the LIVE website_category_types /
 * inventory_types registries. It mirrors the onboarding approval card's
 * contract: pick an existing value, create a new one on the fly (which the
 * server persists to the same Types & Categories tables), keep the current
 * override, or clear it back to auto-resolution. These tests pin the parse
 * whitelist, the create-on-the-fly refusals, and the plain-English audit.
 */
import { describe, it, expect } from "vitest";
import {
  __runLotWebsiteClassificationCoreTests,
  parseClassificationEdit,
  resolveOverrideValue,
  buildClassificationAuditSummary,
  NEW_CATEGORY_SENTINEL,
  NEW_TYPE_SENTINEL,
  KEEP_SENTINEL,
  CLEAR_SENTINEL,
} from "@/lib/inventory/lot-website-classification-core";

const VOCAB = {
  validCategoryValues: ["concentrate", "flower", "edible-solid"] as const,
  validTypeLabels: ["Live Resin", "Gummies", "Popcorn Bud"] as const,
};

describe("lot-website-classification-core", () => {
  it("embedded self-tests pass", () => {
    const { passed } = __runLotWebsiteClassificationCoreTests();
    expect(passed).toBeGreaterThanOrEqual(15);
  });

  it("blank or __keep__ leaves each override untouched", () => {
    const r = parseClassificationEdit(
      { website_category: "", house_type: KEEP_SENTINEL },
      VOCAB,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.category.kind).toBe("keep");
      expect(r.type.kind).toBe("keep");
    }
  });

  it("__clear__ removes an override, an existing value sets it", () => {
    const r = parseClassificationEdit(
      { website_category: CLEAR_SENTINEL, house_type: "Live Resin" },
      VOCAB,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.category.kind).toBe("clear");
      expect(r.type).toEqual({ kind: "set", value: "Live Resin" });
    }
  });

  it("refuses a value that is not in the live registry", () => {
    expect(parseClassificationEdit({ website_category: "not-a-real-category" }, VOCAB).ok).toBe(false);
    expect(parseClassificationEdit({ house_type: "Moon Rocks" }, VOCAB).ok).toBe(false);
  });

  it("create-on-the-fly trims the new label for both fields", () => {
    const cat = parseClassificationEdit(
      { website_category: NEW_CATEGORY_SENTINEL, new_category_label: "  Dabs  " },
      VOCAB,
    );
    expect(cat.ok).toBe(true);
    if (cat.ok) expect(cat.category).toEqual({ kind: "create", newLabel: "Dabs" });

    const type = parseClassificationEdit(
      { house_type: NEW_TYPE_SENTINEL, new_type_label: " Diamonds " },
      VOCAB,
    );
    expect(type.ok).toBe(true);
    if (type.ok) expect(type.type).toEqual({ kind: "create", newLabel: "Diamonds" });
  });

  it("create-on-the-fly with no name, or an over-long name, is refused", () => {
    expect(
      parseClassificationEdit({ website_category: NEW_CATEGORY_SENTINEL, new_category_label: "" }, VOCAB).ok,
    ).toBe(false);
    expect(
      parseClassificationEdit({ house_type: NEW_TYPE_SENTINEL, new_type_label: "" }, VOCAB).ok,
    ).toBe(false);
    expect(
      parseClassificationEdit(
        { website_category: NEW_CATEGORY_SENTINEL, new_category_label: "x".repeat(61) },
        VOCAB,
      ).ok,
    ).toBe(false);
    expect(
      parseClassificationEdit(
        { website_category: NEW_CATEGORY_SENTINEL, new_category_label: "x".repeat(60) },
        VOCAB,
      ).ok,
    ).toBe(true);
  });

  it("resolveOverrideValue applies decisions against the stored value", () => {
    expect(resolveOverrideValue({ kind: "keep" }, "flower", null)).toBe("flower");
    expect(resolveOverrideValue({ kind: "keep" }, null, null)).toBeNull();
    expect(resolveOverrideValue({ kind: "clear" }, "flower", null)).toBeNull();
    expect(resolveOverrideValue({ kind: "set", value: "concentrate" }, "flower", null)).toBe("concentrate");
    expect(resolveOverrideValue({ kind: "create", newLabel: "Dabs" }, null, "dabs")).toBe("dabs");
  });

  it("audit summary lists only changed rows and uses (auto) for null", () => {
    expect(
      buildClassificationAuditSummary(
        { category: null, type: "Gummies" },
        { category: "concentrate", type: "Gummies" },
      ),
    ).toEqual(["Website category: (auto) \u2192 concentrate"]);

    expect(
      buildClassificationAuditSummary(
        { category: "flower", type: "Popcorn Bud" },
        { category: "flower", type: "Popcorn Bud" },
      ),
    ).toEqual([]);

    expect(
      buildClassificationAuditSummary(
        { category: "flower", type: "Live Resin" },
        { category: null, type: "Gummies" },
      ),
    ).toEqual([
      "Website category: flower \u2192 (auto)",
      "Product type: Live Resin \u2192 Gummies",
    ]);
  });
});
