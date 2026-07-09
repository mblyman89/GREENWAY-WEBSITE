/**
 * tests/compliance/intake-transport.test.ts  (H15a)
 *
 * Transport / ETA auto-fill from the source document. Grounded in REAL
 * artifacts, never invented:
 *  - the owner's real Cultivera WCIA transfer JSON (checked in at
 *    back-office/source-materials/examples/QGT_FreddysFuego_ORD-20636_transfer.json)
 *    carries est_departed_at / est_arrival_at / route with NULL transporter —
 *    the parser must lift what exists and tolerate the nulls;
 *  - the GrowFlow variant of the same WCIA 2.1.0 schema carries
 *    transporter_name / transporter_license (owner-verified screenshot), so a
 *    minimal schema-true document exercises those fields;
 *  - the LCB Internal Shipping Document + OpenTHC invoice-manifest transport
 *    seeds are asserted inside their embedded self-tests (run from
 *    pdf-manifest.test.ts), so here we only cover the shared pure helpers.
 *
 * DRAFTS-ONLY guarantees under test:
 *  - est_arrival_at seeds eta_date, NEVER arrived_at (staff stamp the actual
 *    arrival when the truck shows up);
 *  - transportHasData() gates the DB write so all-null transport is skipped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseVendorJson,
  emptyTransport,
  transportHasData,
  combineDateAndTime,
} from "@/lib/inventory/intake-parser";

const wciaJson = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "back-office",
    "source-materials",
    "examples",
    "QGT_FreddysFuego_ORD-20636_transfer.json",
  ),
  "utf8",
);

describe("H15a — WCIA JSON transport auto-fill (real Cultivera sample)", () => {
  const result = parseVendorJson(wciaJson);

  it("still parses the real transfer as WCIA", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.source_format).toBe("wcia");
    expect(result.manifest.lines.length).toBeGreaterThan(0);
  });

  it("lifts est_departed_at / route and seeds eta_date from est_arrival_at", () => {
    if (!result.ok) throw new Error("parse failed");
    const t = result.manifest.transport;
    expect(t).toBeDefined();
    // Values read straight from the checked-in fixture — verified, not assumed.
    expect(t?.departed_at).toBe("2025-03-13T14:00:00+00:00");
    expect(t?.eta_date).toBe("2025-03-13");
    expect(t?.route_notes).toContain("Head west toward 12 Trees Ln NW");
  });

  it("NEVER guesses arrived_at (actual arrival is stamped by staff)", () => {
    if (!result.ok) throw new Error("parse failed");
    expect(result.manifest.transport?.arrived_at).toBeNull();
  });

  it("tolerates the Cultivera nulls (no transporter on this sample)", () => {
    if (!result.ok) throw new Error("parse failed");
    const t = result.manifest.transport;
    expect(t?.transporter_name).toBeNull();
    expect(t?.transporter_license).toBeNull();
    expect(t?.driver_name).toBeNull();
    expect(t?.vehicle_plate).toBeNull();
  });
});

describe("H15a — GrowFlow WCIA variant carries the transporter", () => {
  // Minimal schema-true WCIA 2.1.0 document shaped like the owner-verified
  // GrowFlow endpoint payload (transporter_name populated, e.g. a person's
  // name when the grower self-transports).
  const growflowLike = JSON.stringify({
    document_name: "WCIA Transfer Schema",
    document_schema_version: "2.1.0",
    transfer_id: "GF-TR-1",
    external_id: "29127",
    from_license_number: "999999",
    from_license_name: "Example Farms",
    to_license_number: "413541",
    est_departed_at: "2026-02-01T16:00:00+00:00",
    est_arrival_at: "2026-02-01T21:30:00+00:00",
    route: "Take I-5 S",
    transporter_name: "Colin Venske",
    transporter_license: null,
    inventory_transfer_items: [
      { product_name: "Sample Flower 3.5g", qty: 2, unit_price: 10 },
    ],
  });

  it("lifts transporter_name + est_* + route", () => {
    const r = parseVendorJson(growflowLike);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.manifest.transport;
    expect(t?.transporter_name).toBe("Colin Venske");
    expect(t?.transporter_license).toBeNull();
    expect(t?.departed_at).toBe("2026-02-01T16:00:00+00:00");
    expect(t?.eta_date).toBe("2026-02-01");
    expect(t?.route_notes).toBe("Take I-5 S");
    expect(t?.arrived_at).toBeNull();
  });
});

describe("H15a — pure helpers", () => {
  it("transportHasData gates the DB write", () => {
    expect(transportHasData(undefined)).toBe(false);
    expect(transportHasData(null)).toBe(false);
    expect(transportHasData(emptyTransport())).toBe(false);
    const t = emptyTransport();
    t.eta_date = "2026-02-01";
    expect(transportHasData(t)).toBe(true);
  });

  it("combineDateAndTime joins ISO date + 12-hour clock", () => {
    expect(combineDateAndTime("2026-06-26", "12:00 am")).toBe("2026-06-26T00:00");
    expect(combineDateAndTime("2026-06-29", "8:00 am")).toBe("2026-06-29T08:00");
    expect(combineDateAndTime("2026-04-29", "Wed Apr, 29, 2026 07:10am")).toBe(
      "2026-04-29T07:10",
    );
    expect(combineDateAndTime("2026-04-29", "04:20pm")).toBe("2026-04-29T16:20");
    expect(combineDateAndTime("2026-04-29", "12:15 pm")).toBe("2026-04-29T12:15");
    // Missing / unreadable time degrades to the bare date; missing date → null.
    expect(combineDateAndTime("2026-04-29", null)).toBe("2026-04-29");
    expect(combineDateAndTime("2026-04-29", "garbage")).toBe("2026-04-29");
    expect(combineDateAndTime(null, "8:00 am")).toBeNull();
  });
});
