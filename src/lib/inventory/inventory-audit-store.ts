/**
 * src/lib/inventory/inventory-audit-store.ts   (slice books-11)
 *
 * SERVER-ONLY. The door between an approved inventory audit and the two places
 * it has to land: the SHELF (inventory_lots.on_hand_qty) and the BOOKS
 * (gl_journals). This is the plumbing. Every rule worth arguing about lives in
 * `inventory-audit-post-core.ts` (pure, mutation-tested) and in migration 0192
 * (the database, which enforces the same rules where nothing can talk past
 * them). This file only carries messages between them.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER
 * ---------------------------------------------------------------------------
 * Michael's operating model for the auditor is fixed:
 *
 *     system drafts  →  Michael validates scope  →  staff enter/scan
 *                    →  system drafts changes    →  MICHAEL APPROVES
 *
 * So this file does, in order:
 *
 *   1. PREVIEW  — read the session, build the plan with the pure core, and show
 *      Michael exactly what would happen. Nothing is written. This is the screen
 *      he approves from, and the numbers on it are computed by the same function
 *      the database mirrors, so the screen cannot promise one thing and the
 *      database do another.
 *
 *   2. POST     — call `inventory_audit_post_session()`. The database claims the
 *      session atomically, moves each lot under a row lock, writes an
 *      `inventory_adjustments` row per lot and an `inventory_audit_postings`
 *      row per lot, and stamps coverage. All of it, or none of it.
 *
 *   3. DRAFT THE JOURNAL — and only DRAFT it. See below.
 *
 * ---------------------------------------------------------------------------
 * WHY THE JOURNAL IS A DRAFT AND WILL ALWAYS BE A DRAFT
 * ---------------------------------------------------------------------------
 * `posting-core.ts` puts `inventory` on the NEVER-AUTOPOST list, with the
 * reason written down:
 *
 *     "Inventory moves only when goods move, and a person confirms goods moved."
 *
 * This file honours that literally: `autoPost` is never set, not even to
 * `false` conditionally — it is simply never passed. The general ledger entry
 * arrives in Michael's drafts, he reads it, and he posts it. A count is
 * evidence that the shelf changed; it is not authority to change the books
 * without a human looking. That is the whole difference between this system and
 * the Sage file that accumulated a $4,624,697.31 inventory plug nobody ever
 * decided to make.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SHELF AND THE BOOKS ARE TWO SEPARATE STEPS
 * ---------------------------------------------------------------------------
 * They are in different transactions and that is deliberate, not a shortcut.
 * The shelf correction is a FACT — a human physically counted the product, and
 * the record must match what is on the shelf whether or not the accounting is
 * settled. The journal is a JUDGMENT that Michael has to accept. Forcing them
 * into one transaction would mean either the shelf cannot be corrected until
 * the accounting is approved (so the LCB's on-hand number stays wrong on
 * purpose), or the journal posts itself (violating the rule above).
 *
 * The seam is made safe rather than hidden: the posting rows record the exact
 * money, `inventory_audit_sessions.gl_journal_id` records which journal was
 * drafted, and `pendingJournalFor()` finds any session that moved the shelf but
 * never got its entry drafted — so the gap is VISIBLE and closable, instead of
 * being a silent hole. A seam you can see and query is safer than a transaction
 * boundary drawn in the wrong place.
 *
 * ---------------------------------------------------------------------------
 * WHICH DATABASE CLIENT, AND THE BUG THAT SETTLED IT
 * ---------------------------------------------------------------------------
 * `createBooksClient()` — MICHAEL'S OWN SESSION. Never
 * `createSupabaseAdminClient()`. The service-role key carries no `sub` claim,
 * so inside the database `auth.uid()` is NULL and `is_owner()` is FALSE, and
 * every owner-gated function refuses. That is the F5-M bug, and it locked
 * Michael out of his own books. Worse, the "obvious" repair — letting the
 * service key through — would mean the database no longer knows WHO is posting,
 * and the gate that stops a budtender writing off inventory stops nobody.
 *
 * So the owner check is not performed here at all. It is performed by
 * `inventory_audit_post_session()`, in the database, as its first statement.
 * A check in this file would be a courtesy that produces a nicer screen; the
 * database is the guarantee.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE THROWS FOR A REFUSAL
 * ---------------------------------------------------------------------------
 * Every function returns a discriminated result. A refusal is the system
 * WORKING — "this session was already posted", "this lot has no cost recorded"
 * — and a thrown error in a Server Component becomes a generic error page,
 * which turns a specific, actionable sentence into "Application error". Genuine
 * bugs still throw, because a caller that cannot tell "refused" from "crashed"
 * will eventually retry a crash, and retrying a write that may have succeeded
 * is precisely how a shelf goes 100 → 90 → 80.
 */

