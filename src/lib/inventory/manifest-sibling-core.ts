/**
 * src/lib/inventory/manifest-sibling-core.ts  (Fix Phase 3.3, PURE)
 *
 * Owner (Fix 3.3, verbatim): "i think it would be worth adding a button to
 * dismiss duplicate manifests that somehow make it to the table. we should
 * have logic in place to prevent this, so it may need hardening."
 *
 * ROOT CAUSE (the owner's screenshot, three Canna Processing rows): the
 * staging dedupe and the Dismiss button only knew ONE identity - the
 * normalized manifest number + vendor label. The same Canna Processing
 * delivery (invoice INV-1010497, the same 12 GrowFlow lot ids) staged twice:
 *   - "GF41918900002835-1634964-1" / "CANNA PROCESSING" (the CCRS manifest PDF)
 *   - "603353555" / "Canna Processing" (the Transfer Log PDF, whose
 *     "LCB Manifest ID:" prints Greenway's own UBI - fixed in
 *     pdf-transferlog-core transferLogManifestNumber)
 * Different numbers, so neither the dedupe nor the twin finder saw a pair,
 * and the SQL dismiss refused it ("not the same transfer").
 *
 * A SIBLING is the same physical transfer staged under another number. It is
 * recognised only from evidence that cannot be a coincidence between two real
 * deliveries, and always within ONE vendor (the resolved vendor_id):
 *   (a) the same invoice number AND at least one shared lot id - a vendor
 *       never bills two deliveries on one invoice; or
 *   (b) no conflicting invoice (one or both unknown) and the identical set
 *       of lot ids with identical quantities (two or more lines) - a second
 *       real order of the same lots carries its own invoice and practically
 *       never the very same counts on every line.
 * A shared lot id alone is NOT enough: a Cultivera lot id is the vendor's
 * inventory lot and legitimately repeats across separate orders.
 *
 * The SQL twin (migration 0321 dismiss_duplicate_manifest) applies the same
 * two rules under row locks; this core is what the table, the staging dedupe
 * and the tests use.
 */

import { compareOldestFirst, isBlockingStatus } from "./manifest-dedupe-core";

export type SiblingLot = { lot: string | null; qty: number | null };

export type SiblingCandidate = {
  id: string;
  status: string | null;
  created_at?: string | null;
  vendor_id: string | null;
  /** invoice_number_override ?? invoice_number_detected. */
  invoice: string | null;
  lots: readonly SiblingLot[];
};

export type SiblingEvidence = { kind: "invoice"; invoice: string; sharedLots: number } | { kind: "lots"; lots: number };

/** "INV-1010497" / " inv 1010497 " -> "INV1010497"; null when blank. PURE. */
export function normInvoice(v: string | null | undefined): string | null {
  const k = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return k.length >= 3 ? k : null;
}

/** Lot id key (whitespace dropped, upper case); null when blank. PURE. */
export function normLot(v: string | null | undefined): string | null {
  const k = String(v ?? "").replace(/\s+/g, "").toUpperCase();
  return k.length >= 6 ? k : null;
}

function lotMap(lots: readonly SiblingLot[]): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const l of lots) {
    const k = normLot(l.lot);
    if (!k) continue;
    const q = typeof l.qty === "number" && Number.isFinite(l.qty) ? l.qty : null;
    // A lot listed twice: sum (a split line), null wins (unknown).
    if (m.has(k)) {
      const prev = m.get(k) ?? null;
      m.set(k, prev === null || q === null ? null : prev + q);
    } else m.set(k, q);
  }
  return m;
}

/**
 * Why two deliveries of ONE vendor are the same transfer, or null. PURE.
 * Never true across vendors, never true for a vendor-less row.
 */
