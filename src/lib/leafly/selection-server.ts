/**
 * src/lib/leafly/selection-server.ts  (SLICE L-18 — the item picker, I/O half)
 *
 * The network half of "push only these items". Every DECISION lives in
 * `selection-core.ts`, which is pure and provable in CI without a database;
 * this file reads the feed, builds the payload with the SAME builders the full
 * sync uses, and transmits.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE FUNCTION AND NOT A FLAG ON `pushLeaflyMenu`
 * ===========================================================================
 *
 * The obvious implementation is `pushLeaflyMenu({ onlyIds: [...] })`. It is
 * wrong, and the reason is worth stating plainly because it is the single most
 * important design decision in this slice.
 *
 * `pushLeaflyMenu` contains three behaviours that are correct for a full sync
 * and catastrophic for a subset:
 *
 *   1. It can send POST, which tells Leafly "this is the entire menu" and
 *      deletes everything omitted.
 *   2. It writes `saveSyncState(...)`, the map meaning "this is what Leafly
 *      now has".
 *   3. Its PUT arm follows the upsert with an explicit `DELETE` of every id in
 *      the previous state that is missing from the current payload.
 *
 * Under a subset, (1) and (3) each delete the entire rest of the menu and (2)
 * corrupts the delta engine's model of reality so that the NEXT sync misbehaves
 * too. Adding an `onlyIds` flag would mean three new `if`s inside a function
 * that already deletes things — and the failure mode of getting one of them
 * wrong is "the live menu is gone".
 *
 * A function that contains no DELETE call and no `saveSyncState` call cannot
 * perform either, no matter how it is invoked or what a future edit does to its
 * arguments. That property is worth more than the duplicated fetch wrapper it
 * costs. The safety is structural rather than conditional.
 *
 * WHAT IS SHARED, DELIBERATELY: the payload builder, the settings toggles, the
 * DOH/med-endorsement reads, and the contract validator. If a targeted push
 * built its payload differently from the full sync, it would stop being a
 * rehearsal for it, and a clean targeted read-back would prove nothing about
 * the real thing. The whole point is that these items go over the wire in
 * exactly the shape they would in a full sync.
 */
import "server-only";

import { getLeaflyBaseUrl, getLeaflyConfig } from "./config";
import { getLeaflyAccessToken, resetLeaflyTokenCache } from "./token";
import { refreshLeaflyConfig } from "./runtime";
import {
  buildLeaflyItemsResult,
  type LeaflyItem,
  type LeaflyItemsPayload,
  type LeaflyVariantRejection,
} from "./payload-core";
import { assertLeaflyPayloadValid, validateLeaflyPayload } from "./payload-validate-core";
import { summarizeOrderability, type OrderabilitySummary } from "./orderability-core";
import {
  computeCoverage,
  planSelectionPush,
  selectItems,
  type SelectionCoverage,
  type SelectionPlan,
  type SelectionSort,
  type SelectionSpec,
} from "./selection-core";
import { isLeaflyConfigured } from "./push";
import { loadSyndicationFeed } from "@/lib/syndication/feed-source";
import { getLeaflySyncSettings } from "@/lib/syndication/engine-store";
import { getMedTaxSettings } from "@/lib/medical/store";
import { applyLeaflySettings } from "@/lib/syndication/apply-settings-core";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

function menuItemsUrl(): string {
  const config = getLeaflyConfig();
  const base = getLeaflyBaseUrl(config.environment);
  return `${base}/${encodeURIComponent(config.menuIntegrationKey ?? "")}/menu/items`;
}

/**
 * Authorized fetch, mirroring `push.ts`: bearer auth, one 401 retry after
 * clearing the token cache, exponential backoff on 429/5xx.
 *
 * Note this wrapper knows how to issue exactly one verb — whatever it is
 * handed — and this file only ever hands it "PUT". There is no DELETE path in
 * this module at all.
 */
