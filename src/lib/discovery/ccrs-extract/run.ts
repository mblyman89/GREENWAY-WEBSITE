/**
 * src/lib/discovery/ccrs-extract/run.ts
 *
 * The zip → parse → aggregate pipeline as a PURE, DOM-free runner (Task H,
 * S14 — logged suggestion #6). Extracted verbatim from CcrsZipUploader so the
 * exact same crunch can run either on the main thread (legacy path / worker
 * fallback) or inside a Web Worker (`transformer.worker.ts`) where it can no
 * longer freeze the tab and trigger the browser's "page unresponsive" prompt.
 *
 * Contract:
 *  - NO DOM, NO React, NO server-action imports — everything here must be
 *    loadable inside a worker AND under Node for tests.
 *  - Input is any `BlobLike` (a browser File satisfies it natively; tests wrap
 *    in-memory bytes) plus the same identity options the aggregator takes.
 *  - Progress is a plain-callback stream of structured-clonable snapshots so
 *    the worker can relay them over postMessage unchanged.
 *  - Errors are thrown verbatim, never force-fit (NEVER GUESS) — the caller
 *    (uploader or worker shell) decides how to surface them.
 */
import { readZipEntries, readZipEntryBytes, openZipEntryStream, bytesAsBlob, type BlobLike } from "./zip";
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
  mapManifestHeader,
  mapTransportedItem,
} from "./parse";
import { CcrsAggregator, type AggregationResult } from "./aggregate";

/** Structured-clonable progress snapshot (safe to postMessage verbatim). */
export type ExtractProgress = {
  phase: "reading" | "aggregating";
  filesDone: number;
  filesTotal: number;
  rows: number;
  /** Short name of the table zip currently being crunched, if any. */
  currentFile: string | null;
};

export type ExtractRunOptions = {
  selfLicenseNumber: string;
  trackedLicenseNumbers: string[];
  onProgress?: (p: ExtractProgress) => void;
};

export type ExtractRunOutcome = {
  result: AggregationResult;
  /** Total data rows scanned across every table csv. */
  rows: number;
  /** How many inner table zips were processed. */
  filesTotal: number;
};

/**
 * Dependency order for the table passes (reference tables before sales).
 * Task I (I4): manifests come before inventory — the lot→vendor map must
 * exist when inventory rows join their ExternalIdentifier, and manifest
 * headers before transported items (origin lookup).
 */
export const TABLE_ORDER = [
  "licensee",
  "strains",
  "manifestheader",
  "transporteditems",
  "product",
  "inventory",
  "saleheader",
  "salesdetail",
];

function orderRank(name: string): number {
  const t = tableNameFromZipEntry(name);
  for (let i = 0; i < TABLE_ORDER.length; i += 1) {
    if (t === TABLE_ORDER[i] || t.startsWith(TABLE_ORDER[i])) return i;
  }
  return TABLE_ORDER.length;
}

function shortEntryName(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1] || name;
}

/**
 * Run the full monthly-extract crunch over one delivery zip. Identical
 * behavior to the pre-S14 inline uploader pipeline: same filters, same
 * dependency ordering, same reserve hints, same row mappers.
 */
export async function runCcrsExtract(file: BlobLike, opts: ExtractRunOptions): Promise<ExtractRunOutcome> {
  const emit = opts.onProgress ?? (() => {});
  emit({ phase: "reading", filesDone: 0, filesTotal: 0, rows: 0, currentFile: null });

  const entries = await readZipEntries(file);
  const innerZips = entries
    .filter((e) => e.name.toLowerCase().endsWith(".zip"))
    .filter((e) => {
      const t = tableNameFromZipEntry(e.name);
      return !SKIPPED_TABLES.has(t) && !t.startsWith("labresult");
    })
    .sort((a, b) => orderRank(a.name) - orderRank(b.name) || a.name.localeCompare(b.name));
  if (innerZips.length === 0) {
    throw new Error(
      "No CCRS table zips found inside this file. Drop the FULL monthly delivery zip (it contains Licensee/Product/Inventory/SaleHeader/SalesDetail zips).",
    );
  }

  const agg = new CcrsAggregator({
    selfLicenseNumber: opts.selfLicenseNumber,
    trackedLicenseNumbers: opts.trackedLicenseNumbers,
  });
  // Pre-size the big joins from chunk counts (≤1M rows per chunked file).
  const count = (t: string) => innerZips.filter((e) => tableNameFromZipEntry(e.name) === t).length;
  agg.reserve({
    inventoryRows: count("inventory") * 1_000_000,
    saleHeaderRows: count("saleheader") * 1_000_000,
  });

  let rows = 0;
  let done = 0;
  for (const entry of innerZips) {
    emit({
      phase: "aggregating",
      filesDone: done,
      filesTotal: innerZips.length,
      rows,
      currentFile: shortEntryName(entry.name),
    });
    const innerBytes = await readZipEntryBytes(file, entry);
    const innerBlob = bytesAsBlob(innerBytes);
    const innerEntries = await readZipEntries(innerBlob);
    for (const csvEntry of innerEntries) {
      if (!csvEntry.name.toLowerCase().endsWith(".csv")) continue;
      const stream = await openZipEntryStream(innerBlob, csvEntry);
      const res = await streamTable(decodeStream(stream), (kind, cells, idx) => {
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
        } else if (kind === "manifest_header") {
          const r = mapManifestHeader(cells, idx);
          if (r) agg.addManifestHeader(r);
        } else if (kind === "transported_item") {
          agg.addTransportedItem(mapTransportedItem(cells, idx));
        }
      });
      rows += res.rowCount;
    }
    done += 1;
    emit({ phase: "aggregating", filesDone: done, filesTotal: innerZips.length, rows, currentFile: null });
  }

  return { result: agg.result(), rows, filesTotal: innerZips.length };
}
