/**
 * R41 S9: "Get rolling" helpers.
 *
 *   1. Go-live readiness board (guide #go-live): pure core + strict store
 *      (an unreadable source is "could not be read", never green).
 *   2. File checker (Banking > File checker): stores nothing, audits only the
 *      fingerprint and rule ids.
 *   3. Funding helper: Timberland agreement section 14, "Company shall provide
 *      Financial Institution with immediately available funds not later than
 *      9:00 a.m. PST on each Settlement Date"; the owner-only confirm-funding
 *      gated kind (0276); the 8 am Pacific settlement-day reminder cron.
 *
 * The REAL stores and the REAL cron route run over the REAL postgrest-js
 * client against FakePostgrest. Quotes are checked against the repo mirror
 * docs/authorities/ach/timberland-ach-agreement-2026-10-14.redacted.txt.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  emails: [] as { subject: string; html: string; to: string[]; logAt: number }[],
  emailOk: true,
  audits: [] as { action: string; after?: Record<string, unknown> | null; entityId?: string | null }[],
  guide: null as null | { snapshot: Record<string, unknown>; problems: string[]; ops: null },
  guideThrows: false,
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
vi.mock("@/lib/auth/session", () => ({
  getStaffSession: async () => null,
  requirePermission: async () => ({ email: "michael@greenwaymarijuana.com", profile: { id: "22222222-2222-4222-8222-222222222222", role: "owner" } }),
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (e: { action: string; after?: Record<string, unknown> | null; entityId?: string | null }) => {
    st.audits.push(e);
  },
}));
vi.mock("@/lib/orders/staff-alert-email", () => ({
  sendStaffAlertEmail: async (p: { subject: string; html: string; to: string[] }) => {
    st.emails.push({ ...p, logAt: st.db.log.length });
    return st.emailOk ? { ok: true, recipients: p.to.length } : { ok: false, detail: "provider returned 500", didTimeout: false };
  },
}));
vi.mock("@/lib/payments/ach-guide-store", () => ({
  loadGuideSnapshot: async () => {
    if (st.guideThrows) throw new Error("guide down");
    return st.guide;
  },
}));
vi.mock("@/lib/payroll/payroll-store", async () => {
  const { greenwayTestOriginator } = await import("@/lib/payments/timberland-originator-core");
  return { getOriginatorReadiness: async () => ({ settings: {}, ein: "", readiness: { originator: greenwayTestOriginator(), problems: [] } }) };
});

const ledger = await import("@/lib/payments/ach-file-ledger-store");
const funding = await import("@/lib/payments/timberland-funding-core");
const golive = await import("@/lib/payments/timberland-golive-core");
const goliveStore = await import("@/lib/payments/timberland-golive-store");
const checker = await import("@/lib/payments/timberland-file-checker-core");
const { pacificWallTimeToUtcISO } = await import("@/lib/reports/timezone");

const read = (p: string) => readFileSync(p, "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const pt = (day: string, h: number, m = 0) => new Date(pacificWallTimeToUtcISO(day, { h, m, s: 0, ms: 0 }));
const MIRROR = "docs/authorities/ach/timberland-ach-agreement-2026-10-14.redacted.txt";
const MICHAEL = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "aaaaaaaa-1111-4222-8333-444455556666";

const files = () => st.db.rows("ach_files");
const addFile = (o: Partial<Record<string, unknown>> & { id: string; effective_date: string }) =>
  files().push({
    kind: "payroll",
    status: "released",
    filename: `f-${o.id}.ach`,
    file_date: "2026-10-19",
    total_cents: 123_456,
    settlement_date: null,
    funding_confirmed_at: null,
    funding_confirmed_amount_cents: null,
    ...o,
  });

const SETUP_ALL = { accessReady: true, usersPhones: true, scheduleGEmail: true, countersigned: true, matchConfirmed: true, firstPrenotePassed: true, dualApprovalOn: false };

beforeEach(() => {
  st.db = new FakePostgrest();
  st.emails = [];
  st.emailOk = true;
  st.audits = [];
  st.guideThrows = false;
  st.guide = { snapshot: { timberlandAgreementDone: true, encryptionConfigured: true, migrationsReady: true, timberlandSetup: { ...SETUP_ALL } }, problems: [], ops: null };
  for (const t of ["ach_files", "ach_verifications", "compliance_reminder_log", "staff_profiles", "ach_change_requests", "ach_owner_reviews"]) st.db.tables.set(t, []);
  st.db.uniques.push({ table: "compliance_reminder_log", columns: ["dedupe_key"], name: "compliance_reminder_log_dedupe_key_key" });
});

// =========================================================================
describe("quotes are verbatim to the mirror (whitespace-normalized)", () => {
  const m = flat(read(MIRROR));
  it.each([
    "Company shall provide Financial Institution with immediately available funds not later than 9:00 a.m. PST on each Settlement Date",
    "Company will maintain in the Account immediately available funds sufficient to cover all credit Entries originated",
    "reserves the right to require that sufficient collected funds be in Company's Accounts prior to the time any Entry is processed",
    "ACH Service Fee $ 50.00 per month",
    "Return/NOC $ 5.00 per item",
  ])("%s", (q) => {
    expect(m).toContain(q);
  });
  it("the cron header and 0276 quote section 14 exactly as the mirror", () => {
    const q = "Company shall provide Financial Institution with immediately available funds not later than 9:00 a.m. PST on each Settlement Date";
    expect(flat(read("src/app/api/cron/ach-funding-8am/route.ts").replace(/^\s*\*\s?/gm, ""))).toContain(q);
    expect(flat(read("supabase/migrations/0276_ach_file_funding_confirm.sql").replace(/^--\s?/gm, ""))).toContain(q);
  });
});

// =========================================================================
describe("funding helper (pure)", () => {
  const f = { totalCents: 1_234_567, effectiveDate: "2026-10-21", settlementDate: null };
  it("file + $50 monthly fee; buffer only when chosen; minimum is the file total", () => {
    const p = funding.fundingPlan(f);
    expect(p.lines.map((l) => [l.key, l.cents])).toEqual([["file", 1_234_567], ["fee", 5000]]);
    expect(p.suggestedCents).toBe(1_239_567);
    expect(p.minimumCents).toBe(1_234_567);
    const b = funding.fundingPlan(f, 10_000);
    expect(b.lines.at(-1)).toMatchObject({ key: "buffer", cents: 10_000 });
    expect(b.suggestedCents).toBe(1_249_567);
    expect(b.lines.at(-1)!.label).toMatch(/your choice, not a bank rule/);
  });
  it("deadline is 9:00 am Pacific on the settlement day (PDT and PST)", () => {
    expect(funding.fundingPlan(f).deadlineUtc.toISOString()).toBe("2026-10-21T16:00:00.000Z");
    expect(funding.fundingPlan({ ...f, effectiveDate: "2026-11-04" }).deadlineUtc.toISOString()).toBe("2026-11-04T17:00:00.000Z");
    expect(funding.fundingPlan(f).headline).toMatch(/collected in account ending 6048 before you upload, and is still there at 9:00 am Pacific/);
  });
  it("a weekend effective date settles the next banking day", () => {
    expect(funding.fundingPlan({ ...f, effectiveDate: "2026-10-24" }).settlementDay).toBe("2026-10-26");
  });
  it("money parsing is exact string arithmetic (no floats)", () => {
    expect(funding.parseDollarsToCents("12,345.67")).toBe(1_234_567);
    expect(funding.parseDollarsToCents("$0.1")).toBe(10);
    expect(funding.parseDollarsToCents("1,23.00")).toBeNull();
    expect(funding.parseDollarsToCents("1.234")).toBeNull();
    expect(funding.parseDollarsToCents("-5")).toBeNull();
  });
  it("the form needs the box, a readable amount, and at least the file total", () => {
    expect(funding.checkFundingForm({ totalCents: 100, amount: "5", confirm: null }).ok).toBe(false);
    expect(funding.checkFundingForm({ totalCents: 100, amount: "abc", confirm: "yes" }).ok).toBe(false);
    expect(funding.checkFundingForm({ totalCents: 100, amount: "0.99", confirm: "yes" }).ok).toBe(false);
    expect(funding.checkFundingForm({ totalCents: 100, amount: "1.00", confirm: "yes" })).toEqual({ ok: true, amountCents: 100 });
  });
  it("the self-tests are registered with their exact floors", () => {
    const r = read("scripts/compliance/run-pure-selftests.ts");
    expect(r).toContain('assertRan("timberland-funding-core", __runTimberlandFundingCoreTests(), 64)');
    expect(r).toContain('assertRan("timberland-golive-core", __runTimberlandGoLiveCoreTests(), 43)');
    expect(r).toContain('assertRan("timberland-file-checker-core", __runTimberlandFileCheckerCoreTests(), 98)');
    expect(funding.__runTimberlandFundingCoreTests()).toEqual({ passed: 64, failed: 0 });
    expect(golive.__runTimberlandGoLiveCoreTests()).toEqual({ passed: 43, failed: 0 });
    expect(checker.__runTimberlandFileCheckerCoreTests()).toEqual({ passed: 98, failed: 0 });
  });
});

// =========================================================================
describe("funding store", () => {
  it("confirmAchFileFunding calls the 0276 function with exactly the file, the actor and the cents", async () => {
    st.db.before = (req) => (req.url.pathname.endsWith("/rpc/ach_file_confirm_funding") ? { status: 200, body: "payroll" } : undefined);
    const r = await ledger.confirmAchFileFunding({ fileId: FILE_ID, actorId: MICHAEL, amountCents: 50_000 });
    expect(r).toEqual({ ok: true, kind: "payroll" });
    const call = st.db.log.find((x) => x.url.pathname.endsWith("/rpc/ach_file_confirm_funding"))!;
    expect(call.body).toEqual({ p_file_id: FILE_ID, p_actor: MICHAEL, p_amount_cents: 50_000 });
  });
  it("refuses bad input before any call, and maps database refusals to plain words", async () => {
    expect((await ledger.confirmAchFileFunding({ fileId: "nope", actorId: MICHAEL, amountCents: 1 })).ok).toBe(false);
    expect((await ledger.confirmAchFileFunding({ fileId: FILE_ID, actorId: MICHAEL, amountCents: 0 })).ok).toBe(false);
    expect(st.db.log).toHaveLength(0);
    st.db.before = () => ({ status: 400, body: { code: "P0001", message: "ACH_FUNDING_SHORT: the amount confirmed is less than the file total." } });
    const short = await ledger.confirmAchFileFunding({ fileId: FILE_ID, actorId: MICHAEL, amountCents: 1 });
    expect(short.ok).toBe(false);
    expect(!short.ok && short.error).not.toMatch(/ACH_FUNDING_SHORT/);
    st.db.before = () => ({ status: 400, body: { code: "P0001", message: "ACH_OWNER_ONLY: only the owner confirms the funding. Send it as a request for owner approval." } });
    const own = await ledger.confirmAchFileFunding({ fileId: FILE_ID, actorId: MICHAEL, amountCents: 1 });
    expect(!own.ok && own.error).toMatch(/owner/i);
    st.db.before = () => ({ status: 200, body: "weird" });
    expect((await ledger.confirmAchFileFunding({ fileId: FILE_ID, actorId: MICHAEL, amountCents: 1 })).ok).toBe(false);
  });
  it("readFilesForFundingReminder reads released/uploaded/bank_approved, effective today-7..today, and fails closed", async () => {
    addFile({ id: "a", effective_date: "2026-10-21" });
    addFile({ id: "b", effective_date: "2026-10-21", status: "voided" });
    addFile({ id: "c", effective_date: "2026-10-10" });
    addFile({ id: "d", effective_date: "2026-10-22" });
    addFile({ id: "e", effective_date: "2026-10-19", status: "bank_approved", funding_confirmed_at: "2026-10-18T10:00:00Z", funding_confirmed_amount_cents: 200_000 });
    const r = await ledger.readFilesForFundingReminder("2026-10-21");
    expect(r.ok && r.files.map((x) => x.id).sort()).toEqual(["a", "e"]);
    expect(r.ok && r.files.find((x) => x.id === "e")!.fundingConfirmedAmountCents).toBe(200_000);
    const get = st.db.log.find((x) => x.method === "GET")!;
    expect(get.url.searchParams.get("status")).toBe("in.(released,uploaded,bank_approved)");
    expect(get.url.searchParams.getAll("effective_date")).toEqual(["gte.2026-10-14", "lte.2026-10-21"]);
    expect(get.url.searchParams.get("limit")).toBe(String(ledger.OPEN_FILES_READ_CAP + 1));
    files().push({ id: "x", kind: "payroll", status: "released", filename: null, total_cents: 1, effective_date: "2026-10-21" });
    expect((await ledger.readFilesForFundingReminder("2026-10-21")).ok).toBe(false);
    st.db.before = () => ({ status: 500, body: { message: "down" } });
    expect((await ledger.readFilesForFundingReminder("2026-10-21")).ok).toBe(false);
  });
  it("ROW_COLS carries the funding columns (and keeps the s6 mutant anchor intact)", () => {
    const s = read("src/lib/payments/ach-file-ledger-store.ts");
    expect(s).toContain("released_at, settlement_date, funding_confirmed_by, funding_confirmed_at, funding_confirmed_amount_cents, voided_by");
    expect(s).toContain('voided_reason, uploaded_by, uploaded_at, approved_at_bank_by, approved_at_bank_at";');
  });
});

// =========================================================================
describe("the 8 am funding cron route", () => {
  const call = async (auth = "Bearer s9secret") => {
    const { GET } = await import("@/app/api/cron/ach-funding-8am/route");
    const { NextRequest } = await import("next/server");
    return GET(new NextRequest("http://x/api/cron/ach-funding-8am", { headers: { authorization: auth } }));
  };
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s9secret");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("ORDER_EMAIL_FROM", "alerts@example.test");
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  const after = () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  };

  it("8:00 am PDT on the settlement day: one email per file, claimed before sending; the 9:00 am tick sends nothing", async () => {
    try {
      vi.setSystemTime(pt("2026-10-21", 8));
      addFile({ id: "a", effective_date: "2026-10-21" });
      addFile({ id: "b", effective_date: "2026-10-21", status: "bank_approved", funding_confirmed_at: "2026-10-20T18:00:00Z", funding_confirmed_amount_cents: 200_000 });
      addFile({ id: "c", effective_date: "2026-10-22" });
      const res = await call();
      expect(res.status).toBe(200);
      expect(st.emails).toHaveLength(2);
      expect(st.emails.map((e) => e.subject).sort()).toEqual([
        "By 9:00 am today: $1,234.56 for f-a.ach must be in the account",
        "By 9:00 am today: $1,234.56 for f-b.ach must be in the account",
      ]);
      expect(st.emails.find((e) => e.subject.includes("f-b"))!.html).toMatch(/You recorded seeing \$2,000\.00 earlier/);
      expect(st.emails.find((e) => e.subject.includes("f-a"))!.html).toMatch(/No balance check was recorded/);
      expect(st.emails[0].html).toContain("1-800-562-8761");
      expect(st.emails[0].to).toEqual(["michael@greenwaymarijuana.com"]);
      expect(st.db.rows("compliance_reminder_log").map((r) => r.dedupe_key).sort()).toEqual(["ach-funding:a:settle", "ach-funding:b:settle"]);
      const claimAt = st.db.log.findIndex((x) => x.method === "POST" && x.url.pathname.endsWith("/compliance_reminder_log"));
      expect(claimAt).toBeGreaterThan(-1);
      expect(claimAt).toBeLessThan(st.emails[0].logAt);
      vi.setSystemTime(pt("2026-10-21", 8, 30)); // a retry inside the window: already claimed
      await call();
      expect(st.emails).toHaveLength(2);
      st.db.rows("compliance_reminder_log").length = 0;
      vi.setSystemTime(pt("2026-10-21", 9)); // the 16:00 UTC tick in PDT = 9:00 am: too late, sends nothing
      const late = await call();
      expect(((await late.json()) as { planned: number }).planned).toBe(0);
      expect(st.emails).toHaveLength(2);
    } finally {
      after();
    }
  });

  it("PST: the 15:00 UTC tick is 7:00 am (nothing); the 16:00 UTC tick is 8:00 am (sends)", async () => {
    try {
      addFile({ id: "w", effective_date: "2026-11-04", status: "uploaded" });
      vi.setSystemTime(new Date("2026-11-04T15:00:00Z"));
      expect(((await (await call()).json()) as { planned: number }).planned).toBe(0);
      vi.setSystemTime(new Date("2026-11-04T16:00:00Z"));
      await call();
      expect(st.emails).toHaveLength(1);
    } finally {
      after();
    }
  });

  it("a failed email releases the claim and answers 500, so the next tick retries", async () => {
    try {
      vi.setSystemTime(pt("2026-10-21", 8));
      addFile({ id: "a", effective_date: "2026-10-21" });
      st.emailOk = false;
      expect((await call()).status).toBe(500);
      expect(st.db.rows("compliance_reminder_log")).toHaveLength(0);
      st.emailOk = true;
      expect((await call()).status).toBe(200);
      expect(st.db.rows("compliance_reminder_log")).toHaveLength(1);
    } finally {
      after();
    }
  });

  it("an unreadable ledger sends the 'could not read' note once a day and answers 500; a wrong secret is refused before any read", async () => {
    try {
      vi.setSystemTime(pt("2026-10-21", 8));
      st.db.before = (req) => (req.url.pathname.endsWith("/ach_files") ? { status: 500, body: { message: "down" } } : undefined);
      expect((await call()).status).toBe(500);
      expect(st.emails).toHaveLength(1);
      expect(st.emails[0].subject).toBe("The 8 am funding check could not read the ACH files");
      expect(st.db.rows("compliance_reminder_log").map((r) => r.dedupe_key)).toEqual(["ach-funding:read-failed:2026-10-21"]);
      expect((await call()).status).toBe(500);
      expect(st.emails).toHaveLength(1);
      st.db.before = null;
      st.db.log.length = 0;
      expect((await call("Bearer nope")).status).toBe(401);
      expect(st.db.log).toHaveLength(0);
    } finally {
      after();
    }
  });

  it("vercel.json runs it at 15:00 and 16:00 UTC; the certification test counts 2 runs a day", () => {
    after();
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons.find((c) => c.path === "/api/cron/ach-funding-8am")?.schedule).toBe("0 15-16/1 * * *");
    expect(read("tests/compliance/leafly-certification.test.ts")).toContain('"/api/cron/ach-funding-8am": 2');
  });
});

// =========================================================================
describe("confirm funding: a gated, owner-only ACH kind in all four places", () => {
  it("kind registered, version columns pinned, replay wired, gated file listed", () => {
    expect(read("src/lib/auth/ach-authority-core.ts")).toContain('"ach_file.confirm_funding": { cls: "live", label: "Record that the money for an ACH file is in the account" }');
    expect(read("src/lib/payments/ach-gate-core.ts")).toContain('"ach_file.confirm_funding": { targetType: "ach_file", idField: "file_id", version: { table: "ach_files", key: "id", cols: ["status", "funding_confirmed_at"] } }');
    expect(read("src/app/admin/settings/banking/approvals/actions.ts")).toContain('"ach_file.confirm_funding": (fd) => files.confirmAchFileFundingAction(fd)');
    expect(read("tests/compliance/r41-s0-owner-authority.test.ts")).toContain('"ach_file.confirm_funding"]');
  });
  it("the action goes through achGate, re-reads the total, checks the form, then the store, then audits amounts only", () => {
    const s = code(read("src/app/admin/settings/banking/file-actions.ts"));
    expect(s).toContain('achGate("ach_file.confirm_funding", fd');
    const body = s.slice(s.indexOf("async function confirmFundingBody"));
    const order = ["readAchFileForFunding(fileId)", "checkFundingForm({ totalCents: file.totalCents", "confirmAchFileFunding({ fileId, actorId: session.profile.id, amountCents: form.amountCents })", 'action: "ach.file.funding_confirmed"'];
    const at = order.map((x) => body.indexOf(x));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(body).toContain("after: { kind: r.kind, amount_cents: form.amountCents, file_total_cents: file.totalCents }");
  });
  it("Operations shows the funding badge and the form only for released or uploaded files without a confirmation", () => {
    const s = read("src/app/admin/settings/banking/operations/page.tsx");
    expect(s).toContain("confirmAchFileFundingAction");
    expect(s).toContain("data-funding");
    expect(s).toMatch(/Confirm funding/);
    expect(s).toMatch(/Ask the owner to confirm funding/);
  });
  it("0276: one server-only function, guard keeps 0274 rules, rollback and CI check wired", () => {
    const m = read("supabase/migrations/0276_ach_file_funding_confirm.sql");
    expect(m).toContain("if p_amount_cents is null or p_amount_cents < f.total_cents then");
    expect(m).toContain("if f.status not in ('released', 'uploaded') then");
    expect(m).toContain("if f.funding_confirmed_at is not null then");
    expect(m).toContain("revoke all on function public.ach_file_confirm_funding(uuid, uuid, bigint) from public, anon, authenticated;");
    expect(m).toContain("grant execute on function public.ach_file_confirm_funding(uuid, uuid, bigint) to service_role;");
    expect(m.replace(/--.*$/gm, "")).not.toMatch(/security definer/i);
    expect(m).toContain("set search_path = public, pg_temp");
    expect(existsSync("supabase/rollbacks/0276_ach_file_funding_confirm.rollback.sql")).toBe(true);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain('{ file: "scripts/recon/ach-file-funding-0276-pg-check.sql", mustPrint: "ACH 0276 CHECK PASSED" }');
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0276_ach_file_funding_confirm.sql");
  });
});

// =========================================================================
describe("file checker: page, nav, actions (stores nothing)", () => {
  it("page, subnav tab and help entries exist", () => {
    expect(read("src/app/admin/settings/banking/checker/page.tsx")).toContain('BankingSubnav active="checker"');
    expect(read("src/app/admin/settings/banking/BankingHelpTabs.tsx")).toContain('{ key: "checker", href: "/admin/settings/banking/checker", label: "File checker" }');
    expect(read("src/lib/admin/help-content.ts")).toContain("/admin/settings/banking/checker");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("File checker");
  });
  it("checking a pasted file audits the fingerprint and rule ids only, never the text", async () => {
    const { checkFileAction } = await import("@/app/admin/settings/banking/checker/actions");
    const raw = checker.testFileForChecker({ entries: [{ amountCents: 0, prenote: true }], description: "PAYROLL", sec: "PPD", effective: "2026-10-23", created: new Date("2026-10-20T17:00:00Z") });
    const fd = new FormData();
    fd.set("text", raw);
    const r = await checkFileAction(null, fd);
    expect(r && r.ok).toBe(true);
    expect(st.audits).toHaveLength(1);
    const a = st.audits[0];
    expect(a.action).toBe("ach.file.checked");
    expect(Object.keys(a.after!).sort()).toEqual(["ok", "problems", "sha256", "warnings"]);
    expect(a.after!.sha256).toBe(checker.fingerprints(raw).exact);
    expect(JSON.stringify(a)).not.toContain("TEST PAYEE");
    expect(JSON.stringify(a)).not.toContain("001234560");
    expect(st.db.log.filter((x) => x.method !== "GET")).toHaveLength(0); // nothing written to the database
  });
  it("an empty form is refused in plain words; a picked file is read byte for byte (latin1)", async () => {
    const { checkFileAction } = await import("@/app/admin/settings/banking/checker/actions");
    const empty = await checkFileAction(null, new FormData());
    expect(empty).toEqual({ ok: false, error: "Pick the downloaded .ach file, or paste its text." });
    const raw = checker.testFileForChecker({ entries: [{ amountCents: 0, prenote: true }], description: "PAYROLL", sec: "PPD", effective: "2026-10-23", created: new Date("2026-10-20T17:00:00Z") });
    const fd = new FormData();
    fd.set("file", new File([raw], "x.ach"));
    const r = await checkFileAction(null, fd);
    expect(r && r.ok && r.source).toBe("the file you picked");
    expect(st.audits[0].after!.sha256).toBe(checker.fingerprints(raw).exact);
  });
  it("the practice run builds from the real settings with $0 prenotes and writes no audit and no row", async () => {
    const { practiceRunAction } = await import("@/app/admin/settings/banking/checker/actions");
    const r = await practiceRunAction(null);
    expect(r && r.ok && r.practice).toBe(true);
    expect(st.audits).toHaveLength(0);
    expect(st.db.log.filter((x) => x.method !== "GET")).toHaveLength(0);
    const s = read("src/lib/payments/timberland-file-checker-store.ts");
    expect(s).toContain('amountCents: 0, name: "PRACTICE PAYEE ONE"');
    expect(s).toContain('amountCents: 0, name: "PRACTICE PAYEE TWO"');
    expect((s.match(/prenote: true/g) ?? []).length).toBe(2);
  });
});

// =========================================================================
describe("go-live board: strict store (unread is never green)", () => {
  const today = "2026-10-19";
  const now = new Date("2026-10-19T17:00:00Z");
  const staff = (rows: Record<string, unknown>[]) => st.db.tables.set("staff_profiles", rows);
  const tone = (gs: { id: string; tone: string }[], id: string) => gs.find((g) => g.id === id)!.tone;

  it("reads the real sources and builds 14 gates; owner and admin are listed by name", async () => {
    staff([
      { full_name: "Michael Lyman", email: "m@x.test", role: "owner", active: true },
      { full_name: null, email: "s@x.test", role: "admin", active: true },
      { full_name: "Clerk", email: "c@x.test", role: "staff", active: true },
    ]);
    const i = await goliveStore.loadGoLiveInput(today, now);
    expect(i.staff).toHaveLength(3);
    expect(i.achRoles).toEqual(["owner", "admin"]);
    expect(i.waitingForOwner).toEqual({ pending: 0, toReview: 0 });
    expect(i.firstFile).toMatchObject({ open: false, stage: "no_file" });
    expect(i.nextDeadline).toBe("none");
    expect(i.room).not.toBeNull();
    const b = golive.buildGoLiveBoard(i);
    expect(b).toHaveLength(14);
    const access = b.find((g) => g.id === "access")!;
    expect(access.tone).toBe("green");
    expect(access.detail).toContain("Michael Lyman (owner), s@x.test (admin)");
    expect(access.detail).not.toContain("Clerk");
    expect(tone(b, "prenote")).toBe("red");
  });

  it("a pending request or review makes the inbox red", async () => {
    st.db.tables.set("ach_change_requests", [{ id: "r1", status: "pending" }, { id: "r2", status: "approved" }]);
    st.db.tables.set("ach_owner_reviews", [{ id: "v1", checked_off_at: null }, { id: "v2", checked_off_at: "2026-10-18T00:00:00Z" }]);
    const i = await goliveStore.loadGoLiveInput(today, now);
    expect(i.waitingForOwner).toEqual({ pending: 1, toReview: 1 });
    expect(tone(golive.buildGoLiveBoard(i), "inbox")).toBe("red");
  });

  it("every failed read is 'could not be read', never green (unlike the nav badge's zeros)", async () => {
    st.db.before = () => ({ status: 500, body: { message: "down" } });
    const i = await goliveStore.loadGoLiveInput(today, now);
    expect(i.staff).toBeNull();
    expect(i.waitingForOwner).toBeNull();
    expect(i.firstFile).toBeNull();
    expect(i.room).toBeNull();
    expect(i.nextDeadline).toBeNull();
    const b = golive.buildGoLiveBoard(i);
    for (const id of ["access", "inbox", "prenote", "wait", "room", "deadline"]) expect(tone(b, id)).toBe("unread");
    expect(golive.goLiveSummary(b).line).toMatch(/could not be read.*paying by check always works/);
  });

  it("a broken staff row or an over-cap staff read is unread too", async () => {
    staff([{ full_name: "X", email: "x@x.test", role: "owner", active: "yes" }]);
    expect((await goliveStore.loadGoLiveInput(today, now)).staff).toBeNull();
    staff(Array.from({ length: goliveStore.STAFF_READ_CAP + 1 }, (_, n) => ({ full_name: `P${n}`, email: `p${n}@x.test`, role: "staff", active: true })));
    expect((await goliveStore.loadGoLiveInput(today, now)).staff).toBeNull();
  });

  it("a guide read that throws turns the calendar gates red (never green) and match unread", async () => {
    st.guideThrows = true;
    const b = golive.buildGoLiveBoard(await goliveStore.loadGoLiveInput(today, now));
    for (const id of ["contract", "countersigned", "schedule-g", "access-ready", "encryption", "migrations"]) expect(tone(b, id)).toBe("red");
    expect(tone(b, "match")).toBe("unread");
    expect(tone(b, "dual")).toBe("info");
  });

  it("the next deadline is the earliest open file's upload cutoff", async () => {
    addFile({ id: "late", effective_date: "2026-10-30", filename: "late.ach" });
    addFile({ id: "soon", effective_date: "2026-10-23", filename: "soon.ach" });
    const i = await goliveStore.loadGoLiveInput(today, now);
    expect(i.nextDeadline !== null && i.nextDeadline !== "none" && i.nextDeadline.filename).toBe("soon.ach");
  });

  it("the guide renders the board in #go-live, and every deep link resolves to a real page and anchor", () => {
    expect(read("src/app/admin/settings/banking/guide/page.tsx")).toContain("<GoLiveBoard today={today} now={new Date()} />");
    expect(read("src/components/admin/payments/GoLiveBoard.tsx")).toContain('<section id="go-live"');
    for (const href of Object.values(golive.GO_LIVE_LINKS)) {
      const [path, hash] = href.split("#");
      const page = `src/app${path.split("?")[0]}/page.tsx`;
      expect(existsSync(page), page).toBe(true);
      if (hash) expect(read(page), `${page}#${hash}`).toContain(`id="${hash}"`);
    }
  });
});

// =========================================================================
describe("S9 docs", () => {
  it("TEST-PLAN has T-362, T-363, T-364, the manual lists them, the roadmap has the S9 row", () => {
    const tp = read("docs/audit/TEST-PLAN.md");
    const man = read("docs/audit/test-manual/index.html");
    for (const t of ["T-362", "T-363", "T-364"]) {
      expect(tp).toContain(`- **${t} (`);
      expect(man).toContain(`data-test="${t}"`);
    }
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(r).toContain("| S9 | Get rolling");
    expect(r).toContain("## S9 in detail");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("## R41 \u2014 0276 \u2014 Owner confirms a file's funding");
  });
});

// =========================================================================
describe("S9 mutation runs (test the tests)", () => {
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
  it("scripts/r41/mutate-s9-app.last.log: every app mutant killed, controls pass", () => {
    pin("scripts/r41/mutate-s9-app.py", "scripts/r41/mutate-s9-app.last.log", 12);
  });
  it("scripts/r41/mutate-0276-sql.last.log: every SQL mutant killed, controls pass", () => {
    pin("scripts/r41/mutate-0276-sql.py", "scripts/r41/mutate-0276-sql.last.log", 6);
  });
});
