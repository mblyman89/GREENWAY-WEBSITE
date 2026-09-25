/**
 * SLICE L-46: Leafly's nine-second rule, proven end to end.
 *
 * Ben (Leafly), item 4: "Any non-2xx counts as a failure, AND SO DOES TAKING
 * LONGER THAN 9 SECONDS TO RESPOND." order_submit / order_status /
 * order_cancel are retried (4 deliveries); order_preview is not.
 *
 * These tests drive the REAL route files, the REAL webhook handler, the REAL
 * HMAC and the REAL budget race. Only the edges are faked (database, the
 * credential store, and the side-effect modules), and each fake can be held
 * open by a "gate" for as long as a test likes. That is how a test proves
 * "the 200 went out while the work was still pending", instead of assuming it.
 *
 * The budget is shrunk to a few milliseconds with the NODE_ENV=test-only hook,
 * so nothing here waits six real seconds.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Gates: a promise a test opens by hand.
// ---------------------------------------------------------------------------

type Gate<T> = { promise: Promise<T>; open: (v: T) => void };
function gate<T>(): Gate<T> {
  let open!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    open = r;
  });
  return { promise, open };
}

const HMAC = "l46-test-hmac-key";
const MENU = "GW-MENU-L46";

type DbResult = { error: null | { code?: string; message: string } };
const db = {
  inserts: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
};
let insertGate: Gate<DbResult> | null = null;
let upsertGate: Gate<DbResult> | null = null;
let collectGate: Gate<{ ok: boolean; summary: string }> | null = null;
let lookupGate: Gate<unknown> | null = null;
let bridgeResult: Record<string, unknown> = {};
const sideEffects: string[] = [];
const alertInputs: Array<Record<string, unknown>> = [];
const afterCalls: Array<() => unknown> = [];
let afterMode: "throw" | "capture" = "throw";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: () => unknown) => {
      if (afterMode === "throw") {
        throw new Error("`after` was called outside a request scope.");
      }
      afterCalls.push(task);
    },
  };
});
vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return true;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        db.inserts.push(row);
        return {
          abortSignal: async () => (insertGate ? insertGate.promise : { error: null }),
        };
      },
      upsert: (row: Record<string, unknown>) => {
        db.upserts.push(row);
        return {
          abortSignal: async () => (upsertGate ? upsertGate.promise : { error: null }),
        };
      },
      update: (row: Record<string, unknown>) => {
        db.updates.push(row);
        const b = { eq: () => b, abortSignal: async () => ({ error: null }) };
        return b;
      },
    }),
  }),
}));
vi.mock("@/lib/integrations/integration-credentials-store", () => ({
  getLeaflyOverrides: async () => ({ hmacKey: HMAC, menuIntegrationKey: MENU }),
}));
vi.mock("@/lib/leafly/order-fetch-server", () => ({
  collectLeaflyOrder: async () => {
    sideEffects.push("collect");
    return collectGate ? collectGate.promise : { ok: true, summary: "collected" };
  },
}));
vi.mock("@/lib/leafly/bridge-server", () => ({
  onLeaflyOrderArrived: async () => {
    sideEffects.push("bell");
    return {
      ok: true,
      announced: true,
      printed: true,
      alreadyHandled: false,
      summary: "leafly-bridge: rang",
      ...bridgeResult,
    };
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
  maybeSendLeaflyStaffAlert: async (input: Record<string, unknown>) => {
    sideEffects.push("staff-alert");
    alertInputs.push(input);
    return null;
  },
}));
vi.mock("@/lib/leafly/preview-lookup", () => ({
  buildLeaflyVariantLookup: async () => {
    sideEffects.push("menu-lookup");
    if (lookupGate) return lookupGate.promise;
    return { lookup: new Map(), loaded: false, variantCount: 0 };
  },
}));

const budget = await import("@/lib/leafly/inbound-budget");
const core = await import("@/lib/leafly/inbound-budget-core");
const dbCore = await import("@/lib/leafly/db-deadline-core");
const netCore = await import("@/lib/leafly/deadline-core");
const alertCore = await import("@/lib/leafly/staff-alert-core");
const { STAFF_ALERT_TIMEOUT_MS } = await import("@/lib/orders/staff-alert-email");
const submitPOST = (await import("@/app/api/webhooks/leafly/order-submit/route")).POST;
const statusPOST = (await import("@/app/api/webhooks/leafly/order-status/route")).POST;
const cancelPOST = (await import("@/app/api/webhooks/leafly/order-cancel/route")).POST;
const previewPOST = (await import("@/app/api/webhooks/leafly/order-preview/route")).POST;

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
const submitBody = (key: string | null = MENU) => {
  n += 1;
  const body: Record<string, unknown> = {
    eventTime: "2026-09-22T12:00:00Z",
    eventType: "order_submit",
    orderId: `L46-${n}`,
    acknowledgeBy: "2026-09-22T12:15:00Z",
  };
  if (key !== null) body.orderIntegrationKey = key;
  return JSON.stringify(body);
};
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
let logs: string[] = [];
const logLine = (needle: string) => logs.find((l) => l.includes(needle)) ?? "";
/** Resolve on a timer - long after every microtask the handler queued. */
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const processedStamps = () => db.updates.filter((u) => "processed_at" in u);

