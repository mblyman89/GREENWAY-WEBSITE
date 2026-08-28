// =============================================================================
// approval-service.ts — THE DOING HALF OF D-67. SERVER-ONLY.
//
// D-67, recorded in books-84: "every entry the system writes is stranded: a
// draft nothing can approve and nothing can post." Measured then: nothing sets
// autoPost, so gl_submit_journal always returns a draft; approveJournal had no
// caller anywhere in src/; gl_post_journal had NO TypeScript caller at all; and
// no screen read gl_journals. Six slices of builders had been feeding a queue
// with no outlet.
//
// This file is the outlet. It reads the queue, and it drains it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE IDENTITY PROBLEM, AND WHY THIS FILE DOES NOT USE THE ADMIN CLIENT
// ═══════════════════════════════════════════════════════════════════════════
// D-67 named this as the blocker: gl_approve_journal refuses when auth.uid() is
// null, and every posting service uses createSupabaseAdminClient(), which has
// no `sub` claim and therefore no auth.uid(). An approval through the admin
// client can never succeed.
//
// It turns out the answer was already in the repository. `createBooksClient()`
// (src/lib/supabase/books-client.ts) wraps the @supabase/ssr server client bound
// to the request's cookies, so auth.uid() IS the signed-in human. Its header
// documents a real shipped bug where the admin client was used instead, every
// books RPC refused, and warns in capitals: "DO NOT replace this with
// createSupabaseAdminClient()."
//
// That warning applies with special force here. Approval is a claim about WHO.
// Posting writes posted_by = auth.uid() into permanent history. If this file
// used the admin client, either the call would be refused outright (approve) or
// it would write a NULL actor into the audit trail (post) — history with nobody
// attached to it, which is the same as no control at all.
//
// So: every database call in this file goes through createBooksClient().
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS IS TWO CALLS AND NOT ONE, AND WHY IT IS NOT ALWAYS BOTH
// ═══════════════════════════════════════════════════════════════════════════
// gl_approve_journal writes approved_by/approved_at and NOTHING ELSE — it does
// not change status (read at 0174:786). gl_post_journal is a separate function
// that assigns the gapless number and sets status='posted' (0172:797). So
// "approve" in the ordinary English sense is two database calls.
//
// But it is not always two, and getting that wrong would reintroduce D-67 in a
// new costume. The trigger that enforces approval exempts pos_sale, excise,
// purchase, bank and reversal entirely, and exempts everything below the
// entity's threshold. Calling approve on those either does nothing useful or —
// for a large machine-written entry that Michael authored — raises
// GL_SELF_APPROVAL_REFUSED and strands an entry the posting rules were happy to
// accept. approval-core.ts::planApproval() makes that call, in pure code, with
// the reasoning written out and mutation-tested.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE DELIBERATELY DOES NOT DO
// ═══════════════════════════════════════════════════════════════════════════
// It does not create journals — that is submitJournal(), the one door.
// It does not edit them — posted history is immutable by trigger.
// It does not delete or "un-post" anything — the only undo is gl_reverse_journal
// (ASC 250), which creates a mirror-image DRAFT that comes back through here.
// It does not swallow a refusal. Every refusal is returned in plain English and
// shown on the screen. A control the owner cannot see refuse is not a control.
// =============================================================================

import "server-only";

import { createBooksClient } from "@/lib/supabase/books-client";
import { requireStaff } from "@/lib/auth/session";
import { canReadBooks } from "./books-view-core";
import { approveJournal, explainPostingError } from "./posting-service";
import {
  planApproval,
  debitTotalCents,
  type ActorFacts,
  type ApprovalPlan,
  type ApprovalPolicyFacts,
  type DraftFacts,
} from "./approval-core";

/**
 * One draft, as the review screen needs to see it. Everything here is read from
 * the database; nothing is inferred.
 */
export type DraftJournal = {
  readonly journalId: string;
  readonly entityCode: string;
  readonly entityName: string;
  readonly journalDate: string;
  readonly sourceKind: string;
  readonly sourceRef: string | null;
  readonly memo: string;
  readonly assumptionNote: string | null;
  readonly totalCents: number;
  readonly lineCount: number;
  readonly createdBy: string | null;
  readonly createdAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly lines: readonly DraftLine[];
  /** What planApproval() says will happen if the owner clicks Post. */
  readonly plan: ApprovalPlan;
};

export type DraftLine = {
  readonly accountCode: string;
  readonly accountName: string;
  readonly amountCents: number;
  readonly costClass: string | null;
  readonly description: string | null;
};

