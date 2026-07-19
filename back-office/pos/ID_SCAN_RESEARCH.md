# POS ID Scan — Research & Design Notes

**Feature:** Hardening the front-end POS "scan an ID to start a sale" flow so it is
instantaneous and reliable, matching the behavior the owner has seen with Socket
scanners in prior deployments.

**Status:** Shipped as slices IDS-1 (#593) and IDS-2 (#594). This document is the
authoritative research/design record. See `ID_SCAN_ROADMAP.md` for slice status and
`ID_SCAN_CHECKLIST.md` for the handoff verification checklist. Scanner-specific
configuration lives in `DURASCAN_D760_SETUP.md`.

---

## 1. Deployment setup (verified with owner)

- **Back office:** Next.js + Supabase, deployed on Vercel.
- **Front end (POS):** runs today as a **plain URL opened in Safari on an iPad**.
  Eventually intended for the Apple App Store as a native/wrapped app.
- **Windows VM:** used **only** to run the web crawler. It is *not* part of the POS
  data path.
- **Scanner:** Socket Mobile **DuraScan D760** (Bluetooth, 1D/2D imager).

The POS ID gate is the screen that blocks a sale until an acceptable, unexpired,
21+ ID is verified. Its logic is pure and lives in
`src/lib/pos/id-scan-core.ts` and `src/lib/pos/id-capture-core.ts`; the UI wiring
lives in `src/app/pos/SaleFlow.tsx`.

---

## 2. How the ID gate works

1. The scanner reads the back-of-license **PDF417** barcode. In HID / keyboard-wedge
   ("Basic") mode the scanner **types the decoded characters like a keyboard**,
   ending with a configured suffix (Enter/CR).
2. `SaleFlow.tsx` accumulates keystrokes into a buffer (`id-capture-core.ts`).
3. When the buffer is a complete AAMVA payload, it is parsed
   (`parseAamvaPdf417` in `id-scan-core.ts`) and evaluated (`evaluateScannedId`):
   acceptable type, not expired, age ≥ 21 (with a 40+ visual bypass rule).
4. On a good verdict the sale proceeds; on parse/age/expiry failure the gate shows an
   error and offers manual verification.

**AAMVA payload is self-describing** (per the AAMVA DL/ID standard): an
`"ANSI "` header + issuer IIN + version, a subfile directory with offsets/lengths,
and 3-letter data element IDs. The mandatory fields we gate on are **DBB**
(date of birth) and **DBA** (expiration date), plus DCS/DAC (name), DAQ (license #),
DAJ (jurisdiction), DCG (country).

---

## 3. Root cause of the "5–7s then fails" behavior (verified)

Two facts combine to produce the failure:

- **Socket HID mode is slow for 2D barcodes.** Socket Mobile's own documentation
  states that Basic (HID / keyboard) Mode is *"much slower ... for barcode
  symbologies encoding a lot of data, such as many 2D barcodes."* A driver-license
  PDF417 encodes roughly **300–1100 characters**. In HID mode those arrive one
  keystroke at a time over Bluetooth, and the stream can **stall mid-transmission**.

- **The old code finalized on a fixed 300 ms idle timer.** Every keystroke re-armed a
  300 ms timer; when the timer fired, whatever was in the buffer was treated as the
  whole scan. Because HID delivery of a long PDF417 can pause for **more than 300 ms**
  mid-stream, the timer fired on a **truncated buffer** → `parseAamvaPdf417` failed →
  the gate showed an error, and the *remaining* characters spilled out afterward as
  stray keystrokes. That is exactly the "reads for a few seconds then fails" symptom.

---

## 4. The fix — completion driven by content, not by a clock

Because the AAMVA payload is self-describing, we do **not** need to guess when the
scan is done from silence. We finalize the **instant** the buffer parses to a
gate-ready license (has valid DBB **and** DBA). This is perceived-instant and
immune to mid-stream BLE stalls.

- `isCompleteAamvaPayload(raw)` (IDS-1, `id-scan-core.ts`): returns true only when the
  buffer parses AND has a valid year-month-day date of birth **and** expiration date.
- `feedIdCaptureKey(state, key, nowMs)` (IDS-1, `id-capture-core.ts`): accumulates a
  keystroke and reports `{ state, consumed, complete }`, where `complete` is true once
  the buffer is a complete AAMVA payload (min length guard + `isCompleteAamvaPayload`).
- `SaleFlow.tsx` (IDS-2): on each key it calls `feedIdCaptureKey`. If `complete`, it
  **finalizes immediately**. Otherwise it (re)arms a **stall-proof fallback timer**
  (`ID_CAPTURE_FALLBACK_IDLE_MS = 1200 ms`, wider than the old 300 ms) so a partial or
  non-standard scan still resolves instead of hanging forever.

**No new dependencies, no new hardware, no companion service.** The scanner keeps
typing as a keyboard; we just stop finalizing too early.

---

## 5. Why NOT Socket CaptureJS / Companion for this setup (verified)

The owner asked whether Socket's Companion app on the Windows server could bridge a
server-paired scanner to the iPad front end. It cannot, for this architecture:

- **CaptureJS / Companion is local-only.** The browser talks to a Companion service on
  **`localhost:18481`** on the *same device*; the scanner must be paired to *that same
  device*. There is no network bridge from a Windows server to an iPad.
- **There is no Companion service on iOS.** On iOS, CaptureJS requires Socket's
  **Rumba** browser, or a native app using the **CaptureSDK**. A plain Safari tab on
  an iPad cannot use Companion/CaptureJS.

Therefore, for **Safari-on-iPad → App Store**, the correct architecture is the
**keyboard-wedge (HID)** path we hardened. Native **CaptureSDK** (App-Mode, faster 2D)
is a **future option only if a native iOS app ships** — it is not required to get
instant, reliable results today.

---

## 6. Scanner-side speed (see DURASCAN_D760_SETUP.md)

Even with content-driven completion, configure the D760 to deliver characters as fast
as possible: HID/keyboard (Basic) mode, enable the Driver's License **PDF417** parsing/
command barcode, **minimize inter-character / transmit delay**, and set the **suffix to
Enter/CR** so the buffer terminates cleanly.

---

## 7. What shipped

| Slice | PR   | Summary |
|-------|------|---------|
| IDS-1 | #593 | `isCompleteAamvaPayload` + `feedIdCaptureKey` + `ID_CAPTURE_FALLBACK_IDLE_MS`; pure self-tests. |
| IDS-2 | #594 | Rewired `SaleFlow.tsx` ID gate to finalize-on-complete with stall-proof fallback. |
| IDS-3 | this | Handoff docs (research, roadmap, checklist, D760 setup sheet). |

---

## 8. Sources (authoritative)

1. Socket Mobile — *Basic Mode vs Application Mode* (HID is "much slower … for … 2D
   barcodes").
2. Socket Mobile — Driver's License / PDF417 data parsing support.
3. Socket Mobile — CaptureJS *Getting Started* (Companion service, `localhost:18481`).
4. Socket Mobile — CaptureJS *Connect a Device* (scanner paired to same device).
5. Socket Mobile — Rumba browser requirement for CaptureJS on iOS.
6. Socket Mobile — CaptureSDK (native App-Mode) overview.
7. AAMVA — *DL/ID Card Design Standard* (self-describing PDF417 payload; subfile
   directory; DBB/DBA/DCS/DAC/DAQ/DAJ/DCG element IDs; date formats).
8. Scanbot / STRICH — AAMVA barcode parsing guides (payload structure, element IDs).
9. barKoder — AAMVA driver-license parsing reference.
