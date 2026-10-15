/**
 * R41 S4: Timberland's limits as HARD blocks, run for real:
 *   - the REAL ledger store (releaseAchFile / releasePayrollAchFile) over the
 *     REAL @supabase/postgrest-js client against FakePostgrest;
 *   - the real NACHA builder, real AES-GCM and the real keyed hash.
 * The plan's S4 tests (R41-TIMBERLAND-SLICE-PLAN v4 S4): $49,999.99 /
 * $50,000.00 / $50,000.01; two overlapping $30k files (the second refused);
 * non-overlapping $30k files (both allowed); a settled file stops counting
 * the day after its settlement date; a prenote and a voided file excluded.
 * Plus: the payroll path, a failed or odd read refuses (fail closed), the
 * modifier race re-reads the ledger, the monthly limit, the 80% notes, the
 * read's shape, source pins, and the mutation log.
 *
 * Today in these tests is Mon Oct 5, 2026 10:00 Pacific; the new file is
 * effective Tue Oct 6 (settles that day).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type FakeRequest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  rpc: [] as { fn: string; body: Record<string, unknown> }[],
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
const limits = await import("@/lib/payments/timberland-limits-core");
const { buildNachaFile } = await import("@/lib/payments/nacha-core");

const read = (p: string) => readFileSync(p, "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const KEY = "s4-limits-test-key-0123456789abcdef!!";
const NOW = new Date("2026-10-05T17:00:00Z"); // Monday 10:00 Pacific
const TODAY = "2026-10-05";
const EFFECTIVE = "2026-10-06";
const MICHAEL = "22222222-2222-4222-8222-222222222222";
const RUN = "3f2b1c0d-1111-4222-8333-444455556666";

const GW = {
  destinationRouting: "325170754",
  destinationName: "TIMBERLAND BANK",
  immediateOrigin: "1911234567",
  companyName: "Greenway Marijuana",
  companyId: "1911234567",
  originatingDfi: "32517075",
  companyEin: "911234567",
};

let acctSeq = 0;
const builder =
  (cents: number[], desc = "VENDOR PAY", sec: "PPD" | "CCD" = "CCD", effective = EFFECTIVE) =>
  (fileIdModifier: string) => {
    const b = buildNachaFile({
      originator: GW,
      entries: cents.map((c, i) => ({ accountType: "checking" as const, routing: "021000021", accountNumber: `00${++acctSeq}00${i}`, amountCents: c, name: `PAYEE ${i + 1}`, idNumber: `ID${i + 1}` })),
      secCode: sec,
      companyEntryDescription: desc,
      effectiveDate: new Date(`${effective}T00:00:00Z`),
      createdAt: NOW,
      fileIdModifier,
    });
    return b.ok ? { ok: true as const, file: b.file, entryCount: b.entryCount, totalCents: b.totalCents } : { ok: false as const, error: b.error };
  };

let builds = 0;
const vendor = (sourceId: string, cents: number[], effective = EFFECTIVE) =>
  ledger.releaseAchFile({
    kind: "vendor",
    sourceId,
    actorId: MICHAEL,
    now: NOW,
    effectiveDate: effective,
    filename: `vendor-${sourceId}.ach`,
    build: (m) => (builds++, builder(cents, "VENDOR PAY", "CCD", effective)(m)),
  });

const payroll = (cents: number[]) =>
  ledger.releasePayrollAchFile({ runId: RUN, actorId: MICHAEL, now: NOW, effectiveDate: EFFECTIVE, filename: `payroll_${EFFECTIVE}_${RUN.slice(0, 8)}.ach`, overrideWarnings: true, overrideReason: "test override of soft warnings", build: builder(cents, "PAYROLL", "PPD") });

const files = () => st.db.rows("ach_files");
const posts = () => st.db.log.filter((r: FakeRequest) => r.method !== "GET" && !r.url.pathname.includes("/rpc/"));

let rowSeq = 0;
/** An ach_files row already in the ledger (every column the limit read uses). */
function existing(o: { kind?: string; status?: string; file_date: string; effective_date: string; settlement_date?: string | null; total_cents: number }) {
  rowSeq += 1;
  files().push({
    id: `00000000-0000-4000-8000-${String(rowSeq).padStart(12, "0")}`,
    kind: o.kind ?? "vendor",
    source_id: `old-${rowSeq}`,
    file_id_modifier: "Z",
    status: o.status ?? "released",
    file_date: o.file_date,
    effective_date: o.effective_date,
    settlement_date: o.settlement_date ?? null,
    total_cents: o.total_cents,
    sha256: `sha-${rowSeq}`,
    entry_set_hmac: `hmac-${rowSeq}`,
  });
}

