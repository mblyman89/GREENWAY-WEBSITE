/**
 * src/lib/inventory/invoice-adjustments-core.ts  (Fix Phase 3.4 · F-04-24)
 *
 * Credits, discounts and price reductions printed on a vendor's invoice, and
 * the invoice's printed total. PURE (no I/O, no clock). Money is integer cents.
 *
 * Owner, verbatim: "this new manifest has a credit amount on it, and the
 * system did not see it or did and disregarded it. i am hoping we can add
 * intelligent logic to the system that helps it identify credits, discounts,
 * price reductions, negative numbers, etc, so it can give an accurate invoice
 * amount."
 *
 * The owner's Bellevue Cannabis Company invoice (#01M6 24SC 4JCC B917) prints
 * 27 product lines ($2,974.70), then line 28 "- Discount: Credit 1 -299.70
 * -299.70" and "Invoice Total: 2,675.00". The manifest parser read the 27 lot
 * lines and skipped line 28 (it has no lot id), so the payable was $299.70 too
 * high.
 *
 * Rules (in order):
 *   1. An adjustment is a line whose words say credit / discount / rebate /
 *      price reduction / adjustment / allowance / promo / return AND whose
 *      amount is negative in any printed form: -299.70, -$299.70, $-299.70,
 *      ($299.70), 299.70-, 299.70 CR. Each is stored NEGATIVE.
 *   2. The printed invoice total is the LAST "Invoice Total / Amount Due /
 *      Balance Due / Total Due / Grand Total / Total" figure (never Sub-Total,
 *      Total Tax, Total Qty).
 *   3. reconcileInvoice: lines + printed adjustments. When NO adjustment was
 *      printed in words but the printed total is LOWER than the lines, the
 *      difference is an inferred credit (said, never silent). A printed total
 *      HIGHER than the lines (tax, freight) is only reported, never added.
 */

export type AdjustmentKind = "credit" | "discount" | "price_reduction" | "fee" | "other";

export type InvoiceAdjustment = {
  kind: AdjustmentKind;
  /** Signed cents. NEGATIVE reduces what is owed. */
  amountMinor: number;
  /** The words printed on the invoice (trimmed, <= 120 chars). */
  label: string;
};

const ADJ_WORDS =
  /\b(credit(?:\s*memo)?|discount|rebate|price\s*(?:reduction|adjustment)|adjustment|allowance|promo(?:tion(?:al)?)?|markdown|return(?:ed)?|refund|deduction|less)\b/i;

/** Parse one printed money figure to signed cents; null when it is not money. PURE. */
export function parseSignedMoney(raw: string): number | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  if (/\bCR\b$/i.test(s)) {
    neg = true;
    s = s.replace(/\s*CR$/i, "").trim();
  }
  if (/-$/.test(s)) {
    neg = true;
    s = s.slice(0, -1).trim();
  }
  s = s.replace(/^\$\s*/, "");
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/^\$\s*/, "");
  if (!/^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s.replace(/,/g, "")) * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

function kindOf(words: string): AdjustmentKind {
  const w = words.toLowerCase();
  if (/discount|promo|markdown/.test(w)) return w.includes("credit") ? "credit" : "discount";
  if (/price\s*(reduction|adjustment)/.test(w)) return "price_reduction";
  if (/credit|rebate|return|refund|allowance|deduction/.test(w)) return "credit";
  return "other";
}

const NEG_MONEY = String.raw`\(\s*\$?\s*[\d,]*\d\.\d{2}\s*\)|-\$?\s?[\d,]*\d\.\d{2}|\$\s?-[\d,]*\d\.\d{2}|\$?[\d,]*\d\.\d{2}(?:-|\s?CR\b)`;

/**
 * Every adjustment printed on an invoice's text. Anchored on the adjustment
 * WORDS: the negative figure must follow within a short window (an optional
 * quantity allowed), and the minus sign must touch the digits, so a product
 * name like "Dab - 1g ... 100.00" is never read as a credit. A line printed
 * twice (unit + extended column, e.g. "1 -299.70 -299.70") counts ONCE. PURE.
 */
