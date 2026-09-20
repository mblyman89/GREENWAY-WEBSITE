"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  pushLeaflyMenu,
  getLeaflyStatus,
  getLeaflyMenu,
  isLeaflyConfigured,
  type LeaflyPushResult,
} from "@/lib/leafly/push";
import type {
  LeaflyReconcileResult,
  ReadbackTimingVerdict,
} from "@/lib/leafly/readback-core";
import type { ReadbackBaseline } from "@/lib/leafly/readback-baseline-core";
import { draftLeaflyDescription } from "@/lib/leafly/ai";
import { recordSyndicationLog } from "@/lib/syndication/store";
import { AiNotConfiguredError } from "@/lib/ai/provider";
import { PreflightBlockedError } from "@/lib/syndication/preflight-core";
import {
  resolveLeaflySettings,
  type LeaflySyncSettings,
} from "@/lib/syndication/sync-settings-core";
import {
  DAILY_HOUR_MAX,
  DAILY_HOUR_MIN,
  INTRADAY_MINUTES_MAX,
  INTRADAY_MINUTES_MIN,
  describeSchedule,
  resolveScheduleSettings,
  type LeaflyScheduleSettings,
} from "@/lib/leafly/schedule-core";
import { getLeaflySyncSettings, resetSyncState, saveSyncSettings } from "@/lib/syndication/engine-store";
import {
  beginManualRun,
  finishManualRun,
  loadLeaflySyncHealth,
  runScheduledLeaflySync,
} from "@/lib/leafly/schedule-server";

const BASE = "/admin/integrations/leafly";

export type PushActionResult =
  | { ok: true; result: LeaflyPushResult }
  | { ok: false; error: string };

/**
 * Live full menu sync (POST) to Leafly. Requires settings.manage, full credentials, and
 * explicit confirm=true from the form. Records to syndication_logs + audit either way.
 *
 * SLICE L-7 -- WHY THIS NOW OPENS A RUN ROW.
 *
 * The owner asked for "both automation and a manual push button". Making the
 * button keep working was the easy half; making the two SAFE TOGETHER is this.
 *
 * `leafly_sync_runs` is where the scheduler looks to decide whether it is safe
 * to act, and an unfinished row IS the lock (migration 0227). Before this
 * change a manual push was invisible to it: a cron tick landing while the owner
 * was mid-push would read "nothing in flight" and start a second, concurrent
 * full sync against Leafly -- two overlapping POSTs, the last one winning, and
 * exactly the erratic request pattern their certification checklist marks down.
 *
 * So the push is bracketed. `beginManualRun` writes the row, the scheduler sees
 * `manual_in_flight` and stands aside, and `finishManualRun` closes it in a
 * `finally`-equivalent position on both the success and the error path.
 *
 * Note the deliberate asymmetry: if `beginManualRun` cannot write its row it
 * returns null and the push STILL PROCEEDS. A person who has pressed this
 * button and confirmed it has made a decision, and refusing them because a log
 * table was unreachable would be the wrong trade -- the worst case of pushing
 * anyway is that the scheduler does not know, which the staleness cutoff and
 * the minimum gap already tolerate. `finishManualRun` no-ops on a null id.
 */
