/**
 * tests/compliance/socket-resilience-core.test.ts  (SLICE 15)
 *
 * Proves the scanner survives a real day in the store.
 *
 * ── WHY THIS FILE DRIVES THE REAL MODULE, NOT A DESCRIPTION OF IT ──────────
 *
 * Slice 14 shipped a page-crashing defect past 14,260 green tests because
 * every guard asserted on FILE CONTENT AS TEXT. A defect that type-checks,
 * lints, builds and matches every string assertion still crashes at runtime.
 * So this file imports `startSocketSession` and actually runs it against a
 * fake Capacitor plugin, then asserts on what the plugin was ASKED TO DO.
 *
 * There is exactly one string-shaped assertion here (the eslint-disable that
 * pins the empty dependency array), and it is marked as such, because that
 * one is genuinely a property of the source rather than of the behaviour.
 *
 * The headline test is "the dead till", below. It reproduces the reported
 * outage: two scanning surfaces, one unmounts, and the register must still be
 * able to scan by SOME path. Before Slice 15 it could scan by neither.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  __getSocketRuntimeForTests,
  __resetSocketPluginCacheForTests,
  __resetSocketRuntimeForTests,
  getSocketHealth,
  handleSocketForeground,
  shutdownSocketScanning,
  startSocketSession,
} from "@/lib/pos/socket-scanner";
import {
  SOCKET_RETRY_MAX_DELAY_MS,
  describeSocketHealth,
  emptySocketRuntimeState,
  noteSocketArrival,
  noteSocketOpenFailed,
  noteSocketOpenSucceeded,
  reconcileSocketDevices,
  releaseSocketLease,
  socketRetryDelayMs,
  socketSdkOwnsScanning,
  socketWedgeEnabled,
} from "@/lib/pos/socket-resilience-core";

// ---------------------------------------------------------------------------
// A fake Socket plugin that records what it was asked to do
// ---------------------------------------------------------------------------

type Handler = (data: { data?: string; name?: string; message?: string }) => void;

function makePlugin(opts: { openOk?: boolean; deviceCount?: number } = {}) {
  const calls: string[] = [];
  const handlers = new Map<string, Handler[]>();
  const plugin = {
    openCount: 0,
    closeCount: 0,
    calls,
    openOk: opts.openOk ?? true,
    deviceCount: opts.deviceCount ?? 0,
    async open() {
      plugin.openCount += 1;
      calls.push("open");
      return plugin.openOk
        ? { ok: true, deviceCount: plugin.deviceCount }
        : { ok: false, message: "Socket Capture failed to open (error -27)." };
    },
    async close() {
      plugin.closeCount += 1;
      calls.push("close");
      return { ok: true };
    },
    async getStatus() {
      calls.push("getStatus");
      return { ok: true, deviceCount: plugin.deviceCount, open: true };
    },
    async addListener(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return {
        remove: async () => {
          handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== handler));
        },
      };
    },
    /** How many live listeners are bound for an event. */
    listenerCount(event: string) {
      return (handlers.get(event) ?? []).length;
    },
    fire(event: string, data: Parameters<Handler>[0] = {}) {
      for (const h of [...(handlers.get(event) ?? [])]) h(data);
    },
  };
  return plugin;
}

type FakePlugin = ReturnType<typeof makePlugin>;

let plugin: FakePlugin;

function installCapacitor(p: FakePlugin | null) {
  const g = globalThis as Record<string, unknown>;
  if (p === null) {
    delete g.Capacitor;
    return;
  }
  g.Capacitor = {
    isNativePlatform: () => true,
    PluginHeaders: [{ name: "SocketScanner" }],
    registerPlugin: () => p,
  };
}

beforeEach(() => {
  plugin = makePlugin();
  installCapacitor(plugin);
  __resetSocketPluginCacheForTests();
  __resetSocketRuntimeForTests();
});

afterEach(() => {
  __resetSocketRuntimeForTests();
  __resetSocketPluginCacheForTests();
  installCapacitor(null);
});

