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

## Employee steps (plain language) — Label Studio (D177)

**Where to open it**

| Starting point | Button | What opens |
|---|---|---|
| A cannabis lot | **🏷 Print label** | That lot, copies = 1 (one-per-unit button offered) |
| A product page (cannabis) | 🏷 beside each lot | That lot |
| A received manifest | **🏷 Print labels for this manifest** / 🏷 per line | Every line (rejected-at-dock lines left out) / one line |
| An Other Inventory item | **🏷 Print label** | That item |
| Other Inventory drafts | **🏷 Print labels for all drafts** | Every draft item |
| A keyed-in vendor invoice | **🏷 Labels**, or **🏷 Print labels for this delivery** after saving | Every line, one label per piece received |
| Merch catalogue | **🏷 Reprint label** / **🏷 Open Label Studio** | That item |

**Printing**

1. *Store designs* (top): tap a saved design such as "Re-barcode 2×1 QR". A
   device that has never printed opens on the store default automatically.
2. *Printer & label size*: pick the printer and any vendor's size, or enter a
   custom size. Sizes the printer can't feed are shown but blocked, with the reason.
3. *Code*: **1D barcode** (Code 128), **2D QR code**, or **Retail UPC** (only for a
   real UPC/EAN). Pick which value it carries (lot code, SKU, UPC…). The studio
   warns if that value won't ring up at the register.
4. *What prints*: tick and order the lines (product, price, lot, dates…).
5. *Copies*, then **🖨 Print**. In the dialog choose the printer, paper size =
   the label size, margins **None**, scale **100 %**, no headers/footers.
6. Cannabis: put the sticker **beside** the producer's label, never over it
   (WAC 314-55-105).

**Saving a design for the whole store** (needs migration `0342_label_studio.sql`)

- **＋ Save as a store design** → name it, optionally *make default*. It saves the
  printer, size, code type and lines (not copy counts).
- After changing a design you opened, **Update "…"** saves the change for every
  device. **Make default** and **Remove** are on each card. Removing is an
  archive. Printed labels and the history are untouched.
- Every create / update / default / remove is in the Security Log
  (`label_template.*`).

**Print history.** Each print records who printed it, when, how many labels,
for which lots/items, with which code value, size and code type, and the
manifest or invoice it came from. A single lot or item's studio shows its last
10 prints under **Recent prints**. This answers "what did we put on this jar?"
when a re-barcoded item won't ring up. The log is append-only: the server can
add and read rows, never edit or delete them. Without 0342, printing works
exactly the same; the history is just not kept.

---

# Label Studio (D177) — research basis

> Owner (D177): "I need to be able to select from the various size labels, not
> just rollo but any vendors sizes. I need to be able to switch between 1D and
> 2D barcodes (qr codes) and the info I want on the label." This section is
> the cited fact base the Label Studio is built on. Code:
> `src/lib/printing/label-stock-core.ts` (stock + printer + fit).

## The Rollo X1040's physical limits

| Fact | Value | Source |
|---|---|---|
| Label width the guides accept | **1.57″ – 4.1″** (4 – 10.4 cm) | https://www.rollo.com/rollo-vs-others |
| Resolution | 203 DPI (so 1 dot = 0.00493″) | same |
| Media | Direct thermal only — no ink, no ribbon | https://support.rollo.com/support/solutions/articles/29000050961 |
| Label type | Paper labels with a **gap or perforation**; no clear/film labels; black-mark or punch-hole stock is unreliable | same |
| Recommended sizes | 4×6, 2×1, 2″ round, 2×2 | same |
| After changing stock | Hold the feed button until one beep — it re-measures the label | same |
| Rollo's own stock | 4×6 roll/stack, 2×1 barcode label, 2″ circle label | https://www.rollo.com/shop |

**What the code does with this:** any size narrower than 1.57″ or wider than
4.1″ is shown in the picker but **blocked** with a plain-language reason
(e.g. OnlineLabels RL926 1.5×1, DYMO 30332 1×1, DYMO 30333 two-across). Other
vendors' stock that fits gets a **warning** ("not on Rollo's compatible list —
test one roll first") rather than a block, because size is what we can verify;
media chemistry depends on the batch.

## Vendor stock catalogue (only part numbers we could verify)

- **OnlineLabels Rollo-compatible rolls** — https://www.onlinelabels.com/uses/ro-labels :
  RL785 4×6, FF6497 4×6 fanfold, RL777 2×1 (1″ core), RL778 2×1 (3″ core),
  RL2077 2×0.5, RL938 2×2, RL2676 2.25×1.25 (1,125/roll), RL2763 2.625×1,
  RL928 3×1, RL936 3×1.5, RL940 3×2, RL946 3×3, RL779 4×1, RL1483 4×1.5,
  RL781 4×2, RL942 4×2.5, RL783 4×3, RL951 4×4, RL926 1.5×1, RL2056 1.5×0.5.
