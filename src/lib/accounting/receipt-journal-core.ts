/**
 * src/lib/accounting/receipt-journal-core.ts — goods arrive, and cost is born.
 *
 * PURE. No I/O, no React, no server-only. Mirrored in vitest and registered in
 * scripts/compliance/run-pure-selftests.ts.
 *
 * WHY THIS EXISTS
 * ---------------
 * books-77 shipped `buildSaleJournal`, and it refuses with `UNIT_COST_UNKNOWN`
 * when a lot has no cost. That refusal is correct and it is also a dead end
 * until something in this system establishes what a lot cost in the first place.
 * Measured before writing a line of this file:
 *
 *   * `inventory_lots.unit_cost_minor_units` (migration 0023, line 105) is
 *     NULLABLE. The database has always allowed a lot with no cost.
 *   * 45 modules live under `src/lib/purchasing/`. grep for `submitJournal`,
 *     `gl_post` or `JournalDraft` across all of them returns ZERO hits.
 *   * `po-store.ts#receivePoLine` increments `received_qty` and moves the PO to
 *     partial/received. It records no cost and touches no ledger.
 *   * `vendor-bill-core.ts#threeWayMatch` already accepts a `receivedCents`
 *     argument, and NOTHING IN THE REPOSITORY PRODUCES THAT NUMBER.
 *   * Census D-35 states the gap in its own words: "nothing connects an approved
 *     PO to the receipt that SHOULD post."
 *
 * The receipt is the event where cost is born. Everything downstream — COGS,
 * 280E, gross margin, the whole income statement — inherits the number decided
 * here. That is why this module refuses rather than estimates.
 *
 * WHY THE CREDIT IS 20800 AND NOT ACCOUNTS PAYABLE
 * -----------------------------------------------
 * This is the one decision in this file that could go wrong quietly, so it is
 * made from the chart rather than from habit — and the FIRST draft of this
 * comment got it wrong, which is why the correction is left visible.
 *
 * MEASURED, not assumed. `buildBillJournal` was actually executed against a
 * one-line cannabis-product bill and its output read:
 *
 *   accountCode "20010"  amountCents  15000   <- category inventory, DEBIT
 *   accountCode "30000"  amountCents -15000   <- accounts payable,   CREDIT
 *
 * So the bill debits the CATEGORY INVENTORY account. It does not touch 20800:
 * `grep -c 20800 vendor-bill-core.ts` returns 1, and that single hit is a
 * seeded-account list inside a self-test, not a posting path.
 *
 * That matters enormously, because it means the receipt and the bill BOTH want
 * to debit inventory for the same goods. If both ever post, inventory is
 * doubled and 280E COGS is overstated — the one error in this system that
 * increases a deduction, which is the direction an examiner looks hardest.
 * See docs/DEFECTS.md D-61.
 *
 * This module therefore takes the half of the pair that is unambiguously right
 * and leaves the other half visibly unfinished rather than quietly guessing at
 * it. Migration 0173 seeds the account for exactly this purpose, verbatim:
 *
 *   '20800','Inventory — In Transit','asset'
 *   'Received not invoiced, or invoiced not received. Visible instead of absorbed.'
 *
 * Note the account's description names BOTH directions, which is why an asset
 * account is the right home for a goods-received-not-invoiced balance here: it
 * swings. The INTENDED end state is
 *
 *   GOODS ARRIVE     debit 2xxxx category inventory   credit 20800  (this module)
 *   INVOICE ARRIVES  debit 20800                      credit 30000  (NOT YET TRUE)
 *
 * so that 20800 nets to zero for anything both received and invoiced, and a
 * residual balance is the list of shipments missing one half — credit balance
 * means received and never billed, debit balance means billed and never
 * received. The second line of that pair IS NOT IMPLEMENTED. Changing a shipped,
 * heavily tested bill classifier is its own slice with its own risk, and doing
 * it as an unannounced side effect of writing a receipt would be exactly the
 * kind of silent change these rules exist to prevent.
 *
 * Nothing is double counted TODAY because neither builder is wired to a poster:
 * the census records `reachable: MISSING` for both. This is a LATENT trap, and
 * it is gated by a test that fails the moment either one becomes reachable
 * without the other being reconciled.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * -----------------------------------------
 * It does not gate anything on a three-way match. Michael's decision is recorded
 * verbatim in `src/lib/payments/invoice-po-match-core.ts`:
 *
 *   "no three-way matching. Just matching an invoice to the payment is all I
 *    need with suggestions possibly."
 *
 * Receiving goods is a bookkeeping event, not an approval workflow, and this
 * module treats it as one. What it DOES do is finally produce the
 * `receivedCents` figure that the already-written `threeWayMatch` has been
 * waiting for, so the SUGGESTION layer Michael did ask for has a real number
 * instead of a null. `receivedCentsForMatch` is that bridge, and it is the whole
 * of this module's contribution to matching.
 *
 * IT DOES NOT TOUCH FREIGHT EITHER. `vendor-bill-core` already classifies
 * inbound freight to 60800 with `cogs_direct`, citing Reg. §1.471-3(b). Freight
 * is known when the INVOICE arrives, not when the truck does. Allocating an
 * unknown freight charge across lines at receipt time would be inventing a
 * number, so this module books the goods at the cost actually agreed and leaves
 * freight to the path that already handles it.
 */

