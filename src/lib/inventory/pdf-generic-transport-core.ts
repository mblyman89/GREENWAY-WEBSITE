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
import {
  extractKeyValuePairs,
  normalizeMarkdownFields,
  type KeyValuePair,
} from "@/lib/inventory/markdown-fields-core";

/** A generic transport donor: manifest number (any format) + the facts found. */
export type GenericPdfTransport = {
  manifest_number: string | null;
  transport: ParsedTransport;
};

/** Placeholder values that mean "not filled in", never real data. */
const PLACEHOLDER_RE = /^(?:n\/?a|none|null|tbd|unknown|-+|—+)$/i;

/**
 * R26: a value whose FIRST token is a placeholder ("n/a Destination License
 * Information ...", the real GrowFlow run-on) is a blank field followed by the
 * next section's heading — never a real value.
 */
const PLACEHOLDER_PREFIX_RE = /^(?:n\/a|none|null|tbd|unknown|not\s+applicable)(?:\s|$)/i;

function meaningful(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  if (!t || PLACEHOLDER_RE.test(t) || PLACEHOLDER_PREFIX_RE.test(t)) return null;
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
  "(?:approx\\.?\\s*|estimated\\s*)?departure(?:\\s*\\/?\\s*(?:date|time))*",
  "departed(?:\\s*at)?",
  "(?:approx\\.?\\s*|estimated\\s*)?arriv(?:al|e)(?:\\s*\\/?\\s*(?:date|time|by))*",
  // R26 — multi-word labels seen in REAL vendor PDFs that used to bleed into
  // the previous value (verified on the fixtures): "Licensee Phone:" ended the
  // TransferLog transporter as "David Sanchez Licensee"; "Transporter Date of
  // Birth:" became the LCB transporter name; "License Plate: Licensee Phone:"
  // made the plate "LICENSEE".
  "(?:destination\\s*|origin\\s*)?licensee(?:\\s*(?:name|phone|address|e-?mail|license))?\\s*#?",
  "(?:transporter\\s*)?date\\s*of\\s*birth",
  "delivery\\s*deadline",
  "vehicle\\s*id\\s*#?",
  "license\\s*#?",
  "ubi\\s*#?",
  "stop\\s*#?",
  "eta",
  "manifest(?:\\s*(?:id|number|no\\.?|type))?\\s*#?",
  "route(?:\\s*notes)?",
  "origin",
  "destination",
  "phone",
  "signature",
];
const STOP_RE = new RegExp(`\\b(?:${STOP_PHRASES.join("|")})\\s*[:#]`, "i");

/**
 * R26 — SECTION HEADINGS (no colon) that end a value. Verified on the real
 * GrowFlow manifest ("Vehicle Model: n/a Destination License Information")
 * and the LCB Contingency Manifest form's section titles.
 */
const HEADING_STOP_RE =
  /\b(?:(?:Destination|Origin|Transportation)\s+Licen[cs]e(?:e)?\s+(?:Information|Name|Address|Phone)|Driver\s*&\s*Vehicle\s+Information|Estimated\s+Departure\s*\/\s*Arrival|Third\s+Party\s+Transport)/i;

/** Grab the value after `label:`, stopping at the next known label or 60 chars. */
function grab(flat: string, labelRe: string): string | null {
  const re = new RegExp(`${labelRe}[ \\t]*[:#][ \\t]*`, "i");
  const m = re.exec(flat);
  if (!m) return null;
  let rest = flat.slice(m.index + m[0].length, m.index + m[0].length + 200);
  const stop = rest.search(STOP_RE);
  if (stop >= 0) rest = rest.slice(0, stop);
  const head = rest.search(HEADING_STOP_RE);
  if (head >= 0) rest = rest.slice(0, head);
  // R26: a normalized markdown "Label: value" line ends at its newline.
  const nl = rest.indexOf("\n");
  if (nl >= 0) rest = rest.slice(0, nl);
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
 * R26 — the printed date(+time) span of a departure value, or null when the
 * value does not START with a readable date (the real LCB failure: an ADDRESS
 * "4851 GEIGER RD SE PORT ORCHARD ..." landed in departed_at). Returned as
 * printed (the store normalizes) but cut to the date/time so a run-on tail
 * never rides along.
 */
export function departureSpan(raw: string | null | undefined): string | null {
  const s = meaningful(raw);
  if (!s) return null;
  const m = s.match(
    /^(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})(?:[ T,]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp]\.?[Mm]\.?)?(?:\s+[A-Z]{1,2}[SD]?T\b)?)?/,
  );
  if (!m || !normalizeAnyDate(m[0])) return null;
  return m[0].trim();
}

