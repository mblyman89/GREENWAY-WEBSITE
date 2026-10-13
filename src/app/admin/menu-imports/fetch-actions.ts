"use server";

/**
 * R50 S9 — "Fetch It All, Fuck Cultivera". The button's server actions.
 *
 *   startFetchAction   → crawler starts (or resumes) the read-only Phase A harvest; go to the run page.
 *   cancelFetchAction  → ask the running harvest to stop between calls (it resumes later).
 *   importFetchAction  → re-download + re-verify + re-assemble ON THE SERVER (never trusts the page),
 *                        gate with importDecision (GO, fresh, cutover guard / test mode), then runImport —
 *                        the exact path a manual upload takes, so intake, enrichment and the menu
 *                        behave identically. Nothing publishes automatically.
 *
 * No accounting, no payables: every Cultivera manifest is already paid (bible §3b).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { runImport } from "@/lib/pos/import-service";
import { readCutoverDone } from "@/lib/pos/cutover-guard";
import { cancelPosRun, isValidRunId, loadRunForImport, startPosRun } from "@/lib/pos/cultivera-fetch-client";
import { importDecision } from "@/lib/pos/cultivera-fetch-button-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { savePlanInputs } from "@/lib/inventory/cultivera-rehome-store";

const runHref = (id: string, q = "") => `/admin/menu-imports/fetch/${id}${q}`;
const err = (m: string) => "?error=" + encodeURIComponent(m);

export async function startFetchAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const fresh = String(formData.get("fresh") ?? "") === "on";
  let runId = "";
  try {
    const out = await startPosRun(fresh);
    runId = out.runId;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: out.resumed ? "cultivera_pos.fetch_resumed" : "cultivera_pos.fetch_started",
      entityType: "cultivera_pos_run",
      entityId: runId,
      after: { fresh },
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Could not start the fetch.";
    redirect("/admin/menu-imports" + err(m));
  }
  redirect(runHref(runId));
}

export async function cancelFetchAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const runId = String(formData.get("run_id") ?? "");
  if (!isValidRunId(runId)) redirect("/admin/menu-imports" + err("Unknown run."));
  try {
    await cancelPosRun(runId);
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "cultivera_pos.fetch_cancel_requested", entityType: "cultivera_pos_run", entityId: runId });
  } catch (e) {
    redirect(runHref(runId, err(e instanceof Error ? e.message : "Cancel failed.")));
  }
  redirect(runHref(runId));
}

export async function importFetchAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const runId = String(formData.get("run_id") ?? "");
  const isTest = String(formData.get("test_mode") ?? "") === "on";
  if (!isValidRunId(runId)) redirect("/admin/menu-imports" + err("Unknown run."));

  let importId = "";
  try {
    const loaded = await loadRunForImport(runId);
    const report = loaded.assembled?.report ?? null;
    const decision = importDecision({
      isTest,
      go: Boolean(report?.go),
      cutoverDone: await readCutoverDone(),
      ageMinutes: loaded.ageMinutes,
      filesVerified: loaded.verified,
    });
    if (!decision.allowed || !loaded.assembled) {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "cultivera_pos.import_refused",
        entityType: "cultivera_pos_run",
        entityId: runId,
        after: { isTest, reasons: [...decision.reasons, ...loaded.verifyProblems], go: report?.go ?? null },
      });
      throw new Error([...decision.reasons, ...loaded.verifyProblems].join(" ") || "Import refused.");
    }

    const result = await runImport({
      productsBuffer: loaded.assembled.productsBuffer,
      inventoriesBuffer: loaded.assembled.inventoriesBuffer,
      productsFilename: `cultivera-pos-${runId}-products.xlsx`,
      inventoriesFilename: `cultivera-pos-${runId}-inventories.xlsx`,
      uploadedBy: session.userId,
      isTest,
    });
    importId = result.import.id;

    // R50 S2c: keep the manifest plan's inputs (transfer index + links, no prices) next to the raw
    // workbooks, so "Rebuild manifests" works after the crawler prunes this run. Test imports make no
    // lots, so they have nothing to re-home. A failure here never hides the staged import: it is
    // audited, and Rebuild will refuse with the reason.
    let planInputs: { saved: boolean; key?: string; bytes?: number; sha256?: string; error?: string } | null = null;
    if (!isTest && loaded.planInputsFor) {
      try {
        planInputs = { saved: true, ...(await savePlanInputs(createSupabaseAdminClient(), loaded.planInputsFor(importId))) };
      } catch (e) {
        planInputs = { saved: false, error: e instanceof Error ? e.message : String(e) };
        console.error("[menu-imports] could not save manifest plan inputs:", e);
      }
    }

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "pos_import.staged",
      entityType: "pos_import",
      entityId: importId,
      after: {
        source: "cultivera_pos_fetch",
        runId,
        isTest,
        go: report?.go ?? null,
        checks: report?.checks.map((c) => `${c.id}:${c.pass ? "pass" : "FAIL"}`) ?? [],
        counts: report?.counts ?? null,
        controlTotals: report
          ? { units: report.reconcile.unitsRows, costValueCents: report.reconcile.costValueRowsCents }
          : null,
        files: loaded.files,
        // R50 S10: the manifest plan the S2 step will apply (counts only; the plan is rebuilt from the same run).
        manifestPlan: report?.manifestPlan
          ? {
              lots: report.manifestPlan.summary.lots,
              matched: report.manifestPlan.summary.matched,
              transfersUsed: report.manifestPlan.summary.transfersUsed,
              fallbackGroups: report.manifestPlan.summary.fallbackGroups,
              vendorByLink: report.manifestPlan.summary.matchedVendorByLink,
              alsoOn: report.manifestPlan.summary.lotsAlsoOn,
              link: report.manifestPlan.summary.link,
            }
          : null,
        planInputs,
        items: result.version.item_count,
        variants: result.version.variant_count,
        errors: result.transform.diagnosticCounts.errors,
      },
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Import failed.";
    console.error("[menu-imports] fetch import failed:", e);
    redirect(runHref(runId, err(m)));
  }
  revalidatePath("/admin/menu-imports");
  redirect(`/admin/menu-imports/${importId}?staged=1`);
}
