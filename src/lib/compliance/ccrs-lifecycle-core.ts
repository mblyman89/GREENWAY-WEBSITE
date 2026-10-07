/**
 * src/lib/compliance/ccrs-lifecycle-core.ts — CCRS Bible v2 slice S-12c. PURE.
 *
 * Everything the hub needs between the operator and the 0249 functions, with
 * no I/O and no clock (every "now" is passed in):
 *
 *   ccrsPortalUrl          the portal of each env (PREprod is a different host)
 *   parseSuccessEmails     file name (token stripped) + "Date Submitted" of
 *                          every success notice in a paste
 *   matchSuccessNames      which uploaded files a success paste answers
 *   pacificLocalToUtcISO   <input type="datetime-local"> (Pacific) -> UTC ISO
 *   pacificLocalInputValue an instant -> the value that input expects
 *   decodeMarkUploaded / decodeOutcome / decodeAbandon / decodePreprodStart
 *                          strict decoders of the 0249 answers (a garbled
 *                          answer throws; the ledger is never guessed at)
 *   lifecycleErrorText     a 0249 exception -> what the operator should do
 *
 * Evidence used:
 *   - Success notice body, verbatim (2026-09-17, 10 of 10; 2026-10-06, 28):
 *     "The file Strain_413541_20250615213000_2026917T1252497.csv you submitted
 *      has been processed. Date Submitted: 9/17/2026 12:52:20 PM"
 *     The "Date Submitted" is the upload time, Pacific wall clock (12:52:20 PM
 *     submitted, notice received 12:53 PM).
 *   - PREprod portal https://precannabisreporting.lcb.wa.gov (every PREprod
 *     run so far); production https://cannabisreporting.lcb.wa.gov [G], the
 *     same constant as excise-payment-core CCRS_PORTAL_URL.
 */

import { pacificParts, pacificWallTimeToUtcISO } from "../reports/timezone";
import type { LedgerEnv } from "./ccrs-ledger-core";
import { successEmailFileNames } from "./ccrs-outcome-core";

export const CCRS_PORTAL_URLS: Readonly<Record<LedgerEnv, string>> = {
  prod: "https://cannabisreporting.lcb.wa.gov/",
  preprod: "https://precannabisreporting.lcb.wa.gov/",
};
export function ccrsPortalUrl(env: LedgerEnv): string {
  return CCRS_PORTAL_URLS[env];
}

/* ------------------------------------------------------------------ *
 * Pacific wall clock <-> UTC for <input type="datetime-local">.
 * ------------------------------------------------------------------ */
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * "2026-10-07T13:05" (Pacific) -> "2026-10-07T20:05:00.000Z". Returns null for
 * anything that is not a real calendar date and time (2026-02-30, 24:00, ...).
 */
export function pacificLocalToUtcISO(value: string): string | null {
  const m = LOCAL_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "00"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  return pacificWallTimeToUtcISO(`${m[1]}-${m[2]}-${m[3]}`, { h, m: mi, s, ms: 0 });
}

/** An instant as the value a datetime-local input shows, Pacific wall clock, to the minute. */
export function pacificLocalInputValue(at: Date): string {
  const p = pacificParts(at);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

/* ------------------------------------------------------------------ *
 * Success notices.
 * ------------------------------------------------------------------ */
export type SuccessNotice = {
  /** Our file name: the CCRS receipt token removed. */
  fileName: string;
  /** "Date Submitted" as UTC ISO, or null when the paste does not carry it. */
  submittedAt: string | null;
};

const SUBMITTED_RE = /Date Submitted:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)/i;

/**
 * Every success notice in a paste (one or many emails), in order, each name
 * once. The "Date Submitted" read is the one that follows that file's name
 * and comes before the next file name; a mangled date gives null, never a
 * guess.
 */
