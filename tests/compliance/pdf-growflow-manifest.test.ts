/**
 * tests/compliance/pdf-growflow-manifest.test.ts  (H16b-1)
 *
 * Parses the owner's REAL GrowFlow manifest (hayaa_green_manifest.pdf),
 * pre-extracted with the SAME serverless `unpdf` extractor used in production
 * into tests/compliance/fixtures/pdf-growflow-manifest-sample.txt (checked in).
 *
 * WHY: GrowFlow (and the old method) email a dedicated "Manifest" / "Transfer
 * Log" document that carries the chain-of-custody the review form needs
 * (carrier, ETA, driver, vehicle, route). The invoice does NOT. This parser is
 * what lets the back office pre-populate those transport fields — the exact
 * "manifest details are not pre-populated" gap the owner reported.
 *
 * DRAFTS-ONLY: the parser produces sparse draft lines (no price/COA on the
 * GrowFlow manifest) and NEVER guesses arrived_at.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseGrowFlowManifest,
  looksLikeGrowFlowManifest,
  normalizeGrowFlowDate,
  parseGrowFlowItems,
  __runGrowFlowManifestTests,
} from "@/lib/inventory/pdf-growflow-manifest-core";

const sample = readFileSync(
  join(__dirname, "fixtures", "pdf-growflow-manifest-sample.txt"),
  "utf8",
);

describe("pdf-growflow-manifest-core (H16b-1 — GrowFlow Manifest PDF)", () => {
  it("recognizes the GrowFlow manifest and rejects other layouts", () => {
    expect(looksLikeGrowFlowManifest(sample)).toBe(true);
    // LCB Internal Shipping Document uses a numeric-only manifest id.
    expect(
      looksLikeGrowFlowManifest("Internal Shipping Document Manifest ID: 21544390883723306 Batch"),
    ).toBe(false);
    // OpenTHC invoice-manifest has no GrowFlow-style Manifest ID.
    expect(
      looksLikeGrowFlowManifest("Invoice #01KM Inventory Lot Details # Lot ID Product QA Count"),
    ).toBe(false);
  });

  it("normalizes GrowFlow m/d/yyyy and m/d/yy dates", () => {
    expect(normalizeGrowFlowDate("06/26/2026")).toBe("2026-06-26");
    expect(normalizeGrowFlowDate("6/1/26")).toBe("2026-06-01");
    expect(normalizeGrowFlowDate("garbage")).toBeNull();
  });

  it("reads every header field from the real sample", () => {
    const m = parseGrowFlowManifest(sample)!;
    expect(m).not.toBeNull();
    expect(m.source_format).toBe("pdf-manifest");
    expect(m.manifest_number).toBe("GF42612700007100-1633182-1");
    expect(m.vendor_label).toBe("HAYAA GREEN LLC");
    expect(m.vendor_license).toBe("426127");
    expect(m.transfer_date).toBe("2026-06-24");
  });

  it("parses all 15 transported items with category, medical flag, and qty", () => {
    const items = parseGrowFlowItems(sample);
    expect(items).toHaveLength(15);
    const m = parseGrowFlowManifest(sample)!;
    expect(m.lines).toHaveLength(15);

    // first line — non-medical usable cannabis
    expect(m.lines[0].lot_code).toBe("GF42612705585563");
    expect(m.lines[0].product_name).toBe("Legacy - DOH Jays .5g - Legacy Glue - 1g");
    expect(m.lines[0].category).toBe("Usable Cannabis");
    expect(m.lines[0].is_medical).toBe(false);
    expect(m.lines[0].received_qty).toBe(20);

    // an infused line carries the "Yes" medical flag
    const truffle = m.lines.find((l) => /Triple Truffle Jays/.test(l.product_name ?? ""));
    expect(truffle).toBeTruthy();
    expect(truffle!.is_medical).toBe(true);
    expect(truffle!.category).toBe("Cannabis Mix Infused");
  });

  it("extracts the full chain-of-custody transport block", () => {
    const t = parseGrowFlowManifest(sample)!.transport!;
    expect(t.transporter_name).toBe("TERPENE TRANSIT");
    expect(t.transporter_license).toBe("426061");
    expect(t.driver_name).toBe("TERPENE TRANSIT");
    expect(t.departed_at).toBe("2026-06-26T13:28");
    // Arrival on the manifest is the ESTIMATE → eta_date only, never arrived_at.
    expect(t.eta_date).toBe("2026-06-29");
    expect(t.arrived_at).toBeNull();
    // n/a values are honestly null, not the literal "n/a".
    expect(t.vehicle_vin).toBeNull();
    expect(t.vehicle_plate).toBeNull();
    expect(t.route_notes).toContain("RCW 69.50.342");
  });

  it("marks lines as sparse drafts (no price/COA on the GrowFlow manifest)", () => {
    const m = parseGrowFlowManifest(sample)!;
    for (const l of m.lines) {
      expect(l.lab).toBeNull();
      expect(l.unit_cost_minor_units).toBeNull();
      expect(l.warnings.some((w) => w.includes("no per-line price/COA"))).toBe(true);
    }
    expect(m.warnings.some((w) => w.toLowerCase().includes("drafts only"))).toBe(true);
  });

  it("passes the embedded self-test suite", () => {
    const r = __runGrowFlowManifestTests(sample);
    expect(r.failed).toBe(0);
  });
});
