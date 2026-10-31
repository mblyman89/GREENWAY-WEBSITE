/**
 * src/lib/inventory/audit-hub-store.ts   (slice books-12)
 *
 * SERVER-ONLY. The read and write paths the auditing hub needs and books-11 did
 * not build: create a session, list them, load one, save a count line, and move
 * a session's status.
 *
 * books-11 built PREVIEW and POST — the end of the story. This file builds the
 * beginning and the middle. Everything worth arguing about still lives in the
 * pure cores (`inventory-audit-core`, `inventory-audit-post-core`,
 * `audit-hub-guidance-core`) and in migration 0191; this file carries messages.
 *
 * ---------------------------------------------------------------------------
 * THE BLIND COUNT IS ENFORCED BY THE TYPE, NOT BY THE TEMPLATE
 * ---------------------------------------------------------------------------
 * `CountSheetLine` HAS NO FIELD FOR THE SYSTEM QUANTITY.
 *
 * That is the whole control, and it is deliberate that it lives in a type
 * rather than in a component. A count sheet that receives the expected number
 * and merely declines to render it is one careless `{line.systemQty}` away from
 * destroying the evidence — and that edit would look harmless in review. Here,
 * the expected quantity never enters the object that reaches the screen, so
 * showing it is not a mistake anyone can make by accident: it would require
 * changing this type, this query, and this comment.
 *
 * Why it matters, in one sentence: if you show a counter the number they are
 * supposed to find, they will find it.
 *
 * ---------------------------------------------------------------------------
 * WHICH CLIENT, AND THE BUG THAT SETTLED IT
 * ---------------------------------------------------------------------------
 * `createBooksClient()` — the user's own session. Never
 * `createSupabaseAdminClient()`. The service-role key carries no `sub` claim,
 * so `auth.uid()` is NULL inside the database, `is_owner()` and `is_staff()`
 * are both FALSE, and every RLS policy on these tables refuses. That is the
 * F5-M bug, and it once locked Michael out of his own books.
 *
 * The access rules are therefore NOT re-implemented here. Migration 0191 says
 * staff may write count lines and only the owner may approve; those policies
 * are the guarantee. A check in this file would be a courtesy that produces a
 * nicer message, and courtesies do not stop a budtender writing off inventory.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE THROWS FOR A REFUSAL
 * ---------------------------------------------------------------------------
 * Same discipline as books-11: a refusal is the system WORKING, and a thrown
 * error in a Server Component becomes "Application error" — turning a specific,
 * actionable sentence into noise. Genuine bugs still throw.
 */

import "server-only";

import { createBooksClient } from "@/lib/supabase/books-client";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { mixedSizeKeysFromDiagnostics, scopeFromProductKeys } from "./flagged-count-scope-core";
import {
  AUDIT_LOT_COLUMNS,
  asLotFetcher,
  enrichAuditLots,
  type AuditLotRow,
} from "@/lib/inventory/audit-lot-loader";
import {
  assessLine,
  buildAuditPlan,
  buildCoverageReport,
  readinessOf,
  DEFAULT_MATERIALITY,
  type AuditCountLine,
  type AuditPlan,
  type CoverageReport,
  type LineAssessment,
  type SessionReadiness,
} from "./inventory-audit-core";
import {
  canMoveStatus,
  isAuditSessionStatus,
  type AuditSessionStatus,
} from "./inventory-audit-post-core";
import type { AuditStoreResult } from "./inventory-audit-store";
import { openCountRefusal } from "./count-generators-core";
import { loadOpenCountHolds } from "./count-generators-store";

// ═══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Database error text → a sentence Michael can act on.
 *
 * Mirrors `explainAuditRefusal` in inventory-audit-store.ts. The fall-through
 * deliberately includes the raw text: an unmapped refusal that says "something
 * went wrong" is worse than one that is ugly but true.
 */
function explainHubRefusal(err: unknown): { code: string; message: string } {
  const text =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);

  // Fix Phase 4.1 (migration 0326): the counting RPCs raise "CODE: sentence".
  // The sentence is already written for the person reading it; pass it on.
  const coded = /\b((?:INVENTORY_)?AUDIT_[A-Z_]+): ([^\n]+)/.exec(text);
  if (coded) return { code: coded[1], message: coded[2].trim() };
  if (
    /inventory_audit_(claim|record_count|submit|cancel|reassign|save_reason)/.test(text) ||
    /(claimed_by|claimed_by_name|claimed_at|submitted_at|cancel_reason|books_qty_at_count|books_moved_qty)/.test(text)
  ) {
    return {
      code: "MIGRATION_0326_MISSING",
      message:
        "Counting is waiting for a database update. Apply migration 0326 (audit count integrity) in the " +
        "Supabase SQL editor, then reload. Nothing was changed.",
    };
  }

  const table: Array<[string, string]> = [
    [
      "inventory_audit_sessions_cancel_reason_ck",
      "A cancelled audit needs a reason. Use Cancel this audit and write one sentence about why.",
    ],
    [
      "inventory_audit_lines_reason_code_ck",
      "That reason is not on the list. Pick one of the reasons shown.",
    ],
    [
      "inventory_audit_lines_counted_nonneg_ck",
      "A count cannot be negative. You can have none of something, but you cannot have less than " +
        "none of it. Enter 0 if the shelf is empty.",
    ],
    [
      "inventory_audit_lines_counted_attribution_ck",
      "A count has to record who took it and when. It was not saved, because a count nobody signed " +
        "for is not evidence of anything.",
    ],
    [
      "inventory_audit_lines_recount_order_ck",
      "You cannot record a recount for a lot that was never counted the first time. Enter the first " +
        "count before the second.",
    ],
    [
      "inventory_audit_sessions_approval_ck",
      "An approved audit has to name who approved it. Nothing was changed.",
    ],
    [
      "inventory_audit_lines_session_id_lot_id_key",
      "That lot is already on this audit. A lot appears once per audit, so two people cannot count " +
        "the same batch onto two different lines.",
    ],
    [
      "row-level security",
      "You do not have permission to do that. Counting is staff work; approving an audit and moving " +
        "the books is the owner's. Nothing was changed.",
    ],
    [
      "does not exist",
      "The inventory audit tables are not installed yet. Apply migration 0191 and then 0192, in that " +
        "order, and try again.",
    ],
  ];

  for (const [needle, message] of table) {
    if (text.includes(needle)) return { code: needle, message };
  }
  return { code: "AUDIT_HUB_ERROR", message: `That could not be saved: ${text}` };
}

