/**
 * src/lib/inventory/house-type-core.ts  (SLICE 63 — house type labeler)
 *
 * Owner rule (E1): OUR product types on screen, CCRS/LCB values under the
 * hood. This module derives Greenway's HOUSE product type ("Live Resin
 * Cartridge", "Gummies", "Infused Blunt", …) from the two honest signals a
 * manifest line carries — the raw LCB inventory type and the product NAME —
 * and reports a CONFIDENCE score so callers only auto-assign when sure.
 *
 * VOCABULARY IS CLOSED: every house type this module can emit is a label from
 * INVENTORY_TYPE_CATALOG (src/lib/pos/inventory-type-catalog.ts), the same
 * catalog that maps POS types onto website categories for the Cultivera
 * pipeline (E2: two pipelines, one brain). A self-test asserts every name
 * rule's label exists in the catalog, so the labeler can never invent a type
 * that lacks a website-category mapping.
 *
 * CONFIDENCE MODEL (owner directive: "≥90 % auto-assigns"):
 *   100 — the raw inventory type IS a catalog label ("Live Resin", "Gummies"):
 *         the source already speaks our vocabulary.
 *    95 — the NAME names a house type AND its catalog website category AGREES
 *         with the resolver's website category for the line (two independent
 *         signals concur).
 *    90 — the NAME names a house type and no website category was provided to
 *         cross-check (single signal, still auto-assignable).
 *    60 — the NAME names a house type but its category DISAGREES with the
 *         resolved website category (e.g. the strain "Ice Cream Cake" tripping
 *         a topical keyword on a flower lot) — below threshold, a human picks
 *         (SLICE 64).
 *     0 — no signal. Callers fall back to the generic website-category label.
 *
 * PURE: no I/O, no React. Registered in the pure self-test runner.
 */
import {
  INVENTORY_TYPE_CATALOG,
  inventoryTypeKey,
  type InventoryTypeCatalogEntry,
} from "@/lib/pos/inventory-type-catalog";

/** Auto-assignment threshold (owner: "≥90 % confidence auto-assigns"). */
export const HOUSE_TYPE_MIN_AUTO_CONFIDENCE = 90;

export type HouseTypeSource = "inventory_type" | "name" | "none";

export type HouseTypeInput = {
  /** Raw product name from the manifest/POS — read word by word. */
  productName?: string | null;
  /** Raw LCB/POS inventory type as stored ("Solid Edible", "Live Resin"). */
  inventoryType?: string | null;
  /**
   * Website category already resolved for this line (category-taxonomy value),
   * used ONLY to cross-check a name match — never to invent a type.
   */
  websiteCategory?: string | null;
};

export type HouseTypeResult = {
  /** A catalog label ("Live Resin Cartridge") or null when nothing matched. */
  houseType: string | null;
  /** The catalog website category the house type rolls up to (null when none). */
  websiteCategory: string | null;
  /** 0–100 per the model documented above. */
  confidence: number;
  source: HouseTypeSource;
};

const CATALOG_BY_KEY = new Map<string, InventoryTypeCatalogEntry>(
  INVENTORY_TYPE_CATALOG.map((e) => [inventoryTypeKey(e.label), e]),
);
const CATEGORY_BY_LABEL = new Map<string, string>(
  INVENTORY_TYPE_CATALOG.map((e) => [e.label, e.websiteCategory]),
);

/**
 * Ordered name rules — FIRST match wins, so composites ("Live Resin" + cart
 * token → "Live Resin Cartridge") and multi-word specifics ("Hash Rosin",
 * "Bubble Hash") sit ABOVE their single-word parents, and edible keywords sit
 * ABOVE ambiguous concentrate words ("Sugar" the concentrate vs "Brown Sugar"
 * the gummy flavor). Every label MUST exist in INVENTORY_TYPE_CATALOG — the
 * self-test enforces it.
 */
