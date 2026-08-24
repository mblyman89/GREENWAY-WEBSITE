/**
 * tests/compliance/ledger-core.test.ts
 *
 * Vitest mirror for the general-ledger pure core: money parsing that cannot lose
 * a penny to floating point, the normal-balance rule, the line in the sand at
 * 2026-01-01, every posting rule enforced by gl_post_journal(), the trial
 * balance, and ownership allocation across the four shareholders the filed Form
 * 1120-S reports: Michael (85%), his grandfather (5%), his step-father (5%) and
 * his mother (5%). Corrected in books-50 from a three-person roster that had
 * the mother at ten per cent.
 *
 * These rules live in two places on purpose: here, for fast feedback in the UI,
 * and in supabase/migrations/0172_gl_foundation.sql, which is the real authority.
 * The SQL side has its own adversarial suite (scripts/accounting/gl-schema-tests.sql).
 */
import { describe, it, expect } from "vitest";
import {
  formatCents,
  formatMilliPct,
  dollarsToCents,
  normalBalanceOf,
  isDebitNormal,
  isBalanceSheetType,
  toDebitCredit,
  signedToNatural,
  isValidIsoDate,
  isOnOrAfter,
  periodNoOf,
  fiscalYearOf,
  sumLines,
  totalsOf,
  isBalanced,
  validateJournalDraft,
  buildTrialBalance,
  assertOwnershipSums,
  allocateByOwnership,
  __runLedgerCoreTests,
  LINE_IN_THE_SAND,
  OPENING_BALANCE_DATE,
  FULL_OWNERSHIP_MILLI_PCT,
  type LedgerAccount,
  type JournalDraft,
  type ValidationResult,
} from "@/lib/accounting/ledger-core";

// ---------------------------------------------------------------------------
// Shared fixture: a minimal chart of accounts covering every rule under test.
// ---------------------------------------------------------------------------
const accounts = new Map<string, LedgerAccount>([
  ["10100", { code: "10100", name: "Cash on Hand", type: "asset", normalBalance: "debit" }],
  ["12000", { code: "12000", name: "Inventory", type: "asset", normalBalance: "debit",
              isControl: true, controlSubledger: "inventory" }],
  ["30900", { code: "30900", name: "Opening Balance Equity", type: "equity", normalBalance: "credit" }],
  ["40100", { code: "40100", name: "Retail Sales", type: "income", normalBalance: "credit",
              requiresCostClass: true }],
  ["60100", { code: "60100", name: "Rent Expense", type: "expense", normalBalance: "debit",
              requiresCostClass: true }],
  ["61000", { code: "61000", name: "Old Account", type: "expense", normalBalance: "debit",
              requiresCostClass: true, active: false }],
  ["70100", { code: "70100", name: "ATM Fee Income", type: "income", normalBalance: "credit",
              requiresCostClass: true, allowedEntityCodes: ["atm"] }],
]);

const validDraft: JournalDraft = {
  entityCode: "greenway",
  journalDate: "2026-03-15",
  sourceKind: "manual",
  memo: "Record March rent",
  lines: [
    { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
    { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -200000 },
  ],
};

const hasCode = (r: ValidationResult, code: string) => r.issues.some((i) => i.code === code);

// ---------------------------------------------------------------------------

describe("embedded self-tests", () => {
  it("passes the full embedded suite", () => {
    expect(__runLedgerCoreTests()).toMatch(/all \d+ passed/);
  });
});

describe("money formatting and parsing", () => {
  it("formats integer cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-123456)).toBe("-$1,234.56");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(null)).toBe("—");
  });

  it("formats milli-percent, including the three ownership stakes", () => {
    expect(formatMilliPct(85000)).toBe("85%");
    expect(formatMilliPct(10000)).toBe("10%");
    expect(formatMilliPct(5000)).toBe("5%");
    expect(formatMilliPct(2375)).toBe("2.375%");
  });

  it("parses typed dollars into integer cents", () => {
    expect(dollarsToCents("$4,624,697.31")).toBe(462469731);
    expect(dollarsToCents("1234.56")).toBe(123456);
    expect(dollarsToCents(-12.5)).toBe(-1250);
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents(".")).toBeNull();
    expect(dollarsToCents("-")).toBeNull();
  });

  // A real bug caught during development: Math.round(1.005 * 100) is 100, not
  // 101, because 1.005 is stored as 1.00499999999999989. A lost penny is drift.
  it("never loses a penny to floating point", () => {
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents("1.005")).toBe(101);
    expect(dollarsToCents(8.165)).toBe(817);
    expect(dollarsToCents("2.675")).toBe(268);
    expect(dollarsToCents("1.004")).toBe(100);
    expect(dollarsToCents("-1.005")).toBe(-101);
    expect(dollarsToCents("0.001")).toBe(0);
    expect(dollarsToCents("0.009")).toBe(1);
  });

  it("round-trips the real Sage figures exactly", () => {
    expect(dollarsToCents("$741,916.87")).toBe(74191687);
    expect(dollarsToCents("-$1,461,147.84")).toBe(-146114784);
    expect(formatCents(74191687)).toBe("$741,916.87");
    expect(formatCents(-146114784)).toBe("-$1,461,147.84");
  });
});

