/**
 * tests/compliance/fix-p3-4-invoice-credits.test.ts  (Fix Phase 3.4 · F-04-24 · F-04-25)
 *
 * The owner, verbatim:
 *   "this new manifest has a credit amount on it, and the system did not see
 *    it or did and disregarded it ... i want the invoice amount to be shown on
 *    the receiving table ... i need a way to add a credit or discount to the
 *    invoice before paying for it in the vendor payments page. finally, i want
 *    to be able to dismiss the warnings and other banners at the top of the
 *    page." / "please test this last round very minimally"
 *
 * Minimal by request: the owner's real Bellevue invoice (credit + printed
 * total), the GrowFlow invoice (no credit), the vendor-name reader, 0322 pins
 * and the wiring pins that keep the pieces connected.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  findInvoiceAdjustments,
  findInvoiceTotal,
  invoiceAmountMinor,
  readInvoiceAdjustments,
  validateManualCredit,
} from "@/lib/inventory/invoice-adjustments-core";
import { vendorNameFromText } from "@/lib/inventory/manifest-sibling-core";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const bellevue = read("tests/fixtures/bellevue-credit-invoice.unpdf.txt");
const growflow = read("tests/fixtures/growflow-canna/03-Invoice.unpdf.txt");

describe("1. credits on the owner's real invoices", () => {
  it("Bellevue #412692: one -$299.70 credit and a printed total of $2,675.00", () => {
    const adj = findInvoiceAdjustments(bellevue);
    expect(adj.map((a) => a.amountMinor)).toEqual([-29970]);
    expect(findInvoiceTotal(bellevue)).toBe(267500);
    const r = readInvoiceAdjustments([{ role: "invoice", label: "01-Invoice_greenway.pdf", text: bellevue }]);
    expect(r.adjustments).toHaveLength(1);
    expect(invoiceAmountMinor(297470, -29970, 0)).toBe(267500);
  });
  it("GrowFlow invoice: no credit invented", () => {
    expect(findInvoiceAdjustments(growflow)).toEqual([]);
  });
  it("a manual credit is positive dollars in, negative cents out, never above owed", () => {
    const ok = validateManualCredit({ amountText: "299.70", reason: "Discount: Credit 1", kind: "discount", remainingOwedMinor: 297470 });
    expect(ok).toMatchObject({ ok: true, amountMinor: -29970, kind: "discount" });
    expect(validateManualCredit({ amountText: "5000", reason: "too much", kind: "credit", remainingOwedMinor: 100 }).ok).toBe(false);
  });
  it("the vendor name is read from the documents, never a label", () => {
    expect(vendorNameFromText(bellevue)).toMatch(/BELLEVUE CANNABIS/i);
    expect(vendorNameFromText("Manifest ID: 1575241667413695")).toBeNull();
  });
});

describe("2. 0322 migration + rollback", () => {
  it("adds the five columns and the non-positive check; rollback drops them", () => {
    const up = read("supabase/migrations/0322_invoice_adjustments.sql");
    for (const c of ["invoice_total_minor", "invoice_adjustments jsonb", "invoice_adjustments_minor bigint", "invoice_adjustments_note", "invoice_manual_adjustments jsonb"]) {
      expect(up).toContain(`add column if not exists ${c}`);
    }
    expect(up).toContain("check (invoice_adjustments_minor <= 0)");
    const down = read("supabase/rollbacks/0322_invoice_adjustments.rollback.sql");
    expect(down).toContain("drop constraint if exists inbound_manifests_invoice_adjustments_minor_nonpos");
    expect(down).toMatch(/drop column if exists invoice_manual_adjustments/);
  });
});

describe("3. wiring", () => {
  it("staging reads credits and repairs the vendor on all four invoice paths", () => {
    const s = read("src/lib/inbound-email/inbound-store.ts");
    expect(s.match(/recordInvoiceAdjustments\(/g)?.length).toBe(4);
    expect(s.match(/healVendorLabel\(/g)?.length).toBe(4);
  });
  it("re-read reads every document; owed, the bill and Receiving use the credits", () => {
    expect(read("src/app/admin/inventory/intake/actions.ts")).toContain("rereadAllDeliveryDocs(manifestId");
    expect(read("src/lib/payments/vendor-payables-store.ts")).toContain("loadInvoiceAdjustmentTotals(manifestIds)");
    const bill = read("src/lib/accounting/vendor-bill-service.ts");
    expect(bill).toContain('purchaseKindCode: "purchase_discount"');
    expect(bill).toContain("statedTotalCents: billTotal");
    const page = read("src/app/admin/inventory/intake/page.tsx");
    expect(page).toContain("loadInvoiceAmounts(");
    expect(page).toContain("healLabelVendors(");
    expect(page).toContain("<DismissibleBanner");
    expect(read("src/components/admin/inventory/EmailIntakeTable.tsx")).toContain('data-testid="invoice-amount-cell"');
    expect(read("src/components/admin/inventory/InboundAttentionPanel.tsx")).toContain("<CollapsedUntilLinked");
  });
  it("Vendor payments has the credit form behind payables.manage", () => {
    const a = read("src/app/admin/vendor-payments/actions.ts");
    const add = a.slice(a.indexOf("export async function addInvoiceCreditAction"));
    expect(add).toContain('requirePermission("payables.manage")');
    expect(add).toContain("validateManualCredit(");
    expect(add).toContain('action: "vendor_invoice.credit_added"');
    expect(read("src/app/admin/vendor-payments/page.tsx")).toContain("<InvoiceCreditForm />");
  });
});

describe("4. SOP, ledgers, concierge, migrations list", () => {
  it("say the same thing", () => {
    expect(read("docs/sop/SOP-04-receiving-intake.md")).toMatch(/\| \*\*Version\*\* \| 1\.9 \(Phase 3\.4/);
    expect(read("docs/sop/SOP-04-receiving-intake.md")).toContain("### 4.7b Invoice amount, credits and the vendor name (Phase 3.4)");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Receiving \\u2192 invoice credits, invoice amount and vendor name (Phase 3.4;");
    expect(read("docs/sop-program/03-FINDINGS-LEDGER.md")).toMatch(/### F-04-24[^\n]*\n- \*\*Status: FIXED \(Phase 3\.4/);
    expect(read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md")).toContain("Fix Phase 3.4 update to the SOP-04 rows");
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toContain("### Fix Phase 3.4 (F-04-24, F-04-25)");
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toMatch(/\| 3\.4 \| F-04-24[^\n]*\*\*BUILT\*\*/);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("## Fix 3.4 — 0322 —");
  });
});
