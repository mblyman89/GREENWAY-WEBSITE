/**
 * R46-S1: scheduled publish / unpublish - the I/O side.
 *
 * Every decision (what is due, retry or give up, Pacific -> UTC) lives in
 * content-schedule-core.ts. This file only reads and writes rows and calls
 * the SAME publish functions the editors' Publish buttons call, so a
 * scheduled publish and a button publish can never drift apart.
 *
 * AGENTS rule 12 (Vercel cron is best effort: doubled ticks, overlapping
 * runs, no retries):
 *   - each row is CLAIMED with a compare-and-swap (status + attempts must
 *     still be what we read) before any work; a doubled tick loses the CAS;
 *   - publish is idempotent (copy the saved draft onto the live columns), so
 *     a retry of an abandoned "running" row is safe;
 *   - an idle tick is one indexed query (content_schedule_due_idx).
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { publishCarouselSlide } from "./carousel-store";
import { publishShopCarouselSlide } from "./shop-carousel-store";
import { publishSection } from "./page-sections-store";
import { publishFaqItem } from "./faq-store";
import { publishContentBlock } from "./content-store";
import {
  selectDue,
  statusAfterFailure,
  isStaleRunning,
  SCHEDULE_MAX_PER_TICK,
  TARGET_KIND_LABEL,
  type ScheduleAction,
  type ScheduleStatus,
  type ScheduleTargetKind,
  type ValidSchedule,
} from "./content-schedule-core";

export type ScheduleRow = {
  id: string;
  target_kind: ScheduleTargetKind;
  target_key: string;
  target_label: string | null;
  action: ScheduleAction;
  run_at: string | null;
  /** 'held' = waiting inside a draft release (R46-S2). */
  status: ScheduleStatus | "held";
  release_id: string | null;
  attempts: number;
  claimed_at: string | null;
  ran_at: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
};

const COLS =
  "id,target_kind,target_key,target_label,action,run_at,status,release_id,attempts,claimed_at,ran_at,error,created_by,created_at";

export const SCHEDULE_MIGRATION_HINT =
  "Scheduling needs database migration 0267 (supabase/migrations/0267_content_schedule_releases.sql). Run it in the Supabase SQL editor, then reload.";

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** True when the error means 0267's tables are not there yet. */
export function isMissingScheduleSchema(error: DbError): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const missing = code === "42P01" || code === "PGRST205" || /relation .* does not exist|could not find the table/.test(msg);
  return missing && (msg.includes("content_schedule") || msg.includes("content_releases"));
}

/** Map table per kind (only the kinds that have an on/off switch). */
const ENABLE_TABLE: Partial<Record<ScheduleTargetKind, string>> = {
  carousel_slide: "home_carousel_slides",
  shop_slide: "shop_carousel_slides",
  page_section: "page_sections",
  faq_item: "faq_items",
};

// ---------------------------------------------------------------------------
// Reads for the editors and the schedule page
// ---------------------------------------------------------------------------

export type ScheduleListResult = { ready: boolean; rows: ScheduleRow[] };

/** Upcoming + recent schedules (for /admin/content/schedule). */
export async function listSchedules(opts?: { recentDays?: number }): Promise<ScheduleListResult> {
  if (!isSupabaseServiceConfigured) return { ready: false, rows: [] };
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - (opts?.recentDays ?? 14) * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("content_schedule")
    .select(COLS)
    .or(`status.in.(held,pending,running),updated_at.gte.${since}`)
    .order("run_at", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) {
    if (isMissingScheduleSchema(error)) return { ready: false, rows: [] };
    console.error("[content-schedule] list failed:", error.message);
    return { ready: true, rows: [] };
  }
  return { ready: true, rows: (data as ScheduleRow[] | null) ?? [] };
}

/**
 * Open (held/pending/running) schedules for one kind, keyed by target_key,
 * so an editor page can show "Goes live Fri 9 AM" on each card with ONE query.
 */
export async function openSchedulesByTarget(
  kind: ScheduleTargetKind,
): Promise<{ ready: boolean; byKey: Record<string, ScheduleRow[]> }> {
  if (!isSupabaseServiceConfigured) return { ready: false, byKey: {} };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("content_schedule")
    .select(COLS)
    .eq("target_kind", kind)
    .in("status", ["held", "pending", "running"])
    .order("run_at", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) {
    if (!isMissingScheduleSchema(error)) console.error("[content-schedule] open lookup failed:", error.message);
    return { ready: !isMissingScheduleSchema(error), byKey: {} };
  }
  const byKey: Record<string, ScheduleRow[]> = {};
  for (const r of (data as ScheduleRow[] | null) ?? []) (byKey[r.target_key] ??= []).push(r);
  return { ready: true, byKey };
}