- **Zebra Z-Select 4000D** — 10010043 = 3×1, 2,340/roll, 1″ core
  (https://www.barcodesinc.com/zebra/part-10010043.htm); 10015340 =
  2.25×0.75, 3,315/roll (https://www.barcodesinc.com/zebra/part-10015340.htm).
  Other Zebra part numbers could not be verified, so none are listed — staff
  can type any size with **Custom size**.
- **DYMO LabelWriter** — https://labels123.net/blogs/articles/dymo-label-sizes-explained-a-practical-guide-to-dymo-labelwriter-part-numbers :
  30252 & 30320 1-1/8×3-1/2, 30321 1.4×3.5, 30330 3/4×2, 30334 2-1/4×1-1/4,
  30336 1×2-1/8, 30332 1×1, 30333 1/2×1 (two across), 30327 9/16×3-7/16,
  30857 2-1/4×4, 30324 2-1/8×2-3/4, 30373 7/8×15/16.

## Barcode sizing rules we enforce

| Rule | Value | Source |
|---|---|---|
| Code 128 quiet zone | ≥ 10 X each side (PrecisionID also states 0.25″ "whichever is greater"; we enforce 10 X and **warn** below 0.25″ because small labels cannot always fit it) | https://www.precisionid.com/code-128-faq |
| Code 128 minimum X | 7.5 mil (0.0075″) | same |
| Code 128 length | L = (11 C + 35) X | same |
| Code 128 height | ≥ 15 % of length or 0.25″, whichever is greater | same |
| QR quiet zone | 4 modules on all four sides (ISO/IEC 18004) | https://qrcodekit.com/guides/quiet-zone-requirements-for-qr-codes |
| UPC-A / EAN-13 / EAN-8 X-dimension | 80 %–200 % (0.26–0.66 mm); direct thermal on-demand may go to 75 % (0.25 mm) if bar height and quiet zone meet the 80 % minimum | https://gs1ca.org/gs1ca-components/documents/EAN-UPC-Symbol-Reference.pdf |
| UPC-A / EAN-13 bar height | 22.86 mm at 100 %; 18.29 mm at 80 % | same |

At 203 DPI one dot is 0.125 mm, so bar widths are snapped to **whole dots**
(a 2-dot X = 9.85 mil, a 3-dot X = 14.8 mil) — a bar that is 2.4 dots wide
prints as 2 or 3 dots unpredictably and is the classic cause of "it looks fine
but won't scan".

## Compliance guardrail — never cover the producer's label

WAC 314-55-105 requires the producer's label information (UBI, lot number,
net weight, THC/CBD) to be provided "clearly and visibly", and warnings to be
"legible, unobscured, and visible to the consumer"
(https://apps.leg.wa.gov/Wac/default.aspx?cite=314-55-105). A store re-barcode
sticker is **in addition to**, never on top of, that information. The Label
Studio says so on screen, and the SOP repeats it.

## What a store label must encode to scan at the register

`resolveScan` (`src/lib/pos/scan-to-cart-core.ts`) looks a scan up by product
key, then a variant's lot key, then the barcode index, which holds each lot's
`lot_code` and CCRS external id (cannabis) and each non-cannabis item's
`barcode` (UPC/EAN) and `sku`. So a cannabis label encodes the **lot code**;
a non-cannabis label encodes the **SKU** (or the manufacturer UPC when it is
on file). Lookups are case-insensitive. The Label Studio checks this before
printing and warns when the encoded value would not ring up.

## Independent decode proof (D177 S2)

`src/lib/printing/label-barcode-cases.ts` lists every Label Studio barcode
shape at the smallest module size the studio will pick on common stock (Code
128 B and C, UPC-A, UPC-A at 75 %, EAN-13, EAN-8, QR at 10 mil and at level H,
and a 300-dpi profile). `scripts/compliance/label-barcode-dump.ts` writes them
as SVG; `scripts/compliance/label-barcode-roundtrip.py` rasterises each at
**the printer's own dpi** (one pixel per thermal dot, what the head actually
lays down) and decodes it with **zxing-cpp**, an independent decoder. The
results are pinned in `tests/fixtures/label-studio/roundtrip.json`, and
`tests/compliance/d177-label-barcode.test.ts` fails if a drawing changes
without the proof being re-run.

```
npx tsx scripts/compliance/label-barcode-dump.ts /tmp/label-rt
python3 scripts/compliance/label-barcode-roundtrip.py /tmp/label-rt   # pip install zxing-cpp cairosvg pillow
```
