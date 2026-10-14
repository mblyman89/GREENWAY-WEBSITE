/**
 * tests/compliance/r50-a2-helpers.test.tsx  (R50 A2+, owner: "make sure I can work it and fix it")
 *
 * The reconcile page's work-it helpers, behavioural on the same harness as
 * r50-a2-reconcile.test.tsx (real postgrest-js -> FakePostgrest, real .xlsx):
 * bulk note / bulk remove (server re-reads, refuses stale counts, all-or-nothing
 * insert), "Save & next", ?jump= opens the right page and highlights the line,
 * progress bar + "Start working", open counts per vendor/category, note
 * suggestions, latest notes, lookup -> go to the line, CSV shares the filter.
 *
 * (Harness copied from r50-a2-reconcile.test.tsx; original header follows.)
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


const K = (kind: string, b: string, c: number | "", o: number | "") => `${kind}|${b}|${c}|${o}`;
function note(id: number, key: string, text: string, at: string, action = core.RECONCILE_EXPLAIN_ACTION) {
  st.db.rows("audit_logs").push({ id, action, actor_email: "o@x", entity_type: "pos_import", entity_id: IMP, after_json: action === core.RECONCILE_EXPLAIN_ACTION ? { key, note: text } : { key }, created_at: at });
}
/** File A..E 3 each; lots 4 each for A..E = five units_differ lines (Acme: A,B,C; Bee: D,E). */
function fiveDiffs() {
  seed([r("A", 3), r("B", 3), r("C", 3), r("D", 3, { Vendor: "Bee" }), r("E", 3, { Vendor: "Bee" })]);
  for (const b of ["A", "B", "C", "D", "E"]) lot(b, 4);
}
const ud = (b: string) => K("units_differ", b, 3, 4);
const auditKeys = (action: string) => st.db.rows("audit_logs").filter((x) => x.action === action).map((x) => (x.after_json as { key: string }).key);

describe("A2+ bulk note", () => {
  it("puts one note on every OPEN line in the view (all pages), skips explained, one audit row each, marked bulk", async () => {
    fiveDiffs();
    note(1, ud("B"), "already fine", "2026-10-31T08:00:00Z");
    const url = await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, keep_vendor: "Acme", note: "  moved   by rebuild ", expected: "2", confirm: "yes" })));
    expect(st.calls).toContain("perm:menu.import");
    expect(url).toContain("notice=Saved your note on 2 line(s)");
    expect(url).toContain("vendor=Acme");
    const rows = st.db.rows("audit_logs").filter((x) => x.id !== 1);
    expect(rows.map((x) => (x.after_json as { key: string }).key).sort()).toEqual([ud("A"), ud("C")]);
    expect(rows.every((x) => x.action === core.RECONCILE_EXPLAIN_ACTION && x.entity_id === IMP && x.actor_email === "m@x")).toBe(true);
    expect(rows[0].after_json).toEqual({ key: ud("A"), note: "moved by rebuild", bulk: true });
    // the page now reads them as explained: Acme has 0 open, Bee still 2
    const load = await srv.loadReconcile(createSupabaseAdminClient(), IMP);
    if (!load.ok) throw new Error(load.error);
    expect(core.verdictFor(load.report, load.explanations).open).toBe(2);
  });

  it("refuses a stale count (the list changed since the page loaded) and writes NOTHING", async () => {
    fiveDiffs();
    const url = await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, note: "fine note", expected: "4", confirm: "yes" })));
    expect(url).toContain("error=The list changed since the page loaded (it showed 4, now 5). Nothing was saved.");
    expect(st.db.rows("audit_logs")).toHaveLength(0);
  });

  it("refuses: no tick, short note, nothing open, bad id, notes unreadable - nothing written", async () => {
    fiveDiffs();
    expect(await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, note: "fine note", expected: "5" })))).toContain("error=Tick the box");
    expect(await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, note: "x", expected: "5", confirm: "yes" })))).toContain("error=Write a short note");
    expect(await redirectOf(actions.bulkExplainAction(fd({ importId: "bad id!", note: "fine", expected: "5", confirm: "yes" })))).toContain("Missing or invalid import id");
    expect(await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, keep_vendor: "Nobody", note: "fine note", expected: "0", confirm: "yes" })))).toContain("already has a note");
    expect(st.db.rows("audit_logs")).toHaveLength(0);
    st.db.before = (req) => (req.table === "audit_logs" ? { status: 500, body: { message: "notes down" } } : undefined);
    expect(await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, note: "fine note", expected: "5", confirm: "yes" })))).toContain("error=Nothing was saved: Could not load your notes");
  });

  it("a failed insert says Nothing was saved (all or nothing)", async () => {
    fiveDiffs();
    st.db.before = (req) => (req.table === "audit_logs" && req.method === "POST" ? { status: 500, body: { message: "disk full" } } : undefined);
    expect(await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, note: "fine note", expected: "5", confirm: "yes" })))).toContain("error=Nothing was saved: disk full");
    expect(st.db.rows("audit_logs")).toHaveLength(0);
  });

  it("over the cap is refused with how to narrow it", async () => {
    const rows = Array.from({ length: core.RECONCILE_BULK_MAX + 1 }, (_, i) => r(`B${String(i).padStart(4, "0")}`, 1));
    seed(rows);
    const url = await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, note: "fine note", expected: String(rows.length), confirm: "yes" })));
    expect(url).toContain(`That is ${rows.length} lines. Narrow the filter to ${core.RECONCILE_BULK_MAX} or fewer`);
    expect(st.db.rows("audit_logs")).toHaveLength(0);
  });

  it("bulk remove is the undo: un-notes every explained line in the view only", async () => {
    fiveDiffs();
    note(1, ud("A"), "n1", "2026-10-31T08:00:00Z");
    note(2, ud("D"), "n2", "2026-10-31T08:00:00Z");
    const url = await redirectOf(actions.bulkUnexplainAction(fd({ importId: IMP, keep_vendor: "Acme", expected: "1", confirm: "yes" })));
    expect(url).toContain("notice=Removed the notes from 1 line(s)");
    expect(auditKeys(core.RECONCILE_UNEXPLAIN_ACTION)).toEqual([ud("A")]);
    expect(await redirectOf(actions.bulkUnexplainAction(fd({ importId: IMP, keep_vendor: "Acme", expected: "0", confirm: "yes" })))).toContain("No line in this view has a note to remove");
  });

  it("the kept kind / search / open filter decides the lines, exactly like the page", async () => {
    seed([r("A", 3), r("B", 2), r("C", 1)]);
    lot("A", 4);
    lot("X", 1);
    // kind=missing_lot -> B and C only
    await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, keep_kind: "missing_lot", note: "not on the shelf", expected: "2", confirm: "yes" })));
    expect(auditKeys(core.RECONCILE_EXPLAIN_ACTION).sort()).toEqual([K("missing_lot", "B", 2, 0), K("missing_lot", "C", 1, 0)]);
    // q=x -> only the extra lot X
    await redirectOf(actions.bulkExplainAction(fd({ importId: IMP, keep_q: "x", note: "moved here", expected: "1", confirm: "yes" })));
    expect(auditKeys(core.RECONCILE_EXPLAIN_ACTION)).toContain(K("extra_lot", "X", "", 1));
  });
});

