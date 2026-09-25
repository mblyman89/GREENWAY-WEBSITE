"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  deleteLeaflyItems,
  getLeaflyStatus,
  getLeaflyMenu,
} from "@/lib/leafly/push";
import { requireLeaflyReady } from "@/lib/leafly/readiness-gate";
// ROADMAP R8 (owner ask 6). The menu browser lets the owner SEE what is on
// the Leafly menu and remove it by name; the identity loader supplies the
// vendor and barcode that make a product recognisable without an id.
import {
  loadLeaflyMenuBrowser,
  type MenuBrowserResult,
} from "@/lib/leafly/menu-browser-server";
import type { MenuBrowserSort } from "@/lib/leafly/menu-browser-core";
import { loadProductIdentities } from "@/lib/leafly/identity-server";
import { describeProductIdentity } from "@/lib/leafly/product-identity-core";
import {
  parseDeleteIds,
  describeDeleteProblems,
  reconcileDeleteRequest,
  describeUnknownDeleteIds,
  describeDeleteOutcome,
} from "@/lib/leafly/delete-request-core";
import type {
  LeaflyReconcileResult,
  ReadbackTimingVerdict,
} from "@/lib/leafly/readback-core";
import type { ReadbackBaseline } from "@/lib/leafly/readback-baseline-core";
import { recordSyndicationLog } from "@/lib/syndication/store";
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
import {
  getLeaflySyncSettings,
  getSyncState,
  resetSyncState,
  saveSyncSettings,
} from "@/lib/syndication/engine-store";
import {
  beginManualRun,
  finishManualRun,
  loadLeaflySyncHealth,
  runScheduledLeaflySync,
} from "@/lib/leafly/schedule-server";
// TASK J ask 3 + ask 4. "Send the full menu, withhold the bad ones" and the
// preview that lets the owner SEE a split before it changes his storefront.
import {
  previewFullMenuPassingOnly,
  pushFullMenuPassingOnly,
  FullMenuRefusedError,
  type FullMenuPreviewResult,
  type FullMenuPushResult,
} from "@/lib/leafly/full-menu-server";

// SLICE L-42 -- the certification POST ("Replace my whole Leafly menu").
import {
  previewReplaceLeaflyMenu,
  replaceLeaflyMenu,
  type ReplaceMenuPreview,
  type ReplaceMenuResult,
} from "@/lib/leafly/replace-menu-server";

const BASE = "/admin/integrations/leafly";

/* ========================================================================== */
/* SLICE L-42 -- "Replace my whole Leafly menu" (the certification POST)      */
/* ========================================================================== */

/**
 * Why this replaced the old method-dropdown push action.
 *
 * The owner: "the push post and push put buttons throw errors when pressed".
 * They went through the all-or-nothing `pushLeaflyMenu`, which refuses the
 * whole menu when ANY product fails Leafly's checks. He also said: "we have
 * to prove we can successfully complete every action. So we will need to
 * have a successful push post ... unless the auto sync does a push post".
 * Automation POSTs only when nothing is held back (auto-sync-core A1), so this
 * button is how a POST is proved. It is built exactly like "Send my whole
 * menu, hold back only the bad ones" and differs only in the verb, with the
 * consequence of that verb (held-back products leave Leafly) shown by name
 * and accepted by the owner first. Rules: src/lib/leafly/replace-menu-core.ts.
 *
 * Bracketed by a manual run row exactly as the old action was (L-7), so the
 * scheduler stands aside while it runs. Its row records method POST with a
 * success, which is also what the schedule's "has today's full sync happened"
 * evidence rule counts.
 */
export type ReplaceMenuPreviewActionResult =
  | { ok: true; preview: ReplaceMenuPreview }
  | { ok: false; error: string };

