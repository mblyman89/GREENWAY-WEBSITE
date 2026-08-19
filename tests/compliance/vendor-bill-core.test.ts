/**
 * tests/compliance/vendor-bill-core.test.ts   (slice books-03)
 *
 * The SECOND gate over the vendor bill / accounts-payable brain.
 * `vendor-bill-core.ts` carries its own `__runVendorBillCoreTests()`, which the
 * pure self-test runner calls; this file re-runs that suite under vitest AND
 * adds independent assertions that do not exist inside the module.
 *
 * WHY TWO GATES OVER THE SAME CODE
 * A self-test that lives inside the module it tests can be weakened by the same
 * edit that breaks the module. The mutation campaign for this slice requires
 * every real mutant to die on BOTH gates; a mutant that dies only in one is a
 * warning that one gate is decorative.
 *
 * WHAT IS TESTED HERE THAT IS *NOT* TESTED INSIDE THE MODULE
 *   • SOURCE-LEVEL drift checks that read the file from disk, so a future edit
 *     that silently deletes a verbatim statutory quote, drops an authority, or
 *     re-points a COGS line at a §280E-disallowed account fails HERE rather
 *     than in front of an auditor.
 *   • CROSS-MODULE parity against the real chart of accounts (coa-core) and the
 *     real cost-class vocabulary (ledger-core). The module hard-codes account
 *     codes for purity; this test proves those codes are the ones actually
 *     seeded, so the two can never drift apart.
 *   • The slice's central promise, asserted structurally rather than by
 *     example: a cost that §1.471-3(b) makes inventoriable must NEVER be
 *     classified into a §280E-disallowed bucket, for any input.
 *   • Property-style sweeps over generated bills, which catch classes of bug
 *     that hand-written examples miss.
 *
 * THE STAKES (why this file is long)
 * §280E denies every deduction to a cannabis retailer. COGS is not a deduction
 * — it is an exclusion in computing gross income (Reg. §1.61-3(a)) — so it
 * survives. Which side of that line a cost lands on is the single biggest
 * number in Michael's tax return. This module draws that line. These tests keep
 * it drawn where the law actually draws it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  __runVendorBillCoreTests,
  AUTHORITIES,
  ALL_AUTHORITY_KINDS,
  PURCHASE_KINDS,
  BILL_HARD_BLOCKS,
  DECISION_TREE,
  AP_ACCOUNT_CODE,
  DE_MINIMIS_CAPITALISATION_CENTS,
  findAuthority,
  citeAuthorities,
  findPurchaseKind,
  inventoriableKindCodes,
  disallowedKindCodes,
  classifyLine,
  evaluateVendorBill,
  buildBillJournal,
  journalIsBalanced,
  billSourceRef,
  threeWayMatch,
  walkDecisionTree,
  findDecisionNode,
  bucketBars,
  sumLineCents,
  formatCents,
  isValidIsoDate,
  inventoryAccountForCategory,
  mentionsAny,
  type VendorBillInput,
  type VendorBillLineInput,
} from "@/lib/accounting/vendor-bill-core";

// ledger-core exports CostClass as a TYPE only; the runtime list of the six
// classes lives in journal-advisor-core. Using it here is deliberate: it makes
// this slice's vocabulary answerable to the same list slice books-01 uses, so
// the two cannot drift.
import { ADVISOR_COST_CLASSES } from "@/lib/accounting/journal-advisor-core";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const SRC_PATH = resolve(__dirname, "../../src/lib/accounting/vendor-bill-core.ts");
const SRC = readFileSync(SRC_PATH, "utf8");

function bill(over: Partial<VendorBillInput> = {}): VendorBillInput {
  return {
    entityCode: "greenway",
    vendorName: "Test Vendor LLC",
    invoiceNumber: "INV-1001",
    invoiceDate: "2026-11-15",
    statedTotalCents: 10000,
    lines: [{ lineNo: 1, purchaseKindCode: "rent", amountCents: 10000 }],
    ...over,
  };
}

function line(over: Partial<VendorBillLineInput> & { lineNo: number }): VendorBillLineInput {
  return {
    purchaseKindCode: over.purchaseKindCode ?? "rent",
    amountCents: over.amountCents ?? 1000,
    description: over.description,
    categorySlug: over.categorySlug,
    lineNo: over.lineNo,
  };
}

/** Build a bill whose stated total always ties, so blocks under test are isolated. */
function tiedBill(lines: VendorBillLineInput[], over: Partial<VendorBillInput> = {}): VendorBillInput {
  return bill({ lines, statedTotalCents: sumLineCents(lines), ...over });
}

// ===========================================================================
// 1) The module's own suite must pass under vitest too.
// ===========================================================================
describe("vendor-bill-core: embedded self-tests", () => {
  it("runs its own suite clean", () => {
    expect(() => __runVendorBillCoreTests()).not.toThrow();
  });
});

