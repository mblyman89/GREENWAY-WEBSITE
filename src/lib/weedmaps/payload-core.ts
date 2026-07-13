// Pure mapper: Greenway SyndicationItem[] -> Weedmaps Menu API (2025-07)
// Request_MenuItem write payloads (Indirect Management: upsert by external_id).
//
// Grounded in the owner-supplied Weedmaps docs (docs/weedmaps-menu-api.md) AND the
// live OpenAPI Request_MenuItem schema re-verified from developer.weedmaps.com
// (recorded in docs/LEAFLY_WEEDMAPS_INTEGRATION_RESEARCH.md). Verified rules:
//   - There is NO bulk endpoint: every write is one item via
//     PUT /menus/{menu_id}/items/external/{external_id} (name required).
//   - external_id is REQUIRED and must be STABLE (our POS product key, never a
//     batch id). Churn destroys curated brand/product links.
//   - Categories REQUIRED (one root): `category_names` string[] (likeness-matched)
//     XOR `category_ids` int[]. We hold no Weedmaps ids, so we send names.
//   - `variants[]` is THE price/inventory carrier. Each variant REQUIRES
//     external_id + price {amount:"35.00",currency:"USD"} (decimal-string DOLLARS)
//     + weight {unit: g|mg|kg|oz|lb, value}. Optional inventory_quantity int
//     (MINIMUM 1 — omit when out of stock) and online_orderable.
//   - DEPRECATED top-level fields are never sent: price, inventory_quantity,
//     items_per_pack, license_type, online_orderable, compliance,
//     cart_quantity_multiplier, sale.
//   - `genetics` enum indica|sativa|hybrid or null.
//   - `published` boolean controls public visibility — we unpublish out-of-stock
//     items instead of deleting them so Weedmaps-side curation is preserved.
//   - cannabinoids[] use the Measurement request shape
//     {id|slug, percentage:{min,max}, milligrams:{min,max}}.
//   - image_url: https JPG/PNG, host must answer HEAD 200; only the product's
//     own exact photo is ever supplied (feed-source guarantees this).
//
// This module is PURE (no DB, no network, no "server-only") so it can be
// unit-tested directly with tsx.

import type { SyndicationItem, SyndicationVariant } from "../syndication/menu-feed-core";

export type WmCannabinoidMeasurement = {
  slug: string;
  percentage?: { min: number; max: number };
};

export type WmPrice = {
  /** Decimal string in WHOLE currency units (dollars), e.g. "35.00". */
  amount: string;
  currency: "USD";
};

export type WmWeightUnit = "g" | "mg" | "kg" | "oz" | "lb";

export type WmWeight = {
  unit: WmWeightUnit;
  value: number;
};

export type WmVariant = {
  external_id: string;
  price: WmPrice;
  /**
   * REQUIRED by the verified schema. `null` here means the variant label could
   * not be parsed into a weight — preflight validation flags these so the owner
   * fixes the source data BEFORE a live push (we never invent a weight).
   */
  weight: WmWeight | null;
  /** Integer count, MINIMUM 1 per the schema — omitted entirely when out of stock. */
  inventory_quantity?: number;
};

export type WmGenetics = "indica" | "sativa" | "hybrid";

export type WmMenuItem = {
  external_id: string;
  name: string;
  description?: string;
  /** Likeness-matched category names; we send our single verified root (L1) name. */
  category_names: string[];
  brand_name?: string;
  strain_name?: string;
  genetics?: WmGenetics | null;
  cannabinoids?: WmCannabinoidMeasurement[];
  /** Exact product photo only (feed guarantees non-fallback); https JPG/PNG. */
  image_url?: string;
  /** Public visibility on Weedmaps — false (not deletion) for out-of-stock items. */
  published: boolean;
  variants: WmVariant[];
};

export type WmItemsPayload = {
  items: WmMenuItem[];
};

// Map our internal Greenway categories -> a single Weedmaps ROOT (L1) category NAME.
// Verified L1 list: Concentrates, Cultivation, Drinks, Edibles, Flower, Gear,
// Infused Pre Roll, Other, Pre Roll, Vape Pens, Wellness.
const CATEGORY_TO_WM_ROOT: Record<string, string> = {
  flower: "Flower",
  "popcorn-bud": "Flower",
  "infused-flower": "Flower",
  trim: "Flower",
  preroll: "Pre Roll",
  "preroll-pack": "Pre Roll",
  blunt: "Pre Roll",
  "infused-preroll": "Infused Pre Roll",
  "infused-preroll-pack": "Infused Pre Roll",
  "infused-blunt": "Infused Pre Roll",
  concentrate: "Concentrates",
  rso: "Concentrates",
  cartridge: "Vape Pens",
  "disposable-cartridge": "Vape Pens",
  "edible-solid": "Edibles",
  "edible-liquid": "Drinks",
  tincture: "Wellness",
  topical: "Wellness",
  paraphernalia: "Gear",
  accessories: "Gear",
  merch: "Other",
};

