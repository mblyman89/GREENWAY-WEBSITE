/**
 * src/lib/accounting/coa-core.ts — Chart of accounts (PURE core, slice F2).
 *
 * No I/O, no network, no server-only imports. Mirrored in vitest and registered
 * in scripts/compliance/run-pure-selftests.ts.
 *
 * WHY THIS EXISTS
 * ---------------
 * Michael's Sage chart of accounts drifted into an unusable state, and the
 * failure was structural, not personal. Measured from his own exports:
 *
 *   * 8 of 11 inventory accounts carried CREDIT balances (impossible for an
 *     asset), summing to -4,388,348.06.
 *   * "20009 LAZY INVENTORY ENTRY" held +4,624,697.31 — 105.4% of that hole.
 *   * 511 of 595 purchase lines (86%, $479,303.51) posted to that one account.
 *   * 164 of 492 vendors defaulted to it; 145 vendors had no default at all.
 *   * 18 accounts were tagged "GRWNY", a typo of "GRNWY", silently dropping the
 *     entire payroll-expense block out of any suffix-filtered report.
 *
 * Root cause, confirmed by the owner: Sage required an inventory ITEM per lot
 * code before goods could be received. Cannabis has no UPCs and every intake
 * carries its own lot code, so per-SKU setup was impossible at volume. Separately,
 * twelve years of mis-computed 37% excise were cleared by debiting A/P and
 * crediting REVENUE, because there was nowhere else to put it. The plug was the
 * one number that hid both problems.
 *
 * THE FIX, IN THREE RULES
 * -----------------------
 * 1. The account code answers WHAT. Dimensions answer WHO / WHERE / WHICH.
 *    (Deloitte: "If the value of a segment can be derived from another, then it
 *    should not be a unique segment.") Entity, employee, vendor, card, ticker,
 *    lot code and month are DIMENSIONS — never account codes.
 * 2. Inventory is broken out by all 21 house categories, and lot/strain/vendor/
 *    SKU live in the subledger. Intake creates a LOT, not an account, so the
 *    chart stops growing.
 * 3. Nothing classifies itself. Suggestions are drafts and proposed accounts
 *    cannot be posted to. (Owner directive: "block everything, gate everything".)
 *
 * MONEY RULE (standing): integer CENTS, never a float.
 * RATE RULE (standing): integer MILLI-PERCENT (85% = 85000).
 */

import type { AccountType, CostClass, EntityCode, NormalBalance } from "./ledger-core";

// ---------------------------------------------------------------------------
// 0) Types — mirrored exactly from migration 0173.
// ---------------------------------------------------------------------------

/** Subledgers that may own a control account. Mirrors 0172's CHECK list. */
export type ControlSubledger =
  | "ap"
  | "ar"
  | "inventory"
  | "payroll"
  | "excise"
  | "sales"
  | "cash"
  | "loans"
  | "crypto";

export type CoaAccountSeed = {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  isContra?: boolean;
  isControl?: boolean;
  controlSubledger?: ControlSubledger | null;
  requiresCostClass?: boolean;
  defaultCostClass?: CostClass;
  allowedEntityCodes?: EntityCode[] | null;
  isSystem?: boolean;
  parentCode?: string | null;
  description?: string;
};

/**
 * The four entity codes, as a runtime list.
 *
 * EntityCode is a compile-time union, which is worth nothing at 11pm when a
 * string arrives from a CSV import or a hand-typed admin form. The live Sage
 * chart had 18 accounts tagged "GRWNY" instead of "GRNWY" -- including the whole
 * payroll block -- and nothing ever complained; those accounts simply stopped
 * appearing in entity-filtered reports. So the codes exist as DATA that can be
 * checked at runtime, not only as a type the compiler erases.
 *
 * Mirrors the seeded rows of gl_entities in migration 0172.
 */
export const ENTITY_CODES: readonly EntityCode[] = [
  "greenway",
  "atm",
  "landholding",
  "personal",
] as const;

/** How an old Sage account is disposed of in the new chart. */
export type MappingDisposition =
  | "rename"      // 1:1 carry across into the new numbering
  | "merge"       // folded into a shared account; detail becomes a dimension
  | "split"       // one old account explodes across many new ones
  | "retire"      // never used, or superseded; no balance carries
  | "quarantine"; // needs a human decision before anything moves

// ---------------------------------------------------------------------------
// 1) Numbering rules
// ---------------------------------------------------------------------------

/**
 * The nine blocks. Michael's own 1-7 structure is standard practice and is KEPT
 * verbatim. Blocks 8 and 9 change meaning: he used them for ATM/landholding and
 * personal, but those are ENTITIES, and F1 put entity_id on every journal line.
 * Encoding entity in the number is what gave him four different "Accounts
 * Payable" accounts that could never be compared.
 */