function payrollRpc(fn: string, b: Record<string, unknown>): { status: number; body: unknown } {
  if (fn !== "ach_file_release_payroll") return { status: 500, body: { message: `unexpected ${fn}` } };
  const run = st.db.rows("payroll_runs").find((r) => r.id === b.p_run_id)!;
  const id = st.db.nextId();
  files().push({ id, kind: "payroll", source_id: String(b.p_run_id), file_date: b.p_file_date, file_id_modifier: b.p_modifier, effective_date: b.p_effective, settlement_date: null, total_cents: b.p_total_cents, status: "released" });
  Object.assign(run, { status: "file_generated", approved_by: b.p_actor });
  return { status: 200, body: id };
}

beforeEach(() => {
  process.env.DATA_ENCRYPTION_KEY = KEY;
  st.db = new FakePostgrest();
  st.rpc = [];
  builds = 0;
  st.db.tables.set("ach_files", []);
  st.db.tables.set("payroll_runs", [{ id: RUN, status: "draft", approved_by: null }]);
  st.db.defaults.set("ach_files", () => ({ status: "released", settlement_date: null, released_at: NOW.toISOString(), voided_by: null, voided_at: null, voided_reason: null }));
  const live = (r: Record<string, unknown>) => r.status !== "voided";
  st.db.uniques.push(
    { table: "ach_files", columns: ["file_date", "file_id_modifier"], name: "ach_files_day_modifier_key" },
    { table: "ach_files", columns: ["entry_set_hmac", "effective_date"], where: live, name: "ach_files_no_duplicate_entries" },
    { table: "ach_files", columns: ["kind", "source_id"], where: live, name: "ach_files_one_live_per_source" },
  );
  st.db.before = (req) => {
    if (!req.url.pathname.includes("/rpc/")) return;
    const fn = req.url.pathname.split("/").pop()!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    st.rpc.push({ fn, body });
    return payrollRpc(fn, body);
  };
});

// =========================================================================
describe("per-file and per-entry limits: $49,999.99 / $50,000.00 / $50,000.01", () => {
  it("$49,999.99 and exactly $50,000.00 are released (on separate days' room)", async () => {
    const a = await vendor("a", [4_999_999]);
    expect(a.ok).toBe(true);
    files()[0].status = "voided"; // free the day again
    const b = await vendor("b", [2_500_000, 2_500_000]);
    expect(b.ok && b.totalCents).toBe(5_000_000);
  });

  it("$50,000.01 in one file (two entries) is refused: per-file, no date fixes it, nothing built-and-written", async () => {
    const r = await vendor("c", [2_500_000, 2_500_001]);
    expect(r.ok).toBe(false);
    const msg = r.ok ? "" : r.error;
    expect(msg).toMatch(/^Timberland limit: this file was NOT released\./);
    expect(msg).toContain("$50,000.01, over Timberland's $50,000.00 per-file limit");
    expect(msg).toContain("cannot be overridden");
    expect(msg).toContain("No date fixes this");
    expect(msg).toContain("or pay by check");
    expect(posts()).toHaveLength(0);
    expect(files()).toHaveLength(0);
  });

  it("one entry of $50,000.01 is refused by the per-payment limit", async () => {
    const r = await vendor("d", [5_000_001]);
    expect(r.ok === false && r.error).toContain("One payment is over Timberland's $50,000.00 per-payment limit (largest $50,000.01)");
    expect(files()).toHaveLength(0);
  });
});

