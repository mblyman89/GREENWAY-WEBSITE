"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory, websiteCategories } from "@/lib/pos/category-taxonomy";
import { FilterMobile, MenuFilterControls } from "./FilterMobile";
import { FilterTags } from "./FilterTags";
import { ProductCard } from "./ProductCard";
import { SortDropdown, type SortOption } from "./SortDropdown";
import { getActiveMenuDiscount } from "@/lib/specials/daily-deals";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";

// Item IDs eligible for the 50% Off clearance lane. These are placeholder IDs
// (no live 50%-off inventory yet), so selecting "50% OFF" shows the empty state.
const clearanceItemIds: string[] = [
  "mock-flower-001",
  "mock-flower-002",
  "mock-preroll-001",
  "mock-preroll-002",
  "mock-edible-001",
  "mock-vape-001",
  "mock-concentrate-001",
  "mock-topical-001",
];

// Canonical gram-weight order. Only weights actually present in the data are shown (see deriveWeightOptions).
const weightDisplayOrder = ["0.5g", "0.7g", "0.75g", "1g", "1.2g", "1.5g", "2g", "2.5g", "3g", "3.5g", "4g", "5g", "7g", "14g", "28g", "1oz", "10pk"];

// Industry "CBD-rich" threshold (Dutch Passion): >= 4% CBD. Special strain-filter value.
const HIGH_CBD_THRESHOLD = 4;
const HIGH_CBD_VALUE = "cbd";

function normalizeWeightLabel(label: string) {
  return label.trim().toLowerCase();
}

// Extract a canonical weight token from a variant label, if it maps to one we display.
function weightTokenFromLabel(label: string) {
  const normalized = normalizeWeightLabel(label);
  return weightDisplayOrder.find((weight) => normalized === weight.toLowerCase() || normalized.includes(weight.toLowerCase())) ?? null;
}

type PreviewSpecialCollection = {
  label: string;
  helper: string;
  categories: GreenwayCategory[];
  itemIds?: string[];
  maxPrice: number;
  sortBy: SortOption;
};

const previewSpecialCollections: Record<string, PreviewSpecialCollection> = {
  "clearance-50": {
    label: "50% Off Clearance",
    helper: "Clearance-filtered shopping lane from the Specials and homepage 50% off sections.",
    categories: [],
    itemIds: [
      "mock-flower-001",
      "mock-flower-002",
      "mock-preroll-001",
      "mock-preroll-002",
      "mock-edible-001",
      "mock-vape-001",
      "mock-concentrate-001",
      "mock-topical-001",
    ],
    maxPrice: 100,
    sortBy: "price-low",
  },
  "doobie-tuesday": {
    label: "Doobie Tuesday",
    helper: "All prerolls, blunts, infused prerolls, and multi-packs are 20% off for 1–3 items. Buy 4 or more for 25% off in store.",
    categories: ["preroll", "preroll-pack", "infused-preroll", "infused-preroll-pack"],
    maxPrice: 100,
    sortBy: "category",
  },
  "wax-wednesday": {
    label: "Wax Wednesday",
    helper: "Concentrate and vape products for the Wednesday wax deal.",
    categories: ["concentrate", "cartridge", "disposable-cartridge"],
    maxPrice: 100,
    sortBy: "category",
  },
  "top-shelf-thursday": {
    label: "Top Shelf Thursday",
    helper: "Featured top shelf products and brands for Thursday specials.",
    categories: ["flower", "cartridge", "disposable-cartridge", "concentrate"],
    maxPrice: 100,
    sortBy: "best-sellers",
  },
  "super-saturday": {
    label: "Super Saturday",
    helper: "Store-wide shopping lane for Saturday specials.",
    categories: [],
    maxPrice: 100,
    sortBy: "best-sellers",
  },
  "ice-cream-sunday": {
    label: "Ice Cream Sunday",
    helper: "Store-wide shopping lane for Sunday buy 3 for the price of 2 specials.",
    categories: [],
    maxPrice: 100,
    sortBy: "category",
  },
} satisfies Record<string, PreviewSpecialCollection>;

type PreviewSpecialCollectionKey = keyof typeof previewSpecialCollections;

type FilterOption = {
  value: string;
  label: string;
  count: number;
};


type MenuItemGroup = {
  key: string;
  id: string;
  eyebrow: string;
  label: string;
  items: GreenwayMenuItem[];
};

type AccessorySectionCard = {
  key: string;
  label: string;
  description: string;
  imageUrl: string;
};

