/**
 * src/lib/compliance/trade-samples.ts
 *
 * Server wrapper for the pure trade-sample compliance engine. Reads owner-
 * tunable settings from `trade_sample_settings` and the event ledger from
 * `trade_sample_events` (migration 0054 + 0095). Enforces the WAC 314-55-096
 * quarterly caps as HARD BLOCKS when recording events.
 *
 * RETAILER SCOPE (H16b Samples Slice C): retailers have ONE sample category —
 * the TRADE sample:
 *   • incoming (processor → retailer): ≤ 120 units/quarter/processor [096(1)(f)(ii)]
 *   • outgoing (retailer → employee):  ≤ 30 units/quarter/employee    [096(1)(j)(vi)]
 * IQC is producer/processor-only [096(3)] and was RETIRED (owner "kill it").
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  evaluateCap,
  SAMPLE_DEFAULTS,
  type SampleSettings,
  type SampleDirection,
  type SampleProductType,
  type SampleCategory,
  type ParsedRecord,
} from "@/lib/compliance/trade-samples-core";
import {
  buildEmployeeSampleAdjustmentNote,
  type ParsedAssignment,
  type RawSampleLot,
} from "@/lib/compliance/employee-sample-core";
import { createAdjustment } from "@/lib/inventory/store";
import {
  computeSampleCapacity,
  daysLeftInQuarter,
  type SampleCapacity,
} from "@/lib/compliance/sample-capacity-core";
import { listEmployees } from "@/lib/staffing/store";
import { pacificToday } from "@/lib/reports/timezone";

export * from "@/lib/compliance/trade-samples-core";

export const DEFAULT_SAMPLE_SETTINGS: SampleSettings = {
  enforce: true,
  hardBlock: true,
  incomingUnitsPerQuarter: SAMPLE_DEFAULTS.incomingUnitsPerQuarter,
  outgoingUnitsPerEmployee: SAMPLE_DEFAULTS.outgoingUnitsPerEmployee,
  maxFlowerGrams: SAMPLE_DEFAULTS.maxFlowerGrams,
  maxConcentrateGrams: SAMPLE_DEFAULTS.maxConcentrateGrams,
  maxInfusedMg: SAMPLE_DEFAULTS.maxInfusedMg,
  maxThcMgPerServing: SAMPLE_DEFAULTS.maxThcMgPerServing,
};

type SettingsRow = {
  enforce: boolean;
  hard_block: boolean;
  incoming_units_per_quarter: number;
  outgoing_units_per_employee: number;
  max_flower_grams: number;
  max_concentrate_grams: number;
  max_infused_mg: number;
  max_thc_mg_per_serving: number;
  notes: string | null;
  updated_at: string | null;
};

export async function getSampleSettings(): Promise<SampleSettings & { notes: string | null; updatedAt: string | null }> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_SAMPLE_SETTINGS, notes: null, updatedAt: null };
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("trade_sample_settings").select("*").eq("id", true).maybeSingle();
  const r = data as SettingsRow | null;
  if (!r) return { ...DEFAULT_SAMPLE_SETTINGS, notes: null, updatedAt: null };
  return {
    enforce: r.enforce,
    hardBlock: r.hard_block,
    incomingUnitsPerQuarter: r.incoming_units_per_quarter,
    outgoingUnitsPerEmployee: r.outgoing_units_per_employee,
    maxFlowerGrams: Number(r.max_flower_grams),
    maxConcentrateGrams: Number(r.max_concentrate_grams),
    maxInfusedMg: Number(r.max_infused_mg),
    maxThcMgPerServing: Number(r.max_thc_mg_per_serving),
    notes: r.notes,
    updatedAt: r.updated_at,
  };
}

export async function updateSampleSettings(
  patch: Partial<SampleSettings> & { notes?: string | null },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const row: Record<string, unknown> = { id: true, updated_by: actorId };
  if (patch.enforce !== undefined) row.enforce = patch.enforce;
  if (patch.hardBlock !== undefined) row.hard_block = patch.hardBlock;
  if (patch.incomingUnitsPerQuarter !== undefined) row.incoming_units_per_quarter = patch.incomingUnitsPerQuarter;
  if (patch.outgoingUnitsPerEmployee !== undefined) row.outgoing_units_per_employee = patch.outgoingUnitsPerEmployee;
  if (patch.maxFlowerGrams !== undefined) row.max_flower_grams = patch.maxFlowerGrams;
  if (patch.maxConcentrateGrams !== undefined) row.max_concentrate_grams = patch.maxConcentrateGrams;
  if (patch.maxInfusedMg !== undefined) row.max_infused_mg = patch.maxInfusedMg;
  if (patch.maxThcMgPerServing !== undefined) row.max_thc_mg_per_serving = patch.maxThcMgPerServing;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { error } = await admin.from("trade_sample_settings").upsert(row, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type SampleEvent = {
  id: string;
  category: SampleCategory;
  direction: SampleDirection;
  product_type: SampleProductType;
  unit_count: number;
  unit_size_grams: number | null;
  unit_size_mg: number | null;
  thc_mg_per_serving: number | null;
  quarter_key: string;
  processor_name: string | null;
  employee_id: string | null;
  employee_name: string | null;
  from_sample_jar: boolean;
  note: string | null;
  import_id: string | null;
  source_product_name: string | null;
  source_lot_ref: string | null;
  created_at: string;
};

/** Recent events (most recent first) for the ledger view. */
export async function listSampleEvents(opts?: { quarterKey?: string; category?: SampleCategory; limit?: number }): Promise<SampleEvent[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("trade_sample_events").select("*").order("created_at", { ascending: false }).limit(opts?.limit ?? 200);
  if (opts?.quarterKey) q = q.eq("quarter_key", opts.quarterKey);
  if (opts?.category) q = q.eq("category", opts.category);
  const { data } = await q;
  return (data as SampleEvent[] | null) ?? [];
}