export const HOUSE_TYPE_NAME_RULES: ReadonlyArray<{ re: RegExp; label: string }> = [
  // --- vape family (composites before parents) --------------------------
  { re: /\blive\s*resin\b[\s\S]*\b(?:cart(?:ridge)?s?|vapes?|pods?)\b|\b(?:cart(?:ridge)?s?|vapes?|pods?)\b[\s\S]*\blive\s*resin\b/i, label: "Live Resin Cartridge" },
  { re: /\bdisposables?\b/i, label: "Disposable Cartridge" },
  { re: /\bcart(?:ridge)?s?\b|\bvapes?\b/i, label: "Cartridge" },
  { re: /\bpods?\b/i, label: "Pod" },
  // --- preroll family ----------------------------------------------------
  { re: /\binfused\b[\s\S]*\bblunts?\b|\bblunts?\b[\s\S]*\binfused\b/i, label: "Infused Blunt" },
  { re: /\bblunts?\b/i, label: "Blunt" },
  { re: /\binfused\b[\s\S]*\b(?:pre[-\s]?rolls?|joints?)\b|\b(?:pre[-\s]?rolls?|joints?)\b[\s\S]*\binfused\b/i, label: "Infused Pre-roll" },
  { re: /\bpre[-\s]?rolls?\b|\bjoints?\b/i, label: "Pre-roll" },
  // --- infused / specialty flower -----------------------------------------
  { re: /\bmoon\s*rocks?\b/i, label: "Moon Rocks" },
  { re: /\bpopcorn\b/i, label: "Popcorn Bud" },
  // --- solid edibles (ABOVE concentrates: flavor words beat "Sugar" etc.) --
  { re: /\bgumm/i, label: "Gummies" },
  { re: /\bchocolates?\b/i, label: "Chocolate" },
  { re: /\b(?:pepper)?mints?\b/i, label: "Mints" },
  { re: /\bcapsules?\b/i, label: "Capsule" },
  { re: /\bhard\s+cand(?:y|ies)\b/i, label: "Hard Candy" },
  { re: /\bmarmas?\b/i, label: "Marmas" },
  { re: /\bpeanut\s+butter\s+cups?\b/i, label: "Peanut Butter Cups" },
  { re: /\b(?:fruit\s+)?chews?\b/i, label: "Fruit Chews" },
  { re: /\bchewees?\b/i, label: "Chewees" },
  { re: /\bbites?\b/i, label: "Bites" },
  { re: /\bballs\b/i, label: "Balls" },
  { re: /\bedibles?\b/i, label: "Edible" },
  // --- liquid edibles ------------------------------------------------------
  { re: /\bsodas?\b/i, label: "Soda" },
  { re: /\bshots?\b/i, label: "Shots" },
  { re: /\b(?:beverage|drink)s?\b/i, label: "Beverage" },
  { re: /\btinctures?\b/i, label: "Tincture" },
  // --- topicals ------------------------------------------------------------
  { re: /\bbath\s+salts?\b/i, label: "Bath Salts" },
  { re: /\broll[-\s]?on\b/i, label: "Roll On" },
  { re: /\b(?:topical|balm|salve|lotion|ointment)s?\b/i, label: "Topical" },
  // --- concentrates (composites first) -------------------------------------
  { re: /\bhash\s+rosin\b/i, label: "Hash Rosin" },
  { re: /\brosin\b/i, label: "Rosin" },
  { re: /\bbubble\s+hash\b/i, label: "Bubble Hash" },
  { re: /\bhash\b/i, label: "Hash" },
  { re: /\blive\s*resin\b/i, label: "Live Resin" },
  { re: /\bloud\s*resin\b/i, label: "Loud Resin" },
  { re: /\bshatter\b/i, label: "Shatter" },
  { re: /\b(?:badder|batter|budder)\b/i, label: "Badder" },
  { re: /\bcrumble\b/i, label: "Crumble" },
  { re: /\bdiamonds?\b/i, label: "Diamonds" },
  { re: /\bdistillate\b/i, label: "Distillate" },
  { re: /\bbho\b/i, label: "BHO" },
  { re: /\brso\b/i, label: "RSO" },
  { re: /\bterp\s+sauce\b/i, label: "Terp Sauce" },
  { re: /\bterp\s+crystals?\b/i, label: "Terp Crystals" },
  { re: /\bthca\b/i, label: "THCa" },
  { re: /\bsugar\b/i, label: "Sugar" },
  // --- flower / trim last (weakest name signals) ---------------------------
  { re: /\bflower\b/i, label: "Flower" },
  { re: /\btrim\b|\bshake\b/i, label: "Trim" },
];

