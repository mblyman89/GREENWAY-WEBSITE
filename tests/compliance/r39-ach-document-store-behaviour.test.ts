/**
 * R39 S5 — ach-document-store behaviour, run for real:
 *   - the REAL store module over the REAL @supabase/postgrest-js client
 *     against FakePostgrest (tables, unique index, JSON path filter), with
 *     RPC calls captured at the HTTP layer;
 *   - a fake private bucket that refuses overwrites like upsert:false does;
 *   - unpdf's getFieldObjects answered by the real dumps of OUR filled forms
 *     (tests/fixtures/ach/*.fieldobjects.json, made with unpdf itself);
 *   - real AES-GCM (encryptSecret) and real HKDF/HMAC (keyed-hash).
 * Every write is inspected for bank numbers.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  objects: new Map<string, Uint8Array>(),
  removed: [] as string[],
  uploads: [] as { key: string; upsert: unknown; contentType: unknown }[],
  rpc: [] as { fn: string; body: Record<string, unknown> }[],
  rpcReply: null as null | ((fn: string, body: Record<string, unknown>) => { status: number; body: unknown }),
  fieldObjects: {} as unknown,
  vendorSaves: [] as Record<string, unknown>[],
  vendorSaveResult: { ok: true } as { ok: boolean; error?: string },
  llamaCalls: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true }));
vi.mock("unpdf", () => ({
  getDocumentProxy: async () => ({ getFieldObjects: async () => st.fieldObjects }),
}));
vi.mock("@/lib/payments/payee-banking-store", () => ({
  saveVendorBankDetails: async (p: Record<string, unknown>) => {
    st.vendorSaves.push(p);
    return st.vendorSaveResult.ok ? { ok: true, before: null, plan: {}, controlsReady: true } : { ok: false, error: st.vendorSaveResult.error };
  },
}));
vi.mock("@/lib/inbound-email/llamaparse-provider", () => ({
  isLlamaParseConfigured: () => true,
  parsePdf: async () => {
    st.llamaCalls += 1;
    return { ok: true, text: "Pay to the order of ... 021000021 ... 12345678", pages: [], confidence: null, pageCount: 1, note: null, via: "llamaparse", gate: { trusted: true, reason: "" }, error: null };
  },
}));
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
              createSignedUrl: async (key: string, secs: number) => ({ data: { signedUrl: `https://signed/${key}?e=${secs}` }, error: null }),
            };
          },
        },
      };
    },
  };
});

const store = await import("@/lib/payments/ach-document-store");
const core = await import("@/lib/payments/ach-document-intake-core");

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/ach/${n}.fieldobjects.json`, "utf8"));
const EMP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const VEN = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const ACTOR2 = "22222222-2222-4222-8222-222222222222";
const pdf = (tag: string) => new TextEncoder().encode(`%PDF-1.7\n${tag}\n%%EOF`);
const NUMBERS = ["021000021", "011000015", "12345678", "99990000"];

/** Every row and every RPC body, as one string, for leak checks. */
function everythingWritten(): string {
  return JSON.stringify({ tables: [...st.db.tables.entries()], rpc: st.rpc });
}

const A1 = { routing: "021000021", account: "12345678", accountType: "checking" as const, rule: { kind: "fixed" as const, cents: 20000 } };
const A2 = { routing: "011000015", account: "99990000", accountType: "savings" as const, rule: { kind: "remainder" as const } };

