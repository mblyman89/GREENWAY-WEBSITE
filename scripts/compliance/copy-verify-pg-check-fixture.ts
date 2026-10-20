/**
 * scripts/compliance/copy-verify-pg-check-fixture.ts - CCRS Bible v2 S-16.
 *
 * Builds a small, fully known production history (Strain, Area, Product and
 * Inventory files emitted, uploaded and answered through the real 0248/0249
 * functions), then checks that SENT_READ_SQL returns exactly the lines the
 * pure verifier is tested with. Writes scripts/recon/ccrs-copy-verify-pg-check.sql:
 *
 *   npx tsx scripts/compliance/copy-verify-pg-check-fixture.ts --write
 *
 * tests/compliance/s16-ccrs-copy-verify.test.ts fails if the file and this
 * generator differ, and runs verifyCopy on copyVerifyFixture().expectedLines.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { assembleCcrsFile } from "../../src/lib/compliance/ccrs-batch-core";
import { sqlText } from "../../src/lib/compliance/ccrs-ledger-seed-core";
import { emitPayload, planOutboxFiles, type OutboxFile } from "../../src/lib/compliance/ccrs-outbox-core";
import { SENT_READ_SQL, type SentLine } from "../../src/lib/compliance/ccrs-copy-verify-core";

const BY = "Greenway Marijuana";
const noon = (iso: string) => new Date(`${iso}T19:00:00Z`);

/** Three emissions, each its own stamp; the rows are the fixture's whole history. */
export function copyVerifyFixture() {
  const day1 = "2026-09-21";
  const w1 = planOutboxFiles(
    [
      { type: "Strain", csv: assembleCcrsFile({ type: "Strain", submittedBy: BY, submittedDate: noon(day1), rows: [["413541", "CV Kush", "Hybrid", BY, "09/21/2026"]] }) },
      { type: "Area", csv: assembleCcrsFile({ type: "Area", submittedBy: BY, submittedDate: noon(day1), rows: [["413541", "CV Floor", "False", "CV-AREA-1", BY, "09/21/2026", "", "", "Insert"]] }) },
      { type: "Product", csv: assembleCcrsFile({ type: "Product", submittedBy: BY, submittedDate: noon(day1), rows: [
        ["413541", "EndProduct", "Usable Cannabis", "CV Kush 1g", "cv desc", "1", "CV-P-1", BY, "09/21/2026", "", "", "Insert"],
        ["413541", "EndProduct", "Usable Cannabis", "CV O'Neil 1g", "cv desc 2", "1", "CV-P-2", BY, "09/21/2026", "", "", "Insert"],
      ] }) },
      { type: "Inventory", csv: assembleCcrsFile({ type: "Inventory", submittedBy: BY, submittedDate: noon(day1), rows: [
        ["413541", "CV Kush", "CV Floor", "CV Kush 1g", "10", "10", "25.00", "False", "CV-L1", BY, "09/21/2026", "", "", "Insert"],
        ["413541", "CV Kush", "CV Floor", "CV Kush 1g", "10", "6", "25.00", "False", "CV-L2", BY, "09/21/2026", "", "", "Insert"],
        ["413541", "CV Kush", "CV Floor", "CV O'Neil 1g", "5", "5", "9.50", "False", "CV-L3", BY, "09/21/2026", "", "", "Insert"],
        ["413541", "CV Kush", "CV Floor", "CV Kush 1g", "4", "4", "8.00", "False", "CV-REJ", BY, "09/21/2026", "", "", "Insert"],
      ] }) },
    ],
    { licenseNumber: "413541", now: new Date("2026-09-21T20:00:00Z"), lastStamp: null },
  );
  const inv1 = w1.find((f) => f.type === "Inventory")!;
  // week 2 (fixed PAST dates: 0249 refuses an upload time later than now): CV-L1 is closed (Update to 0); CV-L2 is updated to 3.
  const day2 = "2026-09-28";
  const w2 = planOutboxFiles(
    [{ type: "Inventory", csv: assembleCcrsFile({ type: "Inventory", submittedBy: BY, submittedDate: noon(day2), rows: [
      ["413541", "CV Kush", "CV Floor", "CV Kush 1g", "10", "0", "25.00", "False", "CV-L1", BY, "09/21/2026", BY, "09/28/2026", "Update"],
      ["413541", "CV Kush", "CV Floor", "CV Kush 1g", "10", "3", "25.00", "False", "CV-L2", BY, "09/21/2026", BY, "09/28/2026", "Update"],
    ] }) }],
    { licenseNumber: "413541", now: new Date("2026-09-28T20:00:00Z"), lastStamp: inv1.stampAt },
  );
  // week 3: a Sale of CV-L3 (landed), stamped after week 2.
  const day3 = "2026-10-05";
  const w3 = planOutboxFiles(
    [{ type: "Sale", csv: assembleCcrsFile({ type: "Sale", submittedBy: BY, submittedDate: noon(day3), rows: [
      ["413541", "", "CV-L3", "", "RecreationalRetail", "10/04/2026", "1", "10.00", "0.00", "0.95", "3.70", "CV-S1", "CV-SD1", BY, "10/05/2026", "", "", "Insert"],
    ] }) }],
    { licenseNumber: "413541", now: new Date("2026-10-05T20:00:00Z"), lastStamp: w2[0].stampAt },
  );
  const all = [...w1, ...w2, ...w3];
  const us = (d: Date) => String(BigInt(d.getTime()) * BigInt(1000));
  const uploaded = (f: OutboxFile) => new Date(f.stampAt.getTime() + 60_000);
  const state = (f: OutboxFile) => (["Strain", "Area", "Sale"].includes(f.type) ? "closed" : f === inv1 ? "errored" : "succeeded");
  const payloadOf = (f: OutboxFile, line: string) => {
    const lines = f.csv.split("\r\n");
    const cols = lines[3].split(",");
    const vals = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
  };
  // The lines SENT_READ_SQL must return (Inventory/Product/Strain/Area only; ordered as the SQL orders).
  const expected: SentLine[] = [];
  for (const f of all) {
    if (!["Inventory", "Product", "Strain", "Area"].includes(f.type)) continue;
    const data = f.csv.split("\r\n").slice(4).filter((l) => l !== "");
    data.forEach((line, i) => {
      const p = payloadOf(f, line);
      const id = f.type === "Strain" ? p.Strain : p.ExternalIdentifier;
      const rejected = f === inv1 && id === "CV-REJ";
      const closable = f.type === "Strain" || f.type === "Area";
      expected.push({
        t: f.type as SentLine["t"], id, op: p.Operation === undefined ? null : p.Operation, rowState: rejected ? "rejected" : closable ? "confirmed" : "submitted",
        fileState: state(f), file: f.fileName, stampUs: us(f.stampAt), uploadedUs: us(uploaded(f)), rowNo: i + 1, payload: p,
        eventsAfter: f.type === "Inventory" && id === "CV-L3" ? 1 : 0,
      });
    });
  }
  // Week-1 Inventory rows CV-L1/CV-L2 are confirmed by the week-2 successful Update (0249 Part 05 A).
  for (const e of expected) if (e.file === inv1.fileName && (e.id === "CV-L1" || e.id === "CV-L2")) e.rowState = "confirmed";
  const typeOrder = (t: string) => t; // SQL orders by file_type text
  expected.sort((a, b) => (typeOrder(a.t) < typeOrder(b.t) ? -1 : typeOrder(a.t) > typeOrder(b.t) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : BigInt(a.stampUs) < BigInt(b.stampUs) ? -1 : BigInt(a.stampUs) > BigInt(b.stampUs) ? 1 : a.rowNo - b.rowNo));
  const rejectedRowNo = inv1.csv.split("\r\n").slice(4).findIndex((l) => l.includes(",CV-REJ,")) + 1;
  return { all, w1, w2, w3, inv1, uploaded, rejectedRowNo, expected };
}

