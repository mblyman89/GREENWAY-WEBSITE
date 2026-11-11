/**
 * D232 slice M-3b (SOP-11 B.5 items 2 and 3, G-78): the Product journey
 * stepper and the per-tab coaching strips in Merch Studio.
 * Owner (D231, verbatim): "first step, do this, done great, step two..."
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runMerchJourneyCoreTests, buildJourney, nextLine, TAB_COACH } from "@/lib/merch-studio/merch-journey-core";
import { STUDIO_TAB_IDS } from "@/lib/merch-studio/studio-tabs-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D232 M-3b: journey core", () => {
  it("self-test passes", () => {
    expect(__runMerchJourneyCoreTests().failed).toBe(0);
  });
  it("nine stages, the SOP order", () => {
    const j = buildJourney({ design: null, sample: { ticked: 0, total: 0 }, published: null, shopOk: null });
    expect(j.stages.map((s) => s.label)).toEqual(["Garment", "Design", "Print files", "Mockups", "Sample approved", "Price", "Publish", "On the shop", "Stock synced"]);
  });
  it("blockers count shows on the Design pill and the next step", () => {
    const j = buildJourney({ design: { name: "Tee", garmentOk: true, elements: 3, blockers: 2, printFiles: 1 }, sample: { ticked: 0, total: 6 }, published: null, shopOk: null });
    expect(j.stages[1].label).toBe("Design (2 \u26d4)");
    expect(nextLine(j, null)).toContain("Fix 2 blockers");
  });
  it("after publish it watches the shop, then asks for stock", () => {
    const pub = { handle: "tee", status: "live" as const, images: 1, stockSyncedAt: "", minRetailCents: 3500 };
    const j = buildJourney({ design: { name: "Tee", garmentOk: true, elements: 3, blockers: 0, printFiles: 1 }, sample: { ticked: 6, total: 6 }, published: pub, shopOk: true });
    expect(nextLine(j, pub)).toBe("Live on greenwaymerch.com. Next: Copy Printful stock in Inventory \u2192 Merch Inventory.");
  });
  it("every Studio tab has a coaching strip", () => {
    for (const t of STUDIO_TAB_IDS) expect(TAB_COACH[t].todo.length).toBeGreaterThan(10);
  });
});

describe("D232 M-3b: wiring", () => {
  it("the Studio mounts the bar after the restore, re-mounted per tab", () => {
    const s = read("src/components/admin/merch-studio/MerchStudio.tsx");
    expect(s).toContain("<JourneyBar key={tab}");
    expect(s).toContain("restored && journey");
  });
  it("the page loads the catalog and the last saved H-7 (no live calls)", () => {
    const p = read("src/app/admin/merch-studio/page.tsx");
    expect(p).toContain("loadJourney");
    expect(p).toContain("latestMerchHealthReport");
    expect(p).toContain('"H-7"');
    expect(p).not.toContain("gatherMerchHealth");
  });
});