export type ApprovalResult = {
  readonly ok: boolean;
  readonly code: string;
  readonly message: string;
  /** The gapless journal number, once it exists. Null on any refusal. */
  readonly journalNo: number | null;
};

/**
 * Owner-only guard, returning the session or null. Callers turn null into
 * GL_FORBIDDEN rather than redirecting, because these run as server actions
 * where a redirect would replace a readable sentence with a blank screen.
 *
 * Same shape as journal-entry-service.ts::requireOwner(), deliberately: one
 * pattern for one rule.
 */
async function ownerSession() {
  const session = await requireStaff();
  if (!canReadBooks(session.profile.role)) return null;
  return session;
}

function refusalFrom(err: unknown): { code: string; message: string } {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);

  // explainPostingError() has no entry for these three, because until now
  // nothing in TypeScript could provoke them: GL_NOT_FOUND and
  // GL_ALREADY_POSTED come from gl_post_journal's first two checks, and
  // GL_FORBIDDEN from the RLS gate. Handled here rather than by widening that
  // table, so the posting-service snapshot tests stay meaningful.
  if (raw.includes("GL_NOT_FOUND")) {
    return {
      code: "GL_NOT_FOUND",
      message:
        "That entry no longer exists. It may have been posted or reversed in another tab — reload the list and look again.",
    };
  }
  if (raw.includes("GL_ALREADY_POSTED")) {
    return {
      code: "GL_ALREADY_POSTED",
      message:
        "That entry is not a draft any more, so there is nothing left to post. Posted history is never edited — if it is wrong, reverse it.",
    };
  }
  if (raw.includes("GL_FORBIDDEN") || raw.includes("permission denied")) {
    return {
      code: "GL_FORBIDDEN",
      message:
        "The books are owner-only. Sign in as the owner to approve and post entries.",
    };
  }
  return explainPostingError(raw);
}

// ---------------------------------------------------------------------------
// READING THE QUEUE
// ---------------------------------------------------------------------------

/**
 * Every draft waiting to be posted, newest date first.
 *
 * The schema anticipated this screen: 0172 already carries a partial index
 * `idx_gl_journals_status on (status) where status = 'draft'`, so this query is
 * an index scan over exactly the rows the owner cares about, not a table scan
 * over all of history.
 *
 * `entityCode` narrows to one set of books; null means all four. The read goes
 * through the SESSION client, so RLS (is_owner(), migration 0185) is doing the
 * real gating — the ownerSession() check above only makes the refusal readable.
 */