/**
 * R26 — plates are short tokens that contain a DIGIT. Verified junk this
 * rejects: "LICENSEE" (LCB "License Plate: Licensee Phone:" run-on). Every real
 * plate in our documents carries a digit (A3169588, D44636H, CHB65209,
 * BWD5565). An all-letter vanity plate is left blank for staff — never guessed.
 */
export function plausiblePlate(v: string | null | undefined): string | null {
  const t = meaningful(v);
  if (!t) return null;
  if (!/^[A-Z0-9 -]{3,10}$/i.test(t) || !/\d/.test(t)) return null;
  return t.toUpperCase();
}

/** Real VINs are 11-17 chars without I/O/Q. */
export function plausibleVin(v: string | null | undefined): string | null {
  const t = meaningful(v);
  return t && /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(t) ? t.toUpperCase() : null;
}

/**
 * R26 — a person/company name never contains a field label or a colon.
 * Verified junk this rejects: "Transporter Date of Birth: Tyler hart ..."
 * and "TERPENE TRANSIT Delivery Deadline:".
 */
export function plausibleName(v: string | null | undefined): string | null {
  const t = meaningful(v);
  if (!t) return null;
  if (/[:]/.test(t)) return null;
  if (/\b(?:date\s+of\s+birth|signature|licensee|destination|origin|arrival|departure|manifest)\b/i.test(t)) {
    return null;
  }
  if (!/[A-Za-z]/.test(t) || t.length > 60) return null;
  return t;
}

/**
 * R26 — a manifest number captured from run-on text must not carry the
 * next word glued on. Verified: the real Cultivera invoice flattens to
 * "Manifest #: 15410217973875889GREENWAY MARIJUANA" — the digits are the id.
 * Dotted license-style ids (Bamboo "WA413287.TRBOCF") are kept whole.
 */
export function unglueManifestNumber(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const glued = t.match(/^(\d{6,})[A-Z][A-Za-z]+$/);
  if (glued) return glued[1];
  return t;
}

/** Find a structural pair whose WHOLE label matches `labelRe`. */
function pairValue(pairs: readonly KeyValuePair[], labelRe: string): string | null {
  const re = new RegExp(`^(?:${labelRe})\\s*[:#]?$`, "i");
  for (const p of pairs) {
    if (re.test(p.label.trim())) {
      const v = meaningful(p.value);
      if (v) return v;
    }
  }
  return null;
}

/**
 * Extract transport facts from ANY transport-ish PDF's text by field label.
 * Accepts unpdf flat text AND LlamaParse markdown (R26): markdown is first
 * normalized (tables -> "Label: value"), and STRUCTURAL key-value pairs
 * (a value bounded by its own table cell) are preferred over the flat label
 * scan, which can only guess where a run-on value ends. Every value then
 * passes a shape validator; anything implausible is dropped, never kept.
 * Returns null when the text isn't a transport document or no fact was found.
 * PURE.
 */
