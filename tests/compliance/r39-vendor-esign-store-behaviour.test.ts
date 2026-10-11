/**
 * R39 S7 — vendor-esign-store behaviour, run for real:
 *   - the REAL store over the REAL @supabase/postgrest-js client against
 *     FakePostgrest (partial unique "one open invite per vendor" as in 0262,
 *     RPCs captured at the HTTP layer and emulated like 0262 writes them);
 *   - a fake private bucket that refuses overwrites like upsert:false;
 *   - real AES-GCM, real HKDF/HMAC, real randomInt, real PDF builder.
 * The link and the code are read back from the emails, exactly as the vendor
 * would read them.
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
  rpcReply: null as null | ((fn: string, body: Record<string, unknown>) => { status: number; body: unknown } | void),
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

const store = await import("@/lib/payments/vendor-esign-store");
const core = await import("@/lib/payments/vendor-esign-core");

const VENDOR = "0f8fad5b-d9cb-469f-a165-70867728950e";
const VENDOR2 = "1f8fad5b-d9cb-469f-a165-70867728950f";
const ACTOR = { id: "11111111-1111-4111-8111-111111111111", name: "Michael Lyman" };
const RELEASER = "22222222-2222-4222-8222-222222222222";
const AUTH_ID = "33333333-3333-4333-8333-333333333333";
const T0 = Date.parse("2026-10-05T17:00:00Z");
const EMAIL = "ar@farm.example.com";
const ROUTING = "021000021";
const ACCOUNT = "4455667788";
const SITE = "https://www.greenwaymarijuana.com";

// A real JPEG prefix (SOI + APP0 JFIF) so the byte sniffing accepts it.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, ...new Array(200).fill(7), 0xff, 0xd9]);
const NOT_AN_IMAGE = new TextEncoder().encode("MZ this is an exe pretending to be a jpeg");

const FORM: Record<string, string> = {
  legal_name: "Green Farm LLC",
  dba: "Green Farm",
  entity_type: "llc",
  vendor_kind: "producer",
  license_no: "412345",
  ubi: "604-123-456",
  tin_last4: "4321",
  street: "100 Field Rd",
  city: "Shelton",
  state: "wa",
  zip: "98584",
  ar_contact: "Ann Ar, Bookkeeper",
  ar_phone: "(360) 555-0100",
  ar_email: "ar@farm.example.com",
  second_contact: "Bob Boss, Owner",
  second_phone: "360.555.0199",
  second_email: "bob@farm.example.com",
  request_type: "new",
  bank_name: "Timberland Bank",
  bank_city_state: "Shelton, WA",
  start_date: "",
  routing: ROUTING,
  account: ACCOUNT,
  account2: ACCOUNT,
  account_type: "checking",
  name_on_account: "Green Farm LLC",
  remittance_email: "",
  notes: "",
  proof_kind: "voided_check",
};

type Mail = { to: string[]; subject: string; html: string };
let mails: Mail[] = [];
let mailFails = false;
const mailer: import("@/lib/payments/vendor-esign-mail").VendorMailer = async (to, m) => {
  mails.push({ to, subject: m.subject, html: m.html });
  return mailFails ? { ok: false, detail: "provider 500" } : { ok: true };
};
const lastCode = () => {
  const m = /\b(\d{6})\b/.exec(mails[mails.length - 1].html);
  if (!m) throw new Error("no code in email");
  return m[1];
};
const linkToken = (html: string) => {
  const m = /\/vendor-ach\/([A-Za-z0-9_-]{43})/.exec(html);
  if (!m) throw new Error("no link in email");
  return m[1];
};

const everythingWritten = () => JSON.stringify({ tables: [...st.db.tables.entries()], rpc: st.rpc });
const rows = () => (st.db.tables.get("vendor_esign_invites") ?? []) as Row[];
const row = (id: string) => rows().find((r) => r.id === id) as Row;
const fresh = async (id: string) => (await store.getVendorInvite(id))!;

beforeEach(() => {
  process.env.DATA_ENCRYPTION_KEY = "vendor-esign-behaviour-key-0123456789abcdef";
  st.db = new FakePostgrest();
  st.objects = new Map();
  st.removed = [];
  st.uploads = [];
  st.uploadFailOn = 0;
  st.rpc = [];
  st.rpcReply = null;
  mails = [];
  mailFails = false;
  st.db.tables.set("vendors", [
    { id: VENDOR, display_name: "Green Farm", legal_name: "Green Farm LLC", email: "office@farm.example.com", is_active: true, ach_opted_out: false },
    { id: VENDOR2, display_name: "Glass Co", legal_name: null, email: null, is_active: true, ach_opted_out: false },
  ]);
  st.db.tables.set("staff_profiles", [
    { id: ACTOR.id, full_name: "Michael Lyman", email: "michael@greenway.example" },
    { id: RELEASER, full_name: "Stephen Lyman", email: "stephen@greenway.example" },
  ]);
  st.db.tables.set("vendor_bank_details", []);
  st.db.tables.set("ach_authorization_documents", []);
  let n = 0;
  st.db.defaults.set("vendor_esign_invites", () => ({
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String((n += 1)).padStart(12, "0")}`,
    state: "sent",
    first_opened_at: null, otp_digest: null, otp_sent_at: null, otp_sends: 0, otp_attempts: 0,
    code_verified_at: null, browser_digest: null, disclosure_version: null, disclosure_sha256: null, consented_at: null,
    proof_storage_path: null, proof_sha256: null, proof_byte_size: null, proof_mime: null, proof_kind: null, proof_filename: null,
    form: null, bank_routing_enc: null, bank_account_enc: null, bank_account_type: null, account_last4: null, routing_last4: null,
    signed_at: null, signer_name: null, signer_title: null, record_document_id: null, certificate_document_id: null, proof_document_id: null,
    authorization_id: null, countersigned_by: null, countersigned_at: null, countersign_document_id: null,
    rejected_by: null, rejected_at: null, reject_reason: null, cancelled_by: null, cancelled_at: null, cancel_reason: null,
  }));
  st.db.uniques.push({
    table: "vendor_esign_invites",
    columns: ["vendor_id"],
    name: "vendor_esign_one_open_per_vendor",
    where: (r) => ["sent", "code_sent", "consented", "signed"].includes(String(r.state)),
  });
  st.db.before = (req) => {
    if (!req.url.pathname.includes("/rpc/")) return;
    const fn = req.url.pathname.split("/").pop()!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    st.rpc.push({ fn, body });
    if (st.rpcReply) {
      const r = st.rpcReply(fn, body);
      if (r) return r;
    }
    return emulate0262(fn, body);
  };
});

/** What 0262's RPCs write, enough for the store's later reads. */
function emulate0262(fn: string, b: Record<string, unknown>): { status: number; body: unknown } {
  const inv = row(String(b.p_invite_id));
  if (fn === "vendor_esign_complete") {
    const bank = b.p_bank as Record<string, string>;
    const docs = st.db.tables.get("ach_authorization_documents")!;
    const rec = b.p_record as { storage_path: string; sha256: string };
    const cert = b.p_certificate as { storage_path: string; sha256: string };
    docs.push({ id: "dddddddd-dddd-4ddd-8ddd-000000000001", storage_path: rec.storage_path, sha256: rec.sha256 });
    docs.push({ id: "dddddddd-dddd-4ddd-8ddd-000000000002", storage_path: cert.storage_path, sha256: cert.sha256 });
    Object.assign(inv, {
      state: "signed", signed_at: b.p_signed_at, signer_name: b.p_signer_name, signer_title: b.p_signer_title, form: b.p_form,
      bank_routing_enc: bank.routing_enc, bank_account_enc: bank.account_enc, bank_account_type: bank.account_type,
      account_last4: bank.account_last4, routing_last4: bank.routing_last4,
      record_document_id: "dddddddd-dddd-4ddd-8ddd-000000000001", certificate_document_id: "dddddddd-dddd-4ddd-8ddd-000000000002", authorization_id: AUTH_ID,
    });
    // 0262 writes the vault ON HOLD (0259 status set) with the same ciphertext.
    st.db.tables.set("vendor_bank_details", [
      { vendor_id: inv.vendor_id, status: "on_hold", hold_reason: "Vendor e-signed new banking", released_by: null, released_at: null, release_mode: null, release_callback_note: null, verified_at: null, bank_routing: bank.routing_enc, bank_account_number: bank.account_enc, bank_account_type: bank.account_type },
    ]);
    return { status: 200, body: AUTH_ID };
  }
  if (fn === "vendor_esign_countersign") {
    Object.assign(inv, { state: "countersigned", countersigned_by: b.p_actor, countersigned_at: new Date(T0).toISOString() });
    return { status: 200, body: null };
  }
  if (fn === "vendor_esign_reject") {
    Object.assign(inv, { state: "rejected", rejected_by: b.p_actor, reject_reason: b.p_reason });
    return { status: 200, body: null };
  }
  return { status: 404, body: { code: "PGRST202", message: `unknown fn ${fn}` } };
}