import {
  INVENTORY_CATEGORIES,
  inventoryAccountCode,
} from "./coa-core";
import { LINE_IN_THE_SAND } from "./ledger-core";
import type { JournalDraft, JournalLineDraft } from "./ledger-core";

/* ══════════════════════════════════════════════════════════════════════════
 * 1) ACCOUNTS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Inventory — In Transit. The clearing account between the truck and the
 * invoice. Seeded in 0173 under parent 20000, entity greenway, not a control
 * account, so a `purchase` journal may post to it directly.
 */
export const IN_TRANSIT_ACCOUNT = "20800";

/**
 * Inventory — UNCLASSIFIED (quarantine). 0173: "Intake that cannot be mapped to
 * a category lands here VISIBLY and nags until resolved... A non-zero balance is
 * a to-do list."
 *
 * This is the ONE place this module is allowed to proceed without knowing the
 * category, and it is not a guess — it is a named, watched account whose whole
 * purpose is to make the unknown loud. Refusing the entire delivery because one
 * line has an unrecognised category would leave the goods off the books
 * entirely, which is strictly worse: the product is physically on the shelf
 * either way.
 */
export const QUARANTINE_ACCOUNT = "20890";

/* ══════════════════════════════════════════════════════════════════════════
 * 2) INPUT
 * ══════════════════════════════════════════════════════════════════════════ */

export type ReceiptLineInput = {
  /**
   * A slug from INVENTORY_CATEGORIES, or null when intake could not be mapped.
   * Null routes to quarantine 20890; an unrecognised STRING is a refusal,
   * because a typo is a different problem from an honest unknown.
   */
  readonly categorySlug: string | null;
  /** Units physically counted in. Must be a positive integer. */
  readonly quantityReceived: number;
  /**
   * Agreed cost per unit in whole cents, from the PO line or the manifest.
   * `null` is a REFUSAL, never a zero — see UNIT_COST_UNKNOWN below.
   */
  readonly unitCostCents: number | null;
  /** Lot code from the manifest, for the description. Optional. */
  readonly lotCode?: string | null;
};

export type ReceiptInput = {
  /** ISO YYYY-MM-DD, Pacific business date the goods physically arrived. */
  readonly receivedDate: string;
  /** PO number or manifest number. Becomes the sourceRef. */
  readonly receiptRef: string;
  readonly vendorName: string;
  readonly lines: readonly ReceiptLineInput[];
};

/* ══════════════════════════════════════════════════════════════════════════
 * 3) REFUSALS
 * ══════════════════════════════════════════════════════════════════════════ */

export const RECEIPT_REFUSAL_CODES = [
  "NO_LINES",
  "UNKNOWN_CATEGORY",
  "NON_POSITIVE_QUANTITY",
  "UNIT_COST_UNKNOWN",
  "NEGATIVE_UNIT_COST",
  "FRACTIONAL_CENTS",
  "DATE_BEFORE_CUTOVER",
  "NOTHING_TO_CAPITALISE",
] as const;

export type ReceiptRefusalCode = (typeof RECEIPT_REFUSAL_CODES)[number];

export type ReceiptRefusal = {
  readonly kind: "refused";
  readonly code: ReceiptRefusalCode;
  readonly explanation: string;
  readonly resolution: string;
};

/* ══════════════════════════════════════════════════════════════════════════
 * 4) OUTPUT
 * ══════════════════════════════════════════════════════════════════════════ */

