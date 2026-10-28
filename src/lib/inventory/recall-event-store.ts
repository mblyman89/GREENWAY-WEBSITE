/**
 * recall-event-store.ts (Fix Phase 1.6c · G-25 · F-05a-15, F-05a-16)
 *
 * Server reads and writes for the recall plan (site_settings 'recall_plan'),
 * the recall event log (migration 0311) and the open pickup orders that hold
 * a recalled product. Rules live in recall-event-core.ts.
 *
 * A lot added to an event is set Recalled ONLY through the G-22 audited path:
 * evaluateLotLifecycleChange (lot-lifecycle-core.ts) then updateLotStatus
 * (store.ts), with the same audit row setLotStatusAction writes. This file
 * never writes inventory_lots itself.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ilikeContains } from "@/lib/supabase/postgrest-escape";
import { chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
import { ACTIVE_ORDER_STATUSES } from "@/lib/orders/types";
import {
  normalizeRecallPlan,
  type OpenOrderFacts,
  type OpenRecallEventFacts,
  type LotRecallEventFacts,
  type RecallPlan,
} from "@/lib/inventory/recall-event-core";

export const RECALL_PLAN_KEY = "recall_plan";
const RECALL_PLAN_LABEL = "Written recall plan (WAC 314-55-225(3)(d))";

export const RECALL_EVENTS_PENDING_MIGRATION =
  "The recall log needs migration 0311_recall_events.sql. Apply it in the Supabase SQL editor (after 0310), then reload.";

function isMissingSchema(message: string | null | undefined): boolean {
  return /does not exist|could not find|schema cache/i.test(message ?? "");
}

// ── Recall plan (form 8.4) ───────────────────────────────────────────────

/** The saved plan, or null when none has been saved (or the read failed). */
export async function getRecallPlan(): Promise<RecallPlan | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", RECALL_PLAN_KEY).maybeSingle();
    if (!data || data.value_json == null) return null;
    return normalizeRecallPlan(data.value_json);
  } catch {
    return null;
  }
}

