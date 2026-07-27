/**
 * src/lib/inventory/vendor-resolve-core.ts
 *
 * PURE helpers behind intake vendor resolution (the "no vendor associated with
 * products" fix). The real failure, verified on the owner's live data: WCIA
 * manifests carry the sender at the DOCUMENT level ("from_license_name":
 * "Seattles Private Reserve", "from_license_number": "417068"), and
 * intake-store matched it against vendors.display_name with a bare `ilike`
 * (case-insensitive EQUALITY — no wildcards). Any spelling drift
 * ("Seattle's" vs "Seattles", "SPR LLC", extra punctuation) — or simply no
 * vendors row yet — left vendor_id NULL, so lots and catalog drafts carried no
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
 * The DB walk (license match → exact ilike → alias → normalized scan →
 * auto-create DRAFT vendor) lives in intake-store.resolveOrCreateVendor; this
 * module stays pure so every decision is unit-testable.
 *
 * Self-tested below (registered in scripts/compliance/run-pure-selftests.ts)
 * and mirrored in vitest (tests/compliance/vendor-resolve-core.test.ts).
 */

/**
 * Normalize a vendor label to a comparison key: lowercase, "&" → "and",
 * apostrophes DROPPED (so "Seattle's" === "Seattles"), every other
 * non-alphanumeric run collapsed to a single space, trimmed. Empty/null → "".
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
 * SLICE 66 (owner D1 — "CERES - 435011" on every card): strip a trailing
 * license-number decoration from a vendor/brand label. "CERES - 435011" →
 * "CERES", "CERES (435011)" → "CERES", "CERES 435011" → "CERES".
 * Deliberately conservative:
 *  - the digit run must be 5+ digits (WA licenses are 6; "Farm 2020" and
 *    "Cloud 9" are left alone);
 *  - the remainder must be non-empty and contain a letter (a label that IS a
 *    number, like brand "2727", is never emptied);
 *  - only the END of the label is considered — digits mid-name are kept.
 * Used at intake vendor auto-create (the row is born clean) AND at display
 * time for vendors that predate the fix.
 */
export function stripLicenseSuffix(raw: string | null | undefined): string {
  const label = (raw ?? "").trim();
  if (!label) return "";
  const m = label.match(/^(.*?)(?:\s*[-–—:|,]\s*|\s+)\(?(\d{5,})\)?\s*$/);
  if (!m) return label;
  const remainder = m[1].trim().replace(/[-–—:|,]+$/, "").trim();
  if (!remainder || !/[a-z]/i.test(remainder)) return label;
  return remainder;
}

/**
 * Extract the trailing license number a label carries (the digits
 * stripLicenseSuffix would remove), or null. Lets intake vendor auto-creation
 * land "CERES - 435011"'s license in vendors.license_number even when the
 * manifest document carries none.
 */
export function extractLicenseFromLabel(raw: string | null | undefined): string | null {
  const label = (raw ?? "").trim();
  if (!label) return null;
  const m = label.match(/^(.*?)(?:\s*[-–—:|,]\s*|\s+)\(?(\d{5,})\)?\s*$/);
  if (!m) return null;
  const remainder = m[1].trim().replace(/[-–—:|,]+$/, "").trim();
  if (!remainder || !/[a-z]/i.test(remainder)) return null;
  return m[2];
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

  // normalizeVendorKey — the real-world drift cases.
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

  // stripLicenseSuffix (SLICE 66 D1 — pinned on the owner's real CERES card)
  ok(stripLicenseSuffix("CERES - 435011") === "CERES", "dash-separated license stripped (real data)");
  ok(stripLicenseSuffix("CERES (435011)") === "CERES", "parenthesized license stripped");
  ok(stripLicenseSuffix("CERES 435011") === "CERES", "space-separated license stripped");
  ok(stripLicenseSuffix("2727") === "2727", "all-digit brand kept (never emptied)");
  ok(stripLicenseSuffix("Cloud 9") === "Cloud 9", "short trailing number kept");
  ok(stripLicenseSuffix("Farm 2020") === "Farm 2020", "4-digit year kept (5+ digit floor)");
  ok(stripLicenseSuffix("435011 Farms") === "435011 Farms", "leading digits kept (suffix only)");
  ok(stripLicenseSuffix(null) === "", "null -> empty");

  // extractLicenseFromLabel (SLICE 66 — auto-created vendors keep the license)
  ok(extractLicenseFromLabel("CERES - 435011") === "435011", "license extracted from label");
  ok(extractLicenseFromLabel("CERES") === null, "no license -> null");
  ok(extractLicenseFromLabel("2727") === null, "all-digit label -> null (not a suffix)");
  ok(extractLicenseFromLabel("Farm 2020") === null, "4-digit year -> null");

  if (failed === 0) console.log(`vendor-resolve-core: all ${passed} tests passed`);
  return { passed, failed };
}
