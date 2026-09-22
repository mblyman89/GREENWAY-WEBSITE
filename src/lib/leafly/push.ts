/**
 * src/lib/leafly/push.ts
 *
 * Server-side Leafly Menu Integration API v2.0 push.
 *
 * Grounded in the VENDORED LIVE specs under docs/leafly-specs/ (see SOURCES.md for URLs
 * and md5s). See docs/leafly-menu-api-v2.md for the prose reference.
 *
 * This header used to say "Grounded in the owner-supplied OpenAPI spec
 * (leafly_menu_api_v2.json)". That provenance IS finding L-17 -- the owner-supplied copy
 * was wrong, and eight field-level defects descended from trusting it. Slice L-1 replaced
 * it with Leafly's live published specs; this comment is corrected in L-4 so nothing here
 * still points at the bad source.
 *
 * Verified facts encoded here:
 *   - OAuth2 client-credentials grant against sso(-sandbox).leafly token URL
 *   - POST  /{key}/menu/items  -> full sync (deletes items missing from payload)
 *   - PUT   /{key}/menu/items  -> upsert (no delete)
 *   - DELETE /{key}/menu/items -> { ids: [...] }
 *   - GET   /{key}/status      -> integration status
 *   - GET   /{key}/menu        -> SANDBOX-ONLY readback; 405 elsewhere (L-14, slice L-4)
 *   - body root { items: [...] }, prices minor units, >=1 variant/item
 *   - field names are camelCase EXCEPT total_thc / total_cbd, which are snake_case.
 *     "camelCase for all fields" was the other half of L-17. Do not tidy them.
 *
 * Safety: live pushes are gated behind explicit `confirm: true` AND full credentials.
 * The default action is a non-network PREVIEW (dry-run) that returns exactly what would
 * be sent. Every attempt is recorded to syndication_logs by the caller.
 *
 * Task X engine upgrade: preflight gate (errors block live pushes), owner
 * transmission toggles (sync settings), delta plans with payload-hash
 * idempotency ("skipped — no changes"), PUT-mode explicit deletes, 401-retry +
 * 429/5xx exponential backoff (parity with the Weedmaps client), and
 * sync-state persistence (migration 0119).
 */
import "server-only";

import { getLeaflyBaseUrl, getLeaflyConfig, getLeaflyTokenUrl } from "./config";
import { getLeaflyAccessToken, resetLeaflyTokenCache } from "./token";
import { leaflyFetchWithDeadline } from "./deadline-fetch";
import type { LeaflyOperation } from "./deadline-core";
import { refreshLeaflyConfig } from "./runtime";
import {
  buildLeaflyDeletePayload,
  buildLeaflyItemsPayload,
  buildLeaflyItemsResult,
  collectPotencyRefusals,
  type LeaflyItem,
  type LeaflyItemsPayload,
  type LeaflyVariantRejection,
} from "./payload-core";
import {
  describePotencySummary,
  summarizePotencyRefusals,
  type PotencyRefusalRecord,
  type PotencySummary,
} from "./potency-core";
import {
  // NB `assertLeaflyPayloadValid` is deliberately NOT imported here any more.
  // TASK I replaced the unconditional assert with validate + quarantine, and
  // leaving the throwing helper in scope is an invitation to reinstate the
  // all-or-nothing behaviour by accident. It is still the right tool for the
  // TARGETED push (selection-server.ts), where the operator hand-picked a
  // handful of items and silently dropping one would defeat the point.
  LeaflyPayloadInvalidError,
  validateLeaflyPayload,
  type LeaflyValidationResult,
} from "./payload-validate-core";
import { summarizeOrderability, type OrderabilitySummary } from "./orderability-core";
import {
  decideQuarantine,
  describeQuarantine,
  describeQuarantinedItems,
} from "./quarantine-core";
import {
  assessReadbackTiming,
  describeReconcileResult,
  parseLeaflyMenuReadback,
  reconcileLeaflyMenu,
  type LeaflyReadbackParse,
  type LeaflyReconcileResult,
  type ReadbackTimingVerdict,
} from "./readback-core";
import {
  chooseReadbackBaseline,
  type ReadbackBaseline,
  type ReadbackLogRow,
} from "./readback-baseline-core";
import { listSyndicationLogs } from "@/lib/syndication/store";
import { getMedTaxSettings } from "@/lib/medical/store";
import { loadSyndicationFeed } from "@/lib/syndication/feed-source";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";
import { runPreflight, PreflightBlockedError } from "@/lib/syndication/preflight-core";
import { applyLeaflySettings } from "@/lib/syndication/apply-settings-core";
import { computeSyncPlan, describeSyncPlan, hashItems } from "@/lib/syndication/sync-plan-core";
import {
  clearForceResendFlag,
  getLeaflySyncSettings,
  getSyncState,
  saveSyncState,
} from "@/lib/syndication/engine-store";
import type { LeaflySyncSettings } from "@/lib/syndication/sync-settings-core";

