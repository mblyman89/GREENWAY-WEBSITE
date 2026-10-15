/**
 * src/lib/payments/ach-file-ledger-core.ts  (R41 S3, PURE: no I/O)
 *
 * The rules of the ACH file ledger (table ach_files, migration 0273):
 *
 *   - nextFileIdModifier: the File ID Modifier (File Header position 34)
 *     tells apart files made on the same day. One upper-case letter A-Z or
 *     digit 0-9. "The first file of the day should have an upper case 'A' in
 *     this field. If a second file is submitted on the same day, the field
 *     should contain an upper case 'B', etc." (HomeTrust Bank ACH format,
 *     docs/authorities/ach/odfi-hometrust-ach-format-2023.txt). "Format:
 *     Uppercase A-Z or the numbers 0-9. This field cannot be left blank."
 *     (Banc of California, docs/authorities/ach/odfi-banc-of-california-
 *     nacha-file-format.txt). Both are bank summaries, not the Nacha rule
 *     text. A voided file keeps its letter: it may already be at the bank,
 *     so a re-release always gets a NEW one. The 37th file of a day is
 *     refused.
 *   - headerFacts: what the bytes themselves say (date, modifier, effective
 *     date, entry count, total). The store refuses to record a file whose
 *     bytes disagree with the row it is about to write.
 *   - entrySetKey: the duplicate check (Brenda's answer 9 means the portal
 *     will NOT stop a repeat, so the app must). Sorted routing, account and
 *     amount of every entry; the store keeps only its keyed HMAC because it
 *     holds account numbers.
 *   - toCrlf / sha256Hex: the stored body is exactly the bytes served
 *     (CRLF line ends), and its SHA-256 is re-checked on every download.
 */
import { createHash } from "node:crypto";

export const FILE_ID_MODIFIERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const MAX_FILES_PER_DAY = FILE_ID_MODIFIERS.length; // 36

export const ACH_FILE_KINDS = ["payroll", "vendor", "prenote", "micro_entry"] as const;
export type AchFileKind = (typeof ACH_FILE_KINDS)[number];

export const ACH_FILE_STATUSES = ["released", "uploaded", "bank_approved", "voided"] as const;
export type AchFileStatus = (typeof ACH_FILE_STATUSES)[number];

export const VOID_REASON_MIN = 10;

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

/**
 * The next free File ID Modifier for a day. `usedToday` is every modifier
 * already on that day's rows, VOIDED ROWS INCLUDED.
 */
export function nextFileIdModifier(usedToday: readonly string[]): Ok<{ modifier: string }> | Fail {
  const used = new Set(usedToday);
  for (const m of FILE_ID_MODIFIERS) {
    if (!used.has(m)) return { ok: true, modifier: m };
  }
  return {
    ok: false,
    error: `All ${MAX_FILES_PER_DAY} File ID Modifiers (A-Z, 0-9) are used today. A 37th ACH file cannot be told apart from the others, so release it tomorrow.`,
  };
}

/** Prenotes are zero-dollar (Brenda, answer 6): they do not count toward Timberland's limits. Test credits do. */
export function countsTowardLimit(kind: AchFileKind): boolean {
  return kind !== "prenote";
}

export type HeaderFacts = {
  fileDate: string; // YYYY-MM-DD, File Header 24-29 (Pacific since R41 S3)
  modifier: string; // File Header 34
  effectiveDate: string; // YYYY-MM-DD, first Batch Header 70-75
  entryCount: number; // count of 6 records
  totalCreditCents: number; // File Control 33-44 (credits)
};