async function invited(vendorId = VENDOR, email = EMAIL) {
  const r = await store.createVendorInvite({ vendorId, actor: ACTOR, recipientName: "Ann Ar", email, siteBase: SITE, nowMs: T0, mail: mailer });
  if (!r.ok) throw new Error(r.error);
  return { id: r.inviteId, token: linkToken(mails[mails.length - 1].html), r };
}
async function codeSent() {
  const i = await invited();
  const r = await store.sendVendorCode({ invite: await fresh(i.id), nowMs: T0 + 1000, mail: mailer });
  if (!r.ok) throw new Error(r.error);
  return i;
}
async function consented() {
  const i = await codeSent();
  const r = await store.verifyVendorCode({ invite: await fresh(i.id), typedCode: lastCode(), agreed: true, disclosureSha256Shown: store.currentVendorDisclosureSha256(), nowMs: T0 + 2000 });
  if (!r.ok) throw new Error(r.error);
  return { ...i, cookie: r.cookie };
}
function signInput(inv: import("@/lib/payments/vendor-esign-store").VendorInvite, cookie: string | null, over: Partial<{ form: Record<string, string>; proof: Uint8Array | null; intent: boolean }> = {}) {
  const f = { ...FORM, ...(over.form ?? {}) };
  const proof = over.proof === undefined ? JPEG : over.proof;
  return {
    invite: inv,
    cookie,
    get: (k: string) => (k in f ? f[k] : null),
    proofFile: proof ? { bytes: proof, mime: "image/jpeg", filename: "check.jpg" } : null,
    signerName: "Ann Ar",
    signerTitle: "Bookkeeper",
    intentChecked: over.intent ?? true,
    ip: "203.0.113.9",
    userAgent: "Mozilla/5.0 (iPhone)",
    nowMs: T0 + 3000,
  };
}
async function signed() {
  const c = await consented();
  const r = await store.signVendorInvite(signInput(await fresh(c.id), c.cookie));
  if (!r.ok) throw new Error(r.error + JSON.stringify(r.errors ?? {}));
  return { ...c, result: r };
}

