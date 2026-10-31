/**
 * src/lib/inventory/full-count-store.ts   (Fix Phase 4.4d · G-41 · owner D58, D56, D54)
 *
 * SERVER-ONLY. Reads and writes for the year-end full count. A full count is
 * a group of ordinary audit sessions (migration 0328), so every write here is
 * an existing, tested path applied to each section in turn:
 *
 *   create    sessions + blank lines, exactly the shape createAuditSession
 *             writes (system_qty = on hand, unit cost), plus the 0328 columns.
 *   release   moveSessionStatus(draft -> scope_approved) per section (D54).
 *   approve   moveSessionStatus(review -> approved) for each READY section
 *             (getAuditReview's readiness, the same check as the Approve
 *             button); a section with a blocker is left for the owner.
 *   post      postAuditSession per approved section (shelf + draft journal).
 *   cancel    cancelAudit (0326 RPC, with the reason) per open section.
 *
 * Owner's session client throughout (createBooksClient): sessions are
 * owner-only to write under RLS (0191), so the database is the guarantee.
 * Refusals are returned, never thrown.
 */
import "server-only";

import { createBooksClient } from "@/lib/supabase/books-client";
import { pagedAll } from "@/lib/supabase/chunked-in";
import type { AuditLot } from "./inventory-audit-core";
import type { AuditStoreResult } from "./inventory-audit-store";
import { postAuditSession } from "./inventory-audit-store";
import { inventoryAccountByCategory } from "./audit-posting-accounts";
import {
  cancelAudit,
  getAuditReview,
  moveSessionStatus,
  type ReviewLine,
} from "./audit-hub-store";
import { loadActiveAuditLots, loadOpenCountHolds } from "./count-generators-store";
import { openCountRefusal } from "./count-generators-core";
import {
  cancellableSections,
  combineMoney,
  fullCountLabel,
  fullCountRationale,
  planFullCount,
  rollupFullCount,
  type FullCountPlan,
  type FullCountRollup,
  type SectionSummary,
} from "./full-count-core";

const FULL_COUNT_SESSION_COLUMNS =
  "id,label,status,planned_lot_count,counted_lot_count,net_variance_cents,gross_variance_cents,posted_at," +
  "claimed_by_name,submitted_at,created_at,full_count_id,full_count_year,section_no,section_count";

type Row = {
  id: string;
  label: string;
  status: string;
  planned_lot_count: number | null;
  counted_lot_count: number | null;
  net_variance_cents: number | string | null;
  gross_variance_cents: number | string | null;
  posted_at: string | null;
  claimed_by_name: string | null;
  submitted_at: string | null;
  created_at: string;
  full_count_id: string;
  full_count_year: number;
  section_no: number;
  section_count: number;
};

export type FullCountSectionRow = SectionSummary & { label: string };

export type FullCount = {
  id: string;
  year: number;
  createdAt: string;
  sections: FullCountSectionRow[];
  rollup: FullCountRollup;
};

/** "CODE: sentence" from a database error, or the 0328-missing explanation. */
export function explainFullCountError(err: unknown): { code: string; message: string } {
  const text =
    err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
  const coded = /\b(FULL_COUNT_[A-Z_]+): ([^\n]+)/.exec(text);
  if (coded) return { code: coded[1], message: coded[2].trim() };
  if (/(full_count_id|full_count_year|section_no|section_count)/.test(text)) {
    return {
      code: "MIGRATION_0328_MISSING",
      message:
        "The year-end full count is waiting for a database update. Apply migration 0328 (full count) in the " +
        "Supabase SQL editor, then reload. Until then use several audits the same day (SOP-06 \u00a74.24). Nothing was changed.",
    };
  }
  if (text.includes("inventory_audit_sessions_full_count_section_uq")) {
    return { code: "FULL_COUNT_SECTION_TAKEN", message: "That section number is already used on this full count. Nothing was created." };
  }
  return { code: "FULL_COUNT_ERROR", message: `That could not be done: ${text}` };
}

function fail<T>(err: unknown): AuditStoreResult<T> {
  return { ok: false, refusal: explainFullCountError(err) };
}

function toSection(r: Row): FullCountSectionRow {
  return {
    id: r.id,
    label: r.label,
    sectionNo: Number(r.section_no),
    sectionCount: Number(r.section_count),
    status: r.status,
    postedAt: r.posted_at,
    plannedLotCount: Number(r.planned_lot_count ?? 0),
    countedLotCount: Number(r.counted_lot_count ?? 0),
    claimedByName: r.claimed_by_name ?? null,
    submittedAt: r.submitted_at ?? null,
    netVarianceCents: Number(r.net_variance_cents ?? 0),
    grossVarianceCents: Number(r.gross_variance_cents ?? 0),
  };
}

