/**
 * tests/compliance/invoice-po-match-core.test.ts
 *
 * W8 — pins the invoice ↔ PO cross-check contract for Accounts Payable:
 *   - NO 3-WAY MATCH (owner Q3): this is a SUGGESTION layer only — the
 *     auto-filled, editable amount box stays the control; nothing blocks;
 *   - no linked PO → hasPo:false, the form shows nothing extra;
 *   - exact agreement → verdict "match", message names the PO;
 *   - vendor billed MORE than ordered → "invoice_higher" with a loud
 *     check-before-paying warning and the delta in dollars;
 *   - invoice LOWER than ordered → "invoice_lower" explained as a
 *     short/partial delivery, pointing the owner at the amount box;
 *   - null PO number → generic "the linked PO" label, never invented;
 *   - money stays in CENTS (minor units) end to end.
 */
import { describe, expect, it } from "vitest";
import {
  compareInvoiceToPo,
  __runInvoicePoMatchCoreTests,
  type LinkedPoFacts,
} from "@/lib/payments/invoice-po-match-core";

function po(over: Partial<LinkedPoFacts> = {}): LinkedPoFacts {
  return {
    poNumber: "PO-202601-0007",
    status: "partial",
    orderedMinorUnits: 250000,
    lineCount: 4,
    ...over,
  };
}

describe("invoice-po-match-core (W8)", () => {
  it("no linked PO → hasPo:false and nothing else", () => {
    const c = compareInvoiceToPo(123456, null);
    expect(c).toEqual({ hasPo: false });
  });

  it("exact agreement → match verdict, zero delta, message names the PO and the ordered total", () => {
    const c = compareInvoiceToPo(250000, po());
    expect(c.hasPo).toBe(true);
    if (!c.hasPo) return;
    expect(c.verdict).toBe("match");
    expect(c.deltaMinorUnits).toBe(0);
    expect(c.orderedMinorUnits).toBe(250000);
    expect(c.invoiceMinorUnits).toBe(250000);
    expect(c.message).toContain("PO-202601-0007");
    expect(c.message).toContain("$2,500.00");
  });

  it("invoice higher → invoice_higher, positive delta in cents, loud MORE warning before paying", () => {
    const c = compareInvoiceToPo(260000, po());
    expect(c.hasPo).toBe(true);
    if (!c.hasPo) return;
    expect(c.verdict).toBe("invoice_higher");
    expect(c.deltaMinorUnits).toBe(10000);
    expect(c.message).toContain("MORE");
    expect(c.message).toContain("$100.00");
    expect(c.message).toMatch(/before paying/i);
  });

  it("invoice lower → invoice_lower explained as short/partial delivery, pointing at the amount box", () => {
    const c = compareInvoiceToPo(200000, po());
    expect(c.hasPo).toBe(true);
    if (!c.hasPo) return;
    expect(c.verdict).toBe("invoice_lower");
    expect(c.deltaMinorUnits).toBe(-50000);
    expect(c.message).toMatch(/partial/i);
    expect(c.message).toMatch(/amount box/i);
    expect(c.message).toContain("$500.00");
  });

  it("null PO number → generic 'the linked PO' label, never an invented number", () => {
    const c = compareInvoiceToPo(1, po({ poNumber: null, orderedMinorUnits: 1 }));
    expect(c.hasPo).toBe(true);
    if (!c.hasPo) return;
    expect(c.poNumber).toBeNull();
    expect(c.message).toContain("the linked PO");
    expect(c.message).not.toContain("PO-");
  });

  it("carries the PO status through untouched (paid stamp is W9, not here)", () => {
    const c = compareInvoiceToPo(250000, po({ status: "sent" }));
    expect(c.hasPo).toBe(true);
    if (!c.hasPo) return;
    expect(c.poStatus).toBe("sent");
  });

  it("embedded self-tests pass", () => {
    const { passed } = __runInvoicePoMatchCoreTests();
    expect(passed).toBeGreaterThan(0);
  });
});
