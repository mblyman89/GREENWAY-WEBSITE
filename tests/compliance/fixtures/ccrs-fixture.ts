/**
 * tests/compliance/fixtures/ccrs-fixture.ts
 *
 * Deterministic "seeded order" fixture for the CCRS golden-file tests (S-14).
 * One representative, hand-verified data set per retailer file type. The SAME
 * rows are used by scripts/compliance/generate-golden-ccrs.ts (which emits the
 * golden files) and tests/compliance/ccrs-batch.test.ts (which re-assembles
 * and byte-compares). Changing anything here invalidates the goldens ON
 * PURPOSE — regenerate them only after verifying the new output by hand.
 *
 * License number is the real Greenway retail license (413541) so the goldens
 * look exactly like a production upload.
 */
import type { CcrsRetailerFileType } from "@/lib/compliance/ccrs-batch-core";

export const FIXTURE_LICENSE = "413541";
export const FIXTURE_SUBMITTED_BY = "Greenway Marijuana";

/**
 * Fixed submission instant: 2025-06-15 20:00:00 UTC = 1:00 PM PDT June 15.
 * SubmittedDate must therefore render as 06/15/2025 (Pacific calendar day).
 */
export const FIXTURE_SUBMITTED_AT = new Date(Date.UTC(2025, 5, 15, 20, 0, 0));

/**
 * A UTC instant that is the NEXT calendar day in UTC but still June 15 in
 * Pacific (2025-06-16 04:30 UTC = June 15 9:30 PM PDT). Used to prove the
 * Pacific day-key behavior of ccrsDate().
 */
export const FIXTURE_LATE_EVENING_UTC = new Date(Date.UTC(2025, 5, 16, 4, 30, 0));

/** Data rows per file type — column order MUST match CCRS_COLUMNS exactly. */
export const FIXTURE_ROWS: Record<CcrsRetailerFileType, string[][]> = {
  Strain: [
    // LicenseNumber, Strain, StrainType, CreatedBy, CreatedDate
    [FIXTURE_LICENSE, "Blue Dream", "Hybrid", "Jane Budtender", "06/15/2025"],
    [FIXTURE_LICENSE, "Granddaddy Purple", "Indica", "Jane Budtender", "06/15/2025"],
  ],
  Area: [
    // LicenseNumber, Area, IsQuarantine, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
    [FIXTURE_LICENSE, "Sales Floor", "False", "AREA-1", "Jane Budtender", "06/15/2025", "", "", "Insert"],
    [FIXTURE_LICENSE, "Quarantine", "True", "AREA-2", "Jane Budtender", "06/15/2025", "", "", "Insert"],
  ],
  Product: [
    // LicenseNumber, InventoryCategory, InventoryType, Name, Description, UnitWeightGrams,
    // ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
    [
      FIXTURE_LICENSE,
      "EndProduct",
      "Usable Cannabis",
      "Blue Dream Flower 3.5g T25",
      "Blue Dream indoor flower, 3.5 g jar",
      "3.5",
      "PROD-1",
      "Jane Budtender",
      "06/15/2025",
      "",
      "",
      "Insert",
    ],
    [
      FIXTURE_LICENSE,
      "EndProduct",
      "Concentrate for Inhalation",
      "GDP Live Resin 1g T78",
      "Granddaddy Purple live resin, 1 g",
      "1",
      "PROD-2",
      "Jane Budtender",
      "06/15/2025",
      "",
      "",
      "Insert",
    ],
  ],
  Inventory: [
    // LicenseNumber, Strain, Area, Product, InitialQuantity, QuantityOnHand, TotalCost,
    // IsMedical, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
    [
      FIXTURE_LICENSE,
      "Blue Dream",
      "Sales Floor",
      "Blue Dream Flower 3.5g T25",
      "100",
      "98",
      "500.00",
      "False",
      "INV-1",
      "Jane Budtender",
      "06/15/2025",
      "",
      "",
      "Insert",
    ],
  ],
  InventoryAdjustment: [
    // LicenseNumber, InventoryExternalIdentifier, AdjustmentReason, AdjustmentDetail,
    // Quantity, AdjustmentDate, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
    [
      FIXTURE_LICENSE,
      "INV-1",
      "Destruction",
      "Moldy unit destroyed per SOP",
      "-1",
      "06/15/2025",
      "ADJ-1",
      "Jane Budtender",
      "06/15/2025",
      "",
      "",
      "Insert",
    ],
  ],
  InventoryTransfer: [
    // FromLicenseNumber, ToLicenseNumber, FromInventoryExternalIdentifier,
    // ToInventoryExternalIdentifier, Quantity, TransferDate, ExternalIdentifier,
    // CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
    [
      "421000",
      FIXTURE_LICENSE,
      "SUP-LOT-9",
      "INV-1",
      "100",
      "06/14/2025",
      "XFER-1",
      "Jane Budtender",
      "06/14/2025",
      "",
      "",
      "Insert",
    ],
  ],
  Sale: [
    // LicenseNumber, SoldToLicenseNumber, InventoryExternalIdentifier, PlantExternalIdentifier,
    // SaleType, SaleDate, Quantity, UnitPrice, Discount, RetailSalesTax, CannabisExciseTax,
    // SaleExternalIdentifier, SaleDetailExternalIdentifier, CreatedBy, CreatedDate,
    // UpdatedBy, UpdatedDate, Operation
    //
    // GW-010: all money below is PRE-TAX, derived from the tax-INCLUSIVE card
    // prices the way the (fixed) Sale.csv builder does it (tax-base-core.ts):
    //   row 1 — cannabis, card $34.18 × 2: UnitPrice = round(3418/1.463) =
    //           $23.36; base = round(6836/1.463) = 4673¢; SalesTax =
    //           round(4673×0.093) = $4.35; excise = round(4673×0.37) = $17.29.
    //   row 2 — medical, both taxes exempt (register charged the $23.36 base).
    //   row 3 — cannabis, regular $12.00 sold $10.50: UnitPrice $8.20,
    //           base = round(1050/1.463) = 718¢, Discount = 820−718 = $1.02,
    //           SalesTax $0.67, excise $2.66.
    [
      FIXTURE_LICENSE, "", "INV-1", "", "RecreationalRetail", "06/15/2025",
      "2", "23.36", "0.00", "4.35", "17.29",
      "ORD-1001", "ORD-1001-a1b2c3d4", "Jane Budtender", "06/15/2025", "", "", "Insert",
    ],
    [
      FIXTURE_LICENSE, "", "INV-1", "", "RecreationalMedical", "06/15/2025",
      "1", "23.36", "0.00", "0.00", "0.00",
      "ORD-1002", "ORD-1002-e5f6a7b8", "Jane Budtender", "06/15/2025", "", "", "Insert",
    ],
    // A name containing a comma exercises the quoting rule of ccrsCell.
    [
      FIXTURE_LICENSE, "", "INV-1", "", "RecreationalRetail", "06/15/2025",
      "1", "8.20", "1.02", "0.67", "2.66",
      "ORD-1003", "ORD-1003-c9d0e1f2", "Smith, Jane", "06/15/2025", "", "", "Insert",
    ],
  ],
};
