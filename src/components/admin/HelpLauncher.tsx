"use client";

/**
 * HelpLauncher — a floating "?" button pinned bottom-left of every admin page.
 * Opens a slide-over with a quick search across the FAQ plus a link to the full
 * Help page. Always reachable so a confused employee is never stuck.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { flattenHelp } from "@/lib/admin/help-content";

export function HelpLauncher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const flat = useMemo(() => flattenHelp(), []);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return flat.slice(0, 6);
    return flat
      .filter(
        (item) =>
          item.q.toLowerCase().includes(q) ||
          item.a.toLowerCase().includes(q) ||
          item.sectionTitle.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [flat, q]);

  return (
    <>
      {/* Floating trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open help"
        className="fixed bottom-4 left-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-[#7ed957]/40 bg-[#0a0a0a] text-lg font-bold text-[#7ed957] shadow-lg shadow-black/50 transition hover:bg-[#7ed957]/10"
      >
        ?
      </button>

      {open && (
        <div className="fixed inset-0 z-[90]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          {/* Slide-over */}
          <div className="absolute bottom-0 left-0 top-0 flex w-full max-w-sm flex-col border-r border-white/10 bg-[#0a0a0a] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <h2 className="text-sm font-semibold text-white">Need a hand?</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/70 hover:bg-white/5"
              >
                Close ✕
              </button>
            </div>

            <div className="border-b border-white/10 p-4">
              <div className="relative">
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search help…"
                  className="w-full rounded-lg border border-white/15 bg-[#0d0d0d] px-3 py-2 pl-9 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#7ed957]/60"
                />
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40">
                  🔍
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {results.length === 0 ? (
                <p className="text-sm text-white/50">
                  No quick answers for “{query}”.
                </p>
              ) : (
                <ul className="space-y-3">
                  {results.map((item, i) => (
                    <li
                      key={`${item.sectionId}-${i}`}
                      className="rounded-lg border border-white/10 bg-[#0d0d0d] p-3"
                    >
                      <p className="text-sm font-medium text-white">{item.q}</p>
                      <p className="mt-1 text-xs leading-relaxed text-white/60">
                        {item.a}
                      </p>
                      {item.href && (
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="mt-1.5 inline-block text-xs font-medium text-[#7ed957] hover:underline"
                        >
                          Go there →
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-white/10 p-4">
              <Link
                href="/admin/help"
                onClick={() => setOpen(false)}
                className="block rounded-lg bg-[#7ed957] px-4 py-2 text-center text-sm font-semibold text-black transition hover:bg-[#94e570]"
              >
                Open full Help & FAQ
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
