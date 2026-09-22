/**
 * src/lib/leafly/full-menu-server.ts  (TASK J ask 3 -- the I/O half)
 *
 * "Send my whole menu, but hold back the ones Leafly would reject, and tell
 * me which ones they are."
 *
 * Every DECISION lives in `full-menu-core.ts`, which is pure and provable in
 * CI without a database. This file reads the feed, builds the payload with
 * the SAME builders the ordinary full sync uses, optionally repairs it,
 * validates it, and transmits.
 *
 * ===========================================================================
 * WHY THIS IS NOT `pushLeaflySelection({ ids: everything })`
 * ===========================================================================
 *
 * That was the first design, and it is wrong for two independent reasons,
 * both discovered by reading the code rather than assuming:
 *
 *   1. `planSelectionPush` REFUSES above `TARGETED_PUSH_MAX_ITEMS` (250), with
 *      the message "Past that it is a real menu publish, not a test -- use the
 *      full sync button". The owner's menu is several hundred products. The
 *      targeted path is structurally incapable of carrying it, and raising the
 *      cap would demolish the very guarantee that makes the picker safe.
 *
 *   2. `pushLeaflySelection` deliberately never writes sync state and never
 *      deletes. For a TARGETED push that is exactly right. For a full menu it
 *      is wrong: the delta engine's model of what Leafly holds would never be
 *      updated, so the next ordinary sync would compute its delta against a
 *      stale map.
 *
 * ===========================================================================
 * WHY THIS IS NOT A FLAG ON `pushLeaflyMenu`
 * ===========================================================================
 *
 * `pushLeaflyMenu` already has `invalidItemPolicy: "quarantine"`, which is
 * the closest existing thing. It was measured against the owner's real
 * situation and it does not answer his question:
 *
 *   - It is a PERSISTENT SETTING, not a decision at the moment of the push.
 *     The owner asked for an action, not a preference he has to remember he
 *     turned on six months ago.
 *   - It has NO PREVIEW. He cannot see what would be held back before it is.
 *   - Decisively: it REFUSES at >= 25% failure. A reproduction through the
 *     real builder and real validator put his pre-roll-heavy menu at 33.3%,
 *     where quarantine sends NOTHING and says "this needs a developer".
 *
 * The fix for that last point is NOT to weaken the ceiling -- the ceiling is
 * correct, and it is the alarm that catches a genuine builder defect. The fix
 * is to REMOVE THE CAUSE before the alarm is consulted. Hence `repair` below,
 * which the same reproduction proved takes 600 products with 200 collisions
 * to 1000 products with 0 collisions and nothing withheld at all.
 *
 * ===========================================================================
 * WHAT IS SHARED, DELIBERATELY
 * ===========================================================================
 *
 * The feed loader, the preflight, the payload builder, the settings toggles,
 * the DOH/endorsement reads, the collision repair and the contract validator
 * -- all the same functions the ordinary sync calls. If this built its
 * payload differently, a clean send here would prove nothing about the real
 * thing. The ONLY thing that differs is what happens to a product the
 * validator rejects: the ordinary sync stops, and this one sets it aside,
 * names it, and sends the rest.
 *
 * ===========================================================================
 * SAFETY: WHY THIS SENDS PUT AND NEVER POST
 * ===========================================================================
 *
 * POST means "this is the entire menu" to Leafly, and Leafly deletes anything
 * omitted. This function omits things ON PURPOSE -- that is its whole job. A
 * POST of a withheld menu would therefore DELETE every held-back product from
 * the live Leafly menu, turning "hold this back until you fix it" into
 * "destroy this". The verb is hard-coded, not defaulted, and there is no
 * parameter that can change it.
 *
 * Sync state IS written, but only for the items actually sent, and the
 * withheld ids are deliberately left untouched in the map so the next
 * ordinary sync still sees them as pending rather than believing they were
 * published.
 */
import "server-only";

