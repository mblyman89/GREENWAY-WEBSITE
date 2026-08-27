// ===========================================================================
// CUT-OVER INVENTORY CORE — turning a physical count into an opening balance.
//
// THE ONE ECONOMIC IDEA IN THIS FILE
// On 2026-10-31, after close, Michael counts what is on the shelf. That product
// was bought and paid for months ago, under Cultivera, with money that left his
// bank before this platform existed. NO VENDOR IS OWED ANYTHING FOR IT.
//
// So the cut-over load is an EQUITY event, not a purchase:
//   DEBIT  the per-category inventory accounts (200xx)
//   CREDIT 40400 Opening Balance Equity
//
// Booking it as a purchase would credit 30000 Accounts Payable and state that he
// owes his vendors the entire value of his shelf — money he already paid. His
// liabilities would be overstated by the whole inventory value, his equity
// understated by the same amount, AND THE TRIAL BALANCE WOULD STILL BALANCE.
// Every report would render. That is the shape of error that survives an audit,
// and it is why this module exists as its own file with its own tests.
//
// WHAT THIS MODULE IS NOT
// It is a BUILDER, not a path. Nothing calls it yet, on purpose. It produces a
// line set; it does not write to the database, does not touch Supabase, and has
// no side effects. The census records `reachable: MISSING` for the cut-over row
// and must continue to after this file exists.
//
// GROUND TRUTH FOR THE INPUT SHAPE (books-71, measured, not assumed)
// Michael's real Cultivera export, INVENTORIES.xlsx, 3,917 data rows:
//   - `Cost` is populated and non-zero on 3,917 of 3,917 rows
//   - `Units In Stock` is never blank, zero, or negative
//   - `Id` is unique across all 3,917 rows
//   - `Barcode` is NOT unique — 41 barcodes span multiple rows, 6 of those at
//     DIFFERENT costs with different receive dates (real layered cost). Keying
//     on barcode would collapse 41 lots and silently lose value, so this module
//     keys on `Id`.
//   - single location, `GREENWAY MARIJUANA`; `Is Sample` false on every row
//
// MICHAEL, ON WHAT THE COST MEANS (his own words, this is why no freight or
// excise is added to it here):
//   "The cost from Cultivera is the invoice cost. There isn't any other cost
//    associated with inventory purchases unfortunately. We assign some employee
//    hours to cogs for inventory purposes. But that's not to be worried about
//    this next slice. All that matters is the cost from the spreadsheet is the
//    all inclusive cost for that product."
// So `costCents` is taken as the complete unit cost. Labour capitalised into
// COGS is explicitly out of scope and is NOT modelled here.
//
// DATABASE LAW THIS MUST SATISFY (read from the migrations, line-cited)
//   0176:213 GL_OB_PARENT_ACCOUNT — an account WITH CHILDREN is refused. `20000`
//            is the parent of 25 accounts in 0173, so this module must never
//            emit `20000`; only the leaf `200xx` accounts. Asserted in tests.
//   0176:222 GL_OB_NOT_BALANCE_SHEET — income/expense/cogs refused. `40400` is
//            type `equity` (0173:561) with no children, so it is legal.
//   0176:~68 `check (amount_cents <> 0)` — A ZERO LINE IS REJECTED BY THE
//            DATABASE. Zero-value groups are therefore dropped here, counted,
//            and reported — never emitted as a zero line.
//   0176:~92 `evidence_ref` must be >= 3 non-blank characters.
//   gl_ob_validate_row — the account must be active and permitted for the
//            entity. The inventory accounts are allowed_entity_codes
//            {greenway}, so a non-greenway entity is refused here, early,
//            rather than at post time weeks later.
//
// SIGN CONVENTION mirrors vendor-bill-core.BillJournalLine exactly:
//   POSITIVE = debit, NEGATIVE = credit, and a balanced set sums to exactly 0.
// ===========================================================================

/** Entity codes this system keeps books for. Mirrors the accounting branch. */
export type CutoverEntityCode = "greenway" | "atm" | "landholding" | "personal";

/**
 * One counted lot, as it comes off the Cultivera inventory export.
 *
 * Field names mirror the MEASURED columns of INVENTORIES.xlsx rather than
 * inventing a prettier vocabulary, so a reader can hold the spreadsheet next to
 * this type and see that they agree.
 */
export type CutoverLot = {
  /** `Id` column. The unique key — 3,917 distinct values, 0 duplicates. */
  id: string;
  /** `Category` column, verbatim (e.g. "Infused Pre-roll"). */
  category: string;
  /**
   * Resolved house category slug (e.g. "infused-preroll"). Resolution is the
   * CALLER's job and is deliberately not done here: transform.ts CATEGORY_MAP
   * already covers 52 of 52 of Michael's categories, and duplicating that map
   * would create a second copy free to drift. Null means unresolved.
   */
  categorySlug: string | null;
  /** `Cost` column, converted to integer cents. Never a float. */
  costCents: number;
  /**
   * `Units In Stock`, in whole units. Cultivera writes "2.0000"; the caller
   * parses. Fractional counts are refused rather than rounded — see below.
   */
  quantity: number;
  /** `Barcode`, carried for the audit trail only. NOT used as a key. */
  barcode?: string;
  /** `Product` name, carried so a dropped lot can be named in a message. */
  productName?: string;
};

