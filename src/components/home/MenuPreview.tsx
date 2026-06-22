import { describeLeaflyRuntime, getGreenwayMenuPreview } from "@/lib/leafly/client";

const strainStyles = {
  indica: "border-blue-400 text-blue-200",
  sativa: "border-green-400 text-green-200",
  hybrid: "border-orange-400 text-orange-200",
  cbd: "border-purple-300 text-purple-100",
  unknown: "border-zinc-400 text-zinc-200",
};

export async function MenuPreview() {
  const items = await getGreenwayMenuPreview();
  const runtime = describeLeaflyRuntime();

  return (
    <section id="shop" className="border-y border-white/10 bg-black/50">
      <div className="mx-auto max-w-7xl px-4 py-16 md:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Menu foundation</p>
            <h2 className="mt-2 text-3xl font-black text-white md:text-5xl">Leafly comes first.</h2>
            <p className="mt-5 text-base leading-7 text-zinc-300">
              These cards are mock data only. They let us design and test the menu presentation before connecting real Leafly sandbox credentials and live inventory behavior.
            </p>
            <div id="leafly" className="mt-6 rounded-3xl border border-white/10 bg-zinc-950 p-5 text-sm text-zinc-300">
              <p className="font-black uppercase tracking-[0.16em] text-white">Leafly scaffold status</p>
              <dl className="mt-4 grid gap-3">
                <div className="flex justify-between gap-4"><dt>Environment</dt><dd className="text-[var(--greenway)]">{runtime.environment}</dd></div>
                <div className="flex justify-between gap-4"><dt>Menu key configured</dt><dd>{runtime.hasMenuIntegrationKey ? "Yes" : "No"}</dd></div>
                <div className="flex justify-between gap-4"><dt>OAuth configured</dt><dd>{runtime.hasOAuthCredentials ? "Yes" : "No"}</dd></div>
              </dl>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className={`rounded-3xl border-2 bg-[var(--charcoal)] p-5 shadow-xl transition hover:-translate-y-1 ${strainStyles[item.strainType]}`}>
                <div className="mb-5 flex aspect-square items-center justify-center rounded-2xl bg-gradient-to-br from-white/12 to-black text-center">
                  <span className="px-4 text-sm font-black uppercase tracking-[0.18em] text-white">{item.category}</span>
                </div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">{item.brand}</p>
                <h3 className="mt-2 min-h-14 text-lg font-black leading-tight text-white">{item.name}</h3>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold uppercase">
                  <span className="rounded-full bg-white/10 px-3 py-1">THC {item.thc ?? "unknown"}</span>
                  <span className="rounded-full bg-white/10 px-3 py-1">CBD {item.cbd ?? "unknown"}</span>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <span className="text-lg font-black text-[var(--orange)]">{item.priceLabel}</span>
                  <button className="rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-black">Mock</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
