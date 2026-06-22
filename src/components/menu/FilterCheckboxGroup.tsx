"use client";

import { useMemo, useState } from "react";

export type FilterCheckboxOption = {
  value: string;
  label: string;
  count: number;
};

type FilterCheckboxGroupProps = {
  name: string;
  options: FilterCheckboxOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  initialVisibleCount?: number;
};

export function FilterCheckboxGroup({
  name,
  options,
  selectedValues,
  onToggle,
  searchable = false,
  searchPlaceholder = "Search options...",
  emptyMessage = "No matching filter options.",
  initialVisibleCount = 5,
}: FilterCheckboxGroupProps) {
  const [query, setQuery] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  const searchedOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  const visibleOptions = isExpanded ? searchedOptions : searchedOptions.slice(0, initialVisibleCount);
  const canToggleMore = searchedOptions.length > initialVisibleCount;

  return (
    <div className="grid gap-3">
      {searchable ? (
        <label className="grid gap-2 text-[0.68rem] font-black uppercase tracking-[0.14em] text-zinc-400">
          Search brands
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-full border border-white/10 bg-black/35 px-4 py-2.5 text-sm font-bold normal-case tracking-normal text-white outline-none transition placeholder:text-zinc-600 hover:border-[var(--greenway)]/45 focus:border-[var(--greenway)] focus:ring-2 focus:ring-[var(--greenway)]/20"
          />
        </label>
      ) : null}

      {visibleOptions.length ? (
        <div className="grid gap-2">
          {visibleOptions.map((option) => {
            const checked = selectedValues.includes(option.value);

            return (
              <label key={option.value} className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition ${checked ? "border-[var(--greenway)] bg-[var(--greenway)]/10 text-white" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:text-white"}`}>
                <span className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    name={name}
                    value={option.value}
                    checked={checked}
                    onChange={() => onToggle(option.value)}
                    className="peer sr-only"
                  />
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded border-2 border-zinc-500 bg-transparent text-[0.7rem] font-black leading-none text-black transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--greenway)]/35 peer-checked:border-[var(--orange)] peer-checked:bg-[var(--orange)] peer-checked:text-black" aria-hidden="true">
                    {checked ? "✓" : ""}
                  </span>
                  <span className="truncate capitalize">{option.label}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[0.65rem] font-black ${checked ? "bg-[var(--greenway)]/15 text-[var(--greenway)]" : "bg-black/35 text-zinc-500"}`}>{option.count}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-3 text-xs leading-5 text-zinc-500">{emptyMessage}</p>
      )}

      {canToggleMore ? (
        <button type="button" onClick={() => setIsExpanded((current) => !current)} className="w-fit rounded-full border border-white/10 bg-black/35 px-4 py-2 text-[0.65rem] font-black uppercase tracking-[0.14em] text-zinc-300 transition hover:border-[var(--greenway)]/45 hover:text-white">
          {isExpanded ? "Show less" : `Show more (${searchedOptions.length - initialVisibleCount})`}
        </button>
      ) : null}
    </div>
  );
}
