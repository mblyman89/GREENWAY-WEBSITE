/**
 * SLICE 17 — one door out of the pickup queue, and it is the scanned one.
 *
 * Owner report, verbatim:
 *
 *   "Right now I open the order, and it gives me the option to complete the
 *    sale right there in that screen, or add the order to the register cart
 *    to add more items. I want this to be the only option. The latter
 *    requires going through the age gate scan id feature. The former is just
 *    a check box. I don't like that. Please remove that option."
 *
 * These tests drive the REAL `POST /api/pos/pickup` handler (dynamically
 * imported after `vi.resetModules()`) against fakes for device auth and the
 * pickup store. The point is to prove the CAPABILITY is gone, not that a
 * button was deleted: a UI-only change would leave this endpoint accepting
 * `complete: { idConfirmed: true }` from anything holding device creds.
 *
 * Standing rule: test file content is not test behaviour. Nothing here
 * string-matches source code — every assertion runs the real route or the
 * real pure core.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fakes ──────────────────────────────────────────────────────────────────
// Device auth: a real, register-bound device, so nothing is refused for the
// wrong reason. If the retired route were still alive, this request would be
// fully entitled to use it — which is exactly what makes the test meaningful.
let authOk = true;

vi.mock("@/lib/pos/sync-store", () => ({
  authenticateDevice: async () =>
    authOk
      ? { ok: true, device: { id: "dev-1", name: "Front iPad", register_id: "reg-1" } }
      : { ok: false, error: "Unknown device.", status: 401 },
}));

// The store still serves the queue, the detail view and the load route.
// `completePickupAtRegister` is deliberately ABSENT: slice 17 deleted it, and
// if the route still imported it this mock would fail to satisfy the import.
const loadCalls: unknown[] = [];
let loadResult: Record<string, unknown> = {
  ok: true,
  orderId: "11111111-1111-4111-8111-111111111111",
  orderNumber: "GW-1042",
  customerLabel: "Jordan T.",
  customerNote: null,
  lines: [{ productId: "p1", variantId: "v1", quantity: 2 }],
  member: null,
};

vi.mock("@/lib/pos/pickup-store", () => ({
  listRegisterPickupQueue: async () => ({ ok: true, queue: [{ orderId: "o1", orderNumber: "GW-1042" }] }),
  getRegisterPickupOrder: async () => ({
    ok: true,
    order: { orderId: "o1", orderNumber: "GW-1042", totalMinor: 4550 },
  }),
  loadOrderIntoRegister: async (input: unknown) => {
    loadCalls.push(input);
    return loadResult;
  },
}));

vi.mock("@/lib/pos/cors", () => ({
  posPreflightResponse: () => new Response(null, { status: 204 }),
  withPosCors: (_req: unknown, res: Response) => res,
}));

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const DRAWER_ID = "33333333-3333-4333-8333-333333333333";

function req(body: unknown): Request {
  return new Request("https://example.test/api/pos/pickup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pos-device-id": "dev-1",
      "x-pos-device-key": "key-1",
    },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  vi.resetModules();
  const mod = await import("@/app/api/pos/pickup/route");
  // The route's NextRequest is structurally a Request for our purposes.
  const res = await mod.POST(req(body) as never);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

beforeEach(() => {
  authOk = true;
  loadCalls.length = 0;
  loadResult = {
    ok: true,
    orderId: ORDER_ID,
    orderNumber: "GW-1042",
    customerLabel: "Jordan T.",
    customerNote: null,
    lines: [{ productId: "p1", variantId: "v1", quantity: 2 }],
    member: null,
  };
});

describe("SLICE 17 — the checkbox handover is GONE from the server, not just the screen", () => {
  it("refuses the exact request the old UI sent, with 410 Gone", async () => {
    // This is byte-for-byte what PickupQueueModal used to POST.
    const { status, json } = await post({
      orderId: ORDER_ID,
      complete: { employeeId: EMPLOYEE_ID, tenderedMinor: 5000, idConfirmed: true, drawerSessionId: DRAWER_ID },
    });

    expect(status).toBe(410);
    const errors = json.errors as string[];
    expect(Array.isArray(errors)).toBe(true);
    // The budtender is told what to do next, not just that it failed.
    expect(errors.join(" ")).toContain("scan");
    expect(errors.join(" ")).toContain("WAC 314-55-150");
    // And the response names the route that IS allowed.
    expect(json.useRoute).toBe("load_into_sale");
  });

  it("cannot be smuggled through with idConfirmed:false — the SHAPE is refused", async () => {
    // A caller might reason "the guard checks idConfirmed, so send false".
    // The guard keys on the presence of complete{}, so there is no value of
    // idConfirmed that completes a pickup.
    const { status } = await post({
      orderId: ORDER_ID,
      complete: { employeeId: EMPLOYEE_ID, tenderedMinor: 5000, idConfirmed: false, drawerSessionId: DRAWER_ID },
    });
    expect(status).toBe(410);
  });

  it("refuses an EMPTY complete{} too (no partial body sneaks past)", async () => {
    const { status } = await post({ orderId: ORDER_ID, complete: {} });
    expect(status).toBe(410);
  });

  it("refuses BEFORE any employee/drawer/money validation runs", async () => {
    // Garbage employee id, garbage drawer, negative tender. If the route
    // still validated the completion body first it would answer 400 about
    // one of those. 410 proves the capability check comes first — the
    // handover is not reachable, not merely mis-parameterised.
    const { status } = await post({
      orderId: ORDER_ID,
      complete: { employeeId: "not-a-uuid", tenderedMinor: -99, idConfirmed: true, drawerSessionId: "nope" },
    });
    expect(status).toBe(410);
  });
});

describe("SLICE 17 — the load route (the scanned door) is untouched", () => {
  it("still loads an order into a register sale and returns its lines", async () => {
    const { status, json } = await post({ orderId: ORDER_ID, load: { employeeName: "Casey" } });

    expect(status).toBe(200);
    const loaded = json.loaded as Record<string, unknown>;
    expect(loaded.orderNumber).toBe("GW-1042");
    expect(loaded.orderId).toBe(ORDER_ID);
    // The source order id must come back: the sync supersedes the website
    // order ONLY when the register sale completes (AM-D2). Losing it would
    // orphan the order.
    expect(Array.isArray(loaded.lines)).toBe(true);
    expect(loadCalls).toHaveLength(1);
  });

  it("still reports a refused load honestly (422, not a silent success)", async () => {
    loadResult = { ok: false, error: "Order is completed — only an active website order can be loaded." };
    const { status, json } = await post({ orderId: ORDER_ID, load: { employeeName: "Casey" } });
    expect(status).toBe(422);
    expect(String(json.error)).toContain("active website order");
  });

  it("still serves the detail view (opening an order is not a handover)", async () => {
    const { status, json } = await post({ orderId: ORDER_ID });
    expect(status).toBe(200);
    expect((json.order as Record<string, unknown>).orderNumber).toBe("GW-1042");
  });

  it("still rejects a non-UUID orderId before anything else", async () => {
    const { status } = await post({ orderId: "nope", load: { employeeName: "Casey" } });
    expect(status).toBe(400);
  });

  it("still requires an authenticated device", async () => {
    authOk = false;
    const { status } = await post({ orderId: ORDER_ID, load: { employeeName: "Casey" } });
    expect(status).toBe(401);
  });
});

describe("SLICE 17 — the pure core", () => {
  it("passes its own self-tests", async () => {
    const { __runPickupHandoverCoreTests } = await import("@/lib/pos/pickup-handover-core");
    expect(() => __runPickupHandoverCoreTests()).not.toThrow();
  });

  it("names exactly one sanctioned route", async () => {
    const { SANCTIONED_HANDOVER_ROUTE, evaluateHandoverRoute } = await import("@/lib/pos/pickup-handover-core");
    expect(SANCTIONED_HANDOVER_ROUTE).toBe("load_into_sale");
    expect(evaluateHandoverRoute("load_into_sale").allowed).toBe(true);
    expect(evaluateHandoverRoute("complete").allowed).toBe(false);
  });
});

describe("SLICE 17 — the completion capability is deleted, not merely unused", () => {
  it("pickup-store no longer exports completePickupAtRegister", async () => {
    // An unused export that completes cannabis sales is a bypass waiting for
    // a future caller. This drives the REAL module (unmocked) and asserts the
    // capability is absent from the surface entirely.
    vi.resetModules();
    vi.doUnmock("@/lib/pos/pickup-store");
    const store = await vi.importActual<Record<string, unknown>>("@/lib/pos/pickup-store");
    expect("completePickupAtRegister" in store).toBe(false);
    // The routes that remain are still there — this is a removal, not a purge.
    expect(typeof store.loadOrderIntoRegister).toBe("function");
    expect(typeof store.listRegisterPickupQueue).toBe("function");
    expect(typeof store.getRegisterPickupOrder).toBe("function");
  });
});
