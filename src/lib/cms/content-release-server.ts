/**
 * R46-S2: RELEASES - the I/O side. Decisions live in content-release-core.ts.
 *
 * A release is one content_releases row plus one content_schedule row per
 * item (release_id set). Scheduling a release flips every held item to
 * 'pending' at the release time, so the SAME 5-minute cron that runs single
 * schedules runs release items too (CAS claim, retries, audit), and
 * settleRelease() marks the release published once nothing is left open.
 *
 * "Publish now" runs every item immediately through applyScheduledChange
 * (the same publish functions as the editor buttons). Each item is CLAIMED
 * first (held/pending -> running, compare-and-swap) so a cron tick that
 * lands at the same moment cannot double-apply it.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import {
  canDo,
  itemStateFor,
  planAddItem,
  type ReleaseOp,
  type ReleaseStatus,
} from "./content-release-core";
import type { ScheduleAction, ScheduleTargetKind } from "./content-schedule-core";
import {
  applyScheduledChange,
  isMissingScheduleSchema,
  revalidateAfterScheduledChanges,
  settleRelease,
  SCHEDULE_MIGRATION_HINT,
} from "./content-schedule-server";

export type ReleaseRow = {
  id: string;
  name: string;
  note: string | null;
  status: ReleaseStatus;
  run_at: string | null;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

const RCOLS = "id,name,note,status,run_at,created_by,published_at,created_at,updated_at";

type Result = { error?: string };

function db() {
  return createSupabaseAdminClient();
}

/** Open releases + those finished in the last 30 days. Never throws. */
export async function listReleases(): Promise<ReleaseRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await db()
    .from("content_releases")
    .select(RCOLS)
    .or(`status.in.(draft,scheduled),updated_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    if (!isMissingScheduleSchema(error)) console.error("[content-release] list failed:", error.message);
    return [];
  }
  return (data as ReleaseRow[] | null) ?? [];
}

async function getRelease(id: string): Promise<{ row?: ReleaseRow; error?: string }> {
  const { data, error } = await db().from("content_releases").select(RCOLS).eq("id", id).maybeSingle();
  if (error) return { error: isMissingScheduleSchema(error) ? SCHEDULE_MIGRATION_HINT : error.message };
  if (!data) return { error: "That release no longer exists." };
  return { row: data as ReleaseRow };
}

async function guard(id: string, op: ReleaseOp): Promise<{ row?: ReleaseRow; error?: string }> {
  const r = await getRelease(id);
  if (!r.row) return r;
  if (!canDo(r.row.status, op)) return { error: `This release is ${r.row.status}, so it can't be changed.` };
  return r;
}

export async function createRelease(name: string, note: string | null, createdBy: string | null): Promise<{ id?: string; error?: string }> {
  if (!isSupabaseServiceConfigured) return { error: "Storage not configured." };
  const { data, error } = await db()
    .from("content_releases")
    .insert({ name, note, status: "draft", created_by: createdBy })
    .select("id")
    .single();
  if (error) return { error: isMissingScheduleSchema(error) ? SCHEDULE_MIGRATION_HINT : error.message };
  return { id: (data as { id: string }).id };
}

export async function addReleaseItem(
  releaseId: string,
  item: { kind: ScheduleTargetKind; key: string; action: ScheduleAction; label: string | null },
  createdBy: string | null,
): Promise<Result & { outcome?: "noop" | "insert" | "replace" }> {
  const g = await guard(releaseId, "add_item");
  if (!g.row) return { error: g.error };
  const admin = db();
  const { data: existing, error: exErr } = await admin
    .from("content_schedule")
    .select("id,target_kind,target_key,action,status")
    .eq("release_id", releaseId);
  if (exErr) return { error: exErr.message };
  const rows = (existing ?? []) as { id: string; target_kind: ScheduleTargetKind; target_key: string; action: ScheduleAction; status: string }[];
  const plan = planAddItem(rows, { kind: item.kind, key: item.key, action: item.action });
  if (plan.kind === "noop") return { outcome: "noop" };
  if (plan.kind === "full") return { error: "A release can hold up to 40 changes. Make a second release for the rest." };
  if (plan.kind === "replace") {
    const old = rows.filter(
      (r) => r.target_kind === item.kind && r.target_key === item.key && (r.status === "held" || r.status === "pending"),
    );
    for (const o of old) await admin.from("content_schedule").update({ status: "cancelled" }).eq("id", o.id).in("status", ["held", "pending"]);
  }
  const state = itemStateFor(g.row);
  const { error } = await admin.from("content_schedule").insert({
    target_kind: item.kind,
    target_key: item.key,
    target_label: item.label ? item.label.slice(0, 200) : null,
    action: item.action,
    run_at: state.run_at,
    status: state.status,
    release_id: releaseId,
    created_by: createdBy,
  });
  if (error) return { error: error.message };
  return { outcome: plan.kind };
}

export async function removeReleaseItem(releaseId: string, itemId: string): Promise<Result> {
  const g = await guard(releaseId, "remove_item");
  if (!g.row) return { error: g.error };
  const { data, error } = await db()
    .from("content_schedule")
    .update({ status: "cancelled" })
    .eq("id", itemId)
    .eq("release_id", releaseId)
    .in("status", ["held", "pending"])
    .select("id");
  if (error) return { error: error.message };
  if (!data || (data as unknown[]).length === 0) return { error: "That change already ran or was removed." };
  return {};
}

