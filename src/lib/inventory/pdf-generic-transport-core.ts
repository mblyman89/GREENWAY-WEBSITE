/**
 * src/lib/inventory/pdf-generic-transport-core.ts  (SLICE 41)
 *
 * PURE, provider-agnostic reader for TRANSPORT facts in ANY vendor PDF.
 *
 * WHY (owner's rule: "the code should be smart" — don't hard-code providers):
 * the layout-specific PDF parsers (LCB shipping doc, GrowFlow, TransferLog,
 * OpenTHC invoice, Cultivera invoice) each recognize ONE verified layout. A
 * NEW provider — the real failure was Phat Panda via Bamboo (Bamboo Metro
 * LLC), whose email attaches an Invoice, a "Washington Marijuana
 * Transportation Manifest" and a Contingency Manifest PDF — matches none of
 * them, so its transport details (driver, vehicle, plate, times) never
 * reached the Transport & chain-of-custody form even though they are printed
 * in the PDFs.
 *
 * This module extracts transport facts by FIELD LABEL, the one thing every
 * transportation manifest shares because WAC 314-55-085 requires the same
 * facts to be recorded: Driver, Vehicle (make/model/color), License Plate,
 * VIN, Transporter/Carrier and their license, Departure/Arrival times.
 * Labels, not layouts — so a provider we have never seen still yields its
 * transport block.
 *
 * NEVER-GUESS RULES:
 *  - a fact is extracted ONLY from an explicit label ("Driver Name: X");
 *    nothing is inferred from position or context;
 *  - values that are placeholders (n/a, none, tbd, -, empty) are dropped;
 *  - arrival times feed eta_date ONLY (arrived_at is a human attestation and
 *    is never sourced from a document — same rule as every other parser);
 *  - returns null unless the text plausibly IS a transport document (mentions
 *    manifest/transport/chain of custody) AND at least one fact was found —
 *    never a donor full of nulls.
 *
 * PURE: no I/O — unit-testable with tsx/vitest.
 */
import {
  emptyTransport,
  transportHasData,
  type ParsedTransport,
} from "@/lib/inventory/intake-parser";

/** A generic transport donor: manifest number (any format) + the facts found. */
export type GenericPdfTransport = {
  manifest_number: string | null;
  transport: ParsedTransport;
};

/** Placeholder values that mean "not filled in", never real data. */
const PLACEHOLDER_RE = /^(?:n\/?a|none|null|tbd|unknown|-+|—+)$/i;

function meaningful(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  if (!t || PLACEHOLDER_RE.test(t)) return null;
  return t;
}

/**
 * Stop a captured value at the NEXT field label so run-on PDF text can't
 * bleed. Full label PHRASES (not bare keywords) so a value like the driver
 * name "Jane Q Driver" is not truncated at its own last word — only a real
 * "Driver License #:"-style label ends the capture.
 */
const STOP_PHRASES = [
  "driver(?:'s)?\\s*name",
  "driver(?:'s)?\\s*license(?:\\s*(?:number|no\\.?))?\\s*#?",
  "vehicle\\s*(?:description|make|model|color|year|vin|info(?:rmation)?)",
  "(?:vehicle\\s*)?vin(?:\\s*(?:number|no\\.?))?\\s*#?",
  "(?:vehicle\\s*)?license\\s*plate(?:\\s*(?:number|no\\.?))?\\s*#?",
  "plate(?:\\s*(?:number|no\\.?))?\\s*#?",
  "transporter(?:\\s*\\/?\\s*carrier)?(?:\\s*(?:name|license(?:\\s*(?:number|no\\.?))?))?\\s*#?",
  "carrier(?:\\s*(?:name|license(?:\\s*(?:number|no\\.?))?))?\\s*#?",
  "(?:estimated\\s*)?departure(?:\\s*(?:date|time))*",
  "departed(?:\\s*at)?",
  "(?:estimated\\s*)?arriv(?:al|e)(?:\\s*(?:date|time|by))*",
  "eta",
  "manifest(?:\\s*(?:id|number|no\\.?|type))?\\s*#?",
  "route(?:\\s*notes)?",
  "origin",
  "destination",
  "phone",
  "signature",
];
const STOP_RE = new RegExp(`\\b(?:${STOP_PHRASES.join("|")})\\s*[:#]`, "i");

