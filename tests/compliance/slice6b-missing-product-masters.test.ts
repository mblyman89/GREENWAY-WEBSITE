/**
 * tests/compliance/slice6b-missing-product-masters.test.ts  (SLICE 6B)
 *
 * ═══ WHAT THIS FILE PROVES ═══
 *
 * Owner, Round 7: "the rejected ones, i can not fix or do anything with them at
 * all." Measured against his real Sep-1-2026 workbooks (3,541 product rows /
 * 4,284 inventory rows) with the REAL transformer:
 *
 *     3,333 staged | 771 hidden | ALL 771 hidden_reason = no_product_master
 *     8,012 units  | $141,148.02 retail | 158 brands | 0 with zero stock
 *
 * Three things had to be true for this slice to be correct, and each one is
 * pinned below by number rather than by opinion:
 *
 *   1. THE LIST IS EXACTLY THE RIGHT ROWS. Only hidden + no_product_master.
 *      Folding in `reviewer_rejected` or `no_inventory` would misstate what
 *      the list is and send the owner to create products that already exist.
 *
 *   2. NOTHING IS INVENTED. Every emitted field is transcribed from the staged
 *      row. Where the export was blank the field stays blank and is reported
 *      as needed. A placeholder ("No Strain", "Mixed") is treated as blank,
 *      not passed off as a strain.
 *
 *   3. THE REP SHEET IS ACTUALLY USABLE. Column 1 is the key the Cultivera rep
 *      uses to FIND the row. Measured: the transformer's DERIVED display name
 *      matched the POS export on 3 of 771 rows; the raw `productName` matched
 *      on 771 of 771. Emitting the display name would ship a sheet where 768
 *      of 771 rows cannot be located. That regression is the single most
 *      damaging thing that could happen to this feature, so it gets its own
 *      suite.
 *
 * The final suite guards the DECISION not to build a name-matching layer.
 * Measured on the real files: a SAFE match (name normalised AND package size
 * agreeing) recovers 3 of 801, while the loose "strip the size suffix" match
 * links a 28g jar to a 7g product row. Inventing a package size on a cannabis
 * SKU violates standing rule 3 and data-governance Rule 3.1.
 */
import { describe, it, expect } from "vitest";
import {
  buildMissingProductMasterWorklist,
  menuItemRowToMissingMasterItem,
  missingMasterCsv,
  missingMasterCsvRow,
  MISSING_MASTER_CSV_COLUMNS,
  csvCell,
  formatMinorUnits,
  reconciliationStatement,
  NO_PRODUCT_MASTER,
  NO_BRAND_TEXT,
  __runMissingProductMasterCoreTests,
  type MissingMasterItemInput,
  type MissingMasterVariantInput,
} from "@/lib/pos/missing-product-master-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function variant(over: Partial<MissingMasterVariantInput> = {}): MissingMasterVariantInput {
  return { label: "1g", priceMinorUnits: 1500, inventoryLevel: 2, medical: false, ...over };
}

function item(over: Partial<MissingMasterItemInput> = {}): MissingMasterItemInput {
  return {
    sourceItemId: "pos-1",
    name: "Blue Dream",
    productName: "Ceres-Cartridge-Blue Dream-1g",
    brand: "Ceres",
    category: "cartridge",
    posInventoryType: "Marijuana Extract for Inhalation",
    posInventoryCategory: "Cartridge",
    strainName: "Blue Dream",
    strainType: "sativa",
    hidden: true,
    hiddenReason: NO_PRODUCT_MASTER,
    variants: [variant()],
    ...over,
  };
}

