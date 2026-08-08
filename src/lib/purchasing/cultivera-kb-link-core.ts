/**
 * src/lib/purchasing/cultivera-kb-link-core.ts
 *
 * CV-7 (product image -> KB backbone) — PURE helpers that derive a Cultivera
 * product's DURABLE natural identity from a menu-item row so a saved image can
 * be bound to `kb_products` (migration 0071) instead of only the churning
 * menu-snapshot row.
 *
 * WHY: menu snapshots are re-fetched constantly, so `cultivera_menu_items.id`
 * changes every fetch. `kb_products` is keyed on the stable natural identity
 * (brand_slug, product_slug, variant_label) — the SAME rule the crawler's
 * kb_products.py product_key() and the app's writeBackProductFacts() use.
 * Binding the image there means "every time we get that product in, it is
 * associated with the image we found for it," and a human's manual choice
 * always wins because the write-back is gap-fill (empty -> value, never clobber).
 *
 * STRAIN-LEVEL BY DESIGN: the owner wants ONE image per strain/product (the
 * product-card / product-line image), NOT one per size variant. So the KB
 * identity we bind to deliberately uses variantLabel = "" (the base/strain-level
 * product row), never the per-size label. Every size variant of the strain
 * therefore inherits the same durable image.
 *
 * This module is 100% pure (no I/O, no Date.now, no DOM): it only computes the
 * identity + display label. It is self-tested in the pure runner and mirrored in
 * a vitest test so the slug rule can never silently drift from the crawler.
 *
 * The slug rule is byte-for-byte identical to slugifyDashed() in
 * src/lib/kb/enrich-from-discovery.ts, growflow-kb-link-core.ts, and
 * slugify_dashed() in crawler/app/kb_products.py:
 *     trim -> lowercase -> [^a-z0-9]+ => '-' -> strip leading/trailing '-'.
 */

import {
  resolveMenuDescription,
} from "./menu-description-core";

/** The subset of a Cultivera menu-item row this module reads (structural, so it
 *  works for both the DB row and any normalized shape carrying these fields). */
export type CultiveraKbLinkItemLike = {
  name?: string | null;
  brand?: string | null;
  category?: string | null;
};

/** A product's durable natural identity in the KB backbone. */
export type CultiveraKbProductIdentity = {
  brandSlug: string;
  productSlug: string;
  /** Always "" — strain/product level (one image per strain, not per size). */
  variantLabel: string;
  /** NUL-joined key, byte-for-byte the crawler's product_key(). */
  posProductKey: string;
  /** Human-friendly display name for a freshly-created kb_products row. */
  displayName: string;
};

/** NUL byte joiner — matches crawler product_key() and site productKey(). */
const NUL = "\u0000";

/**
 * Canonical dashed slug. Identical rule to slugifyDashed()/slugify_dashed().
 * Empty/whitespace/undefined -> "".
 */
