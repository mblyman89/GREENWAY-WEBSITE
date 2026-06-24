#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as XLSX from "xlsx";

type GreenwayCategory =
  | "flower" | "paraphernalia" | "preroll-pack" | "cartridge" | "disposable-cartridge"
  | "edible-solid" | "concentrate" | "infused-preroll" | "infused-preroll-pack"
  | "preroll" | "edible-liquid" | "topical" | "trim";

type GreenwayStrainType = "indica" | "sativa" | "hybrid" | "cbd" | "unknown";
type InventoryStatus = "mock" | "in-stock" | "low-stock" | "unavailable";
type CannabinoidUnit = "%" | "mg";

type GreenwayCannabinoid = { type: "thc" | "thca" | "cbd" | "cbda" | "cbg" | "cbn" | "cbdv"; value: string | null; unit: CannabinoidUnit };
type GreenwayMenuVariant = { id: string; label: string; priceMinorUnits: number; inventoryLevel: number; medical: boolean };
type GreenwayMenuItem = {
  id: string;
  name: string;
  productName?: string;
  brand: string;
  category: GreenwayCategory;
  filterCategories?: GreenwayCategory[];
  posInventoryType?: string;
  posInventoryCategory?: string;
  strainType: GreenwayStrainType;
  strainName?: string;
  thc: string | null;
  cbd: string | null;
  totalThc: GreenwayCannabinoid | null;
  totalCbd: GreenwayCannabinoid | null;
  compounds: GreenwayCannabinoid[];
  description: string;
  priceLabel: string;
  priceMinorUnits: number;
  inventoryStatus: InventoryStatus;
  hidden?: boolean;
  hiddenReason?: string;
  variants: GreenwayMenuVariant[];
};

type Row = Record<string, string>;
type ProductRow = Row;
type InventoryRow = Row;
type Severity = "info" | "warning" | "error";
type Diagnostic = { severity: Severity; code: string; message: string; context?: Record<string, unknown> };
type ParsedPackage = { quantity: number; unit: string; gramsEquivalent?: number; label: string; sortValue: number; raw: string };
type CollapsedInventory = {
  productKey: string;
  productName: string;
  rows: InventoryRow[];
  totalUnits: number;
  package: ParsedPackage;
  priceMinorUnits: number;
  medical: boolean;
  category: string;
  inventoryType: string;
  brand: string;
  strain: string;
  totalRaw: number | null;
  cbdRaw: number | null;
  thcRaw: number | null;
  cbdaRaw: number | null;
  thcaRaw: number | null;
};

type ProductGroup = {
  identityKey: string;
  brand: string;
  category: GreenwayCategory;
  posInventoryCategory: string;
  posInventoryType: string;
  strainType: GreenwayStrainType;
  strainName: string;
  displayName: string;
  productNames: Set<string>;
  descriptions: string[];
  variants: CollapsedInventory[];
  hidden?: boolean;
  hiddenReason?: string;
};

const ROOT = process.cwd();
const POS_ROOT = path.join(ROOT, "pos-data");
const RAW_DIR = path.join(POS_ROOT, "raw");
const GENERATED_DIR = path.join(POS_ROOT, "generated");
const PRODUCTS_PATH = path.join(RAW_DIR, "PRODUCTS.xlsx");
const INVENTORIES_PATH = path.join(RAW_DIR, "INVENTORIES.xlsx");
const OUT_FULL = path.join(ROOT, "src", "data", "pos-menu-preview.json");
const OUT_SAMPLE = path.join(ROOT, "src", "data", "pos-menu-sample-preview.json");

const diagnostics: Diagnostic[] = [];
function addDiagnostic(severity: Severity, code: string, message: string, context?: Record<string, unknown>) {
  diagnostics.push({ severity, code, message, context });
}

const VALID_CATEGORIES = new Set<GreenwayCategory>([
  "flower", "paraphernalia", "preroll-pack", "cartridge", "disposable-cartridge", "edible-solid", "concentrate", "infused-preroll", "infused-preroll-pack", "preroll", "edible-liquid", "topical", "trim",
]);

