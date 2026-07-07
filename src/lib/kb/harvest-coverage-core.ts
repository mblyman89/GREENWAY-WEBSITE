/**
 * src/lib/kb/harvest-coverage-core.ts — Slice H4 (pure logic, no DB).
 *
 * Grades a vendor against the OWNER'S SEVEN TARGET FIELDS (his priority list,
 * verbatim: vendor data, vendor logo, brand data, brand logo, product type
 * data, product descriptions, product images). Pure functions only (no
 * server-only import) so they can be unit-tested — mirrors the
 * benchmarks-core.ts pattern.
 */

/** A value is "real" when it's meaningfully filled in, not a stub. */
const THIN_CHARS = 40;

export type CoverageCell = {
  /** 0 = missing, 1 = complete; fractions for per-brand/per-product ratios. */
  value: number;
  detail: string;
};

export type VendorCoverage = {
  vendorId: string;
  displayName: string;
  website: string | null;
  brandCount: number;
  productCount: number;
  /** The seven target fields, in the owner's priority order. */
  cells: {
    vendorData: CoverageCell;
    vendorLogo: CoverageCell;
    brandData: CoverageCell;
    brandLogo: CoverageCell;
    productTypes: CoverageCell;
    productDescriptions: CoverageCell;
    productImages: CoverageCell;
  };
  /** Sum of the seven cell values — "Constellation: 4.5/7". */
  score: number;
};

export const COVERAGE_COLUMNS: { key: keyof VendorCoverage["cells"]; label: string }[] = [
  { key: "vendorData", label: "Vendor data" },
  { key: "vendorLogo", label: "Vendor logo" },
  { key: "brandData", label: "Brand data" },
  { key: "brandLogo", label: "Brand logo" },
  { key: "productTypes", label: "Product types" },
  { key: "productDescriptions", label: "Descriptions" },
  { key: "productImages", label: "Images" },
];

export type VendorLite = {
  id: string;
  display_name: string;
  website: string | null;
  logo_media_id: string | null;
  about: string | null;
  mission_statement: string | null;
};
export type BrandLite = {
  vendor_id: string | null;
  logo_media_id: string | null;
  about: string | null;
  known_for: string | null;
};
export type KbProductLite = {
  vendor_id: string | null;
  category: string | null;
  description: string | null;
  primary_media_id: string | null;
  image_media_ids: string[] | null;
};

function filled(v: string | null | undefined): boolean {
  return Boolean(v && v.trim().length >= THIN_CHARS);
}

/** Pure scorer — exported for tests. */
export function scoreVendorCoverage(
  vendor: VendorLite,
  brands: BrandLite[],
  products: KbProductLite[],
): VendorCoverage {
  const brandTotal = brands.length;
  const brandsWithData = brands.filter((b) => filled(b.about) || filled(b.known_for)).length;
  const brandsWithLogo = brands.filter((b) => Boolean(b.logo_media_id)).length;

  const productTotal = products.length;
  const productsWithType = products.filter((p) => Boolean(p.category && p.category.trim())).length;
  const productsWithDesc = products.filter((p) => filled(p.description)).length;
  const productsWithImage = products.filter(
    (p) => Boolean(p.primary_media_id) || (p.image_media_ids?.length ?? 0) > 0,
  ).length;

  const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

  const cells: VendorCoverage["cells"] = {
    vendorData: {
      value: filled(vendor.about) || filled(vendor.mission_statement) ? 1 : 0,
      detail: filled(vendor.about) || filled(vendor.mission_statement) ? "profile filled" : "no about/mission",
    },
    vendorLogo: {
      value: vendor.logo_media_id ? 1 : 0,
      detail: vendor.logo_media_id ? "logo set" : "no logo",
    },
    brandData: {
      value: ratio(brandsWithData, brandTotal),
      detail: brandTotal === 0 ? "no brands" : `${brandsWithData}/${brandTotal} brands`,
    },
    brandLogo: {
      value: ratio(brandsWithLogo, brandTotal),
      detail: brandTotal === 0 ? "no brands" : `${brandsWithLogo}/${brandTotal} brands`,
    },
    productTypes: {
      value: ratio(productsWithType, productTotal),
      detail: productTotal === 0 ? "no KB products" : `${productsWithType}/${productTotal} products`,
    },
    productDescriptions: {
      value: ratio(productsWithDesc, productTotal),
      detail: productTotal === 0 ? "no KB products" : `${productsWithDesc}/${productTotal} products`,
    },
    productImages: {
      value: ratio(productsWithImage, productTotal),
      detail: productTotal === 0 ? "no KB products" : `${productsWithImage}/${productTotal} products`,
    },
  };

  const score = Object.values(cells).reduce((s, c) => s + c.value, 0);
  return {
    vendorId: vendor.id,
    displayName: vendor.display_name,
    website: vendor.website,
    brandCount: brandTotal,
    productCount: productTotal,
    cells,
    score: Math.round(score * 10) / 10,
  };
}

