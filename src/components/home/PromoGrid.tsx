import Link from "next/link";
import { HomeBrands } from "@/components/home/HomeBrands";
import { SectionBanner } from "@/components/home/SectionBanner";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";
import { categoryLanes } from "@/lib/specials/daily-deal-presentation";

// Accent gradient per category tile (cycled in lane order).
const LANE_ACCENTS: Record<string, string> = {
  flower: "from-[var(--greenway)] to-emerald-700",
  prerolls: "from-amber-400 to-[var(--orange)]",
  concentrates: "from-[var(--gold)] to-[var(--orange)]",
  edibles: "from-rose-400 to-rose-700",
  liquids: "from-sky-400 to-blue-700",
  topicals: "from-fuchsia-400 to-purple-700",
};

/**
 * Home "Shop by Category" + "Shop by Brand" sections.
 *
 * Category: a wide/short SectionBanner header followed by the six fixed
 * customer-facing lanes (Flower, Prerolls, Concentrates, Edibles, Liquids,
 * Topicals). Each tile links to the pre-filtered menu via the lane's
 * /menu?categories=a,b,c href.
 *
 * Brand: delegated to the client HomeBrands component, which rotates through
 * brands (feature-shuffle style) into a 4x4 grid.
 */
export function PromoGrid() {
  return (
    <>
      <section
        id="shop-by-category"
        className="bg-black px-4 py-6 md:px-8 md:py-8"
        aria-label="Shop by category"
      >
        <div className="mx-auto max-w-[88rem] space-y-4 md:space-y-6">
          <SectionBanner
            imageSrc="/home/category-banner.webp"
            imageAlt="Greenway cannabis product categories"
            eyebrow="Browse the Menu"
            title="Shop by Category"
            subtitle="Jump straight into the products you want — every tile opens a pre-filtered menu."
          />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6">
            {categoryLanes.map((lane) => (
              <Link
                key={lane.key}
                href={lane.href}
                className="group relative isolate flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] p-4 shadow-lg shadow-black/30 transition hover:-translate-y-0.5 hover:border-white/25 lg:aspect-[3/4]"
              >
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${LANE_ACCENTS[lane.key] ?? "from-[var(--greenway)] to-emerald-700"} opacity-80 transition group-hover:opacity-95`}
                  aria-hidden="true"
                />
                <div
                  className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(255,255,255,0.3),transparent_55%),linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.72)_100%)]"
                  aria-hidden="true"
                />
                <div className="relative">
                  <p className="text-base font-black uppercase leading-tight tracking-tight text-white drop-shadow md:text-lg lg:text-xl">
                    {lane.label}
                  </p>
                  <p className="mt-0.5 text-[0.6rem] font-black uppercase tracking-[0.16em] text-white/80 md:text-[0.62rem]">
                    Shop now →
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <HomeBrands items={posMenuPreviewItems} />
    </>
  );
}