describe("daily in-process limit (section 26: outstanding at any time)", () => {
  it("two overlapping files of $30k: the second is refused and told the earliest date it fits", async () => {
    const a = await vendor("a", [3_000_000]);
    expect(a.ok).toBe(true);
    const b = await vendor("b", [3_000_001]);
    expect(b.ok).toBe(false);
    const msg = b.ok ? "" : b.error;
    expect(msg).toContain(`On ${limits.friendlyDate(TODAY)} this file would put $60,000.01 in process at Timberland, over the $50,000.00 daily limit`);
    // The first file settles Tue Oct 6; the second fits from Wed Oct 7 with the 2-banking-day lead (Fri Oct 9).
    expect(msg).toContain(`It would fit if uploaded on ${limits.friendlyDate("2026-10-07")} with effective date ${limits.friendlyDate("2026-10-09")}.`);
    expect(msg).toContain(`it can cover an upload on ${limits.friendlyDate("2026-10-07")} or later`);
    expect(files()).toHaveLength(1);
    expect(posts()).toHaveLength(1);
  });

  it("non-overlapping files of $30k: both allowed (the earlier one settled before today)", async () => {
    existing({ file_date: "2026-09-30", effective_date: "2026-10-02", total_cents: 3_000_000 });
    const r = await vendor("b", [3_000_000]);
    expect(r.ok).toBe(true);
  });

  it("a file counts ON its settlement day and stops the day after", async () => {
    existing({ file_date: "2026-10-01", effective_date: "2026-10-05", total_cents: 3_000_000 }); // settles today
    expect((await vendor("b", [3_000_000])).ok).toBe(false);
    files()[0].effective_date = "2026-10-02"; // settled Friday
    expect((await vendor("c", [3_000_000])).ok).toBe(true);
  });

  it("a stored settlement_date wins over the effective date (later settlement keeps it in process)", async () => {
    existing({ file_date: "2026-10-01", effective_date: "2026-10-02", settlement_date: "2026-10-06", total_cents: 3_000_000 });
    expect((await vendor("b", [3_000_000])).ok).toBe(false);
  });

  it("a Saturday effective date settles the NEXT banking day: effective Sat Oct 3 settles Mon Oct 5 (today) and still counts", async () => {
    existing({ file_date: "2026-10-01", effective_date: "2026-10-03", total_cents: 3_000_000 });
    expect((await vendor("b", [3_000_000])).ok).toBe(false);
    files()[0].effective_date = "2026-10-02"; // Friday: settled before today
    expect((await vendor("c", [3_000_000])).ok).toBe(true);
  });

  it("a voided file and a prenote never count", async () => {
    existing({ status: "voided", file_date: TODAY, effective_date: EFFECTIVE, total_cents: 5_000_000 });
    existing({ kind: "prenote", file_date: TODAY, effective_date: EFFECTIVE, total_cents: 0 });
    const r = await vendor("b", [5_000_000]);
    expect(r.ok).toBe(true);
  });

  it("a test credit (micro_entry) DOES count: one cent in process makes $50,000.00 too much", async () => {
    existing({ kind: "micro_entry", file_date: TODAY, effective_date: EFFECTIVE, total_cents: 1 });
    const r = await vendor("b", [5_000_000]);
    expect(r.ok === false && r.error).toContain("$50,000.01 in process");
  });

  it("the payroll path is checked too: refused before the database function is called; the run stays a draft", async () => {
    existing({ file_date: TODAY, effective_date: EFFECTIVE, total_cents: 3_000_000 });
    const r = await payroll([1_500_000, 1_500_000]);
    expect(r.ok === false && r.error).toMatch(/daily limit/);
    expect(st.rpc).toHaveLength(0);
    expect(st.db.rows("payroll_runs")[0].status).toBe("draft");
  });
});

describe("monthly limit (Q3 strict: upload month and effective month)", () => {
  it("$80k already this month + $30k: refused by the monthly limit, naming October 2026", async () => {
    existing({ file_date: "2026-10-01", effective_date: "2026-10-02", total_cents: 4_000_000 });
    existing({ file_date: "2026-10-02", effective_date: "2026-10-02", total_cents: 4_000_000 });
    const r = await vendor("b", [3_000_000]);
    expect(r.ok === false && r.error).toContain("October 2026 would reach $110,000.00, over Timberland's $100,000.00 monthly limit");
  });

  it("a file uploaded Sep 30, effective Oct 2 counts in October", async () => {
    existing({ file_date: "2026-09-30", effective_date: "2026-10-02", total_cents: 5_000_000 });
    existing({ file_date: "2026-10-01", effective_date: "2026-10-02", total_cents: 3_000_000 });
    const r = await vendor("b", [2_000_001]);
    expect(r.ok === false && r.error).toMatch(/October 2026 would reach \$100,000\.01/);
  });

  it("80% or more: released, with the gold note handed back (limitWarnings)", async () => {
    existing({ file_date: "2026-10-01", effective_date: "2026-10-02", total_cents: 6_000_000 });
    const r = await vendor("b", [2_500_000]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.limitWarnings.some((w) => w.includes("October 2026 reaches $85,000.00") && w.includes("$15,000.00 is left that month"))).toBe(true);
  });

  it("under 80%: released with no notes", async () => {
    const r = await vendor("b", [100]);
    expect(r.ok && r.limitWarnings).toEqual([]);
  });

  it("a row too old to touch any day or month checked is not even read, and could not count", async () => {
    existing({ file_date: "2026-08-31", effective_date: "2026-09-02", total_cents: 10_000_000 });
    const r = await vendor("b", [5_000_000]);
    expect(r.ok).toBe(true);
  });
});

