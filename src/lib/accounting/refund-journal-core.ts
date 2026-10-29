/**
 * src/lib/accounting/refund-journal-core.ts  (Fix Phase 2.8 · G-48 · F-15-14)
 *
 * PURE. No I/O. Registered in scripts/compliance/run-pure-selftests.ts.
 *
 * THE DAY'S CUSTOMER REFUNDS, AS ONE DRAFT JOURNAL ENTRY.
 *
 * Owner basis (docs/sop-program/05-GAP-REGISTER.md, G-48):
 *   books-23  "Anything accounting, bookkeeping, taxes, finance, should be hard
 *             gated to me only."
 *   postings Q1  drafts await the owner's approval.
 * G-48 requirement, verbatim: "a daily draft journal for customer refunds
 * (debit 50910 Returns & Refunds and the tax liabilities as applicable, credit
 * cash) awaiting owner approval".
 *
 * WHAT WAS WRONG (F-15-14)
 * ------------------------
 * The census row revenue_and_tax_collected.refund_or_return had no builder and
 * no poster. Every sale debits 10110 and credits revenue, 32000 and 32100
 * (sale-journal-core.ts). When the cash went back to a customer nothing moved
 * in the books, so revenue and both trust liabilities stayed overstated and
 * 50910 Returns & Refunds (0173, contra-revenue) was never used.
 *
 * THE ENTRY
 * ---------
 *   DR 50910 Returns & Refunds   the pre-tax part of every refund
 *   DR 32000 Excise payable      the 37% excise inside the refund (cannabis)
 *   DR 32100 Sales tax payable   the 9.3% sales tax inside the refund
 *   CR 10110 Tills               refunds paid out of a drawer
 *   CR 10100 Vault               refunds paid out of the store safe
 *
 * The taxes are pulled out of the refund with the SAME extractTaxes the sale
 * entry used, per category, so a full refund reverses exactly what the sale
 * credited to 32000 and 32100 and not a cent more.
 *
 * WHY CREDITING 10110 DOES NOT DOUBLE COUNT
 * -----------------------------------------
 * Every cash sale debits 10110 in full. The till close (buildTillCloseJournal)
 * credits 10110 by what physically left the drawer, and since Fix Phase 2.1
 * the expected close already takes the drawer's refunds off
 * (store.ts reconcileDrawer: cashSalesMinor - refundsPaidMinor). So after the
 * close, 10110 still holds exactly the refunds that went back to customers.
 * This entry is what takes them out. Without it 10110 never comes back to the
 * float.
 *
 * WHY THE WHOLE DAY IS REFUSED FOR ONE UNTIED REFUND
 * --------------------------------------------------
 * The cash came from a drawer (10110) or the safe (10100). Picking one would be
 * a guess (rule 1). Reconcile already refuses until every refund of the day is
 * tied (Fix Phase 2.1), so the fix is the same button the manager already uses.
 * A partial entry is not an option: the source ref is one per day, so a later
 * "rest of the day" entry could never be written.
 *
 * DELIBERATE LIMIT (stated, not hidden)
 * -------------------------------------
 * This books the MONEY. It does not reverse cost of goods sold for the
 * returned unit. A restocked unit goes back on the lot through the CCRS add-back
 * and a destroyed one becomes a destruction; their cost is picked up by the
 * inventory audit adjustment, which already posts (census row
 * cost_of_goods_sold.inventory_audit_adjustment).
 */

import { INVENTORY_CATEGORIES } from "./coa-core";
import { LINE_IN_THE_SAND } from "./ledger-core";
import type { JournalDraft, JournalLineDraft } from "./ledger-core";
import {
  EXCISE_PAYABLE_ACCOUNT,
  SALES_TAX_PAYABLE_ACCOUNT,
  TILL_ACCOUNT,
  extractTaxes,
} from "./sale-journal-core";

/** 50910 Returns & Refunds (0173 L601-602): contra-revenue, cost class none. */
export const RETURNS_ACCOUNT = "50910";
/** 10100 Cash on Hand - Vault (the store safe). */
export const VAULT_ACCOUNT = "10100";

/** One stable reference per business day. */
export const REFUND_DAY_SOURCE_PREFIX = "refunds";
export function refundDaySourceRef(businessDay: string): string {
  return `${REFUND_DAY_SOURCE_PREFIX}:${businessDay}`;
}

export type RefundLineInput = {
  /** A slug from INVENTORY_CATEGORIES (mapped by mapReceiptCategory). */
  readonly categorySlug: string;
  /** Tax-INCLUSIVE cents of this line that went back to the customer. */
  readonly paidCents: number;
};

