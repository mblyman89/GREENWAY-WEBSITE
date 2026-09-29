/**
 * src/lib/admin/page-tab-sets.ts  (S27)
 *
 * PURE. The tab lists for the single-route admin pages that used to hand-roll
 * their own `?tab=` strips (bible S27.1: settings/types and products/masters).
 * Receiving keeps its own RECEIVING_TABS (receiving-tabs-core, unchanged).
 *
 * Each list preserves the page's existing resolution exactly:
 *   - Types:   `tab === "inventory" ? "inventory" : "website"` — plus `?type=`
 *              (the S26 "Map …" deep link) now also opens Inventory Types, so
 *              a hand-shared `?type=` link can never land on the wrong tab.
 *   - Masters: `tab === "suggestions" ? "suggestions" : "masters"`. Every
 *              suggestion action already redirects with `tab=suggestions`
 *              (products/masters/actions.ts), so no auto-open is needed.
 */

import type { TabSpec } from "@/lib/admin/page-tabs-core";

export type TypesPageTab = "website" | "inventory";

export const TYPES_PAGE_BASE = "/admin/settings/types";

export const TYPES_PAGE_TABS: readonly TabSpec<TypesPageTab>[] = [
  { key: "website", label: "Website Categories", blurb: "The categories shoppers browse on the website menu." },
  {
    key: "inventory",
    label: "Inventory Types",
    blurb: "Each LCB/inventory type and the website category it files under.",
    autoOpenParams: ["type"],
  },
];

export type MastersPageTab = "masters" | "suggestions";

export const MASTERS_PAGE_BASE = "/admin/products/masters";

export const MASTERS_PAGE_TABS: readonly TabSpec<MastersPageTab>[] = [
  { key: "masters", label: "Product Masters", blurb: "Every product master you have created or accepted." },
  { key: "suggestions", label: "Suggestions", blurb: "Groupings the system proposes — accept or reject each one." },
];

// ---------------------------------------------------------------------------
// S28 — Issues tabs (bible S28.2). Each page's DEFAULT tab is the working
// surface; "Issues" holds every attention row (issues-core).
// ---------------------------------------------------------------------------

export type PublishPageTab = "overview" | "issues" | "history";

export const PUBLISH_PAGE_BASE = "/admin/publish";

/**
 * The Publish page's `?error=` is a refusal of the Publish button itself
 * (publishVersionAction), which lives on Overview, so no error auto-opens
 * Issues here — the banner stays next to the button that produced it.
 */
export const PUBLISH_PAGE_TABS: readonly TabSpec<PublishPageTab>[] = [
  { key: "overview", label: "Overview", blurb: "What is waiting to publish, and the one button that publishes it." },
  { key: "issues", label: "Issues", blurb: "Every warning on a waiting update, each with the page that fixes it." },
  { key: "history", label: "History", blurb: "The last updates that went live by themselves after an approval." },
];

export type InventoryPageTab = "lots" | "issues" | "insights";

export const INVENTORY_PAGE_BASE = "/admin/inventory";

/**
 * `restoreError` is set by the Restore-to-sale form, which now lives on the
 * Issues tab (RestoreToSalePanel), so a refusal lands the owner back beside
 * the form that produced it (the ReceivingTabs precedent, F-107).
 */
export const INVENTORY_PAGE_TABS: readonly TabSpec<InventoryPageTab>[] = [
  { key: "lots", label: "Lots", blurb: "Every lot, with filters, sorting and bulk edits." },
  {
    key: "issues",
    label: "Issues",
    blurb: "Stock the register cannot sell, missing data and crossed compliance limits — each with its fix.",
    autoOpenParams: ["restoreError", "restored"],
  },
  { key: "insights", label: "Insights", blurb: "Months of supply, shrink, ABC and aging (WAC 314-55-079(10))." },
];

export type ManifestPageTab = "delivery" | "issues" | "accounting";

/** The manifest page's route for one manifest. */
export function manifestPageBase(manifestId: string): string {
  return `/admin/inventory/intake/${encodeURIComponent(manifestId)}`;
}

/**
 * `held` is set by finalize when lots were held in quarantine; landing on
 * Issues shows each held lot with its own fix link (bible S28.2).
 * `booksError` is set by the receiving / vendor-bill wires when the books
 * refused; it opens Accounting (bible S29.2), never the Delivery tab.
 */
export const MANIFEST_PAGE_TABS: readonly TabSpec<ManifestPageTab>[] = [
  { key: "delivery", label: "Delivery", blurb: "The delivery itself: lines, receiving and finalize." },
  { key: "issues", label: "Issues", blurb: "Held lots, missing COAs and unmapped categories — each with its fix.", autoOpenParams: ["held"] },
  // S29: only a books REFUSAL auto-opens Accounting; a success (`books=`) stays
  // on Delivery. Placed after Issues so a finalize with held lots AND a books
  // refusal lands on Issues first (resolveTab takes the first tab in order).
  { key: "accounting", label: "Accounting", blurb: "What the books recorded for this delivery, and where to follow it up.", autoOpenParams: ["booksError"] },
];