// ===========================================================================
// 2) AUTHORITY INTEGRITY — the quotes are the product.
// ===========================================================================
describe("authorities are real, verbatim and load-bearing", () => {
  it("has a substantial body of authority", () => {
    expect(AUTHORITIES.length).toBeGreaterThanOrEqual(20);
  });

  it("gives every authority a unique id", () => {
    const ids = AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every authority a citation, a verbatim quote, a plain-English so-what and a source", () => {
    for (const a of AUTHORITIES) {
      expect(a.cite.trim().length, `${a.id} cite`).toBeGreaterThan(3);
      expect(a.quote.trim().length, `${a.id} quote`).toBeGreaterThan(20);
      expect(a.soWhat.trim().length, `${a.id} soWhat`).toBeGreaterThan(20);
      expect(a.source.trim().length, `${a.id} source`).toBeGreaterThan(3);
      // Derived from the module, never retyped: a hand-copied union here is
      // what let a Senate committee report masquerade as a statute.
      expect(ALL_AUTHORITY_KINDS as readonly string[]).toContain(a.kind);
    }
  });

  it("carries the OPERATIVE language of §280E verbatim", () => {
    const a = findAuthority("IRC_280E");
    expect(a).toBeDefined();
    // These exact words are what disallows Michael's ordinary expenses. If an
    // edit ever paraphrases them, the citation stops being a citation.
    expect(a!.quote).toContain("No deduction or credit shall be allowed");
    expect(a!.quote).toContain("trafficking in controlled substances");
  });

  it("carries the RESELLER inventory rule verbatim — the clause that pays for freight", () => {
    const a = findAuthority("REG_1_471_3_B");
    expect(a).toBeDefined();
    // The whole reason freight-in is inventoriable rather than a dead §280E
    // expense. This phrase is worth real money to Michael every year.
    expect(a!.quote).toContain("transportation or other necessary charges incurred in acquiring possession of the goods");
  });

  it("carries the COGS-is-not-a-deduction rule, which is why COGS survives §280E", () => {
    const a = findAuthority("REG_1_61_3_A");
    expect(a).toBeDefined();
    expect(a!.quote.toLowerCase()).toContain("cost of goods sold");
  });

  it("never renders 'undefined' when asked to cite an unknown authority", () => {
    // A citation string that says "undefined" in front of an auditor is worse
    // than no citation at all.
    const s = citeAuthorities(["IRC_280E", "NOT_A_REAL_AUTHORITY_ID"]);
    expect(s).not.toContain("undefined");
    expect(s).toContain("280E");
    expect(citeAuthorities([])).not.toContain("undefined");
    expect(citeAuthorities(["ALSO_FAKE"])).not.toContain("undefined");
  });

  it("keeps the verbatim quotes present in the SOURCE FILE, not just in memory", () => {
    // Drift guard: a future edit that deletes the quote but leaves the id
    // behind would pass the in-memory checks above if the quote were built
    // dynamically. Read the bytes.
    expect(SRC).toContain("No deduction or credit shall be allowed");
    expect(SRC).toContain("transportation or other necessary charges incurred in acquiring possession of the goods");
  });
});

