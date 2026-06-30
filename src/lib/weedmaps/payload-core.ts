// Pure mapper: Greenway SyndicationItem[] -> Weedmaps Menu API (2025-07) menu-item
// write payloads (Indirect Management: upsert by external_id).
//
// Grounded entirely in owner-supplied Weedmaps docs. See docs/weedmaps-menu-api.md.
// Verified rules encoded here:
//   - external_id is REQUIRED and must be STABLE (our POS product key, not a batch).
//   - At least one Category is REQUIRED; exactly ONE root (L1). We send category_names
//     (likeness-matched) mapping each item to its single Weedmaps root category, because
//     we do not hold Weedmaps category_ids. (Sub-categories require the full parent id
//     chain, which we do not have, so we send the root only — valid and safe.)
//   - brand_name / strain_name are name-based likeness matches (unmatched silently ignored).
//   - cannabinoids[] use the Measurement shape {id|slug, percentage:{min,max}, milligrams:{min,max}}.
//
// TENTATIVE (docs reference the live "API Examples"/Menu Item Variants page rather than
// inlining the base item price/variant schema): the price/availability representation.
// We surface it under `_variants` (clearly namespaced) so the preview shows exactly what
// we would send and staff can validate against the live schema before any live push.
//
// This module is PURE (no DB, no network, no "server-only") so it can be unit-tested
// directly with tsx.

import type { SyndicationItem } from "../syndication/menu-feed-core";

export type WmCannabinoidMeasurement = {
  slug: string;
  percentage?: { min: number; max: number };
};

export type WmVariant = {
  external_id: string;
  label: string;
  // Weedmaps order payloads express price as a decimal string (e.g. "10.00").
  price: string;
  in_stock: boolean;
};

export type WmMenuItem = {
  external_id: string;
  name: string;
  description: string | null;
  category_names: string;
  brand_name?: string;
  strain_name?: string;
  cannabinoids?: WmCannabinoidMeasurement[];
  price: string;
  in_stock: boolean;
  // Namespaced so it is obviously our extension pending the live variant schema.
  _variants: WmVariant[];
};

export type WmItemsPayload = {
  items: WmMenuItem[];
};

// Map our internal Greenway categories -> a single Weedmaps ROOT (L1) category NAME.
// Verified L1 list (docs part 16): Concentrates, Cultivation, Drinks, Edibles, Flower,
// Gear, Infused Pre Roll, Other, Pre Roll, Vape Pens, Wellness.
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

// Convert minor units (cents) -> decimal string "10.00" (Weedmaps order payloads use
// decimal-string prices).
export function priceString(minorUnits: number): string {
  return (Math.round(minorUnits) / 100).toFixed(2);
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
  // Weedmaps cannabinoid measurements are percentage and/or milligram ranges; our POS
  // stores a single percentage figure, so we send it as a min=max percentage range.
  if (/mg/i.test(asString)) return undefined; // we only confidently have % values
  const numeric = Number.parseFloat(asString.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return undefined;
  return { slug, percentage: { min: numeric, max: numeric } };
}

export function toWmVariant(v: SyndicationItem["variants"][number]): WmVariant {
  return {
    external_id: v.id,
    label: v.label,
    price: priceString(v.priceMinorUnits),
    in_stock: v.inStock,
  };
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
            label: "each",
            price: priceString(item.priceMinorUnits),
            in_stock: item.inStock,
          },
        ];

  const out: WmMenuItem = {
    external_id: item.id,
    name: item.name,
    description: toPlainText(item.description),
    category_names: toWmRootCategory(item.category),
    price: priceString(item.priceMinorUnits),
    in_stock: item.inStock,
    _variants: variants,
  };

  const brand = item.brand && item.brand.trim().length > 0 ? item.brand.trim() : null;
  if (brand) out.brand_name = brand;
  const strain = item.strainName && item.strainName.trim().length > 0 ? item.strainName.trim() : null;
  if (strain) out.strain_name = strain;
  if (cannabinoids.length > 0) out.cannabinoids = cannabinoids;

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

  ok("plaintext strips tags", toPlainText("<p>Hi <b>there</b></p>") === "Hi there");
  ok("plaintext empty->null", toPlainText("  ") === null);

  ok("priceString cents->decimal", priceString(2000) === "20.00");
  ok("priceString rounds", priceString(1599.6) === "16.00");
  ok("priceString odd", priceString(1599) === "15.99");

  ok("cannabinoid pct", JSON.stringify(toCannabinoid("thc", "21.4%")) ===
    JSON.stringify({ slug: "thc", percentage: { min: 21.4, max: 21.4 } }));
  ok("cannabinoid absent->undefined", toCannabinoid("thc", "") === undefined);
  ok("cannabinoid null->undefined", toCannabinoid("thc", null) === undefined);
  ok("cannabinoid mg->undefined (only % confident)", toCannabinoid("cbd", "5 mg") === undefined);

  const v = { id: "v1", label: "1g", priceMinorUnits: 1500, inStock: true };
  const wv = toWmVariant(v);
  ok("variant external_id", wv.external_id === "v1");
  ok("variant price decimal", wv.price === "15.00");
  ok("variant in_stock", wv.in_stock === true);

  // item with no variants -> synthesized default
  const noVar: SyndicationItem = {
    id: "p1",
    name: "House Flower",
    brand: " Greenway ",
    category: "flower",
    strainType: "hybrid",
    strainName: " Blue Dream ",
    thc: "24.1%",
    cbd: null,
    description: "<p>Balanced &amp; smooth</p>",
    priceMinorUnits: 2000,
    inStock: true,
    variants: [],
  };
  const wi = toWmMenuItem(noVar);
  ok("item external_id = id", wi.external_id === "p1");
  ok("item category root", wi.category_names === "Flower");
  ok("item brand trimmed", wi.brand_name === "Greenway");
  ok("item strain trimmed", wi.strain_name === "Blue Dream");
  ok("item desc plaintext", wi.description === "Balanced & smooth");
  ok("item price decimal", wi.price === "20.00");
  ok("item cannabinoid thc only", wi.cannabinoids?.length === 1 && wi.cannabinoids[0].slug === "thc");
  ok("item synth variant", wi._variants.length === 1 && wi._variants[0].external_id === "p1-default");

  // item with absent brand/strain -> fields omitted (not null)
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
    variants: [{ id: "x", label: "10pk", priceMinorUnits: 1500, inStock: false }],
  };
  const wb = toWmMenuItem(bare);
  ok("bare no brand_name key", !("brand_name" in wb));
  ok("bare no strain_name key", !("strain_name" in wb));
  ok("bare no cannabinoids key", !("cannabinoids" in wb));
  ok("bare desc null", wb.description === null);
  ok("bare category Edibles", wb.category_names === "Edibles");
  ok("bare in_stock false", wb.in_stock === false);
  ok("bare real variant kept", wb._variants.length === 1 && wb._variants[0].external_id === "x");

  const payload = buildWmItemsPayload([noVar, bare]);
  ok("payload count", payload.items.length === 2);

  console.log(`wm-payload: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} wm-payload test(s) failed`);
}
