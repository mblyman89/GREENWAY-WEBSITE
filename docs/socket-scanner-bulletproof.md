# Making the Socket scanner work every day, every time

**Slice 15. Written for Michael, February 2026.**

You told me what happened in plain terms: it worked that evening, you put it back on its base, it switched itself off some time later, and by the next afternoon it had vanished from the register. You forgot the device, paired it again, and from then on it would only scan inside Socket's own app. You asked whether there is a setting we need, whether making it "static rather than dynamic" is the issue, and you asked me not to guess.

So I did not guess. What follows is what the evidence actually says. The short version is that your one sentence contains **three separate problems** that happen to look like one, and only one of them was a bug in our code. That one, though, was serious, and it was ours.

---

## What was actually wrong

### 1. The scanner turning itself off was the scanner doing its job

The SocketScan 700 series user guide specifies two power timers. When the reader is **disconnected**, it powers off after **5 minutes**. When it is **connected but idle**, it powers off after **2 hours**. Both are deliberate battery-saving behaviour, and both are configurable — but only from a command barcode, never from software. Nothing I can write in the app can override a power timer. That part of the fix is a barcode you scan once, and it is in the checklist at the end.

So the reader switching off on its base was not a fault. It was Tuesday.

### 2. Re-pairing from the iOS Bluetooth screen is what broke it afterwards

This is the part that explains the strangest symptom — that after re-pairing, it scanned in the Companion app and nowhere else.

Socket's CaptureSDK documentation is blunt about it:

> "CaptureSDK uses App mode (also known as SPP mode) to communicate with the hardware devices... To work with CaptureSDK, your reader must be into App mode... Note that this process cannot be completely automated. We recommend using the Socket Mobile Companion app for this."

There are two modes. **Application Mode** delivers the whole barcode to the app as one message. **Keyboard mode (HID)** makes the reader pretend to be a keyboard and *type* the barcode into whatever has focus. Our register needs Application Mode. When you forgot the device and re-paired it through the iOS Bluetooth screen, it came back in keyboard mode — and in keyboard mode our SDK code genuinely cannot see it at all. It is not that it was broken; it was invisible.

To your specific question — **"is there a way to make it static rather than dynamic?"** — the honest answer is that this is not a dynamic-versus-static problem, so making it static would not have helped. The pairing was fine. The *mode* was wrong. And the good news is that the mode is genuinely permanent once set correctly: Socket documents that the Application Mode setting

> "is persistent across power cycling the scanner and needs to be scanned only once... until it is reset to factory defaults, or until the keyboard emulation (HID) barcode is scanned."

That is as static as it gets. Set it once via Companion and it stays set. The only two ways to lose it are a factory reset or scanning the HID barcode — which is effectively what re-pairing from Settings did.

### 3. The part that was our fault, and it was worse than you knew

Here is what I found in our own code, and I want to be straightforward about it because it is not a small thing.

The register runs **two** scanning surfaces at the same time — the ID gate and the cart. Each one was starting and stopping its own Capture session. That already contradicts Socket's own instruction, which appears in a comment directly above the open call in three separate official code samples:

> "open Capture Helper only once in the application (in the main view controller) and pushDelegate, popDelegate each time a new view requiring scanning capability is loaded or unloaded respectively."

But the real damage was subtler. Whichever surface unmounted first — and the ID gate unmounts after **every single sale** — would close the Capture service out from under the other one. And because closing Capture fires no disconnect events, the surviving surface never found out. It went on believing a scanner was attached, which meant it kept the **keyboard-wedge fallback suppressed**.

Read that again, because it is the whole problem: the SDK was shut, *and* the backup path was muted. The register could not scan by either route. And it reported nothing — no error, no warning, no red light. It just quietly stopped scanning.

I found three more faults in the same area while I was in there:

- **The device count could only ever go up.** When the app re-synced after a reload, it *added* the scanner count it got from the phone on top of the count it already had. One scanner would be counted as two. Then when that one scanner powered off on its 2-hour timer, the count would drop from two to one — never to zero — so the register would believe a scanner was still attached forever, and keep the wedge suppressed. Overnight. Unattended. **This is the single best explanation for arriving to a dead register in the morning.**
- **A failed open was permanent.** If Capture failed to open once — say the app launched a half-second before Bluetooth was ready — that was it until someone force-quit the app. No retry, ever.
- **Nothing recovered on wake.** Socket documents that iOS disconnects the scanner when the app backgrounds and hands it back on foreground. We were relying on that handover arriving by luck, and it only arrives at all if Capture is still open — which, per the bug above, it often was not.

---

## What I changed

