/**
 * src/lib/compliance/trade-samples.ts
 *
 * Server wrapper for the pure trade-sample compliance engine. Reads owner-
 * tunable settings from `trade_sample_settings` and the event ledger from
 * `trade_sample_events` (migration 0054 + 0095). Enforces the WAC 314-55-096
 * quarterly caps as HARD BLOCKS when recording events.
 *
 * Two SEPARATE per-employee quarterly buckets (verified against WAC 314-55-096
 * WSR 25-08-032 + Foster Garvey alert):
 *   • TRADE  — ≤ 30 units/employee/quarter                    [096(1)(j)(vi)]
 *   • IQC    — ≤ 50 units/employee/quarter, ≤ 25 concentrate  [096(3)(c)]
 * There is NO unlimited category / job-title exemption.
 */
import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  evaluateCap,
  evaluateIqcCap,
  SAMPLE_DEFAULTS,
  type SampleSettings,
  type SampleDirection,
  type SampleProductType,
  type SampleCategory,
  type ParsedRecord,
  type SampleJsonLot,
} from "@/lib/compliance/trade-samples-core";

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
  iqcUnitsPerEmployee: SAMPLE_DEFAULTS.iqcUnitsPerEmployee,
  iqcConcentrateSubcap: SAMPLE_DEFAULTS.iqcConcentrateSubcap,
  iqcMaxFlowerGrams: SAMPLE_DEFAULTS.iqcMaxFlowerGrams,
  iqcMaxUseableGrams: SAMPLE_DEFAULTS.iqcMaxUseableGrams,
  iqcMaxConcentrateGrams: SAMPLE_DEFAULTS.iqcMaxConcentrateGrams,
  iqcMaxInfusedThcMg: SAMPLE_DEFAULTS.iqcMaxInfusedThcMg,
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
  iqc_units_per_employee: number | null;
  iqc_concentrate_subcap: number | null;
  iqc_max_flower_grams: number | null;
  iqc_max_useable_grams: number | null;
  iqc_max_concentrate_grams: number | null;
  iqc_max_infused_thc_mg: number | null;
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
    iqcUnitsPerEmployee: r.iqc_units_per_employee ?? SAMPLE_DEFAULTS.iqcUnitsPerEmployee,
    iqcConcentrateSubcap: r.iqc_concentrate_subcap ?? SAMPLE_DEFAULTS.iqcConcentrateSubcap,
    iqcMaxFlowerGrams: r.iqc_max_flower_grams != null ? Number(r.iqc_max_flower_grams) : SAMPLE_DEFAULTS.iqcMaxFlowerGrams,
    iqcMaxUseableGrams: r.iqc_max_useable_grams != null ? Number(r.iqc_max_useable_grams) : SAMPLE_DEFAULTS.iqcMaxUseableGrams,
    iqcMaxConcentrateGrams: r.iqc_max_concentrate_grams != null ? Number(r.iqc_max_concentrate_grams) : SAMPLE_DEFAULTS.iqcMaxConcentrateGrams,
    iqcMaxInfusedThcMg: r.iqc_max_infused_thc_mg != null ? Number(r.iqc_max_infused_thc_mg) : SAMPLE_DEFAULTS.iqcMaxInfusedThcMg,
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
  if (patch.iqcUnitsPerEmployee !== undefined) row.iqc_units_per_employee = patch.iqcUnitsPerEmployee;
  if (patch.iqcConcentrateSubcap !== undefined) row.iqc_concentrate_subcap = patch.iqcConcentrateSubcap;
  if (patch.iqcMaxFlowerGrams !== undefined) row.iqc_max_flower_grams = patch.iqcMaxFlowerGrams;
  if (patch.iqcMaxUseableGrams !== undefined) row.iqc_max_useable_grams = patch.iqcMaxUseableGrams;
  if (patch.iqcMaxConcentrateGrams !== undefined) row.iqc_max_concentrate_grams = patch.iqcMaxConcentrateGrams;
  if (patch.iqcMaxInfusedThcMg !== undefined) row.iqc_max_infused_thc_mg = patch.iqcMaxInfusedThcMg;
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

/** IQC units already assigned to an employee in a quarter (vs 50-cap + 25-concentrate sub-cap). */
export async function iqcUnitsForEmployee(
  employeeId: string,
  quarterKey: string,
): Promise<{ total: number; concentrate: number }> {
  if (!isSupabaseServiceConfigured) return { total: 0, concentrate: 0 };
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("trade_sample_events")
    .select("unit_count, product_type")
    .eq("category", "iqc")
    .eq("quarter_key", quarterKey)
    .eq("employee_id", employeeId);
  const rows = (data as { unit_count: number; product_type: string }[] | null) ?? [];
  let total = 0;
  let concentrate = 0;
  for (const r of rows) {
    const u = Number(r.unit_count) || 0;
    total += u;
    if (r.product_type === "concentrate") concentrate += u;
  }
  return { total, concentrate };
}

function sumUnits(data: unknown): number {
  const rows = (data as { unit_count: number }[] | null) ?? [];
  return rows.reduce((s, r) => s + (Number(r.unit_count) || 0), 0);
}

