/**
 * R41 S3: the ACH file ledger (0273 ach_files), run for real:
 *   - the REAL ledger store over the REAL @supabase/postgrest-js client
 *     against FakePostgrest, with the 0273 unique rules emulated by name;
 *   - real AES-GCM (encryptSecret / decryptSecret) and the real keyed hash;
 *   - the real NACHA builder (the stored bytes are parsed back).
 * The plan's S3 tests (R41-TIMBERLAND-SLICE-PLAN-v2 S3): a double download is
 * byte-identical; a download never changes approved_by (it writes nothing);
 * payroll then vendor on the same Pacific day get A then B; a repeat is
 * refused; a tampered body is refused. Plus: no key, a modifier race, a voided
 * file, the Pacific day, void reasons, source pins and 0273 text pins.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type FakeRequest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  rpc: [] as { fn: string; body: Record<string, unknown> }[],
  rpcReply: null as null | ((fn: string, body: Record<string, unknown>) => { status: number; body: unknown }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => {
      const pg = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch });
      return { from: (t: string) => pg.from(t), rpc: (fn: string, args: Record<string, unknown>) => pg.rpc(fn, args) };
    },
  };
});

const ledger = await import("@/lib/payments/ach-file-ledger-store");
const { buildNachaFile } = await import("@/lib/payments/nacha-core");
const { encryptSecret, decryptSecret } = await import("@/lib/security/at-rest-crypto");
const core = await import("@/lib/payments/ach-file-ledger-core");

const read = (p: string) => readFileSync(p, "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const KEY = "s3-ledger-test-key-0123456789abcdef!!";
const NOW = new Date("2026-10-05T17:00:00Z"); // Monday 10:00 Pacific
const EFFECTIVE = "2026-10-06";
const STEPHEN = "11111111-1111-4111-8111-111111111111";
const RUN = "3f2b1c0d-1111-4222-8333-444455556666";
const ACCT = "0012345678";

const GW = {
  destinationRouting: "325170754",
  destinationName: "TIMBERLAND BANK",
  immediateOrigin: "1911234567",
  companyName: "Greenway Marijuana",
  companyId: "1911234567",
  originatingDfi: "32517075",
  companyEin: "911234567",
};

type Entry = { cents: number; acct?: string };
const builder =
  (entries: Entry[], desc = "VENDOR PAY", sec: "PPD" | "CCD" = "CCD", now = NOW) =>
  (fileIdModifier: string) => {
    const b = buildNachaFile({
      originator: GW,
      entries: entries.map((e, i) => ({ accountType: "checking" as const, routing: "021000021", accountNumber: e.acct ?? ACCT, amountCents: e.cents, name: `PAYEE ${i + 1}`, idNumber: `ID${i + 1}` })),
      secCode: sec,
      companyEntryDescription: desc,
      effectiveDate: new Date(`${EFFECTIVE}T00:00:00Z`),
      createdAt: now,
      fileIdModifier,
    });
    return b.ok ? { ok: true as const, file: b.file, entryCount: b.entryCount, totalCents: b.totalCents } : { ok: false as const, error: b.error };
  };

const vendor = (sourceId: string, entries: Entry[] = [{ cents: 12345 }], now = NOW) =>
  ledger.releaseAchFile({ kind: "vendor", sourceId, actorId: STEPHEN, now, effectiveDate: EFFECTIVE, filename: `vendor-${sourceId}.ach`, build: builder(entries, "VENDOR PAY", "CCD", now) });

const payroll = (now = NOW) =>
  ledger.releasePayrollAchFile({ runId: RUN, actorId: STEPHEN, now, effectiveDate: EFFECTIVE, filename: `payroll_${EFFECTIVE}_${RUN.slice(0, 8)}.ach`, overrideWarnings: false, overrideReason: null, build: builder([{ cents: 250000, acct: "777000111" }], "PAYROLL", "PPD", now) });

const files = () => st.db.rows("ach_files");
const writes = (from = 0) => st.db.log.slice(from).filter((r: FakeRequest) => r.method !== "GET");

/** The 0273 payroll function, emulated: one ach_files row + the run stamp, or the same refusals. */
function payrollRpc(fn: string, b: Record<string, unknown>): { status: number; body: unknown } {
  if (fn !== "ach_file_release_payroll") return { status: 500, body: { message: `unexpected ${fn}` } };
  const run = st.db.rows("payroll_runs").find((r) => r.id === b.p_run_id);
  if (!run) return { status: 400, body: { code: "23514", message: `ACH_FILE_NOT_FOUND: payroll run ${String(b.p_run_id)}.` } };
  if (run.status !== "draft") return { status: 400, body: { code: "23514", message: `ACH_FILE_ALREADY_RELEASED: payroll run ${String(b.p_run_id)} is ${String(run.status)}, not a draft.` } };
  if (files().some((f) => f.file_date === b.p_file_date && f.file_id_modifier === b.p_modifier)) {
    return { status: 409, body: { code: "23505", message: 'duplicate key value violates unique constraint "ach_files_day_modifier_key"' } };
  }
  const id = st.db.nextId();
  files().push({
    id, kind: "payroll", source_id: String(b.p_run_id), file_date: b.p_file_date, file_id_modifier: b.p_modifier, filename: b.p_filename, effective_date: b.p_effective,
    entry_count: b.p_entry_count, total_cents: b.p_total_cents, sha256: b.p_sha256, entry_set_hmac: b.p_entry_set_hmac, body_enc: b.p_body_enc,
    counts_toward_limit: true, status: "released", released_by: b.p_actor, released_at: NOW.toISOString(), voided_by: null, voided_at: null, voided_reason: null,
  });
  Object.assign(run, { status: "file_generated", approved_by: b.p_actor, nacha_filename: b.p_filename, file_id_modifier: b.p_modifier });
  return { status: 200, body: id };
}

