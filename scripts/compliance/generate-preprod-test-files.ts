/**
 * scripts/compliance/generate-preprod-test-files.ts
 *
 * Generates the PREproduction test files defined in
 * docs/ccrs-bible/06-preproduction-test-plan.md so the owner can start testing
 * the upload process TODAY — no database, no published menu, no PREprod login
 * needed to produce them.
 *
 * WHY THIS EXISTS
 * Part 06 is a 40-row test plan, but every row said "a file the app emits",
 * and the only way to emit one was to run the whole batch builder against live
 * Supabase data for a real week. That made the plan un-runnable until every
 * other slice shipped. These files are built from the SAME pure core the
 * production batch uses (assembleCcrsFile / ccrsFileName / CCRS_COLUMNS in
 * ccrs-batch-core.ts), so what you upload is byte-shaped exactly like a real
 * upload — only the row data is a small, deliberate fixture.
 *
 * SAFETY
 *   • PREPRODUCTION ONLY. "These environments are autonomous and do not share
 *     administration or reporting data." [FAQ L0096] Nothing here touches the
 *     real record. Do NOT upload these to cannabisreporting.lcb.wa.gov.
 *   • Several files are INTENTIONALLY INVALID — that is their purpose: they
 *     make CCRS tell us, in its own words, what each error message looks like
 *     so the triage rules in the hub can be written from fact, not guesswork.
 *     Every such file is named `...EXPECT-ERROR...` and listed in the manifest.
 *
 * USAGE
 *   npx tsx scripts/compliance/generate-preprod-test-files.ts            # license 413541
 *   npx tsx scripts/compliance/generate-preprod-test-files.ts 123456     # another license
 *   npx tsx scripts/compliance/generate-preprod-test-files.ts 413541 ./out
 *
 * Output: one .csv per test id, plus MANIFEST.md — the upload order, the wait
 * between groups, what each file is for, and the exact result to record.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleCcrsFile,
  ccrsFileName,
  verifyCcrsFile,
  CCRS_COLUMNS,
  type CcrsRetailerFileType,
} from "../../src/lib/compliance/ccrs-batch-core";
import { padHeaderRowsForTemplates } from "../../src/lib/compliance/ccrs-batch-core";

const LICENSE = process.argv[2] ?? "413541";
const OUT = process.argv[3] ?? join(process.cwd(), "preprod-test-files");
const SUBMITTED_BY = "Greenway Marijuana";

/**
 * One fixed instant so every file in a run carries the same stamp and the set
 * is reproducible. Chosen deliberately in the EVENING Pacific so the stamp
 * proves the Pacific-vs-UTC fix from S-01: 2025-06-15 21:30 PDT is already
 * 2025-06-16 in UTC. The stamp must read 20250615..., not 20250616...
 */
const NOW = new Date(Date.UTC(2025, 5, 16, 4, 30, 0));
const TODAY = "06/15/2025";

type TestFile = {
  id: string;
  type: CcrsRetailerFileType;
  group: 1 | 2 | 3;
  purpose: string;
  expect: "no error" | "ERROR";
  /** The verbatim guide/FAQ pin this test is probing. */
  pin: string;
  rows: string[][];
  /** Override the generated file name (for the case/stamp probes). */
  fileNameOverride?: string;
  /** Emit the template-style comma padding instead of the bare header. */
  padHeaders?: boolean;
  /** Deliberately corrupt NumberRecords to probe the count rule. */
  breakNumberRecords?: boolean;
};

const strainRow = (name: string, type = "Hybrid") => [LICENSE, name, type, SUBMITTED_BY, TODAY];

const productRow = (o: {
  ext: string;
  name: string;
  type?: string;
  category?: string;
  description?: string;
  grams?: string;
}) => [
  LICENSE,
  o.category ?? "EndProduct",
  o.type ?? "Usable Cannabis",
  o.name,
  o.description ?? "Test product for PREproduction validation.",
  o.grams ?? "3.5",
  o.ext,
  SUBMITTED_BY,
  TODAY,
  "",
  "",
  "Insert",
];

