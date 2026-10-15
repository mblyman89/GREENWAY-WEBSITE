/**
 * R41 S10: obligation clocks, the Timberland communications log (0277), the
 * STOP card on every banking page, and the fees card.
 *
 *   1. Quotes are verbatim to the repo mirrors (whitespace-normalized).
 *   2. The pure core: every clock's date from the contract, the strict
 *      reversal rule (the EARLIER of 24 h and the 5th banking day), done
 *      items closed, the fees arithmetic, the pre-filled letter.
 *   3. The REAL store over the REAL postgrest-js client against
 *      FakePostgrest: exactly the columns written, owner stamp, refusals in
 *      plain words, a failed read is { ok: false } (never an empty list).
 *   4. The gated kinds: wired once (ACH_ACTIONS, KIND_SPECS, REPLAY,
 *      GATED_FILES), and the actions write only through the store.
 *   5. Rendered markup: the STOP card, the clocks panel, the fees card, and
 *      the banking layout (STOP card on every banking page, the termination
 *      banner while a termination notice is open).
 *   6. 0277 content pins, docs, and the mutation-run logs (test the tests).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  audits: [] as { action: string; entityId?: string | null; after?: Record<string, unknown> | null }[],
  session: null as null | { email: string; profile: { id: string; role: string } },
  redirects: [] as string[],
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
  getStaffSession: async () => st.session,
  requirePermission: async () => st.session,
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (e: { action: string; entityId?: string | null; after?: Record<string, unknown> | null }) => {
    st.audits.push(e);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    st.redirects.push(u);
    throw new Error(`NEXT_REDIRECT ${u}`);
  },
}));
// The gate itself is tested in r41-s0; here it runs the body as the owner would.
vi.mock("@/lib/payments/ach-gate", () => ({
  achGate: async (_kind: string, _fd: FormData, _o: unknown, run: (s: unknown) => Promise<unknown>) => run(st.session),
}));
vi.mock("@/lib/reports/timezone", async (orig) => ({ ...((await orig()) as object), pacificToday: () => "2026-10-20" }));

const core = await import("@/lib/payments/timberland-obligations-core");
const store = await import("@/lib/payments/timberland-comms-store");
const { StopCard } = await import("@/app/admin/settings/banking/StopCard");
const { ClocksPanel } = await import("@/app/admin/settings/banking/operations/ClocksPanel");

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const MICHAEL = "22222222-2222-4222-8222-222222222222";
const today = "2026-10-20";
const now = new Date("2026-10-20T18:00:00Z"); // Tue Oct 20, 11:00 am PDT
const comms = () => st.db.rows("ach_timberland_comms");
type R = import("@/lib/payments/timberland-obligations-core").CommsRow;
const row = (p: Partial<R> & Pick<R, "id" | "entry_type">): R => ({ received_on: today, occurred_at: null, effective_on: null, amount_cents: null, summary: "note", closes_id: null, created_at: "2026-10-20T18:00:00Z", ...p });
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  st.db = new FakePostgrest();
  st.audits = [];
  st.redirects = [];
  st.session = { email: "michael@greenwaymarijuana.com", profile: { id: MICHAEL, role: "owner" } };
  for (const t of ["ach_timberland_comms", "ach_return_notices"]) st.db.tables.set(t, []);
  st.db.uniques.push({ table: "ach_timberland_comms", columns: ["closes_id"], where: (r) => r.closes_id !== null && r.closes_id !== undefined, name: "atc_closes_once" });
});

// =========================================================================
describe("quotes are verbatim to the mirrors (whitespace-normalized)", () => {
  const all = [
    ...Object.values(core.COMMS_TYPE_SPECS).map((s) => s.quote),
    core.NO_CANCEL_QUOTE,
    core.REVERSAL_NO_REFUND_QUOTE,
    core.PAYEE_NOTICE_QUOTE,
    core.LOST_TOKEN_QUOTE,
  ].filter((q): q is import("@/lib/payments/timberland-obligations-core").Quote => q !== null);
  it("there are 16 quotes and every one is in its mirror", () => {
    expect(all).toHaveLength(16);
    for (const q of all) expect(flat(read(`docs/authorities/${q.file}`)), q.section).toContain(flat(q.text));
  });
  it("the mirror files are the two named ones", () => {
    expect(new Set(all.map((q) => q.file))).toEqual(new Set([core.AGREEMENT_FILE, core.BRENDA_FILE]));
  });
});

// =========================================================================
describe("pure core: clocks from the contract", () => {
  const one = (r: R) => core.obligationClocks({ todayIso: today, nowUtc: now, comms: [r], notices: [] });
  it("reserve: 10 banking days (section 22); auth copy: 5 banking days with Veterans Day skipped (section 5)", () => {
    expect(one(row({ id: "a", entry_type: "reserve_demand", amount_cents: 500_000 }))[0].dueDate).toBe("2026-11-03");
    expect(one(row({ id: "b", entry_type: "auth_copy_request", received_on: "2026-11-09" }))[0].dueDate).toBe("2026-11-17");
  });
  it("over-limit: 2 usable banking days before the file (section 26); termination is red (section 30)", () => {
    expect(one(row({ id: "c", entry_type: "over_limit_request", effective_on: "2026-10-26", amount_cents: 7_500_000 }))[0].dueDate).toBe("2026-10-22");
    const t = one(row({ id: "d", entry_type: "termination_notice", effective_on: "2026-10-23" }))[0];
    expect(t.tone).toBe("danger");
    expect(t.section).toBe("\u00a730");
  });
  it("compromise: written confirmation 24 hours after the call (Schedule F)", () => {
    const c = one(row({ id: "e", entry_type: "compromise_reported", occurred_at: "2026-10-20T16:30:00.000Z" }))[0];
    expect(c.dueUtc).toBe("2026-10-21T16:30:00.000Z");
    expect(c.section).toBe("Schedule F");
  });
  it("reversal: the EARLIER of 24 h from discovery and 4:00 pm Pacific on the 5th banking day; phone, never a debit file", () => {
    expect(core.reversalDueUtc("2026-10-20T16:00:00.000Z", "2026-10-16")).toEqual({ dueUtc: "2026-10-21T16:00:00.000Z", lastDay: "2026-10-23", windowClosed: false });
    expect(core.reversalDueUtc("2026-10-23T10:00:00.000Z", "2026-10-16").dueUtc).toBe("2026-10-23T23:00:00.000Z");
    expect(core.reversalDueUtc("2026-10-24T16:00:00.000Z", "2026-10-16").windowClosed).toBe(true);
    const c = one(row({ id: "f", entry_type: "reversal_needed", occurred_at: "2026-10-20T16:00:00.000Z", effective_on: "2026-10-16" }))[0];
    expect(c.action).toContain("Phone Timberland at 1-800-562-8761");
    expect(c.action).toContain("no debit files");
  });
  it("statement: 30 calendar days (section 17); amendment and fee notices: the same day", () => {
    expect(one(row({ id: "g", entry_type: "statement_received" }))[0].dueDate).toBe("2026-11-19");
    expect(one(row({ id: "h", entry_type: "amendment_notice" }))[0].dueDate).toBe(today);
    expect(one(row({ id: "i", entry_type: "fee_notice" }))[0].section).toBe("\u00a724");
  });
  it("no clock for facts and 'other'; a done item is gone; done rows are never clocks", () => {
    for (const t of ["dual_approval_on", "schedule_g_email_corrected", "access_ready", "countersigned_received", "other"] as const) expect(one(row({ id: t, entry_type: t }))).toEqual([]);
    const s = row({ id: "s", entry_type: "statement_received" });
    expect(core.obligationClocks({ todayIso: today, nowUtc: now, comms: [s, row({ id: "dn", entry_type: "done", closes_id: "s" })], notices: [] })).toEqual([]);
  });
  it("a bank correction gives its apply-by clock and the 15-day refuse-by line; a return has no contract deadline", () => {
    const n = core.obligationClocks({ todayIso: today, nowUtc: now, comms: [], notices: [{ id: "n1", notice_kind: "noc", code: "C01", received_on: "2026-10-19", apply_by: "2026-10-27", payee: "Pat" }] });
    expect(n.map((c) => [c.key, c.dueDate])).toEqual([["notice:n1", "2026-10-27"], ["refuse:n1", "2026-11-03"]]);
    const r = core.obligationClocks({ todayIso: today, nowUtc: now, comms: [], notices: [{ id: "r1", notice_kind: "return", code: "R03", received_on: today, apply_by: null, payee: "Pat" }] });
    expect(r[0].dueDate).toBeNull();
    expect(r[0].tone).toBe("neutral");
  });
  it("sorts red first, then by due", () => {
    const list = core.obligationClocks({
      todayIso: today,
      nowUtc: now,
      comms: [row({ id: "st", entry_type: "statement_received" }), row({ id: "tn", entry_type: "termination_notice", effective_on: "2026-11-30" }), row({ id: "am", entry_type: "amendment_notice" })],
      notices: [],
    });
    expect(list[0].key).toBe("comms:tn");
  });
  it("fees: $50 + $5 per return or correction; refuses negatives", () => {
    expect(core.expectedMonthlyFees(2, 1).totalCents).toBe(6500);
    expect(core.expectedMonthlyFees(0, 0).totalCents).toBe(5000);
    expect(() => core.expectedMonthlyFees(-1, 0)).toThrow();
    expect(core.FEE_ROWS.map((f) => f.cents)).toEqual([5000, 500, 2400, 2500]);
  });
  it("logged facts feed the go-live board; a termination is in effect until closed", () => {
    expect(core.loggedFacts([row({ id: "x", entry_type: "access_ready" })])).toEqual({ scheduleGEmail: false, accessReady: true, countersigned: false, dualApprovalOn: false });
    const t = row({ id: "t", entry_type: "termination_notice", effective_on: "2026-11-01" });
    expect(core.terminationInEffect([t])).toEqual({ endsOn: "2026-11-01" });
    expect(core.terminationInEffect([t, row({ id: "d", entry_type: "done", closes_id: "t" })])).toBeNull();
  });
  it("the self-tests pass and are registered with their exact floor", () => {
    expect(core.__runTimberlandObligationsCoreTests()).toEqual({ passed: 69, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("timberland-obligations-core", __runTimberlandObligationsCoreTests(), 69)');
  });
});

// =========================================================================
describe("forms", () => {
  const g = (o: Record<string, string>) => (k: string) => o[k] ?? null;
  it("a compromise call needs the time; the time is Pacific", () => {
    expect(core.checkCommsForm(g({ entry_type: "compromise_reported", received_on: today, summary: "phone stolen" }), today, now).ok).toBe(false);
    const r = core.checkCommsForm(g({ entry_type: "compromise_reported", received_on: today, time: "09:30", summary: "phone stolen" }), today, now);
    expect(r.ok && r.row.occurredAtUtc).toBe("2026-10-20T16:30:00.000Z");
  });
  it("refuses a future date, a future time, and a long digit run in the note", () => {
    expect(core.checkCommsForm(g({ entry_type: "other", received_on: "2026-10-21", summary: "hello there" }), today, now).ok).toBe(false);
    expect(core.checkCommsForm(g({ entry_type: "compromise_reported", received_on: today, time: "12:00", summary: "hello there" }), today, now).ok).toBe(false);
    expect(core.checkCommsForm(g({ entry_type: "other", received_on: today, summary: "acct 1234567" }), today, now).ok).toBe(false);
  });
  it("reserve and over-limit need an amount; over-limit and termination need the second date", () => {
    expect(core.checkCommsForm(g({ entry_type: "reserve_demand", received_on: today, summary: "letter" }), today, now).ok).toBe(false);
    expect(core.checkCommsForm(g({ entry_type: "termination_notice", received_on: today, summary: "letter" }), today, now).ok).toBe(false);
    const r = core.checkCommsForm(g({ entry_type: "reserve_demand", received_on: today, amount: "5,000.00", summary: "letter" }), today, now);
    expect(r.ok && r.row.amountCents).toBe(500_000);
  });
});

// =========================================================================
describe("store (real postgrest-js against FakePostgrest)", () => {
  it("writes exactly the checked row, stamped with the actor", async () => {
    const r = await store.addTimberlandComms({
      row: { entryType: "reserve_demand", receivedOn: today, occurredAtUtc: null, effectiveOn: null, amountCents: 500_000, summary: "Letter from Brenda" },
      actorId: MICHAEL,
    });
    expect(r.ok).toBe(true);
    const post = st.db.log.find((x) => x.method === "POST")!;
    expect(post.body).toEqual({ entry_type: "reserve_demand", received_on: today, occurred_at: null, effective_on: null, amount_cents: 500_000, summary: "Letter from Brenda", created_by: MICHAEL });
  });
  it("closes an item with a done row; a second close is refused in plain words", async () => {
    comms().push({ id: "aaaaaaaa-1111-4222-8333-444455556666", entry_type: "statement_received" });
    const first = await store.closeTimberlandComms({ closesId: "aaaaaaaa-1111-4222-8333-444455556666", summary: "matched", receivedOn: today, actorId: MICHAEL });
    expect(first).toMatchObject({ ok: true, closedType: "statement_received" });
    expect(comms().at(-1)).toMatchObject({ entry_type: "done", closes_id: "aaaaaaaa-1111-4222-8333-444455556666", created_by: MICHAEL });
    const again = await store.closeTimberlandComms({ closesId: "aaaaaaaa-1111-4222-8333-444455556666", summary: "matched", receivedOn: today, actorId: MICHAEL });
    expect(again).toEqual({ ok: false, error: "That item is already marked done." });
  });
  it("refuses a bad id before any call, and an unknown id after one read", async () => {
    expect((await store.closeTimberlandComms({ closesId: "nope", summary: "x x x", receivedOn: today, actorId: MICHAEL })).ok).toBe(false);
    expect(st.db.log).toHaveLength(0);
    const r = await store.closeTimberlandComms({ closesId: "bbbbbbbb-1111-4222-8333-444455556666", summary: "x x x", receivedOn: today, actorId: MICHAEL });
    expect(r).toEqual({ ok: false, error: "That item could not be found. Reload the page." });
    expect(st.db.log.filter((x) => x.method === "POST")).toHaveLength(0);
  });
  it("maps database refusals to plain words and never echoes the raw text", async () => {
    st.db.before = () => ({ status: 400, body: { code: "P0001", message: "ACH_OWNER_ONLY: only the owner adds to the Timberland log. Send it as a request for owner approval." } });
    const r = await store.addTimberlandComms({ row: { entryType: "other", receivedOn: today, occurredAtUtc: null, effectiveOn: null, amountCents: null, summary: "hello" }, actorId: MICHAEL });
    expect(r).toEqual({ ok: false, error: "Only the owner adds to the Timberland log. Send it as a request for owner approval." });
  });
  it("a missing table names migration 0277; a failed read is { ok: false }, never an empty list", async () => {
    st.db.missing.add("ach_timberland_comms");
    const r = await store.readTimberlandComms();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/run migration 0277/);
    st.db.missing.clear();
    st.db.before = () => ({ status: 500, body: { message: "down" } });
    expect((await store.readTimberlandComms()).ok).toBe(false);
  });
  it("reads newest first, capped at 500", async () => {
    comms().push(row({ id: "o", entry_type: "other", received_on: "2026-10-01" }), row({ id: "n", entry_type: "other", received_on: "2026-10-19" }));
    const r = await store.readTimberlandComms();
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(["n", "o"]);
    const get = st.db.log.find((x) => x.method === "GET")!;
    expect(get.url.searchParams.get("limit")).toBe("500");
  });
  it("this month's returns and corrections are counted (open or resolved); a failed read is null, never 0", async () => {
    st.db.rows("ach_return_notices").push(
      { id: "1", notice_kind: "return", received_on: "2026-10-02" },
      { id: "2", notice_kind: "noc", received_on: "2026-10-20" },
      { id: "3", notice_kind: "return", received_on: "2026-09-30" },
    );
    expect(await store.countNoticesThisMonth(today)).toEqual({ returns: 1, nocs: 1 });
    st.db.before = () => ({ status: 500, body: { message: "down" } });
    expect(await store.countNoticesThisMonth(today)).toBeNull();
  });
  it("the count reads every page past PostgREST's 1,000-row cap, and a failed later page is null (SLICE 5C)", async () => {
    const rows = st.db.rows("ach_return_notices");
    for (let i = 0; i < 1203; i++) rows.push({ id: `id-${String(i).padStart(5, "0")}`, notice_kind: i % 3 === 0 ? "noc" : "return", received_on: "2026-10-05" });
    expect(await store.countNoticesThisMonth(today)).toEqual({ returns: 802, nocs: 401 });
    const gets = st.db.log.filter((x) => x.method === "GET" && x.table === "ach_return_notices");
    expect(gets.length).toBe(2);
    expect(gets.every((g) => g.url.searchParams.get("order") === "id.asc")).toBe(true);
    st.db.before = (req) => (req.method === "GET" && req.url.searchParams.get("offset") === "1000" ? { status: 500, body: { message: "timeout" } } : undefined);
    expect(await store.countNoticesThisMonth(today)).toBeNull();
  });
});

// =========================================================================
describe("actions (through the store; audit; redirect to #clocks)", () => {
  it("add: checks the form, writes, audits without the note, and lands on #clocks", async () => {
    const { addTimberlandCommsAction } = await import("@/app/admin/settings/banking/comms-actions");
    await expect(addTimberlandCommsAction(form({ entry_type: "statement_received", received_on: today, summary: "October statement" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(st.redirects[0]).toMatch(/^\/admin\/settings\/banking\/operations\?msg=.*#clocks$/);
    expect(comms()).toHaveLength(1);
    expect(st.audits[0].action).toBe("ach.timberland_comms.logged");
    expect(JSON.stringify(st.audits[0].after)).not.toContain("October statement");
  });
  it("add: a bad form writes nothing", async () => {
    const { addTimberlandCommsAction } = await import("@/app/admin/settings/banking/comms-actions");
    await expect(addTimberlandCommsAction(form({ entry_type: "nope", received_on: today, summary: "hello" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(st.redirects[0]).toContain("error=");
    expect(st.db.log.filter((x) => x.method === "POST")).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
  });
  it("done: closes the item and audits", async () => {
    const { closeTimberlandCommsAction } = await import("@/app/admin/settings/banking/comms-actions");
    comms().push({ id: "aaaaaaaa-1111-4222-8333-444455556666", entry_type: "fee_notice" });
    await expect(closeTimberlandCommsAction(form({ comms_id: "aaaaaaaa-1111-4222-8333-444455556666", summary: "read it" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(st.audits[0]).toMatchObject({ action: "ach.timberland_comms.done", entityId: "aaaaaaaa-1111-4222-8333-444455556666" });
  });
});

// =========================================================================
describe("gated kinds are wired once", () => {
  it("ACH_ACTIONS, KIND_SPECS, TARGET_TYPES, REPLAY, GATED_FILES, labelForTarget", () => {
    const a = read("src/lib/auth/ach-authority-core.ts");
    expect(a).toContain('"timberland_comms.log": { cls: "live", label: "Add an entry to the Timberland communications log" }');
    expect(a).toContain('"timberland_comms.done": { cls: "live", label: "Mark a Timberland log item done" }');
    const g = read("src/lib/payments/ach-gate-core.ts");
    expect(g).toContain('"timberland_comms.log": { targetType: "timberland_comms", idField: null, version: null }');
    expect(g).toContain('"timberland_comms.done": { targetType: "timberland_comms", idField: "comms_id", version: { table: "ach_timberland_comms", key: "closes_id", cols: ["id"] } }');
    expect(g).toContain('  "timberland_comms",\n] as const;');
    const r = read("src/app/admin/settings/banking/approvals/actions.ts");
    expect(r).toContain('"timberland_comms.log": (fd) => comms.addTimberlandCommsAction(fd)');
    expect(r).toContain('"timberland_comms.done": (fd) => comms.closeTimberlandCommsAction(fd)');
    expect(read("tests/compliance/r41-s0-owner-authority.test.ts")).toContain('"src/app/admin/settings/banking/comms-actions.ts": ["timberland_comms.log", "timberland_comms.done"]');
    expect(read("src/lib/payments/ach-requests-store.ts")).toContain('if (t === "timberland_comms") {');
    const act = read("src/app/admin/settings/banking/comms-actions.ts");
    expect(act).toContain('achGate("timberland_comms.log", fd');
    expect(act).toContain('achGate("timberland_comms.done", fd');
  });
  it("a done request goes stale once the item is closed: the version reads the done row by closes_id", async () => {
    const { versionString, KIND_SPECS } = await import("@/lib/payments/ach-gate-core");
    const spec = KIND_SPECS["timberland_comms.done"].version!;
    expect(versionString(spec, [])).toBe("absent");
    expect(versionString(spec, [{ id: "x" }])).not.toBe("absent");
  });
});

// =========================================================================
describe("rendered: STOP card, clocks panel, fees card", () => {
  it("STOP card: the phone as a tel link, the four situations, the honest notes, the letter", () => {
    const html = renderToStaticMarkup(<StopCard todayIso={today} calledAtUtc="2026-10-20T16:30:00.000Z" />);
    expect(html).toContain('href="tel:18005628761"');
    expect(html).toContain("1-800-562-8761");
    for (const w of core.STOP_WHEN) expect(html).toContain(w.replace(/'/g, "&#x27;"));
    expect(html).toContain("Financial Institution shall have no liability if it fails to effect the cancellation.");
    expect(html).toContain("This does not mean that you would get your money back.");
    expect(html).toContain("Tue Oct 20, 9:30 am Pacific");
    expect(html).toContain("$25.00");
    // Only the public bank phone may be a long digit run (as the tel: link).
    expect(html.replace("18005628761", "")).not.toMatch(/[0-9]{7,}/);
  });
  it("clocks panel: lists clocks with a Done form; a failed read says so and is never 'nothing is due'", () => {
    const ok = renderToStaticMarkup(
      <ClocksPanel todayIso={today} now={now} isOwner comms={{ ok: true, rows: [row({ id: "aaaaaaaa-1111-4222-8333-444455556666", entry_type: "statement_received" })], capped: false }} notices={[]} noticesOk monthCounts={{ returns: 1, nocs: 0 }} />,
    );
    expect(ok).toContain('id="clocks"');
    expect(ok).toContain('name="comms_id" value="aaaaaaaa-1111-4222-8333-444455556666"');
    expect(ok).toContain("2026-10-20");
    expect(ok).toContain("$55.00");
    const bad = renderToStaticMarkup(<ClocksPanel todayIso={today} now={now} isOwner={false} comms={{ ok: false, error: "down" }} notices={[]} noticesOk monthCounts={null} />);
    expect(bad).toContain("could not be read");
    expect(bad).not.toContain("Nothing is due to Timberland right now.");
    expect(bad).toContain("Send to Michael for approval");
    expect(bad).toContain("Could not count this month");
    const none = renderToStaticMarkup(<ClocksPanel todayIso={today} now={now} isOwner comms={{ ok: true, rows: [], capped: false }} notices={[]} noticesOk monthCounts={{ returns: 0, nocs: 0 }} />);
    expect(none).toContain("Nothing is due to Timberland right now.");
  });
  it("the operations page renders the panel before the notices", () => {
    const p = read("src/app/admin/settings/banking/operations/page.tsx");
    expect(p.indexOf("<ClocksPanel")).toBeGreaterThan(0);
    expect(p.indexOf("<ClocksPanel")).toBeLessThan(p.indexOf('<section id="notices"'));
  });
});

// =========================================================================
describe("banking layout: STOP card on every banking page", () => {
  it("there is one layout at the banking root, and every banking page sits under it", () => {
    const pages: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(join(process.cwd(), d), { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${d}/${e.name}`);
        else if (e.name === "page.tsx") pages.push(`${d}/${e.name}`);
      }
    };
    walk("src/app/admin/settings/banking");
    expect(pages.length).toBeGreaterThanOrEqual(9);
    expect(read("src/app/admin/settings/banking/layout.tsx")).toContain("<StopCard");
  });
  it("renders the STOP card for staff with ACH access, and the termination banner while one is open", async () => {
    const { default: BankingLayout } = await import("@/app/admin/settings/banking/layout");
    comms().push(row({ id: "t", entry_type: "termination_notice", effective_on: "2026-11-01" }));
    const html = renderToStaticMarkup(await BankingLayout({ children: <p>page</p> }));
    expect(html).toContain('id="stop-card"');
    expect(html).toContain('id="termination-banner"');
    expect(html).toContain("the last day is 2026-11-01");
    expect(html).toContain("<p>page</p>");
  });
  it("no banner without a notice; the STOP card stays when the log cannot be read", async () => {
    const { default: BankingLayout } = await import("@/app/admin/settings/banking/layout");
    st.db.before = () => ({ status: 500, body: { message: "down" } });
    const html = renderToStaticMarkup(await BankingLayout({ children: <p>page</p> }));
    expect(html).toContain('id="stop-card"');
    expect(html).not.toContain("termination-banner");
  });
  it("a person without ACH access (or signed out) sees only the page", async () => {
    const { default: BankingLayout } = await import("@/app/admin/settings/banking/layout");
    st.session = { email: "c@x.test", profile: { id: "33333333-3333-4333-8333-333333333333", role: "staff" } };
    expect(renderToStaticMarkup(await BankingLayout({ children: <p>page</p> }))).toBe("<p>page</p>");
    st.session = null;
    expect(renderToStaticMarkup(await BankingLayout({ children: <p>page</p> }))).toBe("<p>page</p>");
    expect(st.db.log).toHaveLength(0);
  });
});

// =========================================================================
describe("go-live board accepts the logged facts", () => {
  it("the store ORs loggedFacts into the three Timberland facts and dual approval", () => {
    const s = read("src/lib/payments/timberland-golive-store.ts");
    expect(s).toContain("const logged = comms && comms.ok ? loggedFacts(comms.rows) : null;");
    for (const k of ["countersigned", "scheduleGEmail", "accessReady", "dualApprovalOn"]) expect(s).toContain(`${k}: Boolean(t?.${k}) || Boolean(logged?.${k}),`);
  });
});

// =========================================================================
describe("0277 content pins", () => {
  const m = read("supabase/migrations/0277_ach_timberland_comms.sql");
  it("append-only, owner-stamped, done closes once; service_role select+insert only", () => {
    expect(m).toContain("raise exception 'ACH_COMMS_APPEND_ONLY");
    expect(m).toContain("ach_write_by_owner(new.created_by)");
    expect(m).toContain("create unique index if not exists atc_closes_once on public.ach_timberland_comms (closes_id) where closes_id is not null;");
    expect(m).toContain("revoke update, delete, truncate on table public.ach_timberland_comms from service_role;");
    expect(m).toContain("grant select, insert on table public.ach_timberland_comms to service_role;");
    expect(m).toContain("'timberland_comms'");
  });
  it("the rollback refuses while rows or requests exist", () => {
    const rb = read("supabase/rollbacks/0277_ach_timberland_comms.rollback.sql");
    expect(rb).toMatch(/ach_timberland_comms/);
    expect(rb).toMatch(/target_type = 'timberland_comms'/);
  });
});

describe("S10 docs", () => {
  it("TEST-PLAN has T-365, T-366, T-367, the manual lists them, the roadmap has the S10 row", () => {
    const tp = read("docs/audit/TEST-PLAN.md");
    const man = read("docs/audit/test-manual/index.html");
    for (const t of ["T-365", "T-366", "T-367"]) {
      expect(tp).toContain(`- **${t} (`);
      expect(man).toContain(`data-test="${t}"`);
      expect(man).toContain(`"${t}": "part-b--the-results-log"`);
    }
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(r).toContain("| S9 | Get rolling");
    expect(r).toContain("| #1383 | 0276 |");
    expect(r).toContain("| S10 | Obligation clocks");
    expect(r).toContain("## S10 in detail");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("## R41 \u2014 0277 \u2014 The Timberland communications log");
  });
});

describe("S10 mutation runs (test the tests)", () => {
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
  it("scripts/r41/mutate-s10-app.last.log: every app mutant killed, controls pass", () => {
    pin("scripts/r41/mutate-s10-app.py", "scripts/r41/mutate-s10-app.last.log", 24);
  });
  it("scripts/r41/mutate-0277-sql.last.log: every SQL mutant killed, controls pass, Supabase default privileges simulated and removed", () => {
    pin("scripts/r41/mutate-0277-sql.py", "scripts/r41/mutate-0277-sql.last.log", 15);
    const log = read("scripts/r41/mutate-0277-sql.last.log");
    expect(log).toContain("supabase default privileges simulated");
    expect(log).toContain("supabase default privileges removed");
    expect(log).toMatch(/killed {3}service-role-may-update/);
    expect(read("scripts/r41/mutate-0277-sql.py")).toContain("https://supabase.com/docs/guides/api/securing-your-api");
  });
});
