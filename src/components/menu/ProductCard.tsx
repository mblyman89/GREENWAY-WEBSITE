import Link from "next/link";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";

const strainStyles: Record<GreenwayMenuItem["strainType"], string> = {
  indica: "border-blue-400/80 text-blue-200",
  sativa: "border-green-400/80 text-green-200",
  hybrid: "border-orange-400/80 text-orange-200",
  cbd: "border-purple-300/80 text-purple-100",
  unknown: "border-zinc-500 text-zinc-200",
};

const packageAccent: Record<GreenwayMenuItem["strainType"], string> = {
  indica: "from-blue-500 via-blue-300 to-white",
  sativa: "from-emerald-500 via-lime-300 to-white",
  hybrid: "from-[var(--orange)] via-[var(--gold)] to-white",
  cbd: "from-purple-500 via-fuchsia-300 to-white",
  unknown: "from-zinc-500 via-zinc-200 to-white",
};

function ProductMockup({ item }: { item: GreenwayMenuItem }) {
  const initials = item.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-white p-3 shadow-inner shadow-black/10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(126,217,87,0.22),transparent_32%),radial-gradient(circle_at_76%_82%,rgba(255,127,0,0.16),transparent_34%)]" aria-hidden="true" />
      <div className="relative h-[78%] w-[64%] rounded-[1.1rem] border border-black/10 bg-zinc-950 p-2 shadow-2xl shadow-black/25">
        <div className={`h-full rounded-[0.9rem] bg-gradient-to-br ${packageAccent[item.strainType]} p-2 text-black`}>
          <div className="flex h-full flex-col justify-between rounded-[0.7rem] border border-black/10 bg-white/75 p-2 text-center backdrop-blur-sm">
            <p className="text-[0.48rem] font-black uppercase tracking-[0.18em] text-black/55">Greenway</p>
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-black text-sm font-black text-white shadow-lg shadow-black/25">
              {initials || "G"}
            </div>
            <p className="line-clamp-2 text-[0.52rem] font-black uppercase leading-tight text-black">{formatWebsiteCategory(item.category)}</p>
          </div>
        </div>
      </div>
      <span className="absolute left-2 top-2 rounded-full bg-black px-2 py-1 text-[0.55rem] font-black uppercase tracking-[0.12em] text-white">
        {formatWebsiteCategory(item.category)}
      </span>
      <span className="absolute right-2 top-2 rounded-full bg-[var(--gold)] px-2 py-1 text-[0.55rem] font-black uppercase tracking-[0.12em] text-black">
        {item.inventoryStatus === "mock" ? "Mock" : "POS"}
      </span>
    </div>
  );
}

export function ProductCard({ item }: { item: GreenwayMenuItem }) {
  const firstVariant = item.variants[0];
  const visibleVariants = item.variants.slice(0, 2);

  return (
    <Link href={`/menu/products/${item.id}`} className={`group block overflow-hidden rounded-[1.35rem] border-2 bg-[#111] shadow-xl shadow-black/25 transition duration-300 hover:-translate-y-1 hover:border-white ${strainStyles[item.strainType]}`}>
      <article className="flex h-full flex-col">
        <div className="p-2.5 pb-0">
          <ProductMockup item={item} />
        </div>

        <div className="flex flex-1 flex-col p-3.5 md:p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[0.68rem] font-black uppercase tracking-[0.16em] text-zinc-400">{item.brand}</p>
            <span className="rounded-full border border-current px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em]">{item.strainType}</span>
          </div>

          <h3 className="mt-2 line-clamp-2 min-h-[2.6rem] text-base font-black leading-tight text-white transition group-hover:text-[var(--gold)]">{item.name}</h3>

          <div className="mt-3 grid grid-cols-2 gap-1.5 text-[0.58rem] font-black uppercase tracking-[0.1em] text-zinc-200">
            <span className="rounded-full bg-white/8 px-2.5 py-1.5">THC {item.thc ?? "unknown"}</span>
            <span className="rounded-full bg-white/8 px-2.5 py-1.5">CBD {item.cbd ?? "unknown"}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Preview variant options">
            {visibleVariants.map((variant, index) => (
              <span key={variant.id} className={`rounded-full border px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] ${index === 0 ? "border-white bg-white text-black" : "border-white/15 bg-white/5 text-zinc-300"}`}>
                {variant.label}
              </span>
            ))}
            {item.variants.length > visibleVariants.length ? (
              <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] text-zinc-400">
                +{item.variants.length - visibleVariants.length}
              </span>
            ) : null}
          </div>

          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            <div>
              <p className="text-[0.58rem] font-black uppercase tracking-[0.14em] text-zinc-500">{firstVariant?.label ?? "variant"}</p>
              <p className="mt-1 text-lg font-black leading-none text-[var(--orange)]">{formatMinorCurrency(firstVariant?.priceMinorUnits ?? item.priceMinorUnits)}</p>
            </div>
            <span className="rounded-full bg-white px-3.5 py-2.5 text-[0.62rem] font-black uppercase tracking-[0.12em] text-black transition group-hover:bg-[var(--orange)]">
              Preview
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
