import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { Breadcrumbs } from "@/components/admin/ux";
import { SOP_CATEGORIES } from "@/lib/sop-library/catalog-core";
import { getSop, listSops } from "@/lib/sop-library/load.server";
import { SopMarkdown } from "@/components/admin/sop-library/SopMarkdown";
import { SopToc } from "@/components/admin/sop-library/SopToc";
import { BackToTop, PrintSopButton } from "@/components/admin/sop-library/SopReaderActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await getSop(slug);
  return { title: doc ? `${doc.code} ${doc.shortTitle} · SOP Library` : "SOP Library" };
}

/** SOP reader: title card, sticky outline, the full SOP, previous / next. */
export default async function SopReaderPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePermission("timeclock.use");
  const { slug } = await params;
  const all = await listSops();
  const idx = all.findIndex((d) => d.slug === slug.toLowerCase());
  if (idx === -1) notFound();
  const doc = all[idx];
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx < all.length - 1 ? all[idx + 1] : null;
  const shelf = SOP_CATEGORIES.find((c) => c.id === doc.category);
  const draft = doc.status.startsWith("Draft");
  const toc = doc.sections.filter((s) => s.level === 2 || s.level === 3);

  const facts: { k: string; v: string }[] = [
    { k: "Version", v: doc.version ? `v${doc.version}` : "—" },
    { k: "Status", v: draft ? "Draft · pending owner approval" : "Approved" },
    { k: "Reading time", v: `~${doc.readMinutes} min · ${doc.sections.filter((s) => s.level === 2).length} sections` },
    { k: "Verified against code", v: doc.verifiedAt ? doc.verifiedAt.slice(0, 8) : "—" },
  ];

  return (
    <div>
      {/* Title card */}
      <header className="border-b border-[var(--admin-border)] px-5 pb-6 pt-5 sm:px-8 print:border-black/30 print:px-0">
        <div className="print:hidden">
          <Breadcrumbs
            items={[
              { label: "Employee" },
              { label: "SOP Library", href: "/admin/staffing/sop-library" },
              { label: doc.code },
            ]}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold tracking-wide text-[var(--admin-accent)] print:text-black">{doc.code}</span>
              {shelf ? (
                <span className="rounded-full bg-[var(--admin-surface-2)] px-2.5 py-0.5 text-[0.68rem] font-semibold text-[var(--admin-text-muted)] print:hidden">
                  {shelf.icon} {shelf.label}
                </span>
              ) : null}
              <span
                className={`rounded-[var(--admin-radius-sm)] px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide ${
                  draft ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]" : "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                } print:bg-transparent print:text-black`}
              >
                v{doc.version} · {draft ? "Draft" : "Approved"}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold leading-tight text-[var(--admin-text)] sm:text-3xl print:text-black">{doc.title}</h1>
            {doc.summary ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--admin-text-muted)] print:text-black/70">{doc.summary}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2 print:hidden">
            <PrintSopButton />
            <Link
              href="/admin/staffing/sop-library"
              className="admin-focus inline-flex items-center whitespace-nowrap rounded-full bg-[var(--admin-surface-2)] px-3.5 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] text-[var(--admin-text-muted)] ring-1 ring-[var(--admin-border-strong)] transition hover:text-[var(--admin-text)]"
            >
              ← Library
            </Link>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
          {facts.map((f) => (
            <div key={f.k} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3.5 py-2.5 print:border-black/20 print:bg-transparent">
              <dt className="text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[var(--admin-text-faint)] print:text-black/60">{f.k}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-[var(--admin-text)] print:text-black">{f.v}</dd>
            </div>
          ))}
        </dl>
        {doc.appliesTo ? (
          <p className="mt-3 max-w-5xl text-xs leading-relaxed text-[var(--admin-text-faint)] print:text-black/70">
            <span className="font-bold uppercase tracking-[0.1em]">Applies to: </span>
            {doc.appliesTo}
          </p>
        ) : null}
      </header>

      {/* Body: outline + document */}
      <div className="px-5 py-8 sm:px-8 print:px-0 print:py-4">
        <div className="mx-auto grid max-w-[88rem] gap-10 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="hidden lg:block print:hidden">
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
              <SopToc items={toc} />
            </div>
          </aside>

          <div className="min-w-0">
            {/* Mobile outline */}
            <details className="mb-6 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 lg:hidden print:hidden">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--admin-text)]">On this page ({toc.filter((t) => t.level === 2).length} sections)</summary>
              <ul className="mt-3 space-y-1">
                {toc
                  .filter((t) => t.level === 2)
                  .map((t) => (
                    <li key={t.id}>
                      <a href={`#${t.id}`} className="text-sm text-[var(--admin-accent)] hover:underline">
                        {t.text}
                      </a>
                    </li>
                  ))}
              </ul>
            </details>

            <article className="max-w-4xl print:max-w-none">
              <SopMarkdown blocks={doc.blocks} />
            </article>

            {/* Previous / next */}
            <nav aria-label="More SOPs" className="mt-16 grid max-w-4xl gap-3 border-t border-[var(--admin-border)] pt-6 sm:grid-cols-2 print:hidden">
              {prev ? (
                <Link
                  href={`/admin/staffing/sop-library/${prev.slug}`}
                  className="admin-focus rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 transition hover:border-[var(--admin-accent)]/40"
                >
                  <span className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--admin-text-faint)]">← Previous</span>
                  <span className="mt-1 block text-sm font-semibold text-[var(--admin-text)]">
                    {prev.code} · {prev.shortTitle}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={`/admin/staffing/sop-library/${next.slug}`}
                  className="admin-focus rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 text-right transition hover:border-[var(--admin-accent)]/40"
                >
                  <span className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--admin-text-faint)]">Next →</span>
                  <span className="mt-1 block text-sm font-semibold text-[var(--admin-text)]">
                    {next.code} · {next.shortTitle}
                  </span>
                </Link>
              ) : null}
            </nav>
          </div>
        </div>
      </div>
      <BackToTop />
    </div>
  );
}
