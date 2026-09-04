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
  noteSocketDeviceArrival,
  noteSocketDeviceRemoval,
  socketScanOwner,
  type SocketScanRoute,
  type SocketScanState,
} from "./socket-scan-core";

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
};

export type SocketSession = {
  /** Tear down listeners and close the Capture service. Always safe. */
  stop: () => Promise<void>;
  /**
   * Does the SDK currently own scanning? The wedge listener consults this so
   * it can stand down without needing its own copy of the state.
   */
  sdkOwnsScanning: () => boolean;
};

/**
 * A session that owns nothing and does nothing, returned when there is no
 * native plugin. Returning this rather than null means the caller has no
 * special case to write and -- crucially -- `sdkOwnsScanning()` answers FALSE,
 * so the wedge keeps working exactly as it does today.
 */
function inertSession(): SocketSession {
  return {
    stop: async () => {},
    sdkOwnsScanning: () => false,
  };
}

/**
 * Start listening for Socket scans.
 *
 * Never throws and never rejects. On any failure the returned session is inert
 * and the wedge path continues to serve the register.
 */
export async function startSocketSession(
  callbacks: SocketSessionCallbacks,
): Promise<SocketSession> {
  const plugin = getSocketPlugin();
  if (!plugin) return inertSession();

  // The pure state machine. This module holds the reference; every decision
  // is made by the core.
  let state: SocketScanState = emptySocketScanState();
  let stopped = false;
  const removers: Array<() => Promise<void>> = [];

  const announceOwnership = () => {
    callbacks.onOwnershipChange?.(socketScanOwner(state) === "sdk");
  };

  const now = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

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
      callbacks.onStatus?.(
        opened?.message ??
          "Socket Capture did not open. Check the scanner is paired in Application Mode " +
            "using the Socket Mobile Companion app (a scanner left in keyboard mode is " +
            "invisible to the SDK). The register is still scanning by keyboard wedge.",
      );
      return inertSession();
    }

    const arrival = await plugin.addListener("deviceArrival", (evt) => {
      if (stopped) return;
      state = noteSocketDeviceArrival(state);
      announceOwnership();
      callbacks.onStatus?.(`Scanner connected${evt?.name ? `: ${evt.name}` : ""}.`);
    });
    removers.push(arrival.remove);

    const removal = await plugin.addListener("deviceRemoval", (evt) => {
      if (stopped) return;
      state = noteSocketDeviceRemoval(state);
      announceOwnership();
      // Say what the register FELL BACK TO, not just what was lost. A cashier
      // reading "scanner disconnected" mid-rush needs to know they can keep
      // selling.
      callbacks.onStatus?.(
        `Scanner disconnected${evt?.name ? `: ${evt.name}` : ""} - back to keyboard scanning.`,
      );
    });
    removers.push(removal.remove);

    const scan = await plugin.addListener("scan", (evt) => {
      if (stopped) return;
      const raw = typeof evt?.data === "string" ? evt.data : "";
      const decision = acceptSocketScan({ state, channel: "sdk", raw, nowMs: now() });
      state = decision.state;
      if (decision.accepted) {
        callbacks.onScan(decision.payload, decision.route);
      }
    });
    removers.push(scan.remove);

    const scanError = await plugin.addListener("scanError", (evt) => {
      if (stopped) return;
      callbacks.onStatus?.(evt?.message ?? "The scanner reported an error.");
    });
    removers.push(scanError.remove);

    // A page reload leaves the scanner connected but our state empty. Ask the
    // native side what is actually attached rather than assuming nothing is --
    // otherwise the wedge would stay enabled next to a live SDK scanner and
    // every scan would arrive twice.
    try {
      const status = await plugin.getStatus();
      const count = typeof status?.deviceCount === "number" ? status.deviceCount : 0;
      for (let i = 0; i < count; i++) state = noteSocketDeviceArrival(state);
      if (count > 0) announceOwnership();
    } catch {
      // Status is an optimisation, not a requirement. If it fails, the first
      // real arrival event will establish ownership anyway.
    }
  } catch (err) {
    callbacks.onStatus?.(
      err instanceof Error
        ? `Socket scanner unavailable: ${err.message}`
        : "Socket scanner unavailable.",
    );
    return inertSession();
  }

  return {
    sdkOwnsScanning: () => socketScanOwner(state) === "sdk",
    stop: async () => {
      stopped = true;
      for (const remove of removers) {
        try {
          await remove();
        } catch {
          // Teardown must not throw on the way out of a component.
        }
      }
      try {
        await plugin.close();
      } catch {
        // Same.
      }
      state = emptySocketScanState();
    },
  };
}
