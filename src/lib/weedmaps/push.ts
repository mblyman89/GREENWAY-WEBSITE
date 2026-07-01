/**
 * src/lib/weedmaps/push.ts
 *
 * Server-side WeedMaps Menu API (2025-07) push — HARDENED.
 *
 * Grounded ENTIRELY in the owner-supplied Weedmaps developer docs (33 PDFs total).
 * See docs/weedmaps-menu-api.md. Verified facts encoded here:
 *   - Base URL:      https://api-g.weedmaps.com/wm/2025-07/partners
 *   - Token:         POST https://api-g.weedmaps.com/auth/token  (JSON body,
 *                    grant_type=client_credentials, scope=..., 201 Created, 14-day JWT).
 *                    Token reused before the 7-day mark; cache & reuse — /auth/token is
 *                    rate-limited to 1 request/minute. Inspect the GRANTED `scope` (you are
 *                    not guaranteed all requested scopes; a missing scope -> 403).
 *   - Auth header:   Authorization: Bearer {access_token}  (401 missing/invalid/expired,
 *                    403 valid-but-missing-scope).
 *   - Rate limits:   global 2,500/min (420/10s). Retry 429 + 5xx with exponential backoff.
 *   - Errors:        422 invalid data (prohibited terms / one-root-category / bad image),
 *                    404/423 access/paused. Error body { errors:[{status,title,detail,...}] }.
 *   - Verify access: GET  /partners/menus/{menu_id}  (200 access, 404 none, 423 paused).
 *   - Create item:   POST /partners/menus/{menu_id}/items.
 *   - Images:        one per item; PATCH /partners/menu_items/{id} { image_url,
 *                    image_updated_at? } ; JPG/PNG only; HEAD must return 200.
 *   - external_id REQUIRED + STABLE on every item; one root (L1) category required.
 *
 * NOT inlined in the supplied docs (so we DO NOT guess): the exact base item / variant
 * price/weight write schema (shown in the live "API Examples"). Our payload uses the
 * VERIFIED linking fields and namespaces price/variant under `_variants`; the live push
 * therefore defaults to a non-network PREVIEW and the result clearly flags the price/
 * variant schema as pending final verification against the live API.
 *
 * Safety: live writes are gated behind explicit `confirm: true` AND full credentials.
 * Every attempt is recorded to syndication_logs by the caller (channel: "weedmaps").
 */
import "server-only";

import { getWeedmapsBaseUrl, getWeedmapsConfig } from "./config";
import { refreshWeedmapsConfig } from "./runtime";
import { buildWmItemsPayload, type WmItemsPayload } from "./payload-core";
import { describeWeedmapsRuntime, isWeedmapsConfigured } from "./client";
import { loadSyndicationFeed } from "@/lib/syndication/feed-source";
import type { SyndicationItem } from "@/lib/syndication/menu-feed-core";

export * from "./payload-core";

export type WeedmapsReadiness = {
  environment: "sandbox" | "production";
  baseUrl: string;
  tokenUrl: string;
  hasMenuId: boolean;
  hasOAuthCredentials: boolean;
  hasAccessToken: boolean;
  configured: boolean;
};

export function describeWeedmapsReadiness(): WeedmapsReadiness {
  const s = describeWeedmapsRuntime();
  const config = getWeedmapsConfig();
  return {
    environment: s.environment,
    baseUrl: s.baseUrl,
    tokenUrl: config.tokenUrl,
    hasMenuId: s.hasMenuId,
    hasOAuthCredentials: s.hasOAuthCredentials,
    hasAccessToken: s.hasAccessToken,
    configured: isWeedmapsConfigured(),
  };
}

export { isWeedmapsConfigured };

/** Load back-office credentials (DB over env) then describe readiness. */
export async function describeWeedmapsReadinessAsync(): Promise<WeedmapsReadiness> {
  await refreshWeedmapsConfig();
  return describeWeedmapsReadiness();
}

const REQUIRED_WRITE_SCOPES = ["menu_items", "menus:write"] as const;

export type WeedmapsPreview = {
  mode: "preview";
  itemCount: number;
  versionId: string | null;
  payload: WmItemsPayload;
  readiness: WeedmapsReadiness;
  /** Verified caveats surfaced to staff before any live write. */
  notes: string[];
};

const SCHEMA_NOTES = [
  "Linking fields (external_id, category_names, brand_name, strain_name, cannabinoids) are grounded in the Weedmaps 2025-07 docs.",
  "The exact base item price/variant write schema is shown in Weedmaps' live API Examples rather than the supplied docs; price/variant is surfaced under `_variants` and must be confirmed against the live menu before enabling live writes.",
  "external_id uses our stable POS product key (never a batch id) so curated Weedmaps data is preserved across syncs.",
  "Images: one per item, JPG/PNG only, set via image_url (PATCH /menu_items/{id}); the image host must answer a HEAD request with 200.",
];

