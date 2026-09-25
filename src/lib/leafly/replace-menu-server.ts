/**
 * src/lib/leafly/replace-menu-server.ts  (SLICE L-42)
 *
 * The one button that sends a POST -- Leafly's "replace my whole menu".
 *
 * WHY A BUTTON AND NOT JUST AUTOMATION. The owner: "Unless the auto sync does
 * a push post command, then we won't need a dedicated push post command
 * button". Verified in auto-sync-core.ts: the automatic daily run POSTs only
 * when NOTHING is held back (invariant A1), because a POST deletes every
 * product it omits. While any product is held back, automation sends PUT. So
 * certification's "successful POST" needs this button. See the header of
 * replace-menu-core.ts for the full reasoning and the invariants.
 *
 * WHY IT IS NOT THE OLD "Push POST" BUTTON. That one went through the
 * all-or-nothing `pushLeaflyMenu`, which throws on the first product that
 * fails Leafly's checks -- the errors the owner saw. This builds its payload
 * with `buildFullMenuDecision`, exactly like "Send my whole menu, hold back
 * only the bad ones" (which he reports works), and only the verb differs.
 *
 * TRANSPORT. Sent through `sendLeaflyMenuRequest` in push.ts, so this file is
 * NOT a new `leaflyFetchWithDeadline` caller (tests/compliance/
 * leafly-deadline.test.ts keeps that list exhaustive). The operation is
 * `full_menu_push`: the same 60-second budget as the whole-menu PUT, because
 * it is the same payload.
 */
import "server-only";

import { __internals as fullMenuInternals } from "./full-menu-server";
import { isLeaflyConfigured, sendLeaflyMenuRequest } from "./push";
import { refreshLeaflyConfig } from "./runtime";
import { getLeaflyConfig } from "./config";
import { splitParentId } from "./fix-link-core";
import { planReplaceMenu, type ReplaceMenuPlan } from "./replace-menu-core";
import type { LeaflyItemsPayload } from "./payload-core";
import {
  clearForceResendFlag,
  getLeaflySyncSettings,
  getSyncState,
  saveSyncState,
} from "@/lib/syndication/engine-store";
import { hashItems } from "@/lib/syndication/sync-plan-core";

/** A named product for the owner's screen. */
export type ReplaceMenuNamed = { id: string; name: string };

export type ReplaceMenuPreview = {
  plan: ReplaceMenuPlan;
  feedCount: number;
  /** Held-back products, by name, with the reasons Leafly would refuse them. */
  withheld: { id: string; name: string; reasons: string[]; fixHref: string | null }[];
  /** Products Leafly will remove because they are held back (R7), by name. */
  removedHeld: ReplaceMenuNamed[];
  /** Products Leafly will remove because the shop no longer lists them. */
  removedRetired: string[];
  repairApplied: boolean;
  environment: "sandbox" | "production";
};

export type ReplaceMenuResult = {
  /** False when nothing was transmitted (see `plan.refusal`). */
  sent: boolean;
  ok: boolean;
  method: "POST";
  httpStatus: number;
  itemCount: number;
  plan: ReplaceMenuPlan;
  preview: ReplaceMenuPreview;
  /** The exact body sent -- stored so a later read-back compares against it. */
  payload: LeaflyItemsPayload;
  response: unknown;
  message: string;
  syncStateWritten: boolean;
};

async function build(input: {
  repair: boolean;
  acknowledgedWithheldCount: number | null;
  confirm: boolean;
}) {
  await refreshLeaflyConfig();
  const b = await fullMenuInternals.buildFullMenuDecision({ repair: input.repair });
  const state = await getSyncState("leafly");
  const withheldIds = b.withheld.map((w) => w.itemId);
  const plan = planReplaceMenu({
    planProceeds: b.plan.proceed,
    planNarrative: b.narrative,
    sendIds: b.plan.sendIds,
    withheldIds,
    previousIds: [...state.hashes.keys()],
    acknowledgedWithheldCount: input.acknowledgedWithheldCount,
    confirm: input.confirm,
    familyOf: (id) => splitParentId(id) ?? id,
  });

  const nameOf = new Map<string, string>();
  for (const w of b.withheld) nameOf.set(w.itemId, w.itemName ?? w.itemId);
  const heldSet = new Set(plan.removedHeldIds);
  const preview: ReplaceMenuPreview = {
    plan,
    feedCount: b.feedCount,
    withheld: b.withheld.map((w) => ({
      id: w.itemId,
      name: w.itemName ?? w.itemId,
      reasons: w.reasons,
      fixHref: w.fixHref,
    })),
    removedHeld: plan.removedHeldIds.map((id) => ({
      id,
      name: nameOf.get(id) ?? nameOf.get(splitParentId(id) ?? id) ?? id,
    })),
    removedRetired: plan.removedIds.filter((id) => !heldSet.has(id)),
    repairApplied: input.repair,
    environment: getLeaflyConfig().environment,
  };
  return { b, state, plan, preview };
}