export * from "./payload-core";

export type LeaflyReadiness = {
  environment: "sandbox" | "production";
  baseUrl: string;
  tokenUrl: string;
  hasMenuIntegrationKey: boolean;
  hasOAuthCredentials: boolean;
  configured: boolean;
};

export function describeLeaflyReadiness(): LeaflyReadiness {
  const config = getLeaflyConfig();
  const hasKey = Boolean(config.menuIntegrationKey);
  const hasOAuth = Boolean(config.clientId && config.clientSecret);
  return {
    environment: config.environment,
    baseUrl: getLeaflyBaseUrl(config.environment),
    tokenUrl: getLeaflyTokenUrl(config.environment),
    hasMenuIntegrationKey: hasKey,
    hasOAuthCredentials: hasOAuth,
    configured: hasKey && hasOAuth,
  };
}

export function isLeaflyConfigured(): boolean {
  return describeLeaflyReadiness().configured;
}

/** Load back-office credentials (DB over env) then describe readiness. */
export async function describeLeaflyReadinessAsync(): Promise<LeaflyReadiness> {
  await refreshLeaflyConfig();
  return describeLeaflyReadiness();
}

export type LeaflyPreview = {
  mode: "preview";
  itemCount: number;
  versionId: string | null;
  payload: LeaflyItemsPayload;
  readiness: LeaflyReadiness;
  /** Raw channel-agnostic feed items — used by the page for preflight/richness scoring. */
  items: SyndicationItem[];
  /**
   * SLICE L-2 — contract validation of the previewed payload.
   *
   * The preview deliberately REPORTS rather than throws. The whole purpose of a
   * dry run is to see what is wrong, and a preview that refuses to render the
   * broken payload is a preview that cannot be used to diagnose it.
   */
  validation: LeaflyValidationResult;
  /**
   * Variants and items the builder refused to represent, with the reason.
   *
   * These never used to surface anywhere: `buildLeaflyItemsPayload` silently
   * dropped anything it could not map, so a product could vanish from the
   * Leafly menu with the preview cheerfully reporting success. "412 of your 415
   * items, and here is exactly why the other three are missing" is the honest
   * report.
   */
  rejected: LeaflyVariantRejection[];
  droppedItemIds: string[];
  /**
   * SLICE L-3 — why each item is or is not orderable, grouped by cause.
   *
   * `availableForPickup` is otherwise invisible to the owner. Without this he
   * could switch ordering on, push successfully, watch Leafly accept every
   * item, and still take no orders — with the only explanation buried in the
   * JSON. This turns that into "391 orderable; 6 out of stock; 3 are DOH
   * High-THC and can never be offered online, here are their names".
   *
   * Computed by the SAME function the payload uses, so it cannot disagree with
   * what was actually sent.
   */
  orderability: OrderabilitySummary;
  /**
   * TASK I — potency readings we refused to believe, grouped.
   *
   * FIELD-REPORTED. A full menu push failed with 128 errors, most of them
   * "content is 1000 with unit percent". The cause was a milligram figure
   * saved in a field the item's product type says is a percentage: the builder
   * kept the number and threw the word "mg" away.
   *
   * We now send `null` (Leafly's own sanctioned way to say "not tested")
   * instead of publishing a 1000% THC claim next to a regulated product. But a
   * silent null is how data rot survives for years, so every refusal is
   * counted here and named on screen. `examples` carries the product name and
   * the exact text we could not use, which is what makes the fix actionable
   * rather than a number to worry about.
   */
  potency: PotencySummary;
  /** The individual refusals behind `potency`, for anyone who wants the full list. */
  potencyRefusals: PotencyRefusalRecord[];
};

/**
 * Dry-run: build the exact v2 payload from the published menu version WITHOUT calling
 * Leafly. Safe to run any time, with or without credentials.
 */