export function slugifyDashed(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the display name for a brand-new kb_products row. Prefers
 * "Brand — Name"; degrades gracefully when brand is missing. Never returns
 * empty (falls back to "Cultivera product"). No variant is included because
 * this identity is strain/product level.
 */
export function kbDisplayNameForItem(item: CultiveraKbLinkItemLike): string {
  const name = (item.name ?? "").trim();
  const brand = (item.brand ?? "").trim();
  if (brand && name) return `${brand} — ${name}`;
  if (name) return name;
  if (brand) return brand;
  return "Cultivera product";
}

/**
 * Derive the durable KB natural identity for a Cultivera menu item, at the
 * STRAIN/PRODUCT level.
 *
 * brandSlug    = slugifyDashed(brand)  || "unknown-brand"
 * productSlug  = slugifyDashed(name)   || "product"
 * variantLabel = ""  (base/strain-level — one image per strain, not per size)
 * posProductKey= NUL-join(brandSlug, productSlug, "")
 *
 * These fall back to the same sentinels writeBackProductFacts() uses, so the
 * row this produces upserts onto the exact same kb_products identity the rest
 * of the backbone already uses.
 */
export function kbIdentityForItem(item: CultiveraKbLinkItemLike): CultiveraKbProductIdentity {
  const brandSlug = slugifyDashed(item.brand) || "unknown-brand";
  const productSlug = slugifyDashed(item.name) || "product";
  const variantLabel = "";
  const posProductKey = [brandSlug, productSlug, variantLabel].join(NUL);
  return {
    brandSlug,
    productSlug,
    variantLabel,
    posProductKey,
    displayName: kbDisplayNameForItem(item),
  };
}

/* --------------------------------------------------------------------------
 * CV-7b — group a detail's variants into ONE saveable image per DISTINCT strain
 * ------------------------------------------------------------------------ */

/** The subset of a normalized variant the strain-grouper reads (structural). */
export type StrainVariantLike = {
  cleanName?: string | null;
  name?: string | null;
  /** The variant's OWN image (real strain photo) — preferred when present. */
  imageUrl?: string | null;
  /** The variant's OWN description (Cultivera lineage text) — preferred. */
  description?: string | null;
  position?: number | null;
};

/** One distinct strain to save: its KB identity + the single best image. */
export type StrainImageSaveItem = {
  /** Display strain name (from the first variant's cleanName / name). */
  strainName: string;
  /** KB natural identity (brand + strain, variant_label ""). */
  identity: CultiveraKbProductIdentity;
  /** The image URL to save for this strain (own image when any variant had one). */
  imageUrl: string;
  /** True when we had to fall back to the product-line/card image (no own photo). */
  imageIsFallback: boolean;
  /**
   * SLICE 85 — the description to bind to the KB row: the strain's OWN
   * lineage/description when any size has one, else the product-line
   * description as a flagged stand-in, else null.
   */
  description: string | null;
  /** True when `description` came from the product-line/category fallback. */
  descriptionIsFallback: boolean;
};

/**
 * Normalize a strain name for de-duplication (trim + lowercase + collapse
 * whitespace). Two variants with the same normalized name are the same strain.
 */
export function normalizeStrainKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Group a product-detail's variants into ONE saveable image per DISTINCT
 * strain — the owner's rule: "one image for each strain/product, not each
 * size variant." For each strain we pick the FIRST variant (menu order) that
 * has its OWN image; if NONE of that strain's variants has a photo, we fall
 * back to the product-line/card image and flag it. Strains whose only option
 * would be a null image (no own photo AND no line image) are skipped — there
 * is nothing to save. The product-line brand/name feed the KB identity.
 *
 * Deterministic: strains come back in first-seen (menu) order; a strain is
 * keyed by its normalized cleanName (falling back to the raw variant name).
 */
export function strainImagesToSave(
  variants: StrainVariantLike[],
  line: { brand?: string | null; lineImageUrl?: string | null; lineDescription?: string | null },
): StrainImageSaveItem[] {
  const lineImageUrl = (line.lineImageUrl ?? "").trim() || null;
  const order: string[] = [];
  const byKey = new Map<
    string,
    { strainName: string; ownImage: string | null; ownDescription: string | null }
  >();

  for (const v of variants) {
    const rawName = (v.cleanName ?? v.name ?? "").trim();
    const key = normalizeStrainKey(rawName) || "(unnamed strain)";
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, {
        strainName: rawName || "(unnamed strain)",
        ownImage: null,
        ownDescription: null,
      });
    }
    const entry = byKey.get(key)!;
    // First own image wins (menu order preserved by iteration order).
    if (!entry.ownImage) {
      const own = (v.imageUrl ?? "").trim();
      if (own) entry.ownImage = own;
    }
    // SLICE 85 — first own description wins, same rule as the image.
    if (!entry.ownDescription) {
      const desc = (v.description ?? "").trim();
      if (desc) entry.ownDescription = desc;
    }
  }

  const out: StrainImageSaveItem[] = [];
  for (const key of order) {
    const entry = byKey.get(key)!;
    const imageUrl = entry.ownImage ?? lineImageUrl;
    if (!imageUrl) continue; // nothing to save for this strain
    // SLICE 85 — own description first, else the product-line description as
    // a FLAGGED stand-in (mirrors the image fallback exactly).
    // PR-D2 — pass the strain name so the smart picker can prefer the
    // product-line description when the strain's own text is just its name.
    const desc = resolveMenuDescription(entry.ownDescription, line.lineDescription ?? null, entry.strainName);
    out.push({
      strainName: entry.strainName,
      identity: kbIdentityForItem({ name: entry.strainName, brand: line.brand ?? null }),
      imageUrl,
      imageIsFallback: entry.ownImage == null,
      description: desc.text,
      descriptionIsFallback: desc.isFallback,
    });
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`cultivera-kb-link-core self-test failed: ${msg}`);
}

