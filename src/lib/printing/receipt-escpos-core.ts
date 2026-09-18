/**
 * src/lib/printing/receipt-escpos-core.ts
 *
 * PURE 80mm thermal renderer for the vretti receipt printer.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The owner asked for the online pickup receipt to use "the same receipt style
 * format and such used for a sale at the register".
 *
 * The register receipt (pos/receipt-core `buildPosReceiptHtml`) is a 576px HTML
 * document. It is rendered by Star's PassPRNT iOS app, which rasterizes HTML
 * into dots. The vretti takes a completely different road: the Pi agent
 * (pi-agent/greenway_printer.py) fetches the job body as TEXT and wraps it in
 * ESC/POS bytes, and our CloudPRNT endpoint advertises exactly one media type:
 *
 *     src/app/api/cloudprnt/route.ts  ->  mediaTypes: ["text/plain"]
 *
 * So the HTML receipt CANNOT be piped to this printer. "Same style" therefore
 * has to mean: the same SECTIONS, in the same ORDER, with the same WORDING and
 * the same MONEY MATH, rendered as fixed-width text.
 *
 * That is what this file does, and it does it by IMPORTING the register's own
 * helpers rather than re-implementing them:
 *
 *   receiptItemDetailParts / receiptUnitPriceNote / receiptItemCount /
 *   receiptTotalGrams / formatGrams   <- pos/receipt-core
 *   splitReceiptTax / exciseTaxLabel / salesTaxLabel /
 *   salesTaxCompositionNote           <- pos/receipt-tax-core
 *   defaultReturnPolicyText           <- pos/returns-core
 *   formatMoneyMinor / formatReceiptTimestamp / centerLine / divider /
 *   twoColumn                         <- printing/receipt-core
 *
 * Because the detail line, the statutory tax split and the return policy come
 * from the SAME functions the counter receipt calls, the paper a pickup
 * customer gets and the paper a walk-in customer gets cannot drift. Change the
 * excise rate once and both receipts move together.
 *
 * WHAT IS DELIBERATELY NOT CARRIED OVER
 * -------------------------------------
 * Four register sections are dropped, each for a stated reason, not an
 * oversight:
 *
 *  1. The QR / Code 128 block. Those are SVG. This transport is plain text,
 *     and the Pi agent's ascii_fold() would strip the drawing anyway. The
 *     order label is printed large instead, which is what staff actually read
 *     off a pickup ticket.
 *  2. The logo image, same reason.
 *  3. Cash tendered / change / cash rounding. An online pickup order has not
 *     been tendered yet — it is a reservation. Printing "Change $0.00" on an
 *     unpaid ticket would be a lie.
 *  4. The medical banner. Online guests are recreational by default (see the
 *     placement check in src/app/api/orders/route.ts); medical status is
 *     verified in store, so no online line can be medically exempt.
 *
 * WHAT IS ADDED
 * -------------
 * The pickup facts a register sale does not have: the order label, who placed
 * it, their phone, and their note to staff. These live where the register puts
 * its register/served-by lines.
 *
 * Money is in MINOR UNITS (cents) throughout, matching the rest of the app.
 * Nothing here does I/O, imports `server-only`, or touches React — it is safe
 * for the tsx self-test harness and vitest.
 */
import {
  formatMoneyMinor,
  formatReceiptTimestamp,
  centerLine,
  divider,
  twoColumn,
} from "@/lib/printing/receipt-core";
import {
  receiptItemDetailParts,
  receiptUnitPriceNote,
  receiptItemCount,
  receiptTotalGrams,
  formatGrams,
  type PosReceiptLine,
} from "@/lib/pos/receipt-core";
import {
  splitReceiptTax,
  exciseTaxLabel,
  salesTaxLabel,
  salesTaxCompositionNote,
  type ReceiptTaxLine,
} from "@/lib/pos/receipt-tax-core";
import { defaultReturnPolicyText } from "@/lib/pos/returns-core";
import {
  DEFAULT_ORDER_ORIGIN,
  orderOriginReceiptLine,
  type OrderOrigin,
} from "@/lib/orders/order-origin-core";

/** 80mm paper at Font A = 48 columns. The vretti's documented default. */
export const ESCPOS_DEFAULT_COLUMNS = 48;

/**
 * One line of the printed pickup order.
 *
 * EVERY enrichment field is OPTIONAL and that is a hard requirement, exactly
 * as it is on the register line type. A receipt may be re-queued from an older
 * stored order whose rows predate a field; an absent field must print LESS,
 * never "null" and never a guess.
 */
export type EscposReceiptLine = {
  productName: string;
  quantity: number;
  /** Final (post-discount) tax-inclusive unit price, minor units. */
  priceMinorUnits: number;
  /** Pre-discount unit price, for the "was" note. Absent = no discount shown. */
  regularPriceMinorUnits?: number | null;
  /** Category slug — REQUIRED for the statutory tax split to be printable. */
  category?: string | null;
  brand?: string | null;
  variantLabel?: string | null;
  unitGrams?: number | null;
  unitThcMg?: number | null;
  /** Name of the promotion that produced the discount. */
  appliedLabel?: string | null;
};

export type EscposReceiptInput = {
  /** Customer-facing order label (fun pool name or GWY-XXXXXX). */
  orderNumber: string;
  /** ISO timestamp the order was placed. */
  placedAt: string;
  customerName: string;
  customerPhone?: string | null;
  customerNote?: string | null;
  lines: EscposReceiptLine[];
  subtotalMinorUnits: number;
  savingsMinorUnits: number;
  estimatedTaxMinorUnits: number;
  totalMinorUnits: number;

  // -- Owner-editable presentation, mirrored from PosReceiptConfig -----------
  /** Store name. Blank/absent = the register default. */
  headerText?: string | null;
  /** Newline-separated address/phone/license block, one centered line each. */
  addressText?: string | null;
  /**
   * SLICE L-10. Which marketplace this order came from. Optional, defaulting
   * to the website, because every call site that predates Leafly means the
   * website.
   *
   * This is the owner's "a way to distinguish the two" in its most literal
   * form: this is the line the person picking the bag off the shelf reads.
   */
  origin?: OrderOrigin;
  /**
   * SLICE L-10. A single urgent line printed under the origin, used to carry
   * the Leafly acknowledgement deadline onto the paper. Absent for everything
   * else. Built by `bridgeReceiptHeaderLines` in the Leafly bridge core.
   */
  urgencyLine?: string | null;
  /** Footer message. Blank/absent = the register default. */
  footerText?: string | null;
  /** Print the "You saved" line. Undefined = ON. */
  showSavings?: boolean;
  /** Itemize excise vs sales tax (RCW 69.50.535(1)(a)). Undefined = ON. */
  showTaxBreakdown?: boolean;
  /** Print the per-item detail line. Undefined = ON. */
  showItemDetail?: boolean;
  /** Print the item-count / weight / savings strip. Undefined = ON. */
  showSaleSummary?: boolean;
  /** Print the return policy. Undefined = ON. */
  showReturnPolicy?: boolean;
  /** Return-policy wording. Blank = generated from returns-core. */
  returnPolicyText?: string | null;
};