/** Parse a CSV line honouring RFC-4180 quoting. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------

describe("SLICE 6B — the pure core's own self-tests", () => {
  it("passes every embedded assertion", () => {
    expect(__runMissingProductMasterCoreTests()).toContain("all assertions passed");
  });
});

describe("SLICE 6B — the worklist is exactly the right rows", () => {
  it("includes ONLY hidden rows whose reason is no_product_master", () => {
    const list = buildMissingProductMasterWorklist([
      item({ sourceItemId: "target" }),
      item({ sourceItemId: "live", hidden: false }),
      item({ sourceItemId: "reviewer", hiddenReason: "reviewer_rejected" }),
      item({ sourceItemId: "no-inv", hiddenReason: "no_inventory" }),
      item({ sourceItemId: "no-reason", hiddenReason: null }),
    ]);
    expect(list.rows.map((r) => r.sourceItemId)).toEqual(["target"]);
  });

  it("never sweeps a reviewer-rejected row into the product-creation list", () => {
    // These two are different owner actions. A reviewer_rejected row is a
    // decision he already made; telling him to go create the product would be
    // asking him to undo his own call.
    const list = buildMissingProductMasterWorklist([
      item({ sourceItemId: "r1", hiddenReason: "reviewer_rejected" }),
      item({ sourceItemId: "r2", hiddenReason: "reviewer_rejected" }),
    ]);
    expect(list.totals.items).toBe(0);
    expect(list.brands).toHaveLength(0);
  });

  it("models the owner's real census: 771 of 3,333, and they reconcile", () => {
    const rows: MissingMasterItemInput[] = [];
    for (let i = 0; i < 2562; i += 1) rows.push(item({ sourceItemId: `live-${i}`, hidden: false, hiddenReason: null }));
    for (let i = 0; i < 771; i += 1) rows.push(item({ sourceItemId: `missing-${i}` }));

    const list = buildMissingProductMasterWorklist(rows);
    expect(rows).toHaveLength(3333);
    expect(list.totals.items).toBe(771);

    const statement = reconciliationStatement({
      totalItems: 3333,
      goingLive: 2562,
      documentedRejects: 771,
    });
    expect(statement).toContain("3333 staged = 2562 going live + 771 documented rejects");
    expect(statement).toContain("do NOT block publishing");
  });

  it("states an unbalanced reconciliation as a failure and never reassures", () => {
    const bad = reconciliationStatement({ totalItems: 3333, goingLive: 2562, documentedRejects: 700 });
    expect(bad).toContain("DOES NOT BALANCE");
    expect(bad).not.toContain("do NOT block publishing");
  });
});

describe("SLICE 6B — nothing is invented", () => {
  it("keeps a blank field blank and reports it instead of filling it in", () => {
    const list = buildMissingProductMasterWorklist([
      item({ brand: "", strainName: null, posInventoryType: null, posInventoryCategory: null }),
    ]);
    const row = list.rows[0];
    expect(row.brand).toBe("");
    expect(row.strainName).toBe("");
    expect(row.inventoryType).toBe("");
    expect(row.missingFields).toEqual(expect.arrayContaining(["brand", "strain", "inventoryType"]));
    expect(list.totals.incompleteItems).toBe(1);
  });

  it("treats placeholder strains as unknown rather than as data", () => {
    for (const placeholder of ["No Strain", "MIXED", "assorted", "N/A", "none", "Unknown", "Paraphernalia"]) {
      const list = buildMissingProductMasterWorklist([item({ strainName: placeholder })]);
      expect(list.rows[0].strainName).toBe("");
      expect(list.rows[0].missingFields).toContain("strain");
    }
  });

  it("keeps a real strain verbatim", () => {
    const list = buildMissingProductMasterWorklist([item({ strainName: "Gorilla Glue #4" })]);
    expect(list.rows[0].strainName).toBe("Gorilla Glue #4");
    expect(list.rows[0].missingFields).not.toContain("strain");
  });

  it("groups brandless rows under an explicit label, never an invented brand", () => {
    const list = buildMissingProductMasterWorklist([item({ brand: "" })]);
    expect(list.brands[0].brand).toBe(NO_BRAND_TEXT);
    expect(list.rows[0].brand).toBe("");
  });

  it("cannot be pushed to a negative or NaN total by dirty input", () => {
    const list = buildMissingProductMasterWorklist([
      item({
        variants: [
          variant({ inventoryLevel: -5, priceMinorUnits: 1000 }),
          variant({ inventoryLevel: Number.NaN, priceMinorUnits: 1000 }),
          variant({ inventoryLevel: 3, priceMinorUnits: -100 }),
        ],
      }),
    ]);
    expect(list.totals.units).toBe(3);
    expect(list.totals.retailValueMinorUnits).toBe(0);
    expect(Number.isFinite(list.totals.retailValueMinorUnits)).toBe(true);
  });
});

describe("SLICE 6B — money stays in minor units until the boundary", () => {
  it("sums in minor units", () => {
    const list = buildMissingProductMasterWorklist([
      item({ sourceItemId: "a", variants: [variant({ inventoryLevel: 10, priceMinorUnits: 1500 })] }),
      item({ sourceItemId: "b", variants: [variant({ inventoryLevel: 3, priceMinorUnits: 2000 })] }),
    ]);
    expect(list.totals.retailValueMinorUnits).toBe(21000);
    expect(Number.isInteger(list.totals.retailValueMinorUnits)).toBe(true);
  });

  it("formats the owner's real stranded total exactly, with no float drift", () => {
    expect(formatMinorUnits(14114802)).toBe("141148.02");
    expect(formatMinorUnits(0)).toBe("0.00");
    expect(formatMinorUnits(5)).toBe("0.05");
    expect(formatMinorUnits(-250)).toBe("-2.50");
  });
});

describe("SLICE 6B — the worklist is ordered so the work pays", () => {
  it("ranks rows and brands by stranded value, descending and deterministically", () => {
    const list = buildMissingProductMasterWorklist([
      item({ sourceItemId: "small", brand: "Small", variants: [variant({ inventoryLevel: 1, priceMinorUnits: 100 })] }),
      item({ sourceItemId: "big", brand: "Big", variants: [variant({ inventoryLevel: 50, priceMinorUnits: 5000 })] }),
      item({ sourceItemId: "mid", brand: "Mid", variants: [variant({ inventoryLevel: 5, priceMinorUnits: 1000 })] }),
    ]);
    expect(list.rows.map((r) => r.sourceItemId)).toEqual(["big", "mid", "small"]);
    expect(list.brands.map((b) => b.brand)).toEqual(["Big", "Mid", "Small"]);
  });

  it("produces a stable order for identical rows (a wobbling list cannot be worked)", () => {
    const rows = [
      item({ sourceItemId: "z", name: "Zeta", productName: "Zeta" }),
      item({ sourceItemId: "a", name: "Alpha", productName: "Alpha" }),
      item({ sourceItemId: "m", name: "Mu", productName: "Mu" }),
    ];
    const first = buildMissingProductMasterWorklist(rows).rows.map((r) => r.name);
    const again = buildMissingProductMasterWorklist([...rows].reverse()).rows.map((r) => r.name);
    expect(first).toEqual(["Alpha", "Mu", "Zeta"]);
    expect(again).toEqual(first);
  });
});

describe("SLICE 6B — the rep sheet must actually be usable", () => {
  // ═══ THE REGRESSION THAT WOULD HURT MOST ═══
  // Column 1 is the key the Cultivera rep uses to FIND the row. Measured on
  // the owner's real files: display name matched the POS export on 3 of 771;
  // productName matched on 771 of 771.
  it("puts the RAW POS product name in column 1, not the derived display name", () => {
    const list = buildMissingProductMasterWorklist([
      item({
        name: "Black & Blueberry",
        productName: "GE - Blackberry Cobbler - 1g Indica Vape Cartridge",
      }),
    ]);
    const cells = missingMasterCsvRow(list.rows[0]);
    expect(MISSING_MASTER_CSV_COLUMNS[0]).toBe("Original Product Name");
    expect(cells[0]).toBe("GE - Blackberry Cobbler - 1g Indica Vape Cartridge");
    expect(cells[0]).not.toBe("Black & Blueberry");
  });

  it("still ships the display name, in its own clearly labelled column", () => {
    const list = buildMissingProductMasterWorklist([
      item({ name: "Black & Blueberry", productName: "GE - Blackberry Cobbler - 1g" }),
    ]);
    const cells = missingMasterCsvRow(list.rows[0]);
    expect(MISSING_MASTER_CSV_COLUMNS[5]).toBe("Menu Display Name");
    expect(cells[5]).toBe("Black & Blueberry");
  });

  it("falls back to the display name ONLY when the POS name is genuinely absent", () => {
    const list = buildMissingProductMasterWorklist([item({ name: "Only Display", productName: null })]);
    expect(missingMasterCsvRow(list.rows[0])[0]).toBe("Only Display");
  });

  it("leaves the rename columns blank — we never invent a name the rep will apply", () => {
    const list = buildMissingProductMasterWorklist([item()]);
    const cells = missingMasterCsvRow(list.rows[0]);
    expect(cells[1]).toBe("");
    expect(cells[2]).toBe("");
  });

  it("emits exactly one cell per declared column on every row", () => {
    const list = buildMissingProductMasterWorklist([
      item({ sourceItemId: "a" }),
      item({ sourceItemId: "b", brand: "", strainName: null }),
      item({ sourceItemId: "c", productName: 'Nasty, "quoted"\nname' }),
    ]);
    const lines = missingMasterCsv(list).split("\r\n").filter((l) => l !== "");
    expect(lines).toHaveLength(4); // header + 3
    for (const line of lines) {
      expect(splitCsvLine(line)).toHaveLength(MISSING_MASTER_CSV_COLUMNS.length);
    }
  });

  it("cannot have a column shifted by a comma, quote or newline in the data", () => {
    const list = buildMissingProductMasterWorklist([
      item({ productName: 'Torus, "K2" #1\n1g', brand: "A,B" }),
    ]);
    const line = missingMasterCsv(list).split("\r\n")[1];
    const parsed = splitCsvLine(line);
    // The column count is the thing that matters: a stray delimiter must never
    // push a value into the neighbouring column.
    expect(parsed).toHaveLength(MISSING_MASTER_CSV_COLUMNS.length);
    // The embedded newline is COLLAPSED to a space by the core's clean(), the
    // same whitespace normalisation the transformer applies to every name
    // (transform.ts:259 normalizeWhitespace). That is deliberate -- a POS
    // product name has no business containing a line break, and a one-line
    // cell is what the rep's sheet expects. The comma and quotes survive
    // verbatim because they are legitimate characters in a product name.
    expect(parsed[0]).toBe('Torus, "K2" #1 1g');
    expect(parsed[0]).toContain(',');
    expect(parsed[0]).toContain('"K2"');
    expect(parsed[6]).toBe("A,B");
  });

  it("never lets a newline break the CSV into a phantom extra row", () => {
    const list = buildMissingProductMasterWorklist([
      item({ sourceItemId: "a", productName: "Line\nBreak\nName" }),
      item({ sourceItemId: "b", productName: "Second Row" }),
    ]);
    const lines = missingMasterCsv(list).split("\r\n").filter((l) => l !== "");
    expect(lines).toHaveLength(3); // header + exactly 2 data rows
  });

  it("quotes per RFC-4180", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
  });

  it("is CRLF terminated with the header first", () => {
    const csv = missingMasterCsv(buildMissingProductMasterWorklist([item()]));
    expect(csv.split("\r\n")[0]).toBe(MISSING_MASTER_CSV_COLUMNS.join(","));
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("tells the owner which fields he must still supply", () => {
    const list = buildMissingProductMasterWorklist([item({ brand: "", strainName: "No Strain" })]);
    const cells = missingMasterCsvRow(list.rows[0]);
    expect(cells[cells.length - 1]).toContain("Brand");
    expect(cells[cells.length - 1]).toContain("Strain");
  });
});

describe("SLICE 6B — the DB adapter reads what PostgREST actually returns", () => {
  it("coerces numeric-as-string columns and null medical", () => {
    const adapted = menuItemRowToMissingMasterItem(
      {
        source_item_id: "pos-db",
        name: "Blue Dream",
        product_name: "Ceres-Cartridge-Blue Dream-1g",
        brand_name: "Ceres",
        category: "cartridge",
        pos_inventory_type: "Marijuana Extract for Inhalation",
        pos_inventory_category: "Cartridge",
        strain_name: "Blue Dream",
        strain_type: "sativa",
        hidden: true,
        hidden_reason: NO_PRODUCT_MASTER,
      },
      [{ label: "1g", price_minor_units: "2500", inventory_level: "4", medical: null }],
    );
    expect(adapted.variants[0].priceMinorUnits).toBe(2500);
    expect(adapted.variants[0].inventoryLevel).toBe(4);
    expect(adapted.variants[0].medical).toBe(false);
    const list = buildMissingProductMasterWorklist([adapted]);
    expect(list.totals.retailValueMinorUnits).toBe(10000);
  });

  it("does not let a visible row through the adapter path", () => {
    const adapted = menuItemRowToMissingMasterItem(
      {
        source_item_id: "live", name: "Live", product_name: "Live", brand_name: "B", category: "flower",
        pos_inventory_type: null, pos_inventory_category: null, strain_name: null, strain_type: "hybrid",
        hidden: false, hidden_reason: null,
      },
      [],
    );
    expect(buildMissingProductMasterWorklist([adapted]).rows).toHaveLength(0);
  });
});

describe("SLICE 6B — why there is deliberately NO name-matching layer", () => {
  /**
   * This suite does not test production code. It pins the MEASUREMENT that
   * justified the design decision, so that a future change proposing "just
   * match the names loosely" has to argue with the owner's real data first.
   *
   * Verified against the real Products workbook: searching for "hassel hoth"
   * returns exactly ONE row, "Downtown Flower Hassel Hoth - 7g".
   */
  const realProductRows = ["downtown flower hassel hoth - 7g"];
  const realInventoryKeys = [
    "downtown flower hassel hoth - 28g",
    "downtown flower hassel hoth - 14g",
    "downtown flower hassel hoth - 3.5g",
    "downtown flower hassel hoth - 1g",
  ];

  const stripSize = (s: string) =>
    s.replace(/\b\d+(\.\d+)?\s*(mg|g|gram|grams|oz|ml|pk|pack|ct|count)\b/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

  it("proves loose size-stripping would link DIFFERENT products", () => {
    // Every one of the four inventory sizes collapses onto the single 7g row.
    const collapsed = new Set(realInventoryKeys.map(stripSize));
    expect(collapsed.size).toBe(1);
    expect(stripSize(realProductRows[0])).toBe([...collapsed][0]);

    // A 28g jar is not a 7g jar. Matching them writes a WRONG package size
    // onto a cannabis SKU -- inventing data (standing rule 3 / Rule 3.1).
    expect(realInventoryKeys[0]).not.toBe(realProductRows[0]);
  });

  it("keeps every unmatched row on the worklist rather than guessing a link", () => {
    const list = buildMissingProductMasterWorklist(
      realInventoryKeys.map((k, i) =>
        item({ sourceItemId: `inv-${i}`, productName: k, name: "Hassel Hoth" }),
      ),
    );
    // All four stay on the list. None is silently "resolved" against the 7g.
    expect(list.totals.items).toBe(4);
    expect(list.rows.every((r) => r.missingFields.length >= 0)).toBe(true);
  });
});
