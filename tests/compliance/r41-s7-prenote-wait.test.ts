/**
 * R41 S7: Timberland's prenote wait and the first-file test.
 *
 * Timberland ACH agreement, section 6 (mirror:
 * docs/authorities/ach/timberland-ach-agreement-2026-10-09.redacted.txt):
 * "it agrees not to initiate live dollar Entries until at least 6 banking
 * days following the settlement date of the prenotification Entry."
 *
 * Plan (R41-TIMBERLAND-SLICE-PLAN v4, S7) tests: a holiday inside the window;
 * a go-live date one day early is refused; the gate stays closed until the
 * first file is approved. Mutations: 6 changed to 3; calendar days instead of
 * banking days; the first-file gate bypassed.
 *
 * The REAL ledger store runs over the REAL postgrest-js client against
 * FakePostgrest with NO gate helper, so every release here meets the real
 * readFirstFileGate.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest }));

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
const core = await import("@/lib/payments/timberland-prenote-core");
const auth = await import("@/lib/payments/ach-authorization-core");
const ops = await import("@/lib/payments/ach-ops-core");
const { buildNachaFile } = await import("@/lib/payments/nacha-core");
const { addBankingDays } = auth;

const read = (p: string) => readFileSync(p, "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const KEY = "s7-prenote-wait-test-key-0123456789ab!!";
// Wed 2026-10-28 10:00 Pacific (17:00 UTC), the first day the 10-20 prenote's wait is over.
const NOW = new Date("2026-10-28T17:00:00Z");
const EFFECTIVE = "2026-10-30";
const STEPHEN = "11111111-1111-4111-8111-111111111111";

const GW = {
  destinationRouting: "325170754",
  destinationName: "TIMBERLAND BANK",
  immediateOrigin: "1911234567",
  companyName: "Greenway Marijuana",
  companyId: "1911234567",
  originatingDfi: "32517075",
  companyEin: "911234567",
};

const build = (now: Date) => (fileIdModifier: string) => {
  const b = buildNachaFile({
    originator: GW,
    entries: [{ accountType: "checking" as const, routing: "021000021", accountNumber: "0012345678", amountCents: 12345, name: "PAYEE 1", idNumber: "ID1" }],
    secCode: "CCD",
    companyEntryDescription: "VENDOR PAY",
    effectiveDate: new Date(`${EFFECTIVE}T00:00:00Z`),
    createdAt: now,
    fileIdModifier,
  });
  return b.ok ? { ok: true as const, file: b.file, entryCount: b.entryCount, totalCents: b.totalCents } : { ok: false as const, error: b.error };
};

const vendor = (now = NOW, kind: "vendor" | "micro_entry" = "vendor") =>
  ledger.releaseAchFile({ kind, sourceId: `src-${kind}-${now.getTime()}`, actorId: STEPHEN, now, effectiveDate: EFFECTIVE, filename: `${kind}.ach`, build: build(now) });

const prenoteFile = (o: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-00000000a001",
  kind: "prenote",
  source_id: "prenote-src",
  file_date: "2026-10-16",
  file_id_modifier: "A",
  filename: "acctcheck_prenote_2026-10-20_1.ach",
  effective_date: "2026-10-20",
  settlement_date: null,
  total_cents: 0,
  status: "bank_approved",
  ...o,
});

beforeEach(() => {
  process.env.DATA_ENCRYPTION_KEY = KEY;
  st.db = new FakePostgrest();
  st.db.tables.set("ach_files", []);
  st.db.tables.set("ach_verifications", []);
  st.db.defaults.set("ach_files", () => ({ status: "released", voided_by: null, voided_at: null, voided_reason: null }));
});

const vendorRows = () => st.db.rows("ach_files").filter((r) => r.kind !== "prenote");

// =========================================================================
describe("section 6: 6 usable banking days from settlement (not Nacha's 3)", () => {
  it("the profile says 6 from settlement, and the words name section 6", () => {
    expect(core.PRENOTE_WAIT_WORDS).toBe("6 banking days after it settles (Timberland agreement section 6)");
    expect(auth.NACHA_MIN_PRENOTE_WAIT_BANKING_DAYS).toBe(3);
  });

  it("forward: Tue 10-20 settles -> first live upload Wed 10-28 (Nacha's floor would be Fri 10-23)", () => {
    expect(core.prenoteLiveUploadDay("2026-10-20")).toBe("2026-10-28");
    expect(auth.nachaMinPrenoteLiveDate("2026-10-20")).toBe("2026-10-23");
  });

  it("a holiday inside the window pushes it out: Veterans Day and Thanksgiving are skipped", () => {
    expect(core.prenoteLiveUploadDay("2026-11-02")).toBe("2026-11-10");
    expect(core.prenoteLiveUploadDay("2026-11-20")).toBe("2026-12-01");
  });

  it("banking days, not calendar days: 6 calendar days from 10-20 would be 10-26, refused", () => {
    expect(core.prenoteLiveUploadDay("2026-10-20")).not.toBe("2026-10-26");
    expect(core.prenoteLiveUploadDay("2026-10-20") > "2026-10-26").toBe(true);
  });

  it("Q9 strict: Fri 2027-12-24 (before Saturday Christmas) is not counted, so 12-20 -> 12-29 (Fed days alone say 12-28)", () => {
    expect(addBankingDays("2027-12-20", 6)).toBe("2027-12-28");
    expect(core.prenoteLiveUploadDay("2027-12-20")).toBe("2027-12-29");
  });

  it("the account-check file plan sends Timberland's day as eligible_on (what 0263/0275 store)", () => {
    const src = code(read("src/lib/payments/ach-ops-core.ts"));
    expect(src).toMatch(/const eligible = method === "prenote" \? prenoteLiveUploadDay\(settlement\) : addCalendarDays\(settlement, 1\);/);
  });

  it("the 0275 floor (8 calendar days) never refuses a correct day, every day of 2026-2028, and is tight", () => {
    expect(core.PRENOTE_DB_FLOOR_CALENDAR_DAYS).toBe(8);
    let min = 99;
    for (let t = Date.parse("2026-01-01T00:00:00Z"); t <= Date.parse("2028-12-15T00:00:00Z"); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      const gap = Math.round((Date.parse(`${core.prenoteLiveUploadDay(d)}T00:00:00Z`) - t) / 86_400_000);
      min = Math.min(min, gap);
    }
    expect(min).toBe(8);
  });
});

// =========================================================================
describe("section 3.7: the backwards plan from the first payday", () => {
  const table: [string, string, string, string][] = [
    ["2026-10-30", "2026-10-28", "2026-10-20", "2026-10-16"],
    ["2026-11-06", "2026-11-04", "2026-10-27", "2026-10-23"],
    ["2026-11-13", "2026-11-10", "2026-11-02", "2026-10-29"],
    ["2026-11-20", "2026-11-18", "2026-11-09", "2026-11-05"],
  ];
  for (const [pay, up, settle, pre] of table) {
    it(`payday ${pay}: live upload ${up}, prenote settles ${settle}, prenote upload ${pre}`, () => {
      const p = core.firstPayrollPlan(pay);
      expect([p.liveUploadBy, p.prenoteSettleBy, p.prenoteUploadBy]).toEqual([up, settle, pre]);
      expect(core.prenoteLiveUploadDay(p.prenoteSettleBy) <= p.liveUploadBy).toBe(true);
      expect(p.lines).toHaveLength(4);
    });
  }

  it("a go-live one day early is refused: the prenote settling a day later misses the live upload day", () => {
    const p = core.firstPayrollPlan("2026-10-30");
    const oneDayLate = "2026-10-21"; // settled one banking day after the plan's 10-20
    expect(core.prenoteLiveUploadDay(oneDayLate) > p.liveUploadBy).toBe(true);
    expect(core.firstFileGate(p.liveUploadBy, [{ id: "f", status: "bank_approved", effectiveDate: oneDayLate, filename: "p.ach" }], [{ settlementDate: oneDayLate }]).open).toBe(false);
  });

  it("checkFirstPayday on Thu 2026-10-15 10:00 Pacific: 10-30 works with no slack after the 10-16 upload; 10-23 is too late, pay by check", () => {
    const now = new Date("2026-10-15T17:00:00Z");
    const a = core.checkFirstPayday("2026-10-30", now);
    expect(a.ok).toBe(true);
    const b = core.checkFirstPayday("2026-10-23", now);
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.error).toMatch(/Too late/);
      expect(b.error).toMatch(/by check/);
      expect(core.checkFirstPayday(b.earliestPayday, now).ok).toBe(true);
    }
    expect(core.checkFirstPayday("2026-02-30", now).ok).toBe(false);
  });
});

// =========================================================================
describe("the first-file gate, run through the real store (no gate helper)", () => {
  it("no prenote file at all: a vendor release is refused with the no_file line, nothing written", async () => {
    const r = await vendor();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("This file was NOT released.");
      expect(r.error).toContain(core.FIRST_FILE_LOCKED_PREFIX);
      expect(r.error).toMatch(/Start a prenote/);
    }
    expect(vendorRows()).toHaveLength(0);
  });

  it("released or uploaded but not approved at Timberland: still refused (not_approved)", async () => {
    for (const status of ["released", "uploaded"]) {
      st.db.tables.set("ach_files", [prenoteFile({ status })]);
      st.db.tables.set("ach_verifications", [{ id: "v1", method: "prenote", status: "passed", settlement_date: "2026-10-20" }]);
      const r = await vendor();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/not recorded as approved/);
    }
    expect(vendorRows()).toHaveLength(0);
  });

  it("approved, one day before the wait ends (Tue 10-27): refused, says the day it opens", async () => {
    st.db.tables.set("ach_files", [prenoteFile()]);
    st.db.tables.set("ach_verifications", [{ id: "v1", method: "prenote", status: "passed", settlement_date: "2026-10-20" }]);
    const r = await vendor(new Date("2026-10-27T17:00:00Z"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/the wait ends Wed Oct 28|the wait ends .*Oct 28/);
    expect(vendorRows()).toHaveLength(0);
  });

  it("approved, wait over, but no prenote marked passed: refused (no_pass)", async () => {
    st.db.tables.set("ach_files", [prenoteFile()]);
    st.db.tables.set("ach_verifications", [{ id: "v1", method: "prenote", status: "sent", settlement_date: "2026-10-20" }]);
    const r = await vendor();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no prenote from that file is marked passed/);
  });

  it("a passed MICRO entry is not a prenote: still refused", async () => {
    st.db.tables.set("ach_files", [prenoteFile()]);
    st.db.tables.set("ach_verifications", [{ id: "v1", method: "micro_entry", status: "passed", settlement_date: "2026-10-20" }]);
    expect((await vendor()).ok).toBe(false);
  });

  it("a voided prenote file never opens the gate", async () => {
    st.db.tables.set("ach_files", [prenoteFile({ status: "voided" })]);
    st.db.tables.set("ach_verifications", [{ id: "v1", method: "prenote", status: "passed", settlement_date: "2026-10-20" }]);
    expect((await vendor()).ok).toBe(false);
  });

  it("approved + wait over + passed: the vendor file IS released (the gate opens on exactly 10-28)", async () => {
    st.db.tables.set("ach_files", [prenoteFile()]);
    st.db.tables.set("ach_verifications", [{ id: "v1", method: "prenote", status: "passed", settlement_date: "2026-10-20" }]);
    const r = await vendor();
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(vendorRows()).toHaveLength(1);
  });

  it("test credits (micro_entry files) move money, so they are gated too", async () => {
    const r = await vendor(NOW, "micro_entry");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(core.FIRST_FILE_LOCKED_PREFIX);
  });

  it("a read error refuses (never treated as open)", async () => {
    st.db.tables.set("ach_files", [prenoteFile()]);
    st.db.tables.set("ach_verifications", [{ id: "v1", method: "prenote", status: "passed", settlement_date: "2026-10-20" }]);
    st.db.missing.add("ach_verifications");
    const r = await vendor();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(ledger.FIRST_FILE_READ_FAILED);
  });

  it("an odd row (no effective date) refuses rather than guessing", async () => {
    st.db.tables.set("ach_files", [prenoteFile({ effective_date: null })]);
    st.db.tables.set("ach_verifications", [{ id: "v1", method: "prenote", status: "passed", settlement_date: "2026-10-20" }]);
    const g = await ledger.readFirstFileGate("2026-10-28");
    expect(g.ok).toBe(false);
  });

  it("readFirstFileGate reads only prenote files and only PASSED prenotes", async () => {
    st.db.tables.set("ach_files", [prenoteFile(), prenoteFile({ id: "x2", kind: "vendor", status: "bank_approved", effective_date: "2026-10-01" })]);
    st.db.tables.set("ach_verifications", [{ id: "v1", method: "prenote", status: "passed", settlement_date: "2026-10-20" }]);
    const g = await ledger.readFirstFileGate("2026-10-28");
    expect(g.ok && g.gate.open && g.gate.fileId).toBe("00000000-0000-4000-8000-00000000a001");
    const reads = st.db.log.filter((r) => r.method === "GET").map((r) => r.url.search);
    expect(reads.some((s) => s.includes("kind=eq.prenote"))).toBe(true);
    expect(reads.some((s) => s.includes("method=eq.prenote") && s.includes("status=eq.passed"))).toBe(true);
  });
});

// =========================================================================
describe("wiring pins", () => {
  const store = code(read("src/lib/payments/ach-file-ledger-store.ts"));

  it("releaseLoop checks the gate for every kind except prenote, before any letter is read", () => {
    const loop = store.slice(store.indexOf("async function releaseLoop"), store.indexOf("export type Released"));
    const gateAt = loop.indexOf("readFirstFileGate(fileDate)");
    expect(loop).toMatch(/if \(input\.kind !== "prenote"\) \{\s*const gate = await readFirstFileGate\(fileDate\);\s*if \(!gate\.ok\) return gate;\s*if \(!gate\.gate\.open\) return \{ ok: false, error: `This file was NOT released\. \$\{gate\.gate\.line\}` \};/);
    expect(gateAt).toBeGreaterThan(0);
    expect(gateAt).toBeLessThan(loop.indexOf("usedModifiers(fileDate)"));
    expect(gateAt).toBeGreaterThan(loop.indexOf("checkEffectiveDateForTimberland"));
  });

  it("both release paths (vendor/prenote/micro and payroll) go through releaseLoop", () => {
    expect(store).toMatch(/export async function releaseAchFile[\s\S]*?await releaseLoop\(input,/);
    expect(store).toMatch(/export async function releasePayrollAchFile[\s\S]*?await releaseLoop\(\{ \.\.\.input, kind: "payroll" \}/);
  });

  it("the Guide shows the gate and the planner at #first-payroll", () => {
    const page = read("src/app/admin/settings/banking/guide/page.tsx");
    expect(page).toContain("<FirstFileToTimberland today={today} firstPayday={sp.firstPayday} now={new Date()} />");
    const comp = read("src/components/admin/payments/FirstFileToTimberland.tsx");
    expect(comp).toContain('id="first-payroll"');
    expect(comp).toContain("readFirstFileGate(today)");
    expect(comp).toContain("checkFirstPayday(typed || null, now)");
    expect(comp).toMatch(/method="get"/);
  });

  it("every link in the First-file card lands on a real page AND a real anchor (the full suite caught /banking/files)", () => {
    const comp = read("src/components/admin/payments/FirstFileToTimberland.tsx");
    const hrefs = [...comp.matchAll(/href="(\/admin\/[^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    expect(hrefs).not.toContain("/admin/settings/banking/files");
    for (const h of hrefs) {
      const [path, anchor] = h.split("#");
      const pageFile = `src/app${path}/page.tsx`;
      expect(existsSync(pageFile), `${h} has no page`).toBe(true);
      if (anchor) expect(read(pageFile), `${h} anchor missing`).toContain(`id="${anchor}"`);
    }
  });

  it("the ops error table explains 0275's refusal", () => {
    expect(ops.opsDbErrorMessage("ACH_VERIFICATION_TIMBERLAND_WAIT: a prenote's first live day must be")).toMatch(/Timberland needs 6 banking days/);
  });

  it("0275: add-only trigger, floor of 8, prenote only, server only, rollback and CI check wired", () => {
    const m = read("supabase/migrations/0275_ach_prenote_timberland_wait.sql");
    expect(m).toContain("new.eligible_on < new.settlement_date + 8");
    expect(m).toContain("new.method = 'prenote' and new.status = 'sent' and old.status is distinct from 'sent'");
    expect(m).toContain("revoke all on function public.ach_verification_timberland_wait() from public, anon, authenticated;");
    expect(m).not.toMatch(/create or replace function public\.ach_verification_(guard|mark_sent|finish)\b/);
    expect(existsSync("supabase/rollbacks/0275_ach_prenote_timberland_wait.rollback.sql")).toBe(true);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain('{ file: "scripts/recon/ach-prenote-wait-0275-pg-check.sql", mustPrint: "ACH 0275 CHECK PASSED" }');
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0275_ach_prenote_timberland_wait.sql");
  });

  it("the self-test is registered with its exact floor", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("timberland-prenote-core", __runTimberlandPrenoteCoreTests(), 38)');
    expect(core.__runTimberlandPrenoteCoreTests()).toEqual({ passed: 38, failed: 0 });
  });
});

// =========================================================================
describe("S7 mutation runs (test the tests)", () => {
  const pin = (scriptPath: string, logPath: string, floor: number) => {
    const script = read(scriptPath);
    const log = read(logPath);
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const m = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(m, "clean summary line").not.toBeNull();
    expect(Number(m![1])).toBe(listed);
    expect(Number(m![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(floor);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR|control .* FAIL/);
  };
  it("scripts/r41/mutate-s7-app.last.log: every app mutant killed (6 to 3, calendar days, gate bypassed, ...), controls pass", () => {
    pin("scripts/r41/mutate-s7-app.py", "scripts/r41/mutate-s7-app.last.log", 23);
  });
  it("scripts/r41/mutate-0275-sql.last.log: every SQL mutant killed, controls pass (0263 check too)", () => {
    pin("scripts/r41/mutate-0275-sql.py", "scripts/r41/mutate-0275-sql.last.log", 11);
  });
});