export function siblingEvidence(
  a: Pick<SiblingCandidate, "vendor_id" | "invoice" | "lots">,
  b: Pick<SiblingCandidate, "vendor_id" | "invoice" | "lots">,
): SiblingEvidence | null {
  if (!a.vendor_id || !b.vendor_id || a.vendor_id !== b.vendor_id) return null;
  const la = lotMap(a.lots);
  const lb = lotMap(b.lots);
  if (la.size === 0 || lb.size === 0) return null;
  let shared = 0;
  for (const k of la.keys()) if (lb.has(k)) shared += 1;
  if (shared === 0) return null;
  const ia = normInvoice(a.invoice);
  const ib = normInvoice(b.invoice);
  if (ia && ib && ia === ib) return { kind: "invoice", invoice: ia, sharedLots: shared };
  // Two DIFFERENT printed invoices are two orders - whatever the lots say.
  if (ia && ib) return null;
  if (la.size >= 2 && la.size === lb.size && shared === la.size) {
    for (const [k, q] of la) {
      const q2 = lb.get(k);
      if (q === null || q2 === null || q2 === undefined || q !== q2) return null;
    }
    return { kind: "lots", lots: la.size };
  }
  return null;
}

/** Plain-English evidence for the timeline / the Dismiss button. PURE. */
export function describeSiblingEvidence(e: SiblingEvidence): string {
  return e.kind === "invoice"
    ? `same vendor, same invoice ${e.invoice} and ${e.sharedLots} shared lot id${e.sharedLots === 1 ? "" : "s"}`
    : `same vendor and the identical ${e.lots} lot ids with identical quantities`;
}

/**
 * Staging: the OLDEST live delivery the new one is a sibling of, or null.
 * PURE. `incoming` is the manifest about to stage (vendor resolved).
 */
export function findLiveSibling(
  incoming: Pick<SiblingCandidate, "vendor_id" | "invoice" | "lots">,
  candidates: readonly SiblingCandidate[],
): { id: string; evidence: SiblingEvidence } | null {
  let best: { row: SiblingCandidate; evidence: SiblingEvidence } | null = null;
  for (const c of candidates) {
    if (!isBlockingStatus(c.status)) continue;
    const e = siblingEvidence(incoming, c);
    if (!e) continue;
    if (!best || compareOldestFirst(c, best.row) < 0) best = { row: c, evidence: e };
  }
  return best ? { id: best.row.id, evidence: best.evidence } : null;
}

const DISMISSABLE = new Set(["pending", "in_transit", "received", "rejected"]);

/**
 * The table: for each DISMISSABLE row that is a sibling of a LIVE row, the
 * row to keep (the OLDEST live sibling other than itself). PURE.
 * Mirrors inbound-dedupe-core findDuplicateTwins for the number identity.
 */
