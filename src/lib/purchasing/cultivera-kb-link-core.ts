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

  console.log(`cultivera-kb-link-core: ${n} self-tests passed`);
}
