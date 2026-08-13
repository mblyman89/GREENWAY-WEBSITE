// =============================================================================
// posting-service.ts — THE ONE DOOR into the general ledger. SERVER-ONLY.
//
// F1 built the vault (tables, immutability triggers, gl_post_journal). F2 built
// the chart. F3 — this file plus migration 0174 — builds the door, because a
// grep of the application found NOTHING that could write a journal at all: the
// only way to record a transaction was hand-typed SQL in the Supabase console,
// which is exactly the unaudited path that produced the Sage drift.
//
// EVERY ledger write in this platform goes through submitJournal(). There is no
// second path, and there must never be one. If a future feature needs to record
// something in the books, it calls this function; if this function refuses, the
// answer is no.
//
// WHAT THIS FILE IS *NOT*
// -----------------------
// It is not where the rules live. The rules live in two places that both
// enforce them independently:
//   1. posting-core.ts — pure, swept and mutation-tested, used to give the
//      caller a fast, readable answer BEFORE touching the network.
//   2. migration 0174 — the database function gl_submit_journal(), which
//      re-derives every automation decision server-side from the template rows.
//
// That duplication is deliberate. This file could contain a bug, or a future
// developer could call the RPC directly; in either case the database still
// refuses. The pure core is the courtesy, the database is the guarantee.
// =============================================================================

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  decidePosting,
  buildIdempotencyKey,
  type EntityCode,
  type PostingDecision,
  type PostingRequest,
  type PostingTemplate,
  type SourceKind,
} from "./posting-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export interface JournalLineInput {
  accountCode: string;
  /** Signed integer cents: POSITIVE = debit, NEGATIVE = credit. */
  amountCents: number;
  costClass?: string;
  description?: string;
}

export interface SubmitJournalInput {
  entityCode: EntityCode;
  journalDate: string;
  sourceKind: SourceKind;
  /** Stable external id. Required for anything a machine submits. */
  sourceRef: string | null;
  memo: string;
  lines: JournalLineInput[];
  templateCode?: string | null;
  expectedCents?: number | null;
  /** A REQUEST, never a permission — the database decides. */
  autoPost?: boolean;
  assumptionNote?: string | null;
  intercompanyRef?: string | null;
  threeWayMatched?: boolean;
}

export interface SubmitJournalResult {
  ok: boolean;
  journalId: string | null;
  journalNo: number | null;
  status: "draft" | "posted" | null;
  /** 'created' when a journal was written, 'duplicate' when one already existed. */
  outcome: "created" | "duplicate" | null;
  /** Machine-readable code, e.g. GL_AUTOPOST_OK, GL_POST_CONFLICT. */
  code: string;
  /** Plain English, written for Michael. */
  message: string;
  /**
   * THE VESTIBULE. Set on a draft that is at or above the entity's approval
   * threshold, so a screen can say so at the moment the entry is created rather
   * than letting someone discover it at posting time. Advisory: the database
   * trigger is what actually enforces it.
   */
  needsSecondApprover?: boolean;
  /** Total debit value of the entry in cents, as the database computed it. */
  totalCents?: number | null;
}

/**
 * Translates a PostgreSQL error into something Michael can act on.
 *
 * Deliberately exhaustive rather than a generic "something went wrong": when
 * the books refuse an entry, the reason IS the useful information, and burying
 * it behind a shrug is how people start doing the work outside the system.
 */
