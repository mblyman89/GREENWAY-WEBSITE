/**
 * src/lib/catalog/product-identity-core.ts  (S03 — Phase 1, Ring 0 / shadow)
 *
 * ONE identity vocabulary for writer and reader. Pure: plain data in, plain
 * data out. No fs, no network, no Supabase. Zero behaviour change: nothing in
 * the tree is switched onto this module yet except a console-only shadow
 * measurement on Product Onboarding (see summarizeIdentityShadow).
 *
 * ═══ WHY ═══
 *
 * `pos_product_key` is `sku ?? lot_code` (intake-parser.ts:414) — a LOT key,
 * and the owner intends it that way. It is not a product identity. The tree
 * nevertheless holds four different "same product?" keys (bible F-065, F-066,
 * F-078, F-085) and five private copies of the slug helpers. This file is
 * where they are named once, tested once, and later (S04+) stamped on rows.
 *
 * ═══ THE THREE CONVENTIONS — ALL DELIBERATE, NEVER NORMALISE ONE INTO ANOTHER ═══
 *
 *   1. PRODUCT IDENTITY KEY  `vendor|categoryAxis|family`
 *        e.g. "releaf|topical|suppository"
 *        = classificationMemoryKey() (classification-memory-core.ts:186),
 *        built from collapseFamilyKeyPart / familyFromName /
 *        groupingCategoryAxis (intake-mastering-core.ts). Survives a new lot
 *        code; different vendor ⇒ different key (owner rule).
 *
 *   2. DASHED SLUG  (kb_products.brand_slug / product_slug, kb_brands.slug)
 *        e.g. "phat-panda", "blue-dream-3-5g"
 *        trim → lowercase → [^a-z0-9]+ → "-" → trim dashes.
 *        Byte-identical to the private copies in ai/kb/intake.ts:24,
 *        ai/kb/writeback.ts:39, ai/kb/store.ts:1239 (slugifyName) and the
 *        exported one in ai/kb/product-knowledge-batch-core.ts:64. The
 *        composite (brand_slug, product_slug, variant_label) is UNIQUE
 *        (0071 uq_kb_products_identity): drift here silently loses rows.
 *
 *   3. SPACED STRAIN SLUG  (kb_strains.slug)
 *        e.g. "blue dream"
 *        trim → lowercase → collapse whitespace to ONE space. NOT dashed.
 *        Read by store.ts:1383, writeback.ts:48, product-lookup.ts:138,
 *        catalog-drafts.ts (strain-type recall/save) and
 *        intake-menu-staging.ts. "Fixing" it to dashed would orphan every
 *        existing strain row (bible S03 risk note, F-031/F-044/F-053).
 *
 * ═══ TRUTHFUL DEVIATIONS FROM THE S03 SPEC (documented, tested) ═══
 *
 *   • productIdentityKey takes NO strainName. Parity with
 *     classificationMemoryKey is the acceptance rule, and that key ignores
 *     the strain. (The mastering planner's private identityKey uses the
 *     strain for strain-led categories and does NOT collapse the axis — a
 *     known, separate vocabulary reconciled in S05/S09, not silently here.)
 *   • Blank vendor AND blank brand ⇒ "" (refuse). classificationMemoryKey
 *     today returns a leading-empty key ("|flower|blue-dream") for that
 *     input, which lets two vendorless products share one memory. Identity
 *     refuses instead; memory is untouched in this slice (zero behaviour
 *     change) and the divergence is pinned by a test so S09 sees it.
 *   • kbNaturalKey takes NO vendorName/category: the natural key is exactly
 *     the three 0071 columns, and the manifest bridge's rule is "only pass a
 *     brand when it is actually known — never guess vendor=brand"
 *     (manifest-kb-bridge-core.ts:143).
 *   • variantLabel keeps the bridge's EXACT output (deriveVariantLabel),
 *     unit case included, because existing kb_products rows were written
 *     with it. The reader side gets variantLabelFromMenuLabel(): the menu
 *     shows "3.5g" (transform.ts:449) while the bridge wrote "3.5 g".
 *     Known limit, not guessed around: the menu labels 28 g as "1oz", which
 *     canonicalises to "1 oz", not "28 g".
 */
import { classificationMemoryKey } from "@/lib/inventory/classification-memory-core";
import { deriveVariantLabel } from "@/lib/inventory/manifest-kb-bridge-core";
import { dashedSlug, strainSlug } from "./slug-core";