export function toWmRootCategory(category: string): string {
  return CATEGORY_TO_WM_ROOT[category] ?? "Other";
}

// Map our normalized strain vocabulary -> the verified genetics enum.
// indica-hybrid / sativa-hybrid are OUR display leanings; the Weedmaps enum only
// accepts indica|sativa|hybrid, so leanings collapse to hybrid. cbd/unknown -> null.
export function toWmGenetics(strainType: string | null | undefined): WmGenetics | null {
  const v = (strainType ?? "").trim().toLowerCase();
  if (v === "indica") return "indica";
  if (v === "sativa") return "sativa";
  if (v === "hybrid" || v === "indica-hybrid" || v === "sativa-hybrid") return "hybrid";
  return null;
}

// Strip markup -> plain text (descriptions are consumer-facing copy).
export function toPlainText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

// Convert minor units (cents) -> decimal string "10.00" (verified: Price.amount is a
// decimal string in whole currency units).
export function priceString(minorUnits: number): string {
  return (Math.round(minorUnits) / 100).toFixed(2);
}

export function toWmPrice(minorUnits: number): WmPrice {
  return { amount: priceString(minorUnits), currency: "USD" };
}

// Parse a variant label like "3.5g", "1 oz", "100mg", "1/8 oz" into the verified
// weight object. Returns null when no confident weight token exists (e.g. "10pk",
// "each") — we NEVER invent a weight; preflight validation surfaces these.
const WEIGHT_UNIT_ALIASES: Record<string, WmWeightUnit> = {
  g: "g",
  gram: "g",
  grams: "g",
  mg: "mg",
  milligram: "mg",
  milligrams: "mg",
  kg: "kg",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
};

export function parseWeightFromLabel(label: string | null | undefined): WmWeight | null {
  if (!label) return null;
  const text = String(label).toLowerCase();
  // Fraction form first: "1/8 oz", "1/2g".
  const frac = text.match(/(\d+)\s*\/\s*(\d+)\s*(g|gram|grams|mg|milligrams?|kg|oz|ounces?|lbs?|pounds?)\b/);
  if (frac) {
    const num = Number.parseInt(frac[1], 10);
    const den = Number.parseInt(frac[2], 10);
    const unit = WEIGHT_UNIT_ALIASES[frac[3]];
    if (unit && den > 0) {
      const value = num / den;
      if (Number.isFinite(value) && value > 0) return { unit, value };
    }
  }
  // Decimal form: "3.5g", "1 oz", ".5 g", "100mg".
  const dec = text.match(/(\d*\.?\d+)\s*(g|gram|grams|mg|milligrams?|kg|oz|ounces?|lbs?|pounds?)\b/);
  if (dec) {
    const value = Number.parseFloat(dec[1]);
    const unit = WEIGHT_UNIT_ALIASES[dec[2]];
    if (unit && Number.isFinite(value) && value > 0) return { unit, value };
  }
  return null;
}

