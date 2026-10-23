/**
 * R74 S20: "Read everything in the background" (owner round 10).
 * Owner: "ideally, I would like to run it at night before bed, then wake up to all of them having
 * been read ... is there a way to click it, and it just runs in the background until all are done?"
 *
 * The store with a fake site_settings table (compare-and-swap on updated_at) and the fake read I/O:
 *   - armed + worker runs read everything, run after run, until Finished;
 *   - one run at a time (lease), a doubled tick reads nothing;
 *   - Pause stops new documents at once (in-flight ones finish), and the run's counts never
 *     leak into a later pass;
 *   - a LlamaParse SERVICE outage holds the document stored (never the text layer unattended)
 *     and three failed runs in a row pause it with the reason;
 *   - an unreadable state is an error, never "nothing to do";
 *   - wiring: the worker route (no new cron), the actions, the page.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

const core = await import("@/lib/pos/cultivera-mail-read-bg-core");
const bg = await import("@/lib/pos/cultivera-mail-read-bg");
const store = await import("@/lib/pos/cultivera-mail-read-store");
type ReadIo = import("@/lib/pos/cultivera-mail-read-store").ReadIo;
type Admin = NonNullable<NonNullable<Parameters<typeof bg.runMailReadBg>[0]>["admin"]>;

const read = (p: string) => readFileSync(p, "utf8");
const LCB_TEXT = read("tests/compliance/fixtures/pdf-manifest-sample.txt");
const enc = (s: string) => new TextEncoder().encode(s);

/* ---------------- fake site_settings (CAS on updated_at) ---------------- */

type Db = { row: { value_json: unknown; updated_at: string } | null; n: number; failRead?: boolean; onUpdate?: () => void };

function fakeAdmin(db: Db): Admin {
  const tick = () => `2026-10-20T00:00:${String(db.n++).padStart(2, "0")}.000Z`;
  const from = (table: string) => {
    if (table !== "site_settings") throw new Error(`unexpected table ${table}`);
    const eqs: [string, unknown][] = [];
    let patch: { value_json: unknown } | null = null;
    const q = {
      select() {
        return q;
      },
      eq(c: string, v: unknown) {
        eqs.push([c, v]);
        return q;
      },
      update(p: { value_json: unknown }) {
        patch = p;
        return q;
      },
      insert(row: { value_json: unknown }) {
        if (db.row) return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
        db.row = { value_json: JSON.parse(JSON.stringify(row.value_json)), updated_at: tick() };
        return Promise.resolve({ error: null });
      },
      maybeSingle() {
        if (db.failRead) return Promise.resolve({ data: null, error: { message: "settings down" } });
        return Promise.resolve({ data: db.row ? JSON.parse(JSON.stringify(db.row)) : null, error: null });
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        const done = (v: unknown) => Promise.resolve(v).then(res, rej);
        if (!patch) return done({ data: null, error: { message: "no patch" } });
        db.onUpdate?.();
        const want = eqs.find(([c]) => c === "updated_at")?.[1];
        if (!db.row || db.row.updated_at !== want) return done({ data: [], error: null });
        db.row = { value_json: JSON.parse(JSON.stringify(patch.value_json)), updated_at: tick() };
        return done({ data: [{ key: core.MAIL_READ_BG_KEY }], error: null });
      },
    };
    return q;
  };
  return { from } as unknown as Admin;
}

const stateOf = (db: Db) => core.parseMailReadBg(db.row?.value_json ?? null);

/* ---------------- fake read I/O ---------------- */

type Row = { id: string; kind: string; filename: string; storage_key: string; status: string };

function docsIo(n: number, opts: { llama?: "down" | "ok"; perRead?: () => void } = {}) {
  const rows: Row[] = Array.from({ length: n }, (_, i) => ({ id: `d${i}`, kind: "pdf", filename: `d${i}.pdf`, storage_key: `mail-harvest/d${i}.pdf`, status: "stored" }));
  const seen = { started: 0 };
  const io: ReadIo = {
    countStored: async () => rows.filter((r) => r.status === "stored").length,
    listStored: async (limit) => rows.filter((r) => r.status === "stored").slice(0, limit),
    download: async () => {
      seen.started += 1;
      return enc("%PDF");
    },
    readLayer: async () => LCB_TEXT,
    readPdf: async () => {
      opts.perRead?.();
      await new Promise((r) => setTimeout(r, 1));
      if (opts.llama === "down") throw new store.LlamaUnavailable("LlamaParse upload 503");
      return { text: LCB_TEXT, engine: "llamaparse", note: null };
    },
    workbook: async () => [],
    update: async (id) => {
      const r = rows.find((x) => x.id === id)!;
      if (r.status !== "stored") return false;
      r.status = "parsed";
      return true;
    },
    now: () => 0,
  };
  return { io, rows, seen };
}

