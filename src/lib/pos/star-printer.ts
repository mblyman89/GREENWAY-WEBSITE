/**
 * src/lib/pos/star-printer.ts  (SLICE 10)
 *
 * The IMPURE half of native receipt printing: the thin layer that actually
 * talks to the Swift plugin, to the PassPRNT URL scheme, or to window.print().
 *
 * Every DECISION lives in ./star-printer-core.ts, which is pure and unit
 * tested. This file contains no policy at all - it is plumbing. That split is
 * what lets the printing rules be verified on a machine with no printer.
 *
 * ── WHY THE PLUGIN IS REACHED THROUGH THE GLOBAL ────────────────────────────
 *
 * Nothing else in src/ imports @capacitor/core, and this file does not either.
 * The register is built by Next/Vite for the BROWSER as well as packaged for
 * the iPad; a static import of a native-only module would pull Capacitor into
 * the web bundle for a feature the web build cannot use. Reading the global
 * that Capacitor installs at runtime keeps the browser build unchanged, and
 * has the useful property that "plugin missing" and "not a native build" are
 * detected by the same check - which is exactly how the core models it.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A CASH SALE IS NEVER BLOCKED BY A PRINTER. Nothing here throws. Every path
 * returns a PrintOutcome the caller can show and move on from.
 */

import {
  buildPassPrntUrl,
} from "./receipt-core";
import { posStorageGet, posStorageRemove, posStorageSet } from "./pos-storage";
import {
  chooseTransport,
  describeTransport,
  isValidStarPairing,
  printFailure,
  STAR_DISCOVERY_SECONDS,
  STAR_DRAWER_PULSE_MS,
  validatePrintJob,
  type PrintEnvironment,
  type PrintOutcome,
  type PrintTransport,
  type StarErrorCode,
  type StarPairing,
  type StarPrintJob,
} from "./star-printer-core";
import { sanitizeDiscoveries, type DiscoveredPrinter } from "./printer-pairing-core";

/** Shape of the Swift plugin, as declared in StarPrinterPlugin.swift. */
type StarPluginResult = {
  ok: boolean;
  code?: string;
  drawerOpened?: boolean;
  printers?: Array<{ identifier: string; model: string; interfaceType: string }>;
  available?: boolean;
  paperEmpty?: boolean;
  coverOpen?: boolean;
  hasError?: boolean;
};

type StarPlugin = {
  isAvailable(): Promise<StarPluginResult>;
  discover(opts: { seconds?: number }): Promise<StarPluginResult>;
  getStatus(opts: { identifier: string }): Promise<StarPluginResult>;
  printReceipt(opts: {
    identifier: string;
    html: string;
    openDrawer: boolean;
    drawerPulseMs: number;
  }): Promise<StarPluginResult>;
  openDrawer(opts: { identifier: string; drawerPulseMs: number }): Promise<StarPluginResult>;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
  /**
   * Installed by the NATIVE bridge before our bundle runs, listing every
   * plugin the Swift/Kotlin side registered. This is the authoritative
   * "is the plugin really there" signal - see getStarPlugin() below.
   */
  PluginHeaders?: ReadonlyArray<{ name: string }>;
  registerPlugin?: <T>(name: string, impls?: Record<string, unknown>) => T;
};

function capacitor(): CapacitorGlobal | null {
  if (typeof globalThis === "undefined") return null;
  const c = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return c ?? null;
}

/**
 * Cache the proxy once resolved.
 *
 * registerPlugin() is idempotent in Capacitor, but the pairing screen calls
 * detectPrintEnvironment() inside a useMemo on every mount, and there is no
 * reason to build a new proxy each time.
 */
let starPluginCache: StarPlugin | null = null;

