# Scanner setup sources: Tera D5100 and Socket DuraScan D760 (R50 S11b)

This file records where every scanner fact and command barcode used by the count page's
**Scanner setup** section came from (`src/lib/pos/scanner-setup-core.ts`). Nothing here is from
memory. The command barcode contents were **decoded from the makers' own PDFs**: each page was
rendered at 300–600 dpi with `pdftoppm` and read with zxing-cpp/pyzbar. Each decoded value was then
matched to the label printed on the same page by vertical position. The `pdftotext -bbox` word
coordinates were compared with the barcode coordinates.

The page re-draws these payloads with our own Code 128 encoder
(`src/lib/printing/code128-core.ts`). Code 128 carries the exact characters, so a re-drawn symbol
with the same payload reads the same as the printed one. A test renders every command barcode the
page shows, decodes it again and checks the round trip (`tests/compliance/r50-s11b-scanner-setup.test.ts`).

## Sources

| Id | Document | URL | sha256 | Notes |
|---|---|---|---|---|
| TERA-UM | Tera D5100 Wireless 2D Barcode Scanner User Manual, Ver.04.1.01 (TR-UMD5100) | https://cdn.shopify.com/s/files/1/0144/3482/8374/files/D5100.pdf?v=1789089271 | daf46cf9…3420 (68 pages, image-only; OCR'd with tesseract) | "An asterisk (*) next to an option indicates the default setting" (p2) |
| SOCKET-700-UG | DuraScan 700 Series User Guide (D700/D720/D730/D740/D745/D750/D755/D760/D764), 245 pages, PDF ModDate 2025-05-02 | https://cdn.socketmobile.com/sitefinity-assets/docs/default-source/downloads/user-guides/d700-d720-d730-d740-d745-d750-d755-d760-d764-user-guide.pdf | 5aec78208f05d2c323ccc057d28b41914912f2fb63aec9677446c098eafb666f | Current guide. p11: "By default, the reader is set to iOS Application Mode." |
| SOCKET-D740-760 | DuraScan Model D740/D760 User Guide (04/2019), 50 pages | https://assets.grandandtoy.com/assets/User-Manual/10/63/1063214220.pdf | a89c7a73c28efbe0fe1deaa62817e5a07248128e94df6f1f964eb052083746b5 | Older guide. p11: "By default, the scanner is set to Basic Mode (HID)." Printed payload text under each barcode. |
| SOCKET-WEB-700 | SocketScan 700 Series User Guide (web) | https://socketmobile.com/readers-accessories/guides/socketscan-700-series | n/a (web page) | Beep meanings, charging, power timers, factory reset. |
| SOCKET-D750-PG | DuraScan D750 Programming Guide (EN) | https://www.cashregisterwarehouse.com.au/files/downloads/Socket-DuraScan-D750-Programming-Guide.pdf | 40099f8771bef8b6f14f4f021fe695bdae20a8f4729504d7bacd58e1d50943c6 | A different model (D750), used only as supporting evidence: "Suffix – Carriage Return (default)". |

## The two guides disagree, so the page does not rely on defaults

The 2019 D740/D760 guide says the factory default is **Basic Mode (HID)**. The 2025 700 Series
guide says the default is **iOS Application Mode**. The answer depends on when the scanner was
made, so the setup tells staff to scan **Basic Mode (HID)** on every Socket, which is safe either
way.

The Tera manual marks **no** default on its Terminators page (p10 printed / PDF p15: Carriage
Return, Line Feed, CR & LF, Horizontal Tab, None, and none has an asterisk). The 2025 Socket guide
marks no default suffix either. So the setup tells staff to scan **Carriage Return** on every
scanner. The page's test box then proves the Enter arrives. (Register U-47.)

## Decoded command barcodes

### Tera D5100 (TERA-UM)

All are Code 128. Printed page = manual page number, PDF page in brackets.

| Label (as printed) | Payload | Page |
|---|---|---|
| Restore Defaults | `%%SpecCode93` | 01 [6] |
| Show Software Version | `%%SpecCode39` | 01 [6] |
| Show Battery Level | `%%SpecCode15` | 02 [7] |
| Power timeout 30s / 60s / 120s / **300s\*** / 600s / 1800s / Never / Immediately | `%%SpecCode30` / `31` / `32` / `33` / `34` / `35` / `36` / `38` | 02–03 [7–8] |
| United States\* (keyboard layout) | `%%SpecCode40` | 04 [9] |
| Real Time Mode\* | `%%SpecCode10` | 05 [10] |
| Storage Mode | `%%SpecCode11` | 06 [11] |
| Upload All Stored Codes | `%%SpecCode16` | 06 [11] |
| Total Records | `%%SpecCode17` | 07 [12] |
| Clear All Stored Codes | `%%SpecCode18` | 07 [12] |
| 2.4GHz Mode | `%%SpecCodeA8` | 08 [13] |
| Pairing | `%%SpecCode99` | 08 [13] |
| USB HID-keyboard\* | `%%SpecCodeA8` (the same payload as 2.4GHz Mode) | 08 [13] |
| Conversion Off\* (letter case) | `%%SpecCodeA5` | 09 [14] |
| Terminator: Carriage Return / Line Feed / CR & LF / Horizontal Tab / None | `%%SpecCode9C` / `9D` / `9E` / `A2` / `9F` | 10 [15] |

