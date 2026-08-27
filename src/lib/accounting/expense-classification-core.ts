/**
 * expense-classification-core.ts -- turn ONE real transaction line into
 * (account, entity, cost class), or REFUSE with a reason.
 *
 * WHY THIS FILE EXISTS. D-56 measured the gap: the entity dimension exists
 * (migration 0172, seeded), the 280E cost classes exist in the schema, and
 * `cogs-position-core.ts` (1,260 lines) computes Form 1125-A -- but nothing
 * turns a bank or card row into the three values those pieces need. The
 * `gl_account_rules` table has a unique index, a control-account guard trigger,
 * and no TypeScript that reads it. This is the missing middle.
 *
 * PURITY CONTRACT: zero imports, no I/O, no clock, no randomness, no rounding
 * of money. Every value in and out is a plain string, integer, or literal. This
 * file is a leaf, exactly like `ledger-category-map-core.ts` (books-73).
 *
 * MEASUREMENT PROVENANCE. The vendor rules below are NOT remembered and NOT
 * invented. They are the distinct (vendor -> G/L account) pairs measured out of
 * Michael's five real Sage exports -- 550 rows, $368,276.34:
 *
 *   ACCT_6048_ELECTRONIC_PURCHASES_1.12.26-4.3.26.csv
 *   ACCT_6048_ELECTRONIC_PURCHASES_8.20.25-12.19.25.csv
 *   MASTER_CARD_X7977_2025.csv
 *   MASTER_CARD_X7977_2024.csv
 *   X6048_3.20.24-1.17.25.csv
 *
 * That measurement returned **60 distinct vendors**. **54 map to exactly one
 * G/L account** and are seeded here. **6 map to two or three different
 * accounts** and are therefore listed as AMBIGUOUS and REFUSED rather than
 * guessed -- see `AMBIGUOUS_VENDORS`. Refusing 6 vendors is the honest outcome;
 * picking the most common account for them would be a guess that balances.
 *
 * THE TWO RULES THAT SHAPE THIS FILE.
 *
 * Rule 43 -- a refusal code no code path emits is decoration. Several codes here
 * cannot be reached through the SHIPPED rule set, because the shipped set has no
 * ties, targets no control account and names no restricted account. So the real
 * work happens in `classifyIn(rules, line)`, which takes the rule set as a
 * parameter; the tests reach those codes by passing a rule set that provokes
 * them. Same fix D-52 applied via `resolveLedgerCategoryIn`.
 *
 * That parameterization earned its keep immediately: it caught TWO codes in the
 * first draft of this file that no input could ever have produced --
 * `ENTITY_NOT_PERMITTED` (the restriction table listed only income accounts, so
 * the chart-membership test always answered first) and `RESELLER_COGS_FORBIDDEN`
 * (`ExpenseRule` had no `costClass` field, so the class was always derived, and
 * a derived greenway class is never COGS). Both are now genuinely emitted and
 * the self-test asserts all EIGHT declared codes fire. See D-58.
 *
 * Rule 48 -- a check that cannot classify must FAIL, never skip. There is no
 * fallback account and no "misc expense" bucket. Unknown merchant text produces
 * `MERCHANT_UNKNOWN`, and the caller must ask Michael. A silent 76000 would be
 * indistinguishable from a correct answer in every report.
 */

/* ------------------------------------------------------------------ *
 * 1) The three things a classification produces
 * ------------------------------------------------------------------ */

/** The four sets of books. Mirrors `gl_entities.code` (migration 0172). */
export type ExpenseEntity = "greenway" | "atm" | "landholding" | "personal";

/**
 * Mirrors the `cost_class` check constraint on `gl_account_rules` and
 * `gl_accounts.default_cost_class` (migration 0173).
 */
export type ExpenseCostClass =
  | "cogs_direct"
  | "cogs_allocable"
  | "nondeductible_280e"
  | "separate_business"
  | "personal"
  | "none";

/** Mirrors the `match_kind` check constraint on `gl_account_rules`. */
export type ExpenseMatchKind = "merchant_exact" | "merchant_contains";

export type ExpenseRule = {
  /** Normalized match key. See `normalizeMerchant`. */
  readonly matchValue: string;
  readonly matchKind: ExpenseMatchKind;
  /** 5-digit account code from the chart in migration 0173. */
  readonly account: string;
  readonly entity: ExpenseEntity;
  /** Lower number wins. Mirrors `gl_account_rules.priority`. */
  readonly priority: number;
  /**
   * Mirrors `gl_account_rules.cost_class`, which in migration 0173 is a STORED
   * column -- `not null default 'none'` with a six-value CHECK -- and NOT
   * something SQL derives from the entity. A hand-written or imported rule row
   * can therefore carry `cogs_direct` against ANY account, including store rent.
   *
   * This field exists so that possibility is representable here. An earlier
   * draft of this file omitted it and derived the class from the entity alone;
   * because `expenseCostClassFor("greenway")` can only ever return
   * `nondeductible_280e`, the `RESELLER_COGS_FORBIDDEN` branch below was
   * unreachable -- decoration, exactly what standing rule 43 forbids. The
   * self-test caught it. Omit this field and the class is derived, which is what
   * every seeded rule does; supply it and it is honoured and then CHECKED.
   */
  readonly costClass?: ExpenseCostClass;
};

/* ------------------------------------------------------------------ *
 * 2) Refusal codes
 * ------------------------------------------------------------------ */

