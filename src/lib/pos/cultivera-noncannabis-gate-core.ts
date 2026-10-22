/**
 * src/lib/pos/cultivera-noncannabis-gate-core.ts  (R74 Slice 1)
 *
 * PURE gate that decides, for ONE Cultivera row, whether it is cannabis stock
 * that belongs in the rebuild, and whether a human must pick its category
 * before the manifest it lands on can finish onboarding.
 *
 * Owner (R74 round 2, verbatim in docs/roadmap/R74-CULTIVERA-MANIFEST-REBUILD.md):
 *   "4. Yes, anything that is flagged non cannabis from the is cannabis column
 *    should be left out."
 *   "There might be so products with a non cannabis category that are actually
 *    cannabis as the 'is cannabis' flag is set to 'true'. For those, make me
 *    have to pick the right category before it lets me finish onboarding that
 *    manifest."
 *
 * Measured against the real exports (see /workspace/outputs/m_y.py):
 *   - PRODUCTS_NORMALIZED.xlsx: 2,676 rows, 37 with `Cannabis Y/N` = N. Every
 *     one of the 37 carries InventoryType "Without Inventory Type" (30) or
 *     "Non-cannabis (no limit)" (7). Examples: "Mfused Battery Purple",
 *     "Pastime Brand Battery", "Royal Blunt Wraps Naked", "Lookah Q7 E Nail",
 *     "Sitka Hot Knives", "Greenway Pipe 8". These are the rows the old
 *     transform filed under CONCENTRATE (its unknown-category default).
 *   - 10 rows are `Cannabis Y/N` = Y with a non-cannabis category:
 *     "Mfused Orangasm Accessories 1g" (Usable Marijuana / Accessories),
 *     "Mfused Golden Glove Without Category 1g" (Concentrate for Inhalation /
 *     Without Category), "Agro Couture Mixed Trade Sample 50g" (Topical
 *     Ointment / Trade Sample) ... these are the owner's "make me pick" rows.
 *   - The crawler writes INVENTORIES "Is Cannabis" from !lot.IsNonCannabis
 *     (cultivera-fetch-core.ts), and the API body now asks for non-cannabis
 *     lots too (HideNonCannabis false), so the flag is the source of truth.
 *   - "Batter" is a real cannabis concentrate word ("Cake Batter", "HTE
 *     Batter"); the gate never reads product names to EXCLUDE, only flags, so
 *     a word match can never drop real stock.
 *
 * Rule: EXCLUDE only on an explicit non-cannabis flag (Is Cannabis false,
 * Cannabis Y/N = N) or the CCRS non-cannabis inventory type. A blank flag is
 * NOT a non-cannabis flag: it is kept and, when the category is non-cannabis
 * or unknown, held for a category pick. Never guess (AGENTS.md rule 2).
 *
 * NO I/O. Self-test: __runCultiveraNoncannabisGateCoreTests() (registered in
 * scripts/compliance/run-pure-selftests.ts).
 */

/** Cultivera categories that describe non-cannabis goods (measured list). */
export const NON_CANNABIS_CATEGORIES: ReadonlyArray<string> = [
  "Accessories",
  "Blunt Wrap",
  "Devices",
  "Pipe",
  "Non Cannabis Accessories",
  "Other Non Cannabis",
  "Without Category",
  // Not non-cannabis goods, but not a product form either: the category tells
  // us nothing about which tab/CCRS type the product is, so it needs a pick.
  "Trade Sample",
];

/** CCRS / Cultivera inventory types that mean "not cannabis". */
export const NON_CANNABIS_INVENTORY_TYPES: ReadonlyArray<string> = ["Non-cannabis (no limit)"];
/** Inventory types that carry no product form (a placeholder, not a flag). */
export const FORMLESS_INVENTORY_TYPES: ReadonlyArray<string> = ["Without Inventory Type"];

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const lower = (v: unknown) => norm(v).toLowerCase();
const NON_CANNABIS_CATEGORY_KEYS = new Set(NON_CANNABIS_CATEGORIES.map((c) => c.toLowerCase()));
const NON_CANNABIS_TYPE_KEYS = new Set(NON_CANNABIS_INVENTORY_TYPES.map((c) => c.toLowerCase()));
const FORMLESS_TYPE_KEYS = new Set(FORMLESS_INVENTORY_TYPES.map((c) => c.toLowerCase()));

/** Tri-state read of a Cultivera boolean cell: true / false / null (blank or unreadable). */
export function readFlag(value: unknown): boolean | null {
  const s = lower(value);
  if (!s) return null;
  if (/^(true|t|yes|y|1)$/.test(s)) return true;
  if (/^(false|f|no|n|0)$/.test(s)) return false;
  return null;
}

export function isNonCannabisCategory(category: unknown): boolean {
  return NON_CANNABIS_CATEGORY_KEYS.has(lower(category));
}