export async function pushLeaflyAction(formData: FormData): Promise<PushActionResult> {
  const session = await requirePermission("settings.manage");
  const confirm = formData.get("confirm") === "true";
  const method = formData.get("method") === "PUT" ? "PUT" : "POST";

  if (!confirm) {
    return { ok: false, error: "Confirmation required for a live Leafly push." };
  }
  if (!isLeaflyConfigured()) {
    return {
      ok: false,
      error: "Leafly is not configured. Set the menu integration key and OAuth credentials first.",
    };
  }

  // Tell the scheduler a human is working. See the note above on why a failure
  // here does not stop the push.
  const manualRunId = await beginManualRun(session.userId);

  try {
    const result = await pushLeaflyMenu({ confirm: true, method });
    await finishManualRun({
      id: manualRunId,
      ok: result.ok,
      skipped: result.skipped,
      method: result.method,
      httpStatus: result.httpStatus,
      itemCount: result.itemCount,
      planSummary: result.planSummary,
      errorDetail: result.ok ? null : (result.message ?? null),
    });
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: result.skipped ? "skipped" : result.ok ? "ok" : "error",
      itemCount: result.itemCount,
      payload: result.payload,
      response: result.response,
      message: result.message,
      createdBy: session.userId,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: result.skipped
        ? "leafly.push.skipped"
        : result.ok
          ? "leafly.push.success"
          : "leafly.push.error",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        method: result.method,
        itemCount: result.itemCount,
        httpStatus: result.httpStatus,
        plan: result.planSummary,
        skipped: result.skipped,
      },
    });
    revalidatePath(BASE);
    return { ok: true, result };
  } catch (err) {
    const blocked = err instanceof PreflightBlockedError;
    const message = err instanceof Error ? err.message : "Leafly push failed.";
    // Close the lock row on the error path too. An exception that left the row
    // open would make the scheduler believe a manual push was still running --
    // for STALE_RUN_MINUTES, and every tick in between would stand aside.
    //
    // A preflight block is recorded as 'skipped' rather than 'failed', matching
    // the syndication log below and for the same reason: nothing was
    // transmitted, so it is not a channel failure and must not count towards
    // the consecutive-failure backoff.
    await finishManualRun({
      id: manualRunId,
      ok: blocked,
      skipped: blocked,
      method: null,
      errorDetail: message,
    });
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      // Preflight blocks are "skipped" (nothing was transmitted), not channel errors.
      status: blocked ? "skipped" : "error",
      itemCount: 0,
      payload: blocked ? { preflight: (err as PreflightBlockedError).report } : undefined,
      message,
      createdBy: session.userId,
    });
    revalidatePath(BASE);
    return { ok: false, error: message };
  }
}

export type SyncSettingsActionResult =
  | { ok: true; settings: LeaflySyncSettings }
  | { ok: false; error: string };

/** Read the owner's resolved Leafly transmission parameters. */
export async function getLeaflySettingsAction(): Promise<SyncSettingsActionResult> {
  await requirePermission("settings.manage");
  return { ok: true, settings: await getLeaflySyncSettings() };
}

/**
 * Save the owner's Leafly transmission parameters (sync mode, retries, field
 * toggles, force-resend). Values are resolved + CLAMPED through the pure core
 * before storage, so out-of-range input can never break a sync. Audited.
 *
 * SLICE L-7 -- READ THIS BEFORE ADDING A FIELD TO THE STORED BLOB.
 *
 * `saveSyncSettings` UPSERTS THE WHOLE JSONB BLOB. This action builds that blob
 * from an allowlist of form keys, so any stored field the form does not submit
 * is silently reset to its default on every save. While the blob held only the
 * nine transmission knobs -- all of which this form renders -- that was
 * harmless. The moment L-7 put the sync SCHEDULE in the same row it stopped
 * being harmless: an owner ticking "send images" would have switched his own
 * automatic syncing off without being told, because `schedule` is not one of
 * the keys below and would have resolved to the default of `enabled: false`.
 *
 * So the stored settings are read FIRST and the schedule is carried across
 * explicitly. The two forms own disjoint halves of one row, and neither may
 * clobber the other's half.
 */
export async function saveLeaflySettingsAction(
  formData: FormData,
): Promise<SyncSettingsActionResult> {
  const session = await requirePermission("settings.manage");
  // Read before write. This is the guard described above.
  const existing = await getLeaflySyncSettings();
  const raw: Record<string, unknown> = {};
  for (const key of [
    "pacingMs",
    "maxRetries",
    "sendDescriptions",
    "sendCannabinoids",
    "sendImages",
    "sendStrains",
    "forceResend",
    "syncMode",
    // SLICE L-3 (L-09). Without this key the owner's ordering toggle would post to a
    // server action that ignores it, and the form would silently revert every save.
    "sendPickupAvailability",
  ]) {
    const v = formData.get(key);
    if (v !== null) raw[key] = v;
  }
  // Carry the schedule across untouched. This form has no schedule controls, so
  // it must not express an opinion about the schedule.
  raw["schedule"] = existing.schedule;
  const settings = resolveLeaflySettings(raw);
  const saved = await saveSyncSettings("leafly", settings, session.userId);
  if (!saved.ok) {
    return {
      ok: false,
      error: `Could not save settings: ${saved.error}. If migration 0119 has not been applied yet, apply it first.`,
    };
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "leafly.sync_settings.save",
    entityType: "syndication",
    entityId: "leafly",
    after: settings,
  });
  revalidatePath(BASE);
  return { ok: true, settings };
}

