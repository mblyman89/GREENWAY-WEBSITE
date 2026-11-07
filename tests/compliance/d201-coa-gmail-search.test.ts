/**
 * D201 - "They will be in Stephen's Gmail address. Please build me a targeted search for his email
 * address ... Either the COA's will be PDFs, or they will be a url inside the json ... Two buttons if
 * possible, a fetch and attach buttons ... Let me click a missing coa product and have that be a
 * targeted search maybe for one off products that are stubborn?"
 *
 * The real store over the shared in-memory PostgREST, an in-memory storage, a fake Gmail (the
 * harvester's HarvestIo) and an injected PDF reader. Pins: the search asks exact questions per
 * delivery and keeps new emails through the existing harvester; deliveries fully covered by a kept
 * JSON are not searched; Attach links by the JSON's own lab data, then by a certificate whose printed
 * id IS the barcode (never a name); two certificates for one barcode are left alone; fill-only
 * (a COA is never replaced, a destroyed lot never touched, only lab_result_id/updated_by change);
 * the PDF is filed in `coa`; a preview writes nothing; the one-product search answers plainly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";
import type { GmailMessage } from "@/lib/compliance/ccrs-mail-core";
import type { HarvestIo } from "@/lib/pos/cultivera-mail-harvest-store";
import type { CoaCertificate } from "@/lib/inventory/coa-bundle-core";
import type { ReadCoaPdf } from "@/lib/inventory/coa-gmail-search-store";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  files: {} as Record<string, Buffer>,
  uploads: [] as Array<{ bucket: string; key: string }>,
  audits: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => {
      const client = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }) as unknown as Record<string, unknown>;
      client.storage = {
        from(bucket: string) {
          return {
            async download(key: string) {
              const b = st.files[key];
              return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found" } };
            },
            async upload(key: string, body: Buffer) {
              st.uploads.push({ bucket, key });
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

const store = await import("@/lib/inventory/coa-gmail-search-store");
const core = await import("@/lib/inventory/coa-gmail-search-core");

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const MAILBOX = "stephen@greenwaymarijuana.com";
const mid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const lid = (m: number, k: number) => `11111111-0000-4000-8000-${(m * 100 + k).toString(16).padStart(12, "0")}`;
const bc = (n: number) => `GF419690061844${String(n).padStart(2, "0")}`;
const T0 = Date.parse("2026-11-08T12:00:00Z");

function lot(m: number, k: number, code: string, extra: Row = {}): Row {
  return {
    id: lid(m, k),
    manifest_id: mid(m),
    lot_code: code,
    product_name: `Product ${code}`,
    status: "active",
    lab_result_id: null,
    on_hand_qty: 10,
    unit_cost_minor_units: 800,
    ccrs_inventory_id: `CCRS-${m}-${k}`,
    updated_by: null,
    ...extra,
  };
}

function manifest(n: number, vendor: string, number: string, date = "2026-10-21") {
  st.db.rows("inbound_manifests").push({ id: mid(n), manifest_number: number, vendor_label: vendor, transfer_date: date, received_at: null, created_at: `${date}T10:00:00Z` });
}

function cert(labId: string, ids: string[], extra: Partial<CoaCertificate> = {}): CoaCertificate {
  return {
    key: `x#${labId}`,
    docLabel: "QA.pdf",
    template: "growflow-qa",
    labName: "Confidence Analytics",
    labSampleId: labId,
    ids: [labId, ...ids],
    sampleName: "Blue Dream",
    productType: "Flower",
    passed: true,
    totalThcPct: 24.1,
    totalCbdPct: 0.1,
    totalCannabinoidsPct: 27,
    potency: { thca: 26.5 },
    testedOn: "2026-10-01",
    releasedOn: "2026-10-02",
    identifiable: true,
    reason: null,
    ...extra,
  };
}

/** PDF bytes carry a tag the fake reader turns into certificates. */
const pdfBytes = (tag: string) => new TextEncoder().encode(`%PDF-1.4\n% ${tag}\n%%EOF\n`);
const CERTS: Record<string, CoaCertificate[]> = {};
const fakeReader: ReadCoaPdf = async (bytes) => {
  const tag = new TextDecoder().decode(bytes).match(/% (\S+)/)?.[1] ?? "";
  const certs = CERTS[tag];
  return certs ? { certs, skipped: false, error: null } : { certs: [], skipped: true, error: null };
};