beforeEach(() => {
  process.env.DATA_ENCRYPTION_KEY = KEY;
  st.db = new FakePostgrest();
  st.rpc = [];
  st.rpcReply = payrollRpc;
  st.db.tables.set("ach_files", []);
  st.db.tables.set("payroll_runs", [{ id: RUN, status: "draft", approved_by: null, nacha_filename: null, file_id_modifier: null }]);
  st.db.defaults.set("ach_files", () => ({ status: "released", released_at: NOW.toISOString(), voided_by: null, voided_at: null, voided_reason: null }));
  const live = (r: Record<string, unknown>) => r.status !== "voided";
  st.db.uniques.push(
    { table: "ach_files", columns: ["file_date", "file_id_modifier"], name: "ach_files_day_modifier_key" },
    { table: "ach_files", columns: ["sha256"], where: live, name: "ach_files_sha_live" },
    { table: "ach_files", columns: ["entry_set_hmac", "effective_date"], where: live, name: "ach_files_no_duplicate_entries" },
    { table: "ach_files", columns: ["kind", "source_id"], where: live, name: "ach_files_one_live_per_source" },
  );
  st.db.before = (req) => {
    if (!req.url.pathname.includes("/rpc/")) return;
    const fn = req.url.pathname.split("/").pop()!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    st.rpc.push({ fn, body });
    return st.rpcReply ? st.rpcReply(fn, body) : { status: 500, body: { message: `no reply set for ${fn}` } };
  };
});

