/**
 * R6-4: CCRS Integrator API client — the PURE half. No I/O, no clock, no env.
 *
 * Foundation for the day the LCB approves Greenway as its own integrator
 * (Part 18). Nothing here sends anything: the I/O half
 * (`ccrs-integrator-api.ts`) refuses to call the network unless the per-env
 * switch is on AND every credential is set, and no screen or cron calls it yet.
 *
 * Every rule below is from the CCRS Integrator API Guide, Aug 2026, verbatim in
 * Part 02 §3 (`[API Lnnnn]`):
 *   - Two steps: "Obtain an access token" (OAuth 2.0 client credentials) then
 *     "Submit a file" (HTTP multipart) [API L0027-L0030].
 *   - Token endpoints and API identifiers (audience): Pre-Production
 *     https://test-login.wa.gov/oauth/token, lcb.ccrs.api.pre; Production
 *     https://www.login.wa.gov/oauth/token, lcb.ccrs.api.prod [API L0053-L0061].
 *   - Upload: POST https://<host>/api/v1/upload, host
 *     precannabisreporting.lcb.wa.gov / cannabisreporting.lcb.wa.gov
 *     [API L0066-L0075].
 *   - Headers: Authorization "Bearer <access token>", X-Uploader-Email "must be
 *     registered for your integrator" [API L0080-L0085].
 *   - File name "must include integrator identifier" [API L0091-L0092];
 *     "Integrators: UploadType_IntegratorID_YYYYMMDDHHMMSS" [G L0047].
 *   - Token body: client_id, client_secret, audience, grant_type
 *     client_credentials, JSON [API L0119-L0127]; "A token requested with the
 *     wrong audience is still issued ... but CCRS rejects it at upload"
 *     [API L0116-L0117].
 *   - "Tokens expire 24 hours after they are issued ... Cache and reuse a token
 *     until close to its expiry rather than requesting one per file."
 *     [API L0137-L0138].
 *   - Several files: repeat `files=@...` [API L0159-L0160]; "a submission is
 *     validated as a set. If any file fails validation, the whole request is
 *     rejected" [API L0170-L0172]. The guide's own example sends Area, Strain
 *     and Product together [API L0162-L0168] — one upload group.
 *   - Responses: 200 success, 400, 401, 500 ("Retry"), rejected file name
 *     [API L0187-L0198]; shapes {success,message,warnings} / {success:false,
 *     error} / {success:false, errors[]} [API L0201-L0223]; "Not every 401
 *     includes a JSON body ... empty body and a WWW-Authenticate header. Treat
 *     any 401 as an authentication failure"; an oversize request "returns an
 *     HTML error page rather than JSON" [API L0225-L0228].
 *   - "Acceptance means the file was received for processing, not that every
 *     row passed validation." [API L0230-L0231] — an accepted upload is NOT a
 *     success; the CCRS email still decides (S-12c / S-18a, unchanged).
 *
 * Secrets: read from server environment variables only (Part 18 row 13). They
 * never appear in an error message, a log line or `redactRequest` output.
 */
import { CCRS_UPLOAD_ORDER, ccrsFileStamp, uploadGroupOf, type CcrsRetailerFileType } from "./ccrs-batch-core";

export type ApiEnv = "preprod" | "prod";

export const CCRS_API_ENDPOINTS: Readonly<Record<ApiEnv, { tokenUrl: string; audience: string; uploadUrl: string }>> = {
  preprod: {
    tokenUrl: "https://test-login.wa.gov/oauth/token",
    audience: "lcb.ccrs.api.pre",
    uploadUrl: "https://precannabisreporting.lcb.wa.gov/api/v1/upload",
  },
  prod: {
    tokenUrl: "https://www.login.wa.gov/oauth/token",
    audience: "lcb.ccrs.api.prod",
    uploadUrl: "https://cannabisreporting.lcb.wa.gov/api/v1/upload",
  },
};

/** Server env var names, per environment. Values are never shipped to the browser. */
export function apiEnvVarNames(env: ApiEnv): { enabled: string; clientId: string; clientSecret: string; integratorId: string; uploaderEmail: string } {
  const P = env === "prod" ? "CCRS_API_PROD_" : "CCRS_API_PREPROD_";
  return {
    enabled: `${P}ENABLED`,
    clientId: `${P}CLIENT_ID`,
    clientSecret: `${P}CLIENT_SECRET`,
    integratorId: `${P}INTEGRATOR_ID`,
    uploaderEmail: `${P}UPLOADER_EMAIL`,
  };
}

