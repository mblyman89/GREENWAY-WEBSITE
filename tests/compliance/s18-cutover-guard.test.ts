/**
 * tests/compliance/s18-cutover-guard.test.ts
 *
 * S18 - Cutover runbook + guard: publish Cultivera first, then receive
 * (bible S18, findings F-041, F-074, F-076, F-088).
 *
 *   1. pure core: flag, blocker rule (is_test excluded, bible S18.8), the one
 *      publish verdict, release plan, retire rules, pending list, copy - exact
 *      self-test count, plus the S18.4 copy verbatim.
 *   2. bible S18.5 "Guard unit test with mocked query": the REAL
 *      cutover-guard.ts through the REAL postgrest client on a fake network -
 *      exact filters, named columns, bounded limits, fail-open on errors,
 *      flag off = zero requests.
 *   3. rebuild + retire: writes guarded to never-published rows in the allowed
 *      statuses; a published rebuild writes nothing (the RPC already archived).
 *   4. wiring pins: the staging hold (decided before the insert, event,
 *      reason, returns before auto-publish), intake-store copy, runner,
 *      ledger/.env, runbook doc and the Menu Imports links (S18.6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  CUTOVER_BLOCKER_READ_MAX,
  CUTOVER_EVENT,
  CUTOVER_GUARD_ENV,
  CUTOVER_HOLD_COPY,
  CUTOVER_OUTCOME,
  CUTOVER_RELEASE_MAX,
  CUTOVER_RETIRED_PREFIX,
  CUTOVER_RUNBOOK_DOC,
  CUTOVER_RUNBOOK_HREF,
  CUTOVER_RUNBOOK_STEPS,
  HELD_READ_MAX,
  HELD_ROW_SELECT,
  TARGET_SELECT,
  blockingCultivera,
  cutoverDone,
  cutoverGuardEnabled,
  decidePublish,
  manifestsToRelease,
  pendingRebuilds,
  rebuildNote,
  refuseUpload,
  releaseNote,
  retiredSummary,
  retireStatuses,
  shouldRetireHeld,
  __runCutoverGuardTests,
} from "@/lib/inventory/cutover-guard-core";
import {
  describeIntakeVersion,
  initialPublishOutcome,
  __runIntakeVersionCopyCoreTests,
} from "@/lib/pos/intake-version-copy-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const M1 = "aaaaaaaa-1111-4111-8111-111111111111";
const M2 = "bbbbbbbb-2222-4222-8222-222222222222";
const squash = (s: string) => s.replace(/\s/g, "");

// -- Fake network for the REAL postgrest client -------------------------------
const net = vi.hoisted(() => ({
  reqs: [] as Array<{ method: string; url: URL; body: unknown; headers: Headers }>,
  replies: [] as Array<
    (r: { method: string; url: URL; body: unknown }) => { status: number; body: unknown; headers?: Record<string, string> }
  >,
  throws: false,
  audits: [] as Array<{ action: string; entityId: string; after: unknown }>,
  stage: [] as Array<{ staged: boolean; published: boolean; versionId: string | null; reason?: string } | "throw">,
  staged: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: string; after: unknown }) => {
    net.audits.push({ action: a.action, entityId: a.entityId, after: a.after });
  },
}));
vi.mock("@/lib/pos/intake-menu-staging", () => ({
  stageIntakeMenuVersionForManifest: async (manifestId: string, actorId: string | null) => {
    net.staged.push(`${manifestId}:${actorId}`);
    const next = net.stage.shift() ?? { staged: false, published: false, versionId: null, reason: "none" };
    if (next === "throw") throw new Error("staging blew up");
    return next;
  },
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const raw = typeof init?.body === "string" ? init.body : null;
    const r = { method: init?.method ?? "GET", url, body: raw ? JSON.parse(raw) : null, headers: new Headers(init?.headers) };
    net.reqs.push(r);
    const next = net.replies.shift();
    const rep = next ? next(r) : { status: 200, body: [] };
    const body = r.method === "HEAD" ? null : JSON.stringify(rep.body);
    return new Response(body, { status: rep.status, headers: { "content-type": "application/json", ...(rep.headers ?? {}) } });
  };
  return {
    createSupabaseAdminClient: () => {
      if (net.throws) throw new Error("env missing");
      return new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch });
    },
  };
});

beforeEach(() => {
  net.reqs.length = 0;
  net.replies = [];
  net.throws = false;
  net.audits = [];
  net.stage = [];
  net.staged = [];
  vi.stubEnv(CUTOVER_GUARD_ENV, "on");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const q = (i: number) => net.reqs[i].url.searchParams;
const ok = (body: unknown) => () => ({ status: 200, body });
const fail = () => () => ({ status: 500, body: { message: "down" } });
const heldRow = (over: Record<string, unknown> = {}) => ({
  id: "h1",
  import_id: null,
  status: "staged",
  created_at: "2026-01-02T00:00:00Z",
  origin: "intake",
  state: CUTOVER_OUTCOME,
  manifest_id: M1,
  reason: null,
  ...over,
});

// === 1. Pure core =============================================================
describe("S18 pure core", () => {
  it("self-tests pass with an exact count (a deleted check turns this red)", () => {
    expect(__runCutoverGuardTests().passed).toBe(85);
  });
  it("the version-copy core self-tests pass with an exact count (S18 added 7)", () => {
    const r = __runIntakeVersionCopyCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(87); // R27-1: +29 (withheld count, published-with-withheld copy, kept-off list, publish-ready)
  });
  it("the hold copy is bible S18.4 verbatim; event and outcome are bible S18.2", () => {
    expect(CUTOVER_HOLD_COPY).toBe(
      "Your one-time Cultivera menu is uploaded but not published yet. Publish it under Menu Imports first \u2014 then every receiving update publishes itself on top of it.",
    );
    expect(CUTOVER_EVENT).toBe("menu_publish_held_for_cutover");
    expect(CUTOVER_OUTCOME).toBe("held_for_cutover");
  });
  it("flag: on unless an off-word (house pattern)", () => {
    expect(CUTOVER_GUARD_ENV).toBe("INTAKE_CUTOVER_GUARD");
    expect(cutoverGuardEnabled(undefined)).toBe(true);
    expect(cutoverGuardEnabled("")).toBe(true);
    for (const w of ["off", "0", "false", "no", "disabled", " OFF "]) expect(cutoverGuardEnabled(w)).toBe(false);
    expect(cutoverGuardEnabled("on")).toBe(true);
  });
  it("bible S18.8: a test-mode import never blocks; only staged real imports do", () => {
    expect(blockingCultivera([{ id: "c1", import_id: "i1", status: "staged", is_test: true }])).toBeNull();
    expect(blockingCultivera([{ id: "c1", import_id: "i1", status: "published", is_test: false }])).toBeNull();
    expect(blockingCultivera([{ id: "c1", import_id: null, status: "staged", is_test: false }])).toBeNull();
    expect(blockingCultivera([{ id: "c1", import_id: "i1", status: "staged", is_test: false }])).toEqual({ versionIds: ["c1"] });
  });
  it("the one publish verdict covers every branch", () => {
    const b = { versionIds: ["c1"] };
    expect(decidePublish("c1", b, null)).toEqual({ kind: "allow", release: true });
    expect(decidePublish("x", b, null)).toEqual({ kind: "refuse" });
    expect(decidePublish("h1", null, heldRow())).toEqual({ kind: "rebuild", manifestId: M1 });
    expect(decidePublish("h1", null, heldRow({ manifest_id: M1.toUpperCase() }))).toEqual({ kind: "rebuild", manifestId: M1 });
    expect(decidePublish("h1", null, heldRow({ manifest_id: "not-a-uuid" }))).toEqual({ kind: "allow", release: false });
    // fail-open: unknown reads never refuse, never rebuild
    expect(decidePublish("x", "unknown", "unknown")).toEqual({ kind: "allow", release: false });
    expect(decidePublish("h1", "unknown", heldRow())).toEqual({ kind: "rebuild", manifestId: M1 });
    // order: while Cultivera waits even a held snapshot is refused (publish Cultivera first)
    expect(decidePublish("h1", b, heldRow())).toEqual({ kind: "refuse" });
  });
  it("release plan: distinct UUID manifests, capped, with the held ids to retire", () => {
    const p = manifestsToRelease([heldRow(), heldRow({ id: "h2" }), heldRow({ id: "h3", manifest_id: M2 })], 1);
    expect(p).toEqual({ manifests: [M1], heldIds: { [M1]: ["h1", "h2"] }, overflow: 1 });
    expect(CUTOVER_RELEASE_MAX).toBe(10);
  });
  it("retire rules: published = no write; waiting = staged only; nothing-new = staged or archived", () => {
    expect(shouldRetireHeld({ staged: true, published: true })).toBe(false);
    expect(shouldRetireHeld({ staged: true, published: false })).toBe(true);
    expect(shouldRetireHeld({ staged: false, published: false, reason: "no-new-items" })).toBe(true);
    expect(shouldRetireHeld({ staged: false, published: false, reason: "exception" })).toBe(false);
    expect(retireStatuses({ staged: true })).toEqual(["staged"]);
    expect(retireStatuses({ staged: false })).toEqual(["staged", "archived"]);
    const s = retiredSummary({ archived_reason: "superseded_by:x", k: 1 }, null, "T");
    expect(s).toEqual({ k: 1, archived_reason_before: "superseded_by:x", archived_reason: CUTOVER_RETIRED_PREFIX + "no-changes", archived_at: "T" });
  });
  it("pending list: newest intake row per delivery, still held, never published or retired", () => {
    const older = heldRow({ id: "old", created_at: "2026-01-01T00:00:00Z", state: "published_auto" });
    expect(pendingRebuilds([older, heldRow()])).toEqual([{ manifestId: M1, versionId: "h1", status: "staged" }]);
    expect(pendingRebuilds([heldRow(), heldRow({ id: "new", created_at: "2026-01-03T00:00:00Z", state: "published_auto" })])).toEqual([]);
    expect(pendingRebuilds([heldRow({ reason: CUTOVER_RETIRED_PREFIX + "v9", status: "archived" })])).toEqual([]);
    expect(pendingRebuilds([heldRow({ status: "archived", reason: "superseded_by:c1" })])).toEqual([
      { manifestId: M1, versionId: "h1", status: "archived" },
    ]);
  });
  it("one-time refusal: only real uploads, only once cutover is proven", () => {
    expect(cutoverDone("2026-01-01T00:00:00Z", 1)).toBe(true);
    expect(cutoverDone("2026-01-01T00:00:00Z", 0)).toBe(false);
    expect(cutoverDone(null, 5)).toBe(false);
    expect(cutoverDone("garbage", 5)).toBe(false);
    expect(refuseUpload(false, true)).toBe(true);
    expect(refuseUpload(true, true)).toBe(false);
    expect(refuseUpload(false, false)).toBe(false);
  });
  it("notes tell the truth: green only when something was published", () => {
    expect(rebuildNote({ staged: true, published: true }).ok).toBe(true);
    expect(rebuildNote({ staged: true, published: false }).ok).toBe(false);
    expect(rebuildNote({ staged: false, published: false, reason: "no-new-items" }).text).toMatch(/^Nothing to rebuild/);
    expect(releaseNote(2, 1, 0)).toBe("Cultivera menu published. Rebuilt 2 held receiving updates on top of it; 1 published automatically.");
    expect(releaseNote(1, 1, 3)).toMatch(/3 more deliveries are still held/);
  });
  it("the in-app runbook is short (8 steps) and publishes Cultivera BEFORE receiving starts", () => {
    expect(CUTOVER_RUNBOOK_STEPS).toHaveLength(8);
    const titles = CUTOVER_RUNBOOK_STEPS.map((s) => s.title);
    const pub = titles.findIndex((t) => /Publish the Cultivera upload/.test(t));
    const recv = titles.findIndex((t) => /Start receiving/.test(t));
    expect(pub).toBe(3);
    expect(recv).toBe(6);
    expect(pub).toBeLessThan(recv);
  });
  it("intake copy: a held update starts life as held_for_cutover; a fact hold wins", () => {
    expect(initialPublishOutcome(0, "T", { cutover: true })).toMatchObject({ state: CUTOVER_OUTCOME });
    expect(initialPublishOutcome(2, "T", { cutover: true }).state).not.toBe(CUTOVER_OUTCOME);
    expect(initialPublishOutcome(0, "T").state).not.toBe(CUTOVER_OUTCOME);
  });
  it("intake copy: the waiting card repeats the S18.4 copy and points at Menu Imports", () => {
    const d = describeIntakeVersion({
      status: "staged",
      published_at: null,
      created_at: "2026-01-01T00:00:00Z",
      summary_json: { origin: "intake", publish_outcome: { state: CUTOVER_OUTCOME, at: "2026-01-01T00:00:00Z" } },
    });
    expect(d.tone).toBe("waiting");
    expect(d.headline).toBe("Waiting: publish the Cultivera menu first");
    expect(d.detail).toBe(CUTOVER_HOLD_COPY);
    expect(d.action).toMatch(/Publish the Cultivera upload under Menu Imports/);
  });
});

// === 2. The guard's queries (bible S18.5, mocked query) =======================
describe("S18.5 guard unit test - the REAL module on a fake network", () => {
  it("blocker read: named columns, the exact three filters, newest first, bounded", async () => {
    const { readCultiveraBlocker } = await import("@/lib/pos/cutover-guard");
    net.replies = [ok([{ id: "c1", import_id: "i1", status: "staged", is_test: false }])];
    await expect(readCultiveraBlocker()).resolves.toEqual({ versionIds: ["c1"] });
    expect(net.reqs).toHaveLength(1);
    expect(net.reqs[0].method).toBe("GET");
    expect(net.reqs[0].url.pathname).toBe("/rest/v1/menu_versions");
    expect(q(0).get("select")).toBe("id,import_id,status,is_test");
    expect(q(0).get("import_id")).toBe("not.is.null");
    expect(q(0).get("status")).toBe("eq.staged");
    expect(q(0).get("is_test")).toBe("eq.false");
    expect(q(0).get("order")).toBe("created_at.desc");
    expect(q(0).get("limit")).toBe(String(CUTOVER_BLOCKER_READ_MAX));
    expect(CUTOVER_BLOCKER_READ_MAX).toBe(10);
  });
  it("guard holds while a real Cultivera version is staged (S18.6)", async () => {
    const { shouldHoldForCutover } = await import("@/lib/pos/cutover-guard");
    net.replies = [ok([{ id: "c1", import_id: "i1", status: "staged", is_test: false }])];
    await expect(shouldHoldForCutover()).resolves.toBe(true);
  });
  it("S18.8: a test-mode row (even if a loosened query let it through) never holds", async () => {
    const { shouldHoldForCutover } = await import("@/lib/pos/cutover-guard");
    net.replies = [ok([{ id: "c1", import_id: "i1", status: "staged", is_test: true }])];
    await expect(shouldHoldForCutover()).resolves.toBe(false);
  });
  it("nothing staged: no hold", async () => {
    const { shouldHoldForCutover } = await import("@/lib/pos/cutover-guard");
    net.replies = [ok([])];
    await expect(shouldHoldForCutover()).resolves.toBe(false);
  });
  it("fail-open: a 500 or a missing client is 'unknown' and never holds", async () => {
    const { readCultiveraBlocker, shouldHoldForCutover } = await import("@/lib/pos/cutover-guard");
    net.replies = [fail()];
    await expect(readCultiveraBlocker()).resolves.toBe("unknown");
    net.replies = [fail()];
    await expect(shouldHoldForCutover()).resolves.toBe(false);
    net.throws = true;
    await expect(readCultiveraBlocker()).resolves.toBe("unknown");
    await expect(shouldHoldForCutover()).resolves.toBe(false);
  });
  it("rollback (S18.7): flag off = zero requests, no hold, plain allow, never 'done'", async () => {
    const g = await import("@/lib/pos/cutover-guard");
    for (const w of ["off", "0", "false", "no", "disabled"]) {
      vi.stubEnv(CUTOVER_GUARD_ENV, w);
      expect(g.cutoverGuardOn()).toBe(false);
      await expect(g.shouldHoldForCutover()).resolves.toBe(false);
      await expect(g.decideHandPublish("c1")).resolves.toEqual({ kind: "allow", release: false });
      await expect(g.readCutoverDone()).resolves.toBe(false);
      await expect(g.readCutoverStatus()).resolves.toEqual({ enabled: false, blocking: null, done: false, pending: [] });
    }
    expect(net.reqs).toHaveLength(0);
  });
  it("unset flag = on (the ledger default)", async () => {
    const g = await import("@/lib/pos/cutover-guard");
    vi.stubEnv(CUTOVER_GUARD_ENV, undefined as unknown as string);
    delete process.env[CUTOVER_GUARD_ENV];
    expect(g.cutoverGuardOn()).toBe(true);
  });
  it("decideHandPublish: two bounded reads (blocker + target by id, named columns) -> the pure verdict", async () => {
    const { decideHandPublish } = await import("@/lib/pos/cutover-guard");
    net.replies = [
      (r) => (r.url.searchParams.get("id") ? { status: 200, body: [heldRow()] } : { status: 200, body: [] }),
      (r) => (r.url.searchParams.get("id") ? { status: 200, body: [heldRow()] } : { status: 200, body: [] }),
    ];
    await expect(decideHandPublish("h1")).resolves.toEqual({ kind: "rebuild", manifestId: M1 });
    expect(net.reqs).toHaveLength(2);
    const t = net.reqs.find((r) => r.url.searchParams.get("id"))!;
    expect(t.url.searchParams.get("id")).toBe("eq.h1");
    expect(t.url.searchParams.get("select")).toBe(squash(TARGET_SELECT));
    expect(TARGET_SELECT).toBe(HELD_ROW_SELECT);
    // the literal, so a dropped column cannot hide behind the constant
    expect(HELD_ROW_SELECT).toBe(
      "id, import_id, status, created_at, origin:summary_json->>origin, state:summary_json->publish_outcome->>state, manifest_id:summary_json->>manifest_id, reason:summary_json->>archived_reason",
    );
  });
  it("decideHandPublish: this IS the staged upload -> allow + release; another one -> refuse", async () => {
    const { decideHandPublish } = await import("@/lib/pos/cutover-guard");
    const blocker = (r: { url: URL }) =>
      r.url.searchParams.get("id") ? { status: 200, body: [] } : { status: 200, body: [{ id: "c1", import_id: "i1", status: "staged", is_test: false }] };
    net.replies = [blocker, blocker];
    await expect(decideHandPublish("c1")).resolves.toEqual({ kind: "allow", release: true });
    net.replies = [blocker, blocker];
    await expect(decideHandPublish("other")).resolves.toEqual({ kind: "refuse" });
  });
  it("decideHandPublish: both reads failing = allow (never lock the owner out)", async () => {
    const { decideHandPublish } = await import("@/lib/pos/cutover-guard");
    net.replies = [fail(), fail()];
    await expect(decideHandPublish("x")).resolves.toEqual({ kind: "allow", release: false });
  });
  it("held read (before release): intake rows only, staged, oldest first, bounded, named columns", async () => {
    const { readHeldBeforeRelease } = await import("@/lib/pos/cutover-guard");
    net.replies = [ok([heldRow(), heldRow({ id: "h2", manifest_id: M2 })])];
    await expect(readHeldBeforeRelease()).resolves.toEqual({ manifests: [M1, M2], heldIds: { [M1]: ["h1"], [M2]: ["h2"] }, overflow: 0 });
    expect(q(0).get("select")).toBe(squash(HELD_ROW_SELECT));
    expect(q(0).get("import_id")).toBe("is.null");
    expect(q(0).get("status")).toBe("eq.staged");
    expect(q(0).get("order")).toBe("created_at.asc");
    expect(q(0).get("limit")).toBe(String(HELD_READ_MAX));
    net.replies = [fail()];
    await expect(readHeldBeforeRelease()).resolves.toEqual({ manifests: [], heldIds: {}, overflow: 0 });
  });
  it("cutover-done: latest REAL published upload, then a head-only count of receiving publishes after it", async () => {
    const { readCutoverDone } = await import("@/lib/pos/cutover-guard");
    const at = "2026-02-01T10:00:00.000Z";
    net.replies = [ok([{ id: "c1", published_at: at }]), () => ({ status: 200, body: null, headers: { "content-range": "*/2" } })];
    await expect(readCutoverDone()).resolves.toBe(true);
    expect(net.reqs).toHaveLength(2);
    expect(q(0).get("select")).toBe("id,published_at");
    expect(q(0).get("import_id")).toBe("not.is.null");
    expect(q(0).get("is_test")).toBe("eq.false");
    expect(q(0).get("published_at")).toBe("not.is.null");
    expect(q(0).get("order")).toBe("published_at.desc");
    expect(q(0).get("limit")).toBe("1");
    expect(net.reqs[1].method).toBe("HEAD");
    expect(net.reqs[1].headers.get("prefer") ?? "").toContain("count=exact");
    expect(q(1).get("select")).toBe("id");
    expect(q(1).get("import_id")).toBe("is.null");
    expect(q(1).get("is_test")).toBe("eq.false");
    expect(q(1).get("published_at")).toBe(`gt.${at}`);
  });
  it("cutover-done: zero publishes after, no real upload ever published, or any error = not done", async () => {
    const { readCutoverDone } = await import("@/lib/pos/cutover-guard");
    net.replies = [ok([{ id: "c1", published_at: "2026-02-01T10:00:00Z" }]), () => ({ status: 200, body: null, headers: { "content-range": "*/0" } })];
    await expect(readCutoverDone()).resolves.toBe(false);
    net.reqs.length = 0;
    net.replies = [ok([])];
    await expect(readCutoverDone()).resolves.toBe(false);
    expect(net.reqs).toHaveLength(1); // no count read without an upload
    net.replies = [ok([{ id: "c1", published_at: "2026-02-01T10:00:00Z" }]), fail()];
    await expect(readCutoverDone()).resolves.toBe(false);
    net.replies = [fail()];
    await expect(readCutoverDone()).resolves.toBe(false);
  });
  it("status: pending read is every intake row of any status, newest first, bounded", async () => {
    const { readCutoverStatus } = await import("@/lib/pos/cutover-guard");
    net.replies = [
      (r) => {
        const p = r.url.searchParams;
        if (p.get("is_test") === "eq.false" && p.get("status") === "eq.staged") return { status: 200, body: [] };
        if (p.get("select") === squash(HELD_ROW_SELECT)) return { status: 200, body: [heldRow()] };
        return { status: 200, body: [] };
      },
    ];
    net.replies.push(net.replies[0], net.replies[0], net.replies[0]);
    const s = await readCutoverStatus();
    expect(s).toEqual({ enabled: true, blocking: null, done: false, pending: [{ manifestId: M1, versionId: "h1", status: "staged" }] });
    const pend = net.reqs.find((r) => r.url.searchParams.get("select") === squash(HELD_ROW_SELECT))!;
    expect(pend.url.searchParams.get("import_id")).toBe("is.null");
    expect(pend.url.searchParams.has("status")).toBe(false);
    expect(pend.url.searchParams.get("order")).toBe("created_at.desc");
    expect(pend.url.searchParams.get("limit")).toBe(String(HELD_READ_MAX));
  });
});

