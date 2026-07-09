/**
 * src/lib/inventory/manifest-merge-core.ts  (H16b-5)
 *
 * PURE merge helpers that combine the several documents a single vendor email
 * carries into ONE richer ParsedManifest before it is staged. A vendor emails a
 * bundle: the shipping document (LCB Internal Shipping / GrowFlow Manifest /
 * old-method Transfer Log) that is the legal chain-of-custody, sometimes an
 * OpenTHC invoice that carries the PRICES, and a COA Summary PDF that carries
 * potency / PASS / expiry. Each is parsed separately (pdf-manifest-core,
 * pdf-growflow-manifest-core, pdf-transferlog-core, pdf-openthc-manifest-core,
 * pdf-coa-core); this module fuses them.
 *
 * OWNER-CONFIRMED STRATEGY (verbatim record in the todo doc):
 *   Q1 the manifest/transfer-log doc is PRIMARY for the line list + transport;
 *      when an OpenTHC invoice is also present we keep the invoice PRICES and
 *      merge them onto matching lines by Lot ID (the manifest has no prices).
 *   Q2 COA potency/PASS/expiry merges onto a line ONLY on an EXACT Lot ID
 *      match; unmatched lots are left unmerged with a review warning.
 *   Q3 fill-only-when-empty: the primary doc's value wins; a secondary doc only
 *      fills a blank; a real disagreement raises a WARNING for the human to
 *      resolve and is NEVER silently overwritten. arrived_at is never guessed.
 *   Q4 one manifest per email: extra PDFs' data is merged INTO the single
 *      pending manifest, not staged as duplicates.
 *
 * No I/O, no server-only: unit-testable with vitest.
 */

import type {
  ParsedManifest,
  ParsedLine,
  ParsedLab,
  ParsedTransport,
} from "@/lib/inventory/intake-parser";
import { emptyTransport, transportHasData } from "@/lib/inventory/intake-parser";

/** Normalize a Lot ID for matching: trim + uppercase + strip inner spaces that
 * unpdf sometimes injects into ULIDs. PURE. */
export function normalizeLotKey(lot: string | null | undefined): string | null {
  if (!lot) return null;
  const k = String(lot).replace(/\s+/g, "").trim().toUpperCase();
  return k.length > 0 ? k : null;
}

/** A field that a secondary doc tried to fill but conflicted with the primary. */
export type MergeConflict = {
  scope: "transport" | "line";
  lot?: string | null;
  field: string;
  primary: string | null;
  secondary: string | null;
};

/**
 * Fill-only-when-empty transport merge. `primary` wins; `secondary` fills blanks
 * only. arrived_at is never taken from a secondary doc (never guessed). Returns
 * the merged transport plus any conflicts (both non-null and unequal). PURE.
 */
export function mergeTransportFillEmpty(
  primary: ParsedTransport | null | undefined,
  secondary: ParsedTransport | null | undefined,
): { transport: ParsedTransport; conflicts: MergeConflict[] } {
  const out = { ...emptyTransport(), ...(primary ?? {}) } as ParsedTransport;
  const conflicts: MergeConflict[] = [];
  if (!secondary) return { transport: out, conflicts };

  (Object.keys(out) as (keyof ParsedTransport)[]).forEach((field) => {
    // arrived_at is a factual receipt stamp — never sourced from a document merge.
    if (field === "arrived_at") return;
    const p = out[field];
    const s = secondary[field];
    const pEmpty = p == null || String(p).trim() === "";
    const sEmpty = s == null || String(s).trim() === "";
    if (pEmpty && !sEmpty) {
      out[field] = s;
    } else if (!pEmpty && !sEmpty && String(p).trim() !== String(s).trim()) {
      conflicts.push({
        scope: "transport",
        field: String(field),
        primary: p == null ? null : String(p),
        secondary: s == null ? null : String(s),
      });
    }
  });
  return { transport: out, conflicts };
}

/**
 * Attach COA enrichment (a Lot ID -> ParsedLab map from pdf-coa-core) onto the
 * manifest's lines by EXACT Lot ID. Only fills a line's `lab`/`expires_on` when
 * empty (Q3). Records: which lots merged, which COA lots had no matching line,
 * and which lines already had a different lab (conflict warning). PURE.
 */
