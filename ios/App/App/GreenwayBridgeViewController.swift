//
//  GreenwayBridgeViewController.swift  (SLICE 10 — round 28 fix)
//
//  This file exists for ONE reason: to tell the Capacitor bridge that our
//  StarPrinterPlugin exists.
//
//  ─── WHY THIS IS NECESSARY (and why compiling the plugin was not enough) ───
//
//  For three rounds we assumed that Capacitor discovers plugins at runtime by
//  scanning the binary for classes conforming to `CAPPlugin & CAPBridgedPlugin`.
//  That assumption was WRONG. It is not what the bridge does.
//
//  From @capacitor/ios 8.x, CapacitorBridge.swift:303 `registerPlugins()`:
//
//      var pluginList: [AnyClass] = [CAPHttpPlugin.self, CAPConsolePlugin.self,
//                                    CAPWebViewPlugin.self, CAPCookiesPlugin.self,
//                                    CAPSystemBarsPlugin.self]
//      if autoRegisterPlugins {
//          if let pluginJSON = Bundle.main.url(forResource: "capacitor.config",
//                                              withExtension: "json") {
//              ...
//              for plugin in registrationList.packageClassList {
//                  if let pluginClass = NSClassFromString(plugin) { ... }
//              }
//          }
//      }
//
//  That is the ENTIRE discovery mechanism: five hard-coded core plugins, plus
//  whatever class NAMES are listed in `packageClassList` inside
//  capacitor.config.json. There is no `objc_getClassList`, no
//  `objc_copyClassList`, no protocol sweep anywhere in the framework — I
//  grepped the whole of @capacitor/ios for those symbols and there are none.
//
//  And `packageClassList` can never contain us. It is written by the CLI, in
//  @capacitor/cli/dist/util/iosplugin.js, whose `getPluginFiles()` does:
//
//      for (const plugin of plugins) {
//          if (plugin.ios && getPluginType(plugin, 'ios') === PluginType.Core) {
//              const pluginPath = resolve(plugin.rootPath, plugin.ios?.path);
//              ...
//          }
//      }
//
//  It iterates INSTALLED NPM PLUGIN PACKAGES and reads Swift files from inside
//  each package's own folder. `ios/App/App/` is not an npm package, so
//  StarPrinterPlugin.swift is never seen, never listed, and therefore never
//  registered — no matter how correctly it is written and no matter that it is
//  now genuinely being compiled into the target.
//
//  That is exactly the state the register was in: the class was in the binary
//  (the preflight proved it is in Compile Sources) and yet nothing on the
//  JavaScript side had ever heard of it, because `JSExport.exportJS(for:)` —
//  the only thing that pushes an entry onto `window.Capacitor.PluginHeaders` —
//  is only ever called from `registerPlugin`/`registerPluginInstance`.
//  No registration, no header, no plugin. Hence "Printer setup is only
//  available on the iPad", on the iPad.
//
//  ─── WHY registerPluginInstance AND NOT registerPluginType ───
//
//  `registerPluginType(_:)` looks like the obvious call, but it begins with:
//
//      public func registerPluginType(_ pluginType: CAPPlugin.Type) {
//          if autoRegisterPlugins { return }
//
//  `autoRegisterPlugins` defaults to `true` (CapacitorBridge.swift:204), and
//  CAPBridgeViewController never passes `false`. So registerPluginType would
//  silently do NOTHING here — it would look like a fix and change nothing,
//  which is the last thing this project needs after the last three rounds.
//
//  `registerPluginInstance(_:)` has no such guard. It stores the instance,
//  calls `load(on:)`, and — critically — calls `JSExport.exportJS(for:in:)`,
//  which is what appends our plugin to `PluginHeaders` so that the
//  `registerPlugin("StarPrinter")` call in src/lib/pos/star-printer.ts finally
//  resolves to something real.
//
//  ─── WHY capacitorDidLoad() IS THE RIGHT MOMENT ───
//
//  `JSExport.exportJS` installs a `WKUserScript` at `.atDocumentStart`. That
//  only affects pages loaded AFTER it is added, so registration must happen
//  before the web view loads. Capacitor documents `capacitorDidLoad()` as
//  "Allows any additional configuration to be performed. The `webView` and
//  `bridge` properties will be set by this point," and calls it from
//  `loadView()` (CAPBridgeViewController.swift:53), whereas the page is loaded
//  by `loadWebView()` from `viewDidLoad()`. loadView always runs before
//  viewDidLoad, so this is early enough — with the bridge already built.
//
//  ─── IF YOU EVER REGENERATE THE IOS PROJECT ───
//
//  `npx cap add ios` will restore the stock template, which points both
//  Main.storyboard and SceneDelegate at Capacitor's own CAPBridgeViewController
//  and will undo this wiring. `npm run register:build:ios` fails loudly in that
//  case: preflight check 6 verifies this file is compiled AND actually
//  referenced, so the printer cannot silently disappear again.
//

import Capacitor
import UIKit

