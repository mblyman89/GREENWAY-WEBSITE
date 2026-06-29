import Image from "next/image";
import { SiteText } from "@/components/site/SiteText";

const values = [
  {
    number: "01",
    title: "Customer Commitment",
    summary: "Exceptional Customer Service",
  },
  {
    number: "02",
    title: "Employee Development",
    summary: "Positive Employee Environment",
  },
  {
    number: "03",
    title: "Community",
    summary: "Giving Back to Communities",
  },
  {
    number: "04",
    title: "Trust",
    summary: "Operating with Honesty and Integrity",
  },
];

export function AboutContent() {
  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(255,127,0,0.13),transparent_18rem),radial-gradient(circle_at_88%_18%,rgba(255,215,0,0.11),transparent_22rem),radial-gradient(circle_at_52%_88%,rgba(126,217,87,0.08),transparent_24rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-7xl px-4 py-9 md:px-8 md:py-16 lg:py-20">
        <div className="mx-auto max-w-5xl text-center">
          {/* Editable from Admin → Site Content (about.hero.*). Keeps the
              distinct large display styling; falls back to the original copy so
              there's no visible change until staff edit + publish. */}
          <SiteText
            blockKey="about.hero.title"
            as="h1"
            className="text-5xl font-black uppercase leading-[0.9] tracking-tight text-white md:text-7xl lg:text-8xl"
          />
          <SiteText
            blockKey="about.hero.subtitle"
            as="p"
            className="mx-auto mt-5 max-w-3xl text-center text-[0.78rem] font-semibold leading-6 text-zinc-300 sm:text-sm md:mt-7 md:text-xl md:leading-9 lg:text-2xl"
          />
        </div>

        <div className="mt-10 grid gap-5 lg:mt-16 lg:grid-cols-2 lg:items-stretch lg:gap-7">
          <article className="rounded-[1.35rem] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/35 md:rounded-[2rem] md:p-8 lg:p-10">
            <h2 className="text-center text-[1.55rem] font-black uppercase leading-tight tracking-tight text-[var(--orange)] sm:text-3xl md:text-[1.72rem] lg:text-[1.72rem] xl:text-[1.9rem]">
              <span className="md:hidden">
                <span className="block whitespace-nowrap">Your Most Trusted</span>
                <span className="block whitespace-nowrap">Cannabis Dispensary</span>
              </span>
              <span className="hidden md:block">
                <span className="block whitespace-nowrap">Your Most Trusted Cannabis</span>
                <span className="block whitespace-nowrap">Dispensary</span>
              </span>
            </h2>
            <div className="mt-5 space-y-5 text-sm font-medium leading-7 text-zinc-300 md:mt-7 md:text-base md:leading-8">
              <p>
                Visit Greenway Marijuana, the top Port Orchard dispensary, offering a wide range of high-quality cannabis for recreational and medicinal use. Our knowledgeable Budtenders are eager to help answer your questions and guide you toward the ideal strains, edibles, concentrates, and accessories that suit your specific needs and preferences. With a large selection that includes top-shelf flower, budget options, and everything in between, we serve all budgets at our friendly Port Orchard location.
              </p>
              <p>
                Enjoy a modern, welcoming environment at Greenway Marijuana, Port Orchard&apos;s preferred recreational marijuana store, perfect for comfortable browsing and expert advice. Benefit from our daily deals, flash sales, and special discounts on premium cannabis products. Visit us today and make Greenway Marijuana your trusted destination for all your cannabis and wellness needs.
              </p>
            </div>
          </article>

          <div className="flex min-h-[22rem] items-center justify-center rounded-[1.35rem] border border-[var(--gold)]/25 bg-black p-5 shadow-2xl shadow-black/35 md:min-h-[34rem] md:rounded-[2rem] md:p-8">
            <Image
              src="/brand/greenway-black-gold-logo.png"
              alt="Greenway Marijuana black and gold logo"
              width={900}
              height={900}
              priority
              className="h-full max-h-[30rem] w-full object-contain md:max-h-[42rem]"
            />
          </div>
        </div>

        <section aria-labelledby="about-values-title" className="mt-12 border-t border-white/10 pt-10 md:mt-18 md:pt-14 lg:mt-20">
          <h2 id="about-values-title" className="text-center text-5xl font-black uppercase leading-[0.9] tracking-tight text-white md:text-7xl lg:text-8xl">
            Our Values
          </h2>

          <div className="mt-8 grid gap-8 md:mt-12 md:grid-cols-2 md:gap-x-8 md:gap-y-10 lg:grid-cols-4 lg:gap-8">
            {values.map((item) => (
              <article key={item.number} className="text-center">
                <p className="text-5xl font-black leading-none text-[var(--orange)] md:text-6xl">
                  {item.number}
                </p>
                <h3 className="mt-5 text-2xl font-black leading-tight text-white md:text-3xl">
                  {item.title}
                </h3>
                <p className="mx-auto mt-3 max-w-[14rem] text-base font-semibold leading-7 text-zinc-200 md:text-lg">
                  {item.summary}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
