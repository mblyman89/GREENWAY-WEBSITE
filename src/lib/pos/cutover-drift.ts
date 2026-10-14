/**
 * src/lib/pos/cutover-drift.ts  (R50 A6) - server reads for cutover-drift-core.ts.
 *
 * READ-ONLY except recordDriftCheck (one audit_logs row: "I ran today's check").
 * Every read is bounded, names its columns, is fully paged, and a failed page
 * makes the whole answer red (readsComplete=false) - never a short list.
 *
 *   1. The import's lots (importManifestIds + readLotsOnManifests, the same
 *      reads the units check and the Oct 30 count use), destroyed lots excluded.
 *   2. Vendor names for those lots.
 *   3. Every inventory_adjustments row on those lots.
 *   4. Keys shared with lots NOT on this import (inventory_lots by key).
 *   5. Sales: order_events `inventory_decremented` since the import's first lot,
 *      then those orders' lines. The event's time is when the units came off.
 *   6. Voids: order_events `sale_void_restocked`, same way.
 */
import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { importManifestIds, readLotsOnManifests } from "@/lib/inventory/import-lineage-store";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { isCustomLineProductId } from "@/lib/pos/custom-sale-core";
import {
  DRIFT_CHECKED_ACTION,
  DRIFT_SALE_EVENT,
  DRIFT_VOID_EVENT,
  decrementTrouble,
  driftReport,
  lotDriftKey,
  type DriftAdjustment,
  type DriftCheckRecord,
  type DriftLot,
  type DriftOrderLine,
  type DriftReport,
} from "@/lib/pos/cutover-drift-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const DRIFT_LOT_SELECT = "id, pos_product_key, received_qty, on_hand_qty, created_at, product_name, category, vendor_id";
/** ids per `.in()` request (uuid lists past ~200 risk the URL limit). */
export const DRIFT_IN_CHUNK = 150;

type LotRow = Omit<DriftLot, "vendor"> & { vendor_id: string | null };

async function inChunks<Id, Row>(ids: readonly Id[], read: (chunk: Id[], from: number, to: number) => Promise<{ ok: boolean; rows: Row[] }>, what: string): Promise<Row[]> {
  const out: Row[] = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += DRIFT_IN_CHUNK) {
    const chunk = uniq.slice(i, i + DRIFT_IN_CHUNK);
    const r = await pagedAllChecked<Row>((from, to) => read(chunk, from, to));
    if (!r.verdict.complete) throw new Error(`Could not read ${what}. ${r.verdict.message}`);
    out.push(...r.rows);
  }
  return out;
}

type EventRow = { id: string; order_id: string; note: string | null; created_at: string };

async function eventsSince(admin: Admin, eventType: string, since: string): Promise<EventRow[]> {
  const r = await pagedAllChecked<EventRow>(async (from, to) => {
    const { data, error } = await admin
      .from("order_events")
      .select("id, order_id, note, created_at")
      .eq("event_type", eventType)
      .gte("created_at", since)
      .order("id", { ascending: true })
      .range(from, to);
    return { ok: !error, rows: (data as EventRow[] | null) ?? [] };
  });
  if (!r.verdict.complete) throw new Error(`Could not read the ${eventType} events. ${r.verdict.message}`);
  return r.rows;
}

type LineRow = { id: string; order_id: string; product_id: string | null; variant_id: string | null; quantity: number | string | null };

