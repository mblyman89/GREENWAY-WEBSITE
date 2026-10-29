/**
 * R74 S13: rebuilt Cultivera manifests start onboarding automatically.
 * Owner (round 1): "the new manifests we recreate from the originals need to move automatically
 * into onboarding, every manifest should be seen and workable on the onboarding page."
 * Owner (round 8): "Please begin working on the four remaining pieces to build" (piece 1).
 *
 * The run loop is exercised against a small fake Supabase client (site_settings with a real
 * compare-and-swap on updated_at, inbound_manifests, catalog_product_drafts) and a fake Start.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/inventory/cultivera-onboarding", () => ({
  startCultiveraManifestOnboarding: vi.fn(async () => ({ ok: false, error: "the real Start must not run in tests" })),
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

import {
  AUTO_START_CRON_BUDGET_MS,
  AUTO_START_KEY,
  AUTO_START_PRESS_BUDGET_MS,
  __runCultiveraAutoStartCoreTests,
  parseAutoStartState,
  type AutoStartOutcome,
} from "@/lib/inventory/cultivera-auto-start-core";
import {
  armCultiveraAutoStart,
  loadAutoStartStatus,
  pauseCultiveraAutoStart,
  readAutoStart,
  runCultiveraAutoStart,
} from "@/lib/inventory/cultivera-auto-start";
import { RECONSTRUCTED_MANIFEST_KIND } from "@/lib/inventory/cultivera-manifest-group-core";

const IMP = "aaaaaaaa-0000-4000-8000-000000000001";
const IMP2 = "bbbbbbbb-0000-4000-8000-000000000002";
const M = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

type Manifest = { id: string; manifest_number: string; kind: string; import_id: string };
type Draft = { id: string; manifest_id: string };
type Db = {
  settings: { value_json: unknown; updated_at: string } | null;
  manifests: Manifest[];
  drafts: Draft[];
  clock: number;
  fail?: { settingsRead?: boolean; manifests?: boolean; drafts?: boolean; update?: boolean };
  /** Called before every site_settings update lands (to simulate a concurrent writer). */
  beforeUpdate?: () => void;
  /** Called right after a site_settings update lands (to simulate a writer between two steps). */
  afterUpdate?: () => void;
  writes: number;
};

function fakeAdmin(db: Db) {
  const tick = () => new Date(Date.UTC(2026, 9, 25, 12, 0, 0) + ++db.clock).toISOString();
  const from = (table: string) => {
    const eqs: [string, unknown][] = [];
    const ins: [string, unknown[]][] = [];
    let range: [number, number] | null = null;
    let patch: Record<string, unknown> | null = null;
    const q = {
      select() {
        return q;
      },
      eq(col: string, v: unknown) {
        eqs.push([col, v]);
        return q;
      },
      in(col: string, v: unknown[]) {
        ins.push([col, v]);
        return q;
      },
      order() {
        return q;
      },
      range(a: number, b: number) {
        range = [a, b];
        return q;
      },
      update(p: Record<string, unknown>) {
        patch = p;
        return q;
      },
      insert(row: { value_json: unknown }) {
        if (db.settings) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
        db.settings = { value_json: JSON.parse(JSON.stringify(row.value_json)), updated_at: tick() };
        db.writes += 1;
        return Promise.resolve({ error: null });
      },
      maybeSingle() {
        if (db.fail?.settingsRead) return Promise.resolve({ data: null, error: { message: "settings down" } });
        return Promise.resolve({ data: db.settings ? JSON.parse(JSON.stringify(db.settings)) : null, error: null });
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        const done = (v: unknown) => Promise.resolve(v).then(res, rej);
        if (table === "site_settings" && patch) {
          if (db.fail?.update) return done({ data: null, error: { message: "update failed" } });
          db.beforeUpdate?.();
          const want = eqs.find(([c]) => c === "updated_at")?.[1];
          if (!db.settings || db.settings.updated_at !== want) return done({ data: [], error: null });
          db.settings = { value_json: JSON.parse(JSON.stringify(patch.value_json)), updated_at: tick() };
          db.writes += 1;
          db.afterUpdate?.();
          return done({ data: [{ key: AUTO_START_KEY }], error: null });
        }
        if (table === "inbound_manifests") {
          if (db.fail?.manifests) return done({ data: null, error: { message: "manifests down" } });
          const kind = eqs.find(([c]) => c === "raw_payload->>kind")?.[1];
          const imps = ins.find(([c]) => c === "raw_payload->>import_id")?.[1] ?? [];
          const rows = db.manifests
            .filter((m) => m.kind === kind && imps.includes(m.import_id))
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((m) => ({ id: m.id, manifest_number: m.manifest_number, import_id: m.import_id }));
          const [a, b] = range ?? [0, rows.length];
          return done({ data: rows.slice(a, b + 1), error: null });
        }
        if (table === "catalog_product_drafts") {
          if (db.fail?.drafts) return done({ data: null, error: { message: "drafts down" } });
          const ids = ins.find(([c]) => c === "manifest_id")?.[1] ?? [];
          const rows = db.drafts.filter((d) => ids.includes(d.manifest_id));
          const [a, b] = range ?? [0, rows.length];
          return done({ data: rows.slice(a, b + 1), error: null });
        }
        return done({ data: null, error: { message: `unexpected table ${table}` } });
      },
    };
    return q;
  };
  return { from } as unknown as NonNullable<NonNullable<Parameters<typeof runCultiveraAutoStart>[0]>["admin"]>;
}

