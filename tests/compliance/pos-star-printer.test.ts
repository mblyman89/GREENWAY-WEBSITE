import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  __runStarPrinterCoreTests,
  auditStarPlist,
  chooseTransport,
  COUNTER_PRINTER,
  describePrintFailure,
  isCounterPrinterAsset,
  ONLINE_ORDER_PRINTER_ASSET_TAG,
  STAR_EA_PROTOCOL,
  STAR_PRINT_WIDTH_DOTS,
  STAR_PRINTER_IS_GRAPHICS_ONLY,
  validatePrintJob,
  type StarErrorCode,
} from "../../src/lib/pos/star-printer-core";

/**
 * SLICE 10 — receipt printing that does not throw the budtender out of the app.
 *
 * These tests read the REAL Info.plist and the REAL register source, not
 * fixtures. A fixture would only prove the validator can validate a copy of
 * itself. The regressions being guarded against are all invisible to tsc and
 * eslint, and all surface only on the iPad, in the store, mid-sale:
 *
 *   1. Info.plist loses the Star accessory protocol (very likely, because
 *      `npx cap add ios` regenerates the file from Capacitor's template).
 *      Result: the printer becomes INVISIBLE, with no error naming the cause.
 *   2. Someone reintroduces the `starpassprnt://` app switch on the sale path,
 *      undoing the entire point of this slice.
 *   3. A reprint is allowed to pop the cash drawer — a genuine cash-control
 *      problem, since a reprint moves no money.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

const infoPlist = read("ios", "App", "App", "Info.plist");
const saleFlow = read("src", "app", "pos", "SaleFlow.tsx");
const registerShell = read("src", "app", "pos", "RegisterShell.tsx");
const swiftPlugin = read("ios", "App", "App", "StarPrinterPlugin.swift");

/** The same readers the preflight uses, so this proves the real parse. */
function readAccessoryProtocols(xml: string): string[] | null {
  const block = xml.match(
    /<key>UISupportedExternalAccessoryProtocols<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  if (!block) return null;
  return [...block[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1].trim());
}

function readBluetoothUsage(xml: string): string | null {
  const m = xml.match(/<key>NSBluetoothAlwaysUsageDescription<\/key>\s*<string>([^<]*)<\/string>/);
  return m ? m[1] : null;
}

describe("pos/star-printer-core pure self-tests", () => {
  it("passes every embedded self-test", () => {
    const { passed, failed } = __runStarPrinterCoreTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(60);
  });
});

describe("Info.plist can actually reach the Star TSP143IIIBi", () => {
  it("declares the Star external accessory protocol", () => {
    // Verified from the StarXpand-SDK-iOS README, section 2.1.
    expect(readAccessoryProtocols(infoPlist)).toContain(STAR_EA_PROTOCOL);
  });

  it("explains why it wants Bluetooth", () => {
    // Since iOS 13 an app that touches Bluetooth without this key is
    // terminated by the OS — during a sale, in front of a customer.
    const usage = readBluetoothUsage(infoPlist);
    expect(usage).toBeTruthy();
    expect((usage ?? "").trim().length).toBeGreaterThan(20);
  });

  it("passes the same audit the build preflight runs", () => {
    const problems = auditStarPlist({
      externalAccessoryProtocols: readAccessoryProtocols(infoPlist),
      bluetoothUsageDescription: readBluetoothUsage(infoPlist),
    });
    expect(problems).toEqual([]);
  });

  it("keeps the SLICE 9 fixes that live in the same file", () => {
    // Both were added by the previous slice and both would be silently undone
    // by a Capacitor regeneration, so they are re-checked here.
    expect(infoPlist).toContain("<string>arm64</string>");
    expect(infoPlist).not.toContain("<string>armv7</string>");
    expect(infoPlist).toMatch(
      /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\s*\/>/,
    );
  });
});

describe("the register no longer switches apps to print", () => {
  it("has no starpassprnt app switch left on the sale path", () => {
    // The whole point of the slice. buildPassPrntUrl still exists, but only
    // inside the bridge as a fallback — never wired directly into the UI.
    expect(saleFlow).not.toContain("buildPassPrntUrl(");
    expect(registerShell).not.toContain("buildPassPrntUrl(");
  });

  it("routes printing through the native bridge instead", () => {
    expect(saleFlow).toContain('from "@/lib/pos/star-printer"');
    expect(registerShell).toContain('from "@/lib/pos/star-printer"');
  });

  it("prefers the native transport whenever it is available", () => {
    expect(
      chooseTransport({ nativePluginAvailable: true, urlSchemeAvailable: true }),
    ).toBe("native");
    // …but never dead-ends: paper still comes out on a laptop.
    expect(
      chooseTransport({ nativePluginAvailable: false, urlSchemeAvailable: true }),
    ).toBe("passprnt");
    expect(
      chooseTransport({ nativePluginAvailable: false, urlSchemeAvailable: false }),
    ).toBe("browser");
  });
});

describe("cash-drawer rules", () => {
  it("refuses to pop the drawer on a reprint", () => {
    // A reprint moves no money. Popping the till for a duplicate slip is a
    // cash-control hole, so it is rejected before reaching the hardware.
    expect(
      validatePrintJob({ html: "<p>x</p>", openDrawer: true, jobKind: "reprint" }),
    ).not.toBeNull();
    expect(
      validatePrintJob({ html: "<p>x</p>", openDrawer: false, jobKind: "reprint" }),
    ).toBeNull();
  });

  it("keeps reprints and reports drawer-free at the call sites", () => {
    expect(registerShell).toContain('printSlip(html, false, "reprint")');
  });

  it("still pops the drawer where cash genuinely moves", () => {
    expect(registerShell).toContain('printSlip(html, true, "no_sale")');
    expect(registerShell).toContain('printSlip(slipHtml, true, "refund")');
    expect(registerShell).toContain('printSlip(receiptHtml, true, "refund")');

    // The completed SALE pop lives in SaleFlow, not RegisterShell.
    //
    // It used to be asserted here as printSlip(receiptHtml, true, "sale"),
    // which was the pickup modal's own duplicate pop on the checkbox
    // "complete the sale right here" route. That route was retired (see
    // docs/slice-17-one-door-handover.md): a pickup is now handed over by
    // loading the order into a real sale, so it finishes through the SAME
    // tender path as every other sale and pops the drawer exactly once.
    //
    // Asserting the surviving call site is strictly stronger, because that
    // is the one every cash sale in the building actually goes through.
    expect(saleFlow).toContain('openDrawer: true');
    expect(saleFlow).toContain('jobKind: "sale"');
  });
});

describe("the two printers are never confused", () => {
  it("recognises the counter printer and rejects the online-order printer", () => {
    // PRN-RECEIPT-01 is a TSP143IV on Ethernet behind CloudPRNT. Printing a
    // walk-in receipt there would not fail loudly — it would print in the back.
    expect(isCounterPrinterAsset(COUNTER_PRINTER.assetTag)).toBe(true);
    expect(isCounterPrinterAsset(ONLINE_ORDER_PRINTER_ASSET_TAG)).toBe(false);
  });

  it("matches the hardware seeded in migration 0120", () => {
    const migration = read("supabase", "migrations", "0120_pos_foundation.sql");
    expect(migration).toContain(COUNTER_PRINTER.assetTag);
    expect(migration).toContain(COUNTER_PRINTER.serial);
  });
});

describe("what the budtender is told", () => {
  const codes: StarErrorCode[] = [
    "none",
    "deviceHasError",
    "printerHoldingPaper",
    "printingTimeout",
    "bluetoothUnavailable",
    "networkUnavailable",
    "notFound",
    "openFailed",
    "unknown",
  ];

  it("never leaks an SDK symbol onto the counter screen", () => {
    for (const code of codes) {
      const { message } = describePrintFailure(code);
      expect(message).not.toMatch(/StarIO10|xcframework|errorCode|undefined|null/i);
      expect(message.length).toBeGreaterThan(20);
    }
  });
});

describe("the Swift plugin honours the printer's real limits", () => {
  it("prints an image, because this model cannot print text", () => {
    // Star's manual: "TSP100III series … do not support actionPrintText
    // because these products are graphics-only printers." Sending text would
    // compile fine and print nothing.
    expect(STAR_PRINTER_IS_GRAPHICS_ONLY).toBe(true);
    expect(swiftPlugin).toContain(".actionPrintImage(");
    // Matched as a CALL (".actionPrintText(") rather than as a bare word, so
    // the header comment explaining why it is forbidden does not trip the
    // guard while a real call to it would.
    expect(swiftPlugin).not.toContain(".actionPrintText(");
  });

  it("rasterises at the same width the receipts were designed for", () => {
    expect(STAR_PRINT_WIDTH_DOTS).toBe(576);
    expect(swiftPlugin).toContain("printWidthDots = 576");
  });

  it("uses the verified drawer API", () => {
    expect(swiftPlugin).toContain("setChannel(.no1)");
    expect(swiftPlugin).toContain("setOnTime");
  });
});

/**
 * REGRESSION (owner-reported, first real iPad install).
 *
 * The register was installed on the iPad with the Swift plugin compiled in,
 * and STILL reported "Printer setup is only available on the iPad", printed
 * nothing, and popped no drawer. Every print fell through to the browser path,
 * which iOS then blocked as a pop-up.
 *
 * Cause: getStarPlugin() read `Capacitor.Plugins["StarPrinter"]`. In
 * Capacitor 6+, `Capacitor.Plugins` is NOT populated by the native bridge --
 * it is populated as a side effect of calling `registerPlugin()` from JS,
 * which this repo never did. So the lookup was permanently undefined on a
 * perfectly good native build.
 *
 * The native bridge advertises what it actually registered in
 * `Capacitor.PluginHeaders`, before our bundle runs. These tests pin that
 * behaviour so the bug cannot silently return.
 */
describe("SLICE 10 - native plugin detection (Capacitor 8 bridge)", () => {
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

  it("resolves the plugin from PluginHeaders via registerPlugin", async () => {
    const { getStarPlugin, __resetStarPluginCacheForTests } = await import(
      "@/lib/pos/star-printer"
    );
    __resetStarPluginCacheForTests();

    const proxy = { isAvailable: () => Promise.resolve({ ok: true }) };
    let askedFor: string | null = null;

    withCapacitorGlobal(
      {
        isNativePlatform: () => true,
        // Deliberately EMPTY, exactly as the real iPad bridge leaves it.
        Plugins: {},
        PluginHeaders: [{ name: "StarPrinter" }],
        registerPlugin: (name: string) => {
          askedFor = name;
          return proxy;
        },
      },
      () => {
        expect(getStarPlugin()).toBe(proxy);
      },
    );

    // The jsName declared in StarPrinterPlugin.swift.
    expect(askedFor).toBe("StarPrinter");
    __resetStarPluginCacheForTests();
  });

  it("returns null on a native build where the plugin was NOT compiled in", async () => {
    const { getStarPlugin, __resetStarPluginCacheForTests } = await import(
      "@/lib/pos/star-printer"
    );
    __resetStarPluginCacheForTests();

    withCapacitorGlobal(
      {
        isNativePlatform: () => true,
        Plugins: {},
        PluginHeaders: [{ name: "SomeOtherPlugin" }],
        registerPlugin: () => ({ nope: true }),
      },
      () => {
        // Must NOT hand back a proxy whose every call would reject.
        expect(getStarPlugin()).toBeNull();
      },
    );
    __resetStarPluginCacheForTests();
  });

  it("returns null in a plain browser with no Capacitor at all", async () => {
    const { getStarPlugin, __resetStarPluginCacheForTests } = await import(
      "@/lib/pos/star-printer"
    );
    __resetStarPluginCacheForTests();

    const g = globalThis as Record<string, unknown>;
    const had = Object.prototype.hasOwnProperty.call(g, CAP);
    const prev = g[CAP];
    delete g[CAP];
    try {
      expect(getStarPlugin()).toBeNull();
    } finally {
      if (had) g[CAP] = prev;
    }
    __resetStarPluginCacheForTests();
  });

  it("does not rely on Capacitor.Plugins being pre-populated", () => {
    // The original bug in one assertion: the source must not reach for
    // Plugins[...] as its PRIMARY lookup.
    const src = readFileSync(
      path.join(process.cwd(), "src", "lib", "pos", "star-printer.ts"),
      "utf8",
    );
    expect(src).toContain("PluginHeaders");
    expect(src).toContain("registerPlugin");
  });
});

/**
 * REGRESSION (owner-reported, second failed iPad install).
 *
 * After the PluginHeaders fix shipped, the register STILL showed "Printer
 * setup is only available on the iPad" on a freshly rebuilt app. The JS fix
 * was correct but insufficient: StarPrinterPlugin.swift existed on disk and
 * was NEVER A MEMBER OF THE XCODE TARGET, so it was never compiled, never
 * registered with the bridge, and never appeared in Capacitor.PluginHeaders.
 *
 * Why `npx cap sync ios` cannot fix this: the CLI derives
 * `packageClassList` (capacitor.config.json) by scanning INSTALLED NPM PLUGIN
 * PACKAGES only -- see @capacitor/cli/dist/util/iosplugin.js, getPluginFiles(),
 * which iterates `plugins` and reads each `plugin.rootPath`. An app-local
 * Swift file in ios/App/App/ is outside that scan forever.
 *
 * CORRECTION (round 28). The paragraph that used to sit here claimed that
 * "Capacitor's iOS bridge auto-registers any compiled class conforming to
 * CAPPlugin & CAPBridgedPlugin, so target membership is the ONLY thing that
 * was missing." That was WRONG, it was never verified, and it cost three
 * rounds of failed builds on the shop iPad.
 *
 * The bridge does no such scan. CapacitorBridge.registerPlugins() registers
 * five hard-coded core plugins plus the class NAMES in packageClassList, each
 * resolved with NSClassFromString. There is no objc_getClassList or
 * objc_copyClassList anywhere in @capacitor/ios.
 *
 * So target membership is NECESSARY BUT NOT SUFFICIENT. An app-local plugin
 * must ALSO be handed to the bridge explicitly, which is what
 * GreenwayBridgeViewController does. Both halves are pinned below.
 */
describe("SLICE 10 - StarPrinterPlugin.swift must be in the Xcode target", () => {
  const pbxproj = readFileSync(
    path.join(process.cwd(), "ios", "App", "App.xcodeproj", "project.pbxproj"),
    "utf8",
  );

  it("is declared as a file reference", () => {
    expect(pbxproj).toContain("/* StarPrinterPlugin.swift */");
  });

  it("is a member of the Sources build phase (this is what compiles it)", () => {
    // The build-phase entry is the operative one. A file can be referenced by
    // the project and shown in the navigator while still never being built.
    expect(pbxproj).toContain("/* StarPrinterPlugin.swift in Sources */");

    const sources = pbxproj.match(
      /Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section/,
    );
    expect(sources).not.toBeNull();
    expect(sources![1]).toContain("StarPrinterPlugin.swift in Sources");
  });

  it("declares the @objc name the bridge registers, matching jsName", () => {
    // findPluginClasses() in @capacitor/cli matches /@objc\(([A-Za-z0-9_-]+)\)/
    // and the bridge resolves it with NSClassFromString, so the @objc
    // annotation must be present and must name the class.
    expect(swiftPlugin).toContain("@objc(StarPrinterPlugin)");
    expect(swiftPlugin).toContain('public let jsName = "StarPrinter"');
    expect(swiftPlugin).toContain("CAPBridgedPlugin");
  });
});

/**
 * SLICE 10 - round 28. Compiling the plugin is not enough; it must be
 * REGISTERED.
 *
 * Verified against @capacitor/ios 8.x source:
 *
 *   CapacitorBridge.swift:303 registerPlugins() - registers five hard-coded
 *   core plugins, then only the class names found in capacitor.config.json's
 *   packageClassList (resolved via NSClassFromString). No class scan exists.
 *
 *   @capacitor/cli dist/util/iosplugin.js getPluginFiles() - builds that list
 *   from INSTALLED NPM PLUGIN PACKAGES only (it resolves plugin.rootPath), so
 *   ios/App/App/StarPrinterPlugin.swift can never appear in it.
 *
 *   CapacitorBridge.swift:336 registerPluginType() begins
 *   `if autoRegisterPlugins { return }`, and autoRegisterPlugins defaults to
 *   true, so that call would be a silent no-op here. registerPluginInstance()
 *   has no such guard and does call JSExport.exportJS, which is the only thing
 *   that appends to window.Capacitor.PluginHeaders.
 *
 * If any of this is undone the app still builds, still installs, and still
 * runs - it just quietly has no printer. Hence these tests.
 */
describe("SLICE 10 - the Star plugin must be REGISTERED with the bridge", () => {
  const pbxproj = readFileSync(
    path.join(process.cwd(), "ios", "App", "App.xcodeproj", "project.pbxproj"),
    "utf8",
  );
  const iosApp = path.join(process.cwd(), "ios", "App", "App");
  const bridgeVC = readFileSync(
    path.join(iosApp, "GreenwayBridgeViewController.swift"),
    "utf8",
  );
  const sceneDelegate = readFileSync(path.join(iosApp, "SceneDelegate.swift"), "utf8");
  const storyboard = readFileSync(
    path.join(iosApp, "Base.lproj", "Main.storyboard"),
    "utf8",
  );

  it("registers the plugin instance on the bridge", () => {
    expect(bridgeVC).toContain("registerPluginInstance(StarPrinterPlugin())");
  });

  it("subclasses CAPBridgeViewController and hooks capacitorDidLoad", () => {
    // capacitorDidLoad runs from loadView(), before loadWebView() is called
    // from viewDidLoad. That ordering matters: exportJS installs a
    // WKUserScript at .atDocumentStart, which only affects later loads.
    expect(bridgeVC).toContain(
      "class GreenwayBridgeViewController: CAPBridgeViewController",
    );
    expect(bridgeVC).toContain("override public func capacitorDidLoad()");
  });

  it("does NOT call registerPluginType, which is a no-op when autoRegisterPlugins is true", () => {
    // Comments are stripped first: the file DISCUSSES registerPluginType at
    // length (explaining why it would silently do nothing), and a naive
    // substring check would match that prose instead of real code.
    const code = bridgeVC
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toContain("registerPluginType");
    expect(code).toContain("registerPluginInstance");
  });

  it("is compiled into the App target", () => {
    const sources = pbxproj.match(
      /Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section/,
    );
    expect(sources).not.toBeNull();
    expect(sources![1]).toContain("GreenwayBridgeViewController.swift in Sources");
  });

  it("is what the app actually launches, in BOTH the storyboard and SceneDelegate", () => {
    // Either one left pointing at Capacitor's stock controller silently
    // removes the printer from the register.
    expect(storyboard).toContain('customClass="GreenwayBridgeViewController"');
    expect(sceneDelegate).toContain("GreenwayBridgeViewController()");
    expect(sceneDelegate).not.toContain("rootViewController = CAPBridgeViewController()");
  });
});
