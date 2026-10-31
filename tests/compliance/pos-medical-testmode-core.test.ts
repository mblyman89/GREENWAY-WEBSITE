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
  medicalTestModeSaleBlock,
  medicalTestModeOffered,
  medicalTestModeMustTurnOff,
} from "@/lib/pos/medical-testmode-core";

describe("medical-testmode-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runMedicalTestModeCoreTests()).not.toThrow();
  });
});

describe("medical test-mode override", () => {
  const unendorsed = {
    products: [],
    medical: { endorsed: false, exciseExemptionUntil: "2029-06-30", registry: { p1: "general" }, testModeAllowed: true },
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

describe("Phase 0.1 (F-01-14): no real payment on simulated tax removal", () => {
  const real = {
    products: [],
    medical: { endorsed: false, exciseExemptionUntil: "2029-06-30", registry: {}, testModeAllowed: true },
  } as unknown as PosMenuBundle;
  it("test mode marks the bundle as simulated", () => {
    expect(applyMedicalTestMode(real, true).medical?.simulated).toBe(true);
  });
  it("refuses payment when the simulation removed tax", () => {
    expect(medicalTestModeSaleBlock(applyMedicalTestMode(real, true), 1)).toMatch(/TEST MODE/);
  });
  it("allows a full-tax sale in test mode and any sale with test mode off", () => {
    expect(medicalTestModeSaleBlock(applyMedicalTestMode(real, true), 0)).toBeNull();
    expect(medicalTestModeSaleBlock(real, 999)).toBeNull();
  });
  it("the server sync re-checks the real endorsement", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/pos/sync-store.ts", "utf8");
    expect(src).toMatch(/medicalSavingsMinor > 0[\s\S]{0,200}getMedTaxSettings\(\)/);
  });
});

describe("Slice A-06 (OD-40): the owner's switch hides register test mode", () => {
  const mk = (testModeAllowed?: boolean) =>
    ({
      products: [],
      medical: { endorsed: false, exciseExemptionUntil: "2029-06-30", registry: { p1: "general" }, ...(testModeAllowed === undefined ? {} : { testModeAllowed }) },
    }) as unknown as PosMenuBundle;
  it("hidden (false) ⇒ the override does nothing and tax stays on", () => {
    const b = mk(false);
    expect(applyMedicalTestMode(b, true)).toBe(b);
    expect(applyMedicalTestMode(b, true).medical?.endorsed).toBe(false);
    expect(medicalTestModeBannerActive(b, true)).toBe(false);
    expect(medicalTestModeOffered(b)).toBe(false);
  });
  it("missing flag (older server) ⇒ fail closed", () => {
    const b = mk(undefined);
    expect(applyMedicalTestMode(b, true)).toBe(b);
    expect(medicalTestModeOffered(b)).toBe(false);
  });
  it("allowed (true) ⇒ offered and simulates", () => {
    const b = mk(true);
    expect(medicalTestModeOffered(b)).toBe(true);
    expect(applyMedicalTestMode(b, true).medical?.simulated).toBe(true);
  });
  it("a device left ON is switched OFF once a hiding bundle arrives", () => {
    expect(medicalTestModeMustTurnOff(mk(false), true)).toBe(true);
    expect(medicalTestModeMustTurnOff(mk(true), true)).toBe(false);
    expect(medicalTestModeMustTurnOff(null, true)).toBe(false);
    expect(medicalTestModeMustTurnOff(mk(false), false)).toBe(false);
  });
  it("RegisterShell hides the MORE-menu item and forces the flag off", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(site)/pos/RegisterShell.tsx", "utf8");
    expect(src).toMatch(/\{medicalTestModeAvailable \? \(\s*<button[\s\S]{0,400}onToggleMedicalTestMode\(\)/);
    // On every fresh menu download, and on boot from the cached menu.
    expect(src).toMatch(/setMenuBundle\(bundle\);[\s\S]{0,500}if \(medicalTestModeMustTurnOff\(bundle, true\)\) setMedicalTestMode\(false\)/);
    expect(src).toMatch(/setMenuBundle\(cached\);[\s\S]{0,500}if \(medicalTestModeMustTurnOff\(cached, true\)\) setMedicalTestMode\(false\)/);
  });
  it("the menu route ships the owner switch, fail closed", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/api/pos/menu/route.ts", "utf8");
    expect(src).toMatch(/testModeAllowed: endorsement\?\.registerTestModeAllowed === true/);
  });
});
