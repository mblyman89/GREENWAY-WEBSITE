/**
 * ccrs-copy-verify-core.ts - CCRS Bible v2 Part 17 §G (G-3) / Part 09, slice S-16:
 * COPY DIFF VERIFIER. PURE (no clock, no database, no network, no node: imports).
 *
 * The examiner's advice: "after the initial uploads, recommendation is to reach
 * out for a copy of what was submitted to check for accuracy" [EXAM L0568].
 * This module answers one question with no guess: for every Inventory /
 * Product / Strain / Area record our files SENT and CCRS ANSWERED as landed,
 * does the LCB copy hold exactly what we sent?
 *
 *   - "What we sent" is read from ccrs_file_rows (0247/0248): the exact
 *     column -> value pairs of each row, its row state, and its file's state.
 *   - "What CCRS holds" is the copy, read by the same delivery reader as the
 *     S-12 seed and the S-15 re-seed (buildLedgerSeed).
 *
 * Every record lands in exactly one bucket:
 *   verified, mismatched, zeroedNotZero, missing, deletedPresent,
 *   copyConflict, notJudged (uncertain / unanswered / too new for this copy).
 *
 * Read-only: nothing here writes anywhere. A difference is REPORTED with the
 * exact bytes on both sides (JSON-escaped), never "fixed".
 *
 * What is NOT compared, and why (written in the report too):
 *   - Area on an Inventory row: the delivery's Inventory report has no Area column.
 *   - CreatedBy / UpdatedBy / UpdatedDate: who CCRS records as the author is not
 *     documented; comparing them would be a guess.
 *   - InventoryCategory (Product): not in the delivery's Product report.
 *   - Sales, adjustments, transfers: the delivery has no such files.
 *   - QuantityOnHand after later Sale/Adjustment rows: whether CCRS changes a
 *     lot's stored QoH from those rows is not documented (U-68). A QoH
 *     difference is still reported, with the count of later event rows, so a
 *     person can judge it.
 */
import { buildLedgerSeed, type SeedEntity, type SeedSource } from "./ccrs-ledger-seed-core";
import { parseDecimal } from "./ccrs-control-totals-core";

/* ------------------------------------------------------------------ *
 * Types, errors
 * ------------------------------------------------------------------ */

export class CopyVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopyVerifyError";
  }
}

export const VERIFY_TYPES: readonly SeedSource[] = ["Inventory", "Product", "Strain", "Area"];

/** One row we sent, as SENT_READ_SQL returns it (one JSON object per line). */
export type SentLine = {
  t: SeedSource;
  id: string;
  /** Insert / Update / Delete; null for Strain (the Strain file has no Operation column). */
  op: string | null;
  rowState: string;
  fileState: string;
  file: string;
  /** stamp_at of the file, integer microseconds since the epoch (text). */
  stampUs: string;
  /** uploaded_at of the file, integer microseconds since the epoch (text); null if never uploaded. */
  uploadedUs: string | null;
  rowNo: number;
  payload: Record<string, string>;
  /** Inventory only: landed Sale / InventoryAdjustment rows naming this lot in answered files stamped later. */
  eventsAfter: number;
};

export const BUCKETS = [
  "verified",
  "mismatched",
  "zeroedNotZero",
  "missing",
  "deletedPresent",
  "copyConflict",
  "notJudgedUncertain",
  "notJudgedUnanswered",
  "notJudgedTooNew",
] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Problem buckets: any of these makes the verifier exit 1. */
export const PROBLEM_BUCKETS: readonly Bucket[] = ["mismatched", "zeroedNotZero", "missing", "deletedPresent"];

export const BUCKET_MEANING: Record<Bucket, string> = {
  verified: "CCRS holds exactly what our last landed row sent (every compared field).",
  mismatched: "CCRS holds the record, but at least one compared field differs from what we sent.",
  zeroedNotZero: "We sent QuantityOnHand 0 (a closing or equalize Update) and CCRS still shows a quantity.",
  missing: "We sent an Insert or Update that CCRS answered as landed, but the copy does not hold the record.",
  deletedPresent: "We sent a Delete that CCRS answered as landed, but the copy still holds the record.",
  copyConflict: "The copy lists this id more than once with different values; it cannot be judged.",
  notJudgedUncertain: "Our last row for it is 'uncertain' (no answer proves whether it landed). S-15 settles these.",
  notJudgedUnanswered: "Our last row for it is in a file CCRS has not answered yet.",
  notJudgedTooNew: "Our last row for it was uploaded on or after the copy's date, so the copy may not include it.",
};