Everything below is now enforced by tests that I verified actually fail when the fix is removed. That check matters: I ran **eight** deliberate re-breaks of this code, and every one was caught. One of them — the phantom-device case — was **not** caught on the first pass, which told me one of my tests was weaker than it looked, so I strengthened it and re-ran until it caught the break too.

**Capture now opens once and stays open.** Screens take a *lease* on a single shared session instead of each owning one. Releasing the last lease deliberately does **not** close Capture, because a screen's lifetime is not the app's lifetime. Only the app shutting down closes it.

**The keyboard wedge is now only silenced when something is provably listening.** This is the rule that kills the dead-till bug outright: the SDK is considered to own scanning only when Capture is open **and** a scanner is actually attached. Either half missing and the wedge comes straight back. There is no longer any reachable state where both channels are off.

**The device count is now replaced by the phone's answer, never added to it.** So when your scanner powers off overnight, the count reaches zero, and the register falls back to keyboard scanning like it should.

**A failed open now retries forever** — after 1s, 2s, 4s, 8s, 15s, then every 30 seconds indefinitely. If the scanner is switched on at 8:55am, the register is scanning through it within half a minute, with nobody restarting anything.

**Waking the iPad now actively re-checks the scanner** rather than hoping. This is the one I expect you to notice most: an iPad that has been asleep on the counter since last night should come back to a working scanner on its own.

**The status message now tells a budtender what to do.** Every fallback message leads with the fact that they can *keep selling*, then names the physical fix. If Capture won't open, it says to re-pair in Application Mode via Companion — the exact thing that bit you.

### One thing I deliberately did *not* do

There is an iOS setting called the `external-accessory` background mode, and on the surface it looks exactly like the fix for "the scanner was disconnected this morning." I did not add it, and I want to explain why rather than leave it as a silent omission.

Apple's documentation lists it for apps talking to "an accessory that delivers data at regular intervals" and explicitly warns to "use background execution modes sparingly." A barcode scanner delivers data when a human pulls a trigger — that is not a regular interval. More decisively, Socket's own documentation says outright:

> "Apps do not have access to Socket Mobile readers while in the background."

So the entitlement would buy us nothing, and would invite a fair question at App Store review. Recovering properly on foreground is the supported answer, and that is what I built. I have written the reasoning into `Info.plist` itself and added a test that fails if someone adds it later on a hunch — so this decision does not have to be re-litigated from memory.

---

## What I need you to do — about 5 minutes, once

Code cannot fix the two hardware problems. These are the barcodes and steps that will.

**Step 1 — Put the scanner back in Application Mode.** Open the **Socket Mobile Companion** app, remove the D760 if it is listed, and pair it again *from inside Companion*, choosing **Application Mode** when asked. Do not pair it from the iOS Settings → Bluetooth screen. That screen is what put it in keyboard mode.

**Step 2 — Stop it powering off on you.** In the SocketScan 700 series user guide (or Companion's own settings), scan the command barcode for **"Barcode reader Always On"**, or if you would rather keep some battery saving, the **8-hour** continuous-power barcode. The default is 2 hours, which is why it kept going to sleep during the day. Like Application Mode, this survives power cycling — scan it once.

**Step 3 — Confirm automatic reconnection is on.** It is the factory default, but it is worth confirming while you are in there. If you scan that barcode, power-cycle the reader afterwards.

**Step 4 — Worth considering.** If the scanner mostly lives on its base, the 700 series supports a **presentation/auto mode** where it scans anything held in front of it while powered on the stand. That may suit the counter better than pulling the trigger.

Once those are done, the software side will keep it there: it reconnects on wake, retries indefinitely if the reader is off, and always falls back to keyboard scanning rather than going silent.

---

## What I could not verify, and I want to be clear about it

The Swift plugin **has not been compiled**. There is no Swift toolchain or Xcode in the environment I work in, so the iOS changes — the live device list in `getStatus`, and the delegate guard that stops a re-open delivering every barcode twice — are written against Socket's published API reference but have not been through a compiler. They compile on your MacBook. I am flagging this rather than letting a wall of green test results imply more than it should.

Everything in TypeScript **is** verified: 20 behavioural tests that drive the real code against a simulated scanner, 7 guarding the native decisions, 55 assertions in the pure policy layer, TypeScript clean, lint clean, and the 81 existing scanner tests still passing.

And one honest note on those tests. After the inventory page went down last week past 14,000 green tests, I changed how I write these. The main test file here does not check that the code *reads* correctly — it actually runs the scanner session against a fake Capacitor plugin and asserts on what the plugin was *asked to do*. The headline test simulates the exact outage you would have hit: two screens, one unmounts, and it proves the register can still scan by some path. That test fails against the old code. That is the only reason I trust it.