// Parse a stored percentage string (e.g. "21.4", "21.4%") -> a single-point min=max
// percentage Measurement. Absent/unparseable -> undefined (omit, never 0).
export function toCannabinoid(
  slug: string,
  raw: string | number | null | undefined,
): WmCannabinoidMeasurement | undefined {
  if (raw == null) return undefined;
  const asString = String(raw).trim();
  if (asString.length === 0) return undefined;
  // Our POS stores a single percentage figure; send it as a min=max percentage range.
  if (/mg/i.test(asString)) return undefined; // we only confidently have % values
  const numeric = Number.parseFloat(asString.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return undefined;
  return { slug, percentage: { min: numeric, max: numeric } };
}

export function toWmVariant(v: SyndicationVariant): WmVariant {
  const out: WmVariant = {
    external_id: v.id,
    price: toWmPrice(v.priceMinorUnits),
    weight: parseWeightFromLabel(v.label),
  };
  // inventory_quantity: integer, MINIMUM 1, omitted when out of stock (verified).
  if (v.inStock) {
    out.inventory_quantity = Math.max(1, Math.round(v.inventoryLevel));
  }
  return out;
}

export function toWmMenuItem(item: SyndicationItem): WmMenuItem {
  const cannabinoids: WmCannabinoidMeasurement[] = [];
  const thc = toCannabinoid("thc", item.thc);
  const cbd = toCannabinoid("cbd", item.cbd);
  if (thc) cannabinoids.push(thc);
  if (cbd) cannabinoids.push(cbd);

  const variants: WmVariant[] =
    item.variants.length > 0
      ? item.variants.map(toWmVariant)
      : [
          {
            external_id: `${item.id}-default`,
            price: toWmPrice(item.priceMinorUnits),
            weight: null,
            ...(item.inStock ? { inventory_quantity: 1 } : {}),
          },
        ];

  const out: WmMenuItem = {
    external_id: item.id,
    name: item.name,
    category_names: [toWmRootCategory(item.category)],
    // Out-of-stock -> unpublish (NOT delete) so Weedmaps-side curation survives.
    published: item.inStock,
    variants,
  };

  const description = toPlainText(item.description);
  if (description) out.description = description;
  const brand = item.brand && item.brand.trim().length > 0 ? item.brand.trim() : null;
  if (brand) out.brand_name = brand;
  const strain = item.strainName && item.strainName.trim().length > 0 ? item.strainName.trim() : null;
  if (strain) out.strain_name = strain;
  const genetics = toWmGenetics(item.strainType);
  if (genetics) out.genetics = genetics;
  if (cannabinoids.length > 0) out.cannabinoids = cannabinoids;
  if (item.imageUrl) out.image_url = item.imageUrl;

  return out;
}

export function buildWmItemsPayload(items: SyndicationItem[]): WmItemsPayload {
  return { items: items.map(toWmMenuItem) };
}

// ---------------------------------------------------------------------------
// Tests (run via tsx; this module is pure).
// ---------------------------------------------------------------------------
export function __runWmPayloadTests() {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  ok("flower->Flower", toWmRootCategory("flower") === "Flower");
  ok("cartridge->Vape Pens", toWmRootCategory("cartridge") === "Vape Pens");
  ok("edible-liquid->Drinks", toWmRootCategory("edible-liquid") === "Drinks");
  ok("infused-preroll->Infused Pre Roll", toWmRootCategory("infused-preroll") === "Infused Pre Roll");
  ok("tincture->Wellness", toWmRootCategory("tincture") === "Wellness");
  ok("accessories->Gear", toWmRootCategory("accessories") === "Gear");
  ok("unknown->Other", toWmRootCategory("zzz") === "Other");

  // genetics mapping (verified enum indica|sativa|hybrid|null)
  ok("genetics indica", toWmGenetics("indica") === "indica");
  ok("genetics sativa", toWmGenetics("sativa") === "sativa");
  ok("genetics hybrid", toWmGenetics("hybrid") === "hybrid");
  ok("genetics indica-hybrid collapses", toWmGenetics("indica-hybrid") === "hybrid");
  ok("genetics sativa-hybrid collapses", toWmGenetics("sativa-hybrid") === "hybrid");
  ok("genetics cbd -> null", toWmGenetics("cbd") === null);
  ok("genetics unknown -> null", toWmGenetics("unknown") === null);
  ok("genetics null -> null", toWmGenetics(null) === null);

  ok("plaintext strips tags", toPlainText("<p>Hi <b>there</b></p>") === "Hi there");
  ok("plaintext empty->null", toPlainText("  ") === null);

  ok("priceString cents->decimal", priceString(2000) === "20.00");
  ok("priceString rounds", priceString(1599.6) === "16.00");
  ok("priceString odd", priceString(1599) === "15.99");
  ok(
    "toWmPrice shape",
    JSON.stringify(toWmPrice(3500)) === JSON.stringify({ amount: "35.00", currency: "USD" }),
  );

  // weight parsing (verified units g|mg|kg|oz|lb; never invent)
  ok("weight 3.5g", JSON.stringify(parseWeightFromLabel("3.5g")) === JSON.stringify({ unit: "g", value: 3.5 }));
  ok("weight 1 oz", JSON.stringify(parseWeightFromLabel("1 oz")) === JSON.stringify({ unit: "oz", value: 1 }));
  ok("weight 100mg", JSON.stringify(parseWeightFromLabel("100mg")) === JSON.stringify({ unit: "mg", value: 100 }));
  ok("weight 1/8 oz", JSON.stringify(parseWeightFromLabel("1/8 oz")) === JSON.stringify({ unit: "oz", value: 0.125 }));
  ok("weight 1/2g", JSON.stringify(parseWeightFromLabel("1/2g")) === JSON.stringify({ unit: "g", value: 0.5 }));
  ok("weight 2 grams", JSON.stringify(parseWeightFromLabel("2 grams")) === JSON.stringify({ unit: "g", value: 2 }));
  ok("weight in preroll label", JSON.stringify(parseWeightFromLabel("1g Preroll")) === JSON.stringify({ unit: "g", value: 1 }));
  ok("weight 10pk -> null (never invent)", parseWeightFromLabel("10pk") === null);
  ok("weight each -> null", parseWeightFromLabel("each") === null);
  ok("weight empty -> null", parseWeightFromLabel("") === null);
  ok("weight null -> null", parseWeightFromLabel(null) === null);

  ok("cannabinoid pct", JSON.stringify(toCannabinoid("thc", "21.4%")) ===
    JSON.stringify({ slug: "thc", percentage: { min: 21.4, max: 21.4 } }));
  ok("cannabinoid absent->undefined", toCannabinoid("thc", "") === undefined);
  ok("cannabinoid null->undefined", toCannabinoid("thc", null) === undefined);
  ok("cannabinoid mg->undefined (only % confident)", toCannabinoid("cbd", "5 mg") === undefined);

  // variant mapping: verified shape (price object, weight, inventory_quantity min 1)
  const v: SyndicationVariant = { id: "v1", label: "3.5g", priceMinorUnits: 1500, inStock: true, inventoryLevel: 6 };
  const wv = toWmVariant(v);
  ok("variant external_id", wv.external_id === "v1");
  ok("variant price object", wv.price.amount === "15.00" && wv.price.currency === "USD");
  ok("variant weight parsed", wv.weight !== null && wv.weight.unit === "g" && wv.weight.value === 3.5);
  ok("variant inventory_quantity real count", wv.inventory_quantity === 6);

  const vOut: SyndicationVariant = { id: "v2", label: "1g", priceMinorUnits: 900, inStock: false, inventoryLevel: 0 };
  const wvOut = toWmVariant(vOut);
  ok("out-of-stock omits inventory_quantity", !("inventory_quantity" in wvOut));

  const vFloor: SyndicationVariant = { id: "v3", label: "1g", priceMinorUnits: 900, inStock: true, inventoryLevel: 0 };
  ok("in-stock floors inventory_quantity to 1 (schema minimum)", toWmVariant(vFloor).inventory_quantity === 1);

  // item with no variants -> synthesized default (weight null -> preflight flags it)
  const noVar: SyndicationItem = {
    id: "p1",
    name: "House Flower",
    brand: " Greenway ",
    category: "flower",
    strainType: "sativa-hybrid",
    strainName: " Blue Dream ",
    thc: "24.1%",
    cbd: null,
    description: "<p>Balanced &amp; smooth</p>",
    priceMinorUnits: 2000,
    inStock: true,
    variants: [],
    imageUrl: "https://cdn.example.com/blue-dream.jpg",
  };
  const wi = toWmMenuItem(noVar);
  ok("item external_id = id", wi.external_id === "p1");
  ok("item category_names array with root", wi.category_names.length === 1 && wi.category_names[0] === "Flower");
  ok("item brand trimmed", wi.brand_name === "Greenway");
  ok("item strain trimmed", wi.strain_name === "Blue Dream");
  ok("item genetics from strainType", wi.genetics === "hybrid");
  ok("item desc plaintext", wi.description === "Balanced & smooth");
  ok("item published when in stock", wi.published === true);
  ok("item image_url carried", wi.image_url === "https://cdn.example.com/blue-dream.jpg");
  ok("item cannabinoid thc only", wi.cannabinoids?.length === 1 && wi.cannabinoids[0].slug === "thc");
  ok("item synth variant id", wi.variants.length === 1 && wi.variants[0].external_id === "p1-default");
  ok("item synth variant weight null (never invented)", wi.variants[0].weight === null);
  ok("item synth variant qty 1", wi.variants[0].inventory_quantity === 1);
  ok("no deprecated top-level price", !("price" in wi));
  ok("no deprecated top-level inventory_quantity", !("inventory_quantity" in wi));

  // item with absent brand/strain/desc/image -> keys omitted; out of stock -> unpublished
  const bare: SyndicationItem = {
    id: "p2",
    name: "Gummies",
    brand: null,
    category: "edible-solid",
    strainType: "unknown",
    strainName: null,
    thc: null,
    cbd: null,
    description: "",
    priceMinorUnits: 1500,
    inStock: false,
    variants: [{ id: "x", label: "10pk", priceMinorUnits: 1500, inStock: false, inventoryLevel: 0 }],
  };
  const wb = toWmMenuItem(bare);
  ok("bare no brand_name key", !("brand_name" in wb));
  ok("bare no strain_name key", !("strain_name" in wb));
  ok("bare no genetics key", !("genetics" in wb));
  ok("bare no cannabinoids key", !("cannabinoids" in wb));
  ok("bare no description key", !("description" in wb));
  ok("bare no image_url key", !("image_url" in wb));
  ok("bare category Edibles", wb.category_names[0] === "Edibles");
  ok("bare out-of-stock unpublished (never deleted)", wb.published === false);
  ok("bare variant kept, weight null", wb.variants.length === 1 && wb.variants[0].weight === null);
  ok("bare variant omits qty", !("inventory_quantity" in wb.variants[0]));

  const payload = buildWmItemsPayload([noVar, bare]);
  ok("payload count", payload.items.length === 2);

  console.log(`wm-payload: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} wm-payload test(s) failed`);
}