// =========================================================================
describe("release once, download the stored bytes", () => {
  it("a double download is byte-identical, equals what the release returned, and writes nothing", async () => {
    const r = await vendor("batch-1");
    if (!r.ok) throw new Error(r.error);
    const mark = st.db.log.length;
    const a = await ledger.readAchFileForDownload(r.id);
    const b = await ledger.readAchFileForDownload(r.id);
    if (!a.ok || !b.ok) throw new Error("download refused");
    expect(a.body).toBe(r.body);
    expect(b.body).toBe(a.body);
    expect(Buffer.from(b.body).equals(Buffer.from(a.body))).toBe(true);
    expect(core.sha256Hex(a.body)).toBe(a.row.sha256);
    expect(writes(mark)).toEqual([]);
    expect(st.rpc).toEqual([]);
    expect(a.row).not.toHaveProperty("body_enc");
  });

  it("the stored bytes are CRLF, encrypted at rest, and no plain column holds the account number", async () => {
    const r = await vendor("batch-1");
    if (!r.ok) throw new Error(r.error);
    expect(r.body).toContain("\r\n");
    expect(r.body.split("\r\n").filter(Boolean).every((l) => l.length === 94)).toBe(true);
    const row = files()[0];
    expect(String(row.body_enc)).toMatch(/^encv1:/);
    expect(decryptSecret(String(row.body_enc))).toBe(r.body);
    expect(String(row.entry_set_hmac)).toMatch(/^[0-9a-f]{64}$/);
    const plain = JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== "body_enc")));
    expect(plain).not.toContain(ACCT);
    expect(row).toMatchObject({ kind: "vendor", source_id: "batch-1", file_date: "2026-10-05", file_id_modifier: "A", effective_date: EFFECTIVE, entry_count: 1, total_cents: 12345, counts_toward_limit: true, released_by: STEPHEN });
  });

  it("payroll: a download never changes approved_by (or anything on the run) and calls no function", async () => {
    const r = await payroll();
    if (!r.ok) throw new Error(r.error);
    const runBefore = JSON.stringify(st.db.rows("payroll_runs"));
    expect(st.db.rows("payroll_runs")[0]).toMatchObject({ status: "file_generated", approved_by: STEPHEN, file_id_modifier: "A" });
    st.rpc = [];
    const mark = st.db.log.length;
    const a = await ledger.readLiveFileForSource("payroll", RUN);
    const b = await ledger.readLiveFileForSource("payroll", RUN);
    expect(a.ok && b.ok && a.body === b.body && a.body === r.body).toBe(true);
    expect(JSON.stringify(st.db.rows("payroll_runs"))).toBe(runBefore);
    expect(writes(mark)).toEqual([]);
    expect(st.rpc).toEqual([]);
  });

  it("payroll goes through ONE database call with every sealed fact (the run stamp and the row cannot disagree)", async () => {
    const r = await payroll();
    if (!r.ok) throw new Error(r.error);
    expect(st.rpc.map((x) => x.fn)).toEqual(["ach_file_release_payroll"]);
    const b = st.rpc[0].body;
    expect(Object.keys(b).sort()).toEqual(["p_actor", "p_body_enc", "p_effective", "p_entry_count", "p_entry_set_hmac", "p_file_date", "p_filename", "p_modifier", "p_override", "p_override_reason", "p_run_id", "p_sha256", "p_total_cents"].sort());
    expect(b).toMatchObject({ p_run_id: RUN, p_actor: STEPHEN, p_file_date: "2026-10-05", p_modifier: "A", p_effective: EFFECTIVE, p_entry_count: 1, p_total_cents: 250000, p_sha256: core.sha256Hex(r.body), p_override: false, p_override_reason: null });
    expect(writes().filter((w) => !w.url.pathname.includes("/rpc/"))).toEqual([]);
    expect(JSON.stringify(b)).not.toContain("777000111");
  });
});

