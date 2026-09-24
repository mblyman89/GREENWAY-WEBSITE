/**
 * SLICE L-35 — WHAT THE OPERATOR IS TOLD AFTER PRESSING A LEAFLY STEP
 * ============================================================================
 *
 * The owner pressed Confirm and Mark ready, saw "Leafly accepted the request
 * (200)" both times, got no email, and could not tell whether Leafly had
 * really moved the order. Leafly's 200 carries its full Order, so the answer
 * was already in hand. These tests drive the REAL `setLeaflyOrderStatus`
 * against a faked Leafly HTTP answer and prove:
 *
 *   1. a body that shows the requested status -> "Leafly now shows ..." and
 *      no warning;
 *   2. a body that disagrees -> a WARNING naming both statuses;
 *   3. a 200 with no body -> honest "could not double-check", never "Done";
 *   4. the orders page renders the warning in its own banner — before L-35
 *      `message ?? warning` meant a warning was never shown on any success.
 *
 * Faked: the Leafly transport, config and the database writers. Real: the
 * decision core, the response classifier, the order parser and the new
 * outcome sentence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: false }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/leafly/runtime", () => ({ refreshLeaflyConfig: async () => ({}) }));
vi.mock("@/lib/leafly/config", () => ({ getLeaflyConfig: () => ({ environment: "sandbox" }) }));
vi.mock("@/lib/leafly/token", () => ({
  getLeaflyAccessToken: async () => "tok",
  resetLeaflyTokenCache: () => {},
}));
vi.mock("@/lib/leafly/webhook-server", () => ({
  loadLeaflyOrderIntegrationKey: async () => "key-1",
  markLeaflyOrderAcknowledged: async () => ({ ok: true }),
}));

let leaflyReply: { status: number; body: unknown } = { status: 200, body: null };
const sentBodies: unknown[] = [];
vi.mock("@/lib/leafly/deadline-fetch", () => ({
  leaflyFetchWithDeadline: async (_op: string, _url: string, init: { body?: string }) => {
    sentBodies.push(init.body ? JSON.parse(init.body) : null);
    const text = leaflyReply.body === null ? "" : JSON.stringify(leaflyReply.body);
    return { ok: true, response: new Response(text, { status: leaflyReply.status }) };
  },
}));
vi.mock("@/lib/leafly/order-fetch-server", () => ({
  storeFetchedLeaflyOrder: async () => ({ ok: true }),
  collectLeaflyOrder: async () => ({ ok: false }),
}));
vi.mock("@/lib/leafly/bridge-server", () => ({
  onLeaflyOrderClosed: async () => ({ attempted: false, ok: true, summary: "" }),
  onLeaflyOrderAccepted: async () => ({ ok: true, summary: "" }),
}));

const { setLeaflyOrderStatus } = await import("@/lib/leafly/order-ack-server");

const order = {
  leafly_order_id: "ord-1",
  leafly_status: "confirmed",
  acknowledged_at: "2026-09-20T18:00:00Z",
};

beforeEach(() => {
  sentBodies.length = 0;
});

describe("L-35 · the sentence after a successful status push", () => {
  it("Leafly's body shows the step -> names it, no warning", async () => {
    leaflyReply = { status: 200, body: { id: "ord-1", status: "ready" } };
    const r = await setLeaflyOrderStatus({ order, nextStatus: "ready" });
    expect(sentBodies).toEqual([{ status: "ready" }]);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Leafly now shows this order as “Ready for pickup”");
    expect(r.message).toContain("comes from Leafly, not from us");
    expect(r.warning).toBeNull();
  });

  it("Leafly's body disagrees -> success stands, but a warning names both", async () => {
    leaflyReply = { status: 200, body: { id: "ord-1", status: "confirmed" } };
    const r = await setLeaflyOrderStatus({ order, nextStatus: "ready" });
    expect(r.ok).toBe(true);
    expect(r.warning).toContain("“Ready for pickup”");
    expect(r.warning).toContain("“Confirmed”");
  });

  it("a 200 with no body -> honest, never claims 'Done'", async () => {
    leaflyReply = { status: 200, body: null };
    const r = await setLeaflyOrderStatus({ order, nextStatus: "ready" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/could not double-check/);
    expect(r.message.startsWith("Done")).toBe(false);
  });
});

describe("L-35 · the warning is rendered, not masked by the success message", () => {
  it("page passes the warning on its own prop", () => {
    const page = readFileSync("src/app/admin/orders/page.tsx", "utf8");
    expect(page).not.toMatch(/sp\.leaflyMsg\s*\?\?\s*sp\.leaflyWarn/);
    expect(page).toMatch(/warning=\{sp\.leaflyWarn \?\? null\}/);
  });

  it("the panel shows a success AND a warning together", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const React = await import("react");
    const { LeaflyOrdersPanel } = (await import(
      "@/components/admin/orders/LeaflyOrdersPanel"
    )) as unknown as { LeaflyOrdersPanel: React.ComponentType<Record<string, unknown>> };
    const html = renderToStaticMarkup(
      React.createElement(LeaflyOrdersPanel, {
        board: { orders: [], ready: true, problem: "", orderIntegrationKeyPresent: true },
        pendingAckCount: 0,
        now: new Date("2026-09-20T18:00:00Z"),
        message: "Done — all good",
        warning: "The register order did not close",
      }),
    );
    expect(html).toContain("Done — all good");
    expect(html).toContain("The register order did not close");
  });
});
