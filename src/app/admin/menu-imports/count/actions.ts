"use server";

/**
 * R50 S11 — the Oct 30 count page's server actions (Cultivera menu upload pipeline, last step).
 *
 *   uploadCountAction  saves the counters' workbooks byte for byte, then shows the preview.
 *   applyCountAction   REBUILDS the preview on the server from the saved files (never trusts the
 *                      page), refuses unless it is exactly the plan the owner looked at (digest),
 *                      then writes the count adjustments (reason "count", strict, audited).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { applyCountPlan, buildCountPreview, isCountBatchId, saveCountUpload } from "@/lib/pos/cultivera-count-store";
import type { UncountedPolicy } from "@/lib/pos/cultivera-count-core";
import { isRosterId, loadRoster, saveRoster } from "@/lib/pos/count-roster-store";
import { pushEvent } from "@/lib/pos/count-roster-core";

const base = "/admin/menu-imports/count";
const err = (q: string, m: string) => `${base}?${q}${q ? "&" : ""}error=${encodeURIComponent(m)}`;
const policyOf = (v: unknown): UncountedPolicy => (v === "zero" ? "zero" : "leave");

export async function uploadCountAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const importId = String(formData.get("import_id") ?? "");
  if (!isSafeImportId(importId)) redirect(err("", "Pick the Cultivera import first."));
  const files = formData.getAll("workbooks").filter((f): f is File => f instanceof File && f.size > 0);
  let batchId = "";
  try {
    const index = await saveCountUpload(
      createSupabaseAdminClient(),
      importId,
      await Promise.all(files.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) }))),
      session.userId,
    );
    batchId = index.batchId;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "cultivera_count.uploaded",
      entityType: "pos_import",
      entityId: importId,
      after: { batchId, files: index.files.map((f) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256 })) },
    });
  } catch (e) {
    redirect(err(`import=${importId}`, e instanceof Error ? e.message : "Upload failed."));
  }
  redirect(`${base}?import=${importId}&batch=${batchId}`);
}

export async function applyCountAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const importId = String(formData.get("import_id") ?? "");
  const batchId = String(formData.get("batch_id") ?? "");
  const digest = String(formData.get("digest") ?? "");
  const policy = policyOf(formData.get("policy"));
  const confirmed = String(formData.get("confirm") ?? "") === "on";
  if (!isSafeImportId(importId) || !isCountBatchId(batchId)) redirect(err("", "Unknown import or upload."));
  const rq = String(formData.get("roster_id") ?? "");
  const q = `import=${importId}&batch=${batchId}&policy=${policy}${isRosterId(rq) ? `&roster=${rq}` : ""}`;
  if (!confirmed) redirect(err(q, "Tick the box to confirm you checked the preview."));

  let notice = "";
  try {
    const admin = createSupabaseAdminClient();
    const preview = await buildCountPreview(admin, importId, batchId, policy);
    if (!preview.canApply || !preview.plan) throw new Error(preview.refusals.join(" ") || "The count plan is blocked; nothing was written.");
    if (preview.digest !== digest) throw new Error("The count changed since you looked at the preview (a sale, another apply, or a different setting). Review it again.");
    const out = await applyCountPlan(admin, importId, preview.plan, session.userId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "cultivera_count.applied",
      entityType: "pos_import",
      entityId: importId,
      after: {
        batchId,
        digest,
        policy,
        countDate: preview.countDate,
        salesDay: preview.salesDay,
        salesRun: preview.sales.runId,
        snapshotPacific: preview.sales.snapshotPacific,
        books: preview.books,
        summary: preview.plan.summary,
        applied: out.applied,
        unitsUp: out.unitsUp,
        unitsDown: out.unitsDown,
        failed: out.failed,
        menuStockProblems: out.menuStockProblems.slice(0, 50),
      },
    });
    // R74 S50: the roster this upload was combined from is marked applied (its checklist goes green).
    const rosterId = String(formData.get("roster_id") ?? "");
    if (isRosterId(rosterId)) {
      const r = await loadRoster(admin, rosterId);
      if (r && r.mode === "live" && r.combined?.batchId === batchId) {
        const at = new Date().toISOString();
        r.applied = { at, batchId, adjustments: out.applied };
        pushEvent(r, at, session.email ?? "", `Count applied from upload ${batchId.slice(0, 8)}: ${out.applied} lot(s) adjusted.`);
        await saveRoster(admin, r);
      }
    }
    notice =
      out.failed.length === 0
        ? `Count applied: ${out.applied} lots adjusted (+${out.unitsUp} / -${out.unitsDown} units).`
        : `Count applied to ${out.applied} lots; ${out.failed.length} were refused and left unchanged (listed in the audit log). Review again: the refused lots show up as still to adjust.`;
    // R74 S32: say when the menu (Leafly + website) could not follow a lot.
    if (out.menuStockProblems.length > 0) {
      notice += ` Menu stock: ${out.menuStockProblems.length} lot(s) need attention. ${out.menuStockProblems.slice(0, 3).join(" ")}`.slice(0, 900);
    }
  } catch (e) {
    redirect(err(q, e instanceof Error ? e.message : "Apply failed."));
  }
  revalidatePath(base);
  redirect(`${base}?${q}&notice=${encodeURIComponent(notice)}`);
}