const inventoryRow = (o: {
  ext: string;
  product: string;
  strain: string;
  initial: string;
  onHand: string;
  cost: string;
  area?: string;
  isMedical?: string;
  operation?: string;
}) => [
  LICENSE,
  o.strain,
  o.area ?? "Sales Floor",
  o.product,
  o.initial,
  o.onHand,
  o.cost,
  o.isMedical ?? "False",
  o.ext,
  SUBMITTED_BY,
  TODAY,
  "",
  "",
  o.operation ?? "Insert",
];

/**
 * Sale row in the EXACT CCRS_COLUMNS.Sale order (18 columns):
 * LicenseNumber, SoldToLicenseNumber, InventoryExternalIdentifier,
 * PlantExternalIdentifier, SaleType, SaleDate, Quantity, UnitPrice, Discount,
 * RetailSalesTax, CannabisExciseTax, SaleExternalIdentifier,
 * SaleDetailExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy,
 * UpdatedDate, Operation.
 *
 * Defaults are the LCB's own worked example [FAQ L0155-L0160]:
 * QTY 3 x $5.00 - $3.00 discount = $12.00 base; 10% sales tax = $1.20;
 * 37% excise = $4.44.
 */
const saleRow = (o: {
  sale: string;
  detail: string;
  excise: string;
  inventoryExt?: string;
  saleType?: string;
  qty?: string;
  unitPrice?: string;
  discount?: string;
  salesTax?: string;
}) => [
  LICENSE,
  "", // SoldToLicenseNumber — blank for a retail sale to the public
  o.inventoryExt ?? "GWINV30A",
  "", // PlantExternalIdentifier
  o.saleType ?? "RecreationalRetail",
  TODAY,
  o.qty ?? "3",
  o.unitPrice ?? "5.00",
  o.discount ?? "3.00",
  o.salesTax ?? "1.20",
  o.excise,
  o.sale,
  o.detail,
  SUBMITTED_BY,
  TODAY,
  "",
  "",
  "Insert",
];

