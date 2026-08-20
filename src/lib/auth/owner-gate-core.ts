/**
 * src/lib/auth/owner-gate-core.ts   (slice books-06 — CLOSE THE OWNER GATE GAP)
 *
 * PURE logic. No I/O, no React, no Supabase — every export is data or a
 * computation, so all of it is testable and none of it can drift silently.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * Slice books-02 (migration 0185) locked the general ledger to the owner. Its
 * verification function, `gl_audit_owner_only_gate()`, returns ZERO ROWS — and
 * that is true, and it is also the problem.
 *
 * That audit only ever looked at tables named `gl_*`:
 *
 *     where c.relname like 'gl\_%'
 *
 * Michael's money does not all live in tables named `gl_*`. It lives in the
 * bank feed (`plaid_*`), the ATM (`atm_*`), the crypto portfolio (`crypto_*`)
 * and the personal loans (`manual_loan*`). Those tables were created by earlier
 * slices, before the owner-only decision existed, and they were gated with the
 * house default of the time:
 *
 *     using (is_staff())        -- on cmd = ALL, i.e. read AND write
 *
 * `is_staff()` is, verbatim from the live database:
 *
 *     select exists(select 1 from public.staff_profiles
 *                   where id = auth.uid() and active = true);
 *
 * There is NO ROLE FILTER in it. The `staff_role` enum has six values —
 * owner, admin, manager, content_editor, staff, readonly — so `is_staff()` is
 * TRUE for a content editor and TRUE for a readonly account.
 *
 * The consequence, measured against the live database rather than assumed:
 * 25 policies on 25 financial tables permitted ANY active staff member to read
 * AND write the owner's bank balances, mortgage payoff and past-due amounts,
 * ATM cash, crypto wallets, and personal loan balances.
 *
 * ---------------------------------------------------------------------------
 * 🔴 THE WORST ONE: plaid_items.access_token
 * ---------------------------------------------------------------------------
 * `plaid_items` stores the Plaid ACCESS TOKEN (column verified present and
 * `not null` in migration 0157). That is a live banking credential. A person
 * holding it can pull the owner's full account history OUTSIDE this
 * application entirely — where none of our gates, none of our logging, and
 * none of our audit trail apply.
 *
 * Every other item in this slice is a privacy fix. This one is a credential
 * exposure, and it is why this slice was worth doing before anything else.
 *
 * ---------------------------------------------------------------------------
 * WHY AN EXPLICIT LIST AND NOT A PATTERN
 * ---------------------------------------------------------------------------
 * The obvious implementation is a sweep:
 *
 *     where tablename like 'plaid%' or tablename like 'crypto%' ...
 *
 * That is rejected on purpose. A pattern silently captures whatever a FUTURE
 * migration happens to name `plaid_*`, and silently MISSES a future financial
 * table that is named something else. Both directions are wrong, and both are
 * invisible. A gate that changes scope without anyone editing it is not a
 * gate; it is a coincidence.
 *
 * So the inventory below is explicit, every entry carries the reason it is in
 * or out, and the tests assert the SQL migration and this file agree exactly.
 *
 * ---------------------------------------------------------------------------
 * 🔴 THE TWO TABLES THAT MUST **NOT** BE LOCKED
 * ---------------------------------------------------------------------------
 * `tax_settings` and `tax_category_rules` also match `is_staff()`. They are
 * DELIBERATELY LEFT ALONE, and getting this wrong would be worse than the bug
 * being fixed.
 *
 * Their policies are `cmd = SELECT` (`*_read`); writes are already `is_admin()`.
 * They hold POS PRICING CONFIGURATION — the tax rates a register needs to
 * compute a sale. Lock them to the owner and every budtender's till stops
 * calculating tax, i.e. the store cannot sell anything.
 *
 * They are listed here as explicit exclusions WITH their reason, following the
 * discipline migration 0185 §4 established: an omission that is a decision must
 * be written down, or the next reader will "fix" it.
 */

import { ALL_ROLES, can, rolesForPermission } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";

/* ========================================================================== */
/* §1  ROLES                                                                  */
/* ========================================================================== */

/**
 * Every role in the system, as a TOTAL record rather than an array.
 *
 * Same reasoning as `books-view-core.ts`: a `Record<StaffRole, true>` fails to
 * COMPILE when someone adds a role to the union and forgets it here. A plain
 * `StaffRole[]` would accept a short list silently, and every "we covered every
 * role" test below would quietly start covering less while still passing.
 */
const ROLE_PRESENCE: Record<StaffRole, true> = {
  owner: true,
  admin: true,
  manager: true,
  content_editor: true,
  staff: true,
  readonly: true,
};