export function mergeCoaByLot(
  manifest: ParsedManifest,
  coaByLot: Record<string, ParsedLab> | null | undefined,
  expiresByLot?: Record<string, string | null> | null,
): { manifest: ParsedManifest; merged: number; unmatchedCoaLots: string[]; conflicts: MergeConflict[] } {
  const conflicts: MergeConflict[] = [];
  if (!coaByLot || Object.keys(coaByLot).length === 0) {
    return { manifest, merged: 0, unmatchedCoaLots: [], conflicts };
  }

  // Index COA by normalized lot key.
  const coaIndex = new Map<string, { lab: ParsedLab; expires: string | null }>();
  for (const [lot, lab] of Object.entries(coaByLot)) {
    const key = normalizeLotKey(lot);
    if (key) coaIndex.set(key, { lab, expires: expiresByLot?.[lot] ?? lab.coa_expire_date ?? null });
  }

  const usedKeys = new Set<string>();
  let merged = 0;
  const lines: ParsedLine[] = manifest.lines.map((line) => {
    const key = normalizeLotKey(line.lot_code);
    if (!key || !coaIndex.has(key)) return line;
    const hit = coaIndex.get(key)!;
    usedKeys.add(key);

    const warnings = [...line.warnings];
    let lab = line.lab;
    if (!lab) {
      lab = hit.lab;
      merged += 1;
    } else if (
      lab.labtest_external_identifier &&
      hit.lab.labtest_external_identifier &&
      lab.labtest_external_identifier !== hit.lab.labtest_external_identifier
    ) {
      // Real disagreement — keep primary, warn the human (Q3).
      conflicts.push({
        scope: "line",
        lot: line.lot_code,
        field: "labtest_external_identifier",
        primary: lab.labtest_external_identifier,
        secondary: hit.lab.labtest_external_identifier,
      });
      warnings.push(
        `COA conflict: line already cites lab ${lab.labtest_external_identifier} but the COA PDF maps this lot to ${hit.lab.labtest_external_identifier} — verify which is correct.`,
      );
    }

    // Fill expiry only when empty (Q3).
    const expires_on = line.expires_on ?? hit.expires ?? null;
    return { ...line, lab, expires_on, warnings };
  });

  const unmatchedCoaLots: string[] = [];
  for (const key of coaIndex.keys()) {
    if (!usedKeys.has(key)) unmatchedCoaLots.push(key);
  }

  const manifestWarnings = [...manifest.warnings];
  if (unmatchedCoaLots.length > 0) {
    manifestWarnings.push(
      `COA PDF had ${unmatchedCoaLots.length} lot(s) with no matching manifest line (${unmatchedCoaLots
        .slice(0, 5)
        .join(", ")}${unmatchedCoaLots.length > 5 ? ", …" : ""}) — left unmerged for review.`,
    );
  }

  return {
    manifest: { ...manifest, lines, warnings: manifestWarnings },
    merged,
    unmatchedCoaLots,
    conflicts,
  };
}

/**
 * Merge PRICES from an OpenTHC invoice ParsedManifest onto the primary
 * manifest's lines by EXACT Lot ID (Q1). Only fills `unit_cost_minor_units`
 * when the primary line has none (Q3). Also fills product_name/brand/strain when
 * the primary line lacked them (the transfer-log is line-sparse). PURE.
 */
export function mergeInvoicePricesByLot(
  manifest: ParsedManifest,
  invoice: ParsedManifest | null | undefined,
): { manifest: ParsedManifest; pricedLines: number; unmatchedInvoiceLots: string[] } {
  if (!invoice || invoice.lines.length === 0) {
    return { manifest, pricedLines: 0, unmatchedInvoiceLots: [] };
  }
  const invIndex = new Map<string, ParsedLine>();
  for (const l of invoice.lines) {
    const key = normalizeLotKey(l.lot_code);
    if (key && !invIndex.has(key)) invIndex.set(key, l);
  }

  const usedKeys = new Set<string>();
  let pricedLines = 0;
  const lines: ParsedLine[] = manifest.lines.map((line) => {
    const key = normalizeLotKey(line.lot_code);
    if (!key || !invIndex.has(key)) return line;
    const inv = invIndex.get(key)!;
    usedKeys.add(key);

    const next: ParsedLine = { ...line };
    if (next.unit_cost_minor_units == null && inv.unit_cost_minor_units != null) {
      next.unit_cost_minor_units = inv.unit_cost_minor_units;
      pricedLines += 1;
    }
    // The transfer-log/manifest can be line-sparse; fill descriptive blanks only.
    if (!next.product_name && inv.product_name) next.product_name = inv.product_name;
    if (!next.brand_name && inv.brand_name) next.brand_name = inv.brand_name;
    if (!next.strain_name && inv.strain_name) next.strain_name = inv.strain_name;
    if (next.unit_weight == null && inv.unit_weight != null) {
      next.unit_weight = inv.unit_weight;
      next.unit_weight_uom = next.unit_weight_uom ?? inv.unit_weight_uom;
    }
    return next;
  });

  const unmatchedInvoiceLots: string[] = [];
  for (const key of invIndex.keys()) {
    if (!usedKeys.has(key)) unmatchedInvoiceLots.push(key);
  }

  return { manifest: { ...manifest, lines }, pricedLines, unmatchedInvoiceLots };
}

