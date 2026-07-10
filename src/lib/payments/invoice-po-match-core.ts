/**
 * src/lib/payments/invoice-po-match-core.ts
 *
 * W8 — PURE invoice ↔ purchase-order cross-check for Accounts Payable.
 *
 * OWNER'S DECISION (verbatim intent, Q3): no three-way matching. "Just
 * matching an invoice to the payment is all I need with suggestions possibly.
 * The invoice has the total due, so the input box should be auto filled based
 * on the invoice total. I need a way to replace the value in that box in case
 * of a partial delivery."
 *
 * The auto-filled, editable amount box already exists in both AP forms. This
 * module adds the SUGGESTION layer: when the invoice (an accepted manifest)
 * is LINKED to a purchase order (W5 / migration 0102), compare what the PO
 * ordered against what the invoice bills and say — in one plain sentence —
 * whether they agree. READ-ONLY: nothing here writes to the PO (the paid
 * stamp is W9).
 *
 * Money is CENTS (minor units) end to end, per the standing rule.
 */

/** The linked PO facts AP needs (subset of purchase_orders). */
export type LinkedPoFacts = {
  poNumber: string | null;
  status: string;
  /** SUM of ordered line totals, CENTS. */
  orderedMinorUnits: number;
  lineCount: number;
};

export type InvoicePoComparison =
  | { hasPo: false }
  | {
      hasPo: true;
      poNumber: string | null;
      poStatus: string;
      orderedMinorUnits: number;
      invoiceMinorUnits: number;
      /** invoice − ordered, CENTS (positive = vendor billed more than ordered). */
      deltaMinorUnits: number;
      verdict: "match" | "invoice_higher" | "invoice_lower";
      /** One plain sentence for the form. */
      message: string;
    };

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Compare an invoice's cost basis (what the accepted manifest says we owe)
 * against its linked PO's ordered subtotal. Pure and deterministic.
 */
export function compareInvoiceToPo(
  invoiceMinorUnits: number,
  po: LinkedPoFacts | null,
): InvoicePoComparison {
  if (!po) return { hasPo: false };
  const delta = invoiceMinorUnits - po.orderedMinorUnits;
  const label = po.poNumber ?? "the linked PO";
  let verdict: "match" | "invoice_higher" | "invoice_lower";
  let message: string;
  if (delta === 0) {
    verdict = "match";
    message = `Invoice matches ${label} exactly (${usd(po.orderedMinorUnits)} ordered).`;
  } else if (delta > 0) {
    verdict = "invoice_higher";
    message = `Invoice is ${usd(delta)} MORE than ${label} ordered (${usd(
      po.orderedMinorUnits,
    )}). Check for price changes or items you didn't order before paying.`;
  } else {
    verdict = "invoice_lower";
    message = `Invoice is ${usd(-delta)} less than ${label} ordered (${usd(
      po.orderedMinorUnits,
    )}) — consistent with a short/partial delivery. Adjust the amount box if you're paying only what arrived.`;
  }
  return {
    hasPo: true,
    poNumber: po.poNumber,
    poStatus: po.status,
    orderedMinorUnits: po.orderedMinorUnits,
    invoiceMinorUnits,
    deltaMinorUnits: delta,
    verdict,
    message,
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runInvoicePoMatchCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL invoice-po-match-core: " + msg);
    passed += 1;
  };

  const po = (over: Partial<LinkedPoFacts>): LinkedPoFacts => ({
    poNumber: "PO-202601-0007",
    status: "partial",
    orderedMinorUnits: 250000,
    lineCount: 4,
    ...over,
  });

  // No linked PO → hasPo:false (the form shows nothing extra).
  {
    const c = compareInvoiceToPo(100000, null);
    assert(c.hasPo === false, "no PO → hasPo false");
  }

  // Exact agreement.
  {
    const c = compareInvoiceToPo(250000, po({}));
    assert(c.hasPo && c.verdict === "match", "exact match verdict");
    assert(c.hasPo && c.deltaMinorUnits === 0, "zero delta");
    assert(c.hasPo && c.message.includes("PO-202601-0007"), "message names the PO");
  }

  // Vendor billed MORE than ordered → loud check-before-paying warning.
  {
    const c = compareInvoiceToPo(260000, po({}));
    assert(c.hasPo && c.verdict === "invoice_higher", "higher verdict");
    assert(c.hasPo && c.deltaMinorUnits === 10000, "delta +$100.00");
    assert(c.hasPo && c.message.includes("MORE"), "warns loudly");
    assert(c.hasPo && c.message.includes("$100.00"), "delta in dollars");
  }

  // Invoice lower → partial-delivery explanation pointing at the amount box.
  {
    const c = compareInvoiceToPo(200000, po({}));
    assert(c.hasPo && c.verdict === "invoice_lower", "lower verdict");
    assert(c.hasPo && c.deltaMinorUnits === -50000, "delta -$500.00");
    assert(c.hasPo && /partial/i.test(c.message), "mentions partial delivery");
    assert(c.hasPo && /amount box/i.test(c.message), "points at the amount box");
  }

  // Null PO number falls back to a generic label.
  {
    const c = compareInvoiceToPo(1, po({ poNumber: null, orderedMinorUnits: 1 }));
    assert(c.hasPo && c.message.includes("the linked PO"), "generic label fallback");
  }

  return { passed };
}
