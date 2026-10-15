/**
 * R41 S11: OFAC sanctions screening of every payee (migration 0278).
 *
 *   1. Quotes are verbatim to the repo mirrors (whitespace-normalized).
 *   2. The REAL download path over real-format OFAC files (tests/fixtures/
 *      ofac: real public records, CRLF + the 0x1A end mark) with a fake
 *      fetch: User-Agent sent, the digest checked, a mismatch refuses, a
 *      cut-short file refuses, a network error refuses.
 *   3. The REAL store over the REAL postgrest-js client against
 *      FakePostgrest: payees paged by id past 1,000 rows (SLICE 5C), an
 *      unfinished read fails the run (never a partial screen), the run and
 *      its results recorded in ONE rpc call, a failed run recorded too.
 *   4. Reviews: the columns written, refusals in plain words.
 *   5. Actions and the cron route (claim, dedupe, a failed email unclaims).
 *   6. NEVER A PAYMENT GATE: only the screening files read the screening
 *      tables; payroll, the vendor file builder and the file checker never
 *      import them.
 *   7. Rendered panel, gate wiring, 0278 pins, docs, mutation logs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type FakeRequest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  audits: [] as { action: string; entityId?: string | null; after?: Record<string, unknown> | null }[],
  session: null as null | { email: string; profile: { id: string; role: string } },
  redirects: [] as string[],
  emails: [] as { subject: string; html: string; to: string[] }[],
  emailOk: true,
  fetchImpl: null as null | ((url: string, init: { method: string; headers: Record<string, string> }) => Promise<unknown>),
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
  requirePermission: async () => st.session,
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (e: { action: string; entityId?: string | null; after?: Record<string, unknown> | null }) => {
    st.audits.push(e);
  },
}));
vi.mock("@/lib/orders/staff-alert-email", () => ({
  sendStaffAlertEmail: async (p: { subject: string; html: string; to: string[] }) => {
    st.emails.push(p);
    return st.emailOk ? { ok: true, recipients: p.to.length } : { ok: false, detail: "provider returned 500", didTimeout: false };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    st.redirects.push(u);
    throw new Error(`NEXT_REDIRECT ${u}`);
  },
}));
vi.mock("@/lib/payments/ach-gate", () => ({
  achGate: async (_kind: string, _fd: FormData, _o: unknown, run: (s: unknown) => Promise<unknown>) => run(st.session),
}));

const core = await import("@/lib/payments/ofac-screening-core");
const store = await import("@/lib/payments/ofac-screening-store");
const { ScreeningPanel } = await import("@/app/admin/settings/banking/screening/ScreeningPanel");
const { VendorFollowUpSection } = await import("@/app/admin/settings/banking/VendorFollowUpSection");
const enroll = await import("@/lib/payments/vendor-ach-enrollment-core");

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const MICHAEL = "22222222-2222-4222-8222-222222222222";
const STEPHEN = "33333333-3333-4333-8333-333333333333";
const uid = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;
const FIX = "tests/fixtures/ofac";
const fixture = (f: string) => new Uint8Array(readFileSync(join(FIX, f)));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

type Call = { url: string; method: string; headers: Record<string, string> };
/** A fake OFAC server answering from the fixtures. */
function ofacServer(opts: { digest?: string | null | "real"; headStatus?: number; override?: Partial<Record<string, Uint8Array | number | "throw">> } = {}) {
  const calls: Call[] = [];
  const fetchImpl: import("@/lib/payments/ofac-screening-store").FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const file = url.slice(core.OFAC_EXPORT_BASE.length);
    const hdr = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
    if (init.method === "HEAD") {
      const status = opts.headStatus ?? 200;
      const d = opts.digest === undefined || opts.digest === "real" ? `SHA-256=${sha(fixture("SDN.CSV"))}` : opts.digest;
      return { ok: status < 300, status, headers: hdr(d && status < 300 ? { digest: d } : {}), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const o = opts.override?.[file];
    if (o === "throw") throw new Error("network");
    if (typeof o === "number") return { ok: false, status: o, headers: hdr({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const body = o ?? fixture(file);
    return { ok: true, status: 200, headers: hdr({ "last-modified": "Tue, 20 Oct 2026 14:05:00 GMT" }), arrayBuffer: async () => body.slice().buffer };
  };
  return { calls, fetchImpl };
}

const seedPayees = () => {
  st.db.tables.set("employees", [
    { id: uid(1), full_name: "Jamie Rivera", w2_first_name_and_initial: "Jamie Q", w2_last_name: "Rivera", active: true, employment_status: "active" },
    { id: uid(2), full_name: "Kim Jong Un", w2_first_name_and_initial: null, w2_last_name: null, active: true, employment_status: "active" },
    { id: uid(3), full_name: "Old Hand", w2_first_name_and_initial: null, w2_last_name: null, active: false, employment_status: "terminated" },
  ]);
  st.db.tables.set("vendors", [
    { id: uid(11), display_name: "Evergreen Supply", legal_name: "Evergreen Supply LLC", dba: null, is_active: true },
    { id: uid(12), display_name: "Closed Vendor", legal_name: null, dba: null, is_active: false },
  ]);
  st.db.tables.set("vendor_bank_details", [{ id: uid(21), vendor_id: uid(11), vendor_name: "National Bank of Cuba" }]);
  st.db.tables.set("ach_authorizations", [{ id: uid(31), payee_type: "employee", employee_id: uid(1), vendor_id: null, payee_name: "J. Rivera" }]);
};

/** The fake records what ofac_record_run would write (the real SQL is tested by the pg-check and mutate-0278-sql). */
const rpcCalls: { p_run: Record<string, unknown>; p_results: Record<string, unknown>[] }[] = [];
const recordRpc = (req: FakeRequest) => {
  if (req.method === "POST" && req.url.pathname.endsWith("/rpc/ofac_record_run")) {
    const b = req.body as { p_run: Record<string, unknown>; p_results: Record<string, unknown>[] };
    rpcCalls.push(b);
    const runId = st.db.nextId();
    st.db.rows("ofac_screening_runs").push({ id: runId, ran_at: "2026-10-20T13:30:00Z", ...b.p_run });
    for (const r of b.p_results) st.db.rows("ofac_screening_results").push({ id: st.db.nextId(), run_id: runId, ...r });
    return { status: 200, body: runId };
  }
  return undefined;
};

beforeEach(() => {
  st.db = new FakePostgrest();
  st.audits = [];
  st.redirects = [];
  st.emails = [];
  st.emailOk = true;
  rpcCalls.length = 0;
  st.session = { email: "michael@greenwaymarijuana.com", profile: { id: MICHAEL, role: "owner" } };
  for (const t of ["employees", "vendors", "vendor_bank_details", "ach_authorizations", "ofac_screening_runs", "ofac_screening_results", "ofac_match_reviews", "compliance_reminder_log"]) st.db.tables.set(t, []);
  st.db.uniques.push({ table: "ofac_match_reviews", columns: ["result_id"], name: "ofac_reviews_once" });
  st.db.uniques.push({ table: "compliance_reminder_log", columns: ["dedupe_key"], name: "compliance_reminder_log_dedupe_key_key" });
  st.db.before = recordRpc;
});

// =========================================================================
describe("quotes are verbatim to the mirrors (whitespace-normalized)", () => {
  const files: Record<keyof typeof core.OFAC_QUOTES, string> = {
    agreement3: "ach/timberland-ach-agreement-2026-10-09.redacted.txt",
    faq249: "ofac/ofac-faq-249-score-calculation.txt",
    faq249Higher: "ofac/ofac-faq-249-score-calculation.txt",
    faq250: "ofac/ofac-faq-250-no-threshold.txt",
    faq287: "ofac/ofac-faq-287-automated-use.txt",
    faq5FalsePositives: "ofac/ofac-faq-5-valid-match.txt",
    faq5Proceed: "ofac/ofac-faq-5-valid-match.txt",
    faq5Records: "ofac/ofac-faq-5-valid-match.txt",
    faq5Report: "ofac/ofac-faq-5-valid-match.txt",
    weakAka: "ofac/ofac-dat-spec-2023-09-25.txt",
    userAgent: "ofac/ofac-technical-notice-2024-05-16-user-agent.txt",
  };
  it("all 11 quotes are in their mirror", () => {
    expect(Object.keys(core.OFAC_QUOTES).sort()).toEqual(Object.keys(files).sort());
    for (const [k, f] of Object.entries(files)) {
      expect(flat(read(`docs/authorities/${f}`)), k).toContain(flat(core.OFAC_QUOTES[k as keyof typeof core.OFAC_QUOTES]));
    }
  });
  it("the pure core self-test passes (96 assertions)", () => {
    expect(core.__runOfacScreeningCoreTests()).toEqual({ passed: 96, failed: 0 });
  });
});

// =========================================================================
describe("download: real-format OFAC files, fake fetch", () => {
  it("fetches the four files with OFAC's User-Agent, verifies SDN.CSV against the published digest", async () => {
    const srv = ofacServer();
    const d = await store.downloadOfacLists(srv.fetchImpl);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(srv.calls.map((c) => `${c.method} ${c.url.slice(core.OFAC_EXPORT_BASE.length)}`)).toEqual(["GET SDN.CSV", "GET ALT.CSV", "GET CONS_PRIM.CSV", "GET CONS_ALT.CSV", "HEAD SDN.CSV"]);
    for (const c of srv.calls) expect(c.headers["User-Agent"]).toBe(core.OFAC_USER_AGENT);
    expect(d.digestVerified).toBe(true);
    expect(d.files.map((f) => [f.file, f.records])).toEqual([
      ["SDN.CSV", 4],
      ["ALT.CSV", 1],
      ["CONS_PRIM.CSV", 2],
      ["CONS_ALT.CSV", 4],
    ]);
    expect(d.files[0].sha256).toBe(sha(fixture("SDN.CSV")));
    expect(d.listSha256).toBe(createHash("sha256").update(d.files.map((f) => `${f.file}:${f.sha256}`).join("\n")).digest("hex"));
    expect(d.lastModified).toBe("Tue, 20 Oct 2026 14:05:00 GMT");
  });
  it("a digest mismatch refuses the whole download", async () => {
    const d = await store.downloadOfacLists(ofacServer({ digest: `SHA-256=${"0".repeat(64)}` }).fetchImpl);
    expect(d).toEqual({ ok: false, error: expect.stringContaining("did not match OFAC's published fingerprint") });
  });
  it("no digest (HEAD 400, as OFAC answers for the other files) is recorded as not verified, never refused", async () => {
    const d = await store.downloadOfacLists(ofacServer({ headStatus: 400 }).fetchImpl);
    expect(d.ok && d.digestVerified).toBe(false);
    expect(d.ok && d.digestNote).toMatch(/checked by structure/);
  });
  it("a cut-short file, a non-ASCII byte, an HTTP error and a network error each refuse", async () => {
    const sdn = fixture("SDN.CSV");
    const cut = await store.downloadOfacLists(ofacServer({ override: { "ALT.CSV": fixture("ALT.CSV").slice(0, -1) } }).fetchImpl);
    expect(cut).toEqual({ ok: false, error: expect.stringContaining("ALT.CSV: the file does not end with OFAC's end-of-file mark") });
    const bad = sdn.slice();
    bad[10] = 0xe9;
    expect(await store.downloadOfacLists(ofacServer({ override: { "SDN.CSV": bad } }).fetchImpl)).toEqual({ ok: false, error: expect.stringContaining("byte 11 is not ASCII") });
    expect(await store.downloadOfacLists(ofacServer({ override: { "CONS_PRIM.CSV": 503 } }).fetchImpl)).toEqual({ ok: false, error: "CONS_PRIM.CSV: OFAC's server answered 503. Nothing was screened." });
    expect(await store.downloadOfacLists(ofacServer({ override: { "CONS_ALT.CSV": "throw" } }).fetchImpl)).toEqual({ ok: false, error: expect.stringContaining("CONS_ALT.CSV: OFAC's server did not answer") });
  });
});

// =========================================================================
describe("gatherPayees: every name, paged by id (SLICE 5C)", () => {
  it("skips terminated employees and inactive vendors; adds the W-2 name, bank-record name and authorization name", async () => {
    seedPayees();
    const r = await store.gatherPayees();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payees.map((p) => `${p.payeeType}:${p.label}`)).toEqual(["employee:Jamie Rivera", "employee:Kim Jong Un", "vendor:Evergreen Supply"]);
    expect(r.payees[0].names).toEqual(["Jamie Rivera", "Jamie Q Rivera", "J. Rivera"]);
    expect(r.payees[2].names).toEqual(["Evergreen Supply", "Evergreen Supply LLC", "", "National Bank of Cuba"]);
    for (const t of ["employees", "vendors", "vendor_bank_details", "ach_authorizations"]) {
      const g = st.db.log.find((x) => x.method === "GET" && x.table === t)!;
      expect(g.url.searchParams.get("order"), t).toBe("id.asc");
      expect(g.url.searchParams.get("offset"), t).toBe("0");
      expect(g.url.searchParams.get("limit"), t).toBe("1000");
    }
  });
  it("reads past 1,000 rows, and a failed later page fails the whole gather (never a partial list)", async () => {
    st.db.tables.set(
      "vendors",
      Array.from({ length: 1001 }, (_, i) => ({ id: uid(1000 + i), display_name: `Vendor ${i}`, legal_name: null, dba: null, is_active: true })),
    );
    const r = await store.gatherPayees();
    expect(r.ok && r.payees.length).toBe(1001);
    st.db.before = (req) => (req.table === "vendors" && req.url.searchParams.get("offset") === "1000" ? { status: 500, body: { message: "timeout" } } : undefined);
    expect(await store.gatherPayees()).toEqual({ ok: false, error: "The vendors list could not be read in full, so nobody was screened (a partial screen would look complete)." });
  });
});

// =========================================================================
describe("runOfacScreening: one recorded run, never touching a payment", () => {
  it("screens every payee, records the run and its results in ONE rpc call, and reports what needs review", async () => {
    seedPayees();
    const r = await store.runOfacScreening({ trigger: "cron", actorId: MICHAEL, fetchImpl: ofacServer().fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(rpcCalls).toHaveLength(1);
    const { p_run, p_results } = rpcCalls[0];
    expect(p_run).toMatchObject({ trigger: "cron", created_by: null, status: "ok", digest_verified: true, payees_count: 3, possible_matches: 2, unscreenable: 0, threshold: core.MATCH_THRESHOLD });
    expect(p_run.list_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p_run.payees_sha256).toMatch(/^[0-9a-f]{64}$/);
    const byLabel = Object.fromEntries(p_results.map((x) => [x.label, x]));
    expect(byLabel["Jamie Rivera"]).toMatchObject({ result: "clear", matches: [] });
    expect(byLabel["Kim Jong Un"]).toMatchObject({ result: "possible_match", top_score: 1 });
    expect((byLabel["Kim Jong Un"].matches as { key: string }[])[0].key).toBe("SDN:20157");
    expect(byLabel["Evergreen Supply"]).toMatchObject({ result: "possible_match" });
    expect((byLabel["Evergreen Supply"].matches as { key: string; screenedName: string }[]).map((m) => `${m.key} ${m.screenedName}`)).toContain("SDN:306 National Bank of Cuba");
    expect(r).toMatchObject({ payees: 3, possibleMatches: 2, needsReview: 2, trueMatches: 0, unscreenable: 0, digestVerified: true });
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/);
    // The only writes are the rpc: no payroll, vendor-payment or file table is touched.
    expect(st.db.log.filter((x) => x.method !== "GET").map((x) => x.url.pathname)).toEqual(["/rest/v1/rpc/ofac_record_run"]);
  });
  it("a manual run is stamped with the actor; a cron run never is", async () => {
    seedPayees();
    await store.runOfacScreening({ trigger: "manual", actorId: STEPHEN, fetchImpl: ofacServer().fetchImpl });
    expect(rpcCalls[0].p_run.created_by).toBe(STEPHEN);
  });
  it("an earlier 'not a match' review covering every current match key means nothing needs review; the pending key changes with the set", async () => {
    seedPayees();
    const first = await store.runOfacScreening({ trigger: "cron", actorId: null, fetchImpl: ofacServer().fetchImpl });
    expect(first.ok).toBe(true);
    const evergreen = st.db.rows("ofac_screening_results").find((x) => x.label === "Evergreen Supply")!;
    st.db.rows("ofac_match_reviews").push({
      id: uid(901),
      result_id: evergreen.id,
      payee_type: "vendor",
      payee_id: uid(11),
      decision: "not_a_match",
      match_keys: (evergreen.matches as import("@/lib/payments/ofac-screening-core").NameMatch[]).map(core.matchKey),
      note: "Bank-record name typed wrong; vendor is a WSLCB-licensed Washington LLC.",
      created_at: "2026-10-20T15:00:00Z",
    });
    const second = await store.runOfacScreening({ trigger: "cron", actorId: null, fetchImpl: ofacServer().fetchImpl });
    expect(second.ok && second.needsReview).toBe(1);
    expect(first.ok && second.ok && first.pendingKey !== second.pendingKey).toBe(true);
  });
  it("a true match stays counted on every later run", async () => {
    seedPayees();
    await store.runOfacScreening({ trigger: "cron", actorId: null, fetchImpl: ofacServer().fetchImpl });
    const kim = st.db.rows("ofac_screening_results").find((x) => x.label === "Kim Jong Un")!;
    st.db.rows("ofac_match_reviews").push({ id: uid(902), result_id: kim.id, payee_type: "employee", payee_id: uid(2), decision: "true_match", match_keys: ["SDN:20157|KIM JONG UN"], note: "Name and date of birth match the list entry exactly.", created_at: "2026-10-20T15:00:00Z" });
    const r = await store.runOfacScreening({ trigger: "cron", actorId: null, fetchImpl: ofacServer().fetchImpl });
    expect(r.ok && r.trueMatches).toBe(1);
    expect(r.ok && r.needsReview).toBe(1);
  });
  it("a failed download is recorded as a failed run (no results) and screens nobody", async () => {
    seedPayees();
    const r = await store.runOfacScreening({ trigger: "cron", actorId: null, fetchImpl: ofacServer({ override: { "SDN.CSV": 403 } }).fetchImpl });
    expect(r).toEqual({ ok: false, error: "SDN.CSV: OFAC's server answered 403. Nothing was screened.", recorded: true });
    expect(rpcCalls).toEqual([{ p_run: { trigger: "cron", created_by: null, status: "failed", error: "SDN.CSV: OFAC's server answered 403. Nothing was screened.", threshold: core.MATCH_THRESHOLD }, p_results: [] }]);
    expect(st.db.log.some((x) => x.table === "employees")).toBe(false);
  });
  it("an unfinished payee read fails the run (recorded), never a partial screen", async () => {
    seedPayees();
    st.db.before = (req) => (req.table === "employees" ? { status: 500, body: { message: "down" } } : recordRpc(req));
    const r = await store.runOfacScreening({ trigger: "cron", actorId: null, fetchImpl: ofacServer().fetchImpl });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("The employees list could not be read in full"), recorded: true });
    expect(rpcCalls[0].p_run.status).toBe("failed");
    expect(rpcCalls[0].p_results).toEqual([]);
  });
  it("the database refusing the record is a failure in plain words (missing 0278 names the migration)", async () => {
    seedPayees();
    st.db.before = (req) =>
      req.url.pathname.endsWith("/rpc/ofac_record_run") ? { status: 404, body: { code: "PGRST202", message: "Could not find the function public.ofac_record_run(p_results, p_run) in the schema cache" } } : undefined;
    const r = await store.runOfacScreening({ trigger: "cron", actorId: null, fetchImpl: ofacServer().fetchImpl });
    expect(r).toEqual({ ok: false, error: "Sanctions screening is not set up yet: apply migration 0278.", recorded: false });
  });
});

// =========================================================================
describe("recordOfacReview (real postgrest-js against FakePostgrest)", () => {
  const seedResult = (result: "possible_match" | "clear" = "possible_match") => {
    const matches = result === "clear" ? [] : [{ key: "SDN:20157", list: "SDN", entNum: "20157", listName: "KIM, Jong Un", kind: "primary", sdnType: "individual", program: "DPRK3", remarks: "DOB 08 Jan 1984", score: 1, screenedName: "Kim Jong Un" }];
    st.db.rows("ofac_screening_results").push({ id: uid(500), run_id: uid(400), payee_type: "employee", payee_id: uid(2), label: "Kim Jong Un", names_screened: ["Kim Jong Un"], result, top_score: result === "clear" ? 0.5 : 1, matches });
  };
  const note = "Our employee was born 1994 in Tacoma, WA; I-9 on file. Different person.";
  it("writes exactly the columns, with the match keys the review covers", async () => {
    seedResult();
    const r = await store.recordOfacReview({ resultId: uid(500), decision: "not_a_match", note, actorId: MICHAEL });
    expect(r).toEqual({ ok: true, id: expect.any(String), label: "Kim Jong Un" });
    const post = st.db.log.find((x) => x.method === "POST" && x.table === "ofac_match_reviews")!;
    expect(post.body).toEqual({ result_id: uid(500), payee_type: "employee", payee_id: uid(2), decision: "not_a_match", match_keys: ["SDN:20157|KIM JONG UN"], note, created_by: MICHAEL });
  });
  it("refuses a bad id before any call; a clear result; an unknown result; a second review; the trigger's codes in plain words", async () => {
    expect(await store.recordOfacReview({ resultId: "x", decision: "not_a_match", note, actorId: MICHAEL })).toEqual({ ok: false, error: "That screening result could not be found. Reload the page." });
    expect(st.db.log).toHaveLength(0);
    expect((await store.recordOfacReview({ resultId: uid(500), decision: "not_a_match", note, actorId: MICHAEL })).ok).toBe(false);
    seedResult("clear");
    expect(await store.recordOfacReview({ resultId: uid(500), decision: "not_a_match", note, actorId: MICHAEL })).toEqual({ ok: false, error: "That screening result is clear; there is nothing to review." });
    st.db.tables.set("ofac_screening_results", []);
    seedResult();
    expect((await store.recordOfacReview({ resultId: uid(500), decision: "not_a_match", note, actorId: MICHAEL })).ok).toBe(true);
    expect(await store.recordOfacReview({ resultId: uid(500), decision: "true_match", note, actorId: MICHAEL })).toEqual({ ok: false, error: "That possible match was already reviewed." });
    st.db.before = (req) => (req.method === "POST" ? { status: 400, body: { code: "P0001", message: "ACH_OWNER_ONLY: only the owner records a screening review." } } : undefined);
    st.db.tables.set("ofac_match_reviews", []);
    expect(await store.recordOfacReview({ resultId: uid(500), decision: "not_a_match", note, actorId: STEPHEN })).toEqual({ ok: false, error: "Only the owner records a screening review. Send it as a request for owner approval." });
  });
});

// =========================================================================
describe("readScreeningView", () => {
  it("lists what is not plainly clear from the last ok run, true matches first; a failed read is { ok: false }", async () => {
    seedPayees();
    await store.runOfacScreening({ trigger: "cron", actorId: null, fetchImpl: ofacServer().fetchImpl });
    const v = await store.readScreeningView();
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.lastOk?.payeesCount).toBe(3);
    expect(v.clearCount).toBe(1);
    expect(v.items.map((i) => i.status.status)).toEqual(["needs_review", "needs_review"]);
    expect(store.needsAttention(v)).toBe(2);
    const get = st.db.log.find((x) => x.method === "GET" && x.table === "ofac_screening_runs")!;
    expect(get.url.searchParams.get("limit")).toBe(String(store.RUN_HISTORY));
    st.db.before = () => ({ status: 500, body: { message: "down" } });
    expect((await store.readScreeningView()).ok).toBe(false);
  });
});

// =========================================================================
describe("actions (audit; redirect to the screening page)", () => {
  const actions = () => import("@/app/admin/settings/banking/screening-actions");
  it("Screen now: runs, audits and lands on #matches (manual, stamped with the actor)", async () => {
    seedPayees();
    vi.stubGlobal("fetch", ofacServer().fetchImpl);
    try {
      await expect((await actions()).screenNowAction()).rejects.toThrow(/NEXT_REDIRECT/);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(rpcCalls[0].p_run).toMatchObject({ trigger: "manual", created_by: MICHAEL });
    expect(st.audits[0]).toMatchObject({ action: "ach.ofac_screening.run", after: { payees: 3, possible_matches: 2, needs_review: 2 } });
    const u = new URL(st.redirects[0], "http://x");
    expect(u.pathname).toBe("/admin/settings/banking/screening");
    expect(u.hash).toBe("#matches");
    expect(u.searchParams.get("msg")).toBe("Screened 3 payee(s): 2 possible match(es) to review. Payments are not blocked.");
  });
  it("Screen now failing lands on #runs with the error", async () => {
    vi.stubGlobal("fetch", ofacServer({ override: { "SDN.CSV": 500 } }).fetchImpl);
    try {
      await expect((await actions()).screenNowAction()).rejects.toThrow(/NEXT_REDIRECT/);
    } finally {
      vi.unstubAllGlobals();
    }
    const u = new URL(st.redirects[0], "http://x");
    expect(u.hash).toBe("#runs");
    expect(u.searchParams.get("error")).toBe("SDN.CSV: OFAC's server answered 500. Nothing was screened. (This failed run is in the history.)");
  });
  it("Record decision: checks the form first; writes, audits (no note in the audit) and says what to do next", async () => {
    const a = await actions();
    await expect(a.recordOfacReviewAction(form({ result_id: uid(500), decision: "not_a_match", note: "too short" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(new URL(st.redirects[0], "http://x").searchParams.get("error")).toMatch(/at least 20 characters/);
    expect(st.db.log).toHaveLength(0);
    st.db.rows("ofac_screening_results").push({ id: uid(500), run_id: uid(400), payee_type: "employee", payee_id: uid(2), label: "Kim Jong Un", names_screened: ["Kim Jong Un"], result: "possible_match", top_score: 1, matches: [{ key: "SDN:20157", screenedName: "Kim Jong Un" }] });
    await expect(a.recordOfacReviewAction(form({ result_id: uid(500), decision: "true_match", note: "Name and date of birth match the SDN entry." }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(st.audits[0]).toEqual(expect.objectContaining({ action: "ach.ofac_review.recorded", after: { result_id: uid(500), decision: "true_match" } }));
    expect(new URL(st.redirects[1], "http://x").searchParams.get("msg")).toMatch(/^Recorded: Kim Jong Un is a TRUE match\./);
  });
});

// =========================================================================
describe("the daily cron route", () => {
  const call = async (auth = "Bearer s11secret") => {
    const { GET } = await import("@/app/api/cron/ofac-screening/route");
    const { NextRequest } = await import("next/server");
    return GET(new NextRequest("http://x/api/cron/ofac-screening", { headers: { authorization: auth } }));
  };
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s11secret");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("ORDER_EMAIL_FROM", "alerts@example.test");
    vi.stubEnv("ACH_NOTIFY_MICHAEL_EMAIL", "michael@greenwaymarijuana.com");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T13:30:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses without the secret", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(st.db.log).toHaveLength(0);
  });
  it("possible matches: one email, claimed first; a second tick the same week sends nothing", async () => {
    seedPayees();
    vi.stubGlobal("fetch", ofacServer().fetchImpl);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, payees: 3, possibleMatches: 2, needsReview: 2, emailed: true, emailError: null });
    expect(st.emails).toHaveLength(1);
    expect(st.emails[0].subject).toBe("OFAC screening: 2 possible match(es) to review");
    expect(st.emails[0].html).toContain("Nothing is blocked: payroll and vendor payments run as usual.");
    const keys = st.db.rows("compliance_reminder_log").map((r) => String(r.dedupe_key));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^ofac-screening:attention:[0-9a-f]{24}:0:0:w2963$/);
    expect(st.db.rows("compliance_reminder_log")[0]).toMatchObject({ stage: "ofac-screening", channel: "email" });
    const res2 = await call();
    expect(res2.status).toBe(200);
    expect(st.emails).toHaveLength(1);
  });
  it("nothing needs review: no email and no claim", async () => {
    st.db.tables.set("employees", [{ id: uid(1), full_name: "Jamie Rivera", w2_first_name_and_initial: null, w2_last_name: null, active: true, employment_status: "active" }]);
    vi.stubGlobal("fetch", ofacServer().fetchImpl);
    const res = await call();
    expect(await res.json()).toMatchObject({ ok: true, emailed: false });
    expect(st.emails).toHaveLength(0);
    expect(st.db.rows("compliance_reminder_log")).toHaveLength(0);
  });
  it("a failed screen: one failure email per Pacific day and status 500", async () => {
    vi.stubGlobal("fetch", ofacServer({ override: { "SDN.CSV": 500 } }).fetchImpl);
    const res = await call();
    expect(res.status).toBe(500);
    expect(st.emails[0].subject).toBe("OFAC screening could not run today");
    expect(st.emails[0].html).toContain("Payments are not affected.");
    expect(st.db.rows("compliance_reminder_log").map((r) => r.dedupe_key)).toEqual(["ofac-screening:failed:2026-10-20"]);
    await call();
    expect(st.emails).toHaveLength(1);
  });
  it("a failed email removes the claim so the next run retries, and answers 500", async () => {
    seedPayees();
    st.emailOk = false;
    vi.stubGlobal("fetch", ofacServer().fetchImpl);
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ emailed: false, emailError: "email failed" });
    expect(st.db.rows("compliance_reminder_log")).toHaveLength(0);
  });
  it("is scheduled daily at 13:30 UTC in vercel.json, with maxDuration 300", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons).toContainEqual({ path: "/api/cron/ofac-screening", schedule: "30 13 * * *" });
    expect(read("src/app/api/cron/ofac-screening/route.ts")).toContain("export const maxDuration = 300;");
  });
});

