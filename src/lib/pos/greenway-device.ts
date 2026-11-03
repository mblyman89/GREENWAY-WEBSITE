/**
 * src/lib/pos/greenway-device.ts  (D145 — the register's view of the iPad)
 *
 * Thin seam over the native GreenwayDevice plugin (defined and registered in
 * ios/App/App/GreenwayBridgeViewController.swift). In the browser, or in an
 * older app build without the plugin, every call answers null / false and the
 * register behaves exactly as before. Never throws.
 *
 * Same discovery rule as socket-scanner.ts: trust only window.Capacitor
 * PluginHeaders (installed by the native bridge), then registerPlugin().
 */
import { sanitizeNativeStatus, type NativeStatus } from "./ipad-setup-core";

type DevicePlugin = {
  getStatus: () => Promise<unknown>;
  setKeepAwake: (opts: { on: boolean }) => Promise<unknown>;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  PluginHeaders?: ReadonlyArray<{ name: string }>;
  registerPlugin?: <T>(name: string) => T;
};

let cache: DevicePlugin | null = null;

function plugin(): DevicePlugin | null {
  if (cache) return cache;
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap) return null;
  if (typeof cap.isNativePlatform === "function" && !cap.isNativePlatform()) return null;
  const declared = Array.isArray(cap.PluginHeaders) && cap.PluginHeaders.some((h) => h?.name === "GreenwayDevice");
  if (!declared || typeof cap.registerPlugin !== "function") return null;
  try {
    cache = cap.registerPlugin<DevicePlugin>("GreenwayDevice") ?? null;
  } catch {
    cache = null;
  }
  return cache;
}

/** Is this the packaged iPad app with the device plugin compiled in? */
export function isDeviceStatusAvailable(): boolean {
  return plugin() !== null;
}

/** The iPad's live status, or null (browser / older build / any failure). */
export async function readNativeStatus(): Promise<NativeStatus | null> {
  const p = plugin();
  if (!p) return null;
  try {
    return sanitizeNativeStatus(await p.getStatus());
  } catch {
    return null;
  }
}

/** Ask iOS to keep the screen awake (owner lockdown policy). Best-effort. */
export async function setKeepAwake(on: boolean): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    await p.setKeepAwake({ on });
    return true;
  } catch {
    return false;
  }
}

/** Test seam. */
export function __resetDevicePluginCacheForTests(): void {
  cache = null;
}
