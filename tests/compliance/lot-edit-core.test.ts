/**
 * tests/compliance/lot-edit-core.test.ts
 *
 * SLICE 77 — vitest mirror for the lot-edit gatekeeper. The stakes: WA I-502
 * traceability numbers (quantities, lot codes, costs, LCB classification,
 * dates, COA links) must NEVER be hand-edited — they flow from manifests and
 * audited adjustments. Only the descriptive linkage a human got wrong at
 * intake (vendor, brand, strain name, strain family) is correctable by hand.
 * These tests pin that whitelist, the parse refusals, the vendor⇄brand
 * consistency rule, and the plain-English audit summary.
 */
import { describe, it, expect } from "vitest";
import {
  __runLotEditCoreTests,
  EDITABLE_LOT_FIELDS,
  LOCKED_LOT_FIELDS,
  STRAIN_TYPE_OPTIONS,
  parseLotEditInput,
  brandMatchesVendor,
  buildLotEditSummary,
} from "@/lib/inventory/lot-edit-core";

const ID_A = "11111111-2222-3333-4444-555555555555";
const ID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("lot-edit-core (SLICE 77)", () => {
  it("embedded self-tests pass", () => {
    const { passed } = __runLotEditCoreTests();
    expect(passed).toBeGreaterThanOrEqual(35);
  });

  it("the legal whitelist is EXACTLY vendor, brand, strain name, strain type", () => {
    expect([...EDITABLE_LOT_FIELDS]).toEqual([
      "vendor_id",
      "brand_id",
      "strain_name",
      "strain_type",
    ]);
  });

  it("traceability columns are documented as locked and never overlap the whitelist", () => {
    const locked = LOCKED_LOT_FIELDS as readonly string[];
    for (const col of [
      "lot_code",
      "on_hand_qty",
      "received_qty",
      "unit_cost_minor_units",
      "category",
      "inventory_type",
      "expires_on",
      "lab_result_id",
      "manifest_id",
    ]) {
      expect(locked).toContain(col);
    }
    for (const f of EDITABLE_LOT_FIELDS) {
      expect(locked).not.toContain(f);
    }
  });

  it("parses a full form: trims strain, lowercases strain type, keeps ids", () => {
    const r = parseLotEditInput({
      vendor_id: ID_A,
      brand_id: ID_B,
      strain_name: "  Blue Dream  ",
      strain_type: "Hybrid",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch).toEqual({
        vendor_id: ID_A,
        brand_id: ID_B,
        strain_name: "Blue Dream",
        strain_type: "hybrid",
      });
    }
  });

  it("empty strings clear every field to NULL", () => {
    const r = parseLotEditInput({ vendor_id: "", brand_id: "", strain_name: "", strain_type: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch).toEqual({
        vendor_id: null,
        brand_id: null,
        strain_name: null,
        strain_type: null,
      });
    }
  });

  it("refuses malformed ids, unknown strain types, and over-long strain names", () => {
    expect(parseLotEditInput({ vendor_id: "not-an-id" }).ok).toBe(false);
    expect(parseLotEditInput({ brand_id: "DROP TABLE lots;" }).ok).toBe(false);
    expect(parseLotEditInput({ strain_type: "energetic" }).ok).toBe(false);
    expect(parseLotEditInput({ strain_name: "x".repeat(121) }).ok).toBe(false);
    expect(parseLotEditInput({ strain_name: "x".repeat(120) }).ok).toBe(true);
  });

  it("every displayed strain family is accepted", () => {
    expect([...STRAIN_TYPE_OPTIONS]).toEqual([
      "indica",
      "sativa",
      "hybrid",
      "indica-hybrid",
      "sativa-hybrid",
      "cbd",
    ]);
    for (const t of STRAIN_TYPE_OPTIONS) {
      expect(parseLotEditInput({ strain_type: t }).ok).toBe(true);
    }
  });

  it("brand⇄vendor consistency: a vendor-linked brand only pairs with its own vendor", () => {
    expect(brandMatchesVendor(null, ID_A)).toBe(true);
    expect(brandMatchesVendor({ vendor_id: null }, ID_A)).toBe(true);
    expect(brandMatchesVendor({ vendor_id: ID_A }, ID_A)).toBe(true);
    expect(brandMatchesVendor({ vendor_id: ID_A }, ID_B)).toBe(false);
    expect(brandMatchesVendor({ vendor_id: ID_A }, null)).toBe(true);
  });

  it("audit summary lists only changed rows in plain English with (empty) placeholders", () => {
    const lines = buildLotEditSummary(
      { vendor: "Old Farm", brand: null, strain_name: "GDP", strain_type: "indica" },
      { vendor: "New Farm", brand: "House Brand", strain_name: "GDP", strain_type: "indica" },
    );
    expect(lines).toEqual([
      "Vendor: Old Farm \u2192 New Farm",
      "Brand: (empty) \u2192 House Brand",
    ]);
    expect(
      buildLotEditSummary(
        { vendor: "A", brand: "B", strain_name: "C", strain_type: "hybrid" },
        { vendor: "A", brand: "B", strain_name: "C", strain_type: "hybrid" },
      ),
    ).toEqual([]);
  });
});
