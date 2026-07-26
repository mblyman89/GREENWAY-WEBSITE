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

  console.log(`vendor-directory-core: ${passed} assertions passed`);
}
