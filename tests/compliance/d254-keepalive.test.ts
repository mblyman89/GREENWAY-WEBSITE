/**
 * D254: keep the CCRS login alive while a run waits, and tell the owner when
 * CCRS logged him out and the next group is ready.
 *
 * Owner (verbatim log): "it takes so long between uploads, that we get auto
 * logged out. Is there a way to add to the upload logic to do something that
 * will keep the site alive while we wait for the emails to arrive" and "yes,
 * please build the keep alive and alert system as a back up plan."
 *
 * 1. The check-in answer: keepAlive only with CCRS_KEEPALIVE=on and only
 *    while waiting for CCRS's email or the gap.
 * 2. The log-in alert: once per run per held file, after a short grace time.
 * 3. The extension: the keep-alive is a GET of the same page, gated by the
 *    back office's answer, never an upload (static pins + lib.js in Node).
 *
 * The in-memory Supabase below is the D253 test's (same 0369 rules).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const req = createRequire(import.meta.url);

/* ------------------------------------------------------------------ *
 * An in-memory Supabase (only what the store uses)
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let idSeq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`;

const DEFAULTS: Record<string, () => Row> = {
  ccrs_uploader_devices: () => ({ created_at: new Date().toISOString(), last_seen_at: null, last_tabs: null, last_version: null, revoked_at: null, silent_alerted_at: null }),
  ccrs_upload_runs: () => ({ state: "running", gap_minutes: 10, accepted_file_ids: [], started_at: new Date().toISOString(), ended_at: null, ended_reason: null, last_decision: null, last_decision_at: null, last_mail_check_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  ccrs_upload_run_files: () => ({ step: "pending", claimed_at: null, claimed_by_device: null, posted_at: null, ccrs_received_at: null, receipt: null, report: null, note: null, updated_at: new Date().toISOString() }),
};

/** The 0369 unique indexes (and the 0118 dedupe key), as the database would refuse them. */
function violates(table: string, rows: Row[]): boolean {
  const t = rows;
  if (table === "ccrs_upload_runs") return t.filter((r) => r.state === "running" || r.state === "paused").length > 1;
  if (table === "ccrs_upload_run_files") {
    if (t.filter((r) => r.step === "claimed").length > 1) return true;
    const waiting = t.filter((r) => r.step === "pending" || r.step === "claimed").map((r) => r.file_id);
    if (new Set(waiting).size !== waiting.length) return true;
    return t.some((r) => (r.step === "pending") !== (r.claimed_at == null) && r.step !== "skipped");
  }
  if (table === "compliance_reminder_log") {
    const k = t.map((r) => r.dedupe_key);
    return new Set(k).size !== k.length;
  }
  if (table === "ccrs_uploader_devices") {
    const k = t.map((r) => r.token_hash);
    return new Set(k).size !== k.length;
  }
  return false;
}

