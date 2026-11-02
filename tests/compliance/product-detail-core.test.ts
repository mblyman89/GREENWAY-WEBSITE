/**
 * Register lot details — vitest mirror for the server-side detail builder.
 *
 * Runs the full self-test suite, then pins what the owner asked for
 * ("every detail available, vendor lot number, everything") and the
 * safety rules: no cost on a card reachable from the lock screen, samples
 * never shown, a lot linked to another size never shown as this size.
 */
import { describe, expect, it } from "vitest";

import {
  __runProductDetailCoreTests,
  buildProductDetails,
  detailLotKeys,
  lotMatchFor,
  type DetailLotRow,
} from "@/lib/pos/product-detail-core";

function lot(over: Partial<DetailLotRow> = {}): DetailLotRow {
  return {
    id: "L1",
    lot_code: "LOT-1",
    vendor_id: "V1",
    brand_id: null,
    manifest_id: null,
    lab_result_id: null,
    pos_product_key: "P",
    product_name: "Blue Dream 3.5g",
    strain_name: "Blue Dream",
    category: "flower",
    inventory_type: "usable_marijuana",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    is_sample: false,
    is_medical: false,
    received_qty: 20,
    on_hand_qty: 12,
    expires_on: null,
    status: "active",
    created_at: "2025-01-02T00:00:00Z",
    vendor_inventory_external_id: "VEND-LOT-9",
    vendor_inventory_external_id_source: "wcia_json",
    ...over,
  };
}

const base = { labs: [], brands: [], manifests: [], todayPacific: "2025-03-01" };

describe("product-detail-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runProductDetailCoreTests()).not.toThrow();
  });
});

describe("product-detail-core pins", () => {
  it("shows the vendor lot number", () => {
    const r = buildProductDetails({ ...base, productId: "P", variantId: "P", lots: [lot()], vendors: [{ id: "V1", display_name: "Acme Farms" }] });
    const rows = r.lots[0].sections.flatMap((s) => s.rows);
    expect(rows.some((x) => x.value === "VEND-LOT-9")).toBe(true);
    expect(rows.some((x) => x.value.includes("Acme Farms"))).toBe(true);
  });

  it("never exposes cost", () => {
    const r = buildProductDetails({ ...base, productId: "P", variantId: "P", lots: [lot()], vendors: [] });
    const text = JSON.stringify(r).toLowerCase();
    expect(text).not.toContain("cost");
  });

  it("drops trade samples", () => {
    const r = buildProductDetails({ ...base, productId: "P", variantId: "P", lots: [lot({ is_sample: true })], vendors: [] });
    expect(r.lots).toHaveLength(0);
  });

  it("a lot linked to another size is not this size's stock", () => {
    expect(lotMatchFor({ pos_product_key: "P", menu_source_variant_id: "P-other" }, "P", "P-mine")).toBeNull();
    expect(lotMatchFor({ pos_product_key: "P", menu_source_variant_id: "P-mine" }, "P", "P-mine")).toBe("size-link");
  });

  it("reads the card key and the onboarded variant key", () => {
    expect(detailLotKeys("P", "P")).toEqual(["P"]);
    expect(detailLotKeys("", "")).toEqual([]);
  });
});