function refused<T>(err: unknown): AuditStoreResult<T> {
  return { ok: false, refusal: explainHubRefusal(err) };
}

/**
 * A BLOCKED WRITE IS NOT AN ERROR. IT IS A SUCCESS THAT DID NOTHING.
 *
 * Every function in this file writes through `createBooksClient()`, which is
 * Michael's own session with row-level security switched ON. That is the correct
 * client to use here. It also has a property that is easy to forget:
 *
 *   When RLS forbids an UPDATE, PostgreSQL does not raise. The statement matches
 *   zero rows and returns success.
 *
 * So `const { error } = await supabase.from(X).update(...)` followed by
 * `if (error) return refused(error)` reports SUCCESS for a write that was
 * refused. The audit would show a status change that never happened, the screen
 * would move to the next step, and the database would still hold the old row.
 * For a status like "approved" that is the difference between "the owner signed
 * this" and "nobody signed this and the system said they did".
 *
 * `.select("id")` turns the write into a statement that RETURNS the rows it
 * touched, so the count can be checked. This helper is the check, written once:
 * a per-call-site `if (rows.length === 0)` would be four chances to forget, and
 * standing rule 23 says fix the class rather than the instance.
 *
 * The refusal deliberately does NOT say "permission denied". Zero rows can also
 * mean the row was deleted or the id was wrong, and a message that names one
 * cause it cannot prove is a guess. It names the outcome, which is certain:
 * nothing changed.
 */
function requireRowsWritten<T>(
  rows: unknown,
  what: string,
  data: T,
): AuditStoreResult<T> {
  const n = Array.isArray(rows) ? rows.length : 0;
  if (n === 0) {
    return {
      ok: false,
      refusal: {
        code: "WRITE_BLOCKED",
        message:
          `Nothing was saved. The database accepted the request to ${what} but changed no rows, ` +
          `which happens when the record is not yours to change, or is no longer there. ` +
          `Nothing has been altered, so it is safe to reload and try again — and if this keeps ` +
          `happening, the audit itself needs looking at rather than the button.`,
      },
    };
  }
  return { ok: true, data };
}

/** The columns that describe a session on a list or a header. Defined once. */
export const SESSION_COLUMNS = [
  "id",
  "label",
  "status",
  "scope_rationale",
  "planned_lot_count",
  "counted_lot_count",
  "net_variance_cents",
  "gross_variance_cents",
  "scope_approved_at",
  "result_approved_at",
  "posted_at",
  "created_at",
  // Fix Phase 4.1 (0326): who is counting (D56), when they finished (D55),
  // and why an audit was cancelled (D54 / D59).
  "claimed_by",
  "claimed_by_name",
  "claimed_at",
  "submitted_at",
  "cancel_reason",
] as const;

/**
 * The columns a COUNT LINE needs. Note what is present and what is not:
 * `system_qty` IS here, because the owner's review screen must show it — but it
 * is stripped before anything reaches the count sheet. See `getCountSheet`.
 */
export const HUB_LINE_COLUMNS = [
  "lot_id",
  "system_qty",
  "counted_qty",
  "recount_qty",
  "reason_code",
  "reason_note",
  "capture_method",
  "counted_at",
  // Fix Phase 4.2 (G-35, 0326): the books when THIS lot was first counted, and
  // any movement since. Owner review only; stripped from the count sheet.
  "books_qty_at_count",
  "books_moved_qty",
] as const;

/**
 * The lot columns the engine's `AuditLot` needs.
 *
 * DEFECT D3: this list used to include `category_slug` and `vendor_name`.
 * Neither has ever been a column on `inventory_lots` (they belong to
 * `gl_accounts` and `discovery_market_signals`), and PostgREST rejects the
 * WHOLE select when one column is unknown -- so every lot read failed with
 * `column "category_slug" does not exist`. Both values are now DERIVED, in
 * `audit-lot-loader.ts`, which explains where each honestly comes from.
 */
export const HUB_LOT_COLUMNS = AUDIT_LOT_COLUMNS;

type SessionRow = {
  id: string;
  label: string;
  status: string;
  scope_rationale: string | null;
  planned_lot_count: number | null;
  counted_lot_count: number | null;
  net_variance_cents: number | string | null;
  gross_variance_cents: number | string | null;
  scope_approved_at: string | null;
  result_approved_at: string | null;
  posted_at: string | null;
  created_at: string;
  claimed_by?: string | null;
  claimed_by_name?: string | null;
  claimed_at?: string | null;
  submitted_at?: string | null;
  cancel_reason?: string | null;
};

