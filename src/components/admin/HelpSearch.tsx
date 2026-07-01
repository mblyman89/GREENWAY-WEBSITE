"use client";

/**
 * HelpSearch — the searchable, all-inclusive FAQ UI for /admin/help.
 *
 * - Type to filter across every question, answer, section, and category.
 * - When not searching, browse everything grouped by CATEGORY (Website & online
 *   ordering, Point of sale, Compliance, …) with a jump-to table of contents so
 *   the full guide stays navigable even though it covers the whole system.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { flattenHelp, sectionsByCategory } from "@/lib/admin/help-content";

function slugCategory(name: string): string {
  return `cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function HelpSearch() {
  const [query, setQuery] = useState("");
  const flat = useMemo(() => flattenHelp(), []);
  const groups = useMemo(() => sectionsByCategory(), []);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    return flat.filter(
      (item) =>
        item.q.toLowerCase().includes(q) ||
        item.a.toLowerCase().includes(q) ||
        item.sectionTitle.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [flat, q]);

  return (
    <div>
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help… (e.g. “upload menu”, “drawer”, “excise”, “api key”)"
          className="w-full rounded-xl border border-white/15 bg-[#0d0d0d] px-4 py-3 pl-10 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#7ed957]/60"
        />
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
          🔍
        </span>
      </div>

      {/* Search results */}
      {results !== null ? (
        <div className="mt-6">
          {results.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/50">
              No matches for “{query}”. Try a simpler word, or clear the search to
              browse every topic.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs uppercase tracking-wide text-white/40">
                {results.length} result{results.length === 1 ? "" : "s"}
              </p>
              <ul className="space-y-3">
                {results.map((item, i) => (
                  <QA
                    key={`${item.sectionId}-${i}`}
                    q={item.q}
                    a={item.a}
                    href={item.href}
                    badge={`${item.sectionIcon} ${item.sectionTitle}`}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Table of contents — jump to any category */}
          <nav className="mt-6 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-white/40">
              Jump to a topic
            </p>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <a
                  key={g.category}
                  href={`#${slugCategory(g.category)}`}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:border-[#7ed957]/50 hover:text-white"
                >
                  {g.category}
                </a>
              ))}
            </div>
          </nav>

          {/* Full browse view, grouped by category then section */}
          <div className="mt-8 space-y-12">
            {groups.map((g) => (
              <div key={g.category} id={slugCategory(g.category)} className="scroll-mt-24">
                <div className="mb-1 border-b border-white/10 pb-2">
                  <h2 className="text-lg font-bold text-[#7ed957]">{g.category}</h2>
                  <p className="text-sm text-white/45">{g.blurb}</p>
                </div>
                <div className="mt-5 space-y-8">
                  {g.sections.map((section) => (
                    <section key={section.id} id={section.id}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-lg" aria-hidden>
                          {section.icon}
                        </span>
                        <h3 className="text-base font-semibold text-white">
                          {section.title}
                        </h3>
                      </div>
                      <p className="mb-3 text-sm text-white/50">{section.intro}</p>
                      <ul className="space-y-3">
                        {section.items.map((item, i) => (
                          <QA key={i} q={item.q} a={item.a} href={item.href} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function QA({
  q,
  a,
  href,
  badge,
}: {
  q: string;
  a: string;
  href?: string;
  badge?: string;
}) {
  return (
    <li className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
      {badge && (
        <span className="mb-1.5 inline-block rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
          {badge}
        </span>
      )}
      <p className="text-sm font-medium text-white">{q}</p>
      <p className="mt-1 text-sm leading-relaxed text-white/65">{a}</p>
      {href && (
        <Link
          href={href}
          className="mt-2 inline-block text-sm font-medium text-[#7ed957] hover:underline"
        >
          Go there →
        </Link>
      )}
    </li>
  );
}
