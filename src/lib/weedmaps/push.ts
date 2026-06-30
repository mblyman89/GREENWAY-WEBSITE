/**
 * src/lib/weedmaps/push.ts
 *
 * Server-side WeedMaps Menu API (2025-07) push.
 *
 * Grounded ENTIRELY in the owner-supplied Weedmaps developer docs (25 PDFs).
 * See docs/weedmaps-menu-api.md. Verified facts encoded here:
 *   - Base URL: https://api-g.weedmaps.com/wm/2025-07/partners
 *   - Auth: OAuth 2.0 Bearer (client-credentials) OR a pre-provisioned bearer token.
 *   - Integration target is a MENU by `menu_id`.
 *   - Verify access first:  GET  /partners/menus/{menu_id}   -> 200 = access, 404 = none.
 *   - Create item (Direct):  POST /partners/menus/{menu_id}/items  (verified path).
 *   - external_id REQUIRED + STABLE on every item; one root (L1) category required.
 *   - Paused integration -> 423 Locked (writes blocked, reads still work).
 *
 * NOT fully inlined in the supplied docs (so we DO NOT guess wire details — instead we
 * surface them clearly and keep them behind explicit confirmation + preview):
 *   - The OAuth token endpoint URL + grant params (partner-portal page). We read the
 *     token URL from env (WEEDMAPS_TOKEN_URL) and also accept a directly-provisioned
 *     bearer token (WEEDMAPS_ACCESS_TOKEN) for onboarding.
 *   - The exact base item / variant write schema (price + Menu Item Variants) is shown
 *     in the live "API Examples" rather than inlined. Our payload uses the VERIFIED
 *     linking fields (external_id, category_names, brand_name, strain_name, cannabinoids)
 *     and namespaces the price/variant representation under `_variants`. The live push
 *     therefore defaults to a non-network PREVIEW; an actual write is gated behind
 *     explicit confirmation and clearly flags the price/variant schema as pending final
 *     verification against the live API.
 *
 * Safety: live pushes are gated behind explicit `confirm: true` AND full credentials.
 * The default action is a non-network PREVIEW (dry-run). Every attempt is recorded to
 * syndication_logs by the caller (channel: "weedmaps").
 */
import "server-only";

import { getWeedmapsBaseUrl, getWeedmapsConfig } from "./config";
import { buildWmItemsPayload, type WmItemsPayload } from "./payload-core";
import { describeWeedmapsRuntime, isWeedmapsConfigured } from "./client";
import { loadSyndicationFeed } from "@/lib/syndication/feed-source";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

export * from "./payload-core";

export type WeedmapsReadiness = {
  environment: "sandbox" | "production";
  baseUrl: string;
  hasMenuId: boolean;
  hasOAuthCredentials: boolean;
  hasAccessToken: boolean;
  hasTokenUrl: boolean;
  configured: boolean;
};

export function describeWeedmapsReadiness(): WeedmapsReadiness {
  const s = describeWeedmapsRuntime();
  return {
    environment: s.environment,
    baseUrl: s.baseUrl,
    hasMenuId: s.hasMenuId,
    hasOAuthCredentials: s.hasOAuthCredentials,
    hasAccessToken: s.hasAccessToken,
    hasTokenUrl: s.hasTokenUrl,
    configured: isWeedmapsConfigured(),
  };
}

export { isWeedmapsConfigured };

export type WeedmapsPreview = {
  mode: "preview";
  itemCount: number;
  versionId: string | null;
  payload: WmItemsPayload;
  readiness: WeedmapsReadiness;
  /** Verified caveat surfaced to staff before any live write. */
  notes: string[];
};

const SCHEMA_NOTES = [
  "Linking fields (external_id, category_names, brand_name, strain_name, cannabinoids) are grounded in the Weedmaps 2025-07 docs.",
  "The exact base item price/variant write schema is shown in Weedmaps' live API Examples rather than the supplied docs; price/variant is surfaced under `_variants` and must be confirmed against the live menu before enabling live writes.",
  "external_id uses our stable POS product key (never a batch id) so curated Weedmaps data is preserved across syncs.",
];

/**
 * Dry-run: build the exact payload from the published menu version WITHOUT calling
 * WeedMaps. Safe to run any time, with or without credentials.
 */