describe("normal balance", () => {
  it("assigns the textbook normal side", () => {
    expect(normalBalanceOf("asset")).toBe("debit");
    expect(normalBalanceOf("cogs")).toBe("debit");
    expect(normalBalanceOf("expense")).toBe("debit");
    expect(normalBalanceOf("liability")).toBe("credit");
    expect(normalBalanceOf("equity")).toBe("credit");
    expect(normalBalanceOf("income")).toBe("credit");
  });

  it("inverts for contra accounts only", () => {
    expect(normalBalanceOf("asset", true)).toBe("credit");   // accumulated depreciation
    expect(normalBalanceOf("income", true)).toBe("debit");   // sales discounts
    expect(isDebitNormal("asset")).toBe(true);
  });

  it("separates balance-sheet from profit-and-loss types", () => {
    expect(isBalanceSheetType("asset")).toBe(true);
    expect(isBalanceSheetType("liability")).toBe(true);
    expect(isBalanceSheetType("equity")).toBe(true);
    expect(isBalanceSheetType("income")).toBe(false);
    expect(isBalanceSheetType("cogs")).toBe(false);
  });

  it("presents signed amounts on their natural side", () => {
    expect(toDebitCredit(5000)).toEqual({ debitCents: 5000, creditCents: 0 });
    expect(toDebitCredit(-5000)).toEqual({ debitCents: 0, creditCents: 5000 });
    expect(signedToNatural(-5000, "liability")).toBe(5000);
    expect(signedToNatural(5000, "asset")).toBe(5000);
  });
});

describe("business dates", () => {
  it("validates real calendar days", () => {
    expect(isValidIsoDate("2026-01-01")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("01/01/2026")).toBe(false);
  });

  it("derives fiscal period and year", () => {
    expect(periodNoOf("2026-07-15")).toBe(7);
    expect(fiscalYearOf("2026-07-15")).toBe(2026);
    expect(isOnOrAfter("2026-01-01", LINE_IN_THE_SAND)).toBe(true);
    expect(isOnOrAfter("2025-12-31", LINE_IN_THE_SAND)).toBe(false);
  });
});

describe("balance arithmetic", () => {
  it("proves debits equal credits by summing to zero", () => {
    expect(sumLines([{ amountCents: 100 }, { amountCents: -100 }])).toBe(0);
    expect(isBalanced([{ amountCents: 250 }, { amountCents: -150 }, { amountCents: -100 }])).toBe(true);
    expect(isBalanced([{ amountCents: 250 }, { amountCents: -100 }])).toBe(false);
  });

  it("splits totals into debit and credit columns", () => {
    const t = totalsOf([{ amountCents: 250 }, { amountCents: -150 }, { amountCents: -100 }]);
    expect(t).toEqual({ debitCents: 250, creditCents: 250, differenceCents: 0 });
  });
});

