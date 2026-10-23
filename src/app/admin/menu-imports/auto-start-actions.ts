"use server";

/**
 * R74 S13 - the automatic onboarding Start for rebuilt Cultivera manifests.
 *
 *   startAutoNowAction  -> queue this import (if it is not queued yet) and run
 *                          one 200-second pass right now; the every-minute
 *                          worker carries on after the page is closed.
 *   pauseAutoStartAction -> stop the automatic start after the manifest it is
 *                          on (Start now resumes it).
 *
 * Both need inventory.manage (the same as the per-manifest Start) and are
 * audited (cultivera_onboarding.auto_start_*). Nothing here changes stock,
 * prices or the live menu: Start writes onboarding rows, KB rows and facts.
 */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { armCultiveraAutoStart, pauseCultiveraAutoStart, readAutoStart, runCultiveraAutoStart } from "@/lib/inventory/cultivera-auto-start";
import { AUTO_START_PRESS_BUDGET_MS, autoStartHref, autoStartReturnPage } from "@/lib/inventory/cultivera-auto-start-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function importIdFrom(formData: FormData): string {
  const id = String(formData.get("importId") ?? "").trim();
  if (!UUID_RE.test(id)) redirect("/admin/menu-imports?error=" + encodeURIComponent("Missing import id."));
  return id;
}

export async function startAutoNowAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = importIdFrom(formData);
  const page = autoStartReturnPage(formData.get("from"));
  let q: { done?: string; error?: string };
  try {
    const cur = await readAutoStart(createSupabaseAdminClient());
    const queued = cur.state.importIds.includes(importId.toLowerCase()) && !cur.state.paused && !cur.state.done;
    if (!queued) await armCultiveraAutoStart(importId, session.userId);
    const r = await runCultiveraAutoStart({ budgetMs: AUTO_START_PRESS_BUDGET_MS, actorId: session.userId, trigger: "press" });
    q = !r.ok ? { error: `Automatic start stopped: ${r.error}` } : r.run ? (r.run.failed > 0 ? { error: r.note } : { done: r.note }) : { done: r.note };
  } catch (err) {
    unstable_rethrow(err);
    q = { error: err instanceof Error ? err.message : "The automatic start failed." };
  }
  revalidatePath(`/admin/menu-imports/${importId}`);
  revalidatePath("/admin/inventory/drafts");
  redirect(autoStartHref(importId, page, q));
}

export async function pauseAutoStartAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const importId = importIdFrom(formData);
  const page = autoStartReturnPage(formData.get("from"));
  let q: { done?: string; error?: string };
  try {
    await pauseCultiveraAutoStart(session.userId);
    q = { done: "Automatic start paused. It stops after the manifest it is on. Press Start onboarding now to resume." };
  } catch (err) {
    unstable_rethrow(err);
    q = { error: err instanceof Error ? err.message : "Could not pause the automatic start." };
  }
  revalidatePath(`/admin/menu-imports/${importId}`);
  redirect(autoStartHref(importId, page, q));
}