export async function previewLeaflyPush(): Promise<LeaflyPreview> {
  await refreshLeaflyConfig();
  const { versionId, items } = await loadSyndicationFeed();

  // SLICE L-3. The preview must be built with the SAME store facts the live push uses,
  // or it stops being a preview. If this defaulted `pickupEnabled` to false while the
  // owner had ordering switched on, the dry run would show `availableForPickup: false`
  // for every item and the live push would then send `true` — the one payload a preview
  // exists to let him inspect would be the one payload he never sees.
  const [settingsForPreview, medSettingsForPreview] = await Promise.all([
    getLeaflySyncSettings(),
    getMedTaxSettings(),
  ]);

  // Use the RESULT form so refusals are reported instead of swallowed.
  const built = buildLeaflyItemsResult(items, {
    pickupEnabled: settingsForPreview.sendPickupAvailability,
    medicallyEndorsed: medSettingsForPreview.medicallyEndorsed,
  });

  const potencyRefusals = potencyRefusalsFor(items);

  return {
    mode: "preview",
    itemCount: items.length,
    versionId,
    payload: built.payload,
    readiness: describeLeaflyReadiness(),
    items,
    validation: validateLeaflyPayload(built.payload),
    rejected: built.rejected,
    droppedItemIds: built.droppedItemIds,
    // Summarise the SAME feed items the payload was built from, with the SAME
    // toggle value, so the explanation and the wire cannot diverge.
    orderability: summarizeOrderability(items, {
      pickupEnabled: settingsForPreview.sendPickupAvailability,
    }),
    // Same feed, same items. Computed from the source records rather than from
    // the built payload on purpose: by the time a reading reaches the payload
    // it has already become `null`, and a null is indistinguishable from a
    // product that was honestly never tested. The refusal is only visible at
    // the point of reading, which is where this looks.
    potency: summarizePotencyRefusals(potencyRefusals),
    potencyRefusals,
  };
}

/**
 * Every potency reading in the feed that we refused to publish.
 *
 * Kept as a named helper rather than inlined because the live push needs the
 * identical list, and two copies of this loop would be two chances for the
 * preview and the push to disagree about what was wrong with the data.
 */
function potencyRefusalsFor(items: readonly SyndicationItem[]): PotencyRefusalRecord[] {
  const out: PotencyRefusalRecord[] = [];
  for (const item of items) out.push(...collectPotencyRefusals(item));
  return out;
}

// ---------------------------------------------------------------------------
// OAuth2 client-credentials token
// ---------------------------------------------------------------------------
// SLICE L-6: this token cache USED TO LIVE HERE, as a module-private
// `tokenCache` plus a private `getAccessToken()`. It moved to ./token.ts when
// the Order API became a second caller, because the two Leafly APIs share one
// token endpoint and one (empty) scope set -- verified in both vendored specs
// at components.securitySchemes.OAuth2ClientCredentials.flows.clientCredentials
// -- so two private caches would have meant two copies of the same credential,
// double the token requests, and a `resetLeaflyTokenCache()` on one API that
// left the other still using the token just declared suspect. Nothing about the
// behaviour changed: same 30s expiry margin, same 3600s fallback TTL, same
// Basic-auth form post. Only the ownership moved. See ./token.ts for the full
// reasoning and the spec citations.
//
// `resetLeaflyTokenCache` is still re-exported from here so that every existing
// import site keeps working and nothing had to be touched to land the move. It
// is re-exported from the already-imported binding rather than with a second
// `export { ... } from "./token"`, which would be a duplicate declaration.
export { resetLeaflyTokenCache };

function menuItemsUrl(): string {
  const config = getLeaflyConfig();
  const base = getLeaflyBaseUrl(config.environment);
  return `${base}/${encodeURIComponent(config.menuIntegrationKey ?? "")}/menu/items`;
}

function statusUrl(): string {
  const config = getLeaflyConfig();
  const base = getLeaflyBaseUrl(config.environment);
  return `${base}/${encodeURIComponent(config.menuIntegrationKey ?? "")}/status`;
}

/**
 * `GET /{menu_integration_key}/menu` — the readback URL.
 *
 * Note there is no `/items` suffix. The three WRITE operations live on `/menu/items`; the
 * readback lives on `/menu` itself. Verified against
 * `docs/leafly-specs/menu-integration-v2.openapi.json`, whose `paths` are exactly:
 *   /{menu_integration_key}/menu        -> get
 *   /{menu_integration_key}/menu/items  -> post, put, delete
 *   /{menu_integration_key}/status      -> get
 */
function menuReadbackUrl(): string {
  const config = getLeaflyConfig();
  const base = getLeaflyBaseUrl(config.environment);
  return `${base}/${encodeURIComponent(config.menuIntegrationKey ?? "")}/menu`;
}

const RETRYABLE = (status: number) => status === 429 || (status >= 500 && status <= 599);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Authorized fetch with resilience matching the Weedmaps client (Task X):
 *   - Bearer auth.
 *   - On 401 once: clear the token cache and retry (expired/rotated token).
 *   - On 429 / 5xx: exponential backoff (250ms, 500ms, 1s, …), attempts
 *     owner-tunable via sync settings maxRetries (default 3 attempts total).
 */