beforeEach(() => {
  process.env.DATA_ENCRYPTION_KEY = "behaviour-test-key-0123456789abcdef";
  st.db = new FakePostgrest();
  st.objects = new Map();
  st.removed = [];
  st.uploads = [];
  st.rpc = [];
  st.rpcReply = null;
  st.vendorSaves = [];
  st.vendorSaveResult = { ok: true };
  st.llamaCalls = 0;
  st.fieldObjects = fx("employee-filled");
  st.db.defaults.set("ach_authorization_documents", () => ({
    intake_status: "received",
    intake_note: null,
    authorization_id: null,
    archived_at: null,
    uploaded_at: "2026-01-20T10:00:00Z",
    employee_id: null,
    vendor_id: null,
  }));
  let ev = 0;
  st.db.defaults.set("ach_authorization_events", () => ({ occurred_at: `2026-01-20T10:00:${String((ev += 1) % 60).padStart(2, "0")}Z` }));
  st.db.uniques.push({ table: "ach_authorization_documents", columns: ["payee_type", "employee_id", "vendor_id", "sha256"], name: "ach_doc_sha_per_payee" });
  st.db.before = (req) => {
    if (!req.url.pathname.includes("/rpc/")) return;
    const fn = req.url.pathname.split("/").pop()!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    st.rpc.push({ fn, body });
    if (st.rpcReply) return st.rpcReply(fn, body);
    return { status: 200, body: fn === "ach_intake_accept_employee" ? "33333333-3333-4333-8333-333333333333" : null };
  };
});

async function drop(payeeType: "employee" | "vendor" = "employee", tag = "a", kind = "signed_form") {
  const r = await store.dropAchDocument({
    payeeType,
    payeeId: payeeType === "employee" ? EMP : VEN,
    kind,
    filename: "signed-form.pdf",
    declaredMime: "application/pdf",
    bytes: pdf(tag),
    actorId: ACTOR,
  });
  if (!r.ok) throw new Error(r.error);
  return r.document;
}

describe("drop", () => {
  it("stores under an app key with upsert false, writes the row and a number-free event", async () => {
    const d = await drop();
    expect(st.uploads).toHaveLength(1);
    expect(st.uploads[0].upsert).toBe(false);
    expect(st.uploads[0].contentType).toBe("application/pdf");
    expect(st.uploads[0].key).toMatch(new RegExp(`^employee/${EMP}/[0-9a-f-]{36}\\.pdf$`));
    expect(d.storage_path).toBe(`ach-docs/${st.uploads[0].key}`);
    expect(d.sha256).toBe(createHash("sha256").update(pdf("a")).digest("hex"));
    expect(d.original_filename).toBe("signed-form.pdf");
    const ev = st.db.rows("ach_authorization_events");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event_kind: "document_dropped", employee_id: EMP, actor_id: ACTOR });
    expect((ev[0].detail as Row).document_id).toBe(d.id);
  });
  it("refuses the same file twice before storing a second copy", async () => {
    await drop();
    const r = await store.dropAchDocument({ payeeType: "employee", payeeId: EMP, kind: "signed_form", filename: "again.pdf", declaredMime: "application/pdf", bytes: pdf("a"), actorId: ACTOR });
    expect(r).toEqual({ ok: false, error: core.intakeDbErrorMessage("ach_doc_sha_per_payee") });
    expect(st.uploads).toHaveLength(1);
  });
  it("refuses a file that is not what it claims, storing nothing", async () => {
    const r = await store.dropAchDocument({ payeeType: "employee", payeeId: EMP, kind: "signed_form", filename: "form.pdf", declaredMime: "application/pdf", bytes: new TextEncoder().encode("MZ\x90\x00 not a pdf"), actorId: ACTOR });
    expect(r.ok).toBe(false);
    expect(st.uploads).toHaveLength(0);
    expect(st.db.rows("ach_authorization_documents")).toHaveLength(0);
  });
  it("removes the stored object when the row cannot be written", async () => {
    st.db.missing.add("ach_authorization_documents");
    const r = await store.dropAchDocument({ payeeType: "employee", payeeId: EMP, kind: "signed_form", filename: "f.pdf", declaredMime: "application/pdf", bytes: pdf("z"), actorId: ACTOR });
    expect(r.ok).toBe(false);
    // the dup probe already hits the missing table, so nothing is uploaded at all
    expect(st.uploads).toHaveLength(0);
    st.db.missing.delete("ach_authorization_documents");
    st.db.before = (req) => (req.method === "POST" && req.table === "ach_authorization_documents" ? { status: 400, body: { code: "23514", message: "check violation" } } : undefined);
    const r2 = await store.dropAchDocument({ payeeType: "employee", payeeId: EMP, kind: "signed_form", filename: "f.pdf", declaredMime: "application/pdf", bytes: pdf("z"), actorId: ACTOR });
    expect(r2.ok).toBe(false);
    expect(st.uploads).toHaveLength(1);
    expect(st.removed).toEqual([st.uploads[0].key]);
    expect(st.objects.size).toBe(0);
  });
});