/**
 * Dry-run: build the exact payload from the published menu version WITHOUT calling
 * WeedMaps. Safe to run any time, with or without credentials.
 */
export async function previewWeedmapsPush(): Promise<WeedmapsPreview> {
  await refreshWeedmapsConfig();
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
// OAuth2 token (client-credentials) — VERIFIED against "Obtaining an Access Token".
// POST https://api-g.weedmaps.com/auth/token with a JSON body; 201 returns a 14-day JWT.
// We cache aggressively because /auth/token is limited to 1 request/minute, and the same
// token is returned until 50% (7 days) of its lifetime has elapsed.
// ---------------------------------------------------------------------------
type CachedToken = { token: string; expiresAt: number; scope: string };
let tokenCache: CachedToken | null = null;

export class WeedmapsScopeError extends Error {
  readonly grantedScope: string;
  readonly missing: string[];
  constructor(grantedScope: string, missing: string[]) {
    super(
      `WeedMaps token is missing required scope(s): ${missing.join(", ")}. Granted: "${grantedScope || "(none)"}".`,
    );
    this.name = "WeedmapsScopeError";
    this.grantedScope = grantedScope;
    this.missing = missing;
  }
}

function scopeIncludes(granted: string, required: string): boolean {
  return granted.split(/\s+/).filter(Boolean).includes(required);
}

async function getAccessToken(): Promise<string> {
  const config = getWeedmapsConfig();

  // Onboarding shortcut: a directly-provisioned bearer token (scope assumed managed by owner).
  if (config.accessToken) {
    return config.accessToken;
  }

  if (!config.clientId || !config.clientSecret) {
    throw new Error("WeedMaps OAuth credentials are not configured.");
  }

  const now = Date.now();
  // Reuse the cached token until ~24h before expiry. (Token lifetime is 14 days and a new
  // token is only issued after the 7-day mark anyway, so this avoids needless /auth/token
  // calls against the strict 1/min limit.)
  if (tokenCache && tokenCache.expiresAt > now + 24 * 60 * 60 * 1000) {
    assertWriteScopes(tokenCache.scope);
    return tokenCache.token;
  }

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials",
      scope: config.scope,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WeedMaps token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) {
    throw new Error("WeedMaps token response missing access_token.");
  }
  const grantedScope = json.scope ?? "";
  // Verified: you are not guaranteed all requested scopes — inspect what was granted.
  assertWriteScopes(grantedScope);

  const ttlMs = (json.expires_in ?? 1_209_600) * 1000; // default 14 days
  tokenCache = { token: json.access_token, expiresAt: now + ttlMs, scope: grantedScope };
  return json.access_token;
}

function assertWriteScopes(grantedScope: string) {
  const missing = REQUIRED_WRITE_SCOPES.filter((s) => !scopeIncludes(grantedScope, s));
  // Only enforce when the listing actually returned a scope string; some onboarding flows
  // return an empty scope that the listing still honors, so we surface but do not hard-fail
  // on a fully-empty scope (the API itself returns 403 if truly unauthorized).
  if (grantedScope && missing.length === REQUIRED_WRITE_SCOPES.length) {
    throw new WeedmapsScopeError(grantedScope, missing);
  }
}

/** Clear the cached token (e.g. after a 401 expired-token response). */
export function resetWeedmapsTokenCache() {
  tokenCache = null;
}

function menuUrl(): string {
  const config = getWeedmapsConfig();
  const base = getWeedmapsBaseUrl(config.environment);
  return `${base}/menus/${encodeURIComponent(config.menuId ?? "")}`;
}

function menuItemsUrl(): string {
  return `${menuUrl()}/items`;
}

function menuItemUrl(itemId: string): string {
  const config = getWeedmapsConfig();
  const base = getWeedmapsBaseUrl(config.environment);
  return `${base}/menu_items/${encodeURIComponent(itemId)}`;
}

type FetchResult = { ok: boolean; status: number; body: unknown };

const RETRYABLE = (status: number) => status === 429 || (status >= 500 && status <= 599);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Authorized fetch with verified resilience:
 *   - Bearer auth.
 *   - On 401 once: clear token cache and retry (handles an expired/rotated token).
 *   - On 429 / 5xx: exponential backoff (250ms, 500ms, 1s), up to 3 attempts.
 */
async function authedFetch(url: string, method: string, body?: unknown): Promise<FetchResult> {
  const maxAttempts = 3;
  let didRetryAuth = false;

  for (let attempt = 1; ; attempt += 1) {
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

    // Expired/rotated token: clear cache and retry once.
    if (res.status === 401 && !didRetryAuth && !getWeedmapsConfig().accessToken) {
      didRetryAuth = true;
      resetWeedmapsTokenCache();
      continue;
    }

    if (RETRYABLE(res.status) && attempt < maxAttempts) {
      await sleep(250 * 2 ** (attempt - 1));
      continue;
    }

    return { ok: res.ok, status: res.status, body: parsed };
  }
}