/** Build and decide; transmits nothing. */
export async function previewReplaceLeaflyMenu(input: {
  repair: boolean;
}): Promise<ReplaceMenuPreview> {
  // The preview reports the plan as if the owner had accepted the current
  // held-back count, so it shows WHAT would happen rather than "tick the box".
  const probe = await build({ repair: input.repair, acknowledgedWithheldCount: null, confirm: false });
  return {
    ...probe.preview,
    plan: planReplaceMenu({
      planProceeds: probe.b.plan.proceed,
      planNarrative: probe.b.narrative,
      sendIds: probe.b.plan.sendIds,
      withheldIds: probe.b.withheld.map((w) => w.itemId),
      previousIds: [...probe.state.hashes.keys()],
      acknowledgedWithheldCount: probe.b.withheld.length,
      confirm: true,
      familyOf: (id) => splitParentId(id) ?? id,
    }),
  };
}

/**
 * Replace the Leafly menu with every passing product (POST).
 *
 * Returns `sent: false` -- and makes no network call -- whenever the pure plan
 * refuses (R2-R5). Throws only for "could not even build" failures (not
 * configured, preflight blocked, feed unreadable).
 */
export async function replaceLeaflyMenu(input: {
  confirm: boolean;
  repair: boolean;
  acknowledgedWithheldCount: number | null;
}): Promise<ReplaceMenuResult> {
  await refreshLeaflyConfig();
  if (!isLeaflyConfigured()) {
    throw new Error("Leafly is not configured: set menu integration key + OAuth credentials.");
  }
  const { b, plan, preview } = await build({
    repair: input.repair === true,
    acknowledgedWithheldCount: input.acknowledgedWithheldCount,
    confirm: input.confirm === true,
  });

  const byId = new Map(b.items.map((i) => [i.id, i]));
  const items = plan.postIds
    .map((id) => byId.get(id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const payload: LeaflyItemsPayload = { items };

  // Belt and braces for R2 at the wire: the plan's ids must all resolve.
  if (!plan.proceed || items.length === 0 || items.length !== plan.postIds.length) {
    return {
      sent: false,
      ok: false,
      method: "POST",
      httpStatus: 0,
      itemCount: 0,
      plan,
      preview,
      payload: { items: [] },
      response: null,
      message: plan.proceed
        ? "Nothing was sent: the products to send could not be matched to the built menu. Press \u201cCheck what a POST would do\u201d again."
        : plan.reason,
      syncStateWritten: false,
    };
  }

  const settings = await getLeaflySyncSettings();
  const r = await sendLeaflyMenuRequest({
    method: "POST",
    operation: "full_menu_push",
    body: payload,
    maxRetries: settings.maxRetries,
  });

  // After a successful POST, Leafly holds EXACTLY what was sent, so the stored
  // map becomes exactly that. Held-back ids drop out: they are genuinely no
  // longer on Leafly, and keeping them would make the next run believe so.
  let syncStateWritten = false;
  if (r.ok) {
    try {
      await saveSyncState("leafly", hashItems(items, (i) => i.id), b.versionId);
      syncStateWritten = true;
    } catch {
      // The menu IS on Leafly. The worst case is the next run re-sends some
      // unchanged products, which is harmless.
    }
    if (settings.forceResend) await clearForceResendFlag("leafly").catch(() => undefined);
  }

  const waitHint = preview.environment === "production" ? "~5 min" : "~2.5 min";
  return {
    sent: true,
    ok: r.ok,
    method: "POST",
    httpStatus: r.status,
    itemCount: items.length,
    plan,
    preview,
    payload,
    response: r.body,
    message: r.ok
      ? `${plan.reason} Allow ${waitHint} before reading the menu back.`
      : (r.message ?? `Leafly responded ${r.status}.`),
    syncStateWritten,
  };
}