// ---------------------------------------------------------------------------
// SLICE L-7 -- the automatic sync schedule
// ---------------------------------------------------------------------------

export type ScheduleActionResult =
  | { ok: true; schedule: LeaflyScheduleSettings; description: string }
  | { ok: false; error: string };

/**
 * Save the automatic sync schedule.
 *
 * Mirror image of `saveLeaflySettingsAction`: it reads the stored settings
 * first and changes ONLY the `schedule` half, leaving the transmission knobs
 * exactly as they were. Every value goes through `resolveScheduleSettings`, so
 * an hour of 99 becomes 23 and an interval of 1 becomes the 15-minute floor
 * rather than being rejected with a validation error the owner has to decode.
 *
 * The active-window pair is all-or-nothing on purpose. `resolveScheduleSettings`
 * discards a half-specified window, so "active from 9" with no end reads as no
 * window at all rather than as a one-hour window -- which is the difference
 * between "sync all day" and "sync almost never".
 *
 * Audited with both the before and after states, because turning automatic
 * syncing on is the moment this system starts talking to a third party with
 * nobody watching, and that should be reconstructable.
 */
export async function saveLeaflyScheduleAction(
  formData: FormData,
): Promise<ScheduleActionResult> {
  const session = await requirePermission("settings.manage");
  const existing = await getLeaflySyncSettings();

  const readBool = (key: string): boolean => formData.get(key) === "true";
  const readHour = (key: string): number | null => {
    const v = formData.get(key);
    if (v === null || String(v).trim() === "") return null;
    const n = Number.parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
  };

  const from = readHour("activeFromHour");
  const to = readHour("activeToHour");

  const schedule = resolveScheduleSettings({
    enabled: readBool("enabled"),
    dailyFullHour: readHour("dailyFullHour"),
    intradayEnabled: readBool("intradayEnabled"),
    intradayMinutes: readHour("intradayMinutes"),
    // Both ends or neither. The resolver enforces this too; passing them
    // together keeps the intent visible at the call site.
    activeFromHour: from !== null && to !== null ? from : null,
    activeToHour: from !== null && to !== null ? to : null,
  });

  const saved = await saveSyncSettings(
    "leafly",
    { ...existing, schedule },
    session.userId,
  );
  if (!saved.ok) {
    return {
      ok: false,
      error: `Could not save the schedule: ${saved.error}. If migration 0119 has not been applied yet, apply it first.`,
    };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "leafly.sync_schedule.save",
    entityType: "syndication",
    entityId: "leafly",
    before: existing.schedule,
    after: schedule,
  });
  revalidatePath(BASE);
  return { ok: true, schedule, description: describeSchedule(schedule) };
}

/**
 * "Run the check now" -- the manual trigger for the AUTOMATIC path.
 *
 * This is not a second push button, and the distinction is the point. The push
 * button says "send my menu to Leafly right now" and always obeys. This says
 * "do whatever the schedule would do if it ticked this second", which very
 * often means sending nothing and explaining why.
 *
 * WHY IT EXISTS
 * -------------
 * Without it, the only way to find out whether a schedule works is to wait for
 * it -- and on Vercel Hobby that wait is up to 24 hours, because the platform
 * permits exactly one cron tick per day (measured: Vercel's cron docs, read
 * 2026-09-18, "Hobby accounts are limited to cron jobs that run once per day").
 * Discovering a typo'd credential a day later is not acceptable when a button
 * can prove it in two seconds.
 *
 * It calls `runScheduledLeaflySync()` -- the SAME function the cron calls, with
 * no test mode and no bypass flag. Every safety rule still applies: if a manual
 * push is in flight it stands aside, if it is inside the minimum gap it cools
 * down, if the owner has automation switched off it says so and sends nothing.
 * A "check" that skipped the rules would be testing something other than the
 * thing it claims to test.
 *
 * It is deliberately NOT gated on `settings.schedule.enabled`. An owner
 * evaluating whether to turn automation on is exactly the person who most needs
 * to see what it would do first, and the honest answer in that state -- "Off:
 * automation is switched off, so nothing would be sent" -- is useful
 * information rather than a dead button.
 *
 * Audited, because this makes a real outbound request to a third party.
 */
