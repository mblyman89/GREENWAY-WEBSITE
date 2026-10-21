/**
 * R6-5 (CCRS Bible v2 Part 09): keyless Gmail sign-in for the CCRS mailbox monitor.
 *
 * Owner (2026-10-21): "I tried option a ... I need a key. Google says it
 * doesn't do it that way anymore and to use their new more secure method".
 * New Google organisations enforce iam.disableServiceAccountKeyCreation, so
 * GMAIL_SA_PRIVATE_KEY cannot be made. This mode needs no key:
 *   Vercel OIDC token -> STS token exchange -> IAM Credentials signJwt
 *   (the SAME domain-wide-delegation claims as option A) -> oauth2 jwt-bearer.
 *
 * Request shapes pinned here are from the vendor docs read 2026-10-21:
 *   - vercel.com/docs/oidc/reference (token claims; header, then
 *     VERCEL_OIDC_TOKEN_FILE, then VERCEL_OIDC_TOKEN),
 *   - vercel.com/docs/oidc/gcp (audience //iam.googleapis.com/projects/N/
 *     locations/global/workloadIdentityPools/P/providers/V, STS token_url),
 *   - cloud.google.com IAM REST (pool/provider id "4-32 characters ... [a-z0-9-]",
 *     "The prefix gcp- is reserved"),
 *   - google-github-actions/auth (signJwt with the federated token, then
 *     jwt-bearer at oauth2; "grant the external identity ...
 *     roles/iam.serviceAccountTokenCreator" for domain-wide delegation).
 */
import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_PLATFORM_SCOPE,
  GMAIL_READONLY_SCOPE,
  GOOGLE_TOKEN_URL,
  JWT_BEARER_GRANT,
  STS_TOKEN_URL,
  WIF_VARS,
  decodeSignJwtResponse,
  decodeStsResponse,
  heartbeatFromSetting,
  mailConfigFromEnv,
  oidcTokenFacts,
  pickVercelOidcToken,
  signJwtRequest,
  stsExchangeBody,
  wifAudience,
  wifPrincipal,
  workloadIdentityProblem,
  type WorkloadIdentityConfig,
} from "@/lib/compliance/ccrs-mail-core";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

const WI_ENV = {
  GMAIL_WIF_SERVICE_ACCOUNT_EMAIL: "ccrs-mail@greenway-ccrs.iam.gserviceaccount.com",
  GMAIL_WIF_PROJECT_NUMBER: "123456789012",
  GMAIL_WIF_POOL_ID: "vercel",
  GMAIL_WIF_PROVIDER_ID: "vercel",
};
const WI: WorkloadIdentityConfig = { serviceAccountEmail: WI_ENV.GMAIL_WIF_SERVICE_ACCOUNT_EMAIL, projectNumber: "123456789012", poolId: "vercel", providerId: "vercel" };

