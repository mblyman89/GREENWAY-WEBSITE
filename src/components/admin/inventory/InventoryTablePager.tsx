import Link from "next/link";
import { showingLabel, type ListWindow } from "@/lib/admin/list-window-core";
import {
  pagerItems,
  pageNumberHref,
  tableHref,
  PAGE_SIZE_OPTIONS,
  PAGE_SIZE_PARAM,
  DEFAULT_TABLE_PAGE_SIZE,
  type PageSizeChoice,
} from "@/lib/inventory/inventory-table-core";
import type { RawParams } from "@/lib/inventory/inventory-url-core";
import { BackToTopLink } from "@/components/admin/inventory/BackToTopLink";

/**
 * R38 S3 — the inventory table's numbered pager.
 *
 * Owner: "an option that lets me pick something like 25, 50, 100, all … The
 * scroll pages feature should be at the bottom and top of the list, with a
 * return to the top of the list button at the bottom. By scroll pages, it's
 * the number bar that you click the number to go to that page, or use the
 * side carrots to move next or previous page."
 *
 * Rendered twice by the page (position="top" and "bottom"). Pure links, no
 * client state: every page and every page size is a real URL, so a view can
 * be bookmarked, shared, and the browser Back button works. The pager keeps
 * every filter, search, sort and column choice; changing the page size goes
 * back to page 1 (the old page number means different rows at a new size).
 *
 * ListPager (GW-033) is untouched — the other admin lists still use it.
 */
export function InventoryTablePager({
  window: win,
  total,
  raw,
  pageSize,
  position,
  topAnchorId,
}: {
  window: ListWindow;
  total: number;
  raw: RawParams;
  pageSize: PageSizeChoice;
  position: "top" | "bottom";
  topAnchorId: string;
}) {
  const label = showingLabel(win, total, "lot");
  const items = pagerItems(win.page, win.totalPages);
  const btn =
    "admin-focus inline-flex min-w-[2rem] items-center justify-center rounded border px-2 py-1 tabular-nums";
  const live = `${btn} border-[var(--admin-border-strong)] hover:bg-white/10`;
  const dead = `${btn} border-[var(--admin-border)] text-[var(--admin-text-faint)]`;
  const sizes: PageSizeChoice[] = [...PAGE_SIZE_OPTIONS, "all"];

  const nav = (page: number, text: string, aria: string, enabled: boolean, testid: string) =>
    enabled ? (
      <Link href={pageNumberHref(raw, page)} className={live} aria-label={aria} title={aria} data-testid={testid}>
        {text}
      </Link>
    ) : (
      <span className={dead} aria-disabled="true" data-testid={`${testid}-disabled`}>
        {text}
      </span>
    );

  return (
    <nav
      aria-label={position === "top" ? "Inventory pages (top)" : "Inventory pages (bottom)"}
      data-testid={`inventory-pager-${position}`}
      className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--admin-text-muted)]"
    >
      <span className="font-semibold text-[var(--admin-text)]" data-testid="inventory-pager-label">
        {label}
        {win.totalPages > 1 && (
          <span className="ml-2 font-normal text-[var(--admin-text-faint)]">
            · page {win.page} of {win.totalPages}
          </span>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-1">
        {win.totalPages > 1 && (
          <>
            {nav(1, "\u00ab", "First page", win.page > 1, "inventory-pager-first")}
            {nav(win.page - 1, "\u2039", "Previous page", win.page > 1, "inventory-pager-prev")}
            {items.map((it) =>
              it.kind === "gap" ? (
                <span key={it.key} className="px-1 text-[var(--admin-text-faint)]" aria-hidden="true">
                  {"\u2026"}
                </span>
              ) : it.current ? (
                <span
                  key={it.page}
                  aria-current="page"
                  className={`${btn} border-[var(--admin-accent)] bg-[var(--admin-accent)] font-semibold text-black`}
                  data-testid="inventory-pager-current"
                >
                  {it.page}
                </span>
              ) : (
                <Link key={it.page} href={pageNumberHref(raw, it.page)} className={live} aria-label={`Page ${it.page}`} data-testid="inventory-pager-number">
                  {it.page}
                </Link>
              ),
            )}
            {nav(win.page + 1, "\u203a", "Next page", win.page < win.totalPages, "inventory-pager-next")}
            {nav(win.totalPages, "\u00bb", "Last page", win.page < win.totalPages, "inventory-pager-last")}
          </>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-1" data-testid="inventory-page-size">
        <span className="mr-1 text-[var(--admin-text-faint)]">Rows per page</span>
        {sizes.map((s) => {
          const active = s === pageSize;
          const text = s === "all" ? "All" : String(s);
          const href = tableHref(raw, { [PAGE_SIZE_PARAM]: s === DEFAULT_TABLE_PAGE_SIZE ? null : String(s) });
          return active ? (
            <span key={text} aria-current="true" className={`${btn} border-[var(--admin-accent)] font-semibold text-[var(--admin-accent)]`}>
              {text}
            </span>
          ) : (
            <Link key={text} href={href} className={live} data-testid={`inventory-page-size-${text.toLowerCase()}`}>
              {text}
            </Link>
          );
        })}
        {position === "bottom" && <BackToTopLink targetId={topAnchorId} />}
      </span>
    </nav>
  );
}

export default InventoryTablePager;
