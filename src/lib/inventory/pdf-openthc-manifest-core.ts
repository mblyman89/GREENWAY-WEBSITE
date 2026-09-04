/**
 * src/lib/inventory/pdf-openthc-manifest-core.ts  (H15-PRE-c)
 *
 * PURE parser for the OpenTHC / "old method" combined **invoice-manifest** PDF —
 * the format some WA vendors (e.g. High End Farms) email where the invoice IS the
 * manifest (owner: "the invoice is also the manifest"). This is a DIFFERENT layout
 * from the WA LCB "Internal Shipping Document" handled by pdf-manifest-core.ts, so
 * it gets its own recognizer + parser and is tried as a fallback.
 *
 * Verified against a real Greenway artifact
 * (Greenway_Marijuana_-_260429_-_Invoice_01KQ7GS6EXA3DV5M.pdf). unpdf flattens the
 * page to a single blob; the real structure is:
 *
 *   Invoice #01KQ 7GS6 EXA3 DV5M
 *   Sold By: HIGH END FARMS #415771  Address: ...  Email: ...
 *   Ship To: GREENWAY MARIJUANA #413541  Address: ...
 *   Depart: Wed Apr, 29, 2026 07:10am  Arrive: Wed Apr, 29, 2026 04:20pm
 *   Inventory Lot Details  # Lot ID Product QA Count $/ea $/full
 *   1 01KQ 7GMB 2345 SZ7W  Lemon Skunk / Flower 3.5g / Eighth - Jar  23.53% 20 13.50 270.00
 *   ...
 *   Invoice Total: 1,146.00
 *
 * Notes:
 *  - The manifest/invoice number is a ULID printed in 4 space-separated groups
 *    ("01KQ 7GS6 EXA3 DV5M"); lot ids are the same 4-group ULID shape.
 *  - This layout carries per-line price + QA% (unlike the sparse LCB PDF path).
 *  - Depart/Arrive are transport times; est. arrival feeds the manifest ETA.
 *
 * DRAFTS-ONLY (standing rule): produces a ParsedManifest for human review only.
 */

import type { ParsedLine, ParsedManifest } from "@/lib/inventory/intake-parser";
import { emptyTransport, combineDateAndTime } from "@/lib/inventory/intake-parser";
import { splitStrainType } from "@/lib/inventory/pdf-manifest-core";

/** Greenway's own WA license — used to tell "sold by" (vendor) from "ship to" (us). */
const GREENWAY_LICENSE = "413541";

/** A ULID printed as four space-separated groups, e.g. "01KQ 7GS6 EXA3 DV5M". */
const GROUPED_ULID_RE = /\b([0-9A-HJKMNP-TV-Z]{4}(?:\s+[0-9A-HJKMNP-TV-Z]{4}){2,4})\b/gi;

/** Collapse a grouped ULID ("01KQ 7GMB 2345 SZ7W") to a single token. */
function collapseUlid(grouped: string): string {
  return grouped.replace(/\s+/g, "").toUpperCase();
}

/**
 * True when the flattened PDF text is an OpenTHC-style combined invoice-manifest.
 * Requires the "Inventory Lot Details" table header AND both the Sold By / Ship To
 * license lines, so a plain invoice (GrowFlow's separate invoice) is NOT matched.
 * PURE.
 */
export function looksLikeOpenThcInvoiceManifest(text: string): boolean {
  const t = text.toLowerCase();
  const hasLotTable = t.includes("inventory lot details");
  const hasSoldBy = /sold by\s*:/i.test(text);
  const hasShipTo = /ship to\s*:/i.test(text);
  const hasInvoiceNo = /invoice\s*#/i.test(text);
  return hasLotTable && hasSoldBy && hasShipTo && hasInvoiceNo;
}

/** Parse "Wed Apr, 29, 2026 04:20pm" -> ISO-ish "2026-04-29". PURE. Null if unparseable. */
export function parseOpenThcDate(raw: string | null): string | null {
  if (!raw) return null;
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  // "Apr, 29, 2026" (day/month order tolerant of the comma noise).
  const m = raw.match(/([A-Za-z]{3})[a-z]*\s*,?\s*(\d{1,2})\s*,?\s*(\d{4})/);
  if (!m) return null;
  const mon = months[m[1].toLowerCase()];
  if (!mon) return null;
  const day = m[2].padStart(2, "0");
  return `${m[3]}-${mon}-${day}`;
}

