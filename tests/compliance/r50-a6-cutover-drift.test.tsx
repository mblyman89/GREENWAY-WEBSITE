/**
 * tests/compliance/r50-a6-cutover-drift.test.tsx  (R50 A6)
 *
 * The daily drift check 11/02-11/08: the core's self-tests (live in the pure
 * runner), the facts the arithmetic depends on read from the code that writes
 * them (sales write no adjustment rows, the event names, the failure notes,
 * the import writes received = on hand), the loader against a fake database
 * (every read is paged, a failed read is red, shared keys are not judged,
 * custom keypad lines are skipped), the page rendering each state, and the
 * one button refusing to record when a read failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

vi.mock("server-only", () => ({}));

const core = await import("@/lib/pos/cutover-drift-core");

/* ------------------------------------------------------------------ */
/* A tiny fake PostgREST: tables of rows, filters, order + range, and  */
/* an optional failure per table.                                      */
/* ------------------------------------------------------------------ */
type Row = Record<string, unknown>;
type DB = Record<string, Row[]>;
function fakeAdmin(db: DB, fail: Set<string> = new Set(), inserted: Row[] = []) {
  const calls: { table: string; select: string }[] = [];
  const from = (table: string) => {
    let rows = [...(db[table] ?? [])];
    let sel = "";
    let single = false;
    const q: Record<string, unknown> = {
      select(s: string) { sel = s; calls.push({ table, select: s }); return q; },
      eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
      neq(c: string, v: unknown) { rows = rows.filter((r) => r[c] !== v); return q; },
      gte(c: string, v: string) { rows = rows.filter((r) => String(r[c]) >= v); return q; },
      in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
      or(expr: string) {
        const m = /payload_import_id\.eq\.([0-9a-f-]+)/.exec(expr);
        rows = rows.filter((r) => (m && r.payload_import_id === m[1]) || String(r.manifest_number ?? "").startsWith("POS-IMPORT-"));
        return q;
      },
      like(c: string, pat: string) { const p = pat.replace(/%$/, ""); rows = rows.filter((r) => String(r[c] ?? "").startsWith(p)); return q; },
      order(c: string) { rows.sort((a, b) => String(a[c]).localeCompare(String(b[c]))); return q; },
      maybeSingle() { single = true; return q; },
      range(a: number, b: number) {
        if (fail.has(table)) return Promise.resolve({ data: null, error: { message: `${table} is down` } });
        return Promise.resolve({ data: rows.slice(a, b + 1), error: null });
      },
      insert(r: Row) { inserted.push({ table, ...r }); return Promise.resolve({ error: fail.has(`insert:${table}`) ? { message: "insert refused" } : null }); },
      then(res: (v: unknown) => void) {
        void sel;
        if (fail.has(table)) return res({ data: null, error: { message: `${table} is down` } });
        res({ data: single ? rows[0] ?? null : rows, error: null });
      },
    };
    return q;
  };
  return { admin: { from } as never, calls, inserted };
}

const IMP = "11111111-2222-4333-8444-555555555555";
const T0 = "2026-11-01T14:20:00Z";
function baseDb(): DB {
  return {
    pos_imports: [{ id: IMP, is_test: false }],
    inbound_manifests: [{ id: "m1", manifest_number: `POS-IMPORT-${IMP.slice(0, 8)}`, payload_kind: null, payload_import_id: null }],
    inventory_lots: [
      { id: "L1", manifest_id: "m1", pos_product_key: "K1", received_qty: 10, on_hand_qty: 7, created_at: T0, product_name: "Blue Dream 1g", category: "Flower", vendor_id: "v1", status: "active" },
      { id: "L2", manifest_id: "m1", pos_product_key: "K2", received_qty: 5, on_hand_qty: 3, created_at: T0, product_name: "Gummies", category: "Edible", vendor_id: "v2", status: "active" },
      { id: "LX", manifest_id: "m9", pos_product_key: "K3", received_qty: 1, on_hand_qty: 1, created_at: T0, product_name: "New delivery", category: "Flower", vendor_id: "v1", status: "active" },
      { id: "L3", manifest_id: "m1", pos_product_key: "K3", received_qty: 4, on_hand_qty: 4, created_at: T0, product_name: "Shared thing", category: "Flower", vendor_id: "v1", status: "active" },
    ],
    vendors: [{ id: "v1", display_name: "Vendor One" }, { id: "v2", display_name: "Vendor Two" }],
    inventory_adjustments: [{ id: "a1", lot_id: "L2", qty_delta: -2, reason: "count" }],
    order_events: [
      { id: "e1", order_id: "o1", event_type: "inventory_decremented", note: "Inventory decremented for 2 line(s)", created_at: "2026-11-02T18:00:00Z" },
      { id: "e0", order_id: "o0", event_type: "inventory_decremented", note: "Inventory decremented", created_at: "2026-10-31T18:00:00Z" },
    ],
    order_lines: [
      { id: "ol1", order_id: "o1", product_id: "K1", variant_id: null, quantity: 3 },
      { id: "ol2", order_id: "o1", product_id: "pos-custom-merch", variant_id: null, quantity: 9 },
      { id: "ol0", order_id: "o0", product_id: "K1", variant_id: null, quantity: 50 },
    ],
    audit_logs: [],
  };
}

