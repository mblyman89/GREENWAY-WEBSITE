/**
 * tests/compliance/sale-journal-core.test.ts
 *
 * The retail sale (D-31) and the COGS that must ride with it (D-33).
 *
 * The tests worth having here are the ones that catch a WRONG NUMBER reaching a
 * tax return, not the ones that restate the implementation. Three do real work:
 *
 *   1. the cart's tax constants and the ledger's are proven equal by machine,
 *      so the customer's receipt and the books cannot silently diverge;
 *   2. the journals are run through the REAL ledger validator, so "it balances"
 *      is not a claim this module makes about itself;
 *   3. the account codes are checked against migration 0173 on disk, so a chart
 *      renumbering breaks the build instead of misposting revenue.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CANNABIS_INCLUSIVE_BPS,
  EXCISE_BPS,
  EXCISE_PAYABLE_ACCOUNT,
  NON_CANNABIS_INCLUSIVE_BPS,
  SALES_TAX_BPS,
  SALES_TAX_PAYABLE_ACCOUNT,
  SALE_JOURNAL_REFUSAL_CODES,
  TILL_ACCOUNT,
  buildSaleJournal,
  extractTaxes,
  grossMarginMilliPct,
} from "../../src/lib/accounting/sale-journal-core";
import type {
  SaleJournalInput,
  SaleJournalOutcome,
} from "../../src/lib/accounting/sale-journal-core";
import {
  CANNABIS_EXCISE_TAX_BPS,
  COMBINED_SALES_TAX_BPS,
  LOCAL_CITY_SALES_TAX_BPS,
  STATE_SALES_TAX_BPS,
} from "../../src/lib/orders/order-pricing-core";
import {
  INVENTORY_CATEGORIES,
  categoryCodesAreMirrored,
  cogsAccountCode,
  inventoryAccountCode,
  revenueAccountCode,
} from "../../src/lib/accounting/coa-core";
import { validateJournalDraft } from "../../src/lib/accounting/ledger-core";
import type { JournalDraft, LedgerAccount } from "../../src/lib/accounting/ledger-core";

const BASE: SaleJournalInput = {
  saleDate: "2026-03-14",
  orderRef: "POS-TEST",
  posTotalCents: null,
  lines: [{ categorySlug: "flower", quantity: 1, paidCents: 1000, unitCostCentsTotal: 400 }],
};

const built = (o: SaleJournalOutcome) => {
  if (o.kind !== "built") throw new Error("expected a built journal, got refusal " + o.code);
  return o;
};

const sum = (j: JournalDraft) => j.lines.reduce((a, l) => a + l.amountCents, 0);

describe("sale-journal-core: the cart and the ledger must agree on the statute", () => {
  /*
   * THE POINT OF THIS FILE.
   *
   * sale-journal-core restates the tax rates instead of importing them from the
   * cart, because they are two different readings of the same statute serving
   * two different consumers. Restating them is only safe if a machine proves
   * they are equal. If someone changes the local rate in one place and not the
   * other, the receipt and the general ledger start telling different stories
   * about the same dollar — which is exactly how twelve years of mis-computed
   * excise happened in the old Sage file.
   */
  it("uses the same excise rate the customer was actually charged", () => {
    expect(EXCISE_BPS).toBe(CANNABIS_EXCISE_TAX_BPS);
  });

  it("uses the same combined sales-tax rate, and it is state + local", () => {
    expect(SALES_TAX_BPS).toBe(COMBINED_SALES_TAX_BPS);
    expect(SALES_TAX_BPS).toBe(STATE_SALES_TAX_BPS + LOCAL_CITY_SALES_TAX_BPS);
    expect(SALES_TAX_BPS).toBe(930);
  });

  it("derives the divisors the cart uses: 1.463 and 1.093", () => {
    expect(CANNABIS_INCLUSIVE_BPS).toBe(14630);
    expect(NON_CANNABIS_INCLUSIVE_BPS).toBe(10930);
  });
});