// ---------------------------------------------------------------------------
// 1. Product identity key
// ---------------------------------------------------------------------------

/** The identity fields that survive a new lot code. */
export type IdentityInput = {
  vendorName?: string | null;
  brandName?: string | null;
  productName?: string | null;
  /** OUR website category (or the axis the caller already resolved). */
  category?: string | null;
};

/**
 * `vendor|categoryAxis|family`, or "" when there is not enough identity to be
 * safe. "" is "unknown", NEVER a wildcard — callers must not match on it.
 *
 * Delegates to classificationMemoryKey so memory and identity can never
 * drift (one algorithm, not a fork); adds only the owner's refusal rule.
 */
export function productIdentityKey(input: IdentityInput): string {
  const key = classificationMemoryKey({
    vendorName: input.vendorName ?? null,
    brandName: input.brandName ?? null,
    productName: input.productName ?? null,
    category: input.category ?? null,
  });
  if (key === "") return "";
  // Leading "|" ⇔ the collapsed vendor-or-brand part is empty: refuse.
  if (key.startsWith("|")) return "";
  return key;
}

/** True when two rows are the SAME product. Unknown never equals anything. */
export function sameProductIdentity(a: IdentityInput, b: IdentityInput): boolean {
  const ka = productIdentityKey(a);
  return ka !== "" && ka === productIdentityKey(b);
}

// ---------------------------------------------------------------------------
// 2. Dashed slug + 3. spaced strain slug
// ---------------------------------------------------------------------------

// Conventions 2 and 3 live in ONE place: slug-core.ts (R24, finding F-053).
// Re-exported so every existing importer keeps working unchanged.
export { dashedSlug, strainSlug };

// ---------------------------------------------------------------------------
// KB natural key
// ---------------------------------------------------------------------------

/**
 * Canonical variant label from a per-unit weight — the manifest bridge's
 * exact output ("3.5 g", "1 g", "100 mg"), with "" instead of null so it can
 * sit in the NOT NULL DEFAULT '' column.
 */
export function variantLabel(
  unitWeight: number | null | undefined,
  uom: string | null | undefined,
): string {
  return deriveVariantLabel(unitWeight, uom) ?? "";
}

/**
 * Reader side: a published menu variant label ("3.5g", "100mg", "1 g") in
 * the writer's canonical form. "" / "each" (transform.ts:1045 blanks "each")
 * ⇒ "" (base variant). Anything else ("10pk", "12fl oz", "1L") ⇒ null:
 * we cannot say which weight the writer saw, and we do not guess.
 */
export function variantLabelFromMenuLabel(label: string | null | undefined): string | null {
  const s = String(label ?? "").trim();
  if (s === "" || s.toLowerCase() === "each") return "";
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(g|mg|oz)$/i);
  if (!m) return null;
  const label2 = variantLabel(Number(m[1]), m[2].toLowerCase());
  return label2 === "" ? null : label2;
}

export type KbNaturalKey = { brand_slug: string; product_slug: string; variant_label: string };

/**
 * The kb_products natural key (0071), exactly as checkProductKnown
 * (ai/kb/intake.ts:70-72) and writeBackProductFacts (writeback.ts:346-348)
 * derive it: missing brand ⇒ "unknown-brand", empty product slug ⇒ "product",
 * variant label trimmed (never slugified).
 */
export function kbNaturalKey(input: {
  brandName?: string | null;
  productName: string | null | undefined;
  variantLabel?: string | null;
}): KbNaturalKey {
  return {
    brand_slug: input.brandName ? dashedSlug(input.brandName) : "unknown-brand",
    product_slug: dashedSlug(input.productName) || "product",
    variant_label: (input.variantLabel ?? "").trim(),
  };
}

/** Single-string form (unit separator — cannot appear in a slug). */
export function kbNaturalKeyString(k: KbNaturalKey): string {
  return `${k.brand_slug}\u001f${k.product_slug}\u001f${k.variant_label}`;
}

// ---------------------------------------------------------------------------
// Adapters — one per row shape, so no caller hand-maps fields
// ---------------------------------------------------------------------------

/** A catalog_product_drafts row (the columns identity needs). */
export type DraftIdentityRow = {
  name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  chosen_website_category?: string | null;
};