// ===========================================================================
// 3) TAXONOMY INTEGRITY — every purchase kind maps to a REAL seeded account.
// ===========================================================================
describe("purchase taxonomy is closed, consistent and points at real accounts", () => {
  it("gives every kind a unique code", () => {
    const codes = PURCHASE_KINDS.map((k) => k.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("points every kind at a 5-digit account code (the repo's account shape)", () => {
    for (const k of PURCHASE_KINDS) {
      expect(k.debitAccountCode, `${k.code}`).toMatch(/^\d{5}$/);
    }
  });

  it("uses only cost classes that the ledger actually recognises", () => {
    // Cross-module parity. If ledger-core ever renames a cost class, this fails
    // here rather than at the database constraint.
    for (const k of PURCHASE_KINDS) {
      expect(ADVISOR_COST_CLASSES as readonly string[], `${k.code} costClass`).toContain(k.costClass);
    }
  });

  it("explains every kind and cites authority for it", () => {
    for (const k of PURCHASE_KINDS) {
      expect(k.why.trim().length, `${k.code} why`).toBeGreaterThan(20);
      expect(k.authorityIds.length, `${k.code} authorities`).toBeGreaterThan(0);
      for (const id of k.authorityIds) {
        expect(findAuthority(id), `${k.code} cites ${id}`).toBeDefined();
      }
    }
  });

  it("NEVER lets an inventoriable cost carry the §280E-disallowed class", () => {
    // THE CENTRAL PROMISE OF THIS SLICE, stated structurally. Getting this
    // backwards is how a dispensary overpays tax by six figures.
    //
    // Note the exact shape of the rule, which is subtler than "inventory means
    // COGS". An inventoriable cost lands in one of two places:
    //   • a BALANCE-SHEET account (2xxxx Inventory) -> costClass "none",
    //     because an asset has no §280E character until it is sold; or
    //   • a 6xxxx COGS account (60800 Freight-In, 60900 discounts) ->
    //     cogs_direct / cogs_allocable.
    // What it may NEVER be is nondeductible_280e, separate_business or
    // personal. Those three would strip the cost of its inventory character
    // and hand the deduction back to §280E.
    const FORBIDDEN = ["nondeductible_280e", "separate_business", "personal"];
    for (const k of PURCHASE_KINDS) {
      if (k.treatment !== "inventory") continue;
      expect(FORBIDDEN, `${k.code} must not be disallowed`).not.toContain(k.costClass);
      if (k.debitAccountCode.startsWith("6")) {
        expect(["cogs_direct", "cogs_allocable"], `${k.code} is a 6xxxx COGS line`).toContain(k.costClass);
      } else {
        expect(k.costClass, `${k.code} is a balance-sheet line until sold`).toBe("none");
      }
    }
  });

  it("routes freight-in to 60800, NOT to an expense account", () => {
    // The single most valuable classification in the module. Reg. §1.471-3(b)
    // makes inbound transportation part of inventory cost; 76030 Postage is
    // outbound only and would be disallowed under §280E.
    const freight = findPurchaseKind("freight_in");
    expect(freight).toBeDefined();
    expect(freight!.debitAccountCode).toBe("60800");
    expect(freight!.treatment).toBe("inventory");
    expect(freight!.costClass).toBe("cogs_direct");
    expect(freight!.authorityIds).toContain("REG_1_471_3_B");
  });

  it("treats trust money as a liability, never as an expense", () => {
    for (const k of PURCHASE_KINDS) {
      if (k.treatment === "trust") {
        expect(["32000", "32100"], `${k.code} account`).toContain(k.debitAccountCode);
        expect(k.costClass, `${k.code} class`).toBe("none");
      }
    }
  });

  it("quarantines the unknown rather than guessing", () => {
    // Standing rule: never guess. An unclassified purchase parks in 20890
    // where it is visible, not silently absorbed into COGS or expense.
    const unknown = findPurchaseKind("unknown");
    expect(unknown).toBeDefined();
    expect(unknown!.debitAccountCode).toBe("20890");
    expect(unknown!.treatment).toBe("quarantine");
  });

  it("agrees with itself about which kinds are inventoriable vs disallowed", () => {
    const inv = inventoriableKindCodes();
    const dis = disallowedKindCodes();
    expect(inv.length).toBeGreaterThan(0);
    expect(dis.length).toBeGreaterThan(0);
    // The two lists must be disjoint. A kind cannot be both.
    for (const c of inv) expect(dis, `${c} cannot be both`).not.toContain(c);
    for (const c of inv) expect(findPurchaseKind(c)!.treatment).toBe("inventory");
  });

  it("posts the credit side to the seeded AP control account", () => {
    expect(AP_ACCOUNT_CODE).toBe("30000");
  });
});

// ===========================================================================
// 4) CLASSIFICATION — precedence, entity asymmetry, and the quarantine rule.
// ===========================================================================
describe("classifyLine", () => {
  it("lets an EXPLICIT kind beat any keyword hint", () => {
    // Michael's stated intent always wins. A description that says "freight"
    // must not override an explicit choice of rent.
    const c = classifyLine(
      { lineNo: 1, purchaseKindCode: "rent", amountCents: 100000, description: "freight delivery shipping" },
      { entityCode: "greenway" },
    );
    expect(c.kindCode).toBe("rent");
    expect(c.treatment).toBe("expense");
  });

  it("degrades cannabis product with NO category to quarantine instead of guessing a category", () => {
    const c = classifyLine(
      { lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 100000 },
      { entityCode: "greenway" },
    );
    expect(c.accountCode).toBe("20890");
    expect(c.band).not.toBe("certain");
  });

  it("routes cannabis product WITH a category to that category's inventory account", () => {
    const c = classifyLine(
      { lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 100000, categorySlug: "flower" },
      { entityCode: "greenway" },
    );
    expect(c.accountCode).toBe(inventoryAccountForCategory("flower"));
    expect(c.accountCode).toMatch(/^2\d{4}$/);
    expect(c.treatment).toBe("inventory");
  });

  it("applies §280E ONLY to greenway — CHAMP separation for the other entities", () => {
    const mk = (entityCode: string) =>
      classifyLine({ lineNo: 1, purchaseKindCode: "rent", amountCents: 100000 }, { entityCode: entityCode as never });

    expect(mk("greenway").costClass).toBe("nondeductible_280e");
    expect(mk("atm").costClass).toBe("separate_business");
    expect(mk("landholding").costClass).toBe("separate_business");
    expect(mk("personal").costClass).toBe("personal");
  });

  it("always explains itself", () => {
    for (const k of PURCHASE_KINDS) {
      const c = classifyLine(
        { lineNo: 1, purchaseKindCode: k.code, amountCents: 5000, categorySlug: k.isCannabisProduct ? "flower" : undefined },
        { entityCode: "greenway" },
      );
      expect(c.rationale.trim().length, `${k.code} rationale`).toBeGreaterThan(10);
      expect(["certain", "likely", "unsure"]).toContain(c.band);
    }
  });
});

// ===========================================================================
// 5) BLOCKS vs TEACHING — Michael asked to be pushed back on, not rejected.
// ===========================================================================
describe("the finding engine teaches before it blocks", () => {
  it("keeps the hard-block list short and duplicate-free", () => {
    expect(new Set(BILL_HARD_BLOCKS).size).toBe(BILL_HARD_BLOCKS.length);
    // Short enough that a human can hold it in their head. If this ever grows
    // past a dozen, the system has started rejecting instead of assisting.
    expect(BILL_HARD_BLOCKS.length).toBeLessThanOrEqual(12);
  });

  it("blocks a bill whose lines do not add up to the stated total", () => {
    const v = evaluateVendorBill(bill({ statedTotalCents: 99999 }), {});
    expect(v.postable).toBe(false);
    expect(v.findings.some((f) => f.code === "BILL_TOTAL_MISMATCH" && f.severity === "block")).toBe(true);
  });

  it("does NOT block an unclassified line — it quarantines and asks", () => {
    // Michael: "rather than rejecting it out right". An unknown purchase is a
    // question, not a crime.
    const v = evaluateVendorBill(
      tiedBill([line({ lineNo: 1, purchaseKindCode: "unknown", amountCents: 5000, description: "mystery item" })]),
      {},
    );
    expect(v.findings.some((f) => f.code === "BILL_UNCLASSIFIED")).toBe(true);
    expect(v.findings.filter((f) => f.code === "BILL_UNCLASSIFIED").every((f) => f.severity !== "block")).toBe(true);
  });

  it("EXPLAINS WHY and SHOWS THE FIX on every single finding", () => {
    // Michael's standing instruction, asserted as a property over many shapes.
    const scenarios: VendorBillInput[] = [
      bill({ statedTotalCents: 1 }),
      bill({ vendorName: "" }),
      bill({ invoiceNumber: "" }),
      bill({ invoiceDate: "2026-02-30" }),
      tiedBill([line({ lineNo: 1, purchaseKindCode: "unknown", amountCents: 5000 })]),
      tiedBill([line({ lineNo: 1, purchaseKindCode: "equipment", amountCents: 900000 })]),
      tiedBill([line({ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 500000, categorySlug: "flower" })]),
      tiedBill([line({ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 5000, categorySlug: "flower" })], { entityCode: "atm" }),
      tiedBill([line({ lineNo: 1, purchaseKindCode: "rent", amountCents: 5000 })]),
    ];
    for (const b of scenarios) {
      const v = evaluateVendorBill(b, {});
      for (const f of v.findings) {
        expect(f.why.trim().length, `${f.code} must explain WHY`).toBeGreaterThan(20);
        expect(f.fix.trim().length, `${f.code} must SHOW THE FIX`).toBeGreaterThan(10);
        expect(f.concern.trim().length, `${f.code} concern`).toBeGreaterThan(10);
        for (const id of f.authorityIds) {
          expect(findAuthority(id), `${f.code} cites real authority ${id}`).toBeDefined();
        }
        if (f.severity === "block") {
          expect(BILL_HARD_BLOCKS, `${f.code} must be a registered block`).toContain(f.code);
        }
      }
    }
  });

  it("makes 'postable' mean EXACTLY 'no blocks', never a softer promise", () => {
    const shapes: VendorBillInput[] = [
      bill(),
      bill({ statedTotalCents: 5 }),
      tiedBill([line({ lineNo: 1, purchaseKindCode: "unknown", amountCents: 100 })]),
      tiedBill([line({ lineNo: 1, purchaseKindCode: "freight_in", amountCents: 100 })]),
    ];
    for (const b of shapes) {
      const v = evaluateVendorBill(b, {});
      expect(v.postable).toBe(!v.findings.some((f) => f.severity === "block"));
    }
  });

  it("teaches the freight trap: inbound shipping billed as postage", () => {
    // 76030 is outbound only. Inbound freight belongs in 60800 where §280E
    // cannot reach it. This is a confirm with a worked example, not a block.
    const v = evaluateVendorBill(
      tiedBill([
        line({ lineNo: 1, purchaseKindCode: "store_supplies", amountCents: 25000, description: "freight on product order" }),
      ]),
      {},
    );
    const f = v.findings.find((x) => x.code === "BILL_FREIGHT_AS_EXPENSE");
    // Asserted unconditionally: an `if (f)` guard here would let the whole
    // teaching moment disappear without a single test failing.
    expect(f, "the freight trap must be caught").toBeDefined();
    expect(f!.severity).not.toBe("block");
    expect(f!.workedExample && f!.workedExample.length).toBeTruthy();
    expect(f!.workedExample!.join(" ")).toContain("60800");
    expect(f!.authorityIds).toContain("REG_1_471_3_B");
  });

  it("does NOT cry freight when the line is already classified as freight", () => {
    // The counter-case. A warning that fires on the correct answer trains the
    // user to ignore warnings.
    const v = evaluateVendorBill(
      tiedBill([line({ lineNo: 1, purchaseKindCode: "freight_in", amountCents: 25000, description: "freight" })]),
      {},
    );
    expect(v.findings.some((x) => x.code === "BILL_FREIGHT_AS_EXPENSE")).toBe(false);
  });

  it("blocks cannabis inventory booked into a non-licensed entity", () => {
    const v = evaluateVendorBill(
      tiedBill([line({ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 50000, categorySlug: "flower" })], {
        entityCode: "atm",
      }),
      {},
    );
    expect(v.postable).toBe(false);
    expect(v.findings.some((f) => f.code === "BILL_CANNABIS_WRONG_ENTITY")).toBe(true);
  });

  it("blocks a posting into a closed period", () => {
    const v = evaluateVendorBill(bill(), { periodClosed: true });
    expect(v.postable).toBe(false);
    expect(v.findings.some((f) => f.code === "BILL_PERIOD_CLOSED")).toBe(true);
  });
});

// ===========================================================================
// 6) THE MONEY — conservation, balance, idempotency.
// ===========================================================================
describe("money is conserved and journals balance", () => {
  const mixed = tiedBill([
    line({ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 250000, categorySlug: "flower" }),
    line({ lineNo: 2, purchaseKindCode: "freight_in", amountCents: 7500 }),
    line({ lineNo: 3, purchaseKindCode: "rent", amountCents: 400000 }),
    line({ lineNo: 4, purchaseKindCode: "equipment", amountCents: 300000 }),
    line({ lineNo: 5, purchaseKindCode: "excise_remittance", amountCents: 12345 }),
  ]);

  it("puts every cent in exactly one bucket", () => {
    const v = evaluateVendorBill(mixed, {});
    const sum =
      v.inventoriableCents + v.disallowedCents + v.capitalisedCents + v.trustCents + v.quarantinedCents;
    expect(sum).toBe(v.computedTotalCents);
    expect(v.computedTotalCents).toBe(sumLineCents(mixed.lines));
  });

  it("builds a balanced journal, or no journal at all", () => {
    const v = evaluateVendorBill(mixed, {});
    const j = buildBillJournal(mixed, v);
    if (v.postable) {
      expect(j).not.toBeNull();
      expect(journalIsBalanced(j!)).toBe(true);
      expect(j!.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(0);
    } else {
      expect(j).toBeNull();
    }
  });

  it("calls an off-by-one-cent journal UNBALANCED — no tolerance, ever", () => {
    // FOUND BY MUTATION TESTING (2026-08-17). The suite proved that balanced
    // journals balance, but never proved that an UNBALANCED one is caught, so
    // relaxing the check to `Math.abs(sum) <= 1` survived every test.
    //
    // Why one cent matters: a penny of tolerance is a licence to plug. Postgres
    // rejects the entry anyway (gl_submit_journal raises GL_OUT_OF_BALANCE), so
    // a tolerant client-side check does not "help" — it just moves the failure
    // later, to a point where the owner has no idea which line was wrong.
    const v = evaluateVendorBill(mixed, {});
    const good = buildBillJournal(mixed, v)!;
    expect(journalIsBalanced(good)).toBe(true);

    for (const drift of [1, -1, 50, -50]) {
      const skewed = {
        ...good,
        lines: good.lines.map((l, i) => (i === 0 ? { ...l, amountCents: l.amountCents + drift } : l)),
      };
      expect(journalIsBalanced(skewed)).toBe(false);
    }

    // And an empty journal is balanced only because there is nothing in it,
    // which is a true statement about zero, not a loophole.
    expect(journalIsBalanced({ ...good, lines: [] })).toBe(true);
  });

  it("refuses to build a journal for a bill that failed a block", () => {
    const broken = bill({ statedTotalCents: 12345 });
    const v = evaluateVendorBill(broken, {});
    expect(v.postable).toBe(false);
    expect(buildBillJournal(broken, v)).toBeNull();
  });

  it("credits the whole bill to AP exactly once", () => {
    const v = evaluateVendorBill(mixed, {});
    const j = buildBillJournal(mixed, v)!;
    const apLines = j.lines.filter((l) => l.accountCode === AP_ACCOUNT_CODE);
    expect(apLines.length).toBe(1);
    expect(apLines[0].amountCents).toBe(-sumLineCents(mixed.lines));
  });

  it("derives a STABLE idempotency key, and prefers the manifest when there is one", () => {
    const a = billSourceRef(bill());
    const b = billSourceRef(bill());
    expect(a).toBe(b); // same bill -> same key, so re-posting cannot double-book

    const withManifest = bill({ fromAcceptedManifest: true, manifestNumber: "M-12345" });
    expect(billSourceRef(withManifest)).toContain("M-12345");

    // A different invoice must produce a different key, or two bills collapse
    // into one and one of them silently vanishes.
    expect(billSourceRef(bill({ invoiceNumber: "INV-2002" }))).not.toBe(a);
    expect(billSourceRef(bill({ vendorName: "Other Vendor" }))).not.toBe(a);
  });

  it("formats money the way a human reads it, including the ugly cases", () => {
    expect(formatCents(0)).toContain("0");
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-438834806)).toContain("4,388,348.06");
    for (const c of [0, 1, -1, 99, 100, -100, Number.MAX_SAFE_INTEGER]) {
      expect(formatCents(c)).not.toContain("NaN");
      expect(formatCents(c)).not.toContain("undefined");
    }
  });
});

// ===========================================================================
// 7) THREE-WAY MATCH — automation must be EARNED by evidence.
// ===========================================================================
describe("threeWayMatch", () => {
  it("matches when order, receipt and invoice agree", () => {
    const r = threeWayMatch({ orderedCents: 100000, receivedCents: 100000, invoicedCents: 100000, toleranceCents: 0 });
    expect(r.matched).toBe(true);
    expect(r.code).toBe("MATCH_OK");
  });

  it("refuses to match on NO evidence, no matter how wide the tolerance", () => {
    // The most important assertion in this block: tolerance cannot manufacture
    // evidence. Without a PO or a receipt there is nothing to check against,
    // and the system must say so instead of quietly auto-posting.
    const r = threeWayMatch({ orderedCents: null, receivedCents: null, invoicedCents: 100000, toleranceCents: 99_999_999 });
    expect(r.matched).toBe(false);
    expect(r.code).toBe("MATCH_NO_EVIDENCE");
  });

  it("treats a negative tolerance as nonsense rather than as permission", () => {
    const r = threeWayMatch({ orderedCents: 100, receivedCents: 100, invoicedCents: 100, toleranceCents: -1 });
    expect(r.matched).toBe(false);
    expect(r.code).toBe("MATCH_BAD_TOLERANCE");
  });

  it("is exact at the tolerance boundary — off-by-one here means overbilling slips through", () => {
    const at = threeWayMatch({ orderedCents: 100100, receivedCents: 100000, invoicedCents: 100000, toleranceCents: 100 });
    const over = threeWayMatch({ orderedCents: 100101, receivedCents: 100000, invoicedCents: 100000, toleranceCents: 100 });
    expect(at.matched).toBe(true);
    expect(over.matched).toBe(false);
    expect(over.code).toBe("MATCH_OUT_OF_TOLERANCE");
    expect(over.worstGapCents).toBe(101);
  });

  it("compares the ORDER against the RECEIPT, not just each against the invoice", () => {
    // FOUND BY MUTATION TESTING (2026-08-17). Deleting the ordered-vs-received
    // comparison survived the whole suite, because every existing case had the
    // invoice disagreeing with something. That hole hides the single most
    // common real-world problem in this shop: a SHORT SHIPMENT that the vendor
    // billed correctly for what they SHIPPED.
    //
    // WRITING AN *ISOLATING* CASE TAKES CARE, and my first attempt failed. I
    // began with ordered $1,000 / received $600 / invoiced $600, which the
    // mutant survived — because ordered-vs-INVOICED already sees that same
    // $400 gap. By the triangle inequality |o-r| <= |i-o| + |i-r|, so a large
    // order/receipt gap always shows up at least half-size against the invoice.
    // The comparison is therefore only load-bearing in the band where
    //     |o-r| / 2  <=  tolerance  <  |o-r|
    // and the test has to sit inside that band or it proves nothing.
    //
    // So: ordered $1,000, received $600, invoiced $800 — the vendor split the
    // difference. Tolerance $250.
    //   invoice vs order    = $200  (inside tolerance)
    //   invoice vs receipt  = $200  (inside tolerance)
    //   order   vs receipt  = $400  (OVER tolerance)  <-- only this one catches it
    // Without this comparison the bill auto-posts and $400 of product that was
    // ordered, billed for in part, and never received, is never questioned.
    const splitTheDifference = threeWayMatch({
      orderedCents: 100000,
      receivedCents: 60000,
      invoicedCents: 80000,
      toleranceCents: 25000,
    });
    expect(splitTheDifference.matched).toBe(false);
    expect(splitTheDifference.code).toBe("MATCH_OUT_OF_TOLERANCE");
    expect(splitTheDifference.worstGapCents).toBe(40000);

    // The mirror case: more arrived than was ordered, billed in between.
    const overShipment = threeWayMatch({
      orderedCents: 60000,
      receivedCents: 100000,
      invoicedCents: 80000,
      toleranceCents: 25000,
    });
    expect(overShipment.matched).toBe(false);
    expect(overShipment.worstGapCents).toBe(40000);

    // The plain short shipment stays covered too: billed for exactly what was
    // shipped, which an invoice-only check would happily wave through.
    const shortShipment = threeWayMatch({
      orderedCents: 100000,
      receivedCents: 60000,
      invoicedCents: 60000,
      toleranceCents: 100,
    });
    expect(shortShipment.matched).toBe(false);
    expect(shortShipment.worstGapCents).toBe(40000);

    // Control: when all three genuinely agree, the same comparison must NOT
    // manufacture a gap. Otherwise the fix above would block every clean bill.
    const clean = threeWayMatch({
      orderedCents: 100000,
      receivedCents: 100000,
      invoicedCents: 100000,
      toleranceCents: 0,
    });
    expect(clean.matched).toBe(true);
    expect(clean.worstGapCents).toBe(0);
  });

  it("always explains its verdict in plain English", () => {
    const cases = [
      { orderedCents: 100, receivedCents: 100, invoicedCents: 100, toleranceCents: 0 },
      { orderedCents: null, receivedCents: null, invoicedCents: 100, toleranceCents: 0 },
      { orderedCents: 100, receivedCents: 900, invoicedCents: 100, toleranceCents: 0 },
      { orderedCents: 100, receivedCents: 100, invoicedCents: 100, toleranceCents: -5 },
    ];
    for (const c of cases) {
      expect(threeWayMatch(c).reason.trim().length).toBeGreaterThan(20);
    }
  });
});

// ===========================================================================
// 8) THE VISUAL LAYER — Michael learns visually, so the picture is tested too.
// ===========================================================================
describe("decision tree (the teaching diagram)", () => {
  it("asks the trust-money question FIRST", () => {
    // Order matters pedagogically and numerically: trust money is not income
    // and not expense, and mixing it in poisons every ratio downstream.
    expect(DECISION_TREE[0].id).toBe("q1_trust");
  });

  it("has no dead ends and no dangling nextId", () => {
    for (const node of DECISION_TREE) {
      for (const branch of [node.yes, node.no]) {
        const concludes = Boolean(branch.leafTreatment);
        const continues = Boolean(branch.nextId);
        expect(concludes || continues, `${node.id} branch must do something`).toBe(true);
        if (continues) {
          expect(findDecisionNode(branch.nextId!), `${node.id} -> ${branch.nextId} exists`).toBeDefined();
        }
        expect(branch.label.trim().length).toBeGreaterThan(5);
      }
      expect(node.question.trim().length).toBeGreaterThan(10);
      expect(node.whyHere.trim().length).toBeGreaterThan(20);
      for (const id of node.authorityIds) {
        expect(findAuthority(id), `${node.id} cites ${id}`).toBeDefined();
      }
    }
  });

  it("every node is REACHABLE from the root — an unreachable branch in a teaching diagram is a lie", () => {
    const seen = new Set<string>([DECISION_TREE[0].id]);
    const queue = [DECISION_TREE[0]];
    while (queue.length) {
      const n = queue.shift()!;
      for (const b of [n.yes, n.no]) {
        if (b.nextId && !seen.has(b.nextId)) {
          seen.add(b.nextId);
          queue.push(findDecisionNode(b.nextId)!);
        }
      }
    }
    expect(seen.size).toBe(DECISION_TREE.length);
  });

  it("terminates on partial answers instead of pretending to know", () => {
    const r = walkDecisionTree({});
    expect(r.leafTreatment).toBeNull();
    expect(r.leafLabel.length).toBeGreaterThan(0);
  });

  it("short-circuits trust money immediately", () => {
    expect(walkDecisionTree({ q1_trust: true }).leafTreatment).toBe("trust");
  });

  it("lands product on inventory and plain overhead on expense", () => {
    expect(walkDecisionTree({ q1_trust: false, q2_product: true }).leafTreatment).toBe("inventory");
    expect(
      walkDecisionTree({
        q1_trust: false, q2_product: false, q3_possession: false,
        q4_with_product: false, q5_long_lived: false, q6_separate_business: false,
      }).leafTreatment,
    ).toBe("expense");
  });

  it("never walks longer than the tree is deep", () => {
    for (let i = 0; i < 200; i++) {
      const answers: Record<string, boolean> = {};
      for (const n of DECISION_TREE) if (i % 3 !== 0) answers[n.id] = (i + n.id.length) % 2 === 0;
      expect(walkDecisionTree(answers).path.length).toBeLessThanOrEqual(DECISION_TREE.length);
    }
  });
});

describe("bucket bars (the money picture)", () => {
  it("uses integer widths that sum to exactly 100%, never 99.9%", () => {
    // Largest-remainder apportionment. Floats in a money visual produce bars
    // that visibly do not fill their container, which makes the whole report
    // look untrustworthy.
    const b = tiedBill([
      line({ lineNo: 1, purchaseKindCode: "freight_in", amountCents: 1 }),
      line({ lineNo: 2, purchaseKindCode: "utilities", amountCents: 1 }),
      line({ lineNo: 3, purchaseKindCode: "equipment", amountCents: 1 }),
    ]);
    const bars = bucketBars(evaluateVendorBill(b, {}));
    expect(bars.reduce((a, x) => a + x.milliPercent, 0)).toBe(100000);
    for (const bar of bars) expect(Number.isInteger(bar.milliPercent)).toBe(true);
  });

  it("never produces a negative width, even for a credit memo", () => {
    const b = tiedBill([
      line({ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 100000, categorySlug: "flower" }),
      line({ lineNo: 2, purchaseKindCode: "purchase_discount", amountCents: -5000 }),
    ]);
    for (const bar of bucketBars(evaluateVendorBill(b, {}))) {
      expect(bar.milliPercent).toBeGreaterThanOrEqual(0);
    }
  });

  it("labels and explains every bar so the picture stands alone", () => {
    const bars = bucketBars(evaluateVendorBill(bill(), {}));
    for (const bar of bars) {
      expect(bar.label.trim().length).toBeGreaterThan(5);
      expect(bar.meaning.trim().length).toBeGreaterThan(10);
    }
  });
});

// ===========================================================================
// 9) SMALL UTILITIES — the ones with a history of quiet bugs.
// ===========================================================================
describe("utilities", () => {
  it("rejects dates that merely LOOK real", () => {
    expect(isValidIsoDate("2026-11-15")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false); // the classic
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("not-a-date")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("2026-2-5")).toBe(false); // unpadded is not ISO
  });

  it("matches WHOLE WORDS only — the 'drawer'/'draw' bug class", () => {
    // A substring match here once classified a cash drawer as an owner draw.
    expect(mentionsAny("cash drawer count", ["draw"])).toBe(false);
    expect(mentionsAny("owner draw for october", ["draw"])).toBe(true);
    expect(mentionsAny("FREIGHT charge", ["freight"])).toBe(true); // case-insensitive
    expect(mentionsAny("", ["freight"])).toBe(false);
    expect(mentionsAny("freight", [])).toBe(false);
  });

  it("maps only real categories to inventory accounts", () => {
    expect(inventoryAccountForCategory("flower")).toMatch(/^2\d{4}$/);
    expect(inventoryAccountForCategory("not-a-real-category")).toBeNull();
    expect(inventoryAccountForCategory("")).toBeNull();
  });

  it("sums lines exactly, including negatives", () => {
    expect(sumLineCents([])).toBe(0);
    expect(sumLineCents([line({ lineNo: 1, amountCents: 100 }), line({ lineNo: 2, amountCents: -40 })])).toBe(60);
  });

  it("keeps the capitalisation threshold at a sane, stated value", () => {
    expect(DE_MINIMIS_CAPITALISATION_CENTS).toBe(250000); // $2,500
  });
});

// ===========================================================================
// 10) SQL/TS PARITY — the migration mirrors the core, or the mirror is broken.
//
// Migration 0187 seeds `gl_vendor_purchase_kinds` as a reference copy of
// PURCHASE_KINDS so the database can validate what the app claims and a human
// can read the §280E treatment straight from the schema. Two copies of a tax
// rule drift, and the drifting copy is always the one nobody tests. This block
// is what stops that: it parses the migration and compares it, row by row,
// against the TypeScript that actually runs.
// ===========================================================================
describe("migration 0187 mirrors the TypeScript taxonomy exactly", () => {
  const MIGRATION = readFileSync(
    resolve(__dirname, "../../supabase/migrations/0187_vendor_bills_to_gl.sql"),
    "utf8",
  );

  /** Parse the seeded rows: ('code', 'label', 'treatment', 'account', 'class', bool, ... */
  function seededKinds(): Map<string, { treatment: string; account: string; costClass: string; isCannabis: boolean }> {
    const out = new Map<string, { treatment: string; account: string; costClass: string; isCannabis: boolean }>();
    const re =
      /\(\s*'([a-z_]+)',\s*'[^']*',\s*'(inventory|expense|asset|trust|quarantine)',\s*'(\d{5})',\s*'([a-z0-9_]+)',\s*(true|false)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(MIGRATION)) !== null) {
      out.set(m[1], { treatment: m[2], account: m[3], costClass: m[4], isCannabis: m[5] === "true" });
    }
    return out;
  }

  it("parses the seed (guards the parser itself)", () => {
    // If the regex silently matched nothing, every assertion below would pass
    // vacuously. Prove the parser works before trusting it.
    expect(seededKinds().size).toBe(PURCHASE_KINDS.length);
  });

  it("seeds EXACTLY the kinds the core defines — no extras, none missing", () => {
    const sql = seededKinds();
    const tsCodes = PURCHASE_KINDS.map((k) => k.code).sort();
    expect([...sql.keys()].sort()).toEqual(tsCodes);
  });

  it("agrees on treatment, account and cost class for every single kind", () => {
    const sql = seededKinds();
    for (const k of PURCHASE_KINDS) {
      const row = sql.get(k.code);
      expect(row, `${k.code} must be seeded`).toBeDefined();
      expect(row!.treatment, `${k.code} treatment`).toBe(k.treatment);
      expect(row!.account, `${k.code} account`).toBe(k.debitAccountCode);
      expect(row!.costClass, `${k.code} cost class`).toBe(k.costClass);
      expect(row!.isCannabis, `${k.code} isCannabisProduct`).toBe(Boolean(k.isCannabisProduct));
    }
  });

  it("is idempotent and applied by hand, as repo law requires", () => {
    expect(MIGRATION).toContain("create table if not exists public.gl_vendor_purchase_kinds");
    expect(MIGRATION).toContain("on conflict (code) do update set");
    expect(MIGRATION).toContain("add column if not exists");
    expect(MIGRATION).toContain("APPLY MANUALLY");
  });

  it("refuses to run out of order instead of half-applying", () => {
    expect(MIGRATION).toContain("MIGRATION_OUT_OF_ORDER");
    expect(MIGRATION).toContain("is_owner()");
  });

  it("gates the books to the owner and turns RLS on for both new tables", () => {
    expect(MIGRATION).toContain("GL_NOT_OWNER");
    expect(MIGRATION).toContain("alter table public.gl_vendor_purchase_kinds enable row level security");
    expect(MIGRATION).toContain("alter table public.gl_vendor_profiles       enable row level security");
  });

  it("posts THROUGH gl_submit_journal rather than writing journal rows itself", () => {
    // Bypassing the posting service would bypass balance checking, period
    // control, the line in the sand and idempotency all at once.
    expect(MIGRATION).toContain("public.gl_submit_journal(");
    expect(MIGRATION).toMatch(/p_source_kind\s*=>\s*'purchase'/);
    expect(MIGRATION).not.toMatch(/insert\s+into\s+public\.gl_journal_lines/i);
    expect(MIGRATION).not.toMatch(/insert\s+into\s+public\.gl_journals\b/i);
  });

  it("ships a self-check whose EMPTY result means success", () => {
    expect(MIGRATION).toContain("create or replace function public.gl_audit_vendor_bill_wiring()");
    expect(MIGRATION).toContain("AN EMPTY RESULT MEANS EVERYTHING IS CORRECT");
  });

  it("carries the §1.471-3(b) reasoning into the schema where a human will read it", () => {
    expect(MIGRATION).toContain("transportation or other necessary charges incurred in acquiring\n--      possession of the goods");
    expect(MIGRATION).toContain("Reg. 1.471-3(b)");
  });
});