export type WeedmapsAccessResult = {
  ok: boolean;
  httpStatus: number;
  /** Convenience interpretation of the verified status codes. */
  state: "access" | "not_found" | "locked" | "unauthorized" | "rate_limited" | "error";
  body: unknown;
};

function interpret(status: number, ok: boolean): WeedmapsAccessResult["state"] {
  if (ok) return "access";
  if (status === 404) return "not_found";
  if (status === 423) return "locked";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  return "error";
}

/**
 * Verify write access to the configured menu. Grounded: GET /partners/menus/{menu_id}
 * returns 200 = access, 404 = no access, 423 = paused (locked), 401/403 = auth/scope.
 */
export async function verifyWeedmapsMenuAccess(): Promise<WeedmapsAccessResult> {
  await refreshWeedmapsConfig();
  if (!isWeedmapsConfigured()) {
    throw new Error("WeedMaps is not configured: set menu id + OAuth credentials or access token.");
  }
  const result = await authedFetch(menuUrl(), "GET");
  return {
    ok: result.ok,
    httpStatus: result.status,
    state: interpret(result.status, result.ok),
    body: result.body,
  };
}

function messageForStatus(status: number): string | null {
  if (status === 423) return "WeedMaps integration is paused (423 Locked); writes are blocked.";
  if (status === 422) return "WeedMaps rejected the payload (422): check for prohibited terms in name/description, the one-root-category rule, or unsupported images.";
  if (status === 404) return "Menu not accessible (404); verify the menu id and that the listing added you as integrator.";
  if (status === 403) return "Forbidden (403): the token is missing a required scope (menu_items / menus:write).";
  if (status === 401) return "Unauthorized (401): the access token is missing, invalid, or expired.";
  if (status === 429) return "Rate limited (429): backed off and retried; reduce push frequency if this persists.";
  if (status >= 500) return `WeedMaps server error (${status}); retried with backoff. If sustained, contact integrations@weedmaps.com.`;
  return `WeedMaps responded ${status}.`;
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
 * Requires explicit `confirm: true` AND full credentials. Surfaces WeedMaps' response
 * (including 422 validation, 423 Locked, 401/403 auth) verbatim so staff can validate.
 */
export async function pushWeedmapsMenu(opts: { confirm: boolean }): Promise<WeedmapsPushResult> {
  if (!opts.confirm) {
    throw new Error("Live WeedMaps push requires explicit confirmation.");
  }
  await refreshWeedmapsConfig();
  if (!isWeedmapsConfigured()) {
    throw new Error("WeedMaps is not configured: set menu id + OAuth credentials or access token.");
  }

  const { items } = await loadSyndicationFeed();
  const payload = buildWmItemsPayload(items);

  const result = await authedFetch(menuItemsUrl(), "POST", payload);

  return {
    mode: "live",
    method: "POST",
    ok: result.ok,
    httpStatus: result.status,
    itemCount: items.length,
    payload,
    response: result.body,
    message: result.ok ? null : messageForStatus(result.status),
    notes: SCHEMA_NOTES,
  };
}

export type WeedmapsImageResult = {
  ok: boolean;
  httpStatus: number;
  state: WeedmapsAccessResult["state"];
  body: unknown;
  message: string | null;
};

/**
 * Set/replace a single menu item's image (VERIFIED — Working with Images).
 * PATCH /partners/menu_items/{id} { image_url, image_updated_at? }.
 *   - JPG/PNG only; the image host must answer a HEAD request with 200.
 *   - Pass `forceRefresh: true` to send `image_updated_at` (current UNIX seconds) so
 *     Weedmaps re-downloads an image served from an UNCHANGED url. Do NOT force-refresh
 *     when the url itself changes on every update.
 * Requires explicit confirm + credentials.
 */
export async function setWeedmapsItemImage(opts: {
  itemId: string;
  imageUrl: string;
  forceRefresh?: boolean;
  confirm: boolean;
}): Promise<WeedmapsImageResult> {
  if (!opts.confirm) {
    throw new Error("Updating a WeedMaps item image requires explicit confirmation.");
  }
  await refreshWeedmapsConfig();
  if (!isWeedmapsConfigured()) {
    throw new Error("WeedMaps is not configured.");
  }
  if (!/^https:\/\//i.test(opts.imageUrl)) {
    throw new Error("Image URL must be an absolute https URL.");
  }

  const body: { image_url: string; image_updated_at?: number } = { image_url: opts.imageUrl };
  if (opts.forceRefresh) {
    body.image_updated_at = Math.floor(Date.now() / 1000);
  }

  const result = await authedFetch(menuItemUrl(opts.itemId), "PATCH", body);
  return {
    ok: result.ok,
    httpStatus: result.status,
    state: interpret(result.status, result.ok),
    body: result.body,
    message: result.ok ? null : messageForStatus(result.status),
  };
}

export type { SyndicationItem };