const CATEGORY_MAP: Record<string, GreenwayCategory> = {
  "Flower": "flower",
  "Pre-roll": "preroll",
  "Blunt": "preroll",
  "Infused Pre-roll": "infused-preroll",
  "Infused Blunt": "infused-preroll",
  "Cartridge": "cartridge",
  "Disposable Cartridge": "disposable-cartridge",
  "Rosin": "concentrate",
  "Hash Rosin": "concentrate",
  "Live Resin": "concentrate",
  "BHO": "concentrate",
  "Badder": "concentrate",
  "Bubble Hash": "concentrate",
  "Hash": "concentrate",
  "Shatter": "concentrate",
  "Sugar": "concentrate",
  "Distillate": "concentrate",
  "Moon Rocks": "concentrate",
  "RSO": "concentrate",
  "Edible": "edible-solid",
  "Gummies": "edible-solid",
  "Chocolate": "edible-solid",
  "Fruit Chews": "edible-solid",
  "Chewees": "edible-solid",
  "Mints": "edible-solid",
  "Capsule": "edible-solid",
  "Beverage": "edible-liquid",
  "Shots": "edible-liquid",
  "Soda": "edible-liquid",
  "Liquid Infused Edible": "edible-liquid",
  "Tincture": "edible-liquid",
  "Topical": "topical",
  "Bath Salts": "topical",
  "Roll On": "topical",
  "Trim": "trim",
  "Popcorn Bud": "trim",
  "Balls": "edible-solid",
  "Bites": "edible-solid",
  "Hard Candy": "edible-solid",
  "Marmas": "edible-solid",
  "Minis": "edible-solid",
  "Panda Candies": "edible-solid",
  "Peanut Butter Cups": "edible-solid",
  "Crumble": "concentrate",
  "Diamonds": "concentrate",
  "Loud Resin": "concentrate",
  "Terp Crystals": "concentrate",
  "Terp Sauce": "concentrate",
  "THCa": "concentrate",
  "Mix Infused Flower": "concentrate",
  "Live Resin Cartridge": "cartridge",
  "Pod": "cartridge",
  "Other Liquid Edible": "edible-liquid",
};

const STRAIN_MAP: Record<string, GreenwayStrainType> = {
  "indica": "indica",
  "sativa": "sativa",
  "hybrid": "hybrid",
  "cbd": "cbd",
  "indica dominant": "indica",
  "sativa dominant": "sativa",
  "50/50 hybrid": "hybrid",
};

const THC_TOTAL_ALLOWED_TYPES = new Set(["Concentrate for Inhalation", "Usable Marijuana"]);

function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }
function normalizeWhitespace(value: unknown) { return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim(); }
function comparableName(value: unknown) { return normalizeWhitespace(value).toLowerCase(); }
function collapseKeyPart(value: unknown) { return comparableName(value).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-"); }
function stableId(...parts: unknown[]) { return crypto.createHash("sha1").update(parts.map((p) => collapseKeyPart(p)).join("|")).digest("hex").slice(0, 12); }
function titleCase(value: string) { return value.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bCbd\b/g, "CBD").replace(/\bThc\b/g, "THC"); }
function firstNonBlank(...values: unknown[]) { return values.map(normalizeWhitespace).find(Boolean) ?? ""; }
function toNumber(value: unknown): number | null { const s = normalizeWhitespace(value).replace(/[$,]/g, ""); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }
function toBool(value: unknown): boolean { return /^(true|t|yes|y|1)$/i.test(normalizeWhitespace(value)); }
function priceToMinorUnits(value: unknown): number { const n = toNumber(value); return n === null ? 0 : Math.round(n * 100); }
function formatCurrency(minor: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100); }
function formatNumber(value: number, maxDecimals = 2) { return Number(value.toFixed(maxDecimals)).toString(); }

function readWorkbookRows(filePath: string, preferredSheet?: string): Row[] {
  if (!fs.existsSync(filePath)) throw new Error(`Required workbook not found: ${path.relative(ROOT, filePath)}`);
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = preferredSheet && workbook.SheetNames.includes(preferredSheet) ? preferredSheet : workbook.SheetNames[0];
  if (!sheetName) throw new Error(`Workbook has no sheets: ${filePath}`);
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeWhitespace(key), normalizeWhitespace(value)])));
}

function requireColumns(rows: Row[], columns: string[], workbookName: string) {
  const actual = new Set(rows.flatMap((row) => Object.keys(row)));
  const missing = columns.filter((col) => !actual.has(col));
  if (missing.length > 0) {
    addDiagnostic("error", "missing_columns", `${workbookName} is missing required columns.`, { missing, actual: [...actual] });
    throw new Error(`${workbookName} missing required columns: ${missing.join(", ")}`);
  }
}

