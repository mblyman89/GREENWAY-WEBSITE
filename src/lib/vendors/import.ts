/**
 * src/lib/vendors/import.ts
 *
 * Import vendors + brands from a pasted spreadsheet export (CSV) — e.g. the
 * Cultivera vendor/brand export the owner is retrieving.
 *
 * Design (matches the standing rules + the existing customers importer):
 *  - Tolerant header mapping: recognizes several common column-name variants so
 *    we don't have to guess the EXACT Cultivera headers before the file arrives.
 *    (Owner will supply the real file; add any missing header synonyms then.)
 *  - Upsert BY SLUG (mirrors scripts/seed/seed_vendors_brands.ts), so re-importing
 *    is safe and never duplicates.
 *  - GAP-FILL only: existing curated values are NEVER overwritten. We only fill a
 *    column that is currently empty/null. This protects owner-authored profiles.
 *  - New rows land as status 'draft' (staff review/publish later) — drafts-only.
 *  - Money is not involved here; no minor-unit conversion needed.
 *
 * Two logical sheets are supported in one paste:
 *  - A vendor row is any row that has a vendor name and NO "brand"/"parent vendor"
 *    column value pointing elsewhere.
 *  - A brand row is any row that carries a brand name (+ optional parent vendor).
 * If the export is vendors-only or brands-only, that's fine — we import whatever
 * columns are present. The header decides which entity a sheet is.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { parseCsv } from "@/lib/customers/import";

// ── Slug ─────────────────────────────────────────────────────────────────────
export function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ── Parsed row shapes ──────────────────────────────────────────────────────────
export type VendorImportRow = {
  display_name: string;
  slug: string;
  legal_name: string | null;
  license_number: string | null;
  mission_statement: string | null;
  about: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  facebook: string | null;
  internal_notes: string | null;
  // Contact / address + ops facts (Cultivera export, migration 0081).
  vendor_number: string | null;
  dba: string | null;
  external_id: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  billing_address1: string | null;
  billing_address2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  billing_same_as_shipping: boolean | null;
  is_active: boolean | null;
  total_accepted_ytd_cents: number | null;
  last_accepted_at: string | null;
};

export type BrandImportRow = {
  display_name: string;
  slug: string;
  vendor_name: string | null; // parent vendor label (resolved to vendor_id at write)
  about: string | null;
  mission_statement: string | null;
  product_philosophy: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
};

export type ParsedVendorBrandImport = {
  entity: "vendors" | "brands" | "unknown";
  vendors: VendorImportRow[];
  brands: BrandImportRow[];
  warnings: string[];
};

// ── Header synonym maps (lowercased). Extend when the real file arrives. ───────
// String-mappable columns. Typed fields (booleans, cents, dates) are handled by
// the dedicated seed script, not the generic CSV paste importer.
type VendorStringField = Exclude<
  keyof Omit<VendorImportRow, "slug">,
  "billing_same_as_shipping" | "is_active" | "total_accepted_ytd_cents" | "last_accepted_at"
>;
const VENDOR_HEADERS: Record<VendorStringField, string[]> = {
  display_name: ["vendor", "vendor name", "display name", "name", "company", "company name", "supplier", "supplier name", "tradename", "trade name"],
  legal_name: ["legal name", "legal", "legal business name"],
  license_number: ["license", "license number", "license #", "ubi", "wslcb license", "lcb license", "traceability license", "licenseno", "license no"],
  mission_statement: ["mission", "mission statement", "tagline"],
  about: ["about", "description", "bio", "notes", "overview"],
  website: ["website", "url", "web", "site"],
  email: ["email", "e-mail", "contact email"],
  phone: ["phone", "phone number", "telephone", "contact phone"],
  instagram: ["instagram", "ig", "instagram handle"],
  facebook: ["facebook", "fb"],
  internal_notes: ["internal notes", "internal", "staff notes"],
  vendor_number: ["vendor number", "vendorno", "vendor no", "vendor #"],
  dba: ["dba", "doing business as"],
  external_id: ["id", "external id", "source id"],
  shipping_address1: ["shipping address1", "shipping address 1", "shippingaddress1", "ship address 1"],
  shipping_address2: ["shipping address2", "shipping address 2", "shippingaddress2", "ship address 2"],
  shipping_city: ["shipping city", "shippingcity", "ship city"],
  shipping_state: ["shipping state", "shippingstate", "ship state"],
  shipping_zip: ["shipping zip", "shippingzip", "ship zip"],
  billing_address1: ["billing address1", "billing address 1", "billingaddress1"],
  billing_address2: ["billing address2", "billing address 2", "billingaddress2"],
  billing_city: ["billing city", "billingcity"],
  billing_state: ["billing state", "billingstate"],
  billing_zip: ["billing zip", "billingzip"],
};

const BRAND_HEADERS: Record<keyof Omit<BrandImportRow, "slug">, string[]> = {
  display_name: ["brand", "brand name", "display name", "name", "product line", "line"],
  vendor_name: ["vendor", "vendor name", "parent vendor", "supplier", "producer", "manufacturer", "company"],
  about: ["about", "description", "bio", "overview"],
  mission_statement: ["mission", "mission statement", "tagline"],
  product_philosophy: ["product philosophy", "philosophy", "approach"],
  website: ["website", "url", "web", "site"],
  instagram: ["instagram", "ig", "instagram handle"],
  facebook: ["facebook", "fb"],
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function clean(s: string | undefined | null): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t.length ? t : null;
}

/** Return the first header index that matches any synonym, else -1. */
function findCol(header: string[], synonyms: string[]): number {
  for (const syn of synonyms) {
    const idx = header.indexOf(syn.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Decide whether a sheet describes vendors or brands, based on the header row.
 * A "brand" header (a column literally named brand/brand name/product line) wins;
 * otherwise if there's a vendor/company/name column we treat it as vendors.
 */
function detectEntity(header: string[]): "vendors" | "brands" | "unknown" {
  const hasBrandCol = findCol(header, ["brand", "brand name", "product line"]) !== -1;
  const hasVendorCol = findCol(header, VENDOR_HEADERS.display_name) !== -1;
  if (hasBrandCol) return "brands";
  if (hasVendorCol) return "vendors";
  return "unknown";
}

// ── Public: parse pasted CSV into vendor/brand rows ────────────────────────────
export function mapVendorBrandCsv(text: string): ParsedVendorBrandImport {
  const grid = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (grid.length === 0) {
    return { entity: "unknown", vendors: [], brands: [], warnings: ["The paste was empty."] };
  }
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const body = grid.slice(1);
  const warnings: string[] = [];
  const entity = detectEntity(header);

  if (entity === "unknown") {
    return {
      entity,
      vendors: [],
      brands: [],
      warnings: [
        "Couldn't find a vendor or brand name column in the header. Expected a column named e.g. 'Vendor', 'Vendor Name', 'Brand', or 'Name'.",
      ],
    };
  }

  if (entity === "vendors") {
    const cols = Object.fromEntries(
      (Object.keys(VENDOR_HEADERS) as (keyof typeof VENDOR_HEADERS)[]).map((k) => [k, findCol(header, VENDOR_HEADERS[k])]),
    ) as Record<keyof typeof VENDOR_HEADERS, number>;

    const at = (row: string[], idx: number) => (idx >= 0 ? clean(row[idx]) : null);
    const vendors: VendorImportRow[] = [];
    for (const row of body) {
      const name = at(row, cols.display_name);
      if (!name) continue; // skip rows with no vendor name
      vendors.push({
        display_name: name,
        slug: slugifyName(name),
        legal_name: at(row, cols.legal_name),
        license_number: at(row, cols.license_number),
        mission_statement: at(row, cols.mission_statement),
        about: at(row, cols.about),
        website: at(row, cols.website),
        email: at(row, cols.email),
        phone: at(row, cols.phone),
        instagram: at(row, cols.instagram),
        facebook: at(row, cols.facebook),
        internal_notes: at(row, cols.internal_notes),
        vendor_number: at(row, cols.vendor_number),
        dba: at(row, cols.dba),
        external_id: at(row, cols.external_id),
        shipping_address1: at(row, cols.shipping_address1),
        shipping_address2: at(row, cols.shipping_address2),
        shipping_city: at(row, cols.shipping_city),
        shipping_state: at(row, cols.shipping_state),
        shipping_zip: at(row, cols.shipping_zip),
        billing_address1: at(row, cols.billing_address1),
        billing_address2: at(row, cols.billing_address2),
        billing_city: at(row, cols.billing_city),
        billing_state: at(row, cols.billing_state),
        billing_zip: at(row, cols.billing_zip),
        // Typed fields are not parsed from generic paste; seed script sets them.
        billing_same_as_shipping: null,
        is_active: null,
        total_accepted_ytd_cents: null,
        last_accepted_at: null,
      });
    }
    if (vendors.length === 0) warnings.push("No vendor rows with a name were found.");
    return { entity, vendors, brands: [], warnings };
  }

  // entity === "brands"
  const cols = Object.fromEntries(
    (Object.keys(BRAND_HEADERS) as (keyof typeof BRAND_HEADERS)[]).map((k) => [k, findCol(header, BRAND_HEADERS[k])]),
  ) as Record<keyof typeof BRAND_HEADERS, number>;

  const at = (row: string[], idx: number) => (idx >= 0 ? clean(row[idx]) : null);
  const brands: BrandImportRow[] = [];
  for (const row of body) {
    const name = at(row, cols.display_name);
    if (!name) continue;
    brands.push({
      display_name: name,
      slug: slugifyName(name),
      vendor_name: at(row, cols.vendor_name),
      about: at(row, cols.about),
      mission_statement: at(row, cols.mission_statement),
      product_philosophy: at(row, cols.product_philosophy),
      website: at(row, cols.website),
      instagram: at(row, cols.instagram),
      facebook: at(row, cols.facebook),
    });
  }
  if (brands.length === 0) warnings.push("No brand rows with a name were found.");
  return { entity, vendors: [], brands, warnings };
}

// ── Write: gap-fill upsert by slug ─────────────────────────────────────────────
export type ImportResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
};

/**
 * Build an UPDATE patch that only fills columns currently empty on the existing
 * row. Never overwrites curated data. Returns null if nothing to fill.
 */
function gapFillPatch<T extends Record<string, unknown>>(
  existing: Record<string, unknown>,
  incoming: T,
): Partial<T> | null {
  const patch: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(incoming)) {
    if (val == null || val === "") continue;
    const cur = existing[key];
    if (cur == null || cur === "") patch[key] = val;
  }
  return Object.keys(patch).length ? (patch as Partial<T>) : null;
}

export async function importVendors(
  rows: VendorImportRow[],
  actorId: string | null,
): Promise<ImportResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, inserted: 0, updated: 0, skipped: 0, error: "not-configured" };
  const admin = createSupabaseAdminClient();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const social: Record<string, string> = {};
    if (r.instagram) social.instagram = r.instagram;
    if (r.facebook) social.facebook = r.facebook;

    const { data: existing } = await admin.from("vendors").select("*").eq("slug", r.slug).maybeSingle();

    if (!existing) {
      const { error } = await admin.from("vendors").insert({
        display_name: r.display_name,
        slug: r.slug,
        legal_name: r.legal_name,
        license_number: r.license_number,
        mission_statement: r.mission_statement,
        about: r.about,
        website: r.website,
        email: r.email,
        phone: r.phone,
        social_json: social,
        internal_notes: r.internal_notes,
        vendor_number: r.vendor_number,
        dba: r.dba,
        external_id: r.external_id,
        shipping_address1: r.shipping_address1,
        shipping_address2: r.shipping_address2,
        shipping_city: r.shipping_city,
        shipping_state: r.shipping_state,
        shipping_zip: r.shipping_zip,
        billing_address1: r.billing_address1,
        billing_address2: r.billing_address2,
        billing_city: r.billing_city,
        billing_state: r.billing_state,
        billing_zip: r.billing_zip,
        billing_same_as_shipping: r.billing_same_as_shipping,
        is_active: r.is_active,
        total_accepted_ytd_cents: r.total_accepted_ytd_cents,
        last_accepted_at: r.last_accepted_at,
        status: "draft",
        created_by: actorId,
        updated_by: actorId,
      });
      if (error) return { ok: false, inserted, updated, skipped, error: error.message };
      inserted += 1;
      continue;
    }

    // Gap-fill only.
    const incoming: Record<string, unknown> = {
      legal_name: r.legal_name,
      license_number: r.license_number,
      mission_statement: r.mission_statement,
      about: r.about,
      website: r.website,
      email: r.email,
      phone: r.phone,
      internal_notes: r.internal_notes,
      vendor_number: r.vendor_number,
      dba: r.dba,
      external_id: r.external_id,
      shipping_address1: r.shipping_address1,
      shipping_address2: r.shipping_address2,
      shipping_city: r.shipping_city,
      shipping_state: r.shipping_state,
      shipping_zip: r.shipping_zip,
      billing_address1: r.billing_address1,
      billing_address2: r.billing_address2,
      billing_city: r.billing_city,
      billing_state: r.billing_state,
      billing_zip: r.billing_zip,
      billing_same_as_shipping: r.billing_same_as_shipping,
      is_active: r.is_active,
      total_accepted_ytd_cents: r.total_accepted_ytd_cents,
      last_accepted_at: r.last_accepted_at,
    };
    const patch = gapFillPatch(existing as Record<string, unknown>, incoming);

    // Merge social without clobbering existing keys.
    const existingSocial = (existing.social_json as Record<string, string>) ?? {};
    const mergedSocial = { ...social, ...existingSocial }; // existing wins
    const socialChanged = JSON.stringify(mergedSocial) !== JSON.stringify(existingSocial);

    if (!patch && !socialChanged) {
      skipped += 1;
      continue;
    }
    const { error } = await admin
      .from("vendors")
      .update({ ...(patch ?? {}), ...(socialChanged ? { social_json: mergedSocial } : {}), updated_by: actorId })
      .eq("id", existing.id as string);
    if (error) return { ok: false, inserted, updated, skipped, error: error.message };
    updated += 1;
  }

  return { ok: true, inserted, updated, skipped };
}

