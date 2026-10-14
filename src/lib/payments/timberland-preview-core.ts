/**
 * src/lib/payments/timberland-preview-core.ts  (R41 S2)
 *
 * The "What Timberland sees" card on Banking > My banking. PURE.
 *
 * The 1 record (File Header) and 5 record (Batch Header) are produced by the
 * SAME exported functions buildNachaFile uses (fileHeaderRecord,
 * batchHeaderRecord), so the preview is the exact bytes of the next file's
 * headers, not a re-typed copy.
 *
 * The three names (plan section 3.1) are shown side by side so nobody
 * "fixes" one to match another:
 *   - the contract (legal) name, from timberland-profile-core (S1, quoted)
 *   - the IRS name: "LYMAN'S MARIJUANA L.L.C." (docs/DEFECTS.md:868 records
 *     the W-2 box failure "expected '0' to contain 'LYMAN\'S MARIJUANA
 *     L.L.C.'"); docs/BOOKS_ROADMAP.md:1343: "Greenway's EIN was issued to
 *     LYMAN'S MARIJUANA; it trades as GREENWAY MARIJUANA"
 *   - the batch name Brenda set up: GREENWAY MARIJUA
 */

import { batchHeaderRecord, fileHeaderRecord, type AchOriginator } from "./nacha-core";
import { ACCOUNT_LAST4, BATCH_COMPANY_NAME, CONTRACT_LEGAL_NAME } from "./timberland-profile-core";

/** The IRS name on the EIN (docs/DEFECTS.md:868). */
export const IRS_NAME = "LYMAN'S MARIJUANA L.L.C.";

export type NameRow = { label: string; value: string; where: string };

export const THREE_NAMES: readonly NameRow[] = [
  { label: "Contract (legal) name", value: CONTRACT_LEGAL_NAME, where: "Timberland ACH agreement, page 1. Records only; it is not written in the file." },
  { label: "IRS name on the EIN", value: IRS_NAME, where: "IRS records (Books > Company information). Records only; it is not written in the file." },
  { label: "Batch Company Name", value: BATCH_COMPANY_NAME, where: "Batch header, positions 5-20. Brenda set it up this way: \"that is all that will fit in this section\"." },
];

export type RecordField = { from: number; to: number; label: string; value: string };

export type TimberlandPreview =
  | {
      ok: true;
      fileHeader: string;
      batchHeader: string;
      fileFields: RecordField[];
      batchFields: RecordField[];
      accountLine: string;
    }
  | { ok: false; reason: string };

/** Slice by 1-based inclusive Nacha positions. */
export function pos(rec: string, from: number, to: number): string {
  return rec.slice(from - 1, to);
}

/**
 * The preview for a READY originator. `originator` is null when
 * originatorReadiness() found problems; the card then shows those instead
 * (a preview of a file that will be refused would mislead).
 */
export function timberlandPreview(originator: AchOriginator | null, now: Date, secCode: "PPD" | "CCD" = "PPD"): TimberlandPreview {
  if (!originator) return { ok: false, reason: "No preview: the settings do not match Timberland's setup yet (see the problems above)." };
  const fh = fileHeaderRecord(originator, now, "A");
  const bh = batchHeaderRecord(originator, secCode, secCode === "PPD" ? "PAYROLL" : "VENDOR PAY", now, 1);
  const f = (rec: string, from: number, to: number, label: string): RecordField => ({ from, to, label, value: pos(rec, from, to) });
  return {
    ok: true,
    fileHeader: fh,
    batchHeader: bh,
    fileFields: [
      f(fh, 4, 13, "Immediate Destination (blank + Timberland routing)"),
      f(fh, 14, 23, "Immediate Origin (1 + EIN)"),
      f(fh, 34, 34, "File ID Modifier (A for the first file of a day)"),
      f(fh, 41, 63, "Immediate Destination Name"),
      f(fh, 64, 86, "Immediate Origin Name (full trade name until Q11 is answered)"),
    ],
    batchFields: [
      f(bh, 2, 4, "Service Class Code (220 = credits only, an unbalanced batch)"),
      f(bh, 5, 20, "Company Name (Brenda: GREENWAY MARIJUA)"),
      f(bh, 41, 50, "Company Identification (Brenda: 1 + EIN)"),
      f(bh, 51, 53, "Entry type (PPD payroll, CCD vendors)"),
      f(bh, 80, 87, "Originating DFI (first 8 of 325170754)"),
    ],
    accountLine: `Funding account: the agreement names the account ending ${ACCOUNT_LAST4}. It is not written in the file.`,
  };
}

export function __runTimberlandPreviewCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL timberland-preview-core:", msg);
    }
  };
  const O: AchOriginator = {
    destinationRouting: "325170754",
    destinationName: "TIMBERLAND BANK",
    immediateOrigin: "1911234567",
    companyName: "Greenway Marijuana",
    companyId: "1911234567",
    originatingDfi: "32517075",
    companyEin: "911234567",
  };
  const now = new Date("2026-11-04T21:15:00Z");
  const p = timberlandPreview(O, now);
  ok(p.ok, "a ready originator previews");
  if (p.ok) {
    ok(p.fileHeader.length === 94 && p.batchHeader.length === 94, "both records are 94 wide");
    ok(pos(p.fileHeader, 4, 13) === " 325170754", "1-record 4-13 is blank + Timberland routing");
    ok(pos(p.fileHeader, 14, 23) === "1911234567", "1-record 14-23 is 1 + EIN");
    ok(pos(p.fileHeader, 34, 34) === "A", "1-record 34 is A");
    ok(pos(p.fileHeader, 64, 86).trimEnd() === "GREENWAY MARIJUANA", "1-record 64-86 keeps the full trade name (Q11)");
    ok(pos(p.batchHeader, 2, 4) === "220", "5-record SCC 220");
    ok(pos(p.batchHeader, 5, 20) === BATCH_COMPANY_NAME, "5-record 5-20 is Brenda's GREENWAY MARIJUA");
    ok(pos(p.batchHeader, 41, 50) === "1911234567", "5-record 41-50 is 1 + EIN");
    ok(pos(p.batchHeader, 51, 53) === "PPD", "5-record 51-53 PPD by default");
    ok(pos(p.batchHeader, 80, 87) === "32517075", "5-record 80-87 is the ODFI");
    ok(p.fileFields.every((x) => x.value === pos(p.fileHeader, x.from, x.to)) && p.batchFields.every((x) => x.value === pos(p.batchHeader, x.from, x.to)), "every labelled field is the slice it names");
    ok(p.accountLine.includes(ACCOUNT_LAST4) && !/\d{5,}/.test(p.accountLine), "account shows the last four only");
  }
  const c = timberlandPreview(O, now, "CCD");
  ok(c.ok && pos(c.batchHeader, 51, 53) === "CCD" && pos(c.batchHeader, 54, 63).trimEnd() === "VENDOR PAY", "CCD preview uses the vendor description");
  ok(!timberlandPreview(null, now).ok, "no preview for a setup that does not match");
  ok(THREE_NAMES.length === 3 && new Set(THREE_NAMES.map((n) => n.value)).size === 3, "three distinct names");
  ok(THREE_NAMES[0].value === "Lymans Marijuana LLC", "contract name, spelled as on the agreement");
  ok(THREE_NAMES[1].value === "LYMAN'S MARIJUANA L.L.C.", "IRS name");
  ok(THREE_NAMES[2].value === "GREENWAY MARIJUA" && THREE_NAMES[2].value.length === 16, "batch name, 16 characters");

  console.log(`timberland-preview-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