// === 3. Rebuild + retire ======================================================
describe("S18 rebuild + retire (never touches a live or published row)", () => {
  it("published rebuild: stages once, writes NOTHING (the RPC already archived the old row)", async () => {
    const { rebuildDelivery } = await import("@/lib/pos/cutover-guard");
    net.stage = [{ staged: true, published: true, versionId: "v9" }];
    await expect(rebuildDelivery(M1, ["h1"], "u1")).resolves.toEqual({ staged: true, published: true, versionId: "v9" });
    expect(net.staged).toEqual([`${M1}:u1`]);
    expect(net.reqs).toHaveLength(0);
  });
  it("waiting rebuild: retires each held row, guarded to still-staged + never-published", async () => {
    const { rebuildDelivery } = await import("@/lib/pos/cutover-guard");
    net.stage = [{ staged: true, published: false, versionId: "v9", reason: "held-for-fact-review" }];
    net.replies = [ok([{ id: "h1", summary_json: { origin: "intake", k: 1 } }]), ok([])];
    await rebuildDelivery(M1, ["h1"], "u1");
    expect(net.reqs.map((r) => r.method)).toEqual(["GET", "PATCH"]);
    for (const i of [0, 1]) {
      expect(q(i).get("id")).toBe("eq.h1");
      expect(q(i).get("status")).toBe("in.(staged)");
      expect(q(i).get("published_at")).toBe("is.null");
    }
    expect(q(0).get("select")).toBe("id,summary_json");
    const body = net.reqs[1].body as { status: string; summary_json: Record<string, unknown>; updated_at: string };
    expect(body.status).toBe("archived");
    expect(typeof body.updated_at).toBe("string");
    expect(body.summary_json).toMatchObject({ origin: "intake", k: 1, archived_reason: CUTOVER_RETIRED_PREFIX + "v9" });
  });
  it("nothing-new rebuild: may also retire an already-archived leftover (drops off the list)", async () => {
    const { rebuildDelivery } = await import("@/lib/pos/cutover-guard");
    net.stage = [{ staged: false, published: false, versionId: null, reason: "no-new-items" }];
    net.replies = [ok([{ id: "h1", summary_json: { archived_reason: "superseded_by:c1" } }]), ok([])];
    await rebuildDelivery(M1, ["h1"], null);
    expect(q(0).get("status")).toBe("in.(staged,archived)");
    expect(q(1).get("status")).toBe("in.(staged,archived)");
    const body = net.reqs[1].body as { summary_json: Record<string, unknown> };
    expect(body.summary_json).toMatchObject({ archived_reason_before: "superseded_by:c1", archived_reason: CUTOVER_RETIRED_PREFIX + "no-changes" });
  });
  it("row gone (a publish won the race): read finds nothing, no write", async () => {
    const { rebuildDelivery } = await import("@/lib/pos/cutover-guard");
    net.stage = [{ staged: true, published: false, versionId: "v9" }];
    net.replies = [ok([])];
    await rebuildDelivery(M1, ["h1"], "u1");
    expect(net.reqs.map((r) => r.method)).toEqual(["GET"]);
  });
  it("failed rebuild: the held row stays (a retry can rebuild it); a throw never escapes", async () => {
    const { rebuildDelivery } = await import("@/lib/pos/cutover-guard");
    net.stage = [{ staged: false, published: false, versionId: null, reason: "exception" }];
    await rebuildDelivery(M1, ["h1"], "u1");
    net.stage = ["throw"];
    await expect(rebuildDelivery(M1, ["h1"], "u1")).resolves.toEqual({ staged: false, published: false, versionId: null, reason: "exception" });
    expect(net.reqs).toHaveLength(0);
  });
  it("release passes each delivery's OWN held ids to the retire (a waiting rebuild retires exactly those)", async () => {
    const { releaseHeldAfterCutover } = await import("@/lib/pos/cutover-guard");
    net.stage = [{ staged: true, published: false, versionId: "v1" }];
    net.replies = [ok([{ id: "h7", summary_json: {} }]), ok([])];
    await releaseHeldAfterCutover({ manifests: [M1], heldIds: { [M1]: ["h7"] }, overflow: 0 }, "u1", null, "c1");
    expect(net.reqs.map((r) => `${r.method}:${r.url.searchParams.get("id")}`)).toEqual(["GET:eq.h7", "PATCH:eq.h7"]);
  });
  it("release: rebuilds each planned delivery in order, one audit line, honest note", async () => {
    const { releaseHeldAfterCutover } = await import("@/lib/pos/cutover-guard");
    net.stage = [
      { staged: true, published: true, versionId: "v1" },
      { staged: false, published: false, versionId: null, reason: "exception" },
    ];
    const note = await releaseHeldAfterCutover({ manifests: [M1, M2], heldIds: { [M1]: ["h1"], [M2]: ["h2"] }, overflow: 4 }, "u1", "m@x", "c1");
    expect(net.staged).toEqual([`${M1}:u1`, `${M2}:u1`]);
    expect(note).toBe(releaseNote(1, 1, 4));
    expect(net.audits).toEqual([
      { action: "menu_version.cutover_released", entityId: "c1", after: { deliveries: 2, restaged: 1, published: 1, overflow: 4 } },
    ]);
  });
});

