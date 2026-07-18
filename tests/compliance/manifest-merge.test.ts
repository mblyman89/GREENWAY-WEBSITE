/**
 * tests/compliance/manifest-merge.test.ts  (H16b-5)
 *
 * Locks in the owner-confirmed merge strategy used to fuse the several documents
 * one vendor email carries into ONE richer ParsedManifest before staging:
 *   Q1 manifest/transfer-log doc is PRIMARY for lines + transport; invoice
 *      prices merge on by Lot ID.
 *   Q2 COA potency/PASS/expiry merges only on EXACT Lot ID match.
 *   Q3 fill-only-when-empty; real disagreements raise warnings, never overwrite;
 *      arrived_at is never taken from a secondary document.
 *   Q4 one manifest per email (merge INTO it, don't duplicate).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeLotKey,
  mergeTransportFillEmpty,
  mergeCoaByLot,
  mergeInvoicePricesByLot,
  foldTransport,
  chooseTransportDonor,
  __runManifestMergeTests,
} from "@/lib/inventory/manifest-merge-core";
import { emptyTransport } from "@/lib/inventory/intake-parser";
import type { ParsedManifest, ParsedLine, ParsedLab, ParsedTransport } from "@/lib/inventory/intake-parser";

const baseLine = (lot: string): ParsedLine => ({
  product_name: "Flower",
  lot_code: lot,
  pos_product_key: lot,
  brand_name: null,
  category: null,
  strain_name: null,
  received_qty: 1,
  unit: "each",
  unit_cost_minor_units: null,
  unit_weight: null,
  unit_weight_uom: null,
  is_sample: false,
  is_medical: false,
  inventory_type: null,
  expires_on: null,
  lab: null,
  warnings: [],
  raw: {},
});

const baseManifest = (lines: ParsedLine[]): ParsedManifest => ({
  manifest_number: "M1",
  vendor_label: "V",
  vendor_license: "1",
  transfer_date: "2026-03-06",
  source_format: "pdf-manifest",
  lines,
  warnings: [],
  transport: emptyTransport(),
});

describe("manifest-merge-core (H16b-5)", () => {
  it("normalizes Lot IDs for matching", () => {
    expect(normalizeLotKey(" 01km g0ft ")).toBe("01KMG0FT");
    expect(normalizeLotKey(null)).toBeNull();
    expect(normalizeLotKey("   ")).toBeNull();
  });

  it("Q3: transport merge fills blanks, preserves primary, never takes arrived_at", () => {
    const primary: ParsedTransport = { ...emptyTransport(), driver_name: "David Sanchez", departed_at: "2026-06-29T08:44" };
    const secondary: ParsedTransport = {
      ...emptyTransport(),
      driver_name: "SOMEONE ELSE",
      transporter_name: "Svin Garden",
      arrived_at: "2026-06-30T10:27",
      eta_date: "2026-06-30",
    };
    const { transport, conflicts } = mergeTransportFillEmpty(primary, secondary);
    expect(transport.driver_name).toBe("David Sanchez");
    expect(transport.transporter_name).toBe("Svin Garden");
    expect(transport.eta_date).toBe("2026-06-30");
    expect(transport.arrived_at).toBeNull();
    expect(conflicts.some((c) => c.field === "driver_name")).toBe(true);
  });

  it("Q2: COA merges only on exact Lot ID and flags unmatched lots", () => {
    const lab: ParsedLab = {
      labtest_external_identifier: "WA-260305-083",
      lab_name: null,
      tested_on: "2026-03-06",
      thc_pct: null,
      cbd_pct: null,
      thca_pct: null,
      cbda_pct: null,
      total_thc_pct: 22,
      total_cbd_pct: 0.054,
      total_cannabinoids_pct: 27,
      potency_json: { "total-thc": 22 },
      terpenes_json: null,
      analytes_json: null,
      passed: true,
      coa_url: null,
      coa_release_date: "2026-03-06",
      coa_expire_date: "2027-03-06",
      raw: {},
    };
    const man = baseManifest([baseLine("01KMG0FTXX17N0ST"), baseLine("NO-COA")]);
    const res = mergeCoaByLot(man, { "01KMG0FTXX17N0ST": lab, "01KMG0JFJT0ZN4VS": lab });
    expect(res.merged).toBe(1);
    expect(res.manifest.lines[0].lab?.labtest_external_identifier).toBe("WA-260305-083");
    expect(res.manifest.lines[0].expires_on).toBe("2027-03-06");
    expect(res.manifest.lines[1].lab).toBeNull();
    expect(res.unmatchedCoaLots).toContain("01KMG0JFJT0ZN4VS");
    expect(res.manifest.warnings.some((w) => w.includes("no matching manifest line"))).toBe(true);
  });

  it("Q3: COA lab conflict keeps the primary lab and warns", () => {
    const lab = (id: string): ParsedLab => ({
      labtest_external_identifier: id,
      lab_name: null,
      tested_on: null,
      thc_pct: null,
      cbd_pct: null,
      thca_pct: null,
      cbda_pct: null,
      total_thc_pct: null,
      total_cbd_pct: null,
      total_cannabinoids_pct: null,
      potency_json: null,
      terpenes_json: null,
      analytes_json: null,
      passed: null,
      coa_url: null,
      coa_release_date: null,
      coa_expire_date: null,
      raw: {},
    });
    const man = baseManifest([{ ...baseLine("LOT1"), lab: lab("WA-OTHER-001") }]);
    const res = mergeCoaByLot(man, { LOT1: lab("WA-260305-083") });
    expect(res.manifest.lines[0].lab?.labtest_external_identifier).toBe("WA-OTHER-001");
    expect(res.conflicts.some((c) => c.field === "labtest_external_identifier")).toBe(true);
    expect(res.manifest.lines[0].warnings.some((w) => w.includes("COA conflict"))).toBe(true);
  });

  it("Q1/Q3: invoice prices merge by Lot ID, fill-only-when-empty", () => {
    const man = baseManifest([baseLine("LOT1"), { ...baseLine("LOT2"), unit_cost_minor_units: 2000 }]);
    const invoice = baseManifest([
      { ...baseLine("LOT1"), unit_cost_minor_units: 1500, brand_name: "Acme" },
      { ...baseLine("LOT2"), unit_cost_minor_units: 999 },
      { ...baseLine("INV-ONLY"), unit_cost_minor_units: 111 },
    ]);
    const res = mergeInvoicePricesByLot(man, invoice);
    expect(res.pricedLines).toBe(1);
    expect(res.manifest.lines[0].unit_cost_minor_units).toBe(1500);
    expect(res.manifest.lines[0].brand_name).toBe("Acme");
    expect(res.manifest.lines[1].unit_cost_minor_units).toBe(2000); // preserved
    expect(res.unmatchedInvoiceLots).toContain("INV-ONLY");
  });

  it("foldTransport fills blanks, keeps primary, warns on conflict", () => {
    const man = baseManifest([]);
    man.transport = { ...emptyTransport(), driver_name: "David Sanchez" };
    const secondary: ParsedTransport = { ...emptyTransport(), driver_name: "OTHER", transporter_name: "Svin Garden" };
    const folded = foldTransport(man, secondary);
    expect(folded.transport?.transporter_name).toBe("Svin Garden");
    expect(folded.transport?.driver_name).toBe("David Sanchez");
    expect(folded.warnings.some((w) => w.includes("Transport conflict"))).toBe(true);
  });

  it("chooseTransportDonor picks the bundled shipping PDF's transport by manifest number (H17)", () => {
    // Grounded in the real SPR bundle: the WCIA JSON's transporter fields are
    // null while the bundled shipping-manifest PDF carries the driver/vehicle.
    const sprTransport: ParsedTransport = {
      ...emptyTransport(),
      transporter_name: "Kory T Anderson",
      driver_name: "Kory T Anderson",
      vehicle_description: "2021 WHITE Nissan NV200",
      vehicle_plate: "D44636H",
      vehicle_vin: "3N6CM0KN1MK695529",
    };

    // Exact manifest-number match wins.
    expect(
      chooseTransportDonor("11804443981161219", [
        { manifest_number: "11804443981161219", transport: sprTransport },
      ]),
    ).toBe(sprTransport);

    // Single candidate with no number is accepted (numbers can't disagree).
    expect(
      chooseTransportDonor("11804443981161219", [
        { manifest_number: null, transport: sprTransport },
      ]),
    ).toBe(sprTransport);

    // Number DISAGREEMENT refuses — no guessing.
    expect(
      chooseTransportDonor("11804443981161219", [
        { manifest_number: "99999999999999999", transport: sprTransport },
      ]),
    ).toBeNull();

    // Two numberless candidates are ambiguous -> null.
    expect(
      chooseTransportDonor("11804443981161219", [
        { manifest_number: null, transport: sprTransport },
        { manifest_number: null, transport: { ...emptyTransport(), driver_name: "Someone Else" } },
      ]),
    ).toBeNull();

    // unpdf whitespace inside numbers is normalized before comparing.
    expect(
      chooseTransportDonor("118 0444 3981161219", [
        { manifest_number: "11804443981161219", transport: sprTransport },
      ]),
    ).toBe(sprTransport);

    // All-null transport never donates.
    expect(
      chooseTransportDonor("11804443981161219", [
        { manifest_number: "11804443981161219", transport: emptyTransport() },
      ]),
    ).toBeNull();
  });

  it("passes the embedded self-test suite", () => {
    const r = __runManifestMergeTests();
    expect(r.failed).toBe(0);
  });
});
