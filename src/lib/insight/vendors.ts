/**
 * src/lib/insight/vendors.ts
 *
 * Read-only aggregate analytics + ranked "what's missing" for vendors (and
 * brands). Pure functions built on the existing vendorCompleteness /
 * brandCompleteness scorers. Part of POS Slice 1 (page insight upgrade).
 */
import type { Vendor, Brand } from "@/lib/vendors/types";
import { vendorCompleteness, brandCompleteness } from "@/lib/vendors/completeness";
import type { GapInsight } from "@/lib/insight/products";

export type VendorStats = {
  total: number;
  published: number;
  drafts: number;
  /** Average completeness % across all vendors. */
  avgCompleteness: number;
  /** Counts of vendors missing key fields. */
  missing: {
    logo: number;
    about: number;
    mission: number;
    website: number;
    email: number;
    social: number;
  };
  /** Vendors with zero brands / zero products. */
  noBrands: number;
  noProducts: number;
  /** Totals rolled up from vendor counters. */
  totalBrands: number;
  totalProducts: number;
};

/**
 * Compute vendor aggregate stats. `hasLogo(id)` lets the caller supply the
 * batch-resolved logo presence map (the page already resolves logo URLs).
 */
export function computeVendorStats(vendors: Vendor[], hasLogo: (id: string) => boolean): VendorStats {
  let logo = 0,
    about = 0,
    mission = 0,
    website = 0,
    email = 0,
    social = 0;
  let completenessSum = 0;
  let noBrands = 0,
    noProducts = 0,
    totalBrands = 0,
    totalProducts = 0;

  for (const v of vendors) {
    const c = vendorCompleteness(v, hasLogo(v.id));
    completenessSum += c.percent;
    for (const item of c.items) {
      if (item.done) continue;
      if (item.key === "logo") logo++;
      else if (item.key === "about") about++;
      else if (item.key === "mission_statement") mission++;
      else if (item.key === "website") website++;
      else if (item.key === "email") email++;
      else if (item.key === "social") social++;
    }
    if ((v.brand_count ?? 0) === 0) noBrands++;
    if ((v.product_count ?? 0) === 0) noProducts++;
    totalBrands += v.brand_count ?? 0;
    totalProducts += v.product_count ?? 0;
  }

  const published = vendors.filter((v) => v.status === "published").length;

  return {
    total: vendors.length,
    published,
    drafts: vendors.length - published,
    avgCompleteness: vendors.length === 0 ? 0 : Math.round(completenessSum / vendors.length),
    missing: { logo, about, mission, website, email, social },
    noBrands,
    noProducts,
    totalBrands,
    totalProducts,
  };
}

/** Ranked "what's missing" gap list for vendors. */
export function vendorGapInsights(stats: VendorStats): GapInsight[] {
  const gaps: GapInsight[] = [
    { key: "logo", label: "missing a logo", count: stats.missing.logo, weight: 3 },
    { key: "about", label: "missing an about/description", count: stats.missing.about, weight: 3 },
    { key: "mission", label: "missing a mission statement", count: stats.missing.mission, weight: 2 },
    { key: "website", label: "missing a website link", count: stats.missing.website, weight: 1 },
    { key: "email", label: "missing a contact email", count: stats.missing.email, weight: 1 },
    { key: "social", label: "missing a social link", count: stats.missing.social, weight: 1 },
    { key: "no-brands", label: "have no brands attached", count: stats.noBrands, weight: 2 },
    { key: "no-products", label: "have no products attached", count: stats.noProducts, weight: 2 },
  ];
  return gaps.filter((g) => g.count > 0).sort((a, b) => b.weight - a.weight || b.count - a.count);
}

// ── Brands ────────────────────────────────────────────────────────────────

export type BrandStats = {
  total: number;
  published: number;
  drafts: number;
  avgCompleteness: number;
  missing: { logo: number; about: number; philosophy: number; website: number };
  noProducts: number;
  totalProducts: number;
};

export function computeBrandStats(brands: Brand[], hasLogo: (id: string) => boolean): BrandStats {
  let logo = 0,
    about = 0,
    philosophy = 0,
    website = 0,
    noProducts = 0,
    totalProducts = 0,
    completenessSum = 0;

  for (const b of brands) {
    const c = brandCompleteness(b, hasLogo(b.id));
    completenessSum += c.percent;
    for (const item of c.items) {
      if (item.done) continue;
      if (item.key === "logo") logo++;
      else if (item.key === "about") about++;
      else if (item.key === "product_philosophy") philosophy++;
      else if (item.key === "website") website++;
    }
    if ((b.product_count ?? 0) === 0) noProducts++;
    totalProducts += b.product_count ?? 0;
  }

  const published = brands.filter((b) => b.status === "published").length;
  return {
    total: brands.length,
    published,
    drafts: brands.length - published,
    avgCompleteness: brands.length === 0 ? 0 : Math.round(completenessSum / brands.length),
    missing: { logo, about, philosophy, website },
    noProducts,
    totalProducts,
  };
}

export function brandGapInsights(stats: BrandStats): GapInsight[] {
  const gaps: GapInsight[] = [
    { key: "logo", label: "missing a logo", count: stats.missing.logo, weight: 3 },
    { key: "about", label: "missing an about/description", count: stats.missing.about, weight: 3 },
    { key: "philosophy", label: "missing a product philosophy", count: stats.missing.philosophy, weight: 2 },
    { key: "website", label: "missing a website link", count: stats.missing.website, weight: 1 },
    { key: "no-products", label: "have no products attached", count: stats.noProducts, weight: 2 },
  ];
  return gaps.filter((g) => g.count > 0).sort((a, b) => b.weight - a.weight || b.count - a.count);
}
