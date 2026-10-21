/**
 * src/lib/payments/ach-bank-watch-store.ts  (R41 S16)
 *
 * Reads and writes for the daily bank watch (ach-bank-watch-core.ts).
 *
 * Reads, all from data the site already holds:
 *   - the Main account(s) from plaid_accounts (role "main", active) and their
 *     Plaid connection (plaid_items: status, error code, last sync);
 *   - the Main account's Plaid transactions for the last WATCH_DAYS days
 *     (removed lines left out);
 *   - which of those the ACH Payments report already matched to an ACH file
 *     or payroll run, and the ACH payments that left (same report, same
 *     matching, so the two pages can never disagree);
 *   - the logged returns and NOCs (ach_return_notices: kind, day, amount);
 *   - the owner's known-payee rules and the reviews (migration 0289).
 *
 * Every list read is paged by its unique id (pagedAllChecked): PostgREST
 * caps one response at 1,000 rows with no error, so a plain .limit() would
 * quietly drop lines. Every read is checked. A failed read is a PROBLEM shown on the page and
 * stops the daily email from saying "all clear" (silence is never all clear).
 * Nothing here creates or removes a Plaid connection: on the Trial plan a
 * removed connection still counts against the 10.
 *
 * Writes: add a rule (owner), retire a rule (owner), record a review (owner
 * or admin). The 0289 triggers check the person again.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { loadAchReportInputs } from "@/lib/reports/ach-payments-report-store";
import { buildAchReport } from "@/lib/reports/ach-payments-report-core";
import { ACCOUNT_LAST4, FEES } from "@/lib/payments/timberland-profile-core";
import {
  addDaysIso,
  watchDbErrorMessage,
  WATCH_DAYS,
  type LoggedNotice,
  type MainAccount,
  type SentPayment,
  type WatchInput,
  type WatchReview,
  type WatchRule,
  type WatchTxn,
  type WatchVerdict,
} from "@/lib/payments/ach-bank-watch-core";

type Fail = { ok: false; error: string };

/** Big enough for two months of a small shop; hitting it is reported. */
export const WATCH_TXN_CAP = 3000;

export type WatchRuleRow = WatchRule & { createdAt: string; createdBy: string; retiredAt: string | null; retiredBy: string | null };

export type WatchLoad = {
  input: WatchInput;
  problems: string[];
  /** false when migration 0289 is not applied yet (rules and reviews unavailable). */
  tablesReady: boolean;
  rules: WatchRuleRow[];
};