const accessorySectionCards: AccessorySectionCard[] = [
  { key: "bongs", label: "Bongs", description: "Big, smooth, water-cooled hits without the harshness. Premium borosilicate beakers and straight tubes with built-in percs filter every pull so your flower tastes cleaner and hits easier — the centerpiece your sessions deserve.", imageUrl: "/accessories/bongs.webp" },
  { key: "pipes", label: "Pipes", description: "Grab, pack, and go. Hand-blown glass spoons in bold colors that fit perfectly in your palm and your pocket — the everyday classic that's ready whenever you are, no water or setup required.", imageUrl: "/accessories/pipes.webp" },
  { key: "papers", label: "Papers", description: "Roll the perfect joint every time. Slow-burning papers, ready-to-fill cones, and tips that keep ash even and flavor pure. Stock up — the difference between a good roll and a great one starts here.", imageUrl: "/accessories/papers.webp" },
  { key: "bowl-pieces", label: "Bowl Pieces", description: "Upgrade your rip or replace a lost slide in seconds. Thick glass bowls in standard joint sizes with easy-grip handles and built-in screens — pack bigger, pull cleaner, and breathe new life into the piece you already love.", imageUrl: "/accessories/bowl-pieces.webp" },
  { key: "rolling-trays", label: "Rolling Trays", description: "Keep every session tidy and stash-free. Sleek metal trays with raised edges corral your flower, papers, and grinder so nothing spills and nothing's lost — the clean, organized home base every roller wants on the table.", imageUrl: "/accessories/rolling-trays.webp" },
  { key: "grinders", label: "Grinders", description: "Fluffy, even grind and zero waste. Precision-milled aluminum teeth break down flower effortlessly while the mesh screen collects every speck of potent kief in the bottom chamber — more flavor, easier packing, nothing left behind.", imageUrl: "/accessories/grinders.webp" },
  { key: "vape-batteries", label: "Vape Batteries", description: "Power any 510-thread cart with one reliable click. Long-lasting batteries with draw-activated ease or adjustable voltage to dial in your hit, plus fast USB charging — consistent clouds, pocket-ready, all day long.", imageUrl: "/accessories/vape-batteries.webp" },
  { key: "dab-tools", label: "Dab Tools", description: "Handle your concentrates like a pro. Rust-proof stainless steel tools, precision carb caps, and a non-stick silicone container keep every dab clean, mess-free, and exactly where it belongs — no sticky fingers, no wasted wax.", imageUrl: "/accessories/dab-tools.webp" },
  { key: "dab-rigs", label: "Dab Rigs", description: "Flavor-first dabs with maximum vapor. Compact glass rigs paired with quartz bangers and water percolation deliver smooth, terpene-rich hits that hit hard and taste incredible — built for concentrate lovers who want every drop to count.", imageUrl: "/accessories/dab-rigs.webp" },
  { key: "down-stems", label: "Down Stems", description: "The perfect-fit upgrade your bong's been missing. Diffused glass down stems in multiple lengths break smoke into tiny bubbles for cooler, smoother pulls — match your joint size and instantly level up filtration.", imageUrl: "/accessories/down-stems.webp" },
  { key: "bubblers", label: "Bubblers", description: "Bong-smooth hits in a piece that fits your hand. Hand-held glass bubblers add water filtration and a built-in perc to a portable frame — the best of both worlds for sessions that travel without sacrificing a single smooth pull.", imageUrl: "/accessories/bubblers.webp" },
  { key: "sherlocks", label: "Sherlocks", description: "Timeless style meets a cooler hit. The signature gooseneck curve on these striped glass Sherlocks keeps smoke away from your hand and the flame at a comfortable distance — a collector-worthy classic that feels as good as it looks.", imageUrl: "/accessories/sherlocks.webp" },
  { key: "chillums", label: "Chillums", description: "One-hit, one-and-done discretion. Slim swirl-glass chillums load a quick bowl and stash anywhere — the low-profile, easy-to-clean pick for a fast, flavorful pull on the move with zero fuss.", imageUrl: "/accessories/chillums.webp" },
  { key: "lighters", label: "Lighters", description: "Never get caught without a flame. Refillable torches that fire up dabs and bowls, classic flip lighters for everyday carry, and natural hemp wick for a cleaner-tasting light — the dependable essentials no session should start without.", imageUrl: "/accessories/lighters.webp" },
];

function safeSectionId(value: string) {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

function itemSourceText(item: GreenwayMenuItem) {
  return `${item.posInventoryCategory ?? ""} ${item.productName ?? ""} ${item.name} ${item.brand}`.toLowerCase();
}

function hasAny(sourceText: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(sourceText));
}

function rawCategorySectionLabel(item: GreenwayMenuItem) {
  const sourceText = itemSourceText(item);
  if (item.category === "cartridge" && sourceText.includes("live resin cartridge")) return "Live Resin Cartridge";
  return item.posInventoryCategory?.trim() || formatWebsiteCategory(item.category);
}

function cartridgeSubtypeLabel(item: GreenwayMenuItem) {
  const sourceText = itemSourceText(item);
  if ((item.posInventoryCategory ?? "").toLowerCase() === "pod" || /\bpod\b/.test(sourceText)) return "Pods";
  if (hasAny(sourceText, [/liquid diamonds?/, /diamond cart/, /diamond vape/])) return "Liquid Diamonds Cartridge";
  if (hasAny(sourceText, [/solventless/, /live rosin/, /rosin cart/, /rosin cartridge/])) return "Rosin Cartridge";
  if (hasAny(sourceText, [/live resin/, /resin cart/, /resin cartridge/])) return "Live Resin Cartridge";
  if (hasAny(sourceText, [/cured resin/])) return "Cured Resin Cartridge";
  if (hasAny(sourceText, [/distillate/, /dst cart/, /vape cart/, /510 vape/, /510 cartridge/])) return "Distillate Cartridge";
  if (hasAny(sourceText, [/cbd/, /cbn/, /cbg/, /\b\d+:\d+/])) return "CBD / Ratio Cartridge";
  return rawCategorySectionLabel(item);
}

function disposableSubtypeLabel(item: GreenwayMenuItem) {
  const sourceText = itemSourceText(item);
  if (hasAny(sourceText, [/liquid diamonds?/, /diamond aio/, /diamond disposable/])) return "Liquid Diamonds Disposable";
  if (hasAny(sourceText, [/solventless/, /live rosin/, /rosin aio/, /rosin disposable/])) return "Rosin Disposable";
  if (hasAny(sourceText, [/live resin/, /resin aio/, /resin disposable/])) return "Live Resin Disposable";
  if (hasAny(sourceText, [/flavored/, /flavour/])) return "Flavored Disposable";
  if (hasAny(sourceText, [/\baio\b/, /all[- ]?in[- ]?one/, /prana pulse/])) return "All-in-One Disposable";
  if (hasAny(sourceText, [/distillate/, /dst disposable/])) return "Distillate Disposable";
  if (hasAny(sourceText, [/cbd/, /cbn/, /cbg/, /\b\d+:\d+/])) return "CBD / Ratio Disposable";
  return rawCategorySectionLabel(item);
}

function edibleSolidSectionLabel(item: GreenwayMenuItem) {
  const raw = item.posInventoryCategory?.trim();
  const sourceText = itemSourceText(item);
  if (raw && raw !== "Edible") return raw;
  if (hasAny(sourceText, [/gumm(y|ies)/, /hrg/, /doozies/, /jellies/])) return "Gummies";
  if (hasAny(sourceText, [/chocolate/, /truffle/, /bar minis?/, /skuared/, /peanut butter cup/])) return "Chocolate";
  if (hasAny(sourceText, [/fruit chews?/, /chewees?/, /chew_/, /fruit burst/])) return "Fruit Chews";
  if (hasAny(sourceText, [/mint/, /peppermint/])) return "Mints";
  if (hasAny(sourceText, [/capsule/, /softgel/])) return "Capsules";
  if (hasAny(sourceText, [/drops?/, /hot sugar/, /candy/, /candies/, /sugar/])) return "Candy / Sugar";
  if (hasAny(sourceText, [/cookie/, /brownie/, /bakery/])) return "Baked Edibles";
  return raw || "Other Solid Edibles";
}

