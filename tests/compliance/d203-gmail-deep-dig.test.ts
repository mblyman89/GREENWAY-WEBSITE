/**
 * D203 - "I was able to get all but 4 manifests. they are in stephens email ... really deep dive and
 * dig deep to find these last four. either they go way back, or there is something tricky about them
 * ... they came via a json ... tune the email fetcher to find them please."
 *
 * The real deep-dig store over the shared in-memory PostgREST, an in-memory storage and a fake Gmail.
 * Pins the four tricky shapes found in the real mailbox: a JSON inside a .zip sent from a rep's own
 * Gmail and found only by a brand word; a JSON sent as a .txt in a REPLY in the thread; an old email
 * kept as "no documents" whose JSON is a Dropbox link (not a vendor host); and a delivery with nothing
 * in the mailbox (said plainly). Every question includes Spam and Trash. Fill-only, exact barcode,
 * only lab_result_id / updated_by change; emails re-read once (memory); behind inventory.manage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";
import type { GmailMessage, GmailPart } from "@/lib/compliance/ccrs-mail-core";
import type { HarvestIo } from "@/lib/pos/cultivera-mail-harvest-store";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  files: {} as Record<string, Buffer>,
  audits: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true, supabaseUrl: "https://x.supabase.co" }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => {
      const client = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) as unknown as Record<string, unknown>;
      client.storage = {
        from() {
          return {
            async download(key: string) {
              const b = st.files[key];
              return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found" } };
            },
            async upload(key: string, body: Buffer) {
              st.files[key] = Buffer.from(body);
              return { data: { path: key }, error: null };
            },
          };
        },
      };
      return client;
    },
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));

const deep = await import("@/lib/inventory/coa-gmail-deep-store");
const core = await import("@/lib/inventory/coa-gmail-deep-core");

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const MAILBOX = "stephen@greenwaymarijuana.com";
const mid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const lid = (m: number, k: number) => `11111111-0000-4000-8000-${(m * 100 + k).toString(16).padStart(12, "0")}`;
const vid = (n: number) => `22222222-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = Date.parse("2026-11-08T12:00:00Z");

function lot(m: number, k: number, code: string, name: string, extra: Row = {}): Row {
  return { id: lid(m, k), manifest_id: mid(m), lot_code: code, product_name: name, status: "active", lab_result_id: null, on_hand_qty: 5, updated_by: null, ...extra };
}
function delivery(n: number, vendor: string, license: string, number: string, date: string, email: string | null = null) {
  st.db.rows("vendors").push({ id: vid(n), display_name: vendor, license_number: license, email });
  st.db.rows("inbound_manifests").push({ id: mid(n), vendor_id: vid(n), manifest_number: number, vendor_label: vendor, transfer_date: date, received_at: null, created_at: `${date}T10:00:00Z` });
}

/** A WCIA transfer JSON with each item's own lab data. */
function wcia(items: Array<[string, string]>): string {
  return JSON.stringify({
    document_name: "WCIA Transfer Data",
    document_schema_version: "2.1.0",
    transfer_id: "T-1",
    from_license_number: "415700",
    to_license_number: "413541",
    inventory_transfer_items: items.map(([code, lab]) => ({
      inventory_id: code,
      product_name: `Product ${code}`,
      qty: "5",
      lab_result_data: { lab_result_id: lab, lab_name: "Confidence Analytics", lab_result_status: "passed", coa: `https://certs.conflabs.com/${lab}.pdf`, potency: [{ type: "thca", value: 24.1, unit_of_measure: "pct" }] },
    })),
  });
}

/** A minimal zip (one deflated entry). The reader does not check CRCs. */
function zipOf(name: string, text: string): Uint8Array {
  const data = zlib.deflateRawSync(Buffer.from(text));
  const nm = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(Buffer.byteLength(text), 22);
  local.writeUInt16LE(nm.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(Buffer.byteLength(text), 24);
  central.writeUInt16LE(nm.length, 28);
  central.writeUInt32LE(0, 42);
  const cdStart = local.length + nm.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nm.length, 12);
  end.writeUInt32LE(cdStart, 16);
  return new Uint8Array(Buffer.concat([local, nm, data, central, nm, end]));
}

type Fake = HarvestIo & { queries: string[]; opened: string[]; mail: Record<string, GmailMessage>; atts: Record<string, Uint8Array>; answers: Array<[RegExp, string[]]>; links: Record<string, string>; threads: Record<string, string[]> };

