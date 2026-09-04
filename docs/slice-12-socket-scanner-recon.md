# SLICE 12 — RECON: Socket DuraScan D760 via CaptureSDK

Owner instruction for this round, verbatim:

> *"Yes please fold in the migration for me to run, I like to be thorough and
> all inclusive. The AppKey for our app, com.greenwaymarijuana.register is: …
> Developer ID: … Star PPID: 121976-868316. Please begin the slice that
> finishes these two components off. I am excited to test the scanner to see
> how well it performs now. Please follow the standing rules and never guess,
> never assume."*

Standing rule: **do not guess, do not assume. we build from fact, not memory.**
Everything below was read out of the tree at `56bda39f` (18F merged), or out of
Socket Mobile's official documentation, or returned by a live API call. Nothing
here is recalled.

---

## 0. WHAT "THESE TWO COMPONENTS" ARE

Read from `docs/MICHAEL-slice10-receipt-printer-and-app-store.md:1922-1934`,
which is the scope Michael already approved:

> *"You chose the **app-side SDK** route, which is the right call. … research
> the DuraScan D760's SDK against Socket's official documentation, then replace
> HID keystroke-streaming with a single delivered scan payload — which also
> eliminates the stray-keystroke class of bugs entirely."*

So the two components are:

1. **The scanner** — Socket CaptureSDK replacing HID keyboard-wedge.
2. **The migration** — `0220`, refreshing the 0218 column comment that 18F left
   incomplete. Michael asked for it to be folded in: *"I like to be thorough
   and all inclusive."*

## 1. THE MEASURED PROBLEM

`docs/MICHAEL-slice10-receipt-printer-and-app-store.md:1748-1755` records the
observation and its cause:

- a driver's licence PDF417 holds roughly **300–1100 characters**;
- the D760 in default **HID keyboard mode** types them one at a time;
- Socket's own documentation calls Basic/HID mode *"much slower … for barcode
  symbologies encoding a lot of data, such as many 2D barcodes"*;
- observed: **~10 seconds** to read a licence.

Our own timers are **not** the bottleneck and must not be blamed: the register
finalises 300 ms after the last character with a 1200 ms stall net.

## 2. WHAT ALREADY EXISTS (and must not be rebuilt)

| File | Lines | Role |
|---|---|---|
| `src/lib/pos/wedge-scan-core.ts` | 166 | pure keystroke burst classifier (HID) |
| `src/lib/pos/id-scan-core.ts` | 786 | AAMVA driver-licence parser |
| `src/lib/pos/scan-to-cart-core.ts` | 276 | barcode → cart line |
| `src/lib/pos/id-capture-core.ts` | — | ID capture policy |
| `src/lib/pos/scan-required-core.ts` | — | when a scan is compulsory |
| `src/app/pos/SaleFlow.tsx:2374-2389` | — | document-level wedge listener |

**The AAMVA parser and the cart resolver are symbology-agnostic and stay
exactly as they are.** The SDK changes only *how the characters arrive*, not
what they mean. Rebuilding either would be duplicate work of the 18F "half of
this is already built" kind.

`src/lib/pos/sale-flow-core.ts:246` already anticipates this slice:
*"it means the Socket scanner landing …"*.

## 3. THE SDK — VERIFIED AGAINST OFFICIAL DOCS, NOT MEMORY

Source: `https://docs.socketmobile.com/capture/ios/en/latest/gettingStarted.html`
and `.../captureHelper.html` (Socket Mobile, last updated Jul 24 2026).

### 3a. Six mandatory `Info.plist` keys

Quoted from the Requirements list. **Four of these six are currently absent**
from `ios/App/App/Info.plist`:

| Key | Required value | Present today? |
|---|---|---|
| `UISupportedExternalAccessoryProtocols` | add `com.socketmobile.chs` | key exists, holds **only** `jp.star-m.starpro` |
| `LSApplicationQueriesSchemes` | `sktcompanion` (lower case) | **ABSENT** |
| `NSCameraUsageDescription` | string, for SocketCam | **ABSENT** |
| `NSBluetoothAlwaysUsageDescription` | string | present (Star wording — must be widened) |
| `CFBundleAllowMixedLocalizations` | `YES` | **ABSENT** |
| AppKey / DeveloperID / AppID | supplied at runtime | n/a |

This is exactly why the rule exists. Had I worked from memory I would have
added the protocol string and stopped; `sktcompanion` and
`CFBundleAllowMixedLocalizations` are not guessable, and the docs say the app
**will crash** without the Bluetooth description.

### 3b. The whitelist — an owner action, not a code change

Requirement 1, verbatim:

> *"Your application needs to be registered in our whitelist before submitting
> your application to the Apple Store. It will not pass the Apple Store review
> if this is not done."*

This must go in Michael's walkthrough. It is a submission blocker of exactly
the same class as the Star PPID.

### 3c. Pairing mode — an owner action

Requirement 9: the scanner must be paired **in Application Mode**, via the
Socket Mobile Companion app. A D760 paired in HID mode will simply never
appear to CaptureSDK. This is the single most likely "it doesn't work" outcome
on first test, so the walkthrough must lead with it.

### 3d. The API surface actually used

From `captureHelper.html`:

```
CaptureHelper.sharedInstance
  .dispatchQueue = DispatchQueue.main
  .pushDelegate(_:) / .popDelegate(_:)
  .openWithAppInfo(_:withCompletionHandler:)
  .closeWithCompletionHandler(_:)
SKTAppInfo().developerID / .appID / .appKey
CaptureHelperDevicePresenceDelegate  -> didNotifyArrivalForDevice / …Removal…
CaptureHelperDeviceDecodedDataDelegate -> didReceiveDecodedData(_:fromDevice:withResult:)
CaptureHelperErrorDelegate            -> didReceiveError(_:)
SKTCaptureDecodedData.stringFromDecodedData()
SKTCaptureErrors.E_NOERROR
```

**`appID` format is `ios:<bundle-id>`** — from the documented sample
`"ios:com.socketmobile.MyTestApp"`. Our bundle ID is
`com.greenwaymarijuana.register`, verified at
`ios/App/App.xcodeproj/project.pbxproj:320`, and it matches the app Michael
registered the AppKey against. So `appID` = `ios:com.greenwaymarijuana.register`.

### 3e. Distribution — SPM, and it is public

`ios/App/CapApp-SPM/Package.swift` shows this project uses **Swift Package
Manager**, not CocoaPods, and carries the banner *"DO NOT MODIFY THIS FILE -
managed by Capacitor CLI commands"* — so the CaptureSDK package is added in
**Xcode's UI**, exactly as the StarXpand SDK was, not by editing that file.

Socket's SPM doc says *"released as a private Swift Package Manager"* and
points at the Developer Portal. That is out of date, and I checked rather than
repeating it: the GitHub API reports
`SocketMobile/swift-package-capturesdk` as **`"visibility": "public"`**, latest
tag **`2.1.22`**. Fetching `Package.swift` at that tag confirms:

- library product name: **`CaptureSDK`**
- platform: **iOS 15** — our project is `.iOS(.v15)`, so compatible
- it transitively pulls `swift-package-swiftdecodersdk` exact `6.7.2`

## 4. THE STAR PPID — VERIFIED NOT A CODE VALUE

Michael supplied **PPID 121976-868316** in the same message as the Socket
credentials. Before using it anywhere I checked what it is for.
`docs/MICHAEL-slice10-receipt-printer-and-app-store.md:541-560` is explicit:

> *"In your app in App Store Connect, scroll down to **App Review Information**.
> In the **Notes** box, type your PPID … Star's instruction, word for word:
> Submit your App to the Apple App Store through App Store Connect with the MFI
> PPID number in the Notes section of the App Review Information."*

**The PPID is an App Store Connect review-notes value. It does not belong in
source code, in `Info.plist`, or in any environment variable.** Putting it in
the app would accomplish nothing and would scatter a credential-shaped string
through the repo for no reason.

What it *does* get: the walkthrough is updated to carry his **real** number
instead of the `123456-7890` placeholder, so on submission day he copies rather
than reconstructs. That is the honest use of it.

## 5. THE BRIDGE PATTERN — REUSE, DO NOT REINVENT

`src/lib/pos/star-printer.ts:103-160` documents a bug that cost a real device
round-trip and must not be repeated:

> *"In Capacitor 6+, `Capacitor.Plugins` is NOT populated by the native bridge.
> It is populated as a SIDE EFFECT of calling `registerPlugin()` … so
> `Capacitor.Plugins.StarPrinter` was permanently undefined."*

The resolution order that works, and that the scanner bridge will copy exactly:

1. no `Capacitor` global → browser → `null`
2. `isNativePlatform() === false` → web build → `null`
3. `PluginHeaders` lacks the name → native build **without** the plugin
   compiled in → `null` (degrade honestly)
4. otherwise → `registerPlugin()` for the real proxy

## 6. NO SWIFT TOOLCHAIN HERE — DISCLOSED, AS IN SLICE 10

```
$ which swift swiftc xcodebuild pod
(no output)
```

`StarPrinterPlugin.swift` carries the same honest disclosure and it is the
right precedent: the Swift file is written against the official API reference
and **compiles on Michael's MacBook Pro**, not here. Everything that *can* be
proven in CI — the TypeScript bridge, the pure cores, the `Info.plist`
contents, the plugin/JS contract — is proven by tests in this slice.

## 7. THE MIGRATION (0220)

`supabase/migrations/0218_receiving_classification.sql:111-112` comments
`chosen_classification_provenance` as:

> `{"otherwiseTaken":"human"|"machine_default","lowThcLiquid":"human"|"unanswered"}`

18F added a fourth value, `remembered`, so that comment is now incomplete.
`0219_classification_provenance_doctrine.sql` is the precedent for a
**comment-only** migration and states the reasoning: a column comment is *"the
one piece of documentation that travels WITH the database"*.

Confirmed there is no CHECK constraint on the column, so this changes nothing
executable — it is documentation, which is precisely what Michael asked to have
folded in.

## 8. WHAT THIS SLICE WILL NOT DO

- It will **not** delete the wedge path. The D760 can still be in HID mode, a
  USB wedge may be used at the dock, and the register must not lose scanning
  because a Bluetooth pairing dropped. SDK **preferred**, wedge **fallback**.
- It will **not** touch the AAMVA parser or the cart resolver.
- It will **not** claim the scanner is fast until Michael measures it on the
  counter. The first honest proof is a scan on real hardware.
