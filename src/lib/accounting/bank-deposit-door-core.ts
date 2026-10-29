/**
 * src/lib/accounting/bank-deposit-door-core.ts
 *
 * Fix Phase 2.5 (G-14, F-03-3). THE DOOR TO THE BANK-DEPOSIT CLEARING.
 *
 * `clearDepositForBankRow` (deposit-clearing-service.ts) was finished in
 * books-95 and nothing in `src/` called it: only its own test did. The census
 * still said it was reachable. This file is the pure half of the caller the
 * owner now has on /admin/books/bank. The I/O half is
 * `bank-deposit-door-service.ts`; the server action is
 * `src/app/admin/books/bank/actions.ts#clearBankDepositAction`.
 *
 * Owner, verbatim (D25): "anyone can seal the bag, I am the only one to take
 * cash to the bank". So the bank side is owner-only: the action is gated by
 * `requireBooksAccess()`, which lets only the owner role in.
 *
 * WHAT THIS FILE DECIDES, AND ONLY THIS
 * -------------------------------------
 *   1. Which bank lines are SHOWN as candidates: settled, not removed, money
 *      IN (Plaid sign negative), on or after the cutover, on an account whose
 *      role is `main`. Nothing here decides a line IS a sales deposit; the
 *      owner says so by pressing the button on that line (standing rule 1:
 *      a bank descriptor does not reliably tell a sales deposit from a
 *      transfer, so the system does not guess).
 *   2. Whether the ACCOUNT can take the entry at all. The clearing entry
 *      debits `10200 Bank - Operating` (deposit-clearing-core.ts
 *      BANK_OPERATING_ACCOUNT). `10200` is the chart account for the `main`
 *      role (bank-expense-core.ts ROLE_TO_CASH_ACCOUNT). A deposit into any
 *      other account clearing 10400 into 10200 would book the money into the
 *      wrong bank, so it is refused by name.
 *   3. Whether a line was already cleared: a posted or draft journal with the
 *      source ref `deposit-clear:<transactionId>` already exists.
 *
 * PURE. No I/O, no clock, no `server-only`. Self-tested at the bottom.
 */

import { bankDirection, isOnOrAfterCutover } from "@/lib/accounting/bank-match-core";
import { DEPOSIT_SOURCE_PREFIX, depositSourceRef } from "@/lib/accounting/deposit-clearing-core";

/** The only account role whose chart account is 10200 (ROLE_TO_CASH_ACCOUNT.main). */
export const DEPOSIT_ACCOUNT_ROLE = "main";

/** How far back the panel looks for deposit lines, in days. Stated, not tuned. */
export const DEPOSIT_LOOKBACK_DAYS = 60;

/** The event kind the owner asserts by pressing the button. */
export const SALES_DEPOSIT_EVENT_KIND = "deposit_of_sales";

export type DepositFeedLine = {
  readonly transactionId: string;
  readonly accountId: string;
  /** PLAID convention: positive = money OUT, negative = money IN. */
  readonly amountCents: number;
  readonly date: string;
  readonly name: string | null;
  readonly merchantName: string | null;
  readonly pending: boolean;
  readonly removed: boolean;
};

export type DepositCandidate = DepositFeedLine & {
  /** The money that arrived, in ledger cents (always positive here). */
  readonly depositMinor: number;
  /** True when a journal already carries `deposit-clear:<transactionId>`. */
  readonly alreadyCleared: boolean;
};

export type DepositAccountRefusal = {
  readonly ok: false;
  readonly code: "DEPOSIT_ACCOUNT_NOT_MAIN" | "DEPOSIT_ACCOUNT_NO_ROLE";
  readonly message: string;
};

/**
 * Can a deposit into an account with this role clear 10400 into 10200?
 * Returns null when it can, a refusal sentence when it cannot.
 */
export function checkDepositAccountRole(
  role: string | null | undefined,
): DepositAccountRefusal | null {
  const r = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (r === "") {
    return {
      ok: false,
      code: "DEPOSIT_ACCOUNT_NO_ROLE",
      message:
        "This bank account has not been given a role yet, so the books do not " +
        "know which bank account it is. Give it the Main operating role on the " +
        "Plaid screen first. Nothing was posted.",
    };
  }
  if (r !== DEPOSIT_ACCOUNT_ROLE) {
    return {
      ok: false,
      code: "DEPOSIT_ACCOUNT_NOT_MAIN",
      message:
        `This bank account's role is "${r}", not Main operating. Cash from the ` +
        "store is cleared into 10200 Bank - Operating, so clearing it from this " +
        "account would book the money into the wrong bank. Nothing was posted.",
    };
  }
  return null;
}