describe("journal validation", () => {
  it("accepts a correct entry", () => {
    expect(validateJournalDraft(validDraft, accounts).ok).toBe(true);
  });

  it("rejects an out-of-balance entry and says by how much", () => {
    const r = validateJournalDraft({
      ...validDraft,
      lines: [
        { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
        { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -150000 },
      ],
    }, accounts);
    expect(hasCode(r, "GL_OUT_OF_BALANCE")).toBe(true);
    expect(r.issues.find((i) => i.code === "GL_OUT_OF_BALANCE")?.message).toContain("$500.00");
  });

  it("refuses anything dated before the line in the sand", () => {
    const r = validateJournalDraft({ ...validDraft, journalDate: "2025-12-15" }, accounts);
    expect(hasCode(r, "GL_BEFORE_LINE_IN_THE_SAND")).toBe(true);
  });

  it("allows the opening-balance entry on its one legal date", () => {
    const opening: JournalDraft = {
      entityCode: "greenway",
      journalDate: OPENING_BALANCE_DATE,
      sourceKind: "opening_balance",
      memo: "Opening balances at cut-over",
      lines: [
        { lineNo: 1, accountCode: "10100", entityCode: "greenway", amountCents: 500000 },
        { lineNo: 2, accountCode: "30900", entityCode: "greenway", amountCents: -500000 },
      ],
    };
    expect(validateJournalDraft(opening, accounts).ok).toBe(true);
    expect(hasCode(validateJournalDraft({ ...opening, journalDate: "2025-06-30" }, accounts),
      "GL_OPENING_BALANCE_DATE")).toBe(true);
  });

  // The rule that makes another "LAZY INVENTORY ENTRY" structurally impossible.
  it("blocks a hand-keyed plug into a control account", () => {
    const plug: JournalDraft = {
      entityCode: "greenway",
      journalDate: "2026-03-15",
      sourceKind: "manual",
      memo: "LAZY INVENTORY ENTRY",
      lines: [
        { lineNo: 1, accountCode: "12000", entityCode: "greenway", amountCents: 462469731 },
        { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -462469731 },
      ],
    };
    expect(hasCode(validateJournalDraft(plug, accounts), "GL_CONTROL_ACCOUNT")).toBe(true);
    // ...but the owning subledger may post there.
    expect(hasCode(validateJournalDraft({ ...plug, sourceKind: "inventory", memo: "Receipt of lot 12345" }, accounts),
      "GL_CONTROL_ACCOUNT")).toBe(false);
  });

  it("enforces 280E cost-class tagging", () => {
    const untagged = validateJournalDraft({
      ...validDraft,
      lines: [
        { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000 },
        { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -200000 },
      ],
    }, accounts);
    expect(hasCode(untagged, "GL_COST_CLASS_REQUIRED")).toBe(true);

    const onBalanceSheet = validateJournalDraft({
      ...validDraft,
      lines: [
        { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
        { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -200000, costClass: "cogs_direct" },
      ],
    }, accounts);
    expect(hasCode(onBalanceSheet, "GL_COST_CLASS_NOT_ALLOWED")).toBe(true);
  });

  it("keeps the four sets of books apart", () => {
    const spanning = validateJournalDraft({
      ...validDraft,
      lines: [
        { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
        { lineNo: 2, accountCode: "10100", entityCode: "landholding", amountCents: -200000 },
      ],
    }, accounts);
    expect(hasCode(spanning, "GL_ENTITY_MISMATCH")).toBe(true);

    const wrongEntity = validateJournalDraft({
      entityCode: "greenway",
      journalDate: "2026-03-15",
      sourceKind: "manual",
      memo: "ATM income in the wrong books",
      lines: [
        { lineNo: 1, accountCode: "10100", entityCode: "greenway", amountCents: 5000 },
        { lineNo: 2, accountCode: "70100", entityCode: "greenway", amountCents: -5000, costClass: "separate_business" },
      ],
    }, accounts);
    expect(hasCode(wrongEntity, "GL_ACCOUNT_NOT_ALLOWED_FOR_ENTITY")).toBe(true);
  });

  it("catches the ordinary mistakes", () => {
    expect(hasCode(validateJournalDraft({ ...validDraft, memo: "  " }, accounts), "GL_MEMO_REQUIRED")).toBe(true);
    expect(hasCode(validateJournalDraft({ ...validDraft, journalDate: "nope" }, accounts), "GL_BAD_DATE")).toBe(true);
    expect(hasCode(validateJournalDraft({ ...validDraft, lines: [validDraft.lines[0]] }, accounts),
      "GL_TOO_FEW_LINES")).toBe(true);
    expect(hasCode(validateJournalDraft({ ...validDraft, lines: [
      { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 0, costClass: "nondeductible_280e" },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: 0 },
    ] }, accounts), "GL_ZERO_AMOUNT")).toBe(true);
    expect(hasCode(validateJournalDraft({ ...validDraft, lines: [
      { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 100, costClass: "nondeductible_280e" },
      { lineNo: 1, accountCode: "10100", entityCode: "greenway", amountCents: -100 },
    ] }, accounts), "GL_DUPLICATE_LINE_NO")).toBe(true);
    expect(hasCode(validateJournalDraft({ ...validDraft, lines: [
      { lineNo: 1, accountCode: "61000", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -200000 },
    ] }, accounts), "GL_INACTIVE_ACCOUNT")).toBe(true);
    expect(hasCode(validateJournalDraft({ ...validDraft, lines: [
      { lineNo: 1, accountCode: "99999", entityCode: "greenway", amountCents: 100, costClass: "nondeductible_280e" },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -100 },
    ] }, accounts), "GL_UNKNOWN_ACCOUNT")).toBe(true);
  });
});

describe("trial balance", () => {
  it("foots to zero and nets each account", () => {
    const tb = buildTrialBalance([
      { accountCode: "10100", amountCents: 200000 },
      { accountCode: "40100", amountCents: -200000 },
      { accountCode: "10100", amountCents: -50000 },
      { accountCode: "60100", amountCents: 50000 },
    ], accounts);

    expect(tb.inBalance).toBe(true);
    expect(tb.totalDebitCents).toBe(200000);
    expect(tb.totalCreditCents).toBe(200000);
    expect(tb.rows).toHaveLength(3);

    const cash = tb.rows.find((r) => r.accountCode === "10100");
    expect(cash?.netCents).toBe(150000);
    expect(cash?.debitCents).toBe(150000);
    expect(cash?.creditCents).toBe(0);
  });
});

describe("ownership", () => {
  const holders = [
    { name: "Michael Lyman", ownershipMilliPct: 85000 },
    { name: "Mother", ownershipMilliPct: 10000 },
    { name: "Nicholas Mullan", ownershipMilliPct: 5000 },
  ];

  it("requires the stakes to total exactly 100%", () => {
    expect(assertOwnershipSums(holders).ok).toBe(true);
    expect(assertOwnershipSums([{ name: "A", ownershipMilliPct: 90000 }]).ok).toBe(false);
    expect(holders.reduce((s, h) => s + h.ownershipMilliPct, 0)).toBe(FULL_OWNERSHIP_MILLI_PCT);
  });

  it("splits the 2024 K-1 income to the penny", () => {
    const alloc = allocateByOwnership(63021500, holders); // $630,215.00
    expect(alloc[0].amountCents).toBe(53568275);
    expect(alloc[1].amountCents).toBe(6302150);
    expect(alloc[2].amountCents).toBe(3151075);
    expect(alloc.reduce((s, a) => s + a.amountCents, 0)).toBe(63021500);
  });

  it("never loses or invents a cent, at any amount", () => {
    for (const amount of [1, 2, 3, 7, 99, 100, 101, 100001, 46344000, 65271700, 9007199254740991]) {
      expect(allocateByOwnership(amount, holders).reduce((s, a) => s + a.amountCents, 0)).toBe(amount);
    }
    expect(allocateByOwnership(-100001, holders).reduce((s, a) => s + a.amountCents, 0)).toBe(-100001);
    expect(allocateByOwnership(0, holders).every((a) => a.amountCents === 0)).toBe(true);
  });

  it("gives no owner more than one extra cent", () => {
    for (let amt = 0; amt < 200; amt += 1) {
      const alloc = allocateByOwnership(amt, holders);
      alloc.forEach((a, i) => {
        const floorShare = Math.floor((amt * holders[i].ownershipMilliPct) / 100000);
        expect(a.amountCents - floorShare).toBeGreaterThanOrEqual(0);
        expect(a.amountCents - floorShare).toBeLessThanOrEqual(1);
      });
    }
  });

  it("hands the whole amount to a sole owner", () => {
    expect(allocateByOwnership(12345, [{ name: "Solo", ownershipMilliPct: 100000 }])[0].amountCents).toBe(12345);
  });
});