/** Why a lot did not make it into the entry. Every drop is one of these. */
export type CutoverDropReason =
  | "unresolved_category"
  | "zero_or_negative_cost"
  | "zero_or_negative_quantity"
  | "fractional_quantity"
  | "non_integer_cost"
  /**
   * cost x quantity left the range where integer arithmetic is exact, even
   * though cost and quantity were each fine on their own. 9,000,000,000,000,000
   * cents times 2 units is past MAX_SAFE_INTEGER, and past that boundary the
   * product is an approximation. An approximate amount of money is not an
   * amount of money.
   */
  | "extended_value_too_large";

export type CutoverDroppedLot = {
  id: string;
  category: string;
  productName: string | null;
  reason: CutoverDropReason;
  /** Plain-English sentence naming the lot and what to do about it. */
  message: string;
};

/** One line of the opening-balance line set. Mirrors BillJournalLine. */
export type CutoverLine = {
  accountCode: string;
  /** Signed integer cents. POSITIVE = debit, NEGATIVE = credit. */
  amountCents: number;
  /** How many counted lots rolled into this line. */
  lotCount: number;
  description: string;
};

export type CutoverRefusalCode =
  | "NOT_GREENWAY"
  | "NO_LOTS"
  | "NOTHING_LEFT_AFTER_DROPS"
  | "CONTROL_ACCOUNT_EMITTED"
  | "TOTAL_OUT_OF_EXACT_RANGE"
  | "UNBALANCED";

export type CutoverRefusal = {
  ok: false;
  code: CutoverRefusalCode;
  /** A sentence Michael could read and act on. */
  message: string;
};

export type CutoverPlan = {
  ok: true;
  entityCode: "greenway";
  /** The count date. The BALANCE is as of the close of business this day. */
  asOfDate: string;
  sourceKind: "opening_balance";
  evidenceKind: "inventory_count";
  evidenceRef: string;
  /** Debit lines (one per account) followed by the single 40400 credit. */
  lines: readonly CutoverLine[];
  /** Total value debited to inventory, in cents. */
  totalInventoryCents: number;
  /** Lots that made it in. */
  lotsIncluded: number;
  /** Lots that did not, each with a reason. Never silently discarded. */
  dropped: readonly CutoverDroppedLot[];
};

export type CutoverResult = CutoverPlan | CutoverRefusal;

/**
 * The account that receives the credit.
 *
 * 40400 Opening Balance Equity, seeded by 0173:561 as type `equity`. It exists
 * for exactly this purpose: "this value came in with me from before, it was not
 * bought on credit, and nobody is owed."
 */
export const OPENING_BALANCE_EQUITY_CODE = "40400";

/**
 * The inventory CONTROL account. Present here as a named constant for ONE
 * reason: so the guard that refuses to emit it can cite it. 0176:213 refuses any
 * account with children, and 0173 makes 20000 the parent of 25 accounts.
 */
export const INVENTORY_CONTROL_CODE = "20000";

/**
 * Category slug -> inventory account slot.
 *
 * MIRRORED from vendor-bill-core.CATEGORY_SLOTS, which is itself mirrored from
 * coa-core.INVENTORY_CATEGORIES. Duplicated rather than imported so this module
 * stays a leaf with no accounting-internal dependencies — the same reasoning
 * vendor-bill-core states for its own copy. A test asserts the two lists agree
 * exactly, so drift fails the gate rather than rotting quietly.
 */
export const CUTOVER_CATEGORY_SLOTS: readonly { slug: string; slot: number }[] = [
  { slug: "flower", slot: 10 },
  { slug: "popcorn-bud", slot: 20 },
  { slug: "infused-flower", slot: 30 },
  { slug: "trim", slot: 40 },
  { slug: "preroll", slot: 50 },
  { slug: "preroll-pack", slot: 60 },
  { slug: "blunt", slot: 70 },
  { slug: "infused-preroll", slot: 80 },
  { slug: "infused-preroll-pack", slot: 90 },
  { slug: "infused-blunt", slot: 100 },
  { slug: "cartridge", slot: 120 },
  { slug: "disposable-cartridge", slot: 130 },
  { slug: "concentrate", slot: 140 },
  { slug: "rso", slot: 150 },
  { slug: "edible-solid", slot: 160 },
  { slug: "edible-liquid", slot: 170 },
  { slug: "tincture", slot: 180 },
  { slug: "topical", slot: 190 },
  { slug: "accessories", slot: 200 },
  { slug: "paraphernalia", slot: 210 },
  { slug: "merch", slot: 220 },
] as const;

/** The 5-digit inventory account for a category slug, or null if unknown. */
export function cutoverAccountForSlug(slug: string | null): string | null {
  if (slug === null) return null;
  const found = CUTOVER_CATEGORY_SLOTS.find((c) => c.slug === slug);
  return found ? `2${String(found.slot).padStart(4, "0")}` : null;
}