function makeDb(n: number, opts: { started?: number[]; otherImport?: number[] } = {}): Db {
  const manifests: Manifest[] = [];
  for (let i = 1; i <= n; i += 1) manifests.push({ id: M(i), manifest_number: `CV-${i}`, kind: RECONSTRUCTED_MANIFEST_KIND, import_id: opts.otherImport?.includes(i) ? IMP2 : IMP });
  manifests.push({ id: M(99), manifest_number: "NATIVE", kind: "wcia", import_id: IMP });
  const drafts = (opts.started ?? []).map((i) => ({ id: `d-${i}`, manifest_id: M(i) }));
  return { settings: null, manifests, drafts, clock: 0, writes: 0 };
}

/** A fake Start that seeds `seeded` drafts on the manifest (as the real one does). */
function starter(db: Db, opts: { failOn?: string[]; seedNothingOn?: string[]; spendMs?: number; clock?: { t: number }; onStart?: (id: string) => void } = {}) {
  const calls: string[] = [];
  const fn = async (id: string): Promise<AutoStartOutcome> => {
    calls.push(id);
    opts.onStart?.(id);
    if (opts.clock) opts.clock.t += opts.spendMs ?? 0;
    if (opts.failOn?.includes(id)) return { ok: false, error: "lab certificate read failed" };
    if (opts.seedNothingOn?.includes(id)) return { ok: true, seeded: 0 };
    db.drafts.push({ id: `d-${id}-1`, manifest_id: id }, { id: `d-${id}-2`, manifest_id: id });
    return { ok: true, seeded: 2 };
  };
  return { fn, calls };
}

const T0 = Date.parse("2026-10-25T12:00:00Z");

describe("R74 S13 auto-start core", () => {
  it("pure core passes its self-tests (measured 57)", () => {
    const r = __runCultiveraAutoStartCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(57);
  });
  it("the worker's budget plus the lease slack fits the 800 s worker; a press fits the 300 s page", () => {
    expect(AUTO_START_PRESS_BUDGET_MS).toBe(200_000);
    expect(AUTO_START_CRON_BUDGET_MS).toBe(600_000);
  });
});

