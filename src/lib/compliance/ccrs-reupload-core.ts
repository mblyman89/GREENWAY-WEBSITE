/**
 * src/lib/compliance/ccrs-reupload-core.ts  (R74 S46, Round 26). PURE.
 *
 * WHAT HAPPENED (2026-10-25). The owner uploaded six files to PREprod and got
 * six error emails. The six files were byte-for-byte the files of
 * 2026-10-20 (same md5 as docs/ccrs-bible/evidence/2026-10-20-real-upload/
 * sent), which CCRS had ALREADY processed that day. CCRS refuses "the same file
 * name ... nor the same data" twice [BRIAN A29], so every row came back as
 * "already on file": Duplicate External Identifier (Area, Product, Inventory,
 * Adjustment), Duplicate Strain (benign) and, first time ever seen,
 * "Duplicate Sale for Licensee" (Sale) [G L1390].
 *
 * Nothing was wrong with the data. But the hub could not say so: Apply only
 * looks at files marked "uploaded and waiting", and those files had been
 * answered five days earlier, so Apply said "Mark the file uploaded first"
 * and could not be used.
 *
 * This module recognises that case from the stored rows (classifyEcho, row
 * by row, against files CCRS has ALREADY answered) and lets the email be set
 * aside with a precise reason. Nothing is written to the ledger: a re-upload of
 * a file CCRS already answered cannot change what CCRS holds.
 */
import { classifyEcho, type OurRow } from "./ccrs-outcome-core";
import type { ErrorAttachment } from "./ccrs-mail-core";

/** Messages that mean "CCRS already holds this row". Nothing else counts as a re-upload echo. */
export const ALREADY_HELD_MESSAGES: readonly string[] = [
  "Duplicate External Identifier",
  "Duplicate Sale for Licensee",
  "Duplicate Strain. The Strain must be unique for the LicenseNumber",
];

/** File states that mean CCRS already answered the file (0249). */
export const ANSWERED_STATES: readonly string[] = ["succeeded", "errored", "reconciling", "closed"];

export function isAnsweredState(state: string): boolean {
  return ANSWERED_STATES.includes(state);
}

export type AnsweredFile = {
  fileId: string;
  fileName: string;
  env: "prod" | "preprod";
  fileType: string;
  state: string;
  /** When CCRS's email for it was recorded (success or error), if known. */
  answeredAt: string | null;
  rows: OurRow[];
};

export type ReuploadMatch = { fileId: string; fileName: string; env: "prod" | "preprod"; state: string; answeredAt: string | null; alsoFits: number };

/**
 * The already-answered file this error CSV is a re-upload echo of, or null.
 * Every line must tie to exactly one row of that file AND carry an
 * "already held" message. Newest answer wins when several files fit.
 */
export function matchReupload(e: ErrorAttachment, files: readonly AnsweredFile[]): ReuploadMatch | null {
  if (!e.fileType || e.dataLines < 1) return null;
  const fits: AnsweredFile[] = [];
  for (const f of files) {
    if (f.fileType !== e.fileType || !isAnsweredState(f.state)) continue;
    try {
      const v = classifyEcho(e.fileType, f.rows, e.csv);
      if (v.lines.length !== e.dataLines) continue;
      if (v.lines.every((l) => l.rowNo !== null && l.message !== null && ALREADY_HELD_MESSAGES.includes(l.message))) fits.push(f);
    } catch {
      /* not this file */
    }
  }
  if (fits.length === 0) return null;
  fits.sort((a, b) => (b.answeredAt ?? "").localeCompare(a.answeredAt ?? ""));
  const f = fits[0];
  return { fileId: f.fileId, fileName: f.fileName, env: f.env, state: f.state, answeredAt: f.answeredAt, alsoFits: fits.length - 1 };
}