export const ALL_STAFF_ROLES: readonly StaffRole[] = Object.keys(
  ROLE_PRESENCE,
) as StaffRole[];

/**
 * What `is_staff()` means in the database, expressed in TypeScript.
 *
 * Verified against the live function body, not assumed:
 *   select exists(select 1 from public.staff_profiles
 *                 where id = auth.uid() and active = true)
 *
 * No role filter => every role qualifies. This constant exists so the tests can
 * state the blast radius as a fact rather than a comment.
 */
export const DB_IS_STAFF_ROLES: readonly StaffRole[] = ALL_STAFF_ROLES;

/** What `is_owner()` means in the database. Verified against the live body. */
export const DB_IS_OWNER_ROLES: readonly StaffRole[] = ["owner"] as const;

/** What `is_admin()` means in the database. Verified against the live body. */
export const DB_IS_ADMIN_ROLES: readonly StaffRole[] = ["owner", "admin"] as const;

/* ========================================================================== */
/* §2  THE FINANCIAL TABLE INVENTORY                                          */
/* ========================================================================== */

/** Which area of Michael's financial life a table belongs to. */
export type FinancialArea = "bank" | "atm" | "crypto" | "loans";

/**
 * How bad it would be if the wrong person read this table.
 *
 *   credential — contains a secret that grants access to money or data
 *                OUTSIDE this application. Nothing else is in this class.
 *   balance    — reveals how much money the owner has or owes.
 *   activity   — reveals what the owner spent, earned, or moved.
 *   plumbing   — sync cursors, price snapshots, webhook receipts. Low direct
 *                sensitivity, but locked anyway: it is joined to the rows above
 *                and a writable cursor can be used to corrupt what does load.
 */
export type ExposureClass = "credential" | "balance" | "activity" | "plumbing";

export type FinancialTable = {
  /** Exact table name in the `public` schema. */
  readonly table: string;
  /** Which part of the owner's financial life it belongs to. */
  readonly area: FinancialArea;
  /** What is actually at risk. */
  readonly exposure: ExposureClass;
  /** Plain English: what a person reading this table would learn. */
  readonly whatItReveals: string;
};

/**
 * THE 25 TABLES THIS SLICE RE-GATES from `is_staff()` to `is_owner()`.
 *
 * Enumerated from `pg_policies` against the live database on 2026-08-18, not
 * from reading migration files. Migration files are history; policies are what
 * is actually enforced, and the two can disagree.
 */
