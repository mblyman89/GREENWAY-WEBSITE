/**
 * tests/compliance/r50-import-lineage.test.ts   (R50 S2b, bible §1.3)
 *
 * After R50 S2c re-homes a Cultivera import's lots onto rebuilt manifests,
 * every reader that found "this import's lots" by the one synthetic number
 * `POS-IMPORT-<id8>` would silently lose them. S2b moves those readers onto
 * the import id. This file pins:
 *
 *   1. the pure core (including the 8-char prefix collision between imports),
 *   2. the store against a fake PostgREST client (chunking, paging, fail-closed,
 *      the destroyed-lot scope),
 *   3. that each reader is actually wired (by source), and
 *   4. the enrichment attribution date rule for rebuilt manifests.
 *
 * Real-database before/after: scripts/recon/r50-s2b (PG15 + PostgREST 12).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LINEAGE_MANIFEST_SELECT,
  POS_IMPORT_NUMBER_PREFIX,
  importManifestOr,
  isCultiveraMigrationRow,
  isPosImportRow,
  isSafeImportId,
  manifestIdsForImport,
  posImportManifestNumber,
  __runImportLineageCoreTests,
} from "../../src/lib/inventory/import-lineage-core";
import {
  LINEAGE_MANIFEST_CHUNK,
  importManifestIds,
  readLotsOnManifests,
} from "../../src/lib/inventory/import-lineage-store";
import {
  isImportManifest,
  isRebuiltManifest,
  lotReceivedAt,
} from "../../src/lib/enrichment/enrichment-manifest-core";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

const A = "abcd1234-0000-4000-8000-00000000000a";
const B = "abcd1234-9999-4000-8000-00000000000b";

describe("import-lineage core", () => {
  it("self-tests run and the runner floor is the measured 30", () => {
    const r = __runImportLineageCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(30);
    expect(src("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("import-lineage-core", __runImportLineageCoreTests(), 30)',
    );
  });

  it("the synthetic number is byte-identical to import-service.ts", () => {
    expect(posImportManifestNumber(A)).toBe("POS-IMPORT-abcd1234");
    expect(POS_IMPORT_NUMBER_PREFIX).toBe("POS-IMPORT-");
    expect(src("src/lib/pos/import-service.ts")).toContain("manifest_number: `POS-IMPORT-${importId.slice(0, 8)}`");
  });

  it("refuses ids that could inject into a filter string", () => {
    expect(isSafeImportId(A)).toBe(true);
    expect(isSafeImportId("abc")).toBe(false);
    expect(isSafeImportId("abcd1234,manifest_number.neq.x")).toBe(false);
    expect(isSafeImportId("abcd1234)")).toBe(false);
    expect(isSafeImportId(null)).toBe(false);
    expect(importManifestOr("abcd1234,id.neq.0")).toBeNull();
    expect(manifestIdsForImport([{ id: "m", manifest_number: "POS-IMPORT-x" }], "bad id")).toEqual([]);
  });

  it("builds one OR filter: the number or the recorded import id", () => {
    expect(importManifestOr(A)).toBe(`manifest_number.eq.POS-IMPORT-abcd1234,raw_payload->>import_id.eq.${A}`);
    expect(LINEAGE_MANIFEST_SELECT).toBe(
      "id, manifest_number, payload_kind:raw_payload->>kind, payload_import_id:raw_payload->>import_id",
    );
  });

  it("keeps the POS-IMPORT manifest and the rebuilt ones; never a real delivery", () => {
    const rows = [
      { id: "m-pos", manifest_number: "POS-IMPORT-abcd1234", payload_kind: "pos-import-migration", payload_import_id: null },
      { id: "m-reb", manifest_number: "0001108", payload_kind: "cultivera-reconstructed", payload_import_id: A },
      { id: "m-nat", manifest_number: "WCIA-0421", payload_kind: null, payload_import_id: A },
      { id: "m-reb", manifest_number: "0001108", payload_kind: "cultivera-reconstructed", payload_import_id: A },
    ];
    expect(manifestIdsForImport(rows, A)).toEqual(["m-pos", "m-reb"]);
  });

  it("two imports sharing an 8-char prefix do not steal each other's manifests", () => {
    const rows = [
      { id: "m-a", manifest_number: "POS-IMPORT-abcd1234", payload_kind: "pos-import-migration", payload_import_id: A },
      { id: "m-b", manifest_number: "POS-IMPORT-abcd1234", payload_kind: "pos-import-migration", payload_import_id: B },
      { id: "r-b", manifest_number: "0002000", payload_kind: "cultivera-reconstructed", payload_import_id: B },
    ];
    expect(manifestIdsForImport(rows, A)).toEqual(["m-a"]);
    expect(manifestIdsForImport(rows, B)).toEqual(["m-b", "r-b"]);
  });

  it("a rebuilt manifest stamped for another import is not ours", () => {
    const rows = [{ id: "r", manifest_number: "0001108", payload_kind: "cultivera-reconstructed", payload_import_id: B }];
    expect(manifestIdsForImport(rows, A)).toEqual([]);
  });

  it("provenance predicates", () => {
    expect(isCultiveraMigrationRow({ manifest_number: "0001108", payload_kind: "cultivera-reconstructed" })).toBe(true);
    expect(isCultiveraMigrationRow({ manifest_number: "pos-import-abcd1234", payload_kind: null })).toBe(true);
    expect(isCultiveraMigrationRow({ manifest_number: "WCIA-0421", payload_kind: null })).toBe(false);
    expect(isCultiveraMigrationRow(null)).toBe(false);
    expect(isPosImportRow({ manifest_number: "0001108", payload_kind: "cultivera-reconstructed" })).toBe(false);
    expect(isPosImportRow({ manifest_number: "X", payload_kind: "pos-import-migration" })).toBe(true);
    expect(isPosImportRow({ manifest_number: "POS-IMPORT-abcd1234", payload_kind: null })).toBe(true);
  });
});

/* ---------------- fake PostgREST client for the store ---------------- */