/**
 * The Star plugin, or null when this is not a native build with it compiled in.
 *
 * ── WHY THIS IS NOT JUST `Capacitor.Plugins["StarPrinter"]` ──────────────────
 *
 * That was the original implementation and it was WRONG, in a way that only
 * showed up on the real iPad. In Capacitor 6+, `Capacitor.Plugins` is NOT
 * populated by the native bridge. It is populated as a SIDE EFFECT of calling
 * `registerPlugin()` from JavaScript - the proxy is inserted at the end of
 * that function and nowhere else. Nothing in this repo called registerPlugin,
 * so `Capacitor.Plugins.StarPrinter` was permanently undefined, the register
 * concluded "no native plugin", and every print silently fell back to the
 * browser path - which iOS then blocked as a pop-up.
 *
 * The Swift side was fine the whole time. `@objc(StarPrinterPlugin)` with
 * `jsName = "StarPrinter"` and CAPBridgedPlugin correctly publishes the plugin
 * to the bridge, which advertises it in `Capacitor.PluginHeaders` BEFORE our
 * bundle runs. So PluginHeaders is the honest source of truth for "did the
 * native side really register this", and registerPlugin() is the supported way
 * to obtain the callable proxy.
 *
 * Order of checks matters:
 *  1. no Capacitor global at all      -> browser. null.
 *  2. isNativePlatform() === false    -> web build. null.
 *  3. PluginHeaders lacks StarPrinter -> native build WITHOUT the plugin
 *     compiled in (e.g. the Star package was not linked). null, and the
 *     register degrades exactly as it did before rather than throwing.
 *  4. otherwise                       -> registerPlugin() for the real proxy.
 *
 * Step 3 is what keeps the "app installed but SDK missing" case honest instead
 * of handing back a proxy whose every call would reject.
 */
export function getStarPlugin(): StarPlugin | null {
  if (starPluginCache) return starPluginCache;

  const cap = capacitor();
  if (!cap) return null;
  if (typeof cap.isNativePlatform === "function" && !cap.isNativePlatform()) return null;

  // The native bridge advertises what it actually registered.
  const headers = cap.PluginHeaders;
  const declaredNatively =
    Array.isArray(headers) && headers.some((h) => h?.name === "StarPrinter");

  if (declaredNatively && typeof cap.registerPlugin === "function") {
    const plugin = cap.registerPlugin<StarPlugin>("StarPrinter");
    if (plugin) {
      starPluginCache = plugin;
      return plugin;
    }
  }

  // Fallback for any host that still fills Plugins directly. Kept last so it
  // can never mask the authoritative PluginHeaders answer above.
  const legacy = cap.Plugins?.["StarPrinter"];
  if (legacy) {
    starPluginCache = legacy as StarPlugin;
    return starPluginCache;
  }

  return null;
}

/** Test seam: drop the memoised proxy. Not used by the register at runtime. */
export function __resetStarPluginCacheForTests(): void {
  starPluginCache = null;
}

/**
 * What this device can actually do, right now.
 *
 * Deliberately measured rather than configured. A device that was working
 * yesterday can lose the native path today (a web build opened by mistake, an
 * app reinstalled without the Star package), and the register should notice by
 * itself rather than failing at the counter.
 */
export function detectPrintEnvironment(): PrintEnvironment {
  const nativePluginAvailable = getStarPlugin() !== null;
  const urlSchemeAvailable =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);
  return { nativePluginAvailable, urlSchemeAvailable };
}

/** Which way this device will print, for showing in the UI before it happens. */
export function currentTransport(): { transport: PrintTransport; note: string } {
  const transport = chooseTransport(detectPrintEnvironment());
  return { transport, note: describeTransport(transport) };
}

/**
 * Map a plugin code string onto the core's StarErrorCode.
 *
 * Anything unrecognised becomes "unknown" rather than being passed through, so
 * a future SDK code can never leak a raw symbol onto the counter screen.
 */
function toStarErrorCode(code: string | undefined): StarErrorCode {
  switch (code) {
    case "notFound":
      return "notFound";
    case "illegalDeviceState":
      // Star throws this when the HOST device's radio is off, and the manual's
      // own example checks it against bluetoothUnavailable. Bluetooth is the
      // only interface this printer uses, so that is what it means here.
      return "bluetoothUnavailable";
    case "unprintable":
      // Paper out, cover open, jam - the printer is reachable but cannot print.
      return "deviceHasError";
    case "inUse":
    case "communication":
      // The printer takes ONE connection at a time; another till or PassPRNT
      // still being attached is the usual cause, and openFailed says that.
      return "openFailed";
    case "invalidOperation":
    case "argument":
    case "badResponse":
    case "unsupportedModel":
    case "renderFailed":
    case "invalidArgument":
      return "unknown";
    default:
      return "unknown";
  }
}

/**
 * Print a receipt using the best transport this device has.
 *
 * Returns an outcome; never throws. If the native path fails for a reason that
 * more paper or a power cycle would fix, the outcome says so and says whether
 * the drawer opened - because a cash sale whose till stayed shut is a problem
 * that needs a person, not a retry.
 */
