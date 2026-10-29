/**
 * src/lib/accounting/refund-cogs-core.ts  (Fix Phase 2.8b · G-48 · F-15-14)
 *
 * PURE. No I/O. Registered in scripts/compliance/run-pure-selftests.ts.
 *
 * PUTTING BACK THE COST OF RETURNED ITEMS.
 *
 * Owner, message 6 (verbatim): "Please completely finish the refund entry, so
 * it puts back the cost of returned items. Please make sure this is of
 * enterprise grade quality."
 *
 * WHAT WAS WRONG
 * --------------
 * Fix Phase 2.8 booked the MONEY of a refund (refund-journal-core.ts) and said,
 * in its header, that cost of goods was left to the inventory audit
 * adjustment. That was not true. A return or a void puts the units back on a
 * lot (record_customer_return 0308; void-store.ts restockInventoryForVoid), so
 * the system on-hand figure ALREADY includes them. A physical count then
 * agrees with the system and the audit posts no variance
 * (inventory-audit-store.ts postAuditSession posts counted - system). The
 * returned unit's cost stayed in cost of goods sold forever and the inventory
 * account stayed short by the same amount.
 *
 * THE ENTRY (one per business day, beside the money entry)
 * --------------------------------------------------------
 *   DR 2SSSS Inventory - <category>   the cost of the units back on the shelf
 *   CR 6SSSS COGS - <category>        the same cost out of cost of goods sold
 * The exact mirror of the sale's own cost entry (sale-journal-core.ts "Entry 2:
 * the goods"), same accounts (inventoryAccountCode / cogsAccountCode of the
 * category slot), same cost classes (cogs_direct on 6xxxx, none on 2xxxx).
 * sourceRef refunds:<day>#cogs, so it can never collide with the money entry
 * refunds:<day> and is idempotent on its own.
 *
 * WHERE EACH COST COMES FROM (never guessed)
 * ------------------------------------------
 *   void    -> the sale's own cost entry order:<id>#cogs, reversed line for
 *              line. A void restocks every unit of the sale, so the exact
 *              figure the sale booked is the exact figure to put back. If the
 *              sale never booked a cost there is nothing to reverse, and the
 *              item is listed as such, not invented.
 *   return  -> customer_returns.lot_id (the lot the units went back on, read
 *              from a legible label: WAC 314-55-079(12)) x its
 *              unit_cost_minor_units x the quantity returned. A lot with no
 *              cost REFUSES the whole day's cost entry: a zero would look like
 *              a real figure.
 *
 * DESTROYED RETURNS KEEP THEIR COST IN COGS (stated, not hidden)
 * --------------------------------------------------------------
 * A Destroy return goes on hold and is destroyed later. The destruction
 * completes in the database (0308 complete step: on_hand_qty - p_qty) and
 * posts NO journal. If this entry put its cost back into inventory, nothing
 * would ever take it out again and the inventory account would be overstated.
 * So a destroyed unit's cost stays where the sale put it: in cost of goods
 * sold, which is where product lost to destruction belongs. Each one is
 * counted and named in the explanation.
 */

import { INVENTORY_CATEGORIES, cogsAccountCode, inventoryAccountCode } from "./coa-core";
import { LINE_IN_THE_SAND } from "./ledger-core";
import type { JournalDraft, JournalLineDraft } from "./ledger-core";

export const REFUND_COGS_SOURCE_SUFFIX = "#cogs";
export function refundCogsSourceRef(businessDay: string): string {
  return `refunds:${businessDay}${REFUND_COGS_SOURCE_SUFFIX}`;
}

export type RefundCostLine = {
  /** A slug from INVENTORY_CATEGORIES. */
  readonly categorySlug: string;
  /** Integer cents of cost to put back. */
  readonly costCents: number;
};

