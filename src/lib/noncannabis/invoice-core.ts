/**
 * src/lib/noncannabis/invoice-core.ts
 *
 * PURE logic for the non-cannabis paper-invoice intake (Task N). No I/O, no
 * framework imports — everything here is unit-testable and shared verbatim by
 * the server actions and the client invoice-builder form.
 *
 * THE BUSINESS FLOW (owner, verbatim intent): the glass vendor comes in with
 * stock, we pick out what we want, they write a PAPER invoice. Staff key that
 * invoice into a simple builder form on the non-cannabis inventory page. The
 * saved invoice is the payable SOURCE DOCUMENT for the Accounts Payable (ACH)
 * page — exactly the role an ACCEPTED inbound manifest plays for cannabis.
 *
 * MONEY IS CENTS (integer minor units) everywhere in this file.
 */

/* ------------------------------------------------------------------ *
 *  Invoice draft — header + lines (what the builder form collects)
 * ------------------------------------------------------------------ */

/** One line on the paper invoice. */
export type NonCannabisInvoiceLineDraft = {
  /**
   * "existing" = restock a product already in the catalog (posts a +qty
   * "received" adjustment); "new" = an item we've never carried (stages a
   * draft product staff confirm to active, same as the intake form).
   */
  kind: "new" | "existing";
  /** Catalog product id — REQUIRED when kind === "existing". */
  productId?: string | null;
  /** What the line says on paper (also the new product's name for "new"). */
  description: string;
  /** Units purchased — positive integer. */
  qty: number;
  /** Cost per unit in CENTS (>= 0). */
  unitCostMinorUnits: number;
  /** Product type slug for NEW lines (drives the smart SKU); ignored for existing. */
  productType?: string | null;
  /** Optional retail price in CENTS for NEW lines. */
  priceMinorUnits?: number | null;
};

/** The whole paper invoice as keyed into the builder. */
export type NonCannabisInvoiceDraft = {
  vendorName: string;
  invoiceNumber: string;
  /** The date written on the paper invoice — "YYYY-MM-DD". */
  invoiceDate: string;
  note?: string | null;
  /**
   * Optional cross-check: the grand total PRINTED on the paper invoice, in
   * CENTS. When provided it MUST equal the computed line total — a mismatch
   * means a typo somewhere, so we block until the numbers agree.
   */
  statedTotalMinorUnits?: number | null;
  lines: NonCannabisInvoiceLineDraft[];
};

/** qty × unit cost for one line (CENTS). */
export function invoiceLineTotal(line: Pick<NonCannabisInvoiceLineDraft, "qty" | "unitCostMinorUnits">): number {
  const qty = Number(line.qty) || 0;
  const unit = Number(line.unitCostMinorUnits) || 0;
  return Math.round(qty * unit);
}

