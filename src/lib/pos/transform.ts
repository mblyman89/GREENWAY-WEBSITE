/**
 * src/lib/pos/transform.ts
 *
 * Reusable, filesystem-free POS transform pipeline.
 *
 * This is the SINGLE SOURCE OF TRUTH for turning Cultivera/POS workbook exports
 * (PRODUCTS.xlsx + INVENTORIES.xlsx) into Greenway menu items. It is intentionally
 * free of all `fs`/`path` I/O so the transform is fully testable in memory.
 *
 * SLICE 48: the legacy CLI build script (scripts/pos/transform_pos_data.ts) and
 * the static JSON snapshots it wrote are RETIRED. The sole production consumer
 * is now the Supabase-backed admin import flow (src/lib/pos/import-service.ts) —
 * it reads uploaded buffers from private storage, calls transformWorkbooks(),
 * stages a menu_version, and creates compliance inventory lots at publish.
 *
 * Inputs are in-memory Buffers and outputs are returned as a structured object.
 * Module-level diagnostic state is reset at the top of every transformWorkbooks()
 * call. The pipeline is fully synchronous (no await), so this reset is safe under
 * Node's single-threaded event loop.
 */
import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";
// Type-only: the per-row lot source shape consumed by the compliance lot
// planner (import-lot-core.ts). No runtime dependency — no import cycle.
import type { ImportLotSource } from "@/lib/pos/import-lot-core";

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
type InventoryStatus = "in-stock" | "low-stock" | "unavailable";
type CannabinoidUnit = "%" | "mg";

type GreenwayCannabinoid = { type: "thc" | "thca" | "cbd" | "cbda" | "cbg" | "cbn" | "cbc" | "cbdv"; value: string | null; unit: CannabinoidUnit };
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

// --- Section G (RETIRED — owner decision, Optimus Prime slice) ----------------------------
// The category-average "~" potency fallback tables were REMOVED. The owner's card rules
// (SLICE 43) hide any estimated ("~"-prefixed) value, and the owner confirmed: "remove the
// estimate. We will enrich them so they are accurate and not estimated." A product with no
// usable source potency now carries NULL (box hidden on the site) plus a
// "cannabinoid_missing" info diagnostic so the import review screen lists every product that
// needs potency enrichment. Real values only — never invented.

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
  const gramsEquivalent = unit === "g" ? quantity : unit === "oz" ? quantity * STATUTORY_GRAMS_PER_OUNCE : undefined;
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
  const gramsEquivalent = normalizedUnit === "g" ? safeQuantity : normalizedUnit === "oz" ? safeQuantity * STATUTORY_GRAMS_PER_OUNCE : undefined;
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

