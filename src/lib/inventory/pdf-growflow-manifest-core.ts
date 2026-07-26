/**
 * src/lib/inventory/pdf-growflow-manifest-core.ts  (H16b-1)
 *
 * PURE parser for the GROWFLOW "Manifest" PDF, operating on the PLAIN TEXT
 * already extracted by the serverless-safe `unpdf` extractor (the I/O lives in
 * the server-only pdf-extract.ts). No I/O, no `server-only`, so it is
 * unit-testable with vitest against a saved fixture (the exact unpdf output of
 * the owner's real hayaa_green_manifest.pdf).
 *
 * WHY this is a SEPARATE parser (verified, not guessed): GrowFlow emits THREE
 * documents — an Invoice (parsed elsewhere as a GrowFlow invoice), a
 * "Transfer Log (This document is NOT a manifest)", and a real "Manifest".
 * Only the Manifest carries the LCB-style chain-of-custody the review form
 * needs: the Transportation License (carrier), Estimated Departure/Arrival,
 * Driver & Vehicle block, and the Manifest ID. The GrowFlow invoice does NOT
 * carry transport; the OpenTHC invoice only carries Depart/Arrive. So when a
 * GrowFlow (or old-method) email arrives we must read THIS document to fill the
 * carrier/driver/vehicle/route/ETA fields — that is exactly the "manifest
 * details are not pre-populated" gap the owner reported.
 *
 * unpdf flattens the PDF to a single FLOWING blob (positional layout is lost).
 * The header fields come out as clumped label/value runs, e.g.
 *   "Transportation License Information License Name: TERPENE TRANSIT License #: 426061"
 *   "Estimated Departure / Arrival Departure Date/Time: 06/26/2026 01:28 PM Arrival Date/Time: 06/29/2026 05:33 PM"
 *   "Driver & Vehicle Information Driver Name: TERPENE TRANSIT VIN #: n/a Vehicle License Plate: n/a ..."
 *   "Manifest ID:GF42612700007100-1633182-1"
 * The line table is a run of:
 *   <GF + 14 digits InventoryID> EndProduct/<Category>/<Description>/<No|Yes>/<wt>/<count>/<lotcode>-<seq> <qty>.00 Each
 *
 * DRAFTS-ONLY (standing rule): produces a ParsedManifest for HUMAN review only;
 * never activates stock. The GrowFlow manifest carries NO per-line price or COA
 * (those are in the invoice / QA PDF), so lines are SPARSE and warned as such.
 * arrived_at is NEVER guessed — staff stamp the actual arrival on receipt.
 */

import type { ParsedManifest, ParsedLine } from "@/lib/inventory/intake-parser";
import { emptyTransport, combineDateAndTime } from "@/lib/inventory/intake-parser";

/**
 * A GrowFlow manifest is recognizable by the "Manifest ID:GF..." token plus the
 * "Transportation License Information" / "Estimated Departure / Arrival" blocks
 * that only this document carries. We require the GrowFlow-style Manifest ID
 * (GF + digits + dashes) so we don't collide with the LCB Internal Shipping
 * Document (numeric-only manifest id) or the OpenTHC invoice.
 */
export function looksLikeGrowFlowManifest(text: string): boolean {
  if (!text) return false;
  const hasGfManifestId = /Manifest ID:\s*GF\d{6,}/i.test(text);
  const hasTransportBlock =
    /Transportation License Information/i.test(text) ||
    /Estimated Departure\s*\/\s*Arrival/i.test(text);
  const hasItems = /Transported Items/i.test(text) || /InventoryID\s*\/\s*Plant ID/i.test(text);
  return hasGfManifestId && (hasTransportBlock || hasItems);
}

/** Normalize a "06/26/2026" (m/d/yyyy or m/d/yy) date to YYYY-MM-DD. PURE. */
export function normalizeGrowFlowDate(raw: string | null): string | null {
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

/** Grab the value after a label, up to the next known label or end. Trimmed, or null. */
function grab(text: string, re: RegExp): string | null {
  const m = text.match(re);
  const v = m?.[1]?.trim() ?? null;
  return v && v.length > 0 ? v : null;
}

/** true when a captured value is a real value (not "n/a" / "Not Applicable" / blank). */
function meaningful(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (/^(n\/?a|not applicable|none|unknown)$/i.test(t)) return null;
  return t;
}

type GfLine = {
  inventoryId: string;
  category: string | null;
  description: string;
  isMedical: boolean;
  qty: number;
};

/**
 * Parse the "Transported Items" run. Anchor each row on the InventoryID
 * (GF + 14 digits) and read the EndProduct/... blob + trailing "<qty>.00 Each".
 * The blob shape (verified against the real sample) is:
 *   EndProduct/<Category>/<Description ...>/<No|Yes>/<wt>/<unit>/<lotcode chunks>
 * where <Description> is everything between the category slash and the
 * "/No/" or "/Yes/" medical flag. unpdf inserts spaces mid-token, so the lot
 * code tail is noisy — we only need category, description, medical flag, qty.
 */
export function parseGrowFlowItems(text: string): GfLine[] {
  const out: GfLine[] = [];
  // Cut to the items region if present (avoids matching GF ids in the header).
  const startIdx = text.search(/Transported Items/i);
  const region = startIdx >= 0 ? text.slice(startIdx) : text;

  // Each row: InventoryID  EndProduct/<...>  <qty>.00 Each
  // The description ends at the first "/No/" or "/Yes/" (the medical flag).
  const rowRe =
    /(GF\d{14})\s+EndProduct\/([^/]+)\/(.+?)\/(No|Yes)\/[\s\S]*?(\d+(?:\.\d+)?)\s*Each/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(region)) !== null) {
    const inventoryId = m[1];
    const category = m[2]?.trim() || null;
    // Description can contain unpdf-inserted line-wraps; collapse whitespace.
    const description = m[3].replace(/\s+/g, " ").trim();
    const isMedical = /^yes$/i.test(m[4]);
    const qty = Math.round(Number(m[5]));
    if (!description) continue;
    out.push({ inventoryId, category, description, isMedical, qty: Number.isFinite(qty) ? qty : 0 });
  }
  return out;
}

