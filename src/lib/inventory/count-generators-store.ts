/**
 * src/lib/inventory/count-generators-store.ts   (Fix Phase 4.4c · G-40 · owner D58)
 *
 * SERVER-ONLY glue for the intelligent count generators. Every rule lives in the
 * PURE count-generators-core.ts; this file only reads:
 *
 *   - the active lots (paged, enriched exactly as the planner does),
 *   - the lots already on an OPEN count (one open count per lot),
 *   - the exception inputs (oversold flags, recent adjustments, 86'd with stock),
 *   - and the vendor rotation pointer, kept in site_settings key
 *     `count_vendor_rotation` (no migration: site_settings stores any key, 0001).
 *
 * Nothing here creates a count. Every generator only PROPOSES; the owner names
 * it, writes why, creates it and releases it (D50, D54).
 */
import "server-only";

import { createBooksClient } from "@/lib/supabase/books-client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAll, ADMIN_PAGED_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { pacificToday } from "@/lib/reports/timezone";
import { AUDIT_LOT_COLUMNS, asLotFetcher, enrichAuditLots, type AuditLotRow } from "./audit-lot-loader";
import type { AuditLot } from "./inventory-audit-core";
import type { AuditStoreResult } from "./inventory-audit-store";
import { loadOversoldReport } from "./oversold-report-store";
import { getRegisterSellabilityReport } from "./register-sellability-store";
import {
  EMPTY_ROTATION,
  OPEN_AUDIT_STATUSES,
  RECENT_ADJUSTMENT_DAYS,
  isOpenAudit,
  rotationFromSetting,
  type ExceptionInputs,
  type RotationState,
} from "./count-generators-core";

export const ROTATION_SETTING_KEY = "count_vendor_rotation";
const ROTATION_SETTING_LABEL = "Cycle counts: vendor of the day rotation (G-40)";

/** Adjustment reasons that are NOT a doubt about the books (they are the books working). */
const ROUTINE_ADJUSTMENTS = new Set(["receive", "count"]);

function failed<T>(err: unknown): AuditStoreResult<T> {
  const text = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
  return { ok: false, refusal: { code: "COUNT_GENERATOR_READ", message: `The lots could not be read, so nothing is proposed: ${text}` } };
}

/** Every active lot, paged (never cut at the 1,000-row cap), enriched like the planner. */
export async function loadActiveAuditLots(): Promise<AuditStoreResult<AuditLot[]>> {
  const supabase = await createBooksClient();
  let failure: unknown = null;
  const rows = await pagedAll<AuditLotRow>(async (from, to) => {
    const { data, error } = await supabase
      .from("inventory_lots")
      .select(AUDIT_LOT_COLUMNS.join(","))
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      failure = error;
      return [];
    }
    return (data ?? []) as unknown as AuditLotRow[];
  }, { concurrency: ADMIN_PAGED_CONCURRENCY });
  if (failure) return failed(failure);
  return { ok: true, data: await enrichAuditLots(rows, asLotFetcher(supabase)) };
}

export type OpenCountHold = { lotId: string; sessionId: string; label: string };

/**
 * Lots on an OPEN count (draft .. approved-not-posted). Optionally only for
 * the given lot ids (createAuditSession's check). A failed read FAILS CLOSED:
 * the caller gets a refusal, never "no conflicts".
 */