function normalizeCategory(category: string): GreenwayCategory {
  const exact = CATEGORY_MAP[normalizeWhitespace(category)];
  if (exact) return exact;
  addDiagnostic("error", "unmapped_category", `Unmapped POS category: ${category}`, { category });
  throw new Error(`Unmapped POS category: ${category}`);
}

function tryNormalizeCategory(category: string): GreenwayCategory | null {
  const exact = CATEGORY_MAP[normalizeWhitespace(category)];
  if (exact) return exact;
  addDiagnostic("warning", "unmapped_category_fallback", `Unmapped POS category for hidden item, using fallback: ${category}`, { category });
  return null;
}

const CATEGORY_FALLBACK: Record<string, GreenwayCategory> = {
  "flower": "flower", "preroll": "preroll", "cartridge": "cartridge", "concentrate": "concentrate",
  "edible-solid": "edible-solid", "edible-liquid": "edible-liquid", "topical": "topical", "trim": "trim",
};

function categoryWithFallback(rawCategory: string): GreenwayCategory {
  const normalized = tryNormalizeCategory(rawCategory);
  if (normalized) return normalized;
  const lowered = normalizeWhitespace(rawCategory).toLowerCase();
  for (const [keyword, cat] of Object.entries(CATEGORY_FALLBACK)) {
    if (lowered.includes(keyword)) return cat;
  }
  return "concentrate";
}

function normalizeStrainType(value: string, category: GreenwayCategory): GreenwayStrainType {
  if (["edible-solid", "edible-liquid", "topical", "paraphernalia"].includes(category)) return "unknown";
  const mapped = STRAIN_MAP[comparableName(value)];
  if (!mapped) {
    addDiagnostic("warning", "unknown_strain_type", `Unknown strain type '${value}', defaulting to unknown.`, { value, category });
    return "unknown";
  }
  return mapped;
}

function parsePackageSize(rawPackage: string, fallbackSize?: string, fallbackUnit?: string): ParsedPackage {
  const raw = firstNonBlank(rawPackage, [fallbackSize, fallbackUnit].filter(Boolean).join(" "));
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*([a-zA-Z ]+)?/);
  const quantity = match ? Number(match[1]) : 1;
  const unitRaw = normalizeWhitespace(match?.[2] ?? fallbackUnit ?? "each").toLowerCase();
  let unit = unitRaw.replace(/ounces?/, "oz").replace(/grams?/, "g").replace(/milligrams?/, "mg").replace(/milliliters?/, "ml").replace(/fluid\s*ounces?/, "floz").replace(/fluidounce/, "floz").replace(/each|units?/, "ea");
  if (!unit) unit = "ea";
  const gramsEquivalent = unit === "g" ? quantity : unit === "oz" ? quantity * 28 : undefined;
  let label: string;
  if (unit === "g") {
    if (Math.abs(quantity - 28) < 0.01) label = "1oz";
    else if (Math.abs(quantity - 14) < 0.01) label = "14g";
    else if (Math.abs(quantity - 7) < 0.01) label = "7g";
    else if (Math.abs(quantity - 3.5) < 0.01) label = "3.5g";
    else label = `${formatNumber(quantity)}g`;
  } else if (unit === "oz") label = `${formatNumber(quantity)}oz`;
  else if (unit === "floz") label = `${formatNumber(quantity)}fl oz`;
  else if (unit === "mg") label = `${formatNumber(quantity)}mg`;
  else if (unit === "ml") label = `${formatNumber(quantity)}ml`;
  else label = quantity === 1 ? "each" : `${formatNumber(quantity)} each`;
  const sortUnitWeight = unit === "mg" ? 0.001 : unit === "g" ? 1 : unit === "oz" ? 28 : unit === "ml" ? 0.01 : unit === "floz" ? 0.02957 : 10000;
  return { quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1, unit, gramsEquivalent, label, sortValue: (Number.isFinite(quantity) ? quantity : 1) * sortUnitWeight, raw };
}

function statusForInventory(level: number): Exclude<InventoryStatus, "mock"> {
  if (level <= 0) return "unavailable";
  if (level <= 3) return "low-stock";
  return "in-stock";
}

function genericDescription(group: ProductGroup) { return `${group.displayName} from ${group.brand}. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.`; }

