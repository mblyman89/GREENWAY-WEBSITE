/**
 * src/lib/compliance/ccrs-outbox-core.ts — CCRS Bible v2 slice S-12b (PURE).
 *
 * Everything between "the builders produced files" and "the bytes are stored"
 * that can be decided without I/O:
 *
 *   1. CHUNK + STAMP (Part 05 §B, §C). Every file of an emission is split into
 *      chunks of CCRS_CHUNK_ROWS data rows, ordered by upload group, and each
 *      chunk gets its OWN second: base, base+1 s, base+2 s … where base is
 *      after every stamp already stored in this env. The stamp goes into the
 *      file name (Pacific YYYYMMDDHHMMSS); nothing else in the bytes changes.
 *      Empty files are not emitted: "there is no reporting required if there
 *      are no new data to provide … no 'no change' report, which does not
 *      exist" [FAQ L0049].
 *
 *   2. CONTROL TOTALS (Part 05 §G), derived from the rows of the exact bytes.
 *
 *   3. LEDGER SELF-CHECK (Part 05 §D.4) on the exact bytes before they are
 *      stored: Insert ↔ id absent from the ledger, Update/Delete ↔ present;
 *      every Inventory row's Product / Strain / Area string is one CCRS holds
 *      (from the ledger, or created by an earlier file of the same emission).
 *      "What happens if an Update operation is performed prior to an Insert
 *      operation? The record doesn't exist, so an error message would be
 *      received." [FAQ L0052-L0053].
 *
 *   4. THE EMIT PAYLOAD for public.ccrs_emit_files (0248), with sha256 of the
 *      exact UTF-8 bytes.
 */
import { createHash } from "node:crypto";
import {
  CCRS_COLUMNS,
  ccrsFileName,
  ccrsReaderSplit,
  uploadGroupOf,
  type CcrsRetailerFileType,
} from "./ccrs-batch-core";
import { CCRS_CHUNK_ROWS, allocateStampBase, chunkStampInstant, compareChunkPlacement, splitAssembledFile } from "./ccrs-chunk-core";
import { controlTotalsFromCsv, type CcrsControlTotals } from "./ccrs-control-totals-core";
import { ledgerEntry, type LedgerFileType, type LedgerState, type LedgerView } from "./ccrs-ledger-core";

/* ------------------------------------------------------------------ *
 * 1. Chunk + stamp
 * ------------------------------------------------------------------ */

export type OutboxSourceFile = { type: CcrsRetailerFileType; csv: string };

export type OutboxFile = {
  type: CcrsRetailerFileType;
  group: number;
  chunkNo: number;
  chunkOf: number;
  /** The instant written into fileName (whole second). */
  stampAt: Date;
  fileName: string;
  csv: string;
  recordCount: number;
  totals: CcrsControlTotals;
};

/**
 * Plan the files of one emission. `lastStamp` = the greatest stamp already
 * stored in this env (null if none). Output is in upload order, chunk order,
 * and the stamps are strictly increasing by exactly one second.
 */
export function planOutboxFiles(
  sources: readonly OutboxSourceFile[],
  opts: { licenseNumber: string; now: Date; lastStamp: Date | null; chunkRows?: number },
): OutboxFile[] {
  const size = opts.chunkRows ?? CCRS_CHUNK_ROWS;
  const pieces: { type: CcrsRetailerFileType; chunkNo: number; chunkOf: number; csv: string }[] = [];
  const seen = new Set<CcrsRetailerFileType>();
  for (const s of sources) {
    if (seen.has(s.type)) throw new Error(`outbox: two ${s.type} files in one emission`);
    seen.add(s.type);
    const parts = splitAssembledFile(s.type, s.csv, size);
    const nonEmpty = parts.filter((p) => dataLines(p) > 0);
    nonEmpty.forEach((csv, i) => pieces.push({ type: s.type, chunkNo: i + 1, chunkOf: nonEmpty.length, csv }));
  }
  pieces.sort(compareChunkPlacement);
  const base = allocateStampBase(opts.now, opts.lastStamp);
  return pieces.map((p, i) => {
    const stampAt = chunkStampInstant(base, i + 1);
    const totals = controlTotalsFromCsv(p.type, p.csv);
    return {
      type: p.type,
      group: uploadGroupOf(p.type),
      chunkNo: p.chunkNo,
      chunkOf: p.chunkOf,
      stampAt,
      fileName: ccrsFileName(p.type, opts.licenseNumber, stampAt),
      csv: p.csv,
      recordCount: totals.numberRecords,
      totals,
    };
  });
}

