"use server";

/**
 * R74 S35 - Batch Lookups console actions. Every one: inventory.manage,
 * audited, redirects back with a plain result line.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cancelManifestLookup, enqueueManifestLookup } from "@/lib/catalog/lookup-job-server";
import { readBatchControl, writeBatchControl } from "@/lib/ai/batch-control-server";
import { cancelGeminiBatch } from "@/lib/ai/gemini-batch-server";
import { loadBatchConsole, requeueFailedItems } from "@/lib/ai/batch-console-server";
import { BATCH_CONSOLE_PATH, BATCH_WAVE, isRateLimitFailure, planBatches, waveManifestIds, withJobPaused } from "@/lib/ai/batch-console-core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(tab: string, msg: string, bad = false): never {
  revalidatePath(BATCH_CONSOLE_PATH);
  redirect(`${BATCH_CONSOLE_PATH}?tab=${tab}&${bad ? "err" : "msg"}=${encodeURIComponent(msg.slice(0, 300))}`);
}

async function actor() {
  const s = await requirePermission("inventory.manage");
  return { userId: s.userId, email: s.email };
}

async function queueManifests(ids: string[], who: { userId: string | null; email: string | null }): Promise<string> {
  let created = 0;
  let products = 0;
  let already = 0;
  let nothing = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const r = await enqueueManifestLookup(id, who);
    if (r.ok && r.kind === "created") {
      created += 1;
      products += r.total;
    } else if (r.ok) already += 1;
    else if (r.code === "nothing") nothing += 1;
    else errors.push(r.message || r.code);
  }
  return `Queued ${created} manifest${created === 1 ? "" : "s"} (${products} products)${already ? `, ${already} already queued` : ""}${nothing ? `, ${nothing} with nothing left` : ""}${errors.length ? `. Problems: ${errors.slice(0, 2).join("; ")}` : ""}. The engine sends them to Gemini on the next minute.`;
}

/** Smart batching: queue the manifests that fill the next N gift-wrapped batches. */
export async function sendWaveAction(formData: FormData): Promise<void> {
  const who = await actor();
  const n = Math.min(40, Math.max(1, Number(formData.get("batches")) || BATCH_WAVE));
  const vendor = String(formData.get("vendor") ?? "").trim();
  const c = await loadBatchConsole();
  if (!c.ok) back("smart", c.error ?? "Could not read the queue.", true);
  const plan = planBatches(vendor ? c.plan.filter((m) => m.vendor === vendor) : c.plan);
  const ids = waveManifestIds(plan, n);
  if (ids.length === 0) back("smart", "Nothing is waiting to be looked up.", true);
  const msg = await queueManifests(ids, who);
  await recordAudit({ actorId: who.userId, actorEmail: who.email, action: "ai_batch.wave_sent", entityType: "ai_batches", entityId: null, after: { batches: n, vendor: vendor || null, manifests: ids.length } });
  back("smart", msg);
}

/** Queue exactly the manifests ticked in the plan table. */
export async function sendSelectedAction(formData: FormData): Promise<void> {
  const who = await actor();
  const ids = formData.getAll("m").map(String).filter((x) => UUID.test(x)).slice(0, 300);
  if (ids.length === 0) back("smart", "Tick at least one manifest first.", true);
  const msg = await queueManifests(ids, who);
  await recordAudit({ actorId: who.userId, actorEmail: who.email, action: "ai_batch.selected_sent", entityType: "ai_batches", entityId: null, after: { manifests: ids.length } });
  back("smart", msg);
}

/** Pause / resume the whole queue. Batches already at Gemini still finish and are filed. */
export async function setPausedAction(formData: FormData): Promise<void> {
  const who = await actor();
  const paused = formData.get("paused") === "1";
  const admin = createSupabaseAdminClient();
  const cur = await readBatchControl(admin);
  const ok = await writeBatchControl(admin, { ...cur, paused, note: String(formData.get("note") ?? "").slice(0, 200) || null }, who);
  if (!ok) back("monitor", "The pause switch could not be saved. Try again.", true);
  await recordAudit({ actorId: who.userId, actorEmail: who.email, action: paused ? "ai_batch.paused" : "ai_batch.resumed", entityType: "site_settings", entityId: null, after: { paused } });
  back("monitor", paused ? "Paused. Nothing new goes to Gemini; batches already sent still finish and are filed." : "Resumed. The next minute picks the queue back up.");
}

/** Pause / resume one manifest job. */
export async function setJobPausedAction(formData: FormData): Promise<void> {
  const who = await actor();
  const jobId = String(formData.get("jobId") ?? "");
  if (!UUID.test(jobId)) back("monitor", "That job is not valid.", true);
  const paused = formData.get("paused") === "1";
  const admin = createSupabaseAdminClient();
  const cur = await readBatchControl(admin);
  await writeBatchControl(admin, withJobPaused(cur, jobId, paused), who);
  await recordAudit({ actorId: who.userId, actorEmail: who.email, action: paused ? "ai_batch.job_paused" : "ai_batch.job_resumed", entityType: "lookup_jobs", entityId: jobId, after: { paused } });
  back("monitor", paused ? "That manifest is on hold." : "That manifest is back in the queue.");
}

export async function cancelJobAction(formData: FormData): Promise<void> {
  const who = await actor();
  const r = await cancelManifestLookup(String(formData.get("jobId") ?? ""), who);
  back("monitor", r.message, !r.ok);
}

/** Stop one Gemini batch (its products are requeued when the cancel lands). */
export async function cancelBatchAction(formData: FormData): Promise<void> {
  const who = await actor();
  const name = String(formData.get("name") ?? "");
  const r = await cancelGeminiBatch(name);
  await recordAudit({ actorId: who.userId, actorEmail: who.email, action: "ai_batch.canceled", entityType: "ai_batches", entityId: null, after: { name, ok: r.ok } });
  back("monitor", r.message, !r.ok);
}

/** Re-run failed products: scope "rate" = only 429 / spend-limit failures, "all" = every failure, or one item. */
export async function rerunFailedAction(formData: FormData): Promise<void> {
  const who = await actor();
  const scope = String(formData.get("scope") ?? "rate");
  const one = String(formData.get("itemId") ?? "");
  const c = await loadBatchConsole();
  const pick = UUID.test(one) ? c.failures.filter((f) => f.itemId === one) : c.failures.filter((f) => scope === "all" || isRateLimitFailure(f.error));
  if (pick.length === 0) back("monitor", "No failed products match.", true);
  const { items: n, jobs: jobCount, reopened } = await requeueFailedItems(pick.map((f) => f.itemId));
  await recordAudit({ actorId: who.userId, actorEmail: who.email, action: "ai_batch.failed_rerun", entityType: "lookup_job_items", entityId: null, after: { scope, items: n, jobs: jobCount } });
  back("monitor", `${n} failed product${n === 1 ? "" : "s"} queued again across ${jobCount} manifest${jobCount === 1 ? "" : "s"}${reopened < jobCount ? " (a manifest with another open lookup picks them up when that one finishes)" : ""}.`);
}
