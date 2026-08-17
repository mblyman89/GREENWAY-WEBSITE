/**
 * src/lib/accounting/journal-entry-service.ts   (slice books-01)
 *
 * SERVER-ONLY. THE DOOR INTO THE VAULT.
 *
 * Before this file existed, the bookkeeping branch had a fully built, fully
 * tested posting engine (`gl_submit_journal`, migration 0174) that NOTHING in
 * the application called. The vault was built, inspected and locked, and no door
 * was ever cut into it. This is the door.
 *
 * WHAT IT DOES, IN ORDER
 *   1. Confirms the caller is the OWNER. Not owner-or-admin — owner.
 *      (Owner decision 2026-08-17; database side is migration 0179.)
 *   2. Loads the accounts and period state the advisor needs.
 *   3. Runs the PURE advisor (`journal-advisor-core`) to decide whether to
 *      push back, and on what.
 *   4. Refuses only for a hard block. For everything else, it requires the
 *      owner's acknowledgement — and then YIELDS.
 *   5. Records the override as an assumption note on the journal, so the
 *      judgement call is preserved (standing rule 3).
 *   6. Submits through `gl_submit_journal`, the same single door every machine
 *      feed uses, so this inherits balance checks, the idempotency key, the
 *      line fingerprint, period validation and the 280E rules.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   • It does not insert into gl_journals or gl_journal_lines directly. Ever.
 *     Bypassing gl_submit_journal would bypass every control in 0172–0177.
 *   • It does not decide whether the entry is *right*. The owner does. The
 *     advisor argues; the owner wins.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireStaff } from "@/lib/auth/session";
import { canReadBooks } from "./books-view-core";
import { submitJournal } from "./posting-service";
import {
  evaluateJournalDraft,
  canSubmit,
  buildAssumptionNote,
  type AdvisorAccount,
  type AdvisorContext,
  type AdvisorDraft,
  type AdvisorEntityCode,
  type AdvisorVerdict,
} from "./journal-advisor-core";

/** What a caller hands in. Mirrors the shape of the entry form. */
export type ManualJournalInput = {
  entityCode: AdvisorEntityCode;
  journalDate: string;
  memo: string;
  lines: ReadonlyArray<{
    accountCode: string;
    amountCents: number;
    costClass?: string | null;
    description?: string | null;
  }>;
  /** Advisor codes the owner has read and confirmed. */
  acknowledgedCodes?: readonly string[];
};

export type ManualJournalResult = {
  ok: boolean;
  /** Machine code: GL_DRAFT_CREATED, ADV_BLOCKED, ADV_NEEDS_ACK, GL_FORBIDDEN… */
  code: string;
  /** Plain English, written for Michael. */
  message: string;
  journalId: string | null;
  journalNo: number | null;
  /** The full advisory verdict, so the screen can render every finding. */
  verdict: AdvisorVerdict | null;
  /** Codes still awaiting acknowledgement, when that is why we stopped. */
  unacknowledged: readonly string[];
};

/**
 * Map the DATABASE account type vocabulary onto the advisor's.
 *
 * 0172 uses: asset | liability | equity | income | cogs | expense |
 *            other_income | other_expense
 * The advisor uses the shorter GAAP set, with `revenue` where the database says
 * `income`. Kept as an explicit table rather than a cast so that a new database
 * type cannot silently arrive as `other` and skip every advisor check that keys
 * off type — an unmapped value lands on `other`, which is the conservative
 * answer, and is the one case worth noticing in review.
 */
function mapAccountType(dbType: string): AdvisorAccount["type"] {
  switch (dbType) {
    case "asset":
      return "asset";
    case "liability":
      return "liability";
    case "equity":
      return "equity";
    case "income":
    case "other_income":
      return "revenue";
    case "cogs":
      return "cogs";
    case "expense":
    case "other_expense":
      return "expense";
    default:
      return "other";
  }
}

/**
 * Owner-only guard. Returns the session, or null when the caller is not the
 * owner. Callers turn null into GL_FORBIDDEN.
 */
