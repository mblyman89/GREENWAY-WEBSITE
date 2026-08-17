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
 * The RPCs are all `security definer` and check `is_owner()` themselves (they
 * checked `is_admin()` until migration 0185 narrowed the books to the owner
 * alone), so a caller who is not the owner gets refused by Postgres even if the
 * page that called it had a bug. The role check in the page is a courtesy that
 * produces a nice screen; THIS is not the guarantee either — the database is.
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

import { createBooksClient } from "@/lib/supabase/books-client";
import { explainGlRefusal, type GlRefusal } from "./gl-refusal-core";
import { accountBelongsToEntity } from "./books-view-core";

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
  const admin = await createBooksClient();
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
  const admin = await createBooksClient();
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
  /**
   * The entities this account may be used by, or null when it is shared by all
   * four sets of books.
   *
   * THIS IS A LIST, NOT A SINGLE VALUE, and that is not a detail. Account 10300
   * (Bank -- ATM Vault) is allowed for BOTH `atm` and `greenway`; the earlier
   * version of this type had a single `entity_code`, which cannot represent
   * that account at all. Measured in the real chart: 96 accounts are shared by
   * every entity and 97 are restricted to specific ones.
   */
  allowed_entity_codes: string[] | null;
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
  const admin = await createBooksClient();

  // THE COLUMN NAMES HERE WERE WRONG AND THE PAGE WAS DEAD BECAUSE OF IT.
  // Three of the seven names asked for did not exist on `gl_accounts`:
  //
  //     account_type  ->  type
  //     cost_class    ->  default_cost_class
  //     entity_id     ->  allowed_entity_codes   (a text[], not a uuid)
  //
  // Michael only ever saw the first one, because PostgREST reports the first
  // missing column and stops. Correcting `account_type` alone would have
  // produced an identical error about `cost_class`, then another about
  // `entity_id` -- three outages wearing the same coat. Every column in this
  // list was therefore checked individually against the live schema
  // (prove-books-lockout-part2.sh) instead of fixing the one that shouted.
  let q = admin
    .from("gl_accounts")
    .select("code, name, type, normal_balance, default_cost_class, active, allowed_entity_codes")
    .order("code", { ascending: true });

  if (!includeInactive) q = q.eq("active", true);

  const { data, error } = await q;
  if (error) return refused<AccountRow[]>(error);

  const rows = (data ?? []) as unknown as {
    code: string;
    name: string;
    type: string;
    normal_balance: string;
    default_cost_class: string | null;
    active: boolean;
    allowed_entity_codes: string[] | null;
  }[];

  // The database's column is `type`; the rest of the books call it
  // `account_type` (the trial balance view exposes it under that name). The
  // translation happens HERE, once, so no page has to know both words.
  let mapped: AccountRow[] = rows.map((r) => ({
    code: r.code,
    name: r.name,
    account_type: r.type,
    normal_balance: r.normal_balance,
    cost_class: r.default_cost_class,
    active: r.active,
    allowed_entity_codes: r.allowed_entity_codes,
  }));

  if (entityCode) {
    // A NULL list means "every set of books", so those accounts belong in
    // every entity's chart. Filtering them out would hide roughly half of it.
    mapped = mapped.filter((a) => accountBelongsToEntity(a, entityCode));
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
  const admin = await createBooksClient();
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
  const admin = await createBooksClient();
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

// ---------------------------------------------------------------------------
// THE CONVERSION (0186, slice books-02)
//
// Leaving Cultivera and Sage behind on 1 November 2026. The dates live in one
// row of `gl_conversion_config` rather than in constants scattered through the
// code, so that moving the cut-over is a data change rather than a deploy.
// `cutover-core.ts` states the SAME dates independently in TypeScript, and a
// test compares the two; that redundancy is the point, because a silent
// disagreement between the app's idea of the cut-over and the database's would
// mis-date the single most important journal in the ledger.
// ---------------------------------------------------------------------------

export type ConversionConfig = {
  cutover_date: string;
  opening_balance_date: string;
  parallel_run_start: string;
  parallel_run_end: string;
  legacy_pos_system: string;
  legacy_gl_system: string;
  legacy_retired: boolean;
  legacy_retired_at: string | null;
  legacy_retired_note: string | null;
};

export async function getConversionConfig(): Promise<
  LedgerResult<ConversionConfig>
> {
  const admin = await createBooksClient();
  const { data, error } = await admin
    .from("gl_conversion_config")
    .select(
      "cutover_date, opening_balance_date, parallel_run_start, parallel_run_end, " +
        "legacy_pos_system, legacy_gl_system, legacy_retired, legacy_retired_at, " +
        "legacy_retired_note",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) return refused<ConversionConfig>(error);
  if (data == null) {
    return refused<ConversionConfig>(
      "The conversion settings row is missing. Migration 0186 seeds it; if this " +
        "environment has not had 0186 applied yet, apply it before converting.",
    );
  }
  return { ok: true, data: data as unknown as ConversionConfig };
}

/** One row of the opening balance worksheet, as stored by 0176. */
export type OpeningBalanceRow = {
  account_code: string;
  amount_cents: number;
  evidence_kind: string;
  evidence_ref: string;
  evidence_note: string | null;
  assumption_note: string | null;
  status: string;
  exclusion_reason: string | null;
};

export async function listOpeningBalanceRows(
  entityCode: string,
): Promise<LedgerResult<OpeningBalanceRow[]>> {
  const admin = await createBooksClient();
  const { data: entity, error: entityError } = await admin
    .from("gl_entities")
    .select("id")
    .eq("code", entityCode)
    .maybeSingle();
  if (entityError) return refused<OpeningBalanceRow[]>(entityError);
  if (entity == null) {
    return refused<OpeningBalanceRow[]>(
      `GL_UNKNOWN_ENTITY: there is no set of books called ${entityCode}`,
    );
  }

  const { data, error } = await admin
    .from("gl_opening_balances")
    .select(
      "account_code, amount_cents, evidence_kind, evidence_ref, evidence_note, " +
        "assumption_note, status, exclusion_reason",
    )
    .eq("entity_id", (entity as { id: string }).id)
    .order("account_code", { ascending: true });
  if (error) return refused<OpeningBalanceRow[]>(error);
  return { ok: true, data: (data ?? []) as unknown as OpeningBalanceRow[] };
}
