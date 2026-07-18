/**
 * tests/compliance/pdf-invoice-cultivera.test.ts  (H18)
 *
 * The Cultivera ORDER INVOICE is NOT a shipping manifest — the manifest parser
 * rightly rejects it — but its header prints transport facts (Driver, vehicle,
 * Plate, Arrival date estimate) keyed by the same Manifest #. The pure reader
 * (pdf-cultivera-invoice-core) turns that header into a TransportDonor so the
 * driver/vehicle/plate still reach the intake form when the Manifest PDF is
 * missing from the email.
 *
 * The fixture is the owner's REAL SPR invoice (Invoice-OrderReport-25960.pdf,
 * unpdf-extracted, checked in) — never invented. Any drift in Cultivera's
 * invoice layout fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  looksLikeCultiveraInvoice,
  parseCultiveraInvoiceDate,
  extractCultiveraInvoiceTransport,
  __runCultiveraInvoiceTests,
} from "@/lib/inventory/pdf-cultivera-invoice-core";

const realInvoice = readFileSync(
  join(__dirname, "fixtures", "pdf-invoice-cultivera-spr-sample.txt"),
  "utf8",
);

describe("pdf-cultivera-invoice-core (H18 — invoice header as transport donor)", () => {
  it("passes all embedded self-tests", () => {
    const { failed } = __runCultiveraInvoiceTests();
    expect(failed).toBe(0);
  });

  it("recognizes the real SPR invoice and rejects other layouts", () => {
    expect(looksLikeCultiveraInvoice(realInvoice)).toBe(true);
    expect(looksLikeCultiveraInvoice("Internal Shipping Document Manifest ID 123")).toBe(false);
    expect(looksLikeCultiveraInvoice("")).toBe(false);
  });

  it("extracts the exact transport facts from the real invoice", () => {
    const r = extractCultiveraInvoiceTransport(realInvoice);
    expect(r).not.toBeNull();
    expect(r?.manifest_number).toBe("11804443981161219");
    expect(r?.transport.driver_name).toBe("Kory T Anderson");
    expect(r?.transport.vehicle_description).toBe("2021 WHITE Nissan NV200");
    expect(r?.transport.vehicle_plate).toBe("D44636H");
    // Arrival date is an ESTIMATE — eta_date only, never arrived_at.
    expect(r?.transport.eta_date).toBe("2026-07-15");
    expect(r?.transport.arrived_at).toBeNull();
    // Facts the invoice layout does NOT carry stay honestly null.
    expect(r?.transport.vehicle_vin).toBeNull();
    expect(r?.transport.transporter_name).toBeNull();
    expect(r?.transport.transporter_license).toBeNull();
    expect(r?.transport.departed_at).toBeNull();
  });

  it("normalizes the invoice's long-form dates", () => {
    expect(parseCultiveraInvoiceDate("Wednesday, July 15, 2026")).toBe("2026-07-15");
    expect(parseCultiveraInvoiceDate("July 5, 2026")).toBe("2026-07-05");
    expect(parseCultiveraInvoiceDate("garbage")).toBeNull();
    expect(parseCultiveraInvoiceDate(null)).toBeNull();
  });

  it("never returns a donor full of nulls", () => {
    expect(extractCultiveraInvoiceTransport("INVOICE Manifest #: 999999 Driver :")).toBeNull();
    expect(extractCultiveraInvoiceTransport(null)).toBeNull();
    expect(extractCultiveraInvoiceTransport("random flyer text")).toBeNull();
  });
});