/**
 * The four CCRS InventoryCategory values (verified against
 * CCRS_INVENTORY_CATEGORIES in src/lib/compliance/ccrs-batch-core.ts, Table 2
 * of the 2026-02 Upload User Guide). Intake stores the manifest's raw
 * inventory_category in lots.category, so these blobs leak into the back
 * office TYPE column (owner bug B1) unless callers screen them out.
 */
const CCRS_CATEGORY_BLOBS = new Set([
  "propagationmaterial",
  "harvestedmaterial",
  "intermediateproduct",
  "endproduct",
]);

/** True when a stored category value is a raw CCRS InventoryCategory blob. */
export function isCcrsCategoryBlob(value: string | null | undefined): boolean {
  return CCRS_CATEGORY_BLOBS.has(String(value ?? "").trim().toLowerCase().replace(/\s+/g, ""));
}

/**
 * Derive the house type + confidence for one line. Deterministic and honest:
 * a closed vocabulary, explicit source, and a score the caller compares to
 * HOUSE_TYPE_MIN_AUTO_CONFIDENCE — below it, a human decides (SLICE 64).
 */
export function deriveHouseType(input: HouseTypeInput): HouseTypeResult {
  // 1) The raw type already speaks our vocabulary → certainty.
  const rawType = String(input.inventoryType ?? "").trim();
  if (rawType) {
    const entry = CATALOG_BY_KEY.get(inventoryTypeKey(rawType));
    if (entry) {
      return {
        houseType: entry.label,
        websiteCategory: entry.websiteCategory,
        confidence: 100,
        source: "inventory_type",
      };
    }
  }

  // 2) Read the product NAME against the ordered rules.
  const name = String(input.productName ?? "").trim();
  if (name) {
    for (const rule of HOUSE_TYPE_NAME_RULES) {
      if (!rule.re.test(name)) continue;
      const cat = CATEGORY_BY_LABEL.get(rule.label) ?? null;
      const provided = String(input.websiteCategory ?? "").trim() || null;
      const confidence = provided ? (provided === cat ? 95 : 60) : 90;
      return { houseType: rule.label, websiteCategory: cat, confidence, source: "name" };
    }
  }

  // 3) No signal — never guess.
  return { houseType: null, websiteCategory: null, confidence: 0, source: "none" };
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */
export function __runHouseTypeCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`house-type-core self-test failed: ${msg}`);
    passed += 1;
  };

  // Closed vocabulary: every rule label must exist in the catalog so every
  // emitted house type has a website-category mapping.
  for (const rule of HOUSE_TYPE_NAME_RULES) {
    ok(CATEGORY_BY_LABEL.has(rule.label), `rule label "${rule.label}" exists in INVENTORY_TYPE_CATALOG`);
  }

  // 100: raw type IS a catalog label (any casing/spacing).
  const t1 = deriveHouseType({ inventoryType: "live resin", productName: "whatever" });
  ok(t1.houseType === "Live Resin" && t1.confidence === 100 && t1.source === "inventory_type", "catalog type passthrough = 100");
  ok(t1.websiteCategory === "concentrate", "catalog type carries its website category");
  const t2 = deriveHouseType({ inventoryType: "  GUMMIES  " });
  ok(t2.houseType === "Gummies" && t2.confidence === 100, "catalog match is case/space-insensitive");

  // CCRS LCB types are NOT catalog labels → the NAME decides.
  const cart = deriveHouseType({
    inventoryType: "Concentrate for Inhalation",
    productName: "2727 - Live Resin Cart - GG4 1g",
    websiteCategory: "cartridge",
  });
  ok(cart.houseType === "Live Resin Cartridge", "live resin + cart token composes the catalog label");
  ok(cart.confidence === 95 && cart.source === "name", "name + agreeing category = 95");
  ok(cart.websiteCategory === "cartridge", "composed label maps to cartridge (kills B4)");

  const gum = deriveHouseType({
    inventoryType: "Solid Edible",
    productName: "Cantina Gummies - Guava 10 Pack 400mg",
    websiteCategory: "edible-solid",
  });
  ok(gum.houseType === "Gummies" && gum.confidence === 95, "gummies from the name, category agrees");

  // 90: name signal with no category to cross-check.
  const solo = deriveHouseType({ productName: "GMO Bubble Hash 1g" });
  ok(solo.houseType === "Bubble Hash" && solo.confidence === 90, "name-only match = 90");

  // 60: disagreement — the strain "Ice Cream Cake" must NOT type a flower lot
  // as anything but flower; the balm keyword ("cream" is deliberately absent,
  // this uses "balm") shows the guard.
  const clash = deriveHouseType({
    inventoryType: "Usable Marijuana",
    productName: "Lemon Balm Kush 3.5g",
    websiteCategory: "flower",
  });
  ok(clash.houseType === "Topical" && clash.confidence === 60, "category disagreement drops to 60 (human decides)");
  ok(clash.confidence < HOUSE_TYPE_MIN_AUTO_CONFIDENCE, "60 is below the auto threshold");

  // Strain names with no type words: no signal, never guess.
  const none = deriveHouseType({ inventoryType: "Usable Marijuana", productName: "Blue Dream 3.5g", websiteCategory: "flower" });
  ok(none.houseType === null && none.confidence === 0 && none.source === "none", "no signal = null, never guessed");

  // Ordering: composites and edible flavors beat single-word concentrate rules.
  ok(deriveHouseType({ productName: "Hash Rosin 1g" }).houseType === "Hash Rosin", "hash rosin beats hash/rosin");
  ok(deriveHouseType({ productName: "Brown Sugar Gummies 100mg" }).houseType === "Gummies", "gummy flavor beats Sugar concentrate");
  ok(deriveHouseType({ productName: "GG4 Sugar 1g" }).houseType === "Sugar", "plain sugar concentrate still matches");
  ok(deriveHouseType({ productName: "THCA Diamonds 1g" }).houseType === "Diamonds", "diamonds beats thca");
  ok(deriveHouseType({ productName: "Infused Blunt 1.5g" }).houseType === "Infused Blunt", "infused blunt composite");
  ok(deriveHouseType({ productName: "5pk Joint Tin (5g)" }).houseType === "Pre-roll", "joints read as prerolls");
  ok(deriveHouseType({ productName: "Moxey Balance 3:1 Peppermints 300mg" }).houseType === "Mints", "peppermints read as mints");
  ok(deriveHouseType({ productName: "Dank Czar Disposable 0.5g" }).houseType === "Disposable Cartridge", "disposable vape");
  ok(deriveHouseType({ productName: "Kelly's Sweet Hash Edibles - Cookie Dough" }).houseType === "Edible", "edible word beats hash for edible lines");

  // Threshold constant is what the roadmap promised.
  ok(HOUSE_TYPE_MIN_AUTO_CONFIDENCE === 90, "auto threshold is 90");

  // CCRS blob detector (B1): the four InventoryCategory values are blobs;
  // real human types and LCB inventory TYPES are not.
  ok(isCcrsCategoryBlob("EndProduct"), "EndProduct is a blob");
  ok(isCcrsCategoryBlob("IntermediateProduct"), "IntermediateProduct is a blob");
  ok(isCcrsCategoryBlob("  end product "), "blob check is case/space-tolerant");
  ok(isCcrsCategoryBlob("HarvestedMaterial") && isCcrsCategoryBlob("PropagationMaterial"), "all four categories flagged");
  ok(!isCcrsCategoryBlob("Live Resin"), "human type is not a blob");
  ok(!isCcrsCategoryBlob("Usable Marijuana"), "LCB inventory TYPE is not a blob");
  ok(!isCcrsCategoryBlob(null) && !isCcrsCategoryBlob(""), "empty is not a blob");

  console.log(`house-type-core: ${passed} assertions passed`);
}
