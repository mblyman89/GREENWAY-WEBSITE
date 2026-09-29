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
