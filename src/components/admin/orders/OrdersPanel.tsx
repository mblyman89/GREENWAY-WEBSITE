/**
 * src/components/admin/orders/OrdersPanel.tsx
 *
 * SLICE L-40 — ONE PANEL, TWO SOURCES OF ORDERS.
 *
 * ===========================================================================
 * THE OWNER'S INSTRUCTION
 * ===========================================================================
 *   "I want the leafly section to look identical to our section above it. our
 *    orders section should be labeled greenway orders, and the leafly section
 *    remains labeled leafly orders. but the search bar and sort and filters
 *    should look and behave identically. the two sections should look
 *    identical, so if they need to be contained in their own panels, that is
 *    fine with me."
 *
 * The only way two panels stay identical for longer than one release is for
 * both to render through ONE component. This is that component. It owns the
 * whole frame — header, the four stat cards, the status tabs, the search /
 * date / total / sort form with Apply and Clear, the count line and pager at
 * the top and bottom, and the empty state — and each caller supplies only
 * its rows and any alarms that belong to its source. A styling change made
 * here lands on both panels; there is no second copy to drift.
 *
 * ===========================================================================
 * WHAT IT IS ALLOWED TO DECIDE: NOTHING
 * ===========================================================================
 * Which tab a status belongs to, what a URL means, how a link keeps the other
 * panel's view, what the counts are — all of it is in
 * `lib/orders/order-panels-core.ts` and executed in CI. This file draws.
 *
 * Plain links and a plain GET form, no client JavaScript: the view lives in
 * the URL, so it survives a refresh, a redirect after a button press on a
 * details page (via `back`), and can be bookmarked or sent to a colleague.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/admin/ui/Card";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/admin/ui/Button";
import { Input, Select } from "@/components/admin/ui/Field";
import { EmptyState } from "@/components/admin/ux/EmptyState";
import { ListPager } from "@/components/admin/ux/ListPager";
import { ORDER_SORTS } from "@/lib/admin/list-filter-core";
import type { ListWindow } from "@/lib/admin/list-window-core";
import {
  DEFAULT_PANEL_STATUS,
  ORDERS_PANEL_ANCHORS,
  ORDERS_PANEL_PARAMS,
  ORDERS_PANEL_TABS,
  PANEL_EMPTY_TITLE,
  activeTotal,
  panelFormAction,
  panelHasExtraFilters,
  panelHref,
  preservedFields,
  tabCount,
  type OrdersPanelKey,
  type OrdersPanelQuery,
  type SearchParamsLike,
  type StatusCounts,
} from "@/lib/orders/order-panels-core";

const LABEL =
  "mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]";

export function OrdersPanel({
  panel,
  title,
  subtitle,
  icon,
  counts,
  query,
  searchParams,
  window: win,
  total,
  notices,
  beforeList,
  summary,
  emptyDescription,
  children,
}: {
  panel: OrdersPanelKey;
  title: string;
  subtitle: ReactNode;
  icon: ReactNode;
  /** Per-status counts for this panel's source (drive the cards and tab counts). */
  counts: StatusCounts;
  /** This panel's validated view. */
  query: OrdersPanelQuery;
  /** The page's raw query, so links and the form keep the OTHER panel's view. */
  searchParams: SearchParamsLike | null | undefined;
  window: ListWindow;
  total: number;
  /** Alarms that belong to this source, shown under the header. */
  notices?: ReactNode;
  /** Lines about the current view, shown between the controls and the rows. */
  beforeList?: ReactNode;
  /** A one-line summary under the pager (e.g. the origin mix). */
  summary?: ReactNode;
  emptyDescription: string;
  /** The rows. Rendered only when `total > 0`. */
  children: ReactNode;
}) {
  const names = ORDERS_PANEL_PARAMS[panel];
  const anchor = ORDERS_PANEL_ANCHORS[panel];
  const headingId = `${anchor}-title`;
  const makePageHref = (p: number) => panelHref(searchParams, panel, { kind: "page", page: p });
  const keep = preservedFields(searchParams, panel);

  return (
    // `scroll-mt` so a link landing on #greenway-orders / #leafly-orders
    // stops with the header in view rather than tucked under the top bar.
    <section id={anchor} aria-labelledby={headingId} className="mt-6 scroll-mt-4">
      <Card padding="sm" accent="green" className="sm:p-5">
        <CardHeader title={<span id={headingId}>{title}</span>} subtitle={subtitle} icon={icon} />

        {notices}

        {/* The four cards, per panel, so "3 ready" is always about the
            orders directly beneath it. */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="New" value={counts.new} accent="orange" hint="Awaiting acknowledgement" icon="🔔" />
          <StatCard label="Preparing" value={counts.preparing} accent="green" icon="📦" />
          <StatCard label="Ready" value={counts.ready} accent="green" hint="Waiting for pickup" icon="✅" />
          <StatCard label="Active total" value={activeTotal(counts)} icon="🧾" />
        </div>

        {/* Filters + search: status, search, date range, total range, sort —
            URL-driven and combinable (SLICE 26), now for both panels. */}
        <form method="get" action={panelFormAction(panel)} className="mt-5 space-y-3">
          <nav className="flex flex-wrap gap-1.5" aria-label={`${title} status`}>
            {ORDERS_PANEL_TABS.map((t) => {
              const current = query.status === t.key;
              return (
                <Link
                  key={t.key}
                  href={panelHref(searchParams, panel, { kind: "status", status: t.key })}
                  aria-current={current ? "page" : undefined}
                  className={`admin-focus rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                    current
                      ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black"
                      : "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 tabular-nums ${current ? "opacity-70" : "opacity-60"}`}>
                    {tabCount(counts, t.key)}
                  </span>
                </Link>
              );
            })}
          </nav>
          <div className="flex flex-wrap items-end gap-3">
            {query.status !== DEFAULT_PANEL_STATUS ? (
              <input type="hidden" name={names.status} value={query.status} />
            ) : null}
            {/* The OTHER panel's view rides along, so Apply here leaves it
                exactly as it was. */}
            {keep.map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <div className="min-w-52 flex-1">
              <label className={LABEL} htmlFor={`${anchor}-q`}>
                Search
              </label>
              <Input id={`${anchor}-q`} name={names.q} defaultValue={query.search} placeholder="Name, phone, order #" />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${anchor}-from`}>
                Placed from
              </label>
              <Input id={`${anchor}-from`} type="date" name={names.from} defaultValue={query.placedFrom ?? ""} className="w-40" />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${anchor}-to`}>
                Placed to
              </label>
              <Input id={`${anchor}-to`} type="date" name={names.to} defaultValue={query.placedToDate ?? ""} className="w-40" />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${anchor}-min`}>
                Total min $
              </label>
              <Input
                id={`${anchor}-min`}
                name={names.min}
                defaultValue={query.minRaw}
                placeholder="0.00"
                inputMode="decimal"
                className="w-24"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${anchor}-max`}>
                Total max $
              </label>
              <Input
                id={`${anchor}-max`}
                name={names.max}
                defaultValue={query.maxRaw}
                placeholder="0.00"
                inputMode="decimal"
                className="w-24"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${anchor}-sort`}>
                Sort by
              </label>
              <Select id={`${anchor}-sort`} name={names.sort} defaultValue={query.sortKey} aria-label={`Sort ${title}`}>
                {ORDER_SORTS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="neutral">
              Apply
            </Button>
            {panelHasExtraFilters(query) ? (
              <Link
                href={panelHref(searchParams, panel, { kind: "clear" })}
                className="pb-2 text-xs text-[var(--admin-text-faint)] underline-offset-2 hover:text-[var(--admin-text)] hover:underline"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        {/* GW-033: exact count + pager — a clipped list is never silent. */}
        <div className="mt-4">
          <ListPager window={win} total={total} noun="order" makeHref={makePageHref} />
        </div>

        {summary}
        {beforeList}

        {total === 0 ? (
          <div className="mt-6">
            <EmptyState icon={icon} title={PANEL_EMPTY_TITLE} description={emptyDescription} />
          </div>
        ) : (
          <div className="mt-5 grid gap-3">{children}</div>
        )}

        {/* Bottom pager (long lists — save the scroll back up). */}
        {win.totalPages > 1 ? (
          <div className="mt-5">
            <ListPager window={win} total={total} noun="order" makeHref={makePageHref} />
          </div>
        ) : null}
      </Card>
    </section>
  );
}
