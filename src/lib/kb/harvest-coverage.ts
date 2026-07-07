/**
 * src/lib/kb/harvest-coverage.ts — Slice H4 (DB reads).
 *
 * Loads vendors/brands/kb_products (paged, bounded) and grades every vendor
 * with the pure scorer in harvest-coverage-core.ts. Sorted worst-first — the
 * top of the list IS the harvest queue.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  scoreVendorCoverage,
  type BrandLite,
  type KbProductLite,
  type VendorCoverage,
  type VendorLite,
} from "./harvest-coverage-core";

export { COVERAGE_COLUMNS, scoreVendorCoverage } from "./harvest-coverage-core";
export type { VendorCoverage, CoverageCell } from "./harvest-coverage-core";

async function pageAll<T>(
  table: string,
  columns: string,
  cap = 10_000,
): Promise<T[]> {
  const admin = createSupabaseAdminClient();
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

/**
 * Compute coverage for every vendor (bounded reads, grouped in memory).
 * Sorted worst-first — the top of the list IS the harvest queue.
 */
export async function computeHarvestCoverage(): Promise<VendorCoverage[]> {
  if (!isSupabaseServiceConfigured) return [];
  const [vendors, brands, products] = await Promise.all([
    pageAll<VendorLite>("vendors", "id, display_name, website, logo_media_id, about, mission_statement"),
    pageAll<BrandLite>("brands", "vendor_id, logo_media_id, about, known_for"),
    pageAll<KbProductLite>(
      "kb_products",
      "vendor_id, category, description, primary_media_id, image_media_ids",
    ),
  ]);

  const brandsByVendor = new Map<string, BrandLite[]>();
  for (const b of brands) {
    if (!b.vendor_id) continue;
    const list = brandsByVendor.get(b.vendor_id) ?? [];
    list.push(b);
    brandsByVendor.set(b.vendor_id, list);
  }
  const productsByVendor = new Map<string, KbProductLite[]>();
  for (const p of products) {
    if (!p.vendor_id) continue;
    const list = productsByVendor.get(p.vendor_id) ?? [];
    list.push(p);
    productsByVendor.set(p.vendor_id, list);
  }

  const out = vendors.map((v) =>
    scoreVendorCoverage(v, brandsByVendor.get(v.id) ?? [], productsByVendor.get(v.id) ?? []),
  );
  out.sort((a, b) => a.score - b.score || a.displayName.localeCompare(b.displayName));
  return out;
}
