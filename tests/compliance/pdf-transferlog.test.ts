/**
 * tests/compliance/pdf-transferlog.test.ts  (H16b-3)
 *
 * Parses the owner's REAL old-method Transfer Log (svin_garden_transfer_log.pdf),
 * pre-extracted with the SAME serverless `unpdf` extractor used in production
 * into tests/compliance/fixtures/pdf-transferlog-oldmethod-sample.txt (checked in).
 *
 * WHY: the "old method" (OpenTHC) emails a dedicated "Transfer Log (This
 * document is NOT a manifest)" PDF alongside the priced OpenTHC invoice. The
 * invoice carries the priced lines + Depart/Arrive only; the Transfer Log
 * carries the rest of the chain-of-custody the review form needs (transporter,
 * full vehicle year/color/make/model/plate, the two Approx. Departure/Arrival
 * Date/Time values, the numbered Travel Route, AND the real LCB Manifest ID
 * distinct from the GF Transfer Log ID). Reading this doc is what fills the
 * transport fields the owner reported as blank on old-method emails.
 *
 * REGRESSION GUARD: the document top carries a barcode that is the GF Transfer
 * Log ID (GF41582000007617), which is NOT a line-item Lot ID. This test locks
 * in that the item parser excludes it and returns exactly the 20 real lines.
 *
 * DRAFTS-ONLY: the parser produces sparse draft lines (no price/COA on the
 * Transfer Log) and NEVER guesses arrived_at.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTransferLog,
  looksLikeTransferLog,
  normalizeTransferLogDate,
  parseTransferLogItems,
  __runTransferLogTests,
} from "@/lib/inventory/pdf-transferlog-core";

const sample = readFileSync(
  join(__dirname, "fixtures", "pdf-transferlog-oldmethod-sample.txt"),
  "utf8",
);

describe("pdf-transferlog-core (H16b-3 — old-method Transfer Log PDF)", () => {
  it("recognizes the Transfer Log and rejects other layouts", () => {
    expect(looksLikeTransferLog(sample)).toBe(true);
    // LCB Internal Shipping Document is a different (Cultivera) layout.
    expect(
      looksLikeTransferLog("Internal Shipping Document Manifest ID: 21544 Batch"),
    ).toBe(false);
    // OpenTHC invoice-manifest is a different layout.
    expect(
      looksLikeTransferLog("Invoice #01KM Inventory Lot Details QA Count"),
    ).toBe(false);
  });

  it("normalizes m/d/yyyy and m/d/yy dates", () => {
    expect(normalizeTransferLogDate("6/29/2026")).toBe("2026-06-29");
    expect(normalizeTransferLogDate("6/1/26")).toBe("2026-06-01");
    expect(normalizeTransferLogDate("garbage")).toBeNull();
  });

  it("reads every header field, preferring the real LCB Manifest ID", () => {
    const m = parseTransferLog(sample)!;
    expect(m).not.toBeNull();
    expect(m.source_format).toBe("pdf-manifest");
    // Real LCB Manifest ID beats the GF Transfer Log ID.
    expect(m.manifest_number).toBe("603353555");
    expect(m.vendor_label).toBe("Svin Garden");
    expect(m.vendor_license).toBe("415820");
    expect(m.transfer_date).toBe("2026-06-29");
  });

  it("parses exactly the 20 real item lines and excludes the header barcode", () => {
    const items = parseTransferLogItems(sample);
    expect(items).toHaveLength(20);
    // REGRESSION GUARD: the Transfer Log ID barcode is NOT a line-item Lot ID.
    expect(items.some((i) => i.lotId === "GF41582000007617")).toBe(false);

    const m = parseTransferLog(sample)!;
    expect(m.lines).toHaveLength(20);

    // first line — usable cannabis
    expect(m.lines[0].lot_code).toBe("GF41582000123451");
    expect(m.lines[0].product_name).toBe("Select Series - Amaretto Sour - 3.5g");
    expect(m.lines[0].category).toBe("Usable Cannabis");
    expect(m.lines[0].received_qty).toBe(15);

    // last line — extract for inhalation
    expect(m.lines[19].lot_code).toBe("GF41582000123453");
    expect(m.lines[19].product_name).toBe("Live Resin Disposables - Yemaya #1 - 1g");

    // an extract line carries the correct inventory type + qty
    const extract = m.lines.find((l) => l.lot_code === "GF41582000123464");
    expect(extract).toBeTruthy();
    expect(extract!.category).toBe("Extract For Inhalation");
    expect(extract!.received_qty).toBe(2);
  });

  it("extracts the full chain-of-custody transport block", () => {
    const t = parseTransferLog(sample)!.transport!;
    expect(t.driver_name).toBe("David Sanchez");
    expect(t.transporter_name).toBe("Svin Garden");
    expect(t.vehicle_description).toBe("2015 blue toyota prius v");
    expect(t.vehicle_plate).toBe("BWD5565");
    expect(t.departed_at).toBe("2026-06-29T08:44");
    // Arrival on the Transfer Log is the ESTIMATE → eta_date only, never arrived_at.
    expect(t.eta_date).toBe("2026-06-30");
    expect(t.arrived_at).toBeNull();
    expect(t.route_notes).toContain("I-5 S");
  });

  it("marks lines as sparse drafts (no price/COA on the Transfer Log)", () => {
    const m = parseTransferLog(sample)!;
    for (const l of m.lines) {
      expect(l.lab).toBeNull();
      expect(l.unit_cost_minor_units).toBeNull();
      expect(l.warnings.some((w) => w.includes("no per-line price/COA"))).toBe(true);
    }
    expect(m.warnings.some((w) => w.toLowerCase().includes("drafts only"))).toBe(true);
  });

  it("passes the embedded self-test suite", () => {
    const r = __runTransferLogTests(sample);
    expect(r.failed).toBe(0);
  });
});
