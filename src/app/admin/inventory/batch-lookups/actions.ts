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
import { cancelGeminiBatch, checkBatchesNow, deleteGeminiBatch, gemini, listGoogleBatches } from "@/lib/ai/gemini-batch-server";
import { loadBatchConsole, requeueFailedItems, stoppedItemIds } from "@/lib/ai/batch-console-server";
import { logBatchEvent } from "@/lib/ai/batch-events-server";
import { aiWebSearchModelId } from "@/lib/ai/provider";
import { resolveGeminiModel } from "@/lib/ai/gemini-models-core";
import { curlFor, explainGemini, googleStateKey, isGoogleOpen, validBatchName, type ConsoleCommand } from "@/lib/ai/gemini-batch-explain-core";
import { runVendorConfidenceAttach } from "@/lib/catalog/cultivera-confidence-server";
import { CONFIDENCE_TAB, parseAttachMode, type AttachMode } from "@/lib/catalog/cultivera-confidence-core";
import { BATCH_CONSOLE_PATH, BATCH_WAVE, MAX_BUDGET, isRateLimitFailure, planBatches, waveManifestIds, withJobPaused } from "@/lib/ai/batch-console-core";

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

/** Stop one Gemini batch. R74 S41: its unanswered products are set aside (not resent) until Re-run stopped. */
export async function cancelBatchAction(formData: FormData): Promise<void> {
  const who = await actor();
  const name = String(formData.get("name") ?? "");
  const tab = formData.get("tab") === "mission" ? "mission" : "monitor";
  const r = await cancelGeminiBatch(name, who.email);
  await recordAudit({ actorId: who.userId, actorEmail: who.email, action: "ai_batch.canceled", entityType: "ai_batches", entityId: null, after: { name, ok: r.ok } });
  back(tab, r.message, !r.ok);
}

// ─── R74 S41: Batch Mission Control ──────────────────────────────────────

const M = "mission";

/**
 * Send N batches (1 = the test batch). Sets the engine to "one at a time"
 * (manual) with N sends allowed, resumes it, and - when nothing is queued -
 * queues the manifests that fill the next N batches of 200. The cron sends
 * ONE batch per minute until the N are used up, then stops by itself.
 */
export async function allowBatchesAction(formData: FormData): Promise<void> {
  const who = await actor();
  const want = Math.min(MAX_BUDGET, Math.max(1, Math.floor(Number(formData.get("n")) || 1)));
  const c = await loadBatchConsole();
  if (!c.ok) back(M, c.error ?? "Could not read the queue.", true);
  if (!c.missionReady) back(M, "Migration 0299 is not applied yet. Run it in the Supabase SQL editor first (see the yellow box).", true);
  const queued = c.jobs.filter((j) => j.status === "queued" || j.status === "running").reduce((s, j) => s + j.queued, 0);
  let queuedMsg = `${queued} products were already waiting in line, so nothing new was added.`;
  if (queued === 0) {
    const ids = waveManifestIds(planBatches(c.plan), want);
    if (ids.length === 0) back(M, "Nothing is waiting to be looked up, so there is nothing to send.", true);
    queuedMsg = await queueManifests(ids, who);
  }
  const admin = createSupabaseAdminClient();
  const cur = await readBatchControl(admin);
  const ok = await writeBatchControl(admin, { ...cur, paused: false, mode: "manual", budget: want, note: null }, who);
  if (!ok) back(M, "The setting could not be saved. Try again.", true);
  await logBatchEvent(admin, { kind: "control", severity: "info", title: `You allowed ${want} batch${want === 1 ? "" : "es"} to go to Google`, plain: `The engine sends one batch (up to 200 products) on the next minute${want > 1 ? ", then one more each minute while there is room, until all " + want + " are sent" : ""}. Then it stops and waits for you. ${queuedMsg}`, fix: "Nothing. Watch the batch move along the pipeline below.", actorEmail: who.email });
  await recordAudit({ actorId: who.userId, actorEmail: who.email, action: "ai_batch.allowed", entityType: "site_settings", entityId: null, after: { budget: want } });
  back(M, `Allowed ${want} batch${want === 1 ? "" : "es"}. The first one goes to Google within about a minute.`);
}