type Call = { table: string; select: string; in?: [string, string[]]; neq?: [string, string]; or?: string; range: [number, number] };

function fakeAdmin(opts: { lots?: { id: string; manifest_id: string; status: string }[]; manifests?: Record<string, unknown>[]; failOn?: number }) {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      const c: Partial<Call> = { table };
      const b = {
        select(s: string) { c.select = s; return b; },
        in(col: string, vals: string[]) { c.in = [col, vals]; return b; },
        neq(col: string, v: string) { c.neq = [col, v]; return b; },
        or(f: string) { c.or = f; return b; },
        order() { return b; },
        async range(from: number, to: number) {
          c.range = [from, to];
          calls.push(c as Call);
          if (opts.failOn != null && calls.length === opts.failOn) return { data: null, error: { message: "boom" } };
          let rows: Record<string, unknown>[] =
            table === "inventory_lots" ? [...(opts.lots ?? [])] : [...(opts.manifests ?? [])];
          if (c.in) rows = rows.filter((r) => c.in![1].includes(String(r[c.in![0]])));
          if (c.neq) rows = rows.filter((r) => r[c.neq![0]] !== c.neq![1]);
          rows.sort((x, y) => String(x.id).localeCompare(String(y.id)));
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return b;
    },
  };
  return { admin: admin as never, calls };
}

