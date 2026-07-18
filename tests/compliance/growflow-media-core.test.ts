/**
 * tests/compliance/growflow-media-core.test.ts
 *
 * GF-6 — vitest mirror for the pure GrowFlow media/PO-banner helpers. The
 * embedded self-tests run first (same code the pure runner executes), then
 * focused specs pin the platform-branding behaviors: tags start "growflow",
 * titles/alt end "(GrowFlow)"/"product image", and the PO banner names the
 * platform. The planning machinery (planMediaSaves etc.) is covered by the
 * cultivera-media-core suite — it's structural and shared, not duplicated.
 */
import { describe, expect, it } from "vitest";
import {
  growflowMediaTags,
  growflowMediaTitleForItem,
  growflowMediaAltForItem,
  growflowMenuPrefillBanner,
  __runGrowflowMediaCoreTests,
} from "@/lib/purchasing/growflow-media-core";
import { planMediaSaves, remainingMediaCount } from "@/lib/purchasing/cultivera-media-core";

describe("growflow-media-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runGrowflowMediaCoreTests()).not.toThrow();
  });

  describe("growflowMediaTags", () => {
    it("brands image saves growflow + product-image + vendor kebab", () => {
      expect(growflowMediaTags("Fine & Dandy Farms", "image")).toEqual([
        "growflow",
        "product-image",
        "fine-dandy-farms",
      ]);
    });

    it("brands COA saves growflow + coa", () => {
      expect(growflowMediaTags("", "coa")).toEqual(["growflow", "coa"]);
    });

    it("never duplicates a vendor tag that collides with a platform tag", () => {
      expect(growflowMediaTags("growflow", "image")).toEqual(["growflow", "product-image"]);
    });
  });

  describe("growflowMediaTitleForItem", () => {
    it("includes brand and platform for images", () => {
      expect(growflowMediaTitleForItem({ name: "Blue Dream", brand: "Acme" }, "image")).toBe(
        "Blue Dream — Acme (GrowFlow)",
      );
    });

    it("marks COAs and skips the brand", () => {
      expect(growflowMediaTitleForItem({ name: "Blue Dream", brand: "Acme" }, "coa")).toBe(
        "Blue Dream COA (GrowFlow)",
      );
    });

    it("falls back for nameless items", () => {
      expect(growflowMediaTitleForItem({ name: null, brand: null }, "image")).toBe(
        "GrowFlow menu item (GrowFlow)",
      );
    });
  });

  describe("growflowMediaAltForItem", () => {
    it("mentions the vendor when known", () => {
      expect(growflowMediaAltForItem({ name: "Blue Dream", brand: null }, "Acme Farms")).toBe(
        "Blue Dream product image from Acme Farms",
      );
    });

    it("stays terse without a vendor", () => {
      expect(growflowMediaAltForItem({ name: "Blue Dream", brand: null }, "  ")).toBe(
        "Blue Dream product image",
      );
    });
  });

  describe("growflowMenuPrefillBanner", () => {
    it("names the platform, count, and vendor", () => {
      expect(growflowMenuPrefillBanner(2, "Acme Farms")).toBe(
        "Started from a GrowFlow menu: 2 items from Acme Farms pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
      );
    });

    it("handles the singular, vendorless case", () => {
      expect(growflowMenuPrefillBanner(1, null)).toBe(
        "Started from a GrowFlow menu: 1 item pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
      );
    });
  });

  describe("shared structural planner over GrowFlow-shaped rows", () => {
    const row = {
      id: "g1",
      name: "Blue Dream",
      brand: "Acme",
      image_url: "https://growflowweb.blob.core.windows.net/img/a.png",
      coa_url: null,
      media_asset_id: null,
      coa_media_asset_id: null,
    };

    it("plans Azure-blob image saves for unlinked rows", () => {
      const plan = planMediaSaves([row], 10);
      expect(plan).toEqual([
        { itemId: "g1", kind: "image", url: "https://growflowweb.blob.core.windows.net/img/a.png" },
      ]);
      expect(remainingMediaCount([row])).toBe(1);
    });

    it("skips rows already linked to an asset", () => {
      expect(planMediaSaves([{ ...row, media_asset_id: "asset" }], 10)).toEqual([]);
    });
  });
});