export const COA_BLOCKS = {
  1: { name: "Cash & current assets", types: ["asset"] as AccountType[] },
  2: { name: "Inventory & other assets", types: ["asset"] as AccountType[] },
  3: { name: "Liabilities", types: ["liability"] as AccountType[] },
  4: { name: "Equity", types: ["equity"] as AccountType[] },
  5: { name: "Revenue", types: ["income"] as AccountType[] },
  6: { name: "Cost of goods sold", types: ["cogs"] as AccountType[] },
  7: { name: "Operating expenses", types: ["expense"] as AccountType[] },
  8: {
    name: "Other income & expense",
    types: ["other_income", "other_expense"] as AccountType[],
  },
  9: { name: "Statistical / memo", types: ["expense"] as AccountType[] },
} as const;

export type BlockNumber = keyof typeof COA_BLOCKS;

/** Account codes are exactly 5 digits. No suffixes — the suffix WAS the bug. */
export function isValidAccountCode(code: string): boolean {
  return /^[1-9][0-9]{4}$/.test(code);
}

export function blockOf(code: string): BlockNumber | null {
  if (!isValidAccountCode(code)) return null;
  return Number(code[0]) as BlockNumber;
}

/**
 * An account's type must be legal for its block. This is what stops the single
 * most damaging thing Michael did by accident: crediting REVENUE to clear an
 * excise/AP true-up. Excise is a liability (block 3) and can never wear a 5xxxx
 * code, so the mistake becomes unrepresentable rather than merely discouraged.
 */
export function blockAllowsType(code: string, type: AccountType): boolean {
  const block = blockOf(code);
  if (block === null) return false;
  return (COA_BLOCKS[block].types as readonly AccountType[]).includes(type);
}

/**
 * Normal balance is DERIVED from type, flipped for contra accounts. Mirrors
 * gl_guard_account_normal_balance() in 0172 exactly.
 */
export function expectedNormalBalance(type: AccountType, isContra = false): NormalBalance {
  const base: NormalBalance =
    type === "asset" || type === "cogs" || type === "expense" || type === "other_expense"
      ? "debit"
      : "credit";
  if (!isContra) return base;
  return base === "debit" ? "credit" : "debit";
}

// ---------------------------------------------------------------------------
// 2) The 21 house inventory categories
// ---------------------------------------------------------------------------

/**
 * Michael: "For inventory, I want details down to the category, not just the
 * type, I want every category to be mapped and recorded separately."
 *
 * GROUNDED IN FACT: these are lifted from the repo's own
 * src/lib/pos/category-taxonomy.ts — the taxonomy that already drives the POS
 * import pipeline, the public menu and intake. Nothing here is invented.
 *
 * The `slot` is the last three digits, and it is REUSED across blocks 2, 5 and 6
 * on purpose: 20140 Inventory-Concentrate / 50140 Sales-Concentrate /
 * 60140 COGS-Concentrate. Gross margin by category becomes a subtraction.
 */
export type InventoryCategorySeed = {
  slug: string;
  label: string;
  slot: number;
  /** False for accessories/paraphernalia/merch: not cannabis, not 280E product. */
  isCannabis: boolean;
};

export const INVENTORY_CATEGORIES: InventoryCategorySeed[] = [
  { slug: "flower", label: "Flower", slot: 10, isCannabis: true },
  { slug: "popcorn-bud", label: "Popcorn Bud", slot: 20, isCannabis: true },
  { slug: "infused-flower", label: "Infused Flower", slot: 30, isCannabis: true },
  { slug: "trim", label: "Trim", slot: 40, isCannabis: true },
  { slug: "preroll", label: "Preroll", slot: 50, isCannabis: true },
  { slug: "preroll-pack", label: "Preroll Pack", slot: 60, isCannabis: true },
  { slug: "blunt", label: "Blunt", slot: 70, isCannabis: true },
  { slug: "infused-preroll", label: "Infused Preroll", slot: 80, isCannabis: true },
  { slug: "infused-preroll-pack", label: "Infused Preroll Pack", slot: 90, isCannabis: true },
  { slug: "infused-blunt", label: "Infused Blunt", slot: 100, isCannabis: true },
  { slug: "cartridge", label: "Cartridge", slot: 120, isCannabis: true },
  { slug: "disposable-cartridge", label: "Disposable Cartridge", slot: 130, isCannabis: true },
  { slug: "concentrate", label: "Concentrate", slot: 140, isCannabis: true },
  { slug: "rso", label: "RSO", slot: 150, isCannabis: true },
  { slug: "edible-solid", label: "Edible (Solid)", slot: 160, isCannabis: true },
  { slug: "edible-liquid", label: "Edible (Liquid)", slot: 170, isCannabis: true },
  { slug: "tincture", label: "Tincture", slot: 180, isCannabis: true },
  { slug: "topical", label: "Topical", slot: 190, isCannabis: true },
  { slug: "accessories", label: "Accessories", slot: 200, isCannabis: false },
  { slug: "paraphernalia", label: "Paraphernalia", slot: 210, isCannabis: false },
  { slug: "merch", label: "Greenway Merch", slot: 220, isCannabis: false },
];

/**
 * A slot becomes the FOUR digits after the block digit, zero-padded: slot 140 in
 * block 2 is "2" + "0140" = 20140. Slots step by 10 so a sibling can always be
 * inserted between two existing accounts without renumbering a live chart
 * (Deloitte: leave digit headroom; never renumber).
 */
const pad4 = (n: number): string => String(n).padStart(4, "0");

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot > 9999) {
    throw new Error(`Invalid account slot ${slot}: must be an integer 0..9999.`);
  }
}

