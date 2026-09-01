/**
 * tests/compliance/import-lot-created-at.test.ts  (SLICE 1)
 *
 * Vitest mirror of the created_at guardrails in src/lib/pos/import-lot-core.ts.
 *
 * Regression under test (PROVEN, see FORENSIC_AUDIT_CULTIVERA_IMPORT.md):
 * publishing the Cultivera import died with
 *   'null value in column "created_at" of relation "inventory_lots"
 *    violates not-null constraint'
 * because import-service.ts omitted the created_at KEY for the 202 lots whose
 * POS "Received date" was blank. postgrest-js builds the PostgREST `columns=`
 * list from the UNION of every row's keys and does not send
 * `Prefer: missing=default`, so those rows were written as an explicit NULL.
 */
import { describe, it, expect } from "vitest";
import {
  __runImportLotCoreTests,
  planImportLots,
  resolveLotCreatedAt,
  insertKeySignature,
  findNonUniformInsertRow,
  assertUniformInsertKeys,
  type ImportLotSource,
} from "@/lib/pos/import-lot-core";

const NOW = "2026-09-01T07:00:00.000Z";

const src = (over: Partial<ImportLotSource> = {}): ImportLotSource => ({
  posProductKey: "pos-abc123",
  itemName: "Blue Dream",
  barcode: "GF42802505795142",
  productName: "Acme - Blue Dream - 3.5g",
  category: "Flower",
  inventoryType: "Usable Marijuana",
  strainName: "Blue Dream",
  strainType: "hybrid",
  brand: "Acme",
  vendor: "ACME FARMS",
  units: 10,
  costRaw: "$5.00",
  receivedDateRaw: "06/17/2026",
  expirationDateRaw: "",
  coaRaw: "Y",
  isMedical: false,
  isSample: false,
  unitWeight: 3.5,
  unitWeightUom: "g",
  ...over,
});

describe("import-lot-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runImportLotCoreTests()).not.toThrow();
  });
});

describe("resolveLotCreatedAt", () => {
  it("keeps the received-date timestamp for dated lots", () => {
    expect(resolveLotCreatedAt("2026-06-17T12:00:00.000Z", NOW)).toBe("2026-06-17T12:00:00.000Z");
  });

  it("falls back to the publish run's instant for undated lots", () => {
    expect(resolveLotCreatedAt(null, NOW)).toBe(NOW);
    expect(resolveLotCreatedAt("", NOW)).toBe(NOW);
    expect(resolveLotCreatedAt("   ", NOW)).toBe(NOW);
  });

  it("never returns null or an empty string", () => {
    for (const planned of [null, "", "  ", "2026-01-01T12:00:00.000Z"]) {
      const v = resolveLotCreatedAt(planned, NOW);
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it("throws rather than emitting a NULL when no fallback is supplied", () => {
    expect(() => resolveLotCreatedAt(null, "")).toThrow(/NOT NULL/i);
  });
});

describe("insert key-set uniformity guardrail", () => {
  it("computes an order-independent signature", () => {
    expect(insertKeySignature({ b: 1, a: 2 })).toBe(insertKeySignature({ a: 2, b: 1 }));
  });

  it("treats explicit nulls as present keys", () => {
    expect(findNonUniformInsertRow([{ a: 1, created_at: null }, { a: 2, created_at: "x" }])).toBeNull();
  });

  it("detects an omitted column and names it", () => {
    const bad = findNonUniformInsertRow([{ a: 1, created_at: "x" }, { a: 2 }]);
    expect(bad).not.toBeNull();
    expect(bad?.index).toBe(1);
    expect(bad?.missing).toEqual(["created_at"]);
  });

  it("accepts empty and single-row batches", () => {
    expect(findNonUniformInsertRow([])).toBeNull();
    expect(findNonUniformInsertRow([{ a: 1 }])).toBeNull();
  });

  it("throws an actionable error naming the batch and column", () => {
    let message = "";
    try {
      assertUniformInsertKeys([{ a: 1, created_at: "x" }, { a: 2 }], "inventory_lots batch 20");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("inventory_lots batch 20");
    expect(message).toContain("created_at");
  });

  it("stays silent for a uniform batch", () => {
    expect(() =>
      assertUniformInsertKeys([{ a: 1, created_at: "x" }, { a: 2, created_at: "y" }], "inventory_lots"),
    ).not.toThrow();
  });
});

describe("mixed dated/undated batch (the real Cultivera failure mode)", () => {
  const plan = planImportLots([
    src({ barcode: "D1", receivedDateRaw: "01/02/2026" }),
    src({ barcode: "U1", receivedDateRaw: "" }),
    src({ barcode: "D2", receivedDateRaw: "03/04/2026" }),
    src({ barcode: "U2", receivedDateRaw: "" }),
  ]);

  it("plans every lot, dated and undated", () => {
    expect(plan.lots).toHaveLength(4);
    expect(plan.lots.filter((l) => l.createdAtIso === null)).toHaveLength(2);
  });

  it("orders dated lots first and undated lots last", () => {
    expect(plan.lots.slice(0, 2).every((l) => l.createdAtIso !== null)).toBe(true);
    expect(plan.lots.slice(2).every((l) => l.createdAtIso === null)).toBe(true);
  });

  it("produces one uniform key set once created_at is resolved", () => {
    const rows = plan.lots.map((l) => ({
      ccrs_inventory_external_id: l.ccrsExternalId,
      received_qty: l.receivedQty,
      created_at: resolveLotCreatedAt(l.createdAtIso, NOW),
    }));
    expect(new Set(rows.map(insertKeySignature)).size).toBe(1);
    expect(rows.every((r) => r.created_at)).toBe(true);
    expect(() => assertUniformInsertKeys(rows, "inventory_lots")).not.toThrow();
  });

  it("preserves FIFO: resolved timestamps are non-decreasing in plan order", () => {
    const resolved = plan.lots.map((l) => resolveLotCreatedAt(l.createdAtIso, NOW));
    for (let i = 1; i < resolved.length; i++) {
      expect(resolved[i] >= resolved[i - 1]).toBe(true);
    }
  });

  it("would have been rejected by the guardrail before SLICE 1", () => {
    const legacy = plan.lots.map((l) => ({
      ccrs_inventory_external_id: l.ccrsExternalId,
      received_qty: l.receivedQty,
      ...(l.createdAtIso ? { created_at: l.createdAtIso } : {}),
    }));
    expect(findNonUniformInsertRow(legacy)).not.toBeNull();
  });
});
