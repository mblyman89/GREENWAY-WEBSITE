/**
 * SLICE L-34 — THE SWEEP UNDER A TWO-MINUTE CADENCE, EXECUTED
 * ============================================================================
 *
 * On Vercel Pro the acknowledge sweep runs every two minutes. Vercel's cron
 * documentation says delivery is best effort and an invocation may be
 * delivered more than once, so two sweep runs can be in flight at the same
 * moment and read the same unacknowledged order.
 *
 * These tests run the REAL `sweepUnacknowledgedLeaflyOrders` through the REAL
 * `@supabase/postgrest-js` query builder (so every URL below is the exact
 * request production sends), against an in-memory fake PostgREST that applies
 * the filters the way Postgres would — including the compare-and-swap an
 * UPDATE ... WHERE updated_at = $read performs under READ COMMITTED.
 *
 * Only two things are faked: the HTTP transport to the database, and the
 * outbound press to Leafly (`acknowledgeLeaflyOrder`), which is replaced by a
 * counter that stamps `acknowledged_at` after a simulated network delay —
 * exactly the window in which a second run could slip through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";

type Row = {
  leafly_order_id: string;
  acknowledged_at: string | null;
  acknowledge_by: string | null;
  first_seen_at: string;
  leafly_status: string | null;
  canceled_at: string | null;
  updated_at: string;
};

const db: {
  rows: Row[];
  requests: { method: string; url: string }[];
  tick: number;
  /** Runs once, right after the sweep's list read is answered. */
  afterList: (() => void) | null;
} = { rows: [], requests: [], tick: 0, afterList: null };

/** Evaluate one `col=op.value` PostgREST filter against a row. */
function matches(row: Row, key: string, raw: string): boolean {
  const v = (row as unknown as Record<string, string | null>)[key];
  if (raw === "is.null") return v === null;
  if (raw.startsWith("eq.")) return v === raw.slice(3);
  if (raw.startsWith("neq.")) return v !== raw.slice(4);
  return true; // filters this fake does not model are asserted on by URL instead
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const method = (init?.method ?? "GET").toUpperCase();
  db.requests.push({ method, url: url.toString() });
  // Yield, so concurrent runs genuinely interleave at every round trip.
  await new Promise((r) => setTimeout(r, 0));
  const filters = [...url.searchParams.entries()].filter(
    ([k]) => !["select", "order", "limit", "or"].includes(k),
  );
  const hit = db.rows.filter((r) => filters.every(([k, v]) => matches(r, k, v)));
  if (method === "GET") {
    const body = JSON.stringify(hit);
    if (url.searchParams.has("or") && db.afterList) {
      const hook = db.afterList;
      db.afterList = null;
      hook();
    }
    return new Response(body, { status: 200 });
  }
  if (method === "PATCH") {
    // Postgres semantics: the UPDATE re-checks the WHERE against the current
    // row version. The BEFORE UPDATE trigger rewrites updated_at.
    const body = JSON.parse(String(init?.body ?? "{}")) as Partial<Row>;
    const changed: Row[] = [];
    for (const r of hit) {
      Object.assign(r, body);
      db.tick += 1;
      r.updated_at = `2026-09-20T12:00:${String(db.tick).padStart(2, "0")}.000001+00:00`;
      changed.push({ ...r });
    }
    return new Response(JSON.stringify(changed), { status: 200 });
  }
  return new Response("[]", { status: 200 });
}

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () =>
    new PostgrestClient("http://fake-postgrest.local/rest/v1", { fetch: fakeFetch }),
}));

const presses: string[] = [];
vi.mock("@/lib/leafly/order-ack-server", () => ({
  acknowledgeLeaflyOrder: async (input: { order: { leaflyOrderId?: string; leafly_order_id: string | null } }) => {
    const id = input.order.leafly_order_id ?? "";
    presses.push(id);
    // The network round trip to Leafly. Long enough that a second run which
    // already read the row would reach this point too, if nothing stopped it.
    await new Promise((r) => setTimeout(r, 5));
    const row = db.rows.find((r) => r.leafly_order_id === id);
    if (row) row.acknowledged_at = new Date().toISOString();
    return { ok: true, refused: false, code: "ok", message: "ok", httpStatus: 204, assessment: null, warning: null };
  },
}));
vi.mock("@/lib/leafly/webhook-server", () => ({
  markLeaflyOrderAcknowledged: async () => ({ ok: true }),
}));

const { sweepUnacknowledgedLeaflyOrders } = await import("@/lib/leafly/auto-ack-server");

const NOW = new Date("2026-09-20T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function liveOrder(id: string): Row {
  return {
    leafly_order_id: id,
    acknowledged_at: null,
    acknowledge_by: ahead(8 * 60_000),
    first_seen_at: ago(7 * 60_000),
    leafly_status: "pending",
    canceled_at: null,
    updated_at: "2026-09-20T11:53:00.000001+00:00",
  };
}