export function __runCultiveraKbLinkCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // slugifyDashed — matches the crawler/site rule exactly.
  ok(slugifyDashed("Blue Dream") === "blue-dream", "slug spaces -> dash");
  ok(slugifyDashed("  OG Kush #18  ") === "og-kush-18", "slug trims + strips punctuation");
  ok(slugifyDashed("Crunch Berries!!!") === "crunch-berries", "slug strips trailing punctuation");
  ok(slugifyDashed("---SubX---") === "subx", "slug strips edge dashes");
  ok(slugifyDashed("") === "", "slug empty -> empty");
  ok(slugifyDashed(null) === "", "slug null -> empty");
  ok(slugifyDashed("A_B/C") === "a-b-c", "slug collapses runs of non-alnum");

  // kbIdentityForItem — strain/product level, variantLabel always "".
  const id = kbIdentityForItem({ name: "Blue Nerdz", brand: "SubX", category: "flower" });
  ok(id.brandSlug === "subx", "identity brandSlug");
  ok(id.productSlug === "blue-nerdz", "identity productSlug");
  ok(id.variantLabel === "", "identity variantLabel is strain-level (empty)");
  ok(id.posProductKey === "subx\u0000blue-nerdz\u0000", "identity posProductKey NUL-joined, empty variant");
  ok(id.displayName === "SubX — Blue Nerdz", "identity displayName");

  // Fallback sentinels match writeBackProductFacts().
  const miss = kbIdentityForItem({ name: null, brand: null });
  ok(miss.brandSlug === "unknown-brand", "missing brand -> unknown-brand");
  ok(miss.productSlug === "product", "missing name -> product");
  ok(miss.variantLabel === "", "missing everything still strain-level");
  ok(miss.posProductKey === "unknown-brand\u0000product\u0000", "missing key sentinels + empty variant");
  ok(miss.displayName === "Cultivera product", "missing everything -> fallback display name");

  // displayName without brand.
  ok(
    kbDisplayNameForItem({ name: "i95 Cookies", brand: null }) === "i95 Cookies",
    "display name no brand",
  );
  // displayName without name.
  ok(
    kbDisplayNameForItem({ name: null, brand: "SubX" }) === "SubX",
    "display name no name -> brand",
  );
  // displayName with both.
  ok(
    kbDisplayNameForItem({ name: "MAC", brand: "SubX" }) === "SubX — MAC",
    "display name brand + name",
  );

  // normalizeStrainKey
  ok(normalizeStrainKey("  Colorado   Nightshifter ") === "colorado nightshifter", "strain key normalizes");
  ok(normalizeStrainKey("Super Zulu") === "super zulu", "strain key lowercases");
  ok(normalizeStrainKey(null) === "", "strain key null -> empty");

  // strainImagesToSave — one image per distinct strain, sizes collapsed.
  const variants: StrainVariantLike[] = [
    { cleanName: "Colorado Nightshifter", imageUrl: "https://c/cn.png", description: "GMO x Nightshift", position: 0 },
    { cleanName: "Colorado Nightshifter", imageUrl: null, position: 1 }, // 3.5g, no own image
    { cleanName: "Colorado Nightshifter", imageUrl: "https://c/cn2.png", position: 2 }, // later image ignored
    { cleanName: "Super Zulu", imageUrl: null, position: 3 }, // no own image at all
    { cleanName: "Super Zulu", imageUrl: null, position: 4 },
  ];
  const saves = strainImagesToSave(variants, {
    brand: "SubX",
    lineImageUrl: "https://c/card.png",
    lineDescription: "Our signature flower line.",
  });
  ok(saves.length === 2, `two distinct strains (got ${saves.length})`);
  ok(saves[0].strainName === "Colorado Nightshifter", "first strain preserved (menu order)");
  ok(saves[0].imageUrl === "https://c/cn.png", "uses first OWN image, not later ones");
  ok(saves[0].imageIsFallback === false, "own image is not a fallback");
  ok(saves[0].identity.posProductKey === "subx\u0000colorado-nightshifter\u0000", "strain KB identity");
  ok(saves[1].strainName === "Super Zulu", "second strain");
  ok(saves[1].imageUrl === "https://c/card.png", "no own image -> falls back to card image");
  ok(saves[1].imageIsFallback === true, "fallback flagged");

  // SLICE 85 — descriptions follow the same own-first / flagged-fallback rule.
  ok(saves[0].description === "GMO x Nightshift", "own description wins");
  ok(saves[0].descriptionIsFallback === false, "own description not flagged");
  ok(saves[1].description === "Our signature flower line.", "line description stands in");
  ok(saves[1].descriptionIsFallback === true, "description stand-in flagged");

  // No line description + no own -> null, unflagged.
  const noDesc = strainImagesToSave(
    [{ cleanName: "Ghosted", imageUrl: "https://c/g.png" }],
    { brand: "SubX", lineImageUrl: null },
  );
  ok(noDesc[0].description === null && noDesc[0].descriptionIsFallback === false, "no descriptions -> null");

  // A strain with no own image AND no line image is skipped (nothing to save).
  const noneToSave = strainImagesToSave(
    [{ cleanName: "Ghost", imageUrl: null }],
    { brand: "SubX", lineImageUrl: null },
  );
  ok(noneToSave.length === 0, "strain with no image anywhere is skipped");

  // Blank strain name falls back to a sentinel key but still saves if an image exists.
  const unnamed = strainImagesToSave(
    [{ cleanName: "", name: "", imageUrl: "https://c/x.png" }],
    { brand: null, lineImageUrl: null },
  );
  ok(unnamed.length === 1 && unnamed[0].strainName === "(unnamed strain)", "unnamed strain sentinel");
  ok(unnamed[0].identity.brandSlug === "unknown-brand", "unnamed uses unknown-brand");

  console.log(`cultivera-kb-link-core: ${n} self-tests passed`);
}
