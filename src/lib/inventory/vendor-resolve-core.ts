/**
 * src/lib/inventory/vendor-resolve-core.ts
 *
 * PURE helpers behind intake vendor resolution (the "no vendor associated with
 * products" fix). The real failure, verified on the owner's live data: WCIA
 * manifests carry the sender at the DOCUMENT level ("from_license_name":
 * "Seattles Private Reserve", "from_license_number": "417068"), and
 * intake-store matched it against vendors.display_name with a bare `ilike`
 * (case-insensitive EQUALITY \u2014 no wildcards). Any spelling drift
 * ("Seattle's" vs "Seattles", "SPR LLC", extra punctuation) \u2014 or simply no
 * vendors row yet \u2014 left vendor_id NULL, so lots and catalog drafts carried no
 * vendor and the vendor-axis product mastering had nothing to group on.
 *
 * This core provides:
 *   - normalizeVendorKey: punctuation/spacing/case-insensitive name identity
 *     ("Seattle's  Private-Reserve" === "seattles private reserve").
 *   - normalizeLicense: WA license numbers compared digits-only.
 *   - pickVendorByNormalizedName: match a manifest label against candidate
 *     vendor rows by normalized display_name / dba / legal_name.
 *   - vendorSlugCandidate: deterministic slug for the auto-created vendor row
 *     (same rules as vendors/import slugifyName, re-stated here because that
 *     module is server-only).
 *
 * The DB walk (license match \u2192 exact ilike \u2192 alias \u2192 normalized scan \u2192
 * auto-create DRAFT vendor) lives in intake-store.resolveOrCreateVendor; this
 * module stays pure so every decision is unit-testable.
 *
 * Self-tested below (registered in scripts/compliance/run-pure-selftests.ts)
 * and mirrored in vitest (tests/compliance/vendor-resolve-core.test.ts).
 */

/**
 * Normalize a vendor label to a comparison key: lowercase, "&" \u2192 "and",
 * apostrophes DROPPED (so "Seattle's" === "Seattles"), every other
 * non-alphanumeric run collapsed to a single space, trimmed. Empty/null \u2192 "".
 */
export function normalizeVendorKey(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019\u2018]/g, "") // apostrophes vanish, they don't split words
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a WA license number for comparison: digits only, or null. */
export function normalizeLicense(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D+/g, "");
  return digits.length >= 4 ? digits : null;
}

/** A candidate vendor row for normalized-name matching. */
export type VendorNameCandidate = {
  id: string;
  display_name: string | null;
  dba?: string | null;
  legal_name?: string | null;
};

/**
 * Pick the vendor whose display_name / dba / legal_name normalizes to the same
 * key as the manifest label. Returns the FIRST match (callers pass rows in a
 * stable order) or null. A blank label never matches anything.
 */
export function pickVendorByNormalizedName(
  label: string | null | undefined,
  candidates: readonly VendorNameCandidate[],
): VendorNameCandidate | null {
  const key = normalizeVendorKey(label);
  if (!key) return null;
  for (const c of candidates) {
    if (
      normalizeVendorKey(c.display_name) === key ||
      normalizeVendorKey(c.dba) === key ||
      normalizeVendorKey(c.legal_name) === key
    ) {
      return c;
    }
  }
  return null;
}

/**
 * Deterministic slug for an auto-created vendor (mirrors vendors/import
 * slugifyName, which is server-only and can't be imported here). intake-store
 * appends a short suffix on a rare collision.
 */
export function vendorSlugCandidate(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Embedded self-tests (pure; run by scripts/compliance/run-pure-selftests.ts
// and mirrored in vitest).
// ---------------------------------------------------------------------------
export function __runVendorResolveCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // normalizeVendorKey \u2014 the real-world drift cases.
  ok(
    normalizeVendorKey("Seattle's Private Reserve") === normalizeVendorKey("Seattles Private Reserve"),
    "apostrophe drift matches",
  );
  ok(
    normalizeVendorKey("  SEATTLES   PRIVATE-RESERVE ") === "seattles private reserve",
    "case/spacing/punctuation collapse",
  );
  ok(normalizeVendorKey("A & B Farms") === "a and b farms", "& becomes and");
  ok(normalizeVendorKey(null) === "", "null -> empty");
  ok(normalizeVendorKey("   ") === "", "blank -> empty");

  // normalizeLicense
  ok(normalizeLicense(" 417068 ") === "417068", "license trims");
  ok(normalizeLicense("Lic #417068") === "417068", "license strips non-digits");
  ok(normalizeLicense("12") === null, "too-short license rejected");
  ok(normalizeLicense(null) === null, "null license -> null");

  // pickVendorByNormalizedName
  const rows: VendorNameCandidate[] = [
    { id: "v1", display_name: "Fine Detail Greenway" },
    { id: "v2", display_name: "Seattle's Private Reserve", dba: "SPR" },
    { id: "v3", display_name: "Other Farm", legal_name: "Other Farm LLC" },
  ];
  ok(pickVendorByNormalizedName("Seattles Private Reserve", rows)?.id === "v2", "display_name normalized match");
  ok(pickVendorByNormalizedName("spr", rows)?.id === "v2", "dba normalized match");
  ok(pickVendorByNormalizedName("other farm llc", rows)?.id === "v3", "legal_name normalized match");
  ok(pickVendorByNormalizedName("No Such Vendor", rows) === null, "no match -> null");
  ok(pickVendorByNormalizedName("", rows) === null, "blank label never matches");

  // vendorSlugCandidate
  ok(vendorSlugCandidate("Seattles Private Reserve") === "seattles-private-reserve", "slug basic");
  ok(vendorSlugCandidate("A & B Farms!") === "a-and-b-farms", "slug & + punctuation");

  if (failed === 0) console.log(`vendor-resolve-core: all ${passed} tests passed`);
  return { passed, failed };
}