function group(rows: Row[]): FullCount[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = by.get(r.full_count_id);
    if (arr) arr.push(r);
    else by.set(r.full_count_id, [r]);
  }
  const out: FullCount[] = [];
  for (const [id, arr] of by) {
    const sections = arr.map(toSection).sort((a, b) => a.sectionNo - b.sectionNo);
    out.push({
      id,
      year: Number(arr[0].full_count_year),
      createdAt: arr.map((r) => r.created_at).sort()[0],
      sections,
      rollup: rollupFullCount(sections),
    });
  }
  return out.sort((a, b) => b.year - a.year || b.createdAt.localeCompare(a.createdAt));
}

/** Every full count, newest year first (paged; never cut at 1,000 rows). */
export async function listFullCounts(): Promise<AuditStoreResult<FullCount[]>> {
  const supabase = await createBooksClient();
  let err: unknown = null;
  const rows = await pagedAll<Row>(async (from, to) => {
    const { data, error } = await supabase
      .from("inventory_audit_sessions")
      .select(FULL_COUNT_SESSION_COLUMNS)
      .not("full_count_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      err = error;
      return [];
    }
    return (data ?? []) as unknown as Row[];
  });
  if (err) return fail(err);
  return { ok: true, data: group(rows) };
}

export async function getFullCount(fullCountId: string): Promise<AuditStoreResult<FullCount>> {
  const supabase = await createBooksClient();
  let err: unknown = null;
  const rows = await pagedAll<Row>(async (from, to) => {
    const { data, error } = await supabase
      .from("inventory_audit_sessions")
      .select(FULL_COUNT_SESSION_COLUMNS)
      .eq("full_count_id", fullCountId)
      .order("section_no", { ascending: true })
      .range(from, to);
    if (error) {
      err = error;
      return [];
    }
    return (data ?? []) as unknown as Row[];
  });
  if (err) return fail(err);
  const [fc] = group(rows);
  if (!fc) return { ok: false, refusal: { code: "NOT_FOUND", message: "That full count could not be found." } };
  return { ok: true, data: fc };
}

/** For a section's own audit page: which full count it belongs to (null = an ordinary count, or 0328 not applied). */
export async function fullCountOfSession(
  sessionId: string,
): Promise<{ fullCountId: string; year: number; sectionNo: number; sectionCount: number } | null> {
  try {
    const supabase = await createBooksClient();
    const { data, error } = await supabase
      .from("inventory_audit_sessions")
      .select("full_count_id,full_count_year,section_no,section_count")
      .eq("id", sessionId)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as { full_count_id: string | null; full_count_year: number; section_no: number; section_count: number };
    if (!r.full_count_id) return null;
    return { fullCountId: r.full_count_id, year: Number(r.full_count_year), sectionNo: Number(r.section_no), sectionCount: Number(r.section_count) };
  } catch {
    return null;
  }
}

