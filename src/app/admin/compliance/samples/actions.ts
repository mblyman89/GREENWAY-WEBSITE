"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isOwnerRole } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import {
  assignSampleToEmployee,
  listAvailableSampleLots,
  updateSampleSettings,
  getSampleSettings,
} from "@/lib/compliance/trade-samples";
import {
  buildAvailableSampleRows,
  parseAssignmentDraft,
  type AssignmentDraft,
} from "@/lib/compliance/employee-sample-core";
import { getEmployee } from "@/lib/staffing/store";

const BASE = "/admin/compliance/samples";

export type AssignSampleResult =
  | { ok: true; message: string; adjustmentWarning: string | null }
  | { ok: false; error?: string; errors?: string[]; blocked?: boolean };

/**
 * Task K — assign a sample lot (picked from the available-samples TABLE) to a
 * CURRENT paid employee, then mark it out of the system the CCRS-required way.
 *
 * Compliance chain (WAC 314-55-096):
 *   • only current PAID employees may receive a trade sample [096(1)(j)(i)]
 *   • per-unit size caps validated from the lot [096(1)(e)]
 *   • 30 units/employee/quarter HARD-ENFORCED server-side [096(1)(j)(vi)]
 *   • the outgoing ledger row records amount + product type + employee name
 *     [096(1)(j)(iv)-(v)]
 *   • a negative `employee_sample` inventory adjustment decrements the lot and
 *     exports to CCRS InventoryAdjustment.csv as reason "Other" with a detail
 *     naming the employee — the LCB-confirmed reporting shape.
 * Every assignment is audited. Customer samples are impossible by design.
 */
export async function assignSampleAction(draft: AssignmentDraft): Promise<AssignSampleResult> {
  const session = await requirePermission("settings.manage");
  const settings = await getSampleSettings();

  // Re-resolve the selected lot SERVER-SIDE (never trust the client row):
  // it must still be an active sample lot with units on hand.
  const lots = await listAvailableSampleLots();
  const { rows } = buildAvailableSampleRows(lots);
  const row = rows.find((r) => r.lotId === draft.lotId) ?? null;
  if (!row) {
    return { ok: false, error: "That sample is no longer available (already assigned or removed). Refresh the page." };
  }

  const parsed = parseAssignmentDraft(draft, row, settings);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  // Samples may only go to CURRENT paid employees [096(1)(j)(i)].
  const emp = await getEmployee(parsed.value.employeeId);
  if (!emp) return { ok: false, error: "Employee not found." };
  if (!emp.active) {
    return { ok: false, error: "Samples may only go to CURRENT paid employees (WAC 314-55-096(1)(j)(i))." };
  }

  const res = await assignSampleToEmployee(parsed.value, {
    employeeName: emp.full_name,
    createdBy: session.userId,
  });
  if (!res.ok) return { ok: false, error: res.error, blocked: res.blocked };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "trade_sample.assigned",
    entityType: "trade_sample_event",
    entityId: res.eventId,
    after: {
      lot_id: parsed.value.lotId,
      employee_id: parsed.value.employeeId,
      employee_name: emp.full_name,
      product_type: parsed.value.productType,
      unit_count: parsed.value.unitCount,
      quarter_key: parsed.value.quarterKey,
      from_sample_jar: parsed.value.fromSampleJar,
      source_product_name: parsed.value.sourceProductName,
      source_lot_ref: parsed.value.sourceLotRef,
      adjustment_ok: res.adjustmentWarning === null,
    },
  });

  revalidatePath(BASE);
  revalidatePath(`${BASE}/history`);
  revalidatePath("/admin/inventory");
  return { ok: true, message: res.message, adjustmentWarning: res.adjustmentWarning };
}

/** Owner-only: tune the trade sample settings (caps + enforcement). */
export async function updateSampleSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  if (!isOwnerRole(session.profile.role)) {
    redirect(`${BASE}?error=${encodeURIComponent("Only the store owner can change sample settings.")}`);
  }
  const numOr = (key: string, fallback: number) => {
    const n = Number(formData.get(key));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const res = await updateSampleSettings(
    {
      enforce: formData.get("enforce") === "on" || formData.get("enforce") === "true",
      hardBlock: formData.get("hard_block") === "on" || formData.get("hard_block") === "true",
      incomingUnitsPerQuarter: Math.trunc(numOr("incoming_units_per_quarter", 120)),
      outgoingUnitsPerEmployee: Math.trunc(numOr("outgoing_units_per_employee", 30)),
      maxFlowerGrams: numOr("max_flower_grams", 3.5),
      maxConcentrateGrams: numOr("max_concentrate_grams", 1),
      maxInfusedMg: numOr("max_infused_mg", 100),
      maxThcMgPerServing: numOr("max_thc_mg_per_serving", 10),
      notes: (formData.get("notes") as string | null)?.trim() || null,
    },
    session.userId,
  );
  if (!res.ok) redirect(`${BASE}?error=${encodeURIComponent(res.error)}`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "trade_sample.settings_updated",
    entityType: "trade_sample_settings",
    entityId: "singleton",
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=1`);
}