/** Give the release ONE time; every open item becomes pending at that time. */
export async function scheduleRelease(releaseId: string, runAt: string): Promise<Result> {
  const g = await guard(releaseId, "schedule");
  if (!g.row) return { error: g.error };
  const admin = db();
  const { count } = await admin
    .from("content_schedule")
    .select("id", { count: "exact", head: true })
    .eq("release_id", releaseId)
    .in("status", ["held", "pending"]);
  if (!count) return { error: "Add at least one change before scheduling the release." };
  // Release first (CAS on the status we read), then its items.
  const { data: upd, error } = await admin
    .from("content_releases")
    .update({ status: "scheduled", run_at: runAt })
    .eq("id", releaseId)
    .eq("status", g.row.status)
    .select("id");
  if (error) return { error: error.message };
  if (!upd || (upd as unknown[]).length === 0) return { error: "The release changed while you were looking at it. Reload and try again." };
  const { error: iErr } = await admin
    .from("content_schedule")
    .update({ status: "pending", run_at: runAt, attempts: 0, error: null })
    .eq("release_id", releaseId)
    .in("status", ["held", "pending"]);
  if (iErr) return { error: iErr.message };
  return {};
}

/** Back to draft: pending items go back on hold with no time. */
export async function unscheduleRelease(releaseId: string): Promise<Result> {
  const g = await guard(releaseId, "unschedule");
  if (!g.row) return { error: g.error };
  const admin = db();
  // Items first, so the cron can't start one after the release says "draft".
  const { error: iErr } = await admin
    .from("content_schedule")
    .update({ status: "held", run_at: null })
    .eq("release_id", releaseId)
    .eq("status", "pending");
  if (iErr) return { error: iErr.message };
  const { error } = await admin
    .from("content_releases")
    .update({ status: "draft", run_at: null })
    .eq("id", releaseId)
    .eq("status", "scheduled");
  if (error) return { error: error.message };
  return {};
}

export async function cancelRelease(releaseId: string): Promise<Result> {
  const g = await guard(releaseId, "cancel");
  if (!g.row) return { error: g.error };
  const admin = db();
  const { error: iErr } = await admin
    .from("content_schedule")
    .update({ status: "cancelled" })
    .eq("release_id", releaseId)
    .in("status", ["held", "pending"]);
  if (iErr) return { error: iErr.message };
  const { error } = await admin.from("content_releases").update({ status: "cancelled" }).eq("id", releaseId).in("status", ["draft", "scheduled"]);
  if (error) return { error: error.message };
  return {};
}

/** Publish every open item now. Returns counts; never throws. */
export async function publishReleaseNow(
  releaseId: string,
  actorId: string | null,
): Promise<Result & { done?: number; failed?: number }> {
  const g = await guard(releaseId, "publish_now");
  if (!g.row) return { error: g.error };
  const admin = db();
  const { data, error } = await admin
    .from("content_schedule")
    .select("id,target_kind,target_key,target_label,action,status,attempts")
    .eq("release_id", releaseId)
    .in("status", ["held", "pending"]);
  if (error) return { error: error.message };
  const items = (data ?? []) as {
    id: string;
    target_kind: ScheduleTargetKind;
    target_key: string;
    target_label: string | null;
    action: ScheduleAction;
    status: string;
    attempts: number;
  }[];
  if (items.length === 0) return { error: "This release has no changes to publish." };

  // Move the release to 'scheduled' (now) so settleRelease can finish it,
  // exactly like a cron-run release.
  const nowIso = new Date().toISOString();
  if (g.row.status === "draft") {
    await admin.from("content_releases").update({ status: "scheduled", run_at: nowIso }).eq("id", releaseId).eq("status", "draft");
  }

  let done = 0;
  let failed = 0;
  const touched = new Set<ScheduleTargetKind>();
  for (const it of items) {
    // CLAIM (CAS). run_at is stamped so content_schedule_time_chk holds.
    const { data: claimed } = await admin
      .from("content_schedule")
      .update({ status: "running", run_at: nowIso, claimed_at: nowIso, attempts: it.attempts + 1, error: null })
      .eq("id", it.id)
      .eq("status", it.status)
      .eq("attempts", it.attempts)
      .select("id");
    if (!claimed || (claimed as unknown[]).length === 0) continue; // the cron got it first
    const failure = await applyScheduledChange(it.target_kind, it.target_key, it.action, actorId);
    if (!failure) {
      await admin.from("content_schedule").update({ status: "done", ran_at: new Date().toISOString() }).eq("id", it.id).eq("status", "running");
      done++;
      touched.add(it.target_kind);
      await recordAudit({
        actorId,
        action: `schedule.${it.action}`,
        entityType: it.target_kind,
        entityId: it.target_key,
        after: { schedule_id: it.id, release_id: releaseId, label: it.target_label, via: "release.publish_now" },
      });
    } else {
      // A button press is not retried: record it as failed with the reason.
      await admin.from("content_schedule").update({ status: "failed", error: failure.slice(0, 1000), claimed_at: null }).eq("id", it.id).eq("status", "running");
      failed++;
    }
  }
  if (touched.size > 0) revalidateAfterScheduledChanges(touched);
  await settleRelease(releaseId);
  return { done, failed };
}