async function requireOwner() {
  const session = await requireStaff();
  if (!canReadBooks(session.profile.role)) return null;
  return session;
}

/**
 * Load the advisor's context from the database: the accounts referenced by the
 * draft, whether the period is closed, and which accounts hold excise.
 *
 * Only the referenced accounts are loaded, not all 184 — the advisor is pure and
 * needs exactly what the draft touches.
 */
export async function loadAdvisorContext(
  entityCode: string,
  journalDate: string,
  accountCodes: readonly string[],
): Promise<AdvisorContext> {
  const supabase = createSupabaseAdminClient();
  const codes = Array.from(new Set(accountCodes.filter((c) => c && c.trim() !== "")));

  const accounts: Record<string, AdvisorAccount> = {};
  const exciseAccountCodes: string[] = [];
  const employeeAdvanceAccountCodes: string[] = [];

  if (codes.length > 0) {
    // Column names verified against migration 0172's create table for
    // public.gl_accounts: type / normal_balance / is_control /
    // requires_cost_class / allowed_entity_codes / active.
    const { data } = await supabase
      .from("gl_accounts")
      .select(
        "code, name, type, normal_balance, requires_cost_class, is_control, active, allowed_entity_codes",
      )
      .in("code", codes);

    for (const row of data ?? []) {
      const r = row as {
        code: string;
        name: string;
        type: string;
        normal_balance: AdvisorAccount["normalBalance"];
        requires_cost_class: boolean | null;
        is_control: boolean | null;
        active: boolean | null;
        allowed_entity_codes: string[] | null;
      };
      accounts[r.code] = {
        code: r.code,
        name: r.name,
        type: mapAccountType(r.type),
        normalBalance: r.normal_balance,
        requiresCostClass: Boolean(r.requires_cost_class),
        isControl: Boolean(r.is_control),
        isActive: r.active !== false,
        allowedEntities: (r.allowed_entity_codes ?? undefined) as
          | readonly AdvisorEntityCode[]
          | undefined,
      };
    }
  }

  // Excise-holding accounts, resolved by name so the advisor's hard block works
  // even if the chart is renumbered. Cheap query, 184 rows at most.
  {
    const { data } = await supabase
      .from("gl_accounts")
      .select("code, name")
      .ilike("name", "%excise%");
    for (const row of data ?? []) {
      const r = row as { code: string; name: string };
      exciseAccountCodes.push(r.code);
    }
  }

  // Employee-advance receivables, so a correctly coded loan draws no objection.
  {
    const { data } = await supabase
      .from("gl_accounts")
      .select("code, name")
      .or("name.ilike.%employee advance%,name.ilike.%employee receivable%");
    for (const row of data ?? []) {
      const r = row as { code: string; name: string };
      employeeAdvanceAccountCodes.push(r.code);
    }
  }

  // Is the period closed? gl_periods is keyed by entity + fiscal year + period,
  // with start_date / end_date bounds (column names verified against 0172).
  //
  // NOTE ON THE "NO ROW" CASE: a date with no period row is NOT treated as
  // closed here. That is deliberate — gl_post_journal does its own period
  // validation and will refuse authoritatively. Guessing "closed" in the advisor
  // would produce a hard block the database does not actually impose, and a
  // guardrail that lies is worse than no guardrail.
  let periodClosed = false;
  {
    const { data } = await supabase
      .from("gl_periods")
      .select("status, start_date, end_date, gl_entities!inner(code)")
      .eq("gl_entities.code", entityCode)
      .lte("start_date", journalDate)
      .gte("end_date", journalDate)
      .maybeSingle();
    const row = data as { status?: string } | null;
    if (row?.status && row.status !== "open") periodClosed = true;
  }

  return {
    accounts,
    periodClosed,
    exciseAccountCodes,
    employeeAdvanceAccountCodes,
  };
}

/**
 * PREVIEW. Run the advisor without writing anything.
 *
 * The entry screen calls this as the owner types, so the pushback appears BEFORE
 * the save button is pressed rather than as a rejection afterwards. A guardrail
 * you meet at the end of the work feels like an obstacle; one you meet while
 * working feels like help.
 */
