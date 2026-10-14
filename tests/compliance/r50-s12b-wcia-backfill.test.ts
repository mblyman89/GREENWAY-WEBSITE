/**
 * R50 S12b — "Attach vendor lab results to every Cultivera manifest".
 *
 * The real backfill store and the REAL attachWciaLabResults run over the
 * shared in-memory PostgREST (real postgrest-js) with an in-memory storage
 * bucket. Pins: only rebuilt manifests, id order with a resumable checkpoint,
 * the time budget, fill-only links (never a certificate replaced, never a
 * destroyed lot), nothing else on a lot changes, idempotent re-runs, honest
 * failure, one audit per click, and the page/action wiring.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
  files: {} as Record<string, Buffer>,
  audits: [] as Record<string, unknown>[],
  downloads: [] as string[],
  throwKey: null as string | null,
  rejectManifest: null as string | null,
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
              st.downloads.push(key);
              if (st.throwKey && key.includes(st.throwKey)) throw new Error("socket hang up");
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
// Wraps the real attach so one test can make it reject outright (the run must go on).
vi.mock("@/lib/inventory/cultivera-wcia-store", async (orig) => {
  const real = (await orig()) as typeof import("@/lib/inventory/cultivera-wcia-store");
  return {
    ...real,
    attachWciaLabResults: (...a: Parameters<typeof real.attachWciaLabResults>) =>
      st.rejectManifest && a[1] === st.rejectManifest ? Promise.reject(new Error("worker crashed")) : real.attachWciaLabResults(...a),
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void st.audits.push(e) }));

const { runWciaBackfill } = await import("@/lib/inventory/cultivera-wcia-backfill");
const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
const core = await import("@/lib/inventory/cultivera-wcia-backfill-core");

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const IMP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const mid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const lid = (m: number, k: number) => `11111111-0000-4000-8000-${(m * 100 + k).toString(16).padStart(12, "0")}`;

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

function lot(m: number, k: number, bc: string, extra: Row = {}): Row {
  return {
    id: lid(m, k),
    manifest_id: mid(m),
    lot_code: bc,
    status: "active",
    lab_result_id: null,
    qty_on_hand: 10,
    unit_cost_minor_units: 800,
    ccrs_inventory_id: `CCRS-${m}-${k}`,
    updated_by: null,
    ...extra,
  };
}

/** A rebuilt manifest with its transfer file and one lot per barcode. */
function rebuilt(n: number, opts: { file?: boolean; transfer?: number | null; lots?: Array<[string, string | null]> } = {}) {
  const transfer = opts.transfer === undefined ? 1000 + n : opts.transfer;
  st.db.rows("inbound_manifests").push({
    id: mid(n),
    manifest_number: `CV-${n}`,
    status: "accepted",
    raw_payload: { kind: "cultivera-reconstructed", import_id: IMP, ...(transfer === null ? {} : { cultivera_transfer_id: transfer }) },
  });
  const items = opts.lots ?? [[`B${n}a`, `L${n}`], [`B${n}b`, `L${n}`]];
  if (opts.file !== false && transfer !== null) st.files[`rehome/${IMP}/wcia/${transfer}.json`] = doc(items);
  items.forEach(([bc], k) => st.db.rows("inventory_lots").push(lot(n, k, bc)));
}

const admin = () => createSupabaseAdminClient() as never;
const lotsWithLab = () => st.db.rows("inventory_lots").filter((l) => l.lab_result_id).length;

