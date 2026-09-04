/**
 * src/lib/inventory/pdf-transferlog-core.ts  (H16b-3)
 *
 * PURE parser for the "old method" WA TRANSFER LOG PDF — the document whose
 * header literally reads "Transfer Log (This document is NOT a manifest)".
 * Operates on the PLAIN TEXT already extracted by the serverless-safe `unpdf`
 * extractor (I/O lives in the server-only pdf-extract.ts). No I/O, no
 * `server-only`, so it is unit-testable with vitest against a saved fixture
 * (the exact unpdf output of the owner's real svin_garden_transfer_log.pdf).
 *
 * WHY a SEPARATE parser (verified, not guessed): the old method emails this
 * Transfer Log alongside an OpenTHC invoice. The invoice carries the priced
 * lines + Depart/Arrive only; the Transfer Log carries the REST of the
 * chain-of-custody the review form needs — the transporter, the full vehicle
 * (year/color/make/model/plate), the two Approx. Departure/Arrival Date/Time
 * values, the numbered Travel Route, AND the real LCB Manifest ID (distinct
 * from the GF Transfer Log ID). Reading this doc is what fills the transport
 * fields the owner reported as blank on the old-method emails.
 *
 * unpdf flattens the PDF to a single FLOWING blob and DUPLICATES the header on
 * every page, so we dedupe header anchors and dedupe line items by Lot ID. The
 * line table is a run of:
 *   <#> <GF+14 digits Lot ID> <Type> <Description ...> <shipped int> [ ]
 * where <Type> is a WA inventory type ("Usable Cannabis", "Extract For
 * Inhalation", ...). Trailing empty numbered rows (21..34) carry no Lot ID and
 * are ignored.
 *
 * DRAFTS-ONLY (standing rule): produces sparse draft lines (no price/COA on the
 * Transfer Log) for HUMAN review; never activates stock; never guesses
 * arrived_at (staff stamp the actual arrival on receipt).
 */

import type { ParsedManifest, ParsedLine } from "@/lib/inventory/intake-parser";
import { emptyTransport, combineDateAndTime } from "@/lib/inventory/intake-parser";

/** Recognize the old-method Transfer Log by its unmistakable header + IDs. */
export function looksLikeTransferLog(text: string): boolean {
  if (!text) return false;
  const hasHeader = /Transfer Log\s*\(This document is NOT a manifest\)/i.test(text);
  const hasIds =
    /Transfer Log ID:\s*GF\d{6,}/i.test(text) || /LCB Manifest ID:\s*\d{6,}/i.test(text);
  return hasHeader && hasIds;
}

