/**
 * R41 S9 — "Check a file before you upload it to Timberland" (pure core).
 *
 * The owner pastes or picks an ACH file. This core re-reads every record the
 * way a bank's ACH front end does, then asks three Greenway questions:
 *
 *   1. Is it a well-formed Nacha file (94-character records, blocks of 10,
 *      1 / 5 6 7 8 / 9 order, controls that add up)?
 *   2. Is it what Timberland agreed to (the S2 pins: routing, Company ID,
 *      credits only, PPD/CCD), and does it still make its deadline (S5) and
 *      fit Timberland's limits (S4)?
 *   3. Is it byte-for-byte a file Greenway released from its ledger (S3),
 *      and not one already uploaded or voided?
 *
 * Nothing here stores, sends or echoes the file. Messages never repeat an
 * account number or a receiver name (the page is not a vault).
 *
 * Authorities (verbatim, mirrored in docs/authorities/ach/):
 *   HomeTrust ACH format: "the entry hash is the right justified 10 digits of the sum."
 *   HomeTrust: "A sequential ascending number assigned by you for each batch."
 *   HomeTrust: "The number of blocks of data in this file."
 *   HomeTrust: "If an addenda record, type '7', will follow, then this position must contain '1'; otherwise, it contains '0'."
 *   HomeTrust: "The first eight digits of the trace number consist of the bank R/T number"
 *   HomeTrust: "Contains the same information as the Company Identification field '5' in the Company/Batch Header Record '5'."
 *   HomeTrust: "Contains the same number as the batch number field '13' on the Company/Batch Header Record '5' for this batch."
 *   Banc of California: "All rows/records in the file must be 94 positions in length."
 *   Banc of California: "Text Encoding Setting: ANSI (UTF-8 not allowed)."
 *   Banc of California: "File must contain Carriage Returns and Line Feeds"
 *   Banc of California: "Batch numbers must be sequential and ascending"
 *   Banc of California: "does not have to be in strict numerical order but must be in ascending order."
 *   Banc of California: "For prenote codes, the amount must be zero."
 *   Banc of California: "Complete blocks are required."
 *   Banc of California: "All numeric fields must be right justified and zero prefilled and cannot include any symbols or special characters."
 *   Nacha: "A credit Micro-Entry must be in the amount of less than $1.00"
 *   Brenda (Timberland), Email 2: "9. No they should not" (Timberland does not reject a duplicate file).
 * Design model (not an authority): moov-io/ach file validation (structure, then controls, then custom rules).
 */

import { buildNachaFile, type AchOriginator } from "./nacha-core";
import { isValidRouting } from "./nacha-fields-core";
import { checkBuiltFileShape, greenwayTestOriginator } from "./timberland-originator-core";
import { checkEffectiveDateForTimberland } from "./timberland-deadline-core";
import { evaluateTimberlandLimits, type LedgerFileForLimits, type LimitKind } from "./timberland-limits-core";
import { sha256Hex, toCrlf } from "./ach-file-ledger-core";
import { BANK_REJECTS_DUPLICATE_FILES, centsToUsdText, TIMBERLAND_ODFI } from "./timberland-profile-core";
import { MICRO_ENTRY_DESCRIPTION, PAYROLL_DESCRIPTION } from "./ach-authorization-core";

/** A pasted file bigger than this is refused before it is read (Greenway's files are a few KB). */
export const MAX_CHECK_CHARS = 2_000_000;

export type LedgerMatchRow = { id: string; sha256: string; filename: string; kind: LimitKind; status: LedgerFileForLimits["status"]; fileDate: string };

export type CheckContext = {
  nowUtc: Date;
  /** Pacific day key (the upload day). */
  today: string;
  originator: { ok: true; value: AchOriginator } | { ok: false; error: string };
  /** ach_files rows whose sha256 equals fingerprints(raw).exact or .crlf. */
  ledgerMatches: { ok: true; rows: LedgerMatchRow[] } | { ok: false; error: string };
  limitsLedger: { ok: true; ledger: LedgerFileForLimits[] } | { ok: false; error: string };
  /** A practice file built on the page: not in the ledger, never uploaded. */
  practice?: boolean;
};

export type CheckFinding = { rule: string; message: string };
export type LedgerFileFact = { id: string; filename: string; status: string; kind: string; fileDate: string };

export type CheckResult = {
  ok: boolean;
  problems: CheckFinding[];
  warnings: CheckFinding[];
  /** Plain lines that passed, in order, for the page. */
  passed: string[];
  facts: {
    records: number;
    batches: number;
    entries: number;
    totalCreditCents: number;
    totalDebitCents: number;
    effectiveDate: string | null;
    kind: LimitKind | null;
    ledgerFile: LedgerFileFact | null;
  };
};

/** The two fingerprints the ledger could hold: the bytes as given, and the same file with CRLF ends. */
export function fingerprints(raw: string): { exact: string; crlf: string } {
  return { exact: sha256Hex(raw), crlf: sha256Hex(toCrlf(raw)) };
}

const PRENOTE_CODES = ["23", "33"];
const LIVE_CREDIT_CODES = ["22", "32"];
const isDebitCode = (c: string) => /^[23][6-9]$/.test(c);
const isCreditCode = (c: string) => /^[23][1-4]$/.test(c);

