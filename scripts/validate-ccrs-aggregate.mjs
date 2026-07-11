#!/usr/bin/env node
/**
 * scripts/validate-ccrs-aggregate.mjs
 *
 * Validation harness (NOT part of the app): runs the FULL S1+S2 pipeline —
 * zip reader → UTF-16 parser → CcrsAggregator — against a REAL monthly
 * extract zip to prove bounded memory and correct semantics at true scale
 * (~10.8M sale-detail rows). Used during Task H S2 development against the
 * May 2026 file.
 *
 * Usage: npx tsx scripts/validate-ccrs-aggregate.mjs <outer-zip-path>
 * (Node may need --max-old-space-size for the reference maps; the browser
 * equivalent holds the same compact maps.)
 */
import { open, writeFile } from "node:fs/promises";

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
  mapProduct,
  mapInventory,
  mapStrain,
  mapSaleHeader,
  mapSaleDetail,
} from "../src/lib/discovery/ccrs-extract/parse.ts";
import { CcrsAggregator } from "../src/lib/discovery/ccrs-extract/aggregate.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx scripts/validate-ccrs-aggregate.mjs <outer-zip>");
  process.exit(1);
}

// Tracked roster = the 0080_discovery_competitors.sql seed (self excluded by
// the aggregator itself; listed here to prove the exclusion works).
const SELF = "413541";
const ROSTER = [
  "414550","414103","420661","413358","421877","439182","423372","441109",
  "414503","413374","445189","437875","434372","445745","446441","081400",
  "413541","427457","434402","413427","437434","435420","417880","442174",
  "420785","424311","415229","434030","423829","436145","413258","423634",
  "434494","434843","413870","414449","358302","362816","435728",
];

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

// Dependency order: reference tables before sale tables (random access via
// the central directory makes this free — same plan the browser will use).
const ORDER = ["licensee", "strains", "product", "inventory", "saleheader", "salesdetail"];
function rank(name) {
  const t = tableNameFromZipEntry(name);
  for (let i = 0; i < ORDER.length; i += 1) if (t.startsWith(ORDER[i])) return i;
  return ORDER.length;
}
zips.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

const agg = new CcrsAggregator({ selfLicenseNumber: SELF, trackedLicenseNumbers: ROSTER });

// Pre-size the typed-array join maps from the chunk counts in the central
// directory (each chunked table file carries ≤ 1M rows) to avoid rehash
// doubling spikes — the browser transformer will do the same.
const active = zips.filter((e) => !SKIPPED_TABLES.has(tableNameFromZipEntry(e.name)));
const invChunks = active.filter((e) => tableNameFromZipEntry(e.name) === "inventory").length;
const shChunks = active.filter((e) => tableNameFromZipEntry(e.name) === "saleheader").length;
agg.reserve({ inventoryRows: invChunks * 1_000_000, saleHeaderRows: shChunks * 1_000_000 });
console.log(`reserved: inventory ~${invChunks}M rows, saleHeader ~${shChunks}M rows`);

