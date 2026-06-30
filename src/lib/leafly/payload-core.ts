// Pure mapper: Greenway SyndicationItem[] -> Leafly Menu Integration API v2.0 wire format.
//
// Grounded entirely in the owner-supplied OpenAPI spec (leafly_menu_api_v2.json) and
// research report. See docs/leafly-menu-api-v2.md. Key v2 rules encoded here:
//   - camelCase fields
//   - variant.id REQUIRED; variant.price = integer minor units (cents)
//   - every item must have >=1 variant
//   - strain absent => null (never "NA")
//   - cannabinoid absent => null (never 0)
//   - descriptions plain text (no markup)
//   - removed fields (batchId/parentBatchId/sku/tax_rate/...) are simply never emitted
//
// This module is PURE (no DB, no network, no "server-only") so it can be unit-tested
// directly with tsx.

import type { SyndicationItem, SyndicationVariant } from "../syndication/menu-feed-core";

export type LeaflyCompound = {
  type: string;
  unit: string;
  value: number | null;
};

export type LeaflyVariant = {
  id: string;
  price: number; // integer minor units (cents)
  inventoryLevel: number;
  medical: boolean;
  label?: string;
};

export type LeaflyItem = {
  id: string;
  name: string;
  brandName: string | null;
  type: string;
  strainName: string | null;
  description: string | null;
  compounds: LeaflyCompound[];
  totalThc: LeaflyCompound | null;
  totalCbd: LeaflyCompound | null;
  variants: LeaflyVariant[];
};

export type LeaflyItemsPayload = {
  items: LeaflyItem[];
};

export type LeaflyDeletePayload = {
  ids: string[];
};

// Map our internal Greenway categories to the broad Leafly product `type` values
// documented in the spec/report: flower, concentrate, edible, pre-roll, tincture,
// topicals, other. We never invent a type Leafly does not document.
const CATEGORY_TO_LEAFLY_TYPE: Record<string, string> = {
  flower: "flower",
  "popcorn-bud": "flower",
  "infused-flower": "flower",
  trim: "flower",
  preroll: "pre-roll",
  "preroll-pack": "pre-roll",
  "infused-preroll": "pre-roll",
  "infused-preroll-pack": "pre-roll",
  blunt: "pre-roll",
  "infused-blunt": "pre-roll",
  concentrate: "concentrate",
  cartridge: "concentrate",
  "disposable-cartridge": "concentrate",
  rso: "concentrate",
  "edible-solid": "edible",
  "edible-liquid": "edible",
  tincture: "tincture",
  topical: "topicals",
  paraphernalia: "other",
  accessories: "other",
  merch: "other",
};

export function toLeaflyType(category: string): string {
  return CATEGORY_TO_LEAFLY_TYPE[category] ?? "other";
}

// Strip any HTML/markup -> plain text. The API requires plain-text descriptions.
export function toPlainText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value)
    .replace(/<[^>]*>/g, " ") // drop tags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

// Parse a stored cannabinoid string (e.g. "21.4", "21.4%", "5 mg", "") into a numeric
// value + unit. Absent/unparseable -> null value (never 0 per spec).
export function toCompound(
  type: string,
  raw: string | number | null | undefined,
): LeaflyCompound | null {
  if (raw == null) return null;
  const asString = String(raw).trim();
  if (asString.length === 0) return null;
  const unit = /mg/i.test(asString) ? "mg" : "%";
  const numeric = Number.parseFloat(asString.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) {
    // Present but non-numeric -> still report unit with null value (unknown, not 0).
    return { type, unit, value: null };
  }
  return { type, unit, value: numeric };
}

export function toLeaflyVariant(v: SyndicationVariant): LeaflyVariant {
  const variant: LeaflyVariant = {
    id: v.id,
    price: Math.round(v.priceMinorUnits),
    inventoryLevel: v.inStock ? 1 : 0,
    medical: false,
  };
  if (v.label && v.label.trim().length > 0) {
    variant.label = v.label.trim();
  }
  return variant;
}

// Ensure an item always has at least one variant. If the source had none, synthesize a
// single default variant from the item's own price + stock so the payload stays valid.
export function variantsFor(item: SyndicationItem): LeaflyVariant[] {
  if (item.variants.length > 0) {
    return item.variants.map(toLeaflyVariant);
  }
  return [
    {
      id: `${item.id}-default`,
      price: Math.round(item.priceMinorUnits),
      inventoryLevel: item.inStock ? 1 : 0,
      medical: false,
    },
  ];
}

export function toLeaflyItem(item: SyndicationItem): LeaflyItem {
  const compounds: LeaflyCompound[] = [];
  const totalThc = toCompound("thc", item.thc);
  const totalCbd = toCompound("cbd", item.cbd);
  if (totalThc) compounds.push(totalThc);
  if (totalCbd) compounds.push(totalCbd);

  const strain = item.strainName && item.strainName.trim().length > 0 ? item.strainName.trim() : null;
  const brand = item.brand && item.brand.trim().length > 0 ? item.brand.trim() : null;

  return {
    id: item.id,
    name: item.name,
    brandName: brand,
    type: toLeaflyType(item.category),
    // Strain absent => null, never "NA".
    strainName: strain,
    description: toPlainText(item.description),
    compounds,
    totalThc,
    totalCbd,
    variants: variantsFor(item),
  };
}