export type FieldDiff = { field: string; sent: string; stored: string };

export type VerifyItem = {
  t: SeedSource;
  id: string;
  bucket: Bucket;
  file: string;
  op: string;
  diffs: FieldDiff[];
  notes: string[];
};

export type VerifyCounts = {
  sentRecords: number;
  byType: Record<SeedSource, Record<Bucket, number>>;
  total: Record<Bucket, number>;
};

export type VerifyResult = {
  asOf: string;
  items: VerifyItem[];
  counts: VerifyCounts;
  problems: number;
};

/* ------------------------------------------------------------------ *
 * SQL (read-only)
 * ------------------------------------------------------------------ */

/**
 * Every row of every production Inventory / Product / Strain / Area file that
 * left the building (uploaded or later; never draft, emitted-only or
 * abandoned; never the seed provenance pseudo-files, which hold no rows). One JSON object per line. Times are integer microseconds so the
 * result does not depend on the session's DateStyle or TimeZone.
 */
export const SENT_READ_SQL =
  "with ev as (select er.payload->>'InventoryExternalIdentifier' as lot, array_agg(ef.stamp_at) as stamps " +
  "from public.ccrs_file_rows er join public.ccrs_files ef on ef.id = er.file_id " +
  "where ef.env = 'prod' and ef.file_type in ('Sale', 'InventoryAdjustment') " +
  "and ef.state in ('succeeded', 'errored', 'reconciling', 'closed') and er.state in ('submitted', 'confirmed') group by 1) " +
  "select json_build_object('t', f.file_type, 'id', r.external_id, 'op', r.operation, 'rowState', r.state, 'fileState', f.state, " +
  "'file', f.file_name, 'stampUs', (extract(epoch from f.stamp_at) * 1000000)::bigint::text, " +
  "'uploadedUs', (extract(epoch from f.uploaded_at) * 1000000)::bigint::text, 'rowNo', r.row_no, 'payload', r.payload, " +
  "'eventsAfter', coalesce((select count(*) from unnest(ev.stamps) s where s > f.stamp_at), 0)) " +
  "from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id " +
  "left join ev on f.file_type = 'Inventory' and ev.lot = r.external_id " +
  "where f.env = 'prod' and f.purpose <> 'seed' and f.file_type in ('Inventory', 'Product', 'Strain', 'Area') " +
  "and f.state in ('uploaded', 'succeeded', 'errored', 'reconciling', 'closed') " +
  "order by f.file_type, r.external_id collate \"C\", f.stamp_at, r.row_no;";

const ROW_STATES = ["planned", "emitted", "submitted", "confirmed", "rejected", "uncertain", "withheld"];
const SENT_FILE_STATES = ["uploaded", "succeeded", "errored", "reconciling", "closed"];
const INT_RE = /^-?\d{1,19}$/;

