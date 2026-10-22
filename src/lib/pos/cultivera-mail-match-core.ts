/**
 * src/lib/pos/cultivera-mail-match-core.ts — R74 S6 (PURE).
 *
 * Owner (R74 round 2, #5): "Whatever Cultivera doesn't find, the email will. I'm hoping the 148
 * will be found by the email and sent properly through onboarding. But for ones the email can't
 * find either, yes flag them in one unmatched Cultivera stock manifest."
 *
 * Input: the Cultivera lots the crawler's transfer match could NOT place (one per barcode), and
 * the vendor documents the stephen@ harvest (S5) read and parsed with the existing parsers
 * (parseVendorJson for WCIA JSON, the CCRS CSV and PDF manifest parsers), as ParsedManifest.
 *
 * Rule (evidence only, never guess):
 *   A "receipt" of a lot in email = a document line whose lot_code (WCIA inventory_id, the CCRS
 *   barcode) equals the lot's barcode, with received quantity > 0.
 *   - Documents that are the same transfer (same manifest number + same vendor license / name)
 *     are ONE manifest, even when it was emailed twice or forwarded.
 *   - receipts on exactly one manifest       -> that manifest     ("email")
 *   - receipts on two or more manifests      -> NOT placed        ("several_manifests"), listed
 *                                               with the candidates for the owner. These lots
 *                                               usually have no received time, so there is no
 *                                               evidence for choosing one.
 *   - no receipt                             -> the ONE "Unmatched Cultivera stock" manifest.
 *   Barcodes are state-issued and unique, so the email's vendor name is NOT required to equal
 *   Cultivera's (a license's legal name rarely matches the display name). Whether they agree is
 *   reported per lot.
 *   Document lines whose barcode is not one of these lots (sold out, or already placed by the
 *   crawler) are counted, never turned into lots (owner: only stock on hand is migrated).
 *
 * Manifest wins on name, type and cost (owner #3): each placed lot carries its document line's
 * product name, inventory type and unit cost, for the Wave 3 survivorship step. Cultivera keeps
 * category and quantity, so the lot's units are NOT taken from the email.
 *
 * Reads nothing, writes nothing. Money in cents (unit_cost_minor_units, as the parser gives it).
 */

import type { ParsedManifest } from "@/lib/inventory/intake-parser";
import { cultiveraVendorKey, RECONSTRUCTED_MANIFEST_KIND, RECONSTRUCTED_NUMBER_PREFIX, type CultiveraGroupRow } from "@/lib/inventory/cultivera-manifest-group-core";
import type { LotTransferDecision } from "@/lib/inventory/cultivera-transfer-match-core";

/* ------------------------------------------------------------------ *
 *  Shapes
 * ------------------------------------------------------------------ */

export const MAIL_MATCH_RULE_VERSION = 1;
/** The one manifest for stock neither Cultivera nor email can place (owner #5). */
export const UNMATCHED_MANIFEST_NUMBER = `${RECONSTRUCTED_NUMBER_PREFIX}UNMATCHED`;
export const UNMATCHED_MANIFEST_LABEL = "Unmatched Cultivera stock";

/** A Cultivera lot still without a manifest after the crawler's transfer match. */
export type OpenLot = { barcode: string; vendorLabel: string; product: string; units: number };

/** One harvested vendor document, already parsed. */
export type MailDoc = {
  messageId: string;
  /** Email date (UTC ISO), for display and ordering. */
  emailAt: string | null;
  filename: string;
  manifest: Pick<ParsedManifest, "manifest_number" | "vendor_label" | "vendor_license" | "transfer_date" | "source_format" | "lines">;
};

export type ManifestLineFacts = { productName: string | null; inventoryType: string | null; unitCostCents: number | null; qty: number };

export type MailLotDecision =
  | { barcode: string; outcome: "email"; manifestKey: string; vendorAgrees: boolean; facts: ManifestLineFacts }
  | { barcode: string; outcome: "several_manifests"; candidates: string[] }
  | { barcode: string; outcome: "unmatched" };

