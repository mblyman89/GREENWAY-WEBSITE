/**
 * src/lib/pos/receipt-core.ts
 *
 * PURE register-receipt builder for the POS (Slice B10). No I/O, no React —
 * safe to import from the tsx self-test harness and vitest.
 *
 * Two outputs:
 *  1. `buildPosReceiptHtml` — a self-contained HTML document sized for the
 *     Star TSP100IIIBi at PassPRNT size=3 (576 dots / 72mm printable width,
 *     verified from the Star PassPRNT manual). The SAME HTML is used for the
 *     browser-print fallback, so paper and fallback always match.
 *  2. `buildPassPrntUrl` — the `starpassprnt://v1/print/nopreview` URL that
 *     hands the HTML to Star's PassPRNT iOS app (App Store) which prints on
 *     the paired Bluetooth printer and opens the cash drawer AFTER the print
 *     (`drawer=after`, verified parameter names from the manual).
 *
 * Money is in MINOR UNITS (cents) everywhere, matching the rest of the app.
 * Formatting helpers are REUSED from printing/receipt-core (pure) so the POS
 * receipt and the CloudPRNT pickup receipt can never drift on money/timestamp
 * rendering.
 *
 * Medical: the receipt shows a "MEDICAL — tax exempt sale" banner and the
 * savings line when the sale was carded, but deliberately prints NO card
 * details (no UPID, no dates) — WAC 314-55-090(2) records live in the
 * back-office exempt-sale ledger, not on the customer's paper.
 */
import { formatMoneyMinor, formatReceiptTimestamp } from "@/lib/printing/receipt-core";
import { code128Svg } from "@/lib/printing/code128-core";
import { qrSvg } from "@/lib/printing/qr-core";
import { defaultReturnPolicyText } from "@/lib/pos/returns-core";
import { receiptLogoImgTag } from "@/lib/pos/receipt-logo-core";
import {
  splitReceiptTax,
  exciseTaxLabel,
  salesTaxLabel,
  salesTaxCompositionNote,
  type ReceiptTaxLine,
} from "@/lib/pos/receipt-tax-core";

export type PosReceiptLine = {
  productName: string;
  quantity: number;
  /** Final (post-discount, post-medical-reprice) tax-inclusive unit price. */
  unitPriceMinor: number;
  /** Pre-discount tax-inclusive unit price (for the "was" strike). */
  regularPriceMinor: number;
  /** True when this line's taxes were passed through to a carded patient. */
  medicalTaxOff?: boolean;

  // -- Slice 22b: the "data rich" fields -----------------------------------
  //
  // EVERY field below is OPTIONAL, and that is a hard requirement rather than
  // politeness. Reprints and emailed copies replay FROZEN historical
  // snapshots (see receipt-reprint-core and email-receipt-core) captured
  // before this slice existed. A required field would mean a receipt from
  // last Tuesday could no longer be reprinted for a customer standing at the
  // counter. Absent field => that detail is simply not printed.
  //
  // None of this is new data collection: priceCart() in pos/sale-flow-core
  // already computes all of it and SaleFlow was discarding it at the mapping
  // site. Slice 22b stops throwing it away.

  /** Product category — also what lets the tax split know cannabis vs merch. */
  category?: string | null;
  /** Brand / producer, printed on the detail line. */
  brand?: string | null;
  /** Variant label, e.g. "3.5g" or "Indica 1g". */
  variantLabel?: string | null;
  /** Per-unit weight in grams (null/absent = unknown). */
  unitGrams?: number | null;
  /** Per-unit THC in milligrams, for edibles/beverages. */
  unitThcMg?: number | null;
  /** Name of the promotion that produced the discount, e.g. "Happy Hour". */
  appliedLabel?: string | null;
  /** Retail sales tax was exempted on this line (medical). */
  salesExempt?: boolean;
  /** Cannabis excise was exempted on this line (medical). */
  exciseExempt?: boolean;
};

export type PosReceiptInput = {
  /** Offline client UUID of the sale event — the durable receipt number. */
  saleClientUuid: string;
  /** ISO timestamp when the sale was rung (device clock). */
  soldAtIso: string;
  registerLabel: string;
  lines: PosReceiptLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** Promo/loyalty savings already reflected in unit prices (display only). */
  savingsMinor: number;
  /** Tax passed through to a carded patient (display only). 0 = not medical. */
  medicalSavingsMinor: number;
  /** True when the sale was rung against a validated recognition card. */
  medicalSale: boolean;
  tenderedMinor: number;
  changeMinor: number;
  /**
   * B33 cash rounding — the nickel adjustment applied to the amount due
   * (dueMinor − totalMinor; never 0 when present). TOTAL stays pre-rounded
   * (tax was computed on it, per WA DOR guidance); the receipt prints the
   * adjustment as its OWN line plus the resulting CASH DUE row, the way
   * Square and Toast disclose it. Omitted on non-rounded sales.
   */
  roundingAdjustmentMinor?: number;
  /** B33 — cash amount due after rounding (multiple of 5¢). */
  roundedDueMinor?: number;
  headerText?: string | null;
  footerText?: string | null;
  /**
   * B13 receipt customization — address/contact block printed one centered
   * line each under the header (street, city, phone, license #, …).
   */
  addressLines?: string[];
  /** B13 — "Served by <name>" line (owner toggle showEmployee). */
  servedBy?: string | null;
  /** B13 — hide the "You saved" row even when savings > 0 (owner toggle). */
  hideSavings?: boolean;
  /**
   * B14 loyalty block — printed above the footer when a member is attached
   * (and the owner's showLoyalty toggle is on; caller omits when off).
   */
  loyalty?: {
    memberLabel: string;
    /** Points this sale will earn once synced (device estimate). */
    pointsEarned: number | null;
  } | null;

  // -- Slice 22b presentation switches (all optional, all default-safe) -----
  /**
   * Itemize excise vs sales tax (RCW 69.50.535(1)(a)). Undefined = ON: a
   * cached pre-22b bundle, or an old frozen snapshot being reprinted, still
   * gets the statutory itemization whenever the line data supports it.
   */
  showTaxBreakdown?: boolean;
  /** Print the Greenway wordmark. Undefined = ON. */
  showLogo?: boolean;
  /** Wordmark width in printer dots. Undefined = full 576. */
  logoWidth?: number;
  /** Print the return policy block. Undefined = ON. */
  showReturnPolicy?: boolean;
  /** Return-policy wording. Empty/absent = generated from returns-core. */
  returnPolicyText?: string | null;
  /** Print the per-item detail line. Undefined = ON. */
  showItemDetail?: boolean;
  /** Print the scannable receipt-number code. Undefined = ON. */
  showBarcode?: boolean;
  /** Print the item-count / savings summary strip. Undefined = ON. */
  showSaleSummary?: boolean;
  /**
   * SLICE 23 — the fun pool name for THIS sale, printed under the QR in place
   * of the raw receipt number. Absent/blank = print the real receipt number
   * instead, which is exactly the owner's stated offline fallback: "if we do
   * [go without internet], the fall back can be to just use the real receipt
   * number instead of the overlay."
   */
  displayName?: string | null;
  /**
   * SLICE 23 — render the code as a QR instead of Code 128. Undefined = ON.
   * The escape hatch exists only so a shop with an old 1-D-only scanner can
   * revert; the QR is the default because it error-corrects and Code 128 does
   * not. See lib/printing/qr-core.ts for the full reasoning.
   */
  useQrCode?: boolean;
  /**
   * SLICE 23 — a 1-bit logo printed BELOW the code block and ABOVE the footer,
   * as a `data:image/png;base64,...` URI. Must already be thresholded to pure
   * black-on-white by logo-print-core; this function will not silently accept
   * a photo, because a photo is what produces the black box the owner does not
   * want to see.
   */
  logoDataUri?: string | null;
  /** SLICE 23 — printed logo width in px (receipt body is 576px). Default 220. */
  logoWidthPx?: number;
};