export function findSiblingTwins(rows: readonly SiblingCandidate[]): Map<string, string> {
  const usable = rows.filter((r) => (r.status ?? "").trim().toLowerCase() !== "dismissed");
  const out = new Map<string, string>();
  for (const r of usable) {
    if (!DISMISSABLE.has((r.status ?? "").trim().toLowerCase())) continue;
    let keep: SiblingCandidate | null = null;
    for (const o of usable) {
      if (o.id === r.id || !isBlockingStatus(o.status)) continue;
      if (!siblingEvidence(r, o)) continue;
      if (!keep || compareOldestFirst(o, keep) < 0) keep = o;
    }
    if (keep) out.set(r.id, keep.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vendor-label guard (Fix 3.3): a field LABEL is never a vendor name.
// ---------------------------------------------------------------------------
//
// The owner's table showed a delivery whose vendor read "Manifest ID" - a
// document label captured as the vendor by a reader. A label staged as the
// vendor creates a junk vendor and defeats the vendor-scoped dedupe.

const LABEL_WORDS = new Set(
  (
    "manifest id number no license licensee name ubi invoice order date transfer log origin destination " +
    "phone email address vendor supplier from to ship bill sold by of the lcb ccrs wcia transporter driver " +
    "vehicle plate page total sub tax qty quantity product strain lot inventory id# # : - batch sample"
  ).split(" "),
);

/** True when the text is a document field label (or blank), never a business name. PURE. */
export function isLabelLikeVendor(label: string | null | undefined): boolean {
  const t = String(label ?? "").trim();
  if (t.length < 2) return true;
  if (/:\s*$/.test(t)) return true;
  if (/^\d[\d\s-]*$/.test(t)) return true; // a number is not a name
  const words = t.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim().split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => LABEL_WORDS.has(w));
}

/** The vendor label to stage: null when it is a field label. PURE. */
export function cleanVendorLabel(label: string | null | undefined): string | null {
  const t = String(label ?? "").replace(/\s+/g, " ").trim();
  return t && !isLabelLikeVendor(t) ? t : null;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runManifestSiblingTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL manifest-sibling: ${m}`);
    }
  };
  const lots = (n: number, q = 50): SiblingLot[] =>
    Array.from({ length: n }, (_, i) => ({ lot: `GF4191890556698${i}`, qty: q }));
  const v = "vendor-canna";
  const gf: SiblingCandidate = { id: "gf", status: "pending", created_at: "2026-10-26T19:10:00Z", vendor_id: v, invoice: "INV-1010497", lots: lots(12) };
  const ubi: SiblingCandidate = { id: "ubi", status: "in_transit", created_at: "2026-10-29T12:10:00Z", vendor_id: v, invoice: "INV-1010497", lots: lots(12) };
  ok(siblingEvidence(gf, ubi)?.kind === "invoice", "same invoice + shared lots -> sibling");
  ok(siblingEvidence({ ...gf, vendor_id: "other" }, ubi) === null, "other vendor -> never");
  ok(siblingEvidence({ ...gf, vendor_id: null }, { ...ubi, vendor_id: null }) === null, "vendor-less -> never");
  ok(siblingEvidence({ ...gf, invoice: null }, { ...ubi, invoice: null })?.kind === "lots", "identical lots + qtys -> sibling");
  ok(siblingEvidence({ ...gf, invoice: null }, { ...ubi, invoice: null, lots: lots(12, 40) }) === null, "same lots, other quantities -> a real second order");
  ok(siblingEvidence({ ...gf, invoice: "INV-1001" }, { ...ubi, invoice: "INV-1002", lots: lots(12) }) === null, "two invoices, same lots -> not a sibling (only same counts with no invoice)");
  ok(siblingEvidence({ ...gf, invoice: null, lots: lots(1) }, { ...ubi, invoice: null, lots: lots(1) }) === null, "one shared lot alone -> never");
  ok(siblingEvidence({ ...gf, invoice: null }, { ...ubi, invoice: null, lots: lots(11) }) === null, "a subset is not identical");
  ok(normInvoice(" inv-1010497 ") === normInvoice("INV1010497"), "invoice normalised");
  const twins = findSiblingTwins([gf, ubi]);
  ok(twins.get("ubi") === "gf" && twins.get("gf") === "ubi", "each row offers Dismiss pointing at the other (owner chooses)");
  ok(findSiblingTwins([gf, { ...ubi, status: "dismissed" }]).size === 0, "dismissed rows never take part");
  ok(findSiblingTwins([{ ...gf, status: "accepted" }, ubi]).get("ubi") === "gf" && !findSiblingTwins([{ ...gf, status: "accepted" }, ubi]).has("gf"), "an accepted row is kept, never dismissed");
  ok(findLiveSibling(ubi, [gf])?.id === "gf", "staging finds the live sibling");
  ok(findLiveSibling(ubi, [{ ...gf, status: "rejected" }]) === null, "a rejected row does not block");
  ok(isLabelLikeVendor("Manifest ID") && isLabelLikeVendor("Licensee Name:") && isLabelLikeVendor("") && isLabelLikeVendor("603353555"), "labels refused");
  ok(!isLabelLikeVendor("Canna Processing") && !isLabelLikeVendor("PASTIME BRANDS LLC") && !isLabelLikeVendor("Svin Garden"), "names kept");
  ok(cleanVendorLabel("  Manifest ID ") === null && cleanVendorLabel(" Canna  Processing ") === "Canna Processing", "cleanVendorLabel");
  return { passed, failed };
}
