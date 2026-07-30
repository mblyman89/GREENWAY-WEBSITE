/**
 * SLICE 48 (owner Q3) — vendor directory derived from the LIVE published menu.
 *
 * The public "Vendors & Partners" page used to render a committed static
 * vendors.json generated from a frozen Cultivera snapshot, so back-office
 * changes never reached it. That file is retired; this pure helper builds the
 * same {name, slug, productCount} entries from the live menu items instead,
 * so the directory always reflects what is actually published.
 *
 * Logic mirrors the transform pipeline's buildVendorList exactly: visible
 * (non-hidden) items only, blank vendors skipped, case-insensitive counting
 * keyed on the vendor name, sorted by product count (desc) then name so the
 * page leads with the most-stocked suppliers.
 *
 * NO I/O — unit-testable via __runVendorDirectoryCoreTests() (registered in
 * scripts/compliance/run-pure-selftests.ts).
 */

export type VendorDirectoryEntry = {
  name: string;
  slug: string;
  productCount: number;
  /** SLICE 97: real logo URL from the back office (media library), when the
   * menu vendor matches a vendors-table profile. null -> placeholder. */
  logoUrl?: string | null;
  /** SLICE 97: real description from the back office (about, else mission
   * statement), when matched. null -> placeholder copy. */
  description?: string | null;
};

