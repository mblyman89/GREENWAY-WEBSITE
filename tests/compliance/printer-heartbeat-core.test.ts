/**
 * Vitest mirror of the printer-heartbeat-core pure self-tests (USAGE-1).
 *
 * Locks the CloudPRNT heartbeat-write throttle: the settings row is rewritten
 * at most every 40 s while the printer is idle (not on every 15 s poll), yet
 * a changed MAC or status code always writes, and two skipped intervals still
 * fit inside the 90 s online window so the Equipment dot never flickers.
 * Also pins the route wiring so the throttle cannot be silently bypassed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PRINTER_HEARTBEAT_WRITE_INTERVAL_MS,
  PRINTER_ONLINE_WINDOW_MS,
  shouldWritePrinterHeartbeat,
  __runPrinterHeartbeatCoreTests,
} from "@/lib/printing/printer-heartbeat-core";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

describe("printer-heartbeat-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runPrinterHeartbeatCoreTests()).not.toThrow();
  });

  it("pins the policy values and the safety margin", () => {
    expect(PRINTER_HEARTBEAT_WRITE_INTERVAL_MS).toBe(40_000);
    expect(PRINTER_ONLINE_WINDOW_MS).toBe(90_000);
    expect(PRINTER_HEARTBEAT_WRITE_INTERVAL_MS * 2).toBeLessThan(PRINTER_ONLINE_WINDOW_MS);
  });

  it("skips a fresh unchanged heartbeat and writes an old one", () => {
    const now = Date.parse("2026-03-10T12:00:00.000Z");
    const row = (agoMs: number) => ({
      last_poll_at: new Date(now - agoMs).toISOString(),
      printer_mac: "00:11:22:33:44:55",
      last_status_code: "200 OK",
    });
    const same = { printerMac: "00:11:22:33:44:55", statusCode: "200 OK", nowMs: now };
    expect(shouldWritePrinterHeartbeat({ current: row(15_000), ...same })).toBe(false);
    expect(shouldWritePrinterHeartbeat({ current: row(40_000), ...same })).toBe(true);
    expect(shouldWritePrinterHeartbeat({ current: null, ...same })).toBe(true);
    expect(
      shouldWritePrinterHeartbeat({ current: row(1_000), ...same, statusCode: "200 OK PaperLow" }),
    ).toBe(true);
  });

  it("is wired into the pure selftest runner so CI cannot skip it", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runPrinterHeartbeatCoreTests");
    expect(runner).toMatch(/__runPrinterHeartbeatCoreTests\(\);/);
  });

  it("the CloudPRNT poll passes the already-read settings row into the heartbeat", () => {
    const route = read("src/app/api/cloudprnt/route.ts");
    expect(route).toMatch(/recordHeartbeat\(\{[^}]*current: settings[^}]*\}\)/);
    // One settings read per poll: the auth step and the heartbeat share it.
    const reads = route.match(/getPrinterSettings\(\)/g) ?? [];
    expect(reads).toHaveLength(1);
    const store = read("src/lib/printing/printer-store.ts");
    expect(store).toContain("shouldWritePrinterHeartbeat(");
    expect(store).toContain("PRINTER_ONLINE_WINDOW_MS");
  });

  it("the hot printing reads name their columns instead of select(\"*\")", () => {
    const store = read("src/lib/printing/printer-store.ts");
    const fn = (name: string) => {
      const start = store.indexOf(`export async function ${name}`);
      expect(start, `${name} must exist`).toBeGreaterThan(-1);
      return store.slice(start, store.indexOf("\n}\n", start));
    };
    expect(fn("getPrinterSettings")).not.toContain('select("*")');
    expect(fn("claimNextJob")).not.toContain('select("*")');
  });

  it("the Pi printer agent rests 15 s between empty polls and re-polls at once after a job", () => {
    const agent = read("pi-agent/greenway_printer.py");
    expect(agent).toContain("IDLE_POLL_SECONDS = 15");
    expect(agent).toContain("def idle_delay_for(");
    expect(agent).toMatch(/idle_delay_for\(ok, self\.last_poll_had_job, self\.consecutive_failures\)/);
    // The served copy the installer downloads must be byte-identical.
    expect(read("public/printer/greenway_printer.py")).toBe(agent);
  });
});