/**
 * Convenience: fold a secondary manifest's transport into the primary and stash
 * any conflicts as manifest-level warnings. Used when the transport lives on a
 * DIFFERENT document than the primary line source (e.g. the GrowFlow manifest
 * doc carries transport while the invoice carries lines). PURE.
 */
export function foldTransport(
  manifest: ParsedManifest,
  secondaryTransport: ParsedTransport | null | undefined,
): ParsedManifest {
  if (!transportHasData(secondaryTransport)) return manifest;
  const { transport, conflicts } = mergeTransportFillEmpty(manifest.transport, secondaryTransport);
  const warnings = [...manifest.warnings];
  for (const c of conflicts) {
    warnings.push(
      `Transport conflict on ${c.field}: manifest says "${c.primary}", another document says "${c.secondary}" — verify during review.`,
    );
  }
  return { ...manifest, transport, warnings };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run by the vitest harness).
// ---------------------------------------------------------------------------
export function __runManifestMergeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // normalizeLotKey
  ok(normalizeLotKey(" 01KM G0FT ") === "01KMG0FT", "lot key strips spaces + uppercases");
  ok(normalizeLotKey(null) === null, "lot key null passthrough");

  // transport fill-only-when-empty
  const primary: ParsedTransport = {
    ...emptyTransport(),
    driver_name: "David Sanchez",
    departed_at: "2026-06-29T08:44",
  };
  const secondary: ParsedTransport = {
    ...emptyTransport(),
    driver_name: "SOMEONE ELSE", // conflict — must NOT overwrite
    transporter_name: "Svin Garden", // fill blank
    arrived_at: "2026-06-30T10:27", // must be ignored (never guessed)
    eta_date: "2026-06-30", // fill blank
  };
  const tRes = mergeTransportFillEmpty(primary, secondary);
  ok(tRes.transport.driver_name === "David Sanchez", "primary driver preserved");
  ok(tRes.transport.transporter_name === "Svin Garden", "blank transporter filled");
  ok(tRes.transport.eta_date === "2026-06-30", "blank eta filled");
  ok(tRes.transport.arrived_at === null, "arrived_at never taken from secondary");
  ok(
    tRes.conflicts.some((c) => c.field === "driver_name"),
    "driver_name conflict recorded",
  );

  // COA merge by exact lot id
  const lab083: ParsedLab = {
    labtest_external_identifier: "WA-260305-083",
    lab_name: null,
    tested_on: "2026-03-06",
    thc_pct: null,
    cbd_pct: null,
    thca_pct: null,
    cbda_pct: null,
    total_thc_pct: 22,
    total_cbd_pct: 0.054,
    total_cannabinoids_pct: 27,
    potency_json: { "total-thc": 22 },
    terpenes_json: null,
    analytes_json: null,
    passed: true,
    coa_url: null,
    coa_release_date: "2026-03-06",
    coa_expire_date: "2027-03-06",
    raw: {},
  };
  const baseLine = (lot: string): ParsedLine => ({
    product_name: "Flower",
    lot_code: lot,
    pos_product_key: lot,
    brand_name: null,
    category: null,
    strain_name: null,
    received_qty: 1,
    unit: "each",
    unit_cost_minor_units: null,
    unit_weight: null,
    unit_weight_uom: null,
    is_sample: false,
    is_medical: false,
    inventory_type: null,
    expires_on: null,
    lab: null,
    warnings: [],
    raw: {},
  });
  const man: ParsedManifest = {
    manifest_number: "M1",
    vendor_label: "High End",
    vendor_license: "415771",
    transfer_date: "2026-03-06",
    source_format: "pdf-manifest",
    lines: [baseLine("01KMG0FTXX17N0ST"), baseLine("NOPE-NO-COA")],
    warnings: [],
    transport: emptyTransport(),
  };
  const coaByLot = { "01KMG0FTXX17N0ST": lab083, "01KMG0JFJT0ZN4VS": lab083 };
  const coaRes = mergeCoaByLot(man, coaByLot, {
    "01KMG0FTXX17N0ST": "2027-03-06",
    "01KMG0JFJT0ZN4VS": "2027-03-06",
  });
  ok(coaRes.merged === 1, `one line merged (got ${coaRes.merged})`);
  ok(coaRes.manifest.lines[0].lab?.labtest_external_identifier === "WA-260305-083", "coa lab attached to matching lot");
  ok(coaRes.manifest.lines[0].expires_on === "2027-03-06", "expiry filled from coa");
  ok(coaRes.manifest.lines[1].lab === null, "non-matching line untouched");
  ok(coaRes.unmatchedCoaLots.includes("01KMG0JFJT0ZN4VS"), "unmatched coa lot flagged");
  ok(
    coaRes.manifest.warnings.some((w) => w.includes("no matching manifest line")),
    "manifest warning added for unmatched coa lots",
  );

  // COA conflict: line already cites a DIFFERENT lab -> keep primary, warn.
  const manWithLab: ParsedManifest = {
    ...man,
    lines: [{ ...baseLine("01KMG0FTXX17N0ST"), lab: { ...lab083, labtest_external_identifier: "WA-OTHER-001" } }],
  };
  const coaConflict = mergeCoaByLot(manWithLab, { "01KMG0FTXX17N0ST": lab083 });
  ok(
    coaConflict.manifest.lines[0].lab?.labtest_external_identifier === "WA-OTHER-001",
    "primary lab preserved on conflict",
  );
  ok(
    coaConflict.conflicts.some((c) => c.field === "labtest_external_identifier"),
    "coa lab conflict recorded",
  );
  ok(
    coaConflict.manifest.lines[0].warnings.some((w) => w.includes("COA conflict")),
    "coa conflict warning on the line",
  );

  // invoice price merge by lot
  const invoice: ParsedManifest = {
    ...man,
    source_format: "pdf-manifest",
    lines: [
      { ...baseLine("01KMG0FTXX17N0ST"), unit_cost_minor_units: 1500, brand_name: "HighEnd" },
      { ...baseLine("INV-ONLY-LOT"), unit_cost_minor_units: 999 },
    ],
  };
  const priceRes = mergeInvoicePricesByLot(man, invoice);
  ok(priceRes.pricedLines === 1, `one line priced (got ${priceRes.pricedLines})`);
  ok(priceRes.manifest.lines[0].unit_cost_minor_units === 1500, "price merged onto matching lot");
  ok(priceRes.manifest.lines[0].brand_name === "HighEnd", "blank brand filled from invoice");
  ok(priceRes.manifest.lines[1].unit_cost_minor_units === null, "non-matching line price untouched");
  ok(priceRes.unmatchedInvoiceLots.includes("INV-ONLY-LOT"), "unmatched invoice lot flagged");

  // price fill-only-when-empty: don't overwrite an existing price
  const manPriced: ParsedManifest = {
    ...man,
    lines: [{ ...baseLine("01KMG0FTXX17N0ST"), unit_cost_minor_units: 2000 }],
  };
  const priceKeep = mergeInvoicePricesByLot(manPriced, invoice);
  ok(priceKeep.manifest.lines[0].unit_cost_minor_units === 2000, "existing price preserved (fill-only-when-empty)");
  ok(priceKeep.pricedLines === 0, "no line re-priced when already priced");

  // foldTransport convenience
  const folded = foldTransport({ ...man, transport: primary }, secondary);
  ok(folded.transport?.transporter_name === "Svin Garden", "foldTransport fills blank");
  ok(folded.transport?.driver_name === "David Sanchez", "foldTransport keeps primary");
  ok(folded.warnings.some((w) => w.includes("Transport conflict")), "foldTransport warns on conflict");

  if (failed === 0) console.log(`manifest-merge-core: all ${passed} tests passed`);
  return { passed, failed };
}