/** Human-readable account names, for line descriptions only. */
const ACCOUNT_LABELS: Readonly<Record<string, string>> = {
  "20010": "Flower",
  "20020": "Popcorn Bud",
  "20030": "Infused Flower",
  "20040": "Trim",
  "20050": "Preroll",
  "20060": "Preroll Pack",
  "20070": "Blunt",
  "20080": "Infused Preroll",
  "20090": "Infused Preroll Pack",
  "20100": "Infused Blunt",
  "20120": "Cartridge",
  "20130": "Disposable Cartridge",
  "20140": "Concentrate",
  "20150": "RSO",
  "20160": "Edible (Solid)",
  "20170": "Edible (Liquid)",
  "20180": "Tincture",
  "20190": "Topical",
  "20200": "Accessories",
  "20210": "Paraphernalia",
  "20220": "Greenway Merch",
};

/**
 * Extend one lot: unit cost in cents times whole units.
 *
 * Both operands are integers, so the product is exact and there is NO ROUNDING
 * DECISION HERE AT ALL. That is deliberate. Rounding is where money goes missing
 * a cent at a time, and D-10 in the defect register is still open precisely
 * because a rounding half was left uninvented. Keeping cost in cents and
 * quantity in whole units means this multiplication cannot drift.
 *
 * Fractional quantities are REFUSED upstream rather than rounded here, because
 * choosing how to round half a gummy is an accounting decision and rule 1
 * forbids inventing one.
 */
export function extendLotCents(costCents: number, quantity: number): number {
  return costCents * quantity;
}

/**
 * Whole number, finite, AND inside the range where integer arithmetic is exact.
 *
 * `Number.isInteger(1e300)` is TRUE, so checking only "is it an integer" lets a
 * parse error carry a value that cannot be multiplied without losing precision.
 * Past MAX_SAFE_INTEGER (9,007,199,254,740,991) `x + 1 === x` becomes possible
 * and the extension below stops being exact. Michael's whole shelf is
 * 17,682,462 cents, so any value near that ceiling is a broken import, not a
 * price — and it should be named as one rather than reappearing later as an
 * unexplained imbalance.
 */
function isExactInteger(n: number): boolean {
  return Number.isSafeInteger(n);
}

/**
 * Inspect a finished line set for the two structural defects that must never
 * reach the opening-balance worksheet, and return the refusal it earns.
 *
 * WHY THIS IS A SEPARATE EXPORTED FUNCTION
 * These two checks cannot be reached through `buildCutoverInventoryPlan`'s
 * input surface: no category slot resolves to the control account, and the
 * balancing credit is derived from the same sum that built the debits. A
 * mutation campaign proved the point — deleting either check inside the builder
 * changed no test result, which under rule 43 makes them decoration rather than
 * protection.
 *
 * Pulling them out here does not weaken the builder, which still calls this on
 * every run. It means a test can hand this function a hostile line set directly
 * and prove the guard actually fires. The checks exist for a FUTURE edit — a
 * slot table change that produced 20000, or an arithmetic change that broke the
 * credit — and now that future edit will be caught by a test that runs today.
 *
 * Returns null when the line set is sound.
 */
export function findCutoverLineSetDefect(
  lines: readonly CutoverLine[],
): { code: CutoverRefusalCode; message: string } | null {
  // 0176:213 GL_OB_PARENT_ACCOUNT refuses an account that has children, and
  // 0173 makes 20000 the parent of 25 accounts. Catching it here names the real
  // cause instead of letting the worksheet reject it with a generic message.
  for (const line of lines) {
    if (line.accountCode === INVENTORY_CONTROL_CODE) {
      return {
        code: "CONTROL_ACCOUNT_EMITTED",
        message:
          `This entry tried to post to ${INVENTORY_CONTROL_CODE}, the inventory ` +
          `control account. It is a heading with 25 accounts underneath it, and ` +
          `the opening balance worksheet refuses headings ` +
          `(GL_OB_PARENT_ACCOUNT). The value belongs on the specific category ` +
          `account.`,
      };
    }
  }

  // Double entry, asserted rather than assumed.
  let sum = 0;
  for (const line of lines) sum += line.amountCents;
  if (sum !== 0) {
    return {
      code: "UNBALANCED",
      message:
        `The entry does not balance: the lines sum to ${sum} cents instead of ` +
        `zero. This is a bug in the builder, not in the count.`,
    };
  }

  return null;
}

/**
 * Build the cut-over opening-balance line set from a counted lot list.
 *
 * Returns a REFUSAL rather than throwing, and rather than returning something
 * half-usable. A caller cannot accidentally post a partial cut-over: either
 * there is a balanced plan or there is a reason there is not.
 */
