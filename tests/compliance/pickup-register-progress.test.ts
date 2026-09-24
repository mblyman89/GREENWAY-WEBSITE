/**
 * SLICE L-37 — Confirm / Mark ready from the register, automatic "picked up"
 * when the register sale completes, and the Online Orders dashboard keeping
 * itself fresh.
 *
 * Three layers, all against the REAL code with fakes only at the edges:
 *
 *   1. The /api/pos/pickup `advance` mode: only "acknowledged" / "ready" are
 *      accepted (never a picked-up/completed target — SLICE 17 one door), an
 *      employee name is required, a store refusal is a 422, and the retired
 *      `complete` shape still answers 410.
 *   2. advancePickupAtRegister: website orders are one setOrderStatus call;
 *      Leafly orders are pushed to Leafly FIRST, one step at a time, and ours
 *      only moves as far as Leafly actually went.
 *   3. pushLeaflyPickedUp: walks `ready` before `picked_up`, never throws,
 *      and leaves a loud audit row on failure.
 *
 * Plus source-wiring pins for the pieces that are only observable in a live
 * sale: the sync closes the online order NON-REVENUE with the picked-up note
 * BEFORE scheduling the Leafly push, the bridge recognises that note, and the
 * dashboard auto-refreshes on the fingerprint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Shared fakes ────────────────────────────────────────────────────────────

vi.mock("@/lib/pos/cors", () => ({
  posPreflightResponse: () => new Response(null, { status: 204 }),
  withPosCors: (_req: unknown, res: Response) => res,
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));

type LeaflyRow = { leafly_order_id: string; leafly_status: string | null; acknowledged_at: string | null } | null;
let leaflyRow: LeaflyRow = null;
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      like: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: leaflyRow, error: null }),
    };
    return { from: () => q };
  },
}));

const audits: { action: string; after?: Record<string, unknown> }[] = [];
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; after?: Record<string, unknown> }) => void audits.push(a),
}));

type FakeOrder = {
  id: string;
  order_number: string;
  display_name: string | null;
  status: string;
  origin: string | null;
  staff_note: string | null;
};
let order: FakeOrder | null = null;
const statusCalls: { id: string; to: string; opts: Record<string, unknown> }[] = [];
let statusRefusal: string | null = null;
vi.mock("@/lib/orders/orders-store", () => ({
  listOrders: async () => [],
  getOrder: async () => order,
  setOrderStatus: async (id: string, to: string, opts: Record<string, unknown>) => {
    statusCalls.push({ id, to, opts });
    if (statusRefusal) return { ok: false, refusal: statusRefusal };
    return { ok: true, order: { ...(order as FakeOrder), status: to } };
  },
}));

const leaflyPushes: string[] = [];
let leaflyRefuses: string | null = null;
vi.mock("@/lib/leafly/order-ack-server", () => ({
  setLeaflyOrderStatus: async (input: { nextStatus: string }) => {
    if (leaflyRefuses === input.nextStatus) return { ok: false, message: "409 conflict" };
    leaflyPushes.push(input.nextStatus);
    return { ok: true, message: "ok" };
  },
}));

// The route authenticates the device and (for other modes) reaches the store.
vi.mock("@/lib/pos/sync-store", () => ({
  authenticateDevice: async () => ({ ok: true, device: { id: "dev-1", name: "Front iPad", register_id: "reg-1" } }),
}));

// Next's after() is outside a request scope in tests; the helper must fall
// back to running the task right away.
vi.mock("next/server", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    after: () => {
      throw new Error("after() called outside a request scope");
    },
  };
});

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function websiteOrder(status = "new"): FakeOrder {
  return { id: ORDER_ID, order_number: "GWY-000042", display_name: "Purple Rain", status, origin: "greenway", staff_note: null };
}
function leaflyOrder(status = "new"): FakeOrder {
  return { ...websiteOrder(status), origin: "leafly" };
}

beforeEach(() => {
  order = websiteOrder();
  leaflyRow = null;
  audits.length = 0;
  statusCalls.length = 0;
  statusRefusal = null;
  leaflyPushes.length = 0;
  leaflyRefuses = null;
});

// ── 1. The route ────────────────────────────────────────────────────────────

async function post(body: Record<string, unknown>) {
  const mod = await import("@/app/api/pos/pickup/route");
  const res = await mod.POST(
    new Request("https://example.test/api/pos/pickup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pos-device-id": "dev-1", "x-pos-device-key": "k" },
      body: JSON.stringify({ orderId: ORDER_ID, ...body }),
    }) as never,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("L-37 — register advance route", () => {
  it("Confirm moves a website order to acknowledged, attributed to the budtender at the register", async () => {
    const r = await post({ advance: { to: "acknowledged", employeeName: "Sam B." } });
    expect(r.status).toBe(200);
    expect(r.json.advanced).toMatchObject({ displayName: "Purple Rain", status: "acknowledged" });
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]).toMatchObject({ id: ORDER_ID, to: "acknowledged" });
    expect(String(statusCalls[0].opts.actorLabel)).toContain("Sam B.");
    expect(String(statusCalls[0].opts.actorLabel)).toContain("Front iPad");
    expect(audits.map((a) => a.action)).toEqual(["order.advanced_at_register"]);
  });

  it("there is NO picked-up / completed target — pickup completes only through the sale (SLICE 17)", async () => {
    for (const to of ["completed", "picked_up", "cancelled", "no_show", "preparing", "", null, 7]) {
      const r = await post({ advance: { to, employeeName: "Sam B." } });
      expect(r.status).toBe(400);
    }
    expect(statusCalls).toHaveLength(0);
  });

  it("an employee name is required", async () => {
    expect((await post({ advance: { to: "ready" } })).status).toBe(400);
    expect((await post({ advance: { to: "ready", employeeName: "   " } })).status).toBe(400);
    expect(statusCalls).toHaveLength(0);
  });

  it("a store refusal (e.g. backwards) is a 422, never a success", async () => {
    order = websiteOrder("ready");
    const r = await post({ advance: { to: "acknowledged", employeeName: "Sam B." } });
    expect(r.status).toBe(422);
    expect(r.json.advanced).toBeUndefined();
    expect(statusCalls).toHaveLength(0);
  });

  it("the retired checkbox handover still answers 410 Gone", async () => {
    const r = await post({ complete: { idConfirmed: true } });
    expect(r.status).toBe(410);
    expect(statusCalls).toHaveLength(0);
  });
});

// ── 2. The store ────────────────────────────────────────────────────────────

async function advance(to: "acknowledged" | "ready") {
  const { advancePickupAtRegister } = await import("@/lib/pos/pickup-store");
  return advancePickupAtRegister({ orderId: ORDER_ID, to, deviceName: "Front iPad", employeeName: "Sam B." });
}

describe("L-37 — advancePickupAtRegister", () => {
  it("website: Mark ready from new is one forward move", async () => {
    const r = await advance("ready");
    expect(r.ok).toBe(true);
    expect(statusCalls.map((c) => c.to)).toEqual(["ready"]);
    expect(leaflyPushes).toEqual([]);
  });

  it("refuses closed orders, backwards moves and register sales", async () => {
    order = websiteOrder("completed");
    expect((await advance("ready")).ok).toBe(false);
    order = websiteOrder("cancelled");
    expect((await advance("acknowledged")).ok).toBe(false);
    order = websiteOrder("ready");
    expect((await advance("acknowledged")).ok).toBe(false);
    const { POS_SALE_STAFF_NOTE_PREFIX } = await import("@/lib/pos/pickup-core");
    order = { ...websiteOrder(), staff_note: `${POS_SALE_STAFF_NOTE_PREFIX} register sale` };
    expect((await advance("ready")).ok).toBe(false);
    expect(statusCalls).toHaveLength(0);
  });

  it("Leafly: a pending order marked ready is walked confirmed -> ready at Leafly, THEN ours moves", async () => {
    order = leaflyOrder("new");
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "pending", acknowledged_at: "2026-01-01T00:00:00Z" };
    const r = await advance("ready");
    expect(r.ok).toBe(true);
    expect(leaflyPushes).toEqual(["confirmed", "ready"]);
    expect(statusCalls.map((c) => c.to)).toEqual(["ready"]);
  });

  it("Leafly: if Leafly refuses the second step, ours moves only as far as Leafly went", async () => {
    order = leaflyOrder("new");
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "pending", acknowledged_at: "2026-01-01T00:00:00Z" };
    leaflyRefuses = "ready";
    const r = await advance("ready");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("could not go further");
    expect(leaflyPushes).toEqual(["confirmed"]);
    expect(statusCalls.map((c) => c.to)).toEqual(["acknowledged"]);
  });

  it("Leafly: a refusal on the first step changes nothing locally", async () => {
    order = leaflyOrder("new");
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "pending", acknowledged_at: "2026-01-01T00:00:00Z" };
    leaflyRefuses = "confirmed";
    const r = await advance("acknowledged");
    expect(r.ok).toBe(false);
    expect(statusCalls).toHaveLength(0);
    expect(audits.map((a) => a.action)).toEqual(["order.register_advance_failed"]);
  });

  it("Leafly: unacknowledged, unlinked or final orders are refused before anything is sent", async () => {
    order = leaflyOrder("new");
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "pending", acknowledged_at: null };
    expect((await advance("acknowledged")).ok).toBe(false);
    leaflyRow = null;
    expect((await advance("acknowledged")).ok).toBe(false);
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "canceled", acknowledged_at: "2026-01-01T00:00:00Z" };
    expect((await advance("ready")).ok).toBe(false);
    expect(leaflyPushes).toEqual([]);
    expect(statusCalls).toHaveLength(0);
  });

  it("Leafly already there: ours still catches up, nothing is re-sent", async () => {
    order = leaflyOrder("acknowledged");
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "ready", acknowledged_at: "2026-01-01T00:00:00Z" };
    const r = await advance("ready");
    expect(r.ok).toBe(true);
    expect(leaflyPushes).toEqual([]);
    expect(statusCalls.map((c) => c.to)).toEqual(["ready"]);
  });
});

// ── 3. The automatic Leafly "picked up" ─────────────────────────────────────

describe("L-37 — pushLeaflyPickedUp", () => {
  async function push() {
    const { pushLeaflyPickedUp } = await import("@/lib/pos/pickup-leafly-close");
    return pushLeaflyPickedUp({ localOrderId: ORDER_ID, deviceLabel: "pos-device:dev-1" });
  }

  it("from confirmed it walks ready, then picked_up (never a direct jump)", async () => {
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "confirmed", acknowledged_at: "2026-01-01T00:00:00Z" };
    const r = await push();
    expect(r).toMatchObject({ ok: true, pushed: ["ready", "picked_up"] });
    expect(audits.map((a) => a.action)).toEqual(["order.leafly_picked_up_pushed"]);
  });

  it("a Leafly refusal is reported and audited, never thrown", async () => {
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "ready", acknowledged_at: "2026-01-01T00:00:00Z" };
    leaflyRefuses = "picked_up";
    const r = await push();
    expect(r.ok).toBe(false);
    expect(audits.map((a) => a.action)).toEqual(["order.leafly_picked_up_failed"]);
  });

  it("already picked up at Leafly: nothing sent; unlinked/unacknowledged: audited failure", async () => {
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "picked_up", acknowledged_at: "2026-01-01T00:00:00Z" };
    expect((await push()).ok).toBe(true);
    expect(leaflyPushes).toEqual([]);
    leaflyRow = null;
    expect((await push()).ok).toBe(false);
    leaflyRow = { leafly_order_id: "LF-1", leafly_status: "ready", acknowledged_at: "" };
    expect((await push()).ok).toBe(false);
    expect(leaflyPushes).toEqual([]);
  });

  it("scheduleAfterResponse falls back to running now outside a request, and swallows errors", async () => {
    const { scheduleAfterResponse } = await import("@/lib/pos/pickup-leafly-close");
    let ran = false;
    scheduleAfterResponse(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(() => scheduleAfterResponse(async () => Promise.reject(new Error("boom")))).not.toThrow();
  });
});

// ── 4. Wiring that only shows up in a live sale ─────────────────────────────

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("L-37 — wiring", () => {
  it("the sync closes the online order NON-REVENUE with the picked-up note, THEN schedules the Leafly push", () => {
    const sync = read("src/lib/pos/sync-store.ts");
    const close = sync.indexOf('setOrderStatus(source.id, "cancelled"');
    const note = sync.indexOf("note: registerPickedUpNote(");
    const push = sync.indexOf("pushLeaflyPickedUp({ localOrderId: source.id");
    expect(close).toBeGreaterThan(0);
    expect(note).toBeGreaterThan(close);
    expect(push).toBeGreaterThan(note);
    // Scheduled after the response, never awaited inline, and only for Leafly.
    expect(sync).toMatch(/isMarketplaceOrigin\(toOrderOrigin\(source\.origin\)\)\)\s*\{\s*scheduleAfterResponse\(/);
    // The online order must NEVER become a second "completed" order.
    expect(sync).not.toContain('setOrderStatus(source.id, "completed"');
    expect(sync).toContain('action: "order.picked_up_at_register"');
  });

  it("the Leafly bridge treats a register pickup as settled, not a disagreement", () => {
    const bridge = read("src/lib/leafly/bridge-server.ts");
    expect(bridge).toContain("isRegisterPickedUpNote(lastClose?.note)");
    expect(bridge).toContain('plan.localStatus === "completed" && current === "cancelled"');
  });

  it("the register modal has Confirm + Mark ready and no manual picked-up button", () => {
    const shell = read("src/app/pos/RegisterShell.tsx");
    expect(shell).toContain('advanceOrder("acknowledged")');
    expect(shell).toContain('advanceOrder("ready")');
    expect(shell).toMatch(/advance:\s*\{\s*to,\s*employeeName/);
    expect(shell).not.toContain('advanceOrder("completed")');
    expect(shell).not.toContain('advanceOrder("picked_up")');
  });

  it("screens say Picked up, not Cancelled, for a register pickup", () => {
    expect(read("src/app/admin/orders/page.tsx")).toContain("registerPickedUpOrderIds(");
    expect(read("src/app/admin/orders/[id]/page.tsx")).toContain("isRegisterPickedUpNote(ev.note)");
    expect(read("src/app/api/orders/[token]/route.ts")).toContain("pickedUpAtRegister ? REGISTER_PICKED_UP_LABEL");
  });

  it("the dashboard refreshes itself on register activity (fingerprint), not while someone is typing", () => {
    expect(read("src/app/api/admin/orders/count/route.ts")).toContain("fingerprint");
    const alert = read("src/components/admin/orders/NewOrderAlert.tsx");
    expect(alert).toContain("shouldAutoRefresh(");
    expect(alert).toContain("router.refresh()");
    expect(alert).toContain("userIsEditing()");
  });
});