export const FINANCIAL_TABLES: readonly FinancialTable[] = [
  /* ---- Bank feed (Plaid) ------------------------------------------------ */
  {
    table: "plaid_items",
    area: "bank",
    exposure: "credential",
    whatItReveals:
      "The Plaid access token itself. Holding this lets a person pull the owner's entire banking history from outside this application, where none of our gates or logging apply.",
  },
  {
    table: "plaid_accounts",
    area: "bank",
    exposure: "balance",
    whatItReveals:
      "Every connected account, its name, its last four digits, and its current and available balance.",
  },
  {
    table: "plaid_transactions",
    area: "bank",
    exposure: "activity",
    whatItReveals:
      "Every dollar in and out of every connected account, with merchant names and dates.",
  },
  {
    table: "plaid_mortgages",
    area: "bank",
    exposure: "balance",
    whatItReveals:
      "Mortgage payoff, escrow balance, next payment, late fees and any past-due amount.",
  },
  {
    table: "plaid_holdings",
    area: "bank",
    exposure: "balance",
    whatItReveals:
      "Every investment position, what it is worth today, and what was paid " +
      "for it. The cost basis is what decides the capital gain when it is " +
      "sold, so this is both a net-worth disclosure and a tax figure.",
  },
  {
    table: "plaid_webhook_events",
    area: "bank",
    exposure: "plumbing",
    whatItReveals:
      "Raw notifications from Plaid, which quote account identifiers and can be forged if writable.",
  },

  /* ---- ATM -------------------------------------------------------------- */
  {
    table: "atm_transactions",
    area: "atm",
    exposure: "activity",
    whatItReveals: "Every ATM withdrawal, with amounts and surcharges.",
  },
  {
    table: "atm_settlements",
    area: "atm",
    exposure: "balance",
    whatItReveals:
      "What the ATM processor settled and what the surcharge revenue was.",
  },
  {
    table: "atm_cash_loads",
    area: "atm",
    exposure: "balance",
    whatItReveals:
      "How much cash was loaded into the machine and when — which is also a physical-security fact about the building.",
  },
  {
    table: "atm_reconciliation",
    area: "atm",
    exposure: "balance",
    whatItReveals: "Whether the ATM's cash agrees with the processor, and by how much.",
  },
  {
    table: "atm_connection",
    area: "atm",
    exposure: "credential",
    whatItReveals: "The stored connection settings for the ATM processor account.",
  },
  {
    table: "atm_terminal_status",
    area: "atm",
    exposure: "plumbing",
    whatItReveals:
      "How much cash is inside the machine right now, where the machine is, " +
      "and how many days until it runs out and has to be refilled. That is " +
      "not an accounting fact, it is a physical-security fact: it tells a " +
      "reader when the most cash is on site and when someone will be " +
      "carrying it through the door.",
  },

  /* ---- Crypto ----------------------------------------------------------- */
  {
    table: "crypto_wallets",
    area: "crypto",
    exposure: "credential",
    whatItReveals:
      "Wallet addresses. A public address is not a private key, but it is permanently linkable — anyone with it can watch every transaction that wallet ever makes, forever, on a public chain.",
  },
  {
    table: "crypto_assets",
    area: "crypto",
    exposure: "balance",
    whatItReveals:
      "Which assets are held, and the decimals each amount is scaled by. " +
      "Writable, the decimals field silently moves every balance and every " +
      "reported gain by a factor of ten, a hundred, a thousand -- with no " +
      "error and nothing out of balance. The hidden flag can also make an " +
      "entire asset disappear from the screen while it still exists.",
  },
  {
    table: "crypto_balances",
    area: "crypto",
    exposure: "balance",
    whatItReveals: "How much of each asset is held and what it is worth.",
  },
  {
    table: "crypto_transactions",
    area: "crypto",
    exposure: "activity",
    whatItReveals:
      "Every crypto movement in and out, with the amount, the dollar value, " +
      "the counterparty and the on-chain transaction hash. The hash is a " +
      "permanent public receipt -- anyone holding it can look up that " +
      "transaction, and the wallets on both ends of it, forever.",
  },
  {
    table: "crypto_tx_classifications",
    area: "crypto",
    exposure: "activity",
    whatItReveals:
      "How each movement was characterised for tax — which is the owner's tax position in draft form.",
  },
  {
    table: "crypto_transfer_matches",
    area: "crypto",
    exposure: "activity",
    whatItReveals: "Which movements are the owner's own transfers between his own wallets.",
  },
  {
    table: "crypto_classification_rules",
    area: "crypto",
    exposure: "plumbing",
    whatItReveals:
      "The rules that decide tax treatment. Writable, these silently change the tax answer on every future transaction.",
  },
  {
    table: "crypto_price_snapshots",
    area: "crypto",
    exposure: "plumbing",
    whatItReveals:
      "Historical prices used for cost basis. Writable, these silently change reported gains.",
  },
  {
    table: "crypto_sync_state",
    area: "crypto",
    exposure: "plumbing",
    whatItReveals: "Sync cursors. Writable, these can be used to hide activity by skipping it.",
  },
  {
    table: "crypto_asset_migrations",
    area: "crypto",
    exposure: "plumbing",
    whatItReveals:
      "How one asset was converted into another and at what ratio. Writable, " +
      "the ratio rescales holdings and the cost basis that rides on them, " +
      "which changes the taxable gain without changing a single transaction.",
  },
  {
    table: "crypto_owner_wallet_confirmations",
    area: "crypto",
    exposure: "activity",
    whatItReveals:
      "Which wallets the owner has attested are his own — the evidence behind treating a transfer as non-taxable.",
  },

  /* ---- Loans ------------------------------------------------------------ */
  {
    table: "manual_loans",
    area: "loans",
    exposure: "balance",
    whatItReveals:
      "Every loan, its original principal, current balance, rate and scheduled payment.",
  },
  {
    table: "manual_loan_payments",
    area: "loans",
    exposure: "activity",
    whatItReveals:
      "Every payment made against every loan, split into principal, " +
      "interest, escrow and fees. The interest column is the deduction " +
      "claimed under IRC section 163(a); writable, it moves a deduction on " +
      "a filed return.",
  },
] as const;

/** The table names alone, for the SQL parity tests. */
export const FINANCIAL_TABLE_NAMES: readonly string[] =
  FINANCIAL_TABLES.map((t) => t.table);

/* ========================================================================== */
/* §3  THE DELIBERATE EXCLUSIONS                                              */
/* ========================================================================== */

export type GateExclusion = {
  readonly table: string;
  /** Why locking this would be WORSE than leaving it. Must be specific. */
  readonly reason: string;
  /** What breaks if a future reader "fixes" this. */
  readonly ifLockedAnyway: string;
};

/**
 * Tables that match the `is_staff()` search but MUST STAY as they are.
 *
 * Recorded loudly, because the failure mode of an undocumented exclusion is a
 * future engineer noticing the inconsistency and "completing" the lockdown.
 */
