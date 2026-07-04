/**
 * src/lib/discovery/reconcile.ts
 *
 * Pure, dependency-free helpers for reconciling a discovery VENDOR lead against
 * the vendors we already buy from. Kept pure (no DB, no server-only) so it is
 * easy to unit-test and reuse from the store, the importer, and tests.
 *
 * STANDING RULE — never guess: we only claim an "existing" (confident) match on
 * a normalized LICENSE NUMBER equality. A normalized-name equality is only ever
 * a "possible" match that a human confirms. Everything else is "unmatched".
 */

export type MatchState = "unmatched" | "possible" | "existing";

/** Minimal shape of an existing vendor needed for matching. */
export type VendorMatchCandidate = {
  id: string;
  display_name: string | null;
  legal_name: string | null;
  license_number: string | null;
};

/** Minimal shape of a lead needed for matching. */
export type VendorLeadKey = {
  legal_name?: string | null;
  display_name?: string | null;
  license_number?: string | null;
};

/**
 * Normalize a WA cannabis license number for comparison: keep only digits and
 * uppercase letters. WA numbers look like "412345" or contain separators in
 * some exports; stripping non-alphanumerics makes equality robust.
 */
export function normalizeLicense(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

/**
 * Normalize a business name for comparison: lowercase, strip common company
 * suffixes and punctuation, collapse whitespace. Intentionally conservative —
 * a name equality is only ever a "possible" match, never auto-merged.
 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.toLowerCase();
  s = s.replace(/[.,''"`]/g, " ");
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9\s-]/g, " ");
  // drop common legal/business suffixes
  s = s.replace(/\b(llc|inc|incorporated|co|corp|corporation|ltd|limited|company|holdings|group|farms?|gardens?|cannabis|marijuana)\b/g, " ");
  s = s.replace(/[-\s]+/g, " ").trim();
  return s;
}

/** Slug used for a dedupe key when there's no license number. */
export function slugifyName(raw: string | null | undefined): string {
  const n = normalizeName(raw);
  return n.replace(/\s+/g, "-");
}

/**
 * Build the unique dedupe key for a vendor lead: prefer a normalized license
 * number (namespaced), else a name slug. Empty string means "no stable key" —
 * callers should treat that as always-insert (can't dedupe without a key).
 */
export function vendorLeadDedupeKey(lead: VendorLeadKey): string {
  const lic = normalizeLicense(lead.license_number);
  if (lic) return `lic:${lic}`;
  const slug = slugifyName(lead.legal_name || lead.display_name);
  return slug ? `name:${slug}` : "";
}

/** Dedupe key for a product lead: brand+name (+pack) slug. */
export function productLeadDedupeKey(input: {
  product_name?: string | null;
  brand?: string | null;
  pack_size?: string | null;
}): string {
  const parts = [input.brand, input.product_name, input.pack_size]
    .map((p) => normalizeName(p))
    .filter(Boolean);
  const slug = parts.join("|").replace(/\s+/g, "-");
  return slug ? `prod:${slug}` : "";
}

/**
 * Match a lead against the existing vendor universe.
 *   - License-number equality → "existing" (confident).
 *   - Otherwise normalized-name equality → "possible" (needs human confirm).
 *   - Otherwise → "unmatched" (a genuinely new prospect).
 * Returns the matched vendor id (or null) and the match state.
 */
export function matchVendorLead(
  lead: VendorLeadKey,
  vendors: VendorMatchCandidate[],
): { matchedVendorId: string | null; matchState: MatchState } {
  const leadLic = normalizeLicense(lead.license_number);
  if (leadLic) {
    const byLic = vendors.find((v) => normalizeLicense(v.license_number) === leadLic);
    if (byLic) return { matchedVendorId: byLic.id, matchState: "existing" };
  }

  const leadName = normalizeName(lead.legal_name || lead.display_name);
  if (leadName) {
    const byName = vendors.find(
      (v) => normalizeName(v.legal_name) === leadName || normalizeName(v.display_name) === leadName,
    );
    if (byName) return { matchedVendorId: byName.id, matchState: "possible" };
  }

  return { matchedVendorId: null, matchState: "unmatched" };
}
