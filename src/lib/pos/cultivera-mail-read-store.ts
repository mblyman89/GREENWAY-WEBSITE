/**
 * src/lib/pos/cultivera-mail-read-store.ts — R74 S9. I/O for ONE "read the kept documents" press.
 *
 * Owner (round 6): "Make sure when you build the pdf and spreadsheet reader to utilize llama parse
 * ai if it helps us in any way." The S7 harvest keeps every vendor PDF and spreadsheet privately in
 * pos-raw with a cultivera_mail_docs row marked "stored" (read later, never guessed). This press
 * reads up to READ_BATCH_MAX_DOCS of them:
 *
 *   PDF  -> LlamaParse (parsePdfWithFallback, the SAME primary reader as the live intake; unpdf
 *           text layer on an outage / no key), plus the PDF's own text layer for grounding, then the
 *           pure readPdfText (the intake's layout parsers; LlamaParse tables as a last resort).
 *   XLSX -> exceljs cells (exact values; an AI adds nothing to a cell) -> readSpreadsheetCells.
 *
 * R74 S19: READ_CONCURRENCY documents are read at once (newest email first), up to READ_BATCH_MAX_DOCS
 * per press inside the time budget.
 *
 * Every decision is in the PURE cultivera-mail-read-core. This file only moves bytes.
 *
 * WRITES: the row's read fields only (status stored -> parsed | unreadable, note, format, number,
 * vendor, license, date, lines, barcodes). The 0293 guard keeps what was received immutable and
 * allows exactly these moves. The UPDATE is guarded `.eq("status", "stored")`, so two people
 * pressing at once write each document once (the second write finds no stored row and is counted
 * as already read). No migration, no Gmail, nothing else.
 *
 * Fail loud: a storage outage STOPS the batch and leaves the row stored (read again next press);
 * a file that is gone from storage, a corrupt file, an old .xls or an oversized sheet is marked
 * unreadable WITH the reason (so it never blocks the queue and is never silently skipped).
 */
import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { HARVEST_BUCKET, HARVEST_DOCS_TABLE, type ParsedDocSummary } from "@/lib/pos/cultivera-mail-harvest-run-core";
import { HarvestTableMissing, isMissingTable } from "@/lib/pos/cultivera-mail-harvest-store";
import {
  OLD_XLS_NOTE,
  READ_BATCH_MAX_DOCS,
  READ_BATCH_TIME_BUDGET_MS,
  READ_CONCURRENCY,
  readMayStart,
  readWidth,
  SHEET_MAX_BYTES,
  excelCellValue,
  isOldExcel,
  readPdfText,
  readSpreadsheetCells,
  type Cell,
  type PdfEngine,
  type ReadBatchResult,
} from "@/lib/pos/cultivera-mail-read-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type StoredDoc = { id: string; kind: string; filename: string; storage_key: string };

/** What the reader returned for a PDF (LlamaParse first). */
export type PdfReading = { text: string; engine: PdfEngine; note: string | null };

/** The read fields written onto a stored row. */
export type ReadPatch = {
  status: "parsed" | "unreadable";
  note: string | null;
  source_format: string | null;
  manifest_number: string | null;
  vendor_label: string | null;
  vendor_license: string | null;
  transfer_date: string | null;
  line_count: number;
  lines: ParsedDocSummary["lines"];
  barcodes: string[];
};

/** Everything the press touches outside this process (injected so the batch is tested with fakes). */
export type ReadIo = {
  listStored: (limit: number) => Promise<StoredDoc[]>;
  countStored: () => Promise<number>;
  /** The kept file. Throw DocumentGone when storage says it does not exist (permanent). */
  download: (key: string) => Promise<Uint8Array>;
  /** The PDF's own text layer ("" for a scanned image). */
  readLayer: (bytes: Uint8Array) => Promise<string>;
  /** LlamaParse (primary) with the unpdf fallback. */
  readPdf: (bytes: Uint8Array, doc: StoredDoc) => Promise<PdfReading>;
  /** Every sheet of an .xlsx as rows of exceljs values. */
  workbook: (bytes: Uint8Array) => Promise<{ name: string; rows: unknown[][] }[]>;
  /** Guarded write (status still "stored"). True when this press wrote the row. */
  update: (id: string, patch: ReadPatch) => Promise<boolean>;
  now: () => number;
};

/** Storage says the object is not there: the document can never be read; marked unreadable. */
export class DocumentGone extends Error {}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function patchFrom(sum: ParsedDocSummary): ReadPatch {
  const status = sum.status === "parsed" && sum.lines.length > 0 && sum.sourceFormat ? "parsed" : "unreadable";
  const lines = status === "parsed" ? sum.lines : [];
  return {
    status,
    note: (sum.note ?? (status === "unreadable" ? "no barcodes read" : null))?.slice(0, 600) ?? null,
    source_format: status === "parsed" ? sum.sourceFormat : null,
    manifest_number: sum.manifestNumber,
    vendor_label: sum.vendorLabel,
    vendor_license: sum.vendorLicense,
    transfer_date: sum.transferDate,
    line_count: lines.length,
    lines,
    barcodes: [...new Set(lines.map((l) => l[0]))].sort(),
  };
}

