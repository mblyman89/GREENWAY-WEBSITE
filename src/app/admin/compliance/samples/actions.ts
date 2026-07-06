"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isOwnerRole } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import {
  parseRecordDraft,
  parseSampleJson,
  recordSampleEvent,
  updateSampleSettings,
  getSampleSettings,
  createSampleImport,
  type RecordDraft,
} from "@/lib/compliance/trade-samples";
import { getEmployee } from "@/lib/staffing/store";

const BASE = "/admin/compliance/samples";

export type SampleActionResult =
  | { ok: true; message?: string }
  | { ok: false; error?: string; errors?: string[]; blocked?: boolean };

/**
 * Record a sample event (trade incoming/outgoing OR IQC to an employee).
 * Validates per-unit size caps + fields via the pure core, then HARD-ENFORCES
 * the applicable quarterly cap in the store (trade: 30/employee; IQC: 50/
 * employee with a 25 concentrate sub-cap). Every event is audited. Customer
 * samples are impossible by design (no customer direction) per WAC 314-55-096(2).
 */
export async function recordSampleAction(draft: RecordDraft): Promise<SampleActionResult> {
  const session = await requirePermission("settings.manage");
  const settings = await getSampleSettings();

  const parsed = parseRecordDraft(draft, settings);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  // Resolve employee name for outgoing / IQC (for the ledger + audit).
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
      category: parsed.value.category,
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

export type SampleImportResult =
  | { ok: true; message: string; lotCount: number; totalUnits: number }
  | { ok: false; errors: string[] };

/**
 * Upload a sample JSON batch ("samples come to us like regular products, with
 * its own json to upload"). We parse the permissive shape, persist the batch,
 * and return a summary. The owner then records + assigns the parsed lots from
 * the ledger form. Nothing is auto-recorded (drafts-only rule).
 */
export async function uploadSampleJsonAction(input: {
  fileName?: string | null;
  content: string;
  notes?: string | null;
}): Promise<SampleImportResult> {
  const session = await requirePermission("settings.manage");

  const parsed = parseSampleJson(input.content);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  let raw: unknown;
  try {
    raw = JSON.parse(input.content);
  } catch {
    return { ok: false, errors: ["The file is not valid JSON."] };
  }

  const res = await createSampleImport({
    fileName: input.fileName?.trim() || null,
    raw,
    lots: parsed.lots,
    totalUnits: parsed.totalUnits,
    notes: input.notes?.trim() || null,
    uploadedBy: session.userId,
  });
  if (!res.ok) return { ok: false, errors: [res.error] };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "trade_sample.json_imported",
    entityType: "sample_json_import",
    entityId: res.id,
    after: { lot_count: parsed.lots.length, unit_count: parsed.totalUnits, file_name: input.fileName ?? null },
  });

  revalidatePath(BASE);
  const warn = parsed.warnings.length ? ` (${parsed.warnings.length} row(s) skipped)` : "";
  return {
    ok: true,
    message: `Imported ${parsed.lots.length} lot(s) / ${parsed.totalUnits} unit(s)${warn}.`,
    lotCount: parsed.lots.length,
    totalUnits: parsed.totalUnits,
  };
}

/** Owner-only: tune the sample settings (caps + enforcement) for BOTH buckets. */
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
      // IQC bucket — statutory ceilings are 50 / 25; the owner may only LOWER.
      iqcUnitsPerEmployee: Math.min(50, Math.trunc(numOr("iqc_units_per_employee", 50))),
      iqcConcentrateSubcap: Math.min(25, Math.trunc(numOr("iqc_concentrate_subcap", 25))),
      iqcMaxFlowerGrams: Math.min(1, numOr("iqc_max_flower_grams", 1)),
      iqcMaxUseableGrams: Math.min(1, numOr("iqc_max_useable_grams", 1)),
      iqcMaxConcentrateGrams: Math.min(1, numOr("iqc_max_concentrate_grams", 1)),
      iqcMaxInfusedThcMg: Math.min(10, numOr("iqc_max_infused_thc_mg", 10)),
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
