/**
 * R39 S7 part 2 — ach-ops-store behaviour, run for real:
 *   - the REAL store over the REAL @supabase/postgrest-js client against
 *     FakePostgrest; every 0263 RPC is captured at the HTTP layer with the
 *     exact arguments the database would receive;
 *   - real AES-GCM (encryptSecret / decryptSecret) for the NOC corrected data
 *     and the account numbers that go into the check file;
 *   - the real NACHA builder (the file is parsed back to prove what is in it);
 *   - owner emails captured from an injected mailer.
 * What must never happen is asserted too: no RPC when the form is wrong, no
 * full bank number in any RPC argument, email or plain column, no mark_sent
 * when the list changed after download.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

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

const store = await import("@/lib/payments/ach-ops-store");
const { encryptSecret, decryptSecret } = await import("@/lib/security/at-rest-crypto");

const KEY = "ops-behaviour-key-0123456789abcdef!!";
const TODAY = "2026-10-05"; // a Monday
const EFFECTIVE = "2026-10-08"; // R41 S5: 2 banking days after a Mon 10:00 Pacific release
const NOW = new Date("2026-10-05T17:00:00Z");
const STEPHEN = "11111111-1111-4111-8111-111111111111";
const MICHAEL = "22222222-2222-4222-8222-222222222222";
const EMP1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMP2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const VEND = "9b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const AUTH1 = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const AUTH2 = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
const AUTHV = "a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3";
const ACC1 = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
const ACC2 = "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2";
const VER1 = "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1";
const VER2 = "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2";
const NID = "f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0";
const R1 = "021000021";
const A1 = "0012345678";
const R2 = "011000015";
const A2 = "99990000";
const NOC_ACCT = "5550001234";
const HMAC1 = "a".repeat(64);
const HMAC2 = "b".repeat(64);
const SECRETS = [A1, A2, NOC_ACCT];

type Mail = { to: readonly string[]; subject: string; html: string };
let mails: Mail[] = [];
let mailFails = false;
const mailer: import("@/lib/payments/ach-ops-store").OpsMailer = async (to, m) => {
  mails.push({ to, ...m });
  return mailFails ? { ok: false, detail: "provider 500" } : { ok: true };
};
const ENV = { ACH_NOTIFY_STEPHEN_PHONE: "(360) 555-0101", ACH_NOTIFY_MICHAEL_PHONE: "" };

const auth = (over: Record<string, unknown>) => ({
  payee_type: "employee", vendor_id: null, hold_reason: null, hold_entered_by: null, hold_entered_at: null,
  legal_hold: false, legal_hold_reason: null, annual_review_due_on: null, signed_on: "2026-09-01", ended_on: null, ...over,
});

function seed() {
  st.db.tables.set("employees", [
    { id: EMP1, full_name: "Pat Worker" },
    { id: EMP2, full_name: "Sam Helper" },
  ]);
  st.db.tables.set("vendors", [{ id: VEND, display_name: "Acme Farms" }]);
  st.db.tables.set("ach_authorizations", [
    auth({ id: AUTH1, employee_id: EMP1, payee_name: "Pat Worker", state: "verifying" }),
    auth({ id: AUTH2, employee_id: EMP2, payee_name: "Sam Helper", state: "on_hold", hold_reason: "ACH return R03 received", hold_entered_by: STEPHEN }),
    auth({ id: AUTHV, payee_type: "vendor", employee_id: null, vendor_id: VEND, payee_name: "Acme Farms", state: "active", annual_review_due_on: "2026-10-20" }),
  ]);
  st.db.tables.set("ach_authorization_accounts", [
    { id: ACC1, authorization_id: AUTH1, account_last4: "5678", account_type: "checking", verification_status: "pending", account_key_hmac: HMAC1, archived_at: null, routing_enc: encryptSecret(R1), account_enc: encryptSecret(A1) },
    { id: ACC2, authorization_id: AUTH2, account_last4: "0000", account_type: "savings", verification_status: "pending", account_key_hmac: HMAC2, archived_at: null, routing_enc: encryptSecret(R2), account_enc: encryptSecret(A2) },
  ]);
  st.db.tables.set("ach_verifications", [
    { id: VER1, account_id: ACC1, method: "prenote", status: "planned", micro_amount_cents: null, effective_date: null, settlement_date: null, eligible_on: null, result_code: null, created_at: "2026-10-04T18:00:00Z" },
  ]);
  st.db.tables.set("ach_return_notices", []);
  st.db.tables.set("ach_company_settings", [
    // R41 S2: the Timberland shape (Brenda answers 1-3); EIN is a test value.
    { id: true, destination_routing: "325170754", destination_name: "TIMBERLAND BANK", immediate_origin: "1911234567", company_name: "GREENWAY MARIJUANA", company_id: "1911234567", originating_dfi: "32517075", entry_description: "PAYROLL", company_account_number: "", company_account_type: "checking" },
  ]);
  st.db.tables.set("company_profile", [{ id: true, ein: "911234567" }]);
  // R41 S3: the released-file ledger (0273) with its unique rules.
  st.db.tables.set("ach_files", []);
  st.db.defaults.set("ach_files", () => ({ status: "released", released_at: NOW.toISOString(), voided_by: null, voided_at: null, voided_reason: null }));
  const live = (r: Record<string, unknown>) => r.status !== "voided";
  st.db.uniques.push(
    { table: "ach_files", columns: ["file_date", "file_id_modifier"], name: "ach_files_day_modifier_key" },
    { table: "ach_files", columns: ["sha256"], where: live, name: "ach_files_sha_live" },
    { table: "ach_files", columns: ["entry_set_hmac", "effective_date"], where: live, name: "ach_files_no_duplicate_entries" },
    { table: "ach_files", columns: ["kind", "source_id"], where: live, name: "ach_files_one_live_per_source" },
  );
}
/** R41 S3: release the prenote list the page shows (owner), as the operations page does. */
async function releasePrenote(fp: string) {
  const r = await store.releaseCheckFile({ method: "prenote", effective: EFFECTIVE, fingerprint: fp, actorId: STEPHEN, todayIso: TODAY, now: NOW });
  if (!r.ok) throw new Error(r.error);
  return r;
}

