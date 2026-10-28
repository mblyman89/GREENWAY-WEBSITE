"use client";

/**
 * SopToc — the reader's sticky "On this page" outline: filter box, scroll-spy
 * highlight of the current section, and collapsible sub-sections.
 */
import { useEffect, useMemo, useState } from "react";

export type TocItem = { id: string; level: 2 | 3; text: string };

export function SopToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, [items]);

  // The H2 that contains the active section, so its children are expanded.
  const activeParent = useMemo(() => {
    let parent = "";
    for (const it of items) {
      if (it.level === 2) parent = it.id;
      if (it.id === active) return parent;
    }
    return "";
  }, [items, active]);

  const q = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return items;
    return items.filter((i) => i.text.toLowerCase().includes(q));
  }, [items, q]);

  let currentParent = "";
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--admin-text-faint)]">On this page</p>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Jump to a section…"
        aria-label="Filter sections"
        className="admin-focus mt-2 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-xs text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)]"
      />
      <ul className="mt-3 space-y-0.5">
        {shown.map((it) => {
          if (it.level === 2) currentParent = it.id;
          const hidden = !q && it.level === 3 && currentParent !== activeParent;
          if (hidden) return null;
          const on = it.id === active;
          return (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                aria-current={on ? "location" : undefined}
                className={`admin-focus block rounded-md border-l-2 py-1 pr-2 leading-snug transition ${
                  it.level === 3 ? "pl-5 text-[0.78rem]" : "pl-2.5 font-medium"
                } ${
                  on
                    ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                    : "border-transparent text-[var(--admin-text-muted)] hover:bg-white/[0.03] hover:text-[var(--admin-text)]"
                }`}
              >
                {it.text}
              </a>
            </li>
          );
        })}
        {shown.length === 0 ? <li className="px-2.5 py-1 text-xs text-[var(--admin-text-faint)]">No section matches.</li> : null}
      </ul>
    </nav>
  );
}