function edibleLiquidSectionLabel(item: GreenwayMenuItem) {
  const raw = item.posInventoryCategory?.trim();
  const sourceText = itemSourceText(item);
  if (raw === "Tincture") return "Tinctures";
  if (raw === "Shots" || hasAny(sourceText, [/shot/, /moonshot/, /hot shotz/])) return "Shots";
  if (raw === "Soda" || hasAny(sourceText, [/soda/, /root beer/, /cola/])) return "Soda";
  if (raw === "Beverage" || hasAny(sourceText, [/beverage/, /lemonade/, /tea/, /can\b/, /drink/])) return "Beverages";
  if (raw === "Liquid Infused Edible") return "Liquid Infused Edibles";
  return raw || "Other Liquid Edibles";
}

function isMultiPackPreroll(item: GreenwayMenuItem) {
  const sourceText = itemSourceText(item);
  const variantText = item.variants.map((variant) => variant.label).join(" ").toLowerCase();
  return hasAny(`${sourceText} ${variantText}`, [
    /\b\d+\s*(?:pk|pack|packs)\b/,
    /\b(?:two|three|four|five|six|ten)[- ]?pack\b/,
    /\b\d+\s*x\s*\.?\d+\s*g\b/,
    /\.5\s*x\s*2/,
    /2pk/,
    /multi[- ]?pack/,
  ]);
}

function prerollPackSectionLabel(item: GreenwayMenuItem) {
  return isMultiPackPreroll(item) ? "Multi-Pack" : "Single-Pack";
}

function filteredSectionLabel(activeCategory: GreenwayCategory, item: GreenwayMenuItem) {
  if (activeCategory === "concentrate") return rawCategorySectionLabel(item);
  if (activeCategory === "cartridge") return cartridgeSubtypeLabel(item);
  if (activeCategory === "disposable-cartridge") return disposableSubtypeLabel(item);
  if (activeCategory === "edible-solid") return edibleSolidSectionLabel(item);
  if (activeCategory === "edible-liquid") return edibleLiquidSectionLabel(item);
  if (["preroll", "blunt", "infused-preroll", "infused-blunt", "preroll-pack", "infused-preroll-pack"].includes(activeCategory)) return prerollPackSectionLabel(item);
  return formatWebsiteCategory(item.category);
}

function groupedByActiveFilter(activeCategory: GreenwayCategory, filteredItems: GreenwayMenuItem[]): MenuItemGroup[] {
  const bySection = new Map<string, GreenwayMenuItem[]>();
  for (const item of filteredItems) {
    const label = filteredSectionLabel(activeCategory, item);
    bySection.set(label, [...(bySection.get(label) ?? []), item]);
  }

  const sectionOrder = [
    "Single-Pack",
    "Multi-Pack",
    "Live Resin Cartridge",
    "Rosin Cartridge",
    "Liquid Diamonds Cartridge",
    "Distillate Cartridge",
    "CBD / Ratio Cartridge",
    "Pods",
    "Live Resin Disposable",
    "Rosin Disposable",
    "Liquid Diamonds Disposable",
    "All-in-One Disposable",
    "Flavored Disposable",
    "Distillate Disposable",
    "CBD / Ratio Disposable",
    "Gummies",
    "Chocolate",
    "Fruit Chews",
    "Mints",
    "Capsules",
    "Candy / Sugar",
    "Beverages",
    "Soda",
    "Shots",
    "Tinctures",
    "Liquid Infused Edibles",
  ];

  return [...bySection.entries()]
    .sort(([labelA], [labelB]) => {
      const indexA = sectionOrder.indexOf(labelA);
      const indexB = sectionOrder.indexOf(labelB);
      if (indexA !== -1 || indexB !== -1) return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
      return labelA.localeCompare(labelB);
    })
    .map(([label, groupItems]) => ({
      key: `${activeCategory}-${safeSectionId(label)}`,
      id: `${activeCategory}-${safeSectionId(label)}`,
      eyebrow: activeCategory === "concentrate" ? "POS category" : "Filtered section",
      label,
      items: groupItems,
    }));
}

function AccessoryCard({ card }: { card: AccessorySectionCard }) {
  return (
    <article className="group overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-950 shadow-xl shadow-black/25 transition hover:-translate-y-1 hover:border-[var(--greenway)]/45">
      <div className="aspect-[4/3] overflow-hidden bg-zinc-900">
        <img src={card.imageUrl} alt="" className="h-full w-full object-cover opacity-82 transition duration-500 group-hover:scale-105 group-hover:opacity-100" loading="lazy" />
      </div>
      <div className="p-5">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Accessory section</p>
        <h3 className="mt-2 text-2xl font-black text-white">{card.label}</h3>
        <p className="mt-3 text-sm leading-6 text-zinc-300">{card.description}</p>
      </div>
    </article>
  );
}

type FilterCriteria = {
  query: string;
  selectedCategories: GreenwayCategory[];
  selectedStrains: string[];
  selectedBrands: string[];
  selectedWeights: string[];
  maxThc: number;
  maxCbd: number;
  maxPrice: number;
};

