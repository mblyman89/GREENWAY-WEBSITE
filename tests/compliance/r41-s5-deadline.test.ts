/**
 * R41 S5: the Timberland deadline (Schedule A: uploaded AND approved at
 * least 2 banking days before the effective date, by 4:00 pm Pacific;
 * Schedule D: holidays move credits to the PRIOR business day), run for real:
 *   - the REAL ledger store (releaseAchFile / releasePayrollAchFile) over the
 *     REAL @supabase/postgrest-js client against FakePostgrest, with the real
 *     NACHA builder and real AES-GCM;
 *   - the REAL 1 pm cron route (claim-before-send, release on failure);
 *   - the morning reminders read (fail closed);
 *   - source pins for the payroll, vendor and account-check wiring;
 *   - the mutation log (test the tests).
 * The deadline day in most tests is Wed Oct 21, 2026 (effective Fri Oct 23).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type FakeRequest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  emails: [] as { subject: string; html: string; to: string[]; logAt: number }[],
  emailOk: true,
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
vi.mock("@/lib/auth/session", () => ({ getStaffSession: async () => null, requirePermission: async () => ({}) }));
vi.mock("@/lib/orders/staff-alert-email", () => ({
  sendStaffAlertEmail: async (p: { subject: string; html: string; to: string[] }) => {
    st.emails.push({ ...p, logAt: st.db.log.length });
    return st.emailOk ? { ok: true, recipients: p.to.length } : { ok: false, detail: "provider returned 500", didTimeout: false };
  },
}));

const ledger = await import("@/lib/payments/ach-file-ledger-store");
const dl = await import("@/lib/payments/timberland-deadline-core");
const { buildNachaFile } = await import("@/lib/payments/nacha-core");
const { pacificWallTimeToUtcISO } = await import("@/lib/reports/timezone");
const { payDateLine } = await import("@/components/admin/payroll/PayDateDeadlineField");

const read = (p: string) => readFileSync(p, "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const pt = (day: string, h: number, m: number) => new Date(pacificWallTimeToUtcISO(day, { h, m, s: 0, ms: 0 }));

const KEY = "s5-deadline-test-key-0123456789abcdef!!";
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

let builds = 0;
let acct = 0;
const builder = (effective: string, now: Date, desc = "VENDOR PAY", sec: "PPD" | "CCD" = "CCD") => (fileIdModifier: string) => {
  builds++;
  const b = buildNachaFile({
    originator: GW,
    entries: [{ accountType: "checking" as const, routing: "021000021", accountNumber: `00${++acct}001`, amountCents: 12345, name: "PAYEE 1", idNumber: "ID1" }],
    secCode: sec,
    companyEntryDescription: desc,
    effectiveDate: new Date(`${effective}T00:00:00Z`),
    createdAt: now,
    fileIdModifier,
  });
  return b.ok ? { ok: true as const, file: b.file, entryCount: b.entryCount, totalCents: b.totalCents } : { ok: false as const, error: b.error };
};
const vendor = (effective: string, now: Date, sourceId = "batch-1") =>
  ledger.releaseAchFile({ kind: "vendor", sourceId, actorId: MICHAEL, now, effectiveDate: effective, filename: `vendor-${sourceId}.ach`, build: builder(effective, now) });
const payroll = (effective: string, now: Date) =>
  ledger.releasePayrollAchFile({ runId: RUN, actorId: MICHAEL, now, effectiveDate: effective, filename: `payroll_${effective}_${RUN.slice(0, 8)}.ach`, overrideWarnings: false, overrideReason: null, build: builder(effective, now, "PAYROLL", "PPD") });

const files = () => st.db.rows("ach_files");
const writes = () => st.db.log.filter((r: FakeRequest) => r.method !== "GET");

beforeEach(() => {
  process.env.DATA_ENCRYPTION_KEY = KEY;
  st.db = new FakePostgrest();
  st.emails = [];
  st.emailOk = true;
  builds = 0;
  st.db.tables.set("ach_files", []);
  st.db.tables.set("payroll_runs", [{ id: RUN, status: "draft", approved_by: null }]);
  st.db.tables.set("compliance_reminder_log", []);
  st.db.defaults.set("ach_files", () => ({ status: "released", settlement_date: null, released_at: new Date().toISOString(), voided_by: null, voided_at: null, voided_reason: null }));
  st.db.uniques.push(
    { table: "ach_files", columns: ["file_date", "file_id_modifier"], name: "ach_files_day_modifier_key" },
    { table: "compliance_reminder_log", columns: ["dedupe_key"], name: "compliance_reminder_log_dedupe_key_key" },
  );
  st.db.before = (req) => {
    if (!req.url.pathname.includes("/rpc/")) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = st.db.nextId();
    files().push({ id, kind: "payroll", source_id: String(b.p_run_id), file_date: b.p_file_date, file_id_modifier: b.p_modifier, effective_date: b.p_effective, settlement_date: null, total_cents: b.p_total_cents, status: "released" });
    return { status: 200, body: id };
  };
});

// =========================================================================
describe("the release choke point (releaseLoop) enforces Schedule A with the release clock", () => {
  it("3:29 pm on the deadline day: released, no late warning, upload-by text handed back", async () => {
    const r = await vendor("2026-10-23", pt("2026-10-21", 15, 29));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deadlineWarning).toBeNull();
    expect(r.uploadBy).toBe("Wed Oct 21, 3:30 pm Pacific (bank cutoff 4:00 pm)");
  });

  it("3:31 pm: still released (before the 4:00 pm cutoff) but the late warning is handed back", async () => {
    const r = await vendor("2026-10-23", pt("2026-10-21", 15, 31));
    expect(r.ok).toBe(true);
    expect(r.ok && r.deadlineWarning).toMatch(/upload AND approve at Timberland right now/);
  });

  it("4:00 pm and 4:01 pm: refused, nothing read-for-letters, nothing built, nothing written; the earliest date is named", async () => {
    for (const [h, m] of [[16, 0], [16, 1]] as const) {
      st.db.log.length = 0;
      const r = await vendor("2026-10-23", pt("2026-10-21", h, m));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/^Timberland deadline: this file was NOT released\. Too late for Fri Oct 23/);
      expect(!r.ok && r.error).toContain("Mon Oct 26 (2026-10-26)");
      expect(st.db.log).toHaveLength(0);
    }
    expect(builds).toBe(0);
    expect(files()).toHaveLength(0);
  });

  it("only 1 banking day ahead (Mon release, Tue effective) is refused; 2 days (Wed) is released", async () => {
    const mon = pt("2026-10-05", 10, 0);
    const one = await vendor("2026-10-06", mon);
    expect(!one.ok && one.error).toMatch(/Too late for Tue Oct 6/);
    const two = await vendor("2026-10-07", mon, "batch-2");
    expect(two.ok).toBe(true);
  });

  it("weekend, FRB holiday, Q9 Friday, same day and past dates are refused with the right reason", async () => {
    const now = pt("2026-10-19", 10, 0);
    expect(await vendor("2026-10-24", now).then((r) => !r.ok && r.error)).toMatch(/not a banking day/);
    expect(await vendor("2026-11-11", now).then((r) => !r.ok && r.error)).toMatch(/not a banking day/); // Veterans Day
    expect(await vendor("2026-10-19", now).then((r) => !r.ok && r.error)).toMatch(/Same Day ACH/);
    expect(await vendor("2026-10-16", now).then((r) => !r.ok && r.error)).toMatch(/already passed/);
    expect(await vendor("2026-12-30", now).then((r) => !r.ok && r.error)).toMatch(/more than 30 days/);
    const q9 = await vendor("2027-12-24", pt("2027-12-17", 10, 0));
    expect(!q9.ok && q9.error).toMatch(/Friday before a Saturday holiday/);
    expect(builds).toBe(0);
    expect(writes()).toHaveLength(0);
  });

  it("DST end week: Mon Nov 2 2026 is PST; 3:59 pm PST (23:59Z) is allowed, 4:00 pm PST (00:00Z Nov 3) refused", async () => {
    expect((await vendor("2026-11-04", new Date("2026-11-02T23:59:00Z"))).ok).toBe(true);
    const late = await vendor("2026-11-04", new Date("2026-11-03T00:00:00Z"), "b2");
    expect(late.ok).toBe(false);
    // UTC says "Nov 3"; the Pacific clock says 4:00 pm Nov 2. Refused as too late, not as "same day".
    expect(!late.ok && late.error).toMatch(/Too late for Wed Nov 4/);
  });

  it("DST end week: Fri Oct 30 is still PDT, so 4:00 pm is 23:00Z", async () => {
    expect((await vendor("2026-11-03", new Date("2026-10-30T22:59:00Z"))).ok).toBe(true);
    expect((await vendor("2026-11-03", new Date("2026-10-30T23:00:00Z"), "b2")).ok).toBe(false);
  });

  it("DST start week 2027: Fri Mar 12 is PST (4 pm = 00:00Z), Mon Mar 15 is PDT (4 pm = 23:00Z)", async () => {
    expect((await vendor("2027-03-16", new Date("2027-03-12T23:59:00Z"))).ok).toBe(true);
    expect((await vendor("2027-03-16", new Date("2027-03-13T00:00:00Z"), "b2")).ok).toBe(false);
    expect((await vendor("2027-03-17", new Date("2027-03-15T22:59:00Z"), "b3")).ok).toBe(true);
    expect((await vendor("2027-03-17", new Date("2027-03-15T23:00:00Z"), "b4")).ok).toBe(false);
  });

  it("the payroll path is checked too: refused before the database function is called", async () => {
    const r = await payroll("2026-10-23", pt("2026-10-21", 16, 1));
    expect(r.ok).toBe(false);
    expect(st.db.log.filter((x) => x.url.pathname.includes("/rpc/"))).toHaveLength(0);
    expect(st.db.rows("payroll_runs")[0].status).toBe("draft");
    const ok = await payroll("2026-10-23", pt("2026-10-21", 9, 0));
    expect(ok.ok && ok.uploadBy).toBe("Wed Oct 21, 3:30 pm Pacific (bank cutoff 4:00 pm)");
  });
});

// =========================================================================
describe("payroll: Schedule D moves a non-banking payday to the PRIOR usable day", () => {
  it("every row of the plan's section 3.7 table, through the form line", () => {
    const rows: [string, string, string][] = [
      ["2026-10-23", "2026-10-23", "Wed Oct 21"],
      ["2026-11-11", "2026-11-10", "Fri Nov 6"],
      ["2026-11-26", "2026-11-25", "Mon Nov 23"],
      ["2026-12-25", "2026-12-24", "Tue Dec 22"],
      ["2027-01-01", "2026-12-31", "Tue Dec 29"],
      ["2027-01-18", "2027-01-15", "Wed Jan 13"],
    ];
    const early = pt("2026-10-19", 9, 0);
    for (const [pay, eff, by] of rows) {
      const d = dl.payrollDeadlineFor(pay, early);
      expect(d.effective, pay).toBe(eff);
      if (d.check.ok) expect(d.line, pay).toContain(`Upload and approve at Timberland by ${by}, 3:30 pm Pacific`);
      else expect(d.check.rule, pay).toBe("too_far"); // more than 30 days from Oct 19
    }
  });

  it("the form line (payDateLine) is red with the pay-by-check words after the cutoff, and names the moved date", () => {
    expect(payDateLine("2026-10-23", pt("2026-10-21", 16, 1))).toEqual({ tone: "bad", text: dl.PAYROLL_TOO_LATE });
    const moved = payDateLine("2026-11-11", pt("2026-11-02", 9, 0));
    expect(moved?.tone).toBe("info");
    expect(moved?.text).toContain("Payday Wed Nov 11 is not a banking day, so the bank date is the day before: Tue Nov 10 (Schedule D).");
    expect(payDateLine("", new Date())).toBeNull();
    expect(payDateLine("2026-13-01", new Date())?.tone).toBe("bad");
  });

  it("generatePayrollNacha checks the deadline FIRST and hands the BANK date to the builder and the ledger", () => {
    const s = code(read("src/lib/payroll/payroll-store.ts"));
    const body = s.slice(s.indexOf("export async function generatePayrollNacha("), s.indexOf("export async function getPayrollReconcileInputs") > 0 ? s.indexOf("function bankDateForReconcile") : undefined);
    const dIdx = body.indexOf("deadline = payrollDeadlineFor(detail.run.pay_date, now)");
    expect(dIdx).toBeGreaterThan(-1);
    expect(dIdx).toBeLessThan(body.indexOf("validatePayrollRun(lines)"));
    expect(body).toContain("if (!deadline.check.ok) return { ok: false, error: deadline.line };");
    expect(body).toContain("const bankEffective = deadline.effective;");
    expect(body).toContain("const effectiveDate = new Date(`${bankEffective}T00:00:00Z`);");
    expect(body).toMatch(/releasePayrollAchFile\(\{[\s\S]*?effectiveDate: bankEffective,/);
    expect(body).not.toContain("new Date(`${detail.run.pay_date}T00:00:00Z`)");
    expect(body).not.toMatch(/effectiveDate: detail\.run\.pay_date/);
  });

  it("reconciliation looks for the debit on the bank date, not the payday", () => {
    const s = code(read("src/lib/payroll/payroll-store.ts"));
    expect(s).toContain("payDate: bankDateForReconcile(r.pay_date),");
    expect(s).toMatch(/function bankDateForReconcile\(payDate: string\): string \{\s*try \{\s*return creditEffectiveDateFor\(payDate\);/);
  });

  it("the create form has no default date and shows the deadline; the run page shows it too", () => {
    const page = read("src/app/admin/payroll/page.tsx");
    expect(page).not.toMatch(/name="pay_date" defaultValue=/);
    expect(page).toContain("<PayDateDeadlineField nowIso={new Date().toISOString()} />");
    expect(page).not.toContain("new Date().toISOString().slice(0, 10)");
    const field = read("src/components/admin/payroll/PayDateDeadlineField.tsx");
    expect(field).toContain('const [value, setValue] = useState("");');
    expect(field).toContain('name="pay_date" required');
    expect(read("src/app/admin/payroll/[id]/page.tsx")).toContain("payDateLine(run.pay_date, new Date())");
  });
});

// =========================================================================
describe("vendor and account-check files", () => {
  it("the vendor action refuses a blank or late date (no fallback to today) and returns uploadBy/deadlineWarning", () => {
    const s = code(read("src/app/admin/vendor-payments/actions.ts"));
    expect(s).toContain("const deadline = checkEffectiveDateForTimberland(effectiveDateRaw, now);");
    expect(s).toMatch(/if \(!deadline\.ok\) \{\s*return \{ problems: \[\{ index: null, vendorName: null, message: `Effective date: \$\{deadline\.error\}` \}\], warnings \};/);
    expect(s).not.toMatch(/effectiveDateRaw \? .* : now/);
    expect(s).toMatch(/uploadBy: released\.uploadBy,\s*deadlineWarning: released\.deadlineWarning,/);
    const form = read("src/app/admin/vendor-payments/VendorAchForm.tsx");
    expect(form).toContain("useState(earliestEffective)");
    expect(form).not.toContain("new Date().toISOString().slice(0, 10)");
    expect(form).toContain("state.uploadBy");
    expect(read("src/app/admin/vendor-payments/page.tsx")).toContain("earliestEffective={earliestEffectiveDate(new Date())}");
  });

  it("account checks: the page defaults to the earliest allowed date and hides Release past the deadline; the store refuses too", () => {
    const page = code(read("src/app/admin/settings/banking/operations/page.tsx"));
    expect(page).toContain("defaultCheckEffectiveDate(now)");
    expect(page).toContain("{!live && effTimely.ok ? (");
    const store = code(read("src/lib/payments/ach-ops-store.ts"));
    const fn = store.slice(store.indexOf("export async function releaseCheckFile("));
    expect(fn.indexOf("checkEffectiveDateForRelease(input.effective, input.now)")).toBeLessThan(fn.indexOf("loadPlannedChecks("));
    expect(read("src/lib/payments/ach-ops-core.ts")).not.toContain("at least a day ahead");
  });

  it("releaseLoop checks the deadline before reading letters or the ledger", () => {
    const s = code(read("src/lib/payments/ach-file-ledger-store.ts"));
    const fn = s.slice(s.indexOf("async function releaseLoop("));
    const c = fn.indexOf("checkEffectiveDateForTimberland(input.effectiveDate, input.now)");
    expect(c).toBeGreaterThan(-1);
    expect(c).toBeLessThan(fn.indexOf("usedModifiers(fileDate)"));
  });
});

// =========================================================================
describe("reminders", () => {
  const open = (o: Partial<Record<string, unknown>> & { id: string; effective_date: string }) =>
    files().push({ kind: "vendor", status: "released", filename: `f-${o.id}.ach`, file_date: "2026-10-19", ...o });

  it("readOpenFilesForDeadlines asks for released/uploaded rows effective today or later, capped", async () => {
    open({ id: "a", effective_date: "2026-10-23" });
    open({ id: "b", effective_date: "2026-10-23", status: "bank_approved" });
    open({ id: "c", effective_date: "2026-10-16" });
    const r = await ledger.readOpenFilesForDeadlines("2026-10-21");
    expect(r.ok && r.files.map((f) => f.id)).toEqual(["a"]);
    const get = st.db.log.find((x) => x.method === "GET")!;
    expect(get.url.searchParams.get("status")).toBe("in.(released,uploaded)");
    expect(get.url.searchParams.get("effective_date")).toBe("gte.2026-10-21");
    expect(get.url.searchParams.get("limit")).toBe(String(ledger.OPEN_FILES_READ_CAP + 1));
  });

  it("fails closed: a read error, an odd row, or too many rows is an error, never an empty list", async () => {
    st.db.before = () => ({ status: 500, body: { message: "boom" } });
    expect((await ledger.readOpenFilesForDeadlines("2026-10-21")).ok).toBe(false);
    st.db.before = null;
    open({ id: "x", effective_date: "2026-10-23", filename: null });
    expect((await ledger.readOpenFilesForDeadlines("2026-10-21")).ok).toBe(false);
    files().length = 0;
    for (let i = 0; i <= ledger.OPEN_FILES_READ_CAP; i++) open({ id: `r${i}`, effective_date: "2026-10-23" });
    const many = await ledger.readOpenFilesForDeadlines("2026-10-21");
    expect(!many.ok && many.error).toMatch(/not trusted/);
  });

  it("the daily run pushes the morning reminders after the R40 block, and reports an unreadable ledger", () => {
    const s = code(read("src/lib/notifications/compliance-reminders.ts"));
    const r40 = s.indexOf("evaluateAchCalendar(todayIso");
    const s5 = s.indexOf("await readOpenFilesForDeadlines(todayIso)");
    expect(s5).toBeGreaterThan(r40);
    expect(s5).toBeLessThan(s.indexOf("result.planned = reminders.length;"));
    expect(s).toContain("planDeadlineReminders(todayIso, open.files)");
    expect(s).toContain("the ACH files could not be read");
  });

  describe("the 1 pm cron route", () => {
    const call = async () => {
      const { GET } = await import("@/app/api/cron/ach-deadline-1pm/route");
      const { NextRequest } = await import("next/server");
      return GET(new NextRequest("http://x/api/cron/ach-deadline-1pm", { headers: { authorization: "Bearer s5secret" } }));
    };
    beforeEach(() => {
      vi.stubEnv("CRON_SECRET", "s5secret");
      vi.stubEnv("RESEND_API_KEY", "re_test");
      vi.stubEnv("ORDER_EMAIL_FROM", "alerts@example.test");
      vi.useFakeTimers({ toFake: ["Date"] });
    });
    const after = () => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    };

    it("1:00 pm PDT on the deadline day: one email per open file, claimed in the log before sending; a second tick sends nothing", async () => {
      try {
        vi.setSystemTime(new Date("2026-10-21T20:00:00Z"));
        open({ id: "a", effective_date: "2026-10-23" });
        open({ id: "b", effective_date: "2026-10-23", status: "bank_approved" });
        const res = await call();
        expect(res.status).toBe(200);
        expect(st.emails).toHaveLength(1);
        expect(st.emails[0].subject).toBe("1 pm check: f-a.ach must be approved at Timberland by 3:30 pm");
        expect(st.db.rows("compliance_reminder_log").map((r) => r.dedupe_key)).toEqual(["ach-deadline:a:1pm"]);
        const claimAt = st.db.log.findIndex((x) => x.method === "POST" && x.url.pathname.endsWith("/compliance_reminder_log"));
        expect(claimAt).toBeGreaterThan(-1);
        expect(claimAt).toBeLessThan(st.emails[0].logAt); // claimed BEFORE the email went out
        expect(st.emails[0].to).toEqual(["michael@greenwaymarijuana.com"]);
        vi.setSystemTime(new Date("2026-10-21T21:00:00Z")); // the 21:00 UTC tick = 2 pm PDT
        const again = await call();
        expect(again.status).toBe(200);
        expect(st.emails).toHaveLength(1);
      } finally {
        after();
      }
    });

    it("12:00 pm PST (the 20:00 UTC tick in winter) sends nothing; 1:00 pm PST (21:00 UTC) sends", async () => {
      try {
        open({ id: "n", effective_date: "2026-11-04", status: "uploaded" });
        vi.setSystemTime(new Date("2026-11-02T20:00:00Z"));
        expect(((await (await call()).json()) as { planned: number }).planned).toBe(0);
        vi.setSystemTime(new Date("2026-11-02T21:00:00Z"));
        await call();
        expect(st.emails).toHaveLength(1);
      } finally {
        after();
      }
    });

    it("a failed email releases the claim (so the next tick retries) and answers 500", async () => {
      try {
        vi.setSystemTime(new Date("2026-10-21T20:00:00Z"));
        open({ id: "a", effective_date: "2026-10-23" });
        st.emailOk = false;
        const res = await call();
        expect(res.status).toBe(500);
        expect(st.db.rows("compliance_reminder_log")).toHaveLength(0);
        st.emailOk = true;
        expect((await call()).status).toBe(200);
        expect(st.db.rows("compliance_reminder_log")).toHaveLength(1);
      } finally {
        after();
      }
    });

    it("an unreadable ledger is a 500, never silence; a wrong secret is refused before any read", async () => {
      try {
        vi.setSystemTime(new Date("2026-10-21T20:00:00Z"));
        st.db.before = () => ({ status: 500, body: { message: "down" } });
        expect((await call()).status).toBe(500);
        st.db.before = null;
        st.db.log.length = 0;
        const { GET } = await import("@/app/api/cron/ach-deadline-1pm/route");
        const { NextRequest } = await import("next/server");
        const res = await GET(new NextRequest("http://x/api/cron/ach-deadline-1pm", { headers: { authorization: "Bearer nope" } }));
        expect(res.status).toBe(401);
        expect(st.db.log).toHaveLength(0);
      } finally {
        after();
      }
    });

    it("vercel.json runs it at 20:00 and 21:00 UTC (1 pm Pacific in PDT and PST)", () => {
      after();
      const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
      expect(v.crons.find((c) => c.path === "/api/cron/ach-deadline-1pm")?.schedule).toBe("0 20-21/1 * * *");
    });
  });
});

// =========================================================================
describe("test the tests", () => {
  it("scripts/r41/mutate-s5-deadline.last.log: every mutant killed, controls passed, the log covers the script's full list", () => {
    const script = read("scripts/r41/mutate-s5-deadline.py");
    const log = read("scripts/r41/mutate-s5-deadline.last.log");
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const m = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(m, "clean summary line").not.toBeNull();
    expect(Number(m![1])).toBe(listed);
    expect(Number(m![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(15);
    for (const plan of ["two-to-one", "prior-to-next", "utc-not-pacific", "margin-dropped"]) expect(script).toContain(`("${plan}"`);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR/);
  });
});