describe("import-lineage store", () => {
  it("chunks manifest ids at 150 and pages every chunk to the end", async () => {
    const manifests = Array.from({ length: 151 }, (_, i) => `m${String(i).padStart(3, "0")}`);
    const lots = Array.from({ length: 1200 }, (_, i) => ({
      id: `l${String(i).padStart(5, "0")}`,
      manifest_id: i < 1100 ? "m000" : "m150",
      status: "active",
    }));
    const { admin, calls } = fakeAdmin({ lots });
    const got = await readLotsOnManifests<{ id: string }>(admin, manifests, "id");
    expect(got).toHaveLength(1200);
    expect(LINEAGE_MANIFEST_CHUNK).toBe(150);
    expect(calls.every((c) => c.in![1].length <= 150)).toBe(true);
    expect(calls.filter((c) => c.in![1].includes("m000")).length).toBeGreaterThanOrEqual(2); // paged past 1,000
  });

  it("a failed page THROWS (never a short list)", async () => {
    const lots = Array.from({ length: 1500 }, (_, i) => ({ id: `l${String(i).padStart(5, "0")}`, manifest_id: "m1", status: "active" }));
    const { admin } = fakeAdmin({ lots, failOn: 2 });
    await expect(readLotsOnManifests(admin, ["m1"], "id")).rejects.toThrow(/Could not read every lot/);
  });

  it("excludeDestroyed only when asked", async () => {
    const lots = [
      { id: "l1", manifest_id: "m1", status: "active" },
      { id: "l2", manifest_id: "m1", status: "destroyed" },
    ];
    const a = fakeAdmin({ lots });
    expect(await readLotsOnManifests(a.admin, ["m1"], "id")).toHaveLength(2);
    const b = fakeAdmin({ lots });
    expect(await readLotsOnManifests(b.admin, ["m1"], "id", { excludeDestroyed: true })).toHaveLength(1);
    expect(b.calls[0].neq).toEqual(["status", "destroyed"]);
  });

  it("no manifests → no lot query at all", async () => {
    const { admin, calls } = fakeAdmin({});
    expect(await readLotsOnManifests(admin, [], "id")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("importManifestIds: one OR read, core filter applied, bad id and failed read throw", async () => {
    const manifests = [
      { id: "m-a", manifest_number: "POS-IMPORT-abcd1234", payload_kind: "pos-import-migration", payload_import_id: A },
      { id: "m-b", manifest_number: "POS-IMPORT-abcd1234", payload_kind: "pos-import-migration", payload_import_id: B },
      { id: "r-a", manifest_number: "0001108", payload_kind: "cultivera-reconstructed", payload_import_id: A },
    ];
    const f = fakeAdmin({ manifests });
    expect(await importManifestIds(f.admin, A)).toEqual(["m-a", "r-a"]);
    expect(f.calls[0].table).toBe("inbound_manifests");
    expect(f.calls[0].or).toBe(importManifestOr(A));
    expect(f.calls[0].select).toBe(LINEAGE_MANIFEST_SELECT);
    await expect(importManifestIds(fakeAdmin({}).admin, "x,y")).rejects.toThrow(/not valid/);
    await expect(importManifestIds(fakeAdmin({ manifests, failOn: 1 }).admin, A)).rejects.toThrow(/Could not find/);
  });
});

/* ---------------- reachability: every reader is wired ---------------- */

describe("readers follow lots by import id", () => {
  const readers = [
    "src/lib/inventory/received-date-bulk-store.ts",
    "src/lib/pos/legacy-lot-removal-store.ts",
  ];
  for (const f of readers) {
    it(`${f} uses the lineage store and no single-number lookup`, () => {
      const s = src(f);
      expect(s).toContain('from "@/lib/inventory/import-lineage-store"');
      expect(s).toContain("importManifestIds(admin, importId)");
      expect(s).toContain("readLotsOnManifests");
      expect(s).not.toMatch(/POS-IMPORT-\$\{/);
      expect(s).not.toMatch(/from\("inbound_manifests"\)/); // the manifest lookup lives in the lineage store only
    });
  }

  it("received-date: the write is scoped to the import's own non-destroyed lots (same as the page)", () => {
    const s = src("src/lib/inventory/received-date-bulk-store.ts");
    expect((s.match(/excludeDestroyed: true/g) ?? []).length).toBe(2);
    expect(s).toContain("filter((id) => own.has(id))");
    expect(s).toMatch(/\.in\("id", chunk\)[\s\S]{0,80}\.is\("received_on", null\)/);
  });

  it("backfill count uses the lineage store, not the manifest number", () => {
    const s = src("src/lib/pos/import-service.ts");
    expect(s).toContain("async function countImportLots(");
    expect(s).not.toContain("countLotsForManifestNumber");
    expect((s.match(/countImportLots\(admin, importId\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("classification source tab uses the shared provenance predicate", () => {
    const s = src("src/lib/inventory/classification-worklist-store.ts");
    expect(s).toContain(".select(LINEAGE_MANIFEST_SELECT)");
    expect(s).toContain("if (isCultiveraMigrationRow(row))");
    expect(s).not.toContain("IMPORT_MANIFEST_PREFIX =");
  });

  it("enrichment attribution selects the payload kind", () => {
    expect(src("src/lib/enrichment/enrichment-manifest.ts")).toMatch(/ATTRIBUTION_MANIFEST_COLUMNS[\s\S]{0,200}payload_kind:raw_payload->>kind/);
  });
});

describe("enrichment attribution on rebuilt manifests", () => {
  const rebuilt = {
    id: "r", manifest_number: "0001108", vendor_id: null, vendor_label: null, transfer_date: null,
    received_at: "2024-03-01T18:00:00Z", accepted_at: "2025-10-31T13:00:00Z", status: "accepted",
    payload_kind: "cultivera-reconstructed",
  };
  it("is rebuilt, not the synthetic POS-IMPORT manifest; the synthetic one is found by kind too", () => {
    expect(isRebuiltManifest(rebuilt)).toBe(true);
    expect(isImportManifest(rebuilt as never)).toBe(false);
    expect(isImportManifest({ manifest_number: "X", payload_kind: "pos-import-migration" })).toBe(true);
  });
  it("uses the lot's own received date, then the real transfer date, never the re-home time", () => {
    const lot = { manifest_id: "r", received_on: "2024-02-15" } as never;
    expect(lotReceivedAt(lot, rebuilt as never)).toContain("2024-02-15");
    const undated = { manifest_id: "r", received_on: null } as never;
    expect(lotReceivedAt(undated, rebuilt as never)).toBe("2024-03-01T18:00:00.000Z");
    expect(lotReceivedAt(undated, rebuilt as never)).not.toContain("2025-10-31");
  });
});
