/**
 * Fix Phase 4.4c — intelligent cycle counts and vendor of the day (G-40; owner D58).
 *
 * Owner (D58): "My plan for cycle counts is to issue small counts the employees
 * can do everyday to keep inventory accurate. Something like a vendor per day,
 * broken into chunks if a large vendor, or if small enough, to do on their own."
 * · "I also want options for initiating intelligent cycle counts."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  COUNT_GENERATORS,
  EMPTY_ROTATION,
  __runCountGeneratorsCoreTests,
  isOpenAudit,
  proposeVendorOfDay,
  rotationFromSetting,
} from "@/lib/inventory/count-generators-core";
import type { AuditLot } from "@/lib/inventory/inventory-audit-core";

const read = (f: string) => readFileSync(f, "utf8");
const PAGE = read("src/app/admin/inventory/audits/new/page.tsx");
const GEN = read("src/app/admin/inventory/audits/new/CountGenerators.tsx");
const ACTIONS = read("src/app/admin/inventory/audits/actions.ts");
const HUB = read("src/lib/inventory/audit-hub-store.ts");
const STORE = read("src/lib/inventory/count-generators-store.ts");
const COCKPIT = read("src/app/admin/page.tsx");

const lot = (id: string, vendorId: string | null, vendorName: string | null, key = `p-${id}`): AuditLot => ({
  lotId: id,
  lotCode: `L-${id}`,
  posProductKey: key,
  productName: key,
  categorySlug: "flower",
  vendorId,
  vendorName,
  onHandQty: 5,
  unitCostMinorUnits: 400,
  lastCountedAt: null,
  priorVarianceCount: 0,
  status: "active",
  expiresOn: null,
});

describe("G-40 core", () => {
  it("self-test passes", () => {
    expect(__runCountGeneratorsCoreTests()).toBeGreaterThanOrEqual(30);
  });

  it("offers the five generators named in G-40 (plus the existing Cultivera import tab)", () => {
    expect([...COUNT_GENERATORS]).toEqual(["due", "vendor", "abc", "exceptions", "expiring"]);
    expect(GEN).toContain("Cultivera import flags");
  });

  it("a whole store rotates vendor by vendor, a big vendor in chunks, and comes back round", () => {
    const lots = [
      ...Array.from({ length: 6 }, (_, i) => lot(`a${i}`, "va", "Alpha")),
      lot("b0", "vb", "Beta"),
    ];
    let state = { ...EMPTY_ROTATION, chunkLots: 5 };
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = proposeVendorOfDay(lots, state, new Set())!;
      seen.push(`${p.vendorName}:${p.chunkIndex + 1}/${p.chunkCount}:${p.lotIds.length}`);
      state = rotationFromSetting({ ...state, ...p.next });
    }
    expect(seen).toEqual(["Alpha:1/2:5", "Alpha:2/2:1", "Beta:1/1:1", "Alpha:1/2:5"]);
  });

  it("posted counts release their lots; everything else holds them", () => {
    expect(isOpenAudit("draft", null)).toBe(true);
    expect(isOpenAudit("review", null)).toBe(true);
    expect(isOpenAudit("approved", "2026-10-30T00:00:00Z")).toBe(false);
    expect(isOpenAudit("cancelled", null)).toBe(false);
  });
});

describe("G-40 wiring", () => {
  it("one open count per lot is enforced at create, failing closed", () => {
    expect(HUB).toContain("const holds = await loadOpenCountHolds(input.lotIds);");
    expect(HUB).toContain("if (!holds.ok) return holds;");
    expect(HUB).toContain('code: "LOT_ON_OPEN_COUNT"');
    // and the default / import proposals leave those lots out
    expect(HUB).toContain("const lots = await withoutOpenCountLots(allLots);");
    expect(HUB).toContain("coverage: buildCoverageReport(allLots, asOf)");
  });

  it("the store pages every read and keeps the rotation in site_settings", () => {
    expect(STORE).toContain('export const ROTATION_SETTING_KEY = "count_vendor_rotation";');
    expect(STORE).toMatch(/pagedAll<AuditLotRow>/);
    expect(STORE).toContain('.is("posted_at", null)');
    expect(STORE).not.toMatch(/\.limit\(\s*\d{4,}/);
    expect(STORE).toContain('new Set(["receive", "count"])');
  });

  it("the planner page has the tabs, and each lot shows why it was picked", () => {
    expect(PAGE).toContain("isCountGenerator(sp.gen)");
    expect(PAGE).toContain("<GeneratorTabs active={gen} />");
    expect(GEN).toContain('data-testid="generator-why"');
    expect(GEN).toContain('<input type="hidden" name="gen" value={gen} />');
    expect(GEN).toContain('data-testid="vendor-chunk-form"');
    expect(GEN).toContain("Skip to the next one");
    expect(GEN).toContain('data-testid="vendor-upcoming"');
  });

  it("only the owner plans, sets the size or skips; a vendor count moves the rotation on", () => {
    for (const fn of ["saveRotationSettingsAction", "skipVendorAction"]) {
      const body = ACTIONS.slice(ACTIONS.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 300)).toContain('requirePermission("inventory.audit")');
    }
    expect(ACTIONS).toContain('if (gen === "vendor") {');
    expect(ACTIONS).toContain("lastPlannedOn: pacificToday()");
    // the generator name is allow-listed before it reaches a redirect
    expect(ACTIONS).toContain('isCountGenerator(genRaw) && genRaw !== "due"');
  });

  it("the cockpit reminds the owner of today's vendor count", () => {
    expect(COCKPIT).toContain("vendorCountPlannedToday()");
    expect(COCKPIT).toContain('href: "/admin/inventory/audits/new?gen=vendor"');
  });
});