// =========================================================================
describe("NEVER A PAYMENT GATE", () => {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  it("only the screening files (and the registry/reset/request-label lists) mention the screening module or tables", () => {
    const hits = walk("src")
      .filter((f) => /ofac-screening|ofac_screening|ofac_match_reviews|ofac_record_run/.test(read(f)))
      .sort();
    expect(hits).toEqual([
      "src/app/admin/settings/banking/screening-actions.ts",
      "src/app/admin/settings/banking/screening/ScreeningPanel.tsx",
      "src/app/admin/settings/banking/screening/page.tsx",
      "src/app/api/cron/ofac-screening/route.ts",
      "src/lib/accounting/factory-reset-core.ts",
      "src/lib/admin/schema-tables.ts",
      "src/lib/payments/ach-gate-core.ts",
      "src/lib/payments/ach-requests-store.ts",
      "src/lib/payments/ofac-screening-core.ts",
      "src/lib/payments/ofac-screening-store.ts",
    ]);
  });
  it("the gate core mentions the reviews table only as the stale-request version of its own kind", () => {
    const g = read("src/lib/payments/ach-gate-core.ts");
    expect(g.match(/ofac_match_reviews/g)).toHaveLength(1);
    expect(read("src/lib/payments/ach-requests-store.ts").match(/ofac_screening_results/g)).toHaveLength(1);
  });
  it("the 0278 pg-check asserts no other database function reads the screening tables", () => {
    expect(read("scripts/recon/ofac-screening-0278-pg-check.sql")).toMatch(/ofac_screening_results/);
  });
});