/** Escape text for safe embedding in the receipt HTML. */
export function escapeReceiptHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Short human receipt number from the durable sale UUID (last 8, upper). */
export function receiptNumber(saleClientUuid: string): string {
  const clean = saleClientUuid.replace(/-/g, "");
  return clean.slice(-8).toUpperCase();
}

const DEFAULT_HEADER = "GREENWAY MARIJUANA";
const DEFAULT_FOOTER =
  "This product has intoxicating effects and may be habit forming. Keep out of reach of children. Thank you!";

// ---------------------------------------------------------------------------
// Slice 22b helpers — the "data rich" detail line and the summary strip
// ---------------------------------------------------------------------------

/** Default ON: undefined means "the caller predates this option". */
function onByDefault(v: boolean | undefined): boolean {
  return v !== false;
}

/**
 * Format grams for the detail line: 3.5g, 1g, 0.5g — never "3.50g" and never
 * "3.5000000000000004g" from float drift.
 */
export function formatGrams(grams: number): string {
  const rounded = Math.round(grams * 100) / 100;
  return `${Number(rounded.toFixed(2))}g`;
}

/** Format milligrams of THC: 10mg, 2.5mg. */
export function formatThcMg(mg: number): string {
  const rounded = Math.round(mg * 100) / 100;
  return `${Number(rounded.toFixed(2))}mg`;
}

/**
 * The small grey line printed under a product name.
 *
 * Order is deliberate — brand first (what the customer asks for by name),
 * then size, then potency, then the deal that saved them money. Every part is
 * omitted when unknown, so a sparse historical line simply prints less rather
 * than printing "null" or an empty separator run.
 *
 * Returns "" when there is nothing worth a second line.
 */
export function receiptItemDetailParts(line: PosReceiptLine): string[] {
  const parts: string[] = [];
  const brand = line.brand?.trim();
  if (brand) parts.push(brand);

  // variantLabel is already appended to productName by priceCart when it
  // exists, so printing it again would read "Blue Dream (3.5g) · 3.5g".
  // Weight is the more precise fact, so it wins when both are available.
  if (typeof line.unitGrams === "number" && Number.isFinite(line.unitGrams) && line.unitGrams > 0) {
    parts.push(formatGrams(line.unitGrams));
  } else {
    const variant = line.variantLabel?.trim();
    if (variant && !line.productName.includes(variant)) parts.push(variant);
  }

  if (typeof line.unitThcMg === "number" && Number.isFinite(line.unitThcMg) && line.unitThcMg > 0) {
    parts.push(`THC ${formatThcMg(line.unitThcMg)}`);
  }

  const applied = line.appliedLabel?.trim();
  if (applied) parts.push(applied);

  return parts;
}

/** Per-unit price shown when a line has more than one unit. */
export function receiptUnitPriceNote(line: PosReceiptLine): string {
  if (line.quantity <= 1) return "";
  return `${line.quantity} @ ${formatMoneyMinor(line.unitPriceMinor)} each`;
}

/** Total physical units on the receipt (not distinct products). */
export function receiptItemCount(lines: readonly PosReceiptLine[]): number {
  let n = 0;
  for (const l of lines) n += Math.max(0, Math.round(l.quantity));
  return n;
}

/**
 * Total cannabis weight on the sale, in grams, or null when no line carries a
 * known weight. Customers genuinely ask "how much did I buy" — and it is a
 * useful cross-check against the daily purchase limit.
 */
export function receiptTotalGrams(lines: readonly PosReceiptLine[]): number | null {
  let total = 0;
  let known = false;
  for (const l of lines) {
    if (typeof l.unitGrams === "number" && Number.isFinite(l.unitGrams) && l.unitGrams > 0) {
      total += l.unitGrams * Math.max(0, Math.round(l.quantity));
      known = true;
    }
  }
  if (!known) return null;
  return Math.round(total * 100) / 100;
}

/**
 * Build the scannable Code 128 barcode of the receipt number.
 *
 * The printed receipt number is what returns-core looks a sale up by, and a
 * manager currently retypes it from paper. A scan removes that transcription
 * step (and the transcription error). Rendered as SVG by the dependency-free
 * encoder in printing/code128-core — no image asset, no network.
 *
 * Returns "" if the encoder refuses, so a barcode can never break a receipt.
 */