/// The register's root view controller.
///
/// Identical to Capacitor's own bridge controller in every respect except one:
/// it hands our app-local Star printer plugin to the bridge, which the bridge
/// cannot discover by itself.
public class GreenwayBridgeViewController: CAPBridgeViewController {
    override public func capacitorDidLoad() {
        super.capacitorDidLoad()

        // The one line this entire file exists to run.
        //
        // Without it the class is compiled, correct, and completely invisible:
        // no PluginHeaders entry, no window.Capacitor.Plugins.StarPrinter, no
        // way for the budtender to pair the TSP143IIIBi, no receipt, no drawer.
        bridge?.registerPluginInstance(StarPrinterPlugin())

        // SLICE 12 FOLLOW-UP: the same line, for the scanner.
        //
        // Everything the comment block above says about StarPrinterPlugin is
        // true word-for-word of SocketScannerPlugin, and it was missed. The
        // owner paired an S720, confirmed it decodes in Socket's Companion app,
        // and then got silence in the register. That is the exact signature of
        // this omission: the JS side calls registerPlugin("SocketScanner"), and
        // src/lib/pos/socket-scanner.ts only trusts it if a matching entry
        // exists in window.Capacitor.PluginHeaders. PluginHeaders is populated
        // ONLY by JSExport.exportJS, which runs ONLY from registerPlugin /
        // registerPluginInstance. Nothing called either one for the scanner, so
        // the header never appeared, getSocketPlugin() returned null,
        // isSocketScanningAvailable() was false, and the register quietly fell
        // back to the keyboard-wedge path exactly as it is designed to.
        //
        // Nothing was broken about the scanner, the pairing, the Info.plist
        // protocol string, or the SDK. The plugin was simply never introduced
        // to the bridge.
        //
        // This is registerPluginInstance and not registerPluginType for the
        // same reason given above: registerPluginType returns immediately while
        // autoRegisterPlugins is true, which it always is here, so it would
        // look like a fix and change nothing.
        bridge?.registerPluginInstance(SocketScannerPlugin())

        // D145 (owner, 2026-11-03: "make the iPad behavior set in stone"): the
        // device-status plugin defined at the bottom of this file. It lets the
        // register report Guided Access / Low Power / charging / keep-awake to
        // the back office and keep the screen awake. Same registration rule as
        // above: registerPluginInstance, in capacitorDidLoad.
        bridge?.registerPluginInstance(GreenwayDevicePlugin())
    }

    // D144 (owner: "The iPad top menu bar with the time and such, collides
    // with our apps top menu bar"): the register is a full-screen till, so the
    // iPad status bar (clock, battery, Wi-Fi) is hidden. Belt and braces with
    // Info.plist UIStatusBarHidden and capacitor.config plugins.SystemBars
    // hidden, because CAPSystemBarsPlugin.load() would otherwise re-show it on
    // launch. The web layout also respects the safe area (pos-tokens.css), so
    // iPadOS window controls can never cover the top bar either.
    override public var prefersStatusBarHidden: Bool {
        return true
    }
}

/// D145: what the register can learn about (and do to) the iPad itself.
///
/// Lives in this file on purpose: this file is already a member of the App
/// target's Compile Sources (preflight check 6), so the plugin is compiled
/// without touching project.pbxproj, and it is registered two lines above.
/// Every method RESOLVES (never rejects) so a missing value can never surface
/// as an error at the counter; unknown values are simply left out.
@objc(GreenwayDevicePlugin)
public class GreenwayDevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GreenwayDevicePlugin"
    public let jsName = "GreenwayDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise)
    ]

    /// Guided Access, Low Power Mode, battery, keep-awake, iPadOS and app
    /// versions, free storage. UIKit state is read on the main thread.
    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let device = UIDevice.current
            device.isBatteryMonitoringEnabled = true
            var result: [String: Any] = [
                "guidedAccess": UIAccessibility.isGuidedAccessEnabled,
                "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
                "keepAwake": UIApplication.shared.isIdleTimerDisabled,
                "systemVersion": device.systemVersion
            ]
            let level = device.batteryLevel
            if level >= 0 {
                result["batteryLevel"] = Double(level)
            }
            let state = device.batteryState
            if state != .unknown {
                result["charging"] = (state == .charging || state == .full)
            }
            let info = Bundle.main.infoDictionary
            let short = info?["CFBundleShortVersionString"] as? String ?? ""
            let build = info?["CFBundleVersion"] as? String ?? ""
            result["appVersion"] = "\(short) (\(build))"
            let home = URL(fileURLWithPath: NSHomeDirectory())
            if let values = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
               let bytes = values.volumeAvailableCapacityForImportantUsage {
                result["freeDiskMb"] = Double(bytes) / 1_048_576.0
            }
            call.resolve(result)
        }
    }

    /// Keep the screen awake while the register is open (owner lockdown
    /// policy). iOS only honours this while the app is in the foreground,
    /// which, under Guided Access, is always.
    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? true
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve(["keepAwake": on])
        }
    }
}
