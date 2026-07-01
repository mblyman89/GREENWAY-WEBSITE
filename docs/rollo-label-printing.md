# Rollo Wireless label printing — how it actually connects (research)

> This is the fact-grounded basis for the intake **label reprint** feature
> (Slice 83). Everything below was verified against the Rollo product listing /
> spec sheet and the way Rollo is designed to be used. No guessing.

## The hardware the owner bought

**Rollo Wireless Shipping Label Printer** (model X1040; Amazon ASIN B09VF4Z2WQ).

Verified specs (Rollo / Amazon product page):

- **4×6 direct-thermal** printer (no ink/toner). Also does labels **1.57"–4.1"** wide.
- **203 DPI** print head, **150 mm/s** (about one 4×6 label per second).
- **Wireless**: prints over **Wi-Fi**. Uses **AirPrint** from iPhone / iPad / Mac.
  Supports **Windows, Chromebook, Android, Linux** driverless over Wi-Fi. Also
  connects by **USB**. "Simply connect to Wi-Fi and print."
- Ships with the free **Rollo Ship Manager** app (their own shipping workflow).

## The critical fact for our integration

**The Rollo has NO public cloud-print API or SDK.** Unlike our receipt printer
(Star TSP143IV, which speaks CloudPRNT and *pulls* jobs from our website), the
Rollo is an **operating-system-level, driverless printer**. It prints whatever
the device's **print dialog** sends it — a rendered web page or a PDF.

So we **cannot** push label bytes to the Rollo directly from the server the way
we do with the receipt printer. That would be guessing at a protocol that isn't
published and isn't how the device works. Doing it the wrong (harder-looking)
way would actually be *less* reliable.

## The correct, professional approach (what we build)

Generate a **pixel-accurate 4×6 (203 DPI) printable label page** in the back
office and let the employee **print it to the Rollo from the browser's print
dialog** (the Rollo shows up as a normal AirPrint / Wi-Fi printer on the store
Mac/iPad/PC). This is exactly the flow Rollo documents for non–Ship-Manager
printing, and it is the same "print from the browser" muscle memory staff
already have.

Design decisions, grounded in the specs above:

- **Page geometry:** `@page { size: 4in 6in; margin: 0 }` with a print
  stylesheet, so the browser sends a true 4×6 page and the Rollo does not scale
  or clip it. 203 DPI → a 4×6 label is 812 × 1218 dots; we lay out in inches so
  it is resolution-independent and crisp on the 203-DPI head.
- **Barcode:** **Code 128** encoding of the lot code / product key. Code 128 is
  the standard 1-D symbology for retail/warehouse lots and scans reliably at
  203 DPI. We render it as **inline SVG** from a **pure, dependency-free
  encoder** (`code128-core.ts`) so it is unit-testable and adds no runtime
  dependency and no server round-trip.
- **Human-readable block:** product name, strain, lot code, received quantity,
  unit, and (if present) expiry — so a torn or unscannable label is still usable.
- **Reprint, not first-print:** the owner asked specifically for **label
  reprint** on intake — a lot already exists; we re-render its label on demand.
  Nothing about this touches CCRS or inventory counts; it is a print-only view.

## What this is NOT

- It is **not** a CCRS/METRC tag. WA CCRS is upload-only and does not issue
  package tags; these labels are for the store's own shelf/lot identification and
  scanning. (See `docs/ccrs-rejection-and-returns.md` for the CCRS reality.)
- It is **not** a shipping label — the Rollo Ship Manager app already does
  carrier labels; our feature is the in-store product/lot label.
- It does **not** require any Rollo account, driver install, or cloud service.

## Employee steps (plain language)

1. Open the manifest (Inventory ▸ Vendor intake ▸ the manifest) or the lot.
2. Click **Print label** on a lot line — a clean 4×6 label opens in a new tab.
3. Press **⌘P / Ctrl-P**, pick the **Rollo** printer, confirm paper size **4×6**,
   and print. (First time only: make sure the Rollo is on the same Wi-Fi and
   shows up in the printer list — the Equipment page has setup notes.)
