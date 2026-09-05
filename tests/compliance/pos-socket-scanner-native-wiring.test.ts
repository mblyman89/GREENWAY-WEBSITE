import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * SLICE 12 FOLLOW-UP — the native wiring that decides whether a scan is seen.
 *
 * WHY THIS FILE EXISTS
 *
 * Michael paired a Socket Mobile S720 to the iPad, confirmed with Socket's own
 * Companion app that it decodes barcodes correctly, and then scanned into the
 * register and got nothing. No error, no toast, no partial behaviour — silence.
 *
 * Two defects caused it, and every automated gate in this repository was green
 * the whole time:
 *
 *   1. SocketScannerPlugin.swift was not a member of the App target, so Xcode
 *      never compiled it.
 *   2. Nothing ever called registerPluginInstance(SocketScannerPlugin()), so
 *      even once compiled the bridge would not have known it existed.
 *
 * Neither is visible to `next build`, to vitest, or to `cap sync` — the CLI
 * only scans INSTALLED NPM PLUGIN PACKAGES for iOS sources, and ios/App/App is
 * not an npm package. And the symptom is silent BY DESIGN: socket-scanner.ts
 * treats the plugin as absent unless window.Capacitor.PluginHeaders contains a
 * "SocketScanner" entry, then falls back to the keyboard wedge rather than
 * block a sale. Correct behaviour, masking a real defect.
 *
 * The receipt printer had a guard for exactly this and the scanner did not.
 * That asymmetry is the whole story, so it is closed here permanently.
 *
 * These assertions read the REAL project files, never fixtures. A fixture would
 * only prove the checker can check a copy of itself; the risk being managed is
 * DRIFT in the actual iOS project — in particular someone re-running
 * `npx cap add ios`, which restores Capacitor's stock template and would undo
 * every one of these lines while leaving the build perfectly green.
 */

const repoRoot = path.resolve(__dirname, "..", "..");

const pbxprojPath = path.join(repoRoot, "ios", "App", "App.xcodeproj", "project.pbxproj");
const bridgeVcPath = path.join(
  repoRoot,
  "ios",
  "App",
  "App",
  "GreenwayBridgeViewController.swift",
);
const pluginPath = path.join(repoRoot, "ios", "App", "App", "SocketScannerPlugin.swift");
const preflightPath = path.join(repoRoot, "scripts", "pos", "preflight-ios-build.ts");

