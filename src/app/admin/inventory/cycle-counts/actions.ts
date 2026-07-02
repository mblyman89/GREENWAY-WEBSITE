"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createCycleCount,
  recordLineCount,
  applyCycleCount,
  cancelCycleCount,
  bumpLineCount,
  getCycleCount,
  getCycleCountSheetLines,
} from "@/lib/inventory/cycle-counts";
import {
  buildImportPreview,
  type ImportPreview,
  type ParsedSheetRow,
} from "@/lib/inventory/cycle-count-sheet-core";

export async function createCycleCountAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const label = (formData.get("label") as string | null)?.trim() ?? "";
  const scopeNote = (formData.get("scope_note") as string | null)?.trim() || null;
  if (!label) redirect("/admin/inventory/cycle-counts?error=label");

  const result = await createCycleCount({ label, scopeNote }, session.userId);
  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts?error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.create",
    entityType: "cycle_counts",
    entityId: result.id,
    after: { label },
  });
  revalidatePath("/admin/inventory/cycle-counts");
  redirect(`/admin/inventory/cycle-counts/${result.id}`);
}

export async function recordLineCountAction(countId: string, lineId: string, formData: FormData) {
  await requirePermission("inventory.manage");
  const raw = formData.get("counted_qty");
  const note = (formData.get("note") as string | null)?.trim() || null;
  const countedQty = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(countedQty) || countedQty < 0) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=qty`);
  }
  const result = await recordLineCount({ lineId, countedQty, note });
  revalidatePath(`/admin/inventory/cycle-counts/${countId}`);
  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/admin/inventory/cycle-counts/${countId}?ok=counted`);
}

/**
 * Barcode scan → add one (or N) units to a line's physical count (Slice 68).
 * Returns a JSON-friendly result for the client scanner (no redirect) so the
 * operator keeps scanning without a page reload.
 */
export async function scanBumpLineAction(input: {
  countId: string;
  lineId: string;
  by?: number;
}): Promise<{ ok: true; countedQty: number } | { ok: false; error: string }> {
  const session = await requirePermission("inventory.manage");
  const by = Number.isFinite(input.by) ? Number(input.by) : 1;
  const result = await bumpLineCount({ lineId: input.lineId, by });
  if (!result.ok) return { ok: false, error: result.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.scan",
    entityType: "cycle_count_lines",
    entityId: input.lineId,
    after: { by, countedQty: result.countedQty },
  });
  revalidatePath(`/admin/inventory/cycle-counts/${input.countId}`);
  return { ok: true, countedQty: result.countedQty };
}

export async function applyCycleCountAction(countId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await applyCycleCount(countId, session.userId);
  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.apply",
    entityType: "cycle_counts",
    entityId: countId,
    after: { adjustments_posted: result.applied },
  });
  revalidatePath(`/admin/inventory/cycle-counts/${countId}`);
  revalidatePath("/admin/inventory");
  redirect(`/admin/inventory/cycle-counts/${countId}?ok=applied`);
}

export async function cancelCycleCountAction(countId: string) {
  const session = await requirePermission("inventory.manage");
  const result = await cancelCycleCount(countId);
  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.cancel",
    entityType: "cycle_counts",
    entityId: countId,
  });
  revalidatePath(`/admin/inventory/cycle-counts/${countId}`);
  redirect("/admin/inventory/cycle-counts?ok=cancelled");
}

/* --------------------------------------------------------------------------
 * Scan-to-Excel round trip (Beautification B5)
 *
 * previewCountSheetAction: parse an uploaded .xlsx/.csv scan sheet and return a
 *   NON-DESTRUCTIVE preview (matched / changed / unmatched / invalid) so the
 *   operator can validate before anything is written. No DB changes here.
 *
 * applyCountSheetAction: after the operator approves, write the matched counts
 *   into the OPEN count via recordLineCount (same path as manual entry, so
 *   variance + caches stay correct). Guarded: session must still be open.
 * ------------------------------------------------------------------------ */

const SHEET_MAX_BYTES = 8 * 1024 * 1024; // 8 MB — plenty for a count sheet.

/** Parse an uploaded workbook buffer into plain rows (first sheet). */
function parseSheetBuffer(buffer: Buffer): ParsedSheetRow[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<ParsedSheetRow>(sheet, { defval: "", raw: false });
}

export type CountSheetPreviewResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; error: string };

export async function previewCountSheetAction(
  countId: string,
  formData: FormData,
): Promise<CountSheetPreviewResult> {
  await requirePermission("inventory.manage");
  const session = await getCycleCount(countId);
  if (!session) return { ok: false, error: "Count session not found." };
  if (session.status !== "open") return { ok: false, error: "This count is not open — you can only import into an open count." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a filled count sheet (.xlsx or .csv) to import." };
  }
  if (file.size > SHEET_MAX_BYTES) {
    return { ok: false, error: `${file.name} exceeds 8 MB.` };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseSheetBuffer(buffer);
    if (rows.length === 0) {
      return { ok: false, error: "No rows found in the file. Make sure it has a header row and a Counted Qty column." };
    }
    const lines = await getCycleCountSheetLines(countId);
    const preview = buildImportPreview(lines, rows);
    if (preview.matched === 0 && preview.unmatched === 0 && preview.invalid === 0) {
      return { ok: false, error: "No Counted Qty values found. Fill the Counted Qty column, then import again." };
    }
    return { ok: true, preview };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not read the file." };
  }
}

export type CountSheetApplyResult =
  | { ok: true; applied: number; failed: number }
  | { ok: false; error: string };

/**
 * Apply approved counts from a preview. The client sends only the MATCHED rows
 * it approved: [{ lineId, countedQty }]. Re-validated server-side against the
 * open session; each write goes through recordLineCount (blind-count safe).
 */
export async function applyCountSheetAction(
  countId: string,
  entries: { lineId: string; countedQty: number }[],
): Promise<CountSheetApplyResult> {
  const session = await requirePermission("inventory.manage");
  const count = await getCycleCount(countId);
  if (!count) return { ok: false, error: "Count session not found." };
  if (count.status !== "open") return { ok: false, error: "This count is not open." };

  const clean = (entries ?? []).filter(
    (e) => e && typeof e.lineId === "string" && Number.isFinite(e.countedQty) && e.countedQty >= 0,
  );
  if (clean.length === 0) return { ok: false, error: "Nothing to apply." };

  // Guard: only accept line ids that actually belong to THIS open count.
  const validLineIds = new Set((await getCycleCountSheetLines(countId)).map((l) => l.lineId));

  let applied = 0;
  let failed = 0;
  for (const e of clean) {
    if (!validLineIds.has(e.lineId)) {
      failed += 1;
      continue;
    }
    const res = await recordLineCount({ lineId: e.lineId, countedQty: e.countedQty, note: "Imported from scan sheet" });
    if (res.ok) applied += 1;
    else failed += 1;
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.sheet_import",
    entityType: "cycle_counts",
    entityId: countId,
    after: { applied, failed },
  });
  revalidatePath(`/admin/inventory/cycle-counts/${countId}`);
  return { ok: true, applied, failed };
}
