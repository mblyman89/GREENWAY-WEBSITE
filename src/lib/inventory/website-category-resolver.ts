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
    if (type.includes("flower") || type.includes("usable")) {
      // "Usable Marijuana" / "Usable Cannabis" / "Flower Lot" → flower, unless the
      // name already flagged infused/popcorn above.
      if (includesAny(name, INFUSED_FLOWER_KEYWORDS)) return "infused-flower";
      if (includesAny(name, POPCORN_KEYWORDS)) return "popcorn-bud";
      return "flower";
    }
    if (type.includes("pre-roll") || type.includes("preroll") || type.includes("pre roll")) {
      return type.includes("infused") ? "infused-preroll" : "preroll";
    }
    if (type.includes("cartridge") || type.includes("vape")) return "cartridge";
    if (type.includes("concentrate") || type.includes("extract") || type.includes("hash") || type.includes("rosin") || type.includes("resin")) {
      return "concentrate";
    }
    if (type.includes("capsule") || type.includes("edible") || type.includes("gummies") || type.includes("candy")) {
      return type.includes("liquid") || type.includes("beverage") ? "edible-liquid" : "edible-solid";
    }
    if (type.includes("beverage") || type.includes("drink") || type.includes("soda")) return "edible-liquid";
    if (type.includes("tincture")) return "tincture";
    if (type.includes("topical")) return "topical";
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

  // (b) inventory_types map by raw inventory_type label.
  if (raw) {
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

  console.log(`website-category-resolver: ${pass} assertions passed`);
}

// Allow direct execution via tsx for quick verification.
declare const require: undefined | { main?: unknown };
declare const module: unknown;
if (typeof require !== "undefined" && (require as { main?: unknown }).main === (module as unknown)) {
  __runWebsiteCategoryResolverTests();
}
