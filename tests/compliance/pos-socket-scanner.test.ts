/**
 * SLICE 12 -- THE SOCKET BRIDGE, PINNED.
 *
 * socket-scan-core.test.ts proves the DECISIONS. This file proves the two
 * things that live outside the pure core and can only break on the iPad:
 * how the plugin is discovered, and the app identity handed to Capture.
 *
 * ═══ WHY THE DISCOVERY ORDER NEEDS A TEST OF ITS OWN ═══
 *
 * This is not a hypothetical. It already happened once, to the Star printer,
 * and it cost real time.
 *
 * getStarPlugin() originally read `Capacitor.Plugins["StarPrinter"]`. In
 * Capacitor 6+, `Capacitor.Plugins` is NOT populated by the native bridge --
 * it is populated as a SIDE EFFECT of calling `registerPlugin()` from
 * JavaScript. Nothing called it, so the lookup was permanently undefined, the
 * register concluded "no native plugin", and every print silently fell back to
 * a path iOS then blocked. The Swift side had been correct the whole time.
 *
 * `Capacitor.PluginHeaders` IS installed by the native bridge before our
 * bundle runs, so it is the honest answer to "did the native side really
 * register this". These tests pin that order for the scanner so the same bug
 * cannot be re-introduced here -- where its symptom would be even quieter: not
 * a blocked pop-up, just a scanner that never seems to arrive.
 *
 * ═══ THESE TESTS WERE WRITTEN BECAUSE MUTATION TESTING DEMANDED THEM ═══
 *
 * Both "PluginHeaders check dropped" and "appID loses its ios: prefix"
 * SURVIVED the first mutation run. Every assertion below exists to kill a
 * specific mutant that the suite previously failed to notice.
 */

import { describe, it, expect } from "vitest";

import {
  SOCKET_APP_ID,
  SOCKET_APP_KEY,
  SOCKET_DEVELOPER_ID,
  __resetSocketPluginCacheForTests,
  getSocketPlugin,
  isSocketScanningAvailable,
} from "@/lib/pos/socket-scanner";

const CAP = "Capacitor";

function withCapacitorGlobal(value: unknown, run: () => void): void {
  const g = globalThis as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(g, CAP);
  const prev = g[CAP];
  g[CAP] = value;
  try {
    run();
  } finally {
    if (had) g[CAP] = prev;
    else delete g[CAP];
  }
}

// ===========================================================================
// 1. APP IDENTITY
// ===========================================================================

describe("SLICE 12: the Socket app identity", () => {
  /**
   * THE ios: PREFIX IS LOAD-BEARING.
   *
   * Socket's documented sample is "ios:com.socketmobile.MyTestApp" -- the
   * prefix is how the framework knows which platform's bundle identifier it is
   * validating the AppKey against. Without it, openWithAppInfo fails
   * authentication and EVERY scan is lost, with an error that points at
   * credentials rather than at a missing four-character prefix.
   */
  it("declares the bundle id with the ios: prefix the SDK requires", () => {
    expect(SOCKET_APP_ID).toBe("ios:com.greenwaymarijuana.register");
    expect(SOCKET_APP_ID.startsWith("ios:")).toBe(true);
  });

  /**
   * The AppKey is a signature over the bundle ID and the developer ID. If the
   * bundle ID here ever drifts from the one in project.pbxproj, the key stops
   * matching and Capture refuses to open -- so pin the exact identifier the
   * key was issued against.
   */
  it("matches the bundle identifier the AppKey was issued for", () => {
    expect(SOCKET_APP_ID.slice("ios:".length)).toBe("com.greenwaymarijuana.register");
  });

  it("carries the developer id and app key as non-empty values", () => {
    // Not a format assertion -- only Socket can validate these. This catches
    // the realistic accident: a placeholder, or an emptied constant after a
    // find-and-replace.
    expect(SOCKET_DEVELOPER_ID.length).toBeGreaterThan(30);
    expect(SOCKET_APP_KEY.length).toBeGreaterThan(40);
    for (const value of [SOCKET_DEVELOPER_ID, SOCKET_APP_KEY]) {
      expect(value.trim()).toBe(value);
      expect(/^(todo|tbd|xxx|placeholder|your)/i.test(value)).toBe(false);
    }
  });
});

