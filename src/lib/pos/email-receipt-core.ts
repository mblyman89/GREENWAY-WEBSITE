/**
 * src/lib/pos/email-receipt-core.ts
 *
 * PURE digital-receipt core for the POS (Slice B30). No I/O, no React — safe
 * for the tsx self-test harness and vitest.
 *
 * Design contract: the email receipt renders from the SAME frozen
 * `PosReceiptInput` snapshot the paper receipt prints from (captured at the
 * moment the sale is enqueued), so paper and email can never disagree on a
 * single number. The email HTML is a mobile-friendly restyle of the same
 * content — never a re-computation.
 *
 * Privacy contract (opt-in only):
 *  - The customer's email is used ONCE to send the receipt and is never
 *    persisted anywhere. The audit row stores a masked form only.
 * Compliance contract:
 *  - Purely transactional content — no marketing copy, no promo links
 *    (a receipt is a transaction record, not advertising under
 *    WAC 314-55-155). Same paper discipline: the intoxicating-effects
 *    warning footer prints, and NO medical card details ever appear
 *    (WAC 314-55-090(2) records live in the back-office ledger).
 */
import { formatMoneyMinor, formatReceiptTimestamp } from "@/lib/printing/receipt-core";
import {
  escapeReceiptHtml,
  receiptNumber,
  type PosReceiptInput,
  type PosReceiptLine,
} from "@/lib/pos/receipt-core";

// ---------------------------------------------------------------------------
// Email validation + masking
// ---------------------------------------------------------------------------

/**
 * Normalize + validate a customer-typed email. Pragmatic (not RFC-exhaustive):
 * trims, lowercases, requires exactly one "@", a non-empty local part, and a
 * domain with at least one dot and no spaces. Returns null when invalid.
 */
export function normalizeReceiptEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (/\s/.test(email)) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length < 1 || local.length > 64) return null;
  if (domain.length < 3 || !domain.includes(".")) return null;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null;
  if (!/^[a-z0-9.-]+$/.test(domain)) return null;
  return email;
}

/**
 * Mask an email for the audit trail: first character of the local part plus
 * the full domain — "j***@gmail.com". The full address is never stored.
 */