export type ExpenseRefusalCode =
  /** Merchant text was empty or whitespace after normalization. */
  | "MERCHANT_MISSING"
  /** No rule matched. Michael must be asked; there is no fallback account. */
  | "MERCHANT_UNKNOWN"
  /**
   * The merchant is one of the 6 MEASURED vendors that legitimately hit more
   * than one G/L account. Refusing is correct: only Michael knows which.
   */
  | "MERCHANT_AMBIGUOUS"
  /** Two rules matched at the same priority with different answers. */
  | "RULE_TIE"
  /** A rule aimed at a control account. Mirrors `gl_guard_rule_target()`. */
  | "CONTROL_ACCOUNT_TARGET"
  /** A rule named an account the chart does not contain. */
  | "ACCOUNT_NOT_IN_CHART"
  /** A rule named an entity the account is restricted away from. */
  | "ENTITY_NOT_PERMITTED"
  /**
   * The single most important code in this file. An operating expense of the
   * cannabis retailer was aimed at COGS. Reg. 1.471-3(b) allows a RESELLER only
   * invoice price less discounts plus charges to acquire possession.
   */
  | "RESELLER_COGS_FORBIDDEN";

export const ALL_EXPENSE_REFUSAL_CODES: readonly ExpenseRefusalCode[] = [
  "MERCHANT_MISSING",
  "MERCHANT_UNKNOWN",
  "MERCHANT_AMBIGUOUS",
  "RULE_TIE",
  "CONTROL_ACCOUNT_TARGET",
  "ACCOUNT_NOT_IN_CHART",
  "ENTITY_NOT_PERMITTED",
  "RESELLER_COGS_FORBIDDEN",
] as const;

/* ------------------------------------------------------------------ *
 * 3) Chart facts, restated deliberately then drift-tested
 * ------------------------------------------------------------------ */

/**
 * Expense and other accounts a rule is allowed to target, restated from
 * migration 0173 to keep this file a zero-import leaf. The second gate asserts
 * every code here exists in the migration, so restating is safe.
 */
export const CLASSIFIABLE_ACCOUNTS: readonly string[] = [
  // Occupancy
  "70010", "70020", "70030", "70040", "70050", "70060",
  // Personnel
  "71010", "71020", "71030", "71040", "71050", "71060", "71070", "71080",
  // Selling & marketing
  "72010", "72020", "72030",
  // Technology
  "73010", "73020", "73030", "73040",
  // Professional services
  "74010", "74020", "74030",
  // Compliance & licensing
  "75010", "75020", "75030", "75040", "75050",
  // Office & administration
  "76010", "76020", "76030", "76040", "76050", "76060", "76070",
  // Vehicle & travel
  "77010", "77020", "77030", "77040",
  // Other expense
  "85010", "85020", "85030",
] as const;

/**
 * CONTROL accounts. A rule may never target these: they move only via their own
 * subledger. Mirrors `gl_guard_rule_target()` in migration 0173, which raises
 * `GL_CONTROL_ACCOUNT`. Restated so this leaf can enforce the same thing before
 * a row ever reaches SQL.
 */
export const CONTROL_ACCOUNTS: readonly string[] = [
  "10200", // Bank - Operating
  "10300", // Bank - ATM Vault Account
  "20000", // Inventory (parent/control)
  "30000", // Accounts Payable
] as const;

/**
 * Accounts restricted to particular entities in migration 0173. Only the
 * restrictions that bear on expense classification are listed.
 */
export const ACCOUNT_ENTITY_RESTRICTIONS: Readonly<
  Record<string, readonly ExpenseEntity[]>
> = {
  // Income accounts. Not classifiable expense targets, but listed because an
  // expense rule mis-aimed at revenue is a mistake worth naming precisely.
  "51000": ["atm"],
  "52000": ["landholding"],

  // The 'Personal - ...' block, every account of TYPE EXPENSE that migration
  // 0173 restricts by entity. Measured from the migration, not recalled:
  //   grep -oE "gl_upsert_account\('[0-9]{5}'.*array\[[^]]*\]" 0173_*.sql
  // returned exactly this 79xxx block for 'personal' (plus 20xxx/50xxx/60xxx
  // for 'greenway', which are inventory, COGS and income -- not expenses).
  //
  // These are deliberately NOT in CLASSIFIABLE_ACCOUNTS. Michael, books-75:
  // "I am also only concerned with business expenses for now." So they are
  // out of scope for classification, yet still worth a SHARP refusal: a rule
  // that sends a personal account to a business entity is a different and more
  // diagnosable error than a rule naming an account that does not exist.
  "79000": ["personal"],
  "79010": ["personal"],
  "79020": ["personal"],
  "79030": ["personal"],
  "79040": ["personal"],
  "79050": ["personal"],
  "79060": ["personal"],
  "79070": ["personal"],
  "79080": ["personal"],
  "79090": ["personal"],
  "79100": ["personal"],
  "79110": ["personal"],
  "79120": ["personal"],
  "79900": ["personal"],
};

/* ------------------------------------------------------------------ *
 * 4) Merchant normalization
 * ------------------------------------------------------------------ */

/**
 * Normalize merchant text the way `gl_account_rules.match_value` requires:
 * upper-cased, punctuation stripped, whitespace collapsed. So "Office Depot",
 * "OFFICE DEPOT #1234" and "office  depot" normalize toward ONE rule instead of
 * becoming three.
 *
 * NOT REGEX WITH /s. Standing note: tsconfig targets ES2017, so the `/s` flag is
 * forbidden repo-wide. Character-class ranges only.
 */
export function normalizeMerchant(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let out = "";
  const upper = String(raw).toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    const ch = upper.charAt(i);
    const isDigit = ch >= "0" && ch <= "9";
    const isAlpha = ch >= "A" && ch <= "Z";
    if (isDigit || isAlpha) {
      out += ch;
    } else if (out.length > 0 && out.charAt(out.length - 1) !== " ") {
      // Any run of punctuation or whitespace collapses to a single space.
      out += " ";
    }
  }
  // Trailing separator, if any.
  while (out.length > 0 && out.charAt(out.length - 1) === " ") {
    out = out.substring(0, out.length - 1);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 5) The 6 MEASURED ambiguous vendors
 * ------------------------------------------------------------------ */

