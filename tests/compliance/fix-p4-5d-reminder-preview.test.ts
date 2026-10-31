/**
 * Fix Phase 4.5d — the December full-count reminder, checkable in any month (G-41).
 *
 * Owner (Q-06-5, D58): "we do a full inventory audit once per year at the end
 * of the year." The cockpit reminder only fires in December; the planner page
 * now previews it word for word, using the same function and the same year.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fullCountReminder, fullCountReminderPreview } from "@/lib/inventory/full-count-core";

const PAGE = readFileSync("src/app/admin/inventory/audits/full-count/page.tsx", "utf8");
const COCKPIT = readFileSync("src/app/admin/page.tsx", "utf8");

describe("Fix 4.5d — December reminder preview", () => {
  it("in October, previews December's exact cockpit text for the same year", () => {
    const pv = fullCountReminderPreview({ todayPacific: "2026-10-30", hasCountForDecemberYear: false });
    expect(pv.live).toBe(false);
    expect(pv.year).toBe(2026);
    expect(pv.text).toBe(fullCountReminder({ todayPacific: "2026-12-01", hasCountForYear: false }));
    expect(pv.text).toContain("2026");
  });

  it("stays quiet once that year's count is planned", () => {
    expect(fullCountReminderPreview({ todayPacific: "2026-10-30", hasCountForDecemberYear: true }).text).toBeNull();
  });

  it("is live in December and matches the cockpit for today", () => {
    const pv = fullCountReminderPreview({ todayPacific: "2026-12-15", hasCountForDecemberYear: false });
    expect(pv.live).toBe(true);
    expect(pv.text).toBe(fullCountReminder({ todayPacific: "2026-12-15", hasCountForYear: false }));
  });

  it("the planner shows the preview; the cockpit still uses the same reminder", () => {
    expect(PAGE).toContain('data-testid="full-count-reminder-preview"');
    expect(PAGE).toContain("fullCountReminderPreview(");
    expect(PAGE).toMatch(/hasFullCountForYear\(reminderYear\)\.catch\(\(\) => null\)/);
    expect(COCKPIT).toContain("fullCountReminder({ todayPacific, hasCountForYear: fullCountPlanned })");
  });
});
