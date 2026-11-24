import Image from "next/image";
// USAGE-8b: fixed size + no `sizes` = a 1x/2x srcSet (this boundary rides in every page).
import { CHROME_IMAGE_PX } from "@/lib/site/chrome-image-core";
import Link from "@/components/site/IntentLink";
import { ComplianceWarningText } from "@/components/site/ComplianceWarningText";
import { greenwayBusiness } from "@/content/business";
import { NOT_FOUND_LINKS } from "@/lib/site/not-found-core";

// USAGE-7c: Next.js embeds this boundary in the RSC payload of EVERY page in
// (site), so it stays lean — no full Header/Footer (they cost ≈ 42 KB per
// page). See src/lib/site/not-found-core.ts.
export default function NotFound() {
  return (
    <main className="bg-black text-white">
      <div className="border-b border-white/10 px-4 py-4 md:px-8">
        <Link href="/" aria-label="Greenway Marijuana home" className="inline-flex transition duration-200 hover:opacity-85">
          <Image
            src={greenwayBusiness.assets.wordmark}
            alt="Greenway Marijuana"
            width={CHROME_IMAGE_PX.notFoundWordmark.width}
            height={CHROME_IMAGE_PX.notFoundWordmark.height}
            className="h-10 w-auto md:h-12"
          />
        </Link>
      </div>
      <section className="px-4 py-12 md:px-8 md:py-18">
        <div className="mx-auto flex min-h-[58vh] max-w-5xl items-center">
          <div className="relative w-full overflow-hidden rounded-[2rem] border border-white/10 bg-[var(--charcoal)] p-6 shadow-2xl shadow-black/40 md:p-10">
            <div className="relative grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-6 text-center">
                <p className="text-8xl font-black leading-none text-[var(--orange)] md:text-9xl">404</p>
                <p className="mt-3 text-xs font-black uppercase tracking-[0.24em] text-zinc-400">Page not found</p>
              </div>
              <div>
                <h1 className="text-4xl font-black uppercase leading-none tracking-tight text-white md:text-6xl">
                  We couldn&apos;t find that page.
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-300">
                  The link may be old or the product may have sold out. Try one of these instead.
                </p>
                <nav aria-label="Helpful links" className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  {NOT_FOUND_LINKS.map((l, i) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={
                        i === 0
                          ? "rounded-full bg-[var(--orange)] px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-[var(--gold)]"
                          : "rounded-full border border-white/15 px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]"
                      }
                    >
                      {l.label}
                    </Link>
                  ))}
                </nav>
              </div>
            </div>
          </div>
        </div>
      </section>
      <footer className="border-t border-white/10 px-4 py-6 md:px-8">
        <ComplianceWarningText className="mx-auto max-w-3xl text-center text-[0.72rem] font-semibold leading-5 text-zinc-400" />
      </footer>
    </main>
  );
}
