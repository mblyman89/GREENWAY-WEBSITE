/**
 * R24 S23 follow-up: transform.ts genericDescription moves onto the ONE
 * placeholder source, golden-record-core boilerplateDescription().
 *
 * Owner (verbatim): "Please build S36 as one pr, then build the three small
 * follow ups, each as their own pr. ... Follow the standing rules and never
 * guess, never assume. Test it, test the tests."
 *
 * Contract: NO behaviour change. The Cultivera import's placeholder sentence
 * is byte-identical to the legacy inline template for every card the real
 * pipeline builds, and the S23 gap vector still reads it as "not described".
 *
 *   A. golden master: the REAL transformWorkbooks pipeline over in-memory
 *      workbooks; every placeholder equals the legacy template, character
 *      for character (brand present, brand missing -> "Greenway", messy
 *      whitespace, master-less inventory rows, real descriptions kept).
 *   B. the gap vector counts those placeholders as missing (S23.5).
 *   C. source pins: one source, no inline copy left in transform.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { transformWorkbooks } from "@/lib/pos/transform";
import { BOILERPLATE_TAIL, boilerplateDescription, isBoilerplateDescription } from "@/lib/catalog/golden-record-core";
import { computeGaps } from "@/lib/enrichment/store";
import type { MenuItemRow } from "@/lib/pos/db-types";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** The pre-R24 inline template, verbatim (the golden master). */
const legacyGeneric = (displayName: string, brand: string) =>
  `${displayName} from ${brand}. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.`;

