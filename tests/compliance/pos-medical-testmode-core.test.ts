/**
 * POS Slice 5 — medical "TEST MODE" endorsement simulation.
 *
 * Runs the full pure self-test suite, then pins the safety-critical behaviour:
 * the override ONLY flips a store's endorsement to simulate it, ONLY when the
 * bundle already carries a medical config (never fabricates one), never mutates
 * the original bundle, and is a strict fail-safe (only the exact "on" token
 * enables it — a corrupt localStorage blob can never silently drop real tax).
 */
import { describe, expect, it } from "vitest";

import type { PosMenuBundle } from "@/lib/pos/sale-flow-core";
import {
  __runMedicalTestModeCoreTests,
  MEDICAL_TESTMODE_KEY,
  parseMedicalTestMode,
  serializeMedicalTestMode,
  applyMedicalTestMode,
  medicalTestModeBannerActive,
} from "@/lib/pos/medical-testmode-core";

describe("medical-testmode-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runMedicalTestModeCoreTests()).not.toThrow();
  });
});

describe("medical test-mode override", () => {
  const unendorsed = {
    products: [],
    medical: { endorsed: false, exciseExemptionUntil: "2029-06-30", registry: { p1: "general" } },
  } as unknown as PosMenuBundle;
  const noMedical = { products: [] } as unknown as PosMenuBundle;

  it("fails safe — only the exact 'on' token enables it", () => {
    expect(parseMedicalTestMode("on")).toBe(true);
    expect(parseMedicalTestMode("off")).toBe(false);
    expect(parseMedicalTestMode(null)).toBe(false);
    expect(parseMedicalTestMode("ON")).toBe(false);
    expect(parseMedicalTestMode("true")).toBe(false);
    expect(parseMedicalTestMode(serializeMedicalTestMode(true))).toBe(true);
  });

  it("OFF returns the bundle untouched (real endorsement stays authoritative)", () => {
    expect(applyMedicalTestMode(unendorsed, false)).toBe(unendorsed);
    expect(unendorsed.medical?.endorsed).toBe(false);
  });

  it("ON flips endorsed to true without mutating the original", () => {
    const flipped = applyMedicalTestMode(unendorsed, true);
    expect(flipped).not.toBe(unendorsed);
    expect(flipped.medical?.endorsed).toBe(true);
    expect(flipped.medical?.exciseExemptionUntil).toBe("2029-06-30");
    // original untouched
    expect(unendorsed.medical?.endorsed).toBe(false);
  });

  it("ON never fabricates a medical config when the bundle has none", () => {
    expect(applyMedicalTestMode(noMedical, true)).toBe(noMedical);
    expect(medicalTestModeBannerActive(noMedical, true)).toBe(false);
    expect(medicalTestModeBannerActive(unendorsed, true)).toBe(true);
  });

  it("exposes a stable per-device localStorage key", () => {
    expect(MEDICAL_TESTMODE_KEY).toBe("gw-pos-medical-testmode");
  });
});