const T0 = Date.parse("2026-10-20T03:00:00Z");

describe("R74 S20 pure core", () => {
  it("self-tests pass at the pinned count and are registered with their floor", () => {
    expect(core.__runCultiveraMailReadBgCoreTests()).toEqual({ passed: 43, failed: 0 });
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain("__runCultiveraMailReadBgCoreTests()");
    expect(src).toMatch(/cultivera-mail-read-bg-core: .*expected >= 43/);
  });
});

describe("R74 S20 background runs", () => {
  it("not armed: a worker tick reads nothing (one settings read)", async () => {
    const db: Db = { row: null, n: 0 };
    const d = docsIo(5);
    const r = await bg.runMailReadBg({ admin: fakeAdmin(db), io: d.io, now: () => T0, token: "t" });
    expect(r).toMatchObject({ ok: true, skipped: "idle" });
    expect(d.seen.started).toBe(0);
    expect(db.row).toBeNull();
  });

  it("armed: worker runs read everything, run after run, until Finished", async () => {
    const db: Db = { row: null, n: 0 };
    const admin = fakeAdmin(db);
    await bg.armMailReadBg("u1", { admin, nowIso: new Date(T0).toISOString() });
    const d = docsIo(23);
    const r1 = await bg.runMailReadBg({ admin, io: d.io, now: () => T0, token: "t1", trigger: "worker" });
    expect(r1.ok && r1.result?.read).toBe(23);
    const s = stateOf(db);
    expect(s).toMatchObject({ armed: true, done: true, runs: 1, read: 23, parsed: 23, llamaparse: 23, left: 0, leaseToken: null, failedRuns: 0 });
    const again = await bg.runMailReadBg({ admin, io: d.io, now: () => T0 + 60_000, token: "t2" });
    expect(again).toMatchObject({ ok: true, skipped: "finished" });
  });

  it("one background run reads past a press's 100-document cap (up to MAIL_READ_BG_MAX_DOCS)", async () => {
    expect(core.MAIL_READ_BG_MAX_DOCS).toBe(400);
    const db: Db = { row: null, n: 0 };
    const admin = fakeAdmin(db);
    await bg.armMailReadBg(null, { admin });
    const d = docsIo(130);
    const r = await bg.runMailReadBg({ admin, io: d.io, now: () => T0, token: "big" });
    expect(r.ok && r.result!.read).toBe(130);
    expect(stateOf(db)).toMatchObject({ done: true, read: 130, left: 0 });
    // A press (no maxDocs) still stops at its own cap.
    const p = docsIo(130);
    const press = await store.runReadBatch(p.io, {});
    expect(press.read).toBe(100);
  });

  it("the budget ends a run, the next run carries on where the queue is", async () => {
    const db: Db = { row: null, n: 0 };
    const admin = fakeAdmin(db);
    await bg.armMailReadBg(null, { admin });
    const d = docsIo(12);
    let clock = 0;
    d.io.now = () => clock;
    const slow = { ...d.io, readPdf: async (b: Uint8Array, doc: Parameters<ReadIo["readPdf"]>[1]) => { clock += 100; return d.io.readPdf(b, doc); } };
    const r1 = await bg.runMailReadBg({ admin, io: slow, now: () => T0, token: "a", budgetMs: 150 });
    expect(r1.ok && r1.result!.read).toBeGreaterThan(0);
    expect(r1.ok && r1.result!.left).toBeGreaterThan(0);
    expect(stateOf(db)).toMatchObject({ done: false, failedRuns: 0, leaseToken: null });
    clock = 0;
    const r2 = await bg.runMailReadBg({ admin, io: d.io, now: () => T0 + 60_000, token: "b" });
    expect(r2.ok && r2.result!.left).toBe(0);
    expect(stateOf(db)).toMatchObject({ done: true, runs: 2, read: 12 });
  });

  it("one run at a time: a tick during a live lease reads nothing", async () => {
    const db: Db = { row: null, n: 0 };
    const admin = fakeAdmin(db);
    await bg.armMailReadBg(null, { admin });
    const s = core.takeMailReadBgLease(stateOf(db), "other", T0, core.MAIL_READ_BG_BUDGET_MS);
    db.row = { value_json: s, updated_at: "x" };
    const d = docsIo(5);
    const r = await bg.runMailReadBg({ admin, io: d.io, now: () => T0 + 1000, token: "me" });
    expect(r).toMatchObject({ ok: true, skipped: "leased" });
    expect(d.seen.started).toBe(0);
    // and once the lease ran out (800 s), the next tick works
    const r2 = await bg.runMailReadBg({ admin, io: d.io, now: () => T0 + 800_001, token: "me" });
    expect(r2.ok && r2.result!.read).toBe(5);
  });

  it("Pause stops new documents at once; in-flight ones are written; counts do not leak", async () => {
    const db: Db = { row: null, n: 0 };
    const admin = fakeAdmin(db);
    await bg.armMailReadBg(null, { admin });
    let reads = 0;
    const d = docsIo(40, {
      perRead: () => {
        reads += 1;
        if (reads === 3) void bg.pauseMailReadBgNow("u2", { admin });
      },
    });
    const r = await bg.runMailReadBg({ admin, io: d.io, now: () => T0, token: "p" });
    expect(r.ok && r.result!.stoppedBecause).toMatch(/paused or restarted by a person/);
    expect(r.ok && r.result!.read).toBeLessThan(15);
    expect(d.rows.filter((x) => x.status === "parsed").length).toBe(r.ok ? r.result!.read : -1);
    const s = stateOf(db);
    expect(s).toMatchObject({ paused: true, pausedBy: "person", leaseToken: null, runs: 0, read: 0 });
    const tick = await bg.runMailReadBg({ admin, io: d.io, now: () => T0 + 60_000, token: "q" });
    expect(tick).toMatchObject({ ok: true, skipped: "paused" });
  });

  it("LlamaParse down: the document stays stored, the run says so, three runs in a row pause it with the reason", async () => {
    const db: Db = { row: null, n: 0 };
    const admin = fakeAdmin(db);
    await bg.armMailReadBg(null, { admin });
    const d = docsIo(8, { llama: "down" });
    for (let i = 0; i < 3; i += 1) {
      const r = await bg.runMailReadBg({ admin, io: d.io, now: () => T0 + i * 900_000, token: `r${i}` });
      expect(r.ok && r.result!.stoppedBecause).toMatch(/LlamaParse is unavailable \(LlamaParse upload 503\)/);
    }
    expect(d.rows.every((x) => x.status === "stored")).toBe(true);
    const s = stateOf(db);
    expect(s).toMatchObject({ paused: true, pausedBy: "failures", failedRuns: 3, read: 0, done: false });
    const v = core.mailReadBgStatus(s, 8, T0 + 3_000_000);
    expect(v.text).toMatch(/paused itself after 3 failed runs in a row: LlamaParse is unavailable/);
    expect(v.canStart).toBe(true);
    const after = await bg.runMailReadBg({ admin, io: d.io, now: () => T0 + 4_000_000, token: "z" });
    expect(after).toMatchObject({ ok: true, skipped: "paused" });
  });

  it("the background I/O holds a LlamaParse SERVICE outage; the press I/O still falls back", async () => {
    const admin = { from: () => ({}) } as unknown as Parameters<typeof store.supabaseReadIo>[0];
    const fallback = async () => ({ ok: true, text: LCB_TEXT, via: "unpdf" as const, error: null, note: "LlamaParse unavailable (LlamaParse upload 503); used unpdf text-only fallback" });
    const deps = { readPdfLayer: async () => ({ text: "" }), parsePdfWithFallback: fallback, loadWorkbook: async () => [] };
    const doc = { id: "x", kind: "pdf", filename: "x.pdf", storage_key: "mail-harvest/x.pdf" };
    const held = store.supabaseReadIo(admin, "a@b.co", { ...deps, holdOnLlamaOutage: true });
    await expect(held.readPdf(enc("%PDF"), doc)).rejects.toBeInstanceOf(store.LlamaUnavailable);
    const press = store.supabaseReadIo(admin, "a@b.co", deps);
    await expect(press.readPdf(enc("%PDF"), doc)).resolves.toMatchObject({ engine: "unpdf" });
    // one document LlamaParse could not read (not the service): read from the layer, never held
    const oneDoc = async () => ({ ok: false, text: "", via: "llamaparse" as const, error: "LlamaParse job timed out", note: "parse failed" });
    const held2 = store.supabaseReadIo(admin, "a@b.co", { ...deps, parsePdfWithFallback: oneDoc, holdOnLlamaOutage: true });
    await expect(held2.readPdf(enc("%PDF"), doc)).resolves.toMatchObject({ engine: "none" });
  });

  it("an unreadable state is an error, never 'nothing to do'", async () => {
    const db: Db = { row: null, n: 0, failRead: true };
    const d = docsIo(3);
    const r = await bg.runMailReadBg({ admin: fakeAdmin(db), io: d.io, now: () => T0, token: "t" });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toMatch(/background reading state could not be read: settings down/);
    expect(d.seen.started).toBe(0);
    const st = await bg.loadMailReadBgStatus(3, { admin: fakeAdmin(db) });
    expect(st.ok).toBe(false);
  });

  it("a failed list (database down) is a counted, named failure, never Finished", async () => {
    const db: Db = { row: null, n: 0 };
    const admin = fakeAdmin(db);
    await bg.armMailReadBg(null, { admin });
    const d = docsIo(3);
    d.io.countStored = async () => {
      throw new Error("counting kept documents: db down");
    };
    const r = await bg.runMailReadBg({ admin, io: d.io, now: () => T0, token: "t" });
    expect(r.ok && r.result!.ok).toBe(false);
    expect(stateOf(db)).toMatchObject({ done: false, failedRuns: 1, lastError: "counting kept documents: db down", leaseToken: null });
  });

  it("re-arming after Finished reads documents a later harvest kept", async () => {
    const db: Db = { row: null, n: 0 };
    const admin = fakeAdmin(db);
    await bg.armMailReadBg(null, { admin });
    const d = docsIo(2);
    await bg.runMailReadBg({ admin, io: d.io, now: () => T0, token: "a" });
    expect(stateOf(db).done).toBe(true);
    d.rows.push({ id: "n1", kind: "pdf", filename: "n1.pdf", storage_key: "mail-harvest/n1.pdf", status: "stored" });
    expect(core.mailReadBgStatus(stateOf(db), 1, T0).canStart).toBe(true);
    await bg.armMailReadBg(null, { admin });
    const r = await bg.runMailReadBg({ admin, io: d.io, now: () => T0 + 60_000, token: "b" });
    expect(r.ok && r.result!.read).toBe(1);
    expect(stateOf(db)).toMatchObject({ done: true, read: 1, runs: 1 });
  });
});

