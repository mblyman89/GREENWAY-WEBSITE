/**
 * src/lib/inventory/website-category-resolver.ts
 *
 * REQUEST B (owner, verbatim): "So I need all inventory entering the system via
 * the intake process to be converted to our conventions so it works properly
 * with the menu and the back office. For example, in cycle counts, the filters
 * are based on the LCB classification, like usable marijuana and such. The LCB/
 * CCRS requirements should be left untouched for their reporting purposes, but
 * for backend and website purposes we need them to be converted to use our
 * conventions."
 *
 * WHAT THIS DOES: resolves an inventory lot / sheet line onto OUR website
 * category (the same taxonomy the public menu uses) WITHOUT mutating any stored
 * value. This is a PRESENTATION-LAYER resolver — it never writes, never touches
 * the raw LCB/CCRS `category` / `inventory_type` columns (those stay verbatim
 * for CCRS reporting per migration 0024 and ccrs-batch-core.ts).
 *
 * PRECEDENCE (highest → lowest confidence):
 *   a. menu_items.category by pos_product_key  (AUTHORITATIVE — this is exactly
 *      what transform.ts already computed for the website; async, see -server.ts)
 *   b. inventory_types DB row / INVENTORY_TYPE_CATALOG by raw inventory_type
 *      label  (the owner-managed map at /admin/settings/types)
 *   c. name / coarse-type heuristic  (mirrors transform.ts fallback detection)
 *   d. UNMAPPED — keep the raw value + set `unmapped=true` so the back office can
 *      warn and the owner can add an explicit mapping. NEVER silently guess wrong.
 *
 * GROUNDED IN FACT: the catalog + heuristic below mirror
 *   - src/lib/pos/inventory-type-catalog.ts (INVENTORY_TYPE_CATALOG, verbatim from
 *     transform.ts CATEGORY_MAP)
 *   - src/lib/pos/transform.ts detectPopcornBud / detectInfusedFlower name rules
 *   - src/lib/pos/category-taxonomy.ts (websiteCategoryDefinitions — valid values/labels)
 *
 * This module's CORE is PURE + tsx-testable (no I/O). The async DB precedence
 * step (a) and the DB inventory_types overlay live in
 * website-category-resolver-server.ts so this stays unit-testable.
 */

import { INVENTORY_TYPE_CATALOG, inventoryTypeKey } from "@/lib/pos/inventory-type-catalog";
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The minimal shape any lot / sheet line must provide to be resolved. */
export type ResolvableLot = {
  /** Stable POS product key (menu_items.source_item_id); enables precedence (a). */
  posProductKey?: string | null;
  /** Product name — used by the name heuristic (precedence c). */
  productName?: string | null;
  /** Raw POS inventory_type label as stored (e.g. "Usable Cannabis", "BHO"). */
  inventoryType?: string | null;
  /** Raw LCB inventory_category as stored (e.g. "Usable Marijuana"). */
  category?: string | null;
};

/** Where the resolved category came from (audit trail / debugging). */
export type ResolutionSource =
  | "override" // (0) per-product owner override (product_classification_overrides)
  | "menu_item" // (a) menu_items.category by pos_product_key
  | "inventory_type" // (b) inventory_types DB / catalog map
  | "heuristic" // (c) name / coarse-type detection
  | "unmapped"; // (d) no confident mapping

export type WebsiteCategoryResolution = {
  /** OUR website category `value` (from category-taxonomy) or null when unmapped. */
  websiteCategory: string | null;
  /** Human label for that category (e.g. "Concentrate"). Raw value when unmapped. */
  label: string;
  /** The raw LCB inventory_type we started from (untouched, for display/audit). */
  raw: string | null;
  /** Where the answer came from. */
  source: ResolutionSource;
  /** true when we could NOT confidently map — the back office should warn. */
  unmapped: boolean;
};

/** An inventory_types map entry: canonical key → website category value. */
export type InventoryTypeMapEntry = { key: string; websiteCategory: string | null };

// ---------------------------------------------------------------------------
// Lookups (pure)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = new Map<string, string>(
  websiteCategoryDefinitions.map((c) => [c.value as string, c.label]),
);

const VALID_CATEGORY = new Set<string>(
  websiteCategoryDefinitions.map((c) => c.value as string),
);

/** Label for a website category value; falls back to the value itself. */
export function websiteCategoryLabel(value: string | null | undefined): string {
  if (!value) return "";
  return CATEGORY_LABELS.get(value) ?? value;
}

/**
 * Build the default inventory_type → website_category map from the canonical
 * catalog. Server code overlays DB rows on top of this (DB wins by key).
 */
export function buildStaticInventoryTypeMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of INVENTORY_TYPE_CATALOG) {
    map.set(inventoryTypeKey(e.label), e.websiteCategory);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Name / coarse-type heuristic (precedence c)
//
// Mirrors transform.ts detectPopcornBud / detectInfusedFlower keyword rules and
// a light coarse-type reading of common LCB inventory_type strings, used ONLY
// when neither menu_items nor the inventory_types map has an answer.
// ---------------------------------------------------------------------------

const POPCORN_KEYWORDS = [
  "popcorn",
  "small bud",
  "smalls",
  "b-bud",
  "b bud",
  "snapper",
  "bong buddies",
  "budget",
];

const INFUSED_FLOWER_KEYWORDS = [
  "moon rock",
  "moonrock",
  "caviar",
  "iceberg",
  "infused flower",
  "infused bud",
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// ---------------------------------------------------------------------------
// H16b-9 name-readers for MULTI-CATEGORY LCB types (owner-directed).
//
// The CCRS "Cannabis Mix Infused" / legacy "Marijuana Mix Infused" type is a
// MULTI-category bucket: the same LCB type covers infused prerolls, infused
// blunts, infused (multi-)packs, AND infused flower in a jar / moon rocks.
// The LCB type alone can't disambiguate, so we READ THE PRODUCT NAME.
//
// Owner mapping (H16b-9, confirmed verbatim):
//   name has pack / pk / N-pack           -> infused-preroll-pack
//   name has preroll / pre-roll / joint / blunt -> infused-preroll
//   name has moon rock / caviar / iceberg / jar / flower / bud / dipped /
//     rolled / nug (or nothing else matched, ambiguous) -> infused-flower
// ---------------------------------------------------------------------------

/** Multi-pack signal in a product name: "3pk", "5 pack", "2-pack", "10 packs". */
const PACK_NAME_RE = /\b\d+\s*(?:-\s*)?(?:pk|pack|packs)\b/i;
/** Single preroll / blunt / joint signal in a product name. */
const PREROLL_NAME_RE = /\b(?:pre[-\s]?rolls?|prerolls?|joints?|blunts?)\b/i;
/** Infused-flower-form signal in a product name (moon rocks, caviar, jar, etc). */
const INFUSED_FLOWER_FORM_KEYWORDS = [
  "moon rock",
  "moonrock",
  "caviar",
  "iceberg",
  "infused flower",
  "infused bud",
  "flower",
  "bud",
  "nug",
  "jar",
  "dipped",
  "rolled",
];

/**
 * Resolve a "Mix Infused" LCB type by reading the product name. NEVER returns
 * null — a Mix-Infused line is definitively an infused product, so the safe
 * default when the name gives no other clue is infused-flower (owner-confirmed).
 */
export function readMixInfusedByName(productName: string | null | undefined): string {
  const name = (productName ?? "").toLowerCase();
  // Pack beats single preroll (a "5pk infused preroll" is a pack).
  if (PACK_NAME_RE.test(name)) return "infused-preroll-pack";
  if (PREROLL_NAME_RE.test(name)) return "infused-preroll";
  if (includesAny(name, INFUSED_FLOWER_FORM_KEYWORDS)) return "infused-flower";
  // Ambiguous infused product → infused-flower (owner-confirmed default).
  return "infused-flower";
}

/**
 * Sample-jar sub-type + form detection (owner E). A "Sample Jar" LCB type is
 * whatever product FORM the name describes, for tracking; a smell/sniff jar is
 * a distinct sub-type we flag but still track by its underlying form (flower).
 */
export type SampleJarReading = {
  /** true when the name identifies this as a smell/sniff jar specifically. */
  smellJar: boolean;
  /** website category for the underlying product form (never null). */
  formCategory: string;
};

const SMELL_JAR_RE = /\b(?:smell|sniff|scent|nose)\s*jar\b/i;

/**
 * Infer a product FORM (website category) purely from a product name — used for
 * sample-jar tracking where no useful LCB type distinguishes the contents.
 * Conservative: returns null when the name gives no clear form signal.
 */
export function readFormByName(productName: string | null | undefined): string | null {
  const name = (productName ?? "").toLowerCase();
  if (!name) return null;
  if (includesAny(name, INFUSED_FLOWER_KEYWORDS)) return "infused-flower";
  if (includesAny(name, POPCORN_KEYWORDS)) return "popcorn-bud";
  if (PACK_NAME_RE.test(name) && PREROLL_NAME_RE.test(name)) return "preroll-pack";
  if (PREROLL_NAME_RE.test(name)) return "preroll";
  // NOTE: keywords are PREFIX-anchored (leading \b, no trailing \b) so plurals /
  // inflections match (e.g. "gummies" via "gumm", "cartridges" via "cart").
  if (/\b(?:cartridge|cart|vape|pod)/i.test(name)) return "cartridge";
  if (/\b(?:rosin|resin|shatter|badder|batter|budder|wax|hash|bho|distillate|diamond|sugar|crumble|sauce|rso|concentrate|extract)/i.test(name)) {
    return "concentrate";
  }
  if (/\b(?:soda|beverage|drink|shot|juice|lemonade|punch|seltzer)/i.test(name)) return "edible-liquid";
  if (/\b(?:gumm|chocolate|candy|chew|mint|caramel|cookie|brownie|edible|capsule|tablet|lozenge)/i.test(name)) return "edible-solid";
  if (/\btincture/i.test(name)) return "tincture";
  if (/\b(?:topical|balm|lotion|salve|ointment|cream|patch|transdermal|suppository)/i.test(name)) return "topical";
  if (/\b(?:trim|shake)/i.test(name)) return "trim";
  if (/\b(?:flower|bud|nug|jar|gram|eighth|quarter|ounce)/i.test(name) || /\b\d+(?:\.\d+)?\s*g\b/i.test(name)) return "flower";
  return null;
}

/**
 * H17 — resolve the coarse "Usable Marijuana" / "Usable Cannabis" / "Flower
 * Lot" LCB bucket by READING THE PRODUCT NAME. Verified on the owner's real
 * SPR manifest: joints, blunts, preroll packs AND jarred flower ALL arrive as
 * inventory_type "Usable Marijuana" — the type alone cannot disambiguate, but
 * the name always can ("SPR - Variety Pack - 5pk Joint Tin (5g) #1" is a
 * preroll pack, not flower). NEVER returns null — a Usable line is
 * definitively a flower-family product, so the default is flower.
 *
 * Order matters: infused-flower / popcorn keywords first (parity with the
 * heuristic's strongest name signals), then pack-of-prerolls, then single
 * preroll/joint/blunt, then flower.
 */
export function readUsableMarijuanaByName(productName: string | null | undefined): string {
  const name = (productName ?? "").toLowerCase();
  if (includesAny(name, INFUSED_FLOWER_KEYWORDS)) return "infused-flower";
  if (includesAny(name, POPCORN_KEYWORDS)) return "popcorn-bud";
  // A pack is only a PREROLL pack when the name also says joint/blunt/preroll
  // ("5pk Joint Tin"); a numbered pack of jars stays flower.
  if (PACK_NAME_RE.test(name) && PREROLL_NAME_RE.test(name)) return "preroll-pack";
  if (PREROLL_NAME_RE.test(name)) return "preroll";
  return "flower";
}

/**
 * H17 — LCB types that are MULTI-category buckets: one raw type covers several
 * of OUR website categories, so a single flat inventory_types mapping is
 * definitionally wrong for them and the product NAME must be read instead.
 * Used by resolveWebsiteCategory to bypass precedence (b) for these types
 * (menu_items precedence (a) still wins — that's per-product, not per-type).
 *
 *  - "Usable Marijuana"/"Usable Cannabis"/"Flower Lot": flower, popcorn,
 *    preroll, blunt, preroll pack (owner's real SPR manifest).
 *  - "Cannabis/Marijuana Mix Infused": infused preroll / pack / flower
 *    (H16b-9). "Mix Packaged" is NOT multi-category (always trim) — guarded.
 *  - "Sample Jar": whatever FORM the name describes (H16b-9 owner E).
 */
export function isMultiCategoryLcbType(rawType: string | null | undefined): boolean {
  const type = (rawType ?? "").toLowerCase();
  if (!type) return false;
  if (type.includes("mix infused") || (type.includes("mix") && type.includes("infused") && !type.includes("packaged"))) {
    return true;
  }
  if (type.includes("usable")) return true;
  if (type.includes("flower lot")) return true;
  if (type.includes("sample jar")) return true;
  return false;
}

export function readSampleJarByName(productName: string | null | undefined): SampleJarReading {
  const name = (productName ?? "").toLowerCase();
  const smellJar = SMELL_JAR_RE.test(name);
  // Smell/sniff jars are always useable flower. Otherwise read the product FORM
  // from the name so we track it under the correct category. Default: flower.
  let formCategory: string | null;
  if (smellJar) {
    formCategory = "flower";
  } else {
    formCategory = readFormByName(productName) ?? "flower";
  }
  return { smellJar, formCategory };
}

/**
 * Best-effort website category from a product name + raw LCB type. Returns null
 * when nothing matches (so the caller can flag it unmapped rather than guess).
 */
export function heuristicWebsiteCategory(
  productName: string | null | undefined,
  rawType: string | null | undefined,
): string | null {
  const name = (productName ?? "").toLowerCase();
  const type = (rawType ?? "").toLowerCase();

  // Strongest name signals first (match transform.ts intent).
  if (name && includesAny(name, INFUSED_FLOWER_KEYWORDS)) return "infused-flower";
  if (name && includesAny(name, POPCORN_KEYWORDS)) return "popcorn-bud";

  // Coarse LCB inventory_type reading. These are the broad CCRS/POS buckets that
  // do NOT match our finer taxonomy on their own; we only use them as a last
  // resort and keep it conservative.
  if (type) {
    // H16b-9: "Cannabis Mix Infused" / legacy "Marijuana Mix Infused" is a
    // MULTI-category type — read the name (infused-preroll / -pack / -flower).
    // Guard against "Mix Packaged" (non-infused) which must NOT match here.
    if (type.includes("mix infused") || (type.includes("mix") && type.includes("infused") && !type.includes("packaged"))) {
      return readMixInfusedByName(productName);
    }
    // H16b-9: "Cannabis/Marijuana Mix Packaged" is NON-infused mixed flower /
    // shake → trim (owner B). Checked before the generic flower branch so the
    // word "flower" in a name can't pull it into flower.
    if (type.includes("mix packaged") || (type.includes("mix") && type.includes("packaged"))) {
      return "trim";
    }
    // H16b-9: "Cannabis Mix" intermediate (trim mix) → trim (owner D). Placed
    // after the infused/packaged checks so those win.
    if (type.includes("cannabis mix") || type.includes("marijuana mix")) {
      return "trim";
    }
    // H16b-9: "Sample Jar" → resolve by the underlying product FORM (owner E).
    // Samples never reach the public menu; this is for tracking only.
    if (type.includes("sample jar")) {
      return readSampleJarByName(productName).formCategory;
    }
    if (type.includes("flower") || type.includes("usable")) {
      // H17: "Usable Marijuana" is a MULTI-category bucket — joints, blunts,
      // preroll packs and flower ALL arrive under it (owner's real SPR
      // manifest), so READ THE NAME instead of flat-returning flower. The
      // old flat return is the bug that showed "5pk Joint Tin" as FLOWER.
      return readUsableMarijuanaByName(productName);
    }
    if (type.includes("pre-roll") || type.includes("preroll") || type.includes("pre roll")) {
      return type.includes("infused") ? "infused-preroll" : "preroll";
    }
    if (type.includes("cartridge") || type.includes("vape")) return "cartridge";
    if (type.includes("concentrate") || type.includes("extract") || type.includes("hash") || type.includes("rosin") || type.includes("resin")) {
      // SLICE 63 (owner bug B4: "2727 Vape Cart" filed under Concentrate):
      // vape hardware ships under the inhalation-concentrate LCB types
      // ("Concentrate for Inhalation", "Hydrocarbon Concentrate", …), so the
      // type alone cannot separate a cart from a dab — read the NAME for
      // cart/pod/vape/disposable tokens before defaulting to concentrate.
      if (/\bdisposables?\b/.test(name)) return "disposable-cartridge";
      if (/\b(?:cart(?:ridge)?s?|vapes?|pods?)\b/.test(name)) return "cartridge";
      return "concentrate";
    }
    if (type.includes("capsule") || type.includes("edible") || type.includes("gummies") || type.includes("candy")) {
      return type.includes("liquid") || type.includes("beverage") ? "edible-liquid" : "edible-solid";
    }
    if (type.includes("beverage") || type.includes("drink") || type.includes("soda")) return "edible-liquid";
    if (type.includes("tincture")) return "tincture";
    // H16b-9: Suppository / Transdermal (CCRS EndProduct) → topical (owner C).
    if (type.includes("suppository") || type.includes("transdermal")) return "topical";
    if (type.includes("topical") || type.includes("ointment")) return "topical";
    if (type.includes("trim") || type.includes("shake")) return "trim";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core resolver (PURE)
//
// Precedence (a) is applied by the server wrapper (it needs a DB read); this
// pure core accepts an OPTIONAL pre-resolved menuItemCategory so it can honor
// precedence (a) when the caller already has it, then applies (b) inventory_type
// map, (c) heuristic, (d) unmapped.
// ---------------------------------------------------------------------------

export type ResolveOptions = {
  /**
   * Per-product OWNER OVERRIDE (precedence 0 — HIGHEST). The website category
   * VALUE the owner set from the Inventory Detail corrections section
   * (product_classification_overrides.website_category, migration 0150). When
   * present + valid it beats even menu_items.category — a human deliberately
   * re-filed THIS product. Pass null/undefined when there is no override.
   */
  overrideCategory?: string | null;
  /**
   * Website category already known from menu_items.category for this lot's
   * pos_product_key (precedence a). Pass null/undefined if unknown.
   */
  menuItemCategory?: string | null;
  /**
   * inventory_type → website_category map (precedence b). Defaults to the static
   * catalog; server code passes a DB-overlaid map.
   */
  inventoryTypeMap?: Map<string, string>;
};

export function resolveWebsiteCategory(
  lot: ResolvableLot,
  opts: ResolveOptions = {},
): WebsiteCategoryResolution {
  const raw = lot.inventoryType ?? null;
  const map = opts.inventoryTypeMap ?? buildStaticInventoryTypeMap();

  // (0) OWNER OVERRIDE — highest precedence. A human re-filed THIS product from
  // the Inventory Detail corrections section; honor it over everything else.
  const override = opts.overrideCategory ?? null;
  if (override && VALID_CATEGORY.has(override)) {
    return {
      websiteCategory: override,
      label: websiteCategoryLabel(override),
      raw,
      source: "override",
      unmapped: false,
    };
  }

  // (a) menu_items.category — authoritative.
  const fromMenu = opts.menuItemCategory ?? null;
  if (fromMenu && VALID_CATEGORY.has(fromMenu)) {
    return {
      websiteCategory: fromMenu,
      label: websiteCategoryLabel(fromMenu),
      raw,
      source: "menu_item",
      unmapped: false,
    };
  }

  // H17: MULTI-category LCB buckets ("Usable Marijuana", "Mix Infused",
  // "Sample Jar") skip the flat (b) map — one raw type covers several of our
  // categories, so any single mapping is wrong for part of the delivery; the
  // heuristic (c) reads the product NAME instead. Precedence (a) above still
  // wins because menu_items is per-product, not per-type.
  const multiCategory = isMultiCategoryLcbType(raw);

  // (b) inventory_types map by raw inventory_type label.
  if (raw && !multiCategory) {
    const mapped = map.get(inventoryTypeKey(raw));
    if (mapped && VALID_CATEGORY.has(mapped)) {
      return {
        websiteCategory: mapped,
        label: websiteCategoryLabel(mapped),
        raw,
        source: "inventory_type",
        unmapped: false,
      };
    }
  }

  // (c) name / coarse-type heuristic.
  const guessed = heuristicWebsiteCategory(lot.productName, raw);
  if (guessed && VALID_CATEGORY.has(guessed)) {
    return {
      websiteCategory: guessed,
      label: websiteCategoryLabel(guessed),
      raw,
      source: "heuristic",
      unmapped: false,
    };
  }

  // (d) unmapped — keep raw visible, flag for owner attention. Never guess.
  return {
    websiteCategory: null,
    label: raw ?? "Unmapped",
    raw,
    source: "unmapped",
    unmapped: true,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE). Run: npx tsx src/lib/inventory/website-category-resolver.ts
// ---------------------------------------------------------------------------

export function __runWebsiteCategoryResolverTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  // (0) OWNER OVERRIDE wins over EVERYTHING — even a conflicting published
  // menu_item category. A human re-filed THIS product in the corrections section.
  const ov = resolveWebsiteCategory(
    { posProductKey: "SKU-OV", inventoryType: "BHO", productName: "Live Badder" },
    { overrideCategory: "flower", menuItemCategory: "concentrate" },
  );
  eq(ov.websiteCategory, "flower", "(0) override beats menu_item");
  eq(ov.source, "override", "(0) source=override");
  ok(!ov.unmapped, "(0) override not unmapped");
  eq(ov.label, "Flower", "(0) override label resolved");
  eq(ov.raw, "BHO", "(0) override leaves raw untouched");

  // An INVALID override value is ignored — resolution falls through to (a)/(b).
  const ovBad = resolveWebsiteCategory(
    { inventoryType: "BHO", productName: "Live Badder" },
    { overrideCategory: "not-a-real-category", menuItemCategory: "concentrate" },
  );
  eq(ovBad.websiteCategory, "concentrate", "(0) invalid override falls to menu_item");
  eq(ovBad.source, "menu_item", "(0) invalid override → menu_item");

  // A null/absent override never interferes with normal resolution.
  const ovNull = resolveWebsiteCategory(
    { inventoryType: "BHO", productName: "Live Badder" },
    { overrideCategory: null },
  );
  eq(ovNull.websiteCategory, "concentrate", "(0) null override → normal path");
  eq(ovNull.source, "inventory_type", "(0) null override → inventory_type");

  // (a) menu_items.category wins over everything, even a conflicting raw type.
  const a = resolveWebsiteCategory(
    { posProductKey: "SKU-1", inventoryType: "Usable Cannabis", productName: "Blue Dream 3.5g" },
    { menuItemCategory: "flower" },
  );
  eq(a.websiteCategory, "flower", "(a) menu_item category wins");
  eq(a.source, "menu_item", "(a) source=menu_item");
  ok(!a.unmapped, "(a) not unmapped");
  eq(a.label, "Flower", "(a) label resolved");
  eq(a.raw, "Usable Cannabis", "(a) raw preserved untouched");

  // menu category ignored if it's not a valid taxonomy value → falls through.
  const aBad = resolveWebsiteCategory(
    { inventoryType: "BHO", productName: "Live Badder" },
    { menuItemCategory: "not-a-real-category" },
  );
  eq(aBad.websiteCategory, "concentrate", "invalid menu category falls to (b)");
  eq(aBad.source, "inventory_type", "invalid menu category → inventory_type");

  // (b) inventory_types catalog map: BHO → concentrate, Flower → flower.
  eq(
    resolveWebsiteCategory({ inventoryType: "BHO" }).websiteCategory,
    "concentrate",
    "(b) BHO → concentrate",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "Flower" }).websiteCategory,
    "flower",
    "(b) Flower → flower",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "  live   resin  " }).websiteCategory,
    "concentrate",
    "(b) key canonicalized (whitespace/case)",
  );
  eq(resolveWebsiteCategory({ inventoryType: "Moon Rocks" }).source, "inventory_type", "(b) Moon Rocks via map");

  // (c) heuristic: raw LCB "Usable Marijuana" alone → flower.
  const c1 = resolveWebsiteCategory({ inventoryType: "Usable Marijuana", productName: "Wedding Cake" });
  eq(c1.websiteCategory, "flower", "(c) Usable Marijuana → flower");
  eq(c1.source, "heuristic", "(c) source=heuristic");

  // (c) name beats coarse type: "Usable Marijuana" + Moon Rocks name → infused-flower.
  eq(
    resolveWebsiteCategory({ inventoryType: "Usable Marijuana", productName: "Moon Rocks Jar" }).websiteCategory,
    "infused-flower",
    "(c) name Moon Rocks → infused-flower even when type says usable",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "Usable Marijuana", productName: "Popcorn Bud 7g" }).websiteCategory,
    "popcorn-bud",
    "(c) name Popcorn → popcorn-bud",
  );

  // (c) coarse concentrate / preroll / edible readings.
  eq(resolveWebsiteCategory({ inventoryType: "Concentrate for Inhalation" }).websiteCategory, "concentrate", "(c) concentrate coarse");
  eq(resolveWebsiteCategory({ inventoryType: "Infused Pre-Roll Lot" }).websiteCategory, "infused-preroll", "(c) infused preroll coarse");
  eq(resolveWebsiteCategory({ inventoryType: "Liquid Edible" }).websiteCategory, "edible-liquid", "(c) liquid edible coarse");

  // -------------------------------------------------------------------------
  // H16b-9: multi-category "Mix Infused" name-reader (owner A). Same LCB type,
  // resolved by product NAME. Covers both modern (Cannabis) + legacy (Marijuana).
  // -------------------------------------------------------------------------
  const mixInfused = (name: string) =>
    resolveWebsiteCategory({ inventoryType: "Cannabis Mix Infused", productName: name });
  eq(mixInfused("Infused Preroll 1g").websiteCategory, "infused-preroll", "H16b-9 mix-infused preroll");
  eq(mixInfused("Infused Blunt 1.5g").websiteCategory, "infused-preroll", "H16b-9 mix-infused blunt → infused-preroll");
  eq(mixInfused("Infused Preroll 5-Pack").websiteCategory, "infused-preroll-pack", "H16b-9 mix-infused pack");
  eq(mixInfused("Infused 3pk Joints").websiteCategory, "infused-preroll-pack", "H16b-9 mix-infused 3pk");
  eq(mixInfused("Moon Rocks Jar 1g").websiteCategory, "infused-flower", "H16b-9 mix-infused moon rocks → infused-flower");
  eq(mixInfused("Infused Flower Jar 7g").websiteCategory, "infused-flower", "H16b-9 mix-infused flower-in-jar");
  eq(mixInfused("Caviar Nug").websiteCategory, "infused-flower", "H16b-9 mix-infused caviar");
  // ambiguous infused → infused-flower default (owner-confirmed).
  eq(mixInfused("Special Reserve 1g").websiteCategory, "infused-flower", "H16b-9 mix-infused ambiguous → infused-flower");
  eq(mixInfused("Infused Preroll 1g").source, "heuristic", "H16b-9 mix-infused via heuristic");
  // legacy "Marijuana Mix Infused" naming resolves the same way.
  eq(
    resolveWebsiteCategory({ inventoryType: "Marijuana Mix Infused", productName: "Infused Blunt" }).websiteCategory,
    "infused-preroll",
    "H16b-9 legacy Marijuana Mix Infused blunt",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "Marijuana Mix Infused", productName: "5pk Infused Prerolls" }).websiteCategory,
    "infused-preroll-pack",
    "H16b-9 legacy Marijuana Mix Infused pack",
  );

  // pack beats single preroll when both words appear.
  eq(readMixInfusedByName("Infused Preroll 5 Pack"), "infused-preroll-pack", "H16b-9 pack beats single preroll");
  // direct name-reader unit tests.
  eq(readMixInfusedByName("2-pack blunts"), "infused-preroll-pack", "H16b-9 2-pack blunts → pack");
  eq(readMixInfusedByName("Joint"), "infused-preroll", "H16b-9 joint → infused-preroll");
  eq(readMixInfusedByName(""), "infused-flower", "H16b-9 empty name → infused-flower default");

  // -------------------------------------------------------------------------
  // H16b-9: "Mix Packaged" (NON-infused mixed flower/shake) → trim (owner B).
  // Must NOT be pulled into flower by the word "flower" nor into mix-infused.
  // -------------------------------------------------------------------------
  eq(
    resolveWebsiteCategory({ inventoryType: "Cannabis Mix Packaged", productName: "Mixed Flower Bag 14g" }).websiteCategory,
    "trim",
    "H16b-9 Cannabis Mix Packaged → trim",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "Marijuana Mix Packaged", productName: "Shake 28g" }).websiteCategory,
    "trim",
    "H16b-9 legacy Marijuana Mix Packaged → trim",
  );

  // -------------------------------------------------------------------------
  // H16b-9: Cannabis Mix (intermediate trim mix) → trim (owner D).
  // -------------------------------------------------------------------------
  eq(
    resolveWebsiteCategory({ inventoryType: "Cannabis Mix", productName: "Trim Mix" }).websiteCategory,
    "trim",
    "H16b-9 Cannabis Mix intermediate → trim",
  );

  // -------------------------------------------------------------------------
  // H16b-9: Suppository / Transdermal (CCRS EndProduct) → topical (owner C).
  // -------------------------------------------------------------------------
  eq(resolveWebsiteCategory({ inventoryType: "Suppository", productName: "Suppository 50mg" }).websiteCategory, "topical", "H16b-9 Suppository → topical");
  eq(resolveWebsiteCategory({ inventoryType: "Transdermal", productName: "Patch 20mg" }).websiteCategory, "topical", "H16b-9 Transdermal → topical");
  eq(resolveWebsiteCategory({ inventoryType: "Topical Ointment", productName: "Balm" }).websiteCategory, "topical", "H16b-9 Topical Ointment → topical");

  // -------------------------------------------------------------------------
  // H16b-9: Sample Jar resolves by product FORM (owner E); smell/sniff jar is a
  // distinct sub-type tracked as flower. Samples never hit the public menu.
  // -------------------------------------------------------------------------
  eq(
    resolveWebsiteCategory({ inventoryType: "Sample Jar", productName: "Blue Dream 3.5g" }).websiteCategory,
    "flower",
    "H16b-9 Sample Jar flower → flower",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "Sample Jar", productName: "Live Resin 1g" }).websiteCategory,
    "concentrate",
    "H16b-9 Sample Jar concentrate → concentrate",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "Sample Jar", productName: "Gummies 100mg" }).websiteCategory,
    "edible-solid",
    "H16b-9 Sample Jar edible → edible-solid",
  );
  // smell/sniff jar detection + form fallback.
  const smell = readSampleJarByName("Blue Dream Smell Jar");
  ok(smell.smellJar, "H16b-9 smell jar detected");
  eq(smell.formCategory, "flower", "H16b-9 smell jar tracked as flower");
  const sniff = readSampleJarByName("Sniff Jar - Gelato");
  ok(sniff.smellJar, "H16b-9 sniff jar detected");
  eq(sniff.formCategory, "flower", "H16b-9 sniff jar → flower");
  const notSmell = readSampleJarByName("Live Resin 1g");
  ok(!notSmell.smellJar, "H16b-9 non-smell sample jar not flagged");
  eq(notSmell.formCategory, "concentrate", "H16b-9 non-smell sample jar form=concentrate");
  // Sample Jar with no name clue → flower (safe form default).
  eq(readSampleJarByName("").formCategory, "flower", "H16b-9 empty sample jar → flower");

  // -------------------------------------------------------------------------
  // H17: "Usable Marijuana" is MULTI-category — read the name. Product names
  // below are VERBATIM from the owner's real SPR manifest (ORD-24706), where
  // every one of these arrived as inventory_type "Usable Marijuana".
  // -------------------------------------------------------------------------
  const usable = (name: string) =>
    resolveWebsiteCategory({ inventoryType: "Usable Marijuana", productName: name });
  eq(usable("SPR - Sour Diesel - 3.5g").websiteCategory, "flower", "H17 usable flower stays flower");
  eq(
    usable("SPR - Variety Pack - 5pk Joint Tin (5g) #1").websiteCategory,
    "preroll-pack",
    "H17 usable 5pk Joint Tin → preroll-pack (the owner's screenshot bug)",
  );
  eq(usable("House Joint 1g").websiteCategory, "preroll", "H17 usable joint → preroll");
  eq(usable("Classic Blunt 1.5g").websiteCategory, "preroll", "H17 usable blunt → preroll");
  eq(usable("Gelato Pre-Roll 0.5g").websiteCategory, "preroll", "H17 usable pre-roll → preroll");
  eq(usable("Popcorn Buds 7g").websiteCategory, "popcorn-bud", "H17 usable popcorn → popcorn-bud");
  eq(usable("Moon Rocks 3.5g").websiteCategory, "infused-flower", "H17 usable moon rocks → infused-flower");
  // A numbered pack WITHOUT a preroll word stays flower (pack of jars).
  eq(usable("Fruity 2 Pack Jars 7g").websiteCategory, "flower", "H17 usable non-preroll pack stays flower");
  eq(usable("SPR - Sour Diesel - 1g").source, "heuristic", "H17 usable resolves via heuristic (name-read)");
  // "Usable Cannabis" (modern CCRS naming) reads the same way.
  eq(
    resolveWebsiteCategory({ inventoryType: "Usable Cannabis", productName: "5pk Joints Tin" }).websiteCategory,
    "preroll-pack",
    "H17 Usable Cannabis reads name too",
  );
  // Precedence (a) still beats the multi-category bypass — per-product truth.
  eq(
    resolveWebsiteCategory(
      { inventoryType: "Usable Marijuana", productName: "5pk Joint Tin" },
      { menuItemCategory: "preroll-pack" },
    ).source,
    "menu_item",
    "H17 menu_item precedence intact over multi-category bypass",
  );
  // A flat DB mapping for a multi-category type must NOT flatten joints to
  // flower: the bypass skips (b) for these types.
  const usableOverlay = buildStaticInventoryTypeMap();
  usableOverlay.set(inventoryTypeKey("Usable Marijuana"), "flower");
  eq(
    resolveWebsiteCategory(
      { inventoryType: "Usable Marijuana", productName: "5pk Joint Tin" },
      { inventoryTypeMap: usableOverlay },
    ).websiteCategory,
    "preroll-pack",
    "H17 multi-category type bypasses a flat (b) mapping",
  );
  // isMultiCategoryLcbType classification.
  ok(isMultiCategoryLcbType("Usable Marijuana"), "H17 usable is multi");
  ok(isMultiCategoryLcbType("Cannabis Mix Infused"), "H17 mix infused is multi");
  ok(isMultiCategoryLcbType("Sample Jar"), "H17 sample jar is multi");
  ok(!isMultiCategoryLcbType("Cannabis Mix Packaged"), "H17 mix packaged NOT multi (always trim)");
  ok(!isMultiCategoryLcbType("Concentrate For Inhalation"), "H17 concentrate not multi");
  ok(!isMultiCategoryLcbType(null), "H17 null type not multi");
  // readUsableMarijuanaByName direct units.
  eq(readUsableMarijuanaByName("5pk Joint Tin"), "preroll-pack", "H17 reader pack");
  eq(readUsableMarijuanaByName("Infused Blunt"), "preroll", "H17 reader blunt (no infused type context)");
  eq(readUsableMarijuanaByName(""), "flower", "H17 reader empty → flower");

  // (d) unmapped: unknown gibberish, no name signal → unmapped, raw preserved.
  const d = resolveWebsiteCategory({ inventoryType: "Zorptonium Widget", productName: "Mystery Thing" });
  eq(d.websiteCategory, null, "(d) unknown → null");
  ok(d.unmapped, "(d) unmapped flag set");
  eq(d.source, "unmapped", "(d) source=unmapped");
  eq(d.label, "Zorptonium Widget", "(d) label = raw for unmapped");
  eq(d.raw, "Zorptonium Widget", "(d) raw preserved");

  // (d) empty lot → unmapped, label 'Unmapped'.
  const dEmpty = resolveWebsiteCategory({});
  ok(dEmpty.unmapped, "(d) empty → unmapped");
  eq(dEmpty.label, "Unmapped", "(d) empty label");
  eq(dEmpty.raw, null, "(d) empty raw null");

  // DB overlay map wins by key over the static catalog.
  const overlay = buildStaticInventoryTypeMap();
  overlay.set(inventoryTypeKey("BHO"), "trim"); // pretend owner remapped BHO
  eq(
    resolveWebsiteCategory({ inventoryType: "BHO" }, { inventoryTypeMap: overlay }).websiteCategory,
    "trim",
    "DB overlay map overrides catalog",
  );

  // Static map has expected size (every catalog entry).
  ok(buildStaticInventoryTypeMap().size >= 1, "static map built");

  // Labels resolve for a couple of categories.
  eq(websiteCategoryLabel("concentrate"), "Concentrate", "label concentrate");
  eq(websiteCategoryLabel("edible-solid"), "Edible (Solid)", "label edible-solid");
  eq(websiteCategoryLabel(null), "", "label null → empty");

  // -------------------------------------------------------------------------
  // SLICE 63 (owner bug B4): vape hardware under inhalation-concentrate LCB
  // types must land in cartridge/disposable-cartridge, not concentrate — the
  // NAME separates a cart from a dab. Dab-shaped names keep concentrate.
  // -------------------------------------------------------------------------
  eq(
    resolveWebsiteCategory({ inventoryType: "Concentrate for Inhalation", productName: "2727 - Live Resin Cart - GG4 1g" }).websiteCategory,
    "cartridge",
    "B4: cart token under Concentrate for Inhalation → cartridge",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "Hydrocarbon Concentrate", productName: "Dank Czar Vape 0.5g" }).websiteCategory,
    "cartridge",
    "B4: vape token → cartridge",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "Concentrate for Inhalation", productName: "Fairwinds Disposable 0.3g" }).websiteCategory,
    "disposable-cartridge",
    "B4: disposable token → disposable-cartridge",
  );
  eq(
    resolveWebsiteCategory({ inventoryType: "Concentrate for Inhalation", productName: "GMO Live Resin 1g" }).websiteCategory,
    "concentrate",
    "B4: dab-shaped name stays concentrate",
  );

  console.log(`website-category-resolver: ${pass} assertions passed`);
}

// Allow direct execution via tsx for quick verification.
declare const require: undefined | { main?: unknown };
// eslint-disable-next-line @next/next/no-assign-module-variable
declare const module: unknown;
if (typeof require !== "undefined" && (require as { main?: unknown }).main === (module as unknown)) {
  __runWebsiteCategoryResolverTests();
}