/** Units already recorded INCOMING for a processor (by name) in a quarter (trade only). */
export async function incomingUnitsForProcessor(processorName: string, quarterKey: string): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("trade_sample_events")
    .select("unit_count")
    .eq("direction", "incoming")
    .eq("category", "trade")
    .eq("quarter_key", quarterKey)
    .eq("processor_name", processorName);
  return sumUnits(data);
}

/** TRADE units already recorded OUTGOING to an employee in a quarter (vs 30-cap). */
export async function outgoingUnitsForEmployee(employeeId: string, quarterKey: string): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("trade_sample_events")
    .select("unit_count")
    .eq("direction", "outgoing")
    .eq("category", "trade")
    .eq("quarter_key", quarterKey)
    .eq("employee_id", employeeId);
  return sumUnits(data);
}

function sumUnits(data: unknown): number {
  const rows = (data as { unit_count: number }[] | null) ?? [];
  return rows.reduce((s, r) => s + (Number(r.unit_count) || 0), 0);
}

export type QuarterUsage = {
  incomingByProcessor: { name: string; used: number; cap: number }[];
  outgoingByEmployee: { employeeId: string | null; name: string; used: number; cap: number }[];
};

/** Aggregate per-quarter usage for the insight dashboard (trade bucket only). */
export async function quarterUsage(quarterKey: string, settings: SampleSettings): Promise<QuarterUsage> {
  const events = await listSampleEvents({ quarterKey, limit: 2000 });
  const incMap = new Map<string, number>();
  const outMap = new Map<string, { name: string; used: number }>();
  for (const e of events) {
    if (e.direction === "incoming") {
      const key = e.processor_name ?? "(unnamed processor)";
      incMap.set(key, (incMap.get(key) ?? 0) + e.unit_count);
    } else {
      const key = e.employee_id ?? e.employee_name ?? "(unknown)";
      const cur = outMap.get(key) ?? { name: e.employee_name ?? "(unknown)", used: 0 };
      cur.used += e.unit_count;
      if (e.employee_name) cur.name = e.employee_name;
      outMap.set(key, cur);
    }
  }
  return {
    incomingByProcessor: [...incMap.entries()]
      .map(([name, used]) => ({ name, used, cap: settings.incomingUnitsPerQuarter }))
      .sort((a, b) => b.used - a.used),
    outgoingByEmployee: [...outMap.entries()]
      .map(([employeeId, v]) => ({ employeeId, name: v.name, used: v.used, cap: settings.outgoingUnitsPerEmployee }))
      .sort((a, b) => b.used - a.used),
  };
}

