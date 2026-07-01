"use client";

/**
 * CommandPalette — a ⌘K / Ctrl+K quick-launcher for the back office (PR E).
 * Press ⌘K (or Ctrl+K) anywhere in the admin to fuzzy-search every page you
 * have access to and jump there with the keyboard. Also reachable via the
 * floating "⌘K" hint button.
 *
 * Navigation targets are passed in already filtered by the user's role
 * (server-side), so the palette never exposes a page the user can't open.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type PaletteItem = {
  label: string;
  href: string;
  icon: string;
  group: string;
};

type Props = { items: PaletteItem[] };

/** Lightweight subsequence fuzzy match + score (lower = better). */
function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return t.indexOf(q); // direct substring wins
  let qi = 0;
  let score = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += lastIdx === -1 ? ti : ti - lastIdx; // reward closeness
      lastIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? 1000 + score : null;
}

export function CommandPalette({ items }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const scored = items
      .map((it) => ({ it, score: fuzzyScore(query, `${it.label} ${it.group}`) }))
      .filter((r): r is { it: PaletteItem; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score);
    return scored.map((r) => r.it);
  }, [items, query]);

  // Global keyboard shortcut to open + Escape to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus + reset when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after paint
      const id = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  // Keep the active index in range as results change.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(results.length - 1, 0)));
  }, [results.length]);

  function go(item: PaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  }

  return (
    <>
      {/* Floating trigger — circle only (no text label) so it doesn't cover
          page content. Sits just above the bottom-left Help "?" button.
          Accessible name kept via aria-label + title; ⌘K still works. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open quick search (Cmd/Ctrl + K)"
        title="Quick search (⌘K)"
        className="admin-chrome fixed bottom-[4.25rem] left-4 z-30 hidden h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#0a0a0a]/90 text-white/60 shadow-lg shadow-black/50 backdrop-blur transition hover:text-white lg:flex"
      >
        <span className="text-lg leading-none" aria-hidden="true">
          🔍
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[15vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-[#0a0a0a] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <span className="text-white/40">🔍</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Jump to a page… (try 'orders', 'seo', 'promo')"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
              />
              <span className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[0.6rem] text-white/40">
                Esc
              </span>
            </div>

            <ul className="max-h-80 overflow-y-auto py-2">
              {results.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-white/40">No matches.</li>
              ) : (
                results.map((item, i) => (
                  <li key={item.href}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(item)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                        i === active ? "bg-[#7ed957]/10" : "hover:bg-white/5"
                      }`}
                    >
                      <span className="text-base">{item.icon}</span>
                      <span className="flex-1 text-sm text-white">{item.label}</span>
                      <span className="text-[0.65rem] uppercase tracking-wide text-white/35">
                        {item.group}
                      </span>
                      {i === active && (
                        <span className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[0.6rem] text-white/40">
                          ↵
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
