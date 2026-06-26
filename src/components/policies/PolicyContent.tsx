import Link from "next/link";
import type { PolicyPreviewRecord } from "@/components/policies/policy-preview-data";

type PolicyPreviewProps = {
  policy: PolicyPreviewRecord;
};

export function PolicyContent({ policy }: PolicyPreviewProps) {
  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(126,217,87,0.16),transparent_30rem),radial-gradient(circle_at_top_right,rgba(255,215,0,0.1),transparent_28rem),radial-gradient(circle_at_bottom_right,rgba(255,127,0,0.13),transparent_30rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.72fr] lg:items-end">
          <div>
            <p className="inline-flex rounded-full border border-[var(--greenway)]/40 bg-[var(--greenway-dark)] px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">
              {policy.eyebrow}
            </p>
            <h1 className="mt-5 max-w-4xl text-5xl font-black leading-[0.92] tracking-tight text-white md:text-7xl">
              {policy.title}
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-7 text-zinc-300 md:text-lg">{policy.description}</p>
          </div>

          <aside className="film-strip rounded-[2rem] border border-[var(--orange)]/30 bg-[var(--orange)]/10 p-6 shadow-2xl shadow-orange-950/20">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--orange)]">{policy.statusLabel}</p>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              This is not final legal advice or approved production policy text. It is a structured placeholder so Greenway can review the page, then replace it with verified content before launch.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link href="/faq" className="rounded-full bg-[var(--orange)] px-5 py-3 text-center text-xs font-black uppercase tracking-[0.16em] text-black transition hover:bg-white">
                Read FAQ guardrails
              </Link>
              <Link href="/about" className="rounded-full border border-white/15 px-5 py-3 text-center text-xs font-black uppercase tracking-[0.16em] text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]">
                About the build
              </Link>
            </div>
          </aside>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {policy.sections.map((section) => (
            <article key={section.title} className="rounded-[2rem] border border-white/10 bg-zinc-950/88 p-6 shadow-xl shadow-black/30 transition hover:-translate-y-1 hover:border-white/25">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--gold)]">Policy section</p>
              <h2 className="mt-3 text-2xl font-black leading-tight text-white">{section.title}</h2>
              <p className="mt-4 text-sm leading-6 text-zinc-400">{section.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-12 rounded-[2rem] border border-[var(--greenway)]/25 bg-[var(--greenway-dark)]/60 p-6 md:p-8">
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Replacement checklist</p>
              <h2 className="mt-3 text-3xl font-black leading-tight text-white md:text-5xl">What must be verified later.</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {policy.replacementNotes.map((note, index) => (
                <div key={note} className="rounded-2xl border border-white/10 bg-black/35 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--orange)]">Review {index + 1}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">{note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