type Filter = (r: Row) => boolean;
function builder(table: string) {
  let op: "select" | "insert" | "update" = "select";
  let payload: Row | Row[] | null = null;
  let returning = false;
  const filters: Filter[] = [];
  let order: { col: string; asc: boolean } | null = null;
  let limit = Infinity;
  let mode: "many" | "single" | "maybe" = "many";
  const b = {
    select() {
      if (op !== "select") returning = true;
      return b;
    },
    insert(p: Row | Row[]) {
      op = "insert";
      payload = p;
      return b;
    },
    update(p: Row) {
      op = "update";
      payload = p;
      return b;
    },
    eq(c: string, v: unknown) {
      filters.push((r) => r[c] === v);
      return b;
    },
    in(c: string, vs: unknown[]) {
      filters.push((r) => vs.includes(r[c]));
      return b;
    },
    is(c: string, v: null) {
      filters.push((r) => (r[c] ?? null) === v);
      return b;
    },
    not(c: string, opName: string, v: string) {
      const vs = v.replace(/[()]/g, "").split(",");
      filters.push((r) => !vs.includes(String(r[c])));
      return b;
    },
    or(expr: string) {
      const parts = expr.split(",").map((p) => {
        const [c, o, ...rest] = p.split(".");
        const v = rest.join(".");
        if (o === "is" && v === "null") return (r: Row) => r[c] == null;
        if (o === "lt") return (r: Row) => r[c] != null && String(r[c]) < v;
        throw new Error(`fake: or ${p}`);
      });
      filters.push((r) => parts.some((f) => f(r)));
      return b;
    },
    order(c: string, o: { ascending: boolean }) {
      order = { col: c, asc: o.ascending };
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    single() {
      mode = "single";
      return b;
    },
    maybeSingle() {
      mode = "maybe";
      return b;
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(res, rej);
    },
  };
  function run(): { data: unknown; error: { code?: string; message: string } | null } {
    const rows = (db[table] ??= []);
    if (op === "insert") {
      const list = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({ id: uuid(), ...(DEFAULTS[table]?.() ?? {}), ...p }));
      if (violates(table, [...rows, ...list])) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      rows.push(...list);
      return finish(list.map((r) => ({ ...r })));
    }
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") {
      const next = rows.map((r) => (hit.includes(r) ? { ...r, ...(payload as Row) } : r));
      if (violates(table, next)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      for (const r of hit) Object.assign(r, payload);
      return finish(returning ? hit.map((r) => ({ ...r })) : null);
    }
    let out = hit.map((r) => ({ ...r }));
    if (order) {
      const { col, asc } = order;
      out.sort((a, z) => (String(a[col] ?? "") < String(z[col] ?? "") ? -1 : String(a[col] ?? "") > String(z[col] ?? "") ? 1 : 0) * (asc ? 1 : -1));
    }
    out = out.slice(0, limit);
    return finish(out);
  }
  function finish(list: Row[] | null) {
    if (mode === "many") return { data: list, error: null };
    const l = list ?? [];
    if (mode === "single" && l.length !== 1) return { data: null, error: { message: "not one row" } };
    if (l.length > 1) return { data: null, error: { message: "more than one row" } };
    return { data: l[0] ?? null, error: null };
  }
  return b;
}
const fakeAdmin = { from: (t: string) => builder(t) };

/* ------------------------------------------------------------------ *
 * The ledger, the mail and the alert channels (mocked at their modules)
 * ------------------------------------------------------------------ */

const markCalls: { fileId: string; at: string; override: string | null }[] = [];
const applied: string[] = [];
let openMail: Row[] = [];
const audits: string[] = [];
const alerts: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeAdmin }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: { action: string }) => void audits.push(e.action) }));
vi.mock("@/lib/notifications/push", () => ({ isPushConfigured: () => true, sendPushToAll: async (p: { title: string }) => (alerts.push(p.title), 1) }));
vi.mock("@/lib/orders/staff-alert-email", () => ({ sendStaffAlertEmail: async () => ({ ok: true }) }));
vi.mock("@/lib/compliance/ccrs-mail-notify", () => ({ MAIL_CLAIM_PENDING: "(claimed: sending)" }));
vi.mock("@/lib/compliance/ccrs-mail-store", () => ({ listOpenCcrsMail: async () => openMail.filter((m) => m.state === "new") }));
vi.mock("@/lib/compliance/ccrs-mail-apply", () => ({
  applyOneStoredMail: async (_a: unknown, actor: { email: string }, mail: Row) => {
    // A CCRS confirmation for the named files: they become "closed" (answered).
    for (const n of mail.names as string[]) {
      const f = db.ccrs_files.find((x) => x.file_name === n);
      if (f) Object.assign(f, { state: mail.kind === "error" ? "errored" : "closed", error_messages: (mail.messages as string[] | undefined) ?? null });
    }
    mail.state = "applied";
    applied.push(`${mail.id} by ${actor.email}`);
    return { ok: true, text: "applied" };
  },
}));
vi.mock("@/lib/compliance/ccrs-ledger-store", () => ({
  listCcrsFilesLite: async (_a: unknown, envs: string[], states: string[]) =>
    db.ccrs_files
      .filter((f) => envs.includes(f.env as string) && states.includes(f.state as string))
      .map((f) => ({ id: f.id, env: f.env, fileType: f.file_type, purpose: "weekly", fileName: f.file_name, state: f.state, stampAt: f.stamp_at, errorMessages: f.error_messages ?? null })),
  readStoredFile: async (_a: unknown, id: string) => {
    const f = db.ccrs_files.find((x) => x.id === id)!;
    return { fileName: f.file_name as string, csv: `CSV of ${f.file_name}` };
  },
  markUploaded: async (_a: unknown, fileId: string, at: string, _by: string, override: string | null) => {
    const f = db.ccrs_files.find((x) => x.id === fileId)!;
    // 0249's one-at-a-time rule: an earlier-stamped file still "uploaded" blocks.
    const before = db.ccrs_files.filter((x) => x.env === f.env && x.state === "uploaded" && String(x.stamp_at) < String(f.stamp_at));
    if (before.length && !override) {
      throw new Error(`ccrs_mark_uploaded: CCRS_UPLOAD_NOT_READY: settle these first (or give a reason of 10+ characters): ${before.map((x) => `${x.file_name} (uploaded)`).join("; ")}`);
    }
    f.state = "uploaded";
    markCalls.push({ fileId, at, override });
    return { id: fileId };
  },
}));

