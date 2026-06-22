import Link from "next/link";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

const strainAccent: Record<GreenwayMenuItem["strainType"], string> = {
  indica: "border-blue-400/80 bg-blue-400/15 text-blue-100",
  sativa: "border-emerald-300/80 bg-emerald-300/15 text-emerald-100",
  hybrid: "border-orange-300/80 bg-orange-300/15 text-orange-100",
  cbd: "border-purple-300/80 bg-purple-300/15 text-purple-100",
  unknown: "border-white/35 bg-white/10 text-white",
};

const packageAccent: Record<GreenwayMenuItem["strainType"], string> = {
  indica: "from-blue-500 via-blue-300 to-white",
  sativa: "from-emerald-500 via-lime-300 to-white",
  hybrid: "from-[var(--orange)] via-[var(--gold)] to-white",
  cbd: "from-purple-500 via-fuchsia-300 to-white",
  unknown: "from-zinc-500 via-zinc-200 to-white",
};

function salePrice(item: GreenwayMenuItem, discount: number) {
  return Math.round(item.priceMinorUnits * (1 - discount / 100));
}

function ProductMockup({ item }: { item: GreenwayMenuItem }) {
  const initials = item.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-white p-3 shadow-inner shadow-black/10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(126,217,87,0.26),transparent_32%),radial-gradient(circle_at_72%_82%,rgba(255,127,0,0.18),transparent_34%)]" aria-hidden="true" />
      <div className="relative h-[78%] w-[64%] rounded-[1.15rem] border border-black/10 bg-zinc-950 p-2 shadow-2xl shadow-black/25">
        <div className={`h-full rounded-[0.9rem] bg-gradient-to-br ${packageAccent[item.strainType]} p-2 text-black`}>
          <div className="flex h-full flex-col justify-between rounded-[0.7rem] border border-black/10 bg-white/75 p-2 text-center backdrop-blur-sm">
            <p className="text-[0.48rem] font-black uppercase tracking-[0.18em] text-black/55">Greenway</p>
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-black text-sm font-black text-white shadow-lg shadow-black/25 md:h-12 md:w-12 md:text-base">
              {initials || "G"}
            </div>
            <p className="line-clamp-2 text-[0.52rem] font-black uppercase leading-tight text-black">{item.category}</p>
          </div>
        </div>
      </div>
      <span className="absolute left-2 top-2 rounded-full bg-black px-2 py-1 text-[0.55rem] font-black uppercase tracking-[0.12em] text-white md:left-3 md:top-3">
        {item.category}
      </span>
      <span className="absolute right-2 top-2 rounded-full bg-[var(--gold)] px-2 py-1 text-[0.55rem] font-black uppercase tracking-[0.12em] text-black md:right-3 md:top-3">
        Mock
      </span>
    </div>
  );
}

export function HomeProductCard({ item, discount }: { item: GreenwayMenuItem; discount: number }) {
  const firstVariant = item.variants[0];
  const visibleVariants = item.variants.slice(0, 2);

  return (
    <article className="group flex min-h-full flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#111] shadow-xl shadow-black/30 transition hover:-translate-y-1 hover:border-[var(--gold)]/70 hover:shadow-[0_18px_45px_rgba(0,0,0,0.45)]">
      <Link href={`/menu/products/${item.id}`} className="block p-2.5 pb-0" aria-label={`View ${item.name}`}>
        <ProductMockup item={item} />
      </Link>

      <div className="flex flex-1 flex-col p-3.5 pt-3 md:p-4 md:pt-3">
        <p className="line-clamp-1 text-[0.62rem] font-black uppercase tracking-[0.16em] text-zinc-400">{item.brand}</p>
        <Link href={`/menu/products/${item.id}`} className="mt-1 line-clamp-2 min-h-[2.55rem] text-sm font-black leading-5 text-white transition hover:text-[var(--gold)] md:text-base md:leading-5">
          {item.name}
        </Link>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className={`rounded-full border px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] ${strainAccent[item.strainType]}`}>
            {item.strainType}
          </span>
          {item.thc ? <span className="rounded-full border border-white/10 bg-white/8 px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] text-white">THC {item.thc}</span> : null}
          {item.cbd ? <span className="rounded-full border border-white/10 bg-white/8 px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] text-white">CBD {item.cbd}</span> : null}
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

        <div className="mt-auto pt-4">
          <p className="text-[0.6rem] font-black uppercase tracking-[0.14em] text-zinc-500">{firstVariant?.label ?? "variant"}</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[0.7rem] font-bold text-zinc-500 line-through">{formatMinorCurrency(item.priceMinorUnits)}</p>
              <p className="text-lg font-black leading-none text-[var(--orange)] md:text-xl">{formatMinorCurrency(salePrice(item, discount))}</p>
            </div>
            <Link
              href={`/menu/products/${item.id}`}
              className="shrink-0 rounded-full bg-white px-3.5 py-2.5 text-[0.62rem] font-black uppercase tracking-[0.13em] text-black transition hover:bg-[var(--gold)] md:px-4"
              aria-label={`Preview add details for ${item.name}`}
            >
              Add
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
