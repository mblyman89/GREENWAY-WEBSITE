/**
 * tests/compliance/r50-cultivera-rehome.test.ts   (R50 S2c, bible §1.3b)
 *
 * Rebuild the real Cultivera manifests and move ("re-home") the migrated lots
 * onto them, changing only inventory_lots.manifest_id. This file pins:
 *
 *   1. the pure core (its own self-tests + a few direct contracts),
 *   2. the store against a stateful in-memory PostgREST fake: preview is
 *      read-only, Apply is idempotent, the move is guarded, a foreign
 *      dedupe_key refuses in PREVIEW, crash/resume, rollback never destroys
 *      work, and failures are surfaced, never swallowed,
 *   3. the wiring: the fetch preview and Apply share one planner.
 *
 * The real-database run (PG15 + PostgREST, 3,762 lots / 679 manifests) is in
 * scripts/recon/r50-s2c/README.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REHOME_MOVE_BATCH,
  __runCultiveraRehomeCoreTests,
  buildPlanInputs,
  controlTotals,
  mapCultiveraStatus,
  normalizeUtcInstant,
  transferDateDay,
} from "../../src/lib/inventory/cultivera-rehome-core";
import {
  POS_IMPORT_MANIFEST_KIND,
  RECONSTRUCTED_MANIFEST_KIND,
} from "../../src/lib/inventory/cultivera-manifest-group-core";
import { posImportManifestNumber } from "../../src/lib/inventory/import-lineage-core";
import {
  REHOME_KEY_CHUNK,
  applyRehome,
  previewRehome,
  readManifestsByKeys,
  rollbackRehome,
  type RehomeSources,
} from "../../src/lib/inventory/cultivera-rehome-store";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ---------------- 1. pure core ---------------- */

describe("cultivera-rehome core", () => {
  it("passes its own self-tests (floor = measured count)", () => {
    const r = __runCultiveraRehomeCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(67);
  });
  it("maps only Accepted / Partially Accepted; anything else is refused", () => {
    expect(mapCultiveraStatus("Accepted")).toBe("accepted");
    expect(mapCultiveraStatus("Partially Accepted")).toBe("partially_accepted");
    expect(mapCultiveraStatus("Pending")).toBeNull();
    expect(mapCultiveraStatus("")).toBeNull();
  });
  it("transfer_date is the PACIFIC day of the Z instant (measured: Cultivera sends instants)", () => {
    expect(transferDateDay("2024-08-30T15:00:00Z")).toBe("2024-08-30");
    expect(transferDateDay("2024-08-31T05:00:00Z")).toBe("2024-08-30");
    expect(normalizeUtcInstant("2024-08-30T15:00:00")).toBeNull();
    expect(normalizeUtcInstant("2024-02-30T15:00:00Z")).toBeNull();
  });
  it("control totals are cents-exact", () => {
    const t = controlTotals([
      { id: "a", manifest_id: "s", ccrs_inventory_external_id: "A", vendor_id: null, on_hand_qty: 3, received_qty: 3, unit_cost_minor_units: 333, status: "active" },
      { id: "b", manifest_id: "s", ccrs_inventory_external_id: "B", vendor_id: null, on_hand_qty: 0.5, received_qty: 1, unit_cost_minor_units: 101, status: "active" },
    ]);
    expect(t).toEqual({ lots: 2, onHandUnits: 3.5, receivedUnits: 4, costValueCents: 999 + 51 });
  });
  it("move batches fit PostgREST's 8000-char URL limit (uuid = 36 chars + comma)", () => {
    expect(REHOME_MOVE_BATCH * 37).toBeLessThan(7000);
    expect(REHOME_KEY_CHUNK * 70).toBeLessThan(8000);
  });
});

/* ---------------- 2. store against a stateful fake ---------------- */

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
type Fail = { table: string; op: "select" | "insert" | "update" | "delete"; nth?: number };

function colValue(r: Row, col: string): unknown {
  const m = /^raw_payload->>(\w+)$/.exec(col);
  if (m) {
    const p = r.raw_payload as Row | null | undefined;
    const v = p ? p[m[1]] : undefined;
    return v == null ? null : String(v);
  }
  return r[col];
}