type Store = typeof import("@/lib/compliance/ccrs-auto-upload-store");
let S: Store;
const TYPES = ["Strain", "Area", "Product", "Inventory", "InventoryAdjustment", "InventoryTransfer", "Sale"];
const OWNER = { id: "11111111-1111-4111-8111-111111111111", email: "michael@greenwaymarijuana.com" };
const T0 = Date.parse("2026-11-19T17:00:00Z");
const OK_PAGE = (t: string) => ({ status: 200, responseType: "basic", text: `Upload Confirmation Your submission was received at ${t} PM Pacific Time. You will receive an email…` });
const TABS = [{ origin: "https://cannabisreporting.lcb.wa.gov", loggedIn: true, username: "michael@greenwaymarijuana.com" }];

function seedWeek(env = "prod") {
  db.ccrs_files = TYPES.map((t, k) => ({ id: uuid(), env, file_type: t, file_name: `${t}_413541_202611172205${13 + k}.csv`, state: "emitted", stamp_at: `2026-11-18T06:05:${13 + k}.000Z`, error_messages: null }));
  db.staff_profiles = [{ id: OWNER.id, email: OWNER.email, role: "owner", active: true }];
}

async function paired() {
  const { code } = await S.pairDevice(fakeAdmin as never, "Owner's Chrome", OWNER);
  const key = code.split(".").pop()!;
  const dev = await S.authenticateDevice(fakeAdmin as never, `Bearer ${key}`);
  expect(dev).not.toBeNull();
  return { dev: dev!, key, code };
}

beforeEach(async () => {
  for (const k of Object.keys(db)) delete db[k];
  markCalls.length = 0;
  applied.length = 0;
  audits.length = 0;
  alerts.length = 0;
  openMail = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  process.env.CCRS_AUTO_UPLOAD = "";
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.greenwaymarijuana.com";
  S = await import("@/lib/compliance/ccrs-auto-upload-store");
  seedWeek();
});
afterEach(() => vi.useRealTimers());


const KEEP = "CCRS_KEEPALIVE";
const LOGGED_OUT = [{ ...TABS[0], loggedIn: false }];

async function sendGroup1(dev: Awaited<ReturnType<typeof paired>>["dev"], at: number) {
  for (let k = 0; k < 3; k += 1) {
    const x = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.1.0", at + k);
    if (x.action !== "upload") throw new Error(x.text);
    await S.deviceReport(fakeAdmin as never, dev, x.runFileId, OK_PAGE("11/19/2026 9:00:00"), at + k);
  }
}

