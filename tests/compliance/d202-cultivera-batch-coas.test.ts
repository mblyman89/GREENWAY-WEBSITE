/**
 * D202 - "I tried the new fetch button ... it works for a few seconds then comes back saying it
 * found nothing ... 'done, 0 of 0 vendor files'. please ... see what went wrong so you can fix it
 * properly."
 *
 * Measured cause: Cultivera holds NO vendor WCIA file on any of the 32 transfers (JsonFile empty
 * on every transfer detail). The COAs are on each Cultivera BATCH (HasCoaDocument + ImagePath).
 * The crawl now also fetches the transfers' live lots + batch details; Attach links each lot to its
 * batch COA (exact barcode on its own transfer), one lab result per COA link, files the PDF in
 * `coa`, fill-only. Pins: the real store over the in-memory PostgREST, a mocked crawler and a
 * mocked files.cultivera.com.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  files: {} as Record<string, Buffer>,
  uploads: [] as string[],
  audits: [] as Record<string, unknown>[],
  run: null as null | { runId: string; active: boolean; state: { status: string } | null },
  batch: { kind: "none" } as Record<string, unknown>,
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
              const b = st.files[`${bucket}/${key}`];
              return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found" } };
            },
            async upload(key: string, body: Buffer) {
              st.uploads.push(`${bucket}/${key}`);
              st.files[`${bucket}/${key}`] = Buffer.from(body);
              return { data: { path: key }, error: null };
            },
          };
        },
      };
      return client;
    },
  };
});
vi.mock("@/lib/pos/cultivera-fetch-client", () => ({
  startWciaRun: async (ids: number[]) => ({ runId: "20261107T120000Z-deadbeef", transferIds: ids }),
  getPosRun: async () => st.run,
  loadWciaRunRecords: async () => (st.run ? { kind: "ok", records: [], bad: 0 } : { kind: "missing" }),
  loadBatchCoaRecords: async () => (st.run ? st.batch : { kind: "missing" }),
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));

const store = await import("@/lib/inventory/coa-from-cultivera-store");
const core = await import("@/lib/inventory/coa-from-cultivera-core");
const bcore = await import("@/lib/inventory/coa-batch-cultivera-core");

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const IMP = "a474040b-0f1d-476e-b32d-99c5fe4bef50";
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const mid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const lid = (m: number, k: number) => `11111111-0000-4000-8000-${(m * 100 + k).toString(16).padStart(12, "0")}`;
const U = (b: number) => `https://files.cultivera.com/435553542D5753313138/Coas/26/10/01/X/COA_${b}.pdf`;
const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

function lot(m: number, k: number, bc: string, extra: Row = {}): Row {
  return { id: lid(m, k), manifest_id: mid(m), lot_code: bc, status: "active", lab_result_id: null, on_hand_qty: 10, unit_cost_minor_units: 800, ccrs_inventory_id: `CCRS-${m}-${k}`, updated_by: null, ...extra };
}
function manifest(n: number, transfer: number) {
  st.db.rows("inbound_manifests").push({ id: mid(n), manifest_number: `CV-${n}`, raw_payload: { kind: "cultivera-reconstructed", import_id: IMP, cultivera_transfer_id: transfer } });
}
const labOf = (id: string) => st.db.rows("inventory_lots").find((l) => l.id === id)?.lab_result_id ?? null;

const fetched: string[] = [];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  fetched.push(url);
  if (url.endsWith("COA_404.pdf")) return new Response("nope", { status: 404 });
  return new Response(new Uint8Array(PDF), { status: 200, headers: { "content-type": "application/pdf" } });
}) as typeof fetch;

function scenario() {
  manifest(1, 1181);
  manifest(2, 1214);
  st.db.rows("inventory_lots").push(
    lot(1, 0, "A1"),
    lot(1, 1, "A2"), // same batch as A1
    lot(1, 2, "A3"), // batch without a COA document
    lot(1, 3, "A4", { lab_result_id: "keep-me" }),
    lot(1, 4, "A5", { status: "destroyed" }),
    lot(2, 0, "B1"),
    lot(2, 1, "A1X"), // on 1214 here, but Cultivera has it on 1181
    lot(2, 2, "B9"), // its PDF link answers 404
  );
  st.db.rows("site_settings").push({ key: core.COA_RUN_SETTING_KEY, value_json: { runId: "20261107T120000Z-deadbeef", transferIds: [1181, 1214], startedAt: "t" } });
  st.run = { runId: "20261107T120000Z-deadbeef", active: false, state: { status: "done" } };
  st.batch = {
    kind: "ok",
    bad: 0,
    lots: [
      { Id: 1, Barcode: "A1", BatchId: 101, IncomingTransferId: 1181 },
      { Id: 2, Barcode: "A2", BatchId: 101, IncomingTransferId: 1181 },
      { Id: 3, Barcode: "A3", BatchId: 102, IncomingTransferId: 1181 },
      { Id: 4, Barcode: "A4", BatchId: 101, IncomingTransferId: 1181 },
      { Id: 5, Barcode: "A5", BatchId: 101, IncomingTransferId: 1181 },
      { Id: 6, Barcode: "B1", BatchId: 201, IncomingTransferId: 1214 },
      { Id: 7, Barcode: "A1X", BatchId: 101, IncomingTransferId: 1181 },
      { Id: 8, Barcode: "B9", BatchId: 404, IncomingTransferId: 1214 },
    ],
    batches: [
      { Id: 101, HasCoaDocument: true, IsCannabis: true, ImagePath: U(101), Lab: "Confidence Analytics", TestingDate: "2026-09-30T00:00:00", Thc: 1.1, Total: 25.2 },
      { Id: 102, HasCoaDocument: false, ImagePath: null },
      { Id: 201, HasCoaDocument: true, IsCannabis: true, ImagePath: U(201), Lab: "Testing Technologies" },
      { Id: 404, HasCoaDocument: true, IsCannabis: true, ImagePath: U(404) },
    ],
  };
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.files = {};
  st.uploads = [];
  st.audits = [];
  st.run = null;
  st.batch = { kind: "none" };
  fetched.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("D202 - Attach from Cultivera's batch COA documents", () => {
  it("links each lot to its batch COA by exact barcode on its own transfer, one lab per COA, PDF filed, fill-only", async () => {
    scenario();
    const before = st.db.rows("inventory_lots").map((l) => ({ ...l, lab_result_id: undefined, updated_by: undefined }));
    const t = await store.attachAllCoas(ACTOR, { fetchImpl: fakeFetch });
    expect(t).toMatchObject({ linkedFromBatchCoa: 4, created: 3, batchPdfsFiled: 2, batchPdfsLeft: 1, batchNoDocument: 1 });
    expect(labOf(lid(1, 0))).toBeTruthy();
    expect(labOf(lid(1, 0))).toBe(labOf(lid(1, 1))); // one certificate, two lots
    expect(labOf(lid(1, 2))).toBeNull(); // no COA document in Cultivera
    expect(labOf(lid(1, 3))).toBe("keep-me"); // never replaced
    expect(labOf(lid(1, 4))).toBeNull(); // destroyed: never touched
    expect(labOf(lid(2, 0))).toBeTruthy();
    expect(labOf(lid(2, 1))).toBeNull(); // Cultivera has that barcode on another transfer
    expect(labOf(lid(2, 2))).toBeTruthy(); // linked even though its PDF could not be downloaded yet
    // Nothing else on a lot changes; every lot write is the guarded fill.
    expect(st.db.rows("inventory_lots").map((l) => ({ ...l, lab_result_id: undefined, updated_by: undefined }))).toEqual(before);
    for (const q of st.db.log.filter((w) => w.table === "inventory_lots" && w.method !== "GET" && w.method !== "HEAD")) {
      expect(Object.keys(q.body as object).sort()).toEqual(["lab_result_id", "updated_by"]);
      expect(q.url.search).toContain("lab_result_id=is.null");
      expect(q.url.search).toContain("status=neq.destroyed");
    }
    // Lab results: the COA link, the lab, the testing day, provenance; no potency, no verdict.
    const labs = st.db.rows("lab_results");
    expect(labs.map((r) => r.coa_url).sort()).toEqual([U(101), U(201), U(404)]);
    const l101 = labs.find((r) => r.coa_url === U(101))!;
    expect(l101).toMatchObject({ source: bcore.BATCH_COA_SOURCE, lab_name: "Confidence Analytics", tested_on: "2026-09-30", passed: null, thc_pct: null, total_thc_pct: null, labtest_external_identifier: null });
    expect((l101.raw_payload as Record<string, unknown>).cultivera_batch_id).toBe(101);
    expect(l101.coa_storage_path).toBe(`${l101.id}/${l101.id}.pdf`);
    expect(st.files[`coa/${l101.id}/${l101.id}.pdf`]?.subarray(0, 5).toString()).toBe("%PDF-");
    expect(labs.find((r) => r.coa_url === U(404))!.coa_storage_path ?? null).toBeNull();
    expect(t.errors.join()).toContain("could not be downloaded");
    expect(fetched.sort()).toEqual([U(101), U(201), U(404)]);
    expect(core.coaAttachNote(t)).toContain("4 from Cultivera's batch COA documents");
    expect(st.audits.filter((a) => a.action === core.COA_ATTACH_AUDIT)).toHaveLength(1);
  });

  it("a preview reads everything and writes or downloads nothing", async () => {
    scenario();
    const snap = JSON.stringify(st.db.rows("inventory_lots"));
    const t = await store.attachAllCoas(ACTOR, { dryRun: true, fetchImpl: fakeFetch });
    expect(t).toMatchObject({ dryRun: true, linkedFromBatchCoa: 4, created: 3, batchPdfsFiled: 0 });
    expect(JSON.stringify(st.db.rows("inventory_lots"))).toBe(snap);
    expect(st.db.rows("lab_results")).toHaveLength(0);
    expect(st.uploads).toEqual([]);
    expect(fetched).toEqual([]);
    expect(st.audits).toHaveLength(0);
  });

  it("idempotent: a second click reuses the lab results by COA link and retries only the unfiled PDF", async () => {
    scenario();
    await store.attachAllCoas(ACTOR, { fetchImpl: fakeFetch });
    const labs = st.db.rows("lab_results").length;
    fetched.length = 0;
    const t = await store.attachAllCoas(ACTOR, { fetchImpl: fakeFetch });
    expect(t.linkedFromBatchCoa).toBe(0);
    expect(st.db.rows("lab_results").length).toBe(labs);
    expect(t.stillMissing).toBe(2);
    // A new lot of an already-filed batch reuses its lab result (same COA link).
    st.db.rows("inventory_lots").push(lot(1, 9, "A9"));
    (st.batch.lots as Row[]).push({ Id: 9, Barcode: "A9", BatchId: 101, IncomingTransferId: 1181 });
    const t3 = await store.attachAllCoas(ACTOR, { fetchImpl: fakeFetch });
    expect(t3).toMatchObject({ linkedFromBatchCoa: 1, created: 0, reused: 1 });
    expect(labOf(lid(1, 9))).toBe(labOf(lid(1, 0)));
  });

  it("an old crawl (before the batch step) says to fetch again instead of a silent nothing", async () => {
    scenario();
    st.batch = { kind: "none" };
    const t = await store.attachAllCoas(ACTOR, { dryRun: true });
    expect(t.linkedFromBatchCoa).toBe(0);
    expect(t.errors.join()).toContain("before the batch COA step");
  });

  it("two batches with different COA links for one barcode are left alone", async () => {
    manifest(1, 1181);
    st.db.rows("inventory_lots").push(lot(1, 0, "A1"));
    st.db.rows("site_settings").push({ key: core.COA_RUN_SETTING_KEY, value_json: { runId: "20261107T120000Z-deadbeef", transferIds: [1181], startedAt: "t" } });
    st.run = { runId: "20261107T120000Z-deadbeef", active: false, state: { status: "done" } };
    st.batch = {
      kind: "ok",
      bad: 0,
      lots: [
        { Id: 1, Barcode: "A1", BatchId: 1, IncomingTransferId: 1181 },
        { Id: 2, Barcode: "A1", BatchId: 2, IncomingTransferId: 1181 },
      ],
      batches: [
        { Id: 1, HasCoaDocument: true, ImagePath: U(1) },
        { Id: 2, HasCoaDocument: true, ImagePath: U(2) },
      ],
    };
    const t = await store.attachAllCoas(ACTOR, { fetchImpl: fakeFetch });
    expect(t.linkedFromBatchCoa).toBe(0);
    expect(t.ambiguous).toBe(1);
    expect(labOf(lid(1, 0))).toBeNull();
  });
});

describe("D202 - the status line and the wiring", () => {
  it("the page no longer says a bare '0 of 0 vendor files'", () => {
    const page = read("src/app/admin/inventory/fix-later/page.tsx");
    expect(page).toContain("coaCrawlStatusLine(");
    expect(page).not.toContain("vendor files` : \"\"}");
    const line = bcore.coaCrawlStatusLine({ status: "done", transfers: 32, wcia: { wanted: 0, missing: [] }, lotsStage: null, batchStage: null, detailsMissing: 0, error: null });
    expect(line).toContain("Cultivera has no vendor transfer file on these 32 transfers");
    expect(line).toContain("click Fetch again");
  });

  it("the crawler's COA crawl reads the transfers' lots and batch details, read-only", () => {
    const py = read("crawler/app/cultivera_pos.py");
    expect(py).toContain('WCIA_ONLY_STAGES = ("login", "transfer_details", "wcia_json", "transfer_lots", "batch_coas")');
    expect(py).toContain('Q + f"inventories/inventory-batch/{i}"');
    expect(read("crawler/app/cultivera_pos_jobs.py")).toContain('"transfer_lots.json"');
    const client = read("src/lib/pos/cultivera-fetch-client.ts");
    expect(client).toContain("export async function loadBatchCoaRecords(");
    expect(client).toContain('verifyFile(manifest, "batches.jsonl"');
  });
});