export type RecordResult =
  | { ok: true; id: string; message: string }
  | { ok: false; error: string; blocked?: boolean };

/**
 * Record a trade-sample event, HARD-ENFORCING the applicable quarterly cap.
 * The caller has already run parseRecordDraft (size caps + field validation);
 * here we tally the quarter and block if over cap: incoming uses the 120/qtr
 * per-processor cap, outgoing uses the 30/qtr per-employee cap.
 */
export async function recordSampleEvent(
  rec: ParsedRecord,
  meta: { employeeName?: string | null; createdBy: string | null; importId?: string | null; lotId?: string | null },
): Promise<RecordResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const settings = await getSampleSettings();

  let usedUnits = 0;
  if (rec.direction === "incoming") {
    usedUnits = await incomingUnitsForProcessor(rec.processorName ?? "", rec.quarterKey);
  } else {
    usedUnits = await outgoingUnitsForEmployee(rec.employeeId ?? "", rec.quarterKey);
  }
  const evaln = evaluateCap({ direction: rec.direction, usedUnits, addUnits: rec.unitCount, settings });
  if (evaln.block) return { ok: false, error: evaln.message, blocked: true };
  const message = evaln.message;

  const admin = createSupabaseAdminClient();

  // Base row (columns present since migrations 0054/0095).
  const baseRow: Record<string, unknown> = {
    category: rec.category,
    direction: rec.direction,
    product_type: rec.productType,
    unit_count: rec.unitCount,
    unit_size_grams: rec.unitSizeGrams,
    unit_size_mg: rec.unitSizeMg,
    thc_mg_per_serving: rec.thcMgPerServing,
    quarter_key: rec.quarterKey,
    processor_name: rec.processorName,
    employee_id: rec.employeeId,
    employee_name: meta.employeeName ?? null,
    from_sample_jar: rec.fromSampleJar,
    note: rec.note,
    // `import_id` (migration 0095) links the event to the sample JSON batch the
    // assigned lot came from. Prefer the parsed value; fall back to any caller
    // override for backwards compatibility.
    import_id: rec.importId ?? meta.importId ?? null,
    // Task K: assignments made from the available-samples table link straight
    // to the source inventory lot (0054's lot_id FK) for a lossless audit chain.
    lot_id: meta.lotId ?? null,
    created_by: meta.createdBy,
  };

  // CCRS product-identity columns land in migration 0105. Until it is applied,
  // gracefully degrade: try WITH the columns, and on a missing-column error
  // retry WITHOUT them (the assignment is still linked via import_id + note).
  const identityRow: Record<string, unknown> = {
    ...baseRow,
    source_product_name: rec.sourceProductName,
    source_lot_ref: rec.sourceLotRef,
  };

  let { data, error } = await admin.from("trade_sample_events").insert(identityRow).select("id").single();
  if (error && isMissingColumnError(error, ["source_product_name", "source_lot_ref"])) {
    ({ data, error } = await admin.from("trade_sample_events").insert(baseRow).select("id").single());
  }
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to record sample." };
  return { ok: true, id: (data as { id: string }).id, message };
}

export type AssignResult =
  | { ok: true; eventId: string; message: string; adjustmentWarning: string | null }
  | { ok: false; error: string; blocked?: boolean };

