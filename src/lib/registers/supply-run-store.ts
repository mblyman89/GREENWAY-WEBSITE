/**
 * src/lib/registers/supply-run-store.ts  (Fix Phase 2.7c · G-11)
 *
 * Reads and writes for the supply-run screen. Every write is made here, by
 * the server (service role), after the server action has checked the
 * permission, the PINs and the rule in supply-run-core.ts, and before it
 * records the audit row. Migration 0318 gives staff no write policy, so there
 * is no other way in. This file never posts to the books: the poster is
 * src/lib/accounting/supply-run-posting-service.ts.
 *
 * Rule 46: a failed read is returned as an error, never as "no runs".
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { type SupplyRunRow } from "@/lib/registers/supply-run-core";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";

export const SUPPLY_RUN_COLUMNS =
  "id, business_day, taken_by, approved_by, amount_minor, reason, taken_at, advance_journal_id, " +
  "settled_by, settled_at, settled_day, receipt_minor, change_minor, expense_account, receipt_note, settle_journal_id";

export type DbSupplyRun = {
  id: string;
  business_day: string;
  taken_by: string | null;
  approved_by: string | null;
  amount_minor: number;
  reason: string;
  taken_at: string;
  advance_journal_id: string | null;
  settled_by: string | null;
  settled_at: string | null;
  settled_day: string | null;
  receipt_minor: number | null;
  change_minor: number | null;
  expense_account: string | null;
  receipt_note: string | null;
  settle_journal_id: string | null;
};

export function toSupplyRunRow(d: DbSupplyRun): SupplyRunRow {
  return {
    id: d.id,
    businessDay: d.business_day,
    takenBy: d.taken_by,
    approvedBy: d.approved_by,
    amountMinor: d.amount_minor,
    reason: d.reason,
    takenAt: d.taken_at,
    advanceJournalId: d.advance_journal_id,
    settledBy: d.settled_by,
    settledAt: d.settled_at,
    settledDay: d.settled_day,
    receiptMinor: d.receipt_minor,
    changeMinor: d.change_minor,
    expenseAccount: d.expense_account,
    receiptNote: d.receipt_note,
    settleJournalId: d.settle_journal_id,
  };
}

/** "The 0318 table is not there yet" (the owner has not applied the migration). */
export function isMissingSupplySchema(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "42P01" || err.code === "PGRST204" || err.code === "PGRST205") return true;
  return /column .* does not exist|Could not find the .* column|relation .* does not exist|Could not find the table/i.test(err.message ?? "");
}

export type SupplyListResult = { ok: true; runs: SupplyRunRow[] } | { ok: false; missingSchema: boolean; error: string };

/** Every OPEN run (any age) plus every run taken on or after `sinceDay`. Newest first. */
export async function listSupplyRuns(sinceDay: string): Promise<SupplyListResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, missingSchema: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  return readAllRuns((a, b) =>
    admin
      .from("supply_runs")
      .select(SUPPLY_RUN_COLUMNS)
      .or(`settled_at.is.null,business_day.gte.${sinceDay}`)
      .order("taken_at", { ascending: false })
      .order("id", { ascending: true })
      .range(a, b),
  );
}

/**
 * Read every page (rule 46: a list cut at the server's row cap is not "all").
 * A failure on any page is returned as a failure, never as a shorter list.
 */
async function readAllRuns(
  page: (a: number, b: number) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>,
): Promise<SupplyListResult> {
  let missing = false;
  let firstError: string | null = null;
  const read = await pagedAllChecked<DbSupplyRun>(async (a, b) => {
    const { data, error } = await page(a, b);
    if (error) {
      if (isMissingSupplySchema(error)) missing = true;
      firstError ??= error.message;
      return { rows: [], ok: false };
    }
    return { rows: (data as DbSupplyRun[] | null) ?? [], ok: true };
  });
  if (missing) return { ok: false, missingSchema: true, error: firstError ?? "supply_runs is missing" };
  if (!read.verdict.complete) return { ok: false, missingSchema: false, error: firstError ?? read.verdict.message };
  return { ok: true, runs: read.rows.map(toSupplyRunRow) };
}

/** Only the open runs (cash out with a named person). For the safe page notice. */
export async function listOpenSupplyRuns(): Promise<SupplyListResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, missingSchema: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  return readAllRuns((a, b) =>
    admin
      .from("supply_runs")
      .select(SUPPLY_RUN_COLUMNS)
      .is("settled_at", null)
      .order("taken_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b),
  );
}

export async function getSupplyRun(id: string): Promise<{ ok: true; run: SupplyRunRow | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("supply_runs").select(SUPPLY_RUN_COLUMNS).eq("id", id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, run: data ? toSupplyRunRow(data as unknown as DbSupplyRun) : null };
}

/** Cash out: a new open run. */
export async function insertCashOut(input: {
  businessDay: string;
  takerId: string;
  approverId: string;
  amountMinor: number;
  reason: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("supply_runs")
    .insert({
      business_day: input.businessDay,
      taken_by: input.takerId,
      approved_by: input.approverId,
      amount_minor: input.amountMinor,
      reason: input.reason,
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingSupplySchema(error)) {
      return { ok: false, error: "The supply-run table is not set up yet: apply migration 0318_supply_runs.sql. Use paper form 8.4 until then. Nothing was saved." };
    }
    return { ok: false, error: `The supply run could not be saved: ${error.message}. Nothing was saved.` };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Settle once: a conditional update (settled_at is null), so two people
 * pressing Settle at once cannot both write. The 0318 trigger refuses a
 * second settle too.
 */
export async function saveSettle(input: {
  runId: string;
  settledDay: string;
  receiverId: string;
  receiptMinor: number;
  changeMinor: number;
  expenseAccount: string | null;
  note: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("supply_runs")
    .update({
      settled_by: input.receiverId,
      settled_at: new Date().toISOString(),
      settled_day: input.settledDay,
      receipt_minor: input.receiptMinor,
      change_minor: input.changeMinor,
      expense_account: input.expenseAccount,
      receipt_note: input.note,
    })
    .eq("id", input.runId)
    .is("settled_at", null)
    .select("id");
  if (error) return { ok: false, error: `The settle could not be saved: ${error.message}. Nothing was saved.` };
  if (((data as { id: string }[] | null) ?? []).length === 0) {
    return { ok: false, error: "This supply run was already settled (someone else may have just done it). Nothing was saved." };
  }
  return { ok: true };
}