describe("R74 S20 wiring", () => {
  it("the every-minute worker reads in the background only when it had nothing else to do; no new cron", () => {
    const s = read("src/app/api/cron/lookup-jobs/route.ts");
    expect(s).toContain("if (result.ok && result.skipped && !(autoStart?.ok && autoStart.run)) {");
    expect(s).toContain('runMailReadBg({ budgetMs: MAIL_READ_BG_BUDGET_MS, trigger: "worker" })');
    const v = JSON.parse(read("vercel.json")) as { crons: unknown[] };
    expect(v.crons).toHaveLength(15);
    expect(core.MAIL_READ_BG_BUDGET_MS + core.MAIL_READ_BG_LEASE_SLACK_MS).toBe(800_000);
  });
  it("the actions require menu.import and never read process.env themselves", () => {
    const a = read("src/app/admin/menu-imports/mail-harvest-actions.ts");
    const tail = a.slice(a.indexOf("export async function readEverythingInBackgroundAction"));
    expect(tail.match(/requirePermission\("menu\.import"\)/g)).toHaveLength(2);
    expect(tail).not.toMatch(/process\.env/);
    expect(tail).toContain("armMailReadBg(session.userId)");
    expect(tail).toContain("pauseMailReadBgNow(session.userId)");
  });
  it("the page shows the panel once with both buttons and the status line", () => {
    const p = read("src/app/admin/menu-imports/page.tsx");
    expect(p.match(/data-testid="mail-read-bg"/g)).toHaveLength(1);
    expect(p).toContain("Read everything in the background");
    expect(p).toContain("Pause background reading");
    expect(p).toContain("loadMailReadBgStatus(");
  });
  it("the store is server-only, CAS-guarded, holds LlamaParse outages, and touches only its settings row + the documents", () => {
    const s = read("src/lib/pos/cultivera-mail-read-bg.ts");
    expect(s).toContain('import "server-only"');
    expect(s).toContain('.eq("updated_at", snap.updatedAt)');
    expect(s).toContain("holdOnLlamaOutage: true");
    expect(s).not.toMatch(/inventory_lots|menu_versions|on_hand_qty/);
    expect(read("src/lib/pos/cultivera-mail-read-bg-core.ts")).not.toMatch(/process\.env|from "@\/lib\/supabase/);
  });
});
