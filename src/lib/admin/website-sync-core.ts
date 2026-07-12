/**
 * src/lib/admin/website-sync-core.ts  (Task T / PR 5 — Website Sync Command Center)
 *
 * PURE presentation helpers for the /admin/website-sync page — the harmony
 * dashboard that shows exactly what the storefront is serving RIGHT NOW
 * (published menu version, this week's deals with today highlighted, loyalty
 * terms, medical surface, hours) so the back office is visibly the single
 * source of truth for the customer-facing website.
 *
 * No React, no DB, no server-only — every function here is unit-tested in
 * tests/compliance/website-sync-core.test.ts against the SAME inputs the
 * storefront consumes (MenuVersion rows, WeeklyDealSummary rows from
 * published-rules-core, SalesHoursWindow from sales-hours-core).
 */
import type { MenuVersion } from "@/lib/pos/db-types";
import {
  STORE_WEEKDAY_TO_INDEX,
  type WeeklyDealSummary,
} from "@/lib/promotions/published-rules-core";
import {
  minutesToLabel,
  type SalesHoursWindow,
  STATUTORY_CLOSE_MINUTES,
  STATUTORY_OPEN_MINUTES,
} from "@/lib/compliance/sales-hours-core";

// ---------------------------------------------------------------------------
// Published menu version
// ---------------------------------------------------------------------------

export type MenuVersionStats = {
  itemCount: number;
  variantCount: number;
  vendorCount: number;
  hiddenCount: number;
  publishedAtIso: string | null;
  notes: string | null;
};

/** Reduce a published MenuVersion row to the stats the sync page shows. */
export function menuVersionStats(v: MenuVersion | null): MenuVersionStats | null {
  if (!v) return null;
  return {
    itemCount: v.item_count,
    variantCount: v.variant_count,
    vendorCount: v.vendor_count,
    hiddenCount: v.hidden_count,
    publishedAtIso: v.published_at,
    notes: v.notes,
  };
}

// ---------------------------------------------------------------------------
// This week's deals — today highlighted the way the storefront resolves it
// ---------------------------------------------------------------------------

export type WeekDealRow = WeeklyDealSummary & {
  /** Mon/Tue/… label for the grid. */
  dayLabel: string;
  /** True when this row is the store's CURRENT Pacific weekday. */
  isToday: boolean;
};

const DAY_LABELS: Record<WeeklyDealSummary["weekday"], string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/**
 * Attach day labels + the today flag to the week's deal summaries.
 * `todayIndex` is the store's Pacific weekday (0=Sunday … 6=Saturday) from
 * storeWeekday() — the SAME resolver the storefront cart uses, so the row we
 * highlight is exactly the rule the website is charging right now.
 */
export function weekRowsWithToday(
  summaries: WeeklyDealSummary[],
  todayIndex: number,
): WeekDealRow[] {
  return summaries.map((s) => ({
    ...s,
    dayLabel: DAY_LABELS[s.weekday],
    isToday: STORE_WEEKDAY_TO_INDEX[s.weekday] === todayIndex,
  }));
}

// ---------------------------------------------------------------------------
// Hours — the completion-gate window, rendered like the settings page does
// ---------------------------------------------------------------------------

/** "8:00 AM – midnight" — the sales-hours gate window as a human label. */
export function salesWindowLabel(window: SalesHoursWindow): string {
  return `${minutesToLabel(window.openMinutes)} – ${minutesToLabel(window.closeMinutes)}`;
}

/** True when the owner has NOT tightened the gate past the statute. */
export function isStatutoryWindow(window: SalesHoursWindow): boolean {
  return (
    window.openMinutes === STATUTORY_OPEN_MINUTES &&
    window.closeMinutes === STATUTORY_CLOSE_MINUTES
  );
}

// ---------------------------------------------------------------------------
// Medical surface status
// ---------------------------------------------------------------------------

export type EndorsementView = {
  isMedicallyEndorsed: boolean;
  endorsementNumber: string | null;
} | null;

/**
 * One-line status of the medical surface. When the endorsement config row is
 * missing we say so honestly instead of implying an endorsement exists.
 */
export function endorsementStatusLine(cfg: EndorsementView): string {
  if (!cfg) return "Endorsement not configured — /medical explains the program; excise relief requires the endorsement.";
  if (!cfg.isMedicallyEndorsed) {
    return "Not medically endorsed — sales-tax relief per RCW 82.08.9998 only; no excise exemption.";
  }
  return cfg.endorsementNumber
    ? `Medically endorsed (endorsement ${cfg.endorsementNumber}) — card + compliant product unlocks excise exemption.`
    : "Medically endorsed — card + compliant product unlocks excise exemption.";
}

// ---------------------------------------------------------------------------
// Deal-source counting (custom vs seed) for the section subtitle
// ---------------------------------------------------------------------------

/** "3 of 7 days customized in the back office" / "all 7 days on committed seeds". */
export function dealSourceSummary(rows: { fromDatabase: boolean }[]): string {
  const custom = rows.filter((r) => r.fromDatabase).length;
  if (custom === 0) return `all ${rows.length} days on committed seed deals`;
  return `${custom} of ${rows.length} days customized in the back office`;
}
