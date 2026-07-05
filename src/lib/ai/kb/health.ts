/**
 * src/lib/ai/kb/health.ts
 *
 * Aggregate Knowledge-Base HEALTH — the golden-record signals for the command
 * center. Folds source lists through the pure scorers in quality.ts to produce
 * dashboard-level numbers:
 *
 *   • average strain / brand / product / vendor completeness
 *   • the TRUE total record count per domain (exact count, not the sampled page)
 *   • counts of records that need attention (below a threshold)
 *   • draft product write-backs waiting for review (timeliness/trust signal)
 *
 * 8b fixes (verified):
 *   - Strain completeness previously showed "1000 strains" because PostgREST caps
 *     a single select at 1000 rows and the strip displayed the SAMPLE size. We now
 *     read an EXACT count separately (getKbCounts / countBrands / countVendors) and
 *     display that as the denominator, while completeness is averaged over a large
 *     sample. The two numbers are now labelled honestly.
 *   - Brand completeness read the now-empty kb_brands table (brand facts folded
 *     into operational `brands` in migration 0072). We now score operational
 *     brands, so the number reflects reality.
 *   - Added VENDOR completeness (operational vendors), per owner request.
 *
 * Read-only and defensive: every source degrades to []/0 before its migration is
 * applied, so this returns zeros rather than throwing.
 */
import { listKbStrainsFull, listKbProducts, countKbProductDrafts, getKbCounts } from "./store";
import { listBrandsWithFacts, listVendors, countBrands, countVendors } from "@/lib/vendors/store";
import { scoreStrain, scoreBrand, scoreProduct, scoreVendor } from "./quality";
import { SEED_CANNABINOIDS, SEED_EFFECTS, SEED_PRODUCT_FORMATS, SEED_COMPLIANCE_RULES, SEED_STORE_FACTS, SEED_FAQS } from "./seed";

export type KbHealth = {
  strainCompleteness: number; // 0–100 average
  brandCompleteness: number; // 0–100 average
  productCompleteness: number; // 0–100 average (published)
  vendorCompleteness: number; // 0–100 average
  strainsNeedingAttention: number; // completeness < threshold (within the sample)
  brandsNeedingAttention: number;
  vendorsNeedingAttention: number;
  draftReviews: number;
  /**
   * Cannabinoid compound coverage (migration 0083): how many compounds are in
   * the KB vs. the expected reference set. `expected` = the in-code seed set.
   */
  cannabinoidCoverage: { present: number; expected: number };
  /**
   * Experiential-effect vocabulary coverage (migration 0086): how many effects
   * are in the KB vs. the expected curated set. `expected` = the in-code seed set.
   */
  effectCoverage: { present: number; expected: number };
  /**
   * Product-format / consumption-method vocabulary coverage (migration 0087):
   * how many formats are in the KB vs. the expected curated set.
   */
  productFormatCoverage: { present: number; expected: number };
  /**
   * Compliance/safety reference-rule coverage (migration 0088): how many rules
   * are in the KB vs. the expected curated set.
   */
  complianceRuleCoverage: { present: number; expected: number };
  /**
   * Store/brand fact coverage (migration 0090): how many "about us" fact cards
   * are in the KB vs. the expected curated set.
   */
  storeFactCoverage: { present: number; expected: number };
  /**
   * FAQ pack coverage (migration 0090): how many FAQ entries are in the KB vs.
   * the expected curated set.
   */
  faqCoverage: { present: number; expected: number };
  /**
   * Strain drafts awaiting human review (migration 0085 lifecycle). A
   * machine-suggested strain lands as status='draft' until promoted; curated
   * rows are 'published'. Counted within the sample; 0 pre-migration (the
   * `status` column is absent, so nothing reads as 'draft').
   */
  strainDrafts: number;
  /** TRUE totals per domain (exact counts, not the sampled page). */
  totals: { strains: number; brands: number; products: number; vendors: number };
  /** How many rows were actually scored (the completeness sample size). */
  sampled: { strains: number; brands: number; products: number; vendors: number };
};

const ATTENTION_THRESHOLD = 65; // below this => "needs attention" (matches "good" grade floor)

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export async function getKbHealth(): Promise<KbHealth> {
  const [strains, brands, vendors, products, draftReviews, counts, brandTotal, vendorCounts] =
    await Promise.all([
      listKbStrainsFull(1000),
      listBrandsWithFacts(1000),
      listVendors(),
      listKbProducts("published", 2000),
      countKbProductDrafts(),
      getKbCounts(),
      countBrands(),
      countVendors(),
    ]);

  const strainScores = strains.map((s) => scoreStrain(s as unknown as Record<string, unknown>));
  const brandScores = brands.map((b) => scoreBrand(b as unknown as Record<string, unknown>));
  const productScores = products.map((p) => scoreProduct(p as unknown as Record<string, unknown>));
  const vendorScores = vendors.map((v) => scoreVendor(v as unknown as Record<string, unknown>));

  return {
    strainCompleteness: avg(strainScores.map((s) => s.completeness)),
    brandCompleteness: avg(brandScores.map((s) => s.completeness)),
    productCompleteness: avg(productScores.map((s) => s.completeness)),
    vendorCompleteness: avg(vendorScores.map((s) => s.completeness)),
    strainsNeedingAttention: strainScores.filter((s) => s.quality < ATTENTION_THRESHOLD).length,
    brandsNeedingAttention: brandScores.filter((s) => s.quality < ATTENTION_THRESHOLD).length,
    vendorsNeedingAttention: vendorScores.filter((s) => s.quality < ATTENTION_THRESHOLD).length,
    draftReviews,
    cannabinoidCoverage: { present: counts.cannabinoids, expected: SEED_CANNABINOIDS.length },
    effectCoverage: { present: counts.effects, expected: SEED_EFFECTS.length },
    productFormatCoverage: { present: counts.productFormats, expected: SEED_PRODUCT_FORMATS.length },
    complianceRuleCoverage: { present: counts.complianceRules, expected: SEED_COMPLIANCE_RULES.length },
    storeFactCoverage: { present: counts.storeFacts, expected: SEED_STORE_FACTS.length },
    faqCoverage: { present: counts.faqs, expected: SEED_FAQS.length },
    strainDrafts: strains.filter((s) => s.status === "draft").length,
    totals: {
      strains: counts.strains,
      brands: brandTotal,
      products: products.length, // published set is small; the sample IS the total
      vendors: vendorCounts.total,
    },
    sampled: {
      strains: strains.length,
      brands: brands.length,
      products: products.length,
      vendors: vendors.length,
    },
  };
}