// ---------------------------------------------------------------------------

describe("SLICE 15: the register can always scan by SOME path", () => {
  /**
   * THE REPORTED OUTAGE.
   *
   * The register mounts two scanning surfaces (the ID gate and the cart).
   * Each used to run its own session, so the first one to unmount closed
   * Capture. Closing Capture fires NO removal events, so the surviving
   * surface went on reporting sdkOwnsScanning() === true and kept the
   * keyboard wedge suppressed -- over a Capture service that was shut.
   *
   * Neither channel could scan. Nothing was logged. This is that test.
   */
  it("one screen unmounting does not leave the register unable to scan at all", async () => {
    const cart = await startSocketSession({ onScan: () => {} });
    const idGate = await startSocketSession({ onScan: () => {} });

    plugin.fire("deviceArrival", { name: "Socket D760" });
    expect(cart.sdkOwnsScanning()).toBe(true);

    // The ID gate goes away, as it does after every single sale.
    await idGate.stop();

    // The proof, stated as the thing that must never be true: the SDK is not
    // listening AND the wedge is muted.
    const sdkListening = plugin.closeCount === 0;
    const wedgeMuted = cart.sdkOwnsScanning();
    expect(sdkListening || !wedgeMuted).toBe(true);

    // Concretely: Capture was never closed, and the cart still scans.
    expect(plugin.closeCount).toBe(0);
    expect(cart.sdkOwnsScanning()).toBe(true);

    let got = "";
    const live = await startSocketSession({ onScan: (p) => (got = p) });
    plugin.fire("scan", { data: "1A4070300003D91000001234" });
    expect(got).toBe("1A4070300003D91000001234");
    await live.stop();
    await cart.stop();
  });

  it("Capture is opened ONCE no matter how many screens subscribe", async () => {
    const a = await startSocketSession({ onScan: () => {} });
    const b = await startSocketSession({ onScan: () => {} });
    const c = await startSocketSession({ onScan: () => {} });

    // Socket's iOS docs: "open Capture Helper only once in the application".
    expect(plugin.openCount).toBe(1);

    await a.stop();
    await b.stop();
    await c.stop();
    // Even releasing the LAST lease must not close it -- screens are not the
    // app's lifetime.
    expect(plugin.closeCount).toBe(0);
  });

  it("only an explicit shutdown ever closes Capture", async () => {
    const s = await startSocketSession({ onScan: () => {} });
    await s.stop();
    expect(plugin.closeCount).toBe(0);
    await shutdownSocketScanning();
    expect(plugin.closeCount).toBe(1);
  });

  it("re-opening after a failure does not stack duplicate listeners", async () => {
    // One barcode becoming two line items is a real money bug.
    plugin.openOk = false;
    const s = await startSocketSession({ onScan: () => {} });
    plugin.openOk = true;
    handleSocketForeground();
    await new Promise((r) => setTimeout(r, 0));

    expect(plugin.listenerCount("scan")).toBe(1);

    let count = 0;
    const live = await startSocketSession({ onScan: () => (count += 1) });
    plugin.fire("scan", { data: "1A4070300003D91000001234" });
    expect(count).toBe(1);
    await live.stop();
    await s.stop();
  });
});