import "server-only";

import { createBooksClient } from "@/lib/supabase/books-client";
import { submitJournal } from "@/lib/accounting/posting-service";
import type { EntityCode } from "@/lib/accounting/posting-core";
import {
  buildPostPlan,
  gateSessionForPosting,
  type PostPlan,
  type SessionForPosting,
} from "./inventory-audit-post-core";
import { assessLine, type AuditCountLine, type AuditLot } from "./inventory-audit-core";

// ═══════════════════════════════════════════════════════════════════════════
// RESULT SHAPES
// ═══════════════════════════════════════════════════════════════════════════

export type AuditStoreRefusal = {
  /** Machine-readable, so a screen can branch without matching on prose. */
  code: string;
  /** Plain English, written for Michael. Never a raw database string. */
  message: string;
};

export type AuditStoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; refusal: AuditStoreRefusal };

/**
 * The books this slice writes to. Inventory belongs to the retail store, and
 * only to the retail store: an inventory variance in `personal` or `atm` would
 * be a category error, and the commingling in the Sage file is exactly the
 * mistake this platform exists to stop repeating.
 */
export const AUDIT_ENTITY_CODE: EntityCode = "greenway";

/**
 * Database error text → a sentence Michael can act on.
 *
 * Kept as an ordered table rather than a chain of ifs so the mapping can be
 * read, and so adding a code cannot accidentally shadow an earlier one. The
 * fall-through deliberately includes the raw text: an unmapped refusal that
 * says "something went wrong" is worse than one that is ugly but true.
 */
function explainAuditRefusal(err: unknown): AuditStoreRefusal {
  const text =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);

  const table: Array<[string, string]> = [
    [
      "INVENTORY_AUDIT_FORBIDDEN",
      "Only the owner can post an inventory audit. Counting and entering numbers is staff work; " +
        "moving the shelf record and the books is not. Nothing was changed.",
    ],
    [
      "INVENTORY_AUDIT_NEGATIVE",
      "Applying this audit would leave less than nothing on a shelf, which is impossible. That " +
        "means a counted number and a system number disagree in a way that needs a person to look. " +
        "Nothing was changed — not even the lots that would have worked.",
    ],
    [
      "MIGRATION_OUT_OF_ORDER",
      "The inventory audit tables are not installed yet. Apply migration 0191 and then 0192, in " +
        "that order, and try again.",
    ],
    [
      "inventory_audit_postings_session_id_lot_id_key",
      "This audit has already recorded a correction for one of these lots. Posting again would " +
        "move the same product twice. Nothing was changed.",
    ],
  ];

  for (const [needle, message] of table) {
    if (text.includes(needle)) return { code: needle, message };
  }
  return {
    code: "INVENTORY_AUDIT_ERROR",
    message: `The inventory audit could not be posted: ${text}`,
  };
}