async function linesFor(admin: Admin, events: readonly EventRow[], what: string): Promise<DriftOrderLine[]> {
  // One marker per order (partial unique index, migration 0129); keep the earliest just in case.
  const at = new Map<string, string>();
  for (const e of events) if (!at.has(e.order_id) || e.created_at < at.get(e.order_id)!) at.set(e.order_id, e.created_at);
  const rows = await inChunks<string, LineRow>(
    [...at.keys()],
    async (chunk, from, to) => {
      const { data, error } = await admin
        .from("order_lines")
        .select("id, order_id, product_id, variant_id, quantity")
        .in("order_id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      return { ok: !error, rows: (data as LineRow[] | null) ?? [] };
    },
    what,
  );
  // The decrement skips keypad custom lines (sale-decrement.ts); so do we.
  return rows.filter((r) => !isCustomLineProductId(r.product_id)).map((r) => ({ productId: r.product_id, variantId: r.variant_id, quantity: r.quantity, at: at.get(r.order_id)! }));
}

export type DriftLoad =
  | { ok: false; error: string }
  | { ok: true; report: DriftReport; lotCount: number; since: string | null; manifests: number };

export async function loadDrift(admin: Admin, importId: string, nowMs: number): Promise<DriftLoad> {
  if (!isSafeImportId(importId)) return { ok: false, error: "That import id is not valid." };
  const { data: imp, error: impErr } = await admin.from("pos_imports").select("id, is_test").eq("id", importId).maybeSingle();
  if (impErr) return { ok: false, error: `Could not read the import. ${impErr.message}` };
  if (!imp) return { ok: false, error: "That import was not found." };
  if ((imp as { is_test: boolean }).is_test) return { ok: false, error: "This is a test import. Test imports never make lots, so there is nothing to compare." };

  let lots: DriftLot[] = [];
  let adjustments: DriftAdjustment[] = [];
  let sold: DriftOrderLine[] = [];
  let voided: DriftOrderLine[] = [];
  const shared = new Set<string>();
  let failedDecrements = 0;
  let readsComplete = true;
  let readError: string | null = null;
  let manifests = 0;
  let since: string | null = null;
  try {
    const manifestIds = await importManifestIds(admin, importId);
    manifests = manifestIds.length;
    const rows = manifestIds.length ? await readLotsOnManifests<LotRow>(admin, manifestIds, DRIFT_LOT_SELECT, { excludeDestroyed: true }) : [];

    const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter((v): v is string => !!v))];
    const vendors = await inChunks<string, { id: string; display_name: string | null }>(
      vendorIds,
      async (chunk, from, to) => {
        const { data, error } = await admin.from("vendors").select("id, display_name").in("id", chunk).order("id", { ascending: true }).range(from, to);
        return { ok: !error, rows: (data as { id: string; display_name: string | null }[] | null) ?? [] };
      },
      "the vendors",
    );
    const vName = new Map(vendors.map((v) => [v.id, v.display_name]));
    lots = rows.map(({ vendor_id, ...r }) => ({ ...r, vendor: vendor_id ? vName.get(vendor_id) ?? null : null }));

    adjustments = await inChunks<string, DriftAdjustment & { id: string }>(
      lots.map((l) => l.id),
      async (chunk, from, to) => {
        const { data, error } = await admin.from("inventory_adjustments").select("id, lot_id, qty_delta, reason").in("lot_id", chunk).order("id", { ascending: true }).range(from, to);
        return { ok: !error, rows: (data as (DriftAdjustment & { id: string })[] | null) ?? [] };
      },
      "the stock adjustments",
    );

    // Keys that also have lots elsewhere (any status but destroyed): sales on them cannot be split.
    const ours = new Set(lots.map((l) => l.id));
    const keys = [...new Set(lots.map((l) => (l.pos_product_key ?? "").trim()).filter(Boolean))];
    const sameKey = await inChunks<string, { id: string; pos_product_key: string | null }>(
      keys,
      async (chunk, from, to) => {
        const { data, error } = await admin.from("inventory_lots").select("id, pos_product_key").in("pos_product_key", chunk).neq("status", "destroyed").order("id", { ascending: true }).range(from, to);
        return { ok: !error, rows: (data as { id: string; pos_product_key: string | null }[] | null) ?? [] };
      },
      "the other lots of the same products",
    );
    for (const r of sameKey) if (!ours.has(r.id)) shared.add(lotDriftKey(r));

    since = lots.length ? lots.map((l) => l.created_at).sort()[0] : null;
    if (since) {
      const saleEvents = await eventsSince(admin, DRIFT_SALE_EVENT, since);
      failedDecrements = saleEvents.filter((e) => decrementTrouble(e.note, e.created_at, nowMs)).length;
      sold = await linesFor(admin, saleEvents, "the sales");
      voided = await linesFor(admin, await eventsSince(admin, DRIFT_VOID_EVENT, since), "the voids");
      // A decrement that failed before it could claim its marker leaves only a note (sale-decrement.ts).
      const notes = await pagedAllChecked<EventRow>(async (from, to) => {
        const { data, error } = await admin
          .from("order_events")
          .select("id, order_id, note, created_at")
          .eq("event_type", "note")
          .like("note", "Inventory decrement FAILED%")
          .gte("created_at", since!)
          .order("id", { ascending: true })
          .range(from, to);
        return { ok: !error, rows: (data as EventRow[] | null) ?? [] };
      });
      if (!notes.verdict.complete) throw new Error(`Could not read the failed-sale notes. ${notes.verdict.message}`);
      failedDecrements += notes.rows.filter((e) => decrementTrouble(e.note, e.created_at, nowMs)).length;
    }
  } catch (e) {
    readsComplete = false;
    readError = e instanceof Error ? e.message : String(e);
  }
  const report = driftReport({ lots, adjustments, sold, voided, sharedKeys: shared, failedDecrements, readsComplete, readError });
  return { ok: true, report, lotCount: lots.length, since, manifests };
}

type AuditRow = { id: number; actor_email: string | null; after_json: unknown; created_at: string };

/** The "I ran today's check" records for this import. Throws on a failed page. */
export async function loadDriftChecks(admin: Admin, importId: string): Promise<DriftCheckRecord[]> {
  const read = await pagedAllChecked<AuditRow>(async (from, to) => {
    const { data, error } = await admin
      .from("audit_logs")
      .select("id, actor_email, after_json, created_at")
      .eq("entity_type", "pos_import")
      .eq("entity_id", importId)
      .eq("action", DRIFT_CHECKED_ACTION)
      .order("id", { ascending: true })
      .range(from, to);
    return { ok: !error, rows: (data as AuditRow[] | null) ?? [] };
  });
  if (!read.verdict.complete) throw new Error(`Could not load the daily check records. ${read.verdict.message}`);
  return read.rows.map((r) => {
    const a = (r.after_json ?? {}) as Record<string, unknown>;
    return { date: String(a.date ?? ""), ok: a.ok === true, drift: Number(a.drift ?? 0), driftProducts: Number(a.driftProducts ?? 0), by: r.actor_email, at: r.created_at };
  });
}

/** One audit_logs row, CHECKED (recordAudit swallows errors by design). Returns the error text or null. */
export async function recordDriftCheck(
  admin: Admin,
  v: { importId: string; actorId: string | null; actorEmail: string | null; date: string; report: DriftReport },
): Promise<string | null> {
  const { error } = await admin.from("audit_logs").insert({
    actor_id: v.actorId,
    actor_email: v.actorEmail,
    action: DRIFT_CHECKED_ACTION,
    entity_type: "pos_import",
    entity_id: v.importId,
    before_json: null,
    after_json: { date: v.date, ok: v.report.ok, drift: v.report.totals.drift, driftProducts: v.report.totals.driftProducts, onHand: v.report.totals.onHand, expected: v.report.totals.expected },
  });
  return error ? error.message : null;
}