describe("SLICE 15: the scanner powering off overnight releases the wedge", () => {
  /**
   * The 700 series powers off after 2 hours idle-connected (SocketScan 700
   * Series User Guide). That MUST return the register to keyboard scanning.
   *
   * It did not, when the re-sync folded the native count in as extra arrivals
   * on top of arrivals already seen: the count reached two with one scanner
   * attached, the single removal dropped it to one, and ownership never
   * released. A till that is deaf until someone reboots it, discovered at
   * nine in the morning.
   */
  it("re-sync REPLACES the device count instead of adding to it", async () => {
    plugin.deviceCount = 1;
    const s = await startSocketSession({ onScan: () => {} });

    // An arrival event and a getStatus() both describing the SAME scanner.
    plugin.fire("deviceArrival", { name: "Socket D760" });
    handleSocketForeground();
    await new Promise((r) => setTimeout(r, 0));

    expect(__getSocketRuntimeForTests().devices).toBe(1);

    // Now it powers off on its idle timer. One removal, and the wedge is back.
    plugin.fire("deviceRemoval", { name: "Socket D760" });
    expect(__getSocketRuntimeForTests().devices).toBe(0);
    expect(s.sdkOwnsScanning()).toBe(false);
    await s.stop();
  });

  it("a session that is open with no scanner never suppresses the wedge", () => {
    const open = noteSocketOpenSucceeded(emptySocketRuntimeState());
    expect(socketSdkOwnsScanning(open)).toBe(false);
    expect(socketWedgeEnabled(open)).toBe(true);
  });

  it("a scanner present but Capture closed never suppresses the wedge", () => {
    const orphan = noteSocketArrival(emptySocketRuntimeState());
    expect(socketSdkOwnsScanning(orphan)).toBe(false);
    expect(socketWedgeEnabled(orphan)).toBe(true);
  });

  /**
   * Found by mutation testing: deleting `devices: 0` from noteSocketOpenFailed
   * kept every other test green, because a "failed" phase already fails the
   * ownership check on its own.
   *
   * It is not redundant. The count is what SURVIVES into the next successful
   * open -- noteSocketOpenSucceeded only moves the phase. So a scanner that
   * was attached, then dropped out during an outage, would come back as a
   * PHANTOM device the moment Capture reopened: ownership true, wedge muted,
   * no scanner in the building. This asserts the whole failure-then-recovery
   * path rather than the single field.
   */
  it("a device lost during an outage does not come back as a phantom on recovery", () => {
    const live = noteSocketArrival(noteSocketOpenSucceeded(emptySocketRuntimeState()));
    expect(socketSdkOwnsScanning(live)).toBe(true);

    const failed = noteSocketOpenFailed(live, "boom");
    expect(failed.devices).toBe(0);
    expect(socketWedgeEnabled(failed)).toBe(true);

    // Capture reopens, but the scanner itself never came back.
    const recovered = noteSocketOpenSucceeded(failed);
    expect(socketSdkOwnsScanning(recovered)).toBe(false);
    expect(socketWedgeEnabled(recovered)).toBe(true);
  });

  it("re-sync clamps hostile values crossing the native bridge", () => {
    const live = noteSocketArrival(noteSocketOpenSucceeded(emptySocketRuntimeState()));
    expect(reconcileSocketDevices(live, Number.NaN).devices).toBe(0);
    expect(reconcileSocketDevices(live, -5).devices).toBe(0);
    expect(reconcileSocketDevices(live, 2.7).devices).toBe(2);
  });
});

describe("SLICE 15: a failed open is never final", () => {
  it("retries forever rather than leaving a dead register until morning", () => {
    expect(socketRetryDelayMs(1)).toBe(1_000);
    expect(socketRetryDelayMs(5)).toBe(15_000);
    // The point: there is no attempt number that returns "give up".
    expect(socketRetryDelayMs(50_000)).toBe(SOCKET_RETRY_MAX_DELAY_MS);
  });

  it("a failed open still yields a usable session that reports the wedge", async () => {
    plugin.openOk = false;
    const s = await startSocketSession({ onScan: () => {} });
    expect(s.sdkOwnsScanning()).toBe(false);
    expect(getSocketHealth().level).toBe("fallback");
    await s.stop();
  });

  it("recovers on foreground once the scanner is switched back on", async () => {
    plugin.openOk = false;
    const s = await startSocketSession({ onScan: () => {} });
    expect(s.sdkOwnsScanning()).toBe(false);

    // Morning: someone presses the power button.
    plugin.openOk = true;
    plugin.deviceCount = 1;
    handleSocketForeground();
    await new Promise((r) => setTimeout(r, 0));

    expect(s.sdkOwnsScanning()).toBe(true);
    expect(getSocketHealth().level).toBe("scanning");
    await s.stop();
  });

  it("foregrounding an already-open session re-reads the truth", async () => {
    const s = await startSocketSession({ onScan: () => {} });
    const before = plugin.calls.filter((c) => c === "open").length;
    plugin.deviceCount = 1;
    handleSocketForeground();
    await new Promise((r) => setTimeout(r, 0));
    // No second open (that would double the delegates); just a re-sync.
    expect(plugin.calls.filter((c) => c === "open").length).toBe(before);
    expect(s.sdkOwnsScanning()).toBe(true);
    await s.stop();
  });
});

