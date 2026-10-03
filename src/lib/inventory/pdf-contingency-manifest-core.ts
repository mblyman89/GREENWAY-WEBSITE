/**
 * src/lib/inventory/pdf-contingency-manifest-core.ts  (R26, PURE)
 *
 * Reads the DRIVER / VEHICLE / TIMES block of the WA LCB "Contingency
 * Manifest" as Cultivera generates it, from the PDF's text-layer POSITIONS.
 *
 * WHY POSITIONS (verified on the real document, never assumed):
 * back-office/source-materials/examples/QGT_FreddysFuego_MANIFEST.pdf is a
 * Crystal-Reports render whose FORM LABELS ("Driver Name:", "VIN #:",
 * "Departure Date/Time:" ...) are part of a background IMAGE; its text layer
 * holds the VALUES ONLY, with no label text at all ("3/12/25 (360)930-8790
 * 03/13/2025 07:00 am 03/13/2025 04:00 pm Chris Gibilterra ..."). No
 * label-based reader can pair them, which is exactly why the delivery details
 * of this "transportation manifest" never reached the form. A vision parser
 * CAN see the labels, but vision output must be grounded (see
 * extraction-grounding-core) and was observed hallucinating values on this
 * very page (a generic image reader returned "03/15/2025" and a wrong VIN).
 *
 * The label rows were MEASURED, not guessed: the page was rendered at 300 dpi
 * and OCR'd with tesseract; each label's row lines up with exactly one value
 * item's baseline in the text layer (pdf.js transform, 612x792 pt page):
 *
 *   row  y   left column (x 170-310)      right column (x 440-600)
 *   ---  ---  ---------------------------  -------------------------
 *        171  Departure Date/Time  -> "03/13/2025 07:00 am"  Arrival Date/Time -> "03/13/2025 04:00 pm" (y 170)
 *        111  Driver Name          -> "Chris Gibilterra"     VIN #             -> "W1Y40BHY9LT036548"
 *         97  Vehicle License Plate-> "A3169588"             Vehicle Color     -> "White"
 *         84  Vehicle Make         -> "Mercedes Benz"        Vehicle Model     -> "Sprinters250"
 *         28  footer text "Manifest ID:" (x 24) + "15410217973875889" (x 72)
 *
 * The "Transportation License Information" section is BLANK on the only real
 * sample, so no cell positions for it could be measured: transporter name /
 * license are deliberately NOT read (never guessed).
 *
 * STRICT FINGERPRINT (all required, else null): a 612x792 page, the
 * "Manifest ID:" footer item at the bottom-left with a numeric id right of it,
 * and DATE-shaped values in BOTH the departure and arrival cells. Every value
 * then passes the same shape validators the label reader uses (plate needs a
 * digit, VIN shape, names carry no labels, dates must parse) — a cell whose
 * value fails is left empty.
 *
 * PURE: takes positioned text items (pdf-extract supplies them).
 */
import { emptyTransport, combineDateAndTime, transportHasData } from "@/lib/inventory/intake-parser";
import {
  normalizeAnyDate,
  plausibleName,
  plausiblePlate,
  plausibleVin,
  type GenericPdfTransport,
} from "@/lib/inventory/pdf-generic-transport-core";

/** One positioned text item from pdf.js getTextContent (page 1). */
export type PositionedText = {
  str: string;
  /** transform[4] — left edge in pt. */
  x: number;
  /** transform[5] — baseline in pt from the page bottom. */
  y: number;
};

export type PageLayer = {
  width: number;
  height: number;
  items: PositionedText[];
};

const Y_TOL = 4;
const LEFT: [number, number] = [170, 310];
const RIGHT: [number, number] = [440, 600];

