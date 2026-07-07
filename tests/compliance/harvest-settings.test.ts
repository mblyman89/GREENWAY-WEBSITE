/**
 * tests/compliance/harvest-settings.test.ts — Slice H7 (Harvest Tuning).
 *
 * Pins the tuning safety envelope:
 *  • the vetted DEFAULTS match the numbers the pipeline shipped with
 *    (H4 tier presets, H5 fast-lane bars + caps, H6 cadence),
 *  • CLAMPS bound every knob (and garbage input falls back to the DEFAULT,
 *    never to a clamp edge — a garbled save must not silently move a bar),
 *  • merge ignores unknown keys and preserves missing ones,
 *  • the configurable lane bars default to the same behavior as before H7.
 */
import { describe, expect, it } from "vitest";
import {
  HARVEST_CLAMPS,
  HARVEST_DEFAULTS,
  clampHarvestValue,
  clampHarvestSettings,
  mergeHarvestSettings,
  isAllDefaults,
  type HarvestSettings,
} from "@/lib/kb/harvest-settings-core";
import {
  classifyLane,
  FAST_LANE_MIN_CHARS,
  FAST_LANE_MIN_CONFIDENCE,
  type LaneSuggestionInput,
} from "@/lib/kb/review-lanes-core";

const KEYS = Object.keys(HARVEST_CLAMPS) as (keyof HarvestSettings)[];

describe("harvest tuning defaults (the vetted numbers)", () => {
  it("defaults match the pre-H7 hardcoded pipeline values", () => {
    expect(HARVEST_DEFAULTS.fastLaneMinConfidence).toBe(FAST_LANE_MIN_CONFIDENCE);
    expect(HARVEST_DEFAULTS.fastLaneMinChars).toBe(FAST_LANE_MIN_CHARS);
    expect(HARVEST_DEFAULTS.staleAfterDays).toBe(90);
    expect(HARVEST_DEFAULTS.refreshBatch).toBe(25);
    expect(HARVEST_DEFAULTS.trickleBatch).toBe(25);
    expect(HARVEST_DEFAULTS.batchAcceptCap).toBe(50);
    expect(HARVEST_DEFAULTS.pendingLimit).toBe(1000);
    expect(HARVEST_DEFAULTS.tier1MaxPages).toBe(25);
    expect(HARVEST_DEFAULTS.tier2MaxPages).toBe(10);
    expect(HARVEST_DEFAULTS.tier3MaxPages).toBe(3);
    expect(HARVEST_DEFAULTS.tier3DelaySeconds).toBe(60);
  });

  it("every default sits inside its own clamp range", () => {
    for (const key of KEYS) {
      const { min, max } = HARVEST_CLAMPS[key];
      expect(HARVEST_DEFAULTS[key]).toBeGreaterThanOrEqual(min);
      expect(HARVEST_DEFAULTS[key]).toBeLessThanOrEqual(max);
    }
  });

  it("tier depths never exceed the crawler worker's hard ceiling (50)", () => {
    expect(HARVEST_CLAMPS.tier1MaxPages.max).toBeLessThanOrEqual(50);
    expect(HARVEST_CLAMPS.tier2MaxPages.max).toBeLessThanOrEqual(50);
    expect(HARVEST_CLAMPS.tier3MaxPages.max).toBeLessThanOrEqual(50);
    expect(HARVEST_CLAMPS.tier3DelaySeconds.max).toBeLessThanOrEqual(3600);
  });

  it("the fast-lane confidence bar can never be tuned below 0.5", () => {
    expect(HARVEST_CLAMPS.fastLaneMinConfidence.min).toBeGreaterThanOrEqual(0.5);
  });
});

