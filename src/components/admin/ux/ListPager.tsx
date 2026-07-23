import Link from "next/link";
import { showingLabel, type ListWindow } from "@/lib/admin/list-window-core";

/**
 * ListPager (GW-033) — the count line + pager every admin list page shows so
 * a clipped list is never silent: "Showing 101–200 of 431 orders · ← Prev /
 * Page 2 of 5 / Next →". Server-component friendly (pure links, no hooks).
 *
 * `makeHref(page)` builds the target URL preserving the page's other
 * filters/search params (each page owns its own URL grammar).
 */
export function ListPager({
  window: win,
  total,
  noun,
  makeHref,
}: {
  window: ListWindow;
  total: number;
  noun: string;
  makeHref: (page: number) => string;
}) {
  const label = showingLabel(win, total, noun);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--admin-text-muted)]">
      <span>
        {total > 0 ? (
          <>
            <span className="font-semibold text-[var(--admin-text)]">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
      {win.totalPages > 1 && (
        <span className="flex items-center gap-2">
          {win.page > 1 ? (
            <Link
              href={makeHref(win.page - 1)}
              className="admin-focus rounded border border-[var(--admin-border-strong)] px-2 py-1 hover:bg-white/10"
            >
              ← Prev
            </Link>
          ) : (
            <span className="rounded border border-[var(--admin-border)] px-2 py-1 text-[var(--admin-text-faint)]">
              ← Prev
            </span>
          )}
          <span>
            Page {win.page} / {win.totalPages}
          </span>
          {win.page < win.totalPages ? (
            <Link
              href={makeHref(win.page + 1)}
              className="admin-focus rounded border border-[var(--admin-border-strong)] px-2 py-1 hover:bg-white/10"
            >
              Next →
            </Link>
          ) : (
            <span className="rounded border border-[var(--admin-border)] px-2 py-1 text-[var(--admin-text-faint)]">
              Next →
            </span>
          )}
        </span>
      )}
    </div>
  );
}