const t0 = Date.now();
for (const entry of zips) {
  const table = tableNameFromZipEntry(entry.name);
  if (SKIPPED_TABLES.has(table)) continue;
  // Lab results aren't part of the S2 rollups.
  if (table.startsWith("labresult")) continue;

  const innerBytes = await readZipEntryBytes(outer, entry);
  const innerBlob = bytesAsBlob(innerBytes);
  const innerEntries = await readZipEntries(innerBlob);
  for (const csvEntry of innerEntries) {
    if (!csvEntry.name.toLowerCase().endsWith(".csv")) continue;
    const stream = await openZipEntryStream(innerBlob, csvEntry);
    await streamTable(decodeStream(stream), (kind, cells, idx) => {
      if (kind === "licensee") {
        const r = mapLicensee(cells, idx);
        if (r) agg.addLicensee(r);
      } else if (kind === "strain") {
        const r = mapStrain(cells, idx);
        if (r) agg.addStrain(r);
      } else if (kind === "product") {
        const r = mapProduct(cells, idx);
        if (r) agg.addProduct(r);
      } else if (kind === "inventory") {
        const r = mapInventory(cells, idx);
        if (r) agg.addInventory(r);
      } else if (kind === "sale_header") {
        const r = mapSaleHeader(cells, idx);
        if (r) agg.addSaleHeader(r);
      } else if (kind === "sale_detail") {
        const r = mapSaleDetail(cells, idx);
        if (r) agg.addSaleDetail(r);
      }
    });
  }
  const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  console.log(`done ${entry.name} (heap ${mem} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const result = agg.result();
const { totals } = result;

console.log("\n===== AGGREGATION RESULT =====");
console.log(`period: ${result.periodStart} .. ${result.periodEnd}`);
console.log(`totals: ${JSON.stringify(totals)}`);
console.log(
  `retail attribution: ${totals.attributedRetailLines}/${totals.retailLines} (${(
    (100 * totals.attributedRetailLines) / Math.max(1, totals.retailLines)
  ).toFixed(1)}%)`,
);
console.log(`statewide benchmarks: ${result.statewide.length}`);
console.log(`competitors: ${result.competitors.length}`);
console.log(`signals: ${result.signals.length}`);

const overall = result.statewide.find((b) => b.scope === "overall" && b.saleClass === "retail");
console.log(`retail overall: ${JSON.stringify(overall)}`);
const overallWs = result.statewide.find((b) => b.scope === "overall" && b.saleClass === "wholesale");
console.log(`wholesale overall: ${JSON.stringify(overallWs)}`);

console.log("\ncompetitors (revenue desc):");
for (const c of result.competitors) {
  console.log(
    `  ${c.licenseNumber} ${c.dba ?? c.name}: $${(c.retail.revenueMinor / 100).toFixed(2)} rev, ` +
      `${c.retail.lineCount} lines, median $${((c.retail.unitPrice?.medianMinor ?? 0) / 100).toFixed(2)}, ` +
      `wholesale $${(c.wholesale.spendMinor / 100).toFixed(2)} / ${c.wholesale.lineCount} lines / ` +
      `${c.wholesale.topSuppliers.length} suppliers`,
  );
}
if (result.competitors.some((c) => c.licenseNumber === SELF)) {
  console.error("FAIL: self license leaked into competitor stats");
  process.exit(1);
}

// S7: per-competitor top suppliers (who they buy from).
console.log("\ntop suppliers per competitor (S7, spend desc):");
for (const c of result.competitors) {
  if (c.wholesale.topSuppliers.length === 0) continue;
  console.log(`  ${c.licenseNumber} ${c.dba ?? c.name}:`);
  for (const s of c.wholesale.topSuppliers) {
    console.log(
      `    ${s.licenseNumber ?? "?"} ${s.dba ?? s.name ?? `(licenseeId ${s.licenseeId})`}: ` +
        `$${(s.spendMinor / 100).toFixed(2)} / ${s.lineCount} lines`,
    );
  }
}
// Shared suppliers (2+ tracked buyers) — the priority-vendor-lead signal.
{
  const buyersBySupplier = new Map();
  for (const c of result.competitors) {
    for (const s of c.wholesale.topSuppliers) {
      const arr = buyersBySupplier.get(s.licenseeId) ?? [];
      arr.push({ buyer: c.dba ?? c.name ?? c.licenseNumber, supplier: s });
      buyersBySupplier.set(s.licenseeId, arr);
    }
  }
  const shared = [...buyersBySupplier.values()].filter((a) => a.length >= 2);
  console.log(`\nshared suppliers (2+ tracked buyers): ${shared.length}`);
  for (const group of shared.sort((a, b) => b.length - a.length).slice(0, 15)) {
    const s = group[0].supplier;
    console.log(
      `  ${s.dba ?? s.name ?? s.licenseeId}: supplies ${group.length} → ${group.map((g) => g.buyer).join(", ")}`,
    );
  }
}

console.log("\ntop 10 statewide movers:");
for (const s of result.signals.filter((x) => x.kind === "statewide_mover").slice(0, 10)) {
  console.log(
    `  ${s.productName} [${s.inventoryType}] units=${s.units} rev=$${(s.revenueMinor / 100).toFixed(2)} ` +
      `median=$${((s.medianUnitPriceMinor ?? 0) / 100).toFixed(2)} p25=$${((s.p25UnitPriceMinor ?? 0) / 100).toFixed(2)}`,
  );
}

// Rollup JSON size — this is what the browser will POST to the server.
const json = JSON.stringify(result);
console.log(`\nrollup JSON size: ${(json.length / 1024).toFixed(0)} KB`);
await writeFile("/tmp/ccrs_aggregate_result.json", json);
console.log("wrote /tmp/ccrs_aggregate_result.json");