// =========================================================================
describe("File ID Modifier: the day's next free letter", () => {
  it("payroll then vendor on the same Pacific day get A then B, each written in its header", async () => {
    const p = await payroll();
    const v = await vendor("batch-1");
    if (!p.ok || !v.ok) throw new Error("release refused");
    expect([p.modifier, v.modifier]).toEqual(["A", "B"]);
    expect(p.body.slice(33, 34)).toBe("A");
    expect(v.body.slice(33, 34)).toBe("B");
    expect(files().map((f) => f.file_id_modifier)).toEqual(["A", "B"]);
  });

  it("a voided file's letter stays used (Timberland may have seen it)", async () => {
    const a = await vendor("batch-1");
    if (!a.ok) throw new Error(a.error);
    files()[0].status = "voided";
    const b = await vendor("batch-2", [{ cents: 999 }]);
    expect(b.ok && b.modifier).toBe("B");
  });

  it("a new Pacific day starts at A again; 22:30 Pacific on the 5th is still the 5th (UTC is already the 6th)", async () => {
    const late = new Date("2026-10-06T05:30:00Z");
    const a = await vendor("batch-1", [{ cents: 100 }], late);
    if (!a.ok) throw new Error(a.error);
    expect(a.fileDate).toBe("2026-10-05");
    expect(a.body.slice(23, 29)).toBe("261005");
    expect(a.body.slice(29, 33)).toBe("2230");
    const next = await vendor("batch-2", [{ cents: 200 }], new Date("2026-10-06T17:00:00Z"));
    expect(next.ok && [next.fileDate, next.modifier]).toEqual(["2026-10-06", "A"]);
  });

  it("another file taking the same letter at the same moment: the release starts again and gets the next letter", async () => {
    let raced = false;
    const base = st.db.before!;
    st.db.before = (req) => {
      if (!raced && req.method === "POST" && req.table === "ach_files") {
        raced = true;
        files().push({ id: st.db.nextId(), kind: "prenote", source_id: "racer", file_date: "2026-10-05", file_id_modifier: "A", status: "released", sha256: "x", entry_set_hmac: "y", effective_date: EFFECTIVE });
      }
      return base(req);
    };
    const r = await vendor("batch-1");
    expect(raced).toBe(true);
    expect(r.ok && r.modifier).toBe("B");
    expect(r.ok && r.body.slice(33, 34)).toBe("B");
  });

  it("the race never ends: refused after MODIFIER_RETRIES tries, in plain words, nothing of ours written", async () => {
    const base = st.db.before!;
    let posts = 0;
    st.db.before = (req) => {
      if (req.method === "POST" && req.table === "ach_files") {
        posts += 1;
        return { status: 409, body: { code: "23505", message: 'duplicate key value violates unique constraint "ach_files_day_modifier_key"' } };
      }
      return base(req);
    };
    const r = await vendor("batch-1");
    expect(posts).toBe(ledger.MODIFIER_RETRIES);
    expect(r).toEqual({ ok: false, error: core.ledgerDbErrorMessage("ach_files_day_modifier_key") });
    expect(files()).toEqual([]);
  });

  it("all 36 letters used today: refused before anything is built", async () => {
    for (const m of core.FILE_ID_MODIFIERS) files().push({ id: `x${m}`, kind: "vendor", source_id: `s${m}`, file_date: "2026-10-05", file_id_modifier: m, status: "voided" });
    let built = 0;
    const r = await ledger.releaseAchFile({ kind: "vendor", sourceId: "batch-1", actorId: STEPHEN, now: NOW, effectiveDate: EFFECTIVE, filename: "v.ach", build: (m) => (built++, builder([{ cents: 1 }])(m)) });
    expect(r.ok).toBe(false);
    expect(built).toBe(0);
    expect(files()).toHaveLength(36);
  });
});

// =========================================================================
describe("duplicates and repeats are refused", () => {
  it("the same payments (any order) with the same effective date under another batch: refused by ach_files_no_duplicate_entries", async () => {
    const a = await vendor("batch-1", [{ cents: 500, acct: "111" }, { cents: 700, acct: "222" }]);
    if (!a.ok) throw new Error(a.error);
    const b = await vendor("batch-2", [{ cents: 700, acct: "222" }, { cents: 500, acct: "111" }]);
    expect(b).toEqual({ ok: false, error: core.ledgerDbErrorMessage("ach_files_no_duplicate_entries") });
    expect(files()).toHaveLength(1);
  });

  it("the same source released twice: refused by ach_files_one_live_per_source; after a void it may be released again", async () => {
    const a = await vendor("batch-1");
    if (!a.ok) throw new Error(a.error);
    const again = await vendor("batch-1", [{ cents: 1 }]);
    expect(again).toEqual({ ok: false, error: core.ledgerDbErrorMessage("ach_files_one_live_per_source") });
    files()[0].status = "voided";
    const fresh = await vendor("batch-1", [{ cents: 1 }]);
    expect(fresh.ok && fresh.modifier).toBe("B");
  });

  it("a payroll run released twice: refused by the database function (not a draft), one file only", async () => {
    expect((await payroll()).ok).toBe(true);
    const again = await payroll();
    expect(again).toEqual({ ok: false, error: core.ledgerDbErrorMessage("ACH_FILE_ALREADY_RELEASED") });
    expect(files()).toHaveLength(1);
  });

  it("releaseAchFile refuses kind payroll (payroll must go through the one-call function)", async () => {
    const r = await ledger.releaseAchFile({ kind: "payroll", sourceId: RUN, actorId: STEPHEN, now: NOW, effectiveDate: EFFECTIVE, filename: "p.ach", build: builder([{ cents: 1 }]) });
    expect(r.ok).toBe(false);
    expect(writes()).toEqual([]);
  });
});