function unreadablePatch(note: string): ReadPatch {
  return { status: "unreadable", note: note.slice(0, 600), source_format: null, manifest_number: null, vendor_label: null, vendor_license: null, transfer_date: null, line_count: 0, lines: [], barcodes: [] };
}

/** Read one kept document into its patch. Throws only for a transient storage failure. */
export async function readOneDocument(io: ReadIo, doc: StoredDoc): Promise<{ patch: ReadPatch; engine: PdfEngine | "cells" | null }> {
  let bytes: Uint8Array;
  try {
    bytes = await io.download(doc.storage_key);
  } catch (e) {
    if (e instanceof DocumentGone) return { patch: unreadablePatch(`the kept file is missing from storage (${doc.storage_key}): ${e.message}`), engine: null };
    throw e;
  }
  if (doc.kind === "pdf") {
    let layer = "";
    let layerNote: string | null = null;
    try {
      layer = await io.readLayer(bytes);
    } catch (e) {
      layerNote = `the PDF's text layer could not be read (${msgOf(e).slice(0, 120)})`;
    }
    let reading: PdfReading;
    try {
      reading = await io.readPdf(bytes, doc);
    } catch (e) {
      reading = { text: "", engine: "none", note: msgOf(e).slice(0, 160) };
    }
    const sum = readPdfText({ text: reading.text, engine: reading.engine, layer, engineNote: reading.note });
    const patch = patchFrom(sum);
    if (layerNote) patch.note = `${patch.note ?? ""}; ${layerNote}`.replace(/^; /, "").slice(0, 600);
    return { patch, engine: reading.engine };
  }
  if (doc.kind === "xlsx") {
    if (isOldExcel(bytes)) return { patch: unreadablePatch(OLD_XLS_NOTE), engine: null };
    if (bytes.length > SHEET_MAX_BYTES) return { patch: unreadablePatch(`the spreadsheet is ${bytes.length} bytes; a transfer manifest is far smaller (price list or export?)`), engine: null };
    let sheets: { name: string; rows: unknown[][] }[];
    try {
      sheets = await io.workbook(bytes);
    } catch (e) {
      return { patch: unreadablePatch(`the spreadsheet could not be opened (${msgOf(e).slice(0, 160)})`), engine: null };
    }
    const cells = sheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => r.map((v) => excelCellValue(v)) as Cell[]) }));
    return { patch: patchFrom(readSpreadsheetCells(cells)), engine: "cells" };
  }
  return { patch: unreadablePatch(`a ${doc.kind} document is read at harvest time, not here`), engine: null };
}

/**
 * One press: read up to READ_BATCH_MAX_DOCS stored documents inside the time budget.
 *
 * R74 S19: READ_CONCURRENCY workers read at once (LlamaParse runs up to 5 parse jobs at a time on
 * our plan), each taking the next document from one shared list. A worker starts a document only
 * while readMayStart says "go": time is left and nobody hit a storage outage. A started document is
 * always finished and written (the budget leaves room for LlamaParse's own 90 s wait). A storage
 * outage stops every worker from starting more; the documents already in flight are still written.
 */
export async function runReadBatch(io: ReadIo, opts: { budgetMs?: number; concurrency?: number } = {}): Promise<ReadBatchResult> {
  const started = io.now();
  const budgetMs = opts.budgetMs ?? READ_BATCH_TIME_BUDGET_MS;
  const waiting = await io.countStored();
  const res: ReadBatchResult = { ok: true, waiting, read: 0, parsed: 0, unreadable: 0, failed: 0, llamaparse: 0, unpdf: 0, left: waiting, stoppedBecause: null };
  if (waiting === 0) return res;
  const docs = await io.listStored(READ_BATCH_MAX_DOCS);
  let next = 0;
  let stopped = false;
  let budgetHit = false;
  const worker = async (): Promise<void> => {
    for (;;) {
      const may = readMayStart({ elapsedMs: io.now() - started, budgetMs, stopped, next, total: docs.length });
      if (may === "budget") budgetHit = true;
      if (may !== "go") return;
      const doc = docs[next];
      next += 1;
      let out: Awaited<ReturnType<typeof readOneDocument>>;
      try {
        out = await readOneDocument(io, doc);
      } catch (e) {
        // Storage outage / refusal: stop loudly, leave this and the rest stored.
        res.failed += 1;
        res.ok = false;
        stopped = true;
        res.stoppedBecause ??= `could not open ${doc.filename || doc.storage_key}: ${msgOf(e).slice(0, 160)}`;
        return;
      }
      const wrote = await io.update(doc.id, out.patch);
      if (!wrote) continue; // another press read it first (the guarded update is the claim)
      res.read += 1;
      if (out.patch.status === "parsed") res.parsed += 1;
      else res.unreadable += 1;
      if (out.engine === "llamaparse") res.llamaparse += 1;
      if (out.engine === "unpdf") res.unpdf += 1;
    }
  };
  const width = readWidth(opts.concurrency ?? READ_CONCURRENCY, docs.length);
  await Promise.all(Array.from({ length: width }, () => worker()));
  if (budgetHit && !res.stoppedBecause) res.stoppedBecause = "time budget reached; the rest wait for the next press";
  res.left = await io.countStored();
  return res;
}

