/**
 * tests/compliance/r50-a4-cutover-watch.test.ts   (R50 A4)
 *
 * Failure alerts for the cutover jobs. The pure planner is self-tested in
 * cutover-watch-core.ts (run by the pure runner and pinned here); this file
 * drives the REAL server watcher against an in-memory PostgREST with the
 * real UNIQUE(dedupe_key) rule, so the claim-before-send is exercised the way
 * Postgres would enforce it:
 *   - a failed harvest is sent once by email + phone and never again;
 *   - two overlapping ticks send it exactly once (the claim is real);
 *   - no channel configured -> nothing claimed, so it fires later;
 *   - every channel failing -> logged "not delivered", not resent every 5 min;
 *   - a claim the database refuses -> nothing sent;
 *   - the push body is plain text, the email is escaped HTML;
 * plus the cron wiring (every 5 min, fail-closed auth) and the runbook panel.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const RID = "20261031T150000Z-0a1b2c3d";
const NOW = Date.parse("2026-10-31T16:00:00Z");

const state = {
  db: null as unknown as FakePostgrest,
  svc: true,
  crawler: true,
  pushOn: true,
  pushCount: 1,
  emailOk: true,
  emails: [] as { subject: string; html: string; to: string[] }[],
  pushes: [] as { title: string; body: string; url?: string; tag?: string }[],
  runs: new Map<string, unknown>(),
  runThrows: null as string | null,
  redirects: [] as string[],
  audits: [] as unknown[],
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    state.redirects.push(u);
    throw new Error(`REDIRECT:${u}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => ({ userId: "u1", email: "owner@x.com", profile: { role: "owner" }, perm: p }),
  getStaffSession: async () => null,
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: unknown) => void state.audits.push(e) }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient: PC } = await import("@supabase/postgrest-js");
  return { createSupabaseAdminClient: () => new PC("http://fake.supabase.local/rest/v1", { fetch: state.db.fetch as typeof fetch }) };
});
vi.mock("@/lib/supabase/env", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    get isSupabaseServiceConfigured() {
      return state.svc;
    },
  };
});
vi.mock("@/lib/notifications/push", () => ({
  isPushConfigured: () => state.pushOn,
  sendPushToAll: async (p: { title: string; body: string; url?: string; tag?: string }) => {
    state.pushes.push(p);
    return state.pushCount;
  },
}));
vi.mock("@/lib/orders/staff-alert-email", () => ({
  sendStaffAlertEmail: async (p: { subject: string; html: string; to: string[] }) => {
    state.emails.push(p);
    return state.emailOk ? { ok: true, recipients: p.to.length } : { ok: false, detail: "provider returned 500", didTimeout: false };
  },
}));
vi.mock("@/lib/ai/crawler-client", () => ({ isCrawlerConfigured: () => state.crawler }));
vi.mock("@/lib/pos/cultivera-fetch-client", () => ({
  isValidRunId: (id: string) => /^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(id),
  getPosRun: async (id: string) => {
    if (state.runThrows) throw new Error(state.runThrows);
    return state.runs.get(id) ?? null;
  },
}));

function freshDb(): FakePostgrest {
  const db = new FakePostgrest();
  db.uniques.push({ table: "compliance_reminder_log", columns: ["dedupe_key"], name: "compliance_reminder_log_dedupe_key_key" });
  db.defaults.set("compliance_reminder_log", () => ({ sent_at: new Date(NOW).toISOString() }));
  return db;
}

function startHarvest(minutesAgo = 60, id = RID) {
  state.db.rows("audit_logs").push({
    id: state.db.rows("audit_logs").length + 1,
    action: "cultivera_pos.fetch_started",
    entity_type: "cultivera_pos_run",
    entity_id: id,
    created_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  });
}

function harvest(st: Record<string, unknown>, active = false, id = RID) {
  state.runs.set(id, { runId: id, active, state: st });
}

const log = () => state.db.rows("compliance_reminder_log");

beforeEach(() => {
  state.db = freshDb();
  state.svc = true;
  state.crawler = true;
  state.pushOn = true;
  state.pushCount = 1;
  state.emailOk = true;
  state.emails = [];
  state.pushes = [];
  state.runs = new Map();
  state.runThrows = null;
  state.redirects = [];
  state.audits = [];
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("ORDER_EMAIL_FROM", "Greenway <alerts@x.com>");
  vi.stubEnv("ORDER_STAFF_EMAILS", "owner@x.com, mgr@x.com");
  vi.stubEnv("CULTIVERA_POS_BUDGET_SECONDS", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://shop.example.com");
});

async function tick() {
  const { runCutoverWatchTick } = await import("@/lib/pos/cutover-watch");
  return runCutoverWatchTick(NOW);
}

describe("R50 A4 · the pure planner is wired and pinned", () => {
  it("self-tests pass at the pinned count, and the runner pins the same floor", async () => {
    const { __runCutoverWatchCoreTests } = await import("@/lib/pos/cutover-watch-core");
    expect(__runCutoverWatchCoreTests()).toEqual({ passed: 37, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("cutover-watch-core", __runCutoverWatchCoreTests(), 37)');
  });
});

describe("R50 A4 · claim before send", () => {
  it("a failed harvest: one email + one phone push, logged with what delivered", async () => {
    startHarvest();
    harvest({ status: "failed", error: "login <b>401</b>", finishedAt: "2026-10-31T15:30:00Z" });
    const r = await tick();
    expect(r).toMatchObject({ ok: true, planned: 1, sent: 1, alreadyClaimed: 0, undelivered: 0 });
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0].to).toEqual(["owner@x.com", "mgr@x.com"]);
    expect(state.emails[0].html).toContain("\u0026lt;b\u0026gt;401");
    expect(state.emails[0].html).not.toContain("<b>401");
    expect(state.emails[0].html).toContain(`href="https://shop.example.com/admin/menu-imports/fetch/${RID}"`);
    expect(state.emails[0].html).toContain("Open the harvest");
    expect(state.pushes).toHaveLength(1);
    expect(state.pushes[0].body).toContain("login <b>401</b>"); // a notification is plain text, not HTML
    expect(state.pushes[0].url).toBe(`/admin/menu-imports/fetch/${RID}`);
    expect(log()).toHaveLength(1);
    expect(log()[0]).toMatchObject({
      dedupe_key: `cutover:harvest-failed:${RID}:2026-10-31T15:30:00Z`,
      stage: "cutover_watch",
      channel: "email+push",
      recipients: "owner@x.com, mgr@x.com, 1 push device(s)",
    });
  });

  it("the next tick sends nothing for the same failure", async () => {
    startHarvest();
    harvest({ status: "failed", error: "x", finishedAt: "2026-10-31T15:30:00Z" });
    await tick();
    const r2 = await tick();
    expect(r2).toMatchObject({ planned: 1, sent: 0, alreadyClaimed: 1 });
    expect(state.emails).toHaveLength(1);
    expect(state.pushes).toHaveLength(1);
  });

  it("two overlapping ticks send it exactly once (the unique key is the lock)", async () => {
    startHarvest();
    harvest({ status: "failed", error: "x", finishedAt: "2026-10-31T15:30:00Z" });
    const [a, b] = await Promise.all([tick(), tick()]);
    expect(a.sent + b.sent).toBe(1);
    expect(a.alreadyClaimed + b.alreadyClaimed).toBe(1);
    expect(state.emails).toHaveLength(1);
    expect(log()).toHaveLength(1);
  });

  it("a resumed harvest that fails again is a NEW alert", async () => {
    startHarvest();
    harvest({ status: "failed", error: "x", finishedAt: "2026-10-31T15:30:00Z" });
    await tick();
    harvest({ status: "failed", error: "y", finishedAt: "2026-10-31T15:55:00Z" });
    const r = await tick();
    expect(r.sent).toBe(1);
    expect(log()).toHaveLength(2);
  });

  it("no channel configured: nothing claimed, so the alert fires once a channel exists", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    state.pushOn = false;
    startHarvest();
    harvest({ status: "failed", error: "x", finishedAt: "f" });
    const r = await tick();
    expect(r).toMatchObject({ planned: 1, sent: 0, unsentNoChannel: 1 });
    expect(log()).toHaveLength(0);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const r2 = await tick();
    expect(r2.sent).toBe(1);
    expect(log()[0].channel).toBe("email");
  });

  it("push only: logged as push, no email attempted", async () => {
    vi.stubEnv("ORDER_STAFF_EMAILS", "");
    startHarvest();
    harvest({ status: "done", seconds: 600 });
    const r = await tick();
    expect(r.sent).toBe(1);
    expect(state.emails).toHaveLength(0);
    expect(log()[0]).toMatchObject({ channel: "push", recipients: "1 push device(s)" });
  });

  it("every channel failing: marked NOT DELIVERED and not resent every 5 minutes", async () => {
    state.emailOk = false;
    state.pushCount = 0;
    startHarvest();
    harvest({ status: "failed", error: "x", finishedAt: "f" });
    const r = await tick();
    expect(r).toMatchObject({ sent: 0, undelivered: 1 });
    expect(r.notes.join(" ")).toContain("provider returned 500");
    expect(log()[0].recipients).toBe("NOT DELIVERED - every channel failed");
    const r2 = await tick();
    expect(r2.alreadyClaimed).toBe(1);
    expect(state.emails).toHaveLength(1);
  });

  it("a claim the database refuses (not a duplicate) sends nothing and reports not ok", async () => {
    state.db.missing.add("compliance_reminder_log");
    startHarvest();
    harvest({ status: "failed", error: "x", finishedAt: "f" });
    const r = await tick();
    expect(r.ok).toBe(false);
    expect(r.sent).toBe(0);
    expect(state.emails).toHaveLength(0);
    expect(state.pushes).toHaveLength(0);
  });
});

describe("R50 A4 · what is watched", () => {
  it("the crawler unreachable: one warning per run", async () => {
    startHarvest();
    state.runThrows = "fetch failed";
    const r = await tick();
    expect(r.sent).toBe(1);
    expect(log()[0].dedupe_key).toBe(`cutover:harvest-unreachable:${RID}`);
  });

  it("a harvest started more than 6 hours ago is not checked", async () => {
    startHarvest(6 * 60 + 1);
    harvest({ status: "failed", error: "x", finishedAt: "f" });
    expect((await tick()).planned).toBe(0);
  });

  it("other audit actions are ignored", async () => {
    state.db.rows("audit_logs").push({ id: 9, action: "cultivera_pos.fetch_cancelled", entity_id: RID, created_at: new Date(NOW - 60_000).toISOString() });
    harvest({ status: "failed", error: "x", finishedAt: "f" });
    expect((await tick()).planned).toBe(0);
  });

  it("running past budget + 15 min warns; the site budget env is honoured", async () => {
    startHarvest(50);
    harvest({ status: "running", startedAt: new Date(NOW - 50 * 60_000).toISOString() }, true);
    expect((await tick()).planned).toBe(1); // 50 >= 30 + 15
    state.db = freshDb();
    startHarvest(50);
    vi.stubEnv("CULTIVERA_POS_BUDGET_SECONDS", "3600");
    expect((await tick()).planned).toBe(0); // 50 < 60 + 15
  });

  it("crawler not configured: harvests not checked, said in the notes", async () => {
    state.crawler = false;
    startHarvest();
    const r = await tick();
    expect(r.planned).toBe(0);
    expect(r.notes.join(" ")).toContain("crawler not configured");
  });

  it("a failed import alerts once; staged / published imports and old failures are quiet", async () => {
    const imp = state.db.rows("pos_imports");
    imp.push({ id: "imp-1", status: "failed", is_test: true, error_message: "bad sheet", started_at: null, completed_at: null, created_at: new Date(NOW - 3_600_000).toISOString() });
    imp.push({ id: "imp-2", status: "staged", is_test: false, error_message: null, started_at: null, completed_at: null, created_at: new Date(NOW - 60_000).toISOString() });
    imp.push({ id: "imp-3", status: "failed", is_test: false, error_message: "old", started_at: null, completed_at: null, created_at: new Date(NOW - 25 * 3_600_000).toISOString() });
    const r = await tick();
    expect(r.sent).toBe(1);
    expect(log()[0].dedupe_key).toBe("cutover:import-failed:imp-1");
    expect(String(log()[0].subject)).toContain("(test mode)");
  });

  it("an unreadable audit log is a 500-style tick that sends nothing", async () => {
    state.db.missing.add("audit_logs");
    const r = await tick();
    expect(r.ok).toBe(false);
    expect(state.emails).toHaveLength(0);
  });

  it("an idle tick writes nothing", async () => {
    const r = await tick();
    expect(r).toMatchObject({ ok: true, planned: 0, sent: 0 });
    expect(state.db.log.filter((q) => q.method !== "GET")).toHaveLength(0);
  });
});

describe("R50 A4 · the test button and the runbook panel", () => {
  it("Send a test alert: delivered, logged under the test stage, listed on the page", async () => {
    const { sendCutoverTestAlertAction } = await import("@/app/admin/menu-imports/actions");
    await expect(sendCutoverTestAlertAction()).rejects.toThrow(/REDIRECT:.*notice=Test%20alert%20sent/);
    expect(state.emails).toHaveLength(1);
    expect(log()[0]).toMatchObject({ stage: "cutover_watch_test", channel: "email+push" });
    expect(state.audits).toHaveLength(1);
    const { readRecentWatchAlerts } = await import("@/lib/pos/cutover-watch");
    const recent = await readRecentWatchAlerts();
    expect(recent.error).toBeNull();
    expect(recent.rows).toHaveLength(1);
    expect(recent.rows[0].dedupe_key.startsWith("cutover:test:")).toBe(true);
    expect(recent.rows[0].view).toMatchObject({ tone: "ok", isTest: true, what: "Test alert" });
  });

  it("Send a test alert with no channel: says so instead of pretending", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    state.pushOn = false;
    const { sendCutoverTestAlertAction } = await import("@/app/admin/menu-imports/actions");
    await expect(sendCutoverTestAlertAction()).rejects.toThrow(/REDIRECT:.*error=No%20alert%20channel/);
    expect(log()).toHaveLength(0);
  });

  it("the alert list never shows other reminders", async () => {
    log().push({ id: "x", dedupe_key: "sunday_due:W-1", stage: "sunday_due", channel: "email", subject: "s", recipients: "r", sent_at: new Date(NOW).toISOString() });
    const { readRecentWatchAlerts } = await import("@/lib/pos/cutover-watch");
    expect((await readRecentWatchAlerts()).rows).toHaveLength(0);
  });

  it("the runbook page shows channels, the test button and the sent log", () => {
    const src = read("src/app/admin/menu-imports/cutover/page.tsx");
    for (const id of ["cutover-alerts", "cutover-alerts-channels", "cutover-alerts-test", "cutover-alerts-log"]) expect(src).toContain(`data-testid="${id}"`);
    expect(src).toContain("sendCutoverTestAlertAction");
    expect(src).toContain("WATCH_TEXT_NOTE");
    const act = read("src/app/admin/menu-imports/actions.ts");
    const fn = act.slice(act.indexOf("export async function sendCutoverTestAlertAction"));
    expect(fn).toContain('requirePermission("menu.import")');
  });
});

describe("R50 A4 · cron wiring (AGENTS rule 12)", () => {
  it("vercel.json runs it every 5 minutes", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons.find((c) => c.path === "/api/cron/cutover-watch")?.schedule).toBe("*/5 * * * *");
  });

  it("the route uses the fail-closed preamble and the watcher", () => {
    const src = read("src/app/api/cron/cutover-watch/route.ts");
    expect(src).toContain("shouldRefuseWhenSecretMissing(secret)");
    expect(src).toContain("header === `Bearer ${secret}`");
    expect(src).toContain("{ status: 503 }");
    expect(src).toContain("runCutoverWatchTick()");
    expect(src).toContain("export async function POST");
  });

  it("the route refuses a wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { GET } = await import("@/app/api/cron/cutover-watch/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest("http://x/api/cron/cutover-watch", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
    expect(state.db.log).toHaveLength(0);
    const ok = await GET(new NextRequest("http://x/api/cron/cutover-watch", { headers: { authorization: "Bearer s3cret" } }));
    expect(ok.status).toBe(200);
  });
});