/** The pg-check SQL. ONE transaction, rolled back. Prints "CCRS COPY VERIFY CHECK PASSED". */
export function buildCopyVerifyPgCheck(): string {
  const { w1, w2, w3, inv1, uploaded, rejectedRowNo, expected } = copyVerifyFixture();
  const L = (s: string | null) => sqlText(s);
  const emits = [w1, w2, w3];
  const life = (f: OutboxFile) => {
    const id = `(select id from public.ccrs_files where file_name = ${L(f.fileName)})`;
    const at = `${L(uploaded(f).toISOString())}::timestamptz`;
    const outcome = f === inv1
      ? `select public.ccrs_record_outcome(${id}, 'error-rows', ${at} + interval '5 minutes', '[{"row_no": ${rejectedRowNo}, "message": "Invalid Product", "uncertain": false}]'::jsonb, array['Invalid Product']);`
      : `select public.ccrs_record_outcome(${id}, 'success', ${at} + interval '5 minutes', '[]'::jsonb, null);`;
    return `update public.ccrs_files set emitted_at = ${at} - interval '1 minute' where id = ${id};\nselect public.ccrs_mark_uploaded(${id}, ${at}, null, null);\n${outcome}`;
  };
  const blocks = emits.map((group) => `select public.ccrs_emit_files('prod', ${L(JSON.stringify(emitPayload(group)))}::jsonb);\n${group.map(life).join("\n")}`).join("\n\n");
  const sentSelect = SENT_READ_SQL.replace(/;$/, "");
  return `-- scripts/recon/ccrs-copy-verify-pg-check.sql  (CCRS Bible v2 S-16 - copy diff verifier, Part 17 §G)
--
-- GENERATED by scripts/compliance/copy-verify-pg-check-fixture.ts --write. Do not edit:
-- tests/compliance/s16-ccrs-copy-verify.test.ts fails if this file and the generator differ.
--
-- Emits, uploads and answers a small known history through the real
-- ccrs_emit_files / ccrs_mark_uploaded / ccrs_record_outcome, then checks that
-- SENT_READ_SQL (the verifier's only database read) returns exactly the
-- expected lines. ONE transaction, rolled back.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-copy-verify-pg-check.sql
--
-- "CCRS COPY VERIFY CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$ begin
  execute 'alter table public.ccrs_files disable trigger user';
  execute 'alter table public.ccrs_file_contents disable trigger user';
  delete from public.ccrs_file_issues;
  delete from public.ccrs_file_rows;
  delete from public.ccrs_file_contents;
  delete from public.ccrs_filed_entities;
  delete from public.ccrs_files;
  execute 'alter table public.ccrs_files enable trigger user';
  execute 'alter table public.ccrs_file_contents enable trigger user';
end $$;

${blocks}

create temp table cv_sent as ${sentSelect};
do $$ begin
  assert (select count(*) from cv_sent) = ${expected.length}, 'SENT_READ_SQL returns one line per sent Inventory/Product/Strain/Area row';
  assert (select jsonb_agg(json_build_object::jsonb order by json_build_object->>'t', json_build_object->>'id' collate "C", (json_build_object->>'stampUs')::bigint, (json_build_object->>'rowNo')::int) from cv_sent) = ${L(JSON.stringify(expected))}::jsonb,
    'SENT_READ_SQL lines = the lines the verifier tests are run on';
end $$;

do $$ begin raise notice 'CCRS COPY VERIFY CHECK PASSED'; end $$;
rollback;
`;
}

if (process.argv[1] && /copy-verify-pg-check-fixture\.ts$/.test(process.argv[1]) && process.argv.includes("--write")) {
  const out = path.resolve(__dirname, "../recon/ccrs-copy-verify-pg-check.sql");
  writeFileSync(out, buildCopyVerifyPgCheck());
  console.log(`wrote ${out}`);
}
