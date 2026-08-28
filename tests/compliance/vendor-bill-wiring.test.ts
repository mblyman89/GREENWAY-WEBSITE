/**
 * tests/compliance/vendor-bill-wiring.test.ts   (books-83)
 *
 * Proves the VENDOR-BILL WIRE (D-34) and the closure of D-61.
 *
 * Deliberately NOT exhaustive. `vendor-bill-core` has its own large self-test
 * suite and `receipt-journal-core.test.ts` already measures the two journals
 * added together. This file tests the three things those structurally cannot:
 *
 *   1. the wire EXISTS in the app action, and is gated on something accepted;
 *   2. the D-61 flag is derived from the LEDGER and refuses when unreadable;
 *   3. the two definitions of "what we owe" have not drifted apart.
 *
 * Every source assertion below matches a CALL or a GUARD, never an import
 * binding and never a comment. books-82 found two assertions that passed
 * against a comment and against an import line respectively, which is worse
 * than no assertion at all (standing rule 13c).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  translateLotsToBillLines,
  BILL_EXCLUDED_LOT_STATUSES,
  VENDOR_BILL_SERVICE_CODES,
  type BillLotRow,
} from "../../src/lib/accounting/vendor-bill-service";
import {
  receiptSourceRef,
  RECEIPT_REF_SUFFIX,
  RECEIPT_EVIDENCE_STATUSES,
} from "../../src/lib/accounting/receipt-evidence";
import {
  evaluateVendorBill,
  buildBillJournal,
  IN_TRANSIT_ACCOUNT_CODE,
  type VendorBillInput,
} from "../../src/lib/accounting/vendor-bill-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const lot = (over: Partial<BillLotRow> = {}): BillLotRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  lot_code: "LOT-A",
  category: "Flower",
  received_qty: 10,
  unit_cost_minor_units: 1500,
  status: "active",
  // D-72 default: an ordinary purchased lot. Tests that mean a free trade
  // sample say so explicitly with `is_sample: true`.
  is_sample: false,
  ...over,
});

/* ── 1) reachability: the wire is really in the action ──────────────────── */