export function explainPostingError(raw: string): { code: string; message: string } {
  const text = raw || "";
  const table: Array<[string, string]> = [
    [
      "GL_POST_CONFLICT",
      "This exact reference has already been recorded, but with different amounts or accounts. Nothing has been changed. Compare the two, and if the original was wrong, reverse it rather than overwriting it.",
    ],
    [
      "GL_APPROVAL_REQUIRED",
      "This entry is large enough to need a second pair of eyes before it posts. Have someone else approve it first. You can see and change the threshold in the approval policy for this set of books.",
    ],
    [
      "GL_SELF_APPROVAL_REFUSED",
      "The person who writes an entry this large cannot also be the person who approves it. Ask someone else to review it. If you genuinely are the only person available, self-approval can be switched on deliberately for these books, but it has to be explained in writing and it stays on the record.",
    ],
    [
      "GL_NO_APPROVER_IDENTITY",
      "Nobody is signed in, so this approval could not be attributed to a person. An approval nobody can be held to is not an approval. Sign in and try again.",
    ],
    [
      "GL_NO_APPROVAL_POLICY",
      "These books have no approval policy yet, so nothing can be posted or approved until one is set. This is deliberate: with no policy there is no threshold, and the safe answer is to stop rather than to let everything through.",
    ],
    [
      "GL_ALREADY_REVERSED",
      "This entry has already been reversed. Reversing it a second time would invent money that never existed. If the reversal itself was wrong, reverse the reversal instead.",
    ],
    [
      "GL_NO_IDEMPOTENCY_KEY",
      "An automatic entry needs a stable reference (an invoice number, a sale id). Without one, a retry would post the same money twice.",
    ],
    [
      "GL_AUTOPOST_NOT_ELIGIBLE",
      "This kind of entry is never posted automatically — it is an estimate, an allocation or a judgment, so it has been left as a draft for you.",
    ],
    [
      "GL_AUTOPOST_NO_THREE_WAY_MATCH",
      "A bill posts itself only when the purchase order, the goods receipt and the invoice all agree. They do not, so this is waiting for you.",
    ],
    [
      "GL_AUTOPOST_NO_TEMPLATE",
      "Nothing posts automatically without a template you approved in advance.",
    ],
    [
      "GL_AUTOPOST_TEMPLATE_INACTIVE",
      "That template is switched off, so nothing posts through it.",
    ],
    [
      "GL_AUTOPOST_TEMPLATE_UNAPPROVED",
      "That template has never been approved, so it cannot post anything by itself.",
    ],
    [
      "GL_AUTOPOST_TEMPLATE_NOT_YET_EFFECTIVE",
      "That template does not take effect until a later date.",
    ],
    [
      "GL_AUTOPOST_TEMPLATE_EXPIRED",
      "That template has passed its end date, so it no longer posts anything by itself. This entry is waiting for you.",
    ],
    [
      "GL_AUTOPOST_WRONG_ENTITY",
      "That template belongs to a different set of books and cannot post here.",
    ],
    [
      "GL_AUTOPOST_WRONG_SOURCE_KIND",
      "That template is for a different kind of entry.",
    ],
    [
      "GL_AUTOPOST_OVER_LIMIT",
      "This entry is larger than the ceiling set on its template, so it has been left for you to look at.",
    ],
    [
      "GL_AUTOPOST_OUT_OF_TOLERANCE",
      "The amount does not match what was expected closely enough, so it is waiting for you rather than posting itself.",
    ],
    [
      "GL_OUT_OF_BALANCE",
      "The debits and the credits are not equal. Nothing was written.",
    ],
    [
      "GL_TOO_FEW_LINES",
      "An entry needs at least two lines — double-entry is not optional.",
    ],
    [
      "GL_UNKNOWN_ACCOUNT",
      "One of the lines refers to an account that is not in the chart of accounts.",
    ],
    ["GL_UNKNOWN_ENTITY", "There is no set of books by that name."],
    [
      "GL_PERIOD_CLOSED",
      "That month has been closed. Reopen it deliberately, or date the entry in an open month.",
    ],
    [
      "GL_NO_PERIOD",
      "There is no accounting period covering that date, so nothing can be posted to it.",
    ],
    [
      "GL_CONTROL_ACCOUNT",
      "That account is controlled by a subledger and cannot be moved by a manual entry. Post the underlying transaction instead — this is the rule that makes another lazy inventory plug impossible.",
    ],
    [
      "GL_COST_CLASS_REQUIRED",
      "Every expense line needs a 280E cost class. That tag is the tax return, so it cannot be left blank.",
    ],
    [
      "GL_COST_CLASS_NOT_ALLOWED",
      "A balance-sheet line must not carry a 280E cost class.",
    ],
    [
      "gl_journals_line_in_the_sand",
      "Nothing may be dated before 1 January 2026 except the single opening-balance entry. That line is enforced by the database itself.",
    ],
    [
      "GL_INTERCOMPANY_SAME_ENTITY",
      "An intercompany transfer needs two different sets of books.",
    ],
    [
      "GL_INTERCOMPANY_NO_REF",
      "Both halves of an intercompany transfer must share a reference so they can always be tied back together.",
    ],
    [
      "GL_TEMPLATE_NEEDS_REASON",
      "Changing an automatic posting rule requires a written reason, in your own words. It goes on the record permanently.",
    ],
  ];

  for (const [code, message] of table) {
    if (text.includes(code)) return { code, message };
  }
  return {
    code: "GL_ERROR",
    message: `The books refused this entry: ${text}`,
  };
}

