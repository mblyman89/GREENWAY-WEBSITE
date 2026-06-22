"use client";

import { useEffect, useMemo, useState } from "react";
import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory, websiteCategories } from "@/lib/pos/category-taxonomy";
import { FilterMobile, MenuFilterControls } from "./FilterMobile";
import { FilterTags } from "./FilterTags";
import { ProductCard } from "./ProductCard";
import { SortDropdown, type SortOption } from "./SortDropdown";

const requestedWeights = ["1g", "2g", "3.5g", "7g", "14g", "28g"];

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
  const haystack = `${item.name} ${item.brand} ${item.category} ${categoryLabels} ${sourceClassifications} ${item.strainType} ${variantLabels}`.toLowerCase();
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

function sortItems(items: GreenwayMenuItem[], sortBy: SortOption) {
  return [...items].sort((a, b) => {
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
  return item.variants.flatMap((variant) => {
    const normalizedLabel = variant.label.toLowerCase();
    return requestedWeights.filter((weight) => normalizedLabel.includes(weight.toLowerCase()));
  });
}

function matchesCannabinoidSlider(value: number | null, maxValue: number) {
  if (maxValue === 100) return true;
  return value !== null && value <= maxValue;
}

function matchesPriceSlider(priceMinorUnits: number, maxPrice: number, maxAvailablePrice: number) {
  if (maxPrice >= maxAvailablePrice) return true;
  return priceMinorUnits <= maxPrice * 100;
}

function itemMatchesCriteria(item: GreenwayMenuItem, criteria: FilterCriteria, maxAvailablePrice: number) {
  const itemCategories = item.filterCategories?.length ? item.filterCategories : [item.category];
  const categoryOk = criteria.selectedCategories.length === 0 || criteria.selectedCategories.some((category) => itemCategories.includes(category));
  const strainOk = criteria.selectedStrains.length === 0 || criteria.selectedStrains.includes(item.strainType);
  const brandOk = criteria.selectedBrands.length === 0 || criteria.selectedBrands.includes(item.brand);
  const weightOk = criteria.selectedWeights.length === 0 || criteria.selectedWeights.some((weight) => itemWeightLabels(item).includes(weight));
  const thcOk = matchesCannabinoidSlider(cannabinoidPercentageValue(item.totalThc), criteria.maxThc);
  const cbdOk = matchesCannabinoidSlider(cannabinoidPercentageValue(item.totalCbd), criteria.maxCbd);
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

function buildRequestedWeightOptions(items: GreenwayMenuItem[], selectedWeights: string[]) {
  const counts = countValues(items.flatMap(itemWeightLabels));
  return requestedWeights.map((weight) => ({
    value: weight,
    label: weight,
    count: counts[weight] ?? 0,
  })).filter((option) => option.count > 0 || selectedWeights.includes(option.value) || requestedWeights.includes(option.value));
}

function criteriaWithout(criteria: FilterCriteria, key: keyof FilterCriteria): FilterCriteria {
  if (key === "query") return { ...criteria, query: "" };
  if (key === "selectedCategories") return { ...criteria, selectedCategories: [] };
  if (key === "selectedStrains") return { ...criteria, selectedStrains: [] };
  if (key === "selectedBrands") return { ...criteria, selectedBrands: [] };
  if (key === "selectedWeights") return { ...criteria, selectedWeights: [] };
  if (key === "maxThc") return { ...criteria, maxThc: 100 };
  if (key === "maxCbd") return { ...criteria, maxCbd: 100 };
  if (key === "maxPrice") return { ...criteria, maxPrice: 100 };
  return criteria;
}

function initialSearchParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function InteractiveMenuBrowser({ items }: { items: GreenwayMenuItem[] }) {
  const [initialParams] = useState(initialSearchParams);
  const initialSearchQuery = initialParams.get("search") ?? "";
  const initialCategoryParam = initialParams.get("category") ?? "";
  const initialCategory = isWebsiteCategory(initialCategoryParam) ? initialCategoryParam : "";
  const initialBrand = initialParams.get("brand") ?? "";
  const initialSpecialKey = initialParams.get("special") as PreviewSpecialCollectionKey | null;
  const initialSpecial = initialSpecialKey && initialSpecialKey in previewSpecialCollections ? previewSpecialCollections[initialSpecialKey] : null;
  const initialSpecialCategories = initialSpecial?.categories ?? [];
  const [query, setQuery] = useState(initialSearchQuery);
  const [selectedCategories, setSelectedCategories] = useState<GreenwayCategory[]>(initialCategory ? [initialCategory] : initialSpecialCategories);
  const [selectedStrains, setSelectedStrains] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>(initialBrand ? [initialBrand] : []);
  const [selectedWeights, setSelectedWeights] = useState<string[]>([]);
  const [maxThc, setMaxThc] = useState(100);
  const [maxCbd, setMaxCbd] = useState(100);
  const maxAvailablePrice = Math.max(100, Math.ceil(Math.max(...items.map((item) => item.priceMinorUnits), 0) / 100));
  const [maxPrice, setMaxPrice] = useState(initialSpecial?.maxPrice ?? maxAvailablePrice);
  const [sortBy, setSortBy] = useState<SortOption>(initialSpecial?.sortBy ?? "name-az");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const search = params.get("search") ?? "";
    const categoryParam = params.get("category") ?? "";
    const category = isWebsiteCategory(categoryParam) ? categoryParam : "";
    const brand = params.get("brand") ?? "";
    const specialKey = params.get("special") as PreviewSpecialCollectionKey | null;
    const special = specialKey && specialKey in previewSpecialCollections ? previewSpecialCollections[specialKey] : null;

    setQuery(search);
    setSelectedCategories(category ? [category] : special?.categories ?? []);
    setSelectedBrands(brand ? [brand] : []);
    setMaxPrice(special?.maxPrice ?? maxAvailablePrice);
    setSortBy(special?.sortBy ?? "name-az");
  }, [maxAvailablePrice]);

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
    const specialItems = specialItemIds ? items.filter((item) => specialItemIds.includes(item.id)) : items;

    return sortItems(specialItems.filter((item) => itemMatchesCriteria(item, criteria, maxAvailablePrice)), sortBy);
  }, [criteria, initialSpecial?.itemIds, items, sortBy]);

  const categoryOptions = useMemo(() => {
    const optionItems = items.filter((item) => itemMatchesCriteria(item, criteriaWithout(criteria, "selectedCategories"), maxAvailablePrice));
    return buildOptions(optionItems.flatMap((item) => item.filterCategories?.length ? item.filterCategories : [item.category]), selectedCategories, formatWebsiteCategory);
  }, [criteria, items, selectedCategories]);

  const strainOptions = useMemo(() => {
    const optionItems = items.filter((item) => itemMatchesCriteria(item, criteriaWithout(criteria, "selectedStrains"), maxAvailablePrice));
    return buildOptions(optionItems.map((item) => item.strainType).filter((strainType) => strainType !== "unknown"), selectedStrains.filter((strainType) => strainType !== "unknown"));
  }, [criteria, items, selectedStrains]);

  const brandOptions = useMemo(() => {
    const optionItems = items.filter((item) => itemMatchesCriteria(item, criteriaWithout(criteria, "selectedBrands"), maxAvailablePrice));
    return buildOptions(optionItems.map((item) => item.brand), selectedBrands);
  }, [criteria, items, selectedBrands]);

  const weightOptions = useMemo(() => {
    const optionItems = items.filter((item) => itemMatchesCriteria(item, criteriaWithout(criteria, "selectedWeights"), maxAvailablePrice));
    return buildRequestedWeightOptions(optionItems, selectedWeights);
  }, [criteria, items, selectedWeights]);

  const groupedItems = useMemo(() => {
    return websiteCategories
      .map((category) => ({ category, items: filteredItems.filter((item) => item.category === category) }))
      .filter((group) => group.items.length > 0);
  }, [filteredItems]);

  const resetFilters = () => {
    setQuery("");
    setSelectedCategories([]);
    setSelectedStrains([]);
    setSelectedBrands([]);
    setSelectedWeights([]);
    setMaxThc(100);
    setMaxCbd(100);
    setMaxPrice(maxAvailablePrice);
    setSortBy("name-az");
  };

  const activeFilterTags = [
    ...(query.trim()
      ? [
          {
            key: "search",
            label: "Search",
            value: query.trim(),
            onRemove: () => setQuery(""),
          },
        ]
      : []),
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
      value: strain,
      onRemove: () => setSelectedStrains((current) => current.filter((value) => value !== strain)),
    })),
    ...selectedWeights.map((weight) => ({
      key: `weight-${weight}`,
      label: "Weight",
      value: weight,
      onRemove: () => setSelectedWeights((current) => current.filter((value) => value !== weight)),
    })),
    ...(maxThc !== 100
      ? [
          {
            key: "thc",
            label: "Max THC",
            value: `${maxThc}%`,
            onRemove: () => setMaxThc(100),
          },
        ]
      : []),
    ...(maxCbd !== 100
      ? [
          {
            key: "cbd",
            label: "Max CBD",
            value: `${maxCbd}%`,
            onRemove: () => setMaxCbd(100),
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
      maxAvailablePrice={maxAvailablePrice}
      categoryOptions={categoryOptions}
      strainOptions={strainOptions}
      brandOptions={brandOptions}
      weightOptions={weightOptions}
    />
  );

  return (
    <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 md:px-8 md:py-10 lg:grid-cols-[300px_1fr] lg:gap-8">
      <div className="space-y-3 lg:col-start-2 lg:space-y-5">
        {initialSpecial ? (
          <div className="rounded-3xl border border-[var(--gold)]/30 bg-[var(--gold)]/10 p-4 md:p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--gold)]">Special collection</p>
            <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight text-white md:text-2xl">{initialSpecial.label}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-300">{initialSpecial.helper}</p>
              </div>
              <span className="w-fit rounded-full border border-white/10 bg-black/35 px-4 py-2 text-[0.68rem] font-black uppercase tracking-[0.14em] text-zinc-300">
                Shop eligible items
              </span>
            </div>
          </div>
        ) : null}

        <div className="rounded-[1.35rem] border border-white/10 bg-black/45 p-3 shadow-xl shadow-black/20 md:p-4 lg:grid lg:grid-cols-[1fr_minmax(220px,0.85fr)_minmax(250px,0.75fr)] lg:items-end lg:gap-4 lg:rounded-3xl">
          <div className="hidden lg:block">
            <p className="text-sm font-black text-white">Showing {filteredItems.length} of {items.length} POS products</p>
            <p className="mt-1 text-xs text-zinc-400">Filters use POS inventory type + category classification.</p>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_7.25rem] gap-2 lg:contents">
            <label className="grid gap-1.5 text-[0.62rem] font-black uppercase tracking-[0.14em] text-zinc-300 lg:gap-2 lg:text-xs">
              Search
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products, brands, POS categories"
                className="h-12 w-full rounded-full border border-white/10 bg-zinc-950 px-4 text-sm font-bold normal-case tracking-normal text-white outline-none transition placeholder:text-zinc-600 hover:border-[var(--greenway)]/45 focus:border-[var(--greenway)] focus:ring-2 focus:ring-[var(--greenway)]/20"
              />
            </label>
            <SortDropdown value={sortBy} onChange={setSortBy} />
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <FilterMobile activeCount={activeFilterCount} resultCount={filteredItems.length}>
          {filterControls}
        </FilterMobile>
      </div>

      <aside className="hidden rounded-3xl border border-white/10 bg-zinc-950 p-5 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-28 lg:block lg:self-start">
        {filterControls}
      </aside>

      <div className="lg:col-start-2">
        <FilterTags tags={activeFilterTags} onClearAll={resetFilters} />

        {filteredItems.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/20 bg-zinc-950 p-10 text-center">
            <p className="text-2xl font-black text-white">No preview products match those filters.</p>
            <p className="mt-3 text-sm text-zinc-400">Try widening THC, CBD, price, search, or checkbox selections.</p>
            <button onClick={resetFilters} className="mt-6 rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-black">Reset filters</button>
          </div>
        ) : (
          <div className="space-y-10">
            {groupedItems.map((group) => (
              <section key={group.category} id={group.category} className="scroll-mt-32">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--greenway)]">Category</p>
                    <h2 className="mt-1 text-3xl font-black text-white">{formatWebsiteCategory(group.category)}</h2>
                  </div>
                  <span className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{group.items.length} items</span>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
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