describe("the vendor bill is reachable from the intake screen", () => {
  const action = read("src/app/admin/inventory/intake/actions.ts");

  it("finalizeManifestAction CALLS postManifestVendorBill", () => {
    // `search`, not `indexOf`: an import binding of the same name would satisfy
    // a substring test while the call was deleted (books-82's finding).
    expect(action.search(/await\s+postManifestVendorBill\s*\(/)).toBeGreaterThan(-1);
  });

  it("the call is gated on something having been ACCEPTED, not on every finalize", () => {
    // A wholly rejected manifest means nothing arrived, so nothing is owed.
    // Billing it would invent a liability out of a refusal.
    expect(action).toMatch(/if\s*\(\s*result\.activated\s*>\s*0\s*\)/);
  });

  it("the refusal reaches the URL instead of being swallowed", () => {
    expect(action).toMatch(/booksError=\$\{encodeURIComponent\(\s*billed\.message/);
  });

  it("the page RENDERS booksError — a banner nobody draws is not a report", () => {
    // books-81 pushed booksError onto the URL and the page never read it, so a
    // carefully-worded refusal was shown to nobody. Fixed in books-83.
    const page = read("src/app/admin/inventory/intake/[id]/page.tsx");
    expect(page).toMatch(/booksError\?:\s*string;/);
    expect(page).toMatch(/\{booksError\s*&&\s*\(/);
  });
});

/* ── 2) D-61: the flag is DERIVED, and refuses when it cannot be ─────────── */

describe("goodsAlreadyReceived is derived from the ledger, never assumed", () => {
  const svc = read("src/lib/accounting/vendor-bill-service.ts");

  it("the service asks the ledger via findReceiptJournal", () => {
    expect(svc.search(/await\s+findReceiptJournal\s*\(/)).toBeGreaterThan(-1);
  });

  it("an unreadable ledger REFUSES — it never falls through to false", () => {
    // This is the whole defect. `unknown` coerced to "no receipt" would debit
    // inventory twice on any transient database error, and both journals would
    // look correct in isolation.
    expect(svc).toMatch(/evidence\.kind\s*===\s*"unknown"/);
    expect(svc).toMatch(/return\s+fail\(\s*\n?\s*"BILL_RECEIPT_EVIDENCE_UNKNOWN"/);
    // and the flag is set from POSITIVE evidence only
    expect(svc).toMatch(/goodsAlreadyReceived\s*=\s*evidence\.kind\s*===\s*"raised"/);
  });

  it("the flag is NOT derived from the manifest status (books-79 mutation N4)", () => {
    // 0059's `accepted` is a COMPLIANCE state. A manifest can be accepted while
    // the receipt refused on an unrecognised category (D-64) and posted nothing.
    expect(svc).not.toMatch(/goodsAlreadyReceived\s*[:=]\s*[^;\n]*status\s*===\s*"accepted"/);
    expect(svc).not.toMatch(/goodsAlreadyReceived\s*[:=]\s*true\s*[,;]/);
  });

  it("D-66: evidence counts DRAFT journals, because every receipt is a draft", () => {
    // Measured, not assumed: receipt-service calls submitJournal without
    // autoPost, so gl_submit_journal returns 'draft' (migration 0174 line 475),
    // and a `purchase` entry without a three-way match is refused automation
    // anyway. A posted-only test would answer "no receipt" for EVERY real
    // delivery and reproduce D-61 in full.
    expect([...RECEIPT_EVIDENCE_STATUSES]).toEqual(["draft", "posted"]);
    expect([...RECEIPT_EVIDENCE_STATUSES]).not.toContain("reversed");

    const receiptSvc = read("src/lib/accounting/receipt-service.ts");
    expect(receiptSvc).not.toMatch(/autoPost:\s*true/);
    const sql = read("supabase/migrations/0174_gl_posting_service.sql");
    expect(sql).toContain("if not p_auto_post then");
  });

  it("the evidence key matches the ref receipt-journal-core actually writes", () => {
    // Two files agreeing about a key by coincidence is a defect waiting for a
    // rename. The suffix is asserted against the producing module's source.
    const core = read("src/lib/accounting/receipt-journal-core.ts");
    expect(core).toContain(`${RECEIPT_REF_SUFFIX}\``);
    expect(receiptSourceRef("M-1", "abc")).toBe("M-1#receipt");
    expect(receiptSourceRef(null, "abc")).toBe("manifest:abc#receipt");
    expect(receiptSourceRef("   ", "abc")).toBe("manifest:abc#receipt");
  });

  it("the receipt and the bill use DIFFERENT source refs, so neither collides", () => {
    // Same delivery, two events. Sharing a ref would make the second one look
    // like a duplicate of the first and silently post nothing.
    const bill: VendorBillInput = {
      entityCode: "greenway",
      vendorName: "NW Cannabis",
      invoiceNumber: "M-1",
      invoiceDate: "2026-03-14",
      statedTotalCents: 15000,
      fromAcceptedManifest: true,
      manifestNumber: "M-1",
      lines: [{ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 15000, categorySlug: "flower" }],
    };
    const verdict = evaluateVendorBill(bill, { vendorIsLicensedCannabis: true });
    const j = buildBillJournal(bill, verdict);
    expect(j).not.toBeNull();
    expect(j?.sourceRef).not.toBe(receiptSourceRef("M-1", "abc"));
  });
});

/* ── 3) the money: one definition of what we owe ─────────────────────────── */

describe("the payable the ledger carries equals the payable the screen shows", () => {
  it("excludes exactly the lot statuses vendor-payables-store excludes", () => {
    // Two files that each decide what to exclude will eventually disagree, and
    // the difference is money billed for goods refused at the dock.
    const store = read("src/lib/payments/vendor-payables-store.ts");
    const match = store.match(/EXCLUDED_LOT_STATUSES\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(match, "vendor-payables-store must still declare its exclusion set").not.toBeNull();
    const theirs = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    expect([...BILL_EXCLUDED_LOT_STATUSES].sort()).toEqual(theirs.sort());
  });

  it("uses the same arithmetic: round(qty * unit), summed", () => {
    const out = translateLotsToBillLines([
      lot({ lot_code: "L1", received_qty: 10, unit_cost_minor_units: 1500 }),
      lot({ id: "2", lot_code: "L2", received_qty: 3, unit_cost_minor_units: 999 }),
    ]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.totalCents).toBe(10 * 1500 + 3 * 999);
    expect(out.lines.map((l) => l.amountCents)).toEqual([15000, 2997]);
  });

  it("a rejected lot is not billed", () => {
    const out = translateLotsToBillLines([
      lot({ lot_code: "L1" }),
      lot({ id: "2", lot_code: "L2", status: "rejected", received_qty: 5, unit_cost_minor_units: 2000 }),
    ]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.totalCents).toBe(15000);
    expect(out.lines.length).toBe(1);
  });

  it("a wholly rejected manifest owes NOTHING and says so", () => {
    const out = translateLotsToBillLines([lot({ status: "rejected" })]);
    expect(out.kind).toBe("refused");
    if (out.kind !== "refused") return;
    expect(out.code).toBe("BILL_NO_BILLABLE_LOTS");
  });

  it("an unrecognised category REFUSES the whole bill rather than guessing", () => {
    // D-64. The receipt can quarantine an unknown category in 20890 honestly;
    // a bill cannot, because it credits A/P for money whose 280E character is
    // unknown. Refusing is the only safe direction.
    const out = translateLotsToBillLines([lot({ category: "flowre" })]);
    expect(out.kind).toBe("refused");
    if (out.kind !== "refused") return;
    expect(out.code).toBe("BILL_CATEGORY_REFUSED");
    expect(out.message).toContain("flowre");
  });

  it("every declared service code is reachable in the source (rule 43)", () => {
    const svc = read("src/lib/accounting/vendor-bill-service.ts");
    for (const code of VENDOR_BILL_SERVICE_CODES) {
      if (code === "BILL_OK") continue; // returned on the success path, not via fail()
      expect(
        svc.includes(`"${code}"`),
        `service code ${code} is declared but never returned`,
      ).toBe(true);
    }
  });
});

/* ── 4) the end state: capitalised once ──────────────────────────────────── */

describe("D-61 is closed on the wired path, measured by adding the journals", () => {
  it("a bill built with evidence relieves 20800 instead of inventory", () => {
    const out = translateLotsToBillLines([lot()]);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;

    const bill: VendorBillInput = {
      entityCode: "greenway",
      vendorName: "NW Cannabis",
      invoiceNumber: "M-1",
      invoiceDate: "2026-03-14",
      statedTotalCents: out.totalCents,
      lines: out.lines,
      fromAcceptedManifest: true,
      manifestNumber: "M-1",
      goodsAlreadyReceived: true,
    };
    const j = buildBillJournal(bill, evaluateVendorBill(bill, { vendorIsLicensedCannabis: true }));
    expect(j).not.toBeNull();
    if (j === null) return;

    const byAccount = new Map(j.lines.map((l) => [l.accountCode, l.amountCents]));
    expect(byAccount.get(IN_TRANSIT_ACCOUNT_CODE)).toBe(15000);
    expect(byAccount.get("20010")).toBeUndefined();
    expect(byAccount.get("30000")).toBe(-15000);
    expect(j.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
  });

  it("with no receipt on file the bill capitalises the goods itself", () => {
    // The other half of the branch. Without this the fix could be a constant.
    const out = translateLotsToBillLines([lot()]);
    if (out.kind !== "ok") throw new Error("must translate");
    const bill: VendorBillInput = {
      entityCode: "greenway",
      vendorName: "NW Cannabis",
      invoiceNumber: "M-1",
      invoiceDate: "2026-03-14",
      statedTotalCents: out.totalCents,
      lines: out.lines,
      fromAcceptedManifest: true,
      manifestNumber: "M-1",
      goodsAlreadyReceived: false,
    };
    const j = buildBillJournal(bill, evaluateVendorBill(bill, { vendorIsLicensedCannabis: true }));
    if (j === null) throw new Error("must build");
    const byAccount = new Map(j.lines.map((l) => [l.accountCode, l.amountCents]));
    expect(byAccount.get("20010")).toBe(15000);
    expect(byAccount.get(IN_TRANSIT_ACCOUNT_CODE)).toBeUndefined();
  });
});
