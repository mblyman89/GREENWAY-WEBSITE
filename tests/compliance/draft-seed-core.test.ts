/**
 * Task AK — vitest mirror for the draft-seeding planner.
 *
 * Pins the fix for the receiving→menu pipeline: the old code upserted drafts
 * against a PARTIAL unique index (impossible via PostgREST ON CONFLICT →
 * 42P10) and never read the error, so NO onboarding draft was ever created
 * and received products could never reach the website menu. The planner now
 * dedupes in pure code (published match → open draft → in-run duplicate) and
 * the executor does plain inserts whose errors are read and classified.
 */
import { describe, expect, it } from "vitest";

import {
  UNIQUE_VIOLATION_CODE,
  __runDraftSeedCoreTests,
  classifyInsertError,
  planDraftSeeding,
} from "@/lib/inventory/draft-seed-core";

describe("draft-seed-core", () => {
  it("passes its full self-test suite", () => {
    const { passed } = __runDraftSeedCoreTests();
    expect(passed).toBeGreaterThan(0);
  });

  it("seeds a draft for a received product that is not on the published menu", () => {
    const plan = planDraftSeeding({
      lots: [{ lotId: "l1", posProductKey: "SKU-NEW" }],
      publishedKeys: new Set(["SKU-LIVE"]),
      openDraftKeys: new Set(),
    });
    expect(plan.toSeed).toHaveLength(1);
    expect(plan.decisions[0].action).toBe("seed");
    expect(plan.matched).toBe(0);
    expect(plan.unmatched).toBe(1);
  });

  it("never seeds a duplicate when an open draft already awaits review", () => {
    const plan = planDraftSeeding({
      lots: [{ lotId: "l1", posProductKey: "SKU-A" }],
      publishedKeys: new Set(),
      openDraftKeys: new Set(["SKU-A"]),
    });
    expect(plan.toSeed).toHaveLength(0);
    expect(plan.decisions[0].action).toBe("skip_open_draft");
    // Still unmatched — it isn't on the live menu yet.
    expect(plan.unmatched).toBe(1);
  });

  it("dedupes the same POS key within one manifest (first lot wins)", () => {
    const plan = planDraftSeeding({
      lots: [
        { lotId: "l1", posProductKey: "SKU-A" },
        { lotId: "l2", posProductKey: "SKU-A" },
      ],
      publishedKeys: new Set(),
      openDraftKeys: new Set(),
    });
    expect(plan.toSeed.map((s) => s.lotId)).toEqual(["l1"]);
    expect(plan.decisions[1].action).toBe("skip_duplicate_in_run");
  });

  it("always seeds keyless lots — a real received product must reach review", () => {
    const plan = planDraftSeeding({
      lots: [
        { lotId: "l1", posProductKey: null },
        { lotId: "l2", posProductKey: null },
      ],
      publishedKeys: new Set(["X"]),
      openDraftKeys: new Set(["Y"]),
    });
    expect(plan.toSeed).toHaveLength(2);
    expect(plan.decisions.every((d) => d.action === "seed")).toBe(true);
  });

  it("classifies 23505 as a benign duplicate and everything else as failure", () => {
    expect(classifyInsertError(UNIQUE_VIOLATION_CODE)).toBe("duplicate");
    // 42P10 was the original silent killer — MUST surface as a failure.
    expect(classifyInsertError("42P10")).toBe("failure");
    expect(classifyInsertError(null)).toBe("failure");
  });
});