/** Validate and decode one sent line (never trust a shape). */
export function parseSentLine(line: string): SentLine {
  let o: unknown;
  try { o = JSON.parse(line); } catch { throw new CopyVerifyError(`sent line is not JSON: ${line.slice(0, 80)}`); }
  const r = o as Record<string, unknown>;
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new CopyVerifyError(`sent line is not an object: ${line.slice(0, 80)}`);
  const s = (k: string) => typeof r[k] === "string";
  if (!s("t") || !(VERIFY_TYPES as readonly string[]).includes(r.t as string)) throw new CopyVerifyError(`sent line has file type ${JSON.stringify(r.t)}`);
  if (!s("id") || r.id === "") throw new CopyVerifyError("sent line has no id");
  if (!(r.op === null || r.op === "Insert" || r.op === "Update" || r.op === "Delete")) throw new CopyVerifyError(`sent line ${String(r.id)} has operation ${JSON.stringify(r.op)}`);
  if (!s("rowState") || !ROW_STATES.includes(r.rowState as string)) throw new CopyVerifyError(`sent line ${String(r.id)} has row state ${JSON.stringify(r.rowState)}`);
  if (!s("fileState") || !SENT_FILE_STATES.includes(r.fileState as string)) throw new CopyVerifyError(`sent line ${String(r.id)} has file state ${JSON.stringify(r.fileState)}`);
  if (!s("file") || r.file === "") throw new CopyVerifyError(`sent line ${String(r.id)} has no file name`);
  if (!s("stampUs") || !INT_RE.test(r.stampUs as string)) throw new CopyVerifyError(`sent line ${String(r.id)} has stamp ${JSON.stringify(r.stampUs)}; expected integer microseconds`);
  if (!(r.uploadedUs === null || (s("uploadedUs") && INT_RE.test(r.uploadedUs as string)))) throw new CopyVerifyError(`sent line ${String(r.id)} has upload time ${JSON.stringify(r.uploadedUs)}`);
  if (typeof r.rowNo !== "number" || !Number.isInteger(r.rowNo) || r.rowNo < 1) throw new CopyVerifyError(`sent line ${String(r.id)} has row number ${JSON.stringify(r.rowNo)}`);
  if (typeof r.eventsAfter !== "number" || !Number.isInteger(r.eventsAfter) || r.eventsAfter < 0) throw new CopyVerifyError(`sent line ${String(r.id)} has eventsAfter ${JSON.stringify(r.eventsAfter)}`);
  const p = r.payload;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.values(p as object).some((v) => typeof v !== "string")) throw new CopyVerifyError(`sent line ${String(r.id)} has a payload that is not text pairs`);
  return r as unknown as SentLine;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The copy's date: a real YYYY-MM-DD. Rows uploaded at or after 00:00 UTC of it are "too new" (the S-15 rule). */
export function asOfCutoffUs(asOf: string): bigint {
  const m = ISO_RE.exec(asOf);
  if (!m) throw new CopyVerifyError(`--as-of must be YYYY-MM-DD (got ${JSON.stringify(asOf)})`);
  const ms = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== asOf) throw new CopyVerifyError(`--as-of ${asOf} is not a real date`);
  return BigInt(ms) * BigInt(1000);
}

/** Equal as numbers (10 = 10.00); unreadable on either side is NOT equal. */
export function sameNumber(a: string, b: string): boolean {
  let x, y;
  try { x = parseDecimal(a, "a"); y = parseDecimal(b, "b"); } catch { return false; }
  const s = Math.max(x.scale, y.scale);
  const ten = BigInt(10);
  return x.n * ten ** BigInt(s - x.scale) === y.n * ten ** BigInt(s - y.scale);
}

