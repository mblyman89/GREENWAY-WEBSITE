"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createEquipmentAsset,
  updateEquipmentAsset,
  addServiceEvent,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_STATUSES,
  SERVICE_EVENT_TYPES,
  type EquipmentAssetInput,
  type EquipmentCategory,
  type EquipmentStatus,
  type ServiceEventType,
} from "@/lib/equipment/store";

const BASE = "/admin/equipment";
const CATS = new Set<string>(EQUIPMENT_CATEGORIES);
const STATUSES = new Set<string>(EQUIPMENT_STATUSES);
const EVENTS = new Set<string>(SERVICE_EVENT_TYPES);

function str(formData: FormData, key: string): string | null {
  const v = ((formData.get(key) as string | null) ?? "").trim();
  return v.length === 0 ? null : v;
}
function dateStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function dollarsToMinor(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function readAsset(formData: FormData): EquipmentAssetInput {
  const category = (str(formData, "category") ?? "other") as string;
  const status = (str(formData, "status") ?? "active") as string;
  return {
    asset_tag: str(formData, "asset_tag"),
    name: str(formData, "name") ?? "Untitled asset",
    category: (CATS.has(category) ? category : "other") as EquipmentCategory,
    manufacturer: str(formData, "manufacturer"),
    model: str(formData, "model"),
    serial_number: str(formData, "serial_number"),
    register_id: str(formData, "register_id"),
    location: str(formData, "location"),
    status: (STATUSES.has(status) ? status : "active") as EquipmentStatus,
    purchase_date: dateStr(formData, "purchase_date"),
    purchase_cost_minor: dollarsToMinor(formData, "purchase_cost_dollars"),
    warranty_expires: dateStr(formData, "warranty_expires"),
    requires_calibration: formData.get("requires_calibration") === "on",
    last_calibrated_on: dateStr(formData, "last_calibrated_on"),
    next_calibration_due: dateStr(formData, "next_calibration_due"),
    notes: str(formData, "notes"),
  };
}

export async function createEquipmentAssetAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const input = readAsset(formData);
  if (!input.name || input.name === "Untitled asset") {
    redirect(`${BASE}?error=${encodeURIComponent("Name is required.")}`);
  }
  const result = await createEquipmentAsset(input, session.userId);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "equipment.create",
    entityType: "equipment_asset",
    entityId: result.id,
    after: input,
  });
  revalidatePath(BASE);
  redirect(`${BASE}/${result.id}?created=1`);
}

export async function updateEquipmentAssetAction(id: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const input = readAsset(formData);
  const result = await updateEquipmentAsset(id, input, session.userId);
  if (!result.ok) redirect(`${BASE}/${id}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "equipment.update",
    entityType: "equipment_asset",
    entityId: id,
    after: input,
  });
  revalidatePath(`${BASE}/${id}`);
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?saved=1`);
}

export async function addServiceEventAction(assetId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const eventType = (str(formData, "event_type") ?? "service") as string;
  const result = await addServiceEvent(
    {
      assetId,
      eventType: (EVENTS.has(eventType) ? eventType : "service") as ServiceEventType,
      performedOn: dateStr(formData, "performed_on"),
      performedBy: str(formData, "performed_by"),
      costMinor: dollarsToMinor(formData, "cost_dollars"),
      note: str(formData, "note"),
      nextCalibrationDue: dateStr(formData, "next_calibration_due"),
    },
    session.userId,
  );
  if (!result.ok) redirect(`${BASE}/${assetId}?error=${encodeURIComponent(result.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "equipment.service",
    entityType: "equipment_asset",
    entityId: assetId,
    after: { eventType },
  });
  revalidatePath(`${BASE}/${assetId}`);
  redirect(`${BASE}/${assetId}?service=1`);
}
