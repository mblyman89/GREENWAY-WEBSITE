/**
 * src/lib/pos/socket-scanner.ts  (SLICE 12)
 *
 * The IMPURE half of Socket Mobile scanning: the thin layer that actually
 * talks to the Swift plugin.
 *
 * Every DECISION lives in ./socket-scan-core.ts, which is pure and unit
 * tested. This file contains no policy at all -- it is plumbing. That split is
 * what lets the scanning rules be verified on a machine with no scanner, no
 * iPad and no Swift toolchain.
 *
 * ── WHY THE PLUGIN IS REACHED THROUGH THE GLOBAL ──────────────────────────
 *
 * Copied deliberately from star-printer.ts, which learned this the hard way.
 * Nothing else in src/ imports @capacitor/core and this file does not either.
 * The register is built by Next/Vite for the BROWSER as well as packaged for
 * the iPad; a static import of a native-only module would pull Capacitor into
 * the web bundle for a feature the web build cannot use. Reading the global
 * that Capacitor installs at runtime keeps the browser build unchanged, and
 * has the useful property that "plugin missing" and "not a native build" are
 * detected by the same check.
 *
 * ── THE BUG THIS RESOLUTION ORDER EXISTS TO AVOID ─────────────────────────
 *
 * The original Star implementation used `Capacitor.Plugins["StarPrinter"]` and
 * it was WRONG in a way that only appeared on the real iPad. In Capacitor 6+,
 * `Capacitor.Plugins` is NOT populated by the native bridge -- it is populated
 * as a SIDE EFFECT of calling `registerPlugin()` from JavaScript. Nothing
 * called it, so the lookup was permanently undefined and every print silently
 * fell back to a path iOS then blocked.
 *
 * `Capacitor.PluginHeaders` IS installed by the native bridge before our
 * bundle runs, so it is the honest answer to "did the native side really
 * register this", and registerPlugin() is the supported way to get the
 * callable proxy. Same order here, for the same reason.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * A SALE IS NEVER BLOCKED BY A SCANNER. Nothing here throws. If the SDK is
 * absent, unopened, or fails, the register keeps its keyboard-wedge path and
 * the cashier never sees a stack trace.
 */

import {
  acceptSocketScan,
  emptySocketScanState,
  type SocketScanRoute,
  type SocketScanState,
} from "./socket-scan-core";
import {
  acquireSocketLease,
  describeSocketHealth,
  emptySocketRuntimeState,
  noteSocketArrival,
  noteSocketOpenFailed,
  noteSocketOpenSucceeded,
  noteSocketRemoval,
  planSocketForeground,
  reconcileSocketDevices,
  releaseSocketLease,
  shutdownSocketRuntime,
  socketRetryDelayMs,
  socketSdkOwnsScanning,
  type SocketHealth,
  type SocketRuntimeState,
} from "./socket-resilience-core";

// ---------------------------------------------------------------------------
// App identity
//
// Supplied by the owner from the Socket Mobile developer portal for
// com.greenwaymarijuana.register. These three values are what
// CaptureHelper.openWithAppInfo() validates; a mismatch makes every open()
// fail with an authentication error rather than a missing-device one.
//
// NOT SECRET. The AppKey is a signature over the bundle ID and developer ID,
// and it ships inside the app binary on every device regardless -- anyone with
// the .ipa has it. Socket's own sample apps carry it in source for exactly
// this reason. It is an identity, not a credential: it grants nothing except
// the right for THIS bundle ID to talk to a Socket scanner.
//
// The `ios:` prefix on appID is required by the SDK -- it is how the framework
// knows which platform's bundle identifier it is validating against.
// ---------------------------------------------------------------------------

export const SOCKET_APP_ID = "ios:com.greenwaymarijuana.register";
export const SOCKET_DEVELOPER_ID = "2c1534fb-5da7-f111-b8dd-6045bd01d157";
export const SOCKET_APP_KEY =
  "MC4CFQCm16JdA94DfxFahniDe8FPcPJdqgIVAJRnuB2W0+t+uUoAmyJPTWCPBo6Z";