async function authedFetch(
  url: string,
  method: string,
  // SLICE L-17. This wrapper serves THREE different Leafly endpoints from
  // this one file -- /menu/items (menu_push), /status (integration_status)
  // and /menu (menu_readback) -- and they do not share a deadline or an
  // attempt count. The operation is therefore a required argument rather
  // than something inferred from the URL: inferring it would mean parsing a
  // string to decide how long a person waits, and a new endpoint would
  // silently inherit whichever branch matched first. Required and untyped-by
  // -default means the compiler asks.
  operation: LeaflyOperation,
  body?: unknown,
  opts?: { maxRetries?: number },
) {
  // maxRetries = extra attempts AFTER the first (settings clamp 0–5).
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

    // Expired/rotated token: clear cache and retry once.
    if (res.status === 401 && !didRetryAuth) {
      didRetryAuth = true;
      resetLeaflyTokenCache();
      continue;
    }

    if (RETRYABLE(res.status) && attempt < maxAttempts) {
      await sleep(250 * 2 ** (attempt - 1));
      continue;
    }

    return { ok: res.ok, status: res.status, body: parsed };
  }
}

export type LeaflyPushResult = {
  mode: "live";
  method: "POST" | "PUT" | "DELETE";
  ok: boolean;
  /** 0 when the whole sync was skipped (no network call was needed). */
  httpStatus: number;
  itemCount: number;
  /** True when nothing changed since the last successful sync (no request sent). */
  skipped: boolean;
  /** Delta plan summary, e.g. "3 new, 5 changed, 120 unchanged, 2 removed". */
  planSummary: string | null;
  payload: unknown;
  response: unknown;
  message: string | null;
};

/**
 * Append the quarantine report to a success message.
 *
 * TASK I. A quarantine that is not reported is the whole failure mode this
 * feature has to avoid: items quietly missing from the menu for months while
 * every sync reports success. So the note rides along on the SUCCESS message,
 * where it cannot be mistaken for an error and cannot be missed either.
 *
 * Returns the base message unchanged when there is nothing to report, so a
 * clean sync reads exactly as it always has.
 */
function withQuarantineNote(base: string, ...notes: (string | null)[]): string {
  const extra = notes.filter((n): n is string => n !== null && n.length > 0);
  return extra.length === 0 ? base : `${base} ${extra.join(" ")}`;
}

function leaflyMessageForStatus(status: number): string {
  if (status === 401) return "Unauthorized (401): the access token is missing, invalid, or expired.";
  if (status === 403) return "Forbidden (403): the client credentials are not authorized for this menu integration key.";
  if (status === 404) return "Not found (404): verify the menu integration key (per-environment — sandbox and production keys differ).";
  if (status === 422 || status === 400) return `Leafly rejected the payload (${status}): check ids, prices (integer cents), and that every item has at least one variant.`;
  if (status === 429) return "Rate limited (429): backed off and retried; reduce push frequency if this persists.";
  if (status >= 500) return `Leafly server error (${status}); retried with backoff. If sustained, contact api-support@leafly.com.`;
  return `Leafly responded ${status}.`;
}

/**
 * Live menu sync to Leafly — the professional engine (Task X):
 *
 *   1. Preflight-validate the feed (ERRORS block the push; warnings surface).
 *   2. Build the verified v2 payload and apply the owner's transmission
 *      toggles (descriptions / cannabinoids / strains / photos).
 *
 *      NOTE, corrected in slice L-4: this line used to end "Leafly v2 has no
 *      image field so that toggle is a no-op here". That was FALSE. `imageUrl`
 *      is a documented property of the v2 item schema
 *      (docs/leafly-specs/schemas/v2-items.json), L-2 wired real emission and
 *      L-3 made the toggle real. This was the FOURTH surviving copy of that
 *      one disproven sentence -- the others were the dead toggle (fixed L-2),
 *      the `false` default (fixed L-3) and the hidden data-quality row (fixed
 *      L-3). A false claim in a comment propagates by being copied, so it has
 *      to be hunted rather than patched where first noticed.
 *   3. Delta plan against the last successful sync's payload hashes:
 *        - POST (full sync): Leafly deletes omitted items, so the FULL payload
 *          is always sent — but when NOTHING changed the entire request is
 *          skipped ("skipped — no changes") unless forceResend.
 *        - PUT (upsert): only creates + updates are sent; items that left the
 *          feed are then removed with an explicit DELETE {ids} call.
 *   4. Persist the new id→hash map after success so the next sync is a delta.
 *
 * The explicit `method` argument (owner's dropdown) overrides the stored
 * syncMode setting. Requires explicit `confirm: true` AND full credentials.
 */
