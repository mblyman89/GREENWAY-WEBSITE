// ---------------------------------------------------------------------------
// GREENWAY MERCH CATALOG
//
// Branded apparel + accessories sold for in-store pickup. Modeled as
// GreenwayMenuItem-shaped records (category "merch") so the ENTIRE existing
// commerce pipeline — product cards, product detail page, cart, checkout, and
// confirmation — works without bespoke screens.
//
// Pricing reflects typical retail for premium dispensary/streetwear merch.
// Variants encode SIZE × COLOR (and fit/gender where relevant); some sizes
// carry a small upcharge (e.g. 2XL). The card shows the full price RANGE across
// all variants. Merch is non-cannabis, so daily-deal discounts never apply.
// ---------------------------------------------------------------------------

import type { GreenwayMenuItem, GreenwayMenuVariant } from "@/lib/leafly/types";

export type MerchColor = { name: string; swatch: string };

export type MerchProductDef = {
  key: string;
  name: string;
  blurb: string;
  description: string;
  imageUrl: string;
  /** Base price in minor units (cents) for the standard size. */
  basePriceMinorUnits: number;
  /** Per-size upcharge in minor units, keyed by size label. */
  sizeUpcharge?: Record<string, number>;
  /** Sizes offered. When fit-specific, men's/women's lists are provided. */
  mensSizes: string[];
  womensSizes: string[];
  /** Whether this item has distinct men's/women's fits (apparel). */
  gendered: boolean;
  colors: MerchColor[];
};

const APPAREL_COLORS: MerchColor[] = [
  { name: "Black", swatch: "#111111" },
  { name: "Forest Green", swatch: "#1f3d2b" },
  { name: "Heather Gray", swatch: "#9aa0a6" },
  { name: "Greenway Orange", swatch: "#ff7f00" },
];

const NEUTRAL_COLORS: MerchColor[] = [
  { name: "Black", swatch: "#111111" },
  { name: "Forest Green", swatch: "#1f3d2b" },
  { name: "Heather Gray", swatch: "#9aa0a6" },
];

const MENS_APPAREL_SIZES = ["S", "M", "L", "XL", "2XL"];
const WOMENS_APPAREL_SIZES = ["XS", "S", "M", "L", "XL"];
const ONE_SIZE = ["One Size"];

// 2XL adds a small upcharge, standard in apparel printing.
const XL_PLUS_UPCHARGE: Record<string, number> = { "2XL": 200 };

export const merchProductDefs: MerchProductDef[] = [
  {
    key: "tshirt",
    name: "Logo Tee",
    blurb: "Soft, heavyweight cotton with the classic Greenway leaf on the chest. Your everyday go-to.",
    description:
      "Our signature Logo Tee is cut from soft, pre-shrunk heavyweight cotton for a structured drape that holds up wash after wash. The embroidered-look Greenway leaf sits clean on the left chest, and the tag-free collar keeps it comfortable all day. A true closet staple in a fit that flatters every frame.",
    imageUrl: "/merch/tshirt.webp",
    basePriceMinorUnits: 2400,
    sizeUpcharge: XL_PLUS_UPCHARGE,
    mensSizes: MENS_APPAREL_SIZES,
    womensSizes: WOMENS_APPAREL_SIZES,
    gendered: true,
    colors: APPAREL_COLORS,
  },
  {
    key: "sweatshirt",
    name: "Pullover Hoodie",
    blurb: "Cozy fleece-lined hoodie built for chilly Kitsap evenings. Warm, durable, and clean.",
    description:
      "Built for chilly Kitsap evenings, the Pullover Hoodie is lined with brushed fleece for serious warmth without the bulk. A double-layer hood, ribbed cuffs, and a roomy kangaroo pocket round out the comfort, while the tonal Greenway branding keeps it understated. The hoodie you'll reach for first all season.",
    imageUrl: "/merch/sweatshirt.webp",
    basePriceMinorUnits: 5200,
    sizeUpcharge: XL_PLUS_UPCHARGE,
    mensSizes: MENS_APPAREL_SIZES,
    womensSizes: WOMENS_APPAREL_SIZES,
    gendered: true,
    colors: APPAREL_COLORS,
  },
  {
    key: "zip-hoodie",
    name: "Zip-Up Hoodie",
    blurb: "Full-zip comfort with embroidered Greenway branding. Layer up your style anytime.",
    description:
      "The Zip-Up Hoodie pairs the warmth of brushed fleece with full-zip versatility, so you can layer up or cool down on the fly. Embroidered Greenway branding, a sturdy metal zipper, and split kangaroo pockets give it a premium feel that wears just as well around town as it does on the couch.",
    imageUrl: "/merch/zip-hoodie.webp",
    basePriceMinorUnits: 5800,
    sizeUpcharge: XL_PLUS_UPCHARGE,
    mensSizes: MENS_APPAREL_SIZES,
    womensSizes: WOMENS_APPAREL_SIZES,
    gendered: true,
    colors: APPAREL_COLORS,
  },
  {
    key: "hat",
    name: "Dad Hat",
    blurb: "Structured cotton cap with an embroidered leaf and adjustable strap back. Fits everyone.",
    description:
      "A classic six-panel Dad Hat in soft brushed cotton twill, finished with a crisp embroidered Greenway leaf on the front and an adjustable metal-clasp strap back for the perfect fit. Low-profile, broken-in comfort from day one — the easy finishing touch for any outfit.",
    imageUrl: "/merch/hat.webp",
    basePriceMinorUnits: 2600,
    mensSizes: ONE_SIZE,
    womensSizes: ONE_SIZE,
    gendered: false,
    colors: NEUTRAL_COLORS,
  },
  {
    key: "beanie",
    name: "Knit Beanie",
    blurb: "Warm cuffed knit beanie with a woven Greenway tag. Cold-weather essential.",
    description:
      "A cold-weather essential, our Knit Beanie is double-layered for warmth with a snug cuffed fit and a woven Greenway tag on the fold. Stretchy ribbed knit hugs without squeezing, and the neutral tones go with everything. Pull it on and stay cozy from the parking lot to the porch.",
    imageUrl: "/merch/beanie.webp",
    basePriceMinorUnits: 2200,
    mensSizes: ONE_SIZE,
    womensSizes: ONE_SIZE,
    gendered: false,
    colors: NEUTRAL_COLORS,
  },
  {
    key: "socks",
    name: "Crew Socks",
    blurb: "Cushioned crew socks with green-and-gold stripes. Comfy, bold, and built to last.",
    description:
      "Step up your sock game with cushioned cotton-blend Crew Socks featuring bold green-and-gold Greenway stripes. A reinforced heel and toe mean they're built to last, while arch support and a no-slip cuff keep them comfortable through long days on your feet. Bold, comfy, and unmistakably Greenway.",
    imageUrl: "/merch/socks.webp",
    basePriceMinorUnits: 1400,
    mensSizes: ["M (7-10)", "L (10-13)"],
    womensSizes: ["S (5-8)", "M (8-11)"],
    gendered: true,
    colors: [
      { name: "Green & Gold", swatch: "#1f3d2b" },
      { name: "Black & Orange", swatch: "#111111" },
    ],
  },
  {
    key: "lanyard",
    name: "Logo Lanyard",
    blurb: "Woven neck lanyard with a metal clip and quick-release buckle. Keys and ID, sorted.",
    description:
      "Keep your keys and ID sorted with the woven Logo Lanyard. A repeating Greenway print runs the full length, finished with a sturdy metal swivel clip and a quick-release buckle for easy access. Lightweight, comfortable around the neck, and tough enough for everyday carry.",
    imageUrl: "/merch/lanyard.webp",
    basePriceMinorUnits: 1000,
    mensSizes: ONE_SIZE,
    womensSizes: ONE_SIZE,
    gendered: false,
    colors: [
      { name: "Green", swatch: "#1f3d2b" },
      { name: "Black", swatch: "#111111" },
      { name: "Orange", swatch: "#ff7f00" },
    ],
  },
];

