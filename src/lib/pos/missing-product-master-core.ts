/**
 * src/lib/pos/missing-product-master-core.ts  (PROGRAM 3 / SLICE 6B)
 *
 * PURE worklist builder for the rows the importer had to hide because the
 * product exists in the INVENTORIES workbook but has no row in the PRODUCTS
 * workbook (`hidden_reason = "no_product_master"`, set at transform.ts:853).
 *
 * ═══ WHY THIS MODULE EXISTS (measured, not assumed) ═══
 *
 * Owner, Round 7: "the rejected ones, i can not fix or do anything with them
 * at all." He was right. `facts/page.tsx` rendered the Rejected bucket as
 * name + notes inside a collapsed <details> — no form, no export, no grouping.
 * Display-only by construction.
 *
 * Before building anything I measured the owner's real Sep-1-2026 workbooks
 * (3,541 product rows / 4,284 inventory rows) with the REAL transformer:
 *
 *     items 3333 | hidden 771 | ALL 771 hidden_reason = no_product_master
 *     distinct inventory keys 3626 | unmatched against Products 801
 *     8,012 units on hand | $141,148.02 retail | 158 brands | 0 with zero stock
 *
 * ═══ WHY THIS IS A WORKLIST AND *NOT* A NAME-MATCHING LAYER ═══
 *
 * transform.ts:260 matches on an EXACT lowercased name, so the obvious theory
 * is "the products are there, the match is just too strict." I tested that
 * theory instead of believing it. Measured, on the owner's own files:
 *
 *     loose name match (punctuation-insensitive)        1 of 801
 *     loose name match + size-suffix stripped          35 of 801
 *     SAFE match (name normalised AND package size AGREES)
 *                                                       3 of 801
 *
 * The 35 are a TRAP. Verified against the workbook: inventory
 * "Downtown Flower Hassel Hoth - 28g" would "match" products
 * "Downtown Flower Hassel Hoth - 7g", and 7g is the ONLY Hassel Hoth row that
 * exists. A 28g jar is not a 7g jar. Auto-linking those would write a wrong
 * package size onto a cannabis product — inventing data, which standing rule 3
 * and data-governance Rule 3.1 forbid outright.
 *
 * A matching layer would therefore recover 3 of 801 (0.4%) while risking a
 * mis-sized cannabis SKU on the other 32. So this module does NOT match names.
 * It states the gap precisely and hands the owner the exact list to fix.
 *
 * ═══ WHAT IT DOES / DOES NOT ASSERT ═══
 *
 * Every field it emits is TRANSCRIBED from the staged row, which was itself
 * read from the owner's inventory export. It never invents a brand, a strain,
 * a size or a price. Where the source was blank, the field stays blank and the
 * row is marked incomplete so the owner can see what he must supply. Blank is
 * a fact ("we do not know"), and it is reported as one.
 *
 * Money is in MINOR UNITS throughout (standing rule 7).
 *
 * Pure: plain data in, plain data out. No fs, no network, no Supabase.
 */

// ---------------------------------------------------------------------------
// Input shape — deliberately structural, so this module never imports the DB
// row type and can be unit-tested with plain object literals.
// ---------------------------------------------------------------------------

/** The hidden reason the transformer writes for "not in the Products file". */
export const NO_PRODUCT_MASTER = "no_product_master";

export type MissingMasterVariantInput = {
  label: string;
  priceMinorUnits: number;
  inventoryLevel: number;
  medical: boolean;
};

export type MissingMasterItemInput = {
  sourceItemId: string;
  name: string;
  productName: string | null;
  brand: string;
  category: string;
  posInventoryType: string | null;
  posInventoryCategory: string | null;
  strainName: string | null;
  strainType: string;
  hidden: boolean;
  hiddenReason: string | null;
  variants: readonly MissingMasterVariantInput[];
};

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

/**
 * Which fields a Cultivera product-master row needs that we could NOT
 * transcribe. These are the ONLY blanks — everything else came from the
 * owner's own export.
 */
export type MissingMasterField = "brand" | "strain" | "category" | "inventoryType" | "packageSize" | "price";

