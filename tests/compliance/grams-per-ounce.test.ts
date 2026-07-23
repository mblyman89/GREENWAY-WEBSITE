/**
 * Vitest mirror of the grams-per-ounce pure self-tests (GW-016).
 * Locks all three named grams-per-ounce equivalences and the invariant that
 * the STATUTORY value (28, license-critical limit enforcement) is the
 * strictest — so no future edit can silently loosen the WAC 314-55-095
 * limit engine or distort the DOH medical table / real-weight math.
 */
import { describe, expect, it } from "vitest";

import {
  STATUTORY_GRAMS_PER_OUNCE,
  METRIC_GRAMS_PER_OUNCE,
  AVOIRDUPOIS_GRAMS_PER_OUNCE,
  __runGramsPerOunceTests,
} from "@/lib/compliance/grams-per-ounce";
import { GRAMS_PER_OUNCE } from "@/lib/compliance/sales-limits-core";
import { MEDICAL_PURCHASE_LIMITS, RECREATIONAL_PURCHASE_LIMITS } from "@/lib/medical/tax";

describe("grams-per-ounce", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runGramsPerOunceTests()).not.toThrow();
  });

  it("pins the three legal equivalences exactly", () => {
    expect(STATUTORY_GRAMS_PER_OUNCE).toBe(28);
    expect(METRIC_GRAMS_PER_OUNCE).toBe(28.35);
    expect(AVOIRDUPOIS_GRAMS_PER_OUNCE).toBe(28.3495);
  });

  it("the limit ENGINE uses the statutory value (license-critical)", () => {
    expect(GRAMS_PER_OUNCE).toBe(STATUTORY_GRAMS_PER_OUNCE);
  });

  it("the DOH medical table uses the metric convention (unchanged behavior)", () => {
    expect(MEDICAL_PURCHASE_LIMITS.usableGrams).toBeCloseTo(3 * 28.35);
    expect(RECREATIONAL_PURCHASE_LIMITS.usableGrams).toBeCloseTo(28.35);
  });
});
