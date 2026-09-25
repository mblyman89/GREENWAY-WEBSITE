/**
 * tests/compliance/leafly-l45-retailer-key.test.ts - SLICE L-45.
 *
 * Ben (Leafly integrations), item 2, recorded in
 * docs/leafly-ben-email-integration-round.md:
 *
 *   > "`orderIntegrationKey` is the SAME VALUE as the Dispensary Menu Key we
 *   >  already hold. It is one per-retailer key, and that same key appears in
 *   >  the `orderIntegrationKey` field on every webhook."
 *
 * What this file proves, through the REAL route handlers, the REAL
 * `handleLeaflyWebhook`, the REAL evidence reader and the REAL panel (only the
 * database, the credential store and the bell/printer/ack side effects are
 * faked):
 *
 *   1. A blank Order box FALLS BACK to the Menu key (the bug: every collect /
 *      acknowledge refused with "fix your credentials" while the same value
 *      sat in the Menu box). A filled Order box still wins. Both blank, or a
 *      store that throws, gives null - never a guess.
 *   2. A verified delivery whose orderIntegrationKey DIFFERS from ours is
 *      STILL PROCESSED (200, order row, bell, auto-ack) and the log line
 *      carries a loud note naming the box to fix - and never the key itself.
 *   3. A matching delivery adds no noise to the log.
 *   4. The whole check costs ZERO extra credential reads (one read serves the
 *      HMAC key and both store keys) - this path is timed by Leafly at 9s.
 *   5. The setup panel's evidence compares only VERIFIED rows, names the box,
 *      and never renders a key value; unverified bodies can never raise it.
 *   6. The credentials page tells the owner the boxes agree / disagree, and
 *      the copy no longer claims both boxes are required.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fakes - only the edges.
// ---------------------------------------------------------------------------

const HMAC = "l45-test-hmac-key";
const MENU = "GW-MENU-KEY-7731";
const OTHER = "SOMEONE-ELSES-KEY-0001";

type Insert = { table: string; row: Record<string, unknown> };
const db = { inserts: [] as Insert[], upserts: [] as Insert[], updates: [] as Insert[] };
const sideEffects: string[] = [];
let overrides: Record<string, unknown> = {};
let overridesThrow = false;
let overridesReads = 0;
let evidenceRows: Array<Record<string, unknown>> = [];
let evidenceSelect = "";

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
        select: (cols: string) => {
          evidenceSelect = cols;
          const q = {
            order: () => q,
            limit: async () => ({ data: evidenceRows, error: null }),
          };
          return q;
        },
      };
    },
  }),
}));
vi.mock("@/lib/integrations/integration-credentials-store", () => ({
  getLeaflyOverrides: async () => {
    overridesReads += 1;
    if (overridesThrow) throw new Error("db down");
    return overrides;
  },
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
vi.mock("@/app/admin/integrations/credential-actions", () => ({
  saveLeaflyCredentialsAction: async () => ({ ok: true }),
  saveWeedmapsCredentialsAction: async () => ({ ok: true }),
  saveFluxCredentialsAction: async () => ({ ok: true }),
}));

const ws = await import("@/lib/leafly/webhook-server");
const core = await import("@/lib/leafly/retailer-key-core");
const { loadLeaflyDeliveryEvidence } = await import("@/lib/leafly/order-readiness-server");
const submitPOST = (await import("@/app/api/webhooks/leafly/order-submit/route")).POST;
const cancelPOST = (await import("@/app/api/webhooks/leafly/order-cancel/route")).POST;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sig = (body: string) => createHmac("sha256", HMAC).update(body, "utf8").digest("hex");
const post = (body: string, signature?: string) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== undefined) headers.set("X-Leafly-Signature", signature);
  return new Request("https://example.test/api/webhooks/leafly/x", { method: "POST", headers, body });
};
let n = 0;
const submitBody = (key: string | null) => {
  n += 1;
  const body: Record<string, unknown> = {
    eventTime: "2026-09-21T12:00:00Z",
    eventType: "order_submit",
    orderId: `L45-${n}`,
    acknowledgeBy: "2026-09-21T12:15:00Z",
  };
  if (key !== null) body.orderIntegrationKey = key;
  return JSON.stringify(body);
};
const eventRows = () => db.inserts.filter((i) => i.table === "leafly_webhook_events");
const orderRows = () => db.upserts.filter((i) => i.table === "leafly_orders");
let logs: string[] = [];

beforeEach(() => {
  db.inserts.length = 0;
  db.upserts.length = 0;
  db.updates.length = 0;
  sideEffects.length = 0;
  overrides = { hmacKey: HMAC, menuIntegrationKey: MENU };
  overridesThrow = false;
  overridesReads = 0;
  evidenceRows = [];
  evidenceSelect = "";
  logs = [];
  const capture = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ---------------------------------------------------------------------------
// 1. The fallback
// ---------------------------------------------------------------------------

describe("L-45 · a blank Order box falls back to the Menu key (Ben: same value)", () => {
  it("Order box blank, Menu key saved -> the Menu key is used", async () => {
    overrides = { hmacKey: HMAC, menuIntegrationKey: MENU };
    expect(await ws.loadLeaflyOrderIntegrationKey()).toBe(MENU);
    const full = await ws.loadLeaflyRetailerKey();
    expect(full.source).toBe("menu_key");
    expect(full.agreement).toBe("menu_only");
  });

  it("whitespace in the Order box counts as blank (a stray space must not block orders)", async () => {
    overrides = { hmacKey: HMAC, menuIntegrationKey: MENU, orderIntegrationKey: "   " };
    expect(await ws.loadLeaflyOrderIntegrationKey()).toBe(MENU);
  });

  it("an explicitly filled Order box still WINS - nobody's working setup changes", async () => {
    overrides = { hmacKey: HMAC, menuIntegrationKey: MENU, orderIntegrationKey: "EXPLICIT" };
    expect(await ws.loadLeaflyOrderIntegrationKey()).toBe("EXPLICIT");
    expect((await ws.loadLeaflyRetailerKey()).agreement).toBe("different");
  });

  it("both boxes blank -> null, never a placeholder", async () => {
    overrides = { hmacKey: HMAC };
    expect(await ws.loadLeaflyOrderIntegrationKey()).toBeNull();
    expect((await ws.loadLeaflyRetailerKey()).source).toBe("none");
  });

  it("a credential store that throws -> null, never a guess, never a throw", async () => {
    overridesThrow = true;
    await expect(ws.loadLeaflyOrderIntegrationKey()).resolves.toBeNull();
    const full = await ws.loadLeaflyRetailerKey();
    expect(full).toMatchObject({ key: null, source: "none", orderKey: null, menuKey: null });
  });

  it("the key is not case-folded (Leafly keys are opaque; folding could hit another store)", () => {
    expect(core.normalizeRetailerKey("  AbC  ")).toBe("AbC");
    expect(core.resolveLeaflyRetailerKey({ orderKey: "abc", menuKey: "ABC" }).agreement).toBe(
      "different",
    );
  });
});

// ---------------------------------------------------------------------------
// 2-4. The webhook body check, end to end through the real route
// ---------------------------------------------------------------------------

describe("L-45 · every verified delivery's orderIntegrationKey is compared - and never used to drop it", () => {
  it("MATCH (body key = Menu key, Order box blank): processed, and no key note in the log", async () => {
    const body = submitBody(MENU);
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(orderRows()).toHaveLength(1);
    expect(sideEffects).toEqual(["collect", "bell", "auto-ack", "staff-alert"]);
    const line = logs.find((l) => l.includes("[leafly order_submit] accepted")) ?? "";
    expect(line).not.toBe("");
    expect(line).not.toContain("retailer key");
  });

  it("MISMATCH: STILL 200, STILL recorded, STILL rung and acknowledged - and the log says so loudly", async () => {
    const body = submitBody(OTHER);
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(eventRows()).toHaveLength(1);
    expect(eventRows()[0]?.row.signature_verified).toBe(true);
    expect(orderRows()).toHaveLength(1);
    expect(sideEffects).toEqual(["collect", "bell", "auto-ack", "staff-alert"]);
    const line = logs.find((l) => l.includes("[leafly order_submit] accepted")) ?? "";
    expect(line).toContain("matches NEITHER saved key");
    expect(line).toContain("processed anyway");
  });

  it("the log NEVER contains either key value, on any path", async () => {
    overrides = { hmacKey: HMAC, menuIntegrationKey: MENU, orderIntegrationKey: "ORDER-BOX-VAL" };
    for (const k of [OTHER, MENU, "ORDER-BOX-VAL", null]) {
      const body = submitBody(k);
      await submitPOST(post(body, sig(body)));
    }
    const all = logs.join("\n");
    expect(all).not.toContain(OTHER);
    expect(all).not.toContain(MENU);
    expect(all).not.toContain("ORDER-BOX-VAL");
  });

  it("body key matches the MENU box while the ORDER box differs: names the Order box as the one to fix", async () => {
    overrides = { hmacKey: HMAC, menuIntegrationKey: MENU, orderIntegrationKey: "TYPO-IN-ORDER-BOX" };
    const body = submitBody(MENU);
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(sideEffects).toContain("bell");
    const line = logs.find((l) => l.includes("accepted")) ?? "";
    expect(line).toContain("fix the Order integration key box");
  });

  it("a verified body with NO orderIntegrationKey is processed and flagged", async () => {
    const body = submitBody(null);
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(sideEffects).toContain("bell");
    expect(logs.find((l) => l.includes("accepted")) ?? "").toContain("carried no orderIntegrationKey");
  });

  it("a cancel with a mismatched key still cancels (the check applies to every event)", async () => {
    const body = JSON.stringify({
      eventTime: "2026-09-21T12:05:00Z",
      eventType: "order_cancel",
      orderId: "L45-CANCEL",
      orderIntegrationKey: OTHER,
      status: "canceled",
      cancelationReasonCode: "customer",
    });
    const res = await cancelPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(sideEffects).toEqual(["cancel"]);
    expect(logs.find((l) => l.includes("accepted")) ?? "").toContain("matches NEITHER");
  });

  it("an UNSIGNED mismatch is refused by the signature, exactly as before (the key check never runs first)", async () => {
    const body = submitBody(OTHER);
    const res = await submitPOST(post(body, "0".repeat(64)));
    expect(res.status).toBe(401);
    expect(orderRows()).toHaveLength(0);
    expect(sideEffects).toEqual([]);
  });

  it("ZERO extra credential reads: ONE read serves the HMAC key and both store keys", async () => {
    const body = submitBody(OTHER);
    await submitPOST(post(body, sig(body)));
    // The side-effect modules are mocked, so every read counted here is the
    // handler's own. Before L-45 this was also exactly 1 (loadLeaflyHmacKey).
    expect(overridesReads).toBe(1);
  });

  it("a store that throws still fails CLOSED (401), with no key check and no processing", async () => {
    overridesThrow = true;
    const body = submitBody(MENU);
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(401);
    expect(orderRows()).toHaveLength(0);
    expect(sideEffects).toEqual([]);
  });

  it("a STORE key can never stand in for a missing HMAC key (the one-read refactor must not blur them)", async () => {
    // No HMAC key saved; the attacker knows (or guesses) the store key, which
    // Leafly puts in every body and so is NOT a secret. Signing with it must
    // be refused.
    for (const which of ["menu", "order"] as const) {
      overrides =
        which === "menu"
          ? { menuIntegrationKey: MENU }
          : { orderIntegrationKey: "ORDER-ONLY-KEY" };
      const signingKey = which === "menu" ? MENU : "ORDER-ONLY-KEY";
      const body = submitBody(signingKey);
      const forged = createHmac("sha256", signingKey).update(body, "utf8").digest("hex");
      const res = await submitPOST(post(body, forged));
      expect(res.status, which).toBe(401);
    }
    expect(orderRows()).toHaveLength(0);
    expect(sideEffects).toEqual([]);
  });

  it("a store that throws is refused even when signed with the real key (no cached/default key)", async () => {
    overridesThrow = true;
    const body = submitBody(MENU);
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(401);
    expect(eventRows()[0]?.row.rejection_reason).toBe("missing_key");
  });

  it("the action is the pinned constant 'process' for every outcome", () => {
    const cases = [
      { bodyKey: MENU, orderKey: null, menuKey: MENU },
      { bodyKey: OTHER, orderKey: null, menuKey: MENU },
      { bodyKey: null, orderKey: null, menuKey: MENU },
      { bodyKey: MENU, orderKey: null, menuKey: null },
      { bodyKey: MENU, orderKey: "X", menuKey: MENU },
    ];
    const outcomes = new Set<string>();
    for (const c of cases) {
      const r = core.checkWebhookRetailerKey(c);
      expect(r.action).toBe("process");
      outcomes.add(r.outcome);
    }
    expect([...outcomes].sort()).toEqual([...core.WEBHOOK_KEY_OUTCOMES].sort());
    expect(core.WEBHOOK_KEY_CHECK_ACTION).toBe("process");
  });
});

// ---------------------------------------------------------------------------
// 5. The setup panel evidence
// ---------------------------------------------------------------------------

describe("L-45 · the setup panel compares what Leafly SENDS with what we hold", () => {
  const verified = (key: string | null) => ({
    event_type: "order_submit",
    signature_verified: true,
    received_at: "2026-09-21T12:00:00Z",
    rejection_reason: null,
    order_integration_key: key,
  });
  const unverified = (key: string | null) => ({ ...verified(key), signature_verified: false, rejection_reason: "mismatch" });

  it("the reader now selects order_integration_key", async () => {
    evidenceRows = [verified(MENU)];
    await loadLeaflyDeliveryEvidence(200, { retailerKeys: { orderKey: null, menuKey: MENU } });
    expect(evidenceSelect).toContain("order_integration_key");
  });

  it("all verified deliveries carry our key -> all_match, no warning", async () => {
    evidenceRows = [verified(MENU), verified(MENU)];
    const ev = await loadLeaflyDeliveryEvidence(200, { retailerKeys: { orderKey: null, menuKey: MENU } });
    expect(ev.retailerKey?.verdict).toBe("all_match");
    expect(ev.retailerKey?.warn).toBe(false);
    expect(ev.retailerKey?.compared).toBe(2);
  });

  it("a stranger's UNVERIFIED body with a different key can NEVER raise the warning", async () => {
    evidenceRows = [unverified(OTHER), unverified(OTHER), verified(MENU)];
    const ev = await loadLeaflyDeliveryEvidence(200, { retailerKeys: { orderKey: null, menuKey: MENU } });
    expect(ev.retailerKey?.verdict).toBe("all_match");
    expect(ev.retailerKey?.compared).toBe(1);
  });

  it("a verified mismatch -> warn, verdict mismatch, and no key value anywhere in the evidence", async () => {
    evidenceRows = [verified(OTHER), verified(MENU)];
    const ev = await loadLeaflyDeliveryEvidence(200, { retailerKeys: { orderKey: null, menuKey: MENU } });
    expect(ev.retailerKey?.verdict).toBe("mismatch");
    expect(ev.retailerKey?.warn).toBe(true);
    const json = JSON.stringify(ev);
    expect(json).not.toContain(OTHER);
    expect(json).not.toContain(MENU);
  });

  it("Leafly sends the Menu key but the Order box holds something else -> fix_order_box", async () => {
    evidenceRows = [verified(MENU)];
    const ev = await loadLeaflyDeliveryEvidence(200, {
      retailerKeys: { orderKey: "TYPO", menuKey: MENU },
    });
    expect(ev.retailerKey?.verdict).toBe("fix_order_box");
    expect(ev.retailerKey?.headline).toContain("Order integration key");
  });

  it("keys not supplied -> null (not checked), never an invented verdict", async () => {
    evidenceRows = [verified(OTHER)];
    const ev = await loadLeaflyDeliveryEvidence(200, {});
    expect(ev.retailerKey).toBeNull();
  });

  it("the panel renders the warning (with a link) only when warn is true, and never a key", async () => {
    const { LeaflyOrderSetupPanel } = await import("@/components/admin/orders/LeaflyOrderSetupPanel");
    const { assessOrderReadiness } = await import("@/lib/leafly/order-readiness-core");
    const base = {
      menuConfigured: true,
      hmacKeyPresent: true,
      orderIntegrationKeyPresent: true,
      verifiedDeliveryEverReceived: true,
      anyOrderEverReceived: true,
      speakerReady: true,
      printerReady: true,
      pickupAvailabilityEnabled: true,
    };
    evidenceRows = [verified(OTHER)];
    const bad = await loadLeaflyDeliveryEvidence(200, { retailerKeys: { orderKey: null, menuKey: MENU } });
    evidenceRows = [verified(MENU)];
    const good = await loadLeaflyDeliveryEvidence(200, { retailerKeys: { orderKey: null, menuKey: MENU } });
    const render = (evidence: typeof bad) =>
      renderToStaticMarkup(
        createElement(LeaflyOrderSetupPanel, {
          setup: {
            readiness: assessOrderReadiness(base),
            destinations: [],
            destinationProblem: null,
            originSource: "configured",
            origin: "https://example.com",
            evidence,
            explanation: "x",
            pickupAvailabilityEnabled: true,
            publishedVariantCount: 3,
            emptyCart: { cause: "none", headline: "h", detail: "d", blocking: false },
            problems: [],
          },
        }),
      );
    const badHtml = render(bad);
    expect(badHtml).toContain('data-testid="leafly-retailer-key-warning"');
    expect(badHtml).toContain("matches neither saved key");
    expect(badHtml).toContain('href="/admin/integrations"');
    expect(badHtml).not.toContain(OTHER);
    expect(badHtml).not.toContain(MENU);
    expect(render(good)).not.toContain("leafly-retailer-key-warning");
  });
});

// ---------------------------------------------------------------------------
// 6. The credentials page
// ---------------------------------------------------------------------------

describe("L-45 · the credentials page says what Leafly told us", () => {
  it("the editor renders the agreement line and the corrected copy", async () => {
    const { LeaflyCredentialsForm } = await import("@/app/admin/integrations/CredentialsEditor");
    const view = {
      environment: "production" as const,
      menuIntegrationKey: "\u2022\u2022\u2022\u20227731",
      clientId: "cid",
      clientSecret: "\u2022\u2022\u2022\u2022abcd",
      hmacKey: "\u2022\u2022\u2022\u20229911",
      orderIntegrationKey: "",
      sources: {
        menuIntegrationKey: "database" as const,
        clientId: "database" as const,
        clientSecret: "database" as const,
        hmacKey: "database" as const,
        orderIntegrationKey: "unset" as const,
      },
    };
    const agreement = core.describeRetailerKeyAgreement("menu_only");
    const html = renderToStaticMarkup(
      createElement(LeaflyCredentialsForm, { view, keyAgreement: agreement }),
    );
    const text = html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");
    expect(html).toContain('data-testid="leafly-key-agreement"');
    expect(text).toContain("your Menu integration key is used for orders too");
    expect(text).toContain("Leafly uses your Menu integration key as the order integration key; leave blank to use it.");
    // The old claim that BOTH boxes are required is gone.
    expect(text).not.toMatch(/Both of these are\s+required/);
    // Without the prop, nothing is claimed.
    expect(renderToStaticMarkup(createElement(LeaflyCredentialsForm, { view }))).not.toContain(
      "leafly-key-agreement",
    );
  });

  it("the integrations page computes the agreement on the SERVER and passes only the verdict", () => {
    const page = read("src/app/admin/integrations/page.tsx");
    expect(page).toContain("loadLeaflyRetailerKey()");
    expect(page).toContain("describeRetailerKeyAgreement(retailerKey.agreement)");
    expect(page).toMatch(/<LeaflyCredentialsForm view=\{credentials\.leafly\} keyAgreement=\{keyAgreement\} \/>/);
    expect(page).not.toMatch(/keyAgreement=\{retailerKey\}/);
  });

  it("the credentials core no longer claims the keys are 'NOT interchangeable'", () => {
    const src = read("src/lib/integrations/integration-credentials-core.ts");
    expect(src).not.toMatch(/NOT\s+interchangeable/);
    expect(src).toContain("SAME VALUE as the Dispensary Menu");
  });

  it("the readiness step no longer demands the Order box when the Menu key is saved", () => {
    const src = read("src/lib/leafly/order-readiness-core.ts");
    expect(src).not.toContain('"Order integration key saved"');
    expect(src).toContain("a saved Menu key is enough");
  });

  it("every Order-API caller still goes through loadLeaflyOrderIntegrationKey (so all get the fallback)", () => {
    for (const f of [
      "src/lib/leafly/order-fetch-server.ts",
      "src/lib/leafly/order-ack-server.ts",
      "src/lib/leafly/order-board-server.ts",
      "src/lib/leafly/order-detail-server.ts",
    ]) {
      const src = read(f);
      expect(src, f).toContain("loadLeaflyOrderIntegrationKey()");
      // Nobody reads the raw box directly any more.
      expect(src, f).not.toMatch(/overrides\(\)\)?\.orderIntegrationKey|leafly\.orderIntegrationKey/);
    }
    const ws = read("src/lib/leafly/webhook-server.ts");
    expect(ws).toMatch(/loadLeaflyOrderIntegrationKey[\s\S]{0,200}loadLeaflyRetailerKey\(\)\)\.key/);
  });

  it("the core is registered with the pure self-test runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toMatch(/assertRan\("leafly-retailer-key-core", __runLeaflyRetailerKeyTests\(\), \d+\)/);
    const r = core.__runLeaflyRetailerKeyTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(78);
  });
});