/** Shape of the Swift plugin, as declared in SocketScannerPlugin.swift. */
type SocketPluginResult = {
  ok: boolean;
  code?: string;
  message?: string;
  /** Devices connected at the moment of the call. */
  deviceCount?: number;
};

type SocketPlugin = {
  /** Open the Capture service with our app identity. Safe to call twice. */
  open(opts: { appId: string; developerId: string; appKey: string }): Promise<SocketPluginResult>;
  /** Close the Capture service. Called on unmount. */
  close(): Promise<SocketPluginResult>;
  /** Devices currently connected, for state re-sync after a reload. */
  getStatus(): Promise<SocketPluginResult>;
  addListener(
    event: "scan" | "deviceArrival" | "deviceRemoval" | "scanError",
    handler: (data: SocketScanEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
};

/** What the Swift side sends up. */
export type SocketScanEvent = {
  /** The decoded payload, for "scan". */
  data?: string;
  /** Friendly device name, for arrival/removal. */
  name?: string;
  /** Error text, for "scanError". */
  message?: string;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
  /**
   * Installed by the NATIVE bridge before our bundle runs, listing every
   * plugin the Swift side registered. Authoritative -- see below.
   */
  PluginHeaders?: ReadonlyArray<{ name: string }>;
  registerPlugin?: <T>(name: string, impls?: Record<string, unknown>) => T;
};

function capacitor(): CapacitorGlobal | null {
  if (typeof globalThis === "undefined") return null;
  const c = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return c ?? null;
}

let socketPluginCache: SocketPlugin | null = null;

/**
 * The Socket plugin, or null when this is not a native build with it compiled
 * in.
 *
 * Order of checks matters:
 *  1. no Capacitor global at all       -> browser. null.
 *  2. isNativePlatform() === false     -> web build. null.
 *  3. PluginHeaders lacks SocketScanner -> native build WITHOUT the plugin
 *     compiled in (e.g. the CaptureSDK package was not linked). null, and the
 *     register degrades to the wedge exactly as it does today rather than
 *     throwing.
 *  4. otherwise                        -> registerPlugin() for the real proxy.
 *
 * Step 3 is what keeps the "app installed but SDK missing" case honest instead
 * of handing back a proxy whose every call would reject.
 */
export function getSocketPlugin(): SocketPlugin | null {
  if (socketPluginCache) return socketPluginCache;

  const cap = capacitor();
  if (!cap) return null;
  if (typeof cap.isNativePlatform === "function" && !cap.isNativePlatform()) return null;

  const headers = cap.PluginHeaders;
  const declaredNatively =
    Array.isArray(headers) && headers.some((h) => h?.name === "SocketScanner");

  if (declaredNatively && typeof cap.registerPlugin === "function") {
    const plugin = cap.registerPlugin<SocketPlugin>("SocketScanner");
    if (plugin) {
      socketPluginCache = plugin;
      return plugin;
    }
  }

  // Fallback for any host that still fills Plugins directly. Kept LAST so it
  // can never mask the authoritative PluginHeaders answer above.
  const legacy = cap.Plugins?.["SocketScanner"];
  if (legacy) {
    socketPluginCache = legacy as SocketPlugin;
    return socketPluginCache;
  }

  return null;
}

/** Test seam: drop the memoised proxy. Not used by the register at runtime. */
export function __resetSocketPluginCacheForTests(): void {
  socketPluginCache = null;
}

/** Is native Socket scanning even possible on this device/build? */
export function isSocketScanningAvailable(): boolean {
  return getSocketPlugin() !== null;
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export type SocketSessionCallbacks = {
  /** An accepted, routed scan. */
  onScan: (payload: string, route: SocketScanRoute) => void;
  /** Ownership changed: true while a Socket scanner is connected. */
  onOwnershipChange?: (sdkOwnsScanning: boolean) => void;
  /** Human-readable status for the UI (device connected, error text). */
  onStatus?: (message: string) => void;
  /** Structured health for the scanner indicator. */
  onHealth?: (health: SocketHealth) => void;
};

export type SocketSession = {
  /**
   * Release THIS subscriber's lease.
   *
   * Named `stop` for the callers that already had it, but read the contract
   * carefully, because it changed in Slice 15 and the change IS the bug fix:
   * this releases a lease, it does NOT close the Capture service. See
   * socket-resilience-core.ts Rule 1.
   */
  stop: () => Promise<void>;
  /**
   * Does the SDK currently own scanning? The wedge listener consults this so
   * it can stand down without needing its own copy of the state.
   */
  sdkOwnsScanning: () => boolean;
};

// ---------------------------------------------------------------------------
// The runtime: ONE Capture session for the whole app
// ---------------------------------------------------------------------------

/**
 * Module-level, deliberately.
 *
 * Socket's iOS documentation states it in a comment directly above the open
 * call, in three separate samples: "open Capture Helper only once in the
 * application (in the main view controller) and pushDelegate, popDelegate
 * each time a new view requiring scanning capability is loaded or unloaded."
 *
 * The register has TWO scanning surfaces mounted at once (the ID gate and the
 * cart). Before Slice 15 each one started and stopped its own session, so
 * whichever unmounted first closed Capture underneath the other -- and since
 * closing Capture fires no removal events, the survivor went on believing it
 * owned scanning and kept the keyboard wedge suppressed. SDK shut, wedge
 * muted, no error anywhere: a register that could not scan by any means.
 *
 * Subscribers now take leases against this one runtime instead.
 */
type Subscriber = {
  id: string;
  callbacks: SocketSessionCallbacks;
};

let runtime: SocketRuntimeState = emptySocketRuntimeState();
let scanState: SocketScanState = emptySocketScanState();
let subscribers: Subscriber[] = [];
let listenerRemovers: Array<() => Promise<void>> = [];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let foregroundBound = false;
let leaseSeq = 0;

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function emit(fn: (cb: SocketSessionCallbacks) => void): void {
  // Snapshot: a callback may release its lease while we are iterating.
  for (const sub of [...subscribers]) {
    try {
      fn(sub.callbacks);
    } catch {
      // One screen's render bug must never stop another screen being told a
      // scanner arrived.
    }
  }
}

function broadcast(): void {
  const owns = socketSdkOwnsScanning(runtime);
  const health = describeSocketHealth(runtime, { pluginPresent: getSocketPlugin() !== null });
  emit((cb) => {
    cb.onOwnershipChange?.(owns);
    cb.onHealth?.(health);
  });
}

function status(message: string): void {
  emit((cb) => cb.onStatus?.(message));
}

function clearRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * Schedule another open attempt.
 *
 * There is no attempt at which this gives up. An unattended register whose
 * scanner was left off its base overnight must be scanning again within
 * seconds of someone switching it on, without anybody restarting the app.
 */
function scheduleRetry(): void {
  clearRetry();
  if (subscribers.length === 0) return;
  const delay = socketRetryDelayMs(runtime.failedOpens);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void openRuntime();
  }, delay);
}

/** Ask the native side how many devices are REALLY attached, and adopt that. */
async function resyncDevices(plugin: SocketPlugin): Promise<void> {
  try {
    const st = await plugin.getStatus();
    const count = typeof st?.deviceCount === "number" ? st.deviceCount : 0;
    // REPLACE, never add. Folding this in as extra arrivals inflates the
    // count, and an inflated count never falls back to zero when the scanner
    // powers off -- the wedge stays suppressed with nothing listening.
    runtime = reconcileSocketDevices(runtime, count);
    broadcast();
  } catch {
    // Status is an optimisation. A real arrival event will settle it.
  }
}

async function attachListeners(plugin: SocketPlugin): Promise<void> {
  const arrival = await plugin.addListener("deviceArrival", (evt) => {
    runtime = noteSocketArrival(runtime);
    broadcast();
    status(`Scanner connected${evt?.name ? `: ${evt.name}` : ""}.`);
  });
  listenerRemovers.push(arrival.remove);

  const removal = await plugin.addListener("deviceRemoval", (evt) => {
    runtime = noteSocketRemoval(runtime);
    broadcast();
    // Say what the register FELL BACK TO, not just what was lost. A cashier
    // reading "scanner disconnected" mid-rush needs to know they can keep
    // selling.
    status(
      `Scanner disconnected${evt?.name ? `: ${evt.name}` : ""} - back to keyboard scanning.`,
    );
  });
  listenerRemovers.push(removal.remove);

  const scan = await plugin.addListener("scan", (evt) => {
    const raw = typeof evt?.data === "string" ? evt.data : "";
    const decision = acceptSocketScan({ state: scanState, channel: "sdk", raw, nowMs: now() });
    scanState = decision.state;
    if (decision.accepted) {
      const { payload, route } = decision;
      emit((cb) => cb.onScan(payload, route));
    }
  });
  listenerRemovers.push(scan.remove);

  const scanError = await plugin.addListener("scanError", (evt) => {
    status(evt?.message ?? "The scanner reported an error.");
  });
  listenerRemovers.push(scanError.remove);
}

async function detachListeners(): Promise<void> {
  const removers = listenerRemovers;
  listenerRemovers = [];
  for (const remove of removers) {
    try {
      await remove();
    } catch {
      // Teardown must not throw.
    }
  }
}

/**
 * Open Capture, or re-open it after a failure.
 *
 * Never throws. Every exit path leaves the runtime in a state whose ownership
 * answer is honest, so the wedge is returned the moment the SDK is not
 * provably listening.
 */
async function openRuntime(): Promise<void> {
  const plugin = getSocketPlugin();
  if (!plugin) {
    runtime = noteSocketOpenFailed(runtime, null);
    broadcast();
    return;
  }

  try {
    const opened = await plugin.open({
      appId: SOCKET_APP_ID,
      developerId: SOCKET_DEVELOPER_ID,
      appKey: SOCKET_APP_KEY,
    });

    if (!opened?.ok) {
      // The single most likely real-world cause, named explicitly so the
      // message points at the fix instead of at us: the scanner must be paired
      // in APPLICATION MODE via the Socket Mobile Companion app. A scanner
      // still in keyboard mode will never appear to the SDK.
      const message =
        opened?.message ??
        "Socket Capture did not open. Check the scanner is paired in Application Mode " +
          "using the Socket Mobile Companion app (a scanner left in keyboard mode is " +
          "invisible to the SDK). The register is still scanning by keyboard wedge.";
      runtime = noteSocketOpenFailed(runtime, message);
      broadcast();
      status(message);
      scheduleRetry();
      return;
    }

    // Re-opening after a failure must not stack a second set of listeners --
    // that is how one barcode becomes two line items.
    await detachListeners();
    await attachListeners(plugin);

    runtime = noteSocketOpenSucceeded(runtime);
    // A web-view reload leaves the scanner connected but our state empty. Ask
    // rather than assume, or the wedge stays live next to a working SDK
    // scanner and every scan arrives twice.
    await resyncDevices(plugin);
    broadcast();
  } catch (err) {
    const message =
      err instanceof Error
        ? `Socket scanner unavailable: ${err.message}`
        : "Socket scanner unavailable.";
    runtime = noteSocketOpenFailed(runtime, message);
    broadcast();
    status(message);
    scheduleRetry();
  }
}

/**
 * Recover when the app returns to the foreground.
 *
 * Socket documents the iOS behaviour: "when the app goes to the background or
 * is inactive, the scanner will disconnect from the app... When the app
 * returns to the foreground, the OS will hand over the scanner connection,
 * and the app will receive the device arrival event again."
 *
 * That re-delivery only happens if Capture is still open -- which is why
 * Rule 1 matters -- and we do not sit and hope for it either way. This is the
 * single most valuable line of recovery in the file for the reported symptom:
 * an iPad that has been asleep on a counter since last night comes back to a
 * working scanner without anyone touching anything.
 */
export function handleSocketForeground(): void {
  if (subscribers.length === 0) return;
  const plan = planSocketForeground(runtime);
  if (plan.reopen) {
    clearRetry();
    runtime = { ...runtime, phase: "opening" };
    void openRuntime();
    return;
  }
  if (plan.resync) {
    const plugin = getSocketPlugin();
    if (plugin) void resyncDevices(plugin);
  }
}

function bindForegroundOnce(): void {
  if (foregroundBound) return;
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  foregroundBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") handleSocketForeground();
  });
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    // Capacitor emits `resume` on the document/window when iOS foregrounds the
    // app. Belt and braces with visibilitychange: whichever fires, the plan is
    // idempotent, because planSocketForeground() refuses to act on a session
    // that is already opening.
    window.addEventListener("focus", () => handleSocketForeground());
  }
}

