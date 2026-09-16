/**
 * tests/compliance/ccrs-batch.test.ts  (S-14 / GAP M-11)
 *
 * Golden-file + spec tests for the CCRS batch encoder (ccrs-batch-core).
 * The golden files under tests/compliance/golden/ccrs/ were generated from
 * the shared fixture by scripts/compliance/generate-golden-ccrs.ts and then
 * HAND-VERIFIED against the official LCB templates (docs/ccrs-templates/).
 * Any drift in column order, 3-row header, NumberRecords, quoting, CRLF
 * endings, or Pacific date formatting fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleCcrsFile,
  ccrsCell,
  ccrsDate,
  ccrsFileName,
  ccrsFileStamp,
  CCRS_COLUMNS,
  CCRS_UPLOAD_ORDER,
  CCRS_UPLOAD_GROUPS,
  normalizeStrainType,
  saleTypeForOrder,
  splitCsvLine,
  uploadGroupOf,
  validateProductClassification,
  verifyCcrsBatch,
  verifyCcrsFile,
  verifySaleNumericColumns,
  type CcrsRetailerFileType,
} from "@/lib/compliance/ccrs-batch-core";
import {
  FIXTURE_ROWS,
  FIXTURE_SUBMITTED_AT,
  FIXTURE_SUBMITTED_BY,
  FIXTURE_LICENSE,
  FIXTURE_LATE_EVENING_UTC,
} from "./fixtures/ccrs-fixture";

const goldenDir = join(__dirname, "golden", "ccrs");
const golden = (type: CcrsRetailerFileType) =>
  readFileSync(join(goldenDir, `${type}.golden.csv`), "utf8");
const templateDir = join(__dirname, "..", "..", "docs", "ccrs-templates");

describe("CCRS golden files — all 7 retailer file types", () => {
  for (const type of CCRS_UPLOAD_ORDER) {
    it(`${type}.csv is byte-identical to the hand-verified golden`, () => {
      const csv = assembleCcrsFile({
        type,
        submittedBy: FIXTURE_SUBMITTED_BY,
        submittedDate: FIXTURE_SUBMITTED_AT,
        rows: FIXTURE_ROWS[type],
      });
      expect(csv).toBe(golden(type));
    });

    it(`${type} golden passes the offline batch verifier`, () => {
      const result = verifyCcrsFile(type, golden(type));
      expect(result.filter((p) => p.severity === "error")).toEqual([]);
    });
  }

  it("the full 7-file batch passes verifyCcrsBatch", () => {
    const batch = CCRS_UPLOAD_ORDER.map((type) => ({ type, csv: golden(type) }));
    const report = verifyCcrsBatch(batch);
    expect(report.ok).toBe(true);
  });
});

describe("CCRS column headers match the official LCB templates (docs/ccrs-templates)", () => {
  // The template files are the authoritative artifacts downloaded from the LCB.
  const templateFile: Record<CcrsRetailerFileType, string> = {
    Strain: "Strain.csv",
    Area: "Area.csv",
    Product: "Product.csv",
    Inventory: "Inventory.csv",
    InventoryAdjustment: "InventoryAdjustment.csv",
    InventoryTransfer: "InventoryTransfer.csv",
    Sale: "Sales.csv", // LCB names the retail sale template "Sales.csv"
  };
  for (const type of CCRS_UPLOAD_ORDER) {
    it(`${type} columns equal row 4 of ${templateFile[type]}`, () => {
      const raw = readFileSync(join(templateDir, templateFile[type]), "utf8");
      const lines = raw.split("\r\n");
      const templateHeader = splitCsvLine(lines[3]);
      expect([...CCRS_COLUMNS[type]]).toEqual(templateHeader);
    });
  }
});

describe("CCRS header rows / NumberRecords", () => {
  it("NumberRecords equals the data-row count exactly", () => {
    const csv = assembleCcrsFile({
      type: "Strain",
      submittedBy: FIXTURE_SUBMITTED_BY,
      submittedDate: FIXTURE_SUBMITTED_AT,
      rows: FIXTURE_ROWS.Strain,
    });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(`SubmittedBy,${FIXTURE_SUBMITTED_BY}`);
    expect(lines[1]).toBe("SubmittedDate,06/15/2025");
    expect(lines[2]).toBe(`NumberRecords,${FIXTURE_ROWS.Strain.length}`);
  });

  it("a tampered NumberRecords is rejected by the verifier", () => {
    const tampered = golden("Strain").replace(
      /NumberRecords,\d+/,
      "NumberRecords,99",
    );
    const problems = verifyCcrsFile("Strain", tampered);
    expect(problems.some((p) => /NumberRecords/.test(p.message))).toBe(true);
  });

  it("bare-LF line endings are rejected", () => {
    const lf = golden("Strain").replace(/\r\n/g, "\n");
    const problems = verifyCcrsFile("Strain", lf);
    expect(problems.some((p) => /CRLF/.test(p.message))).toBe(true);
  });
});

describe("ccrsDate uses the PACIFIC calendar day", () => {
  it("a UTC instant on the next day still reports the Pacific day", () => {
    // 2025-06-16 04:30 UTC is June 15, 9:30 PM PDT.
    expect(ccrsDate(FIXTURE_LATE_EVENING_UTC)).toBe("06/15/2025");
  });
  it("a plain Pacific-afternoon instant formats as expected", () => {
    expect(ccrsDate(FIXTURE_SUBMITTED_AT)).toBe("06/15/2025");
  });
});

describe("ccrsCell quoting", () => {
  it("quotes cells containing commas and strips embedded quotes", () => {
    expect(ccrsCell("Smith, Jane")).toBe('"Smith, Jane"');
    expect(ccrsCell('He said "hi"')).toBe("He said hi");
    expect(ccrsCell(null)).toBe("");
  });
});

describe("file naming convention", () => {
  it("UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv", () => {
    const name = ccrsFileName("Sale", FIXTURE_LICENSE, FIXTURE_SUBMITTED_AT);
    // S-01: this assertion used to be `${ccrsFileStamp(FIXTURE_SUBMITTED_AT)}`,
    // i.e. the implementation compared against itself — it could not fail, and
    // it did not notice that the stamp was UTC while SubmittedDate was Pacific
    // (bible gap N-05). The stamp is now written out literally: 2025-06-15
    // 20:00 UTC is 1:00 PM Pacific  [FAQ L0075].
    expect(name).toBe("Sale_413541_20250615130000.csv");
    expect(ccrsFileStamp(FIXTURE_SUBMITTED_AT)).toBe("20250615130000");
    expect(name).toMatch(/^Sale_413541_\d{14}\.csv$/);
  });
});

describe("upload order of operations (Group 1 → 2 → 3)", () => {
  it("upload order covers all 7 types with Sale last", () => {
    expect(CCRS_UPLOAD_ORDER.length).toBe(7);
    expect(CCRS_UPLOAD_ORDER[CCRS_UPLOAD_ORDER.length - 1]).toBe("Sale");
    expect(CCRS_UPLOAD_GROUPS.flat()).toEqual([...CCRS_UPLOAD_ORDER]);
  });
  it("Strain/Area/Product precede Inventory, which precedes Sale", () => {
    expect(uploadGroupOf("Strain")).toBeLessThan(uploadGroupOf("Inventory"));
    expect(uploadGroupOf("Inventory")).toBeLessThan(uploadGroupOf("Sale"));
  });
});

describe("SaleType / StrainType enums", () => {
  it("medical orders → RecreationalMedical, others → RecreationalRetail", () => {
    expect(saleTypeForOrder(true)).toBe("RecreationalMedical");
    expect(saleTypeForOrder(false)).toBe("RecreationalRetail");
  });
  it("strain-type normalization collapses to the 3 CCRS values", () => {
    expect(normalizeStrainType("sativa").value).toBe("Sativa");
    expect(normalizeStrainType("indica-dominant").value).toBe("Indica");
    expect(normalizeStrainType("1:1 CBD").value).toBe("Hybrid");
    expect(normalizeStrainType("").defaulted).toBe(true);
  });
});

describe("product classification (Table 2)", () => {
  it("valid category/type pairs pass, invalid ones fail", () => {
    expect(
      validateProductClassification("EndProduct", "Usable Cannabis").ok,
    ).toBe(true);
    expect(
      validateProductClassification("EndProduct", "Flower Lot").ok,
    ).toBe(false);
    expect(validateProductClassification("Bogus", "Usable Cannabis").ok).toBe(false);
  });

  // SLICE 51: legacy 2021 Data Model vocabulary is accepted and canonicalized
  // to the current Table 2 enum (vendor manifests still arrive in both dialects).
  it("canonicalizes legacy 2021 LCB vocabulary to the modern enum", () => {
    const usable = validateProductClassification("EndProduct", "Usable Marijuana");
    expect(usable.ok).toBe(true);
    if (usable.ok) {
      expect(usable.type).toBe("Usable Cannabis");
      expect(usable.aliased).toBe(true);
    }
    const moved = validateProductClassification("IntermediateProduct", "Concentrate for Inhalation");
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.category).toBe("EndProduct");
    // Modern pairs stay verbatim and are never flagged as aliased.
    const modern = validateProductClassification("EndProduct", "Usable Cannabis");
    expect(modern.ok && !modern.aliased).toBe(true);
    // Aliasing never guesses: unknown values still fail.
    expect(validateProductClassification("EndProduct", "Vape Juice").ok).toBe(false);
  });
});

describe("Sale numeric-column safety (defense in depth)", () => {
  const okRow = FIXTURE_ROWS.Sale[0];
  it("a clean Sale row passes", () => {
    expect(verifySaleNumericColumns([okRow])).toEqual([]);
  });
  it("zero/negative/non-numeric quantity is flagged", () => {
    for (const bad of ["0", "-1", "abc", ""]) {
      const row = [...okRow];
      row[6] = bad;
      expect(verifySaleNumericColumns([row]).length).toBeGreaterThan(0);
    }
  });
  it("negative or 3-decimal money is flagged", () => {
    const neg = [...okRow];
    neg[7] = "-5.00";
    expect(verifySaleNumericColumns([neg]).some((p) => /UnitPrice/.test(p.message))).toBe(true);
    const dp3 = [...okRow];
    dp3[10] = "1.234";
    expect(verifySaleNumericColumns([dp3]).some((p) => /CannabisExciseTax/.test(p.message))).toBe(true);
  });
});

describe("CCRS Product.Name two-layer composition (SLICE 53)", () => {
  it("composes the owner-approved example and guards duplication/collisions", async () => {
    const { composeCcrsProductName, disambiguateCcrsName } = await import(
      "@/lib/compliance/ccrs-product-name-core"
    );
    // The approved two-layer example, verbatim.
    expect(
      composeCcrsProductName({
        name: "Space OG",
        vendor: "DOWNTOWN CANNABIS COMPANY",
        brand: "Downtown",
        posInventoryCategory: "Flower",
        category: "flower",
        unitWeightGrams: 1,
      }).name,
    ).toBe("Downtown Space OG Flower 1g");
    // Brand/type/dose duplication guards.
    const wana = composeCcrsProductName({
      name: "Wana Sour Gummies 100mg",
      vendor: "NORTHWEST CANNABIS SOLUTIONS",
      brand: "Wana",
      posInventoryCategory: "Gummies",
      category: "edible-solid",
      unitWeightGrams: 40,
    }).name;
    expect(wana).not.toMatch(/Wana Wana/i);
    expect(wana).toMatch(/100mg/);
    expect(wana).not.toMatch(/40g/);
    // Deterministic collision suffix keeps the Inventory→Product join unique.
    const used = new Set<string>();
    const first = disambiguateCcrsName("Downtown Comatoast Concentrate 1g", "GW-LOT-000123", used);
    const second = disambiguateCcrsName("Downtown Comatoast Concentrate 1g", "GW-LOT-000456", used);
    expect(first.disambiguated).toBe(false);
    expect(second.disambiguated).toBe(true);
    expect(second.name).toBe("Downtown Comatoast Concentrate 1g 000456");
  });

  it("__runCcrsProductNameCoreTests", async () => {
    const { __runCcrsProductNameCoreTests } = await import(
      "@/lib/compliance/ccrs-product-name-core"
    );
    expect(() => __runCcrsProductNameCoreTests()).not.toThrow();
  });
});

describe("embedded self-tests still pass under vitest", () => {
  it("__runCcrsBatchCoreTests", async () => {
    const { __runCcrsBatchCoreTests } = await import("@/lib/compliance/ccrs-batch-core");
    expect(() => __runCcrsBatchCoreTests()).not.toThrow();
  });
});