describe("R74 S13 run loop", () => {
  it("does nothing until an Apply arms it (idle), then starts every not-started manifest of that import", async () => {
    const db = makeDb(4, { started: [2] });
    const admin = fakeAdmin(db);
    const s = starter(db);
    const idle = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "t1" });
    expect(idle).toMatchObject({ ok: true, skipped: "idle" });
    expect(s.calls).toEqual([]);

    await armCultiveraAutoStart(IMP, "u1", { admin });
    const r = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "t1" });
    expect(r.ok && r.run).toMatchObject({ ran: 3, started: 3, seeded: 6, failed: 0, remaining: 0, stoppedBy: "done" });
    // M(2) already had onboarding rows; the native manifest M(99) is never touched.
    expect(s.calls).toEqual([M(1), M(3), M(4)]);
    const st = (await readAutoStart(admin)).state;
    expect(st.done).toBe(true);
    expect(st.leaseToken).toBeNull();
    expect(st.started).toBe(3);
    expect(st.lastNote).toContain("Every rebuilt manifest has now been started");
    // A finished pass is not re-run by the worker.
    const again = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0 + 60_000, token: "t2" });
    expect(again).toMatchObject({ ok: true, skipped: "finished" });
    expect(s.calls).toHaveLength(3);
  });

  it("only the armed import's manifests are started", async () => {
    const db = makeDb(4, { otherImport: [3, 4] });
    const admin = fakeAdmin(db);
    const s = starter(db);
    await armCultiveraAutoStart(IMP, null, { admin });
    await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "t" });
    expect(s.calls).toEqual([M(1), M(2)]);
    await armCultiveraAutoStart(IMP2, null, { admin });
    await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "t" });
    expect(s.calls).toEqual([M(1), M(2), M(3), M(4)]);
  });

  it("stops at the budget, saves the cursor after every manifest, and the next run resumes", async () => {
    const db = makeDb(5);
    const admin = fakeAdmin(db);
    const clock = { t: T0 };
    const s = starter(db, { clock, spendMs: 70_000 });
    await armCultiveraAutoStart(IMP, null, { admin });
    const r1 = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => clock.t, token: "a", budgetMs: 200_000 });
    // 200 s budget, 75 s must be left to start one: starts at 0 s and 70 s, stops at 140 s.
    expect(r1.ok && r1.run).toMatchObject({ ran: 2, remaining: 3, stoppedBy: "budget" });
    let st = (await readAutoStart(admin)).state;
    expect(st.cursor).toBe(M(2));
    expect(st.done).toBe(false);
    expect(st.leaseToken).toBeNull();
    expect(st.lastNote).toContain("3 left");
    const r2 = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => clock.t, token: "b", budgetMs: 600_000 });
    expect(r2.ok && r2.run).toMatchObject({ ran: 3, remaining: 0, stoppedBy: "done" });
    expect(s.calls).toEqual([M(1), M(2), M(3), M(4), M(5)]);
    st = (await readAutoStart(admin)).state;
    expect(st.started).toBe(5);
    expect(st.done).toBe(true);
  });

  it("a failed Start is counted and named, passed once (never looped), and the pass says so", async () => {
    const db = makeDb(3);
    const admin = fakeAdmin(db);
    const s = starter(db, { failOn: [M(2)] });
    await armCultiveraAutoStart(IMP, null, { admin });
    const r = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "t" });
    expect(r.ok && r.run).toMatchObject({ ran: 3, started: 2, failed: 1, stoppedBy: "done" });
    const st = (await readAutoStart(admin)).state;
    expect(st.errors).toEqual(["CV-2: lab certificate read failed"]);
    expect(st.done).toBe(true);
    const view = await loadAutoStartStatus(IMP, { admin, nowMs: T0 });
    expect(view.ok && view.tone).toBe("warn");
    expect(view.ok && view.remaining).toBe(1);
    expect(view.ok && view.text).toContain("Press Start again");
    expect(view.ok && view.errors).toEqual(["CV-2: lab certificate read failed"]);
  });

  it("a Start that throws is caught, counted, and the pass carries on", async () => {
    const db = makeDb(2);
    const admin = fakeAdmin(db);
    await armCultiveraAutoStart(IMP, null, { admin });
    const calls: string[] = [];
    const r = await runCultiveraAutoStart({
      admin,
      now: () => T0,
      token: "t",
      startOne: async (id) => {
        calls.push(id);
        if (id === M(1)) throw new Error("socket hang up");
        return { ok: true, seeded: 1 };
      },
    });
    expect(calls).toEqual([M(1), M(2)]);
    expect(r.ok && r.run).toMatchObject({ started: 1, failed: 1 });
    expect((await readAutoStart(admin)).state.errors[0]).toBe("CV-1: socket hang up");
  });

  it("a live lease makes a second run stand down; an expired lease (killed run) is overtaken", async () => {
    const db = makeDb(2);
    const admin = fakeAdmin(db);
    const s = starter(db);
    await armCultiveraAutoStart(IMP, null, { admin });
    const cur = (await readAutoStart(admin)).state;
    db.settings = { value_json: { ...cur, leaseToken: "other", leaseUntil: new Date(T0 + 60_000).toISOString() }, updated_at: "x" };
    const r = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "me" });
    expect(r).toMatchObject({ ok: true, skipped: "leased" });
    expect(s.calls).toEqual([]);
    const later = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0 + 61_000, token: "me" });
    expect(later.ok && later.run?.started).toBe(2);
  });

  it("losing the lease compare-and-swap (someone wrote first) starts nothing", async () => {
    const db = makeDb(2);
    const admin = fakeAdmin(db);
    const s = starter(db);
    await armCultiveraAutoStart(IMP, null, { admin });
    let once = true;
    db.beforeUpdate = () => {
      if (once && db.settings) {
        once = false;
        db.settings = { ...db.settings, updated_at: "changed-by-someone-else" };
      }
    };
    const r = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "me" });
    expect(r).toMatchObject({ ok: true, skipped: "leased" });
    expect(s.calls).toEqual([]);
  });

  it("a lease taken over between two manifests stops the run before the next Start (checked before every manifest)", async () => {
    const db = makeDb(4);
    const admin = fakeAdmin(db);
    const s = starter(db);
    await armCultiveraAutoStart(IMP, null, { admin });
    let stolen = false;
    db.afterUpdate = () => {
      const v = db.settings?.value_json as { cursor?: string | null } | undefined;
      if (!stolen && db.settings && v?.cursor === M(1)) {
        stolen = true;
        db.settings = { value_json: { ...(db.settings.value_json as object), leaseToken: "other-run", leaseUntil: "2099-01-01T00:00:00.000Z" }, updated_at: "stolen" };
      }
    };
    const r = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "me" });
    expect(stolen).toBe(true);
    expect(s.calls).toEqual([M(1)]);
    expect(r.ok && r.run?.stoppedBy).toBe("lost_lease");
    expect(r.ok && r.run?.started).toBe(1);
  });

  it("Pause stops the run after the manifest it is on; Start now (re-arm) resumes from the start of the not-started list", async () => {
    const db = makeDb(4);
    const admin = fakeAdmin(db);
    await armCultiveraAutoStart(IMP, null, { admin });
    let paused = false;
    const s = starter(db, {
      onStart: (id) => {
        if (id === M(2) && !paused) {
          paused = true;
          void pauseCultiveraAutoStart(null, { admin });
        }
      },
    });
    const r = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "t" });
    expect(s.calls).toEqual([M(1), M(2)]);
    expect(r.ok && r.run?.stoppedBy).toBe("paused_or_rearmed");
    let st = (await readAutoStart(admin)).state;
    expect(st.paused).toBe(true);
    expect(st.leaseToken).toBeNull();
    expect(await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "w" })).toMatchObject({ skipped: "paused" });
    await armCultiveraAutoStart(IMP, null, { admin });
    await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "t2" });
    // M(2)'s outcome was not recorded (the pass was paused), but it seeded rows, so it is not redone.
    expect(s.calls).toEqual([M(1), M(2), M(3), M(4)]);
    st = (await readAutoStart(admin)).state;
    expect(st.done).toBe(true);
  });

  it("an unreadable manifest list or draft count stops the run loudly and starts nothing", async () => {
    for (const fail of [{ manifests: true }, { drafts: true }]) {
      const db = makeDb(2);
      const admin = fakeAdmin(db);
      const s = starter(db);
      await armCultiveraAutoStart(IMP, null, { admin });
      db.fail = fail;
      const r = await runCultiveraAutoStart({ admin, startOne: s.fn, now: () => T0, token: "t" });
      expect(r.ok).toBe(false);
      expect(s.calls).toEqual([]);
      db.fail = {};
      const st = (await readAutoStart(admin)).state;
      expect(st.leaseToken).toBeNull();
      expect(st.lastNote).toMatch(/^Stopped: The (rebuilt manifests could not be read|onboarding rows could not be counted)/);
      expect(st.done).toBe(false);
    }
  });

  it("an unreadable state is an error, never 'nothing to do'", async () => {
    const db = makeDb(1);
    db.fail = { settingsRead: true };
    const admin = fakeAdmin(db);
    const r = await runCultiveraAutoStart({ admin, now: () => T0, token: "t" });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("could not be read") });
    const v = await loadAutoStartStatus(IMP, { admin, nowMs: T0 });
    expect(v.ok).toBe(false);
  });

  it("status: not queued shows the not-started count; an unreadable count is said so, never 0", async () => {
    const db = makeDb(3, { started: [1] });
    const admin = fakeAdmin(db);
    const v = await loadAutoStartStatus(IMP, { admin, nowMs: T0 });
    expect(v.ok && v.armed).toBe(false);
    expect(v.ok && v.remaining).toBe(2);
    expect(v.ok && v.text).toContain("2 rebuilt manifest(s) have no onboarding rows yet");
    db.fail = { drafts: true };
    const u = await loadAutoStartStatus(IMP, { admin, nowMs: T0 });
    expect(u.ok && u.remaining).toBeNull();
    expect(u.ok && u.text).toContain("could not be read");
  });

  it("the saved row is exactly the core's state shape (parse round-trips)", async () => {
    const db = makeDb(1);
    const admin = fakeAdmin(db);
    await armCultiveraAutoStart(IMP, "u9", { admin, nowIso: "2026-10-25T11:00:00.000Z" });
    const raw = db.settings!.value_json;
    expect(parseAutoStartState(raw)).toEqual(raw);
    expect(raw).toMatchObject({ importIds: [IMP], armedBy: "u9", armedAt: "2026-10-25T11:00:00.000Z", generation: 1 });
  });
});