function shouldDisplayThcTotal(inventoryType: string) { return THC_TOTAL_ALLOWED_TYPES.has(normalizeWhitespace(inventoryType)); }
function thcTotalString(totalRaw: number | null, inventoryType: string): string | null {
  if (!shouldDisplayThcTotal(inventoryType)) return null;
  if (totalRaw === null || totalRaw <= 0) return "N/A";
  return `${formatNumber(totalRaw, 2)}%`;
}
function cbdString(cbdRaw: number | null, inventoryType: string): string | null {
  if (!shouldDisplayThcTotal(inventoryType)) return null;
  if (cbdRaw === null || cbdRaw <= 0) return "N/A";
  return `${formatNumber(cbdRaw, 2)}%`;
}

function productRowsByName(products: ProductRow[]) {
  const byName = new Map<string, ProductRow[]>();
  for (const row of products) {
    const key = comparableName(row["Product Name"]);
    if (!key) {
      addDiagnostic("warning", "blank_product_name", "Product workbook row skipped because Product Name is blank.", { row });
      continue;
    }
    const list = byName.get(key) ?? [];
    list.push(row);
    byName.set(key, list);
  }
  for (const [key, rows] of byName) {
    if (rows.length > 1) addDiagnostic("info", "product_master_duplicate", "Product master has duplicate product names; using as equivalent product metadata, not deleting.", { productKey: key, count: rows.length });
  }
  return byName;
}

function collapseInventoryRows(inventories: InventoryRow[]): Map<string, CollapsedInventory> {
  const collapsed = new Map<string, CollapsedInventory>();
  for (const row of inventories) {
    const productName = normalizeWhitespace(row.Product);
    if (!productName) {
      addDiagnostic("warning", "blank_inventory_product", "Inventory row skipped because Product is blank.", { barcode: row.Barcode, id: row.Id });
      continue;
    }
    const productKey = comparableName(productName);
    const pkg = parsePackageSize(row["Package Size"]);
    const priceMinorUnits = priceToMinorUnits(row["Product Price"]);
    const collapseKey = [productKey, pkg.label, priceMinorUnits, toBool(row["Is Medical"]) ? "medical" : "adult"].join("|");
    const units = Math.max(0, Math.floor(toNumber(row["Units Available For Sale"]) ?? 0));
    const existing = collapsed.get(collapseKey);
    if (existing) {
      existing.rows.push(row);
      existing.totalUnits += units;
      const incomingTotal = toNumber(row.Total);
      if ((existing.totalRaw === null || existing.totalRaw <= 0) && incomingTotal !== null && incomingTotal > 0) existing.totalRaw = incomingTotal;
    } else {
      collapsed.set(collapseKey, {
        productKey,
        productName,
        rows: [row],
        totalUnits: units,
        package: pkg,
        priceMinorUnits,
        medical: toBool(row["Is Medical"]),
        category: normalizeWhitespace(row.Category),
        inventoryType: normalizeWhitespace(row.InventoryType),
        brand: normalizeWhitespace(row.Brand),
        strain: normalizeWhitespace(row.Strain),
        totalRaw: toNumber(row.Total),
        cbdRaw: toNumber(row.Cbd),
        thcRaw: toNumber(row.Thc),
        cbdaRaw: toNumber(row.Cbda),
        thcaRaw: toNumber(row.Thca),
      });
    }
  }
  for (const item of collapsed.values()) {
    if (item.rows.length > 1) {
      addDiagnostic("info", "inventory_batch_collapse", "Collapsed multiple inventory batches/barcodes into one sellable variant.", {
        product: item.productName,
        package: item.package.label,
        price: item.priceMinorUnits / 100,
        rowsCollapsed: item.rows.length,
        totalUnits: item.totalUnits,
        barcodes: item.rows.map((row) => row.Barcode).filter(Boolean),
      });
    }
  }
  return collapsed;
}