describe("read", () => {
  it("refuses a stored file whose bytes changed since the drop", async () => {
    const d = await drop();
    st.objects.set(core.objectKeyFromStoragePath(d.storage_path)!, pdf("tampered"));
    const r = await store.readDraft(d);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/no longer matches the fingerprint/);
  });
  it("gives a 120-second signed link only for app paths", async () => {
    const d = await drop();
    const r = await store.signedAchDocumentUrl(d);
    expect(r.ok && r.url).toMatch(/\?e=120$/);
    const bad = await store.signedAchDocumentUrl({ ...d, storage_path: "ach-docs/../x.pdf" });
    expect(bad.ok).toBe(false);
  });
});

describe("extract", () => {
  it("our filled form: event records a usable summary with no numbers; status -> extracted", async () => {
    const d = await drop();
    const r = await store.extractAchDocument({ doc: d, actorId: ACTOR, actorEmail: null, useLlamaParse: true });
    expect(r.ok).toBe(true);
    expect(st.llamaCalls).toBe(0); // our own form never leaves the server
    const ev = st.db.rows("ach_authorization_events").find((e) => e.event_kind === "document_extracted")!;
    expect(ev.detail).toMatchObject({ document_id: d.id, source: "acroform", form_kind: "employee", accounts: 2, usable: true });
    expect(st.db.rows("ach_authorization_documents")[0].intake_status).toBe("extracted");
    for (const n of NUMBERS) expect(everythingWritten()).not.toContain(n);
  });
  it("a scan goes to LlamaParse only on opt-in, and only fingerprints are kept", async () => {
    st.fieldObjects = {};
    const d = await drop();
    await store.extractAchDocument({ doc: d, actorId: ACTOR, actorEmail: null, useLlamaParse: false });
    expect(st.llamaCalls).toBe(0);
    const d2 = (await store.getAchDocument(d.id))!;
    const r = await store.extractAchDocument({ doc: d2, actorId: ACTOR, actorEmail: null, useLlamaParse: true });
    expect(r.ok).toBe(true);
    expect(st.llamaCalls).toBe(1);
    const evs = st.db.rows("ach_authorization_events").filter((e) => e.event_kind === "document_extracted");
    const last = evs[evs.length - 1].detail as Row;
    expect(last.source).toBe("llamaparse");
    expect((last.routing_fingerprints as string[]).length).toBe(1);
    expect((last.routing_fingerprints as string[])[0]).toMatch(/^[0-9a-f]{64}$/);
    for (const n of NUMBERS) expect(everythingWritten()).not.toContain(n);
  });
});