/**
 * Subscribe to Socket scans.
 *
 * Takes a LEASE on the shared runtime. The first lease opens Capture; further
 * leases attach to the session already running. Releasing a lease NEVER closes
 * Capture -- see socket-resilience-core.ts Rule 1.
 *
 * Never throws and never rejects. If there is no native plugin the returned
 * session reports `sdkOwnsScanning() === false` forever, so the wedge path
 * continues to serve the register exactly as it does today.
 */
export async function startSocketSession(
  callbacks: SocketSessionCallbacks,
): Promise<SocketSession> {
  const id = `lease-${++leaseSeq}`;

  if (!getSocketPlugin()) {
    // Still report health so the indicator can say "keyboard scanning" rather
    // than sitting blank and looking broken.
    try {
      callbacks.onHealth?.(describeSocketHealth(runtime, { pluginPresent: false }));
    } catch {
      // A render error must not break subscription.
    }
    return { stop: async () => {}, sdkOwnsScanning: () => false };
  }

  subscribers.push({ id, callbacks });
  bindForegroundOnce();

  const decision = acquireSocketLease(runtime, id);
  runtime = decision.state;

  if (decision.action === "open") {
    await openRuntime();
  } else {
    // Joining a session that is already up: tell the newcomer where things
    // stand immediately, rather than leaving it dark until the next event.
    try {
      callbacks.onOwnershipChange?.(socketSdkOwnsScanning(runtime));
      callbacks.onHealth?.(describeSocketHealth(runtime, { pluginPresent: true }));
    } catch {
      // As above.
    }
  }

  return {
    sdkOwnsScanning: () => socketSdkOwnsScanning(runtime),
    stop: async () => {
      subscribers = subscribers.filter((s) => s.id !== id);
      const released = releaseSocketLease(runtime, id);
      runtime = released.state;
      // released.action is "none" BY DESIGN. Capture stays open across screen
      // changes; only shutdownSocketScanning() closes it.
      if (subscribers.length === 0) clearRetry();
    },
  };
}