function stripVariantNoise(value: string, brand: string, category: string): string {
  let s = normalizeWhitespace(value);
  const brandComparable = normalizeWhitespace(brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (brandComparable) s = s.replace(new RegExp(`^${brandComparable}\\s*[-:|]?\\s*`, "i"), "");
  s = s
    .replace(/\b\d+(?:\.\d+)?\s*(?:g|gram|grams|mg|milligram|milligrams|oz|ounce|ounces|ml|milliliter|milliliters|fl\.?\s*oz|fluid\s*ounce|fluidounce)\b/gi, " ")
    .replace(/\b(?:single|pack|packs|pouch|jar|tin|unit|each)\b/gi, " ")
    .replace(/\b(?:pre[- ]?rolls?|infused|blunt|flower|cartridge|disposable|vape|rosin|resin|bho|badder|hash|gummies|edible|beverage|shot|topical)\b/gi, " ")
    .replace(/[()\[\]]/g, " ")
    .replace(/\s*[-:|/]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length < 3) s = normalizeWhitespace(value.replace(brand, ""));
  if (!s || s.length < 3) s = normalizeWhitespace(category || value);
  return titleCase(s);
}

function deriveDisplayName(product: ProductRow | undefined, inv: CollapsedInventory, category: GreenwayCategory): { displayName: string; strainName: string } {
  const productStrain = normalizeWhitespace(product?.Strain);
  const invStrain = normalizeWhitespace(inv.strain);
  const strain = firstNonBlank(productStrain, invStrain);
  if (["flower", "preroll", "preroll-pack", "infused-preroll", "infused-preroll-pack", "concentrate", "cartridge", "disposable-cartridge", "trim"].includes(category)) {
    const displayName = strain || stripVariantNoise(firstNonBlank(product?.["Product Name"], inv.productName), firstNonBlank(product?.Brand, inv.brand), inv.category);
    return { displayName, strainName: displayName };
  }
  const displayName = stripVariantNoise(firstNonBlank(product?.["Product Name"], inv.productName), firstNonBlank(product?.Brand, inv.brand), inv.category);
  return { displayName, strainName: strain || displayName };
}

function groupingIdentity(product: ProductRow | undefined, inv: CollapsedInventory, category: GreenwayCategory, displayName: string) {
  const brand = firstNonBlank(product?.Brand, inv.brand, "Greenway");
  const type = category;
  const strainOrFamily = collapseKeyPart(displayName);
  const medicalSplit = inv.medical ? "medical" : "adult";
  return [collapseKeyPart(brand), type, strainOrFamily, medicalSplit].join("|");
}

function buildGroups(products: ProductRow[], inventories: InventoryRow[]) {
  const productMap = productRowsByName(products);
  const collapsedInventory = collapseInventoryRows(inventories);
  const groups = new Map<string, ProductGroup>();
  const matchedProductKeys = new Set<string>();

  for (const inv of collapsedInventory.values()) {
    const matchingRows = productMap.get(inv.productKey) ?? [];
    if (matchingRows.length === 0) {
      addDiagnostic("warning", "inventory_without_product_master", "Inventory item has no Products workbook match; including as hidden menu item for review.", { product: inv.productName, inventoryType: inv.inventoryType, category: inv.category, units: inv.totalUnits });
      const category = categoryWithFallback(inv.category);
      const brand = firstNonBlank(inv.brand, "Greenway");
      const { displayName, strainName } = deriveDisplayName(undefined, inv, category);
      const identity = groupingIdentity(undefined, inv, category, displayName) + "|no-product-master";
      const group: ProductGroup = {
        identityKey: identity,
        brand,
        category,
        posInventoryCategory: inv.category,
        posInventoryType: inv.inventoryType,
        strainType: normalizeStrainType(inv.strain, category),
        strainName,
        displayName,
        productNames: new Set([inv.productName]),
        descriptions: [],
        variants: [inv],
        hidden: true,
        hiddenReason: "no_product_master",
      };
      groups.set(identity, group);
      continue;
    }
    matchedProductKeys.add(inv.productKey);
    const product = matchingRows[0];
    const category = normalizeCategory(firstNonBlank(product.Category, inv.category));
    const brand = firstNonBlank(product.Brand, inv.brand, "Greenway");
    const { displayName, strainName } = deriveDisplayName(product, inv, category);
    const identity = groupingIdentity(product, inv, category, displayName);
    const group = groups.get(identity) ?? {
      identityKey: identity,
      brand,
      category,
      posInventoryCategory: firstNonBlank(product.Category, inv.category),
      posInventoryType: firstNonBlank(product["Inventory Type"], inv.inventoryType),
      strainType: normalizeStrainType(firstNonBlank(product.Type), category),
      strainName,
      displayName,
      productNames: new Set<string>(),
      descriptions: [],
      variants: [],
    };
    group.productNames.add(firstNonBlank(product["Product Name"], inv.productName));
    const desc = normalizeWhitespace(product.Description);
    if (desc) group.descriptions.push(desc);
    group.variants.push(inv);
    groups.set(identity, group);
  }

  for (const [productKey, rows] of productMap) {
    if (!matchedProductKeys.has(productKey)) {
      const product = rows[0];
      addDiagnostic("warning", "product_without_inventory", "Products workbook item has no matching inventory; including as hidden menu item for review.", { product: product["Product Name"], brand: product.Brand, category: product.Category });
      const category = categoryWithFallback(firstNonBlank(product.Category));
      const brand = firstNonBlank(product.Brand, "Greenway");
      const displayName = stripVariantNoise(firstNonBlank(product["Product Name"]), brand, product.Category ?? "");
      const strainName = firstNonBlank(normalizeWhitespace(product.Strain), displayName);
      const identity = groupingIdentity(product, { brand, category: product.Category ?? "", inventoryType: product["Inventory Type"] ?? "", medical: false, strain: strainName, productKey, productName: product["Product Name"] ?? "", rows: [], totalUnits: 0, package: parsePackageSize(product["Package Size"] ?? ""), priceMinorUnits: priceToMinorUnits(product.Price), totalRaw: null, cbdRaw: null, thcRaw: null, cbdaRaw: null, thcaRaw: null } as CollapsedInventory, category, displayName) + "|no-inventory";
      const group: ProductGroup = {
        identityKey: identity,
        brand,
        category,
        posInventoryCategory: firstNonBlank(product.Category),
        posInventoryType: firstNonBlank(product["Inventory Type"]),
        strainType: normalizeStrainType(firstNonBlank(product.Type), category),
        strainName,
        displayName,
        productNames: new Set([firstNonBlank(product["Product Name"])]),
        descriptions: [normalizeWhitespace(product.Description)].filter(Boolean),
        variants: [],
        hidden: true,
        hiddenReason: "no_inventory",
      };
      groups.set(identity, group);
    }
  }
  return [...groups.values()];
}

function mergeVariantDuplicates(group: ProductGroup): CollapsedInventory[] {
  const merged = new Map<string, CollapsedInventory>();
  for (const variant of group.variants) {
    const key = [variant.package.label, variant.priceMinorUnits, variant.medical ? "medical" : "adult"].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.totalUnits += variant.totalUnits;
      existing.rows.push(...variant.rows);
      if ((existing.totalRaw === null || existing.totalRaw <= 0) && variant.totalRaw !== null && variant.totalRaw > 0) existing.totalRaw = variant.totalRaw;
      addDiagnostic("info", "group_variant_merge", "Merged same package/price variant inside grouped product card.", { product: group.displayName, package: variant.package.label, unitsAdded: variant.totalUnits });
    } else {
      merged.set(key, { ...variant, rows: [...variant.rows] });
    }
  }
  return [...merged.values()].sort((a, b) => a.package.sortValue - b.package.sortValue || a.priceMinorUnits - b.priceMinorUnits || a.productName.localeCompare(b.productName));
}

