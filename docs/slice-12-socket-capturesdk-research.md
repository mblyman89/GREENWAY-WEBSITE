# SLICE 12 research — Socket Mobile CaptureSDK (native, in-app) for the D760

Standing rule: **never guess, never assume — build from fact, not memory.**
Every claim below carries a citation: a repo `file:line`, or a primary vendor
URL that was actually fetched during this research (not recalled).

This file is the evidence log. It was written BEFORE any code, deliberately,
because Michael asked to avoid "so many hiccups with this implementation."

---

## 0. What is actually wrong today (measured, not assumed)

The scanner works. It is a **keyboard wedge** (Basic/HID mode): the D760 types
the driver's licence into the app one keystroke at a time over Bluetooth.

The ~10 second delay Michael reports is **NOT our timers**, and it is important
to say so plainly because that was the obvious suspect and it is wrong.

Verified by reading the code:

- `src/app/pos/SaleFlow.tsx:1237` — `if (r.complete) { finalizeNow(); return; }`
  The register finalises **instantly** the moment the payload is provably a
  complete AAMVA licence. There is no waiting.
- `src/lib/pos/id-capture-core.ts:61` — `ID_CAPTURE_FALLBACK_IDLE_MS = 1200` is
  only a stall-proof fallback for a stream that ends WITHOUT ever becoming
  gate-ready. On a good scan it never fires.
- `src/lib/pos/id-scan-core.ts:380` — `isCompleteAamvaPayload()` gates on a
  parseable ANSI header plus a valid `dateOfBirth` (DBB) and `expirationDate`
  (DBA).

So the delay is the **physical HID transmission** of a 300–1100 byte PDF417
barcode, delivered as individual key events over Bluetooth Classic. Socket's own
documentation says HID is *"much slower ... for barcode symbologies encoding a
lot of data, such as many 2D barcodes"* — already quoted in the header comment of
`id-capture-core.ts`.

**Application Mode + CaptureSDK delivers the whole payload as one `NSData`
blob in a single callback.** That is the fix. Nothing about our parsing or our
timers needs to get faster, because they were never the bottleneck.

---

## 1. The SDK — verified facts

| Fact | Value | Source |
|---|---|---|
| Package name | `CaptureSDK` | `Package.swift` @ tag `2.1.22` |
| Current version | **2.1.22** | GitHub tags API |
| SPM URL | `https://github.com/SocketMobile/swift-package-capturesdk.git` | fetched |
| Default branch | `master` (NOT `main`) | GitHub repo API |
| Minimum iOS | **15.0** (`.iOS(.v15)`) | `Package.swift` |
| Our deployment target | **15.0** | `ios/App/App.xcodeproj/project.pbxproj:245,296,313,335` |
| Repo visibility | **public** | GitHub API `private: false` |
| Git-LFS | **none** (`.gitattributes` 404) | fetched |
| Device slice | `ios-arm64` present | `CaptureSDK.xcframework/Info.plist` |
| Simulator slice | `ios-arm64_x86_64-simulator` | same |
| Privacy manifest | `PrivacyInfo.xcprivacy` **ships inside the framework** | repo tree @ 2.1.22 |

**Deployment target matches exactly.** No project-wide iOS bump is required.
This is worth stating because a forced bump would have been a real risk to the
printer work that just started working.

### 1a. The transitive dependency nobody mentions on the docs site

`Package.swift` @ `2.1.22`:

```swift
dependencies: [
    .package(url: "https://github.com/SocketMobile/swift-package-swiftdecodersdk.git",
             exact: "6.7.2")
]
```

Adding CaptureSDK actually pulls **two** packages, and the second is pinned
`exact:`. Both repos are public, so no portal credentials are needed to resolve
them — but Xcode will download roughly **130 MB** of binary frameworks
(66 MB + 67 MB per the GitHub API `size` field). On a slow connection the first
resolve looks like a hang. It is not a hang.

The docs page for SPM says the SDK is *"released as a private Swift Package
Manager"* and points at the Developer Portal for the URL. **That statement is
contradicted by the repository itself, which is public.** Fact beats prose: the
URL above resolved anonymously during this research.

---

## 2. Info.plist — five required keys, we currently have one

Source: `docs.socketmobile.dev/capture/ios/en/latest/gettingStarted.html`
(items 2–6), cross-checked against the SDK's own `README.md` lines 77–143.

Current state of `ios/App/App/Info.plist`:

| Key | Required value | Status today |
|---|---|---|
| `UISupportedExternalAccessoryProtocols` | must contain `com.socketmobile.chs` | **MISSING** — array exists at `:58` but holds only `jp.star-m.starpro` |
| `NSBluetoothAlwaysUsageDescription` | any explanatory string | **PRESENT** (`:29`, added for the Star printer) |
| `CFBundleAllowMixedLocalizations` | `YES` | **MISSING** |
| `LSApplicationQueriesSchemes` | must contain `sktcompanion` | **MISSING** |
| `NSCameraUsageDescription` | any explanatory string | **MISSING** |

Two of these are the dangerous kind — the kind that cannot fail on a Mac and can
only fail in the store, mid-sale:

- **Missing `com.socketmobile.chs`** → iOS never connects the External Accessory
  session. The scanner is simply *invisible* to the app. **There is no error
  message.** This is the exact failure mode `auditStarPlist()`
  (`src/lib/pos/star-printer-core.ts:513`) already guards for the printer.
- **Missing `NSCameraUsageDescription`** → iOS **terminates the process** the
  first time anything touches the camera. CaptureSDK includes SocketCam, so the
  key is required even though we will never use camera scanning.

The existing array must be **appended to, not replaced**. Overwriting it with
`com.socketmobile.chs` would silently kill the receipt printer Michael just got
working. This is the single highest-risk edit in the slice and deserves its own
test.

---

## 3. The AppKey — a hard, non-code prerequisite

Source: `gettingStarted.html` item 7, and `socketmobile.com/developers/integrate-step-by-step`.

- **An AppKey is REQUIRED to use CaptureSDK.** Without it, `openWithAppInfo`
  fails. There is no free/degraded mode.
- It is generated from the Socket **Developer Portal**, and is derived from the
  **Developer ID** plus the **case-sensitive Bundle ID**.
- Our bundle ID: `com.greenwaymarijuana.register`
  (`src/lib/pos/capacitor-config-core.ts:93`, matching `PRODUCT_BUNDLE_IDENTIFIER`
  at `project.pbxproj:320,341`).
