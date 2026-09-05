//
//  SocketScannerPlugin.swift  (SLICE 12)
//
//  Receives barcode scans from the store's Socket Mobile D760 as WHOLE
//  MESSAGES instead of as typed keystrokes.
//
//  ─── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
//
//  The D760 has been running in keyboard-wedge (HID) mode, where it TYPES the
//  barcode one character at a time over Bluetooth. A driver's licence PDF417
//  carries 300-1100 characters, so a single ID scan takes roughly TEN SECONDS
//  to arrive, and the burst can stall part-way through.
//
//  Slice 10 already fixed everything that was fixable on our side of that: the
//  ID capture now finalizes the instant the payload is provably gate-ready
//  rather than waiting on a fixed idle timer. The remaining ten seconds are
//  NOT our timers. They are the transport. Spelling a barcode out as
//  keystrokes is slow no matter how well we listen.
//
//  Socket's Application Mode replaces the spelling with a single delivered
//  message: the decode arrives whole, once, in milliseconds. That is the whole
//  point of this file.
//
//  ─── THE RULE THAT OUTRANKS EVERYTHING ────────────────────────────────────
//
//  A SALE IS NEVER BLOCKED BY A SCANNER.
//
//  Every method here RESOLVES with an outcome rather than rejecting into a
//  dead end. If Capture will not open, if no scanner is paired, if the service
//  errors mid-shift, the JavaScript side hears about it and the register falls
//  back to the keyboard-wedge path it has always had. A till that will not
//  sell because a scanner went flat is a worse outcome than a slow scan.
//
//  ─── WHY THE APPKEY IS IN SOURCE ──────────────────────────────────────────
//
//  It is not, in fact -- it is passed in from JavaScript (see
//  src/lib/pos/socket-scanner.ts). But it would be harmless if it were. The
//  AppKey is a signature over the bundle ID and the developer ID; it ships
//  inside the app binary on every device regardless, so anyone holding the
//  .ipa already has it. Socket's own sample applications carry it in source
//  for exactly this reason. It is an IDENTITY, not a credential: it grants
//  nothing except the right for this bundle ID to talk to a Socket scanner.
//
//  ─── HONEST DISCLOSURE ────────────────────────────────────────────────────
//
//  This file was written against Socket Mobile's official CaptureSDK iOS
//  documentation (CaptureHelper reference) and Capacitor 8's plugin protocol.
//  It has NOT been compiled, because the environment it was authored in has no
//  Swift toolchain and no Xcode -- the same disclosure Slice 10 made for the
//  Star plugin, and for the same reason. It compiles on Michael's MacBook Pro.
//  Nothing here is simulated or assumed to work; the first real proof is the
//  first barcode that lands in the register.
//
//  Verified API surface used below (from Socket's CaptureHelper reference):
//    CaptureHelper.sharedInstance                              - singleton
//    .dispatchQueue                                            - delegate queue
//    .pushDelegate(_:) / .popDelegate(_:)                      - delegate stack
//    .openWithAppInfo(_:withCompletionHandler:)                 - open
//    .closeWithCompletionHandler(_:)                            - close
//    SKTAppInfo().developerID / .appID / .appKey                - identity
//    CaptureHelperDevicePresenceDelegate
//        didNotifyArrivalForDevice(_:withResult:)
//        didNotifyRemovalForDevice(_:withResult:)
//    CaptureHelperDeviceDecodedDataDelegate
//        didReceiveDecodedData(_:fromDevice:withResult:)
//    CaptureHelperErrorDelegate
//        didReceiveError(_:)
//    SKTCaptureDecodedData.stringFromDecodedData()              - payload
//    SKTCaptureErrors.E_NOERROR                                 - success
//
//  REQUIRED SETUP THAT IS NOT CODE (see the walkthrough document):
//    1. The CaptureSDK Swift package must be added in Xcode.
//    2. Info.plist must declare com.socketmobile.chs in
//       UISupportedExternalAccessoryProtocols and sktcompanion in
//       LSApplicationQueriesSchemes.
//    3. THE SCANNER MUST BE PAIRED IN APPLICATION MODE using the Socket Mobile
//       Companion app. A scanner left in keyboard mode is INVISIBLE to this
//       plugin -- it is the single most likely reason for a first test to see
//       no scans at all, and it is not a bug in this file.
//