export const GATE_EXCLUSIONS: readonly GateExclusion[] = [
  {
    table: "tax_settings",
    reason:
      "POS pricing configuration, not a financial record. A budtender's register must READ the tax rate to compute a sale. The policy is SELECT-only; writes are already is_admin().",
    ifLockedAnyway:
      "Every register on the floor loses the ability to calculate tax, and the store cannot complete a sale.",
  },
  {
    table: "tax_category_rules",
    reason:
      "Same: which products are taxed how. Read by the register at sale time. SELECT-only policy; writes are already is_admin().",
    ifLockedAnyway:
      "Products would be taxed at the wrong rate or refuse to ring up, which is both a revenue problem and a WAC 314-55-087(1)(r) recordkeeping problem.",
  },
] as const;

export const GATE_EXCLUSION_NAMES: readonly string[] =
  GATE_EXCLUSIONS.map((e) => e.table);

/* ========================================================================== */
/* §4  THE APPLICATION-LAYER GATE                                             */
/* ========================================================================== */

/**
 * WHO MAY OPEN THE FINANCIAL SCREENS (ATM, Crypto, Loans).
 *
 * OWNER DECISION, recorded verbatim (Michael, 2026-08-17):
 *   "there is no reason anyone else needs to see my books or my financials
 *    ever... The only thing an admin can do is pay vendors and pay employees."
 *
 * Before this slice these three pages were gated on `settings.manage`, which
 * roles.ts grants to ["owner","admin"]. Reading the mortgage balance and the
 * crypto portfolio is neither paying a vendor nor paying an employee, so the
 * page gate was wider than the owner's instruction.
 *
 * This mirrors `canReadBooks()` in books-view-core.ts. The two doors — page
 * gate and RLS policy — must name the SAME set of roles, or a user passes one
 * and is refused by the other and lands on a real-looking screen full of error
 * text. That is the exact trap books-view-core.ts was written to close, and it
 * applies here for the same reason.
 */
export function canViewFinances(role: StaffRole | null | undefined): boolean {
  if (!role) return false;
  return can(role, "finances.view");
}

/** The three admin routes this slice re-gates, and the guard each must use. */
export const FINANCE_ROUTES: readonly { route: string; permission: string }[] = [
  { route: "/admin/plaid", permission: "finances.view" },
  { route: "/admin/atm", permission: "finances.view" },
  { route: "/admin/crypto", permission: "finances.view" },
  { route: "/admin/loans", permission: "finances.view" },
] as const;

/**
 * OWNER-ONLY ROUTES THAT ARE NOT ABOUT MONEY.
 *
 * FINANCE_ROUTES above answers "who may see the owner's financial position".
 * This list answers a different question: "who may see the record of what
 * everybody did". They are kept apart because they are gated on different
 * permissions and would be argued about separately -- merging them would make
 * the finance list say something it does not mean.
 *
 * Added in books-22 on the owner's instruction, verbatim (2026-08-20):
 *
 *   "they shouldn't be able to see my personal finances, the plaid feeds, the
 *    crypto, the atm, or the audit log, which you are right, let's change it
 *    to be Security Log."
 *
 * The Security Log is the record someone would have to edit to hide something,
 * which is exactly why the person being recorded should not be the person who
 * can read it -- and why update and delete are revoked from every role,
 * including the service role, in migration 0130 and again in 0193.
 */
export const OWNER_ONLY_OVERSIGHT_ROUTES: readonly {
  route: string;
  permission: string;
  why: string;
}[] = [
  {
    route: "/admin/audit",
    permission: "audit.view",
    why:
      "The Security Log: who did what, and when. It was on users.manage, which " +
      "is owner|admin, so the admin could read the log of their own actions. " +
      "Moved to its own owner-only permission rather than by narrowing " +
      "users.manage, because narrowing that would also have taken user " +
      "management away from the admin, which the owner did not ask for.",
  },
] as const;

/**
 * Money-adjacent routes that DELIBERATELY stay on settings.manage (owner|admin).
 *
 * /admin/settings/banking is the VENDOR AND EMPLOYEE PAYEE VAULT. It reads
 * vendors, vendor_bank_details and employees -- none of which are in
 * FINANCIAL_TABLES, and none of which reveal the owner's financial position.
 * It is the tool an admin uses to DO the two jobs the owner explicitly left
 * with admin: "The only thing an admin can do is pay vendors and pay
 * employees." Moving it to finances.view would take away the very thing the
 * owner said to keep.
 *
 * Recorded here so a future reader who sees a "banking" page still open to
 * admin knows it was examined and decided, not missed.
 */
