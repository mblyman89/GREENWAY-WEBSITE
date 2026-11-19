/**
 * D253: the assisted CCRS uploader (owner's option A), end to end.
 *
 * Owner (verbatim log): "I will log in, and then you can upload the three
 * batches, waiting for each email response before uploading the next set."
 *
 * 1. The extension's page reading (tools/ccrs-uploader-extension/lib.js) on
 *    the CCRS page shapes seen on PREprod 2026-11-18.
 * 2. The store driven through a whole week against an in-memory database
 *    (the 0369 unique indexes are enforced by the fake): Group 1 -> CCRS
 *    email applied -> gap -> Group 2 -> ... -> done; and every way it stops.
 * 3. Wiring pins: routes, cron, hub, migration, extension manifest.
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

/* ------------------------------------------------------------------ *
 * 1. The extension's page reading
 * ------------------------------------------------------------------ */

describe("extension lib.js reads the CCRS page as seen on PREprod", () => {
  const L = req(path.join(ROOT, "tools/ccrs-uploader-extension/lib.js")) as {
    pageFacts: (h: string) => { loggedIn: boolean; username: string | null; token: string | null };
    visibleText: (h: string) => string;
    parsePairingCode: (c: string) => { origin: string; key: string } | null;
    envOfOrigin: (o: string) => string | null;
    isCcrsFileName: (n: string) => boolean;
  };
  const PAGE = `<html><body><form class="x" action="/Auth/Logout" method="post"><button>Log out</button></form>
    <p>Please use the form below to upload your files.</p>
    <form enctype="multipart/form-data" method="post" action="/Home/Upload">
      <input type="file" name="files" id="fileClick" multiple accept=".csv" onchange="Filevalidation()">
      <input class="form-control" name="username" id="Email" readonly value="michael@greenwaymarijuana.com">
      <input name="__RequestVerificationToken" type="hidden" value="CfDJ8&amp;tok-123" />
      <button id="submitFile" type="submit">Upload</button></form></body></html>`;
  it("logged in: both forms, the readonly Email, the form token (entities decoded)", () => {
    expect(L.pageFacts(PAGE)).toMatchObject({ loggedIn: true, username: "michael@greenwaymarijuana.com", token: "CfDJ8&tok-123" });
  });
  it("the login page (no logout form, no upload form) is not logged in", () => {
    expect(L.pageFacts(`<form action="/Auth/Login" method="post"><input name="Email"><input type="password" name="Password"></form>`).loggedIn).toBe(false);
    expect(L.pageFacts(PAGE.replace("/Auth/Logout", "/Auth/Other")).loggedIn).toBe(false);
  });
  it("answer page text without scripts", () => {
    expect(L.visibleText(`<script>var a="Upload Confirmation";</script><h2>Upload Confirmation</h2><p>Your submission was received at 11/18/2026 12:47:06 PM Pacific Time</p>`)).toBe(
      "Upload Confirmation Your submission was received at 11/18/2026 12:47:06 PM Pacific Time",
    );
  });
  it("the same pairing rule as the back office; only CCRS names; only the two hosts", async () => {
    const core = await import("@/lib/compliance/ccrs-auto-upload-core");
    const code = core.pairingCode("https://www.greenwaymarijuana.com", "k".repeat(43));
    expect(L.parsePairingCode(code)).toEqual(core.parsePairingCode(code));
    expect(L.parsePairingCode("GWCCRS1.http://x.com." + "k".repeat(43))).toBeNull();
    expect(L.isCcrsFileName("Strain_413541_20261117220513.csv")).toBe(true);
    expect(L.isCcrsFileName("../etc/passwd")).toBe(false);
    expect(L.envOfOrigin("https://precannabisreporting.lcb.wa.gov")).toBe("preprod");
    expect(L.envOfOrigin("https://cannabisreporting.lcb.wa.gov.evil.com")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 2. A whole week
 * ------------------------------------------------------------------ */

describe("a production week, three groups, each after CCRS's emails", () => {
  it("uploads Group 1, waits for and applies its emails, waits the gap, then Group 2, then Group 3, then done", async () => {
    const { dev } = await paired();
    const st = await S.startRun(fakeAdmin as never, "prod", OWNER, 10);
    expect(st).toMatchObject({ ok: true, files: 7 });

    // no tab yet -> wait; logged out -> wait
    let a = await S.deviceCheckIn(fakeAdmin as never, dev, [], "1.0.0", T0);
    expect(a.action).toBe("wait");
    a = await S.deviceCheckIn(fakeAdmin as never, dev, [{ ...TABS[0], loggedIn: false }], "1.0.0", T0);
    expect(a.text).toMatch(/Log in to CCRS production/);
    // wrong account -> wait
    a = await S.deviceCheckIn(fakeAdmin as never, dev, [{ ...TABS[0], username: "someone@else.com" }], "1.0.0", T0);
    expect(a.text).toMatch(/logged in as someone@else.com/);

    const sendOne = async (now: number, expectName: string) => {
      const x = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.0.0", now);
      expect(x.action, x.text).toBe("upload");
      if (x.action !== "upload") throw new Error("no upload");
      expect(x.fileName).toBe(expectName);
      expect(x.uploadOrigin).toBe("https://cannabisreporting.lcb.wa.gov");
      // a second check-in while it is in flight gets nothing
      expect((await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.0.0", now)).action).toBe("wait");
      const f = await S.deviceFile(fakeAdmin as never, dev, x.runFileId);
      expect(f?.fileName).toBe(expectName);
      const r = await S.deviceReport(fakeAdmin as never, dev, x.runFileId, OK_PAGE("11/19/2026 9:00:05"), now + 5_000);
      expect(r).toMatchObject({ ok: true, verdict: "received" });
      return x;
    };

    // Group 1: three files back to back (same group: the one-at-a-time rule is passed only for these)
    await sendOne(T0, "Strain_413541_20261117220513.csv");
    await sendOne(T0 + 10_000, "Area_413541_20261117220514.csv");
    await sendOne(T0 + 20_000, "Product_413541_20261117220515.csv");
    expect(markCalls.map((m) => m.override === null)).toEqual([true, false, false]);
    expect(markCalls[0].at).toBe("2026-11-19T17:00:05.000Z"); // CCRS's own time (9:00:05 AM PST)
    expect(audits.filter((x) => x === "ccrs.file.uploaded_by_auto_uploader")).toHaveLength(3);

    // Inventory waits for Group 1's CCRS emails
    a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.0.0", T0 + 60_000);
    expect(a.action).toBe("wait");
    expect(a.text).toMatch(/Waiting for CCRS's email on Strain.*before Group 2/);

    // CCRS answers (hours later on production); the run applies it itself, as the owner
    vi.setSystemTime(T0 + 3 * 3600_000);
    openMail = [{ id: "m1", env: "prod", env_verified: true, kind: "success", subject: "CCRS processed 3 files", received_at: new Date(T0 + 3 * 3600_000 - 60_000).toISOString(), state: "new", names: db.ccrs_files.slice(0, 3).map((f) => f.file_name) }];
    const g2 = await sendOne(T0 + 3 * 3600_000, "Inventory_413541_20261117220516.csv");
    expect(applied).toEqual(["m1 by michael@greenwaymarijuana.com (auto-uploader)"]);
    expect(g2.text).toMatch(/Group 2/);

    // Group 3 waits for the Inventory email, then the 10-minute gap
    const t2 = T0 + 4 * 3600_000;
    vi.setSystemTime(t2);
    openMail.push({ id: "m2", env: "prod", env_verified: true, kind: "success", subject: "CCRS processed Inventory", received_at: new Date(t2).toISOString(), state: "new", names: [db.ccrs_files[3].file_name] });
    // the Inventory post was at T0+3h+5s; t2 is long after the gap -> Group 3 goes
    await sendOne(t2, "InventoryAdjustment_413541_20261117220517.csv");
    await sendOne(t2 + 10_000, "InventoryTransfer_413541_20261117220518.csv");
    await sendOne(t2 + 20_000, "Sale_413541_20261117220519.csv");

    // done only after the last group's emails
    a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.0.0", t2 + 60_000);
    expect(a.action).toBe("wait");
    vi.setSystemTime(t2 + 7200_000);
    openMail.push({ id: "m3", env: "prod", env_verified: true, kind: "success", subject: "CCRS processed 3", received_at: new Date(t2 + 7000_000).toISOString(), state: "new", names: db.ccrs_files.slice(4).map((f) => f.file_name) });
    a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1.0.0", t2 + 7200_000);
    expect(a.action).toBe("idle");
    expect(a.text).toMatch(/Every file was uploaded and CCRS answered each one/);
    expect(db.ccrs_upload_runs[0]).toMatchObject({ state: "done" });
    expect(alerts).toContain("CCRS upload finished");
  });

  it("the gap between groups holds the next group even after the emails are in", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER, 10);
    for (let k = 0; k < 3; k += 1) {
      const x = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0 + k);
      if (x.action !== "upload") throw new Error(x.text);
      await S.deviceReport(fakeAdmin as never, dev, x.runFileId, OK_PAGE("11/19/2026 9:00:00"), T0 + k);
    }
    for (const f of db.ccrs_files.slice(0, 3)) f.state = "closed";
    const a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0 + 5 * 60_000);
    expect(a.action).toBe("wait");
    expect(a.text).toMatch(/10-minute gap/);
    expect((await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0 + 11 * 60_000)).action).toBe("upload");
  });
});

describe("every way a run stops or refuses", () => {
  it("a run does not start while CCRS email waits (the hand-uploaded 11/17 week)", async () => {
    await paired();
    openMail = [{ id: "m0", env: "prod", env_verified: true, kind: "success", subject: "old", received_at: "2026-11-18T10:00:00Z", state: "new", names: [] }];
    const r = await S.startRun(fakeAdmin as never, "prod", OWNER);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/send again/);
    // a PREprod run is not blocked by a production email
    seedWeek("preprod");
    expect((await S.startRun(fakeAdmin as never, "preprod", OWNER)).ok).toBe(true);
  });

  it("one run at a time; switched off = nothing handed out", async () => {
    const { dev } = await paired();
    expect((await S.startRun(fakeAdmin as never, "prod", OWNER)).ok).toBe(true);
    expect(await S.startRun(fakeAdmin as never, "prod", OWNER)).toMatchObject({ ok: false });
    process.env.CCRS_AUTO_UPLOAD = "off";
    expect((await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0)).action).toBe("idle");
  });

  it("an unknown answer page stops the run, alerts once, and blocks a new run until settled", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER);
    const x = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0);
    if (x.action !== "upload") throw new Error(x.text);
    const r = await S.deviceReport(fakeAdmin as never, dev, x.runFileId, { status: 500, responseType: "basic", text: "Server Error" }, T0 + 1000);
    expect(r).toMatchObject({ ok: false, verdict: "unknown" });
    expect(db.ccrs_upload_runs[0].state).toBe("stopped");
    expect(alerts).toEqual(["CCRS upload stopped: please look"]);
    expect(markCalls).toHaveLength(0);
    const again = await S.startRun(fakeAdmin as never, "prod", OWNER);
    expect(!again.ok && again.error).toMatch(/not known whether CCRS received Strain/);
    // the owner checked CCRS: not received -> a new run may go
    expect(await S.markNotReceived(fakeAdmin as never, x.runFileId, "no email, not in CCRS")).toBe(true);
    expect((await S.startRun(fakeAdmin as never, "prod", OWNER)).ok).toBe(true);
  });

  it("a refused page stops; a not-sent report puts the file back in line", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER);
    let x = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0);
    if (x.action !== "upload") throw new Error(x.text);
    const ns = await S.deviceReport(fakeAdmin as never, dev, x.runFileId, { status: -1, responseType: "error", text: "", networkError: "the CCRS page is not logged in (nothing sent)", notSent: true }, T0);
    expect(ns.verdict).toBe("not-sent");
    x = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0 + 30_000);
    expect(x.action === "upload" && x.fileName).toBe("Strain_413541_20261117220513.csv");
    if (x.action !== "upload") throw new Error("x");
    const rf = await S.deviceReport(fakeAdmin as never, dev, x.runFileId, { status: 200, responseType: "basic", text: "Your Files Could Not Be Uploaded You have not uploaded any files" }, T0 + 31_000);
    expect(rf.verdict).toBe("refused");
    expect(db.ccrs_upload_runs[0].state).toBe("stopped");
  });

  it("a file handed out and never reported becomes unknown after 10 minutes", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER);
    await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0);
    const a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0 + 11 * 60_000);
    expect(a.text).toMatch(/never reported back/);
    expect(db.ccrs_upload_run_files.find((f) => f.seq === 1)?.step).toBe("unknown");
  });

  it("CCRS refused rows in Group 1: paused until the owner continues anyway", async () => {
    const { dev } = await paired();
    const st = await S.startRun(fakeAdmin as never, "prod", OWNER, 0);
    for (let k = 0; k < 3; k += 1) {
      const x = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0 + k);
      if (x.action !== "upload") throw new Error(x.text);
      await S.deviceReport(fakeAdmin as never, dev, x.runFileId, OK_PAGE("11/19/2026 9:00:00"), T0 + k);
    }
    for (const f of db.ccrs_files.slice(0, 3)) f.state = "closed";
    Object.assign(db.ccrs_files[2], { state: "errored", error_messages: ["Invalid Strain"] });
    const a = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0 + 60_000);
    expect(a.text).toMatch(/Continue anyway/);
    expect(db.ccrs_upload_runs[0].state).toBe("paused");
    expect((await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0 + 70_000)).action).toBe("idle");
    const view = await S.getAutoUploadView(fakeAdmin as never);
    expect(view.refusedFileIds).toEqual([db.ccrs_files[2].id]);
    if (!st.ok) throw new Error("start");
    expect(await S.resumeRun(fakeAdmin as never, st.runId, [db.ccrs_files[2].id as string])).toBe(true);
    const b = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0 + 80_000);
    expect(b.action === "upload" && b.fileName).toBe("Inventory_413541_20261117220516.csv");
  });

  it("a revoked browser, a wrong key, or another browser gets nothing", async () => {
    const { dev, key } = await paired();
    const other = (await paired()).dev;
    await S.startRun(fakeAdmin as never, "prod", OWNER);
    const x = await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0);
    if (x.action !== "upload") throw new Error(x.text);
    expect(await S.deviceFile(fakeAdmin as never, other, x.runFileId)).toBeNull();
    expect((await S.deviceReport(fakeAdmin as never, other, x.runFileId, OK_PAGE("11/19/2026 9:00:00"), T0)).verdict).toBe("not-held");
    expect(await S.authenticateDevice(fakeAdmin as never, "Bearer short")).toBeNull();
    expect(await S.authenticateDevice(fakeAdmin as never, `Bearer ${"Z".repeat(43)}`)).toBeNull();
    await S.revokeDevice(fakeAdmin as never, dev.id, OWNER);
    expect(await S.authenticateDevice(fakeAdmin as never, `Bearer ${key}`)).toBeNull();
    // only the hash is kept
    expect(JSON.stringify(db.ccrs_uploader_devices)).not.toContain(key);
  });

  it("a step taken by Stop between the decision and the claim is never handed out (conditional claim)", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER);
    // Stop lands after nextStep chose the file but before the claim is written.
    const racing = {
      from: (t: string) => {
        const b = builder(t);
        if (t !== "ccrs_upload_run_files") return b;
        const update = b.update.bind(b);
        b.update = (p: Row) => {
          if (p.step === "claimed") for (const r of db.ccrs_upload_run_files ?? []) if (r.step === "pending") r.step = "skipped";
          return update(p);
        };
        return b;
      },
    };
    const x = await S.deviceCheckIn(racing as never, dev, TABS, "1", T0);
    expect(x.action).not.toBe("upload");
    expect((db.ccrs_upload_run_files ?? []).filter((r) => r.step === "claimed")).toHaveLength(0);
  });

  it("stop: files not handed out are skipped (free for a later run); the one in the browser becomes unknown", async () => {
    const { dev } = await paired();
    const st = await S.startRun(fakeAdmin as never, "prod", OWNER);
    await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0);
    if (!st.ok) throw new Error("start");
    await S.endRun(fakeAdmin as never, st.runId, "stopped", "Stopped by the owner.");
    const steps = db.ccrs_upload_run_files.map((f) => f.step);
    expect(steps.filter((s) => s === "skipped")).toHaveLength(6);
    expect(steps.filter((s) => s === "unknown")).toHaveLength(1);
  });

  it("a starter who lost settings.manage stops the run at the email step", async () => {
    const { dev } = await paired();
    await S.startRun(fakeAdmin as never, "prod", OWNER);
    db.staff_profiles[0].role = "budtender";
    await S.deviceCheckIn(fakeAdmin as never, dev, TABS, "1", T0);
    expect(db.ccrs_upload_runs[0].state).toBe("stopped");
  });
});

