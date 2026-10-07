/**
 * scripts/recon/ccrs-lifecycle-e2e.ts — S-12c end-to-end contract check.
 *
 * The TS side (classifyEcho, parseSuccessEmails, the 0249 decoders) and the
 * SQL side (0249) are each tested alone. This proves they fit TOGETHER on a
 * real Postgres with every migration applied:
 *
 *   1. ccrs_emit_files stores a 3-row Product file and a 2-row Strain file.
 *   2. ccrs_mark_uploaded (decoded by decodeMarkUploaded).
 *   3. The rows are read back exactly as fileRowsForEcho reads them, an echo
 *      in CCRS's shape (columns moved, ErrorMessage added) is classified by
 *      classifyEcho, and the verdict is passed AS-IS to ccrs_record_outcome:
 *      the JSON contract (row_no / message / uncertain) must be accepted and
 *      give 2 landed + 1 refused (decodeOutcome).
 *   4. A success email for the Strain file is parsed and recorded.
 *   5. Pacing: the Strain file (later stamp) could not be marked uploaded
 *      while the Product file was unanswered.
 *
 * Usage: PGURL=postgres://postgres:postgres@localhost:5432/<db> npx tsx scripts/recon/ccrs-lifecycle-e2e.ts
 * The database must have every migration applied. It writes prod ccrs_* rows:
 * use a throwaway database, never a real one.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { classifyEcho, type OurRow } from "../../src/lib/compliance/ccrs-outcome-core";
import { decodeMarkUploaded, decodeOutcome, parseSuccessEmails } from "../../src/lib/compliance/ccrs-lifecycle-core";

const PGURL = process.env.PGURL;
if (!PGURL) throw new Error("PGURL is required");
if (/supabase\.co|pooler\.supabase/.test(PGURL)) throw new Error("refusing to run against Supabase: throwaway local database only");

const sql = (q: string): string =>
  execFileSync("psql", [PGURL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sqlFails = (q: string): string => {
  try {
    sql(q);
    return "";
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e);
  }
};
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
let n = 0;
const check = (c: unknown, m: string) => {
  if (!c) throw new Error(`E2E FAILED: ${m}`);
  n += 1;
};

const CR = "\r\n";
function file(type: string, name: string, stamp: string, cols: string, rows: string[]) {
  const content = ["SubmittedBy,Greenway", "SubmittedDate,10/07/2026", `NumberRecords,${rows.length}`, cols, ...rows].join(CR) + CR;
  return {
    file_type: type, purpose: "weekly", chunk_no: 1, chunk_of: 1, file_name: name, stamp_at: stamp, content,
    sha256: createHash("sha256").update(content, "utf8").digest("hex"), number_records: rows.length, distinct_ids: rows.length,
    control_totals: { numberRecords: rows.length }, issues: [],
  };
}

// clean slate for the tables this touches (throwaway DB)
sql("set session_replication_role = replica; truncate public.ccrs_file_issues, public.ccrs_file_rows, public.ccrs_file_contents, public.ccrs_filed_entities, public.ccrs_files cascade;");

const PCOLS = "LicenseNumber,InventoryCategory,InventoryType,Name,Description,UnitWeightGrams,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation";
const prod = file("Product", "Product_413541_20261007120000.csv", "2026-10-07T19:00:00Z", PCOLS, [
  "413541,EndProduct,Usable Cannabis,E2E One - 1g,d,1,E2E-GWP-000001,G,10/07/2026,,,Insert",
  "413541,EndProduct,Usable Cannabis,E2E Two - 1g,d,0,E2E-GWP-000002,G,10/07/2026,,,Insert",
  "413541,EndProduct,Usable Cannabis,E2E Three - 1g,d,1,E2E-GWP-000003,G,10/07/2026,,,Insert",
]);
const strain = file("Strain", "Strain_413541_20261007120001.csv", "2026-10-07T19:00:01Z", "LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate", [
  "413541,E2E Dream,Hybrid,G,10/07/2026",
  "413541,E2E Kush,Indica,G,10/07/2026",
]);
const emitted = JSON.parse(sql(`select public.ccrs_emit_files('prod', ${lit(JSON.stringify([prod, strain]))}::jsonb, '[]'::jsonb)::text`));
check(Array.isArray(emitted.files) && emitted.files.length === 2 && emitted.files.every((x: { status: string }) => x.status === "emitted"), `two files emitted (${JSON.stringify(emitted)})`);
const pid = sql(`select id from public.ccrs_files where file_name = ${lit(prod.file_name)}`);
const sid = sql(`select id from public.ccrs_files where file_name = ${lit(strain.file_name)}`);

// pacing: the later Strain file cannot go first without a reason
const t = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
check(/CCRS_UPLOAD_NOT_READY/.test(sqlFails(`select public.ccrs_mark_uploaded('${sid}', '${t(0)}', null, null)`)), "pacing refuses the later file");

const up = decodeMarkUploaded(pid, JSON.parse(sql(`select public.ccrs_mark_uploaded('${pid}', now(), null, null)::text`)));
check(up.fileName === prod.file_name && !up.overridden, "Product uploaded, no override");

// rows read back exactly as fileRowsForEcho does
const rows: OurRow[] = sql(`select row_no || '|' || external_id || '|' || coalesce(operation,'') from public.ccrs_file_rows where file_id = '${pid}' order by row_no`)
  .split("\n").map((l) => { const [r, id, op] = l.split("|"); return { rowNo: Number(r), externalId: id, operation: op || null }; });
check(rows.length === 3 && rows[1].externalId === "E2E-GWP-000002", "rows read back");

// CCRS's echo shape: columns moved, ErrorMessage inserted, values reformatted (P20261005A)
const echo = [
  "LicenseNumber,InventoryCategory,InventoryType,Name,Description,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation,ErrorMessage,UnitWeightGrams",
  "413541,EndProduct,Usable Cannabis,E2E Two - 1g,d,E2E-GWP-000002,,10/07/2026,,,Insert,If Useable Cannabis is selected Unit Weight Gram cannot be Zero,.00",
].join(CR);
const v = classifyEcho("Product", rows, echo);
check(v.outcome === "error-rows" && v.rejected.length === 1 && v.rejected[0].row_no === 2, "verdict: row 2 refused");

const out = decodeOutcome(pid, v.outcome, JSON.parse(sql(
  `select public.ccrs_record_outcome('${pid}', ${lit(v.outcome)}, now(), ${lit(JSON.stringify(v.rejected))}::jsonb, array[${v.messages.map(lit).join(",")}]::text[])::text`,
)));
check(out.state === "errored" && out.rows.landed === 2 && out.rows.rejected === 1 && out.rows.uncertain === 0, `SQL accepted the TS verdict (${JSON.stringify(out)})`);
check(sql(`select count(*) from public.ccrs_filed_entities where env='prod' and file_type='Product' and state='filed'`) === "2", "2 products filed");
check(sql(`select count(*) from public.ccrs_filed_entities where external_id='E2E-GWP-000002'`) === "0", "refused product NOT filed (it will be re-sent as Insert)");
check(sql(`select count(*) from public.ccrs_file_issues where file_id='${pid}' and code='CCRS_ROW_REJECTED'`) === "1", "issue stored");

// success email for the Strain file, real body shape
sql(`select public.ccrs_mark_uploaded('${sid}', now(), null, null)`);
const notices = parseSuccessEmails(`PRE The file ${strain.file_name.replace(".csv", "_2026107T1252497.csv")} you submitted has been processed. Date Submitted: 10/7/2026 12:52:20 PM`);
check(notices.length === 1 && notices[0].fileName === strain.file_name, "success email names the Strain file");
const s = decodeOutcome(sid, "success", JSON.parse(sql(`select public.ccrs_record_outcome('${sid}', 'success', now(), '[]'::jsonb, null)::text`)));
check(s.state === "closed" && s.rows.landed === 2, "Strain closes on success");
check(/CCRS_OUTCOME_NOT_UPLOADED/.test(sqlFails(`select public.ccrs_record_outcome('${sid}', 'success', now(), '[]'::jsonb, null)`)), "an answer is recorded once");

sql("set session_replication_role = replica; truncate public.ccrs_file_issues, public.ccrs_file_rows, public.ccrs_file_contents, public.ccrs_filed_entities, public.ccrs_files cascade;");
console.log(`CCRS LIFECYCLE E2E PASSED (${n} checks)`);