export function inventoryAccountCode(slot: number): string {
  assertSlot(slot);
  return `2${pad4(slot)}`;
}
export function revenueAccountCode(slot: number): string {
  assertSlot(slot);
  return `5${pad4(slot)}`;
}
export function cogsAccountCode(slot: number): string {
  assertSlot(slot);
  return `6${pad4(slot)}`;
}

/**
 * The mirroring guarantee: for any category, the inventory, revenue and COGS
 * codes share their last four digits. Michael can read a margin off the page.
 *
 * TAKES THREE ACTUAL CODES, not one slot. An earlier version took a single slot
 * and derived all three codes from it, so it compared each code against itself
 * and could NEVER return false — a sweep of all 10,000 legal slots produced zero
 * failures. That is a test that cannot fail, which is worse than no test at all
 * (standing rule 13c): it would have cheerfully blessed a chart whose revenue
 * account had drifted away from its inventory account. This version compares the
 * three codes actually present in the chart, so a real mismatch is caught.
 */
export function categoryCodesAreMirrored(
  inventoryCode: string,
  revenueCode: string,
  cogsCode: string,
): boolean {
  if (
    !isValidAccountCode(inventoryCode) ||
    !isValidAccountCode(revenueCode) ||
    !isValidAccountCode(cogsCode)
  ) {
    return false;
  }
  // Each code must sit in its own block, or the "mirror" is meaningless.
  if (inventoryCode[0] !== "2" || revenueCode[0] !== "5" || cogsCode[0] !== "6") {
    return false;
  }
  return (
    inventoryCode.slice(1) === revenueCode.slice(1) &&
    revenueCode.slice(1) === cogsCode.slice(1)
  );
}

// ---------------------------------------------------------------------------
// 3) Default 280E cost class
// ---------------------------------------------------------------------------

/**
 * Which 280E class a line gets by DEFAULT, from the account and the entity.
 * Making this structural is the point: Michael should not be re-deciding the tax
 * character of a dollar on every transaction.
 *
 * OWNER DECISION (Aug 2026): payroll currently classed into COGS stays that way
 * for now — his grandfather's method, pending federal rescheduling — but is
 * tagged `cogs_allocable`, never `cogs_direct`. That keeps the position VISIBLE
 * and makes reclassification a query rather than a rebuild, satisfying standing
 * rule 8 (280E relief must be a switch, not a re-do).
 *
 * Note the asymmetry: only the `greenway` entity is exposed to 280E. The ATM and
 * landholding activities are genuinely separate trades or businesses (CHAMP), so
 * their operating costs are ordinary deductions.
 */
export function defaultCostClass(
  type: AccountType,
  entity: EntityCode,
  opts: { isCannabisProduct?: boolean; isAllocablePayroll?: boolean } = {},
): CostClass {
  // Balance-sheet accounts never carry 280E character. 0172 enforces this too.
  if (type === "asset" || type === "liability" || type === "equity") return "none";

  if (entity === "personal") return "personal";
  if (entity === "atm" || entity === "landholding") return "separate_business";

  // greenway
  if (type === "cogs") {
    if (opts.isAllocablePayroll) return "cogs_allocable";
    return "cogs_direct";
  }
  if (type === "income" || type === "other_income") return "none";
  return "nondeductible_280e";
}

// ---------------------------------------------------------------------------
// 4) Account validation
// ---------------------------------------------------------------------------

export type ValidationIssue = { field: string; message: string };

/**
 * Validate a single account definition. Every rule here is mirrored by a
 * constraint or trigger in the database, because a UI can be bypassed and a
 * constraint cannot.
 */
