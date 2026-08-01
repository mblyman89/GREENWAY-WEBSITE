/**
 * Website Sync Command Center — pure-core tests (Task T / PR 5).
 *
 * Pins the /admin/website-sync presentation helpers to the SAME inputs the
 * storefront consumes: MenuVersion rows, weeklyDealSummaries() output from
 * published-rules-core, SalesHoursWindow from sales-hours-core.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dealSourceSummary,
  endorsementStatusLine,
  isStatutoryWindow,
  menuVersionStats,
  salesWindowLabel,
  weekRowsWithToday,
} from "@/lib/admin/website-sync-core";
import {
  STORE_WEEKDAY_TO_INDEX,
  weeklyDealSummaries,
} from "@/lib/promotions/published-rules-core";
import {
  DEFAULT_SALES_HOURS,
  STATUTORY_CLOSE_MINUTES,
  STATUTORY_OPEN_MINUTES,
} from "@/lib/compliance/sales-hours-core";
import type { MenuVersion } from "@/lib/pos/db-types";

function versionRow(overrides: Partial<MenuVersion> = {}): MenuVersion {
  return {
    id: "v1",
    import_id: "imp1",
    status: "published",
    item_count: 412,
    variant_count: 903,
    vendor_count: 37,
    hidden_count: 4,
    error_count: 0,
    warning_count: 2,
    summary_json: null,
    notes: "May menu",
    created_by: null,
    published_at: "2026-05-01T17:00:00.000Z",
    published_by: null,
    created_at: "2026-05-01T16:00:00.000Z",
    updated_at: "2026-05-01T17:00:00.000Z",
    ...overrides,
  };
}

describe("menuVersionStats", () => {
  it("reduces the published row to the exact figures shown", () => {
    const stats = menuVersionStats(versionRow());
    expect(stats).toEqual({
      itemCount: 412,
      variantCount: 903,
      vendorCount: 37,
      hiddenCount: 4,
      publishedAtIso: "2026-05-01T17:00:00.000Z",
      notes: "May menu",
    });
  });

  it("returns null when nothing is published (storefront fallback state)", () => {
    expect(menuVersionStats(null)).toBeNull();
  });
});

describe("weekRowsWithToday", () => {
  // Empty snapshots → weeklyDealSummaries falls back to the committed seed
  // presentations — the SAME fallback the storefront renders.
  const summaries = weeklyDealSummaries([]);

  it("produces 7 rows Monday→Sunday with day labels", () => {
    const rows = weekRowsWithToday(summaries, STORE_WEEKDAY_TO_INDEX.monday);
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.dayLabel)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });

  it("flags exactly one row as today, matching the Pacific weekday index", () => {
    for (const weekday of ["sunday", "wednesday", "saturday"] as const) {
      const rows = weekRowsWithToday(summaries, STORE_WEEKDAY_TO_INDEX[weekday]);
      const todays = rows.filter((r) => r.isToday);
      expect(todays).toHaveLength(1);
      expect(todays[0].weekday).toBe(weekday);
    }
  });

  it("carries the summary fields through unchanged", () => {
    const rows = weekRowsWithToday(summaries, 0);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].title).toBe(summaries[i].title);
      expect(rows[i].menuHref).toBe(summaries[i].menuHref);
      expect(rows[i].fromDatabase).toBe(summaries[i].fromDatabase);
    }
  });
});

describe("salesWindowLabel / isStatutoryWindow", () => {
  it("renders the statutory default as 8:00 AM – midnight", () => {
    expect(salesWindowLabel(DEFAULT_SALES_HOURS)).toBe("8:00 AM – midnight");
    expect(isStatutoryWindow(DEFAULT_SALES_HOURS)).toBe(true);
  });

  it("recognizes an owner-tightened window", () => {
    const tightened = { openMinutes: STATUTORY_OPEN_MINUTES, closeMinutes: 23 * 60 };
    expect(salesWindowLabel(tightened)).toBe("8:00 AM – 11:00 PM");
    expect(isStatutoryWindow(tightened)).toBe(false);
    expect(
      isStatutoryWindow({
        openMinutes: STATUTORY_OPEN_MINUTES,
        closeMinutes: STATUTORY_CLOSE_MINUTES,
      }),
    ).toBe(true);
  });
});

describe("endorsementStatusLine", () => {
  it("is honest when no endorsement config exists", () => {
    expect(endorsementStatusLine(null)).toContain("not configured");
  });

  it("distinguishes endorsed vs not endorsed", () => {
    expect(
      endorsementStatusLine({ isMedicallyEndorsed: false, endorsementNumber: null }),
    ).toContain("Not medically endorsed");
    expect(
      endorsementStatusLine({ isMedicallyEndorsed: true, endorsementNumber: null }),
    ).toContain("Medically endorsed");
  });

  it("surfaces the endorsement number when present", () => {
    expect(
      endorsementStatusLine({ isMedicallyEndorsed: true, endorsementNumber: "ME-12345" }),
    ).toContain("ME-12345");
  });
});

describe("dealSourceSummary", () => {
  it("reports all-seed weeks", () => {
    expect(dealSourceSummary(Array(7).fill({ fromDatabase: false }))).toBe(
      "all 7 days on committed seed deals",
    );
  });

  it("counts customized days", () => {
    const rows = [
      { fromDatabase: true },
      { fromDatabase: false },
      { fromDatabase: true },
      { fromDatabase: false },
      { fromDatabase: false },
      { fromDatabase: false },
      { fromDatabase: true },
    ];
    expect(dealSourceSummary(rows)).toBe("3 of 7 days customized in the back office");
  });
});

describe("MIG-3 MS-3.2 — Website Sync 'edit hours' deep link repointed to Header & Footer (REPOINT)", () => {
  const page = readFileSync("src/app/admin/website-sync/page.tsx", "utf8");

  it("the Hours card links to the Header & Footer editor (not Site Content)", () => {
    // the hours footer copy now lives in /admin/header-footer (surfaced in MS-3.1),
    // so the shortcut next to the business.hours.display note must point there.
    const hoursNote = page.slice(page.indexOf("business.hours.display"));
    expect(hoursNote).toContain('href="/admin/header-footer"');
    // the raw page source carries the HTML entity for the ampersand
    expect(hoursNote).toContain("Header &amp; Footer");
  });

  it("does NOT send the hours shortcut to the old Site Content editor", () => {
    // guard against a regression that would re-point the hours link back to /admin/content.
    const hoursNote = page.slice(page.indexOf("business.hours.display"), page.indexOf("business.hours.display") + 400);
    expect(hoursNote).not.toContain('href="/admin/content"');
  });

  it("points the Medical card at the Medical page editor (repointed in MIG-5 Slice 2)", () => {
    // MIG-5 Slice 2 moved the medical copy out of the Site Content junk drawer
    // and into the dedicated Medical page editor, so the deep link followed it.
    const medicalNote = page.slice(page.indexOf("medical.* blocks") - 400, page.indexOf("medical.* blocks"));
    expect(medicalNote).toContain('href="/admin/medical-page"');
    // and the whole sync page no longer links to the old Site Content editor.
    expect(page).not.toContain('href="/admin/content"');
  });
});