export type CannabisGateInput = {
  /** INVENTORIES "Is Cannabis" cell (authoritative when readable). */
  isCannabis?: unknown;
  /** PRODUCTS "Cannabis Y/N" cell (used when the inventory flag is blank). */
  cannabisYn?: unknown;
  inventoryType?: unknown;
  category?: unknown;
  /** True when the category maps to a website category (CATEGORY_MAP hit). */
  categoryKnown?: boolean;
};

export type CannabisGateReason =
  | "is_cannabis_false"
  | "cannabis_yn_n"
  | "non_cannabis_inventory_type"
  | "cannabis";

export type NeedsCategoryReason = "non_cannabis_category" | "unknown_category" | "no_category" | null;

export type CannabisGateVerdict = {
  keep: boolean;
  reason: CannabisGateReason;
  /** Kept cannabis row whose category gives no product form: owner must pick. */
  needsCategory: boolean;
  needsCategoryReason: NeedsCategoryReason;
  /** The two flags disagree (Is Cannabis true, Cannabis Y/N N, or vice versa). */
  flagConflict: boolean;
};

/**
 * Decide one row. The INVENTORIES flag wins when readable; the PRODUCTS flag is
 * the fallback; the CCRS non-cannabis inventory type excludes only when no
 * flag says "true" (a true flag always keeps the row, owner answer 3).
 */
export function gateCannabisRow(input: CannabisGateInput): CannabisGateVerdict {
  const inv = readFlag(input.isCannabis);
  const prod = readFlag(input.cannabisYn);
  const flagConflict = inv !== null && prod !== null && inv !== prod;
  const type = lower(input.inventoryType);
  const out = (keep: boolean, reason: CannabisGateReason): CannabisGateVerdict => {
    if (!keep) return { keep, reason, needsCategory: false, needsCategoryReason: null, flagConflict };
    const cat = norm(input.category);
    let needsCategoryReason: NeedsCategoryReason = null;
    if (!cat) needsCategoryReason = "no_category";
    else if (isNonCannabisCategory(cat)) needsCategoryReason = "non_cannabis_category";
    else if (input.categoryKnown === false) needsCategoryReason = "unknown_category";
    return { keep, reason, needsCategory: needsCategoryReason !== null, needsCategoryReason, flagConflict };
  };
  if (inv === false) return out(false, "is_cannabis_false");
  if (inv === true) return out(true, "cannabis");
  if (prod === false) return out(false, "cannabis_yn_n");
  if (prod === true) return out(true, "cannabis");
  if (NON_CANNABIS_TYPE_KEYS.has(type)) return out(false, "non_cannabis_inventory_type");
  return out(true, "cannabis");
}

/** True for the placeholder inventory type ("Without Inventory Type"). */
export function isFormlessInventoryType(inventoryType: unknown): boolean {
  return FORMLESS_TYPE_KEYS.has(lower(inventoryType));
}

export const GATE_REASON_TEXT: Record<CannabisGateReason, string> = {
  is_cannabis_false: "Cultivera's Is Cannabis column is false",
  cannabis_yn_n: "Cultivera's product Cannabis Y/N is N",
  non_cannabis_inventory_type: "Cultivera's inventory type is Non-cannabis (no limit)",
  cannabis: "Cannabis",
};

export const NEEDS_CATEGORY_TEXT: Record<Exclude<NeedsCategoryReason, null>, string> = {
  non_cannabis_category: "Flagged cannabis, but its Cultivera category is a non-cannabis one. Pick the right category before finishing this manifest.",
  unknown_category: "Its Cultivera category is not mapped to a website category. Pick the right category before finishing this manifest.",
  no_category: "Cultivera gave no category. Pick the right category before finishing this manifest.",
};

