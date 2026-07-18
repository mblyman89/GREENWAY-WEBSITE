/**
 * src/lib/inventory/pdf-cultivera-invoice-core.ts  (H18 — transport hardening)
 *
 * PURE reader for the TRANSPORT block of a Cultivera-style INVOICE PDF.
 *
 * WHY THIS EXISTS (owner-verified, SPR ORD-24706 / manifest 11804443981161219):
 * the Cultivera vendor email bundle carries THREE documents — the WCIA transfer
 * JSON (richest lines, but transporter fields NULL), the LCB "Internal Shipping
 * Document" manifest PDF (full transport), and an INVOICE PDF whose "Manifest
 * Details" header REPEATS the transport facts:
 *
 *   "Manifest #: 11804443981161219GREENWAY MARIJUANA 2021 WHITE Nissan NV200
 *    Plate: D44636H Vehicle: License #: 413541 UBI #: 603353555
 *    Driver: Kory T Anderson Arrival date : Wednesday, July 15, 2026"
 *
 * (Text exactly as unpdf flattens it — the destination licensee name glues onto
 * the manifest number and the "Vehicle:" label trails its own value.) So when
 * the manifest PDF is missing/unfetchable, the invoice is a legitimate SECOND
 * transport donor. This module extracts ONLY what is verifiably on the layout:
 *   - manifest number   ("Manifest #: <digits>")
 *   - vehicle description (year + color/make/model preceding "Plate:")
 *   - vehicle plate     ("Plate: D44636H")
 *   - driver name       ("Driver: Kory T Anderson")
 *   - eta_date          ("Arrival date : Wednesday, July 15, 2026" — an
 *                        ESTIMATE, so it feeds eta_date, NEVER arrived_at)
 * Transporter name/license, driver license and VIN are NOT on this layout, so
 * they stay honestly null (the "License #: 413541" next to the vehicle is OUR
 * destination retail license — never a transporter license; asserted below).
 *
 * PURE: no I/O, no imports beyond types — unit-testable with tsx.
 */
import {
  emptyTransport,
  transportHasData,
  type ParsedTransport,
} from "@/lib/inventory/intake-parser";

/** Does this extracted PDF text look like a Cultivera invoice with a Manifest Details block? */
export function looksLikeCultiveraInvoice(text: string): boolean {
  if (!text) return false;
  const hasInvoiceTitle = /\bINVOICE\b/i.test(text);
  const hasManifestNo = /Manifest\s*#\s*:/i.test(text);
  const hasTransportHint = /Driver\s*:/i.test(text) || /Plate\s*:/i.test(text);
  return hasInvoiceTitle && hasManifestNo && hasTransportHint;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Wednesday, July 15, 2026" / "July 15, 2026" -> "2026-07-15". PURE; null if unparseable. */
export function parseCultiveraInvoiceDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/([A-Za-z]{3})[a-z]*\.?,?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
}

export type CultiveraInvoiceTransport = {
  manifest_number: string | null;
  transport: ParsedTransport;
};

/**
 * Extract the transport donor facts from a Cultivera invoice's flattened text.
 * Returns null when the text isn't this layout OR when no transport fact was
 * actually found (never a donor full of nulls).
 */