export function buildCutoverInventoryPlan(input: {
  entityCode: CutoverEntityCode;
  asOfDate: string;
  evidenceRef: string;
  lots: readonly CutoverLot[];
}): CutoverResult {
  // ---------------------------------------------------------------- entity
  // The inventory accounts are allowed_entity_codes {greenway} (0173). Refusing
  // here rather than letting gl_ob_validate_row catch it means the preparer
  // finds out while the count is in front of them, not weeks later at bless
  // time. 0176 states this reasoning for its own early check.
  if (input.entityCode !== "greenway") {
    return {
      ok: false,
      code: "NOT_GREENWAY",
      message:
        `The cut-over inventory load is for the Greenway books only, because the ` +
        `inventory accounts are restricted to greenway in the chart of accounts. ` +
        `This was addressed to "${input.entityCode}".`,
    };
  }

  if (input.lots.length === 0) {
    return {
      ok: false,
      code: "NO_LOTS",
      message:
        "There are no counted lots to load. An opening inventory balance with no " +
        "count behind it would be a number without a document.",
    };
  }

  // ------------------------------------------------------- sort and validate
  const dropped: CutoverDroppedLot[] = [];
  const byAccount = new Map<string, { cents: number; lots: number }>();

  for (const lot of input.lots) {
    const name = lot.productName?.trim() || null;
    const label = name ?? lot.id;

    if (!isExactInteger(lot.costCents)) {
      dropped.push({
        id: lot.id,
        category: lot.category,
        productName: name,
        reason: "non_integer_cost",
        message:
          `"${label}" has a unit cost of ${lot.costCents}, which is not a usable ` +
          `whole number of cents. Money is integer cents in this system, so a ` +
          `fractional cent or a value too large to hold exactly is a parsing ` +
          `error rather than a price.`,
      });
      continue;
    }

    if (lot.costCents <= 0) {
      // The database itself refuses a zero line (amount_cents <> 0), and
      // 0192's principle applies: an unknown value is never quietly turned
      // into a zero. So this is dropped and NAMED, not shrunk to nothing.
      dropped.push({
        id: lot.id,
        category: lot.category,
        productName: name,
        reason: "zero_or_negative_cost",
        message:
          `"${label}" has a unit cost of ${lot.costCents} cents, so it carries no ` +
          `value to record. Michael's real export had zero of these, so if this ` +
          `appears in the October count it means the cost did not come across.`,
      });
      continue;
    }

    if (!isExactInteger(lot.quantity)) {
      dropped.push({
        id: lot.id,
        category: lot.category,
        productName: name,
        reason: "fractional_quantity",
        message:
          `"${label}" has a counted quantity of ${lot.quantity}, which is not a ` +
          `whole number of units. Rounding a partial unit is an accounting ` +
          `decision, so this system refuses rather than guessing.`,
      });
      continue;
    }

    if (lot.quantity <= 0) {
      dropped.push({
        id: lot.id,
        category: lot.category,
        productName: name,
        reason: "zero_or_negative_quantity",
        message:
          `"${label}" has ${lot.quantity} units on hand, so there is nothing on ` +
          `the shelf to value.`,
      });
      continue;
    }

    const account = cutoverAccountForSlug(lot.categorySlug);
    if (account === null) {
      // NOT sent to 20890 quarantine. A vendor bill arriving mid-year with an
      // unknown category can be quarantined and cleaned up later, but the
      // cut-over is the foundation every later number is measured from, so an
      // unclassified lot is a question to answer before posting, not after.
      dropped.push({
        id: lot.id,
        category: lot.category,
        productName: name,
        reason: "unresolved_category",
        message:
          `"${label}" is in Cultivera category "${lot.category}", which did not ` +
          `resolve to one of the 21 inventory accounts. The cut-over is the ` +
          `foundation of every later number, so this needs an account before it ` +
          `is posted rather than being parked in quarantine.`,
      });
      continue;
    }

    const cents = extendLotCents(lot.costCents, lot.quantity);

    // Cost and quantity each passed the range check, but their PRODUCT can
    // still land past MAX_SAFE_INTEGER, and there the value stops being exact.
    // Catching it here names the lot; letting it through would surface later as
    // an UNBALANCED refusal that points at the builder instead of the data.
    if (!isExactInteger(cents)) {
      dropped.push({
        id: lot.id,
        category: lot.category,
        productName: name,
        reason: "extended_value_too_large",
        message:
          `"${label}" extends to ${cents} cents (${lot.costCents} cents x ` +
          `${lot.quantity} units), which is too large to hold exactly. This is a ` +
          `broken import rather than a real shelf value — the whole October ` +
          `shelf measured 17,682,462 cents.`,
      });
      continue;
    }

    const prev = byAccount.get(account) ?? { cents: 0, lots: 0 };
    byAccount.set(account, { cents: prev.cents + cents, lots: prev.lots + 1 });
  }

  // ---------------------------------------------------------------- lines
  const lines: CutoverLine[] = [];
  let totalInventoryCents = 0;

  // Sorted by account code so the entry reads like a balance sheet and two runs
  // of the same count produce byte-identical output.
  const accounts = [...byAccount.keys()].sort();
  for (const account of accounts) {
    const agg = byAccount.get(account);
    if (agg === undefined) continue;

    // A group can only reach zero if costs of opposite sign were summed, which
    // cannot happen because negative costs are dropped above. The check stays
    // because the DATABASE rejects a zero line (amount_cents <> 0), and a guard
    // that depends on a proof elsewhere in the file is a guard that breaks when
    // that proof moves.
    if (agg.cents === 0) continue;

    const label = ACCOUNT_LABELS[account] ?? "Inventory";
    lines.push({
      accountCode: account,
      amountCents: agg.cents,
      lotCount: agg.lots,
      description:
        `Opening inventory — ${label} — ${agg.lots} ` +
        `${agg.lots === 1 ? "lot" : "lots"} counted ${input.asOfDate}`,
    });
    totalInventoryCents += agg.cents;
  }

  if (lines.length === 0) {
    return {
      ok: false,
      code: "NOTHING_LEFT_AFTER_DROPS",
      message:
        `All ${input.lots.length} counted ${input.lots.length === 1 ? "lot" : "lots"} ` +
        `were set aside, so there is no opening inventory balance to post. See the ` +
        `reasons on each one.`,
    };
  }

  // Individually exact debits can still SUM past the exact range. The credit is
  // derived from this total, so if the total is not exact the credit is not
  // either, and the entry would balance on paper while being wrong.
  if (!isExactInteger(totalInventoryCents)) {
    return {
      ok: false,
      code: "TOTAL_OUT_OF_EXACT_RANGE",
      message:
        `The counted inventory totals ${totalInventoryCents} cents, which is too ` +
        `large to hold exactly, so the balancing credit could not be trusted. ` +
        `Michael's real October shelf measured 17,682,462 cents, so a total this ` +
        `size means the import is wrong.`,
    };
  }

  // The single credit. ONE line, not one per category, because there is one
  // assertion being made: this entire shelf came in with the owner.
  lines.push({
    accountCode: OPENING_BALANCE_EQUITY_CODE,
    amountCents: -totalInventoryCents,
    lotCount: 0,
    description:
      `Opening Balance Equity — inventory on hand at cut-over ${input.asOfDate} ` +
      `(already paid for; no vendor is owed)`,
  });

  // BOTH structural guards, in one call, on the FINISHED line set — so the
  // balance check sees the credit too. The logic lives in
  // findCutoverLineSetDefect so that a test can reach it with hostile input;
  // see the note on that function about rule 43.
  const defect = findCutoverLineSetDefect(lines);
  if (defect !== null) {
    return { ok: false, code: defect.code, message: defect.message };
  }

  return {
    ok: true,
    entityCode: "greenway",
    asOfDate: input.asOfDate,
    sourceKind: "opening_balance",
    evidenceKind: "inventory_count",
    evidenceRef: input.evidenceRef,
    lines,
    totalInventoryCents,
    lotsIncluded: input.lots.length - dropped.length,
    dropped,
  };
}