export async function previewReplaceLeaflyMenuAction(input: {
  repair?: boolean;
}): Promise<ReplaceMenuPreviewActionResult> {
  await requirePermission("settings.manage");
  // No readiness gate: a preview sends nothing (same as the whole-menu preview).
  try {
    return { ok: true, preview: await previewReplaceLeaflyMenu({ repair: input?.repair === true }) };
  } catch (err) {
    if (err instanceof PreflightBlockedError) {
      return {
        ok: false,
        error:
          "The menu data itself failed its safety check, so no payload could be built. " +
          "This is about the feed, not individual products.",
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Could not preview the replacement." };
  }
}

export type ReplaceMenuActionResult =
  | { ok: true; result: ReplaceMenuResult }
  | { ok: false; error: string };

export async function replaceLeaflyMenuAction(input: {
  confirm: boolean;
  repair?: boolean;
  acknowledgedWithheldCount: number | null;
}): Promise<ReplaceMenuActionResult> {
  const session = await requirePermission("settings.manage");
  if (!input?.confirm) {
    return { ok: false, error: "Confirmation required to replace the Leafly menu." };
  }
  const gate = await requireLeaflyReady();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const ack =
    typeof input.acknowledgedWithheldCount === "number" &&
    Number.isInteger(input.acknowledgedWithheldCount) &&
    input.acknowledgedWithheldCount >= 0
      ? input.acknowledgedWithheldCount
      : null;

  const manualRunId = await beginManualRun(session.userId);
  try {
    const result = await replaceLeaflyMenu({
      confirm: true,
      repair: input.repair === true,
      acknowledgedWithheldCount: ack,
    });

    if (!result.sent) {
      // Refused by the plan: nothing transmitted, so "skipped", never a
      // channel failure that would count towards the backoff.
      await finishManualRun({
        id: manualRunId,
        ok: true,
        skipped: true,
        method: null,
        errorDetail: result.message,
      });
      revalidatePath(BASE);
      return { ok: true, result };
    }

    await finishManualRun({
      id: manualRunId,
      ok: result.ok,
      skipped: false,
      method: "POST",
      httpStatus: result.httpStatus,
      itemCount: result.itemCount,
      planSummary: result.plan.summary,
      errorDetail: result.ok ? null : result.message,
    });
    const held = result.preview.withheld;
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: result.ok ? "ok" : "error",
      itemCount: result.itemCount,
      // The FULL body: the read-back compares against the last full send.
      payload: result.payload,
      response: result.response,
      message:
        `Replace whole menu (POST): ${result.message}` +
        (held.length > 0 ? ` Held back ${held.length}: ${held.map((w) => w.name).join("; ")}` : ""),
      createdBy: session.userId,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: result.ok ? "leafly.push.replace.success" : "leafly.push.replace.error",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        method: "POST",
        httpStatus: result.httpStatus,
        sent: result.itemCount,
        withheldIds: held.map((w) => w.id),
        removedIds: result.plan.removedIds,
        removedHeldIds: result.plan.removedHeldIds,
        acknowledgedWithheldCount: ack,
        repair: input.repair === true,
        syncStateWritten: result.syncStateWritten,
      },
    });
    revalidatePath(BASE);
    return { ok: true, result };
  } catch (err) {
    const blocked = err instanceof PreflightBlockedError;
    const message = err instanceof Error ? err.message : "Replacing the Leafly menu failed.";
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

/* ========================================================================== */
/* TASK J ask 3 -- send the full menu, withholding the bad ones               */
/* ========================================================================== */

export type FullMenuPreviewActionResult =
  | { ok: true; preview: FullMenuPreviewResult }
  | { ok: false; error: string };

/**
 * Show what "send the good ones" would do. Touches no network to Leafly.
 *
 * This is also the answer to the owner's "I'm not sure what you mean by
 * stage 2 changes how my menu looks to shoppers". Running this with
 * `repair: true` lists, by name, every product that would be created by a
 * split -- so he can look at the actual names a shopper would see before
 * anything is transmitted, instead of taking a sentence on trust.
 */
export async function previewFullMenuPassingOnlyAction(input: {
  repair?: boolean;
}): Promise<FullMenuPreviewActionResult> {
  await requirePermission("settings.manage");
  // NOTE: no `requireLeaflyReady` gate here, deliberately. A preview sends
  // nothing, and refusing to let the owner LOOK at his own menu because a
  // credential is missing would be gatekeeping the diagnosis behind the
  // thing being diagnosed.
  try {
    const preview = await previewFullMenuPassingOnly({ repair: input?.repair === true });
    return { ok: true, preview };
  } catch (err) {
    if (err instanceof PreflightBlockedError) {
      return {
        ok: false,
        error:
          `The menu data itself failed its safety check, so no payload could be built. ` +
          `This is not about individual products meeting Leafly's rules — it is the feed, ` +
          `and withholding products cannot fix it.`,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not preview the menu send.",
    };
  }
}

export type FullMenuPushActionResult =
  | { ok: true; result: FullMenuPushResult }
  | { ok: false; error: string; withheldLines?: string[] };

/**
 * Send the whole menu, holding back only the products Leafly would reject,
 * and naming every one that was held back.
 *
 * ###########################################################################
 * # THE OWNER'S QUESTION                                                    #
 * #   "Is it possible to send the full menu withholding the bad ones?"     #
 * ###########################################################################
 *
 * WHY THIS IS A SEPARATE ACTION FROM `replaceLeaflyMenuAction`
 *
 * `replaceLeaflyMenuAction` is the certification POST. POST tells
 * Leafly "this is the entire menu" and Leafly deletes everything omitted.
 * This action omits products on purpose, so it must never POST — and the way
 * to guarantee that is to call a function that has no POST path in it at all,
 * rather than to add another conditional to one that does.
 *
 * WHY THE MANUAL-RUN LOCK IS STILL TAKEN
 *
 * This is a real menu publish, so the scheduler must stand aside exactly as
 * it does for the ordinary push. As there, a failure to write the lock row
 * does NOT stop the publish: a person has pressed the button and confirmed.
 */
export async function pushFullMenuPassingOnlyAction(input: {
  confirm: boolean;
  repair?: boolean;
}): Promise<FullMenuPushActionResult> {
  const session = await requirePermission("settings.manage");
  if (!input?.confirm) {
    return { ok: false, error: "Confirmation required to send the menu to Leafly." };
  }
  const gate = await requireLeaflyReady();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const manualRunId = await beginManualRun(session.userId);

  try {
    const result = await pushFullMenuPassingOnly({
      confirm: true,
      repair: input.repair === true,
    });

    await finishManualRun({
      id: manualRunId,
      ok: result.ok,
      skipped: false,
      method: result.method,
      httpStatus: result.httpStatus,
      itemCount: result.itemCount,
      planSummary: `${result.itemCount} sent, ${result.withheldCount} held back`,
      errorDetail: result.ok ? null : result.message,
    });

    // The durable record NAMES what was withheld. A held-back product that
    // appears in no log is exactly the failure mode this whole area exists
    // to prevent: silently missing from the menu for months.
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: result.ok ? "ok" : "error",
      itemCount: result.itemCount,
      payload: result.payload,
      response: result.response,
      message:
        `${result.message}` +
        (result.withheldCount > 0
          ? ` Held back ${result.withheldCount}: ${result.withheld
              .map((w) => w.itemName ?? w.itemId)
              .join("; ")}`
          : "") +
        // The certification record must show shopper-visible changes too. A
        // send that turned one product into three listings altered the live
        // menu in a way a customer can see, and that belongs in the same
        // durable record as the transmission itself.
        (result.splitNarrative !== null && result.splitPreview?.noChange === false
          ? ` ${result.splitNarrative}`
          : ""),
      createdBy: session.userId,
    });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: result.ok
        ? "leafly.push.passing_only.success"
        : "leafly.push.passing_only.error",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        feedCount: result.feedCount,
        sent: result.itemCount,
        withheld: result.withheldCount,
        withheldIds: result.withheld.map((w) => w.itemId),
        httpStatus: result.httpStatus,
        repairRequested: input.repair === true,
        repair: result.repair,
        syncStateWritten: result.syncStateWritten,
        // NAME the shopper-visible changes, do not merely count them.
        //
        // A split creates listings that a customer can see and order from. Six
        // weeks later the only question anybody asks is "where did this
        // listing come from?", and a stored count of 9 cannot answer it. The
        // ids and names are recorded so it can be answered from the audit
        // trail alone, without re-running anything.
        splitCreatedListings:
          result.splitPreview?.changes.flatMap((c) =>
            c.listings.map((l) => ({ id: l.id, name: l.name, from: c.currentId })),
          ) ?? [],
        splitRefusals:
          result.splitPreview?.refusals.map((r) => ({ id: r.itemId, name: r.itemName })) ?? [],
      },
    });

    revalidatePath(BASE);
    return { ok: true, result };
  } catch (err) {
    // A refusal means NOTHING was transmitted. It is recorded as "skipped"
    // rather than "error" for the same reason a preflight block is: it is not
    // a channel failure and must not count towards the backoff.
    if (err instanceof FullMenuRefusedError) {
      await finishManualRun({
        id: manualRunId,
        ok: true,
        skipped: true,
        method: null,
        errorDetail: err.build.narrative,
      });
      await recordSyndicationLog({
        channel: "leafly",
        mode: "live",
        status: "skipped",
        itemCount: 0,
        message: err.build.narrative,
        createdBy: session.userId,
      });
      revalidatePath(BASE);
      return {
        ok: false,
        error: err.build.narrative,
        withheldLines: err.build.withheldLines,
      };
    }

    const blocked = err instanceof PreflightBlockedError;
    const message = err instanceof Error ? err.message : "Sending the menu failed.";
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
    // TASK I. Same reasoning as the line above: the panel renders this control,
    // so omitting the key here would reset the owner's choice to "block" on
    // every unrelated save and he would never be told.
    "invalidItemPolicy",
  ]) {
    const v = formData.get(key);
    if (v !== null) raw[key] = v;
  }
  // Carry the schedule across untouched. This form has no schedule controls, so
  // it must not express an opinion about the schedule.
  raw["schedule"] = existing.schedule;

  // TASK H (L-22) — the low-stock rule. This form DOES own these controls, so
  // unlike `schedule` it must build the block rather than carry it across.
  //
  // Read the warning at the top of this function before touching this. The
  // per-category overrides are NOT rendered by this form, so they are carried
  // across from storage exactly as the schedule is; building the block from the
  // two submitted fields alone would wipe them on every save.
  //
  // `minimumStock` is read only when present. A missing field means the input
  // was not rendered (non-Leafly channel, or an older cached form), and in that
  // case the stored value must survive rather than collapse to 0 — silently
  // switching a safety rule off is the one direction this must never fail in.
  const modeSubmitted = formData.get("visibilityMode");
  const minSubmitted = formData.get("visibilityMinimumStock");
  raw["visibility"] = {
    mode: modeSubmitted !== null ? modeSubmitted : existing.visibility.mode,
    minimumStock:
      minSubmitted !== null ? minSubmitted : existing.visibility.minimumStock,
    perCategory: existing.visibility.perCategory,
  };

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
    // SLICE L-41. Explicit "true"/"false" from the panel, strict on read.
    repairSizes: readBool("repairSizes"),
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
 * it. On Vercel Hobby that wait was up to 24 hours (one cron tick per day).
 * Since L-34 the project is on Vercel Pro and the cron ticks every fifteen
 * minutes, which is better but still a wait: discovering a typo'd credential
 * even fifteen minutes later is worse than a button that proves it in two
 * seconds, so the button stays.
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
  // FINDING J-4: this is the exact button the owner reported -- "check
  // integration status", clicked twice without leaving the page, working the
  // first time and failing the second.
  const gate = await requireLeaflyReady();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
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
  // FINDING J-4: refresh-then-check via the shared gate.
  const gate = await requireLeaflyReady();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
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