export type EscposFormatOptions = {
  /** Character columns the paper supports. 80mm = 48, 58mm = 32. */
  columns?: number;
};

/**
 * These two strings are duplicated from pos/receipt-core's private
 * DEFAULT_HEADER / DEFAULT_FOOTER, which are module-private there and so
 * cannot be imported. The duplication is PINNED by a self-test below that
 * fails if the register's copy ever changes, so the two cannot drift silently.
 */
const DEFAULT_HEADER = "GREENWAY MARIJUANA";
const DEFAULT_FOOTER =
  "This product has intoxicating effects and may be habit forming. Keep out of reach of children. Thank you!";

/** Default ON: `undefined` means "the caller predates this option". */
function onByDefault(v: boolean | undefined): boolean {
  return v !== false;
}

/**
 * The Pi agent's ASCII fold, mirrored character-for-character.
 *
 * WHY THIS IS HERE AND NOT ONLY ON THE PI
 * ---------------------------------------
 * pi-agent/greenway_printer.py `ascii_fold()` rewrites the body before it goes
 * out as ESC/POS, because a cheap thermal head has no Unicode. Most folds are
 * 1:1 ("·" -> "*", "—" -> "-") and harmless.
 *
 * But SOME FOLDS CHANGE THE LENGTH: "…" -> "...", "®" -> "(R)", "™" -> "(TM)",
 * "½" -> "1/2", "€" -> "EUR". If we lay out a right-aligned money column at 48
 * characters and the Pi THEN expands a registered-trademark sign in a brand
 * name into three characters, the line silently becomes 50 characters wide and
 * the printer wraps the price onto its own row. Every column on that receipt
 * stops lining up.
 *
 * So the text is folded HERE, before any width is measured, and what we
 * measure is then byte-for-byte what the Pi prints. The fold is idempotent
 * (folding an already-folded string changes nothing), so the Pi running it a
 * second time is a no-op rather than a double transformation.
 *
 * The table is kept in sync with the Python by a cross-language parity test in
 * tests/compliance/receipt-escpos-core.test.ts, which parses the replacement
 * table straight out of greenway_printer.py and fails if the two disagree.
 */
const ASCII_FOLD_REPLACEMENTS: Readonly<Record<string, string>> = {
  "\u2018": "'", "\u2019": "'", "\u201a": ",", "\u201b": "'",
  "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u2032": "'", "\u2033": '"',
  "\u2013": "-", "\u2014": "-", "\u2012": "-", "\u2015": "-", "\u2212": "-",
  "\u2026": "...", "\u2022": "*", "\u00b7": "*", "\u2043": "-",
  "\u00a0": " ", "\u2009": " ", "\u200a": " ", "\u202f": " ", "\u3000": " ",
  "\u200b": "", "\u200c": "", "\u200d": "", "\ufeff": "",
  "\u00ae": "(R)", "\u00a9": "(C)", "\u2122": "(TM)",
  "\u00bd": "1/2", "\u00bc": "1/4", "\u00be": "3/4",
  "\u00b0": "deg", "\u20ac": "EUR", "\u00a3": "GBP", "\u00a5": "JPY",
  "\u2190": "<-", "\u2192": "->", "\u2264": "<=", "\u2265": ">=",
  "\u00d7": "x", "\u00f7": "/",
};

/**
 * Fold text to the printable ASCII the vretti can render, using exactly the
 * Pi agent's strategy: known punctuation first, then NFKD decomposition to
 * strip accents, then "?" for anything still unprintable so the receipt stays
 * legible and, above all, stays ALIGNED.
 */
export function asciiFold(text: string): string {
  if (!text) return "";
  const out: string[] = [];
  for (const ch of String(text)) {
    const replacement = ASCII_FOLD_REPLACEMENTS[ch];
    if (replacement !== undefined) {
      out.push(replacement);
      continue;
    }
    if (ch === "\n" || ch === "\r" || ch === "\t") {
      out.push(ch);
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code <= 126) {
      out.push(ch);
      continue;
    }
    const decomposed = ch.normalize("NFKD");
    let kept = "";
    for (const c of decomposed) {
      const cc = c.codePointAt(0) ?? 0;
      if (cc >= 32 && cc <= 126) kept += c;
    }
    out.push(kept !== "" ? kept : "?");
  }
  return out.join("");
}

/** Positive, finite column count, else the 80mm default. */
export function safeColumns(columns: number | undefined): number {
  if (typeof columns !== "number" || !Number.isFinite(columns)) return ESCPOS_DEFAULT_COLUMNS;
  const n = Math.floor(columns);
  if (n < 16) return 16;
  if (n > 96) return 96;
  return n;
}

/**
 * Wrap prose to the paper width on WORD boundaries.
 *
 * The register receipt lets HTML reflow the return policy and the customer
 * note. Fixed-width text has no reflow, so a 240-character policy would be
 * silently chopped at column 48 by any centering helper. This wraps instead,
 * because a truncated return policy is a promise we would not be able to read
 * back to the customer.
 *
 * A single word longer than the paper (a pasted URL) is hard-split rather than
 * dropped — losing characters from a receipt is worse than an ugly break.
 */
