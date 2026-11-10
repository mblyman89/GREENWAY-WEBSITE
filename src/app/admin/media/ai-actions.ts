"use server";

/**
 * src/app/admin/media/ai-actions.ts   (D221 M3 + M4)
 *
 * The buttons of the "AI closer look" panel and the review queue. Every
 * action needs media.manage and writes an audit row. None of them calls the
 * AI except "Describe now" on one picture; the run itself is done by the
 * /api/cron/media-describe worker.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { parseBudgetUsd } from "@/lib/media/media-describe-core";
import {
  startDescribeRun,
  setDescribeRunStatus,
  retryFailedDescribes,
  describeAssetNow,
} from "@/lib/media/media-describe-store";
import { parseReviewDecision, reviewPatch, type ReviewRow } from "@/lib/media/media-review-core";
import { safeAdminPath, appendQuery } from "@/lib/media/return-state-core";

const enc = encodeURIComponent;

function back(raw: FormDataEntryValue | null, fallback: string): string {
  return safeAdminPath(String(raw ?? ""), fallback);
}

/** Start the describe + SEO run (budget in dollars, optional follow-new). */
export async function startDescribeRunAction(formData: FormData) {
  const session = await requirePermission("media.manage");
  const budget = parseBudgetUsd(formData.get("budget_usd"));
  const followNew = String(formData.get("follow_new") ?? "") === "on";
  if (budget === null) redirect(`/admin/media?error=${enc("Enter a dollar budget greater than 0 (for example 5).")}`);
  const r = await startDescribeRun({ budgetUsd: budget, followNew, startedBy: session.userId });
  if (!r.ok) redirect(`/admin/media?error=${enc(r.error ?? "Could not start the run.")}`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "media.ai_run_started",
    entityType: "media_ai_run",
    entityId: r.run?.id ?? null,
    after: { budget_usd: budget, follow_new: followNew, total: r.run?.total ?? null, model: r.run?.model ?? null, detail: r.run?.detail ?? null },
  });
  revalidatePath("/admin/media");
  redirect(`/admin/media?saved=1`);
}

/** Pause / resume / stop the open run. Resume may raise the budget. */
export async function setDescribeRunStatusAction(formData: FormData) {
  const session = await requirePermission("media.manage");
  const id = String(formData.get("run_id") ?? "").trim();
  const want = String(formData.get("to") ?? "").trim();
  const status = want === "running" || want === "paused" || want === "cancelled" ? want : null;
  if (!id || !status) redirect(`/admin/media?error=${enc("Unknown run action.")}`);
  const rawBudget = formData.get("budget_usd");
  const patch: { budgetUsd?: number | null } = {};
  if (status === "running" && rawBudget !== null && String(rawBudget).trim() !== "") {
    const b = parseBudgetUsd(rawBudget);
    if (b === null) redirect(`/admin/media?error=${enc("Enter a dollar budget greater than 0.")}`);
    patch.budgetUsd = b;
  }
  const r = await setDescribeRunStatus(id, status, patch);
  if (!r.ok) redirect(`/admin/media?error=${enc(r.error ?? "Could not change the run.")}`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `media.ai_run_${status}`,
    entityType: "media_ai_run",
    entityId: id,
    after: { status, ...(patch.budgetUsd !== undefined ? { budget_usd: patch.budgetUsd } : {}) },
  });
  revalidatePath("/admin/media");
  redirect(`/admin/media?saved=1`);
}

/** Put failed pictures back in the queue. */
export async function retryFailedDescribesAction() {
  const session = await requirePermission("media.manage");
  const r = await retryFailedDescribes();
  if (!r.ok) redirect(`/admin/media?error=${enc(r.error ?? "Could not retry.")}`);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "media.ai_retry_failed", entityType: "media_asset", after: { n: r.n } });
  revalidatePath("/admin/media");
  redirect(`/admin/media?deleted=1&note=${enc(`${r.n} picture(s) put back in the AI queue.`)}`);
}

/** Describe one picture right now (its own page). */
export async function describeAssetNowAction(formData: FormData) {
  const session = await requirePermission("media.manage");
  const id = String(formData.get("id") ?? "").trim();
  const ret = back(formData.get("return_to"), `/admin/media/${id}`);
  if (!id) redirect(appendQuery(ret, { error: "Missing picture." }));
  const r = await describeAssetNow(id);
  if (!r.ok) redirect(appendQuery(ret, { error: r.error ?? "The AI could not describe this picture." }));
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "media.ai_described", entityType: "media_asset", entityId: id, after: { review: r.review } });
  revalidatePath(`/admin/media/${id}`);
  redirect(appendQuery(ret, { saved: "1" }));
}

/** One review decision: accept / product / logo / reject. */
export async function reviewMediaAction(formData: FormData) {
  const session = await requirePermission("media.manage");
  const id = String(formData.get("id") ?? "").trim();
  const decision = parseReviewDecision(formData.get("decision"));
  const ret = back(formData.get("return_to"), "/admin/media/review");
  if (!id || !decision) redirect(appendQuery(ret, { error: "Unknown review action." }));
  if (!isSupabaseServiceConfigured) redirect(appendQuery(ret, { error: "The database isn't configured on this deployment." }));
  const admin = createSupabaseAdminClient();

  const { data: row, error: rowErr } = await admin
    .from("media_assets")
    .select("id,status,usage_type,role,review_state,review_note,publish_reason,field_provenance")
    .eq("id", id)
    .maybeSingle();
  if (rowErr || !row) redirect(appendQuery(ret, { error: rowErr?.message ?? "Picture not found." }));

  let usedAsLogo = false;
  if (decision === "product") {
    const [v, b] = await Promise.all([
      admin.from("vendors").select("id", { count: "exact", head: true }).eq("logo_media_id", id),
      admin.from("brands").select("id", { count: "exact", head: true }).eq("logo_media_id", id),
    ]);
    if (v.error || b.error) redirect(appendQuery(ret, { error: (v.error ?? b.error)?.message ?? "Could not check the logo slots." }));
    usedAsLogo = (v.count ?? 0) + (b.count ?? 0) > 0;
  }

  const verdict = reviewPatch(row as unknown as ReviewRow, decision, session.userId, new Date().toISOString(), usedAsLogo);
  if (!verdict.ok) redirect(appendQuery(ret, { error: verdict.error }));

  // Compare-and-set on review_state so two people deciding at once cannot both win.
  const before = row as Record<string, unknown>;
  const { data: upd, error: updErr } = await admin
    .from("media_assets")
    .update(verdict.patch)
    .eq("id", id)
    .eq("review_state", String(before.review_state ?? ""))
    .select("id");
  if (updErr) redirect(appendQuery(ret, { error: updErr.message }));
  if (((upd as unknown[] | null) ?? []).length !== 1) redirect(appendQuery(ret, { error: "Someone else just decided this picture." }));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `media.review_${decision}`,
    entityType: "media_asset",
    entityId: id,
    before: { review_state: before.review_state, review_note: before.review_note, usage_type: before.usage_type, role: before.role, status: before.status },
    after: verdict.patch,
  });
  revalidatePath("/admin/media/review");
  revalidatePath("/admin/media");
  redirect(appendQuery(ret, { saved: "1" }));
}
