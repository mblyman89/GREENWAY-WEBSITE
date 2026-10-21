/**
 * tests/compliance/r6-4-integrator-api.test.ts   (Round 6 / Slice R6-4)
 *
 * The CCRS Integrator API client foundation, switched OFF. Every rule is from
 * the CCRS Integrator API Guide (Aug 2026), verbatim in Part 02 §3. The quotes
 * the code relies on are pinned against Part 02 here, so a changed guide or a
 * drifted constant fails loudly.
 *
 * Nothing in this slice sends anything: no route, cron or screen imports the
 * I/O module, and the I/O module refuses to call the network unless the
 * per-env switch is on and every credential is set.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  CCRS_API_ENDPOINTS,
  INTEGRATOR_ID_RE,
  MAX_ATTEMPTS,
  __runIntegratorApiTests,
  apiEnvVarNames,
  buildUploadRequest,
  classifyUploadResponse,
  decodeTokenResponse,
  integratorFileName,
  nextStep,
  readIntegratorConfig,
  redactRequest,
  refreshMarginMs,
  tokenIsUsable,
  tokenRequest,
  type IntegratorConfig,
} from "@/lib/compliance/ccrs-integrator-api-core";
import { ccrsFileName } from "@/lib/compliance/ccrs-batch-core";

const ROOT = path.resolve(__dirname, "../..");
const SRC = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const PART02 = SRC("docs/ccrs-bible/02-authoritative-spec.md");

function part02Line(heading: string, pin: string): string {
  const start = PART02.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest = PART02.slice(start);
  const next = rest.indexOf("\n## ", 5);
  const section = next > 0 ? rest.slice(0, next) : rest;
  const line = section.split("\n").find((l) => l.startsWith(`${pin}|`));
  expect(line, `${heading} ${pin}`).toBeDefined();
  return line as string;
}
const API = (pin: string) => part02Line("## 3. CCRS Integrator API Guide", pin);
const G = (pin: string) => part02Line("## 1. CCRS Upload User Guide", pin);

const VARS = {
  CCRS_API_PREPROD_ENABLED: "true",
  CCRS_API_PREPROD_CLIENT_ID: "client-abc",
  CCRS_API_PREPROD_CLIENT_SECRET: "SUPER-SECRET-VALUE",
  CCRS_API_PREPROD_INTEGRATOR_ID: "GWI413541",
  CCRS_API_PREPROD_UPLOADER_EMAIL: "michael@greenwaymarijuana.com",
};
function cfg(env: "preprod" | "prod" = "preprod"): IntegratorConfig {
  const vars = env === "preprod" ? VARS : Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k.replace("PREPROD", "PROD"), v]));
  const c = readIntegratorConfig(env, vars);
  if (c.kind !== "ready") throw new Error("fixture config not ready");
  return c.config;
}
const NOW = new Date("2026-11-02T20:00:05Z"); // 12:00:05 PST
const file = (type: string, sec = "05") => ({ name: `${type}_GWI413541_202611021200${sec}.csv`, content: "SubmittedBy,Greenway\r\n" });

describe("R6-4 spec pins (verbatim in Part 02 §3)", () => {
  it("token endpoints and audiences per environment", () => {
    expect(API("L0055")).toContain("https://test-login.wa.gov/oauth/token");
    expect(API("L0056")).toContain("lcb.ccrs.api.pre");
    expect(API("L0060")).toContain("https://www.login.wa.gov/oauth/token");
    expect(API("L0061")).toContain("lcb.ccrs.api.prod");
    expect(CCRS_API_ENDPOINTS.preprod.tokenUrl).toBe("https://test-login.wa.gov/oauth/token");
    expect(CCRS_API_ENDPOINTS.preprod.audience).toBe("lcb.ccrs.api.pre");
    expect(CCRS_API_ENDPOINTS.prod.tokenUrl).toBe("https://www.login.wa.gov/oauth/token");
    expect(CCRS_API_ENDPOINTS.prod.audience).toBe("lcb.ccrs.api.prod");
  });
  it("upload endpoints", () => {
    expect(API("L0074")).toContain("https://precannabisreporting.lcb.wa.gov/api/v1/upload");
    expect(API("L0075")).toContain("https://cannabisreporting.lcb.wa.gov/api/v1/upload");
    expect(CCRS_API_ENDPOINTS.preprod.uploadUrl).toBe("https://precannabisreporting.lcb.wa.gov/api/v1/upload");
    expect(CCRS_API_ENDPOINTS.prod.uploadUrl).toBe("https://cannabisreporting.lcb.wa.gov/api/v1/upload");
  });
  it("headers, token lifetime, 401 and oversize wording", () => {
    expect(API("L0082")).toContain("Bearer <access token>");
    expect(API("L0084")).toContain("X-Uploader-Email");
    expect(API("L0126")).toContain('"grant_type": "client_credentials"');
    expect(API("L0137")).toContain("Tokens expire 24 hours after they are issued");
    expect(API("L0138")).toContain("Cache and reuse a token until close to its expiry");
    expect(API("L0226")).toContain("empty body and a WWW-Authenticate header");
    expect(API("L0228")).toContain("HTML error page rather than JSON");
    expect(API("L0230")).toContain("Acceptance means the file was received for processing");
    expect(API("L0170")).toContain("a submission is validated as a set");
  });
  it("integrator file name convention", () => {
    expect(G("L0047")).toContain("Integrators: UploadType_IntegratorID_YYYYMMDDHHMMSS");
  });
});

describe("config: off by default, secrets from env only", () => {
  it("off unless <ENV>_ENABLED is exactly true; each env has its own switch", () => {
    expect(readIntegratorConfig("preprod", {}).kind).toBe("off");
    expect(readIntegratorConfig("preprod", { ...VARS, CCRS_API_PREPROD_ENABLED: "1" }).kind).toBe("off");
    expect(readIntegratorConfig("preprod", { ...VARS, CCRS_API_PREPROD_ENABLED: "yes" }).kind).toBe("off");
    expect(readIntegratorConfig("prod", VARS).kind).toBe("off");
    expect(readIntegratorConfig("preprod", VARS).kind).toBe("ready");
  });
  it("on but incomplete names every missing variable and never echoes a value", () => {
    const c = readIntegratorConfig("preprod", { CCRS_API_PREPROD_ENABLED: "true", CCRS_API_PREPROD_CLIENT_SECRET: "SUPER-SECRET-VALUE" });
    expect(c.kind).toBe("incomplete");
    if (c.kind !== "incomplete") return;
    expect(c.problems.join("|")).toContain("CCRS_API_PREPROD_CLIENT_ID");
    expect(c.problems.join("|")).toContain("CCRS_API_PREPROD_INTEGRATOR_ID");
    expect(c.problems.join("|")).toContain("CCRS_API_PREPROD_UPLOADER_EMAIL");
    expect(JSON.stringify(c)).not.toContain("SUPER-SECRET-VALUE");
  });
  it("refuses an integrator id that would break the file name, and a bad email", () => {
    for (const bad of ["GW_1", "GW 1", "GW/1", "GW.1"]) {
      const c = readIntegratorConfig("preprod", { ...VARS, CCRS_API_PREPROD_INTEGRATOR_ID: bad });
      expect(c.kind, bad).toBe("incomplete");
    }
    expect(readIntegratorConfig("preprod", { ...VARS, CCRS_API_PREPROD_UPLOADER_EMAIL: "michael" }).kind).toBe("incomplete");
    expect(INTEGRATOR_ID_RE.test("GWI-413541")).toBe(true);
  });
  it("variable names are server-only (no NEXT_PUBLIC_) and listed in .env.example", () => {
    const env = SRC(".env.example");
    for (const e of ["preprod", "prod"] as const) {
      for (const name of Object.values(apiEnvVarNames(e))) {
        expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
        expect(env).toMatch(new RegExp(`^${name}=$`, "m"));
      }
    }
  });
  it("prod uses the prod audience and endpoints", () => {
    const p = cfg("prod");
    expect(p.audience).toBe("lcb.ccrs.api.prod");
    expect(p.uploadUrl).toContain("//cannabisreporting.lcb.wa.gov/");
  });
});

describe("step 1: token", () => {
  it("is a JSON client-credentials request with the env's audience", () => {
    const r = tokenRequest(cfg());
    expect(r.url).toBe("https://test-login.wa.gov/oauth/token");
    expect(r.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(r.body)).toEqual({ client_id: "client-abc", client_secret: "SUPER-SECRET-VALUE", audience: "lcb.ccrs.api.pre", grant_type: "client_credentials" });
  });
  it("decodes the documented answer and refuses anything else without echoing it", () => {
    const ok = decodeTokenResponse(200, '{"access_token":"eyJ.x.y","token_type":"Bearer","expires_in":86400}', "lcb.ccrs.api.pre", 1000);
    expect(ok.ok && ok.token.expiresAtMs).toBe(1000 + 86_400_000);
    for (const [status, body] of [
      [400, '{"error":"invalid_client"}'],
      [200, "not json"],
      [200, '{"token_type":"Bearer","expires_in":86400}'],
      [200, '{"access_token":"eyJ.SECRET","token_type":"mac","expires_in":86400}'],
      [200, '{"access_token":"eyJ.SECRET","token_type":"Bearer","expires_in":0}'],
    ] as const) {
      const r = decodeTokenResponse(status, body, "lcb.ccrs.api.pre", 0);
      expect(r.ok, body).toBe(false);
      expect(JSON.stringify(r)).not.toContain("SECRET");
    }
  });
  it("is cached until close to expiry, and only for the same audience", () => {
    const t = decodeTokenResponse(200, '{"access_token":"a","token_type":"Bearer","expires_in":86400}', "lcb.ccrs.api.pre", 0);
    if (!t.ok) throw new Error("token");
    expect(refreshMarginMs(86_400_000)).toBe(15 * 60_000);
    expect(tokenIsUsable(t.token, "lcb.ccrs.api.pre", 0)).toBe(true);
    expect(tokenIsUsable(t.token, "lcb.ccrs.api.pre", 86_400_000 - 15 * 60_000 - 1)).toBe(true);
    expect(tokenIsUsable(t.token, "lcb.ccrs.api.pre", 86_400_000 - 15 * 60_000)).toBe(false);
    expect(tokenIsUsable(t.token, "lcb.ccrs.api.prod", 0)).toBe(false);
    expect(tokenIsUsable(null, "lcb.ccrs.api.pre", 0)).toBe(false);
    const short = decodeTokenResponse(200, '{"access_token":"a","token_type":"Bearer","expires_in":600}', "x", 0);
    if (!short.ok) throw new Error("short");
    expect(refreshMarginMs(600_000)).toBe(300_000);
    expect(tokenIsUsable(short.token, "x", 299_999)).toBe(true);
    expect(tokenIsUsable(short.token, "x", 300_000)).toBe(false);
  });
});

describe("step 2: upload request", () => {
  it("integrator file names keep the licensee name's Pacific stamp", () => {
    expect(integratorFileName("Inventory", "GWI413541", NOW)).toBe("Inventory_GWI413541_20261102120005.csv");
    expect(ccrsFileName("Inventory", "413541", NOW)).toBe("Inventory_413541_20261102120005.csv");
    expect(() => integratorFileName("Inventory", "GW_1", NOW)).toThrow(/R6-4/);
  });
  it("carries the bearer token, the uploader email and one `files` part per file", () => {
    const r = buildUploadRequest(cfg(), "tok-9999", [file("Area"), file("Strain", "06"), file("Product", "07")]);
    expect(r.url).toBe("https://precannabisreporting.lcb.wa.gov/api/v1/upload");
    expect(r.headers).toEqual({ Authorization: "Bearer tok-9999", "X-Uploader-Email": "michael@greenwaymarijuana.com" });
    expect(r.parts.map((p) => p.field)).toEqual(["files", "files", "files"]);
    expect(r.parts.map((p) => p.filename)).toEqual(["Area_GWI413541_20261102120005.csv", "Strain_GWI413541_20261102120006.csv", "Product_GWI413541_20261102120007.csv"]);
    expect(r.group).toBe(1);
  });
  it("refuses what CCRS would reject or what would break the upload order", () => {
    const c = cfg();
    expect(() => buildUploadRequest(c, "", [file("Area")])).toThrow(/token/);
    expect(() => buildUploadRequest(c, "t", [])).toThrow(/no files/);
    expect(() => buildUploadRequest(c, "t", [file("Area"), file("Area")])).toThrow(/twice/);
    expect(() => buildUploadRequest(c, "t", [{ name: "Area_413541_20261102120005.csv", content: "x\r\n" }])).toThrow(/integrator/);
    expect(() => buildUploadRequest(c, "t", [{ name: "Area_OTHER_20261102120005.csv", content: "x\r\n" }])).toThrow(/ours is/);
    expect(() => buildUploadRequest(c, "t", [{ name: "Manifest_GWI413541_20261102120005.csv", content: "x\r\n" }])).toThrow(/unknown upload type/);
    expect(() => buildUploadRequest(c, "t", [{ name: "Area_GWI413541_20261102120005.csv", content: "x\n" }])).toThrow(/CRLF/);
    expect(() => buildUploadRequest(c, "t", [file("Area"), file("Inventory", "06")])).toThrow(/one upload group/);
    expect(buildUploadRequest(c, "t", [file("InventoryAdjustment"), file("InventoryTransfer", "06"), file("Sale", "07")]).group).toBe(3);
  });
  it("redaction never shows the token or the file bodies", () => {
    const r = buildUploadRequest(cfg(), "eyJhbGciOi.PAYLOAD.SIG1234", [file("Area")]);
    const red = JSON.stringify(redactRequest(r));
    expect(red).not.toContain("PAYLOAD");
    expect(red).not.toContain("SubmittedBy");
    expect(red).toContain("1234");
    expect(redactRequest(r).files[0].bytes).toBe(22);
  });
});

describe("responses (every documented shape)", () => {
  const R = (status: number, bodyText: string, contentType: string | null = "application/json", wwwAuthenticate: string | null = null) =>
    classifyUploadResponse({ status, contentType, wwwAuthenticate, bodyText });
  it("200 success is `received` (not succeeded), with warnings", () => {
    expect(R(200, '{"success":true,"message":"Your submission was received at 11/02/2026 12:00 PM Pacific Time","warnings":["w1"]}')).toEqual({
      kind: "received",
      message: "Your submission was received at 11/02/2026 12:00 PM Pacific Time",
      warnings: ["w1"],
    });
  });
  it("400 single error and 400 errors[] are both read", () => {
    expect(R(400, '{"success":false,"error":"Missing required header: X-Uploader-Email"}')).toEqual({ kind: "rejected", error: "Missing required header: X-Uploader-Email", errors: [] });
    expect(R(400, '{"success":false,"errors":["Area: duplicate file name","Strain: bad name"]}')).toEqual({ kind: "rejected", error: null, errors: ["Area: duplicate file name", "Strain: bad name"] });
  });
  it("any 401 is an authentication failure, with or without a body", () => {
    expect(R(401, "", null, 'Bearer error="invalid_token"').kind).toBe("auth_failed");
    expect(R(401, '{"success":false,"error":"uploader not authorized"}').kind).toBe("auth_failed");
    expect(R(401, "").kind).toBe("auth_failed");
  });
  it("500 is a server error; an HTML page or 413 is `too_large`; anything else is `unknown`", () => {
    expect(R(500, '{"success":false,"error":"boom"}')).toEqual({ kind: "server_error", detail: "boom" });
    expect(R(500, "<html>oops</html>", "text/html").kind).toBe("server_error");
    expect(R(413, "<html><body>Request Entity Too Large</body></html>", "text/html").kind).toBe("too_large");
    expect(R(400, "<html>too big</html>", "text/html").kind).toBe("too_large");
    expect(R(200, "<html>login</html>", "text/html").kind).toBe("unknown");
    expect(R(200, '{"success":false}').kind).toBe("unknown");
    expect(R(502, "").kind).toBe("unknown");
  });
});

describe("what to do next", () => {
  it("retries a 500 with back-off, at most MAX_ATTEMPTS tries", () => {
    expect(nextStep({ kind: "server_error", detail: "" }, 1, false)).toEqual({ action: "retry", afterMs: 30_000, freshToken: false });
    expect(nextStep({ kind: "server_error", detail: "" }, 2, false)).toEqual({ action: "retry", afterMs: 60_000, freshToken: false });
    expect(nextStep({ kind: "server_error", detail: "" }, MAX_ATTEMPTS, false).action).toBe("stop");
    expect(MAX_ATTEMPTS).toBe(3);
  });
  it("retries a 401 once with a NEW token only when the token came from the cache", () => {
    expect(nextStep({ kind: "auth_failed", detail: "" }, 1, true)).toEqual({ action: "retry", afterMs: 0, freshToken: true });
    expect(nextStep({ kind: "auth_failed", detail: "" }, 1, false).action).toBe("stop");
    expect(nextStep({ kind: "auth_failed", detail: "" }, 2, true).action).toBe("stop");
  });
  it("never retries a rejection, an oversize page or an unreadable answer", () => {
    expect(nextStep({ kind: "rejected", error: "x", errors: [] }, 1, true).action).toBe("stop");
    expect(nextStep({ kind: "too_large", detail: "" }, 1, true).action).toBe("stop");
    expect(nextStep({ kind: "unknown", detail: "" }, 1, true).action).toBe("stop");
    expect(nextStep({ kind: "received", message: "", warnings: [] }, 1, false).action).toBe("done");
  });
});

describe("switched off: nothing in the app calls the client yet", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  }
  it("only the I/O module imports the core, and no file imports the I/O module", () => {
    const users = walk(path.join(ROOT, "src")).filter((p) => /ccrs-integrator-api["']/.test(readFileSync(p, "utf8")));
    expect(users.map((p) => path.relative(ROOT, p))).toEqual([]);
    const coreUsers = walk(path.join(ROOT, "src")).filter((p) => /ccrs-integrator-api-core["']/.test(readFileSync(p, "utf8")));
    expect(coreUsers.map((p) => path.relative(ROOT, p))).toEqual(["src/lib/compliance/ccrs-integrator-api.ts"]);
  });
  it("the I/O module is server-only, checks the switch before any request, and never logs", () => {
    const io = SRC("src/lib/compliance/ccrs-integrator-api.ts");
    expect(io).toMatch(/^import "server-only";$/m);
    expect(io).not.toMatch(/console\./);
    const upload = io.slice(io.indexOf("export async function uploadGroupViaApi"));
    expect(upload.indexOf('if (c.kind !== "ready")')).toBeGreaterThan(-1);
    expect(upload.indexOf('if (c.kind !== "ready")')).toBeLessThan(upload.indexOf("getIntegratorToken("));
    expect(io).toContain("if (outcome.kind === \"auth_failed\") delete tokenCache[cfg.env];");
  });
});

describe("embedded self-tests", () => {
  it("pass", () => {
    const r = __runIntegratorApiTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });
});