function toBuffer(sheetName: string, rows: Record<string, string>[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function product(over: Record<string, string>): Record<string, string> {
  return {
    "Product Name": "Acme Blue Dream 3.5g", "Inventory Type": "Usable Marijuana", Category: "Flower",
    Brand: "Acme", Type: "Hybrid", Strain: "Blue Dream", UOM: "Grams", "Package Size": "3.50 Grams",
    Price: "$25.00", Description: "",
    ...over,
  };
}

function inv(over: Record<string, string>): Record<string, string> {
  return {
    Id: "1", Location: "Main", Barcode: "BC-1", Alias: "", Product: "Acme Blue Dream 3.5g",
    Category: "Flower", InventoryType: "Usable Marijuana", Strain: "Blue Dream", Brand: "Acme",
    Vendor: "ACME FARMS", "Product Price": "$25.00", Cost: "$10.00", "Units Available For Sale": "4",
    "Units In Stock": "4", "Package Size": "3.50 Grams", "Storage Location": "Sales Floor",
    "Is Medical": "False", "Is Cannabis": "True", "Is Sample": "False", Lab: "", "[COA Y/N]": "Y",
    Cbd: "0.5", Cbda: "", Thc: "22", Thca: "", Total: "24.5", "Terpene Total": "",
    "Units On Hold": "0", "Quantity Sold": "0", "Quantity Purchased": "4",
    "Expiration date": "", "Received date": "06/17/2026",
    ...over,
  };
}

function run() {
  const productsBuffer = toBuffer("Sheet1", [
    // 1. described product: its own copy is kept, never the placeholder
    product({ "Product Name": "Acme Blue Dream 3.5g", Description: "Nice flower with a sweet berry finish." }),
    // 2. no description, brand present
    product({ "Product Name": "Acme Sour Diesel 3.5g", Strain: "Sour Diesel" }),
    // 3. no description, NO brand anywhere -> house brand "Greenway"
    product({ "Product Name": "Lemon Haze 1g", Brand: "", Strain: "Lemon Haze", "Package Size": "1.00 Grams" }),
    // 4. no description, messy whitespace in brand (normalised upstream)
    product({ "Product Name": "Fairwinds  Gelato 1g", Brand: "  Fair   Winds  ", Strain: "Gelato", "Package Size": "1.00 Grams" }),
    // 5. a product with no inventory row (hidden "no-inventory" card)
    product({ "Product Name": "Ghost OG 7g", Brand: "Spectre", Strain: "Ghost OG", "Package Size": "7.00 Grams" }),
  ]);
  const inventoriesBuffer = toBuffer("Inventories", [
    inv({ Id: "1", Barcode: "BC-1" }),
    inv({ Id: "2", Barcode: "BC-2", Product: "Acme Sour Diesel 3.5g", Strain: "Sour Diesel" }),
    inv({ Id: "3", Barcode: "BC-3", Product: "Lemon Haze 1g", Brand: "", Strain: "Lemon Haze", "Package Size": "1.00 Grams" }),
    inv({ Id: "4", Barcode: "BC-4", Product: "Fairwinds  Gelato 1g", Brand: "  Fair   Winds  ", Strain: "Gelato", "Package Size": "1.00 Grams" }),
    // 6. master-less inventory row (no PRODUCTS match) with a brand
    inv({ Id: "5", Barcode: "BC-ORPH", Product: "Downtown flower toasted crunch 7g", Strain: "Toasted Crunch", Brand: "Downtown", "Package Size": "7.00 Grams" }),
    // 7. master-less inventory row with NO brand
    inv({ Id: "6", Barcode: "BC-ORPH2", Product: "Mystery Kush 2g", Strain: "Mystery Kush", Brand: "", "Package Size": "2.00 Grams" }),
  ]);
  return transformWorkbooks({ productsBuffer, inventoriesBuffer });
}

const RESULT = run();

function menuRow(description: string): MenuItemRow {
  return {
    id: "mi-1", menu_version_id: "v1", source_item_id: "LOT-1", name: "x", product_name: "x",
    brand_name: "b", vendor_name: "v", category: "flower", strain_type: "hybrid", description,
    price_minor_units: 3000, inventory_status: "in-stock",
  } as MenuItemRow;
}

describe("A. golden master: the real Cultivera transform writes the SAME placeholder as before", () => {
  it("the pipeline built every card (5 product groups + 2 master-less)", () => {
    expect(RESULT.items.length).toBe(7);
  });

  it("a described product keeps its own copy (never the placeholder)", () => {
    const described = RESULT.items.filter((i) => i.description === "Nice flower with a sweet berry finish.");
    expect(described).toHaveLength(1);
    expect(isBoilerplateDescription(described[0]!.description)).toBe(false);
  });

  it("every other card's description is byte-identical to the legacy inline template", () => {
    const placeholders = RESULT.items.filter((i) => i.description !== "Nice flower with a sweet berry finish.");
    expect(placeholders).toHaveLength(6);
    for (const i of placeholders) {
      expect(i.description, i.name).toBe(legacyGeneric(i.name, i.brand));
      expect(i.description, i.name).toBe(boilerplateDescription(i.name, i.brand));
    }
  });

  it("no brand anywhere -> the house brand, exactly as before ('from Greenway')", () => {
    const noBrand = RESULT.items.filter((i) => i.brand === "Greenway");
    expect(noBrand.length).toBe(2); // product row 3 + master-less row 7
    for (const i of noBrand) expect(i.description.endsWith(`from Greenway${BOILERPLATE_TAIL}`), i.name).toBe(true);
  });

  it("messy brand whitespace is normalised upstream, so the sentence has single spaces", () => {
    const fw = RESULT.items.find((i) => i.brand === "Fair Winds");
    expect(fw).toBeDefined();
    expect(fw!.description).toBe(legacyGeneric(fw!.name, "Fair Winds"));
    expect(fw!.description).not.toMatch(/ {2}/);
  });

  it("master-less inventory cards get the placeholder with their brand", () => {
    const orph = RESULT.items.find((i) => i.brand === "Downtown");
    expect(orph).toBeDefined();
    expect(orph!.description).toBe(`${orph!.name} from Downtown${BOILERPLATE_TAIL}`);
  });

  it("every card's brand is non-blank and trimmed, so boilerplateDescription's blank-brand branch can never fire here", () => {
    for (const i of RESULT.items) {
      expect(i.brand.trim(), i.name).toBe(i.brand);
      expect(i.brand.length, i.name).toBeGreaterThan(0);
    }
  });
});

describe("B. S23.5: the gap vector reads every transform placeholder as NOT described", () => {
  it("placeholders -> hasDescription false; the real copy -> true", () => {
    for (const i of RESULT.items) {
      const real = i.description === "Nice flower with a sweet berry finish.";
      const g = computeGaps(menuRow(i.description), null);
      expect(g.hasDescription, i.name).toBe(real);
      expect(isBoilerplateDescription(i.description), i.name).toBe(!real);
    }
  });
});

describe("C. source pins: one source for the placeholder sentence", () => {
  const src = read("src/lib/pos/transform.ts");
  it("transform.ts imports boilerplateDescription from golden-record-core", () => {
    expect(src).toContain('import { boilerplateDescription } from "@/lib/catalog/golden-record-core";');
  });
  it("genericDescription delegates and the fallback still uses it", () => {
    expect(src).toContain("function genericDescription(group: ProductGroup) { return boilerplateDescription(group.displayName, group.brand); }");
    expect(src).toContain("description: group.descriptions.sort((a, b) => b.length - a.length)[0] ?? genericDescription(group),");
  });
  it("no inline copy of the sentence is left in transform.ts", () => {
    expect(src).not.toContain("Browse current availability");
    expect(src).not.toContain("Greenway Marijuana in Port Orchard");
  });
});
