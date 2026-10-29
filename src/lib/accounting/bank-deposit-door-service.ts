import "server-only";

/**
 * src/lib/accounting/bank-deposit-door-service.ts
 *
 * Fix Phase 2.5 (G-14, F-03-3). The I/O half of the owner's "this bank line is
 * a store cash deposit" button on /admin/books/bank. The decisions live in
 * `bank-deposit-door-core.ts`; the entry itself is built and posted by the
 * books-95 service `deposit-clearing-service.ts#clearDepositForBankRow`, which
 * had no caller in `src/` until this file.
 *
 * THE CHAIN, LINK BY LINK (rule 133b)
 * -----------------------------------
 *   owner presses "Clear against bags" on a bank line   (/admin/books/bank)
 *     -> actions.ts#clearBankDepositAction   (requireBooksAccess FIRST)
 *     -> THIS FILE #clearBankDepositLine
 *         reads the line from plaid_transactions BY ID (never from the browser)
 *         reads its account's role from plaid_accounts (never from the browser)
 *         refuses a non-`main` account by name (core#checkDepositAccountRole)
 *     -> deposit-clearing-service.ts#clearDepositForBankRow(row, "deposit_of_sales")
 *     -> submitJournal, autoPost, sourceRef `deposit-clear:<transactionId>`
 *     -> 10200 debited, 10400 credited, one credit line per business day
 *
 * WHAT THIS DOES NOT DO (rule 133f)
 * ---------------------------------
 * It does not decide that a line is a sales deposit. The owner does, by
 * pressing the button on that line; the system lists every money-in line on
 * the Main operating account and leaves the judgement to him (standing rule 1).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  clearDepositForBankRow,
  type DepositClearOutcome,
} from "@/lib/accounting/deposit-clearing-service";
import { DEPOSIT_SOURCE_PREFIX } from "@/lib/accounting/deposit-clearing-core";
import {
  checkDepositAccountRole,
  lookbackStart,
  planDepositCandidates,
  DEPOSIT_ACCOUNT_ROLE,
  DEPOSIT_LOOKBACK_DAYS,
  SALES_DEPOSIT_EVENT_KIND,
  type DepositCandidate,
  type DepositFeedLine,
} from "@/lib/accounting/bank-deposit-door-core";
import type { BankRow } from "@/lib/accounting/bank-match-core";

export type DepositCandidateList =
  | { readonly ok: true; readonly candidates: readonly DepositCandidate[]; readonly accounts: number }
  | { readonly ok: false; readonly error: string };

type TxnRow = {
  transaction_id: string;
  account_id: string;
  amount_cents: number | string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  pending: boolean | null;
  removed: boolean | null;
};

function toLine(r: TxnRow): DepositFeedLine {
  return {
    transactionId: r.transaction_id,
    accountId: r.account_id,
    amountCents: typeof r.amount_cents === "string" ? Number(r.amount_cents) : r.amount_cents,
    date: r.date,
    name: r.name,
    merchantName: r.merchant_name,
    pending: !!r.pending,
    removed: !!r.removed,
  };
}

/**
 * The money-in lines on every active Main operating account over the last
 * `DEPOSIT_LOOKBACK_DAYS` days, each marked cleared or not.
 *
 * Rule 46: a failed read returns `ok: false` with the reason. It is never an
 * empty list, because "no deposits" and "could not read the bank" call for
 * opposite reactions.
 */
