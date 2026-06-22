export type SortOption = "name-az" | "name-za" | "price-low" | "price-high" | "category" | "best-sellers" | "potency-low" | "potency-high";

export const sortOptions: { value: SortOption; label: string; helper: string }[] = [
  { value: "name-az", label: "Name A-Z", helper: "Alphabetical product browsing" },
  { value: "name-za", label: "Name Z-A", helper: "Reverse alphabetical browsing" },
  { value: "price-low", label: "Price Low-High", helper: "Lowest mock price first" },
  { value: "price-high", label: "Price High-Low", helper: "Highest mock price first" },
  { value: "category", label: "Category", helper: "Group similar product types" },
  { value: "best-sellers", label: "Best Sellers", helper: "Preview order using mock inventory depth" },
  { value: "potency-low", label: "Low to High Potency", helper: "Lowest listed THC/CBD value first" },
  { value: "potency-high", label: "High to Low Potency", helper: "Highest listed THC/CBD value first" },
];

type SortDropdownProps = {
  value: SortOption;
  onChange: (value: SortOption) => void;
};

export function SortDropdown({ value, onChange }: SortDropdownProps) {
  const activeOption = sortOptions.find((option) => option.value === value) ?? sortOptions[0];

  return (
    <label className="grid gap-1.5 text-[0.62rem] font-black uppercase tracking-[0.14em] text-zinc-300 sm:min-w-64 lg:gap-2 lg:text-xs">
      <span className="flex items-center justify-between gap-3">
        Sort by
        <span className="hidden text-[0.64rem] font-bold tracking-[0.14em] text-[var(--greenway)] sm:inline">{activeOption.helper}</span>
      </span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as SortOption)}
          className="h-12 w-full appearance-none rounded-full border border-white/10 bg-zinc-950 px-3 pr-8 text-xs font-black uppercase tracking-[0.08em] text-white outline-none transition hover:border-[var(--greenway)]/45 focus:border-[var(--greenway)] focus:ring-2 focus:ring-[var(--greenway)]/20 sm:px-4 sm:pr-10 sm:text-sm sm:normal-case sm:tracking-normal"
          aria-label="Sort preview products"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--greenway)] sm:right-4" aria-hidden="true">
          ⌄
        </span>
      </span>
    </label>
  );
}