export type MissingMasterRow = {
  sourceItemId: string;
  /** Display name as staged (this is the match key Cultivera uses). */
  name: string;
  /** The raw POS product name when it differs from the display name. */
  productName: string | null;
  brand: string;
  category: string;
  inventoryType: string;
  strainName: string;
  strainType: string;
  /** Package labels present on this item, e.g. ["1g","3.5g"]. */
  packageLabels: string[];
  /** Units on hand across every variant. */
  units: number;
  /** Retail value at staged prices, MINOR UNITS. */
  retailValueMinorUnits: number;
  /** True when ANY variant is flagged medical. */
  medical: boolean;
  /** Fields a product-master row needs that the export did not give us. */
  missingFields: MissingMasterField[];
};

export type MissingMasterBrandGroup = {
  /** Brand exactly as staged; NO_BRAND_TEXT when the export had none. */
  brand: string;
  rows: MissingMasterRow[];
  itemCount: number;
  units: number;
  retailValueMinorUnits: number;
};

export type MissingMasterWorklist = {
  rows: MissingMasterRow[];
  /** Brand groups, biggest stranded-value first. A brand = one vendor call. */
  brands: MissingMasterBrandGroup[];
  totals: {
    items: number;
    units: number;
    retailValueMinorUnits: number;
    brands: number;
    /** Items with at least one field we could not transcribe. */
    incompleteItems: number;
    /** Items carrying at least one medical variant. */
    medicalItems: number;
    /** Items with zero units on hand (nothing stranded — lowest priority). */
    zeroStockItems: number;
  };
};

/** Shown when the inventory export carried no brand for a row. */
export const NO_BRAND_TEXT = "(no brand in the export)";

// ---------------------------------------------------------------------------
// DB adapter (type-only import — this module stays pure)
// ---------------------------------------------------------------------------

/**
 * Adapt a staged `menu_items` row + its `menu_variants` to the worklist input.
 *
 * Mirrors `menuItemRowToFactReviewItem` (fact-review-core.ts:177) so both
 * screens read the SAME staged rows and can never disagree about what was
 * staged. PostgREST returns `numeric` columns as strings, hence the coercion
 * on the variant numbers.
 */
export function menuItemRowToMissingMasterItem(
  row: MenuItemRowLike,
  variants: readonly MenuVariantRowLike[],
): MissingMasterItemInput {
  return {
    sourceItemId: row.source_item_id,
    name: row.name,
    productName: row.product_name,
    brand: row.brand_name,
    category: row.category,
    posInventoryType: row.pos_inventory_type,
    posInventoryCategory: row.pos_inventory_category,
    strainName: row.strain_name,
    strainType: row.strain_type,
    hidden: row.hidden,
    hiddenReason: row.hidden_reason,
    variants: variants.map((v) => ({
      label: v.label,
      priceMinorUnits: toInt(v.price_minor_units),
      inventoryLevel: toInt(v.inventory_level),
      medical: v.medical === true,
    })),
  };
}

/** Structural subset of MenuItemRow — keeps this module free of DB imports. */
export type MenuItemRowLike = {
  source_item_id: string;
  name: string;
  product_name: string | null;
  brand_name: string;
  category: string;
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  strain_name: string | null;
  strain_type: string;
  hidden: boolean;
  hidden_reason: string | null;
};

/** Structural subset of MenuVariantRow. */
export type MenuVariantRowLike = {
  label: string;
  price_minor_units: number | string | null;
  inventory_level: number | string | null;
  medical: boolean | null;
};

