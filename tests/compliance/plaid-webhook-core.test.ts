/**
 * tests/compliance/plaid-webhook-core.test.ts
 *
 * Vitest mirror of the pure Plaid webhook core (Slice P4): JWT parsing/validation,
 * freshness (replay) window, constant-time hash compare, and the webhook-code →
 * action map. Server crypto + key fetch live in plaid-webhook-verify.ts (not
 * tested here — this file proves the decision brain).
 */
import { describe, expect, it } from "vitest";
import {
  base64UrlToString,
  splitJwt,
  decodeJwtHeader,
  decodeJwtPayload,
  isJwtFresh,
  constantTimeHexEquals,
  mapWebhookToAction,
  preCheckPlaidJwt,
  PLAID_WEBHOOK_MAX_AGE_SECONDS,
  __runPlaidWebhookCoreTests,
} from "@/lib/plaid/plaid-webhook-core";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("plaid-webhook-core self-tests (harness parity)", () => {
  it("passes the in-module self-test battery", () => {
    expect(() => __runPlaidWebhookCoreTests()).not.toThrow();
  });
});

describe("JWT segment decoding", () => {
  it("round-trips base64url and rejects blanks", () => {
    expect(base64UrlToString(b64url("hello world"))).toBe("hello world");
    expect(base64UrlToString("")).toBe("");
    expect(base64UrlToString(null)).toBe("");
  });
  it("splits exactly three non-empty segments", () => {
    expect(splitJwt("a.b.c")).toEqual({ header: "a", payload: "b", signature: "c" });
    expect(splitJwt("a.b")).toBeNull();
    expect(splitJwt("a..c")).toBeNull();
    expect(splitJwt(null)).toBeNull();
  });
  it("decodes an ES256 header and rejects anything else", () => {
    const h = decodeJwtHeader(b64url(JSON.stringify({ alg: "ES256", kid: "k-1", typ: "JWT" })));
    expect(h?.alg).toBe("ES256");
    expect(h?.kid).toBe("k-1");
    expect(decodeJwtHeader(b64url(JSON.stringify({ alg: "RS256", kid: "k" })))).toBeNull();
    expect(decodeJwtHeader(b64url(JSON.stringify({ alg: "ES256" })))).toBeNull();
    expect(decodeJwtHeader(b64url("not-json"))).toBeNull();
  });
  it("decodes a payload with iat + request_body_sha256", () => {
    const p = decodeJwtPayload(b64url(JSON.stringify({ iat: 1560211755, request_body_sha256: "bbe8e9" })));
    expect(p?.iat).toBe(1560211755);
    expect(p?.requestBodySha256).toBe("bbe8e9");
    expect(decodeJwtPayload(b64url(JSON.stringify({ iat: 1 })))).toBeNull();
    expect(decodeJwtPayload(b64url(JSON.stringify({ request_body_sha256: "x" })))).toBeNull();
  });
});

describe("freshness / replay protection", () => {
  const now = 1_000_000;
  it("accepts recent tokens and rejects stale ones", () => {
    expect(isJwtFresh(now - 10, now)).toBe(true);
    expect(isJwtFresh(now - (PLAID_WEBHOOK_MAX_AGE_SECONDS - 1), now)).toBe(true);
    expect(isJwtFresh(now - (PLAID_WEBHOOK_MAX_AGE_SECONDS + 1), now)).toBe(false);
  });
  it("rejects tokens implausibly far in the future but tolerates small skew", () => {
    expect(isJwtFresh(now + 10, now)).toBe(true);
    expect(isJwtFresh(now + 120, now)).toBe(false);
    expect(isJwtFresh(Number.NaN, now)).toBe(false);
  });
});

describe("constant-time hex compare", () => {
  it("is case-insensitive and rejects any difference or length mismatch", () => {
    expect(constantTimeHexEquals("ABCDEF", "abcdef")).toBe(true);
    expect(constantTimeHexEquals("abcdef", "abcde0")).toBe(false);
    expect(constantTimeHexEquals("abcd", "abce")).toBe(false);
    expect(constantTimeHexEquals("abcd", "abcde")).toBe(false);
    expect(constantTimeHexEquals("", "abcd")).toBe(false);
  });
});

describe("webhook code → action (never guesses on unknown)", () => {
  it("resyncs the target item on transaction updates", () => {
    for (const code of ["SYNC_UPDATES_AVAILABLE", "INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE", "TRANSACTIONS_REMOVED"]) {
      const a = mapWebhookToAction("TRANSACTIONS", code);
      expect(a.resync).toBe(true);
      expect(a.targetItem).toBe(true);
      expect(a.recordError).toBe(false);
    }
  });
  it("acknowledges an unknown TRANSACTIONS code without resyncing", () => {
    const a = mapWebhookToAction("TRANSACTIONS", "SOMETHING_ELSE");
    expect(a.resync).toBe(false);
    expect(a.targetItem).toBe(true);
  });
  it("records item errors and resyncs only on LOGIN_REPAIRED", () => {
    const err = mapWebhookToAction("ITEM", "ERROR");
    expect(err.recordError).toBe(true);
    expect(err.resync).toBe(false);
    const repaired = mapWebhookToAction("ITEM", "LOGIN_REPAIRED");
    expect(repaired.resync).toBe(true);
    expect(repaired.recordError).toBe(false);
  });
  it("acknowledges an unwired webhook type with no action", () => {
    const a = mapWebhookToAction("HOLDINGS", "DEFAULT_UPDATE");
    expect(a.resync).toBe(false);
    expect(a.targetItem).toBe(false);
    expect(a.recordError).toBe(false);
  });
  it("is case-insensitive on type + code", () => {
    expect(mapWebhookToAction("transactions", "default_update").resync).toBe(true);
  });
});

describe("preCheckPlaidJwt (pure gate before the crypto step)", () => {
  const now = 1_000_000;
  const hdr = b64url(JSON.stringify({ alg: "ES256", kid: "k-1", typ: "JWT" }));
  it("passes a fresh, well-formed JWT and surfaces kid + hash", () => {
    const jwt = `${hdr}.${b64url(JSON.stringify({ iat: now - 5, request_body_sha256: "deadbeef" }))}.sig`;
    const pre = preCheckPlaidJwt(jwt, now);
    expect(pre.ok).toBe(true);
    if (pre.ok) {
      expect(pre.kid).toBe("k-1");
      expect(pre.requestBodySha256).toBe("deadbeef");
    }
  });
  it("rejects malformed, stale, and non-ES256 tokens", () => {
    expect(preCheckPlaidJwt("a.b", now).ok).toBe(false);
    const stale = `${hdr}.${b64url(JSON.stringify({ iat: now - 9999, request_body_sha256: "x" }))}.s`;
    expect(preCheckPlaidJwt(stale, now).ok).toBe(false);
    const rs = b64url(JSON.stringify({ alg: "RS256", kid: "k" }));
    const badAlg = `${rs}.${b64url(JSON.stringify({ iat: now, request_body_sha256: "x" }))}.s`;
    expect(preCheckPlaidJwt(badAlg, now).ok).toBe(false);
  });
});
