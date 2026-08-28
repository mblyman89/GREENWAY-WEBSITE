/**
 * src/lib/accounting/large-draft-notice-store.ts   (slice books-90, PR D)
 *
 * Reads unapproved drafts and their entity thresholds so the pure planner in
 * large-draft-notice-core.ts can decide whether Michael gets an email today.
 *
 * WHY THIS IS NOT `listDraftJournals`
 * -----------------------------------
 * approval-service.ts#listDraftJournals is the right function for the SCREEN:
 * it calls ownerSession() -> requireStaff(), which is exactly what you want when
 * a human is looking at the books. This runs from cron, where there is no
 * signed-in human to be, so that gate would refuse every night and the email
 * would never arrive — silently, because a refusal nobody reads is a refusal
 * nobody acts on.
 *
 * So this uses the service-role admin client, like every other planner behind
 * the reminder engine (compliance-reminders.ts:144, :162). The trade is
 * deliberate and narrow: this file can only ever READ, it selects three
 * specific tables, and the only place its output goes is an email to the
 * address in ORDER_STAFF_EMAILS. It never writes, never posts and never
 * approves.
 *
 * NEVER GUESS (standing rule 1, standing rule 46)
 * -----------------------------------------------
 * A failed read returns ok:false with the database's own message. It does NOT
 * return an empty list, because "there are no large entries waiting" and "I
 * could not find out whether there are large entries waiting" are opposite
 * facts and the second one must never be delivered as the first — an email that
 * stays quiet because the query broke is the worst possible outcome here.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { debitTotalCents } from "@/lib/accounting/approval-core";
import type { LargeDraftFacts } from "@/lib/accounting/large-draft-notice-core";
import { pacificDayKey } from "@/lib/reports/timezone";

/** Default per 0174:683 — gl_approval_policy.threshold_cents default 500000. */
const FALLBACK_THRESHOLD_CENTS = 500_000;

export type LargeDraftReadResult = {
  readonly ok: boolean;
  readonly message: string | null;
  readonly drafts: readonly LargeDraftFacts[];
  /**
   * Drafts whose line amounts could not be totalled (a non-integer amount, so
   * debitTotalCents throws rather than rounding). Passed to the planner as
   * unreadable rows so the email says so out loud.
   */
  readonly unreadable: number;
};

function failed(message: string): LargeDraftReadResult {
  return { ok: false, message, drafts: [], unreadable: 0 };
}

/**
 * Every draft journal currently awaiting approval, with the debit total and the
 * threshold that applies to its entity.
 *
 * Filtering to "large" is NOT done here. That decision belongs to the pure core
 * where it can be self-tested against the migration's rule, and doing it in SQL
 * would put a second, untested copy of the threshold logic in the codebase.
 */
export async function loadUnapprovedDrafts(limit = 200): Promise<LargeDraftReadResult> {
  let admin: ReturnType<typeof createSupabaseAdminClient>;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    return failed(
      `The books database is not reachable, so nothing was checked: ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    );
  }

  const { data: journalRows, error: journalError } = await admin
    .from("gl_journals")
    .select("id, entity_id, journal_date, source_kind, memo, created_at, gl_entities!inner(code)")
    .eq("status", "draft")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (journalError) {
    return failed(`The draft entries could not be read: ${journalError.message}`);
  }

  const rows = (journalRows ?? []) as Array<{
    id: string;
    entity_id: string;
    journal_date: string;
    source_kind: string;
    memo: string | null;
    created_at: string | null;
    gl_entities: { code: string } | { code: string }[] | null;
  }>;

  if (rows.length === 0) {
    return { ok: true, message: null, drafts: [], unreadable: 0 };
  }

  const { data: lineRows, error: lineError } = await admin
    .from("gl_journal_lines")
    .select("journal_id, amount_cents")
    .in(
      "journal_id",
      rows.map((r) => r.id),
    );

  if (lineError) {
    return failed(`The draft entry lines could not be read: ${lineError.message}`);
  }

  const amountsByJournal = new Map<string, number[]>();
  for (const l of (lineRows ?? []) as Array<{ journal_id: string; amount_cents: number }>) {
    const list = amountsByJournal.get(l.journal_id) ?? [];
    list.push(Number(l.amount_cents));
    amountsByJournal.set(l.journal_id, list);
  }

  const { data: policyRows, error: policyError } = await admin
    .from("gl_approval_policy")
    .select("entity_id, threshold_cents");

  if (policyError) {
    return failed(`The approval policy could not be read: ${policyError.message}`);
  }

  const thresholdByEntity = new Map<string, number>();
  for (const p of (policyRows ?? []) as Array<{ entity_id: string; threshold_cents: number }>) {
    thresholdByEntity.set(p.entity_id, Number(p.threshold_cents));
  }

  const drafts: LargeDraftFacts[] = [];
  let unreadable = 0;

  for (const r of rows) {
    const amounts = amountsByJournal.get(r.id) ?? [];

    // A draft with no lines cannot have a total. It is not "zero dollars" — it
    // is a row we cannot judge, so it is reported rather than assumed small.
    if (amounts.length === 0) {
      unreadable += 1;
      continue;
    }

    let totalCents: number;
    try {
      // Reused, not reimplemented: this is the migration's sum(abs)/2 rule and
      // it throws on a float instead of rounding one away.
      totalCents = debitTotalCents(amounts);
    } catch {
      unreadable += 1;
      continue;
    }

    const entity = Array.isArray(r.gl_entities) ? r.gl_entities[0] : r.gl_entities;

    drafts.push({
      journalId: r.id,
      entityCode: entity?.code ?? "unknown",
      journalDate: r.journal_date,
      sourceKind: r.source_kind,
      memo: r.memo ?? "",
      totalCents,
      thresholdCents: thresholdByEntity.get(r.entity_id) ?? FALLBACK_THRESHOLD_CENTS,
      createdDayKey: r.created_at ? pacificDayKey(r.created_at) : null,
    });
  }

  return { ok: true, message: null, drafts, unreadable };
}