export async function saveRecallPlan(plan: RecallPlan, updatedBy: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("site_settings").upsert(
    { key: RECALL_PLAN_KEY, label: RECALL_PLAN_LABEL, value_json: plan as unknown as Record<string, unknown>, updated_by: updatedBy },
    { onConflict: "key" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Recall events (form 8.5) ─────────────────────────────────────────────

export type RecallEventRow = {
  id: string;
  event_number: number | null;
  type: string;
  status: string;
  product: string;
  vendor_name: string | null;
  lot_numbers_given: string | null;
  reason: string;
  recall_reference: string | null;
  notice_source: string;
  notice_method: string;
  received_at: string;
  lcb_officer: string | null;
  lcb_notified_at: string | null;
  lcb_method: string | null;
  lcb_notes: string | null;
  outcome: string | null;
  clearance_reference: string | null;
  plan_departures: string | null;
  closed_at: string | null;
  created_at: string;
};

export type RecallEventLotRow = {
  id: string;
  lot_id: string;
  on_hand_at_add: number | null;
  previous_status: string | null;
  added_at: string;
  lot: { id: string; product_name: string | null; lot_code: string | null; status: string; on_hand_qty: number | null; pos_product_key: string | null } | null;
};

export type RecallWeeklyRow = {
  id: string;
  week_of: string;
  held: number;
  returned_by_customers: number;
  returned_to_vendor: number;
  destroyed: number;
  sold_before_hold: number;
  reported_to_lcb_on: string | null;
  notes: string | null;
};

const EVENT_COLS =
  "id, event_number, type, status, product, vendor_name, lot_numbers_given, reason, recall_reference, notice_source, notice_method, received_at, lcb_officer, lcb_notified_at, lcb_method, lcb_notes, outcome, clearance_reference, plan_departures, closed_at, created_at";

export async function listRecallEvents(): Promise<{ rows: RecallEventRow[]; pending: boolean; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { rows: [], pending: false, error: null };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("recall_events").select(EVENT_COLS).order("received_at", { ascending: false }).limit(500);
  if (error) return { rows: [], pending: isMissingSchema(error.message), error: error.message };
  return { rows: (data as RecallEventRow[] | null) ?? [], pending: false, error: null };
}

export async function getRecallEvent(
  id: string,
): Promise<{ event: RecallEventRow; lots: RecallEventLotRow[]; weekly: RecallWeeklyRow[] } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("recall_events").select(EVENT_COLS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const [lotsRes, weeklyRes] = await Promise.all([
    admin
      .from("recall_event_lots")
      .select("id, lot_id, on_hand_at_add, previous_status, added_at")
      .eq("event_id", id)
      .order("added_at", { ascending: true }),
    admin
      .from("recall_event_weekly")
      .select("id, week_of, held, returned_by_customers, returned_to_vendor, destroyed, sold_before_hold, reported_to_lcb_on, notes")
      .eq("event_id", id)
      .order("week_of", { ascending: true }),
  ]);
  // recall_event_lots.lot_id has no foreign key (the log is kept by the
  // factory reset, inventory_lots is not), so the lots are read by id.
  const links = (lotsRes.data as Omit<RecallEventLotRow, "lot">[] | null) ?? [];
  type LotInfo = NonNullable<RecallEventLotRow["lot"]>;
  const lotRows = links.length
    ? await chunkedIn(links.map((l) => l.lot_id), async (chunk, from, to) => {
        const { data: d, error: e } = await admin
          .from("inventory_lots")
          .select("id, product_name, lot_code, status, on_hand_qty, pos_product_key")
          .in("id", chunk)
          .order("id")
          .range(from, to);
        if (e) throw new Error(e.message);
        return (d as LotInfo[] | null) ?? [];
      }).catch(() => [] as LotInfo[])
    : [];
  const byId = new Map(lotRows.map((l) => [l.id, l]));
  const lots: RecallEventLotRow[] = links.map((r) => ({ ...r, lot: byId.get(r.lot_id) ?? null }));
  return { event: data as RecallEventRow, lots, weekly: (weeklyRes.data as RecallWeeklyRow[] | null) ?? [] };
}

export async function createRecallEvent(
  input: {
    type: string;
    product: string;
    vendorName: string | null;
    lotNumbersGiven: string | null;
    reason: string;
    recallReference: string | null;
    noticeSource: string;
    noticeMethod: string;
    receivedAtIso: string;
  },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("recall_events")
    .insert({
      type: input.type,
      product: input.product.trim(),
      vendor_name: input.vendorName?.trim() || null,
      lot_numbers_given: input.lotNumbersGiven?.trim() || null,
      reason: input.reason.trim(),
      recall_reference: input.recallReference?.trim() || null,
      notice_source: input.noticeSource,
      notice_method: input.noticeMethod,
      received_at: input.receivedAtIso,
      received_by: actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: isMissingSchema(error.message) ? RECALL_EVENTS_PENDING_MIGRATION : error.message };
  return { ok: true, id: String((data as { id: string }).id) };
}

export async function linkLotToRecallEvent(
  eventId: string,
  lotId: string,
  onHand: number | null,
  previousStatus: string,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("recall_event_lots")
    .upsert(
      { event_id: eventId, lot_id: lotId, on_hand_at_add: onHand, previous_status: previousStatus, added_by: actorId },
      { onConflict: "event_id,lot_id", ignoreDuplicates: true },
    );
  if (error) return { ok: false, error: isMissingSchema(error.message) ? RECALL_EVENTS_PENDING_MIGRATION : error.message };
  return { ok: true };
}

export async function recordLcbNotification(
  eventId: string,
  input: { officer: string; method: string; notifiedAtIso: string; notes: string | null },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("recall_events")
    .update({
      lcb_officer: input.officer.trim(),
      lcb_method: input.method,
      lcb_notified_at: input.notifiedAtIso,
      lcb_notes: input.notes?.trim() || null,
      lcb_notified_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("status", "open")
    .is("lcb_notified_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "The event changed while you were editing it. Reload and try again." };
  return { ok: true };
}

export async function addRecallWeeklyRow(
  eventId: string,
  row: {
    weekOf: string;
    held: number;
    returnedByCustomers: number;
    returnedToVendor: number;
    destroyed: number;
    soldBeforeHold: number;
    reportedToLcbOn: string | null;
    notes: string | null;
  },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("recall_event_weekly").insert({
    event_id: eventId,
    week_of: row.weekOf,
    held: row.held,
    returned_by_customers: row.returnedByCustomers,
    returned_to_vendor: row.returnedToVendor,
    destroyed: row.destroyed,
    sold_before_hold: row.soldBeforeHold,
    reported_to_lcb_on: row.reportedToLcbOn,
    notes: row.notes?.trim() || null,
    created_by: actorId,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function closeRecallEvent(
  eventId: string,
  input: { outcome: string; clearanceReference: string | null; planDepartures: string | null },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("recall_events")
    .update({
      status: "closed",
      outcome: input.outcome,
      clearance_reference: input.clearanceReference?.trim() || null,
      plan_departures: input.planDepartures?.trim() || null,
      closed_at: now,
      closed_by: actorId,
      updated_at: now,
    })
    .eq("id", eventId)
    .eq("status", "open")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "The event changed while you were editing it. Reload and try again." };
  return { ok: true };
}

/** Open events with the facts the Issues rows need. Missing table → []. */
export async function listOpenRecallEventFacts(): Promise<OpenRecallEventFacts[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("recall_events")
      .select("id, event_number, type, product, received_at, lcb_notified_at, weekly:recall_event_weekly ( week_of, reported_to_lcb_on )")
      .eq("status", "open")
      .limit(200);
    if (error || !data) return [];
    return (
      data as unknown as {
        id: string;
        event_number: number | null;
        type: string;
        product: string;
        received_at: string;
        lcb_notified_at: string | null;
        weekly: { week_of: string; reported_to_lcb_on: string | null }[] | null;
      }[]
    ).map((e) => {
      const weeks = (e.weekly ?? []).map((w) => w.week_of).sort();
      const reported = (e.weekly ?? []).map((w) => w.reported_to_lcb_on).filter((x): x is string => !!x).sort();
      return {
        id: e.id,
        eventNumber: e.event_number,
        type: e.type,
        product: e.product,
        receivedAtIso: e.received_at,
        lcbNotifiedAtIso: e.lcb_notified_at,
        lastWeekOf: weeks.length ? weeks[weeks.length - 1] : null,
        lastReportedOn: reported.length ? reported[reported.length - 1] : null,
      };
    });
  } catch {
    return [];
  }
}

/**
 * G-42 req 6: the recall events this lot is on (with their LCB contact).
 * A missing table returns [] — so a Recall vendor return is REFUSED until
 * migration 0311 is applied and the event records the LCB contact.
 */
export async function listRecallEventsForLot(lotId: string): Promise<LotRecallEventFacts[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("recall_event_lots")
    .select("event:recall_events ( id, event_number, status, lcb_officer, lcb_notified_at )")
    .eq("lot_id", lotId);
  if (error || !data) return [];
  const out: LotRecallEventFacts[] = [];
  for (const r of data as unknown as { event: unknown }[]) {
    const e = (Array.isArray(r.event) ? r.event[0] : r.event) as
      | { id: string; event_number: number | null; status: string; lcb_officer: string | null; lcb_notified_at: string | null }
      | null;
    if (e) out.push({ eventId: e.id, eventNumber: e.event_number, status: e.status, lcbOfficer: e.lcb_officer, lcbNotifiedAtIso: e.lcb_notified_at });
  }
  return out;
}

/**
 * Open pickup orders (new / acknowledged / preparing / ready) with their
 * lines, for the "open orders hold a recalled product" flag. Best-effort:
 * a read failure returns [] (the completion gate is the hard stop).
 */
export async function listOpenOrderLines(): Promise<OpenOrderFacts[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    // Every open order, paged (PostgREST caps a single read at 1000 rows).
    // A failed page throws and the catch below returns [] (best-effort).
    const data = await pagedAll(async (from, to) => {
      const { data: page, error } = await admin
        .from("orders")
        .select("id, order_number, customer_first_name, lines:order_lines ( product_id, variant_id, product_name )")
        .in("status", ACTIVE_ORDER_STATUSES as string[])
        .order("placed_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (page ?? []) as unknown[];
    });
    return (
      data as unknown as {
        id: string;
        order_number: string;
        customer_first_name: string | null;
        lines: { product_id: string | null; variant_id: string | null; product_name: string }[] | null;
      }[]
    ).map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      customerFirstName: o.customer_first_name,
      lines: (o.lines ?? []).map((l) => ({ productId: l.product_id, variantId: l.variant_id, productName: l.product_name })),
    }));
  } catch {
    return [];
  }
}

/**
 * Lots matching a search (product, lot code, POS key), for the "add an
 * affected lot" picker. Every status except Destroyed is listed, so sold-out
 * and quarantined lots can be put on the event too (SOP-05a §4.10 step 2).
 */
export async function searchLotsForRecall(
  search: string,
  limit = 40,
): Promise<{ id: string; product_name: string | null; lot_code: string | null; status: string; on_hand_qty: number | null; pos_product_key: string | null }[]> {
  if (!isSupabaseServiceConfigured) return [];
  const like = ilikeContains(search);
  if (!like) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select("id, product_name, lot_code, status, on_hand_qty, pos_product_key")
    .neq("status", "destroyed")
    .or([`product_name.ilike.${like}`, `lot_code.ilike.${like}`, `pos_product_key.ilike.${like}`].join(","))
    .order("product_name", { ascending: true })
    .limit(limit);
  return (data as { id: string; product_name: string | null; lot_code: string | null; status: string; on_hand_qty: number | null; pos_product_key: string | null }[] | null) ?? [];
}
