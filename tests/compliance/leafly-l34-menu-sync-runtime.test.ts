/**
 * SLICE L-34 — THE MENU SYNC UNDER A FIFTEEN-MINUTE CADENCE, EXECUTED
 * ============================================================================
 *
 * Runs the REAL `runScheduledLeaflySync` through the REAL
 * `@supabase/postgrest-js` builder, against an in-memory fake of
 * `leafly_sync_runs` that applies the filters the queries actually send
 * (eq / neq / is.null / not.is.null / or=(and(...),and(...))). Faked: the
 * database transport, the settings read, and `pushLeaflyMenu` (a counter).
 *
 * Why this exists in addition to the pure-core simulation (schedule-core 7e):
 * the core proves the RULE; this proves the SERVER hands the rule the right
 * facts — that the query filters really exclude refusals, really count a
 * skipped daily POST as the day's full sync, really suppress repeat refusal
 * rows, and that two duplicate deliveries of one tick push exactly once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";

type Run = {
  id: string;
  channel: string;
  trigger_source: string;
  decision_code: string;
  pushed: boolean;
  method: string | null;
  disposition: string | null;
  reason: string | null;
  consecutive_failures: number;
  started_at: string;
  finished_at: string | null;
  created_by: string | null;
  http_status?: number | null;
  item_count?: number | null;
  plan_summary?: string | null;
  error_detail?: string | null;
};

const state: {
  rows: Run[];
  clock: number; // ms since epoch, the "database now()"
  seq: number;
  holdInsertsUntilBoth: boolean;
  pendingInserts: (() => void)[];
} = { rows: [], clock: 0, seq: 0, holdInsertsUntilBoth: false, pendingInserts: [] };

/** One PostgREST condition `col.op.value` or `col=op.value`. */
function cond(row: Run, col: string, expr: string): boolean {
  const v = (row as unknown as Record<string, unknown>)[col];
  if (expr === "is.null") return v === null || v === undefined;
  if (expr === "not.is.null") return v !== null && v !== undefined;
  if (expr.startsWith("eq.")) return String(v) === expr.slice(3);
  if (expr.startsWith("neq.")) return v === null || v === undefined ? false : String(v) !== expr.slice(4);
  throw new Error(`fake PostgREST: unsupported filter ${col}=${expr}`);
}

/** Parse `(and(a.eq.x,b.eq.y),and(...))` — the only or= shapes these queries use. */
function orMatch(row: Run, raw: string): boolean {
  const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
  const groups = inner.match(/and\(([^)]*)\)/g);
  if (!groups) throw new Error(`fake PostgREST: unsupported or=${raw}`);
  return groups.some((g) =>
    g
      .slice(4, -1)
      .split(",")
      .every((c) => {
        const [col, ...rest] = c.split(".");
        return cond(row, col!, rest.join("."));
      }),
  );
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const method = (init?.method ?? "GET").toUpperCase();
  await new Promise((r) => setTimeout(r, 0));
  const params = [...url.searchParams.entries()];
  const filt = (r: Run) =>
    params.every(([k, v]) => {
      if (["select", "order", "limit", "columns"].includes(k)) return true;
      if (k === "or") return orMatch(r, v);
      return cond(r, k, v);
    });
  if (method === "GET") {
    let hit = state.rows.filter(filt);
    const order = url.searchParams.get("order") ?? "";
    const desc = order.includes(".desc");
    hit = [...hit].sort((a, b) =>
      desc ? b.started_at.localeCompare(a.started_at) : a.started_at.localeCompare(b.started_at),
    );
    const limit = Number(url.searchParams.get("limit") ?? "1000");
    return new Response(JSON.stringify(hit.slice(0, limit)), { status: 200 });
  }
  if (method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}")) as Partial<Run>;
    state.seq += 1;
    const row: Run = {
      id: `run-${String(state.seq).padStart(4, "0")}`,
      channel: "leafly",
      trigger_source: "schedule",
      decision_code: "",
      pushed: false,
      method: null,
      disposition: null,
      reason: null,
      consecutive_failures: 0,
      started_at: new Date(state.clock).toISOString(),
      finished_at: null,
      created_by: null,
      ...body,
    };
    const commit = () => state.rows.push(row);
    if (state.holdInsertsUntilBoth) {
      // Model two duplicate deliveries that BOTH passed the in-flight read
      // before either inserted: hold the first insert until the second
      // arrives, then commit both.
      await new Promise<void>((resolve) => {
        state.pendingInserts.push(() => {
          commit();
          resolve();
        });
        if (state.pendingInserts.length === 2) {
          state.pendingInserts.forEach((f) => f());
          state.pendingInserts = [];
          state.holdInsertsUntilBoth = false;
        }
      });
    } else {
      commit();
    }
    // `.single()` → object
    return new Response(JSON.stringify({ id: row.id }), { status: 201 });
  }
  if (method === "PATCH") {
    const body = JSON.parse(String(init?.body ?? "{}")) as Partial<Run>;
    for (const r of state.rows.filter(filt)) Object.assign(r, body);
    return new Response("", { status: 204 });
  }
  throw new Error(`fake PostgREST: unsupported ${method}`);
}

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () =>
    new PostgrestClient("http://fake-postgrest.local/rest/v1", { fetch: fakeFetch }),
}));

