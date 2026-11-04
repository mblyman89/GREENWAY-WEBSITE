/**
 * src/lib/ai/onboarding-batch-send-server.ts  (R74 S53)
 *
 * Server half of onboarding-batch-send-core.ts. Owner (Round 34): "when on
 * onboarding and I start a batch lookup, I need it to get sent to google
 * automatically, then it needs to auto update the counter in the Gemini box
 * on onboarding with an estimated time to completion".
 *
 *   autoSendForOnboarding  - after a press on Product Onboarding queues a
 *     delivery (or a vendor's deliveries): write the Mission Control switch
 *     (autoSendControl), log it in the message log, audit it, and kick one
 *     batch tick AFTER the response so the first batch leaves for Google
 *     within seconds (the every-minute cron carries on from there).
 *   loadOnboardingBatchStage - where THIS delivery's lookup is right now.
 *   loadVendorLookupScope / enqueueVendorFromOnboarding - "all products from
 *     that vendor": every delivery of the focused delivery's vendor that
 *     still has products in Needs review.
 *
 * Nothing here throws to the page or the action; a failure reads as "not
 * sent yet" and the manual Send in Mission Control still works.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { runAfterResponse } from "@/lib/after-response";
import { isUuid } from "@/lib/catalog/draft-deep-link-core";
import { readBatchControl, writeBatchControl } from "@/lib/ai/batch-control-server";
import { logBatchEvent } from "@/lib/ai/batch-events-server";
import { batchEngineOn, runGeminiBatchTick } from "@/lib/ai/gemini-batch-server";
import { measurePace, type BatchRowLite } from "@/lib/ai/batch-console-core";
import { enqueueManifestLookup } from "@/lib/catalog/lookup-job-server";
import {
  ONBOARDING_SEND_AUDIT,
  ONBOARDING_VENDOR_AUDIT,
  VENDOR_MAX_MANIFESTS,
  autoSendControl,
  onboardingBatchStage,
  type OnboardingStage,
  type StageBatch,
  type StageCounts,
} from "@/lib/ai/onboarding-batch-send-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Actor = { userId: string | null; email: string | null };
/** The kick after a press: well inside the 300 s function limit. */
const KICK_BUDGET_MS = 200_000;

export type AutoSendOutcome = { sent: boolean; sentence: string };

async function unsentItemCount(admin: Admin, jobIds: readonly string[]): Promise<number> {
  const { count, error } = await admin
    .from("lookup_job_items")
    .select("id", { count: "exact", head: true })
    .in("job_id", [...jobIds])
    .eq("status", "queued")
    .is("batch_id", null);
  if (error) return 0;
  return count ?? 0;
}

/** Send these lookups to Google now. Never throws. */
export async function autoSendForOnboarding(jobIds: readonly string[], actor: Actor): Promise<AutoSendOutcome> {
  const ids = [...new Set(jobIds.filter((j) => isUuid(j)))];
  if (ids.length === 0) return { sent: false, sentence: "Nothing to send." };
  if (!batchEngineOn()) {
    return { sent: false, sentence: "Queued. (The Google batch engine is off on this site, so the one-by-one lookup worker runs it instead.)" };
  }
  if (!isSupabaseServiceConfigured) return { sent: false, sentence: "The database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const unsent = await unsentItemCount(admin, ids);
    const cur = await readBatchControl(admin);
    const plan = autoSendControl(cur, { jobIds: ids, unsentItems: unsent });
    if (!plan.changed) return { sent: false, sentence: plan.sentence };
    const wrote = await writeBatchControl(admin, plan.next, actor);
    if (!wrote) return { sent: false, sentence: "Queued, but the send switch could not be saved. Press \"Send to Google now\" to try again." };
    await logBatchEvent(admin, {
      kind: "control",
      severity: "info",
      title: "Product Onboarding sent a lookup to Google",
      plain: plan.sentence,
      fix: null,
      actorEmail: actor.email,
    });
    await recordAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: ONBOARDING_SEND_AUDIT,
      entityType: "lookup_job",
      entityId: ids[0],
      after: { jobIds: ids, unsentItems: unsent, budgetAdded: plan.budgetAdded, resumed: plan.resumed, released: plan.released, mode: plan.next.mode },
    });
    runAfterResponse("onboarding-batch-send", () => runGeminiBatchTick({ budgetMs: KICK_BUDGET_MS }));
    return { sent: true, sentence: plan.sentence };
  } catch (err) {
    console.error("[onboarding-batch-send] auto-send failed:", err);
    return { sent: false, sentence: "Queued, but it could not be sent just now. Press \"Send to Google now\"." };
  }
}

/** The live stage of one delivery's lookup job (null = could not read). */
export async function loadOnboardingBatchStage(jobId: string, jobOpen: boolean, nowMs = Date.now()): Promise<OnboardingStage | null> {
  if (!isUuid(jobId) || !isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const items: { status: string; batch_id: string | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("lookup_job_items").select("status, batch_id").eq("job_id", jobId).order("id").range(from, from + 999);
      if (error) return null;
      const rows = (data as { status: string; batch_id: string | null }[] | null) ?? [];
      items.push(...rows);
      if (rows.length < 1000) break;
    }
    const counts: StageCounts = { total: items.length, unsent: 0, inBatch: 0, done: 0, failed: 0, canceled: 0 };
    const batchIds = new Set<string>();
    for (const it of items) {
      if (it.status === "done") counts.done += 1;
      else if (it.status === "failed") counts.failed += 1;
      else if (it.status === "canceled") counts.canceled += 1;
      else if (it.batch_id) {
        counts.inBatch += 1;
        batchIds.add(it.batch_id);
      } else counts.unsent += 1;
    }
    const [control, mine, recent] = await Promise.all([
      readBatchControl(admin),
      batchIds.size
        ? admin.from("ai_batches").select("state, created_at, submitted_at").in("id", [...batchIds].slice(0, 200))
        : Promise.resolve({ data: [] as StageBatch[], error: null }),
      admin
        .from("ai_batches")
        .select("state, families, items, answered, failed, prompt_tokens, output_tokens, search_queries, cost_cents, created_at, submitted_at, finished_at, ingested_at")
        .eq("state", "ingested")
        .order("created_at", { ascending: false })
        .limit(40),
    ]);
    const batches = ((mine.data as StageBatch[] | null) ?? []);
    const pace = measurePace(((recent.data as BatchRowLite[] | null) ?? []));
    return onboardingBatchStage({ counts, batches, control, jobId, jobOpen, turnaroundMin: pace.turnaroundMin, measured: pace.measured, nowMs });
  } catch (err) {
    console.error("[onboarding-batch-send] stage read failed:", err);
    return null;
  }
}