/** M/D/YYYY or MM/DD/YYYY -> YYYY-MM-DD, or null. */
export function ccrsDay(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = Number(m[3]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > last) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const lc = (s: string) => s.toLowerCase();

/* ------------------------------------------------------------------ *
 * The verifier
 * ------------------------------------------------------------------ */

type CopyIndex = {
  byKey: Map<string, SeedEntity>;
  strainFold: Map<string, string[]>;
};

function indexCopy(copy: readonly SeedEntity[]): CopyIndex {
  const byKey = new Map<string, SeedEntity>();
  const strainFold = new Map<string, string[]>();
  for (const e of copy) {
    const k = `${e.fileType}\u0000${e.externalId}`;
    if (byKey.has(k)) throw new CopyVerifyError(`copy has ${e.fileType} ${e.externalId} twice after collapsing`);
    byKey.set(k, e);
    if (e.fileType === "Strain") {
      const f = lc(e.externalId);
      const g = strainFold.get(f);
      if (g) g.push(e.externalId); else strainFold.set(f, [e.externalId]);
    }
  }
  return { byKey, strainFold };
}

function compareInventory(sent: SentLine, c: SeedEntity, ix: CopyIndex): { diffs: FieldDiff[]; notes: string[]; zeroedNotZero: boolean } {
  const p = sent.payload;
  const q = c.seedPayload;
  const diffs: FieldDiff[] = [];
  const notes: string[] = [];
  const d = (field: string, s: string | undefined, st: string | undefined) => diffs.push({ field, sent: s ?? "", stored: st ?? "" });
  if ((p.LicenseNumber ?? "") !== (q["License Number"] ?? "")) d("LicenseNumber", p.LicenseNumber, q["License Number"]);
  const ss = p.Strain ?? "";
  const cs = q.Strain ?? "";
  if (ss !== cs) {
    if (lc(ss) === lc(cs)) notes.push(`Strain differs only in letter case: sent ${JSON.stringify(ss)}, stored ${JSON.stringify(cs)} (U-45b)`);
    else d("Strain", ss, cs);
  }
  // Product: our row names the product by NAME; the copy's lot names it by id.
  // The copy's own Product report gives that id's name (Part 04 §A.5: the
  // Inventory report's "Product Name" column is the Description, never the name).
  const pid = q["Product Identifier"] ?? "";
  const prod = ix.byKey.get(`Product\u0000${pid}`);
  const storedName = prod ? (prod.seedConflicts ? null : prod.filedName ?? "") : null;
  if (storedName === null) d("Product", p.Product, prod ? `(Product ${pid} is listed more than once in the copy)` : `(Product ${pid} is not in the copy's Product report)`);
  else if ((p.Product ?? "") !== storedName) d("Product", p.Product, storedName);
  if (!sameNumber(p.InitialQuantity ?? "", q["Initial Quantity"] ?? "")) d("InitialQuantity", p.InitialQuantity, q["Initial Quantity"]);
  let zeroedNotZero = false;
  if (!sameNumber(p.QuantityOnHand ?? "", q["Quantity on Hand"] ?? "")) {
    d("QuantityOnHand", p.QuantityOnHand, q["Quantity on Hand"]);
    if (sameNumber(p.QuantityOnHand ?? "", "0")) zeroedNotZero = true;
    if (sent.eventsAfter > 0) notes.push(`${sent.eventsAfter} landed Sale/Adjustment row(s) named this lot after our row; whether CCRS changes a stored QoH from them is not documented (U-68)`);
  }
  if (!sameNumber(p.TotalCost ?? "", q.TotalCost ?? "")) d("TotalCost", p.TotalCost, q.TotalCost);
  if (lc(p.IsMedical ?? "") !== lc(q.IsMedical ?? "")) d("IsMedical", p.IsMedical, q.IsMedical);
  const sd = ccrsDay(p.CreatedDate ?? "");
  const cd = ccrsDay(q.CreatedDate ?? "");
  if (sd === null || cd === null || sd !== cd) d("CreatedDate", p.CreatedDate, q.CreatedDate);
  return { diffs, notes, zeroedNotZero };
}

function compareProduct(sent: SentLine, c: SeedEntity): FieldDiff[] {
  const p = sent.payload;
  const q = c.seedPayload;
  const diffs: FieldDiff[] = [];
  if ((p.Name ?? "") !== (q.Name ?? "")) diffs.push({ field: "Name", sent: p.Name ?? "", stored: q.Name ?? "" });
  if ((p.Description ?? "") !== (q.Description ?? "")) diffs.push({ field: "Description", sent: p.Description ?? "", stored: q.Description ?? "" });
  if ((p.InventoryType ?? "") !== (q.Inventorytype ?? "")) diffs.push({ field: "InventoryType", sent: p.InventoryType ?? "", stored: q.Inventorytype ?? "" });
  if (!sameNumber(p.UnitWeightGrams ?? "", q.UnitWeightGrams ?? "")) diffs.push({ field: "UnitWeightGrams", sent: p.UnitWeightGrams ?? "", stored: q.UnitWeightGrams ?? "" });
  return diffs;
}

function compareArea(sent: SentLine, c: SeedEntity): FieldDiff[] {
  const p = sent.payload;
  const q = c.seedPayload;
  const diffs: FieldDiff[] = [];
  if ((p.Area ?? "") !== (q.Name ?? "")) diffs.push({ field: "Area", sent: p.Area ?? "", stored: q.Name ?? "" });
  if (lc(p.IsQuarantine ?? "") !== lc(q.IsQuarantine ?? "")) diffs.push({ field: "IsQuarantine", sent: p.IsQuarantine ?? "", stored: q.IsQuarantine ?? "" });
  return diffs;
}

/** Order rows of one record: file stamp, then row number (both exact integers). */
function cmpRow(a: SentLine, b: SentLine): number {
  const x = BigInt(a.stampUs);
  const y = BigInt(b.stampUs);
  if (x !== y) return x < y ? -1 : 1;
  return a.rowNo - b.rowNo;
}

const byteCmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Judge every record our files sent against the copy.
 * Per record, only the LAST row that may have reached CCRS counts
 * (rejected and withheld rows never did, so they are skipped).
 */
export function verifyCopy(copy: readonly SeedEntity[], sent: readonly SentLine[], asOf: string): VerifyResult {
  const cutoff = asOfCutoffUs(asOf);
  const ix = indexCopy(copy);
  const groups = new Map<string, SentLine[]>();
  for (const l of sent) {
    const k = `${l.t}\u0000${l.id}`;
    const g = groups.get(k);
    if (g) g.push(l); else groups.set(k, [l]);
  }
  const items: VerifyItem[] = [];
  for (const [, rows] of groups) {
    const live = rows.filter((r) => r.rowState !== "rejected" && r.rowState !== "withheld" && r.rowState !== "planned" && r.rowState !== "emitted").sort(cmpRow);
    if (live.length === 0) continue; // nothing of ours ever reached CCRS for this id
    const last = live[live.length - 1];
    const op = last.op ?? "Insert";
    const base = { t: last.t, id: last.id, file: last.file, op, diffs: [] as FieldDiff[], notes: [] as string[] };
    if (last.rowState === "uncertain") { items.push({ ...base, bucket: "notJudgedUncertain" }); continue; }
    if (last.fileState === "uploaded") { items.push({ ...base, bucket: "notJudgedUnanswered" }); continue; }
    if (last.uploadedUs === null || BigInt(last.uploadedUs) >= cutoff) { items.push({ ...base, bucket: "notJudgedTooNew" }); continue; }

    let c = ix.byKey.get(`${last.t}\u0000${last.id}`);
    if (!c && last.t === "Strain") {
      const variants = ix.strainFold.get(lc(last.id)) ?? [];
      if (variants.length > 0) {
        base.notes.push(`the copy holds this strain only in another letter case: ${variants.map((v) => JSON.stringify(v)).join(", ")} (U-45b)`);
        c = variants.length === 1 ? ix.byKey.get(`Strain\u0000${variants[0]}`) : undefined;
        if (!c) { items.push({ ...base, bucket: op === "Delete" ? "deletedPresent" : "verified" }); continue; }
      }
    }
    if (op === "Delete") { items.push({ ...base, bucket: c ? "deletedPresent" : "verified" }); continue; }
    if (!c) { items.push({ ...base, bucket: "missing" }); continue; }
    if (c.seedConflicts) { items.push({ ...base, bucket: "copyConflict", notes: [...base.notes, `${c.seedConflicts.length} rows in the copy`] }); continue; }

    let diffs: FieldDiff[] = [];
    let zeroedNotZero = false;
    if (last.t === "Inventory") {
      const r = compareInventory(last, c, ix);
      diffs = r.diffs;
      base.notes.push(...r.notes);
      zeroedNotZero = r.zeroedNotZero;
    } else if (last.t === "Product") diffs = compareProduct(last, c);
    else if (last.t === "Area") diffs = compareArea(last, c);
    else if ((last.payload.StrainType ?? "") !== (c.seedPayload.StrainType ?? "")) diffs = [{ field: "StrainType", sent: last.payload.StrainType ?? "", stored: c.seedPayload.StrainType ?? "" }];
    const bucket: Bucket = zeroedNotZero ? "zeroedNotZero" : diffs.length ? "mismatched" : "verified";
    items.push({ ...base, diffs, bucket });
  }
  items.sort((a, b) => byteCmp(a.t, b.t) || byteCmp(a.id, b.id));
  const zero = () => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  const byType = Object.fromEntries(VERIFY_TYPES.map((t) => [t, zero()])) as Record<SeedSource, Record<Bucket, number>>;
  const total = zero();
  for (const it of items) { byType[it.t][it.bucket] += 1; total[it.bucket] += 1; }
  const problems = PROBLEM_BUCKETS.reduce((n, b) => n + total[b], 0);
  return { asOf, items, counts: { sentRecords: items.length, byType, total }, problems };
}

/** Read the four copy files with the S-12 delivery reader, then verify. */
export function verifyCopyTexts(texts: Record<SeedSource, string>, sent: readonly SentLine[], asOf: string): VerifyResult {
  return verifyCopy(buildLedgerSeed(texts).entities, sent, asOf);
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
const show = (s: string) => cell(JSON.stringify(s));

export function verifyReport(r: VerifyResult, limit = 500): string {
  const out: string[] = [];
  out.push(`# CCRS copy check (copy dated ${r.asOf})`, "");
  out.push(r.problems === 0
    ? "**Result: no problems.** Every record our files sent, and CCRS answered, that this copy could show is stored as sent (in every compared field)."
    : `**Result: ${r.problems} problem record(s).** Read each section below. Nothing was changed anywhere; this is a report.`, "");
  out.push(`Counts: \`${JSON.stringify(r.counts.total)}\``, "");
  out.push("| Bucket | What it means | Inventory | Product | Strain | Area | Total |", "|---|---|---|---|---|---|---|");
  for (const b of BUCKETS) out.push(`| ${b} | ${BUCKET_MEANING[b]} | ${VERIFY_TYPES.map((t) => r.counts.byType[t][b]).join(" | ")} | ${r.counts.total[b]} |`);
  out.push("");
  out.push("Not compared (and why): Area on lots (the copy's Inventory report has no Area column); CreatedBy / UpdatedBy / UpdatedDate (who CCRS records as the author is not documented); InventoryCategory (not in the copy's Product report); sales, adjustments and transfers (the copy has no such files). Values are shown in JSON quotes so every space, tab and quote is visible.", "");
  for (const b of BUCKETS) {
    if (b === "verified") continue;
    const list = r.items.filter((i) => i.bucket === b);
    if (!list.length) continue;
    out.push(`## ${b} (${list.length})`, "", BUCKET_MEANING[b], "", "| Type | Id | Our last file | Op | Differences | Notes |", "|---|---|---|---|---|---|");
    for (const i of list.slice(0, limit)) {
      const diffs = i.diffs.map((d) => `${d.field}: sent ${show(d.sent)}, stored ${show(d.stored)}`).join("; ");
      out.push(`| ${i.t} | ${show(i.id)} | ${cell(i.file)} | ${i.op} | ${diffs} | ${cell(i.notes.join("; "))} |`);
    }
    if (list.length > limit) out.push(`| … | ${list.length - limit} more not shown | | | | |`);
    out.push("");
  }
  const noted = r.items.filter((i) => i.bucket === "verified" && i.notes.length);
  if (noted.length) {
    out.push(`## verified, with a note (${noted.length})`, "", "| Type | Id | Notes |", "|---|---|---|");
    for (const i of noted.slice(0, limit)) out.push(`| ${i.t} | ${show(i.id)} | ${cell(i.notes.join("; "))} |`);
    out.push("");
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCcrsCopyVerifyCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => { if (c) passed += 1; else { failed += 1; console.error(`ccrs-copy-verify-core self-test FAILED: ${name}`); } };
  const H = ["License Number", "Strain", "Inventory Type", "Name", "Product Identifier", "Product Name", "IsMedical", "InventoryIdentifier (ExternalIdentifier on inventory.csv)", "Initial Quantity", "Quantity on Hand", "TotalCost", "CreatedBy", "CreatedDate", "Updatedby", "UpdatedDate"];
  const csv = (rows: string[][]) => rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
  const texts = {
    Inventory: csv([H, ["413541", "Blue Dream", "Usable Cannabis", "BD 1g", "P-1", "desc", "FALSE", "L1", "10", "4", "25.00", "Greenway Marijuana", "10/20/2026", "", ""]]),
    Product: csv([["Inventorytype", "Name", "Description", "UnitWeightGrams", "ExternalIdentifier", "CreatedBy", "CreatedDate", "UpdatedBy", "UpdatedDate", ""], ["Usable Cannabis", "BD 1g", "desc", "1", "P-1", "G", "10/20/2026", "", "", ""]]),
    Strain: csv([["StrainType", "Name", "CreatedBy", "CreatedDate", "UpdatedBy", "UpdatedDate"], ["Hybrid", "Blue Dream", "G", "10/20/2026", "", ""]]),
    Area: csv([["Name", "IsQuarantine", "ExternalIdentifier", "CreatedBy", "CreatedDate", "UpdatedBy", "UpdatedDate"], ["Sales Floor", "FALSE", "A-1", "G", "10/20/2026", "", ""]]),
  };
  const before = String(BigInt(Date.parse("2026-10-21T00:00:00Z")) * BigInt(1000));
  const line = (over: Partial<SentLine> & { payload?: Record<string, string> }): SentLine => ({
    t: "Inventory", id: "L1", op: "Insert", rowState: "submitted", fileState: "succeeded", file: "Inventory_413541_20261020120000.csv",
    stampUs: before, uploadedUs: before, rowNo: 1, eventsAfter: 0,
    payload: { LicenseNumber: "413541", Strain: "Blue Dream", Area: "Sales Floor", Product: "BD 1g", InitialQuantity: "10", QuantityOnHand: "4", TotalCost: "25", IsMedical: "False", ExternalIdentifier: "L1", CreatedDate: "10/20/2026", Operation: "Insert" },
    ...over,
  });
  const run = (sent: SentLine[]) => verifyCopyTexts(texts, sent, "2026-11-01");
  ok(run([line({})]).items[0].bucket === "verified", "same values (25 = 25.00, False = FALSE, 10/20 date) verify");
  ok(run([line({ payload: { ...line({}).payload, QuantityOnHand: "3" } })]).items[0].bucket === "mismatched", "a QoH difference is a mismatch");
  ok(run([line({ payload: { ...line({}).payload, QuantityOnHand: "0" } })]).items[0].bucket === "zeroedNotZero", "a zeroing row CCRS still shows open");
  ok(run([line({ id: "L9" })]).items[0].bucket === "missing", "a landed Insert the copy lacks is missing");
  ok(run([line({ op: "Delete" })]).items[0].bucket === "deletedPresent", "a landed Delete still present");
  ok(run([line({ id: "L9", op: "Delete" })]).items[0].bucket === "verified", "a landed Delete that is gone verifies");
  ok(run([line({ rowState: "rejected" })]).items.length === 0, "a rejected row never reached CCRS");
  ok(run([line({ rowState: "uncertain" })]).items[0].bucket === "notJudgedUncertain", "uncertain is not judged");
  ok(run([line({ fileState: "uploaded" })]).items[0].bucket === "notJudgedUnanswered", "unanswered is not judged");
  ok(run([line({ uploadedUs: String(BigInt(Date.parse("2026-11-01T00:00:00Z")) * BigInt(1000)) })]).items[0].bucket === "notJudgedTooNew", "uploaded at the cutoff is too new");
  ok(run([line({ payload: { ...line({}).payload, Strain: "blue dream" } })]).items[0].notes.length === 1, "strain case-only is a note, not a mismatch");
  ok(run([line({ payload: { ...line({}).payload, Product: "BD 1g " } })]).items[0].diffs[0].field === "Product", "a trailing space in the product name is a difference");
  ok(run([line({ t: "Strain", id: "BLUE DREAM", op: null, payload: { Strain: "BLUE DREAM", StrainType: "Hybrid" } })]).items[0].bucket === "verified", "a strain held only in another case verifies with a note");
  ok(sameNumber("10", "10.00") && !sameNumber("10", "10.01") && !sameNumber("", "0") && !sameNumber("x", "x"), "numbers compare exactly; unreadable is never equal");
  let threw = false;
  try { asOfCutoffUs("2026-02-30"); } catch { threw = true; }
  ok(threw, "a date that does not exist is refused");
  threw = false;
  try { parseSentLine(JSON.stringify({ ...line({}), payload: { a: 1 } })); } catch { threw = true; }
  ok(threw, "a payload with a non-text value is refused");
  return { passed, failed };
}