// ===========================================================================
// 2. PLUGIN DISCOVERY
// ===========================================================================

describe("SLICE 12: native plugin detection (Capacitor 8 bridge)", () => {
  it("resolves the plugin from PluginHeaders via registerPlugin", () => {
    __resetSocketPluginCacheForTests();
    const proxy = { open: () => Promise.resolve({ ok: true }) };
    let askedFor: string | null = null;

    withCapacitorGlobal(
      {
        isNativePlatform: () => true,
        // Deliberately EMPTY, exactly as the real iPad bridge leaves it.
        Plugins: {},
        PluginHeaders: [{ name: "SocketScanner" }],
        registerPlugin: (name: string) => {
          askedFor = name;
          return proxy;
        },
      },
      () => {
        expect(getSocketPlugin()).toBe(proxy);
      },
    );

    // The jsName declared in SocketScannerPlugin.swift.
    expect(askedFor).toBe("SocketScanner");
    __resetSocketPluginCacheForTests();
  });

  /**
   * THE MUTANT THIS KILLS: deleting the PluginHeaders check.
   *
   * Without it, a native build that never compiled the plugin in would still
   * be handed a proxy -- and every call on that proxy rejects. The register
   * would believe scanning was available, stand the wedge down, and scan
   * nothing at all. Failing to null here is strictly worse than having no
   * plugin, because it disables the fallback too.
   */
  it("returns null on a native build where the plugin was NOT compiled in", () => {
    __resetSocketPluginCacheForTests();
    let registerPluginCalled = false;

    withCapacitorGlobal(
      {
        isNativePlatform: () => true,
        Plugins: {},
        PluginHeaders: [{ name: "StarPrinter" }],
        registerPlugin: () => {
          registerPluginCalled = true;
          return { nope: true };
        },
      },
      () => {
        expect(getSocketPlugin()).toBeNull();
        expect(isSocketScanningAvailable()).toBe(false);
      },
    );

    // Not merely "returned null" -- it must not have ASKED. Calling
    // registerPlugin for a plugin the bridge never registered is what creates
    // the useless proxy in the first place.
    expect(registerPluginCalled).toBe(false);
    __resetSocketPluginCacheForTests();
  });

  it("returns null in a plain browser with no Capacitor at all", () => {
    __resetSocketPluginCacheForTests();
    withCapacitorGlobal(undefined, () => {
      const g = globalThis as Record<string, unknown>;
      delete g[CAP];
      expect(getSocketPlugin()).toBeNull();
    });
    __resetSocketPluginCacheForTests();
  });

  it("returns null on a web build served by Capacitor", () => {
    __resetSocketPluginCacheForTests();
    withCapacitorGlobal(
      {
        isNativePlatform: () => false,
        // Even with the header present, a web build has no native scanner.
        PluginHeaders: [{ name: "SocketScanner" }],
        registerPlugin: () => ({ open: () => Promise.resolve({ ok: true }) }),
      },
      () => {
        expect(getSocketPlugin()).toBeNull();
      },
    );
    __resetSocketPluginCacheForTests();
  });

  /**
   * The legacy `Plugins` lookup is kept as a LAST resort for any host that
   * still fills it. It must never run ahead of PluginHeaders, or it would mask
   * the authoritative answer -- which is exactly the bug being guarded.
   */
  it("prefers PluginHeaders over a legacy Plugins entry", () => {
    __resetSocketPluginCacheForTests();
    const headerProxy = { open: () => Promise.resolve({ ok: true }) };
    const legacyProxy = { open: () => Promise.resolve({ ok: false }) };

    withCapacitorGlobal(
      {
        isNativePlatform: () => true,
        Plugins: { SocketScanner: legacyProxy },
        PluginHeaders: [{ name: "SocketScanner" }],
        registerPlugin: () => headerProxy,
      },
      () => {
        expect(getSocketPlugin()).toBe(headerProxy);
      },
    );
    __resetSocketPluginCacheForTests();
  });
});
