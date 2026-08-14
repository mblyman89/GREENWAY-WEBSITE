/**
 * src/lib/accounting/ledger-store.ts   (slice F5-K)
 *
 * SERVER-ONLY. The read side of the general ledger: trial balance, the ledger
 * itself, the chart of accounts, the opening balance worksheet, and the
 * override record.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS *NOT*
 * ---------------------------------------------------------------------------
 * It is not where the rules live, and it contains no accounting logic at all.
 * It calls the database functions built in 0175-0177 and translates whatever
 * comes back. Exactly like `posting-service.ts` is the one door IN, this is
 * the one door OUT, and for the same reason: every rule is enforced in the
 * database, where it cannot be bypassed by a future page that forgets to ask.
 *
 * In particular this file does NOT decide who is allowed to read the books.
 * The RPCs are all `security definer` and check `is_admin()` themselves, so a
 * caller who is not an admin gets refused by Postgres even if the page that
 * called it had a bug. The role check in the page is a courtesy that produces
 * a nice screen; THIS is not the guarantee either — the database is.
 *
 * ---------------------------------------------------------------------------
 * THE `ok` / `refusal` SHAPE, AND WHY NOTHING HERE THROWS
 * ---------------------------------------------------------------------------
 * Every function returns a discriminated result rather than throwing. A thrown
 * error in a React Server Component becomes a generic error page, which is the
 * worst possible outcome for a REFUSAL: the books said something specific and
 * deliberate ("this date is before the cut-over"), and the user would see
 * "Application error". Returning the refusal lets the page render it properly.
 *
 * Genuine bugs still throw. The distinction matters: a refusal is the system
 * working, a crash is not.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { explainGlRefusal, type GlRefusal } from "./gl-refusal-core";

export type LedgerResult<T> =
  | { ok: true; data: T }
  | { ok: false; refusal: GlRefusal };

function refused<T>(err: unknown): LedgerResult<T> {
  return { ok: false, refusal: explainGlRefusal(err as never) };
}

/** The four sets of books. Matches `gl_entities.code` in 0172. */
export const ENTITY_CODES = ["greenway", "atm", "landholding", "personal"] as const;
export type EntityCode = (typeof ENTITY_CODES)[number];

export const ENTITY_LABELS: Record<EntityCode, string> = {
  greenway: "Greenway (retail store)",
  atm: "ATM business",
  landholding: "Landholding company",
  personal: "Personal",
};

export function isEntityCode(v: string): v is EntityCode {
  return (ENTITY_CODES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// TRIAL BALANCE
// ---------------------------------------------------------------------------

export type TrialBalanceCheck = {
  entity_code: string;
  from_date: string;
  to_date: string;
  debit_cents: number;
  credit_cents: number;
  difference_cents: number;
  line_count: number;
  account_count: number;
  abnormal_count: number;
  balanced: boolean;
  certified: boolean;
  verdict: string;
};

/**
 * The headline check. Note it can return `certified: false` WITHOUT being a
 * refusal — an unbalanced or empty trial balance is a real answer about the
 * state of the books, not an error, and the page must show it prominently
 * rather than hiding it behind an error state.
 */
export async function getTrialBalanceCheck(
  entityCode: string,
  fromDate?: string | null,
  toDate?: string | null,
): Promise<LedgerResult<TrialBalanceCheck>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("gl_trial_balance_check", {
    p_entity_code: entityCode,
    p_from: fromDate ?? null,
    p_to: toDate ?? null,
  });
  if (error) return refused<TrialBalanceCheck>(error);
  if (data == null) {
    return refused<TrialBalanceCheck>(
      "The trial balance check returned nothing at all, which should be impossible.",
    );
  }
  return { ok: true, data: data as TrialBalanceCheck };
}

// ---------------------------------------------------------------------------
// THE GENERAL LEDGER
// ---------------------------------------------------------------------------

export type LedgerRow = {
  journal_date: string;
  journal_no: number;
  journal_status: string;
  account_code: string;
  account_name: string;
  source_kind: string | null;
  source_ref: string | null;
  memo: string | null;
  description: string | null;
  cost_class: string | null;
  debit_cents: number;
  credit_cents: number;
  running_balance_cents: number;
};

export async function getGeneralLedger(
  entityCode: string,
  accountCode?: string | null,
  fromDate?: string | null,
  toDate?: string | null,
): Promise<LedgerResult<LedgerRow[]>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("gl_general_ledger", {
    p_entity_code: entityCode,
    p_account_code: accountCode ?? null,
    p_from: fromDate ?? null,
    p_to: toDate ?? null,
  });
  if (error) return refused<LedgerRow[]>(error);
  return { ok: true, data: (data ?? []) as LedgerRow[] };
}