// =========================================================================
describe("rendered panel", () => {
  const item = (status: "needs_review" | "true_match"): import("@/lib/payments/ofac-screening-store").ScreeningItem => {
    const result = {
      id: uid(500),
      runId: uid(400),
      payeeType: "employee" as const,
      payeeId: uid(2),
      label: "Kim Jong Un",
      namesScreened: ["Kim Jong Un", "Kim J Un"],
      result: "possible_match" as const,
      topScore: 1,
      matches: [{ key: "SDN:20157", list: "SDN" as const, entNum: "20157", listName: "KIM, Jong Un", kind: "primary" as const, sdnType: "individual", program: "DPRK3", remarks: "DOB 08 Jan 1984", score: 1, screenedName: "Kim Jong Un" }],
    };
    const review = { id: uid(901), resultId: uid(500), payeeType: "employee" as const, payeeId: uid(2), decision: "true_match" as const, matchKeys: ["SDN:20157|KIM JONG UN"], note: "Name and DOB match.", reviewedAt: "2026-10-20T15:00:00Z" };
    return { result, status: status === "true_match" ? { status, review } : { status } };
  };
  const run = { id: uid(400), ranAt: "2026-10-20T13:30:00Z", trigger: "cron" as const, status: "ok" as const, error: null, listLastModified: "Tue, 20 Oct 2026 14:05:00 GMT", digestVerified: true, payeesCount: 3, possibleMatches: 1, unscreenable: 0, files: [] };
  const render = (isOwner: boolean, items = [item("needs_review")]) =>
    renderToStaticMarkup(
      <ScreeningPanel view={{ ok: true, runs: [run], lastOk: run, items, clearCount: 2, reviews: [] }} now={new Date("2026-10-20T18:00:00Z")} isOwner={isOwner} screenNow={async () => {}} review={async () => {}} />,
    );
  it("says first that screening never blocks a payment, then the status, matches, method and history", () => {
    const html = render(true);
    expect(html).toContain('id="never-blocks"');
    expect(html).toContain("<strong>Screening never blocks a payment.</strong>");
    expect(html.indexOf('id="never-blocks"')).toBeLessThan(html.indexOf('id="status"'));
    for (const id of ["status", "matches", "how", "runs"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("SDN #20157 \u00b7 individual \u00b7 DPRK3");
    expect(html).not.toContain("\\u00b7");
    expect(html).toContain("SDN.CSV matched OFAC&#x27;s published fingerprint.");
    expect(html).toContain("Screened today.");
    expect(html).toContain("1-800-562-8761");
  });
  it("the review form: radio decision, a required note of 20+, and the owner's / admin's button words", () => {
    const html = render(true);
    expect(html).toContain('name="result_id" value="' + uid(500) + '"');
    expect(html).toContain('<input type="radio" required="" name="decision" value="not_a_match"/>');
    expect(html).toContain('value="true_match"');
    expect(html).toMatch(/<textarea name="note" required="" minLength="20" maxLength="2000"/i);
    expect(html).toContain("Record decision");
    expect(render(false)).toContain("Send to Michael for approval");
  });
  it("a true match shows the decision and no form; a failed read says so", () => {
    const html = render(true, [item("true_match")]);
    expect(html).toContain("True match (recorded)");
    expect(html).not.toContain('name="result_id"');
    const bad = renderToStaticMarkup(<ScreeningPanel view={{ ok: false, error: "Database not connected, so screening cannot be shown." }} now={new Date()} isOwner screenNow={async () => {}} review={async () => {}} />);
    expect(bad).toContain('role="alert"');
    expect(bad).not.toContain("never-blocks");
  });
  it("stale after 3 days is an alert", () => {
    const html = renderToStaticMarkup(
      <ScreeningPanel view={{ ok: true, runs: [run], lastOk: run, items: [], clearCount: 3, reviews: [] }} now={new Date("2026-10-24T18:00:00Z")} isOwner screenNow={async () => {}} review={async () => {}} />,
    );
    expect(html).toContain("The last successful screen was 4 days ago. The daily check may be failing.");
  });
});

// =========================================================================
describe("gate kind ofac_review.record is wired once; the page is the 5th banking tab", () => {
  it("ACH_ACTIONS, KIND_SPECS, TARGET_TYPES, REPLAY, GATED_FILES, labelForTarget", () => {
    expect(read("src/lib/auth/ach-authority-core.ts")).toContain('"ofac_review.record": { cls: "live", label: "Record a decision on a possible OFAC sanctions match" }');
    const g = read("src/lib/payments/ach-gate-core.ts");
    expect(g).toContain('"ofac_review.record": { targetType: "ofac_review", idField: "result_id", version: { table: "ofac_match_reviews", key: "result_id", cols: ["id"] } }');
    expect(g).toContain('  "ofac_review",\n');
    expect(read("src/app/admin/settings/banking/approvals/actions.ts")).toContain('"ofac_review.record": (fd) => screening.recordOfacReviewAction(fd)');
    expect(read("tests/compliance/r41-s0-owner-authority.test.ts")).toContain('"src/app/admin/settings/banking/screening-actions.ts": ["ofac_review.record"]');
    expect(read("src/lib/payments/ach-requests-store.ts")).toContain('if (t === "ofac_review") {');
    const act = read("src/app/admin/settings/banking/screening-actions.ts");
    expect(act).toContain('achGate("ofac_review.record", fd');
    expect(act.match(/achGate\(/g)).toHaveLength(1);
  });
  it("a review request goes stale once that result is reviewed", async () => {
    const { versionString, KIND_SPECS } = await import("@/lib/payments/ach-gate-core");
    const spec = KIND_SPECS["ofac_review.record"].version!;
    expect(versionString(spec, [])).toBe("absent");
    expect(versionString(spec, [{ id: "x" }])).not.toBe("absent");
  });
  it("the banking sub-nav lists Sanctions screening; the help and concierge mention it", () => {
    expect(read("src/app/admin/settings/banking/BankingHelpTabs.tsx")).toContain('{ key: "screening", href: "/admin/settings/banking/screening", label: "Sanctions screening" }');
    expect(read("src/app/admin/settings/banking/screening/page.tsx")).toContain('<BankingSubnav active="screening" />');
  });
});

// =========================================================================
describe("0278 content pins", () => {
  const m = read("supabase/migrations/0278_ofac_screening.sql");
  it("append-only (rows and TRUNCATE), results only for an ok run, owner-only reviews once per result, note rules", () => {
    expect(m).toContain("raise exception 'OFAC_APPEND_ONLY: screening records are never changed or deleted.';");
    expect(m).toContain("raise exception 'OFAC_RESULT_RUN: results belong to a successful screen only.';");
    expect(m).toContain("if not public.ach_write_by_owner(new.created_by) then");
    expect(m).toContain("constraint ofac_reviews_once unique (result_id)");
    expect(m).toContain("new.note ~ '[0-9]{7,}'");
    expect(m.match(/before truncate on public\.ofac_/g)).toHaveLength(3);
    expect(m).toContain("constraint osres_clear_shape check ((result = 'clear') = (jsonb_array_length(matches) = 0))");
  });
  it("service_role: select + insert only; the rpc for service_role only; nothing security definer", () => {
    expect(m).toContain("revoke update, delete, truncate on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews from service_role;");
    expect(m).toContain("grant select, insert on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews to service_role;");
    expect(m).toContain("grant execute on function public.ofac_record_run(jsonb, jsonb) to service_role;");
    expect(m).not.toMatch(/^\s*security definer/im);
    expect(m).toContain("'timberland_comms', 'ofac_review'));");
  });
  it("the rollback refuses while rows or review requests exist", () => {
    const rb = read("supabase/rollbacks/0278_ofac_screening.rollback.sql");
    expect(rb).toMatch(/ofac_screening_runs/);
    expect(rb).toMatch(/target_type = 'ofac_review'/);
  });
});

// =========================================================================
describe("Round 12: Vendors to follow up is collapsible and searchable", () => {
  type Row = import("@/lib/payments/vendor-ach-enrollment-core").VendorFollowUpRow;
  const row = (name: string, label = "Needs bank info", nextStep = "Ask for a voided check.", warnings: string[] = []): Row => ({ vendorId: `v-${name.replace(/\W/g, "")}`, name, state: "needs_bank_info", label, nextStep, warnings });
  const rows = [row("\u00c9vergreen Supply LLC"), row("O'Brien Farms", "On hold", "Release the hold after the callback."), row("Cascade Grow", "Not verified", "Call back on a known number.", ["Bank info changed since it was verified"])];
  it("filter: every word must match (name, status, next step, warning); accents, case and apostrophes ignored; order kept", () => {
    const f = (q: string) => enroll.filterVendorFollowUp(rows, q).map((r) => r.name);
    expect(f("")).toEqual(rows.map((r) => r.name));
    expect(f("  ")).toEqual(rows.map((r) => r.name));
    expect(f("EVERGREEN")).toEqual(["\u00c9vergreen Supply LLC"]);
    expect(f("supply ever")).toEqual(["\u00c9vergreen Supply LLC"]);
    expect(f("evergreen cascade")).toEqual([]);
    expect(f("obrien")).toEqual(["O'Brien Farms"]);
    expect(f("O\u2019Brien")).toEqual(["O'Brien Farms"]);
    expect(f("on hold")).toEqual(["O'Brien Farms"]);
    expect(f("callback")).toEqual(["O'Brien Farms"]);
    expect(f("changed")).toEqual(["Cascade Grow"]);
    expect(f("r")).toEqual(rows.map((r) => r.name));
  });
  it("renders closed by default (the vault is right below), with the count in the header and a labelled search box", () => {
    const html = renderToStaticMarkup(<VendorFollowUpSection rows={rows} optedOutCount={2} />);
    expect(html).toMatch(/^<details id="vendor-follow-up"/);
    expect(html).not.toMatch(/^<details[^>]* open=""/);
    expect(html).toContain("<summary");
    expect(html).toContain("Vendors to follow up (3)</h2>");
    expect(html).toContain('type="search"');
    expect(html).toContain("Search vendors to follow up</label>");
    expect(html).toContain('placeholder="Search by vendor name, status or next step"');
    expect(html).toContain("2 vendors opted out of ACH (not listed).");
    for (const r of rows) expect(html).toContain(`href="/admin/vendors/${r.vendorId}"`);
    expect(html).toContain("Bank info changed since it was verified");
    expect(html).toContain("max-h-[32rem]");
  });
  it("an empty list says so and shows no search box", () => {
    const html = renderToStaticMarkup(<VendorFollowUpSection rows={[]} optedOutCount={0} />);
    expect(html).toContain("Vendors to follow up (0)</h2>");
    expect(html).toContain("Nothing to chase. Every vendor is ACH-ready or opted out.");
    expect(html).not.toContain('type="search"');
  });
  it("the component remembers open/closed on this device, writes nothing to the server, and the page uses it", () => {
    const c = read("src/app/admin/settings/banking/VendorFollowUpSection.tsx");
    expect(c.startsWith('"use client";')).toBe(true);
    expect(c).toContain('export const FOLLOW_UP_OPEN_KEY = "greenway.banking.vendorFollowUp.open";');
    expect(c).toContain('window.localStorage.setItem(FOLLOW_UP_OPEN_KEY, now ? "1" : "0");');
    expect(c).toContain("const shown = filterVendorFollowUp(rows, query);");
    expect(c).not.toMatch(/fetch\(|action=|use server/);
    // Reopened on the DOM node after mount (uncontrolled), never via setState in an effect.
    expect(c).toContain('if (detailsRef.current && window.localStorage.getItem(FOLLOW_UP_OPEN_KEY) === "1") detailsRef.current.open = true;');
    expect(c).not.toMatch(/setOpen|open=\{/);
    const p = read("src/app/admin/settings/banking/page.tsx");
    expect(p).toContain("<VendorFollowUpSection rows={followUp} optedOutCount={optedOutCount} />");
    expect(p).not.toContain("{followUp.map(");
  });
});

// =========================================================================
describe("S11 docs", () => {
  it("TEST-PLAN has T-368..T-371, the manual lists them, the roadmap has the S11 row; MIGRATIONS_TO_RUN has 0278", () => {
    const tp = read("docs/audit/TEST-PLAN.md");
    const man = read("docs/audit/test-manual/index.html");
    for (const t of ["T-368", "T-369", "T-370", "T-371"]) {
      expect(tp).toContain(`- **${t} (`);
      expect(man).toContain(`data-test="${t}"`);
      expect(man).toContain(`"${t}": "part-b--the-results-log"`);
    }
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(r).toContain("| #1384 | 0277 |");
    expect(r).toContain("| S11 | Sanctions screening");
    expect(r).toContain("## S11 in detail");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("## R41 \u2014 0278 \u2014 OFAC sanctions screening of payees");
  });
});

describe("S11 mutation runs (test the tests)", () => {
  const pin = (scriptPath: string, logPath: string, floor: number) => {
    const script = read(scriptPath);
    const log = read(logPath);
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const mm = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(mm, "clean summary line").not.toBeNull();
    expect(Number(mm![1])).toBe(listed);
    expect(Number(mm![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(floor);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR|control .* FAIL/);
  };
  it("scripts/r41/mutate-s11-app.last.log: every app mutant killed, controls pass", () => {
    pin("scripts/r41/mutate-s11-app.py", "scripts/r41/mutate-s11-app.last.log", 24);
  });
  it("scripts/r41/mutate-0278-sql.last.log: every SQL mutant killed, controls pass, Supabase default privileges simulated and removed", () => {
    pin("scripts/r41/mutate-0278-sql.py", "scripts/r41/mutate-0278-sql.last.log", 15);
    const log = read("scripts/r41/mutate-0278-sql.last.log");
    expect(log).toContain("supabase default privileges simulated");
    expect(log).toContain("supabase default privileges removed");
    expect(read("scripts/r41/mutate-0278-sql.py")).toContain("https://supabase.com/docs/guides/api/securing-your-api");
  });
});