describe("R74 S13 wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("both Apply actions arm the automatic start only on success, and say so when arming fails", () => {
    for (const p of ["src/app/admin/menu-imports/rehome-actions.ts", "src/app/admin/menu-imports/mail-apply-actions.ts"]) {
      const s = read(p);
      expect(s).toContain("if (r.ok) {");
      expect(s).toContain("await armCultiveraAutoStart(importId, session.userId);");
      expect(s).toContain("failed = true;");
      expect(s).toContain("could not be queued");
    }
  });
  it("the auto-start actions require inventory.manage and never read process.env", () => {
    const s = read("src/app/admin/menu-imports/auto-start-actions.ts");
    expect(s.match(/requirePermission\("inventory\.manage"\)/g)).toHaveLength(2);
    expect(s).not.toMatch(/process\.env/);
  });
  it("the every-minute lookup worker runs it only on a tick with no lookup work; no new cron", () => {
    const s = read("src/app/api/cron/lookup-jobs/route.ts");
    expect(s).toContain("if (result.ok && result.skipped) {");
    expect(s).toContain('runCultiveraAutoStart({ budgetMs: AUTO_START_CRON_BUDGET_MS, trigger: "worker" })');
    const v = JSON.parse(read("vercel.json")) as { crons: unknown[] };
    expect(v.crons).toHaveLength(17); // 17 since Fix Phase 3.2a (G-17) added /api/cron/inbound-reconcile; this worker still added none
  });
  it("the rebuild and coverage pages show the panel once each; the store is server-only and never touches stock", () => {
    expect(read("src/app/admin/menu-imports/[id]/manifests/page.tsx").match(/<CultiveraAutoStartPanel /g)).toHaveLength(1);
    expect(read("src/app/admin/menu-imports/[id]/coverage/page.tsx").match(/<CultiveraAutoStartPanel /g)).toHaveLength(1);
    const store = read("src/lib/inventory/cultivera-auto-start.ts");
    expect(store).toContain('import "server-only"');
    expect(store).not.toMatch(/inventory_lots|on_hand_qty|menu_versions/);
    expect(store).toContain('.eq("updated_at", snap.updatedAt)');
  });
});