/** Map a GrowFlow item to a sparse ParsedLine (drafts-only; no price/COA here). */
function toParsedLine(g: GfLine): ParsedLine {
  const warnings = [
    "From a GrowFlow manifest PDF — no per-line price/COA on this document; enrich during review.",
  ];
  return {
    product_name: g.description,
    lot_code: g.inventoryId,
    pos_product_key: g.inventoryId,
    brand_name: null,
    category: g.category,
    strain_name: null,
    strain_type: null,
    received_qty: g.qty,
    unit: "each",
    unit_cost_minor_units: null,
    unit_weight: null,
    unit_weight_uom: null,
    is_sample: false,
    is_medical: g.isMedical,
    inventory_type: null,
    expires_on: null,
    lab: null,
    warnings,
    raw: {
      inventory_id: g.inventoryId,
      category: g.category,
      description: g.description,
      is_medical: g.isMedical,
      qty: g.qty,
    },
  };
}

/**
 * Parse a GrowFlow manifest PDF's text into a ParsedManifest with full
 * transport chain-of-custody. Returns null if it isn't a GrowFlow manifest.
 */
export function parseGrowFlowManifest(text: string): ParsedManifest | null {
  if (!looksLikeGrowFlowManifest(text)) return null;

  // ── Header ────────────────────────────────────────────────────────────────
  const manifest_number =
    grab(text, /Manifest ID:\s*(GF[\d-]+)/i) ?? null;

  // Origin licensee = the sending VENDOR (the "Origin License Name/#").
  const vendor_label = grab(text, /Origin License Name:\s*([^]*?)\s*Licensee Phone:/i);
  const vendor_license = grab(text, /(?:Origin License Information[\s\S]*?)?License #:\s*(\d{5,})/i);

  const transfer_date = normalizeGrowFlowDate(grab(text, /\bDate:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i));

  // ── Transport / chain-of-custody ────────────────────────────────────────────
  const transport = emptyTransport();

  // Carrier: the "Transportation License Information" block.
  const carrierName = grab(
    text,
    /Transportation License Information\s*License Name:\s*([^]*?)\s*License #:/i,
  );
  const carrierLicense = grab(
    text,
    /Transportation License Information[\s\S]*?License #:\s*(\d{4,})/i,
  );
  transport.transporter_name = meaningful(carrierName);
  transport.transporter_license = meaningful(carrierLicense);

  // Estimated Departure / Arrival.
  const departM = text.match(
    /Departure Date\/Time:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*([\d:]+\s*[AP]M)/i,
  );
  const arriveM = text.match(
    /Arrival Date\/Time:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*([\d:]+\s*[AP]M)/i,
  );
  transport.departed_at = departM
    ? combineDateAndTime(normalizeGrowFlowDate(departM[1]), departM[2])
    : null;
  // Arrival on this doc is the ESTIMATE → seed eta_date only, never arrived_at.
  transport.eta_date = arriveM ? normalizeGrowFlowDate(arriveM[1]) : null;

  // Driver & Vehicle block.
  transport.driver_name = meaningful(grab(text, /Driver Name:\s*([^]*?)\s*VIN #:/i));
  transport.vehicle_vin = meaningful(grab(text, /VIN #:\s*([^]*?)\s*Vehicle License Plate:/i));
  transport.vehicle_plate = meaningful(
    grab(text, /Vehicle License Plate:\s*([^]*?)\s*Vehicle Color:/i),
  );
  // Vehicle description = Color + Make + Model, when present.
  const color = meaningful(grab(text, /Vehicle Color:\s*([^]*?)\s*Vehicle Make:/i));
  const make = meaningful(grab(text, /Vehicle Make:\s*([^]*?)\s*Vehicle Model:/i));
  const model = meaningful(grab(text, /Vehicle Model:\s*([^]*?)(?:Destination License|$)/i));
  const desc = [color, make, model].filter(Boolean).join(" ").trim();
  transport.vehicle_description = desc.length > 0 ? desc : null;

  // Route notes = the Travel Reminders paragraph (planning text), when present.
  const remindersM = text.match(/Travel Reminders\s*([\s\S]*?)\s*Manifest\s+Manifest ID:/i);
  if (remindersM) {
    const note = remindersM[1].replace(/\s+/g, " ").trim();
    transport.route_notes = note.length > 0 ? note : null;
  }

  // ── Lines ────────────────────────────────────────────────────────────────
  const items = parseGrowFlowItems(text);
  const lines = items.map(toParsedLine);

  return {
    manifest_number,
    vendor_label: vendor_label ?? null,
    vendor_license: vendor_license ?? null,
    transfer_date,
    source_format: "pdf-manifest",
    lines,
    warnings: [
      "Parsed from a GrowFlow manifest PDF (drafts only) — verify carrier, ETA, and line items before receiving.",
    ],
    transport,
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (mirror pdf-manifest-core). Runs against the real sample
// text passed in by the compliance test.
// ---------------------------------------------------------------------------
export function __runGrowFlowManifestTests(sampleText: string): {
  passed: number;
  failed: number;
} {
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
  ok(normalizeGrowFlowDate("06/26/2026") === "2026-06-26", "date m/d/yyyy → iso");
  ok(normalizeGrowFlowDate("6/1/26") === "2026-06-01", "date m/d/yy → iso");
  ok(normalizeGrowFlowDate("nope") === null, "bad date → null");

  // classifier
  ok(looksLikeGrowFlowManifest(sampleText) === true, "sample recognized as GrowFlow manifest");
  ok(
    looksLikeGrowFlowManifest("Internal Shipping Document Manifest ID: 21544 Batch") === false,
    "LCB numeric manifest not mistaken for GrowFlow",
  );
  ok(
    looksLikeGrowFlowManifest("Invoice #01KM Inventory Lot Details QA Count") === false,
    "OpenTHC invoice not mistaken for GrowFlow manifest",
  );

  // full parse
  const m = parseGrowFlowManifest(sampleText);
  ok(m !== null, "sample parses");
  ok(m?.source_format === "pdf-manifest", "source_format tagged");
  ok(m?.manifest_number === "GF42612700007100-1633182-1", `manifest id read (got ${m?.manifest_number})`);
  ok(m?.vendor_label === "HAYAA GREEN LLC", `origin vendor read (got ${m?.vendor_label})`);
  ok(m?.vendor_license === "426127", `origin license read (got ${m?.vendor_license})`);
  ok(m?.transfer_date === "2026-06-24", `transfer date read (got ${m?.transfer_date})`);
  ok(m?.lines.length === 15, `all 15 line items parsed (got ${m?.lines.length})`);
  ok(m?.lines[0].lot_code === "GF42612705585563", `line 1 inventory id (got ${m?.lines[0].lot_code})`);
  ok(
    m?.lines[0].product_name === "Legacy - DOH Jays .5g - Legacy Glue - 1g",
    `line 1 description cleaned (got ${m?.lines[0].product_name})`,
  );
  ok(m?.lines[0].category === "Usable Cannabis", `line 1 category (got ${m?.lines[0].category})`);
  ok(m?.lines[0].is_medical === false, "line 1 not medical (No)");
  ok(m?.lines[0].received_qty === 20, `line 1 qty (got ${m?.lines[0].received_qty})`);
  // An infused/medical line (the "Yes" flag).
  const truffle = m?.lines.find((l) => /Triple Truffle Jays/.test(l.product_name ?? ""));
  ok(!!truffle, "infused truffle line present");
  ok(truffle?.is_medical === true, "infused truffle line marked medical (Yes)");
  ok(truffle?.category === "Cannabis Mix Infused", `truffle category (got ${truffle?.category})`);

  // transport / chain-of-custody
  ok(
    m?.transport?.transporter_name === "TERPENE TRANSIT",
    `carrier name (got ${m?.transport?.transporter_name})`,
  );
  ok(
    m?.transport?.transporter_license === "426061",
    `carrier license (got ${m?.transport?.transporter_license})`,
  );
  ok(
    m?.transport?.departed_at === "2026-06-26T13:28",
    `departure datetime (got ${m?.transport?.departed_at})`,
  );
  ok(m?.transport?.eta_date === "2026-06-29", `eta from arrival estimate (got ${m?.transport?.eta_date})`);
  ok(
    m?.transport?.driver_name === "TERPENE TRANSIT",
    `driver name (got ${m?.transport?.driver_name})`,
  );
  ok(m?.transport?.vehicle_vin === null, "VIN honestly null (n/a on this sample)");
  ok(m?.transport?.vehicle_plate === null, "plate honestly null (n/a on this sample)");
  ok(m?.transport?.arrived_at === null, "arrived_at NOT guessed (staff stamp actual arrival)");
  ok(
    (m?.transport?.route_notes ?? "").includes("RCW 69.50.342"),
    "route notes captured the Travel Reminders text",
  );

  if (failed === 0) console.log(`pdf-growflow-manifest-core: all ${passed} tests passed`);
  return { passed, failed };
}
