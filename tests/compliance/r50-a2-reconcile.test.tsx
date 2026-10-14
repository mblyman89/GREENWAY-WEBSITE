/**
 * tests/compliance/r50-a2-reconcile.test.tsx  (R50 A2)
 *
 * "Do the units balance?" - the go / no-go page after the Cultivera import.
 *
 *   1. loader (real postgrest-js against FakePostgrest + an in-memory pos-raw
 *      bucket serving a REAL .xlsx built with the xlsx library): the import's
 *      own file vs the lots on its manifests (incl. a re-homed one), the
 *      elsewhere lookup by CCRS id, notes from audit_logs, and every failure
 *      path (test import, no file, bad file, failed lot read = NO-GO, failed
 *      elsewhere / notes reads reported, never "balanced").
 *   2. actions (behavioural): permission per button, note validation, the
 *      write is CHECKED (a failed insert says NOT saved), sign-off re-checks on
 *      the server and refuses NO-GO, "Create the missing lots" calls the
 *      import's own idempotent backfill, filters survive the round trip.
 *   3. CSV route + page render (verdict, checks, groups, lookup, lines, notes,
 *      paging, fix buttons by role).
 *   4. wiring pins + the real Cultivera export balances (when present).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import * as XLSX from "xlsx";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  svc: true,
  role: "owner",
  calls: [] as string[],
  audits: [] as Array<{ action: string; entityId: unknown; after: unknown }>,
  files: new Map<string, Uint8Array>(),
  dlError: null as string | null,
  backfill: { created: 0, alreadyPresent: 0, totalNow: 0 } as { created: number; alreadyPresent: number; totalNow: number },
  backfillThrows: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => st.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "bbbbbbbb-0000-4000-8000-000000000001", email: "m@x", profile: { role: st.role } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: unknown; after: unknown }) => {
    st.audits.push({ action: a.action, entityId: a.entityId, after: a.after });
  },
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient: PC } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () =>
      Object.assign(new PC("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }), {
        storage: {
          from: (bucket: string) => ({
            download: async (key: string) => {
              st.calls.push(`download:${bucket}/${key}`);
              if (st.dlError) return { data: null, error: { message: st.dlError } };
              const b = st.files.get(`${bucket}/${key}`);
              return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: "Object not found" } };
            },
          }),
        },
      }),
  };
});
vi.mock("@/lib/supabase/env", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    get isSupabaseServiceConfigured() {
      return st.svc;
    },
  };
});
vi.mock("@/lib/pos/import-service", () => ({
  backfillImportLots: async (importId: string, actor: string | null) => {
    st.calls.push(`backfill:${importId}:${actor}`);
    if (st.backfillThrows) throw new Error(st.backfillThrows);
    return st.backfill;
  },
}));

const core = await import("@/lib/pos/cultivera-reconcile-core");
const srv = await import("@/lib/pos/cultivera-reconcile");
const actions = await import("@/app/admin/menu-imports/reconcile/actions");
const { GET: csvGET } = await import("@/app/admin/menu-imports/reconcile/csv/route");
const { default: ReconcilePage } = await import("@/app/admin/menu-imports/reconcile/page");
const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const IMP = "aaaaaaaa-1111-4111-8111-111111111111";
const M1 = "m0000000-0000-4000-8000-000000000001"; // POS-IMPORT synthetic
const M2 = "m0000000-0000-4000-8000-000000000002"; // re-homed (S2c)
const MOLD = "m0000000-0000-4000-8000-000000000099"; // an earlier delivery
const KEY = `${IMP}/inventories.xlsx`;

function workbook(rows: Record<string, unknown>[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventories");
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}
const r = (Barcode: string, units: unknown, o: Record<string, unknown> = {}) => ({ Barcode, Product: `P ${Barcode}`, Vendor: "Acme", Category: "Flower", "Units Available For Sale": units, ...o });
let lotSeq = 0;
function lot(code: string | null, rec: number | string, manifest = M1, extra: Record<string, unknown> = {}) {
  lotSeq += 1;
  const id = `10000000-0000-4000-8000-${String(lotSeq).padStart(12, "0")}`;
  st.db.rows("inventory_lots").push({ id, lot_code: code, received_qty: rec, on_hand_qty: rec, status: "active", manifest_id: manifest, ccrs_inventory_external_id: code, ...extra });
  return id;
}

function seed(fileRows: Record<string, unknown>[], o: { is_test?: boolean; key?: string | null } = {}) {
  st.db.rows("pos_imports").push({
    id: IMP,
    created_at: "2026-10-31T07:00:00Z",
    status: "published",
    is_test: o.is_test ?? false,
    inventories_storage_key: o.key === undefined ? KEY : o.key,
    inventories_filename: "INVENTORIES.xlsx",
  });
  st.db.rows("inbound_manifests").push(
    { id: M1, manifest_number: `POS-IMPORT-${IMP.slice(0, 8)}`, raw_payload: { kind: "pos-import-migration", import_id: IMP } },
    { id: M2, manifest_number: "WA-123", raw_payload: { kind: "cultivera-reconstructed", import_id: IMP } },
    { id: MOLD, manifest_number: "OLD-1", raw_payload: { kind: "vendor-delivery" } },
  );
  st.files.set(`pos-raw/${KEY}`, workbook(fileRows));
}

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_REDIRECT;")) return decodeURIComponent(d.slice("NEXT_REDIRECT;".length).replace(/\+/g, " "));
    throw e;
  }
  throw new Error("expected a redirect");
}
async function page(sp: Record<string, string>) {
  return renderToStaticMarkup(await ReconcilePage({ searchParams: Promise.resolve(sp) }));
}

beforeEach(() => {
  st.db = new FakePostgrest();
  st.svc = true;
  st.role = "owner";
  st.calls = [];
  st.audits = [];
  st.files = new Map();
  st.dlError = null;
  st.backfill = { created: 0, alreadyPresent: 0, totalNow: 0 };
  st.backfillThrows = null;
  lotSeq = 0;
});

describe("A2 pure core self-tests", () => {
  it("passes every self-test", () => {
    const res = core.__runCultiveraReconcileCoreTests();
    expect(res.failed).toBe(0);
    expect(res.passed).toBeGreaterThanOrEqual(95);
  });
});

describe("A2 loader", () => {
  it("balanced: file units = lots on both manifests (re-homed lots followed) -> GO", async () => {
    seed([r("A", 3), r("A", 2), r("B", "4"), r("Z", 0)]);
    lot("A", 5, M1);
    lot("B", 4, M2);
    const res = await srv.loadReconcile(createSupabaseAdminClient(), IMP);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.go).toBe(true);
    expect(res.report.totals).toMatchObject({ cultivera: 9, ours: 9, barcodes: 2, lots: 2 });
    expect(res.report.info.zeroUnitRows).toBe(1);
    expect(res.manifestIds.sort()).toEqual([M1, M2].sort());
    expect(st.calls).toContain(`download:pos-raw/${KEY}`);
  });

  it("an earlier delivery's lot is NOT counted as ours, but names the missing barcode (elsewhere)", async () => {
    seed([r("A", 3), r("B", 2)]);
    lot("A", 3, M1);
    const old = lot("B", 2, MOLD);
    const res = await srv.loadReconcile(createSupabaseAdminClient(), IMP);
    if (!res.ok) throw new Error(res.error);
    expect(res.report.go).toBe(false);
    expect(res.report.totals.ours).toBe(3);
    const b = res.report.mismatches.find((l) => l.barcode === "B")!;
    expect(b.kind).toBe("missing_lot");
    expect(b.elsewhere).toBe(true);
    expect(b.lotIds).toEqual([old]);
    // the elsewhere query asked by the import's own dedupe key
    const q = st.db.log.find((x) => x.table === "inventory_lots" && x.url.searchParams.has("ccrs_inventory_external_id"));
    expect(q?.url.searchParams.get("ccrs_inventory_external_id")).toBe("in.(B)");
  });

  it("units differ, extra lot, not-whole and destroyed lots (destroyed still counted: received is what the import wrote)", async () => {
    seed([r("A", 3), r("B", 2), r("C", 1)]);
    lot("A", 4);
    lot("B", 2, M1, { status: "destroyed", on_hand_qty: 0 });
    lot("C", "1.5");
    lot("X", 7);
    const res = await srv.loadReconcile(createSupabaseAdminClient(), IMP);
    if (!res.ok) throw new Error(res.error);
    const kinds = res.report.mismatches.map((l) => `${l.kind}:${l.barcode}`);
    expect(kinds).toEqual(["not_whole:C", "units_differ:A", "extra_lot:X"]);
    expect(res.report.totals.ours).toBe(4 + 2 + 7);
  });

  it("a failed lot read is NO-GO with the reason (never balanced)", async () => {
    seed([r("A", 3)]);
    lot("A", 3);
    st.db.before = (req) => (req.table === "inventory_lots" && req.url.searchParams.has("manifest_id") ? { status: 500, body: { message: "boom" } } : undefined);
    const res = await srv.loadReconcile(createSupabaseAdminClient(), IMP);
    if (!res.ok) throw new Error(res.error);
    expect(res.report.go).toBe(false);
    expect(res.report.checks[0]).toMatchObject({ id: "reads", pass: false });
    expect(res.report.checks[0].detail).toContain("Could not read every lot");
    expect(core.verdictFor(res.report, new Map()).verdict).toBe("no_go");
  });

  it("a failed manifest read is NO-GO too", async () => {
    seed([r("A", 3)]);
    st.db.before = (req) => (req.table === "inbound_manifests" ? { status: 500, body: { message: "down" } } : undefined);
    const res = await srv.loadReconcile(createSupabaseAdminClient(), IMP);
    if (!res.ok) throw new Error(res.error);
    expect(res.report.checks[0].pass).toBe(false);
    expect(res.report.go).toBe(false);
  });

  it("failed elsewhere / notes reads are reported, lines stay red, notes not applied", async () => {
    seed([r("A", 3), r("B", 2)]);
    lot("A", 3);
    st.db.before = (req) =>
      (req.table === "inventory_lots" && req.url.searchParams.has("ccrs_inventory_external_id")) || req.table === "audit_logs" ? { status: 500, body: { message: "x" } } : undefined;
    const res = await srv.loadReconcile(createSupabaseAdminClient(), IMP);
    if (!res.ok) throw new Error(res.error);
    expect(res.elsewhereError).toContain("Could not check whether the missing barcodes");
    expect(res.notesError).toContain("Could not load your notes");
    expect(res.report.go).toBe(false);
    expect(res.report.mismatches[0].elsewhere).toBeUndefined();
  });

  it("refuses: bad id, unknown import, test import, no stored file, missing object, unreadable file", async () => {
    const a = createSupabaseAdminClient();
    expect(await srv.loadReconcile(a, "x;drop")).toMatchObject({ ok: false, error: "That import id is not valid." });
    expect(await srv.loadReconcile(a, IMP)).toMatchObject({ ok: false, error: "That import was not found." });
    seed([r("A", 1)], { is_test: true });
    expect((await srv.loadReconcile(a, IMP)) as { error: string }).toMatchObject({ ok: false });
    expect(((await srv.loadReconcile(a, IMP)) as { error: string }).error).toContain("test import");
    st.db.rows("pos_imports")[0].is_test = false;
    st.db.rows("pos_imports")[0].inventories_storage_key = null;
    expect(((await srv.loadReconcile(a, IMP)) as { error: string }).error).toContain("no stored Cultivera inventories file");
    st.db.rows("pos_imports")[0].inventories_storage_key = KEY;
    st.dlError = "Bucket not found";
    expect(((await srv.loadReconcile(a, IMP)) as { error: string }).error).toContain("Bucket not found");
    st.dlError = null;
    st.files.set(`pos-raw/${KEY}`, new Uint8Array([1, 2, 3]));
    const bad = (await srv.loadReconcile(a, IMP)) as { ok: boolean; error: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("could not be opened");
    expect(bad.error).toContain("does not look like Cultivera's inventories export");
    expect(bad.error).toContain("Units Available For Sale");
  });

  it("parses the workbook the transform's way: keys + values whitespace-normalised, 'Inventories' sheet preferred", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Barcode: "NOPE", Product: "x", "Units Available For Sale": 99 }]), "Other");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ " Barcode ": "  A  ", Product: " P  A ", "Units  Available For Sale": "1,204" }]), "Inventories");
    const rows = srv.readInventoryRows(new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer));
    expect(rows).toEqual([{ Barcode: "A", Product: "P A", "Units Available For Sale": "1,204" }]);
    expect(core.fileSide(rows).byBarcode.get("A")?.units).toBe(1204);
  });

  it("notes: explain then unexplain, latest wins; sign-off is the last one", async () => {
    seed([r("A", 3)]);
    lot("A", 4);
    const k = "units_differ|A|3|4";
    st.db.rows("audit_logs").push(
      { id: 1, action: core.RECONCILE_EXPLAIN_ACTION, actor_email: "o@x", entity_type: "pos_import", entity_id: IMP, after_json: { key: k, note: "first" }, created_at: "2026-10-31T08:00:00Z" },
      { id: 2, action: core.RECONCILE_EXPLAIN_ACTION, actor_email: "o@x", entity_type: "pos_import", entity_id: "other", after_json: { key: k, note: "other import" }, created_at: "2026-10-31T09:00:00Z" },
      { id: 3, action: core.RECONCILE_SIGNOFF_ACTION, actor_email: "o@x", entity_type: "pos_import", entity_id: IMP, after_json: { verdict: "go_explained", cultivera: 3, ours: 4, open: 0 }, created_at: "2026-10-31T10:00:00Z" },
    );
    const res = await srv.loadReconcile(createSupabaseAdminClient(), IMP);
    if (!res.ok) throw new Error(res.error);
    expect(res.explanations.get(k)?.note).toBe("first");
    expect(res.lastSignOff).toMatchObject({ verdict: "go_explained", cultivera: 3, ours: 4, by: "o@x" });
    expect(core.verdictFor(res.report, res.explanations).verdict).toBe("go_explained");
    st.db.rows("audit_logs").push({ id: 4, action: core.RECONCILE_UNEXPLAIN_ACTION, actor_email: "o@x", entity_type: "pos_import", entity_id: IMP, after_json: { key: k }, created_at: "2026-10-31T11:00:00Z" });
    const res2 = await srv.loadReconcile(createSupabaseAdminClient(), IMP);
    if (!res2.ok) throw new Error(res2.error);
    expect(res2.explanations.has(k)).toBe(false);
  });

  it("lists only non-test imports; a failed list read throws", async () => {
    seed([r("A", 1)]);
    st.db.rows("pos_imports").push({ id: "bbbbbbbb-2222-4222-8222-222222222222", created_at: "2026-10-30T00:00:00Z", status: "staged", is_test: true, inventories_storage_key: "k", inventories_filename: null });
    expect((await srv.listReconcileImports(createSupabaseAdminClient())).map((i) => i.id)).toEqual([IMP]);
    st.db.before = (req) => (req.table === "pos_imports" ? { status: 500, body: { message: "x" } } : undefined);
    await expect(srv.listReconcileImports(createSupabaseAdminClient())).rejects.toThrow("Could not list the imports");
  });

  it("elsewhere lookup chunks long lists and ignores lots on the import's own manifests", async () => {
    const ids = Array.from({ length: 160 }, (_, i) => `BC${i}`);
    for (const b of ids) lot(b, 1, MOLD);
    lot("BC0", 1, M1);
    const m = await srv.lotsElsewhere(createSupabaseAdminClient(), ids, [M1]);
    expect(m.size).toBe(160);
    expect(m.get("BC0")?.length).toBe(1);
    expect(st.db.log.filter((x) => x.table === "inventory_lots").length).toBe(2);
  });
});

describe("A2 actions", () => {
  const base = { importId: IMP, keep_kind: "units_differ", keep_q: "A" };

  it("explain: menu.import, validated, saved to audit_logs, filters kept", async () => {
    const url = await redirectOf(actions.explainLineAction(fd({ ...base, key: "units_differ|A|3|4", note: "  moved   by rebuild " })));
    expect(st.calls).toContain("perm:menu.import");
    expect(url).toContain("import=" + IMP);
    expect(url).toContain("kind=units_differ");
    expect(url).toContain("q=A");
    expect(url).toContain("notice=Note saved");
    const row = st.db.rows("audit_logs")[0];
    expect(row).toMatchObject({ action: core.RECONCILE_EXPLAIN_ACTION, entity_type: "pos_import", entity_id: IMP, actor_email: "m@x", after_json: { key: "units_differ|A|3|4", note: "moved by rebuild" } });
  });

  it("explain refuses a short note / bad key / bad import id without writing", async () => {
    expect(await redirectOf(actions.explainLineAction(fd({ ...base, key: "units_differ|A|3|4", note: "x" })))).toContain("error=Write a short note");
    expect(await redirectOf(actions.explainLineAction(fd({ ...base, key: "nope", note: "fine note" })))).toContain("could not be identified");
    expect(await redirectOf(actions.explainLineAction(fd({ importId: "bad id!", key: "units_differ|A|3|4", note: "fine" })))).toContain("Missing or invalid import id");
    expect(st.db.rows("audit_logs")).toHaveLength(0);
  });

  it("a failed insert says the note was NOT saved", async () => {
    st.db.before = (req) => (req.table === "audit_logs" ? { status: 500, body: { message: "disk full" } } : undefined);
    const url = await redirectOf(actions.explainLineAction(fd({ ...base, key: "units_differ|A|3|4", note: "fine note" })));
    expect(url).toContain("error=Your note was NOT saved: disk full");
    expect(st.calls.some((c) => c.startsWith("revalidate:"))).toBe(false);
  });

  it("unexplain writes an unexplain event", async () => {
    const url = await redirectOf(actions.unexplainLineAction(fd({ ...base, key: "units_differ|A|3|4" })));
    expect(url).toContain("notice=Note removed");
    expect(st.db.rows("audit_logs")[0]).toMatchObject({ action: core.RECONCILE_UNEXPLAIN_ACTION, after_json: { key: "units_differ|A|3|4" } });
  });

  it("sign-off: menu.publish, needs the tick, re-checks on the server, refuses NO-GO", async () => {
    seed([r("A", 3)]);
    lot("A", 4);
    expect(await redirectOf(actions.signOffAction(fd({ importId: IMP })))).toContain("Tick the box");
    expect(st.calls).toContain("perm:menu.publish");
    const refused = await redirectOf(actions.signOffAction(fd({ importId: IMP, confirm: "yes" })));
    expect(refused).toContain("Cannot sign off: 1 line(s) are still unexplained");
    expect(st.db.rows("audit_logs").filter((x) => x.action === core.RECONCILE_SIGNOFF_ACTION)).toHaveLength(0);
    // explain it, then sign-off works and records the numbers
    await redirectOf(actions.explainLineAction(fd({ importId: IMP, key: "units_differ|A|3|4", note: "checked shelf" })));
    st.db.rows("audit_logs")[0].created_at = "2026-10-31T08:00:00Z";
    const ok = await redirectOf(actions.signOffAction(fd({ importId: IMP, confirm: "yes" })));
    expect(ok).toContain("notice=Signed off");
    const so = st.db.rows("audit_logs").find((x) => x.action === core.RECONCILE_SIGNOFF_ACTION)!;
    expect(so.after_json).toMatchObject({ verdict: "go_explained", cultivera: 3, ours: 4, open: 0, explainedKeys: ["units_differ|A|3|4"] });
  });

  it("sign-off refuses when notes cannot be read (cannot prove explained)", async () => {
    seed([r("A", 3)]);
    lot("A", 3);
    st.db.before = (req) => (req.table === "audit_logs" && req.method === "GET" ? { status: 500, body: { message: "x" } } : undefined);
    expect(await redirectOf(actions.signOffAction(fd({ importId: IMP, confirm: "yes" })))).toContain("Cannot sign off: Could not load your notes");
  });

  it("sign-off on a clean GO records verdict go", async () => {
    seed([r("A", 3)]);
    lot("A", 3);
    await redirectOf(actions.signOffAction(fd({ importId: IMP, confirm: "yes" })));
    expect(st.db.rows("audit_logs")[0].after_json).toMatchObject({ verdict: "go", open: 0 });
  });

  it("sign-off refuses a load error (e.g. test import)", async () => {
    seed([r("A", 3)], { is_test: true });
    expect(await redirectOf(actions.signOffAction(fd({ importId: IMP, confirm: "yes" })))).toContain("test import");
  });

  it("create missing lots: menu.publish, the import's own backfill, audited, plain result", async () => {
    st.backfill = { created: 4, alreadyPresent: 10, totalNow: 14 };
    const url = await redirectOf(actions.createMissingLotsAction(fd({ importId: IMP })));
    expect(st.calls).toContain("perm:menu.publish");
    expect(st.calls).toContain(`backfill:${IMP}:bbbbbbbb-0000-4000-8000-000000000001`);
    expect(url).toContain("notice=Created 4 missing lot(s)");
    expect(st.audits[0]).toMatchObject({ action: "pos_import.backfill_lots", entityId: IMP, after: { created: 4, from: "reconcile" } });
    st.backfill = { created: 0, alreadyPresent: 14, totalNow: 14 };
    expect(await redirectOf(actions.createMissingLotsAction(fd({ importId: IMP })))).toContain("No lots were missing to create (14 already exist)");
    st.backfillThrows = "Backfill refused: this is a TEST import.";
    expect(await redirectOf(actions.createMissingLotsAction(fd({ importId: IMP })))).toContain("error=Backfill refused");
  });

  it("supabase off: notes refused politely", async () => {
    st.svc = false;
    expect(await redirectOf(actions.explainLineAction(fd({ ...base, key: "units_differ|A|3|4", note: "fine" })))).toContain("Supabase is not configured");
  });
});

describe("A2 CSV route", () => {
  it("every line, filters applied, BOM + headers, formula-safe", async () => {
    seed([r("A", 3), r("=B", 2, { Product: "=HYPERLINK(1)" })]);
    lot("A", 4);
    const res = await csvGET(new Request(`http://x/admin/menu-imports/reconcile/csv?import=${IMP}`) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain(`cultivera-reconcile-${IMP.slice(0, 8)}.csv`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // UTF-8 BOM so Excel opens accents right (Response.text() would silently drop it)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(body).toContain("'=B");
    expect(body).toContain("'=HYPERLINK(1)");
    const only = await (await csvGET(new Request(`http://x/admin/menu-imports/reconcile/csv?import=${IMP}&kind=units_differ`) as never)).text();
    expect(only.trim().split("\r\n")).toHaveLength(2);
  });

  it("refuses with the reason", async () => {
    const res = await csvGET(new Request(`http://x/admin/menu-imports/reconcile/csv?import=${IMP}`) as never);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("not found");
  });
});

describe("A2 page", () => {
  it("no import picked: help open, picker defaults to the published import", async () => {
    seed([r("A", 1)]);
    const html = await page({});
    expect(html).toMatch(/<details[^>]*open=""[^>]*data-testid="rc-help"/);
    expect(html).toContain('data-testid="rc-picker"');
    expect(html).toContain("INVENTORIES.xlsx");
    expect(html).not.toContain('data-testid="rc-verdict"');
  });

  it("GO: green verdict, all checks pass, no fix buttons, sign-off offered", async () => {
    seed([r("A", 3), r("B", 2, { Vendor: "Bee", Category: "Edible" })]);
    lot("A", 3);
    lot("B", 2);
    const html = await page({ import: IMP });
    expect(html).toContain('data-verdict="go"');
    expect(html).toContain("GO: the units balance. Cultivera 5 = ours 5");
    expect((html.match(/data-pass="1"/g) ?? []).length).toBe(8);
    expect(html).not.toContain('data-testid="rc-create-missing"');
    expect(html).toContain('data-testid="rc-signoff"');
    expect(html).toContain("None. Every barcode matches.");
  });

  it("NO-GO: red verdict, red groups link to filtered lines, lines with fix copy, lot links, note form, create-missing", async () => {
    seed([r("A", 3), r("B", 2), r("C", 1, { Vendor: "Cee" })]);
    const a = lot("A", 4);
    const html = await page({ import: IMP });
    expect(html).toContain('data-verdict="no_go"');
    expect(html).toContain('data-check="missing" data-pass="0"');
    expect(html).toContain('data-testid="rc-create-missing"');
    expect(html).toContain("2 Cultivera barcode(s) have no lot");
    expect(html).toContain(`/admin/inventory/${a}`);
    expect(html).toContain(core.MISMATCH_FIX.units_differ.slice(0, 40).replace(/'/g, "&#x27;"));
    expect(html).toContain("Save note");
    expect(html).toContain(`/admin/menu-imports/reconcile?import=${IMP}&amp;vendor=Acme`);
    expect(html).toContain(`/admin/menu-imports/reconcile/csv?import=${IMP}`);
    expect(html).not.toContain('data-testid="rc-signoff"');
  });

  it("a manager-less role sees no write buttons, only who can press them", async () => {
    st.role = "budtender";
    seed([r("A", 3), r("B", 2)]);
    lot("A", 3);
    const html = await page({ import: IMP });
    expect(html).toContain("A manager or admin can press");
    expect(html).not.toContain(">Create the missing lots<");
  });

  it("explained lines: note shown with Remove, verdict GO (explained), open filter hides them", async () => {
    seed([r("A", 3)]);
    lot("A", 4);
    st.db.rows("audit_logs").push({ id: 1, action: core.RECONCILE_EXPLAIN_ACTION, actor_email: "o@x", entity_type: "pos_import", entity_id: IMP, after_json: { key: "units_differ|A|3|4", note: "shelf checked" }, created_at: "2026-10-31T08:00:00Z" });
    const html = await page({ import: IMP });
    expect(html).toContain('data-verdict="go_explained"');
    expect(html).toContain("shelf checked");
    expect(html).toContain("Remove note");
    expect(html).toContain('data-testid="rc-signoff"');
    const open = await page({ import: IMP, open: "1" });
    expect(open).toContain("Showing 0 of 0 line(s) (filtered)");
  });

  it("barcode lookup shows both sides", async () => {
    seed([r("A", 3)]);
    lot("A", 4);
    const html = await page({ import: IMP, barcode: "A" });
    expect(html).toContain('data-testid="rc-lookup-result"');
    expect(html).toContain("<b>3</b> units on 1 row(s)");
    expect(html).toContain("received 4");
    const ok = await page({ import: IMP, barcode: "nope" });
    expect(ok).toContain("Not in the file with stock");
  });

  it("paging: 200 per page with next/previous keeping filters", async () => {
    seed(Array.from({ length: 205 }, (_, i) => r(`B${String(i).padStart(3, "0")}`, 1)));
    const html = await page({ import: IMP, kind: "missing_lot" });
    expect(html).toContain("Showing 200 of 205 line(s) (filtered). Page 1 of 2");
    expect(html).toContain(`/admin/menu-imports/reconcile?import=${IMP}&amp;kind=missing_lot&amp;page=2`);
    const p2 = await page({ import: IMP, kind: "missing_lot", page: "2" });
    expect(p2).toContain("Showing 5 of 205");
    expect(p2).toContain("Previous");
  });

  it("load error renders NO-GO with the reason; partial reads warned", async () => {
    seed([r("A", 1)], { is_test: true });
    expect(await page({ import: IMP })).toContain("NO-GO: This is a test import");
    st.db = new FakePostgrest();
    seed([r("A", 3), r("B", 1)]);
    lot("A", 3);
    st.db.before = (req) => (req.table === "audit_logs" ? { status: 500, body: { message: "x" } } : undefined);
    expect(await page({ import: IMP })).toContain('data-testid="rc-partial"');
  });

  it("last sign-off shown, and flagged when the numbers moved since", async () => {
    seed([r("A", 3)]);
    lot("A", 3);
    st.db.rows("audit_logs").push({ id: 1, action: core.RECONCILE_SIGNOFF_ACTION, actor_email: "o@x", entity_type: "pos_import", entity_id: IMP, after_json: { verdict: "go", cultivera: 2, ours: 2, open: 0 }, created_at: "2026-10-31T08:00:00Z" });
    const html = await page({ import: IMP });
    expect(html).toContain("Last signed off by o@x");
    expect(html).toContain("The numbers have changed since then, so sign off again.");
  });
});

describe("A2 wiring pins", () => {
  it("page is menu.import; writes are menu.publish (sign-off, create lots) / menu.import (notes)", () => {
    expect(read("src/app/admin/menu-imports/reconcile/page.tsx")).toContain('requirePermission("menu.import")');
    const a = read("src/app/admin/menu-imports/reconcile/actions.ts");
    expect(a.match(/requirePermission\("menu.publish"\)/g)?.length).toBe(2);
    expect(a.match(/requirePermission\("menu.import"\)/g)?.length).toBe(2);
  });
  it("loader reads the same file + sheet the import re-reads, and never writes lots", () => {
    const s = read("src/lib/pos/cultivera-reconcile.ts");
    expect(s).toContain('RECONCILE_RAW_BUCKET = "pos-raw"');
    expect(s).toContain('RECONCILE_SHEET = "Inventories"');
    expect(s).toContain("{ defval: \"\", raw: false }");
    expect(s).not.toMatch(/from\("inventory_lots"\)\s*\.(insert|update|upsert|delete)/);
    expect(read("src/lib/pos/import-service.ts")).toContain('const POS_RAW_BUCKET = "pos-raw"');
  });
  it("linked from the guide, the cutover runbook and Menu Imports", () => {
    expect(read("src/lib/pos/menu-imports-guide-core.ts")).toContain("/admin/menu-imports/reconcile");
    expect(read("src/app/admin/menu-imports/cutover/page.tsx")).toContain('href="/admin/menu-imports/reconcile"');
    expect(read("src/app/admin/menu-imports/page.tsx")).toContain('href="/admin/menu-imports/reconcile"');
  });
  it("registered in the pure runner", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("cultivera-reconcile-core", __runCultiveraReconcileCoreTests\(\), 95\)/);
  });
});

describe("A2 against the real Cultivera export (when present)", () => {
  const inv = join(ROOT, "back-office/GREENWAY WEBSITE/transformer/inputs/INVENTORIES.xlsx");
  it.skipIf(!existsSync(inv))("the real file reads to 26,249 units over 3,870 barcodes, all whole, no blank products", () => {
    const rows = srv.readInventoryRows(readFileSync(inv));
    const f = core.fileSide(rows);
    let total = f.noBarcodeUnits;
    for (const b of f.byBarcode.values()) total += b.units;
    expect(total).toBe(26249);
    expect(f.byBarcode.size).toBe(3870);
    expect(f.blankProduct).toEqual([]);
    expect(f.noBarcodeRows).toBe(0);
    // lots exactly as planned -> GO
    const lots = [...f.byBarcode.values()].map((b, i) => ({ id: String(i), lot_code: b.barcode, received_qty: b.units, on_hand_qty: b.units }));
    expect(core.reconcile({ file: f, lots, readsComplete: true }).go).toBe(true);
  });
});