export type ReceiptSplit = {
  readonly categorySlug: string | null;
  readonly inventoryAccount: string;
  readonly quantityReceived: number;
  readonly extendedCostCents: number;
  /** True when this line landed in quarantine rather than a real category. */
  readonly quarantined: boolean;
};

export type ReceiptResult = {
  readonly kind: "built";
  /** Debit category inventory (or quarantine), credit 20800. */
  readonly journal: JournalDraft;
  readonly splits: readonly ReceiptSplit[];
  readonly totalCostCents: number;
  /** Cost sitting in quarantine, which is a to-do list, not a balance. */
  readonly quarantinedCostCents: number;
  /**
   * Per-unit costs keyed by lot code, so the caller can write them onto
   * `inventory_lots.unit_cost_minor_units` — the nullable column that makes
   * books-77's UNIT_COST_UNKNOWN refusal fire.
   */
  readonly lotCosts: readonly { readonly lotCode: string; readonly unitCostCents: number }[];
};

export type ReceiptOutcome = ReceiptResult | ReceiptRefusal;

/* ══════════════════════════════════════════════════════════════════════════
 * 5) THE BUILDER
 * ══════════════════════════════════════════════════════════════════════════ */

const refuse = (
  code: ReceiptRefusalCode,
  explanation: string,
  resolution: string,
): ReceiptRefusal => ({ kind: "refused", code, explanation, resolution });

/**
 * Turn a physical delivery into the journal entry that capitalises it.
 *
 * Returns a refusal rather than throwing, and rather than inventing a cost.
 * Standing rule 1: never guess.
 */
