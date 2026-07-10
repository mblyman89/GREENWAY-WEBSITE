/**
 * tests/compliance/journey-core.test.ts
 *
 * W1 — THE canonical Product Intake journey (journey-core). The stakes: every
 * surface (stage strip, hub cards, nav ordering) derives from this ONE
 * constant. If it drifts — a stage disappears, indexes shuffle, an href moves
 * without the map following — staff are taught a wrong mental model of the
 * pipeline. These tests pin the canonical order, the alias bridge for legacy
 * call sites, and the embedded self-test.
 */

import { describe, it, expect } from "vitest";
import {
  JOURNEY_STAGES,
  journeyStage,
  resolveStageKey,
  LEGACY_STAGE_ALIASES,
  __runJourneyCoreTests,
  type JourneyStageKey,
} from "@/lib/catalog/journey-core";

describe("W1 — canonical journey constant", () => {
  it("is exactly the audited 8-stage pipeline, in order", () => {
    expect(JOURNEY_STAGES.map((s) => s.key)).toEqual([
      "discover",
      "order",
      "receive",
      "onboard",
      "publish",
      "enrich",
      "master",
      "pay",
    ]);
  });

  it("indexes are contiguous and match position", () => {
    JOURNEY_STAGES.forEach((s, i) => expect(s.index).toBe(i));
  });

  it("every stage points at the verified admin surface", () => {
    const hrefs: Record<JourneyStageKey, string> = {
      discover: "/admin/discovery",
      order: "/admin/purchasing",
      receive: "/admin/inventory/intake",
      onboard: "/admin/inventory/drafts",
      publish: "/admin/inventory",
      enrich: "/admin/products",
      master: "/admin/products/masters",
      pay: "/admin/vendor-payments",
    };
    for (const s of JOURNEY_STAGES) expect(s.href).toBe(hrefs[s.key]);
    // Publish's secondary surface is where publishing actually happens.
    expect(journeyStage("publish").altHref).toBe("/admin/menu-imports");
  });

  it("labels and hints are present and non-empty for every stage", () => {
    for (const s of JOURNEY_STAGES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.hint.length).toBeGreaterThan(0);
      expect(s.cardTitle.length).toBeGreaterThan(0);
    }
  });

  it("W10 — every stage declares the permission its page actually requires (verified per page)", () => {
    const perms: Record<JourneyStageKey, string> = {
      discover: "inventory.manage", // /admin/discovery
      order: "inventory.manage", // /admin/purchasing
      receive: "inventory.manage", // /admin/inventory/intake
      onboard: "inventory.manage", // /admin/inventory/drafts
      publish: "inventory.manage", // /admin/inventory (altHref menu-imports is menu.import)
      enrich: "products.enrich", // /admin/products
      master: "inventory.manage", // /admin/products/masters
      pay: "payables.manage", // /admin/vendor-payments — W10 scoped, NOT settings.manage
    };
    for (const s of JOURNEY_STAGES) expect(s.permission).toBe(perms[s.key]);
  });
});

describe("W1 — legacy alias bridge (old CatalogStageStrip keys keep working)", () => {
  it("maps every legacy strip key to its canonical stage", () => {
    expect(resolveStageKey("intake")).toBe("receive");
    expect(resolveStageKey("onboarding")).toBe("onboard");
    expect(resolveStageKey("menu")).toBe("publish");
    expect(resolveStageKey("enrichment")).toBe("enrich");
  });

  it("passes canonical keys through unchanged", () => {
    for (const s of JOURNEY_STAGES) expect(resolveStageKey(s.key)).toBe(s.key);
  });

  it("throws loudly on junk so drift fails in CI, not in front of staff", () => {
    expect(() => resolveStageKey("bogus")).toThrow(/Unknown journey stage/);
    expect(() => journeyStage("bogus" as JourneyStageKey)).toThrow(/Unknown journey stage/);
  });

  it("every alias target actually exists in the journey", () => {
    for (const target of Object.values(LEGACY_STAGE_ALIASES)) {
      expect(JOURNEY_STAGES.some((s) => s.key === target)).toBe(true);
    }
  });
});

describe("W1 — embedded self-test", () => {
  it("__runJourneyCoreTests passes", () => {
    const r = __runJourneyCoreTests();
    expect(r.passed).toBeGreaterThan(10);
  });
});
