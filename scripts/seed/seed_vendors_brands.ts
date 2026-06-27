#!/usr/bin/env tsx
/**
 * scripts/seed/seed_vendors_brands.ts
 *
 * Seed the `vendors`, `vendor_aliases`, `brands`, `brand_aliases` tables from the
 * Slice 0 folder database (back-office/GREENWAY WEBSITE/database/vendors/**).
 *
 * Idempotent: upserts by slug (PostgREST on_conflict + merge-duplicates), so
 * re-running updates rather than duplicates. Profiles are imported with status
 * 'draft' (staff review/publish them later). POS source strings become aliases
 * so the importer can map labels to records.
 *
 * Uses the PostgREST REST API directly (no @supabase/supabase-js) to stay
 * dependency-free and avoid the realtime WebSocket init that fails on Node 20.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
 *
 * Run: npm run seed:vendors
 */
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const REST = `${SUPABASE_URL}/rest/v1`;
const BASE_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const VENDORS_DIR = path.join(process.cwd(), "back-office", "GREENWAY WEBSITE", "database", "vendors");

type VendorJson = {
  displayName: string;
  slug: string;
  legalName?: string;
  missionStatement?: string;
  about?: string;
  website?: string;
  email?: string;
  phone?: string;
  instagram?: string;
  facebook?: string;
  internalNotes?: string;
  vendorDayNotes?: string;
  status?: string;
  posAliases?: string[];
  brandCount?: number;
  productCount?: number;
};

type BrandJson = {
  displayName: string;
  slug: string;
  vendor: string;
  missionStatement?: string;
  about?: string;
  website?: string;
  instagram?: string;
  productPhilosophy?: string;
  productCount?: number;
  status?: string;
  posAliases?: string[];
};

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function social(instagram?: string, facebook?: string): Record<string, string> {
  const s: Record<string, string> = {};
  if (instagram) s.instagram = instagram;
  if (facebook) s.facebook = facebook;
  return s;
}

/** Upsert a single row and return the created/updated row(s). */
async function upsert<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
  returning = false,
): Promise<T[] | null> {
  const url = `${REST}/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...BASE_HEADERS,
      Prefer: returning ? "resolution=merge-duplicates,return=representation" : "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table} upsert failed (${res.status}): ${text}`);
  }
  if (!returning) return null;
  return (await res.json()) as T[];
}

async function main() {
  if (!fs.existsSync(VENDORS_DIR)) {
    throw new Error(`Vendors folder DB not found at ${VENDORS_DIR}`);
  }

  const vendorSlugs = fs
    .readdirSync(VENDORS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let vendorCount = 0;
  let brandCount = 0;
  let vendorAliasCount = 0;
  let brandAliasCount = 0;

  for (const vendorSlug of vendorSlugs) {
    const vendorDir = path.join(VENDORS_DIR, vendorSlug);
    const v = readJson<VendorJson>(path.join(vendorDir, "vendor.json"));
    if (!v) continue;

    let vendorRows: { id: string }[] | null = null;
    try {
      vendorRows = await upsert<{ id: string }>(
        "vendors",
        {
          display_name: v.displayName,
          slug: v.slug,
          legal_name: v.legalName || null,
          mission_statement: v.missionStatement || null,
          about: v.about || null,
          website: v.website || null,
          email: v.email || null,
          phone: v.phone || null,
          social_json: social(v.instagram, v.facebook),
          internal_notes: v.internalNotes || null,
          vendor_day_notes: v.vendorDayNotes || null,
          product_count: v.productCount ?? 0,
          brand_count: v.brandCount ?? 0,
          status: "draft",
        },
        "slug",
        true,
      );
    } catch (err) {
      console.error(`Vendor upsert failed for ${vendorSlug}: ${(err as Error).message}`);
      continue;
    }
    const vendorId = vendorRows?.[0]?.id;
    if (!vendorId) {
      console.error(`Vendor upsert returned no id for ${vendorSlug}`);
      continue;
    }
    vendorCount += 1;

    for (const alias of v.posAliases ?? []) {
      try {
        await upsert("vendor_aliases", { vendor_id: vendorId, source_name: alias, source_system: "pos" }, "source_system,source_name");
        vendorAliasCount += 1;
      } catch {
        /* ignore alias conflicts */
      }
    }

    const brandsDir = path.join(vendorDir, "brands");
    if (!fs.existsSync(brandsDir)) continue;
    const brandSlugs = fs
      .readdirSync(brandsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const brandSlug of brandSlugs) {
      const b = readJson<BrandJson>(path.join(brandsDir, brandSlug, "brand.json"));
      if (!b) continue;

      let brandRows: { id: string }[] | null = null;
      try {
        brandRows = await upsert<{ id: string }>(
          "brands",
          {
            display_name: b.displayName,
            slug: b.slug,
            vendor_id: vendorId,
            about: b.about || null,
            mission_statement: b.missionStatement || null,
            product_philosophy: b.productPhilosophy || null,
            website: b.website || null,
            social_json: social(b.instagram),
            product_count: b.productCount ?? 0,
            status: "draft",
          },
          "slug",
          true,
        );
      } catch (err) {
        console.error(`Brand upsert failed for ${brandSlug}: ${(err as Error).message}`);
        continue;
      }
      const brandId = brandRows?.[0]?.id;
      if (!brandId) {
        console.error(`Brand upsert returned no id for ${brandSlug}`);
        continue;
      }
      brandCount += 1;

      for (const alias of b.posAliases ?? []) {
        try {
          await upsert("brand_aliases", { brand_id: brandId, source_name: alias, source_system: "pos" }, "source_system,source_name");
          brandAliasCount += 1;
        } catch {
          /* ignore alias conflicts */
        }
      }
    }
  }

  console.log(`Seeded ${vendorCount} vendors (${vendorAliasCount} aliases) + ${brandCount} brands (${brandAliasCount} aliases).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
