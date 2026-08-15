#!/usr/bin/env node
/**
 * scripts/discovery/ccrs-sample.mjs
 *
 * ONE-PASS CCRS SAMPLER — run this on ONE monthly delivery zip and it handles
 * every nested layer for you automatically. You never unzip anything by hand.
 *
 *   monthly.zip  ->  Licensee_1.zip  ->  Licensee_1.csv   (UTF-16 tab-delimited)
 *                ->  Inventory_1.zip ->  Inventory_1.csv
 *                ->  Inventory_2.zip ->  Inventory_2.csv
 *                ->  ... (a dozen or so tables, some split into chunks)
 *
 * It walks all of that in a single pass and writes ONE small text file
 * containing, for every table:
 *   - the exact header row (column names, verbatim)
 *   - the first N data rows (default 150)
 *   - a manifest of every file found inside, with sizes
 *
 * WHY: the real monthly zips are 100 MB - 730 MB, which is far too large to
 * hand over for inspection. This produces a few-hundred-KB file instead, small
 * enough to drag and drop anywhere, while preserving the REAL column names and
 * REAL value formats so nothing downstream has to be guessed.
 *
 * WHAT IT DOES NOT DO: it does not modify, move, or delete your zip. It only
 * reads. The original file is untouched.
 *
 * REQUIREMENTS: Node 18 or newer. No `npm install`. No other tools.
 *
 * USAGE:
 *   node scripts/discovery/ccrs-sample.mjs "C:\\path\\to\\CCRS_April_2026.zip"
 *
 * OPTIONS:
 *   --rows=150     how many data rows to sample per table (default 150)
 *   --out=FILE     output path (default: <inputname>.sample.txt next to input)
 *   --all-chunks   sample every chunk (default: first chunk per table only)
 *
 * STANDING RULES honored:
 *   - NEVER GUESS: the zip parsing here is the SAME proven logic the app's
 *     transformer uses (src/lib/discovery/ccrs-extract/zip.ts), including the
 *     zip64 handling required for archives this large, and the SAME UTF-16/BOM
 *     detection the parser uses (parse.ts decodeStream). Nothing re-derived.
 *   - Malformed structures throw with a precise reason rather than being
 *     silently repaired.
 *   - Sampling is EARLY-ABORT: it stops decompressing a table as soon as it has
 *     the rows it needs, so a 730 MB archive still finishes quickly and never
 *     materializes a whole table in memory.
 */

import { open } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// ZIP structures (PKWARE APPNOTE). Little-endian throughout.
// Ported verbatim from src/lib/discovery/ccrs-extract/zip.ts so this script and
// the app agree byte-for-byte about how these archives are read.
// ---------------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOC_SIG = 0x07064b50;

const u16 = (v, off) => v.getUint16(off, true);
const u32 = (v, off) => v.getUint32(off, true);
function u64(v, off) {
  const n = v.getBigUint64(off, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`zip: 64-bit value exceeds JS safe integer at offset ${off}`);
  }
  return Number(n);
}

const utf8 = new TextDecoder("utf-8");

