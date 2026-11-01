"use server";

/**
 * CVL - the customer loyalty crawl's server actions.
 *
 *   startLoyaltyCrawlAction  -> crawler starts (or continues) the slow read-only crawl of every Cultivera customer.
 *   cancelLoyaltyCrawlAction -> stop between customers (Continue picks up where it stopped).
 *   applyLoyaltyAction       -> re-download + re-verify (sha256) ON THE SERVER, rebuild the rows, and apply them
 *                               in batches of 500 through apply_cultivera_loyalty (0336). A customer's Cultivera
 *                               balance is credited ONCE, ever (unique import key); running it again only
 *                               refreshes the Cultivera history shown on the customer page.
 *
 * Who: starting the crawl and applying need "menu.import" (owner, admin, manager): the same people who run the
 * Cultivera cutover harvest, because applying credits loyalty value to every customer at once.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { cancelLoyaltyRun, isValidLoyaltyRunId, loadLoyaltyRun, startLoyaltyRun } from "@/lib/customers/cultivera-loyalty-client";
import { applyBatches, buildApplyRows, sumResults, type ApplyResult } from "@/lib/customers/cultivera-loyalty-core";
import { applyLoyaltyBatch, ourCultiveraIds } from "@/lib/customers/cultivera-loyalty-store";

const PAGE = "/admin/customers/loyalty-import";
const withRun = (id: string, q = "") => `${PAGE}?run=${id}${q}`;
const err = (m: string) => "&error=" + encodeURIComponent(m);

export async function startLoyaltyCrawlAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const fresh = String(formData.get("fresh") ?? "") === "on";
  let runId = "";
  try {
    const out = await startLoyaltyRun(fresh);
    runId = out.runId;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: out.resumed ? "cultivera_loyalty.crawl_resumed" : "cultivera_loyalty.crawl_started",
      entityType: "cultivera_loyalty_run",
      entityId: runId,
      after: { fresh },
    });
  } catch (e) {
    redirect(`${PAGE}?error=${encodeURIComponent(e instanceof Error ? e.message : "Could not start the crawl.")}`);
  }
  redirect(withRun(runId));
}

export async function cancelLoyaltyCrawlAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const runId = String(formData.get("run_id") ?? "");
  if (!isValidLoyaltyRunId(runId)) redirect(`${PAGE}?error=${encodeURIComponent("Unknown run.")}`);
  try {
    await cancelLoyaltyRun(runId);
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "cultivera_loyalty.crawl_cancel_requested", entityType: "cultivera_loyalty_run", entityId: runId });
  } catch (e) {
    redirect(withRun(runId, err(e instanceof Error ? e.message : "Stop failed.")));
  }
  redirect(withRun(runId));
}

export async function applyLoyaltyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("menu.import");
  const runId = String(formData.get("run_id") ?? "");
  if (!isValidLoyaltyRunId(runId)) redirect(`${PAGE}?error=${encodeURIComponent("Unknown run.")}`);
  if (String(formData.get("confirm") ?? "") !== "on") {
    redirect(withRun(runId, err("Tick the box to confirm you reviewed the preview.")));
  }
  let total: ApplyResult | null = null;
  let failed: string | null = null;
  const done: ApplyResult[] = [];
  try {
    const loaded = await loadLoyaltyRun(runId);
    const { rows } = buildApplyRows(loaded.records, loaded.accrual);
    const ours = await ourCultiveraIds(rows.map((r) => r.external_id));
    const capturedAt = loaded.finishedAt ?? new Date().toISOString();
    for (const batch of applyBatches(rows, ours)) {
      done.push(await applyLoyaltyBatch(runId, capturedAt, session.userId, batch));
    }
    total = sumResults(done);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "cultivera_loyalty.applied",
      entityType: "cultivera_loyalty_run",
      entityId: runId,
      after: { ...total, files: loaded.files },
    });
  } catch (e) {
    failed = e instanceof Error ? e.message : "Apply failed.";
    // Batches already applied stay applied (each is its own transaction); pressing Apply again is safe.
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "cultivera_loyalty.apply_failed",
      entityType: "cultivera_loyalty_run",
      entityId: runId,
      after: { error: failed, batchesDone: done.length, partial: sumResults(done) },
    });
  }
  revalidatePath("/admin/customers");
  revalidatePath(PAGE);
  if (failed) redirect(withRun(runId, err(`${failed} (${done.length} batches were applied before it stopped; pressing Apply again is safe.)`)));
  const t = total!;
  redirect(withRun(runId, `&applied=${t.matched}&credited=${t.openingsCredited}&already=${t.openingsAlreadyDone}&enrolled=${t.accountsCreated}`));
}
