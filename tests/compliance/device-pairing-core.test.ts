/**
 * tests/compliance/device-pairing-core.test.ts  (POS register rotation slice)
 *
 * Pins the rules for retiring and re-pairing register iPads: only the
 * server's exact 401 device-auth answers count as a dead pairing, a dead
 * pairing never erases anything by itself, unsynced sales can never be
 * stranded by moving the iPad to a different device id, and a revoke needs
 * a typed confirmation.
 */
import { describe, it, expect } from "vitest";
import {
  classifyDeviceAuthFailure,
  planRepair,
  canErasePairing,
  refreshedPairing,
  validateDeviceName,
  deviceActionsFor,
  isRevokeConfirmed,
  pairingProblemMessage,
  DEVICE_AUTH_ERRORS,
  __runDevicePairingCoreTests,
} from "@/lib/pos/device-pairing-core";

const A = "59768c42-aa8c-4dab-8e6e-a2e766fe16b0";
const B = "0d3c1b7e-1111-4a2b-9c3d-222233334444";

describe("dead-pairing classification", () => {
  it("recognizes the three device-auth refusals verbatim", () => {
    expect(classifyDeviceAuthFailure(401, DEVICE_AUTH_ERRORS.revoked)).toBe("revoked");
    expect(classifyDeviceAuthFailure(401, DEVICE_AUTH_ERRORS.key_rejected)).toBe("key_rejected");
    expect(classifyDeviceAuthFailure(401, DEVICE_AUTH_ERRORS.malformed)).toBe("malformed");
  });
  it("treats everything else as transient", () => {
    expect(classifyDeviceAuthFailure(503, DEVICE_AUTH_ERRORS.revoked)).toBeNull();
    expect(classifyDeviceAuthFailure(401, "No active employee for that PIN.")).toBeNull();
    expect(classifyDeviceAuthFailure(401, null)).toBeNull();
    expect(classifyDeviceAuthFailure(500, undefined)).toBeNull();
  });
  it("has a message for every problem", () => {
    for (const p of ["revoked", "key_rejected", "malformed"] as const) {
      expect(pairingProblemMessage(p).title.length).toBeGreaterThan(5);
    }
  });
});

describe("re-pair planning", () => {
  it("allows the same device id (reactivated row) even with a queue", () => {
    expect(planRepair({ currentDeviceId: A, nextDeviceId: A, unsyncedCount: 4 })).toEqual({ ok: true, sameDevice: true });
  });
  it("allows a new device id when nothing is unsynced", () => {
    expect(planRepair({ currentDeviceId: A, nextDeviceId: B, unsyncedCount: 0 })).toEqual({ ok: true, sameDevice: false });
  });
  it("refuses a new device id while unsynced sales exist", () => {
    const r = planRepair({ currentDeviceId: A, nextDeviceId: B, unsyncedCount: 3 });
    expect(r.ok).toBe(false);
  });
  it("only erases when the queue is empty", () => {
    expect(canErasePairing(0).ok).toBe(true);
    expect(canErasePairing(2).ok).toBe(false);
  });
});

describe("pairing self-heal", () => {
  it("picks up a back-office rename and rebind, keeping the key", () => {
    const cur = { deviceId: A, deviceKey: "k", name: "Old", registerId: "r1" };
    expect(refreshedPairing(cur, { name: "New name", registerId: "r2" })).toEqual({ ...cur, name: "New name", registerId: "r2" });
    expect(refreshedPairing(cur, { name: "Old", registerId: "r1" })).toBeNull();
  });
});

describe("back-office rules", () => {
  it("validates names", () => {
    expect(validateDeviceName("  Front  counter ")).toEqual({ ok: true, name: "Front counter" });
    expect(validateDeviceName("ab").ok).toBe(false);
  });
  it("offers reactivate only on revoked rows and rotate only on active rows", () => {
    expect(deviceActionsFor("revoked")).toContain("reactivate");
    expect(deviceActionsFor("revoked")).not.toContain("rotate");
    expect(deviceActionsFor("active")).toContain("revoke");
  });
  it("requires the typed revoke confirmation", () => {
    expect(isRevokeConfirmed("REVOKE")).toBe(true);
    expect(isRevokeConfirmed("")).toBe(false);
  });
  it("self-tests pass", () => {
    expect(__runDevicePairingCoreTests().failed).toBe(0);
  });
});
