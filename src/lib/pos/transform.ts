/**
 * src/lib/pos/transform.ts
 *
 * Reusable, filesystem-free POS transform pipeline.
 *
 * This is the SINGLE SOURCE OF TRUTH for turning Cultivera/POS workbook exports
 * (PRODUCTS.xlsx + INVENTORIES.xlsx) into Greenway menu items. It is intentionally
 * free of all `fs`/`path` I/O so the EXACT same transform runs in two places:
 *
 *   1. The CLI build script (scripts/pos/transform_pos_data.ts) — reads files,
 *      calls transformWorkbooks(), writes JSON to src/data + diagnostics.
 *   2. The Supabase-backed admin import flow (Slice 2) — reads uploaded buffers
 *      from private storage, calls transformWorkbooks(), stages a menu_version.
 *
 * Behaviour is identical to the legacy in-script transformer; the only change is
 * that inputs are in-memory Buffers and outputs are returned as a structured
 * object instead of being written to disk. Module-level diagnostic state is reset
 * at the top of every transformWorkbooks() call. The pipeline is fully synchronous
 * (no await), so this reset is safe under Node's single-threaded event loop.
 */
import crypto from "node:crypto";
import * as XLSX from "xlsx";

type GreenwayCategory =
  | "flower" | "popcorn-bud" | "infused-flower" | "blunt" | "infused-blunt" | "tincture" | "rso" | "paraphernalia" | "preroll-pack" | "cartridge" | "disposable-cartridge"
  | "edible-solid" | "concentrate" | "infused-preroll" | "infused-preroll-pack"
  | "preroll" | "edible-liquid" | "topical" | "trim";

// Kept in sync with GreenwayStrainType in src/lib/leafly/types.ts. This module
// is intentionally standalone (fs-free, runs in the CLI too), so the union is
// duplicated rather than imported. "indica-hybrid"/"sativa-hybrid" are the
// website/back-office leaning-hybrid designations (CCRS still collapses them to
// Hybrid via its own normalizer — see ccrs-batch-core.ts, untouched).
type GreenwayStrainType =
  | "indica"
  | "sativa"
  | "hybrid"
  | "indica-hybrid"
  | "sativa-hybrid"
  | "cbd"
  | "unknown";
type InventoryStatus = "mock" | "in-stock" | "low-stock" | "unavailable";
type CannabinoidUnit = "%" | "mg";

