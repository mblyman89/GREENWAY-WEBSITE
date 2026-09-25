/**
 * tests/compliance/leafly-l43-hmac.test.ts — SLICE L-43.
 *
 * Ben (Leafly integrations), item 1, recorded in
 * docs/leafly-ben-email-integration-round.md:
 *
 *   > "`X-Leafly-Signature` is lowercase hex, HMAC-SHA-256 computed over the
 *   >  raw request body only. No timestamp component, no prefix."
 *   > "When a webhook has an empty body, the header is not sent at all. A
 *   >  missing signature header on an empty body is EXPECTED, not a failure."
 *
 * and item 4: "Any non-2xx counts as a failure".
 *
 * What this file proves, END TO END, through the real route handlers, the real
 * `handleLeaflyWebhook` and the real node:crypto HMAC (only the database and
 * the bell/printer/ack side effects are faked):
 *
 *   1. A correct lowercase-hex signature is accepted (200) and the delivery is
 *      recorded as verified and processed.
 *   2. THE SAME DIGEST rendered as base64 is refused (401), recorded as
 *      `malformed_header`, and creates nothing.
 *   3. An empty body with NO header is answered 2xx on all six routes, writes
 *      NO event row (so it is never counted as a refused signature) and
 *      touches no order.
 *   4. A NON-empty body with no header is still refused with 401.
 *   5. Whitespace is a body: the carve-out is exactly the empty string.
 *   6. Upper-case hex (the same bytes) is still accepted.
 *
 * Plus source/spec pins: the vendored spec still does not state the encoding
 * (so the authority for "hex" is Ben, cited in the core), and nothing in the
 * Leafly code implies IP allowlisting (Ben, item 3: egress IPs rotate).
 */
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fakes. Only the edges: database, credentials, and the side-effect modules.
// ---------------------------------------------------------------------------

const KEY = "l43-test-hmac-key";

type Insert = { table: string; row: Record<string, unknown> };
const db = {
  inserts: [] as Insert[],
  upserts: [] as Insert[],
  updates: [] as Insert[],
};
const sideEffects: string[] = [];
let hmacKeyOnFile: string | undefined = KEY;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return true;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const chain = (bucket: Insert[], row: Record<string, unknown>) => {
        bucket.push({ table, row });
        const b: Record<string, unknown> = {
          eq: () => b,
          abortSignal: async () => ({ error: null }),
        };
        return b;
      };
      return {
        insert: (row: Record<string, unknown>) => chain(db.inserts, row),
        upsert: (row: Record<string, unknown>) => chain(db.upserts, row),
        update: (row: Record<string, unknown>) => chain(db.updates, row),
      };
    },
  }),
}));

vi.mock("@/lib/integrations/integration-credentials-store", () => ({
  getLeaflyOverrides: async () => ({
    hmacKey: hmacKeyOnFile,
    orderIntegrationKey: "menu-key",
  }),
}));

vi.mock("@/lib/leafly/order-fetch-server", () => ({
  collectLeaflyOrder: async () => {
    sideEffects.push("collect");
    return { ok: true, summary: "collected" };
  },
}));
vi.mock("@/lib/leafly/bridge-server", () => ({
  onLeaflyOrderArrived: async () => {
    sideEffects.push("bell");
    return { ok: true, announced: true, printed: true, summary: "rang" };
  },
  onLeaflyOrderCanceled: async () => {
    sideEffects.push("cancel");
    return { ok: true, summary: "cancelled", plan: { dispositionRequired: false } };
  },
}));
vi.mock("@/lib/leafly/auto-ack-server", () => ({
  autoAcknowledgeOnArrival: async () => {
    sideEffects.push("auto-ack");
    return { ok: true, summary: "acked" };
  },
}));
vi.mock("@/lib/leafly/staff-alert-server", () => ({
  maybeSendLeaflyStaffAlert: async () => {
    sideEffects.push("staff-alert");
    return null;
  },
}));
vi.mock("@/lib/leafly/preview-lookup", () => ({
  buildLeaflyVariantLookup: async () => {
    sideEffects.push("menu-lookup");
    return { lookup: () => null, loaded: false, variantCount: 0 };
  },
}));