/** Normalize a "6/29/2026" (m/d/yyyy or m/d/yy) date to YYYY-MM-DD. PURE. */
export function normalizeTransferLogDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  let yy = Number(m[3]);
  if (m[3].length === 2) yy = 2000 + yy;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${yy}-${p(mm)}-${p(dd)}`;
}

/** The WA inventory types that begin each line's description on this layout. */
const INV_TYPES = [
  "Usable Cannabis",
  "Extract For Inhalation",
  "Cannabis Mix Infused",
  "Cannabis Mix Packaged",
  "Concentrate For Inhalation",
  "Solid Marijuana Infused Edible",
  "Liquid Marijuana Infused Edible",
  "Marijuana Mix Packaged",
  "Sample Jar",
];

type TlLine = {
  lotId: string;
  type: string | null;
  description: string;
  shipped: number;
};

/**
 * Parse the "# Lot ID Type Description Shipped" rows. Anchor on the GF Lot ID,
 * split off the leading inventory Type, and read the trailing shipped integer
 * that precedes the "[ ]" received checkbox. Dedupe by Lot ID (the header +
 * item table repeat per page). PURE.
 */
export function parseTransferLogItems(text: string): TlLine[] {
  const seen = new Set<string>();
  const out: TlLine[] = [];

  // CRITICAL: restrict parsing to the item-table region ONLY. The document top
  // carries a barcode that is the GF Transfer Log ID (e.g. GF41582000007617),
  // which is NOT a line-item Lot ID. If we scanned the whole blob, a naive
  // non-greedy row regex would latch onto that header GF id and swallow the
  // entire header+route text as "line 1". Each page repeats the table under the
  // "# Lot ID Type Description Shipped Received" column header (rendered by unpdf
  // as "- # Lot ID Type Description Shipped Received"), so we keep only the
  // concatenation of every such table region and scan within it. Real rows are
  //   <#> <GF+14 Lot ID> <Type> <Description ...> <shipped int> [ ]
  // and the Transfer Log ID barcode never appears inside these regions.
  const tableRe = /#\s+Lot ID\s+Type\s+Description\s+Shipped\s+Received([\s\S]*?)(?:Page \d+\s*of\s*\d+|$)/gi;
  let region = "";
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(text)) !== null) {
    region += " " + tm[1];
  }
  const scanText = region.trim().length > 0 ? region : text;

  // Each row ends at the received checkbox "[ ]" (or "[ H ]", etc.). Capture the
  // Lot ID, the middle blob, and the trailing shipped integer.
  const rowRe = /\b(GF\d{14})\s+([\s\S]*?)\s+(\d{1,4})\s*\[/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(scanText)) !== null) {
    const lotId = m[1];
    if (seen.has(lotId)) continue; // page-2 repeats page-1 rows
    let middle = m[2].replace(/\s+/g, " ").trim();
    const shipped = Math.round(Number(m[3]));

    // Peel the leading inventory Type off the description, when present.
    let type: string | null = null;
    for (const t of INV_TYPES) {
      if (middle.toLowerCase().startsWith(t.toLowerCase())) {
        type = t;
        middle = middle.slice(t.length).trim();
        break;
      }
    }
    if (!middle) continue;
    seen.add(lotId);
    out.push({ lotId, type, description: middle, shipped: Number.isFinite(shipped) ? shipped : 0 });
  }
  return out;
}

/** Map a Transfer Log row to a sparse ParsedLine (drafts-only; no price/COA). */
function toParsedLine(g: TlLine): ParsedLine {
  return {
    product_name: g.description,
    lot_code: g.lotId,
    pos_product_key: g.lotId,
    brand_name: null,
    category: g.type,
    strain_name: null,
    strain_type: null,
    received_qty: g.shipped,
    unit: "each",
    unit_cost_minor_units: null,
    unit_weight: null,
    unit_weight_uom: null,
    is_sample: false,
    is_medical: false,
    inventory_type: null,
    expires_on: null,
    // SLICE 18-0: compliance classification is never read from a manifest
    // (WA manifests carry no such field). Collected at Product Onboarding.
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: null,
    units_per_package: null,
    lab: null,
    warnings: [
      "From an old-method Transfer Log PDF — no per-line price/COA on this document; enrich during review.",
    ],
    raw: { lot_id: g.lotId, type: g.type, description: g.description, shipped: g.shipped },
  };
}

/** Grab the first capture of a regex, trimmed, or null. */
function grab(text: string, re: RegExp): string | null {
  const m = text.match(re);
  const v = m?.[1]?.trim() ?? null;
  return v && v.length > 0 ? v : null;
}

/** Treat "N/A"/blank as null. */
function meaningful(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || /^(n\/?a|not applicable|none|unknown)$/i.test(t)) return null;
  return t;
}

/**
 * Parse an old-method Transfer Log PDF's text into a ParsedManifest with full
 * transport chain-of-custody. Returns null if it isn't a Transfer Log.
 */
export function parseTransferLog(text: string): ParsedManifest | null {
  if (!looksLikeTransferLog(text)) return null;

  // ── Header / IDs ────────────────────────────────────────────────────────────
  // Prefer the real LCB Manifest ID; keep the GF Transfer Log ID as a fallback
  // so we always have SOME identifier for the draft.
  const lcbManifestId = grab(text, /LCB Manifest ID:\s*(\d{6,})/i);
  const transferLogId = grab(text, /Transfer Log ID:\s*(GF\d{6,})/i);
  const manifest_number = lcbManifestId ?? transferLogId ?? null;

  // Origin licensee = the SENDING vendor ("Licensee Name:" on this doc, with
  // "License #" nearby). The destination is separately labelled "Destination".
  const vendor_label = grab(text, /Licensee Name:\s*([^]*?)\s*License UBI:/i);
  const vendor_license = grab(text, /License #\s*(\d{5,})/i);

  const transfer_date = normalizeTransferLogDate(grab(text, /\bDate:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i));

  // ── Transport / chain-of-custody ────────────────────────────────────────────
  const transport = emptyTransport();

  // Transporter name (e.g. "David Sanchez"), then the "Transporter:" org.
  transport.driver_name = meaningful(
    grab(text, /Transporter Name:\s*([A-Za-z][A-Za-z.'\- ]{1,50}?)\s*(?:Licensee Phone:|Transporter Date)/i),
  );
  // The carrier org is the "Transporter:" line (e.g. "Svin Garden").
  transport.transporter_name = meaningful(
    grab(text, /Transporter:\s*([A-Za-z][A-Za-z0-9.'&\- ]{1,50}?)\s*(?:Transporter Signature|Stop #)/i),
  );

  // Vehicle: "Vehicle Year/ Color/ Make/ Model/ License Plate: 2015 / blue / toyota / prius v / bwd5565"
  const vehM = text.match(
    /Vehicle Year\/?\s*Color\/?\s*Make\/?\s*Model\/?\s*License Plate:\s*([^]*?)\s*(?:Transporter Name:|Licensee Phone:)/i,
  );
  if (vehM) {
    const parts = vehM[1].split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const plate = parts[parts.length - 1];
      const descParts = parts.slice(0, -1);
      transport.vehicle_description = descParts.join(" ").trim() || null;
      if (/^[a-z0-9]{5,8}$/i.test(plate)) transport.vehicle_plate = plate.toUpperCase();
    }
  }

  // Approx. Departure / Arrival Date/Time.
  const depM = text.match(/Approx\.\s*Departure Date\/Time:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*([\d:]+\s*[AP]M)/i);
  const arrM = text.match(/Approx\.\s*Arrival Date\/Time:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*([\d:]+\s*[AP]M)/i);
  transport.departed_at = depM ? combineDateAndTime(normalizeTransferLogDate(depM[1]), depM[2]) : null;
  // Arrival is the ESTIMATE → eta_date only, never arrived_at.
  transport.eta_date = arrM ? normalizeTransferLogDate(arrM[1]) : null;

  // Travel Route (numbered directions) → route_notes.
  const routeM = text.match(/Travel Route:\s*([\s\S]*?)\s*Instructions:/i);
  if (routeM) {
    const note = routeM[1].replace(/\s+/g, " ").trim();
    if (note.length > 15) transport.route_notes = note;
  }

  // ── Lines ────────────────────────────────────────────────────────────────
  const items = parseTransferLogItems(text);
  const lines = items.map(toParsedLine);

  return {
    manifest_number,
    vendor_label: vendor_label ?? null,
    vendor_license: vendor_license ?? null,
    transfer_date,
    source_format: "pdf-manifest",
    lines,
    warnings: [
      "Parsed from an old-method Transfer Log PDF (drafts only) — verify carrier, ETA, and line items before receiving.",
    ],
    transport,
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests. Runs against the real sample text passed in by the test.
// ---------------------------------------------------------------------------
export function __runTransferLogTests(sampleText: string): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // date helper
  ok(normalizeTransferLogDate("6/29/2026") === "2026-06-29", "date m/d/yyyy → iso");
  ok(normalizeTransferLogDate("6/1/26") === "2026-06-01", "date m/d/yy → iso");
  ok(normalizeTransferLogDate("nope") === null, "bad date → null");

  // classifier
  ok(looksLikeTransferLog(sampleText) === true, "sample recognized as Transfer Log");
  ok(
    looksLikeTransferLog("Internal Shipping Document Manifest ID: 21544 Batch") === false,
    "LCB doc not mistaken for a Transfer Log",
  );
  ok(
    looksLikeTransferLog("Invoice #01KM Inventory Lot Details QA Count") === false,
    "OpenTHC invoice not mistaken for a Transfer Log",
  );

  // full parse
  const m = parseTransferLog(sampleText);
  ok(m !== null, "sample parses");
  ok(m?.source_format === "pdf-manifest", "source_format tagged");
  // Real LCB Manifest ID beats the GF Transfer Log ID.
  ok(m?.manifest_number === "603353555", `LCB manifest id preferred (got ${m?.manifest_number})`);
  ok(m?.vendor_label === "Svin Garden", `origin vendor (got ${m?.vendor_label})`);
  ok(m?.vendor_license === "415820", `origin license (got ${m?.vendor_license})`);
  ok(m?.transfer_date === "2026-06-29", `transfer date (got ${m?.transfer_date})`);
  // 20 unique items despite the 2-page duplication + empty rows 21-34.
  ok(m?.lines.length === 20, `all 20 unique lines parsed (got ${m?.lines.length})`);
  ok(m?.lines[0].lot_code === "GF41582000123451", `line 1 lot (got ${m?.lines[0].lot_code})`);
  ok(
    m?.lines[0].product_name === "Select Series - Amaretto Sour - 3.5g",
    `line 1 description (got ${m?.lines[0].product_name})`,
  );
  ok(m?.lines[0].category === "Usable Cannabis", `line 1 type (got ${m?.lines[0].category})`);
  ok(m?.lines[0].received_qty === 15, `line 1 shipped (got ${m?.lines[0].received_qty})`);
  ok(m?.lines[19].lot_code === "GF41582000123453", `line 20 lot (got ${m?.lines[19].lot_code})`);
  const extract = m?.lines.find((l) => l.lot_code === "GF41582000123464");
  ok(extract?.category === "Extract For Inhalation", `extract line type (got ${extract?.category})`);
  ok(extract?.received_qty === 2, `extract line shipped (got ${extract?.received_qty})`);

  // transport
  ok(m?.transport?.driver_name === "David Sanchez", `driver name (got ${m?.transport?.driver_name})`);
  ok(m?.transport?.transporter_name === "Svin Garden", `carrier org (got ${m?.transport?.transporter_name})`);
  ok(
    m?.transport?.vehicle_description === "2015 blue toyota prius v",
    `vehicle description (got ${m?.transport?.vehicle_description})`,
  );
  ok(m?.transport?.vehicle_plate === "BWD5565", `vehicle plate (got ${m?.transport?.vehicle_plate})`);
  ok(m?.transport?.departed_at === "2026-06-29T08:44", `departure datetime (got ${m?.transport?.departed_at})`);
  ok(m?.transport?.eta_date === "2026-06-30", `eta from arrival estimate (got ${m?.transport?.eta_date})`);
  ok(m?.transport?.arrived_at === null, "arrived_at NOT guessed");
  ok((m?.transport?.route_notes ?? "").includes("I-5 S"), "route notes captured the directions");

  if (failed === 0) console.log(`pdf-transferlog-core: all ${passed} tests passed`);
  return { passed, failed };
}