type GreenwayCannabinoid = { type: "thc" | "thca" | "cbd" | "cbda" | "cbg" | "cbn" | "cbdv"; value: string | null; unit: CannabinoidUnit };
type GreenwayMenuVariant = { id: string; label: string; priceMinorUnits: number; inventoryLevel: number; medical: boolean };
type GreenwayMenuItem = {
  id: string;
  name: string;
  productName?: string;
  brand: string;
  vendor?: string;
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
  vendor: string;
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
// Module-level transform state. Reset at the top of every transformWorkbooks()
// call. The pipeline is fully synchronous, so this is event-loop safe.
let diagnostics: Diagnostic[] = [];
function addDiagnostic(severity: Severity, code: string, message: string, context?: Record<string, unknown>) {
  diagnostics.push({ severity, code, message, context });
}

const VALID_CATEGORIES = new Set<GreenwayCategory>([
  "flower", "popcorn-bud", "infused-flower", "blunt", "infused-blunt", "tincture", "rso", "paraphernalia", "preroll-pack", "cartridge", "disposable-cartridge", "edible-solid", "concentrate", "infused-preroll", "infused-preroll-pack", "preroll", "edible-liquid", "topical", "trim",
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
  "Moon Rocks": "infused-flower",
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
  "Popcorn Bud": "popcorn-bud",
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
  "Mix Infused Flower": "infused-flower",
  "Live Resin Cartridge": "cartridge",
  "Pod": "cartridge",
  "Other Liquid Edible": "edible-liquid",
};

const STRAIN_MAP: Record<string, GreenwayStrainType> = {
  "indica": "indica",
  "sativa": "sativa",
  "hybrid": "hybrid",
  "cbd": "cbd",
  // Leaning-hybrid spellings the POS/data may present. "indica dominant" (and
  // the explicit leaning/hybrid spellings) now map to the leaning-hybrid
  // designation so customers can see which way a hybrid leans.
  "indica dominant": "indica-hybrid",
  "sativa dominant": "sativa-hybrid",
  "indica dominant hybrid": "indica-hybrid",
  "sativa dominant hybrid": "sativa-hybrid",
  "indica leaning hybrid": "indica-hybrid",
  "sativa leaning hybrid": "sativa-hybrid",
  "indica-leaning hybrid": "indica-hybrid",
  "sativa-leaning hybrid": "sativa-hybrid",
  "indica hybrid": "indica-hybrid",
  "sativa hybrid": "sativa-hybrid",
  "indica-hybrid": "indica-hybrid",
  "sativa-hybrid": "sativa-hybrid",
  "50/50 hybrid": "hybrid",
};

const THC_TOTAL_ALLOWED_TYPES = new Set(["Concentrate for Inhalation", "Usable Marijuana", "Solid Edible", "Liquid Edible", "Tincture"]);
const MG_CANNABINOID_TYPES = new Set(["Solid Edible", "Liquid Edible", "Tincture"]);

// --- Bug 3: sanity caps on cannabinoid values ---------------------------------------------
// Percent-based values (flower, concentrate, cartridge, etc.) can never exceed 100%. mg-based
// values (edibles/tinctures) get a generous-but-finite ceiling per form so that corrupt source
// rows (e.g. a tincture whose Total column reads 15,000,000) cannot render an absurd potency.
// Ceilings are derived from observed maxima in the raw INVENTORIES Total column plus headroom:
//   Solid Edible observed max 600mg, Liquid Edible 230mg, Tincture legit ~500mg.
const CANNABINOID_PERCENT_CAP = 100;
const CANNABINOID_MG_CAP: Record<string, number> = {
  "Solid Edible": 2000,
  "Liquid Edible": 1000,
  "Tincture": 5000,
};
const DEFAULT_CANNABINOID_MG_CAP = 5000;

// --- Section G: THC/CBD average fallback table --------------------------------------------
// When a product has no usable THC/CBD value in its source columns, we display a category-level
// AVERAGE so every product card shows a value. Averages blend the raw-spreadsheet medians (from
// the INVENTORIES Total column) with public dispensary/lab potency research:
//   * Frontiers 2024 (ElSohly et al.): dispensary flower ~20-25% THC (we use 22%).
//   * Kootenay Botanicals / industry: vape carts ~80-85%, concentrates ~85-90%, flower 15-30%.
//   * Raw INVENTORIES Total medians: Usable Marijuana 23.7%, Concentrate 74.2%, Liquid Edible
//     100mg, Solid Edible 10mg.
// Values are intentionally approximate; batch-to-batch variance makes an average fair. Every
// fallback application is logged via the "cannabinoid_average_fallback" diagnostic for audit.
const THC_FALLBACK_BY_CATEGORY: Partial<Record<GreenwayCategory, number>> = {
  "flower": 22,
  "popcorn-bud": 20,
  "infused-flower": 35,
  "preroll": 22,
  "infused-preroll": 35,
  "blunt": 22,
  "infused-blunt": 35,
  "trim": 15,
  "concentrate": 80,
  "rso": 75,
  "cartridge": 85,
  "disposable-cartridge": 85,
  "edible-solid": 10,
  "edible-liquid": 100,
  "tincture": 300,
};
const CBD_FALLBACK_BY_CATEGORY: Partial<Record<GreenwayCategory, number>> = {
  // Most products are THC-dominant; CBD averages are intentionally low. Edible/tincture CBD is
  // left to source data (no blanket mg fallback) since CBD content varies wildly by SKU.
  "flower": 0.5,
  "popcorn-bud": 0.5,
  "infused-flower": 0.5,
  "preroll": 0.5,
  "infused-preroll": 0.5,
  "blunt": 0.5,
  "infused-blunt": 0.5,
  "trim": 0.5,
  "concentrate": 1,
  "rso": 1,
  "cartridge": 1,
  "disposable-cartridge": 1,
};

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

function requireColumns(rows: Row[], columns: string[], workbookName: string) {
  const actual = new Set(rows.flatMap((row) => Object.keys(row)));
  const missing = columns.filter((col) => !actual.has(col));
  if (missing.length > 0) {
    addDiagnostic("error", "missing_columns", `${workbookName} is missing required columns.`, { missing, actual: [...actual] });
    throw new Error(`${workbookName} missing required columns: ${missing.join(", ")}`);
  }
}

// Tracks categories already flagged so we emit exactly one anomaly per new/unknown category.
let flaggedNewCategories = new Set<string>();

// Section F: industry-standard handling for a previously-unseen POS category. Rather than crash
// the entire build for a single new spreadsheet value, we (1) flag it once as a clearly-visible
// anomaly in the generated report and (2) route it to the best-guess fallback category so the
// menu still builds. Operators review the flagged anomaly and add an explicit CATEGORY_MAP entry.
function flagNewCategory(category: string, where: string): GreenwayCategory {
  const key = normalizeWhitespace(category);
  const lowered = key.toLowerCase();
  let fallback: GreenwayCategory = "concentrate";
  for (const [keyword, cat] of Object.entries(CATEGORY_FALLBACK)) {
    if (lowered.includes(keyword)) { fallback = cat; break; }
  }
  if (!flaggedNewCategories.has(key)) {
    flaggedNewCategories.add(key);
    addDiagnostic("warning", "new_unmapped_category", `New/unmapped POS category encountered: "${key}". Routed to fallback "${fallback}". Add an explicit CATEGORY_MAP entry to control its placement.`, {
      category: key, fallbackCategory: fallback, source: where,
    });
  }
  return fallback;
}

function normalizeCategory(category: string): GreenwayCategory {
  const exact = CATEGORY_MAP[normalizeWhitespace(category)];
  if (exact) return exact;
  return flagNewCategory(category, "visible-product");
}

function tryNormalizeCategory(category: string): GreenwayCategory | null {
  const exact = CATEGORY_MAP[normalizeWhitespace(category)];
  if (exact) return exact;
  addDiagnostic("warning", "unmapped_category_fallback", `Unmapped POS category for hidden item, using fallback: ${category}`, { category });
  return null;
}

const CATEGORY_FALLBACK: Record<string, GreenwayCategory> = {
  "flower": "flower", "popcorn": "popcorn-bud", "infused-flower": "infused-flower",
  "preroll": "preroll", "cartridge": "cartridge", "concentrate": "concentrate",
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

/**
 * Detect popcorn bud from product name keywords.
 * Popcorn bud is a distinct product tier (small/budget buds) that should be
 * separated from regular premium flower. The POS Category column often says
 * "Flower" for these products, but the product name contains keywords that
 * identify them as budget/small-bud tier.
 *
 * Keywords detected:
 * - "popcorn", "popcorn bud", "popcorn flower" — standard popcorn bud naming
 * - "bong buddies", "b-bud", "b bud" — Phat Panda and Ooowee small-bud lines
 * - "littles" — Heavenly Buds "Little Snappers" flower items
 * - "snappers" — Heavenly Buds and High Tide budget flower lines
 * - "small bud", "small buds" — Skord and other budget flower lines
 *
 * IMPORTANT: Only detects on flower-category items. Preroll and infused-preroll
 * products with these keywords (e.g., "Little Snappers" prerolls) are NOT
 * reclassified — they remain in their POS-assigned category.
 */
const POPCORN_KEYWORDS = /\b(popcorn\s*(?:bud|flower)?|bong\s*buddies|b[- ]?buds?\b|littles|snappers|small\s*buds?)\b/i;

function detectPopcornBud(productName: string, currentCategory: GreenwayCategory): GreenwayCategory {
  if (currentCategory !== "flower") return currentCategory;
  if (POPCORN_KEYWORDS.test(normalizeWhitespace(productName))) {
    return "popcorn-bud";
  }
  return currentCategory;
}

/**
 * Detect infused flower from product name keywords.
 * Infused flower products (moon rocks, caviar, THC Iceberg, etc.) are flower
 * buds that have been coated or mixed with concentrate. They should be
 * separated from both regular flower AND concentrate into their own category.
 *
 * The POS system sometimes categorizes these as "Flower" or "Moon Rocks" or
 * "Mix Infused Flower". The CATEGORY_MAP handles Moon Rocks and Mix Infused
 * Flower directly. This function catches products whose POS Category says
 * "Flower" but whose name clearly identifies them as infused flower.
 *
 * Keywords detected:
 * - "iceberg" — Suspended "THC Iceberg" infused flower line
 * - "moon rock", "moon rocks" — general infused flower naming
 * - "caviar" — infused flower naming
 * - "infused flower" — Walden and other brand naming
 *
 * Only detects on flower-category items. Concentrate-category items with these
 * keywords in their name (which are already correctly mapped via CATEGORY_MAP)
 * are left unchanged.
 */
const INFUSED_FLOWER_KEYWORDS = /\b(iceberg|moon\s*rocks?|caviar|infused\s*flower)\b/i;

function detectInfusedFlower(productName: string, currentCategory: GreenwayCategory): GreenwayCategory {
  if (currentCategory !== "flower") return currentCategory;
  if (INFUSED_FLOWER_KEYWORDS.test(normalizeWhitespace(productName))) {
    return "infused-flower";
  }
  return currentCategory;
}

function normalizeStrainType(value: string, category: GreenwayCategory): GreenwayStrainType {
  if (["topical", "paraphernalia"].includes(category)) return "unknown";
  const key = comparableName(value);
  const mapped = STRAIN_MAP[key];
  if (mapped) return mapped;

  // Smart fallback for spellings not in the flat map (e.g. odd punctuation).
  // Mirrors canonicalStrainType() in src/lib/menu/strain-taxonomy.ts but kept
  // local so this transform stays standalone (fs-free, CLI-safe).
  const s = key.replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
  if (s) {
    const hasIndica = s.includes("indica");
    const hasSativa = s.includes("sativa");
    const hasHybrid = s.includes("hybrid") || s.includes("leaning") || s.includes("lean") || s.includes("dominant");
    if (hasHybrid) {
      if (hasIndica && !hasSativa) return "indica-hybrid";
      if (hasSativa && !hasIndica) return "sativa-hybrid";
      return "hybrid";
    }
    if (hasIndica && !hasSativa) return "indica";
    if (hasSativa && !hasIndica) return "sativa";
    if (s.includes("cbd")) return "cbd";
  }

  addDiagnostic("warning", "unknown_strain_type", `Unknown strain type '${value}', defaulting to unknown.`, { value, category });
  return "unknown";
}

function parsePackageSize(rawPackage: string, fallbackSize?: string, fallbackUnit?: string): ParsedPackage {
  const raw = firstNonBlank(rawPackage, [fallbackSize, fallbackUnit].filter(Boolean).join(" "));
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*([a-zA-Z ]+)?/);
  const quantity = match ? Number(match[1]) : 1;
  const unitRaw = normalizeWhitespace(match?.[2] ?? fallbackUnit ?? "each").toLowerCase();
  let unit = unitRaw
    .replace(/fluid\s*ounces?|fluidounce|fl\.?\s*oz/, "floz")
    .replace(/milligrams?/, "mg")
    .replace(/milliliters?/, "ml")
    .replace(/grams?/, "g")
    .replace(/ounces?/, "oz")
    .replace(/each|units?/, "ea");
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

function packageFromParts(quantity: number, unit: string, raw: string): ParsedPackage {
  const normalizedUnit = unit.toLowerCase()
    .replace(/fluid\s*ounces?|fluidounce|fl\.?\s*oz/, "oz")
    .replace(/milligrams?/, "mg")
    .replace(/milliliters?/, "ml")
    .replace(/grams?/, "g")
    .replace(/ounces?/, "oz")
    .replace(/packs?|pk/, "pk");
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const label = normalizedUnit === "pk" ? `${formatNumber(safeQuantity)}pk` : `${formatNumber(safeQuantity)}${normalizedUnit}`;
  const gramsEquivalent = normalizedUnit === "g" ? safeQuantity : normalizedUnit === "oz" ? safeQuantity * 28 : undefined;
  const sortUnitWeight = normalizedUnit === "mg" ? 0.001 : normalizedUnit === "g" ? 1 : normalizedUnit === "oz" ? 28 : normalizedUnit === "ml" ? 0.01 : normalizedUnit === "pk" ? 100 : 10000;
  return { quantity: safeQuantity, unit: normalizedUnit, gramsEquivalent, label, sortValue: safeQuantity * sortUnitWeight, raw };
}

// InventoryType is the authoritative signal for whether a product is an edible/liquid/tincture
// whose name may legitimately encode package size. Driving eligibility off InventoryType (rather
// than the free-text Category column) prevents non-edible products that happen to land in an
// edible-sounding category (e.g. "Panda Candies" rows that are actually Usable Marijuana
// pre-rolls, or "Edible" rows that are Usable Marijuana) from having their real weight/pack
// overwritten by a name-derived value. (Bug 2)
const NAME_PACKAGE_ELIGIBLE_TYPES = new Set(["Solid Edible", "Liquid Edible", "Tincture"]);

// Units that represent a real physical package measurement (volume or weight). A bare "mg"
// figure in a product name is almost always a POTENCY/dose, not a package size, so it must
// never outrank one of these. (Bug 1)
const REAL_MEASURE_UNITS = new Set(["g", "oz", "floz", "ml"]);

type NamePackageCandidate = { pkg: ParsedPackage; source: "volume" | "pack" | "dosePack" | "parentheticalWeight" | "weight" | "potency" };

function packageCandidateFromProductName(productName: string, category: string, inventoryType: string): NamePackageCandidate | null {
  const name = normalizeWhitespace(productName);
  if (!name) return null;
  const rawType = normalizeWhitespace(inventoryType);
  // Authoritative eligibility: only true edibles/liquids/tinctures (by InventoryType). This
  // excludes Usable Marijuana, Concentrate for Inhalation (incl. RSO), and Topical Ointment,
  // all of which carry a correct weight/volume in the Package Size column already.
  if (!NAME_PACKAGE_ELIGIBLE_TYPES.has(rawType)) return null;

  // PRIORITY ORDER (Bug 1): real volume/weight first, packs next, and bare mg potency LAST.
  // A volume measurement always wins over a dose, regardless of edible form.
  const volume = name.match(/\b(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|fluid\s*ounces?|fluidounce|oz|ml|milliliters?)\b/i);
  if (volume && (rawType !== "Solid Edible" || /\b(?:drink|beverage|lemonade|shot|soda|can|tincture|drops?|sorbet)\b/i.test(name))) {
    return { pkg: packageFromParts(Number(volume[1]), volume[2], volume[0]), source: "volume" };
  }

  const pack = name.match(/\b(\d+)\s*(?:pk|pack|packs)\b/i);
  if (pack) return { pkg: packageFromParts(Number(pack[1]), "pk", pack[0]), source: "pack" };

  const dosePack = name.match(/\b(\d+)\s*x\s*\d+(?:\.\d+)?\s*mg\b/i);
  if (dosePack) return { pkg: packageFromParts(Number(dosePack[1]), "pk", dosePack[0]), source: "dosePack" };

  const parentheticalWeight = name.match(/\((\d+(?:\.\d+)?)\s*(g|grams?|oz|ounces?|ml|milliliters?)\)/i);
  if (parentheticalWeight) return { pkg: packageFromParts(Number(parentheticalWeight[1]), parentheticalWeight[2], parentheticalWeight[0]), source: "parentheticalWeight" };

  const weight = name.match(/\b(\d+(?:\.\d+)?)\s*(g|grams?)\b/i);
  if (weight && !/\bmg\b/i.test(weight[0])) return { pkg: packageFromParts(Number(weight[1]), weight[2], weight[0]), source: "weight" };

  // Bare mg potency: lowest-priority signal. Only meaningful when nothing better exists AND the
  // Package Size column has no real measurement (handled in validatedPackageSize).
  const potency = name.match(/\b(\d+(?:\.\d+)?)\s*mg\b/i);
  if (potency) return { pkg: packageFromParts(Number(potency[1]), "mg", potency[0]), source: "potency" };

  return null;
}

function validatedPackageSize(productName: string, rawPackage: string, category: string, inventoryType: string): ParsedPackage {
  const packageColumn = parsePackageSize(rawPackage);
  const candidate = packageCandidateFromProductName(productName, category, inventoryType);
  if (!candidate) return packageColumn;
  const fromName = candidate.pkg;
  if (fromName.label === packageColumn.label) return packageColumn;

  const columnHasRealMeasure = REAL_MEASURE_UNITS.has(packageColumn.unit);

  // Bug 1: a name-derived bare-mg potency must NEVER override a Package Size column that already
  // carries a real physical measurement (fl oz / ml / oz / g). The column wins.
  if (candidate.source === "potency" && columnHasRealMeasure) {
    addDiagnostic("info", "package_size_potency_rejected", "Rejected name-derived mg potency as package size; kept real measured Package Size column value.", {
      productName,
      rawCategory: category,
      inventoryType,
      packageColumn: packageColumn.label,
      rejectedName: fromName.label,
      rawPackage,
      nameMatch: fromName.raw,
    });
    return packageColumn;
  }

  // For any other source where the column already has a real measurement, only let the name win
  // when it adds genuinely package-relevant information the column lacks: a multi-pack count
  // (pack/dosePack) the column does not express. Real volume/weight from the column is otherwise
  // the source of truth.
  if (columnHasRealMeasure && candidate.source !== "pack" && candidate.source !== "dosePack") {
    // Name found a different real measure than the column (rare). Trust the column to avoid
    // double-counting; log for review.
    if (candidate.source === "volume" || candidate.source === "weight" || candidate.source === "parentheticalWeight") {
      addDiagnostic("info", "package_size_measure_conflict", "Name and Package Size column both encode a measurement; kept Package Size column value.", {
        productName,
        rawCategory: category,
        inventoryType,
        packageColumn: packageColumn.label,
        nameValue: fromName.label,
        rawPackage,
      });
      return packageColumn;
    }
  }

  // Otherwise the name is the better source of truth (column was blank / "each" / unitless, or the
  // name expresses a pack count). Use the name value.
  addDiagnostic("info", "package_size_name_override", "Product-name package size used as source of truth over Package Size column for edible/liquid/tincture item.", {
    productName,
    rawCategory: category,
    inventoryType,
    packageColumn: packageColumn.label,
    packageName: fromName.label,
    source: candidate.source,
    rawPackage,
    nameMatch: fromName.raw,
  });
  return fromName;
}

function statusForInventory(level: number): Exclude<InventoryStatus, "mock"> {
  if (level <= 0) return "unavailable";
  if (level <= 3) return "low-stock";
  return "in-stock";
}

function genericDescription(group: ProductGroup) { return `${group.displayName} from ${group.brand}. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.`; }

function shouldDisplayThcTotal(inventoryType: string) { return THC_TOTAL_ALLOWED_TYPES.has(normalizeWhitespace(inventoryType)); }
function cannabinoidUnitForInventoryType(inventoryType: string): CannabinoidUnit {
  return MG_CANNABINOID_TYPES.has(normalizeWhitespace(inventoryType)) ? "mg" : "%";
}
// Apply the Bug 3 sanity cap to a single cannabinoid figure. Returns the (possibly clamped)
// value and whether a cap was applied. mg ceilings are per inventory type; percent is hard 100.
function capCannabinoidValue(raw: number, inventoryType: string): { value: number; capped: boolean } {
  const unit = cannabinoidUnitForInventoryType(inventoryType);
  if (unit === "%") {
    if (raw > CANNABINOID_PERCENT_CAP) return { value: CANNABINOID_PERCENT_CAP, capped: true };
    return { value: raw, capped: false };
  }
  const ceiling = CANNABINOID_MG_CAP[normalizeWhitespace(inventoryType)] ?? DEFAULT_CANNABINOID_MG_CAP;
  if (raw > ceiling) return { value: ceiling, capped: true };
  return { value: raw, capped: false };
}

type CannabinoidResolution = { display: string | null; rawUsed: number | null; fallback: boolean };

// Resolve a cannabinoid display value with Bug 3 capping and Section G average fallback.
//   primaryRaw  : the value normally displayed (THC: Total column; CBD: Cbd column)
//   siblingRaw  : a sane alternative from a sibling column (e.g. the Thc column) used when the
//                 primary value is corrupt/over the cap. Optional.
//   fallbackAvg : category-level average to use when no usable source value exists. Optional.
function resolveCannabinoid(
  primaryRaw: number | null,
  inventoryType: string,
  opts: { siblingRaw?: number | null; fallbackAvg?: number; kind: "thc" | "cbd"; productName?: string; category?: string },
): CannabinoidResolution {
  if (!shouldDisplayThcTotal(inventoryType)) return { display: null, rawUsed: null, fallback: false };
  const unit = cannabinoidUnitForInventoryType(inventoryType);

  // 1) Try the primary value, capping absurd figures (Bug 3).
  if (primaryRaw !== null && primaryRaw > 0) {
    const { value, capped } = capCannabinoidValue(primaryRaw, inventoryType);
    if (capped) {
      // The primary value was garbage. Prefer a sane sibling column value if available before
      // resorting to the clamp/average, so corruption in one column doesn't degrade display.
      const sibling = opts.siblingRaw ?? null;
      if (sibling !== null && sibling > 0) {
        const sib = capCannabinoidValue(sibling, inventoryType);
        if (!sib.capped) {
          addDiagnostic("warning", "cannabinoid_value_capped", "Primary cannabinoid value exceeded sanity cap; substituted sane sibling column value.", {
            productName: opts.productName, category: opts.category, inventoryType, kind: opts.kind, rejected: primaryRaw, used: sib.value,
          });
          return { display: `${formatNumber(sib.value, 2)}${unit}`, rawUsed: sib.value, fallback: false };
        }
      }
      addDiagnostic("warning", "cannabinoid_value_capped", "Cannabinoid value exceeded sanity cap and was clamped.", {
        productName: opts.productName, category: opts.category, inventoryType, kind: opts.kind, original: primaryRaw, clamped: value,
      });
    }
    return { display: `${formatNumber(value, 2)}${unit}`, rawUsed: value, fallback: false };
  }

  // 2) No usable primary value — try a sane sibling column.
  if (opts.siblingRaw !== null && opts.siblingRaw !== undefined && opts.siblingRaw > 0) {
    const sib = capCannabinoidValue(opts.siblingRaw, inventoryType);
    return { display: `${formatNumber(sib.value, 2)}${unit}`, rawUsed: sib.value, fallback: false };
  }

  // 3) Section G: category-level average fallback so the card never shows "N/A" where we have one.
  if (opts.fallbackAvg !== undefined && opts.fallbackAvg > 0) {
    addDiagnostic("info", "cannabinoid_average_fallback", "No source cannabinoid value; applied category-average fallback for display.", {
      productName: opts.productName, category: opts.category, inventoryType, kind: opts.kind, fallback: opts.fallbackAvg, unit,
    });
    return { display: `~${formatNumber(opts.fallbackAvg, 2)}${unit}`, rawUsed: opts.fallbackAvg, fallback: true };
  }

  return { display: "N/A", rawUsed: null, fallback: false };
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
    const pkg = validatedPackageSize(productName, row["Package Size"], row.Category, row.InventoryType);
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
        vendor: normalizeWhitespace(row.Vendor),
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
  // Section E: convert underscores to spaces up front so machine-style names like
  // "Bite_ind_peanut_butter_chip_1:1_10pk" or "Chew_sat_..." read as normal words. Done before
  // brand stripping and tokenization so the rest of the pipeline sees clean word boundaries; the
  // colon in ratios like "1:1" is preserved because only underscores are touched here.
  let s = normalizeWhitespace(value).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const brandComparable = normalizeWhitespace(brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (brandComparable) s = s.replace(new RegExp(`^${brandComparable}\\s*[-:|]?\\s*`, "i"), "");
  s = s
    .replace(/\b\d+(?:\.\d+)?\s*(?:g|gram|grams|mg|milligram|milligrams|oz|ounce|ounces|ml|milliliter|milliliters|fl\.?\s*oz|fluid\s*ounce|fluidounce)\b/gi, " ")
    .replace(/\b(?:single|pack|packs|pouch|jar|tin|unit|each)\b/gi, " ")
    .replace(/\b(?:pre[- ]?rolls?|infused|blunt|flower|cartridge|disposable|vape|rosin|resin|bho|badder|hash|gummies|edible|beverage|shot|topical)\b/gi, " ")
    .replace(/[()\[\]]/g, " ")
    .replace(/\s*[-|/]\s*/g, " ")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length < 3) s = normalizeWhitespace(value.replace(brand, ""));
  if (!s || s.length < 3) s = normalizeWhitespace(category || value);
  return titleCase(s);
}

function deriveDisplayName(product: ProductRow | undefined, inv: CollapsedInventory, category: GreenwayCategory): { displayName: string; strainName: string } {
  // Section E: normalize underscores in raw strain values too (some POS strains arrive as
  // "Blue_Dream"); convert to spaces so flower/concentrate display names are clean.
  const productStrain = normalizeWhitespace(product?.Strain).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const invStrain = normalizeWhitespace(inv.strain).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const strain = firstNonBlank(productStrain, invStrain);
  if (["flower", "popcorn-bud", "infused-flower", "preroll", "preroll-pack", "infused-preroll", "infused-preroll-pack", "concentrate", "cartridge", "disposable-cartridge", "trim"].includes(category)) {
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
      const rawCategory = categoryWithFallback(inv.category);
      const afterPopcorn = detectPopcornBud(inv.productName, rawCategory);
      const category = detectInfusedFlower(inv.productName, afterPopcorn);
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
    const rawCategory = normalizeCategory(firstNonBlank(product.Category, inv.category));
    const afterPopcorn = detectPopcornBud(firstNonBlank(product["Product Name"], inv.productName), rawCategory);
    const category = detectInfusedFlower(firstNonBlank(product["Product Name"], inv.productName), afterPopcorn);
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
      const rawCategory = categoryWithFallback(firstNonBlank(product.Category));
      const afterPopcorn = detectPopcornBud(firstNonBlank(product["Product Name"]), rawCategory);
      const category = detectInfusedFlower(firstNonBlank(product["Product Name"]), afterPopcorn);
      const brand = firstNonBlank(product.Brand, "Greenway");
      const displayName = stripVariantNoise(firstNonBlank(product["Product Name"]), brand, product.Category ?? "");
      const strainName = firstNonBlank(normalizeWhitespace(product.Strain), displayName);
      const identity = groupingIdentity(product, { brand, vendor: "", category: product.Category ?? "", inventoryType: product["Inventory Type"] ?? "", medical: false, strain: strainName, productKey, productName: product["Product Name"] ?? "", rows: [], totalUnits: 0, package: parsePackageSize(product["Package Size"] ?? ""), priceMinorUnits: priceToMinorUnits(product.Price), totalRaw: null, cbdRaw: null, thcRaw: null, cbdaRaw: null, thcaRaw: null } as CollapsedInventory, category, displayName) + "|no-inventory";
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
  const unit = cannabinoidUnitForInventoryType(base.inventoryType);
  const push = (type: GreenwayCannabinoid["type"], raw: number | null) => {
    if (raw !== null && raw > 0) compounds.push({ type, value: formatNumber(raw, 2), unit });
  };
  push("thc", base.thcRaw);
  push("thca", base.thcaRaw);
  push("cbd", base.cbdRaw);
  push("cbda", base.cbdaRaw);
  return compounds;
}

function filterCategoriesFor(item: Pick<GreenwayMenuItem, "category" | "posInventoryType" | "posInventoryCategory">): GreenwayCategory[] {
  const cats = new Set<GreenwayCategory>([item.category]);
  const rawCategory = normalizeWhitespace(item.posInventoryCategory);
  if (["cartridge", "disposable-cartridge"].includes(item.category)) cats.add("concentrate");
  if (item.category === "preroll-pack") cats.add("preroll");
  if (item.category === "popcorn-bud") cats.add("flower");
  if (item.category === "infused-flower") { cats.add("concentrate"); cats.add("flower"); }
  if (rawCategory === "Blunt") cats.add("blunt");
  if (rawCategory === "Infused Blunt") cats.add("infused-blunt");
  if (rawCategory === "Tincture") cats.add("tincture");
  if (rawCategory === "RSO") cats.add("rso");
  return [...cats];
}

function toMenuItem(group: ProductGroup): GreenwayMenuItem {
  const variants = mergeVariantDuplicates(group);
  const firstAvailable = variants.find((variant) => variant.totalUnits > 0) ?? variants[0];
  const firstPrice = firstAvailable?.priceMinorUnits ?? 0;
  const itemId = `pos-${stableId(group.identityKey)}`;

  // Diagnostic: detect same-size variants with very different prices on flower/popcorn-bud cards.
  // This is a strong indicator that popcorn bud and premium flower are incorrectly
  // grouped together. The keyword detection should prevent this, but the heuristic
  // catches any cases that slip through.
  if (["flower", "popcorn-bud"].includes(group.category) && variants.length >= 2) {
    const bySize = new Map<string, number[]>();
    for (const v of variants) {
      const sizeKey = v.package.label;
      const prices = bySize.get(sizeKey) ?? [];
      prices.push(v.priceMinorUnits);
      bySize.set(sizeKey, prices);
    }
    for (const [sizeLabel, prices] of bySize) {
      if (prices.length >= 2) {
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        // Flag if the price difference is > 40% of the higher price and > $10
        if (max > 0 && (max - min) / max > 0.4 && (max - min) > 1000) {
          addDiagnostic("warning", "flower_same_size_different_price",
            `Flower card has same package size (${sizeLabel}) with very different prices ($${min / 100} vs $${max / 100}). This may indicate popcorn bud mixed with premium flower that was not detected by keyword.`,
            { displayName: group.displayName, brand: group.brand, sizeLabel, prices: prices.map(p => p / 100) });
        }
      }
    }
  }

  const menuVariants: GreenwayMenuVariant[] = variants.map((variant) => ({
    id: `${itemId}-${stableId(variant.package.label, variant.priceMinorUnits, variant.medical ? "medical" : "adult")}`,
    label: variant.package.label === "each" ? "" : variant.package.label,
    priceMinorUnits: variant.priceMinorUnits,
    inventoryLevel: variant.totalUnits,
    medical: variant.medical,
  }));
  const totalUnits = menuVariants.reduce((sum, variant) => sum + variant.inventoryLevel, 0);
  const inventoryType = firstAvailable?.inventoryType ?? group.posInventoryType;
  // THC displays from the Total column (totalRaw); the Thc column (thcRaw) is the sane sibling used
  // when Total is corrupt/over-cap. CBD displays from the Cbd column with Cbda as sibling.
  const thcResolved = resolveCannabinoid(firstAvailable?.totalRaw ?? null, inventoryType, {
    siblingRaw: firstAvailable?.thcRaw ?? null,
    fallbackAvg: THC_FALLBACK_BY_CATEGORY[group.category],
    kind: "thc",
    productName: group.displayName,
    category: group.category,
  });
  const cbdResolved = resolveCannabinoid(firstAvailable?.cbdRaw ?? null, inventoryType, {
    siblingRaw: firstAvailable?.cbdaRaw ?? null,
    fallbackAvg: CBD_FALLBACK_BY_CATEGORY[group.category],
    kind: "cbd",
    productName: group.displayName,
    category: group.category,
  });
  const thc = thcResolved.display;
  const cbd = cbdResolved.display;
  const unit = cannabinoidUnitForInventoryType(inventoryType);
  const unitPattern = unit === "%" ? /%$/ : /mg$/;
  const packageLabel = firstAvailable?.package.label ?? "each";
  const displayPackageLabel = packageLabel === "each" ? "" : packageLabel;
  const priceLabel = [formatCurrency(firstPrice), displayPackageLabel].filter(Boolean).join(" ");
  // Vendor comes from the inventory Vendor column (distinct from Brand). Use the first
  // variant that carries a non-blank vendor so vendor-grouped pages can list suppliers.
  const vendor = firstNonBlank(...variants.map((variant) => variant.vendor));
  const item: GreenwayMenuItem = {
    id: itemId,
    name: group.displayName,
    productName: [...group.productNames].sort()[0],
    brand: group.brand,
    vendor: vendor || undefined,
    category: group.category,
    filterCategories: [],
    posInventoryType: group.posInventoryType,
    posInventoryCategory: group.posInventoryCategory,
    strainType: group.strainType,
    strainName: group.strainName,
    thc,
    cbd,
    totalThc: shouldDisplayThcTotal(inventoryType) ? { type: "thc", value: thc && thc !== "N/A" ? thc.replace(/^~/, "").replace(unitPattern, "") : null, unit } : null,
    totalCbd: shouldDisplayThcTotal(inventoryType) ? { type: "cbd", value: cbd && cbd !== "N/A" ? cbd.replace(/^~/, "").replace(unitPattern, "") : null, unit } : null,
    compounds: cannabinoidCompounds(firstAvailable),
    description: group.descriptions.sort((a, b) => b.length - a.length)[0] ?? genericDescription(group),
    priceLabel,
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

function buildReviewRows(items: GreenwayMenuItem[]): ReviewRow[] {
  const hiddenItems = items.filter((item) => item.hidden);
  return hiddenItems.map((item) => ({
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

type VendorEntry = { name: string; slug: string; productCount: number };

/**
 * Distinct vendor directory built from the inventory Vendor column. Vendors that
 * are blank or that exactly equal a generic placeholder are skipped. Sorted by
 * product count (desc) then name so the vendors page leads with active suppliers.
 */
function buildVendorList(items: GreenwayMenuItem[]): VendorEntry[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const item of items) {
    if (item.hidden) continue;
    const vendor = normalizeWhitespace(item.vendor);
    if (!vendor) continue;
    const key = vendor.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { name: vendor, count: 1 });
  }
  return [...counts.values()]
    .map((entry) => ({ name: entry.name, slug: collapseKeyPart(entry.name), productCount: entry.count }))
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
}


// ---------------------------------------------------------------------------
// Buffer-based workbook reader (replaces the FS-bound readWorkbookRows).
// Accepts an in-memory Buffer/Uint8Array so the same parser works for both the
// CLI (fs.readFileSync) and server uploads (Supabase storage download).
// ---------------------------------------------------------------------------
function readWorkbookRowsFromBuffer(buffer: Buffer | Uint8Array, preferredSheet?: string): Row[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = preferredSheet && workbook.SheetNames.includes(preferredSheet) ? preferredSheet : workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeWhitespace(key), normalizeWhitespace(value)])));
}

export type TransformSummary = ReturnType<typeof summary>;

export type TransformResult = {
  /** Full menu (includes hidden items). Identical shape to pos-menu-preview.json. */
  items: GreenwayMenuItem[];
  /** First 60 items, used for the lightweight sample preview file. */
  sampleItems: GreenwayMenuItem[];
  /** Distinct vendor directory built from visible items. */
  vendors: VendorEntry[];
  /** Every diagnostic raised during the run (info/warning/error). */
  diagnostics: Diagnostic[];
  /** Counts split by severity for quick gating decisions. */
  diagnosticCounts: { total: number; errors: number; warnings: number; info: number };
  /** Hidden items flattened for the review spreadsheet / admin review screen. */
  reviewRows: ReviewRow[];
  /** Aggregate run summary (matches transform-summary.json). */
  summary: TransformSummary;
  /** True when no error-severity diagnostics were raised (safe to publish). */
  ok: boolean;
};

export type TransformInput = {
  productsBuffer: Buffer | Uint8Array;
  inventoriesBuffer: Buffer | Uint8Array;
  /** Optional sheet-name overrides. Defaults match the Cultivera exports. */
  productsSheet?: string;
  inventoriesSheet?: string;
};

export const PRODUCTS_REQUIRED_COLUMNS = [
  "Product Name", "Inventory Type", "Category", "Brand", "Type", "Strain", "UOM", "Package Size", "Price", "Description",
];
export const INVENTORIES_REQUIRED_COLUMNS = [
  "Product", "Category", "InventoryType", "Strain", "Brand", "Product Price", "Units Available For Sale", "Package Size", "Is Medical", "Cbd", "Cbda", "Thc", "Thca", "Total",
];

/**
 * Run the full POS transform on two in-memory workbook buffers and return a
 * structured, filesystem-free result. This is the function both the CLI script
 * and the Supabase admin import flow call.
 *
 * On a column-level structural problem (missing required columns) this throws,
 * matching the legacy behaviour. Row-level issues are surfaced as diagnostics
 * (and reflected in `ok`) rather than thrown, so the caller can stage the run
 * for review instead of failing hard.
 */
export function transformWorkbooks(input: TransformInput): TransformResult {
  // Reset module-level state for a clean run. Synchronous pipeline → safe.
  diagnostics = [];
  flaggedNewCategories = new Set<string>();

  const products = readWorkbookRowsFromBuffer(input.productsBuffer, input.productsSheet ?? "Sheet1");
  const inventories = readWorkbookRowsFromBuffer(input.inventoriesBuffer, input.inventoriesSheet ?? "Inventories");

  requireColumns(products, PRODUCTS_REQUIRED_COLUMNS, "PRODUCTS.xlsx");
  requireColumns(inventories, INVENTORIES_REQUIRED_COLUMNS, "INVENTORIES.xlsx");

  // Pre-scan every distinct POS category up front so unmapped values are flagged
  // (and routed to a safe fallback) rather than crashing the run.
  const allCategories = new Set([
    ...products.map((row) => normalizeWhitespace(row.Category)).filter(Boolean),
    ...inventories.map((row) => normalizeWhitespace(row.Category)).filter(Boolean),
  ]);
  for (const category of allCategories) normalizeCategory(category);

  const groups = buildGroups(products, inventories);
  const items = groups
    .map(toMenuItem)
    .sort((a, b) => a.category.localeCompare(b.category) || a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
  validateMenuItems(items);

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const info = diagnostics.filter((d) => d.severity === "info").length;

  return {
    items,
    sampleItems: items.slice(0, 60),
    vendors: buildVendorList(items),
    diagnostics: [...diagnostics],
    diagnosticCounts: { total: diagnostics.length, errors, warnings, info },
    reviewRows: buildReviewRows(items),
    summary: summary(products, inventories, groups, items),
    ok: errors === 0,
  };
}

// Re-export the core types so callers (CLI + server) share one definition.
export type {
  GreenwayCategory,
  GreenwayStrainType,
  GreenwayCannabinoid,
  GreenwayMenuVariant,
  GreenwayMenuItem,
  Diagnostic,
  Severity,
  ReviewRow,
  VendorEntry,
};

// Re-export pure helpers the CLI wrapper still needs for FS-side formatting.
export { collapseKeyPart, formatCurrency };