/** One at a time (manual: only the batches you allow) or automatic (keeps the cap full). */
export async function setModeAction(formData: FormData): Promise<void> {
  const who = await actor();
  const mode = formData.get("mode") === "auto" ? "auto" : "manual";
  const admin = createSupabaseAdminClient();
  const cur = await readBatchControl(admin);
  await writeBatchControl(admin, { ...cur, mode, budget: mode === "manual" ? 0 : cur.budget }, who);
  await logBatchEvent(admin, { kind: "control", severity: "info", title: mode === "auto" ? "Switched to Automatic" : "Switched to One at a time", plain: mode === "auto" ? "The engine keeps sending batches by itself whenever there is room and products are queued." : "The engine only sends the batches you allow with the Send buttons.", fix: "Nothing.", actorEmail: who.email });
  back(M, mode === "auto" ? "Automatic: the engine now keeps the line full by itself." : "One at a time: nothing new goes to Google until you press a Send button.");
}

/**
 * The big red button. 1) pause + no sends allowed, 2) cancel every open
 * batch at Google - ours from the database AND any of ours Google still
 * lists as open, 3) stop every queued manifest. Answers Google already made
 * are still saved; nothing is resent until you say so.
 */
export async function stopEverythingAction(): Promise<void> {
  const who = await actor();
  const admin = createSupabaseAdminClient();
  const cur = await readBatchControl(admin);
  await writeBatchControl(admin, { ...cur, paused: true, mode: "manual", budget: 0, note: "Stop everything" }, who);
  const names = new Set<string>();
  const { data } = await admin.from("ai_batches").select("name, state").in("state", ["submitting", "pending", "running"]).limit(200);
  for (const b of (data as { name: string | null }[] | null) ?? []) if (b.name) names.add(b.name);
  const g = await listGoogleBatches(10);
  for (const r of g.rows) if (r.ours && isGoogleOpen(r.state)) names.add(r.name);
  let canceled = 0;
  const problems: string[] = [];
  for (const name of names) {
    const r = await cancelGeminiBatch(name, who.email);
    if (r.ok) canceled += 1;
    else problems.push(r.message);
  }
  const c = await loadBatchConsole();
  let jobs = 0;
  for (const j of c.jobs.filter((x) => x.status === "queued" || x.status === "running")) {
    const r = await cancelManifestLookup(j.id, who);
    if (r.ok) jobs += 1;
  }
  const msg = `Stopped. Paused the engine, asked Google to cancel ${canceled} batch${canceled === 1 ? "" : "es"}${g.ok ? "" : " (Google's list could not be read, so only batches in our records were cancelled)"} and stopped ${jobs} queued manifest${jobs === 1 ? "" : "s"}.${problems.length ? ` Problems: ${problems.slice(0, 2).join(" ")}` : ""}`;
  await logBatchEvent(admin, { kind: "control", severity: "warn", title: "You pressed Stop everything", plain: msg, fix: "Wait a few minutes until every batch shows Cancelled. Then press Send 1 test batch to start fresh.", actorEmail: who.email });
  await recordAudit({ actorId: who.userId, actorEmail: who.email, action: "ai_batch.stop_everything", entityType: "ai_batches", entityId: null, after: { canceled, jobs, problems: problems.length } });
  back(M, msg, problems.length > 0);
}

/** Put the products a stop / lost batch set aside back in line. */
export async function rerunStoppedAction(): Promise<void> {
  const who = await actor();
  const ids = await stoppedItemIds();
  if (ids.length === 0) back(M, "No stopped products are waiting.", true);
  const r = await requeueFailedItems(ids, "canceled");
  await logBatchEvent(createSupabaseAdminClient(), { kind: "control", severity: "info", title: `Put ${r.items} stopped products back in line`, plain: `They wait in the queue across ${r.jobs} manifests. They go to Google with the next batch you allow (or by themselves in Automatic).`, fix: "Press Send 1 test batch (or Allow) when ready.", actorEmail: who.email });
  back(M, `${r.items} stopped products are back in line. They go with the next batch you allow.`);
}

/** Check now: ask Google about every open batch immediately (no new sends). */
export async function checkNowAction(): Promise<void> {
  await actor();
  const r = await checkBatchesNow();
  if (!r.ok) back(M, r.error ?? "The check could not run (is the Gemini key set?).", true);
  back(M, `Asked Google about ${r.polled} open batch${r.polled === 1 ? "" : "es"}${r.ingested ? ` and saved ${r.ingested} answers` : ""}. Any news is in the Messages list.`);
}

/** Delete a finished batch at Google (frees Google's storage; our saved facts stay). */
export async function deleteBatchAction(formData: FormData): Promise<void> {
  const who = await actor();
  const r = await deleteGeminiBatch(String(formData.get("name") ?? ""), who.email);
  back(M, r.message, !r.ok);
}

/**
 * Ask Google: run one of the Gemini Batch API calls for the owner (the same
 * call as the terminal command shown) and keep Google's full reply in the
 * message log so it can be copied.
 */