export function receiptBarcodeSvg(receiptNo: string): string {
  const res = code128Svg(receiptNo, { moduleWidth: 2, height: 70, quietModules: 10 });
  if (!res.ok || !res.svg) return "";
  return res.svg;
}

/**
 * SLICE 23 — the scannable QR of the receipt number.
 *
 * The owner: "i would much rather have a nice pretty QR code instead of the
 * ugly lines barcode", and on what it should carry: "the barcode should be the
 * real receipt number i am guessing … i'll let you make the executive decision
 * on that one, but the text bellow the barcode should definitely be the fun
 * overlay."
 *
 * DECISION: the QR carries the REAL receipt number. Fun names come from a
 * recycling pool and are deliberately non-unique — Slice 23 rotates them
 * precisely so they repeat — so a scan of a fun name could match several
 * different sales. A scan has to resolve to exactly ONE sale to be worth
 * anything at a return counter. The fun name goes in the human-readable line
 * underneath, where being non-unique costs nothing.
 *
 * Level M (~15% recoverable) is chosen over L because thermal receipts fade,
 * crease and live in pockets, and a return may be weeks later. Scale 4 with
 * the spec's 4-module quiet zone keeps the symbol comfortably inside the
 * 576px body while staying well above the scanner's resolution floor.
 *
 * Returns "" if the encoder refuses, so a code can never break a receipt.
 */
export function receiptQrSvg(receiptNo: string): string {
  const res = qrSvg(receiptNo, { level: "M", scale: 4, quietModules: 4 });
  if (!res.ok || !res.svg) return "";
  return res.svg;
}

/**
 * Build the full self-contained receipt HTML. Body width is 576px — the
 * printable width of the TSP100IIIBi at PassPRNT size=3 (Star manual).
 * `format-detection` meta stops iOS from mangling numbers into phone links
 * (recommended by the PassPRNT manual).
 */
