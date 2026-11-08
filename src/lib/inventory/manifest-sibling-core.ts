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
  /** D215: the printed manifest / transfer number (optional for older callers). */
  number?: string | null;
};

export type SiblingEvidence =
  | { kind: "invoice"; invoice: string; sharedLots: number }
  | { kind: "lots"; lots: number }
  /** D215: same manifest # from the same vendor record, whatever the vendor NAME reads. */
  | { kind: "number_vendor"; number: string }
  /** D215: same manifest # and the identical lots + quantities, whatever the vendor reads. */
  | { kind: "number_lots"; number: string; lots: number };

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

/** D215: manifest # key (whitespace dropped, upper case); null when blank or too short to mean anything. PURE. */
export function normManifestNumber(v: string | null | undefined): string | null {
  const k = String(v ?? "").replace(/\s+/g, "").toUpperCase();
  return k.length >= 4 ? k : null;
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
  a: Pick<SiblingCandidate, "vendor_id" | "invoice" | "lots" | "number">,
  b: Pick<SiblingCandidate, "vendor_id" | "invoice" | "lots" | "number">,
): SiblingEvidence | null {
  const la = lotMap(a.lots);
  const lb = lotMap(b.lots);
  // D215 (owner: Green Revolution order 69055 staged twice - once as "Green
  // Revolution", once as "Green Revolution Vehicle ID", and the two rows also
  // printed different "invoice" numbers: the order # 69055 vs invoice
  // 0000069638). The SAME manifest # is the same transfer when either the
  // vendor RECORD is the same (the name is just read differently) or every
  // lot and quantity is identical. A vendor never reuses its own manifest #
  // for a second transfer.
  const na = normManifestNumber(a.number);
  if (na && na === normManifestNumber(b.number)) {
    if (a.vendor_id && b.vendor_id && a.vendor_id === b.vendor_id) return { kind: "number_vendor", number: na };
    const n = identicalLotCount(la, lb);
    if (n > 0) return { kind: "number_lots", number: na, lots: n };
  }
  if (!a.vendor_id || !b.vendor_id || a.vendor_id !== b.vendor_id) return null;
  if (la.size === 0 || lb.size === 0) return null;
  let shared = 0;
  for (const k of la.keys()) if (lb.has(k)) shared += 1;
  if (shared === 0) return null;
  const ia = normInvoice(a.invoice);
  const ib = normInvoice(b.invoice);
  if (ia && ib && ia === ib) return { kind: "invoice", invoice: ia, sharedLots: shared };
  // Two DIFFERENT printed invoices are two orders - whatever the lots say.
  if (ia && ib) return null;
  const n = identicalLotCount(la, lb);
  return n > 0 ? { kind: "lots", lots: n } : null;
}

/** 2+ lots, the same set, the same quantity on every lot: the count; else 0. PURE. */
function identicalLotCount(la: Map<string, number | null>, lb: Map<string, number | null>): number {
  if (la.size < 2 || la.size !== lb.size) return 0;
  for (const [k, q] of la) {
    if (!lb.has(k)) return 0;
    const q2 = lb.get(k);
    if (q === null || q2 === null || q2 === undefined || q !== q2) return 0;
  }
  return la.size;
}

/** Plain-English evidence for the timeline / the Dismiss button. PURE. */
export function describeSiblingEvidence(e: SiblingEvidence): string {
  if (e.kind === "number_vendor") return `same manifest # ${e.number} from the same vendor (the vendor name was read differently)`;
  if (e.kind === "number_lots") return `same manifest # ${e.number} and the identical ${e.lots} lot ids with identical quantities`;
  return e.kind === "invoice"
    ? `same vendor, same invoice ${e.invoice} and ${e.sharedLots} shared lot id${e.sharedLots === 1 ? "" : "s"}`
    : `same vendor and the identical ${e.lots} lot ids with identical quantities`;
}

/**
 * Staging: the OLDEST live delivery the new one is a sibling of, or null.
 * PURE. `incoming` is the manifest about to stage (vendor resolved).
 */