export type RefundInput = {
  readonly source: "return" | "void";
  /** return: customer_returns.id; void: the order id. */
  readonly sourceId: string;
  /** For the owner: "Counter return", "Void · receipt AB12CD34". */
  readonly label: string;
  /** Cash handed back, tax-inclusive cents. */
  readonly refundCents: number;
  /** Where the cash came from. null = nobody has said yet. */
  readonly paidFrom: "drawer" | "safe" | null;
  /**
   * The lines the refund belongs to. A return has one line (paidCents =
   * refundCents). A void has every line of the order, and they must add up to
   * the refund.
   */
  readonly lines: readonly RefundLineInput[];
};

export type RefundDayInput = {
  /** Pacific business day, YYYY-MM-DD. */
  readonly businessDay: string;
  readonly refunds: readonly RefundInput[];
};

export const REFUND_JOURNAL_REFUSAL_CODES = [
  "REFUND_BAD_DAY",
  "REFUND_BEFORE_LINE_IN_THE_SAND",
  "REFUND_NONE",
  "REFUND_BAD_AMOUNT",
  "REFUND_UNTIED",
  "REFUND_UNKNOWN_CATEGORY",
  "REFUND_NO_LINES",
  "REFUND_LINES_DISAGREE",
] as const;
export type RefundJournalRefusalCode = (typeof REFUND_JOURNAL_REFUSAL_CODES)[number];

export type RefundDayTotals = {
  readonly refundCents: number;
  readonly revenueCents: number;
  readonly exciseCents: number;
  readonly salesTaxCents: number;
  readonly fromDrawerCents: number;
  readonly fromSafeCents: number;
  readonly returnCount: number;
  readonly voidCount: number;
};

export type RefundDayOutcome =
  | {
      readonly kind: "journal";
      readonly journal: JournalDraft;
      readonly totals: RefundDayTotals;
      readonly explanation: string;
    }
  | {
      readonly kind: "refused";
      readonly code: RefundJournalRefusalCode;
      readonly explanation: string;
    };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function refuse(code: RefundJournalRefusalCode, explanation: string): RefundDayOutcome {
  return { kind: "refused", code, explanation };
}