import { getLeaflyBaseUrl, getLeaflyConfig } from "./config";
import { getLeaflyAccessToken, resetLeaflyTokenCache } from "./token";
import { leaflyFetchWithDeadline } from "./deadline-fetch";
import type { LeaflyOperation } from "./deadline-core";
import { refreshLeaflyConfig } from "./runtime";
import {
  buildLeaflyItemsResult,
  type LeaflyItem,
  type LeaflyItemsPayload,
} from "./payload-core";
import { validateLeaflyPayload } from "./payload-validate-core";
import { repairAndSplitBuiltPayload } from "./collision-apply-server";
import { resolveFixLink, type FixLinkKind } from "./fix-link-core";
import {
  planFullMenuPush,
  describeFullMenuPlan,
  describeWithheldProducts,
  type FullMenuPlan,
  type FullMenuRepairSummary,
} from "./full-menu-core";
// The owner's fourth question, answered with names rather than counts. The
// split engine already computes the product names a shopper would see; until
// this import existed they were computed and then thrown away, so the preview
// could only ever report "3 products became 9" -- which is not an answer to
// "what does this do to my menu?".
import {
  previewSplits,
  describeSplitPreview,
  describeSplitPreviewLines,
  type SplitPreview,
  type SplitPreviewFacts,
} from "./split-preview-core";
import { isLeaflyConfigured } from "./push";
import { loadSyndicationFeed } from "@/lib/syndication/feed-source";
import { getLeaflySyncSettings, getSyncState, saveSyncState } from "@/lib/syndication/engine-store";
import { getMedTaxSettings } from "@/lib/medical/store";
import { applyLeaflySettings } from "@/lib/syndication/apply-settings-core";
import { hashItems } from "@/lib/syndication/sync-plan-core";
import { runPreflight, PreflightBlockedError } from "@/lib/syndication/preflight-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

/* ========================================================================== */
/* Network                                                                    */
/* ========================================================================== */

function menuItemsUrl(): string {
  const config = getLeaflyConfig();
  const base = getLeaflyBaseUrl(config.environment);
  return `${base}/${encodeURIComponent(config.menuIntegrationKey ?? "")}/menu/items`;
}

/**
 * Authorized fetch, mirroring `push.ts` and `selection-server.ts`: bearer
 * auth, one 401 retry after clearing the token cache, exponential backoff on
 * 429/5xx.
 *
 * As in `selection-server.ts`, this wrapper issues exactly the verb it is
 * handed, and this module only ever hands it "PUT". There is no DELETE path
 * and no POST path in this file at all -- a property that cannot be broken by
 * a future edit to a conditional, because there is no conditional.
 */