const { handleLeaflyWebhook } = await import("@/lib/leafly/webhook-server");
const hmac = await import("@/lib/leafly/hmac-core");
const ROUTES = {
  order_submit: (await import("@/app/api/webhooks/leafly/order-submit/route")).POST,
  order_status: (await import("@/app/api/webhooks/leafly/order-status/route")).POST,
  order_cancel: (await import("@/app/api/webhooks/leafly/order-cancel/route")).POST,
  order_activate: (await import("@/app/api/webhooks/leafly/order-activate/route")).POST,
  order_deactivate: (await import("@/app/api/webhooks/leafly/order-deactivate/route")).POST,
  order_preview: (await import("@/app/api/webhooks/leafly/order-preview/route")).POST,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hexSig = (body: string, key = KEY) =>
  createHmac("sha256", key).update(body, "utf8").digest("hex");
const b64Sig = (body: string, key = KEY) =>
  createHmac("sha256", key).update(body, "utf8").digest("base64");

function post(body: string, signature?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== undefined) headers.set("X-Leafly-Signature", signature);
  return new Request("https://example.test/api/webhooks/leafly/x", {
    method: "POST",
    headers,
    body,
  });
}

const SUBMIT = JSON.stringify({
  eventTime: "2026-09-20T12:00:00Z",
  eventType: "order_submit",
  orderId: "L43-ORDER-1",
  orderIntegrationKey: "menu-key",
  acknowledgeBy: "2026-09-20T12:15:00Z",
});

const eventRows = () => db.inserts.filter((i) => i.table === "leafly_webhook_events");
const orderRows = () => db.upserts.filter((i) => i.table === "leafly_orders");