export const DELIBERATELY_NOT_OWNER_ONLY: readonly {
  route: string;
  permission: string;
  why: string;
}[] = [
  {
    route: "/admin/settings/banking",
    permission: "settings.manage",
    why:
      "The vendor and employee payee vault. Reads vendors, vendor_bank_details " +
      "and employees -- not the owner's accounts, balances or positions. This " +
      "is how an admin pays vendors and pays employees, which the owner " +
      "explicitly kept with admin. RE-CONFIRMED 2026-08-20, in the same " +
      "sentence that closed the other doors: \"I am fine with my admin manager " +
      "to pay employees and vendors, but they shouldn't be able to see my " +
      "personal finances, the plaid feeds, the crypto, the atm, or the audit " +
      "log.\" The instruction to lock things down was not an instruction to " +
      "lock this one down, and a tidy-up that swept it in would be breaking " +
      "payroll to satisfy a pattern.",
  },
] as const;

/* ========================================================================== */
/* §5  AUTHORITIES, VERBATIM                                                  */
/* ========================================================================== */

export type GateAuthority = {
  readonly id: string;
  readonly cite: string;
  /** EXACT text. Never paraphrased, never trimmed to fit. */
  readonly quote: string;
  /** Why it applies to this specific decision, in Michael's plain English. */
  readonly soWhat: string;
  readonly source: string;
};

/**
 * Fetched from the live authoritative sources on 2026-08-18 and quoted exactly.
 * Standing rule 2: never guess, cite the source.
 */
export const GATE_AUTHORITIES: readonly GateAuthority[] = [
  {
    id: "FTC_SAFEGUARDS_LEAST_PRIVILEGE",
    cite: "FTC Safeguards Rule, 16 CFR 314.4(c)(1)",
    quote:
      "Implementing and periodically reviewing access controls, including technical and, as appropriate, physical controls to: (i) Authenticate and permit access only to authorized users to protect against the unauthorized acquisition of customer information; and (ii) Limit authorized users' access only to customer information that they need to perform their duties and functions, or, in the case of customers, to access their own information;",
    soWhat:
      "This is the rule in one sentence: people get access to what their job needs, and nothing else. A content editor's job never needs the mortgage payoff balance or a banking access token. That is the whole of this slice.",
    source:
      "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314/section-314.4",
  },
  {
    id: "FTC_SAFEGUARDS_MONITOR_USERS",
    cite: "FTC Safeguards Rule, 16 CFR 314.4(c)(8)",
    quote:
      "Implement policies, procedures, and controls designed to monitor and log the activity of authorized users and detect unauthorized access or use of, or tampering with, customer information by such users.",
    soWhat:
      "Note the last three words: by such users. The rule expects that the danger includes people who are legitimately logged in. That is precisely the case here - nobody has to break in to read these tables today, they just have to work here.",
    source:
      "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314/section-314.4",
  },
  {
    id: "GLBA_UNAUTHORIZED_ACCESS",
    cite: "Gramm-Leach-Bliley Act, 15 U.S.C. 6801(b)(3)",
    quote:
      "to protect against unauthorized access to or use of such records or information which could result in substantial harm or inconvenience to any customer.",
    soWhat:
      "The statute behind the FTC rule above. It is written around 'unauthorized access', and an access token sitting in a table any active staff account can select is the textbook example.",
    source: "https://www.law.cornell.edu/uscode/text/15/6801",
  },
  {
    id: "IRS_4557_NEED_TO_KNOW",
    cite: "IRS Publication 4557, Checklist for Safeguarding Taxpayer Data - Information Systems Security",
    quote:
      "Grant access to taxpayer information systems only on a valid need-to-know basis that is determined by the individual's role within the business.",
    soWhat:
      "The IRS's own checklist, and it names the exact mechanism this slice uses: access decided BY ROLE. Before this slice the role was ignored entirely - is_staff() has no role filter in it at all.",
    source:
      "https://www.irs.gov/pub/irs-schema/Checklist%20for%20Safeguarding%20Taxpayer%20Data.pdf",
  },
  {
    id: "IRS_4557_TERMINATE_ACCESS",
    cite: "IRS Publication 4557, Checklist for Safeguarding Taxpayer Data - Personnel Security",
    quote:
      "Terminate access to taxpayer information (e.g., login IDs and passwords) for those employees who are terminated or who no longer need access.",
    soWhat:
      "Worth reading next to how is_staff() is written. It checks active = true, so deactivating a staff profile does cut them off. The gap was never about leavers - it was that current staff had access they never needed.",
    source:
      "https://www.irs.gov/pub/irs-schema/Checklist%20for%20Safeguarding%20Taxpayer%20Data.pdf",
  },
  {
    id: "WAC_314_55_087_TRUE_PARTY",
    cite: "WAC 314-55-087(1)(c)",
    quote:
      "Accounting and tax records related to the licensed business and each true party of interest;",
    soWhat:
      "Michael is a true party of interest, so his personal financial records are inside the LCB's recordkeeping scope. That cuts both ways: the records must be kept for five years AND they must be controlled, because they are now regulator-facing records rather than private paperwork.",
    source: "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-087",
  },
  {
    id: "WAC_314_55_087_CONTROLS",
    cite: "WAC 314-55-087(2)(c)",
    quote:
      "Has available a full description of the ADP and/or POS portion of the accounting system. This should show the applications being performed, the procedures employed in each application, and the controls used to ensure accurate and reliable processing.",
    soWhat:
      "The LCB can ask to see the CONTROLS, not just the numbers. 'Any active employee could read and rewrite the bank feed' is a bad answer to that question. After this slice the answer is a one-line audit function that returns nothing.",
    source: "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-087",
  },
  {
    id: "REG_1_6001_1_AVAILABLE",
    cite: "Reg. 1.6001-1(e)",
    quote:
      "The books or records required by this section shall be kept at all times available for inspection by authorized internal revenue officers or employees, and shall be retained so long as the contents thereof may become material in the administration of any internal revenue law.",
    soWhat:
      "'Authorized' is the operative word. Records have to be available to the right people and protected from everyone else. Write access is the real exposure here: a record anyone could have altered is a record that is harder to stand behind years later.",
    source: "https://www.law.cornell.edu/cfr/text/26/1.6001-1",
  },
] as const;

