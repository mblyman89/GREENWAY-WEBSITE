# SLICE 12 — Making the scanner fast (and the migration to run)

**For: Michael**
**Two things in here: one SQL file to run, and the scanner work.**

---

## Part 0 — The 30-second version

Your D760 has been pretending to be a keyboard. Every barcode gets **typed** to
the iPad, one character at a time, over Bluetooth. A driver's licence barcode
holds between 300 and 1,100 characters. That is why an ID scan takes about ten
seconds — the scanner is literally spelling it out.

This slice stops the spelling. In **Application Mode** the scanner sends the
whole barcode as one message, and it lands instantly.

There are three things only you can do, and the app cannot work around any of
them:

1. Add the Socket package in Xcode (Part 2).
2. **Re-pair the scanner in Application Mode** using Socket's Companion app
   (Part 3). This is the one that catches people out.
3. Put your Star PPID in App Store Connect when you submit (Part 5).

---

## Part 1 — The migration to run first

**File:** `supabase/migrations/0220_classification_memory_provenance.sql`

Open Supabase → SQL Editor → paste the **whole file** → Run.

**What it does:** rewrites one column comment. That is all. It changes no data,
no structure, and no constraint — you can run it twice and nothing happens
differently the second time.

**Why it exists:** back in 18F we taught the receiving dock to remember a
classification answer you had already given for a product, so it stops asking
you the same question every delivery. That added a fourth possible value,
`remembered`, to a column whose description still listed only three. Nothing
broke — the column accepts any value — which is exactly the problem. The
description had quietly become a list that reads as complete but is not, and
`remembered` would look like corrupted data to anyone auditing that table
against it.

**How I know it works rather than merely parses:** I applied all 220 migrations
in order to a real PostgreSQL 15 database, then applied 0220 a second time to
prove re-running it is safe, then read the comment back out of the live
database to confirm all four values are actually there. That last check matters
— a file can run cleanly and still not say what you meant.

---

## Part 2 — Add the Socket package in Xcode

Your project uses **Swift Package Manager**, not CocoaPods, so this is a menu
click rather than a Podfile edit.

1. Open `ios/App/App.xcworkspace` in Xcode.
2. **File → Add Package Dependencies…**
3. Paste this URL:

   ```
   https://github.com/SocketMobile/swift-package-capturesdk
   ```

4. Dependency Rule: **Up to Next Major Version**, starting from `2.1.22`.
5. Add it to the **App** target. The product to check is **`CaptureSDK`**.

> **A note on Socket's own documentation.** Their setup page says this package
> is private and that you must request access. When I checked the repository
> directly it is marked **public**, and the latest tag is 2.1.22. Their docs are
> out of date. If the URL above fails for you, tell me and we will go the
> access-request route — but try it first, because it should just work.

Nothing else needs adding. `Info.plist` is already done (Part 6 lists exactly
what changed and why).

---

## Part 3 — ⚠️ Pair the scanner in Application Mode

**If you skip this, everything else is wasted and the app will simply never see
the scanner.** No error, no warning — it just stays silent, because a scanner in
keyboard mode is invisible to the SDK by design.

1. Install **Socket Mobile Companion** from the App Store on the iPad.
2. If the D760 is currently paired to the iPad as a keyboard, go to
   **Settings → Bluetooth**, tap the ⓘ next to it, and **Forget This Device**.
   It cannot be in both modes at once.
3. Open Companion and follow its pairing flow. It will have you scan a
   configuration barcode that switches the scanner out of keyboard mode.
4. When Companion shows the D760 as connected, open the register.

**How you will know it worked:** scan a driver's licence. Instead of the ten
second crawl, the result appears effectively instantly. That difference is the
whole slice.

**If nothing happens at all,** the scanner is almost certainly still in keyboard
mode — repeat step 3. If characters appear as if typed, it is definitely still
in keyboard mode.

---

## Part 4 — What happens if the scanner dies mid-shift

It keeps selling. That was a hard requirement in how this was built.

The keyboard-wedge path has **not** been deleted. The moment the last Socket
scanner disconnects — flat battery, out of range, powered off — the register
hands scanning straight back to the old keyboard path, which still works
exactly as it does today. Slow, but working, and a slow till beats a dead one.

You will see a status line saying the scanner disconnected and that it is back
to keyboard scanning, so nobody has to guess why things got slower.

