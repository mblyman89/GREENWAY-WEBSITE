/**
 * src/lib/compliance/ccrs-outcome-core.ts — CCRS Bible v2 slice S-12c. PURE.
 *
 * Turns what CCRS sent back (a success email, or an error CSV) into ONE
 * outcome for ONE uploaded file, which public.ccrs_record_outcome (0249)
 * then applies to the ledger. No I/O, no clock.
 *
 * What the evidence says, and how each fact is used here:
 *
 *  1. Success emails name the file with a portal token appended
 *     (`Strain_413541_20250615213000_2026917T1252497.csv`, 2026-09-17 run;
 *     same shape 2026-10-06). The stamp WE chose is the correlation key and the
 *     token is not trackable [BRIAN A25] -> `successEmailFileNames` strips it.
 *
 *  2. The error CSV is named `<Type>__<timestamp>.csv`, never by our file
 *     name, so the operator picks the file; we then PROVE the CSV belongs to
 *     it: every echo line must match exactly one of the file's rows.
 *
 *  3. The echo is not reliable CSV. CCRS splits on every comma and ignores
 *     quotes (P20261005A, U-27 false), re-formats values (False -> F, 0.00 ->
 *     .00), moves columns and adds InventoryIdentifier (Part 15 trap 2). So a
 *     line is matched by IDENTITY: split on every comma, exactly as CCRS's
 *     reader does, and look for the row's external id as a whole cell. One
 *     row, and only one row, must be found; anything else is "unmatched".
 *
 *  4. Messages are matched against the 12 verbatim strings CCRS has actually
 *     returned (docs/ccrs-bible/04 section H). An unknown message is never
 *     guessed at: the whole file becomes error-unmatched (LAW 4, every row
 *     uncertain, reconcile by copy).
 *
 *  5. U-17 CLOSED FALSE (P20261006A): rows NOT listed in the echo were filed.
 *     `Operation is invalid must be Insert, Update or Delete` was observed as a
 *     ROW-level message there (3 of 8 rows listed, the other 5 filed), so it is
 *     row-level here, even though Part 05 D.2 predicted "Invalid Operation-type"
 *     messages would be file-fatal (U-37). Observation beats prediction.
 *
 *  6. File-fatal: `CheckSum and number of records don't match` (T-54, stamped
 *     on both rows of a header fault). Part 05 D.2: mixed fatal + row-level
 *     sets are file-fatal.
 *
 *  7. Benign: `Duplicate Strain. ...` — the strain exists either way, so the
 *     row counts as landed [G L0325].
 *
 *  8. Two row messages CONTRADICT our ledger and so make the entity uncertain
 *     (withheld by routing until a copy settles it): `Duplicate External
 *     Identifier` (we Inserted what CCRS already holds) and `ExternalIdentifier
 *     not found` (we Updated what CCRS does not hold).
 */

import { CCRS_COLUMNS, ccrsReaderSplit, type CcrsRetailerFileType } from "./ccrs-batch-core";

export type CcrsMessageClass = "file-fatal" | "row" | "row-contradicts-ledger" | "benign";

/** Every ErrorMessage CCRS has returned to us, verbatim (04 section H). */
export const CCRS_KNOWN_MESSAGES: readonly { text: string; cls: CcrsMessageClass; source: string }[] = [
  { text: "Duplicate Strain. The Strain must be unique for the LicenseNumber", cls: "benign", source: "2026-09-17 T-11/T-12" },
  { text: "Strain name is invalid cannot be Unknown THC or Other", cls: "row", source: "2026-09-17 T-14" },
  { text: "Duplicate External Identifier", cls: "row-contradicts-ledger", source: "2026-09-17 T-16/T-17/T-33" },
  { text: "If Useable Cannabis is selected Unit Weight Gram cannot be Zero", cls: "row", source: "2026-09-17 T-18" },
  { text: "Total Cost cannot equal zero", cls: "row", source: "2026-09-17 T-31" },
  { text: "QuantityOnHand is greater than InitialQuantity", cls: "row", source: "2026-09-17 T-32" },
  { text: "ExternalIdentifier not found", cls: "row-contradicts-ledger", source: "2026-09-17 T-35" },
  { text: "Invalid Product", cls: "row", source: "2026-09-17 T-37" },
  { text: "CheckSum and number of records don't match", cls: "file-fatal", source: "2026-09-17 T-54" },
  { text: "Inventory Adjustment Details missing", cls: "row", source: "2026-09-17 T-48" },
  { text: "Only Medical Sales Excise tax can be 0", cls: "row", source: "2026-09-17 T-42" },
  { text: "Operation is invalid must be Insert, Update or Delete", cls: "row", source: "2026-10-06 P20261005A (3 of 8 rows; the rest filed)" },
];

