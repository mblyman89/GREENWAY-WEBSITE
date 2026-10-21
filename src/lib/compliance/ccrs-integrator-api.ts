/**
 * R6-4: CCRS Integrator API client — the I/O half. Server only.
 *
 * Every decision is in the PURE `ccrs-integrator-api-core.ts`; this file only
 * reads the environment, calls `fetch`, and keeps the token cache.
 *
 * NOTHING CALLS THIS YET. It is the foundation for the day the LCB approves
 * Greenway as an integrator (Part 18). Even when called, it refuses to touch
 * the network unless `CCRS_API_<ENV>_ENABLED=true` and every credential is set
 * (readIntegratorConfig). Uploads stay by hand through the portal until the
 * owner turns the switch on, PREprod first (Part 09 Roadmap R-1 gate).
 *
 * "Acceptance means the file was received for processing, not that every row
 * passed validation." [API L0230-L0231]: a `received` answer does not mark a
 * file succeeded. The CCRS email (S-12c / S-18a) still decides.
 */
import "server-only";

import {
  buildUploadRequest,
  classifyUploadResponse,
  decodeTokenResponse,
  nextStep,
  readIntegratorConfig,
  tokenIsUsable,
  tokenRequest,
  type ApiEnv,
  type CachedToken,
  type ConfigOutcome,
  type IntegratorConfig,
  type UploadFile,
  type UploadOutcome,
} from "./ccrs-integrator-api-core";

const TIMEOUT_MS = 60_000;

/** One cached token per env, per server instance. Never persisted, never logged. */
const tokenCache: Partial<Record<ApiEnv, CachedToken>> = {};

export function integratorConfig(env: ApiEnv): ConfigOutcome {
  return readIntegratorConfig(env, process.env);
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/** A usable token for this config: the cached one, or a new one. */
export async function getIntegratorToken(cfg: IntegratorConfig, opts: { forceNew?: boolean } = {}): Promise<{ ok: true; token: string; cached: boolean } | { ok: false; error: string }> {
  const now = Date.now();
  const hit = tokenCache[cfg.env];
  if (!opts.forceNew && tokenIsUsable(hit, cfg.audience, now)) return { ok: true, token: hit.accessToken, cached: true };
  const req = tokenRequest(cfg);
  let res: Response;
  try {
    res = await timedFetch(req.url, { method: "POST", headers: req.headers, body: req.body });
  } catch (e) {
    return { ok: false, error: `token request failed: ${(e as Error).name}` };
  }
  const out = decodeTokenResponse(res.status, await res.text(), cfg.audience, Date.now());
  if (!out.ok) {
    delete tokenCache[cfg.env];
    return out;
  }
  tokenCache[cfg.env] = out.token;
  return { ok: true, token: out.token.accessToken, cached: false };
}

export type UploadAttempt = { attempt: number; outcome: UploadOutcome };
export type UploadResult = { finished: "received" | "stopped"; why: string | null; attempts: UploadAttempt[] };

/**
 * Send ONE upload group (files already named by `integratorFileName`).
 * Retries only what the core allows (500 with back-off; one 401 with a new
 * token). A network failure after the request left is `unknown` and is never
 * retried: CCRS may already have the files.
 */
export async function uploadGroupViaApi(env: ApiEnv, files: readonly UploadFile[]): Promise<UploadResult> {
  const c = integratorConfig(env);
  if (c.kind !== "ready") {
    return { finished: "stopped", why: c.kind === "off" ? `integrator API is off (${c.reason})` : `integrator API is not set up: ${c.problems.join("; ")}`, attempts: [] };
  }
  const cfg = c.config;
  const attempts: UploadAttempt[] = [];
  let forceNew = false;
  for (let attempt = 1; ; attempt += 1) {
    const tok = await getIntegratorToken(cfg, { forceNew });
    if (!tok.ok) return { finished: "stopped", why: tok.error, attempts };
    const req = buildUploadRequest(cfg, tok.token, files);
    const form = new FormData();
    for (const p of req.parts) form.append(p.field, new Blob([p.body], { type: p.contentType }), p.filename);
    let outcome: UploadOutcome;
    try {
      const res = await timedFetch(req.url, { method: "POST", headers: req.headers, body: form });
      outcome = classifyUploadResponse({
        status: res.status,
        contentType: res.headers.get("content-type"),
        wwwAuthenticate: res.headers.get("www-authenticate"),
        bodyText: await res.text(),
      });
    } catch (e) {
      outcome = { kind: "unknown", detail: `no answer (${(e as Error).name}); CCRS may or may not have the files` };
    }
    attempts.push({ attempt, outcome });
    if (outcome.kind === "auth_failed") delete tokenCache[cfg.env];
    const step = nextStep(outcome, attempt, tok.cached);
    if (step.action === "done") return { finished: "received", why: null, attempts };
    if (step.action === "stop") return { finished: "stopped", why: step.why, attempts };
    forceNew = step.freshToken;
    if (step.afterMs > 0) await new Promise((r) => setTimeout(r, step.afterMs));
  }
}