// =========================================================================
describe("what is served must be what was released", () => {
  it("a tampered body (re-encrypted with the same key) is refused: SHA-256 mismatch", async () => {
    const r = await vendor("batch-1");
    if (!r.ok) throw new Error(r.error);
    files()[0].body_enc = encryptSecret(r.body.replace("PAYEE 1", "PAYEE 9"));
    const d = await ledger.readAchFileForDownload(r.id);
    expect(d.ok === false && d.error).toMatch(/does not match its fingerprint \(SHA-256\)/);
    const s = await ledger.readLiveFileForSource("vendor", "batch-1");
    expect(s.ok).toBe(false);
  });

  it("corrupt ciphertext or a different key is refused, never served as empty", async () => {
    const r = await vendor("batch-1");
    if (!r.ok) throw new Error(r.error);
    const good = String(files()[0].body_enc);
    files()[0].body_enc = good.slice(0, -4) + (good.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect((await ledger.readAchFileForDownload(r.id)).ok).toBe(false);
    files()[0].body_enc = good;
    process.env.DATA_ENCRYPTION_KEY = "another-key-entirely-0123456789abcdef";
    const d = await ledger.readAchFileForDownload(r.id);
    expect(d.ok === false && d.error).toMatch(/could not be read/);
  });

  it("a row whose facts were changed (letter) no longer matches its bytes: refused", async () => {
    const r = await vendor("batch-1");
    if (!r.ok) throw new Error(r.error);
    files()[0].file_id_modifier = "Z";
    const d = await ledger.readAchFileForDownload(r.id);
    expect(d.ok === false && d.error).toMatch(/does not match its record/);
  });

  it("a voided file is never served, by id or by source", async () => {
    const r = await vendor("batch-1");
    if (!r.ok) throw new Error(r.error);
    Object.assign(files()[0], { status: "voided", voided_reason: "wrong amounts entered" });
    const d = await ledger.readAchFileForDownload(r.id);
    expect(d.ok === false && d.error).toMatch(/voided \(wrong amounts entered\)\. Never upload it/);
    expect((await ledger.readLiveFileForSource("vendor", "batch-1")).ok).toBe(false);
    expect(await ledger.findLiveFile("vendor", "batch-1")).toBeNull();
  });

  it("a malformed id is refused without a query", async () => {
    const mark = st.db.log.length;
    expect((await ledger.readAchFileForDownload("1 or 1=1")).ok).toBe(false);
    expect(st.db.log.length).toBe(mark);
  });
});

// =========================================================================
describe("no key, no file; builder refusals write nothing", () => {
  it("without DATA_ENCRYPTION_KEY: refused with LEDGER_NO_KEY, nothing built or written", async () => {
    delete process.env.DATA_ENCRYPTION_KEY;
    let built = 0;
    const r = await ledger.releaseAchFile({ kind: "vendor", sourceId: "batch-1", actorId: STEPHEN, now: NOW, effectiveDate: EFFECTIVE, filename: "v.ach", build: (m) => (built++, builder([{ cents: 1 }])(m)) });
    expect(r).toEqual({ ok: false, error: ledger.LEDGER_NO_KEY });
    expect(built).toBe(0);
    expect(writes()).toEqual([]);
    expect((await payroll()).ok).toBe(false);
    expect(st.rpc).toEqual([]);
  });

  it("a builder that ignores the given letter is refused before writing (the bytes must say what the row says)", async () => {
    const r = await ledger.releaseAchFile({ kind: "vendor", sourceId: "batch-1", actorId: STEPHEN, now: NOW, effectiveDate: EFFECTIVE, filename: "v.ach", build: () => builder([{ cents: 1 }])("P") });
    expect(r.ok === false && r.error).toMatch(/File ID Modifier is "P", not "A"/);
    expect(writes()).toEqual([]);
  });

  it("a builder whose header clock is not the release time (another Pacific day) is refused", async () => {
    const r = await ledger.releaseAchFile({ kind: "vendor", sourceId: "batch-1", actorId: STEPHEN, now: NOW, effectiveDate: EFFECTIVE, filename: "v.ach", build: builder([{ cents: 1 }], "VENDOR PAY", "CCD", new Date("2026-10-03T17:00:00Z")) });
    expect(r.ok === false && r.error).toMatch(/File Header date is 2026-10-03, not today \(2026-10-05, Pacific\)/);
    expect(writes()).toEqual([]);
  });

  it("a builder refusal is passed through and nothing is written", async () => {
    const r = await ledger.releaseAchFile({ kind: "vendor", sourceId: "batch-1", actorId: STEPHEN, now: NOW, effectiveDate: EFFECTIVE, filename: "v.ach", build: () => ({ ok: false, error: "no entries" }) });
    expect(r).toEqual({ ok: false, error: "no entries" });
    expect(writes()).toEqual([]);
  });
});

// =========================================================================
describe("void", () => {
  it("needs a 10+ character reason and a real id before the database is asked", async () => {
    expect(await ledger.voidAchFile({ fileId: RUN, actorId: STEPHEN, reason: "  short " })).toEqual({ ok: false, error: "Say why this file is voided (10+ characters)." });
    expect((await ledger.voidAchFile({ fileId: "nope", actorId: STEPHEN, reason: "the amounts were wrong" })).ok).toBe(false);
    expect(st.rpc).toEqual([]);
  });

  it("sends exactly id, actor and the trimmed reason; the kind must come back", async () => {
    st.rpcReply = () => ({ status: 200, body: "vendor" });
    const r = await ledger.voidAchFile({ fileId: RUN, actorId: STEPHEN, reason: "  the amounts were wrong  " });
    expect(r).toEqual({ ok: true, kind: "vendor", reason: "the amounts were wrong" });
    expect(st.rpc).toEqual([{ fn: "ach_file_void", body: { p_file_id: RUN, p_actor: STEPHEN, p_reason: "the amounts were wrong" } }]);
    st.rpcReply = () => ({ status: 200, body: "" });
    expect((await ledger.voidAchFile({ fileId: RUN, actorId: STEPHEN, reason: "the amounts were wrong" })).ok).toBe(false);
  });

  it("the database's owner-only refusal is shown in plain words", async () => {
    st.rpcReply = () => ({ status: 400, body: { code: "P0001", message: "ACH_OWNER_ONLY: only the owner voids an ACH file." } });
    const r = await ledger.voidAchFile({ fileId: RUN, actorId: STEPHEN, reason: "the amounts were wrong" });
    expect(r).toEqual({ ok: false, error: core.ledgerDbErrorMessage("ACH_OWNER_ONLY") });
  });
});

// =========================================================================
describe("source pins: downloads never build, builders never pick their own letter", () => {
  const ROUTES = [
    "src/app/admin/payroll/[id]/download/route.ts",
    "src/app/admin/settings/banking/files/[id]/download/route.ts",
    "src/app/admin/settings/banking/operations/check-file/route.ts",
  ];
  it("each download route reads the ledger and nothing else: no build, no generate, no write, no function call", () => {
    for (const p of ROUTES) {
      const c = code(read(p));
      expect(c, p).toMatch(/import \{ (readLiveFileForSource|readAchFileForDownload) \} from "@\/lib\/payments\/ach-file-ledger-store";/);
      expect(c, p).not.toMatch(/generatePayrollNacha|buildNachaFile|buildCheckFile|planCheckFile|vendorPaymentsToNacha|release\w*File|payroll-store/);
      expect(c, p).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|createSupabaseAdminClient/);
      expect(c, p).toContain('const session = await requirePermission("settings.manage");');
      expect(c, p).toContain('"X-Content-Type-Options": "nosniff"');
      expect([...c.matchAll(/"Cache-Control": "no-store"/g)].length, p).toBeGreaterThanOrEqual(2);
    }
  });
  it("no builder hard-codes a File ID Modifier any more (the old prenote P / test-credit M / payroll A)", () => {
    for (const p of ["src/lib/payments/ach-ops-core.ts", "src/lib/payments/ach-ops-store.ts", "src/lib/payroll/payroll-store.ts", "src/app/admin/vendor-payments/actions.ts"]) {
      const c = code(read(p)).replace(/export function __run\w+Tests[\s\S]*$/, "");
      expect(c, p).not.toMatch(/fileIdModifier:\s*("[A-Z0-9]"|method ===|[^,}\n]*\|\|\s*"A")/);
    }
    expect(code(read("src/lib/payments/ach-ops-core.ts"))).toMatch(/fileIdModifier: string;/);
  });
  it("payroll: generatePayrollNacha releases through the ledger and no longer stamps payroll_runs itself", () => {
    const s = read("src/lib/payroll/payroll-store.ts");
    const i = s.indexOf("export async function generatePayrollNacha(");
    const body = s.slice(i, s.indexOf("\nexport ", i + 10));
    expect(body).toContain("await releasePayrollAchFile({");
    expect(body).toContain("createdAt: now,");
    expect(body).not.toMatch(/from\("payroll_runs"\)[\s\S]{0,80}\.update\(/);
    expect(body).toContain("file: released.body");
  });
  it("vendor: the file is released BEFORE any payment is recorded", () => {
    const s = read("src/app/admin/vendor-payments/actions.ts");
    const rel = s.indexOf("const released = await releaseAchFile({");
    expect(rel).toBeGreaterThan(-1);
    const after = s.slice(rel);
    expect(after.indexOf("if (!released.ok || !built)")).toBeGreaterThan(-1);
    expect(after.indexOf("if (!released.ok || !built)")).toBeLessThan(after.indexOf("recordManifestPayment("));
    expect(after.indexOf("if (!released.ok || !built)")).toBeLessThan(after.indexOf("recordNonCannabisInvoicePayment("));
  });
  it("the ledger store seals with the key, round-trips the ciphertext and re-checks bytes against the row on both sides", () => {
    const s = code(read("src/lib/payments/ach-file-ledger-store.ts"));
    expect(s).toContain('import "server-only";');
    expect(s).toContain("if (!isAtRestEncryptionConfigured()) return { ok: false, error: LEDGER_NO_KEY };");
    expect(s).toContain('if (!bodyEnc.startsWith("encv1:") || decryptSecret(bodyEnc) !== body) return { ok: false, error: LEDGER_NO_KEY };');
    expect([...s.matchAll(/checkFileMatchesRow\(/g)].length).toBe(2);
    expect(s).toContain("const c = checkStoredBody(body, row.sha256);");
    expect(s).toContain('keyedHasher("achFileEntrySet")');
  });
});

// =========================================================================
describe("0273 SQL text pins", () => {
  const SQL = read("supabase/migrations/0273_ach_files.sql");
  const RB = read("supabase/rollbacks/0273_ach_files.rollback.sql");
  const S = code(SQL.replace(/--.*$/gm, ""));
  it("one letter per Pacific day (a constraint, voided included) and the three live-only unique indexes", () => {
    expect(S).toContain("add constraint ach_files_day_modifier_key unique (file_date, file_id_modifier);");
    expect(S).toMatch(/create unique index if not exists ach_files_sha_live\s+on public\.ach_files \(sha256\) where status <> 'voided';/);
    expect(S).toMatch(/create unique index if not exists ach_files_no_duplicate_entries\s+on public\.ach_files \(entry_set_hmac, effective_date\) where status <> 'voided';/);
    expect(S).toMatch(/create unique index if not exists ach_files_one_live_per_source\s+on public\.ach_files \(kind, source_id\) where status <> 'voided';/);
  });
  it("the constraint and index names the app maps are the ones the SQL creates", () => {
    for (const n of ["ach_files_day_modifier_key", "ach_files_sha_live", "ach_files_no_duplicate_entries", "ach_files_one_live_per_source"]) {
      expect(S, n).toContain(n);
      expect(core.LEDGER_ERROR_TABLE.some(([re]) => re.test(n)), n).toBe(true);
    }
    for (const code_ of ["ACH_FILE_KEEP", "ACH_FILE_FINAL", "ACH_FILE_IMMUTABLE", "ACH_FILE_TRANSITION", "ACH_FILE_REASON", "ACH_FILE_ALREADY_RELEASED", "ACH_FILE_NOT_FOUND", "ACH_OWNER_ONLY"]) {
      expect(S, code_).toContain(`'${code_}:`);
      expect(core.ledgerDbErrorMessage(code_), code_).not.toBe(core.ledgerDbErrorMessage("something else"));
    }
  });
  it("owner-only release and void in the trigger; never deleted; the API roles cannot delete", () => {
    expect(S).toContain("if not public.ach_actor_is_owner(new.released_by) then");
    expect(S).toContain("if not public.ach_actor_is_owner(new.voided_by) then");
    expect(S).toContain("revoke delete on table public.ach_files from service_role;");
    expect(S).toContain("revoke all on table public.ach_files from anon;");
    expect(S).not.toMatch(/grant [^;]*delete[^;]* on table public\.ach_files/i);
    expect(S).not.toMatch(/security definer/i);
  });
  it("the rollback refuses while released files exist", () => {
    expect(RB).toContain("ROLLBACK REFUSED: ach_files holds released ACH files");
  });
});
