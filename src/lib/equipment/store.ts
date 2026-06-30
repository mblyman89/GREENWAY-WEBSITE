/**
 * src/lib/equipment/store.ts
 *
 * Slice 35 (Feature R) — equipment asset registry. Tracks store hardware,
 * optionally mapped to a register, with a maintenance/calibration log.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export const EQUIPMENT_CATEGORIES = [
  "pos_terminal",
  "scale",
  "safe",
  "camera",
  "printer",
  "label_printer",
  "network",
  "display",
  "sensor",
  "vehicle",
  "other",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  pos_terminal: "POS terminal",
  scale: "Scale",
  safe: "Safe / vault",
  camera: "Camera",
  printer: "Printer",
  label_printer: "Label printer",
  network: "Network gear",
  display: "Display / monitor",
  sensor: "Sensor",
  vehicle: "Vehicle",
  other: "Other",
};

export const EQUIPMENT_STATUSES = ["active", "maintenance", "retired", "lost"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const SERVICE_EVENT_TYPES = [
  "service",
  "calibration",
  "repair",
  "inspection",
  "note",
  "retire",
] as const;
export type ServiceEventType = (typeof SERVICE_EVENT_TYPES)[number];

export type EquipmentAsset = {
  id: string;
  asset_tag: string | null;
  name: string;
  category: EquipmentCategory;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  register_id: string | null;
  location: string | null;
  status: EquipmentStatus;
  purchase_date: string | null;
  purchase_cost_minor: number | null;
  warranty_expires: string | null;
  requires_calibration: boolean;
  last_calibrated_on: string | null;
  next_calibration_due: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Asset enriched with derived flags + the register name (computed in store). */
export type EquipmentAssetView = EquipmentAsset & {
  register_name: string | null;
  /** Calibration is due (next_calibration_due is today or past). */
  calibration_due: boolean;
  /** Calibration is due within the next 30 days (but not yet past). */
  calibration_soon: boolean;
};

export type EquipmentServiceEvent = {
  id: string;
  asset_id: string;
  event_type: ServiceEventType;
  performed_on: string;
  performed_by: string | null;
  cost_minor: number | null;
  note: string | null;
  created_at: string;
};

const ASSET_COLS =
  "id, asset_tag, name, category, manufacturer, model, serial_number, register_id, location, status, purchase_date, purchase_cost_minor, warranty_expires, requires_calibration, last_calibrated_on, next_calibration_due, notes, created_at, updated_at";