function fakeGmail(): Fake {
  const g: Fake = {
    queries: [],
    opened: [],
    mail: {},
    atts: {},
    answers: [],
    links: {},
    threads: {},
    token: async () => "tok",
    listPage: async (_t, q) => {
      g.queries.push(q);
      const ids = new Set<string>();
      for (const [re, list] of g.answers) if (re.test(q)) list.forEach((x) => ids.add(x));
      return { ids: [...ids], nextPageToken: null };
    },
    getMessage: async (_t, id) => {
      g.opened.push(id);
      const m = g.mail[id];
      if (!m) throw new Error(`Gmail messages.get ${id}: HTTP 404`);
      return m;
    },
    getAttachment: async (_t, _id, ref) => g.atts[ref.attachmentId ?? ""] ?? new Uint8Array(0),
    fetchLink: async (url) => (g.links[url] ? { ok: true, jsonText: g.links[url] } : { ok: false, error: "The link returned an error (HTTP 404)." }),
    readCursor: async () => null,
    saveCursor: async () => {},
    knownIds: async (ids) => new Set(st.db.rows("cultivera_mail_docs").filter((r) => ids.includes(r.gmail_id as string)).map((r) => r.gmail_id as string)),
    upload: async (key, bytes) => {
      st.files[key] = Buffer.from(bytes);
    },
    insertRows: async (rows) => {
      let n = 0;
      for (const r of rows) {
        if (st.db.rows("cultivera_mail_docs").some((x) => x.gmail_id === r.gmail_id && x.doc_index === r.doc_index)) continue; // ON CONFLICT DO NOTHING
        st.db.rows("cultivera_mail_docs").push({ id: `${r.gmail_id}-${r.doc_index}`, ...r });
        n += 1;
      }
      return n;
    },
    now: () => T0,
  };
  return g;
}

function mail(g: Fake, id: string, o: { from: string; subject: string; thread?: string; text?: string; html?: string; files?: Array<[string, string, Uint8Array]>; at?: string }) {
  const parts: GmailPart[] = [];
  if (o.text) parts.push({ mimeType: "text/plain", body: { data: Buffer.from(o.text).toString("base64url") } });
  if (o.html) parts.push({ mimeType: "text/html", body: { data: Buffer.from(o.html).toString("base64url") } });
  (o.files ?? []).forEach(([name, mime, bytes], i) => {
    g.atts[`${id}-${i}`] = bytes;
    parts.push({ mimeType: mime, filename: name, body: { attachmentId: `${id}-${i}`, size: bytes.length } });
  });
  g.mail[id] = {
    id,
    threadId: o.thread ?? id,
    internalDate: String(Date.parse(o.at ?? "2026-10-02T18:00:00Z")),
    payload: { mimeType: "multipart/mixed", headers: [{ name: "Subject", value: o.subject }, { name: "From", value: o.from }], parts },
  };
}

/** An email already kept by the first harvest as "no documents". */
function keptNoDocs(id: string, from: string, subject: string) {
  st.db.rows("cultivera_mail_docs").push({ id: `${id}-0`, mailbox: MAILBOX, gmail_id: id, doc_index: 0, email_at: "2026-10-12T19:23:00Z", from_header: from, subject, filename: "", kind: "none", source: "email", status: "no_documents", storage_key: null, barcodes: [] });
}