export async function checkLeaflyScheduleNowAction(): Promise<
  | { ok: true; code: string; message: string; pushed: boolean; disposition: string }
  | { ok: false; error: string }
> {
  const session = await requirePermission("settings.manage");
  try {
    const outcome = await runScheduledLeaflySync();
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "leafly.sync_schedule.check_now",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        code: outcome.decision.code,
        pushed: outcome.pushed,
        disposition: outcome.disposition,
        httpStatus: outcome.httpStatus,
        itemCount: outcome.itemCount,
      },
    });
    revalidatePath(BASE);
    return {
      ok: true,
      code: outcome.decision.code,
      // The decision's own sentence when nothing was sent (it explains the
      // refusal), the outcome's message when something was.
      message: outcome.pushed ? outcome.message : outcome.decision.reason,
      pushed: outcome.pushed,
      disposition: outcome.disposition,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The schedule check could not be run.",
    };
  }
}

/**
 * Re-read the schedule's health. Used by the page on render; exported as an
 * action so the panel can refresh without a full navigation if that is ever
 * wanted. Never throws -- `loadLeaflySyncHealth` reports read failures as a
 * `problem` string rather than a 500 on a settings page.
 */
export async function getLeaflySyncHealthAction() {
  await requirePermission("settings.manage");
  return loadLeaflySyncHealth();
}

/** Bounds for the schedule form, so the UI cannot drift from the resolver. */
export async function getLeaflyScheduleBoundsAction(): Promise<{
  dailyHourMin: number;
  dailyHourMax: number;
  intradayMinutesMin: number;
  intradayMinutesMax: number;
}> {
  await requirePermission("settings.manage");
  return {
    dailyHourMin: DAILY_HOUR_MIN,
    dailyHourMax: DAILY_HOUR_MAX,
    intradayMinutesMin: INTRADAY_MINUTES_MIN,
    intradayMinutesMax: INTRADAY_MINUTES_MAX,
  };
}

export type ResetStateActionResult = { ok: true } | { ok: false; error: string };

/**
 * Recovery tool: forget the last-successful-sync hashes so the NEXT push
 * resends every item (use when Leafly-side data is suspected out of sync).
 */
export async function resetLeaflySyncStateAction(): Promise<ResetStateActionResult> {
  const session = await requirePermission("settings.manage");
  try {
    await resetSyncState("leafly");
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "leafly.sync_state.reset",
      entityType: "syndication",
      entityId: "leafly",
    });
    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Reset failed." };
  }
}

export type StatusActionResult =
  | { ok: true; httpStatus: number; body: unknown }
  | { ok: false; error: string };

export async function fetchLeaflyStatusAction(): Promise<StatusActionResult> {
  const session = await requirePermission("settings.manage");
  if (!isLeaflyConfigured()) {
    return { ok: false, error: "Leafly is not configured." };
  }
  try {
    const status = await getLeaflyStatus();
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "leafly.status.fetch",
      entityType: "syndication",
      entityId: "leafly",
      after: { httpStatus: status.httpStatus },
    });
    return { ok: true, httpStatus: status.httpStatus, body: status.body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Status request failed." };
  }
}

export type MenuReadbackActionResult =
  | {
      ok: true;
      httpStatus: number;
      summary: string;
      reconcile: LeaflyReconcileResult | null;
      parseWarnings: string[];
      itemsAtLeafly: number;
      /**
       * Whether the comparison ran inside Leafly's documented ingest window
       * (finding L-19). Carried to the client so a premature comparison is labelled
       * as such instead of being read as a list of defects.
       */
      timing: ReadbackTimingVerdict;
      /**
       * Which payload the comparison was made against, and what it may
       * conclude. Carried to the client because a comparison is only as
       * trustworthy as its baseline: after a targeted push, a whole-menu diff
       * reports thousands of untouched products as failures, and the owner
       * must be able to SEE which comparison he is reading.
       */
      baseline: ReadbackBaseline | null;
    }
  | { ok: false; error: string };