describe("D254 keep-alive: only when switched on, only while the run waits for CCRS", () => {
  afterEach(() => {
    delete process.env[KEEP];
  });

  it("is off by default: waiting for CCRS's email says nothing about keep-alive", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER, 10);
    await sendGroup1(dev, T0);
    const a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.1.0", T0 + 60_000);
    expect(a.action).toBe("wait");
    expect(a.text).toMatch(/Waiting for CCRS's email/);
    expect(a).not.toHaveProperty("keepAlive");
  });

  it("CCRS_KEEPALIVE=on: the email wait and the gap ask the browser to keep the page alive every 10 minutes", async () => {
    process.env[KEEP] = "on";
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER, 10);
    await sendGroup1(dev, T0);
    let a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.1.0", T0 + 60_000);
    expect(a).toMatchObject({ action: "wait", keepAlive: true, keepAliveSeconds: 600, env: "prod" });
    for (const f of db.ccrs_files.slice(0, 3)) f.state = "closed";
    a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.1.0", T0 + 5 * 60_000);
    expect(a.text).toMatch(/10-minute gap/);
    expect(a).toMatchObject({ keepAlive: true });
    // the gap is over: an upload, never a keep-alive with it
    a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.1.0", T0 + 11 * 60_000);
    expect(a.action).toBe("upload");
    expect(a).not.toHaveProperty("keepAlive");
  });

  it("never for a logged-out page, a file in flight, or no run", async () => {
    process.env[KEEP] = "on";
    const { dev } = await paired();
    expect(await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.1.0", T0)).not.toHaveProperty("keepAlive");
    await S.startRun(fakeAdmin as never, "prod", OWNER, 10);
    expect(await S.deviceCheckIn(fakeAdmin as never, dev, LOGGED_OUT, "1.1.0", T0)).not.toHaveProperty("keepAlive");
    const x = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.1.0", T0);
    expect(x.action).toBe("upload");
    const busy = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.1.0", T0 + 1000);
    expect(busy.text).toMatch(/Uploading Strain/);
    expect(busy).not.toHaveProperty("keepAlive");
  });

  it("the hub panel says whether keep-alive is on", async () => {
    expect((await S.getAutoUploadView(fakeAdmin as never)).keepAlive).toBe(false);
    process.env[KEEP] = "on";
    expect((await S.getAutoUploadView(fakeAdmin as never)).keepAlive).toBe(true);
    const panel = SRC("src/components/admin/compliance/CcrsAutoUploadPanel.tsx");
    expect(panel).toContain("view.keepAlive");
    expect(panel).toContain("CCRS_KEEPALIVE=on");
  });
});