export function buildPosReceiptHtml(input: PosReceiptInput): string {
  const header = escapeReceiptHtml((input.headerText ?? DEFAULT_HEADER).trim());
  const footer = escapeReceiptHtml((input.footerText ?? DEFAULT_FOOTER).trim());
  const rows: string[] = [];

  const showDetail = onByDefault(input.showItemDetail);

  for (const line of input.lines) {
    const lineTotal = line.unitPriceMinor * line.quantity;
    const discounted = line.unitPriceMinor < line.regularPriceMinor;
    rows.push(
      `<tr><td class="n">${line.quantity}x ${escapeReceiptHtml(line.productName)}${
        line.medicalTaxOff ? ' <span class="med">MED TAX OFF</span>' : ""
      }${discounted ? ` <s>${formatMoneyMinor(line.regularPriceMinor)}</s>` : ""}</td><td class="a">${formatMoneyMinor(lineTotal)}</td></tr>`,
    );
    if (showDetail) {
      // Slice 22b — the second, smaller line: brand, size, potency, the deal
      // that saved them money, and the per-unit price on multi-unit lines.
      const detail = receiptItemDetailParts(line);
      const unitNote = receiptUnitPriceNote(line);
      const bits = [...detail, unitNote].filter(Boolean);
      if (bits.length > 0) {
        rows.push(
          `<tr><td class="d" colspan="2">${bits.map((b) => escapeReceiptHtml(b)).join(" &middot; ")}</td></tr>`,
        );
      }
    }
  }

  const totals: string[] = [
    `<tr><td class="n">Subtotal (pre-tax)</td><td class="a">${formatMoneyMinor(input.subtotalMinor)}</td></tr>`,
  ];

  // -- RCW 69.50.535(1)(a): the cannabis excise MUST be itemized separately
  // from the state and local retail sales tax. This is the one piece of the
  // receipt Washington legislates, and before this slice we printed a single
  // combined "Tax" row.
  //
  // The split is DERIVED from the same rate constants the sale was priced
  // with and is forced to reconcile to the tax actually charged. When it
  // cannot be trusted — an old frozen snapshot whose lines carry no category,
  // for instance — splitReceiptTax returns null and we fall back to the
  // single combined line. A less detailed TRUE receipt beats a confident
  // wrong number on a tax record.
  const taxSplit = onByDefault(input.showTaxBreakdown)
    ? splitReceiptTax(
        input.lines.map(
          (l): ReceiptTaxLine => ({
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
            category: l.category,
            salesExempt: l.salesExempt,
            exciseExempt: l.exciseExempt,
          }),
        ),
        input.taxMinor,
      )
    : null;

  if (taxSplit && (taxSplit.anyExcise || taxSplit.anySales)) {
    if (taxSplit.anyExcise) {
      totals.push(
        `<tr><td class="n">${escapeReceiptHtml(exciseTaxLabel())}</td><td class="a">${formatMoneyMinor(taxSplit.exciseMinor)}</td></tr>`,
      );
    }
    if (taxSplit.anySales) {
      totals.push(
        `<tr><td class="n">${escapeReceiptHtml(salesTaxLabel())}</td><td class="a">${formatMoneyMinor(taxSplit.salesMinor)}</td></tr>`,
      );
      totals.push(
        `<tr><td class="d" colspan="2">${escapeReceiptHtml(salesTaxCompositionNote())}</td></tr>`,
      );
    }
    totals.push(
      `<tr><td class="n">Total tax</td><td class="a">${formatMoneyMinor(input.taxMinor)}</td></tr>`,
    );
  } else {
    totals.push(
      `<tr><td class="n">Tax</td><td class="a">${formatMoneyMinor(input.taxMinor)}</td></tr>`,
    );
  }
  if (input.savingsMinor > 0 && !input.hideSavings) {
    totals.push(
      `<tr><td class="n">You saved</td><td class="a">-${formatMoneyMinor(input.savingsMinor)}</td></tr>`,
    );
  }
  if (input.medicalSale && input.medicalSavingsMinor > 0) {
    totals.push(
      `<tr><td class="n">Medical savings (tax off)</td><td class="a">-${formatMoneyMinor(input.medicalSavingsMinor)}</td></tr>`,
    );
  }
  totals.push(
    `<tr class="t"><td class="n">TOTAL</td><td class="a">${formatMoneyMinor(input.totalMinor)}</td></tr>`,
  );
  // B33 — cash rounding printed as its OWN line + the resulting CASH DUE,
  // exactly the Square/Toast disclosure pattern. Tax above was computed on
  // the pre-rounded TOTAL (WA DOR interim guidance).
  const adj = input.roundingAdjustmentMinor ?? 0;
  if (adj !== 0 && typeof input.roundedDueMinor === "number") {
    const sign = adj > 0 ? "" : "-";
    totals.push(
      `<tr><td class="n">Cash rounding</td><td class="a">${sign}${formatMoneyMinor(Math.abs(adj))}</td></tr>`,
      `<tr><td class="n">Cash due</td><td class="a">${formatMoneyMinor(input.roundedDueMinor)}</td></tr>`,
    );
  }
  totals.push(
    `<tr><td class="n">Cash tendered</td><td class="a">${formatMoneyMinor(input.tenderedMinor)}</td></tr>`,
    `<tr><td class="n">Change</td><td class="a">${formatMoneyMinor(input.changeMinor)}</td></tr>`,
  );

  const receiptNo = receiptNumber(input.saleClientUuid);

  // -- Slice 22b: the sale summary strip ------------------------------------
  // "what did I actually get" at a glance, above the fine print.
  const summaryBits: string[] = [];
  if (onByDefault(input.showSaleSummary)) {
    const count = receiptItemCount(input.lines);
    summaryBits.push(`${count} item${count === 1 ? "" : "s"}`);
    const grams = receiptTotalGrams(input.lines);
    if (grams != null && grams > 0) summaryBits.push(`${formatGrams(grams)} total`);
    if (input.savingsMinor > 0 && !input.hideSavings) {
      summaryBits.push(`saved ${formatMoneyMinor(input.savingsMinor)}`);
    }
  }

  // -- Slice 22b: the return policy -----------------------------------------
  // Owner wording when set, otherwise generated from the SAME constant the
  // returns screen enforces (pos/returns-core RETURN_WINDOW_DAYS), so the
  // paper can never promise a window we do not honour.
  const policyText = onByDefault(input.showReturnPolicy)
    ? (input.returnPolicyText?.trim() || defaultReturnPolicyText())
    : "";

  // -- SLICE 23: the code block ---------------------------------------------
  // QR by default (error-corrected, square, phone-readable); Code 128 only if
  // the owner explicitly turns useQrCode off. Either way the code carries the
  // REAL receipt number, because a scan must resolve to exactly one sale.
  const wantQr = onByDefault(input.useQrCode);
  const showCode = onByDefault(input.showBarcode);
  let codeSvg = "";
  if (showCode) {
    codeSvg = wantQr ? receiptQrSvg(receiptNo) : receiptBarcodeSvg(receiptNo);
    // If the QR encoder ever refuses, fall back to Code 128 rather than print
    // a receipt with no scannable code at all.
    if (!codeSvg && wantQr) codeSvg = receiptBarcodeSvg(receiptNo);
  }
  const codeClass = wantQr && codeSvg ? "qr" : "barcode";

  // The line UNDER the code: the fun name when this sale has one, otherwise
  // the real receipt number. That fallback IS the offline story — no server,
  // no name, and the receipt reads exactly as it always did.
  const funName = (input.displayName ?? "").trim();
  const codeCaption = funName || receiptNo;
  // A fun name is prose, not a serial: the wide letter-spacing that makes a
  // receipt number readable makes a name look broken.
  const captionClass = funName ? "codename" : "barcodeno";
  // SLICE 25 — the header identifier. Same value, same fallback, one source of
  // truth: whatever this sale is called under the QR is what the header says.
  const headerCode = codeCaption;

  // -- SLICE 23: the logo ----------------------------------------------------
  // Accepted ONLY as a data: URI. A remote URL would make a receipt depend on
  // the network at print time, which is the one thing a register cannot
  // tolerate mid-sale.
  const logoUri = (input.logoDataUri ?? "").trim();
  const logoOk = /^data:image\/(png|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(logoUri);
  const logoWidth = Math.max(40, Math.min(560, Math.round(input.logoWidthPx ?? 220)));

  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="format-detection" content="telephone=no">',
    "<style>",
    "body{width:576px;margin:0;padding:8px 4px;font-family:'Helvetica Neue',Arial,sans-serif;color:#000;}",
    "h1{font-size:34px;text-align:center;margin:0 0 4px;}",
    ".sub{font-size:24px;text-align:center;margin:0 0 8px;}",
    ".addr{font-size:22px;text-align:center;margin:0 0 2px;}",
    ".medbanner{font-size:26px;font-weight:bold;text-align:center;border:3px solid #000;padding:6px;margin:8px 0;}",
    "table{width:100%;border-collapse:collapse;font-size:26px;}",
    "td{padding:4px 0;vertical-align:top;}",
    "td.n{text-align:left;}",
    "td.a{text-align:right;white-space:nowrap;}",
    "tr.t td{font-size:32px;font-weight:bold;border-top:3px solid #000;padding-top:8px;}",
    ".med{font-size:20px;font-weight:bold;border:2px solid #000;padding:0 4px;}",
    "hr{border:none;border-top:2px dashed #000;margin:10px 0;}",
    ".foot{font-size:22px;text-align:center;margin-top:12px;}",
    // Slice 22b — the item/tax detail line. Smaller and indented so it reads
    // as a caption under its product rather than as another product. Thermal
    // paper has no grey, so hierarchy comes from SIZE, not colour.
    "td.d{font-size:20px;text-align:left;padding:0 0 6px 24px;}",
    // The wordmark. display:block + auto margins centre it; explicit
    // dimensions are emitted inline on the tag itself so the offscreen
    // WKWebView measures the right height before it snapshots.
    ".logo{display:block;margin:0 auto 6px;}",
    ".policy{font-size:20px;text-align:center;margin:6px 0 0;line-height:1.35;}",
    ".policyhead{font-size:22px;font-weight:bold;text-align:center;margin:0;}",
    ".summary{font-size:24px;text-align:center;font-weight:bold;margin:0 0 4px;}",
    ".barcode{text-align:center;margin:8px 0 0;}",
    ".barcode svg{width:100%;height:70px;}",
    ".barcodeno{font-size:22px;text-align:center;letter-spacing:3px;margin:2px 0 0;}",
    // SLICE 23 — QR block. Fixed width (NOT 100%): a QR must stay square, and
    // stretching it to the full 576px body is the classic way to make a
    // perfectly valid symbol unscannable.
    ".qr{text-align:center;margin:10px 0 0;}",
    ".qr svg{width:200px;height:200px;display:inline-block;}",
    // The fun name reads as a name, so no letter-spacing and a heavier weight.
    ".codename{font-size:26px;font-weight:bold;text-align:center;margin:4px 0 0;}",
    // SLICE 23 — logo slot. `image-rendering:pixelated` stops the print
    // pipeline from anti-aliasing a 1-bit image back into grey, which on a
    // thermal head is what smears a clean logo into a smudge.
    ".logo{text-align:center;margin:10px 0 0;}",
    ".logo img{max-width:100%;height:auto;image-rendering:pixelated;}",
    "@media print{body{width:auto;}}",
    "</style></head><body>",
    // Slice 22b — the fancy Greenway script wordmark, embedded as a data URI
    // so it prints with no network (see pos/receipt-logo-core for why).
    onByDefault(input.showLogo) ? receiptLogoImgTag(input.logoWidth) : "",
    `<h1>${header}</h1>`,
    ...(input.addressLines ?? [])
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `<p class="addr">${escapeReceiptHtml(l)}</p>`),
    // SLICE 25 — the header names the sale the SAME way the caption under the
    // code does. Owner: "I also want this receipt number to be the fun overlay
    // ... that way the customer knows exactly why there is a strange but fun
    // overlay there instead of the old boring number."
    //
    // The "#" is deliberate and is the whole point of the request: it labels
    // the fun name as this sale's identifier, so a customer reading "Receipt #
    // Purple Rain" understands the odd words ARE the number rather than a
    // stray bit of marketing.
    //
    // headerCode falls back to the real receipt number by exactly the same
    // rule as the caption (offline, empty pool, or pre-Slice-23 reprint), so
    // the two lines can never disagree about what this sale is called. The fun
    // name is operator-supplied text and MUST be escaped here; receiptNo is
    // generated and has no escapable characters, but it goes through the same
    // call so nobody has to reason about which branch is safe.
    `<p class="sub">Receipt # ${escapeReceiptHtml(headerCode)} &middot; ${escapeReceiptHtml(input.registerLabel)}</p>`,
    `<p class="sub">${escapeReceiptHtml(formatReceiptTimestamp(input.soldAtIso))}</p>`,
    input.servedBy?.trim() ? `<p class="sub">Served by ${escapeReceiptHtml(input.servedBy.trim())}</p>` : "",
    input.medicalSale ? '<p class="medbanner">MEDICAL &mdash; TAX EXEMPT SALE</p>' : "",
    "<hr>",
    `<table>${rows.join("")}</table>`,
    "<hr>",
    `<table>${totals.join("")}</table>`,
    // Every bit is escaped individually and the &middot; separator is added
    // afterwards, so the separator survives while the content cannot inject.
    // Mutation testing showed removing the escape here changes nothing today
    // (all three producers emit digits, "g", "$", "." and spaces only — a
    // 1.2M-case probe found zero HTML-significant characters). It is kept
    // because the moment anyone pushes an owner-authored or product-derived
    // string into this strip, the escape is the only thing standing between a
    // product name and the receipt's markup.
    summaryBits.length > 0
      ? `<p class="summary">${summaryBits.map((b) => escapeReceiptHtml(b)).join(" &middot; ")}</p>`
      : "",
    ...(input.loyalty
      ? [
          "<hr>",
          `<p class="sub">Loyalty: ${escapeReceiptHtml(input.loyalty.memberLabel)}</p>`,
          input.loyalty.pointsEarned != null && input.loyalty.pointsEarned > 0
            ? `<p class="sub">Points earned this visit: ${Math.floor(input.loyalty.pointsEarned)}</p>`
            : "",
        ]
      : []),
    ...(policyText
      ? [
          "<hr>",
          '<p class="policyhead">Return Policy</p>',
          `<p class="policy">${escapeReceiptHtml(policyText)}</p>`,
        ]
      : []),
    // SLICE 23 — code, then its caption (fun name when there is one), then the
    // logo, then the footer. This is the owner's requested order verbatim:
    // "a logo to the bottom of the receipt below the QR code and receipt
    // overlay and above the footer message".
    ...(codeSvg
      ? [`<div class="${codeClass}">${codeSvg}</div>`, `<p class="${captionClass}">${escapeReceiptHtml(codeCaption)}</p>`]
      : []),
    ...(logoOk
      ? [`<div class="logo"><img src="${logoUri}" alt="" width="${logoWidth}"></div>`]
      : []),
    "<hr>",
    `<p class="foot">${footer}</p>`,
    "</body></html>",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Refund receipt (POS B16) — same 576px family, printed for counter returns
// ---------------------------------------------------------------------------

export type RefundReceiptLine = {
  productName: string;
  quantity: number;
  /** Refund for this line, minor units (already computed by returns-core). */
  refundMinor: number;
};

export type RefundReceiptInput = {
  /** Client UUID of the ORIGINAL sale — ties the refund paper to the sale. */
  originalSaleClientUuid: string;
  refundedAtIso: string;
  headerText?: string | null;
  footerText?: string | null;
  addressLines?: string[];
  memberLabel: string;
  lines: RefundReceiptLine[];
  refundTotalMinor: number;
  disposition: "restock" | "destroy";
  reason: string;
  processedBy?: string | null;
  /** Loyalty points clawed back on this refund (0 = none / not a member). */
  pointsClawed: number;
};

/**
 * Build the refund receipt HTML — identical page setup (576px, PassPRNT
 * size=3, format-detection meta) and styling family as the sale receipt so
 * the same print path (PassPRNT or browser fallback) handles both. Shows the
 * ORIGINAL receipt number, the refunded lines, cash refunded, and the points
 * adjustment; never any card/medical details.
 */
export function buildRefundReceiptHtml(input: RefundReceiptInput): string {
  const header = escapeReceiptHtml((input.headerText ?? DEFAULT_HEADER).trim());
  const footer = escapeReceiptHtml((input.footerText ?? DEFAULT_FOOTER).trim());
  const rows = input.lines.map(
    (l) =>
      `<tr><td class="n">${l.quantity}x ${escapeReceiptHtml(l.productName)}</td><td class="a">-${formatMoneyMinor(l.refundMinor)}</td></tr>`,
  );
  const totals = [
    `<tr class="t"><td class="n">CASH REFUNDED</td><td class="a">-${formatMoneyMinor(input.refundTotalMinor)}</td></tr>`,
  ];
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="format-detection" content="telephone=no">',
    "<style>",
    "body{width:576px;margin:0;padding:8px 4px;font-family:'Helvetica Neue',Arial,sans-serif;color:#000;}",
    "h1{font-size:34px;text-align:center;margin:0 0 4px;}",
    ".sub{font-size:24px;text-align:center;margin:0 0 8px;}",
    ".addr{font-size:22px;text-align:center;margin:0 0 2px;}",
    ".refbanner{font-size:26px;font-weight:bold;text-align:center;border:3px solid #000;padding:6px;margin:8px 0;}",
    "table{width:100%;border-collapse:collapse;font-size:26px;}",
    "td{padding:4px 0;vertical-align:top;}",
    "td.n{text-align:left;}",
    "td.a{text-align:right;white-space:nowrap;}",
    "tr.t td{font-size:32px;font-weight:bold;border-top:3px solid #000;padding-top:8px;}",
    "hr{border:none;border-top:2px dashed #000;margin:10px 0;}",
    ".foot{font-size:22px;text-align:center;margin-top:12px;}",
    "@media print{body{width:auto;}}",
    "</style></head><body>",
    `<h1>${header}</h1>`,
    ...(input.addressLines ?? [])
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `<p class="addr">${escapeReceiptHtml(l)}</p>`),
    '<p class="refbanner">REFUND &mdash; CUSTOMER RETURN</p>',
    `<p class="sub">Original receipt ${receiptNumber(input.originalSaleClientUuid)}</p>`,
    `<p class="sub">${escapeReceiptHtml(formatReceiptTimestamp(input.refundedAtIso))}</p>`,
    input.processedBy?.trim() ? `<p class="sub">Processed by ${escapeReceiptHtml(input.processedBy.trim())}</p>` : "",
    `<p class="sub">Member: ${escapeReceiptHtml(input.memberLabel)}</p>`,
    "<hr>",
    `<table>${rows.join("")}</table>`,
    "<hr>",
    `<table>${totals.join("")}</table>`,
    input.pointsClawed > 0
      ? `<p class="sub">Loyalty points adjusted: -${Math.floor(input.pointsClawed)}</p>`
      : "",
    `<p class="sub">Reason: ${escapeReceiptHtml(input.reason.replace(/_/g, " "))} &middot; ${
      input.disposition === "destroy" ? "product withdrawn for destruction" : "product restocked"
    }</p>`,
    "<hr>",
    `<p class="foot">${footer}</p>`,
    "</body></html>",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// No-sale slip (POS B17) — the drawer opens ONLY behind a print
// ---------------------------------------------------------------------------

export type NoSaleSlipInput = {
  registerLabel: string;
  openedAtIso: string;
  /** Why the drawer was opened without a sale (3–500 chars, validated upstream). */
  reason: string;
  /** Employee whose PIN owns the register session. */
  openedByName: string;
  /** Manager/lead who approved (PIN-verified server-side). */
  approvedByName: string;
  headerText?: string | null;
  addressLines?: string[];
};

/**
 * Build the NO SALE audit slip. PassPRNT's drawer kick (`drawer=after`,
 * verified from the manual) fires AFTER a print — there is no print-less
 * kick — so the no-sale drawer open always produces this paper record, the
 * same discipline the big POS players enforce. Identical 576px page setup as
 * the sale receipt so the one print path handles everything.
 */
export function buildNoSaleSlipHtml(input: NoSaleSlipInput): string {
  const header = escapeReceiptHtml((input.headerText ?? DEFAULT_HEADER).trim());
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="format-detection" content="telephone=no">',
    "<style>",
    "body{width:576px;margin:0;padding:8px 4px;font-family:'Helvetica Neue',Arial,sans-serif;color:#000;}",
    "h1{font-size:34px;text-align:center;margin:0 0 4px;}",
    ".sub{font-size:24px;text-align:center;margin:0 0 8px;}",
    ".addr{font-size:22px;text-align:center;margin:0 0 2px;}",
    ".banner{font-size:26px;font-weight:bold;text-align:center;border:3px solid #000;padding:6px;margin:8px 0;}",
    ".body{font-size:24px;margin:6px 0;}",
    "hr{border:none;border-top:2px dashed #000;margin:10px 0;}",
    "@media print{body{width:auto;}}",
    "</style></head><body>",
    `<h1>${header}</h1>`,
    ...(input.addressLines ?? [])
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `<p class="addr">${escapeReceiptHtml(l)}</p>`),
    '<p class="banner">NO SALE &mdash; DRAWER OPENED</p>',
    `<p class="sub">${escapeReceiptHtml(input.registerLabel)} &middot; ${escapeReceiptHtml(formatReceiptTimestamp(input.openedAtIso))}</p>`,
    "<hr>",
    `<p class="body">Reason: ${escapeReceiptHtml(input.reason.trim())}</p>`,
    `<p class="body">Opened by: ${escapeReceiptHtml(input.openedByName)}</p>`,
    `<p class="body">Approved by: ${escapeReceiptHtml(input.approvedByName)}</p>`,
    "<hr>",
    '<p class="sub">No merchandise sold. This event is recorded and audited.</p>',
    "</body></html>",
  ]
    .filter(Boolean)
    .join("");
}