import Capacitor
import CaptureSDK
import Foundation

@objc(SocketScannerPlugin)
public class SocketScannerPlugin: CAPPlugin,
                                  CAPBridgedPlugin,
                                  CaptureHelperDevicePresenceDelegate,
                                  CaptureHelperDeviceDecodedDataDelegate,
                                  CaptureHelperErrorDelegate {

    public let identifier = "SocketScannerPlugin"
    public let jsName = "SocketScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    private let capture = CaptureHelper.sharedInstance

    /// Devices currently connected.
    ///
    /// A COUNT, not a flag, and mirrored on the JavaScript side for the same
    /// reason: with two scanners paired, one walking out of range must not be
    /// reported as "no scanner" while the other is still working.
    private var connectedDevices: Int = 0

    /// Guards against a double open(). Capture tolerates it, but pushing the
    /// delegate twice would deliver every scan twice, which is precisely the
    /// duplicate this slice exists to prevent.
    private var isOpen: Bool = false

    // MARK: - Open

    /// Open the Capture service with our app identity.
    ///
    /// The three identity values are supplied by JavaScript rather than baked
    /// in here, so there is exactly ONE place in the repo that states them.
    @objc func open(_ call: CAPPluginCall) {
        guard let appId = call.getString("appId"), !appId.isEmpty,
              let developerId = call.getString("developerId"), !developerId.isEmpty,
              let appKey = call.getString("appKey"), !appKey.isEmpty else {
            // Resolve, never reject: the caller decides to fall back to the
            // wedge, and a rejection would surface as an unhandled error.
            call.resolve([
                "ok": false,
                "code": "missing-app-info",
                "message": "Socket app identity was not supplied."
            ])
            return
        }

        if isOpen {
            // Already up. Answer with Capture's live list rather than our
            // tally -- a resumed app calls open() again on foreground, and
            // that call is exactly when a drifted tally would be adopted as
            // truth by the JavaScript side.
            connectedDevices = capture.getDevices().count
            call.resolve(["ok": true, "deviceCount": connectedDevices])
            return
        }

        // A retry after a failed open must not stack a second delegate on the
        // Capture stack -- two delegates deliver every barcode twice, which at
        // a register is a double charge. popDelegate is safe when we are not
        // on the stack, so this is unconditional rather than guarded by a flag
        // that could itself drift.
        capture.popDelegate(self)

        let appInfo = SKTAppInfo()
        appInfo.appID = appId
        appInfo.developerID = developerId
        appInfo.appKey = appKey

        // Deliver delegate callbacks on the main queue. The callbacks below
        // call notifyListeners, which crosses into the web view; doing that
        // from a background queue is how intermittent, unreproducible UI bugs
        // are made.
        capture.dispatchQueue = DispatchQueue.main
        capture.pushDelegate(self)

        capture.openWithAppInfo(appInfo) { [weak self] result in
            guard let self = self else { return }
            if result == SKTCaptureErrors.E_NOERROR {
                self.isOpen = true
                call.resolve(["ok": true, "deviceCount": self.connectedDevices])
            } else {
                // Undo the delegate push so a later retry starts clean rather
                // than stacking a second delegate and doubling every scan.
                self.capture.popDelegate(self)
                call.resolve([
                    "ok": false,
                    "code": "open-failed",
                    "message": "Socket Capture failed to open (error \(result.rawValue)). "
                        + "Check the scanner is paired in Application Mode using the Socket "
                        + "Mobile Companion app, and that this app's AppKey matches its "
                        + "bundle identifier."
                ])
            }
        }
    }

    // MARK: - Close

    /// Close the Capture service and stop listening. Always safe to call.
    @objc func close(_ call: CAPPluginCall) {
        guard isOpen else {
            call.resolve(["ok": true])
            return
        }
        capture.popDelegate(self)
        capture.closeWithCompletionHandler { [weak self] _ in
            self?.isOpen = false
            self?.connectedDevices = 0
            // Resolve ok regardless of the close result. There is nothing the
            // register could usefully do about a failed close, and reporting
            // it as a failure would only alarm a cashier at end of shift.
            call.resolve(["ok": true])
        }
    }

    // MARK: - Status

    /// How many scanners are attached right now.
    ///
    /// A web-view reload leaves the scanner connected but the JavaScript state
    /// empty. Without this, the register would believe no scanner was present,
    /// leave the keyboard-wedge listener enabled next to a live SDK scanner,
    /// and receive every scan twice.
    ///
    /// SLICE 15 -- ASK CAPTURE, DO NOT TRUST OUR OWN TALLY.
    ///
    /// `connectedDevices` is a counter we maintain from arrival and removal
    /// callbacks, which means it is only ever as correct as the last event we
    /// did not miss. Events ARE missed: iOS disconnects the accessory when the
    /// app is backgrounded, and an app suspended overnight can be resumed with
    /// its tally describing a scanner that powered off hours ago on its
    /// 2-hour idle timer.
    ///
    /// A tally that reads high is the worst outcome available, because the
    /// JavaScript side suppresses the keyboard wedge whenever it believes a
    /// scanner is attached. High tally plus no scanner equals a register that
    /// cannot scan by either path and says nothing about it.
    ///
    /// `getDevices()` is Capture's own live list, so it cannot drift. We
    /// reconcile the tally to it here, and the JavaScript side REPLACES its
    /// count with this number rather than adding to it.
    @objc func getStatus(_ call: CAPPluginCall) {
        guard isOpen else {
            connectedDevices = 0
            call.resolve(["ok": true, "deviceCount": 0, "open": false])
            return
        }
        let live = capture.getDevices().count
        connectedDevices = live
        call.resolve(["ok": true, "deviceCount": live, "open": true])
    }

    // MARK: - CaptureHelperDevicePresenceDelegate

    public func didNotifyArrivalForDevice(_ device: CaptureHelperDevice,
                                          withResult result: SKTResult) {
        guard result == SKTCaptureErrors.E_NOERROR else { return }
        connectedDevices += 1
        notifyListeners("deviceArrival", data: [
            "name": device.deviceInfo.name ?? "Socket scanner"
        ])
    }

    public func didNotifyRemovalForDevice(_ device: CaptureHelperDevice,
                                          withResult result: SKTResult) {
        // Clamp at zero. A removal callback arriving twice, or after teardown,
        // must not leave the count owing an arrival -- if it did, the next
        // scanner to connect would never restore SDK ownership.
        connectedDevices = max(0, connectedDevices - 1)
        notifyListeners("deviceRemoval", data: [
            "name": device.deviceInfo.name ?? "Socket scanner"
        ])
    }

    // MARK: - CaptureHelperDeviceDecodedDataDelegate

    public func didReceiveDecodedData(_ decodedData: SKTCaptureDecodedData?,
                                      fromDevice device: CaptureHelperDevice,
                                      withResult result: SKTResult) {
        guard result == SKTCaptureErrors.E_NOERROR else {
            notifyListeners("scanError", data: [
                "message": "The scanner reported a decode error (\(result.rawValue))."
            ])
            return
        }
        guard let payload = decodedData?.stringFromDecodedData(), !payload.isEmpty else {
            // A decode that yields nothing usable is reported, not silently
            // dropped: a cashier scanning an unreadable label needs to know
            // the scan was heard and rejected, not wonder if they missed.
            notifyListeners("scanError", data: [
                "message": "The scanner decoded a barcode but the data was empty."
            ])
            return
        }

        // Handed up BYTE-FOR-BYTE. The AAMVA parser splits fields on LF / CR /
        // RS (0x1e); trimming or normalising here would destroy the field
        // separators and turn every ID scan into a parse failure. All routing
        // and duplicate arbitration happens in socket-scan-core.ts, which is
        // pure and unit tested.
        notifyListeners("scan", data: ["data": payload])
    }

    // MARK: - CaptureHelperErrorDelegate

    public func didReceiveError(_ error: SKTResult) {
        notifyListeners("scanError", data: [
            "message": "Socket Capture error \(error.rawValue)."
        ])
    }
}