export function buildReceiptJournal(input: ReceiptInput): ReceiptOutcome {
  if (input.lines.length === 0) {
    return refuse(
      "NO_LINES",
      "This receipt has no lines, so no goods arrived and there is nothing to record.",
      "Check that the delivery was actually counted in before sending it to the ledger.",
    );
  }

  if (input.receivedDate < LINE_IN_THE_SAND) {
    return refuse(
      "DATE_BEFORE_CUTOVER",
      `This delivery is dated ${input.receivedDate}, which is before the new books open ` +
        `on ${LINE_IN_THE_SAND}.`,
      "Product that arrived before cut-over is carried by the opening inventory load, not " +
        "by a receipt entry. Booking it again here would double the inventory.",
    );
  }

  // Aggregate by destination account. Two lines of the same category collapse
  // into one journal line, and every quarantined line collapses together,
  // because 20890 is a single account and 0172 forbids duplicate-purpose noise.
  const byAccount = new Map<
    string,
    { slug: string | null; qty: number; cost: number; quarantined: boolean }
  >();
  const lotCosts: { lotCode: string; unitCostCents: number }[] = [];

  for (const line of input.lines) {
    let account: string;
    let quarantined: boolean;

    if (line.categorySlug === null) {
      // An honest unknown. 20890 exists precisely for this and it nags.
      account = QUARANTINE_ACCOUNT;
      quarantined = true;
    } else {
      const seed = INVENTORY_CATEGORIES.find((c) => c.slug === line.categorySlug);
      if (seed === undefined) {
        // A slug that was SUPPLIED but is not real is a typo or a bad mapping,
        // not an unknown. Quarantining it would bury a data error in an account
        // nobody reconciles line by line.
        return refuse(
          "UNKNOWN_CATEGORY",
          `"${line.categorySlug}" is not one of the ${INVENTORY_CATEGORIES.length} product ` +
            "categories in the chart of accounts.",
          "Correct the category on the intake, or send it through with no category at all — " +
            "an unmapped line lands in 20890 Inventory UNCLASSIFIED on purpose, where it is " +
            "visible and nags until resolved. A misspelling is a different problem and gets " +
            "fixed rather than filed.",
        );
      }
      account = inventoryAccountCode(seed.slot);
      quarantined = false;
    }

    if (!Number.isInteger(line.quantityReceived) || line.quantityReceived <= 0) {
      return refuse(
        "NON_POSITIVE_QUANTITY",
        `A line on this delivery reports ${line.quantityReceived} units received.`,
        "A receipt records goods that arrived. Zero units is not a receipt, and a return to " +
          "the vendor is a separate entry that moves cost the other way.",
      );
    }

    if (line.unitCostCents === null) {
      return refuse(
        "UNIT_COST_UNKNOWN",
        "A line on this delivery has no agreed unit cost, so the value of the goods " +
          "received cannot be established.",
        "This is the number every later number depends on: it becomes inventory today and " +
          "cost of goods sold when the product sells, which under 280E is the only deduction " +
          "this business gets. Enter the cost from the purchase order or the manifest. The " +
          "system will not assume a zero, because a zero would silently tax you on the full " +
          "sale price later.",
      );
    }

    if (!Number.isInteger(line.unitCostCents)) {
      return refuse(
        "FRACTIONAL_CENTS",
        `A unit cost of ${line.unitCostCents} is not a whole number of cents.`,
        "Money is stored as whole cents everywhere in this system. Round once, at intake, " +
          "before the number reaches the ledger.",
      );
    }

    if (line.unitCostCents < 0) {
      return refuse(
        "NEGATIVE_UNIT_COST",
        `A unit cost of ${line.unitCostCents} cents is negative.`,
        "A credit or a rebate from a vendor is a purchase discount and belongs on the bill " +
          "(account 60900), not on a goods receipt. Negative cost here would understate " +
          "inventory.",
      );
    }

    const extended = line.unitCostCents * line.quantityReceived;
    const prior = byAccount.get(account) ?? {
      slug: line.categorySlug,
      qty: 0,
      cost: 0,
      quarantined,
    };
    byAccount.set(account, {
      slug: prior.slug,
      qty: prior.qty + line.quantityReceived,
      cost: prior.cost + extended,
      quarantined,
    });

    const lot = (line.lotCode ?? "").trim();
    if (lot.length > 0) lotCosts.push({ lotCode: lot, unitCostCents: line.unitCostCents });
  }

  let total = 0;
  for (const v of byAccount.values()) total += v.cost;

  if (total === 0) {
    // Every line was free. Legal (a vendor sample), but there is no entry to
    // make: a zero-amount line is illegal in 0172 and a journal of nothing but
    // zeroes would be noise in the ledger.
    return refuse(
      "NOTHING_TO_CAPITALISE",
      "Every line on this delivery has a unit cost of zero, so the entry would move no money.",
      "Free goods still need a cost basis if they will be sold — check whether these are " +
        "samples, or whether the cost simply has not been entered yet. If they are genuinely " +
        "free, they carry no inventory value and no COGS deduction when sold.",
    );
  }

  // Deterministic line order: category slot order, quarantine last. The same
  // delivery always produces byte-identical lines, so a re-post can be compared.
  const ordered: { account: string; slug: string | null; qty: number; cost: number; q: boolean }[] =
    [];
  for (const seed of INVENTORY_CATEGORIES) {
    const code = inventoryAccountCode(seed.slot);
    const hit = byAccount.get(code);
    if (hit !== undefined) {
      ordered.push({ account: code, slug: hit.slug, qty: hit.qty, cost: hit.cost, q: false });
    }
  }
  const quarantine = byAccount.get(QUARANTINE_ACCOUNT);
  if (quarantine !== undefined) {
    ordered.push({
      account: QUARANTINE_ACCOUNT,
      slug: null,
      qty: quarantine.qty,
      cost: quarantine.cost,
      q: true,
    });
  }

  const lines: JournalLineDraft[] = [];
  let lineNo = 1;
  let quarantinedCost = 0;

  for (const o of ordered) {
    if (o.cost === 0) continue; // 0172 forbids a zero-amount line
    if (o.q) quarantinedCost += o.cost;
    lines.push({
      lineNo: lineNo++,
      accountCode: o.account,
      entityCode: "greenway",
      amountCents: o.cost, // positive = debit; inventory rises
      // Balance-sheet line. 0172 raises GL_COST_CLASS_NOT_ALLOWED otherwise, and
      // it is right to: goods carry no 280E character until they become COGS.
      costClass: "none",
      description: o.q
        ? `Received UNCLASSIFIED — ${o.qty} units — needs a category`
        : `Received ${o.slug ?? ""} — ${o.qty} units`,
    });
  }

  lines.push({
    lineNo: lineNo++,
    accountCode: IN_TRANSIT_ACCOUNT,
    entityCode: "greenway",
    amountCents: -total, // negative = credit
    costClass: "none",
    description: `Received not invoiced — ${input.vendorName.trim()}`,
  });

  const journal: JournalDraft = {
    entityCode: "greenway",
    journalDate: input.receivedDate,
    sourceKind: "purchase",
    sourceRef: `${input.receiptRef}#receipt`,
    memo: `Goods received — ${input.vendorName.trim()} — ${input.receiptRef}`,
    assumptionNote:
      "Goods are capitalised at agreed cost on the day they physically arrive, credited to " +
      "20800 Inventory — In Transit rather than to accounts payable, because no invoice has " +
      "arrived yet and the vendor is not yet owed a determined sum. The intended second half " +
      "is that the vendor bill relieves 20800 instead of debiting inventory again; that half " +
      "is NOT yet implemented (the bill still debits the category account directly), so these " +
      "two entries must not both be posted for the same goods until it is. See DEFECTS.md " +
      "D-61. Inbound freight is not allocated here: it is only known at invoice time and is " +
      "already classified to 60800 under Reg. §1.471-3(b).",
    lines,
  };

  const splits: ReceiptSplit[] = ordered.map((o) => ({
    categorySlug: o.slug,
    inventoryAccount: o.account,
    quantityReceived: o.qty,
    extendedCostCents: o.cost,
    quarantined: o.q,
  }));

  return {
    kind: "built",
    journal,
    splits,
    totalCostCents: total,
    quarantinedCostCents: quarantinedCost,
    lotCosts,
  };
}