// ---------------------------------------------------------------------------
// TASK I -- removing products from the Leafly menu
// ---------------------------------------------------------------------------

export type DeleteActionResult =
  | {
      ok: true;
      /** Ids we actually asked Leafly to remove. */
      ids: string[];
      httpStatus: number;
      /** Owner-facing confirmation. */
      message: string;
      /**
       * Ids we have no record of sending. Leafly answers these with a cheerful
       * success, so without this the owner cannot tell a real removal from a
       * typo. Empty when everything was recognised OR when we had no record to
       * check against (see `checked`).
       */
      unknownIds: string[];
      /** False when we had no sync state, i.e. the warning above is not evidence of anything. */
      checked: boolean;
      /** Non-null when at least one id looked like a typo. */
      warning: string | null;
    }
  | { ok: false; error: string };

/**
 * Remove specific products from the Leafly menu (HTTP DELETE).
 *
 * WHY THIS EXISTS AT ALL.
 *
 * `deleteLeaflyItems()` has been sitting in push.ts issuing a correct DELETE
 * for some time with NO CALLER ANYWHERE. A grep across every .ts and .tsx in
 * the repo found exactly one mention: a test asserting the targeted item
 * picker does NOT use it. So the capability was built, guarded, and never
 * given a door. The owner could not remove a product he had published, and
 * Leafly's certification checklist expects to see DELETE traffic.
 *
 * WHY NOT JUST REUSE THE FULL SYNC.
 *
 * A POST full sync already deletes anything absent from the feed, and that is
 * the right mechanism for the normal case. It is the wrong mechanism for "this
 * one product must come off the menu now", because it requires the item to
 * first disappear from the source feed and then requires pushing all ~2,500
 * items to express a one-item intention. This is the surgical instrument.
 *
 * WHY THE UNKNOWN-ID CHECK IS NOT OPTIONAL POLISH.
 *
 * Leafly returns success for a DELETE naming an id that is not on the menu --
 * correctly, since the end state they were asked for is already true. The
 * consequence is that a typo and a real removal are indistinguishable from the
 * response alone. We therefore compare the request against our own record of
 * what we have sent and say so plainly. When we have no record we say THAT
 * instead of inventing reassurance: `checked: false` is an honest answer and a
 * confident-sounding guess is not.
 *
 * The delete still PROCEEDS when ids look unknown. Our sync state is our
 * belief, not Leafly's ground truth -- it can be stale, it can have been reset,
 * and an item pushed by a targeted push may never have entered it. Refusing a
 * removal on the strength of our own bookkeeping would be the worse failure:
 * the owner would be unable to take a product down. So we act and we warn.
 */