export function buildLeaflyItemsPayload(items: SyndicationItem[]): LeaflyItemsPayload {
  return { items: items.map(toLeaflyItem) };
}

export function buildLeaflyDeletePayload(ids: string[]): LeaflyDeletePayload {
  return { ids: [...new Set(ids)] };
}

// ---------------------------------------------------------------------------
// Tests (run via tsx; this module is pure).
// ---------------------------------------------------------------------------
export function __runLeaflyPayloadTests() {
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

  // toLeaflyType
  ok("flower->flower", toLeaflyType("flower") === "flower");
  ok("popcorn-bud->flower", toLeaflyType("popcorn-bud") === "flower");
  ok("cartridge->concentrate", toLeaflyType("cartridge") === "concentrate");
  ok("preroll-pack->pre-roll", toLeaflyType("preroll-pack") === "pre-roll");
  ok("topical->topicals", toLeaflyType("topical") === "topicals");
  ok("merch->other", toLeaflyType("merch") === "other");
  ok("unknown->other", toLeaflyType("nonsense") === "other");

  // toPlainText
  ok("plaintext strips tags", toPlainText("<p>Hello <b>world</b></p>") === "Hello world");
  ok("plaintext entities", toPlainText("A &amp; B") === "A & B");
  ok("plaintext empty->null", toPlainText("   ") === null);
  ok("plaintext null->null", toPlainText(null) === null);

  // toCompound
  ok("compound percent", JSON.stringify(toCompound("thc", "21.4%")) === JSON.stringify({ type: "thc", unit: "%", value: 21.4 }));
  ok("compound mg", JSON.stringify(toCompound("cbd", "5 mg")) === JSON.stringify({ type: "cbd", unit: "mg", value: 5 }));
  ok("compound absent->null", toCompound("thc", "") === null);
  ok("compound null->null", toCompound("thc", null) === null);
  ok("compound nonnumeric->null value", (() => {
    const c = toCompound("thc", "trace");
    return c !== null && c.value === null && c.unit === "%";
  })());

  // variant mapping: price rounded, inventoryLevel from inStock
  const v: SyndicationVariant = { id: "v1", label: "1g", priceMinorUnits: 1500.4, inStock: true };
  const lv = toLeaflyVariant(v);
  ok("variant id kept", lv.id === "v1");
  ok("variant price rounded int", lv.price === 1500);
  ok("variant inventoryLevel in stock", lv.inventoryLevel === 1);
  ok("variant medical false", lv.medical === false);
  ok("variant label kept", lv.label === "1g");

  const vOut: SyndicationVariant = { id: "v2", label: "", priceMinorUnits: 1000, inStock: false };
  const lvOut = toLeaflyVariant(vOut);
  ok("variant out of stock 0", lvOut.inventoryLevel === 0);
  ok("variant empty label dropped", lvOut.label === undefined);

  // item with no variants -> synthesized default variant (>=1 required)
  const noVar: SyndicationItem = {
    id: "item-1",
    name: "House Flower",
    brand: "  Greenway  ",
    category: "flower",
    strainType: "hybrid",
    strainName: "  Blue Dream  ",
    thc: "24.1%",
    cbd: null,
    description: "<p>Smooth &amp; balanced</p>",
    priceMinorUnits: 2000,
    inStock: true,
    variants: [],
  };
  const li = toLeaflyItem(noVar);
  ok("item type mapped", li.type === "flower");
  ok("item brand trimmed", li.brandName === "Greenway");
  ok("item strain trimmed", li.strainName === "Blue Dream");
  ok("item desc plaintext", li.description === "Smooth & balanced");
  ok("item totalThc set", li.totalThc !== null && li.totalThc.value === 24.1);
  ok("item totalCbd null", li.totalCbd === null);
  ok("item compounds only thc", li.compounds.length === 1 && li.compounds[0].type === "thc");
  ok("item synth variant count 1", li.variants.length === 1);
  ok("item synth variant id", li.variants[0].id === "item-1-default");
  ok("item synth variant price", li.variants[0].price === 2000);

  // item with absent strain -> null (never "NA")
  const noStrain: SyndicationItem = {
    id: "item-2",
    name: "Gummies",
    brand: null,
    category: "edible-solid",
    strainType: "unknown",
    strainName: null,
    thc: null,
    cbd: null,
    description: "",
    priceMinorUnits: 1500,
    inStock: true,
    variants: [{ id: "x", label: "10pk", priceMinorUnits: 1500, inStock: true }],
  };
  const li2 = toLeaflyItem(noStrain);
  ok("absent strain null", li2.strainName === null);
  ok("absent brand null", li2.brandName === null);
  ok("absent desc null", li2.description === null);
  ok("edible type", li2.type === "edible");
  ok("real variant kept", li2.variants.length === 1 && li2.variants[0].id === "x");

  // payload + delete
  const payload = buildLeaflyItemsPayload([noVar, noStrain]);
  ok("payload items count", payload.items.length === 2);
  const del = buildLeaflyDeletePayload(["a", "a", "b"]);
  ok("delete dedupes", del.ids.length === 2 && del.ids.includes("a") && del.ids.includes("b"));

  console.log(`leafly-payload: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} leafly-payload test(s) failed`);
}