describe("blind re-key and accept (employee)", () => {
  const base = { bankNames: ["Test Bank", "Other Bank"], signedOnRaw: "2026-01-15", payeeName: "Test Person", replaceOpen: false };

  it("an entry that matches the form is accepted in one atomic 0260 call, encrypted and keyed", async () => {
    const d = await drop();
    const r = await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR, accounts: [A1, A2] });
    expect(r).toMatchObject({ ok: true, done: true });
    expect(st.rpc).toHaveLength(1);
    const call = st.rpc[0];
    expect(call.fn).toBe("ach_intake_accept_employee");
    expect(call.body).toMatchObject({ p_document_id: d.id, p_actor: ACTOR, p_signed_on: "2026-01-15", p_basis: "matches_form", p_replace_open: false });
    const rows = call.body.p_accounts as Row[];
    expect(rows.map((x) => x.priority)).toEqual([1, 2]);
    expect(rows.map((x) => x.account_last4)).toEqual(["5678", "0000"]);
    for (const x of rows) {
      expect(String(x.routing_enc)).toMatch(/^encv1:/);
      expect(String(x.account_enc)).toMatch(/^encv1:/);
      expect(String(x.account_key_hmac)).toMatch(/^[0-9a-f]{64}$/);
    }
    // the HMAC is the HKDF account-key purpose over the normalised key
    const { keyedHasher } = await import("@/lib/security/keyed-hash");
    const { normalizeAccountKey } = await import("@/lib/payments/ach-authorization-core");
    expect(rows[0].account_key_hmac).toBe(keyedHasher("achAccountKey")!(normalizeAccountKey("021000021", "12345678", "checking")));
    expect(st.db.rows("ach_authorization_accounts")).toHaveLength(0); // never written outside the function
    for (const n of NUMBERS) expect(everythingWritten()).not.toContain(n);
  });

  it("a wrong entry is held as a fingerprint; the next disagreeing pair is refused; no accept", async () => {
    const d = await drop();
    const wrong = [{ ...A1, account: "12345679" }, A2];
    const r1 = await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR, accounts: wrong });
    expect(r1).toMatchObject({ ok: true, done: false });
    expect(r1.ok && r1.message).toContain("account 1 account number");
    const mm = st.db.rows("ach_authorization_events").filter((e) => e.event_kind === "document_rekey_mismatch");
    expect(mm).toHaveLength(1);
    expect(core.parseFingerprint((mm[0].detail as Row).fingerprint)).not.toBeNull();
    // second, agreeing with the first but not with the form -> form_disagrees, pairing reset
    const r2 = await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR2, accounts: wrong });
    expect(r2.ok && r2.message).toMatch(/form's own filled-in fields/);
    const mm2 = st.db.rows("ach_authorization_events").filter((e) => e.event_kind === "document_rekey_mismatch");
    expect((mm2[1].detail as Row).fingerprint).toBeNull();
    expect(st.rpc).toHaveLength(0);
    for (const n of ["12345679", ...NUMBERS]) expect(everythingWritten()).not.toContain(n);
  });

  it("the account-key HMAC is over the normalised key (leading zeros and spacing do not create a second identity)", async () => {
    st.fieldObjects = fx("employee-blank");
    const d = await drop();
    const Z1 = { ...A1, account: "0012 345-678" };
    expect(await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR, accounts: [Z1, A2] })).toMatchObject({ ok: true, done: false });
    expect(await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR2, accounts: [Z1, A2] })).toMatchObject({ ok: true, done: true });
    const rows = st.rpc[0].body.p_accounts as Row[];
    const { keyedHasher } = await import("@/lib/security/keyed-hash");
    const { normalizeAccountKey } = await import("@/lib/payments/ach-authorization-core");
    const ak = keyedHasher("achAccountKey")!;
    expect(rows[0].account_key_hmac).toBe(ak(normalizeAccountKey("021000021", "12345678", "checking")));
    expect(rows[0].account_key_hmac).not.toBe(ak("021000021:0012 345-678:checking"));
  });

  it("no usable draft: two agreeing blind entries are needed, then accept on two_blind_entries", async () => {
    st.fieldObjects = fx("employee-blank");
    const d = await drop();
    const r1 = await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR, accounts: [A1, A2] });
    expect(r1).toMatchObject({ ok: true, done: false });
    expect(st.rpc).toHaveLength(0);
    const r2 = await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR2, accounts: [A1, A2] });
    expect(r2).toMatchObject({ ok: true, done: true });
    expect(st.rpc[0].body.p_basis).toBe("two_blind_entries");
  });

  it("refuses before any write: no key, bad split, future date, supporting document, decided document", async () => {
    const d = await drop();
    delete process.env.DATA_ENCRYPTION_KEY;
    const noKey = await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR, accounts: [A1, A2] });
    expect(noKey).toMatchObject({ ok: false });
    // The store's own guard (before any read), not the later planAccountRows backstop.
    expect((noKey as { error: string }).error).toMatch(/cannot be fingerprinted or stored/);
    process.env.DATA_ENCRYPTION_KEY = "behaviour-test-key-0123456789abcdef";
    expect((await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR, accounts: [A1] })).ok).toBe(false); // no remainder
    expect((await store.rekeyAndMaybeAccept({ ...base, signedOnRaw: "2999-01-01", doc: d, actorId: ACTOR, accounts: [A1, A2] })).ok).toBe(false);
    expect((await store.rekeyAndMaybeAccept({ ...base, doc: { ...d, kind: "voided_check" }, actorId: ACTOR, accounts: [A1, A2] })).ok).toBe(false);
    expect((await store.rekeyAndMaybeAccept({ ...base, doc: { ...d, intake_status: "accepted" }, actorId: ACTOR, accounts: [A1, A2] })).ok).toBe(false);
    expect(st.rpc).toHaveLength(0);
    expect(st.db.rows("ach_authorization_events").filter((e) => e.event_kind !== "document_dropped")).toHaveLength(0);
  });

  it("a database refusal comes back as a sentence", async () => {
    const d = await drop();
    st.rpcReply = () => ({ status: 400, body: { code: "23514", message: "ACH_INTAKE_OPEN_EXISTS: this employee already has an open authorization" } });
    const r = await store.rekeyAndMaybeAccept({ ...base, doc: d, actorId: ACTOR, accounts: [A1, A2] });
    expect(r).toEqual({ ok: false, error: core.intakeDbErrorMessage("ACH_INTAKE_OPEN_EXISTS") });
  });
});