export async function previewWeedmapsPush(): Promise<WeedmapsPreview> {
  const { versionId, items } = await loadSyndicationFeed();
  return {
    mode: "preview",
    itemCount: items.length,
    versionId,
    payload: buildWmItemsPayload(items),
    readiness: describeWeedmapsReadiness(),
    notes: SCHEMA_NOTES,
  };
}

// ---------------------------------------------------------------------------
// OAuth2 client-credentials token (or pre-provisioned bearer token)
// ---------------------------------------------------------------------------
type CachedToken = { token: string; expiresAt: number };
let tokenCache: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  const config = getWeedmapsConfig();

  // Onboarding shortcut: a directly-provisioned bearer token.
  if (config.accessToken) {
    return config.accessToken;
  }

  if (!config.clientId || !config.clientSecret) {
    throw new Error("WeedMaps OAuth credentials are not configured.");
  }
  if (!config.tokenUrl) {
    throw new Error(
      "WeedMaps token URL is not configured (set WEEDMAPS_TOKEN_URL) and no WEEDMAPS_ACCESS_TOKEN provided.",
    );
  }

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.token;
  }

  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WeedMaps token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("WeedMaps token response missing access_token.");
  }
  const ttlMs = (json.expires_in ?? 3600) * 1000;
  tokenCache = { token: json.access_token, expiresAt: now + ttlMs };
  return json.access_token;
}

function menuUrl(): string {
  const config = getWeedmapsConfig();
  const base = getWeedmapsBaseUrl(config.environment);
  return `${base}/menus/${encodeURIComponent(config.menuId ?? "")}`;
}

function menuItemsUrl(): string {
  return `${menuUrl()}/items`;
}

async function authedFetch(url: string, method: string, body?: unknown) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
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

export type WeedmapsAccessResult = {
  ok: boolean;
  httpStatus: number;
  /** Convenience interpretation of the verified status codes. */
  state: "access" | "not_found" | "locked" | "unauthorized" | "error";
  body: unknown;
};

/**
 * Verify write access to the configured menu. Grounded: GET /partners/menus/{menu_id}
 * returns 200 = access, 404 = no access, 423 = paused (locked).
 */
export async function verifyWeedmapsMenuAccess(): Promise<WeedmapsAccessResult> {
  if (!isWeedmapsConfigured()) {
    throw new Error("WeedMaps is not configured: set menu id + OAuth credentials or access token.");
  }
  const result = await authedFetch(menuUrl(), "GET");
  let state: WeedmapsAccessResult["state"] = "error";
  if (result.ok) state = "access";
  else if (result.status === 404) state = "not_found";
  else if (result.status === 423) state = "locked";
  else if (result.status === 401 || result.status === 403) state = "unauthorized";
  return { ok: result.ok, httpStatus: result.status, state, body: result.body };
}

export type WeedmapsPushResult = {
  mode: "live";
  method: "POST";
  ok: boolean;
  httpStatus: number;
  itemCount: number;
  payload: WmItemsPayload;
  response: unknown;
  message: string | null;
  notes: string[];
};

/**
 * Live push of the published menu to WeedMaps (POST /partners/menus/{menu_id}/items).
 * Requires explicit `confirm: true` AND full credentials. The exact item write schema
 * is confirmed against the live API by the operator; this surfaces WeedMaps' response
 * (including 422 validation or 423 Locked) verbatim so staff can validate.
 */
export async function pushWeedmapsMenu(opts: { confirm: boolean }): Promise<WeedmapsPushResult> {
  if (!opts.confirm) {
    throw new Error("Live WeedMaps push requires explicit confirmation.");
  }
  if (!isWeedmapsConfigured()) {
    throw new Error("WeedMaps is not configured: set menu id + OAuth credentials or access token.");
  }

  const { items } = await loadSyndicationFeed();
  const payload = buildWmItemsPayload(items);

  const result = await authedFetch(menuItemsUrl(), "POST", payload);

  let message: string | null = null;
  if (!result.ok) {
    if (result.status === 423) message = "WeedMaps integration is paused (423 Locked); writes are blocked.";
    else if (result.status === 422) message = "WeedMaps rejected the payload (422 validation); review the response errors.";
    else if (result.status === 404) message = "Menu not accessible (404); verify the menu id and access.";
    else message = `WeedMaps responded ${result.status}.`;
  }

  return {
    mode: "live",
    method: "POST",
    ok: result.ok,
    httpStatus: result.status,
    itemCount: items.length,
    payload,
    response: result.body,
    message,
    notes: SCHEMA_NOTES,
  };
}

export type { SyndicationItem };
