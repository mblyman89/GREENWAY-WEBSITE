/**
 * Vitest mirror of the device-heartbeat-core pure self-tests (USAGE-3).
 *
 * Locks the register heartbeat-write throttle: `authenticateDevice` used to
 * UPDATE `pos_devices.last_seen_at` on every authenticated register call
 * (~5,760 writes/day/register from the 15 s interrupt poll alone). Now the
 * stamp is rewritten at most once every 60 s, and the auth SELECT carries the
 * stamp so no extra read is needed. Also pins the store wiring so the
 * throttle cannot be silently bypassed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEVICE_HEARTBEAT_WRITE_INTERVAL_MS,
  REGISTER_FASTEST_POLL_MS,
  shouldWriteDeviceHeartbeat,
  __runDeviceHeartbeatCoreTests,
} from "@/lib/pos/device-heartbeat-core";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

describe("device-heartbeat-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runDeviceHeartbeatCoreTests()).not.toThrow();
  });

  it("pins the policy values", () => {
    expect(DEVICE_HEARTBEAT_WRITE_INTERVAL_MS).toBe(60_000);
    expect(REGISTER_FASTEST_POLL_MS).toBe(15_000);
  });

  it("skips a fresh stamp and writes a missing or old one", () => {
    const now = Date.parse("2026-03-10T12:00:00.000Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(shouldWriteDeviceHeartbeat({ lastSeenAt: ago(15_000), nowMs: now })).toBe(false);
    expect(shouldWriteDeviceHeartbeat({ lastSeenAt: ago(60_000), nowMs: now })).toBe(true);
    expect(shouldWriteDeviceHeartbeat({ lastSeenAt: null, nowMs: now })).toBe(true);
    expect(shouldWriteDeviceHeartbeat({ lastSeenAt: ago(-5_000), nowMs: now })).toBe(false);
  });

  it("is wired into the pure selftest runner so CI cannot skip it", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runDeviceHeartbeatCoreTests");
    expect(runner).toMatch(/__runDeviceHeartbeatCoreTests\(\);/);
  });

  it("authenticateDevice reads last_seen_at in its auth SELECT and gates the UPDATE on the throttle", () => {
    const store = read("src/lib/pos/sync-store.ts");
    const start = store.indexOf("export async function authenticateDevice");
    expect(start).toBeGreaterThan(-1);
    const fn = store.slice(start, store.indexOf("\n}\n", start));
    expect(fn).toContain('.select("id, name, register_id, status, provision_hash, last_seen_at")');
    expect(fn).toMatch(/if \(shouldWriteDeviceHeartbeat\(\{ lastSeenAt: last_seen_at, nowMs: Date\.now\(\) \}\)\) \{/);
    // The heartbeat stamp must not leak into the returned PosDevice.
    expect(fn).toContain("const { last_seen_at, ...device } = data;");
    expect(fn).toContain("return { ok: true, device };");
    // Exactly one UPDATE path and it is inside the throttle branch.
    const updates = fn.match(/\.update\(\{ last_seen_at:/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(fn.indexOf("shouldWriteDeviceHeartbeat(")).toBeLessThan(fn.indexOf(".update({ last_seen_at:"));
  });
});
