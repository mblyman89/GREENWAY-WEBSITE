"use server";

/**
 * R74 S10 — "Put the email-found lots on their manifests" for one Cultivera import (Wave 2).
 *
 *   applyMailPlanAction    → re-plan ON THE SERVER (same transfer plan + S6 email match as the
 *                            coverage report), refuse unless it is byte-for-byte the plan the
 *                            manager previewed (digest), then create the emailed manifests and the
 *                            one "Unmatched Cultivera stock" manifest and move the lots (manifest_id
 *                            only). Re-runnable: an interrupted Apply resumes; a later harvest
 *                            upgrades lots off the unmatched manifest.
 *   rollbackMailPlanAction → move those lots back to the import manifest and delete the emailed /
 *                            unmatched manifests (never one carrying work or a hand-placed lot).
 *
 * Both need inventory.manage + an attestation tick; both are audited with control totals. No
 * accounting: migrated stock is opening inventory (kind cultivera-reconstructed).
 */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { armCultiveraAutoStart } from "@/lib/inventory/cultivera-auto-start";
import { applyMailPlan, loadRehomeSources, rollbackMailPlan } from "@/lib/pos/cultivera-mail-apply-store";
import { MAIL_APPLY_AUDIT, MAIL_APPLY_RULE_VERSION, coverageHref, mailApplySummaryText } from "@/lib/pos/cultivera-mail-apply-core";

function importIdFrom(formData: FormData): string {
  const id = String(formData.get("importId") ?? "").trim();
  if (!id) redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing import id."));
  return id;
}

export async function applyMailPlanAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = importIdFrom(formData);
  const digest = String(formData.get("digest") ?? "");
  if (String(formData.get("attest") ?? "") !== "1") {
    redirect(coverageHref(importId, { error: "Tick the box to confirm you reviewed the plan before applying it." }));
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) redirect(coverageHref(importId, { error: "Preview the plan first." }));
  let msg = "";
  let failed = false;
  try {
    const admin = createSupabaseAdminClient();
    const sources = await loadRehomeSources(admin, importId);
    const r = await applyMailPlan(admin, importId, sources, { actorId: session.userId, expectedDigest: digest });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: r.ok ? MAIL_APPLY_AUDIT.applied : MAIL_APPLY_AUDIT.applyProblems,
      entityType: "pos_import",
      entityId: importId,
      after: {
        runId: sources.runId,
        digest,
        ruleVersion: MAIL_APPLY_RULE_VERSION,
        controlTotals: r.before,
        created: r.created,
        reused: r.reused,
        lineageUpdated: r.lineageUpdated,
        moved: r.moved,
        skippedByGuard: r.skippedByGuard,
        removedEmpty: r.removedEmpty,
        eventsLogged: r.eventsLogged,
        lotsToEmail: r.plan.summary.lotsToEmail,
        lotsToUnmatched: r.plan.summary.lotsToUnmatched,
        exceptionCounts: r.plan.summary.exceptionCounts,
        warnings: r.warnings,
        problems: r.problems,
      },
    });
    msg = mailApplySummaryText(r);
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
      action: MAIL_APPLY_AUDIT.applyRefused,
      entityType: "pos_import",
      entityId: importId,
      after: { digest, error: err instanceof Error ? err.message : String(err) },
    });
    redirect(coverageHref(importId, { error: err instanceof Error ? err.message : "The email step failed." }));
  }
  revalidatePath(`/admin/menu-imports/${importId}`);
  revalidatePath("/admin/inventory/intake");
  redirect(coverageHref(importId, failed ? { error: msg } : { done: msg }));
}

export async function rollbackMailPlanAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = importIdFrom(formData);
  if (String(formData.get("attest") ?? "") !== "1") {
    redirect(coverageHref(importId, { error: "Tick the box to confirm the rollback." }));
  }
  let msg = "";
  try {
    const r = await rollbackMailPlan(createSupabaseAdminClient(), importId);
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: MAIL_APPLY_AUDIT.rolledBack, entityType: "pos_import", entityId: importId, after: r });
    msg =
      `Moved ${r.movedBack} lot(s) back to the import manifest and removed ${r.deleted} emailed/unmatched manifest(s). Run Rebuild manifests again to put them back on their received-date manifests.` +
      (r.keptNonEmpty > 0 ? ` Kept ${r.keptNonEmpty} that still hold a lot someone placed there.` : "") +
      (r.keptWithWork > 0 ? ` Kept ${r.keptWithWork} that carry drafts, reviews, documents or payments.` : "");
  } catch (err) {
    unstable_rethrow(err);
    redirect(coverageHref(importId, { error: err instanceof Error ? err.message : "Rollback failed." }));
  }
  revalidatePath(`/admin/menu-imports/${importId}`);
  revalidatePath("/admin/inventory/intake");
  redirect(coverageHref(importId, { done: msg }));
}