/**
 * Draft identity. Category precedence mirrors what memory already does:
 * an explicitly resolved website category (the drafts page passes the
 * resolver's answer) → the human's shelf pick → the raw column.
 * No KB key: a draft row carries no unit weight, and "" would be a guess.
 */
export function identityForDraft(
  row: DraftIdentityRow,
  opts: { websiteCategory?: string | null } = {},
): { identityKey: string } {
  return {
    identityKey: productIdentityKey({
      vendorName: row.vendor_name,
      brandName: row.brand_name,
      productName: row.name,
      category: opts.websiteCategory ?? row.chosen_website_category ?? row.category,
    }),
  };
}

/** A menu_items row (0002 columns) plus, optionally, one variant label. */
export type MenuItemIdentityRow = {
  name: string;
  product_name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string;
};

/**
 * Menu-item identity + (when the variant label is canonicalisable) the KB
 * key the reader SHOULD query. productName follows queryFor()
 * (product-knowledge-display.ts:75): product_name, else the display name.
 */
export function identityForMenuItem(
  row: MenuItemIdentityRow,
  variant: string | null = null,
): { identityKey: string; kb: KbNaturalKey | null } {
  const productName = row.product_name?.trim() || row.name;
  const label = variantLabelFromMenuLabel(variant);
  return {
    identityKey: productIdentityKey({
      vendorName: row.vendor_name,
      brandName: row.brand_name,
      productName,
      category: row.category,
    }),
    kb: label === null ? null : kbNaturalKey({ brandName: row.brand_name || null, productName, variantLabel: label }),
  };
}

/**
 * An inventory_lots row. Lots hold vendor_id/brand_id, so the caller passes
 * the RESOLVED names, and the website category (the raw lot category is the
 * LCB/WCIA value, e.g. "EndProduct", which is not our shelf axis).
 */
export type LotIdentityRow = {
  product_name: string | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  /** Deliberately part of the type and deliberately IGNORED: lot keys churn. */
  pos_product_key?: string | null;
  lot_code?: string | null;
};

export function identityForLot(
  row: LotIdentityRow,
  names: { vendorName: string | null; brandName: string | null; websiteCategory: string | null },
): { identityKey: string; kb: KbNaturalKey | null } {
  const productName = String(row.product_name ?? "").trim();
  return {
    identityKey: productIdentityKey({
      vendorName: names.vendorName,
      brandName: names.brandName,
      productName,
      category: names.websiteCategory,
    }),
    // Same skip rule as lotToWritebackFacts: no name ⇒ no KB identity.
    kb: productName
      ? kbNaturalKey({
          brandName: String(names.brandName ?? "").trim() || null,
          productName,
          variantLabel: variantLabel(row.unit_weight, row.unit_weight_uom),
        })
      : null,
  };
}

// ---------------------------------------------------------------------------
// Shadow ring — measure before flipping any behaviour
// ---------------------------------------------------------------------------

export type IdentityShadowSummary = {
  /** Open drafts inspected. */
  checked: number;
  /** Drafts whose identity refused (""). */
  refused: number;
  /**
   * Drafts that are the SAME product as an already-approved one, yet whose
   * lot key is NOT on the live menu — i.e. restock merge (pos-key match,
   * draft-seed-core planDraftSeeding) treated a re-delivery as new. This is
   * the duplicate-card rate (F-036) the identity phase exists to drive to 0.
   */
  reDeliveredAsNew: number;
  /** Same-identity drafts whose lot key IS live (restock merge would agree). */
  reDeliveredAndLive: number;
  /** Up to 5 example identity keys for the log line (no PII: product words). */
  samples: string[];
};

/**
 * Pure summary for the console-only shadow log. Inputs are data the drafts
 * page ALREADY holds (drafts, approved history, live keys) — zero queries.
 * The "vice-versa" half (pos key live but identity differs) needs the live
 * card's identity. S04 (migration 0234) created menu_items.identity_key to
 * hold it; the half stays deferred until a later slice stamps that column,
 * because computing it here would mean reading the whole live menu.
 */
