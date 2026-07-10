/**
 * src/lib/discovery/ccrs-extract/zip.ts
 *
 * PURE, dependency-free ZIP reading over a random-access BlobLike, built for
 * the WSLCB CCRS monthly public-records extract: ONE outer zip (~1 GB)
 * containing nested per-table zips, each holding one UTF-16 tab-delimited CSV.
 *
 * Why hand-rolled: the transformer runs IN THE BROWSER on the owner's dragged
 * file (Vercel's ~4.5 MB body limit forbids uploading the raw zip), so we need
 * random access via the central directory to process tables in a CONTROLLED
 * ORDER (Licensee → Product → Inventory → SaleHeader → SalesDetail → …)
 * regardless of how the archive was written. Sequential push-parsers can't
 * guarantee that. No new npm deps; inflate is the platform's
 * DecompressionStream("deflate-raw") (Chrome/Edge/Firefox/Safari ≥ 2023, Node ≥ 18).
 *
 * VERIFIED against the real April + May 2026 extracts (see
 * docs/ROADMAP_BACKOFFICE_FIXES.md Task H): outer entries are the nested
 * `<Table>_<n>.zip` files; big tables split into ≤1,000,000-row chunks.
 *
 * STANDING RULES honored:
 *   - NEVER GUESS: strict signature checks; malformed structures throw with a
 *     precise reason instead of best-effort misreads.
 *   - Pure: no server-only, no DOM types beyond Blob/streams (lib.dom in tsconfig).
 */

// ---------------------------------------------------------------------------
// BlobLike — the minimal random-access surface we need. A browser File/Blob
// satisfies it natively; the Node validation harness wraps a file descriptor.
// ---------------------------------------------------------------------------

export interface BlobLike {
  readonly size: number;
  /** Returns a sub-range [start, end) as its own BlobLike. */
  slice(start: number, end: number): BlobLike;
  /** Materializes this (sub-)blob's bytes. */
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Wrap a plain Uint8Array as a BlobLike (used for nested inner zips). */
export function bytesAsBlob(bytes: Uint8Array): BlobLike {
  return {
    size: bytes.byteLength,
    slice(start: number, end: number): BlobLike {
      return bytesAsBlob(bytes.subarray(start, end));
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      // Copy into a fresh ArrayBuffer so callers can't mutate our backing store
      // and so byteOffset!==0 subarrays serialize correctly.
      const out = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(out).set(bytes);
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// ZIP structures (PKWARE APPNOTE). Little-endian throughout.
// ---------------------------------------------------------------------------

const EOCD_SIG = 0x06054b50; // End of central directory
const CEN_SIG = 0x02014b50; // Central directory file header
const LOC_SIG = 0x04034b50; // Local file header
const ZIP64_EOCD_SIG = 0x06064b50; // Zip64 end of central directory
const ZIP64_LOC_SIG = 0x07064b50; // Zip64 EOCD locator

/** One entry from the central directory. Sizes here are authoritative. */
export type ZipEntry = {
  name: string;
  /** 0 = stored, 8 = deflate. Anything else is rejected at read time. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the entry's LOCAL header from the start of the archive. */
  localHeaderOffset: number;
};

function u16(v: DataView, off: number): number {
  return v.getUint16(off, true);
}
function u32(v: DataView, off: number): number {
  return v.getUint32(off, true);
}
function u64(v: DataView, off: number): number {
  const n = v.getBigUint64(off, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`zip: 64-bit value exceeds JS safe integer at offset ${off}`);
  }
  return Number(n);
}

const utf8 = new TextDecoder("utf-8");

/**
 * Locate + parse the End Of Central Directory record. Scans the final
 * 64 KiB + 22 bytes (max comment) for the signature, then follows the Zip64
 * locator when the 32-bit fields are saturated (0xFFFFFFFF / 0xFFFF).
 */
async function readEocd(blob: BlobLike): Promise<{ cdOffset: number; cdSize: number; total: number }> {
  const tailLen = Math.min(blob.size, 65_557); // 22 + 65535 max comment
  const tailStart = blob.size - tailLen;
  const tail = new Uint8Array(await blob.slice(tailStart, blob.size).arrayBuffer());
  const v = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let eocdRel = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (u32(v, i) === EOCD_SIG) {
      eocdRel = i;
      break;
    }
  }
  if (eocdRel < 0) throw new Error("zip: end-of-central-directory signature not found (not a zip file?)");

  let total = u16(v, eocdRel + 10); // total entries
  let cdSize = u32(v, eocdRel + 12);
  let cdOffset = u32(v, eocdRel + 16);

  const needsZip64 = total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  if (needsZip64) {
    // Zip64 EOCD locator sits immediately before the EOCD.
    const locRel = eocdRel - 20;
    if (locRel < 0 || u32(v, locRel) !== ZIP64_LOC_SIG) {
      throw new Error("zip: zip64 fields saturated but zip64 locator missing");
    }
    const z64Offset = u64(v, locRel + 8);
    const z64 = new Uint8Array(await blob.slice(z64Offset, z64Offset + 56).arrayBuffer());
    const zv = new DataView(z64.buffer, z64.byteOffset, z64.byteLength);
    if (u32(zv, 0) !== ZIP64_EOCD_SIG) throw new Error("zip: bad zip64 EOCD signature");
    total = u64(zv, 32);
    cdSize = u64(zv, 40);
    cdOffset = u64(zv, 48);
  }
  return { cdOffset, cdSize, total };
}

/**
 * Read the full central directory. Returns entries in ARCHIVE order; callers
 * choose their own processing order (that's the point of random access).
 */
export async function readZipEntries(blob: BlobLike): Promise<ZipEntry[]> {
  const { cdOffset, cdSize, total } = await readEocd(blob);
  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);

  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < total; i++) {
    if (p + 46 > cd.byteLength || u32(v, p) !== CEN_SIG) {
      throw new Error(`zip: bad central-directory header for entry ${i} at ${p}`);
    }
    const method = u16(v, p + 10);
    let compressedSize = u32(v, p + 20);
    let uncompressedSize = u32(v, p + 24);
    const nameLen = u16(v, p + 28);
    const extraLen = u16(v, p + 30);
    const commentLen = u16(v, p + 32);
    let localHeaderOffset = u32(v, p + 42);
    const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));

    // Zip64 extra field (id 0x0001) overrides saturated 32-bit values, in the
    // fixed order: uncompressed, compressed, local-header offset.
    if (
      uncompressedSize === 0xffffffff ||
      compressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      let found = false;
      while (e + 4 <= extraEnd) {
        const id = u16(v, e);
        const len = u16(v, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = u64(v, q);
            q += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = u64(v, q);
            q += 8;
          }
          if (localHeaderOffset === 0xffffffff) {
            localHeaderOffset = u64(v, q);
            q += 8;
          }
          found = true;
          break;
        }
        e += 4 + len;
      }
      if (!found) throw new Error(`zip: entry "${name}" has saturated sizes but no zip64 extra field`);
    }

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Open one entry's DECOMPRESSED bytes as a ReadableStream<Uint8Array>.
 * Reads the local header to find the data start (local extra field length can
 * differ from the central one), then streams `compressedSize` bytes through
 * DecompressionStream for deflate, or passes stored bytes through in chunks.
 *
 * Memory: the compressed payload is materialized (bounded — the largest inner
 * table zip observed is ~60 MB), but the DECOMPRESSED output is streamed and
 * never held whole.
 */