export type IntegratorConfig = {
  env: ApiEnv;
  clientId: string;
  clientSecret: string;
  integratorId: string;
  uploaderEmail: string;
  tokenUrl: string;
  audience: string;
  uploadUrl: string;
};

export type ConfigOutcome =
  | { kind: "off"; env: ApiEnv; reason: string }
  | { kind: "incomplete"; env: ApiEnv; problems: string[] }
  | { kind: "ready"; config: IntegratorConfig };

/**
 * The Integrator ID sits between two underscores in the file name, so it may
 * not contain "_" (or anything that is not a plain letter, digit or hyphen).
 * The LCB has not published its format (U-79): refusing odd characters is the
 * safe side — a refused config sends nothing.
 */
export const INTEGRATOR_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/**
 * Read the config for one env from a plain map (process.env in production).
 * OFF unless `<P>ENABLED` is exactly "true". ON but missing/invalid values =
 * incomplete (nothing is sent). Problems name the variable, never its value.
 */
export function readIntegratorConfig(env: ApiEnv, vars: Readonly<Record<string, string | undefined>>): ConfigOutcome {
  const n = apiEnvVarNames(env);
  const get = (k: string) => (vars[k] ?? "").trim();
  if (get(n.enabled) !== "true") return { kind: "off", env, reason: `${n.enabled} is not "true"` };
  const problems: string[] = [];
  const clientId = get(n.clientId);
  const clientSecret = get(n.clientSecret);
  const integratorId = get(n.integratorId);
  const uploaderEmail = get(n.uploaderEmail);
  if (!clientId) problems.push(`${n.clientId} is not set`);
  if (!clientSecret) problems.push(`${n.clientSecret} is not set`);
  if (!integratorId) problems.push(`${n.integratorId} is not set`);
  else if (!INTEGRATOR_ID_RE.test(integratorId)) problems.push(`${n.integratorId} may only hold letters, digits and hyphens (it sits between underscores in the file name)`);
  if (!uploaderEmail) problems.push(`${n.uploaderEmail} is not set`);
  else if (!EMAIL_RE.test(uploaderEmail)) problems.push(`${n.uploaderEmail} is not an email address`);
  if (problems.length > 0) return { kind: "incomplete", env, problems };
  return { kind: "ready", config: { env, clientId, clientSecret, integratorId, uploaderEmail, ...CCRS_API_ENDPOINTS[env] } };
}

/* ------------------------------ Step 1: token ------------------------------ */

export function tokenRequest(cfg: IntegratorConfig): { url: string; headers: Record<string, string>; body: string } {
  return {
    url: cfg.tokenUrl,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, audience: cfg.audience, grant_type: "client_credentials" }),
  };
}

export type CachedToken = { accessToken: string; audience: string; expiresAtMs: number; lifetimeMs: number };
export type TokenOutcome = { ok: true; token: CachedToken } | { ok: false; error: string };

/** Decode the token endpoint answer. Errors never echo the body (it could hold a token). */
export function decodeTokenResponse(status: number, bodyText: string, audience: string, nowMs: number): TokenOutcome {
  if (status !== 200) return { ok: false, error: `token endpoint answered HTTP ${status}` };
  let j: unknown;
  try {
    j = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: "token endpoint answer is not JSON" };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, error: "token endpoint answer is not an object" };
  const o = j as Record<string, unknown>;
  if (typeof o.access_token !== "string" || o.access_token.trim() === "") return { ok: false, error: "token endpoint answer has no access_token" };
  if (typeof o.token_type !== "string" || o.token_type.toLowerCase() !== "bearer") return { ok: false, error: "token endpoint answer is not a Bearer token" };
  const exp = typeof o.expires_in === "number" ? o.expires_in : typeof o.expires_in === "string" && /^\d+$/.test(o.expires_in) ? Number(o.expires_in) : NaN;
  if (!Number.isFinite(exp) || exp <= 0) return { ok: false, error: "token endpoint answer has no positive expires_in" };
  const lifetimeMs = exp * 1000;
  return { ok: true, token: { accessToken: o.access_token, audience, expiresAtMs: nowMs + lifetimeMs, lifetimeMs } };
}