export function findInvoiceAdjustments(text: string): InvoiceAdjustment[] {
  const flat = String(text ?? "").replace(/\s+/g, " ");
  const out: InvoiceAdjustment[] = [];
  const adj = new RegExp(ADJ_WORDS.source, "gi");
  const tail = new RegExp(String.raw`^([\s:/&'A-Za-z-]{0,30}?)\s*(?:\d{1,4}\s+)?(${NEG_MONEY})(?:\s+(${NEG_MONEY}))?`, "i");
  let m: RegExpExecArray | null;
  while ((m = adj.exec(flat)) !== null) {
    const end = m.index + m[0].length;
    const t = tail.exec(flat.slice(end, end + 60));
    if (!t) continue;
    const before = flat.slice(Math.max(0, m.index - 30), m.index).match(/(?:[A-Za-z]{2,}\s+){0,2}$/)?.[0] ?? "";
    if (/total|due/i.test(before + m[0] + t[1])) continue;
    const label = `${before}${m[0]}${t[1]}`.replace(/[\s:/-]+$/, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Credit";
    const a1 = parseSignedMoney(t[2].replace(/\s+(?=CR)/i, " "));
    const a2 = t[3] ? parseSignedMoney(t[3]) : null;
    const amount = a2 !== null && a1 !== null && a2 !== a1 ? a2 : a1;
    if (amount === null || amount >= 0) continue;
    out.push({ kind: kindOf(label), amountMinor: amount, label });
    adj.lastIndex = end + t[0].length;
  }
  return out;
}

/** The invoice's printed total (cents), the LAST total figure; null when none. PURE. */
export function findInvoiceTotal(text: string): number | null {
  const flat = String(text ?? "").replace(/\s+/g, " ");
  let last: number | null = null;
  const strong = /\b(?:invoice\s*total|amount\s*due|balance\s*due|total\s*due|grand\s*total)\s*:?\s*(\(?-?\s*\$?\s*-?[\d,]+\.\d{2}\)?)/gi;
  for (const m of flat.matchAll(strong)) {
    const v = parseSignedMoney(m[1].replace(/\s+/g, ""));
    if (v !== null) last = v;
  }
  if (last !== null) return last;
  const weak = /(?<!sub\s?)(?<!sub-)\btotal\s*:\s*(\(?-?\s*\$?\s*-?[\d,]+\.\d{2}\)?)/gi;
  for (const m of flat.matchAll(weak)) {
    const before = flat.slice(Math.max(0, (m.index ?? 0) - 6), m.index ?? 0).toLowerCase();
    if (/sub\s*$|tax\s*$|qty\s*$/.test(before)) continue;
    const v = parseSignedMoney(m[1].replace(/\s+/g, ""));
    if (v !== null) last = v;
  }
  return last;
}

export type InvoiceReconciliation = {
  linesMinor: number;
  adjustmentsMinor: number;
  /** What is owed: lines + adjustments (never below zero). */
  amountMinor: number;
  printedTotalMinor: number | null;
  /** printed - computed; 0 = the figures agree. Null when nothing printed. */
  gapMinor: number | null;
  /** An inferred credit to add (rule 3), or null. */
  inferred: InvoiceAdjustment | null;
  note: string | null;
};

const usd = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

/** Lines + adjustments vs the printed total. PURE. */
export function reconcileInvoice(input: {
  linesMinor: number;
  adjustments: readonly { amountMinor: number }[];
  printedTotalMinor: number | null;
  /** True when the lines' unit costs are all known (an unpriced line makes any gap meaningless). */
  linesComplete: boolean;
}): InvoiceReconciliation {
  const adj = input.adjustments.reduce((a, x) => a + x.amountMinor, 0);
  const computed = input.linesMinor + adj;
  const printed = input.printedTotalMinor;
  let inferred: InvoiceAdjustment | null = null;
  let note: string | null = null;
  let gap = printed === null ? null : printed - computed;
  if (printed !== null && gap !== null && gap !== 0 && input.linesComplete) {
    if (gap < 0 && input.adjustments.length === 0 && -gap <= Math.round(input.linesMinor / 2)) {
      inferred = { kind: "credit", amountMinor: gap, label: "Printed invoice total is lower than its lines (credit inferred)" };
      note = `The invoice total (${usd(printed)}) is ${usd(-gap)} less than its lines (${usd(input.linesMinor)}); no credit was printed in words, so the difference is recorded as a credit. Check it against the invoice.`;
      gap = 0;
    } else if (gap > 0) {
      note = `The invoice total (${usd(printed)}) is ${usd(gap)} MORE than the lines and credits (${usd(computed)}) - tax, freight or a fee. Nothing was added; add it by hand if it is owed.`;
    } else {
      note = `The invoice total (${usd(printed)}) differs from the lines and credits (${usd(computed)}) by ${usd(gap)}. Check the invoice and add a credit by hand if needed.`;
    }
  }
  const amount = Math.max(0, computed + (inferred?.amountMinor ?? 0));
  return { linesMinor: input.linesMinor, adjustmentsMinor: adj + (inferred?.amountMinor ?? 0), amountMinor: amount, printedTotalMinor: printed, gapMinor: gap, inferred, note };
}

/** Plain-English one-liner for a timeline / banner. PURE. */
export function describeAdjustments(adjs: readonly InvoiceAdjustment[]): string {
  if (adjs.length === 0) return "no credits or discounts";
  return adjs.map((a) => `${a.label} ${usd(a.amountMinor)}`).join("; ");
}

export { usd as formatUsdCents };


// ---------------------------------------------------------------------------
// Across every document of one email, and the credits a manager adds by hand.
// ---------------------------------------------------------------------------

export type AdjustmentDoc = { role: string; label: string; text?: string | null; layerText?: string | null };

/**
 * Credits + printed total across ALL the email's documents (invoice first).
 * The same credit printed on two documents (the invoice and a combined
 * invoice-manifest) counts ONCE. PURE.
 */
export function readInvoiceAdjustments(docs: readonly AdjustmentDoc[]): {
  adjustments: InvoiceAdjustment[];
  printedTotalMinor: number | null;
  source: string | null;
} {
  const rank = (r: string) => (r === "invoice" ? 0 : r === "manifest" ? 1 : r === "other" ? 2 : r === "email-body" ? 4 : 3);
  const ordered = [...docs].filter((d) => d.role !== "coa").sort((a, b) => rank(a.role) - rank(b.role));
  const seen = new Set<string>();
  const adjustments: InvoiceAdjustment[] = [];
  let printedTotalMinor: number | null = null;
  let source: string | null = null;
  for (const d of ordered) {
    const texts = [d.layerText, d.text].filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    let found: InvoiceAdjustment[] = [];
    let total: number | null = null;
    for (const t of texts) {
      if (found.length === 0) found = findInvoiceAdjustments(t);
      if (total === null) total = findInvoiceTotal(t);
    }
    for (const a of found) {
      const key = `${a.amountMinor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      adjustments.push(a);
      source = source ?? d.label;
    }
    if (printedTotalMinor === null && total !== null && d.role !== "email-body") {
      printedTotalMinor = total;
      source = source ?? d.label;
    }
  }
  return { adjustments, printedTotalMinor, source };
}

/** One credit a manager added by hand (stored in invoice_manual_adjustments). */
export type ManualAdjustment = {
  id: string;
  kind: AdjustmentKind;
  amountMinor: number;
  reason: string;
  by: string | null;
  at: string;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
};

/** Read the jsonb safely (never throws; junk entries dropped). PURE. */
export function parseManualAdjustments(raw: unknown): ManualAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: ManualAdjustment[] = [];
  for (const r of raw) {
    const o = r as Partial<ManualAdjustment>;
    if (!o || typeof o.id !== "string" || !Number.isSafeInteger(o.amountMinor) || (o.amountMinor as number) >= 0) continue;
    out.push({
      id: o.id,
      kind: (["credit", "discount", "price_reduction", "fee", "other"] as const).includes(o.kind as AdjustmentKind) ? (o.kind as AdjustmentKind) : "credit",
      amountMinor: o.amountMinor as number,
      reason: String(o.reason ?? ""),
      by: o.by ?? null,
      at: String(o.at ?? ""),
      voidedAt: o.voidedAt ?? null,
      voidedBy: o.voidedBy ?? null,
      voidReason: o.voidReason ?? null,
    });
  }
  return out;
}

/** Sum of the live (not voided) manual credits, signed cents (<= 0). PURE. */
export function liveManualMinor(list: readonly ManualAdjustment[]): number {
  return list.filter((m) => !m.voidedAt).reduce((a, m) => a + m.amountMinor, 0);
}

/**
 * Validate a manager's "Add credit" entry. The amount is typed POSITIVE in
 * dollars ("299.70") and stored NEGATIVE. It may not exceed what is still
 * owed (a credit never makes the vendor owe us). PURE.
 */
export function validateManualCredit(input: {
  amountText: string;
  reason: string;
  kind: string;
  remainingOwedMinor: number;
}): { ok: true; amountMinor: number; kind: AdjustmentKind; reason: string } | { ok: false; error: string } {
  const cents = parseSignedMoney(String(input.amountText ?? "").replace(/^-/, ""));
  if (cents === null || cents <= 0) return { ok: false, error: "Type the credit as a dollar amount, for example 299.70." };
  const reason = String(input.reason ?? "").replace(/\s+/g, " ").trim();
  if (reason.length < 3) return { ok: false, error: "Say why (for example \"Discount: Credit on the invoice\")." };
  if (reason.length > 500) return { ok: false, error: "Keep the reason under 500 characters." };
  if (cents > input.remainingOwedMinor) return { ok: false, error: `A credit cannot be more than what is still owed (${usd(input.remainingOwedMinor)}).` };
  const kind = (["credit", "discount", "price_reduction", "other"] as const).includes(input.kind as never) ? (input.kind as AdjustmentKind) : "credit";
  return { ok: true, amountMinor: -cents, kind, reason };
}

/**
 * The invoice amount shown on Receiving and owed on Vendor payments:
 * lines + credits read from the invoice + live credits added by hand,
 * never below zero. PURE.
 */
export function invoiceAmountMinor(linesMinor: number, detectedMinor: number, manualMinor: number): number {
  return Math.max(0, linesMinor + Math.min(0, detectedMinor) + Math.min(0, manualMinor));
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runInvoiceAdjustmentsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };
  ok(parseSignedMoney("-299.70") === -29970, "minus");
  ok(parseSignedMoney("($1,250.00)") === -125000, "parentheses");
  ok(parseSignedMoney("$-5.00") === -500, "dollar then minus");
  ok(parseSignedMoney("12.50-") === -1250, "trailing minus");
  ok(parseSignedMoney("40.00 CR") === -4000, "CR");
  ok(parseSignedMoney("2,675.00") === 267500, "positive");
  ok(parseSignedMoney("abc") === null, "not money");
  const bell = "27 01M6 24S5 CJJW 0DD4 Crunchberries / Tilted Cured Resin Dab - 1g 78.06% 10 10.00 100.00 28 - Discount: Credit 1 -299.70 -299.70 28 Invoice Total: 2,675.00";
  const a = findInvoiceAdjustments(bell);
  ok(a.length === 1 && a[0].amountMinor === -29970, "Bellevue credit read once");
  ok(a[0]?.kind === "credit", "discount: credit = credit");
  ok(findInvoiceTotal(bell) === 267500, "Bellevue invoice total");
  ok(findInvoiceTotal("Sub Total : $1,504.00 Total Tax : $0.00 Total : $1,504.00") === 150400, "GrowFlow total, not sub total");
  ok(findInvoiceAdjustments("Volume discount ($50.00)")[0]?.amountMinor === -5000, "parenthesised discount");
  ok(findInvoiceAdjustments("Item 10 4.00 40.00 Sub Total 40.00").length === 0, "no adjustment words, none found");
  ok(findInvoiceAdjustments("Discount 5.00 Total 35.00").length === 0, "a positive figure is never a credit");
  const r = reconcileInvoice({ linesMinor: 297470, adjustments: a, printedTotalMinor: 267500, linesComplete: true });
  ok(r.amountMinor === 267500 && r.gapMinor === 0 && r.inferred === null, "Bellevue reconciles to the printed total");
  const inf = reconcileInvoice({ linesMinor: 297470, adjustments: [], printedTotalMinor: 267500, linesComplete: true });
  ok(inf.inferred?.amountMinor === -29970 && inf.amountMinor === 267500, "unprinted credit inferred from the total");
  const up = reconcileInvoice({ linesMinor: 10000, adjustments: [], printedTotalMinor: 10800, linesComplete: true });
  ok(up.inferred === null && up.amountMinor === 10000 && up.gapMinor === 800, "a higher total is reported, never added");
  const inc = reconcileInvoice({ linesMinor: 10000, adjustments: [], printedTotalMinor: 5000, linesComplete: false });
  ok(inc.inferred === null, "no inference while a line is unpriced");
  const big = reconcileInvoice({ linesMinor: 10000, adjustments: [], printedTotalMinor: 1000, linesComplete: true });
  ok(big.inferred === null, "a gap over half the lines is never inferred");
  const docs = readInvoiceAdjustments([
    { role: "manifest", label: "manifest.pdf", text: bell },
    { role: "invoice", label: "invoice.pdf", layerText: bell },
    { role: "coa", label: "coa.pdf", text: "Credit -5.00" },
  ]);
  ok(docs.adjustments.length === 1 && docs.printedTotalMinor === 267500 && docs.source === "invoice.pdf", "one credit across every document, invoice first, COA ignored");
  const v = validateManualCredit({ amountText: "299.70", reason: "Discount: Credit", kind: "credit", remainingOwedMinor: 297470 });
  ok(v.ok && v.amountMinor === -29970, "a manual credit is stored negative");
  ok(!validateManualCredit({ amountText: "5000", reason: "too big", kind: "credit", remainingOwedMinor: 100 }).ok, "a credit above what is owed is refused");
  ok(!validateManualCredit({ amountText: "5", reason: "", kind: "credit", remainingOwedMinor: 1000 }).ok, "a reason is required");
  const ml = parseManualAdjustments([{ id: "a", kind: "credit", amountMinor: -500, reason: "x", by: null, at: "t" }, { id: "b", amountMinor: -200, voidedAt: "t" }, { id: "c", amountMinor: 300 }, null]);
  ok(ml.length === 2 && liveManualMinor(ml) === -500, "voided credits do not count, positive junk dropped");
  ok(invoiceAmountMinor(297470, -29970, 0) === 267500 && invoiceAmountMinor(100, -500, 0) === 0, "invoice amount, never below zero");
  return { passed, failed };
}