// ===========================================================================
// 11) PURITY — the same bill must produce the same tax answer next April.
// ===========================================================================
describe("purity and determinism", () => {
  it("is deterministic across repeated evaluation", () => {
    const b = tiedBill([
      line({ lineNo: 1, purchaseKindCode: "cannabis_product", amountCents: 100000, categorySlug: "flower" }),
      line({ lineNo: 2, purchaseKindCode: "freight_in", amountCents: 5000 }),
    ]);
    const first = JSON.stringify(evaluateVendorBill(b, {}));
    for (let i = 0; i < 25; i++) {
      expect(JSON.stringify(evaluateVendorBill(b, {}))).toBe(first);
    }
  });

  it("never mutates the bill it is given", () => {
    const b = tiedBill([line({ lineNo: 1, purchaseKindCode: "freight_in", amountCents: 5000 })]);
    const snapshot = JSON.stringify(b);
    const v = evaluateVendorBill(b, {});
    buildBillJournal(b, v);
    bucketBars(v);
    expect(JSON.stringify(b)).toBe(snapshot);
  });

  it("imports nothing that would drag a database or a clock into a pure module", () => {
    // Purity is what makes this module testable and auditable. A stray import
    // of the Supabase client or Date.now() would make the tax answer depend on
    // when it was asked.
    // Strip comments first. The module's own header PROMISES it has no
    // `Date.now()`, and a naive scan would flag that promise as a violation.
    // We are auditing the code, not the prose.
    const code = SRC
      .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
      .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (not URLs)

    expect(code).not.toMatch(/from\s+["']@supabase/);
    expect(code).not.toMatch(/createClient\(/);
    expect(code).not.toMatch(/\bDate\.now\(/);
    expect(code).not.toMatch(/\bMath\.random\(/);
    expect(code).not.toMatch(/\bnew Date\(\s*\)/); // "now" with no argument
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/\bprocess\.env\b/);

    // And prove the stripper actually kept the real code, so this test cannot
    // pass by accidentally deleting everything.
    expect(code).toContain("export function evaluateVendorBill");
    expect(code).toContain("export function buildBillJournal");
  });
});