function project(r: Row, select: string): Row {
  const out: Row = {};
  for (const part of select.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [alias, col] = part.includes(":") ? part.split(":") : [part, part];
    out[alias] = colValue(r, col);
  }
  return out;
}

/** Just enough PostgREST: eq / in / or(eq,eq) / order(id) / limit / range / count-head / insert / update / delete + select. */
function fakeAdmin(db: Db, fails: Fail[] = []) {
  const counts: Record<string, number> = {};
  let seq = 0;
  const failNow = (table: string, op: Fail["op"]) => {
    const k = `${table}:${op}`;
    counts[k] = (counts[k] ?? 0) + 1;
    return fails.some((f) => f.table === table && f.op === op && (f.nth == null || f.nth === counts[k]));
  };
  const admin = {
    from(table: string) {
      db[table] ??= [];
      let op: Fail["op"] = "select";
      let sel = "*";
      let head = false;
      let payload: Row[] | Row | null = null;
      let returning: string | null = null;
      let lim: number | null = null;
      let rng: [number, number] | null = null;
      const preds: ((r: Row) => boolean)[] = [];
      const run = () => {
        if (failNow(table, op)) return { data: null, error: { message: "boom" }, count: null };
        const rows = db[table];
        if (op === "insert") {
          const list = (payload as Row[]).map((p) => ({ id: `gen-${table}-${++seq}`, ...p }));
          if (table === "inbound_manifests") {
            const keys = new Set(rows.map((r) => r.dedupe_key));
            for (const r of list) {
              if (keys.has(r.dedupe_key)) return { data: null, error: { message: "duplicate key value violates unique constraint" }, count: null };
              keys.add(r.dedupe_key);
            }
          }
          rows.push(...list);
          return { data: returning ? list.map((r) => project(r, returning!)) : null, error: null, count: null };
        }
        const hit = rows.filter((r) => preds.every((p) => p(r)));
        if (op === "update") {
          for (const r of hit) Object.assign(r, payload as Row);
          return { data: returning ? hit.map((r) => project(r, returning!)) : null, error: null, count: null };
        }
        if (op === "delete") {
          db[table] = rows.filter((r) => !hit.includes(r));
          return { data: returning ? hit.map((r) => project(r, returning!)) : null, error: null, count: null };
        }
        if (head) return { data: null, error: null, count: hit.length };
        let out = [...hit].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (rng) out = out.slice(rng[0], rng[1] + 1);
        if (lim != null) out = out.slice(0, lim);
        return { data: out.map((r) => project(r, sel)), error: null, count: null };
      };
      const b = {
        select(s: string, o?: { count?: string; head?: boolean }) {
          if (op === "select") sel = s;
          else returning = s;
          head = !!o?.head;
          return b;
        },
        insert(rows: Row[]) { op = "insert"; payload = rows; return b; },
        update(patch: Row) { op = "update"; payload = patch; return b; },
        delete() { op = "delete"; return b; },
        eq(col: string, v: unknown) { preds.push((r) => colValue(r, col) === v); return b; },
        in(col: string, vs: unknown[]) { preds.push((r) => vs.includes(colValue(r, col))); return b; },
        or(f: string) {
          const alts = f.split(",").map((x) => {
            const m = /^(.+)\.eq\.(.+)$/.exec(x)!;
            return [m[1], m[2]] as const;
          });
          preds.push((r) => alts.some(([c, v]) => colValue(r, c) === v));
          return b;
        },
        order() { return b; },
        limit(n: number) { lim = n; return b; },
        range(f: number, t: number) { rng = [f, t]; return b; },
        then<T>(res: (v: ReturnType<typeof run>) => T, rej?: (e: unknown) => T) {
          return Promise.resolve().then(run).then(res, rej);
        },
      };
      return b;
    },
  };
  return admin as never;
}

const IMP = "5c2c0000-0000-4000-8000-00000000000a";
const SRC = "5c2c1000-0000-4000-8000-000000000001";

