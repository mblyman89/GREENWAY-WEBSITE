//
//  StarPrinterPlugin.swift  (SLICE 10)
//
//  Prints the receipt and kicks the cash drawer on the store's Star Micronics
//  TSP143IIIBi WITHOUT leaving the register app.
//
//  ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
//  The register used to print by setting window.location.href to a
//  "starpassprnt://" URL. iOS switched apps to do it: the register vanished,
//  Star's PassPRNT app appeared, printed, and tried to bounce back. Michael's
//  instruction was that the budtender must not be thrown out of the app.
//
//  This plugin replaces that with Star's own StarXpand SDK, talking to the
//  printer over Bluetooth from inside our own process.
//
//  ─── THE FACT THAT SHAPES THIS WHOLE FILE ────────────────────────────────────
//
//  The TSP143IIIBi CANNOT PRINT TEXT. Quoting Star's manual (Generate Printing
//  Data, Step 1, "Memo"):
//
//      "TSP100III series and TSP100IIU+ do not support actionPrintText because
//       these products are graphics-only printers. Please use the
//       actionPrintImage method."
//
//  So this plugin does NOT send text. It renders the receipt HTML to a bitmap
//  exactly 576 dots wide in an offscreen WKWebView, then sends that bitmap with
//  actionPrintImage. This is also what PassPRNT was doing for us invisibly; now
//  we own it, which is the price of not switching apps.
//
//  ─── THE RULE THAT OUTRANKS EVERYTHING ───────────────────────────────────────
//
//  A CASH SALE IS NEVER BLOCKED BY A PRINTER.
//
//  The sale is recorded and synced before any of this runs. Every method here
//  RESOLVES with an outcome rather than rejecting into a dead end, so the
//  JavaScript side can always tell the budtender what happened and move on.
//  A register that will not sell because a printer jammed is a worse outcome
//  than a customer walking out without a slip.
//
//  ─── HONEST DISCLOSURE ───────────────────────────────────────────────────────
//
//  This file was written against Star's official iOS API reference (SDK manual
//  1.13.0) and Capacitor 8's plugin protocol. It has NOT been compiled, because
//  the environment it was authored in has no Swift toolchain and no Xcode.
//  It compiles on Michael's MacBook Pro, and the walkthrough document says so
//  plainly. Nothing here is simulated or assumed to work; the first real proof
//  is the first receipt that comes out of the printer.
//
//  Verified API surface used below:
//    StarDeviceDiscoveryManagerFactory.create(interfaceTypes:)   - searchPrinter
//    manager.discoveryTime / .delegate / .startDiscovery()       - searchPrinter
//    StarConnectionSettings(interfaceType:identifier:)           - basic-step2
//    StarPrinter(settings) / open() / close() / print(command:)  - basic-step2
//    StarXpandCommand.StarXpandCommandBuilder / DocumentBuilder  - basic-step1
//    PrinterBuilder.actionPrintImage(ImageParameter(image:width:)) - basic-step1
//    PrinterBuilder.actionCut(.partial)                          - basic-step1
//    DrawerBuilder.actionOpen(OpenParameter().setChannel(.no1)
//                                            .setOnTime(_:))     - cashDrawer
//    StarIO10Error.notFound / .unprintable / .illegalDeviceState - basic-step2
//

import Capacitor
import Foundation
import StarIO10
import UIKit
import WebKit