export async function listDraftJournals(
  entityCode?: string | null,
  limit = 200,
): Promise<{ ok: boolean; code: string; message: string; drafts: readonly DraftJournal[] }> {
  const session = await ownerSession();
  if (!session) {
    return {
      ok: false,
      code: "GL_FORBIDDEN",
      message: "The books are owner-only.",
      drafts: [],
    };
  }

  const supabase = await createBooksClient();

  let query = supabase
    .from("gl_journals")
    .select(
      "id, entity_id, journal_date, source_kind, source_ref, memo, assumption_note, created_by, created_at, approved_by, approved_at, gl_entities!inner(code, name)",
    )
    .eq("status", "draft")
    .order("journal_date", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));

  if (entityCode && entityCode.trim() !== "") {
    query = query.eq("gl_entities.code", entityCode);
  }

  const { data: journalRows, error: journalError } = await query;
  if (journalError) {
    const r = refusalFrom(journalError);
    return { ok: false, code: r.code, message: r.message, drafts: [] };
  }

  const rows = (journalRows ?? []) as unknown as Array<{
    id: string;
    entity_id: string;
    journal_date: string;
    source_kind: string;
    source_ref: string | null;
    memo: string;
    assumption_note: string | null;
    created_by: string | null;
    created_at: string | null;
    approved_by: string | null;
    approved_at: string | null;
    gl_entities: { code: string; name: string } | Array<{ code: string; name: string }> | null;
  }>;

  if (rows.length === 0) {
    return { ok: true, code: "GL_OK", message: "Nothing is waiting.", drafts: [] };
  }

  // The lines, in one round trip rather than one per draft. A review screen
  // that fires 200 queries is a review screen nobody waits for.
  const ids = rows.map((r) => r.id);
  const { data: lineRows, error: lineError } = await supabase
    .from("gl_journal_lines")
    .select("journal_id, account_code, amount_cents, cost_class, description")
    .in("journal_id", ids);

  if (lineError) {
    const r = refusalFrom(lineError);
    return { ok: false, code: r.code, message: r.message, drafts: [] };
  }

  const lines = (lineRows ?? []) as Array<{
    journal_id: string;
    account_code: string;
    amount_cents: number;
    cost_class: string | null;
    description: string | null;
  }>;

  // Account names, so the screen reads "10200 Operating cash" rather than a
  // bare number the owner has to look up.
  const codes = Array.from(new Set(lines.map((l) => l.account_code)));
  const names = new Map<string, string>();
  if (codes.length > 0) {
    const { data: acctRows } = await supabase
      .from("gl_accounts")
      .select("code, name")
      .in("code", codes);
    for (const a of (acctRows ?? []) as Array<{ code: string; name: string }>) {
      names.set(a.code, a.name);
    }
  }

  // The approval policy per entity. A MISSING row is not an error here — it is
  // a fact planApproval() needs, and it turns into a refusal on that draft
  // rather than blanking the whole screen.
  const entityIds = Array.from(new Set(rows.map((r) => r.entity_id)));
  const policies = new Map<string, ApprovalPolicyFacts>();
  const { data: polRows } = await supabase
    .from("gl_approval_policy")
    .select("entity_id, threshold_cents, allow_self_approval")
    .in("entity_id", entityIds);
  for (const p of (polRows ?? []) as Array<{
    entity_id: string;
    threshold_cents: number;
    allow_self_approval: boolean | null;
  }>) {
    policies.set(p.entity_id, {
      thresholdCents: Number(p.threshold_cents),
      allowSelfApproval: p.allow_self_approval === true,
    });
  }

  const byJournal = new Map<string, DraftLine[]>();
  const amountsByJournal = new Map<string, number[]>();
  for (const l of lines) {
    const list = byJournal.get(l.journal_id) ?? [];
    list.push({
      accountCode: l.account_code,
      accountName: names.get(l.account_code) ?? l.account_code,
      amountCents: Number(l.amount_cents),
      costClass: l.cost_class,
      description: l.description,
    });
    byJournal.set(l.journal_id, list);
    const amts = amountsByJournal.get(l.journal_id) ?? [];
    amts.push(Number(l.amount_cents));
    amountsByJournal.set(l.journal_id, amts);
  }

  const actor: ActorFacts = { actorId: session.userId, isOwner: true };

  const drafts: DraftJournal[] = rows.map((r) => {
    const ent = Array.isArray(r.gl_entities) ? r.gl_entities[0] : r.gl_entities;
    const draftLines = byJournal.get(r.id) ?? [];
    const totalCents = debitTotalCents(amountsByJournal.get(r.id) ?? []);
    const facts: DraftFacts = {
      journalId: r.id,
      status: "draft",
      sourceKind: r.source_kind,
      totalCents,
      createdBy: r.created_by,
      approvedBy: r.approved_by,
      lineCount: draftLines.length,
    };
    return {
      journalId: r.id,
      entityCode: ent?.code ?? "",
      entityName: ent?.name ?? "",
      journalDate: r.journal_date,
      sourceKind: r.source_kind,
      sourceRef: r.source_ref,
      memo: r.memo,
      assumptionNote: r.assumption_note,
      totalCents,
      lineCount: draftLines.length,
      createdBy: r.created_by,
      createdAt: r.created_at,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      lines: draftLines,
      plan: planApproval(facts, policies.get(r.entity_id) ?? null, actor),
    };
  });

  return {
    ok: true,
    code: "GL_OK",
    message: `${drafts.length} ${drafts.length === 1 ? "entry is" : "entries are"} waiting.`,
    drafts,
  };
}

// ---------------------------------------------------------------------------
// DRAINING THE QUEUE
// ---------------------------------------------------------------------------

/**
 * Post one draft, approving it first if and only if it needs approving.
 *
 * THE FIRST TYPESCRIPT CALLER OF gl_post_journal, ever. Until this line, the
 * only way to turn a draft into history was to type SQL into the Supabase
 * console — which is exactly the unaudited path that produced the Sage drift
 * this whole system exists to end.
 *
 * Never throws for an ordinary refusal. A caller that cannot tell "refused"
 * from "crashed" will eventually retry a crash, and retrying a write that may
 * have succeeded is how money gets posted twice.
 */
