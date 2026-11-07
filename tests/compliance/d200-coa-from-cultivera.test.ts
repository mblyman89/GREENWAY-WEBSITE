/**
 * D200 - "let's get them directly from Cultivera ... give me a simple crawl
 * button ... Then a button to attach everything automatically."
 *
 * The real store + the REAL attachWciaLabResults over the shared in-memory
 * PostgREST, an in-memory storage bucket and a mocked crawler client. Pins:
 * the crawl sends only transfers that still have stocked lots with no COA;
 * Attach saves the fetched files under the manifest's own import key and
 * links through the existing attach; the Gmail WCIA files fill the rest by
 * barcode; fill-only (a certificate is never replaced, a destroyed lot never
 * touched, no other lot column changes); a preview writes nothing; repeat
 * clicks are idempotent; one audit per click; page/action wiring.
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
  started: [] as number[][],
  run: null as null | { runId: string; active: boolean; state: { status: string } | null },
  records: [] as Array<{ Id: unknown; JsonFile: unknown }>,
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
        from() {
          return {
            async download(key: string) {
              const b = st.files[key];
              return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found" } };
            },
            async upload(key: string, body: Buffer) {
              st.uploads.push(key);
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
vi.mock("@/lib/pos/cultivera-fetch-client", () => ({
  startWciaRun: async (ids: number[]) => {
    st.started.push([...ids]);
    return { runId: "20261107T120000Z-deadbeef", transferIds: ids };
  },
  getPosRun: async () => st.run,
  loadWciaRunRecords: async () => (st.run ? { kind: "ok", records: st.records, bad: 0 } : { kind: "missing" }),
  // D202: the batch COA step has its own test (d202); a D200-era crawl has no batch files.
  loadBatchCoaRecords: async () => ({ kind: "none" }),
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));

const store = await import("@/lib/inventory/coa-from-cultivera-store");
const core = await import("@/lib/inventory/coa-from-cultivera-core");

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const IMP = "a474040b-0f1d-476e-b32d-99c5fe4bef50";
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const mid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const lid = (m: number, k: number) => `11111111-0000-4000-8000-${(m * 100 + k).toString(16).padStart(12, "0")}`;

function docText(items: Array<[string, string | null]>): string {
  return JSON.stringify({
    document_name: "WCIA Transfer Data",
    document_schema_version: "2.1.0",
    transfer_id: "MANIFEST-9",
    from_license_number: "412345",
    to_license_number: "423456",
    inventory_transfer_items: items.map(([bc, lab]) => ({
      inventory_id: bc,
      product_name: `Blue Dream 3.5g ${bc}`,
      strain_name: "Blue Dream",
      qty: "10",
      ...(lab
        ? {
            lab_result_data: {
              lab_result_id: lab,
              lab_name: "Confidence Analytics",
              lab_result_status: "passed",
              coa: `https://certs.conflabs.com/${lab}.pdf`,
              potency: [{ type: "thca", value: 24.1, unit_of_measure: "pct" }],
            },
          }
        : {}),
    })),
  });
}

function lot(m: number, k: number, bc: string, extra: Row = {}): Row {
  return {
    id: lid(m, k),
    manifest_id: mid(m),
    lot_code: bc,
    status: "active",
    lab_result_id: null,
    on_hand_qty: 10,
    unit_cost_minor_units: 800,
    ccrs_inventory_id: `CCRS-${m}-${k}`,
    updated_by: null,
    ...extra,
  };
}

function manifest(n: number, transfer: number | null, kind = "cultivera-reconstructed") {
  st.db.rows("inbound_manifests").push({
    id: mid(n),
    manifest_number: `CV-${n}`,
    raw_payload: { kind, import_id: IMP, ...(transfer === null ? {} : { cultivera_transfer_id: transfer }) },
  });
}

const labOf = (id: string) => st.db.rows("inventory_lots").find((l) => l.id === id)?.lab_result_id ?? null;

beforeEach(() => {
  st.db = new FakePostgrest();
  st.files = {};
  st.uploads = [];
  st.audits = [];
  st.started = [];
  st.run = null;
  st.records = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("D200 - Fetch COAs from Cultivera", () => {
  it("sends only the Cultivera transfers that still have stocked lots with no COA", async () => {
    manifest(1, 1181);
    manifest(2, 1214);
    manifest(3, 1100); // every lot here has a COA
    manifest(4, null); // no transfer
    manifest(5, 1190, "wcia"); // a native delivery
    st.db.rows("inventory_lots").push(
      lot(1, 0, "A1"),
      lot(1, 1, "A2"),
      lot(2, 0, "B1"),
      lot(3, 0, "C1", { lab_result_id: "has" }),
      lot(4, 0, "D1"),
      lot(5, 0, "E1"),
      lot(2, 1, "B2", { on_hand_qty: 0 }),
      lot(2, 2, "B3", { status: "destroyed" }),
    );
    const r = await store.startCoaFetch(ACTOR);
    expect(r).toEqual({ ok: true, runId: "20261107T120000Z-deadbeef", transfers: 2 });
    expect(st.started).toEqual([[1181, 1214]]);
    const setting = st.db.rows("site_settings").find((x) => x.key === core.COA_RUN_SETTING_KEY);
    expect(core.parseCoaRunSetting(setting?.value_json)).toMatchObject({ runId: "20261107T120000Z-deadbeef", transferIds: [1181, 1214], savedAt: null });
    expect(st.audits).toHaveLength(1);
    expect(st.audits[0]).toMatchObject({ action: core.COA_FETCH_AUDIT, actorId: ACTOR });
  });

  it("nothing to fetch is said plainly and starts no crawl", async () => {
    manifest(1, 1181);
    st.db.rows("inventory_lots").push(lot(1, 0, "A1", { lab_result_id: "has" }));
    const r = await store.startCoaFetch(ACTOR);
    expect(r.ok).toBe(false);
    expect(st.started).toEqual([]);
  });
});

describe("D200 - Attach all COAs", () => {
  function scenario() {
    manifest(1, 1181);
    manifest(2, 1214);
    manifest(4, null);
    st.db.rows("inventory_lots").push(
      lot(1, 0, "A1"),
      lot(1, 1, "A2"),
      lot(1, 2, "A3", { lab_result_id: "keep-me" }),
      lot(1, 3, "A4", { status: "destroyed" }),
      lot(2, 0, "B1"), // only in a Gmail file
      lot(4, 0, "D1"), // off Cultivera, in a Gmail file
      lot(4, 1, "D2"), // nowhere
    );
    // The crawl fetched 1181 only (1214 has no vendor file in Cultivera).
    st.db.rows("site_settings").push({ key: core.COA_RUN_SETTING_KEY, value_json: { runId: "20261107T120000Z-deadbeef", transferIds: [1181, 1214], startedAt: "t" } });
    st.run = { runId: "20261107T120000Z-deadbeef", active: false, state: { status: "done" } };
    st.records = [
      { Id: 1181, JsonFile: docText([["A1", "L1"], ["A2", "L1"], ["A3", "L3"], ["A4", "L1"]]) },
      { Id: 999, JsonFile: docText([["Z", "LZ"]]) },
      { Id: 5, JsonFile: "<html>" },
    ];
    // Gmail crawl: two emails carry B1 / D1, one carries a different barcode.
    const g1 = "mail-harvest/stephen_greenwaymarijuana.com/abc/1-transfer.json";
    const g2 = "mail-harvest/stephen_greenwaymarijuana.com/def/1-transfer.json";
    const g3 = "mail-harvest/stephen_greenwaymarijuana.com/ghi/1-transfer.json";
    st.files[g1] = Buffer.from(docText([["B1", "LB"], ["X9", "LX"]]));
    st.files[g2] = Buffer.from(docText([["D1", "LD"], ["B1", "LB"]]));
    st.files[g3] = Buffer.from(docText([["Q1", "LQ"]]));
    st.db.rows("cultivera_mail_docs").push(
      { id: "m1", storage_key: g1, source_format: "wcia", status: "parsed", barcodes: ["B1", "X9"] },
      { id: "m2", storage_key: g2, source_format: "wcia", status: "parsed", barcodes: ["D1", "B1"] },
      { id: "m3", storage_key: g3, source_format: "wcia", status: "parsed", barcodes: ["Q1"] },
      { id: "m4", storage_key: "rehome/evil/wcia/1.json", source_format: "wcia", status: "parsed", barcodes: ["D2"] },
    );
  }

  it("saves the fetched file under the manifest's import key, links via the existing attach, then fills the rest from Gmail", async () => {
    scenario();
    const before = st.db.rows("inventory_lots").map((l) => ({ ...l, lab_result_id: undefined, updated_by: undefined }));
    const t = await store.attachAllCoas(ACTOR);
    expect(st.uploads).toEqual([`rehome/${IMP}/wcia/1181.json`]);
    expect(t).toMatchObject({ missingBefore: 5, fetchedFiles: 2, filesSaved: 1, linkedFromCultivera: 2, linkedFromMail: 2, stillMissing: 1, mailDocsRead: 2 });
    expect(labOf(lid(1, 0))).toBeTruthy();
    expect(labOf(lid(1, 0))).toBe(labOf(lid(1, 1))); // one certificate, two lots
    expect(labOf(lid(1, 2))).toBe("keep-me"); // never replaced
    expect(labOf(lid(1, 3))).toBeNull(); // destroyed: never touched
    expect(labOf(lid(2, 0))).toBeTruthy();
    expect(labOf(lid(4, 0))).toBeTruthy();
    expect(labOf(lid(4, 1))).toBeNull();
    // Nothing else on a lot changes.
    expect(st.db.rows("inventory_lots").map((l) => ({ ...l, lab_result_id: undefined, updated_by: undefined }))).toEqual(before);
    for (const q of st.db.log.filter((w) => w.table === "inventory_lots" && w.method !== "GET" && w.method !== "HEAD")) {
      expect(Object.keys(q.body as object).sort()).toEqual(["lab_result_id", "updated_by"]);
      expect(q.url.search).toContain("lab_result_id=is.null");
      expect(q.url.search).toContain("status=neq.destroyed");
    }
    // Lab results: one per lab test id (L1, LB, LD), from the native builder.
    expect(st.db.rows("lab_results").map((r) => r.labtest_external_identifier).sort()).toEqual(["L1", "LB", "LD"]);
    const audit = st.audits.find((a) => a.action === core.COA_ATTACH_AUDIT);
    expect(audit).toMatchObject({ actorId: ACTOR });
    expect(st.audits.filter((a) => a.action === core.COA_ATTACH_AUDIT)).toHaveLength(1);
    expect(core.parseCoaRunSetting(st.db.rows("site_settings").find((x) => x.key === core.COA_RUN_SETTING_KEY)?.value_json)?.savedAt).toBeTruthy();
    expect(st.db.rows("manifest_events").map((e) => e.manifest_id)).toEqual([mid(1)]);
  });

  it("a preview reads everything and writes nothing", async () => {
    scenario();
    const snap = JSON.stringify(st.db.rows("inventory_lots"));
    const t = await store.attachAllCoas(ACTOR, { dryRun: true });
    expect(t).toMatchObject({ dryRun: true, linkedFromCultivera: 2, linkedFromMail: 2, filesSaved: 0, created: 3 });
    expect(st.uploads).toEqual([]);
    expect(JSON.stringify(st.db.rows("inventory_lots"))).toBe(snap);
    expect(st.db.rows("lab_results")).toHaveLength(0);
    expect(st.db.rows("manifest_events")).toHaveLength(0);
    expect(st.audits).toHaveLength(0);
    expect(core.coaAttachNote(t)).toContain("Preview (nothing was written)");
  });

  it("idempotent: a second click links nothing and creates no lab result", async () => {
    scenario();
    await store.attachAllCoas(ACTOR);
    const labs = st.db.rows("lab_results").length;
    const t = await store.attachAllCoas(ACTOR);
    expect(t.linkedFromCultivera + t.linkedFromMail).toBe(0);
    expect(st.db.rows("lab_results").length).toBe(labs);
    expect(t.stillMissing).toBe(1);
  });

  it("works from the saved files after the crawler lost the run, and waits while the crawl is still running", async () => {
    scenario();
    st.run = { runId: "20261107T120000Z-deadbeef", active: true, state: { status: "running" } };
    const t1 = await store.attachAllCoas(ACTOR, { dryRun: true });
    expect(t1.fetchedFiles).toBe(0);
    expect(t1.errors.join()).toContain("still running");
    // A file saved by an earlier click is read straight from storage.
    st.run = null;
    st.files[`rehome/${IMP}/wcia/1181.json`] = Buffer.from(docText([["A1", "L1"]]));
    const t2 = await store.attachAllCoas(ACTOR);
    expect(t2.linkedFromCultivera).toBe(1);
  });

  it("two different lab results for one barcode in the Gmail files are left alone", async () => {
    manifest(4, null);
    st.db.rows("inventory_lots").push(lot(4, 0, "D1"));
    const g1 = "mail-harvest/stephen_greenwaymarijuana.com/a/1.json";
    const g2 = "mail-harvest/stephen_greenwaymarijuana.com/b/1.json";
    st.files[g1] = Buffer.from(docText([["D1", "LA"]]));
    st.files[g2] = Buffer.from(docText([["D1", "LB"]]));
    st.db.rows("cultivera_mail_docs").push(
      { id: "1", storage_key: g1, source_format: "wcia", status: "parsed", barcodes: ["D1"] },
      { id: "2", storage_key: g2, source_format: "wcia", status: "parsed", barcodes: ["D1"] },
    );
    const t = await store.attachAllCoas(ACTOR);
    expect(t.linkedFromMail).toBe(0);
    expect(t.ambiguous).toBe(1);
    expect(labOf(lid(4, 0))).toBeNull();
  });
});

describe("D200 - wiring", () => {
  it("the Fix later page has both buttons behind inventory.manage, and the crawler has the endpoint", () => {
    const page = read("src/app/admin/inventory/fix-later/page.tsx");
    expect(page).toContain("fetchCoasFromCultiveraAction");
    expect(page).toContain("attachAllCoasAction");
    expect(page).toContain('data-testid="coa-fetch-button"');
    expect(page).toContain('data-testid="coa-attach-button"');
    expect(page).toContain("export const maxDuration = 300");
    const actions = read("src/app/admin/inventory/fix-later/actions.ts");
    expect(actions.match(/requirePermission\("inventory\.manage"\)/g)?.length).toBe(6); // D200 x2 + D201 x3 + D203 deep dig
    const main = read("crawler/app/main.py");
    expect(main).toContain('@app.post("/cultivera-pos/wcia-runs"');
    const client = read("src/lib/pos/cultivera-fetch-client.ts");
    expect(client).toContain('posFetch("/wcia-runs"');
  });
});
