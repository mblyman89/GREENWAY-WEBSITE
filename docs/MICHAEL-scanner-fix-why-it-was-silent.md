# The scanner fix — why it worked in Companion and did nothing in the register

**For: Michael**
**Short version: you did everything right. The app had a wiring defect. It is fixed.**

---

## Part 0 — The 30-second version

You paired the S720. You confirmed in Socket's own Companion app that it decodes
barcodes. Then you scanned into the register and got nothing at all — no error
message, no warning, just silence.

That silence was the clue. Nothing was wrong with the scanner, the pairing, the
Bluetooth mode, the SDK, or anything you did. **The scanner code was never
introduced to the app.** Two lines of iOS project wiring were missing, and both
were invisible to every automated check we had.

You do not need to re-pair anything. You do not need to change any setting on
the scanner. Rebuild the app and it will work.

---

## Part 1 — What actually broke

The register talks to the scanner through a small piece of Swift code called
`SocketScannerPlugin`. For the JavaScript side of the register to be able to
call it, two separate things must be true:

1. **The file must be compiled.** Xcode does not build every file it finds in a
   folder — it builds files that are formally *members* of the app target.
   `SocketScannerPlugin.swift` was sitting in the project folder, complete and
   correct, and was never being compiled.

2. **The plugin must be handed to Capacitor by name.** This is the one that is
   genuinely surprising. Capacitor does **not** find plugins by looking through
   the finished app for them. It registers five built-in plugins, plus whatever
   names appear in a list that is generated automatically from installed npm
   packages. Our scanner code lives in the iOS app folder, not in an npm
   package, so it can *never* appear in that list. The only way it gets
   connected is one explicit line of code — and that line existed for the
   receipt printer and had never been written for the scanner.

Either one alone is enough to produce exactly the symptom you saw.

---

## Part 2 — Why it failed *silently*, which is the worse half

This part matters more than the defect itself.

The register is deliberately built so that a scanner problem can **never block a
sale**. If it cannot find the native scanner, it quietly falls back to treating
the scanner as a keyboard and carries on serving customers.

So when the plugin was missing, the register checked for it, correctly concluded
"there is no native scanner here", and fell back without saying a word. That is
the behaviour we want at the counter with a customer waiting. But it also meant
a real defect produced no error message anywhere — which is why it reached you
instead of being caught.

The safety feature was working perfectly. It was also hiding the bug.

---

## Part 3 — Why every check we had stayed green

This is the honest accounting.

The receipt printer went through this **exact** failure back in Slice 10, and it
cost several evenings. When we fixed it, we added a preflight guard so it could
never happen again silently — a check that refuses to build the iPad app if the
printer plugin is not compiled and registered.

We added that guard for the printer. We did not add it for the scanner.

So the printer was protected and the scanner was not, and the scanner is the one
that broke. Same defect, same file, one device covered and one not. Nothing in
the test suite, the type checker, or the build could see it, because all of them
check the *web* app — and this is a setting inside the *iOS project*.

---

## Part 4 — What I changed

Three fixes and two new guards:

1. **Registered the plugin.** Added the missing line to
   `GreenwayBridgeViewController.swift` so the scanner is handed to Capacitor at
   startup, right next to where the printer already was.

2. **Added the file to the build.** `SocketScannerPlugin.swift` is now formally
   a member of the app target, so Xcode compiles it.

3. **Extended the preflight** (`npm run register:build:ios`) so it now checks
   the scanner exactly the way it already checked the printer. If either fix is
   ever undone, the build **stops** with a plain-English explanation naming the
   symptom you actually saw, instead of producing an app that installs and
   silently does not scan.

4. **Added 16 automated tests** that read the real iOS project files and fail if
   the wiring is removed. I verified these actually work by deliberately
   breaking each fix and confirming the tests went red, then restoring them.

5. **Confirmed your scanner's Bluetooth mode from Socket's own manual** rather
   than assuming it — see Part 5.

---

## Part 5 — One thing I checked rather than assumed

The setup instructions I wrote for Slice 12 were written for a **D760**. You
have an **S720**. Those are different products, and Socket's own website lists a
model called the **S721** as a *contactless* reader that uses a completely
different Bluetooth technology. S720 and S721 are one character apart.

If the S720 had been that kind of reader, the fixes above would not have been
enough on their own. So rather than guess, I downloaded Socket's official user
guide for the S700/S720/S730/S740 and read it.

It confirms the S720 is a **barcode reader**, and that on Apple devices it uses
"Bluetooth Apple Serial Specific (MFi Mode)", with the reader shipping in **iOS
Application Mode** by default — which is the mode you already paired it in.

That is the mode our app is built for, and the protocol declaration in the app
was already correct. So the two wiring defects were the entire problem, and no
Bluetooth or permission changes are needed.

---

## Part 6 — What you need to do

Just rebuild:

```
npm run register:build:ios
```

If the Socket package is still added in Xcode from last time — you said you
installed it, so it should be — this will now build an app where the scanner
actually works. The preflight will tell you plainly if anything is missing
before it wastes your time.

**If the preflight reports the Socket package is missing**, re-add it in Xcode:
select the **App** target, **Package Dependencies**, add
`https://github.com/SocketMobile/swift-package-capturesdk` and choose the
`CaptureSDK` product. That step lives on your Mac and cannot be committed to the
repository, which is why the preflight checks for its effects rather than
assuming.

You should not need to re-pair the scanner. If you do end up re-pairing, the
procedure is the same iOS Application Mode one you already used in Companion.