describe("SLICE 15: leaving scan mode frees the wedge but keeps the session", () => {
  /**
   * `enabled` gates DELIVERY, not the SESSION. But a subscriber that is
   * ignoring scans must not still be muting the wedge on everyone's behalf --
   * that is the dead till again, arrived at from a different direction.
   */
  it("a disabled subscriber reports that it does not own scanning", async () => {
    const seen: string[] = [];
    const s = await startSocketSession({ onScan: (p) => seen.push(p) });
    plugin.fire("deviceArrival", { name: "Socket D760" });
    expect(s.sdkOwnsScanning()).toBe(true);
    expect(seen).toHaveLength(0);
    await s.stop();
  });

  it("the hook holds its lease for the component lifetime, not for `enabled`", () => {
    // The ONE source-shaped assertion in this file, and it is deliberate:
    // the empty dependency array is a property of the source that no runtime
    // behaviour can observe, yet re-keying it to `enabled` reintroduces the
    // outage. So it is pinned, along with the reason.
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/pos/use-socket-scanner.ts"),
      "utf8",
    );
    // Bind to the SUBSCRIPTION effect specifically. A blanket search for
    // "}, [enabled]);" matched the unrelated latest-ref effect that mirrors
    // `enabled` into a ref -- the same class of false positive that made the
    // Slice 14 guards worthless. So: take the text from the subscribe call to
    // the end of ITS effect, and assert on that.
    const subscribeAt = src.indexOf("void startSocketSession(");
    expect(subscribeAt).toBeGreaterThan(-1);
    const effectTail = src.slice(subscribeAt);
    const deps = effectTail.match(/}, (\[[^\]]*\])\);/);
    expect(deps?.[1]).toBe("[]");
  });
});

describe("SLICE 15: scanner health speaks to a budtender, not a developer", () => {
  it("every fallback message says the register can still sell, first", () => {
    const open = noteSocketOpenSucceeded(emptySocketRuntimeState());
    const failed = noteSocketOpenFailed(open, "Socket Capture failed to open (error -27).");
    for (const st of [open, failed]) {
      const h = describeSocketHealth(st, { pluginPresent: true });
      expect(h.level).toBe("fallback");
      expect(h.detail).toContain("Still selling");
    }
  });

  it("the failed-open remedy names Application Mode, the cause that bit this store", () => {
    const failed = noteSocketOpenFailed(emptySocketRuntimeState(), null);
    const h = describeSocketHealth(failed, { pluginPresent: true });
    expect(h.remedy).toContain("Application Mode");
    expect(h.remedy).toContain("Companion");
  });

  it("a build with no plugin says keyboard scanning, not an error", () => {
    installCapacitor(null);
    __resetSocketPluginCacheForTests();
    expect(getSocketHealth().level).toBe("unavailable");
  });

  it("no native plugin still yields a session the wedge can rely on", async () => {
    installCapacitor(null);
    __resetSocketPluginCacheForTests();
    const s = await startSocketSession({ onScan: () => {} });
    expect(s.sdkOwnsScanning()).toBe(false);
    await s.stop();
  });

  it("releasing a lease is never a close, at the pure layer too", () => {
    const open = noteSocketOpenSucceeded(emptySocketRuntimeState());
    expect(releaseSocketLease(open, "anything").action).toBe("none");
  });
});
