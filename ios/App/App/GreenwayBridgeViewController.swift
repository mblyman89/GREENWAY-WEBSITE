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
    }
}