export async function pushLeaflyMenu(opts: {
  confirm: boolean;
  method?: "POST" | "PUT";
}): Promise<LeaflyPushResult> {
  if (!opts.confirm) {
    throw new Error("Live Leafly push requires explicit confirmation.");
  }
  await refreshLeaflyConfig();
  if (!isLeaflyConfigured()) {
    throw new Error("Leafly is not configured: set menu integration key + OAuth credentials.");
  }

  const settings: LeaflySyncSettings = await getLeaflySyncSettings();
  const method: "POST" | "PUT" = opts.method ?? (settings.syncMode === "put" ? "PUT" : "POST");
  const { versionId, items } = await loadSyndicationFeed();

  // 1. Preflight: never transmit data that would corrupt the Leafly menu.
  const preflight = runPreflight(items);
  if (!preflight.ok) {
    throw new PreflightBlockedError(preflight);
  }

  // 2. Verified payload + owner toggles.
  //
  // SLICE L-3: the builder now needs two facts about the STORE, not just the products.
  //
  //   pickupEnabled     -- the owner's ordering toggle, which decides whether
  //                        `availableForPickup` can ever be true.
  //   medicallyEndorsed -- read from the live endorsement config rather than assumed.
  //                        It is FALSE today (owner, Q5: "we have not been certified
  //                        yet ... only regular non medical sales at the start"), but
  //                        reading it means the day the endorsement lands, nobody has to
  //                        remember to come back and edit a constant in a mapper.
  const medSettings = await getMedTaxSettings();
  // `let`, not `const`: the quarantine step below may replace this with the
  // surviving subset. Reassigning is deliberate — the alternative is a second
  // name for "the items we are actually sending", and two names for one thing
  // is how the wrong one ends up on the wire.
  let quarantineNote: string | null = null;
  // TASK I. Read from the SOURCE items, before the builder turns a refused
  // reading into a null. After that point a refusal and an untested product
  // are the same value, and the owner would never learn which he had.
  const potencyNote = describePotencySummary(
    summarizePotencyRefusals(potencyRefusalsFor(items)),
  );
  let leaflyItems: LeaflyItem[] = applyLeaflySettings(
    buildLeaflyItemsPayload(items, {
      pickupEnabled: settings.sendPickupAvailability,
      medicallyEndorsed: medSettings.medicallyEndorsed,
    }).items,
    settings,
  );

  // 2b. SLICE L-2 -- validate the payload that is ACTUALLY about to be sent.
  //
  // This runs AFTER applyLeaflySettings, not before, and the ordering is the
  // entire point. Preflight (step 1) checks the SOURCE data; this checks the
  // WIRE data. Between them sits the toggle layer, which rewrites fields --
  // and the toggle layer is precisely where two of this slice's defects lived
  // (it nulled `description` and the totals, which the schema forbids, and it
  // wrote field names Leafly does not define). Validating before the toggles
  // would have inspected a payload that no longer existed by transmission
  // time and pronounced it healthy.
  //
  // It throws rather than filtering: a payload that violates the contract
  // means the BUILDER is wrong, and a wrong builder fails systematically
  // across many items at once. Sending "the valid ones" would publish a
  // partial menu and hide the cause.
  //
  // TASK I. That reasoning still stands and is still the DEFAULT. What it did
  // not distinguish is a BUILDER defect from a DATA defect. A real full-menu
  // push failed with 128 errors traceable to a handful of products whose
  // potency had been typed in the wrong unit, and the whole several-hundred
  // item menu stayed off Leafly as a result. Several hundred good products
  // were punished for two bad records, and the owner was left with no menu at
  // all while hunting the typo.
  //
  // So the throw is now conditional on the owner's policy. `block` is
  // unchanged and remains the default. `quarantine` drops only the offending
  // ITEMS and reports them -- and refuses itself when the failure share looks
  // systematic rather than incidental, which is precisely the case the
  // original comment was written to protect. See quarantine-core.ts.
  const validation = validateLeaflyPayload({ items: leaflyItems });
  if (!validation.ok) {
    const decision = decideQuarantine({
      items: leaflyItems.map((i) => ({ id: i.id, name: i.name })),
      issues: validation.issues,
      policy: settings.invalidItemPolicy,
    });
    if (!decision.proceed) {
      throw new LeaflyPayloadInvalidError(validation);
    }
    const keep = new Set(decision.keptItemIds);
    leaflyItems = leaflyItems.filter((i) => keep.has(i.id));
    // The headline AND the named list. `describeQuarantine` ends with "fix the
    // few below", and for a while there was no below: the list function
    // existed with no caller, so the message pointed at nothing. A summary
    // that says "some products were held back" without saying WHICH is not a
    // report, it is an anxiety.
    quarantineNote = [describeQuarantine(decision), ...describeQuarantinedItems(decision)]
      .filter((s): s is string => s !== null && s.length > 0)
      .join(" ");
    if (quarantineNote.length === 0) quarantineNote = null;
  }

  // 3. Delta plan (payload-hash idempotency).
  const state = await getSyncState("leafly");
  const currentHashes = hashItems(leaflyItems, (i) => i.id);
  const plan = computeSyncPlan(
    { previous: state.hashes, current: currentHashes },
    settings.forceResend,
  );
  const planSummary = describeSyncPlan(plan);
  const nothingChanged =
    plan.counts.creates === 0 && plan.counts.updates === 0 && plan.counts.deletes === 0;

  if (nothingChanged && !settings.forceResend) {
    return {
      mode: "live",
      method,
      ok: true,
      httpStatus: 0,
      itemCount: leaflyItems.length,
      skipped: true,
      planSummary,
      payload: { items: [] },
      response: null,
      // The quarantine note rides along even here. "Nothing changed" is a
      // reassuring sentence, and pairing it with silence about held-back
      // products is exactly how a quarantine becomes invisible.
      message: withQuarantineNote(
        `Skipped — no changes since the last successful sync (${plan.counts.unchanged} items unchanged).`,
        quarantineNote,
        potencyNote,
      ),
    };
  }

  if (method === "POST") {
    // Full sync: Leafly deletes omitted items, so ALWAYS send the whole menu.
    const payload: LeaflyItemsPayload = { items: leaflyItems };
    const result = await authedFetch(menuItemsUrl(), "POST", "menu_push", payload, {
      maxRetries: settings.maxRetries,
    });
    if (result.ok) {
      await saveSyncState("leafly", currentHashes, versionId);
      if (settings.forceResend) await clearForceResendFlag("leafly");
    }
    return {
      mode: "live",
      method: "POST",
      ok: result.ok,
      httpStatus: result.status,
      itemCount: leaflyItems.length,
      skipped: false,
      planSummary,
      payload,
      response: result.body,
      message: result.ok
        ? withQuarantineNote(
            `Full sync sent (${planSummary}). Allow ~2.5 min (sandbox) / ~5 min (production) for the menu to update.`,
            quarantineNote,
            potencyNote,
          )
        : leaflyMessageForStatus(result.status),
    };
  }

  // PUT upsert: send only creates + updates (+ unchanged when forced) …
  const byId = new Map(leaflyItems.map((i) => [i.id, i]));
  const toSend = plan.toSend.map((id) => byId.get(id)).filter((i): i is LeaflyItem => Boolean(i));
  const payload: LeaflyItemsPayload = { items: toSend };
  const nextHashes = new Map(state.hashes);

  let upsertOk = true;
  let upsertStatus = 200;
  let upsertBody: unknown = null;
  if (toSend.length > 0) {
    const result = await authedFetch(menuItemsUrl(), "PUT", "menu_push", payload, {
      maxRetries: settings.maxRetries,
    });
    upsertOk = result.ok;
    upsertStatus = result.status;
    upsertBody = result.body;
    if (result.ok) {
      for (const item of toSend) nextHashes.set(item.id, currentHashes.get(item.id) ?? "");
    }
  }

  // … then explicitly DELETE items that left the feed (PUT never deletes).
  let deleteOk = true;
  let deleteStatus = 200;
  let deleteBody: unknown = null;
  if (upsertOk && plan.deletes.length > 0) {
    const delPayload = buildLeaflyDeletePayload(plan.deletes);
    const result = await authedFetch(menuItemsUrl(), "DELETE", "menu_push", delPayload, {
      maxRetries: settings.maxRetries,
    });
    deleteOk = result.ok;
    deleteStatus = result.status;
    deleteBody = result.body;
    if (result.ok) {
      for (const id of plan.deletes) nextHashes.delete(id);
    }
  }

  await saveSyncState("leafly", nextHashes, versionId);
  const ok = upsertOk && deleteOk;
  if (ok && settings.forceResend) await clearForceResendFlag("leafly");

  return {
    mode: "live",
    method: "PUT",
    ok,
    httpStatus: !upsertOk ? upsertStatus : !deleteOk ? deleteStatus : upsertStatus,
    itemCount: toSend.length,
    skipped: false,
    planSummary,
    payload,
    response: { upsert: upsertBody, delete: deleteBody },
    message: ok
      ? withQuarantineNote(
          `Upserted ${toSend.length}, removed ${plan.counts.deletes}, skipped ${settings.forceResend ? 0 : plan.counts.unchanged} unchanged (${planSummary}).`,
          quarantineNote,
          potencyNote,
        )
      : leaflyMessageForStatus(!upsertOk ? upsertStatus : deleteStatus),
  };
}

