"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isOwnerRole } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import {
  parseRecordDraft,
  recordSampleEvent,
  updateSampleSettings,
  getSampleSettings,
  type RecordDraft,
} from "@/lib/compliance/trade-samples";
import { getEmployee } from "@/lib/staffing/store";

const BASE = "/admin/compliance/samples";

export type SampleActionResult =
  | { ok: true; message?: string }
  | { ok: false; error?: string; errors?: string[]; blocked?: boolean };

/**
 * Record a trade-sample event (incoming or outgoing). Validates per-unit size
 * caps + fields via the pure core, then HARD-ENFORCES the quarterly cap in the
 * store. Every event is audited. Customer samples are impossible by design
 * (no customer direction exists) per WAC 314-55-096(2).
 */
export async function recordSampleAction(draft: RecordDraft): Promise<SampleActionResult> {
  const session = await requirePermission("settings.manage");
  const settings = await getSampleSettings();

  const parsed = parseRecordDraft(draft, settings);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  // Resolve employee name for outgoing (for the ledger + audit).
  let employeeName: string | null = null;
  if (parsed.value.direction === "outgoing" && parsed.value.employeeId) {
    const emp = await getEmployee(parsed.value.employeeId);
    if (!emp) return { ok: false, error: "Employee not found." };
    if (!emp.active) return { ok: false, error: "Samples may only go to CURRENT paid employees (WAC 314-55-096(1)(i))." };
    employeeName = emp.full_name;
  }

  const res = await recordSampleEvent(parsed.value, { employeeName, createdBy: session.userId });
  if (!res.ok) {
    return { ok: false, error: res.error, blocked: res.blocked };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "trade_sample.recorded",
    entityType: "trade_sample_event",
    entityId: res.id,
    after: {
      direction: parsed.value.direction,
      product_type: parsed.value.productType,
      unit_count: parsed.value.unitCount,
      quarter_key: parsed.value.quarterKey,
      processor_name: parsed.value.processorName,
      employee_id: parsed.value.employeeId,
      from_sample_jar: parsed.value.fromSampleJar,
    },
  });

  revalidatePath(BASE);
  return { ok: true, message: res.message };
}

/** Owner-only: tune the sample settings (caps + enforcement). */
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