describe("D254 log-in alert: the next group is ready but CCRS logged out", () => {
  it("alerts once per held file after a 2-minute grace, and the run goes on after the owner logs in", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER, 10);
    // just pressed Start, not logged in yet: no alert
    let a = await S.deviceCheckIn(fakeAdmin as never, dev, LOGGED_OUT, "1.1.0", T0);
    expect(a.text).toMatch(/Log in to CCRS production/);
    vi.setSystemTime(T0 + 60_000);
    await S.deviceCheckIn(fakeAdmin as never, dev, LOGGED_OUT, "1.1.0", T0 + 60_000);
    expect(alerts).toEqual([]);
    // still logged out after the grace time: one alert
    vi.setSystemTime(T0 + 3 * 60_000);
    await S.deviceCheckIn(fakeAdmin as never, dev, LOGGED_OUT, "1.1.0", T0 + 3 * 60_000);
    await S.deviceCheckIn(fakeAdmin as never, dev, LOGGED_OUT, "1.1.0", T0 + 4 * 60_000);
    await S.deviceCheckIn(fakeAdmin as never, dev, LOGGED_OUT, "1.1.0", T0 + 30 * 60_000);
    expect(alerts).toEqual(["CCRS upload waiting: please log in to CCRS production"]);
    const runId = db.ccrs_upload_runs[0].id as string;
    const log = db.compliance_reminder_log.filter((r) => String(r.dedupe_key).startsWith(`ccrs_auto_upload:${runId}:login:`));
    expect(log).toHaveLength(1);
    expect(log[0].dedupe_key).toBe(`ccrs_auto_upload:${runId}:login:${db.ccrs_upload_run_files[0].id}`);
    // he logs in: Group 1 goes, no further alert
    a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.1.0", T0 + 31 * 60_000);
    expect(a.action).toBe("upload");
    expect(alerts).toHaveLength(1);
  });

  it("a logout before the next group alerts again (new held file); waiting for CCRS's email never alerts", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER, 10);
    await sendGroup1(dev, T0);
    // hours waiting for CCRS's email, logged out the whole time: no alert (nothing is ready)
    for (const t of [1, 60, 120, 180]) await S.deviceCheckIn(fakeAdmin as never, dev, LOGGED_OUT, "1.1.0", T0 + t * 60_000);
    expect(alerts).toEqual([]);
    // the emails are in, the gap is over: Inventory is ready but CCRS is logged out
    for (const f of db.ccrs_files.slice(0, 3)) f.state = "closed";
    const t1 = T0 + 200 * 60_000;
    vi.setSystemTime(t1);
    await S.deviceCheckIn(fakeAdmin as never, dev, LOGGED_OUT, "1.1.0", t1);
    expect(alerts).toEqual([]);
    vi.setSystemTime(t1 + 3 * 60_000);
    await S.deviceCheckIn(fakeAdmin as never, dev, LOGGED_OUT, "1.1.0", t1 + 3 * 60_000);
    expect(alerts).toEqual(["CCRS upload waiting: please log in to CCRS production"]);
    const inv = db.ccrs_upload_run_files.find((r) => r.file_type === "Inventory")!;
    expect(db.compliance_reminder_log.map((r) => r.dedupe_key)).toContain(`ccrs_auto_upload:${db.ccrs_upload_runs[0].id}:login:${inv.id}`);
  });

  it("a closed CCRS page or another account alerts the same way; PREprod names PREprod", async () => {
    seedWeek("preprod");
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "preprod", OWNER, 10);
    await S.deviceCheckIn(fakeAdmin as never, dev, [], "1.1.0", T0);
    vi.setSystemTime(T0 + 3 * 60_000);
    await S.deviceCheckIn(fakeAdmin as never, dev, [], "1.1.0", T0 + 3 * 60_000);
    expect(alerts).toEqual(["CCRS upload waiting: please log in to CCRS PREprod"]);
  });

  it("an old logged-out tab next to a logged-in one does not hold the run", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER, 10);
    const a = await S.deviceCheckIn(fakeAdmin as never, dev, [...LOGGED_OUT, ...TABS], "1.1.0", T0);
    expect(a.action).toBe("upload");
  });
});

