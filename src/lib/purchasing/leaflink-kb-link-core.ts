/**
 * src/lib/purchasing/leaflink-kb-link-core.ts
 *
 * SLICE 84 (image/description -> product backbone) — PURE helpers that derive
 * a product's DURABLE natural identity from a LeafLink menu item so a saved
 * image and description can be bound to `kb_products` (migration 0071)
 * instead of only the churning menu-snapshot row.
 *
 * WHY: menu snapshots are re-fetched constantly, so `leaflink_menu_items.id`
 * changes every fetch. `kb_products` is keyed on the stable natural identity
 * (brand_slug, product_slug, variant_label) — the SAME rule the crawler's
 * kb_products.py product_key() and the app's writeBackProductFacts() use.
 *
 * The slug + variant rules are imported from growflow-kb-link-core (the
 * single source of truth in this package) so they can never silently drift
 * between platforms. This module only adds the LeafLink-flavoured display
 * name fallback ("LeafLink product" instead of "GrowFlow product").
 */

import {
  slugifyDashed,
  normalizeVariantLabel,
  type GrowflowKbLinkItemLike,
  type KbProductIdentity,
} from "./growflow-kb-link-core";

/** Structural item shape — identical columns to the GrowFlow one. */
export type LeaflinkKbLinkItemLike = GrowflowKbLinkItemLike;

/** NUL byte joiner — matches crawler product_key() and site productKey(). */
const NUL = "\u0000";

/** Pick the size label from either the DB row or normalized-item spelling. */
function readSizeLabel(item: LeaflinkKbLinkItemLike): string | null {
  if (typeof item.size_label === "string") return item.size_label;
  if (typeof item.sizeLabel === "string") return item.sizeLabel;
  return null;
}

/**
 * Build the display name for a brand-new kb_products row. Prefers
 * "Brand — Name Variant"; degrades gracefully when brand/variant are missing.
 * Never returns empty (falls back to "LeafLink product").
 */
export function leaflinkKbDisplayNameForItem(item: LeaflinkKbLinkItemLike): string {
  const name = (item.name ?? "").trim();
  const brand = (item.brand ?? "").trim();
  const variant = normalizeVariantLabel(readSizeLabel(item));
  const namePart = [name, variant].filter(Boolean).join(" ").trim();
  const core = namePart || name;
  if (brand && core) return `${brand} — ${core}`;
  if (core) return core;
  if (brand) return brand;
  return "LeafLink product";
}

/**
 * Derive the durable KB natural identity for a LeafLink menu item.
 * Same rule + same fallback sentinels as kbIdentityForItem (GrowFlow) and
 * writeBackProductFacts(), so the row upserts onto the exact same
 * kb_products identity the rest of the backbone already uses.
 */
export function leaflinkKbIdentityForItem(item: LeaflinkKbLinkItemLike): KbProductIdentity {
  const brandSlug = slugifyDashed(item.brand) || "unknown-brand";
  const productSlug = slugifyDashed(item.name) || "product";
  const variantLabel = normalizeVariantLabel(readSizeLabel(item));
  const posProductKey = [brandSlug, productSlug, variantLabel].join(NUL);
  return {
    brandSlug,
    productSlug,
    variantLabel,
    posProductKey,
    displayName: leaflinkKbDisplayNameForItem(item),
  };
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`leaflink-kb-link-core self-test failed: ${msg}`);
}

export function __runLeaflinkKbLinkCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // Full identity + NUL key — same rule as the GrowFlow/crawler slug.
  const id = leaflinkKbIdentityForItem({ name: "Deep Sleep Tincture", brand: "Fairwinds", size_label: "30 ml" });
  ok(id.brandSlug === "fairwinds", "identity brandSlug");
  ok(id.productSlug === "deep-sleep-tincture", "identity productSlug");
  ok(id.variantLabel === "30ml", "identity variantLabel strips inner space");
  ok(id.posProductKey === "fairwinds\u0000deep-sleep-tincture\u000030ml", "identity posProductKey NUL-joined");
  ok(id.displayName === "Fairwinds — Deep Sleep Tincture 30ml", "identity displayName");

  // Fallback sentinels match writeBackProductFacts().
  const miss = leaflinkKbIdentityForItem({ name: null, brand: null, size_label: null });
  ok(miss.brandSlug === "unknown-brand", "missing brand -> unknown-brand");
  ok(miss.productSlug === "product", "missing name -> product");
  ok(miss.variantLabel === "", "missing size -> base variant");
  ok(miss.posProductKey === "unknown-brand\u0000product\u0000", "missing key sentinels");
  ok(miss.displayName === "LeafLink product", "missing everything -> LeafLink fallback display name");

  // Accepts the normalized-item spelling (sizeLabel) as a fallback.
  const camel = leaflinkKbIdentityForItem({ name: "Good Tide Gummies", brand: "Wyld", sizeLabel: "10pk" });
  ok(camel.variantLabel === "10pk", "reads camelCase sizeLabel");
  ok(camel.posProductKey === "wyld\u0000good-tide-gummies\u000010pk", "camel key");

  // displayName without brand / without variant.
  ok(
    leaflinkKbDisplayNameForItem({ name: "Preroll", brand: null, size_label: null }) === "Preroll",
    "display name no brand no variant",
  );
  ok(
    leaflinkKbDisplayNameForItem({ name: null, brand: "Wyld", size_label: null }) === "Wyld",
    "display name brand only",
  );

  console.log(`leaflink-kb-link-core: ${n} self-tests passed`);
}