export function parseSuccessEmails(pasted: string): SuccessNotice[] {
  const names = successEmailFileNames(pasted);
  const nameRe = /\b((?:Strain|Area|Product|Inventory|InventoryAdjustment|InventoryTransfer|Sale)_\d+_\d{14})(?:_[0-9A-Za-z]+)?\.csv\b/g;
  const hits = [...pasted.matchAll(nameRe)].map((m) => ({ name: `${m[1]}.csv`, at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  return names.map((fileName) => {
    const i = hits.findIndex((h) => h.name === fileName);
    const from = hits[i].end;
    const to = i + 1 < hits.length ? hits[i + 1].at : pasted.length;
    const m = SUBMITTED_RE.exec(pasted.slice(from, to));
    let submittedAt: string | null = null;
    if (m) {
      const [mo, d, y, h12, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
      const pm = m[7].toUpperCase() === "PM";
      if (h12 >= 1 && h12 <= 12) {
        const h = (h12 % 12) + (pm ? 12 : 0);
        const z = (n: number) => String(n).padStart(2, "0");
        submittedAt = pacificLocalToUtcISO(`${y}-${z(mo)}-${z(d)}T${z(h)}:${z(mi)}:${z(s)}`);
      }
    }
    return { fileName, submittedAt };
  });
}

export type LedgerFileLite = { id: string; fileName: string; state: string; uploadedAt: string | null; stampAt: string | null };
export type SuccessMatch = {
  /** Files to record as succeeded, earliest stamp first. */
  record: { id: string; fileName: string; submittedAt: string | null; uploadedAt: string }[];
  /** Named in the paste but not a file of this env at all. */
  unknown: string[];
  /** A file of this env, but not waiting for an answer (state given). */
  notWaiting: { fileName: string; state: string }[];
  /** Uploaded time we recorded and CCRS's "Date Submitted" differ by more than 15 minutes. */
  timeMismatch: { fileName: string; ours: string; theirs: string }[];
};

/** Minutes of tolerance between the recorded upload time and CCRS's "Date Submitted". */
export const UPLOAD_TIME_TOLERANCE_MINUTES = 15;

export function matchSuccessNames(notices: readonly SuccessNotice[], files: readonly LedgerFileLite[]): SuccessMatch {
  const byName = new Map(files.map((f) => [f.fileName, f]));
  const out: SuccessMatch = { record: [], unknown: [], notWaiting: [], timeMismatch: [] };
  for (const n of notices) {
    const f = byName.get(n.fileName);
    if (!f) out.unknown.push(n.fileName);
    else if (f.state !== "uploaded" || !f.uploadedAt) out.notWaiting.push({ fileName: f.fileName, state: f.state });
    else {
      out.record.push({ id: f.id, fileName: f.fileName, submittedAt: n.submittedAt, uploadedAt: f.uploadedAt });
      if (n.submittedAt && Math.abs(Date.parse(n.submittedAt) - Date.parse(f.uploadedAt)) > UPLOAD_TIME_TOLERANCE_MINUTES * 60_000) {
        out.timeMismatch.push({ fileName: f.fileName, ours: f.uploadedAt, theirs: n.submittedAt });
      }
    }
  }
  const stamp = (id: string) => byName.get(out.record.find((r) => r.id === id)!.fileName)!.stampAt ?? "";
  out.record.sort((a, b) => (stamp(a.id) < stamp(b.id) ? -1 : stamp(a.id) > stamp(b.id) ? 1 : 0));
  return out;
}

/* ------------------------------------------------------------------ *
 * Strict decoders of the 0249 answers.
 * ------------------------------------------------------------------ */
export class CcrsLifecycleAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CcrsLifecycleAnswerError";
  }
}
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;
function need(cond: unknown, fn: string, what: string): asserts cond {
  if (!cond) throw new CcrsLifecycleAnswerError(`${fn}: unexpected answer (${what})`);
}

export type MarkUploadedAnswer = { id: string; fileName: string; overridden: boolean; waitingOn: string[] };
export function decodeMarkUploaded(fileId: string, data: unknown): MarkUploadedAnswer {
  const fn = "ccrs_mark_uploaded";
  need(isObj(data), fn, "not an object");
  need(data.id === fileId, fn, "another file id");
  need(data.state === "uploaded", fn, "state is not uploaded");
  need(typeof data.file_name === "string" && data.file_name !== "", fn, "no file name");
  need(typeof data.overridden === "boolean", fn, "overridden");
  need(Array.isArray(data.waiting_on) && data.waiting_on.every((w) => typeof w === "string"), fn, "waiting_on");
  need(data.overridden === (data.waiting_on as string[]).length > 0, fn, "overridden disagrees with waiting_on");
  return { id: fileId, fileName: data.file_name as string, overridden: data.overridden as boolean, waitingOn: data.waiting_on as string[] };
}

export const OUTCOME_FINAL_STATES: Readonly<Record<string, readonly string[]>> = {
  success: ["succeeded", "closed"],
  "error-benign": ["succeeded", "closed"],
  "error-rows": ["errored", "closed"],
  "error-fatal": ["closed"],
  "error-unmatched": ["reconciling"],
  "no-email": ["reconciling"],
};
export type OutcomeAnswer = {
  id: string;
  fileName: string;
  outcome: string;
  state: string;
  rows: { total: number; rejected: number; uncertain: number; landed: number };
  earlierFilesClosed: number;
};
export function decodeOutcome(fileId: string, outcome: string, data: unknown): OutcomeAnswer {
  const fn = "ccrs_record_outcome";
  need(isObj(data), fn, "not an object");
  need(data.id === fileId, fn, "another file id");
  need(data.outcome === outcome, fn, "another outcome");
  need(typeof data.file_name === "string" && data.file_name !== "", fn, "no file name");
  need(typeof data.state === "string" && (OUTCOME_FINAL_STATES[outcome] ?? []).includes(data.state), fn, `state ${String(data.state)} after ${outcome}`);
  const r = data.rows;
  need(isObj(r) && isInt(r.total) && isInt(r.rejected) && isInt(r.uncertain) && isInt(r.landed), fn, "row counts");
  need(r.rejected + r.uncertain + r.landed <= r.total, fn, "row counts exceed the total");
  need(isInt(data.earlier_files_closed), fn, "earlier_files_closed");
  if (outcome === "error-fatal") need(r.landed === 0, fn, "a fatal file landed rows");
  if (outcome === "error-unmatched" || outcome === "no-email") need(r.landed === 0, fn, "an unproven file landed rows");
  return {
    id: fileId,
    fileName: data.file_name as string,
    outcome,
    state: data.state as string,
    rows: { total: r.total, rejected: r.rejected, uncertain: r.uncertain, landed: r.landed },
    earlierFilesClosed: data.earlier_files_closed as number,
  };
}

export function decodeAbandon(fileId: string, data: unknown): { id: string; fileName: string } {
  const fn = "ccrs_abandon_file";
  need(isObj(data) && data.id === fileId && data.state === "abandoned" && typeof data.file_name === "string", fn, "shape");
  return { id: fileId, fileName: data.file_name as string };
}

export function decodePreprodStart(data: unknown): { status: "started" | "already"; id: string } {
  const fn = "ccrs_preprod_ledger_start";
  need(isObj(data) && (data.status === "started" || data.status === "already") && typeof data.id === "string" && data.id !== "", fn, "shape");
  return { status: data.status as "started" | "already", id: data.id as string };
}

/* ------------------------------------------------------------------ *
 * 0249 exceptions -> operator text.
 * ------------------------------------------------------------------ */
const HINTS: Readonly<Record<string, string>> = {
  CCRS_FILE_NOT_FOUND: "That file is not in the CCRS outbox. Refresh the page.",
  CCRS_UPLOAD_NOT_EMITTED: "Only a file that is waiting to be uploaded can be marked uploaded. Refresh the page; it may already be recorded.",
  CCRS_UPLOAD_TIME: "The upload time must be after the file was made and not in the future. Check the time you entered (Pacific).",
  CCRS_UPLOAD_BYTES_CHANGED: "STOP: the stored file no longer matches what was handed out. Do not upload it. Tell the developer.",
  CCRS_UPLOAD_NOT_READY: "Upload files one at a time, in order: record the answer for the earlier file first (or abandon it). To go ahead anyway, type a reason of 10 or more characters.",
  CCRS_OUTCOME_NOT_UPLOADED: "Mark the file uploaded first. An answer can be recorded only once.",
  CCRS_OUTCOME_TIME: "The email time must be after the upload time and not in the future. Check the time you entered (Pacific).",
  CCRS_OUTCOME_SLA_NOT_REACHED: "\"No email\" can be declared only 60 minutes after the upload. Check spam and wait.",
  CCRS_OUTCOME_NO_MESSAGES: "An error answer needs the CCRS error file pasted in.",
  CCRS_OUTCOME_BAD_REJECTED: "The error file could not be tied to this file's rows. Paste the whole CSV, header first.",
  CCRS_OUTCOME_BAD: "Unknown answer type.",
  CCRS_ABANDON_NOT_EMITTED: "Only a file that was never uploaded can be abandoned.",
  CCRS_ABANDON_REASON: "Give a reason of 10 or more characters.",
  CCRS_PREPROD_START_BY: "Who started the PREprod ledger must be recorded.",
};
export function lifecycleErrorText(raw: string): string {
  const m = /\b(CCRS_[A-Z_]+)\b:?\s*([\s\S]*)$/.exec(raw);
  if (!m) return raw;
  const hint = HINTS[m[1]];
  return hint ? `${hint} (${m[2].trim() || m[1]})` : raw;
}

/* ------------------------------------------------------------------ *
 * What a state means to the operator.
 * ------------------------------------------------------------------ */
export const FILE_STATE_TEXT: Readonly<Record<string, string>> = {
  draft: "Draft (never handed out)",
  emitted: "Ready: upload it, then mark it uploaded",
  uploaded: "Uploaded: waiting for the CCRS email",
  succeeded: "Accepted by CCRS (rows filed; closes when a later file proves them)",
  errored: "Some rows refused: fix them, they go in the next export",
  reconciling: "Unknown result: request a Service Desk copy to settle it",
  closed: "Done",
  abandoned: "Abandoned (never uploaded)",
};

export function __runCcrsLifecycleCoreTests(): void {
  const assert = (c: unknown, m: string) => {
    if (!c) throw new Error("ccrs-lifecycle-core: " + m);
  };
  const throws = (f: () => unknown) => {
    try {
      f();
      return false;
    } catch (e) {
      return e instanceof CcrsLifecycleAnswerError;
    }
  };
  assert(ccrsPortalUrl("preprod") === "https://precannabisreporting.lcb.wa.gov/", "preprod url");
  assert(ccrsPortalUrl("prod") === "https://cannabisreporting.lcb.wa.gov/", "prod url");
  // PDT (UTC-7) and PST (UTC-8)
  assert(pacificLocalToUtcISO("2026-10-07T13:05") === "2026-10-07T20:05:00.000Z", "PDT");
  assert(pacificLocalToUtcISO("2026-12-01T09:00") === "2026-12-01T17:00:00.000Z", "PST");
  assert(pacificLocalToUtcISO("2026-02-30T09:00") === null, "no Feb 30");
  assert(pacificLocalToUtcISO("2026-10-07 13:05") === null, "needs the T");
  assert(pacificLocalToUtcISO("2026-10-07T24:00") === null, "no hour 24");
  assert(pacificLocalToUtcISO("2026-13-01T09:00") === null, "no month 13");
  assert(pacificLocalToUtcISO("2026-02-29T09:00") === null, "2026 is not a leap year");
  assert(pacificLocalToUtcISO("2028-02-29T09:00") === "2028-02-29T17:00:00.000Z", "2028 is");
  assert(pacificLocalInputValue(new Date("2026-10-07T20:05:30Z")) === "2026-10-07T13:05", "input value");
  // verbatim 2026-09-17 notice
  const n = parseSuccessEmails(
    "The file Strain_413541_20250615213000_2026917T1252497.csv you submitted has been processed. Date Submitted:\n     9/17/2026 12:52:20 PM For assistance\n" +
      "The file Area_413541_20250615213000_2026917T1258161.csv you submitted has been processed. Date Submitted:\n 9/17/2026 12:58:04 PM",
  );
  assert(n.length === 2 && n[0].fileName === "Strain_413541_20250615213000.csv", "names");
  assert(n[0].submittedAt === "2026-09-17T19:52:20.000Z" && n[1].submittedAt === "2026-09-17T19:58:04.000Z", "date submitted read per file");
  assert(parseSuccessEmails("The file Area_413541_20261007120001_X1.csv you submitted")[0].submittedAt === null, "no date -> null");
  const steal = parseSuccessEmails(
    "The file Area_413541_20261007120001_X1.csv you submitted has been processed.\nThe file Strain_413541_20261007120002_X2.csv you submitted has been processed. Date Submitted: 10/7/2026 1:00:00 PM",
  );
  assert(steal[0].submittedAt === null && steal[1].submittedAt === "2026-10-07T20:00:00.000Z", "a file never takes the next file's date");
  // 12 AM / 12 PM
  assert(parseSuccessEmails("Sale_413541_20261007120001_X.csv Date Submitted: 10/7/2026 12:10:00 AM")[0].submittedAt === "2026-10-07T07:10:00.000Z", "12 AM is 00h");
  // match
  const files: LedgerFileLite[] = [
    { id: "b", fileName: "Area_413541_20261007120001.csv", state: "uploaded", uploadedAt: "2026-10-07T19:00:00.000Z", stampAt: "2026-10-07T19:00:01Z" },
    { id: "a", fileName: "Strain_413541_20261007120000.csv", state: "uploaded", uploadedAt: "2026-10-07T18:00:00.000Z", stampAt: "2026-10-07T19:00:00Z" },
    { id: "c", fileName: "Product_413541_20261007120002.csv", state: "closed", uploadedAt: "2026-10-07T19:00:00.000Z", stampAt: "2026-10-07T19:00:02Z" },
  ];
  const mm = matchSuccessNames(
    [
      { fileName: "Area_413541_20261007120001.csv", submittedAt: "2026-10-07T19:01:00.000Z" },
      { fileName: "Strain_413541_20261007120000.csv", submittedAt: "2026-10-07T19:00:00.000Z" },
      { fileName: "Product_413541_20261007120002.csv", submittedAt: null },
      { fileName: "Sale_413541_20261007120009.csv", submittedAt: null },
    ],
    files,
  );
  assert(mm.record.map((r) => r.id).join() === "a,b", "earliest stamp first");
  assert(mm.unknown.join() === "Sale_413541_20261007120009.csv" && mm.notWaiting[0].state === "closed", "unknown + not waiting");
  assert(mm.timeMismatch.length === 1 && mm.timeMismatch[0].fileName.startsWith("Strain"), "60 min apart flagged, 1 min not");
  // decoders
  assert(decodeMarkUploaded("x", { id: "x", file_name: "f", state: "uploaded", overridden: false, waiting_on: [] }).fileName === "f", "mark ok");
  assert(throws(() => decodeMarkUploaded("x", { id: "x", file_name: "f", state: "uploaded", overridden: false, waiting_on: ["a"] })), "override flag must agree");
  const ok = { id: "x", file_name: "f", outcome: "error-rows", state: "errored", rows: { total: 8, rejected: 3, uncertain: 0, landed: 5 }, earlier_files_closed: 0 };
  assert(decodeOutcome("x", "error-rows", ok).rows.landed === 5, "outcome ok");
  assert(throws(() => decodeOutcome("x", "success", ok)), "another outcome");
  assert(throws(() => decodeOutcome("x", "success", { ...ok, state: "closed" })), "another outcome even when the state would fit");
  assert(throws(() => decodeOutcome("x", "error-rows", { ...ok, state: "closed2" })), "bad state");
  assert(throws(() => decodeOutcome("x", "error-rows", { ...ok, rows: { total: 2, rejected: 3, uncertain: 0, landed: 0 } })), "counts > total");
  assert(throws(() => decodeOutcome("x", "error-fatal", { ...ok, outcome: "error-fatal", state: "closed" })), "fatal cannot land rows");
  assert(throws(() => decodeAbandon("x", { id: "x", file_name: "f", state: "emitted" })), "abandon state");
  assert(decodePreprodStart({ status: "already", id: "z" }).status === "already", "start");
  assert(lifecycleErrorText("CCRS_UPLOAD_NOT_READY: settle these first: A (emitted)").startsWith("Upload files one at a time"), "hint");
  assert(lifecycleErrorText("boom") === "boom", "unknown text passes through");
  console.log("ccrs-lifecycle-core: all tests passed");
}