export async function openZipEntryStream(blob: BlobLike, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const headStart = entry.localHeaderOffset;
  const head = new Uint8Array(await blob.slice(headStart, headStart + 30).arrayBuffer());
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (u32(v, 0) !== LOC_SIG) {
    throw new Error(`zip: bad local header signature for "${entry.name}"`);
  }
  const nameLen = u16(v, 26);
  const extraLen = u16(v, 28);
  const dataStart = headStart + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  const raw = new Uint8Array(await blob.slice(dataStart, dataEnd).arrayBuffer());

  if (entry.method === 0) {
    // Stored: emit in modest chunks so downstream consumers stay incremental.
    return new ReadableStream<Uint8Array>({
      start(controller) {
        const CHUNK = 1 << 20; // 1 MiB
        for (let off = 0; off < raw.byteLength; off += CHUNK) {
          controller.enqueue(raw.subarray(off, Math.min(off + CHUNK, raw.byteLength)));
        }
        controller.close();
      },
    });
  }
  if (entry.method === 8) {
    const src = new ReadableStream<Uint8Array>({
      start(controller) {
        const CHUNK = 4 << 20; // 4 MiB compressed chunks into the inflater
        for (let off = 0; off < raw.byteLength; off += CHUNK) {
          controller.enqueue(raw.subarray(off, Math.min(off + CHUNK, raw.byteLength)));
        }
        controller.close();
      },
    });
    // lib.dom types DecompressionStream's writable side as BufferSource which
    // pipeThrough's generic rejects; the runtime accepts Uint8Array chunks.
    const inflater = new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >;
    return src.pipeThrough(inflater);
  }
  throw new Error(`zip: unsupported compression method ${entry.method} for "${entry.name}" (only stored/deflate)`);
}

/** Fully materialize one entry's decompressed bytes (for small/nested zips). */
export async function readZipEntryBytes(blob: BlobLike, entry: ZipEntry): Promise<Uint8Array> {
  const stream = await openZipEntryStream(blob, entry);
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let totalLen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    totalLen += value.byteLength;
  }
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.byteLength;
  }
  return out;
}