function everythingWritten(): string {
  return JSON.stringify({ rpc: st.rpc, mails, plain: [...st.db.tables.entries()].map(([t, rows]) => [t, rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.endsWith("_enc"))))]) });
}
const rpcs = (fn: string) => st.rpc.filter((r) => r.fn === fn);
const form = (o: Record<string, string>) => (k: string) => o[k] ?? "";

beforeEach(() => {
  process.env.DATA_ENCRYPTION_KEY = KEY;
  st.db = new FakePostgrest();
  st.rpc = [];
  st.rpcReply = null;
  mails = [];
  mailFails = false;
  seed();
  st.db.before = (req) => {
    if (!req.url.pathname.includes("/rpc/")) return;
    const fn = req.url.pathname.split("/").pop()!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    st.rpc.push({ fn, body });
    if (st.rpcReply) return st.rpcReply(fn, body);
    return { status: 500, body: { message: `no reply set for ${fn}` } };
  };
});

const reply = (map: Record<string, unknown>) => {
  st.rpcReply = (fn) => (fn in map ? { status: 200, body: map[fn] } : { status: 500, body: { message: `unexpected ${fn}` } });
};
const refuse = (fn: string, message: string, code = "23514") => {
  st.rpcReply = (f) => (f === fn ? { status: 400, body: { code, message } } : { status: 500, body: { message: `unexpected ${f}` } });
};

