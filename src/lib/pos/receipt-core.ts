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

export type PosReceiptLine = {
  productName: string;
  quantity: number;
  /** Final (post-discount, post-medical-reprice) tax-inclusive unit price. */
  unitPriceMinor: number;
  /** Pre-discount tax-inclusive unit price (for the "was" strike). */
  regularPriceMinor: number;
  /** True when this line's taxes were passed through to a carded patient. */
  medicalTaxOff?: boolean;
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

  for (const line of input.lines) {
    const lineTotal = line.unitPriceMinor * line.quantity;
    const discounted = line.unitPriceMinor < line.regularPriceMinor;
    rows.push(
      `<tr><td class="n">${line.quantity}x ${escapeReceiptHtml(line.productName)}${
        line.medicalTaxOff ? ' <span class="med">MED TAX OFF</span>' : ""
      }${discounted ? ` <s>${formatMoneyMinor(line.regularPriceMinor)}</s>` : ""}</td><td class="a">${formatMoneyMinor(lineTotal)}</td></tr>`,
    );
  }

  const totals: string[] = [
    `<tr><td class="n">Subtotal (pre-tax)</td><td class="a">${formatMoneyMinor(input.subtotalMinor)}</td></tr>`,
    `<tr><td class="n">Tax</td><td class="a">${formatMoneyMinor(input.taxMinor)}</td></tr>`,
  ];
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
    "@media print{body{width:auto;}}",
    "</style></head><body>",
    `<h1>${header}</h1>`,
    ...(input.addressLines ?? [])
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `<p class="addr">${escapeReceiptHtml(l)}</p>`),
    `<p class="sub">Receipt ${receiptNumber(input.saleClientUuid)} &middot; ${escapeReceiptHtml(input.registerLabel)}</p>`,
    `<p class="sub">${escapeReceiptHtml(formatReceiptTimestamp(input.soldAtIso))}</p>`,
    input.servedBy?.trim() ? `<p class="sub">Served by ${escapeReceiptHtml(input.servedBy.trim())}</p>` : "",
    input.medicalSale ? '<p class="medbanner">MEDICAL &mdash; TAX EXEMPT SALE</p>' : "",
    "<hr>",
    `<table>${rows.join("")}</table>`,
    "<hr>",
    `<table>${totals.join("")}</table>`,
    ...(input.loyalty
      ? [
          "<hr>",
          `<p class="sub">Loyalty: ${escapeReceiptHtml(input.loyalty.memberLabel)}</p>`,
          input.loyalty.pointsEarned != null && input.loyalty.pointsEarned > 0
            ? `<p class="sub">Points earned this visit: ${Math.floor(input.loyalty.pointsEarned)}</p>`
            : "",
        ]
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
  ok(html.includes("Receipt 14174000"), "receipt number printed");

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
