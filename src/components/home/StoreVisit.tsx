const visitCards = [
  {
    eyebrow: "Store area",
    title: "Port Orchard, WA",
    body: "Greenway’s public site experience is being built around a single-store Port Orchard visit flow before adding any advanced ordering behavior.",
    accent: "text-[var(--greenway)]",
  },
  {
    eyebrow: "Hours",
    title: "Confirm before visiting",
    body: "Final business hours should be verified against Greenway’s official store records before this section is treated as production content.",
    accent: "text-[var(--gold)]",
  },
  {
    eyebrow: "Pickup status",
    title: "Preview only",
    body: "Mock carts, checkout, and confirmation pages do not reserve inventory, create orders, or notify staff.",
    accent: "text-[var(--orange)]",
  },
];

const readinessSteps = [
  "Bring a valid government-issued photo ID showing you are 21 or older.",
  "Review final pricing, taxes, discounts, and purchase limits with store staff.",
  "Treat website inventory as informational until certified Leafly/POS workflows are approved.",
  "Do not visit for a web order until a future live flow explicitly confirms it is ready.",
];

export function StoreVisit() {
  return (
    <section id="location" className="relative overflow-hidden border-y border-white/10 bg-[#050805]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(126,217,87,0.18),transparent_28rem),radial-gradient(circle_at_bottom_right,rgba(255,127,0,0.12),transparent_26rem)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-16 md:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
          <div className="rounded-[2rem] border border-[var(--greenway)]/25 bg-black/60 p-6 shadow-2xl shadow-green-950/20 backdrop-blur md:p-8">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Visit Greenway</p>
            <h2 className="mt-3 text-4xl font-black tracking-tight text-white md:text-5xl">Plan the store visit before the order flow.</h2>
            <p className="mt-5 text-base leading-7 text-zinc-300">
              The next layer of the Greenway website should make store context obvious: where the shopper is browsing for, what they need at pickup, and what is still pending before live Leafly ordering can be enabled.
            </p>
            <div className="mt-7 rounded-3xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-white">Leafly readiness guardrail</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Menu API certification, partner/POS coordination, and verified customer/order handling must come before any production checkout, reservation, or staff notification behavior.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href="/menu" className="rounded-full bg-[var(--orange)] px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-white">
                Browse preview menu
              </a>
              <a href="#faq" className="rounded-full border border-white/15 px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]">
                Read compliance notes
              </a>
            </div>
          </div>

          <div className="grid gap-5">
            <div className="grid gap-5 md:grid-cols-3">
              {visitCards.map((card) => (
                <article key={card.eyebrow} className="rounded-3xl border border-white/10 bg-zinc-950/85 p-5 transition hover:-translate-y-1 hover:border-white/25">
                  <p className={`text-xs font-black uppercase tracking-[0.18em] ${card.accent}`}>{card.eyebrow}</p>
                  <h3 className="mt-3 text-2xl font-black leading-tight text-white">{card.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-zinc-400">{card.body}</p>
                </article>
              ))}
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-black/55 p-6 backdrop-blur">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">Pickup readiness</p>
                  <h3 className="mt-2 text-3xl font-black text-white">What customers should know.</h3>
                </div>
                <span className="rounded-full border border-[var(--greenway)]/35 bg-[var(--greenway-dark)] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">
                  21+ only
                </span>
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {readinessSteps.map((step, index) => (
                  <div key={step} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">Step {index + 1}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
