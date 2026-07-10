/**
 * src/lib/inventory/po-match-core.ts
 *
 * W5 — suggest-and-confirm matching between an inbound manifest and the
 * purchase order it fulfills. PURE module (no React, no I/O — vitest-testable).
 *
 * Owner decision (Q3): vendors almost never put our PO number on their
 * manifests, so we NEVER auto-link. This module only ranks likely candidates;
 * a human presses "Link" to confirm. The candidate pool is:
 *
 *   - OPEN purchase orders only — sent/partial (the vendor has the order and
 *     may ship against it). Draft/submitted POs haven't reached the vendor, so
 *     a truck can't be fulfilling them; received/cancelled are terminal.
 *   - Same vendor first: a shared vendor_id is the strongest signal; when the
 *     manifest only has a free-text vendor label we fall back to a normalized
 *     name comparison and say so in the reason.
 *
 * Ranking within vendor matches: expected-delivery date closest to the
 * manifest's transfer date wins (ties keep the newest PO first, matching the
 * store's created_at ordering). Every suggestion carries a plain-English
 * reason so the reviewer can sanity-check the machine's thinking.
 */

/** The slice of a purchase order this module needs (subset of PurchaseOrder). */
export type PoMatchCandidate = {
  id: string;
  po_number: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  status: string;
  expected_date: string | null; // YYYY-MM-DD
  subtotal_minor_units: number;
  line_count: number;
};

/** The slice of a manifest this module needs (subset of InboundManifest). */
export type ManifestMatchFacts = {
  vendor_id: string | null;
  vendor_label: string | null;
  transfer_date: string | null; // YYYY-MM-DD
  eta_date: string | null; // YYYY-MM-DD
};

export type PoMatchSuggestion = {
  po: PoMatchCandidate;
  /** Why this PO is suggested — shown verbatim to the reviewer. */
  reason: string;
  /**
   * How the vendor matched: by id (strong), by normalized name (weaker),
   * or not at all (only used when there are zero vendor matches).
   */
  vendorMatch: "id" | "name" | "none";
};

/** Statuses a truck could actually be fulfilling. */
export const LINKABLE_PO_STATUSES = ["sent", "partial"] as const;

/** Lowercase, collapse whitespace, strip punctuation — for name comparison. */
export function normalizeVendorName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Days between two YYYY-MM-DD dates (absolute); null when either is missing/invalid. */
function daysApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(Math.round((ta - tb) / 86400000));
}

/**
 * Rank open POs as candidates for this manifest. Returns at most `limit`
 * suggestions (default 3), best first. Vendor-matched POs always outrank
 * unmatched ones; unmatched POs are only included when the vendor matched
 * nothing at all (so the reviewer still has something to confirm against).
 */
export function suggestPoMatches(
  manifest: ManifestMatchFacts,
  pos: readonly PoMatchCandidate[],
  limit = 3,
): PoMatchSuggestion[] {
  const open = pos.filter((p) => (LINKABLE_PO_STATUSES as readonly string[]).includes(p.status));
  const manifestDate = manifest.transfer_date ?? manifest.eta_date;
  const wantName = normalizeVendorName(manifest.vendor_label);

  const scored = open.map((po) => {
    let vendorMatch: PoMatchSuggestion["vendorMatch"] = "none";
    if (manifest.vendor_id && po.vendor_id && manifest.vendor_id === po.vendor_id) {
      vendorMatch = "id";
    } else if (wantName && normalizeVendorName(po.vendor_name) === wantName) {
      vendorMatch = "name";
    }
    const gap = daysApart(manifestDate, po.expected_date);
    return { po, vendorMatch, gap };
  });

  const vendorMatched = scored.filter((s) => s.vendorMatch !== "none");
  const pool = vendorMatched.length > 0 ? vendorMatched : scored;

  pool.sort((a, b) => {
    // id-match beats name-match beats none.
    const rank = (m: PoMatchSuggestion["vendorMatch"]) => (m === "id" ? 0 : m === "name" ? 1 : 2);
    if (rank(a.vendorMatch) !== rank(b.vendorMatch)) return rank(a.vendorMatch) - rank(b.vendorMatch);
    // Closer expected date wins; unknown gaps sort last.
    const ga = a.gap ?? Number.POSITIVE_INFINITY;
    const gb = b.gap ?? Number.POSITIVE_INFINITY;
    if (ga !== gb) return ga - gb;
    return 0; // stable: keep the store's newest-first order
  });

  return pool.slice(0, limit).map(({ po, vendorMatch, gap }) => {
    const bits: string[] = [];
    if (vendorMatch === "id") bits.push("same vendor");
    else if (vendorMatch === "name") bits.push(`vendor name matches “${po.vendor_name ?? ""}”`);
    else bits.push("no vendor match — check carefully");
    if (gap !== null) {
      bits.push(
        gap === 0
          ? "expected exactly this day"
          : `expected ${gap} day${gap === 1 ? "" : "s"} ${manifestDate && po.expected_date && po.expected_date < manifestDate ? "before" : "from"} this delivery`,
      );
    }
    bits.push(po.status === "partial" ? "partially received already" : "sent to vendor");
    return { po, vendorMatch, reason: bits.join(" · ") };
  });
}