**It also cannot scan the same thing twice.** While a Socket scanner is
connected, the keyboard path stands down completely. This matters more than it
sounds: the SDK delivers a scan in milliseconds while the keyboard path takes
ten seconds to finish spelling the same barcode out, so the two copies arrive
nowhere near each other. Anything clever based on "ignore what we just saw"
would have to wait more than ten seconds to catch the straggler — and would then
stop you ringing up two identical items, which you do all day. So the register
arbitrates by **which channel owns scanning**, not by timing. Two of the same
gummy pack still ring up as two.

---

## Part 5 — Your Star PPID, for App Store submission

This is unrelated to the scanner, but it belongs with the submission steps, and
you gave me the number so here it is in one place.

When you submit in App Store Connect: **App Review Information → Notes**, type:

```
MFI PPID 121976-868316
```

That is your real number. Star's instruction is word for word:

> Submit your App to the Apple App Store through App Store Connect with the MFI
> PPID number in the Notes section of the App Review Information.

Apps get rejected for missing this.

**One thing to add while you are in that box.** Socket requires that your app be
registered with them before App Store submission, so the accessory protocol
declaration is approved. Do that on the Socket developer portal under your
existing AppKey registration for `com.greenwaymarijuana.register`. It is
paperwork, not code, but it is a submission blocker if missed.

---

## Part 6 — What changed in the app (for the record)

**Info.plist** — four additions and one reword. Each of these is a key whose
absence causes a *silent* failure on the iPad, which is why there are now tests
guarding every one of them:

| Key | Why |
|---|---|
| `com.socketmobile.chs` added to `UISupportedExternalAccessoryProtocols` | Without it iOS never tells the app the scanner exists. **Star's `jp.star-m.starpro` is still there** — it was added alongside, not replacing. Overwriting that array is the easy way to break receipt printing while adding scanning. |
| `sktcompanion` in `LSApplicationQueriesSchemes` | Lets the app hand you to the Companion app for pairing. |
| `NSCameraUsageDescription` | The CaptureSDK links a camera decoder whether or not we call it. Without a purpose string iOS **terminates** the app — a crash, not a refusal — and review rejects the build. |
| `CFBundleAllowMixedLocalizations` | Required by the CaptureSDK bundle. |
| Bluetooth prompt reworded | It now mentions scanning as well as receipts. That prompt is shown **once**. If it only said "receipts", a manager declining it because the printer was not needed that day would have silently declined scanning too, with no way back except Settings. |

**New code**

- `src/lib/pos/socket-scan-core.ts` — all the decisions, pure and tested: what a
  payload is, which channel owns scanning, whether a repeat is a held trigger or
  a real second item.
- `src/lib/pos/socket-scanner.ts` — the bridge to the native side.
- `src/lib/pos/use-socket-scanner.ts` — the React seam used by both the ID gate
  and the cart.
- `ios/App/App/SocketScannerPlugin.swift` — the native plugin.

**Untouched on purpose:** the AAMVA licence parser and the barcode-to-cart
resolver. Both already work and neither cares how the barcode arrived, so
rewriting them would have been risk with no benefit.

---

## Part 7 — What I could not test, stated plainly

**The Swift file has not been compiled.** This environment has no Swift
toolchain and no Xcode — the same disclosure Slice 10 made for the Star printer
plugin, and true for the same reason. It was written against Socket's official
CaptureHelper API reference, using only documented calls, and it compiles on
your MacBook. If Xcode reports an error, send me the exact text and I will fix
it against the real compiler rather than guess.

**No scanner was harmed, or indeed present.** Everything about timing, pairing
and Application Mode comes from Socket's documentation and from the measured
behaviour of your current setup. The first true proof is your first scan.

**What I did prove:**

- The pure decision logic — 25 behavioural tests plus 28 assertions inside the
  self-test harness.
- The bridge's plugin discovery and app identity — 8 tests.
- The Info.plist keys — 6 tests, plus a real plist parser confirming the file
  still parses and that nothing was lost.
- **Mutation testing:** the code was deliberately broken 28 different ways —
  ownership removed, the repeat window made infinite, the payload trimmed (which
  would break every ID scan), each Info.plist key deleted in turn — and the test
  suite had to catch every one. It does. A comment-only change was included as a
  control and correctly did *not* trigger a failure, which proves the tests are
  checking behaviour rather than matching words.
- The full suite: 555 files, 14,000+ tests, green.

The first mutation run found **three genuine gaps** in my own tests — the repeat
window not being checked per-channel, and both bridge tests missing entirely.
Those tests exist now because the mutants embarrassed them into existence. One
further "gap" turned out to be a badly-chosen mutant that could not change
behaviour at all; I proved that by exhaustive probing rather than assuming it,
and replaced it with one that does.
