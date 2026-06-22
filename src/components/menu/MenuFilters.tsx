import { menuCategories, mockMenuItems } from "@/lib/leafly/mock-menu";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";

function countFor(category: string) {
  return mockMenuItems.filter((item) => item.category === category).length;
}

export function MenuFilters() {
  const strainTypes = ["hybrid", "indica", "sativa", "cbd", "unknown"];

  return (
    <aside className="rounded-3xl border border-white/10 bg-zinc-950 p-5 lg:sticky lg:top-28 lg:self-start">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">Filters</h2>
        <span className="rounded-full bg-[var(--greenway)] px-3 py-1 text-[0.65rem] font-black uppercase text-black">Fallback</span>
      </div>

      <div className="mt-6 border-t border-white/10 pt-6">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">Categories</p>
        <div className="mt-4 grid gap-2">
          {menuCategories.map((category) => (
            <a key={category} href={`#${category}`} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-200 transition hover:border-[var(--greenway)] hover:text-white">
              <span>{formatWebsiteCategory(category)}</span>
              <span className="text-zinc-500">{countFor(category)}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="mt-6 border-t border-white/10 pt-6">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">Strain Type</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {strainTypes.map((type) => (
            <span key={type} className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold capitalize text-zinc-300">{type}</span>
          ))}
        </div>
      </div>

      <div className="mt-6 border-t border-white/10 pt-6">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">Price Range</p>
        <div className="mt-4 rounded-2xl bg-white/[0.03] p-4 text-sm text-zinc-300">
          <div className="h-2 rounded-full bg-zinc-800">
            <div className="h-2 w-2/3 rounded-full bg-[var(--orange)]" />
          </div>
          <div className="mt-3 flex justify-between text-xs text-zinc-500"><span>$0</span><span>$100+</span></div>
        </div>
      </div>
    </aside>
  );
}