/** Refresh this long before expiry: 15 minutes, or half the lifetime for a short token. */
export function refreshMarginMs(lifetimeMs: number): number {
  return Math.min(15 * 60 * 1000, Math.floor(lifetimeMs / 2));
}

/** Reuse a cached token only for the SAME audience and only while not "close to its expiry". */
export function tokenIsUsable(t: CachedToken | null | undefined, audience: string, nowMs: number): t is CachedToken {
  if (!t) return false;
  if (t.audience !== audience) return false;
  return nowMs < t.expiresAtMs - refreshMarginMs(t.lifetimeMs);
}

/* ------------------------------ Step 2: upload ----------------------------- */

/** "UploadType_IntegratorID_YYYYMMDDHHMMSS" [G L0047], Pacific stamp like the licensee name [FAQ L0075]. */
export function integratorFileName(type: CcrsRetailerFileType, integratorId: string, now: Date): string {
  if (!INTEGRATOR_ID_RE.test(integratorId)) throw new Error(`R6-4: integrator id "${integratorId}" is not letters/digits/hyphens`);
  return `${type}_${integratorId}_${ccrsFileStamp(now)}.csv`;
}

export type UploadFile = { name: string; content: string };
export type UploadPart = { field: "files"; filename: string; contentType: string; body: string };
export type UploadRequest = { url: string; headers: Record<string, string>; parts: UploadPart[]; group: number };

const NAME_RE = /^([A-Za-z]+)_([A-Za-z0-9-]+)_(\d{14})\.csv$/;

/**
 * Build ONE upload request. Refuses (throws) rather than send something CCRS
 * would reject or that would break the upload order:
 *   - no files; a duplicate name in the request;
 *   - a name that is not `<UploadType>_<our IntegratorID>_<14 digits>.csv`
 *     ("one integrator per submission" [API L0093-L0094]);
 *   - files from more than one upload group (a set is validated together
 *     [API L0170-L0172]; group 2 needs group 1 processed first — the existing
 *     pacing releases the next group on the success notice);
 *   - an empty file or one not ending CRLF (our builder always ends CRLF).
 */
export function buildUploadRequest(cfg: IntegratorConfig, accessToken: string, files: readonly UploadFile[]): UploadRequest {
  if (!accessToken) throw new Error("R6-4: no access token");
  if (files.length === 0) throw new Error("R6-4: no files to upload");
  const seen = new Set<string>();
  const groups = new Set<number>();
  for (const f of files) {
    if (seen.has(f.name)) throw new Error(`R6-4: ${f.name} appears twice in one request`);
    seen.add(f.name);
    const m = NAME_RE.exec(f.name);
    if (!m) throw new Error(`R6-4: ${f.name} is not UploadType_IntegratorID_YYYYMMDDHHMMSS.csv`);
    const type = m[1] as CcrsRetailerFileType;
    if (!(CCRS_UPLOAD_ORDER as readonly string[]).includes(type)) throw new Error(`R6-4: ${f.name}: unknown upload type ${m[1]}`);
    if (m[2] !== cfg.integratorId) throw new Error(`R6-4: ${f.name} names integrator ${m[2]}, ours is ${cfg.integratorId}`);
    if (f.content === "" || !f.content.endsWith("\r\n")) throw new Error(`R6-4: ${f.name} is empty or does not end with CRLF`);
    groups.add(uploadGroupOf(type));
  }
  if (groups.size !== 1) throw new Error(`R6-4: one request may hold one upload group, got groups ${[...groups].sort().join(",")}`);
  return {
    url: cfg.uploadUrl,
    headers: { Authorization: `Bearer ${accessToken}`, "X-Uploader-Email": cfg.uploaderEmail },
    parts: files.map((f) => ({ field: "files", filename: f.name, contentType: "text/csv", body: f.content })),
    group: [...groups][0],
  };
}

/** What may be logged or shown: the token is cut to its last 4 characters, file bodies to their size. */
export function redactRequest(r: UploadRequest): { url: string; headers: Record<string, string>; files: { filename: string; bytes: number }[] } {
  const auth = r.headers.Authorization ?? "";
  const tok = auth.replace(/^Bearer /, "");
  return {
    url: r.url,
    headers: { Authorization: `Bearer …${tok.slice(-4)}`, "X-Uploader-Email": r.headers["X-Uploader-Email"] ?? "" },
    files: r.parts.map((p) => ({ filename: p.filename, bytes: new TextEncoder().encode(p.body).length })),
  };
}

