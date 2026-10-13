/**
 * tests/compliance/r50-s3d-cultivera-flag.test.ts   (R50 S3d, bible §0.4)
 *
 * Owner: migrated products look the same as received ones on the Inventory
 * list and the lot page, except for a flag saying they came via Cultivera.
 * Pins:
 *   1. the pure rule (self-test count; real delivery never flagged);
 *   2. the list loader: one lineage select, chunked, fails SOFT to the marker;
 *   3. both pages use the one rule and render the flag;
 *   4. nothing else on the pages changes for a migrated lot (same columns).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { select: string; in: string[]; range: [number, number] };
const state: { rows: Record<string, unknown>[]; fail: boolean; failOnCall: number; calls: Call[]; throwOnCreate: boolean } = {
  rows: [],
  fail: false,
  failOnCall: 0,
  calls: [],
  throwOnCreate: false,
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (state.throwOnCreate) throw new Error("no service role");
    return {
      from: (table: string) => {
        expect(table).toBe("inbound_manifests");
        const call: Call = { select: "", in: [], range: [0, 0] };
        const q = {
          select(s: string) {
            call.select = s;
            return q;
          },
          in(_c: string, ids: string[]) {
            call.in = ids;
            return q;
          },
          order() {
            return q;
          },
          range(from: number, to: number) {
            call.range = [from, to];
            state.calls.push(call);
            if (state.fail || state.calls.length === state.failOnCall) return Promise.resolve({ data: null, error: { message: "boom" } });
            const data = state.rows.filter((r) => call.in.includes(r.id as string)).slice(from, to + 1);
            return Promise.resolve({ data, error: null });
          },
        };
        return q;
      },
    };
  },
}));

import {
  __runCultiveraReceivedFlagCoreTests,
  isReceivedViaCultivera,
  lotFlaggedCultivera,
  manifestPayloadKind,
} from "../../src/lib/inventory/cultivera-received-flag-core";
import { loadCultiveraManifestIds } from "../../src/lib/inventory/cultivera-received-flag-server";
import { LINEAGE_MANIFEST_SELECT } from "../../src/lib/inventory/import-lineage-core";
import { MIGRATION_MARKER } from "../../src/lib/inventory/bulk-fill-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

beforeEach(() => {
  state.rows = [];
  state.fail = false;
  state.failOnCall = 0;
  state.calls = [];
  state.throwOnCreate = false;
});

describe("R50 S3d — the rule", () => {
  it("self-tests run at the measured 20", () => {
    expect(__runCultiveraReceivedFlagCoreTests()).toEqual({ passed: 20, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("cultivera-received-flag-core", __runCultiveraReceivedFlagCoreTests(), 20)',
    );
  });

  it("a rebuilt manifest (raw_payload.kind) flags; a real delivery never does", () => {
    const k = manifestPayloadKind({ kind: "cultivera-reconstructed", items: [] });
    expect(isReceivedViaCultivera({ notes: "Received via intake" }, { manifest_number: "0001108", payload_kind: k })).toBe(true);
    expect(isReceivedViaCultivera({ notes: "Received via intake" }, { manifest_number: "0001108", payload_kind: manifestPayloadKind({ kind: "wcia" }) })).toBe(false);
    expect(isReceivedViaCultivera({ notes: `${MIGRATION_MARKER} x` }, null)).toBe(true);
  });
});

describe("R50 S3d — list loader", () => {
  it("one lineage select per chunk, only migration manifests kept", async () => {
    state.rows = [
      { id: "m-r", manifest_number: "0001108", payload_kind: "cultivera-reconstructed" },
      { id: "m-p", manifest_number: "POS-IMPORT-abcd1234", payload_kind: "pos-import-migration" },
      { id: "m-n", manifest_number: "0421", payload_kind: null },
    ];
    const got = await loadCultiveraManifestIds([
      { manifest_id: "m-r" },
      { manifest_id: "m-p" },
      { manifest_id: "m-n" },
      { manifest_id: "m-r" },
      { manifest_id: null },
      { manifest_id: " " },
    ]);
    expect([...got].sort()).toEqual(["m-p", "m-r"]);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].select).toBe(LINEAGE_MANIFEST_SELECT);
    expect([...state.calls[0].in].sort()).toEqual(["m-n", "m-p", "m-r"]);
  });

  it("chunks a large id list (never one giant .in())", async () => {
    const lots = Array.from({ length: 450 }, (_, i) => ({ manifest_id: `m${i}` }));
    state.rows = lots.map((l) => ({ id: l.manifest_id, manifest_number: "POS-IMPORT-x", payload_kind: null }));
    const got = await loadCultiveraManifestIds(lots);
    expect(got.size).toBe(450);
    expect(state.calls.length).toBeGreaterThan(1);
    expect(state.calls.every((c) => c.in.length <= 200)).toBe(true);
  });

  it("no manifests -> no read", async () => {
    expect((await loadCultiveraManifestIds([{ manifest_id: null }])).size).toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it("a failed read fails SOFT (empty set; the page falls back to the marker)", async () => {
    state.rows = [{ id: "m-r", manifest_number: "0001108", payload_kind: "cultivera-reconstructed" }];
    state.fail = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const got = await loadCultiveraManifestIds([{ manifest_id: "m-r" }]);
    expect(got.size).toBe(0);
    expect(lotFlaggedCultivera({ manifest_id: "m-r", notes: `${MIGRATION_MARKER} y` }, got)).toBe(true);
    state.fail = false;
    state.throwOnCreate = true;
    expect((await loadCultiveraManifestIds([{ manifest_id: "m-r" }])).size).toBe(0);
    // A later chunk failing drops the whole set (never a partial, chunk-dependent flag).
    state.throwOnCreate = false;
    state.calls = [];
    state.failOnCall = 2;
    const many = Array.from({ length: 450 }, (_, i) => ({ manifest_id: `m${i}` }));
    state.rows = many.map((l) => ({ id: l.manifest_id, manifest_number: "POS-IMPORT-x", payload_kind: null }));
    expect((await loadCultiveraManifestIds(many)).size).toBe(0);
    expect(state.calls.length).toBeGreaterThan(1);
    err.mockRestore();
  });
});

describe("R50 S3d — both pages use the one rule", () => {
  const list = read("src/app/admin/inventory/page.tsx");
  const lot = read("src/app/admin/inventory/[id]/page.tsx");

  it("Inventory list: loader started with the lots, flag in the always-visible product cell", () => {
    expect(list).toContain("loadCultiveraManifestIds(allLots)");
    expect(list).toContain("lotFlaggedCultivera(l, cultiveraManifestIds)");
    expect(list).toContain('data-testid="inventory-cultivera-flag"');
    const at = list.indexOf("· unlinked");
    expect(at).toBeGreaterThan(0);
    const cell = list.slice(at, list.indexOf('{show("ids")', at));
    expect(cell).toContain("<CultiveraBadge />");
  });

  it("lot page: manifest kind from raw_payload + the marker, flag beside the manifest link", () => {
    expect(lot).toContain("isReceivedViaCultivera(");
    expect(lot).toContain("manifestPayloadKind(manifest.raw_payload)");
    expect(lot).toContain('data-testid="lot-cultivera-flag"');
    const row = lot.slice(lot.indexOf('data-testid="lot-manifest-link"'), lot.indexOf("{lot.notes && <Row"));
    expect(row).toContain("receivedViaCultivera ?");
  });

  it("the flag is the only branch: no other render path keys on it", () => {
    expect(list.match(/lotFlaggedCultivera\(/g)).toHaveLength(1);
    expect(lot.match(/receivedViaCultivera \?/g)).toHaveLength(2); // badge + no-link fallback, both the flag itself
  });
});