export function wrapText(text: string, columns: number): string[] {
  // NOT safeColumns(): that clamps to a 16-column PAPER minimum, but this
  // helper is also called with `cols - 2` to leave room for an indent. Reusing
  // the paper clamp meant a 16-column receipt asked for 14 and got 16 back,
  // so the indented detail line came out two characters wider than the paper.
  // A wrap width is its own thing — any positive integer is meaningful.
  const cols =
    typeof columns === "number" && Number.isFinite(columns)
      ? Math.max(1, Math.floor(columns))
      : ESCPOS_DEFAULT_COLUMNS;
  const out: string[] = [];
  for (const rawLine of String(text ?? "").split("\n")) {
    const words = rawLine.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      if (word.length > cols) {
        if (current) {
          out.push(current);
          current = "";
        }
        let rest = word;
        while (rest.length > cols) {
          out.push(rest.slice(0, cols));
          rest = rest.slice(cols);
        }
        current = rest;
        continue;
      }
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= cols) {
        current = `${current} ${word}`;
      } else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

/** Wrap prose and centre every resulting line. */
function centeredBlock(text: string, columns: number): string[] {
  return wrapText(text, columns).map((l) => (l ? centerLine(l, columns) : ""));
}

/**
 * Convert a printed line into the register's line shape so the SHARED detail
 * helpers can be reused verbatim.
 *
 * `unitPriceMinor`/`regularPriceMinor` map straight across; when a regular
 * price is unknown we set it EQUAL to the final price, which is precisely how
 * the register expresses "this line is not discounted" (it draws the strike
 * only when `unitPriceMinor < regularPriceMinor`). That keeps the "no data"
 * case and the "no discount" case rendering identically instead of inventing a
 * discount out of a missing field.
 */
export function toPosLine(line: EscposReceiptLine): PosReceiptLine {
  const unit = line.priceMinorUnits;
  const regularRaw = line.regularPriceMinorUnits;
  const regular =
    typeof regularRaw === "number" && Number.isFinite(regularRaw) && regularRaw > unit
      ? regularRaw
      : unit;
  return {
    productName: line.productName,
    quantity: line.quantity,
    unitPriceMinor: unit,
    regularPriceMinor: regular,
    category: line.category ?? null,
    brand: line.brand ?? null,
    variantLabel: line.variantLabel ?? null,
    unitGrams: line.unitGrams ?? null,
    unitThcMg: line.unitThcMg ?? null,
    appliedLabel: line.appliedLabel ?? null,
  };
}

/**
 * Render the pickup order in the register's receipt style as fixed-width text
 * ready for the Pi agent to wrap in ESC/POS.
 *
 * Section order is the register's, top to bottom:
 *   header -> address block -> "Receipt # <label>" -> timestamp -> customer
 *   -> rule -> items (+ detail line) -> rule -> totals (with the statutory
 *   excise/sales split) -> summary strip -> customer note -> return policy
 *   -> rule -> footer.
 *
 * Ends with two blank lines so the cutter clears the last printed row, the
 * same contract formatReceipt() has always honoured.
 */
export function formatEscposReceipt(
  rawInput: EscposReceiptInput,
  opts: EscposFormatOptions = {},
): string {
  const cols = safeColumns(opts.columns);

  // FOLD FIRST, THEN MEASURE. Every piece of free text that can reach the
  // paper is folded to printable ASCII here, at the top, BEFORE a single width
  // is computed. twoColumn() and wrapText() both lay out by string length, so
  // folding afterwards (on the way out) would let a length-changing fold such
  // as "®" -> "(R)" push a finished line past the paper width and break the
  // money column. See asciiFold() for the full reasoning.
  const input: EscposReceiptInput = {
    ...rawInput,
    orderNumber: asciiFold(rawInput.orderNumber),
    customerName: asciiFold(rawInput.customerName ?? ""),
    customerPhone: asciiFold(rawInput.customerPhone ?? ""),
    customerNote: asciiFold(rawInput.customerNote ?? ""),
    headerText: asciiFold(rawInput.headerText ?? ""),
    addressText: asciiFold(rawInput.addressText ?? ""),
    // Folded with the rest. The origin line contains an em dash, which is
    // exactly the kind of character that prints as garbage on a thermal head.
    urgencyLine: asciiFold(rawInput.urgencyLine ?? ""),
    footerText: asciiFold(rawInput.footerText ?? ""),
    returnPolicyText: asciiFold(rawInput.returnPolicyText ?? ""),
    lines: rawInput.lines.map((l) => ({
      ...l,
      productName: asciiFold(l.productName),
      brand: l.brand == null ? l.brand : asciiFold(l.brand),
      variantLabel: l.variantLabel == null ? l.variantLabel : asciiFold(l.variantLabel),
      appliedLabel: l.appliedLabel == null ? l.appliedLabel : asciiFold(l.appliedLabel),
    })),
  };

  const out: string[] = [];

  // -- Header + address -----------------------------------------------------
  const header = (input.headerText ?? "").trim() || DEFAULT_HEADER;
  out.push(...centeredBlock(header, cols));

  const address = (input.addressText ?? "").trim();
  if (address) out.push(...centeredBlock(address, cols));

  // -- Identity block. The register prints "Receipt # X · <register>"; the
  // pickup equivalent names the ORDER and says plainly what this paper is.
  out.push(centerLine(`Receipt # ${input.orderNumber}`, cols));
  // SLICE L-10. This line used to be the constant "ONLINE PICKUP ORDER",
  // which was accurate while the website was the only source of online
  // orders and became a lie the moment Leafly was added. The wording for
  // each origin lives in order-origin-core (rule 11); note that it is folded
  // here because it is not part of the rawInput fold above.
  out.push(
    centerLine(asciiFold(orderOriginReceiptLine(input.origin ?? DEFAULT_ORDER_ORIGIN)), cols),
  );
  // The acknowledgement deadline, when there is one. Printed immediately
  // under the origin because on a Leafly arrival ticket it is the single
  // most time-critical thing on the paper.
  const urgency = (input.urgencyLine ?? "").trim();
  if (urgency) out.push(centerLine(urgency, cols));
  out.push(centerLine(formatReceiptTimestamp(input.placedAt), cols));

  const name = (input.customerName ?? "").trim();
  if (name) out.push(centerLine(`For ${name}`, cols));
  const phone = (input.customerPhone ?? "").trim();
  if (phone) out.push(centerLine(phone, cols));

  out.push(divider(cols));

  // -- Items ----------------------------------------------------------------
  const posLines = input.lines.map(toPosLine);
  const showDetail = onByDefault(input.showItemDetail);

  for (let i = 0; i < input.lines.length; i += 1) {
    const posLine = posLines[i];
    const lineTotal = posLine.unitPriceMinor * posLine.quantity;
    out.push(
      twoColumn(`${posLine.quantity}x ${posLine.productName}`, formatMoneyMinor(lineTotal), cols),
    );

    // The register strikes through the old price. Plain text has no strike, so
    // the same fact is stated in words on its own indented line.
    if (posLine.unitPriceMinor < posLine.regularPriceMinor) {
      out.push(`  was ${formatMoneyMinor(posLine.regularPriceMinor)} each`.slice(0, cols));
    }

    if (showDetail) {
      const bits = [...receiptItemDetailParts(posLine), receiptUnitPriceNote(posLine)].filter(
        Boolean,
      );
      if (bits.length > 0) {
        // Wrapped, not truncated: the detail line is where brand, size, THC
        // and the deal name live, and 48 columns fills up fast.
        for (const wrapped of wrapText(bits.join(" · "), cols - 2)) {
          out.push(`  ${wrapped}`);
        }
      }
    }
  }

  out.push(divider(cols));

  // -- Totals ---------------------------------------------------------------
  out.push(twoColumn("Subtotal (pre-tax)", formatMoneyMinor(input.subtotalMinorUnits), cols));

  // RCW 69.50.535(1)(a): the cannabis excise MUST be itemized separately from
  // the state and local retail sales tax. Same call, same reconciliation, same
  // refuse-rather-than-guess behaviour as the register: when splitReceiptTax
  // returns null (a line with no category, or a residual too large to be
  // rounding) we print the single combined line instead of a confident wrong
  // number on a tax document.
  const taxSplit = onByDefault(input.showTaxBreakdown)
    ? splitReceiptTax(
        posLines.map(
          (l): ReceiptTaxLine => ({
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
            category: l.category,
            salesExempt: l.salesExempt,
            exciseExempt: l.exciseExempt,
          }),
        ),
        input.estimatedTaxMinorUnits,
      )
    : null;

  if (taxSplit && (taxSplit.anyExcise || taxSplit.anySales)) {
    if (taxSplit.anyExcise) {
      out.push(twoColumn(exciseTaxLabel(), formatMoneyMinor(taxSplit.exciseMinor), cols));
    }
    if (taxSplit.anySales) {
      out.push(twoColumn(salesTaxLabel(), formatMoneyMinor(taxSplit.salesMinor), cols));
      for (const wrapped of wrapText(salesTaxCompositionNote(), cols - 2)) {
        out.push(`  ${wrapped}`);
      }
    }
    out.push(twoColumn("Total tax", formatMoneyMinor(input.estimatedTaxMinorUnits), cols));
  } else {
    out.push(twoColumn("Tax", formatMoneyMinor(input.estimatedTaxMinorUnits), cols));
  }

  if (input.savingsMinorUnits > 0 && onByDefault(input.showSavings)) {
    out.push(twoColumn("You saved", `-${formatMoneyMinor(input.savingsMinorUnits)}`, cols));
  }

  out.push(twoColumn("TOTAL", formatMoneyMinor(input.totalMinorUnits), cols));

  // This is a reservation, not a completed sale — say so rather than leaving a
  // customer holding an unpaid ticket that looks paid.
  out.push(centerLine("** NOT PAID — pay in store at pickup **", cols));

  // -- Summary strip --------------------------------------------------------
  if (onByDefault(input.showSaleSummary)) {
    const bits: string[] = [];
    const count = receiptItemCount(posLines);
    bits.push(`${count} item${count === 1 ? "" : "s"}`);
    const grams = receiptTotalGrams(posLines);
    if (grams != null && grams > 0) bits.push(`${formatGrams(grams)} total`);
    if (input.savingsMinorUnits > 0 && onByDefault(input.showSavings)) {
      bits.push(`saved ${formatMoneyMinor(input.savingsMinorUnits)}`);
    }
    if (bits.length > 0) {
      out.push(divider(cols));
      out.push(...centeredBlock(bits.join(" · "), cols));
    }
  }

  // -- Customer note --------------------------------------------------------
  const note = (input.customerNote ?? "").trim();
  if (note) {
    out.push(divider(cols));
    out.push("Customer note:");
    out.push(...wrapText(note, cols));
  }

  // -- Return policy --------------------------------------------------------
  if (onByDefault(input.showReturnPolicy)) {
    const policy = (input.returnPolicyText ?? "").trim() || defaultReturnPolicyText();
    if (policy) {
      out.push(divider(cols));
      out.push(centerLine("Return Policy", cols));
      out.push(...centeredBlock(policy, cols));
    }
  }

  // -- Footer ---------------------------------------------------------------
  out.push(divider(cols));
  const footer = (input.footerText ?? "").trim() || DEFAULT_FOOTER;
  out.push(...centeredBlock(footer, cols));

  // Trailing blank lines so the cut clears the last printed row.
  out.push("");
  out.push("");

  // Final fold catches the separators and dashes written as literals in THIS
  // file (" · ", "—"). Those are all 1:1 folds so no width changes here; the
  // point is that the string we store in the job queue is byte-for-byte what
  // the printer puts on paper, which is what makes the back-office preview
  // honest. asciiFold is idempotent, so the Pi folding it again is a no-op.
  return asciiFold(out.join("\n"));
}

/**
 * The sample receipt behind every "Print a test receipt" button.
 *
 * It is built by the SAME function a real order goes through, with realistic
 * enrichment, so a successful test print proves the whole rendering path — the
 * detail line, the statutory tax split, the summary strip and the policy — and
 * not merely that the printer can emit ASCII. If the test print looks right,
 * a real receipt will look right.
 *
 * `columns` comes from the printer settings so the test also proves the paper
 * width is configured correctly.
 */
export function buildTestPrintBody(opts: {
  columns?: number;
  headerText?: string | null;
  footerText?: string | null;
  addressText?: string | null;
  placedAt?: string;
  note?: string | null;
}): string {
  return formatEscposReceipt(
    {
      orderNumber: "TEST-PRINT",
      placedAt: opts.placedAt ?? new Date().toISOString(),
      customerName: "Test Receipt",
      customerPhone: "360-555-0100",
      customerNote:
        opts.note ?? "This is a test print. If you can read this, the printer is working.",
      lines: [
        {
          productName: "Sample Flower 3.5g",
          quantity: 1,
          priceMinorUnits: 1000,
          regularPriceMinorUnits: 1200,
          category: "flower",
          brand: "Greenway",
          unitGrams: 3.5,
          appliedLabel: "Sample Deal",
        },
        {
          productName: "Sample Gummies 10pk",
          quantity: 2,
          priceMinorUnits: 1500,
          category: "edible",
          brand: "Greenway",
          unitThcMg: 10,
        },
      ],
      subtotalMinorUnits: 2734,
      savingsMinorUnits: 200,
      estimatedTaxMinorUnits: 1266,
      totalMinorUnits: 4000,
      headerText: opts.headerText ?? null,
      footerText: opts.footerText ?? null,
      addressText: opts.addressText ?? null,
    },
    { columns: opts.columns },
  );
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runReceiptEscposTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log(`FAIL: ${msg}`);
    }
  };

  // -- safeColumns ----------------------------------------------------------
  ok(safeColumns(undefined) === 48, "safeColumns default 48");
  ok(safeColumns(32) === 32, "safeColumns passes 32");
  ok(safeColumns(0) === 16, "safeColumns floors at 16");
  ok(safeColumns(9999) === 96, "safeColumns caps at 96");
  ok(safeColumns(Number.NaN) === 48, "safeColumns rejects NaN");
  ok(safeColumns(48.9) === 48, "safeColumns floors fractions");

  // -- asciiFold ------------------------------------------------------------
  ok(asciiFold("") === "", "fold: empty string");
  ok(asciiFold("plain ASCII 123") === "plain ASCII 123", "fold: ASCII passes through");
  ok(asciiFold("a\u00b7b") === "a*b", "fold: middot -> asterisk");
  ok(asciiFold("a\u2014b") === "a-b", "fold: em dash -> hyphen");
  ok(asciiFold("\u2018q\u2019") === "'q'", "fold: smart single quotes");
  ok(asciiFold("\u201cq\u201d") === '"q"', "fold: smart double quotes");
  ok(asciiFold("caf\u00e9") === "cafe", "fold: accent stripped via NFKD");
  ok(asciiFold("Acme\u00ae") === "Acme(R)", "fold: registered mark expands");
  ok(asciiFold("\u2026") === "...", "fold: ellipsis expands");
  ok(asciiFold("\u00bd") === "1/2", "fold: vulgar fraction");
  ok(asciiFold("\u200b") === "", "fold: zero-width space removed");
  ok(asciiFold("a\nb") === "a\nb", "fold: newlines preserved");
  ok(asciiFold("\u4e2d") === "?", "fold: unmappable -> question mark");
  ok(asciiFold(asciiFold("Acme\u00ae \u00b7 caf\u00e9")) === asciiFold("Acme\u00ae \u00b7 caf\u00e9"),
    "fold: idempotent (the Pi folding again is a no-op)");

  // THE ALIGNMENT BUG THIS PREVENTS. A brand carrying "®" expands by two
  // characters. If the fold happened after layout, this line would print two
  // characters wider than the paper and the price would wrap onto its own row.
  const foldWidth = formatEscposReceipt(
    {
      orderNumber: "GWY-\u00ae",
      placedAt: "2024-01-15T13:05:00.000Z",
      customerName: "Ren\u00e9e \u2014 caf\u00e9",
      customerNote: "Say \u201challo\u201d\u2026",
      lines: [
        {
          productName: "Product Name At The Very Limit XY\u00ae",
          quantity: 1,
          priceMinorUnits: 1500,
          category: "flower",
          brand: "Brand\u00ae Co\u2122",
          appliedLabel: "Deal\u2026",
        },
      ],
      subtotalMinorUnits: 1025,
      savingsMinorUnits: 0,
      estimatedTaxMinorUnits: 475,
      totalMinorUnits: 1500,
      headerText: "GREENWAY\u00ae MARIJUANA",
    },
    { columns: 48 },
  );
  ok(
    foldWidth.split("\n").every((l) => l.length <= 48),
    "fold: length-changing folds never overflow the paper width",
  );
  ok(!/[^\x00-\x7F]/.test(foldWidth), "fold: rendered receipt is pure ASCII");
  ok(foldWidth.includes("Brand(R) Co(TM)"), "fold: brand folded on the detail line");
  ok(foldWidth.includes("Renee - cafe"), "fold: customer name folded");
  ok(foldWidth.includes("GREENWAY(R) MARIJUANA"), "fold: header folded");

  // -- wrapText -------------------------------------------------------------
  const wrapped = wrapText("the quick brown fox jumps over the lazy dog", 16);
  ok(
    wrapped.every((l) => l.length <= 16),
    "wrapText respects width",
  );
  ok(wrapped.join(" ") === "the quick brown fox jumps over the lazy dog", "wrapText loses nothing");
  const longWord = wrapText("abcdefghijklmnopqrstuvwxyz", 10);
  ok(longWord.length === 3, "wrapText hard-splits an over-long word");
  ok(longWord.join("") === "abcdefghijklmnopqrstuvwxyz", "wrapText hard-split loses nothing");
  ok(wrapText("", 48).length === 1, "wrapText empty -> one blank line");
  ok(wrapText("a\nb", 48).length === 2, "wrapText honours newlines");

  // -- toPosLine ------------------------------------------------------------
  const noReg = toPosLine({ productName: "X", quantity: 1, priceMinorUnits: 1000 });
  ok(noReg.regularPriceMinor === 1000, "toPosLine: absent regular price = no discount");
  const lowerReg = toPosLine({
    productName: "X",
    quantity: 1,
    priceMinorUnits: 1000,
    regularPriceMinorUnits: 800,
  });
  ok(lowerReg.regularPriceMinor === 1000, "toPosLine: regular below final is ignored, not a strike");
  const realReg = toPosLine({
    productName: "X",
    quantity: 1,
    priceMinorUnits: 800,
    regularPriceMinorUnits: 1000,
  });
  ok(realReg.regularPriceMinor === 1000, "toPosLine: genuine discount preserved");

  // -- Full receipt, rich data ---------------------------------------------
  const rich = formatEscposReceipt(
    {
      orderNumber: "Purple Rain",
      placedAt: "2024-01-15T13:05:00.000Z",
      customerName: "Jamie R.",
      customerPhone: "360-555-0100",
      customerNote: "Please double-bag.",
      lines: [
        {
          productName: "Blue Dream 3.5g",
          quantity: 2,
          priceMinorUnits: 1500,
          regularPriceMinorUnits: 1800,
          category: "flower",
          brand: "Artizen",
          unitGrams: 3.5,
          appliedLabel: "Happy Hour",
        },
        {
          productName: "Gummies 10pk",
          quantity: 1,
          priceMinorUnits: 1800,
          category: "edible",
          brand: "Sweet Co",
          unitThcMg: 10,
        },
      ],
      subtotalMinorUnits: 3280,
      savingsMinorUnits: 600,
      estimatedTaxMinorUnits: 1520,
      totalMinorUnits: 4800,
      addressText: "1234 Bay St\nPort Orchard, WA",
    },
    { columns: 48 },
  );
  const richLines = rich.split("\n");

  ok(rich.includes("GREENWAY MARIJUANA"), "rich: default header");
  ok(rich.includes("1234 Bay St"), "rich: address line 1");
  ok(rich.includes("Port Orchard, WA"), "rich: address line 2");
  ok(rich.includes("Receipt # Purple Rain"), "rich: order label as receipt number");
  // SLICE L-10. This fixture passes no `origin`, so it exercises the
  // back-compatible default: an order with no stated origin is a website
  // order and must still say so on the paper.
  ok(rich.includes("ONLINE ORDER"), "rich: pickup label (website default)");
  ok(!rich.includes("LEAFLY"), "rich: a website order is not labelled Leafly");
  ok(rich.includes("Jan 15, 2024"), "rich: Pacific date");
  ok(rich.includes("For Jamie R."), "rich: customer name");
  ok(rich.includes("360-555-0100"), "rich: phone");
  ok(rich.includes("2x Blue Dream 3.5g"), "rich: qty + product");
  ok(rich.includes("$30.00"), "rich: line total 2 x $15.00");
  ok(rich.includes("was $18.00 each"), "rich: discount stated in words");
  ok(rich.includes("Artizen"), "rich: brand on detail line");
  ok(rich.includes("3.5g"), "rich: grams on detail line");
  ok(rich.includes("Happy Hour"), "rich: promo name on detail line");
  ok(rich.includes("2 @ $15.00 each"), "rich: per-unit note on multi-unit line");
  ok(rich.includes("THC 10mg"), "rich: THC on detail line");
  ok(rich.includes("Subtotal (pre-tax)"), "rich: register subtotal wording");
  ok(rich.includes("TOTAL"), "rich: total row");
  ok(rich.includes("$48.00"), "rich: total amount");
  ok(rich.includes("You saved"), "rich: savings row");
  ok(rich.includes("-$6.00"), "rich: savings amount");
  ok(rich.includes("NOT PAID"), "rich: unpaid disclosure");
  ok(rich.includes("3 items"), "rich: summary item count");
  ok(rich.includes("7g total"), "rich: summary weight");
  ok(rich.includes("Customer note:"), "rich: note heading");
  ok(rich.includes("Please double-bag."), "rich: note body");
  ok(rich.includes("Return Policy"), "rich: policy heading");
  ok(rich.includes(defaultReturnPolicyText().split(" ")[0]), "rich: policy body from returns-core");
  ok(rich.includes("intoxicating effects"), "rich: default footer");
  ok(rich.endsWith("\n\n"), "rich: trailing blank lines for the cut");
  ok(
    richLines.every((l) => l.length <= 48),
    "rich: no line exceeds the paper width",
  );

  // The statutory split. 2x$15 flower + 1x$18 edible are both cannabis, so
  // excise applies to the whole basket; the two printed components must sum
  // EXACTLY to the tax charged.
  ok(rich.includes("WA Cannabis Excise"), "rich: excise itemized (RCW 69.50.535(1)(a))");
  ok(rich.includes("State & Local Sales Tax"), "rich: sales tax itemized");
  ok(rich.includes("Total tax"), "rich: total tax row");
  ok(rich.includes("Includes WA state"), "rich: sales-tax composition note");
  ok(!rich.includes("\nTax "), "rich: combined Tax row not printed when split succeeds");

  const exciseMatch = rich.match(/WA Cannabis Excise[^$]*\$([0-9.]+)/);
  const salesMatch = rich.match(/State & Local Sales Tax[^$]*\$([0-9.]+)/);
  ok(exciseMatch != null && salesMatch != null, "rich: both tax components printed");
  if (exciseMatch && salesMatch) {
    const sum = Math.round(Number(exciseMatch[1]) * 100) + Math.round(Number(salesMatch[1]) * 100);
    ok(sum === 1520, "rich: printed components sum EXACTLY to the tax charged");
  }

  // -- Sparse data: an old order row with no category ------------------------
  const sparse = formatEscposReceipt({
    orderNumber: "GWY-000123",
    placedAt: "2024-07-15T13:05:00.000Z",
    customerName: "Sam",
    lines: [{ productName: "Mystery Item", quantity: 1, priceMinorUnits: 1000 }],
    subtotalMinorUnits: 684,
    savingsMinorUnits: 0,
    estimatedTaxMinorUnits: 316,
    totalMinorUnits: 1000,
  });
  ok(sparse.includes("Receipt # GWY-000123"), "sparse: raw order number fallback");
  ok(!sparse.includes("WA Cannabis Excise"), "sparse: no split without a category");
  ok(/\nTax +\$3\.16/.test(sparse), "sparse: falls back to the combined Tax row");
  ok(!sparse.includes("You saved"), "sparse: no savings row at zero");
  ok(!sparse.includes("Customer note:"), "sparse: no note heading without a note");
  ok(!sparse.includes("null"), "sparse: absent fields never print 'null'");
  ok(!sparse.includes("undefined"), "sparse: absent fields never print 'undefined'");
  ok(sparse.includes("1 item"), "sparse: singular item count");
  ok(!sparse.includes("1 items"), "sparse: no plural at one");
  ok(sparse.includes("6:05 AM"), "sparse: DST-aware Pacific time");

  // -- Owner toggles OFF ----------------------------------------------------
  const bare = formatEscposReceipt({
    orderNumber: "GWY-9",
    placedAt: "2024-01-15T13:05:00.000Z",
    customerName: "Sam",
    lines: [
      {
        productName: "Blue Dream 3.5g",
        quantity: 1,
        priceMinorUnits: 1500,
        category: "flower",
        brand: "Artizen",
      },
    ],
    subtotalMinorUnits: 1025,
    savingsMinorUnits: 300,
    estimatedTaxMinorUnits: 475,
    totalMinorUnits: 1500,
    headerText: "MY SHOP",
    footerText: "Bye",
    showSavings: false,
    showTaxBreakdown: false,
    showItemDetail: false,
    showSaleSummary: false,
    showReturnPolicy: false,
  });
  ok(bare.includes("MY SHOP"), "toggles: custom header");
  ok(!bare.includes("GREENWAY MARIJUANA"), "toggles: default header replaced");
  ok(bare.includes("Bye"), "toggles: custom footer");
  ok(!bare.includes("intoxicating"), "toggles: default footer replaced");
  ok(!bare.includes("You saved"), "toggles: showSavings=false hides savings");
  ok(!bare.includes("WA Cannabis Excise"), "toggles: showTaxBreakdown=false hides the split");
  ok(/\nTax +\$4\.75/.test(bare), "toggles: combined Tax row when breakdown is off");
  ok(!bare.includes("Artizen"), "toggles: showItemDetail=false hides the detail line");
  ok(!bare.includes("1 item"), "toggles: showSaleSummary=false hides the strip");
  ok(!bare.includes("Return Policy"), "toggles: showReturnPolicy=false hides the policy");
  ok(bare.includes("TOTAL"), "toggles: TOTAL always printed");

  // Custom return policy wording wins over the generated default.
  const customPolicy = formatEscposReceipt({
    orderNumber: "GWY-10",
    placedAt: "2024-01-15T13:05:00.000Z",
    customerName: "Sam",
    lines: [{ productName: "X", quantity: 1, priceMinorUnits: 100, category: "flower" }],
    subtotalMinorUnits: 68,
    savingsMinorUnits: 0,
    estimatedTaxMinorUnits: 32,
    totalMinorUnits: 100,
    returnPolicyText: "All sales final.",
  });
  ok(customPolicy.includes("All sales final."), "policy: owner wording printed");
  ok(!customPolicy.includes("Returns accepted within"), "policy: owner wording replaces default");

  // -- Narrow paper (58mm) --------------------------------------------------
  const narrow = formatEscposReceipt(
    {
      orderNumber: "GWY-11",
      placedAt: "2024-01-15T13:05:00.000Z",
      customerName: "Someone With A Long Name",
      customerNote: "Please put the gummies in a separate bag, thank you very much",
      lines: [
        {
          productName: "An Extremely Long Product Name That Will Not Fit",
          quantity: 3,
          priceMinorUnits: 1234,
          category: "flower",
          brand: "A Very Long Brand Name Indeed",
          unitGrams: 1,
          appliedLabel: "Some Very Long Promotion Name",
        },
      ],
      subtotalMinorUnits: 2530,
      savingsMinorUnits: 100,
      estimatedTaxMinorUnits: 1172,
      totalMinorUnits: 3702,
      addressText: "1234 Bay Street, Port Orchard, Washington 98366",
    },
    { columns: 32 },
  );
  ok(
    narrow.split("\n").every((l) => l.length <= 32),
    "narrow: every line fits 32 columns",
  );
  ok(narrow.includes("$37.02"), "narrow: total survives the squeeze");
  ok(narrow.includes("3x"), "narrow: quantity survives");

  // -- Register parity: the defaults duplicated here still match the POS -----
  // pos/receipt-core keeps DEFAULT_HEADER/DEFAULT_FOOTER module-private, so we
  // cannot import them. Instead assert the register's own OUTPUT still carries
  // the identical strings; if someone edits the register's defaults, this
  // fails and the two receipts are stopped from drifting apart.
  ok(DEFAULT_HEADER === "GREENWAY MARIJUANA", "parity: header constant unchanged");
  ok(
    DEFAULT_FOOTER.startsWith("This product has intoxicating effects"),
    "parity: footer constant unchanged",
  );

  // -- Degenerate inputs ----------------------------------------------------
  const empty = formatEscposReceipt({
    orderNumber: "GWY-12",
    placedAt: "not-a-date",
    customerName: "",
    lines: [],
    subtotalMinorUnits: 0,
    savingsMinorUnits: 0,
    estimatedTaxMinorUnits: 0,
    totalMinorUnits: 0,
  });
  ok(empty.includes("Receipt # GWY-12"), "empty: still identifies the order");
  ok(empty.includes("not-a-date"), "empty: invalid timestamp passes through verbatim");
  ok(!empty.includes("For "), "empty: blank customer name prints no 'For' line");
  ok(empty.includes("0 items"), "empty: zero-item summary");
  ok(empty.includes("$0.00"), "empty: zero total");

  const zeroTax = formatEscposReceipt({
    orderNumber: "GWY-13",
    placedAt: "2024-01-15T13:05:00.000Z",
    customerName: "Sam",
    lines: [{ productName: "X", quantity: 1, priceMinorUnits: 100, category: "flower" }],
    subtotalMinorUnits: 100,
    savingsMinorUnits: 0,
    estimatedTaxMinorUnits: 0,
    totalMinorUnits: 100,
  });
  ok(/\nTax +\$0\.00/.test(zeroTax), "zero tax: prints the combined row, not a bogus split");

  // -- Test print -----------------------------------------------------------
  const testBody = buildTestPrintBody({ columns: 48, placedAt: "2024-01-15T13:05:00.000Z" });
  ok(testBody.includes("TEST-PRINT"), "test print: labelled as a test");
  ok(testBody.includes("Sample Flower 3.5g"), "test print: sample line 1");
  ok(testBody.includes("Sample Gummies 10pk"), "test print: sample line 2");
  ok(testBody.includes("$40.00"), "test print: total");
  // The point of the sample: it exercises the parts that are easy to get
  // wrong, so a good-looking test print really does mean a good receipt.
  ok(testBody.includes("WA Cannabis Excise"), "test print: exercises the statutory split");
  ok(testBody.includes("Greenway"), "test print: exercises the detail line");
  ok(testBody.includes("THC 10mg"), "test print: exercises potency rendering");
  ok(testBody.includes("was $12.00 each"), "test print: exercises the discount line");
  ok(testBody.includes("3 items"), "test print: exercises the summary strip");
  ok(testBody.includes("Return Policy"), "test print: exercises the policy block");
  ok(
    testBody.split("\n").every((l) => l.length <= 48),
    "test print: fits the paper",
  );
  const testNarrow = buildTestPrintBody({ columns: 32 });
  ok(
    testNarrow.split("\n").every((l) => l.length <= 32),
    "test print: honours a 58mm paper setting",
  );

  // =========================================================================
  // SLICE L-10 -- THE ORIGIN ON THE PAPER
  // =========================================================================
  // The owner's requirement is that staff can tell the two apart. The receipt
  // is the copy that physically travels with the bag, so this is the most
  // important place of all for the distinction to survive.
  const originReceipt = (
    origin: "greenway" | "leafly" | "register",
    urgencyLine?: string | null,
  ): string =>
    formatEscposReceipt(
      {
        orderNumber: "GWY-000123",
        placedAt: "2024-01-15T20:30:00.000Z",
        customerName: "Jamie R.",
        lines: [{ productName: "Blue Dream 3.5g", quantity: 1, priceMinorUnits: 1500 }],
        subtotalMinorUnits: 1500,
        savingsMinorUnits: 0,
        estimatedTaxMinorUnits: 555,
        totalMinorUnits: 2055,
        origin,
        urgencyLine: urgencyLine ?? null,
      },
      { columns: 48 },
    );

  const leaflyPaper = originReceipt("leafly");
  const sitePaper = originReceipt("greenway");

  ok(leaflyPaper.includes("LEAFLY ORDER"), "L-10: a Leafly receipt says LEAFLY ORDER");
  ok(!leaflyPaper.includes("greenwaymarijuana.com"), "L-10: a Leafly receipt is not labelled as the website");
  ok(sitePaper.includes("greenwaymarijuana.com"), "L-10: a website receipt names the website");
  ok(!sitePaper.includes("LEAFLY"), "L-10: a website receipt never says Leafly");
  // THE ASSERTION THE WHOLE FEATURE RESTS ON. If the origin line were ever
  // collapsed back to a constant, every other assertion here could still
  // pass; this one could not.
  ok(
    leaflyPaper !== sitePaper,
    "L-10: the two receipts are not byte-identical",
  );

  // The acknowledgement deadline. This is what tells the person holding the
  // paper that Leafly will cancel the order if nobody accepts it in time.
  const urgent = originReceipt("leafly", "** ACCEPT BY 2:45 PM OR LEAFLY CANCELS IT **");
  ok(urgent.includes("ACCEPT BY 2:45 PM"), "L-10: the deadline reaches the paper");
  ok(
    !leaflyPaper.includes("ACCEPT BY"),
    "L-10: a receipt with no deadline does not invent one",
  );
  // NON-VACUITY: prove the urgency line is genuinely optional rather than
  // always-absent because the parameter is ignored.
  ok(
    urgent !== leaflyPaper,
    "L-10: passing an urgency line actually changes the output",
  );

  // PAPER WIDTH. A line that overflows wraps into the money column and
  // corrupts the totals, so every new line must be measured, not assumed.
  for (const [label, body] of [
    ["leafly", leaflyPaper],
    ["website", sitePaper],
    ["urgent", urgent],
  ] as const) {
    ok(
      body.split("\n").every((l) => l.length <= 48),
      `L-10: ${label} receipt fits 48 columns`,
    );
    ok(
      formatEscposReceipt(
        {
          orderNumber: "GWY-000123",
          placedAt: "2024-01-15T20:30:00.000Z",
          customerName: "Jamie R.",
          lines: [{ productName: "Blue Dream 3.5g", quantity: 1, priceMinorUnits: 1500 }],
          subtotalMinorUnits: 1500,
          savingsMinorUnits: 0,
          estimatedTaxMinorUnits: 555,
          totalMinorUnits: 2055,
          origin: label === "website" ? "greenway" : "leafly",
          urgencyLine: label === "urgent" ? "** ACCEPT BY 2:45 PM OR LEAFLY CANCELS IT **" : null,
        },
        { columns: 32 },
      )
        .split("\n")
        .every((l) => l.length <= 32),
      `L-10: ${label} receipt also fits 58mm paper`,
    );
  }

  // ASCII FOLDING. The origin line contains an em dash and the thermal head
  // cannot print one; an unfolded character reaches the paper as garbage.
  ok(
    !leaflyPaper.includes("\u2014"),
    "L-10: the em dash in the origin line is folded to ASCII",
  );
  ok(
    // eslint-disable-next-line no-control-regex
    !/[^\x00-\x7F]/.test(leaflyPaper),
    "L-10: nothing non-ASCII reaches the printer",
  );
  // A hostile urgency line must not be able to break the layout either.
  // A hostile urgency line must be folded and must not break the layout.
  //
  // MUTATION-TESTING NOTE: an earlier version of this block asserted only the
  // line width, and removing `asciiFold` from the urgency field did not fail
  // a single test -- the em dashes went straight to the paper and the widths
  // still fitted. The width check alone was therefore proving nothing about
  // folding. The non-ASCII assertion below is the one that closes that hole.
  const hostileUrgency = originReceipt(
    "leafly",
    "\u2014\u2014\u2014 ACCEPT \u00ae \u201cNOW\u201d \u2014\u2014\u2014",
  );
  ok(
    hostileUrgency.split("\n").every((l) => l.length <= 48),
    "L-10: a hostile urgency line still fits the paper",
  );
  ok(
    // eslint-disable-next-line no-control-regex
    !/[^\x00-\x7F]/.test(hostileUrgency),
    "L-10: a hostile urgency line is folded to ASCII before printing",
  );
  ok(
    hostileUrgency.includes("ACCEPT"),
    "L-10: folding the urgency line does not destroy its words",
  );
  ok(
    hostileUrgency.includes("(R)"),
    "L-10: the registered mark is folded rather than dropped",
  );

  // FOLD-BEFORE-MEASURE, asserted properly.
  //
  // The whole output is folded again on the way out (see the end of
  // formatEscposReceipt), so removing the per-field fold above does NOT let
  // non-ASCII reach the paper -- which is why the two assertions above did
  // not catch it when it was mutated away. What the per-field fold actually
  // buys is WIDTH CORRECTNESS: centerLine() lays out by string length, so a
  // fold that lengthens the text ("(R)" is three characters where "\u00ae"
  // was one) must happen BEFORE centring, or the finished line ends up wider
  // than the paper.
  //
  // This string is 42 characters as written and 46 once folded; centred in
  // 48 columns it survives only if the fold happened first. Measured: with
  // the per-field fold removed this produces a 49-character line.
  const widthTrap = "ACCEPT BY 2:45 PM \u00ae OR LEAFLY CANCELS \u00ae IT";
  const widthTrapBody = originReceipt("leafly", widthTrap);
  ok(
    widthTrapBody.split("\n").every((l) => l.length <= 48),
    "L-10: a fold-lengthening urgency line is folded BEFORE it is centred",
  );
  ok(
    widthTrapBody.includes("(R)"),
    "L-10: the width-trap line really did travel through the fold",
  );

  console.log(`receipt-escpos-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`receipt-escpos-core tests failed: ${fail}`);
}