export function summarizeIdentityShadow(input: {
  drafts: Array<{ posProductKey: string | null; identity: IdentityInput }>;
  approvedHistory: IdentityInput[];
  liveKeys: Set<string>;
}): IdentityShadowSummary {
  const approved = new Set<string>();
  for (const h of input.approvedHistory) {
    const k = productIdentityKey(h);
    if (k) approved.add(k);
  }
  const out: IdentityShadowSummary = {
    checked: 0,
    refused: 0,
    reDeliveredAsNew: 0,
    reDeliveredAndLive: 0,
    samples: [],
  };
  for (const d of input.drafts) {
    out.checked += 1;
    const k = productIdentityKey(d.identity);
    if (!k) {
      out.refused += 1;
      continue;
    }
    if (!approved.has(k)) continue;
    if (d.posProductKey && input.liveKeys.has(d.posProductKey)) {
      out.reDeliveredAndLive += 1;
    } else {
      out.reDeliveredAsNew += 1;
      if (out.samples.length < 5 && !out.samples.includes(k)) out.samples.push(k);
    }
  }
  return out;
}

/** One log line, or null when there is nothing worth logging. */
export function identityShadowLogLine(s: IdentityShadowSummary): string | null {
  if (s.reDeliveredAsNew === 0 && s.refused === 0) return null;
  return (
    `[identity-shadow] ${s.reDeliveredAsNew}/${s.checked} open drafts are re-deliveries of an approved product ` +
    `with a new lot key (restock merge missed them); ${s.reDeliveredAndLive} matched live; ` +
    `${s.refused} refused (no vendor/brand or name)` +
    (s.samples.length ? `; e.g. ${s.samples.join(", ")}` : "")
  );
}