/** Joined text of the items inside one cell (row y ± tol, column x range). */
function cell(items: readonly PositionedText[], y: number, col: [number, number]): string | null {
  const hits = items
    .filter((it) => Math.abs(it.y - y) <= Y_TOL && it.x >= col[0] && it.x <= col[1])
    .sort((a, b) => a.x - b.x);
  const t = hits.map((h) => h.str).join(" ").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

const DATE_TIME_RE = /^(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\d{1,2}:\d{2}\s*[ap]\.?m\.?))?$/i;

/** "03/13/2025 07:00 am" -> "2025-03-13T07:00" (local-naive, like every parser). */
function dateTime(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.trim().match(DATE_TIME_RE);
  if (!m) return null;
  const d = normalizeAnyDate(m[1]);
  if (!d) return null;
  return combineDateAndTime(d, m[2] ?? null);
}

/**
 * The positional fingerprint of the Cultivera-generated LCB Contingency
 * Manifest page 1. Returns the manifest id when it matches, else null.
 */
export function contingencyManifestId(page: PageLayer | null | undefined): string | null {
  if (!page || Math.round(page.width) !== 612 || Math.round(page.height) !== 792) return null;
  const label = page.items.find((it) => /^Manifest ID:?$/i.test(it.str.trim()) && it.x < 60 && it.y < 60);
  if (!label) return null;
  const id = page.items.find(
    (it) => Math.abs(it.y - label.y) <= 2 && it.x > label.x && it.x < 200 && /^\d{6,}$/.test(it.str.trim()),
  );
  if (!id) return null;
  if (!dateTime(cell(page.items, 171, LEFT)) || !dateTime(cell(page.items, 170, RIGHT))) return null;
  return id.str.trim();
}

/** Read the transport block, or null when the fingerprint does not match. */
export function readContingencyManifestTransport(
  page: PageLayer | null | undefined,
): GenericPdfTransport | null {
  const manifestId = contingencyManifestId(page);
  if (!manifestId || !page) return null;
  const it = page.items;
  const t = emptyTransport();
  t.departed_at = dateTime(cell(it, 171, LEFT));
  const arrival = dateTime(cell(it, 170, RIGHT));
  t.eta_date = arrival ? arrival.slice(0, 10) : null; // arrival is an ESTIMATE -> eta only
  t.driver_name = plausibleName(cell(it, 111, LEFT));
  t.vehicle_vin = plausibleVin(cell(it, 111, RIGHT));
  t.vehicle_plate = plausiblePlate(cell(it, 97, LEFT));
  const color = plausibleName(cell(it, 97, RIGHT));
  const make = plausibleName(cell(it, 84, LEFT));
  const model = plausibleName(cell(it, 84, RIGHT));
  const parts = [color, make, model].filter((x): x is string => !!x);
  t.vehicle_description = parts.length > 0 ? parts.join(" ") : null;
  // arrived_at is NEVER document-sourced; transporter cells unmeasured -> null.
  if (!transportHasData(t)) return null;
  return { manifest_number: manifestId, transport: t };
}

// ---------------------------------------------------------------------------
// Self-tests — the REAL page-1 items of QGT_FreddysFuego_MANIFEST.pdf (pdf.js
// getTextContent, rounded transform[4]/[5]), recorded verbatim.
// ---------------------------------------------------------------------------
export const QGT_CONTINGENCY_PAGE1: PageLayer = {
  width: 612,
  height: 792,
  items: [
    { str: "3/12/25", x: 231, y: 469 },
    { str: "(360)930-8790", x: 487, y: 444 },
    { str: "03/13/2025 07:00 am", x: 205, y: 171 },
    { str: "03/13/2025 04:00 pm", x: 475, y: 170 },
    { str: "Chris Gibilterra", x: 180, y: 111 },
    { str: "Standard Delivery", x: 370, y: 496 },
    { str: "QUALITY GREEN TREES", x: 197, y: 444 },
    { str: "413632", x: 499, y: 469 },
    { str: "26268 12 TREES LN NW STE", x: 190, y: 416 },
    { str: "140", x: 238, y: 405 },
    { str: "POULSBO, WA 983706402", x: 195, y: 394 },
    { str: "sales@freddysfuego.com", x: 468, y: 417 },
    { str: "W1Y40BHY9LT036548", x: 449, y: 111 },
    { str: "White", x: 449, y: 97 },
    { str: "A3169588", x: 180, y: 97 },
    { str: "Mercedes Benz", x: 180, y: 84 },
    { str: "Sprinters250", x: 449, y: 84 },
    { str: "1", x: 582, y: 28 },
    { str: "Manifest ID:", x: 24, y: 28 },
    { str: "15410217973875889", x: 72, y: 28 },
  ],
};