/**
 * Close the Capture service outright.
 *
 * The ONLY path that closes it. Not called on unmount, on navigation, or when
 * leaving scan mode -- only when the app itself is going away, and by tests.
 */
export async function shutdownSocketScanning(): Promise<void> {
  clearRetry();
  const decision = shutdownSocketRuntime(runtime);
  runtime = decision.state;
  scanState = emptySocketScanState();
  subscribers = [];
  await detachListeners();
  if (decision.action === "close") {
    const plugin = getSocketPlugin();
    try {
      await plugin?.close();
    } catch {
      // Nothing useful to do at shutdown.
    }
  }
  broadcast();
}

/** Current scanner health, for a status indicator. */
export function getSocketHealth(): SocketHealth {
  return describeSocketHealth(runtime, { pluginPresent: getSocketPlugin() !== null });
}

/** Test seam: return the shared runtime to rest. Not used at runtime. */
export function __resetSocketRuntimeForTests(): void {
  clearRetry();
  runtime = emptySocketRuntimeState();
  scanState = emptySocketScanState();
  subscribers = [];
  listenerRemovers = [];
  leaseSeq = 0;
}

/** Test seam: read the shared runtime. Not used at runtime. */
export function __getSocketRuntimeForTests(): SocketRuntimeState {
  return runtime;
}