// ---------------------------------------------------------------------------
// Embedded self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runProductIdentityCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const eq = (name: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
    else {
      failed += 1;
      console.error(`product-identity-core FAIL ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
    }
  };

  // identity key
  eq("basic", productIdentityKey({ vendorName: "Releaf", productName: "Releaf Suppository 6pk", category: "topical" }), "releaf|topical|suppository");
  eq("pack size folds", productIdentityKey({ vendorName: "Releaf", productName: "Releaf Suppository 12pk", category: "Topical" }), "releaf|topical|suppository");
  eq("brand fallback", productIdentityKey({ brandName: "Phat Panda", productName: "Phat Panda Blue Dream 3.5g", category: "flower" }), "phat-panda|flower|blue-dream");
  eq("blank vendor+brand refuses", productIdentityKey({ vendorName: "", brandName: "  ", productName: "Blue Dream", category: "flower" }), "");
  eq("punctuation-only vendor refuses", productIdentityKey({ vendorName: "!!!", productName: "Blue Dream", category: "flower" }), "");
  eq("blank name refuses", productIdentityKey({ vendorName: "V", productName: "  ", category: "flower" }), "");
  eq("pack axis folds", productIdentityKey({ vendorName: "V", productName: "Jack 5pk", category: "preroll-pack" }).split("|")[1], "preroll");
  eq("different vendor differs", productIdentityKey({ vendorName: "A", productName: "Gummy", category: "edible" }) === productIdentityKey({ vendorName: "B", productName: "Gummy", category: "edible" }), false);
  eq("same() on unknown is false", sameProductIdentity({ productName: "X" }, { productName: "X" }), false);
  eq("same() true", sameProductIdentity({ vendorName: "V", productName: "Gelato 3.5g", category: "flower" }, { vendorName: "v", productName: "Gelato 7g", category: "Flower" }), true);
  eq("parity with memory", productIdentityKey({ vendorName: "Wyld", productName: "Wyld Huckleberry 100mg", category: "edible" }), classificationMemoryKey({ vendorName: "Wyld", productName: "Wyld Huckleberry 100mg", category: "edible" }));
  eq("documented divergence: memory keeps leading-empty key", classificationMemoryKey({ productName: "Blue Dream", category: "flower" }), "|flower|blue-dream");

  // slugs
  eq("dashed", dashedSlug("  Phat Panda! "), "phat-panda");
  eq("dashed dot", dashedSlug("Blue Dream 3.5g"), "blue-dream-3-5g");
  eq("dashed empty", dashedSlug(null), "");
  eq("strain spaced", strainSlug("  Golden   Pineapple "), "golden pineapple");
  eq("strain NOT dashed", strainSlug("Blue Dream").includes("-"), false);
  eq("strain null", strainSlug(undefined), "");

  // variant labels
  eq("3.5 g", variantLabel(3.5, "g"), "3.5 g");
  eq("1.0 -> 1 g", variantLabel(1.0, "g"), "1 g");
  eq("100 mg", variantLabel(100, "mg"), "100 mg");
  eq("blank weight", variantLabel(null, "g"), "");
  eq("zero weight", variantLabel(0, "g"), "");
  eq("no uom", variantLabel(7, null), "7");
  eq("menu 3.5g", variantLabelFromMenuLabel("3.5g"), "3.5 g");
  eq("menu 100MG", variantLabelFromMenuLabel("100MG"), "100 mg");
  eq("menu blank", variantLabelFromMenuLabel(""), "");
  eq("menu each", variantLabelFromMenuLabel("each"), "");
  eq("menu pack refuses", variantLabelFromMenuLabel("10pk"), null);
  eq("menu fl oz refuses", variantLabelFromMenuLabel("12fl oz"), null);
  eq("menu 1oz honest", variantLabelFromMenuLabel("1oz"), "1 oz");

  // kb key
  eq("kb defaults", kbNaturalKey({ productName: "" }), { brand_slug: "unknown-brand", product_slug: "product", variant_label: "" });
  eq("kb basic", kbNaturalKey({ brandName: "Phat Panda", productName: "Blue Dream", variantLabel: " 3.5 g " }), { brand_slug: "phat-panda", product_slug: "blue-dream", variant_label: "3.5 g" });
  eq("kb string", kbNaturalKeyString({ brand_slug: "a", product_slug: "b", variant_label: "" }), "a\u001fb\u001f");

  // writer == reader
  const lot = identityForLot({ product_name: "Blue Dream", unit_weight: 3.5, unit_weight_uom: "g", lot_code: "L1" }, { vendorName: "V", brandName: "Phat Panda", websiteCategory: "flower" });
  const item = identityForMenuItem({ name: "Blue Dream", product_name: "Blue Dream", brand_name: "Phat Panda", vendor_name: "V", category: "flower" }, "3.5g");
  eq("writer kb == reader kb", lot.kb, item.kb);
  eq("writer id == reader id", lot.identityKey, item.identityKey);
  const lot2 = identityForLot({ product_name: "Blue Dream", unit_weight: 3.5, unit_weight_uom: "g", lot_code: "L2", pos_product_key: "K2" }, { vendorName: "V", brandName: "Phat Panda", websiteCategory: "flower" });
  eq("survives new lot code", lot2, lot);
  eq("lot no name => no kb", identityForLot({ product_name: " ", unit_weight: 1, unit_weight_uom: "g" }, { vendorName: "V", brandName: null, websiteCategory: "vape" }).kb, null);
  eq("draft precedence", identityForDraft({ name: "Gummy", brand_name: null, vendor_name: "V", category: "EndProduct", chosen_website_category: "edible" }).identityKey, "v|edible|gummy");
  eq("draft resolved wins", identityForDraft({ name: "Gummy", brand_name: null, vendor_name: "V", category: "x", chosen_website_category: "y" }, { websiteCategory: "edible" }).identityKey, "v|edible|gummy");

  // shadow
  const s = summarizeIdentityShadow({
    drafts: [
      { posProductKey: "NEW1", identity: { vendorName: "V", productName: "Gelato 3.5g", category: "flower" } },
      { posProductKey: "LIVE1", identity: { vendorName: "V", productName: "Gelato 7g", category: "flower" } },
      { posProductKey: "NEW2", identity: { vendorName: "", productName: "Anon", category: "flower" } },
      { posProductKey: "NEW3", identity: { vendorName: "V", productName: "Brand New", category: "flower" } },
    ],
    approvedHistory: [{ vendorName: "V", productName: "Gelato 1g", category: "flower" }, { productName: "Anon", category: "flower" }],
    liveKeys: new Set(["LIVE1"]),
  });
  eq("shadow counts", [s.checked, s.refused, s.reDeliveredAsNew, s.reDeliveredAndLive], [4, 1, 1, 1]);
  eq("shadow samples", s.samples, ["v|flower|gelato"]);
  eq("shadow quiet when nothing", identityShadowLogLine({ checked: 3, refused: 0, reDeliveredAsNew: 0, reDeliveredAndLive: 2, samples: [] }), null);
  eq("shadow line mentions count", identityShadowLogLine(s)?.startsWith("[identity-shadow] 1/4"), true);

  return { passed, failed };
}