describe("R50 A6 · the drift core", () => {
  it("self-tests run (48) and are a live call in the pure runner", () => {
    expect(core.__runCutoverDriftCoreTests()).toEqual({ passed: 48, failed: 0 });
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runCutoverDriftCoreTests } from "../../src/lib/pos/cutover-drift-core";');
    expect(runner).toMatch(/^ {2}assertRan\("cutover-drift-core", __runCutoverDriftCoreTests\(\), 48\);/m);
  });

  it("the window and names are fixed", () => {
    expect([core.DRIFT_FIRST_DAY, core.DRIFT_LAST_DAY, core.DRIFT_DAYS]).toEqual(["2026-11-02", "2026-11-08", 7]);
    expect(core.DRIFT_HREF).toBe("/admin/menu-imports/drift");
    expect(existsSync(join(ROOT, "src/app", core.DRIFT_HREF, "page.tsx"))).toBe(true);
  });
});

describe("R50 A6 · the facts the arithmetic stands on (read from the code that writes them)", () => {
  it("sales write NO adjustment rows and latch with inventory_decremented", () => {
    const s = read("src/lib/inventory/sale-decrement.ts");
    expect(s).toContain("Sales deliberately do NOT write inventory_adjustments rows");
    expect(s).toContain(`const EVENT_TYPE = "${core.DRIFT_SALE_EVENT}";`);
    expect(s).not.toMatch(/from\("inventory_adjustments"\)/);
    expect(s).toContain(".filter((r) => !isCustomLineProductId(r.product_id))");
  });
  it("the failure notes the page detects are the ones the decrement writes", () => {
    const s = read("src/lib/inventory/sale-decrement.ts");
    expect(s).toContain(`note: "${core.DECREMENT_IN_PROGRESS_NOTE}",`);
    expect(s).toContain("`" + core.DECREMENT_FAILED_PARTWAY_PREFIX + " (${reason})");
    expect(s).toContain("`" + core.DECREMENT_FAILED_NOT_REDUCED_PREFIX + " \u2014 run a cycle count or retry): ${reason}`");
  });
  it("voids latch with sale_void_restocked and write no adjustment rows", () => {
    const v = read("src/lib/pos/void-store.ts");
    expect(v).toContain(`const RESTOCK_MARKER = "${core.DRIFT_VOID_EVENT}";`);
    expect(v).not.toMatch(/from\("inventory_adjustments"\)/);
  });
  it("the import writes received = on hand and no adjustment row", () => {
    const i = read("src/lib/pos/import-service.ts");
    expect(i).toContain("on_hand_qty: lot.receivedQty,");
    expect(i).not.toMatch(/from\("inventory_adjustments"\)/);
  });
  it("every other on-hand writer goes through an adjustment row", () => {
    // The only callers of applyLotDelta besides sales/voids insert a ledger row first.
    for (const f of ["src/lib/inventory/disposition.ts", "src/lib/pos/cultivera-count-store.ts", "src/lib/pos/legacy-lot-removal-store.ts", "src/lib/inventory/cycle-counts.ts"]) {
      expect(read(f), f).toContain("inventory_adjustments");
    }
    expect(read("src/lib/inventory/store.ts")).toMatch(/from\("inventory_adjustments"\)\.insert\(\{\s*lot_id: input\.lotId,\s*qty_delta: input\.qtyDelta,/);
    expect(read("supabase/migrations/0192_inventory_audit_post.sql")).toContain("insert into public.inventory_adjustments (lot_id, qty_delta, reason, note, actor_id)");
  });
});

describe("R50 A6 · the loader (fake database)", () => {
  it("reads everything, skips old sales and custom lines, judges K1/K2, lists K3 as shared", async () => {
    const { loadDrift } = await import("@/lib/pos/cutover-drift");
    const { admin, calls } = fakeAdmin(baseDb());
    const r = await loadDrift(admin, IMP, Date.parse("2026-11-02T20:00:00Z"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.checks.map((c) => [c.id, c.pass])).toEqual([["reads", true], ["lots", true], ["drift", true], ["decrements", true], ["whole", true]]);
    expect(r.report.ok).toBe(true);
    expect(r.report.totals).toMatchObject({ products: 3, cultivera: 19, sold: 3, adjusted: -2, onHand: 14, drift: 0, shared: 1 });
    expect(r.report.lines.map((l) => [l.key, l.kind])).toEqual([["K3", "shared"]]);
    expect(r.report.byVendor.map((g) => g.key).sort()).toEqual(["Vendor One", "Vendor Two"]);
    expect(r.since).toBe(T0);
    // every read names its columns
    for (const c of calls) expect(c.select, c.table).not.toBe("*");
  });

  it("a missing unit turns it red with the product named", async () => {
    const { loadDrift } = await import("@/lib/pos/cutover-drift");
    const db = baseDb();
    (db.inventory_lots[0] as Row).on_hand_qty = 6;
    const r = await loadDrift(fakeAdmin(db).admin, IMP, Date.parse("2026-11-02T20:00:00Z"));
    if (!r.ok) throw new Error("load");
    expect(r.report.ok).toBe(false);
    expect(r.report.lines[0]).toMatchObject({ key: "K1", kind: "drift", drift: -1, product: "Blue Dream 1g", vendor: "Vendor One" });
  });

  it("a void puts its units back in the expected count (voids are read)", async () => {
    const { loadDrift } = await import("@/lib/pos/cutover-drift");
    const db = baseDb();
    (db.inventory_lots[0] as Row).on_hand_qty = 8;
    db.order_events.push({ id: "e4", order_id: "o4", event_type: "sale_void_restocked", note: "Restocked", created_at: "2026-11-02T19:00:00Z" });
    db.order_lines.push({ id: "ol4", order_id: "o4", product_id: "K1", variant_id: null, quantity: 1 });
    const r = await loadDrift(fakeAdmin(db).admin, IMP, Date.parse("2026-11-02T20:00:00Z"));
    if (!r.ok) throw new Error("load");
    expect(r.report.ok).toBe(true);
    expect(r.report.totals).toMatchObject({ voided: 1, drift: 0 });
  });

  it("keypad custom lines never count as sold, even if a lot shares the id (the decrement skips them)", async () => {
    const { loadDrift } = await import("@/lib/pos/cutover-drift");
    const db = baseDb();
    db.inventory_lots.push({ id: "L5", manifest_id: "m1", pos_product_key: "pos-custom-merch", received_qty: 9, on_hand_qty: 9, created_at: T0, product_name: "Odd", category: "Flower", vendor_id: "v1", status: "active" });
    const r = await loadDrift(fakeAdmin(db).admin, IMP, Date.parse("2026-11-02T20:00:00Z"));
    if (!r.ok) throw new Error("load");
    expect(r.report.totals).toMatchObject({ sold: 3, drift: 0 });
    expect(r.report.ok).toBe(true);
  });

  it("a destroyed lot of this import is left out (not judged)", async () => {
    const { loadDrift } = await import("@/lib/pos/cutover-drift");
    const db = baseDb();
    db.inventory_lots.push({ id: "L4", manifest_id: "m1", pos_product_key: "K4", received_qty: 2, on_hand_qty: 0, created_at: T0, product_name: "Burned", category: "Flower", vendor_id: "v1", status: "destroyed" });
    const r = await loadDrift(fakeAdmin(db).admin, IMP, Date.parse("2026-11-02T20:00:00Z"));
    if (!r.ok) throw new Error("load");
    expect(r.report.ok).toBe(true);
    expect(r.report.totals).toMatchObject({ products: 3, cultivera: 19 });
  });

  it("a failed or stuck sale is red", async () => {
    const { loadDrift } = await import("@/lib/pos/cutover-drift");
    const db = baseDb();
    db.order_events.push({ id: "e2", order_id: "o2", event_type: "inventory_decremented", note: core.DECREMENT_IN_PROGRESS_NOTE, created_at: "2026-11-02T18:00:00Z" });
    db.order_events.push({ id: "e3", order_id: "o3", event_type: "note", note: "Inventory decrement FAILED (stock not reduced \u2014 run a cycle count or retry): x", created_at: "2026-11-02T18:00:00Z" });
    const r = await loadDrift(fakeAdmin(db).admin, IMP, Date.parse("2026-11-02T20:00:00Z"));
    if (!r.ok) throw new Error("load");
    expect(r.report.checks.find((c) => c.id === "decrements")).toMatchObject({ pass: false, detail: expect.stringContaining("2 sale(s)") });
  });

  it.each(["order_events", "order_lines", "inventory_adjustments", "vendors", "inventory_lots", "inbound_manifests"])("a failed read of %s is red, never green", async (t) => {
    const { loadDrift } = await import("@/lib/pos/cutover-drift");
    const r = await loadDrift(fakeAdmin(baseDb(), new Set([t])).admin, IMP, Date.parse("2026-11-02T20:00:00Z"));
    if (!r.ok) throw new Error("load");
    expect(r.report.ok).toBe(false);
    expect(r.report.checks[0]).toMatchObject({ id: "reads", pass: false, detail: expect.stringContaining("Something could not be read") });
  });

  it("test imports and bad ids are refused", async () => {
    const { loadDrift } = await import("@/lib/pos/cutover-drift");
    const db = baseDb();
    (db.pos_imports[0] as Row).is_test = true;
    expect(await loadDrift(fakeAdmin(db).admin, IMP, 0)).toEqual({ ok: false, error: "This is a test import. Test imports never make lots, so there is nothing to compare." });
    expect(await loadDrift(fakeAdmin(db).admin, "nope", 0)).toEqual({ ok: false, error: "That import id is not valid." });
  });

  it("records one checked audit row with today's numbers", async () => {
    const { loadDrift, recordDriftCheck, loadDriftChecks } = await import("@/lib/pos/cutover-drift");
    const db = baseDb();
    const f = fakeAdmin(db);
    const r = await loadDrift(f.admin, IMP, Date.parse("2026-11-02T20:00:00Z"));
    if (!r.ok) throw new Error("load");
    expect(await recordDriftCheck(f.admin, { importId: IMP, actorId: "u1", actorEmail: "m@x", date: "2026-11-02", report: r.report })).toBeNull();
    expect(f.inserted[0]).toMatchObject({ table: "audit_logs", action: core.DRIFT_CHECKED_ACTION, entity_type: "pos_import", entity_id: IMP, after_json: { date: "2026-11-02", ok: true, drift: 0 } });
    const f2 = fakeAdmin(baseDb(), new Set(["insert:audit_logs"]));
    expect(await recordDriftCheck(f2.admin, { importId: IMP, actorId: null, actorEmail: null, date: "2026-11-02", report: r.report })).toBe("insert refused");
    db.audit_logs.push({ id: 1, entity_type: "pos_import", entity_id: IMP, action: core.DRIFT_CHECKED_ACTION, actor_email: "m@x", after_json: { date: "2026-11-02", ok: false, drift: -1, driftProducts: 1 }, created_at: "2026-11-02T20:00:00Z" });
    expect(await loadDriftChecks(fakeAdmin(db).admin, IMP)).toEqual([{ date: "2026-11-02", ok: false, drift: -1, driftProducts: 1, by: "m@x", at: "2026-11-02T20:00:00Z" }]);
  });
});

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */
const state: { db: DB; fail: Set<string> } = { db: baseDb(), fail: new Set() };
vi.mock("@/lib/auth/session", () => ({ requirePermission: async () => ({ userId: "u1", email: "m@x", profile: { role: "owner" } }) }));
vi.mock("@/lib/supabase/env", async (importOriginal) => ({ ...((await importOriginal()) as object), isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => fakeAdmin(state.db, state.fail).admin }));
vi.mock("@/lib/pos/cultivera-reconcile", () => ({
  listReconcileImports: async () => [{ id: IMP, created_at: T0, status: "published", is_test: false, inventories_storage_key: "k", inventories_filename: "INV.xlsx" }],
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

async function renderAt(iso: string, sp: Record<string, string> = {}): Promise<string> {
  vi.setSystemTime(new Date(iso));
  const { default: Page } = await import("@/app/admin/menu-imports/drift/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
}

describe("R50 A6 · the page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    state.db = baseDb();
    state.fail = new Set();
  });
  afterEach(() => vi.useRealTimers());

  it("day 1, green: verdict, the week strip, the button, the shared line", async () => {
    const html = await renderAt("2026-11-02T20:00:00Z");
    expect(html).toContain('data-phase="during"');
    expect(html).toContain("Day 1 of 7 (2026-11-02). Run it once today.");
    expect(html).toContain('data-testid="dr-verdict" data-ok="1"');
    expect(html).toContain("GREEN: every unit is explained.");
    expect(html).toContain("I ran today&#x27;s check (2026-11-02)");
    expect((html.match(/data-day="/g) ?? []).length).toBe(7);
    expect(html).toContain('data-day="2026-11-02" data-state="none"');
    expect(html).toContain('data-kind="shared"');
    expect(html).toContain("Adjustments by reason: count -2");
  });

  it("red: names the product and says what to do", async () => {
    (state.db.inventory_lots[0] as Row).on_hand_qty = 5;
    const html = await renderAt("2026-11-03T20:00:00Z");
    expect(html).toContain('data-ok="0"');
    expect(html).toContain("RED: 1 product(s) drifted (net -2).");
    expect(html).toContain("2 fewer on hand than recorded.");
    expect(html).toContain('href="/admin/inventory?q=K1"');
  });

  it("a recorded day shows in the strip", async () => {
    state.db.audit_logs.push({ id: 1, entity_type: "pos_import", entity_id: IMP, action: core.DRIFT_CHECKED_ACTION, actor_email: "m@x", after_json: { date: "2026-11-02", ok: true, drift: 0, driftProducts: 0 }, created_at: "2026-11-02T20:00:00Z" });
    const html = await renderAt("2026-11-03T20:00:00Z");
    expect(html).toContain('data-day="2026-11-02" data-state="green"');
    expect(html).toContain('data-day="2026-11-03" data-state="none"');
  });

  it("a failed read is red on the page", async () => {
    state.fail = new Set(["order_lines"]);
    const html = await renderAt("2026-11-02T20:00:00Z");
    expect(html).toContain('data-ok="0"');
    expect(html).toContain('data-check="reads" data-pass="0"');
  });

  it("after 11/08 it is switched off and reads nothing, unless asked once", async () => {
    const off = await renderAt("2026-11-09T20:00:00Z");
    expect(off).toContain('data-testid="dr-off"');
    expect(off).not.toContain('data-testid="dr-verdict"');
    expect(off).toContain("This daily check is switched off.");
    const once = await renderAt("2026-11-09T20:00:00Z", { anyway: "1" });
    expect(once).toContain('data-testid="dr-verdict"');
  });

  it("before 11/02 it runs as a rehearsal", async () => {
    const html = await renderAt("2026-10-27T20:00:00Z");
    expect(html).toContain("Running it now is a rehearsal.");
    expect(html).toContain('data-testid="dr-verdict"');
  });
});

describe("R50 A6 · the button", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    state.db = baseDb();
    state.fail = new Set();
  });
  afterEach(() => vi.useRealTimers());

  const form = (id: string) => {
    const f = new FormData();
    f.set("importId", id);
    return f;
  };

  it("records today's check (re-read on the server)", async () => {
    vi.setSystemTime(new Date("2026-11-04T20:00:00Z"));
    const { recordDriftCheckAction } = await import("@/app/admin/menu-imports/drift/actions");
    await expect(recordDriftCheckAction(form(IMP))).rejects.toThrow(/REDIRECT \/admin\/menu-imports\/drift\?import=.*notice=Recorded\+for\+2026-11-04%3A\+every\+unit\+is\+explained\./);
  });

  it("refuses to record when a read failed", async () => {
    state.fail = new Set(["order_events"]);
    const { recordDriftCheckAction } = await import("@/app/admin/menu-imports/drift/actions");
    await expect(recordDriftCheckAction(form(IMP))).rejects.toThrow(/error=Not\+recorded/);
  });

  it("refuses a bad id", async () => {
    const { recordDriftCheckAction } = await import("@/app/admin/menu-imports/drift/actions");
    await expect(recordDriftCheckAction(form("x"))).rejects.toThrow(/error=Missing\+or\+invalid\+import\+id\./);
  });
});

describe("R50 A6 · linked from the weekend plan and the cutover page", () => {
  it("the weekend plan's daily step opens the drift page, and the doc is regenerated", async () => {
    const wk = await import("@/lib/pos/cutover-weekend-core");
    const step = wk.WEEKEND_STEPS.find((s) => s.key === "drift")!;
    expect(step).toMatchObject({ day: "after", href: core.DRIFT_HREF, linkLabel: "Daily drift check" });
    expect(read(wk.CUTOVER_DOC)).toBe(wk.renderWeekendMarkdown());
    expect(read("src/app/admin/menu-imports/cutover/page.tsx")).toContain('<Link href="/admin/menu-imports/drift"');
  });
});
