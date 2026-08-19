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

  const table: Array<[string, string]> = [
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
  };
}

function toCountLine(r: LineRow): AuditCountLine {
  return {
    lotId: r.lot_id,
    systemQty: Number(r.system_qty ?? 0),
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
  opts: { limit?: number; status?: AuditSessionStatus } = {},
): Promise<AuditStoreResult<AuditSessionSummary[]>> {
  const supabase = await createBooksClient();
  let q = supabase
    .from("inventory_audit_sessions")
    .select(SESSION_COLUMNS.join(","))
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));

  if (opts.status) q = q.eq("status", opts.status);

  const { data, error } = await q;
  if (error) return refused(error);
  return { ok: true, data: ((data ?? []) as unknown as SessionRow[]).map(toSummary) };
}

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

  const lots = await enrichAuditLots((data ?? []) as unknown as AuditLotRow[], asLotFetcher(supabase));
  const asOf = new Date();
  return {
    ok: true,
    data: {
      plan: buildAuditPlan(lots, asOf, {
        maxLots: opts.maxLots ?? 40,
        includeOnlyDue: opts.includeOnlyDue,
      }),
      coverage: buildCoverageReport(lots, asOf),
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

  const { data: lotRows, error: lotErr } = await supabase
    .from("inventory_lots")
    .select(HUB_LOT_COLUMNS.join(","))
    .in("id", [...input.lotIds]);
  if (lotErr) return refused(lotErr);

  const lots = await enrichAuditLots((lotRows ?? []) as unknown as AuditLotRow[], asLotFetcher(supabase));

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
    await supabase
      .from("inventory_audit_sessions")
      .update({ status: "cancelled" })
      .eq("id", sessionId);
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
  systemQty: number;
  countedQty: number | null;
  recountQty: number | null;
  reasonCode: string | null;
  reasonNote: string | null;
  captureMethod: string | null;
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
      systemQty: domainLine.systemQty,
      countedQty: domainLine.countedQty,
      recountQty: domainLine.recountQty,
      reasonCode: r.reason_code,
      reasonNote: r.reason_note,
      captureMethod: r.capture_method,
      assessment,
    };
  });

  return {
    ok: true,
    data: {
      session: toSummary(sRow as unknown as SessionRow),
      lines,
      readiness: readinessOf(lots, domainLines, DEFAULT_MATERIALITY),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6) SAVE A COUNT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record one counted quantity.
 *
 * `countedBy` and `countedAt` are written together with the number, because
 * migration 0191 has a CHECK that refuses an anonymous count — an unsigned
 * count is not evidence, and WAC 314-55-087(2)(c) expects a trail that says who
 * did what.
 *
 * When the line already has a count, this writes the RECOUNT instead of
 * overwriting. That is the difference between a second, independent count and a
 * retroactive edit of the first one — and only the former is worth anything.
 */
export async function saveCountLine(input: {
  sessionId: string;
  lotId: string;
  qty: number;
  countedBy: string;
  captureMethod: "scan" | "manual";
  reasonCode?: string | null;
  reasonNote?: string | null;
}): Promise<AuditStoreResult<{ recorded: "count" | "recount" }>> {
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

  const { data: existing, error: exErr } = await supabase
    .from("inventory_audit_lines")
    .select("counted_qty")
    .eq("session_id", input.sessionId)
    .eq("lot_id", input.lotId)
    .maybeSingle();
  if (exErr) return refused(exErr);
  if (!existing) {
    return {
      ok: false,
      refusal: {
        code: "LOT_NOT_IN_SCOPE",
        message:
          "That batch is not part of this audit. Scanning something outside the agreed scope is not " +
          "refused to be awkward — an audit whose scope changes while it runs cannot be relied on " +
          "afterwards. Finish this one, then start another that includes it.",
      },
    };
  }

  const isRecount = (existing as { counted_qty: number | null }).counted_qty !== null;
  const now = new Date().toISOString();

  const patch = isRecount
    ? { recount_qty: input.qty, recount_by: input.countedBy, recount_at: now }
    : {
        counted_qty: input.qty,
        counted_by: input.countedBy,
        counted_at: now,
        capture_method: input.captureMethod,
      };

  const withReason =
    input.reasonCode === undefined && input.reasonNote === undefined
      ? patch
      : { ...patch, reason_code: input.reasonCode ?? null, reason_note: input.reasonNote ?? null };

  const { error } = await supabase
    .from("inventory_audit_lines")
    .update(withReason)
    .eq("session_id", input.sessionId)
    .eq("lot_id", input.lotId);
  if (error) return refused(error);

  return { ok: true, data: { recorded: isRecount ? "recount" : "count" } };
}

/** Record WHY a line differs, without touching the quantity. */
export async function saveLineReason(input: {
  sessionId: string;
  lotId: string;
  reasonCode: string;
  reasonNote: string | null;
}): Promise<AuditStoreResult<null>> {
  const supabase = await createBooksClient();
  const { error } = await supabase
    .from("inventory_audit_lines")
    .update({ reason_code: input.reasonCode, reason_note: input.reasonNote })
    .eq("session_id", input.sessionId)
    .eq("lot_id", input.lotId);
  if (error) return refused(error);
  return { ok: true, data: null };
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

  const { error } = await supabase
    .from("inventory_audit_sessions")
    .update(patch)
    .eq("id", input.sessionId);
  if (error) return refused(error);

  return { ok: true, data: { status: input.to } };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8) THE PIECES THAT CAN BE TESTED WITHOUT A DATABASE
// ═══════════════════════════════════════════════════════════════════════════

export const __hubMappers = { toSummary, toCountLine } as const;
export { explainHubRefusal };