export async function printReceipt(
  job: StarPrintJob,
  printerIdentifier: string | null,
): Promise<PrintOutcome & { transport: PrintTransport }> {
  const invalid = validatePrintJob(job);
  if (invalid) {
    return {
      ok: false,
      // Our own bug or a corrupt receipt, not a hardware fault. Retrying the
      // identical job would fail identically, so it is not marked retryable.
      code: "unknown",
      message: invalid,
      retryable: false,
      drawerMayBeShut: job.openDrawer,
      transport: "native",
    };
  }

  const env = detectPrintEnvironment();
  const transport = chooseTransport(env);

  if (transport === "native") {
    const plugin = getStarPlugin();
    // A native build with no saved pairing yet: fall through rather than fail,
    // so the very first sale on a new iPad still produces paper.
    if (plugin && printerIdentifier) {
      try {
        const res = await plugin.printReceipt({
          identifier: printerIdentifier,
          html: job.html,
          openDrawer: job.openDrawer,
          drawerPulseMs: STAR_DRAWER_PULSE_MS,
        });
        if (res.ok) {
          return {
            ok: true,
            usedFallback: false,
            message:
              res.drawerOpened === true
                ? "Receipt printed and the drawer is open."
                : "Receipt printed.",
            transport: "native",
          };
        }
        return { ...printFailure(toStarErrorCode(res.code), job), transport: "native" };
      } catch {
        // The bridge itself failed, which is not something the counter can fix.
        return { ...printFailure("unknown", job), transport: "native" };
      }
    }
  }

  if (transport === "passprnt" || (transport === "native" && env.urlSchemeAvailable)) {
    return printViaPassPrnt(job);
  }

  return printViaBrowser(job);
}

/** Legacy app-switch path, kept ONLY as a fallback so paper still comes out. */
function printViaPassPrnt(job: StarPrintJob): PrintOutcome & { transport: PrintTransport } {
  if (typeof window === "undefined") {
    return { ...printFailure("unknown", job), transport: "passprnt" };
  }
  const backUrl = window.location.href;
  window.location.href = buildPassPrntUrl(job.html, {
    backUrl,
    openDrawer: job.openDrawer,
  });
  // The URL scheme gives no result back, so this is optimistic by necessity -
  // one more reason it is no longer the normal path.
  return {
    ok: true,
    usedFallback: true,
    message: describeTransport("passprnt"),
    transport: "passprnt",
  };
}

/** Last resort: a print dialog. Works on a laptop; never opens a drawer. */
function printViaBrowser(job: StarPrintJob): PrintOutcome & { transport: PrintTransport } {
  if (typeof window === "undefined") {
    return { ...printFailure("unknown", job), transport: "browser" };
  }
  const w = window.open("", "_blank", "width=380,height=700");
  if (!w) {
    return {
      ok: false,
      code: "unknown",
      message:
        "The receipt window was blocked by the browser. Allow pop-ups for the register, or print from the sale history.",
      retryable: true,
      drawerMayBeShut: job.openDrawer,
      transport: "browser",
    };
  }
  w.document.write(job.html);
  w.document.close();
  w.focus();
  w.print();
  return {
    ok: true,
    usedFallback: true,
    message: describeTransport("browser"),
    transport: "browser",
  };
}

/**
 * Open the cash drawer without printing.
 *
 * Native only, by nature: the PassPRNT URL scheme couples the drawer to a
 * print job. When native is unavailable the caller is told plainly instead of
 * being left wondering why nothing happened.
 */
export async function openCashDrawer(
  printerIdentifier: string | null,
): Promise<{ ok: boolean; message: string }> {
  const plugin = getStarPlugin();
  if (!plugin || !printerIdentifier) {
    return {
      ok: false,
      message:
        "The drawer can only be opened on its own from the iPad register app. Use a no-sale slip instead.",
    };
  }
  try {
    const res = await plugin.openDrawer({
      identifier: printerIdentifier,
      drawerPulseMs: STAR_DRAWER_PULSE_MS,
    });
    if (res.ok) return { ok: true, message: "Drawer opened." };
    const failure = printFailure(toStarErrorCode(res.code), {
      html: "x",
      openDrawer: true,
      jobKind: "no_sale",
    });
    return { ok: false, message: failure.message };
  } catch {
    return { ok: false, message: "The drawer did not respond. Check that the printer is on." };
  }
}