export type RefundCostItem = {
  readonly source: "return" | "void";
  readonly sourceId: string;
  readonly label: string;
  /** return: the desk's choice; void: always "restock" (every unit goes back). */
  readonly disposition: "restock" | "destroy";
  /**
   * The cost to put back, per category.
   *   null  -> the cost could not be established (refuses the day; reason in costProblem)
   *   []    -> nothing was booked as cost for this item (a void of a sale with no cost entry)
   */
  readonly costLines: readonly RefundCostLine[] | null;
  /** Why the cost is unknown (null cost) or empty, for the owner. */
  readonly costNote?: string | null;
};

export type RefundCogsInput = {
  readonly businessDay: string;
  readonly items: readonly RefundCostItem[];
};

export const REFUND_COGS_REFUSAL_CODES = [
  "REFUND_COGS_BAD_DAY",
  "REFUND_COGS_BEFORE_LINE_IN_THE_SAND",
  "REFUND_COGS_UNKNOWN_COST",
  "REFUND_COGS_UNKNOWN_CATEGORY",
  "REFUND_COGS_BAD_AMOUNT",
] as const;
export type RefundCogsRefusalCode = (typeof REFUND_COGS_REFUSAL_CODES)[number];

export type RefundCogsTotals = {
  readonly costCents: number;
  readonly restockedCount: number;
  readonly destroyedCount: number;
  readonly noCostCount: number;
};

export type RefundCogsOutcome =
  | {
      readonly kind: "journal";
      readonly journal: JournalDraft;
      readonly totals: RefundCogsTotals;
      readonly explanation: string;
    }
  | {
      /** Nothing to put back (only destroyed items, or sales that booked no cost). Not an error. */
      readonly kind: "nothing";
      readonly totals: RefundCogsTotals;
      readonly explanation: string;
    }
  | {
      readonly kind: "refused";
      readonly code: RefundCogsRefusalCode;
      readonly explanation: string;
    };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function fmt(cents: number): string {
  const neg = cents < 0;
  const s = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "-" : ""}$${s}`;
}

/** The category whose COGS account is this code, or null. From the chart, never a literal map. */
export function slugForCogsAccount(code: string): string | null {
  const seed = INVENTORY_CATEGORIES.find((c) => cogsAccountCode(c.slot) === code);
  return seed ? seed.slug : null;
}

/** The category whose inventory account is this code, or null. */
export function slugForInventoryAccount(code: string): string | null {
  const seed = INVENTORY_CATEGORIES.find((c) => inventoryAccountCode(c.slot) === code);
  return seed ? seed.slug : null;
}

/**
 * Turn a sale's cost entry (order:<id>#cogs) into the per-category cost to put
 * back. The sale debits 6SSSS and credits 2SSSS by the same figure per
 * category; this reads the debits and checks each is matched by its credit.
 */
export function costLinesFromSaleCogs(
  lines: readonly { accountCode: string; amountCents: number }[],
): { ok: true; lines: RefundCostLine[] } | { ok: false; problem: string } {
  const debit = new Map<string, number>();
  const credit = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountCents) || l.amountCents === 0) {
      return { ok: false, problem: `the sale's cost entry has a line of ${l.amountCents} cents on ${l.accountCode}` };
    }
    const cogsSlug = slugForCogsAccount(l.accountCode);
    const invSlug = slugForInventoryAccount(l.accountCode);
    if (cogsSlug && l.amountCents > 0) debit.set(cogsSlug, (debit.get(cogsSlug) ?? 0) + l.amountCents);
    else if (invSlug && l.amountCents < 0) credit.set(invSlug, (credit.get(invSlug) ?? 0) - l.amountCents);
    else return { ok: false, problem: `the sale's cost entry has an unexpected line on ${l.accountCode} (${l.amountCents} cents)` };
  }
  const out: RefundCostLine[] = [];
  for (const seed of INVENTORY_CATEGORIES) {
    const d = debit.get(seed.slug) ?? 0;
    const c = credit.get(seed.slug) ?? 0;
    if (d !== c) {
      return { ok: false, problem: `the sale's cost entry for ${seed.slug} debits ${fmt(d)} but relieves ${fmt(c)} of inventory` };
    }
    if (d > 0) out.push({ categorySlug: seed.slug, costCents: d });
  }
  return { ok: true, lines: out };
}