/** Live delete of specific item ids (DELETE). Requires confirmation + credentials. */
export async function deleteLeaflyItems(opts: {
  ids: string[];
  confirm: boolean;
}): Promise<LeaflyPushResult> {
  if (!opts.confirm) {
    throw new Error("Live Leafly delete requires explicit confirmation.");
  }
  await refreshLeaflyConfig();
  if (!isLeaflyConfigured()) {
    throw new Error("Leafly is not configured.");
  }
  const settings = await getLeaflySyncSettings();
  const payload = buildLeaflyDeletePayload(opts.ids);
  const result = await authedFetch(menuItemsUrl(), "DELETE", "menu_push", payload, {
    maxRetries: settings.maxRetries,
  });
  if (result.ok && payload.ids.length > 0) {
    // Keep the sync state honest so deleted items aren't seen as "removed" again.
    const state = await getSyncState("leafly");
    const nextHashes = new Map(state.hashes);
    for (const id of payload.ids) nextHashes.delete(id);
    await saveSyncState("leafly", nextHashes, state.lastVersionId);
  }
  return {
    mode: "live",
    method: "DELETE",
    ok: result.ok,
    httpStatus: result.status,
    itemCount: payload.ids.length,
    skipped: false,
    planSummary: null,
    payload,
    response: result.body,
    message: result.ok ? null : leaflyMessageForStatus(result.status),
  };
}