describe("fail closed: no partial or guessed totals", () => {
  it("the ledger read fails: refused with LIMITS_READ_FAILED, nothing built, nothing written", async () => {
    const base = st.db.before!;
    st.db.before = (req) => {
      if (req.method === "GET" && req.table === "ach_files" && req.url.searchParams.has("or")) return { status: 500, body: { message: "boom" } };
      return base(req);
    };
    const r = await vendor("b", [100]);
    expect(r).toEqual({ ok: false, error: ledger.LIMITS_READ_FAILED });
    expect(builds).toBe(0);
    expect(posts()).toHaveLength(0);
  });

  it("a row with a null amount is never read as $0: refused", async () => {
    existing({ file_date: TODAY, effective_date: EFFECTIVE, total_cents: 0 });
    files()[0].total_cents = null;
    expect(await vendor("b", [100])).toEqual({ ok: false, error: ledger.LIMITS_READ_FAILED });
  });

  it("more rows than the read cap: refused rather than a partial total", async () => {
    for (let i = 0; i <= ledger.LIMITS_READ_CAP; i++) existing({ file_date: "2026-10-01", effective_date: "2026-10-02", total_cents: 0 });
    expect(await vendor("b", [100])).toEqual({ ok: false, error: ledger.LIMITS_READ_FAILED });
  });

  it("limitRowFrom: digit-string bigint accepted; null, negative, voided, unknown kind and bad dates refused", () => {
    const good = { id: "x", kind: "vendor", status: "uploaded", file_date: TODAY, effective_date: EFFECTIVE, settlement_date: null, total_cents: "123" };
    expect(ledger.limitRowFrom(good)?.totalCents).toBe(123);
    for (const bad of [
      { total_cents: null },
      { total_cents: -1 },
      { total_cents: 1.5 },
      { status: "voided" },
      { kind: "wire" },
      { file_date: "10/05/2026" },
      { effective_date: null },
      { settlement_date: "soon" },
      { id: null },
    ]) {
      expect(ledger.limitRowFrom({ ...good, ...bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it("the read asks for live rows touching the window: neq voided, or(file/effective/settlement >= window start), capped", async () => {
    await vendor("b", [100]);
    const get = st.db.log.find((r: FakeRequest) => r.method === "GET" && r.table === "ach_files" && r.url.searchParams.has("or"))!;
    expect(get.url.searchParams.get("status")).toBe("neq.voided");
    const start = limits.ledgerWindowStart(TODAY);
    expect(get.url.searchParams.get("or")).toBe(`(file_date.gte.${start},effective_date.gte.${start},settlement_date.gte.${start})`);
    expect(get.url.searchParams.get("limit")).toBe(String(ledger.LIMITS_READ_CAP + 1));
    expect(get.url.searchParams.get("select")).toBe("id,kind,status,file_date,effective_date,settlement_date,total_cents");
  });

  it("the modifier race: a $30k file that took our letter first is seen on the retry, and ours is refused", async () => {
    let raced = false;
    const base = st.db.before!;
    st.db.before = (req) => {
      if (!raced && req.method === "POST" && req.table === "ach_files") {
        raced = true;
        files().push({ id: st.db.nextId(), kind: "vendor", source_id: "racer", file_date: TODAY, file_id_modifier: "A", status: "released", effective_date: EFFECTIVE, settlement_date: null, total_cents: 3_000_000, entry_set_hmac: "r" });
      }
      return base(req);
    };
    const r = await vendor("b", [3_000_000]);
    expect(raced).toBe(true);
    expect(r.ok === false && r.error).toMatch(/daily limit/);
    expect(files().map((f) => f.source_id)).toEqual(["racer"]);
  });
});

describe("room left (the bar's numbers come from the same read)", () => {
  it("today's in-process and this month's totals, with room and the 80% flags", async () => {
    existing({ file_date: "2026-10-01", effective_date: "2026-10-02", total_cents: 2_000_000 });
    existing({ file_date: TODAY, effective_date: EFFECTIVE, total_cents: 4_000_000 });
    existing({ kind: "prenote", file_date: TODAY, effective_date: EFFECTIVE, total_cents: 0 });
    const r = await ledger.loadTimberlandRoomLeft(TODAY);
    expect(r.ok && r.room).toEqual({
      todayInProcessCents: 4_000_000,
      todayRoomCents: 1_000_000,
      monthUsedCents: 6_000_000,
      monthRoomCents: 4_000_000,
      month: "2026-10",
      todayWarn: true,
      monthWarn: false,
    });
  });

  it("a failed read is shown as a failure, never as all clear", async () => {
    st.db.before = () => ({ status: 500, body: { message: "boom" } });
    const r = await ledger.loadTimberlandRoomLeft(TODAY);
    expect(r.ok === false && r.error).toMatch(/could not be read \(never shown as all clear\)/);
  });
});

// =========================================================================
describe("source pins", () => {
  const store = code(read("src/lib/payments/ach-file-ledger-store.ts"));
  const loop = store.slice(store.indexOf("async function releaseLoop("), store.indexOf("export type Released"));

  it("releaseLoop: letters, then the ledger read, then build, then the limit check, then seal, then write", () => {
    const order = ["usedModifiers(fileDate)", "readLedgerForLimits(fileDate)", "input.build(next.modifier)", "evaluateTimberlandLimits(", "if (!limits.ok) return", "sealFile(built.file", "await write("];
    const at = order.map((s) => loop.indexOf(s));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("the check uses the entries read from the built bytes and is never skipped or overridden", () => {
    expect(loop).toContain("entryAmountsCents: entryAmountsFromFile(built.file)");
    expect(loop).toContain("totalCents: built.totalCents");
    expect(loop).not.toMatch(/override/i);
    expect(code(read("src/lib/payments/timberland-limits-core.ts"))).not.toMatch(/override(Warnings|Reason|Limit)/);
  });

  it("both release paths go through releaseLoop (no second door)", () => {
    expect(store.match(/await releaseLoop\(/g)).toHaveLength(2);
    expect(store.match(/\.from\("ach_files"\)\s*\.insert\(/g)).toHaveLength(1);
    expect(store.match(/rpc\("ach_file_release_payroll"/g)).toHaveLength(1);
  });

  it("the room-left bar is on the Guide, payroll and vendor payments, using Pacific today", () => {
    for (const p of ["src/app/admin/settings/banking/guide/page.tsx", "src/app/admin/payroll/page.tsx", "src/app/admin/vendor-payments/page.tsx"]) {
      const s = code(read(p));
      expect(s, p).toMatch(/<TimberlandRoomLeft today=\{(today|pacificToday\(\))\} \/>/);
    }
    expect(code(read("src/app/admin/settings/banking/guide/page.tsx"))).toContain("const today = pacificToday();");
  });

  it("the 80% notes reach the person: payroll notes and the vendor form", () => {
    expect(code(read("src/lib/payroll/payroll-store.ts"))).toContain("notes: [...notes, ...released.limitWarnings]");
    // The RETURNED object (the audit row carries them too; that alone would not reach the form).
    expect(code(read("src/app/admin/vendor-payments/actions.ts"))).toMatch(/return \{\s*problems: \[\],\s*warnings,\s*limitWarnings: released\.limitWarnings,\s*file: released\.body,/);
    expect(read("src/app/admin/vendor-payments/VendorAchForm.tsx")).toContain("state.limitWarnings?.map(");
  });
});

describe("test the tests", () => {
  it("scripts/r41/mutate-s4-limits.last.log: every mutant killed, controls passed, the log covers the script's full list", () => {
    const script = read("scripts/r41/mutate-s4-limits.py");
    const log = read("scripts/r41/mutate-s4-limits.last.log");
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const m = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(m, "clean summary line").not.toBeNull();
    expect(Number(m![1])).toBe(listed);
    expect(Number(m![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(15);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR/);
  });
});
