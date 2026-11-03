/**
 * CVB-11 (owner 2026-11-03, docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, CVB-D18..D20):
 *   "I want to see excise tax, sales tax, and after tax sales figures. Also, the sales by hour section is
 *    broke. Please also repurpose the menu upload tile to be a Leafly dedicated tile ..."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { __runCockpitExtrasTests, hourWindow, cockpitTaxFigures, leaflyTile } from "@/lib/admin/cockpit-extras-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("CVB-11 cockpit extras", () => {
  it("pure self-tests pass", () => {
    const r = __runCockpitExtrasTests();
    expect(r.messages).toEqual([]);
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(25);
  });

  it("an unreadable tax report is never shown as $0", () => {
    expect(cockpitTaxFigures(null)).toBeNull();
  });

  it("every drawn bar of a busy hour has a real height", () => {
    const hrs = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h}`, revenueMinorUnits: h === 15 ? 900 : h === 11 ? 300 : 0, orders: 0 }));
    const w = hourWindow(hrs);
    expect(w.find((b) => b.hour === 15)!.heightPct).toBe(100);
    expect(w.find((b) => b.hour === 11)!.heightPct).toBe(33);
  });

  it("the Leafly tile uses the page's verdict wording", () => {
    expect(leaflyTile({ tone: "good", headline: "Connected and syncing", lastSentIso: null }, null, () => "x").value).toBe("Connected and syncing");
  });

  it("the dashboard renders the taxes, the fixed chart and the Leafly tile, and no longer the menu-upload tile", () => {
    const page = read("src/app/admin/page.tsx");
    expect(page).toContain("Today's taxes");
    expect(page).toContain('label="After-tax sales"');
    expect(page).toContain('label="Excise tax (37%)"');
    expect(page).toContain('label="Sales tax"');
    expect(page).toContain("loadCockpitTaxes()");
    // The bar sits in a track with a real height (flex-1 inside h-44), the root cause of the broken chart.
    expect(page).toContain('<div className="flex w-full flex-1 items-end">');
    expect(page).toContain("hourWindow(snap.today.byHour)");
    expect(page).not.toContain("Last POS import");
    expect(page).toContain('label="Leafly"');
    expect(page).toContain('can(session.profile.role, "settings.manage")');
  });

  it("taxes come from the Reports -> Tax engine and the Leafly verdict from the Leafly page's function", () => {
    const srv = read("src/lib/admin/cockpit-extras-server.ts");
    expect(srv).toContain("getWaTaxReport(");
    expect(srv).toContain("describeLeaflyConnection(");
    expect(srv).toContain('import "server-only"');
  });
});