// ---------------------------------------------------------------------------
// CHART OF ACCOUNTS
// ---------------------------------------------------------------------------

export type AccountRow = {
  code: string;
  name: string;
  account_type: string;
  normal_balance: string;
  cost_class: string | null;
  active: boolean;
  entity_code: string | null;
};

/**
 * Read straight from the table rather than through an RPC, because 0173 puts
 * an admin-only RLS policy on `gl_accounts` and there is no reporting function
 * to wrap. The admin client bypasses RLS, so the CALLER must have already
 * checked the role — every page that uses this calls `requireBooksAccess()`
 * first, and there is a test asserting that.
 */
export async function listAccounts(
  entityCode?: string | null,
  includeInactive = false,
): Promise<LedgerResult<AccountRow[]>> {
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("gl_accounts")
    .select("code, name, account_type, normal_balance, cost_class, active, entity_id")
    .order("code", { ascending: true });

  if (!includeInactive) q = q.eq("active", true);

  const { data, error } = await q;
  if (error) return refused<AccountRow[]>(error);

  const rows = (data ?? []) as unknown as (Omit<AccountRow, "entity_code"> & {
    entity_id: string | null;
  })[];

  // Resolve entity_id -> code so the UI never has to know about uuids.
  const { data: ents, error: entErr } = await admin
    .from("gl_entities")
    .select("id, code");
  if (entErr) return refused<AccountRow[]>(entErr);

  const byId = new Map<string, string>();
  for (const e of (ents ?? []) as { id: string; code: string }[]) byId.set(e.id, e.code);

  let mapped: AccountRow[] = rows.map((r) => ({
    code: r.code,
    name: r.name,
    account_type: r.account_type,
    normal_balance: r.normal_balance,
    cost_class: r.cost_class,
    active: r.active,
    entity_code: r.entity_id ? (byId.get(r.entity_id) ?? null) : null,
  }));

  if (entityCode) {
    // Accounts with a NULL entity are shared across all books, so they belong
    // in every entity's list. Filtering them out would hide most of the chart.
    mapped = mapped.filter((a) => a.entity_code === entityCode || a.entity_code === null);
  }

  return { ok: true, data: mapped };
}

// ---------------------------------------------------------------------------
// OPENING BALANCES (0176)
// ---------------------------------------------------------------------------

export type OpeningBalanceSummary = {
  entity_code: string;
  row_count: number;
  debit_cents: number;
  credit_cents: number;
  difference_cents: number;
  balanced: boolean;
  frozen: boolean;
  posted_journal_id: string | null;
  verdict: string;
};

export async function getOpeningBalanceSummary(
  entityCode: string,
): Promise<LedgerResult<OpeningBalanceSummary>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("gl_opening_balance_summary", {
    p_entity_code: entityCode,
  });
  if (error) return refused<OpeningBalanceSummary>(error);
  if (data == null) {
    return refused<OpeningBalanceSummary>(
      "The opening balance summary returned nothing at all.",
    );
  }
  return { ok: true, data: data as OpeningBalanceSummary };
}

// ---------------------------------------------------------------------------
// THE OVERRIDE RECORD (0177)
// ---------------------------------------------------------------------------

export type OverrideReport = {
  entity_code: string;
  from_date: string | null;
  to_date: string | null;
  override_count: number;
  overrides: {
    when: string;
    journal_no: number | null;
    override_kind: string;
    amount_cents: number;
    threshold_cents: number;
    approved_by: string | null;
    reason: string;
    plain_english: string;
  }[];
};

export async function getOverrideReport(
  entityCode: string,
  fromDate?: string | null,
  toDate?: string | null,
): Promise<LedgerResult<OverrideReport>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("gl_override_report", {
    p_entity_code: entityCode,
    p_from: fromDate ?? null,
    p_to: toDate ?? null,
  });
  if (error) return refused<OverrideReport>(error);
  if (data == null) {
    return refused<OverrideReport>("The override report returned nothing at all.");
  }
  return { ok: true, data: data as OverrideReport };
}
