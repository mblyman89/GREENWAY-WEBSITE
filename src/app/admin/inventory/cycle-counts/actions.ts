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
// classifyAbc / summarizeOverdueCounts / loadIntelLots are deliberately no longer
// imported here. The overdue-cadence action that used them now refuses, and an
// import left behind would make re-enabling a count-creating path look like a
// one-line change with no new dependencies.

/**
 * REFUSED at the action layer too (slice books-23).
 *
 * Both create actions below lost their buttons when the counting screen became a
 * work queue instead of a place counts are born. Losing a button is not losing a
 * capability: an exported `"use server"` function keeps a stable action id and
 * remains reachable by a direct HTTP POST. These wrappers therefore call the
 * library, which refuses, and report the library's own words.
 *
 * The message is NOT written a second time here. `createCycleCount` owns the
 * refusal text; copying it into this file would create two strings that mean the
 * same thing until the day somebody edits one of them (standing rule 42).
 *
 * The attempt is recorded in the audit trail rather than dropped, because "who
 * tried to start a count outside the approval flow" is exactly the question the
 * Security Log exists to answer.
 */
async function refuseCycleCountCreation(kind: "manual" | "overdue"): Promise<never> {
  const session = await requirePermission("inventory.manage");

  // Call the real function so the message shown is the one it produced. Both
  // arguments are placeholders: it refuses before reading either of them.
  const result = await createCycleCount({ label: "", scopeNote: null }, session.userId);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.create_refused",
    entityType: "cycle_counts",
    entityId: null,
    after: { refused: true, kind, reason: result.ok ? "unexpectedly allowed" : result.error },
  });

  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts?error=${encodeURIComponent(result.error)}`);
  }

  // Unreachable while createCycleCount refuses. Kept and kept loud: if this is
  // ever reached, something re-enabled a path that creates count sessions
  // without the owner approving the scope (standing rule 40).
  redirect(
    "/admin/inventory/cycle-counts?error=" +
      encodeURIComponent(
        "A count was created outside the approval flow, which should be impossible. " +
          "Do not count against it. Use Inventory Auditing, and tell someone that this " +
          "message appeared.",
      ),
  );
}

/**
 * Task L, retired. This used to open a count scoped to the lots overdue under the
 * ABC cadence (A 30d / B 90d / C 180d). The cadence maths was the useful part and
 * it did not die with this action: Inventory Auditing proposes scope to the owner,
 * who approves it. What changed is who decides, not whether the system suggests.
 */
export async function createOverdueCycleCountAction() {
  await refuseCycleCountCreation("overdue");
}

export async function createCycleCountAction(formData: FormData) {
  void formData;
  await refuseCycleCountCreation("manual");
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

/**
 * REFUSED at the action layer too (slice books-23).
 *
 * `applyCycleCount()` itself now refuses — that is the real lock, because this
 * path used the service-role key and no database policy could stop it. This
 * layer exists so the refusal is reported to whoever clicked, in plain English,
 * BEFORE the shelf-moving code is even reached, and so it lands in the audit
 * trail as an attempt rather than as silence.
 *
 * `recordAudit` is called on the REFUSAL. That is deliberate: an attempt to
 * apply a count the old way is exactly the event the owner would want to see in
 * the Security Log, and a refusal that leaves no trace teaches nobody anything.
 */
export async function applyCycleCountAction(countId: string) {
  const session = await requirePermission("inventory.manage");

  const result = await applyCycleCount(countId, session.userId);

  // This is unconditional in practice — applyCycleCount always refuses now. It
  // is written as a branch rather than a hardcoded redirect so that the message
  // shown is the one the library actually produced, instead of a second copy of
  // it here that could drift out of step (standing rule 42).
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.apply_refused",
    entityType: "cycle_counts",
    entityId: countId,
    after: { refused: true, reason: result.ok ? "unexpectedly allowed" : result.error },
  });

  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=${encodeURIComponent(result.error)}`);
  }

  // Unreachable while applyCycleCount refuses. Kept, and kept honest, because a
  // guard that assumes it can never be wrong is standing rule 40: if this line
  // is ever reached, something re-enabled the old path and the owner should be
  // told loudly rather than quietly succeed.
  redirect(
    `/admin/inventory/cycle-counts/${countId}?error=` +
      encodeURIComponent(
        "The old apply-a-cycle-count path reported success, which should be impossible. " +
          "Nothing has been trusted. Do not use this screen to correct inventory — use " +
          "Inventory Auditing, and tell someone that this message appeared.",
      ),
  );
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
