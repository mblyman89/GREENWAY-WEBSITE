# DuraScan D760 — Setup Sheet for POS ID Scanning (iPad / Safari)

One-page configuration for the Socket Mobile **DuraScan D760** so it feeds the POS ID
gate correctly on an **iPad running the POS as a URL in Safari**. All steps below are
from Socket Mobile's official SocketScan/DuraScan 700-series user guide.

> **Golden rule for command barcodes:** the reader must be **disconnected from
> Bluetooth** (blue LED **blinking fast**) before you scan any command/config barcode.
> If it's connected, forget it from the iPad's Bluetooth list first. A successful config
> scan gives **3 escalating beeps**; an escalating-then-long tone means the command was
> rejected — try again.

---

## Target configuration (what "correct" looks like)

| Setting | Value | Why |
|---|---|---|
| Connection mode | **Basic Keyboard Mode (HID)** | Works with Safari/Notes (active cursor); no app/companion needed. This is the correct mode for Safari-on-iPad. |
| Driver's License PDF417 | **Enabled** | The back-of-license 2D barcode we read; must be on for the AAMVA data to decode. |
| Suffix | **Carriage Return (CR)** | Terminates the buffer so the POS finalizes the scan cleanly. |
| HID keyboard language | **English (default)** | Ensures characters map correctly. |
| Beep | On (default) | Audible confirmation of a good scan. |

---

## Step-by-step

### 1. Put the D760 in Basic Keyboard Mode (HID) and pair to the iPad

1. If the reader is currently paired to anything, **forget it** from that device's
   Bluetooth list first.
2. Power on the reader; make sure it is **discoverable** (blue LED blinking fast).
3. Scan the **Basic Keyboard Mode (HID)** command barcode from the Socket 700-series
   user guide (section: *Quick Programming → Basic keyboard mode*).
4. On the iPad: **Settings → Bluetooth**, turn Bluetooth on, and tap
   **Socket M9xx [xxxxxx]** (the last 6 chars are the reader's Bluetooth address).
5. The reader beeps once when connected; the blue LED goes solid.
6. **Test:** open **Notes** on the iPad, tap into a note, and scan any barcode — the
   text should type into the note. If it types, HID mode is working.

### 2. Enable Driver's License PDF417

1. **Disconnect** the reader from Bluetooth (forget it on the iPad so the blue LED
   blinks fast again). Command barcodes are ignored while connected.
2. Scan the **PDF417 (Driver's License)** enable command barcode
   (Socket guide: *Enable/Disable barcodes → 2D → PDF417 (Driver's License)*).
   Listen for the 3 escalating beeps.
3. Re-pair to the iPad (repeat step 1.4–1.5).

### 3. Set the suffix to Carriage Return

1. Disconnect from Bluetooth again (blue LED blinking fast).
2. Scan the **Suffix – Carriage Return** command barcode
   (Socket guide: *Quick Programming → Prefix/suffix → Suffix – Carriage Return*).
3. Re-pair to the iPad.

### 4. Verify end-to-end in the POS

1. Confirm in **Notes** that scanning the **back (PDF417)** of a driver license types a
   single long string that **begins with `ANSI `** and ends with a new line
   (the carriage return).
2. Open the POS, start a new sale so the **ID gate** shows ("Ready to scan").
3. Scan the license → it should finalize **near-instantly** and proceed to the sale.

If it types in Notes but the POS still errors, the raw string is the source of truth —
confirm it contains `DBB` (DOB) and `DBA` (expiry). Share it with PII redacted for
diagnosis (see `ID_SCAN_CHECKLIST.md`).

---

## Handy resets (from the Socket guide)

- **Pairing reset (make discoverable), no printed barcode:** power on the reader, press
  and **hold scan + power** together, wait for **3 beeps**, release; then **forget** the
  reader from the iPad's Bluetooth list. Both parts are required to fully unpair.
- **Factory reset, no printed barcode:** power on, hold the **scan** button, tap the
  **power** button once, keep holding scan ~15 s until you hear a beep; release → 5
  confirmation beeps, then it powers off. Re-do sections 1–3 afterward.

---

## Notes / gotchas

- **Switching Bluetooth modes** (e.g., HID ↔ App Mode) requires removing the pairing on
  **both** the reader and the iPad first.
- **Do not** use Socket **Companion / CaptureJS App Mode** for the current
  Safari-on-iPad setup — it is local-only and has no iOS Companion service, so it can't
  bridge to a Safari tab. HID/Basic Keyboard Mode is correct here. (App Mode / CaptureSDK
  would only be relevant if a **native iOS app** is built in the future — see
  `ID_SCAN_ROADMAP.md`.)
- Charge fully before first use (battery LED solid green). Use a proper wall charger, not
  a computer USB port.
