/**
 * src/lib/leafly/auto-sync-server.ts  (SLICE L-41)
 *
 * What an AUTOMATIC Leafly menu run actually does, start to finish.
 *
 * Before L-41 the scheduler sent through `pushLeaflyMenu` -- the all-or-
 * nothing path behind the old "Push POST / Push PUT" buttons, which refuses
 * the whole menu the moment any one product fails Leafly's contract. The
 * owner's menu has such products, so automation (once it could be switched
 * on at all) would have sent nothing, every tick, and backed off.
 *
 * This module builds the payload EXACTLY the way the button the owner says
 * "works great" does -- `buildFullMenuDecision`, the engine behind "Send my
 * whole menu, hold back only the bad ones" -- and lets the pure
 * `planAutomaticTransmission` (auto-sync-core.ts) choose what to transmit:
 *
 *   daily run, nothing held back   -> POST the whole passing menu (Leafly's
 *                                     recommended daily replace)
 *   daily run, something held back -> PUT every passing product, then DELETE
 *                                     only what genuinely left. Never POST:
 *                                     a POST deletes whatever it omits, and
 *                                     a held-back product is omitted.
 *   in-between run                 -> PUT only what changed, then DELETE what
 *                                     genuinely left.
 *
 * The network goes through push.ts's bounded `authedFetch` (exported as
 * `sendLeaflyMenuRequest`), so this file adds no new outbound call site.
 *
 * Not a "use server" file: nothing here is callable from a browser. The only
 * caller is the scheduler, which is itself only reachable through the cron
 * route (CRON_SECRET) or the staff-only "Run the check now" button.
 */
import "server-only";

import { __internals as fullMenuInternals } from "./full-menu-server";
import { isLeaflyConfigured, sendLeaflyMenuRequest } from "./push";
import { refreshLeaflyConfig } from "./runtime";
import { splitParentId } from "./fix-link-core";
import { buildLeaflyDeletePayload } from "./payload-core";
import {
  autoSyncMethod,
  nextSyncHashes,
  planAutomaticTransmission,
  type AutoSyncKind,
  type AutoSyncPlan,
} from "./auto-sync-core";
import {
  clearForceResendFlag,
  getLeaflySyncSettings,
  getSyncState,
  saveSyncState,
} from "@/lib/syndication/engine-store";
import { hashItems } from "@/lib/syndication/sync-plan-core";
import { recordSyndicationLog } from "@/lib/syndication/store";

/** Same fields the scheduler already consumed from `pushLeaflyMenu`, plus the plan. */
export type LeaflyAutomaticResult = {
  ok: boolean;
  /** True when nothing needed sending (Leafly already holds exactly this). */
  skipped: boolean;
  /** True when the withhold plan refused and NOTHING was transmitted. */
  refused: boolean;
  /** The verb actually used, or null when nothing was transmitted. */
  method: "POST" | "PUT" | null;
  httpStatus: number;
  itemCount: number;
  planSummary: string;
  message: string;
  withheldCount: number;
  deletedCount: number;
  plan: AutoSyncPlan;
};

/**
 * Carry out one automatic run.
 *
 * @param input.kind    Which scheduled decision this is.
 * @param input.repair  The owner's stored "fix the size problem automatically"
 *                      choice (schedule.repairSizes). OFF unless he turned it on.
 *
 * Throws only for "could not even build" failures (not configured, preflight
 * blocked, feed unreadable) -- the scheduler records those as failed runs.
 */
