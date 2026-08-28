/**
 * tests/compliance/receipt-journal-core.test.ts
 *
 * The receipt is the event where cost is born. Every later number — inventory,
 * COGS, gross margin, the §280E deduction that is the only deduction this
 * business gets — inherits whatever is decided here. So these tests are not
 * satisfied by "it returns an object": they run the journal through the REAL
 * ledger validator, read the REAL migration off disk, and execute the REAL
 * vendor-bill builder to prove the collision recorded as D-61.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildReceiptJournal,
  receivedCentsForMatch,
  __runReceiptJournalCoreTests,
  IN_TRANSIT_ACCOUNT,
  QUARANTINE_ACCOUNT,
  RECEIPT_REFUSAL_CODES,
  type ReceiptInput,
} from "../../src/lib/accounting/receipt-journal-core";
import {
  INVENTORY_CATEGORIES,
  inventoryAccountCode,
} from "../../src/lib/accounting/coa-core";
import {
  validateJournalDraft,
  LINE_IN_THE_SAND,
  type LedgerAccount,
} from "../../src/lib/accounting/ledger-core";
import {
  evaluateVendorBill,
  buildBillJournal,
  threeWayMatch,
  type VendorBillInput,
} from "../../src/lib/accounting/vendor-bill-core";

/* ── the chart, shaped as migration 0173 seeds it ───────────────────────── */

function seededAccounts(): Map<string, LedgerAccount> {
  const m = new Map<string, LedgerAccount>();
  for (const c of INVENTORY_CATEGORIES) {
    const code = inventoryAccountCode(c.slot);
    m.set(code, {
      code,
      name: `Inventory — ${c.label}`,
      type: "asset",
      normalBalance: "debit",
      isControl: false,
      requiresCostClass: false,
      allowedEntityCodes: ["greenway"],
      active: true,
    });
  }
  for (const [code, name] of [
    [IN_TRANSIT_ACCOUNT, "Inventory — In Transit"],
    [QUARANTINE_ACCOUNT, "Inventory — UNCLASSIFIED (quarantine)"],
  ] as const) {
    m.set(code, {
      code,
      name,
      type: "asset",
      normalBalance: "debit",
      isControl: false,
      requiresCostClass: false,
      allowedEntityCodes: ["greenway"],
      active: true,
    });
  }
  m.set("30000", {
    code: "30000",
    name: "Accounts Payable",
    type: "liability",
    normalBalance: "credit",
    isControl: true,
    controlSubledger: "ap",
    requiresCostClass: false,
    allowedEntityCodes: null,
    active: true,
  });
  return m;
}

const BASE: ReceiptInput = {
  receivedDate: "2026-03-14",
  receiptRef: "PO-1001",
  vendorName: "Northwest Cannabis Solutions",
  lines: [{ categorySlug: "flower", quantityReceived: 10, unitCostCents: 1500, lotCode: "LOT-A" }],
};

const sum = (ls: readonly { amountCents: number }[]): number =>
  ls.reduce((a, l) => a + l.amountCents, 0);

/* ── 1) the module's own sweep ──────────────────────────────────────────── */

describe("receipt-journal-core self-tests", () => {
  it("passes its own in-module sweep", () => {
    expect(() => __runReceiptJournalCoreTests()).not.toThrow();
  });
});

/* ── 2) against the REAL validator, not a local imitation ───────────────── */

