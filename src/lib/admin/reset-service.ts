/**
 * src/lib/admin/reset-service.ts
 *
 * SERVER-ONLY. The factory reset, executed.
 *
 * ---------------------------------------------------------------------------
 * D-64 — WHY THIS FILE WAS REWRITTEN
 * ---------------------------------------------------------------------------
 * This module used to call `reset_operational_data()` (migrations 0069, guarded
 * 0097, swept 0140). books-80 replaced that function with `gl_factory_reset()`
 * in migration 0209 because the old one was 68 migrations stale and had never
 * heard of the general ledger, which was born at 0172 (D-62).
 *
 * The new SQL was written. A test guarded it against the decision layer in
 * `factory-reset-core.ts`. Both were merged. But nothing guarded the CALL PATH,
 * and the call path was never changed — so the button in the admin UI kept
 * running the old function. Measured from disk on 2026-09-10, before this fix:
 *
 *     tables the core classifies WIPE ............ 138
 *     tables reset_operational_data() deletes .....  66
 *     tables it would have left behind ............  72
 *
 * Among the 72: gl_journals, gl_journal_lines, gl_periods, gl_audit_events,
 * gl_opening_balances, gl_bank_matches, gl_bank_reconciliations,
 * gl_override_log, gl_payroll_allocations, gl_template_changes,
 * gl_account_proposals, gl_classification_suggestions, pay_periods,
 * payroll_ytd_accumulators, sick_leave_ledger and sick_leave_requests.
 *
 * That is the entire general ledger plus the year-to-date payroll figures a
 * W-2 is computed from. The owner would have pressed "reset", been told it
 * succeeded, and opened for business with rehearsal numbers still on his books
 * — the precise failure D-62 was raised to prevent.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS USES THE OWNER'S SESSION, NOT THE SERVICE-ROLE KEY
 * ---------------------------------------------------------------------------
 * The old module used `createSupabaseAdminClient()`. `gl_factory_reset` gates
 * on `public.is_owner()`, which is:
 *
 *     select exists(select 1 from staff_profiles
 *                   where id = auth.uid() and active and role = 'owner')
 *                                                  [0185_books_owner_only.sql:51]
 *
 * The service-role key carries no `sub` claim, so `auth.uid()` is NULL and
 * `is_owner()` is FALSE. Calling the reset with the admin client would fail
 * 100% of the time with RESET_NOT_OWNER, no matter who was signed in. This is
 * not a guess: it is the identical defect already diagnosed, fixed and written
 * up in `src/lib/supabase/books-client.ts`, where using the master key made
 * every books screen refuse the owner himself.
 *
 * So the reset goes through the request's own authenticated session. The
 * database then sees the real human, and enforces the owner rule itself rather
 * than being talked past. DO NOT swap this back to the admin client.
 */
import "server-only";
import { createBooksClient } from "@/lib/supabase/books-client";
import {
  CURRENT_RESET_RPC,
  RESET_AUDIT_RPC,
  RESET_CONFIRM_PHRASE,
  RESET_PREVIEW_RPC,
} from "@/lib/accounting/factory-reset-core";

/** The four kinds of evidence that the rehearsal is over, read before wiping. */
export type ResetPreview = {
  completedOrders: number;
  ccrsBatches: number;
  exciseReturnsFiled: number;
  postedJournals: number;
  looksLikeRealTrade: boolean;
  retentionCite: string;
  retentionYears: number;
};

export type FactoryResetSummary = {
  ok: boolean;
  resetAt: string | null;
  acknowledgedRetention: boolean;
  /** table name -> rows deleted, exactly as the DB function reported. */
  tables: Record<string, number>;
  tablesEmptied: number;
  totalRowsDeleted: number;
  evidenceAtReset: {
    completedOrders: number;
    ccrsBatches: number;
    exciseReturnsFiled: number;
    postedJournals: number;
  };
};

/** A problem the post-reset audit found. An empty array means it came out clean. */
export type ResetAuditProblem = { problem: string; detail: string };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Read-only. What does the database look like before we touch it?
 *
 * Shown on the reset screen so the owner sees the evidence BEFORE typing the
 * phrase, rather than discovering the retention guard by being refused.
 */