export type ExcludedRow = {
  source: "inventories" | "products";
  barcode: string;
  product: string;
  category: string;
  inventoryType: string;
  vendor: string;
  units: number;
  reason: CannabisGateReason;
};

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The "left out" list the owner can open: one CSV row per excluded row. */
export function excludedRowsCsv(rows: ReadonlyArray<ExcludedRow>): string {
  const head = ["Source", "Barcode", "Product", "Category", "Inventory Type", "Vendor", "Units", "Why left out"];
  const body = rows.map((r) =>
    [r.source, r.barcode, r.product, r.category, r.inventoryType, r.vendor, r.units, GATE_REASON_TEXT[r.reason]].map(csvCell).join(","),
  );
  return [head.join(","), ...body].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Self-tests (real row names from the measured exports).
// ---------------------------------------------------------------------------
export function __runCultiveraNoncannabisGateCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error("FAIL cultivera-noncannabis-gate-core: " + msg);
    }
  };

  // readFlag tri-state
  ok(readFlag("True") === true && readFlag("Y") === true && readFlag("1") === true, "true spellings");
  ok(readFlag("False") === false && readFlag("N") === false && readFlag("no") === false, "false spellings");
  ok(readFlag("") === null && readFlag(null) === null && readFlag("maybe") === null, "blank/unreadable is null, never false");

  // Excluded: real battery / wrap rows
  const battery = gateCannabisRow({ isCannabis: "False", inventoryType: "Without Inventory Type", category: "Accessories" });
  ok(!battery.keep && battery.reason === "is_cannabis_false", "Mfused Battery Purple (Is Cannabis False) left out");
  const wrapsByProduct = gateCannabisRow({ cannabisYn: "N", inventoryType: "Without Inventory Type", category: "Blunt Wrap" });
  ok(!wrapsByProduct.keep && wrapsByProduct.reason === "cannabis_yn_n", "Royal Blunt Wraps (Cannabis Y/N N, inv flag blank) left out");
  const enail = gateCannabisRow({ inventoryType: "Non-cannabis (no limit)", category: "Devices" });
  ok(!enail.keep && enail.reason === "non_cannabis_inventory_type", "Lookah Q7 E Nail (no flags, non-cannabis type) left out");
  ok(!battery.needsCategory, "excluded rows never need a category");

  // Kept but needs a pick: Is Cannabis true + non-cannabis category
  const orangasm = gateCannabisRow({ isCannabis: "True", cannabisYn: "Y", inventoryType: "Usable Marijuana", category: "Accessories", categoryKnown: false });
  ok(orangasm.keep && orangasm.needsCategory && orangasm.needsCategoryReason === "non_cannabis_category", "Mfused Orangasm Accessories 1g kept, needs category");
  const golden = gateCannabisRow({ isCannabis: "True", inventoryType: "Concentrate for Inhalation", category: "Without Category" });
  ok(golden.keep && golden.needsCategoryReason === "non_cannabis_category", "Without Category cannabis kept, needs category");
  const trade = gateCannabisRow({ cannabisYn: "Y", inventoryType: "Topical Ointment", category: "Trade Sample" });
  ok(trade.keep && trade.needsCategory, "Trade Sample kept, needs category");

  // True flag beats the non-cannabis inventory type (owner answer 3)
  const trueBeatsType = gateCannabisRow({ isCannabis: "True", inventoryType: "Non-cannabis (no limit)", category: "Flower", categoryKnown: true });
  ok(trueBeatsType.keep && !trueBeatsType.needsCategory, "Is Cannabis true always keeps");

  // Inventory flag wins a conflict, and the conflict is reported
  const conflict = gateCannabisRow({ isCannabis: "True", cannabisYn: "N", category: "Accessories" });
  ok(conflict.keep && conflict.flagConflict && conflict.needsCategory, "inventory True beats product N, conflict flagged");
  const conflict2 = gateCannabisRow({ isCannabis: "False", cannabisYn: "Y", category: "Flower", categoryKnown: true });
  ok(!conflict2.keep && conflict2.flagConflict, "inventory False beats product Y");

  // Real cannabis: kept, no pick, "Batter" never triggers anything
  const batter = gateCannabisRow({ isCannabis: "True", inventoryType: "Concentrate for Inhalation", category: "Badder", categoryKnown: true });
  ok(batter.keep && !batter.needsCategory, "Cake Batter concentrate kept, no pick");
  const flower = gateCannabisRow({ isCannabis: "True", inventoryType: "Usable Marijuana", category: "Flower", categoryKnown: true });
  ok(flower.keep && !flower.needsCategory && flower.reason === "cannabis", "plain flower kept");

  // Unknown / blank categories on cannabis rows need a pick (no concentrate guess)
  const unknown = gateCannabisRow({ isCannabis: "True", inventoryType: "Concentrate for Inhalation", category: "Hash Hole Special", categoryKnown: false });
  ok(unknown.keep && unknown.needsCategoryReason === "unknown_category", "unknown category held for a pick");
  const blank = gateCannabisRow({ isCannabis: "True", category: "" });
  ok(blank.keep && blank.needsCategoryReason === "no_category", "blank category held for a pick");
  const notDeclared = gateCannabisRow({ isCannabis: "True", category: "Flower" });
  ok(notDeclared.keep && !notDeclared.needsCategory, "categoryKnown omitted = do not second-guess a real category");

  // Blank flags + formless type are KEPT (blank is not a non-cannabis flag)
  const blankFlags = gateCannabisRow({ inventoryType: "Without Inventory Type", category: "Accessories" });
  ok(blankFlags.keep && blankFlags.needsCategory, "blank flags never exclude; held for a pick instead");
  ok(isFormlessInventoryType("Without Inventory Type") && !isFormlessInventoryType("Usable Marijuana"), "formless type detection");
  ok(isNonCannabisCategory(" blunt  wrap ") && !isNonCannabisCategory("Blunt"), "category list is exact (Blunt is cannabis)");

  // CSV
  const csv = excludedRowsCsv([
    { source: "inventories", barcode: "GF1", product: "Mfused Battery, Purple", category: "Accessories", inventoryType: "Without Inventory Type", vendor: "MFUSED", units: 3, reason: "is_cannabis_false" },
  ]);
  ok(csv.split("\n")[0].startsWith("Source,Barcode,Product"), "csv header");
  ok(csv.includes('"Mfused Battery, Purple"') && csv.includes("Is Cannabis column is false"), "csv quotes commas and states why");

  console.log(`cultivera-noncannabis-gate-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