describe("vendor accept and reject", () => {
  it("vendor: vault save (on hold) first, then the document is closed", async () => {
    st.fieldObjects = fx("vendor-filled");
    st.db.rows("vendors").push({ id: VEN, display_name: "Test Vendor LLC", legal_name: null });
    const d = await drop("vendor");
    const acct = { routing: "021000021", account: "12345678", accountType: "checking" as const, rule: { kind: "remainder" as const } };
    const r = await store.rekeyAndMaybeAccept({ doc: d, actorId: ACTOR, accounts: [acct], bankNames: ["Test Bank"], signedOnRaw: "2026-01-15", payeeName: "", replaceOpen: false });
    expect(r).toMatchObject({ ok: true, done: true });
    expect(st.vendorSaves).toHaveLength(1);
    expect(st.vendorSaves[0]).toMatchObject({ vendorId: VEN, vendorName: "Test Vendor LLC", routing: "021000021", accountNumber: "12345678", accountType: "checking" });
    expect(st.rpc).toHaveLength(1);
    expect(st.rpc[0]).toMatchObject({ fn: "ach_intake_finish", body: { p_outcome: "accepted", p_detail: { basis: "matches_form", account_last4: ["5678"] } } });
    for (const n of NUMBERS) expect(everythingWritten()).not.toContain(n);
  });
  it("vendor: a failed vault save leaves the document open", async () => {
    st.fieldObjects = fx("vendor-filled");
    st.vendorSaveResult = { ok: false, error: "vault said no" };
    const d = await drop("vendor");
    const acct = { routing: "021000021", account: "12345678", accountType: "checking" as const, rule: { kind: "remainder" as const } };
    const r = await store.rekeyAndMaybeAccept({ doc: d, actorId: ACTOR, accounts: [acct], bankNames: [""], signedOnRaw: "2026-01-15", payeeName: "", replaceOpen: false });
    expect(r).toEqual({ ok: false, error: "vault said no" });
    expect(st.rpc).toHaveLength(0);
  });
  it("reject calls ach_intake_finish with the reason", async () => {
    const d = await drop();
    const r = await store.rejectAchDocument({ doc: d, actorId: ACTOR, reason: "Unsigned: the signature line is blank." });
    expect(r).toEqual({ ok: true });
    expect(st.rpc[0]).toMatchObject({ fn: "ach_intake_finish", body: { p_outcome: "rejected", p_note: "Unsigned: the signature line is blank." } });
  });
});