export async function deleteLeaflyItemsAction(
  formData: FormData,
): Promise<DeleteActionResult> {
  const session = await requirePermission("settings.manage");
  const confirm = formData.get("confirm") === "true";
  const rawIds = formData.get("ids");

  if (!confirm) {
    return { ok: false, error: "Confirmation required to remove products from Leafly." };
  }
  // FINDING J-4: refresh-then-check via the shared gate.
  const gate = await requireLeaflyReady();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  // Parse BEFORE the credential-spending call. A malformed request must cost
  // nothing and must never reach Leafly.
  const parsed = parseDeleteIds(typeof rawIds === "string" ? rawIds : null);
  if (!parsed.ok) {
    return { ok: false, error: describeDeleteProblems(parsed) ?? "The list of IDs could not be read." };
  }

  // Our belief about what is live. Best-effort: if this read fails we proceed
  // unchecked rather than blocking the removal.
  let known: Set<string> | null = null;
  try {
    const state = await getSyncState("leafly");
    // An empty map means "we have no record", not "nothing is live". Treating
    // it as the latter would flag every single id as a typo on a fresh state.
    if (state.hashes.size > 0) known = new Set(state.hashes.keys());
  } catch {
    known = null;
  }
  const reconciliation = reconcileDeleteRequest(parsed.ids, known);
  const warning = describeUnknownDeleteIds(reconciliation);

  try {
    const result = await deleteLeaflyItems({ ids: parsed.ids, confirm: true });
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: result.ok ? "ok" : "error",
      itemCount: result.itemCount,
      payload: result.payload,
      response: result.response,
      message: result.message,
      createdBy: session.userId,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: result.ok ? "leafly.delete.success" : "leafly.delete.error",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        ids: parsed.ids,
        itemCount: result.itemCount,
        httpStatus: result.httpStatus,
        unknownIds: reconciliation.unknown,
        checkedAgainstSyncState: reconciliation.checked,
      },
    });
    revalidatePath(BASE);

    if (!result.ok) {
      return {
        ok: false,
        error: result.message ?? `Leafly returned HTTP ${result.httpStatus}.`,
      };
    }
    return {
      ok: true,
      ids: parsed.ids,
      httpStatus: result.httpStatus,
      message: describeDeleteOutcome(parsed.ids.length),
      unknownIds: reconciliation.unknown,
      checked: reconciliation.checked,
      warning,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Leafly delete failed.";
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: "error",
      itemCount: 0,
      message,
      createdBy: session.userId,
    });
    revalidatePath(BASE);
    return { ok: false, error: message };
  }
}