type LineRow = {
  lot_id: string;
  system_qty: number | string | null;
  counted_qty: number | string | null;
  recount_qty: number | string | null;
  reason_code: string | null;
  reason_note: string | null;
  capture_method: string | null;
  counted_at: string | null;
  books_qty_at_count?: number | string | null;
  books_moved_qty?: number | string | null;
};

export type AuditSessionSummary = {
  id: string;
  label: string;
  status: AuditSessionStatus;
  scopeRationale: string | null;
  plannedLotCount: number;
  countedLotCount: number;
  netVarianceCents: number;
  grossVarianceCents: number;
  scopeApprovedAt: string | null;
  resultApprovedAt: string | null;
  postedAt: string | null;
  createdAt: string;
  /** D56: the one person counting this count (null = nobody yet). */
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
  /** D55: when the counter pressed I'm done. */
  submittedAt: string | null;
  cancelReason: string | null;
};

function toSummary(r: SessionRow): AuditSessionSummary {
  return {
    id: r.id,
    label: r.label,
    // An unrecognised status is NOT coerced to a familiar one. Rendering an
    // unknown status as "draft" would invite a click that the database will
    // then refuse, and would hide a real data problem behind a friendly word.
    status: isAuditSessionStatus(r.status) ? r.status : ("draft" as AuditSessionStatus),
    scopeRationale: r.scope_rationale,
    plannedLotCount: Number(r.planned_lot_count ?? 0),
    countedLotCount: Number(r.counted_lot_count ?? 0),
    netVarianceCents: Number(r.net_variance_cents ?? 0),
    grossVarianceCents: Number(r.gross_variance_cents ?? 0),
    scopeApprovedAt: r.scope_approved_at,
    resultApprovedAt: r.result_approved_at,
    postedAt: r.posted_at,
    createdAt: r.created_at,
    claimedBy: r.claimed_by ?? null,
    claimedByName: r.claimed_by_name ?? null,
    claimedAt: r.claimed_at ?? null,
    submittedAt: r.submitted_at ?? null,
    cancelReason: r.cancel_reason ?? null,
  };
}

function toCountLine(r: LineRow): AuditCountLine {
  return {
    lotId: r.lot_id,
    // G-35 (0326): compare with the books AT THE MOMENT THIS LOT WAS COUNTED,
    // the number the posting RPC uses. Pre-0326 lines fall back to the freeze.
    systemQty: Number(r.books_qty_at_count ?? r.system_qty ?? 0),
    // NULL SURVIVES. "Nobody counted this" is not "somebody counted zero", and
    // collapsing the two writes off stock that is sitting on the shelf.
    countedQty: r.counted_qty === null ? null : Number(r.counted_qty),
    recountQty: r.recount_qty === null ? null : Number(r.recount_qty),
    reason: r.reason_code,
    note: r.reason_note,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) LIST — the hub's front page
// ═══════════════════════════════════════════════════════════════════════════

export async function listAuditSessions(
  opts: {
    limit?: number;
    status?: AuditSessionStatus;
    /**
     * Restrict to a SET of statuses (slice books-23).
     *
     * Added rather than writing a second list function, because a second list
     * function is a second column list and a second mapper, and those drift
     * (standing rule 25: extend, do not duplicate). `statuses` and `status`
     * compose: passing both narrows by both, which is why the `.eq` is applied
     * after the `.in` instead of either one replacing the other.
     *
     * This is what makes the employee work queue safe BY QUERY rather than by
     * filtering in the page. A page-level filter shows the browser rows it then
     * hides; this never fetches them. The distinction matters because the count
     * queue must never carry a session the owner has not approved the scope of,
     * nor one that has finished counting and is under review.
     */
    statuses?: readonly AuditSessionStatus[];
  } = {},
): Promise<AuditStoreResult<AuditSessionSummary[]>> {
  // An EMPTY statuses array means "no statuses are acceptable", and the honest
  // answer to that is an empty list. Letting it fall through would build a query
  // with no `.in()` at all and return EVERYTHING -- the exact inversion of what
  // was asked for, and the kind of bug that opens a queue rather than closing
  // it. Answered before the query is built so it cannot be reasoned about wrong.
  if (opts.statuses && opts.statuses.length === 0) {
    return { ok: true, data: [] };
  }

  const supabase = await createBooksClient();
  let q = supabase
    .from("inventory_audit_sessions")
    .select(SESSION_COLUMNS.join(","))
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));

  if (opts.statuses) q = q.in("status", opts.statuses as string[]);
  if (opts.status) q = q.eq("status", opts.status);

  const { data, error } = await q;
  if (error) return refused(error);
  return { ok: true, data: ((data ?? []) as unknown as SessionRow[]).map(toSummary) };
}

/**
 * The statuses an employee is allowed to see in the counting queue.
 *
 * `scope_approved` -- the owner said count this, nobody has started.
 * `counting`       -- somebody has started; anyone may continue.
 *
 * Deliberately NOT `draft` (the owner has not agreed to the scope, so showing
 * it invites counting work that may be thrown away), NOT `review` or `approved`
 * (the count is finished; reopening it would let a counter change a number the
 * owner is currently reading, which is the audit-trail equivalent of editing a
 * signed document), and NOT `cancelled`.
 *
 * Exported as data, not buried in a page, so the test can assert the set rather
 * than re-deriving it -- and so there is exactly one place to change it.
 */