describe("D254 extension: the keep-alive is a page read, gated by the back office", () => {
  const L = req(path.join(ROOT, "tools/ccrs-uploader-extension/lib.js")) as {
    keepAliveDue: (last: string | null, now: number, seconds: unknown) => boolean;
    agoText: (last: string, now: number) => string;
  };
  const NOW = Date.parse("2026-11-19T10:00:00Z");

  it("lib.js keepAliveDue: first time, every interval (clamped 2..30 min), never without an interval", () => {
    expect(L.keepAliveDue(null, NOW, 600)).toBe(true);
    expect(L.keepAliveDue("2026-11-19T09:55:00Z", NOW, 600)).toBe(false);
    expect(L.keepAliveDue("2026-11-19T09:50:00Z", NOW, 600)).toBe(true);
    expect(L.keepAliveDue("2026-11-19T09:59:00Z", NOW, 5)).toBe(false); // clamped up to 2 minutes
    expect(L.keepAliveDue("2026-11-19T09:58:00Z", NOW, 5)).toBe(true);
    expect(L.keepAliveDue("2026-11-19T09:35:00Z", NOW, 99_999)).toBe(false); // clamped down to 30 minutes
    expect(L.keepAliveDue("2026-11-19T09:29:00Z", NOW, 99_999)).toBe(true);
    expect(L.keepAliveDue(null, NOW, 0)).toBe(false);
    expect(L.keepAliveDue(null, NOW, undefined)).toBe(false);
    expect(L.keepAliveDue("2026-11-19T12:00:00Z", NOW, 600)).toBe(true); // clock set back
    expect(L.agoText("2026-11-19T09:55:00Z", NOW)).toBe("5 min ago");
  });

  it("content.js: gw-keepalive is a GET of the same page that never uploads; a page found logged out stays logged out", () => {
    const c = SRC("tools/ccrs-uploader-extension/content.js");
    const ka = c.slice(c.indexOf("async function keepAlive()"), c.indexOf("async function upload("));
    expect(ka).toContain("freshFacts()");
    expect(ka).not.toMatch(/Upload|FormData|method:\s*"POST"/);
    const fresh = c.slice(c.indexOf("async function freshFacts()"), c.indexOf("async function keepAlive()"));
    expect(fresh).toContain('location.origin + location.pathname');
    expect(fresh).toContain('redirect: "manual"');
    expect(fresh).not.toMatch(/method:/);
    expect(fresh).toContain("sessionEnded = true");
    expect(c).toContain('msg.type === "gw-keepalive"');
    expect(c).toContain("f.loggedIn && !sessionEnded");
  });

  it("background.js: keeps alive only on a wait answer with keepAlive true, only the run's logged-in site", () => {
    const b = SRC("tools/ccrs-uploader-extension/background.js");
    expect(b).toContain('d.action === "wait" && d.keepAlive === true ? await keepAlive(d, tabs)');
    const fn = b.slice(b.indexOf("async function keepAlive(d, tabs)"), b.indexOf("async function report("));
    expect(fn).toContain("L.envOfOrigin(t.origin) === env && t.loggedIn");
    expect(fn).toContain("L.keepAliveDue(");
    expect(fn).toContain('type: "gw-keepalive"');
    expect(fn).not.toContain("gw-upload");
    for (const f of ["content.js", "background.js", "lib.js"]) expect(SRC(`tools/ccrs-uploader-extension/${f}`), f).not.toMatch(/password/i);
    const m = JSON.parse(SRC("tools/ccrs-uploader-extension/manifest.json")) as { version: string; permissions: string[] };
    expect(m.version).toBe("1.1.0");
    expect(m.permissions.sort()).toEqual(["alarms", "scripting", "storage"]);
  });

  it("the server switch is CCRS_KEEPALIVE=on and is documented", () => {
    expect(SRC("src/lib/compliance/ccrs-auto-upload-core.ts")).toContain('(env.CCRS_KEEPALIVE ?? "").trim().toLowerCase() === "on"');
    expect(SRC("tools/ccrs-uploader-extension/README.md")).toContain("CCRS_KEEPALIVE=on");
  });

  it("PREprod practice set: the hub action is PREprod only, audited, and runs both last checks before the outbox", () => {
    const a = SRC("src/app/admin/compliance/ccrs/auto-upload-actions.ts");
    const fn = a.slice(a.indexOf("export async function makePreprodAutobotTestSetAction"));
    expect(fn).toContain('requirePermission("settings.manage")');
    expect(fn).toContain('const env: LedgerEnv = "preprod";');
    expect(fn).not.toMatch(/"prod"/);
    expect(fn).not.toContain("formData.get(\"run_env\")");
    expect(fn).toContain("verifyCcrsBatch(");
    expect(fn).toContain("verifyOutboxAgainstLedger(ledger.view, planned)");
    expect(fn.indexOf("verifyOutboxAgainstLedger(")).toBeLessThan(fn.indexOf("emitOutboxFiles("));
    expect(fn).toContain("lastStamp: ledger.lastStamp");
    expect(fn).toContain('"ccrs.auto_upload.preprod_test_set_made"');
    const p = SRC("src/components/admin/compliance/CcrsAutoUploadPanel.tsx");
    expect(p).toContain('data-testid="ccrs-auto-upload-preprod-test"');
    expect(p).toContain("canEdit && !run ?");
  });
});
