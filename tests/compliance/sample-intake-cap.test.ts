/**
 * tests/compliance/sample-intake-cap.test.ts  (H16b Samples Slice B)
 *
 * Pins the PURE decision core for the incoming trade-sample hard block at
 * manifest finalize (WAC 314-55-096(1)(f)(ii): a processor may transfer no more
 * than 120 sample units per quarter to a given retailer).
 *
 * The server helper (preflightManifestSampleCap) delegates its verdict to this
 * core, so locking the core here guarantees the finalize refuses exactly the
 * right manifests — and only when enforcement is on.
 */
import { describe, it, expect } from "vitest";
import {
  addableSampleUnits,
  evaluateIntakeSampleCap,
  __runSampleIntakeCapCoreTests,
  type IntakeSampleLine,
} from "@/lib/inventory/sample-intake-cap-core";
import type { SampleSettings } from "@/lib/compliance/trade-samples-core";

const SETTINGS: SampleSettings = {
  enforce: true,
  hardBlock: true,
  incomingUnitsPerQuarter: 120,
  outgoingUnitsPerEmployee: 30,
  maxFlowerGrams: 3.5,
  maxConcentrateGrams: 1,
  maxInfusedMg: 100,
  maxThcMgPerServing: 10,
};

function line(over: Partial<IntakeSampleLine> = {}): IntakeSampleLine {
  return {
    receivedQty: 1,
    rejectedAtDock: false,
    canActivate: true,
    alreadyRecorded: false,
    productType: "useable",
    ...over,
  };
}

describe("addable sample units — only clean, accepted, unrecorded cannabis lines count", () => {
  it("counts a clean accepted line's received qty", () => {
    expect(addableSampleUnits([line({ receivedQty: 4 })])).toBe(4);
  });
  it("skips a line refused at the dock", () => {
    expect(addableSampleUnits([line({ rejectedAtDock: true, receivedQty: 4 })])).toBe(0);
  });
  it("skips a dirty lot the activation gate would HOLD", () => {
    expect(addableSampleUnits([line({ canActivate: false, receivedQty: 4 })])).toBe(0);
  });
  it("skips a lot that already has an incoming event (idempotent re-finalize)", () => {
    expect(addableSampleUnits([line({ alreadyRecorded: true, receivedQty: 4 })])).toBe(0);
  });
  it("skips a non-cannabis line (accessory/merch → null product_type)", () => {
    expect(addableSampleUnits([line({ productType: null, receivedQty: 4 })])).toBe(0);
  });
  it("floors a zero/blank qty to at least one unit (a sample line IS a unit)", () => {
    expect(addableSampleUnits([line({ receivedQty: 0 })])).toBe(1);
  });
});

describe("hard block only when projected units EXCEED 120 and enforcement is on", () => {
  it("under cap → allowed", () => {
    const v = evaluateIntakeSampleCap({ lines: [line({ receivedQty: 10 })], usedUnits: 100, settings: SETTINGS });
    expect(v.blocked).toBe(false);
    expect(v.addUnits).toBe(10);
  });
  it("exactly at 120 → allowed (cap is inclusive)", () => {
    const v = evaluateIntakeSampleCap({ lines: [line({ receivedQty: 20 })], usedUnits: 100, settings: SETTINGS });
    expect(v.blocked).toBe(false);
  });
  it("one unit over 120 → BLOCKED with a WAC-cited message", () => {
    const v = evaluateIntakeSampleCap({ lines: [line({ receivedQty: 21 })], usedUnits: 100, settings: SETTINGS });
    expect(v.blocked).toBe(true);
    expect(v.message ?? "").toMatch(/314-55-096/);
  });
  it("over cap but warn-only (hardBlock off) → NOT blocked", () => {
    const v = evaluateIntakeSampleCap({
      lines: [line({ receivedQty: 21 })],
      usedUnits: 100,
      settings: { ...SETTINGS, hardBlock: false },
    });
    expect(v.blocked).toBe(false);
    expect(v.message).toBeNull();
  });
  it("over cap but enforcement off → NOT blocked", () => {
    const v = evaluateIntakeSampleCap({
      lines: [line({ receivedQty: 21 })],
      usedUnits: 100,
      settings: { ...SETTINGS, enforce: false },
    });
    expect(v.blocked).toBe(false);
  });
  it("a manifest with zero addable sample units is never blocked (non-sample intake unaffected)", () => {
    const v = evaluateIntakeSampleCap({
      lines: [line({ rejectedAtDock: true })],
      usedUnits: 999,
      settings: SETTINGS,
    });
    expect(v.blocked).toBe(false);
    expect(v.addUnits).toBe(0);
  });
});

describe("core self-test", () => {
  it("__runSampleIntakeCapCoreTests passes", () => {
    expect(() => __runSampleIntakeCapCoreTests()).not.toThrow();
  });
});