/**
 * The cost of a return: the lot's unit cost x the quantity. Refuses (null)
 * when the lot or its cost is unknown, or the product is not whole cents.
 */
export function returnCost(
  unitCostCents: number | null | undefined,
  quantity: number,
): { ok: true; costCents: number } | { ok: false; problem: string } {
  if (unitCostCents === null || unitCostCents === undefined) {
    return { ok: false, problem: "the lot the units went back on has no unit cost recorded" };
  }
  if (!Number.isSafeInteger(unitCostCents) || unitCostCents < 0) {
    return { ok: false, problem: `the lot's unit cost is ${unitCostCents} cents, which is not a whole, non-negative number of cents` };
  }
  if (!(Number.isFinite(quantity) && quantity > 0)) {
    return { ok: false, problem: `the quantity returned is ${quantity}` };
  }
  const product = unitCostCents * quantity;
  if (!Number.isSafeInteger(product)) {
    return { ok: false, problem: `${quantity} x ${fmt(unitCostCents)} is not a whole number of cents; the books will not round a cost silently` };
  }
  return { ok: true, costCents: product };
}

/** Build the day's cost-back entry, say there is nothing to do, or say exactly why not. */
export function buildRefundCogsJournal(input: RefundCogsInput): RefundCogsOutcome {
  const day = input.businessDay;
  if (!ISO_DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    return { kind: "refused", code: "REFUND_COGS_BAD_DAY", explanation: `"${day}" is not a date (YYYY-MM-DD).` };
  }
  if (day < LINE_IN_THE_SAND) {
    return {
      kind: "refused",
      code: "REFUND_COGS_BEFORE_LINE_IN_THE_SAND",
      explanation: `${day} is before the books start (${LINE_IN_THE_SAND}).`,
    };
  }

  const byCategory = new Map<string, number>();
  let restockedCount = 0;
  let destroyedCount = 0;
  let noCostCount = 0;
  const destroyedLabels: string[] = [];
  const noCostLabels: string[] = [];

  for (const it of input.items) {
    if (it.disposition === "destroy") {
      destroyedCount += 1;
      destroyedLabels.push(it.label);
      continue;
    }
    if (it.costLines === null) {
      return {
        kind: "refused",
        code: "REFUND_COGS_UNKNOWN_COST",
        explanation:
          `${it.label} went back on the shelf but its cost cannot be established (${it.costNote ?? "no reason given"}). ` +
          `Record the lot's unit cost on the receiving or lot page, then draft the day again. The cost entry was not drafted, because a guessed cost is worse than none.`,
      };
    }
    if (it.costLines.length === 0) {
      noCostCount += 1;
      noCostLabels.push(it.label);
      continue;
    }
    restockedCount += 1;
    for (const l of it.costLines) {
      if (!INVENTORY_CATEGORIES.some((c) => c.slug === l.categorySlug)) {
        return {
          kind: "refused",
          code: "REFUND_COGS_UNKNOWN_CATEGORY",
          explanation: `${it.label} has a cost in the category "${l.categorySlug}", which the books do not recognise. The cost entry was not drafted.`,
        };
      }
      if (!Number.isSafeInteger(l.costCents) || l.costCents < 0) {
        return {
          kind: "refused",
          code: "REFUND_COGS_BAD_AMOUNT",
          explanation: `${it.label} has a cost of ${l.costCents} cents. Costs are whole, non-negative cents. The cost entry was not drafted.`,
        };
      }
      byCategory.set(l.categorySlug, (byCategory.get(l.categorySlug) ?? 0) + l.costCents);
    }
  }

  const lines: JournalLineDraft[] = [];
  let n = 1;
  let total = 0;
  const cats = INVENTORY_CATEGORIES.filter((c) => (byCategory.get(c.slug) ?? 0) > 0);
  for (const c of cats) {
    const cents = byCategory.get(c.slug) as number;
    total += cents;
    lines.push({
      lineNo: n++,
      accountCode: inventoryAccountCode(c.slot),
      entityCode: "greenway",
      amountCents: cents, // debit: the units are back on the shelf
      costClass: "none",
      description: `Returned to stock - ${c.slug}`,
    });
  }
  for (const c of cats) {
    lines.push({
      lineNo: n++,
      accountCode: cogsAccountCode(c.slot),
      entityCode: "greenway",
      amountCents: -(byCategory.get(c.slug) as number), // credit: no longer a cost of goods sold
      costClass: "cogs_direct",
      description: `COGS reversed for returned units - ${c.slug}`,
    });
  }

  const totals: RefundCogsTotals = { costCents: total, restockedCount, destroyedCount, noCostCount };
  const tail =
    (destroyedCount > 0
      ? ` ${destroyedCount} destroyed return${destroyedCount === 1 ? "" : "s"} (${destroyedLabels.join(", ")}) keep their cost in cost of goods sold: destruction posts no entry, so putting it back would overstate inventory.`
      : "") +
    (noCostCount > 0
      ? ` ${noCostCount} item${noCostCount === 1 ? "" : "s"} (${noCostLabels.join(", ")}) had no cost booked by the sale, so there is nothing to reverse.`
      : "");

  if (lines.length === 0) {
    return {
      kind: "nothing",
      totals,
      explanation: `No cost to put back for ${day}.${tail}`.trim(),
    };
  }

  const journal: JournalDraft = {
    entityCode: "greenway",
    journalDate: day,
    sourceKind: "pos_sale",
    sourceRef: refundCogsSourceRef(day),
    memo: `Cost of returned units back to inventory ${day} (${restockedCount} item${restockedCount === 1 ? "" : "s"})`,
    assumptionNote:
      "Voids reverse the sale's own cost entry (order:<id>#cogs) exactly; returns use the unit cost of the lot the units went back on x the quantity. " +
      "Destroyed returns keep their cost in COGS because destruction posts no journal.",
    lines,
  };
  return {
    kind: "journal",
    journal,
    totals,
    explanation: `${restockedCount} item${restockedCount === 1 ? "" : "s"} back on the shelf on ${day}: ${fmt(total)} of cost moved out of cost of goods sold and back into inventory.${tail}`,
  };
}