export function extractCultiveraInvoiceTransport(
  text: string | null | undefined,
): CultiveraInvoiceTransport | null {
  if (!text || !looksLikeCultiveraInvoice(text)) return null;
  const flat = text.replace(/\s+/g, " ").trim();

  // Manifest number: digits directly after "Manifest #:" (the destination
  // licensee name glues on with no space — stop at the first non-digit).
  const manifest_number = flat.match(/Manifest\s*#\s*:\s*(\d{6,})/i)?.[1] ?? null;

  const transport = emptyTransport();

  // Vehicle description: within the segment between the manifest number and
  // "Plate:", the vehicle starts at the 4-digit YEAR ("2021 WHITE Nissan
  // NV200") — everything before the year is the glued destination name.
  const vehSegment = flat.match(/Manifest\s*#\s*:\s*\d{6,}([^]*?)Plate\s*:/i)?.[1] ?? null;
  if (vehSegment) {
    const veh = vehSegment.match(/((?:19|20)\d{2}\s+\S[^]*?)\s*$/)?.[1]?.trim() ?? null;
    transport.vehicle_description = veh && veh.length > 0 ? veh : null;
  }

  // Plate: "Plate: D44636H" (the literal "Vehicle:" label follows its value).
  const plate = flat.match(/Plate\s*:\s*([A-Z0-9][A-Z0-9-]{1,9})(?=[\s,.]|$)/i)?.[1] ?? null;
  transport.vehicle_plate = plate;

  // Driver: anchored to the trailing "Arrival date" label when present,
  // otherwise a conservative 1-4 word name grab.
  const driverAnchored = flat.match(/Driver\s*:\s*([^]*?)\s*Arrival\s*date/i)?.[1] ?? null;
  const driverLoose =
    flat.match(/Driver\s*:\s*([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})/)?.[1] ?? null;
  const driver = (driverAnchored ?? driverLoose)?.trim() ?? null;
  transport.driver_name = driver && driver.length > 0 && driver.length <= 60 ? driver : null;

  // Arrival date is an ESTIMATE -> eta_date ONLY (arrived_at is a factual
  // receipt stamp staff record when the truck shows up — never doc-sourced).
  transport.eta_date = parseCultiveraInvoiceDate(
    flat.match(/Arrival\s*date\s*:\s*([A-Za-z]+,?\s*[A-Za-z]+\.?,?\s*\d{1,2},?\s*\d{4})/i)?.[1] ?? null,
  );

  if (!transportHasData(transport)) return null;
  return { manifest_number, transport };
}

// ---------------------------------------------------------------------------
// Self-tests (run via tsx / the pure runner). Grounded in the REAL SPR invoice
// text (unpdf-extracted from Invoice-OrderReport-25960.pdf) — never invented.
// ---------------------------------------------------------------------------
export function __runCultiveraInvoiceTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // The REAL header block, exactly as unpdf flattens the SPR invoice.
  const realInvoice =
    "INVOICE Created By: July 14, 2026 24706Order #: Order Date: Michelle Forbes " +
    "Seattles Private Reserve 17731 59th Ave NE - Bldg 16A ARLINGTON, WA 982236446 " +
    "Phone: 3605720840 License: 417068 Manifest DetailsShip To " +
    "Manifest #: 11804443981161219GREENWAY MARIJUANA 2021 WHITE Nissan NV200 " +
    "Plate: D44636H Vehicle: License #: 413541 UBI #: 603353555 " +
    "Driver: Kory T Anderson Arrival date : Wednesday, July 15, 2026 " +
    "4851 GEIGER RD SE PORT ORCHARD, WA 983669350 Phone: 3604436988 " +
    "Product Line TotalUnit Price UnitsLot 1 SPR - Sour Diesel - 1g " +
    "$90.00$4.5011804443972060487 20.00 <DOH Compliant> Order Total: $2,044.10";

  ok(looksLikeCultiveraInvoice(realInvoice) === true, "real SPR invoice recognized");
  ok(
    looksLikeCultiveraInvoice("Internal Shipping Document Manifest ID 123456789") === false,
    "LCB manifest NOT mistaken for a Cultivera invoice",
  );
  ok(
    looksLikeCultiveraInvoice(
      "Invoice #01KQ 7GS6 Sold By: HIGH END FARMS #415771 Inventory Lot Details",
    ) === false,
    "OpenTHC invoice (no Manifest #:) NOT matched",
  );

  const r = extractCultiveraInvoiceTransport(realInvoice);
  ok(r != null, "transport extracted from real SPR invoice");
  ok(r?.manifest_number === "11804443981161219", `manifest # (got ${r?.manifest_number})`);
  ok(
    r?.transport.vehicle_description === "2021 WHITE Nissan NV200",
    `vehicle desc (got ${r?.transport.vehicle_description})`,
  );
  ok(r?.transport.vehicle_plate === "D44636H", `plate (got ${r?.transport.vehicle_plate})`);
  ok(r?.transport.driver_name === "Kory T Anderson", `driver (got ${r?.transport.driver_name})`);
  ok(r?.transport.eta_date === "2026-07-15", `eta from Arrival date (got ${r?.transport.eta_date})`);
  ok(r?.transport.arrived_at === null, "arrived_at NEVER doc-sourced");
  ok(r?.transport.transporter_license === null, "destination License #: 413541 NOT lifted as transporter license");
  ok(r?.transport.transporter_name === null, "transporter name honestly null (not on layout)");
  ok(r?.transport.vehicle_vin === null, "VIN honestly null (not on layout)");
  ok(r?.transport.departed_at === null, "departure not on layout — honestly null");

  // Date parser edges.
  ok(parseCultiveraInvoiceDate("Wednesday, July 15, 2026") === "2026-07-15", "weekday-prefixed date");
  ok(parseCultiveraInvoiceDate("July 5, 2026") === "2026-07-05", "no-weekday date pads day");
  ok(parseCultiveraInvoiceDate("garbage") === null, "garbage date -> null");
  ok(parseCultiveraInvoiceDate(null) === null, "null date -> null");

  // No transport facts -> null donor (never a donor full of nulls). The text
  // below matches the layout classifier but carries zero extractable facts.
  ok(
    extractCultiveraInvoiceTransport("INVOICE Manifest #: 999999 Driver :") === null,
    "layout match with NO transport facts -> null (no empty donors)",
  );
  ok(extractCultiveraInvoiceTransport(null) === null, "null text -> null");
  ok(extractCultiveraInvoiceTransport("random flyer text") === null, "non-invoice -> null");

  console.log(`pdf-cultivera-invoice-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