export async function approveAndPostJournal(
  journalId: string,
  note?: string,
): Promise<ApprovalResult> {
  if (!journalId || journalId.trim() === "") {
    return {
      ok: false,
      code: "GL_NOT_FOUND",
      message: "No entry was specified, so there is nothing to post.",
      journalNo: null,
    };
  }

  const session = await ownerSession();
  if (!session) {
    return {
      ok: false,
      code: "GL_FORBIDDEN",
      message:
        "The books are owner-only. Approving and posting entries is something only you can do.",
      journalNo: null,
    };
  }

  const supabase = await createBooksClient();

  // Re-read the draft NOW rather than trusting whatever the screen was showing.
  // The list may be minutes old; the entry may already have been posted in
  // another tab. Deciding from stale facts is how a double post happens.
  const { data: jRow, error: jErr } = await supabase
    .from("gl_journals")
    .select("id, entity_id, status, source_kind, created_by, approved_by")
    .eq("id", journalId)
    .maybeSingle();

  if (jErr) {
    const r = refusalFrom(jErr);
    return { ok: false, code: r.code, message: r.message, journalNo: null };
  }
  if (!jRow) {
    return {
      ok: false,
      code: "GL_NOT_FOUND",
      message:
        "That entry no longer exists, or it belongs to a set of books you cannot see. Reload the list and look again.",
      journalNo: null,
    };
  }

  const j = jRow as {
    id: string;
    entity_id: string;
    status: string;
    source_kind: string;
    created_by: string | null;
    approved_by: string | null;
  };

  const { data: lRows, error: lErr } = await supabase
    .from("gl_journal_lines")
    .select("amount_cents")
    .eq("journal_id", journalId);

  if (lErr) {
    const r = refusalFrom(lErr);
    return { ok: false, code: r.code, message: r.message, journalNo: null };
  }

  const amounts = ((lRows ?? []) as Array<{ amount_cents: number }>).map((l) =>
    Number(l.amount_cents),
  );

  const { data: polRow } = await supabase
    .from("gl_approval_policy")
    .select("threshold_cents, allow_self_approval")
    .eq("entity_id", j.entity_id)
    .maybeSingle();

  const policy: ApprovalPolicyFacts | null = polRow
    ? {
        thresholdCents: Number((polRow as { threshold_cents: number }).threshold_cents),
        allowSelfApproval:
          (polRow as { allow_self_approval: boolean | null }).allow_self_approval === true,
      }
    : null;

  const plan = planApproval(
    {
      journalId: j.id,
      status: j.status,
      sourceKind: j.source_kind,
      totalCents: debitTotalCents(amounts),
      createdBy: j.created_by,
      approvedBy: j.approved_by,
      lineCount: amounts.length,
    },
    policy,
    { actorId: session.userId, isOwner: true },
  );

  if (!plan.ok) {
    return { ok: false, code: plan.code, message: plan.message, journalNo: null };
  }

  // The blessing, when the plan says one is needed. Note the session client is
  // passed in explicitly — approveJournal() defaults to the ADMIN client, which
  // has no auth.uid() and would be refused with GL_NO_APPROVER_IDENTITY.
  if (plan.action === "approve_then_post") {
    const approved = await approveJournal(journalId, note, supabase as never);
    if (!approved.ok) {
      return {
        ok: false,
        code: approved.code,
        message: approved.message,
        journalNo: null,
      };
    }
  }

  // The post. Every rule is re-checked here by the database — balance, entity,
  // allowed accounts, control-account discipline, 280E cost classes and period
  // status — so a bug in the planning above cannot put a bad entry into
  // history. The plan is the courtesy; this call is the guarantee.
  const { data: postData, error: postError } = await supabase.rpc("gl_post_journal", {
    p_journal_id: journalId,
  });

  if (postError) {
    const r = refusalFrom(postError);
    // A refusal HERE, after a successful approve, leaves the entry approved but
    // unposted. That is the correct resting state, not a mess: the blessing is
    // real and recorded, and the entry stays a draft until whatever the database
    // objected to (a closed period, usually) is dealt with. Say so plainly.
    const tail =
      plan.action === "approve_then_post"
        ? " Your approval was recorded, so once this is sorted out the entry only needs posting."
        : "";
    return { ok: false, code: r.code, message: r.message + tail, journalNo: null };
  }

  const journalNo = postData === null || postData === undefined ? null : Number(postData);

  return {
    ok: true,
    code: "GL_POSTED",
    message:
      journalNo === null
        ? "Posted to the ledger."
        : `Posted to the ledger as entry #${journalNo}. It is history now — if it turns out to be wrong, reverse it rather than editing it.`,
    journalNo,
  };
}