/** Is this the source ref of a deposit-clearing journal? Returns the transaction id. */
export function clearedTransactionId(sourceRef: string | null | undefined): string | null {
  if (typeof sourceRef !== "string") return null;
  const prefix = `${DEPOSIT_SOURCE_PREFIX}:`;
  if (!sourceRef.startsWith(prefix)) return null;
  const id = sourceRef.slice(prefix.length);
  return id === "" ? null : id;
}

/**
 * The lines the owner is shown. Money in, settled, not removed, on or after
 * the cutover. Newest first. Lines already cleared stay on the list, marked,
 * so the owner can see the trail, not only the work left.
 */
export function planDepositCandidates(
  lines: readonly DepositFeedLine[],
  clearedSourceRefs: readonly (string | null)[],
): DepositCandidate[] {
  const cleared = new Set<string>();
  for (const ref of clearedSourceRefs) {
    const id = clearedTransactionId(ref);
    if (id !== null) cleared.add(id);
  }
  const out: DepositCandidate[] = [];
  for (const l of lines) {
    if (l.pending || l.removed) continue;
    if (!Number.isInteger(l.amountCents) || l.amountCents === 0) continue;
    if (bankDirection(l.amountCents) !== "money_in") continue;
    if (!isOnOrAfterCutover(l.date)) continue;
    out.push({
      ...l,
      depositMinor: -l.amountCents,
      alreadyCleared: cleared.has(l.transactionId),
    });
  }
  out.sort((a, b) =>
    a.date === b.date ? a.transactionId.localeCompare(b.transactionId) : a.date < b.date ? 1 : -1,
  );
  return out;
}

/** The ISO date `days` before `today` (both `YYYY-MM-DD`). Pure date arithmetic. */
export function lookbackStart(today: string, days: number = DEPOSIT_LOOKBACK_DAYS): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const t = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t - days * 86_400_000).toISOString().slice(0, 10);
}

/* ═══════════════════════════════════════════════════════════════════════════
   SELF-TESTS
   ═══════════════════════════════════════════════════════════════════════════ */

function ok(cond: boolean, what: string): void {
  if (!cond) throw new Error(`bank-deposit-door-core self-test FAILED: ${what}`);
}

export function __runBankDepositDoorTests(): void {
  // 1. account role
  ok(checkDepositAccountRole("main") === null, "main is accepted");
  ok(checkDepositAccountRole(" Main ") === null, "role is trimmed and lower-cased");
  ok(checkDepositAccountRole("atm")?.code === "DEPOSIT_ACCOUNT_NOT_MAIN", "atm refused");
  ok(checkDepositAccountRole("credit")?.code === "DEPOSIT_ACCOUNT_NOT_MAIN", "credit refused");
  ok(checkDepositAccountRole(null)?.code === "DEPOSIT_ACCOUNT_NO_ROLE", "null refused");
  ok(checkDepositAccountRole("  ")?.code === "DEPOSIT_ACCOUNT_NO_ROLE", "blank refused");

  // 2. source refs
  ok(clearedTransactionId(depositSourceRef("t1")) === "t1", "round trip");
  ok(clearedTransactionId("seal-bag:x") === null, "other prefix is not a clearing");
  ok(clearedTransactionId("deposit-clear:") === null, "empty id is not a clearing");
  ok(clearedTransactionId(null) === null, "null ref");

  // 3. candidates
  const base: DepositFeedLine = {
    transactionId: "a",
    accountId: "acct",
    amountCents: -50_000,
    date: "2026-11-03",
    name: "DEPOSIT",
    merchantName: null,
    pending: false,
    removed: false,
  };
  const c = planDepositCandidates(
    [
      base,
      { ...base, transactionId: "out", amountCents: 1_000 },
      { ...base, transactionId: "pend", pending: true },
      { ...base, transactionId: "gone", removed: true },
      { ...base, transactionId: "old", date: "2025-12-31" },
      { ...base, transactionId: "zero", amountCents: 0 },
      { ...base, transactionId: "b", date: "2026-11-05", amountCents: -12_345 },
    ],
    [depositSourceRef("a"), "seal-bag:zz", null],
  );
  ok(c.length === 2, `two candidates, got ${c.length}`);
  ok(c[0].transactionId === "b" && c[1].transactionId === "a", "newest first");
  ok(c[0].depositMinor === 12_345, "deposit is positive ledger cents");
  ok(c[1].alreadyCleared === true && c[0].alreadyCleared === false, "cleared marked");

  // 4. lookback
  ok(lookbackStart("2026-11-30", 60) === "2026-10-01", "60 days back");
  ok(lookbackStart("nope") === null, "bad date refused");
}