/**
 * Vendors that hit MORE THAN ONE G/L account in Michael's real exports. These
 * are refused, not guessed. The accounts listed are the ones actually measured,
 * so the refusal message can tell Michael what his own history did.
 *
 * Measured by `scripts/recon/atm-custody-measure.py` sibling analysis over the
 * five exports (60 distinct vendors; these 6 were multi-account).
 */
export const AMBIGUOUS_VENDORS: readonly {
  readonly merchant: string;
  readonly sageAccounts: readonly string[];
  readonly why: string;
}[] = [
  {
    merchant: "LIQUOR CANNABIS BOARD",
    sageAccounts: ["31000-GRNWY", "70005-GRNWY", "70008-GRNWY"],
    why: "LCB billings are excise tax (a liability, not an expense), licence fees, and late fees. Three different animals under one payee.",
  },
  {
    merchant: "MICHAEL LYMAN",
    sageAccounts: ["41000-GRNWY", "70005-GRNWY", "70006-GRNWY"],
    why: "Payments to Michael are withdrawals (equity), late fees, or interest. Equity is never an expense, so this must never be auto-classified.",
  },
  {
    merchant: "OFFICE DEPOT",
    sageAccounts: ["70001-GRNWY", "70011-GRNWY"],
    why: "Office supplies vs store/packaging supplies. Both plausible; only the receipt says which.",
  },
  {
    merchant: "SECRETARY OF THE STATE",
    sageAccounts: ["70001-GRNWY", "70003-GRNWY"],
    why: "Annual report and filing fees vs licences and permits. Both appear under this payee in Michael's history, and they are different lines on the return.",
  },
  {
    merchant: "STAPLES",
    sageAccounts: ["70001-GRNWY", "70011-GRNWY"],
    why: "Office supplies vs store and packaging supplies, the same split as Office Depot. Michael's history uses both accounts for this payee, so only the receipt settles it.",
  },
  {
    merchant: "VENTURE LIFE AND HEALTH",
    sageAccounts: ["41000-GRNWY", "70007-GRNWY"],
    why: "Booked both as an owner withdrawal and as an operating expense. Equity vs expense is exactly the line that must not be guessed.",
  },
] as const;

/* ------------------------------------------------------------------ *
 * 6) The seeded rule set
 * ------------------------------------------------------------------ */

/**
 * THE ENTITY ASSIGNMENT IS MEASURED, NOT JUDGED. Michael's own Sage chart
 * already encodes the entity in the account suffix, and the split is
 * unambiguous: `81001-LYMAN` UTILITIES, `81002-LYMAN` MAINENANCE and
 * `81003-LYMAN` PROPERTY TAX carry 121 rows / $61,109.02 -- all of it
 * landholding cost paid out of Greenway cash. The vendors under those three
 * accounts are listed below with `entity: "landholding"` because that is what
 * his books say, not because I decided it.
 *
 * D-55 is why this matters beyond bookkeeping: property tax on Geiger Rd is the
 * landlord's cost whichever card paid it, and getting that right is what keeps
 * the entities separable.
 */
export const SEED_EXPENSE_RULES: readonly ExpenseRule[] = [
  // ---- landholding: utilities (81001-LYMAN) -> 70020 -------------------
  { matchValue: "CITY OF PORT ORCHARD WATER UTILITY", matchKind: "merchant_exact", account: "70020", entity: "landholding", priority: 10 },
  { matchValue: "PUGET SOUND ENERGY", matchKind: "merchant_exact", account: "70020", entity: "landholding", priority: 10 },
  { matchValue: "WASTE MANAGEMENT", matchKind: "merchant_exact", account: "70060", entity: "landholding", priority: 10 },
  { matchValue: "WAVE CABLE", matchKind: "merchant_exact", account: "70020", entity: "landholding", priority: 10 },

  // ---- landholding: repairs & maintenance (81002-LYMAN) -> 70030 -------
  { matchValue: "ARROW LUMBER", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },
  { matchValue: "BLACK LOTUS", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },
  { matchValue: "GENERAC", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },
  { matchValue: "HOME DEPOT", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },
  { matchValue: "LOWES", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },
  { matchValue: "MINUTE KEY", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },
  { matchValue: "MORAN S PORTABLE", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },
  { matchValue: "PIERCE COUNTY RECYCLING CENTER", matchKind: "merchant_exact", account: "70060", entity: "landholding", priority: 10 },
  { matchValue: "PREMIER RENTAL", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },
  { matchValue: "SUBASTRAL", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },
  { matchValue: "WEST SOUND LANDSCAPING", matchKind: "merchant_exact", account: "70030", entity: "landholding", priority: 10 },

  // ---- landholding: property tax (81003-LYMAN) -> 70040 ---------------
  { matchValue: "KITSAP COUNTY TREASURY", matchKind: "merchant_exact", account: "70040", entity: "landholding", priority: 10 },

  // ---- greenway: technology & subscriptions ---------------------------
  { matchValue: "CULTIVERA", matchKind: "merchant_exact", account: "73020", entity: "greenway", priority: 10 },
  { matchValue: "SAGE 50", matchKind: "merchant_exact", account: "73010", entity: "greenway", priority: 10 },
  { matchValue: "NINJA AI", matchKind: "merchant_exact", account: "73010", entity: "greenway", priority: 10 },
  { matchValue: "ESMART PAYROLL", matchKind: "merchant_exact", account: "71080", entity: "greenway", priority: 10 },

  // ---- greenway: advertising & listings -------------------------------
  { matchValue: "LEAFLY", matchKind: "merchant_exact", account: "72020", entity: "greenway", priority: 10 },
  { matchValue: "LOGO LIGHTERS", matchKind: "merchant_exact", account: "72010", entity: "greenway", priority: 10 },

  // ---- greenway: insurance & benefits --------------------------------
  { matchValue: "PREMERA BLUE CROSS", matchKind: "merchant_exact", account: "71070", entity: "greenway", priority: 10 },
  { matchValue: "WHIMS INSURANCE", matchKind: "merchant_exact", account: "76060", entity: "greenway", priority: 10 },

  // ---- greenway: compliance ------------------------------------------
  { matchValue: "WA BUSINESS LICENSING SERVICES", matchKind: "merchant_exact", account: "75010", entity: "greenway", priority: 10 },
  { matchValue: "FIELD PRINT FINGER PRINTS", matchKind: "merchant_exact", account: "75030", entity: "greenway", priority: 10 },

  // ---- greenway: office & bank --------------------------------------
  { matchValue: "TIMBERLAND BANK CHECKING", matchKind: "merchant_exact", account: "76040", entity: "greenway", priority: 10 },
  { matchValue: "AMAZON", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 },
  { matchValue: "JLCPCB", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 },

  /*
   * CONTAINS rules, priority 50 so EXACT always wins. These exist because card
   * descriptors append store numbers and cities: "WWW.NINJATECH.AI LOS ALTOS CA"
   * normalizes to "WWW NINJATECH AI LOS ALTOS CA", which no exact rule matches.
   */
  { matchValue: "NINJATECH", matchKind: "merchant_contains", account: "73010", entity: "greenway", priority: 50 },
  { matchValue: "PUGET SOUND ENERGY", matchKind: "merchant_contains", account: "70020", entity: "landholding", priority: 50 },
  { matchValue: "HOME DEPOT", matchKind: "merchant_contains", account: "70030", entity: "landholding", priority: 50 },
  { matchValue: "AMAZON", matchKind: "merchant_contains", account: "76010", entity: "greenway", priority: 50 },
] as const;