describe("A2+ Save & next", () => {
  it("saves, then jumps to the next line WITHOUT a note (anchor + jump key, filters kept)", async () => {
    fiveDiffs();
    const url = await redirectOf(actions.explainLineAction(fd({ importId: IMP, keep_vendor: "Acme", key: ud("A"), note: "fine note", next: "1", next_key: ud("C") })));
    expect(url).toContain("notice=Note saved. Here is the next line without a note.");
    expect(url).toContain(`jump=${ud("C")}`);
    expect(url).toContain("vendor=Acme");
    expect(url.endsWith("#" + core.lineAnchor(ud("C")))).toBe(true);
  });
  it("no next key = it was the last one; a junk next key is ignored (no jump)", async () => {
    fiveDiffs();
    expect(await redirectOf(actions.explainLineAction(fd({ importId: IMP, key: ud("A"), note: "fine note", next: "1" })))).toContain("That was the last line without a note in this view.");
    const junk = await redirectOf(actions.explainLineAction(fd({ importId: IMP, key: ud("A"), note: "fine note", next: "1", next_key: "javascript:alert(1)" })));
    expect(junk).not.toContain("jump=");
    expect(junk).not.toContain("#");
  });
  it("plain Save note does not jump", async () => {
    fiveDiffs();
    const url = await redirectOf(actions.explainLineAction(fd({ importId: IMP, key: ud("A"), note: "fine note", next_key: ud("B") })));
    expect(url).toContain("notice=Note saved. That line now counts as explained.");
    expect(url).not.toContain("jump=");
  });
});