beforeEach(() => {
  db.inserts.length = 0;
  db.upserts.length = 0;
  db.updates.length = 0;
  sideEffects.length = 0;
  hmacKeyOnFile = KEY;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// 1. Hex passes, base64 of the SAME digest fails
// ---------------------------------------------------------------------------

describe("L-43 · lowercase hex is the only accepted signature", () => {
  it("a correct lowercase-hex signature is accepted, recorded verified, and processed", async () => {
    const sig = hexSig(SUBMIT);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    const res = await ROUTES.order_submit(post(SUBMIT, sig));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(eventRows()).toHaveLength(1);
    expect(eventRows()[0]?.row.signature_verified).toBe(true);
    expect(eventRows()[0]?.row.rejection_reason).toBeNull();
    expect(orderRows()).toHaveLength(1);
    expect(sideEffects).toContain("bell");
  });

  it("upper-case hex of the same digest is accepted (same bytes, different rendering)", async () => {
    const res = await ROUTES.order_submit(post(SUBMIT, hexSig(SUBMIT).toUpperCase()));
    expect(res.status).toBe(200);
    expect(eventRows()[0]?.row.signature_verified).toBe(true);
  });

  it("THE SAME DIGEST in base64 is refused with 401 and creates nothing", async () => {
    const sig = b64Sig(SUBMIT);
    // Prove the fixture is the correct digest, just re-encoded.
    expect(Buffer.from(sig, "base64").toString("hex")).toBe(hexSig(SUBMIT));
    const res = await ROUTES.order_submit(post(SUBMIT, sig));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid signature" });
    expect(eventRows()).toHaveLength(1);
    expect(eventRows()[0]?.row.signature_verified).toBe(false);
    expect(eventRows()[0]?.row.rejection_reason).toBe("malformed_header");
    expect(eventRows()[0]?.row.response_status).toBe(401);
    expect(orderRows()).toHaveLength(0);
    expect(sideEffects).toEqual([]);
  });

  it("unpadded base64 and base64url renderings are refused too", async () => {
    const padded = b64Sig(SUBMIT);
    for (const sig of [padded.replace(/=+$/, ""), padded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")]) {
      const res = await ROUTES.order_submit(post(SUBMIT, sig));
      expect(res.status).toBe(401);
    }
    expect(orderRows()).toHaveLength(0);
  });

  it("a hex digest under the wrong key is a mismatch, not malformed", async () => {
    const res = await ROUTES.order_submit(post(SUBMIT, hexSig(SUBMIT, "some-other-key")));
    expect(res.status).toBe(401);
    expect(eventRows()[0]?.row.rejection_reason).toBe("mismatch");
  });

  it("the node digester is only ever asked for hex", async () => {
    const { nodeHmacDigest } = await import("@/lib/leafly/webhook-server");
    const spy = vi.fn(nodeHmacDigest);
    hmac.verifyLeaflySignature({ rawBody: SUBMIT, headerValue: hexSig(SUBMIT), hmacKey: KEY, digest: spy });
    hmac.verifyLeaflySignature({ rawBody: SUBMIT, headerValue: "f".repeat(64), hmacKey: KEY, digest: spy });
    expect(spy.mock.calls.map((c) => c[2])).toEqual(["hex", "hex"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Empty body, no header: expected, answered 2xx, never recorded
// ---------------------------------------------------------------------------

describe("L-43 · an empty body with no header is expected, not a refusal", () => {
  for (const [event, POST] of Object.entries(ROUTES)) {
    it(`${event}: 2xx, no event row, no order, no side effects`, async () => {
      const res = await POST(post(""));
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      expect(eventRows()).toHaveLength(0);
      expect(orderRows()).toHaveLength(0);
      expect(db.updates).toHaveLength(0);
      expect(sideEffects).toEqual([]);
      if (event === "order_preview") {
        expect(await res.json()).toEqual({ cartItems: [], taxes: [] });
      } else {
        expect(await res.text()).toBe("");
      }
    });
  }

  it("still 2xx when no HMAC key is configured (nothing to verify, nothing to refuse)", async () => {
    hmacKeyOnFile = undefined;
    const res = await ROUTES.order_submit(post(""));
    expect(res.status).toBe(200);
    expect(eventRows()).toHaveLength(0);
  });

  it("handleLeaflyWebhook reports acknowledge_only for it", async () => {
    const handled = await handleLeaflyWebhook({
      rawBody: "",
      headers: new Headers(),
      expectedEvent: "order_status",
    });
    expect(handled.status).toBe(200);
    expect(handled.admission).toBe("acknowledge_only");
    expect(handled.logLine).toMatch(/empty unsigned delivery/);
  });
});

// ---------------------------------------------------------------------------
// 3. Anything with a body and no header stays refused
// ---------------------------------------------------------------------------

describe("L-43 · a body without a signature is still refused", () => {
  it("a real-looking order with no header gets 401 and is recorded as missing_header", async () => {
    const res = await ROUTES.order_submit(post(SUBMIT));
    expect(res.status).toBe(401);
    expect(eventRows()).toHaveLength(1);
    expect(eventRows()[0]?.row.rejection_reason).toBe("missing_header");
    expect(orderRows()).toHaveLength(0);
    expect(sideEffects).toEqual([]);
  });

  for (const ws of [" ", "\n", "\r\n", "{}"]) {
    it(`body ${JSON.stringify(ws)} with no header is refused (the carve-out is exactly "")`, async () => {
      const res = await ROUTES.order_status(post(ws));
      expect(res.status).toBe(401);
      expect(eventRows()[0]?.row.rejection_reason).toBe("missing_header");
    });
  }

  it("the preview route refuses an unsigned cart and never prices it", async () => {
    const res = await ROUTES.order_preview(post(JSON.stringify({ cartItems: [] })));
    expect(res.status).toBe(401);
    expect(sideEffects).not.toContain("menu-lookup");
  });

  it("an empty body with a BLANK header is refused (only an ABSENT header is expected)", async () => {
    const res = await ROUTES.order_submit(post("", "   "));
    expect(res.status).toBe(401);
    expect(eventRows()[0]?.row.rejection_reason).toBe("empty_header");
  });

  it("a correctly signed empty body is verified like any other (not refused unread)", async () => {
    const res = await ROUTES.order_activate(post("", hexSig("")));
    expect(res.status).toBe(200);
    expect(eventRows()[0]?.row.signature_verified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. The pure admission plan, exhaustively
// ---------------------------------------------------------------------------

describe("L-43 · planLeaflyWebhookAdmission", () => {
  it("maps every outcome to the right action and fails closed on anything else", () => {
    expect(hmac.planLeaflyWebhookAdmission({ outcome: "verified", ok: true })).toEqual({
      action: "process",
      status: 200,
      recordEvent: true,
      mayActOnPayload: true,
    });
    expect(hmac.planLeaflyWebhookAdmission({ outcome: "empty_unsigned", ok: false })).toEqual({
      action: "acknowledge_only",
      status: 200,
      recordEvent: false,
      mayActOnPayload: false,
    });
    expect(hmac.planLeaflyWebhookAdmission({ outcome: "refused", ok: false }).status).toBe(401);
    expect(hmac.planLeaflyWebhookAdmission(null).status).toBe(401);
    expect(hmac.planLeaflyWebhookAdmission({ outcome: "verified", ok: false }).status).toBe(401);
    expect(hmac.planLeaflyWebhookAdmission({ outcome: "empty_unsigned", ok: true }).status).toBe(401);
  });

  it("the check order is load-bearing: empty+no-header wins over missing key, body+no-header loses", () => {
    const d = () => "0".repeat(64);
    expect(hmac.verifyLeaflySignature({ rawBody: "", headerValue: null, hmacKey: null, digest: d }).outcome).toBe(
      "empty_unsigned",
    );
    expect(hmac.verifyLeaflySignature({ rawBody: "x", headerValue: null, hmacKey: KEY, digest: d }).reason).toBe(
      "missing_header",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Source, spec and vocabulary pins
// ---------------------------------------------------------------------------

describe("L-43 · the confirmation is recorded, sourced, and cannot quietly regress", () => {
  it("hex is the only encoding, and the question is marked closed with its source", () => {
    expect([...hmac.LEAFLY_HMAC_ENCODINGS]).toEqual(["hex"]);
    expect(hmac.LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED).toBe(false);
    expect(hmac.LEAFLY_HMAC_ENCODING_SOURCE).toMatch(/Ben/);
    expect(hmac.LEAFLY_HMAC_ENCODING_SOURCE).toMatch(/lowercase hex/);
    expect(hmac.looksLikeSha256Digest("a".repeat(64))).toBe(true);
    expect(hmac.looksLikeSha256Digest(`${"A".repeat(43)}=`)).toBe(false);
  });

  it("the vendored spec STILL does not state the encoding, so the authority is Ben's answer", () => {
    const spec = JSON.parse(readFileSync(join(process.cwd(), "docs/leafly-specs/order-api-v1.openapi.json"), "utf8"));
    const desc: string = spec.components.securitySchemes.WebhookHMACAuthentication.description;
    expect(desc).toMatch(/HMAC-SHA-256/);
    expect(desc.toLowerCase()).not.toMatch(/\bhex\b|base64/);
    const ben = readFileSync(join(process.cwd(), "docs/leafly-ben-email-integration-round.md"), "utf8");
    expect(ben).toMatch(/\*\*lowercase hex\*\*/);
    expect(ben).toMatch(/header is not sent at all/);
  });

  it("the server file routes every verdict through the pure admission plan", () => {
    // Comments stripped: the file's own history note quotes the old line.
    const src = readFileSync(join(process.cwd(), "src/lib/leafly/webhook-server.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/planLeaflyWebhookAdmission\(verdict\)/);
    expect(src).toMatch(/admission\.action === "acknowledge_only"/);
    // The pre-L-43 shape that refused Leafly's expected delivery must not return.
    expect(src).not.toMatch(/if \(!verdict\.ok\)/);
  });

  it("the vocabulary still carries empty_body so rows from older builds classify", () => {
    expect(hmac.LEAFLY_HMAC_FAILURE_REASONS).toContain("empty_body");
    expect(hmac.LEAFLY_HMAC_FAILURE_REASONS).toHaveLength(7);
  });

  it("nothing in the Leafly code relies on an IP allowlist (Ben, item 3: IPs rotate)", () => {
    const dirs = ["src/lib/leafly", "src/app/api/webhooks/leafly"];
    const files: string[] = [];
    const walk = (d: string) => {
      if (!existsSync(d)) return;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    dirs.forEach((d) => walk(join(process.cwd(), d)));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/x-forwarded-for|x-real-ip|request\.ip\b|remoteAddress/i);
    }
  });
});
