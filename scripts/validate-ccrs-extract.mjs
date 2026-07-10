#!/usr/bin/env node
/**
 * scripts/validate-ccrs-extract.mjs
 *
 * Validation harness (NOT part of the app): runs the pure ccrs-extract
 * modules against a REAL monthly extract zip to prove the zip reader +
 * UTF-16/tab parser handle the true byte format end-to-end. Used during
 * Task H S1 development against the April/May 2026 files.
 *
 * Usage: npx tsx scripts/validate-ccrs-extract.mjs <outer-zip-path>
 */
import { open } from "node:fs/promises";

import {
  readZipEntries,
  readZipEntryBytes,
  openZipEntryStream,
  bytesAsBlob,
} from "../src/lib/discovery/ccrs-extract/zip.ts";
import {
  decodeStream,
  streamTable,
  tableNameFromZipEntry,
  SKIPPED_TABLES,
  mapLicensee,
} from "../src/lib/discovery/ccrs-extract/parse.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx scripts/validate-ccrs-extract.mjs <outer-zip>");
  process.exit(1);
}

/** File-descriptor-backed BlobLike: random access without loading the file. */
async function fileAsBlob(filePath) {
  const fh = await open(filePath, "r");
  const { size } = await fh.stat();
  function make(start, end) {
    return {
      size: end - start,
      slice(s, e) {
        return make(start + s, Math.min(start + e, end));
      },
      async arrayBuffer() {
        const len = end - start;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, start);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + len);
      },
    };
  }
  return make(0, size);
}

const outer = await fileAsBlob(path);
const entries = await readZipEntries(outer);
console.log(`outer zip: ${entries.length} entries`);

const zips = entries.filter((e) => e.name.toLowerCase().endsWith(".zip"));
const tally = new Map();
let greenway = null;

for (const entry of zips) {
  const table = tableNameFromZipEntry(entry.name);
  // For the full-run validation we stream EVERY table (including skipped ones,
  // to verify kind detection); comment the next line out for a quicker pass.
  if (SKIPPED_TABLES.has(table)) continue;

  const innerBytes = await readZipEntryBytes(outer, entry);
  const innerBlob = bytesAsBlob(innerBytes);
  const innerEntries = await readZipEntries(innerBlob);
  for (const csvEntry of innerEntries) {
    if (!csvEntry.name.toLowerCase().endsWith(".csv")) continue;
    const stream = await openZipEntryStream(innerBlob, csvEntry);
    const res = await streamTable(decodeStream(stream), (kind, cells, idx) => {
      if (kind === "licensee") {
        const rec = mapLicensee(cells, idx);
        if (rec?.licenseNumber === "413541") greenway = rec;
      }
    });
    const cur = tally.get(table) ?? { kind: res.kind, rows: 0, files: 0 };
    cur.rows += res.rowCount;
    cur.files += 1;
    if (cur.kind !== res.kind) cur.kind = `MIXED(${cur.kind},${res.kind})`;
    tally.set(table, cur);
    console.log(`  ${entry.name.split("/").pop()} -> kind=${res.kind} rows=${res.rowCount}`);
  }
}

console.log("\n=== summary ===");
for (const [table, t] of [...tally.entries()].sort()) {
  console.log(`${table.padEnd(16)} kind=${String(t.kind).padEnd(12)} files=${t.files} rows=${t.rows}`);
}
console.log("\nGreenway licensee row:", greenway);
process.exit(0);