export type MailManifestGroup = {
  /** "<number>|<vendor license or name key>" (or "doc|<messageId>|<filename>" when the document has no number). */
  key: string;
  kind: typeof RECONSTRUCTED_MANIFEST_KIND;
  source: "email";
  manifestNumber: string | null;
  vendorLabel: string | null;
  vendorLicense: string | null;
  transferDate: string | null;
  sourceFormats: string[];
  /** Emails that carried this manifest (sorted, deduped). */
  messageIds: string[];
  files: string[];
  /** Open lots placed on this manifest (sorted). */
  barcodes: string[];
  /** Lines whose barcode is not an open lot (sold out, or already placed by the crawler). */
  otherLines: number;
};

export type UnmatchedManifest = {
  kind: typeof RECONSTRUCTED_MANIFEST_KIND;
  source: "unmatched";
  manifestNumber: typeof UNMATCHED_MANIFEST_NUMBER;
  label: typeof UNMATCHED_MANIFEST_LABEL;
  /** Every open lot neither source placed, incl. several_manifests (sorted). */
  barcodes: string[];
  /** Cultivera vendor label -> lots, for the owner (largest first in the report). */
  byVendor: Record<string, number>;
  units: number;
};

export type MailMatchPlan = {
  ruleVersion: typeof MAIL_MATCH_RULE_VERSION;
  decisions: MailLotDecision[];
  groups: MailManifestGroup[];
  unmatched: UnmatchedManifest;
  summary: {
    openLots: number;
    placedByEmail: number;
    severalManifests: number;
    unmatched: number;
    vendorDiffers: number;
    documents: number;
    documentsUsed: number;
    /** Documents with no line for any open lot. */
    documentsUnused: number;
    duplicateBarcodesIn: number;
  };
  /** Plain sentence; loud when anything is left unmatched. */
  line: string;
  complete: boolean;
};

/**
 * The lots the crawler's transfer match left without a manifest (TransferMatchPlan.decisions with
 * matched=false), with Cultivera's vendor, product and units summed over the export rows of that
 * barcode (first row labels the lot, as planImportLots). Rows with units <= 0 are not stock.
 */