async function authedFetch(
  url: string,
  method: string,
  body: unknown,
  opts?: { maxRetries?: number },
) {
  const maxAttempts = Math.max(1, (opts?.maxRetries ?? 2) + 1);
  let didRetryAuth = false;

  for (let attempt = 1; ; attempt += 1) {
    const token = await getLeaflyAccessToken();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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

// ---------------------------------------------------------------------------
// Browsing the feed (no network to Leafly)
// ---------------------------------------------------------------------------

export type SelectionBrowseResult = {
  versionId: string | null;
  /** Every item in the published feed. */
  allItems: SyndicationItem[];
  /** The subset matching the spec, in display order. */
  matched: SyndicationItem[];
};

/** Load the published feed and apply a spec. Pure selection over live data. */
export async function browseLeaflySelection(
  spec: SelectionSpec,
  sort: SelectionSort = "relevance",
): Promise<SelectionBrowseResult> {
  const { versionId, items } = await loadSyndicationFeed();
  return { versionId, allItems: items, matched: selectItems(items, spec, sort) };
}

// ---------------------------------------------------------------------------
// Previewing a targeted push
// ---------------------------------------------------------------------------

export type SelectionPreviewResult = {
  mode: "preview";
  plan: SelectionPlan;
  coverage: SelectionCoverage;
  payload: LeaflyItemsPayload;
  /** Items the builder refused to represent, with the reason. */
  rejected: LeaflyVariantRejection[];
  droppedItemIds: string[];
  validationOk: boolean;
  validationErrors: string[];
  orderability: OrderabilitySummary;
  versionId: string | null;
  feedCount: number;
};

/**
 * Build the exact payload a targeted push would send, WITHOUT calling Leafly.
 *
 * Like the main preview, this REPORTS validation problems rather than throwing:
 * the purpose of a dry run is to see what is wrong, and a preview that refuses
 * to render a broken payload cannot be used to diagnose it.
 */
export async function previewLeaflySelection(input: {
  ids: readonly string[];
  requestedMethod?: "POST" | "PUT";
}): Promise<SelectionPreviewResult> {
  await refreshLeaflyConfig();
  const { versionId, items } = await loadSyndicationFeed();

  const wanted = new Set(input.ids);
  // Preserve FEED order rather than the order ids arrived in, so the preview
  // and the push agree and two previews of the same set look identical.
  const selected = items.filter((item) => wanted.has(item.id));

  const [settings, medSettings] = await Promise.all([getLeaflySyncSettings(), getMedTaxSettings()]);

  const built = buildLeaflyItemsResult(selected, {
    pickupEnabled: settings.sendPickupAvailability,
    medicallyEndorsed: medSettings.medicallyEndorsed,
  });
  const withSettings: LeaflyItem[] = applyLeaflySettings(built.payload.items, settings);
  const payload: LeaflyItemsPayload = { items: withSettings };
  const validation = validateLeaflyPayload(payload);

  const plan = planSelectionPush({
    selected,
    feedCount: items.length,
    requestedMethod: input.requestedMethod ?? "PUT",
  });

  return {
    mode: "preview",
    plan,
    coverage: computeCoverage(selected),
    payload,
    rejected: built.rejected,
    droppedItemIds: built.droppedItemIds,
    validationOk: validation.ok,
    validationErrors: validation.errors.map((e) =>
      typeof e === "string" ? e : ((e as { message?: string }).message ?? JSON.stringify(e)),
    ),
    orderability: summarizeOrderability(selected, {
      pickupEnabled: settings.sendPickupAvailability,
    }),
    versionId,
    feedCount: items.length,
  };
}

// ---------------------------------------------------------------------------
// The targeted push
// ---------------------------------------------------------------------------

export type SelectionPushResult = {
  mode: "live";
  method: "PUT";
  ok: boolean;
  httpStatus: number;
  itemCount: number;
  plan: SelectionPlan;
  coverage: SelectionCoverage;
  payload: LeaflyItemsPayload;
  response: unknown;
  message: string;
  /** Always false — proves to the caller (and the audit log) that no state moved. */
  syncStateWritten: false;
  /** Always false — proves no DELETE was issued. */
  deletesIssued: false;
};

export class SelectionRefusedError extends Error {
  readonly refusals: SelectionPlan["refusals"];
  constructor(plan: SelectionPlan) {
    super(plan.refusals.map((r) => r.message).join(" "));
    this.name = "SelectionRefusedError";
    this.refusals = plan.refusals;
  }
}

/**
 * Send ONLY the named items to Leafly.
 *
 * Hard guarantees, each one structural rather than conditional:
 *   - PUT only. The method comes from `planSelectionPush`, which coerces POST
 *     on any partial selection. This function never passes anything else to
 *     `authedFetch`.
 *   - No `saveSyncState` call exists in this module, so the delta engine's
 *     model of what Leafly holds is untouched. The next full sync behaves as if
 *     this never happened, which is exactly right: nothing here was a full sync.
 *   - No DELETE call exists in this module, so no unselected item can be
 *     removed.
 *
 * Validation THROWS here (unlike the preview) for the same reason the full sync
 * does: a payload that violates the contract means the BUILDER is wrong, and a
 * wrong builder fails systematically across many items. Sending "the valid
 * ones" would publish a partial menu and hide the cause.
 */
export async function pushLeaflySelection(input: {
  ids: readonly string[];
  confirm: boolean;
  requestedMethod?: "POST" | "PUT";
}): Promise<SelectionPushResult> {
  if (!input.confirm) {
    throw new Error("A targeted Leafly push requires explicit confirmation.");
  }
  await refreshLeaflyConfig();
  if (!isLeaflyConfigured()) {
    throw new Error("Leafly is not configured: set menu integration key + OAuth credentials.");
  }

  const { items } = await loadSyndicationFeed();
  const wanted = new Set(input.ids);
  const selected = items.filter((item) => wanted.has(item.id));

  const plan = planSelectionPush({
    selected,
    feedCount: items.length,
    requestedMethod: input.requestedMethod ?? "PUT",
  });
  if (!plan.ok) {
    throw new SelectionRefusedError(plan);
  }

  // BELT AND BRACES. `planSelectionPush` already guarantees PUT for a partial
  // selection; this asserts it again at the transmission boundary. If a future
  // edit ever weakened the core, this would stop the request rather than let a
  // POST reach Leafly and delete the menu. The cost is one comparison; the
  // thing it prevents is unrecoverable.
  if (plan.method !== "PUT" && !plan.isWholeFeed) {
    throw new Error(
      "Refusing to send a partial selection as POST: Leafly treats POST as a full menu replacement.",
    );
  }

  const [settings, medSettings] = await Promise.all([getLeaflySyncSettings(), getMedTaxSettings()]);
  const built = buildLeaflyItemsResult(selected, {
    pickupEnabled: settings.sendPickupAvailability,
    medicallyEndorsed: medSettings.medicallyEndorsed,
  });
  const leaflyItems: LeaflyItem[] = applyLeaflySettings(built.payload.items, settings);

  assertLeaflyPayloadValid({ items: leaflyItems });

  const payload: LeaflyItemsPayload = { items: leaflyItems };
  const result = await authedFetch(menuItemsUrl(), "PUT", payload, {
    maxRetries: settings.maxRetries,
  });

  const config = getLeaflyConfig();
  const waitHint = config.environment === "production" ? "~5 min" : "~2.5 min";

  return {
    mode: "live",
    method: "PUT",
    ok: result.ok,
    httpStatus: result.status,
    itemCount: leaflyItems.length,
    plan,
    coverage: computeCoverage(selected),
    payload,
    response: result.body,
    message: result.ok
      ? `Sent ${leaflyItems.length} item${leaflyItems.length === 1 ? "" : "s"} as an update. ` +
        `Nothing else on your Leafly menu was touched. Allow ${waitHint} before reading the menu back — ` +
        "comparing sooner shows differences that are only Leafly still ingesting."
      : leaflyMessageForStatus(result.status),
    syncStateWritten: false,
    deletesIssued: false,
  };
}

/** Plain-language explanation of a Leafly HTTP status. */
function leaflyMessageForStatus(status: number): string {
  if (status === 400) return "Leafly rejected the payload (400). The contract check above shows what it objected to.";
  if (status === 401) return "Leafly refused the credentials (401). Check the client id and secret.";
  if (status === 403) return "Leafly refused access (403). Check the menu integration key belongs to this account.";
  if (status === 404) return "Leafly did not recognise the menu integration key (404).";
  if (status === 422) return "Leafly accepted the request but rejected the data (422).";
  if (status === 429) return "Leafly rate-limited the request (429). Wait a moment and try again.";
  if (status >= 500) return `Leafly had a server error (${status}). This is on their side; nothing is wrong with your credentials.`;
  return `Leafly returned HTTP ${status}.`;
}
