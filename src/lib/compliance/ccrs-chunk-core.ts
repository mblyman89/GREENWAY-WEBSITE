/**
 * src/lib/compliance/ccrs-chunk-core.ts — S-12b (CCRS Bible v2 Part 05 §B-§C)
 *
 * PURE. Splits one file type's rows into upload-sized chunks, gives every chunk
 * its own file-name stamp, and keeps the upload groups in order.
 *
 * Grounds:
 *  - Ceilings: 1,000,000 rows [BRIAN A7] and 1 GB [BRIAN A22] per file.
 *  - Operational chunk 10,000 rows, chosen by blast radius, not capacity: an
 *    error email marks EVERY row of its file uncertain (LAW 4), so a smaller
 *    file is a smaller copy diff (Part 05 §C). It is a parameter, hard max
 *    1,000,000, asserted.
 *  - Chunks get DISTINCT STAMPS, never a suffix: the name shape
 *    `UploadType_LicenseNumber_YYYYMMDDHHMMSS` [G L0046] has no chunk slot and
 *    a suffix is not needed (U-36 CLOSED 2026-10-07: one-second-apart chunks both accepted and stored, P-11 P20261007A). Chunk k is stamped base + (k-1) seconds, so
 *    a one-chunk file keeps exactly today's name.
 *  - Group order: all Group 1 (Strain, Area, Product) before Group 2
 *    (Inventory) before Group 3 (Adjustment, Transfer, Sale) [G L1057-L1058];
 *    chunks of one type stay in chunk order.
 *  - Size: 10,000 rows × the delivery's mean 214 bytes per Inventory row
 *    (13,428,087 B / 62,744 rows) ≈ 2.1 MB, which also keeps any single stored
 *    file under Vercel's 4.5 MB response-body limit for its own download.
 */
import { CCRS_COLUMNS, CCRS_UPLOAD_ORDER, type CcrsRetailerFileType } from "./ccrs-batch-core";

export const CCRS_CHUNK_ROWS = 10_000;
export const CCRS_FILE_MAX_ROWS = 1_000_000;

export class CcrsChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CcrsChunkError";
  }
}

/** Throws unless `n` is a whole number from 1 to 1,000,000 [BRIAN A7]. */
export function assertChunkRows(n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new CcrsChunkError(`chunk size must be a whole number of rows >= 1 (got ${n})`);
  if (n > CCRS_FILE_MAX_ROWS) {
    throw new CcrsChunkError(`chunk size ${n} exceeds the CCRS limit of ${CCRS_FILE_MAX_ROWS} rows per file [BRIAN A7]`);
  }
  return n;
}