function toInt(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * A strain value that is really a placeholder carries no information. We do
 * NOT rewrite it to something prettier — we treat it as blank so the owner is
 * told the field is missing rather than being handed a fake value.
 *
 * Grounded in the naming work already in this repo
 * (docs/CULTIVERA_PRODUCT_UPLOAD.md: "generic placeholders (`No Strain`,
 * `Mixed`, `Assorted`, `Paraphernalia`) are stripped").
 */
const PLACEHOLDER_STRAINS = new Set(["", "n/a", "na", "none", "no strain", "mixed", "assorted", "paraphernalia", "unknown"]);

function meaningfulStrain(value: string | null | undefined): string {
  const s = clean(value);
  return PLACEHOLDER_STRAINS.has(s.toLowerCase()) ? "" : s;
}

/** "unknown" strain TYPE is the transformer's explicit not-determined value. */
function meaningfulStrainType(value: string | null | undefined): string {
  const s = clean(value);
  return s.toLowerCase() === "unknown" ? "" : s;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Turn staged menu items into the missing-product-master worklist.
 *
 * ONLY rows that are hidden AND carry `no_product_master` are included. A row
 * hidden for any other reason (`reviewer_rejected`, `no_inventory`) is a
 * different problem with a different owner action and must not be silently
 * folded in here — that would misstate what the list is.
 */
export function buildMissingProductMasterWorklist(
  items: readonly MissingMasterItemInput[],
): MissingMasterWorklist {
  const rows: MissingMasterRow[] = [];

  for (const item of items) {
    if (!item.hidden) continue;
    if (item.hiddenReason !== NO_PRODUCT_MASTER) continue;

    let units = 0;
    let retailValueMinorUnits = 0;
    let medical = false;
    const labels: string[] = [];
    for (const v of item.variants ?? []) {
      const level = Number.isFinite(v.inventoryLevel) ? Math.max(0, Math.trunc(v.inventoryLevel)) : 0;
      const price = Number.isFinite(v.priceMinorUnits) ? Math.max(0, Math.trunc(v.priceMinorUnits)) : 0;
      units += level;
      retailValueMinorUnits += level * price;
      if (v.medical) medical = true;
      const label = clean(v.label);
      if (label && !labels.includes(label)) labels.push(label);
    }

    const brand = clean(item.brand);
    const category = clean(item.category);
    // The POS "Inventory Type" is the CCRS-facing classification; fall back to
    // the POS category only when the type column was blank. Both are
    // transcribed, never derived.
    const inventoryType = clean(item.posInventoryType) || clean(item.posInventoryCategory);
    const strainName = meaningfulStrain(item.strainName);
    const strainType = meaningfulStrainType(item.strainType);

    const missingFields: MissingMasterField[] = [];
    if (!brand) missingFields.push("brand");
    if (!strainName) missingFields.push("strain");
    if (!category) missingFields.push("category");
    if (!inventoryType) missingFields.push("inventoryType");
    if (labels.length === 0) missingFields.push("packageSize");
    if (retailValueMinorUnits === 0 && units > 0) missingFields.push("price");

    rows.push({
      sourceItemId: item.sourceItemId,
      name: clean(item.name),
      productName: clean(item.productName) || null,
      brand,
      category,
      inventoryType,
      strainName,
      strainType,
      packageLabels: labels,
      units,
      retailValueMinorUnits,
      medical,
      missingFields,
    });
  }

  // Highest stranded value first — that is the order in which the work pays.
  // Ties break on units then name so the order is deterministic (a wobbling
  // list is a list the owner cannot work through methodically).
  rows.sort(
    (a, b) =>
      b.retailValueMinorUnits - a.retailValueMinorUnits ||
      b.units - a.units ||
      a.name.localeCompare(b.name),
  );

  const byBrand = new Map<string, MissingMasterBrandGroup>();
  for (const row of rows) {
    const key = row.brand || NO_BRAND_TEXT;
    const group = byBrand.get(key) ?? {
      brand: key,
      rows: [],
      itemCount: 0,
      units: 0,
      retailValueMinorUnits: 0,
    };
    group.rows.push(row);
    group.itemCount += 1;
    group.units += row.units;
    group.retailValueMinorUnits += row.retailValueMinorUnits;
    byBrand.set(key, group);
  }

  const brands = [...byBrand.values()].sort(
    (a, b) =>
      b.retailValueMinorUnits - a.retailValueMinorUnits ||
      b.units - a.units ||
      a.brand.localeCompare(b.brand),
  );

  return {
    rows,
    brands,
    totals: {
      items: rows.length,
      units: rows.reduce((sum, r) => sum + r.units, 0),
      retailValueMinorUnits: rows.reduce((sum, r) => sum + r.retailValueMinorUnits, 0),
      brands: brands.length,
      incompleteItems: rows.filter((r) => r.missingFields.length > 0).length,
      medicalItems: rows.filter((r) => r.medical).length,
      zeroStockItems: rows.filter((r) => r.units === 0).length,
    },
  };
}

// ---------------------------------------------------------------------------
// The rep-ready export
// ---------------------------------------------------------------------------

/**
 * Column headers for the sheet the owner sends to his Cultivera rep.
 *
 * WHY THIS SHAPE: docs/CULTIVERA_PRODUCT_UPLOAD.md records the constraint,
 * verified and already in this repo — "Cultivera does not allow the owner to
 * upload their own sheets — the rep does the batch upload." So a screen that
 * merely says "create 771 products" is unusable. The deliverable has to be a
 * sheet the rep can act on, which is why the first five columns mirror the
 * existing accepted sheet (Original/Updated/Receipt Name, Strain Type,
 * Description) and the remainder carry the transcribed evidence the rep needs
 * to actually build the row.
 */
export const MISSING_MASTER_CSV_COLUMNS = [
  "Original Product Name",
  "Updated Product Name",
  "Receipt Name",
  "Strain Type",
  "Product Description",
  "Menu Display Name",
  "Brand",
  "Category",
  "Inventory Type",
  "Strain",
  "Package Size",
  "Units On Hand",
  "Retail Value",
  "Medical",
  "Still Needed From Greenway",
] as const;

/** RFC-4180 quoting. A stray quote or comma must not shift a column. */
export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Money for humans, from MINOR UNITS. Boundary conversion only (rule 7). */
export function formatMinorUnits(minor: number): string {
  const safe = Number.isFinite(minor) ? Math.trunc(minor) : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const FIELD_LABEL: Record<MissingMasterField, string> = {
  brand: "Brand",
  strain: "Strain",
  category: "Category",
  inventoryType: "Inventory Type",
  packageSize: "Package Size",
  price: "Price",
};

/**
 * Render one worklist row as CSV cells.
 *
 * ═══ COLUMN 1 MUST BE THE RAW POS PRODUCT NAME, NOT THE DISPLAY NAME ═══
 *
 * `Original Product Name` is the key the rep uses to FIND the row in Cultivera
 * (docs/CULTIVERA_PRODUCT_UPLOAD.md: "This is the match key Cultivera uses to
 * find the row"). The staged `name` is the transformer's DERIVED display name
 * — `deriveDisplayName()` strips brand/vendor/size noise, so POS
 * "GE - Blackberry Cobbler - 1g Indica Vape Cartridge" becomes
 * "Black & Blueberry".
 *
 * Measured on the owner's real files, against the raw INVENTORIES sheet:
 *     display name found in the POS export :   3 of 771
 *     productName  found in the POS export : 771 of 771
 *
 * So emitting the display name would hand the rep a sheet where 768 of 771
 * rows cannot be located. `productName` is the transcribed POS value and is
 * the only correct match key. `name` still ships, clearly labelled, because it
 * is what the owner sees on his own screens.
 *
 * `Updated Product Name` / `Receipt Name` are intentionally left BLANK. We
 * know the current name; we do NOT know what the owner wants it renamed to,
 * and writing a machine-invented name into a column the rep will apply
 * verbatim to the POS is exactly the kind of guess standing rule 3 forbids.
 * The blank is the honest answer and the rep's sheet expects the owner to
 * supply it.
 */
export function missingMasterCsvRow(row: MissingMasterRow): string[] {
  return [
    // The POS name is the match key. Fall back to the display name only when
    // the export genuinely carried no product name (never observed in the real
    // data, but a blank key is worse than a best-available one and the
    // fallback is visible in the adjacent column).
    row.productName ?? row.name,
    "",
    "",
    row.strainType,
    "",
    row.name,
    row.brand,
    row.category,
    row.inventoryType,
    row.strainName,
    row.packageLabels.join(" / "),
    String(row.units),
    formatMinorUnits(row.retailValueMinorUnits),
    row.medical ? "Yes" : "No",
    row.missingFields.map((f) => FIELD_LABEL[f]).join(" + "),
  ];
}

/** Full CSV document (CRLF, header row first). */
export function missingMasterCsv(worklist: MissingMasterWorklist): string {
  const lines = [MISSING_MASTER_CSV_COLUMNS.map(csvCell).join(",")];
  for (const row of worklist.rows) lines.push(missingMasterCsvRow(row).map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Reconciliation statement (data-governance Rule 3.3)
// ---------------------------------------------------------------------------

/**
 * The sentence that tells the owner these rows are NOT blocking his publish.
 *
 * The owner spent Round 7 believing 771 rejects were why nothing reached his
 * website. They were not — the publish gate never counted them. Saying so
 * plainly, with the arithmetic, is the whole point of Rule 3.3.
 */
export function reconciliationStatement(input: {
  totalItems: number;
  goingLive: number;
  documentedRejects: number;
}): string {
  const { totalItems, goingLive, documentedRejects } = input;
  const balanced = goingLive + documentedRejects === totalItems;
  const sum = `${totalItems} staged = ${goingLive} going live + ${documentedRejects} documented rejects`;
  return balanced
    ? `${sum}. These rejects do NOT block publishing.`
    : `${sum} — THIS DOES NOT BALANCE (${goingLive + documentedRejects} accounted for, ${totalItems} staged). Do not publish until this is explained.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function ok(condition: boolean, message: string) {
  if (!condition) throw new Error(`missing-product-master-core: ${message}`);
}

function variant(over: Partial<MissingMasterVariantInput> = {}): MissingMasterVariantInput {
  return { label: "1g", priceMinorUnits: 1000, inventoryLevel: 2, medical: false, ...over };
}

function item(over: Partial<MissingMasterItemInput> = {}): MissingMasterItemInput {
  return {
    sourceItemId: "pos-1",
    name: "Torus Pre-Rolls K2 #1 - 1g",
    productName: "Torus Pre-Rolls K2 #1-1g",
    brand: "Torus",
    category: "preroll",
    posInventoryType: "Usable Marijuana",
    posInventoryCategory: "Pre-roll",
    strainName: "K2 #1",
    strainType: "hybrid",
    hidden: true,
    hiddenReason: NO_PRODUCT_MASTER,
    variants: [variant()],
    ...over,
  };
}

export function __runMissingProductMasterCoreTests(): string {
  // --- only no_product_master rows are included -----------------------------
  const mixed = buildMissingProductMasterWorklist([
    item({ sourceItemId: "keep" }),
    item({ sourceItemId: "visible", hidden: false }),
    item({ sourceItemId: "reviewer", hiddenReason: "reviewer_rejected" }),
    item({ sourceItemId: "noinv", hiddenReason: "no_inventory" }),
    item({ sourceItemId: "nullreason", hiddenReason: null }),
  ]);
  ok(mixed.rows.length === 1, "only hidden+no_product_master rows enter the worklist");
  ok(mixed.rows[0].sourceItemId === "keep", "the right row survived");

  // --- totals are arithmetic on the staged data, not estimates --------------
  const totals = buildMissingProductMasterWorklist([
    item({ sourceItemId: "a", variants: [variant({ inventoryLevel: 10, priceMinorUnits: 1500 })] }),
    item({ sourceItemId: "b", brand: "Lifted", variants: [variant({ inventoryLevel: 3, priceMinorUnits: 2000 })] }),
  ]);
  ok(totals.totals.items === 2, "two items");
  ok(totals.totals.units === 13, "units summed");
  ok(totals.totals.retailValueMinorUnits === 10 * 1500 + 3 * 2000, "retail value in MINOR UNITS");
  ok(totals.totals.brands === 2, "two brands");

  // --- ranked by stranded value, deterministic ------------------------------
  ok(totals.rows[0].sourceItemId === "a", "highest stranded value first");
  ok(totals.brands[0].brand === "Torus", "brand groups ranked by value too");

  // --- multiple variants roll up -------------------------------------------
  const multi = buildMissingProductMasterWorklist([
    item({
      variants: [
        variant({ label: "1g", inventoryLevel: 2, priceMinorUnits: 1000 }),
        variant({ label: "3.5g", inventoryLevel: 1, priceMinorUnits: 3000, medical: true }),
        variant({ label: "1g", inventoryLevel: 4, priceMinorUnits: 1000 }),
      ],
    }),
  ]);
  ok(multi.rows[0].units === 7, "units across variants");
  ok(multi.rows[0].retailValueMinorUnits === 2 * 1000 + 3000 + 4 * 1000, "value across variants");
  ok(multi.rows[0].packageLabels.join(",") === "1g,3.5g", "distinct package labels, order preserved");
  ok(multi.rows[0].medical === true, "any medical variant marks the row medical");
  ok(multi.totals.medicalItems === 1, "medical item counted");

  // --- BLANKS STAY BLANK and are reported, never invented -------------------
  const blank = buildMissingProductMasterWorklist([
    item({ brand: "", strainName: null, posInventoryType: null, posInventoryCategory: null }),
  ]);
  const br = blank.rows[0];
  ok(br.brand === "", "blank brand stays blank -- never invented");
  ok(br.strainName === "", "blank strain stays blank");
  ok(br.inventoryType === "", "blank inventory type stays blank");
  ok(br.missingFields.includes("brand"), "missing brand reported");
  ok(br.missingFields.includes("strain"), "missing strain reported");
  ok(br.missingFields.includes("inventoryType"), "missing inventory type reported");
  ok(blank.totals.incompleteItems === 1, "incomplete item counted");
  ok(blank.brands[0].brand === NO_BRAND_TEXT, "brandless rows group under an explicit label");

  // --- placeholder strains are treated as blank, not as data ---------------
  for (const placeholder of ["No Strain", "MIXED", "assorted", "N/A", "none", "Unknown"]) {
    const p = buildMissingProductMasterWorklist([item({ strainName: placeholder })]);
    ok(p.rows[0].strainName === "", `placeholder strain "${placeholder}" is treated as blank`);
    ok(p.rows[0].missingFields.includes("strain"), `placeholder strain "${placeholder}" is reported missing`);
  }
  const realStrain = buildMissingProductMasterWorklist([item({ strainName: "Blue Dream" })]);
  ok(realStrain.rows[0].strainName === "Blue Dream", "a real strain is kept verbatim");
  ok(!realStrain.rows[0].missingFields.includes("strain"), "a real strain is not reported missing");

  // --- "unknown" strain TYPE is not passed off as a determination -----------
  const ut = buildMissingProductMasterWorklist([item({ strainType: "unknown" })]);
  ok(ut.rows[0].strainType === "", "'unknown' strain type renders blank, not as a value");

  // --- inventory type falls back to the POS category, still transcribed -----
  const fb = buildMissingProductMasterWorklist([item({ posInventoryType: null, posInventoryCategory: "Pre-roll" })]);
  ok(fb.rows[0].inventoryType === "Pre-roll", "falls back to POS category when type is blank");
  ok(!fb.rows[0].missingFields.includes("inventoryType"), "fallback satisfies the field");

  // --- zero stock is counted, not hidden -----------------------------------
  const zero = buildMissingProductMasterWorklist([
    item({ sourceItemId: "z", variants: [variant({ inventoryLevel: 0, priceMinorUnits: 1000 })] }),
  ]);
  ok(zero.totals.zeroStockItems === 1, "zero-stock item counted");
  ok(!zero.rows[0].missingFields.includes("price"), "zero stock does not falsely report a missing price");

  // --- a priced-at-zero row WITH stock is flagged --------------------------
  const freeish = buildMissingProductMasterWorklist([
    item({ variants: [variant({ inventoryLevel: 5, priceMinorUnits: 0 })] }),
  ]);
  ok(freeish.rows[0].missingFields.includes("price"), "stock with no price is reported missing");

  // --- negative / non-finite input cannot corrupt the totals ---------------
  const dirty = buildMissingProductMasterWorklist([
    item({
      variants: [
        variant({ inventoryLevel: -5, priceMinorUnits: 1000 }),
        variant({ inventoryLevel: Number.NaN, priceMinorUnits: 1000 }),
        variant({ inventoryLevel: 3, priceMinorUnits: -100 }),
      ],
    }),
  ]);
  ok(dirty.rows[0].units === 3, "negative and NaN unit counts are floored at zero");
  ok(dirty.rows[0].retailValueMinorUnits === 0, "negative prices cannot subtract value");

  // --- CSV ------------------------------------------------------------------
  const csv = missingMasterCsv(totals);
  const lines = csv.split("\r\n");
  ok(lines[0] === MISSING_MASTER_CSV_COLUMNS.join(","), "header row matches the declared columns");
  ok(lines.length === 4, "header + 2 rows + trailing newline");
  ok(csv.endsWith("\r\n"), "CRLF terminated");
  const cells = missingMasterCsvRow(totals.rows[0]);
  ok(cells.length === MISSING_MASTER_CSV_COLUMNS.length, "every row has exactly one cell per column");
  ok(cells[1] === "" && cells[2] === "", "Updated/Receipt names left BLANK -- we do not invent a rename");
  ok(cells[12] === "150.00", "retail value converted from minor units at the boundary");

  // --- COLUMN 1 IS THE RAW POS NAME, NOT THE DERIVED DISPLAY NAME ----------
  // The rep uses column 1 to FIND the row in Cultivera. On the owner's real
  // files the display name matched the POS export on 3 of 771 rows and the
  // productName matched on 771 of 771, so getting this backwards would ship a
  // sheet the rep cannot use. This assertion is the guard.
  const derived = buildMissingProductMasterWorklist([
    item({
      name: "Black & Blueberry",
      productName: "GE - Blackberry Cobbler - 1g Indica Vape Cartridge",
    }),
  ]);
  const dCells = missingMasterCsvRow(derived.rows[0]);
  ok(
    dCells[0] === "GE - Blackberry Cobbler - 1g Indica Vape Cartridge",
    "column 1 carries the RAW POS product name (the rep's match key)",
  );
  ok(dCells[0] !== "Black & Blueberry", "column 1 is NOT the derived display name");
  ok(dCells[5] === "Black & Blueberry", "the display name still ships, in its own labelled column");
  ok(MISSING_MASTER_CSV_COLUMNS[0] === "Original Product Name", "column 1 header is the match key");
  ok(MISSING_MASTER_CSV_COLUMNS[5] === "Menu Display Name", "column 6 header names the display value");

  // Fallback only when the POS name is genuinely absent.
  const noPos = buildMissingProductMasterWorklist([item({ name: "Only Display", productName: null })]);
  ok(
    missingMasterCsvRow(noPos.rows[0])[0] === "Only Display",
    "falls back to the display name only when the POS name is blank",
  );

  // --- CSV injection / quoting ---------------------------------------------
  ok(csvCell('a,b') === '"a,b"', "comma quoted");
  ok(csvCell('say "hi"') === '"say ""hi"""', "quotes doubled");
  ok(csvCell("line\nbreak") === '"line\nbreak"', "newline quoted");
  ok(csvCell(null) === "", "null renders empty");
  // Column 1 is the POS product name, so that is the cell that must survive a
  // name full of delimiters intact.
  const nasty = buildMissingProductMasterWorklist([item({ productName: 'Torus, "K2" #1\n1g' })]);
  const nastyLine = missingMasterCsv(nasty).split("\r\n")[1];
  ok(nastyLine.startsWith('"Torus, ""K2"" #1'), "a name full of delimiters cannot shift columns");

  // --- money formatting -----------------------------------------------------
  ok(formatMinorUnits(0) === "0.00", "zero");
  ok(formatMinorUnits(5) === "0.05", "cents pad");
  ok(formatMinorUnits(14114802) === "141148.02", "the real stranded total renders exactly");
  ok(formatMinorUnits(-250) === "-2.50", "negative");

  // --- reconciliation -------------------------------------------------------
  const good = reconciliationStatement({ totalItems: 3333, goingLive: 2562, documentedRejects: 771 });
  ok(good.includes("3333 staged = 2562 going live + 771 documented rejects"), "arithmetic is shown");
  ok(good.includes("do NOT block publishing"), "the owner is told these are not the blocker");
  const bad = reconciliationStatement({ totalItems: 3333, goingLive: 2562, documentedRejects: 700 });
  ok(bad.includes("DOES NOT BALANCE"), "an unbalanced reconciliation is stated as a failure");
  ok(!bad.includes("do NOT block publishing"), "an unbalanced statement never reassures");

  // --- DB adapter -----------------------------------------------------------
  const adapted = menuItemRowToMissingMasterItem(
    {
      source_item_id: "pos-db",
      name: "Ceres Cartridge Blue Dream - 1g",
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
    // PostgREST hands back `numeric` as strings -- the adapter must cope.
    [{ label: "1g", price_minor_units: "2500", inventory_level: "4", medical: null }],
  );
  ok(adapted.sourceItemId === "pos-db", "adapter maps the source id");
  ok(adapted.brand === "Ceres", "adapter maps the brand column");
  ok(adapted.posInventoryType === "Marijuana Extract for Inhalation", "adapter maps the POS inventory type");
  ok(adapted.variants[0].priceMinorUnits === 2500, "string price coerced to a number");
  ok(adapted.variants[0].inventoryLevel === 4, "string inventory level coerced to a number");
  ok(adapted.variants[0].medical === false, "null medical reads as false, never undefined");
  const adaptedList = buildMissingProductMasterWorklist([adapted]);
  ok(adaptedList.totals.retailValueMinorUnits === 10000, "adapted row values correctly (4 x 2500)");

  // A visible row must not leak in through the adapter path either.
  const adaptedVisible = menuItemRowToMissingMasterItem(
    {
      source_item_id: "pos-live", name: "Live", product_name: null, brand_name: "B", category: "flower",
      pos_inventory_type: null, pos_inventory_category: null, strain_name: null, strain_type: "hybrid",
      hidden: false, hidden_reason: null,
    },
    [],
  );
  ok(
    buildMissingProductMasterWorklist([adaptedVisible]).rows.length === 0,
    "a visible row never enters the worklist via the adapter",
  );

  return "missing-product-master-core: all assertions passed";
}
