"use client";

/**
 * SopLibraryBrowser — the library index: one search box that filters the
 * shelves instantly (titles, summaries, audiences, keywords and every section
 * heading), audience filter chips, and Enter for full-text search across the
 * SOP bodies (server-side, ?q=).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useRef, useState, useEffect } from "react";

export type LibraryCard = {
  slug: string;
  code: string;
  shortTitle: string;
  title: string;
  category: string;
  summary: string;
  audience: string[];
  keywords: string[];
  version: string;
  draft: boolean;
  readMinutes: number;
  sectionCount: number;
  sections: { id: string; text: string }[];
};

export type LibraryShelf = { id: string; label: string; description: string; icon: string };

const AUDIENCE_FILTERS: { id: string; label: string; match: RegExp }[] = [
  { id: "all", label: "All SOPs", match: /.*/ },
  { id: "floor", label: "Budtenders & floor", match: /budtender|everyone|opener|closer|night|morning|receiving helper/i },
  { id: "managers", label: "Managers", match: /manager|lead/i },
  { id: "admin", label: "Owner & admin", match: /owner|admin/i },
];

function norm(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function SopLibraryBrowser({
  shelves,
  cards,
  initialQuery,
}: {
  shelves: LibraryShelf[];
  cards: LibraryCard[];
  initialQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [audience, setAudience] = useState("all");
  const deferred = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search box (common enterprise shortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && el && !/input|textarea|select/i.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const terms = useMemo(() => norm(deferred).split(/\s+/).filter(Boolean), [deferred]);
  const audienceRe = AUDIENCE_FILTERS.find((a) => a.id === audience)?.match ?? /.*/;

  const filtered = useMemo(() => {
    return cards
      .filter((c) => audience === "all" || c.audience.some((a) => audienceRe.test(a)))
      .map((c) => {
        if (!terms.length) return { card: c, sections: [] as LibraryCard["sections"], score: 1 };
        const hay = norm([c.code, c.shortTitle, c.title, c.summary, c.audience.join(" "), c.keywords.join(" ")].join(" "));
        const metaHit = terms.every((t) => hay.includes(t));
        const sections = c.sections.filter((s) => terms.every((t) => norm(s.text).includes(t)));
        const score = (metaHit ? 10 : 0) + sections.length;
        return { card: c, sections: sections.slice(0, 4), score };
      })
      .filter((r) => r.score > 0);
  }, [cards, terms, audience, audienceRe]);

  const byShelf = shelves
    .map((s) => ({ shelf: s, items: filtered.filter((r) => r.card.category === s.id) }))
    .filter((g) => g.items.length);

  const submitFullText = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    router.push(q.length >= 2 ? `?q=${encodeURIComponent(q)}#results` : "?");
  };

  return (
    <div>
      {/* Search + filters */}
      <form onSubmit={submitFullText} role="search" className="relative">
        <label htmlFor="sop-search" className="sr-only">
          Search the SOP library
        </label>
        <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--admin-text-faint)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>
        <input
          ref={inputRef}
          id="sop-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search SOPs — try “deposit bag”, “recall”, “new hire”, “PIN”…"
          autoComplete="off"
          className="admin-focus w-full rounded-[var(--admin-radius-lg)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface)] py-3.5 pl-12 pr-36 text-[0.95rem] text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] shadow-[var(--admin-shadow-sm)]"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
          <kbd className="hidden rounded border border-[var(--admin-border-strong)] px-1.5 py-0.5 text-[0.65rem] text-[var(--admin-text-faint)] sm:inline">/</kbd>
          <button
            type="submit"
            className="admin-focus rounded-full bg-[var(--admin-accent-soft)] px-3 py-1.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40 transition hover:bg-[var(--admin-accent)] hover:text-black"
          >
            Full text
          </button>
        </div>
      </form>
      <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
        Typing filters titles and section headings instantly. Press <span className="font-semibold">Enter</span> to search every word inside every SOP.
      </p>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by who it is for">
        {AUDIENCE_FILTERS.map((a) => {
          const on = audience === a.id;
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={on}
              onClick={() => setAudience(a.id)}
              className={`admin-focus rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                on
                  ? "bg-[var(--admin-accent)] text-black"
                  : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] ring-1 ring-[var(--admin-border)] hover:text-[var(--admin-text)]"
              }`}
            >
              {a.label}
            </button>
          );
        })}
      </div>

      {/* Shelves */}
      {byShelf.length === 0 ? (
        <div className="mt-10 rounded-[var(--admin-radius-lg)] border border-dashed border-[var(--admin-border-strong)] p-10 text-center">
          <p className="text-base font-semibold text-[var(--admin-text)]">No SOP titles or headings match “{deferred}”.</p>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">Press Enter to search the full text of every SOP, or clear the filters.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setAudience("all");
            }}
            className="admin-focus mt-4 rounded-full bg-[var(--admin-orange-soft)] px-4 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-[var(--admin-orange)] ring-1 ring-[var(--admin-orange)]/40 hover:bg-[var(--admin-orange)] hover:text-black"
          >
            Clear filters
          </button>
        </div>
      ) : (
        byShelf.map(({ shelf, items }) => (
          <section key={shelf.id} aria-labelledby={`shelf-${shelf.id}`} className="mt-10">
            <div className="flex items-end justify-between gap-4 border-b border-[var(--admin-border)] pb-3">
              <div>
                <h2 id={`shelf-${shelf.id}`} className="flex items-center gap-2 text-lg font-bold text-[var(--admin-text)]">
                  <span aria-hidden="true">{shelf.icon}</span>
                  {shelf.label}
                </h2>
                <p className="mt-0.5 text-sm text-[var(--admin-text-muted)]">{shelf.description}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-[var(--admin-text-faint)]">
                {items.length} {items.length === 1 ? "SOP" : "SOPs"}
              </span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {items.map(({ card, sections }) => (
                <article
                  key={card.slug}
                  className="group relative flex flex-col rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-[var(--admin-shadow-sm)] transition hover:border-[var(--admin-accent)]/40 hover:bg-[var(--admin-surface-hover)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold tracking-wide text-[var(--admin-accent)]">{card.code}</span>
                    <span
                      className={`rounded-[var(--admin-radius-sm)] px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide ${
                        card.draft ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]" : "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                      }`}
                    >
                      v{card.version} · {card.draft ? "Draft" : "Approved"}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-bold leading-snug text-[var(--admin-text)]">
                    <Link href={`/admin/staffing/sop-library/${card.slug}`} className="admin-focus rounded after:absolute after:inset-0 after:content-['']">
                      {card.shortTitle}
                    </Link>
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--admin-text-muted)]">{card.summary}</p>
                  {sections.length ? (
                    <ul className="relative z-10 mt-3 space-y-1 border-l-2 border-[var(--admin-accent)]/40 pl-3">
                      {sections.map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`/admin/staffing/sop-library/${card.slug}#${s.id}`}
                            className="admin-focus text-xs text-[var(--admin-accent)] hover:underline"
                          >
                            {s.text}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
                    {card.audience.slice(0, 4).map((a) => (
                      <span key={a} className="rounded-full bg-[var(--admin-surface-2)] px-2 py-0.5 text-[0.68rem] text-[var(--admin-text-muted)]">
                        {a}
                      </span>
                    ))}
                    <span className="ml-auto text-[0.7rem] text-[var(--admin-text-faint)]">
                      {card.sectionCount} sections · ~{card.readMinutes} min
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
