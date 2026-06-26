const priceMatchDetails = [
  "Must be a loyalty member. Ask your budtender for more info!",
  "Competitors' items must be regularly priced. Exclusions include happy hour sales, holiday sales, daily specials, and any other specials/promotions.",
  "We will match prices of other PORT ORCHARD, Washington state marijuana retailers, only.",
  "Item must be identical to the items being price matched (vendor/brand and size).",
  "Prices must include ALL TAXES (Washington state marijuana tax and local sales tax).",
  "Price must be available via competitor website, menu, or by calling the store.",
  "Price match items can not be discounted further.",
  "All sales must remain compliant.",
];

function PriceMatchArtwork() {
  return (
    <div className="relative mt-7 aspect-[0.92] overflow-hidden rounded-[1.4rem] bg-[#151515] md:mt-9 md:aspect-[1.58] md:rounded-[2rem]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,215,0,0.48),transparent_9rem),radial-gradient(circle_at_78%_22%,rgba(255,127,0,0.42),transparent_10rem),linear-gradient(145deg,rgba(126,217,87,0.28),rgba(0,0,0,0)_42%),linear-gradient(180deg,#242424_0%,#080808_100%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:repeating-linear-gradient(115deg,rgba(255,255,255,0.18)_0_1px,transparent_1px_18px)]" />
      <div className="absolute left-1/2 top-[13%] h-[44%] w-[38%] -translate-x-1/2 rounded-t-full border border-white/15 bg-black/58 shadow-2xl shadow-black/50 md:top-[10%] md:h-[58%] md:w-[24%]" />
      <div className="absolute left-1/2 top-[28%] h-[42%] w-[56%] -translate-x-1/2 rounded-[2rem] border border-white/10 bg-zinc-950/78 shadow-2xl shadow-black/60 md:top-[25%] md:h-[50%] md:w-[32%]">
        <div className="absolute inset-x-5 top-5 rounded-2xl bg-[var(--greenway)] px-4 py-3 text-center text-black shadow-lg shadow-black/35">
          <p className="text-[0.6rem] font-black uppercase tracking-[0.2em] md:text-xs">Greenway</p>
          <p className="mt-1 text-3xl font-black uppercase leading-none tracking-tight md:text-5xl">Price</p>
          <p className="text-3xl font-black uppercase leading-none tracking-tight text-[var(--orange)] md:text-5xl">Match</p>
        </div>
        <div className="absolute bottom-5 left-5 right-5 rounded-2xl border border-white/10 bg-black/68 p-4 text-center">
          <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-[var(--gold)] md:text-xs">Dummy image placeholder</p>
          <p className="mt-2 text-xs font-semibold leading-5 text-zinc-300 md:text-sm">Swap this panel for your final Greenway graphic.</p>
        </div>
      </div>
      <div className="absolute bottom-5 right-5 rounded-full bg-[var(--orange)] px-4 py-2 text-[0.62rem] font-black uppercase tracking-[0.16em] text-black md:text-xs">
        21+ only
      </div>
    </div>
  );
}

export function PriceMatchContent() {
  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(126,217,87,0.14),transparent_18rem),radial-gradient(circle_at_84%_16%,rgba(255,127,0,0.12),transparent_20rem),radial-gradient(circle_at_50%_74%,rgba(255,215,0,0.08),transparent_24rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-7xl px-4 py-7 md:px-8 md:py-14">
        <h1 className="text-center text-5xl font-black leading-none tracking-tight text-white md:text-7xl">Price Match</h1>

        <article className="mx-auto mt-5 rounded-[1.45rem] border border-white/10 bg-zinc-950/88 p-5 shadow-2xl shadow-black/40 md:mt-8 md:rounded-[2.2rem] md:p-9 lg:p-11">
          <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-[var(--gold)] md:text-xs">
            Guaranteed savings
          </p>
          <h2 className="mt-3 text-center text-3xl font-black uppercase leading-[0.95] tracking-tight text-[var(--orange)] md:text-6xl">
            Our Price Match Promise
          </h2>
          <p className="mt-5 text-sm font-semibold leading-7 text-zinc-200 md:max-w-5xl md:text-lg md:leading-8">
            Greenway Marijuana now offers a price match promise for our Loyalty members on all regularly priced products from our Port Orchard competitors! We strive to offer the lowest prices in town but now it&apos;s guaranteed. You can now get the lowest price at all Greenway locations.
          </p>

          <PriceMatchArtwork />

          <div className="mt-7 md:mt-9">
            <h3 className="text-xl font-black text-white md:text-2xl">Details:</h3>
            <div className="mt-4 space-y-4 md:grid md:grid-cols-2 md:gap-x-8 md:gap-y-4 md:space-y-0">
              {priceMatchDetails.map((detail) => (
                <p key={detail} className="text-sm leading-7 text-zinc-300 md:text-base md:leading-8">
                  <span className="mr-2 text-[var(--orange)]">–</span>
                  {detail}
                </p>
              ))}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