function validYymmdd(s: string): string | null {
  if (!/^\d{6}$/.test(s)) return null;
  const iso = `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
const usd = (c: number) => `$${centsToUsdText(c)}`;
const pad = (v: number, w: number) => String(v % 10 ** w).padStart(w, "0");

export function checkAchFileForUpload(raw: string, ctx: CheckContext): CheckResult {
  const problems: CheckFinding[] = [];
  const warnings: CheckFinding[] = [];
  const passed: string[] = [];
  const facts: CheckResult["facts"] = { records: 0, batches: 0, entries: 0, totalCreditCents: 0, totalDebitCents: 0, effectiveDate: null, kind: null, ledgerFile: null };
  const bad = (rule: string, message: string) => problems.push({ rule, message });
  const done = (): CheckResult => ({ ok: problems.length === 0, problems, warnings, passed, facts });

  // ── 1. Bytes ───────────────────────────────────────────────────────────
  if (typeof raw !== "string" || raw.length === 0) return (bad("empty", "The file is empty."), done());
  if (raw.length > MAX_CHECK_CHARS) return (bad("too_big", `The file is over ${MAX_CHECK_CHARS.toLocaleString("en-US")} characters, far bigger than any Greenway file. It was not read.`), done());
  if (raw.charCodeAt(0) === 0xfeff) bad("encoding", "The file starts with a byte-order mark (it was saved as UTF-8). Timberland's portal reads plain ANSI/ASCII text. Download the file again; do not open and re-save it.");
  const odd = [...raw.replace(/^\uFEFF/, "")].filter((ch) => ch !== "\r" && ch !== "\n" && (ch < " " || ch > "~"));
  if (odd.length) bad("encoding", `The file has ${odd.length} character(s) that are not plain ASCII (a tab, an accent or a curly quote). Nacha records are plain ASCII. Download the file again; do not edit it.`);
  const body = raw.replace(/^\uFEFF/, "");
  if (/\r(?!\n)/.test(body)) bad("line_ends", "The file has a carriage return that is not followed by a line feed. Download the file again; do not edit it.");
  const crlf = (body.match(/\r\n/g) ?? []).length;
  const lf = (body.match(/\n/g) ?? []).length;
  if (crlf > 0 && crlf !== lf) bad("line_ends", "The file mixes two kinds of line ends (some CRLF, some LF only), so it was edited after download. Download it again.");
  else if (crlf === 0 && lf > 0) warnings.push({ rule: "line_ends", message: "The file has LF-only line ends. Greenway releases files with CRLF ends (Windows), which most bank portals expect. Upload the file exactly as downloaded from Operations." });

  let rows = body.split(/\r?\n/);
  if (rows.length && rows[rows.length - 1] === "") rows = rows.slice(0, -1);
  const blankAt = rows.findIndex((r) => r.trim() === "");
  if (blankAt >= 0) bad("blank_row", `Row ${blankAt + 1} is blank. A Nacha file has no blank rows.`);
  rows = rows.map((r) => r.replace(/\r$/, ""));
  facts.records = rows.length;
  const wide = rows.map((r, i) => (r.length === 94 ? -1 : i + 1)).filter((i) => i > 0);
  if (wide.length) bad("width", `${wide.length} row(s) are not 94 characters long (first: row ${wide.slice(0, 3).join(", ")}). Every record must be 94 positions.`);
  else passed.push("Every record is 94 characters.");
  if (rows.length % 10 !== 0) bad("blocks", `The file has ${rows.length} records, not a multiple of 10. Complete blocks of 10 are required (pad with rows of 9s).`);
  else passed.push(`The file is ${rows.length / 10} complete block(s) of 10 records.`);
  if (wide.length || blankAt >= 0 || problems.some((p) => p.rule === "encoding")) return done();

  // ── 2. Record order: 1 (5 (6 7*)+ 8)+ 9 9-fill* ─────────────────────────
  const types = rows.map((r) => r[0]).join("");
  const fill = "9".repeat(94);
  const fcIndex = rows.findIndex((r) => r[0] === "9");
  const orderOk = /^1(5(67*)+8)+9+$/.test(types) && fcIndex >= 0 && rows[fcIndex] !== fill && rows.slice(fcIndex + 1).every((r) => r === fill);
  if (!orderOk) return (bad("structure", "The records are not in Nacha order: one file header (1), then batches (5, entries 6 with any addenda 7, then 8), then one file control (9), then rows of 9s."), done());
  passed.push("The records are in Nacha order (1, 5-6-8 batches, 9, filler).");

  // ── 3. File header ─────────────────────────────────────────────────────
  const h = rows[0];
  const hp: string[] = [];
  if (h.slice(1, 3) !== "01") hp.push("the priority code (positions 2-3) is not 01");
  if (!validYymmdd(h.slice(23, 29))) hp.push("the file creation date (24-29) is not a real date");
  if (!/^([01]\d|2[0-3])[0-5]\d$/.test(h.slice(29, 33))) hp.push("the file creation time (30-33) is not a real time");
  if (!/^[A-Z0-9]$/.test(h.slice(33, 34))) hp.push("the File ID Modifier (34) is not A-Z or 0-9");
  if (h.slice(34, 37) !== "094") hp.push("the record size (35-37) is not 094");
  if (h.slice(37, 39) !== "10") hp.push("the blocking factor (38-39) is not 10");
  if (h.slice(39, 40) !== "1") hp.push("the format code (40) is not 1");
  if (hp.length) bad("file_header", `File header: ${hp.join("; ")}.`);
  else passed.push("The file header fields are well formed.");

  // ── 4. Batches ─────────────────────────────────────────────────────────
  type Batch = { header: string; entries: { row: string; addenda: string[] }[]; control: string };
  const batches: Batch[] = [];
  for (let i = 1; i < fcIndex; i++) {
    const r = rows[i];
    if (r[0] === "5") batches.push({ header: r, entries: [], control: "" });
    else if (r[0] === "6") batches[batches.length - 1].entries.push({ row: r, addenda: [] });
    else if (r[0] === "7") {
      const b = batches[batches.length - 1];
      b.entries[b.entries.length - 1].addenda.push(r);
    } else if (r[0] === "8") batches[batches.length - 1].control = r;
  }
  facts.batches = batches.length;

  let fileHash = 0;
  let fileCount = 0;
  let fileDebit = 0;
  let fileCredit = 0;
  let prevBatchNo = -1;
  let prevTrace = "";
  const traces = new Set<string>();
  const entryAmounts: number[] = [];
  const effDates = new Set<string>();
  const kinds = new Set<LimitKind>();
  const before = problems.length;

  for (const [bi, b] of batches.entries()) {
    const n = bi + 1;
    const H = b.header;
    const desc = H.slice(53, 63).trim();
    const sec = H.slice(50, 53);
    const eff = validYymmdd(H.slice(69, 75));
    if (!eff) bad("batch_header", `Batch ${n}: the effective entry date (70-75) is not a real date.`);
    else effDates.add(eff);
    if (H.slice(75, 78) !== "   ") bad("batch_header", `Batch ${n}: the settlement date (76-78) must be left blank; the bank fills it in.`);
    if (H.slice(78, 79) !== "1") bad("batch_header", `Batch ${n}: the originator status code (79) is not 1.`);
    const batchNo = /^\d{7}$/.test(H.slice(87, 94)) ? Number(H.slice(87, 94)) : NaN;
    if (Number.isNaN(batchNo)) bad("batch_order", `Batch ${n}: the batch number (88-94) is not a number.`);
    else if (batchNo <= prevBatchNo) bad("batch_order", `Batch ${n}: batch numbers must be sequential and ascending (${batchNo} follows ${prevBatchNo}).`);
    if (!Number.isNaN(batchNo)) prevBatchNo = batchNo;

    let hash = 0;
    let count = 0;
    let debit = 0;
    let credit = 0;
    let live = 0;
    for (const [ei, e] of b.entries.entries()) {
      const E = e.row;
      const where = `Batch ${n}, entry ${ei + 1}`;
      const code = E.slice(1, 3);
      const amountText = E.slice(29, 39);
      const amount = /^\d{10}$/.test(amountText) ? Number(amountText) : NaN;
      if (!/^\d{9}$/.test(E.slice(3, 12)) || !isValidRouting(E.slice(3, 12))) bad("routing", `${where}: the receiving bank routing number (4-12) fails the ABA check digit.`);
      else hash += Number(E.slice(3, 11));
      if (E.slice(12, 29).trim() === "") bad("entry", `${where}: the account number (13-29) is blank.`);
      if (Number.isNaN(amount)) bad("amount", `${where}: the amount (30-39) must be 10 digits, zero-filled, with no symbols.`);
      else {
        if (isDebitCode(code)) debit += amount;
        else credit += amount;
        if (PRENOTE_CODES.includes(code) && amount !== 0) bad("prenote_amount", `${where}: a prenote (code ${code}) must be $0.00; it carries ${usd(amount)}.`);
        if (LIVE_CREDIT_CODES.includes(code)) {
          live++;
          entryAmounts.push(amount);
          if (amount === 0) bad("zero_credit", `${where}: a live credit (code ${code}) of $0.00. Use a prenote (code 23/33) to test an account.`);
          if (desc === MICRO_ENTRY_DESCRIPTION && (amount < 1 || amount > 99)) bad("micro_amount", `${where}: an ${MICRO_ENTRY_DESCRIPTION} micro-entry must be under $1.00 (1 to 99 cents); it is ${usd(amount)}.`);
        }
      }
      if (!isCreditCode(code) && !isDebitCode(code)) bad("entry", `${where}: transaction code ${code} is not a Nacha credit or debit code.`);
      const ind = E.slice(78, 79);
      if (ind !== "0" && ind !== "1") bad("addenda", `${where}: the addenda indicator (79) must be 0 or 1.`);
      else if ((ind === "1") !== e.addenda.length > 0) bad("addenda", `${where}: the addenda indicator says ${ind} but ${e.addenda.length} addenda record(s) follow.`);
      if (e.addenda.length > 1) bad("addenda", `${where}: PPD and CCD allow one addenda record per entry; ${e.addenda.length} follow.`);
      for (const a of e.addenda) {
        if (a.slice(1, 3) !== "05") bad("addenda", `${where}: the addenda type code (2-3) is not 05.`);
        if (a.slice(87, 94) !== E.slice(87, 94)) bad("addenda", `${where}: the addenda's entry sequence number (88-94) does not match the entry's trace number.`);
      }
      const trace = E.slice(79, 94);
      if (E.slice(79, 87) !== TIMBERLAND_ODFI) bad("trace", `${where}: the trace number does not start with Timberland's 8-digit bank number.`);
      if (!/^\d{15}$/.test(trace)) bad("trace", `${where}: the trace number (80-94) is not 15 digits.`);
      else if (traces.has(trace)) bad("trace", `${where}: trace number ${trace} is used twice.`);
      else if (trace <= prevTrace) bad("trace", `${where}: trace numbers must be ascending.`);
      traces.add(trace);
      if (trace > prevTrace) prevTrace = trace;
      count += 1 + e.addenda.length;
    }

    // Kind of this batch.
    const allPrenote = b.entries.every((e) => PRENOTE_CODES.includes(e.row.slice(1, 3)));
    if (sec === "CCD") kinds.add("vendor");
    else if (sec === "PPD") {
      if (allPrenote && live === 0) kinds.add("prenote");
      else if (desc === MICRO_ENTRY_DESCRIPTION) kinds.add("micro_entry");
      else if (desc === PAYROLL_DESCRIPTION) kinds.add("payroll");
      else bad("description", `Batch ${n}: a PPD batch with description "${desc}". Greenway's PPD files say ${PAYROLL_DESCRIPTION} (pay) or ${MICRO_ENTRY_DESCRIPTION} (account check).`);
    }

    // Batch control against the recomputed totals.
    const C = b.control;
    if (C.slice(1, 4) !== H.slice(1, 4)) bad("batch_control", `Batch ${n}: the control's service class does not match its header.`);
    if (C.slice(4, 10) !== pad(count, 6)) bad("batch_count", `Batch ${n}: the control says ${Number(C.slice(4, 10)) || 0} entries and addenda; the batch has ${count}.`);
    if (C.slice(10, 20) !== pad(hash, 10)) bad("batch_hash", `Batch ${n}: the entry hash in the control is not the right-justified 10 digits of the sum of the receiving bank numbers.`);
    if (C.slice(20, 32) !== pad(debit, 12)) bad("batch_debit", `Batch ${n}: the control's debit total is not the sum of the debit entries (${usd(debit)}).`);
    if (C.slice(32, 44) !== pad(credit, 12)) bad("batch_credit", `Batch ${n}: the control's credit total does not equal the sum of the credit entries (${usd(credit)}).`);
    if (C.slice(44, 54) !== H.slice(40, 50)) bad("batch_control", `Batch ${n}: the control's Company Identification is not the same as the batch header's.`);
    if (C.slice(73, 79) !== "      ") bad("batch_control", `Batch ${n}: the control's reserved positions (74-79) are not blank.`);
    if (C.slice(79, 87) !== H.slice(79, 87)) bad("batch_control", `Batch ${n}: the control's Originating DFI is not the same as the header's.`);
    if (C.slice(87, 94) !== H.slice(87, 94)) bad("batch_control", `Batch ${n}: the control's batch number is not the same as the header's.`);
    fileHash += hash;
    fileCount += count;
    fileDebit += debit;
    fileCredit += credit;
    facts.entries += b.entries.length;
  }
  facts.totalCreditCents = fileCredit;
  facts.totalDebitCents = fileDebit;

  // ── 5. File control ────────────────────────────────────────────────────
  const F = rows[fcIndex];
  if (F.slice(1, 7) !== pad(batches.length, 6)) bad("file_batches", `File control: it says ${Number(F.slice(1, 7)) || 0} batch(es); the file has ${batches.length}.`);
  if (F.slice(7, 13) !== pad(Math.ceil((fcIndex + 1) / 10), 6)) bad("file_blocks", `File control: the block count is not ${Math.ceil((fcIndex + 1) / 10)}.`);
  if (F.slice(13, 21) !== pad(fileCount, 8)) bad("file_count", `File control: it says ${Number(F.slice(13, 21)) || 0} entries and addenda; the file has ${fileCount}.`);
  if (F.slice(21, 31) !== pad(fileHash, 10)) bad("file_hash", "File control: the entry hash is not the right-justified 10 digits of the sum of the receiving bank numbers.");
  if (F.slice(31, 43) !== pad(fileDebit, 12)) bad("file_debit", `File control: the debit total is not ${usd(fileDebit)}.`);
  if (F.slice(43, 55) !== pad(fileCredit, 12)) bad("file_credit", `File control: the credit total is not ${usd(fileCredit)}, the sum of every credit entry.`);
  if (F.slice(55, 94).trim() !== "") bad("file_control", "File control: the reserved positions (56-94) are not blank.");
  if (problems.length === before) passed.push(`Every batch and file total adds up: ${facts.entries} entr${facts.entries === 1 ? "y" : "ies"}, ${usd(fileCredit)} in credits, ${usd(fileDebit)} in debits.`);

  // ── 6. Timberland's agreement (the S2 pins) ─────────────────────────────
  if (!ctx.originator.ok) bad("originator", `Greenway's company ACH settings could not be read, so the Timberland fields cannot be confirmed: ${ctx.originator.error}`);
  else {
    const pins = checkBuiltFileShape(rows.join("\n") + "\n", ctx.originator.value);
    for (const p of pins) bad("timberland_pin", `Timberland's setup: ${p}.`);
    if (!pins.length) passed.push("It carries Timberland's routing, Greenway's Company ID, credits only, PPD/CCD only.");
  }
  if (kinds.size > 1) bad("mixed", `The file mixes kinds (${[...kinds].join(", ")}). Greenway releases one kind per file.`);
  const kind = kinds.size === 1 ? [...kinds][0] : null;
  facts.kind = kind;

  // ── 7. Deadline ────────────────────────────────────────────────────────
  if (effDates.size > 1) bad("effective", "The batches have different effective dates. Greenway's files carry one.");
  const eff = effDates.size === 1 ? [...effDates][0] : null;
  facts.effectiveDate = eff;
  if (eff) {
    const ec = checkEffectiveDateForTimberland(eff, ctx.nowUtc);
    if (!ec.ok) bad("effective", ec.error);
    else if (ec.warning) warnings.push({ rule: "deadline", message: ec.warning });
    else passed.push(`It still makes its deadline: upload and approve by ${ec.deadline.text}.`);
  }

  // ── 8. The ledger: is this the file Greenway released? ──────────────────
  let selfId: string | null = null;
  if (!ctx.ledgerMatches.ok) bad("ledger_unreadable", `The release ledger could not be read, so it is not known whether Greenway released this file: ${ctx.ledgerMatches.error}`);
  else {
    const fp = fingerprints(body === raw ? raw : body);
    const exact = ctx.ledgerMatches.rows.find((r) => r.sha256 === fp.exact);
    const same = exact ?? ctx.ledgerMatches.rows.find((r) => r.sha256 === fp.crlf);
    if (!same) {
      if (ctx.practice) warnings.push({ rule: "practice", message: "Practice file: it is not in the ledger and must never be uploaded." });
      else bad("ledger_unknown", "This file is not one Greenway released (no ledger row has its fingerprint), or it was changed after download. Only upload a file downloaded from Banking > Operations, unchanged.");
    } else {
      selfId = same.id;
      facts.ledgerFile = { id: same.id, filename: same.filename, status: same.status, kind: same.kind, fileDate: same.fileDate };
      if (same.status === "voided") bad("ledger_voided", `This is ${same.filename}, which was VOIDED. Do not upload it.`);
      else if (same.status === "uploaded" || same.status === "bank_approved") {
        bad(
          "ledger_already",
          `This is ${same.filename}, already marked ${same.status === "uploaded" ? "uploaded" : "approved at Timberland"}. Uploading it again would pay everyone twice${BANK_REJECTS_DUPLICATE_FILES ? "" : ", and Timberland does not reject a duplicate file (Brenda: \"9. No they should not\")"}.`,
        );
      } else if (!exact) bad("ledger_bytes", `These are the entries of ${same.filename}, but the line ends were changed after download. Upload the downloaded file itself, unchanged.`);
      else passed.push(`It is ${same.filename}, byte for byte as released, not yet uploaded.`);
      if (kind && same.kind !== kind) bad("ledger_kind", `The ledger says ${same.filename} is a ${same.kind} file, but its records read as ${kind}.`);
    }
  }

  // ── 9. Limits (S4), without counting this file twice ───────────────────
  if (kind && eff) {
    if (!ctx.limitsLedger.ok) bad("limits_unreadable", `Timberland's limits could not be checked (the ledger could not be read): ${ctx.limitsLedger.error}`);
    else {
      const r = evaluateTimberlandLimits(
        { kind, fileDate: ctx.today, effectiveDate: eff, totalCents: fileCredit, entryAmountsCents: entryAmounts },
        ctx.limitsLedger.ledger.filter((f) => f.id !== selfId),
      );
      for (const b of r.blocks) bad(`limit_${b.rule}`, b.message);
      for (const w of r.warnings) warnings.push({ rule: "limit", message: w.message });
      if (r.ok) passed.push("It fits Timberland's per-payment, per-file, daily and monthly limits.");
    }
  }
  return done();
}