const TESTS: TestFile[] = [
  // ---------------- Group 1: Strain / Area / Product ----------------
  {
    id: "T-10",
    type: "Strain",
    group: 1,
    purpose:
      "Baseline Strain file exactly as the app emits today (bare header rows, CRLF, Pacific stamp).",
    expect: "no error",
    pin: "[G L0209-L0253]",
    rows: [strainRow("Blue Dream"), strainRow("Granddaddy Purple", "Indica")],
  },
  {
    id: "T-11",
    type: "Strain",
    group: 1,
    purpose:
      "Identical content, but the 3 header rows are comma-padded to the column count like the official templates. Settles U-03: is padding required, optional, or rejected?",
    expect: "no error",
    pin: "[TPL * R1-R3]",
    rows: [strainRow("Blue Dream"), strainRow("Granddaddy Purple", "Indica")],
    padHeaders: true,
  },
  {
    id: "T-12",
    type: "Strain",
    group: 1,
    purpose:
      "Filename prefix case probe: lower-case 'strain_' instead of 'Strain_'. Settles U-02 (is the prefix case-sensitive?).",
    expect: "no error",
    pin: "[G L0046]",
    rows: [strainRow("Blue Dream")],
    fileNameOverride: `strain_${LICENSE}_20250615213000.csv`,
  },
  {
    id: "T-14-EXPECT-ERROR",
    type: "Strain",
    group: 1,
    purpose:
      "Strain literally named 'Unknown'. Capture the EXACT error text so the hub triage rule for E11 is written from CCRS's own words.",
    expect: "ERROR",
    pin: "[G L0358]",
    rows: [strainRow("Unknown")],
  },
  {
    id: "T-16",
    type: "Area",
    group: 1,
    purpose: "Area file with a single Sales Floor / False row (the retailer baseline).",
    expect: "no error",
    pin: "[G L0298-L0299]",
    rows: [[LICENSE, "Sales Floor", "False", "AREA-1", SUBMITTED_BY, TODAY, "", "", "Insert"]],
  },
  {
    id: "T-17",
    type: "Area",
    group: 1,
    purpose:
      "Area file including Quarantine / True — what the app emits today. Feeds the N-01 / U-04 question of whether a retailer should ever report TRUE.",
    expect: "no error",
    pin: "[G L0258-L0259]",
    rows: [
      [LICENSE, "Sales Floor", "False", "AREA-1", SUBMITTED_BY, TODAY, "", "", "Insert"],
      [LICENSE, "Quarantine", "True", "AREA-2", SUBMITTED_BY, TODAY, "", "", "Insert"],
    ],
  },
  {
    id: "T-18-EXPECT-ERROR",
    type: "Product",
    group: 1,
    purpose:
      "Usable Cannabis product with UnitWeightGrams = 0. Confirms the E9 rule and captures the exact message.",
    expect: "ERROR",
    pin: "[G L0434]",
    rows: [productRow({ ext: "GWTEST18", name: "PREprod Weight Zero 1g", grams: "0" })],
  },
  {
    id: "T-19-EXPECT-ERROR",
    type: "Product",
    group: 1,
    purpose:
      "Usable Cannabis product with an empty Description. Confirms the E10 rule (the guide states it only as a Note, never as an error message — this is the only way to know).",
    expect: "ERROR",
    pin: "[G L0482-L0483]",
    rows: [productRow({ ext: "GWTEST19", name: "PREprod No Description 3.5g", description: "" })],
  },
  {
    id: "T-20",
    type: "Product",
    group: 1,
    purpose:
      "Well-formed Product set: the two strains above plus a non-gated type (Concentrate) with weight 0, which the guide says is allowed.",
    expect: "no error",
    pin: "[G L0490]",
    rows: [
      productRow({ ext: "GWTEST01", name: "Blue Dream Flower 3.5g" }),
      productRow({ ext: "GWTEST02", name: "Granddaddy Purple Flower 3.5g" }),
      productRow({
        ext: "GWTEST03",
        name: "PREprod Test Concentrate 1g",
        // Table 2 value — "Concentrate" alone is NOT a CCRS type.
        type: "Concentrate for Inhalation",
        category: "EndProduct",
        grams: "0",
      }),
    ],
  },
  {
    id: "T-21",
    type: "Product",
    group: 1,
    purpose:
      "Hyphenated ExternalIdentifier (GW-TEST-21). Settles U-06: does CCRS accept hyphens in an external id?",
    expect: "no error",
    pin: "[G L0470]",
    rows: [productRow({ ext: "GW-TEST-21", name: "PREprod Hyphen Id 3.5g" })],
  },
  // ---------------- Group 2: Inventory ----------------
  {
    id: "T-30",
    type: "Inventory",
    group: 2,
    purpose: "Baseline Inventory: every row has TotalCost > 0 and QuantityOnHand <= InitialQuantity.",
    expect: "no error",
    pin: "[G L0614]",
    rows: [
      inventoryRow({
        ext: "GWINV30A",
        product: "Blue Dream Flower 3.5g",
        strain: "Blue Dream",
        initial: "100",
        onHand: "98",
        cost: "500.00",
      }),
      inventoryRow({
        ext: "GWINV30B",
        product: "Granddaddy Purple Flower 3.5g",
        strain: "Granddaddy Purple",
        initial: "50",
        onHand: "50",
        cost: "250.00",
      }),
    ],
  },
  {
    id: "T-31-EXPECT-ERROR",
    type: "Inventory",
    group: 2,
    purpose: "One row with TotalCost = 0.00. Confirms E7 and captures the exact wording.",
    expect: "ERROR",
    pin: "[G L0614]",
    rows: [
      inventoryRow({
        ext: "GWINV31",
        product: "Blue Dream Flower 3.5g",
        strain: "Blue Dream",
        initial: "10",
        onHand: "10",
        cost: "0.00",
      }),
    ],
  },
  {
    id: "T-31B",
    type: "Inventory",
    group: 2,
    purpose:
      "Trade-sample encoding: TotalCost exactly 0.01 with 'Trade Sample' in the product name, per the FAQ. Proves the sample path the app now emits is accepted.",
    expect: "no error",
    pin: "[FAQ L0035]",
    rows: [
      inventoryRow({
        ext: "GWINV31B",
        product: "Blue Dream Flower 3.5g",
        strain: "Blue Dream",
        initial: "1",
        onHand: "1",
        cost: "0.01",
      }),
    ],
  },
  {
    id: "T-32-EXPECT-ERROR",
    type: "Inventory",
    group: 2,
    purpose:
      "QuantityOnHand (12) greater than InitialQuantity (10). Confirms E8; note the LCB's own misspelling 'QuanityOnHand' in the reply.",
    expect: "ERROR",
    pin: "[G L0597]",
    rows: [
      inventoryRow({
        ext: "GWINV32",
        product: "Blue Dream Flower 3.5g",
        strain: "Blue Dream",
        initial: "10",
        onHand: "12",
        cost: "50.00",
      }),
    ],
  },
  {
    id: "T-33",
    type: "Inventory",
    group: 2,
    purpose:
      "Re-upload of T-30, byte-identical, as Insert again. Decides N-03/U-05: does CCRS duplicate, ignore, or error?",
    expect: "no error",
    pin: "[FAQ L0052-L0053]",
    rows: [
      inventoryRow({
        ext: "GWINV30A",
        product: "Blue Dream Flower 3.5g",
        strain: "Blue Dream",
        initial: "100",
        onHand: "98",
        cost: "500.00",
      }),
    ],
  },
  {
    id: "T-34",
    type: "Inventory",
    group: 2,
    purpose:
      "Same identifier as T-30 but Operation=Update with a changed QuantityOnHand. Confirms the weekly update path.",
    expect: "no error",
    pin: "[FAQ L0052-L0053]",
    rows: [
      (() => {
        const r = inventoryRow({
          ext: "GWINV30A",
          product: "Blue Dream Flower 3.5g",
          strain: "Blue Dream",
          initial: "100",
          onHand: "90",
          cost: "500.00",
          operation: "Update",
        });
        r[11] = SUBMITTED_BY; // UpdatedBy
        r[12] = TODAY; // UpdatedDate
        return r;
      })(),
    ],
  },
  {
    id: "T-35-EXPECT-ERROR",
    type: "Inventory",
    group: 2,
    purpose:
      "Update for an identifier that was never inserted. The FAQ says an error is returned — capture it.",
    expect: "ERROR",
    pin: "[FAQ L0053]",
    rows: [
      (() => {
        const r = inventoryRow({
          ext: "GWNEVERINSERTED",
          product: "Blue Dream Flower 3.5g",
          strain: "Blue Dream",
          initial: "5",
          onHand: "5",
          cost: "25.00",
          operation: "Update",
        });
        r[11] = SUBMITTED_BY;
        r[12] = TODAY;
        return r;
      })(),
    ],
  },
  {
    id: "T-37-EXPECT-ERROR",
    type: "Inventory",
    group: 2,
    purpose:
      "Product name differing only by case/spacing from the Product file ('blue dream flower 3.5g'). Proves whether the Inventory→Product join is exact-match.",
    expect: "ERROR",
    pin: "[G L0579-L0583]",
    rows: [
      inventoryRow({
        ext: "GWINV37",
        product: "blue  dream flower 3.5g",
        strain: "Blue Dream",
        initial: "10",
        onHand: "10",
        cost: "50.00",
      }),
    ],
  },
  {
    id: "T-54-EXPECT-ERROR",
    type: "Inventory",
    group: 2,
    purpose:
      "NumberRecords deliberately one LESS than the data rows. Confirms the file is refused and captures the message.",
    expect: "ERROR",
    pin: "[G L0204-L0205]",
    rows: [
      inventoryRow({
        ext: "GWINV54A",
        product: "Blue Dream Flower 3.5g",
        strain: "Blue Dream",
        initial: "10",
        onHand: "10",
        cost: "50.00",
      }),
      inventoryRow({
        ext: "GWINV54B",
        product: "Blue Dream Flower 3.5g",
        strain: "Blue Dream",
        initial: "10",
        onHand: "10",
        cost: "50.00",
      }),
    ],
    breakNumberRecords: true,
  },
  // ---------------- Group 3: Sale / Adjustment ----------------
  {
    id: "T-40",
    type: "Sale",
    group: 3,
    purpose:
      "Sale using the LCB's OWN worked example verbatim: QTY 3, Unit Price $5.00, Discount $3.00, Sales Tax $1.20, Other Tax (37%) $4.44.",
    expect: "no error",
    pin: "[FAQ L0155-L0160]",
    rows: [saleRow({ sale: "GWSALE40", detail: "GWSALE40-1", excise: "4.44" })],
  },
  {
    id: "T-42-EXPECT-ERROR",
    type: "Sale",
    group: 3,
    purpose:
      "Recreational sale reporting CannabisExciseTax = 0.00. Expect 'Only Medical Sales can be 0' — confirms E12/W-rule text.",
    expect: "ERROR",
    pin: "[G L1378]",
    rows: [saleRow({ sale: "GWSALE42", detail: "GWSALE42-1", excise: "0.00" })],
  },
  {
    id: "T-48-EXPECT-ERROR",
    type: "InventoryAdjustment",
    group: 3,
    purpose:
      "InventoryAdjustment with reason 'Other' and an EMPTY AdjustmentDetail. Confirms E13 and captures the wording.",
    expect: "ERROR",
    pin: "[G L1111]",
    rows: [
      [
        LICENSE,
        "GWINV30A",
        "Other",
        "",
        "1",
        TODAY,
        "GWADJ48",
        SUBMITTED_BY,
        TODAY,
        SUBMITTED_BY,
        TODAY,
        "Insert",
      ],
    ],
  },
  {
    id: "T-49",
    type: "InventoryAdjustment",
    group: 3,
    purpose:
      "Well-formed adjustments: Destruction and Reconciliation with positive quantities, plus an 'Other' WITH a detail.",
    expect: "no error",
    pin: "[G L1111]",
    rows: [
      [
        LICENSE,
        "GWINV30A",
        "Destruction",
        "Expired product destroyed per WAC 314-55-097.",
        "1",
        TODAY,
        "GWADJ49A",
        SUBMITTED_BY,
        TODAY,
        SUBMITTED_BY,
        TODAY,
        "Insert",
      ],
      [
        LICENSE,
        "GWINV30B",
        "Reconciliation",
        "Cycle count variance.",
        "2",
        TODAY,
        "GWADJ49B",
        SUBMITTED_BY,
        TODAY,
        SUBMITTED_BY,
        TODAY,
        "Insert",
      ],
      [
        LICENSE,
        "GWINV30A",
        "Other",
        "Trade sample provided to employee per WAC 314-55-096.",
        "1",
        TODAY,
        "GWADJ49C",
        SUBMITTED_BY,
        TODAY,
        SUBMITTED_BY,
        TODAY,
        "Insert",
      ],
    ],
  },
];