export const COUNT_QUEUE_STATUSES: readonly AuditSessionStatus[] = [
  "scope_approved",
  "counting",
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// 2) THE PLANNING SCREEN — propose a scope from live stock
// ═══════════════════════════════════════════════════════════════════════════

export type ProposedScope = {
  plan: AuditPlan;
  coverage: CoverageReport;
};

/**
 * Read every open lot and let the pure planner propose what to count.
 *
 * Nothing is written. The system PROPOSES; Michael validates before anyone
 * counts. That ordering is his operating model and it is also the control that
 * stops a scope being chosen after the numbers are known.
 */
export async function proposeScope(
  opts: { maxLots?: number; includeOnlyDue?: boolean } = {},
): Promise<AuditStoreResult<ProposedScope>> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase
    .from("inventory_lots")
    .select(HUB_LOT_COLUMNS.join(","))
    .eq("status", "active");
  if (error) return refused(error);

  const allLots = await enrichAuditLots((data ?? []) as unknown as AuditLotRow[], asLotFetcher(supabase));
  // G-40: one open count per lot. Lots already on an open count are left out
  // of the proposal (coverage still reports on every lot).
  const lots = await withoutOpenCountLots(allLots);
  const asOf = new Date();
  return {
    ok: true,
    data: {
      plan: buildAuditPlan(lots, asOf, {
        maxLots: opts.maxLots ?? 40,
        includeOnlyDue: opts.includeOnlyDue,
      }),
      coverage: buildCoverageReport(allLots, asOf),
    },
  };
}

/**
 * G-40: drop lots that are already on an open count. Best-effort for a
 * PROPOSAL only: if the read fails the list is unfiltered, and
 * createAuditSession's own check (which fails closed) still refuses.
 */
async function withoutOpenCountLots<L extends { lotId: string }>(lots: L[]): Promise<L[]> {
  const holds = await loadOpenCountHolds().catch(() => null);
  if (!holds || !holds.ok || holds.data.length === 0) return lots;
  const held = new Set(holds.data.map((h) => h.lotId));
  return lots.filter((l) => !held.has(l.lotId));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2b) R14b — A COUNT PRELOADED WITH THE PRODUCTS AN IMPORT FLAGGED
// ═══════════════════════════════════════════════════════════════════════════

export type FlaggedScope = ProposedScope & {
  /** How many product keys the import flagged (the diagnostic's `keys`). */
  flaggedKeys: number;
  /** Flagged keys with NO active lot right now (sold through / archived). */
  keysWithoutActiveLots: number;
  /** False when the import carries no mixed-size warning with keys. */
  found: boolean;
};

/**
 * Owner, Round 14: "Make sure the cycle counts redirect fix it feature
 * actually loads in the product it says needs fixed."
 *
 * The Cultivera import's `import_lots_mixed_size_cards` warning stores EVERY
 * flagged card's pos_product_key in its context (import-lot-core.ts). This
 * reads that warning for one import, then reads the ACTIVE lots of exactly
 * those cards and hands them to the same planner — every lot of every flagged
 * card, due or not, no budget trim (flagged-count-scope-core.ts). Nothing is
 * written; the owner still names the count and writes the reason.
 *
 * Reads go through the owner's own session (RLS: pos_diag_staff_read and
 * inventory_lots_staff_all), chunked and paged so 211 cards / hundreds of lots
 * are never cut at PostgREST's 1,000-row cap.
 */