function dataLines(csv: string): number {
  return csv.slice(0, -2).split("\r\n").length - 4;
}

/* ------------------------------------------------------------------ *
 * 3. Ledger self-check on the exact bytes (Part 05 §D.4)
 * ------------------------------------------------------------------ */

export type LedgerProblem = {
  type: CcrsRetailerFileType;
  fileName: string;
  /** 1-based data row number within the file. */
  row: number;
  code: "L_INSERT_ON_FILE" | "L_UPDATE_NOT_ON_FILE" | "L_DELETE_NOT_ON_FILE" | "L_REF_PRODUCT" | "L_REF_STRAIN" | "L_REF_AREA" | "L_REF_INVENTORY" | "L_TOTALS";
  message: string;
};

const PRESENT: ReadonlySet<LedgerState> = new Set(["seed", "filed", "confirmed"]);
/** Update is legal for a closed lot (re-open / cost fix, Part 03 §D.3). */
const UPDATABLE: ReadonlySet<LedgerState> = new Set(["seed", "filed", "confirmed", "closed"]);

const ID_COLUMN: Partial<Record<CcrsRetailerFileType, string>> = {
  Strain: "Strain",
  Area: "ExternalIdentifier",
  Product: "ExternalIdentifier",
  Inventory: "ExternalIdentifier",
};

/**
 * Check every file of an emission against the ledger, in upload order. Names
 * and ids created by an earlier file of the SAME emission count as held (the
 * operator uploads group 1 before group 2 and waits for success [BRIAN A27]).
 * Strain lookups are case-insensitive: CCRS's Inventory→Strain join ignores
 * capital letters (PREprod P20261005B, Part 12 U-45 CLOSED).
 */