/**
 * Task K — assign a selected sample lot to an employee and mark it OUT of the
 * system the CCRS-required way. One call does the full compliant sequence:
 *
 *   1. HARD-ENFORCE the 30 units/employee/quarter cap (via recordSampleEvent,
 *      which tallies the quarter and blocks over-cap) and write the OUTGOING
 *      `trade_sample_events` row — the retailer's own log of the amount,
 *      product type, and employee name required by WAC 314-55-096(1)(j)(iv)-(v).
 *   2. Post a NEGATIVE `inventory_adjustments` row (reason `employee_sample`,
 *      detail naming the employee) against the source lot and decrement its
 *      on-hand quantity. The CCRS exporter maps `employee_sample` → "Other"
 *      with that employee-named detail — the LCB-confirmed way to report an
 *      employee sample to CCRS via InventoryAdjustment.csv.
 *
 * If step 2 fails after step 1 succeeded, the ledger row stands (it is the
 * compliance log) and we surface a warning so the owner can post the
 * adjustment manually from the lot page — we never silently lose the receipt.
 */
export async function assignSampleToEmployee(
  assignment: ParsedAssignment,
  meta: { employeeName: string; createdBy: string | null },
): Promise<AssignResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };

  const rec: ParsedRecord = {
    direction: "outgoing",
    category: "trade",
    productType: assignment.productType,
    unitCount: assignment.unitCount,
    unitSizeGrams: assignment.unitSizeGrams,
    unitSizeMg: assignment.unitSizeMg,
    thcMgPerServing: assignment.thcMgPerServing,
    quarterKey: assignment.quarterKey,
    processorName: null,
    employeeId: assignment.employeeId,
    fromSampleJar: assignment.fromSampleJar,
    note: assignment.note,
    sourceProductName: assignment.sourceProductName,
    sourceLotRef: assignment.sourceLotRef,
    importId: null,
  };

  const recorded = await recordSampleEvent(rec, {
    employeeName: meta.employeeName,
    createdBy: meta.createdBy,
    lotId: assignment.lotId,
  });
  if (!recorded.ok) return { ok: false, error: recorded.error, blocked: recorded.blocked };

  const adjustmentNote = buildEmployeeSampleAdjustmentNote({
    employeeName: meta.employeeName,
    productName: assignment.sourceProductName,
    lotCode: assignment.sourceLotRef,
    unitCount: assignment.unitCount,
  });
  const adjusted = await createAdjustment(
    {
      lotId: assignment.lotId,
      qtyDelta: -assignment.unitCount,
      reason: "employee_sample",
      note: adjustmentNote,
    },
    meta.createdBy,
  );

  return {
    ok: true,
    eventId: recorded.id,
    message: recorded.message,
    adjustmentWarning: adjusted.ok
      ? null
      : `The sample was logged, but the inventory adjustment failed (${adjusted.error}). Post a manual "Employee sample" adjustment of −${assignment.unitCount} on the lot so CCRS stays accurate.`,
  };
}

/** True when a PostgREST/Postgres error is an "unknown column" error for any of
 * the given column names — used to gracefully degrade before migration 0105. */
function isMissingColumnError(error: { message?: string; code?: string } | null, cols: string[]): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  // Postgres 42703 = undefined_column; PostgREST surfaces "could not find the
  // 'x' column" / "column ... does not exist".
  if (error.code === "42703" || error.code === "PGRST204") {
    return cols.some((c) => msg.includes(c.toLowerCase()));
  }
  return cols.some((c) => msg.includes(c.toLowerCase()) && (msg.includes("does not exist") || msg.includes("could not find") || msg.includes("schema cache")));
}

// ---------------------------------------------------------------------------
// Available sample inventory (Task K) — the ASSIGNABLE samples table.
//
// Samples no longer arrive via a JSON upload on this page: they flow in through
// email-intake receiving (manifest lines with is_sample = true), are hard-capped
// at finalize (120/qtr/processor, sample-intake-cap-core), and are auto-recorded
// to the ledger as INCOMING events (seedIncomingSampleEvents). What the
// Employee Samples page needs is the list of ACCEPTED sample lots that still
// have units on hand — the owner picks one from a table and assigns it to an
// employee.
// ---------------------------------------------------------------------------