/** One accepted transfer (A, B) + one Received-date-only lot (C, rebuilt by day/session). */
function seed(): { db: Db; sources: RehomeSources } {
  const db: Db = {
    inbound_manifests: [
      { id: SRC, manifest_number: posImportManifestNumber(IMP), dedupe_key: `POS-IMPORT|${IMP}`, status: "accepted", raw_payload: { kind: POS_IMPORT_MANIFEST_KIND, import_id: IMP } },
      { id: "native-1", manifest_number: "WCIA-1", dedupe_key: "native|1", status: "accepted", raw_payload: { kind: "wcia" } },
    ],
    inventory_lots: [
      { id: "lot-a", manifest_id: SRC, ccrs_inventory_external_id: "A", vendor_id: null, on_hand_qty: 5, received_qty: 5, unit_cost_minor_units: 250, status: "active" },
      { id: "lot-b", manifest_id: SRC, ccrs_inventory_external_id: "B", vendor_id: null, on_hand_qty: 2, received_qty: 3, unit_cost_minor_units: 1000, status: "active" },
      { id: "lot-c", manifest_id: SRC, ccrs_inventory_external_id: "C", vendor_id: null, on_hand_qty: 1, received_qty: 1, unit_cost_minor_units: 99, status: "active" },
      { id: "lot-n", manifest_id: "native-1", ccrs_inventory_external_id: "N", vendor_id: null, on_hand_qty: 9, received_qty: 9, unit_cost_minor_units: 1, status: "active" },
    ],
    manifest_events: [],
    catalog_product_drafts: [],
    pos_fact_reviews: [],
    manifest_documents: [],
    vendor_manifest_payments: [],
  };
  const inputs = buildPlanInputs({
    importId: IMP,
    runId: "run-1",
    pacificToday: "2024-09-10",
    transferDetails: [
      {
        Id: 11, TransferNumber: "0001234567", FromVendor: "Grow Co", TransferDate: "2024-08-30T15:00:00Z",
        DateAccepted: "2024-08-30T18:56:03.507Z", StatusDisplay: "Accepted",
        Details: [{ Barcode: "A", AcceptedQuantity: 5, Quantity: 5 }, { Barcode: "B", AcceptedQuantity: 3, Quantity: 3 }],
      },
    ],
    listLots: [{ Barcode: "A", IncomingTransferId: 11 }, { Barcode: "B", IncomingTransferId: 11 }, { Barcode: "C" }],
  });
  const sources: RehomeSources = {
    lotSources: [
      { barcode: "A", vendor: "Grow Co", receivedDateRaw: "2024-08-30 12:00:00.000", units: 5, productName: "Alpha" },
      { barcode: "B", vendor: "Grow Co", receivedDateRaw: "2024-08-30 12:00:00.000", units: 3, productName: "Beta" },
      { barcode: "C", vendor: "Leaf Co", receivedDateRaw: "2024-07-03 12:00:00.000", units: 1, productName: "Gamma" },
    ],
    transfers: inputs.transfers,
    links: new Map(inputs.links),
    pacificToday: inputs.pacificToday,
    indexSkipped: inputs.indexSkipped,
  };
  return { db, sources };
}

const lotsOn = (db: Db, id: string) => db.inventory_lots.filter((l) => l.manifest_id === id).map((l) => l.id).sort();
const rebuilt = (db: Db) => db.inbound_manifests.filter((m) => (m.raw_payload as Row)?.kind === RECONSTRUCTED_MANIFEST_KIND);
const fingerprint = (db: Db) => JSON.stringify(db.inventory_lots.map(({ manifest_id: _m, ...rest }) => rest));