describe("the receipt journal survives the real ledger validator", () => {
  const accounts = seededAccounts();

  it("accepts a plain receipt with no issues at all", () => {
    const out = buildReceiptJournal(BASE);
    expect(out.kind).toBe("built");
    if (out.kind !== "built") return;
    const res = validateJournalDraft(out.journal, accounts);
    expect(res.issues.map((i) => i.code)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  // Rule 13d: test every case, not one happy example. A receipt that balances
  // for flower but not for tinctures is a receipt that fails in November.
  it("accepts a receipt for EVERY seeded category, at several magnitudes", () => {
    for (const c of INVENTORY_CATEGORIES) {
      for (const unit of [1, 7, 999, 123_456]) {
        const out = buildReceiptJournal({
          ...BASE,
          receiptRef: `PO-${c.slug}-${unit}`,
          lines: [{ categorySlug: c.slug, quantityReceived: 3, unitCostCents: unit }],
        });
        expect(out.kind, `${c.slug}@${unit}`).toBe("built");
        if (out.kind !== "built") continue;
        const res = validateJournalDraft(out.journal, accounts);
        expect(res.issues.map((i) => i.code), `${c.slug}@${unit}`).toEqual([]);
        expect(out.journal.lines[0].accountCode).toBe(inventoryAccountCode(c.slot));
        expect(out.totalCostCents).toBe(unit * 3);
      }
    }
  });

  it("accepts a 21-category delivery with a quarantine line, and still balances", () => {
    const out = buildReceiptJournal({
      ...BASE,
      receiptRef: "PO-BIG",
      lines: [
        ...INVENTORY_CATEGORIES.map((c) => ({
          categorySlug: c.slug,
          quantityReceived: 2,
          unitCostCents: 1234,
        })),
        { categorySlug: null, quantityReceived: 1, unitCostCents: 500 },
      ],
    });
    expect(out.kind).toBe("built");
    if (out.kind !== "built") return;
    expect(validateJournalDraft(out.journal, accounts).ok).toBe(true);
    expect(out.journal.lines.length).toBe(INVENTORY_CATEGORIES.length + 2);
    expect(sum(out.journal.lines)).toBe(0);
    expect(out.quarantinedCostCents).toBe(500);
  });
});

/* ── 3) D-61: the collision, proven by RUNNING the other builder ────────── */

describe("D-61 — the receipt and the vendor bill collide on inventory", () => {
  const CENTS = 15_000;

  const bill: VendorBillInput = {
    entityCode: "greenway",
    vendorName: "Northwest Cannabis Solutions",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-03-14",
    statedTotalCents: CENTS,
    fromAcceptedManifest: true,
    manifestNumber: "M-2026-03-14-001",
    lines: [
      {
        lineNo: 1,
        purchaseKindCode: "cannabis_product",
        amountCents: CENTS,
        description: "flower",
        categorySlug: "flower",
      },
    ],
  };

  it("the bill debits the CATEGORY account and credits A/P — measured, not assumed", () => {
    const verdict = evaluateVendorBill(bill, { vendorIsLicensedCannabis: true });
    const j = buildBillJournal(bill, verdict);
    expect(j).not.toBeNull();
    if (j === null) return;
    const debits = j.lines.filter((l) => l.amountCents > 0).map((l) => l.accountCode);
    const credits = j.lines.filter((l) => l.amountCents < 0).map((l) => l.accountCode);
    expect(debits).toEqual(["20010"]);
    expect(credits).toEqual(["30000"]);
  });

  it("the bill does not touch 20800, so nothing relieves in-transit yet", () => {
    const verdict = evaluateVendorBill(bill, { vendorIsLicensedCannabis: true });
    const j = buildBillJournal(bill, verdict);
    if (j === null) throw new Error("bill must be postable for this test to mean anything");
    expect(j.lines.some((l) => l.accountCode === IN_TRANSIT_ACCOUNT)).toBe(false);
  });

  /**
   * THE GATE. Written to fail in BOTH directions:
   *
   *  - if someone fixes the bill to relieve 20800, the collision disappears and
   *    this test fails, forcing D-61 to be closed deliberately;
   *  - if someone changes the receipt to credit A/P instead, the second
   *    expectation fails, because that is the double-count itself.
   *
   * Rule 13c: a test that cannot fail is worse than no test. This one is
   * deliberately aimed at the fix as well as the bug so it cannot rot into
   * protecting the defect.
   */
  it("both builders debit 20010 for the same goods — the latent double count", () => {
    const verdict = evaluateVendorBill(bill, { vendorIsLicensedCannabis: true });
    const billJournal = buildBillJournal(bill, verdict);
    const receipt = buildReceiptJournal({
      receivedDate: "2026-03-14",
      receiptRef: "M-2026-03-14-001",
      vendorName: "Northwest Cannabis Solutions",
      lines: [{ categorySlug: "flower", quantityReceived: 10, unitCostCents: 1500 }],
    });
    expect(receipt.kind).toBe("built");
    if (billJournal === null || receipt.kind !== "built") return;

    const billDebits20010 = billJournal.lines.some(
      (l) => l.accountCode === "20010" && l.amountCents > 0,
    );
    const receiptDebits20010 = receipt.journal.lines.some(
      (l) => l.accountCode === "20010" && l.amountCents > 0,
    );

    expect(
      billDebits20010 && receiptDebits20010,
      "D-61 is resolved or has changed shape — re-read docs/DEFECTS.md D-61 " +
        "before editing this assertion",
    ).toBe(true);

    // Same goods, same amount, counted twice if both ever post.
    expect(receipt.totalCostCents).toBe(CENTS);
  });

  it("the receipt NEVER touches accounts payable — that is the half we control", () => {
    const out = buildReceiptJournal(BASE);
    if (out.kind !== "built") throw new Error("must build");
    for (const l of out.journal.lines) {
      expect(l.accountCode).not.toBe("30000");
    }
    const credits = out.journal.lines.filter((l) => l.amountCents < 0);
    expect(credits.length).toBe(1);
    expect(credits[0].accountCode).toBe(IN_TRANSIT_ACCOUNT);
  });

  it("the danger is latent, not live: neither builder is reachable", () => {
    // Rule 43's cousin — a trap that cannot spring today still must be recorded.
    const census = readFileSync(
      join(process.cwd(), "src/lib/accounting/ledger-census-data.ts"),
      "utf8",
    );
    expect(census).toContain("gl_post_vendor_bill has no caller outside its migration.");
  });
});

/* ── 4) the chart is read from disk, not transcribed from memory ────────── */

describe("the accounts this module names are really seeded", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0173_chart_of_accounts.sql"),
    "utf8",
  );

  it("20800 is a seeded ASSET whose stated purpose is exactly this entry", () => {
    expect(sql).toContain("'20800','Inventory — In Transit','asset'");
    expect(sql).toContain(
      "Received not invoiced, or invoiced not received. Visible instead of absorbed.",
    );
  });

  it("20890 is the seeded quarantine account", () => {
    expect(sql).toContain("'20890','Inventory — UNCLASSIFIED (quarantine)','asset'");
  });

  it("every account the builder can emit exists in the migration", () => {
    const emitted = new Set<string>([IN_TRANSIT_ACCOUNT, QUARANTINE_ACCOUNT]);
    for (const c of INVENTORY_CATEGORIES) emitted.add(inventoryAccountCode(c.slot));
    for (const code of emitted) {
      expect(sql, `account ${code} must be seeded`).toContain(`'${code}'`);
    }
  });
});

/* ── 5) refusals: every code reachable, and each for the right reason ───── */

describe("the builder refuses rather than inventing a number", () => {
  const cases: ReadonlyArray<readonly [string, ReceiptInput]> = [
    ["NO_LINES", { ...BASE, lines: [] }],
    ["DATE_BEFORE_CUTOVER", { ...BASE, receivedDate: "2025-12-31" }],
    [
      "UNKNOWN_CATEGORY",
      { ...BASE, lines: [{ categorySlug: "flowre", quantityReceived: 1, unitCostCents: 100 }] },
    ],
    [
      "NON_POSITIVE_QUANTITY",
      { ...BASE, lines: [{ categorySlug: "flower", quantityReceived: 0, unitCostCents: 100 }] },
    ],
    [
      "UNIT_COST_UNKNOWN",
      { ...BASE, lines: [{ categorySlug: "flower", quantityReceived: 1, unitCostCents: null }] },
    ],
    [
      "NEGATIVE_UNIT_COST",
      { ...BASE, lines: [{ categorySlug: "flower", quantityReceived: 1, unitCostCents: -5 }] },
    ],
    [
      "FRACTIONAL_CENTS",
      { ...BASE, lines: [{ categorySlug: "flower", quantityReceived: 1, unitCostCents: 10.5 }] },
    ],
    [
      "NOTHING_TO_CAPITALISE",
      { ...BASE, lines: [{ categorySlug: "flower", quantityReceived: 5, unitCostCents: 0 }] },
    ],
  ];

  for (const [code, input] of cases) {
    it(`emits ${code}`, () => {
      const out = buildReceiptJournal(input);
      expect(out.kind).toBe("refused");
      if (out.kind !== "refused") return;
      expect(out.code).toBe(code);
      // Rule: a refusal that does not tell Michael what to do is a dead end.
      expect(out.explanation.length).toBeGreaterThan(20);
      expect(out.resolution.length).toBeGreaterThan(20);
    });
  }

  it("no refusal code is decoration — every one is reachable", () => {
    const reached = new Set(
      cases
        .map(([, i]) => buildReceiptJournal(i))
        .filter((o) => o.kind === "refused")
        .map((o) => (o.kind === "refused" ? o.code : "")),
    );
    for (const code of RECEIPT_REFUSAL_CODES) {
      expect(reached.has(code), `unreachable refusal code: ${code}`).toBe(true);
    }
    expect(reached.size).toBe(RECEIPT_REFUSAL_CODES.length);
  });

  it("the cutover boundary is exact: the line in the sand itself is allowed", () => {
    expect(buildReceiptJournal({ ...BASE, receivedDate: LINE_IN_THE_SAND }).kind).toBe("built");
    expect(buildReceiptJournal({ ...BASE, receivedDate: "2025-12-31" }).kind).toBe("refused");
  });

  it("a typo is refused but an honest unknown is quarantined — different problems", () => {
    const typo = buildReceiptJournal({
      ...BASE,
      lines: [{ categorySlug: "flowre", quantityReceived: 1, unitCostCents: 100 }],
    });
    const unknown = buildReceiptJournal({
      ...BASE,
      lines: [{ categorySlug: null, quantityReceived: 1, unitCostCents: 100 }],
    });
    expect(typo.kind).toBe("refused");
    expect(unknown.kind).toBe("built");
    if (unknown.kind !== "built") return;
    expect(unknown.journal.lines[0].accountCode).toBe(QUARANTINE_ACCOUNT);
    expect(unknown.quarantinedCostCents).toBe(100);
  });
});

/* ── 6) the arithmetic, and the shape the ledger demands ────────────────── */

describe("the numbers and the journal shape", () => {
  it("collapses repeated categories but keeps every lot cost", () => {
    const out = buildReceiptJournal({
      ...BASE,
      lines: [
        { categorySlug: "flower", quantityReceived: 4, unitCostCents: 1000, lotCode: "L1" },
        { categorySlug: "flower", quantityReceived: 6, unitCostCents: 2000, lotCode: "L2" },
      ],
    });
    expect(out.kind).toBe("built");
    if (out.kind !== "built") return;
    expect(out.journal.lines.length).toBe(2);
    expect(out.totalCostCents).toBe(4 * 1000 + 6 * 2000);
    // The ledger wants one line; the lot table wants both costs. Losing a lot
    // cost here would re-create the UNIT_COST_UNKNOWN hole this slice exists to
    // close, so it is asserted rather than assumed.
    expect(out.lotCosts.map((l) => l.lotCode).sort()).toEqual(["L1", "L2"]);
  });

  it("puts quarantine last among the debits, so the odd one out reads last", () => {
    const out = buildReceiptJournal({
      ...BASE,
      lines: [
        { categorySlug: null, quantityReceived: 1, unitCostCents: 100 },
        { categorySlug: "topical", quantityReceived: 1, unitCostCents: 200 },
        { categorySlug: "flower", quantityReceived: 1, unitCostCents: 300 },
      ],
    });
    expect(out.kind).toBe("built");
    if (out.kind !== "built") return;
    expect(out.journal.lines.map((l) => l.accountCode)).toEqual([
      "20010",
      "20190",
      QUARANTINE_ACCOUNT,
      IN_TRANSIT_ACCOUNT,
    ]);
  });

  it("is deterministic — the same delivery twice yields identical journals", () => {
    const a = buildReceiptJournal(BASE);
    const b = buildReceiptJournal(BASE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("carries a purchase sourceKind and a receipt-suffixed idempotency ref", () => {
    const out = buildReceiptJournal(BASE);
    if (out.kind !== "built") throw new Error("must build");
    expect(out.journal.sourceKind).toBe("purchase");
    // sourceRef is optional on JournalDraft, so prove it is actually present
    // before asserting its shape — an absent ref would make the two assertions
    // below pass vacuously, which is exactly the kind of test rule 13c forbids.
    const ref = out.journal.sourceRef;
    expect(typeof ref).toBe("string");
    expect(ref).toBe("PO-1001#receipt");
    // The bill's own ref is "manifest:..." or "bill:...", so the two can never
    // collide on the idempotency key even for the same delivery.
    expect((ref ?? "").startsWith("manifest:")).toBe(false);
    expect((ref ?? "").startsWith("bill:")).toBe(false);
  });

  it("tags every line costClass 'none' — goods carry no §280E character yet", () => {
    const out = buildReceiptJournal({
      ...BASE,
      lines: [
        { categorySlug: "flower", quantityReceived: 1, unitCostCents: 100 },
        { categorySlug: "accessories", quantityReceived: 1, unitCostCents: 100 },
        { categorySlug: null, quantityReceived: 1, unitCostCents: 100 },
      ],
    });
    if (out.kind !== "built") throw new Error("must build");
    for (const l of out.journal.lines) expect(l.costClass).toBe("none");
  });

  it("never emits a zero-amount line, which migration 0172 forbids outright", () => {
    const out = buildReceiptJournal({
      ...BASE,
      lines: [
        { categorySlug: "flower", quantityReceived: 1, unitCostCents: 0 },
        { categorySlug: "trim", quantityReceived: 1, unitCostCents: 250 },
      ],
    });
    if (out.kind !== "built") throw new Error("must build");
    for (const l of out.journal.lines) expect(l.amountCents).not.toBe(0);
    expect(out.totalCostCents).toBe(250);
  });

  it("keeps large deliveries exact — integer cents, no float drift", () => {
    const out = buildReceiptJournal({
      ...BASE,
      lines: [{ categorySlug: "flower", quantityReceived: 9_999, unitCostCents: 987_654 }],
    });
    if (out.kind !== "built") throw new Error("must build");
    expect(out.totalCostCents).toBe(9_999 * 987_654);
    expect(Number.isSafeInteger(out.totalCostCents)).toBe(true);
    expect(sum(out.journal.lines)).toBe(0);
  });
});

/* ── 7) the bridge to the match that already existed ────────────────────── */

describe("receivedCentsForMatch finally feeds threeWayMatch", () => {
  it("supplies the number threeWayMatch has always accepted and never received", () => {
    const out = buildReceiptJournal(BASE);
    const received = receivedCentsForMatch(out);
    expect(received).toBe(15_000);

    const verdict = threeWayMatch({
      orderedCents: 15_000,
      receivedCents: received,
      invoicedCents: 15_000,
      toleranceCents: 0,
    });
    expect(verdict.matched).toBe(true);
    expect(verdict.code).toBe("MATCH_OK");
  });

  it("a refused receipt yields null, so the match degrades honestly", () => {
    const refused = buildReceiptJournal({ ...BASE, lines: [] });
    expect(receivedCentsForMatch(refused)).toBeNull();

    // With no order either, the match must say it has no evidence rather than
    // quietly passing. Michael refused three-way matching as a GATE; he did not
    // ask for a matcher that lies.
    const verdict = threeWayMatch({
      orderedCents: null,
      receivedCents: receivedCentsForMatch(refused),
      invoicedCents: 15_000,
      toleranceCents: 0,
    });
    expect(verdict.matched).toBe(false);
    expect(verdict.code).toBe("MATCH_NO_EVIDENCE");
  });

  it("a short delivery is visible as a gap rather than absorbed", () => {
    const short = buildReceiptJournal({
      ...BASE,
      lines: [{ categorySlug: "flower", quantityReceived: 8, unitCostCents: 1500 }],
    });
    const verdict = threeWayMatch({
      orderedCents: 15_000,
      receivedCents: receivedCentsForMatch(short),
      invoicedCents: 15_000,
      toleranceCents: 0,
    });
    expect(verdict.matched).toBe(false);
    expect(verdict.worstGapCents).toBe(3_000);
  });

  it("suggests, never gates — the receipt builds regardless of the match", () => {
    // Owner decision, verbatim in invoice-po-match-core.ts: "no three-way
    // matching. Just matching an invoice to the payment is all I need with
    // suggestions possibly." A mismatch must not stop the goods being booked.
    const short = buildReceiptJournal({
      ...BASE,
      lines: [{ categorySlug: "flower", quantityReceived: 8, unitCostCents: 1500 }],
    });
    expect(short.kind).toBe("built");
  });
});