// ---------------------------------------------------------------------------
// Star PassPRNT URL (verified from the Star PassPRNT manual)
// ---------------------------------------------------------------------------

export type PassPrntOptions = {
  /** Callback URL PassPRNT returns to after printing (usually location.href). */
  backUrl: string;
  /** Open the cash drawer after the print. Default true (cash-only store). */
  openDrawer?: boolean;
};

/**
 * Build the `starpassprnt://v1/print/nopreview` URL. `size=3` = 576 dots /
 * 72mm — the TSP100IIIBi's printable width. PassPRNT appends
 * `passprnt_code=0&passprnt_message=SUCCESS` to the back URL on success.
 */
export function buildPassPrntUrl(html: string, opts: PassPrntOptions): string {
  const drawer = opts.openDrawer === false ? "" : "&drawer=after&drawerpulse=200";
  return (
    "starpassprnt://v1/print/nopreview?back=" +
    encodeURIComponent(opts.backUrl) +
    "&html=" +
    encodeURIComponent(html) +
    "&size=3" +
    drawer
  );
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPosReceiptCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  ok(escapeReceiptHtml('<b>"A&B"</b>') === "&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;", "html escaped");
  ok(receiptNumber("123e4567-e89b-12d3-a456-426614174000") === "14174000", "receipt number = last 8");

  const base: PosReceiptInput = {
    saleClientUuid: "123e4567-e89b-12d3-a456-426614174000",
    soldAtIso: "2026-07-15T20:00:00.000Z",
    registerLabel: "Register 1",
    lines: [
      { productName: "Blue Dream 3.5g <flower>", quantity: 2, unitPriceMinor: 1463, regularPriceMinor: 1463 },
    ],
    subtotalMinor: 2000,
    taxMinor: 926,
    totalMinor: 2926,
    savingsMinor: 0,
    medicalSavingsMinor: 0,
    medicalSale: false,
    tenderedMinor: 3000,
    changeMinor: 74,
  };

  const html = buildPosReceiptHtml(base);
  ok(html.includes("576px"), "sized for 576 dots (size=3)");
  ok(html.includes('format-detection" content="telephone=no'), "format-detection meta present");
  ok(html.includes("Blue Dream 3.5g &lt;flower&gt;"), "product name escaped");
  ok(html.includes("2x "), "quantity shown");
  ok(html.includes("$29.26"), "line total = unit x qty");
  ok(html.includes("TOTAL") && html.includes("$29.26"), "total row");
  ok(html.includes("Cash tendered") && html.includes("$30.00"), "tendered row");
  ok(html.includes("Change") && html.includes("$0.74"), "change row");
  ok(!html.includes("MEDICAL"), "no medical banner on recreational sale");
  ok(!html.includes("You saved"), "no savings row when zero");
  ok(html.includes("Receipt # 14174000"), "SLICE 25: header labels the identifier with #");
  // SLICE 25 — the header must name the sale the SAME way the caption does.
  const namedHtml = buildPosReceiptHtml({ ...base, displayName: "Purple Rain" });
  ok(namedHtml.includes("Receipt # Purple Rain"), "SLICE 25: header shows the fun name");
  ok(!namedHtml.includes("Receipt # 14174000"), "SLICE 25: header drops the real number when named");
  ok(namedHtml.includes("Purple Rain</p>"), "SLICE 25: caption still shows the fun name");
  const escHtml = buildPosReceiptHtml({ ...base, displayName: "Tom & <b>Jerry</b>" });
  ok(
    escHtml.includes("Receipt # Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;"),
    "SLICE 25: a fun name is HTML-escaped in the header",
  );
  ok(!escHtml.includes("<b>Jerry"), "SLICE 25: no raw markup from a fun name");

  // Medical sale: banner + savings row, discounted strike, NO card details.
  const med = buildPosReceiptHtml({
    ...base,
    lines: [
      {
        productName: "RSO Syringe",
        quantity: 1,
        unitPriceMinor: 1000,
        regularPriceMinor: 1463,
        medicalTaxOff: true,
      },
    ],
    subtotalMinor: 1000,
    taxMinor: 0,
    totalMinor: 1000,
    savingsMinor: 0,
    medicalSavingsMinor: 463,
    medicalSale: true,
    tenderedMinor: 1000,
    changeMinor: 0,
  });
  ok(med.includes("MEDICAL &mdash; TAX EXEMPT SALE"), "medical banner present");
  ok(med.includes("Medical savings (tax off)") && med.includes("-$4.63"), "medical savings row");
  ok(med.includes("MED TAX OFF"), "per-line MED chip");
  ok(med.includes("<s>$14.63</s>"), "regular price struck when discounted");
  ok(!med.toLowerCase().includes("upid"), "no card details on paper");

  // Promo savings row appears when > 0.
  const promo = buildPosReceiptHtml({ ...base, savingsMinor: 200 });
  ok(promo.includes("You saved") && promo.includes("-$2.00"), "promo savings row");

  // B33 — cash rounding: separate line + cash due; TOTAL stays pre-rounded.
  const roundedDown = buildPosReceiptHtml({
    ...base,
    totalMinor: 2926,
    roundingAdjustmentMinor: -1,
    roundedDueMinor: 2925,
    tenderedMinor: 3000,
    changeMinor: 75,
  });
  ok(roundedDown.includes("Cash rounding") && roundedDown.includes("-$0.01"), "rounding line with sign");
  ok(roundedDown.includes("Cash due") && roundedDown.includes("$29.25"), "cash-due row after rounding");
  ok(roundedDown.includes("$29.26"), "TOTAL stays pre-rounded on paper");
  const roundedUp = buildPosReceiptHtml({
    ...base,
    totalMinor: 2923,
    roundingAdjustmentMinor: 2,
    roundedDueMinor: 2925,
    tenderedMinor: 3000,
    changeMinor: 75,
  });
  ok(roundedUp.includes("Cash rounding") && roundedUp.includes("$0.02"), "positive rounding printed");
  ok(!buildPosReceiptHtml(base).includes("Cash rounding"), "no rounding line on exact-penny sales");

  // B13 customization: address block, served-by, savings toggle.
  const custom = buildPosReceiptHtml({
    ...base,
    savingsMinor: 200,
    hideSavings: true,
    addressLines: ["9107 SW State Hwy 3", "  ", "License <413541>"],
    servedBy: "Casey",
  });
  ok(custom.includes('<p class="addr">9107 SW State Hwy 3</p>'), "address line printed");
  ok(custom.includes("License &lt;413541&gt;"), "address line escaped");
  ok(!custom.includes('<p class="addr"></p>'), "blank address lines dropped");
  ok(custom.includes("Served by Casey"), "served-by line printed");
  ok(!custom.includes("You saved"), "savings row suppressed by owner toggle");
  ok(!buildPosReceiptHtml(base).includes("Served by"), "no served-by when omitted");

  // B14 loyalty block.
  const withLoyalty = buildPosReceiptHtml({
    ...base,
    loyalty: { memberLabel: "Jane D. <vip>", pointsEarned: 20 },
  });
  ok(withLoyalty.includes("Loyalty: Jane D. &lt;vip&gt;"), "loyalty member label escaped");
  ok(withLoyalty.includes("Points earned this visit: 20"), "points earned printed");
  const zeroPoints = buildPosReceiptHtml({
    ...base,
    loyalty: { memberLabel: "Jane D.", pointsEarned: 0 },
  });
  ok(zeroPoints.includes("Loyalty: Jane D.") && !zeroPoints.includes("Points earned"), "zero points row omitted");
  ok(!buildPosReceiptHtml(base).includes("Loyalty:"), "no loyalty block when absent");

  // B16 refund receipt: same 576px family, original receipt number, no card data.
  const refund = buildRefundReceiptHtml({
    originalSaleClientUuid: "123e4567-e89b-12d3-a456-426614174000",
    refundedAtIso: "2026-07-16T20:00:00.000Z",
    headerText: "GREENWAY <MARIJUANA>",
    addressLines: ["9107 SW State Hwy 3", ""],
    memberLabel: "Jane D. <vip>",
    lines: [{ productName: "Blue Dream 3.5g <flower>", quantity: 1, refundMinor: 1463 }],
    refundTotalMinor: 1463,
    disposition: "destroy",
    reason: "adverse_reaction",
    processedBy: "Casey",
    pointsClawed: 7,
  });
  ok(refund.includes("576px"), "refund receipt sized for 576 dots");
  ok(refund.includes("REFUND &mdash; CUSTOMER RETURN"), "refund banner present");
  ok(refund.includes("Original receipt 14174000"), "original receipt number printed");
  ok(refund.includes("GREENWAY &lt;MARIJUANA&gt;"), "refund header escaped");
  ok(refund.includes("Blue Dream 3.5g &lt;flower&gt;"), "refund line escaped");
  ok(refund.includes("-$14.63") && refund.includes("CASH REFUNDED"), "refund total row");
  ok(refund.includes("Loyalty points adjusted: -7"), "points clawback printed");
  ok(refund.includes("Member: Jane D. &lt;vip&gt;"), "member label escaped");
  ok(refund.includes("Processed by Casey"), "processed-by printed");
  ok(refund.includes("adverse reaction") && refund.includes("destruction"), "reason + disposition printed");
  ok(!refund.includes('<p class="addr"></p>'), "blank refund address lines dropped");
  const refundNoPoints = buildRefundReceiptHtml({
    originalSaleClientUuid: "123e4567-e89b-12d3-a456-426614174000",
    refundedAtIso: "2026-07-16T20:00:00.000Z",
    memberLabel: "Jane D.",
    lines: [{ productName: "X", quantity: 1, refundMinor: 100 }],
    refundTotalMinor: 100,
    disposition: "restock",
    reason: "defective",
    pointsClawed: 0,
  });
  ok(!refundNoPoints.includes("points adjusted"), "no points row when nothing clawed");
  ok(refundNoPoints.includes("restocked"), "restock disposition printed");
  ok(refundNoPoints.includes(DEFAULT_HEADER), "refund defaults to standard header");

  // No-sale slip (B17): drawer opens only behind this paper record.
  const noSale = buildNoSaleSlipHtml({
    registerLabel: "Register 1",
    openedAtIso: "2026-07-16T20:00:00.000Z",
    reason: "Change for a $20 <swap>",
    openedByName: "Jane D.",
    approvedByName: "Mark L.",
    headerText: "GREENWAY",
    addressLines: ["Port Orchard, WA"],
  });
  ok(noSale.includes("NO SALE &mdash; DRAWER OPENED"), "no-sale banner printed");
  ok(noSale.includes("Change for a $20 &lt;swap&gt;"), "reason escaped + printed");
  ok(noSale.includes("Opened by: Jane D."), "opener named");
  ok(noSale.includes("Approved by: Mark L."), "approver named");
  ok(noSale.includes("Register 1"), "register label printed");
  ok(noSale.includes('body{width:576px'), "same 576px page family as receipts");
  ok(noSale.includes("Port Orchard, WA"), "address block carried");
  ok(!noSale.includes("TOTAL"), "no totals on a no-sale slip");
  const noSaleDefault = buildNoSaleSlipHtml({
    registerLabel: "R",
    openedAtIso: "2026-07-16T20:00:00.000Z",
    reason: "abc",
    openedByName: "A",
    approvedByName: "B",
  });
  ok(noSaleDefault.includes(DEFAULT_HEADER), "no-sale slip defaults to standard header");

  // PassPRNT URL: verified scheme + encoded params + drawer kick.
  const url = buildPassPrntUrl("<html>a&b</html>", { backUrl: "https://pos.example/pos?x=1" });
  ok(url.startsWith("starpassprnt://v1/print/nopreview?back="), "verified scheme + action");
  ok(url.includes(encodeURIComponent("https://pos.example/pos?x=1")), "back url encoded");
  ok(url.includes("&html=" + encodeURIComponent("<html>a&b</html>")), "html encoded");
  ok(url.includes("&size=3"), "size=3 (576 dots)");
  ok(url.includes("&drawer=after&drawerpulse=200"), "drawer kick after print");
  const noDrawer = buildPassPrntUrl("x", { backUrl: "b", openDrawer: false });
  ok(!noDrawer.includes("drawer="), "drawer omitted when disabled");

  console.log(`pos/receipt-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error("pos/receipt-core self-tests failed");
}
