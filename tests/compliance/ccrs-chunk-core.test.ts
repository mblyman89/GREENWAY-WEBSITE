/**
 * S-12b (CCRS Bible v2 Part 05 §B–§C): chunking and per-chunk stamps.
 *
 * Why this matters to the license: CCRS never accepts the same file name twice
 * [A29], the name has no chunk slot [G L0046], and an error email marks every
 * row of its file uncertain. So each chunk needs its own one-second stamp, the
 * chunks must stay in upload-group order, and no file may exceed 1,000,000 rows
 * [BRIAN A7].
 */
import { describe, expect, it } from "vitest";
import {
  CCRS_CHUNK_ROWS,
  CCRS_FILE_MAX_ROWS,
  CcrsChunkError,
  allocateStampBase,
  assertChunkRows,
  chunkRows,
  chunkStampInstant,
  compareChunkPlacement,
  floorToSecond,
  lastStampOf,
  type ChunkPlacement,
} from "../../src/lib/compliance/ccrs-chunk-core";
import { CCRS_UPLOAD_ORDER, ccrsFileName } from "../../src/lib/compliance/ccrs-batch-core";

describe("chunkRows (Part 05 §C)", () => {
  it("40,662 rows (the delivery's live lots not in the back office) → 10,000 ×4 + 662", () => {
    const rows = Array.from({ length: 40_662 }, (_, i) => i);
    const chunks = chunkRows(rows);
    expect(chunks.map((c) => c.length)).toEqual([10_000, 10_000, 10_000, 10_000, 662]);
    // Nothing lost, nothing duplicated, order preserved.
    expect(chunks.flat()).toEqual(rows);
  });

  it("exact boundaries: 10,000 → 1 chunk, 10,001 → 2, 0 → none", () => {
    expect(chunkRows(Array(10_000).fill(0)).length).toBe(1);
    expect(chunkRows(Array(10_001).fill(0)).map((c) => c.length)).toEqual([10_000, 1]);
    expect(chunkRows([])).toEqual([]);
  });

  it("the operational size is 10,000 and the ceiling is 1,000,000 [BRIAN A7]", () => {
    expect(CCRS_CHUNK_ROWS).toBe(10_000);
    expect(CCRS_FILE_MAX_ROWS).toBe(1_000_000);
  });

  it("a chunk size above 1,000,000 throws; 1,000,000 itself is allowed", () => {
    expect(() => assertChunkRows(1_000_001)).toThrow(CcrsChunkError);
    expect(() => chunkRows([1], 1_000_001)).toThrow(/1000000 rows per file/);
    expect(assertChunkRows(1_000_000)).toBe(1_000_000);
  });

  it("zero, negative and fractional sizes throw", () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) expect(() => assertChunkRows(bad)).toThrow(CcrsChunkError);
  });
});

describe("chunk stamps (Part 05 §B)", () => {
  const base = new Date("2026-10-05T17:30:12.987Z");

  it("chunk k = base + (k-1) s, floored to the second, strictly increasing by exactly 1 s", () => {
    const stamps = [1, 2, 3, 4, 5].map((k) => chunkStampInstant(base, k).getTime());
    expect(stamps[0]).toBe(Date.parse("2026-10-05T17:30:12.000Z"));
    for (let i = 1; i < stamps.length; i += 1) expect(stamps[i] - stamps[i - 1]).toBe(1000);
  });

  it("every chunk gets a DIFFERENT file name (no suffix; distinct stamps)", () => {
    const names = [1, 2, 3, 4, 5].map((k) => ccrsFileName("Inventory", "413541", chunkStampInstant(base, k)));
    expect(new Set(names).size).toBe(5);
    for (const n of names) expect(n).toMatch(/^Inventory_413541_\d{14}\.csv$/);
  });

  it("a one-chunk file keeps exactly today's name (chunk 1 = base)", () => {
    expect(ccrsFileName("Inventory", "413541", chunkStampInstant(base, 1))).toBe(
      ccrsFileName("Inventory", "413541", floorToSecond(base)),
    );
  });

  it("chunk numbers below 1 throw", () => {
    expect(() => chunkStampInstant(base, 0)).toThrow(CcrsChunkError);
  });

  it("allocation never reuses a stamp: base >= last used + 1 s, else now", () => {
    const now = new Date("2026-10-05T17:30:12.400Z");
    expect(allocateStampBase(now, null).toISOString()).toBe("2026-10-05T17:30:12.000Z");
    // A previous emission's last chunk is in the future of `now` → continue after it.
    expect(allocateStampBase(now, new Date("2026-10-05T17:30:15.000Z")).toISOString()).toBe("2026-10-05T17:30:16.000Z");
    // Same second as now → still +1 s.
    expect(allocateStampBase(now, new Date("2026-10-05T17:30:12.000Z")).toISOString()).toBe("2026-10-05T17:30:13.000Z");
    // Long ago → now.
    expect(allocateStampBase(now, new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-10-05T17:30:12.000Z");
  });

  it("lastStampOf = base + (max chunk_of - 1) s", () => {
    expect(lastStampOf(base, [1, 5, 2]).toISOString()).toBe("2026-10-05T17:30:16.000Z");
    expect(lastStampOf(base, []).toISOString()).toBe("2026-10-05T17:30:12.000Z");
  });
});

describe("group order across chunks", () => {
  it("Group 1 before Group 2 before Group 3; chunks of one type in chunk order", () => {
    const shuffled: ChunkPlacement[] = [
      { type: "Sale", chunkNo: 2, chunkOf: 2 },
      { type: "Inventory", chunkNo: 3, chunkOf: 3 },
      { type: "Product", chunkNo: 1, chunkOf: 1 },
      { type: "Inventory", chunkNo: 1, chunkOf: 3 },
      { type: "Sale", chunkNo: 1, chunkOf: 2 },
      { type: "Strain", chunkNo: 1, chunkOf: 1 },
      { type: "Inventory", chunkNo: 2, chunkOf: 3 },
    ];
    const sorted = [...shuffled].sort(compareChunkPlacement).map((p) => `${p.type}#${p.chunkNo}`);
    expect(sorted).toEqual(["Strain#1", "Product#1", "Inventory#1", "Inventory#2", "Inventory#3", "Sale#1", "Sale#2"]);
    // Cross-check against the canonical order rather than restating it.
    const typeIdx = sorted.map((s) => CCRS_UPLOAD_ORDER.indexOf(s.split("#")[0] as never));
    expect([...typeIdx].sort((a, b) => a - b)).toEqual(typeIdx);
  });

  it("an unknown type throws instead of sorting silently", () => {
    expect(() => compareChunkPlacement({ type: "Plant" as never, chunkNo: 1, chunkOf: 1 }, { type: "Sale", chunkNo: 1, chunkOf: 1 })).toThrow(CcrsChunkError);
  });
});