const settings = {
  enabled: true,
  dailyFullHour: 4,
  intradayEnabled: true,
  intradayMinutes: 60,
};
vi.mock("@/lib/syndication/engine-store", () => ({
  getSyncSettingsRaw: async () => ({ ...settings }),
}));

type PushCall = { method: string };
const pushes: PushCall[] = [];
let pushSkipsWhen: (method: string) => boolean = () => false;
vi.mock("@/lib/leafly/push", () => ({
  isLeaflyConfigured: () => true,
  describeLeaflyReadinessAsync: async () => null,
  pushLeaflyMenu: async (args: { method: string }) => {
    pushes.push({ method: args.method });
    await new Promise((r) => setTimeout(r, 2));
    const skipped = pushSkipsWhen(args.method);
    return {
      ok: !skipped,
      skipped,
      method: args.method,
      httpStatus: skipped ? 0 : 200,
      itemCount: 10,
      planSummary: "0 new",
      message: skipped ? "Nothing had changed" : "ok",
    };
  },
}));

const { runScheduledLeaflySync } = await import("@/lib/leafly/schedule-server");

/** Drive the real server once per `stepMin` minutes from `startIso` for `hours`. */
async function simulate(startIso: string, hours: number, stepMin: number) {
  const start = Date.parse(startIso);
  for (let m = 0; m < hours * 60; m += stepMin) {
    state.clock = start + m * 60_000;
    await runScheduledLeaflySync(new Date(state.clock).toISOString());
  }
}

beforeEach(() => {
  state.rows = [];
  state.clock = 0;
  state.seq = 0;
  state.holdInsertsUntilBoth = false;
  state.pendingInserts = [];
  pushes.length = 0;
  pushSkipsWhen = () => false;
  settings.intradayMinutes = 60;
});

// 2026-06-15 is PDT (UTC-7). 11:00Z = 04:00 Pacific = dailyFullHour.
const FOUR_AM_PDT = "2026-06-15T11:00:00.000Z";

describe("L-34 · the real server at a fifteen-minute tick", () => {
  it("60-minute setting: one daily POST, then an hourly PUT — not starved (Defect A)", async () => {
    await simulate(FOUR_AM_PDT, 6, 15);
    const posts = pushes.filter((p) => p.method === "POST").length;
    const puts = pushes.filter((p) => p.method === "PUT").length;
    expect(posts).toBe(1);
    // 6 hours, first hour taken by the POST → 5 or 6 hourly deltas.
    expect(puts).toBeGreaterThanOrEqual(5);
    expect(puts).toBeLessThanOrEqual(6);
  });

  it("15-minute setting: a push on every tick after the POST", async () => {
    settings.intradayMinutes = 15;
    await simulate(FOUR_AM_PDT, 2, 15);
    expect(pushes.length).toBe(8);
  });

  it("quiet day: a skipped daily POST counts as the full sync — not retried every tick (Defect E)", async () => {
    pushSkipsWhen = () => true; // nothing ever changes
    await simulate(FOUR_AM_PDT, 6, 15);
    const posts = pushes.filter((p) => p.method === "POST").length;
    expect(posts).toBe(1);
  });

  it("refusal rows are heartbeat-limited, not one per tick", async () => {
    await simulate(FOUR_AM_PDT, 6, 15);
    const refused = state.rows.filter((r) => r.disposition === "refused").length;
    const real = state.rows.filter((r) => r.disposition !== "refused").length;
    // 24 ticks in 6 hours; before L-34 every non-push tick wrote a row.
    expect(state.rows.length).toBeLessThan(24);
    expect(real).toBe(pushes.length);
    expect(refused).toBeLessThanOrEqual(6);
  });
});

describe("L-34 · two deliveries of the same tick (Vercel double invocation)", () => {
  it("both pass the in-flight read, both insert a lock row — exactly ONE pushes", async () => {
    state.clock = Date.parse(FOUR_AM_PDT);
    state.holdInsertsUntilBoth = true;
    const [a, b] = await Promise.all([
      runScheduledLeaflySync(FOUR_AM_PDT),
      runScheduledLeaflySync(FOUR_AM_PDT),
    ]);
    expect(pushes.length).toBe(1);
    expect([a.pushed, b.pushed].sort()).toEqual([false, true]);
    const loser = a.pushed ? b : a;
    expect(loser.decision.code).toBe("run_in_flight");
    // The loser's lock row is closed (not left dangling for 30 minutes), and
    // records what actually happened.
    expect(state.rows.every((r) => r.finished_at !== null)).toBe(true);
    const loserRow = state.rows.find((r) => r.decision_code === "run_in_flight");
    expect(loserRow?.disposition).toBe("refused");
    expect(loserRow?.pushed).toBe(false);
  });

  it("without the race, a single delivery is untouched", async () => {
    const r = await runScheduledLeaflySync(FOUR_AM_PDT);
    expect(r.pushed).toBe(true);
    expect(pushes.length).toBe(1);
  });
});