// ---------------------------------------------------------------------------
// Tests (tsx-runnable, house pattern)
// ---------------------------------------------------------------------------
export function __runPoMatchCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL po-match-core: " + msg);
    passed += 1;
  };

  const po = (over: Partial<PoMatchCandidate>): PoMatchCandidate => ({
    id: "p1",
    po_number: "PO-1",
    vendor_id: "v1",
    vendor_name: "Fairwinds",
    status: "sent",
    expected_date: "2026-02-10",
    subtotal_minor_units: 100000,
    line_count: 3,
    ...over,
  });
  const mf = (over: Partial<ManifestMatchFacts>): ManifestMatchFacts => ({
    vendor_id: "v1",
    vendor_label: "Fairwinds",
    transfer_date: "2026-02-10",
    eta_date: null,
    ...over,
  });

  // Only sent/partial are candidates.
  const chain = ["draft", "submitted", "sent", "partial", "received", "cancelled"].map((s, i) =>
    po({ id: `s${i}`, status: s }),
  );
  const fromChain = suggestPoMatches(mf({}), chain, 10);
  assert(fromChain.length === 2, "only sent+partial linkable");
  assert(
    fromChain.every((s) => s.po.status === "sent" || s.po.status === "partial"),
    "statuses right",
  );

  // Vendor id match outranks name match outranks none.
  const ranked = suggestPoMatches(
    mf({ vendor_id: "v1", vendor_label: "Fairwinds" }),
    [
      po({ id: "byname", vendor_id: "other", vendor_name: "FAIRWINDS  ", expected_date: "2026-02-10" }),
      po({ id: "byid", vendor_id: "v1", vendor_name: "Different Label", expected_date: "2026-02-20" }),
    ],
    10,
  );
  assert(ranked[0].po.id === "byid" && ranked[0].vendorMatch === "id", "id match first");
  assert(ranked[1].po.id === "byname" && ranked[1].vendorMatch === "name", "name match second");

  // Within the same match tier, closest expected date wins.
  const dated = suggestPoMatches(
    mf({ transfer_date: "2026-02-10" }),
    [
      po({ id: "far", expected_date: "2026-02-25" }),
      po({ id: "near", expected_date: "2026-02-11" }),
      po({ id: "nodate", expected_date: null }),
    ],
    10,
  );
  assert(dated.map((s) => s.po.id).join(",") === "near,far,nodate", "date proximity ordering");

  // No vendor match at all → still suggest (flagged), so the human can confirm.
  const none = suggestPoMatches(
    mf({ vendor_id: "vX", vendor_label: "Someone Else" }),
    [po({ id: "only", vendor_id: "v1" })],
    10,
  );
  assert(none.length === 1 && none[0].vendorMatch === "none", "unmatched pool fallback");
  assert(none[0].reason.includes("check carefully"), "unmatched reason warns");

  // Vendor-matched POs suppress unmatched ones entirely.
  const mixed = suggestPoMatches(
    mf({}),
    [po({ id: "mine", vendor_id: "v1" }), po({ id: "theirs", vendor_id: "vZ", vendor_name: "Zed" })],
    10,
  );
  assert(mixed.length === 1 && mixed[0].po.id === "mine", "unmatched hidden when matches exist");

  // Limit respected; normalization handles case/punctuation.
  assert(suggestPoMatches(mf({}), chain, 1).length === 1, "limit");
  assert(normalizeVendorName("  Fair-Winds, LLC. ") === "fair winds llc", "normalize");

  return { passed };
}