Behaviour quoted from TERA-UM:

- **Real Time Mode is the default.** "it transmits scanned data into the host device immediately"
  (p05).
- **Storage Mode** holds scans in memory and "won't transmit the data into the host device when the
  scanner is back in range". Users must scan Upload All Stored Codes (p06).
- **Out of range:** "If the barcode scanner is not connected to the USB dongle when used wireless
  after scanning a test barcode, it will emit a good read beep followed by three quick beeps"
  (p07).
- **Pairing:** "First scan 2.4GHz Mode symbol and then scan Pairing symbol. Be sure to unplug the
  dongle before scanning the codes." (p07)
- **Keyboard layout:** "Your keyboard layout default is a US keyboard … if your keyboard layout
  doesn't match your computer's, the outputs may be incorrect." (p04)
- **Sleep:** "When there is no activity within a specified time period, the scanner turns off"
  (default 300s\*) (p02–03).

### Socket DuraScan D760 (SOCKET-700-UG, SOCKET-D740-760)

All are Code 128 unless noted. SOCKET-D740-760 prints the payload text under each barcode, and it
matches the decoded value.

| Label (as printed) | Payload | Page |
|---|---|---|
| Basic Mode (HID) | `#FNB00F40001#` | D740-760 p45 (decoded at 600 dpi; printed text matches) |
| Application Mode (MFi-SPP) for Apple iOS | `#FNB00F40002#` | D740-760 p45 |
| Suffix – Carriage Return (D730/D740/D745/D750/D755/D760) | `#FNB00F507C60408FFEB020000#` | 700-UG p27 |
| Suffix – Tab | `#FNB00F509C60408FFEB0468090000#` | 700-UG p27 |
| Suffix – Carriage Return & Line Feed | `#FNB00F507C60408FFEB010000#` | 700-UG p27 |
| Data As Is | `#FNB00F507C60408FFEB000000#` | 700-UG p27 |
| 2 Hours (default) | `#FNB012100780005#` | 700-UG p29 |
| Continuous Power for 4 Hours / 8 Hours | `#FNB012100F000F0#` / `#FNB012101E001E0#` | 700-UG p29 |
| Barcode reader Always On | `#FNB012100000000#` | 700-UG p29 |
| HID Keyboard Language: English (default) | `#FNB01430001#` | 700-UG p31 |
| Pairing Reset | `#FNBAB#` | 700-UG p22 |
| Factory Reset | `#FNB00F0#` | 700-UG p23 |

Behaviour quoted from the Socket sources:

- "Make sure the barcode reader is not connected to a host computer or device before scanning a
  command barcode!" (700-UG p26–27). The reader must be disconnected, with the blue light
  flashing.
- "3 Beeps (escalating tone)" means the command scanned successfully. "3 Beeps (escalating tone
  followed by long tone)" means "The command barcode did NOT work" (SOCKET-WEB-700; D740-760 p28).
- Power: it turns off "in 2 hours when idle/inactive while connected and 5 minutes when
  disconnected" (700-UG p29).
- Charging: "Charging from a computer or laptop USB port will not provide enough power"
  (SOCKET-WEB-700). The D740/D760 guide says "Please allow 8 hours uninterrupted charging for the
  initial battery charge" (p7).
- "To switch from one mode to the other you must remove the pairing information from both
  devices" (700-UG p10). That means forgetting the reader in Windows Bluetooth and doing a
  Pairing Reset.
- The reader appears in the Bluetooth list as "D760 [xxxxxx]" or "Socket D760[xxxxxx]" (D740-760
  p14, p17).

## Not found / still to verify on the store's own units

- Neither maker documents how the Excel cursor behaves. Excel moving down after Enter is Excel's
  own default, and the workbook relies on it.
- The Socket web SVG command barcodes (cdn.socketmobile.com) did not decode cleanly with our tools
  (their bars are split into many sub-paths). They were **not** used. The PDF-decoded payloads were
  used instead.
- Whether the store's D760 units ship in Basic Mode or iOS Application Mode is irrelevant. The
  setup scans Basic Mode either way.