/* ------------------------------------------------------------------ *
 * 3. Wiring
 * ------------------------------------------------------------------ */

describe("wiring", () => {
  it("the three routes are bearer-only, dynamic, no-store, and grant no CORS", () => {
    const http = SRC("src/lib/compliance/ccrs-auto-upload-http.ts");
    expect(http).toMatch(/import "server-only";/);
    expect(http).toMatch(/no-store/);
    expect(http).not.toMatch(/Access-Control-Allow/);
    for (const r of ["next", "file", "report"]) {
      const s = SRC(`src/app/api/ccrs-uploader/${r}/route.ts`);
      expect(s, r).toMatch(/export const dynamic = "force-dynamic"/);
      expect(s, r).toMatch(/const ctx = await deviceOr401\(req\);\s+if \(ctx instanceof NextResponse\) return ctx;/);
    }
  });
  it("the mail cron keeps its pinned tick and status, then runs the uploader step", () => {
    const s = SRC("src/app/api/cron/ccrs-mail/route.ts");
    expect(s).toMatch(/const result = await runCcrsMailTick\(\);\s+const status = result\.ok \|\| !result\.configured \? 200 : 500;/);
    expect(s).toMatch(/await autoUploadCronStep\(\)/);
  });
  it("every hub action is settings.manage and audited; the pairing code never goes into a URL", () => {
    const s = SRC("src/app/admin/compliance/ccrs/auto-upload-actions.ts");
    const fns = s.split(/export async function /).slice(1);
    expect(fns.length).toBe(7);
    for (const f of fns) {
      expect(f, f.split("(")[0]).toMatch(/await requirePermission\("settings\.manage"\)/);
      expect(f, f.split("(")[0]).toMatch(/recordAudit\(/);
    }
    const pair = fns.find((f) => f.startsWith("pairUploaderDeviceAction"))!;
    expect(pair).not.toMatch(/redirect\(|back\(|ok\(formData/);
    expect(s).toMatch(/Type \$\{START_CONFIRM\} to start a production run/);
  });
  it("the hub shows the panel; the store applies email only via the shared Apply", () => {
    expect(SRC("src/app/admin/compliance/ccrs/page.tsx")).toMatch(/id="ccrs-auto-upload"[\s\S]*<CcrsAutoUploadPanel/);
    const store = SRC("src/lib/compliance/ccrs-auto-upload-store.ts");
    expect(store).toMatch(/applyOneStoredMail\(admin, actor, m\)/);
    expect(store).toMatch(/can\(p\.role, "settings\.manage"\)/);
    expect(store).not.toMatch(/recordOutcome|ccrs_record_outcome/);
  });
  it("the extension asks for only the CCRS hosts and the back office, and never touches a password", () => {
    const m = JSON.parse(SRC("tools/ccrs-uploader-extension/manifest.json")) as { manifest_version: number; host_permissions: string[]; permissions: string[]; content_scripts: { matches: string[] }[] };
    expect(m.manifest_version).toBe(3);
    expect(m.host_permissions.sort()).toEqual(["https://cannabisreporting.lcb.wa.gov/*", "https://greenwaymarijuana.com/*", "https://precannabisreporting.lcb.wa.gov/*", "https://www.greenwaymarijuana.com/*"]);
    expect(m.content_scripts[0].matches.sort()).toEqual(["https://cannabisreporting.lcb.wa.gov/*", "https://precannabisreporting.lcb.wa.gov/*"]);
    expect(m.permissions.sort()).toEqual(["alarms", "scripting", "storage"]);
    for (const f of ["content.js", "background.js", "lib.js"]) expect(SRC(`tools/ccrs-uploader-extension/${f}`), f).not.toMatch(/password/i);
    const c = SRC("tools/ccrs-uploader-extension/content.js");
    expect(c).toMatch(/redirect: "manual"/);
    expect(c).toMatch(/fd\.append\("files", new Blob\(\[msg\.csv\], \{ type: "text\/csv" \}\), msg\.fileName\)/);
  });
  it("0369: one active run, one file in flight, one waiting place per file, service role only", () => {
    const sql = SRC("supabase/migrations/0369_ccrs_auto_upload.sql");
    expect(sql).toMatch(/create unique index if not exists ccrs_upload_runs_one_active on public\.ccrs_upload_runs \(\(true\)\) where state in \('running', 'paused'\)/);
    expect(sql).toMatch(/create unique index if not exists ccrs_upload_run_files_one_claimed on public\.ccrs_upload_run_files \(\(true\)\) where step = 'claimed'/);
    expect(sql).toMatch(/ccrs_upload_run_files_one_waiting on public\.ccrs_upload_run_files \(file_id\) where step in \('pending', 'claimed'\)/);
    expect(sql).toMatch(/token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    for (const t of ["ccrs_uploader_devices", "ccrs_upload_runs", "ccrs_upload_run_files"]) {
      expect(sql).toMatch(new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated;`));
    }
  });
});