describe("clampHarvestValue", () => {
  it("clamps below-min and above-max to the range edges", () => {
    expect(clampHarvestValue("staleAfterDays", 1)).toBe(7);
    expect(clampHarvestValue("staleAfterDays", 9999)).toBe(365);
    expect(clampHarvestValue("fastLaneMinConfidence", 0.1)).toBe(0.5);
    expect(clampHarvestValue("fastLaneMinConfidence", 1.5)).toBe(0.99);
  });

  it("passes in-range values through (integerized where integral)", () => {
    expect(clampHarvestValue("refreshBatch", 10)).toBe(10);
    expect(clampHarvestValue("refreshBatch", 10.6)).toBe(11);
    expect(clampHarvestValue("fastLaneMinConfidence", 0.856)).toBe(0.86);
  });

  it("garbage input falls back to the DEFAULT, never a clamp edge", () => {
    expect(clampHarvestValue("staleAfterDays", NaN)).toBe(HARVEST_DEFAULTS.staleAfterDays);
    expect(clampHarvestValue("staleAfterDays", "not a number")).toBe(
      HARVEST_DEFAULTS.staleAfterDays,
    );
    expect(clampHarvestValue("staleAfterDays", Infinity)).toBe(HARVEST_DEFAULTS.staleAfterDays);
    expect(clampHarvestValue("fastLaneMinConfidence", undefined)).toBe(
      HARVEST_DEFAULTS.fastLaneMinConfidence,
    );
  });

  it("numeric strings (form input) parse and clamp normally", () => {
    expect(clampHarvestValue("trickleBatch", "40")).toBe(40);
    expect(clampHarvestValue("trickleBatch", "400")).toBe(100);
    expect(clampHarvestValue("fastLaneMinConfidence", "0.75")).toBe(0.75);
  });
});

describe("clampHarvestSettings / mergeHarvestSettings", () => {
  it("clamps a fully out-of-range object back into the envelope", () => {
    const wild = Object.fromEntries(KEYS.map((k) => [k, 1e9])) as HarvestSettings;
    const clamped = clampHarvestSettings(wild);
    for (const key of KEYS) expect(clamped[key]).toBe(HARVEST_CLAMPS[key].max);
  });

  it("merge applies only provided keys and clamps them", () => {
    const merged = mergeHarvestSettings(HARVEST_DEFAULTS, {
      staleAfterDays: 30,
      tier3MaxPages: 999,
    });
    expect(merged.staleAfterDays).toBe(30);
    expect(merged.tier3MaxPages).toBe(50); // clamped to crawler ceiling
    expect(merged.fastLaneMinConfidence).toBe(HARVEST_DEFAULTS.fastLaneMinConfidence);
    expect(merged.refreshBatch).toBe(HARVEST_DEFAULTS.refreshBatch);
  });

  it("merge ignores null/undefined patch values (keeps base)", () => {
    const merged = mergeHarvestSettings(HARVEST_DEFAULTS, {
      staleAfterDays: null,
      refreshBatch: undefined,
    });
    expect(merged.staleAfterDays).toBe(HARVEST_DEFAULTS.staleAfterDays);
    expect(merged.refreshBatch).toBe(HARVEST_DEFAULTS.refreshBatch);
  });

  it("isAllDefaults detects vetted vs custom tuning", () => {
    expect(isAllDefaults({ ...HARVEST_DEFAULTS })).toBe(true);
    expect(isAllDefaults({ ...HARVEST_DEFAULTS, staleAfterDays: 60 })).toBe(false);
  });
});

describe("classifyLane with tunable bars (H7 wiring)", () => {
  const draft = (over: Partial<LaneSuggestionInput>): LaneSuggestionInput => ({
    id: "d1",
    entity_type: "vendor",
    entity_id: "v1",
    field_key: "about",
    suggested_value: "x".repeat(60),
    confidence: 0.85,
    created_at: "2026-07-01T00:00:00Z",
    ...over,
  });

  it("omitted overrides behave exactly like the pre-H7 defaults", () => {
    expect(classifyLane(draft({}))).toBe("fast");
    expect(classifyLane(draft({ confidence: 0.79 }))).toBe("standard");
    expect(classifyLane(draft({ suggested_value: "short" }))).toBe("standard");
  });

  it("a raised confidence bar demotes drafts that used to be fast", () => {
    expect(classifyLane(draft({}), { minConfidence: 0.9 })).toBe("standard");
    expect(classifyLane(draft({ confidence: 0.95 }), { minConfidence: 0.9 })).toBe("fast");
  });

  it("a lowered length bar promotes drafts that used to be thin", () => {
    const thin = draft({ suggested_value: "x".repeat(25) });
    expect(classifyLane(thin)).toBe("standard"); // default bar = 40
    expect(classifyLane(thin, { minChars: 20 })).toBe("fast");
  });

  it("tuned bars never override the compliance block or prospect/reference routing", () => {
    expect(
      classifyLane(draft({}), { hasBlockingFlags: true, minConfidence: 0.5, minChars: 10 }),
    ).toBe("standard");
    expect(
      classifyLane(draft({ entity_id: "lead:abc" }), { minConfidence: 0.5, minChars: 10 }),
    ).toBe("prospect");
    expect(
      classifyLane(draft({ field_key: "research_products" }), { minConfidence: 0.5, minChars: 10 }),
    ).toBe("reference");
  });
});