async function authedFetch(
  url: string,
  method: string,
  // SLICE L-17. Named explicitly even though this file has exactly one call
  // site, for the same reason the verb is hard-coded above: the guarantee
  // should survive an edit by somebody who has not read the header.
  operation: LeaflyOperation,
  body: unknown,
  opts?: { maxRetries?: number },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const maxAttempts = Math.max(1, (opts?.maxRetries ?? 2) + 1);
  let didRetryAuth = false;

  for (let attempt = 1; ; attempt += 1) {
    const token = await getLeaflyAccessToken();
    // SLICE L-17 -- a bounded attempt. `operation` is resolved by the caller
    // (see the `operation` parameter) because ONE wrapper serves more than
    // one endpoint here, and the budgets differ. Failure throws, which is the
    // behaviour this wrapper already had -- an unbounded `fetch` that rejects
    // propagates too. What changes is that it now rejects in finite time and
    // with a sentence the operator can act on.
    const call = await leaflyFetchWithDeadline(operation, url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!call.ok) {
      throw new Error(call.verdict.message);
    }
    const res = call.response;
    const text = await res.text().catch(() => "");
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (res.status === 401 && !didRetryAuth) {
      didRetryAuth = true;
      resetLeaflyTokenCache();
      continue;
    }
    if ((res.status === 429 || (res.status >= 500 && res.status <= 599)) && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
      continue;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  }
}

function leaflyMessageForStatus(status: number): string {
  if (status === 401) return "Unauthorized (401): the access token is missing, invalid, or expired.";
  if (status === 403) return "Forbidden (403): the client credentials are not authorized for this menu integration key.";
  if (status === 404) return "Not found (404): verify the menu integration key (sandbox and production keys differ).";
  if (status === 422 || status === 400) return `Leafly rejected the payload (${status}).`;
  if (status === 429) return "Rate limited (429): backed off and retried.";
  if (status >= 500) return `Leafly server error (${status}); retried with backoff.`;
  return `Leafly responded ${status}.`;
}

/* ========================================================================== */
/* Shared build path                                                          */
/* ========================================================================== */

/**
 * A product the send held back, with everything the UI needs to act on it.
 *
 * `fixHref` is resolved through `resolveFixLink`, NOT through the older
 * `fixHrefFor`. The difference matters precisely here: when the repair has
 * run, a withheld product may carry a SPLIT id (`parent--1g`) that does not
 * exist in `menu_items`, and the older formatter would have produced a link
 * that 404s. The resolver sends the owner to the parent instead and says so.
 */
export type FullMenuWithheldProduct = {
  itemId: string;
  itemName: string | null;
  codes: string[];
  reasons: string[];
  fixHref: string | null;
  fixKind: FixLinkKind;
  fixNote: string | null;
};

export type FullMenuBuild = {
  versionId: string | null;
  /** Every product in the published feed, before anything was decided. */
  feedCount: number;
  /** The wire payload after settings and any repair. */
  items: LeaflyItem[];
  plan: FullMenuPlan;
  withheld: FullMenuWithheldProduct[];
  repair: FullMenuRepairSummary | null;
  /** The repair's own prose, when it ran. */
  repairNarrative: string | null;
  /** The plan's prose, always. */
  narrative: string;
  /** One line per withheld product, capped. */
  withheldLines: string[];
  /**
   * What the repair would do to the menu a SHOPPER sees, by name.
   *
   * Null when no repair ran, because with no repair there is nothing
   * shopper-visible to preview -- which is a different statement from "the
   * repair ran and changed nothing", and the UI must be able to tell those
   * two apart. `splitPreview.noChange === true` is the second case.
   */
  splitPreview: SplitPreview | null;
  /** Owner-facing paragraph for `splitPreview`. Null when it is null. */
  splitNarrative: string | null;
  /** One line per shopper-visible change, capped. */
  splitLines: string[];
};

/**
 * Build and decide, WITHOUT transmitting.
 *
 * Shared by the preview and the real send so the two can never disagree. A
 * preview that built its payload by a different route would be a rehearsal
 * for a performance nobody is going to give.
 */
async function buildFullMenuDecision(input: {
  repair: boolean;
}): Promise<FullMenuBuild> {
  await refreshLeaflyConfig();
  const { versionId, items } = await loadSyndicationFeed();

  // Preflight guards the SOURCE data, exactly as the ordinary sync does.
  //
  // This still THROWS rather than withholding, and that is deliberate.
  // Preflight failures are structural problems with the feed itself (a
  // missing price field, a malformed row) rather than one product failing
  // Leafly's contract. Withholding cannot fix a broken feed, and pretending
  // otherwise would send a partial menu built from data we already know is
  // untrustworthy.
  const preflight = runPreflight(items);
  if (!preflight.ok) {
    throw new PreflightBlockedError(preflight);
  }

  const [settings, medSettings] = await Promise.all([
    getLeaflySyncSettings(),
    getMedTaxSettings(),
  ]);

  const built = buildLeaflyItemsResult(items, {
    pickupEnabled: settings.sendPickupAvailability,
    medicallyEndorsed: medSettings.medicallyEndorsed,
  });

  // Settings first, so what follows measures the payload that is really sent.
  const settled: LeaflyItem[] = applyLeaflySettings(built.payload.items, settings);

  // Then the repair, if asked for. Same ordering, and for the same reason, as
  // `pushLeaflySelection`: after settings so it sees the real payload, before
  // validation so the validator judges the repaired result.
  const repaired = input.repair ? repairAndSplitBuiltPayload(settled, items) : null;
  const wire: LeaflyItem[] = repaired?.items ?? settled;

  // Validate what is ACTUALLY about to go over the wire.
  const validation = validateLeaflyPayload({ items: wire });

  const repairSummary: FullMenuRepairSummary | null =
    repaired === null
      ? null
      : {
          repairedItemCount: repaired.repairedItemCount,
          splitItemCount: repaired.splitItemCount,
          createdItemCount: repaired.createdItemCount,
          refusalCount: repaired.refusals.length,
          clean: repaired.clean,
        };

  const plan = planFullMenuPush({
    items: wire.map((i) => ({ id: i.id, name: i.name })),
    issues: validation.issues.map((i) => ({
      severity: i.severity,
      code: i.code,
      itemId: i.itemId,
      message: i.message,
    })),
    repair: repairSummary,
  });

  // Fix links, resolved against the ids that genuinely exist as products.
  //
  // The known set is built from the SOURCE feed, not from the wire payload,
  // because the wire payload is exactly where the synthetic ids live. Handing
  // the resolver the wire ids would let it confirm a split id as "direct" and
  // reintroduce the 404 this is here to prevent.
  const knownSourceIds = new Set(items.map((i) => i.id));

  const withheld: FullMenuWithheldProduct[] = plan.withheld.map((w) => {
    const link = resolveFixLink(w.itemId, knownSourceIds);
    return {
      itemId: w.itemId,
      itemName: w.itemName,
      codes: w.codes,
      reasons: w.reasons,
      fixHref: link.href,
      fixKind: link.kind,
      fixNote: link.note,
    };
  });

  // The shopper-visible half of the answer.
  //
  // Price and stock are read from `settled` -- the payload as it stood BEFORE
  // the split -- and joined by variant id. Reading them from `wire` would
  // work too, but `settled` is the stronger statement: it proves the numbers
  // on the preview are the numbers the product already had, not numbers the
  // split produced. If those two ever disagreed, the split would have altered
  // a price, and this join is what would expose it.
  const factsByVariantId = new Map<string, SplitPreviewFacts>();
  for (const item of settled) {
    for (const v of item.variants ?? []) {
      factsByVariantId.set(v.id, {
        price: v.price ?? null,
        inventoryLevel: v.inventoryLevel ?? null,
      });
    }
  }

  const splitPreview: SplitPreview | null =
    repaired === null
      ? null
      : previewSplits({
          splits: repaired.splits,
          refusals: repaired.refusals,
          factsByVariantId,
        });

  return {
    versionId,
    feedCount: items.length,
    items: wire,
    plan,
    withheld,
    repair: repairSummary,
    repairNarrative: repaired?.narrative ?? null,
    narrative: describeFullMenuPlan(plan),
    withheldLines: describeWithheldProducts(plan, 200),
    splitPreview,
    splitNarrative: splitPreview === null ? null : describeSplitPreview(splitPreview),
    splitLines: splitPreview === null ? [] : describeSplitPreviewLines(splitPreview, 200),
  };
}

/* ========================================================================== */
/* Preview                                                                    */
/* ========================================================================== */

export type FullMenuPreviewResult = FullMenuBuild & {
  mode: "preview";
  /** The exact payload the send would transmit. */
  payload: LeaflyItemsPayload;
};

/**
 * Show exactly what "send the good ones" would do, WITHOUT calling Leafly.
 *
 * This is the answer to the owner's fourth question. He said he did not
 * understand what "stage 2 changes how your menu looks to shoppers" meant,
 * and the honest remedy for that is not a longer sentence -- it is letting
 * him SEE it. The preview lists the products that would be created by a
 * split, by name, before anything is transmitted.
 */
export async function previewFullMenuPassingOnly(input?: {
  repair?: boolean;
}): Promise<FullMenuPreviewResult> {
  const build = await buildFullMenuDecision({ repair: input?.repair === true });
  const sendSet = new Set(build.plan.sendIds);
  return {
    ...build,
    mode: "preview",
    payload: { items: build.items.filter((i) => sendSet.has(i.id)) },
  };
}

/* ========================================================================== */
/* The send                                                                   */
/* ========================================================================== */

export class FullMenuRefusedError extends Error {
  readonly build: FullMenuBuild;
  constructor(build: FullMenuBuild) {
    super(build.narrative);
    this.name = "FullMenuRefusedError";
    this.build = build;
  }
}

export type FullMenuPushResult = {
  mode: "live";
  /** Always PUT. See the header. */
  method: "PUT";
  ok: boolean;
  httpStatus: number;
  /** How many products were actually transmitted. */
  itemCount: number;
  /** How many were held back. */
  withheldCount: number;
  feedCount: number;
  withheld: FullMenuWithheldProduct[];
  withheldLines: string[];
  repair: FullMenuRepairSummary | null;
  repairNarrative: string | null;
  plan: FullMenuPlan;
  payload: LeaflyItemsPayload;
  response: unknown;
  message: string;
  /** True when the sync-state map was updated for the sent items. */
  syncStateWritten: boolean;
  versionId: string | null;
  /**
   * What this send did to the menu a SHOPPER sees, by name.
   *
   * Carried on the RESULT, not just the preview, so the durable log can name
   * the listings that were created. A shopper-visible change recorded only as
   * a count would leave nobody able to answer "when did this listing appear?"
   * six weeks later -- and that question is exactly what an audit trail is for.
   */
  splitPreview: SplitPreview | null;
  splitNarrative: string | null;
  splitLines: string[];
};

/**
 * Send the whole menu, withholding the products Leafly would reject.
 *
 * @param input.confirm Required. Mirrors every other transmitting function
 *   here; a live menu publish is never a side effect of calling something.
 * @param input.repair Apply the collision repair first. OFF BY DEFAULT,
 *   because stage 2 of the repair changes how the menu LOOKS to a shopper by
 *   listing one product as several. That is the owner's decision to make
 *   after seeing a preview, not something a push does on his behalf.
 *
 * @throws FullMenuRefusedError when the plan refuses. Throwing rather than
 *   returning `ok: false` keeps the two cases distinguishable: a refusal
 *   means NOTHING WAS SENT and no network call was made, whereas `ok: false`
 *   means Leafly was called and said no. Collapsing them would let a caller
 *   log a transmission that never happened.
 */
export async function pushFullMenuPassingOnly(input: {
  confirm: boolean;
  repair?: boolean;
}): Promise<FullMenuPushResult> {
  if (!input.confirm) {
    throw new Error("Sending the menu requires explicit confirmation.");
  }
  await refreshLeaflyConfig();
  if (!isLeaflyConfigured()) {
    throw new Error("Leafly is not configured: set menu integration key + OAuth credentials.");
  }

  const build = await buildFullMenuDecision({ repair: input.repair === true });

  if (!build.plan.proceed) {
    throw new FullMenuRefusedError(build);
  }

  const sendSet = new Set(build.plan.sendIds);
  const toSend = build.items.filter((i) => sendSet.has(i.id));

  // BELT AND BRACES. The plan guarantees a non-empty send (rule F1); this
  // asserts it again at the transmission boundary. An empty PUT is not
  // harmful to Leafly, but reporting "sent 0 items successfully" is a lie,
  // and a lie in a sync report is how a missing menu goes unnoticed.
  if (toSend.length === 0) {
    throw new FullMenuRefusedError(build);
  }

  const settings = await getLeaflySyncSettings();
  const payload: LeaflyItemsPayload = { items: toSend };

  // PUT, hard-coded. See the header: a POST here would delete every withheld
  // product from the live Leafly menu.
  const result = await authedFetch(menuItemsUrl(), "PUT", "full_menu_push", payload, {
    maxRetries: settings.maxRetries,
  });

  // Sync state, for the SENT items only.
  //
  // The withheld ids are deliberately left exactly as they were in the stored
  // map rather than deleted from it or written with a new hash. Writing them
  // would tell the delta engine that Leafly holds a product it does not.
  // Deleting them would make the next PUT sync issue a DELETE for a product
  // that may still be live on Leafly from an earlier successful send.
  // Leaving them alone is the only option that states no falsehood.
  let syncStateWritten = false;
  if (result.ok) {
    try {
      const state = await getSyncState("leafly");
      const sentHashes = hashItems(toSend, (i) => i.id);
      const next = new Map(state.hashes);
      for (const [id, hash] of sentHashes) next.set(id, hash);
      await saveSyncState("leafly", next, build.versionId);
      syncStateWritten = true;
    } catch {
      // A sync-state write failure must not turn a successful publish into a
      // reported failure. The menu IS live; the worst case is that the next
      // sync re-sends some unchanged items, which is harmless.
      syncStateWritten = false;
    }
  }

  const config = getLeaflyConfig();
  const waitHint = config.environment === "production" ? "~5 min" : "~2.5 min";

  return {
    mode: "live",
    method: "PUT",
    ok: result.ok,
    httpStatus: result.status,
    itemCount: toSend.length,
    withheldCount: build.withheld.length,
    feedCount: build.feedCount,
    withheld: build.withheld,
    withheldLines: build.withheldLines,
    repair: build.repair,
    repairNarrative: build.repairNarrative,
    plan: build.plan,
    payload,
    response: result.body,
    message: result.ok
      ? `${build.narrative} Allow ${waitHint} before reading the menu back — comparing sooner ` +
        `shows differences that are only Leafly still ingesting.`
      : leaflyMessageForStatus(result.status),
    syncStateWritten,
    versionId: build.versionId,
    splitPreview: build.splitPreview,
    splitNarrative: build.splitNarrative,
    splitLines: build.splitLines,
  };
}

/* ========================================================================== */
/* Exported for tests                                                         */
/* ========================================================================== */

/**
 * The internal build step, exposed so the compliance suite can exercise the
 * decision path against a stubbed feed without a network. Not part of the
 * public surface; the two functions above are.
 */
export const __internals = {
  buildFullMenuDecision,
  leaflyMessageForStatus,
};

export type { SyndicationItem };