/** Grab the value after `label:`, stopping at the next known label or 60 chars. */
function grab(flat: string, labelRe: string): string | null {
  const re = new RegExp(`${labelRe}\\s*[:#]\\s*`, "i");
  const m = re.exec(flat);
  if (!m) return null;
  let rest = flat.slice(m.index + m[0].length, m.index + m[0].length + 200);
  const stop = rest.search(STOP_RE);
  if (stop >= 0) rest = rest.slice(0, stop);
  return meaningful(rest.slice(0, 60));
}

/** Does this text plausibly describe a cannabis transport/manifest document? */
export function looksLikeTransportDocument(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes("manifest") ||
    t.includes("chain of custody") ||
    t.includes("transportation") ||
    t.includes("transporter")
  );
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Normalize a date string from any of the formats vendor PDFs print:
 * "07/03/2026", "2026-07-03", "July 3, 2026" -> "2026-07-03". PURE; null if
 * unparseable (never guesses).
 */
export function normalizeAnyDate(raw: string | null | undefined): string | null {
  const s = meaningful(raw);
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/([A-Za-z]{3})[a-z]*\.?,?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/**
 * Extract transport facts from ANY transport-ish PDF's flattened text by
 * field label. Returns null when the text isn't a transport document or no
 * fact was found. PURE.
 */
export function extractGenericPdfTransport(
  text: string | null | undefined,
): GenericPdfTransport | null {
  if (!text || !looksLikeTransportDocument(text)) return null;
  const flat = text.replace(/\s+/g, " ").trim();

  // Manifest number — any format a provider prints: pure digits (LCB
  // 11804443981161219), license-dotted (Bamboo WA413287.TRBOCF), or
  // alphanumeric with dashes. Label-anchored only.
  const manifest_number =
    flat.match(/Manifest\s*(?:ID|#|Number|No\.?)?\s*[:#]\s*([A-Z0-9][A-Z0-9.\-]{4,})/i)?.[1] ??
    flat.match(/Manifest\s+([A-Z]{2}\d{4,}\.[A-Z0-9]{3,})/i)?.[1] ??
    null;

  const t = emptyTransport();

  t.driver_name = grab(flat, "Driver(?:'s)?\\s*Name") ?? grab(flat, "Driver");
  t.driver_license_number =
    grab(flat, "Driver(?:'s)?\\s*License\\s*(?:Number|No\\.?|#)?");
  t.vehicle_plate =
    grab(flat, "(?:Vehicle\\s*)?(?:License\\s*)?Plate\\s*(?:Number|No\\.?|#)?");
  // Plates are short uppercase tokens; a long capture means the label matched
  // prose, not a plate — drop it rather than guess.
  if (t.vehicle_plate && !/^[A-Z0-9 -]{3,10}$/i.test(t.vehicle_plate)) t.vehicle_plate = null;
  if (t.vehicle_plate) t.vehicle_plate = t.vehicle_plate.toUpperCase();

  const vin = grab(flat, "(?:Vehicle\\s*)?VIN\\s*(?:Number|No\\.?|#)?");
  // Real VINs are 11-17 chars without I/O/Q; anything else is noise.
  t.vehicle_vin = vin && /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(vin) ? vin.toUpperCase() : null;

  // Vehicle description: prefer an explicit description label, else compose
  // from Color/Make/Model labels (the GrowFlow-style split).
  const explicitDesc =
    grab(flat, "Vehicle\\s*Description") ?? grab(flat, "Vehicle\\s*(?:Make/Model|Info(?:rmation)?)");
  if (explicitDesc) {
    t.vehicle_description = explicitDesc;
  } else {
    const color = grab(flat, "Vehicle\\s*Color");
    const make = grab(flat, "Vehicle\\s*Make");
    const model = grab(flat, "Vehicle\\s*Model");
    const year = grab(flat, "Vehicle\\s*Year");
    const parts = [year, color, make, model].filter((x): x is string => !!x);
    t.vehicle_description = parts.length > 0 ? parts.join(" ") : null;
  }

  t.transporter_name =
    grab(flat, "Transporter\\s*(?:\\/\\s*Carrier)?\\s*Name") ??
    grab(flat, "Carrier\\s*Name") ??
    grab(flat, "Transporter") ??
    grab(flat, "Carrier");
  t.transporter_license =
    grab(flat, "Transporter\\s*License\\s*(?:Number|No\\.?|#)?") ??
    grab(flat, "Carrier\\s*License\\s*(?:Number|No\\.?|#)?");

  // Departure -> departed_at (as printed; the store normalizes). Arrival is an
  // ESTIMATE -> eta_date only; arrived_at is NEVER document-sourced.
  const departRaw =
    grab(flat, "(?:Estimated\\s*)?Departure(?:\\s*(?:Date|Time|Date\\s*\\/?\\s*Time))?") ??
    grab(flat, "Departed(?:\\s*At)?");
  t.departed_at = departRaw;
  const arriveRaw =
    grab(flat, "(?:Estimated\\s*)?Arrival(?:\\s*(?:Date|Time|Date\\s*\\/?\\s*Time))?") ??
    grab(flat, "(?:Estimated\\s*)?Arrive\\s*(?:By|Date)?") ??
    grab(flat, "ETA");
  t.eta_date = normalizeAnyDate(arriveRaw);

  if (!transportHasData(t)) return null;
  return { manifest_number, transport: t };
}

// ---------------------------------------------------------------------------
// Self-tests — run via scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------
export function __runGenericPdfTransportTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL: generic-pdf-transport", msg);
    }
  };

  // A Bamboo-style "Washington Marijuana Transportation Manifest" flattened
  // the way unpdf flattens (labels + values run together on one line).
  const bambooish =
    "Washington Marijuana Transportation Manifest Manifest #: WA413287.TRBOCF " +
    "Transporter Name: Phat Panda Logistics Transporter License #: 413287 " +
    "Driver Name: Jane Q Driver Driver License #: DRIVER12345 " +
    "Vehicle Make: Ford Vehicle Model: Transit Vehicle Color: White " +
    "License Plate #: ABC1234 VIN #: 1FTBW2CM3HKA12345 " +
    "Estimated Departure: 07/01/2026 05:30:00 AM PDT Estimated Arrival: 07/03/2026 05:30:00 AM PDT";
  const g = extractGenericPdfTransport(bambooish);
  ok(g !== null, "bamboo-style manifest yields a donor");
  ok(g?.manifest_number === "WA413287.TRBOCF", "dotted manifest number extracted");
  ok(g?.transport.driver_name === "Jane Q Driver", "driver name");
  ok(g?.transport.driver_license_number === "DRIVER12345", "driver license");
  ok(g?.transport.vehicle_plate === "ABC1234", "plate");
  ok(g?.transport.vehicle_vin === "1FTBW2CM3HKA12345", "vin");
  ok(
    g?.transport.vehicle_description === "White Ford Transit",
    `vehicle composed from color/make/model (got ${g?.transport.vehicle_description})`,
  );
  ok(g?.transport.transporter_name === "Phat Panda Logistics", "transporter name");
  ok(g?.transport.transporter_license === "413287", "transporter license");
  ok(g?.transport.eta_date === "2026-07-03", "arrival -> eta_date normalized");
  ok(g?.transport.arrived_at === null, "arrived_at NEVER document-sourced");
  ok((g?.transport.departed_at ?? "").startsWith("07/01/2026"), "departure captured as printed");

  // Placeholders are dropped, not guessed.
  const naDoc =
    "Transportation Manifest Manifest #: 123456789 Driver Name: n/a VIN #: n/a " +
    "License Plate #: TBD Transporter Name: Real Carrier LLC";
  const na = extractGenericPdfTransport(naDoc);
  ok(na !== null, "placeholder doc still yields donor via real fields");
  ok(na?.transport.driver_name === null, "n/a driver dropped");
  ok(na?.transport.vehicle_vin === null, "n/a vin dropped");
  ok(na?.transport.vehicle_plate === null, "TBD plate dropped");
  ok(na?.transport.transporter_name === "Real Carrier LLC", "real carrier kept");

  // Not a transport document -> null (a random invoice without manifest words).
  ok(
    extractGenericPdfTransport("INVOICE Total Due: $100.00 Thank you for your business") === null,
    "non-transport text -> null",
  );
  // Transport words but NO facts -> null (never a donor full of nulls).
  ok(
    extractGenericPdfTransport("This transportation manifest intentionally blank") === null,
    "no facts -> null",
  );
  ok(extractGenericPdfTransport(null) === null, "null text -> null");

  // normalizeAnyDate formats.
  ok(normalizeAnyDate("07/03/2026 05:30 AM") === "2026-07-03", "US date");
  ok(normalizeAnyDate("2026-07-03") === "2026-07-03", "ISO date");
  ok(normalizeAnyDate("Wednesday, July 15, 2026") === "2026-07-15", "prose date");
  ok(normalizeAnyDate("soon") === null, "unparseable -> null");

  console.log(`generic-pdf-transport self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