export async function pushLeaflyAutomatic(input: {
  kind: AutoSyncKind;
  repair: boolean;
}): Promise<LeaflyAutomaticResult> {
  await refreshLeaflyConfig();
  if (!isLeaflyConfigured()) {
    throw new Error("Leafly is not configured: set menu integration key + OAuth credentials.");
  }

  const build = await fullMenuInternals.buildFullMenuDecision({ repair: input.repair === true });
  const settings = await getLeaflySyncSettings();
  const state = await getSyncState("leafly");

  const sendSet = new Set(build.plan.sendIds);
  const sendable = build.items.filter((i) => sendSet.has(i.id));
  const sentHashes = hashItems(sendable, (i) => i.id);
  const withheldIds = build.withheld.map((w) => w.itemId);

  const plan = planAutomaticTransmission({
    kind: input.kind,
    planProceeds: build.plan.proceed,
    planNarrative: build.narrative,
    send: sendable.map((i) => ({ id: i.id, hash: sentHashes.get(i.id) ?? "" })),
    withheldIds,
    previous: state.hashes,
    forceResend: settings.forceResend,
    familyOf: (id) => splitParentId(id) ?? id,
  });

  const heldNames = build.withheld.map((w) => w.itemName ?? w.itemId);
  const heldSuffix = heldNames.length > 0 ? ` Held back ${heldNames.length}: ${heldNames.join("; ")}` : "";
  const planSummary =
    plan.summary + (plan.postDowngraded ? " (sent as an update, not a full replacement)" : "");

  const base = {
    withheldCount: plan.counts.withheld,
    plan,
    planSummary,
  };

  if (plan.action === "refuse") {
    await recordSyndicationLog({
      channel: "leafly",
      mode: "live",
      status: "error",
      itemCount: 0,
      payload: { automatic: input.kind, action: "refuse", withheldIds },
      message: `Automatic ${label(input.kind)}: ${plan.reason}${heldSuffix}`,
    });
    return {
      ...base,
      ok: false,
      skipped: false,
      refused: true,
      method: null,
      httpStatus: 0,
      itemCount: 0,
      message: plan.reason,
      deletedCount: 0,
    };
  }

  if (plan.action === "skip") {
    // Not written to syndication_logs: the run history already records every
    // skip, and a skip every fifteen minutes would bury the real sends.
    return {
      ...base,
      ok: true,
      skipped: true,
      refused: false,
      method: null,
      httpStatus: 0,
      itemCount: 0,
      message: plan.reason,
      deletedCount: 0,
    };
  }

  const operation = input.kind === "daily_full" ? "full_menu_push" : "menu_push";
  const byId = new Map(sendable.map((i) => [i.id, i]));
  const ids = plan.action === "post" ? plan.postIds : plan.putIds;
  const items = ids.map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
  const method = autoSyncMethod(plan) as "POST" | "PUT";

  let sendOk = true;
  let sendStatus = 0;
  let sendMessage: string | null = null;
  let sendBody: unknown = null;
  if (items.length > 0) {
    const r = await sendLeaflyMenuRequest({
      method,
      operation,
      body: { items },
      maxRetries: settings.maxRetries,
    });
    sendOk = r.ok;
    sendStatus = r.status;
    sendMessage = r.message;
    sendBody = r.body;
  }

  // DELETE only after the upsert succeeded, and only ids the plan proved are
  // genuinely gone (never a held-back product or its family).
  let deleteOk = true;
  let deleteStatus = 0;
  let deleteMessage: string | null = null;
  let deleteBody: unknown = null;
  let deleteAttempted = false;
  if (sendOk && plan.action === "put" && plan.deleteIds.length > 0) {
    deleteAttempted = true;
    const r = await sendLeaflyMenuRequest({
      method: "DELETE",
      operation,
      body: buildLeaflyDeletePayload(plan.deleteIds),
      maxRetries: settings.maxRetries,
    });
    deleteOk = r.ok;
    deleteStatus = r.status;
    deleteMessage = r.message;
    deleteBody = r.body;
  }

  const ok = sendOk && deleteOk;
  if (sendOk) {
    try {
      const next = nextSyncHashes({
        plan,
        previous: state.hashes,
        sentHashes,
        deleteSucceeded: deleteAttempted && deleteOk,
      });
      await saveSyncState("leafly", next, build.versionId);
    } catch {
      // The menu IS on Leafly; the worst case is the next run re-sends some
      // unchanged products, which is harmless. Never turn a publish into a
      // reported failure over bookkeeping.
    }
  }
  if (ok && settings.forceResend) await clearForceResendFlag("leafly").catch(() => undefined);

  const httpStatus = !sendOk ? sendStatus : !deleteOk ? deleteStatus : sendStatus || deleteStatus;
  const failure = !sendOk
    ? (sendMessage ?? `Leafly responded ${sendStatus}.`)
    : !deleteOk
      ? `The products were sent, but removing ${plan.deleteIds.length} that you no longer list failed: ${deleteMessage ?? `Leafly responded ${deleteStatus}.`} The next run will try the removal again.`
      : null;
  const message = failure ?? plan.reason;

  await recordSyndicationLog({
    channel: "leafly",
    mode: "live",
    status: ok ? "ok" : "error",
    itemCount: items.length,
    // Compact on purpose: a full menu payload every fifteen minutes would
    // bloat the log. The ids are what an audit needs.
    payload: {
      automatic: input.kind,
      method,
      sentIds: ids,
      deleteIds: plan.action === "put" ? plan.deleteIds : [],
      withheldIds,
      protectedIds: plan.protectedIds,
      repair: input.repair === true,
    },
    response: { send: sendBody, delete: deleteBody },
    message: `Automatic ${label(input.kind)}: ${message} (${planSummary}).${heldSuffix}`,
  });

  return {
    ...base,
    ok,
    skipped: false,
    refused: false,
    method,
    httpStatus,
    itemCount: items.length,
    message,
    deletedCount: deleteAttempted && deleteOk ? plan.deleteIds.length : 0,
  };
}

function label(kind: AutoSyncKind): string {
  return kind === "daily_full" ? "daily full sync" : "in-between update";
}