export function findLiveSibling(
  incoming: Pick<SiblingCandidate, "vendor_id" | "invoice" | "lots" | "number">,
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

/**
 * D215 - a SHIPPING-FORM label glued onto a vendor name. The owner's Green
 * Revolution delivery was staged as "Green Revolution Vehicle ID": the reader
 * ran on into the transport block of the manifest. That name then failed the
 * vendor-scoped dedupe (same manifest #, "different" vendor) and the same
 * email staged twice. Everything from the first transport label on is cut:
 * "Vehicle", "VIN", "Driver", "Transporter", "License Plate", "Plate #",
 * "Est. Departure/Arrival", "Departure", "Arrival". The label must follow a
 * space, so a name that merely starts with such letters ("PLATEAU GROWERS")
 * or with such a word ("Driver Farms") is kept.
 */
const SHIPPING_LABEL_TAIL =
  /\s+(?:vehicle|vin|driver|drivers|transporter|transport|license\s+plate|plate\s*(?:#|no\b|number\b)|est\.?\s*(?:departure|arrival)|departure|arrival)\b.*$/i;

/** The name with any shipping-form label tail cut off (unchanged when there is none). PURE. */
export function stripShippingFormLabels(label: string | null | undefined): string {
  const t = String(label ?? "").replace(/\s+/g, " ").trim();
  return t.replace(SHIPPING_LABEL_TAIL, "").replace(/[\s,:;#.-]+$/, "").trim();
}

/** True when the name carries a shipping-form label tail ("Green Revolution Vehicle ID"). PURE. */
export function hasShippingFormLabel(label: string | null | undefined): boolean {
  const t = String(label ?? "").replace(/\s+/g, " ").trim();
  return t.length > 0 && stripShippingFormLabels(t) !== t;
}

/** The vendor label to stage: null when it is a field label; a shipping-form tail is cut (D215). PURE. */
export function cleanVendorLabel(label: string | null | undefined): string | null {
  const t = stripShippingFormLabels(label);
  return t && !isLabelLikeVendor(t) ? t : null;
}


/**
 * Fix Phase 3.4 (F-04-24): the vendor's name read from ANY document text, by
 * the labels vendors print: "Sold By: NAME #license" (OpenTHC), "Invoice
 * From: NAME <address>" (GrowFlow), "Licensee Name: NAME", "Vendor: NAME",
 * "Seller: NAME". Owner, verbatim: "i want the system to keep trying to find
 * the name of the vendor for that manifest. its in the email and in every one
 * of the pdfs ... no exceptions." A label is never returned. PURE.
 */
export function vendorNameFromText(text: string | null | undefined): string | null {
  const t = String(text ?? "").replace(/\*\*|\|/g, " ").replace(/\s+/g, " ");
  const pats: RegExp[] = [
    /Sold\s+By\s*:\s*([A-Za-z0-9][A-Za-z0-9&.,'()\- ]{2,80}?)\s*(?:#\s*\d{5,}|Address:|License|Ph(?:one)?:|\d{3,}\s)/i,
    /Invoice\s+From\s*:\s*([A-Za-z][A-Za-z0-9&.,'()\- ]{2,80}?)\s+\d{2,6}\s/i,
    /(?:Licensee|Business|Company|Vendor|Seller|Supplier|Shipper)\s+Name\s*:\s*([A-Za-z][A-Za-z0-9&.,'()\- ]{2,80}?)\s+(?:Licen[cs]e|UBI|Address|Phone|Ph:|Date|#|\d{4,})/i,
    /\b(?:Vendor|Seller|Supplier)\s*:\s*([A-Za-z][A-Za-z0-9&.,'()\- ]{2,80}?)\s+(?:Licen[cs]e|UBI|Address|Phone|Ph:|Date|#|\d{4,})/i,
  ];
  for (const re of pats) {
    const m = t.match(re);
    const v = cleanVendorLabel(m?.[1]?.replace(/[\s,.-]+$/, ""));
    if (v && !/greenway/i.test(v)) return v;
  }
  return null;
}

/** The display name in an email From header ("Canna Processing <x@y.com>"); never a bare address. PURE. */
export function senderDisplayName(from: string | null | undefined): string | null {
  const m = String(from ?? "").match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  const v = cleanVendorLabel(m?.[1]);
  return v && !/@/.test(v) && !/greenway|no-?reply|gmail|outlook|mailer/i.test(v) ? v : null;
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
  ok(vendorNameFromText("Invoice #01M6 24SC 4JCC B917 Sold By: BELLEVUE CANNABIS COMPANY #412692 Address: 13300 SE") === "BELLEVUE CANNABIS COMPANY", "Sold By (OpenTHC)");
  ok(vendorNameFromText("Date: 06/09/2026 Invoice From: Canna Processing 2835 Ocean Ave Ste B Raymond") === "Canna Processing", "Invoice From (GrowFlow)");
  ok(vendorNameFromText("Licensee Name: Manifest ID 1575241667413695") === null, "a label is never the vendor");
  ok(senderDisplayName("Canna Processing <legit.invoice@gmail.com>") === "Canna Processing" && senderDisplayName("x@y.com") === null, "sender display name");
  // D215: the same manifest # is the same transfer when the vendor RECORD matches or the lots are identical.
  const gr = (o: Partial<SiblingCandidate>): SiblingCandidate => ({ id: "x", status: "accepted", vendor_id: "v-gr", invoice: "0000069638", lots: lots(10, 15), number: "11025403383270277", ...o });
  ok(siblingEvidence(gr({}), gr({ id: "y", invoice: "69055" }))?.kind === "number_vendor", "D215: same # + same vendor record, conflicting invoice #s -> duplicate");
  ok(siblingEvidence(gr({}), gr({ id: "y", vendor_id: "junk", invoice: "69055" }))?.kind === "number_lots", "D215: same # + identical lots, other vendor record -> duplicate");
  ok(siblingEvidence(gr({}), gr({ id: "y", vendor_id: "junk", lots: lots(10, 14) })) === null, "D215: same # but other vendor and other counts -> not a duplicate");
  ok(siblingEvidence(gr({}), gr({ id: "y", number: " 1102 5403 3832 70277 " }))?.kind === "number_vendor", "D215: manifest # compared without spaces");
  ok(siblingEvidence(gr({ number: "12" }), gr({ id: "y", number: "12", invoice: "1" , vendor_id: "v-gr", lots: lots(1) }))?.kind !== "number_vendor", "D215: a 2-char # is never an identity");
  ok(findLiveSibling(gr({ id: "new", status: "pending", invoice: "69055" }), [gr({})])?.id === "x", "D215: staging blocks the second copy");
  ok(findSiblingTwins([gr({}), gr({ id: "copy", status: "in_transit", invoice: "69055", created_at: "2026-11-08T03:37:46Z" })]).get("copy") === "x", "D215: the copy offers Dismiss pointing at the accepted delivery");
  ok(describeSiblingEvidence({ kind: "number_vendor", number: "N1" }).includes("same manifest # N1"), "D215: plain-English evidence");
  // D215: a shipping-form label is never part of a vendor name.
  ok(cleanVendorLabel("Green Revolution Vehicle ID") === "Green Revolution", "D215: 'Vehicle ID' tail cut");
  ok(cleanVendorLabel("Green Revolution Vehicle ID: 4471 Ford Transit") === "Green Revolution", "D215: tail with its value cut");
  ok(cleanVendorLabel("Canna Processing Driver Name: Bob") === "Canna Processing" && cleanVendorLabel("Xtracted Labs VIN 1FT") === "Xtracted Labs", "D215: Driver / VIN tails cut");
  ok(cleanVendorLabel("Acme Farms Transporter Name") === "Acme Farms" && cleanVendorLabel("Acme Farms License Plate ABC123") === "Acme Farms", "D215: Transporter / License Plate tails cut");
  ok(cleanVendorLabel("PLATEAU GROWERS") === "PLATEAU GROWERS" && cleanVendorLabel("Driver Farms") === "Driver Farms", "D215: real names that start with those letters/words kept");
  ok(cleanVendorLabel("Vehicle ID") === null && cleanVendorLabel("Driver Name:") === null, "D215: a bare shipping label is still no vendor");
  ok(hasShippingFormLabel("Green Revolution Vehicle ID") && !hasShippingFormLabel("Green Revolution"), "D215: hasShippingFormLabel");
  return { passed, failed };
}
