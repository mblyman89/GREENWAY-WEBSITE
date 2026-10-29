import "server-only";

/**
 * src/lib/accounting/supply-run-posting-service.ts  (Fix Phase 2.7c · G-11)
 *
 * THE WIRE that books a supply run. The judgement lives in
 * register-cash-journal-core.ts (books-98: buildSupplyAdvanceJournal,
 * buildSupplySettleJournal); this file reads the run, asks the builder,
 * posts, and records which books entry it made. Before Phase 2.7c nothing
 * called either builder: the census row cash_and_banking.employee_supply_advance
 * said "poster: null, reachable: MISSING" (F-02-11).
 *
 * THE CHAIN, LINK BY LINK (rule 133b)
 *   cash out on /admin/registers/supply-runs
 *     -> cashOutAction (orders.manage, taker PIN, manager/lead approver PIN,
 *        checkCashOut)
 *     -> supply-run-store.ts#insertCashOut
 *     -> postAdvanceForRun(runId)                         <- this file
 *     -> buildSupplyAdvanceJournal: DR 12100 / CR 10100
 *     -> submitJournal, autoPost, sourceRef `supply-advance:<run id>`
 *     -> advance_journal_id (filled once; 0318 trigger)
 *   settle on the same page
 *     -> settleAction (orders.manage, receiver PIN, checkSettle)
 *     -> supply-run-store.ts#saveSettle (once)
 *     -> postSettleForRun(runId)                          <- this file
 *     -> buildSupplySettleJournal: DR expense / DR 10100 / CR 12100
 *     -> settleLinesWithCostClass: the expense line carries the account's
 *        280E class (the builder writes "none" and the ledger refuses an
 *        expense line without a class, 0172 check 7 GL_COST_CLASS_REQUIRED)
 *     -> submitJournal, autoPost, sourceRef `supply-settle:<run id>`
 *     -> settle_journal_id (filled once)
 *
 * The settle is posted only after the advance is in the books, so 12100 is
 * never credited for an advance it was never debited with.
 *
 * WHY A FAILED POST DOES NOT UNDO THE RECORD
 * The cash really left the master till (or really came back). Deleting the
 * record because the ledger was down would make the screen disagree with the
 * till. The run keeps no journal id instead, the screen says "NOT POSTED",
 * and "Post to the books" retries. The source ref makes a retry safe:
 * submitJournal returns "duplicate" rather than writing twice.
 *
 * 'bank' is approval-exempt (as for the drawer close and the bag seal): the
 * two-PIN cash out and the counted settle ARE the human acts.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { submitJournal } from "@/lib/accounting/posting-service";
import { buildSupplyAdvanceJournal, buildSupplySettleJournal } from "@/lib/accounting/register-cash-journal-core";
import { advanceSourceRef, settleSourceRef, settleLinesWithCostClass } from "@/lib/registers/supply-run-core";
import { SUPPLY_RUN_COLUMNS, toSupplyRunRow, type DbSupplyRun } from "@/lib/registers/supply-run-store";

export type SupplyPostOutcome =
  | { kind: "posted"; runId: string; sourceRef: string; journalId: string | null; journalNo: number | null; duplicate: boolean; message: string; linkError: string | null }
  | { kind: "refused"; runId: string; code: string; message: string }
  | { kind: "failed"; runId: string; sourceRef: string | null; code: string; message: string };

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function readRun(admin: Admin, runId: string) {
  const { data, error } = await admin.from("supply_runs").select(SUPPLY_RUN_COLUMNS).eq("id", runId).maybeSingle();
  if (error) return { ok: false as const, message: `The supply run could not be read: ${error.message}` };
  return { ok: true as const, run: data ? toSupplyRunRow(data as unknown as DbSupplyRun) : null };
}

async function employeeName(admin: Admin, id: string | null): Promise<string> {
  if (!id) return "";
  const { data } = await admin.from("employees").select("full_name").eq("id", id).maybeSingle();
  return ((data as { full_name: string } | null)?.full_name ?? "").trim();
}

/** Post the cash-out entry (DR 12100 / CR 10100). Safe to call again. */
export async function postAdvanceForRun(runId: string, client?: Admin): Promise<SupplyPostOutcome> {
  if (!client && !isSupabaseServiceConfigured) {
    return { kind: "failed", runId, sourceRef: null, code: "NOT_CONFIGURED", message: "Supabase is not configured, so nothing was posted." };
  }
  const admin = client ?? createSupabaseAdminClient();
  const got = await readRun(admin, runId);
  if (!got.ok) return { kind: "failed", runId, sourceRef: null, code: "READ_FAILED", message: got.message };
  const run = got.run;
  if (!run) return { kind: "refused", runId, code: "RUN_NOT_FOUND", message: "That supply run was not found. Nothing was posted." };

  const who = await employeeName(admin, run.takenBy);
  const sourceRef = advanceSourceRef(run.id);
  const built = buildSupplyAdvanceJournal({ journalDate: run.businessDay, employeeName: who, amountMinor: run.amountMinor, sourceRef });
  if (built.kind !== "journal") return { kind: "refused", runId, code: built.code, message: built.explanation };

  const result = await submitJournal(
    {
      entityCode: built.journal.entityCode,
      journalDate: built.journal.journalDate,
      sourceKind: built.journal.sourceKind,
      sourceRef,
      memo: built.journal.memo,
      lines: built.journal.lines.map((l) => ({
        accountCode: l.accountCode,
        amountCents: l.amountCents,
        costClass: l.costClass,
        description: l.description ?? undefined,
      })),
      autoPost: true,
    },
    admin,
  );
  if (!result.ok) return { kind: "failed", runId, sourceRef, code: result.code, message: result.message };

  let linkError: string | null = null;
  const journalId = result.journalId ?? null;
  if (journalId && !run.advanceJournalId) {
    const { error: upErr } = await admin.from("supply_runs").update({ advance_journal_id: journalId }).eq("id", run.id).is("advance_journal_id", null);
    if (upErr) linkError = upErr.message;
  }
  const duplicate = result.outcome === "duplicate";
  return {
    kind: "posted",
    runId,
    sourceRef,
    journalId,
    journalNo: result.journalNo ?? null,
    duplicate,
    message: duplicate ? "The cash out was already in the books. Nothing was written twice." : built.explanation,
    linkError,
  };
}