export function maskEmailForAudit(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

// ---------------------------------------------------------------------------
// Snapshot validation (server-side, before sending anything)
// ---------------------------------------------------------------------------

const MAX_LINES = 100;
const MAX_MONEY = 10_000_000; // $100,000 in cents — far beyond any legal sale
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMoney(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_MONEY;
}

function isShortString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/**
 * Structurally validate a receipt snapshot POSTed by a register device.
 * Returns the typed snapshot or a COMPLETE list of problems. Optional
 * fields are normalized (dropped when malformed) rather than refused —
 * the sale already happened; only the money-bearing core is strict.
 */
export function validateEmailReceiptSnapshot(
  raw: unknown,
): { ok: true; receipt: PosReceiptInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["Receipt snapshot must be an object."] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.saleClientUuid !== "string" || !UUIDISH.test(r.saleClientUuid)) {
    errors.push("saleClientUuid must be a UUID.");
  }
  if (typeof r.soldAtIso !== "string" || Number.isNaN(Date.parse(r.soldAtIso))) {
    errors.push("soldAtIso must be a parseable timestamp.");
  }
  if (!isShortString(r.registerLabel, 80)) errors.push("registerLabel is required (max 80 chars).");

  const lines: PosReceiptLine[] = [];
  if (!Array.isArray(r.lines) || r.lines.length < 1 || r.lines.length > MAX_LINES) {
    errors.push(`lines must be a non-empty array (max ${MAX_LINES}).`);
  } else {
    for (const [i, l] of (r.lines as unknown[]).entries()) {
      const line = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
      const nameOk = isShortString(line.productName, 200);
      const qtyOk =
        typeof line.quantity === "number" &&
        Number.isInteger(line.quantity) &&
        line.quantity >= 1 &&
        line.quantity <= 1000;
      const unitOk = isMoney(line.unitPriceMinor);
      const regOk = isMoney(line.regularPriceMinor);
      if (!nameOk || !qtyOk || !unitOk || !regOk) {
        errors.push(`Line ${i + 1} is malformed.`);
        continue;
      }
      lines.push({
        productName: (line.productName as string).trim(),
        quantity: line.quantity as number,
        unitPriceMinor: line.unitPriceMinor as number,
        regularPriceMinor: line.regularPriceMinor as number,
        medicalTaxOff: line.medicalTaxOff === true,
      });
    }
  }

  for (const key of [
    "subtotalMinor",
    "taxMinor",
    "totalMinor",
    "savingsMinor",
    "medicalSavingsMinor",
    "tenderedMinor",
    "changeMinor",
  ] as const) {
    if (!isMoney(r[key])) errors.push(`${key} must be an integer amount in cents.`);
  }
  if (typeof r.medicalSale !== "boolean") errors.push("medicalSale must be a boolean.");

  if (errors.length > 0) return { ok: false, errors };

  // Optional presentation fields — normalized, never refused.
  const addressLines = Array.isArray(r.addressLines)
    ? (r.addressLines as unknown[])
        .filter((l): l is string => typeof l === "string" && l.trim().length > 0 && l.length <= 120)
        .slice(0, 8)
    : undefined;
  const loyaltyRaw = (typeof r.loyalty === "object" && r.loyalty !== null
    ? r.loyalty
    : null) as Record<string, unknown> | null;
  const loyalty =
    loyaltyRaw && isShortString(loyaltyRaw.memberLabel, 80)
      ? {
          memberLabel: (loyaltyRaw.memberLabel as string).trim(),
          pointsEarned:
            typeof loyaltyRaw.pointsEarned === "number" && Number.isFinite(loyaltyRaw.pointsEarned)
              ? Math.floor(loyaltyRaw.pointsEarned)
              : null,
        }
      : null;

  return {
    ok: true,
    receipt: {
      saleClientUuid: r.saleClientUuid as string,
      soldAtIso: r.soldAtIso as string,
      registerLabel: (r.registerLabel as string).trim(),
      lines,
      subtotalMinor: r.subtotalMinor as number,
      taxMinor: r.taxMinor as number,
      totalMinor: r.totalMinor as number,
      savingsMinor: r.savingsMinor as number,
      medicalSavingsMinor: r.medicalSavingsMinor as number,
      medicalSale: r.medicalSale as boolean,
      tenderedMinor: r.tenderedMinor as number,
      changeMinor: r.changeMinor as number,
      headerText: isShortString(r.headerText, 120) ? (r.headerText as string) : null,
      footerText: isShortString(r.footerText, 500) ? (r.footerText as string) : null,
      addressLines,
      servedBy: isShortString(r.servedBy, 80) ? (r.servedBy as string) : null,
      hideSavings: r.hideSavings === true,
      loyalty,
    },
  };
}

// ---------------------------------------------------------------------------
// Email rendering — same content as paper, restyled for inboxes
// ---------------------------------------------------------------------------

const DEFAULT_HEADER = "GREENWAY MARIJUANA";
const DEFAULT_FOOTER =
  "This product has intoxicating effects and may be habit forming. Keep out of reach of children. Thank you!";

/** Subject line for the receipt email. */
export function emailReceiptSubject(receipt: PosReceiptInput): string {
  return `Your Greenway receipt ${receiptNumber(receipt.saleClientUuid)}`;
}

/**
 * Build the email-client-friendly receipt HTML. Content mirrors
 * `buildPosReceiptHtml` exactly (same fields, same conditional rows, same
 * money formatter) restyled at 420px with inline-safe CSS. Purely
 * transactional — no links, no marketing, and a one-line privacy note
 * telling the customer their address was used once and not kept.
 */
