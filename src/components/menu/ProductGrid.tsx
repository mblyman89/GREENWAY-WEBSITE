import { menuCategories, mockMenuItems } from "@/lib/leafly/mock-menu";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import { ProductCard } from "./ProductCard";

export function ProductGrid() {
  return (
    <div className="space-y-10">
      {menuCategories.map((category) => {
        const items = mockMenuItems.filter((item) => item.category === category);
        if (items.length === 0) return null;

        return (
          <section key={category} id={category} className="scroll-mt-32">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--greenway)]">Category</p>
                <h2 className="mt-1 text-3xl font-black text-white">{formatWebsiteCategory(category)}</h2>
              </div>
              <a href="#top" className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500 hover:text-white">Top ↑</a>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => <ProductCard key={item.id} item={item} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