// ---------------------------------------------------------------------------
// Writes from the editors
// ---------------------------------------------------------------------------

/** Insert a stand-alone schedule. A duplicate (same item/action/time) is a no-op success. */
export async function createSchedule(
  v: ValidSchedule,
  label: string | null,
  createdBy: string | null,
): Promise<{ id?: string; error?: string }> {
  if (!isSupabaseServiceConfigured) return { error: "Storage not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("content_schedule")
    .insert({
      target_kind: v.kind,
      target_key: v.key,
      target_label: label ? label.slice(0, 200) : null,
      action: v.action,
      run_at: v.runAt,
      status: "pending",
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingScheduleSchema(error)) return { error: SCHEDULE_MIGRATION_HINT };
    if (error.code === "23505") return {}; // content_schedule_no_dupe_uq: already scheduled
    return { error: error.message };
  }
  return { id: (data as { id: string }).id };
}

/** Cancel one open schedule. Only held/pending rows can be cancelled (a running one is mid-flight). */
export async function cancelSchedule(id: string): Promise<{ row?: ScheduleRow; error?: string }> {
  if (!isSupabaseServiceConfigured) return { error: "Storage not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("content_schedule")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["held", "pending"])
    .select(COLS);
  if (error) return { error: isMissingScheduleSchema(error) ? SCHEDULE_MIGRATION_HINT : error.message };
  const row = ((data as ScheduleRow[] | null) ?? [])[0];
  if (!row) return { error: "That schedule already ran or was cancelled." };
  return { row };
}

/** A friendly label for an item, captured when it is scheduled. */
export async function labelForTarget(kind: ScheduleTargetKind, key: string): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  try {
    if (kind === "carousel_slide") {
      const { data } = await admin.from("home_carousel_slides").select("draft_title,title").eq("id", key).maybeSingle();
      const d = data as { draft_title?: string | null; title?: string | null } | null;
      return d ? (d.draft_title || d.title || null) : null;
    }
    if (kind === "shop_slide") {
      const { data } = await admin.from("shop_carousel_slides").select("draft_presentation,presentation,slide_key").eq("id", key).maybeSingle();
      const d = data as { draft_presentation?: { title?: { text?: string } } | null; presentation?: { title?: { text?: string } } | null; slide_key?: string } | null;
      if (!d) return null;
      const t = d.draft_presentation?.title?.text || d.presentation?.title?.text || d.slide_key || "";
      return t.split("\n")[0] || null;
    }
    if (kind === "page_section") {
      const { data } = await admin.from("page_sections").select("draft_title,title,page_slug,section_key").eq("id", key).maybeSingle();
      const d = data as { draft_title?: string | null; title?: string | null; page_slug?: string; section_key?: string } | null;
      return d ? `${d.page_slug ?? ""}: ${d.draft_title || d.title || d.section_key || ""}` : null;
    }
    if (kind === "faq_item") {
      const { data } = await admin.from("faq_items").select("draft_question,question").eq("id", key).maybeSingle();
      const d = data as { draft_question?: string | null; question?: string | null } | null;
      return d ? (d.draft_question || d.question || null) : null;
    }
    const { data } = await admin.from("content_blocks").select("label,page").eq("block_key", key).maybeSingle();
    const d = data as { label?: string; page?: string } | null;
    return d ? `${d.page}: ${d.label}` : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Doing one change (shared by the cron and "Publish release now")
// ---------------------------------------------------------------------------

/**
 * Run ONE scheduled change through the same functions the editor buttons
 * use. Returns an error string on failure (never throws).
 */
export async function applyScheduledChange(
  kind: ScheduleTargetKind,
  key: string,
  action: ScheduleAction,
  actorId: string | null,
): Promise<string | null> {
  try {
    // Locked sections / FAQ items are refused before ANY write.
    if (kind === "page_section" || kind === "faq_item") {
      const lockTable = ENABLE_TABLE[kind] as string;
      const { data: lockRow } = await createSupabaseAdminClient().from(lockTable).select("locked").eq("id", key).maybeSingle();
      if (!lockRow) return "That item no longer exists.";
      if ((lockRow as { locked?: boolean }).locked) return "This item is locked.";
    }
    if (action === "publish") {
      // "Goes live" means visible: switch the draft on first, so an item that
      // an earlier scheduled unpublish turned off comes back (a sale banner
      // reused next month). The publish below copies draft_enabled -> enabled.
      const switchTable = ENABLE_TABLE[kind];
      if (switchTable) {
        const admin = createSupabaseAdminClient();
        const { error: onErr } = await admin.from(switchTable).update({ draft_enabled: true }).eq("id", key);
        if (onErr) return onErr.message;
      }
      switch (kind) {
        case "carousel_slide":
          await publishCarouselSlide(key, actorId);
          return null;
        case "shop_slide":
          await publishShopCarouselSlide(key, actorId);
          return null;
        case "page_section":
          return (await publishSection(key, actorId)).error ?? null;
        case "faq_item":
          return (await publishFaqItem(key, actorId)).error ?? null;
        case "content_block":
          await publishContentBlock(key, actorId, { note: "Scheduled publish" });
          return null;
      }
    }
    // Unpublish = turn it off. Both switches, so a later Publish of other
    // edits does not quietly bring an expired sale banner back.
    const table = ENABLE_TABLE[kind];
    if (!table) return `${TARGET_KIND_LABEL[kind]} can only be scheduled to publish.`;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from(table)
      .update({ enabled: false, draft_enabled: false })
      .eq("id", key)
      .select("id");
    if (error) return error.message;
    if (!data || (data as unknown[]).length === 0) return "That item no longer exists.";
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Refresh the public site after scheduled changes. The editors' own actions
 * use the same safety net: the root layout covers every public page (banners,
 * sections, FAQ, wording all render under it). Route Handlers MARK the paths;
 * Next.js rebuilds them on the next visit (revalidatePath docs).
 */
export function revalidateAfterScheduledChanges(kinds: Iterable<ScheduleTargetKind>): void {
  const set = new Set(kinds);
  try {
    if (set.has("carousel_slide")) revalidatePath("/");
    if (set.has("shop_slide")) revalidatePath("/menu");
    if (set.has("faq_item")) revalidatePath("/faq");
    revalidatePath("/(site)", "layout") /* PERF-S6: public site only, not /admin */;
    revalidatePath("/admin/content/schedule");
  } catch (e) {
    console.error("[content-schedule] revalidate failed:", e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// The cron tick
// ---------------------------------------------------------------------------

export type ScheduleTickResult = {
  ok: boolean;
  skipped?: "no_supabase" | "no_table" | "nothing_due";
  ran: number;
  done: number;
  failed: number;
  retrying: number;
  lostClaims: number;
  error?: string;
};

export async function runContentScheduleTick(nowIso = new Date().toISOString()): Promise<ScheduleTickResult> {
  const base: ScheduleTickResult = { ok: true, ran: 0, done: 0, failed: 0, retrying: 0, lostClaims: 0 };
  if (!isSupabaseServiceConfigured) return { ...base, skipped: "no_supabase" };
  const admin = createSupabaseAdminClient();

  // ONE indexed query: pending rows that are due + running rows (the core
  // decides which of those were abandoned).
  const { data, error } = await admin
    .from("content_schedule")
    .select(COLS)
    .in("status", ["pending", "running"])
    .lte("run_at", nowIso)
    .order("run_at", { ascending: true })
    .limit(SCHEDULE_MAX_PER_TICK * 4);
  if (error) {
    if (isMissingScheduleSchema(error)) return { ...base, skipped: "no_table" };
    return { ...base, ok: false, error: error.message };
  }
  // The query filtered on run_at <= now, so run_at is never null here.
  const due = selectDue(((data as ScheduleRow[] | null) ?? []) as (ScheduleRow & { run_at: string })[], nowIso);
  if (due.length === 0) return { ...base, skipped: "nothing_due" };

  const touched = new Set<ScheduleTargetKind>();
  const releasesTouched = new Set<string>();
  for (const row of due) {
    // CLAIM (compare-and-swap). Another tick that already moved this row
    // changes status/attempts/claimed_at, so zero rows match and we skip it.
    let claim = admin
      .from("content_schedule")
      .update({ status: "running", claimed_at: nowIso, attempts: row.attempts + 1, error: null })
      .eq("id", row.id)
      .eq("status", row.status)
      .eq("attempts", row.attempts);
    if (isStaleRunning(row, nowIso) && row.claimed_at) claim = claim.eq("claimed_at", row.claimed_at);
    const { data: claimed, error: claimErr } = await claim.select("id");
    if (claimErr || !claimed || (claimed as unknown[]).length === 0) {
      base.lostClaims++;
      continue;
    }

    base.ran++;
    const failure = await applyScheduledChange(row.target_kind, row.target_key, row.action, row.created_by);
    const attempts = row.attempts + 1;
    if (!failure) {
      await admin
        .from("content_schedule")
        .update({ status: "done", ran_at: new Date().toISOString(), error: null })
        .eq("id", row.id)
        .eq("status", "running");
      base.done++;
      touched.add(row.target_kind);
      if (row.release_id) releasesTouched.add(row.release_id);
      await recordAudit({
        actorId: row.created_by,
        action: `schedule.${row.action}`,
        entityType: row.target_kind,
        entityId: row.target_key,
        after: { schedule_id: row.id, run_at: row.run_at, release_id: row.release_id, label: row.target_label },
      });
    } else {
      const next = statusAfterFailure(attempts);
      await admin
        .from("content_schedule")
        .update({ status: next, error: failure.slice(0, 1000), claimed_at: null })
        .eq("id", row.id)
        .eq("status", "running");
      if (next === "failed") base.failed++;
      else base.retrying++;
      console.error(`[content-schedule] ${row.action} ${row.target_kind}/${row.target_key} failed (attempt ${attempts}): ${failure}`);
    }
  }

  if (touched.size > 0) revalidateAfterScheduledChanges(touched);
  // A release whose items have all finished is marked published (S2).
  for (const rid of releasesTouched) await settleRelease(rid);
  return base;
}

/** Mark a scheduled release published once none of its items are still open. */
export async function settleRelease(releaseId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("content_schedule")
    .select("id", { count: "exact", head: true })
    .eq("release_id", releaseId)
    .in("status", ["held", "pending", "running"]);
  if ((count ?? 1) === 0) {
    await admin
      .from("content_releases")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", releaseId)
      .eq("status", "scheduled");
  }
}

// ---------------------------------------------------------------------------
// Everything that can be scheduled (for the Schedule page's picker)
// ---------------------------------------------------------------------------

export type ScheduleTargetOption = { kind: ScheduleTargetKind; key: string; label: string; group: string };

/** Every schedulable item, grouped for a <select>. Never throws. */
export async function listScheduleTargets(): Promise<ScheduleTargetOption[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const out: ScheduleTargetOption[] = [];
  const first = (s: string | null | undefined) => String(s ?? "").split("\n")[0].trim();
  try {
    const [home, shop, sections, faq, blocks] = await Promise.all([
      admin.from("home_carousel_slides").select("id,draft_title,title,sort_order").order("sort_order").limit(50),
      admin.from("shop_carousel_slides").select("id,slide_key,draft_presentation,presentation,sort_order").order("sort_order").limit(50),
      admin.from("page_sections").select("id,page_slug,section_key,draft_title,title,locked,sort_order").order("page_slug").order("sort_order").limit(300),
      admin.from("faq_items").select("id,draft_question,question,locked,sort_order").order("sort_order").limit(300),
      admin.from("content_blocks").select("block_key,page,label").order("page").order("block_key").limit(500),
    ]);
    for (const r of (home.data ?? []) as { id: string; draft_title: string | null; title: string | null }[])
      out.push({ kind: "carousel_slide", key: r.id, label: first(r.draft_title || r.title) || "(untitled slide)", group: "Home carousel" });
    for (const r of (shop.data ?? []) as { id: string; slide_key: string; draft_presentation: { title?: { text?: string } } | null; presentation: { title?: { text?: string } } | null }[])
      out.push({ kind: "shop_slide", key: r.id, label: first(r.draft_presentation?.title?.text || r.presentation?.title?.text) || r.slide_key, group: "Shop banner" });
    for (const r of (sections.data ?? []) as { id: string; page_slug: string; section_key: string; draft_title: string | null; title: string | null; locked: boolean }[]) {
      if (r.locked || r.section_key === "home.settings") continue;
      out.push({ kind: "page_section", key: r.id, label: `${r.page_slug}: ${first(r.draft_title || r.title) || r.section_key}`, group: "Page sections" });
    }
    for (const r of (faq.data ?? []) as { id: string; draft_question: string | null; question: string | null; locked: boolean }[]) {
      if (r.locked) continue;
      out.push({ kind: "faq_item", key: r.id, label: first(r.draft_question || r.question) || "(untitled question)", group: "FAQ questions" });
    }
    for (const r of (blocks.data ?? []) as { block_key: string; page: string; label: string }[])
      out.push({ kind: "content_block", key: r.block_key, label: `${r.page}: ${r.label}`, group: "Page wording (publish only)" });
  } catch (e) {
    console.error("[content-schedule] target list failed:", e instanceof Error ? e.message : e);
  }
  return out;
}