export type QuarterUsage = {
  incomingByProcessor: { name: string; used: number; cap: number }[];
  outgoingByEmployee: { employeeId: string | null; name: string; used: number; cap: number }[];
  iqcByEmployee: { employeeId: string | null; name: string; used: number; concentrate: number; cap: number; concentrateCap: number }[];
};

/** Aggregate per-quarter usage for the insight dashboard (trade + IQC buckets). */
export async function quarterUsage(quarterKey: string, settings: SampleSettings): Promise<QuarterUsage> {
  const events = await listSampleEvents({ quarterKey, limit: 2000 });
  const incMap = new Map<string, number>();
  const outMap = new Map<string, { name: string; used: number }>();
  const iqcMap = new Map<string, { name: string; used: number; concentrate: number }>();
  for (const e of events) {
    if (e.category === "iqc") {
      const key = e.employee_id ?? e.employee_name ?? "(unknown)";
      const cur = iqcMap.get(key) ?? { name: e.employee_name ?? "(unknown)", used: 0, concentrate: 0 };
      cur.used += e.unit_count;
      if (e.product_type === "concentrate") cur.concentrate += e.unit_count;
      if (e.employee_name) cur.name = e.employee_name;
      iqcMap.set(key, cur);
      continue;
    }
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
    iqcByEmployee: [...iqcMap.entries()]
      .map(([employeeId, v]) => ({
        employeeId,
        name: v.name,
        used: v.used,
        concentrate: v.concentrate,
        cap: settings.iqcUnitsPerEmployee,
        concentrateCap: settings.iqcConcentrateSubcap,
      }))
      .sort((a, b) => b.used - a.used),
  };
}

export type RecordResult =
  | { ok: true; id: string; message: string }
  | { ok: false; error: string; blocked?: boolean };

/**
 * Record a sample event, HARD-ENFORCING the applicable quarterly cap.
 * The caller has already run parseRecordDraft (size caps + field validation);
 * here we tally the quarter and block if over cap. IQC events use the
 * two-part (50 total + 25 concentrate) cap; trade events use the single cap.
 */
export async function recordSampleEvent(
  rec: ParsedRecord,
  meta: { employeeName?: string | null; createdBy: string | null; importId?: string | null },
): Promise<RecordResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const settings = await getSampleSettings();

  let message: string;
  if (rec.category === "iqc") {
    const used = await iqcUnitsForEmployee(rec.employeeId ?? "", rec.quarterKey);
    const evaln = evaluateIqcCap({
      usedTotalUnits: used.total,
      usedConcentrateUnits: used.concentrate,
      addUnits: rec.unitCount,
      addIsConcentrate: rec.productType === "concentrate",
      settings,
    });
    if (evaln.block) return { ok: false, error: evaln.message, blocked: true };
    message = evaln.message;
  } else {
    let usedUnits = 0;
    if (rec.direction === "incoming") {
      usedUnits = await incomingUnitsForProcessor(rec.processorName ?? "", rec.quarterKey);
    } else {
      usedUnits = await outgoingUnitsForEmployee(rec.employeeId ?? "", rec.quarterKey);
    }
    const evaln = evaluateCap({ direction: rec.direction, usedUnits, addUnits: rec.unitCount, settings });
    if (evaln.block) return { ok: false, error: evaln.message, blocked: true };
    message = evaln.message;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("trade_sample_events")
    .insert({
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
      import_id: meta.importId ?? null,
      created_by: meta.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to record sample." };
  return { ok: true, id: (data as { id: string }).id, message };
}

// ---------------------------------------------------------------------------
// Sample JSON imports ("samples come to us like regular products, with its own
// json to upload"). We persist the uploaded batch, then the owner records +
// assigns the parsed lots out to employees.
// ---------------------------------------------------------------------------

export type SampleImport = {
  id: string;
  file_name: string | null;
  raw: unknown;
  content_sha256: string | null;
  lot_count: number;
  unit_count: number;
  notes: string | null;
  created_at: string;
};

export async function listSampleImports(limit = 50): Promise<SampleImport[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sample_json_imports")
    .select("id, file_name, raw, content_sha256, lot_count, unit_count, notes, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as SampleImport[] | null) ?? [];
}

export async function createSampleImport(args: {
  fileName: string | null;
  raw: unknown;
  lots: SampleJsonLot[];
  totalUnits: number;
  notes?: string | null;
  uploadedBy: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const hash = createHash("sha256").update(JSON.stringify(args.raw)).digest("hex");
  const { data, error } = await admin
    .from("sample_json_imports")
    .insert({
      file_name: args.fileName,
      raw: args.raw as never,
      content_sha256: hash,
      lot_count: args.lots.length,
      unit_count: args.totalUnits,
      notes: args.notes ?? null,
      uploaded_by: args.uploadedBy,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to save import." };
  return { ok: true, id: (data as { id: string }).id };
}

export async function getSampleImport(id: string): Promise<SampleImport | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sample_json_imports")
    .select("id, file_name, raw, content_sha256, lot_count, unit_count, notes, created_at")
    .eq("id", id)
    .maybeSingle();
  return (data as SampleImport | null) ?? null;
}