/** GET integration status. Requires credentials. */
export async function getLeaflyStatus(): Promise<{
  ok: boolean;
  httpStatus: number;
  body: unknown;
}> {
  await refreshLeaflyConfig();
  if (!isLeaflyConfigured()) {
    throw new Error("Leafly is not configured.");
  }
  const result = await authedFetch(statusUrl(), "GET", "integration_status");
  return { ok: result.ok, httpStatus: result.status, body: result.body };
}

// ---------------------------------------------------------------------------
// getLeaflyMenu — the readback (finding L-14)
// ---------------------------------------------------------------------------

export type LeaflyMenuReadbackResult = {
  ok: boolean;
  httpStatus: number;
  /** Raw body, kept so the owner-facing UI can show exactly what Leafly said. */
  body: unknown;
  /** Parsed readback. `ok: false` when the shape was unusable. */
  parse: LeaflyReadbackParse;
  /**
   * Comparison against WHAT WE ACTUALLY SENT (see `baseline` for which push
   * that was). Null when no baseline could be established at all.
   */
  reconcile: LeaflyReconcileResult | null;
  /**
   * Which payload the comparison was made against, and what it is entitled to
   * conclude. Surfaced rather than kept internal because a comparison is only
   * as trustworthy as its baseline, and the owner should never have to read
   * source code to discover he is looking at a whole-menu diff after a
   * targeted push. Null when no comparison was made.
   */
  baseline: ReadbackBaseline | null;
  /**
   * Whether this comparison was run inside Leafly's documented ingest window
   * (finding L-19). When `tooSoon` is true the differences may be the previous menu
   * rather than defects, so the UI must say so before anyone acts on them.
   */
  timing: ReadbackTimingVerdict;
  /** One sentence for a human. Always present. */
  summary: string;
};

/**
 * Read the menu back from Leafly and compare it with what we would send (finding L-14).
 *
 * WHY THIS IS NOT JUST A FETCH
 * ----------------------------
 * Leafly's sandbox email offers this endpoint for validating menu data, and the obvious
 * implementation hands back raw JSON. That would be a wasted opportunity. A `200` from
 * `POST /menu/items` only proves our JSON parsed — slice L-2 found eight field defects
 * that a 200 would not have revealed, and a field we *think* we send but do not produces a
 * cheerful 200 and a wrong storefront. So this function reads the menu back and diffs it,
 * which is the only check in the codebase capable of catching that.
 *
 * SANDBOX ONLY — and the guard is deliberate. Leafly's OpenAPI description states: "This
 * method is only permitted in the sandbox environment; an HTTP 405 Method Not Allowed
 * response will be returned in other environments." We refuse before dialling rather than
 * spending a real request to be told 405, because certification grades our logged request
 * activity (readiness report §7) and a self-inflicted 405 is a blemish for no benefit.
 *
 * Every call runs server-side through `authedFetch`, the same client the pushes use. That
 * is required, not incidental: Leafly disqualifies retailers whose "request signatures"
 * look like manual tools such as Postman or curl (§7, Risk 3).
 */
