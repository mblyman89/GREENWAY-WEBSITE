import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductOrderIntent } from "@/components/menu/ProductOrderIntent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { getMockMenuItemById, mockMenuItems } from "@/lib/leafly/mock-menu";
import type { GreenwayCannabinoid, GreenwayMenuItem } from "@/lib/leafly/types";
import { getPosPreviewMenuItemById, posMenuPreviewItems } from "@/lib/pos/preview-menu";

const strainStyles: Record<GreenwayMenuItem["strainType"], string> = {
  indica: "border-blue-400/70 bg-blue-400/10 text-blue-100",
  sativa: "border-green-400/70 bg-green-400/10 text-green-100",
  hybrid: "border-orange-400/70 bg-orange-400/10 text-orange-100",
  cbd: "border-purple-300/70 bg-purple-300/10 text-purple-100",
  unknown: "border-zinc-500 bg-zinc-500/10 text-zinc-100",
};

function formatCompound(compound: GreenwayCannabinoid) {
  if (!compound.value) return `${compound.type.toUpperCase()} unknown`;
  return `${compound.type.toUpperCase()} ${compound.value}${compound.unit}`;
}

function inventoryLabel(inventoryLevel: number) {
  if (inventoryLevel <= 0) return "Unavailable";
  if (inventoryLevel <= 5) return "Low stock";
  return "In stock";
}

function getMenuItemById(id: string) {
  return getPosPreviewMenuItemById(id) ?? getMockMenuItemById(id);
}

function isPosItem(item: GreenwayMenuItem) {
  return item.id.startsWith("pos-");
}

