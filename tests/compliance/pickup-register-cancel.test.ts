/**
 * SLICE L-36 — cancelling an online order from the register.
 *
 * Drives the REAL /api/pos/pickup route against fakes for device auth, the
 * PIN lookup/throttle and the store, and pins the gate order that matters:
 * a bad reason or a non-manager PIN must never reach the store's cancel, and
 * a store refusal (e.g. Leafly said no) must surface as a failure, not a
 * success. Plus wiring checks that the register modal actually offers the
 * features the owner asked for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/lib/pos/sync-store", () => ({
  authenticateDevice: async () => ({ ok: true, device: { id: "dev-1", name: "Front iPad", register_id: "reg-1" } }),
}));

type Emp = { id: string; full_name: string; job_role: string } | null;
let employee: Emp = null;
let locked: string | null = null;
const pinEvents: string[] = [];
vi.mock("@/lib/staffing/store", () => ({ getEmployeeByPin: async () => employee }));
vi.mock("@/lib/security/pin-throttle-store", () => ({
  deviceThrottleScope: (id: string) => `device:${id}`,
  pinPadBlocked: async () => locked,
  notePinFailure: async () => void pinEvents.push("fail"),
  notePinSuccess: async () => void pinEvents.push("ok"),
}));

const cancelCalls: Record<string, unknown>[] = [];
let cancelResult: Record<string, unknown> = { ok: true, orderNumber: "GWY-000042", displayName: "Purple Rain", message: "Purple Rain cancelled." };
vi.mock("@/lib/pos/pickup-store", () => ({
  listRegisterPickupQueue: async () => ({ ok: true, queue: [] }),
  getRegisterPickupOrder: async () => ({ ok: true, order: {} }),
  loadOrderIntoRegister: async () => ({ ok: false, error: "unused" }),
  cancelPickupAtRegister: async (input: Record<string, unknown>) => {
    cancelCalls.push(input);
    return cancelResult;
  },
}));
vi.mock("@/lib/pos/cors", () => ({
  posPreflightResponse: () => new Response(null, { status: 204 }),
  withPosCors: (_req: unknown, res: Response) => res,
}));

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

async function post(cancel: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/pos/pickup/route");
  const res = await mod.POST(
    new Request("https://example.test/api/pos/pickup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pos-device-id": "dev-1", "x-pos-device-key": "k" },
      body: JSON.stringify({ orderId: ORDER_ID, cancel }),
    }) as never,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const good = { pin: "1234", reason: "customer", employeeName: "Sam B." };

beforeEach(() => {
  employee = { id: "e1", full_name: "Morgan Manager", job_role: "manager" };
  locked = null;
  pinEvents.length = 0;
  cancelCalls.length = 0;
  cancelResult = { ok: true, orderNumber: "GWY-000042", displayName: "Purple Rain", message: "Purple Rain cancelled." };
});

describe("L-36 — register cancel route", () => {
  it("a manager PIN + valid reason cancels, attributed to approver, device and budtender", async () => {
    const r = await post(good);
    expect(r.status).toBe(200);
    expect(r.json.cancelled).toMatchObject({ displayName: "Purple Rain" });
    expect(cancelCalls).toEqual([
      { orderId: ORDER_ID, reason: "customer", approverName: "Morgan Manager", deviceName: "Front iPad", employeeName: "Sam B." },
    ]);
    expect(pinEvents).toEqual(["ok"]);
  });

  it("a budtender PIN is refused (403) and never reaches the store", async () => {
    employee = { id: "e2", full_name: "Bud Tender", job_role: "budtender" };
    const r = await post(good);
    expect(r.status).toBe(403);
    expect(cancelCalls).toHaveLength(0);
  });

  it("an unknown PIN counts as a throttle failure (401); a locked pad is 429", async () => {
    employee = null;
    expect((await post(good)).status).toBe(401);
    expect(pinEvents).toEqual(["fail"]);
    locked = "Too many attempts.";
    expect((await post(good)).status).toBe(429);
    expect(cancelCalls).toHaveLength(0);
  });

  it("a reason outside the register list (even a real Leafly one) is refused", async () => {
    expect((await post({ ...good, reason: "pos" })).status).toBe(400);
    expect((await post({ ...good, reason: "" })).status).toBe(400);
    expect(cancelCalls).toHaveLength(0);
  });

  it("a store refusal (e.g. Leafly said no) is a 422, never a success", async () => {
    cancelResult = { ok: false, error: "Leafly did not accept the cancel, so nothing was changed: 409" };
    const r = await post(good);
    expect(r.status).toBe(422);
    expect(String(r.json.error)).toContain("nothing was changed");
    expect(r.json.cancelled).toBeUndefined();
  });
});

describe("L-36 — the register modal is wired to it", () => {
  const shell = readFileSync(resolve(__dirname, "../../src/app/pos/RegisterShell.tsx"), "utf8");
  it("offers search/scan, the rich breakdown and the cancel", () => {
    expect(shell).toContain("exactPickupMatch(");
    expect(shell).toContain("pickupMatchesSearch(");
    expect(shell).toMatch(/cancel:\s*\{\s*pin: cancelPin, reason: cancelReason/);
    expect(shell).toContain("REGISTER_CANCEL_REASONS.map");
    for (const label of ["Vendor: ", "Type: ", "Category: ", "Brand: "]) expect(shell).toContain(label);
    expect(shell).toContain("detail.taxLines");
    expect(shell).toContain("max-w-7xl");
  });
});
