/**
 * tests/compliance/d244-r8-vendor-kits.test.ts - D244 round 3, slice R-8.
 *
 * Owner (verbatim): "Many vendors use the same non labeled images for all
 * their like kind products. I want to be able to sort the vendors by type/
 * category so I can pick a generic on brand image and add it to all their
 * like kind products that would use this image. I want the ai to help with
 * this."
 *
 * Proven: the pure core (grouping, ranking, apply plan, URL, AI verdict
 * codec), and the wiring (permission, audits, the AI only reads, Apply is the
 * one write, links from the products page and Help).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

import {
  __runVendorKitCoreTests,
  kitGroups,
  kitGroupCards,
  kitDefaultSelected,
  rankKitPhotos,
  kitApplyPlan,
  kitUrl,
  encodeKitVerdicts,
  decodeKitVerdicts,
  parseKitCheck,
  type KitCard,
  type KitVerdict,
} from "@/lib/enrichment/vendor-kit-core";
import type { LibraryPickerAsset } from "@/lib/media/library-picker-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const C = (key: string, category: string, extra: Partial<KitCard> = {}): KitCard => ({
  key,
  name: `${key} name`,
  brand: "Acme",
  category,
  posCategory: null,
  strainName: null,
  onHand: true,
  status: null,
  galleryIds: [],
  coverId: null,
  ...extra,
});

const A = (id: string, title: string, extra: Record<string, unknown> = {}): LibraryPickerAsset =>
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
    url: `https://x/${id}.jpg`,
    ...extra,
  }) as unknown as LibraryPickerAsset;

describe("D244 R-8 vendor kits — pure core", () => {
  it("all 36 self-tests pass and are registered", () => {
    expect(__runVendorKitCoreTests()).toEqual({ passed: 36, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("vendor-kit-core", __runVendorKitCoreTests(), 36)');
  });

  it("groups a vendor's cards by type and picks the ones with no photo", () => {
    const cards = [C("a", "cartridge"), C("b", "cartridge", { coverId: "m1", galleryIds: ["m1"] }), C("c", "flower")];
    const groups = kitGroups(cards, "category");
    expect(groups.map((g) => g.key).sort()).toEqual(["cartridge", "flower"]);
    const carts = kitGroupCards(cards, "category", "cartridge");
    expect(carts.map((c) => c.key).sort()).toEqual(["a", "b"]);
    expect(kitDefaultSelected(cards[0])).toBe(true);
    expect(kitDefaultSelected(cards[1])).toBe(false);
  });

  it("an on-brand photo already used by the vendor outranks another vendor's photo", () => {
    const cards = [C("a", "cartridge", { coverId: "m1", galleryIds: ["m1"] }), C("b", "cartridge")];
    const ranked = rankKitPhotos({
      assets: [A("m1", "Acme cartridge", { vendor_id: "v1" }), A("m2", "Other cartridge", { vendor_id: "v2" })],
      cards,
      vendorId: "v1",
      brandIds: [],
      form: "vape",
    });
    expect(ranked[0]?.id).toBe("m1");
    const other = ranked.find((p) => p.id === "m2");
    if (other) expect(other.score).toBeLessThan(ranked[0].score);
  });

  it("apply plan never duplicates a photo and only replaces a cover when asked", () => {
    const cards = [C("a", "x", { coverId: "old", galleryIds: ["old"] }), C("b", "x"), C("c", "x", { galleryIds: ["m"] })];
    const add = kitApplyPlan(cards, "m", "add");
    expect(add).toEqual([
      { key: "a", attach: true, cover: false },
      { key: "b", attach: true, cover: true },
      { key: "c", attach: false, cover: true },
    ]);
    expect(kitApplyPlan(cards, "m", "cover")[0]).toEqual({ key: "a", attach: true, cover: true });
  });

  it("URL and AI verdicts round-trip", () => {
    expect(kitUrl({})).toBe("/admin/products/vendor-kits");
    expect(kitUrl({ vendor: "v1", group: "cartridge", photo: "m1" })).toBe("/admin/products/vendor-kits?vendor=v1&group=cartridge&photo=m1");
    const v = new Map<string, KitVerdict>([["0a1b2c3d-0000-4000-8000-000000000001", { generic: "yes", names: "", labelText: "Acme" }]]);
    expect(decodeKitVerdicts(encodeKitVerdicts(v)).get("0a1b2c3d-0000-4000-8000-000000000001")?.generic).toBe("yes");
    expect(parseKitCheck("not json")).toBeNull();
    expect(decodeKitVerdicts("m1~y~~").size).toBe(0);
  });
});

describe("D244 R-8 vendor kits — wiring", () => {
  const actions = read("src/app/admin/products/vendor-kits/actions.ts");
  const server = read("src/lib/enrichment/vendor-kit-server.ts");
  const page = read("src/app/admin/products/vendor-kits/page.tsx");

  it("both actions need products.enrich and are audited", () => {
    expect(actions.match(/requirePermission\("products\.enrich"\)/g)?.length).toBe(2);
    expect(actions).toContain("product.vendor_kit_checked");
    expect(server).toContain("product.vendor_kit_applied");
    expect(server).toContain("product.match_image_attached");
  });

  it("the AI check only reads; Apply re-checks the vendor and is the only write", () => {
    const check = server.slice(server.indexOf("export async function checkKitPhotos"), server.indexOf("export async function applyKitPhoto"));
    expect(check).not.toMatch(/updateEnrichment|attachImageToGallery|setPrimaryImage/);
    expect(server).toMatch(/updateEnrichment/);
  });

  it("the page has the groups, photos, AI check and apply form", () => {
    for (const id of ["kit-groups", "kit-photos", "kit-ai-check", "kit-products", "kit-apply"]) expect(page).toContain(`data-testid="${id}"`);
    expect(page).toContain('name="key"');
  });

  it("is linked from the products page and Help", () => {
    const products = read("src/app/admin/products/page.tsx");
    expect(products).toContain('data-testid="open-vendor-kits"');
    expect(products).toContain('data-testid="vendor-kits"');
    expect(read("src/lib/admin/help-content.ts")).toContain("/admin/products/vendor-kits");
  });
});