function statusForInventory(level: number): InventoryStatus {
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

// Resolve a cannabinoid display value with Bug 3 capping. REAL VALUES ONLY (owner decision):
//   primaryRaw  : the value normally displayed (THC: Total column; CBD: Cbd column)
//   siblingRaw  : a sane alternative from a sibling column (e.g. the Thc column) used when the
//                 primary value is corrupt/over the cap. Optional.
// When no usable source value exists the display is NULL (the site hides the potency box) and
// a "cannabinoid_missing" info diagnostic flags the product for enrichment. The retired
// Section G category-average "~" fallback is gone — values are never invented.
function resolveCannabinoid(
  primaryRaw: number | null,
  inventoryType: string,
  opts: { siblingRaw?: number | null; kind: "thc" | "cbd"; productName?: string; category?: string },
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

  // 3) No usable source value at all: NULL (site hides the box) + enrichment diagnostic.
  // THC missing on a cannabinoid-displayable type is the actionable case; missing CBD is
  // routine (most THC-dominant products list none), so only THC emits the diagnostic.
  if (opts.kind === "thc") {
    addDiagnostic("info", "cannabinoid_missing", "No source THC/Total potency value; product will show no THC box until enriched.", {
      productName: opts.productName, category: opts.category, inventoryType, kind: opts.kind, unit,
    });
  }
  return { display: null, rawUsed: null, fallback: false };
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

// SLICE 49 (owner rule): categories whose DOSE info must stay in the customer-facing
// name — "for edibles and rso and liquids and topicals and such, I want the customer
// name to be inclusive of ratios and such... people will only buy it because it's the
// ratio or specific cannabinoid they need." Ratio tokens ("1:1") and cannabinoid words
// (CBD/CBN/CBG) were never stripped; the mg dose token was — for these categories it is
// now PRESERVED. Note "tincture"/"rso" are included for completeness even though the
// Cultivera CATEGORY_MAP folds those raw categories into edible-liquid/concentrate —
// intake-onboarded cards can carry them directly, and the mirrored intake helper
// (intake-mastering-core.ts) uses the same vocabulary.
const DOSE_LED_CATEGORIES: ReadonlySet<GreenwayCategory> = new Set<GreenwayCategory>(["edible-solid", "edible-liquid", "topical", "tincture", "rso"]);

function stripVariantNoise(value: string, brand: string, category: string, preserveDose = false): string {
  // Section E: convert underscores to spaces up front so machine-style names like
  // "Bite_ind_peanut_butter_chip_1:1_10pk" or "Chew_sat_..." read as normal words. Done before
  // brand stripping and tokenization so the rest of the pipeline sees clean word boundaries; the
  // colon in ratios like "1:1" is preserved because only underscores are touched here.
  let s = normalizeWhitespace(value).replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const brandComparable = normalizeWhitespace(brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (brandComparable) s = s.replace(new RegExp(`^${brandComparable}\\s*[-:|]?\\s*`, "i"), "");
  // SLICE 49: in dose-preserving mode, canonicalize the dose spelling FIRST ("100 MG" /
  // "100 milligrams" → "100mg") so the grouping identity derived from this display name is
  // stable — "100 mg" and "100mg" variants of the same product must land on ONE card.
  if (preserveDose) s = s.replace(/\b(\d+(?:\.\d+)?)\s*(?:mg|milligram|milligrams)\b/gi, "$1mg");
  // Package-size tokens strip away (the size lives on the variant chip). In dose-preserving
  // mode the mg vocabulary is EXCLUDED from this strip so the dose stays in the name;
  // grams/oz/ml are still package sizes and still strip either way.
  const sizeUnitRe = preserveDose
    ? /\b\d+(?:\.\d+)?\s*(?:g|gram|grams|oz|ounce|ounces|ml|milliliter|milliliters|fl\.?\s*oz|fluid\s*ounce|fluidounce)\b/gi
    : /\b\d+(?:\.\d+)?\s*(?:g|gram|grams|mg|milligram|milligrams|oz|ounce|ounces|ml|milliliter|milliliters|fl\.?\s*oz|fluid\s*ounce|fluidounce)\b/gi;
  s = s
    .replace(sizeUnitRe, " ")
    // Numbered pack tokens ("5pk", "3 pack", "2-pack") strip away so a multi-pack lands on the
    // same display family as its single form — EXACT parity with the intake system's
    // familyFromName (intake-mastering-core.ts), so a Cultivera-imported card and an
    // intake-received restock of the same product derive the same name and merge correctly.
    .replace(/\b\d+\s*(?:-\s*)?(?:pk|pack|packs)\b/gi, " ")
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
  // SLICE 49: dose-led categories keep their mg dose in the display name (owner rule) —
  // "Const Moonshot Grape 100mg" stays "Const Moonshot Grape 100mg", never "Const Moonshot Grape".
  const displayName = stripVariantNoise(firstNonBlank(product?.["Product Name"], inv.productName), firstNonBlank(product?.Brand, inv.brand), inv.category, DOSE_LED_CATEGORIES.has(category));
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
      // SLICE 46 fix: MERGE into an existing same-identity group instead of
      // overwriting it. The old `groups.set(identity, freshGroup)` silently
      // REPLACED a previously-built group when two master-less inventory rows
      // derived the same identity (e.g. two sizes of the same strain), losing
      // the earlier rows' variants — 50 raw rows / 260 physical units vanished
      // from the review menu AND from lot planning on the real export.
      const group: ProductGroup = groups.get(identity) ?? {
        identityKey: identity,
        brand,
        category,
        posInventoryCategory: inv.category,
        posInventoryType: inv.inventoryType,
        strainType: normalizeStrainType(inv.strain, category),
        strainName,
        displayName,
        productNames: new Set<string>(),
        descriptions: [],
        variants: [],
        hidden: true,
        hiddenReason: "no_product_master",
      };
      group.productNames.add(inv.productName);
      group.variants.push(inv);
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
      const displayName = stripVariantNoise(firstNonBlank(product["Product Name"]), brand, product.Category ?? "", DOSE_LED_CATEGORIES.has(category));
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
    kind: "thc",
    productName: group.displayName,
    category: group.category,
  });
  const cbdResolved = resolveCannabinoid(firstAvailable?.cbdRaw ?? null, inventoryType, {
    siblingRaw: firstAvailable?.cbdaRaw ?? null,
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
    // Real values only: thc/cbd are either a formatted "12.34%"/"100mg" string or null — the
    // "~" estimate prefix and "N/A" placeholder no longer exist anywhere in the pipeline.
    totalThc: shouldDisplayThcTotal(inventoryType) ? { type: "thc", value: thc ? thc.replace(unitPattern, "") : null, unit } : null,
    totalCbd: shouldDisplayThcTotal(inventoryType) ? { type: "cbd", value: cbd ? cbd.replace(unitPattern, "") : null, unit } : null,
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

/**
 * SLICE 46 (owner Q1): flatten every raw INVENTORIES row under its final menu
 * card into a lot source for the compliance lot planner (import-lot-core.ts).
 * One entry per raw row — the planner merges duplicate barcodes itself.
 * Includes HIDDEN cards' rows too: hidden means "not on the public menu", but
 * the physical stock still exists and must be tracked/reported (CCRS, cycle
 * counts, COGS). Cards with no inventory rows contribute nothing naturally.
 */
function collectLotSources(groups: ProductGroup[]): ImportLotSource[] {
  const sources: ImportLotSource[] = [];
  for (const group of groups) {
    const itemId = `pos-${stableId(group.identityKey)}`;
    for (const variant of group.variants) {
      for (const row of variant.rows) {
        sources.push({
          posProductKey: itemId,
          itemName: group.displayName,
          barcode: normalizeWhitespace(row.Barcode),
          productName: variant.productName,
          category: variant.category,
          inventoryType: variant.inventoryType,
          strainName: group.strainName,
          brand: group.brand,
          vendor: variant.vendor,
          units: Math.max(0, Math.floor(toNumber(row["Units Available For Sale"]) ?? 0)),
          costRaw: normalizeWhitespace(row.Cost),
          receivedDateRaw: normalizeWhitespace(row["Received date"]),
          expirationDateRaw: normalizeWhitespace(row["Expiration date"]),
          coaRaw: normalizeWhitespace(row["[COA Y/N]"]),
          isMedical: variant.medical,
          isSample: toBool(row["Is Sample"]),
          unitWeight: variant.package.quantity,
          unitWeightUom: variant.package.unit,
        });
      }
    }
  }
  return sources;
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
  /** Full menu (includes hidden items) in the GreenwayMenuItem website shape. */
  items: GreenwayMenuItem[];
  /** Distinct vendor directory built from visible items. */
  vendors: VendorEntry[];
  /** Every diagnostic raised during the run (info/warning/error). */
  diagnostics: Diagnostic[];
  /** Counts split by severity for quick gating decisions. */
  diagnosticCounts: { total: number; errors: number; warnings: number; info: number };
  /** Hidden items flattened for the review spreadsheet / admin review screen. */
  reviewRows: ReviewRow[];
  /**
   * SLICE 46: one entry per raw INVENTORIES row, keyed to the menu card it
   * rolled into — the input to planImportLots() (compliance inventory lots
   * created when the imported version is published).
   */
  lotSources: ImportLotSource[];
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
    vendors: buildVendorList(items),
    diagnostics: [...diagnostics],
    diagnosticCounts: { total: diagnostics.length, errors, warnings, info },
    reviewRows: buildReviewRows(items),
    lotSources: collectLotSources(groups),
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

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts).
// Covers the Optimus Prime slice changes: real-values-only potency (no "~"
// category averages, no "N/A" placeholder) and intake-parity name cleaning
// (numbered pack tokens stripped). The workbook pipeline itself is exercised
// by the admin import flow; these tests pin the pure decision logic.
// ---------------------------------------------------------------------------
export function __runTransformCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };

  // Isolate module diagnostic state, then restore at the end.
  const savedDiagnostics = diagnostics;
  diagnostics = [];
  try {
    // --- resolveCannabinoid: real values only -------------------------------
    // 1) Missing THC on a displayable type → null display + cannabinoid_missing diagnostic.
    let r = resolveCannabinoid(null, "Usable Marijuana", { kind: "thc", productName: "Test Flower", category: "flower" });
    ok(r.display === null && r.rawUsed === null && r.fallback === false, "missing THC resolves to null, never invented");
    ok(diagnostics.some((d) => d.code === "cannabinoid_missing"), "missing THC emits enrichment diagnostic");
    ok(!diagnostics.some((d) => d.code === "cannabinoid_average_fallback"), "category-average fallback is retired");

    // 2) Missing CBD → null quietly (no diagnostic spam for the routine case).
    diagnostics = [];
    r = resolveCannabinoid(null, "Usable Marijuana", { kind: "cbd", productName: "Test Flower", category: "flower" });
    ok(r.display === null, "missing CBD resolves to null");
    ok(diagnostics.length === 0, "missing CBD emits no diagnostic");

    // 3) Real value passes through with the right unit; no "~" prefix anywhere.
    r = resolveCannabinoid(23.71, "Usable Marijuana", { kind: "thc" });
    ok(r.display === "23.71%", "real percent value formats plainly");
    r = resolveCannabinoid(100, "Solid Edible", { kind: "thc" });
    ok(r.display === "100mg", "edible values format in mg");

    // 4) Corrupt primary (over cap) falls back to the sane sibling column.
    diagnostics = [];
    r = resolveCannabinoid(15000000, "Usable Marijuana", { siblingRaw: 24.5, kind: "thc" });
    ok(r.display === "24.5%", "corrupt primary uses sane sibling");
    ok(diagnostics.some((d) => d.code === "cannabinoid_value_capped"), "cap substitution logged");

    // 5) Corrupt primary with no sibling clamps to the cap (still a real bound, never "~").
    r = resolveCannabinoid(250, "Usable Marijuana", { kind: "thc" });
    ok(r.display === "100%", "percent clamps at 100");

    // 6) Non-displayable type → null with no diagnostics.
    diagnostics = [];
    r = resolveCannabinoid(null, "Topical Ointment", { kind: "thc" });
    ok(r.display === null && diagnostics.length === 0, "non-displayable type stays silent");

    // --- stripVariantNoise: intake-parity name cleaning ---------------------
    ok(stripVariantNoise("Blue Dream 5pk", "", "Pre-roll") === "Blue Dream", "numbered pk token stripped");
    ok(stripVariantNoise("Sour Gummies 3 pack", "", "Gummies") === "Sour", "numbered pack token stripped (gummies is category noise)");
    ok(stripVariantNoise("Healing Balm 2-pack", "", "Topical") === "Healing Balm", "hyphenated pack token stripped");
    ok(stripVariantNoise("Fairwinds - Healing Balm 300mg", "Fairwinds", "Topical") === "Healing Balm", "brand prefix + mg dose stripped");
    ok(stripVariantNoise("Bite_ind_peanut_butter_chip_1:1_10pk", "", "Edible") === "Bite Ind Peanut Butter Chip 1:1", "underscore name cleans, ratio preserved, 10pk stripped");
    ok(stripVariantNoise("AK-47 3.5g", "", "Flower") === "Ak 47", "mid-name number survives, only size stripped");

    // --- SLICE 49: dose-preserving mode (owner rule: edibles/liquids/topicals/RSO keep
    // their mg/ratio info in the customer name). Pinned on REAL lost names from the
    // owner's Cultivera export (117 products lost their dose before this fix).
    ok(stripVariantNoise("Const Moonshot Grape 100mg", "", "Edible", true) === "Const Moonshot Grape 100mg", "dose mode: trailing mg dose preserved");
    ok(stripVariantNoise("Canna Cantina Shot - Dankchata - 100mg", "", "Shots", true) === "Canna Cantina Dankchata 100mg", "dose mode: mg survives separator cleanup ('shot' is category noise)");
    ok(stripVariantNoise("Wook Gone Wild Tea Mango Lemonade - 400mg", "", "Beverage", true) === "Wook Gone Wild Tea Mango Lemonade 400mg", "dose mode: beverage keeps 400mg");
    ok(stripVariantNoise("A.C. Topical Drops - 1000mg THC", "", "Topical", true) === "A.C. Drops 1000mg THC", "dose mode: mg + cannabinoid word preserved ('topical' is category noise)");
    ok(stripVariantNoise("Blaze POG - 6oz Can - 100mg THC", "", "Beverage", true) === "Blaze Pog Can 100mg THC", "dose mode: package oz stripped, dose mg kept");
    ok(stripVariantNoise("Rainbow Chews 100 MG 10pk", "", "Gummies", true) === "Rainbow Chews 100mg", "dose mode: '100 MG' canonicalizes to '100mg', pack token still stripped");
    ok(stripVariantNoise("Bite_ind_peanut_butter_chip_1:1_10pk", "", "Edible", true) === "Bite Ind Peanut Butter Chip 1:1", "dose mode: ratio still preserved, pack stripped");
    ok(stripVariantNoise("Fairwinds - Healing Balm 300mg", "Fairwinds", "Topical", true) === "Healing Balm 300mg", "dose mode: brand strips, dose stays");
    // Default (non-dose) mode is byte-for-byte UNCHANGED for flower-family names.
    ok(stripVariantNoise("Fairwinds - Healing Balm 300mg", "Fairwinds", "Topical") === "Healing Balm", "non-dose mode still strips mg (unchanged default)");

    // --- SLICE 46: lotSources exposure + master-less group merge fix --------
    // Build a tiny in-memory workbook pair and run the REAL pipeline.
    {
      const makeSheet = (rows: Record<string, string>[]) => XLSX.utils.json_to_sheet(rows);
      const toBuffer = (sheetName: string, rows: Record<string, string>[]) => {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, makeSheet(rows), sheetName);
        return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      };
      const productsBuffer = toBuffer("Sheet1", [
        {
          "Product Name": "Acme Blue Dream 3.5g", "Inventory Type": "Usable Marijuana", Category: "Flower",
          Brand: "Acme", Type: "Hybrid", Strain: "Blue Dream", UOM: "Grams", "Package Size": "3.50 Grams",
          Price: "$25.00", Description: "Nice flower.",
        },
      ]);
      const invRow = (over: Record<string, string>) => ({
        Id: "1", Location: "Main", Barcode: "BC-1", Alias: "", Product: "Acme Blue Dream 3.5g",
        Category: "Flower", InventoryType: "Usable Marijuana", Strain: "Blue Dream", Brand: "Acme",
        Vendor: "ACME FARMS", "Product Price": "$25.00", Cost: "$10.00", "Units Available For Sale": "4",
        "Units In Stock": "4", "Package Size": "3.50 Grams", "Storage Location": "Sales Floor",
        "Is Medical": "False", "Is Cannabis": "True", "Is Sample": "False", Lab: "", "[COA Y/N]": "Y",
        Cbd: "0.5", Cbda: "", Thc: "22", Thca: "", Total: "24.5", "Terpene Total": "",
        "Units On Hold": "0", "Quantity Sold": "0", "Quantity Purchased": "4",
        "Expiration date": "", "Received date": "06/17/2026",
        ...over,
      });
      // Two master-less rows (no PRODUCTS match) sharing one derived identity
      // (same strain, two sizes) — the pre-fix code overwrote the first group.
      const inventoriesBuffer = toBuffer("Inventories", [
        invRow({}),
        invRow({ Id: "2", Barcode: "BC-ORPH-A", Product: "Downtown flower toasted crunch 7g", Strain: "Toasted Crunch", Brand: "Downtown", "Package Size": "7.00 Grams", "Units Available For Sale": "2" }),
        invRow({ Id: "3", Barcode: "BC-ORPH-B", Product: "Downtown flower toasted crunch 14g", Strain: "Toasted Crunch", Brand: "Downtown", "Package Size": "14.00 Grams", "Units Available For Sale": "3" }),
      ]);
      const run = transformWorkbooks({ productsBuffer, inventoriesBuffer });
      ok(run.lotSources.length === 3, "every raw inventory row yields a lot source");
      const bd = run.lotSources.find((s) => s.barcode === "BC-1");
      ok(!!bd && bd.units === 4 && bd.costRaw === "$10.00" && bd.receivedDateRaw === "06/17/2026" && bd.coaRaw === "Y", "lot source carries barcode/cost/received/COA verbatim");
      ok(!!bd && run.items.some((i) => i.id === bd.posProductKey), "lot source keys to a real menu card id");
      const orphKeys = new Set(run.lotSources.filter((s) => s.barcode.startsWith("BC-ORPH")).map((s) => s.posProductKey));
      ok(run.lotSources.filter((s) => s.barcode.startsWith("BC-ORPH")).length === 2, "master-less rows BOTH survive (group merge fix)");
      ok(orphKeys.size === 1, "same-identity master-less rows merge into ONE hidden card");
      const orphCard = run.items.find((i) => orphKeys.has(i.id));
      ok(!!orphCard && orphCard.hidden === true, "master-less card stays hidden for review");
      ok(!!orphCard && orphCard.variants.reduce((s, v) => s + v.inventoryLevel, 0) === 5, "merged master-less card keeps ALL units (2+3)");
    }

    console.log(`transform-core: ${passed} assertions passed`);
  } finally {
    diagnostics = savedDiagnostics;
  }
}
