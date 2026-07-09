/**
 * src/lib/inventory/pdf-manifest-core.ts  (H14a)
 *
 * PURE parser for the WA LCB "Internal Shipping Document (Third Party)" manifest
 * PDF, operating on the PLAIN TEXT already extracted by the serverless-safe
 * `unpdf` extractor (the I/O — running unpdf on the PDF bytes — lives in the
 * server-only companion pdf-extract.ts). No I/O, no `server-only` imports here,
 * so it is unit-testable with vitest against a saved fixture.
 *
 * WHY unpdf (verified, not guessed): the app runs on Vercel serverless, which
 * has NO poppler/`pdftotext` binary. `unpdf` is a pure-JS (pdf.js) extractor
 * with zero native deps, so the SAME code path works in the sandbox, CI, and
 * production. We proved its output against the owner's real sample and shaped
 * this parser to that output — NOT to `pdftotext -layout`, which produces a
 * different (positional) layout unavailable in production.
 *
 * unpdf emits a single FLOWING text blob (positional layout is lost). The line
 * table comes out as a run of:
 *
 *   <17-digit Batch/Lot ID> <Item Description ...> <shipped>.00<NEXT line #>
 *
 * e.g. "11373796120454282 Northwest Concentrates - ... - 1g [ H ] 20.001"
 * where the trailing "1" is the NEXT row's line number (Crystal Reports draws
 * the # column to the right). We therefore anchor on the 17-digit lot ids and
 * read the description + shipped qty between consecutive ids. The header fields
 * (Manifest ID, License #, sending Licensee name, Date) are recovered by anchor
 * regexes that tolerate the reordered blob.
 *
 * HONEST LIMITATION (surfaced as warnings, never guessed): this PDF carries NO
 * per-line price, COA URL, or lab-test id — those live in the vendor's JSON /
 * the separate CCRS files. So a PDF import produces SPARSE draft lines
 * (lot id, product name, type, shipped qty). Staff enrich the rest during
 * review. This mirrors the standing rule: machine output is a DRAFT.
 */

import type { ParsedManifest, ParsedLine } from "@/lib/inventory/intake-parser";
import { emptyTransport, combineDateAndTime } from "@/lib/inventory/intake-parser";

/** A blank sparse line pre-filled for the PDF path (no lab / price data). */
function blankPdfLine(raw: unknown, warnings: string[]): ParsedLine {
  return {
    product_name: null,
    lot_code: null,
    pos_product_key: null,
    brand_name: null,
    category: null,
    strain_name: null,
    received_qty: 0,
    unit: "each",
    unit_cost_minor_units: null,
    unit_weight: null,
    unit_weight_uom: null,
    is_sample: false,
    is_medical: false,
    inventory_type: null,
    expires_on: null,
    lab: null,
    warnings,
    raw,
  };
}