/** Split rows into chunks of at most `size`. No rows → no chunks (nothing to upload). */
export function chunkRows<T>(rows: readonly T[], size: number = CCRS_CHUNK_ROWS): T[][] {
  assertChunkRows(size);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Whole-second instant (the stamp has second resolution). */
export function floorToSecond(d: Date): Date {
  const t = d.getTime();
  if (!Number.isFinite(t)) throw new CcrsChunkError("stamp base is not a valid date");
  return new Date(Math.floor(t / 1000) * 1000);
}

/** Chunk k (1-based) → base + (k-1) s. Strictly increasing by exactly one second. */
export function chunkStampInstant(base: Date, chunkNo: number): Date {
  if (!Number.isInteger(chunkNo) || chunkNo < 1) throw new CcrsChunkError(`chunk number must be >= 1 (got ${chunkNo})`);
  return new Date(floorToSecond(base).getTime() + (chunkNo - 1) * 1000);
}

/**
 * The base second for a new emission: never earlier than one second after the
 * latest stamp already used in this environment, so a regeneration can never
 * reuse a chunk's stamp (Part 05 §B: "all stamps come from one sequence of
 * seconds per env"). `lastUsed` is the greatest emitted_at already stored.
 */
export function allocateStampBase(now: Date, lastUsed: Date | null): Date {
  const n = floorToSecond(now);
  if (!lastUsed) return n;
  const next = floorToSecond(lastUsed).getTime() + 1000;
  return new Date(Math.max(n.getTime(), next));
}

export type ChunkPlacement = { type: CcrsRetailerFileType; chunkNo: number; chunkOf: number };

/** Sort key: upload order of the type, then chunk number. */
export function compareChunkPlacement(a: ChunkPlacement, b: ChunkPlacement): number {
  const ia = CCRS_UPLOAD_ORDER.indexOf(a.type);
  const ib = CCRS_UPLOAD_ORDER.indexOf(b.type);
  if (ia < 0 || ib < 0) throw new CcrsChunkError(`unknown CCRS file type ${ia < 0 ? a.type : b.type}`);
  return ia - ib || a.chunkNo - b.chunkNo;
}

/**
 * The last stamp second a set of chunks uses (base + max(chunk_of) - 1). The
 * store records each file's own instant as emitted_at, so the next allocation
 * starts after the greatest one.
 */
export function lastStampOf(base: Date, chunkOfs: readonly number[]): Date {
  const most = chunkOfs.length ? Math.max(...chunkOfs) : 1;
  return chunkStampInstant(base, most);
}

/**
 * Split ONE assembled CCRS file into chunk files of at most `size` data rows.
 * Each chunk keeps the builder's exact SubmittedBy / SubmittedDate lines and
 * column row; only NumberRecords and the data lines differ. With one chunk the
 * output is byte-identical to the input, so splitting can never alter a file
 * that was already verified. A file with no data rows comes back unchanged as
 * a single (empty) chunk.
 */
export function splitAssembledFile(type: CcrsRetailerFileType, csv: string, size: number = CCRS_CHUNK_ROWS): string[] {
  assertChunkRows(size);
  if (!csv.endsWith("\r\n")) throw new CcrsChunkError(`${type}: an assembled file ends with CRLF`);
  const lines = csv.slice(0, -2).split("\r\n");
  if (lines.length < 4) throw new CcrsChunkError(`${type}: fewer than 4 header lines`);
  if (lines[3] !== CCRS_COLUMNS[type].join(",")) throw new CcrsChunkError(`${type}: column row is not the ${type} template`);
  const data = lines.slice(4);
  if (lines[2] !== `NumberRecords,${data.length}`) {
    throw new CcrsChunkError(`${type}: header says "${lines[2]}" but the file has ${data.length} data line(s)`);
  }
  if (data.length === 0) return [csv];
  return chunkRows(data, size).map((part) =>
    [lines[0], lines[1], `NumberRecords,${part.length}`, lines[3], ...part].join("\r\n") + "\r\n",
  );
}

export function __runCcrsChunkCoreTests(): void {
  const assert = (c: unknown, m: string) => { if (!c) throw new Error("ccrs-chunk-core: " + m); };
  const throws = (f: () => unknown) => { try { f(); return false; } catch (e) { return e instanceof CcrsChunkError; } };
  const rows = Array.from({ length: 40_662 }, (_, i) => i);
  const c = chunkRows(rows);
  assert(c.length === 5 && c.slice(0, 4).every((x) => x.length === 10_000) && c[4].length === 662, "40,662 → 10,000×4 + 662");
  assert(c.flat().every((v, i) => v === i), "order and content preserved");
  assert(chunkRows([]).length === 0, "no rows → no chunks");
  assert(chunkRows(Array(10_000).fill(0)).length === 1 && chunkRows(Array(10_001).fill(0)).length === 2, "boundary");
  assert(throws(() => assertChunkRows(1_000_001)) && !throws(() => assertChunkRows(1_000_000)), "1,000,000 cap");
  assert(throws(() => assertChunkRows(0)) && throws(() => assertChunkRows(2.5)), "bad size");
  const base = new Date("2026-10-07T19:00:00.700Z");
  const s = [1, 2, 3].map((k) => chunkStampInstant(base, k).getTime());
  assert(s[0] === Date.parse("2026-10-07T19:00:00Z") && s[1] - s[0] === 1000 && s[2] - s[1] === 1000, "+1 s per chunk");
  assert(allocateStampBase(base, null).getTime() === s[0], "first base = now");
  assert(allocateStampBase(base, new Date(s[2])).getTime() === s[2] + 1000, "after the last used stamp");
  assert(allocateStampBase(new Date(s[2] + 60_000), new Date(s[2])).getTime() === s[2] + 60_000, "now when later");
  const p: ChunkPlacement[] = [
    { type: "Sale", chunkNo: 1, chunkOf: 1 }, { type: "Inventory", chunkNo: 2, chunkOf: 2 },
    { type: "Strain", chunkNo: 1, chunkOf: 1 }, { type: "Inventory", chunkNo: 1, chunkOf: 2 },
  ];
  const o = [...p].sort(compareChunkPlacement).map((x) => `${x.type}${x.chunkNo}`).join(",");
  assert(o === "Strain1,Inventory1,Inventory2,Sale1", "group order across chunks");
  const hdr = ["SubmittedBy,G", "SubmittedDate,10/07/2026"];
  const cols = CCRS_COLUMNS.Strain.join(",");
  const file = (n: number) => [...hdr, `NumberRecords,${n}`, cols, ...Array.from({ length: n }, (_, i) => `413541,S${i},Hybrid,G,10/07/2026`)].join("\r\n") + "\r\n";
  assert(splitAssembledFile("Strain", file(3), 10)[0] === file(3) && splitAssembledFile("Strain", file(3), 10).length === 1, "one chunk = identical bytes");
  const parts = splitAssembledFile("Strain", file(25), 10);
  assert(parts.length === 3 && parts[2].includes("NumberRecords,5\r\n") && parts.every((x) => x.startsWith(hdr.join("\r\n"))), "25 rows / 10 -> 10,10,5 with the same header");
  assert(parts.map((x) => x.split("\r\n").slice(4, -1).join("|")).join("|") === file(25).split("\r\n").slice(4, -1).join("|"), "rows preserved in order");
  assert(splitAssembledFile("Strain", file(0))[0] === file(0), "empty stays one empty file");
  assert(throws(() => splitAssembledFile("Strain", file(3).replace("NumberRecords,3", "NumberRecords,4"))), "count mismatch refused");
  assert(throws(() => splitAssembledFile("Area", file(3))), "wrong template refused");
  console.log("ccrs-chunk-core: all tests passed");
}