function cannabinoidCompounds(base: CollapsedInventory | undefined): GreenwayCannabinoid[] {
  if (!base || !shouldDisplayThcTotal(base.inventoryType)) return [];
  const compounds: GreenwayCannabinoid[] = [];
  const push = (type: GreenwayCannabinoid["type"], raw: number | null) => {
    if (raw !== null && raw > 0) compounds.push({ type, value: formatNumber(raw, 2), unit: "%" });
  };
  push("thc", base.thcRaw);
  push("thca", base.thcaRaw);
  push("cbd", base.cbdRaw);
  push("cbda", base.cbdaRaw);
  return compounds;
}

function filterCategoriesFor(item: Pick<GreenwayMenuItem, "category" | "posInventoryType">): GreenwayCategory[] {
  const cats = new Set<GreenwayCategory>([item.category]);
  if (["cartridge", "disposable-cartridge"].includes(item.category)) cats.add("concentrate");
  if (["infused-preroll", "infused-preroll-pack", "preroll-pack"].includes(item.category)) cats.add("preroll");
  return [...cats];
}

function toMenuItem(group: ProductGroup): GreenwayMenuItem {
  const variants = mergeVariantDuplicates(group);
  const firstAvailable = variants.find((variant) => variant.totalUnits > 0) ?? variants[0];
  const firstPrice = firstAvailable?.priceMinorUnits ?? 0;
  const itemId = `pos-${stableId(group.identityKey)}`;
  const menuVariants: GreenwayMenuVariant[] = variants.map((variant) => ({
    id: `${itemId}-${stableId(variant.package.label, variant.priceMinorUnits, variant.medical ? "medical" : "adult")}`,
    label: variant.package.label,
    priceMinorUnits: variant.priceMinorUnits,
    inventoryLevel: variant.totalUnits,
    medical: variant.medical,
  }));
  const totalUnits = menuVariants.reduce((sum, variant) => sum + variant.inventoryLevel, 0);
  const thc = thcTotalString(firstAvailable?.totalRaw ?? null, firstAvailable?.inventoryType ?? group.posInventoryType);
  const cbd = cbdString(firstAvailable?.cbdRaw ?? null, firstAvailable?.inventoryType ?? group.posInventoryType);
  const unit: CannabinoidUnit = "%";
  const item: GreenwayMenuItem = {
    id: itemId,
    name: group.displayName,
    productName: [...group.productNames].sort()[0],
    brand: group.brand,
    category: group.category,
    filterCategories: [],
    posInventoryType: group.posInventoryType,
    posInventoryCategory: group.posInventoryCategory,
    strainType: group.strainType,
    strainName: group.strainName,
    thc,
    cbd,
    totalThc: shouldDisplayThcTotal(firstAvailable?.inventoryType ?? group.posInventoryType) ? { type: "thc", value: thc?.replace(/%$/, "") ?? null, unit } : null,
    totalCbd: shouldDisplayThcTotal(firstAvailable?.inventoryType ?? group.posInventoryType) ? { type: "cbd", value: cbd?.replace(/%$/, "") ?? null, unit } : null,
    compounds: cannabinoidCompounds(firstAvailable),
    description: group.descriptions.sort((a, b) => b.length - a.length)[0] ?? genericDescription(group),
    priceLabel: `${formatCurrency(firstPrice)} ${firstAvailable?.package.label ?? "each"}`,
    priceMinorUnits: firstPrice,
    inventoryStatus: statusForInventory(totalUnits),
    hidden: group.hidden,
    hiddenReason: group.hiddenReason,
    variants: menuVariants,
  };
  item.filterCategories = filterCategoriesFor(item);
  return item;
}