export function findGateAuthority(id: string): GateAuthority | undefined {
  return GATE_AUTHORITIES.find((a) => a.id === id);
}

/* ========================================================================== */
/* §6  SUMMARY HELPERS (for the admin page)                                   */
/* ========================================================================== */

export function tablesForArea(area: FinancialArea): readonly FinancialTable[] {
  return FINANCIAL_TABLES.filter((t) => t.area === area);
}

export function tablesForExposure(
  exposure: ExposureClass,
): readonly FinancialTable[] {
  return FINANCIAL_TABLES.filter((t) => t.exposure === exposure);
}

/** Human label for an area, used by the UI. Total, so a new area cannot be forgotten. */
export const AREA_LABELS: Record<FinancialArea, string> = {
  bank: "Bank feed",
  atm: "ATM",
  crypto: "Crypto",
  loans: "Loans",
};

/** Human label for an exposure class. Total for the same reason. */
export const EXPOSURE_LABELS: Record<ExposureClass, string> = {
  credential: "Credential — opens a door outside this app",
  balance: "Balance — how much you have or owe",
  activity: "Activity — what you spent, earned or moved",
  plumbing: "Plumbing — feeds the numbers above",
};

/* ========================================================================== */
/* §7  SELF-TESTS                                                             */
/* ========================================================================== */

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`owner-gate-core: ${msg}`);
}

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `owner-gate-core: ${msg} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

export function __runOwnerGateCoreTests(): void {
  /* ---- roles ---------------------------------------------------------- */
  eq(ALL_STAFF_ROLES.length, 6, "there are six staff roles");
  ok(ALL_STAFF_ROLES.includes("content_editor"), "content_editor is a role");
  ok(ALL_STAFF_ROLES.includes("readonly"), "readonly is a role");

  // The blast radius, stated as an assertion rather than a comment.
  eq(
    DB_IS_STAFF_ROLES.length,
    ALL_STAFF_ROLES.length,
    "is_staff() has no role filter, so it covers EVERY role",
  );
  eq(DB_IS_OWNER_ROLES.length, 1, "is_owner() is exactly one role");
  eq(DB_IS_OWNER_ROLES[0], "owner", "and that role is owner");
  eq(DB_IS_ADMIN_ROLES.length, 2, "is_admin() is owner + admin");

  /* ---- the inventory --------------------------------------------------- */
  eq(FINANCIAL_TABLES.length, 25, "25 financial tables are re-gated");

  // No duplicates. A duplicate would make the count look right while a real
  // table went missing.
  const seen = new Set<string>();
  for (const t of FINANCIAL_TABLES) {
    ok(!seen.has(t.table), `duplicate table in the inventory: ${t.table}`);
    seen.add(t.table);
  }
  eq(seen.size, 25, "25 DISTINCT tables");

  // Every entry must be fully described. An entry with an empty reason is an
  // entry nobody can review.
  for (const t of FINANCIAL_TABLES) {
    ok(t.table.length > 0, "every entry has a table name");
    ok(
      t.whatItReveals.length >= 30,
      `${t.table}: whatItReveals must actually explain (got ${t.whatItReveals.length} chars)`,
    );
    ok(
      !/^(todo|tbd|n\/a|see above|same)\b/i.test(t.whatItReveals.trim()),
      `${t.table}: whatItReveals is a non-answer`,
    );
  }

  // Area coverage, counted from the live query that produced this list.
  eq(tablesForArea("bank").length, 6, "6 Plaid tables");
  eq(tablesForArea("atm").length, 6, "6 ATM tables");
  eq(tablesForArea("crypto").length, 11, "11 crypto tables");
  eq(tablesForArea("loans").length, 2, "2 loan tables");
  eq(
    tablesForArea("bank").length +
      tablesForArea("atm").length +
      tablesForArea("crypto").length +
      tablesForArea("loans").length,
    FINANCIAL_TABLES.length,
    "every table belongs to exactly one area — no table is unclassified",
  );

  // The credential tables are the reason this slice is urgent.
  const creds = tablesForExposure("credential").map((t) => t.table);
  ok(creds.includes("plaid_items"), "plaid_items is classed as a credential");
  ok(creds.includes("atm_connection"), "atm_connection is classed as a credential");
  ok(creds.includes("crypto_wallets"), "crypto_wallets is classed as a credential");

  // plaid_items is the single worst one; its description must say why.
  const plaidItems = FINANCIAL_TABLES.find((t) => t.table === "plaid_items");
  ok(!!plaidItems, "plaid_items is in the inventory");
  ok(
    /outside this application/i.test(plaidItems!.whatItReveals),
    "plaid_items explains that the token works OUTSIDE this app — the whole reason it is worst",
  );

  /* ---- the exclusions -------------------------------------------------- */
  eq(GATE_EXCLUSIONS.length, 2, "exactly two deliberate exclusions");
  ok(GATE_EXCLUSION_NAMES.includes("tax_settings"), "tax_settings is excluded");
  ok(
    GATE_EXCLUSION_NAMES.includes("tax_category_rules"),
    "tax_category_rules is excluded",
  );

  for (const e of GATE_EXCLUSIONS) {
    ok(e.reason.length >= 40, `${e.table}: exclusion reason must be substantive`);
    ok(
      e.ifLockedAnyway.length >= 30,
      `${e.table}: must say what breaks if someone locks it anyway`,
    );
  }

  // An excluded table must never also appear in the lock list. If it did, the
  // migration would lock it and the docs would say it was left alone.
  for (const name of GATE_EXCLUSION_NAMES) {
    ok(
      !FINANCIAL_TABLE_NAMES.includes(name),
      `${name} is BOTH excluded and locked — the two lists contradict each other`,
    );
  }

  /* ---- the application gate -------------------------------------------- */
  // finances.view must be owner-alone, and must agree with is_owner().
  const financeRoles = rolesForPermission("finances.view");
  eq(financeRoles.length, 1, "finances.view is granted to exactly one role");
  eq(financeRoles[0], "owner", "and that role is owner");

  for (const role of ALL_STAFF_ROLES) {
    const app = canViewFinances(role);
    const db = DB_IS_OWNER_ROLES.includes(role);
    eq(
      app,
      db,
      `page gate and database gate must agree for role "${role}" — a mismatch means a real-looking screen full of error text`,
    );
  }

  eq(canViewFinances(null), false, "no role cannot view finances");
  eq(canViewFinances(undefined), false, "undefined role cannot view finances");
  eq(canViewFinances("admin"), false, "an admin may pay people, not read the portfolio");
  eq(canViewFinances("owner"), true, "the owner can");

  // ALL_ROLES from roles.ts must agree with our local total record. If roles.ts
  // grows a role and ROLE_PRESENCE does not, this catches it at runtime too.
  eq(
    ALL_ROLES.length,
    ALL_STAFF_ROLES.length,
    "roles.ts and owner-gate-core agree on how many roles exist",
  );

  /* ---- routes ---------------------------------------------------------- */
  eq(FINANCE_ROUTES.length, 4, "four financial routes are re-gated");

  // The banking payee vault must NOT be swept into the owner gate. If someone
  // "tidies up" by moving it, this fails and explains why it must not move.
  ok(
    DELIBERATELY_NOT_OWNER_ONLY.some((r) => r.route === "/admin/settings/banking"),
    "/admin/settings/banking is recorded as a deliberate NON-owner-only route",
  );
  for (const r of DELIBERATELY_NOT_OWNER_ONLY) {
    eq(r.permission, "settings.manage", `${r.route} stays on settings.manage`);
    ok(r.why.length >= 60, `${r.route}: the reason must actually explain`);
    ok(
      !FINANCE_ROUTES.some((f) => f.route === r.route),
      `${r.route} cannot be in BOTH the owner-only list and the exclusion list`,
    );
  }
  // ── books-22: the oversight route, kept separate from the money routes ──
  eq(OWNER_ONLY_OVERSIGHT_ROUTES.length, 1, "one oversight route today: the Security Log");
  ok(
    OWNER_ONLY_OVERSIGHT_ROUTES.some((r) => r.route === "/admin/audit"),
    "the Security Log is recorded as owner-only",
  );
  for (const r of OWNER_ONLY_OVERSIGHT_ROUTES) {
    eq(r.permission, "audit.view", `${r.route} is gated on audit.view`);
    ok(r.why.length >= 60, `${r.route}: the reason must actually explain`);
    ok(
      !FINANCE_ROUTES.some((f) => f.route === r.route),
      `${r.route} must not also be listed as a money route`,
    );
    ok(
      !DELIBERATELY_NOT_OWNER_ONLY.some((d) => d.route === r.route),
      `${r.route} cannot be owner-only AND deliberately not owner-only`,
    );
  }
  // The owner re-confirmed the banking exception in the SAME sentence that
  // closed the other doors. Rule 24: the quote is what makes it a decision.
  ok(
    DELIBERATELY_NOT_OWNER_ONLY.some((r) =>
      r.why.includes("I am fine with my admin manager to pay employees and vendors"),
    ),
    "the banking exception carries the owner's own words",
  );

  for (const r of FINANCE_ROUTES) {
    ok(r.route.startsWith("/admin/"), `${r.route} is an admin route`);
    eq(
      r.permission,
      "finances.view",
      `${r.route} must use finances.view, not settings.manage`,
    );
  }

  /* ---- authorities ----------------------------------------------------- */
  ok(GATE_AUTHORITIES.length >= 8, "at least eight authorities are quoted");

  const ids = new Set<string>();
  for (const a of GATE_AUTHORITIES) {
    ok(!ids.has(a.id), `duplicate authority id: ${a.id}`);
    ids.add(a.id);

    ok(a.cite.length >= 8, `${a.id}: needs a real citation`);
    ok(a.quote.length >= 60, `${a.id}: a quote this short is probably a summary`);
    ok(a.soWhat.length >= 60, `${a.id}: the gloss must actually explain`);
    ok(a.source.startsWith("https://"), `${a.id}: needs a real source URL`);

    // The same non-answer trap that survived a mutation in slice books-05.
    ok(
      !/^(todo|tbd|n\/a|see above|same as above|as above)\b/i.test(a.soWhat.trim()),
      `${a.id}: soWhat is a non-answer`,
    );

    // A verbatim quote must not contain our own editorial ellipsis at the very
    // start or end — that is a sign it was trimmed to make a point.
    ok(!a.quote.trim().startsWith("..."), `${a.id}: quote starts mid-sentence`);
  }

  // Load-bearing anchors. If the text of one of these is ever softened, the
  // point it is making is gone, and only this assertion would notice.
  const mustSay: [string, RegExp][] = [
    ["FTC_SAFEGUARDS_LEAST_PRIVILEGE", /need to perform their duties and functions/],
    ["FTC_SAFEGUARDS_MONITOR_USERS", /by such users/],
    ["GLBA_UNAUTHORIZED_ACCESS", /unauthorized access/],
    ["IRS_4557_NEED_TO_KNOW", /valid need-to-know basis/],
    ["IRS_4557_TERMINATE_ACCESS", /no longer need access/],
    ["WAC_314_55_087_TRUE_PARTY", /true party of interest/],
    ["WAC_314_55_087_CONTROLS", /controls used to ensure accurate and reliable processing/],
    ["REG_1_6001_1_AVAILABLE", /available for inspection/],
  ];
  for (const [id, re] of mustSay) {
    const a = findGateAuthority(id);
    ok(!!a, `authority ${id} is missing`);
    ok(re.test(a!.quote), `${id}: the load-bearing phrase ${String(re)} is gone`);
  }

  // Completeness sweep: every authority in the table must have an anchor above.
  // Without this, adding a 9th authority silently leaves it unguarded.
  for (const a of GATE_AUTHORITIES) {
    ok(
      mustSay.some(([id]) => id === a.id),
      `${a.id} is in the table but has no anchor assertion — add one`,
    );
  }

  eq(findGateAuthority("NOPE_NOT_REAL"), undefined, "unknown id returns undefined");

  /* ---- labels are total ------------------------------------------------ */
  for (const t of FINANCIAL_TABLES) {
    ok(!!AREA_LABELS[t.area], `no label for area ${t.area}`);
    ok(!!EXPOSURE_LABELS[t.exposure], `no label for exposure ${t.exposure}`);
  }
}