/** Grand total over all lines (CENTS). */
export function invoiceTotalMinorUnits(
  lines: Pick<NonCannabisInvoiceLineDraft, "qty" | "unitCostMinorUnits">[],
): number {
  return lines.reduce((sum, l) => sum + invoiceLineTotal(l), 0);
}

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when "YYYY-MM-DD" is a real calendar date. */
export function isValidInvoiceDate(raw: string): boolean {
  if (!DATE_RE.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

export type InvoiceValidation =
  | { ok: true; totalMinorUnits: number }
  | { ok: false; problems: string[] };

/**
 * Validate a keyed-in paper invoice before anything is written. Plain-language
 * problems so staff can fix the form. Blocks: missing vendor/number/date,
 * zero lines, non-positive or non-integer quantities, negative or non-integer
 * unit costs, blank descriptions, existing lines without a product, and a
 * stated paper total that disagrees with the computed line total.
 */
export function validateNonCannabisInvoice(draft: NonCannabisInvoiceDraft): InvoiceValidation {
  const problems: string[] = [];

  if (!(draft.vendorName ?? "").trim()) problems.push("Vendor name is required.");
  if (!(draft.invoiceNumber ?? "").trim()) {
    problems.push("Invoice number is required — it's printed on the paper invoice.");
  }
  if (!isValidInvoiceDate((draft.invoiceDate ?? "").trim())) {
    problems.push("Invoice date must be a real date (YYYY-MM-DD).");
  }

  if (!Array.isArray(draft.lines) || draft.lines.length === 0) {
    problems.push("Add at least one line — what did you pick out?");
  }

  (draft.lines ?? []).forEach((line, i) => {
    const n = i + 1;
    if (!(line.description ?? "").trim()) {
      problems.push(`Line ${n}: description is required.`);
    }
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      problems.push(`Line ${n}: quantity must be a whole number greater than zero.`);
    }
    if (!Number.isInteger(line.unitCostMinorUnits) || line.unitCostMinorUnits < 0) {
      problems.push(`Line ${n}: unit cost must be $0.00 or more (whole cents).`);
    }
    if (line.kind === "existing" && !(line.productId ?? "").trim()) {
      problems.push(`Line ${n}: pick the existing product this restocks.`);
    }
    if (line.kind !== "existing" && line.kind !== "new") {
      problems.push(`Line ${n}: line must be "new" or "existing".`);
    }
  });

  const total = invoiceTotalMinorUnits(draft.lines ?? []);
  const stated = draft.statedTotalMinorUnits;
  if (stated != null && Number.isInteger(stated) && stated >= 0 && stated !== total) {
    problems.push(
      `Paper total ${usd(stated)} does not match the computed line total ${usd(total)}. ` +
        "Fix the typo before saving — the invoice is a payment source document.",
    );
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, totalMinorUnits: total };
}

/* ------------------------------------------------------------------ *
 *  Payment guardrails — same semantics as checkManifestPayment
 * ------------------------------------------------------------------ */

/** A saved invoice viewed as a payable (mirrors ManifestPayable's role). */
export type NonCannabisInvoicePayable = {
  invoiceId: string;
  invoiceNumber: string;
  vendorId: string | null;
  vendorName: string;
  /** 'open' | 'paid' (DB check constraint). */
  status: string;
  totalMinorUnits: number;
  paidMinorUnits: number;
};

/** Structurally identical to vendor-ach-core's PaymentCheck. */
export type InvoicePaymentCheck = {
  severity: "ok" | "warning" | "blocked";
  remainingMinorUnits: number;
  message: string;
};

export function invoiceRemainingOwed(p: NonCannabisInvoicePayable): number {
  return Math.max(0, (p.totalMinorUnits ?? 0) - (p.paidMinorUnits ?? 0));
}

/**
 * THE GUARDRAIL for paying a non-cannabis paper invoice — identical policy to
 * the manifest path: overpay BLOCKED, partial allowed WITH WARNING, fully-paid
 * BLOCKED, exact OK. Amounts are CENTS.
 */
export function checkNonCannabisInvoicePayment(
  payable: NonCannabisInvoicePayable,
  amountMinorUnits: number,
): InvoicePaymentCheck {
  const remaining = invoiceRemainingOwed(payable);
  const label = payable.invoiceNumber || payable.invoiceId;

  if (!Number.isInteger(amountMinorUnits) || amountMinorUnits <= 0) {
    return {
      severity: "blocked",
      remainingMinorUnits: remaining,
      message: "Payment amount must be a whole number of cents greater than zero.",
    };
  }
  if (remaining <= 0) {
    return {
      severity: "blocked",
      remainingMinorUnits: 0,
      message: `Merch invoice #${label} is already fully paid (${usd(payable.paidMinorUnits)} of ${usd(payable.totalMinorUnits)}). Nothing left to pay.`,
    };
  }
  if (amountMinorUnits > remaining) {
    return {
      severity: "blocked",
      remainingMinorUnits: remaining,
      message: `Overpayment blocked: paying ${usd(amountMinorUnits)} exceeds the remaining ${usd(remaining)} owed on merch invoice #${label} (total ${usd(payable.totalMinorUnits)}, already paid ${usd(payable.paidMinorUnits)}).`,
    };
  }
  if (amountMinorUnits < remaining) {
    return {
      severity: "warning",
      remainingMinorUnits: remaining,
      message: `Partial payment: ${usd(amountMinorUnits)} is less than the remaining ${usd(remaining)} owed on merch invoice #${label}. Allowed — the balance of ${usd(remaining - amountMinorUnits)} will remain outstanding.`,
    };
  }
  return {
    severity: "ok",
    remainingMinorUnits: remaining,
    message: `Pays merch invoice #${label} in full (${usd(amountMinorUnits)}).`,
  };
}

/* ------------------------------------------------------------------ *
 *  Payable keys — one AP picker, two source-document kinds
 * ------------------------------------------------------------------ */

export type PayableSource = "manifest" | "noncannabis_invoice";

const KEY_PREFIX: Record<PayableSource, string> = {
  manifest: "manifest:",
  noncannabis_invoice: "ncinv:",
};

/** Encode a payable's identity into one opaque form value. */
export function encodePayableKey(source: PayableSource, id: string): string {
  return `${KEY_PREFIX[source]}${id}`;
}

/**
 * Decode a payable key. BACK-COMPAT: a bare id (no prefix) is treated as a
 * manifest id, because every pre-Task-N form posted bare manifest ids.
 */
export function decodePayableKey(key: string): { source: PayableSource; id: string } {
  const k = (key ?? "").trim();
  if (k.startsWith(KEY_PREFIX.noncannabis_invoice)) {
    return { source: "noncannabis_invoice", id: k.slice(KEY_PREFIX.noncannabis_invoice.length) };
  }
  if (k.startsWith(KEY_PREFIX.manifest)) {
    return { source: "manifest", id: k.slice(KEY_PREFIX.manifest.length) };
  }
  return { source: "manifest", id: k };
}

/* ------------------------------------------------------------------ *
 *  Embedded self-tests (run by tests/compliance/noncannabis-invoice-core.test.ts)
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`invoice-core self-test failed: ${msg}`);
}

export function __runNonCannabisInvoiceTests(): void {
  // Line + grand totals stay in integer cents.
  assert(invoiceLineTotal({ qty: 3, unitCostMinorUnits: 1250 }) === 3750, "line total 3×$12.50");
  assert(
    invoiceTotalMinorUnits([
      { qty: 3, unitCostMinorUnits: 1250 },
      { qty: 2, unitCostMinorUnits: 500 },
    ]) === 4750,
    "grand total",
  );

  // Date validation.
  assert(isValidInvoiceDate("2026-02-14"), "valid date");
  assert(!isValidInvoiceDate("2026-02-30"), "impossible date rejected");
  assert(!isValidInvoiceDate("02/14/2026"), "US format rejected");

  // A well-formed draft validates and returns the computed total.
  const good: NonCannabisInvoiceDraft = {
    vendorName: "Glass Guy Distribution",
    invoiceNumber: "GG-1042",
    invoiceDate: "2026-02-14",
    statedTotalMinorUnits: 4750,
    lines: [
      { kind: "new", description: "Blue Dot 6in Spoon Pipe", qty: 3, unitCostMinorUnits: 1250, productType: "pipe" },
      { kind: "existing", productId: "p1", description: "Clipper Lighter", qty: 2, unitCostMinorUnits: 500 },
    ],
  };
  const v = validateNonCannabisInvoice(good);
  assert(v.ok && v.totalMinorUnits === 4750, "good draft validates with total");

  // Blockers: missing header bits, bad lines, mismatched paper total.
  const bad = validateNonCannabisInvoice({
    vendorName: " ",
    invoiceNumber: "",
    invoiceDate: "junk",
    statedTotalMinorUnits: 9999,
    lines: [
      { kind: "existing", description: "", qty: 0, unitCostMinorUnits: -5 },
    ],
  });
  assert(!bad.ok, "bad draft blocked");
  if (!bad.ok) {
    assert(bad.problems.some((p) => p.includes("Vendor name")), "vendor problem");
    assert(bad.problems.some((p) => p.includes("Invoice number")), "number problem");
    assert(bad.problems.some((p) => p.includes("Invoice date")), "date problem");
    assert(bad.problems.some((p) => p.includes("quantity")), "qty problem");
    assert(bad.problems.some((p) => p.includes("unit cost")), "cost problem");
    assert(bad.problems.some((p) => p.includes("pick the existing product")), "productId problem");
  }
  const noLines = validateNonCannabisInvoice({
    vendorName: "V",
    invoiceNumber: "1",
    invoiceDate: "2026-01-01",
    lines: [],
  });
  assert(!noLines.ok, "zero lines blocked");
  const mismatch = validateNonCannabisInvoice({
    vendorName: "V",
    invoiceNumber: "1",
    invoiceDate: "2026-01-01",
    statedTotalMinorUnits: 100,
    lines: [{ kind: "new", description: "Thing", qty: 1, unitCostMinorUnits: 200 }],
  });
  assert(!mismatch.ok, "stated-total mismatch blocked");

  // Payment guardrails — identical policy to the manifest path.
  const payable: NonCannabisInvoicePayable = {
    invoiceId: "i1",
    invoiceNumber: "GG-1042",
    vendorId: null,
    vendorName: "Glass Guy",
    status: "open",
    totalMinorUnits: 4750,
    paidMinorUnits: 1000,
  };
  assert(invoiceRemainingOwed(payable) === 3750, "remaining owed");
  assert(checkNonCannabisInvoicePayment(payable, 3750).severity === "ok", "exact pay ok");
  assert(checkNonCannabisInvoicePayment(payable, 3751).severity === "blocked", "overpay blocked");
  assert(checkNonCannabisInvoicePayment(payable, 1000).severity === "warning", "partial warns");
  assert(checkNonCannabisInvoicePayment(payable, 0).severity === "blocked", "zero blocked");
  assert(checkNonCannabisInvoicePayment(payable, 10.5 as number).severity === "blocked", "fractional cents blocked");
  assert(
    checkNonCannabisInvoicePayment({ ...payable, paidMinorUnits: 4750 }, 1).severity === "blocked",
    "fully paid blocked",
  );

  // Payable keys round-trip; bare ids stay manifests for back-compat.
  assert(encodePayableKey("manifest", "abc") === "manifest:abc", "manifest key encodes");
  assert(encodePayableKey("noncannabis_invoice", "xyz") === "ncinv:xyz", "invoice key encodes");
  const d1 = decodePayableKey("ncinv:xyz");
  assert(d1.source === "noncannabis_invoice" && d1.id === "xyz", "invoice key decodes");
  const d2 = decodePayableKey("manifest:abc");
  assert(d2.source === "manifest" && d2.id === "abc", "manifest key decodes");
  const d3 = decodePayableKey("bare-uuid");
  assert(d3.source === "manifest" && d3.id === "bare-uuid", "bare id = manifest (back-compat)");
}
