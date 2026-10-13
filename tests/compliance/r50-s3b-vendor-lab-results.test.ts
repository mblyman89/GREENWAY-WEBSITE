/**
 * tests/compliance/r50-s3b-vendor-lab-results.test.ts   (R50 S3b, bible §1.5c)
 *
 * Owner: "scrape everything from Cultivera, json, manifest, coa ... read the
 * manifests and coas for all their data ... these products treated like we
 * received them ... nothing blocks it from the menu and sales."
 *
 * Behavioural, through the REAL postgrest-js client against FakePostgrest and
 * the real native parser:
 *   A. saveWciaFiles - one private file per transfer, bad records counted,
 *      upload failures reported (never thrown).
 *   B. attachWciaLabResults - the manifest's OWN transfer file; native-shape
 *      lab_results; exact lab test id reused; fill-only links (a COA is never
 *      replaced, a destroyed lot never touched, a lot that changed meanwhile is
 *      reported); ambiguous barcodes left alone; 0252-missing column dropped
 *      once; every failure is a result, never a throw; NO other lot column.
 *   C. Start runs it FIRST (before seeding / certificates) and records it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  files: {} as Record<string, Buffer>,
  uploadFail: null as string | null,
  downloadFail: null as string | null,
  audits: [] as Record<string, unknown>[],
  calls: [] as string[],
  labLinksAtSeed: -1,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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
            async upload(key: string, body: Buffer, o: { upsert?: boolean }) {
              if (bucket !== "pos-raw" || !o.upsert) return { error: { message: "wrong bucket/upsert" } };
              if (st.uploadFail && key.includes(st.uploadFail)) return { error: { message: "denied" } };
              st.files[key] = body;
              return { error: null };
            },
            async download(key: string) {
              if (st.downloadFail) return { data: null, error: { message: st.downloadFail } };
              const b = st.files[key];
              return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found" } };
            },
          };
        },
      };
      return client;
    },
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));
// The rest of Start is S3's (tested there): spies that record order and what seeding saw.
vi.mock("@/lib/inventory/catalog-drafts", () => ({
  seedDraftsForManifest: async () => {
    st.calls.push("seed");
    st.labLinksAtSeed = st.db.rows("inventory_lots").filter((l) => l.lab_result_id).length;
    return { draftsCreated: 0, draftsFailed: 0, firstError: null, lotIdentities: null, reonboard: { skippedOpen: 0, skippedOnboarded: 0, sameCard: 0 } };
  },
}));
vi.mock("@/lib/inventory/coa-archive", () => ({ archiveCoasForManifest: async () => void st.calls.push("archive") }));
vi.mock("@/lib/inventory/coa-extract", () => ({
  extractCoasForManifest: async () => {
    st.calls.push("extract");
    return { read: 0, ok: 0, partial: 0, failed: 0, deferred: 0, kbFilled: 0, errors: [] };
  },
}));
vi.mock("@/lib/inventory/manifest-kb-bridge", () => ({
  promoteManifestToKb: async () => ({ ok: true, outcome: { promoted: 0, skipped: 0, strainsEnriched: 0, vendorLicenseFilled: false } }),
}));
vi.mock("@/lib/inventory/kb-link-store", () => ({ linkKbProductsToDrafts: async () => ({ status: "skipped" }) }));
vi.mock("@/lib/catalog/lab-facts-attach", () => ({
  attachLabFactsToManifestDrafts: async () => ({ drafts: 0, attached: 0, facts: 0, noPanel: 0, kept: 0, strainsUpdated: 0, strainTerpenesAdded: 0, unmigrated: false, errors: [] }),
}));

const { saveWciaFiles, attachWciaLabResults } = await import("@/lib/inventory/cultivera-wcia-store");
const { startCultiveraManifestOnboarding } = await import("@/lib/inventory/cultivera-onboarding");
const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
const core = await import("@/lib/inventory/cultivera-wcia-core");

const IMP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const M = "00000000-0000-4000-8000-00000000aa01";
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const TID = 4355;
const lotId = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

function item(bc: string, lab: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
            potency: [
              { type: "thca", value: 24.1, unit_of_measure: "pct" },
              { type: "thc", value: 1.2, unit_of_measure: "pct" },
            ],
          },
          lab_result_link: `https://certs.conflabs.com/${lab}.json`,
        }
      : {}),
    ...extra,
  };
}
const wciaDoc = (items: Record<string, unknown>[]) =>
  JSON.stringify({
    document_name: "WCIA Transfer Data",
    document_schema_version: "2.1.0",
    transfer_id: "MANIFEST-9",
    from_license_number: "412345",
    to_license_number: "423456",
    inventory_transfer_items: items,
  });

function lot(n: number, bc: string | null, extra: Row = {}): Row {
  return {
    id: lotId(n),
    manifest_id: M,
    lot_code: bc,
    status: "active",
    lab_result_id: null,
    qty_on_hand: 10,
    unit_cost_minor_units: 800,
    ccrs_inventory_id: `CCRS-${n}`,
    disposition: "accepted",
    pos_product_key: `pos-${n}`,
    updated_by: null,
    ...extra,
  };
}

const lineage = { import_id: IMP, cultivera_transfer_id: String(TID) };
const admin = () => createSupabaseAdminClient();
const keyFor = (t: number) => `rehome/${IMP}/wcia/${t}.json`;
const putDoc = (items: Record<string, unknown>[], t = TID) => (st.files[keyFor(t)] = Buffer.from(wciaDoc(items), "utf8"));
const lotView = () =>
  st.db.rows("inventory_lots").map((l) => {
    const { lab_result_id: _l, updated_by: _u, ...rest } = l;
    return rest;
  });

beforeEach(() => {
  st.db = new FakePostgrest();
  st.files = {};
  st.uploadFail = null;
  st.downloadFail = null;
  st.audits = [];
  st.calls = [];
  st.labLinksAtSeed = -1;
  st.db.rows("inbound_manifests").push({
    id: M,
    status: "accepted",
    raw_payload: { kind: "cultivera-reconstructed", import_id: IMP, cultivera_transfer_id: TID },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("A. saving the vendor transfer files at import", () => {
  it("one private file per transfer; bad and duplicate records counted, never saved", async () => {
    const doc = wciaDoc([item("B1", "L1")]);
    const r = await saveWciaFiles(admin() as never, IMP, [
      { Id: TID, JsonFile: doc },
      { Id: 12, JsonFile: doc },
      { Id: TID, JsonFile: doc },
      { Id: 13, JsonFile: "<html>" },
      { Id: "x", JsonFile: doc },
    ]);
    expect(r).toEqual({ saved: 2, failed: 0, rejected: 2, duplicates: 1, firstError: null });
    expect(Object.keys(st.files).sort()).toEqual([keyFor(12), keyFor(TID)].sort());
    expect(st.files[keyFor(TID)].toString("utf8")).toBe(doc);
  });

  it("an upload failure is reported, the rest still saved (never thrown)", async () => {
    st.uploadFail = "/12.json";
    const doc = wciaDoc([]);
    const r = await saveWciaFiles(admin() as never, IMP, [{ Id: 12, JsonFile: doc }, { Id: 14, JsonFile: doc }]);
    expect(r.saved).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.firstError).toBe("denied");
  });
});

describe("B. attaching the vendor's lab results", () => {
  it("native lab rows from the manifest's own transfer, fill-only links, nothing else on the lot changes", async () => {
    putDoc([item("B1", "L1"), item("B2", "L1"), item("B3", "L3"), item("B4", null), item("B5", "L5"), item("B5", "L6")]);
    st.db.rows("lab_results").push({ id: "lab-old", labtest_external_identifier: "L3", created_at: "2026-01-01T00:00:00Z" });
    st.db.rows("inventory_lots").push(
      lot(1, "B1"),
      lot(2, "B2"),
      lot(3, "B3"),
      lot(4, "B4"),
      lot(5, "B5"), // ambiguous on the transfer
      lot(6, "B1", { lab_result_id: "keep-me" }), // a certificate is never replaced
      lot(7, "B1", { status: "destroyed" }),
      lot(8, "B9"), // not on this transfer
      { ...lot(9, "B1"), manifest_id: "other-manifest" }, // another manifest's lot is never read
    );
    const before = lotView();
    const r = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(r.status).toBe("attached");
    expect(r.errors).toEqual([]);
    expect(r).toEqual(expect.objectContaining({ linked: 3, created: 1, reused: 1, skippedChanged: 0 }));
    expect(r.outcomes).toEqual({ link: 3, "has-lab": 1, destroyed: 1, "no-barcode": 0, "not-on-transfer": 1, "no-lab": 1, ambiguous: 1 });

    const labs = st.db.rows("lab_results");
    const l1 = labs.find((l) => l.labtest_external_identifier === "L1")!;
    expect(labs).toHaveLength(2); // one new (L1, deduped across two lots) + the existing L3
    expect(l1).toEqual(
      expect.objectContaining({
        source: "wcia-transfer",
        lab_name: "Confidence Analytics",
        coa_url: "https://certs.conflabs.com/L1.pdf",
        wcia_json_url: "https://certs.conflabs.com/L1.json",
        passed: true,
        created_by: ACTOR,
      }),
    );
    expect(Number(l1.thca_pct)).toBeCloseTo(24.1);

    const byId = new Map(st.db.rows("inventory_lots").map((l) => [l.id, l]));
    expect(byId.get(lotId(1))?.lab_result_id).toBe(l1.id);
    expect(byId.get(lotId(2))?.lab_result_id).toBe(l1.id);
    expect(byId.get(lotId(3))?.lab_result_id).toBe("lab-old");
    expect(byId.get(lotId(1))?.updated_by).toBe(ACTOR);
    for (const n of [4, 5, 7, 8, 9]) expect(byId.get(lotId(n))?.lab_result_id).toBeNull();
    expect(byId.get(lotId(6))?.lab_result_id).toBe("keep-me");
    // sellable stays sellable: every other lot column identical; only lab_result_id + updated_by sent
    expect(lotView()).toEqual(before);
    for (const req of st.db.log.filter((q) => q.table === "inventory_lots" && q.method === "PATCH")) {
      expect(Object.keys(req.body as object).sort()).toEqual(["lab_result_id", "updated_by"]);
      expect(req.url.search).toContain("lab_result_id=is.null");
      expect(req.url.search).toContain("status=neq.destroyed");
    }
    expect(st.db.log.some((q) => q.table.startsWith("menu_"))).toBe(false);
  });

  it("re-running links nothing new and creates no duplicate lab result", async () => {
    putDoc([item("B1", "L1")]);
    st.db.rows("inventory_lots").push(lot(1, "B1"));
    await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    const r2 = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(r2.linked).toBe(0);
    expect(r2.outcomes["has-lab"]).toBe(1);
    expect(st.db.rows("lab_results")).toHaveLength(1);
  });

  it("a lot that gained a certificate meanwhile is reported, not overwritten", async () => {
    putDoc([item("B1", "L1")]);
    st.db.rows("inventory_lots").push(lot(1, "B1"));
    st.db.before = (req) => {
      if (req.table === "inventory_lots" && req.method === "PATCH") {
        st.db.rows("inventory_lots")[0].lab_result_id = "owner-linked";
      }
    };
    const r = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(r.linked).toBe(0);
    expect(r.skippedChanged).toBe(1);
    expect(st.db.rows("inventory_lots")[0].lab_result_id).toBe("owner-linked");
  });

  it("0252 not applied: the JSON link is dropped once and the lab result still saved", async () => {
    putDoc([item("B1", "L1"), item("B2", "L2")]);
    st.db.rows("inventory_lots").push(lot(1, "B1"), lot(2, "B2"));
    let refused = 0;
    st.db.before = (req) => {
      if (req.table === "lab_results" && req.method === "POST" && "wcia_json_url" in (req.body as object)) {
        refused += 1;
        return { status: 400, body: { code: "PGRST204", message: "Could not find the 'wcia_json_url' column of 'lab_results' in the schema cache" } };
      }
    };
    const r = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(refused).toBe(1); // learned once, not per row
    expect(r.created).toBe(2);
    expect(r.linked).toBe(2);
    expect(st.db.rows("lab_results").every((l) => !("wcia_json_url" in l) || l.wcia_json_url == null)).toBe(true);
  });

  it("a lab result that cannot be saved links nothing for it and says so", async () => {
    putDoc([item("B1", "L1"), item("B2", "L2")]);
    st.db.rows("inventory_lots").push(lot(1, "B1"), lot(2, "B2"));
    st.db.before = (req) => {
      if (req.table === "lab_results" && req.method === "POST" && (req.body as Row).labtest_external_identifier === "L1") {
        return { status: 500, body: { code: "XX000", message: "boom" } };
      }
    };
    const r = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(r.created).toBe(1);
    expect(r.linked).toBe(1);
    expect(r.errors[0]).toContain("a lab result could not be saved: boom");
    expect(st.db.rows("inventory_lots").find((l) => l.id === lotId(1))?.lab_result_id).toBeNull();
  });

  it("an unreadable lab_results lookup attaches nothing (never duplicates a certificate blindly)", async () => {
    putDoc([item("B1", "L1")]);
    st.db.rows("inventory_lots").push(lot(1, "B1"));
    st.db.before = (req) => (req.table === "lab_results" && req.method === "GET" ? { status: 500, body: { message: "down" } } : undefined);
    const r = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(r.status).toBe("error");
    expect(r.linked + r.created).toBe(0);
    expect(st.db.log.some((q) => q.method !== "GET")).toBe(false);
  });

  it("an incomplete lot read attaches nothing", async () => {
    putDoc([item("B1", "L1")]);
    st.db.rows("inventory_lots").push(lot(1, "B1"));
    st.db.before = (req) => (req.table === "inventory_lots" && req.method === "GET" ? { status: 500, body: { message: "timeout" } } : undefined);
    const r = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(r.status).toBe("error");
    expect(r.errors[0]).toContain("could not be read in full");
    expect(st.db.log.some((q) => q.method !== "GET")).toBe(false);
  });

  it("no transfer, no file, a broken file or an unreadable store: nothing written, the reason returned", async () => {
    st.db.rows("inventory_lots").push(lot(1, "B1"));
    expect((await attachWciaLabResults(admin() as never, M, { import_id: IMP, cultivera_transfer_id: null }, ACTOR)).status).toBe("no-transfer");
    expect((await attachWciaLabResults(admin() as never, M, { import_id: "../etc", cultivera_transfer_id: "1" }, ACTOR)).status).toBe("no-transfer");
    expect((await attachWciaLabResults(admin() as never, M, null, ACTOR)).status).toBe("no-transfer");
    expect((await attachWciaLabResults(admin() as never, M, lineage, ACTOR)).status).toBe("no-document");
    st.files[keyFor(TID)] = Buffer.from("<html>", "utf8");
    const bad = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(bad.status).toBe("unreadable");
    expect(bad.errors[0]).toContain("not a WCIA transfer document");
    st.downloadFail = "permission denied";
    const den = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(den.status).toBe("unreadable");
    expect(den.errors[0]).toContain("permission denied");
    expect(st.db.log.some((q) => q.method !== "GET")).toBe(false);
  });

  it("uses ONLY the manifest's own transfer (a same-barcode line on another transfer is ignored)", async () => {
    putDoc([item("B1", "L-OTHER")], 9999);
    putDoc([item("B2", "L2")]);
    st.db.rows("inventory_lots").push(lot(1, "B1"));
    const r = await attachWciaLabResults(admin() as never, M, lineage, ACTOR);
    expect(r.outcomes["not-on-transfer"]).toBe(1);
    expect(st.db.rows("lab_results")).toHaveLength(0);
  });
});

describe("C. Start runs it first", () => {
  it("lab links exist before seeding / certificates; timeline + audit record it; stock untouched", async () => {
    putDoc([item("B1", "L1"), item("B2", "L1")]);
    st.db.rows("inventory_lots").push(lot(1, "B1"), lot(2, "B2"));
    const before = lotView();
    const r = await startCultiveraManifestOnboarding(M, ACTOR);
    expect(r.ok).toBe(true);
    expect(st.labLinksAtSeed).toBe(2); // seeding (and the COA archive beside it) saw the links
    expect(st.calls).toContain("archive");
    const ev = st.db.rows("manifest_events").find((e) => e.event_type === core.CULTIVERA_WCIA_EVENT);
    expect(ev?.note).toContain("2 lots linked to the vendor's lab result");
    const audit = st.audits.find((a) => a.action === "cultivera_onboarding.started");
    expect((audit?.after as { vendor_lab: { linked: number; status: string } }).vendor_lab).toEqual(
      expect.objectContaining({ linked: 2, created: 1, status: "attached" }),
    );
    if (r.ok) expect(r.note).toContain("2 lots linked to the vendor's lab result");
    expect(lotView()).toEqual(before);
  });

  it("a manifest without a transfer file starts exactly as before (no note, no error)", async () => {
    st.db.rows("inventory_lots").push(lot(1, "B1"));
    const r = await startCultiveraManifestOnboarding(M, ACTOR);
    expect(r.ok).toBe(true);
    expect(st.db.rows("manifest_events").some((e) => e.event_type === core.CULTIVERA_WCIA_EVENT)).toBe(false);
    if (r.ok) expect(r.note).not.toContain("Problems");
  });

  it("an unreadable file is a reported problem, never a refused Start", async () => {
    st.files[keyFor(TID)] = Buffer.from("{}", "utf8");
    st.db.rows("inventory_lots").push(lot(1, "B1"));
    const r = await startCultiveraManifestOnboarding(M, ACTOR);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.note).toContain("vendor lab results: vendor transfer file");
    expect(st.calls).toContain("seed");
  });
});
