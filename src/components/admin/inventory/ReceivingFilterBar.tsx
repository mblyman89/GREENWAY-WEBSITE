/**
 * ReceivingFilterBar  (R50 S10a, owner follow-up #5)
 *
 * One bar above the Receiving table:
 *   - three view links: Needs attention | All | Cultivera manifests;
 *   - filters: search, vendor, status, source (Cultivera view, R74 S11), date range;
 *   - sort.
 *
 * A plain GET form (server component, no client JS). Every choice lands in
 * the URL, so a filtered list can be bookmarked and Back works. All parsing
 * and validation lives in receiving-table-core (unit-tested); this only
 * renders.
 */
import Link from "next/link";
import {
  CULTIVERA_STATUS_FILTERS,
  NATIVE_STATUS_FILTERS,
  RECEIVING_PATH,
  hasActiveFilters,
  receivingHref,
  sortOptionsFor,
  type ReceivingFilters,
  type ReceivingView,
} from "@/lib/inventory/receiving-table-core";
import { SOURCE_FILTERS } from "@/lib/inventory/cultivera-vendor-core";

const FIELD =
  "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-xs text-[var(--admin-text)] focus:border-[var(--admin-accent)] focus:outline-none";
const LABEL = "flex flex-col gap-1 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]";

export function ReceivingFilterBar({
  filters,
  viewLinks,
  vendors,
  summary,
  capNote,
}: {
  filters: ReceivingFilters;
  viewLinks: { view: ReceivingView; href: string; label: string; active: boolean; title: string }[];
  vendors: readonly string[];
  summary: string | null;
  capNote: string | null;
}) {
  const isCv = filters.view === "cultivera";
  const statuses = isCv ? CULTIVERA_STATUS_FILTERS : NATIVE_STATUS_FILTERS;
  const dateWord = isCv ? "Received" : "Pulled in";
  const active = hasActiveFilters(filters);
  // The chosen vendor stays selectable even when it is not in this view's list.
  const vendorList = filters.vendor && !vendors.some((v) => v.toLowerCase() === filters.vendor.toLowerCase())
    ? [filters.vendor, ...vendors]
    : vendors;
  return (
    <section
      data-testid="receiving-filter-bar"
      data-view={filters.view}
      className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Which manifests to show"
          className="flex flex-wrap items-center gap-1 rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-0.5 text-xs"
        >
          {viewLinks.map((l) => (
            <Link
              key={l.view}
              href={l.href}
              data-testid={`receiving-view-${l.view}`}
              aria-current={l.active ? "page" : undefined}
              title={l.title}
              className={`rounded px-2.5 py-1 font-semibold transition ${
                l.active
                  ? "bg-[var(--admin-accent)] text-black"
                  : "text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        {summary ? (
          <p className="text-xs text-[var(--admin-text-muted)]" data-testid="receiving-filter-summary" aria-live="polite">
            {summary}
          </p>
        ) : null}
      </div>

      <form method="get" action={RECEIVING_PATH} className="flex flex-wrap items-end gap-3" data-testid="receiving-filter-form">
        {filters.view !== "action" ? <input type="hidden" name="view" value={filters.view} /> : null}
        {isCv && filters.group ? <input type="hidden" name="group" value={filters.group} /> : null}
        <label className={LABEL}>
          Search
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            maxLength={80}
            placeholder={isCv ? "Manifest # or vendor" : "Manifest #, invoice # or vendor"}
            className={`${FIELD} w-56`}
          />
        </label>
        <label className={LABEL}>
          Vendor
          <select name="vendor" defaultValue={filters.vendor} className={`${FIELD} max-w-[14rem]`}>
            <option value="">All vendors</option>
            {vendorList.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          {isCv ? "Onboarding" : "Status"}
          <select name="status" defaultValue={filters.status} className={FIELD}>
            <option value="">{isCv ? "Complete and not complete" : "Every status in this view"}</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {isCv ? (
          <label className={LABEL}>
            Source
            <select name="source" defaultValue={filters.source} className={FIELD} data-testid="receiving-filter-source">
              <option value="">Every source</option>
              {SOURCE_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={LABEL}>
          {dateWord} from
          <input type="date" name="from" defaultValue={filters.from} className={FIELD} />
        </label>
        <label className={LABEL}>
          {dateWord} to
          <input type="date" name="to" defaultValue={filters.to} className={FIELD} />
        </label>
        <label className={LABEL}>
          Sort
          <select name="sort" defaultValue={filters.sort} className={FIELD}>
            {sortOptionsFor(filters.view).map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === "default"
                  ? isCv
                    ? "Default (newest received first)"
                    : filters.view === "all"
                      ? "Default (open first, then newest)"
                      : "Default (newest first)"
                  : o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-bold text-black hover:brightness-105"
            data-testid="receiving-filter-apply"
          >
            Apply
          </button>
          {active || filters.sort !== "default" ? (
            <Link
              href={receivingHref(filters, { q: "", vendor: "", status: "", from: "", to: "", sort: "default", source: "" })}
              className="text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
              data-testid="receiving-filter-clear"
            >
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>
      {capNote ? (
        <p className="text-xs text-[var(--admin-gold)]" data-testid="receiving-filter-cap">
          {capNote}
        </p>
      ) : null}
    </section>
  );
}
