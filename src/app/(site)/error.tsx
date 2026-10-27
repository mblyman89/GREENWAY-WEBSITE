"use client";

import Link from "next/link";
import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("Greenway preview route error", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-black px-4 py-10 text-white md:px-8">
      <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center">
        <section className="film-strip relative overflow-hidden rounded-[2rem] border border-red-400/25 bg-[var(--charcoal)] p-6 shadow-2xl shadow-black/40 md:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(248,113,113,0.20),transparent_18rem),radial-gradient(circle_at_15%_85%,rgba(126,217,87,0.16),transparent_18rem)]" aria-hidden="true" />
          <div className="relative">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-red-300">Greenway preview error</p>
            <h1 className="mt-4 text-4xl font-black uppercase leading-none tracking-tight text-white md:text-6xl">
              Something did not load correctly.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-300">
              This preview route hit a recoverable application error. Try reloading the page, or return to the safe browsing paths while the build is still in development.
            </p>
            {error.digest ? <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Error digest: {error.digest}</p> : null}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={reset} className="rounded-full bg-[var(--orange)] px-6 py-4 text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-[var(--gold)]">
                Try again
              </button>
              <Link href="/menu" className="rounded-full border border-white/15 bg-white/8 px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-white/15">
                Browse menu preview
              </Link>
              <Link href="/" className="rounded-full border border-white/15 px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-zinc-200 transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]">
                Home
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
