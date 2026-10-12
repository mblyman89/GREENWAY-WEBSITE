"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FilterCheckboxGroup, type FilterCheckboxOption } from "./FilterCheckboxGroup";
import { FilterSection } from "./FilterSection";
import type { MenuSpecialFilter } from "@/lib/menu/menu-special-filters-core";
import type { DohFilterOption } from "@/lib/menu/menu-doh-filter-core";
import type { ClassificationFilterOption } from "@/lib/menu/menu-classification-filter-core";
import { FilterRangeSlider } from "./FilterRangeSlider";
import { MG_FACET_LABELS, MG_FACET_TYPES, type MgBounds, type MgFacetType, type MgRange, type MgSelection } from "@/lib/menu/menu-mg-facet-core";

type FilterMobileProps = {
  activeCount: number;
  resultCount: number;
  children: ReactNode;
};

export function FilterMobile({ activeCount, resultCount, children }: FilterMobileProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex min-h-14 w-full items-center justify-between gap-4 rounded-[1.35rem] border border-[var(--greenway)]/30 bg-[var(--greenway)]/12 px-4 py-3 text-left shadow-xl shadow-black/20 transition hover:border-[var(--greenway)]/60"
        aria-expanded={isOpen}
        aria-controls="mobile-menu-filters"
      >
        <span>
          <span className="block text-sm font-black uppercase tracking-[0.14em] text-white">Filters & Categories</span>
          <span className="mt-1 block text-[0.72rem] font-bold uppercase tracking-[0.1em] text-zinc-400">
            {activeCount > 0 ? `${activeCount} active` : "All products"} · {resultCount} results
          </span>
        </span>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--orange)] text-xl font-black text-black" aria-hidden="true">
          +
        </span>
      </button>

      {isOpen ? (
        <div id="mobile-menu-filters" className="fixed inset-0 z-[90] bg-black text-white" role="dialog" aria-modal="true" aria-label="Filters and categories">
          <div className="flex h-full flex-col">
            <header className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/95 px-4 py-4 backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Shop menu</p>
                  <h2 className="mt-1 text-2xl font-black uppercase tracking-tight text-white">Filters</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="grid h-11 w-11 place-items-center rounded-full bg-white text-2xl font-black leading-none text-black"
                  aria-label="Close filters"
                >
                  ×
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-5">
              {children}
            </div>

            <footer className="sticky bottom-0 border-t border-white/10 bg-zinc-950/95 p-4 backdrop-blur">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-full rounded-full bg-[var(--orange)] px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-black shadow-xl shadow-[rgba(255,127,0,0.2)]"
              >
                Show {resultCount} Results
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type MenuFilterControlsProps = {
  selectedCategories: string[];
  selectedStrains: string[];
  /** R49 S1: selected strain NAMES (the new "Strains" facet). Optional = back-compatible. */
  selectedStrainNames?: string[];
  selectedTerpenes: string[];
  selectedBrands: string[];
  /** PR 3: additive by-vendor facet (surfaces all brands by a producer). */
  selectedVendors: string[];
  selectedWeights: string[];
  /** R49 S2 — size facet (beverage fl oz / serving packs). Optional for back-compat. */
  selectedSizes?: string[];
  /** R49 S6: selected owner tag slugs (the "Tags" facet). Optional = back-compatible. */
  selectedTags?: string[];
  maxThc: number;
  maxCbd: number;
  maxPrice: number;
  minAvailablePrice?: number;
  maxAvailablePrice?: number;
  maxAvailableThc?: number;
  maxAvailableCbd?: number;
  onCategoryToggle: (category: string) => void;
  onStrainToggle: (strain: string) => void;
  onStrainNameToggle?: (name: string) => void;
  onTerpeneToggle: (terpene: string) => void;
  onBrandToggle: (brand: string) => void;
  onVendorToggle: (vendor: string) => void;
  onWeightToggle: (weight: string) => void;
  onSizeToggle?: (size: string) => void;
  onTagToggle?: (tag: string) => void;
  /** R49 S3 — package-mg range sliders. Bounds include ONLY the cannabinoids to show. */
  mgBounds?: MgBounds;
  mgSelection?: MgSelection;
  onMgChange?: (type: MgFacetType, range: MgRange) => void;
  onMaxThcChange: (value: number) => void;
  onMaxCbdChange: (value: number) => void;
  onMaxPriceChange: (price: number) => void;
  onReset: () => void;
  categoryOptions: FilterCheckboxOption[];
  strainOptions: FilterCheckboxOption[];
  /** R49 S1: every strain name on the menu (cultivars only; edible flavors excluded). */
  strainNameOptions?: FilterCheckboxOption[];
  terpeneOptions: FilterCheckboxOption[];
  brandOptions: FilterCheckboxOption[];
  /** PR 3: by-vendor options (mirrors brandOptions; derived from item.vendor). */
  vendorOptions: FilterCheckboxOption[];
  weightOptions: FilterCheckboxOption[];
  sizeOptions?: FilterCheckboxOption[];
  /** R49 S6: one option per owner tag on the menu (value = slug, label = tag name). */
  tagOptions?: FilterCheckboxOption[];
  /**
   * SLICE C (SHOP-3): the Specials section is now FULLY DYNAMIC — a data-driven
   * list of filters (the two built-in lanes + any one-off SALE a carousel slide
   * links) instead of two hardcoded checkboxes. One-at-a-time selection.
   */
  specialFilters?: MenuSpecialFilter[];
  activeSpecialId?: string | null;
  onSpecialToggle?: (id: string) => void;
  /**
   * SLICE E (SHOP-5): the dynamic DOH filter. Options are derived from the live
   * menu's DOH-compliant items (SLICE D flag) — the umbrella "DOH Compliant"
   * lane plus one lane per present DOH category. Empty array (no compliant
   * items / pre-migration) ⇒ the section does not render. One-at-a-time.
   */
  dohOptions?: DohFilterOption[];
  activeDohId?: string | null;
  onDohToggle?: (id: string) => void;
  /**
   * SLICE 18B: the dynamic sales-limit classification facet ("Product Type").
   * Lanes are derived from the live menu using the REGISTER's own qualifying
   * rules, so a lane only exists when products would actually be routed to
   * that bucket at the till. Empty array (nothing classified yet, or nothing
   * fully qualifying) ⇒ the section never renders — no dead checkbox.
   */
  classificationOptions?: ClassificationFilterOption[];
  activeClassificationId?: string | null;
  onClassificationToggle?: (id: string) => void;
};

export function MenuFilterControls({
  selectedCategories,
  selectedStrains,
  selectedStrainNames = [],
  selectedTerpenes,
  selectedBrands,
  selectedVendors,
  selectedWeights,
  selectedSizes = [],
  selectedTags = [],
  maxThc,
  maxCbd,
  maxPrice,
  minAvailablePrice = 0,
  maxAvailablePrice = 100,
  maxAvailableThc = 100,
  maxAvailableCbd = 100,
  onCategoryToggle,
  onStrainToggle,
  onStrainNameToggle,
  onTerpeneToggle,
  onBrandToggle,
  onVendorToggle,
  onWeightToggle,
  onSizeToggle,
  onTagToggle,
  mgBounds = {},
  mgSelection = {},
  onMgChange,
  onMaxThcChange,
  onMaxCbdChange,
  onMaxPriceChange,
  onReset,
  categoryOptions,
  strainOptions,
  strainNameOptions = [],
  terpeneOptions,
  brandOptions,
  vendorOptions,
  weightOptions,
  sizeOptions = [],
  tagOptions = [],
  specialFilters = [],
  activeSpecialId = null,
  onSpecialToggle,
  dohOptions = [],
  activeDohId = null,
  onDohToggle,
  classificationOptions = [],
  activeClassificationId = null,
  onClassificationToggle,
}: MenuFilterControlsProps) {
  const specialsEnabled = Boolean(onSpecialToggle) && specialFilters.length > 0;
  const dohEnabled = Boolean(onDohToggle) && dohOptions.length > 0;
  // SLICE 18B: same two-part dynamic gate as DOH — a handler must be wired AND
  // the live menu must actually contain qualifying products.
  const classificationEnabled = Boolean(onClassificationToggle) && classificationOptions.length > 0;
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">Filters</h2>
        <button type="button" onClick={onReset} className="rounded-full bg-[var(--greenway)] px-3 py-2 text-[0.65rem] font-black uppercase tracking-[0.12em] text-black transition hover:bg-[var(--gold)]">
          Clear
        </button>
      </div>

      {specialsEnabled ? (
        <FilterSection title="Specials">
          {/* SLICE C (SHOP-3): fully data-driven. Renders the built-in lanes
              ("50% Off", "Daily Deals") AND any one-off SALE a carousel slide
              links — same checkbox-row look as Categories / Brands / Strains.
              One-at-a-time selection (mutually exclusive), so the boxes behave
              like radios (clicking the active one clears it). */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            {specialFilters.map((f) => {
              const active = activeSpecialId === f.id;
              return (
                <label
                  key={f.id}
                  className={`flex min-h-12 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                    active ? "border-[var(--greenway)] bg-[var(--greenway)]/10 text-white" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:text-white"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      name="specials"
                      value={f.id}
                      checked={active}
                      onChange={() => onSpecialToggle?.(f.id)}
                      className="peer sr-only"
                    />
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded border-2 border-zinc-500 bg-transparent text-[0.7rem] font-black leading-none text-black transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--greenway)]/35 peer-checked:border-[var(--orange)] peer-checked:bg-[var(--orange)] peer-checked:text-black" aria-hidden="true">
                      ✓
                    </span>
                    <span className="min-w-0 break-words font-bold leading-snug [overflow-wrap:anywhere]">{f.name}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </FilterSection>
      ) : null}

      <FilterSection title="Categories">
        <FilterCheckboxGroup name="categories" options={categoryOptions} selectedValues={selectedCategories} onToggle={onCategoryToggle} />
      </FilterSection>

      {/* R49 S6 - Tags: the owner's product tags (New, Staff Pick ...) from
          Admin > Inventory > Tags. Shown only when products carry tags (or a
          shared ?tags= link selected one), so menus without tags are unchanged. */}
      {onTagToggle && (tagOptions.length > 0 || selectedTags.length > 0) ? (
        <FilterSection title="Tags">
          <FilterCheckboxGroup name="tags" options={tagOptions} selectedValues={selectedTags} onToggle={onTagToggle} preserveCase />
        </FilterSection>
      ) : null}

      {/* PR 3: additive by-VENDOR facet, placed directly ABOVE Brands (owner
          directive). Filtering by vendor surfaces all brands by a producer \u2014 the
          same clean display vendor the Vendors page and Home vendor cards use.
          Only renders rows when the menu actually carries vendors. Brands stays
          byte-identical below. */}
      <FilterSection title="Vendors">
        <FilterCheckboxGroup name="vendors" options={vendorOptions} selectedValues={selectedVendors} onToggle={onVendorToggle} searchable searchLabel="Search vendors" searchPlaceholder="Search vendors..." />
      </FilterSection>

      <FilterSection title="Brands">
        <FilterCheckboxGroup name="brands" options={brandOptions} selectedValues={selectedBrands} onToggle={onBrandToggle} searchable searchPlaceholder="Search brands..." />
      </FilterSection>

      {/* R49 S1: owner renamed this section "Strain types" (indica / sativa /
          hybrid / leaning hybrids / CBD). The ?strains= param is unchanged. */}
      <FilterSection title="Strain types">
        <FilterCheckboxGroup name="strains" options={strainOptions} selectedValues={selectedStrains} onToggle={onStrainToggle} />
      </FilterSection>

      {/* R49 S1: NEW "Strains" section — every strain name on the menu. */}
      {onStrainNameToggle && (strainNameOptions.length > 0 || selectedStrainNames.length > 0) ? (
        <FilterSection title="Strains">
          <FilterCheckboxGroup name="strainNames" options={strainNameOptions} selectedValues={selectedStrainNames} onToggle={onStrainNameToggle} searchable searchLabel="Search strains" searchPlaceholder="Search strains..." preserveCase />
        </FilterSection>
      ) : null}

      {dohEnabled ? (
        <FilterSection title="DOH Compliant">
          {/* SLICE E (SHOP-5): dynamic DOH filter, placed with Strain Type as
              agreed. Renders the umbrella "DOH Compliant" lane plus one lane per
              present DOH category (General Use / High THC / High CBD). Same
              checkbox-row look as Specials; one-at-a-time (clicking the active
              one clears it). Only appears when the live menu actually has
              DOH-compliant items — no dead checkbox pre-migration. */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            {dohOptions.map((option) => {
              const active = activeDohId === option.id;
              return (
                <label
                  key={option.id}
                  className={`flex min-h-12 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                    active ? "border-[var(--greenway)] bg-[var(--greenway)]/10 text-white" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:text-white"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      name="doh"
                      value={option.id}
                      checked={active}
                      onChange={() => onDohToggle?.(option.id)}
                      className="peer sr-only"
                    />
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded border-2 border-zinc-500 bg-transparent text-[0.7rem] font-black leading-none text-black transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--greenway)]/35 peer-checked:border-[var(--orange)] peer-checked:bg-[var(--orange)] peer-checked:text-black" aria-hidden="true">
                      ✓
                    </span>
                    <span className="min-w-0 break-words font-bold leading-snug [overflow-wrap:anywhere]">{option.label}</span>
                  </span>
                  <span className="shrink-0 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-zinc-500" aria-hidden="true">
                    {option.count}
                  </span>
                </label>
              );
            })}
          </div>
        </FilterSection>
      ) : null}

      {classificationEnabled ? (
        <FilterSection title="Product Type">
          {/* SLICE 18B: the dynamic sales-limit classification facet, sitting
              next to DOH because both are compliance traits. Lanes come from
              the register's own qualifying rules, so "Low-THC Beverages" here
              means exactly what it means at the till — never just "somebody
              ticked a box". One-at-a-time (the two lanes are different
              statutory buckets, so selecting both would always return nothing).
              Only appears when the live menu actually has qualifying products. */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            {classificationOptions.map((option) => {
              const active = activeClassificationId === option.id;
              return (
                <label
                  key={option.id}
                  title={option.help}
                  className={`flex min-h-12 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                    active ? "border-[var(--greenway)] bg-[var(--greenway)]/10 text-white" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:text-white"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      name="classification"
                      value={option.id}
                      checked={active}
                      onChange={() => onClassificationToggle?.(option.id)}
                      className="peer sr-only"
                    />
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded border-2 border-zinc-500 bg-transparent text-[0.7rem] font-black leading-none text-black transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--greenway)]/35 peer-checked:border-[var(--orange)] peer-checked:bg-[var(--orange)] peer-checked:text-black" aria-hidden="true">
                      ✓
                    </span>
                    <span className="min-w-0 break-words font-bold leading-snug [overflow-wrap:anywhere]">{option.label}</span>
                  </span>
                  <span className="shrink-0 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-zinc-500" aria-hidden="true">
                    {option.count}
                  </span>
                </label>
              );
            })}
          </div>
        </FilterSection>
      ) : null}

      {(terpeneOptions.length > 0 || selectedTerpenes.length > 0) ? (
        <FilterSection title="Terpenes" defaultOpen={false}>
          <FilterCheckboxGroup name="terpenes" options={terpeneOptions} selectedValues={selectedTerpenes} onToggle={onTerpeneToggle} searchable searchPlaceholder="Search terpenes..." />
        </FilterSection>
      ) : null}

      <FilterSection title="Weights" defaultOpen={false}>
        <FilterCheckboxGroup name="weights" options={weightOptions} selectedValues={selectedWeights} onToggle={onWeightToggle} preserveCase />
      </FilterSection>
      {/* R49 S2 — Size: beverage volumes + single / multi-serving packs. Shown only when the menu has them. */}
      {onSizeToggle && (sizeOptions.length > 0 || selectedSizes.length > 0) ? (
        <FilterSection title="Size" defaultOpen={false}>
          <FilterCheckboxGroup name="sizes" options={sizeOptions} selectedValues={selectedSizes} onToggle={onSizeToggle} preserveCase />
        </FilterSection>
      ) : null}

      {/* R49 S3 — Cannabinoids (mg): one min–max slider per cannabinoid that the
          current products carry in verified per-package mg (edibles, drinks,
          tinctures, topicals …). Hidden entirely when no product has mg data. */}
      {onMgChange && MG_FACET_TYPES.some((type) => mgBounds[type]) ? (
        <FilterSection title="Cannabinoids (mg)" helper="Total mg per package" defaultOpen={false}>
          <div className="grid min-w-0 gap-5">
            {MG_FACET_TYPES.filter((type) => mgBounds[type]).map((type) => {
              const bounds = mgBounds[type]!;
              const value = mgSelection[type] ?? bounds;
              return (
                <FilterRangeSlider
                  key={type}
                  label={MG_FACET_LABELS[type]}
                  unit="mg"
                  boundsMin={bounds.min}
                  boundsMax={bounds.max}
                  valueMin={value.min}
                  valueMax={value.max}
                  onChange={(next) => onMgChange(type, next)}
                />
              );
            })}
          </div>
        </FilterSection>
      ) : null}

      <FilterSection title="Price">
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">Max Price: {maxPrice >= maxAvailablePrice ? `$${maxAvailablePrice}+` : `$${maxPrice}`}</span>
          <input
            type="range"
            min={minAvailablePrice}
            max={maxAvailablePrice}
            step="1"
            value={maxPrice}
            onChange={(event) => onMaxPriceChange(Number(event.target.value))}
            className="mt-4 w-full accent-[var(--orange)]"
          />
          <span className="mt-2 flex justify-between text-xs text-zinc-500"><span>${minAvailablePrice}</span><span>${maxAvailablePrice}+</span></span>
        </label>
      </FilterSection>

      <FilterSection title="THC">
        <label className="block">
          <span className="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">
            THC Percentage <span className="text-white">{maxThc >= maxAvailableThc ? `Up to ${maxAvailableThc}%` : `Up to ${maxThc}%`}</span>
          </span>
          <input
            type="range"
            min="0"
            max={maxAvailableThc}
            step="1"
            value={maxThc}
            onChange={(event) => onMaxThcChange(Number(event.target.value))}
            className="mt-4 w-full accent-[var(--orange)]"
          />
          <span className="mt-2 flex justify-between text-xs text-zinc-500"><span>0%</span><span>{maxAvailableThc}%</span></span>
        </label>
      </FilterSection>

      <FilterSection title="CBD">
        <label className="block">
          <span className="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">
            CBD Percentage <span className="text-white">{maxCbd >= maxAvailableCbd ? `Up to ${maxAvailableCbd}%` : `Up to ${maxCbd}%`}</span>
          </span>
          <input
            type="range"
            min="0"
            max={maxAvailableCbd}
            step="1"
            value={maxCbd}
            onChange={(event) => onMaxCbdChange(Number(event.target.value))}
            className="mt-4 w-full accent-[var(--orange)]"
          />
          <span className="mt-2 flex justify-between text-xs text-zinc-500"><span>0%</span><span>{maxAvailableCbd}%</span></span>
        </label>
      </FilterSection>
    </>
  );
}