function cents(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function missingTable(msg: string | undefined): boolean {
  return /does not exist|schema cache/.test(msg ?? "");
}

const VERDICTS: ReadonlySet<string> = new Set(["known", "reported_to_bank", "returned_payment", "fee", "not_ours"]);

export async function loadBankWatch(todayIso: string): Promise<WatchLoad> {
  const problems: string[] = [];
  const empty: WatchInput = {
    todayIso,
    mainAccounts: [],
    txns: [],
    achMatchedIds: new Set(),
    rules: [],
    reviews: [],
    sent: [],
    notices: [],
    fees: { perReturnOrNoc: FEES.perReturnOrNoc, serviceMonthly: FEES.serviceMonthly },
    agreementLast4: ACCOUNT_LAST4,
    connectionsNow: 0,
  };
  if (!isSupabaseServiceConfigured) {
    return { input: empty, problems: ["Database not connected, so the bank feed cannot be read."], tablesReady: false, rules: [] };
  }
  const db = createSupabaseAdminClient();
  const fromIso = addDaysIso(todayIso, -WATCH_DAYS);

  type Rows = Record<string, unknown>[];
  /** One checked, paged read: { error } when it did not finish, never a short list. */
  /** Filters are only equality and on-or-after, so no query-builder type is passed around. */
  type Filter = { eq?: Record<string, string | boolean>; gte?: Record<string, string> };
  const paged = async (table: string, cols: string, filter: Filter = {}): Promise<{ data: Rows; error: { message: string } | null }> => {
    let lastError = "";
    const { rows, verdict } = await pagedAllChecked<Record<string, unknown>>(async (from, to) => {
      let q = db.from(table).select(cols);
      for (const [k, v] of Object.entries(filter.eq ?? {})) q = q.eq(k, v);
      for (const [k, v] of Object.entries(filter.gte ?? {})) q = q.gte(k, v);
      const { data, error } = await q.order("id", { ascending: true }).range(from, to);
      if (error) lastError = String(error.message ?? "read failed");
      return { rows: (data ?? []) as unknown as Rows, ok: !error };
    }, { maxRows: 20_000 });
    return verdict.complete ? { data: rows, error: null } : { data: [], error: { message: lastError || "the read did not finish" } };
  };
  const [acctQ, itemQ, noticeQ, ruleQ, reviewQ, staffQ] = await Promise.all([
    paged("plaid_accounts", "id, account_id, item_id, name, official_name, custom_name, mask, role, active, available_balance_cents, balances_updated_at"),
    paged("plaid_items", "id, item_id, status, error_code, last_successful_sync"),
    paged("ach_return_notices", "id, notice_kind, received_on, amount_cents", { gte: { received_on: fromIso } }),
    paged("ach_bank_watch_rules", "id, match_text, max_cents, note, created_by, created_at, retired_at, retired_by"),
    paged("ach_bank_watch_reviews", "id, transaction_id, verdict, note, created_by, created_at", { gte: { created_at: `${addDaysIso(fromIso, -30)}T00:00:00Z` } }),
    paged("staff_profiles", "id, full_name, email"),
  ]);

  const nameOf = new Map<string, string>();
  if (!staffQ.error) for (const s of staffQ.data) nameOf.set(String(s.id), String((s.full_name as string | null)?.trim() || s.email || "Staff"));
  const who = (id: unknown) => nameOf.get(String(id)) ?? "Staff";

  // ---- Main accounts + connection health
  const mainAccounts: MainAccount[] = [];
  let connectionsNow = 0;
  if (acctQ.error || itemQ.error) {
    problems.push("The Plaid accounts or connections could not be read, so the bank feed is not checked.");
  } else {
    const items = new Map<string, Record<string, unknown>>();
    for (const it of itemQ.data) items.set(String(it.item_id), it);
    connectionsNow = items.size;
    for (const a of acctQ.data) {
      if (a.role !== "main" || a.active === false || typeof a.account_id !== "string") continue;
      const it = items.get(String(a.item_id));
      mainAccounts.push({
        accountId: a.account_id,
        name: String(a.custom_name ?? a.official_name ?? a.name ?? "Main account"),
        mask: typeof a.mask === "string" && a.mask ? a.mask : null,
        availableCents: a.available_balance_cents === null || a.available_balance_cents === undefined ? null : cents(a.available_balance_cents),
        balancesUpdatedAt: (a.balances_updated_at as string | null) ?? null,
        itemStatus: it ? String(it.status ?? "error") : "error",
        itemErrorCode: it ? ((it.error_code as string | null) ?? null) : "CONNECTION_NOT_FOUND",
        lastSuccessfulSync: it ? ((it.last_successful_sync as string | null) ?? null) : null,
      });
    }
  }

  // ---- Main-account transactions in the window
  const txns: WatchTxn[] = [];
  for (const a of mainAccounts) {
    const tq = await paged("plaid_transactions", "id, transaction_id, account_id, amount_cents, date, name, merchant_name, pending, gl_match_id, gl_journal_id", {
      eq: { account_id: a.accountId, removed: false },
      gte: { date: fromIso },
    });
    if (tq.error) {
      problems.push(`Bank lines for ${a.name} could not be read in full, so that account is not watched today.`);
      continue;
    }
    const rows = [...tq.data].sort((x, y) => String(y.date).localeCompare(String(x.date)));
    if (rows.length > WATCH_TXN_CAP) problems.push(`More than ${WATCH_TXN_CAP} bank lines on ${a.name} in ${WATCH_DAYS} days; only the newest ${WATCH_TXN_CAP} are watched.`);
    for (const t of rows.slice(0, WATCH_TXN_CAP)) {
      txns.push({
        transactionId: String(t.transaction_id),
        accountId: String(t.account_id),
        amountCents: cents(t.amount_cents),
        date: String(t.date),
        description: (t.merchant_name as string | null) || (t.name as string | null) || null,
        pending: !!t.pending,
        inBooks: !!(t.gl_match_id || t.gl_journal_id),
      });
    }
  }

  // ---- ACH matches and payments sent (the ACH Payments report itself)
  const achMatchedIds = new Set<string>();
  const sent: SentPayment[] = [];
  try {
    const load = await loadAchReportInputs();
    for (const p of load.problems) problems.push(`ACH Payments report: ${p}`);
    const r = buildAchReport({ ...load.input, todayIso, fromDate: fromIso, toDate: todayIso });
    for (const m of r.bankMatches) achMatchedIds.add(m.transactionId);
    for (const p of r.payments) {
      if (p.method !== "ach" || p.status === "file_voided") continue;
      sent.push({ date: p.date, payee: p.payee, amountCents: p.amountCents, detail: p.detail });
    }
  } catch {
    problems.push("The ACH Payments report could not be built, so ACH file debits may show as unexplained.");
  }

  // ---- logged notices
  const notices: LoggedNotice[] = [];
  if (noticeQ.error) problems.push("The logged returns and NOCs could not be read, so possible returns and fee gaps may be wrong.");
  else {
    const rows = [...noticeQ.data].sort((x, y) => String(x.received_on).localeCompare(String(y.received_on)));
    for (const n of rows) {
      if (n.notice_kind !== "return" && n.notice_kind !== "noc") continue;
      notices.push({ kind: n.notice_kind, receivedOn: String(n.received_on), amountCents: n.amount_cents === null || n.amount_cents === undefined ? null : cents(n.amount_cents) });
    }
  }

  // ---- rules and reviews (0289)
  let tablesReady = true;
  const rules: WatchRuleRow[] = [];
  if (ruleQ.error) {
    if (missingTable(ruleQ.error.message)) tablesReady = false;
    else problems.push("The known-payee rules could not be read, so lines they cover show as unexplained.");
  } else {
    for (const r of [...ruleQ.data].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))) {
      rules.push({
        id: String(r.id),
        matchText: String(r.match_text ?? ""),
        maxCents: r.max_cents === null || r.max_cents === undefined ? null : cents(r.max_cents),
        note: String(r.note ?? ""),
        retired: !!r.retired_at,
        createdAt: String(r.created_at ?? ""),
        createdBy: who(r.created_by),
        retiredAt: (r.retired_at as string | null) ?? null,
        retiredBy: r.retired_by ? who(r.retired_by) : null,
      });
    }
  }
  const reviews: WatchReview[] = [];
  if (reviewQ.error) {
    if (missingTable(reviewQ.error.message)) tablesReady = false;
    else problems.push("The bank line reviews could not be read, so reviewed lines show as unexplained.");
  } else {
    const rows = [...reviewQ.data].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
    for (const r of rows) {
      if (!VERDICTS.has(String(r.verdict))) continue;
      reviews.push({ transactionId: String(r.transaction_id), verdict: r.verdict as WatchVerdict, note: String(r.note ?? ""), createdAt: String(r.created_at ?? ""), by: who(r.created_by) });
    }
  }
  if (!tablesReady) problems.push("Migration 0289 is not applied yet: known-payee rules and reviews are off, so every unmatched debit is listed.");

  return {
    input: { ...empty, mainAccounts, txns, achMatchedIds, rules: rules.map(({ id, matchText, maxCents, note, retired }) => ({ id, matchText, maxCents, note, retired })), reviews, sent, notices, connectionsNow },
    problems,
    tablesReady,
    rules,
  };
}