// === 4. Wiring pins ===========================================================
describe("S18 wiring", () => {
  const staging = read("src/lib/pos/intake-menu-staging.ts");
  it("staging decides the hold BEFORE the insert, only when no fact hold applies", () => {
    const hold = staging.indexOf("const cutoverHold = factFlags.length === 0 && (await shouldHoldForCutover());");
    // R27 pin update (on purpose): the insert also records how many products
    // were withheld, so the call spans lines; the order rule is unchanged.
    const insert = staging.indexOf("publish_outcome: initialPublishOutcome(factFlags.length, new Date().toISOString(), {\n            cutover: cutoverHold,\n            withheld: withheldFlags.length,\n          }),");
    expect(hold).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(hold);
  });
  it("the hold writes the S18.2 event, returns the reason, and returns BEFORE auto-publish", () => {
    const start = staging.indexOf("if (cutoverHold) {");
    const auto = staging.indexOf("const publishedOk = await autoPublishIntakeVersion(");
    expect(start).toBeGreaterThan(-1);
    expect(auto).toBeGreaterThan(start);
    const slice = staging.slice(start, auto);
    expect(slice).toContain('.from("manifest_events").insert(');
    expect(slice).toContain("event_type: CUTOVER_EVENT,");
    expect(slice).toContain("note: CUTOVER_HOLD_COPY,");
    expect(slice).toContain("published: false,");
    expect(slice).toContain("reason: CUTOVER_REASON,");
    expect(slice).toMatch(/return \{/);
    expect(slice).not.toContain('.from("menu_versions")');
    // the fact hold still comes first
    expect(staging.indexOf("if (factFlags.length > 0)")).toBeLessThan(start);
  });
  it("the event insert is fail-soft (a timeline hiccup never loses the staged update)", () => {
    const slice = staging.slice(staging.indexOf("if (cutoverHold) {"), staging.indexOf("const publishedOk = await autoPublishIntakeVersion("));
    expect(slice.indexOf("try {")).toBeLessThan(slice.indexOf("event_type: CUTOVER_EVENT"));
    expect(slice).toContain("} catch (err) {");
  });
  it("rebuild imports staging dynamically (no circular import at module load)", () => {
    const g = read("src/lib/pos/cutover-guard.ts");
    expect(g).toContain('await import("@/lib/pos/intake-menu-staging")');
    expect(g).not.toMatch(/^import .*intake-menu-staging/m);
    expect(g).toContain("process.env[CUTOVER_GUARD_ENV]");
  });
  it("the approve screen tells the owner why the update is waiting", () => {
    const s = read("src/lib/inventory/intake-store.ts");
    expect(s).toContain("carry.reason === CUTOVER_REASON");
    expect(s).toContain("${CUTOVER_HOLD_COPY}");
  });
  it("the pure self-tests are registered in the runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runCutoverGuardTests } from "../../src/lib/inventory/cutover-guard-core";');
    expect(runner).toMatch(/\n\s+__runCutoverGuardTests\(\);/);
  });
  it("flag is in the env ledger and .env.example", () => {
    expect(read("docs/INTAKE_PIPELINE_ENV_LEDGER.md")).toContain("`INTAKE_CUTOVER_GUARD`");
    expect(read(".env.example")).toMatch(/^# INTAKE_CUTOVER_GUARD=on$/m);
  });
});

describe("S18.6 acceptance: runbook exists and is linked from Menu Imports", () => {
  it("the runbook doc exists and follows bible S18.2's order: upload -> review -> publish -> verify lots -> receive", () => {
    expect(CUTOVER_RUNBOOK_DOC).toBe("docs/CULTIVERA_CUTOVER_RUNBOOK.md");
    expect(existsSync(join(ROOT, CUTOVER_RUNBOOK_DOC))).toBe(true);
    const doc = read(CUTOVER_RUNBOOK_DOC);
    const order = ["**Upload PRODUCTS.xlsx", "**Resolve the fact review**", "**Publish the upload**", "lot", "**Start receiving.**"].map((s) =>
      doc.indexOf(s, doc.indexOf("## The runbook")),
    );
    for (const i of order) expect(i).toBeGreaterThan(-1);
    for (let k = 1; k < order.length; k++) expect(order[k]).toBeGreaterThan(order[k - 1]);
    expect(doc).toContain("## If products were approved before the Cultivera publish"); // S18.2 / F-074
    expect(doc).toContain("## Legacy, import-only surfaces (F-088)");
    expect(doc).toContain("## Rollback");
    expect(doc).toContain("INTAKE_CUTOVER_GUARD");
  });
  it("Menu Imports links the in-app runbook (help panel + upload section)", () => {
    const page = read("src/app/admin/menu-imports/page.tsx");
    expect(CUTOVER_RUNBOOK_HREF).toBe("/admin/menu-imports/cutover");
    expect(page).toContain('import { CUTOVER_RUNBOOK_HREF } from "@/lib/inventory/cutover-guard-core";');
    expect(page.match(/<Link href=\{CUTOVER_RUNBOOK_HREF\}/g) ?? []).toHaveLength(2);
    expect(page).toContain("Follow the Cultivera cutover runbook");
    expect(page).toContain("Read the Cultivera cutover runbook");
    expect(existsSync(join(ROOT, "src/app/admin/menu-imports/cutover/page.tsx"))).toBe(true);
  });
  it("the runbook page is gated, dynamic, lists pending rebuilds and names the doc", () => {
    const p = read("src/app/admin/menu-imports/cutover/page.tsx");
    expect(p).toContain('requirePermission("menu.import")');
    expect(p).toContain('export const dynamic = "force-dynamic";');
    expect(p).toContain("readCutoverStatus()");
    expect(p).toContain("rebuildCutoverDeliveryAction");
    expect(p).toContain("CUTOVER_RUNBOOK_STEPS");
    expect(p).toContain("CUTOVER_RUNBOOK_DOC");
  });
});

// === 5. Testing the tests =====================================================
describe("S18 test-the-tests", () => {
  it("the fake network really records filters (a query without is_test would be caught)", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    await createSupabaseAdminClient().from("menu_versions").select("id").eq("status", "staged");
    expect(q(0).has("is_test")).toBe(false);
    expect(q(0).get("status")).toBe("eq.staged");
  });
  it("the default reply is an empty list, so an unexpected extra read cannot fake a blocker", async () => {
    const { readCultiveraBlocker } = await import("@/lib/pos/cutover-guard");
    await expect(readCultiveraBlocker()).resolves.toBeNull();
  });
  it("the self-test counter is live: a broken core would throw, not silently pass", () => {
    expect(() => {
      const r = __runCutoverGuardTests();
      if (r.passed !== 85) throw new Error("count moved");
    }).not.toThrow();
  });
});