describe("cultivera-rehome store", () => {
  it("preview is read-only and plans every source lot", async () => {
    const { db, sources } = seed();
    const before = JSON.stringify(db);
    const p = await previewRehome(fakeAdmin(db), IMP, sources);
    expect(p.gate.pass).toBe(true);
    expect(p.plan.ok).toBe(true);
    expect(p.plan.summary.lotsToMove).toBe(3);
    expect(p.plan.summary.transferManifests).toBe(1);
    expect(p.plan.totals).toEqual({ lots: 3, onHandUnits: 8, receivedUnits: 9, costValueCents: 1250 + 2000 + 99 });
    expect(JSON.stringify(db)).toBe(before);
  });

  it("Apply moves only manifest_id, verifies from the DB, logs one event per manifest; a 2nd Apply is a no-op", async () => {
    const { db, sources } = seed();
    const fp = fingerprint(db);
    const a = await applyRehome(fakeAdmin(db), IMP, sources, { actorId: "u-1" });
    expect(a.ok).toBe(true);
    expect(a.problems).toEqual([]);
    expect(a.warnings).toEqual([]);
    expect(a.moved).toBe(3);
    expect(a.created).toBe(rebuilt(db).length);
    expect(a.eventsLogged).toBe(a.created);
    expect(db.manifest_events.every((e) => e.event_type === "accepted" && e.actor_id === "u-1")).toBe(true);
    expect(lotsOn(db, SRC)).toEqual([]);
    expect(lotsOn(db, "native-1")).toEqual(["lot-n"]);
    expect(fingerprint(db)).toBe(fp);
    const t = rebuilt(db).find((m) => m.manifest_number === "0001234567")!;
    expect(lotsOn(db, String(t.id))).toEqual(["lot-a", "lot-b"]);
    expect(t.transfer_date).toBe("2024-08-30");
    expect(t.accepted_at).toBe("2024-08-30T18:56:03.507Z");
    expect(t.status).toBe("accepted");

    const a2 = await applyRehome(fakeAdmin(db), IMP, sources);
    expect(a2.ok).toBe(true);
    expect(a2.created).toBe(0);
    expect(a2.moved).toBe(0);
    expect(a2.reused).toBe(a.created);
  });

  it("a manifest from elsewhere holding a planned dedupe key refuses in PREVIEW (nothing written)", async () => {
    const { db, sources } = seed();
    const p0 = await previewRehome(fakeAdmin(db), IMP, sources);
    const key = p0.plan.manifests.find((m) => m.source === "transfer")!.dedupeKey;
    db.inbound_manifests.push({ id: "foreign-1", manifest_number: "X", dedupe_key: key, status: "accepted", raw_payload: { kind: "wcia" } });
    const before = JSON.stringify(db);
    const p = await previewRehome(fakeAdmin(db), IMP, sources);
    expect(p.plan.ok).toBe(false);
    expect(p.plan.refusals.join()).toMatch(/foreign-1 already holds the key/);
    await expect(applyRehome(fakeAdmin(db), IMP, sources)).rejects.toThrow(/refused/);
    expect(JSON.stringify(db)).toBe(before);
  });

  it("readManifestsByKeys chunks at REHOME_KEY_CHUNK and fails closed", async () => {
    const { db } = seed();
    const keys = Array.from({ length: REHOME_KEY_CHUNK + 1 }, (_, i) => `k${i}`);
    db.inbound_manifests.push({ id: "m-last", dedupe_key: `k${REHOME_KEY_CHUNK}`, raw_payload: {} });
    expect((await readManifestsByKeys(fakeAdmin(db), keys)).map((m) => m.id)).toEqual(["m-last"]);
    await expect(readManifestsByKeys(fakeAdmin(db, [{ table: "inbound_manifests", op: "select", nth: 2 }]), keys)).rejects.toThrow(/Could not check/);
  });

  it("the move is guarded: a lot moved by hand meanwhile is left alone and reported", async () => {
    const { db, sources } = seed();
    const admin = fakeAdmin(db);
    // Hand-move lot-c onto the native manifest AFTER the preview read but before the UPDATE:
    // simulate by moving it first; the plan then logs it, never pulls it back.
    db.inventory_lots.find((l) => l.id === "lot-c")!.manifest_id = "native-1";
    const a = await applyRehome(admin, IMP, sources);
    expect(lotsOn(db, "native-1")).toEqual(["lot-c", "lot-n"]);
    expect(a.plan.exceptions.some((e) => e.code === "planned_barcode_without_lot")).toBe(true);
    expect(a.moved).toBe(2);
  });

  it("an interrupted Apply resumes without duplicating (insert failure, then move failure)", async () => {
    const { db, sources } = seed();
    await expect(applyRehome(fakeAdmin(db, [{ table: "inbound_manifests", op: "insert" }]), IMP, sources)).rejects.toThrow(/Nothing was moved/);
    expect(rebuilt(db)).toHaveLength(0);
    expect(lotsOn(db, SRC)).toHaveLength(3);

    await expect(applyRehome(fakeAdmin(db, [{ table: "inventory_lots", op: "update", nth: 2 }]), IMP, sources)).rejects.toThrow(/resume/);
    const made = rebuilt(db).length;
    expect(made).toBeGreaterThan(0);

    const a = await applyRehome(fakeAdmin(db), IMP, sources);
    expect(a.ok).toBe(true);
    expect(a.created).toBe(0);
    expect(rebuilt(db)).toHaveLength(made);
    expect(new Set(rebuilt(db).map((m) => m.dedupe_key)).size).toBe(made);
    expect(lotsOn(db, SRC)).toEqual([]);
  });

  it("a timeline-event failure is surfaced as a warning, never swallowed", async () => {
    const { db, sources } = seed();
    const a = await applyRehome(fakeAdmin(db, [{ table: "manifest_events", op: "insert" }]), IMP, sources);
    expect(a.ok).toBe(true);
    expect(a.eventsLogged).toBe(0);
    expect(a.warnings.join()).toMatch(/timeline event/);
    expect(lotsOn(db, SRC)).toEqual([]);
  });

  it("rollback restores the original state exactly", async () => {
    const { db, sources } = seed();
    const before = fingerprint(db);
    await applyRehome(fakeAdmin(db), IMP, sources);
    const r = await rollbackRehome(fakeAdmin(db), IMP);
    expect(r.movedBack).toBe(3);
    expect(r.deleted).toBeGreaterThan(0);
    expect(r.keptNonEmpty + r.keptWithWork).toBe(0);
    expect(rebuilt(db)).toHaveLength(0);
    expect(lotsOn(db, SRC)).toEqual(["lot-a", "lot-b", "lot-c"]);
    expect(fingerprint(db)).toBe(before);
    expect(db.inbound_manifests.map((m) => m.id).sort()).toEqual(["5c2c1000-0000-4000-8000-000000000001", "native-1"]);
  });

  it("rollback never deletes a rebuilt manifest that carries work or a hand-placed lot", async () => {
    const { db, sources } = seed();
    await applyRehome(fakeAdmin(db), IMP, sources);
    const [m1, m2] = rebuilt(db);
    db.vendor_manifest_payments.push({ id: "pay-1", manifest_id: m1.id });
    // A native lot hand-placed on a rebuilt manifest: rollback moves back only what it can prove is ours.
    db.inventory_lots.push({ id: "lot-x", manifest_id: m2.id, ccrs_inventory_external_id: "X", on_hand_qty: 1, received_qty: 1, unit_cost_minor_units: 1, status: "active" });
    const r = await rollbackRehome(fakeAdmin(db), IMP);
    expect(db.inbound_manifests.some((m) => m.id === m1.id)).toBe(true);
    expect(r.keptWithWork).toBe(1);
    expect(db.vendor_manifest_payments).toHaveLength(1);
    expect(rebuilt(db).length).toBe(r.keptWithWork + r.keptNonEmpty);
  });

  it("rollback fails closed when it cannot check work tables", async () => {
    const { db, sources } = seed();
    await applyRehome(fakeAdmin(db), IMP, sources);
    await expect(rollbackRehome(fakeAdmin(db, [{ table: "pos_fact_reviews", op: "select" }]), IMP)).rejects.toThrow(/could not check pos_fact_reviews/);
    expect(rebuilt(db).length).toBeGreaterThan(0);
  });
});

/* ---------------- 3. wiring ---------------- */

describe("cultivera-rehome wiring", () => {
  it("the fetch preview and Apply share ONE planner (planFromSources)", () => {
    expect(src("src/lib/pos/cultivera-fetch-assemble.ts")).toMatch(/planFromSources\(/);
    expect(src("src/lib/inventory/cultivera-rehome-store.ts")).toMatch(/planFromSources\(/);
  });
  it("the lot UPDATE changes manifest_id only and is guarded by the source manifest", () => {
    const s = src("src/lib/inventory/cultivera-rehome-store.ts");
    expect(s).toMatch(/\.update\(\{ manifest_id: target \}\)\s*\.in\("id", b\.lotIds\)\s*\.eq\("manifest_id", state\.source\.id\)/);
    expect(s).not.toMatch(/\.update\(\{[^}]*(on_hand_qty|unit_cost|status|vendor_id)/);
  });
  it("is registered in the pure self-test runner at the measured floor", () => {
    expect(src("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("cultivera-rehome-core", __runCultiveraRehomeCoreTests\(\), 67\)/);
  });
});