export async function getLeaflyMenu(): Promise<LeaflyMenuReadbackResult> {
  await refreshLeaflyConfig();
  if (!isLeaflyConfigured()) {
    throw new Error("Leafly is not configured.");
  }

  const config = getLeaflyConfig();
  if (config.environment !== "sandbox") {
    throw new Error(
      "Reading the menu back is a sandbox-only endpoint. Leafly returns 405 Method Not " +
        "Allowed in production, so the request was not sent.",
    );
  }

  const settings = await getLeaflySyncSettings();
  const result = await authedFetch(menuReadbackUrl(), "GET", "menu_readback", undefined, {
    maxRetries: settings.maxRetries,
  });

  const parse = parseLeaflyMenuReadback(result.body);

  // Leafly takes up to ~2.5 minutes in sandbox to ingest a push (finding L-19, quoted in
  // readback-core). Compare anyway -- suppressing the comparison would hide real defects --
  // but establish up front whether the answer can be trusted yet. `lastSyncedAt` is the
  // recorded time of the last SUCCESSFUL push, which is exactly the clock that matters.
  //
  // Read defensively: a sync-state read failure must not turn a successful readback into
  // an exception, and "unknown timing" is a verdict assessReadbackTiming handles safely.
  let lastSyncedAt: string | null = null;
  try {
    lastSyncedAt = (await getSyncState("leafly")).lastSyncedAt;
  } catch {
    lastSyncedAt = null;
  }
  const timing = assessReadbackTiming(lastSyncedAt, new Date(), config.environment);

  // Compare against WHAT WE ACTUALLY SENT.
  //
  // FIELD-REPORTED. This used to compare against `previewLeaflyPush()` -- the
  // payload we WOULD send right now, i.e. the whole 2,562-item feed. After the
  // owner's first targeted push of 8 products (which succeeded completely) the
  // readback diffed 2,562 against 8 and reported the 2,554 untouched products
  // as failures:
  //
  //     We sent "1937 - 3.5g Flower - Blackberry - 3.5g" but Leafly's menu
  //     does not contain it.
  //
  // We never sent it. The reconciler was not wrong about the data; it was
  // handed the wrong baseline. The bug hid because the whole-feed baseline is
  // CORRECT after a full sync, which was the only case anyone had exercised.
  //
  // `syndication_logs` already stores the exact payload of every live push, so
  // the honest baseline is recoverable rather than needing to be invented. The
  // live preview survives only as an explicitly-labelled last resort.
  let reconcile: LeaflyReconcileResult | null = null;
  let baseline: ReadbackBaseline | null = null;
  try {
    // Read the history first. A preview failure must not cost us the ability
    // to compare, and the log is the more trustworthy of the two sources.
    let rows: ReadbackLogRow[] = [];
    try {
      rows = await listSyndicationLogs("leafly", 25);
    } catch {
      rows = [];
    }

    let livePreview: LeaflyItemsPayload | null = null;
    try {
      const preview = await previewLeaflyPush();
      livePreview = (preview.payload as LeaflyItemsPayload | undefined) ?? null;
    } catch {
      livePreview = null;
    }

    baseline = chooseReadbackBaseline(rows, livePreview);
    reconcile = baseline.payload
      ? reconcileLeaflyMenu(baseline.payload, parse, baseline.scope)
      : null;
  } catch {
    // Neither source was usable. The readback body is still worth showing on
    // its own, so this is not an error.
    reconcile = null;
    baseline = null;
  }

  const baseSummary = !result.ok
    ? leaflyMessageForStatus(result.status)
    : reconcile
      ? describeReconcileResult(reconcile)
      : parse.ok
        ? `Leafly returned ${parse.items.length} item(s). Could not build a local payload to compare against.`
        : parse.reason;

  // Prefix the caveat rather than append it: if the comparison is premature, that is the
  // first thing the reader needs to know, before any count of "problems".
  const summary =
    result.ok && timing.tooSoon ? `Possibly premature \u2014 ${baseSummary}` : baseSummary;

  return {
    ok: result.ok,
    httpStatus: result.status,
    body: result.body,
    parse,
    reconcile,
    baseline,
    timing,
    summary,
  };
}

export type { SyndicationItem };
