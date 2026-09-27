/**
 * S03 — product-identity-core.ts: ONE identity function for writer and reader.
 * Bible slice S03 (Phase 1, Ring 0 shadow). Tests map 1:1 to the slice's
 * `tests=[...]` list, plus byte-identity pins against every existing copy of
 * the slug helpers so the "one vocabulary" claim is enforced, not asserted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runProductIdentityCoreTests,
  dashedSlug,
  identityForDraft,
  identityForLot,
  identityForMenuItem,
  identityShadowLogLine,
  kbNaturalKey,
  productIdentityKey,
  sameProductIdentity,
  strainSlug,
  summarizeIdentityShadow,
  variantLabel,
  variantLabelFromMenuLabel,
  type IdentityInput,
} from "@/lib/catalog/product-identity-core";
import { classificationMemoryKey } from "@/lib/inventory/classification-memory-core";
import { lotToWritebackFacts, type ManifestLotFacts } from "@/lib/inventory/manifest-kb-bridge-core";
import {
  kbIdentityParts,
  slugifyDashed as batchSlugifyDashed,
  strainSlugOf,
} from "@/lib/ai/kb/product-knowledge-batch-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// 20 fixtures spanning every branch of classificationMemoryKey: vendor vs
// brand fallback, brand prefix stripping, size/pack stripping, pack axis
// folding, category case, ampersands, punctuation, unknown categories.
const PARITY_FIXTURES: IdentityInput[] = [
  { vendorName: "Releaf", productName: "Releaf Suppository 6pk", category: "topical" },
  { vendorName: "Releaf", productName: "Releaf Suppository 12pk", category: "Topical" },
  { vendorName: null, brandName: "Phat Panda", productName: "Phat Panda Blue Dream 3.5g", category: "flower" },
  { vendorName: "Wyld", productName: "Wyld Huckleberry Gummies 100mg", category: "edible-solid" },
  { vendorName: "V", productName: "Jack Herer Pre-Roll 5pk", category: "preroll-pack" },
  { vendorName: "V", productName: "Jack Herer Pre-Roll 1g", category: "preroll" },
  { vendorName: "V", productName: "Infused Blunt 2pk", category: "infused-preroll-pack" },
  { vendorName: "Sweet & Sour Farms", productName: "Gelato 7g", category: "flower" },
  { vendorName: "  Avitas  ", productName: "  Avitas - Tangie Cart 1g ", category: "vape" },
  { vendorName: "Avitas", brandName: "Avitas", productName: "Avitas: Tangie Cart 0.5g", category: "vape" },
  { vendorName: "Grower Co", brandName: "Brand X", productName: "Brand X Live Resin 1 gram", category: "concentrate" },
  { vendorName: "Grower Co", productName: "RSO Syringe 1000mg", category: "rso" },
  { vendorName: "Grower Co", productName: "Tincture 30ml", category: "tincture" },
  { vendorName: "Grower Co", productName: "Lemonade 12 fl oz", category: "edible-liquid" },
  { vendorName: "Grower Co", productName: "Mystery Item", category: "Some Unmapped Category" },
  { vendorName: "Grower Co", productName: "No Category Item", category: null },
  { vendorName: "Grower Co", productName: "Kush_Mints   3.5g", category: "flower" },
  { vendorName: "A", productName: "Gummy", category: "edible-solid" },
  { vendorName: "B", productName: "Gummy", category: "edible-solid" },
  { vendorName: "Grower Co", brandName: "", productName: "Hash Rosin 1g", category: "concentrate" },
];

describe("S03 product-identity-core — key parity with classificationMemoryKey", () => {
  it("has exactly 20 parity fixtures, all with a vendor or brand", () => {
    expect(PARITY_FIXTURES).toHaveLength(20);
    for (const f of PARITY_FIXTURES) expect((f.vendorName ?? f.brandName ?? "").trim()).not.toBe("");
  });

  it.each(PARITY_FIXTURES.map((f, i) => [i, f] as const))("fixture %i equals classificationMemoryKey", (_i, f) => {
    const got = productIdentityKey(f);
    expect(got).toBe(classificationMemoryKey(f));
    expect(got).not.toBe("");
    expect(got.split("|")).toHaveLength(3);
  });

  it("key survives a new lot code (lot keys are not inputs)", () => {
    const a = identityForLot(
      { product_name: "Gelato 3.5g", unit_weight: 3.5, unit_weight_uom: "g", lot_code: "LOT-A", pos_product_key: "LOT-A" },
      { vendorName: "V", brandName: null, websiteCategory: "flower" },
    );
    const b = identityForLot(
      { product_name: "Gelato 3.5g", unit_weight: 3.5, unit_weight_uom: "g", lot_code: "LOT-B", pos_product_key: "LOT-B" },
      { vendorName: "V", brandName: null, websiteCategory: "flower" },
    );
    expect(a).toEqual(b);
    expect(a.identityKey).toBe("v|flower|gelato");
  });

  it("different vendor → different key (owner rule)", () => {
    expect(productIdentityKey(PARITY_FIXTURES[17])).not.toBe(productIdentityKey(PARITY_FIXTURES[18]));
    expect(sameProductIdentity(PARITY_FIXTURES[17], PARITY_FIXTURES[18])).toBe(false);
  });

  it("blank vendor AND blank brand → '' (refuse), including whitespace/punctuation-only", () => {
    for (const blank of [
      { productName: "Blue Dream", category: "flower" },
      { vendorName: "", brandName: "", productName: "Blue Dream", category: "flower" },
      { vendorName: "   ", brandName: null, productName: "Blue Dream", category: "flower" },
      { vendorName: "---", brandName: "!!", productName: "Blue Dream", category: "flower" },
    ]) {
      expect(productIdentityKey(blank)).toBe("");
    }
  });

  it("documents the one divergence: memory still keys vendorless products (untouched this slice)", () => {
    const input = { productName: "Blue Dream", category: "flower" };
    expect(classificationMemoryKey(input)).toBe("|flower|blue-dream");
    expect(productIdentityKey(input)).toBe("");
  });

  it("unknown never equals unknown", () => {
    expect(sameProductIdentity({ productName: "X" }, { productName: "X" })).toBe(false);
  });

  it("size and pack variants of one product share an identity; the pack axis folds", () => {
    expect(productIdentityKey(PARITY_FIXTURES[0])).toBe(productIdentityKey(PARITY_FIXTURES[1]));
    expect(productIdentityKey(PARITY_FIXTURES[4]).split("|")[1]).toBe("preroll");
    expect(productIdentityKey(PARITY_FIXTURES[6]).split("|")[1]).toBe("infused-preroll");
  });
});

describe("S03 — the three slug conventions stay distinct and byte-identical to every copy", () => {
  const SLUG_SAMPLES = ["Phat Panda", "  Blue Dream 3.5g ", "Sweet & Sour", "ÄÖÜ strain", "---x---", "", "a__b  c", "100% Pure!"];

  it("dashedSlug === product-knowledge-batch-core.slugifyDashed for every sample", () => {
    for (const s of SLUG_SAMPLES) expect(dashedSlug(s)).toBe(batchSlugifyDashed(s));
  });

  it("strainSlug matches strainSlugOf (product-lookup convention) for non-empty input", () => {
    for (const s of SLUG_SAMPLES) expect(strainSlug(s)).toBe(strainSlugOf(s) ?? "");
  });

  it("the private copies in kb/intake.ts, kb/writeback.ts, kb/store.ts still have the exact dashed body", () => {
    const body = /\.trim\(\)\s*\.toLowerCase\(\)\s*\.replace\(\/\[\^a-z0-9\]\+\/g, "-"\)\s*\.replace\(\/\^-\+\|-\+\$\/g, ""\)/;
    for (const f of ["src/lib/ai/kb/intake.ts", "src/lib/ai/kb/writeback.ts", "src/lib/ai/kb/store.ts"]) {
      expect(read(f), f).toMatch(body);
    }
    expect(read("src/lib/catalog/product-identity-core.ts")).toMatch(body);
  });

  it("every kb_strains reader still uses the SPACED slug (never 'fix' to dashed)", () => {
    const spaced = 'toLowerCase().replace(/\\s+/g, " ")';
    for (const f of [
      "src/lib/ai/kb/store.ts",
      "src/lib/ai/kb/writeback.ts",
      "src/lib/ai/kb/product-lookup.ts",
      "src/lib/inventory/catalog-drafts.ts",
      "src/lib/pos/intake-menu-staging.ts",
      "src/lib/catalog/product-identity-core.ts",
    ]) {
      expect(read(f), f).toContain(spaced);
    }
  });

  it("strain slug is spaced, product slug is dashed — for the same words", () => {
    expect(strainSlug("Blue  Dream")).toBe("blue dream");
    expect(dashedSlug("Blue  Dream")).toBe("blue-dream");
  });

  it("header documents all three conventions", () => {
    const src = read("src/lib/catalog/product-identity-core.ts");
    expect(src).toContain("PRODUCT IDENTITY KEY  `vendor|categoryAxis|family`");
    expect(src).toContain("DASHED SLUG  (kb_products.brand_slug / product_slug, kb_brands.slug)");
    expect(src).toContain("SPACED STRAIN SLUG  (kb_strains.slug)");
  });
});

describe("S03 — kbNaturalKey: writer (manifest bridge) === reader (menu item)", () => {
  const lotBase: ManifestLotFacts = {
    product_name: null,
    strain_name: null,
    category: "EndProduct",
    inventory_type: "Usable Marijuana",
    pos_product_key: "KEY-1",
    lot_code: "LOT-1",
    unit_weight: null,
    unit_weight_uom: null,
    brand_name: null,
  };
  const CASES = [
    { label: "3.5g flower", name: "Blue Dream", brand: "Phat Panda", w: 3.5, uom: "g", menu: "3.5g", want: "3.5 g" },
    { label: "1g cart", name: "Tangie Cart", brand: "Avitas", w: 1.0, uom: "g", menu: "1g", want: "1 g" },
    { label: "100mg gummies", name: "Huckleberry Gummies", brand: "Wyld", w: 100, uom: "mg", menu: "100mg", want: "100 mg" },
    { label: "blank weight", name: "Mystery Pack", brand: "Brand X", w: null, uom: null, menu: "", want: "" },
  ] as const;

  it.each(CASES)("$label", (c) => {
    // WRITER: the real bridge, then the real KB key derivation it feeds.
    const facts = lotToWritebackFacts({ ...lotBase, product_name: c.name, brand_name: c.brand, unit_weight: c.w, unit_weight_uom: c.uom });
    expect(facts).not.toBeNull();
    const writer = kbIdentityParts({ productName: facts!.productName, brandName: facts!.brandName, variantLabel: facts!.variantLabel });
    // READER: a published menu row with the transform's label.
    const reader = identityForMenuItem(
      { name: c.name, product_name: c.name, brand_name: c.brand, vendor_name: "V", category: "flower" },
      c.menu,
    ).kb;
    expect(reader).toEqual({ brand_slug: writer.brandSlug, product_slug: writer.productSlug, variant_label: writer.variantLabel });
    expect(reader?.variant_label).toBe(c.want);
    // And the lot adapter agrees with the bridge.
    expect(
      identityForLot(
        { product_name: c.name, unit_weight: c.w, unit_weight_uom: c.uom },
        { vendorName: "V", brandName: c.brand, websiteCategory: "flower" },
      ).kb,
    ).toEqual(reader);
  });

  it("missing brand → 'unknown-brand', empty product slug → 'product' (checkProductKnown defaults)", () => {
    expect(kbNaturalKey({ productName: "???" })).toEqual({ brand_slug: "unknown-brand", product_slug: "product", variant_label: "" });
    const facts = lotToWritebackFacts({ ...lotBase, product_name: "Gelato", brand_name: "  " });
    expect(facts!.brandName).toBeNull();
    expect(identityForLot({ product_name: "Gelato", unit_weight: null, unit_weight_uom: null }, { vendorName: "V", brandName: "  ", websiteCategory: "flower" }).kb?.brand_slug).toBe("unknown-brand");
  });

  it("variantLabel matches the bridge output (trailing zeros trimmed, 2 dp, '' for missing)", () => {
    expect(variantLabel(3.5, "g")).toBe("3.5 g");
    expect(variantLabel(3.456, "g")).toBe("3.46 g");
    expect(variantLabel(1.0, "g")).toBe("1 g");
    expect(variantLabel(0, "g")).toBe("");
    expect(variantLabel(Number.NaN, "g")).toBe("");
    expect(variantLabel(-1, "g")).toBe("");
  });

  it("menu labels the reader cannot map to one weight return null (never guess)", () => {
    for (const l of ["10pk", "12fl oz", "1L", "500ml", "2 each"]) expect(variantLabelFromMenuLabel(l)).toBeNull();
    expect(identityForMenuItem({ name: "N", product_name: null, brand_name: "B", vendor_name: "V", category: "edible-liquid" }, "12fl oz").kb).toBeNull();
    expect(variantLabelFromMenuLabel("each")).toBe("");
    expect(variantLabelFromMenuLabel(null)).toBe("");
  });

  it("menu-item productName follows queryFor(): product_name, else the display name", () => {
    const a = identityForMenuItem({ name: "Display", product_name: "  ", brand_name: "B", vendor_name: "V", category: "flower" }, "");
    expect(a.kb?.product_slug).toBe("display");
    const b = identityForMenuItem({ name: "Display", product_name: "Raw Name", brand_name: "B", vendor_name: "V", category: "flower" }, "");
    expect(b.kb?.product_slug).toBe("raw-name");
  });
});

describe("S03 — draft adapter", () => {
  it("category precedence: resolved website category → human shelf pick → raw", () => {
    const row = { name: "Gummy", brand_name: null, vendor_name: "V", category: "EndProduct", chosen_website_category: "edible-solid" };
    expect(identityForDraft(row).identityKey).toBe("v|edible-solid|gummy");
    expect(identityForDraft(row, { websiteCategory: "tincture" }).identityKey).toBe("v|tincture|gummy");
    expect(identityForDraft({ ...row, chosen_website_category: null }).identityKey).toBe("v|endproduct|gummy");
  });

  it("the draft adapter reproduces what listPriorClassifications feeds memory (same precedence)", () => {
    const src = read("src/lib/inventory/catalog-drafts.ts");
    expect(src).toContain("category: r.chosen_website_category ?? r.category,");
  });
});

describe("S03 — shadow ring (console only, zero queries, zero behaviour change)", () => {
  it("counts re-deliveries restock merge missed vs matched, and refusals", () => {
    const s = summarizeIdentityShadow({
      drafts: [
        { posProductKey: "NEW", identity: { vendorName: "V", productName: "Gelato 3.5g", category: "flower" } },
        { posProductKey: null, identity: { vendorName: "V", productName: "Gelato 1g", category: "flower" } },
        { posProductKey: "LIVE", identity: { vendorName: "V", productName: "Gelato 7g", category: "flower" } },
        { posProductKey: "X", identity: { productName: "Nameless vendor", category: "flower" } },
        { posProductKey: "Y", identity: { vendorName: "W", productName: "Gelato", category: "flower" } },
      ],
      approvedHistory: [{ vendorName: "v", productName: "GELATO 28g", category: "Flower" }],
      liveKeys: new Set(["LIVE"]),
    });
    expect(s).toEqual({ checked: 5, refused: 1, reDeliveredAsNew: 2, reDeliveredAndLive: 1, samples: ["v|flower|gelato"] });
    expect(identityShadowLogLine(s)).toContain("2/5 open drafts");
  });

  it("a vendorless approved row never makes a vendorless draft look like a re-delivery", () => {
    const s = summarizeIdentityShadow({
      drafts: [{ posProductKey: "N", identity: { productName: "Anon", category: "flower" } }],
      approvedHistory: [{ productName: "Anon", category: "flower" }],
      liveKeys: new Set(),
    });
    expect(s.reDeliveredAsNew).toBe(0);
    expect(s.refused).toBe(1);
  });

  it("samples are capped at 5 and de-duplicated", () => {
    const drafts = Array.from({ length: 8 }, (_, i) => ({ posProductKey: `K${i}`, identity: { vendorName: "V", productName: `P${i % 6}`, category: "flower" } }));
    const s = summarizeIdentityShadow({ drafts, approvedHistory: drafts.map((d) => d.identity), liveKeys: new Set() });
    expect(s.reDeliveredAsNew).toBe(8);
    expect(s.samples).toHaveLength(5);
    expect(new Set(s.samples).size).toBe(5);
  });

  it("silent when there is nothing to report", () => {
    expect(identityShadowLogLine({ checked: 4, refused: 0, reDeliveredAsNew: 0, reDeliveredAndLive: 4, samples: [] })).toBeNull();
    expect(identityShadowLogLine({ checked: 1, refused: 1, reDeliveredAsNew: 0, reDeliveredAndLive: 0, samples: [] })).not.toBeNull();
  });

  it("the drafts page hook is guarded, console-only, draft-tab-only, and reuses loaded data", () => {
    const src = read("src/app/admin/inventory/drafts/page.tsx");
    const start = src.indexOf("S03 SHADOW RING");
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, start + 1400);
    expect(block).toContain('if (view === "draft")');
    expect(block).toContain("try {");
    // The guard must actually CATCH: a throw in the shadow must never break
    // the approval page (a bare try/finally would still propagate).
    expect(block).toMatch(/\} catch \(err\) \{\s*console\.error\("\[identity-shadow\] summary failed \(display unaffected\):", err\);/);
    expect(src).toContain(
      'import { identityShadowLogLine, summarizeIdentityShadow } from "@/lib/catalog/product-identity-core";',
    );
    expect(block).toContain("approvedHistory: priorClassifications,");
    expect(block).toContain("liveKeys,");
    expect(block).toContain("console.info(shadowLine)");
    expect(block).not.toMatch(/\.from\(|await |fetch\(|insert\(|ai_events/);
  });

  it("the pure core imports only pure modules (no server-only, no Supabase, no fs)", () => {
    const src = read("src/lib/catalog/product-identity-core.ts");
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual([
      'import { classificationMemoryKey } from "@/lib/inventory/classification-memory-core";',
      'import { deriveVariantLabel } from "@/lib/inventory/manifest-kb-bridge-core";',
    ]);
    expect(src).not.toMatch(/server-only|supabase|node:fs/);
  });

  it("no MATCHING path has been switched onto the new key (merge/KB lookups unchanged)", () => {
    // S03 shipped the key with zero callers. S05 (stamp identity at the door)
    // is the planned first writer: catalog-drafts.ts, intake-store.ts and
    // identity-stamp-core.ts now import it to STAMP identity_key and to
    // annotate (never suppress) a restock hint. Every path that DECIDES a
    // match - restock merge, KB lookup/write-back, the bridge, the seed
    // planner's dedupe - must still not import it until its own slice.
    const matchers = ["src/lib/pos/intake-mastering-core.ts", "src/lib/ai/kb/intake.ts", "src/lib/ai/kb/writeback.ts", "src/lib/inventory/manifest-kb-bridge-core.ts", "src/lib/inventory/draft-seed-core.ts"];
    // Import statements only - a prose mention in a comment is not a caller.
    for (const f of matchers) expect(read(f), f).not.toMatch(/from\s+["'][^"']*product-identity-core["']/);
    // The S05 writers are the only new importers (pinned so a new one is deliberate).
    for (const f of ["src/lib/inventory/catalog-drafts.ts", "src/lib/inventory/intake-store.ts", "src/lib/inventory/identity-stamp-core.ts"]) {
      expect(read(f), f).toContain('from "@/lib/catalog/product-identity-core"');
    }
  });
});

describe("S03 — embedded self-tests", () => {
  it("__runProductIdentityCoreTests passes all and is registered with a floor", () => {
    const r = __runProductIdentityCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(44);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("product-identity-core", __runProductIdentityCoreTests(), 42);',
    );
  });
});