/** True when a full count for `year` has a section that is not cancelled (cockpit reminder). */
export async function hasFullCountForYear(year: number): Promise<boolean> {
  const supabase = await createBooksClient();
  const { data, error } = await supabase
    .from("inventory_audit_sessions")
    .select("id")
    .eq("full_count_year", year)
    .neq("status", "cancelled")
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export type FullCountPreview = {
  plan: FullCountPlan;
  lotById: Map<string, AuditLot>;
  /** Lots already on another open count: the full count cannot be created until they are cleared. */
  onOpenCount: Array<{ lotCode: string | null; label: string }>;
};

/** Plan only; nothing is written. Every active lot, no cap. */
export async function previewFullCount(sectionLots: number): Promise<AuditStoreResult<FullCountPreview>> {
  const lots = await loadActiveAuditLots();
  if (!lots.ok) return lots;
  const holds = await loadOpenCountHolds();
  if (!holds.ok) return holds;
  const lotById = new Map(lots.data.map((l) => [l.lotId, l]));
  return {
    ok: true,
    data: {
      plan: planFullCount(lots.data, sectionLots),
      lotById,
      onOpenCount: holds.data.map((h) => ({ lotCode: lotById.get(h.lotId)?.lotCode ?? null, label: h.label })),
    },
  };
}

const LINE_INSERT_CHUNK = 500;

/**
 * Create the full count: one draft session per section, every active lot on
 * exactly one section. Refused (nothing created) when a lot is already on an
 * open count (one open count per lot, G-40) or when the year already has a
 * full count (0328 FULL_COUNT_ONE_PER_YEAR). A failure after the sessions
 * exist cancels every one of them with a reason, so no half-made count is
 * left behind.
 */
export async function createFullCount(input: {
  year: number;
  sectionLots: number;
  actorId: string;
}): Promise<AuditStoreResult<{ fullCountId: string; sections: number; lots: number }>> {
  const preview = await previewFullCount(input.sectionLots);
  if (!preview.ok) return preview;
  const { plan, lotById, onOpenCount } = preview.data;
  if (plan.lotCount === 0) {
    return { ok: false, refusal: { code: "EMPTY_SCOPE", message: "There are no active lots to count. Nothing was created." } };
  }
  if (onOpenCount.length > 0) {
    return { ok: false, refusal: { code: "LOT_ON_OPEN_COUNT", message: openCountRefusal(onOpenCount) } };
  }

  const supabase = await createBooksClient();
  const fullCountId = crypto.randomUUID();
  const count = plan.sections.length;

  const { data: created, error: sErr } = await supabase
    .from("inventory_audit_sessions")
    .insert(
      plan.sections.map((s) => ({
        label: fullCountLabel(input.year, s.no, count),
        status: "draft",
        scope_rationale: fullCountRationale(input.year, s, plan),
        planned_lot_count: s.lotIds.length,
        created_by: input.actorId,
        full_count_id: fullCountId,
        full_count_year: input.year,
        section_no: s.no,
        section_count: count,
      })),
    )
    .select("id,section_no");
  if (sErr) return fail(sErr);
  const idByNo = new Map(((created ?? []) as Array<{ id: string; section_no: number }>).map((r) => [Number(r.section_no), r.id]));
  if (idByNo.size !== count) {
    return {
      ok: false,
      refusal: {
        code: "WRITE_BLOCKED",
        message: "The database accepted the request but did not create every section (only the owner can create audits). Nothing usable was created.",
      },
    };
  }

  const lines = plan.sections.flatMap((s) =>
    s.lotIds.map((lotId) => {
      const l = lotById.get(lotId)!;
      return {
        session_id: idByNo.get(s.no)!,
        lot_id: lotId,
        system_qty: l.onHandQty,
        unit_cost_minor_units: l.unitCostMinorUnits,
      };
    }),
  );
  for (let i = 0; i < lines.length; i += LINE_INSERT_CHUNK) {
    const { error } = await supabase.from("inventory_audit_lines").insert(lines.slice(i, i + LINE_INSERT_CHUNK));
    if (error) {
      // Best-effort cleanup on a path that is already failing (as createAuditSession).
      for (const id of idByNo.values()) {
        await supabase
          .from("inventory_audit_sessions")
          .update({ status: "cancelled", cancel_reason: "Lines could not be saved when the full count was created; cancelled automatically." })
          .eq("id", id)
          .select("id");
      }
      return fail(error);
    }
  }

  return { ok: true, data: { fullCountId, sections: count, lots: plan.lotCount } };
}

type BatchOutcome = { done: number; skipped: string[] };

/** D54: release every draft section to Cycle Counts in one press. */
export async function releaseAllSections(fullCountId: string, approvedBy: string): Promise<AuditStoreResult<BatchOutcome>> {
  const fc = await getFullCount(fullCountId);
  if (!fc.ok) return fc;
  const drafts = fc.data.sections.filter((s) => s.status === "draft");
  if (drafts.length === 0) {
    return { ok: false, refusal: { code: "NOTHING_TO_RELEASE", message: "Every section is already released (or cancelled). Nothing was changed." } };
  }
  const skipped: string[] = [];
  let done = 0;
  for (const s of drafts) {
    const r = await moveSessionStatus({ sessionId: s.id, to: "scope_approved", approvedBy });
    if (r.ok) done++;
    else skipped.push(`Section ${s.sectionNo}: ${r.refusal.message}`);
  }
  return { ok: true, data: { done, skipped } };
}

/** Approve every section in review whose readiness says it can post; the rest are listed. */
export async function approveReadySections(fullCountId: string, approvedBy: string): Promise<AuditStoreResult<BatchOutcome>> {
  const fc = await getFullCount(fullCountId);
  if (!fc.ok) return fc;
  const inReview = fc.data.sections.filter((s) => s.status === "review");
  if (inReview.length === 0) {
    return { ok: false, refusal: { code: "NOTHING_TO_APPROVE", message: "No section is waiting for review. Nothing was changed." } };
  }
  const skipped: string[] = [];
  let done = 0;
  for (const s of inReview) {
    const review = await getAuditReview(s.id);
    if (!review.ok) {
      skipped.push(`Section ${s.sectionNo}: ${review.refusal.message}`);
      continue;
    }
    if (!review.data.readiness.canPost) {
      skipped.push(`Section ${s.sectionNo}: ${review.data.readiness.blockers[0] ?? "not ready"}`);
      continue;
    }
    const r = await moveSessionStatus({ sessionId: s.id, to: "approved", approvedBy });
    if (r.ok) done++;
    else skipped.push(`Section ${s.sectionNo}: ${r.refusal.message}`);
  }
  return { ok: true, data: { done, skipped } };
}

/** Post every approved, unposted section: shelf corrected, journal DRAFTED for the owner (books-23). */
export async function postApprovedSections(
  fullCountId: string,
): Promise<AuditStoreResult<BatchOutcome & { netCents: number; grossCents: number; journalNos: number[] }>> {
  const fc = await getFullCount(fullCountId);
  if (!fc.ok) return fc;
  const ready = fc.data.sections.filter((s) => s.status === "approved" && !s.postedAt);
  if (ready.length === 0) {
    return { ok: false, refusal: { code: "NOTHING_TO_POST", message: "No approved section is waiting to post. Nothing was changed." } };
  }
  const accounts = inventoryAccountByCategory();
  const skipped: string[] = [];
  const journalNos: number[] = [];
  let done = 0;
  let netCents = 0;
  let grossCents = 0;
  for (const s of ready) {
    const r = await postAuditSession(s.id, accounts);
    if (!r.ok) {
      skipped.push(`Section ${s.sectionNo}: ${r.refusal.message}`);
      continue;
    }
    done++;
    netCents += r.data.netCents;
    grossCents += r.data.grossCents;
    if (r.data.journalNo !== null) journalNos.push(r.data.journalNo);
    for (const w of r.data.warnings) skipped.push(`Section ${s.sectionNo} (posted): ${w}`);
  }
  return { ok: true, data: { done, skipped, netCents, grossCents, journalNos } };
}

/** D54: cancel every open section with the same written reason. Approved sections stay (an approval is final). */
export async function cancelFullCount(fullCountId: string, reason: string): Promise<AuditStoreResult<BatchOutcome>> {
  const fc = await getFullCount(fullCountId);
  if (!fc.ok) return fc;
  const open = cancellableSections(fc.data.sections);
  if (open.length === 0) {
    return { ok: false, refusal: { code: "NOTHING_TO_CANCEL", message: "No section can be cancelled (each is approved, posted or already cancelled)." } };
  }
  const skipped: string[] = [];
  let done = 0;
  for (const s of open) {
    const r = await cancelAudit(s.id, reason);
    if (r.ok) done++;
    else skipped.push(`Section ${s.sectionNo}: ${r.refusal.message}`);
  }
  return { ok: true, data: { done, skipped } };
}

export type CombinedLine = ReviewLine & { sectionNo: number };

export type FullCountReview = {
  fullCount: FullCount;
  lines: CombinedLine[];
  totals: {
    totalLines: number;
    counted: number;
    uncounted: number;
    clean: number;
    scanned: number;
    netVarianceCents: number | null;
    grossVarianceCents: number | null;
  };
  /** Every section's blockers, each prefixed "Section n:". */
  blockers: string[];
};

/** The one combined review / work paper: every live section's lines and totals together. */
export async function getFullCountReview(fullCountId: string): Promise<AuditStoreResult<FullCountReview>> {
  const fc = await getFullCount(fullCountId);
  if (!fc.ok) return fc;
  const live = fc.data.sections.filter((s) => s.status !== "cancelled");
  const lines: CombinedLine[] = [];
  const blockers: string[] = [];
  const nets: Array<number | null> = [];
  const grosses: Array<number | null> = [];
  let totalLines = 0, counted = 0, uncounted = 0, clean = 0;
  for (const s of live) {
    const r = await getAuditReview(s.id);
    if (!r.ok) {
      blockers.push(`Section ${s.sectionNo}: ${r.refusal.message}`);
      nets.push(null);
      grosses.push(null);
      continue;
    }
    for (const l of r.data.lines) lines.push({ ...l, sectionNo: s.sectionNo });
    const rd = r.data.readiness;
    totalLines += rd.totalLines;
    counted += rd.counted;
    uncounted += rd.uncounted;
    clean += rd.clean;
    nets.push(rd.netVarianceCents);
    grosses.push(rd.grossVarianceCents);
    if (!s.postedAt) for (const b of rd.blockers) blockers.push(`Section ${s.sectionNo}: ${b}`);
  }
  return {
    ok: true,
    data: {
      fullCount: fc.data,
      lines,
      totals: {
        totalLines,
        counted,
        uncounted,
        clean,
        scanned: lines.filter((l) => l.captureMethod === "scan").length,
        netVarianceCents: combineMoney(nets),
        grossVarianceCents: combineMoney(grosses),
      },
      blockers,
    },
  };
}