const labOf = (id: string) => st.db.rows("inventory_lots").find((l) => l.id === id)?.lab_result_id ?? null;
const opts = (g: Fake) => ({ io: g, mailbox: MAILBOX, now: () => T0, threadIds: async (_t: string, th: string) => g.threads[th] ?? [], fetchPdf: async () => ({ ok: false as const, error: "HTTP 404" }), readCoaPdf: async () => ({ certs: [], skipped: true, error: null }) });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.files = {};
  st.audits = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("D203 - Deep dig for the last deliveries", () => {
  it("finds a zipped JSON from a rep's own Gmail by brand word, and a .txt JSON in a thread reply; links fill-only", async () => {
    // ALIS GROUP sells as "Gasworks" / "Kool Faid": the legal name never appears in the email.
    delivery(1, "ALIS GROUP", "415700", "21055126467944359", "2026-10-02", "hector@gasworksco.com");
    st.db.rows("inventory_lots").push(
      lot(1, 0, "21054814886534329", "Kool Faid Nitro - Grapes Gone Wild - 1g AIO"),
      lot(1, 1, "21054814886534330", "Fetti Prerolls - Holy Grail Zours (H) - 2.5g"),
      lot(1, 2, "21054814886534331", "Kool Faid Nitro - Smerf Berries - 1g Tank", { lab_result_id: "keep-me" }),
      lot(1, 3, "21054814886534332", "Kool Faid Nitro - Unicorn Milk - 1g AIO"),
    );
    const g = fakeGmail();
    mail(g, "repZipMail01", { from: "Hector R <hectorgasworks@gmail.com>", subject: "Kool Faid order", thread: "thrA00000001", files: [["transfer.zip", "application/zip", zipOf("wcia transfer.json", wcia([["21054814886534329", "WA-LAB-29"], ["21054814886534331", "WA-LAB-31"]]))]] });
    mail(g, "repReply0001", { from: "Hector R <hectorgasworks@gmail.com>", subject: "Re: Kool Faid order", thread: "thrA00000001", files: [["json.txt", "text/plain", new TextEncoder().encode(wcia([["21054814886534330", "WA-LAB-30"]]))]] });
    g.threads.thrA00000001 = ["repZipMail01", "repReply0001"];
    g.answers.push([/"Kool Faid Nitro"/, ["repZipMail01"]]);

    const before = st.db.rows("inventory_lots").map((l) => ({ ...l, lab_result_id: undefined, updated_by: undefined }));
    const t = await deep.deepDigGmail(ACTOR, opts(g));
    expect(t.errors).toEqual([]);
    // The deep questions: Spam + Trash, the license, the vendor's brands.
    expect(g.queries.every((q) => q.endsWith("in:anywhere -in:chats"))).toBe(true);
    expect(g.queries.some((q) => q.startsWith('"415700" after:'))).toBe(true);
    expect(g.queries.some((q) => q.includes('"Kool Faid Nitro"') && q.includes('"Fetti Prerolls"'))).toBe(true);
    expect(g.queries.some((q) => q.includes("from:hector@gasworksco.com"))).toBe(true);
    // Both emails kept and re-read; the zip and the .txt became JSON documents at doc_index 100+.
    const docs = st.db.rows("cultivera_mail_docs").filter((r) => r.kind === "json");
    expect(docs.map((r) => r.gmail_id).sort()).toEqual(["repReply0001", "repZipMail01"]);
    expect(docs.every((r) => (r.doc_index as number) >= 100 && r.status === "parsed")).toBe(true);
    const d = t.deliveries[0];
    expect(d).toMatchObject({ newEmails: 2, threadMates: 1, newJson: 2, lotsBefore: 3, lotsAfter: 1 });
    expect(t.linkedFromJson).toBe(2);
    expect(labOf(lid(1, 0))).toBeTruthy();
    expect(labOf(lid(1, 1))).toBeTruthy();
    expect(labOf(lid(1, 2))).toBe("keep-me");
    expect(labOf(lid(1, 3))).toBeNull();
    expect(st.db.rows("inventory_lots").map((l) => ({ ...l, lab_result_id: undefined, updated_by: undefined }))).toEqual(before);
    for (const q of st.db.log.filter((w) => w.table === "inventory_lots" && w.method === "PATCH")) {
      expect(Object.keys(q.body as object).sort()).toEqual(["lab_result_id", "updated_by"]);
      expect(q.url.search).toContain("lab_result_id=is.null");
      expect(q.url.search).toContain("status=neq.destroyed");
    }
    expect(core.deepNote(t)).toContain("1 still missing");
    expect(st.audits.filter((a) => a.action === core.COA_GMAIL_DEEP_AUDIT)).toHaveLength(1);

    // A second click re-reads nothing it already dug.
    g.opened.length = 0;
    await deep.deepDigGmail(ACTOR, opts(g));
    expect(g.opened).toEqual([]);
  });

  it("re-opens an email kept as 'no documents' and fetches a Dropbox JSON link the transfer-link finder never took", async () => {
    delivery(2, "EVERGREEN HERBAL", "78256", "M07825651675", "2026-10-12");
    st.db.rows("inventory_lots").push(lot(2, 0, "07825682875", "MAJOR Shot - Blueberry - 100mg THC"), lot(2, 1, "07825682876", "BLAZE Gummy - Mango"));
    const g = fakeGmail();
    keptNoDocs("egScheduled1", "sales@forevergreenherbal.com", "Your Evergreen Herbal order has been scheduled for delivery!");
    const link = "https://www.dropbox.com/s/abc123/M07825651675.json?dl=1";
    mail(g, "egScheduled1", { from: "sales@forevergreenherbal.com", subject: "Your Evergreen Herbal order has been scheduled for delivery!", html: `<p>Your JSON: <a href="https://www.dropbox.com/s/abc123/M07825651675.json?dl=0">download</a></p><a href="https://forevergreenherbal.com/unsubscribe">u</a>` });
    g.links[link] = wcia([["07825682875", "EH-LAB-75"], ["07825682876", "EH-LAB-76"]]);
    g.answers.push([/"7825651675"/, ["egScheduled1"]]);
    const t = await deep.deepDigGmail(ACTOR, opts(g));
    expect(t.errors).toEqual([]);
    expect(g.queries.some((q) => q.includes('"07825651675"') && q.includes('"7825651675"'))).toBe(true);
    expect(t.deliveries[0]).toMatchObject({ newEmails: 0, reread: 1, newJson: 1, lotsAfter: 0 });
    expect(labOf(lid(2, 0))).toBeTruthy();
    expect(labOf(lid(2, 1))).toBeTruthy();
    expect(core.deepNote(t)).toContain("All 2 lots now have their COA");
    expect(core.deepTone(t)).toBe("ok");
  });

  it("nothing in the mailbox: says the JSON never reached it and links nothing", async () => {
    delivery(3, "GREEN RESEARCH NETWORK, LLC", "429047", "GF42904700003637", "2026-10-28");
    st.db.rows("inventory_lots").push(lot(3, 0, "GF42904705574845", "Frostco - Bubble Hash - GMO - 1g"));
    const g = fakeGmail();
    const t = await deep.deepDigGmail(ACTOR, opts(g));
    expect(t.errors).toEqual([]);
    expect(t.deliveries[0].matched).toBe(0);
    expect(labOf(lid(3, 0))).toBeNull();
    expect(core.deepNote(t)).toContain("was not sent to this mailbox");
    expect(g.queries.some((q) => q.includes('"Frostco"'))).toBe(true);
    expect(g.queries.some((q) => q.includes('"429047"'))).toBe(true);
  });

  it("one delivery only, and a mailbox that is not set up writes nothing", async () => {
    delivery(4, "MOUNTAIN HI", "412446", "GF41244600011042", "2026-10-23");
    delivery(5, "OTHER", "400000", "GF40000000000001", "2026-10-23");
    st.db.rows("inventory_lots").push(lot(4, 0, "GF41244605646594", "SMC - Infused Blunt"), lot(5, 0, "GF40000005000001", "Other - x"));
    const g = fakeGmail();
    const t = await deep.deepDigGmail(ACTOR, { ...opts(g), manifestIds: [mid(4)] });
    expect(t.deliveries.map((d) => d.manifestId)).toEqual([mid(4)]);
    expect(g.queries.some((q) => q.includes("GF40000000000001"))).toBe(false);
    const none = await deep.deepDigGmail(ACTOR, { io: null, setupError: "no Gmail sign-in" });
    expect(none.errors.join()).toContain("not set up");
  });

  it("unzips stored and deflated entries and ignores junk", () => {
    const z = deep.unzipEntries(zipOf("folder/t.json", '{"a":1}'));
    expect(z.map((e) => [e.name, new TextDecoder().decode(e.bytes)])).toEqual([["t.json", '{"a":1}']]);
    expect(deep.unzipEntries(new Uint8Array([1, 2, 3]))).toEqual([]);
  });
});

describe("D203 - wiring", () => {
  it("the Deep dig buttons are on Fix later behind inventory.manage, the self-test is registered", () => {
    const page = read("src/app/admin/inventory/fix-later/page.tsx");
    expect(page).toContain('data-testid="coa-gmail-deep-button"');
    expect(page).toContain('data-testid="coa-gmail-deep-delivery-button"');
    const actions = read("src/app/admin/inventory/fix-later/actions.ts");
    expect(actions).toMatch(/export async function deepDigGmailAction\(formData: FormData\) \{\n  const session = await requirePermission\("inventory\.manage"\);/);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("coa-gmail-deep-core", __runCoaGmailDeepCoreTests(), 45)');
    expect(read("src/lib/compliance/ccrs-mail-fetch.ts")).toContain("export async function getThreadMessageIds(");
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("D203");
  });
});
