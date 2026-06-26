"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FilterCheckboxGroup, type FilterCheckboxOption } from "./FilterCheckboxGroup";
import { FilterSection } from "./FilterSection";

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
  selectedBrands: string[];
  selectedWeights: string[];
  maxThc: number;
  maxCbd: number;
  maxPrice: number;
  minAvailablePrice?: number;
  maxAvailablePrice?: number;
  maxAvailableThc?: number;
  maxAvailableCbd?: number;
  onCategoryToggle: (category: string) => void;
  onStrainToggle: (strain: string) => void;
  onBrandToggle: (brand: string) => void;
  onWeightToggle: (weight: string) => void;
  onMaxThcChange: (value: number) => void;
  onMaxCbdChange: (value: number) => void;
  onMaxPriceChange: (price: number) => void;
  onReset: () => void;
  categoryOptions: FilterCheckboxOption[];
  strainOptions: FilterCheckboxOption[];
  brandOptions: FilterCheckboxOption[];
  weightOptions: FilterCheckboxOption[];
  clearanceActive?: boolean;
  dailyDealsActive?: boolean;
  onClearanceToggle?: () => void;
  onDailyDealsToggle?: () => void;
};

export function MenuFilterControls({
  selectedCategories,
  selectedStrains,
  selectedBrands,
  selectedWeights,
  maxThc,
  maxCbd,
  maxPrice,
  minAvailablePrice = 0,
  maxAvailablePrice = 100,
  maxAvailableThc = 100,
  maxAvailableCbd = 100,
  onCategoryToggle,
  onStrainToggle,
  onBrandToggle,
  onWeightToggle,
  onMaxThcChange,
  onMaxCbdChange,
  onMaxPriceChange,
  onReset,
  categoryOptions,
  strainOptions,
  brandOptions,
  weightOptions,
  clearanceActive = false,
  dailyDealsActive = false,
  onClearanceToggle,
  onDailyDealsToggle,
}: MenuFilterControlsProps) {
  const specialsEnabled = Boolean(onClearanceToggle || onDailyDealsToggle);
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
          {/* Styled to match the other filter sections (same checkbox-row look as
              Categories / Brands / Strains) instead of standalone pill buttons. */}
          <div className="grid gap-2">
            <label
              className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                clearanceActive ? "border-[var(--greenway)] bg-[var(--greenway)]/10 text-white" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:text-white"
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  name="specials"
                  value="clearance"
                  checked={clearanceActive}
                  onChange={onClearanceToggle}
                  className="peer sr-only"
                />
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded border-2 border-zinc-500 bg-transparent text-[0.7rem] font-black leading-none text-black transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--greenway)]/35 peer-checked:border-[var(--orange)] peer-checked:bg-[var(--orange)] peer-checked:text-black" aria-hidden="true">
                  ✓
                </span>
                <span className="truncate font-bold">50% Off</span>
              </span>
            </label>
            <label
              className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                dailyDealsActive ? "border-[var(--greenway)] bg-[var(--greenway)]/10 text-white" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:text-white"
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  name="specials"
                  value="daily-deals"
                  checked={dailyDealsActive}
                  onChange={onDailyDealsToggle}
                  className="peer sr-only"
                />
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded border-2 border-zinc-500 bg-transparent text-[0.7rem] font-black leading-none text-black transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--greenway)]/35 peer-checked:border-[var(--orange)] peer-checked:bg-[var(--orange)] peer-checked:text-black" aria-hidden="true">
                  ✓
                </span>
                <span className="truncate font-bold">Daily Deals</span>
              </span>
            </label>
          </div>
        </FilterSection>
      ) : null}

      <FilterSection title="Categories">
        <FilterCheckboxGroup name="categories" options={categoryOptions} selectedValues={selectedCategories} onToggle={onCategoryToggle} />
      </FilterSection>

      <FilterSection title="Brands">
        <FilterCheckboxGroup name="brands" options={brandOptions} selectedValues={selectedBrands} onToggle={onBrandToggle} searchable searchPlaceholder="Search brands..." />
      </FilterSection>

      <FilterSection title="Strains">
        <FilterCheckboxGroup name="strains" options={strainOptions} selectedValues={selectedStrains} onToggle={onStrainToggle} />
      </FilterSection>

      <FilterSection title="Weights" defaultOpen={false}>
        <FilterCheckboxGroup name="weights" options={weightOptions} selectedValues={selectedWeights} onToggle={onWeightToggle} />
      </FilterSection>

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