export async function loadOpenCountHolds(onlyLotIds?: readonly string[]): Promise<AuditStoreResult<OpenCountHold[]>> {
  const supabase = await createBooksClient();
  let sErr: unknown = null;
  const sessions = await pagedAll<{ id: string; label: string; status: string; posted_at: string | null }>(async (from, to) => {
    const { data, error } = await supabase
      .from("inventory_audit_sessions")
      .select("id, label, status, posted_at")
      .in("status", [...OPEN_AUDIT_STATUSES])
      .is("posted_at", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      sErr = error;
      return [];
    }
    return (data ?? []) as Array<{ id: string; label: string; status: string; posted_at: string | null }>;
  });
  if (sErr) return failed(sErr);
  const open = (sessions as Array<{ id: string; label: string; status: string; posted_at: string | null }>).filter((s) =>
    isOpenAudit(s.status, s.posted_at),
  );
  if (open.length === 0) return { ok: true, data: [] };
  const labelOf = new Map(open.map((s) => [s.id, s.label]));
  let failure: unknown = null;
  const lines = await chunkedIn<string, { session_id: string; lot_id: string }>(
    open.map((s) => s.id),
    async (chunk, from, to) => {
      let q = supabase.from("inventory_audit_lines").select("session_id, lot_id").in("session_id", chunk);
      if (onlyLotIds && onlyLotIds.length > 0 && onlyLotIds.length <= 200) q = q.in("lot_id", [...onlyLotIds]);
      const { data, error: e } = await q.order("id", { ascending: true }).range(from, to);
      if (e) {
        failure = e;
        return [];
      }
      return (data ?? []) as Array<{ session_id: string; lot_id: string }>;
    },
  );
  if (failure) return failed(failure);
  const wanted = onlyLotIds ? new Set(onlyLotIds) : null;
  return {
    ok: true,
    data: lines
      .filter((l) => !wanted || wanted.has(l.lot_id))
      .map((l) => ({ lotId: l.lot_id, sessionId: l.session_id, label: labelOf.get(l.session_id) ?? "another count" })),
  };
}

/**
 * The Exceptions generator's inputs. Each source is best-effort: one source
 * failing only means fewer exceptions are proposed (it never blocks a count),
 * and the page says which source could not be read.
 */
export async function loadExceptionInputs(): Promise<{ inputs: ExceptionInputs; unread: string[] }> {
  const unread: string[] = [];
  const oversold = await loadOversoldReport({ limit: 500 }).catch(() => null);
  const oversoldProductNames = oversold && oversold.ok ? oversold.flags.map((f) => f.productName).filter((n): n is string => !!n) : [];
  if (!oversold || !oversold.ok) unread.push("Stock needing recount");

  const recentAdjustments = new Map<string, string[]>();
  try {
    if (!isSupabaseServiceConfigured) throw new Error("not configured");
    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - RECENT_ADJUSTMENT_DAYS * 86_400_000).toISOString();
    let failure: unknown = null;
    const rows = await pagedAll<{ lot_id: string; reason: string }>(async (from, to) => {
      const { data, error } = await admin
        .from("inventory_adjustments")
        .select("id, lot_id, reason")
        .gte("created_at", since)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        failure = error;
        return [];
      }
      return (data ?? []) as Array<{ lot_id: string; reason: string }>;
    });
    if (failure) throw failure;
    for (const r of rows) {
      if (!r.lot_id || ROUTINE_ADJUSTMENTS.has(r.reason)) continue;
      const arr = recentAdjustments.get(r.lot_id);
      if (arr) arr.push(r.reason);
      else recentAdjustments.set(r.lot_id, [r.reason]);
    }
  } catch {
    unread.push("recent adjustments");
  }

  let unavailableWithStockKeys: string[] = [];
  try {
    const rep = await getRegisterSellabilityReport();
    unavailableWithStockKeys = rep.restorable.map((r) => r.productKey);
  } catch {
    unread.push("menu availability");
  }
  return { inputs: { oversoldProductNames, recentAdjustments, unavailableWithStockKeys }, unread };
}

/** The saved rotation pointer. Unreadable = start of the rotation (fails safe: it only proposes). */
export async function getRotation(): Promise<RotationState> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_ROTATION };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("site_settings").select("value_json").eq("key", ROTATION_SETTING_KEY).maybeSingle();
    if (error) return { ...EMPTY_ROTATION };
    return rotationFromSetting(data?.value_json ?? null);
  } catch {
    return { ...EMPTY_ROTATION };
  }
}

export async function saveRotation(state: RotationState, byId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("site_settings")
      .upsert({ key: ROTATION_SETTING_KEY, label: ROTATION_SETTING_LABEL, value_json: state, updated_by: byId }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** For the cockpit: has a vendor-of-the-day count been planned today (Pacific)? */
export async function vendorCountPlannedToday(): Promise<{ planned: boolean; lastLabel: string | null; started: boolean }> {
  const r = await getRotation();
  return { planned: r.lastPlannedOn === pacificToday(), lastLabel: r.lastPlannedLabel, started: r.lastPlannedOn !== null };
}
