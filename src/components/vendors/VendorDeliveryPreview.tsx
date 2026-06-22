import { greenwayBusiness } from "@/content/business";

const vendorSteps = [
  {
    title: "Send product details",
    body: "Share placeholder brand, product category, Washington compliance status, wholesale availability, and preferred contact information for Greenway staff review.",
  },
  {
    title: "Coordinate staff review",
    body: "Greenway can use this page as a future checklist for samples, education materials, delivery timing, and internal buying follow-up once the real workflow is approved.",
  },
  {
    title: "Keep POS entry manual",
    body: "This preview does not create vendor accounts, schedule appointments, submit inventory, or connect to Greenway’s POS. Staff would still verify every detail manually.",
  },
];

const infoCards = [
  {
    eyebrow: "What to prepare",
    title: "Vendor packet basics",
    items: ["Brand overview and primary contact", "Product categories and current availability", "Compliance documentation placeholders", "Wholesale pricing or sample-policy notes"],
  },
  {
    eyebrow: "Review focus",
    title: "Greenway fit check",
    items: ["Washington market readiness", "Packaging and labeling readiness", "Customer education materials", "Operational delivery expectations"],
  },
];

export function VendorDeliveryPreview() {
  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_8%,rgba(126,217,87,0.16),transparent_22rem),radial-gradient(circle_at_84%_12%,rgba(255,127,0,0.14),transparent_24rem),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_34rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-6 md:px-8 md:pb-24 md:pt-10">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/45 md:rounded-[2.6rem]">
          <div className="relative min-h-[25rem] overflow-hidden bg-[#14120f] md:min-h-[34rem]">
            <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(0,0,0,0.92)_0%,rgba(0,0,0,0.58)_42%,rgba(0,0,0,0.08)_100%)]" />
            <div className="relative mx-5 mt-5 h-48 overflow-hidden rounded-[1.6rem] border border-white/10 bg-[radial-gradient(circle_at_50%_24%,rgba(255,215,0,0.25),transparent_9rem),linear-gradient(135deg,rgba(126,217,87,0.16),rgba(255,127,0,0.2))] shadow-2xl shadow-black/40 md:hidden">
              <div className="absolute inset-0 opacity-80">
                <div className="absolute right-4 top-4 grid w-36 grid-cols-3 gap-2">
                  {Array.from({ length: 9 }).map((_, index) => (
                    <span key={index} className="h-8 rounded-lg border border-white/12 bg-white/10" />
                  ))}
                </div>
                <div className="absolute bottom-5 right-5 h-20 w-44 rounded-2xl border border-black/20 bg-[#d95b26]" />
                <div className="absolute bottom-10 right-9 h-14 w-28 rounded-t-[2rem] border border-black/15 bg-[#f2c05d]" />
                <div className="absolute bottom-8 left-8 h-28 w-14 rounded-t-full bg-[#245b3a] shadow-xl" />
                <div className="absolute bottom-[8.25rem] left-9 h-10 w-10 rounded-full bg-[#f7d6a8]" />
                <div className="absolute bottom-5 right-10 h-12 w-12 rounded-full border-[8px] border-[#161616] bg-[#f7f1de]" />
                <div className="absolute bottom-5 right-36 h-12 w-12 rounded-full border-[8px] border-[#161616] bg-[#f7f1de]" />
              </div>
              <p className="absolute left-4 top-4 max-w-[9rem] text-3xl font-black uppercase leading-none tracking-tight text-white drop-shadow-lg">Vendor Delivery</p>
            </div>
            <div className="absolute inset-y-0 right-0 hidden w-[62%] md:block">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_58%_42%,rgba(255,215,0,0.28),transparent_18rem),linear-gradient(135deg,rgba(126,217,87,0.14),rgba(255,127,0,0.18))]" />
              <div className="absolute bottom-10 right-12 h-48 w-[30rem] rounded-[2rem] border border-black/20 bg-[#d95b26] shadow-2xl shadow-black/50" />
              <div className="absolute bottom-20 right-20 h-28 w-[19rem] rounded-t-[3rem] border border-black/15 bg-[#f2c05d] shadow-xl" />
              <div className="absolute bottom-28 right-64 h-40 w-20 rounded-t-full bg-[#245b3a] shadow-xl" />
              <div className="absolute bottom-58 right-[17.4rem] h-14 w-14 rounded-full bg-[#f7d6a8]" />
              <div className="absolute bottom-10 right-24 h-20 w-20 rounded-full border-[14px] border-[#161616] bg-[#f7f1de]" />
              <div className="absolute bottom-10 right-[25rem] h-20 w-20 rounded-full border-[14px] border-[#161616] bg-[#f7f1de]" />
              <div className="absolute right-10 top-10 grid w-80 grid-cols-3 gap-3 opacity-80">
                {Array.from({ length: 12 }).map((_, index) => (
                  <span key={index} className="h-12 rounded-xl border border-white/12 bg-white/8" />
                ))}
              </div>
            </div>

            <div className="relative flex min-h-[25rem] flex-col justify-end px-5 py-8 md:min-h-[34rem] md:max-w-3xl md:px-10 md:py-12">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.28em] text-[var(--greenway)] md:text-xs">Vendor delivery</p>
              <h1 className="mt-4 text-5xl font-black uppercase leading-[0.9] tracking-tight md:text-8xl">
                Work with Greenway
              </h1>
              <p className="mt-5 max-w-2xl text-sm font-semibold leading-7 text-zinc-200 md:text-lg md:leading-8">
                A placeholder information hub for licensed cannabis vendors who want to prepare materials for future Greenway review. Built with the same bold, mobile-first visual language as the Ike’s-inspired reference, but without a vendor login or scheduling portal.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <a
                  href={`${greenwayBusiness.emailHref}?subject=Greenway%20Vendor%20Inquiry`}
                  className="rounded-full bg-[var(--orange)] px-6 py-3 text-center text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-[var(--gold)]"
                >
                  Email Greenway
                </a>
                <a
                  href="#vendor-packet"
                  className="rounded-full border border-white/20 bg-white/8 px-6 py-3 text-center text-sm font-black uppercase tracking-[0.16em] text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]"
                >
                  View checklist
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 py-6 md:grid-cols-3 md:gap-5 md:py-8">
          {vendorSteps.map((step, index) => (
            <article key={step.title} className="rounded-[1.35rem] border border-white/10 bg-zinc-950/86 p-5 shadow-xl shadow-black/25 md:p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--gold)] text-sm font-black text-black">{index + 1}</span>
              <h2 className="mt-5 text-2xl font-black tracking-tight text-white">{step.title}</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-zinc-400">{step.body}</p>
            </article>
          ))}
        </div>

        <div id="vendor-packet" className="grid gap-5 md:grid-cols-[1.05fr_0.95fr] md:items-start">
          <section className="rounded-[1.6rem] border border-[#e9dfc2]/20 bg-[#f2ead5] p-5 text-black shadow-2xl shadow-black/30 md:p-8">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#805017]">Vendor information</p>
            <h2 className="mt-3 text-4xl font-black uppercase leading-none tracking-tight md:text-6xl">Before you reach out</h2>
            <p className="mt-5 text-sm font-bold leading-7 text-zinc-800 md:text-base md:leading-8">
              This placeholder page is meant to guide future vendor conversations, not collect sensitive documents online. Replace this copy with Greenway-approved intake instructions, verified contact details, and any required Washington cannabis compliance language before launch.
            </p>
            <div className="mt-7 grid gap-4 md:grid-cols-2">
              {infoCards.map((card) => (
                <article key={card.title} className="rounded-[1.2rem] border border-black/10 bg-white/55 p-5">
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-[#9a5d13]">{card.eyebrow}</p>
                  <h3 className="mt-2 text-xl font-black text-black">{card.title}</h3>
                  <ul className="mt-4 grid gap-2 text-sm font-bold leading-5 text-zinc-800">
                    {card.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--orange)]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <aside className="rounded-[1.6rem] border border-[var(--greenway)]/22 bg-[var(--greenway-dark)]/45 p-5 md:p-7">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--greenway)]">Preview-safe notice</p>
            <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white md:text-4xl">Informational only — no portal is active.</h2>
            <p className="mt-4 text-sm font-semibold leading-7 text-zinc-300">
              Greenway’s preview vendor page does not register vendors, book delivery appointments, accept product submissions, store license documents, sync inventory, or create POS records. Any real vendor workflow should be handled through approved staff channels with authentication and compliance review.
            </p>
            <div className="mt-6 rounded-[1.1rem] border border-white/10 bg-black/32 p-4 text-sm leading-6 text-zinc-300">
              <p className="font-black text-white">Greenway contact path</p>
              <p className="mt-2">Vendor inquiries can start through <a href={greenwayBusiness.emailHref} className="font-bold text-[var(--greenway)] transition hover:text-white">{greenwayBusiness.email}</a> or by calling <a href={`tel:${greenwayBusiness.phone.tel}`} className="font-bold text-[var(--greenway)] transition hover:text-white">{greenwayBusiness.phone.formatted}</a>. Final vendor intake procedures still need staff approval before launch.</p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