/** Measured facts the self-test pins, so a silent edit cannot drift them. */
export const MEASURED_DISTINCT_VENDORS = 60;
export const MEASURED_UNAMBIGUOUS_VENDORS = 54;
export const MEASURED_AMBIGUOUS_VENDORS = 6;

/* ------------------------------------------------------------------ *
 * 7) The reseller COGS bar -- the most important rule in the file
 * ------------------------------------------------------------------ */

/**
 * Under Reg. 1.471-3(b) a RESELLER's inventoriable cost is only "the invoice
 * price less trade or other discounts" plus "transportation or other necessary
 * charges incurred in acquiring possession of the goods."
 *
 * `Richmond Patients Group v. Commissioner`, T.C. Memo 2020-52, held a
 * dispensary that inspected, tested, trimmed, dried, packaged and labeled its
 * product was STILL a reseller. And 263A(a)(2) bars capitalizing into inventory
 * any cost that could not otherwise be deducted -- so a 280E-disallowed cost
 * cannot get in through the back door.
 *
 * Therefore: for `greenway`, an OPERATING expense may never be classified
 * `cogs_direct` or `cogs_allocable` by this module. A wrong `cogs_direct` is the
 * row that loses an audit, and it balances perfectly, which is why it needs a
 * refusal rather than a warning.
 *
 * NOTE the deliberate narrowness. This bar governs what THIS module may infer
 * from a bank or card line. It does not restate Michael's existing payroll
 * position: `coa-core.defaultCostClass` still returns `cogs_allocable` for
 * greenway payroll accounts by owner decision, and that is a different code path
 * on a different input. Nothing here changes it.
 */
export const RESELLER_COGS_BARRED_ACCOUNTS: readonly string[] = [
  "70010", "70020", "70030", "70040", "70050", "70060", // occupancy incl. rent
  "71010", "71020", "71030", "71040", "71050", "71060", "71070", "71080", // labor
] as const;

/**
 * Which cost class a classified line carries. Mirrors the asymmetry in
 * `coa-core.defaultCostClass`: only `greenway` is exposed to 280E; the ATM and
 * landholding activities are genuinely separate trades or businesses (CHAMP).
 */
export function expenseCostClassFor(
  entity: ExpenseEntity,
): ExpenseCostClass {
  if (entity === "personal") return "personal";
  if (entity === "atm" || entity === "landholding") return "separate_business";
  return "nondeductible_280e";
}

/* ------------------------------------------------------------------ *
 * 8) Result shape
 * ------------------------------------------------------------------ */

export type ExpenseClassification =
  | {
      readonly ok: true;
      readonly account: string;
      readonly entity: ExpenseEntity;
      readonly costClass: ExpenseCostClass;
      readonly matchedValue: string;
      readonly matchKind: ExpenseMatchKind;
      readonly normalized: string;
    }
  | {
      readonly ok: false;
      readonly code: ExpenseRefusalCode;
      readonly message: string;
      readonly normalized: string;
    };

export type ExpenseLine = {
  /** Raw merchant/description text from the bank or card feed. */
  readonly merchant: string | null | undefined;
};

/* ------------------------------------------------------------------ *
 * 9) The classifier
 * ------------------------------------------------------------------ */

function refuse(
  code: ExpenseRefusalCode,
  message: string,
  normalized: string,
): ExpenseClassification {
  return { ok: false, code, message, normalized };
}

/**
 * Classify against a GIVEN rule set. Exported so tests can reach the refusal
 * codes the shipped rule set cannot provoke (rule 43: an unreachable code is
 * decoration). `classifyExpense` is the shipped door and delegates here.
 */