const ymd = (yymmdd: string) => `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;

/** Read the facts the ledger row repeats straight from the file bytes. */
export function headerFacts(file: string): Ok<{ facts: HeaderFacts }> | Fail {
  const rows = file.split(/\r?\n/).filter((r) => r.length > 0);
  const head = rows[0] ?? "";
  if (head.length !== 94 || head[0] !== "1") return { ok: false, error: "The file does not start with a 94-character File Header." };
  const batch = rows.find((r) => r[0] === "5");
  if (!batch || batch.length !== 94) return { ok: false, error: "The file has no Batch Header." };
  const control = rows.find((r) => r[0] === "9" && !/^9{94}$/.test(r));
  if (!control || control.length !== 94) return { ok: false, error: "The file has no File Control record." };
  const d = head.slice(23, 29);
  const e = batch.slice(69, 75);
  if (!/^\d{6}$/.test(d) || !/^\d{6}$/.test(e)) return { ok: false, error: "The file's dates are not numbers." };
  return {
    ok: true,
    facts: {
      fileDate: ymd(d),
      modifier: head.slice(33, 34),
      effectiveDate: ymd(e),
      entryCount: rows.filter((r) => r[0] === "6").length,
      totalCreditCents: Number(control.slice(43, 55)),
    },
  };
}

/**
 * The duplicate key: every entry's routing (9 digits), account (trimmed) and
 * amount (cents), sorted, so the same payments in another order still match.
 * It contains account numbers: callers keep only a keyed HMAC of it.
 */
export function entrySetKey(file: string): string {
  return file
    .split(/\r?\n/)
    .filter((r) => r[0] === "6" && r.length === 94)
    .map((r) => `${r.slice(3, 12)}|${r.slice(12, 29).trim()}|${Number(r.slice(29, 39))}`)
    .sort()
    .join("\n");
}

/** The bytes Timberland receives: CRLF line ends (bank upload convention). */
export function toCrlf(file: string): string {
  return file.replace(/\r?\n/g, "\r\n");
}

export function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** The stored body must hash to the stored sha256, or it is not served. */
export function checkStoredBody(body: string, storedSha: string): Ok<object> | Fail {
  if (!body) return { ok: false, error: "The stored ACH file could not be read (is DATA_ENCRYPTION_KEY the same key it was saved with?). Nothing was served." };
  if (sha256Hex(body) !== storedSha) {
    return { ok: false, error: "The stored ACH file does not match its fingerprint (SHA-256). It may have been changed, so it was not served. Void it and release a new one." };
  }
  return { ok: true };
}

/**
 * Before a row is written: the bytes must say what the row says.
 */
export function checkFileMatchesRow(
  file: string,
  row: { fileDate: string; modifier: string; effectiveDate: string; entryCount: number; totalCents: number },
): string[] {
  const f = headerFacts(file);
  if (!f.ok) return [f.error];
  const p: string[] = [];
  if (f.facts.fileDate !== row.fileDate) p.push(`the File Header date is ${f.facts.fileDate}, not today (${row.fileDate}, Pacific)`);
  if (f.facts.modifier !== row.modifier) p.push(`the File ID Modifier is "${f.facts.modifier}", not "${row.modifier}"`);
  if (f.facts.effectiveDate !== row.effectiveDate) p.push(`the effective date is ${f.facts.effectiveDate}, not ${row.effectiveDate}`);
  if (f.facts.entryCount !== row.entryCount) p.push(`the file has ${f.facts.entryCount} entries, not ${row.entryCount}`);
  if (f.facts.totalCreditCents !== row.totalCents) p.push(`the file totals ${f.facts.totalCreditCents} cents, not ${row.totalCents}`);
  return p;
}

export function checkVoidReason(raw: string | null | undefined): Ok<{ reason: string }> | Fail {
  const reason = String(raw ?? "").trim();
  if (reason.length < VOID_REASON_MIN) return { ok: false, error: `Say why this file is voided (${VOID_REASON_MIN}+ characters).` };
  if (reason.length > 500) return { ok: false, error: "Keep the void reason under 500 characters." };
  return { ok: true, reason };
}

/** A unique-constraint name from 0273 that means "try the next modifier". */
export const MODIFIER_TAKEN_CONSTRAINT = "ach_files_day_modifier_key";

/** Database refusals in plain words. First match wins. */
export const LEDGER_ERROR_TABLE: readonly (readonly [RegExp, string])[] = [
  [/ach_files_one_live_per_source/, "This file was already released. Download it from the list, or void it (owner, with a reason) and release again."],
  [/ach_files_no_duplicate_entries/, "Duplicate refused: a file with exactly these payments (same accounts and amounts) and the same effective date is already released. Timberland does not catch repeats, so the app does."],
  [/ach_files_sha_live/, "Duplicate refused: this exact file is already released."],
  [/ach_files_day_modifier_key/, "Another file took today's next File ID Modifier at the same moment. Try again."],
  [/ACH_FILE_KEEP/, "ACH files are records and are never deleted. Void it instead."],
  [/ACH_FILE_FINAL/, "This file is voided. A voided file never changes."],
  [/ACH_FILE_IMMUTABLE/, "A released file's bytes, date, letter and totals never change. Void it and release a new one."],
  [/ACH_FILE_TRANSITION/, "That status change is not allowed for this file."],
  [/ACH_FILE_REASON/, "Say why this file is voided (10+ characters)."],
  [/ACH_FILE_ALREADY_RELEASED/, "This payroll run already has its file. Download it, or void it (owner, with a reason) to release a new one."],
  [/ACH_FILE_NOT_FOUND/, "That ACH file was not found."],
  [/ACH_BANK_STEP_FINAL/, "Who uploaded or approved this file at Timberland, and when, is already recorded and never changes."],
  [/ACH_BANK_STEP/, "Do the bank steps in order: release, then mark uploaded, then mark approved at Timberland."],
  [/ACH_OWNER_ONLY/, "Only the owner releases, voids, or marks ACH files uploaded or approved at Timberland. Send it as a request for owner approval."],
  [/ach_file_mark_(uploaded|bank_approved).*does not exist|Could not find the function public\.ach_file_mark_/, "The Timberland bank steps are not set up yet: run migration 0274 (docs/MIGRATIONS_TO_RUN.md). Nothing was changed."],
  [/relation "public\.ach_files" does not exist|ach_file_release.*does not exist|Could not find the function public\.ach_file_/, "The ACH file ledger is not set up yet: run migration 0273 (docs/MIGRATIONS_TO_RUN.md). No file was released."],
];

export function ledgerDbErrorMessage(message: string | null | undefined): string {
  const m = String(message ?? "");
  for (const [re, text] of LEDGER_ERROR_TABLE) if (re.test(m)) return text;
  return "The ACH file ledger refused this. Nothing was changed. Reload the page and try again.";
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runAchFileLedgerCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`ach-file-ledger-core FAIL: ${n}`);
    }
  };
  const mod = (u: string[]) => {
    const r = nextFileIdModifier(u);
    return r.ok ? r.modifier : null;
  };

  // modifiers: A first, then B, letters before digits, gaps filled, voided letters stay used
  ok(mod([]) === "A", "first file of the day gets A");
  ok(mod(["A"]) === "B", "second gets B");
  ok(mod(["A", "C"]) === "B", "a free letter is reused only if never used that day");
  ok(mod(FILE_ID_MODIFIERS.slice(0, 26).split("")) === "0", "after Z comes 0");
  ok(mod(FILE_ID_MODIFIERS.slice(0, 35).split("")) === "9", "the 36th file gets 9");
  const full = nextFileIdModifier(FILE_ID_MODIFIERS.split(""));
  ok(!full.ok && /37th ACH file/.test(full.error), "the 37th file of the day is refused");
  ok(MAX_FILES_PER_DAY === 36 && new Set(FILE_ID_MODIFIERS).size === 36 && /^[A-Z]{26}[0-9]{10}$/.test(FILE_ID_MODIFIERS), "36 distinct: A-Z then 0-9");
  ok(mod(["a"]) === "A", "a lower-case value does not hide A");

  ok(countsTowardLimit("payroll") && countsTowardLimit("vendor") && countsTowardLimit("micro_entry"), "payroll, vendor and test credits count");
  ok(!countsTowardLimit("prenote"), "prenotes do not count (Brenda 6)");

  // a hand-made 10-record file (94 chars each)
  const pad = (s: string) => (s + " ".repeat(94)).slice(0, 94);
  const head = pad("101 325170754" + "1911234567" + "261020" + "1830" + "B" + "094101TIMBERLAND BANK");
  const batch = pad("5220GREENWAY MARIJUA" + " ".repeat(20) + "1911234567PPDPAYROLL   " + "261023261023" + "   1" + "32517075" + "0000001");
  const six = (routing: string, acct: string, cents: number, n: number) => pad("622" + routing + (acct + " ".repeat(17)).slice(0, 17) + String(cents).padStart(10, "0") + "E" + " ".repeat(14) + "NAME" + " ".repeat(18) + "  0" + "32517075" + String(n).padStart(7, "0"));
  const control = pad("9000001000001" + "00000002" + "0004302158" + "000000000000" + "000000150123");
  const file = [head, batch, six("021000021", "123456789", 100000, 1), six("011401533", "987", 50123, 2), pad("8220"), control, "9".repeat(94), "9".repeat(94), "9".repeat(94), "9".repeat(94)].join("\n") + "\n";
  const f = headerFacts(file);
  ok(f.ok && f.facts.fileDate === "2026-10-20", "headerFacts: file date from positions 24-29");
  ok(f.ok && f.facts.modifier === "B", "headerFacts: modifier from position 34");
  ok(f.ok && f.facts.effectiveDate === "2026-10-23", "headerFacts: effective date from the batch header 70-75");
  ok(f.ok && f.facts.entryCount === 2, "headerFacts: two entries");
  ok(f.ok && f.facts.totalCreditCents === 150123, "headerFacts: credit total from the file control 45-56");
  ok(!headerFacts("").ok && !headerFacts(file.slice(1)).ok, "headerFacts: no header refused");
  ok(!headerFacts([head, control].join("\n")).ok, "headerFacts: no batch refused");

  const row = { fileDate: "2026-10-20", modifier: "B", effectiveDate: "2026-10-23", entryCount: 2, totalCents: 150123 };
  ok(checkFileMatchesRow(file, row).length === 0, "matching row passes");
  ok(checkFileMatchesRow(file, { ...row, modifier: "A" }).some((p) => /Modifier is "B", not "A"/.test(p)), "modifier mismatch caught");
  ok(checkFileMatchesRow(file, { ...row, fileDate: "2026-10-21" }).some((p) => /not today/.test(p)), "date mismatch caught");
  ok(checkFileMatchesRow(file, { ...row, effectiveDate: "2026-10-22" }).some((p) => /effective date/.test(p)), "effective mismatch caught");
  ok(checkFileMatchesRow(file, { ...row, entryCount: 3 }).some((p) => /2 entries/.test(p)), "count mismatch caught");
  ok(checkFileMatchesRow(file, { ...row, totalCents: 150124 }).some((p) => /150123 cents/.test(p)), "total mismatch caught");

  // duplicate key: order-free, amount-sensitive, account-sensitive
  const k = entrySetKey(file);
  ok(k === "011401533|987|50123\n021000021|123456789|100000", "entry key is sorted routing|account|cents");
  const swapped = [head, batch, six("011401533", "987", 50123, 1), six("021000021", "123456789", 100000, 2)].join("\n");
  ok(entrySetKey(swapped) === k, "the same payments in another order give the same key");
  ok(entrySetKey([head, batch, six("021000021", "123456789", 100001, 1), six("011401533", "987", 50123, 2)].join("\n")) !== k, "one cent different is not a duplicate");
  ok(entrySetKey([head, batch, six("021000021", "123456780", 100000, 1), six("011401533", "987", 50123, 2)].join("\n")) !== k, "another account is not a duplicate");
  ok(entrySetKey(toCrlf(file)) === k, "CRLF and LF give the same key");

  // bytes and fingerprint
  const crlf = toCrlf(file);
  ok(crlf.split("\r\n").length === file.split("\n").length && !/[^\r]\n/.test(crlf), "toCrlf: every line ends CRLF");
  ok(toCrlf(crlf) === crlf, "toCrlf is idempotent");
  ok(sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 FIPS 180-2 'abc' vector");
  ok(checkStoredBody(crlf, sha256Hex(crlf)).ok, "the stored body with its own hash is served");
  const tampered = crlf.replace("0000100000", "0000900000");
  const t = checkStoredBody(tampered, sha256Hex(crlf));
  ok(!t.ok && /does not match its fingerprint/.test(t.error), "a tampered body is refused");
  const e = checkStoredBody("", sha256Hex(crlf));
  ok(!e.ok && /could not be read/.test(e.error), "an unreadable (wrong key) body is refused");

  // void reason
  ok(!checkVoidReason("oops").ok && !checkVoidReason(null).ok && !checkVoidReason("         x").ok, "short void reasons refused");
  ok(checkVoidReason("  wrong pay date on run  ").ok && (checkVoidReason("  wrong pay date on run  ") as { reason: string }).reason === "wrong pay date on run", "void reason trimmed");
  ok(!checkVoidReason("x".repeat(501)).ok, "very long reason refused");

  // errors in words
  ok(/already released/.test(ledgerDbErrorMessage('duplicate key value violates unique constraint "ach_files_one_live_per_source"')), "one-per-source in words");
  ok(/Duplicate refused: a file with exactly these payments/.test(ledgerDbErrorMessage('violates unique constraint "ach_files_no_duplicate_entries"')), "duplicate entries in words");
  ok(/Only the owner/.test(ledgerDbErrorMessage("ACH_OWNER_ONLY: only the owner")), "owner-only in words");
  ok(/run migration 0273/.test(ledgerDbErrorMessage('relation "public.ach_files" does not exist')), "missing migration in words");
  ok(/Nothing was changed/.test(ledgerDbErrorMessage("something else")), "unknown error is generic, never raw");
  ok(/already recorded and never changes/.test(ledgerDbErrorMessage("ACH_BANK_STEP_FINAL: who uploaded")), "a set bank stamp is final, in words (not the order message)");
  ok(/in order: release, then mark uploaded/.test(ledgerDbErrorMessage("ACH_BANK_STEP: ACH file x has no upload recorded")), "bank steps out of order, in words");
  ok(/run migration 0274/.test(ledgerDbErrorMessage("Could not find the function public.ach_file_mark_uploaded(p_actor, p_file_id) in the schema cache")), "missing 0274 function names 0274, not 0273");
  ok(/run migration 0274/.test(ledgerDbErrorMessage("function public.ach_file_mark_bank_approved(uuid, uuid) does not exist")), "missing 0274 function (pg wording) names 0274");
  ok(/run migration 0273/.test(ledgerDbErrorMessage("Could not find the function public.ach_file_void(p_actor) in the schema cache")), "missing 0273 function still names 0273");
  ok(/marks ACH files uploaded or approved/.test(ledgerDbErrorMessage("ACH_OWNER_ONLY: only the owner records the upload")), "owner-only covers the bank steps");
  ok(MODIFIER_TAKEN_CONSTRAINT === "ach_files_day_modifier_key", "the retry constraint name");

  console.log(`ach-file-ledger-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