beforeEach(() => {
  db.rows = [];
  db.requests = [];
  db.tick = 0;
  db.afterList = null;
  presses.length = 0;
  delete process.env.LEAFLY_AUTO_ACKNOWLEDGE;
});

describe("L-34 · the sweep query production actually sends", () => {
  it("excludes acknowledged AND cancelled rows, and bounds the window with quoted timestamps", async () => {
    db.rows = [liveOrder("A")];
    await sweepUnacknowledgedLeaflyOrders(NOW);
    const list = db.requests.find((r) => r.method === "GET" && r.url.includes("or="));
    expect(list, "the sweep list query was sent").toBeDefined();
    const u = new URL(list!.url);
    expect(u.searchParams.get("acknowledged_at")).toBe("is.null");
    expect(u.searchParams.get("canceled_at")).toBe("is.null");
    // Timestamps contain ':' and '.', reserved in PostgREST's logic-tree
    // grammar, so they must be double-quoted inside or=(...).
    const floor = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    const seen = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    expect(u.searchParams.get("or")).toBe(
      `(acknowledge_by.gte."${floor}",and(acknowledge_by.is.null,first_seen_at.gte."${seen}"))`,
    );
    expect(u.searchParams.get("select")).toContain("updated_at");
    expect(u.searchParams.get("select")).toContain("canceled_at");
  });

  it("claims with a compare-and-swap on the exact updated_at it read", async () => {
    db.rows = [liveOrder("A")];
    await sweepUnacknowledgedLeaflyOrders(NOW);
    const claim = db.requests.find((r) => r.method === "PATCH");
    expect(claim).toBeDefined();
    const u = new URL(claim!.url);
    expect(u.searchParams.get("leafly_order_id")).toBe("eq.A");
    expect(u.searchParams.get("acknowledged_at")).toBe("is.null");
    expect(u.searchParams.get("updated_at")).toBe("eq.2026-09-20T11:53:00.000001+00:00");
  });
});

describe("L-34 · two sweep runs at once (Vercel double delivery)", () => {
  it("one live order, two concurrent runs → exactly ONE press to Leafly", async () => {
    db.rows = [liveOrder("A")];
    const [r1, r2] = await Promise.all([
      sweepUnacknowledgedLeaflyOrders(NOW),
      sweepUnacknowledgedLeaflyOrders(NOW),
    ]);
    expect(presses).toEqual(["A"]);
    expect(r1.acknowledged + r2.acknowledged).toBe(1);
    // The loser is not a failure and must not raise the 502 alarm.
    expect(r1.failed + r2.failed).toBe(0);
    expect(r1.expired + r2.expired).toBe(0);
    const loser = [r1, r2].find((r) => r.acknowledged === 0)!;
    expect(loser.details.map((d) => d.outcome).join(" ")).toMatch(/next sweep will re-check/);
  });

  it("three concurrent runs, four live orders → each order pressed exactly once", async () => {
    db.rows = ["A", "B", "C", "D"].map(liveOrder);
    await Promise.all([
      sweepUnacknowledgedLeaflyOrders(NOW),
      sweepUnacknowledgedLeaflyOrders(NOW),
      sweepUnacknowledgedLeaflyOrders(NOW),
    ]);
    expect([...presses].sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("a single run is unaffected: every live order is pressed", async () => {
    db.rows = ["A", "B"].map(liveOrder);
    const r = await sweepUnacknowledgedLeaflyOrders(NOW);
    expect(r.acknowledged).toBe(2);
    expect([...presses].sort()).toEqual(["A", "B"]);
  });

  it("a lost race is retried on the next tick, not abandoned", async () => {
    db.rows = [liveOrder("A")];
    // Something else touches the row between our read and our claim (for
    // example the arrival webhook updating its status) but does NOT
    // acknowledge it. The claim must lose, and must not press.
    db.afterList = () => {
      db.rows[0]!.updated_at = "2026-09-20T11:59:59.000001+00:00";
    };
    const r1 = await sweepUnacknowledgedLeaflyOrders(NOW);
    expect(r1.acknowledged).toBe(0);
    expect(r1.failed).toBe(0);
    expect(presses).toEqual([]);
    // Next tick, two minutes later: fresh read, fresh claim, pressed.
    const r2 = await sweepUnacknowledgedLeaflyOrders(new Date(NOW.getTime() + 120_000));
    expect(r2.acknowledged).toBe(1);
    expect(presses).toEqual(["A"]);
  });

  it("if the claim itself cannot run, the sweep still presses (fails towards acting)", async () => {
    db.rows = [liveOrder("A")];
    db.rows[0]!.updated_at = "";
    const r = await sweepUnacknowledgedLeaflyOrders(NOW);
    expect(r.acknowledged).toBe(1);
    expect(presses).toEqual(["A"]);
  });
});