/** The day part of an ISO time in Pacific time, or "an earlier date". */
function day(iso: string | null): string {
  if (!iso) return "an earlier date";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "an earlier date";
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/**
 * When EVERY error CSV of an email is a re-upload echo, the reason the email
 * is set aside with. Null when any CSV is not (then Apply must decide).
 */
export function planReuploadSetAside(errors: readonly ErrorAttachment[], files: readonly AnsweredFile[]): { note: string; matches: ReuploadMatch[] } | null {
  if (errors.length === 0) return null;
  const matches: ReuploadMatch[] = [];
  for (const e of errors) {
    const m = matchReupload(e, files);
    if (!m) return null;
    matches.push(m);
  }
  const list = matches.map((m) => `${m.fileName} (${m.env}, ${m.state}, answered ${day(m.answeredAt)})`).join("; ");
  return {
    matches,
    note:
      `Re-upload of file(s) CCRS had already answered: ${list}. Every row says CCRS already holds it ` +
      `(Duplicate External Identifier / Duplicate Sale / Duplicate Strain), which is CCRS refusing the same data twice. ` +
      `Nothing to fix and nothing recorded: the ledger already has CCRS's first answer.`,
  };
}

/** The 00_README line for a file the outbox served again (same bytes as before). */
export function duplicateEmitLine(state: string, fileName: string): string {
  if (isAnsweredState(state)) {
    return `  DO NOT UPLOAD: ${fileName} is the SAME file CCRS already answered (${state}). Uploading it again only brings back "Duplicate ..." errors on every row. Nothing new happened in this range for this file type.`;
  }
  if (state === "uploaded") return `  ALREADY UPLOADED: ${fileName} (same bytes) is waiting for its CCRS email. Do not upload it again.`;
  return `  ALREADY EMITTED (${state}): ${fileName} - same bytes as before. Upload it once if you have not yet, then mark it uploaded.`;
}

/** Shown next to "Download exact file" on a file CCRS already answered. */
export const ANSWERED_DOWNLOAD_WARNING = "For your records only. CCRS already answered this file: do not upload it again.";

/* ------------------------------------------------------------------ */
export function __runCcrsReuploadTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("ccrs-reupload-core FAIL:", m);
    }
  };
  const att = (filename: string, fileType: ErrorAttachment["fileType"], csv: string): ErrorAttachment => {
    const ls = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
    return { filename, fileType, typeProblem: null, header: ls[0].split(","), dataLines: ls.length - 1, messages: [], csv };
  };
  const rows = (ids: string[]): OurRow[] => ids.map((id, i) => ({ rowNo: i + 1, externalId: id, operation: "Insert" }));
  const sale = att(
    "Sale__1.csv",
    "Sale",
    "LicenseNumber,SaleExternalIdentifier,SaleDetailExternalIdentifier,Operation,ErrorMessage\r\n413541,S1,S1-a,Insert,Duplicate Sale for Licensee\r\n413541,S1,S1-b,Insert,Duplicate Sale for Licensee\r\n",
  );
  const answered: AnsweredFile = { fileId: "f1", fileName: "Sale_413541_20261020165833.csv", env: "preprod", fileType: "Sale", state: "succeeded", answeredAt: "2026-10-20T17:30:00Z", rows: rows(["S1-a", "S1-b", "S2-a"]) };

  // 1-2. the 10/25 case: a sale file CCRS already accepted, every row "Duplicate Sale"
  const m = matchReupload(sale, [answered]);
  ok(m?.fileName === "Sale_413541_20261020165833.csv" && m.alsoFits === 0, "re-upload of an accepted sale file is recognised");
  ok(matchReupload(sale, [{ ...answered, state: "uploaded" }]) === null, "a file still waiting is Apply's job, not a re-upload");
  // 3. a real refusal (not an already-held message) is never a re-upload
  const real = att("Sale__2.csv", "Sale", "LicenseNumber,SaleDetailExternalIdentifier,ErrorMessage\r\n413541,S1-a,Only Medical Sales Excise tax can be 0\r\n");
  ok(matchReupload(real, [answered]) === null, "a real error is not set aside");
  // 4. a line whose id is in no row of the file -> not that file
  const stray = att("Sale__3.csv", "Sale", "LicenseNumber,SaleDetailExternalIdentifier,ErrorMessage\r\n413541,ZZZ,Duplicate Sale for Licensee\r\n");
  ok(matchReupload(stray, [answered]) === null, "ids must tie to the answered file");
  // 5. type must match
  ok(matchReupload(sale, [{ ...answered, fileType: "Inventory" }]) === null, "only the same file type");
  // 6. newest answer wins; the others are counted
  const older = { ...answered, fileId: "f0", fileName: "Sale_413541_20261013120000.csv", answeredAt: "2026-10-13T17:30:00Z" };
  const m2 = matchReupload(sale, [older, answered]);
  ok(m2?.fileId === "f1" && m2.alsoFits === 1, "newest answered file wins");
  // 7-8. set-aside only when every CSV of the email is a re-upload echo
  const plan = planReuploadSetAside([sale], [answered]);
  ok(!!plan && plan.note.includes("Sale_413541_20261020165833.csv") && plan.note.includes("2026-10-20"), "set-aside note names the file and day");
  ok(planReuploadSetAside([sale, real], [answered]) === null, "one real error keeps the whole email for Apply");
  ok(planReuploadSetAside([], [answered]) === null, "no CSV, no plan");
  // 10. mixed messages inside one CSV (benign + held) still count
  const inv = att(
    "Inventory__1.csv",
    "Inventory",
    "LicenseNumber,ExternalIdentifier,ErrorMessage\r\n413541,L1,Duplicate External Identifier\r\n413541,L2,Duplicate External Identifier\r\n",
  );
  ok(!!matchReupload(inv, [{ ...answered, fileType: "Inventory", state: "closed", rows: rows(["L1", "L2"]) }]), "a closed inventory file counts as answered");
  // 11-13. README lines by state
  ok(duplicateEmitLine("succeeded", "X.csv").startsWith("  DO NOT UPLOAD"), "answered file: do not upload");
  ok(duplicateEmitLine("uploaded", "X.csv").includes("waiting"), "uploaded file: waiting");
  ok(duplicateEmitLine("emitted", "X.csv").includes("Upload it once"), "emitted file: upload once");
  return { passed, failed };
}