function fmt(cents: number): string {
  const neg = cents < 0;
  const s = (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? "-" : ""}$${s}`;
}

function isWholeNonNegative(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

/** Is this slug cannabis? From the chart's own category list, never guessed. */
export function refundCategoryIsCannabis(slug: string): boolean | null {
  const seed = INVENTORY_CATEGORIES.find((c) => c.slug === slug);
  return seed ? seed.isCannabis : null;
}

/**
 * Split one refund into its pre-tax part and its two taxes. Lines are summed
 * per category first and each category is extracted once, the same grouping
 * buildSaleJournal uses, so a full void reverses the sale's tax lines exactly.
 */
export function splitRefund(lines: readonly RefundLineInput[]): {
  revenueCents: number;
  exciseCents: number;
  salesTaxCents: number;
} {
  const byCategory = new Map<string, number>();
  for (const l of lines) byCategory.set(l.categorySlug, (byCategory.get(l.categorySlug) ?? 0) + l.paidCents);
  let revenueCents = 0;
  let exciseCents = 0;
  let salesTaxCents = 0;
  for (const seed of INVENTORY_CATEGORIES) {
    const paid = byCategory.get(seed.slug);
    if (paid === undefined || paid === 0) continue;
    const t = extractTaxes(paid, seed.isCannabis);
    revenueCents += t.revenueCents;
    exciseCents += t.exciseCents;
    salesTaxCents += t.salesTaxCents;
  }
  return { revenueCents, exciseCents, salesTaxCents };
}

/** Build the day's refund entry, or say exactly why not. */
export function buildRefundDayJournal(input: RefundDayInput): RefundDayOutcome {
  const day = input.businessDay;
  if (!ISO_DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    return refuse("REFUND_BAD_DAY", `"${day}" is not a date (YYYY-MM-DD). Nothing was drafted.`);
  }
  if (day < LINE_IN_THE_SAND) {
    return refuse(
      "REFUND_BEFORE_LINE_IN_THE_SAND",
      `${day} is before the books start (${LINE_IN_THE_SAND}). Refunds before then belong to the old books.`,
    );
  }
  if (input.refunds.length === 0) {
    return refuse("REFUND_NONE", `No returns or voids paid cash back on ${day}, so there is nothing to draft.`);
  }

  let revenue = 0;
  let excise = 0;
  let salesTax = 0;
  let fromDrawer = 0;
  let fromSafe = 0;
  let returnCount = 0;
  let voidCount = 0;

  for (const r of input.refunds) {
    if (!isWholeNonNegative(r.refundCents)) {
      return refuse(
        "REFUND_BAD_AMOUNT",
        `${r.label} (${r.sourceId}) has a refund of ${r.refundCents} cents. A refund must be a whole number of cents and cannot be negative. Nothing was drafted.`,
      );
    }
    if (r.source === "return") returnCount += 1;
    else voidCount += 1;
    if (r.refundCents === 0) continue; // nothing went back (an exchange); nothing to book

    if (r.paidFrom !== "drawer" && r.paidFrom !== "safe") {
      return refuse(
        "REFUND_UNTIED",
        `${r.label} paid ${fmt(r.refundCents)} back on ${day} but nobody has said whether that cash came from a drawer or the store safe. ` +
          `Tie it on the drawer's Reconcile card (Paid from…, then Tie refund), then draft again. Nothing was drafted, because picking one would be a guess.`,
      );
    }
    if (r.lines.length === 0) {
      return refuse("REFUND_NO_LINES", `${r.label} has no sale line to say what was refunded. Nothing was drafted.`);
    }
    let linesTotal = 0;
    for (const l of r.lines) {
      if (refundCategoryIsCannabis(l.categorySlug) === null) {
        return refuse(
          "REFUND_UNKNOWN_CATEGORY",
          `${r.label} has a line in the category "${l.categorySlug}", which the books do not recognise. ` +
            `Add that spelling to the category list first; three categories are outside 280E and a guess changes the tax.`,
        );
      }
      if (!isWholeNonNegative(l.paidCents)) {
        return refuse(
          "REFUND_BAD_AMOUNT",
          `${r.label} has a line of ${l.paidCents} cents. Lines must be whole, non-negative cents. Nothing was drafted.`,
        );
      }
      linesTotal += l.paidCents;
    }
    if (linesTotal !== r.refundCents) {
      return refuse(
        "REFUND_LINES_DISAGREE",
        `${r.label} handed back ${fmt(r.refundCents)} but its lines add up to ${fmt(linesTotal)}. ` +
          `The books will not record a refund they cannot rebuild from the sale. Nothing was drafted.`,
      );
    }

    const s = splitRefund(r.lines);
    revenue += s.revenueCents;
    excise += s.exciseCents;
    salesTax += s.salesTaxCents;
    if (r.paidFrom === "drawer") fromDrawer += r.refundCents;
    else fromSafe += r.refundCents;
  }

  const total = fromDrawer + fromSafe;
  if (total === 0) {
    return refuse("REFUND_NONE", `The returns on ${day} handed back no cash, so there is nothing to draft.`);
  }

  const lines: JournalLineDraft[] = [];
  let n = 1;
  const push = (accountCode: string, amountCents: number, description: string) =>
    lines.push({ lineNo: n++, accountCode, entityCode: "greenway", amountCents, costClass: "none", description });

  push(RETURNS_ACCOUNT, revenue, `Returns & refunds ${day}, net of excise and sales tax`);
  if (excise > 0) push(EXCISE_PAYABLE_ACCOUNT, excise, "37% excise handed back to customers - no longer owed to the State");
  if (salesTax > 0) push(SALES_TAX_PAYABLE_ACCOUNT, salesTax, "9.3% sales tax handed back to customers - no longer owed");
  if (fromDrawer > 0) push(TILL_ACCOUNT, -fromDrawer, "Refund cash paid out of drawers");
  if (fromSafe > 0) push(VAULT_ACCOUNT, -fromSafe, "Refund cash paid out of the store safe");

  const count = returnCount + voidCount;
  const journal: JournalDraft = {
    entityCode: "greenway",
    journalDate: day,
    sourceKind: "pos_sale",
    sourceRef: refundDaySourceRef(day),
    memo: `Customer refunds ${day} (${returnCount} return${returnCount === 1 ? "" : "s"}, ${voidCount} void${voidCount === 1 ? "" : "s"})`,
    assumptionNote:
      "Taxes are extracted from each refund with the same divisors as the sale entry (14630 cannabis, 10930 other), per category. " +
      "Cost of goods for the returned units is not reversed here (inventory audit adjustment).",
    lines,
  };

  return {
    kind: "journal",
    journal,
    totals: {
      refundCents: total,
      revenueCents: revenue,
      exciseCents: excise,
      salesTaxCents: salesTax,
      fromDrawerCents: fromDrawer,
      fromSafeCents: fromSafe,
      returnCount,
      voidCount,
    },
    explanation:
      `${count} refund${count === 1 ? "" : "s"} on ${day} handed back ${fmt(total)}: ` +
      `${fmt(revenue)} of sales reversed into Returns & Refunds, ${fmt(excise)} excise and ${fmt(salesTax)} sales tax no longer owed, ` +
      `${fmt(fromDrawer)} out of drawers and ${fmt(fromSafe)} out of the safe.`,
  };
}