/**
 * Parse an OpenTHC invoice-manifest's flattened text into a ParsedManifest.
 * Returns null if it isn't this layout or no line items were read (so callers
 * can fall through). PURE.
 */
export function parseOpenThcInvoiceManifest(text: string): ParsedManifest | null {
  if (!looksLikeOpenThcInvoiceManifest(text)) return null;

  const flat = text.replace(/\s+/g, " ").trim();
  const warnings: string[] = [];

  // ── header fields ─────────────────────────────────────────────────────────
  // Invoice/manifest number: the grouped ULID right after "Invoice #".
  const invMatch = flat.match(/Invoice\s*#\s*([0-9A-HJKMNP-TV-Z]{4}(?:\s+[0-9A-HJKMNP-TV-Z]{4}){2,4})/i);
  const manifest_number = invMatch ? collapseUlid(invMatch[1]) : null;

  // Sold By (vendor): "Sold By: HIGH END FARMS #415771".
  const soldBy = flat.match(/Sold By\s*:\s*(.+?)\s*#\s*(\d{4,})/i);
  const vendor_label = soldBy ? soldBy[1].trim() : null;
  const vendor_license = soldBy ? soldBy[2].trim() : null;

  // Ship To (destination) — used only to confirm the transfer is addressed to us.
  const shipTo = flat.match(/Ship To\s*:\s*(.+?)\s*#\s*(\d{4,})/i);
  const destination_license = shipTo ? shipTo[2].trim() : null;

  // Depart/Arrive -> transfer date (departure day) for the row.
  const departRaw = flat.match(/Depart\s*:\s*([^]*?)\s*Arrive\s*:/i)?.[1] ?? null;
  const transfer_date = parseOpenThcDate(departRaw);

  // H15a — transport / ETA seed. Depart feeds departed_at (planned departure,
  // date + 12-hour time), Arrive feeds eta_date ONLY (it's an estimate — the
  // actual arrived_at is stamped by staff when the truck shows up). Drafts.
  const arriveRaw =
    flat.match(/Arrive\s*:\s*([A-Za-z]{3}\s+[A-Za-z]{3},?\s*\d{1,2},?\s*\d{4}\s*\d{1,2}:\d{2}\s*[ap]m)/i)?.[1] ??
    null;
  const transport = emptyTransport();
  transport.departed_at = combineDateAndTime(transfer_date, departRaw);
  transport.eta_date = parseOpenThcDate(arriveRaw);

  // ── line items ──────────────────────────────────────────────────────────
  // Rows sit inside the "Inventory Lot Details ... $/full" table. Each row:
  //   <line#> <grouped ULID lot id> <product ...> <qa%> <count> <$/ea> <$/full>
  // We anchor on grouped ULIDs that appear AFTER the table header, skipping the
  // invoice-number ULID itself.
  const tableIdx = flat.search(/Inventory Lot Details/i);
  const table = tableIdx >= 0 ? flat.slice(tableIdx) : flat;

  const lotMatches: { id: string; grouped: string; start: number; end: number }[] = [];
  for (const m of table.matchAll(GROUPED_ULID_RE)) {
    const collapsed = collapseUlid(m[1]);
    if (manifest_number && collapsed === manifest_number) continue; // skip inv# echo
    lotMatches.push({
      id: collapsed,
      grouped: m[1],
      start: m.index!,
      end: m.index! + m[1].length,
    });
  }

  const parsedLines: ParsedLine[] = [];
  for (let i = 0; i < lotMatches.length; i++) {
    const cur = lotMatches[i];
    const next = lotMatches[i + 1];
    const segment = table.slice(cur.end, next ? next.start : table.length);
    // "<product> <qa%> <count> <$/ea> <$/full>". The product runs up to the QA%
    // (a percentage) or, if absent, up to the first standalone integer count.
    // Capture: product, optional qa%, count, price/ea, price/full.
    const rowRe =
      /^\s*(.*?)\s+(?:(\d{1,3}(?:\.\d+)?)%\s+)?(\d+)\s+(\d+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)/;
    const rm = segment.match(rowRe);
    if (!rm) continue;
    const rawDesc = rm[1].replace(/\s+/g, " ").trim();
    // Strip a trailing line-number the next row leaks in, and a leading one.
    const desc = rawDesc.replace(/\s+\d{1,3}$/, "").replace(/^\d{1,3}\s+/, "").trim();
    const qaPct = rm[2] ? Number(rm[2]) : null;
    const count = Number(rm[3]);
    const priceEach = rm[4] ? Number(rm[4]) : null;
    if (!desc) continue;

    const { cleanName, strainType } = splitStrainType(desc);
    const lineWarnings: string[] = [];
    if (!cleanName) lineWarnings.push("Missing product name.");
    if (!Number.isFinite(count) || count <= 0)
      lineWarnings.push("Count is zero or missing.");
    lineWarnings.push(
      "From OpenTHC invoice-manifest PDF — verify against the JSON/official manifest during review.",
    );

    // Money in MINOR UNITS (cents), only when we read a real per-unit price.
    const unit_cost_minor_units =
      priceEach != null && Number.isFinite(priceEach)
        ? Math.round(priceEach * 100)
        : null;

    const line: ParsedLine = {
      product_name: cleanName || desc || null,
      lot_code: cur.id,
      pos_product_key: cur.id,
      brand_name: null,
      category: null,
      strain_name: null,
      strain_type: null,
      received_qty: Number.isFinite(count) ? count : 0,
      unit: "each",
      unit_cost_minor_units,
      unit_weight: null,
      unit_weight_uom: null,
      is_sample: false,
      is_medical: false,
      inventory_type: strainType,
      expires_on: null,
      // SLICE 18-0: compliance classification is never read from a manifest
      // (WA manifests carry no such field). Collected at Product Onboarding.
      low_thc_liquid: null,
      unit_thc_mg: null,
      otherwise_taken: null,
      units_per_package: null,
      lab: null,
      warnings: lineWarnings,
      // QA% on this layout is a headline potency figure whose exact metric isn't
      // labeled; keep it in raw for the reviewer rather than guessing its meaning.
      raw: { lot_code: cur.id, description: desc, count, priceEach, qaPercent: qaPct },
    };
    parsedLines.push(line);
  }

  if (parsedLines.length === 0) return null;

  warnings.push(
    "Parsed from an OpenTHC invoice-manifest PDF (drafts only) — verify against the JSON/official manifest before receiving.",
  );
  if (!manifest_number) warnings.push("No invoice/manifest number found in the PDF.");
  if (!vendor_label && !vendor_license)
    warnings.push("Could not read the sending licensee — set the vendor during review.");
  if (destination_license && destination_license !== GREENWAY_LICENSE)
    warnings.push(
      `Ship To licensee # on the invoice is ${destination_license}, not ${GREENWAY_LICENSE} (Greenway) — confirm this is addressed to us.`,
    );

  return {
    manifest_number,
    vendor_label,
    vendor_license,
    transfer_date,
    source_format: "pdf-manifest",
    lines: parsedLines,
    warnings,
    transport,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run via tsx / vitest). PURE — no I/O.
// The fixture is the flattened text of the owner's real High End Farms invoice.
// ---------------------------------------------------------------------------
const HEF_FIXTURE =
  "Invoice #01KQ 7GS6 EXA3 DV5M Sold By: HIGH END FARMS #415771 Address: 2515 HARTFORD DR STE B, LAKE STEVENS, WA 982580000 Phone: +1 425-789-1672 Email: highendfarms.manifests@gmail.com Ship To: GREENWAY MARIJUANA #413541 Address: 4851 GEIGER RD SE, PORT ORCHARD, WA 983669350 Phone: +1 360-443-6988 Depart: Wed Apr, 29, 2026 07:10am Arrive: Wed Apr, 29, 2026 04:20pm Inventory Lot Details # Lot ID Product QA Count $/ea $/full 1 01KQ 7GMB 2345 SZ7W Lemon Skunk / Flower 3.5g / Eighth - Jar 23.53% 20 13.50 270.00 2 01KQ 7GMH 20Q4 8A5H Sour Tangie / Flower 3.5g / Eighth - Jar 16.21% 10 13.50 135.00 3 01KQ 7GMP 81K9 BKX4 Sex Panther / Flower 3.5g / Eighth - Jar 25.59% 10 13.50 135.00 4 01KQ 7GN9 4DWP KTXT Lemon Skunk / Flower 7g / Quarter 23.53% 6 26.00 156.00 5 01KQ 7GNE 43ZW 3ADR Sour Tangie / Flower 7g / Quarter 16.21% 3 26.00 78.00 6 01KQ 7GNN 3BZH Y2W1 Sex Panther / Flower 7g / Quarter 25.59% 3 26.00 78.00 7 01KQ 7GNX XRQT 0PW6 Lemon Skunk / Flower 14g / Half 23.53% 2 49.00 98.00 8 01KQ 7GP3 EV35 MQP1 Sour Tangie / Flower 14g / Half 16.21% 2 49.00 98.00 9 01KQ 7GP8 H2Q3 ESEX Sex Panther / Flower 14g / Half 25.59% 2 49.00 98.00 9 Invoice Total: 1,146.00 Delivered By: Received By: Date: Page:1 of 1 Powered by TCPDF (www.tcpdf.org)";

export function __runOpenThcManifestTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  ok(looksLikeOpenThcInvoiceManifest(HEF_FIXTURE) === true, "HEF invoice recognized as invoice-manifest");
  ok(
    looksLikeOpenThcInvoiceManifest("Invoice Order #: 29127 Bill To: Greenway License: 413541 Product Qty Total") === false,
    "plain GrowFlow-style invoice (no Lot Details) NOT recognized",
  );
  ok(
    looksLikeOpenThcInvoiceManifest("Internal Shipping Document Manifest ID: 1137 Batch") === false,
    "LCB shipping document NOT recognized as OpenTHC invoice-manifest",
  );

  const m = parseOpenThcInvoiceManifest(HEF_FIXTURE);
  ok(m !== null, "HEF fixture parsed");
  ok(m?.manifest_number === "01KQ7GS6EXA3DV5M", "invoice/manifest number collapsed from grouped ULID");
  ok(m?.vendor_label === "HIGH END FARMS", "vendor label from Sold By");
  ok(m?.vendor_license === "415771", "vendor license from Sold By");
  ok(m?.transfer_date === "2026-04-29", "transfer date from Depart");
  ok(m?.lines.length === 9, "all 9 lot lines parsed");
  ok(m?.lines[0].lot_code === "01KQ7GMB2345SZ7W", "first lot id collapsed");
  ok((m?.lines[0].product_name ?? "").includes("Lemon Skunk"), "first product name read");
  ok(m?.lines[0].received_qty === 20, "first line count read");
  ok(m?.lines[0].unit_cost_minor_units === 1350, "first line price in minor units (cents)");
  ok(
    (m?.lines[0].raw as { qaPercent?: number } | undefined)?.qaPercent === 23.53,
    "first line QA% captured in raw",
  );
  ok(m?.lines[8].lot_code === "01KQ7GP8H2Q3ESEX", "last lot id collapsed");
  ok(m?.lines[8].received_qty === 2, "last line count read");

  // parseOpenThcDate edge cases.
  ok(parseOpenThcDate("Wed Apr, 29, 2026 07:10am") === "2026-04-29", "date parse");
  ok(parseOpenThcDate(null) === null, "null date -> null");
  ok(parseOpenThcDate("no date here") === null, "unparseable date -> null");

  // H15a — transport / ETA seed: Depart 07:10am -> departed_at (date+time),
  // Arrive 04:20pm same day -> eta_date ONLY (estimate; actual arrival is
  // stamped by staff), everything else honestly null on this layout.
  ok(m?.transport?.departed_at === "2026-04-29T07:10", `depart seeded (got ${m?.transport?.departed_at})`);
  ok(m?.transport?.eta_date === "2026-04-29", `eta from Arrive (got ${m?.transport?.eta_date})`);
  ok(m?.transport?.arrived_at === null, "arrived_at NOT guessed");
  ok(m?.transport?.transporter_name === null, "transporter honestly null (not on this layout)");

  if (failed === 0) console.log(`pdf-openthc-manifest-core: all ${passed} tests passed`);
  return { passed, failed };
}
