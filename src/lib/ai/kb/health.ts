/**
 * src/lib/ai/kb/health.ts
 *
 * Aggregate Knowledge-Base HEALTH — the golden-record signals for the command
 * center. Reads existing list helpers (no new tables) and folds them through the
 * pure scorers in quality.ts to produce dashboard-level numbers:
 *
 *   • average strain / brand completeness
 *   • counts of records that need attention (below a threshold)
 *   • draft product write-backs waiting for review (timeliness/trust signal)
 *
 * Read-only and defensive: every source list already degrades to [] before its
 * migration is applied, so this returns zeros rather than throwing.
 */
import {
  listKbStrainsFull,
  listKbBrands,
  listKbProducts,
  countKbProductDrafts,
} from "./store";
import { scoreStrain, scoreBrand, scoreProduct } from "./quality";

export type KbHealth = {
  strainCompleteness: number; // 0–100 average
  brandCompleteness: number; // 0–100 average
  productCompleteness: number; // 0–100 average (published)
  strainsNeedingAttention: number; // completeness < threshold
  brandsNeedingAttention: number;
  draftReviews: number;
  sampled: { strains: number; brands: number; products: number };
};

const ATTENTION_THRESHOLD = 65; // below this => "needs attention" (matches "good" grade floor)

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export async function getKbHealth(): Promise<KbHealth> {
  const [strains, brands, products, draftReviews] = await Promise.all([
    listKbStrainsFull(2500),
    listKbBrands(1000),
    listKbProducts("published", 2000),
    countKbProductDrafts(),
  ]);

  const strainScores = strains.map((s) => scoreStrain(s as unknown as Record<string, unknown>));
  const brandScores = brands.map((b) => scoreBrand(b as unknown as Record<string, unknown>));
  const productScores = products.map((p) => scoreProduct(p as unknown as Record<string, unknown>));

  return {
    strainCompleteness: avg(strainScores.map((s) => s.completeness)),
    brandCompleteness: avg(brandScores.map((s) => s.completeness)),
    productCompleteness: avg(productScores.map((s) => s.completeness)),
    strainsNeedingAttention: strainScores.filter((s) => s.quality < ATTENTION_THRESHOLD).length,
    brandsNeedingAttention: brandScores.filter((s) => s.quality < ATTENTION_THRESHOLD).length,
    draftReviews,
    sampled: { strains: strains.length, brands: brands.length, products: products.length },
  };
}
