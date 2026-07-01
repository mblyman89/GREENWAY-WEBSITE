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
 */
import "server-only";

import { getLeaflyBaseUrl, getLeaflyConfig, getLeaflyTokenUrl } from "./config";
import { refreshLeaflyConfig } from "./runtime";
import {
  buildLeaflyDeletePayload,
  buildLeaflyItemsPayload,
  type LeaflyItemsPayload,
} from "./payload-core";
import { loadSyndicationFeed } from "@/lib/syndication/feed-source";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

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

async function authedFetch(url: string, method: string, body?: unknown) {
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
  return { ok: res.ok, status: res.status, body: parsed };
}

export type LeaflyPushResult = {
  mode: "live";
  method: "POST" | "PUT" | "DELETE";
  ok: boolean;
  httpStatus: number;
  itemCount: number;
  payload: unknown;
  response: unknown;
  message: string | null;
};

/**
 * Live full sync (POST). Requires explicit `confirm: true` AND full credentials.
 * This deletes any Leafly items not present in the payload — a full menu replace.
 */
export async function pushLeaflyMenu(opts: {
  confirm: boolean;
  method?: "POST" | "PUT";
}): Promise<LeaflyPushResult> {
  const method = opts.method ?? "POST";
  if (!opts.confirm) {
    throw new Error("Live Leafly push requires explicit confirmation.");
  }
  await refreshLeaflyConfig();
  if (!isLeaflyConfigured()) {
    throw new Error("Leafly is not configured: set menu integration key + OAuth credentials.");
  }
  const { items } = await loadSyndicationFeed();
  const payload = buildLeaflyItemsPayload(items);

  const result = await authedFetch(menuItemsUrl(), method, payload);
  return {
    mode: "live",
    method,
    ok: result.ok,
    httpStatus: result.status,
    itemCount: items.length,
    payload,
    response: result.body,
    message: result.ok ? null : `Leafly responded ${result.status}`,
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
  const payload = buildLeaflyDeletePayload(opts.ids);
  const result = await authedFetch(menuItemsUrl(), "DELETE", payload);
  return {
    mode: "live",
    method: "DELETE",
    ok: result.ok,
    httpStatus: result.status,
    itemCount: payload.ids.length,
    payload,
    response: result.body,
    message: result.ok ? null : `Leafly responded ${result.status}`,
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