export async function askGoogleAction(formData: FormData): Promise<void> {
  const who = await actor();
  const cmd = String(formData.get("cmd") ?? "list") as ConsoleCommand;
  if (!["list", "get", "cancel", "delete", "model"].includes(cmd)) back(M, "Pick a question.", true);
  let arg = String(formData.get("arg") ?? "").trim();
  if (cmd === "model") arg = arg || resolveGeminiModel(aiWebSearchModelId).id;
  if (cmd === "model" && !/^[a-z0-9.-]{3,80}$/.test(arg)) back(M, "That model name is not valid (example: gemini-2.5-flash).", true);
  if (["get", "cancel", "delete"].includes(cmd)) {
    if (/^[A-Za-z0-9_-]+$/.test(arg)) arg = `batches/${arg}`;
    if (!validBatchName(arg)) back(M, "Paste a batch name like batches/abc123 (copy it from the batch list).", true);
  }
  if (cmd === "cancel") {
    const r = await cancelGeminiBatch(arg, who.email);
    back(M, r.message, !r.ok);
  }
  if (cmd === "delete") {
    const r = await deleteGeminiBatch(arg, who.email);
    back(M, r.message, !r.ok);
  }
  const path = cmd === "list" ? "v1beta/batches?pageSize=100" : cmd === "get" ? `v1beta/${arg}` : `v1beta/models/${arg}`;
  const res = await gemini(path);
  const x = explainGemini(res.status, res.json ?? res.text);
  let summary = x.plain;
  if (res.ok && cmd === "list") {
    const list = await listGoogleBatches(1);
    const open = list.rows.filter((r) => isGoogleOpen(r.state));
    summary = `Google lists ${list.rows.length} batch${list.rows.length === 1 ? "" : "es"} on this key (first page): ${open.length} still open, ${list.rows.filter((r) => r.ours).length} made by this app.`;
  } else if (res.ok && cmd === "get") {
    const st = googleStateKey((res.json as { metadata?: { state?: unknown } } | null)?.metadata?.state);
    summary = `Google says this batch is ${st}.`;
  } else if (res.ok && cmd === "model") summary = `Google knows the model ${arg} and this key can use it.`;
  const id = await logBatchEvent(createSupabaseAdminClient(), { kind: "console", severity: res.ok ? "ok" : x.severity, httpStatus: res.status, batchName: cmd === "get" ? arg : null, title: `Ask Google (${cmd}${arg && cmd !== "list" ? ` ${arg}` : ""}): ${res.ok ? "answered" : x.title}`, plain: summary, fix: res.ok ? "Nothing. Copy the reply below if your developer asked for it." : x.fix, command: curlFor(cmd, arg), raw: res.text.slice(0, 40_000), actorEmail: who.email });
  revalidatePath(BATCH_CONSOLE_PATH);
  redirect(`${BATCH_CONSOLE_PATH}?tab=${M}${id ? `&event=${id}` : ""}&${res.ok ? "msg" : "err"}=${encodeURIComponent(`${res.ok ? "Google answered" : x.title}. ${id ? "The full reply is in the Ask Google box." : "Migration 0299 is needed to keep the full reply."}`.slice(0, 300))}#ask`);
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

/**
 * R74 S38: the Cultivera vendor confidence buttons. mode "confident" = every
 * fact at or above CULTIVERA_AUTO_ATTACH_MIN, "all" = every fact found,
 * "selected" = the ticked products (every fact). Approves only rows with a
 * strain type; the rest wait on the onboarding page for the pick.
 */
export async function attachVendorConfidenceAction(formData: FormData): Promise<void> {
  const who = await actor();
  const vendor = String(formData.get("vendor") ?? "").trim().slice(0, 120);
  const mode = parseAttachMode(formData.get("mode"));
  const view = String(formData.get("view") ?? "") === "unsure" ? "&view=unsure" : "";
  const to = (msg: string, bad: boolean): never => {
    revalidatePath(BATCH_CONSOLE_PATH);
    revalidatePath("/admin/inventory/drafts");
    redirect(`${BATCH_CONSOLE_PATH}?tab=${CONFIDENCE_TAB}&vendor=${encodeURIComponent(vendor)}${view}&${bad ? "err" : "msg"}=${encodeURIComponent(msg.slice(0, 400))}`);
  };
  if (!vendor || !mode) to("Pick a vendor and a button.", true);
  const draftIds = formData.getAll("d").map(String).filter((x) => UUID.test(x)).slice(0, 500);
  const r = await runVendorConfidenceAttach({ vendor, mode: mode as AttachMode, draftIds, actor: who });
  to(r.sentence, !r.ok);
}