function build(t: TestFile): { fileName: string; csv: string } {
  let csv = assembleCcrsFile({
    type: t.type,
    submittedBy: SUBMITTED_BY,
    submittedDate: NOW,
    rows: t.rows,
  });
  if (t.padHeaders) csv = padHeaderRowsForTemplates(t.type, csv);
  if (t.breakNumberRecords) {
    // Deliberately desync NumberRecords from the row count (T-54 only).
    csv = csv.replace(
      `NumberRecords,${t.rows.length}`,
      `NumberRecords,${t.rows.length - 1}`,
    );
  }
  const fileName = t.fileNameOverride ?? ccrsFileName(t.type, LICENSE, NOW);
  return { fileName, csv };
}

function main(): void {
  mkdirSync(OUT, { recursive: true });

  const lines: string[] = [];
  lines.push("# PREproduction test files — generated\n");
  lines.push(
    `License **${LICENSE}** · stamp fixed at **20250615213000** (9:30 PM Pacific on 2025-06-15, which is already 2025-06-16 in UTC — the stamp proves the Pacific naming rule from [FAQ L0075]).\n`,
  );
  lines.push(
    "> **PREPRODUCTION ONLY.** `https://precannabisreporting.lcb.wa.gov`\n> \"These environments are autonomous and do not share administration or reporting data.\" [FAQ L0096]\n> Do **not** upload these to the production site. Files marked **EXPECT-ERROR** are invalid on purpose.\n",
  );
  lines.push("## How to run\n");
  lines.push(
    "**Upload each CSV exactly as named. Do not rename it.** CCRS reads the file name " +
      "(`<type>_<license>_<stamp>.csv` `[G L0046]`), so a renamed file can be rejected for the " +
      "wrong reason and the test teaches us nothing. Each test therefore sits in its own folder " +
      "and the CSV inside already has the correct name.\n\n" +
      "### The 10-minute wait is BETWEEN GROUPS, not between files\n\n" +
      "The only timing rule in the whole guide is that Inventory's prerequisites (Strain, Area, " +
      "Product) must be \"submitted prior to this submission by at least 10 minutes\" `[G L0530]`. " +
      "Nothing requires a gap between two files in the same group. CCRS's Browse dialog even " +
      "lets you \"select one or multiple files to be uploaded\" `[G L0166]`.\n\n" +
      "### But for THIS test set, upload one file at a time anyway\n\n" +
      "These are diagnostic probes, not a normal weekly filing, and that changes the advice:\n\n" +
      "- **Many of them share the same file name.** Nine Inventory probes are all called " +
      "`Inventory_413541_20250615213000.csv`. You cannot multi-select two files with the same " +
      "name, and uploading them back to back means an error email is ambiguous about which " +
      "one it came from.\n" +
      "- **Several deliberately overlap.** T-10, T-11 and T-12 contain the *same strains* on " +
      "purpose \u2014 they differ only in header padding and filename case. Sent together, the " +
      "second and third would be duplicates of the first and the padding/case question " +
      "(U-03 / U-02) would go unanswered.\n" +
      "- **Ten files are invalid on purpose.** If a batch throws an error, you will not know " +
      "which file caused it.\n\n" +
      "So: **one file, one upload, note the time.** The ten-minute wait still applies only " +
      "when moving from one group to the next \u2014 not between files inside a group.\n\n" +
      "1. Upload the **Group 1** files, one at a time, in the order listed. When the last one " +
      "is done, **wait at least 10 minutes.** `[G L0530]`\n2. Upload **Group 2** the same way, one at a time. Wait at least ten minutes again.\n3. Upload **Group 3** the same way.\n4. There is **no success email** for these seven files — only errors are emailed, and only to the person who uploaded. `[G L0051]` `[FAQ L0102]` So *absence of an error email after the wait* is the pass signal. Record the wait you actually used.\n5. For every file, fill in the row below. **Paste error emails whole — never summarise them.**\n6. Files marked **EXPECT-ERROR** are invalid on purpose. An error email for one of those is a **success** — paste the wording in, it becomes a triage rule.\n",
  );
  lines.push("## Files, in upload order\n");
  lines.push(
    "| Order | Test | File | Group | Expect | Probes | Result (fill in) | Error text (paste verbatim) |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");

  const ordered = [...TESTS].sort((a, b) => a.group - b.group);
  let n = 0;
  for (const t of ordered) {
    const { fileName, csv } = build(t);

    // Each test gets its OWN FOLDER, and the CSV inside keeps the exact name
    // CCRS requires: <type>_<license>_<stamp>.csv [G L0046].
    //
    // Do not be tempted to flatten this by prefixing the test id onto the file
    // name ("T-10__Strain_413541_....csv"). CCRS parses the file name, so a
    // prefixed file can be rejected for having the wrong name -- which is the
    // worst possible outcome for a test run: every probe fails for a reason we
    // invented, and we learn nothing about the rule we were actually testing.
    // Folders also let T-10 and T-11 (deliberately the same file name, one
    // padded and one not) coexist without a collision.
    const outDir = join(OUT, t.id);
    mkdirSync(outDir, { recursive: true });
    const outName = join(t.id, fileName);
    writeFileSync(join(outDir, fileName), csv, "utf8");

    // Self-check: a file we expect to PASS must at least satisfy our own
    // verifier. A file we expect to fail may legitimately not.
    // verifyCcrsFile returns CcrsBatchProblem[] (NOT {ok, errors}).
    // Column-header proof. Row 4 of every CCRS file is the header row, and it
    // must be the canonical column list for that file type -- verbatim, in
    // order. This is asserted for EVERY file including the EXPECT-ERROR ones,
    // because those must fail for the ONE reason we designed them to fail, not
    // because we quietly shipped a bad header. (This is what makes the
    // "Columns verified against CCRS_COLUMNS" line printed below truthful.)
    const headerRow = csv.split("\r\n")[3] ?? "";
    const expectedHeader = CCRS_COLUMNS[t.type].join(",");
    const normalizedHeader = t.padHeaders
      ? headerRow.replace(/,+$/, "")
      : headerRow;
    if (normalizedHeader !== expectedHeader) {
      throw new Error(
        `${t.id}: header row does not match CCRS_COLUMNS.${t.type}.\n` +
          `  expected: ${expectedHeader}\n` +
          `  actual  : ${headerRow}`,
      );
    }

    const problems = verifyCcrsFile(t.type, csv);
    const hardErrors = problems.filter((p) => p.severity === "error");
    if (t.expect === "no error" && hardErrors.length > 0) {
      throw new Error(
        `${t.id} is supposed to be VALID but our own verifier rejects it: ${hardErrors
          .map((p) => p.message)
          .join("; ")}`,
      );
    }

    n += 1;
    lines.push(
      `| ${n} | ${t.id} | \`${outName}\` | ${t.group} | ${
        t.expect === "ERROR" ? "**error**" : "no error"
      } | ${t.purpose} ${t.pin} | | |`,
    );
  }

  lines.push("\n## What each answer settles\n");
  lines.push(
    "- **T-11 vs T-10** — whether the three header rows must be comma-padded to the column count (open item **U-03**). If T-10 passes, the app's current output is correct as-is and the padding helper stays off.\n- **T-12** — whether the filename prefix is case-sensitive (**U-02**).\n- **T-33 / T-34** — whether the weekly Inventory report should re-Insert or Update (**U-05 / N-03**). This decides the single biggest open question in the weekly routine.\n- **T-37** — whether Inventory→Product really joins on the exact name string. If it does, product renaming is a compliance event, not cosmetics.\n- **T-14 / T-18 / T-19 / T-31 / T-32 / T-35 / T-42 / T-48 / T-54** — the verbatim error text for each rule, so the hub can triage a real error email to a real fix instead of showing the owner a wall of text.\n",
  );
  lines.push("\n## Recording\n");
  lines.push(
    "Copy the completed table into `docs/ccrs-bible/12-unverified-register.md` under the matching U-xx item, and note the date. Anything that contradicts the bible wins — the document is updated to match what CCRS actually did, with the result cited.\n",
  );

  writeFileSync(join(OUT, "MANIFEST.md"), lines.join("\n"), "utf8");

  const errCount = TESTS.filter((t) => t.expect === "ERROR").length;
  console.log(`Wrote ${TESTS.length} test files + MANIFEST.md to ${OUT}`);
  console.log(
    `  ${TESTS.length - errCount} expected to PASS, ${errCount} intentionally invalid (EXPECT-ERROR).`,
  );
  console.log(`  Columns verified against CCRS_COLUMNS for all ${new Set(TESTS.map((t) => t.type)).size} file types.`);
}

main();
