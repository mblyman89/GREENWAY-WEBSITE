/**
 * R39 S6 — ach-esign-store behaviour, run for real:
 *   - the REAL store over the REAL @supabase/postgrest-js client against
 *     FakePostgrest (partial unique "one live session per employee",
 *     RPC captured at the HTTP layer);
 *   - a fake private bucket that refuses overwrites like upsert:false;
 *   - real AES-GCM (encryptSecret), real HKDF/HMAC (keyedHasher), real
 *     crypto.randomInt, real PDF builder.
 * The emailed code is read back from the email the store sends, exactly as
 * the employee would read it.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  objects: new Map<string, Uint8Array>(),
  removed: [] as string[],
  uploads: [] as { key: string; upsert: unknown; contentType: unknown }[],
  uploadFailOn: 0,
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
      return {
        from: (t: string) => pg.from(t),
        rpc: (fn: string, args: Record<string, unknown>) => pg.rpc(fn, args),
        storage: {
          from: (bucket: string) => {
            if (bucket !== "ach-docs") throw new Error(`unexpected bucket ${bucket}`);
            return {
              upload: async (key: string, bytes: Uint8Array, opts: { upsert?: boolean; contentType?: string }) => {
                st.uploads.push({ key, upsert: opts.upsert, contentType: opts.contentType });
                if (st.uploadFailOn && st.uploads.length === st.uploadFailOn) return { data: null, error: { message: "storage down" } };
                if (st.objects.has(key) && !opts.upsert) return { data: null, error: { message: "The resource already exists" } };
                st.objects.set(key, new Uint8Array(bytes));
                return { data: { path: key }, error: null };
              },
              download: async (key: string) => {
                const b = st.objects.get(key);
                return b ? { data: new Blob([b.slice()]), error: null } : { data: null, error: { message: "Object not found" } };
              },
              remove: async (keys: string[]) => {
                st.removed.push(...keys);
                for (const k of keys) st.objects.delete(k);
                return { data: [], error: null };
              },
            };
          },
        },
      };
    },
  };
});

const store = await import("@/lib/payments/ach-esign-store");
const core = await import("@/lib/payments/ach-esign-core");

const EMP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const AUTH_ID = "33333333-3333-4333-8333-333333333333";
const T0 = Date.parse("2026-10-05T17:00:00Z");
const EMAIL = "pat.worker@example.com";
const NUMBERS = ["021000021", "011000015", "0012345678", "99990000"];

const A1 = { routing: "021000021", routingAgain: "021000021", account: "0012345678", accountAgain: "0012345678", accountType: "checking" as const, rule: { kind: "fixed" as const, cents: 20000 }, bankName: "First Test Bank" };
const A2 = { routing: "011000015", routingAgain: "011000015", account: "99990000", accountAgain: "99990000", accountType: "savings" as const, rule: { kind: "remainder" as const }, bankName: "Second CU" };

type Mail = { to: string; subject: string; html: string };
let mails: Mail[] = [];
let mailFails = false;
const mailer: import("@/lib/payments/ach-esign-store").CodeMailer = async (to, m) => {
  mails.push({ to, ...m });
  return mailFails ? { ok: false, detail: "provider 500" } : { ok: true };
};
const lastCode = () => {
  const m = /\b(\d{6})\b/.exec(mails[mails.length - 1].html);
  if (!m) throw new Error("no code in email");
  return m[1];
};

function everythingWritten(): string {
  return JSON.stringify({ tables: [...st.db.tables.entries()], rpc: st.rpc });
}
const row = (id: string) => (st.db.tables.get("ach_esign_sessions") ?? []).find((r) => r.id === id) as Row;
const fresh = async (id: string) => (await store.getEsignSession(id))!;

beforeEach(() => {
  process.env.DATA_ENCRYPTION_KEY = "esign-behaviour-key-0123456789abcdef";
  st.db = new FakePostgrest();
  st.objects = new Map();
  st.removed = [];
  st.uploads = [];
  st.uploadFailOn = 0;
  st.rpc = [];
  st.rpcReply = null;
  mails = [];
  mailFails = false;
  st.db.tables.set("employees", [{ id: EMP, active: true }]);
  // Real uuids: the store refuses non-uuid ids in getEsignSession.
  let n = 0;
  st.db.defaults.set("ach_esign_sessions", () => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String((n += 1)).padStart(12, "0")}`,
    state: "started",
    started_at: new Date(T0).toISOString(),
    email_enc: null, email_masked: null, otp_digest: null, otp_sent_at: null, otp_sends: 0, otp_attempts: 0,
    code_verified_at: null, disclosure_version: null, disclosure_sha256: null, consented_at: null, signed_at: null,
    record_document_id: null, certificate_document_id: null, authorization_id: null, cancelled_at: null, cancel_reason: null,
  }));
  st.db.uniques.push({ table: "ach_esign_sessions", columns: ["employee_id"], name: "ach_esign_one_live_per_employee", where: (r) => ["started", "code_sent", "consented"].includes(String(r.state)) });
  st.db.before = (req) => {
    if (!req.url.pathname.includes("/rpc/")) return;
    const fn = req.url.pathname.split("/").pop()!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    st.rpc.push({ fn, body });
    if (st.rpcReply) return st.rpcReply(fn, body);
    return { status: 200, body: AUTH_ID };
  };
});

async function started() {
  const r = await store.startEsignSession({ employeeId: EMP, actorId: ACTOR, idType: "wa_dl_id", idDetail: "1234 exp 2029-05-01", legalName: "Pat Q. Worker", todayIso: "2026-10-05" });
  if (!r.ok) throw new Error(r.error);
  return r.session;
}
async function codeSent() {
  const s = await started();
  const r = await store.sendEsignCode({ session: s, email: EMAIL, nowMs: T0 + 1000, mail: mailer });
  if (!r.ok) throw new Error(r.error);
  return fresh(s.id);
}
async function consented() {
  const s = await codeSent();
  const r = await store.verifyCodeAndConsent({ session: s, typedCode: lastCode(), agreed: true, disclosureSha256Shown: store.currentDisclosureSha256(), nowMs: T0 + 60_000 });
  if (!r.ok) throw new Error(r.error);
  return fresh(s.id);
}
const signInput = (s: import("@/lib/payments/ach-esign-store").EsignSession, over: Record<string, unknown> = {}) => ({
  session: s, actorId: ACTOR, startedBy: { name: "Stephen", email: "s@example.com" }, typedName: "pat q. worker",
  intentChecked: true, replaceOpen: false, accounts: [A1, A2], ip: "203.0.113.7", userAgent: "Mozilla/5.0 test", nowMs: T0 + 120_000, ...over,
});

describe("start", () => {
  it("inserts one started session with the ID check and legal name", async () => {
    const s = await started();
    expect(s).toMatchObject({ employee_id: EMP, state: "started", started_by: ACTOR, id_type: "wa_dl_id", legal_name: "Pat Q. Worker" });
    expect((st.db.tables.get("ach_esign_sessions") ?? []).length).toBe(1);
  });
  it("refuses a full ID number, an unknown employee, and a second live session", async () => {
    const bad = await store.startEsignSession({ employeeId: EMP, actorId: ACTOR, idType: "wa_dl_id", idDetail: "WDL123456789", legalName: "Pat Worker", todayIso: "2026-10-05" });
    expect(bad.ok).toBe(false);
    const ghost = await store.startEsignSession({ employeeId: "9f8fad5b-d9cb-469f-a165-70867728950e", actorId: ACTOR, idType: "passport", idDetail: "1234 exp 2030", legalName: "Pat Worker", todayIso: "2026-10-05" });
    expect(ghost).toEqual({ ok: false, error: "That employee no longer exists." });
    await started();
    const dup = await store.startEsignSession({ employeeId: EMP, actorId: ACTOR, idType: "passport", idDetail: "1234 exp 2030", legalName: "Pat Worker", todayIso: "2026-10-05" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/already|live|open|cancel/i);
    expect((st.db.tables.get("ach_esign_sessions") ?? []).length).toBe(1);
  });
  it("liveEsignSession finds the live one and ignores cancelled ones", async () => {
    const s = await started();
    expect((await store.liveEsignSession(EMP)).session?.id).toBe(s.id);
    await store.cancelEsignSession({ session: s, reason: "wrong person", nowMs: T0 + 5 });
    expect(await store.liveEsignSession(EMP)).toEqual({ ready: true, session: null, error: null });
  });
});

describe("send code", () => {
  it("stores only a keyed digest and the encrypted email; the code reaches the mailbox only", async () => {
    const s = await codeSent();
    const code = lastCode();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe(EMAIL);
    expect(mails[0].subject).not.toContain(code);
    expect(s.state).toBe("code_sent");
    expect(s.otp_sends).toBe(1);
    expect(String(s.email_enc)).toMatch(/^encv1:/);
    expect(s.email_masked).not.toContain("pat.worker");
    const written = everythingWritten();
    expect(written).not.toContain(EMAIL);
    expect(written).not.toContain(`"${code}"`);
    // The digest is the HKDF-keyed one, bound to this session.
    const h = (await import("@/lib/security/keyed-hash")).keyedHasher("esignOtp")!;
    expect(s.otp_digest).toBe(core.otpDigest(h, s.id, code));
  });
  it("counts the send BEFORE mailing: a failed email still uses up a send", async () => {
    const s = await started();
    mailFails = true;
    const r = await store.sendEsignCode({ session: s, email: EMAIL, nowMs: T0 + 1000, mail: mailer });
    expect(r.ok).toBe(false);
    expect(row(s.id).otp_sends).toBe(1);
    expect(row(s.id).otp_digest).toBeTruthy();
  });
  it("enforces the cooldown and the 3-send cap", async () => {
    let s = await codeSent();
    const soon = await store.sendEsignCode({ session: s, email: EMAIL, nowMs: T0 + 30_000, mail: mailer });
    expect(soon.ok).toBe(false);
    for (const t of [T0 + 70_000, T0 + 140_000]) {
      const r = await store.sendEsignCode({ session: s, email: EMAIL, nowMs: t, mail: mailer });
      expect(r.ok).toBe(true);
      s = await fresh(s.id);
    }
    expect(s.otp_sends).toBe(3);
    const fourth = await store.sendEsignCode({ session: s, email: EMAIL, nowMs: T0 + 300_000, mail: mailer });
    expect(fourth.ok).toBe(false);
    expect(mails).toHaveLength(3);
  });
  it("a stale session copy loses the race (optimistic otp_sends)", async () => {
    const s = await started();
    await store.sendEsignCode({ session: s, email: EMAIL, nowMs: T0 + 1000, mail: mailer });
    const r = await store.sendEsignCode({ session: s, email: EMAIL, nowMs: T0 + 90_000, mail: mailer });
    expect(r).toEqual({ ok: false, error: "Another device changed this signing. Reload the page." });
    expect(row(s.id).otp_sends).toBe(1);
  });
  it("refuses after the 30-minute session expiry and with a bad email", async () => {
    const s = await started();
    expect((await store.sendEsignCode({ session: s, email: EMAIL, nowMs: T0 + 31 * 60_000, mail: mailer })).ok).toBe(false);
    expect((await store.sendEsignCode({ session: s, email: "not-an-email", nowMs: T0 + 1000, mail: mailer })).ok).toBe(false);
    expect(mails).toHaveLength(0);
    expect(row(s.id).otp_sends).toBe(0);
  });
  it("fails closed without DATA_ENCRYPTION_KEY (nothing stored, nothing sent)", async () => {
    const s = await started();
    delete process.env.DATA_ENCRYPTION_KEY;
    const r = await store.sendEsignCode({ session: s, email: EMAIL, nowMs: T0 + 1000, mail: mailer });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/DATA_ENCRYPTION_KEY/);
    expect(mails).toHaveLength(0);
    expect(row(s.id).otp_sends).toBe(0);
  });
});

describe("verify code + consent", () => {
  it("a right code moves to consented with the disclosure version and SHA-256", async () => {
    const s = await consented();
    expect(s.state).toBe("consented");
    expect(s.disclosure_version).toBe(core.ESIGN_DISCLOSURE_VERSION);
    expect(s.disclosure_sha256).toBe(createHash("sha256").update(core.canonicalJson(core.disclosureBody()), "utf8").digest("hex"));
    expect(s.consented_at).toBe(new Date(T0 + 60_000).toISOString());
  });
  it("a wrong code is counted in the database; 5 wrong codes lock it, even the right one after", async () => {
    let s = await codeSent();
    const good = lastCode();
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 1; i <= 5; i++) {
      const r = await store.verifyCodeAndConsent({ session: s, typedCode: wrong, agreed: true, disclosureSha256Shown: store.currentDisclosureSha256(), nowMs: T0 + 60_000 });
      expect(r.ok).toBe(false);
      s = await fresh(s.id);
      expect(s.otp_attempts).toBe(i);
    }
    const late = await store.verifyCodeAndConsent({ session: s, typedCode: good, agreed: true, disclosureSha256Shown: store.currentDisclosureSha256(), nowMs: T0 + 60_000 });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toMatch(/Too many/);
    expect((await fresh(s.id)).state).toBe("code_sent");
  });
  it("a stale copy cannot replay a wrong guess for free (optimistic otp_attempts)", async () => {
    const s = await codeSent();
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    await store.verifyCodeAndConsent({ session: s, typedCode: wrong, agreed: true, disclosureSha256Shown: store.currentDisclosureSha256(), nowMs: T0 + 60_000 });
    const r = await store.verifyCodeAndConsent({ session: s, typedCode: wrong, agreed: true, disclosureSha256Shown: store.currentDisclosureSha256(), nowMs: T0 + 60_000 });
    expect(r).toEqual({ ok: false, error: "Another device changed this signing. Reload the page." });
    expect(row(s.id).otp_attempts).toBe(1);
  });
  it("refuses without I agree, with a changed disclosure, and with an expired code (none counted)", async () => {
    const s = await codeSent();
    const code = lastCode();
    const sha = store.currentDisclosureSha256();
    expect((await store.verifyCodeAndConsent({ session: s, typedCode: code, agreed: false, disclosureSha256Shown: sha, nowMs: T0 + 60_000 })).ok).toBe(false);
    expect((await store.verifyCodeAndConsent({ session: s, typedCode: code, agreed: true, disclosureSha256Shown: "0".repeat(64), nowMs: T0 + 60_000 })).ok).toBe(false);
    expect((await store.verifyCodeAndConsent({ session: s, typedCode: code, agreed: true, disclosureSha256Shown: sha, nowMs: T0 + 1000 + 11 * 60_000 })).ok).toBe(false);
    expect(row(s.id)).toMatchObject({ state: "code_sent", otp_attempts: 0 });
  });
  it("an old code stops working after a resend", async () => {
    let s = await codeSent();
    const old = lastCode();
    await store.sendEsignCode({ session: s, email: EMAIL, nowMs: T0 + 70_000, mail: mailer });
    s = await fresh(s.id);
    if (old !== lastCode()) {
      const r = await store.verifyCodeAndConsent({ session: s, typedCode: old, agreed: true, disclosureSha256Shown: store.currentDisclosureSha256(), nowMs: T0 + 80_000 });
      expect(r.ok).toBe(false);
    }
    const ok = await store.verifyCodeAndConsent({ session: await fresh(s.id), typedCode: lastCode(), agreed: true, disclosureSha256Shown: store.currentDisclosureSha256(), nowMs: T0 + 90_000 });
    expect(ok.ok).toBe(true);
  });
});

describe("sign", () => {
  it("stores two PDFs (upsert:false), calls ach_esign_complete once, and leaks no bank number outside encrypted fields", async () => {
    const s = await consented();
    const r = await store.signEsignSession(signInput(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.authorizationId).toBe(AUTH_ID);
    expect(r.accountsLast4).toEqual(["5678", "0000"]);
    expect(r.emailTo).toBe(EMAIL);
    expect(r.replacedPrevious).toBe(false);
    expect(st.uploads).toHaveLength(2);
    expect(st.uploads.every((u) => u.upsert === false && u.contentType === "application/pdf")).toBe(true);
    expect(st.removed).toEqual([]);
    const calls = st.rpc.filter((c) => c.fn === "ach_esign_complete");
    expect(calls).toHaveLength(1);
    const b = calls[0].body;
    expect(b).toMatchObject({ p_session_id: s.id, p_actor: ACTOR, p_ip: "203.0.113.7", p_user_agent: "Mozilla/5.0 test", p_replace_open: false, p_typed_name: "pat q. worker" });
    const rec = b.p_record as { storage_path: string; sha256: string; byte_size: number };
    const recKey = [...st.objects.keys()].find((k) => rec.storage_path.endsWith(k))!;
    expect(rec.sha256).toBe(createHash("sha256").update(st.objects.get(recKey)!).digest("hex"));
    expect(rec.sha256).toBe(r.recordSha256);
    const accts = b.p_accounts as Record<string, unknown>[];
    expect(accts).toHaveLength(2);
    // Bank numbers appear only inside encv1: ciphertext, never in clear.
    const written = everythingWritten();
    for (const n of NUMBERS) expect(written).not.toContain(n);
    for (const a of accts) for (const [k, v] of Object.entries(a)) if (typeof v === "string" && /_enc$/.test(k)) expect(v).toMatch(/^encv1:/);
  });
  it("on an RPC failure, both stored files are removed (no orphans) and the error is translated", async () => {
    const s = await consented();
    st.rpcReply = () => ({ status: 400, body: { code: "P0001", message: "ACH_ESIGN_STATE: not consented" } });
    const r = await store.signEsignSession(signInput(s));
    expect(r.ok).toBe(false);
    expect(st.uploads).toHaveLength(2);
    expect(st.removed.sort()).toEqual(st.uploads.map((u) => u.key).sort());
    expect(st.objects.size).toBe(0);
  });
  it("if the certificate upload fails, the record file is removed and no RPC is made", async () => {
    const s = await consented();
    st.uploadFailOn = 2;
    const r = await store.signEsignSession(signInput(s));
    expect(r.ok).toBe(false);
    expect(st.removed).toEqual([st.uploads[0].key]);
    expect(st.objects.size).toBe(0);
    expect(st.rpc.filter((c) => c.fn === "ach_esign_complete")).toHaveLength(0);
  });
  it("refuses a mismatched signature, no intent tick, a not-consented session, and mistyped second numbers (nothing stored)", async () => {
    const s = await consented();
    expect((await store.signEsignSession(signInput(s, { typedName: "Someone Else" }))).ok).toBe(false);
    expect((await store.signEsignSession(signInput(s, { intentChecked: false }))).ok).toBe(false);
    const early = await codeSentOther();
    expect((await store.signEsignSession(signInput(early))).ok).toBe(false);
    expect(st.uploads).toHaveLength(0);
    expect(st.rpc).toHaveLength(0);
  });
  it("an open authorization blocks signing unless replace is ticked; then replacedPrevious is true", async () => {
    st.db.tables.set("ach_authorizations", [{ id: "44444444-4444-4444-8444-444444444444", payee_type: "employee", employee_id: EMP, state: "active" }]);
    const s = await consented();
    const r1 = await store.signEsignSession(signInput(s));
    expect(r1.ok).toBe(false);
    expect(st.uploads).toHaveLength(0);
    const r2 = await store.signEsignSession(signInput(s, { replaceOpen: true }));
    expect(r2.ok && r2.replacedPrevious).toBe(true);
    expect(st.rpc[0].body.p_replace_open).toBe(true);
  });
  it("a revoked or archived authorization is not 'open'", async () => {
    st.db.tables.set("ach_authorizations", [
      { id: "44444444-4444-4444-8444-444444444444", payee_type: "employee", employee_id: EMP, state: "revoked" },
      { id: "55555555-5555-4555-8555-555555555555", payee_type: "employee", employee_id: EMP, state: "archived" },
    ]);
    const s = await consented();
    const r = await store.signEsignSession(signInput(s));
    expect(r.ok && r.replacedPrevious).toBe(false);
  });
});

// A second employee's code_sent session, for the "not consented" refusal.
async function codeSentOther() {
  const other = "1f8fad5b-d9cb-469f-a165-70867728950e";
  (st.db.tables.get("employees") as Row[]).push({ id: other, active: true });
  const r = await store.startEsignSession({ employeeId: other, actorId: ACTOR, idType: "passport", idDetail: "1234 exp 2030", legalName: "Pat Q. Worker", todayIso: "2026-10-05" });
  if (!r.ok) throw new Error(r.error);
  await store.sendEsignCode({ session: r.session, email: EMAIL, nowMs: T0 + 1000, mail: mailer });
  return fresh(r.session.id);
}

describe("cancel", () => {
  it("needs a reason, keeps the row, and is final", async () => {
    const s = await started();
    expect((await store.cancelEsignSession({ session: s, reason: "no", nowMs: T0 })).ok).toBe(false);
    expect((await store.cancelEsignSession({ session: s, reason: "  changed   their mind ", nowMs: T0 + 5 })).ok).toBe(true);
    expect(row(s.id)).toMatchObject({ state: "cancelled", cancel_reason: "changed their mind" });
    const again = await store.cancelEsignSession({ session: s, reason: "second try", nowMs: T0 + 6 });
    expect(again).toEqual({ ok: false, error: "This signing has already finished or been cancelled. Reload the page." });
    expect((await store.cancelEsignSession({ session: await fresh(s.id), reason: "second try", nowMs: T0 + 6 })).ok).toBe(false);
  });
});

describe("signer's copy", () => {
  async function signedWithDoc() {
    const s = await consented();
    const r = await store.signEsignSession(signInput(s));
    if (!r.ok) throw new Error(r.error);
    const rec = st.rpc[0].body.p_record as { storage_path: string; sha256: string };
    st.db.tables.set("ach_authorization_documents", [{ id: "66666666-6666-4666-8666-666666666666", storage_path: rec.storage_path, sha256: rec.sha256 }]);
    const sess = { ...(await fresh(s.id)), state: "signed" as const, record_document_id: "66666666-6666-4666-8666-666666666666" };
    return { sess, rec };
  }
  it("returns the exact stored bytes after re-checking their SHA-256", async () => {
    const { sess, rec } = await signedWithDoc();
    const r = await store.signedRecordBytes(sess);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sha256).toBe(rec.sha256);
      expect(new TextDecoder().decode(r.bytes.slice(0, 5))).toBe("%PDF-");
    }
  });
  it("refuses a tampered file and an unsigned session", async () => {
    const { sess, rec } = await signedWithDoc();
    const key = [...st.objects.keys()].find((k) => rec.storage_path.endsWith(k))!;
    const b = st.objects.get(key)!;
    b[b.length - 2] ^= 1;
    const r = await store.signedRecordBytes(sess);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/SHA-256/);
    expect((await store.signedRecordBytes({ ...sess, state: "consented" })).ok).toBe(false);
  });
});
