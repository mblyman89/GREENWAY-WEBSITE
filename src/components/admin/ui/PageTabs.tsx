/**
 * src/components/admin/ui/PageTabs.tsx  (S27)
 *
 * THE query-param tab strip for single-route admin pages. Zero JS: a server
 * component that renders plain links; the ACTIVE tab is decided on the server
 * (resolveTab in @/lib/admin/page-tabs-core) and passed in, so an error
 * redirect can auto-open the tab that owns the failing form.
 *
 * Markup and classes are lifted verbatim from the H15d ReceivingTabs strip
 * (now a thin wrapper over this), so the Receiving page renders byte-identical
 * HTML — tests/compliance/page-tabs.test.tsx pins that.
 *
 * The one addition is an optional count pill per tab (S28's Issues count).
 * With no count, nothing extra is rendered — not even an aria-label.
 *
 * NOT for route-per-tab navigation: ReportTabs (client, usePathname) is the
 * other documented primitive (F-108/F-122). Two primitives, never a third.
 */

import Link from "next/link";
import {
  DEFAULT_KEEP_PARAMS,
  tabAriaLabel,
  tabCountLabel,
  tabHref,
  tabHrefCarry,
  type TabSpec,
} from "@/lib/admin/page-tabs-core";

export type PageTabsProps<K extends string> = {
  /** Route the tabs live on, e.g. "/admin/inventory/intake". */
  base: string;
  tabs: readonly TabSpec<K>[];
  active: K;
  /** Current search params; the `allow`-listed ones survive a tab switch. */
  keep?: Readonly<Record<string, string | undefined>>;
  /** Which params to keep (default q, status, back). */
  allow?: readonly string[];
  /** Accessible name for the nav landmark, e.g. "Receiving views". */
  ariaLabel: string;
  /**
   * S28: carry the page's WHOLE serialized query instead of an allow-list
   * (Inventory's facet filters). When set, `keep`/`allow` are ignored.
   */
  carry?: string;
  /** S28: param names `carry` must not keep (result banners, paging). */
  carryDrop?: readonly string[];
};

export function PageTabs<K extends string>({
  base,
  tabs,
  active,
  keep = {},
  allow = DEFAULT_KEEP_PARAMS,
  ariaLabel,
  carry,
  carryDrop,
}: PageTabsProps<K>) {
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap gap-1.5 border-b border-[var(--admin-border)] pb-3">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const pill = tabCountLabel(tab.count);
        return (
          <Link
            key={tab.key}
            href={carry !== undefined ? tabHrefCarry(base, tab.key, carry, carryDrop) : tabHref(base, tab.key, keep, allow)}
            aria-current={isActive ? "page" : undefined}
            aria-label={pill ? tabAriaLabel(tab.label, tab.count) : undefined}
            title={tab.blurb}
            className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              isActive
                ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
            }`}
          >
            {tab.icon ? <span className="mr-1.5">{tab.icon}</span> : null}
            {tab.label}
            {pill ? (
              <span
                data-testid="page-tab-count"
                data-tone={tab.countTone === "danger" ? "danger" : undefined}
                className={`ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                  tab.countTone === "danger"
                    ? "bg-[var(--admin-danger)]/20 text-[var(--admin-danger)]"
                    : "bg-[var(--admin-surface-hover)]"
                }`}
              >
                {pill}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