function matchesSearch(item: GreenwayMenuItem, query: string) {
  const categoryLabels = [item.category, ...(item.filterCategories ?? [])].map(formatWebsiteCategory).join(" ");
  const sourceClassifications = `${item.posInventoryType ?? ""} ${item.posInventoryCategory ?? ""}`;
  const variantLabels = item.variants.map((variant) => variant.label).join(" ");
  const haystack = `${item.name} ${item.productName ?? ""} ${item.strainName ?? ""} ${item.brand} ${item.category} ${categoryLabels} ${sourceClassifications} ${item.strainType} ${variantLabels}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function inventoryDepth(item: GreenwayMenuItem) {
  return item.variants.reduce((total, variant) => total + variant.inventoryLevel, 0);
}

function cannabinoidPercentageValue(cannabinoid: GreenwayMenuItem["totalThc"] | GreenwayMenuItem["totalCbd"]) {
  if (!cannabinoid || cannabinoid.unit !== "%" || cannabinoid.value === null) return null;
  const value = Number.parseFloat(cannabinoid.value);
  return Number.isFinite(value) ? value : null;
}

function potencyValue(item: GreenwayMenuItem) {
  return Math.max(cannabinoidPercentageValue(item.totalThc) ?? 0, cannabinoidPercentageValue(item.totalCbd) ?? 0);
}

type GreenwayWindow = Window & {
  __greenwayShuffleSignature?: string;
  __greenwayShuffleRanks?: Record<string, number>;
};

function subscribeToShuffleStore() {
  return () => {};
}

function createShuffleRanks(items: GreenwayMenuItem[]) {
  return Object.fromEntries(
    [...items]
      .map((item) => ({ item, rank: Math.random() }))
      .sort((a, b) => a.rank - b.rank)
      .map(({ item }, index) => [item.id, index]),
  );
}

function getBrowserShuffleRanks(items: GreenwayMenuItem[], signature: string) {
  if (typeof window === "undefined") return {};
  const greenwayWindow = window as GreenwayWindow;

  if (greenwayWindow.__greenwayShuffleSignature !== signature || !greenwayWindow.__greenwayShuffleRanks) {
    greenwayWindow.__greenwayShuffleSignature = signature;
    greenwayWindow.__greenwayShuffleRanks = createShuffleRanks(items);
  }

  return greenwayWindow.__greenwayShuffleRanks;
}

const emptyShuffleRanks: Record<string, number> = {};

function getServerShuffleRanks() {
  return emptyShuffleRanks;
}

function sortItems(items: GreenwayMenuItem[], sortBy: SortOption, shuffleRanks: Record<string, number>) {
  return [...items].sort((a, b) => {
    if (sortBy === "featured-shuffle") return (shuffleRanks[a.id] ?? 0) - (shuffleRanks[b.id] ?? 0);
    if (sortBy === "name-az") return a.name.localeCompare(b.name);
    if (sortBy === "name-za") return b.name.localeCompare(a.name);
    if (sortBy === "price-low") return a.priceMinorUnits - b.priceMinorUnits;
    if (sortBy === "price-high") return b.priceMinorUnits - a.priceMinorUnits;
    if (sortBy === "best-sellers") return inventoryDepth(b) - inventoryDepth(a) || a.name.localeCompare(b.name);
    if (sortBy === "potency-low") return potencyValue(a) - potencyValue(b) || a.name.localeCompare(b.name);
    if (sortBy === "potency-high") return potencyValue(b) - potencyValue(a) || a.name.localeCompare(b.name);
    return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
  });
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((current) => current !== value) : [...values, value];
}

function isWebsiteCategory(value: string): value is GreenwayCategory {
  return websiteCategories.includes(value as GreenwayCategory);
}

function itemWeightLabels(item: GreenwayMenuItem) {
  return item.variants
    .map((variant) => weightTokenFromLabel(variant.label))
    .filter((weight): weight is string => weight !== null);
}

function matchesCannabinoidSlider(value: number | null, maxValue: number, maxAvailable: number) {
  if (maxValue >= maxAvailable) return true;
  return value !== null && value <= maxValue;
}

function matchesPriceSlider(priceMinorUnits: number, maxPrice: number, maxAvailablePrice: number) {
  if (maxPrice >= maxAvailablePrice) return true;
  return priceMinorUnits <= maxPrice * 100;
}

// True when an item qualifies as high-CBD ("CBD-rich") per the industry >= 4% threshold.
function isHighCbdItem(item: GreenwayMenuItem) {
  const cbd = cannabinoidPercentageValue(item.totalCbd);
  return cbd !== null && cbd >= HIGH_CBD_THRESHOLD;
}

type CannabinoidBounds = {
  maxAvailableThc: number;
  maxAvailableCbd: number;
};

function matchesStrainSelection(item: GreenwayMenuItem, selectedStrains: string[]) {
  if (selectedStrains.length === 0) return true;
  return selectedStrains.some((strain) => {
    if (strain === HIGH_CBD_VALUE) return isHighCbdItem(item);
    return item.strainType === strain;
  });
}

function itemMatchesCriteria(item: GreenwayMenuItem, criteria: FilterCriteria, maxAvailablePrice: number, bounds: CannabinoidBounds) {
  const itemCategories = item.filterCategories?.length ? item.filterCategories : [item.category];
  const categoryOk = criteria.selectedCategories.length === 0 || criteria.selectedCategories.some((category) => itemCategories.includes(category));
  const strainOk = matchesStrainSelection(item, criteria.selectedStrains);
  const brandOk = criteria.selectedBrands.length === 0 || criteria.selectedBrands.includes(item.brand);
  const weightOk = criteria.selectedWeights.length === 0 || criteria.selectedWeights.some((weight) => itemWeightLabels(item).includes(weight));
  const thcOk = matchesCannabinoidSlider(cannabinoidPercentageValue(item.totalThc), criteria.maxThc, bounds.maxAvailableThc);
  const cbdOk = matchesCannabinoidSlider(cannabinoidPercentageValue(item.totalCbd), criteria.maxCbd, bounds.maxAvailableCbd);
  const priceOk = matchesPriceSlider(item.priceMinorUnits, criteria.maxPrice, maxAvailablePrice);
  const searchOk = matchesSearch(item, criteria.query);

  return categoryOk && strainOk && brandOk && weightOk && thcOk && cbdOk && priceOk && searchOk;
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function buildOptions(baseValues: string[], selectedValues: string[] = [], labelFormatter: (value: string) => string = (value) => value): FilterOption[] {
  const counts = countValues(baseValues);
  const values = [...new Set([...baseValues, ...selectedValues])].sort((a, b) => a.localeCompare(b));

  return values.map((value) => ({
    value,
    label: labelFormatter(value),
    count: counts[value] ?? 0,
  }));
}

// Derive weight options from the actual variant labels in the data (no hardcoded list of values).
function buildWeightOptionsFromData(items: GreenwayMenuItem[], selectedWeights: string[]) {
  const counts = countValues(items.flatMap(itemWeightLabels));
  return weightDisplayOrder
    .map((weight) => ({ value: weight, label: weight, count: counts[weight] ?? 0 }))
    .filter((option) => option.count > 0 || selectedWeights.includes(option.value));
}

// A value safely above any cannabinoid/price data max, used as the "no constraint" sentinel.
const UNBOUNDED = Number.POSITIVE_INFINITY;

function criteriaWithout(criteria: FilterCriteria, key: keyof FilterCriteria): FilterCriteria {
  if (key === "query") return { ...criteria, query: "" };
  if (key === "selectedCategories") return { ...criteria, selectedCategories: [] };
  if (key === "selectedStrains") return { ...criteria, selectedStrains: [] };
  if (key === "selectedBrands") return { ...criteria, selectedBrands: [] };
  if (key === "selectedWeights") return { ...criteria, selectedWeights: [] };
  if (key === "maxThc") return { ...criteria, maxThc: UNBOUNDED };
  if (key === "maxCbd") return { ...criteria, maxCbd: UNBOUNDED };
  if (key === "maxPrice") return { ...criteria, maxPrice: UNBOUNDED };
  return criteria;
}

type InitialMenuSearchParams = {
  search?: string;
  category?: string;
  brand?: string;
  special?: string;
  // Richer persisted filter params (Task G).
  categories?: string;
  strains?: string;
  brands?: string;
  weights?: string;
  maxThc?: string;
  maxCbd?: string;
  maxPrice?: string;
  sort?: string;
};

const SORT_OPTION_VALUES: SortOption[] = [
  "featured-shuffle",
  "best-sellers",
  "price-low",
  "price-high",
  "potency-high",
  "category",
];

// Parse a comma-separated persisted param into a clean string list.
function parsePersistedList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

// Parse a numeric persisted param, returning null when absent/invalid.
function parsePersistedNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parsePersistedSort(raw: string | undefined): SortOption | null {
  return raw && SORT_OPTION_VALUES.includes(raw as SortOption) ? (raw as SortOption) : null;
}

// Merge the server-forwarded params with the LIVE browser URL params.
//
// Why: when the shopper returns to /menu via browser back / "← Back" /
// breadcrumb, the Next.js App Router may serve a cached render whose
// server-forwarded searchParams are EMPTY (they were empty at push time).
// Reading window.location.search on the client guarantees we rehydrate from the
// address bar that the browser restored, so filters survive every return path.
// The live URL takes precedence; the server params are the SSR/first-paint
// source so server and first client paint still match (no hydration mismatch,
// because on first paint window.location.search equals the server URL).
function resolveInitialParams(serverParams: InitialMenuSearchParams): InitialMenuSearchParams {
  if (typeof window === "undefined") return serverParams;
  const live = new URLSearchParams(window.location.search);
  const pick = (key: keyof InitialMenuSearchParams) => {
    const liveValue = live.get(key as string);
    if (liveValue !== null && liveValue !== "") return liveValue;
    return serverParams[key];
  };
  return {
    search: pick("search") ?? undefined,
    category: pick("category") ?? undefined,
    brand: pick("brand") ?? undefined,
    special: pick("special") ?? undefined,
    categories: pick("categories") ?? undefined,
    strains: pick("strains") ?? undefined,
    brands: pick("brands") ?? undefined,
    weights: pick("weights") ?? undefined,
    maxThc: pick("maxThc") ?? undefined,
    maxCbd: pick("maxCbd") ?? undefined,
    maxPrice: pick("maxPrice") ?? undefined,
    sort: pick("sort") ?? undefined,
  };
}

type InteractiveMenuBrowserProps = {
  items: GreenwayMenuItem[];
  initialSearchParams?: InitialMenuSearchParams;
};

export function InteractiveMenuBrowser({ items, initialSearchParams = {} }: InteractiveMenuBrowserProps) {
  // Lazy initializer reads the LIVE browser URL (merged with server params) so a
  // cache-restored return navigation rehydrates every filter. On first paint the
  // live URL equals the server URL, so server and client agree (no mismatch).
  const [initialParams] = useState(() => resolveInitialParams(initialSearchParams));
  const initialSearchQuery = initialParams.search ?? "";
  const initialCategoryParam = initialParams.category ?? "";
  const initialCategory = isWebsiteCategory(initialCategoryParam) ? initialCategoryParam : "";
  const initialBrand = initialParams.brand ?? "";
  const initialSpecialKey = initialParams.special as PreviewSpecialCollectionKey | undefined;
  const initialSpecial = initialSpecialKey && initialSpecialKey in previewSpecialCollections ? previewSpecialCollections[initialSpecialKey] : null;
  const initialSpecialCategories = initialSpecial?.categories ?? [];

  // Richer persisted filter params (Task G). When present they take precedence
  // so the menu restores the shopper's exact state on return from a product page.
  const persistedCategories = parsePersistedList(initialParams.categories).filter(isWebsiteCategory) as GreenwayCategory[];
  const persistedStrains = parsePersistedList(initialParams.strains);
  const persistedBrands = parsePersistedList(initialParams.brands);
  const persistedWeights = parsePersistedList(initialParams.weights);
  const persistedMaxThc = parsePersistedNumber(initialParams.maxThc);
  const persistedMaxCbd = parsePersistedNumber(initialParams.maxCbd);
  const persistedMaxPrice = parsePersistedNumber(initialParams.maxPrice);
  const persistedSort = parsePersistedSort(initialParams.sort);

  const [query, setQuery] = useState(initialSearchQuery);
  const [selectedCategories, setSelectedCategories] = useState<GreenwayCategory[]>(
    persistedCategories.length ? persistedCategories : initialCategory ? [initialCategory] : initialSpecialCategories,
  );
  const [selectedStrains, setSelectedStrains] = useState<string[]>(persistedStrains);
  const [selectedBrands, setSelectedBrands] = useState<string[]>(
    persistedBrands.length ? persistedBrands : initialBrand ? [initialBrand] : [],
  );
  const [selectedWeights, setSelectedWeights] = useState<string[]>(persistedWeights);
  // Data-derived bounds for sliders (no hardcoded ceilings).
  const maxAvailablePrice = useMemo(
    () => Math.max(10, Math.ceil(Math.max(...items.map((item) => item.priceMinorUnits), 0) / 100)),
    [items],
  );
  const maxAvailableThc = useMemo(
    () => Math.max(1, Math.ceil(Math.max(0, ...items.map((item) => cannabinoidPercentageValue(item.totalThc) ?? 0)))),
    [items],
  );
  const maxAvailableCbd = useMemo(
    () => Math.max(1, Math.ceil(Math.max(0, ...items.map((item) => cannabinoidPercentageValue(item.totalCbd) ?? 0)))),
    [items],
  );
  const minAvailablePrice = useMemo(
    () => Math.max(0, Math.floor(Math.min(...items.map((item) => item.priceMinorUnits), 0) / 100)),
    [items],
  );
  const [maxThc, setMaxThc] = useState(persistedMaxThc ?? maxAvailableThc);
  const [maxCbd, setMaxCbd] = useState(persistedMaxCbd ?? maxAvailableCbd);
  const [maxPrice, setMaxPrice] = useState(persistedMaxPrice ?? initialSpecial?.maxPrice ?? maxAvailablePrice);
  const cannabinoidBounds = useMemo<CannabinoidBounds>(
    () => ({ maxAvailableThc, maxAvailableCbd }),
    [maxAvailableThc, maxAvailableCbd],
  );
  const shuffleSignature = useMemo(() => items.map((item) => item.id).join("|"), [items]);
  const shuffleRanks = useSyncExternalStore(
    subscribeToShuffleStore,
    () => getBrowserShuffleRanks(items, shuffleSignature),
    getServerShuffleRanks,
  );
  const [sortBy, setSortBy] = useState<SortOption>(persistedSort ?? initialSpecial?.sortBy ?? "featured-shuffle");

  // Specials quick-filters (top of the filter panel).
  const [clearanceOnly, setClearanceOnly] = useState(false);
  const [dailyDealsOnly, setDailyDealsOnly] = useState(false);
  const storeWeekday = useStoreWeekday();

  // --- Filter persistence (Task G) ---------------------------------------
  // State is hydrated from forwarded URL params above (server + client agree,
  // so no hydration mismatch). Here we write the current state BACK to the URL
  // (replaceState — no history spam) so returning from a product page restores
  // everything. We skip the very first paint to avoid rewriting the URL before
  // it differs from the hydrated state.
  const firstWriteRef = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (firstWriteRef.current) {
      firstWriteRef.current = false;
      return;
    }
    const params = new URLSearchParams();
    if (query.trim()) params.set("search", query.trim());
    if (selectedCategories.length) params.set("categories", selectedCategories.join(","));
    if (selectedStrains.length) params.set("strains", selectedStrains.join(","));
    if (selectedBrands.length) params.set("brands", selectedBrands.join(","));
    if (selectedWeights.length) params.set("weights", selectedWeights.join(","));
    if (maxThc < maxAvailableThc) params.set("maxThc", String(maxThc));
    if (maxCbd < maxAvailableCbd) params.set("maxCbd", String(maxCbd));
    if (maxPrice < maxAvailablePrice) params.set("maxPrice", String(maxPrice));
    if (sortBy !== "featured-shuffle") params.set("sort", sortBy);
    const queryString = params.toString();
    const newUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", newUrl);
  }, [
    query,
    selectedCategories,
    selectedStrains,
    selectedBrands,
    selectedWeights,
    maxThc,
    maxCbd,
    maxPrice,
    sortBy,
    maxAvailableThc,
    maxAvailableCbd,
    maxAvailablePrice,
  ]);

  // Safety net for browser back/forward (popstate). If React keeps this component
  // mounted across a back/forward navigation to /menu (App Router cache reuse),
  // the lazy state initializers above do NOT re-run, so we must re-sync every
  // filter from the URL the browser restored. This is what makes the browser
  // back button reliably restore filters.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const list = (key: string) => parsePersistedList(params.get(key) ?? undefined);
      const num = (key: string) => parsePersistedNumber(params.get(key) ?? undefined);

      const nextCategories = (list("categories").filter(isWebsiteCategory) as GreenwayCategory[]);
      const singleCategory = params.get("category") ?? "";
      setSelectedCategories(
        nextCategories.length
          ? nextCategories
          : isWebsiteCategory(singleCategory)
            ? [singleCategory]
            : [],
      );

      setSelectedStrains(list("strains"));

      const nextBrands = list("brands");
      const singleBrand = params.get("brand") ?? "";
      setSelectedBrands(nextBrands.length ? nextBrands : singleBrand ? [singleBrand] : []);

      setSelectedWeights(list("weights"));
      setQuery(params.get("search") ?? "");

      setMaxThc(num("maxThc") ?? maxAvailableThc);
      setMaxCbd(num("maxCbd") ?? maxAvailableCbd);
      setMaxPrice(num("maxPrice") ?? maxAvailablePrice);

      setSortBy(parsePersistedSort(params.get("sort") ?? undefined) ?? "featured-shuffle");

      // The next URL-write effect run must not clobber what we just restored.
      firstWriteRef.current = true;
    };

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [maxAvailableThc, maxAvailableCbd, maxAvailablePrice]);

  const criteria = useMemo<FilterCriteria>(() => ({
    query,
    selectedCategories,
    selectedStrains,
    selectedBrands,
    selectedWeights,
    maxThc,
    maxCbd,
    maxPrice,
  }), [maxCbd, maxPrice, maxThc, query, selectedBrands, selectedCategories, selectedStrains, selectedWeights]);

  const filteredItems = useMemo(() => {
    const specialItemIds = initialSpecial?.itemIds;
    let pool = specialItemIds ? items.filter((item) => specialItemIds.includes(item.id)) : items;

    // Specials quick-filters.
    if (clearanceOnly) {
      pool = pool.filter((item) => clearanceItemIds.includes(item.id));
    }
    if (dailyDealsOnly) {
      pool = pool.filter((item) => getActiveMenuDiscount(item, storeWeekday) !== undefined);
    }

    return sortItems(pool.filter((item) => itemMatchesCriteria(item, criteria, maxAvailablePrice, cannabinoidBounds)), sortBy, shuffleRanks);
  }, [cannabinoidBounds, clearanceOnly, criteria, dailyDealsOnly, initialSpecial?.itemIds, items, maxAvailablePrice, shuffleRanks, sortBy, storeWeekday]);

  const categoryOptions = useMemo(() => {
    const optionItems = items.filter((item) => itemMatchesCriteria(item, criteriaWithout(criteria, "selectedCategories"), maxAvailablePrice, cannabinoidBounds));
    const categoryValues = optionItems.flatMap((item) => item.filterCategories?.length ? item.filterCategories : [item.category]);
    return buildOptions([...categoryValues, ...Array(accessorySectionCards.length).fill("accessories")], selectedCategories, formatWebsiteCategory);
  }, [cannabinoidBounds, criteria, items, maxAvailablePrice, selectedCategories]);

  const strainOptions = useMemo(() => {
    const optionItems = items.filter((item) => itemMatchesCriteria(item, criteriaWithout(criteria, "selectedStrains"), maxAvailablePrice, cannabinoidBounds));
    const baseOptions = buildOptions(
      optionItems.map((item) => item.strainType).filter((strainType) => strainType !== "unknown" && strainType !== HIGH_CBD_VALUE),
      selectedStrains.filter((strainType) => strainType !== "unknown" && strainType !== HIGH_CBD_VALUE),
    );
    // Inject the high-CBD ("CBD") option, threshold-based on totalCbd >= 4%.
    const highCbdCount = optionItems.filter(isHighCbdItem).length;
    if (highCbdCount > 0 || selectedStrains.includes(HIGH_CBD_VALUE)) {
      baseOptions.push({ value: HIGH_CBD_VALUE, label: "CBD", count: highCbdCount });
    }
    return baseOptions;
  }, [cannabinoidBounds, criteria, items, maxAvailablePrice, selectedStrains]);

  const brandOptions = useMemo(() => {
    const optionItems = items.filter((item) => itemMatchesCriteria(item, criteriaWithout(criteria, "selectedBrands"), maxAvailablePrice, cannabinoidBounds));
    return buildOptions(optionItems.map((item) => item.brand), selectedBrands);
  }, [cannabinoidBounds, criteria, items, maxAvailablePrice, selectedBrands]);

  const weightOptions = useMemo(() => {
    const optionItems = items.filter((item) => itemMatchesCriteria(item, criteriaWithout(criteria, "selectedWeights"), maxAvailablePrice, cannabinoidBounds));
    return buildWeightOptionsFromData(optionItems, selectedWeights);
  }, [cannabinoidBounds, criteria, items, maxAvailablePrice, selectedWeights]);

  const activeSectionCategory = selectedCategories.length === 1 ? selectedCategories[0] : null;
  const usesFilteredSections = activeSectionCategory !== null && [
    "concentrate",
    "cartridge",
    "disposable-cartridge",
    "edible-solid",
    "edible-liquid",
    "preroll",
    "blunt",
    "infused-preroll",
    "infused-blunt",
    "preroll-pack",
    "infused-preroll-pack",
  ].includes(activeSectionCategory);
  const showAccessorySections = selectedCategories.length === 1 && selectedCategories[0] === "accessories";

  const groupedItems = useMemo<MenuItemGroup[]>(() => {
    if (activeSectionCategory && usesFilteredSections) return groupedByActiveFilter(activeSectionCategory, filteredItems);

    return websiteCategories
      .map((category) => ({
        key: category,
        id: category,
        eyebrow: "Category",
        label: formatWebsiteCategory(category),
        items: filteredItems.filter((item) => item.category === category),
      }))
      .filter((group) => group.items.length > 0);
  }, [activeSectionCategory, filteredItems, usesFilteredSections]);

  // Inline toolbar title: prefers the active special collection name, then the
  // first product section label, falling back to a sensible default.
  const toolbarTitle = showAccessorySections
    ? "Accessories"
    : initialSpecial?.label ?? groupedItems[0]?.label ?? "All Products";

  const resetFilters = () => {
    setQuery("");
    setSelectedCategories([]);
    setSelectedStrains([]);
    setSelectedBrands([]);
    setSelectedWeights([]);
    setMaxThc(maxAvailableThc);
    setMaxCbd(maxAvailableCbd);
    setMaxPrice(maxAvailablePrice);
    setSortBy("featured-shuffle");
    setClearanceOnly(false);
    setDailyDealsOnly(false);
  };

  // Specials toggles are mutually exclusive — picking one clears the other.
  const toggleClearance = () => {
    setClearanceOnly((current) => !current);
    setDailyDealsOnly(false);
  };
  const toggleDailyDeals = () => {
    setDailyDealsOnly((current) => !current);
    setClearanceOnly(false);
  };

  const strainTagLabel = (strain: string) => (strain === HIGH_CBD_VALUE ? "CBD" : strain.charAt(0).toUpperCase() + strain.slice(1));

  // NOTE: The search query is intentionally NOT shown as a filter pill — it just filters live.
  const activeFilterTags = [
    ...selectedCategories.map((category) => ({
      key: `category-${category}`,
      label: "Category",
      value: formatWebsiteCategory(category),
      onRemove: () => setSelectedCategories((current) => current.filter((value) => value !== category)),
    })),
    ...selectedBrands.map((brand) => ({
      key: `brand-${brand}`,
      label: "Brand",
      value: brand,
      onRemove: () => setSelectedBrands((current) => current.filter((value) => value !== brand)),
    })),
    ...selectedStrains.map((strain) => ({
      key: `strain-${strain}`,
      label: "Strain",
      value: strainTagLabel(strain),
      onRemove: () => setSelectedStrains((current) => current.filter((value) => value !== strain)),
    })),
    ...selectedWeights.map((weight) => ({
      key: `weight-${weight}`,
      label: "Weight",
      value: weight,
      onRemove: () => setSelectedWeights((current) => current.filter((value) => value !== weight)),
    })),
    ...(maxThc < maxAvailableThc
      ? [
          {
            key: "thc",
            label: "Max THC",
            value: `${maxThc}%`,
            onRemove: () => setMaxThc(maxAvailableThc),
          },
        ]
      : []),
    ...(maxCbd < maxAvailableCbd
      ? [
          {
            key: "cbd",
            label: "Max CBD",
            value: `${maxCbd}%`,
            onRemove: () => setMaxCbd(maxAvailableCbd),
          },
        ]
      : []),
    ...(maxPrice < maxAvailablePrice
      ? [
          {
            key: "price",
            label: "Max price",
            value: `$${maxPrice}`,
            onRemove: () => setMaxPrice(maxAvailablePrice),
          },
        ]
      : []),
  ];

  const activeFilterCount = activeFilterTags.length;

  const filterControls = (
    <MenuFilterControls
      selectedCategories={selectedCategories}
      selectedStrains={selectedStrains}
      selectedBrands={selectedBrands}
      selectedWeights={selectedWeights}
      maxThc={maxThc}
      maxCbd={maxCbd}
      maxPrice={maxPrice}
      onCategoryToggle={(category) => {
        if (isWebsiteCategory(category)) setSelectedCategories((current) => toggleValue(current, category));
      }}
      onStrainToggle={(strain) => setSelectedStrains((current) => toggleValue(current, strain))}
      onBrandToggle={(brand) => setSelectedBrands((current) => toggleValue(current, brand))}
      onWeightToggle={(weight) => setSelectedWeights((current) => toggleValue(current, weight))}
      onMaxThcChange={setMaxThc}
      onMaxCbdChange={setMaxCbd}
      onMaxPriceChange={setMaxPrice}
      onReset={resetFilters}
      minAvailablePrice={minAvailablePrice}
      maxAvailablePrice={maxAvailablePrice}
      maxAvailableThc={maxAvailableThc}
      maxAvailableCbd={maxAvailableCbd}
      categoryOptions={categoryOptions}
      strainOptions={strainOptions}
      brandOptions={brandOptions}
      weightOptions={weightOptions}
      clearanceActive={clearanceOnly}
      dailyDealsActive={dailyDealsOnly}
      onClearanceToggle={toggleClearance}
      onDailyDealsToggle={toggleDailyDeals}
    />
  );

  return (
    <section className="mx-auto grid max-w-[88rem] gap-5 overflow-x-clip px-3 py-5 sm:px-4 md:px-8 md:py-8 lg:grid-cols-[280px_1fr] lg:gap-8">
      {/* Active filter pills — horizontal row directly below the breadcrumb, spanning full width. */}
      <div className="lg:col-span-2">
        <FilterTags tags={activeFilterTags} onClearAll={resetFilters} />
      </div>

      {/* Mobile-only special collection banner (desktop heading is rendered inline in the toolbar). */}
      {initialSpecial ? (
        <div className="rounded-3xl border border-[var(--gold)]/30 bg-[var(--gold)]/10 p-4 lg:col-start-2 lg:row-start-2 lg:hidden md:p-5">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--gold)]">Special collection</p>
          <div className="mt-2 flex flex-col gap-3">
            <h2 className="text-xl font-black uppercase tracking-tight text-white md:text-2xl">{initialSpecial.label}</h2>
          </div>
        </div>
      ) : null}

      {/* MOBILE: search + sort row ABOVE the Filters & Categories dropdown. */}
      <div className="flex flex-row items-center gap-2.5 lg:hidden">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search products, brands..."
          aria-label="Search products"
          className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-zinc-950 px-4 text-sm font-bold text-white outline-none transition placeholder:text-zinc-600 hover:border-[var(--greenway)]/45 focus:border-[var(--greenway)] focus:ring-2 focus:ring-[var(--greenway)]/20"
        />
        <div className="w-[8.5rem] shrink-0">
          <SortDropdown value={sortBy} onChange={setSortBy} />
        </div>
      </div>

      <div className="lg:hidden">
        <FilterMobile activeCount={activeFilterCount} resultCount={filteredItems.length}>
          {filterControls}
        </FilterMobile>
      </div>

      <aside className="hidden rounded-3xl border border-white/10 bg-zinc-950 p-5 lg:col-start-1 lg:row-start-2 lg:row-span-2 lg:block lg:self-start">
        {filterControls}
      </aside>

      <div className="lg:col-start-2 lg:row-start-2 lg:space-y-6">
        {/* Toolbar row: category/collection title on the left, search + sort inline on the right. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <h2 className="min-w-0 truncate text-2xl font-black text-white md:text-3xl">
            {toolbarTitle}
          </h2>
          {/* DESKTOP search + sort (mobile renders these above the filters dropdown). */}
          <div className="hidden flex-row items-center gap-2.5 sm:shrink-0 sm:gap-3 lg:flex">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products, brands, categories"
              aria-label="Search products"
              className="h-11 w-full rounded-full border border-white/10 bg-zinc-950 px-4 text-sm font-bold text-white outline-none transition placeholder:text-zinc-600 hover:border-[var(--greenway)]/45 focus:border-[var(--greenway)] focus:ring-2 focus:ring-[var(--greenway)]/20 sm:w-[18rem] lg:w-[22rem]"
            />
            <div className="w-[8.5rem] shrink-0 sm:w-[11rem]">
              <SortDropdown value={sortBy} onChange={setSortBy} />
            </div>
          </div>
        </div>

        {showAccessorySections ? (
          <section id="accessories" className="scroll-mt-32">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {accessorySectionCards.map((card) => <AccessoryCard key={card.key} card={card} />)}
            </div>
          </section>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/20 bg-zinc-950 p-10 text-center">
            <p className="text-2xl font-black text-white">No products match those filters.</p>
            <button onClick={resetFilters} className="mt-6 rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-black">Reset filters</button>
          </div>
        ) : (
          <div className="space-y-10">
            {groupedItems.map((group, index) => (
              <section key={group.key} id={group.id} className="scroll-mt-32">
                {/* The first section's title is shown inline in the toolbar above, so
                    skip its duplicate heading and let the cards sit flush. */}
                {index === 0 ? null : (
                  <div className="mb-4 min-w-0">
                    <h2 className="text-3xl font-black text-white">{group.label}</h2>
                  </div>
                )}
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {group.items.map((item) => <ProductCard key={item.id} item={item} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