export function generateStaticParams() {
  return [...posMenuPreviewItems, ...mockMenuItems].map((item) => ({ id: item.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const item = getMenuItemById(id);

  if (!item) {
    return {
      title: "Product Not Found | Greenway Marijuana",
    };
  }

  return {
    title: `${item.name} | Greenway Marijuana Menu`,
    description: item.description,
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getMenuItemById(id);

  if (!item) notFound();

  const sourceIsPos = isPosItem(item);
  const sourceLabel = sourceIsPos ? "Exact POS menu item" : "Mock fallback item";
  const dataSourceLabel = sourceIsPos ? "Exact POS match" : "Mock preview";

  return (
    <main id="top" className="bg-black text-white">
      <Header />
      <section className="relative overflow-hidden border-b border-white/10 px-4 py-10 md:px-8 md:py-14">
        <div className="noise-overlay" />
        <div className="relative mx-auto max-w-7xl">
          <Link href="/menu" className="inline-flex rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]">
            ← Back to menu
          </Link>

          <div className="mt-8 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className={`film-strip rounded-[2rem] border-2 p-4 ${strainStyles[item.strainType]}`}>
              <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-white/15 via-black to-black">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(126,217,87,0.28),transparent_34%),radial-gradient(circle_at_78%_78%,rgba(255,127,0,0.26),transparent_34%)]" />
                <div className="relative text-center">
                  <p className="text-xs font-black uppercase tracking-[0.28em] text-zinc-300">{sourceLabel}</p>
                  <p className="mt-4 text-4xl font-black uppercase tracking-[0.12em] text-white md:text-6xl">{item.category}</p>
                  <p className="mt-4 text-sm font-black uppercase tracking-[0.18em] text-[var(--orange)]">{dataSourceLabel}</p>
                </div>
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-[var(--greenway)] bg-[var(--greenway)]/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">{item.category}</span>
                <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${strainStyles[item.strainType]}`}>{item.strainType}</span>
                <span className="rounded-full border border-white/15 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-zinc-300">{item.brand}</span>
                <span className="rounded-full border border-[var(--orange)]/45 bg-[var(--orange)]/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[var(--orange)]">{sourceIsPos ? "POS" : "Mock"}</span>
              </div>

              <h1 className="mt-5 text-5xl font-black leading-none text-white md:text-7xl">{item.name}</h1>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-300">{item.description}</p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-zinc-500">Starting price</p>
                  <p className="mt-2 text-2xl font-black text-[var(--orange)]">{formatMinorCurrency(item.priceMinorUnits)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-zinc-500">Total THC</p>
                  <p className="mt-2 text-2xl font-black text-white">{item.totalThc ? formatCompound(item.totalThc) : "Unknown"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-zinc-500">Total CBD</p>
                  <p className="mt-2 text-2xl font-black text-white">{item.totalCbd ? formatCompound(item.totalCbd) : "Unknown"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-zinc-500">Variants</p>
                  <p className="mt-2 text-2xl font-black text-white">{item.variants.length}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-10 md:px-8 md:py-14">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[2rem] border border-white/10 bg-[#111] p-5 md:p-7">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Package variants</p>
                <h2 className="mt-2 text-3xl font-black text-white">Package options and inventory</h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-zinc-400">Each option uses a stable variant ID, package label, minor-unit price, and available inventory level from the current menu data source.</p>
            </div>

            <div className="mt-6 grid gap-3">
              {item.variants.map((variant) => (
                <div key={variant.id} className="grid gap-4 rounded-2xl border border-white/10 bg-black/40 p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div>
                    <p className="text-lg font-black text-white">{variant.label}</p>
                    <p className="mt-1 break-all text-xs font-bold text-zinc-500">Variant ID: {variant.id}</p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-zinc-500">Price</p>
                    <p className="text-xl font-black text-[var(--orange)]">{formatMinorCurrency(variant.priceMinorUnits)}</p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-zinc-500">Inventory</p>
                    <p className="text-sm font-black uppercase tracking-[0.12em] text-[var(--greenway)]">{inventoryLabel(variant.inventoryLevel)} · {variant.inventoryLevel}</p>
                    <p className="mt-1 text-xs text-zinc-500">{variant.medical ? "Medical" : "Recreational"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="grid gap-6">
            <ProductOrderIntent item={item} />

            <div className="rounded-[2rem] border border-white/10 bg-zinc-950 p-5 md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Cannabinoids</p>
              <h2 className="mt-2 text-3xl font-black text-white">Compound summary</h2>
              {item.compounds.length > 0 ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {item.compounds.map((compound) => (
                    <span key={`${compound.type}-${compound.value}-${compound.unit}`} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-black uppercase tracking-[0.1em] text-zinc-100">
                      {formatCompound(compound)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm leading-6 text-zinc-400">No cannabinoid values are shown for this item. Missing values intentionally stay unknown/null rather than being replaced with zero.</p>
              )}
            </div>

            <div className="rounded-[2rem] border border-[var(--greenway)]/30 bg-[var(--greenway)]/10 p-5 md:p-7">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Data note</p>
              <div className="mt-4 grid gap-3 text-sm leading-6 text-zinc-200">
                <p>{sourceIsPos ? "This item is from the exact-match POS menu feed. Ambiguous, fuzzy, unmatched, and enriched product data are still intentionally held back until their rules are approved." : "This item is from the mock fallback catalog and remains available for testing older preview flows."}</p>
                <dl className="grid gap-2 rounded-2xl border border-white/10 bg-black/35 p-4">
                  <div className="flex justify-between gap-4"><dt>Data source</dt><dd className="text-[var(--greenway)]">{dataSourceLabel}</dd></div>
                  <div className="flex justify-between gap-4"><dt>Images</dt><dd>Placeholder package art</dd></div>
                  <div className="flex justify-between gap-4"><dt>Description</dt><dd>{sourceIsPos ? "Temporary POS placeholder" : "Mock description"}</dd></div>
                  <div className="flex justify-between gap-4"><dt>Ordering</dt><dd>Preview only</dd></div>
                </dl>
              </div>
            </div>
          </aside>
        </div>
      </section>
      <Footer />
    </main>
  );
}