/** A Vercel-shaped OIDC token (unsigned; only Google verifies it, the app never trusts it). */
function vercelToken(claims: Record<string, unknown> = {}): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "RS256", typ: "JWT", kid: "k" })}.${b({
    iss: "https://oidc.vercel.com/michael-lymans-projects",
    aud: "https://vercel.com/michael-lymans-projects",
    sub: "owner:michael-lymans-projects:project:greenway_website:environment:production",
    ...claims,
  })}.sig`;
}

const CTX = Symbol.for("@vercel/request-context");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (globalThis as Record<symbol, unknown>)[CTX];
});

describe("config: the keyless mode", () => {
  it("four variables select workload-identity; the email is lower-cased", () => {
    const c = mailConfigFromEnv({ ...WI_ENV, GMAIL_WIF_SERVICE_ACCOUNT_EMAIL: " CCRS-Mail@greenway-ccrs.iam.gserviceaccount.com " });
    expect(c.configured && c.mode).toBe("workload-identity");
    expect(c.configured && c.workloadIdentity).toEqual(WI);
  });

  it("nothing set names the keyless variables (the recommended way)", () => {
    const c = mailConfigFromEnv({});
    expect(!c.configured && c.missing).toEqual([...WIF_VARS]);
  });

  it("a partial setup names exactly what is missing", () => {
    const c = mailConfigFromEnv({ GMAIL_WIF_SERVICE_ACCOUNT_EMAIL: WI_ENV.GMAIL_WIF_SERVICE_ACCOUNT_EMAIL, GMAIL_WIF_POOL_ID: "vercel" });
    expect(!c.configured && c.missing).toEqual(["GMAIL_WIF_PROJECT_NUMBER", "GMAIL_WIF_PROVIDER_ID"]);
  });

  it("mixing the keyless set with a key or OAuth is refused, naming both sets", () => {
    for (const extra of [{ GMAIL_SA_CLIENT_EMAIL: "x" }, { GMAIL_OAUTH_CLIENT_ID: "y" }]) {
      const c = mailConfigFromEnv({ ...WI_ENV, ...extra });
      expect(c.configured).toBe(false);
      expect(!c.configured && c.problem).toMatch(/GMAIL_WIF_\*/);
    }
    const old = mailConfigFromEnv({ GMAIL_SA_CLIENT_EMAIL: "a", GMAIL_OAUTH_CLIENT_ID: "b" });
    expect(!old.configured && old.problem).toMatch(/^Both the service-account \(GMAIL_SA_\*\) and the OAuth \(GMAIL_OAUTH_\*\) variables are set/);
    const three = mailConfigFromEnv({ ...WI_ENV, GMAIL_SA_CLIENT_EMAIL: "a", GMAIL_OAUTH_CLIENT_ID: "b" });
    expect(!three.configured && three.problem).toMatch(/^The service-account .*, OAuth .*, keyless/);
  });

  it("the usual mix-ups are caught with a plain sentence", () => {
    expect(workloadIdentityProblem({ ...WI, projectNumber: "greenway-ccrs" })).toMatch(/project NUMBER/);
    expect(workloadIdentityProblem({ ...WI, serviceAccountEmail: "michael@greenwaymarijuana.com" })).toMatch(/iam\.gserviceaccount\.com/);
    expect(workloadIdentityProblem({ ...WI, poolId: "Vercel" })).toMatch(/GMAIL_WIF_POOL_ID/);
    expect(workloadIdentityProblem({ ...WI, providerId: "gcp-x1" })).toMatch(/GMAIL_WIF_PROVIDER_ID/);
    expect(workloadIdentityProblem({ ...WI, poolId: "abc" })).toMatch(/4-32/);
    expect(workloadIdentityProblem({ ...WI, poolId: "a".repeat(32) })).toBeNull();
    expect(workloadIdentityProblem(WI)).toBeNull();
  });

  it("the heartbeat keeps the new mode", () => {
    expect(heartbeatFromSetting({ lastRunAt: "t", ok: true, mode: "workload-identity" })?.mode).toBe("workload-identity");
    expect(heartbeatFromSetting({ lastRunAt: "t", ok: true, mode: "bogus" })?.mode).toBeNull();
  });
});

describe("request builders (pure)", () => {
  it("STS: provider audience, token-exchange, cloud-platform, the Vercel token as subject", () => {
    expect(wifAudience(WI)).toBe("//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel");
    expect(stsExchangeBody(WI, "VTOK")).toEqual({
      audience: "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel",
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      scope: CLOUD_PLATFORM_SCOPE,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken: "VTOK",
    });
    expect(STS_TOKEN_URL).toBe("https://sts.googleapis.com/v1/token");
  });

  it("signJwt: the service account's URL and the DWD claims for the mailbox, 1 hour", () => {
    const r = signJwtRequest(WI, "michael@greenwaymarijuana.com", 1_800_000_000);
    expect(r.url).toBe("https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/ccrs-mail%40greenway-ccrs.iam.gserviceaccount.com:signJwt");
    expect(JSON.parse(r.body.payload)).toEqual({
      iss: WI.serviceAccountEmail,
      sub: "michael@greenwaymarijuana.com",
      scope: GMAIL_READONLY_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
  });

  it("token source order is header, file, env; blanks are skipped", () => {
    expect(pickVercelOidcToken({ header: "h", file: "f", env: "e" })).toBe("h");
    expect(pickVercelOidcToken({ header: "", file: " f \n", env: "e" })).toBe("f");
    expect(pickVercelOidcToken({ header: null, file: null, env: "e" })).toBe("e");
    expect(pickVercelOidcToken({})).toBeNull();
  });

  it("token facts are read for messages; garbage gives nulls", () => {
    expect(oidcTokenFacts(vercelToken())).toEqual({
      iss: "https://oidc.vercel.com/michael-lymans-projects",
      aud: "https://vercel.com/michael-lymans-projects",
      sub: "owner:michael-lymans-projects:project:greenway_website:environment:production",
    });
    expect(oidcTokenFacts("nope")).toEqual({ iss: null, aud: null, sub: null });
  });

  it("the principal to grant is built from the token's subject", () => {
    expect(wifPrincipal(WI, "owner:t:project:p:environment:production")).toBe(
      "principal://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/subject/owner:t:project:p:environment:production",
    );
    expect(wifPrincipal(WI, null)).toBeNull();
  });
});

describe("answer decoders (pure)", () => {
  const facts = oidcTokenFacts(vercelToken());
  it("STS ok / empty / audience / issuer / not found", () => {
    expect(decodeStsResponse(200, { access_token: "fed" }, facts)).toEqual({ ok: true, token: "fed" });
    expect(decodeStsResponse(200, {}, facts).ok).toBe(false);
    const aud = decodeStsResponse(400, { error: "invalid_grant", error_description: "The audience in ID Token [x] does not match the expected audience." }, facts);
    expect(!aud.ok && aud.error).toMatch(/Allowed audience must be exactly https:\/\/vercel\.com\/michael-lymans-projects/);
    const iss = decodeStsResponse(400, { error: "invalid_grant", error_description: "The issuer in ID Token does not match" }, facts);
    expect(!iss.ok && iss.error).toMatch(/Issuer URL must be exactly https:\/\/oidc\.vercel\.com\/michael-lymans-projects/);
    const nf = decodeStsResponse(400, { error: "invalid_target", error_description: "The target service indicated by the audience parameter does not exist" }, facts);
    expect(!nf.ok && nf.error).toMatch(/GMAIL_WIF_PROJECT_NUMBER/);
    expect(!nf.ok && nf.error).toMatch(/subject owner:michael-lymans-projects:project:greenway_website:environment:production/);
  });

  it("signJwt ok / API off / permission / not found", () => {
    const ctx = { serviceAccountEmail: WI.serviceAccountEmail, principal: "principal://X" };
    expect(decodeSignJwtResponse(200, { keyId: "k", signedJwt: "a.b.c" }, ctx)).toEqual({ ok: true, signedJwt: "a.b.c" });
    expect(decodeSignJwtResponse(200, { signedJwt: "a.b" }, ctx).ok).toBe(false);
    const off = decodeSignJwtResponse(403, { error: { message: "IAM Service Account Credentials API has not been used in project 1 before or it is disabled." } }, ctx);
    expect(!off.ok && off.error).toMatch(/turn on the IAM Service Account Credentials API/);
    const perm = decodeSignJwtResponse(403, { error: { message: "Permission 'iam.serviceAccounts.signJwt' denied on resource (or it may not exist)." } }, ctx);
    expect(!perm.ok && perm.error).toMatch(/give principal:\/\/X the role Service Account Token Creator/);
    const nf = decodeSignJwtResponse(404, { error: { message: "Not found" } }, ctx);
    expect(!nf.ok && nf.error).toMatch(/does not name a service account/);
  });
});

describe("the whole keyless chain (I/O, fake Google)", () => {
  function fakeGoogle(over: { sts?: Response; sign?: Response; token?: Response } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url === STS_TOKEN_URL) return over.sts ?? new Response(JSON.stringify({ access_token: "FED", token_type: "Bearer", expires_in: 3599 }));
        if (url.includes(":signJwt")) return over.sign ?? new Response(JSON.stringify({ keyId: "k1", signedJwt: "h.c.s" }));
        if (url === GOOGLE_TOKEN_URL) return over.token ?? new Response(JSON.stringify({ access_token: "GMAIL", expires_in: 3599 }));
        return new Response("{}", { status: 404 });
      }),
    );
    return calls;
  }
  const cfg = () => {
    const c = mailConfigFromEnv(WI_ENV);
    if (!c.configured) throw new Error("cfg");
    return c;
  };

  it("request header token -> STS -> signJwt (Bearer FED) -> jwt-bearer -> Gmail token", async () => {
    const tok = vercelToken();
    (globalThis as Record<symbol, unknown>)[CTX] = { get: () => ({ headers: { "x-vercel-oidc-token": tok } }) };
    vi.stubEnv("VERCEL_OIDC_TOKEN", "ENV-SHOULD-NOT-BE-USED");
    const calls = fakeGoogle();
    const { getGmailAccessToken } = await import("@/lib/compliance/ccrs-mail-fetch");
    expect(await getGmailAccessToken(cfg(), 1_800_000_000_000)).toBe("GMAIL");
    expect(calls.map((c) => c.url.split("?")[0])).toEqual([STS_TOKEN_URL, signJwtRequest(WI, "x", 0).url, GOOGLE_TOKEN_URL]);
    const sts = JSON.parse(String(calls[0].init.body));
    expect(sts.subjectToken).toBe(tok);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer FED");
    expect(JSON.parse(JSON.parse(String(calls[1].init.body)).payload).sub).toBe("michael@greenwaymarijuana.com");
    expect(Object.fromEntries(new URLSearchParams(String(calls[2].init.body)))).toEqual({ grant_type: JWT_BEARER_GRANT, assertion: "h.c.s" });
  });

  it("without a header, VERCEL_OIDC_TOKEN_FILE then VERCEL_OIDC_TOKEN are used", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oidc-"));
    const f = path.join(dir, "t");
    writeFileSync(f, "FILETOK\n");
    vi.stubEnv("VERCEL_OIDC_TOKEN_FILE", f);
    vi.stubEnv("VERCEL_OIDC_TOKEN", "ENVTOK");
    let calls = fakeGoogle();
    const { getGmailAccessToken } = await import("@/lib/compliance/ccrs-mail-fetch");
    await getGmailAccessToken(cfg());
    expect(JSON.parse(String(calls[0].init.body)).subjectToken).toBe("FILETOK");
    vi.stubEnv("VERCEL_OIDC_TOKEN_FILE", "");
    calls = fakeGoogle();
    await getGmailAccessToken(cfg());
    expect(JSON.parse(String(calls[0].init.body)).subjectToken).toBe("ENVTOK");
  });

  it("no token at all: a sentence telling the owner to switch on Vercel OIDC; nothing is sent", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN_FILE", "");
    const calls = fakeGoogle();
    const { getGmailAccessToken } = await import("@/lib/compliance/ccrs-mail-fetch");
    await expect(getGmailAccessToken(cfg())).rejects.toThrow(/Secure backend access with OIDC federation/);
    expect(calls).toHaveLength(0);
  });

  it("STS refusal stops before signJwt and shows what Vercel's token says", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", vercelToken());
    const calls = fakeGoogle({ sts: new Response(JSON.stringify({ error: "invalid_grant", error_description: "The audience in ID Token does not match" }), { status: 400 }) });
    const { getGmailAccessToken } = await import("@/lib/compliance/ccrs-mail-fetch");
    await expect(getGmailAccessToken(cfg())).rejects.toThrow(/Allowed audience must be exactly https:\/\/vercel\.com\/michael-lymans-projects/);
    expect(calls).toHaveLength(1);
  });

  it("signJwt denied names the exact principal to grant, and stops before oauth2", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", vercelToken());
    const calls = fakeGoogle({ sign: new Response(JSON.stringify({ error: { code: 403, message: "Permission 'iam.serviceAccounts.signJwt' denied", status: "PERMISSION_DENIED" } }), { status: 403 }) });
    const { getGmailAccessToken } = await import("@/lib/compliance/ccrs-mail-fetch");
    await expect(getGmailAccessToken(cfg())).rejects.toThrow(
      "principal://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/subject/owner:michael-lymans-projects:project:greenway_website:environment:production the role Service Account Token Creator",
    );
    expect(calls).toHaveLength(2);
  });

  it("delegation not granted yet: the oauth2 hint names the Admin console", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", vercelToken());
    fakeGoogle({ token: new Response(JSON.stringify({ error: "unauthorized_client", error_description: "Client is unauthorized to retrieve access tokens using this method" }), { status: 401 }) });
    const { getGmailAccessToken } = await import("@/lib/compliance/ccrs-mail-fetch");
    await expect(getGmailAccessToken(cfg())).rejects.toThrow(/domain-wide delegation in the Admin console/);
  });
});

describe("wiring and documentation", () => {
  it("the fetch layer adds no package: no @vercel/oidc or google-auth-library import", () => {
    const src = read("src/lib/compliance/ccrs-mail-fetch.ts");
    expect(src).not.toMatch(/from "@vercel\/oidc"|google-auth-library/);
    expect(src).toMatch(/Symbol\.for\("@vercel\/request-context"\)/);
  });
  it("the cron still calls the one tick (keyless needs no route change)", () => {
    expect(read("src/app/api/cron/ccrs-mail/route.ts")).toMatch(/await runCcrsMailTick\(\)/);
  });
  it(".env.example documents the four keyless variables and recommends them", () => {
    const ex = read(".env.example");
    for (const v of WIF_VARS) expect(ex, v).toMatch(new RegExp(`^${v}=`, "m"));
    expect(ex).toMatch(/\(K\) RECOMMENDED, KEYLESS/);
  });
});