/** The column that carries a row's identity, per file type (same as 0248's v_idcol). */
export function rowIdColumn(type: CcrsRetailerFileType): string {
  return type === "Strain" ? "Strain" : type === "Sale" ? "SaleDetailExternalIdentifier" : "ExternalIdentifier";
}

export type OurRow = { rowNo: number; externalId: string; operation: string | null };

export type EchoLine = {
  /** 1-based data line number in the echo. */
  line: number;
  text: string;
  message: string | null;
  cls: CcrsMessageClass | "unknown";
  /** matched row of OUR file, or null. */
  rowNo: number | null;
  problem: string | null;
};

export type CcrsOutcomeKind = "success" | "error-benign" | "error-rows" | "error-fatal" | "error-unmatched" | "no-email";
export type RejectedRow = { row_no: number; message: string; uncertain: boolean };

export type EchoVerdict = {
  outcome: Exclude<CcrsOutcomeKind, "success" | "no-email">;
  /** The distinct messages, in first-seen order (stored on the file). */
  messages: string[];
  /** Only for error-rows. */
  rejected: RejectedRow[];
  lines: EchoLine[];
  /** Plain-language reason for the verdict, shown to the operator. */
  why: string;
};

export class CcrsEchoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CcrsEchoError";
  }
}

function splitLines(text: string): string[] {
  const t = text.replace(/^\uFEFF/, "");
  return t.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
}

/** The known message a line carries, longest match first (none -> null). */
function knownMessageIn(line: string): (typeof CCRS_KNOWN_MESSAGES)[number] | null {
  let best: (typeof CCRS_KNOWN_MESSAGES)[number] | null = null;
  for (const m of CCRS_KNOWN_MESSAGES) {
    if (line.includes(m.text) && (!best || m.text.length > best.text.length)) best = m;
  }
  return best;
}

/**
 * Classify a pasted CCRS error CSV against the rows of the ONE file the
 * operator says it answers. Throws CcrsEchoError when the paste cannot be
 * that file's echo at all (no header with ErrorMessage, more lines than the
 * file has rows, or not a single line matching any of its rows).
 */