export type VendorLookupScope = { vendor: string; manifestIds: string[]; products: number };

/**
 * Every delivery of the focused delivery's vendor that still has products in
 * Needs review (the focused one included), newest first, capped.
 */
export async function loadVendorLookupScope(manifestId: string): Promise<VendorLookupScope | null> {
  if (!isUuid(manifestId) || !isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data: m, error } = await admin.from("inbound_manifests").select("id, vendor_id, vendor_label").eq("id", manifestId).maybeSingle();
    if (error || !m) return null;
    const me = m as { id: string; vendor_id: string | null; vendor_label: string | null };
    const vendor = (me.vendor_label ?? "").trim() || "this vendor";
    let q = admin.from("inbound_manifests").select("id").order("created_at", { ascending: false }).limit(400);
    if (me.vendor_id) q = q.eq("vendor_id", me.vendor_id);
    else if (me.vendor_label) q = q.eq("vendor_label", me.vendor_label);
    else return { vendor, manifestIds: [me.id], products: 0 };
    const { data: ms, error: e2 } = await q;
    if (e2) return null;
    const all = [...new Set([me.id, ...((ms as { id: string }[] | null) ?? []).map((r) => r.id)])];
    const per = new Map<string, number>();
    for (let i = 0; i < all.length; i += 100) {
      const chunk = all.slice(i, i + 100);
      for (let from = 0; ; from += 1000) {
        const { data, error: e3 } = await admin.from("catalog_product_drafts").select("manifest_id").in("manifest_id", chunk).eq("status", "draft").order("id").range(from, from + 999);
        if (e3) return null;
        const rows = (data as { manifest_id: string }[] | null) ?? [];
        for (const r of rows) per.set(r.manifest_id, (per.get(r.manifest_id) ?? 0) + 1);
        if (rows.length < 1000) break;
      }
    }
    const manifestIds = all.filter((id) => (per.get(id) ?? 0) > 0).slice(0, VENDOR_MAX_MANIFESTS);
    const products = manifestIds.reduce((s, id) => s + (per.get(id) ?? 0), 0);
    return { vendor, manifestIds, products };
  } catch (err) {
    console.error("[onboarding-batch-send] vendor scope failed:", err);
    return null;
  }
}

export type VendorEnqueueOutcome =
  | { ok: true; queued: number; already: number; products: number; manifests: number; vendor: string; sentence: string }
  | { ok: false; code: "nothing" | "error"; sentence: string };

/** "Look up all products from that vendor": queue every delivery, then send. */
export async function enqueueVendorFromOnboarding(manifestId: string, actor: Actor): Promise<VendorEnqueueOutcome> {
  const scope = await loadVendorLookupScope(manifestId);
  if (!scope) return { ok: false, code: "error", sentence: "Could not read this vendor's deliveries just now. Try again." };
  if (scope.manifestIds.length === 0) return { ok: false, code: "nothing", sentence: `Nothing from ${scope.vendor} is in Needs review.` };
  const jobIds: string[] = [];
  let queued = 0;
  let already = 0;
  let products = 0;
  const problems: string[] = [];
  for (const id of scope.manifestIds) {
    const r = await enqueueManifestLookup(id, actor);
    if (r.ok && r.kind === "created") {
      queued += 1;
      products += r.total;
      jobIds.push(r.jobId);
    } else if (r.ok) {
      already += 1;
      jobIds.push(r.jobId);
    } else if (r.code !== "nothing") problems.push(r.message);
  }
  if (jobIds.length === 0) {
    return problems.length
      ? { ok: false, code: "error", sentence: problems[0].slice(0, 200) }
      : { ok: false, code: "nothing", sentence: `Every product from ${scope.vendor} has already been looked up.` };
  }
  // The focused delivery first, then the rest.
  const focusFirst = [...jobIds];
  const send = await autoSendForOnboarding(focusFirst, actor);
  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: ONBOARDING_VENDOR_AUDIT,
    entityType: "inbound_manifest",
    entityId: manifestId,
    after: { vendor: scope.vendor, manifests: scope.manifestIds.length, queued, already, products, sent: send.sent },
  });
  const sentence =
    `${scope.vendor}: ${queued} deliver${queued === 1 ? "y" : "ies"} queued (${products} product${products === 1 ? "" : "s"})` +
    (already ? `, ${already} already running` : "") +
    `. ${send.sent ? "Sent to Google - " : ""}${send.sentence}` +
    (problems.length ? ` Problems: ${problems.slice(0, 2).join("; ")}` : "");
  return { ok: true, queued, already, products, manifests: scope.manifestIds.length, vendor: scope.vendor, sentence: sentence.slice(0, 400) };
}