export function validateAccount(a: CoaAccountSeed): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isValidAccountCode(a.code)) {
    issues.push({
      field: "code",
      message: `Account code "${a.code}" must be exactly 5 digits starting 1-9. Entity suffixes like "-GRNWY" are not allowed — entity is a dimension, not part of the code. (18 of the old accounts were silently mis-tagged "GRWNY".)`,
    });
  }

  if (!a.name || a.name.trim().length < 3) {
    issues.push({ field: "name", message: "Account name must be at least 3 characters." });
  }

  if (isValidAccountCode(a.code) && !blockAllowsType(a.code, a.type)) {
    const block = blockOf(a.code) as BlockNumber;
    issues.push({
      field: "type",
      message: `Account ${a.code} is in block ${block} (${COA_BLOCKS[block].name}), which cannot hold type "${a.type}". This is the rule that makes it impossible to credit excise tax to a revenue account.`,
    });
  }

  const expected = expectedNormalBalance(a.type, a.isContra ?? false);
  if (a.normalBalance !== expected) {
    issues.push({
      field: "normalBalance",
      message: `A ${a.isContra ? "contra-" : ""}${a.type} account must have a ${expected} normal balance, not ${a.normalBalance}.`,
    });
  }

  // Control-account pairing — mirrors gl_accounts_control_subledger_pair.
  const isControl = a.isControl ?? false;
  const sub = a.controlSubledger ?? null;
  if (isControl && !sub) {
    issues.push({
      field: "controlSubledger",
      message: "A control account must name the subledger it controls.",
    });
  }
  if (!isControl && sub) {
    issues.push({
      field: "controlSubledger",
      message: "Only a control account may name a subledger.",
    });
  }

  // 280E tagging must match the account's side of the books.
  const isPnl =
    a.type === "income" ||
    a.type === "cogs" ||
    a.type === "expense" ||
    a.type === "other_income" ||
    a.type === "other_expense";
  if (a.requiresCostClass && !isPnl) {
    issues.push({
      field: "requiresCostClass",
      message: `Balance-sheet account ${a.code} must not require a 280E cost class.`,
    });
  }
  if (a.defaultCostClass && a.defaultCostClass !== "none" && !isPnl) {
    issues.push({
      field: "defaultCostClass",
      message: `Balance-sheet account ${a.code} must not carry a default cost class.`,
    });
  }

  // REVENUE CARRIES NO 280E CHARACTER.
  // Sec. 280E denies "any deduction or credit". Income is not a deduction: it is
  // the thing deductions are subtracted from. Asking for the 280E character of a
  // sale is a meaningless question, and a meaningless question asked on every
  // sale gets a meaningless answer.
  // Mirrors gl_accounts_income_no_cost_class_chk in migration 0173.
  const isIncome = a.type === "income" || a.type === "other_income";
  if (isIncome && a.requiresCostClass) {
    issues.push({
      field: "requiresCostClass",
      message: `Revenue account ${a.code} must not require a 280E cost class. 280E disallows deductions; revenue is not a deduction.`,
    });
  }
  if (isIncome && a.defaultCostClass && a.defaultCostClass !== "none") {
    issues.push({
      field: "defaultCostClass",
      message: `Revenue account ${a.code} must not carry a 280E cost class.`,
    });
  }

  // COGS IS NEVER NON-DEDUCTIBLE.
  // A cost is either includible in inventory under Sec. 471 as it stood in 1982
  // (CCA 201504011), or it is a deduction disallowed by 280E. It cannot be both,
  // and an account claiming both is the row that loses a 280E audit.
  // Mirrors gl_accounts_cogs_cost_class_chk in migration 0173.
  if (a.type === "cogs") {
    const cc = a.defaultCostClass ?? "none";
    if (cc !== "cogs_direct" && cc !== "cogs_allocable") {
      issues.push({
        field: "defaultCostClass",
        message: `COGS account ${a.code} has cost class "${cc}". Cost of goods sold is an adjustment to gross income, never a disallowed deduction — it must be cogs_direct or cogs_allocable.`,
      });
    }
  }

  // THE "GRWNY" RULE. An entity restriction must name real entities, and an
  // EMPTY list must never be used to mean "unrestricted": an empty list forbids
  // every entity, which silently hides the account from every filtered report.
  // That is exactly the failure mode that hid 18 live accounts for years.
  // Mirrors gl_guard_account_entity_codes() in migration 0173.
  if (a.allowedEntityCodes !== undefined && a.allowedEntityCodes !== null) {
    if (a.allowedEntityCodes.length === 0) {
      issues.push({
        field: "allowedEntityCodes",
        message: `Account ${a.code} has an empty entity restriction. Use null to mean "any entity"; an empty list forbids every entity and hides the account.`,
      });
    }
    for (const code of a.allowedEntityCodes) {
      if (!ENTITY_CODES.includes(code)) {
        issues.push({
          field: "allowedEntityCodes",
          message: `Account ${a.code} is restricted to unknown entity "${code}". Known entities: ${ENTITY_CODES.join(", ")}.`,
        });
      }
    }
  }

  if (a.parentCode && !isValidAccountCode(a.parentCode)) {
    issues.push({ field: "parentCode", message: `Parent code "${a.parentCode}" is not a valid account code.` });
  }
  if (a.parentCode && a.parentCode === a.code) {
    issues.push({ field: "parentCode", message: "An account cannot be its own parent." });
  }
  if (a.parentCode && blockOf(a.parentCode) !== blockOf(a.code)) {
    issues.push({
      field: "parentCode",
      message: `Account ${a.code} cannot roll up to ${a.parentCode}: a child must live in its parent's block.`,
    });
  }

  return issues;
}