type VendorSourceItem = {
  vendor?: string | null;
  hidden?: boolean;
};

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Slug matching the transform pipeline's collapseKeyPart treatment. */
export function vendorSlug(name: string): string {
  return normalizeWhitespace(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

export function buildVendorDirectory(items: readonly VendorSourceItem[]): VendorDirectoryEntry[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const item of items) {
    if (item.hidden) continue;
    const vendor = normalizeWhitespace(item.vendor);
    if (!vendor) continue;
    const key = vendor.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { name: vendor, count: 1 });
  }
  return [...counts.values()]
    .map((entry) => ({ name: entry.name, slug: vendorSlug(entry.name), productCount: entry.count }))
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// SLICE 97 — connect the directory to the BACK-OFFICE vendor profiles.
//
// ROOT CAUSE of "I added a logo in the vendor detail page and the public
// vendors page didn't update": this page NEVER read the vendors table. The
// directory is derived from live menu items (SLICE 48) and the card component
// hardcoded a placeholder logo for every vendor. The back-office save was
// always correct (vendors.logo_media_id + media_assets + revalidatePath);
// the public page simply never looked.
//
// Fix: enrichVendorDirectory folds the back-office profiles (logo URL +
// about/mission copy) into the menu-derived entries. Matching mirrors the
// intake resolution ladder, pure and read-only:
//   1. exact case/whitespace-insensitive display_name,
//   2. vendor_aliases source_name (how menu vendor names were born),
//   3. normalized display_name/dba/legal_name ("Fair-Winds, LLC." ===
//      "fair winds llc").
// Unmatched entries keep logoUrl/description null -> the card falls back to
// the placeholder exactly as before (honest degradation, never a broken img).
// ---------------------------------------------------------------------------

export type VendorProfileSource = {
  display_name: string;
  dba?: string | null;
  legal_name?: string | null;
  /** vendor_aliases.source_name values for this vendor. */
  aliases?: readonly string[];
  logoUrl?: string | null;
  about?: string | null;
  mission_statement?: string | null;
  /** SLICE 114: third description fallback (vendors.product_philosophy). */
  product_philosophy?: string | null;
};

function simpleKey(value: unknown): string {
  return normalizeWhitespace(value).toLowerCase();
}

/** Aggressive name key: punctuation/suffix-drift tolerant (po-match parity). */
export function normalizedVendorKey(value: unknown): string {
  return simpleKey(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function enrichVendorDirectory(
  entries: readonly VendorDirectoryEntry[],
  profiles: readonly VendorProfileSource[],
): VendorDirectoryEntry[] {
  // Precedence: exact display_name beats alias beats normalized scan; within
  // a tier the FIRST profile wins (deterministic — callers pass a stable
  // order). Blank keys never index (mirrors related-products-core's lesson).
  const byExact = new Map<string, VendorProfileSource>();
  const byAlias = new Map<string, VendorProfileSource>();
  const byNorm = new Map<string, VendorProfileSource>();
  for (const p of profiles) {
    const exact = simpleKey(p.display_name);
    if (exact && !byExact.has(exact)) byExact.set(exact, p);
    for (const alias of p.aliases ?? []) {
      const key = simpleKey(alias);
      if (key && !byAlias.has(key)) byAlias.set(key, p);
    }
    for (const candidate of [p.display_name, p.dba, p.legal_name]) {
      const norm = normalizedVendorKey(candidate);
      if (norm && !byNorm.has(norm)) byNorm.set(norm, p);
    }
  }
  return entries.map((entry) => {
    const exact = simpleKey(entry.name);
    const profile =
      byExact.get(exact) ?? byAlias.get(exact) ?? byNorm.get(normalizedVendorKey(entry.name));
    if (!profile) return { ...entry, logoUrl: null, description: null };
    // SLICE 114: the card's blurb prefers the vendor's mission_statement (the
    // one-liner they lead with), then their about copy, then the longer
    // product_philosophy — each whitespace-normalized, first non-blank wins.
    const description =
      normalizeWhitespace(profile.mission_statement) ||
      normalizeWhitespace(profile.about) ||
      normalizeWhitespace(profile.product_philosophy) ||
      null;
    return { ...entry, logoUrl: profile.logoUrl ?? null, description };
  });
}

// ---------------------------------------------------------------------------
// Self-tests (pure, no I/O)
// ---------------------------------------------------------------------------
export function __runVendorDirectoryCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`vendor-directory-core self-test failed: ${msg}`);
    passed += 1;
  };

  const dir = buildVendorDirectory([
    { vendor: "Seattle Bubble Works" },
    { vendor: "seattle bubble works" }, // case-insensitive merge, first spelling kept
    { vendor: "Alpha Crux Llc" },
    { vendor: "  Alpha Crux Llc  " }, // whitespace normalized
    { vendor: "Alpha Crux Llc" },
    { vendor: "" }, // blank skipped
    { vendor: null }, // null skipped
    { vendor: undefined }, // absent skipped
    { vendor: "Hidden Vendor", hidden: true }, // hidden items excluded
    { vendor: "B&B Farms" },
  ]);

  ok(dir.length === 3, "3 distinct vendors (blank/null/hidden excluded)");
  ok(dir[0].name === "Alpha Crux Llc" && dir[0].productCount === 3, "count-desc sort leads with 3-product vendor");
  ok(dir[1].name === "Seattle Bubble Works" && dir[1].productCount === 2, "case-insensitive merge keeps first spelling, counts 2");
  ok(dir[2].name === "B&B Farms" && dir[2].productCount === 1, "single-product vendor last");
  ok(dir[0].slug === "alpha-crux-llc", "slug lowercased and hyphenated");
  ok(dir[2].slug === "b-and-b-farms", "ampersand becomes 'and' in slug (collapseKeyPart parity)");
  ok(buildVendorDirectory([]).length === 0, "empty menu -> empty directory");
  ok(buildVendorDirectory([{ vendor: "X", hidden: true }]).length === 0, "all-hidden menu -> empty directory");

  // Name-alphabetical tiebreak at equal counts.
  const tie = buildVendorDirectory([{ vendor: "Zeta" }, { vendor: "Alpha" }]);
  ok(tie[0].name === "Alpha" && tie[1].name === "Zeta", "alphabetical tiebreak at equal counts");

  // --- SLICE 97: enrichVendorDirectory ---
  const entries = buildVendorDirectory([
    { vendor: "CERES" },
    { vendor: "Fair-Winds, LLC." },
    { vendor: "2727" },
    { vendor: "Philosophy Only Farms" },
    { vendor: "Mystery Farms" },
  ]);
  const profiles: VendorProfileSource[] = [
    {
      display_name: "Ceres",
      logoUrl: "https://x.supabase.co/storage/v1/object/public/media/ceres.png",
      about: "unused when mission present",
      mission_statement: "  Craft topicals from Washington.  ",
      product_philosophy: "also unused when higher-priority copy present",
    },
    {
      display_name: "Fairwinds Manufacturing",
      legal_name: "Fair Winds LLC",
      logoUrl: "https://x.supabase.co/storage/v1/object/public/media/fw.png",
      about: "Plant-powered wellness.",
      mission_statement: null,
    },
    {
      display_name: "Twenty Seven Twenty Seven",
      aliases: ["2727", "2727 - 413999"],
      logoUrl: null, // profile matched but no logo uploaded yet
      about: "Bold concentrates.",
    },
    {
      // SLICE 114: only product_philosophy is filled -> it becomes the blurb.
      display_name: "Philosophy Only Farms",
      logoUrl: null,
      about: "   ",
      mission_statement: null,
      product_philosophy: "  Small-batch, sun-grown, single-cultivar.  ",
    },
  ];
  const enriched = enrichVendorDirectory(entries, profiles);
  const byName = new Map(enriched.map((e) => [e.name, e]));
  ok(
    byName.get("CERES")?.logoUrl === "https://x.supabase.co/storage/v1/object/public/media/ceres.png",
    "exact name match is case-insensitive (CERES -> Ceres profile logo)",
  );
  ok(
    byName.get("CERES")?.description === "Craft topicals from Washington.",
    "mission_statement wins over about + philosophy, whitespace-normalized",
  );
  ok(
    byName.get("Fair-Winds, LLC.")?.logoUrl === "https://x.supabase.co/storage/v1/object/public/media/fw.png",
    "normalized legal_name matches punctuation drift (Fair-Winds, LLC.)",
  );
  ok(
    byName.get("Fair-Winds, LLC.")?.description === "Plant-powered wellness.",
    "about fills in when mission_statement is empty",
  );
  ok(
    byName.get("Philosophy Only Farms")?.description ===
      "Small-batch, sun-grown, single-cultivar.",
    "product_philosophy is the final fallback when mission + about are blank",
  );
  ok(byName.get("2727")?.logoUrl === null, "alias match without a logo stays null (placeholder)");
  ok(byName.get("2727")?.description === "Bold concentrates.", "alias match carries the description");
  ok(
    byName.get("Mystery Farms")?.logoUrl === null && byName.get("Mystery Farms")?.description === null,
    "unmatched vendor degrades honestly to nulls (placeholder card unchanged)",
  );
  ok(enriched.length === entries.length && enriched[0].productCount === entries[0].productCount,
    "enrichment never adds/drops/reorders entries or touches counts");
  // Blank profile names never match blank-ish entries.
  const blankSafe = enrichVendorDirectory(
    [{ name: "Real", slug: "real", productCount: 1 }],
    [{ display_name: "", logoUrl: "https://x/no.png" }],
  );
  ok(blankSafe[0].logoUrl === null, "blank profile display_name never forms a match key");

  console.log(`vendor-directory-core: ${passed} assertions passed`);
}
