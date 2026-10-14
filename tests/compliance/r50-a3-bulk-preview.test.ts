/**
 * R50 A3 - "Preview first (writes nothing)" before the three bulk buttons that
 * had no preview (S12b vendor lab results, S13 certificate copies, R15a fill
 * received dates & cannabinoids).
 *
 * Every preview runs the REAL code path with dryRun over the shared in-memory
 * PostgREST (real postgrest-js). Pins: a preview writes NOTHING (no POST /
 * PATCH / DELETE, no audit, no storage upload, no network fetch), and its
 * counts equal what the real run then does on the same data. Plus the
 * page/action wiring and permission gates.
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
  lotSources: [] as unknown[],
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
            async upload(path: string) {
              st.uploads.push(path);
              return { data: { path }, error: null };
            },
          };
        },
      };
      return client;
    },
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));
// Only the workbook parse is replaced (it needs real .xlsx bytes); the planners and DB path stay real.
vi.mock("@/lib/pos/transform", async (orig) => ({
  ...((await orig()) as object),
  transformWorkbooks: () => ({ lotSources: st.lotSources }),
}));

const { runWciaBackfill } = await import("@/lib/inventory/cultivera-wcia-backfill");
const { runCoaArchiveBackfill, previewCoaArchiveBackfill } = await import("@/lib/inventory/coa-archive-backfill");
const { fillImportLotFacts } = await import("@/lib/pos/import-service");
const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
const pv = await import("@/lib/inventory/bulk-preview-core");

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const IMP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const mid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const lid = (m: number, k: number) => `11111111-0000-4000-8000-${(m * 100 + k).toString(16).padStart(12, "0")}`;
const labId = (n: number) => `22222222-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const admin = () => createSupabaseAdminClient() as never;
const writes = () => st.db.log.filter((q) => q.method !== "GET" && q.method !== "HEAD");

function doc(items: Array<[string, string | null]>): Buffer {
  return Buffer.from(
    JSON.stringify({
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
    }),
    "utf8",
  );
}

function rebuilt(n: number, items: Array<[string, string | null]>) {
  const transfer = 1000 + n;
  st.db.rows("inbound_manifests").push({
    id: mid(n),
    manifest_number: `CV-${n}`,
    status: "accepted",
    raw_payload: { kind: "cultivera-reconstructed", import_id: IMP, cultivera_transfer_id: transfer },
  });
  st.files[`rehome/${IMP}/wcia/${transfer}.json`] = doc(items);
  items.forEach(([bc], k) =>
    st.db.rows("inventory_lots").push({ id: lid(n, k), manifest_id: mid(n), lot_code: bc, status: "active", lab_result_id: null, qty_on_hand: 10, updated_by: null }),
  );
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.files = {};
  st.uploads = [];
  st.audits = [];
  st.lotSources = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("R50 A3 - the pure core", () => {
  it("self-tests pass at the runner floor", () => {
    expect(pv.__runBulkPreviewCoreTests()).toEqual({ passed: 28, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("bulk-preview-core", __runBulkPreviewCoreTests(), 28)');
  });
});

describe("R50 A3 - vendor lab results preview (S12b dry run)", () => {
  function scene() {
    rebuilt(1, [["B1a", "L1"], ["B1b", "L1"], ["B1c", null]]);
    rebuilt(2, [["B2a", "L2"], ["B2b", "LX"]]);
    rebuilt(3, [["B3a", "L3"], ["B3b", "L3"]]);
    // L3 is already on file: reused, never duplicated. One lot already has a certificate; one is destroyed.
    st.db.rows("lab_results").push({ id: labId(9), labtest_external_identifier: "L3", created_at: "2026-01-01T00:00:00Z" });
    st.db.rows("inventory_lots").find((l) => l.id === lid(2, 1))!.lab_result_id = "keep-me";
    st.db.rows("inventory_lots").find((l) => l.id === lid(1, 1))!.status = "destroyed";
  }

  it("writes nothing at all: no lab result, no lot link, no timeline line, no audit", async () => {
    scene();
    const lotsBefore = JSON.stringify(st.db.rows("inventory_lots"));
    const r = await runWciaBackfill(null, ACTOR, { admin: admin(), dryRun: true });
    expect(r).toMatchObject({ ok: true, done: true });
    expect(writes()).toEqual([]);
    expect(st.audits).toEqual([]);
    expect(st.db.rows("lab_results")).toHaveLength(1);
    expect(st.db.rows("manifest_events")).toHaveLength(0);
    expect(JSON.stringify(st.db.rows("inventory_lots"))).toBe(lotsBefore);
  });

  it("its counts are exactly what the real run then does on the same data", async () => {
    scene();
    const dry = await runWciaBackfill(null, ACTOR, { admin: admin(), dryRun: true });
    const real = await runWciaBackfill(null, ACTOR, { admin: admin() });
    expect(dry.ok && real.ok).toBe(true);
    const pick = (t: typeof dry.totals) => ({ manifests: t.manifests, attached: t.attached, linked: t.linked, created: t.created, reused: t.reused, outcomes: t.outcomes });
    expect(pick(dry.totals)).toEqual(pick(real.totals));
    expect(dry.totals.linked).toBeGreaterThan(0);
    expect(dry.totals.reused).toBe(1);
    // Only the real run writes, and audits once.
    expect(st.audits).toHaveLength(1);
    // The note speaks in would-words and says nothing was written.
    const note = pv.wciaPreviewNote(dry);
    expect(note.startsWith(pv.PREVIEW_PREFIX)).toBe(true);
    expect(note).toContain(`would link ${dry.totals.linked} lots`);
  });

  it("after the real run a second preview shows nothing left to do", async () => {
    scene();
    await runWciaBackfill(null, ACTOR, { admin: admin() });
    const before = writes().length;
    const again = await runWciaBackfill(null, ACTOR, { admin: admin(), dryRun: true });
    expect(again.totals).toMatchObject({ linked: 0, created: 0 });
    expect(writes().length).toBe(before);
  });

  it("a paused preview resumes with its own checkpoint and still writes nothing", async () => {
    for (let n = 1; n <= 4; n++) rebuilt(n, [[`B${n}`, `L${n}`]]);
    let clock = 0;
    st.db.before = (q) => {
      if (q.table === "inventory_lots" && q.method === "GET") clock += 10_000;
    };
    const first = await runWciaBackfill(null, ACTOR, { admin: admin(), dryRun: true, now: () => clock, budgetMs: 35_000 });
    expect(first).toMatchObject({ ok: true, done: false });
    expect(pv.wciaPreviewNote(first)).toContain("Continue preview");
    clock = 0;
    const second = await runWciaBackfill(first.next, ACTOR, { admin: admin(), dryRun: true, now: () => clock, budgetMs: 35_000 });
    expect(second).toMatchObject({ ok: true, done: true });
    expect(first.totals.manifests + second.totals.manifests).toBe(4);
    expect(writes()).toEqual([]);
    expect(st.audits).toEqual([]);
  });

  it("a database failure stops honestly, still with no audit", async () => {
    st.db.before = (req) => (req.method === "GET" ? { status: 500, body: { message: "db down", code: "XX000" } } : undefined);
    const r = await runWciaBackfill(null, ACTOR, { admin: admin(), dryRun: true });
    expect(r.ok).toBe(false);
    expect(pv.wciaPreviewTone(r)).toBe("warn");
    expect(pv.wciaPreviewNote(r)).toContain("The preview stopped:");
    expect(st.audits).toEqual([]);
  });
});

describe("R50 A3 - certificate copies preview (S13)", () => {
  const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
  function lab(n: number, url: string | null, stored: string | null = null) {
    st.db.rows("lab_results").push({ id: labId(n), labtest_external_identifier: `WA-${n}`, coa_url: url, coa_storage_path: stored, coa_file_bytes: null, coa_archived_at: null });
  }
  function scene() {
    lab(1, "https://certs.conflabs.com/a.pdf");
    lab(2, "https://certs.conflabs.com/b.pdf");
    lab(3, "https://lab.example.com/c.pdf");
    lab(4, "http://insecure.example.com/d.pdf");
    lab(5, "https://127.0.0.1/e.pdf");
    lab(6, "not a url");
    lab(7, "https://certs.conflabs.com/z.pdf", "already/stored.pdf"); // has its copy: never a candidate
    lab(8, null); // no link: never a candidate
  }

  it("reads only: no fetch, no upload, no write, no audit; counts the same candidates and bad links", async () => {
    scene();
    const before = JSON.stringify(st.db.rows("lab_results"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await previewCoaArchiveBackfill({ admin: admin() });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(r).toMatchObject({ ok: true, capped: false });
    if (!r.ok) return;
    expect(r.preview).toMatchObject({ candidates: 6, fetchable: 3, bad: { "not-https": 1, "private-host": 1, malformed: 1, blank: 0 } });
    expect(r.preview.hosts[0]).toEqual({ host: "certs.conflabs.com", n: 2 });
    expect(writes()).toEqual([]);
    expect(st.uploads).toEqual([]);
    expect(st.audits).toEqual([]);
    expect(JSON.stringify(st.db.rows("lab_results"))).toBe(before);
  });

  it("equals the real run: candidates = checked, would-skip = the real run's bad-link outcomes, would-try = archived", async () => {
    scene();
    const p = await previewCoaArchiveBackfill({ admin: admin() });
    const fakeFetch = (async () => new Response(new Uint8Array(PDF), { status: 200, headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch;
    const real = await runCoaArchiveBackfill(null, ACTOR, { admin: admin(), fetchImpl: fakeFetch });
    expect(p.ok && real.ok).toBe(true);
    if (!p.ok) return;
    expect(real.totals.checked).toBe(p.preview.candidates);
    expect(real.totals.outcomes["bad-link"]).toBe(Object.values(p.preview.bad).reduce((s, n) => s + n, 0));
    expect(real.totals.outcomes.archived).toBe(p.preview.fetchable);
    // and afterwards the preview reports only the unusable links left
    const after = await previewCoaArchiveBackfill({ admin: admin() });
    expect(after.ok && after.preview.fetchable).toBe(0);
  });

  it("pages by id keyset and caps honestly", async () => {
    for (let n = 1; n <= 7; n++) lab(n, `https://h${n}.example.com/x.pdf`);
    const all = await previewCoaArchiveBackfill({ admin: admin(), pageSize: 3 });
    expect(all).toMatchObject({ ok: true, capped: false, preview: { candidates: 7 } });
    const gets = st.db.log.filter((q) => q.method === "GET" && q.table === "lab_results");
    expect(gets).toHaveLength(3);
    expect(gets[1].url.searchParams.get("id")).toBe(`gt.${labId(3)}`);
    const capped = await previewCoaArchiveBackfill({ admin: admin(), pageSize: 3, max: 4 });
    expect(capped).toMatchObject({ ok: true, capped: true, preview: { candidates: 4 } });
    expect(pv.coaPreviewNote(capped)).toContain("there are more");
  });

  it("a read failure is honest", async () => {
    st.db.before = () => ({ status: 500, body: { message: "db down", code: "XX000" } });
    const r = await previewCoaArchiveBackfill({ admin: admin() });
    expect(r).toEqual({ ok: false, error: "the lab results could not be read (db down)" });
  });
});

describe("R50 A3 - fill received dates & cannabinoids preview (R15a dry run)", () => {
  const src = (bc: string, received: string, thc: number | null) => ({
    posProductKey: "pos-1",
    itemName: "Blue Dream",
    barcode: bc,
    productName: "Blue Dream 3.5g",
    category: "Flower",
    inventoryType: "Usable Marijuana",
    strainName: "Blue Dream",
    strainType: "hybrid",
    brand: "Acme",
    vendor: "Acme Farms",
    units: 5,
    costRaw: "$5.00",
    receivedDateRaw: received,
    expirationDateRaw: "",
    coaRaw: "Y",
    isMedical: false,
    isSample: false,
    unitWeight: 3.5,
    unitWeightUom: "g",
    totalRaw: thc,
    thcRaw: thc,
    thcaRaw: null,
    cbdRaw: null,
    cbdaRaw: null,
  });
  function scene() {
    st.db.rows("pos_imports").push({ id: IMP, products_storage_key: "p.xlsx", inventories_storage_key: "i.xlsx", is_test: false });
    st.files["p.xlsx"] = Buffer.from("p");
    st.files["i.xlsx"] = Buffer.from("i");
    st.lotSources = [src("A1", "01/05/2026", 20), src("A2", "01/05/2026", 21), src("A3", "02/07/2026", null), src("A4", "02/07/2026", 22)];
    const lot = (id: string, ext: string, extra: Row = {}) =>
      st.db.rows("inventory_lots").push({ id, ccrs_inventory_external_id: ext, received_on: null, minor_cannabinoids_json: null, pos_thc: null, pos_thca: null, pos_cbd: null, pos_cbda: null, ...extra });
    lot(lid(1, 1), "A1");
    lot(lid(1, 2), "A2", { received_on: "2026-01-01" }); // owner-set date: kept
    lot(lid(1, 3), "A3");
    lot(lid(1, 4), "A4", { pos_thc: 19 }); // potency already set: kept
  }

  it("writes nothing and its counts equal the real fill", async () => {
    scene();
    const before = JSON.stringify(st.db.rows("inventory_lots"));
    const dry = await fillImportLotFacts(IMP, { dryRun: true });
    expect(writes()).toEqual([]);
    expect(JSON.stringify(st.db.rows("inventory_lots"))).toBe(before);
    expect(dry.matched).toBe(4);
    const real = await fillImportLotFacts(IMP);
    expect(real).toEqual(dry);
    expect(real.datesFilled).toBe(3);
    expect(st.db.rows("inventory_lots").find((l) => l.id === lid(1, 2))?.received_on).toBe("2026-01-01");
    const again = await fillImportLotFacts(IMP, { dryRun: true });
    expect(again).toMatchObject({ datesFilled: 0, potencyFilled: 0 });
    expect(pv.factFillPreviewNote({ matched: again.matched, datesWould: 0, potencyWould: 0, potencyColumnsPresent: true })).toContain("would change nothing");
  });

  it("refuses a test import exactly like the real fill", async () => {
    scene();
    st.db.rows("pos_imports")[0].is_test = true;
    await expect(fillImportLotFacts(IMP, { dryRun: true })).rejects.toThrow(/TEST import/);
  });
});

describe("R50 A3 - wiring", () => {
  const drafts = read("src/app/admin/inventory/drafts/actions.ts");
  const page = read("src/app/admin/inventory/drafts/page.tsx");
  const imports = read("src/app/admin/menu-imports/actions.ts");
  const importPage = read("src/app/admin/menu-imports/[id]/page.tsx");
  const body = (src: string, name: string) => {
    const i = src.indexOf(`export async function ${name}`);
    expect(i).toBeGreaterThan(-1);
    const j = src.indexOf("\nexport async function", i + 10);
    return src.slice(i, j < 0 ? undefined : j);
  };

  it("each preview action is permission-gated, dry, and never audits or revalidates", () => {
    const w = body(drafts, "previewWciaBackfillAction");
    expect(w.slice(0, 200)).toContain('await requirePermission("inventory.manage")');
    expect(w).toContain("{ dryRun: true }");
    const c = body(drafts, "previewCoaArchiveBackfillAction");
    expect(c.slice(0, 200)).toContain('await requirePermission("inventory.manage")');
    expect(c).toContain("previewCoaArchiveBackfill()");
    expect(c).not.toContain("runCoaArchiveBackfill(");
    const f = body(imports, "previewLotFactsAction");
    expect(f.slice(0, 200)).toContain('await requirePermission("inventory.manage")');
    expect(f).toContain("fillImportLotFacts(importId, { dryRun: true })");
    for (const b of [w, c, f]) {
      expect(b).not.toContain("recordAudit");
      expect(b).not.toContain("revalidatePath");
    }
  });

  it("the buttons sit beside the real ones, with their own result keys", () => {
    expect(page).toContain("<form action={previewWciaBackfillAction}");
    expect(page).toContain("<form action={previewCoaArchiveBackfillAction}");
    expect(page).toContain("parseBackfillCursor(sp.lab_pv_next)");
    for (const k of ["lab_pv?: string", "lab_pv_msg?: string", "lab_pv_next?: string", "coa_pv?: string", "coa_pv_msg?: string"]) expect(page).toContain(k);
    expect(page.indexOf('data-testid="wcia-preview"')).toBeGreaterThan(page.indexOf('data-testid="wcia-backfill-button"'));
    expect(page.indexOf('data-testid="coa-preview"')).toBeGreaterThan(page.indexOf('data-testid="coa-backfill-button"'));
    expect(importPage).toContain("<form action={previewLotFactsAction}");
    expect(importPage).toContain("facts_pv?: string");
    expect(importPage.indexOf('data-testid="lot-plan-fill-facts-preview"')).toBeGreaterThan(importPage.indexOf('data-testid="lot-plan-fill-facts"'));
  });

  it("receiving never takes the dry-run path", () => {
    expect(read("src/lib/inventory/intake-store.ts")).not.toContain("dryRun");
  });
});