function dbErr(e: { code?: string; message?: string } | null | undefined): string {
  return watchDbErrorMessage(`${e?.code ?? ""} ${e?.message ?? ""}`.trim());
}

export async function addWatchRule(input: { matchText: string; maxCents: number | null; note: string; actorId: string }): Promise<{ ok: true; id: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected. Nothing was saved." };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_bank_watch_rules")
    .insert({ match_text: input.matchText, max_cents: input.maxCents, note: input.note, created_by: input.actorId })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbErr(error) };
  const id = (data as { id?: string } | null)?.id;
  return id ? { ok: true, id } : { ok: false, error: "The database did not confirm the rule. Reload the page and check before adding it again." };
}

export async function retireWatchRule(input: { id: string; actorId: string }): Promise<{ ok: true } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected. Nothing was saved." };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_bank_watch_rules")
    .update({ retired_at: new Date().toISOString(), retired_by: input.actorId })
    .eq("id", input.id)
    .is("retired_at", null)
    .select("id");
  if (error) return { ok: false, error: dbErr(error) };
  if (!data || data.length !== 1) return { ok: false, error: "That rule was not found or is already retired." };
  return { ok: true };
}

export async function recordWatchReview(input: { transactionId: string; verdict: WatchVerdict; note: string; actorId: string }): Promise<{ ok: true; id: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected. Nothing was saved." };
  const db = createSupabaseAdminClient();
  // Only a line that is really on the Main account can be reviewed.
  const t = await db.from("plaid_transactions").select("transaction_id, account_id").eq("transaction_id", input.transactionId).maybeSingle();
  if (t.error || !t.data) return { ok: false, error: "That bank line was not found. Reload the page." };
  const a = await db.from("plaid_accounts").select("role").eq("account_id", (t.data as { account_id: string }).account_id).maybeSingle();
  if (a.error || (a.data as { role?: string } | null)?.role !== "main") return { ok: false, error: "Only lines on the Main account are reviewed here." };
  const { data, error } = await db
    .from("ach_bank_watch_reviews")
    .insert({ transaction_id: input.transactionId, verdict: input.verdict, note: input.note, created_by: input.actorId })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbErr(error) };
  const id = (data as { id?: string } | null)?.id;
  return id ? { ok: true, id } : { ok: false, error: "The database did not confirm the review. Reload the page and check before recording it again." };
}

/** Main account(s) and their Plaid balance only (for the funding hint). Never throws; [] on any error. */
export async function readMainBalances(): Promise<MainAccount[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("plaid_accounts")
      .select("account_id, name, official_name, custom_name, mask, role, active, available_balance_cents, balances_updated_at")
      .eq("role", "main");
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[])
      .filter((a) => a.active !== false && typeof a.account_id === "string")
      .map((a) => ({
        accountId: String(a.account_id),
        name: String(a.custom_name ?? a.official_name ?? a.name ?? "Main account"),
        mask: typeof a.mask === "string" && a.mask ? a.mask : null,
        availableCents: a.available_balance_cents === null || a.available_balance_cents === undefined ? null : cents(a.available_balance_cents),
        balancesUpdatedAt: (a.balances_updated_at as string | null) ?? null,
        itemStatus: "unknown",
        itemErrorCode: null,
        lastSuccessfulSync: null,
      }));
  } catch {
    return [];
  }
}