/* ------------------------------------------------------------------ *
 *  The real I/O
 * ------------------------------------------------------------------ */

export function supabaseReadIo(
  admin: Admin,
  mailbox: string,
  deps: {
    readPdfLayer: (bytes: Uint8Array) => Promise<{ text: string }>;
    parsePdfWithFallback: (
      bytes: Uint8Array,
      opts: { filename?: string; mimeType?: string },
      ctx: { feature?: string; entityType?: string | null; entityId?: string | null; actorId?: string | null; actorEmail?: string | null },
    ) => Promise<{ ok: boolean; text: string; via: PdfEngine; error: string | null; note: string | null }>;
    loadWorkbook: (bytes: Uint8Array) => Promise<{ name: string; rows: unknown[][] }[]>;
    actor?: { id: string | null; email: string | null };
  },
): ReadIo {
  const mb = mailbox.toLowerCase();
  const table = () => admin.from(HARVEST_DOCS_TABLE);
  return {
    countStored: async () => {
      const { count, error } = await table().select("id", { count: "exact", head: true }).eq("mailbox", mb).eq("status", "stored");
      if (error) {
        if (isMissingTable(error)) throw new HarvestTableMissing();
        throw new Error(`counting kept documents: ${error.message}`);
      }
      return count ?? 0;
    },
    listStored: async (limit) => {
      const { data, error } = await table()
        .select("id, kind, filename, storage_key")
        .eq("mailbox", mb)
        .eq("status", "stored")
        // R74 S19: newest email first (the lots on the shelf now came on the latest manifests, so
        // a part-read mailbox already places them). cultivera_mail_docs_recent_idx serves it.
        .order("email_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .limit(limit);
      if (error) {
        if (isMissingTable(error)) throw new HarvestTableMissing();
        throw new Error(`listing kept documents: ${error.message}`);
      }
      return (data ?? []) as StoredDoc[];
    },
    download: async (key) => {
      const { data, error } = await admin.storage.from(HARVEST_BUCKET).download(key);
      if (error || !data) {
        const m = error?.message ?? "no data";
        const status = (error as { statusCode?: string | number; status?: number } | null)?.statusCode ?? (error as { status?: number } | null)?.status;
        if (String(status) === "404" || /not found|does not exist/i.test(m)) throw new DocumentGone(m);
        throw new Error(`storage: ${m}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    readLayer: async (bytes) => (await deps.readPdfLayer(bytes)).text,
    readPdf: async (bytes, doc) => {
      const o = await deps.parsePdfWithFallback(
        bytes,
        { filename: doc.filename || undefined, mimeType: "application/pdf" },
        { feature: "cultivera-mail-read", entityType: "cultivera_mail_doc", entityId: doc.id, actorId: deps.actor?.id ?? null, actorEmail: deps.actor?.email ?? null },
      );
      if (o.ok) return { text: o.text, engine: o.via === "unpdf" ? "unpdf" : "llamaparse", note: o.via === "unpdf" ? o.note : null };
      return { text: "", engine: "none", note: o.note ?? o.error };
    },
    workbook: deps.loadWorkbook,
    update: async (id, patch) => {
      const { data, error } = await table().update(patch).eq("id", id).eq("status", "stored").select("id");
      if (error) {
        if (isMissingTable(error)) throw new HarvestTableMissing();
        throw new Error(`saving what was read: ${error.message}`);
      }
      return (data ?? []).length > 0;
    },
    now: () => Date.now(),
  };
}

/** exceljs: every worksheet -> rows of raw cell values (1-based columns flattened to 0-based). */
export async function loadXlsxWorkbook(bytes: Uint8Array): Promise<{ name: string; rows: unknown[][] }[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const out: { name: string; rows: unknown[][] }[] = [];
  wb.eachSheet((ws) => {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : [];
      rows[n - 1] = vals.map((v) => (v === undefined ? null : v));
    });
    for (let i = 0; i < rows.length; i += 1) if (!rows[i]) rows[i] = [];
    out.push({ name: ws.name, rows });
  });
  return out;
}