export function openLotsFromTransferPlan(rows: readonly CultiveraGroupRow[], decisions: readonly Pick<LotTransferDecision, "barcode" | "matched">[]): OpenLot[] {
  const open = new Set(decisions.filter((d) => !d.matched).map((d) => clean(d.barcode)).filter(Boolean));
  const out = new Map<string, OpenLot>();
  for (const r of rows) {
    const bc = clean(r.barcode);
    if (!open.has(bc)) continue;
    const units = typeof r.units === "number" && Number.isFinite(r.units) ? r.units : null;
    if (units !== null && units <= 0) continue;
    const cur = out.get(bc);
    if (!cur) out.set(bc, { barcode: bc, vendorLabel: clean(r.vendor), product: clean(r.productName), units: units ?? 0 });
    else cur.units += units ?? 0;
  }
  return [...out.values()].sort((a, b) => a.barcode.localeCompare(b.barcode));
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The identity of one transfer across emails: number + vendor (license when given, else name). */
export function docManifestKey(d: MailDoc): string {
  const num = clean(d.manifest.manifest_number);
  if (!num) return `doc|${d.messageId}|${d.filename}`;
  const who = clean(d.manifest.vendor_license) || cultiveraVendorKey(d.manifest.vendor_label) || "?";
  return `${num}|${who.toUpperCase()}`;
}

/** Loose vendor agreement: one normalized name contains the other ("CANNA ORGANIX" in "CANNA ORGANIX LLC"). */
export function vendorsAgree(cultivera: string, email: string | null): boolean {
  const strip = (s: string) => cultiveraVendorKey(s).replace(/[^A-Z0-9 ]/g, "").replace(/\b(LLC|INC|CO|CORP|LTD|THE)\b/g, "").replace(/\s+/g, " ").trim();
  const a = strip(cultivera);
  const b = strip(email ?? "");
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/* ------------------------------------------------------------------ *
 *  The plan
 * ------------------------------------------------------------------ */

export function planMailMatch(openLots: readonly OpenLot[], docs: readonly MailDoc[]): MailMatchPlan {
  // Lots, deduped by barcode (first wins, as planImportLots).
  const lots = new Map<string, OpenLot>();
  let duplicateBarcodesIn = 0;
  for (const l of openLots) {
    const bc = clean(l.barcode);
    if (!bc) continue;
    if (lots.has(bc)) {
      duplicateBarcodesIn += 1;
      continue;
    }
    lots.set(bc, { ...l, barcode: bc });
  }

  // Documents -> manifests (merged by transfer identity); barcode -> manifest keys + first line facts.
  const groups = new Map<string, MailManifestGroup>();
  const receipts = new Map<string, Map<string, ManifestLineFacts>>();
  const otherByKey = new Map<string, Set<string>>();
  const docsByKey = new Map<string, number>();
  for (const d of docs) {
    const key = docManifestKey(d);
    docsByKey.set(key, (docsByKey.get(key) ?? 0) + 1);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        kind: RECONSTRUCTED_MANIFEST_KIND,
        source: "email",
        manifestNumber: clean(d.manifest.manifest_number) || null,
        vendorLabel: clean(d.manifest.vendor_label) || null,
        vendorLicense: clean(d.manifest.vendor_license) || null,
        transferDate: d.manifest.transfer_date ?? null,
        sourceFormats: [],
        messageIds: [],
        files: [],
        barcodes: [],
        otherLines: 0,
      };
      groups.set(key, g);
    }
    if (!g.sourceFormats.includes(d.manifest.source_format)) g.sourceFormats.push(d.manifest.source_format);
    if (!g.messageIds.includes(d.messageId)) g.messageIds.push(d.messageId);
    if (!g.files.includes(d.filename)) g.files.push(d.filename);
    g.vendorLabel ??= clean(d.manifest.vendor_label) || null;
    g.transferDate ??= d.manifest.transfer_date ?? null;
    for (const line of d.manifest.lines) {
      const bc = clean(line.lot_code);
      if (!bc || !(Number(line.received_qty) > 0)) continue;
      if (!lots.has(bc)) {
        const o = otherByKey.get(key) ?? new Set<string>();
        o.add(bc);
        otherByKey.set(key, o);
        continue;
      }
      const m = receipts.get(bc) ?? new Map<string, ManifestLineFacts>();
      if (!m.has(key)) {
        m.set(key, {
          productName: clean(line.product_name) || null,
          inventoryType: clean(line.inventory_type) || null,
          unitCostCents: typeof line.unit_cost_minor_units === "number" && Number.isFinite(line.unit_cost_minor_units) ? Math.round(line.unit_cost_minor_units) : null,
          qty: Number(line.received_qty),
        });
      }
      receipts.set(bc, m);
    }
  }

  const decisions: MailLotDecision[] = [];
  const unmatchedBarcodes: string[] = [];
  let vendorDiffers = 0;
  for (const bc of [...lots.keys()].sort()) {
    const lot = lots.get(bc)!;
    const hits = receipts.get(bc);
    if (!hits || hits.size === 0) {
      decisions.push({ barcode: bc, outcome: "unmatched" });
      unmatchedBarcodes.push(bc);
      continue;
    }
    if (hits.size > 1) {
      decisions.push({ barcode: bc, outcome: "several_manifests", candidates: [...hits.keys()].sort() });
      unmatchedBarcodes.push(bc);
      continue;
    }
    const [key, facts] = [...hits.entries()][0];
    const g = groups.get(key)!;
    g.barcodes.push(bc);
    const agrees = vendorsAgree(lot.vendorLabel, g.vendorLabel);
    if (!agrees) vendorDiffers += 1;
    decisions.push({ barcode: bc, outcome: "email", manifestKey: key, vendorAgrees: agrees, facts });
  }

  for (const [key, g] of groups) {
    g.barcodes.sort();
    g.messageIds.sort();
    g.files.sort();
    g.otherLines = otherByKey.get(key)?.size ?? 0;
  }
  const used = [...groups.values()].filter((g) => g.barcodes.length > 0).sort((a, b) => (a.manifestNumber ?? a.key).localeCompare(b.manifestNumber ?? b.key) || a.key.localeCompare(b.key));
  const documentsUsed = used.reduce((n, g) => n + (docsByKey.get(g.key) ?? 0), 0);

  const byVendor: Record<string, number> = {};
  let units = 0;
  for (const bc of unmatchedBarcodes) {
    const l = lots.get(bc)!;
    const v = clean(l.vendorLabel) || "(no vendor)";
    byVendor[v] = (byVendor[v] ?? 0) + 1;
    units += Number.isFinite(l.units) && l.units > 0 ? l.units : 0;
  }

  const placed = decisions.filter((d) => d.outcome === "email").length;
  const several = decisions.filter((d) => d.outcome === "several_manifests").length;
  const none = decisions.filter((d) => d.outcome === "unmatched").length;
  const complete = several + none === 0;
  const line =
    lots.size === 0
      ? "Email match: no Cultivera lots are waiting for a manifest."
      : complete
        ? `Email match: all ${lots.size} remaining lots found on ${used.length} emailed manifests.`
        : `Email match: ${placed} of ${lots.size} remaining lots found on ${used.length} emailed manifests. ${several + none} go on the "${UNMATCHED_MANIFEST_LABEL}" manifest` +
          (several ? ` (${several} appear on more than one emailed manifest and need you to pick)` : "") +
          ". They likely do not exist and belong in the CCRS clean-up.";

  return {
    ruleVersion: MAIL_MATCH_RULE_VERSION,
    decisions,
    groups: used,
    unmatched: { kind: RECONSTRUCTED_MANIFEST_KIND, source: "unmatched", manifestNumber: UNMATCHED_MANIFEST_NUMBER, label: UNMATCHED_MANIFEST_LABEL, barcodes: unmatchedBarcodes, byVendor, units },
    summary: {
      openLots: lots.size,
      placedByEmail: placed,
      severalManifests: several,
      unmatched: none,
      vendorDiffers,
      documents: docs.length,
      documentsUsed,
      documentsUnused: docs.length - documentsUsed,
      duplicateBarcodesIn,
    },
    line,
    complete,
  };
}