@objc(StarPrinterPlugin)
public class StarPrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StarPrinterPlugin"
    public let jsName = "StarPrinter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printReceipt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openDrawer", returnType: CAPPluginReturnPromise)
    ]

    /// 576 dots = 72mm, the TSP100III printable width. Identical to the legacy
    /// PassPRNT `size=3`, which is what keeps receipts looking the same.
    private static let printWidthDots = 576

    /// Kept alive for the duration of a discovery run only.
    private var discoveryManager: StarDeviceDiscoveryManager?
    private var discoveryCall: CAPPluginCall?
    private var discovered: [[String: Any]] = []

    /// Strong reference to the offscreen renderer. A WKWebView that is not
    /// retained is deallocated mid-navigation and the receipt silently never
    /// finishes rendering.
    private var renderWebView: WKWebView?
    private var renderCompletion: ((UIImage?) -> Void)?

    // MARK: - Availability

    /// Lets the JavaScript side ask "is native printing really here?" instead
    /// of assuming. The web bridge uses this to decide whether to fall back.
    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true, "widthDots": Self.printWidthDots])
    }

    // MARK: - Discovery

    /// Find Star printers over Bluetooth so the owner can pick his.
    ///
    /// Discovery is only used during SETUP. Once paired, the identifier is
    /// stored and every sale connects straight to that device - important
    /// because a store with more than one till must never pop the neighbouring
    /// drawer.
    @objc func discover(_ call: CAPPluginCall) {
        let seconds = call.getInt("seconds") ?? 6

        DispatchQueue.main.async {
            self.discovered = []
            self.discoveryCall = call

            do {
                let manager = try StarDeviceDiscoveryManagerFactory.create(
                    interfaceTypes: [InterfaceType.bluetooth]
                )
                manager.discoveryTime = seconds * 1000
                manager.delegate = self
                self.discoveryManager = manager
                try manager.startDiscovery()
            } catch let error {
                self.discoveryCall = nil
                // Bluetooth switched off is the overwhelmingly likely cause and
                // it is fixable by the person holding the iPad, so say so.
                call.resolve([
                    "ok": false,
                    "code": Self.errorCode(from: error),
                    "printers": []
                ])
            }
        }
    }

    // MARK: - Status

    /// Ask the printer how it is, without printing anything.
    ///
    /// Used by the diagnostics screen and before opening the drawer, so the
    /// budtender can be told "out of paper" BEFORE a customer is waiting.
    @objc func getStatus(_ call: CAPPluginCall) {
        guard let identifier = call.getString("identifier"), !identifier.isEmpty else {
            call.resolve(["ok": false, "code": "invalidArgument"])
            return
        }

        let printer = StarPrinter(
            StarConnectionSettings(interfaceType: .bluetooth, identifier: identifier)
        )

        Task {
            do {
                try await printer.open()
                defer { Task { await printer.close() } }

                let status = try await printer.getStatus()
                call.resolve([
                    "ok": true,
                    "paperEmpty": status.paperEmpty,
                    "coverOpen": status.coverOpen,
                    "drawerOpen": status.drawerOpenCloseSignal,
                    "hasError": status.hasError
                ])
            } catch let error {
                call.resolve(["ok": false, "code": Self.errorCode(from: error)])
            }
        }
    }

    // MARK: - Printing

    /// Print a receipt, optionally kicking the drawer in the SAME document.
    ///
    /// Printing and the drawer travel together deliberately. Star's manual
    /// notes that to control the drawer alongside printing you add both a
    /// PrinterBuilder and a DrawerBuilder to one DocumentBuilder. One document
    /// means one round trip and no window where the paper cut succeeded but the
    /// drawer command was lost.
    @objc func printReceipt(_ call: CAPPluginCall) {
        guard let identifier = call.getString("identifier"), !identifier.isEmpty else {
            call.resolve(["ok": false, "code": "invalidArgument"])
            return
        }
        guard let html = call.getString("html"), !html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.resolve(["ok": false, "code": "invalidArgument"])
            return
        }
        let shouldOpenDrawer = call.getBool("openDrawer") ?? false
        let pulseMs = call.getInt("drawerPulseMs") ?? 200

        // Rasterise first. If we cannot even draw the receipt there is no point
        // waking the printer, and the failure is ours, not the hardware's.
        renderReceipt(html: html) { image in
            guard let image = image else {
                call.resolve(["ok": false, "code": "renderFailed", "drawerOpened": false])
                return
            }

            let printer = StarPrinter(
                StarConnectionSettings(interfaceType: .bluetooth, identifier: identifier)
            )

            Task {
                do {
                    let builder = StarXpandCommand.StarXpandCommandBuilder()
                    let document = StarXpandCommand.DocumentBuilder.init()

                    _ = document.addPrinter(
                        StarXpandCommand.PrinterBuilder()
                            // actionPrintImage, NOT actionPrintText - this
                            // model is graphics-only. See the header.
                            .actionPrintImage(
                                StarXpandCommand.Printer.ImageParameter(
                                    image: image,
                                    width: Self.printWidthDots
                                )
                            )
                            .actionCut(StarXpandCommand.Printer.CutType.partial)
                    )

                    if shouldOpenDrawer {
                        _ = document.addDrawer(
                            StarXpandCommand.DrawerBuilder()
                                .actionOpen(
                                    StarXpandCommand.Drawer.OpenParameter()
                                        .setChannel(.no1)
                                        .setOnTime(pulseMs)
                                )
                        )
                    }

                    _ = builder.addDocument(document)
                    let commands = builder.getCommands()

                    try await printer.open()
                    defer { Task { await printer.close() } }

                    try await printer.print(command: commands)

                    call.resolve([
                        "ok": true,
                        "drawerOpened": shouldOpenDrawer
                    ])
                } catch let error {
                    // The drawer state matters more than the paper. If a CASH
                    // sale failed to print, the till may never have opened, and
                    // the budtender needs to know that specifically.
                    call.resolve([
                        "ok": false,
                        "code": Self.errorCode(from: error),
                        "drawerOpened": false
                    ])
                }
            }
        }
    }

    // MARK: - Drawer only

    /// Open the drawer with no paper: the "no sale" case, and the one thing the
    /// old PassPRNT path could not do without also printing something.
    @objc func openDrawer(_ call: CAPPluginCall) {
        guard let identifier = call.getString("identifier"), !identifier.isEmpty else {
            call.resolve(["ok": false, "code": "invalidArgument"])
            return
        }
        let pulseMs = call.getInt("drawerPulseMs") ?? 200

        let printer = StarPrinter(
            StarConnectionSettings(interfaceType: .bluetooth, identifier: identifier)
        )

        Task {
            do {
                let builder = StarXpandCommand.StarXpandCommandBuilder()
                _ = builder.addDocument(
                    StarXpandCommand.DocumentBuilder.init()
                        .addDrawer(
                            StarXpandCommand.DrawerBuilder()
                                .actionOpen(
                                    StarXpandCommand.Drawer.OpenParameter()
                                        .setChannel(.no1)
                                        .setOnTime(pulseMs)
                                )
                        )
                )
                let commands = builder.getCommands()

                try await printer.open()
                defer { Task { await printer.close() } }

                try await printer.print(command: commands)
                call.resolve(["ok": true, "drawerOpened": true])
            } catch let error {
                call.resolve([
                    "ok": false,
                    "code": Self.errorCode(from: error),
                    "drawerOpened": false
                ])
            }
        }
    }

    // MARK: - Rasterising the receipt

    /// Render receipt HTML to a 576-dot-wide bitmap.
    ///
    /// Done in an offscreen WKWebView so the SAME HTML builder feeds the native
    /// printer, the PassPRNT fallback and the browser fallback. One receipt
    /// layout, three transports - a receipt can never differ depending on how
    /// it was printed, which matters when one of them is a tax record.
    private func renderReceipt(html: String, completion: @escaping (UIImage?) -> Void) {
        DispatchQueue.main.async {
            let config = WKWebViewConfiguration()
            let webView = WKWebView(
                frame: CGRect(x: 0, y: 0, width: CGFloat(Self.printWidthDots), height: 1),
                configuration: config
            )
            webView.isOpaque = true
            webView.backgroundColor = .white

            self.renderWebView = webView
            self.renderCompletion = completion
            webView.navigationDelegate = self
            webView.loadHTMLString(html, baseURL: nil)
        }
    }

    /// Translate a Star SDK error into a short, stable code string.
    ///
    /// The plugin deliberately does NOT build the sentence the budtender reads.
    /// That wording lives in the pure TypeScript core where it is unit-tested,
    /// so the counter never sees an SDK symbol like "illegalDeviceState".
    private static func errorCode(from error: Error) -> String {
        guard let starError = error as? StarIO10Error else { return "unknown" }

        switch starError {
        case .notFound:
            return "notFound"
        case .illegalDeviceState:
            return "illegalDeviceState"
        case .unprintable:
            return "unprintable"
        case .inUse:
            return "inUse"
        case .communication:
            return "communication"
        case .invalidOperation:
            return "invalidOperation"
        case .argument:
            return "argument"
        case .badResponse:
            return "badResponse"
        case .unsupportedModel:
            return "unsupportedModel"
        default:
            return "unknown"
        }
    }
}