export function classifyEcho(type: CcrsRetailerFileType, rows: readonly OurRow[], pasted: string): EchoVerdict {
  const lines = splitLines(pasted);
  if (lines.length === 0) throw new CcrsEchoError("The pasted text is empty.");
  const header = ccrsReaderSplit(lines[0]).map((h) => h.trim());
  if (!header.includes("ErrorMessage")) {
    throw new CcrsEchoError("The first line is not a CCRS error-file header (it has no ErrorMessage column). Paste the whole CSV, header first.");
  }
  const idCol = rowIdColumn(type);
  if (!header.includes(idCol) && !(type === "Inventory" && header.includes("InventoryIdentifier"))) {
    throw new CcrsEchoError(`This is not a ${type} error file: its header has no ${idCol} column.`);
  }
  const data = lines.slice(1);
  if (data.length > rows.length) {
    throw new CcrsEchoError(`The error file lists ${data.length} row(s) but this file has only ${rows.length}; it answers a different file.`);
  }
  const byId = new Map<string, OurRow[]>();
  for (const r of rows) {
    if (!byId.has(r.externalId)) byId.set(r.externalId, []);
    byId.get(r.externalId)!.push(r);
  }

  const out: EchoLine[] = [];
  const seenRow = new Set<number>();
  for (const [i, text] of data.entries()) {
    const km = knownMessageIn(text);
    const cells = new Set(ccrsReaderSplit(text));
    const hits: OurRow[] = [];
    for (const c of cells) for (const r of byId.get(c) ?? []) hits.push(r);
    let rowNo: number | null = null;
    let problem: string | null = null;
    if (hits.length === 1) {
      rowNo = hits[0].rowNo;
      if (seenRow.has(rowNo)) {
        problem = `row ${rowNo} is listed twice`;
        rowNo = null;
      } else seenRow.add(rowNo);
    } else if (hits.length === 0) {
      problem = "no row of this file has an id in this line";
    } else {
      problem = `${hits.length} rows of this file have an id in this line (${hits.map((h) => h.rowNo).join(", ")})`;
    }
    let message: string | null = km ? km.text : null;
    if (!km) {
      const at = header.indexOf("ErrorMessage");
      const parts = ccrsReaderSplit(text);
      message = parts.length === header.length ? (parts[at] ?? "").trim() || null : null;
    }
    out.push({ line: i + 1, text, message, cls: km ? km.cls : "unknown", rowNo, problem });
  }

  if (out.every((l) => l.rowNo === null)) {
    throw new CcrsEchoError("Not one line of this error file matches a row of the selected file. Pick the file it answers.");
  }
  const messages = [...new Set(out.map((l) => l.message ?? "(message not readable)"))];

  if (out.some((l) => l.cls === "file-fatal")) {
    return { outcome: "error-fatal", messages, rejected: [], lines: out, why: "CCRS rejected the whole file (a file-level fault such as CheckSum). No row was filed." };
  }
  const unknown = out.filter((l) => l.cls === "unknown");
  const unmatched = out.filter((l) => l.rowNo === null);
  if (unknown.length > 0 || unmatched.length > 0) {
    const bits = [
      unknown.length ? `${unknown.length} line(s) carry a message CCRS has never sent us before` : "",
      unmatched.length ? `${unmatched.length} line(s) cannot be tied to exactly one row (${unmatched[0].problem})` : "",
    ].filter(Boolean);
    return {
      outcome: "error-unmatched",
      messages,
      rejected: [],
      lines: out,
      why: `${bits.join("; ")}. Nobody can say which rows landed, so every row is uncertain until a Service Desk copy is compared (LAW 4).`,
    };
  }
  const rejected: RejectedRow[] = out
    .filter((l) => l.cls === "row" || l.cls === "row-contradicts-ledger")
    .map((l) => ({ row_no: l.rowNo!, message: l.message!, uncertain: l.cls === "row-contradicts-ledger" }));
  if (rejected.length === 0) {
    return { outcome: "error-benign", messages, rejected: [], lines: out, why: "Every message is harmless (Duplicate Strain: the strain is on file either way). Every row counts as filed." };
  }
  const unc = rejected.filter((r) => r.uncertain).length;
  return {
    outcome: "error-rows",
    messages,
    rejected: rejected.sort((a, b) => a.row_no - b.row_no),
    lines: out,
    why:
      `${rejected.length} of ${rows.length} row(s) were refused; the other ${rows.length - rejected.length} were filed (U-17: CCRS accepts row by row).` +
      (unc ? ` ${unc} refusal(s) contradict what we believed CCRS holds, so those ids are uncertain and held back until a copy settles them.` : ""),
  };
}

/**
 * File names in a pasted success email (or several), with CCRS's receipt
 * token removed: `Strain_413541_20250615213000_2026917T1252497.csv` ->
 * `Strain_413541_20250615213000.csv`. Only names of the CCRS shape count.
 */