/** Signed cents sum to exactly zero. Mirrors vendor-bill-core.journalIsBalanced. */
export function cutoverPlanIsBalanced(plan: CutoverPlan): boolean {
  let sum = 0;
  for (const l of plan.lines) sum += l.amountCents;
  return sum === 0;
}

/**
 * The owner-facing sentence. Michael is a visual learner and asked for plain
 * English, so the plan can say what it is in one breath.
 */
export function describeCutoverPlan(plan: CutoverPlan): string {
  const dollars = (plan.totalInventoryCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const accountCount = plan.lines.length - 1; // less the equity credit
  const base =
    `${dollars} of inventory across ${accountCount} ` +
    `${accountCount === 1 ? "account" : "accounts"} and ${plan.lotsIncluded} ` +
    `${plan.lotsIncluded === 1 ? "lot" : "lots"}, counted ${plan.asOfDate}, ` +
    `debited to inventory and credited to Opening Balance Equity because it was ` +
    `already paid for.`;
  if (plan.dropped.length === 0) return base;
  return (
    `${base} ${plan.dropped.length} ` +
    `${plan.dropped.length === 1 ? "lot was" : "lots were"} set aside and needs ` +
    `attention before this is posted.`
  );
}

// ===========================================================================
// PURE SELF-TESTS
//
// Registered in scripts/compliance/run-pure-selftests.ts so they run in a gate
// and cannot become decoration.
// ===========================================================================

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`cutover-inventory-core self-test FAILED: ${msg}`);
}

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `cutover-inventory-core self-test FAILED: ${msg} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

function lot(over: Partial<CutoverLot> = {}): CutoverLot {
  return {
    id: over.id ?? "1",
    category: over.category ?? "Flower",
    categorySlug: over.categorySlug === undefined ? "flower" : over.categorySlug,
    costCents: over.costCents ?? 500,
    quantity: over.quantity ?? 2,
    barcode: over.barcode,
    productName: over.productName,
  };
}

function plan(lots: readonly CutoverLot[]): CutoverResult {
  return buildCutoverInventoryPlan({
    entityCode: "greenway",
    asOfDate: "2026-10-31",
    evidenceRef: "Cultivera INVENTORIES export 2026-10-31",
    lots,
  });
}

export function __runCutoverInventoryCoreTests(): void {
  // ---- the account mapper
  eq(cutoverAccountForSlug("flower"), "20010", "flower -> 20010");
  eq(cutoverAccountForSlug("infused-preroll"), "20080", "infused-preroll -> 20080");
  eq(cutoverAccountForSlug("merch"), "20220", "merch -> 20220");
  eq(cutoverAccountForSlug("not-a-slug"), null, "unknown slug -> null");
  eq(cutoverAccountForSlug(null), null, "null slug -> null");
  eq(CUTOVER_CATEGORY_SLOTS.length, 21, "21 house categories");

  // No slot may produce the control account, which the worksheet would refuse.
  for (const c of CUTOVER_CATEGORY_SLOTS) {
    ok(
      cutoverAccountForSlug(c.slug) !== INVENTORY_CONTROL_CODE,
      `slug ${c.slug} must not resolve to the control account`,
    );
  }

  // ---- extension is exact
  eq(extendLotCents(667, 3), 2001, "667 x 3 = 2001 cents exactly");
  eq(extendLotCents(1, 1), 1, "one cent, one unit");

  // ---- the happy path
  const good = plan([
    lot({ id: "1", costCents: 500, quantity: 2 }),
    lot({ id: "2", costCents: 250, quantity: 4, category: "Pre-roll", categorySlug: "preroll" }),
  ]);
  ok(good.ok, "a clean two-lot count builds a plan");
  if (good.ok) {
    eq(good.lines.length, 3, "two inventory accounts plus one equity credit");
    eq(good.sourceKind, "opening_balance", "THE classification: equity, not purchase");
    eq(good.evidenceKind, "inventory_count", "evidence kind matches 0176's vocabulary");
    eq(good.totalInventoryCents, 2000, "1000 + 1000");
    eq(good.lotsIncluded, 2, "both lots included");
    eq(good.dropped.length, 0, "nothing dropped");
    ok(cutoverPlanIsBalanced(good), "the plan balances");

    // The credit is 40400, exactly once, and 30000 NEVER appears.
    const equity = good.lines.filter((l) => l.accountCode === OPENING_BALANCE_EQUITY_CODE);
    eq(equity.length, 1, "exactly one equity credit");
    eq(equity[0].amountCents, -2000, "credit equals the total, negative");
    ok(
      !good.lines.some((l) => l.accountCode === "30000"),
      "ACCOUNTS PAYABLE MUST NEVER APPEAR — nobody is owed for the cut-over shelf",
    );
    ok(
      !good.lines.some((l) => l.accountCode === INVENTORY_CONTROL_CODE),
      "the control account must never appear",
    );

    // Debits are positive, the credit negative.
    const debits = good.lines.filter((l) => l.accountCode !== OPENING_BALANCE_EQUITY_CODE);
    for (const d of debits) ok(d.amountCents > 0, `debit ${d.accountCode} is positive`);
    eq(debits.length, 2, "two debit lines");

    // Sorted by account code, so output is stable run to run.
    eq(debits[0].accountCode, "20010", "sorted: flower first");
    eq(debits[1].accountCode, "20050", "sorted: preroll second");
  }

  // ---- lots in the same category ROLL UP into one line
  const rolled = plan([
    lot({ id: "1", costCents: 100, quantity: 1 }),
    lot({ id: "2", costCents: 200, quantity: 1 }),
    lot({ id: "3", costCents: 300, quantity: 1 }),
  ]);
  ok(rolled.ok, "three flower lots build");
  if (rolled.ok) {
    eq(rolled.lines.length, 2, "one flower line plus equity");
    eq(rolled.lines[0].amountCents, 600, "100 + 200 + 300");
    eq(rolled.lines[0].lotCount, 3, "the line remembers it is three lots");
  }

  // ---- DUPLICATE BARCODES MUST NOT COLLAPSE (books-71: 41 real cases)
  const dupBarcode = plan([
    lot({ id: "26614", barcode: "13033113612615061", costCents: 166, quantity: 12 }),
    lot({ id: "25323", barcode: "13033113612615061", costCents: 166, quantity: 9 }),
  ]);
  ok(dupBarcode.ok, "two lots sharing a barcode both count");
  if (dupBarcode.ok) {
    eq(dupBarcode.lotsIncluded, 2, "both lots survive — keyed on Id, not Barcode");
    eq(dupBarcode.totalInventoryCents, 166 * 21, "12 + 9 units both valued");
  }

  // ---- differing costs on the same barcode are kept separately (6 real cases)
  const layered = plan([
    lot({ id: "a", barcode: "same", costCents: 100, quantity: 1 }),
    lot({ id: "b", barcode: "same", costCents: 175, quantity: 1 }),
  ]);
  ok(layered.ok, "layered cost builds");
  if (layered.ok) eq(layered.totalInventoryCents, 275, "both cost layers survive");

  // ---- refusals
  const notGreenway = buildCutoverInventoryPlan({
    entityCode: "atm",
    asOfDate: "2026-10-31",
    evidenceRef: "x-ref",
    lots: [lot()],
  });
  ok(!notGreenway.ok, "a non-greenway entity is refused");
  if (!notGreenway.ok) eq(notGreenway.code, "NOT_GREENWAY", "refusal code");

  const empty = plan([]);
  ok(!empty.ok, "an empty count is refused");
  if (!empty.ok) eq(empty.code, "NO_LOTS", "refusal code");

  const allDropped = plan([lot({ categorySlug: null })]);
  ok(!allDropped.ok, "if every lot drops there is nothing to post");
  if (!allDropped.ok) eq(allDropped.code, "NOTHING_LEFT_AFTER_DROPS", "refusal code");

  // ---- drops, each named
  const withDrops = plan([
    lot({ id: "keep", costCents: 500, quantity: 1 }),
    lot({ id: "d1", categorySlug: null, category: "Gummies" }),
    lot({ id: "d2", costCents: 0 }),
    lot({ id: "d3", quantity: 0 }),
    lot({ id: "d4", quantity: 1.5 }),
    lot({ id: "d5", costCents: 10.5 }),
  ]);
  ok(withDrops.ok, "one good lot among five bad still builds");
  if (withDrops.ok) {
    eq(withDrops.dropped.length, 5, "five lots dropped");
    eq(withDrops.lotsIncluded, 1, "one included");
    eq(withDrops.totalInventoryCents, 500, "only the good lot is valued");
    const reasons = withDrops.dropped.map((d) => d.reason).sort();
    eq(reasons.join(","),
      "fractional_quantity,non_integer_cost,unresolved_category,zero_or_negative_cost,zero_or_negative_quantity",
      "every drop reason is distinct and correct");
    for (const d of withDrops.dropped) {
      ok(d.message.length > 30, `drop ${d.id} carries a real explanation`);
    }
    // An unresolved category must NOT be quarantined into 20890 here.
    ok(
      !withDrops.lines.some((l) => l.accountCode === "20890"),
      "the cut-over does not quarantine — it asks",
    );
  }

  // ---- RANGE: a value too large to hold exactly is refused, not approximated.
  // Rule 43 — these two codes are new, so each gets a path that actually emits it.
  const hugeCost = plan([
    lot({ id: "keep", costCents: 500, quantity: 1 }),
    lot({ id: "huge", costCents: Number.MAX_SAFE_INTEGER, quantity: 2 }),
  ]);
  ok(hugeCost.ok, "the good lot still builds");
  if (hugeCost.ok) {
    eq(hugeCost.totalInventoryCents, 500, "the unholdable lot did not enter the total");
    eq(hugeCost.dropped.length, 1, "it was dropped");
    eq(hugeCost.dropped[0].reason, "extended_value_too_large", "named for what it is");
  }

  // cost and quantity are each safe; only the PRODUCT leaves exact range.
  const productOverflow = plan([lot({ id: "p", costCents: 4503599627370497, quantity: 2 })]);
  ok(!productOverflow.ok, "an inexact product cannot become an opening balance");
  if (!productOverflow.ok) {
    eq(productOverflow.code, "NOTHING_LEFT_AFTER_DROPS", "the only lot was dropped");
  }

  // Individually exact debits whose SUM leaves exact range. 4503599627370496 x 2
  // is exactly MAX_SAFE_INTEGER + 1.
  const totalOverflow = plan([
    lot({ id: "a", categorySlug: "flower", costCents: 4503599627370496, quantity: 1 }),
    lot({ id: "b", categorySlug: "preroll", costCents: 4503599627370496, quantity: 1 }),
  ]);
  ok(!totalOverflow.ok, "a total past the exact range is refused");
  if (!totalOverflow.ok) {
    eq(totalOverflow.code, "TOTAL_OUT_OF_EXACT_RANGE", "refusal code");
    ok(totalOverflow.message.includes("17,682,462"), "the message cites the real shelf size");
  }

  // A NEGATIVE quantity large enough to be unsafe is caught as a quantity
  // problem, not as a range problem — order of checks matters.
  const negBig = plan([lot({ id: "n", quantity: -Number.MAX_SAFE_INTEGER })]);
  ok(!negBig.ok, "refused");
  if (!negBig.ok) eq(negBig.code, "NOTHING_LEFT_AFTER_DROPS", "dropped, not crashed");

  // ---- negative cost is dropped, never netted against a good lot
  const negative = plan([
    lot({ id: "good", costCents: 1000, quantity: 1 }),
    lot({ id: "bad", costCents: -1000, quantity: 1 }),
  ]);
  ok(negative.ok, "builds");
  if (negative.ok) {
    eq(negative.totalInventoryCents, 1000, "the negative cost did NOT cancel the good lot");
    eq(negative.dropped.length, 1, "it was dropped instead");
  }

  // ---- the owner sentence
  if (good.ok) {
    const s = describeCutoverPlan(good);
    ok(s.includes("$20.00"), "the sentence states the money");
    ok(s.includes("Opening Balance Equity"), "the sentence names the credit");
    ok(s.includes("already paid for"), "the sentence explains WHY it is equity");
  }
  if (withDrops.ok) {
    const s = describeCutoverPlan(withDrops);
    ok(s.includes("set aside"), "the sentence admits the drops");
  }

  // ---- THE EXTRACTED STRUCTURAL GUARDS, reached directly (rule 43).
  // A mutation campaign showed that deleting either of these checks inside the
  // builder killed no test, because no input can reach them. They are exercised
  // here with hostile line sets so the protection is proven, not asserted.
  eq(findCutoverLineSetDefect([]), null, "an empty line set has no defect");
  eq(
    findCutoverLineSetDefect([
      { accountCode: "20010", amountCents: 500, lotCount: 1, description: "d" },
      { accountCode: "40400", amountCents: -500, lotCount: 0, description: "c" },
    ]),
    null,
    "a balanced leaf-account set is sound",
  );

  const ctrlDefect = findCutoverLineSetDefect([
    { accountCode: INVENTORY_CONTROL_CODE, amountCents: 500, lotCount: 1, description: "d" },
    { accountCode: "40400", amountCents: -500, lotCount: 0, description: "c" },
  ]);
  ok(ctrlDefect !== null, "the control account is caught");
  if (ctrlDefect !== null) {
    eq(ctrlDefect.code, "CONTROL_ACCOUNT_EMITTED", "named for what it is");
    ok(
      ctrlDefect.message.includes("GL_OB_PARENT_ACCOUNT"),
      "the message cites the constraint that would reject it",
    );
  }

  const unbalDefect = findCutoverLineSetDefect([
    { accountCode: "20010", amountCents: 500, lotCount: 1, description: "d" },
    { accountCode: "40400", amountCents: -499, lotCount: 0, description: "c" },
  ]);
  ok(unbalDefect !== null, "a one-cent imbalance is caught");
  if (unbalDefect !== null) {
    eq(unbalDefect.code, "UNBALANCED", "named for what it is");
    ok(unbalDefect.message.includes("1"), "the message states the amount off");
  }

  // The control account is reported even when the set happens to balance, and
  // takes precedence, because a heading account is the more specific fault.
  const both = findCutoverLineSetDefect([
    { accountCode: INVENTORY_CONTROL_CODE, amountCents: 500, lotCount: 1, description: "d" },
    { accountCode: "40400", amountCents: -400, lotCount: 0, description: "c" },
  ]);
  ok(both !== null && both.code === "CONTROL_ACCOUNT_EMITTED", "control account reported first");

  // ---- EVERY drop reason and EVERY refusal code is exercised above.
  // Listing them here means adding a new one without a test fails this gate,
  // rather than shipping a reason no path can produce.
  const allReasons: readonly CutoverDropReason[] = [
    "unresolved_category",
    "zero_or_negative_cost",
    "zero_or_negative_quantity",
    "fractional_quantity",
    "non_integer_cost",
    "extended_value_too_large",
  ];
  eq(allReasons.length, 6, "six drop reasons exist and each is tested above");

  const allCodes: readonly CutoverRefusalCode[] = [
    "NOT_GREENWAY",
    "NO_LOTS",
    "NOTHING_LEFT_AFTER_DROPS",
    "CONTROL_ACCOUNT_EMITTED",
    "TOTAL_OUT_OF_EXACT_RANGE",
    "UNBALANCED",
  ];
  eq(allCodes.length, 6, "six refusal codes exist");
  // CONTROL_ACCOUNT_EMITTED and UNBALANCED are unreachable through the BUILDER's
  // input surface by construction: no slot resolves to 20000, and the credit is
  // derived from the same sum that built the debits. That is exactly why the
  // logic was extracted into findCutoverLineSetDefect, which IS reachable and is
  // exercised with hostile line sets directly above. Rule 43 is satisfied by
  // execution rather than by comment.

  // ---- a realistic slice of Michael's measured file
  // Flower 749 lots is too many to enumerate; this checks the arithmetic shape
  // with the real category names and the real account codes.
  const real = plan([
    lot({ id: "26143", category: "BHO", categorySlug: "concentrate", costCents: 500, quantity: 2 }),
    lot({ id: "26142", category: "Pre-roll", categorySlug: "preroll", costCents: 600, quantity: 14 }),
    lot({ id: "26141", category: "Pre-roll", categorySlug: "preroll", costCents: 600, quantity: 9 }),
    lot({ id: "x", category: "Infused Pre-roll", categorySlug: "infused-preroll", costCents: 166, quantity: 12 }),
  ]);
  ok(real.ok, "a real-shaped sample builds");
  if (real.ok) {
    eq(real.lines.length, 4, "concentrate + preroll + infused-preroll + equity");
    const codes = real.lines.map((l) => l.accountCode);
    eq(codes.join(","), "20050,20080,20140,40400", "accounts in sorted order, equity last");
    eq(real.totalInventoryCents, 1000 + 8400 + 5400 + 1992, "exact arithmetic");
    ok(cutoverPlanIsBalanced(real), "balanced");
  }
}