function validateMenuItems(items: GreenwayMenuItem[]) {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) addDiagnostic("error", "duplicate_menu_id", "Duplicate generated menu item id.", { id: item.id, name: item.name });
    ids.add(item.id);
    if (!VALID_CATEGORIES.has(item.category)) addDiagnostic("error", "invalid_category", "Generated invalid category.", { item });
    if (!item.name || !item.brand) addDiagnostic("error", "missing_display_fields", "Generated item is missing name or brand.", { item });
    if (!Number.isInteger(item.priceMinorUnits) || item.priceMinorUnits < 0) addDiagnostic("error", "invalid_price", "Generated item has invalid priceMinorUnits.", { item });
    if (item.variants.length === 0) addDiagnostic("warning", "no_variants", "Generated item has no variants.", { item });
    for (const variant of item.variants) {
      if (!Number.isInteger(variant.priceMinorUnits) || variant.priceMinorUnits < 0) addDiagnostic("error", "invalid_variant_price", "Generated variant has invalid price.", { itemId: item.id, variant });
      if (!Number.isInteger(variant.inventoryLevel) || variant.inventoryLevel < 0) addDiagnostic("error", "invalid_variant_inventory", "Generated variant has invalid inventory level.", { itemId: item.id, variant });
    }
  }
}