/* ----------------------------- Response handling --------------------------- */

export type UploadOutcome =
  | { kind: "received"; message: string; warnings: string[] }
  | { kind: "rejected"; error: string | null; errors: string[] }
  | { kind: "auth_failed"; detail: string }
  | { kind: "server_error"; detail: string }
  | { kind: "too_large"; detail: string }
  | { kind: "unknown"; detail: string };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))) : []);

/**
 * Classify the upload answer. `received` means CCRS took the files for
 * processing, NOT that they passed [API L0230-L0231]. `unknown` means we cannot
 * tell whether CCRS has the files: never retried automatically.
 */
export function classifyUploadResponse(r: { status: number; contentType: string | null; wwwAuthenticate: string | null; bodyText: string }): UploadOutcome {
  if (r.status === 401) {
    return { kind: "auth_failed", detail: r.wwwAuthenticate ? `401, WWW-Authenticate: ${r.wwwAuthenticate.slice(0, 200)}` : "401" };
  }
  const body = r.bodyText.trim();
  const looksHtml = /^</.test(body) || /text\/html/i.test(r.contentType ?? "");
  let j: Record<string, unknown> | null = null;
  if (!looksHtml && body !== "") {
    try {
      const p = JSON.parse(body);
      if (p && typeof p === "object" && !Array.isArray(p)) j = p as Record<string, unknown>;
    } catch {
      j = null;
    }
  }
  if (r.status === 500) return { kind: "server_error", detail: j && typeof j.error === "string" ? j.error : "HTTP 500" };
  // The guide gives no status for the oversize page (U-78): 413, or any 4xx
  // answered with HTML instead of JSON. A 200 HTML page is NOT this (unknown).
  if (j === null && (r.status === 413 || (looksHtml && r.status >= 400 && r.status < 500))) {
    return { kind: "too_large", detail: `HTTP ${r.status}, ${looksHtml ? "an HTML page" : "no JSON"} (a request over the server limit is answered this way)` };
  }
  if (r.status === 200 && j && j.success === true) {
    return { kind: "received", message: typeof j.message === "string" ? j.message : "", warnings: strings(j.warnings) };
  }
  if (r.status === 400 && j && j.success === false) {
    return { kind: "rejected", error: typeof j.error === "string" ? j.error : null, errors: strings(j.errors) };
  }
  return { kind: "unknown", detail: `HTTP ${r.status}${j ? `, success=${String(j.success)}` : body === "" ? ", empty body" : ", not JSON"}` };
}

export type NextStep = { action: "done" } | { action: "retry"; afterMs: number; freshToken: boolean } | { action: "stop"; why: string };

/** At most this many tries of one request. */
export const MAX_ATTEMPTS = 3;

/**
 * What to do after an answer. A 500 "was not accepted. Retry" [API L0195-L0196]
 * → retry with back-off. A 401 → one retry with a NEW token when the old one
 * came from the cache (it may have been revoked early); otherwise stop. A
 * rejection, an oversize page or an `unknown` answer → stop for a person.
 */
export function nextStep(o: UploadOutcome, attempt: number, tokenWasCached: boolean): NextStep {
  if (o.kind === "received") return { action: "done" };
  if (attempt >= MAX_ATTEMPTS) return { action: "stop", why: `gave up after ${attempt} tries (${o.kind})` };
  if (o.kind === "server_error") return { action: "retry", afterMs: 30_000 * attempt, freshToken: false };
  if (o.kind === "auth_failed" && tokenWasCached && attempt === 1) return { action: "retry", afterMs: 0, freshToken: true };
  if (o.kind === "auth_failed") return { action: "stop", why: "authentication failed: check the client id/secret, the audience and that the uploader email is registered" };
  if (o.kind === "rejected") return { action: "stop", why: "CCRS rejected the request; nothing in it was accepted" };
  if (o.kind === "too_large") return { action: "stop", why: "the request is over the server limit; send fewer or smaller files" };
  return { action: "stop", why: "the answer could not be read; CCRS may or may not have the files (check the CCRS email before re-sending)" };
}

/* ------------------------------------------------------------------ *
 * Self-tests (tsx/vitest-runnable — PURE module)
 * ------------------------------------------------------------------ */