/** The unmatched manifest's vendors, largest first (ties by name), for the report. */
export function unmatchedVendorRows(u: UnmatchedManifest): { vendor: string; lots: number }[] {
  return Object.entries(u.byVendor)
    .map(([vendor, lots]) => ({ vendor, lots }))
    .sort((a, b) => b.lots - a.lots || a.vendor.localeCompare(b.vendor));
}

/* ------------------------------------------------------------------ *
 *  Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCultiveraMailMatchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-mail-match-core: " + msg);
    passed += 1;
  };
  type L = MailDoc["manifest"]["lines"][number];
  const line = (lot_code: string | null, received_qty = 5, extra: Partial<L> = {}): L =>
    ({ product_name: `P ${lot_code}`, lot_code, inventory_type: "Usable Marijuana", unit_cost_minor_units: 450, received_qty, ...extra }) as L;
  const doc = (messageId: string, num: string | null, lic: string | null, label: string | null, lines: L[], filename = "transfer.json", fmt: MailDoc["manifest"]["source_format"] = "wcia"): MailDoc => ({
    messageId,
    emailAt: null,
    filename,
    manifest: { manifest_number: num, vendor_license: lic, vendor_label: label, transfer_date: "2025-03-01", source_format: fmt, lines },
  });
  const lots: OpenLot[] = [
    { barcode: "B1", vendorLabel: "Canna Organix", product: "x", units: 3 },
    { barcode: "B2", vendorLabel: "Canna Organix", product: "y", units: 2 },
    { barcode: "B3", vendorLabel: "Fireline", product: "z", units: 1 },
    { barcode: "B4", vendorLabel: "Mama J's", product: "w", units: 4 },
    { barcode: "B5", vendorLabel: "Default Vendor", product: "v", units: 0 },
    { barcode: " B1 ", vendorLabel: "Other", product: "dup", units: 9 },
    { barcode: "", vendorLabel: "Blank", product: "n", units: 1 },
  ];
  const docs: MailDoc[] = [
    doc("m1", "T100", "412345", "CANNA ORGANIX LLC", [line("B1"), line("B2", 0), line("SOLD1")]),
    doc("m2", " T100 ", "412345", "Canna Organix LLC", [line("B2"), line("SOLD1"), line("SOLD2")], "fwd.json"),
    doc("m3", "T200", "498765", "Blaze Distribution", [line("B3", 2, { unit_cost_minor_units: 1234.4, product_name: "  Fire OG 3.5g " })]),
    doc("m4", "T300", "411111", "Mama J", [line("B4")]),
    doc("m5", "T301", "411111", "Mama J", [line("B4")], "manifest.pdf", "pdf-manifest"),
    doc("m6", null, null, null, [line("ZZZ")], "invoice.csv", "ccrs-csv"),
  ];
  const p = planMailMatch(lots, docs);

  ok(p.summary.openLots === 5 && p.summary.duplicateBarcodesIn === 1, "lots deduped by trimmed barcode, blank dropped");
  const d = (bc: string) => p.decisions.find((x) => x.barcode === bc)!;
  ok(d("B1").outcome === "email" && d("B2").outcome === "email", "B1 and B2 found");
  ok(d("B1").outcome === "email" && (d("B1") as { manifestKey: string }).manifestKey === "T100|412345", "keyed by number + license");
  ok(p.groups.filter((g) => g.manifestNumber === "T100").length === 1, "the same transfer emailed twice is ONE manifest");
  const g100 = p.groups.find((g) => g.manifestNumber === "T100")!;
  ok(g100.messageIds.join() === "m1,m2" && g100.files.join() === "fwd.json,transfer.json" && g100.barcodes.join() === "B1,B2", "merged emails, files, lots");
  ok(g100.otherLines === 2, "sold-out lines counted once each across the merged emails");
  ok(d("B2").outcome === "email" && (d("B2") as { facts: ManifestLineFacts }).facts.qty === 5, "a 0-qty line is not a receipt; the other email's line is");
  const f3 = (d("B3") as { facts: ManifestLineFacts; vendorAgrees: boolean });
  ok(f3.facts.productName === "Fire OG 3.5g" && f3.facts.unitCostCents === 1234 && f3.facts.inventoryType === "Usable Marijuana", "manifest facts carried (name, type, cost in cents)");
  ok(f3.vendorAgrees === false && p.summary.vendorDiffers === 1, "different vendor names still match by barcode, reported");
  ok((d("B1") as { vendorAgrees: boolean }).vendorAgrees, "CANNA ORGANIX LLC agrees with Canna Organix");
  ok(d("B4").outcome === "several_manifests" && (d("B4") as { candidates: string[] }).candidates.join() === "T300|411111,T301|411111", "two different manifests -> never guess");
  ok(d("B5").outcome === "unmatched", "nothing in email -> unmatched");
  ok(p.unmatched.manifestNumber === "CV-UNMATCHED" && p.unmatched.label === "Unmatched Cultivera stock" && p.unmatched.barcodes.join() === "B4,B5", "ONE unmatched manifest holds unmatched + several");
  ok(p.unmatched.units === 4 && p.unmatched.byVendor["Mama J's"] === 1 && p.unmatched.byVendor["Default Vendor"] === 1, "unmatched units and vendors");
  ok(p.groups.map((g) => g.manifestNumber).join() === "T100,T200", "only manifests that place a lot are kept, sorted");
  ok(p.summary.documents === 6 && p.summary.documentsUsed === 3 && p.summary.documentsUnused === 3, "document usage counted");
  ok(!p.complete && p.summary.placedByEmail === 3 && p.summary.severalManifests === 1 && p.summary.unmatched === 1, "summary counts");
  ok(p.line === 'Email match: 3 of 5 remaining lots found on 2 emailed manifests. 2 go on the "Unmatched Cultivera stock" manifest (1 appear on more than one emailed manifest and need you to pick). They likely do not exist and belong in the CCRS clean-up.', "loud line");
  ok(p.groups.every((g) => g.kind === "cultivera-reconstructed" && g.source === "email"), "email manifests are reconstructed (accounting-inert) manifests");
  ok(unmatchedVendorRows(p.unmatched).map((r) => r.vendor).join() === "Default Vendor,Mama J's", "vendor rows sorted (ties by name)");

  const all = planMailMatch([{ barcode: "B1", vendorLabel: "Canna Organix", product: "x", units: 1 }], docs);
  ok(all.complete && all.line === "Email match: all 1 remaining lots found on 1 emailed manifests." && all.unmatched.barcodes.length === 0, "all found -> complete");
  ok(planMailMatch([], docs).line === "Email match: no Cultivera lots are waiting for a manifest." && planMailMatch([], docs).complete, "nothing open");
  const noDocs = planMailMatch(lots, []);
  ok(noDocs.summary.unmatched === 5 && noDocs.groups.length === 0 && !noDocs.complete, "no email at all -> everything unmatched, loudly");
  ok(docManifestKey(doc("m9", null, null, null, [], "a.pdf")) === "doc|m9|a.pdf", "no number -> per-document key (never merged)");
  ok(docManifestKey(doc("m9", "T1", null, " canna  organix ", [])) === "T1|CANNA ORGANIX", "no license -> normalized name");
  ok(vendorsAgree("The Fireline Co", "FIRELINE") && !vendorsAgree("Fireline", null) && !vendorsAgree("", "x"), "vendor agreement");
  const neg = planMailMatch([{ barcode: "N1", vendorLabel: "V", product: "p", units: -2 }], []);
  ok(neg.unmatched.units === 0, "negative units never count");
  const sameNumOtherVendor = planMailMatch([{ barcode: "Q", vendorLabel: "A", product: "p", units: 1 }], [doc("a", "T9", "1", "A", [line("Q")]), doc("b", "T9", "2", "B", [line("Q")])]);
  ok(sameNumOtherVendor.decisions[0].outcome === "several_manifests", "same number, different license = different manifests");

  const rows: CultiveraGroupRow[] = [
    { barcode: "X1", vendor: " Canna  Organix ", receivedDateRaw: "", units: 2, productName: "A" },
    { barcode: "X1", vendor: "Other", receivedDateRaw: "", units: 3, productName: "B" },
    { barcode: "X2", vendor: "V", receivedDateRaw: "", units: 0 },
    { barcode: "X3", vendor: "V", receivedDateRaw: "", units: 1 },
    { barcode: "X4", vendor: "V", receivedDateRaw: "" },
  ];
  const open = openLotsFromTransferPlan(rows, [
    { barcode: "X1", matched: false },
    { barcode: "X2", matched: false },
    { barcode: "X3", matched: true },
    { barcode: "X4", matched: false },
  ]);
  ok(open.map((o) => `${o.barcode}:${o.vendorLabel}:${o.units}`).join() === "X1:Canna Organix:5,X4:V:0", "open lots: only unmatched, first row labels, units summed, zero-unit rows skipped");

  return { passed, failed: 0 };
}