// ---------------------------------------------------------------------------
// Remembering which printer belongs to THIS iPad
// ---------------------------------------------------------------------------

/**
 * Storage key for the paired printer's Bluetooth identifier.
 *
 * Stored PER DEVICE rather than centrally on purpose. Greenway can run more
 * than one till on one counter, and the printers sit within Bluetooth range of
 * each other. If the identifier were shared, till 2 could print till 1's
 * receipt and - much worse - pop till 1's cash drawer. Binding the pairing to
 * the iPad it was performed on makes that impossible.
 *
 * SLICE 11 renamed this from SLICE 10's "pos.star.pairedPrinterIdentifier".
 * That name was never registered in POS_STORAGE_KEYS, and plannedWrite()
 * rejects unregistered keys, so every SLICE 10 write was refused and the
 * pairing could never persist. Since nothing was ever stored under the old
 * name, the rename needs no migration; the new name also satisfies the
 * POS_STORAGE_PREFIX rule that lets a bulk cleanup find the register's keys.
 */
const PAIRED_PRINTER_KEY = "gw-pos-star-printer";

/**
 * The model, stored alongside the identifier purely so the setup screen can say
 * "TSP143IIIBi" instead of a bare port name.
 *
 * Kept in a SEPARATE key rather than folding both into one JSON value, so that
 * a corrupt or missing model can never take the identifier down with it. The
 * identifier is what prints; the model is optional decoration.
 */
const PAIRED_PRINTER_MODEL_KEY = "gw-pos-star-printer-model";

/** The identifier of this iPad's printer, or null if it was never paired. */
export function getPairedPrinterIdentifier(): string | null {
  const raw = posStorageGet(PAIRED_PRINTER_KEY);
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** The full pairing for the setup screen, or null when unpaired. */
export function getPairedPrinter(): StarPairing | null {
  const identifier = getPairedPrinterIdentifier();
  if (!identifier) return null;
  const model = (posStorageGet(PAIRED_PRINTER_MODEL_KEY) ?? "").trim();
  return { identifier, interfaceType: "bluetooth", model: model === "" ? null : model };
}

/**
 * Remember this iPad's printer after a successful pairing.
 *
 * Validated through the pure core so a malformed identifier can never be
 * written; a bad value here would fail on every future sale, long after the
 * setup screen that caused it is forgotten.
 */
export function setPairedPrinterIdentifier(identifier: string, model?: string | null): boolean {
  const trimmedModel = (model ?? "").trim();
  const pairing = {
    identifier: identifier.trim(),
    interfaceType: "bluetooth" as const,
    model: trimmedModel === "" ? null : trimmedModel,
  };
  if (!isValidStarPairing(pairing)) return false;
  posStorageSet(PAIRED_PRINTER_KEY, pairing.identifier);
  posStorageSet(PAIRED_PRINTER_MODEL_KEY, pairing.model ?? "");
  return true;
}

/**
 * Forget this iPad's printer.
 *
 * Deliberately does NOT unpair at the iOS level — that is the owner's business
 * in Settings › Bluetooth, and silently undoing it from a POS screen would be
 * rude and surprising. This only clears our choice.
 */
export function forgetPairedPrinter(): void {
  posStorageRemove(PAIRED_PRINTER_KEY);
  posStorageRemove(PAIRED_PRINTER_MODEL_KEY);
}

/**
 * Find Star printers nearby. Setup only - never on the sale path.
 *
 * The interfaceType is carried through from the plugin rather than assumed.
 * It is half of a StarConnectionSettings, and it also decides what the
 * identifier MEANS: on Bluetooth it is an iOS port name, on LAN a MAC or IP.
 * Hard-coding it here would be a guess that happens to be right today and
 * breaks silently the day a LAN printer is added.
 */
export async function discoverPrinters(
  seconds = STAR_DISCOVERY_SECONDS,
): Promise<DiscoveredPrinter[]> {
  const plugin = getStarPlugin();
  if (!plugin) return [];
  try {
    const res = await plugin.discover({ seconds });
    // sanitizeDiscoveries drops anything malformed and collapses duplicates,
    // which a Bluetooth scan can legitimately report for one printer.
    return sanitizeDiscoveries(res.printers ?? []);
  } catch {
    // A failed scan is "found nothing", not a crash. The setup screen says so.
    return [];
  }
}
