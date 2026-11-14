/**
 * tests/compliance/d244-r7-identity.test.ts - D244 round 3, slice R-7.
 *
 * Owner (verbatim): "Add more details about the product, like its category
 * and type and vendor assigned to it on the details page at the top of the
 * page with its name. Then use that to help the image recommendations and
 * drafting. If the ai knows the vendor and type/ category, it can make more
 * accurate guesses."
 *
 * Proven: the identity rows (pure), the recommender's type evidence (a cart
 * photo on a flower card ranks lower, a same-type photo higher), the
 * all-fields prompt carrying the type lines, and the wiring (detail page
 * header, recommender server, every draft caller passes the POS type).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

import { __runProductIdentityTests, productIdentityRows, identityPromptLines, FORM_MISMATCH_PENALTY } from "@/lib/enrichment/product-identity-core";
import { recommendImages, __runImageRecommendCoreTests } from "@/lib/catalog/image-recommend-core";
import { allFieldsPrompt } from "@/lib/ai/all-fields-draft";
import type { LibraryPickerAsset } from "@/lib/media/library-picker-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const A = (id: string, title: string): LibraryPickerAsset =>
  ({
    id,
    filename: `${id}.jpg`,
    title,
    alt_text: null,
    tags: null,
    usage_type: "product",
    status: "published",
    mime_type: "image/jpeg",
    license_status: null,
    created_at: "2026-10-01T00:00:00Z",
  }) as unknown as LibraryPickerAsset;

describe("D244 R-7 product-identity-core", () => {
  it("runs exactly 26 assertions, registered at that floor; image-recommend-core at 47", () => {
    expect(__runProductIdentityTests()).toEqual({ passed: 26, failed: 0 });
    expect(__runImageRecommendCoreTests()).toEqual({ passed: 47, failed: 0 });
    const st = read("scripts/compliance/run-pure-selftests.ts");
    expect(st).toContain('assertRan("product-identity-core", __runProductIdentityTests(), 26);');
    expect(st).toContain('assertRan("image-recommend-core", __runImageRecommendCoreTests(), 47);');
  });

  it("the header names category, POS type, POS category, vendor (and how it was found), brand, strain", () => {
    const rows = productIdentityRows({
      category: "cartridge",
      posInventoryType: "Concentrate for Inhalation",
      posInventoryCategory: "Live Resin Cart",
      brand: "Phat Panda",
      strainType: "indica",
      strainName: "Gelato",
      posVendorName: "Hollingsworth",
      vendorId: "v-1",
      vendorVia: "pos",
      vendorLabel: "Hollingsworth Cannabis",
    });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Category", "Cartridge · vape"],
      ["Inventory type (POS)", "Concentrate for Inhalation"],
      ["POS category", "Live Resin Cart"],
      ["Vendor", "Hollingsworth Cannabis"],
      ["Brand", "Phat Panda"],
      ["Strain", "Gelato · indica"],
    ]);
    expect(rows[3]!.hint).toBe("matched from the POS vendor name");
  });
});

describe("D244 R-7 recommender uses the type", () => {
  it("a cart photo on a flower card ranks below a flower photo of the same product", () => {
    const product = { name: "Gelato 3.5g", brand: "Phat Panda", category: "flower", form: "flower" as const, typeWords: [] };
    const v = recommendImages({ assets: [A("cart", "Phat Panda Gelato Cartridge"), A("bud", "Phat Panda Gelato Flower")], product });
    expect(v.items.map((x) => x.id)).toEqual(["bud", "cart"]);
    const cart = v.items.find((x) => x.id === "cart")!;
    const untyped = recommendImages({ assets: [A("cart", "Phat Panda Gelato Cartridge")], product: { ...product, form: null } }).items[0]!;
    expect(untyped.confidence - cart.confidence).toBe(FORM_MISMATCH_PENALTY);
    expect(cart.chips).toContain("Different type (vape)");
  });

  it("the server passes the form + POS type words and asks the semantic search about the type", () => {
    const s = read("src/lib/enrichment/image-recommend-v3-server.ts");
    expect(s).toContain("form: formOfCategory(item.category),");
    expect(s).toContain("typeWords: identityTypeWords(typeIn),");
    expect(s).toContain("category: identitySemanticCategory(typeIn) || item.category");
    expect(s).toContain("vendorId, vendorVia, otherNames };"); // R-9 adds the remove-text hint
  });
});

describe("D244 R-7 drafting uses the type", () => {
  it("the all-fields prompt carries the product type and the POS's own type words as [pos] evidence", () => {
    const user = allFieldsPrompt({
      facts: { name: "Gelato 1g Cart", brand: "Phat Panda", vendor: "Hollingsworth", category: "cartridge", inventoryType: "Concentrate for Inhalation", inventoryCategory: "Live Resin Cart" },
      photoLines: [],
      groundedBlock: "",
      groundedSources: [],
      current: {},
    });
    expect(user).toContain("[pos] Product type: Cartridge (a vape product — write for this type only)");
    expect(user).toContain("[pos] Inventory type (POS): Concentrate for Inhalation");
    expect(user).toContain("[pos] POS category: Live Resin Cart");
    expect(user).toContain("[vendor] Vendor (who we buy it from): Hollingsworth");
    expect(identityPromptLines({ category: null })).toEqual([]);
  });

  it("every all-fields caller passes the POS type (live, bulk, overnight, copilot)", () => {
    expect(read("src/lib/enrichment/ai-draft-v2-server.ts")).toContain("inventoryType: item.pos_inventory_type || null,");
    for (const f of [
      "src/app/admin/products/actions.ts",
      "src/app/admin/products/copilot/actions.ts",
      "src/lib/enrichment/bulk-ai-v2-server.ts",
      "src/lib/enrichment/enrich-batch-server.ts",
      "src/lib/enrichment/copilot-server.ts",
    ]) {
      expect(read(f), f).toMatch(/pos_inventory_type: (row!?|i)\.pos_inventory_type/);
    }
  });
});

describe("D244 R-7 detail page header", () => {
  it("renders the identity rows at the top, under the name, with a vendor link", () => {
    const s = read("src/app/admin/products/[key]/page.tsx");
    expect(s).toContain('data-testid="product-identity"');
    expect(s).toContain("productIdentityRows({");
    expect(s).toContain("href={`/admin/vendors/${identityVendorId}`}");
    expect(s.indexOf('data-testid="product-identity"')).toBeLessThan(s.indexOf('<DetailNav posKey={key} back={listBack} position="top" />'));
  });
});