/** Random-access view over an open file — never loads the whole archive. */
function fileBlob(fd, size, base = 0) {
  return {
    size,
    slice(start, end) {
      const s = Math.max(0, Math.min(start, size));
      const e = Math.max(s, Math.min(end, size));
      return fileBlob(fd, e - s, base + s);
    },
    async arrayBuffer() {
      const buf = Buffer.allocUnsafe(size);
      let off = 0;
      while (off < size) {
        const { bytesRead } = await fd.read(buf, off, size - off, base + off);
        if (bytesRead === 0) break;
        off += bytesRead;
      }
      if (off !== size) throw new Error(`zip: short read (${off} of ${size} bytes)`);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

/** Wrap in-memory bytes (used for the nested inner zips). */
function bytesAsBlob(bytes) {
  return {
    size: bytes.byteLength,
    slice(start, end) {
      const s = Math.max(0, Math.min(start, bytes.byteLength));
      const e = Math.max(s, Math.min(end, bytes.byteLength));
      return bytesAsBlob(bytes.subarray(s, e));
    },
    async arrayBuffer() {
      const out = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(out).set(bytes);
      return out;
    },
  };
}

async function readEocd(blob) {
  const tailLen = Math.min(blob.size, 65_557);
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

  let total = u16(v, eocdRel + 10);
  let cdSize = u32(v, eocdRel + 12);
  let cdOffset = u32(v, eocdRel + 16);

  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
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

async function readZipEntries(blob) {
  const { cdOffset, cdSize, total } = await readEocd(blob);
  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);

  const entries = [];
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

async function openZipEntryStream(blob, entry) {
  const headStart = entry.localHeaderOffset;
  const head = new Uint8Array(await blob.slice(headStart, headStart + 30).arrayBuffer());
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (u32(v, 0) !== LOC_SIG) throw new Error(`zip: bad local header signature for "${entry.name}"`);
  const nameLen = u16(v, 26);
  const extraLen = u16(v, 28);
  const dataStart = headStart + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  const raw = new Uint8Array(await blob.slice(dataStart, dataEnd).arrayBuffer());

  if (entry.method === 0) {
    return new ReadableStream({
      start(controller) {
        const CHUNK = 1 << 20;
        for (let off = 0; off < raw.byteLength; off += CHUNK) {
          controller.enqueue(raw.subarray(off, Math.min(off + CHUNK, raw.byteLength)));
        }
        controller.close();
      },
    });
  }
  if (entry.method === 8) {
    const src = new ReadableStream({
      start(controller) {
        const CHUNK = 4 << 20;
        for (let off = 0; off < raw.byteLength; off += CHUNK) {
          controller.enqueue(raw.subarray(off, Math.min(off + CHUNK, raw.byteLength)));
        }
        controller.close();
      },
    });
    return src.pipeThrough(new DecompressionStream("deflate-raw"));
  }
  throw new Error(`zip: unsupported compression method ${entry.method} for "${entry.name}"`);
}

async function readZipEntryBytes(blob, entry) {
  const stream = await openZipEntryStream(blob, entry);
  const reader = stream.getReader();
  const parts = [];
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

// ---------------------------------------------------------------------------
// Text decoding — mirrors parse.ts decodeStream (BOM first, else NUL-density
// probe). CCRS ships UTF-16LE; getting this wrong yields mojibake, so it is
// detected exactly the way the app detects it rather than assumed.
// ---------------------------------------------------------------------------

/**
 * Read at most `maxLines` lines from a decompressed byte stream, then CANCEL.
 * Early-abort is what keeps this fast on a 730 MB archive.
 */
async function readLines(byteStream, maxLines) {
  const reader = byteStream.getReader();
  let decoder = null;
  let pending = null;
  let buf = "";
  const lines = [];
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let bytes = value;

      if (decoder == null) {
        if (pending) {
          const merged = new Uint8Array(pending.byteLength + bytes.byteLength);
          merged.set(pending, 0);
          merged.set(bytes, pending.byteLength);
          bytes = merged;
          pending = null;
        }
        if (bytes.byteLength < 2) {
          pending = bytes;
          continue;
        }
        const hasBom = bytes[0] === 0xff && bytes[1] === 0xfe;
        if (hasBom) {
          decoder = new TextDecoder("utf-16le");
          bytes = bytes.subarray(2);
        } else {
          const probeLen = Math.min(bytes.byteLength, 512);
          let nulCount = 0;
          for (let i = 0; i < probeLen; i++) if (bytes[i] === 0) nulCount++;
          decoder = new TextDecoder(nulCount > probeLen / 8 ? "utf-16le" : "utf-8");
        }
      }

      buf += decoder.decode(bytes, { stream: true });

      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        lines.push(buf.slice(0, nl).replace(/\r$/, ""));
        buf = buf.slice(nl + 1);
        if (lines.length >= maxLines) {
          truncated = true;
          return { lines, truncated };
        }
      }
    }
    if (buf.length > 0) lines.push(buf.replace(/\r$/, ""));
  } finally {
    // Release the decompressor immediately — do not keep inflating.
    try {
      await reader.cancel();
    } catch {
      /* stream already closed; nothing to release */
    }
  }
  return { lines, truncated };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "Inventory_2.zip" -> "inventory" (same rule the app's parser uses). */
function tableNameFromZipEntry(entryName) {
  const base = entryName.split("/").pop() ?? entryName;
  return base
    .replace(/\.zip$/i, "")
    .replace(/\.csv$/i, "")
    .replace(/_\d+$/, "")
    .toLowerCase();
}

function mb(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseArgs(argv) {
  const opts = { rows: 150, out: null, allChunks: false, input: null };
  for (const a of argv) {
    if (a.startsWith("--rows=")) {
      const n = Number(a.slice(7));
      if (!Number.isFinite(n) || n < 1) throw new Error(`--rows must be a positive number, got "${a.slice(7)}"`);
      opts.rows = Math.floor(n);
    } else if (a.startsWith("--out=")) {
      opts.out = a.slice(6);
    } else if (a === "--all-chunks") {
      opts.allChunks = true;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown option "${a}". Supported: --rows=N --out=FILE --all-chunks`);
    } else if (opts.input == null) {
      opts.input = a;
    } else {
      throw new Error(`Unexpected extra argument "${a}". Pass ONE zip file at a time.`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.input) {
    console.error(
      [
        "",
        "CCRS one-pass sampler",
        "",
        "  Usage:  node scripts/discovery/ccrs-sample.mjs <monthly-ccrs.zip>",
        "",
        "  Example (Windows):",
        '    node scripts/discovery/ccrs-sample.mjs "C:\\Users\\you\\Downloads\\CCRS_April_2026.zip"',
        "",
        "  Example (Mac):",
        '    node scripts/discovery/ccrs-sample.mjs "/Users/you/Downloads/CCRS_April_2026.zip"',
        "",
        "  Options:",
        "    --rows=150     rows to sample per table (default 150)",
        "    --out=FILE     where to write the sample (default: next to the input zip)",
        "    --all-chunks   sample every chunk, not just the first per table",
        "",
        "  It reads only. Your zip is never modified.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 18) {
    throw new Error(`Node 18 or newer is required (found ${process.versions.node}).`);
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This Node build has no DecompressionStream. Please update to Node 18 or newer.");
  }

  const inputPath = path.resolve(opts.input);
  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.join(path.dirname(inputPath), `${path.basename(inputPath).replace(/\.zip$/i, "")}.sample.txt`);

  const fd = await open(inputPath, "r");
  try {
    const stat = await fd.stat();
    const outer = fileBlob(fd, stat.size);

    console.log(`\nReading  ${inputPath}`);
    console.log(`Size     ${mb(stat.size)}`);

    const entries = await readZipEntries(outer);
    console.log(`Found    ${entries.length} entries inside the outer zip\n`);

    const out = [];
    out.push("CCRS MONTHLY EXTRACT — STRUCTURE SAMPLE");
    out.push("=".repeat(78));
    out.push(`Source file      : ${path.basename(inputPath)}`);
    out.push(`Source size      : ${mb(stat.size)}`);
    out.push(`Generated (UTC)  : ${new Date().toISOString()}`);
    out.push(`Rows per table   : ${opts.rows}`);
    out.push(`Chunk policy     : ${opts.allChunks ? "every chunk" : "first chunk per table"}`);
    out.push(`Generator        : scripts/discovery/ccrs-sample.mjs`);
    out.push("");
    out.push("This file contains ONLY the column headers and the first rows of each");
    out.push("table. It is a structure sample, not the dataset.");
    out.push("");

    // ---- Manifest of everything inside the outer zip ----------------------
    out.push("MANIFEST — every file inside the outer zip");
    out.push("-".repeat(78));
    out.push(
      ["name", "compressed", "uncompressed"].join("\t"),
    );
    for (const e of entries) {
      out.push([e.name, mb(e.compressedSize), mb(e.uncompressedSize)].join("\t"));
    }
    out.push("");

    // ---- Walk nested zips -------------------------------------------------
    const innerZips = entries
      .filter((e) => e.name.toLowerCase().endsWith(".zip"))
      .sort((a, b) => a.name.localeCompare(b.name));

    const directCsvs = entries.filter((e) => e.name.toLowerCase().endsWith(".csv"));

    if (innerZips.length === 0 && directCsvs.length === 0) {
      throw new Error(
        "No .zip or .csv entries found inside this archive. Is this the full monthly CCRS delivery zip?",
      );
    }

    const seenTables = new Set();
    const sampled = [];
    const skipped = [];

    /** Sample one CSV byte-stream and append it to the report. */
    async function sampleCsv(label, tableName, byteStream, note) {
      const { lines, truncated } = await readLines(byteStream, opts.rows + 1);
      const header = lines.length > 0 ? lines[0] : "";
      const dataRows = lines.slice(1);
      const cols = header.length > 0 ? header.split("\t") : [];

      out.push("");
      out.push("=".repeat(78));
      out.push(`TABLE: ${tableName}`);
      out.push(`FILE : ${label}`);
      if (note) out.push(`NOTE : ${note}`);
      out.push(`COLUMNS (${cols.length}):`);
      cols.forEach((c, i) => out.push(`  [${i}] ${c}`));
      out.push("");
      out.push(`HEADER ROW (verbatim, tab-delimited):`);
      out.push(header);
      out.push("");
      out.push(
        `FIRST ${dataRows.length} DATA ROW(S)${truncated ? " (stopped early — file continues)" : " (this is the whole file)"}:`,
      );
      for (const r of dataRows) out.push(r);
      sampled.push({ table: tableName, file: label, columns: cols.length, rows: dataRows.length });
      console.log(`  sampled ${tableName.padEnd(20)} ${String(cols.length).padStart(3)} cols  ${String(dataRows.length).padStart(4)} rows`);
    }

    for (const entry of innerZips) {
      const table = tableNameFromZipEntry(entry.name);
      if (!opts.allChunks && seenTables.has(table)) {
        skipped.push(entry.name);
        continue;
      }
      seenTables.add(table);

      let innerBytes;
      try {
        innerBytes = await readZipEntryBytes(outer, entry);
      } catch (err) {
        out.push("");
        out.push(`!! COULD NOT READ ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        console.log(`  FAILED  ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const innerBlob = bytesAsBlob(innerBytes);
      const innerEntries = await readZipEntries(innerBlob);

      for (const csvEntry of innerEntries) {
        if (!csvEntry.name.toLowerCase().endsWith(".csv")) continue;
        const stream = await openZipEntryStream(innerBlob, csvEntry);
        await sampleCsv(
          `${entry.name} -> ${csvEntry.name}`,
          table,
          stream,
          `inner csv uncompressed size ${mb(csvEntry.uncompressedSize)}`,
        );
      }
    }

    // Some deliveries may place CSVs directly in the outer zip.
    for (const csvEntry of directCsvs) {
      const table = tableNameFromZipEntry(csvEntry.name);
      if (!opts.allChunks && seenTables.has(table)) {
        skipped.push(csvEntry.name);
        continue;
      }
      seenTables.add(table);
      const stream = await openZipEntryStream(outer, csvEntry);
      await sampleCsv(csvEntry.name, table, stream, "csv stored directly in the outer zip");
    }

    if (skipped.length > 0) {
      out.push("");
      out.push("=".repeat(78));
      out.push(`SKIPPED ${skipped.length} additional chunk(s) of already-sampled tables:`);
      for (const s of skipped) out.push(`  ${s}`);
      out.push("(re-run with --all-chunks to include them)");
    }

    out.push("");
    out.push("=".repeat(78));
    out.push("SUMMARY");
    out.push(["table", "columns", "rows sampled"].join("\t"));
    for (const s of sampled) out.push([s.table, s.columns, s.rows].join("\t"));
    out.push("");
    out.push("END OF SAMPLE");
    out.push("");

    const text = out.join("\n");
    await writeFile(outPath, text, "utf8");

    console.log("");
    console.log(`Wrote    ${outPath}`);
    console.log(`Output   ${mb(Buffer.byteLength(text, "utf8"))}`);
    console.log(`Tables   ${sampled.length}`);
    console.log("");
    console.log("Send that ONE .sample.txt file. The original zip stays where it is.");
    console.log("");
  } finally {
    await fd.close();
  }
}

main().catch((err) => {
  console.error("");
  console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  console.error("");
  process.exitCode = 1;
});