/** m/d/yy or m/d/yyyy (optionally trailed by a time) → YYYY-MM-DD, else null. */
export function normalizePdfDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  let yy = Number(m[3]);
  if (m[3].length === 2) yy = 2000 + yy; // "26" → 2026
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${yy}-${p(mm)}-${p(dd)}`;
}

/**
 * The trailing "[ H ]" / "[ I ]" / "[ S ]" token on WA descriptions encodes the
 * strain type. Returns { cleanName, strainType } with the token stripped.
 * H = hybrid, I = indica, S = sativa (WA convention). Anything else → null type.
 */
export function splitStrainType(description: string): {
  cleanName: string;
  strainType: "hybrid" | "indica" | "sativa" | null;
} {
  const m = description.match(/\[\s*([HIShis])\s*\]\s*$/);
  if (!m) return { cleanName: description.trim(), strainType: null };
  const letter = m[1].toUpperCase();
  const strainType =
    letter === "H" ? "hybrid" : letter === "I" ? "indica" : "sativa";
  const cleanName = description.slice(0, m.index).trim();
  return { cleanName, strainType };
}

/**
 * Does this extracted text look like a WA LCB Internal Shipping Document?
 * We require the document title (or the Manifest ID + Batch header) AND a
 * Manifest ID number so we never misclassify some other PDF (e.g. an invoice).
 */
export function looksLikeShippingManifest(text: string): boolean {
  const t = text.toLowerCase();
  const hasTitle =
    t.includes("internal shipping document") ||
    (t.includes("manifest id") && t.includes("batch"));
  const hasManifestId = /manifest id\s*[:#]?\s*\d{6,}/i.test(text);
  return hasTitle && hasManifestId;
}

/**
 * Parse the extracted text of an Internal Shipping Document into a
 * ParsedManifest. PURE. Returns null if it doesn't look like a manifest or if
 * no line items are found (so the caller can fall through to other parsers).
 */
export function parseShippingManifestText(text: string): ParsedManifest | null {
  if (!looksLikeShippingManifest(text)) return null;

  // Collapse all whitespace (incl. form-feeds/newlines) to single spaces so the
  // anchors work regardless of how unpdf laid the blob out.
  const flat = text.replace(/\s+/g, " ").trim();

  // ── header fields ──────────────────────────────────────────────────────
  const manifest_number =
    flat.match(/Manifest ID\s*[:#]?\s*(\d{6,})/i)?.[1]?.trim() ?? null;

  const vendor_license =
    flat.match(/License\s*#\s*:\s*(\d{4,})/i)?.[1]?.trim() ??
    // unpdf can drop the "License # :" label near the value; fall back to a
    // 6-digit WA licence number that is NOT our destination (413541).
    (() => {
      const nums = [...flat.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
      const notUs = nums.find((n) => n !== "413541");
      return notUs ?? null;
    })();

  // Sending licensee (vendor) name. In the blob it sits right after the source
  // "License # :" value / near "Page 1 of N". We anchor on the licence number
  // followed by a Name-like token, else on the last "<digits> <Titlecase Name>"
  // that precedes the first 17-digit lot id.
  let vendor_label: string | null = null;
  {
    // Prefer: "<vendor_license> <Name>" that sits just before the first 17-digit
    // lot id (e.g. "412347 Xtracted Labs 11373796120454282 ...").
    if (vendor_license) {
      const re = new RegExp(
        `\\b${vendor_license}\\s+([A-Z][A-Za-z0-9&.'()\\- ]{2,60}?)\\s+\\d{16,18}\\b`,
      );
      const m = flat.match(re);
      if (m) vendor_label = m[1].trim();
    }
    // Fallback: the Title-case token that immediately precedes the FIRST lot id.
    if (!vendor_label) {
      const m = flat.match(/([A-Z][A-Za-z0-9&.'()\- ]{2,60}?)\s+\d{16,18}\b/);
      if (m) vendor_label = m[1].replace(/.*\b\d{4,}\s+/, "").trim();
    }
  }

  // The manifest "Date :" value often drifts away from its label in the blob.
  // In this layout the true manifest date is the one printed immediately before
  // the barcode glyph (¶<manifest-id>...). Prefer that; then the labelled value;
  // then a date that is NOT the delivery-deadline / departure lines.
  //
  // H16b-2 fix: the Cultivera variant prints a fixed "8/6/91" inside the
  // DISCLAIMER preamble. The old generic fallback grabbed THAT (yielding a bogus
  // 2091-08-06). So the generic fallback now searches only AFTER the disclaimer
  // (past "Instructions:" when present) and rejects the 8/6/91 literal.
  const afterDisclaimer = (() => {
    const idx = flat.search(/Instructions:/i);
    return idx >= 0 ? flat.slice(idx) : flat;
  })();
  const firstRealDate =
    [...afterDisclaimer.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)]
      .map((m) => m[1])
      .find((d) => d !== "8/6/91") ?? null;
  const transfer_date = normalizePdfDate(
    flat.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*\u00b6/)?.[1] ??
      flat.match(/Date\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1] ??
      firstRealDate ??
      null,
  );

  const destination_license =
    flat.match(/Destination Licensee\s*#\s*:\s*(\d{4,})/i)?.[1]?.trim() ?? null;

  // ── transport / ETA seed (H15a) ─────────────────────────────────────────
  // Anchors verified against the real unpdf blob of the owner's sample:
  //  • "Internal Shipping Document (Third Party) <m/d/yy h:mm am>" — that
  //    datetime is the Transporter Departure Time (unpdf drifts it up here).
  //  • "Travel Route <m/d/yy h:mm am>" — that datetime is the Delivery
  //    Deadline (latest arrival), which seeds eta_date. NEVER arrived_at —
  //    staff stamp the actual arrival when the truck shows up.
  //  • The transport company name sits between the clumped "Departure Time:"
  //    and "Delivery Deadline:" labels (e.g. "TERPENE TRANSIT").
  // Vehicle/driver fields are blank on this layout's sample, so we honestly
  // leave them null rather than guess at anchors. All values are DRAFTS.
  const DT_RE = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s*[ap]m)/i;
  const departM = flat
    .match(new RegExp(`Internal Shipping Document \\(Third Party\\)\\s+${DT_RE.source}`, "i"));
  const deadlineM = flat.match(new RegExp(`Travel Route\\s+${DT_RE.source}`, "i"));
  const transporterM = flat.match(
    /Departure Time\s*:\s*([A-Z][A-Za-z0-9&.'()\- ]{2,60}?)\s*Delivery Deadline/,
  );
  const transport = emptyTransport();
  transport.departed_at = departM
    ? combineDateAndTime(normalizePdfDate(departM[1]), departM[2])
    : null;
  transport.eta_date = deadlineM ? normalizePdfDate(deadlineM[1]) : null;
  {
    const name = transporterM?.[1]?.trim() ?? null;
    // Reject anything date-like so a drifted datetime can't masquerade as a name.
    transport.transporter_name = name && !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(name) ? name : null;
  }

  // ── Cultivera "Internal Shipping Document" layout (H16b-2) ──────────────────
  // Verified against the owner's REAL Everigreene manifest. This variant uses
  // different anchors than the (Third Party) one above:
  //  • "Transporter Name:" ... the driver/transporter name (e.g. "Tyler hart").
  //    The value drifts after the "Transporter Date of Birth:" label in the
  //    unpdf blob, so we accept the Title-case token that follows either label.
  //  • "Vehicle Color / Make / Model / License Plate:" ... one clumped value
  //    (e.g. "2006 blue subaru impreza chb65209") — the last token is the plate.
  //  • The route + the two "Approx. Departure/Arrival Date/Time" values sit as a
  //    clumped run right before the barcode glyph: "<route text> <dep date time>
  //    <arr date time> <date> ¶<manifest-id>". First datetime = departure,
  //    second = the arrival ESTIMATE → eta_date only, never arrived_at.
  //  • "Travel Route <turn-by-turn> ... will be on the left" → route_notes.
  // Only fill fields the (Third Party) anchors above did NOT already find, so we
  // never clobber the existing sample. DRAFTS, honest nulls, no guessing.
  {
    // Two clumped "m/d/yy h:mm am" datetimes just before the barcode glyph.
    const clump = flat.match(
      new RegExp(`${DT_RE.source}\\s+${DT_RE.source}\\s+\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}[^\\u00b6]*\\u00b6`, "i"),
    );
    if (clump) {
      if (!transport.departed_at) {
        transport.departed_at = combineDateAndTime(normalizePdfDate(clump[1]), clump[2]);
      }
      if (!transport.eta_date) transport.eta_date = normalizePdfDate(clump[3]);
    }

    if (!transport.transporter_name) {
      // "Transporter Name:" then (optionally) "Transporter Date of Birth:" then
      // the actual name value (unpdf drifts the value after the DOB label).
      const tm =
        flat.match(
          /Transporter Name:\s*(?:Transporter Date of Birth:\s*)?([A-Za-z][A-Za-z.'\- ]{1,50}?)\s*(?:Approx\.|Page |License |Destination)/i,
        ) ?? flat.match(/Transporter Name:\s*([A-Za-z][A-Za-z.'\- ]{1,50}?)\s{2,}/i);
      const name = tm?.[1]?.trim() ?? null;
      transport.transporter_name =
        name && !/\d/.test(name) && !/date of birth/i.test(name) ? name : null;
    }

    // Vehicle line: "<year> <color> <make> <model> <plate>" clumped after the
    // "Licensee Phone:" that precedes it in this layout, e.g.
    //   "Licensee Phone: 360-451-7357 2006 blue subaru impreza chb65209".
    // We require a plausible model YEAR (19xx/20xx) followed by a lowercase
    // COLOR WORD then make/model then a plate — this deliberately EXCLUDES a
    // street address like "4851 GEIGER RD SE" (4851 isn't a 19xx/20xx year and
    // "GEIGER" is upper-case). The last token is the license plate.
    if (!transport.vehicle_description) {
      const vm = flat.match(
        /\b((?:19|20)\d{2}\s+[a-z]{3,}\s+[a-z][a-z0-9]{2,}\s+[a-z][a-z0-9]{1,}\s+[a-z0-9]{5,8})\b/,
      );
      if (vm) {
        const parts = vm[1].trim().split(/\s+/);
        const plate = parts[parts.length - 1];
        transport.vehicle_description = parts.slice(0, -1).join(" ").trim() || null;
        if (!transport.vehicle_plate && /^[a-z0-9]{5,8}$/i.test(plate)) {
          transport.vehicle_plate = plate.toUpperCase();
        }
      }
    }

    if (!transport.route_notes) {
      const routeM = flat.match(
        /Travel Route\s+([A-Z][\s\S]*?(?:will be on the left|Destination will be on the left))/i,
      );
      if (routeM) {
        const note = routeM[1].replace(/\s+/g, " ").trim();
        // Only keep if it reads like directions, not a bare datetime.
        if (note.length > 15 && /[a-z]/.test(note)) transport.route_notes = note;
      }
    }
  }

  // ── line items ─────────────────────────────────────────────────────────
  // Anchor on 17-digit lot ids. For each, the description runs up to the shipped
  // qty ("20.00"); a trailing digit run after the qty is the NEXT row's line #.
  const lotRe = /\b(\d{16,18})\b/g;
  const lotStarts: { id: string; start: number; end: number }[] = [];
  for (const m of flat.matchAll(lotRe)) {
    // Skip the manifest id itself (it also matches \d{16,18}).
    if (manifest_number && m[1] === manifest_number) continue;
    lotStarts.push({ id: m[1], start: m.index!, end: m.index! + m[1].length });
  }

  const parsedLines: ParsedLine[] = [];
  for (let i = 0; i < lotStarts.length; i++) {
    const cur = lotStarts[i];
    const next = lotStarts[i + 1];
    // Segment between this lot id and the next (or end of blob).
    const segment = flat.slice(cur.end, next ? next.start : flat.length);
    // The shipped qty ends the row: "... 20.00" possibly followed by the next
    // line #. Capture "<desc> <qty>.<dd>" and stop there.
    const qm = segment.match(/^(.*?)(\d+\.\d{2})(?:\d+)?\b/);
    if (!qm) continue;
    const rawDesc = qm[1].replace(/\s+/g, " ").trim();
    const shipped = Number(qm[2]);
    if (!rawDesc) continue;
    const { cleanName, strainType } = splitStrainType(rawDesc);

    const warnings: string[] = [];
    if (!cleanName) warnings.push("Missing product name.");
    if (!Number.isFinite(shipped) || shipped <= 0)
      warnings.push("Shipped quantity is zero or missing.");
    warnings.push("From PDF manifest — no COA/price captured; enrich during review.");

    const l = blankPdfLine({ lot_code: cur.id, description: rawDesc, shipped }, warnings);
    l.product_name = cleanName || null;
    l.lot_code = cur.id;
    l.pos_product_key = cur.id; // best available key for catalog linking
    l.inventory_type = strainType;
    l.received_qty = Number.isFinite(shipped) ? shipped : 0;
    l.unit = "each";
    parsedLines.push(l);
  }

  if (parsedLines.length === 0) return null;

  const warnings: string[] = [];
  warnings.push(
    "Parsed from a PDF shipping document (drafts only) — verify against the official LCB manifest before receiving.",
  );
  if (!manifest_number) warnings.push("No Manifest ID found in the PDF.");
  if (!vendor_label && !vendor_license)
    warnings.push("Could not read the sending licensee — set the vendor during review.");
  if (destination_license && destination_license !== "413541")
    warnings.push(
      `Destination licensee # on the manifest is ${destination_license}, not 413541 (Greenway) — confirm this manifest is addressed to us.`,
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
// Self-tests (run via vitest through pdf-manifest.test.ts). Pure — no I/O.
// The fixture is the exact unpdf output of the owner's real sample.
// ---------------------------------------------------------------------------
export function __runPdfManifestTests(sampleText: string): { passed: number; failed: number } {
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
  ok(normalizePdfDate("6/25/26") === "2026-06-25", "date m/d/yy → iso");
  ok(normalizePdfDate("12/1/2025") === "2025-12-01", "date m/d/yyyy → iso");
  ok(normalizePdfDate("nope") === null, "bad date → null");

  // strain-type splitter
  ok(splitStrainType("Moonbow - 1g [ H ]").strainType === "hybrid", "[H] → hybrid");
  ok(splitStrainType("Trufflez - 1g [ I ]").strainType === "indica", "[I] → indica");
  ok(splitStrainType("Maui Waui [ S ]").strainType === "sativa", "[S] → sativa");
  ok(splitStrainType("No suffix here").strainType === null, "no token → null type");
  ok(splitStrainType("Moonbow - 1g [ H ]").cleanName === "Moonbow - 1g", "token stripped from name");

  // classifier
  ok(looksLikeShippingManifest(sampleText) === true, "sample recognized as manifest");
  ok(looksLikeShippingManifest("just an invoice, total due $500") === false, "invoice not a manifest");

  // full parse against the real sample
  const m = parseShippingManifestText(sampleText);
  ok(m !== null, "sample parses");
  ok(m?.source_format === "pdf-manifest", "source_format tagged");
  ok(m?.manifest_number === "11374279827298553", "manifest id read");
  ok(m?.vendor_license === "412347", "sending license # read");
  ok(m?.transfer_date === "2026-06-25", "transfer date read");
  ok(m?.lines.length === 9, `all 9 line items parsed (got ${m?.lines.length})`);
  ok(m?.lines[0].lot_code === "11373796120454282", "line 1 lot id");
  ok(m?.lines[0].product_name === "Northwest Concentrates - SELECT DABS - Moonbow - 1g", "line 1 name cleaned");
  ok(m?.lines[0].inventory_type === "hybrid", "line 1 type from [H]");
  ok(m?.lines[0].received_qty === 20, "line 1 shipped qty");
  ok(m?.lines[8].lot_code === "11373840130059962", "line 9 lot id parsed");
  ok(m?.lines[8].product_name === "Northwest CCELL® Classic Cart - 1g - Wedding Cake", "line 9 name");
  ok(
    (m?.lines[0].warnings.some((w) => w.includes("no COA/price")) ?? false) === true,
    "sparse-line warning present",
  );

  // H15a — transport / ETA seed from the real sample:
  //   Transporter Departure Time 6/26/26 12:00 am; Delivery Deadline 6/29/26
  //   8:00 am; Third Party Transport Company TERPENE TRANSIT.
  ok(m?.transport?.departed_at === "2026-06-26T00:00", `departure time seeded (got ${m?.transport?.departed_at})`);
  ok(m?.transport?.eta_date === "2026-06-29", `eta from delivery deadline (got ${m?.transport?.eta_date})`);
  ok(m?.transport?.transporter_name === "TERPENE TRANSIT", `transporter name read (got ${m?.transport?.transporter_name})`);
  ok(m?.transport?.arrived_at === null, "arrived_at NOT guessed (staff stamp actual arrival)");
  ok(m?.transport?.driver_name === null, "driver name honestly null (blank on this layout)");

  if (failed === 0) console.log(`pdf-manifest-core: all ${passed} tests passed`);
  return { passed, failed };
}

// ---------------------------------------------------------------------------
// H16b-2 — self-tests for the Cultivera "Internal Shipping Document" variant.
// The fixture is the exact unpdf output of the owner's real Everigreene sample.
// This layout uses "Approx. Departure/Arrival Date/Time", "Transporter Name:",
// and a clumped vehicle line — distinct from the (Third Party) sample above.
// ---------------------------------------------------------------------------
export function __runCultiveraManifestTests(sampleText: string): {
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

  ok(looksLikeShippingManifest(sampleText) === true, "cultivera sample recognized as manifest");

  const m = parseShippingManifestText(sampleText);
  ok(m !== null, "cultivera sample parses");
  ok(m?.manifest_number === "21544390883723306", `manifest id (got ${m?.manifest_number})`);
  ok(m?.vendor_label === "EVERIGREENE", `vendor label (got ${m?.vendor_label})`);
  ok(m?.vendor_license === "431776", `vendor license (got ${m?.vendor_license})`);
  // The bug this slice fixes: the "8/6/91" disclaimer date must NOT win.
  ok(m?.transfer_date === "2026-07-08", `transfer date not the 8/6/91 disclaimer (got ${m?.transfer_date})`);
  ok(m?.lines.length === 28, `all 28 lines parsed (got ${m?.lines.length})`);
  ok(m?.lines[0].lot_code === "21544340930295135", `line 1 lot (got ${m?.lines[0].lot_code})`);
  ok(
    m?.lines[0].product_name === "Packaged Flower - BananaConda - 3.5g",
    `line 1 name (got ${m?.lines[0].product_name})`,
  );
  ok(m?.lines[27].lot_code === "21544341009022449", `line 28 lot (got ${m?.lines[27].lot_code})`);

  // Transport — the fields that were ALL NULL before this slice.
  ok(m?.transport?.transporter_name === "Tyler hart", `transporter name (got ${m?.transport?.transporter_name})`);
  ok(
    m?.transport?.vehicle_description === "2006 blue subaru impreza",
    `vehicle description (got ${m?.transport?.vehicle_description})`,
  );
  ok(m?.transport?.vehicle_plate === "CHB65209", `vehicle plate (got ${m?.transport?.vehicle_plate})`);
  ok(m?.transport?.departed_at === "2026-07-08T09:00", `departure datetime (got ${m?.transport?.departed_at})`);
  ok(m?.transport?.eta_date === "2026-07-08", `eta from arrival estimate (got ${m?.transport?.eta_date})`);
  ok(m?.transport?.arrived_at === null, "arrived_at NOT guessed");
  ok(
    (m?.transport?.route_notes ?? "").includes("US-12 E"),
    "route notes captured the turn-by-turn directions",
  );

  if (failed === 0) console.log(`pdf-manifest-core (cultivera): all ${passed} tests passed`);
  return { passed, failed };
}