export function buildEmailReceiptHtml(receipt: PosReceiptInput): string {
  const header = escapeReceiptHtml((receipt.headerText ?? DEFAULT_HEADER).trim());
  const footer = escapeReceiptHtml((receipt.footerText ?? DEFAULT_FOOTER).trim());

  const rows: string[] = [];
  for (const line of receipt.lines) {
    const lineTotal = line.unitPriceMinor * line.quantity;
    const discounted = line.unitPriceMinor < line.regularPriceMinor;
    rows.push(
      `<tr><td style="padding:4px 0;text-align:left;">${line.quantity}x ${escapeReceiptHtml(line.productName)}${
        line.medicalTaxOff
          ? ' <span style="font-size:11px;font-weight:bold;border:1px solid #12351f;padding:0 4px;color:#12351f;">MED TAX OFF</span>'
          : ""
      }${discounted ? ` <s style="color:#888;">${formatMoneyMinor(line.regularPriceMinor)}</s>` : ""}</td><td style="padding:4px 0;text-align:right;white-space:nowrap;">${formatMoneyMinor(lineTotal)}</td></tr>`,
    );
  }

  const totals: string[] = [
    `<tr><td style="padding:3px 0;text-align:left;">Subtotal (pre-tax)</td><td style="padding:3px 0;text-align:right;">${formatMoneyMinor(receipt.subtotalMinor)}</td></tr>`,
    `<tr><td style="padding:3px 0;text-align:left;">Tax</td><td style="padding:3px 0;text-align:right;">${formatMoneyMinor(receipt.taxMinor)}</td></tr>`,
  ];
  if (receipt.savingsMinor > 0 && !receipt.hideSavings) {
    totals.push(
      `<tr><td style="padding:3px 0;text-align:left;">You saved</td><td style="padding:3px 0;text-align:right;">-${formatMoneyMinor(receipt.savingsMinor)}</td></tr>`,
    );
  }
  if (receipt.medicalSale && receipt.medicalSavingsMinor > 0) {
    totals.push(
      `<tr><td style="padding:3px 0;text-align:left;">Medical savings (tax off)</td><td style="padding:3px 0;text-align:right;">-${formatMoneyMinor(receipt.medicalSavingsMinor)}</td></tr>`,
    );
  }
  totals.push(
    `<tr><td style="padding:8px 0 3px;text-align:left;font-size:17px;font-weight:bold;border-top:2px solid #111;">TOTAL</td><td style="padding:8px 0 3px;text-align:right;font-size:17px;font-weight:bold;border-top:2px solid #111;">${formatMoneyMinor(receipt.totalMinor)}</td></tr>`,
    `<tr><td style="padding:3px 0;text-align:left;">Cash tendered</td><td style="padding:3px 0;text-align:right;">${formatMoneyMinor(receipt.tenderedMinor)}</td></tr>`,
    `<tr><td style="padding:3px 0;text-align:left;">Change</td><td style="padding:3px 0;text-align:right;">${formatMoneyMinor(receipt.changeMinor)}</td></tr>`,
  );

  const addr = (receipt.addressLines ?? [])
    .map((l) => l.trim())
    .filter(Boolean)
    .map(
      (l) =>
        `<p style="margin:0 0 2px;text-align:center;font-size:12px;color:#555;">${escapeReceiptHtml(l)}</p>`,
    )
    .join("");

  const loyaltyBlock = receipt.loyalty
    ? `<hr style="border:none;border-top:1px dashed #999;margin:12px 0;">` +
      `<p style="margin:0;text-align:center;font-size:13px;">Loyalty: ${escapeReceiptHtml(receipt.loyalty.memberLabel)}</p>` +
      (receipt.loyalty.pointsEarned != null && receipt.loyalty.pointsEarned > 0
        ? `<p style="margin:2px 0 0;text-align:center;font-size:13px;">Points earned this visit: ${Math.floor(receipt.loyalty.pointsEarned)}</p>`
        : "")
    : "";

  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><meta name="format-detection" content="telephone=no"></head>',
    '<body style="margin:0;padding:16px;background:#f4f4f2;">',
    '<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:8px;padding:20px;font-family:\'Helvetica Neue\',Arial,sans-serif;color:#111;font-size:14px;">',
    `<h1 style="margin:0 0 6px;text-align:center;font-size:20px;color:#12351f;">${header}</h1>`,
    addr,
    `<p style="margin:6px 0 0;text-align:center;font-size:13px;color:#333;">Receipt ${receiptNumber(receipt.saleClientUuid)} &middot; ${escapeReceiptHtml(receipt.registerLabel)}</p>`,
    `<p style="margin:2px 0 0;text-align:center;font-size:13px;color:#333;">${escapeReceiptHtml(formatReceiptTimestamp(receipt.soldAtIso))}</p>`,
    receipt.servedBy?.trim()
      ? `<p style="margin:2px 0 0;text-align:center;font-size:13px;color:#333;">Served by ${escapeReceiptHtml(receipt.servedBy.trim())}</p>`
      : "",
    receipt.medicalSale
      ? '<p style="margin:10px 0 0;text-align:center;font-size:14px;font-weight:bold;border:2px solid #12351f;padding:6px;color:#12351f;">MEDICAL &mdash; TAX EXEMPT SALE</p>'
      : "",
    '<hr style="border:none;border-top:1px dashed #999;margin:12px 0;">',
    `<table style="width:100%;border-collapse:collapse;font-size:14px;">${rows.join("")}</table>`,
    '<hr style="border:none;border-top:1px dashed #999;margin:12px 0;">',
    `<table style="width:100%;border-collapse:collapse;font-size:14px;">${totals.join("")}</table>`,
    loyaltyBlock,
    '<hr style="border:none;border-top:1px dashed #999;margin:12px 0;">',
    `<p style="margin:0;text-align:center;font-size:12px;color:#555;">${footer}</p>`,
    '<p style="margin:12px 0 0;text-align:center;font-size:11px;color:#888;">You asked for this receipt by email at the register. We used your address once to send it and did not keep it. This is a transaction record, not marketing.</p>',
    "</div></body></html>",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runEmailReceiptCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`email-receipt-core self-test failed: ${msg}`);
  };

  // normalizeReceiptEmail
  ok(normalizeReceiptEmail("  Jane.Doe@Gmail.COM ") === "jane.doe@gmail.com", "normalize trims + lowercases");
  ok(normalizeReceiptEmail("a@b.co") === "a@b.co", "short valid email accepted");
  ok(normalizeReceiptEmail("no-at-sign.com") === null, "missing @ rejected");
  ok(normalizeReceiptEmail("two@@at.com") === null, "double @ rejected");
  ok(normalizeReceiptEmail("a b@c.com") === null, "spaces rejected");
  ok(normalizeReceiptEmail("a@nodot") === null, "domain without dot rejected");
  ok(normalizeReceiptEmail("a@.dot.com") === null, "leading-dot domain rejected");
  ok(normalizeReceiptEmail("a@do..t.com") === null, "double-dot domain rejected");
  ok(normalizeReceiptEmail(`a@${"x".repeat(260)}.com`) === null, "overlong rejected");
  ok(normalizeReceiptEmail("") === null, "empty rejected");

  // maskEmailForAudit
  ok(maskEmailForAudit("jane@gmail.com") === "j***@gmail.com", "mask keeps first char + domain");
  ok(maskEmailForAudit("bad") === "***", "unmaskable input fully masked");

  // Snapshot validation
  const goodReceipt = {
    saleClientUuid: "123e4567-e89b-12d3-a456-426614174000",
    soldAtIso: "2026-02-08T20:15:00.000Z",
    registerLabel: "Register 1",
    lines: [
      { productName: "Blue Dream 3.5g", quantity: 2, unitPriceMinor: 2500, regularPriceMinor: 3000 },
    ],
    subtotalMinor: 3417,
    taxMinor: 1583,
    totalMinor: 5000,
    savingsMinor: 1000,
    medicalSavingsMinor: 0,
    medicalSale: false,
    tenderedMinor: 6000,
    changeMinor: 1000,
    servedBy: "Alex",
    loyalty: { memberLabel: "Jane D.", pointsEarned: 34.9 },
  };
  const v = validateEmailReceiptSnapshot(goodReceipt);
  ok(v.ok, "valid snapshot accepted");
  if (v.ok) {
    ok(v.receipt.lines.length === 1 && v.receipt.lines[0].productName === "Blue Dream 3.5g", "lines preserved");
    ok(v.receipt.loyalty?.pointsEarned === 34, "loyalty points floored");
    ok(v.receipt.headerText === null, "missing optional header normalized to null");
  }
  const bad1 = validateEmailReceiptSnapshot({ ...goodReceipt, totalMinor: 50.5 });
  ok(!bad1.ok && bad1.errors.some((e) => e.includes("totalMinor")), "fractional cents refused");
  const bad2 = validateEmailReceiptSnapshot({ ...goodReceipt, saleClientUuid: "nope" });
  ok(!bad2.ok, "non-UUID sale id refused");
  const bad3 = validateEmailReceiptSnapshot({ ...goodReceipt, lines: [] });
  ok(!bad3.ok, "empty lines refused");
  const bad4 = validateEmailReceiptSnapshot({
    ...goodReceipt,
    lines: [{ productName: "", quantity: 1, unitPriceMinor: 100, regularPriceMinor: 100 }],
  });
  ok(!bad4.ok && bad4.errors.some((e) => e.includes("Line 1")), "malformed line named");
  ok(!validateEmailReceiptSnapshot(null).ok, "null snapshot refused");
  ok(!validateEmailReceiptSnapshot([]).ok, "array snapshot refused");
  const multiErr = validateEmailReceiptSnapshot({ ...goodReceipt, totalMinor: -1, medicalSale: "yes" });
  ok(!multiErr.ok && multiErr.errors.length >= 2, "ALL problems reported at once");

  // Email HTML mirrors the paper receipt's content decisions
  if (v.ok) {
    const html = buildEmailReceiptHtml(v.receipt);
    ok(html.includes("Receipt 14174000"), "receipt number = last 8 of sale uuid");
    ok(html.includes("2x Blue Dream 3.5g"), "line rendered with quantity");
    ok(html.includes("$50.00"), "total formatted from cents");
    ok(html.includes("You saved") && html.includes("-$10.00"), "savings row when savings > 0");
    ok(!html.includes("MEDICAL"), "no medical banner on a recreational sale");
    ok(html.includes("Loyalty: Jane D.") && html.includes("Points earned this visit: 34"), "loyalty block rendered");
    ok(html.includes("intoxicating effects"), "warning footer present");
    ok(html.includes("did not keep it"), "privacy note present");
    ok(html.includes("not marketing"), "transactional-only note present");
    const medHtml = buildEmailReceiptHtml({ ...v.receipt, medicalSale: true, medicalSavingsMinor: 500 });
    ok(medHtml.includes("MEDICAL &mdash; TAX EXEMPT SALE"), "medical banner on carded sale");
    ok(medHtml.includes("Medical savings (tax off)"), "medical savings row");
    ok(!medHtml.toLowerCase().includes("upid"), "NO card details in the email");
    const hidden = buildEmailReceiptHtml({ ...v.receipt, hideSavings: true });
    ok(!hidden.includes("You saved"), "hideSavings honored (B13 parity)");
    const xss = buildEmailReceiptHtml({
      ...v.receipt,
      lines: [{ productName: "<script>alert(1)</script>", quantity: 1, unitPriceMinor: 100, regularPriceMinor: 100 }],
    });
    ok(!xss.includes("<script>"), "product names escaped");
  }

  // Subject
  ok(
    emailReceiptSubject({ ...goodReceipt, headerText: null, footerText: null } as PosReceiptInput) ===
      "Your Greenway receipt 14174000",
    "subject carries the receipt number",
  );

  console.log("email-receipt-core self-tests passed");
}
