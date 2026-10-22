/**
 * R74 S6: the email match by barcode + the ONE "Unmatched Cultivera stock" manifest.
 * Owner (round 2 #5): "Whatever Cultivera doesn't find, the email will ... for ones the email can't
 * find either, yes flag them in one unmatched Cultivera stock manifest."
 * Uses the REAL WCIA parser (parseVendorJson) so a WCIA transfer JSON from stephen@ matches on
 * inventory_id = Cultivera barcode end to end.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseVendorJson } from "@/lib/inventory/intake-parser";
import { __runCultiveraMailMatchCoreTests, openLotsFromTransferPlan, planMailMatch, type MailDoc } from "@/lib/pos/cultivera-mail-match-core";

describe("R74 S6 pure core", () => {
  it("self-tests pass at the pinned count", () => {
    const r = __runCultiveraMailMatchCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(29);
  });

  it("is registered in the pure self-test runner with its floor", () => {
    const src = readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8");
    expect(src).toContain("__runCultiveraMailMatchCoreTests()");
    expect(src).toMatch(/cultivera-mail-match-core: .*expected >= 29/);
  });
});

describe("R74 S6 with the real WCIA parser", () => {
  const wcia = JSON.stringify({
    document_schema_version: "2.1.0",
    transfer_id: "0009001",
    from_license_number: "412345",
    from_license_name: "CANNA ORGANIX LLC",
    est_departed_at: "2025-03-01T17:00:00Z",
    inventory_transfer_items: [
      { inventory_id: "1234567890123456", product_name: "Blue Dream 3.5g", inventory_type: "Usable Marijuana", qty: "10", unit_price: "4.50", uom: "each" },
      { inventory_id: "9999999999999999", product_name: "Sold Out 1g", inventory_type: "Usable Marijuana", qty: "5", unit_price: "2.00", uom: "each" },
    ],
  });

  it("an emailed WCIA transfer places the lot on its manifest; the rest go to the one unmatched manifest", () => {
    const parsed = parseVendorJson(wcia);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest.source_format).toBe("wcia");
    const docs: MailDoc[] = [{ messageId: "gm1", emailAt: "2025-03-01T18:00:00Z", filename: "0009001.json", manifest: parsed.manifest }];
    const open = openLotsFromTransferPlan(
      [
        { barcode: "1234567890123456", vendor: "Canna Organix", receivedDateRaw: "", units: 4, productName: "Blue Dream" },
        { barcode: "5555555555555555", vendor: "Default Vendor", receivedDateRaw: "", units: 2, productName: "Mystery" },
        { barcode: "7777777777777777", vendor: "Fireline", receivedDateRaw: "2025-01-01 10:00:00", units: 1 },
      ],
      [
        { barcode: "1234567890123456", matched: false },
        { barcode: "5555555555555555", matched: false },
        { barcode: "7777777777777777", matched: true },
      ],
    );
    expect(open.map((o) => o.barcode)).toEqual(["1234567890123456", "5555555555555555"]);
    const plan = planMailMatch(open, docs);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({ manifestNumber: "0009001", vendorLicense: "412345", barcodes: ["1234567890123456"], otherLines: 1, kind: "cultivera-reconstructed" });
    const hit = plan.decisions.find((d) => d.barcode === "1234567890123456");
    expect(hit).toMatchObject({ outcome: "email", vendorAgrees: true });
    if (hit?.outcome === "email") {
      expect(hit.facts.productName).toBe("Blue Dream 3.5g");
      expect(hit.facts.unitCostCents).toBe(parsed.manifest.lines[0].unit_cost_minor_units);
    }
    expect(plan.unmatched).toMatchObject({ manifestNumber: "CV-UNMATCHED", label: "Unmatched Cultivera stock", barcodes: ["5555555555555555"], units: 2 });
    expect(plan.complete).toBe(false);
    expect(plan.line).toContain('1 go on the "Unmatched Cultivera stock" manifest');
  });
});
