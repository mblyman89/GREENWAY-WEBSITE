"use server";

/**
 * R50 S2c — "Rebuild Cultivera manifests" for one import (bible §1.3b).
 *
 *   applyRehomeAction    → re-plan ON THE SERVER from the import's stored workbooks + saved plan
 *                          inputs, refuse unless it is byte-for-byte the plan the manager previewed
 *                          (digest), then create the real manifests and move the lots (manifest_id
 *                          only). Re-runnable: an interrupted Apply resumes.
 *   rollbackRehomeAction → move lots back to the import manifest and delete the empty rebuilt
 *                          manifests (never one carrying work or a hand-placed lot).
 *
 * Both need inventory.manage + an attestation tick, and both are audited with control totals.
 * No accounting: migrated stock is opening inventory (bible §1.4, S2a).
 */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { armCultiveraAutoStart } from "@/lib/inventory/cultivera-auto-start";
import { applyRehome, loadRehomeSources, rollbackRehome } from "@/lib/inventory/cultivera-rehome-store";
import { REHOME_AUDIT, rehomeHref, rehomeSummaryText } from "@/lib/inventory/cultivera-rehome-ui-core";

function importIdFrom(formData: FormData): string {
  const id = String(formData.get("importId") ?? "").trim();
  if (!id) redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing import id."));
  return id;
}

export async function applyRehomeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = importIdFrom(formData);
  const digest = String(formData.get("digest") ?? "");
  if (String(formData.get("attest") ?? "") !== "1") {
    redirect(rehomeHref(importId, { error: "Tick the box to confirm you reviewed the plan before applying it." }));
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) redirect(rehomeHref(importId, { error: "Preview the plan first." }));
  let msg = "";
  let failed = false;
  try {
    const admin = createSupabaseAdminClient();
    const sources = await loadRehomeSources(admin, importId);
    const r = await applyRehome(admin, importId, sources, { actorId: session.userId, expectedDigest: digest });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: r.ok ? REHOME_AUDIT.applied : REHOME_AUDIT.applyProblems,
      entityType: "pos_import",
      entityId: importId,
      after: {
        runId: sources.runId,
        digest,
        ruleVersion: r.plan.manifests[0]?.row.raw_payload.executor_rule_version ?? null,
        controlTotals: r.before,
        created: r.created,
        reused: r.reused,
        moved: r.moved,
        skippedByGuard: r.skippedByGuard,
        eventsLogged: r.eventsLogged,
        exceptionCounts: r.plan.summary.exceptionCounts,
        warnings: r.warnings,
        problems: r.problems,
      },
    });
    msg = rehomeSummaryText(r);
    failed = !r.ok;
    // R74 S13: a successful Apply queues the automatic onboarding Start of this import's rebuilt
    // manifests (the every-minute worker runs it; the page's Start onboarding now runs it at once).
    if (r.ok) {
      try {
        await armCultiveraAutoStart(importId, session.userId);
        msg += " Onboarding starts automatically for the rebuilt manifests (see Automatic onboarding start below).";
      } catch (armErr) {
        failed = true;
        msg += ` But the automatic onboarding start could not be queued: ${armErr instanceof Error ? armErr.message : String(armErr)}. Press Start onboarding now below.`;
      }
    }
  } catch (err) {
    unstable_rethrow(err);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: REHOME_AUDIT.applyRefused,
      entityType: "pos_import",
      entityId: importId,
      after: { digest, error: err instanceof Error ? err.message : String(err) },
    });
    redirect(rehomeHref(importId, { error: err instanceof Error ? err.message : "Rebuild failed." }));
  }
  revalidatePath(`/admin/menu-imports/${importId}`);
  revalidatePath("/admin/inventory/intake");
  redirect(rehomeHref(importId, failed ? { error: msg } : { done: msg }));
}

export async function rollbackRehomeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = importIdFrom(formData);
  if (String(formData.get("attest") ?? "") !== "1") {
    redirect(rehomeHref(importId, { error: "Tick the box to confirm the rollback." }));
  }
  let msg = "";
  try {
    const r = await rollbackRehome(createSupabaseAdminClient(), importId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: REHOME_AUDIT.rolledBack,
      entityType: "pos_import",
      entityId: importId,
      after: r,
    });
    msg =
      `Moved ${r.movedBack} lot(s) back to the import manifest and removed ${r.deleted} rebuilt manifest(s).` +
      (r.keptNonEmpty > 0 ? ` Kept ${r.keptNonEmpty} that still hold a lot someone placed there.` : "") +
      (r.keptWithWork > 0 ? ` Kept ${r.keptWithWork} that carry drafts, reviews, documents or payments.` : "");
  } catch (err) {
    unstable_rethrow(err);
    redirect(rehomeHref(importId, { error: err instanceof Error ? err.message : "Rollback failed." }));
  }
  revalidatePath(`/admin/menu-imports/${importId}`);
  revalidatePath("/admin/inventory/intake");
  redirect(rehomeHref(importId, { done: msg }));
}