export async function importBrands(
  rows: BrandImportRow[],
  actorId: string | null,
): Promise<ImportResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, inserted: 0, updated: 0, skipped: 0, error: "not-configured" };
  const admin = createSupabaseAdminClient();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  // Resolve parent vendor by slug when a vendor label is present.
  const vendorIdBySlug = new Map<string, string>();
  const { data: vendorRows } = await admin.from("vendors").select("id, slug");
  for (const v of (vendorRows as { id: string; slug: string }[] | null) ?? []) {
    vendorIdBySlug.set(v.slug, v.id);
  }

  for (const r of rows) {
    const vendorId = r.vendor_name ? vendorIdBySlug.get(slugifyName(r.vendor_name)) ?? null : null;
    const social: Record<string, string> = {};
    if (r.instagram) social.instagram = r.instagram;
    if (r.facebook) social.facebook = r.facebook;

    const { data: existing } = await admin.from("brands").select("*").eq("slug", r.slug).maybeSingle();

    if (!existing) {
      const { error } = await admin.from("brands").insert({
        display_name: r.display_name,
        slug: r.slug,
        vendor_id: vendorId,
        about: r.about,
        mission_statement: r.mission_statement,
        product_philosophy: r.product_philosophy,
        website: r.website,
        social_json: social,
        status: "draft",
        created_by: actorId,
        updated_by: actorId,
      });
      if (error) return { ok: false, inserted, updated, skipped, error: error.message };
      inserted += 1;
      continue;
    }

    const incoming: Record<string, unknown> = {
      about: r.about,
      mission_statement: r.mission_statement,
      product_philosophy: r.product_philosophy,
      website: r.website,
      // Only set vendor_id if brand has none yet.
      vendor_id: vendorId,
    };
    const patch = gapFillPatch(existing as Record<string, unknown>, incoming);
    const existingSocial = (existing.social_json as Record<string, string>) ?? {};
    const mergedSocial = { ...social, ...existingSocial };
    const socialChanged = JSON.stringify(mergedSocial) !== JSON.stringify(existingSocial);

    if (!patch && !socialChanged) {
      skipped += 1;
      continue;
    }
    const { error } = await admin
      .from("brands")
      .update({ ...(patch ?? {}), ...(socialChanged ? { social_json: mergedSocial } : {}), updated_by: actorId })
      .eq("id", existing.id as string);
    if (error) return { ok: false, inserted, updated, skipped, error: error.message };
    updated += 1;
  }

  return { ok: true, inserted, updated, skipped };
}