export async function previewFactoryReset(): Promise<ResetPreview> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase.rpc(RESET_PREVIEW_RPC);
  if (error) throw new Error(describeRpcError(error.message));

  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    completedOrders: num(raw.completed_orders),
    ccrsBatches: num(raw.ccrs_batches),
    exciseReturnsFiled: num(raw.excise_returns_filed),
    postedJournals: num(raw.posted_journals),
    looksLikeRealTrade: raw.looks_like_real_trade === true,
    retentionCite: typeof raw.retention_cite === "string" ? raw.retention_cite : "WAC 314-55-087(1)",
    retentionYears: num(raw.retention_years) || 5,
  };
}

/**
 * Run the factory reset.
 *
 * `confirmPhrase` is forwarded verbatim — this layer does NOT normalise it.
 * The database compares `btrim(confirm_phrase) <> 'ERASE ALL TEST DATA'`, and
 * a helper that upper-cased on the way through would mean the app accepted
 * phrases the database rejects, or worse, accepted a casual "erase all test
 * data" as deliberate intent for the most destructive operation in the system.
 */
export async function runFactoryReset(
  confirmPhrase: string,
  acknowledgeRetention: boolean,
): Promise<FactoryResetSummary> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase.rpc(CURRENT_RESET_RPC, {
    confirm_phrase: confirmPhrase,
    acknowledge_wac_314_55_087: acknowledgeRetention,
  });
  if (error) throw new Error(describeRpcError(error.message));

  const raw = (data ?? {}) as Record<string, unknown>;
  const ev = (raw.evidence_at_reset ?? {}) as Record<string, unknown>;
  return {
    ok: raw.ok === true,
    resetAt: typeof raw.reset_at === "string" ? raw.reset_at : null,
    acknowledgedRetention: raw.acknowledged_wac_314_55_087 === true,
    tables: (raw.tables ?? {}) as Record<string, number>,
    tablesEmptied: num(raw.tables_emptied),
    totalRowsDeleted: num(raw.total_rows_deleted),
    evidenceAtReset: {
      completedOrders: num(ev.completed_orders),
      ccrsBatches: num(ev.ccrs_batches),
      exciseReturnsFiled: num(ev.excise_returns_filed),
      postedJournals: num(ev.posted_journals),
    },
  };
}

/**
 * Verify the reset actually worked. Returns ONLY problems, so an empty array
 * is the pass. Checks both directions: the books must be empty, and the chart
 * of accounts must have survived.
 *
 * Run automatically straight after a reset — "it said it succeeded" is exactly
 * the assurance D-62 gave for months while the ledger sat untouched.
 */
export async function auditFactoryReset(): Promise<ResetAuditProblem[]> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase.rpc(RESET_AUDIT_RPC);
  if (error) throw new Error(describeRpcError(error.message));
  if (!Array.isArray(data)) return [];
  return data.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      problem: typeof row.problem === "string" ? row.problem : "UNKNOWN",
      detail: typeof row.detail === "string" ? row.detail : "",
    };
  });
}

/**
 * Turn a raw Postgres error into something the owner can act on. The DB raises
 * machine-readable prefixes; left alone they surface as wall-of-text alerts.
 */
function describeRpcError(message: string): string {
  if (/RESET_NOT_OWNER/.test(message)) {
    return "Only the owner can run the factory reset. You are signed in, but not as the owner account.";
  }
  if (/RESET_BAD_CONFIRMATION/.test(message)) {
    return `Nothing was deleted. To confirm, type exactly: ${RESET_CONFIRM_PHRASE}`;
  }
  if (/RETENTION GUARD/.test(message)) {
    // The DB message already names the counts and the citation; it is the most
    // useful text available and is passed through intact.
    return message;
  }
  if (/(function|schema cache).*(does not exist|not found)/i.test(message)) {
    return (
      `The factory reset function is not installed in this database yet. Apply ` +
      `supabase/migrations/0209_factory_reset.sql in the Supabase SQL editor, then try again.`
    );
  }
  return `Reset failed: ${message}`;
}
