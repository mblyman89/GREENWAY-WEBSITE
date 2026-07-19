/**
 * src/lib/purchasing/growflow-kb-link-core.ts
 *
 * GF-7 (image/description -> product backbone) — PURE helpers that derive a
 * product's DURABLE natural identity from a GrowFlow menu item so a saved image
 * and description can be bound to `kb_products` (migration 0071) instead of only
 * the churning menu-snapshot row.
 *
 * WHY: menu snapshots are re-fetched constantly, so `growflow_menu_items.id`
 * changes every fetch. `kb_products` is keyed on the stable natural identity
 * (brand_slug, product_slug, variant_label) — the SAME rule the crawler's
 * kb_products.py product_key() and the app's writeBackProductFacts() use. Binding
 * the image/description there means "every time we get that product in, it is
 * associated with the image we found for it," and a human's manual choice always
 * wins because the write-back is gap-fill (empty -> value, never clobber).
 *
 * This module is 100% pure (no I/O, no Date.now, no DOM): it only computes the
 * identity + display label. It is self-tested in the pure runner and mirrored in
 * a vitest test so the slug rule can never silently drift from the crawler.
 *
 * The slug rule is byte-for-byte identical to slugifyDashed() in
 * src/lib/kb/enrich-from-discovery.ts and slugify_dashed() in
 * crawler/app/kb_products.py:
 *     trim -> lowercase -> [^a-z0-9]+ => '-' -> strip leading/trailing '-'.
 */

/** The subset of a GrowFlow menu-item row this module reads. Structural so it
 *  works for both the DB row (snake_case size_label) and the normalized item. */
export type GrowflowKbLinkItemLike = {
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  /** DB row spelling. */
  size_label?: string | null;
  /** Normalized-item spelling (accepted as a fallback). */
  sizeLabel?: string | null;
  description?: string | null;
};