export async function previewManualJournal(
  input: ManualJournalInput,
): Promise<ManualJournalResult> {
  const session = await requireOwner();
  if (!session) {
    return {
      ok: false,
      code: "GL_FORBIDDEN",
      message: "The books are owner-only.",
      journalId: null,
      journalNo: null,
      verdict: null,
      unacknowledged: [],
    };
  }

  const draft = toDraft(input);
  const ctx = await loadAdvisorContext(
    input.entityCode,
    input.journalDate,
    draft.lines.map((l) => l.accountCode),
  );
  const verdict = evaluateJournalDraft(draft, ctx);
  const gate = canSubmit(verdict, input.acknowledgedCodes ?? []);

  return {
    ok: gate.ok,
    code: verdict.postable ? (gate.ok ? "ADV_READY" : "ADV_NEEDS_ACK") : "ADV_BLOCKED",
    message: gate.ok
      ? "This entry is ready to post."
      : gate.reason,
    journalId: null,
    journalNo: null,
    verdict,
    unacknowledged: gate.unacknowledged,
  };
}

/** Normalise a caller's input into the advisor's draft shape. */
function toDraft(input: ManualJournalInput): AdvisorDraft {
  return {
    entityCode: input.entityCode,
    journalDate: (input.journalDate ?? "").trim(),
    memo: input.memo ?? "",
    lines: (input.lines ?? []).map((l) => ({
      accountCode: (l.accountCode ?? "").trim(),
      amountCents: l.amountCents,
      costClass: (l.costClass ?? null) as AdvisorDraft["lines"][number]["costClass"],
      description: l.description ?? null,
    })),
  };
}

/**
 * POST a manual general journal entry.
 *
 * Returns a draft journal (status 'draft'), because `manual` is not an
 * auto-post-eligible source kind in 0174 §5 — by design. The owner reviews and
 * posts it, which is the second look he asked the machine to give him rather
 * than a second person.
 */
export async function submitManualJournal(
  input: ManualJournalInput,
): Promise<ManualJournalResult> {
  const session = await requireOwner();
  if (!session) {
    return {
      ok: false,
      code: "GL_FORBIDDEN",
      message:
        "The books are owner-only. Paying vendors and paying employees are the only financial actions " +
        "an admin can take.",
      journalId: null,
      journalNo: null,
      verdict: null,
      unacknowledged: [],
    };
  }

  const draft = toDraft(input);
  const ctx = await loadAdvisorContext(
    input.entityCode,
    input.journalDate,
    draft.lines.map((l) => l.accountCode),
  );
  const verdict = evaluateJournalDraft(draft, ctx);
  const acknowledged = input.acknowledgedCodes ?? [];
  const gate = canSubmit(verdict, acknowledged);

  if (!gate.ok) {
    return {
      ok: false,
      code: verdict.postable ? "ADV_NEEDS_ACK" : "ADV_BLOCKED",
      message: gate.reason,
      journalId: null,
      journalNo: null,
      verdict,
      unacknowledged: gate.unacknowledged,
    };
  }

  // The judgement call, preserved. If the advisor objected and the owner
  // proceeded, that sentence is the most useful line in the audit trail.
  const assumptionNote = buildAssumptionNote(verdict, acknowledged);

  const result = await submitJournal({
    entityCode: input.entityCode,
    journalDate: draft.journalDate,
    sourceKind: "manual",
    // A hand-keyed entry has no external event to key on, so no idempotency
    // key — 0174 §1 explicitly allows this for `manual`.
    sourceRef: null,
    memo: draft.memo.trim(),
    lines: draft.lines.map((l) => ({
      accountCode: l.accountCode,
      amountCents: l.amountCents,
      costClass: l.costClass ?? undefined,
      description: l.description ?? undefined,
    })),
    autoPost: false,
    assumptionNote,
  });

  return {
    ok: result.ok,
    code: result.code,
    message: result.message,
    journalId: result.journalId,
    journalNo: result.journalNo,
    verdict,
    unacknowledged: [],
  };
}