export function __runContingencyManifestTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL: contingency-manifest", msg);
    }
  };
  const r = readContingencyManifestTransport(QGT_CONTINGENCY_PAGE1);
  ok(r !== null, "real QGT page reads");
  ok(r?.manifest_number === "15410217973875889", "manifest id from footer");
  ok(r?.transport.driver_name === "Chris Gibilterra", "driver");
  ok(r?.transport.vehicle_vin === "W1Y40BHY9LT036548", "vin");
  ok(r?.transport.vehicle_plate === "A3169588", "plate");
  ok(r?.transport.vehicle_description === "White Mercedes Benz Sprinters250", "vehicle color make model");
  ok(r?.transport.departed_at === "2025-03-13T07:00", `departure (got ${r?.transport.departed_at})`);
  ok(r?.transport.eta_date === "2025-03-13", "arrival -> eta_date");
  ok(r?.transport.arrived_at === null, "arrived_at never document-sourced");
  ok(r?.transport.transporter_name === null && r?.transport.transporter_license === null, "transporter never guessed");
  // The origin "Date" (3/12/25 at y 469) is NOT the departure.
  ok(r?.transport.departed_at !== "2025-03-12", "origin date not used as departure");

  // Fingerprint strictness.
  const without = (pred: (i: PositionedText) => boolean): PageLayer => ({
    ...QGT_CONTINGENCY_PAGE1,
    items: QGT_CONTINGENCY_PAGE1.items.filter((i) => !pred(i)),
  });
  ok(readContingencyManifestTransport(without((i) => i.str === "Manifest ID:")) === null, "no footer label -> null");
  ok(readContingencyManifestTransport(without((i) => i.str === "15410217973875889")) === null, "no id -> null");
  ok(readContingencyManifestTransport(without((i) => i.str.endsWith("07:00 am"))) === null, "no departure -> null");
  ok(readContingencyManifestTransport(without((i) => i.str.endsWith("04:00 pm"))) === null, "no arrival -> null");
  ok(readContingencyManifestTransport({ ...QGT_CONTINGENCY_PAGE1, width: 595 }) === null, "A4 page -> null");
  ok(readContingencyManifestTransport(null) === null, "null -> null");
  // A shifted layout (another generator) does not match — never mis-paired.
  const shifted: PageLayer = {
    ...QGT_CONTINGENCY_PAGE1,
    items: QGT_CONTINGENCY_PAGE1.items.map((i) => (i.y > 60 ? { ...i, y: i.y + 20 } : i)),
  };
  ok(readContingencyManifestTransport(shifted) === null, "shifted layout -> null");
  // A junk value in a cell is dropped, not kept.
  const junk: PageLayer = {
    ...QGT_CONTINGENCY_PAGE1,
    items: QGT_CONTINGENCY_PAGE1.items.map((i) => (i.str === "A3169588" ? { ...i, str: "LICENSEE" } : i)),
  };
  ok(readContingencyManifestTransport(junk)?.transport.vehicle_plate === null, "junk plate dropped");
  ok(dateTime("03/13/2025 04:00 pm") === "2025-03-13T16:00", "pm time");
  ok(dateTime("Standard Delivery") === null, "non-date -> null");

  console.log(`contingency-manifest self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