/* ========================================================================== */
/* Menu browser (ROADMAP R8 -- owner ask 6)                                   */
/* ========================================================================== */

export type MenuBrowserActionResult =
  | { ok: true; result: MenuBrowserResult }
  | { ok: false; error: string };

/**
 * List what is on the Leafly menu so it can be found by name and removed.
 *
 * ###########################################################################
 * # THE OWNER'S WORDS                                                       #
 * #                                                                        #
 * #   "there is no way to know what's on the menu so we can delete         #
 * #    something ... i want ... the enterprise grade solution that allows  #
 * #    me to delete products in an easy, efficient, effective,             #
 * #    intelligent way."                                                   #
 * ###########################################################################
 *
 * Filtering and sorting happen on the SERVER because the menu can be
 * thousands of rows and the browser should not be asked to hold all of them
 * to answer "show me everything from this vendor".
 */
export async function browseLeaflyMenuAction(input: {
  query?: string | null;
  brand?: string | null;
  vendor?: string | null;
  type?: string | null;
  orphanedOnly?: boolean;
  hiddenOnly?: boolean;
  sort?: MenuBrowserSort;
}): Promise<MenuBrowserActionResult> {
  await requirePermission("settings.manage");
  // FINDING J-4: refresh-then-check via the shared gate, so a cold lambda
  // never reports configured credentials as missing.
  const gate = await requireLeaflyReady();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  try {
    const result = await loadLeaflyMenuBrowser({
      filter: {
        query: input.query ?? null,
        brand: input.brand ?? null,
        vendor: input.vendor ?? null,
        type: input.type ?? null,
        orphanedOnly: input.orphanedOnly === true,
        hiddenOnly: input.hiddenOnly === true,
      },
      sort: input.sort ?? "name",
    });
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not list what is on the Leafly menu.",
    };
  }
}