export async function listDepositCandidates(today: string): Promise<DepositCandidateList> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database not connected, so the bank lines could not be read." };
  }
  const since = lookbackStart(today);
  if (since === null) {
    return { ok: false, error: `"${today}" is not a date, so no window could be set.` };
  }
  const admin = createSupabaseAdminClient();

  const { data: accts, error: acctErr } = await admin
    .from("plaid_accounts")
    .select("account_id,role,active")
    .eq("active", true);
  if (acctErr || !accts) {
    return { ok: false, error: `The bank accounts could not be read: ${acctErr?.message ?? "no data"}.` };
  }
  const mainIds = (accts as { account_id: string; role: string | null }[])
    .filter((a) => checkDepositAccountRole(a.role) === null)
    .map((a) => a.account_id);
  if (mainIds.length === 0) {
    return { ok: true, candidates: [], accounts: 0 };
  }

  const { data: txns, error: txnErr } = await admin
    .from("plaid_transactions")
    .select("transaction_id,account_id,amount_cents,date,name,merchant_name,pending,removed")
    .in("account_id", mainIds)
    .eq("removed", false)
    .lt("amount_cents", 0)
    .gte("date", since)
    .order("date", { ascending: false })
    .limit(200);
  if (txnErr || !txns) {
    return { ok: false, error: `The bank feed could not be read: ${txnErr?.message ?? "no data"}.` };
  }

  const { data: js, error: jErr } = await admin
    .from("gl_journals")
    .select("source_ref,status")
    .like("source_ref", `${DEPOSIT_SOURCE_PREFIX}:%`)
    .in("status", ["draft", "posted"]);
  if (jErr || !js) {
    // Without this read every line would look uncleared, which invites a
    // second press. The second press is safe (the ledger answers "duplicate"),
    // but the screen would still be telling the owner something untrue.
    return { ok: false, error: `The cleared deposits could not be read: ${jErr?.message ?? "no data"}.` };
  }

  const candidates = planDepositCandidates(
    (txns as TxnRow[]).map(toLine),
    (js as { source_ref: string | null }[]).map((j) => j.source_ref),
  );
  return { ok: true, candidates, accounts: mainIds.length };
}

/**
 * Clear ONE bank line against the counted cash in 10400.
 *
 * The line and its account are read here by id. Nothing about the money comes
 * from the browser except which line the owner pressed.
 */
export async function clearBankDepositLine(transactionId: string): Promise<DepositClearOutcome> {
  const id = (transactionId ?? "").trim();
  const refused = (code: string, message: string): DepositClearOutcome => ({
    kind: "refused",
    transactionId: id,
    code,
    message,
  });
  if (id === "") {
    return refused("DEPOSIT_NO_LINE", "No bank line was chosen, so nothing was read and nothing was posted.");
  }
  if (!isSupabaseServiceConfigured) {
    return refused("DEPOSIT_NO_DATABASE", "Database not connected. Nothing was posted.");
  }
  const admin = createSupabaseAdminClient();

  const { data: t, error: tErr } = await admin
    .from("plaid_transactions")
    .select("transaction_id,account_id,amount_cents,date,name,merchant_name,pending,removed,personal_finance_category_primary")
    .eq("transaction_id", id)
    .maybeSingle();
  if (tErr) {
    return refused("DEPOSIT_LINE_UNREADABLE", `The bank line could not be read: ${tErr.message}. Nothing was posted.`);
  }
  if (!t) {
    return refused("DEPOSIT_LINE_NOT_FOUND", "That bank line is not in the feed. Nothing was posted.");
  }
  const txn = t as TxnRow & { personal_finance_category_primary: string | null };

  const { data: a, error: aErr } = await admin
    .from("plaid_accounts")
    .select("account_id,role")
    .eq("account_id", txn.account_id)
    .maybeSingle();
  if (aErr) {
    return refused("DEPOSIT_ACCOUNT_UNREADABLE", `The bank account could not be read: ${aErr.message}. Nothing was posted.`);
  }
  const roleRefusal = checkDepositAccountRole((a as { role: string | null } | null)?.role ?? null);
  if (roleRefusal !== null) return refused(roleRefusal.code, roleRefusal.message);

  const line = toLine(txn);
  const row: BankRow = {
    transactionId: line.transactionId,
    accountId: line.accountId,
    amountCents: line.amountCents,
    date: line.date,
    name: line.name ?? "",
    merchantName: line.merchantName,
    pending: line.pending,
    removed: line.removed,
    categoryPrimary: txn.personal_finance_category_primary,
  };

  return clearDepositForBankRow(row, SALES_DEPOSIT_EVENT_KIND, { client: admin });
}

/** Stated for the screen so the window is never a hidden number. */
export const DEPOSIT_DOOR_FACTS = {
  role: DEPOSIT_ACCOUNT_ROLE,
  lookbackDays: DEPOSIT_LOOKBACK_DAYS,
} as const;