export function __runIntegratorApiTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };
  const throws = (f: () => unknown) => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
  };
  const vars = { CCRS_API_PREPROD_ENABLED: "true", CCRS_API_PREPROD_CLIENT_ID: "cid", CCRS_API_PREPROD_CLIENT_SECRET: "sek", CCRS_API_PREPROD_INTEGRATOR_ID: "GWI1", CCRS_API_PREPROD_UPLOADER_EMAIL: "michael@greenwaymarijuana.com" };
  const c = readIntegratorConfig("preprod", vars);
  ok(c.kind === "ready" && c.config.audience === "lcb.ccrs.api.pre" && c.config.tokenUrl === "https://test-login.wa.gov/oauth/token", "preprod config ready");
  ok(readIntegratorConfig("prod", vars).kind === "off", "prod off without its own switch");
  ok(readIntegratorConfig("preprod", { ...vars, CCRS_API_PREPROD_ENABLED: "TRUE" }).kind === "off", "switch must be exactly true");
  const inc = readIntegratorConfig("preprod", { ...vars, CCRS_API_PREPROD_INTEGRATOR_ID: "GW_1" });
  ok(inc.kind === "incomplete" && !JSON.stringify(inc).includes("sek"), "underscore id refused; secret not echoed");
  if (c.kind !== "ready") return { passed, failed: failed + 1 };
  const cfg = c.config;
  ok(JSON.parse(tokenRequest(cfg).body).grant_type === "client_credentials", "client credentials grant");
  const t = decodeTokenResponse(200, JSON.stringify({ access_token: "abc.def", token_type: "Bearer", expires_in: 86400 }), cfg.audience, 0);
  ok(t.ok && t.token.expiresAtMs === 86_400_000, "token decoded");
  ok(t.ok && tokenIsUsable(t.token, cfg.audience, 86_400_000 - 16 * 60_000) && !tokenIsUsable(t.token, cfg.audience, 86_400_000 - 14 * 60_000), "refresh 15 min early");
  ok(t.ok && !tokenIsUsable(t.token, "lcb.ccrs.api.prod", 0), "audience-bound cache");
  ok(!decodeTokenResponse(401, "{}", cfg.audience, 0).ok, "token non-200 fails");
  const name = integratorFileName("Area", "GWI1", new Date("2026-11-02T20:00:05Z"));
  ok(name === "Area_GWI1_20261102120005.csv", "integrator file name, Pacific stamp");
  const req = buildUploadRequest(cfg, "tok1234", [{ name, content: "a\r\n" }, { name: "Strain_GWI1_20261102120006.csv", content: "b\r\n" }]);
  ok(req.headers.Authorization === "Bearer tok1234" && req.headers["X-Uploader-Email"] === cfg.uploaderEmail && req.parts.length === 2 && req.group === 1, "upload request");
  ok(throws(() => buildUploadRequest(cfg, "t", [{ name, content: "a\r\n" }, { name: "Inventory_GWI1_20261102120006.csv", content: "b\r\n" }])), "mixed groups refused");
  ok(throws(() => buildUploadRequest(cfg, "t", [{ name: "Area_413541_20261102120005.csv", content: "a\r\n" }])), "licensee name refused");
  ok(!JSON.stringify(redactRequest(req)).includes("tok1234") && redactRequest(req).headers.Authorization.endsWith("1234"), "redacted");
  ok(classifyUploadResponse({ status: 200, contentType: "application/json", wwwAuthenticate: null, bodyText: '{"success":true,"message":"m","warnings":[]}' }).kind === "received", "200 received");
  const e2 = classifyUploadResponse({ status: 400, contentType: "application/json", wwwAuthenticate: null, bodyText: '{"success":false,"errors":["a","b"]}' });
  ok(e2.kind === "rejected" && e2.errors.length === 2, "400 errors[]");
  ok(classifyUploadResponse({ status: 401, contentType: null, wwwAuthenticate: "Bearer", bodyText: "" }).kind === "auth_failed", "401 empty body");
  ok(classifyUploadResponse({ status: 413, contentType: "text/html", wwwAuthenticate: null, bodyText: "<html>too big</html>" }).kind === "too_large", "oversize HTML");
  ok(nextStep({ kind: "server_error", detail: "" }, 1, false).action === "retry", "500 retried");
  ok(nextStep({ kind: "unknown", detail: "" }, 1, false).action === "stop", "unknown never retried");
  return { passed, failed };
}
