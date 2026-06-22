import Link from "next/link";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";

export default function NotFound() {
  return (
    <main className="bg-black text-white">
      <Header />
      <section className="px-4 py-12 md:px-8 md:py-18">
        <div className="mx-auto flex min-h-[58vh] max-w-5xl items-center">
          <div className="film-strip relative overflow-hidden rounded-[2rem] border border-white/10 bg-[var(--charcoal)] p-6 shadow-2xl shadow-black/40 md:p-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_24%,rgba(255,127,0,0.24),transparent_18rem),radial-gradient(circle_at_10%_86%,rgba(126,217,87,0.18),transparent_20rem)]" aria-hidden="true" />
            <div className="relative grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-6 text-center">
                <p className="text-8xl font-black leading-none text-[var(--orange)] md:text-9xl">404</p>
                <p className="mt-3 text-xs font-black uppercase tracking-[0.24em] text-zinc-400">Page not found</p>
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-[var(--greenway)]">Greenway preview route</p>
                <h1 className="mt-4 text-4xl font-black uppercase leading-none tracking-tight text-white md:text-6xl">
                  This page is not in the preview menu yet.
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-300">
                  The Greenway build is being assembled one reliable slice at a time. Use the current preview routes below while future category, product, and content pages are filled in.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link href="/menu" className="rounded-full bg-[var(--orange)] px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-[var(--gold)]">
                    Browse menu
                  </Link>
                  <Link href="/specials" className="rounded-full border border-white/15 bg-white/8 px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-white/15">
                    View specials
                  </Link>
                  <Link href="/" className="rounded-full border border-white/15 px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]">
                    Home
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
