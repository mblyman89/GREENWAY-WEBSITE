/**
 * src/lib/compliance/ccrs-adopt-core.ts — D228 (PURE).
 *
 * "Adopt a hand-made file": the owner uploaded a CCRS file the hub did not
 * make (a hand fix), and CCRS ACCEPTED it. The success email names that file,
 * so the hub cannot apply it: the name is not in the outbox. Renaming cannot
 * help: CCRS keeps the name it saw, and the same rows sent again are refused
 * ("Duplicate Sale for Licensee", [G L1390]); the same data is never filed
 * twice [BRIAN A29].
 *
 * So the hub ADOPTS the file: it stores the exact bytes under the exact name
 * CCRS saw (0357 ccrs_adopt_handmade_file), marked uploaded at CCRS's own
 * "Date Submitted". The success email then applies through the normal path.
 *
 * This module decides, from what the owner pasted, whether a file may be
 * adopted, and builds the exact 0357 payload. Nothing is trusted that the
 * bytes do not prove: the type comes from the name, the record count from
 * the bytes, the stamp from the name (Pacific wall clock).
 */
import { CCRS_COLUMNS, type CcrsRetailerFileType, verifyCcrsFile } from "./ccrs-batch-core";
import { controlTotalsFromCsv, type CcrsControlTotals } from "./ccrs-control-totals-core";
import { sha256Utf8 } from "./ccrs-outbox-core";
import { pacificLocalToUtcISO } from "./ccrs-lifecycle-core";

export const ADOPT_TYPES: readonly CcrsRetailerFileType[] = ["Strain", "Area", "Product", "Inventory", "Sale", "InventoryAdjustment", "InventoryTransfer"];

/** Our name shape exactly: Type_License_YYYYMMDDHHMMSS.csv (no CCRS receipt token). */
export const ADOPT_NAME_RE = /^(Strain|Area|Product|Inventory|Sale|InventoryAdjustment|InventoryTransfer)_(\d+)_(\d{14})\.csv$/;

export type AdoptPayload = {
  file_type: CcrsRetailerFileType;
  purpose: "weekly";
  chunk_no: 1;
  chunk_of: 1;
  file_name: string;
  stamp_at: string;
  content: string;
  sha256: string;
  number_records: number;
  distinct_ids: number;
  sum_qoh: string | null;
  sum_total_cost: string | null;
  control_totals: CcrsControlTotals;
  issues: [];
};

export type AdoptPlan = { ok: true; payload: AdoptPayload } | { ok: false; errors: string[] };

/**
 * A pasted file normalised to CCRS bytes. A browser textarea sends CRLF for
 * every line break, but a paste may come with bare LF (or lose the final line
 * break). The bytes CCRS accepted end every line with CRLF, so: LF -> CRLF,
 * one final CRLF. Nothing else is touched (no trim of cells, no BOM added).
 */
export function normaliseAdoptCsv(text: string): string {
  const body = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
  return body.split("\n").join("\r\n") + "\r\n";
}

/** "Sale_413541_20261110150000.csv" -> the instant (UTC ISO) of its Pacific stamp, or null. */
export function stampFromName(fileName: string): string | null {
  const m = ADOPT_NAME_RE.exec(fileName);
  if (!m) return null;
  const s = m[3];
  return pacificLocalToUtcISO(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`);
}

/**
 * Plan an adoption. `licenseNumber` is the hub's own license: a file for
 * another licensee is never adopted. Every problem is listed, not just the
 * first, so the owner fixes the paste once.
 */
export function planAdoptFile(input: { fileName: string; csv: string; licenseNumber: string }): AdoptPlan {
  const errors: string[] = [];
  const name = input.fileName.trim();
  const m = ADOPT_NAME_RE.exec(name);
  if (!m) {
    return { ok: false, errors: [`"${name}" is not a CCRS file name like Sale_413541_20261110150000.csv (type, license, 14-digit stamp, no CCRS receipt token).`] };
  }
  const type = m[1] as CcrsRetailerFileType;
  const lic = (input.licenseNumber ?? "").trim();
  if (!lic) errors.push("The license number is not set in Settings, so the file cannot be checked against it.");
  else if (m[2] !== lic) errors.push(`The name is for license ${m[2]}, but this store is ${lic}.`);
  const stampAt = stampFromName(name);
  if (!stampAt) errors.push(`The stamp ${m[3]} in the name is not a real Pacific date and time.`);
  const csv = normaliseAdoptCsv(input.csv ?? "");
  const problems = verifyCcrsFile(type, csv).filter((p) => p.severity === "error");
  for (const p of problems) errors.push(p.message);
  const lines = csv.slice(0, -2).split("\r\n");
  if (lines.length < 5) errors.push("The file has no data rows.");
  const licCol = CCRS_COLUMNS[type].indexOf("LicenseNumber");
  if (lic && licCol >= 0 && lines.slice(4).some((l) => l.split(",")[licCol] !== lic)) errors.push(`Every row must carry LicenseNumber ${lic}.`);
  let totals: CcrsControlTotals | null = null;
  if (errors.length === 0) {
    try {
      totals = controlTotalsFromCsv(type, csv);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (errors.length > 0 || !totals || !stampAt) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      file_type: type,
      purpose: "weekly",
      chunk_no: 1,
      chunk_of: 1,
      file_name: name,
      stamp_at: stampAt,
      content: csv,
      sha256: sha256Utf8(csv),
      number_records: totals.numberRecords,
      distinct_ids: totals.distinctIds,
      sum_qoh: totals.sumQoh,
      sum_total_cost: totals.sumTotalCost,
      control_totals: totals,
      issues: [],
    },
  };
}

/**
 * The upload time to record: the "Date Submitted" CCRS printed in its email
 * for THIS name (exactly as parseSuccessEmails read it), else the owner's
 * Pacific time. Null = neither given.
 */
export function adoptUploadTime(ccrsSubmittedAt: string | null, ownerPacificLocal: string): string | null {
  if (ccrsSubmittedAt && Number.isFinite(Date.parse(ccrsSubmittedAt))) return new Date(ccrsSubmittedAt).toISOString();
  return pacificLocalToUtcISO(ownerPacificLocal);
}

/** Minimum reason length, same as every logged override in 0249/0357. */
export const ADOPT_REASON_MIN = 10;

/** D228: an RPC error that means 0357 is not applied yet (PostgREST: unknown function). */
export function is0357Missing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "PGRST202" || err.code === "42883" || /Could not find the function|function public\.ccrs_(reopen_mail|adopt_handmade_file)[\s\S]*does not exist/i.test(err.message ?? "");
}
export const MIGRATION_0357_MISSING = "Migration 0357 (supabase/migrations/0357_ccrs_adopt_and_reopen.sql) is not applied yet. Apply it in the Supabase SQL editor, then press the button again.";