export function verifyOutboxAgainstLedger(view: LedgerView, files: readonly OutboxFile[]): LedgerProblem[] {
  const out: LedgerProblem[] = [];
  const newIds = new Set<string>();
  const newProductNames = new Set<string>();
  const newStrainsFold = new Set<string>();
  const newAreaNames = new Set<string>();
  const key = (t: string, id: string) => `${t}\u0000${id}`;

  const filedProductNames = new Set<string>();
  const filedStrainsFold = new Set<string>();
  const filedAreaNames = new Set<string>();
  for (const e of view.entries.values()) {
    if (e.fileType === "Product" && PRESENT.has(e.state) && e.filedName) filedProductNames.add(e.filedName);
    if (e.fileType === "Strain" && PRESENT.has(e.state)) filedStrainsFold.add(e.externalId.toLowerCase());
    if (e.fileType === "Area" && PRESENT.has(e.state) && e.filedName) filedAreaNames.add(e.filedName);
  }

  const ordered = [...files].sort(compareChunkPlacement);
  for (const f of ordered) {
    const C = CCRS_COLUMNS[f.type];
    const rows = f.csv.slice(0, -2).split("\r\n").slice(4).map(ccrsReaderSplit);
    const idCol = ID_COLUMN[f.type];
    const opI = C.indexOf("Operation");
    rows.forEach((r, i) => {
      const row = i + 1;
      const push = (code: LedgerProblem["code"], message: string) => out.push({ type: f.type, fileName: f.fileName, row, code, message });
      if (idCol && opI >= 0) {
        const id = r[C.indexOf(idCol)];
        const op = r[opI];
        const e = ledgerEntry(view, f.type as LedgerFileType, id);
        const createdHere = newIds.has(key(f.type, id));
        if (op === "Insert") {
          if (e && e.state !== "deleted") push("L_INSERT_ON_FILE", `${f.type} ${id} is Insert but CCRS already holds it (state ${e.state}); it must be an Update`);
          else if (createdHere) push("L_INSERT_ON_FILE", `${f.type} ${id} is Inserted twice in this emission`);
          else newIds.add(key(f.type, id));
        } else if (op === "Update") {
          if (!createdHere && !(e && UPDATABLE.has(e.state))) {
            push("L_UPDATE_NOT_ON_FILE", `${f.type} ${id} is Update but CCRS does not hold it${e ? ` (state ${e.state})` : ""}; "The record doesn't exist, so an error message would be received." [FAQ L0053]`);
          }
        } else if (op === "Delete") {
          if (!(e && PRESENT.has(e.state))) push("L_DELETE_NOT_ON_FILE", `${f.type} ${id} is Delete but CCRS does not hold it`);
        }
      }
      if (f.type === "Product") newProductNames.add(r[C.indexOf("Name")]);
      if (f.type === "Strain") newStrainsFold.add(r[C.indexOf("Strain")].toLowerCase());
      if (f.type === "Area") newAreaNames.add(r[C.indexOf("Area")]);
      if (f.type === "Inventory") {
        const product = r[C.indexOf("Product")];
        const strain = r[C.indexOf("Strain")];
        const area = r[C.indexOf("Area")];
        if (!filedProductNames.has(product) && !newProductNames.has(product)) {
          push("L_REF_PRODUCT", `Inventory row names Product "${product}", which CCRS does not hold and this emission does not create ("Invalid Product" [G L0579])`);
        }
        if (strain !== "" && !filedStrainsFold.has(strain.toLowerCase()) && !newStrainsFold.has(strain.toLowerCase())) {
          push("L_REF_STRAIN", `Inventory row names Strain "${strain}", which CCRS does not hold and this emission does not create ("Invalid Strain" [G L0555])`);
        }
        if (!filedAreaNames.has(area) && !newAreaNames.has(area)) {
          push("L_REF_AREA", `Inventory row names Area "${area}", which CCRS does not hold and this emission does not create ("Invalid Area" [G L0570])`);
        }
      }
      if (f.type === "InventoryAdjustment" || f.type === "Sale" || f.type === "InventoryTransfer") {
        const invCol = C.indexOf("InventoryExternalIdentifier");
        if (invCol >= 0) {
          const inv = r[invCol];
          const e = ledgerEntry(view, "Inventory", inv);
          // Part 03 L189: an event row's lot must be in (seed, filed, confirmed),
          // the same set routeReference uses — a `closed` lot is not enough.
          if (!(e && PRESENT.has(e.state)) && !newIds.has(key("Inventory", inv))) {
            push("L_REF_INVENTORY", `${f.type} row names lot ${inv}, which CCRS does not hold and this emission does not Insert`);
          }
        }
      }
    });
  }
  // Totals re-derived from the bytes must equal the totals stored with the file.
  for (const f of ordered) {
    const again = controlTotalsFromCsv(f.type, f.csv);
    if (JSON.stringify(again) !== JSON.stringify(f.totals)) {
      out.push({ type: f.type, fileName: f.fileName, row: 0, code: "L_TOTALS", message: `${f.fileName}: control totals re-derived from the bytes differ from the stored totals` });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 4. Emit payload
 * ------------------------------------------------------------------ */

export function sha256Utf8(s: string): string {
  return createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}

export type EmitIssue = { severity: "info" | "warning" | "error"; code: string; message: string };

export type EmitPayloadFile = {
  file_type: CcrsRetailerFileType;
  purpose: "weekly";
  chunk_no: number;
  chunk_of: number;
  file_name: string;
  stamp_at: string;
  content: string;
  sha256: string;
  number_records: number;
  distinct_ids: number;
  sum_qoh: string | null;
  sum_total_cost: string | null;
  control_totals: CcrsControlTotals;
  issues: EmitIssue[];
};

export function emitPayload(files: readonly OutboxFile[], issuesFor: (f: OutboxFile) => EmitIssue[] = () => []): EmitPayloadFile[] {
  return files.map((f) => ({
    file_type: f.type,
    purpose: "weekly",
    chunk_no: f.chunkNo,
    chunk_of: f.chunkOf,
    file_name: f.fileName,
    stamp_at: f.stampAt.toISOString(),
    content: f.csv,
    sha256: sha256Utf8(f.csv),
    number_records: f.recordCount,
    distinct_ids: f.totals.distinctIds,
    sum_qoh: f.totals.sumQoh,
    sum_total_cost: f.totals.sumTotalCost,
    control_totals: f.totals,
    issues: issuesFor(f),
  }));
}

export type EmitResultFile =
  | { status: "emitted"; id: string; file_name: string; sha256: string; state: string; in_flight: number }
  | { status: "duplicate"; id: string; file_name: string; sha256: string; state: string; emitted_at: string | null };

/** Validate the RPC's answer: one entry per input file, in order, hashes equal. */
export function checkEmitResult(sent: readonly EmitPayloadFile[], got: unknown): EmitResultFile[] {
  const files = (got as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length !== sent.length) {
    throw new Error(`outbox: ccrs_emit_files returned ${Array.isArray(files) ? files.length : "no"} file(s) for ${sent.length} sent`);
  }
  return files.map((x, i) => {
    const r = x as EmitResultFile;
    if ((r.status !== "emitted" && r.status !== "duplicate") || typeof r.id !== "string" || typeof r.file_name !== "string") {
      throw new Error(`outbox: malformed result for ${sent[i].file_name}`);
    }
    if (r.sha256 !== sent[i].sha256) throw new Error(`outbox: result ${i + 1} is for different bytes than ${sent[i].file_name}`);
    if (r.status === "emitted" && r.file_name !== sent[i].file_name) throw new Error(`outbox: emitted under a different name than ${sent[i].file_name}`);
    return r;
  });
}

/**
 * The upload instructions for the README, one line per file in upload order.
 * `names` = the names actually put in the zip (a duplicate keeps its stored
 * name), same order as `files`. Group rule [G L1057-L1058]; pacing by the
 * success email, 10 minutes a guideline [BRIAN A27] (Part 05 §C).
 */
export function outboxReadmeLines(files: readonly OutboxFile[], names: readonly string[]): string[] {
  if (names.length !== files.length) throw new Error("outbox: README names do not match the files");
  const out = ["Upload these files at https://cannabisreporting.lcb.wa.gov/ (SAW login), ONE AT A TIME, in this order:"];
  let group = 0;
  files.forEach((f, i) => {
    if (f.group !== group) {
      group = f.group;
      out.push(`  Group ${group}:`);
    }
    const chunk = f.chunkOf > 1 ? ` (part ${f.chunkNo} of ${f.chunkOf})` : "";
    out.push(`    ${i + 1}. ${names[i]} — ${f.recordCount} record(s)${chunk}`);
  });
  out.push(
    "Wait for each file's \"CCRS Processing Successful\" email before uploading the next one (about 10 minutes is",
    "the guideline). Every file of a group must succeed before any file of the next group is uploaded: Inventory",
    "depends on Strain/Area/Product, and Adjustment/Sale depend on Inventory.",
  );
  return out;
}

/* ------------------------------------------------------------------ *
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runCcrsOutboxCoreTests(): void {
  const assert = (c: unknown, m: string) => { if (!c) throw new Error("ccrs-outbox-core: " + m); };
  const hdr = "SubmittedBy,G\r\nSubmittedDate,10/07/2026\r\n";
  const mk = (t: CcrsRetailerFileType, rows: string[]) => `${hdr}NumberRecords,${rows.length}\r\n${CCRS_COLUMNS[t].join(",")}\r\n${rows.map((r) => r + "\r\n").join("")}`;
  const inv = (id: string, op: string, product = "P1", strain = "Blue Dream", area = "Sales Floor") =>
    `413541,${strain},${area},${product},5,2,30.00,FALSE,${id},G,10/01/2026,G,10/07/2026,${op}`;
  const files = planOutboxFiles(
    [
      { type: "Inventory", csv: mk("Inventory", Array.from({ length: 25 }, (_, i) => inv(`L${i}`, "Insert"))) },
      { type: "Strain", csv: mk("Strain", ["413541,Blue Dream,Hybrid,G,10/07/2026"]) },
      { type: "Area", csv: mk("Area", []) },
    ],
    { licenseNumber: "413541", now: new Date("2026-10-07T19:00:00.400Z"), lastStamp: new Date("2026-10-07T19:00:05Z"), chunkRows: 10 },
  );
  assert(files.map((f) => `${f.type}${f.chunkNo}/${f.chunkOf}`).join(",") === "Strain1/1,Inventory1/3,Inventory2/3,Inventory3/3", "order, chunks, empty Area dropped");
  assert(files[0].fileName === "Strain_413541_20261007120006.csv", `first stamp is after the last stored one (${files[0].fileName})`);
  assert(files.every((f, i) => i === 0 || f.stampAt.getTime() - files[i - 1].stampAt.getTime() === 1000), "+1 s per file");
  assert(new Set(files.map((f) => f.fileName)).size === files.length, "distinct names");
  assert(files[3].recordCount === 5 && files[3].totals.numberRecords === 5, "last chunk 5 rows");
  const p = emitPayload(files);
  assert(p[0].sha256 === sha256Utf8(files[0].csv) && p[0].stamp_at === "2026-10-07T19:00:06.000Z", "payload");
  console.log("ccrs-outbox-core: all tests passed");
}