/**
 * Decide LOCALLY what should happen, before any network call.
 *
 * This is a preview, not an authorisation: submitJournal() sends the request
 * regardless and lets the database have the final word. Its value is that the
 * UI can tell Michael "this will post" or "this will wait for you, because…"
 * without a round trip, and the answer it gives has been mutation-tested.
 */
export function previewDecision(
  input: SubmitJournalInput,
  template: PostingTemplate | null,
): PostingDecision {
  const absTotal = input.lines.reduce(
    (sum, l) => sum + Math.abs(Number.isSafeInteger(l.amountCents) ? l.amountCents : 0),
    0,
  );
  const req: PostingRequest = {
    entityCode: input.entityCode,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef ?? "",
    journalDate: input.journalDate,
    // Half the sum of absolute values: a balanced entry's debits and credits are
    // equal in magnitude, so this is the entry's total debit value.
    amountCents: Math.trunc(absTotal / 2),
    expectedCents: input.expectedCents ?? null,
    templateCode: input.templateCode ?? null,
    threeWayMatched: input.threeWayMatched === true,
  };
  return decidePosting(req, template);
}

/**
 * Submit a journal. Creates it as a draft, and posts it only if the database
 * agrees it may be posted automatically.
 *
 * Idempotent by (entity, source kind, source reference): submitting the same
 * event any number of times produces exactly one journal. Submitting the same
 * reference with DIFFERENT content is refused with GL_POST_CONFLICT rather than
 * silently ignored or silently posted — both of those are drift.
 *
 * Never throws for an ordinary refusal. A caller that cannot distinguish
 * "refused" from "crashed" will eventually retry a crash, and retrying a write
 * that may have succeeded is how money gets posted twice.
 */
export async function submitJournal(
  input: SubmitJournalInput,
  client?: Admin,
): Promise<SubmitJournalResult> {
  const supabase = client ?? createSupabaseAdminClient();

  // Fail fast on the things we can see without a round trip, using the same
  // pure functions the database mirrors.
  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    return {
      ok: false,
      journalId: null,
      journalNo: null,
      status: null,
      outcome: null,
      code: "GL_TOO_FEW_LINES",
      message: "An entry needs at least two lines — double-entry is not optional.",
    };
  }

  const sum = input.lines.reduce((s, l) => s + l.amountCents, 0);
  if (sum !== 0) {
    return {
      ok: false,
      journalId: null,
      journalNo: null,
      status: null,
      outcome: null,
      code: "GL_OUT_OF_BALANCE",
      message: `The debits and the credits differ by ${Math.abs(sum)} cents. Nothing was written.`,
    };
  }

  // An automatic entry with no stable reference cannot be made replay-safe.
  // Caught here so the message names the real problem rather than surfacing a
  // database exception.
  if (input.autoPost === true) {
    try {
      buildIdempotencyKey(input.entityCode, input.sourceKind, input.sourceRef ?? "");
    } catch {
      return {
        ok: false,
        journalId: null,
        journalNo: null,
        status: null,
        outcome: null,
        code: "GL_NO_IDEMPOTENCY_KEY",
        message:
          "An automatic entry needs a stable reference (an invoice number, a sale id). Without one, a retry would post the same money twice.",
      };
    }
  }

  const { data, error } = await supabase.rpc("gl_submit_journal", {
    p_entity_code: input.entityCode,
    p_journal_date: input.journalDate,
    p_source_kind: input.sourceKind,
    p_source_ref: input.sourceRef,
    p_memo: input.memo,
    p_lines: input.lines.map((l) => ({
      account_code: l.accountCode,
      amount_cents: l.amountCents,
      cost_class: l.costClass ?? "none",
      description: l.description ?? null,
    })),
    p_template_code: input.templateCode ?? null,
    p_expected_cents: input.expectedCents ?? null,
    p_auto_post: input.autoPost === true,
    p_assumption_note: input.assumptionNote ?? null,
    p_intercompany_ref: input.intercompanyRef ?? null,
    p_three_way_matched: input.threeWayMatched === true,
  });

  if (error) {
    const { code, message } = explainPostingError(error.message ?? String(error));
    return {
      ok: false,
      journalId: null,
      journalNo: null,
      status: null,
      outcome: null,
      code,
      message,
    };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const status = (row.status as "draft" | "posted" | undefined) ?? null;
  const outcome = (row.outcome as "created" | "duplicate" | undefined) ?? null;

  return {
    ok: true,
    journalId: (row.journal_id as string) ?? null,
    journalNo: row.journal_no === null || row.journal_no === undefined
      ? null
      : Number(row.journal_no),
    status,
    outcome,
    code: (row.code as string) ?? "GL_OK",
    needsSecondApprover: row.needs_second_approver === true,
    totalCents:
      row.total_cents === null || row.total_cents === undefined
        ? null
        : Number(row.total_cents),
    message:
      outcome === "duplicate"
        ? "This was already recorded. Nothing was posted twice — the original entry is unchanged."
        : status === "posted"
          ? "Posted automatically against an approved template."
          : row.needs_second_approver === true
            ? "Saved as a draft. This one is large enough to need a second person to approve it before it can post."
            : "Saved as a draft for you to review.",
  };
}