/* ═════════════════════════════ self-tests ═════════════════════════════ */

export function __runRefundCogsCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`refund-cogs-core: ${msg}`);
    n += 1;
  };
  const day = "2026-11-02";
  const ret = (over: Partial<RefundCostItem> = {}): RefundCostItem => ({
    source: "return",
    sourceId: "r1",
    label: "Counter return",
    disposition: "restock",
    costLines: [{ categorySlug: "flower", costCents: 450 }],
    ...over,
  });

  // 1. A restocked return: DR 20010 / CR 60010, cost classes right, balanced.
  const a = buildRefundCogsJournal({ businessDay: day, items: [ret()] });
  ok(a.kind === "journal", "restocked return drafts");
  if (a.kind === "journal") {
    ok(a.journal.sourceRef === "refunds:2026-11-02#cogs", "own source ref, never the money entry's");
    ok(a.journal.lines[0].accountCode === "20010" && a.journal.lines[0].amountCents === 450, "DR flower inventory");
    ok(a.journal.lines[1].accountCode === "60010" && a.journal.lines[1].amountCents === -450, "CR flower COGS");
    ok(a.journal.lines[0].costClass === "none" && a.journal.lines[1].costClass === "cogs_direct", "cost classes mirror the sale");
    ok(a.journal.lines.reduce((s, l) => s + l.amountCents, 0) === 0, "balanced");
    ok(a.totals.costCents === 450 && a.totals.restockedCount === 1, "totals");
  }

  // 2. A destroyed return keeps its cost: nothing to draft, and it says why.
  const b = buildRefundCogsJournal({ businessDay: day, items: [ret({ disposition: "destroy" })] });
  ok(b.kind === "nothing", "destroyed only -> nothing");
  if (b.kind === "nothing") ok(/destruction posts no entry/.test(b.explanation), "destroyed is explained");

  // 3. An unknown cost refuses the whole day.
  const c = buildRefundCogsJournal({ businessDay: day, items: [ret(), ret({ sourceId: "r2", costLines: null, costNote: "no lot" })] });
  ok(c.kind === "refused" && c.code === "REFUND_COGS_UNKNOWN_COST", "unknown cost refuses");

  // 4. A void with no sale cost: listed, nothing invented.
  const d = buildRefundCogsJournal({ businessDay: day, items: [ret({ source: "void", label: "Void", costLines: [] })] });
  ok(d.kind === "nothing" && d.totals.noCostCount === 1, "void with no booked cost -> nothing");

  // 5. Mixed categories group per category, inventory lines first.
  const e = buildRefundCogsJournal({
    businessDay: day,
    items: [
      ret(),
      ret({ sourceId: "o1", source: "void", label: "Void", costLines: [{ categorySlug: "flower", costCents: 50 }, { categorySlug: "preroll", costCents: 200 }] }),
    ],
  });
  ok(e.kind === "journal", "mixed drafts");
  if (e.kind === "journal") {
    ok(e.journal.lines.length === 4, "two categories, four lines");
    ok(e.journal.lines[0].accountCode === "20010" && e.journal.lines[0].amountCents === 500, "flower summed");
    ok(e.journal.lines[1].accountCode === "20050" && e.journal.lines[1].amountCents === 200, "preroll inventory");
    ok(e.journal.lines[3].accountCode === "60050" && e.journal.lines[3].amountCents === -200, "preroll COGS");
  }

  // 6. Unknown category, bad amount, bad day, before the line in the sand.
  ok(buildRefundCogsJournal({ businessDay: day, items: [ret({ costLines: [{ categorySlug: "mystery", costCents: 1 }] })] }).kind === "refused", "unknown category");
  ok(buildRefundCogsJournal({ businessDay: day, items: [ret({ costLines: [{ categorySlug: "flower", costCents: 1.5 }] })] }).kind === "refused", "fractional cost");
  ok(buildRefundCogsJournal({ businessDay: "garbage", items: [ret()] }).kind === "refused", "bad day");
  ok(buildRefundCogsJournal({ businessDay: "2025-12-31", items: [ret()] }).kind === "refused", "before the books");

  // 7. A zero-cost restock (free sample-priced lot) drafts nothing but is not an error.
  ok(buildRefundCogsJournal({ businessDay: day, items: [ret({ costLines: [{ categorySlug: "flower", costCents: 0 }] })] }).kind === "nothing", "zero cost -> nothing");

  // 8. returnCost.
  ok((() => { const r = returnCost(450, 2); return r.ok && r.costCents === 900; })(), "450 x 2");
  ok(!returnCost(null, 1).ok, "no lot cost refuses");
  ok(!returnCost(-1, 1).ok, "negative cost refuses");
  ok(!returnCost(333, 0.5).ok, "half of an odd cent refuses");
  ok(!returnCost(100, 0).ok, "zero quantity refuses");

  // 9. costLinesFromSaleCogs.
  const s1 = costLinesFromSaleCogs([
    { accountCode: "60010", amountCents: 450 },
    { accountCode: "20010", amountCents: -450 },
  ]);
  ok(s1.ok && s1.lines.length === 1 && s1.lines[0].costCents === 450, "reads the sale's cost");
  ok(!costLinesFromSaleCogs([{ accountCode: "60010", amountCents: 450 }, { accountCode: "20010", amountCents: -400 }]).ok, "unmatched refuses");
  ok(!costLinesFromSaleCogs([{ accountCode: "10110", amountCents: 450 }]).ok, "foreign account refuses");
  ok(slugForCogsAccount("60010") === "flower" && slugForCogsAccount("99999") === null, "COGS account -> slug");

  return { passed: n, failed: 0 };
}