function pdfMail(id: string, subject: string, files: Array<[string, string]>): { m: GmailMessage; atts: Record<string, Uint8Array> } {
  const atts: Record<string, Uint8Array> = {};
  const parts = files.map(([name, tag], i) => {
    const b = pdfBytes(tag);
    atts[`${id}-${i}`] = b;
    return { mimeType: "application/pdf", filename: name, body: { attachmentId: `${id}-${i}`, size: b.length } };
  });
  return {
    m: {
      id,
      internalDate: String(Date.parse("2026-10-21T18:00:00Z")),
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "Subject", value: subject },
          { name: "From", value: "orders@growflow.com" },
        ],
        parts: parts as NonNullable<GmailMessage["payload"]>[],
      },
    },
    atts,
  };
}

type FakeGmail = HarvestIo & { queries: string[]; opened: string[]; mail: Record<string, GmailMessage>; atts: Record<string, Uint8Array>; answers: Array<[RegExp, string[]]> };

function fakeGmail(): FakeGmail {
  const g: FakeGmail = {
    queries: [],
    opened: [],
    mail: {},
    atts: {},
    answers: [],
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
    fetchLink: async () => ({ ok: false, error: "HTTP 404" }),
    readCursor: async () => null,
    saveCursor: async () => {},
    knownIds: async (ids) => new Set(st.db.rows("cultivera_mail_docs").filter((r) => ids.includes(r.gmail_id as string)).map((r) => r.gmail_id as string)),
    upload: async (key, bytes) => {
      st.files[key] = Buffer.from(bytes);
    },
    insertRows: async (rows) => {
      for (const r of rows) st.db.rows("cultivera_mail_docs").push({ id: `${r.gmail_id}-${r.doc_index}`, ...r });
      return rows.length;
    },
    now: () => T0,
  };
  return g;
}

function addMail(g: FakeGmail, id: string, subject: string, files: Array<[string, string]>) {
  const { m, atts } = pdfMail(id, subject, files);
  g.mail[id] = m;
  Object.assign(g.atts, atts);
}

/** A kept vendor JSON (already harvested) with each line's own lab data and COA url. */
function keptJson(id: string, items: Array<[string, string]>) {
  const key = `mail-harvest/stephen_greenwaymarijuana.com/${id}/1-transfer.json`;
  st.files[key] = Buffer.from(
    JSON.stringify({
      document_name: "WCIA Transfer Data",
      document_schema_version: "2.1.0",
      transfer_id: `T-${id}`,
      from_license_number: "412345",
      to_license_number: "423456",
      inventory_transfer_items: items.map(([code, lab]) => ({
        inventory_id: code,
        product_name: `Product ${code}`,
        qty: "10",
        lab_result_data: { lab_result_id: lab, lab_name: "Confidence Analytics", lab_result_status: "passed", coa: `https://certs.conflabs.com/${lab}.pdf`, potency: [{ type: "thca", value: 24.1, unit_of_measure: "pct" }] },
      })),
    }),
  );
  st.db.rows("cultivera_mail_docs").push({
    id: `${id}-1`,
    mailbox: MAILBOX,
    gmail_id: id,
    doc_index: 1,
    email_at: "2026-10-21T18:00:00Z",
    subject: "VENDOR - Invoice for Order# - 9 - GREENWAY MARIJUANA (with COA and Manifest)",
    filename: "1-transfer.json",
    kind: "link-json",
    status: "parsed",
    source_format: "wcia",
    storage_key: key,
    manifest_number: null,
    barcodes: items.map(([c]) => c),
  });
}