/**
 * List accepted, active sample lots that still have units on hand. Raw rows —
 * classification into product types + per-unit sizes happens in the pure
 * employee-sample-core layer so it stays testable.
 */
export async function listAvailableSampleLots(limit = 200): Promise<RawSampleLot[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select(
      "id, product_name, strain_name, lot_code, inventory_type, on_hand_qty, unit, unit_weight, unit_weight_uom, created_at, inbound_manifests(vendor_label)",
    )
    .eq("is_sample", true)
    .eq("status", "active")
    .gt("on_hand_qty", 0)
    .order("created_at", { ascending: false })
    .limit(limit);
  type Row = Record<string, unknown> & {
    inbound_manifests?: { vendor_label: string | null } | { vendor_label: string | null }[] | null;
  };
  const rows = (data as Row[] | null) ?? [];
  return rows.map((r) => {
    const rel = r.inbound_manifests;
    const manifest = Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null);
    return {
      id: r.id as string,
      product_name: (r.product_name as string | null) ?? null,
      strain_name: (r.strain_name as string | null) ?? null,
      lot_code: (r.lot_code as string | null) ?? null,
      inventory_type: (r.inventory_type as string | null) ?? null,
      on_hand_qty: (r.on_hand_qty as number | null) ?? null,
      unit: (r.unit as string | null) ?? null,
      unit_weight: (r.unit_weight as number | null) ?? null,
      unit_weight_uom: (r.unit_weight_uom as string | null) ?? null,
      created_at: (r.created_at as string | null) ?? null,
      vendor_label: manifest?.vendor_label ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Employee sample history (read-only): every sample an employee RECEIVED —
// trade outgoing to an employee — across quarters, for the Sample History page.
// ---------------------------------------------------------------------------

import type { HistoryEvent } from "@/lib/compliance/sample-history-core";

/**
 * Fetch employee-receipt sample events (trade outgoing to an employee).
 * Incoming-from-processor rows are NOT an employee receipt and are excluded.
 * Newest first; caller filters/sorts in the pure layer.
 */
export async function listEmployeeSampleHistory(limit = 2000): Promise<HistoryEvent[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  // Employee receipts = outgoing trade samples to an employee.
  const { data } = await admin
    .from("trade_sample_events")
    .select("*")
    .neq("direction", "incoming")
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data as SampleEvent[] | null) ?? [];
  return rows.map((e) => ({
    id: e.id,
    category: e.category,
    productType: e.product_type,
    unitCount: e.unit_count,
    unitSizeGrams: e.unit_size_grams,
    unitSizeMg: e.unit_size_mg,
    thcMgPerServing: e.thc_mg_per_serving,
    quarterKey: e.quarter_key,
    employeeId: e.employee_id,
    employeeName: e.employee_name,
    fromSampleJar: e.from_sample_jar,
    note: e.note,
    sourceProductName: e.source_product_name ?? null,
    sourceLotRef: e.source_lot_ref ?? null,
    createdAt: e.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Distribution-capacity snapshot ("can we take in any more samples?").
// The real gate is total OUTBOUND capacity across active staff, not the
// per-processor intake cap — a sample we can't place before quarter-end is
// wasted product. Advisory only (soft), never a hard block.
// ---------------------------------------------------------------------------

/**
 * Compute the current-quarter sample distribution-capacity snapshot: how many
 * trade units we can still place across our ACTIVE employees this quarter, and
 * how close the trade lane is to its ceiling.
 */
export async function getSampleCapacity(
  quarterKey: string,
  settings: SampleSettings,
): Promise<SampleCapacity> {
  const [employees, usage] = await Promise.all([listEmployees(), quarterUsage(quarterKey, settings)]);
  const activeEmployees = employees.length; // listEmployees() returns active only
  const tradeUsed = usage.outgoingByEmployee.reduce((s, r) => s + r.used, 0);

  return computeSampleCapacity({
    activeEmployees,
    tradeUsed,
    tradePerEmployee: settings.outgoingUnitsPerEmployee,
    daysLeftInQuarter: daysLeftInQuarter(pacificToday()),
  });
}