export function successEmailFileNames(pasted: string): string[] {
  const re = /\b((?:Strain|Area|Product|Inventory|InventoryAdjustment|InventoryTransfer|Sale)_\d+_\d{14})(?:_[0-9A-Za-z]+)?\.csv\b/g;
  const out: string[] = [];
  for (const m of pasted.matchAll(re)) {
    const n = `${m[1]}.csv`;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Part 05 E: the "no email" alarm is 60 minutes after the upload. */
export const CCRS_EMAIL_SLA_MINUTES = 60;
export function noEmailAllowedAt(uploadedAt: Date): Date {
  return new Date(uploadedAt.getTime() + CCRS_EMAIL_SLA_MINUTES * 60_000);
}

/** What the hub lets the operator do with a file in each state (mirrors 0249). */
export type FileAction = "download" | "mark-uploaded" | "abandon" | "record-success" | "record-error" | "record-no-email";
export function fileActions(state: string, uploadedAt: Date | null, now: Date): FileAction[] {
  switch (state) {
    case "emitted":
      return ["download", "mark-uploaded", "abandon"];
    case "uploaded": {
      const a: FileAction[] = ["download", "record-success", "record-error"];
      if (uploadedAt && now.getTime() >= noEmailAllowedAt(uploadedAt).getTime()) a.push("record-no-email");
      return a;
    }
    default:
      return ["download"];
  }
}

/** The column list of a type's echo must be a superset of what we sent, minus nothing we key on. */
export function echoHeaderLooksRight(type: CcrsRetailerFileType, header: readonly string[]): boolean {
  const need = CCRS_COLUMNS[type].filter((c) => c === rowIdColumn(type) || c === "LicenseNumber" || c === "FromLicenseNumber");
  return header.includes("ErrorMessage") && need.every((c) => header.includes(c));
}

export function __runCcrsOutcomeCoreTests(): void {
  const assert = (c: unknown, m: string) => {
    if (!c) throw new Error("ccrs-outcome-core: " + m);
  };
  const throwsEcho = (f: () => unknown) => {
    try {
      f();
      return false;
    } catch (e) {
      return e instanceof CcrsEchoError;
    }
  };
  // The P20261005A Product echo, verbatim header + the 3 rows.
  const hdr = "LicenseNumber,InventoryCategory,InventoryType,Name,Description,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation,ErrorMessage,UnitWeightGrams";
  const echo = [
    hdr,
    `413541,EndProduct,Usable Cannabis,"""P20261005A Mama J's Fidelity - 3.5g""","P-04 fidelity case C1: leading + trailing double quote,1,P20261005A-P01,,10/05/2026,,,Insert,Operation is invalid must be Insert, Update or Delete,`,
    `413541,EndProduct,Usable Cannabis,"P20261005A Smith, Jane Fidelity - 1g",1,P20261005A-P07,,10/05/2026,,,Insert,Operation is invalid must be Insert, Update or Delete,`,
  ].join("\r\n");
  const rows: OurRow[] = Array.from({ length: 8 }, (_, i) => ({ rowNo: i + 1, externalId: `P20261005A-P0${i + 1}`, operation: "Insert" }));
  const v = classifyEcho("Product", rows, echo);
  assert(v.outcome === "error-rows", "comma rows are row-level");
  assert(v.rejected.map((r) => r.row_no).join() === "1,7", "rows 1 and 7 rejected");
  assert(v.rejected.every((r) => !r.uncertain), "not a ledger contradiction");
  assert(v.messages.length === 1, "one distinct message");
  // file-fatal wins
  const fatal = classifyEcho("Inventory", [{ rowNo: 1, externalId: "GWINV54A", operation: "Insert" }, { rowNo: 2, externalId: "GWINV54B", operation: "Insert" }],
    "CreatedBy,CreatedDate,ErrorMessage,LicenseNumber,ExternalIdentifier,Operation\nG,06/15/2025,CheckSum and number of records don't match,413541,GWINV54A,Insert");
  assert(fatal.outcome === "error-fatal", "CheckSum is file-fatal");
  // benign
  const ben = classifyEcho("Strain", [{ rowNo: 1, externalId: "Blue Dream", operation: null }, { rowNo: 2, externalId: "OG", operation: null }],
    "LicenseNumber,Strain,CreatedBy,CreatedDate,StrainType,ErrorMessage\n413541,Blue Dream,G,06/15/2025,Hybrid,Duplicate Strain. The Strain must be unique for the LicenseNumber");
  assert(ben.outcome === "error-benign", "Duplicate Strain is benign");
  // contradiction
  const dup = classifyEcho("Area", [{ rowNo: 1, externalId: "AREA-1", operation: "Insert" }],
    "LicenseNumber,Area,IsQuarantine,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation,ErrorMessage\n413541,Sales Floor,F,AREA-1,G,06/15/2025,,,Insert,Duplicate External Identifier");
  assert(dup.outcome === "error-rows" && dup.rejected[0].uncertain, "Duplicate External Identifier contradicts the ledger");
  // unknown message -> unmatched
  const unk = classifyEcho("Area", [{ rowNo: 1, externalId: "AREA-1", operation: "Insert" }],
    "LicenseNumber,Area,ExternalIdentifier,ErrorMessage\n413541,Sales Floor,AREA-1,Something brand new");
  assert(unk.outcome === "error-unmatched" && unk.messages[0] === "Something brand new", "unknown message is never guessed");
  // a line carrying two known texts takes the LONGEST (the name says "Invalid Product", CCRS says Duplicate External Identifier)
  const two = classifyEcho("Product", [{ rowNo: 1, externalId: "GWP-1", operation: "Insert" }],
    "LicenseNumber,Name,ExternalIdentifier,Operation,ErrorMessage\n413541,Invalid Product Test,GWP-1,Insert,Duplicate External Identifier");
  assert(two.outcome === "error-rows" && two.rejected[0].uncertain && two.messages[0] === "Duplicate External Identifier", "longest known text wins");
  // the same row listed twice is never counted twice: the file goes to reconciling
  const twice = classifyEcho("Area", [{ rowNo: 1, externalId: "AREA-1", operation: "Insert" }, { rowNo: 2, externalId: "AREA-2", operation: "Insert" }],
    "LicenseNumber,Area,ExternalIdentifier,ErrorMessage\n413541,Sales Floor,AREA-1,Invalid Product\n413541,Sales Floor,AREA-1,Invalid Product");
  assert(twice.outcome === "error-unmatched" && twice.lines[1].problem === "row 1 is listed twice", "a row listed twice is not guessed");
  // refusals
  assert(throwsEcho(() => classifyEcho("Area", [{ rowNo: 1, externalId: "AREA-1", operation: "Insert" }], "a,b\n1,2")), "no ErrorMessage header");
  assert(throwsEcho(() => classifyEcho("Area", [{ rowNo: 1, externalId: "AREA-1", operation: "Insert" }],
    "LicenseNumber,Area,ExternalIdentifier,ErrorMessage\n413541,X,AREA-9,Invalid Product")), "matches nothing -> wrong file");
  assert(throwsEcho(() => classifyEcho("Area", [{ rowNo: 1, externalId: "AREA-1", operation: "Insert" }],
    "LicenseNumber,Area,ExternalIdentifier,ErrorMessage\n413541,X,AREA-1,Invalid Product\n413541,Y,AREA-1,Invalid Product")), "more lines than rows");
  // success email
  const names = successEmailFileNames("The file Strain_413541_20250615213000_2026917T1252497.csv you submitted has been processed.\nThe file Area_413541_20261007120001_2026107T1258161.csv you");
  assert(names.join() === "Strain_413541_20250615213000.csv,Area_413541_20261007120001.csv", "token stripped, order kept");
  // actions
  const t0 = new Date("2026-10-07T19:00:00Z");
  assert(!fileActions("uploaded", t0, new Date(t0.getTime() + 59 * 60_000)).includes("record-no-email"), "no-email not before 60 min");
  assert(fileActions("uploaded", t0, new Date(t0.getTime() + 60 * 60_000)).includes("record-no-email"), "no-email at 60 min");
  assert(fileActions("closed", t0, t0).join() === "download", "closed is read-only");
  console.log("ccrs-outcome-core: all tests passed");
}