const pbxproj = readFileSync(pbxprojPath, "utf8");
const bridgeVc = readFileSync(bridgeVcPath, "utf8");
const plugin = readFileSync(pluginPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");

/** The Sources build phase — the list Xcode actually compiles. */
function sourcesBuildPhase(pbx: string): string {
  const block = pbx.match(
    /Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section/,
  );
  expect(block, "project.pbxproj has no PBXSourcesBuildPhase section").not.toBeNull();
  return block![1];
}

describe("SocketScannerPlugin is actually compiled", () => {
  it("is a member of the App target's Compile Sources", () => {
    // Xcode compiles target MEMBERS, not folder contents. The file sat on disk,
    // correct and complete, and was never built.
    expect(sourcesBuildPhase(pbxproj)).toContain("SocketScannerPlugin.swift in Sources");
  });

  it("has both halves of the Xcode reference, not just one", () => {
    // A build-file entry pointing at a fileRef that does not exist makes the
    // project unopenable; a fileRef with no build-file entry is the silent
    // no-compile we just shipped. Both must be present and must agree.
    const buildFile = pbxproj.match(
      /([0-9A-F]{24}) \/\* SocketScannerPlugin\.swift in Sources \*\/ = \{isa = PBXBuildFile; fileRef = ([0-9A-F]{24})/,
    );
    expect(buildFile, "no PBXBuildFile entry for SocketScannerPlugin.swift").not.toBeNull();

    const fileRefId = buildFile![2];
    expect(pbxproj).toContain(
      `${fileRefId} /* SocketScannerPlugin.swift */ = {isa = PBXFileReference;`,
    );
    expect(pbxproj).toContain("path = SocketScannerPlugin.swift;");
  });

  it("is compiled alongside the printer plugin, not instead of it", () => {
    // Guards against a future edit that "fixes" the scanner by replacing the
    // printer's membership. Both devices must work at the same counter.
    const sources = sourcesBuildPhase(pbxproj);
    expect(sources).toContain("StarPrinterPlugin.swift in Sources");
    expect(sources).toContain("GreenwayBridgeViewController.swift in Sources");
  });
});

describe("SocketScannerPlugin is actually registered with the Capacitor bridge", () => {
  it("is handed to the bridge by GreenwayBridgeViewController", () => {
    // THE line. Without it the class is compiled, correct, and invisible.
    expect(bridgeVc).toContain("registerPluginInstance(SocketScannerPlugin())");
  });

  it("registers the scanner in capacitorDidLoad, before the web view loads", () => {
    // JSExport.exportJS installs a WKUserScript at .atDocumentStart, which only
    // affects pages loaded AFTER it is added. capacitorDidLoad() runs from
    // loadView(); the page is loaded later from viewDidLoad(). Registering
    // anywhere later would compile, run, and still leave PluginHeaders empty.
    const didLoad = bridgeVc.match(
      /override public func capacitorDidLoad\(\)\s*\{([\s\S]*?)\n {4}\}/,
    );
    expect(didLoad, "capacitorDidLoad() not found in the expected shape").not.toBeNull();
    expect(didLoad![1]).toContain("registerPluginInstance(SocketScannerPlugin())");
  });

  it("uses registerPluginInstance and never registerPluginType for the scanner", () => {
    // registerPluginType begins with `if autoRegisterPlugins { return }`, and
    // autoRegisterPlugins is true here (CAPBridgeViewController never passes
    // false). It would look like a fix and do absolutely nothing.
    expect(bridgeVc).not.toContain("registerPluginType(SocketScannerPlugin");
  });

  it("still registers the printer too", () => {
    expect(bridgeVc).toContain("registerPluginInstance(StarPrinterPlugin())");
  });
});

describe("the JS and Swift sides agree on the plugin name", () => {
  // If these two strings ever drift apart, the bridge registers one name and
  // the register looks for another: PluginHeaders gets an entry, the probe in
  // socket-scanner.ts still fails, and the scanner goes silent again with
  // everything apparently wired.
  const scannerTs = readFileSync(
    path.join(repoRoot, "src", "lib", "pos", "socket-scanner.ts"),
    "utf8",
  );

  it('exposes the Swift plugin to JavaScript as "SocketScanner"', () => {
    expect(plugin).toContain('jsName = "SocketScanner"');
  });

  it("asks Capacitor for that exact same name", () => {
    // The real call is generic: cap.registerPlugin<SocketPlugin>("SocketScanner").
    expect(scannerTs).toMatch(/registerPlugin(?:<[^>]+>)?\("SocketScanner"\)/);
  });

  it("probes PluginHeaders for that exact same name", () => {
    // This probe is the reason the failure was silent rather than loud.
    expect(scannerTs).toContain('"SocketScanner"');
  });
});

describe("the S720 transport declared in Info.plist", () => {
  // Socket's own S700/S720/S730/S740 user guide, "Operating System Connection
  // Options": for Apple iOS the S720 supports Bluetooth HID and "Bluetooth
  // Apple Serial Specific (MFi Mode)", and SPP is listed as N/A. The guide also
  // states the reader ships "set to iOS Application Mode" by default. MFi means
  // the External Accessory framework, so the protocol string below is the
  // correct and sufficient declaration — the S720 is NOT a BLE reader, despite
  // the similarly-named S721 appearing in Socket's contactless product list.
  const infoPlist = readFileSync(
    path.join(repoRoot, "ios", "App", "App", "Info.plist"),
    "utf8",
  );

  it("declares the Socket Capture External Accessory protocol", () => {
    expect(infoPlist).toContain("UISupportedExternalAccessoryProtocols");
    expect(infoPlist).toContain("com.socketmobile.chs");
  });

  it("can hand off to the Companion app for pairing", () => {
    expect(infoPlist).toContain("sktcompanion");
  });
});

describe("the preflight refuses to build a register that cannot scan", () => {
  it("checks that the scanner plugin will be compiled", () => {
    expect(preflight).toContain("SocketScannerPlugin.swift in Sources");
  });

  it("checks that the scanner plugin will be registered", () => {
    expect(preflight).toContain("registerPluginInstance(SocketScannerPlugin())");
  });

  it("explains the silent-failure symptom in words Michael can act on", () => {
    // A guard that fails with "check 7 failed" teaches nothing at 9pm on a
    // Friday. The message must name the symptom he actually saw.
    expect(preflight).toMatch(/Companion/);
    expect(preflight).toMatch(/keyboard wedge/i);
  });

  it("exits non-zero so the build chain actually stops", () => {
    expect(preflight).toContain("process.exit(1)");
  });
});