// ───────────────────────────────────────────────────────── Self-tests ───

/** Recompute the (single) batch control and the file control after a test edits rows, to isolate ONE rule. */
function reseal(file: string): string {
  const rows = file.split(/\r?\n/).filter((r) => r.length);
  let hash = 0;
  let credit = 0;
  let n = 0;
  for (const r of rows) {
    if (r[0] === "6") {
      hash += Number(r.slice(3, 11));
      credit += Number(r.slice(29, 39));
      n++;
    }
    if (r[0] === "7") n++;
  }
  return (
    rows
      .map((r) => {
        if (r[0] === "8") return r.slice(0, 4) + pad(n, 6) + pad(hash, 10) + r.slice(20, 32) + pad(credit, 12) + r.slice(44);
        if (r[0] === "9" && r !== "9".repeat(94)) return r.slice(0, 13) + pad(n, 8) + pad(hash, 10) + r.slice(31, 43) + pad(credit, 12) + r.slice(55);
        return r;
      })
      .join("\r\n") + "\r\n"
  );
}

export type TestBuild = { entries: { amountCents: number; prenote?: boolean; routing?: string }[]; description: string; sec: "PPD" | "CCD"; effective: string; created: Date };

/** A real file from the real builder (test originator, test accounts), for the self-tests and the vitest file. */
export function testFileForChecker(o: TestBuild, originator: AchOriginator = greenwayTestOriginator()): string {
  const r = buildNachaFile({
    originator,
    entries: o.entries.map((e, i) => ({
      accountType: "checking" as const,
      routing: e.routing ?? "021000021",
      accountNumber: `00123456${i}`,
      amountCents: e.amountCents,
      name: `TEST PAYEE ${i + 1}`,
      idNumber: `E${i + 1}`,
      prenote: e.prenote,
    })),
    secCode: o.sec,
    companyEntryDescription: o.description,
    effectiveDate: new Date(`${o.effective}T12:00:00Z`),
    createdAt: o.created,
    fileIdModifier: "A",
  });
  if (!r.ok) throw new Error(`testFileForChecker: ${r.error}`);
  return r.file;
}

export function __runTimberlandFileCheckerCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  FAIL timberland-file-checker-core: ${n}`);
    }
  };
  // Mon 2026-10-05 17:00Z = 10:00 am PDT. Effective Thu 2026-10-08 -> upload deadline Tue 2026-10-06, 4:00 pm PDT (23:00Z), target 3:30 pm (22:30Z).
  const now = new Date("2026-10-05T17:00:00Z");
  const today = "2026-10-05";
  const O = greenwayTestOriginator();
  const build = (o: Partial<TestBuild> = {}) =>
    toCrlf(testFileForChecker({ entries: [{ amountCents: 12_345 }, { amountCents: 50_000 }], description: "PAYROLL", sec: "PPD", effective: "2026-10-08", created: now, ...o }));
  const good = build();
  const row = (raw: string, over: Partial<LedgerMatchRow> = {}): LedgerMatchRow => ({ id: "f1", sha256: fingerprints(raw).exact, filename: "PAY.ach", kind: "payroll", status: "released", fileDate: today, ...over });
  const ctx = (raw: string, over: Partial<CheckContext> = {}): CheckContext => ({
    nowUtc: now,
    today,
    originator: { ok: true, value: O },
    ledgerMatches: { ok: true, rows: [row(raw)] },
    limitsLedger: { ok: true, ledger: [] },
    ...over,
  });
  const chk = (raw: string, over: Partial<CheckContext> = {}) => checkAchFileForUpload(raw, ctx(raw, over));
  const rules = (r: CheckResult) => r.problems.map((p) => p.rule);
  const has = (r: CheckResult, rule: string) => rules(r).includes(rule);
  const only = (r: CheckResult, rule: string) => r.problems.length > 0 && r.problems.every((p) => p.rule === rule);
  const rowsOf = (raw: string) => raw.split("\r\n");
  const edit = (raw: string, rowNo: number, from: number, text: string) => {
    const rs = rowsOf(raw);
    rs[rowNo - 1] = rs[rowNo - 1].slice(0, from) + text + rs[rowNo - 1].slice(from + text.length);
    return rs.join("\r\n");
  };

  // The good file.
  const g = chk(good);
  ok(g.ok && g.problems.length === 0 && g.warnings.length === 0, `a real released payroll file passes (${JSON.stringify(g.problems)} ${JSON.stringify(g.warnings)})`);
  ok(g.facts.entries === 2 && g.facts.totalCreditCents === 62_345 && g.facts.kind === "payroll" && g.facts.effectiveDate === "2026-10-08" && g.facts.records === 10 && g.facts.batches === 1, "facts read back");
  ok(g.facts.ledgerFile?.id === "f1" && g.passed.some((p) => p.includes("byte for byte")), "the ledger row is named");
  ok(g.passed.some((p) => p.includes("Tue Oct 6")), `the deadline line names Tue Oct 6 (${g.passed.join(" | ")})`);
  ok(!JSON.stringify(g).includes("001234560") && !JSON.stringify(g).includes("TEST PAYEE"), "nothing echoes an account or a name");
  const vend = build({ sec: "CCD", description: "VENDOR PAY" });
  const v = chk(vend, { ledgerMatches: { ok: true, rows: [row(vend, { kind: "vendor" })] } });
  ok(v.ok && v.facts.kind === "vendor", `a vendor CCD file passes (${JSON.stringify(v.problems)})`);
  const pre = build({ entries: [{ amountCents: 0, prenote: true }] });
  const p = chk(pre, { ledgerMatches: { ok: true, rows: [row(pre, { kind: "prenote" })] } });
  ok(p.ok && p.facts.kind === "prenote", `a prenote file passes (${JSON.stringify(p.problems)})`);
  const micro = build({ description: "ACCTVERIFY", entries: [{ amountCents: 7 }, { amountCents: 99 }] });
  const m = chk(micro, { ledgerMatches: { ok: true, rows: [row(micro, { kind: "micro_entry" })] } });
  ok(m.ok && m.facts.kind === "micro_entry", `a micro-entry file passes (${JSON.stringify(m.problems)})`);

  // Bytes.
  ok(has(chk(""), "empty"), "empty refused");
  ok(has(chk("x".repeat(MAX_CHECK_CHARS + 1)), "too_big"), "too big refused unread");
  ok(has(chk("\uFEFF" + good), "encoding"), "a UTF-8 byte-order mark refused");
  ok(has(chk(edit(good, 3, 54, "\u00e9")), "encoding"), "an accented character refused");
  ok(has(chk(edit(good, 3, 54, "\t")), "encoding"), "a tab refused");
  ok(has(chk(good.replace("\r\n", "\r")), "line_ends"), "a lone CR refused");
  ok(has(chk(good.replace("\r\n", "\n")), "line_ends"), "mixed line ends refused");
  const lfOnly = good.replace(/\r\n/g, "\n");
  const lr = chk(lfOnly, { ledgerMatches: { ok: true, rows: [row(good)] } });
  ok(lr.warnings.some((w) => w.rule === "line_ends") && has(lr, "ledger_bytes") && !has(lr, "line_ends"), "LF-only: a warning, and the ledger says the bytes changed");
  ok(chk(good.replace(/\r\n$/, "")).problems.length === 0, "no final line end is fine");
  ok(has(chk(good.replace("\r\n", "\r\n\r\n")), "blank_row"), "a blank row refused");
  const wideRows = rowsOf(good);
  wideRows[2] = wideRows[2] + " ";
  ok(has(chk(wideRows.join("\r\n")), "width"), "a 95-character row refused");
  wideRows[2] = wideRows[2].slice(0, 93);
  ok(has(chk(wideRows.join("\r\n")), "width"), "a 93-character row refused");
  const nine = rowsOf(good);
  nine.splice(8, 1);
  ok(has(chk(nine.join("\r\n")), "blocks"), "an incomplete block refused");

  // Structure.
  const sw = rowsOf(good);
  [sw[2], sw[1]] = [sw[1], sw[2]];
  ok(has(chk(sw.join("\r\n")), "structure"), "an entry before its batch header refused");
  const noCtl = rowsOf(good);
  noCtl[4] = "6" + noCtl[4].slice(1);
  ok(has(chk(noCtl.join("\r\n")), "structure"), "a batch without a control refused");
  const fillFirst = rowsOf(good);
  fillFirst[5] = "9".repeat(94);
  ok(has(chk(fillFirst.join("\r\n")), "structure"), "filler where the file control should be refused");
  const junkTail = rowsOf(good);
  junkTail[8] = "1" + junkTail[8].slice(1);
  ok(has(chk(junkTail.join("\r\n")), "structure"), "a record after the file control refused");

  // File header.
  ok(has(chk(edit(good, 1, 1, "02")), "file_header"), "priority code not 01 refused");
  ok(has(chk(edit(good, 1, 23, "261345")), "file_header"), "a creation date of month 13 refused");
  ok(has(chk(edit(good, 1, 29, "2460")), "file_header"), "a creation time of 24:60 refused");
  ok(has(chk(edit(good, 1, 33, "a")), "file_header"), "a lower-case modifier refused");
  ok(has(chk(edit(good, 1, 34, "095")), "file_header"), "record size not 094 refused");
  ok(has(chk(edit(good, 1, 37, "20")), "file_header"), "blocking factor not 10 refused");
  ok(has(chk(edit(good, 1, 39, "2")), "file_header"), "format code not 1 refused");

  // Batch header.
  ok(has(chk(edit(good, 2, 69, "261332")), "batch_header"), "an impossible effective date refused");
  ok(has(chk(edit(good, 2, 75, "280")), "batch_header"), "a filled-in settlement date refused");
  ok(has(chk(edit(good, 2, 78, "2")), "batch_header"), "status code not 1 refused");
  ok(has(chk(edit(good, 2, 87, "000000X")), "batch_order"), "a non-numeric batch number refused");
  ok(has(chk(edit(good, 2, 53, "BONUS     ")), "description"), "a PPD batch that is neither PAYROLL nor ACCTVERIFY refused");

  // Entries.
  ok(has(chk(reseal(edit(good, 3, 11, "0"))), "routing"), "a bad receiving check digit refused");
  ok(has(chk(reseal(edit(good, 3, 12, " ".repeat(17)))), "entry"), "a blank account refused");
  ok(has(chk(edit(good, 3, 29, "00000-1234")), "amount"), "an amount with a symbol refused");
  ok(has(chk(reseal(edit(good, 3, 29, "0000000000"))), "zero_credit"), "a $0 live credit refused");
  ok(has(chk(reseal(edit(pre, 3, 29, "0000000001"))), "prenote_amount"), "a prenote with an amount refused");
  ok(has(chk(reseal(edit(micro, 3, 29, "0000000100"))), "micro_amount"), "an ACCTVERIFY entry of $1.00 refused");
  ok(!has(chk(reseal(edit(micro, 3, 29, "0000000001"))), "micro_amount"), "an ACCTVERIFY entry of 1 cent allowed");
  ok(has(chk(reseal(edit(good, 3, 1, "27"))), "timberland_pin"), "a debit code (27) refused by the Timberland pins");
  ok(has(chk(reseal(edit(good, 3, 1, "27"))), "batch_debit"), "a debit code also breaks the zero debit total");
  ok(has(chk(reseal(edit(good, 3, 1, "99"))), "entry"), "a non-Nacha transaction code refused");
  ok(has(chk(reseal(edit(good, 4, 87, "0000001"))), "trace"), "duplicate trace refused");
  ok(has(chk(reseal(edit(edit(good, 3, 87, "0000005"), 4, 87, "0000004"))), "trace"), "descending trace refused");
  ok(has(chk(reseal(edit(good, 3, 79, "12345678"))), "trace"), "trace not prefixed with Timberland's bank number refused");
  ok(has(chk(reseal(edit(good, 3, 78, "1"))), "addenda"), "addenda indicator 1 with no addenda refused");
  ok(has(chk(reseal(edit(good, 3, 78, "2"))), "addenda"), "addenda indicator 2 refused");
  const withAdd = (type: string, seq: string, ind = "1", count = 1) => {
    const rs = rowsOf(good).filter((r) => r.length);
    rs[2] = rs[2].slice(0, 78) + ind + rs[2].slice(79);
    const add = "7" + type + "PAYMENT INFO".padEnd(80) + "0001" + seq;
    for (let i = 0; i < count; i++) rs.splice(3, 0, add);
    rs.splice(rs.length - count, count);
    return reseal(rs.join("\r\n"));
  };
  const a1 = withAdd("05", rowsOf(good)[2].slice(87, 94));
  ok(chk(a1, { ledgerMatches: { ok: true, rows: [row(a1)] } }).ok, `one correct 05 addenda passes (${JSON.stringify(chk(a1, { ledgerMatches: { ok: true, rows: [row(a1)] } }).problems)})`);
  ok(has(chk(withAdd("02", rowsOf(good)[2].slice(87, 94))), "addenda"), "addenda type not 05 refused");
  ok(has(chk(withAdd("05", "0000009")), "addenda"), "addenda sequence not matching the trace refused");
  ok(has(chk(withAdd("05", rowsOf(good)[2].slice(87, 94), "0")), "addenda"), "an addenda after indicator 0 refused");
  ok(has(chk(withAdd("05", rowsOf(good)[2].slice(87, 94), "1", 2)), "addenda"), "two addenda on one entry refused");
  ok(!has(chk(a1, { ledgerMatches: { ok: true, rows: [row(a1)] } }), "batch_count") && chk(a1).facts.entries === 2, "addenda count toward the control, not the entries");

  // Controls (each edit isolates one total).
  ok(only(chk(edit(good, 5, 4, "000003")), "batch_count") , "batch count off by one: only batch_count");
  ok(has(chk(edit(good, 5, 10, "0000000001")), "batch_hash"), "batch hash wrong");
  ok(has(chk(edit(good, 5, 20, "000000000001")), "batch_debit"), "batch debit wrong");
  ok(has(chk(edit(good, 5, 32, "000000062346")), "batch_credit"), "batch credit off by one cent");
  ok(has(chk(edit(good, 5, 44, "1999999999")), "batch_control"), "batch control company id differs");
  ok(has(chk(edit(good, 5, 73, "X")), "batch_control"), "batch control reserved not blank");
  ok(has(chk(edit(good, 5, 86, "9")), "batch_control"), "batch control number differs");
  ok(has(chk(edit(good, 5, 1, "225")), "batch_control"), "batch control service class differs");
  ok(has(chk(edit(good, 6, 1, "000002")), "file_batches"), "file batch count wrong");
  ok(has(chk(edit(good, 6, 7, "000002")), "file_blocks"), "file block count wrong");
  ok(has(chk(edit(good, 6, 13, "00000003")), "file_count"), "file entry count wrong");
  ok(has(chk(edit(good, 6, 21, "0000000001")), "file_hash"), "file hash wrong");
  ok(has(chk(edit(good, 6, 31, "000000000001")), "file_debit"), "file debit wrong");
  ok(has(chk(edit(good, 6, 43, "000000062346")), "file_credit"), "file credit off by one cent");
  ok(has(chk(edit(good, 6, 60, "X")), "file_control"), "file control reserved not blank");
  // Hash is the right-justified 10 digits: 2,000 entries of an 8-digit 99999999-style DFI overflow 10 digits.
  const bigRouting = "999999992";
  ok(isValidRouting(bigRouting), "the overflow test routing passes the ABA check digit");
  const many = build({ entries: Array.from({ length: 120 }, () => ({ amountCents: 100, routing: bigRouting })) });
  const mr = chk(many, { ledgerMatches: { ok: true, rows: [row(many)] } });
  ok(mr.ok && 120 * 99_999_999 > 1e10, `a file whose hash sum passes 10 digits is read right-justified (${JSON.stringify(mr.problems)})`);
  // A tampered amount, re-totalled so the arithmetic agrees, is caught by the ledger fingerprint.
  const tampered = reseal(edit(good, 3, 29, "0000099999"));
  const tr = chk(tampered, { ledgerMatches: { ok: true, rows: [row(good)] } });
  ok(!tr.problems.some((x) => /^(batch|file)_/.test(x.rule)) && has(tr, "ledger_unknown"), "a re-totalled tampered amount passes arithmetic but fails the ledger fingerprint");

  // Timberland pins and kinds.
  ok(has(chk(good, { originator: { ok: true, value: greenwayTestOriginator({ companyId: "1999999999", immediateOrigin: "1999999999", companyEin: "999999999" }) } }), "timberland_pin"), "a file for another Company ID refused");
  ok(has(chk(good, { originator: { ok: false, error: "no settings" } }), "originator"), "unreadable settings refused, never assumed");
  const two = (() => {
    const a = rowsOf(good).filter((r) => r.length);
    const b = rowsOf(vend).filter((r) => r.length);
    const rows = [a[0], ...a.slice(1, 5), ...b.slice(1, 5).map((r) => (r[0] === "5" || r[0] === "8" ? r.slice(0, 87) + "0000002" : r))];
    let seq = 0;
    rows.forEach((r, i) => {
      if (r[0] === "6") rows[i] = r.slice(0, 87) + pad(++seq, 7);
    });
    const t2 = rows.filter((r) => r[0] === "6");
    const hash = t2.reduce((s, r) => s + Number(r.slice(3, 11)), 0);
    const cr = t2.reduce((s, r) => s + Number(r.slice(29, 39)), 0);
    rows.push("9" + pad(2, 6) + pad(1, 6) + pad(4, 8) + pad(hash, 10) + pad(0, 12) + pad(cr, 12) + " ".repeat(39));
    while (rows.length % 10) rows.push("9".repeat(94));
    return rows.join("\r\n") + "\r\n";
  })();
  const tw = chk(two);
  ok(has(tw, "mixed") && tw.facts.batches === 2 && tw.facts.kind === null, `a payroll + vendor file refused as mixed (${JSON.stringify(tw.problems.map((x) => x.rule))})`);
  ok(!tw.problems.some((x) => /^(batch|file)_|structure|trace/.test(x.rule)), `the two-batch file is otherwise well formed (ascending batch numbers, totals)`);
  const twoBack = two.replace(/(\r\n5.{86})0000002/, "$10000000").replace(/(\r\n8.{86})0000002/, "$10000000");
  ok(has(chk(twoBack), "batch_order"), "a batch number that does not ascend refused");

  // Deadline.
  ok(!has(chk(good, { nowUtc: new Date("2026-10-06T22:00:00Z"), today: "2026-10-06" }), "effective") && chk(good, { nowUtc: new Date("2026-10-06T22:00:00Z"), today: "2026-10-06" }).warnings.length === 0, "Tue 3:00 pm PDT: open, no warning");
  ok(chk(good, { nowUtc: new Date("2026-10-06T22:45:00Z"), today: "2026-10-06" }).warnings.some((w) => w.rule === "deadline"), "Tue 3:45 pm PDT: inside the 30-minute margin, warned");
  ok(has(chk(good, { nowUtc: new Date("2026-10-06T23:00:00Z"), today: "2026-10-06" }), "effective"), "Tue 4:00 pm PDT: too late, refused");
  const sat = build({ effective: "2026-10-10" });
  ok(has(chk(sat), "effective"), "a Saturday effective date refused");

  // Ledger.
  ok(has(chk(good, { ledgerMatches: { ok: true, rows: [] } }), "ledger_unknown"), "a file not in the ledger refused");
  ok(!has(chk(good, { ledgerMatches: { ok: true, rows: [] }, practice: true }), "ledger_unknown") && chk(good, { ledgerMatches: { ok: true, rows: [] }, practice: true }).warnings.some((w) => w.rule === "practice"), "a practice file is warned, not refused");
  ok(has(chk(good, { ledgerMatches: { ok: false, error: "down" } }), "ledger_unreadable"), "an unreadable ledger refused, never assumed");
  ok(has(chk(good, { ledgerMatches: { ok: true, rows: [row(good, { status: "voided" })] } }), "ledger_voided"), "a voided file refused");
  const up = chk(good, { ledgerMatches: { ok: true, rows: [row(good, { status: "uploaded" })] } });
  ok(has(up, "ledger_already") && up.problems.some((x) => x.message.includes("9. No they should not")), "an uploaded file refused, quoting Brenda");
  ok(has(chk(good, { ledgerMatches: { ok: true, rows: [row(good, { status: "bank_approved" })] } }), "ledger_already"), "a bank-approved file refused");
  ok(has(chk(good, { ledgerMatches: { ok: true, rows: [row(good, { kind: "vendor" })] } }), "ledger_kind"), "a ledger kind that disagrees refused");

  // Limits (S4), without counting itself.
  const self: LedgerFileForLimits = { id: "f1", kind: "payroll", status: "released", fileDate: today, effectiveDate: "2026-10-08", settlementDate: null, totalCents: 62_345 };
  ok(chk(good, { limitsLedger: { ok: true, ledger: [self] } }).ok, "its own ledger row is not counted twice");
  const big: LedgerFileForLimits = { id: "f2", kind: "payroll", status: "released", fileDate: today, effectiveDate: "2026-10-08", settlementDate: null, totalCents: 4_950_000 };
  ok(has(chk(good, { limitsLedger: { ok: true, ledger: [self, big] } }), "limit_daily"), "another file pushing the day over $50,000 refused");
  ok(chk(good, { limitsLedger: { ok: true, ledger: [{ ...big, totalCents: 4_000_000 }] } }).warnings.some((w) => w.rule === "limit"), "at 80% of the daily limit: warned");
  const huge = build({ entries: [{ amountCents: 5_000_001 }] });
  ok(has(chk(huge, { ledgerMatches: { ok: true, rows: [row(huge)] } }), "limit_entry"), "one payment over $50,000 refused");
  ok(has(chk(good, { limitsLedger: { ok: false, error: "down" } }), "limits_unreadable"), "unreadable limits refused, never assumed");
  ok(!has(chk(pre, { ledgerMatches: { ok: true, rows: [row(pre, { kind: "prenote" })] }, limitsLedger: { ok: true, ledger: [big, { ...big, id: "f3" }] } }), "limit_daily"), "a prenote does not count toward the limits");

  return { passed, failed };
}