/** Today (UTC) as YYYY-MM-DD — computed once per call, never in render. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function decorate(
  asset: EquipmentAsset,
  registerNames: Map<string, string>,
  today: string,
  soonCutoff: string,
): EquipmentAssetView {
  const due = Boolean(asset.next_calibration_due) && asset.next_calibration_due! <= today;
  const soon =
    !due &&
    Boolean(asset.next_calibration_due) &&
    asset.next_calibration_due! <= soonCutoff;
  return {
    ...asset,
    register_name: asset.register_id ? registerNames.get(asset.register_id) ?? null : null,
    calibration_due: due,
    calibration_soon: soon,
  };
}

export async function listEquipmentAssets(opts?: {
  status?: EquipmentStatus;
  category?: EquipmentCategory;
  q?: string;
}): Promise<EquipmentAssetView[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let query = admin.from("equipment_assets").select(ASSET_COLS).order("name", { ascending: true });
  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.category) query = query.eq("category", opts.category);
  if (opts?.q) {
    const like = `%${opts.q}%`;
    query = query.or(`name.ilike.${like},asset_tag.ilike.${like},serial_number.ilike.${like}`);
  }
  const { data } = await query;
  const assets = (data as EquipmentAsset[] | null) ?? [];

  // Resolve register names in one pass.
  const ids = Array.from(new Set(assets.map((a) => a.register_id).filter(Boolean))) as string[];
  const registerNames = new Map<string, string>();
  if (ids.length > 0) {
    const { data: regs } = await admin.from("registers").select("id, name").in("id", ids);
    for (const r of (regs as { id: string; name: string }[] | null) ?? []) {
      registerNames.set(r.id, r.name);
    }
  }

  const today = todayISO();
  const soonCutoff = addDaysISO(30);
  return assets.map((a) => decorate(a, registerNames, today, soonCutoff));
}

export async function getEquipmentAsset(id: string): Promise<EquipmentAssetView | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("equipment_assets").select(ASSET_COLS).eq("id", id).maybeSingle();
  const asset = data as EquipmentAsset | null;
  if (!asset) return null;
  const registerNames = new Map<string, string>();
  if (asset.register_id) {
    const { data: reg } = await admin
      .from("registers")
      .select("id, name")
      .eq("id", asset.register_id)
      .maybeSingle();
    const r = reg as { id: string; name: string } | null;
    if (r) registerNames.set(r.id, r.name);
  }
  return decorate(asset, registerNames, todayISO(), addDaysISO(30));
}

export type EquipmentAssetInput = {
  asset_tag: string | null;
  name: string;
  category: EquipmentCategory;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  register_id: string | null;
  location: string | null;
  status: EquipmentStatus;
  purchase_date: string | null;
  purchase_cost_minor: number | null;
  warranty_expires: string | null;
  requires_calibration: boolean;
  last_calibrated_on: string | null;
  next_calibration_due: string | null;
  notes: string | null;
};

function patchFrom(input: EquipmentAssetInput): Record<string, unknown> {
  return {
    asset_tag: input.asset_tag,
    name: input.name,
    category: input.category,
    manufacturer: input.manufacturer,
    model: input.model,
    serial_number: input.serial_number,
    register_id: input.register_id,
    location: input.location,
    status: input.status,
    purchase_date: input.purchase_date,
    purchase_cost_minor: input.purchase_cost_minor,
    warranty_expires: input.warranty_expires,
    requires_calibration: input.requires_calibration,
    last_calibrated_on: input.last_calibrated_on,
    next_calibration_due: input.next_calibration_due,
    notes: input.notes,
  };
}

export async function createEquipmentAsset(
  input: EquipmentAssetInput,
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("equipment_assets")
    .insert({ ...patchFrom(input), created_by: actorId, updated_by: actorId })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateEquipmentAsset(
  id: string,
  input: EquipmentAssetInput,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("equipment_assets")
    .update({ ...patchFrom(input), updated_by: actorId })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listServiceEvents(assetId: string): Promise<EquipmentServiceEvent[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("equipment_service_events")
    .select("id, asset_id, event_type, performed_on, performed_by, cost_minor, note, created_at")
    .eq("asset_id", assetId)
    .order("performed_on", { ascending: false });
  return (data as EquipmentServiceEvent[] | null) ?? [];
}

export async function addServiceEvent(
  input: {
    assetId: string;
    eventType: ServiceEventType;
    performedOn: string | null;
    performedBy: string | null;
    costMinor: number | null;
    note: string | null;
    nextCalibrationDue?: string | null;
  },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const performedOn = input.performedOn || todayISO();
  const { error } = await admin.from("equipment_service_events").insert({
    asset_id: input.assetId,
    event_type: input.eventType,
    performed_on: performedOn,
    performed_by: input.performedBy,
    cost_minor: input.costMinor,
    note: input.note,
    actor_id: actorId,
  });
  if (error) return { ok: false, error: error.message };

  // A calibration/inspection event updates the asset's calibration dates.
  if (input.eventType === "calibration" || input.eventType === "inspection") {
    const patch: Record<string, unknown> = { last_calibrated_on: performedOn, updated_by: actorId };
    if (input.nextCalibrationDue) patch.next_calibration_due = input.nextCalibrationDue;
    await admin.from("equipment_assets").update(patch).eq("id", input.assetId);
  }
  if (input.eventType === "retire") {
    await admin
      .from("equipment_assets")
      .update({ status: "retired", updated_by: actorId })
      .eq("id", input.assetId);
  }
  return { ok: true };
}

export type EquipmentSummary = {
  total: number;
  active: number;
  maintenance: number;
  retired: number;
  calibrationDue: number;
  calibrationSoon: number;
  mappedToRegister: number;
};

export function summarizeEquipment(assets: EquipmentAssetView[]): EquipmentSummary {
  return {
    total: assets.length,
    active: assets.filter((a) => a.status === "active").length,
    maintenance: assets.filter((a) => a.status === "maintenance").length,
    retired: assets.filter((a) => a.status === "retired").length,
    calibrationDue: assets.filter((a) => a.calibration_due).length,
    calibrationSoon: assets.filter((a) => a.calibration_soon).length,
    mappedToRegister: assets.filter((a) => a.register_id).length,
  };
}
