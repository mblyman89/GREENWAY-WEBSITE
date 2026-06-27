#!/usr/bin/env tsx
/**
 * scripts/seed/seed_vendors_brands.ts
 *
 * Seed the `vendors`, `vendor_aliases`, `brands`, `brand_aliases` tables from the
 * Slice 0 folder database (back-office/GREENWAY WEBSITE/database/vendors/**).
 *
 * Idempotent: upserts by slug, so re-running updates rather than duplicates.
 * Profiles are imported with status 'draft' (staff review/publish them later).
 * POS source strings become aliases so the importer can map labels to records.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
 *
 * Run: npm run seed:vendors
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

    // Upsert vendor by slug.
    const { data: vendorRow, error: vErr } = await admin
      .from("vendors")
      .upsert(
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
        { onConflict: "slug" },
      )
      .select("id")
      .single();
    if (vErr || !vendorRow) {
      console.error(`Vendor upsert failed for ${vendorSlug}: ${vErr?.message}`);
      continue;
    }
    vendorCount += 1;
    const vendorId = (vendorRow as { id: string }).id;

    // Vendor aliases.
    for (const alias of v.posAliases ?? []) {
      const { error } = await admin
        .from("vendor_aliases")
        .upsert({ vendor_id: vendorId, source_name: alias, source_system: "pos" }, { onConflict: "source_system,source_name" });
      if (!error) vendorAliasCount += 1;
    }

    // Brands under this vendor.
    const brandsDir = path.join(vendorDir, "brands");
    if (!fs.existsSync(brandsDir)) continue;
    const brandSlugs = fs
      .readdirSync(brandsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const brandSlug of brandSlugs) {
      const b = readJson<BrandJson>(path.join(brandsDir, brandSlug, "brand.json"));
      if (!b) continue;

      const { data: brandRow, error: bErr } = await admin
        .from("brands")
        .upsert(
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
          { onConflict: "slug" },
        )
        .select("id")
        .single();
      if (bErr || !brandRow) {
        console.error(`Brand upsert failed for ${brandSlug}: ${bErr?.message}`);
        continue;
      }
      brandCount += 1;
      const brandId = (brandRow as { id: string }).id;

      for (const alias of b.posAliases ?? []) {
        const { error } = await admin
          .from("brand_aliases")
          .upsert({ brand_id: brandId, source_name: alias, source_system: "pos" }, { onConflict: "source_system,source_name" });
        if (!error) brandAliasCount += 1;
      }
    }
  }

  console.log(`Seeded ${vendorCount} vendors (${vendorAliasCount} aliases) + ${brandCount} brands (${brandAliasCount} aliases).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