/**
 * Remove products chosen from the browser, confirming by NAME.
 *
 * WHY THIS EXISTS ALONGSIDE `deleteLeaflyItemsAction`
 *
 * That action takes a textarea of ids, which is the thing the owner said was
 * unusable. This one takes the ids the UI already holds for rows he ticked,
 * and — crucially — reports back the NAMES of what was removed, so the
 * confirmation he reads is in the same language as the list he chose from.
 *
 * The id list still travels, because the Leafly DELETE contract is by id and
 * nothing else would be exact. The difference is that the owner never types
 * one, never reads one, and never has to recognise one.
 */
export async function deleteLeaflyMenuSelectionAction(input: {
  ids: string[];
  confirm: boolean;
}): Promise<DeleteActionResult> {
  const session = await requirePermission("settings.manage");
  if (input.confirm !== true) {
    return { ok: false, error: "Confirmation required to remove products from Leafly." };
  }
  const gate = await requireLeaflyReady();
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  // Reuse the SAME parser the textarea path uses, rather than trusting the
  // client. A selection arriving over the wire is still input.
  const parsed = parseDeleteIds((input.ids ?? []).join("\n"));
  if (!parsed.ok) {
    return {
      ok: false,
      error: describeDeleteProblems(parsed) ?? "The selected products could not be read.",
    };
  }

  // Resolve names BEFORE deleting. Afterwards the product may be gone from
  // every source we could ask, and a confirmation that can only say "3 items
  // removed" is exactly the unusable feedback being replaced here.
  let labels: string[] = [];
  try {
    const identities = await loadProductIdentities(parsed.ids);
    labels = parsed.ids.map((id) => {
      const identity = identities.get(id);
      if (identity === undefined) return `Unknown product (id ${id})`;
      return describeProductIdentity(identity);
    });
  } catch {
    labels = [];
  }

  let known: Set<string> | null = null;
  try {
    const state = await getSyncState("leafly");
    if (state.hashes.size > 0) known = new Set(state.hashes.keys());
  } catch {
    known = null;
  }
  const reconciliation = reconcileDeleteRequest(parsed.ids, known);
  const warning = describeUnknownDeleteIds(reconciliation);

  try {
    const result = await deleteLeaflyItems({ ids: parsed.ids, confirm: true });
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: result.ok ? "ok" : "error",
      itemCount: parsed.ids.length,
      response: result.response,
      message:
        `Leafly delete (from menu browser) — removed ${parsed.ids.length}: ` +
        `${labels.length > 0 ? labels.join("; ") : parsed.ids.join(", ")}`,
      createdBy: session.userId,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: result.ok ? "leafly.menu.delete.success" : "leafly.menu.delete.error",
      entityType: "syndication",
      entityId: "leafly",
      after: {
        ids: parsed.ids,
        // Names in the audit trail: a reviewer six months from now should not
        // have to resolve an id against a table that may no longer hold it.
        labels,
        httpStatus: result.httpStatus,
        unknownToUs: reconciliation.unknown,
      },
    });
    revalidatePath(BASE);

    const named =
      labels.length > 0
        ? ` Removed: ${labels.slice(0, 5).join("; ")}${labels.length > 5 ? `; and ${labels.length - 5} more` : ""}.`
        : "";
    return {
      ok: true,
      ids: parsed.ids,
      httpStatus: result.httpStatus,
      message: `${describeDeleteOutcome(parsed.ids.length)}${named}`,
      unknownIds: reconciliation.unknown,
      checked: reconciliation.checked,
      warning,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not remove the selected products.";
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: "error",
      itemCount: 0,
      message: `Leafly delete (from menu browser) failed — ${message}`,
      createdBy: session.userId,
    });
    revalidatePath(BASE);
    return { ok: false, error: message };
  }
}