// =========================================================================
describe("logNotice", () => {
  const base = { actorId: STEPHEN, actorLabel: "Stephen", todayIso: TODAY, bankingUrl: "https://www.greenwaymarijuana.com/admin/settings/banking?tab=operations", mail: mailer, env: ENV };

  it("an employee return: one RPC with the parsed facts, the hold reason, and Stephen, Michael and the store emailed", async () => {
    reply({ ach_notice_log: { notice_id: NID, hold: "authorization", authorization_id: AUTH1 } });
    const r = await store.logNotice({ ...base, get: form({ payee: `employee:${EMP1}`, code: "r03", received_on: "2026-10-02", settlement_date: "2026-10-01", amount: "1,234.56", trace: "325170830000001" }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.noticeId).toBe(NID);
    expect(r.hold).toBe("authorization");
    const calls = rpcs("ach_notice_log");
    expect(calls).toHaveLength(1);
    const b = calls[0].body;
    expect(b).toMatchObject({
      p_actor: STEPHEN, p_payee_type: "employee", p_payee_id: EMP1, p_code: "R03", p_received_on: "2026-10-02", p_settlement_date: "2026-10-01",
      p_amount_cents: 123456, p_trace: "325170830000001", p_corrected_enc: null, p_corrected_last4: null, p_apply_by: null, p_verification_id: null,
    });
    expect(String(b.p_hold_reason)).toMatch(/^ACH return R03 .*received 2026-10-02/);
    expect(String(b.p_hold_reason).length).toBeGreaterThanOrEqual(10);
    expect(mails).toHaveLength(1);
    expect([...mails[0].to].sort()).toEqual(["contact@greenwaymarijuana.com", "michael@greenwaymarijuana.com", "stephen@greenwaymarijuana.com"]);
    expect(mails[0].subject).toBe("ACH returned payment R03 for Pat Worker - on hold");
    expect(mails[0].html).toContain("employee&#39;s ACH authorization was put ON HOLD");
    expect(r.owner).toEqual({ emailed: true, detail: "emailed 3", call: ["Stephen at 360-555-0101", "Greenway store at 360-443-6988"], missingPhones: ["Michael"] });
  });

  it("a NOC: the corrected number is encrypted before it leaves, only last-4 travels in clear, and it decrypts back exactly", async () => {
    reply({ ach_notice_log: { notice_id: NID, hold: "vault", authorization_id: AUTHV } });
    const r = await store.logNotice({ ...base, get: form({ payee: `vendor:${VEND}`, code: "C01", received_on: "2026-10-02", corrected: NOC_ACCT }) });
    expect(r.ok).toBe(true);
    const b = rpcs("ach_notice_log")[0].body;
    expect(String(b.p_corrected_enc)).toMatch(/^encv1:/);
    expect(decryptSecret(String(b.p_corrected_enc))).toBe(NOC_ACCT);
    expect(b.p_corrected_last4).toBe("1234");
    expect(b.p_apply_by).toMatch(/^2026-10-\d\d$/);
    expect(mails[0].subject).toBe("ACH bank correction (NOC) C01 for Acme Farms - on hold");
    expect(mails[0].html).toContain("vendor banking was put ON HOLD");
    for (const s of SECRETS) expect(everythingWritten()).not.toContain(s);
  });

  it("no hold applied says ACTION NEEDED; already on hold says so", async () => {
    reply({ ach_notice_log: { notice_id: NID, hold: "none", authorization_id: null } });
    await store.logNotice({ ...base, get: form({ payee: `employee:${EMP1}`, code: "R01", received_on: "2026-10-02" }) });
    expect(mails[0].subject).toMatch(/ACTION NEEDED$/);
    expect(mails[0].html).toContain("NOT on hold");
    reply({ ach_notice_log: { notice_id: NID, hold: "already_on_hold", authorization_id: AUTH2 } });
    await store.logNotice({ ...base, get: form({ payee: `employee:${EMP2}`, code: "R01", received_on: "2026-10-02" }) });
    expect(mails[1].subject).toMatch(/- on hold$/);
    expect(mails[1].html).toContain("it was already on hold");
  });

  it("the answer to a sent check passes p_verification_id; a malformed one is refused before any RPC", async () => {
    reply({ ach_notice_log: { notice_id: NID, hold: "authorization", authorization_id: AUTH1 } });
    await store.logNotice({ ...base, get: form({ payee: `employee:${EMP1}`, code: "R03", received_on: "2026-10-02", verification: VER1 }) });
    expect(rpcs("ach_notice_log")[0].body.p_verification_id).toBe(VER1);
    const bad = await store.logNotice({ ...base, get: form({ payee: `employee:${EMP1}`, code: "R03", received_on: "2026-10-02", verification: "nope" }) });
    expect(bad).toEqual({ ok: false, error: "That account check is not valid. Reload the page." });
    expect(rpcs("ach_notice_log")).toHaveLength(1);
  });

  it("a wrong form never reaches the database and every problem is listed", async () => {
    const r = await store.logNotice({ ...base, get: form({ payee: "", code: "X9", received_on: "2026-12-01" }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Pick who the payment was for.");
    expect(r.error).toContain("R or C and two digits");
    expect(r.error).toContain("cannot be in the future");
    expect(st.rpc).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it("without DATA_ENCRYPTION_KEY a NOC is refused (no plaintext number is ever sent)", async () => {
    delete process.env.DATA_ENCRYPTION_KEY;
    const r = await store.logNotice({ ...base, get: form({ payee: `vendor:${VEND}`, code: "C01", received_on: "2026-10-02", corrected: NOC_ACCT }) });
    expect(r).toEqual({ ok: false, error: store.OPS_NO_KEY });
    expect(st.rpc).toHaveLength(0);
  });

  it("database refusals come back in words; a missing 0263 says to apply it", async () => {
    refuse("ach_notice_log", "ACH_NOTICE_PAYEE: employee x not found.");
    const r = await store.logNotice({ ...base, get: form({ payee: `employee:${EMP1}`, code: "R03", received_on: "2026-10-02" }) });
    expect(r).toEqual({ ok: false, error: "Pick the employee or vendor the payment was for." });
    refuse("ach_notice_log", "Could not find the function public.ach_notice_log(p_actor, ...) in the schema cache", "PGRST202");
    const m = await store.logNotice({ ...base, get: form({ payee: `employee:${EMP1}`, code: "R03", received_on: "2026-10-02" }) });
    expect(m.ok === false && m.error).toMatch(/^One-time setup needed: apply migration 0263/);
    expect(mails).toHaveLength(0);
  });

  it("an unconfirmed reply is an error (never claims a notice was logged)", async () => {
    reply({ ach_notice_log: {} });
    const r = await store.logNotice({ ...base, get: form({ payee: `employee:${EMP1}`, code: "R03", received_on: "2026-10-02" }) });
    expect(r.ok === false && r.error).toMatch(/did not confirm the notice/);
    expect(mails).toHaveLength(0);
  });

  it("a failed email does not undo the log; the screen is told and still lists who to call", async () => {
    mailFails = true;
    reply({ ach_notice_log: { notice_id: NID, hold: "authorization", authorization_id: AUTH1 } });
    const r = await store.logNotice({ ...base, get: form({ payee: `employee:${EMP1}`, code: "R03", received_on: "2026-10-02" }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.owner.emailed).toBe(false);
    expect(r.owner.detail).toBe("provider 500");
    expect(r.owner.call).toContain("Greenway store at 360-443-6988");
  });

  it("a mailer that throws is reported, not raised", async () => {
    reply({ ach_notice_log: { notice_id: NID, hold: "authorization", authorization_id: AUTH1 } });
    const r = await store.logNotice({ ...base, mail: async () => { throw new Error("socket hang up"); }, get: form({ payee: `employee:${EMP1}`, code: "R03", received_on: "2026-10-02" }) });
    expect(r.ok && r.owner).toMatchObject({ emailed: false, detail: "socket hang up" });
  });
});

// =========================================================================
describe("resolveNotice", () => {
  it("a short note is refused without an RPC; a good one is trimmed and sent once", async () => {
    const s = await store.resolveNotice({ noticeId: NID, actorId: MICHAEL, note: "done" });
    expect(s.ok).toBe(false);
    expect(st.rpc).toHaveLength(0);
    reply({ ach_notice_resolve: null });
    const r = await store.resolveNotice({ noticeId: NID, actorId: MICHAEL, note: "  Called Pat on file number;   new account added  " });
    expect(r).toEqual({ ok: true, note: "Called Pat on file number; new account added" });
    expect(rpcs("ach_notice_resolve")[0].body).toEqual({ p_notice_id: NID, p_actor: MICHAEL, p_note: "Called Pat on file number; new account added" });
  });
  it("a bad id is refused; FINAL comes back in words", async () => {
    expect(await store.resolveNotice({ noticeId: "x", actorId: MICHAEL, note: "long enough note" })).toEqual({ ok: false, error: "That notice is not valid. Reload the page." });
    refuse("ach_notice_resolve", "ACH_NOTICE_FINAL: notice is already resolved.");
    expect(await store.resolveNotice({ noticeId: NID, actorId: MICHAEL, note: "long enough note" })).toEqual({ ok: false, error: "That notice is already resolved." });
  });
});

// =========================================================================
describe("releaseEmployeeHold", () => {
  // R41 S0 (D-6 option B): only the owner releases, alone, with no written
  // reason. The store sends nothing itself: the achGate wrapper emails the
  // owner a "Was this you?" receipt after the action succeeds (D-8).
  const base = { authId: AUTH2, actorIsOwner: true, method: "phone", note: "Called Sam on file number, confirmed", reason: "" };

  it("OWNER: releases alone; no reason needed; the RPC gets a null reason; nobody emailed by the store", async () => {
    reply({ ach_auth_release_hold: "owner" });
    const r = await store.releaseEmployeeHold({ ...base, actorId: MICHAEL });
    expect(r.ok && r.mode).toBe("owner");
    expect(rpcs("ach_auth_release_hold")[0].body).toEqual({ p_auth_id: AUTH2, p_actor: MICHAEL, p_method: "phone", p_note: "Called Sam on file number, confirmed", p_reason: null });
    expect(mails).toHaveLength(0);
    // The audit's "before" is the row as it was (on hold), not after.
    expect(r.ok && r.before.state).toBe("on_hold");
  });

  it("OWNER, confirmed in person: the method chosen is the method sent", async () => {
    reply({ ach_auth_release_hold: "owner" });
    const r = await store.releaseEmployeeHold({ ...base, actorId: MICHAEL, method: "in_person" });
    expect(r.ok).toBe(true);
    expect(rpcs("ach_auth_release_hold")[0].body.p_method).toBe("in_person");
  });

  it("OWNER on his OWN hold: still released alone (the 20-character solo reason is gone); an optional reason is passed through", async () => {
    st.db.tables.get("ach_authorizations")!.find((a) => a.id === AUTH2)!.hold_entered_by = MICHAEL;
    reply({ ach_auth_release_hold: "owner" });
    const r = await store.releaseEmployeeHold({ ...base, actorId: MICHAEL, reason: "ok" });
    expect(r.ok).toBe(true);
    expect(rpcs("ach_auth_release_hold")[0].body.p_reason).toBe("ok");
  });

  it("NOT the owner (Stephen, admin): refused before any RPC, even with a long reason", async () => {
    const r = await store.releaseEmployeeHold({ ...base, actorId: STEPHEN, actorIsOwner: false, reason: "Michael is away for two weeks; payroll Friday" });
    expect(r).toEqual({ ok: false, error: "Only Michael (the owner) releases an employee banking hold. Stephen's release goes to Michael for approval." });
    expect(st.rpc).toHaveLength(0);
  });

  it("a vendor authorization, or one not on hold, is refused before the RPC", async () => {
    expect(await store.releaseEmployeeHold({ ...base, actorId: MICHAEL, authId: AUTHV })).toEqual({ ok: false, error: "Vendor holds are released on the Vault tab (with the callback)." });
    expect(await store.releaseEmployeeHold({ ...base, actorId: MICHAEL, authId: AUTH1 })).toEqual({ ok: false, error: "It is not on hold any more. Reload the page." });
    expect(await store.releaseEmployeeHold({ ...base, actorId: MICHAEL, authId: "c0ffee" })).toEqual({ ok: false, error: "That authorization is not valid. Reload the page." });
    expect(await store.releaseEmployeeHold({ ...base, actorId: MICHAEL, authId: NID })).toEqual({ ok: false, error: "That authorization no longer exists. Reload the page." });
    expect(st.rpc).toHaveLength(0);
  });

  it("a reply other than 'owner' (including the retired 'solo' and 'dual') is not success", async () => {
    for (const bad of ["ok", "solo", "dual", null]) {
      reply({ ach_auth_release_hold: bad });
      const r = await store.releaseEmployeeHold({ ...base, actorId: MICHAEL });
      expect(r, String(bad)).toEqual({ ok: false, error: "The database did not confirm the release. Reload the page." });
    }
  });

  it("the database's ACH_OWNER_ONLY refusal comes back in words, not raised", async () => {
    refuse("ach_auth_release_hold", "ACH_OWNER_ONLY: only the owner releases an employee banking hold. Send it as a request for owner approval.");
    const r = await store.releaseEmployeeHold({ ...base, actorId: MICHAEL });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/owner/i);
  });
});

// =========================================================================
describe("startCheck / finishCheck", () => {
  it("a test credit draws its amount from the random source (1..99); a prenote and a callback carry none", async () => {
    reply({ ach_verification_start: VER2 });
    const m = await store.startCheck({ accountId: ACC2, actorId: MICHAEL, method: "micro_entry", randomBelow: () => 36 });
    expect(m).toEqual({ ok: true, verificationId: VER2, method: "micro_entry" });
    expect(rpcs("ach_verification_start")[0].body).toEqual({ p_account_id: ACC2, p_actor: MICHAEL, p_method: "micro_entry", p_micro_cents: 37 });
    await store.startCheck({ accountId: ACC2, actorId: MICHAEL, method: "prenote", randomBelow: () => 36 });
    await store.startCheck({ accountId: ACC2, actorId: MICHAEL, method: "voided_check_callback" });
    expect(rpcs("ach_verification_start").map((c) => c.body.p_micro_cents)).toEqual([37, null, null]);
  });

  it("the default random source is crypto (always 1..99 over many draws)", async () => {
    reply({ ach_verification_start: VER2 });
    for (let i = 0; i < 200; i += 1) await store.startCheck({ accountId: ACC2, actorId: MICHAEL, method: "micro_entry" });
    const cents = rpcs("ach_verification_start").map((c) => Number(c.body.p_micro_cents));
    expect(cents.every((c) => Number.isInteger(c) && c >= 1 && c <= 99)).toBe(true);
    expect(new Set(cents).size).toBeGreaterThan(20);
  });

  it("bad method / account id refused before the RPC; one-open-check refusal in words; non-uuid reply is an error", async () => {
    expect(await store.startCheck({ accountId: ACC2, actorId: MICHAEL, method: "guess" })).toEqual({ ok: false, error: "Choose prenote, test credit or voided-check callback." });
    expect((await store.startCheck({ accountId: "x", actorId: MICHAEL, method: "prenote" })).ok).toBe(false);
    expect(st.rpc).toHaveLength(0);
    refuse("ach_verification_start", 'duplicate key value violates unique constraint "ach_ver_one_open_per_account"', "23505");
    expect(await store.startCheck({ accountId: ACC2, actorId: MICHAEL, method: "prenote" })).toEqual({ ok: false, error: "That account already has a check in progress. Finish or cancel it first." });
    reply({ ach_verification_start: "ok" });
    expect((await store.startCheck({ accountId: ACC2, actorId: MICHAEL, method: "prenote" })).ok).toBe(false);
  });

  it("finish a test credit: the typed amount reaches the database as cents", async () => {
    st.db.tables.get("ach_verifications")!.push({ id: VER2, account_id: ACC2, method: "micro_entry", status: "sent", micro_amount_cents: 37 });
    reply({ ach_verification_finish: "active" });
    const r = await store.finishCheck({ verificationId: VER2, actorId: MICHAEL, outcome: "passed", confirmed: "$.37", note: "" });
    expect(r).toEqual({ ok: true, state: "active", outcome: "passed", method: "micro_entry" });
    expect(rpcs("ach_verification_finish")[0].body).toEqual({ p_id: VER2, p_actor: MICHAEL, p_outcome: "passed", p_confirmed_cents: 37, p_note: null });
  });

  it("finish refuses before the RPC: no amount, a finished check, a missing check; wrong amount comes back in words", async () => {
    st.db.tables.get("ach_verifications")!.push({ id: VER2, account_id: ACC2, method: "micro_entry", status: "sent", micro_amount_cents: 37 });
    expect((await store.finishCheck({ verificationId: VER2, actorId: MICHAEL, outcome: "passed", confirmed: "", note: "" })).ok).toBe(false);
    st.db.tables.get("ach_verifications")!.find((v) => v.id === VER1)!.status = "passed";
    expect(await store.finishCheck({ verificationId: VER1, actorId: MICHAEL, outcome: "passed", confirmed: "", note: "" })).toEqual({ ok: false, error: "That check is already finished." });
    expect(await store.finishCheck({ verificationId: NID, actorId: MICHAEL, outcome: "passed", confirmed: "", note: "" })).toEqual({ ok: false, error: "That check no longer exists. Reload the page." });
    expect(st.rpc).toHaveLength(0);
    refuse("ach_verification_finish", "ACH_VERIFICATION_AMOUNT: confirmed 36 does not match.");
    expect(await store.finishCheck({ verificationId: VER2, actorId: MICHAEL, outcome: "passed", confirmed: "0.36", note: "" })).toEqual({ ok: false, error: "That is not the amount that was sent. Ask the person to look again; do not guess." });
  });
});

// =========================================================================
describe("check file: build (GET, records nothing) and confirm sent", () => {
  it("builds a prenote file from the decrypted accounts; nothing is recorded", async () => {
    const r = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(st.rpc).toHaveLength(0);
    expect(r.plan.ids).toEqual([VER1]);
    expect(r.plan.filename).toBe("acctcheck_prenote_2026-10-08_1.ach");
    expect(r.plan.totalCents).toBe(0);
    const lines = r.plan.file.split(/\r?\n/).filter(Boolean);
    expect(lines[0].charAt(33)).toBe("A"); // R41 S3: the modifier given, never a fixed P/M
    expect(st.db.rows("ach_files")).toHaveLength(0);
    const entries = lines.filter((l) => l.startsWith("6"));
    expect(entries).toHaveLength(1);
    expect(entries[0].slice(1, 3)).toBe("23"); // checking prenote credit
    expect(entries[0].slice(3, 12)).toBe(R1);
    expect(entries[0].slice(12, 29).trim()).toBe(A1);
    expect(entries[0].slice(29, 39)).toBe("0000000000");
    expect(r.fingerprint).toBe(store.checkListFingerprint([VER1]));
    expect(r.skipped).toEqual([]);
  });

  it("a check whose authorization went on hold is left out and named, not built", async () => {
    st.db.tables.get("ach_verifications")!.push({ id: VER2, account_id: ACC2, method: "prenote", status: "planned", micro_amount_cents: null });
    const r = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    expect(r.ok && r.plan.ids).toEqual([VER1]);
    expect(r.ok && r.skipped).toEqual(["Sam Helper: the authorization is on hold (release the hold or cancel the check)"]);
    st.db.tables.get("ach_verifications")!.splice(0, 1);
    const only = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    expect(only.ok === false && only.error).toMatch(/No prenotes are waiting.*Left out: Sam Helper/);
  });

  it("an archived account is left out and named", async () => {
    st.db.tables.get("ach_authorization_accounts")!.find((a) => a.id === ACC1)!.archived_at = "2026-10-04T00:00:00Z";
    const r = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    expect(r.ok === false && r.error).toMatch(/Left out: Pat Worker: the account was archived/);
  });

  it("company settings incomplete: refused with the missing fields named", async () => {
    st.db.tables.get("ach_company_settings")![0].company_id = "";
    st.db.tables.get("ach_company_settings")![0].originating_dfi = " ";
    const r = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    // R41 S2: refused through the one readiness check, each problem named.
    expect(r.ok).toBe(false);
    const e = r.ok === false ? r.error : "";
    expect(e).toMatch(/^The company ACH settings do not match Timberland's setup \(My banking tab\): /);
    expect(e).toMatch(/Company ID/i);
    expect(e).toMatch(/Originating DFI/);
  });

  it("without the key the accounts cannot be read: refused", async () => {
    delete process.env.DATA_ENCRYPTION_KEY;
    const r = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    expect(r).toEqual({ ok: false, error: store.OPS_NO_KEY });
  });

  it("a weekend effective date is refused by the core", async () => {
    const r = await store.buildCheckFile({ method: "prenote", effective: "2026-10-10", todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    expect(r.ok).toBe(false);
  });

  it("confirm sent: one mark_sent with exactly the file's ids and dates", async () => {
    const b = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    if (!b.ok) throw new Error(b.error);
    await releasePrenote(b.fingerprint);
    reply({ ach_verification_mark_sent: 1 });
    const r = await store.markCheckFileSent({ method: "prenote", effective: EFFECTIVE, fingerprint: b.fingerprint, actorId: MICHAEL, todayIso: TODAY, now: NOW });
    expect(r.ok && r.count).toBe(1);
    expect(rpcs("ach_verification_mark_sent")[0].body).toEqual({
      p_ids: [VER1], p_actor: MICHAEL, p_effective: EFFECTIVE, p_settlement: EFFECTIVE, p_eligible: b.plan.eligible, p_filename: "acctcheck_prenote_2026-10-08_1.ach",
    });
    expect(b.plan.eligible > EFFECTIVE).toBe(true);
  });

  it("a check already sent is never put in a file again (only planned ones are read)", async () => {
    st.db.tables.get("ach_verifications")!.push({ id: VER2, account_id: ACC1, method: "prenote", status: "sent", micro_amount_cents: null });
    const r = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    expect(r.ok && r.plan.ids).toEqual([VER1]);
  });

  it("confirm sent with two checks: both ids reach mark_sent, sorted, and the count must match", async () => {
    st.db.tables.get("ach_authorizations")!.find((a) => a.id === AUTH2)!.state = "verifying";
    st.db.tables.get("ach_verifications")!.push({ id: VER2, account_id: ACC2, method: "prenote", status: "planned", micro_amount_cents: null });
    const b = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    if (!b.ok) throw new Error(b.error);
    expect(b.plan.ids).toEqual([VER1, VER2]);
    expect(b.plan.filename).toBe("acctcheck_prenote_2026-10-08_2.ach");
    await releasePrenote(b.fingerprint);
    reply({ ach_verification_mark_sent: 2 });
    const r = await store.markCheckFileSent({ method: "prenote", effective: EFFECTIVE, fingerprint: b.fingerprint, actorId: MICHAEL, todayIso: TODAY, now: NOW });
    expect(r.ok && r.count).toBe(2);
    expect(rpcs("ach_verification_mark_sent")[0].body.p_ids).toEqual([VER1, VER2]);
  });

  it("the list changed after download (a new check planned): refused, nothing marked", async () => {
    const b = await store.buildCheckFile({ method: "prenote", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    if (!b.ok) throw new Error(b.error);
    await releasePrenote(b.fingerprint);
    st.db.tables.get("ach_authorizations")!.find((a) => a.id === AUTH2)!.state = "verifying";
    st.db.tables.get("ach_verifications")!.push({ id: VER2, account_id: ACC2, method: "prenote", status: "planned", micro_amount_cents: null });
    const r = await store.markCheckFileSent({ method: "prenote", effective: EFFECTIVE, fingerprint: b.fingerprint, actorId: MICHAEL, todayIso: TODAY, now: NOW });
    expect(r).toEqual({ ok: false, error: "The list of checks changed since this page loaded. Reload the page and download again." });
    expect(st.rpc).toHaveLength(0);
  });

  it("no fingerprint = not downloaded: refused; a count mismatch from the database is not success", async () => {
    expect((await store.markCheckFileSent({ method: "prenote", effective: EFFECTIVE, fingerprint: "", actorId: MICHAEL, todayIso: TODAY, now: NOW })).ok).toBe(false);
    expect(st.rpc).toHaveLength(0);
    await releasePrenote(store.checkListFingerprint([VER1]));
    reply({ ach_verification_mark_sent: 0 });
    const r = await store.markCheckFileSent({ method: "prenote", effective: EFFECTIVE, fingerprint: store.checkListFingerprint([VER1]), actorId: MICHAEL, todayIso: TODAY, now: NOW });
    expect(r.ok === false && r.error).toMatch(/different number of checks/);
  });

  it("a test-credit file carries each planned amount and the ACCTVERIFY description", async () => {
    st.db.tables.get("ach_verifications")!.push({ id: VER2, account_id: ACC1, method: "micro_entry", status: "planned", micro_amount_cents: 42 });
    const r = await store.buildCheckFile({ method: "micro_entry", effective: EFFECTIVE, todayIso: TODAY, now: NOW, fileIdModifier: "A" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.ids).toEqual([VER2]);
    expect(r.plan.totalCents).toBe(42);
    expect(r.plan.file).toContain("ACCTVERIFY");
    const e = r.plan.file.split(/\r?\n/).find((l) => l.startsWith("6"))!;
    expect(e.slice(1, 3)).toBe("22");
    expect(Number(e.slice(29, 39))).toBe(42);
  });

  it("R41 S3: confirm sent before the file was released is refused; nothing is marked", async () => {
    reply({ ach_verification_mark_sent: 1 });
    const r = await store.markCheckFileSent({ method: "prenote", effective: EFFECTIVE, fingerprint: store.checkListFingerprint([VER1]), actorId: MICHAEL, todayIso: TODAY, now: NOW });
    expect(r.ok === false && r.error).toMatch(/has not been released yet/);
    expect(st.rpc).toHaveLength(0);
  });

  it("R41 S3: a release writes ONE encrypted ach_files row (no plain account number), the day's letter, the list's source id", async () => {
    const fp = store.checkListFingerprint([VER1]);
    const r = await releasePrenote(fp);
    const rows = st.db.rows("ach_files");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "prenote", source_id: store.checkFileSourceId("prenote", EFFECTIVE, fp), file_date: "2026-10-05", file_id_modifier: "A", filename: "acctcheck_prenote_2026-10-08_1.ach", entry_count: 1, total_cents: 0, counts_toward_limit: false, released_by: STEPHEN });
    expect(String(rows[0].body_enc)).toMatch(/^encv1:/);
    expect(decryptSecret(String(rows[0].body_enc))).toBe(r.plan.file);
    expect(r.plan.file).toContain("\r\n");
    expect(everythingWritten()).not.toContain(A1);
    expect(st.rpc).toHaveLength(0);
  });

  it("R41 S3: confirm sent sends the RELEASED file's name, and the released letter is the one rebuilt", async () => {
    // Every NOT NULL column the S4 limit read uses (0273); a row missing them makes the limit check refuse (fail closed).
    st.db.rows("ach_files").push({ id: "x", kind: "vendor", source_id: "other", file_date: "2026-10-05", file_id_modifier: "A", status: "released", effective_date: "2026-10-06", settlement_date: null, total_cents: 12345 });
    const fp = store.checkListFingerprint([VER1]);
    const r = await releasePrenote(fp);
    expect(r.modifier).toBe("B");
    expect(r.plan.file.split("\r\n")[0].charAt(33)).toBe("B");
    reply({ ach_verification_mark_sent: 1 });
    const m = await store.markCheckFileSent({ method: "prenote", effective: EFFECTIVE, fingerprint: fp, actorId: MICHAEL, todayIso: TODAY, now: NOW });
    expect(m.ok && m.plan.filename).toBe("acctcheck_prenote_2026-10-08_1.ach");
    // The confirm-time rebuild carries the released letter (the header clock is the confirm time; the bytes uploaded are the stored ones).
    expect(m.ok && m.plan.file.split(/\r?\n/)[0].charAt(33)).toBe("B");
    expect(m.ok && m.plan.ids).toEqual([VER1]);
  });

  it("R41 S3: the same list released twice is refused; a voided release is not live and cannot be confirmed", async () => {
    const fp = store.checkListFingerprint([VER1]);
    await releasePrenote(fp);
    const again = await store.releaseCheckFile({ method: "prenote", effective: EFFECTIVE, fingerprint: fp, actorId: STEPHEN, todayIso: TODAY, now: NOW });
    expect(again.ok).toBe(false);
    expect(st.db.rows("ach_files")).toHaveLength(1);
    st.db.rows("ach_files")[0].status = "voided";
    reply({ ach_verification_mark_sent: 1 });
    const m = await store.markCheckFileSent({ method: "prenote", effective: EFFECTIVE, fingerprint: fp, actorId: MICHAEL, todayIso: TODAY, now: NOW });
    expect(m.ok === false && m.error).toMatch(/voided/);
    expect(st.rpc).toHaveLength(0);
  });

  it("R41 S3: release refuses a stale or malformed fingerprint and a missing key; nothing is written", async () => {
    const bad = await store.releaseCheckFile({ method: "prenote", effective: EFFECTIVE, fingerprint: store.checkListFingerprint([VER1, VER2]), actorId: STEPHEN, todayIso: TODAY, now: NOW });
    expect(bad.ok === false && bad.error).toMatch(/changed since this page loaded/);
    expect(await store.releaseCheckFile({ method: "prenote", effective: EFFECTIVE, fingerprint: "nope", actorId: STEPHEN, todayIso: TODAY, now: NOW })).toEqual({ ok: false, error: "Reload the Operations page and use its release button." });
    delete process.env.DATA_ENCRYPTION_KEY;
    expect((await store.releaseCheckFile({ method: "prenote", effective: EFFECTIVE, fingerprint: store.checkListFingerprint([VER1]), actorId: STEPHEN, todayIso: TODAY, now: NOW })).ok).toBe(false);
    expect(st.db.rows("ach_files")).toHaveLength(0);
  });

  it("fingerprint ignores order and changes with membership", () => {
    expect(store.checkListFingerprint([VER1, VER2])).toBe(store.checkListFingerprint([VER2, VER1]));
    expect(store.checkListFingerprint([VER1])).not.toBe(store.checkListFingerprint([VER1, VER2]));
    expect(store.checkListFingerprint([VER1])).toMatch(/^[0-9a-f]{16}$/);
  });
});

// =========================================================================
describe("legal hold and annual review", () => {
  it("legal hold: reason checked first, then one RPC", async () => {
    expect((await store.setLegalHold({ authId: AUTH1, actorId: MICHAEL, on: true, reason: "short" })).ok).toBe(false);
    expect(st.rpc).toHaveLength(0);
    reply({ ach_auth_set_legal_hold: null });
    const r = await store.setLegalHold({ authId: AUTH1, actorId: MICHAEL, on: true, reason: "Letter from L&I dated 2026-10-01" });
    expect(r.ok).toBe(true);
    expect(rpcs("ach_auth_set_legal_hold")[0].body).toEqual({ p_auth_id: AUTH1, p_actor: MICHAEL, p_on: true, p_reason: "Letter from L&I dated 2026-10-01" });
  });
  it("legal hold off sends p_on false", async () => {
    reply({ ach_auth_set_legal_hold: null });
    const r = await store.setLegalHold({ authId: AUTH1, actorId: MICHAEL, on: false, reason: "Matter closed per letter 2026-10-01" });
    expect(r.ok).toBe(true);
    expect(rpcs("ach_auth_set_legal_hold")[0].body.p_on).toBe(false);
  });
  it("review done returns the next due date; a non-date reply is not success; refusals in words", async () => {
    reply({ ach_auth_review_done: "2027-10-05" });
    expect(await store.markReviewDone({ authId: AUTHV, actorId: STEPHEN, note: "Called on file number; unchanged" })).toMatchObject({ ok: true, nextDue: "2027-10-05" });
    reply({ ach_auth_review_done: null });
    expect((await store.markReviewDone({ authId: AUTHV, actorId: STEPHEN, note: "Called on file number; unchanged" })).ok).toBe(false);
    refuse("ach_auth_review_done", "ACH_REVIEW: only an active authorization is reviewed.");
    expect(await store.markReviewDone({ authId: AUTH1, actorId: STEPHEN, note: "Called on file number; unchanged" })).toEqual({ ok: false, error: "Only an active authorization is reviewed, and the note needs at least 10 characters." });
  });
});

// =========================================================================
describe("opsPageView", () => {
  it("missing tables (0258-0263 not applied) say so and show nothing", async () => {
    st.db.missing.add("ach_return_notices");
    const v = await store.opsPageView(TODAY);
    expect(v.ready).toBe(false);
    expect(v.error).toMatch(/apply migrations 0258 to 0263/);
    expect(v.notices).toEqual([]);
  });

  it("lists open notices with names, employee holds, checks with their next step, reviews, records and the monitor", async () => {
    st.db.tables.set("ach_return_notices", [
      { id: NID, notice_kind: "return", code: "R03", received_on: "2026-10-02", apply_by: null, payee_type: "employee", employee_id: EMP2, vendor_id: null, hold_applied: "authorization", corrected_last4: null, verification_id: null, resolved_at: null },
      { id: VER2, notice_kind: "noc", code: "C01", received_on: "2026-09-02", apply_by: "2026-09-10", payee_type: "vendor", employee_id: null, vendor_id: VEND, hold_applied: "vault", corrected_last4: "1234", verification_id: null, resolved_at: "2026-09-05T00:00:00Z" },
    ]);
    st.db.tables.get("ach_verifications")!.push(
      { id: VER2, account_id: ACC2, method: "micro_entry", status: "failed", micro_amount_cents: 12, effective_date: "2026-09-20", settlement_date: "2026-09-20", eligible_on: "2026-09-21", result_code: "R03", created_at: "2026-09-19T18:00:00Z" },
    );
    const v = await store.opsPageView(TODAY);
    expect(v.ready).toBe(true);
    expect(v.error).toBeNull();
    expect(v.notices.map((n) => [n.code, n.payee])).toEqual([["R03", "Sam Helper"]]);
    expect(v.holds.map((h) => h.id)).toEqual([AUTH2]);
    const c1 = v.checks.find((c) => c.accountId === ACC1)!;
    expect(c1.open?.id).toBe(VER1);
    expect(c1.open?.step.kind).toBe("download");
    const c2 = v.checks.find((c) => c.accountId === ACC2)!;
    expect(c2.open).toBeNull();
    expect(v.reviews.map((r) => [r.id, r.status, r.days])).toEqual([[AUTHV, "due_soon", 15]]);
    expect(v.records).toHaveLength(3);
    expect(v.records.every((r) => !/delet(e|ed) (now|automatically)\b/.test(r.retention) || /nothing is deleted/.test(r.retention))).toBe(true);
    expect(v.monitor.sent30).toBe(1);
    expect(v.monitor.returned30).toBe(1);
    expect(v.monitor.flags.some((f) => /came back/.test(f))).toBe(true);
    expect(v.planned).toEqual({ prenote: [VER1], micro_entry: [] });
    for (const s of SECRETS) expect(JSON.stringify(v)).not.toContain(s);
  });

  it("an account shared by two payees is flagged (no numbers read)", async () => {
    st.db.tables.get("ach_authorization_accounts")!.find((a) => a.id === ACC2)!.account_key_hmac = HMAC1;
    st.db.tables.get("ach_verifications")!.push({ id: VER2, account_id: ACC2, method: "prenote", status: "passed", micro_amount_cents: null, effective_date: "2026-09-20", settlement_date: "2026-09-20", eligible_on: "2026-09-23", result_code: null, created_at: "2026-09-19T18:00:00Z" });
    const v = await store.opsPageView(TODAY);
    expect(v.monitor.flags.some((f) => /more than one person/.test(f))).toBe(true);
  });

  it("an archived account is not on the checks list", async () => {
    st.db.tables.get("ach_authorization_accounts")!.find((a) => a.id === ACC2)!.archived_at = "2026-10-01T00:00:00Z";
    const v = await store.opsPageView(TODAY);
    expect(v.checks.map((c) => c.accountId)).toEqual([ACC1]);
  });

  it("an open vendor notice shows the vendor's name; an unknown payee says so", async () => {
    st.db.tables.set("ach_return_notices", [
      { id: NID, notice_kind: "noc", code: "C02", received_on: "2026-10-01", apply_by: "2026-10-07", payee_type: "vendor", employee_id: null, vendor_id: VEND, hold_applied: "vault", corrected_last4: "0015", verification_id: null, resolved_at: null },
      { id: VER2, notice_kind: "return", code: "R02", received_on: "2026-10-01", apply_by: null, payee_type: "employee", employee_id: AUTH1, vendor_id: null, hold_applied: "none", corrected_last4: null, verification_id: null, resolved_at: null },
    ]);
    const v = await store.opsPageView(TODAY);
    expect(v.notices.map((n) => [n.code, n.payee])).toEqual([["C02", "Acme Farms"], ["R02", "(unknown payee)"]]);
  });

  it("a verified account with no open check drops off the checks list", async () => {
    st.db.tables.get("ach_authorization_accounts")!.find((a) => a.id === ACC2)!.verification_status = "verified";
    const v = await store.opsPageView(TODAY);
    expect(v.checks.map((c) => c.accountId)).toEqual([ACC1]);
  });
});