/* ═════════════════════════════ self-tests ═════════════════════════════ */

export function __runRefundJournalCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`refund-journal-core: ${msg}`);
    n += 1;
  };
  const ret = (over: Partial<RefundInput> = {}): RefundInput => ({
    source: "return",
    sourceId: "r1",
    label: "Counter return",
    refundCents: 1463,
    paidFrom: "drawer",
    lines: [{ categorySlug: "flower", paidCents: 1463 }],
    ...over,
  });
  const sum = (j: JournalDraft) => j.lines.reduce((s, l) => s + l.amountCents, 0);

  // $14.63 cannabis: 10.00 revenue, 3.70 excise, 0.93 sales tax.
  const a = buildRefundDayJournal({ businessDay: "2026-10-01", refunds: [ret()] });
  ok(a.kind === "journal", "a plain return drafts");
  if (a.kind === "journal") {
    ok(sum(a.journal) === 0, "balanced");
    ok(a.journal.lines[0].accountCode === "50910" && a.journal.lines[0].amountCents === 1000, "DR 50910 1000");
    ok(a.journal.lines[1].accountCode === "32000" && a.journal.lines[1].amountCents === 370, "DR 32000 370");
    ok(a.journal.lines[2].accountCode === "32100" && a.journal.lines[2].amountCents === 93, "DR 32100 93");
    ok(a.journal.lines[3].accountCode === "10110" && a.journal.lines[3].amountCents === -1463, "CR 10110 1463");
    ok(a.journal.sourceRef === "refunds:2026-10-01", "source ref per day");
    ok(a.journal.sourceKind === "pos_sale", "pos_sale kind");
    ok(a.journal.lines.every((l) => l.costClass === "none"), "cost class none everywhere");
  }

  // Non-cannabis: no excise line.
  const b = buildRefundDayJournal({
    businessDay: "2026-10-01",
    refunds: [ret({ refundCents: 1093, lines: [{ categorySlug: "accessories", paidCents: 1093 }], paidFrom: "safe" })],
  });
  ok(b.kind === "journal" && !b.journal.lines.some((l) => l.accountCode === "32000"), "no excise for accessories");
  ok(b.kind === "journal" && b.journal.lines.some((l) => l.accountCode === "10100" && l.amountCents === -1093), "safe -> CR 10100");

  ok(buildRefundDayJournal({ businessDay: "2026-10-01", refunds: [ret({ paidFrom: null })] }).kind === "refused", "untied refused");
  const untied = buildRefundDayJournal({ businessDay: "2026-10-01", refunds: [ret({ paidFrom: null })] });
  ok(untied.kind === "refused" && untied.code === "REFUND_UNTIED", "untied code");
  const unk = buildRefundDayJournal({ businessDay: "2026-10-01", refunds: [ret({ lines: [{ categorySlug: "mystery", paidCents: 1463 }] })] });
  ok(unk.kind === "refused" && unk.code === "REFUND_UNKNOWN_CATEGORY", "unknown category refused");
  const dis = buildRefundDayJournal({ businessDay: "2026-10-01", refunds: [ret({ refundCents: 1000 })] });
  ok(dis.kind === "refused" && dis.code === "REFUND_LINES_DISAGREE", "lines must add up");
  const none = buildRefundDayJournal({ businessDay: "2026-10-01", refunds: [] });
  ok(none.kind === "refused" && none.code === "REFUND_NONE", "no refunds");
  const zero = buildRefundDayJournal({ businessDay: "2026-10-01", refunds: [ret({ refundCents: 0, paidFrom: null, lines: [] })] });
  ok(zero.kind === "refused" && zero.code === "REFUND_NONE", "only zero refunds -> nothing to draft");
  const early = buildRefundDayJournal({ businessDay: "2025-12-31", refunds: [ret()] });
  ok(early.kind === "refused" && early.code === "REFUND_BEFORE_LINE_IN_THE_SAND", "before the books start");
  const bad = buildRefundDayJournal({ businessDay: "10/01/2026", refunds: [ret()] });
  ok(bad.kind === "refused" && bad.code === "REFUND_BAD_DAY", "bad day");
  const neg = buildRefundDayJournal({ businessDay: "2026-10-01", refunds: [ret({ refundCents: -5 })] });
  ok(neg.kind === "refused" && neg.code === "REFUND_BAD_AMOUNT", "negative refused");
  return { passed: n, failed: 0 };
}