/**
 * The number `vendor-bill-core.ts#threeWayMatch` has always accepted and nothing
 * has ever supplied.
 *
 * `threeWayMatch` takes `receivedCents: number | null` and, when it is null,
 * degrades to comparing the invoice against the order alone. Returning the
 * measured value of what actually arrived turns that into a real comparison —
 * which is the "suggestions possibly" Michael asked for, without becoming the
 * approval gate he refused.
 */
export function receivedCentsForMatch(outcome: ReceiptOutcome): number | null {
  return outcome.kind === "built" ? outcome.totalCostCents : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6) SELF-TESTS
 * ══════════════════════════════════════════════════════════════════════════ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("receipt-journal-core: " + msg);
}

const sumOf = (j: JournalDraft): number => j.lines.reduce((a, l) => a + l.amountCents, 0);

export function __runReceiptJournalCoreTests(): void {
  const base: ReceiptInput = {
    receivedDate: "2026-03-14",
    receiptRef: "PO-1001",
    vendorName: "Northwest Cannabis Solutions",
    lines: [
      { categorySlug: "flower", quantityReceived: 10, unitCostCents: 1500, lotCode: "LOT-A" },
    ],
  };

  // --- The plain case. -----------------------------------------------------
  const r = buildReceiptJournal(base);
  assert(r.kind === "built", "a plain receipt must build");
  if (r.kind === "built") {
    assert(r.totalCostCents === 15_000, "10 x 1500 = 15000, got " + r.totalCostCents);
    assert(sumOf(r.journal) === 0, "the entry must balance to zero");
    assert(r.journal.lines.length === 2, "one inventory line and one 20800 line");
    assert(r.journal.lines[0].accountCode === "20010", "flower inventory is 20010");
    assert(r.journal.lines[0].amountCents === 15_000, "inventory is DEBITED");
    assert(
      r.journal.lines[1].accountCode === IN_TRANSIT_ACCOUNT,
      "the credit goes to 20800, not to A/P",
    );
    assert(r.journal.lines[1].amountCents === -15_000, "20800 is CREDITED");
    assert(r.journal.sourceKind === "purchase", "source kind is purchase");
    assert(r.lotCosts.length === 1 && r.lotCosts[0].unitCostCents === 1500, "lot cost captured");
  }

  // --- THE DOUBLE-COUNT GUARD. --------------------------------------------
  // vendor-bill-core already debits inventory and credits 30000. If this module
  // ever credits 30000 too, the same goods get capitalised twice.
  if (r.kind === "built") {
    for (const l of r.journal.lines) {
      assert(l.accountCode !== "30000", "a receipt must NEVER touch accounts payable");
    }
  }

  // --- Quarantine, not refusal, for an honest unknown. --------------------
  const q = buildReceiptJournal({
    ...base,
    receiptRef: "PO-1002",
    lines: [
      { categorySlug: "flower", quantityReceived: 2, unitCostCents: 1000 },
      { categorySlug: null, quantityReceived: 3, unitCostCents: 500 },
    ],
  });
  assert(q.kind === "built", "an unmapped line must not sink the whole delivery");
  if (q.kind === "built") {
    assert(q.quarantinedCostCents === 1500, "3 x 500 quarantined, got " + q.quarantinedCostCents);
    assert(q.totalCostCents === 3500, "total is 2000 + 1500");
    const acc = q.journal.lines.map((l) => l.accountCode);
    assert(acc.includes(QUARANTINE_ACCOUNT), "the unmapped cost lands in 20890");
    // Quarantine sorts last, immediately before the credit.
    assert(acc[acc.length - 2] === QUARANTINE_ACCOUNT, "quarantine is the last debit");
    assert(sumOf(q.journal) === 0, "still balances with a quarantined line");
  }

  // --- A typo is NOT an honest unknown. -----------------------------------
  const typo = buildReceiptJournal({
    ...base,
    lines: [{ categorySlug: "flowre", quantityReceived: 1, unitCostCents: 100 }],
  });
  assert(typo.kind === "refused", "a misspelled category must refuse, not quarantine");

  // --- Same category on two lines collapses to one journal line. ----------
  const two = buildReceiptJournal({
    ...base,
    receiptRef: "PO-1003",
    lines: [
      { categorySlug: "flower", quantityReceived: 4, unitCostCents: 1000, lotCode: "L1" },
      { categorySlug: "flower", quantityReceived: 6, unitCostCents: 2000, lotCode: "L2" },
    ],
  });
  assert(two.kind === "built", "two lots of one category must build");
  if (two.kind === "built") {
    assert(two.journal.lines.length === 2, "collapsed to one debit and one credit");
    assert(two.totalCostCents === 4000 + 12_000, "4x1000 + 6x2000");
    // Both lot costs survive even though the journal lines merged: the ledger
    // wants one line, the lot table wants both costs.
    assert(two.lotCosts.length === 2, "both lot costs are reported");
  }

  // --- Every refusal is reachable (rule 43). ------------------------------
  const seen = new Set<string>();
  const push = (o: ReceiptOutcome): void => {
    if (o.kind === "refused") seen.add(o.code);
  };
  push(buildReceiptJournal({ ...base, lines: [] }));
  push(buildReceiptJournal({ ...base, receivedDate: "2025-12-31" }));
  push(typo);
  push(
    buildReceiptJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantityReceived: 0, unitCostCents: 100 }],
    }),
  );
  push(
    buildReceiptJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantityReceived: 1, unitCostCents: null }],
    }),
  );
  push(
    buildReceiptJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantityReceived: 1, unitCostCents: -5 }],
    }),
  );
  push(
    buildReceiptJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantityReceived: 1, unitCostCents: 10.5 }],
    }),
  );
  push(
    buildReceiptJournal({
      ...base,
      lines: [{ categorySlug: "flower", quantityReceived: 5, unitCostCents: 0 }],
    }),
  );
  for (const code of RECEIPT_REFUSAL_CODES) {
    assert(seen.has(code), "refusal code never emitted, so it is decoration: " + code);
  }

  // --- The bridge to the match that already exists. -----------------------
  assert(receivedCentsForMatch(r) === 15_000, "a built receipt reports what arrived");
  assert(
    receivedCentsForMatch(typo) === null,
    "a refused receipt reports null, so threeWayMatch degrades honestly",
  );

  // --- Balance holds across every category, not one happy example. --------
  for (const c of INVENTORY_CATEGORIES) {
    for (const unit of [1, 7, 999, 123_456]) {
      const one = buildReceiptJournal({
        ...base,
        receiptRef: `PO-sweep-${c.slug}-${unit}`,
        lines: [{ categorySlug: c.slug, quantityReceived: 3, unitCostCents: unit }],
      });
      assert(one.kind === "built", `sweep must build for ${c.slug} at ${unit}`);
      if (one.kind === "built") {
        assert(sumOf(one.journal) === 0, `must balance for ${c.slug}/${unit}`);
        assert(
          one.totalCostCents === unit * 3,
          `extended cost must be unit x qty for ${c.slug}/${unit}`,
        );
        assert(
          one.journal.lines[0].accountCode === inventoryAccountCode(c.slot),
          `must debit the category account for ${c.slug}`,
        );
        assert(one.quarantinedCostCents === 0, `a mapped category must not quarantine`);
      }
    }
  }
}