// MARK: - Discovery delegate

extension StarPrinterPlugin: StarDeviceDiscoveryManagerDelegate {
    public func manager(_ manager: StarDeviceDiscoveryManager, didFind printer: StarPrinter) {
        discovered.append([
            "identifier": printer.connectionSettings.identifier,
            "model": printer.information?.model.description ?? "",
            "interfaceType": "bluetooth"
        ])
    }

    public func managerDidFinishDiscovery(_ manager: StarDeviceDiscoveryManager) {
        let call = discoveryCall
        discoveryCall = nil
        discoveryManager = nil
        call?.resolve(["ok": true, "printers": discovered])
    }
}

// MARK: - Offscreen render delegate

extension StarPrinterPlugin: WKNavigationDelegate {
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Let layout settle, then size the view to its full content height so a
        // long receipt is captured whole rather than clipped to one screen.
        webView.evaluateJavaScript("document.body.scrollHeight") { result, _ in
            let height = (result as? CGFloat) ?? 1
            webView.frame = CGRect(
                x: 0,
                y: 0,
                width: CGFloat(Self.printWidthDots),
                height: max(height, 1)
            )

            let config = WKSnapshotConfiguration()
            config.rect = webView.bounds

            webView.takeSnapshot(with: config) { image, _ in
                let completion = self.renderCompletion
                self.renderCompletion = nil
                self.renderWebView = nil
                completion?(image)
            }
        }
    }

    public func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        let completion = renderCompletion
        renderCompletion = nil
        renderWebView = nil
        completion?(nil)
    }
}
