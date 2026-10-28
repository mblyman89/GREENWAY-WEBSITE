import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { SOP_CATEGORIES } from "@/lib/sop-library/catalog-core";
import { listSops, searchSops } from "@/lib/sop-library/load.server";
import { SopLibraryBrowser, type LibraryCard } from "@/components/admin/sop-library/SopLibraryBrowser";

export const dynamic = "force-dynamic";
export const metadata = { title: "SOP Library" };

/**
 * SOP Library — every Standard Operating Procedure in one place, organized by
 * shelf, searchable. Readable by every employee with a back-office sign-in
 * (owner decision Q-08-4: everyone gets back-office access).
 */
export default async function SopLibraryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("timeclock.use");
  const { q = "" } = await searchParams;
  const docs = await listSops();
  const query = q.trim().slice(0, 120);
  const results = query.length >= 2 ? await searchSops(query) : null;

  const cards: LibraryCard[] = docs.map((d) => ({
    slug: d.slug,
    code: d.code,
    shortTitle: d.shortTitle,
    title: d.title,
    category: d.category,
    summary: d.summary || d.title,
    audience: d.audience,
    keywords: d.keywords,
    version: d.version,
    draft: d.status.startsWith("Draft"),
    readMinutes: d.readMinutes,
    sectionCount: d.sections.filter((s) => s.level === 2).length,
    sections: d.sections.map((s) => ({ id: s.id, text: s.text })),
  }));

  const usedShelves = SOP_CATEGORIES.filter((c) => docs.some((d) => d.category === c.id)).map((c) => ({ ...c }));
  const totalMinutes = docs.reduce((n, d) => n + d.readMinutes, 0);
  const drafts = docs.filter((d) => d.status.startsWith("Draft")).length;

  return (
    <div>
      <AdminPageHeader
        title="SOP Library"
        subtitle="Every Standard Operating Procedure for the store, in one place. Find the one you need, read it on screen, or print it."
        breadcrumbs={<Breadcrumbs items={[{ label: "Employee" }, { label: "SOP Library" }]} />}
        help={
          <HelpPanel
            id="sop-library"
            title="How to use the SOP Library"
            steps={[
              "Pick a shelf (Register & Cash, Receiving & Inventory, Returns & Compliance, People & Access) or type in the search box.",
              "Typing filters SOP titles and section headings instantly. Press Enter to search every word inside every SOP.",
              "Open an SOP. The outline on the left jumps to any section; the # beside a heading copies a direct link to it.",
              "Section 4 of every SOP is the step-by-step manual; Section 5 explains every on-screen message; Section 9 holds the quick-reference cards.",
              "Press Print for a clean black-on-white copy (forms and cards print well on their own pages).",
            ]}
          >
            <p>
              SOPs marked <strong>Draft</strong> are waiting for the owner&apos;s approval; follow them as written until a new
              version replaces them. Each SOP is a living document: when a feature it describes changes, the SOP is updated in
              the same piece of work, and this library shows the new version automatically.
            </p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {/* Summary strip */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { k: "SOPs", v: String(docs.length) },
            { k: "Shelves", v: String(usedShelves.length) },
            { k: "Awaiting approval", v: String(drafts) },
            { k: "Total reading", v: `~${Math.round(totalMinutes / 60)} h` },
          ].map((s) => (
            <div key={s.k} className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3">
              <dt className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--admin-text-faint)]">{s.k}</dt>
              <dd className="mt-1 text-2xl font-bold text-[var(--admin-text)]">{s.v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6">
          <SopLibraryBrowser shelves={usedShelves} cards={cards} initialQuery={query} />
        </div>

        {results ? (
          <section id="results" aria-labelledby="results-h" className="mt-12 scroll-mt-24">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--admin-border)] pb-3">
              <h2 id="results-h" className="text-lg font-bold text-[var(--admin-text)]">
                Full-text results for “{query}”
              </h2>
              <span className="text-xs text-[var(--admin-text-faint)]">
                {results.total} {results.total === 1 ? "match" : "matches"}
                {results.total > results.hits.length ? ` · showing the first ${results.hits.length}` : ""}
                {" · "}
                <Link href="/admin/staffing/sop-library" className="text-[var(--admin-accent)] hover:underline">
                  Clear
                </Link>
              </span>
            </div>
            {results.hits.length === 0 ? (
              <p className="mt-6 text-sm text-[var(--admin-text-muted)]">
                No SOP contains “{query}”. Try a shorter word, or a word you would see on the screen.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {results.hits.map((h, i) => (
                  <li key={i}>
                    <Link
                      href={`/admin/staffing/sop-library/${h.slug}${h.sectionId ? `#${h.sectionId}` : ""}`}
                      className="admin-focus block rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 transition hover:border-[var(--admin-accent)]/40 hover:bg-[var(--admin-surface-hover)]"
                    >
                      <p className="text-xs">
                        <span className="font-mono font-bold text-[var(--admin-accent)]">{h.code}</span>
                        <span className="text-[var(--admin-text-faint)]"> · {h.shortTitle} › </span>
                        <span className="font-semibold text-[var(--admin-text)]">{h.sectionText}</span>
                      </p>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--admin-text-muted)]">
                        <Highlight text={h.snippet} term={query} />
                      </p>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-[var(--admin-gold-soft)] px-0.5 text-[var(--admin-gold)]">{text.slice(at, at + term.length)}</mark>
      {text.slice(at + term.length)}
    </>
  );
}
