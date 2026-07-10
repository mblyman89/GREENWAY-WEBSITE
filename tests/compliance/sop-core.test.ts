import { describe, expect, it } from "vitest";
import {
  __runSopCoreTests,
  findSopDoc,
  SOP_BASE_PATH,
  SOP_DOCS,
  sopForStage,
  sopHref,
  TRUCK_DAY_SLUG,
} from "@/lib/catalog/sop-core";
import { JOURNEY_STAGES } from "@/lib/catalog/journey-core";

/**
 * W13 — printable SOP pack (audit G11).
 * The pack is PURE data derived from the canonical journey; these tests keep
 * paper and pipeline from drifting apart.
 */
describe("sop-core (W13)", () => {
  it("passes its embedded self-tests", () => {
    const { passed } = __runSopCoreTests();
    expect(passed).toBeGreaterThan(30);
  });

  it("covers every journey stage exactly once, plus the truck-day master", () => {
    expect(SOP_DOCS.length).toBe(JOURNEY_STAGES.length + 1);
    for (const stage of JOURNEY_STAGES) {
      const doc = sopForStage(stage.key);
      expect(doc.slug).toBe(stage.key);
      // The sheet points staff at the stage's real working surface.
      expect([stage.href, stage.altHref]).toContain(doc.where);
    }
    expect(findSopDoc(TRUCK_DAY_SLUG)?.stageKey).toBeNull();
  });

  it("every sheet is a complete one-pager (purpose, prep, steps, done-when, escalation)", () => {
    for (const doc of SOP_DOCS) {
      expect(doc.title).toMatch(/^SOP — /);
      expect(doc.purpose.length).toBeGreaterThan(0);
      expect(doc.before.length).toBeGreaterThanOrEqual(1);
      expect(doc.steps.length).toBeGreaterThanOrEqual(3);
      expect(doc.steps.length).toBeLessThanOrEqual(10);
      expect(doc.doneWhen.length).toBeGreaterThan(0);
      expect(doc.ifStuck.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("hrefs live under Getting Started and unknown slugs miss safely", () => {
    expect(SOP_BASE_PATH).toBe("/admin/getting-started/sop");
    expect(sopHref("receive")).toBe("/admin/getting-started/sop/receive");
    expect(findSopDoc("not-a-sop")).toBeNull();
  });

  it("prints the drafts-only ethos on paper (master SOP)", () => {
    const master = findSopDoc(TRUCK_DAY_SLUG)!;
    const text = [master.purpose, ...master.steps, ...master.ifStuck].join(" ").toLowerCase();
    expect(text).toContain("drafts-first");
    // The master walks the whole journey: receiving → onboarding → publish → pay.
    expect(text).toContain("accept");
    expect(text).toContain("publish");
    expect(text).toContain("payable");
  });
});