export async function proposeFlaggedScope(importId: string): Promise<AuditStoreResult<FlaggedScope>> {
  const supabase = await createBooksClient();
  const { data: diagRows, error: dErr } = await supabase
    .from("pos_import_diagnostics")
    .select("code, context_json")
    .eq("import_id", importId)
    .eq("code", "import_lots_mixed_size_cards")
    .order("id", { ascending: true })
    .range(0, 99);
  if (dErr) return refused(dErr);
  const keys = mixedSizeKeysFromDiagnostics((diagRows ?? []) as Array<{ code: string; context_json: unknown }>);

  let failure: unknown = null;
  const rows = keys.length === 0
    ? []
    : await chunkedIn<string, AuditLotRow>(keys, async (chunk, from, to) => {
        const { data, error } = await supabase
          .from("inventory_lots")
          .select(HUB_LOT_COLUMNS.join(","))
          .eq("status", "active")
          .in("pos_product_key", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          failure = error;
          return [];
        }
        return (data ?? []) as unknown as AuditLotRow[];
      });
  // A failed page must not become a silently smaller count.
  if (failure) return refused(failure);

  const lots = await withoutOpenCountLots(await enrichAuditLots(rows, asLotFetcher(supabase)));
  const asOf = new Date();
  const scope = scopeFromProductKeys(keys, lots);
  return {
    ok: true,
    data: {
      plan: buildAuditPlan(lots, asOf, scope.planOptions),
      coverage: buildCoverageReport(lots, asOf),
      flaggedKeys: keys.length,
      keysWithoutActiveLots: scope.keysWithoutActiveLots,
      found: keys.length > 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) CREATE — a session plus its lines, in one call
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an audit over an explicit list of lots.
 *
 * `system_qty` is FROZEN onto each line at creation, and so is
 * `unit_cost_minor_units`. Both are deliberate. If the screen compared the
 * count against whatever the shelf says at review time, then a sale rung up
 * during the count would silently change the thing being measured — and the
 * variance would drift every time the page was refreshed. Freezing makes the
 * comparison reproducible, which is what turns it into evidence.
 */
export async function createAuditSession(input: {
  label: string;
  lotIds: readonly string[];
  scopeRationale: string;
}): Promise<AuditStoreResult<{ sessionId: string }>> {
  const label = input.label.trim();
  if (label.length === 0) {
    return {
      ok: false,
      refusal: {
        code: "NO_LABEL",
        message:
          "Give this audit a name you will recognise in six months — 'Flower back stock, August' " +
          "beats 'Audit 4'. You will be reading it again when something does not add up.",
      },
    };
  }
  if (input.lotIds.length === 0) {
    return {
      ok: false,
      refusal: {
        code: "EMPTY_SCOPE",
        message:
          "An audit with nothing in it is not an audit. Pick at least one product group to count.",
      },
    };
  }

  const supabase = await createBooksClient();

  // R14b: chunked and paged. A flagged-products count can carry hundreds of
  // lot ids; one unchunked `.in("id", …)` overruns the URL and the 1,000-row
  // cap, and a short read would trip LOT_NOT_FOUND below for lots that exist.
  let lotErr: unknown = null;
  const lotRows = await chunkedIn<string, AuditLotRow>([...input.lotIds], async (chunk, from, to) => {
    const { data, error } = await supabase
      .from("inventory_lots")
      .select(HUB_LOT_COLUMNS.join(","))
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      lotErr = error;
      return [];
    }
    return (data ?? []) as unknown as AuditLotRow[];
  });
  if (lotErr) return refused(lotErr);

  const lots = await enrichAuditLots(lotRows, asLotFetcher(supabase));

  // A lot that was asked for and did not come back is REFUSED, not skipped.
  // Silently counting 9 of the 10 lots someone selected is how a scope shrinks
  // without anyone deciding to shrink it.
  if (lots.length !== input.lotIds.length) {
    const found = new Set(lots.map((l) => l.lotId));
    const missing = input.lotIds.filter((id) => !found.has(id));
    return {
      ok: false,
      refusal: {
        code: "LOT_NOT_FOUND",
        message:
          `${missing.length} of the ${input.lotIds.length} batches you selected could not be found — ` +
          `they may have been archived while you were choosing. Nothing was created. Go back and ` +
          `build the scope again so the audit covers what you actually meant.`,
      },
    };
  }

  // G-40 (Fix Phase 4.4c): ONE OPEN COUNT PER LOT (NetSuite). A lot already on
  // a draft / released / counting / review / approved-not-posted count is
  // refused, naming that count. Two open counts of one lot would freeze two
  // different "books" numbers and post the same shrink twice. A failed read
  // FAILS CLOSED (nothing is created).
  const holds = await loadOpenCountHolds(input.lotIds);
  if (!holds.ok) return holds;
  if (holds.data.length > 0) {
    const codeOf = new Map(lots.map((l) => [l.lotId, l.lotCode]));
    return {
      ok: false,
      refusal: {
        code: "LOT_ON_OPEN_COUNT",
        message: openCountRefusal(holds.data.map((h) => ({ lotCode: codeOf.get(h.lotId) ?? null, label: h.label }))),
      },
    };
  }

  const { data: created, error: sErr } = await supabase
    .from("inventory_audit_sessions")
    .insert({
      label,
      status: "draft",
      scope_rationale: input.scopeRationale,
      planned_lot_count: lots.length,
    })
    .select("id")
    .single();
  if (sErr) return refused(sErr);

  const sessionId = (created as { id: string }).id;

  const { error: lErr } = await supabase.from("inventory_audit_lines").insert(
    lots.map((l) => ({
      session_id: sessionId,
      lot_id: l.lotId,
      system_qty: l.onHandQty,
      unit_cost_minor_units: l.unitCostMinorUnits,
    })),
  );
  if (lErr) {
    // The session exists but has no lines. Rather than leave that wreckage
    // lying around to be picked up later as a mystery, cancel it — and say so.
    //
    // This one write is deliberately NOT routed through requireRowsWritten. It is
    // best-effort cleanup on a path that is already failing, and the caller is
    // about to be told about `lErr`, which is the real problem. Reporting
    // "the cleanup did not change any rows" instead of the error that caused the
    // cleanup would bury the cause. `.select("id")` is still asked for so the
    // outcome is visible to anyone reading a query log.
    await supabase
      .from("inventory_audit_sessions")
      .update({
        status: "cancelled",
        // 0326: a cancelled audit must say why (inventory_audit_sessions_cancel_reason_ck).
        cancel_reason: "Lines could not be saved when the audit was created; cancelled automatically.",
      })
      .eq("id", sessionId)
      .select("id");
    return refused(lErr);
  }

  return { ok: true, data: { sessionId } };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4) THE COUNT SHEET — what STAFF see. No expected quantities anywhere.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A line as it appears to the person doing the counting.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THERE IS NO `systemQty` FIELD ON THIS TYPE, AND THERE MUST NEVER BE ONE. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The count sheet cannot leak the expected quantity because the expected
 * quantity is not in the object. Not hidden by CSS, not omitted by the
 * template — absent from the data. See BLIND_COUNT_DOCTRINE in
 * audit-hub-guidance-core.ts for why this is worth a type of its own.
 */
export type CountSheetLine = {
  lotId: string;
  lotCode: string | null;
  productName: string | null;
  categorySlug: string | null;
  /** R34: expiration date (display badge only; not a quantity hint). */
  expiresOn: string | null;
  /** What THEY entered. Shown back so they can see their own work. */
  countedQty: number | null;
  recountQty: number | null;
  reasonCode: string | null;
  reasonNote: string | null;
  captureMethod: string | null;
  /**
   * True when the first count disagreed enough to need a second one.
   *
   * Note what this does NOT carry: the size of the disagreement, or the
   * expected number. The counter is told to look again, and nothing more — a
   * second count that knows the target is not a second count.
   */
  needsRecount: boolean;
};

export type CountSheet = {
  session: AuditSessionSummary;
  lines: CountSheetLine[];
  /** How many lots still have nothing entered. Drives the progress bar. */
  remaining: number;
};

export async function getCountSheet(
  sessionId: string,
): Promise<AuditStoreResult<CountSheet>> {
  const supabase = await createBooksClient();

  const { data: sRow, error: sErr } = await supabase
    .from("inventory_audit_sessions")
    .select(SESSION_COLUMNS.join(","))
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) return refused(sErr);
  if (!sRow) {
    return {
      ok: false,
      refusal: { code: "NOT_FOUND", message: "That audit could not be found." },
    };
  }

  const { data: lineRows, error: lErr } = await supabase
    .from("inventory_audit_lines")
    .select(HUB_LINE_COLUMNS.join(","))
    .eq("session_id", sessionId);
  if (lErr) return refused(lErr);

  const rawLines = (lineRows ?? []) as unknown as LineRow[];
  const lotIds = rawLines.map((r) => r.lot_id);

  const { data: lotRows, error: loErr } =
    lotIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("inventory_lots").select(HUB_LOT_COLUMNS.join(",")).in("id", lotIds);
  if (loErr) return refused(loErr);

  // Enriched ONCE for the whole sheet: the vendor join and the category
  // resolver each cost a query, and doing them per line would turn a 200-lot
  // count sheet into 400 round trips.
  const enrichedLots = await enrichAuditLots(
    (lotRows ?? []) as unknown as AuditLotRow[],
    asLotFetcher(supabase),
  );
  const lotById = new Map(enrichedLots.map((l) => [l.lotId, l]));

  const lines: CountSheetLine[] = rawLines.map((r) => {
    const lot = lotById.get(r.lot_id);
    const domainLine = toCountLine(r);

    // The recount flag is computed HERE, from the engine, and only the BOOLEAN
    // crosses into the count sheet. The assessment object carries variance
    // amounts and the system quantity; letting it through would defeat the
    // whole point of this type.
    let needsRecount = false;
    if (lot) {
      const assessment: LineAssessment = assessLine(lot, domainLine, DEFAULT_MATERIALITY);
      needsRecount = assessment.requiresRecount;
    }

    return {
      lotId: r.lot_id,
      lotCode: lot?.lotCode ?? null,
      productName: lot?.productName ?? null,
      categorySlug: lot?.categorySlug ?? null,
      expiresOn: lot?.expiresOn ?? null,
      countedQty: domainLine.countedQty,
      recountQty: domainLine.recountQty,
      reasonCode: r.reason_code,
      reasonNote: r.reason_note,
      captureMethod: r.capture_method,
      needsRecount,
    };
  });

  return {
    ok: true,
    data: {
      session: toSummary(sRow as unknown as SessionRow),
      lines,
      remaining: lines.filter((l) => l.countedQty === null).length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5) THE REVIEW SCREEN — what the OWNER sees. Everything.
// ═══════════════════════════════════════════════════════════════════════════

export type ReviewLine = {
  lotId: string;
  lotCode: string | null;
  productName: string | null;
  /** R34: expiration date, so the owner sees expired stock in the review. */
  expiresOn: string | null;
  systemQty: number;
  countedQty: number | null;
  recountQty: number | null;
  reasonCode: string | null;
  reasonNote: string | null;
  captureMethod: string | null;
  /** G-35: the books captured at first count (null = counted before 0326 or not yet). */
  booksAtCount: number | null;
  /** G-35: on-hand movement between the first count and the last entry. */
  movedQty: number;
  assessment: LineAssessment;
};

export type AuditReview = {
  session: AuditSessionSummary;
  lines: ReviewLine[];
  readiness: SessionReadiness;
};

export async function getAuditReview(
  sessionId: string,
): Promise<AuditStoreResult<AuditReview>> {
  const supabase = await createBooksClient();

  const { data: sRow, error: sErr } = await supabase
    .from("inventory_audit_sessions")
    .select(SESSION_COLUMNS.join(","))
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) return refused(sErr);
  if (!sRow) {
    return { ok: false, refusal: { code: "NOT_FOUND", message: "That audit could not be found." } };
  }

  const { data: lineRows, error: lErr } = await supabase
    .from("inventory_audit_lines")
    .select(HUB_LINE_COLUMNS.join(","))
    .eq("session_id", sessionId);
  if (lErr) return refused(lErr);

  const rawLines = (lineRows ?? []) as unknown as LineRow[];
  const lotIds = rawLines.map((r) => r.lot_id);

  const { data: lotRows, error: loErr } =
    lotIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("inventory_lots").select(HUB_LOT_COLUMNS.join(",")).in("id", lotIds);
  if (loErr) return refused(loErr);

  const lots = await enrichAuditLots((lotRows ?? []) as unknown as AuditLotRow[], asLotFetcher(supabase));
  const lotById = new Map(lots.map((l) => [l.lotId, l]));
  const domainLines = rawLines.map(toCountLine);

  const lines: ReviewLine[] = rawLines.map((r, i) => {
    const lot = lotById.get(r.lot_id);
    const domainLine = domainLines[i];
    const assessment = lot
      ? assessLine(lot, domainLine, DEFAULT_MATERIALITY)
      : // A line whose lot has vanished is not silently dropped. It is shown,
        // with an assessment that blocks posting, because a count referring to
        // something that no longer exists is a fact the owner needs to see.
        ({
          lotId: r.lot_id,
          status: "unvalued",
          varianceQty: null,
          varianceCents: null,
          systemValueCents: null,
          isMaterial: false,
          requiresRecount: false,
          requiresDocumentation: true,
          blocksPosting: true,
          effectiveCountedQty: domainLine.countedQty,
          messages: [
            "This batch is no longer in the inventory list, so its count cannot be checked or valued.",
          ],
          authorityIds: [],
        } satisfies LineAssessment);

    return {
      lotId: r.lot_id,
      lotCode: lot?.lotCode ?? null,
      productName: lot?.productName ?? null,
      expiresOn: lot?.expiresOn ?? null,
      systemQty: domainLine.systemQty,
      countedQty: domainLine.countedQty,
      recountQty: domainLine.recountQty,
      reasonCode: r.reason_code,
      reasonNote: r.reason_note,
      captureMethod: r.capture_method,
      booksAtCount:
        r.books_qty_at_count === null || r.books_qty_at_count === undefined ? null : Number(r.books_qty_at_count),
      movedQty: Number(r.books_moved_qty ?? 0),
      assessment,
    };
  });

  // G-35: stock that moved while a lot was being counted is a blocker here as
  // well as in the posting RPC (INVENTORY_AUDIT_CUTOFF_MOVED), so the owner is
  // told before approving rather than refused after.
  const readiness = readinessOf(lots, domainLines, DEFAULT_MATERIALITY);
  const moved = lines.filter((l) => l.movedQty !== 0);
  const withMovement: SessionReadiness =
    moved.length === 0
      ? readiness
      : {
          ...readiness,
          canPost: false,
          blockers: [
            ...readiness.blockers,
            `${moved.length} lot${moved.length === 1 ? "" : "s"} had stock move while being counted ` +
              `(${moved.map((l) => l.lotCode ?? l.lotId).join(", ")}). Send the audit back to counting so ` +
              `${moved.length === 1 ? "it is" : "they are"} counted again from zero.`,
          ],
        };

  return {
    ok: true,
    data: {
      session: toSummary(sRow as unknown as SessionRow),
      lines,
      readiness: withMovement,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6) SAVE A COUNT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record one counted quantity (Fix Phase 4.1, migration 0326).
 *
 * Every count goes through `inventory_audit_record_count`, a SECURITY DEFINER
 * function: 0326 revoked direct UPDATE on `inventory_audit_lines` from browser
 * sessions, so the stage, the claim (D56) and the counter's name are checked
 * by the database rather than trusted from here.
 *
 *   target  "count"   = the first count;  "recount" = the second count
 *   mode    "add"     = add qty (each scan adds one, D60)
 *           "replace" = qty replaces the number there (a typed total)
 *           "restart" = count this lot again from zero (re-captures the books)
 *           "third"   = a third count when the two disagree
 *
 * A re-scan never silently becomes a second count (F-06-5b): the sheet asks.
 */
export async function saveCountLine(input: {
  sessionId: string;
  lotId: string;
  qty: number;
  captureMethod: "scan" | "manual";
  target: "count" | "recount";
  mode: "add" | "replace" | "restart" | "third";
}): Promise<AuditStoreResult<{ recorded: "count" | "recount"; qty: number }>> {
  if (!Number.isFinite(input.qty) || input.qty < 0) {
    return {
      ok: false,
      refusal: {
        code: "NEGATIVE_COUNT",
        message:
          "A count cannot be negative. You can have none of something, but not less than none. " +
          "Enter 0 if the shelf is empty.",
      },
    };
  }
  const supabase = await createBooksClient();
  const { data, error } = await supabase.rpc("inventory_audit_record_count", {
    p_session: input.sessionId,
    p_lot: input.lotId,
    p_target: input.target,
    p_mode: input.mode,
    p_qty: input.qty,
    p_capture: input.captureMethod,
  });
  if (error) return refused(error);
  const row = (data ?? {}) as { recorded?: string; qty?: number | string };
  return {
    ok: true,
    data: { recorded: row.recorded === "recount" ? "recount" : "count", qty: Number(row.qty ?? input.qty) },
  };
}

/**
 * Record or correct WHY a line differs, until approval (G-37). Owner only, in
 * the database. Returns the old and new reason so the action can audit both.
 */
export async function saveLineReason(input: {
  sessionId: string;
  lotId: string;
  reasonCode: string;
  reasonNote: string | null;
}): Promise<AuditStoreResult<{ before: { reasonCode: string | null; reasonNote: string | null } }>> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase.rpc("inventory_audit_save_reason", {
    p_session: input.sessionId,
    p_lot: input.lotId,
    p_code: input.reasonCode,
    p_note: input.reasonNote,
  });
  if (error) return refused(error);
  const before = ((data ?? {}) as { before?: { reason_code?: string | null; reason_note?: string | null } }).before ?? {};
  return { ok: true, data: { before: { reasonCode: before.reason_code ?? null, reasonNote: before.reason_note ?? null } } };
}

/** D56: the first person to press Start counting claims the count. */
export async function claimCount(sessionId: string): Promise<AuditStoreResult<{ claimedByName: string | null }>> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase.rpc("inventory_audit_claim", { p_session: sessionId });
  if (error) return refused(error);
  return { ok: true, data: { claimedByName: ((data ?? {}) as { claimed_by_name?: string | null }).claimed_by_name ?? null } };
}

/** D55: I'm done. Refused by the database while any lot is blank. */
export async function submitCount(sessionId: string): Promise<AuditStoreResult<{ status: "review" }>> {
  const supabase = await createBooksClient();
  const { error } = await supabase.rpc("inventory_audit_submit", { p_session: sessionId });
  if (error) return refused(error);
  return { ok: true, data: { status: "review" } };
}

/** D54 / G-33 req 4: owner cancels with a written reason. */
export async function cancelAudit(sessionId: string, reason: string): Promise<AuditStoreResult<{ from: string }>> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase.rpc("inventory_audit_cancel", { p_session: sessionId, p_reason: reason });
  if (error) return refused(error);
  return { ok: true, data: { from: String(((data ?? {}) as { from?: string }).from ?? "") } };
}

