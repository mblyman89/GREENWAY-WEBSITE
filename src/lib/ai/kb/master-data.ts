/**
 * src/lib/ai/kb/master-data.ts
 *
 * Vendor → Brand → Product master-data HIERARCHY for the Knowledge Base.
 *
 * MDM referential integrity (Profisee): a golden record set is organized by
 * data domains with correct parent/child relations. Here we assemble the real
 * operational hierarchy — vendors (0003) → brands (0003, brands.vendor_id) →
 * per-SKU products (kb_products, 0071) — so the KB workspace can present vendors
 * and brands as first-class master-data, not a bare form.
 *
 * Read-only + defensive: reuses existing vendor/brand store helpers and the
 * kb_products list (which degrades to [] pre-migration). Completeness reuses the
 * verified vendor/brand completeness module so scores stay consistent with the
 * Vendors admin. `hasLogo` is derived from logo_media_id (a boolean is all the
 * completeness scorer needs).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listVendors } from "@/lib/vendors/store";
import { vendorCompleteness, brandCompleteness } from "@/lib/vendors/completeness";
import { listKbProducts } from "./store";
import { imageSubstituteSlugSets } from "./image-substitutes";
import type { Vendor, Brand } from "@/lib/vendors/types";

export type MasterBrandNode = {
  id: string;
  name: string;
  slug: string | null;
  completeness: number;
  productCount: number; // published kb_products under this brand (by brand slug)
  /**
   * DAM coverage (PIM product-experience signal): true when the brand has a
   * real logo (logo_media_id) OR an active KB image substitute keyed to its
   * slug. Lets the master-data view flag brands that would render a blank tile.
   */
  hasImage: boolean;
};

export type MasterVendorNode = {
  id: string;
  name: string;
  slug: string;
  completeness: number;
  brandCount: number;
  brands: MasterBrandNode[];
  /** DAM coverage: real hero/logo OR an active vendor-scoped image substitute. */
  hasImage: boolean;
};

export type MasterDataTree = {
  vendors: MasterVendorNode[];
  orphanBrands: MasterBrandNode[]; // brands with no vendor_id
  totals: { vendors: number; brands: number; products: number };
};

/** Build the Vendor → Brand → Product tree with completeness + product counts. */
export async function getMasterDataTree(): Promise<MasterDataTree> {
  const [vendors, allBrands, publishedProducts, subSlugs] = await Promise.all([
    listVendors(),
    listBrandsFull(),
    listKbProducts("published", 5000),
    imageSubstituteSlugSets(),
  ]);

  // Count published kb_products per brand slug (kb_products.brand_slug).
  const productsByBrandSlug = new Map<string, number>();
  for (const p of publishedProducts) {
    const slug = (p.brand_slug ?? "").toLowerCase();
    if (!slug) continue;
    productsByBrandSlug.set(slug, (productsByBrandSlug.get(slug) ?? 0) + 1);
  }

  const brandNode = (b: Brand): MasterBrandNode => {
    const slug = (b.slug ?? "").toLowerCase();
    return {
      id: b.id,
      name: b.display_name,
      slug: b.slug ?? null,
      completeness: brandCompleteness(b, Boolean(b.logo_media_id)).percent,
      productCount: slug ? productsByBrandSlug.get(slug) ?? 0 : 0,
      hasImage: Boolean(b.logo_media_id) || (slug ? subSlugs.brands.has(slug) : false),
    };
  };

  const brandsByVendor = new Map<string, Brand[]>();
  const orphans: Brand[] = [];
  for (const b of allBrands) {
    if (b.vendor_id) {
      const arr = brandsByVendor.get(b.vendor_id) ?? [];
      arr.push(b);
      brandsByVendor.set(b.vendor_id, arr);
    } else {
      orphans.push(b);
    }
  }

  const vendorNodes: MasterVendorNode[] = vendors.map((v: Vendor) => {
    const brands = (brandsByVendor.get(v.id) ?? []).map(brandNode);
    const slug = (v.slug ?? "").toLowerCase();
    return {
      id: v.id,
      name: v.display_name,
      slug: v.slug,
      completeness: vendorCompleteness(v, Boolean(v.logo_media_id)).percent,
      brandCount: brands.length,
      brands,
      hasImage:
        Boolean(v.logo_media_id) ||
        Boolean(v.hero_media_id) ||
        (slug ? subSlugs.vendors.has(slug) : false),
    };
  });

  return {
    vendors: vendorNodes,
    orphanBrands: orphans.map(brandNode),
    totals: {
      vendors: vendors.length,
      brands: allBrands.length,
      products: publishedProducts.length,
    },
  };
}

/** Full Brand rows (needed for completeness scoring, not just the projection). */
async function listBrandsFull(): Promise<Brand[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("brands")
    .select("*")
    .order("display_name", { ascending: true });
  return (data as Brand[] | null) ?? [];
}