const TEST_BUDGET_MS = 25;

beforeEach(() => {
  db.inserts.length = 0;
  db.upserts.length = 0;
  db.updates.length = 0;
  insertGate = null;
  upsertGate = null;
  collectGate = null;
  lookupGate = null;
  bridgeResult = {};
  sideEffects.length = 0;
  alertInputs.length = 0;
  afterCalls.length = 0;
  afterMode = "throw";
  logs = [];
  const capture = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  budget.__setLeaflyInboundBudgetForTests(TEST_BUDGET_MS);
});

afterEach(async () => {
  // Never leave a gate shut: a test that failed half-way must not leak
  // pending work into the next test.
  insertGate?.open({ error: null });
  upsertGate?.open({ error: null });
  collectGate?.open({ ok: true, summary: "collected" });
  lookupGate?.open({ lookup: new Map(), loaded: false, variantCount: 0 });
  await budget.__drainLeaflyDeferredWork();
  budget.__setLeaflyInboundBudgetForTests(null);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Why this slice exists - computed from the repository's own constants
// ---------------------------------------------------------------------------

describe("L-46 · the old awaited path could not fit in Leafly's 9 seconds", () => {
  it("the pre-L-46 order_submit worst case, from the real deadline constants, is far over 9s", () => {
    const d = dbCore.LEAFLY_DB_TIMEOUT_MS;
    const legacy = core.legacyAwaitedWorstCaseMs([
      d.credentials_read, // one credentials read (L-45)
      d.order_write, // event insert
      d.order_write, // order upsert
      netCore.worstCaseMs("order_fetch"), // collect: 2 x (15s + 8s mint)
      d.order_write, // store the fetched order
      d.bridge_write, // bridge row read
      d.bridge_write, // bridge claim
      d.order_read, // auto-ack reads the row
      netCore.worstCaseMs("acknowledge"), // 2 x (12s + 8s mint)
      STAFF_ALERT_TIMEOUT_MS, // staff e-mail
      d.order_write, // processed_at stamp
    ]);
    expect(legacy).toBeGreaterThan(core.LEAFLY_INBOUND_RESPONSE_LIMIT_MS * 10);
    // Even the three steps before any Leafly call already break the rule.
    expect(
      core.legacyAwaitedWorstCaseMs([d.credentials_read, d.order_write, d.order_write]),
    ).toBeGreaterThan(core.LEAFLY_INBOUND_RESPONSE_LIMIT_MS);
  });

  it("the NEW worst case fits: the signature check (one bounded credentials read) and the budget run concurrently, not in sequence", () => {
    const input = {
      verifyWorstMs: dbCore.LEAFLY_DB_TIMEOUT_MS.credentials_read,
      budgetMs: core.LEAFLY_INBOUND_BUDGET_MS,
      slackMs: core.LEAFLY_INBOUND_RESPONSE_SLACK_MS,
    };
    expect(core.worstCaseResponseMs(input)).toBeLessThan(core.LEAFLY_INBOUND_RESPONSE_LIMIT_MS);
    expect(core.responseFitsLeaflyLimit(input)).toBe(true);
    // The credentials read must stay inside the budget, or the proof above
    // quietly becomes verify-dominated.
    expect(dbCore.LEAFLY_DB_TIMEOUT_MS.credentials_read).toBeLessThanOrEqual(
      core.LEAFLY_INBOUND_BUDGET_MS,
    );
  });

  it("the budget keeps at least 2 seconds of Leafly's 9 for cold starts and the network", () => {
    expect(core.LEAFLY_INBOUND_HEADROOM_MS).toBe(
      core.LEAFLY_INBOUND_RESPONSE_LIMIT_MS - core.LEAFLY_INBOUND_BUDGET_MS,
    );
    expect(core.LEAFLY_INBOUND_HEADROOM_MS).toBeGreaterThanOrEqual(2000);
  });

  it("Ben's retry policy is recorded verbatim, and nothing Leafly did not say is assumed", () => {
    expect(core.LEAFLY_INBOUND_RETRY_POLICY.order_submit.deliveries).toBe(4);
    expect(core.LEAFLY_INBOUND_RETRY_POLICY.order_preview.retried).toBe(false);
    expect(core.LEAFLY_INBOUND_RETRY_POLICY.order_activate.retried).toBeNull();
    expect(core.LEAFLY_INBOUND_RETRY_POLICY.order_deactivate.retried).toBeNull();
    expect([...core.LEAFLY_INBOUND_EVENTS].sort()).toEqual(
      ["order_activate", "order_cancel", "order_deactivate", "order_preview", "order_status", "order_submit"],
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The fast path is unchanged
// ---------------------------------------------------------------------------

describe("L-46 · a fast delivery behaves exactly as before", () => {
  it("everything runs BEFORE the 200, in the same order, with one log line and no deferral", async () => {
    budget.__setLeaflyInboundBudgetForTests(5_000);
    const body = submitBody();
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(sideEffects).toEqual(["collect", "bell", "auto-ack", "staff-alert"]);
    expect(processedStamps()).toHaveLength(1);
    expect(budget.__pendingLeaflyDeferredWork()).toBe(0);
    const line = logLine("[leafly order_submit] accepted");
    expect(line).not.toBe("");
    expect(line).not.toContain("answered 200 at");
    expect(logLine("finished after the response")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 3. The slow path: the 200 goes out on time, the work finishes afterwards
// ---------------------------------------------------------------------------

describe("L-46 · slow work no longer holds the 200 hostage", () => {
  it("a Leafly order fetch that hangs: 200 at the budget, THEN bell, paper, auto-ack, alert, processed stamp", async () => {
    collectGate = gate();
    const body = submitBody();
    const t0 = Date.now();
    const res = await submitPOST(post(body, sig(body)));
    const took = Date.now() - t0;

    expect(res.status).toBe(200);
    expect(took).toBeLessThan(1_000);
    // Answered while the work was genuinely still pending.
    expect(sideEffects).toEqual(["collect"]);
    expect(processedStamps()).toHaveLength(0);
    expect(budget.__pendingLeaflyDeferredWork()).toBeGreaterThan(0);
    const line = logLine("[leafly order_submit] accepted");
    expect(line).toContain("answered 200 at");
    expect(line).toContain("still running after the response");

    // Leafly's API answers late. Nothing was cancelled: the same work
    // carries on, in the same order.
    collectGate.open({ ok: true, summary: "collected" });
    await budget.__drainLeaflyDeferredWork();
    expect(sideEffects).toEqual(["collect", "bell", "auto-ack", "staff-alert"]);
    expect(processedStamps()).toHaveLength(1);
    const fin = logLine("[leafly order_submit] finished after the response");
    expect(fin).toContain("notes=[");
    expect(fin).toContain("acked");
  });

  it("a hung order upsert (stage B) is raced too - the old code awaited it before any bell", async () => {
    upsertGate = gate();
    const body = submitBody();
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(sideEffects).toEqual([]);
    upsertGate.open({ error: null });
    await budget.__drainLeaflyDeferredWork();
    expect(sideEffects).toEqual(["collect", "bell", "auto-ack", "staff-alert"]);
  });

  it("a hung event insert is raced too", async () => {
    insertGate = gate();
    const body = submitBody();
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(db.upserts).toHaveLength(0);
    insertGate.open({ error: null });
    await budget.__drainLeaflyDeferredWork();
    expect(db.upserts).toHaveLength(1);
    expect(sideEffects).toContain("bell");
  });

  it("a slow duplicate: answered on time, and the finish line says no work was repeated", async () => {
    insertGate = gate();
    const body = submitBody();
    const res = await submitPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    insertGate.open({ error: { code: "23505", message: "duplicate key value" } });
    await budget.__drainLeaflyDeferredWork();
    expect(sideEffects).toEqual([]);
    expect(db.upserts).toHaveLength(0);
    expect(logLine("finished after the response")).toContain("duplicate delivery");
  });

  it("the key-check note (L-45) still reaches the response line when the work is deferred", async () => {
    collectGate = gate();
    const body = submitBody("SOMEONE-ELSES-KEY");
    await submitPOST(post(body, sig(body)));
    const line = logLine("[leafly order_submit] accepted");
    expect(line).toContain("matches NEITHER saved key");
    expect(line).toContain("answered 200 at");
    expect(line).not.toContain("SOMEONE-ELSES-KEY");
  });

  it("the deferred promise is handed to Next's after() when a request scope exists (production)", async () => {
    afterMode = "capture";
    collectGate = gate();
    const body = submitBody();
    await submitPOST(post(body, sig(body)));
    expect(afterCalls).toHaveLength(1);
    const handed = afterCalls[0]();
    expect(handed).toBeInstanceOf(Promise);
    collectGate.open({ ok: true, summary: "collected" });
    await handed;
    expect(sideEffects).toEqual(["collect", "bell", "auto-ack", "staff-alert"]);
  });

  it("a fast delivery never calls after() (nothing to keep alive)", async () => {
    afterMode = "capture";
    budget.__setLeaflyInboundBudgetForTests(5_000);
    const body = submitBody();
    await submitPOST(post(body, sig(body)));
    expect(afterCalls).toHaveLength(0);
  });

  it("order_status and order_cancel (also retried by Leafly) get the same guarantee", async () => {
    upsertGate = gate();
    const status = JSON.stringify({
      eventTime: "2026-09-22T12:01:00Z",
      eventType: "order_status",
      orderId: "L46-S",
      orderIntegrationKey: MENU,
      status: "confirmed",
    });
    expect((await statusPOST(post(status, sig(status)))).status).toBe(200);
    upsertGate.open({ error: null });
    await budget.__drainLeaflyDeferredWork();

    upsertGate = gate();
    const cancel = JSON.stringify({
      eventTime: "2026-09-22T12:02:00Z",
      eventType: "order_cancel",
      orderId: "L46-C",
      orderIntegrationKey: MENU,
      status: "canceled",
      cancelationReasonCode: "customer",
    });
    expect((await cancelPOST(post(cancel, sig(cancel)))).status).toBe(200);
    expect(sideEffects).toEqual([]);
    upsertGate.open({ error: null });
    await budget.__drainLeaflyDeferredWork();
    expect(sideEffects).toEqual(["cancel"]);
  });

  it("a forged delivery is still refused with 401 on time, even when recording the refusal hangs", async () => {
    insertGate = gate();
    const body = submitBody();
    const t0 = Date.now();
    const res = await submitPOST(post(body, "0".repeat(64)));
    expect(res.status).toBe(401);
    expect(Date.now() - t0).toBeLessThan(1_000);
    insertGate.open({ error: null });
    await budget.__drainLeaflyDeferredWork();
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]?.signature_verified).toBe(false);
    expect(sideEffects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. F5 - a retry must not send a false "the shop may not know" e-mail
// ---------------------------------------------------------------------------

describe("L-46 · F5: an already-handled arrival is not a missed arrival", () => {
  it("the bridge's alreadyHandled reaches the staff alert as arrivalAlreadyHandled=true", async () => {
    budget.__setLeaflyInboundBudgetForTests(5_000);
    bridgeResult = {
      announced: false,
      printed: false,
      alreadyHandled: true,
      summary: "leafly-bridge: L46: already announced by another delivery",
    };
    const body = submitBody();
    await submitPOST(post(body, sig(body)));
    expect(alertInputs).toHaveLength(1);
    expect(alertInputs[0]).toMatchObject({
      announced: false,
      printed: false,
      arrivalAlreadyHandled: true,
    });
    // And the decision it feeds really stays quiet for that input.
    const decided = alertCore.decideStaffAlert({
      stage: "arrival",
      announced: false,
      printed: false,
      bridgedToRegister: false,
      collectionFailed: false,
      arrivalAlreadyHandled: true,
      hasStaffRecipients: true,
      providerConfigured: true,
    });
    expect(decided.send).toBe(false);
    // The log still says what happened, so nothing is hidden.
    expect(logLine("accepted")).toContain("already announced by another delivery");
  });

  it("a REAL failure to announce/print still alerts (the flag is false)", async () => {
    budget.__setLeaflyInboundBudgetForTests(5_000);
    bridgeResult = { announced: false, printed: false, alreadyHandled: false, summary: "x" };
    const body = submitBody();
    await submitPOST(post(body, sig(body)));
    expect(alertInputs[0]).toMatchObject({ arrivalAlreadyHandled: false });
  });

  it("a bridge that FAILED (ok=false) never counts as already handled, even if it claims to", async () => {
    budget.__setLeaflyInboundBudgetForTests(5_000);
    bridgeResult = { ok: false, announced: false, printed: false, alreadyHandled: true, summary: "db down" };
    const body = submitBody();
    await submitPOST(post(body, sig(body)));
    expect(alertInputs[0]).toMatchObject({ arrivalAlreadyHandled: false });
  });

  it("bridge-server marks exactly the two do-nothing-on-purpose paths", () => {
    const src = stripComments(read("src/lib/leafly/bridge-server.ts"));
    expect(src.match(/alreadyHandled:\s*true/g) ?? []).toHaveLength(2);
    expect(src).toMatch(/alreadyHandled:\s*true,\s*summary:\s*`\$\{id\}: \$\{actions\.summary\}`/);
    expect(src).toMatch(/alreadyHandled:\s*true,\s*summary:\s*`\$\{id\}: already announced by another delivery`/);
    expect(src).toMatch(/alreadyHandled:\s*partial\.alreadyHandled\s*\?\?\s*false/);
  });
});

// ---------------------------------------------------------------------------
// 5. order_preview - never retried, the shopper is waiting
// ---------------------------------------------------------------------------

describe("L-46 · order_preview answers inside the budget", () => {
  const previewBody = () =>
    JSON.stringify({
      eventTime: "2026-09-22T12:00:00Z",
      eventType: "order_preview",
      orderId: `L46-P-${(n += 1)}`,
      orderIntegrationKey: MENU,
      cartItems: [
        { name: "A", integratorVariantId: "v-1", quantity: 2, packagePrice: 1500 },
        { name: "B", integratorVariantId: "v-2", quantity: 1, packagePrice: 2500 },
      ],
    });

  it("a hung menu read: the cart is echoed back unchanged, on time, and the log says why", async () => {
    lookupGate = gate();
    const body = previewBody();
    const t0 = Date.now();
    const res = await previewPOST(post(body, sig(body)));
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { cartItems: unknown[]; taxes: unknown[] };
    expect(json).toEqual({
      cartItems: [
        { integratorVariantId: "v-1", quantity: 2, packagePrice: 1500 },
        { integratorVariantId: "v-2", quantity: 1, packagePrice: 2500 },
      ],
      taxes: [],
    });
    expect(logLine("pricing did not finish inside the budget")).toContain("2 cart line(s)");
  });

  it("hung bookkeeping does not hold the cart either: pricing still runs", async () => {
    insertGate = gate();
    budget.__setLeaflyInboundBudgetForTests(200);
    const body = previewBody();
    const res = await previewPOST(post(body, sig(body)));
    expect(res.status).toBe(200);
    expect(sideEffects).toContain("menu-lookup");
    insertGate.open({ error: null });
    await budget.__drainLeaflyDeferredWork();
    expect(db.inserts).toHaveLength(1);
  });

  it("the preview gives bookkeeping at most 2s of the budget, leaving the rest for pricing", () => {
    expect(core.LEAFLY_PREVIEW_BOOKKEEPING_MS).toBe(2_000);
    const src = stripComments(read("src/app/api/webhooks/leafly/order-preview/route.ts"));
    expect(src).toMatch(/budgetMs:\s*LEAFLY_PREVIEW_BOOKKEEPING_MS/);
    expect(src).toMatch(/raceLeaflyBudget\(lookupWork,\s*pricingLeft\)/);
  });
});

// ---------------------------------------------------------------------------
// 6. The race itself
// ---------------------------------------------------------------------------

describe("L-46 · raceLeaflyBudget / keepLeaflyWorkAlive", () => {
  it("returns the value when the work wins", async () => {
    await expect(budget.raceLeaflyBudget(Promise.resolve(7), 1_000)).resolves.toEqual({
      finished: true,
      value: 7,
    });
  });

  it("returns finished=false when the budget wins, WITHOUT cancelling the work", async () => {
    let done = false;
    const work = tick(30).then(() => {
      done = true;
      return 1;
    });
    await expect(budget.raceLeaflyBudget(work, 1)).resolves.toEqual({ finished: false });
    expect(done).toBe(false);
    await work;
    expect(done).toBe(true);
  });

  it("an early rejection is rethrown; a late one is swallowed (no unhandled rejection)", async () => {
    await expect(budget.raceLeaflyBudget(Promise.reject(new Error("boom")), 1_000)).rejects.toThrow(
      "boom",
    );
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const late = tick(20).then(() => {
        throw new Error("late");
      });
      await expect(budget.raceLeaflyBudget(late, 1)).resolves.toEqual({ finished: false });
      await tick(40);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("a non-finite or negative budget answers immediately rather than waiting forever", async () => {
    const never = new Promise(() => undefined);
    await expect(budget.raceLeaflyBudget(never, Number.NaN)).resolves.toEqual({ finished: false });
    await expect(budget.raceLeaflyBudget(never, -5)).resolves.toEqual({ finished: false });
  });

  it("keepLeaflyWorkAlive never throws, even when after() throws or the task rejects", async () => {
    afterMode = "throw";
    expect(() => budget.keepLeaflyWorkAlive(Promise.reject(new Error("x")))).not.toThrow();
    await budget.__drainLeaflyDeferredWork();
    expect(budget.__pendingLeaflyDeferredWork()).toBe(0);
  });

  it("the test-only budget hook is refused outside the test runner", () => {
    const prev = process.env.NODE_ENV;
    try {
      budget.__setLeaflyInboundBudgetForTests(null);
      (process.env as Record<string, string>).NODE_ENV = "production";
      budget.__setLeaflyInboundBudgetForTests(1);
      expect(budget.leaflyInboundBudgetMs()).toBe(core.LEAFLY_INBOUND_BUDGET_MS);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? "test";
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Pins on the shipped files
// ---------------------------------------------------------------------------

describe("L-46 · pins", () => {
  const ROUTES = [
    "order-submit",
    "order-status",
    "order-cancel",
    "order-activate",
    "order-deactivate",
    "order-preview",
  ];

  it.each(ROUTES)("%s declares maxDuration = LEAFLY_WEBHOOK_MAX_DURATION_S (after() lives only that long)", (r) => {
    const src = stripComments(read(`src/app/api/webhooks/leafly/${r}/route.ts`));
    const m = src.match(/^export const maxDuration = (\d+);$/m);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBe(core.LEAFLY_WEBHOOK_MAX_DURATION_S);
    expect(core.LEAFLY_WEBHOOK_MAX_DURATION_S * 1000).toBe(dbCore.PLATFORM_MAX_DURATION_MS);
  });

  it("the shared factory starts the clock before reading the body, and passes it on", () => {
    const src = stripComments(read("src/app/api/webhooks/leafly/route-factory.ts"));
    const start = src.indexOf("const startedAtMs = Date.now();");
    const body = src.indexOf("request.text()");
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(body);
    expect(src).toMatch(/expectedEvent,\s*startedAtMs,/);
  });

  it("the handler races the delivery's work and keeps the loser alive", () => {
    const src = stripComments(read("src/lib/leafly/webhook-server.ts"));
    expect(src).toMatch(/const race = await raceLeaflyBudget\(work, remaining\(\)\);/);
    expect(src).toMatch(/if \(race\.finished\) return race\.value;/);
    expect(src).toMatch(/keepLeaflyWorkAlive\(\s*work\.then/);
    // markLeaflyWebhookProcessed belongs to the WORK, not the response:
    // processed_at must mean "the work finished".
    const workFn = src.slice(src.indexOf("async function processVerifiedLeaflyDelivery"));
    expect(workFn).toContain("await markLeaflyWebhookProcessed(bodySha256);");
  });

  it("keepLeaflyWorkAlive really uses next/server after()", () => {
    const src = stripComments(read("src/lib/leafly/inbound-budget.ts"));
    expect(src).toMatch(/import \{ after \} from "next\/server";/);
    expect(src).toMatch(/after\(\(\) => settled\)/);
  });

  it("the new core is pure (no imports) and registered with a floor", () => {
    const src = read("src/lib/leafly/inbound-budget-core.ts");
    expect(src).not.toMatch(/^import /m);
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toMatch(
      /assertRan\("leafly-inbound-budget-core", __runLeaflyInboundBudgetTests\(\), \d+\)/,
    );
    const r = core.__runLeaflyInboundBudgetTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(86);
  });
});