/** Validate a whole chart, including cross-account uniqueness. */
export function validateChart(accounts: CoaAccountSeed[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, number>();

  for (const a of accounts) {
    for (const i of validateAccount(a)) {
      issues.push({ field: `${a.code}.${i.field}`, message: i.message });
    }
    seen.set(a.code, (seen.get(a.code) ?? 0) + 1);
  }

  for (const [code, n] of seen) {
    if (n > 1) {
      issues.push({ field: `${code}.code`, message: `Account code ${code} is defined ${n} times.` });
    }
  }

  const codes = new Set(accounts.map((a) => a.code));
  for (const a of accounts) {
    if (a.parentCode && !codes.has(a.parentCode)) {
      issues.push({ field: `${a.code}.parentCode`, message: `Parent ${a.parentCode} does not exist.` });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 5) Classification scoring — the "draft it for me" engine
// ---------------------------------------------------------------------------

/**
 * Michael: "New purchases that haven't been seen by the system before get a new
 * account created and a drafted report for how to classify it... I can do what
 * accountants do best, validate and audit data."
 *
 * This is a DELIBERATELY TRANSPARENT weighted-rule engine, not a black box.
 * Michael holds a master's in accounting and his grandfather (a CPA) audits the
 * result — both must be able to see exactly why a suggestion was made.
 *
 * Weights are INTEGER MILLI-PERCENT. Floats are forbidden in this path: in F1 a
 * floating-point division silently moved a penny between shareholders, and that
 * class of bug is invisible to code review.
 */
export type ClassificationSignal =
  | "owner_rule_exact"
  | "prior_decision"
  | "vendor_match"
  | "licensed_cannabis_vendor"
  | "pfc_unique_map"
  | "account_role_entity"
  | "recurring_amount";

export const SIGNAL_WEIGHTS: Record<ClassificationSignal, number> = {
  owner_rule_exact: 60000,
  prior_decision: 25000,
  licensed_cannabis_vendor: 20000,
  vendor_match: 15000,
  pfc_unique_map: 10000,
  account_role_entity: 10000,
  recurring_amount: 5000,
};

export const CONFIDENCE_MAX = 100000;
export const CONFIDENCE_CONFIDENT = 80000;
export const CONFIDENCE_BEST_GUESS = 40000;

export type ConfidenceBand = "confident" | "best_guess" | "unknown";

/**
 * Sum signal weights, capped at 100%. Integer arithmetic only.
 * Duplicate signals are counted ONCE — otherwise a noisy matcher could stack the
 * same evidence to fake certainty.
 */
export function scoreConfidence(signals: ClassificationSignal[]): number {
  const unique = new Set(signals);
  let total = 0;
  for (const s of unique) total += SIGNAL_WEIGHTS[s] ?? 0;
  return total > CONFIDENCE_MAX ? CONFIDENCE_MAX : total;
}

export function confidenceBand(milliPct: number): ConfidenceBand {
  if (!Number.isInteger(milliPct) || milliPct < 0 || milliPct > CONFIDENCE_MAX) {
    throw new Error(
      `confidenceBand: confidence must be an integer 0..${CONFIDENCE_MAX} milli-percent, got ${milliPct}`,
    );
  }
  if (milliPct >= CONFIDENCE_CONFIDENT) return "confident";
  if (milliPct >= CONFIDENCE_BEST_GUESS) return "best_guess";
  return "unknown";
}

/**
 * THE GATE. No confidence level, ever, permits an automatic post.
 *
 * Michael: "no asking, hard no! Block everything, gate everything lock
 * everything." Standing rule 14: when a rule could be a warning or a refusal,
 * choose refusal. This function exists so that the answer is a single, testable
 * `false` rather than a policy scattered across the UI.
 */
export function mayAutoPost(): false {
  return false;
}

/**
 * Whether a suggestion is even allowed to be OFFERED for a given account.
 * Control accounts belong to their subledger; a 100%-confidence suggestion into
 * one is still refused, because that is precisely how a $4.6M plug is born.
 */
export function suggestionAllowedForAccount(a: Pick<CoaAccountSeed, "isControl" | "code">): {
  ok: boolean;
  reason?: string;
} {
  if (a.isControl) {
    return {
      ok: false,
      reason: `Account ${a.code} is a control account owned by its subledger. Classify the underlying transaction instead — control accounts never accept a suggested journal.`,
    };
  }
  return { ok: true };
}

/** Normalize a merchant string for rule matching. Stable, diacritic-tolerant. */
export function normalizeMerchant(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 6) Self-tests
// ---------------------------------------------------------------------------

function expect(label: string, cond: boolean): void {
  if (!cond) throw new Error(`coa-core self-test FAILED: ${label}`);
}
function eq<T>(actual: T, want: T, label: string): void {
  if (actual !== want) {
    throw new Error(`coa-core self-test FAILED: ${label} — expected ${String(want)}, got ${String(actual)}`);
  }
}

export function __runCoaCoreTests(): void {
  // --- codes -------------------------------------------------------------
  expect("5-digit code valid", isValidAccountCode("20140"));
  expect("suffix code rejected", !isValidAccountCode("20140-GRNWY"));
  expect("GRWNY typo shape rejected", !isValidAccountCode("71000-GRWNY"));
  expect("4-digit rejected", !isValidAccountCode("2014"));
  expect("6-digit rejected", !isValidAccountCode("201400"));
  expect("leading zero rejected", !isValidAccountCode("01234"));
  expect("empty rejected", !isValidAccountCode(""));
  expect("non-numeric rejected", !isValidAccountCode("2O140"));
  eq(blockOf("20140"), 2 as BlockNumber, "block of 20140");
  eq(blockOf("60140"), 6 as BlockNumber, "block of 60140");
  eq(blockOf("bogus"), null, "block of invalid code");

  // --- block/type ---------------------------------------------------------
  expect("inventory asset in block 2", blockAllowsType("20140", "asset"));
  expect("revenue in block 5", blockAllowsType("50140", "income"));
  expect("cogs in block 6", blockAllowsType("60140", "cogs"));
  // The single most important guard in this file:
  expect("liability CANNOT wear a 5xxxx code", !blockAllowsType("50090", "liability"));
  expect("income CANNOT wear a 3xxxx code", !blockAllowsType("32000", "income"));
  expect("cogs cannot sit in block 7", !blockAllowsType("70000", "cogs"));

  // --- normal balance -----------------------------------------------------
  eq(expectedNormalBalance("asset"), "debit", "asset debit");
  eq(expectedNormalBalance("liability"), "credit", "liability credit");
  eq(expectedNormalBalance("income"), "credit", "income credit");
  eq(expectedNormalBalance("cogs"), "debit", "cogs debit");
  eq(expectedNormalBalance("income", true), "debit", "contra-income debit");
  eq(expectedNormalBalance("asset", true), "credit", "contra-asset credit");

  // --- the 21 categories --------------------------------------------------
  eq(INVENTORY_CATEGORIES.length, 21, "21 house categories");
  {
    const slugs = new Set(INVENTORY_CATEGORIES.map((c) => c.slug));
    eq(slugs.size, 21, "category slugs unique");
    const slots = new Set(INVENTORY_CATEGORIES.map((c) => c.slot));
    eq(slots.size, 21, "category slots unique");
    eq(INVENTORY_CATEGORIES.filter((c) => c.isCannabis).length, 18, "18 cannabis categories");
    eq(INVENTORY_CATEGORIES.filter((c) => !c.isCannabis).length, 3, "3 non-cannabis categories");
  }

  // Mirroring must hold for EVERY category, not one happy example (Rule 13d).
  for (const c of INVENTORY_CATEGORIES) {
    expect(
      `codes mirrored for ${c.slug}`,
      categoryCodesAreMirrored(
        inventoryAccountCode(c.slot),
        revenueAccountCode(c.slot),
        cogsAccountCode(c.slot),
      ),
    );
    expect(`inv code valid ${c.slug}`, isValidAccountCode(inventoryAccountCode(c.slot)));
    expect(`rev code valid ${c.slug}`, isValidAccountCode(revenueAccountCode(c.slot)));
    expect(`cogs code valid ${c.slug}`, isValidAccountCode(cogsAccountCode(c.slot)));
    expect(`inv in block 2 ${c.slug}`, blockAllowsType(inventoryAccountCode(c.slot), "asset"));
    expect(`rev in block 5 ${c.slug}`, blockAllowsType(revenueAccountCode(c.slot), "income"));
    expect(`cogs in block 6 ${c.slug}`, blockAllowsType(cogsAccountCode(c.slot), "cogs"));
  }
  // THE MIRROR MUST BE ABLE TO FAIL. These are the cases that proved the old
  // single-slot version was a tautology (rule 13c: a test that cannot fail is
  // worse than no test).
  expect("mirror rejects a drifted revenue code", !categoryCodesAreMirrored("20140", "50150", "60140"));
  expect("mirror rejects a drifted cogs code", !categoryCodesAreMirrored("20140", "50140", "60150"));
  expect("mirror rejects a drifted inventory code", !categoryCodesAreMirrored("20150", "50140", "60140"));
  expect("mirror rejects codes in the wrong block", !categoryCodesAreMirrored("50140", "50140", "60140"));
  expect("mirror rejects a malformed code", !categoryCodesAreMirrored("2014", "50140", "60140"));
  expect("mirror rejects a Sage-style suffix", !categoryCodesAreMirrored("20140-GRNWY", "50140", "60140"));
  expect("mirror accepts a true mirror", categoryCodesAreMirrored("20140", "50140", "60140"));

  eq(inventoryAccountCode(140), "20140", "concentrate inventory code");
  eq(revenueAccountCode(140), "50140", "concentrate revenue code");
  eq(cogsAccountCode(140), "60140", "concentrate cogs code");
  eq(inventoryAccountCode(10), "20010", "flower inventory code");
  eq(inventoryAccountCode(0), "20000", "slot 0 = the control account code");
  eq(inventoryAccountCode(9999), "29999", "max slot");
  // This builder produced 21400 instead of 20140 on the first run. Execution
  // caught it; code review had not. Boundary tests stay so it cannot regress.
  for (const bad of [-1, 10000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    let threw = false;
    try { inventoryAccountCode(bad); } catch { threw = true; }
    expect(`slot ${String(bad)} rejected`, threw);
  }

  // --- cost class ---------------------------------------------------------
  eq(defaultCostClass("asset", "greenway"), "none", "asset no cost class");
  eq(defaultCostClass("liability", "greenway"), "none", "liability no cost class");
  eq(defaultCostClass("expense", "greenway"), "nondeductible_280e", "greenway opex is 280E");
  eq(defaultCostClass("cogs", "greenway"), "cogs_direct", "greenway cogs direct");
  eq(
    defaultCostClass("cogs", "greenway", { isAllocablePayroll: true }),
    "cogs_allocable",
    "payroll-in-cogs is allocable, never direct (owner decision, reviewable)",
  );
  eq(defaultCostClass("expense", "atm"), "separate_business", "atm is a separate business");
  eq(defaultCostClass("expense", "landholding"), "separate_business", "landholding separate");
  eq(defaultCostClass("expense", "personal"), "personal", "personal is personal");
  eq(defaultCostClass("income", "greenway"), "none", "revenue carries no cost class");

  // --- validation ---------------------------------------------------------
  {
    const good: CoaAccountSeed = {
      code: "20140",
      name: "Inventory — Concentrate",
      type: "asset",
      normalBalance: "debit",
    };
    eq(validateAccount(good).length, 0, "valid account has no issues");
  }
  {
    // The exact historical mistake: excise credited to revenue.
    const bad: CoaAccountSeed = {
      code: "50090",
      name: "Excise Tax Adjustments",
      type: "liability",
      normalBalance: "credit",
    };
    expect("excise-as-revenue refused", validateAccount(bad).some((i) => i.field === "type"));
  }
  {
    const bad: CoaAccountSeed = {
      code: "20140",
      name: "Inventory — Concentrate",
      type: "asset",
      normalBalance: "credit", // an asset can never be credit-normal
    };
    expect("wrong normal balance refused", validateAccount(bad).some((i) => i.field === "normalBalance"));
  }
  {
    const bad: CoaAccountSeed = {
      code: "20000",
      name: "Inventory — Cannabis",
      type: "asset",
      normalBalance: "debit",
      isControl: true, // control with no subledger
    };
    expect("control without subledger refused", validateAccount(bad).some((i) => i.field === "controlSubledger"));
  }
  {
    const bad: CoaAccountSeed = {
      code: "20140",
      name: "Inventory — Concentrate",
      type: "asset",
      normalBalance: "debit",
      controlSubledger: "inventory", // subledger without control
    };
    expect("subledger without control refused", validateAccount(bad).some((i) => i.field === "controlSubledger"));
  }
  {
    const bad: CoaAccountSeed = {
      code: "20140",
      name: "Inventory — Concentrate",
      type: "asset",
      normalBalance: "debit",
      requiresCostClass: true, // balance sheet must not
    };
    expect("balance-sheet cost class refused", validateAccount(bad).some((i) => i.field === "requiresCostClass"));
  }
  {
    const bad: CoaAccountSeed = {
      code: "20140",
      name: "Inventory — Concentrate",
      type: "asset",
      normalBalance: "debit",
      parentCode: "50000", // cross-block parent
    };
    expect("cross-block parent refused", validateAccount(bad).some((i) => i.field === "parentCode"));
  }
  {
    const bad: CoaAccountSeed = {
      code: "20140",
      name: "Inventory — Concentrate",
      type: "asset",
      normalBalance: "debit",
      parentCode: "20140", // self parent
    };
    expect("self parent refused", validateAccount(bad).some((i) => i.field === "parentCode"));
  }
  {
    const dupes: CoaAccountSeed[] = [
      { code: "20140", name: "Inventory — Concentrate", type: "asset", normalBalance: "debit" },
      { code: "20140", name: "Inventory — Concentrate (again)", type: "asset", normalBalance: "debit" },
    ];
    expect("duplicate codes refused", validateChart(dupes).some((i) => i.message.includes("defined 2 times")));
  }
  {
    const orphan: CoaAccountSeed[] = [
      { code: "20140", name: "Inventory — Concentrate", type: "asset", normalBalance: "debit", parentCode: "20000" },
    ];
    expect("missing parent refused", validateChart(orphan).some((i) => i.message.includes("does not exist")));
  }

  // --- confidence ---------------------------------------------------------
  eq(scoreConfidence([]), 0, "no signals = 0");
  eq(scoreConfidence(["owner_rule_exact"]), 60000, "owner rule 60%");
  eq(scoreConfidence(["owner_rule_exact", "prior_decision"]), 85000, "two signals add");
  eq(
    scoreConfidence(["owner_rule_exact", "owner_rule_exact", "owner_rule_exact"]),
    60000,
    "duplicate signals counted once (cannot fake certainty)",
  );
  eq(
    scoreConfidence([
      "owner_rule_exact",
      "prior_decision",
      "licensed_cannabis_vendor",
      "vendor_match",
      "pfc_unique_map",
      "account_role_entity",
      "recurring_amount",
    ]),
    CONFIDENCE_MAX,
    "confidence caps at 100%",
  );
  // Every weight must be a non-negative integer — no floats in this path.
  for (const [k, v] of Object.entries(SIGNAL_WEIGHTS)) {
    expect(`weight ${k} is integer`, Number.isInteger(v));
    expect(`weight ${k} non-negative`, v >= 0);
  }
  eq(confidenceBand(100000), "confident", "100% confident");
  eq(confidenceBand(80000), "confident", "80% boundary is confident");
  eq(confidenceBand(79999), "best_guess", "just under 80% is best guess");
  eq(confidenceBand(40000), "best_guess", "40% boundary is best guess");
  eq(confidenceBand(39999), "unknown", "just under 40% is unknown");
  eq(confidenceBand(0), "unknown", "0% unknown");
  {
    let threw = false;
    try { confidenceBand(100001); } catch { threw = true; }
    expect("confidence over 100% rejected", threw);
  }
  {
    let threw = false;
    try { confidenceBand(-1); } catch { threw = true; }
    expect("negative confidence rejected", threw);
  }
  {
    let threw = false;
    try { confidenceBand(50000.5); } catch { threw = true; }
    expect("fractional confidence rejected (no floats)", threw);
  }
  {
    let threw = false;
    try { confidenceBand(Number.NaN); } catch { threw = true; }
    expect("NaN confidence rejected", threw);
  }

  // --- the gates ----------------------------------------------------------
  eq(mayAutoPost(), false, "NOTHING may ever auto-post");
  expect(
    "control account refuses suggestions even at full confidence",
    !suggestionAllowedForAccount({ code: "20000", isControl: true }).ok,
  );
  expect(
    "ordinary account accepts suggestions",
    suggestionAllowedForAccount({ code: "70000", isControl: false }).ok,
  );

  // --- merchant normalization --------------------------------------------
  eq(normalizeMerchant("  Clarity  Farms  "), "CLARITY FARMS", "collapse whitespace");
  eq(normalizeMerchant("CLARITY FARMS #1234"), "CLARITY FARMS 1234", "strip punctuation");
  eq(normalizeMerchant("Café Ünicode"), "CAFE UNICODE", "strip diacritics");
  eq(normalizeMerchant("Robert'); DROP TABLE--"), "ROBERT DROP TABLE", "hostile input neutralized");
  eq(normalizeMerchant(""), "", "empty merchant safe");
  eq(
    normalizeMerchant("clarity farms"),
    normalizeMerchant("CLARITY FARMS"),
    "case-insensitive match",
  );

  // --- rules found by ATTACKING the real database -------------------------
  // Every check below exists because executing migration 0173 against real
  // PostgreSQL caught something that code review had passed. They are mirrored
  // here so the TypeScript layer and the SQL layer cannot drift apart.

  // 280E: revenue is not a deduction, so it has no 280E character.
  expect(
    "revenue account requiring a cost class is rejected",
    validateAccount({
      code: "50010",
      name: "Sales — Flower",
      type: "income",
      normalBalance: "credit",
      requiresCostClass: true,
    }).some((i) => i.field === "requiresCostClass"),
  );
  expect(
    "revenue account carrying a cost class is rejected",
    validateAccount({
      code: "50010",
      name: "Sales — Flower",
      type: "income",
      normalBalance: "credit",
      defaultCostClass: "cogs_direct",
    }).some((i) => i.field === "defaultCostClass"),
  );
  expect(
    "a plain revenue account is accepted",
    validateAccount({
      code: "50010",
      name: "Sales — Flower",
      type: "income",
      normalBalance: "credit",
      defaultCostClass: "none",
    }).length === 0,
  );

  // 280E: cost of goods sold can never be a disallowed deduction.
  expect(
    "COGS account marked nondeductible_280e is rejected",
    validateAccount({
      code: "60010",
      name: "COGS — Flower",
      type: "cogs",
      normalBalance: "debit",
      defaultCostClass: "nondeductible_280e",
    }).some((i) => i.field === "defaultCostClass"),
  );
  expect(
    "COGS account with no cost class at all is rejected",
    validateAccount({
      code: "60010",
      name: "COGS — Flower",
      type: "cogs",
      normalBalance: "debit",
    }).some((i) => i.field === "defaultCostClass"),
  );
  expect(
    "COGS account tagged cogs_direct is accepted",
    validateAccount({
      code: "60010",
      name: "COGS — Flower",
      type: "cogs",
      normalBalance: "debit",
      defaultCostClass: "cogs_direct",
    }).length === 0,
  );

  // The GRWNY class of bug: a mistyped entity silently hides an account.
  expect(
    "account restricted to the misspelled entity GRWNY is rejected",
    validateAccount({
      code: "71010",
      name: "Wages & Salaries",
      type: "expense",
      normalBalance: "debit",
      requiresCostClass: true,
      defaultCostClass: "cogs_allocable",
      // Deliberately mistyped, exactly as it appeared in the live Sage chart.
      allowedEntityCodes: ["GRWNY" as EntityCode],
    }).some((i) => i.field === "allowedEntityCodes"),
  );
  expect(
    "an EMPTY entity restriction is rejected (it would hide the account)",
    validateAccount({
      code: "71010",
      name: "Wages & Salaries",
      type: "expense",
      normalBalance: "debit",
      requiresCostClass: true,
      defaultCostClass: "cogs_allocable",
      allowedEntityCodes: [],
    }).some((i) => i.field === "allowedEntityCodes"),
  );
  expect(
    "the correctly spelled entity restriction is accepted",
    validateAccount({
      code: "71010",
      name: "Wages & Salaries",
      type: "expense",
      normalBalance: "debit",
      requiresCostClass: true,
      defaultCostClass: "cogs_allocable",
      allowedEntityCodes: ["greenway"],
    }).length === 0,
  );
  expect(
    "null entity restriction means any entity, and is accepted",
    validateAccount({
      code: "71010",
      name: "Wages & Salaries",
      type: "expense",
      normalBalance: "debit",
      requiresCostClass: true,
      defaultCostClass: "cogs_allocable",
      allowedEntityCodes: null,
    }).length === 0,
  );
  eq(ENTITY_CODES.length, 4, "there are exactly four sets of books");
}
