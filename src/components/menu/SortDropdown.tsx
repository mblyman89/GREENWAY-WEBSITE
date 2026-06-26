export type SortOption = "featured-shuffle" | "name-az" | "name-za" | "price-low" | "price-high" | "category" | "best-sellers" | "potency-low" | "potency-high";

export const sortOptions: { value: SortOption; label: string; helper: string }[] = [
  { value: "featured-shuffle", label: "Featured Shuffle", helper: "Rotates products on every visit" },
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
  // The control ALWAYS reads "SORT BY" (no separate label above it). The native
  // <select> still lists every option — including "Featured Shuffle" — and keeps
  // its full behavior; we just overlay the fixed "SORT BY" text so the closed
  // control communicates its purpose instead of the current sort value.
  return (
    <label className="relative block h-11 w-full">
      <span className="sr-only">Sort products</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SortOption)}
        className="h-11 w-full cursor-pointer appearance-none rounded-full border border-white/10 bg-zinc-950 pl-4 pr-10 text-sm font-black uppercase tracking-[0.12em] text-transparent outline-none transition hover:border-[var(--greenway)]/45 focus:border-[var(--greenway)] focus:ring-2 focus:ring-[var(--greenway)]/20"
        aria-label="Sort products"
      >
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value} className="text-white">
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm font-black uppercase tracking-[0.12em] text-white" aria-hidden="true">
        Sort By
      </span>
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--greenway)]" aria-hidden="true">
        ⌄
      </span>
    </label>
  );
}