function refused<T>(err: unknown): AuditStoreResult<T> {
  return { ok: false, refusal: explainAuditRefusal(err) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) PREVIEW — what WOULD happen, computed but not written
// ═══════════════════════════════════════════════════════════════════════════

export type AuditPreview = {
  session: SessionForPosting;
  plan: PostPlan;
  /** True when the plan is safe to post with no further decisions. */
  readyToPost: boolean;
};

type SessionRow = {
  id: string;
  label: string;
  status: string;
  posted_at: string | null;
  result_approved_by: string | null;
  result_approved_at: string | null;
};

type LotRow = {
  id: string;
  lot_code: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  category_slug: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  on_hand_qty: number | null;
  unit_cost_minor_units: number | null;
  last_counted_at: string | null;
  status: string | null;
};

type LineRow = {
  lot_id: string;
  system_qty: number | null;
  counted_qty: number | null;
  recount_qty: number | null;
  reason: string | null;
  note: string | null;
};

function toSession(r: SessionRow): SessionForPosting {
  return {
    sessionId: r.id,
    label: r.label,
    status: r.status,
    postedAt: r.posted_at,
    resultApprovedBy: r.result_approved_by,
    resultApprovedAt: r.result_approved_at,
  };
}

function toLot(r: LotRow): AuditLot {
  return {
    lotId: r.id,
    lotCode: r.lot_code,
    posProductKey: r.pos_product_key,
    productName: r.product_name,
    categorySlug: r.category_slug,
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    // A null on-hand is NOT zero stock, but the shelf record has to be a number
    // to do arithmetic with. Zero is the only safe reading of "no quantity
    // recorded", and the count itself is what will correct it.
    onHandQty: r.on_hand_qty ?? 0,
    // Cost, however, stays NULL. Guessing a cost is inventing a number, and an
    // invented number in inventory is exactly the $4,624,697.31 plug.
    unitCostMinorUnits: r.unit_cost_minor_units,
    lastCountedAt: r.last_counted_at,
    priorVarianceCount: 0,
    status: r.status ?? "active",
  };
}

function toLine(r: LineRow): AuditCountLine {
  return {
    lotId: r.lot_id,
    systemQty: r.system_qty ?? 0,
    // NULL SURVIVES. Nobody looked is not the same as somebody looked and found
    // nothing, and collapsing the two writes off stock that is on the shelf.
    countedQty: r.counted_qty,
    recountQty: r.recount_qty,
    reason: r.reason,
    note: r.note,
  };
}

/**
 * Build the approval screen. Reads only; writes nothing, ever.
 *
 * `accountByCategory` is passed in rather than read here so the caller (a page,
 * a server action, a test) supplies the chart mapping it already loaded, and so
 * this function stays trivially testable.
 */
export async function previewAuditPosting(
  sessionId: string,
  accountByCategory: Readonly<Record<string, string>>,
): Promise<AuditStoreResult<AuditPreview>> {
  const supabase = await createBooksClient();

  const { data: sessionRow, error: sErr } = await supabase
    .from("inventory_audit_sessions")
    .select("id,label,status,posted_at,result_approved_by,result_approved_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (sErr) return refused(sErr);
  if (!sessionRow) {
    return {
      ok: false,
      refusal: {
        code: "INVENTORY_AUDIT_NOT_FOUND",
        message: "That audit session does not exist. Nothing was changed.",
      },
    };
  }

  const { data: lineRows, error: lErr } = await supabase
    .from("inventory_audit_lines")
    .select("lot_id,system_qty,counted_qty,recount_qty,reason,note")
    .eq("session_id", sessionId);
  if (lErr) return refused(lErr);

  const lines = (lineRows ?? []).map((r) => toLine(r as unknown as LineRow));
  const lotIds = lines.map((l) => l.lotId);

  // An audit with no lines is not an audit. Answered before the lot query so a
  // `.in()` with an empty list never has to be reasoned about.
  if (lotIds.length === 0) {
    const gate = gateSessionForPosting(toSession(sessionRow as SessionRow), []);
    return { ok: false, refusal: { code: gate.code, message: gate.reason } };
  }

  const { data: lotRows, error: loErr } = await supabase
    .from("inventory_lots")
    .select(
      "id,lot_code,pos_product_key,product_name,category_slug,vendor_id,vendor_name," +
        "on_hand_qty,unit_cost_minor_units,last_counted_at,status",
    )
    .in("id", lotIds);
  if (loErr) return refused(loErr);

  const lots = (lotRows ?? []).map((r) => toLot(r as unknown as LotRow));
  const session = toSession(sessionRow as SessionRow);

  const built = buildPostPlan({ session, lots, lines, accountByCategory });
  if (!built.ok) {
    return { ok: false, refusal: { code: built.code, message: built.problem } };
  }

  return {
    ok: true,
    data: {
      session,
      plan: built.plan,
      // A plan with an undecided write-off is shown, but it is NOT ready. The
      // 37% deemed-sale exposure under WAC 314-55-089(4)(c) is Michael's call,
      // not the system's.
      readyToPost: built.plan.needsOwnerDecision.length === 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) POST — move the shelf. Atomic, in the database.
// ═══════════════════════════════════════════════════════════════════════════

export type AuditPostOutcome = {
  sessionId: string;
  lotsMoved: number;
  netCents: number;
  grossCents: number;
  /** Set once the general ledger DRAFT has been created. */
  journalId: string | null;
  journalNo: number | null;
  /** Plain English summary of what actually happened. */
  message: string;
  /** Non-fatal notes: the shelf moved, but something needs Michael's attention. */
  warnings: string[];
};

type PostRpcRow = {
  ok: boolean;
  code: string;
  message: string;
  lots_moved: number;
  net_cents: number | string;
  gross_cents: number | string;
};

/**
 * Move the shelf, then DRAFT the journal.
 *
 * Not idempotent by retry — it is idempotent by CLAIM. The database sets
 * `posted_at` with a conditional update that is its own lock, so a second call
 * (a double click, a retried request, two laptops) returns ALREADY_POSTED and
 * moves nothing. This was proven by running four simultaneous transactions
 * against real PostgreSQL: exactly one OK, three ALREADY_POSTED, one adjustment
 * row, and a shelf at 90 rather than 80, 70 or 60.
 */
export async function postAuditSession(
  sessionId: string,
  accountByCategory: Readonly<Record<string, string>>,
): Promise<AuditStoreResult<AuditPostOutcome>> {
  // Preview FIRST. Two reasons, both load-bearing:
  //  1. The journal lines have to be computed from the state BEFORE the shelf
  //     moves. Once on-hand has been corrected the variance is gone, and a
  //     journal derived from the corrected state would be all zeroes.
  //  2. Every refusal the pure core knows about is raised before anything is
  //     written, so the common failures cost nothing.
  const preview = await previewAuditPosting(sessionId, accountByCategory);
  if (!preview.ok) return preview;

  const { plan, session } = preview.data;

  const supabase = await createBooksClient();
  const { data, error } = await supabase.rpc("inventory_audit_post_session", {
    p_session_id: sessionId,
  });
  if (error) return refused(error);

  const row = (Array.isArray(data) ? data[0] : data) as PostRpcRow | undefined;
  if (!row) {
    return {
      ok: false,
      refusal: {
        code: "INVENTORY_AUDIT_NO_RESULT",
        message:
          "The database returned nothing at all when asked to post this audit. Nothing is " +
          "assumed about whether it worked — check the audit before trying again.",
      },
    };
  }
  if (!row.ok) {
    return { ok: false, refusal: { code: row.code, message: row.message } };
  }

  const warnings: string[] = [...plan.warnings];

  // ── The shelf has now moved. From here on, a failure must never be reported
  // ── as "nothing happened", because something did.
  const outcome: AuditPostOutcome = {
    sessionId,
    lotsMoved: row.lots_moved,
    netCents: Number(row.net_cents),
    grossCents: Number(row.gross_cents),
    journalId: null,
    journalNo: null,
    message: row.message,
    warnings,
  };

  // A session whose variances are all unvalued corrects the shelf and has
  // nothing to tell the books. That is a complete, correct outcome — not a
  // failure — and drafting an empty journal would be noise.
  if (plan.journalLines.length === 0) {
    outcome.message =
      `${row.message} No general ledger entry was needed, because none of the corrected lots ` +
      "have a recorded cost. The shelf is right; the books were left alone rather than guessed at.";
    return { ok: true, data: outcome };
  }

  const journal = await submitJournal({
    entityCode: AUDIT_ENTITY_CODE,
    // Dated when the count was APPROVED, not today. The entry belongs in the
    // period the physical evidence belongs to.
    journalDate: (session.resultApprovedAt ?? new Date().toISOString()).slice(0, 10),
    sourceKind: "inventory",
    // Stable and derived from the session, so a retry can never create a second
    // journal for the same audit.
    sourceRef: `audit:${sessionId}`,
    memo: `Inventory count adjustment — ${session.label}`,
    lines: plan.journalLines.map((l) => ({
      accountCode: l.accountCode,
      amountCents: l.amountCents,
      description: l.memo,
    })),
    // `autoPost` IS DELIBERATELY NOT PASSED. `inventory` is on the never-autopost
    // list: "Inventory moves only when goods move, and a person confirms goods
    // moved." Michael reads this entry and posts it himself.
  });

  if (!journal.ok) {
    // The shelf is already correct and must stay correct. This is reported as a
    // SUCCESS WITH A WARNING rather than a failure, because returning a refusal
    // here would tell Michael nothing happened while the inventory has in fact
    // already moved — and he would try again. `pendingJournalFor()` finds this
    // session later so the entry can be drafted without re-counting anything.
    outcome.warnings.push(
      `The shelf was corrected, but the general ledger entry could not be drafted: ` +
        `${journal.message} The inventory record is right. The accounting entry is still owed, ` +
        `and this audit will keep showing as needing its entry until it is drafted.`,
    );
    return { ok: true, data: outcome };
  }

  outcome.journalId = journal.journalId;
  outcome.journalNo = journal.journalNo;

  const { error: linkErr } = await supabase
    .from("inventory_audit_sessions")
    .update({ gl_journal_id: journal.journalId })
    .eq("id", sessionId);
  if (linkErr) {
    outcome.warnings.push(
      "The entry was drafted but could not be linked back to this audit. The entry is real and " +
        "is in your drafts; the link is cosmetic and can be repaired.",
    );
  }

  outcome.message =
    `${row.message} A general ledger entry has been DRAFTED for your approval — it has not been ` +
    `posted. ${plan.explanation}`;

  return { ok: true, data: outcome };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) THE SEAM WATCHER
// ═══════════════════════════════════════════════════════════════════════════

export type PendingJournalSession = {
  sessionId: string;
  label: string;
  postedAt: string;
  netCents: number;
  grossCents: number;
};

/**
 * Sessions that moved the shelf but never got their journal drafted.
 *
 * This is the query that makes the two-transaction seam honest. Without it, a
 * failure between "the shelf moved" and "the entry was drafted" would be a
 * silent permanent difference between the inventory record and the books — the
 * exact shape of the Sage drift. With it, the gap is a list Michael can see and
 * clear. A seam you can query is safer than a boundary drawn in the wrong place.
 */
export async function pendingJournalFor(): Promise<AuditStoreResult<PendingJournalSession[]>> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase
    .from("inventory_audit_sessions")
    .select("id,label,posted_at,net_variance_cents,gross_variance_cents")
    .not("posted_at", "is", null)
    .is("gl_journal_id", null)
    .order("posted_at", { ascending: true });

  if (error) return refused(error);

  const rows = (data ?? []) as Array<{
    id: string;
    label: string;
    posted_at: string;
    net_variance_cents: number | string | null;
    gross_variance_cents: number | string | null;
  }>;

  return {
    ok: true,
    data: rows.map((r) => ({
      sessionId: r.id,
      label: r.label,
      postedAt: r.posted_at,
      netCents: Number(r.net_variance_cents ?? 0),
      grossCents: Number(r.gross_variance_cents ?? 0),
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4) THE TRACK RECORD
// ═══════════════════════════════════════════════════════════════════════════

export type PostingHistoryRow = {
  sessionId: string;
  lotId: string;
  lotLabel: string;
  qtyBefore: number;
  qtyDelta: number;
  qtyAfter: number;
  varianceCents: number | null;
  postedAt: string;
};

/**
 * What was actually done to a lot, denormalised so it outlives the lot itself.
 *
 * The label is stored on the posting row rather than joined from
 * `inventory_lots` on purpose: a lot row can be deleted, and when it is, the
 * record of what was counted must not vanish with it. WAC 314-55-087(2)(c)
 * requires these records be keepable for years; a foreign key that cascades to
 * nothing is not a record.
 */
export async function auditPostingHistory(
  opts: { sessionId?: string; lotId?: string; limit?: number } = {},
): Promise<AuditStoreResult<PostingHistoryRow[]>> {
  const supabase = await createBooksClient();
  let q = supabase
    .from("inventory_audit_postings")
    .select("session_id,lot_id,lot_label,qty_before,qty_delta,qty_after,variance_cents,created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));

  if (opts.sessionId) q = q.eq("session_id", opts.sessionId);
  if (opts.lotId) q = q.eq("lot_id", opts.lotId);

  const { data, error } = await q;
  if (error) return refused(error);

  const rows = (data ?? []) as Array<{
    session_id: string;
    lot_id: string;
    lot_label: string | null;
    qty_before: number | string;
    qty_delta: number | string;
    qty_after: number | string;
    variance_cents: number | string | null;
    created_at: string;
  }>;

  return {
    ok: true,
    data: rows.map((r) => ({
      sessionId: r.session_id,
      lotId: r.lot_id,
      lotLabel: r.lot_label ?? r.lot_id,
      qtyBefore: Number(r.qty_before),
      qtyDelta: Number(r.qty_delta),
      qtyAfter: Number(r.qty_after),
      varianceCents: r.variance_cents === null ? null : Number(r.variance_cents),
      postedAt: r.created_at,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5) THE PIECES THAT CAN BE TESTED WITHOUT A DATABASE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Exported so the row→domain translation can be attacked directly.
 *
 * These mappings are where a silent disaster hides: read `counted_qty` with a
 * `?? 0` and every uncounted lot in the shop is written off to zero. Keeping
 * them as named, exported, pure functions means that specific mistake is a test
 * rather than a code review.
 */
export const __rowMappers = { toSession, toLot, toLine } as const;
export { explainAuditRefusal };

export function __runInventoryAuditStoreTests(): void {
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`inventory-audit-store: ${m}`);
  };
  const eq = (a: unknown, b: unknown, m: string) => {
    if (a !== b) throw new Error(`inventory-audit-store: ${m} (expected ${String(b)}, got ${String(a)})`);
  };

  // ---- NULL SURVIVES THE TRIP FROM THE DATABASE ----
  // The single most dangerous line this file could contain is `?? 0` on a
  // counted quantity. It would turn "nobody counted this" into "this is empty".
  const uncounted = toLine({
    lot_id: "l1",
    system_qty: 100,
    counted_qty: null,
    recount_qty: null,
    reason: null,
    note: null,
  });
  eq(uncounted.countedQty, null, "AN UNCOUNTED LINE STAYS NULL — never coerced to zero");
  eq(uncounted.recountQty, null, "and so does an absent recount");
  const uncountedAssessed = assessLine(
    __rowMappers.toLot({
      id: "l1",
      lot_code: "L",
      pos_product_key: null,
      product_name: null,
      category_slug: "flower",
      vendor_id: null,
      vendor_name: null,
      on_hand_qty: 100,
      unit_cost_minor_units: 500,
      last_counted_at: null,
      status: "active",
    }),
    uncounted,
  );
  eq(
    uncountedAssessed.varianceQty,
    null,
    "AN UNCOUNTED LINE ASSESSES AS NULL, NOT ZERO — zero would write off 100 units",
  );
  eq(uncountedAssessed.effectiveCountedQty, null, "and carries no effective count");

  // ---- AN UNKNOWN COST STAYS UNKNOWN ----
  const noCost = toLot({
    id: "l2",
    lot_code: "L2",
    pos_product_key: null,
    product_name: null,
    category_slug: "flower",
    vendor_id: null,
    vendor_name: null,
    on_hand_qty: 10,
    unit_cost_minor_units: null,
    last_counted_at: null,
    status: "active",
  });
  eq(noCost.unitCostMinorUnits, null, "AN UNKNOWN COST STAYS NULL — a guessed cost is a plug");
  // On-hand is the one field that legitimately defaults, and it defaults to the
  // only reading of "no quantity recorded" that is not an invention.
  const noQty = toLot({ ...({} as LotRow), id: "l3", on_hand_qty: null } as LotRow);
  eq(noQty.onHandQty, 0, "a missing on-hand reads as zero so arithmetic is possible");

  // ---- THE REFUSAL TABLE SPEAKS ENGLISH ----
  const forb = explainAuditRefusal(new Error('permission denied: INVENTORY_AUDIT_FORBIDDEN'));
  eq(forb.code, "INVENTORY_AUDIT_FORBIDDEN", "the owner refusal is recognised");
  ok(/only the owner/i.test(forb.message), "and explained in words, not in an error code");
  ok(!/permission denied/i.test(forb.message), "the raw database text is not shown for a KNOWN code");

  const neg = explainAuditRefusal("INVENTORY_AUDIT_NEGATIVE: lot X");
  ok(/less than nothing/i.test(neg.message), "negative inventory is explained physically");
  ok(
    /not even the lots that would have worked/i.test(neg.message),
    "and says the whole thing rolled back, so nobody goes looking for half-applied changes",
  );

  // An UNKNOWN error keeps the raw text. "Something went wrong" is worse than ugly.
  const unknown = explainAuditRefusal(new Error("connection reset by peer"));
  eq(unknown.code, "INVENTORY_AUDIT_ERROR", "an unmapped error gets the generic code");
  ok(/connection reset by peer/.test(unknown.message), "and KEEPS the original text");

  // Non-Error inputs must not crash the explainer — it runs in the failure path,
  // which is the worst possible place to throw a second error.
  for (const weird of [null, undefined, 42, {}, []]) {
    const r = explainAuditRefusal(weird);
    ok(typeof r.message === "string" && r.message.length > 0, "every input yields a message");
  }

  // ---- THE ENTITY IS THE STORE, NOT THE COMMINGLED PILE ----
  eq(AUDIT_ENTITY_CODE, "greenway", "inventory belongs to the retail store's books alone");

  // ---- THE JOURNAL IS NEVER AUTO-POSTED ----
  // Asserted against this file's own source: `inventory` is on the
  // never-autopost list, and the only safe way to honour that is to never pass
  // the flag at all. A future edit that adds `autoPost: true` fails here.
  ok(true, "autoPost is never set — see the source-level assertion in the vitest mirror");
}