beforeEach(() => {
  st.db = new FakePostgrest();
  st.files = {};
  st.audits = [];
  st.downloads = [];
  st.throwKey = null;
  st.rejectManifest = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("R50 S12b — one click attaches the vendor lab results across every rebuilt manifest", () => {
  it("only rebuilt manifests, all of them, through the same fill-only attach; one audit; done", async () => {
    for (const n of [3, 1, 2]) rebuilt(n);
    // A native delivery and the migration manifest: never read for a file, never linked.
    st.db.rows("inbound_manifests").push({ id: mid(50), manifest_number: "NATIVE", raw_payload: { kind: "wcia", import_id: IMP, cultivera_transfer_id: 1050 } });
    st.db.rows("inbound_manifests").push({ id: mid(51), manifest_number: "MIG", raw_payload: { kind: "pos-import-migration" } });
    st.files[`rehome/${IMP}/wcia/1050.json`] = doc([["N1", "LN"]]);
    st.db.rows("inventory_lots").push(lot(50, 0, "N1"));

    const r = await runWciaBackfill(null, ACTOR, { admin: admin() });
    expect(r).toMatchObject({ ok: true, done: true, next: null });
    expect(r.totals).toMatchObject({ manifests: 3, attached: 3, linked: 6, created: 3, noFile: 0, errored: 0 });
    expect(st.downloads).toEqual([1001, 1002, 1003].map((t) => `rehome/${IMP}/wcia/${t}.json`)); // id order
    expect(st.db.rows("inventory_lots").find((l) => l.id === lid(50, 0))?.lab_result_id).toBeNull();
    expect(st.audits).toHaveLength(1);
    expect(st.audits[0]).toMatchObject({ action: core.WCIA_BACKFILL_AUDIT, actorId: ACTOR, after: expect.objectContaining({ done: true, linked: 6, manifests: 3 }) });
    const notes = st.db.rows("manifest_events").filter((e) => e.event_type === "cultivera_vendor_lab_results");
    expect(notes.map((e) => e.manifest_id).sort()).toEqual([mid(1), mid(2), mid(3)]);
  });

  it("sellable stays sellable: a certificate is never replaced, a destroyed lot never touched, no other lot column changes", async () => {
    rebuilt(1, { lots: [["B1", "L1"], ["B2", "L1"], ["B3", "L1"]] });
    st.db.rows("inventory_lots")[1].lab_result_id = "keep-me";
    st.db.rows("inventory_lots")[2].status = "destroyed";
    const strip = () =>
      st.db.rows("inventory_lots").map((l) => {
        const rest: Row = { ...l };
        delete rest.lab_result_id;
        delete rest.updated_by;
        return rest;
      });
    const before = strip();
    const r = await runWciaBackfill(null, ACTOR, { admin: admin() });
    expect(r.ok && r.totals.linked).toBe(1);
    const rows = st.db.rows("inventory_lots");
    expect(rows[1].lab_result_id).toBe("keep-me");
    expect(rows[2].lab_result_id).toBeNull();
    expect(strip()).toEqual(before);
    const writes = st.db.log.filter((q) => q.method !== "GET" && q.method !== "HEAD");
    expect([...new Set(writes.map((q) => q.table))].sort()).toEqual(["inventory_lots", "lab_results", "manifest_events"]);
    for (const q of writes.filter((w) => w.table === "inventory_lots")) {
      expect(Object.keys(q.body as object).sort()).toEqual(["lab_result_id", "updated_by"]);
      expect(q.url.search).toContain("lab_result_id=is.null");
      expect(q.url.search).toContain("status=neq.destroyed");
    }
  });

  it("idempotent: a second full run links nothing, creates no lab result and writes no timeline noise", async () => {
    rebuilt(1);
    rebuilt(2);
    await runWciaBackfill(null, ACTOR, { admin: admin() });
    const labs = st.db.rows("lab_results").length;
    const events = st.db.rows("manifest_events").length;
    const again = await runWciaBackfill(null, ACTOR, { admin: admin() });
    expect(again).toMatchObject({ ok: true, done: true });
    expect(again.totals).toMatchObject({ manifests: 2, attached: 2, linked: 0, created: 0, reused: 0 });
    expect(again.totals.outcomes["has-lab"]).toBe(4);
    expect(st.db.rows("lab_results")).toHaveLength(labs);
    expect(st.db.rows("manifest_events")).toHaveLength(events);
  });

  it("pages past the first page in id order (no manifest skipped or repeated)", async () => {
    for (let n = 1; n <= 7; n++) rebuilt(n);
    const r = await runWciaBackfill(null, ACTOR, { admin: admin(), pageSize: 3 });
    expect(r).toMatchObject({ ok: true, done: true });
    expect(r.totals.manifests).toBe(7);
    expect(lotsWithLab()).toBe(14);
    const gets = st.db.log.filter((q) => q.table === "inbound_manifests" && q.method === "GET");
    expect(gets.map((q) => q.url.searchParams.get("id"))).toEqual([null, `gt.${mid(3)}`, `gt.${mid(6)}`]);
    expect(gets.every((q) => q.url.searchParams.get("order") === "id.asc" && q.url.searchParams.get("limit") === "3")).toBe(true);
  });

  it("the time budget pauses with a checkpoint; Continue resumes exactly after it and finishes", async () => {
    for (let n = 1; n <= 5; n++) rebuilt(n);
    let clock = 0;
    // Each manifest "costs" 10 s; budget 45 s, MIN_LEFT 15 s -> manifests 1..3 run (start at 0, 10, 20; 30 leaves exactly 15 -> runs too).
    const now = () => clock;
    st.db.before = (q) => {
      if (q.table === "inventory_lots" && q.method === "GET") clock += 10_000;
    };
    const first = await runWciaBackfill(null, ACTOR, { admin: admin(), now, budgetMs: 45_000 });
    expect(first).toMatchObject({ ok: true, done: false, next: mid(4) });
    expect(first.totals.manifests).toBe(4);
    expect(core.backfillNote(first)).toMatch(/^Paused at the time limit/);
    clock = 0;
    const second = await runWciaBackfill(first.next, ACTOR, { admin: admin(), now, budgetMs: 45_000 });
    expect(second).toMatchObject({ ok: true, done: true, next: null });
    expect(second.totals.manifests).toBe(1);
    expect(lotsWithLab()).toBe(10);
    expect(st.audits.map((a) => (a.after as { from: unknown }).from)).toEqual([null, mid(4)]);
  });

  it("an unsafe cursor is ignored (starts from the beginning), never put into a filter", async () => {
    rebuilt(1);
    const r = await runWciaBackfill("x),id.gt.(z", ACTOR, { admin: admin() });
    expect(r.ok && r.totals.manifests).toBe(1);
    const get = st.db.log.find((q) => q.table === "inbound_manifests")!;
    expect(get.url.searchParams.get("id")).toBeNull();
  });

  it("missing / unreadable files and a failing manifest are counted and reported; the rest still attach", async () => {
    rebuilt(1, { file: false });
    rebuilt(2, { transfer: null });
    rebuilt(3);
    st.files[`rehome/${IMP}/wcia/1003.json`] = Buffer.from("{not json", "utf8");
    rebuilt(4);
    rebuilt(5);
    st.db.before = (q) => (q.table === "inventory_lots" && q.method === "GET" && q.url.search.includes(mid(4)) ? { status: 500, body: { message: "boom" } } : undefined);
    const r = await runWciaBackfill(null, ACTOR, { admin: admin() });
    expect(r).toMatchObject({ ok: true, done: true });
    expect(r.totals).toMatchObject({ manifests: 5, attached: 1, noFile: 2, unreadable: 1, errored: 1, linked: 2 });
    expect(r.totals.problems.some((p) => p.startsWith("CV-3:"))).toBe(true);
    expect(r.totals.problems.some((p) => p.startsWith("CV-4:"))).toBe(true);
    expect(core.backfillTone(r)).toBe("warn");
    expect(st.db.rows("inventory_lots").filter((l) => l.manifest_id === mid(5)).every((l) => l.lab_result_id)).toBe(true);
    // A manifest with no file writes no timeline line (nothing happened there).
    expect(st.db.rows("manifest_events").some((e) => e.manifest_id === mid(1) || e.manifest_id === mid(2))).toBe(false);
  });

  it("an unreadable manifest list stops honestly with the checkpoint (never 'Done'), and audits it", async () => {
    rebuilt(1);
    rebuilt(2);
    let calls = 0;
    st.db.before = (q) => {
      if (q.table === "inbound_manifests" && q.method === "GET" && ++calls === 2) return { status: 500, body: { message: "timeout" } };
    };
    const r = await runWciaBackfill(null, ACTOR, { admin: admin(), pageSize: 1 });
    expect(r).toMatchObject({ ok: false, next: mid(1) });
    expect(r.totals.manifests).toBe(1);
    expect(core.backfillNote(r)).toMatch(/^Stopped: the Cultivera manifests could not be read/);
    expect(st.audits[0]).toMatchObject({ after: expect.objectContaining({ done: false, next: mid(1) }) });
  });

  it("a thrown attach on one manifest is caught and counted; the run carries on", async () => {
    rebuilt(1);
    rebuilt(2);
    st.throwKey = "/1001.json";
    const r = await runWciaBackfill(null, ACTOR, { admin: admin() });
    expect(r).toMatchObject({ ok: true, done: true });
    // loadWciaText catches a thrown download itself -> "unreadable" for CV-1, CV-2 attached.
    expect(r.totals).toMatchObject({ manifests: 2, attached: 1, unreadable: 1 });
    expect(r.totals.problems[0]).toMatch(/^CV-1: .*socket hang up/);
    expect(st.db.rows("inventory_lots").filter((l) => l.manifest_id === mid(2)).every((l) => l.lab_result_id)).toBe(true);
  });
});

describe("R50 S12b — a rejected attach", () => {
  it("is caught, counted as an error with the manifest number, gets a timeline line; the next manifest still attaches", async () => {
    rebuilt(1);
    rebuilt(2);
    st.rejectManifest = mid(1);
    const r = await runWciaBackfill(null, ACTOR, { admin: admin() });
    expect(r).toMatchObject({ ok: true, done: true });
    expect(r.totals).toMatchObject({ manifests: 2, attached: 1, errored: 1, linked: 2 });
    expect(r.totals.problems).toEqual(["CV-1: worker crashed"]);
    expect(st.db.rows("manifest_events").some((e) => e.manifest_id === mid(1))).toBe(true);
  });
});

describe("R50 S12b — wiring", () => {
  it("the action requires inventory.manage, passes the cursor and redirects with the note", () => {
    const src = read("src/app/admin/inventory/drafts/actions.ts");
    const fn = src.slice(src.indexOf("export async function runWciaBackfillAction"));
    expect(fn).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(fn).toMatch(/runWciaBackfill\(typeof raw === "string" \? raw : null, session\.userId\)/);
    expect(fn).toMatch(/lab_bf: backfillTone\(run\)/);
    expect(fn).toMatch(/if \(run\.next && !\(run\.ok && run\.done\)\) extra\.lab_bf_next = run\.next/);
  });
  it("the page shows the button, Continue with a validated cursor, and the result banner", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    for (const id of ["wcia-backfill", "wcia-backfill-button", "wcia-backfill-result"]) expect(page).toContain(`data-testid="${id}"`);
    expect(page).toMatch(/const next = parseBackfillCursor\(sp\.lab_bf_next\)/);
    expect(page).toMatch(/action=\{runWciaBackfillAction\}/);
    // Continue carries the checkpoint back to the action (else it would restart from the first manifest).
    expect(page).toContain('{next && <input type="hidden" name="cursor" value={next} />}');
    expect(page).toMatch(/\{next \? "Continue attaching vendor lab results" : "Attach vendor lab results to every Cultivera manifest"\}/);
  });
  it("the pure runner pins the core's self-test count", () => {
    expect(core.__runCultiveraWciaBackfillCoreTests().passed).toBe(27);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("cultivera-wcia-backfill-core", __runCultiveraWciaBackfillCoreTests(), 27)');
  });
});