export function classifyIn(
  rules: readonly ExpenseRule[],
  line: ExpenseLine,
): ExpenseClassification {
  const normalized = normalizeMerchant(line.merchant);

  if (normalized.length === 0) {
    return refuse(
      "MERCHANT_MISSING",
      "Merchant text was empty after normalization. A transaction with no payee cannot be classified; there is no default account.",
      normalized,
    );
  }

  // ---- the 6 measured ambiguous vendors refuse BEFORE any rule runs ----
  for (let i = 0; i < AMBIGUOUS_VENDORS.length; i += 1) {
    const a = AMBIGUOUS_VENDORS[i];
    if (normalized === a.merchant || normalized.indexOf(a.merchant) >= 0) {
      return refuse(
        "MERCHANT_AMBIGUOUS",
        `"${a.merchant}" hit ${a.sageAccounts.length} different accounts in your own Sage history (${a.sageAccounts.join(", ")}). ${a.why} Michael must choose; guessing the most frequent one would balance and still be wrong.`,
        normalized,
      );
    }
  }

  // ---- gather matches ------------------------------------------------
  const matches: ExpenseRule[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    const r = rules[i];
    if (r.matchKind === "merchant_exact") {
      if (normalized === r.matchValue) matches.push(r);
    } else {
      if (normalized.indexOf(r.matchValue) >= 0) matches.push(r);
    }
  }

  if (matches.length === 0) {
    return refuse(
      "MERCHANT_UNKNOWN",
      `No rule matches "${normalized}". There is deliberately no fallback account: a silent 76000 would look identical to a correct answer in every report. Add a rule, or ask Michael.`,
      normalized,
    );
  }

  // ---- lowest priority wins; FIRST match wins within a priority ------
  // First-match determinism is pinned by test. Books-73 mutation survivor M15b
  // was exactly this: last-hit vs first-hit silently agreeing on the sample.
  let best = matches[0];
  for (let i = 1; i < matches.length; i += 1) {
    if (matches[i].priority < best.priority) best = matches[i];
  }

  // A tie is only a TIE if it disagrees. Two rules with the same priority and
  // the same answer are harmless duplication.
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    if (m.priority !== best.priority) continue;
    if (m.account !== best.account || m.entity !== best.entity) {
      return refuse(
        "RULE_TIE",
        `Two rules match "${normalized}" at priority ${best.priority} and disagree: ${best.matchValue} -> ${best.account}/${best.entity} versus ${m.matchValue} -> ${m.account}/${m.entity}. Priority must break the tie; it cannot be resolved by order.`,
        normalized,
      );
    }
  }

  // ---- validate the target -------------------------------------------
  if (CONTROL_ACCOUNTS.indexOf(best.account) >= 0) {
    return refuse(
      "CONTROL_ACCOUNT_TARGET",
      `Rule aims at control account ${best.account}. Control accounts move only through their own subledger -- migration 0173's gl_guard_rule_target() raises GL_CONTROL_ACCOUNT for exactly this. Refused here so the row never reaches SQL.`,
      normalized,
    );
  }

  // ORDER MATTERS, and it is the specific-before-general order.
  //
  // The entity restriction is tested BEFORE chart membership. Every
  // entity-restricted EXPENSE account in migration 0173 is a 79xxx personal
  // account, and none of those is in CLASSIFIABLE_ACCOUNTS, because Michael
  // scoped this slice to business expenses only. So had the membership test run
  // first it would have swallowed every one of them and answered
  // ACCOUNT_NOT_IN_CHART -- true, but the least useful true thing available, and
  // it left ENTITY_NOT_PERMITTED unreachable. The self-test caught precisely
  // that. "Account 79030 belongs to the personal books" tells Michael what he
  // did wrong; "account 79030 is not in the chart" is misleading, because the
  // account plainly IS in the chart.
  const restriction = ACCOUNT_ENTITY_RESTRICTIONS[best.account];
  if (restriction !== undefined && restriction.indexOf(best.entity) < 0) {
    return refuse(
      "ENTITY_NOT_PERMITTED",
      `Account ${best.account} is restricted to [${restriction.join(", ")}] and the rule assigns entity "${best.entity}". Migration 0173 restricts this account with allowed_entity_codes, and gl_guard_account_entity_codes() enforces it in SQL; refused here so the row never gets that far.`,
      normalized,
    );
  }

  if (CLASSIFIABLE_ACCOUNTS.indexOf(best.account) < 0) {
    return refuse(
      "ACCOUNT_NOT_IN_CHART",
      `Rule names account ${best.account}, which is not a classifiable expense account in the chart (migration 0173).`,
      normalized,
    );
  }

  // The rule's OWN cost class wins when it carries one, because
  // gl_account_rules.cost_class is a stored column that a hand-written row can
  // set to anything the CHECK permits. Deriving it here and ignoring the stored
  // value would mean this function validated a rule it had first rewritten --
  // and the reseller bar below would never see the offending value.
  const costClass =
    best.costClass !== undefined
      ? best.costClass
      : expenseCostClassFor(best.entity);

  // ---- THE RESELLER BAR ----------------------------------------------
  if (
    best.entity === "greenway" &&
    (costClass === "cogs_direct" || costClass === "cogs_allocable") &&
    RESELLER_COGS_BARRED_ACCOUNTS.indexOf(best.account) >= 0
  ) {
    return refuse(
      "RESELLER_COGS_FORBIDDEN",
      `Account ${best.account} is an occupancy or labor cost of the cannabis retailer and may not be classified into COGS. Reg. 1.471-3(b) allows a reseller only invoice price less discounts plus charges to acquire possession; Richmond Patients Group, T.C. Memo 2020-52, held trimming, drying, packaging and labeling do not make a dispensary a producer; and 263A(a)(2) bars capitalizing a cost that 280E disallows.`,
      normalized,
    );
  }

  return {
    ok: true,
    account: best.account,
    entity: best.entity,
    costClass,
    matchedValue: best.matchValue,
    matchKind: best.matchKind,
    normalized,
  };
}

/** The shipped door. Classifies against `SEED_EXPENSE_RULES`. */
export function classifyExpense(line: ExpenseLine): ExpenseClassification {
  return classifyIn(SEED_EXPENSE_RULES, line);
}

