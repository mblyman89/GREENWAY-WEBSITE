/**
 * src/lib/ai/kb/quality.ts
 *
 * Golden-record HEALTH scoring for Knowledge Base entities.
 *
 * Grounded in MDM golden-record theory (Profisee): a trustworthy record is
 * measured on Completeness, Accuracy, Uniqueness, Timeliness, and Trustworthiness.
 * Here we compute the two an admin can act on directly, per entity:
 *
 *   • completeness — % of the ESSENTIAL fields that are present. Tells a steward
 *     exactly what is still missing and drives the "needs attention" queue.
 *   • quality      — a 0–100 trust score blending completeness with provenance
 *     signals (has sources? has a confidence value?) so a fully-filled record
 *     that nobody has sourced still reads as "needs verification".
 *
 * These are PURE functions with NO I/O — unit-testable, and safe to call from
 * server components. Nothing here writes; it only reads shapes already loaded.
 *
 * Standing rules honored: never guess (fields verified against store.ts row
 * types), drafts-only (scoring is read-only), and cannabis-compliant (we score
 * only sensory/factual fields — there is no effect/health field to score).
 */

export type QualityGrade = "excellent" | "good" | "fair" | "poor";

export type QualityScore = {
  /** 0–100: share of essential fields present. */
  completeness: number;
  /** 0–100: completeness tempered by provenance (sources + confidence). */
  quality: number;
  /** Human label for the quality score. */
  grade: QualityGrade;
  /** Essential field keys that are still empty (what to fix next). */
  missing: string[];
  /** Total essential fields considered. */
  essentialCount: number;
};

/** A field is "present" if it's a non-empty string or a non-empty array. */
function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return Boolean(value);
}

function grade(quality: number): QualityGrade {
  if (quality >= 85) return "excellent";
  if (quality >= 65) return "good";
  if (quality >= 40) return "fair";
  return "poor";
}

/**
 * Core scorer: given a record, the ESSENTIAL field keys, and optional provenance
 * signals, compute completeness + a provenance-tempered quality score.
 *
 * Weighting (fixed, documented so the score is explainable, not a black box):
 *   quality = 0.80 * completeness + 0.20 * provenance
 * where provenance = mean(hasSources, hasConfidence) when those signals apply.
 * When an entity type has no provenance concept, quality == completeness.
 */
export function scoreRecord(
  record: Record<string, unknown>,
  essentialKeys: string[],
  opts?: { sourcesKey?: string; confidenceKey?: string },
): QualityScore {
  const missing: string[] = [];
  for (const key of essentialKeys) {
    if (!present(record[key])) missing.push(key);
  }
  const filled = essentialKeys.length - missing.length;
  const completeness =
    essentialKeys.length === 0 ? 100 : Math.round((filled / essentialKeys.length) * 100);

  const provenanceSignals: number[] = [];
  if (opts?.sourcesKey) provenanceSignals.push(present(record[opts.sourcesKey]) ? 100 : 0);
  if (opts?.confidenceKey) provenanceSignals.push(present(record[opts.confidenceKey]) ? 100 : 0);

  let quality: number;
  if (provenanceSignals.length === 0) {
    quality = completeness;
  } else {
    const provenance = Math.round(
      provenanceSignals.reduce((a, b) => a + b, 0) / provenanceSignals.length,
    );
    quality = Math.round(0.8 * completeness + 0.2 * provenance);
  }

  return { completeness, quality, grade: grade(quality), missing, essentialCount: essentialKeys.length };
}

// ---------------------------------------------------------------------------
// Entity-specific essential-field definitions.
// These reflect the MINIMUM a golden record needs to be genuinely useful to the
// AI copywriter — verified against the KbStrainFull / KbBrandRow / KbProductRow
// shapes in store.ts. Kept deliberately small so "complete" is achievable.
// ---------------------------------------------------------------------------

export const STRAIN_ESSENTIALS = [
  "strain_type",
  "lineage",
  "aroma_notes",
  "flavor_notes",
  "terpenes",
  "summary",
] as const;

export const BRAND_ESSENTIALS = ["known_for", "house_style", "sensory_notes"] as const;

export const PRODUCT_ESSENTIALS = [
  "category",
  "aroma_notes",
  "flavor_notes",
  "description",
] as const;

export const PRODUCT_CATEGORY_ESSENTIALS = ["group_key", "summary"] as const;

/** Score a strain row (KbStrainFull-shaped). */
export function scoreStrain(row: Record<string, unknown>): QualityScore {
  return scoreRecord(row, [...STRAIN_ESSENTIALS], {
    sourcesKey: "sources",
    confidenceKey: "confidence",
  });
}

/** Score a brand row (KbBrandRow-shaped). Brands carry no provenance columns. */
export function scoreBrand(row: Record<string, unknown>): QualityScore {
  return scoreRecord(row, [...BRAND_ESSENTIALS]);
}

/** Score a per-SKU product row (KbProductRow-shaped). */
export function scoreProduct(row: Record<string, unknown>): QualityScore {
  return scoreRecord(row, [...PRODUCT_ESSENTIALS], {
    sourcesKey: "sources",
    confidenceKey: "confidence",
  });
}

/** Score a product-category row (KbProductCategoryRow-shaped). */
export function scoreProductCategory(row: Record<string, unknown>): QualityScore {
  return scoreRecord(row, [...PRODUCT_CATEGORY_ESSENTIALS]);
}

/** Human-readable label for a missing field key (for UI hints). */
export function labelForField(key: string): string {
  const map: Record<string, string> = {
    strain_type: "type (indica/sativa/hybrid)",
    lineage: "lineage",
    aroma_notes: "aroma notes",
    flavor_notes: "flavor notes",
    terpenes: "terpenes",
    summary: "summary",
    known_for: "known for",
    house_style: "house style / voice",
    sensory_notes: "sensory notes",
    signature_lines: "signature product lines",
    category: "category",
    description: "description",
    group_key: "group",
  };
  return map[key] ?? key.replace(/_/g, " ");
}