const labOf = (id: string) => st.db.rows("inventory_lots").find((l) => l.id === id)?.lab_result_id ?? null;
const deps = (g: FakeGmail | null) => ({ io: g, mailbox: MAILBOX, readCoaPdf: fakeReader, now: () => T0 });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.files = {};
  st.uploads = [];
  st.audits = [];
  for (const k of Object.keys(CERTS)) delete CERTS[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("D201 - Search Gmail for the missing COAs", () => {
  it("asks exact questions per delivery, keeps new emails through the harvester, remembers them, skips covered deliveries", async () => {
    manifest(1, "CLARITY FARMS LLC", "M0782565100");
    manifest(2, "SUNNY GROW", "M0782565200");
    st.db.rows("inventory_lots").push(lot(1, 0, bc(1)), lot(1, 1, bc(2)), lot(2, 0, bc(3)));
    keptJson("jsonMail0001", [[bc(3), "LAB-3"]]); // delivery 2 fully covered by a kept JSON
    const g = fakeGmail();
    addMail(g, "qaMail00001", "New order INV-1", [["QA_1.pdf", "certA"], ["Invoice_1.pdf", "inv"]]);
    g.answers.push([/M0782565100/, ["qaMail00001"]], [new RegExp(bc(1)), ["qaMail00001"]]);
    const t = await store.searchGmailForCoas(ACTOR, deps(g));
    expect(t.errors).toEqual([]);
    expect(t).toMatchObject({ deliveries: 2, coveredAlready: 1, searched: 1, matched: 1, newEmails: 1 });
    expect(g.queries.some((q) => q.includes('"M0782565100"'))).toBe(true);
    expect(g.queries.some((q) => q.includes(`"${bc(1)}"`) && q.includes(`"${bc(2)}"`))).toBe(true);
    expect(g.queries.some((q) => q.includes('"CLARITY FARMS"') && q.includes("after:") && q.includes("before:"))).toBe(true);
    expect(g.queries.some((q) => q.includes("M0782565200"))).toBe(false);
    // Kept by the existing harvester (pos-raw key + cultivera_mail_docs rows).
    const kept = st.db.rows("cultivera_mail_docs").filter((r) => r.gmail_id === "qaMail00001");
    expect(kept.map((r) => r.filename).sort()).toEqual(["Invoice_1.pdf", "QA_1.pdf"]);
    expect(kept.every((r) => String(r.storage_key).startsWith("mail-harvest/"))).toBe(true);
    const setting = st.db.rows("site_settings").find((x) => x.key === core.COA_GMAIL_SETTING_KEY);
    const state = core.parseGmailSearchState(setting?.value_json);
    expect(state.hits[mid(1)]?.ids).toEqual(["qaMail00001"]);
    expect(st.audits.filter((a) => a.action === core.COA_GMAIL_FETCH_AUDIT)).toHaveLength(1);
    // A second click opens nothing again.
    g.opened.length = 0;
    const t2 = await store.searchGmailForCoas(ACTOR, deps(g));
    expect(g.opened).toEqual([]);
    expect(t2).toMatchObject({ newEmails: 0, alreadyKept: 1 });
  });

  it("says plainly when the mailbox is not set up and writes nothing", async () => {
    manifest(1, "CLARITY", "M0782565100");
    st.db.rows("inventory_lots").push(lot(1, 0, bc(1)));
    const t = await store.searchGmailForCoas(ACTOR, { io: null, setupError: "no Gmail sign-in" });
    expect(t.errors.join()).toContain("not set up");
    expect(st.db.rows("site_settings")).toHaveLength(0);
  });
});

describe("D201 - Attach COAs from Gmail", () => {
  async function scenario() {
    manifest(1, "CLARITY FARMS", "M0782565100");
    st.db.rows("inventory_lots").push(
      lot(1, 0, bc(1)), // in a kept JSON
      lot(1, 1, bc(2)), // on a QA PDF certificate
      lot(1, 2, bc(3)), // two different certificates name it: left alone
      lot(1, 3, bc(4), { lab_result_id: "keep-me" }), // never replaced
      lot(1, 4, bc(5), { status: "destroyed" }), // never touched
      lot(1, 5, bc(6)), // nowhere
      lot(1, 6, "Blue Dream"), // a name, never matched
    );
    keptJson("jsonMail0001", [[bc(1), "LAB-1"]]);
    CERTS.certA = [cert("WA-261001-001", [bc(2), bc(4), bc(5), "BLUE DREAM"]), cert("WA-261001-002", [bc(3)])];
    CERTS.certB = [cert("WA-261001-099", [bc(3)])];
    const g = fakeGmail();
    addMail(g, "qaMail00001", "New order INV-1", [["QA_1.pdf", "certA"], ["Invoice_1.pdf", "certB"]]);
    addMail(g, "qaMail00002", "New order INV-2", [["QA_2.pdf", "certB"]]);
    g.answers.push([/M0782565100/, ["qaMail00001", "qaMail00002"]]);
    await store.searchGmailForCoas(ACTOR, deps(g));
    st.audits.length = 0;
    st.db.log.length = 0;
  }

  it("links from the JSON's lab data, then by a certificate printing the exact barcode; fill-only; files the PDF", async () => {
    await scenario();
    const before = st.db.rows("inventory_lots").map((l) => ({ ...l, lab_result_id: undefined, updated_by: undefined }));
    const t = await store.attachCoasFromGmail(ACTOR, { ...deps(null) });
    expect(t.errors).toEqual([]);
    expect(t).toMatchObject({ linkedFromJson: 1, linkedFromPdf: 1, ambiguous: 1, stillMissing: 3, pdfsFiled: 1 });
    expect(labOf(lid(1, 0))).toBeTruthy();
    expect(labOf(lid(1, 1))).toBeTruthy();
    expect(labOf(lid(1, 2))).toBeNull(); // ambiguous
    expect(labOf(lid(1, 3))).toBe("keep-me");
    expect(labOf(lid(1, 4))).toBeNull();
    expect(labOf(lid(1, 5))).toBeNull();
    expect(labOf(lid(1, 6))).toBeNull();
    expect(st.db.rows("inventory_lots").map((l) => ({ ...l, lab_result_id: undefined, updated_by: undefined }))).toEqual(before);
    for (const q of st.db.log.filter((w) => w.table === "inventory_lots" && w.method !== "GET" && w.method !== "HEAD")) {
      expect(Object.keys(q.body as object).sort()).toEqual(["lab_result_id", "updated_by"]);
      expect(q.url.search).toContain("lab_result_id=is.null");
      expect(q.url.search).toContain("status=neq.destroyed");
    }
    const labs = st.db.rows("lab_results");
    expect(labs.map((r) => r.labtest_external_identifier).sort()).toEqual(["LAB-1", "WA-261001-001"]);
    const pdfLab = labs.find((r) => r.labtest_external_identifier === "WA-261001-001");
    expect(pdfLab?.coa_storage_path).toMatch(/\.pdf$/);
    expect(st.uploads.filter((u) => u.bucket === "coa")).toHaveLength(1);
    expect(st.audits.filter((a) => a.action === core.COA_GMAIL_ATTACH_AUDIT)).toHaveLength(1);
    // Idempotent.
    const n = st.db.rows("lab_results").length;
    const t2 = await store.attachCoasFromGmail(ACTOR, { ...deps(null) });
    expect(t2.linkedFromJson + t2.linkedFromPdf).toBe(0);
    expect(st.db.rows("lab_results").length).toBe(n);
  });

  it("an exact lab id already on file is reused, never duplicated", async () => {
    await scenario();
    st.db.rows("lab_results").push({ id: "22222222-0000-4000-8000-000000000001", labtest_external_identifier: "WA-261001-001", created_at: "2026-10-01T00:00:00Z", coa_url: null, coa_storage_path: null });
    await store.attachCoasFromGmail(ACTOR, { ...deps(null) });
    expect(labOf(lid(1, 1))).toBe("22222222-0000-4000-8000-000000000001");
    expect(st.db.rows("lab_results").filter((r) => r.labtest_external_identifier === "WA-261001-001")).toHaveLength(1);
  });

  it("a preview reads everything and writes nothing", async () => {
    await scenario();
    const snap = JSON.stringify(st.db.rows("inventory_lots"));
    const uploads = st.uploads.length;
    const t = await store.attachCoasFromGmail(ACTOR, { ...deps(null), dryRun: true });
    expect(t).toMatchObject({ dryRun: true, linkedFromJson: 1, linkedFromPdf: 1, pdfsFiled: 0 });
    expect(JSON.stringify(st.db.rows("inventory_lots"))).toBe(snap);
    expect(st.db.rows("lab_results")).toHaveLength(0);
    expect(st.uploads.length).toBe(uploads);
    expect(st.audits).toHaveLength(0);
    expect(core.attachNote(t)).toMatch(/Preview/);
  });
});

describe("D201 - one stubborn product", () => {
  it("a wider search for just that lot, attaches it and answers plainly", async () => {
    manifest(1, "STARLEAF GARDENS LLC", "M0782565300", "2026-09-10");
    st.db.rows("inventory_lots").push(lot(1, 0, bc(7)), lot(1, 1, bc(8)));
    CERTS.certC = [cert("WA-260901-777", [bc(7)])];
    const g = fakeGmail();
    addMail(g, "lateMail001", "COA resend", [["COA_resend.pdf", "certC"]]);
    g.answers.push([/"STARLEAF GARDENS" after:/, ["lateMail001"]]);
    const r = await store.searchGmailForOne(ACTOR, { lotId: lid(1, 0) }, deps(g));
    expect(r.ok).toBe(true);
    expect(r.lotLinked).toBe(true);
    expect(labOf(lid(1, 0))).toBeTruthy();
    expect(labOf(lid(1, 1))).toBeNull();
    // Only this lot's barcode is asked; the vendor window is the wider one.
    expect(g.queries.some((q) => q.includes(bc(7)))).toBe(true);
    expect(g.queries.some((q) => q.includes(bc(8)))).toBe(false);
    expect(g.queries.some((q) => q.includes("after:2026/08/11"))).toBe(true);
    expect(store.oneSearchNote(r)).toContain("now has its COA");
    expect(st.audits.filter((a) => a.action === core.COA_GMAIL_ONE_AUDIT)).toHaveLength(1);
  });

  it("nothing in the mailbox: says to ask the vendor", async () => {
    manifest(1, "ALIS", "M0782565400");
    st.db.rows("inventory_lots").push(lot(1, 0, bc(9)));
    const r = await store.searchGmailForOne(ACTOR, { lotId: lid(1, 0) }, deps(fakeGmail()));
    expect(r.lotLinked).toBe(false);
    expect(store.oneSearchNote(r)).toContain("ask the vendor");
    expect(labOf(lid(1, 0))).toBeNull();
  });
});

describe("D201 - wiring", () => {
  it("the Fix later page has the Gmail buttons and the per-lot search behind inventory.manage", () => {
    const page = read("src/app/admin/inventory/fix-later/page.tsx");
    for (const id of ["coa-gmail-search-button", "coa-gmail-attach-button", "coa-gmail-preview-button", "coa-gmail-lot-button", "coa-gmail-delivery-button"]) {
      expect(page).toContain(`data-testid="${id}"`);
    }
    expect(page).toContain('r.fixLater.includes("no_coa")');
    const actions = read("src/app/admin/inventory/fix-later/actions.ts");
    for (const fn of ["searchGmailForCoasAction", "attachCoasFromGmailAction", "searchGmailForOneAction"]) {
      expect(actions).toMatch(new RegExp(`export async function ${fn}\\([^)]*\\) \\{\\n  const session = await requirePermission\\("inventory\\.manage"\\);`));
    }
    const harvest = read("src/lib/pos/cultivera-mail-harvest-store.ts");
    expect(harvest).toContain("export async function harvestOneEmail(");
    const selftests = read("scripts/compliance/run-pure-selftests.ts");
    expect(selftests).toContain('assertRan("coa-gmail-search-core", __runCoaGmailSearchCoreTests(), 40)');
  });
});
