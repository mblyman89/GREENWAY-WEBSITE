/**
 * tests/compliance/r50-s10c-migration-garbage.test.tsx   (R50 S10c, CCRS bible D-15)
 *
 * Owner follow-up #5: "I want the system to know, when we migrate, it's going
 * to be intaking some garbage, and I want the system to recognize this and
 * help me remove them from the system when I comes time to do our first CCRS
 * upload."
 *
 * Pins:
 *   1. the pure core runs at its measured self-test count (53; R74 S4 +14 = 67);
 *   2. the store reads the one-time Cultivera import end to end and routes by
 *      the CCRS ledger; every short read is an error, never a partial list;
 *   3. the panel renders the headline, the routes, R15b links, and never offers
 *      a Delete;
 *   4. the hub mounts the panel; nothing in S10c writes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLedgerView, type LedgerEntry } from "@/lib/compliance/ccrs-ledger-core";

const st: {
  cut: unknown;
  versions: { id: string }[];
  versionErr: boolean;
  count: number | null;
  items: { source_item_id: string; hidden: boolean; hidden_reason: string | null }[];
  manifestIds: string[];
  lots: Record<string, unknown>[];
  lotsThrow: boolean;
  diagsComplete: boolean;
  diags: { code: string }[];
  ledger: LedgerEntry[] | null;
  ledgerIds: string[][];
  readVersion: string | null;
} = {
  cut: null,
  versions: [],
  versionErr: false,
  count: 0,
  items: [],
  manifestIds: [],
  lots: [],
  lotsThrow: false,
  diagsComplete: true,
  diags: [],
  ledger: null,
  ledgerIds: [],
  readVersion: null,
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (t: string) => {
      if (t !== "menu_versions") throw new Error(`unexpected table ${t}`);
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: async () => (st.versionErr ? { data: null, error: { message: "boom" } } : { data: st.versions, error: null }),
        insert: () => {
          throw new Error("S10c must not write");
        },
        update: () => {
          throw new Error("S10c must not write");
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/pos/menu-imports-cutover", () => ({ readMenuImportsCutover: async () => st.cut }));
vi.mock("@/lib/pos/menu-version", () => ({
  countVersionItems: async (v: string) => {
    st.readVersion = v;
    return st.count;
  },
  getVersionItems: async () => st.items,
  getImportDiagnosticsChecked: async () => ({
    rows: st.diags,
    verdict: { complete: st.diagsComplete, message: st.diagsComplete ? "" : "cap hit" },
  }),
}));
vi.mock("@/lib/inventory/import-lineage-store", () => ({
  importManifestIds: async () => st.manifestIds,
  readLotsOnManifests: async () => {
    if (st.lotsThrow) throw new Error("Could not read every lot of this import.");
    return st.lots;
  },
}));
vi.mock("@/lib/compliance/ccrs-ledger-store", () => ({
  loadLedgerForBatch: async (_a: unknown, env: "prod" | "preprod", ids: string[]) => {
    st.ledgerIds.push(ids);
    if (!st.ledger) return { kind: "absent", reason: "seed-not-finalized" };
    return { kind: "loaded", ledger: { view: buildLedgerView(env, st.ledger).view, lastStamp: null, duplicates: [] } };
  },
}));

const DONE = { done: true, first: { versionId: "V1", importId: "11111111-1111-1111-1111-111111111111", publishedAt: "x", products: 1, lots: 1 }, latest: null, realPublishedCount: 1 };
const lot = (o: Record<string, unknown>) => ({
  id: "L1",
  pos_product_key: "K1",
  lot_code: "B1",
  ccrs_inventory_external_id: "B1",
  on_hand_qty: 4,
  status: "active",
  product_name: "Dead Gummy",
  received_on: "2025-06-01",
  ...o,
});
const inv = (id: string, state: LedgerEntry["state"]): LedgerEntry => ({ fileType: "Inventory", externalId: id, filedName: null, state });

beforeEach(() => {
  st.cut = DONE;
  st.versions = [{ id: "V2" }];
  st.versionErr = false;
  st.items = [
    { source_item_id: "K1", hidden: true, hidden_reason: "no_product_master" },
    { source_item_id: "K2", hidden: false, hidden_reason: null },
  ];
  st.count = 2;
  st.manifestIds = ["M1"];
  st.lots = [
    lot({}),
    lot({ id: "L2", pos_product_key: "K2", lot_code: null, ccrs_inventory_external_id: "K2-NOBARCODE-1", product_name: "No Code" }),
    lot({ id: "L3", pos_product_key: "K2", lot_code: "B3", ccrs_inventory_external_id: "B3", product_name: "Good" }),
  ];
  st.lotsThrow = false;
  st.diagsComplete = true;
  st.diags = [{ code: "import_lot_cost_unparseable" }, { code: "cannabinoid_missing" }];
  st.ledger = [inv("B1", "filed"), inv("B3", "filed")];
  st.ledgerIds = [];
  st.readVersion = null;
});

async function load() {
  const m = await import("@/lib/compliance/ccrs-migration-garbage-store");
  return m.loadMigrationGarbage("prod");
}

describe("R50 S10c — core", () => {
  it("self-tests run at the measured count", async () => {
    const m = await import("@/lib/compliance/ccrs-migration-garbage-core");
    expect(m.__runCcrsMigrationGarbageCoreTests()).toEqual({ passed: 67, failed: 0 });
  });
});

describe("R50 S10c — store", () => {
  it("routes the import's dead lots by the ledger, reading the newest version", async () => {
    const r = await load();
    expect(r.ok && r.state === "ready").toBe(true);
    if (!(r.ok && r.state === "ready")) return;
    expect(st.readVersion).toBe("V2");
    expect(r.report.rows.map((x) => [x.lotId, x.route])).toEqual([
      ["L1", "zero_in_ccrs"],
      ["L2", "local_only"],
    ]);
    expect(r.report.unitsToZero).toBe(4);
    expect(r.report.fixableTotal).toBe(2);
    expect(r.ledgerAbsentReason).toBeNull();
    expect(st.ledgerIds[0].sort()).toEqual(["B1", "B3", "K2-NOBARCODE-1"]);
  });
  it("falls back to the cutover version when none is newer", async () => {
    st.versions = [];
    await load();
    expect(st.readVersion).toBe("V1");
  });
  it("ledger not loaded → every row unknown, reason surfaced", async () => {
    st.ledger = null;
    const r = await load();
    if (!(r.ok && r.state === "ready")) throw new Error("not ready");
    expect(r.report.byRoute.unknown).toBe(2);
    expect(r.report.unitsToZero).toBe(0);
    expect(r.ledgerAbsentReason).toBe("seed-not-finalized");
  });
  it("no migration yet → no_migration; unknown cutover → error", async () => {
    st.cut = { done: false, unknown: false };
    expect(await load()).toEqual({ ok: true, state: "no_migration" });
    st.cut = { done: false, unknown: true };
    expect((await load()).ok).toBe(false);
  });
  it("fail-closed on every short read", async () => {
    st.count = 3;
    expect((await load()).ok).toBe(false);
    st.count = null;
    expect((await load()).ok).toBe(false);
    st.count = 2;
    st.versionErr = true;
    expect((await load()).ok).toBe(false);
    st.versionErr = false;
    st.diagsComplete = false;
    const d = await load();
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toContain("cap hit");
    st.diagsComplete = true;
    st.lotsThrow = true;
    const l = await load();
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.error).toContain("every lot");
  });
  it("no manifests → no lots, still a ready report", async () => {
    st.manifestIds = [];
    const r = await load();
    if (!(r.ok && r.state === "ready")) throw new Error("not ready");
    expect(r.report.dead).toBe(0);
  });
});

// R74 S4 - owner (round 2, #5): "Anything without a receive date should be flagged as, does not exist
// and to be included in the clean up."
describe("R74 S4 — no received date = does not exist", () => {
  it("store reads received_on; an undated lot is dead and routed by the ledger", async () => {
    const { GARBAGE_LOT_SELECT } = await import("@/lib/compliance/ccrs-migration-garbage-store");
    expect(GARBAGE_LOT_SELECT).toContain("received_on");
    st.lots = [...st.lots, lot({ id: "L4", pos_product_key: "K2", lot_code: "B4", ccrs_inventory_external_id: "B4", received_on: null, product_name: "Undated" })];
    st.ledger = [...(st.ledger ?? []), inv("B4", "filed")];
    st.diags = [...st.diags, { code: "import_lot_received_date_missing" }];
    const r = await load();
    if (!(r.ok && r.state === "ready")) throw new Error("not ready");
    const row = r.report.rows.find((x) => x.lotId === "L4");
    expect(row?.reasons).toEqual(["no_received_date"]);
    expect(row?.route).toBe("zero_in_ccrs");
    expect(r.report.fixable.map((f) => f.code)).not.toContain("import_lot_received_date_missing");
    expect(r.report.rows.find((x) => x.lotId === "L3")).toBeUndefined(); // dated good lot stays off the list
  });
  it("panel shows the undated note with the Received dates link and the reason label", async () => {
    st.lots = [lot({ id: "L4", pos_product_key: "K2", lot_code: "B4", ccrs_inventory_external_id: "B4", received_on: null, product_name: "Undated" })];
    st.ledger = [inv("B4", "filed")];
    const { MigrationGarbagePanel } = await import("@/components/admin/compliance/MigrationGarbagePanel");
    const html = renderToStaticMarkup(<MigrationGarbagePanel load={await load()} />);
    expect(html).toContain('data-testid="migration-garbage-undated"');
    expect(html).toContain("1 migrated lot(s) have no received date");
    expect(html).toContain(`/admin/menu-imports/${DONE.first.importId}/received-dates`);
    expect(html).toContain("No received date — treated as not existing (owner rule)");
    expect(html).toContain('href="/admin/inventory/L4"');
  });
});

describe("R50 S10c — panel", () => {
  it("renders headline, route chips, R15b link, lot link, fixable list; never Delete", async () => {
    const r = await load();
    const { MigrationGarbagePanel } = await import("@/components/admin/compliance/MigrationGarbagePanel");
    const html = renderToStaticMarkup(<MigrationGarbagePanel load={r} />);
    expect(html).toContain('data-testid="migration-garbage-panel"');
    expect(html).toContain("2 dead migrated record(s) found; 2 still need you before the first CCRS upload.");
    expect(html).toContain(`/admin/menu-imports/${DONE.first.importId}/missing-products`);
    expect(html).toContain('href="/admin/inventory/L2"');
    expect(html).toContain("Cost could not be read: 1");
    expect(html).toContain("4 unit(s) will be zeroed out in CCRS by Reconciliation.");
    expect(html).not.toMatch(/>[^<]*Delete it[^<]*</);
    expect(html).toContain("never sends a Delete");
  });
  it("error, none and ledger-absent states", async () => {
    const { MigrationGarbagePanel } = await import("@/components/admin/compliance/MigrationGarbagePanel");
    expect(renderToStaticMarkup(<MigrationGarbagePanel load={{ ok: false, error: "x." }} />)).toContain('data-testid="migration-garbage-error"');
    expect(renderToStaticMarkup(<MigrationGarbagePanel load={{ ok: true, state: "no_migration" }} />)).toContain('data-testid="migration-garbage-none"');
    st.ledger = null;
    const html = renderToStaticMarkup(<MigrationGarbagePanel load={await load()} />);
    expect(html).toContain("CCRS ledger not loaded (seed-not-finalized)");
    expect(html).not.toContain("will be zeroed out");
  });
  it("caps rows but keeps whole counts", async () => {
    st.lots = Array.from({ length: 205 }, (_, i) => lot({ id: `L${String(i).padStart(3, "0")}`, ccrs_inventory_external_id: `X${i}`, lot_code: `X${i}` }));
    const { MigrationGarbagePanel, GARBAGE_PANEL_ROW_CAP } = await import("@/components/admin/compliance/MigrationGarbagePanel");
    const html = renderToStaticMarkup(<MigrationGarbagePanel load={await load()} />);
    expect(GARBAGE_PANEL_ROW_CAP).toBe(200);
    expect(html).toContain("Showing the first 200 of 205.");
    expect((html.match(/<tr data-route=/g) ?? []).length).toBe(200);
  });
});

describe("R50 S10c — wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("hub mounts the panel from the read-only store", () => {
    const page = read("src/app/admin/compliance/ccrs/page.tsx");
    expect(page).toContain("await loadMigrationGarbage(env)");
    expect(page).toContain("<MigrationGarbagePanel load={migrationGarbage} />");
  });
  it("store and core write nothing and never route to an Inventory Delete", () => {
    const store = read("src/lib/compliance/ccrs-migration-garbage-store.ts");
    const core = read("src/lib/compliance/ccrs-migration-garbage-core.ts");
    for (const src of [store, core]) {
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(src).not.toContain("routeOperation(");
    }
  });
  it("D-15 and U-46 are recorded in the CCRS bible", () => {
    expect(read("docs/ccrs-bible/05-owner-decisions-log.md")).toContain("## D-15 — Examiner green light");
    expect(read("docs/ccrs-bible/12-unverified-register.md")).toContain("| U-46 |");
  });
});