describe("A2+ page helpers", () => {
  it("progress bar, Start working link, first-open link, Save & next with the right next key", async () => {
    fiveDiffs();
    note(1, ud("A"), "shelf ok", "2026-10-31T08:00:00Z");
    const html = await page({ import: IMP });
    expect(html).toContain('data-testid="rc-progress" data-pct="20"');
    expect(html).toContain("4 line(s) open, 1 explained by your notes (20% done)");
    expect(html).toContain('aria-valuenow="20"');
    expect(html).toContain('data-testid="rc-start-working"');
    expect(html).toContain(`jump=${encodeURIComponent(ud("B"))}#${core.lineAnchor(ud("B"))}`);
    expect(html).toContain("4 without a note in this view.");
    expect(html).toContain('data-testid="rc-first-open"');
    // B's form carries next_key = C (A is explained, so it is skipped)
    const bForm = html.slice(html.indexOf(`id="${core.lineAnchor(ud("B"))}"`));
    expect(bForm.slice(0, bForm.indexOf("</li>"))).toContain(`name="next_key" value="${ud("C")}"`);
    expect(html).toContain("Save &amp; next");
  });

  it("?jump= opens the page the line is on and highlights it (overrides ?page)", async () => {
    const rows = Array.from({ length: 205 }, (_, i) => r(`B${String(i).padStart(3, "0")}`, 1));
    seed(rows);
    const key = K("missing_lot", "B203", 1, 0);
    const html = await page({ import: IMP, page: "1", jump: key });
    expect(html).toContain("Page 2 of 2");
    expect(html).toContain(`id="${core.lineAnchor(key)}"`);
    expect(html).toMatch(new RegExp(`id="${core.lineAnchor(key)}"[^>]*data-here="1"`));
    // an unknown jump key falls back to ?page
    expect(await page({ import: IMP, page: "2", jump: "nope" })).toContain("Page 2 of 2");
    expect(await page({ import: IMP, jump: "nope" })).not.toContain('data-here="1"');
  });

  it("open counts per vendor link to that vendor's open lines; fully explained red rows show a tick", async () => {
    fiveDiffs();
    note(1, ud("D"), "ok", "2026-10-31T08:00:00Z");
    note(2, ud("E"), "ok", "2026-10-31T08:00:00Z");
    const html = await page({ import: IMP });
    expect(html).toContain('data-open-group="Acme"');
    expect(html).toContain(`/admin/menu-imports/reconcile?import=${IMP}&amp;vendor=Acme&amp;open=1`);
    expect(html).not.toContain('data-open-group="Bee"');
    expect(html).toContain("\u2713");
  });

  it("note suggestions: datalist per kind on the page, his own latest notes first", async () => {
    fiveDiffs();
    note(1, ud("A"), "My own words", "2026-10-31T08:00:00Z");
    const html = await page({ import: IMP });
    expect(html).toContain('list="rc-presets-units_differ"');
    const dl = html.slice(html.indexOf('<datalist id="rc-presets-units_differ">'));
    const opts = dl.slice(0, dl.indexOf("</datalist>"));
    expect(opts.indexOf("My own words")).toBeGreaterThan(-1);
    expect(opts.indexOf("My own words")).toBeLessThan(opts.indexOf(core.NOTE_PRESETS.units_differ[0]));
    expect(html).toContain('<datalist id="rc-presets-all">');
  });

  it("bulk panel shows the counts it will act on + hidden expected; remove panel only when notes exist", async () => {
    fiveDiffs();
    let html = await page({ import: IMP, vendor: "Acme" });
    expect(html).toContain('data-testid="rc-bulk-explain"');
    expect(html).toContain("Yes, put this note on all 3 open line(s)");
    expect(html).toContain('name="expected" value="3"');
    expect(html).toContain('name="keep_vendor" value="Acme"');
    expect(html).not.toContain('data-testid="rc-bulk-unexplain"');
    note(1, ud("A"), "ok", "2026-10-31T08:00:00Z");
    html = await page({ import: IMP, vendor: "Acme" });
    expect(html).toContain('data-testid="rc-bulk-unexplain"');
    expect(html).toContain("Yes, remove the notes from all 1 line(s)");
  });

  it("latest notes list links back to each line; lookup links to the line", async () => {
    fiveDiffs();
    note(1, ud("A"), "first", "2026-10-31T08:00:00Z");
    note(2, ud("B"), "second", "2026-10-31T09:00:00Z");
    const html = await page({ import: IMP, barcode: "C" });
    const rec = html.slice(html.indexOf('data-testid="rc-recent-notes"'));
    expect(rec.indexOf("second")).toBeLessThan(rec.indexOf("first"));
    expect(html).toContain('data-testid="rc-lookup-goto"');
    expect(html).toContain("Go to the line and write a note");
    expect(await page({ import: IMP, barcode: "A" })).toContain("See its note");
  });

  it("CSV uses the same filter reader (open=1 + vendor)", async () => {
    fiveDiffs();
    note(1, ud("A"), "ok", "2026-10-31T08:00:00Z");
    const res = await csvGET(new Request(`http://x/admin/menu-imports/reconcile/csv?import=${IMP}&vendor=Acme&open=1`) as never);
    const body = await res.text();
    expect(body.trim().split("\r\n")).toHaveLength(3);
    expect(body).not.toContain(",A,P A,");
  });

  it("wiring: bulk actions exported + gated; CSV route uses filterFromParams", () => {
    const a = read("src/app/admin/menu-imports/reconcile/actions.ts");
    expect(a).toContain("export async function bulkExplainAction");
    expect(a).toContain("export async function bulkUnexplainAction");
    expect(read("src/app/admin/menu-imports/reconcile/csv/route.ts")).toContain("filterFromParams((k) => u.searchParams.get(k))");
    expect(read("src/app/admin/menu-imports/reconcile/page.tsx")).toContain("filterFromParams((k) => sp[k as keyof SP])");
  });
});