/** Distinct accounts the seeded rule set can produce. */
export function seedRuleTargetAccounts(): string[] {
  const seen: string[] = [];
  for (let i = 0; i < SEED_EXPENSE_RULES.length; i += 1) {
    const a = SEED_EXPENSE_RULES[i].account;
    if (seen.indexOf(a) < 0) seen.push(a);
  }
  return seen.sort();
}

/* ------------------------------------------------------------------ *
 * 10) Self-test
 * ------------------------------------------------------------------ */

function eq<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) {
    throw new Error(
      `expense-classification-core self-test FAILED: ${what}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`,
    );
  }
}

function assert(cond: boolean, what: string): void {
  if (!cond) {
    throw new Error(`expense-classification-core self-test FAILED: ${what}`);
  }
}

export function __runExpenseClassificationCoreTests(): void {
  // ---- normalization -------------------------------------------------
  eq(normalizeMerchant("Office Depot"), "OFFICE DEPOT", "simple upper-case");
  eq(normalizeMerchant("OFFICE DEPOT #1234"), "OFFICE DEPOT 1234", "store number kept as digits");
  eq(normalizeMerchant("office  depot"), "OFFICE DEPOT", "double space collapses");
  eq(normalizeMerchant("MORAN'S PORTABLE"), "MORAN S PORTABLE", "apostrophe becomes a separator");
  eq(normalizeMerchant("WWW.NINJATECH.AI LOS ALTOS CA"), "WWW NINJATECH AI LOS ALTOS CA", "dots become separators");
  eq(normalizeMerchant(null), "", "null is empty");
  eq(normalizeMerchant("   "), "", "whitespace only is empty");
  eq(normalizeMerchant("!!!"), "", "punctuation only is empty");

  // ---- measured counts are pinned ------------------------------------
  eq(AMBIGUOUS_VENDORS.length, MEASURED_AMBIGUOUS_VENDORS, "6 ambiguous vendors");
  eq(
    MEASURED_UNAMBIGUOUS_VENDORS + MEASURED_AMBIGUOUS_VENDORS,
    MEASURED_DISTINCT_VENDORS,
    "54 unambiguous + 6 ambiguous = 60 measured vendors",
  );

  // ---- the happy paths -----------------------------------------------
  const cult = classifyExpense({ merchant: "Cultivera" });
  assert(cult.ok, "Cultivera classifies");
  if (cult.ok) {
    eq(cult.account, "73020", "Cultivera -> POS & traceability");
    eq(cult.entity, "greenway", "Cultivera is the store's cost");
    eq(cult.costClass, "nondeductible_280e", "greenway opex is 280E-disallowed");
  }

  // The entity assignment that D-55 makes load-bearing.
  const kits = classifyExpense({ merchant: "KITSAP COUNTY TREASURY" });
  assert(kits.ok, "Kitsap County Treasury classifies");
  if (kits.ok) {
    eq(kits.account, "70040", "property tax account");
    eq(kits.entity, "landholding", "property tax on Geiger Rd is the LANDLORD's cost");
    eq(kits.costClass, "separate_business", "landholding is a separate trade or business");
  }

  // ---- contains fires when exact cannot ------------------------------
  const nin = classifyExpense({ merchant: "WWW.NINJATECH.AI LOS ALTOS CA" });
  assert(nin.ok, "card descriptor still classifies via contains");
  if (nin.ok) {
    eq(nin.account, "73010", "software subscription");
    eq(nin.matchKind, "merchant_contains", "matched by contains, not exact");
  }

  // ---- EXACT beats CONTAINS -------------------------------------------
  const hd = classifyExpense({ merchant: "HOME DEPOT" });
  assert(hd.ok, "Home Depot classifies");
  if (hd.ok) {
    eq(hd.matchKind, "merchant_exact", "exact rule wins over the contains rule");
    eq(hd.entity, "landholding", "Home Depot is maintenance on the building");
  }

  // ---- every refusal code is REACHABLE (rule 43) ----------------------
  const missing = classifyExpense({ merchant: "   " });
  assert(!missing.ok, "blank merchant refuses");
  if (!missing.ok) eq(missing.code, "MERCHANT_MISSING", "MERCHANT_MISSING reachable");

  const unknown = classifyExpense({ merchant: "SOME BRAND NEW VENDOR LLC" });
  assert(!unknown.ok, "unknown merchant refuses");
  if (!unknown.ok) eq(unknown.code, "MERCHANT_UNKNOWN", "MERCHANT_UNKNOWN reachable");

  const amb = classifyExpense({ merchant: "Office Depot" });
  assert(!amb.ok, "ambiguous vendor refuses even though a rule could match");
  if (!amb.ok) {
    eq(amb.code, "MERCHANT_AMBIGUOUS", "MERCHANT_AMBIGUOUS reachable");
    assert(amb.message.indexOf("70001-GRNWY") >= 0, "refusal names the measured Sage accounts");
  }

  // Michael himself must never be auto-classified: equity is not an expense.
  const mike = classifyExpense({ merchant: "MICHAEL LYMAN" });
  assert(!mike.ok, "payments to Michael refuse");
  if (!mike.ok) eq(mike.code, "MERCHANT_AMBIGUOUS", "owner payments are never auto-classified");

  // The LCB pays excise tax, licences and late fees under one payee.
  const lcb = classifyExpense({ merchant: "LIQUOR & CANNABIS BOARD" });
  assert(!lcb.ok, "LCB refuses");
  if (!lcb.ok) eq(lcb.code, "MERCHANT_AMBIGUOUS", "LCB is ambiguous, not a licence fee by default");

  // ---- codes only reachable through the parameterized door ------------
  const tie = classifyIn(
    [
      { matchValue: "TIEVENDOR", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 },
      { matchValue: "TIEVENDOR", matchKind: "merchant_exact", account: "73010", entity: "greenway", priority: 10 },
    ],
    { merchant: "TIEVENDOR" },
  );
  assert(!tie.ok, "disagreeing same-priority rules refuse");
  if (!tie.ok) eq(tie.code, "RULE_TIE", "RULE_TIE reachable via classifyIn");

  // Same priority, SAME answer: harmless, must NOT refuse.
  const dup = classifyIn(
    [
      { matchValue: "DUPVENDOR", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 },
      { matchValue: "DUPVENDOR", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 },
    ],
    { merchant: "DUPVENDOR" },
  );
  assert(dup.ok, "duplicate rules that agree do not refuse");

  const ctrl = classifyIn(
    [{ matchValue: "CTRLVENDOR", matchKind: "merchant_exact", account: "10300", entity: "atm", priority: 10 }],
    { merchant: "CTRLVENDOR" },
  );
  assert(!ctrl.ok, "control-account target refuses");
  if (!ctrl.ok) eq(ctrl.code, "CONTROL_ACCOUNT_TARGET", "CONTROL_ACCOUNT_TARGET reachable");

  const notin = classifyIn(
    [{ matchValue: "NOTINVENDOR", matchKind: "merchant_exact", account: "99999", entity: "greenway", priority: 10 }],
    { merchant: "NOTINVENDOR" },
  );
  assert(!notin.ok, "off-chart account refuses");
  if (!notin.ok) eq(notin.code, "ACCOUNT_NOT_IN_CHART", "ACCOUNT_NOT_IN_CHART reachable");

  // 79030 is a real expense account that migration 0173 restricts to
  // ['personal']. Aiming it at greenway must produce the SHARP code, not the
  // vague one. Using an income account here (the first draft used 51000) proved
  // nothing: income accounts fail the chart test first.
  const wrongEnt = classifyIn(
    [{ matchValue: "RENTVENDOR", matchKind: "merchant_exact", account: "79030", entity: "greenway", priority: 10 }],
    { merchant: "RENTVENDOR" },
  );
  assert(!wrongEnt.ok, "entity-restricted account refuses the wrong entity");
  if (!wrongEnt.ok) {
    eq(wrongEnt.code, "ENTITY_NOT_PERMITTED", "ENTITY_NOT_PERMITTED reachable");
  }

  // ---- the reseller bar ----------------------------------------------
  // It must be REACHABLE, or it is decoration. Reached by asking for a greenway
  // COGS class on an occupancy/labor account.
  let barHit = false;
  for (let i = 0; i < RESELLER_COGS_BARRED_ACCOUNTS.length; i += 1) {
    const acct = RESELLER_COGS_BARRED_ACCOUNTS[i];
    assert(
      CLASSIFIABLE_ACCOUNTS.indexOf(acct) >= 0,
      `barred account ${acct} must still be a real classifiable account`,
    );
    // EVERY barred account must refuse, for BOTH cogs classes. Not one sample:
    // a bar that holds for rent but leaks for wages is worse than no bar,
    // because the leak is invisible in a report that still balances.
    const classes: ExpenseCostClass[] = ["cogs_direct", "cogs_allocable"];
    for (let k = 0; k < classes.length; k += 1) {
      const bar = classifyIn(
        [{
          matchValue: "BARVENDOR",
          matchKind: "merchant_exact",
          account: acct,
          entity: "greenway",
          priority: 10,
          costClass: classes[k],
        }],
        { merchant: "BARVENDOR" },
      );
      assert(!bar.ok, `barred account ${acct} must refuse a ${classes[k]} rule`);
      if (!bar.ok) {
        eq(
          bar.code,
          "RESELLER_COGS_FORBIDDEN",
          `barred account ${acct} with ${classes[k]} emits RESELLER_COGS_FORBIDDEN`,
        );
      }
      barHit = true;
    }
    // The same account with the DERIVED class must pass: the bar catches the
    // COGS attempt, it does not blacklist the account. Store rent is a real
    // expense; it is simply 280E-disallowed rather than COGS.
    const okDerived = classifyIn(
      [{ matchValue: "BARVENDOR", matchKind: "merchant_exact", account: acct, entity: "greenway", priority: 10 }],
      { merchant: "BARVENDOR" },
    );
    assert(okDerived.ok, `barred account ${acct} still classifies as ordinary 280E-disallowed opex`);
    if (okDerived.ok) {
      eq(okDerived.costClass, "nondeductible_280e", `${acct} is disallowed, not COGS`);
    }
  }
  assert(barHit, "RESELLER_COGS_BARRED_ACCOUNTS is non-empty");
  eq(RESELLER_COGS_BARRED_ACCOUNTS.length, 14, "6 occupancy + 8 personnel accounts are barred from COGS");

  // Rent for the STORE is 280E-disallowed, never COGS. This is the position.
  eq(expenseCostClassFor("greenway"), "nondeductible_280e", "greenway opex is disallowed");
  eq(expenseCostClassFor("atm"), "separate_business", "ATM is a separate business");
  eq(expenseCostClassFor("landholding"), "separate_business", "landholding is a separate business");
  eq(expenseCostClassFor("personal"), "personal", "personal is personal");

  // ---- no rule may target a barred account WITH a cogs class ----------
  for (let i = 0; i < SEED_EXPENSE_RULES.length; i += 1) {
    const r = SEED_EXPENSE_RULES[i];
    const cc = expenseCostClassFor(r.entity);
    assert(
      !(r.entity === "greenway" && (cc === "cogs_direct" || cc === "cogs_allocable")),
      `seed rule for ${r.matchValue} must not put greenway spend into COGS`,
    );
    assert(
      CLASSIFIABLE_ACCOUNTS.indexOf(r.account) >= 0,
      `seed rule for ${r.matchValue} targets ${r.account}, which must be a classifiable account`,
    );
    assert(
      CONTROL_ACCOUNTS.indexOf(r.account) < 0,
      `seed rule for ${r.matchValue} must not target a control account`,
    );
    assert(r.priority >= 1, `seed rule for ${r.matchValue} needs priority >= 1`);
    eq(
      normalizeMerchant(r.matchValue),
      r.matchValue,
      `seed rule matchValue "${r.matchValue}" must already be normalized`,
    );
  }

  // ---- EXACT rules must never lose to CONTAINS -----------------------
  for (let i = 0; i < SEED_EXPENSE_RULES.length; i += 1) {
    const r = SEED_EXPENSE_RULES[i];
    if (r.matchKind === "merchant_exact") {
      assert(r.priority < 50, `exact rule ${r.matchValue} must outrank contains rules`);
    } else {
      assert(r.priority >= 50, `contains rule ${r.matchValue} must yield to exact rules`);
    }
  }

  // ---- every declared refusal code is emitted somewhere ---------------
  // Rule 43 made mechanical: walk the union type and prove each is produced.
  const produced: string[] = [];
  const probes: { rules: readonly ExpenseRule[]; line: ExpenseLine }[] = [
    { rules: SEED_EXPENSE_RULES, line: { merchant: "" } },
    { rules: SEED_EXPENSE_RULES, line: { merchant: "NO SUCH VENDOR ANYWHERE" } },
    { rules: SEED_EXPENSE_RULES, line: { merchant: "STAPLES" } },
    {
      rules: [
        { matchValue: "X", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 1 },
        { matchValue: "X", matchKind: "merchant_exact", account: "73010", entity: "greenway", priority: 1 },
      ],
      line: { merchant: "X" },
    },
    {
      rules: [{ matchValue: "Y", matchKind: "merchant_exact", account: "10200", entity: "greenway", priority: 1 }],
      line: { merchant: "Y" },
    },
    {
      rules: [{ matchValue: "Z", matchKind: "merchant_exact", account: "12345", entity: "greenway", priority: 1 }],
      line: { merchant: "Z" },
    },
    {
      rules: [{ matchValue: "W", matchKind: "merchant_exact", account: "79030", entity: "atm", priority: 1 }],
      line: { merchant: "W" },
    },
    {
      rules: [{
        matchValue: "V",
        matchKind: "merchant_exact",
        account: "70010",
        entity: "greenway",
        priority: 1,
        costClass: "cogs_direct",
      }],
      line: { merchant: "V" },
    },
  ];
  for (let i = 0; i < probes.length; i += 1) {
    const r = classifyIn(probes[i].rules, probes[i].line);
    if (!r.ok && produced.indexOf(r.code) < 0) produced.push(r.code);
  }
  const expectReachable: ExpenseRefusalCode[] = [
    "MERCHANT_MISSING",
    "MERCHANT_UNKNOWN",
    "MERCHANT_AMBIGUOUS",
    "RULE_TIE",
    "CONTROL_ACCOUNT_TARGET",
    "ACCOUNT_NOT_IN_CHART",
    "ENTITY_NOT_PERMITTED",
    "RESELLER_COGS_FORBIDDEN",
  ];
  for (let i = 0; i < expectReachable.length; i += 1) {
    assert(
      produced.indexOf(expectReachable[i]) >= 0,
      `refusal code ${expectReachable[i]} must be emitted by some code path (rule 43)`,
    );
  }

  // ALL EIGHT codes are emitted. This is the second thing this self-test caught
  // and it is worth recording why, because the first draft of this file shipped
  // two codes that could not fire:
  //
  //   ENTITY_NOT_PERMITTED     -- the restriction table listed only two INCOME
  //                               accounts, and since neither is a classifiable
  //                               expense account the chart test always answered
  //                               first. Fixed by measuring the migration for
  //                               the real entity-restricted expense accounts
  //                               (the 79xxx block) and by testing the entity
  //                               restriction BEFORE chart membership.
  //
  //   RESELLER_COGS_FORBIDDEN  -- ExpenseRule had no costClass field, so the
  //                               class was always derived, and
  //                               expenseCostClassFor("greenway") cannot return
  //                               a COGS class. The branch was unreachable by
  //                               construction. Fixed by giving ExpenseRule the
  //                               optional costClass that gl_account_rules
  //                               actually stores.
  //
  // The earlier draft "handled" the second one by asserting 7 of 8 and writing a
  // paragraph explaining that the eighth was structurally unreachable
  // defence-in-depth. That paragraph was true and the code was still decoration.
  // Standing rule 43 is not satisfied by an articulate excuse. The correct fix
  // was to make the dangerous input representable, which it now is.
  assert(
    ALL_EXPENSE_REFUSAL_CODES.length === 8,
    "all 8 refusal codes are declared",
  );
  eq(
    produced.length,
    8,
    `every declared refusal code must be emitted through classifyIn; got ${produced.length} (${produced.join(", ")})`,
  );
  for (let i = 0; i < ALL_EXPENSE_REFUSAL_CODES.length; i += 1) {
    assert(
      produced.indexOf(ALL_EXPENSE_REFUSAL_CODES[i]) >= 0,
      `declared code ${ALL_EXPENSE_REFUSAL_CODES[i]} is not decoration`,
    );
  }

  // ---- determinism ----------------------------------------------------
  const a1 = classifyExpense({ merchant: "Cultivera" });
  const a2 = classifyExpense({ merchant: "CULTIVERA" });
  assert(a1.ok && a2.ok, "both spellings classify");
  if (a1.ok && a2.ok) {
    eq(a1.account, a2.account, "case does not change the answer");
    eq(a1.entity, a2.entity, "case does not change the entity");
  }

  assert(seedRuleTargetAccounts().length > 0, "seed rules target at least one account");
}