/** Post the settle entry (DR expense / DR 10100 / CR 12100). Safe to call again. */
export async function postSettleForRun(runId: string, client?: Admin): Promise<SupplyPostOutcome> {
  if (!client && !isSupabaseServiceConfigured) {
    return { kind: "failed", runId, sourceRef: null, code: "NOT_CONFIGURED", message: "Supabase is not configured, so nothing was posted." };
  }
  const admin = client ?? createSupabaseAdminClient();
  const got = await readRun(admin, runId);
  if (!got.ok) return { kind: "failed", runId, sourceRef: null, code: "READ_FAILED", message: got.message };
  const run = got.run;
  if (!run) return { kind: "refused", runId, code: "RUN_NOT_FOUND", message: "That supply run was not found. Nothing was posted." };
  if (run.settledAt === null || run.settledDay === null || run.receiptMinor === null) {
    return { kind: "refused", runId, code: "RUN_NOT_SETTLED", message: "This supply run is not settled yet, so there is nothing to post." };
  }
  // Never credit 12100 for an advance that is not in the books.
  if (run.advanceJournalId === null) {
    return {
      kind: "refused",
      runId,
      code: "ADVANCE_NOT_POSTED",
      message: "The cash out for this run is not in the books yet. Press \"Post to the books\" on the cash out first, then the settle.",
    };
  }

  const who = await employeeName(admin, run.takenBy);
  const sourceRef = settleSourceRef(run.id);
  const built = buildSupplySettleJournal({
    journalDate: run.settledDay,
    employeeName: who,
    advancedMinor: run.amountMinor,
    receiptMinor: run.receiptMinor,
    expenseAccount: run.expenseAccount ?? "",
    sourceRef,
  });
  if (built.kind !== "journal") return { kind: "refused", runId, code: built.code, message: built.explanation };

  const lines = settleLinesWithCostClass(built.journal.lines, run.receiptMinor > 0 ? run.expenseAccount : null);
  if (lines === null) {
    return { kind: "refused", runId, code: "EXPENSE_ACCOUNT_NOT_ALLOWED", message: `Account ${run.expenseAccount} is not on the supply expense list. Nothing was posted.` };
  }

  const result = await submitJournal(
    {
      entityCode: built.journal.entityCode,
      journalDate: built.journal.journalDate,
      sourceKind: built.journal.sourceKind,
      sourceRef,
      memo: built.journal.memo,
      lines: lines.map((l) => ({
        accountCode: l.accountCode,
        amountCents: l.amountCents,
        costClass: l.costClass,
        description: l.description ?? undefined,
      })),
      autoPost: true,
    },
    admin,
  );
  if (!result.ok) return { kind: "failed", runId, sourceRef, code: result.code, message: result.message };

  let linkError: string | null = null;
  const journalId = result.journalId ?? null;
  if (journalId && !run.settleJournalId) {
    const { error: upErr } = await admin.from("supply_runs").update({ settle_journal_id: journalId }).eq("id", run.id).is("settle_journal_id", null);
    if (upErr) linkError = upErr.message;
  }
  const duplicate = result.outcome === "duplicate";
  return {
    kind: "posted",
    runId,
    sourceRef,
    journalId,
    journalNo: result.journalNo ?? null,
    duplicate,
    message: duplicate ? "The settle was already in the books. Nothing was written twice." : built.explanation,
    linkError,
  };
}

/** One sentence for the redirect banner. A new kind fails to compile here. */
export function describeSupplyPost(o: SupplyPostOutcome, leg: "advance" | "settle"): string {
  switch (o.kind) {
    case "posted":
      if (o.duplicate) return "Already in the books, not booked twice.";
      return leg === "advance"
        ? `Posted to the books${o.journalNo != null ? ` as entry #${o.journalNo}` : ""}: 12100 Employee Advances up, 10100 Vault down.`
        : `Posted to the books${o.journalNo != null ? ` as entry #${o.journalNo}` : ""}: the expense is booked, the change is back in 10100 Vault, and 12100 is cleared for this run.`;
    case "refused":
      return `NOT POSTED: ${o.message}`;
    case "failed":
      return `NOT POSTED: ${o.message} The record is kept; press "Post to the books" to try again.`;
  }
}
