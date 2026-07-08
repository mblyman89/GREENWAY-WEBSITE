/**
 * src/lib/media/product-link-core.ts — Slice H10d (product-image → product
 * link, drafts-only).
 *
 * PURE logic that matches a harvested PRODUCT IMAGE to a kb_products row so
 * the system can SUGGEST "attach this image to this product". Nothing here
 * writes: the server action persists the suggestion as a pending
 * ai_suggestions draft, and only the owner's explicit Accept click runs the
 * existing attachKbProductImage() (H9c).
 *
 * Matching is deliberately conservative token overlap — no fuzzy magic that
 * could silently misfile an image onto the wrong SKU. Every match carries a
 * score + human-readable reasons the reviewer sees before approving.
 */

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

/** Words too generic to prove a product match on their own. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "of", "with", "by", "for",
  "mg", "thc", "cbd", "pack", "single", "new",
  "product", "products", "image", "photo", "img",
]);

/** Lowercase word tokens (kebab/space/underscore split), stop-words removed. */
export function tokenize(s: string | null | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** The kb_products fields the matcher needs (subset of KbProductRow). */
export type ProductForMatch = {
  id: string;
  brand_slug: string;
  product_slug: string;
  variant_label: string;
  display_name: string;
  category: string | null;
  status: string;
};

export type ProductMatchInput = {
  /** Cleaned product-ish name from the filename (nameFromFilename). */
  derivedName?: string | null;
  /** Vendor/brand display name from the harvested title, when known. */
  entityName?: string | null;
  /** Optional extra text (asset title without the harvest marker, tags). */
  extraText?: string | null;
};

export type ProductMatch = {
  product: ProductForMatch;
  /** 0..1 — fraction-of-product-name-covered, with a brand bonus. */
  score: number;
  reasons: string[];
};

/**
 * Score ONE candidate product against the asset's signals.
 *
 * Core signal: what fraction of the PRODUCT's name tokens appear in the
 * asset's derived text. (Direction matters: the asset filename often carries
 * extra junk; the product name is the ground truth to cover.)
 * Brand agreement adds a bonus; brand disagreement halves the score.
 */
export function scoreProductMatch(input: ProductMatchInput, product: ProductForMatch): ProductMatch {
  const reasons: string[] = [];
  const assetTokens = new Set([
    ...tokenize(input.derivedName),
    ...tokenize(input.extraText),
  ]);
  const productTokens = tokenize(`${product.display_name} ${product.product_slug} ${product.variant_label}`);
  const uniqueProductTokens = [...new Set(productTokens)];

  if (uniqueProductTokens.length === 0 || assetTokens.size === 0) {
    return { product, score: 0, reasons: ["Not enough text to compare."] };
  }

  const hits = uniqueProductTokens.filter((t) => assetTokens.has(t));
  let score = hits.length / uniqueProductTokens.length;
  if (hits.length > 0) {
    reasons.push(`Name overlap: ${hits.join(", ")} (${hits.length}/${uniqueProductTokens.length} product words).`);
  }

  // Brand agreement / disagreement.
  const entityTokens = new Set(tokenize(input.entityName));
  const brandTokens = tokenize(product.brand_slug);
  if (entityTokens.size > 0 && brandTokens.length > 0) {
    const brandHit = brandTokens.some((t) => entityTokens.has(t));
    if (brandHit) {
      score = Math.min(1, score + 0.2);
      reasons.push(`Brand matches (${product.brand_slug}).`);
    } else {
      score = score * 0.5;
      reasons.push(`Brand differs (asset: ${input.entityName}; product: ${product.brand_slug}).`);
    }
  }

  return { product, score: Number(score.toFixed(2)), reasons };
}

/** Minimum score a candidate needs before we bother the reviewer with it. */
export const MIN_LINK_SCORE = 0.5;

/**
 * Rank all candidate products; return the ones worth showing (score ≥
 * MIN_LINK_SCORE), best first, capped.
 */
export function bestProductMatches(
  input: ProductMatchInput,
  products: ProductForMatch[],
  limit = 5,
): ProductMatch[] {
  return products
    .map((p) => scoreProductMatch(input, p))
    .filter((m) => m.score >= MIN_LINK_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Suggestion payload (what lands in ai_suggestions.suggested_value)
// ---------------------------------------------------------------------------

export type ProductLinkPayload = {
  kind: "product-link";
  media_id: string;
  product_id: string;
  product_display_name: string;
  brand_slug: string;
  score: number;
  reasons: string[];
};

/** Serialize the drafts-only suggestion payload (stable field order). */
export function buildProductLinkPayload(
  mediaId: string,
  match: ProductMatch,
): string {
  const payload: ProductLinkPayload = {
    kind: "product-link",
    media_id: mediaId,
    product_id: match.product.id,
    product_display_name: match.product.display_name,
    brand_slug: match.product.brand_slug,
    score: match.score,
    reasons: match.reasons,
  };
  return JSON.stringify(payload);
}

/** Parse a stored payload defensively; null when it isn't a product link. */
export function parseProductLinkPayload(raw: string | null | undefined): ProductLinkPayload | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<ProductLinkPayload>;
    if (p?.kind !== "product-link" || !p.media_id || !p.product_id) return null;
    return {
      kind: "product-link",
      media_id: String(p.media_id),
      product_id: String(p.product_id),
      product_display_name: String(p.product_display_name ?? ""),
      brand_slug: String(p.brand_slug ?? ""),
      score: typeof p.score === "number" ? p.score : 0,
      reasons: Array.isArray(p.reasons) ? p.reasons.map(String) : [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Logo routing
// ---------------------------------------------------------------------------

export const LOGO_REVIEW_TAG = "needs-logo-review";

/** Is this usage_type one the logo validator should look at? */
export function isLogoUsage(usageType: string | null | undefined): boolean {
  const u = (usageType ?? "").toLowerCase();
  return u === "logo" || u === "vendor-logo" || u === "brand-logo";
}

/**
 * Add the logo-review routing tag (idempotent; keeps existing tags). The
 * routing tag always survives the 12-tag cap — it's the whole point.
 */
export function withLogoReviewTag(tags: string[] | null | undefined): string[] {
  const existing = [...(tags ?? [])];
  if (existing.includes(LOGO_REVIEW_TAG)) return existing.slice(0, 12);
  return [...existing.slice(0, 11), LOGO_REVIEW_TAG];
}
