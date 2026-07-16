/**
 * tests/compliance/variant-lot-core.test.ts  (Product Mastering — Slice 1)
 *
 * Vitest mirror of the variant-lot-core self-tests: pure variant →
 * inventory-lot key resolution for the sale path.
 */
import { describe, expect, it } from "vitest";
import {
  ONBOARDED_VARIANT_SUFFIX,
  lotKeyFromVariantId,
  lotKeyForSaleLine,
  lotKeysForLines,
  __runVariantLotCoreTests,
} from "@/lib/pos/variant-lot-core";

describe("variant-lot-core (Mastering Slice 1)", () => {
  it("self-tests pass", () => {
    expect(() => __runVariantLotCoreTests()).not.toThrow();
  });

  it("suffix constant matches the draft-injection scheme", () => {
    expect(ONBOARDED_VARIANT_SUFFIX).toBe("-onboarded");
  });

  it("extracts the lot key from an intake variant id", () => {
    expect(lotKeyFromVariantId("SKU-123-onboarded")).toBe("SKU-123");
    expect(lotKeyFromVariantId("  SKU-1-onboarded  ")).toBe("SKU-1");
  });

  it("never matches non-intake variant ids", () => {
    expect(lotKeyFromVariantId("pos-abc123-def456")).toBeNull();
    expect(lotKeyFromVariantId("pos-abc123-default")).toBeNull();
    expect(lotKeyFromVariantId("SKU-1-ONBOARDED")).toBeNull();
    expect(lotKeyFromVariantId("-onboarded")).toBeNull();
    expect(lotKeyFromVariantId("")).toBeNull();
    expect(lotKeyFromVariantId(null)).toBeNull();
    expect(lotKeyFromVariantId(undefined)).toBeNull();
  });

  it("strips only the trailing suffix", () => {
    expect(lotKeyFromVariantId("X-onboarded-onboarded")).toBe("X-onboarded");
  });

  it("lotKeyForSaleLine prefers the variant's key, falls back to product_id", () => {
    expect(lotKeyForSaleLine({ productId: "card", variantId: "lot-onboarded" })).toBe("lot");
    expect(lotKeyForSaleLine({ productId: "card", variantId: "pos-a-b" })).toBe("card");
    expect(lotKeyForSaleLine({ productId: "card", variantId: null })).toBe("card");
    expect(lotKeyForSaleLine({ productId: null, variantId: null })).toBeNull();
    expect(lotKeyForSaleLine({ productId: null, variantId: "k-onboarded" })).toBe("k");
  });

  it("lotKeysForLines unions product keys and variant lot keys, deduped", () => {
    const keys = lotKeysForLines([
      { productId: "A", variantId: "A-onboarded" },
      { productId: "CARD", variantId: "LOT-2-onboarded" },
      { productId: "B", variantId: "pos-x-y" },
      { productId: null, variantId: null },
      { productId: "A", variantId: null },
    ]);
    expect(keys.sort()).toEqual(["A", "B", "CARD", "LOT-2"]);
    expect(lotKeysForLines([])).toEqual([]);
  });
});