/** D56: owner reassigns the count (staffId null = release the claim). */
export async function reassignCount(
  sessionId: string,
  staffId: string | null,
): Promise<AuditStoreResult<{ claimedByName: string | null }>> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase.rpc("inventory_audit_reassign", { p_session: sessionId, p_staff: staffId });
  if (error) return refused(error);
  return { ok: true, data: { claimedByName: ((data ?? {}) as { claimed_by_name?: string | null }).claimed_by_name ?? null } };
}

/** The people a count can be assigned to: active owner / admin / manager / staff. */
export async function listCounters(): Promise<AuditStoreResult<Array<{ id: string; name: string }>>> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("id,full_name,email,role,active")
    .eq("active", true)
    .in("role", ["owner", "admin", "manager", "staff"])
    .order("full_name", { ascending: true })
    .limit(200);
  if (error) return refused(error);
  return {
    ok: true,
    data: ((data ?? []) as Array<{ id: string; full_name: string | null; email: string }>).map((r) => ({
      id: r.id,
      name: (r.full_name ?? "").trim() || r.email,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 7) MOVE THE STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Advance a session, refusing illegal moves WITH THE REASON.
 *
 * The legality question is answered by `canMoveStatus` in the pure core, which
 * already returns prose explaining why. This function does not re-decide it —
 * two copies of a rule is one copy too many.
 */
export async function moveSessionStatus(input: {
  sessionId: string;
  to: AuditSessionStatus;
  approvedBy?: string;
}): Promise<AuditStoreResult<{ status: AuditSessionStatus }>> {
  const supabase = await createBooksClient();

  const { data: row, error: rErr } = await supabase
    .from("inventory_audit_sessions")
    .select("id,status")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (rErr) return refused(rErr);
  if (!row) {
    return { ok: false, refusal: { code: "NOT_FOUND", message: "That audit could not be found." } };
  }

  const current = (row as { status: string }).status;
  if (!isAuditSessionStatus(current)) {
    return {
      ok: false,
      refusal: {
        code: "UNKNOWN_STATUS",
        message:
          `This audit is in a state the system does not recognise ("${current}"), so it will not ` +
          `guess what should happen next. Nothing was changed.`,
      },
    };
  }

  // 0326: a cancel needs a written reason (D54) and runs through cancelAudit.
  if (input.to === "cancelled") {
    return {
      ok: false,
      refusal: {
        code: "USE_CANCEL",
        message: "Use Cancel this audit and write one sentence about why. Nothing was changed.",
      },
    };
  }

  const verdict = canMoveStatus(current, input.to);
  if (!verdict.allowed) {
    return { ok: false, refusal: { code: "ILLEGAL_MOVE", message: verdict.reason } };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: input.to };

  if (input.to === "scope_approved") {
    patch.scope_approved_at = now;
    if (input.approvedBy) patch.scope_approved_by = input.approvedBy;
  }
  if (input.to === "approved") {
    // Migration 0191 has a CHECK that an approved session names its approver.
    // Refusing here produces a sentence Michael can act on; the database would
    // produce a constraint name.
    if (!input.approvedBy) {
      return {
        ok: false,
        refusal: {
          code: "NO_APPROVER",
          message:
            "An approval has to be signed. 'Approved by nobody' is the shape an audit finding takes, " +
            "so the system will not record one.",
        },
      };
    }
    patch.result_approved_at = now;
    patch.result_approved_by = input.approvedBy;
  }

  const { data: wrote, error } = await supabase
    .from("inventory_audit_sessions")
    .update(patch)
    .eq("id", input.sessionId)
    .select("id");
  if (error) return refused(error);

  // THE MOST IMPORTANT ONE. `inventory_audit_sessions` is owner-only under
  // migration 0191 (`inventory_audit_sessions_owner_all` using is_owner()), so a
  // non-owner reaching this line gets zero rows and no error. Without this check
  // the function would report that an audit had been approved by someone the
  // database refused to let approve it.
  return requireRowsWritten(wrote, `move this audit to ${input.to}`, {
    status: input.to,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 8) THE PIECES THAT CAN BE TESTED WITHOUT A DATABASE
// ═══════════════════════════════════════════════════════════════════════════

export const __hubMappers = { toSummary, toCountLine } as const;
export { explainHubRefusal };