function writeJson(filePath: string, data: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

type ReviewRow = {
  itemId: string;
  name: string;
  brand: string;
  category: string;
  posInventoryType: string;
  posInventoryCategory: string;
  strainType: string;
  strainName: string;
  hiddenReason: string;
  variantCount: number;
  totalInventoryUnits: number;
  productNames: string;
  priceLabel: string;
  priceMinorUnits: number;
  thc: string | null;
  cbd: string | null;
  variantLabels: string;
};

function writeReviewSpreadsheet(items: GreenwayMenuItem[], filePath: string) {
  const hiddenItems = items.filter((item) => item.hidden);
  if (hiddenItems.length === 0) {
    console.log("No hidden items to write to review spreadsheet.");
    return;
  }
  const rows: ReviewRow[] = hiddenItems.map((item) => ({
    itemId: item.id,
    name: item.name,
    brand: item.brand,
    category: item.category,
    posInventoryType: item.posInventoryType ?? "",
    posInventoryCategory: item.posInventoryCategory ?? "",
    strainType: item.strainType,
    strainName: item.strainName ?? "",
    hiddenReason: item.hiddenReason ?? "unknown",
    variantCount: item.variants.length,
    totalInventoryUnits: item.variants.reduce((sum, v) => sum + v.inventoryLevel, 0),
    productNames: item.productName ?? "",
    priceLabel: item.priceLabel,
    priceMinorUnits: item.priceMinorUnits,
    thc: item.thc,
    cbd: item.cbd,
    variantLabels: item.variants.map((v) => `${v.label} @ ${formatCurrency(v.priceMinorUnits)}${v.medical ? " (med)" : ""}`).join("; "),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 18 }, { wch: 40 }, { wch: 20 }, { wch: 16 }, { wch: 28 }, { wch: 20 },
    { wch: 10 }, { wch: 24 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 30 },
    { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 60 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hidden Items Review");
  XLSX.writeFile(wb, filePath);
  console.log(`Wrote ${rows.length} hidden items to review spreadsheet: ${path.relative(ROOT, filePath)}`);
}

function summary(products: ProductRow[], inventories: InventoryRow[], groups: ProductGroup[], items: GreenwayMenuItem[]) {
  const duplicateCollapseCount = diagnostics.filter((d) => d.code === "inventory_batch_collapse").length;
  const groupedVariantCards = items.filter((item) => item.variants.length > 1).length;
  const categoryCounts = items.reduce<Record<string, number>>((acc, item) => { acc[item.category] = (acc[item.category] ?? 0) + 1; return acc; }, {});
  return {
    generatedAt: new Date().toISOString(),
    sourceRows: { products: products.length, inventories: inventories.length },
    output: { menuItems: items.length, variants: items.reduce((sum, item) => sum + item.variants.length, 0), groupedVariantCards, categoryCounts, hiddenItems: items.filter((i) => i.hidden).length, hiddenReasons: items.filter((i) => i.hidden).reduce<Record<string, number>>((acc, i) => { const r = i.hiddenReason ?? "unknown"; acc[r] = (acc[r] ?? 0) + 1; return acc; }, {}) },
    diagnostics: {
      total: diagnostics.length,
      errors: diagnostics.filter((d) => d.severity === "error").length,
      warnings: diagnostics.filter((d) => d.severity === "warning").length,
      info: diagnostics.filter((d) => d.severity === "info").length,
      duplicateCollapseEvents: duplicateCollapseCount,
    },
    grouping: {
      rawInventoryRows: inventories.length,
      productGroups: groups.length,
      estimatedProductReductionFromInventoryRows: inventories.length - items.length,
    },
  };
}

function main() {
  ensureDir(GENERATED_DIR);
  const products = readWorkbookRows(PRODUCTS_PATH, "Sheet1");
  const inventories = readWorkbookRows(INVENTORIES_PATH, "Inventories");
  requireColumns(products, ["Product Name", "Inventory Type", "Category", "Brand", "Type", "Strain", "UOM", "Package Size", "Price", "Description"], "PRODUCTS.xlsx");
  requireColumns(inventories, ["Product", "Category", "InventoryType", "Strain", "Brand", "Product Price", "Units Available For Sale", "Package Size", "Is Medical", "Cbd", "Cbda", "Thc", "Thca", "Total"], "INVENTORIES.xlsx");

  const allCategories = new Set([...products.map((row) => normalizeWhitespace(row.Category)).filter(Boolean), ...inventories.map((row) => normalizeWhitespace(row.Category)).filter(Boolean)]);
  for (const category of allCategories) normalizeCategory(category);

  const groups = buildGroups(products, inventories);
  const items = groups.map(toMenuItem).sort((a, b) => a.category.localeCompare(b.category) || a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
  validateMenuItems(items);
  const errors = diagnostics.filter((d) => d.severity === "error");
  writeJson(path.join(GENERATED_DIR, "anomaly-report.json"), diagnostics);
  writeJson(path.join(GENERATED_DIR, "transform-summary.json"), summary(products, inventories, groups, items));
  writeReviewSpreadsheet(items, path.join(GENERATED_DIR, "hidden-items-review.xlsx"));
  if (errors.length > 0) {
    console.error(`Transformer found ${errors.length} error(s). See pos-data/generated/anomaly-report.json.`);
    process.exit(1);
  }
  writeJson(OUT_FULL, items);
  writeJson(OUT_SAMPLE, items.slice(0, 60));
  const hiddenCount = items.filter((i) => i.hidden).length;
  console.log(`Generated ${items.length} menu items with ${items.reduce((sum, item) => sum + item.variants.length, 0)} variants (${hiddenCount} hidden).`);
  console.log(`Diagnostics: ${diagnostics.length} total (${diagnostics.filter((d) => d.severity === "warning").length} warnings, ${diagnostics.filter((d) => d.severity === "info").length} info).`);
}

main();