describe("createVendorInvite", () => {
  it("emails a link, stores only the token hash and an encrypted address", async () => {
    const i = await invited();
    expect(i.r.mailed).toBe(true);
    expect(i.r.emailOnFile).toBe(false); // ar@ differs from office@ on file: surfaced to staff
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual([EMAIL]);
    expect(mails[0].html).toContain(`${SITE}/vendor-ach/${i.token}`);
    const r = row(i.id);
    expect(r.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(String(r.email_enc)).toMatch(/^encv1:/);
    const all = everythingWritten();
    expect(all).not.toContain(i.token);
    expect(all).not.toContain(EMAIL);
    // The link resolves back to this row; a one-character change does not.
    expect((await store.getVendorInviteByToken(i.token))?.id).toBe(i.id);
    const flipped = (i.token[0] === "A" ? "B" : "A") + i.token.slice(1);
    expect(await store.getVendorInviteByToken(flipped)).toBeNull();
    expect(await store.getVendorInviteByToken("short")).toBeNull();
  });

  it("refuses a second open link for the same vendor (0262 partial unique)", async () => {
    await invited();
    const r = await store.createVendorInvite({ vendorId: VENDOR, actor: ACTOR, recipientName: "Ann Ar", email: EMAIL, siteBase: SITE, nowMs: T0, mail: mailer });
    expect(r.ok).toBe(false);
    expect(rows()).toHaveLength(1);
  });

  it("replaceExpired cancels an expired open link and issues a new one; a live one is not replaced", async () => {
    const a = await invited();
    const live = await store.createVendorInvite({ vendorId: VENDOR, actor: ACTOR, recipientName: "Ann Ar", email: EMAIL, siteBase: SITE, nowMs: T0 + 1000, mail: mailer, replaceExpired: true });
    expect(live.ok).toBe(false);
    expect(row(a.id).state).toBe("sent");
    const later = T0 + core.INVITE_TTL_MS + 60_000;
    const b = await store.createVendorInvite({ vendorId: VENDOR, actor: ACTOR, recipientName: "Ann Ar", email: EMAIL, siteBase: SITE, nowMs: later, mail: mailer, replaceExpired: true });
    expect(b.ok).toBe(true);
    expect(row(a.id).state).toBe("cancelled");
    expect(row(a.id).cancelled_by).toBe(ACTOR.id);
  });

  it("refuses a non-https site base (no link built, nothing written)", async () => {
    const r = await store.createVendorInvite({ vendorId: VENDOR, actor: ACTOR, recipientName: "Ann Ar", email: EMAIL, siteBase: "http://evil.example", nowMs: T0, mail: mailer });
    expect(r.ok).toBe(false);
    expect(rows()).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it("reports a failed email without losing the invite", async () => {
    mailFails = true;
    const r = await store.createVendorInvite({ vendorId: VENDOR, actor: ACTOR, recipientName: "Ann Ar", email: EMAIL, siteBase: SITE, nowMs: T0, mail: mailer });
    expect(r.ok && r.mailed).toBe(false);
    expect(rows()).toHaveLength(1);
  });
});

describe("sendVendorCode", () => {
  it("emails a 6-digit code to the invited address only, counts the send, stores only a digest", async () => {
    const i = await codeSent();
    expect(mails).toHaveLength(2);
    expect(mails[1].to).toEqual([EMAIL]);
    const code = lastCode();
    const r = row(i.id);
    expect(r.state).toBe("code_sent");
    expect(r.otp_sends).toBe(1);
    expect(String(r.otp_digest)).toMatch(/^[0-9a-f]{64}$/);
    expect(everythingWritten()).not.toContain(`"${code}"`);
  });

  it("enforces the 60-second resend cooldown, then allows a resend", async () => {
    const i = await codeSent();
    const early = await store.sendVendorCode({ invite: await fresh(i.id), nowMs: T0 + 1000 + 30_000, mail: mailer });
    expect(early.ok).toBe(false);
    expect(row(i.id).otp_sends).toBe(1);
    const ok = await store.sendVendorCode({ invite: await fresh(i.id), nowMs: T0 + 1000 + core.OTP_RESEND_COOLDOWN_MS + 1, mail: mailer });
    expect(ok.ok).toBe(true);
    expect(row(i.id).otp_sends).toBe(2);
  });

  it("a stale copy of the row (another tab already sent) is refused, not double counted", async () => {
    const i = await invited();
    const stale = await fresh(i.id);
    expect((await store.sendVendorCode({ invite: stale, nowMs: T0 + 1000, mail: mailer })).ok).toBe(true);
    const again = await store.sendVendorCode({ invite: stale, nowMs: T0 + 1000 + core.OTP_RESEND_COOLDOWN_MS + 1, mail: mailer });
    expect(again.ok).toBe(false);
    expect(row(i.id).otp_sends).toBe(1);
  });

  it("two tabs both in code_sent: only one resend counts (otp_sends compare-and-set)", async () => {
    const i = await codeSent();
    const tabA = await fresh(i.id);
    const tabB = await fresh(i.id);
    const later = T0 + 1000 + core.OTP_RESEND_COOLDOWN_MS + 1;
    expect((await store.sendVendorCode({ invite: tabA, nowMs: later, mail: mailer })).ok).toBe(true);
    const b = await store.sendVendorCode({ invite: tabB, nowMs: later, mail: mailer });
    expect(b.ok).toBe(false);
    expect(row(i.id).otp_sends).toBe(2);
    expect(mails).toHaveLength(3); // invite + 2 codes, not 4
  });

  it("refuses an expired link", async () => {
    const i = await invited();
    const r = await store.sendVendorCode({ invite: await fresh(i.id), nowMs: T0 + core.INVITE_TTL_MS + 1, mail: mailer });
    expect(r.ok).toBe(false);
    expect(row(i.id).otp_sends).toBe(0);
  });
});

describe("verifyVendorCode", () => {
  it("a wrong code is counted before the answer; the right code consents and binds this browser", async () => {
    const i = await codeSent();
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await store.verifyVendorCode({ invite: await fresh(i.id), typedCode: wrong, agreed: true, disclosureSha256Shown: store.currentVendorDisclosureSha256(), nowMs: T0 + 2000 });
    expect(bad.ok).toBe(false);
    expect(row(i.id).otp_attempts).toBe(1);
    expect(row(i.id).state).toBe("code_sent");
    const good = await store.verifyVendorCode({ invite: await fresh(i.id), typedCode: code, agreed: true, disclosureSha256Shown: store.currentVendorDisclosureSha256(), nowMs: T0 + 3000 });
    expect(good.ok).toBe(true);
    const r = row(i.id);
    expect(r.state).toBe("consented");
    expect(r.disclosure_version).toBe(core.VENDOR_ESIGN_DISCLOSURE_VERSION);
    expect(r.disclosure_sha256).toBe(store.currentVendorDisclosureSha256());
    expect(String(r.browser_digest)).toMatch(/^[0-9a-f]{64}$/);
    if (!good.ok) return;
    expect(everythingWritten()).not.toContain(good.cookie);
    const inv = await fresh(i.id);
    expect(store.browserMatches(inv, good.cookie)).toBe(true);
    expect(store.browserMatches(inv, (good.cookie[0] === "A" ? "B" : "A") + good.cookie.slice(1))).toBe(false);
    expect(store.browserMatches(inv, null)).toBe(false);
  });

  it("without 'I agree' nothing is counted or changed", async () => {
    const i = await codeSent();
    const r = await store.verifyVendorCode({ invite: await fresh(i.id), typedCode: lastCode(), agreed: false, disclosureSha256Shown: store.currentVendorDisclosureSha256(), nowMs: T0 + 2000 });
    expect(r.ok).toBe(false);
    expect(row(i.id).otp_attempts).toBe(0);
    expect(row(i.id).state).toBe("code_sent");
  });

  it("a disclosure hash other than the current one is refused (page changed while open)", async () => {
    const i = await codeSent();
    const r = await store.verifyVendorCode({ invite: await fresh(i.id), typedCode: lastCode(), agreed: true, disclosureSha256Shown: "0".repeat(64), nowMs: T0 + 2000 });
    expect(r.ok).toBe(false);
    expect(row(i.id).state).toBe("code_sent");
  });

  it("locks after the maximum wrong attempts; even the right code is then refused", async () => {
    const i = await codeSent();
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let k = 0; k < core.VENDOR_OTP_MAX_ATTEMPTS; k++) {
      await store.verifyVendorCode({ invite: await fresh(i.id), typedCode: wrong, agreed: true, disclosureSha256Shown: store.currentVendorDisclosureSha256(), nowMs: T0 + 2000 + k });
    }
    expect(row(i.id).otp_attempts).toBe(core.VENDOR_OTP_MAX_ATTEMPTS);
    const r = await store.verifyVendorCode({ invite: await fresh(i.id), typedCode: code, agreed: true, disclosureSha256Shown: store.currentVendorDisclosureSha256(), nowMs: T0 + 9000 });
    expect(r.ok).toBe(false);
    expect(row(i.id).state).toBe("code_sent");
  });

  it("an expired code (after 10 minutes) is refused and not counted", async () => {
    const i = await codeSent();
    const r = await store.verifyVendorCode({ invite: await fresh(i.id), typedCode: lastCode(), agreed: true, disclosureSha256Shown: store.currentVendorDisclosureSha256(), nowMs: T0 + 1000 + core.OTP_TTL_MS + 1 });
    expect(r.ok).toBe(false);
    expect(row(i.id).otp_attempts).toBe(0);
  });
});

describe("signVendorInvite", () => {
  it("signs: proof stored once (upsert false), two PDFs stored, RPC carries only ciphertext + last 4", async () => {
    const s = await signed();
    expect(s.result.ok).toBe(true);
    if (!s.result.ok) return;
    expect(s.result.authorizationId).toBe(AUTH_ID);
    expect(s.result.accountLast4).toBe("7788");
    expect(s.result.vendorName).toBe("Green Farm LLC");
    expect(st.uploads.map((u) => u.contentType)).toEqual(["image/jpeg", "application/pdf", "application/pdf"]);
    expect(st.uploads.every((u) => u.upsert === false)).toBe(true);
    const call = st.rpc.find((c) => c.fn === "vendor_esign_complete")!;
    const bank = call.body.p_bank as Record<string, string>;
    expect(bank.routing_enc).toMatch(/^encv1:/);
    expect(bank.account_enc).toMatch(/^encv1:/);
    expect(bank.account_last4).toBe("7788");
    expect(bank.routing_last4).toBe("0021");
    expect(bank.account_key_hmac).toMatch(/^[0-9a-f]{64}$/);
    const rpcText = JSON.stringify(st.rpc);
    expect(rpcText).not.toContain(ACCOUNT);
    expect(rpcText).not.toContain(ROUTING);
    // Phones normalised from two different formats.
    const form = call.body.p_form as Record<string, unknown>;
    expect(form.ar_phone).toBe("360-555-0100");
    expect(form.second_phone).toBe("360-555-0199");
    expect(form.state).toBe("WA");
    expect(form.ubi).toBe("604123456");
    // The hashes the RPC records are the hashes of the stored bytes.
    const rec = call.body.p_record as { storage_path: string; sha256: string; byte_size: number };
    const key = [...st.objects.keys()].find((k) => rec.storage_path.endsWith(k))!;
    const bytes = st.objects.get(key)!;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(rec.sha256);
    expect(bytes.length).toBe(rec.byte_size);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    // Proof row patched before signing.
    expect(row(s.id).proof_sha256).toBe(createHash("sha256").update(JPEG).digest("hex"));
    expect(row(s.id).proof_mime).toBe("image/jpeg");
  });

  it("a browser without the consent cookie is refused before anything is stored", async () => {
    const c = await consented();
    for (const cookie of [null, "x".repeat(43), (c.cookie[0] === "A" ? "B" : "A") + c.cookie.slice(1)]) {
      const r = await store.signVendorInvite(signInput(await fresh(c.id), cookie));
      expect(r.ok).toBe(false);
    }
    expect(st.uploads).toHaveLength(0);
    expect(st.rpc).toHaveLength(0);
  });

  it("consent older than 24 hours is refused (0262 VENDOR_ESIGN_STALE mirrored)", async () => {
    const c = await consented();
    const r = await store.signVendorInvite({ ...signInput(await fresh(c.id), c.cookie), nowMs: T0 + 2000 + 24 * 3600 * 1000 + 1 });
    expect(r.ok).toBe(false);
    expect(st.rpc).toHaveLength(0);
  });

  it("form errors come back per field; nothing stored", async () => {
    const c = await consented();
    const r = await store.signVendorInvite(signInput(await fresh(c.id), c.cookie, { form: { routing: "021000022", account2: "1", tin_last4: "123456789" }, intent: false, proof: null }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(expect.arrayContaining(["routing", "account2", "tin_last4", "intent", "proof"]));
    expect(st.uploads).toHaveLength(0);
    expect(st.rpc).toHaveLength(0);
  });

  it("a non-image proof is refused by byte sniffing; nothing stored", async () => {
    const c = await consented();
    const r = await store.signVendorInvite(signInput(await fresh(c.id), c.cookie, { proof: NOT_AN_IMAGE }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors?.proof).toBeTruthy();
    expect(st.uploads).toHaveLength(0);
  });

  it("an RPC failure removes both PDFs; the proof stays attached for the retry", async () => {
    const c = await consented();
    st.rpcReply = (fn) => (fn === "vendor_esign_complete" ? { status: 400, body: { code: "P0001", message: "VENDOR_ESIGN_STATE" } } : undefined);
    const r = await store.signVendorInvite(signInput(await fresh(c.id), c.cookie));
    expect(r.ok).toBe(false);
    const pdfKeys = st.uploads.filter((u) => u.contentType === "application/pdf").map((u) => u.key);
    expect(pdfKeys).toHaveLength(2);
    expect(st.removed.sort()).toEqual([...pdfKeys].sort());
    expect([...st.objects.keys()]).toHaveLength(1); // the proof
    expect(row(c.id).state).toBe("consented");
    // Retry without re-attaching works (proof already on the invite), no second proof upload.
    st.rpcReply = null;
    const again = await store.signVendorInvite(signInput(await fresh(c.id), c.cookie, { proof: null }));
    expect(again.ok).toBe(true);
    expect(st.uploads.filter((u) => u.contentType === "image/jpeg")).toHaveLength(1);
  });

  it("a second PDF upload failure removes the first and never calls the RPC", async () => {
    const c = await consented();
    st.uploadFailOn = 3; // proof, record, CERT fails
    const r = await store.signVendorInvite(signInput(await fresh(c.id), c.cookie));
    expect(r.ok).toBe(false);
    expect(st.removed).toEqual([st.uploads[1].key]);
    expect(st.rpc).toHaveLength(0);
  });

  it("a replaced proof removes the old object", async () => {
    const c = await consented();
    st.rpcReply = (fn) => (fn === "vendor_esign_complete" ? { status: 400, body: { code: "P0001", message: "VENDOR_ESIGN_STATE" } } : undefined);
    await store.signVendorInvite(signInput(await fresh(c.id), c.cookie));
    const firstProof = st.uploads[0].key;
    const other = new Uint8Array(JPEG);
    other[20] = 9;
    st.rpcReply = null;
    const r = await store.signVendorInvite(signInput(await fresh(c.id), c.cookie, { proof: other }));
    expect(r.ok).toBe(true);
    expect(st.removed).toContain(firstProof);
    expect(st.objects.has(firstProof)).toBe(false);
  });
});

describe("after signing", () => {
  it("notices go to the invited address AND the address on file, and to the owners", async () => {
    const s = await signed();
    if (!s.result.ok) throw new Error("not signed");
    mails = [];
    const n = await store.sendSignedNotices({ inviteId: s.id, result: s.result, ownersTo: ["stephen@greenway.example", "michael@greenway.example"], vendorPageUrl: `${SITE}/admin/vendors/${VENDOR}`, nowMs: T0, mail: mailer });
    expect(n).toEqual({ vendorMailed: true, ownersMailed: true });
    expect(mails[0].to.sort()).toEqual([EMAIL, "office@farm.example.com"].sort());
    expect(mails[1].to).toEqual(["stephen@greenway.example", "michael@greenway.example"]);
    expect(mails.map((m) => m.html).join("")).not.toContain(ACCOUNT);
  });

  it("the signed copy is only for the browser that signed", async () => {
    const s = await signed();
    const ok = await store.vendorSignedCopy(s.token, s.cookie);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(new TextDecoder().decode(ok.bytes.slice(0, 5))).toBe("%PDF-");
    expect((await store.vendorSignedCopy(s.token, null)).ok).toBe(false);
    expect((await store.vendorSignedCopy(s.token, "y".repeat(43))).ok).toBe(false);
    const flipped = (s.token[0] === "A" ? "B" : "A") + s.token.slice(1);
    expect((await store.vendorSignedCopy(flipped, s.cookie)).ok).toBe(false);
  });

  it("a tampered stored record is refused (SHA-256 re-checked on read)", async () => {
    const s = await signed();
    const doc = (st.db.tables.get("ach_authorization_documents") as Row[])[0];
    const key = [...st.objects.keys()].find((k) => String(doc.storage_path).endsWith(k))!;
    const b = st.objects.get(key)!;
    b[b.length - 2] ^= 1;
    expect((await store.vendorSignedCopy(s.token, s.cookie)).ok).toBe(false);
  });

  it("countersign is refused while the vault is on hold, and when released before signing; allowed after release", async () => {
    const s = await signed();
    const inv = await fresh(s.id);
    const cs = () => store.countersignVendorInvite({ invite: inv, actor: { id: ACTOR.id, name: ACTOR.name, email: "michael@greenway.example" }, title: "Owner", note: "Called Bob at 360-555-0199 (on file)", nowMs: T0 + 10_000, mail: mailer });
    const before = await cs();
    expect(before.ok).toBe(false);
    expect(st.rpc.filter((c) => c.fn === "vendor_esign_countersign")).toHaveLength(0);
    expect(st.uploads).toHaveLength(3); // no acceptance PDF stored for nothing
    const vault = (st.db.tables.get("vendor_bank_details") as Row[])[0];
    Object.assign(vault, { status: "active", released_by: RELEASER, released_at: inv.signed_at, release_mode: "dual", verified_at: inv.signed_at });
    expect((await cs()).ok).toBe(false); // released_at must be AFTER signed_at
    vault.released_at = new Date(Date.parse(inv.signed_at!) + 1).toISOString();
    const r = await cs();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mailed).toBe(true);
    expect(row(s.id).state).toBe("countersigned");
    const call = st.rpc.find((c) => c.fn === "vendor_esign_countersign")!;
    expect(call.body.p_actor).toBe(ACTOR.id);
    expect(mails[mails.length - 1].to).toEqual([EMAIL]);
  });

  it("countersign is refused when the vault numbers were edited after signing", async () => {
    const s = await signed();
    const vault = (st.db.tables.get("vendor_bank_details") as Row[])[0];
    const inv = await fresh(s.id);
    Object.assign(vault, { status: "active", released_by: RELEASER, released_at: new Date(T0 + 60_000).toISOString(), bank_account_number: "encv1:something-else" });
    const r = await store.countersignVendorInvite({ invite: inv, actor: { id: ACTOR.id, name: ACTOR.name, email: "m@x.example" }, title: "Owner", note: "", nowMs: T0 + 90_000, mail: mailer });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/vault no longer holds/);
  });

  it("countersign RPC failure removes the acceptance PDF", async () => {
    const s = await signed();
    const vault = (st.db.tables.get("vendor_bank_details") as Row[])[0];
    Object.assign(vault, { status: "active", released_by: RELEASER, released_at: new Date(T0 + 60_000).toISOString() });
    st.rpcReply = (fn) => (fn === "vendor_esign_countersign" ? { status: 400, body: { code: "P0001", message: "VENDOR_ESIGN_NOT_RELEASED" } } : undefined);
    const r = await store.countersignVendorInvite({ invite: await fresh(s.id), actor: { id: ACTOR.id, name: ACTOR.name, email: "m@x.example" }, title: "Owner", note: "", nowMs: T0 + 90_000, mail: mailer });
    expect(r.ok).toBe(false);
    expect(st.removed).toEqual([st.uploads[3].key]);
  });

  it("reject goes through the RPC only from signed", async () => {
    const s = await signed();
    const r = await store.rejectVendorInvite({ invite: await fresh(s.id), actorId: ACTOR.id, reason: "Name on account does not match" });
    expect(r.ok).toBe(true);
    expect(row(s.id).state).toBe("rejected");
    const again = await store.rejectVendorInvite({ invite: await fresh(s.id), actorId: ACTOR.id, reason: "again please" });
    expect(again.ok).toBe(false);
  });
});

describe("cancelVendorInvite", () => {
  it("cancels an open link and removes an uploaded-but-unsigned proof", async () => {
    const c = await consented();
    st.rpcReply = (fn) => (fn === "vendor_esign_complete" ? { status: 400, body: { code: "P0001", message: "VENDOR_ESIGN_STATE" } } : undefined);
    await store.signVendorInvite(signInput(await fresh(c.id), c.cookie));
    const proofKey = st.uploads[0].key;
    expect(st.objects.has(proofKey)).toBe(true);
    const r = await store.cancelVendorInvite({ invite: await fresh(c.id), actorId: ACTOR.id, reason: "Vendor asked to pay by mailed check", nowMs: T0 + 5000 });
    expect(r.ok).toBe(true);
    expect(row(c.id).state).toBe("cancelled");
    expect(st.objects.has(proofKey)).toBe(false);
    // The link is dead for the vendor now.
    expect((await store.signVendorInvite(signInput(await fresh(c.id), c.cookie))).ok).toBe(false);
  });

  it("needs a reason and cannot cancel a signed form", async () => {
    const i = await invited();
    expect((await store.cancelVendorInvite({ invite: await fresh(i.id), actorId: ACTOR.id, reason: "no", nowMs: T0 })).ok).toBe(false);
    expect(row(i.id).state).toBe("sent");
    const st2 = await signedOn(VENDOR2);
    expect((await store.cancelVendorInvite({ invite: await fresh(st2), actorId: ACTOR.id, reason: "long enough reason", nowMs: T0 })).ok).toBe(false);
  });
});

async function signedOn(vendorId: string): Promise<string> {
  const i = await invited(vendorId, "glass@glass.example.com");
  await store.sendVendorCode({ invite: await fresh(i.id), nowMs: T0 + 1000, mail: mailer });
  const v = await store.verifyVendorCode({ invite: await fresh(i.id), typedCode: lastCode(), agreed: true, disclosureSha256Shown: store.currentVendorDisclosureSha256(), nowMs: T0 + 2000 });
  if (!v.ok) throw new Error(v.error);
  const r = await store.signVendorInvite(signInput(await fresh(i.id), v.cookie, { form: { legal_name: "Glass Co", dba: "", name_on_account: "Glass Co", vendor_kind: "non_cannabis", license_no: "", ubi: "" } }));
  if (!r.ok) throw new Error(r.error + JSON.stringify(r.errors ?? {}));
  return i.id;
}

describe("vendorPageView", () => {
  it("stamps first_opened_at once and walks the steps with the cookie", async () => {
    const i = await invited();
    const v1 = await store.vendorPageView(i.token, null);
    expect(v1.kind).toBe("ok");
    if (v1.kind !== "ok") return;
    expect(v1.step).toBe("send_code");
    const opened = row(i.id).first_opened_at;
    expect(opened).toBeTruthy();
    await store.vendorPageView(i.token, null);
    expect(row(i.id).first_opened_at).toBe(opened);
    expect((await store.vendorPageView("x".repeat(43), null)).kind).toBe("invalid");
  });
});

describe("participationRows", () => {
  it("one row per vendor with vault state and open invite", async () => {
    await signedOn(VENDOR2);
    await invited(VENDOR);
    const p = await store.participationRows(T0 + 5000);
    expect(p.ready).toBe(true);
    const by = Object.fromEntries(p.rows.map((r) => [r.vendorId, r]));
    expect(by[VENDOR].invite).toBe("sent");
    expect(by[VENDOR].achActive).toBe(false);
    expect(by[VENDOR2].invite).toBe("signed");
    expect(by[VENDOR2].inviteExpired).toBe(false);
    const later = await store.participationRows(T0 + core.INVITE_TTL_MS + 60_000);
    const by2 = Object.fromEntries(later.rows.map((r) => [r.vendorId, r]));
    expect(by2[VENDOR].inviteExpired).toBe(true);
    expect(by2[VENDOR2].inviteExpired).toBe(false); // signed never "expires"
  });

  it("reports not ready when the invites table is missing (0262 not applied)", async () => {
    st.db.missing.add("vendor_esign_invites");
    const p = await store.participationRows(T0);
    expect(p.ready).toBe(false);
    expect(p.rows).toHaveLength(2);
  });
});
