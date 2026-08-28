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
  IN_TRANSIT_ACCOUNT_CODE,
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

  const RECEIPT_FOR_SAME_GOODS = {
    receivedDate: "2026-03-14",
    receiptRef: "M-2026-03-14-001",
    vendorName: "Northwest Cannabis Solutions",
    lines: [{ categorySlug: "flower", quantityReceived: 10, unitCostCents: 1500 }],
  } as const;

  /**
   * D-61, books-79: the collision is now FIXABLE but is NOT fixed by default.
   *
   * `goodsAlreadyReceived` defaults to false, which reproduces the original
   * behaviour exactly. That default is deliberate — it is the safe direction if
   * a caller forgets, because stranding nothing is better than stranding cost
   * in a clearing account forever. But it means the double count is still
   * REACHABLE by omission, and pretending otherwise would be the softening this
   * file exists to prevent.
   *
   * So this test asserts the DANGER still exists on the default path, and the
   * test below it asserts the CURE works on the explicit path. Both must hold.
   */
  it("still double counts when the caller does not say the goods arrived", () => {
    const verdict = evaluateVendorBill(bill, { vendorIsLicensedCannabis: true });
    const billJournal = buildBillJournal(bill, verdict);
    const receipt = buildReceiptJournal(RECEIPT_FOR_SAME_GOODS);
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
      "D-61's default path changed — re-read docs/DEFECTS.md D-61 before editing",
    ).toBe(true);
    expect(receipt.totalCostCents).toBe(CENTS);
  });

  /**
   * THE CURE, proven by adding the two journals together rather than by reading
   * either one. This is the assertion that actually protects Michael: whatever
   * the accounts are called, the same goods must be capitalised exactly ONCE
   * and the clearing account must end at zero.
   */
  it("nets 20800 to ZERO and capitalises the goods exactly once when received", () => {
    const received: VendorBillInput = { ...bill, goodsAlreadyReceived: true };
    const verdict = evaluateVendorBill(received, { vendorIsLicensedCannabis: true });
    const billJournal = buildBillJournal(received, verdict);
    const receipt = buildReceiptJournal(RECEIPT_FOR_SAME_GOODS);
    expect(billJournal).not.toBeNull();
    expect(receipt.kind).toBe("built");
    if (billJournal === null || receipt.kind !== "built") return;

    const net = new Map<string, number>();
    for (const l of [...receipt.journal.lines, ...billJournal.lines]) {
      net.set(l.accountCode, (net.get(l.accountCode) ?? 0) + l.amountCents);
    }

    // Inventory ONCE, not twice. This is the whole point.
    expect(net.get("20010")).toBe(CENTS);
    // The clearing account nets to nothing when both halves happened.
    expect(net.get(IN_TRANSIT_ACCOUNT)).toBe(0);
    // And the vendor is owed exactly once.
    expect(net.get("30000")).toBe(-CENTS);
    // Both entries balance on their own, so either can post alone.
    expect(sum(receipt.journal.lines)).toBe(0);
    expect(sum(billJournal.lines)).toBe(0);
  });

  it("leaves a VISIBLE 20800 balance when goods arrive and no bill follows", () => {
    // A credit balance in 20800 is "received not invoiced" — the vendor has not
    // billed you yet. It is a to-do list, not an error, and it must not vanish.
    const receipt = buildReceiptJournal(RECEIPT_FOR_SAME_GOODS);
    if (receipt.kind !== "built") throw new Error("must build");
    const inTransit = receipt.journal.lines.filter((l) => l.accountCode === IN_TRANSIT_ACCOUNT);
    expect(inTransit.length).toBe(1);
    expect(inTransit[0].amountCents).toBe(-CENTS);
  });

  it("only cannabis product relieves 20800 — freight and discounts do not", () => {
    // freight_in and product_packaging debit 60800, purchase_discount 60900.
    // The receipt never books those, so redirecting them to 20800 would credit
    // a clearing account nothing ever debited and leave a phantom balance.
    const mixed: VendorBillInput = {
      ...bill,
      invoiceNumber: "INV-MIX",
      statedTotalCents: 10_000 + 500 - 250,
      goodsAlreadyReceived: true,
      lines: [
        {
          lineNo: 1,
          purchaseKindCode: "cannabis_product",
          amountCents: 10_000,
          description: "flower",
          categorySlug: "flower",
        },
        { lineNo: 2, purchaseKindCode: "freight_in", amountCents: 500, description: "delivery" },
        {
          lineNo: 3,
          purchaseKindCode: "purchase_discount",
          amountCents: -250,
          description: "volume discount",
        },
      ],
    };
    const verdict = evaluateVendorBill(mixed, { vendorIsLicensedCannabis: true });
    const j = buildBillJournal(mixed, verdict);
    expect(j).not.toBeNull();
    if (j === null) return;
    const byAccount = new Map(j.lines.map((l) => [l.accountCode, l.amountCents]));
    expect(byAccount.get(IN_TRANSIT_ACCOUNT)).toBe(10_000); // product only
    expect(byAccount.get("60800")).toBe(500); // freight stays put
    expect(byAccount.get("60900")).toBe(-250); // discount stays put
    expect(byAccount.get("20010")).toBeUndefined(); // not debited twice
    expect(sum(j.lines)).toBe(0);
  });

  it("does not disturb a bill with no goods on it at all", () => {
    // Rent with the flag set true must be byte-identical to rent without it.
    // A change that leaks into unrelated bills is a change nobody can review.
    const rent: VendorBillInput = {
      entityCode: "greenway",
      vendorName: "Landlord",
      invoiceNumber: "R-1",
      invoiceDate: "2026-03-14",
      statedTotalCents: 500_000,
      lines: [
        { lineNo: 1, purchaseKindCode: "rent", amountCents: 500_000, description: "March rent" },
      ],
    };
    const a = buildBillJournal(rent, evaluateVendorBill(rent, {}));
    const b = buildBillJournal(
      { ...rent, goodsAlreadyReceived: true },
      evaluateVendorBill({ ...rent, goodsAlreadyReceived: true }, {}),
    );
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("the two modules agree on the clearing account, so they cannot drift", () => {
    expect(IN_TRANSIT_ACCOUNT_CODE).toBe(IN_TRANSIT_ACCOUNT);
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

  /**
   * books-83 INVERTED THIS TEST, deliberately and with a reason.
   *
   * It used to assert "the danger is latent, not live: neither builder is
   * reachable", by checking the census still said `gl_post_vendor_bill has no
   * caller outside its migration.` That was honest while both builders sat
   * unwired — a trap that cannot spring still had to be recorded (rule 43's
   * cousin). It was written to fail on the FIX as well as on the DANGER,
   * precisely so that whoever wired the bill had to come here and think.
   *
   * Both halves are now wired: books-81 wired the receipt, books-83 wired the
   * bill. So the old assertion is no longer true, and leaving it would mean
   * either deleting the wire or lying in the census. The replacement asserts
   * the thing that now matters MORE: the live path derives the flag from the
   * ledger rather than defaulting it, which is what keeps the trap shut.
   */
  it("both halves are wired, and the live path DERIVES the flag rather than defaulting it", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/accounting/vendor-bill-service.ts"),
      "utf8",
    );
    // The flag comes from ledger evidence...
    expect(service.search(/await\s+findReceiptJournal\s*\(/)).toBeGreaterThan(-1);
    expect(service).toMatch(/goodsAlreadyReceived\s*=\s*evidence\.kind\s*===\s*"raised"/);
    // ...and an unreadable ledger refuses instead of assuming "not received".
    expect(service).toMatch(/evidence\.kind\s*===\s*"unknown"/);
    expect(service).toContain("BILL_RECEIPT_EVIDENCE_UNKNOWN");
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