describe("sale-journal-core: the tax is EXTRACTED, never added", () => {
  it("splits a $10.00 bag of flower into 683 / 253 / 64", () => {
    const r = built(buildSaleJournal(BASE));
    expect(r.totalRevenueCents).toBe(683);
    expect(r.totalExciseCents).toBe(253);
    expect(r.totalSalesTaxCents).toBe(64);
  });

  it("never invents money: the three parts always reconstitute the price", () => {
    // The failure this guards against is ADDING 37% to a shelf price that
    // already contains it, which would invent $3.70 of excise per $10 sold.
    for (const paid of [1, 2, 3, 17, 99, 100, 1234, 5000, 123_456]) {
      for (const cannabis of [true, false]) {
        const t = extractTaxes(paid, cannabis);
        expect(t.revenueCents + t.exciseCents + t.salesTaxCents).toBe(paid);
        expect(t.revenueCents).toBeGreaterThan(0);
        expect(t.exciseCents).toBeGreaterThanOrEqual(0);
        expect(t.salesTaxCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("charges no excise on accessories, paraphernalia or merch", () => {
    for (const c of INVENTORY_CATEGORIES.filter((x) => !x.isCannabis)) {
      const r = built(
        buildSaleJournal({
          ...BASE,
          lines: [{ categorySlug: c.slug, quantity: 1, paidCents: 1000, unitCostCentsTotal: 300 }],
        }),
      );
      expect(r.totalExciseCents).toBe(0);
      // Not merely zero — the trust account must not appear on the entry at all,
      // because a zero-amount line is illegal in migration 0172.
      expect(r.revenueJournal.lines.some((l) => l.accountCode === EXCISE_PAYABLE_ACCOUNT)).toBe(
        false,
      );
      expect(r.totalSalesTaxCents).toBe(85);
    }
  });

  it("still charges sales tax on cannabis, on a base that excludes the excise", () => {
    // If the 9.3% were computed on the excise-inclusive amount it would be
    // round(1000 x 930 / 10000 x 1.37) territory — a bigger number. The chart's
    // own note on 32100 says the excise is excluded, so 64 is the right answer
    // and 87 would be the wrong one.
    expect(extractTaxes(1000, true).salesTaxCents).toBe(64);
  });
});

describe("sale-journal-core: entries a real ledger would accept", () => {
  // Accounts built to match migration 0173's shape, so validateJournalDraft is
  // doing the same job it does in production rather than a friendly imitation.
  const accounts = new Map<string, LedgerAccount>();
  accounts.set(TILL_ACCOUNT, {
    code: TILL_ACCOUNT,
    name: "Cash on Hand — Tills",
    type: "asset",
    normalBalance: "debit",
    allowedEntityCodes: ["greenway"],
    active: true,
  });
  for (const code of [EXCISE_PAYABLE_ACCOUNT, SALES_TAX_PAYABLE_ACCOUNT]) {
    accounts.set(code, {
      code,
      name: "Trust tax payable",
      type: "liability",
      normalBalance: "credit",
      isControl: true,
      allowedEntityCodes: ["greenway"],
      active: true,
    });
  }
  for (const c of INVENTORY_CATEGORIES) {
    accounts.set(inventoryAccountCode(c.slot), {
      code: inventoryAccountCode(c.slot),
      name: `Inventory — ${c.label}`,
      type: "asset",
      normalBalance: "debit",
      allowedEntityCodes: ["greenway"],
      active: true,
    });
    accounts.set(revenueAccountCode(c.slot), {
      code: revenueAccountCode(c.slot),
      name: `Sales — ${c.label}`,
      type: "income",
      normalBalance: "credit",
      allowedEntityCodes: ["greenway"],
      active: true,
    });
    accounts.set(cogsAccountCode(c.slot), {
      code: cogsAccountCode(c.slot),
      name: `COGS — ${c.label}`,
      type: "cogs",
      normalBalance: "debit",
      requiresCostClass: true,
      allowedEntityCodes: ["greenway"],
      active: true,
    });
  }

  const mixed = built(
    buildSaleJournal({
      saleDate: "2026-03-14",
      orderRef: "POS-MIX",
      posTotalCents: 9500,
      lines: [
        { categorySlug: "flower", quantity: 2, paidCents: 4500, unitCostCentsTotal: 1800 },
        { categorySlug: "cartridge", quantity: 1, paidCents: 3000, unitCostCentsTotal: 1200 },
        { categorySlug: "merch", quantity: 1, paidCents: 2000, unitCostCentsTotal: 900 },
      ],
    }),
  );

  it("passes the real ledger validator, both halves", () => {
    for (const j of [mixed.revenueJournal, mixed.cogsJournal]) {
      const v = validateJournalDraft(j, accounts);
      expect(v.issues.map((i) => `${i.code}: ${i.message}`)).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });

  it("balances to the cent", () => {
    expect(sum(mixed.revenueJournal)).toBe(0);
    expect(sum(mixed.cogsJournal)).toBe(0);
  });

  it("debits the till for exactly what the customer paid", () => {
    const till = mixed.revenueJournal.lines.find((l) => l.accountCode === TILL_ACCOUNT);
    expect(till?.amountCents).toBe(9500);
    expect(mixed.totalPaidCents).toBe(9500);
  });

  it("keeps trust money out of every revenue account", () => {
    // The strongest available form of this: total 5xxxx credits must equal
    // net revenue exactly, so not one cent of the State's money can be sitting
    // in an income account.
    const revenueCredits = mixed.revenueJournal.lines
      .filter((l) => l.accountCode.startsWith("5"))
      .reduce((a, l) => a - l.amountCents, 0);
    expect(revenueCredits).toBe(mixed.totalRevenueCents);
    expect(revenueCredits + mixed.totalExciseCents + mixed.totalSalesTaxCents).toBe(9500);
  });

  it("relieves inventory for every category it sold, and only those", () => {
    const cogsAccounts = mixed.cogsJournal.lines
      .filter((l) => l.amountCents > 0)
      .map((l) => l.accountCode)
      .sort();
    expect(cogsAccounts).toEqual(["60010", "60120", "60220"]);
    const invAccounts = mixed.cogsJournal.lines
      .filter((l) => l.amountCents < 0)
      .map((l) => l.accountCode)
      .sort();
    expect(invAccounts).toEqual(["20010", "20120", "20220"]);
  });

  it("gives the two entries different source refs so they cannot collide", () => {
    expect(mixed.revenueJournal.sourceRef).toBe("POS-MIX");
    expect(mixed.cogsJournal.sourceRef).toBe("POS-MIX#cogs");
    expect(mixed.revenueJournal.sourceKind).toBe("pos_sale");
    expect(mixed.cogsJournal.sourceKind).toBe("pos_sale");
  });
});

describe("sale-journal-core: the account codes match the chart on disk", () => {
  /*
   * Reads migration 0173 rather than trusting coa-core's arithmetic. If the
   * chart is ever renumbered, this fails loudly instead of quietly posting
   * flower revenue to whatever now lives at 50010.
   */
  const sql = readFileSync("supabase/migrations/0173_chart_of_accounts.sql", "utf8");

  it("posts flower to 20010 / 50010 / 60010, as seeded", () => {
    expect(sql).toContain("gl_upsert_account('20010','Inventory — Flower','asset'");
    expect(sql).toContain("gl_upsert_account('50010','Sales — Flower','income'");
    expect(sql).toContain("gl_upsert_account('60010','COGS — Flower','cogs'");
    const r = built(buildSaleJournal(BASE));
    expect(r.splits[0].inventoryAccount).toBe("20010");
    expect(r.splits[0].revenueAccount).toBe("50010");
    expect(r.splits[0].cogsAccount).toBe("60010");
  });

  it("routes every one of the 21 categories to mirrored, seeded accounts", () => {
    for (const c of INVENTORY_CATEGORIES) {
      const inv = inventoryAccountCode(c.slot);
      const rev = revenueAccountCode(c.slot);
      const cogs = cogsAccountCode(c.slot);
      expect(categoryCodesAreMirrored(inv, rev, cogs)).toBe(true);
      for (const code of [inv, rev, cogs]) {
        expect(sql.includes(`gl_upsert_account('${code}',`)).toBe(true);
      }
      const r = built(
        buildSaleJournal({
          ...BASE,
          lines: [{ categorySlug: c.slug, quantity: 1, paidCents: 2500, unitCostCentsTotal: 900 }],
        }),
      );
      expect(r.splits[0].revenueAccount).toBe(rev);
      expect(r.splits[0].cogsAccount).toBe(cogs);
      expect(r.splits[0].inventoryAccount).toBe(inv);
    }
  });

  it("uses the till and the two trust accounts named in the chart", () => {
    expect(TILL_ACCOUNT).toBe("10110");
    expect(sql).toContain("gl_upsert_account('10110','Cash on Hand — Tills','asset'");
    expect(EXCISE_PAYABLE_ACCOUNT).toBe("32000");
    expect(SALES_TAX_PAYABLE_ACCOUNT).toBe("32100");
  });
});

describe("sale-journal-core: it refuses rather than guessing", () => {
  it("refuses a sale whose cost is unknown, because 280E makes COGS the deduction", () => {
    const o = buildSaleJournal({
      ...BASE,
      lines: [{ categorySlug: "flower", quantity: 1, paidCents: 1000, unitCostCentsTotal: null }],
    });
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") {
      expect(o.code).toBe("UNIT_COST_UNKNOWN");
      // A zero here would be the expensive bug: full revenue, no deduction.
      expect(o.resolution).toContain("280E");
    }
  });

  it("refuses a category the chart has never heard of", () => {
    const o = buildSaleJournal({
      ...BASE,
      lines: [{ categorySlug: "moon-rocks", quantity: 1, paidCents: 100, unitCostCentsTotal: 10 }],
    });
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") expect(o.code).toBe("UNKNOWN_CATEGORY");
  });

  it("refuses when the lines do not add up to what the POS says", () => {
    const o = buildSaleJournal({ ...BASE, posTotalCents: 1001 });
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") expect(o.code).toBe("POS_TOTAL_DISAGREES");
    // ...and accepts when they do agree, or the check would be unfalsifiable.
    expect(buildSaleJournal({ ...BASE, posTotalCents: 1000 }).kind).toBe("built");
  });

  it("refuses a date before the line in the sand", () => {
    const o = buildSaleJournal({ ...BASE, saleDate: "2025-12-31" });
    expect(o.kind).toBe("refused");
    if (o.kind === "refused") expect(o.code).toBe("DATE_BEFORE_CUTOVER");
    expect(buildSaleJournal({ ...BASE, saleDate: "2026-01-01" }).kind).toBe("built");
  });

  it("emits every refusal code it declares (rule 43)", () => {
    const seen = new Set<string>();
    const cases: SaleJournalInput[] = [
      { ...BASE, lines: [] },
      { ...BASE, saleDate: "2025-06-01" },
      { ...BASE, lines: [{ categorySlug: "nope", quantity: 1, paidCents: 1, unitCostCentsTotal: 1 }] },
      { ...BASE, lines: [{ categorySlug: "flower", quantity: -1, paidCents: 1, unitCostCentsTotal: 1 }] },
      { ...BASE, lines: [{ categorySlug: "flower", quantity: 1, paidCents: 0, unitCostCentsTotal: 1 }] },
      { ...BASE, lines: [{ categorySlug: "flower", quantity: 1, paidCents: 1.5, unitCostCentsTotal: 1 }] },
      { ...BASE, lines: [{ categorySlug: "flower", quantity: 1, paidCents: 1, unitCostCentsTotal: null }] },
      { ...BASE, lines: [{ categorySlug: "flower", quantity: 1, paidCents: 1, unitCostCentsTotal: -1 }] },
      { ...BASE, posTotalCents: 7 },
    ];
    for (const c of cases) {
      const o = buildSaleJournal(c);
      if (o.kind === "refused") seen.add(o.code);
    }
    expect([...seen].sort()).toEqual([...SALE_JOURNAL_REFUSAL_CODES].sort());
  });
});

describe("sale-journal-core: rounding is stated, not hidden", () => {
  it("rounds once per category, so splitting a basket cannot change the tax", () => {
    const one = built(
      buildSaleJournal({
        ...BASE,
        lines: [{ categorySlug: "flower", quantity: 3, paidCents: 3000, unitCostCentsTotal: 900 }],
      }),
    );
    const three = built(
      buildSaleJournal({
        ...BASE,
        lines: [
          { categorySlug: "flower", quantity: 1, paidCents: 1000, unitCostCentsTotal: 300 },
          { categorySlug: "flower", quantity: 1, paidCents: 1000, unitCostCentsTotal: 300 },
          { categorySlug: "flower", quantity: 1, paidCents: 1000, unitCostCentsTotal: 300 },
        ],
      }),
    );
    expect(three.totalExciseCents).toBe(one.totalExciseCents);
    expect(three.totalSalesTaxCents).toBe(one.totalSalesTaxCents);
    expect(three.totalRevenueCents).toBe(one.totalRevenueCents);
    expect(three.splits).toHaveLength(1);
  });

  it("never lets the residual land on a trust liability", () => {
    // Sweeping awkward amounts: excise and sales tax must always equal their own
    // statutory computation exactly, so the State's number is never a plug.
    for (let paid = 1; paid <= 400; paid++) {
      const r = built(
        buildSaleJournal({
          ...BASE,
          lines: [{ categorySlug: "flower", quantity: 1, paidCents: paid, unitCostCentsTotal: 1 }],
        }),
      );
      expect(r.totalExciseCents).toBe(Math.floor((paid * EXCISE_BPS * 2 + 14630) / 29260));
      expect(r.totalSalesTaxCents).toBe(Math.floor((paid * SALES_TAX_BPS * 2 + 14630) / 29260));
      expect(sum(r.revenueJournal)).toBe(0);
    }
  });

  it("reports the residual instead of swallowing it", () => {
    const r = built(buildSaleJournal(BASE));
    expect(typeof r.roundingResidualCents).toBe("number");
    // 683 vs round(1000 x 10000 / 14630) = round(683.53) = 684, so -1.
    expect(r.roundingResidualCents).toBe(-1);
  });
});

describe("sale-journal-core: margin is read off net revenue", () => {
  it("computes margin after the excise is out, not on the shelf price", () => {
    const r = built(buildSaleJournal(BASE));
    // (683 - 400) / 683 = 41.435%. On the tax-inclusive $10.00 it would look
    // like 60%, which would be a lie told to the owner about his own product.
    expect(grossMarginMilliPct(r)).toBe(41435);
  });

  it("returns null rather than dividing by zero", () => {
    const r = built(buildSaleJournal(BASE));
    expect(grossMarginMilliPct({ ...r, totalRevenueCents: 0 })).toBeNull();
  });
});
