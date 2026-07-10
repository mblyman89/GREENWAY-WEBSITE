/**
 * src/lib/vendors/list-state-core.ts — Task E (preserve vendor list filters
 * across detail navigation).
 *
 * PURE helpers (no I/O, no Next runtime) that encode the Vendors & Brands list
 * filter/sort/page state as a query string and back. The list page uses these
 * to (a) carry the active state into each vendor card's detail link, and (b)
 * the detail page uses them to reconstruct a "back" href that returns the owner
 * to the exact same filtered/sorted/paged view.
 *
 * Kept deliberately dependency-free so it lives in the tests/compliance suite.
 */

/** The filter/sort/page keys that define a Vendors list view. */
export const VENDOR_LIST_KEYS = [
  "q",
  "status",
  "scope",
  "active",
  "license",
  "itype",
  "icat",
  "page",
] as const;

export type VendorListKey = (typeof VENDOR_LIST_KEYS)[number];
export type VendorListParams = Partial<Record<VendorListKey, string>>;

/**
 * Keep only recognised list keys with non-empty string values. Ignores
 * `page=1` (the default) so a first-page view produces a clean URL.
 */
export function pickVendorListParams(
  raw: Record<string, string | string[] | undefined> | null | undefined,
): VendorListParams {
  const out: VendorListParams = {};
  if (!raw) return out;
  for (const key of VENDOR_LIST_KEYS) {
    const v = raw[key];
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val !== "string") continue;
    const trimmed = val.trim();
    if (!trimmed) continue;
    if (key === "page" && trimmed === "1") continue;
    out[key] = trimmed;
  }
  return out;
}

/** Serialise picked params to a stable `?a=b&c=d` string (or "" when empty). */
export function vendorListQueryString(params: VendorListParams): string {
  const sp = new URLSearchParams();
  for (const key of VENDOR_LIST_KEYS) {
    const val = params[key];
    if (val) sp.set(key, val);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Build a vendor DETAIL href that carries the current list state, so the detail
 * page can send the owner back to this exact view. The filter state travels in
 * a single opaque `from` param (URL-encoded query string) — this keeps the
 * detail page's own params (error/saved/note) uncluttered and unambiguous.
 */
export function vendorDetailHref(vendorId: string, params: VendorListParams): string {
  const base = `/admin/vendors/${vendorId}`;
  const qs = vendorListQueryString(params);
  if (!qs) return base;
  // qs starts with "?"; carry it (minus the leading "?") as an encoded token.
  return `${base}?from=${encodeURIComponent(qs.slice(1))}`;
}

/**
 * Reconstruct the list "back" href from the detail page's `from` token.
 * Falls back to the bare list page when absent/blank. Defensive: only the
 * recognised keys survive, and the result is always a relative /admin/vendors
 * path (never an absolute or off-site URL).
 */
export function vendorListBackHref(from: string | null | undefined): string {
  const base = "/admin/vendors";
  if (!from) return base;
  let decoded: string;
  try {
    decoded = decodeURIComponent(from);
  } catch {
    return base;
  }
  // Re-pick through the allow-list so a tampered token can't inject junk.
  const parsed = new URLSearchParams(decoded);
  const raw: Record<string, string> = {};
  for (const [k, v] of parsed.entries()) raw[k] = v;
  const clean = pickVendorListParams(raw);
  return `${base}${vendorListQueryString(clean)}`;
}