/**
 * Approve a draft so it can be posted.
 *
 * Refused when the approver is also the author and the entry is at or above the
 * entity's threshold — the classic self-review weakness. The refusal lives in
 * the database (a BEFORE UPDATE trigger on gl_journals), not here, so it binds
 * even if some future screen forgets to call this function. This is the polite
 * front door to a rule that is enforced whether or not anyone is polite.
 */
export async function approveJournal(
  journalId: string,
  note?: string,
  client?: Admin,
): Promise<{ ok: boolean; code: string; message: string }> {
  if (!journalId || journalId.trim() === "") {
    return {
      ok: false,
      code: "GL_NOT_FOUND",
      message: "No entry was specified, so there is nothing to approve.",
    };
  }

  const supabase = client ?? createSupabaseAdminClient();
  const { error } = await supabase.rpc("gl_approve_journal", {
    p_journal_id: journalId,
    p_note: note ?? null,
  });

  if (error) {
    const explained = explainPostingError(error.message ?? String(error));
    return { ok: false, code: explained.code, message: explained.message };
  }

  return {
    ok: true,
    code: "GL_APPROVED",
    message: "Approved. It can be posted now.",
  };
}

/**
 * Submit both halves of an intercompany transfer. Both, or neither.
 *
 * A half-posted intercompany entry is drift by construction: the combined
 * statements stop eliminating and the balance sheet quietly stops being true.
 * The database function runs both inserts in one transaction, so a failure on
 * the second half rolls back the first.
 *
 * These are ALWAYS drafts. Intercompany is roughly 24 entries a year; automating
 * it would save minutes and risk the balance sheet.
 */
export async function submitIntercompanyPair(
  input: {
    ref: string;
    journalDate: string;
    memo: string;
    entityA: EntityCode;
    linesA: JournalLineInput[];
    sourceRefA: string;
    entityB: EntityCode;
    linesB: JournalLineInput[];
    sourceRefB: string;
    assumptionNote?: string | null;
  },
  client?: Admin,
): Promise<{ ok: boolean; code: string; message: string; data: unknown }> {
  const supabase = client ?? createSupabaseAdminClient();

  const toRows = (lines: JournalLineInput[]) =>
    lines.map((l) => ({
      account_code: l.accountCode,
      amount_cents: l.amountCents,
      cost_class: l.costClass ?? "none",
      description: l.description ?? null,
    }));

  const { data, error } = await supabase.rpc("gl_submit_intercompany_pair", {
    p_ref: input.ref,
    p_journal_date: input.journalDate,
    p_memo: input.memo,
    p_entity_a: input.entityA,
    p_lines_a: toRows(input.linesA),
    p_source_ref_a: input.sourceRefA,
    p_entity_b: input.entityB,
    p_lines_b: toRows(input.linesB),
    p_source_ref_b: input.sourceRefB,
    p_assumption_note: input.assumptionNote ?? null,
  });

  if (error) {
    const explained = explainPostingError(error.message ?? String(error));
    return { ok: false, ...explained, data: null };
  }

  return {
    ok: true,
    code: "GL_INTERCOMPANY_OK",
    message:
      "Both halves were created as drafts. Review them together and post them together.",
    data,
  };
}