/**
 * Read the menu back from Leafly's sandbox and compare it against what we would send
 * (finding L-14).
 *
 * This runs SERVER-SIDE inside the deployed app on purpose. Leafly's menu certification
 * checklist disqualifies retailers whose "request signatures indicate ... the use of
 * manual tools (e.g., postman or curl)" (readiness report §7, Risk 3). Every Leafly
 * request this business makes must therefore originate here, from the application, and
 * never from anybody's laptop. Driving it from a button in the back office is what makes
 * the resulting request log certifiable.
 *
 * Read-only: it cannot change the Leafly menu, so unlike a push it needs no confirm flag.
 * It is still audited, because "who looked, and when" is exactly what you want when
 * reconstructing a certification review.
 */
export async function fetchLeaflyMenuReadbackAction(): Promise<MenuReadbackActionResult> {
  const session = await requirePermission("settings.manage");
  if (!isLeaflyConfigured()) {
    return {
      ok: false,
      error:
        "Leafly is not configured. Enter the menu integration key and OAuth credentials first.",
    };
  }
  try {
    const result = await getLeaflyMenu();
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "leafly.menu.readback",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        httpStatus: result.httpStatus,
        itemsAtLeafly: result.parse.ok ? result.parse.items.length : 0,
        reconcileOk: result.reconcile?.ok ?? null,
        errorCount:
          result.reconcile?.issues.filter((i) => i.severity === "error").length ?? null,
        // Audited too: a reviewer reconstructing "why did we think the menu was wrong"
        // needs to know whether the comparison was even run late enough to be valid.
        comparisonWasPremature: result.timing.tooSoon,
        secondsSinceLastPush: result.timing.secondsSincePush,
        // Audited because "why did we think the menu was wrong" is
        // unanswerable without knowing what it was compared against.
        baselineSource: result.baseline?.source ?? null,
        baselineScope: result.baseline?.scope ?? null,
        baselineItemCount: result.baseline?.payload?.items.length ?? null,
      },
    });
    // Recorded to syndication_logs as a "preview" mode entry: it contacted Leafly, but it
    // transmitted no menu data, so counting it as a live push would corrupt the channel
    // health figure that the dashboard computes from live attempts.
    await recordSyndicationLog({
      channel: "leafly",
      mode: "preview",
      status: result.ok ? "ok" : "error",
      itemCount: result.parse.ok ? result.parse.items.length : 0,
      payload: null,
      response: result.body,
      message: result.summary,
      createdBy: session.userId,
    });
    return {
      ok: true,
      httpStatus: result.httpStatus,
      summary: result.summary,
      reconcile: result.reconcile,
      parseWarnings: result.parse.ok ? result.parse.warnings : [result.parse.reason],
      itemsAtLeafly: result.parse.ok ? result.parse.items.length : 0,
      timing: result.timing,
      baseline: result.baseline,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Menu read-back failed.",
    };
  }
}

export type DescriptionDraftResult =
  | { ok: true; description: string; flags: string[] }
  | { ok: false; error: string };

/** AI DRAFT a plain-text Leafly description. Drafts only — staff must approve before use. */
export async function draftLeaflyDescriptionAction(
  input: {
    name: string;
    brand?: string | null;
    category: string;
    strainType?: string | null;
    strainName?: string | null;
    thc?: string | null;
    cbd?: string | null;
    existing?: string | null;
  },
): Promise<DescriptionDraftResult> {
  await requirePermission("settings.manage");
  if (!input.name || !input.category) {
    return { ok: false, error: "Product name and category are required." };
  }
  try {
    const { description, compliance } = await draftLeaflyDescription(input);
    return { ok: true, description, flags: compliance.flags };
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return { ok: false, error: "AI is not configured. Add an AI provider key to enable drafting." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Drafting failed." };
  }
}