/** A product's durable natural identity in the KB backbone. */
export type KbProductIdentity = {
  brandSlug: string;
  productSlug: string;
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
 * Normalize a size/variant label for the KB natural key. GrowFlow sizes arrive
 * like "3.5g", "1 g", "10pk", "0.5 G". We lowercase, strip internal spaces, and
 * trim — but we do NOT slugify (the KB variant_label keeps its human spelling,
 * e.g. "3.5g" not "3-5g"). Empty/undefined -> "" (the base variant).
 */
export function normalizeVariantLabel(value: string | null | undefined): string {
  const t = String(value ?? "").trim().toLowerCase();
  if (!t) return "";
  return t.replace(/\s+/g, "");
}

/** Pick the size label from either the DB row or normalized-item spelling. */
function readSizeLabel(item: GrowflowKbLinkItemLike): string | null {
  if (typeof item.size_label === "string") return item.size_label;
  if (typeof item.sizeLabel === "string") return item.sizeLabel;
  return null;
}

/**
 * Build the display name for a brand-new kb_products row. Prefers
 * "Brand — Name Variant"; degrades gracefully when brand/variant are missing.
 * Never returns empty (falls back to "GrowFlow product").
 */
export function kbDisplayNameForItem(item: GrowflowKbLinkItemLike): string {
  const name = (item.name ?? "").trim();
  const brand = (item.brand ?? "").trim();
  const variant = normalizeVariantLabel(readSizeLabel(item));
  const namePart = [name, variant].filter(Boolean).join(" ").trim();
  const core = namePart || name;
  if (brand && core) return `${brand} — ${core}`;
  if (core) return core;
  if (brand) return brand;
  return "GrowFlow product";
}

/**
 * Derive the durable KB natural identity for a GrowFlow menu item.
 *
 * brandSlug   = slugifyDashed(brand)  || "unknown-brand"
 * productSlug = slugifyDashed(name)   || "product"
 * variantLabel= normalizeVariantLabel(size_label)   ("" = base)
 * posProductKey = NUL-join(brandSlug, productSlug, variantLabel)
 *
 * These fall back to the same sentinels writeBackProductFacts() uses, so the
 * row this produces upserts onto the exact same kb_products identity the rest
 * of the backbone already uses.
 */
export function kbIdentityForItem(item: GrowflowKbLinkItemLike): KbProductIdentity {
  const brandSlug = slugifyDashed(item.brand) || "unknown-brand";
  const productSlug = slugifyDashed(item.name) || "product";
  const variantLabel = normalizeVariantLabel(readSizeLabel(item));
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
  if (!cond) throw new Error(`growflow-kb-link-core self-test failed: ${msg}`);
}

export function __runGrowflowKbLinkCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // slugifyDashed — matches the crawler/site rule exactly.
  ok(slugifyDashed("Blue Dream") === "blue-dream", "slug spaces -> dash");
  ok(slugifyDashed("  OG Kush #18  ") === "og-kush-18", "slug trims + strips punctuation");
  ok(slugifyDashed("Avitas!!!") === "avitas", "slug strips trailing punctuation");
  ok(slugifyDashed("---Fire Bros.---") === "fire-bros", "slug strips edge dashes");
  ok(slugifyDashed("") === "", "slug empty -> empty");
  ok(slugifyDashed(null) === "", "slug null -> empty");
  ok(slugifyDashed("A_B/C") === "a-b-c", "slug collapses runs of non-alnum");

  // normalizeVariantLabel — keeps human spelling, strips inner spaces.
  ok(normalizeVariantLabel("3.5g") === "3.5g", "variant 3.5g");
  ok(normalizeVariantLabel("1 g") === "1g", "variant strips inner space");
  ok(normalizeVariantLabel("  0.5 G ") === "0.5g", "variant trims + lowercases");
  ok(normalizeVariantLabel("10pk") === "10pk", "variant pack label");
  ok(normalizeVariantLabel("") === "", "variant empty -> base");
  ok(normalizeVariantLabel(null) === "", "variant null -> base");

  // kbIdentityForItem — full identity + NUL key.
  const id = kbIdentityForItem({ name: "Blue Dream", brand: "Avitas", size_label: "1g" });
  ok(id.brandSlug === "avitas", "identity brandSlug");
  ok(id.productSlug === "blue-dream", "identity productSlug");
  ok(id.variantLabel === "1g", "identity variantLabel");
  ok(id.posProductKey === "avitas\u0000blue-dream\u00001g", "identity posProductKey NUL-joined");
  ok(id.displayName === "Avitas — Blue Dream 1g", "identity displayName");

  // Fallback sentinels match writeBackProductFacts().
  const miss = kbIdentityForItem({ name: null, brand: null, size_label: null });
  ok(miss.brandSlug === "unknown-brand", "missing brand -> unknown-brand");
  ok(miss.productSlug === "product", "missing name -> product");
  ok(miss.variantLabel === "", "missing size -> base variant");
  ok(miss.posProductKey === "unknown-brand\u0000product\u0000", "missing key sentinels");
  ok(miss.displayName === "GrowFlow product", "missing everything -> fallback display name");

  // Accepts the normalized-item spelling (sizeLabel) as a fallback.
  const camel = kbIdentityForItem({ name: "Wedding Cake", brand: "Redbird", sizeLabel: "3.5g" });
  ok(camel.variantLabel === "3.5g", "reads camelCase sizeLabel");
  ok(camel.posProductKey === "redbird\u0000wedding-cake\u00003.5g", "camel key");

  // displayName without brand / without variant.
  ok(
    kbDisplayNameForItem({ name: "Preroll", brand: null, size_label: null }) === "Preroll",
    "display name no brand no variant",
  );
  ok(
    kbDisplayNameForItem({ name: "Gummies", brand: "Wyld", size_label: "10pk" }) === "Wyld — Gummies 10pk",
    "display name brand + variant",
  );

  console.log(`growflow-kb-link-core: ${n} self-tests passed`);
}
