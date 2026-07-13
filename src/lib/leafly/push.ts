/**
 * src/lib/leafly/push.ts
 *
 * Server-side Leafly Menu Integration API v2.0 push.
 *
 * Grounded in the owner-supplied OpenAPI spec (leafly_menu_api_v2.json) and research
 * report. See docs/leafly-menu-api-v2.md. Verified facts encoded here:
 *   - OAuth2 client-credentials grant against sso(-sandbox).leafly token URL
 *   - POST  /{key}/menu/items  -> full sync (deletes items missing from payload)
 *   - PUT   /{key}/menu/items  -> upsert (no delete)
 *   - DELETE /{key}/menu/items -> { ids: [...] }
 *   - GET   /{key}/status      -> integration status
 *   - body root { items: [...] }, camelCase, prices minor units, >=1 variant/item
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
import { refreshLeaflyConfig } from "./runtime";
import {
  buildLeaflyDeletePayload,
  buildLeaflyItemsPayload,
  type LeaflyItem,
  type LeaflyItemsPayload,
} from "./payload-core";
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
};

/**
 * Dry-run: build the exact v2 payload from the published menu version WITHOUT calling
 * Leafly. Safe to run any time, with or without credentials.
 */
export async function previewLeaflyPush(): Promise<LeaflyPreview> {
  await refreshLeaflyConfig();
  const { versionId, items } = await loadSyndicationFeed();
  return {
    mode: "preview",
    itemCount: items.length,
    versionId,
    payload: buildLeaflyItemsPayload(items),
    readiness: describeLeaflyReadiness(),
  };
}

// ---------------------------------------------------------------------------
// OAuth2 client-credentials token
// ---------------------------------------------------------------------------
type CachedToken = { token: string; expiresAt: number };
let tokenCache: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  const config = getLeaflyConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Leafly OAuth credentials are not configured.");
  }
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.token;
  }

  const tokenUrl = getLeaflyTokenUrl(config.environment);
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Leafly token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("Leafly token response missing access_token.");
  }
  const ttlMs = (json.expires_in ?? 3600) * 1000;
  tokenCache = { token: json.access_token, expiresAt: now + ttlMs };
  return json.access_token;
}

/** Clear the cached token (e.g. after a 401 expired-token response). */
export function resetLeaflyTokenCache() {
  tokenCache = null;
}

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
  body?: unknown,
  opts?: { maxRetries?: number },
) {
  // maxRetries = extra attempts AFTER the first (settings clamp 0–5).
  const maxAttempts = Math.max(1, (opts?.maxRetries ?? 2) + 1);
  let didRetryAuth = false;

  for (let attempt = 1; ; attempt += 1) {
    const token = await getAccessToken();
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
 *      toggles (descriptions / cannabinoids / strains; Leafly v2 has no image
 *      field so that toggle is a no-op here).
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
  const leaflyItems: LeaflyItem[] = applyLeaflySettings(
    buildLeaflyItemsPayload(items).items,
    settings,
  );

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
      message: `Skipped — no changes since the last successful sync (${plan.counts.unchanged} items unchanged).`,
    };
  }

  if (method === "POST") {
    // Full sync: Leafly deletes omitted items, so ALWAYS send the whole menu.
    const payload: LeaflyItemsPayload = { items: leaflyItems };
    const result = await authedFetch(menuItemsUrl(), "POST", payload, {
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
        ? `Full sync sent (${planSummary}). Allow ~2.5 min (sandbox) / ~5 min (production) for the menu to update.`
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
    const result = await authedFetch(menuItemsUrl(), "PUT", payload, {
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
    const result = await authedFetch(menuItemsUrl(), "DELETE", delPayload, {
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
      ? `Upserted ${toSend.length}, removed ${plan.counts.deletes}, skipped ${settings.forceResend ? 0 : plan.counts.unchanged} unchanged (${planSummary}).`
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
  const result = await authedFetch(menuItemsUrl(), "DELETE", payload, {
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
  const result = await authedFetch(statusUrl(), "GET");
  return { ok: result.ok, httpStatus: result.status, body: result.body };
}

export type { SyndicationItem };