- The `AppID` string must be **platform-prefixed**:
  `"ios:com.greenwaymarijuana.register"` (`CaptureSDK.h:31` — *"should be set to
  the platform prefix followed by a colon and the app Bundle ID"*).
- **Validated on-device. "Internet connectivity is NOT required to use
  CaptureSDK."** Good: the register keeps working if the shop's internet drops.
- **Generated once, no expiration.**
- Obtaining one requires a **one-time Developer Community Membership fee**
  (SKU `SW1250-1463`). Activation is **per company and for life**.

> **PRICE: $19.95 plus tax — owner-confirmed at checkout, 2026-09-03.**
> Originally logged here as NOT ESTABLISHED: the product page renders its price
> only behind a logged-in store session, so the scraped page showed the SKU and
> the "Add To Cart" control but **no price string**. Per the standing rule no
> number was invented; Michael read the real figure at checkout and reported it
> back. Everything else on that page (SKU, "per company and for life", "may not
> become active for up to one business day") was read directly and is quoted
> accurately.

**Consequence for sequencing:** the SDK literally cannot open without this. It is
a purchase + a portal registration that only Michael can do. It must be surfaced
BEFORE any code is written, not discovered at the end.

---

## 4. MFi allow-listing — NOT a blocker for us right now

`gettingStarted.html` item 1 says the app must be registered in Socket's
whitelist *"before submitting your application to the Apple Store."*
`README.md:82` adds: *"Socket Mobile will handle the whitelist (MFi) application
process for you ... This has to be done once for the first version supporting the
barcode scanner."*

Michael installs directly from Xcode onto his own iPad. **Direct install is not
App Store submission**, so MFi does not block us today — exactly the same shape
as the Star printer question he asked in Round 27. It becomes required only if
the app is ever submitted to the App Store.

---

## 5. The scanner must leave HID mode

Source: `docs.socketmobile.dev/.../ConfigureInAppMode.html`.

- To be used by CaptureSDK the scanner must be in **Application Mode**
  (SPP / iAP for iOS), not Basic/HID.
- Achieved by scanning **one configuration barcode** (printed in that doc), or
  via the Socket Mobile Companion app.
- *"This configuration barcode is persistent across power cycling ... and needs
  to be scanned only once."*
- Clearing a stale pairing: turn the scanner on → press power **while** pressing
  scan → wait for it to switch off → **3 beeps** confirms the pairing was
  deleted. If you do not hear 3 beeps, repeat. Then re-pair in iOS Bluetooth
  settings; if it is already under *My Devices*, choose **Forget This Device**
  first.

The D760 product page confirms the profiles: **Basic Mode (HID) / Application
Mode (SPP) / iOS Application Mode (Default)**, Bluetooth Classic 2.1+EDR,
**MFi certified**, PDF417 in the default symbology set.

**This is a one-way door for the current wedge path.** Once the scanner is in
Application Mode it STOPS acting as a keyboard, so the existing HID capture in
`SaleFlow.tsx` receives nothing. The two modes cannot both be live at once on
one scanner. That is precisely why the fallback has to be a real, tested code
path rather than a comment claiming one exists.

---

## 6. The exact API we will code against

Taken from the framework's own machine-generated
`arm64-apple-ios.swiftinterface` @ `2.1.22` — the most authoritative surface
available, because it is emitted by the compiler from the shipped binary.

```
:160  public static let sharedInstance: CaptureHelper
:159  public var dispatchQueue: DispatchQueue?
:165  open func pushDelegate(_ delegate: any CaptureHelperDelegate) -> Bool
:167  open func popDelegate(_ delegate: any CaptureHelperDelegate) -> Bool
:169  open func setLogger(enable: Bool)
:170  open func openWithAppInfo(_ appInfo: SKTAppInfo,
                                withCompletionHandler completion: @escaping (SKTResult) -> Void)
:171  open func closeWithCompletionHandler(_ completion: @escaping (SKTResult) -> Void)

:88   func didReceiveDecodedData(_ decodedData: SKTCaptureDecodedData?,
                                 fromDevice device: CaptureHelperDevice,
                                 withResult result: SKTResult)
:80   func didNotifyArrivalForDevice(_ device: CaptureHelperDevice, withResult result: SKTResult)
:81   func didNotifyRemovalForDevice(_ device: CaptureHelperDevice, withResult result: SKTResult)
:77   func didReceiveError(_ error: SKTResult)
```

`SKTAppInfo` is Objective-C (`CaptureSDK.h:30-46`):

```objc
@property (strong) NSString * _Nonnull AppID;        // "ios:com.greenwaymarijuana.register"
@property (strong) NSString * _Nonnull DeveloperID;
@property (strong) NSString * _Nonnull AppKey;
@property (strong) NSBundle * _Nullable mainBundle;
-(bool) verifyWithBundleId:(NSString * _Nonnull)bundleId;
```

Note `verifyWithBundleId:` — the AppKey can be checked **locally, before
opening**. That turns "the scanner mysteriously does nothing" into a specific,
reportable message. We should use it.

### 6a. Two traps found by reading, that memory would have got wrong

**Trap 1 — `== E_NOERROR` is not the correct success test.**
`SktCaptureErrors.h:15-18` defines:

```c
#define SKTSUCCESS(result) (result>=0)
```

*"The positive values can be interpreted as successful with a warning. That's
why it is recommended to use the SKTSUCCESS macro to check for success."*

Positive codes really exist and really mean success: `E_WAITTIMEOUT = 1`,
`E_ALREADYDONE = 2`, `E_PENDING = 3`, `E_NODATA = 6`, `E_DEPRECATED = 7`,
`E_LASSODISABLED = 8`. Socket's **own sample code on their own docs page** uses
`if result == SKTCaptureErrors.E_NOERROR`, which would silently discard a
perfectly good scan that arrived with a warning. We will test `result.rawValue >= 0`
and say why in a comment.

The AppKey failure code is **`E_INVALIDAPPINFO = -93`** — *"The AppInfo
information is invalid."* That is the one to translate into plain English for a
budtender.

**Trap 2 — `stringFromDecodedData()` is UTF-8 with no guarantee.**
`SktCaptureEventIds.h:265-272`:

> *"get the decoded data as string UTF8 encoded ... there is no guaranty this
> property displays the decoded data if the data in the barcode are not UTF8
> encoded."*

An AAMVA PDF417 is **not** guaranteed UTF-8. It is a byte stream containing
control characters — `\x1e` (RS), `\x1d` (GS), `\x0a` (LF) — as structural
separators. If any byte sequence is not valid UTF-8, `stringFromDecodedData()`
returns **nil** and the licence is lost with no error at all.

The raw `NSData` is available as `decodedData.DecodedData`. The safe path is to
prefer the raw bytes and decode with a lossless single-byte encoding
(ISO-8859-1 / `NSISOLatin1StringEncoding`, which maps every one of the 256 byte
values to a character and therefore cannot fail) via
`stringFromDecodedDataWithEncoding:`, falling back to UTF-8 only if that is
somehow unavailable.

Our parser is already tolerant of exactly this messiness — `id-scan-core.ts:270`
notes the `@` compliance indicator is optional because *"keyboard-wedge scanners
routinely consume/strip leading control characters"*, and `:266` normalises
`\r\n`. Feeding it bytes that survived the trip intact should make it *more*
reliable than the wedge, not less.

---

## 7. The architectural difference from the printer

The Star plugin is **request/response**: JS calls `printReceipt`, Swift answers.
A scanner is the opposite — it **pushes** data when the trigger is pulled, with
nothing on the JS side waiting.

So this plugin needs Capacitor's **event** channel (`notifyListeners` on the
Swift side, `addListener` on the JS side), which the Star plugin never used.
Grep confirms it does not exist anywhere in the repo yet:
`grep -rn "notifyListeners\|addListener" src/lib/pos src/app/pos` → no matches.

The rest of the wiring pattern is proven and should be copied verbatim from
`src/lib/pos/star-printer.ts:132-160`:

1. no `Capacitor` global → browser → `null`
2. `isNativePlatform() === false` → web build → `null`
3. `PluginHeaders` lacks the name → native build without the plugin → `null`
4. otherwise → `registerPlugin()` for the real proxy

`PluginHeaders` is the honest source of truth for "did the native side really
register this," and it is populated by the bridge **before** our bundle runs.

### 7a. The Round 26–28 lesson applies directly

`GreenwayBridgeViewController.swift:104-113` exists because a compiled plugin is
**not** a registered plugin. Capacitor's iOS bridge does **no** runtime class
scan; `capacitor.config.json`'s `packageClassList` is built from installed **npm**
plugin packages only, so an app-local Swift file can never appear there.

Therefore the new scanner plugin must be, all three:

1. added to **Compile Sources** in `project.pbxproj`,
2. registered via `bridge?.registerPluginInstance(...)` inside
   `capacitorDidLoad()` — **not** `registerPluginType`, which begins
   `if autoRegisterPlugins { return }` and is a silent no-op,
3. guarded by a **new preflight check** that is *proven to fail* against the
   pre-fix state.

`scripts/pos/preflight-ios-build.ts` currently prints 6 OK lines. This slice adds
the 7th.

---

## 8. Integration point in the register

The ID gate lives in `SaleFlow.tsx`, not `RegisterShell.tsx`:

- `:1190` `scanSinkRef` — a hidden focused input that exists to dodge the iOS
  "Select All" callout (WebKit bug 231161). **In Application Mode there are no
  keystrokes, so the sink is no longer needed for SDK scans** — but it must stay
  for the HID fallback.
- `:1219-1245` the `keydown` handler → `feedIdCaptureKey` → `finalizeNow`.
- `:1131` `submitScan(raw)` → `parseAamvaPdf417` → `evaluateScannedId`.

**`submitScan(raw: string)` is the seam.** A native decoded-data event should
call exactly the same function with exactly the same string. Then the ID gate,
the age maths, the medical-card branch, the compliance logging and every existing
test stay untouched and keep applying to both paths. Nothing about the *decision*
changes; only the *delivery* changes.

---

## 9. Michael's printer question (Phase 0) — answered from source

He asked what the slip was that printed when he powered the printer off, held
FEED, and powered it back on — the one with a "dev name and address" — and
whether he still needs to keep it.

That is the Star **hardware self-test**. Verified at
`starmicronics.com/help-center/knowledge-base/how-to-print-a-self-test-on-star-printers`:

- Procedure listed for the TSP100III series (our TSP143IIIBi) is exactly:
  power **OFF** → press and hold **FEED** → power **ON** → release FEED only when
  printing begins.
- *"The self-test prints the printer's configuration settings."*
- Contents: Firmware Version (Printer), Firmware Version (Network Card),
  Interface Information, **MAC Address**, IP Address, **Bluetooth Name**,
  Communication Mode, Print Settings, Memory Switch Details.

The "dev name and address" he saw is the **Bluetooth Name** and the **MAC
address** — the printer's own hardware identity. It is a **diagnostic printout,
not a licence, registration, or activation artifact**. Nothing was consumed by
printing it and nothing expires.

**Does he need to keep the paper? No.** Two independent reasons:

1. Nothing in our code reads anything off that slip. The register identifies the
   printer by asset tag, model and serial — `COUNTER_PRINTER` at
   `src/lib/pos/star-printer-core.ts:93-100`, serial `2550923021300119`, taken
   from the sticker on the device, not from the self-test.
2. It is reproducible on demand in about ten seconds. It is a *report*, not a
   *record*.

The one genuinely useful line on it is the **Bluetooth Name**, which is how the
printer identifies itself in the iPad's Bluetooth list. That is already
discoverable from the iPad. Recycle the paper.

---

## 10. Open items that belong to Michael, not to code

1. **Buy the Socket Developer Community Membership** (SKU `SW1250-1463`),
   register, and get the **Developer ID**. Note their own warning: *"After
   purchasing, your membership may not become active for up to one business
   day."* Price will be visible at checkout; it is not published on the public
   page and I will not guess it.
2. **Generate the AppKey** for App ID `ios:com.greenwaymarijuana.register`
   (case-sensitive, exact).
3. **Scan the Application-Mode configuration barcode** to take the D760 out of
   HID, and clear the old pairing (listen for the **3 beeps**).

Items 1 and 2 are blocking: `openWithAppInfo` cannot succeed without them.
Item 3 flips the scanner's behaviour, so it should be done last, together with
the new build — not before, or the register loses its scanner in the meantime.

---

## 11. Sources actually fetched (not recalled)

- `https://docs.socketmobile.dev/capture/ios/en/latest/gettingStarted.html`
- `https://docs.socketmobile.dev/capture/ios/en/latest/captureHelper.html`
- `https://docs.socketmobile.dev/capture/ios/en/latest/ConfigureInAppMode.html`
- `https://docs.socketmobile.dev/capture/ios/en/latest/swiftPackageManager.html`
- `https://www.socketmobile.com/developers/integrate-step-by-step`
- `https://www.socketmobile.com/products/developers-membership`
- `https://www.socketmobile.com/products/d760`
- `https://raw.githubusercontent.com/SocketMobile/swift-package-capturesdk/2.1.22/Package.swift`
- `.../2.1.22/README.md`, `.../2.1.22/CHANGELOG.md`
- `.../2.1.22/Sources/CaptureSDK.xcframework/Info.plist`
- `.../2.1.22/.../Modules/CaptureSDK.swiftmodule/arm64-apple-ios.swiftinterface`
- `.../2.1.22/.../Headers/CaptureSDK.h`, `SktCaptureErrors.h`,
  `SktCaptureEventIds.h`, `SktCaptureHelper.h`
- GitHub REST API: repo metadata, tags, recursive tree @ `2.1.22`
- `https://starmicronics.com/help-center/knowledge-base/how-to-print-a-self-test-on-star-printers`

---

## 12. AppKey application form — the exact values submitted

Every value below was re-read from the file cited on the day of submission. None
was recalled. Membership purchased at **$19.95 + tax** (owner-confirmed).

| Form field | Value to submit | Source of truth |
| --- | --- | --- |
| Application name | `Greenway Point of Transaction` | `ios/App/App/Info.plist:10` (`CFBundleDisplayName`); `src/lib/pos/capacitor-config-core.ts:96` |
| iOS bundle ID | `com.greenwaymarijuana.register` | `project.pbxproj:320,341`; `capacitor-config-core.ts:93` |
| Application version | `1.0` | `MARKETING_VERSION`, `project.pbxproj:318,340` |
| CaptureSDK version | `2.1` (highest offered; installed will be 2.1.22) | `Package.swift` @ tag `2.1.22` |
| MFi protocol strings | `jp.star-m.starpro` — the ONLY other one | `Info.plist:58-61`, verbatim array contents |

### Why the bundle ID must be exact

The AppKey is a cryptographic function of Developer ID + **case-sensitive**
bundle ID. A single character of drift and `openWithAppInfo` returns
`E_INVALIDAPPINFO = -93` (`SktCaptureErrors.h`). This is also why the app's
`AppID` field at runtime is not the bare bundle ID but the platform-prefixed
form `ios:com.greenwaymarijuana.register` (`CaptureSDK.h:31`).

### Why `jp.star-m.starpro` is the answer to the MFi question

`UISupportedExternalAccessoryProtocols` in `Info.plist:58-61` currently declares
exactly one protocol string, and it is the Star TSP143IIIBi receipt printer's
(`STAR_EA_PROTOCOL`, `src/lib/pos/star-printer-core.ts:72`). There is no third
accessory in this app. So the complete answer to "MFi protocol strings other
than `com.socketmobile.chs`" is that one string.

Note the form's own caveat — *"MFi Protocol Strings are required for iOS MFi
Submissions Only."* Per `gettingStarted.html` item 1, MFi allow-listing gates
**App Store submission**, not installing directly from Xcode. It does not block
this slice.

### Standing hazard this records

When the Socket protocol is added, it must be **appended** to that array. If
`com.socketmobile.chs` ever *replaces* `jp.star-m.starpro`, the receipt printer
fixed in PR #1070 dies silently — no build error, no runtime error, just a
printer that stops being found. This gets its own test in the implementation
phase.