export function merchIdForKey(key: string) {
  return `merch-${key}`;
}

function sizesForDef(def: MerchProductDef): { label: string; fit: "mens" | "womens" | null }[] {
  if (!def.gendered) {
    return def.mensSizes.map((label) => ({ label, fit: null }));
  }
  return [
    ...def.mensSizes.map((label) => ({ label, fit: "mens" as const })),
    ...def.womensSizes.map((label) => ({ label, fit: "womens" as const })),
  ];
}

/** Compute the [min, max] price across every variant of a merch item. */
export function merchPriceRange(def: MerchProductDef): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const { label } of sizesForDef(def)) {
    const price = def.basePriceMinorUnits + (def.sizeUpcharge?.[label] ?? 0);
    if (price < min) min = price;
    if (price > max) max = price;
  }
  return { min: min === Infinity ? def.basePriceMinorUnits : min, max: max === -Infinity ? def.basePriceMinorUnits : max };
}

/**
 * Build a GreenwayMenuItem-shaped record for a merch product so the existing
 * PDP / cart / checkout pipeline can render it. Variants encode SIZE × COLOR
 * (× fit when gendered) so the customer can pick all options before adding.
 */
export function merchToMenuItem(def: MerchProductDef): GreenwayMenuItem {
  const variants: GreenwayMenuVariant[] = [];
  const sizes = sizesForDef(def);
  for (const color of def.colors) {
    for (const { label, fit } of sizes) {
      const price = def.basePriceMinorUnits + (def.sizeUpcharge?.[label] ?? 0);
      const fitLabel = fit === "mens" ? "Men's " : fit === "womens" ? "Women's " : "";
      const sizePart = label === "One Size" ? "One Size" : `${fitLabel}${label}`;
      variants.push({
        id: `${merchIdForKey(def.key)}-${color.name}-${fit ?? "uni"}-${label}`.replace(/\s+/g, "-").toLowerCase(),
        label: `${color.name} · ${sizePart}`,
        priceMinorUnits: price,
        inventoryLevel: 25,
        medical: false,
      });
    }
  }

  const { min } = merchPriceRange(def);

  return {
    id: merchIdForKey(def.key),
    name: def.name,
    brand: "Greenway",
    category: "merch",
    filterCategories: ["merch"],
    strainType: "unknown",
    thc: null,
    cbd: null,
    totalThc: null,
    totalCbd: null,
    compounds: [],
    priceMinorUnits: min,
    priceLabel: `$${(min / 100).toFixed(0)}`,
    description: def.description,
    inventoryStatus: "in-stock",
    variants,
  };
}

export const merchMenuItems: GreenwayMenuItem[] = merchProductDefs.map(merchToMenuItem);

export function getMerchMenuItemById(id: string) {
  return merchMenuItems.find((item) => item.id === id);
}

export function getMerchDefById(id: string) {
  return merchProductDefs.find((def) => merchIdForKey(def.key) === id);
}