export function extractGenericPdfTransport(
  text: string | null | undefined,
): GenericPdfTransport | null {
  if (!text || !looksLikeTransportDocument(text)) return null;
  const normalized = normalizeMarkdownFields(text);
  const multiLine = normalized !== text;
  // Flat scan text: unpdf text collapses to one line (unchanged behaviour);
  // normalized markdown keeps its line breaks so a value ends at its line.
  const flat = multiLine
    ? normalized.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim()
    : text.replace(/\s+/g, " ").trim();
  const pairs = multiLine ? extractKeyValuePairs(text) : [];
  const field = (labelRe: string, ...more: string[]): string | null => {
    for (const re of [labelRe, ...more]) {
      const v = pairValue(pairs, re);
      if (v) return v;
    }
    for (const re of [labelRe, ...more]) {
      const v = grab(flat, re);
      if (v) return v;
    }
    return null;
  };

  // Manifest number — any format a provider prints: pure digits (LCB
  // 11804443981161219), license-dotted (Bamboo WA413287.TRBOCF), or
  // alphanumeric with dashes. Label-anchored only.
  const manifest_number = unglueManifestNumber(
    pairValue(pairs, "Manifest\\s*(?:ID|#|Number|No\\.?)")?.match(/^[A-Z0-9][A-Z0-9.\-]{4,}$/i)?.[0] ??
      flat.match(/Manifest\s*(?:ID|#|Number|No\.?)?\s*[:#]\s*([A-Z0-9][A-Z0-9.\-]{4,})/i)?.[1] ??
      flat.match(/Manifest\s+([A-Z]{2}\d{4,}\.[A-Z0-9]{3,})/i)?.[1] ??
      null,
  );

  const t = emptyTransport();

  t.driver_name = plausibleName(field("Driver(?:'s)?\\s*Name", "Driver"));
  t.driver_license_number = meaningful(
    field("Driver(?:'s)?\\s*License\\s*(?:Number|No\\.?|#)?"),
  );
  // Plates are short tokens with a digit; anything else is a run-on capture.
  t.vehicle_plate = plausiblePlate(
    field("(?:Vehicle\\s*)?(?:License\\s*)?Plate\\s*(?:Number|No\\.?|#)?"),
  );
  t.vehicle_vin = plausibleVin(field("(?:Vehicle\\s*)?VIN\\s*(?:Number|No\\.?|#)?"));

  // Vehicle description: prefer an explicit description label, else compose
  // from Color/Make/Model labels (the GrowFlow-style split).
  const explicitDesc = field(
    "Vehicle\\s*Description",
    "Vehicle\\s*(?:Make/Model|Info(?:rmation)?)",
  );
  if (explicitDesc) {
    t.vehicle_description = explicitDesc;
  } else {
    const color = field("Vehicle\\s*Color");
    const make = field("Vehicle\\s*Make");
    const model = field("Vehicle\\s*Model");
    const year = field("Vehicle\\s*Year");
    const parts = [year, color, make, model].filter((x): x is string => !!x);
    t.vehicle_description = parts.length > 0 ? parts.join(" ") : null;
  }

  t.transporter_name = plausibleName(
    field(
      "Transporter\\s*(?:\\/\\s*Carrier)?\\s*Name",
      "Carrier\\s*Name",
      "Transporter",
      "Carrier",
    ),
  );
  t.transporter_license = meaningful(
    field(
      "Transporter\\s*License\\s*(?:Number|No\\.?|#)?",
      "Carrier\\s*License\\s*(?:Number|No\\.?|#)?",
    ),
  );

  // Departure -> departed_at (date/time span as printed; the store
  // normalizes). Arrival is an ESTIMATE -> eta_date only; arrived_at is NEVER
  // document-sourced.
  t.departed_at = departureSpan(
    field(
      "(?:Approx\\.?\\s*|Estimated\\s*)?Departure(?:\\s*(?:Date|Time|Date\\s*\\/?\\s*Time))?",
      "Departed(?:\\s*At)?",
    ),
  );
  const arriveRaw = field(
    "(?:Approx\\.?\\s*|Estimated\\s*)?Arrival(?:\\s*(?:Date|Time|Date\\s*\\/?\\s*Time))?",
    "(?:Estimated\\s*)?Arrive\\s*(?:By|Date)?",
    "ETA",
  );
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
