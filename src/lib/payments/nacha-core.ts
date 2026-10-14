/**
 * src/lib/payments/nacha-core.ts  (Slice B)
 *
 * PURE NACHA (ACH) file generator. No I/O, no server-only imports — fully
 * unit-testable with tsx. Produces a standards-compliant, fixed-width 94-char
 * ASCII file suitable for uploading to the originating bank (Timberland /
 * Jack Henry) for direct-deposit payroll (SEC = PPD) and reusable later for
 * vendor payments (SEC = CCD).
 *
 * GROUNDING: field layout, justification rules, hash/count/block math verified
 * against the published NACHA PPD/CCD record layout (treasurysoftware.com ACH
 * file-format spec, which mirrors the official Nacha ACH Rules):
 *   1 File Header, 5 Batch Header, 6 Entry Detail, 8 Batch Control,
 *   9 File Control, plus 9-filled padding to a multiple of 10 records.
 *   Numeric fields: right-justified, zero-padded. Alphanumeric: left-
 *   justified, blank-padded. Entry Hash = sum of receiving DFI (first 8 of
 *   routing) per entry, rightmost 10 digits. Block count = ceil(records/10).
 *
 * This is a CREDIT-only originator model (money leaving the company to
 * employees/vendors): Service Class Code 220, Total Credit = sum of entries,
 * Total Debit = 0. Balanced/offset files are a bank-specific option we do not
 * emit by default (Timberland accepts unbalanced credit files).
 */

// ---------------------------------------------------------------------------
// Field helpers (R41 S2: moved to nacha-fields-core.ts so the Timberland
// files can use them without an import cycle; re-exported here unchanged)
// ---------------------------------------------------------------------------

import { alpha, dfiId8, isValidRouting, numeric, routingCheckDigit, sanitizeAlpha } from "./nacha-fields-core";
import { checkBuiltFileShape, checkOriginatorForFile, checkSecCode } from "./timberland-originator-core";

export { alpha, dfiId8, isValidRouting, numeric, routingCheckDigit, sanitizeAlpha };

function yymmdd(d: Date): string {
  const y = String(d.getUTCFullYear()).slice(2);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Originating company + bank settings (from ach_company_settings). */
export type AchOriginator = {
  /** Your bank's 9-digit ABA (Immediate Destination). Timberland's routing. */
  destinationRouting: string;
  /** Your bank's name (Immediate Destination Name), e.g. "TIMBERLAND BANK". */
  destinationName: string;
  /** Immediate Origin — typically "1" + EIN (10 digits) per the bank. */
  immediateOrigin: string;
  /** Your company legal/DBA name (Immediate Origin Name). */
  companyName: string;
  /** Company Identification — typically "1" + EIN. */
  companyId: string;
  /** Originating DFI ID — first 8 digits of YOUR routing at the ODFI. */
  originatingDfi: string;
  /**
   * R41 S2: the 9-digit EIN from company_profile.ein. Never written into the
   * file; the builder uses it to prove Company ID = Immediate Origin = "1" +
   * EIN (Brenda: "1 + EIN") before a single byte is produced.
   */
  companyEin: string;
};

/** One receiver (employee for PPD, vendor for CCD). Amount in CENTS. */
export type AchEntry = {
  /** Checking or savings — sets transaction code 22 vs 32 (credits). */
  accountType: "checking" | "savings";
  /** Receiver's 9-digit ABA routing number. */
  routing: string;
  /** Receiver's account number (alphanumeric, ≤17). */
  accountNumber: string;
  /** Amount owed, in cents (must be > 0). */
  amountCents: number;
  /** Receiver name (individual for PPD, company for CCD). */
  name: string;
  /** Optional identification number (e.g. employee id). */
  idNumber?: string | null;
  /**
   * R39 S3: a prenotification (prenote) — a zero-dollar entry that checks the
   * account exists before the first live credit. Transaction code 23
   * (checking) / 33 (savings), amount field all zeros. Nacha: prenotes are
   * optional, but an Originator that sends one must wait 3 banking days
   * before the first live entry (see PRENOTE_WAIT_BANKING_DAYS).
   * Sources: Nacha ACH Developer Guide, "Transaction Codes"; Hancock Whitney
   * NACHA format guide ("Enter 10 zeros for prenotes").
   */
  prenote?: boolean;
};

/** Nacha: wait this many banking days after a prenote before a live entry. */
export const PRENOTE_WAIT_BANKING_DAYS = 3;

export type BuildNachaInput = {
  originator: AchOriginator;
  entries: AchEntry[];
  /** PPD (payroll to individuals) or CCD (corporate/vendor). */
  secCode: "PPD" | "CCD";
  /** Description printed on the receiver's statement, e.g. "PAYROLL". */
  companyEntryDescription: string;
  /** Date funds should post (effective entry date). */
  effectiveDate: Date;
  /** File creation timestamp (defaults to effectiveDate at build time). */
  createdAt?: Date;
  /** File ID modifier A–Z, increments per file per day. Default "A". */
  fileIdModifier?: string;
};

export type BuildNachaResult =
  | { ok: true; file: string; totalCents: number; entryCount: number; recordCount: number }
  | { ok: false; error: string };

// Credit transaction codes (money OUT to the receiver).
const TXN_CODE: Record<AchEntry["accountType"], string> = {
  checking: "22",
  savings: "32",
};
// Credit prenote codes (zero-dollar account checks).
const PRENOTE_TXN_CODE: Record<AchEntry["accountType"], string> = {
  checking: "23",
  savings: "33",
};

/** Transaction code for an entry (live credit or credit prenote). */
export function transactionCode(e: Pick<AchEntry, "accountType" | "prenote">): string {
  const table = e.prenote ? PRENOTE_TXN_CODE : TXN_CODE;
  const code = table[e.accountType];
  if (!code) throw new Error(`Unknown account type "${String(e.accountType)}".`);
  return code;
}

// ---------------------------------------------------------------------------
// Header records (R41 S2: shared with the "What Timberland sees" preview)
// ---------------------------------------------------------------------------

/** The 1 record (File Header), 94 characters. */
export function fileHeaderRecord(originator: AchOriginator, created: Date, fileIdModifier: string): string {
  return (
    "1" +
    "01" +
    " " + numeric(originator.destinationRouting.replace(/\D/g, ""), 9) + // 4-13 (b + 9)
    numeric(originator.immediateOrigin, 10) + // 14-23
    yymmdd(created) + // 24-29
    hhmm(created) + // 30-33
    fileIdModifier + // 34
    "094" + // 35-37 record size
    "10" + // 38-39 blocking factor
    "1" + // 40 format code
    alpha(originator.destinationName, 23) + // 41-63
    alpha(originator.companyName, 23) + // 64-86
    " ".repeat(8) // 87-94 reference code
  );
}

/** The 5 record (Batch Header, service class 220 = credits only), 94 characters. */
export function batchHeaderRecord(originator: AchOriginator, secCode: string, companyEntryDescription: string, effectiveDate: Date, batchNumber: number): string {
  const originDfi8 = originator.originatingDfi.replace(/\D/g, "").slice(0, 8);
  return (
    "5" +
    "220" + // service class code: credits only
    alpha(originator.companyName, 16) + // 5-20
    " ".repeat(20) + // 21-40 discretionary data
    alpha(originator.companyId, 10) + // 41-50
    alpha(secCode, 3) + // 51-53
    alpha(companyEntryDescription, 10) + // 54-63
    yymmdd(effectiveDate) + // 64-69 descriptive date
    yymmdd(effectiveDate) + // 70-75 effective entry date
    " ".repeat(3) + // 76-78 reserved (settlement)
    "1" + // 79 originator status code
    numeric(originDfi8, 8) + // 80-87 originating DFI id
    numeric(batchNumber, 7) // 88-94
  );
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildNachaFile(input: BuildNachaInput): BuildNachaResult {
  const { originator, entries, secCode, effectiveDate } = input;

  // --- Validate ---
  // R41 S2: every file path (payroll, vendor, prenote, test credit) comes
  // through here, so the Timberland originator check and the SEC allowlist
  // live here and cannot be skipped by a caller.
  const secProblem = checkSecCode(secCode);
  if (secProblem) return { ok: false, error: secProblem };
  const originatorProblem = checkOriginatorForFile(originator);
  if (originatorProblem) return { ok: false, error: originatorProblem };
  if (entries.length === 0) return { ok: false, error: "No entries to include in the ACH file." };
  if (!isValidRouting(originator.destinationRouting)) {
    return { ok: false, error: "Originating bank (Immediate Destination) routing number is invalid." };
  }
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (!isValidRouting(e.routing)) {
      return { ok: false, error: `Entry ${i + 1} (${e.name || "?"}): routing number fails the ABA check digit.` };
    }
    if (!e.accountNumber || e.accountNumber.replace(/\s/g, "").length === 0) {
      return { ok: false, error: `Entry ${i + 1} (${e.name || "?"}): account number is required.` };
    }
    if (e.accountType !== "checking" && e.accountType !== "savings") {
      return { ok: false, error: `Entry ${i + 1} (${e.name || "?"}): account type must be checking or savings.` };
    }
    if (e.prenote) {
      if (e.amountCents !== 0) {
        return { ok: false, error: `Entry ${i + 1} (${e.name || "?"}): a prenote must be $0.00.` };
      }
    } else if (!Number.isInteger(e.amountCents) || e.amountCents <= 0) {
      return { ok: false, error: `Entry ${i + 1} (${e.name || "?"}): amount must be a positive whole number of cents.` };
    }
  }

  // A prenote and a live credit to the SAME account in one file would skip
  // the Nacha 3-banking-day wait. Refuse it (and a doubled prenote).
  const acctKey = (e: AchEntry) =>
    `${e.routing.replace(/\D/g, "")}:${e.accountNumber.replace(/[\s-]/g, "").toUpperCase().replace(/^0+(?=.)/, "")}:${e.accountType}`;
  const prenoted = new Map<string, number>();
  for (const e of entries) {
    if (e.prenote) prenoted.set(acctKey(e), (prenoted.get(acctKey(e)) ?? 0) + 1);
  }
  for (const [k, n] of prenoted) {
    if (n > 1) return { ok: false, error: `The same account (ending ${k.split(":")[1].slice(-4)}) has ${n} prenotes in this file.` };
  }
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (!e.prenote && prenoted.has(acctKey(e))) {
      return {
        ok: false,
        error: `Entry ${i + 1} (${e.name || "?"}): this account is being prenoted in the same file. Nacha requires ${PRENOTE_WAIT_BANKING_DAYS} banking days between a prenote and the first live credit.`,
      };
    }
  }

  const created = input.createdAt ?? effectiveDate;
  const fileIdModifier = (input.fileIdModifier ?? "A").slice(0, 1).toUpperCase();
  const originDfi8 = originator.originatingDfi.replace(/\D/g, "").slice(0, 8);

  const lines: string[] = [];

  // ---- 1: File Header, 5: Batch Header (single batch, credits only) ----
  // R41 S2: built by the same exported helpers the "What Timberland sees"
  // card uses, so the preview is these exact bytes.
  lines.push(fileHeaderRecord(originator, created, fileIdModifier));
  const batchNumber = 1;
  lines.push(batchHeaderRecord(originator, secCode, input.companyEntryDescription, effectiveDate, batchNumber));

  // ---- 6: Entry Detail records ----
  let hash = 0;
  let totalCents = 0;
  entries.forEach((e, idx) => {
    const rDfi8 = dfiId8(e.routing);
    const check = routingCheckDigit(e.routing);
    hash += Number(rDfi8);
    totalCents += e.amountCents;
    const traceSeq = idx + 1;
    lines.push(
      "6" +
        transactionCode(e) + // 2-3 transaction code (22/32 live, 23/33 prenote)
        numeric(rDfi8, 8) + // 4-11 receiving DFI id
        numeric(check, 1) + // 12 check digit
        alpha(e.accountNumber, 17) + // 13-29 DFI account number (left-justified)
        numeric(e.amountCents, 10) + // 30-39 amount
        alpha(e.idNumber ?? "", 15) + // 40-54 identification number
        alpha(e.name, 22) + // 55-76 receiving name
        " ".repeat(2) + // 77-78 discretionary data
        "0" + // 79 addenda record indicator (none)
        numeric(originDfi8, 8) + // 80-87 trace: ODFI first 8
        numeric(traceSeq, 7), // 88-94 entry sequence
    );
  });

  const hash10 = numeric(hash, 10); // rightmost 10 digits
  const entryCount = entries.length;

  // ---- 8: Batch Control ----
  lines.push(
    "8" +
      "220" + // service class code (match header)
      numeric(entryCount, 6) + // 5-10 entry/addenda count
      hash10 + // 11-20 entry hash
      numeric(0, 12) + // 21-32 total debit
      numeric(totalCents, 12) + // 33-44 total credit
      alpha(originator.companyId, 10) + // 45-54 company id
      " ".repeat(19) + // 55-73 MAC
      " ".repeat(6) + // 74-79 reserved
      numeric(originDfi8, 8) + // 80-87 originating DFI
      numeric(batchNumber, 7), // 88-94 batch number
  );

  // ---- 9: File Control ----
  // Records so far: 1 header + 1 batch header + entries + 1 batch control + this file control
  const preFileControl = lines.length + 1;
  const blockCount = Math.ceil(preFileControl / 10);
  lines.push(
    "9" +
      numeric(1, 6) + // 2-7 batch count
      numeric(blockCount, 6) + // 8-13 block count
      numeric(entryCount, 8) + // 14-21 entry/addenda count
      hash10 + // 22-31 entry hash
      numeric(0, 12) + // 32-43 total debit
      numeric(totalCents, 12) + // 44-55 total credit
      " ".repeat(39), // 56-94 reserved
  );

  // ---- Padding: 9-filled records to next multiple of 10 ----
  const pad = (10 - (lines.length % 10)) % 10;
  for (let i = 0; i < pad; i += 1) lines.push("9".repeat(94));

  const file = lines.join("\n") + "\n";
  // R41 S2: re-read our own output. A file that is not credits-only, or does
  // not carry Timberland's originator fields where the bank reads them, is
  // never handed over (Brenda: "Make sure that it's an unbalanced batch").
  const shape = checkBuiltFileShape(file, originator);
  if (shape.length) return { ok: false, error: `The ACH file failed its own check, so it was not released: ${shape.join("; ")}.` };
  return { ok: true, file, totalCents, entryCount, recordCount: lines.length };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runNachaCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // R41 S2: the one originator every fixture uses. Timberland's routing and
  // ODFI, Brenda's company name, and "1" + a TEST EIN (not Greenway's).
  const GW: AchOriginator = {
    destinationRouting: "325170754",
    destinationName: "TIMBERLAND BANK",
    immediateOrigin: "1911234567",
    companyName: "Greenway Marijuana",
    companyId: "1911234567",
    originatingDfi: "32517075",
    companyEin: "911234567",
  };

  // field helpers
  ok(alpha("Hello", 10) === "HELLO     ", "alpha left-justify blank-pad + uppercase");
  ok(alpha("toolongvalue", 4) === "TOOL", "alpha truncates");
  ok(numeric(123, 6) === "000123", "numeric right-justify zero-pad");
  ok(numeric("12345678901", 10) === "2345678901", "numeric truncates leftmost");
  ok(sanitizeAlpha("Café #1!") === "CAF 1", "sanitizeAlpha strips");

  // routing validation — 021000021 (Chase) is a valid ABA
  ok(isValidRouting("021000021"), "valid routing passes");
  ok(!isValidRouting("021000022"), "bad check digit fails");
  ok(!isValidRouting("12345"), "short routing fails");
  ok(dfiId8("021000021") === "02100002", "dfiId8");
  ok(routingCheckDigit("021000021") === "1", "check digit");

  // build a 2-entry PPD file
  const res = buildNachaFile({
    // R41 S2 fixture update: Timberland's routing/ODFI and "1" + a test EIN
    // (was 125000105 / 1911234567, which Timberland's check now refuses).
    originator: GW,
    entries: [
      { accountType: "checking", routing: "021000021", accountNumber: "123456789", amountCents: 150000, name: "Jane Doe", idNumber: "EMP1" },
      { accountType: "savings", routing: "011401533", accountNumber: "987654321", amountCents: 249999, name: "John Roe", idNumber: "EMP2" },
    ],
    secCode: "PPD",
    companyEntryDescription: "PAYROLL",
    effectiveDate: new Date("2024-06-14T00:00:00Z"),
    createdAt: new Date("2024-06-12T09:30:00Z"),
    fileIdModifier: "A",
  });
  ok(res.ok, "build succeeds");
  if (res.ok) {
    const rows = res.file.trimEnd().split("\n");
    ok(rows.every((r) => r.length === 94), "every record is exactly 94 chars");
    ok(rows.length % 10 === 0, "record count is a multiple of 10");
    ok(rows[0][0] === "1" && rows[0].startsWith("101"), "file header 1 + priority 01");
    ok(rows[1][0] === "5" && rows[1].startsWith("5220"), "batch header 5 + SCC 220");
    // two 6-records
    const sixes = rows.filter((r) => r[0] === "6");
    ok(sixes.length === 2, "two entry detail records");
    ok(sixes[0].startsWith("622"), "first entry checking credit = 22");
    ok(sixes[1].startsWith("632"), "second entry savings credit = 32");
    // amount field positions 30-39 (0-indexed 29..38) on first entry = 0000150000
    ok(sixes[0].slice(29, 39) === "0000150000", "entry amount encoded in cents");
    const eight = rows.find((r) => r[0] === "8")!;
    ok(eight.startsWith("8220"), "batch control 8 + SCC 220");
    // total credit in batch control positions 33-44 (0-indexed 32..44) = 150000+249999=399999
    ok(eight.slice(32, 44) === "000000399999", "batch total credit cents");
    const nine = rows.find((r) => r[0] === "9" && !r.startsWith("999999"))!;
    ok(nine.slice(0, 1) === "9", "file control 9");
    ok(nine.slice(43, 55) === "000000399999", "file total credit cents");
    // entry hash = 02100002 + 01140153 = 03240155
    ok(eight.slice(10, 20) === "0003240155", "entry hash sum of DFI ids");
    ok(res.totalCents === 399999, "total cents");
    ok(res.entryCount === 2, "entry count");
    // 6 real records (1+5+6+6+8+9) → 4 padding records to reach 10
    ok(rows.filter((r) => r === "9".repeat(94)).length === 4, "padding records added");
  }

  // rejects
  const bad = buildNachaFile({
    originator: GW,
    entries: [{ accountType: "checking", routing: "021000022", accountNumber: "1", amountCents: 100, name: "X" }],
    secCode: "PPD",
    companyEntryDescription: "PAYROLL",
    effectiveDate: new Date(),
  });
  ok(!bad.ok && /routing number fails the ABA check digit/.test(bad.error), "bad receiver routing rejected for that reason");
  const noEntries = buildNachaFile({
    originator: GW,
    entries: [],
    secCode: "PPD",
    companyEntryDescription: "PAYROLL",
    effectiveDate: new Date(),
  });
  ok(!noEntries.ok && /No entries/.test(noEntries.error), "empty entries rejected for that reason");
  const zeroAmt = buildNachaFile({
    originator: GW,
    entries: [{ accountType: "checking", routing: "021000021", accountNumber: "1", amountCents: 0, name: "X" }],
    secCode: "PPD",
    companyEntryDescription: "PAYROLL",
    effectiveDate: new Date(),
  });
  ok(!zeroAmt.ok && /positive whole number of cents/.test(zeroAmt.error), "zero amount rejected for that reason");

  // R39 S3: prenotes (23 checking / 33 savings, $0)
  const O = GW;
  const pre = buildNachaFile({
    originator: O,
    entries: [
      { accountType: "checking", routing: "021000021", accountNumber: "111", amountCents: 0, name: "A", prenote: true },
      { accountType: "savings", routing: "011401533", accountNumber: "222", amountCents: 0, name: "B", prenote: true },
      { accountType: "checking", routing: "021000021", accountNumber: "333", amountCents: 5000, name: "C" },
    ],
    secCode: "PPD",
    companyEntryDescription: "PAYROLL",
    effectiveDate: new Date("2026-03-02T00:00:00Z"),
  });
  ok(pre.ok, "prenote file builds");
  if (pre.ok) {
    const sx = pre.file.split("\n").filter((r) => r[0] === "6");
    ok(sx[0].startsWith("623") && sx[1].startsWith("633") && sx[2].startsWith("622"), "prenote codes 23/33, live 22");
    ok(sx[0].slice(29, 39) === "0000000000" && sx[1].slice(29, 39) === "0000000000", "prenote amount field is 10 zeros");
    ok(pre.totalCents === 5000 && pre.entryCount === 3, "prenotes count as entries, add $0");
    ok(pre.file.split("\n").every((r) => r === "" || r.length === 94), "prenote file stays 94 wide");
  }
  const preNonZero = buildNachaFile({ originator: O, entries: [{ accountType: "checking", routing: "021000021", accountNumber: "1", amountCents: 1, name: "X", prenote: true }], secCode: "PPD", companyEntryDescription: "P", effectiveDate: new Date() });
  ok(!preNonZero.ok && /prenote must be \$0/.test(preNonZero.error), "a prenote with money is refused");
  const sameFile = buildNachaFile({
    originator: O,
    entries: [
      { accountType: "checking", routing: "021000021", accountNumber: "00123", amountCents: 0, name: "X", prenote: true },
      { accountType: "checking", routing: "021-000-021", accountNumber: "123", amountCents: 100, name: "X" },
    ],
    secCode: "PPD",
    companyEntryDescription: "P",
    effectiveDate: new Date(),
  });
  ok(!sameFile.ok && /3 banking days/.test(sameFile.error), "prenote + live to the same account (formatting ignored) refused");
  const otherType = buildNachaFile({
    originator: O,
    entries: [
      { accountType: "checking", routing: "021000021", accountNumber: "123", amountCents: 0, name: "X", prenote: true },
      { accountType: "savings", routing: "021000021", accountNumber: "123", amountCents: 100, name: "X" },
    ],
    secCode: "PPD",
    companyEntryDescription: "P",
    effectiveDate: new Date(),
  });
  ok(otherType.ok, "prenote checking + live savings at the same number are different accounts");
  const dupPre = buildNachaFile({
    originator: O,
    entries: [
      { accountType: "checking", routing: "021000021", accountNumber: "123", amountCents: 0, name: "X", prenote: true },
      { accountType: "checking", routing: "021000021", accountNumber: "123", amountCents: 0, name: "X", prenote: true },
    ],
    secCode: "PPD",
    companyEntryDescription: "P",
    effectiveDate: new Date(),
  });
  ok(!dupPre.ok && /2 prenotes/.test(dupPre.error), "doubled prenote refused");
  ok(transactionCode({ accountType: "checking" }) === "22" && transactionCode({ accountType: "savings", prenote: true }) === "33", "transactionCode table");
  ok(PRENOTE_WAIT_BANKING_DAYS === 3, "Nacha prenote wait is 3 banking days");

  // R41 S2: Timberland originator, SEC allowlist and output self-check, all
  // INSIDE the builder so no caller can skip them.
  const one: AchEntry[] = [{ accountType: "checking", routing: "021000021", accountNumber: "123", amountCents: 100, name: "X" }];
  const b = (o: Partial<AchOriginator>, sec: string = "PPD") =>
    buildNachaFile({ originator: { ...GW, ...o }, entries: one, secCode: sec as "PPD", companyEntryDescription: "PAYROLL", effectiveDate: new Date("2026-10-23T00:00:00Z"), createdAt: new Date("2026-10-20T18:00:00Z") });
  const good = b({});
  ok(good.ok, "a Greenway/Timberland originator builds");
  if (good.ok) {
    const [h1, h5] = good.file.split("\n");
    ok(h1.slice(3, 13) === " 325170754", "file header 4-13 = blank + Timberland routing");
    ok(h1.slice(13, 23) === "1911234567", "file header 14-23 = 1 + EIN");
    ok(h1.slice(63, 86) === "GREENWAY MARIJUANA     ", "file header 64-86 keeps the full trade name (Q11)");
    ok(h5.slice(4, 20) === "GREENWAY MARIJUA", "batch 5-20 = Brenda's 16 characters");
    ok(h5.slice(20, 40) === " ".repeat(20), "batch 21-40 discretionary stays blank (Q14 open)");
    ok(h5.slice(40, 50) === "1911234567", "batch 41-50 = Company ID");
    ok(h5.slice(79, 87) === "32517075", "batch 80-87 = Timberland ODFI");
    ok(!/(?<!1)911234567/.test(good.file), "the EIN only ever appears as 1+EIN, never on its own");
  }
  const refused = (r: BuildNachaResult, re: RegExp) => !r.ok && re.test(r.error);
  ok(refused(b({ companyEin: "" }), /EIN is not entered/), "no EIN: no file");
  ok(refused(b({ companyId: "911234567", immediateOrigin: "911234567" }), /only 9 digits/), "9-digit IDs: no file");
  ok(refused(b({ companyId: "1999999999" }), /does not match the company EIN/), "Company ID for another EIN: no file");
  ok(refused(b({ immediateOrigin: "1999999999" }), /Immediate Origin "1999999999" does not match/), "Immediate Origin for another EIN: no file");
  ok(refused(b({ destinationRouting: "125000105" }), /not Timberland's/), "another bank's routing: no file");
  ok(refused(b({ originatingDfi: "12500010" }), /Originating DFI/), "another ODFI: no file");
  ok(refused(b({ companyName: "Lymans Marijuana LLC" }), /GREENWAY MARIJUA/), "the legal name in the batch: no file");
  ok(refused(b({ destinationName: "" }), /Bank name is blank/), "blank bank name: no file");
  ok(refused(b({}, "CTX"), /Schedule E/), "CTX refused by the builder");
  ok(refused(b({}, "WEB"), /not an entry type/), "WEB refused by the builder");
  ok(refused(b({ companyEin: "" }, "CTX"), /Schedule E/), "the SEC refusal comes first");
  // the originator is checked before the entries, so a bad setup is reported even with no entries
  const noneBad = buildNachaFile({ originator: { ...GW, companyEin: "" }, entries: [], secCode: "PPD", companyEntryDescription: "P", effectiveDate: new Date() });
  ok(refused(noneBad, /EIN/), "a bad originator is reported before 'no entries'");

  // R41 S2: checkBuiltFileShape re-reads the builder's own output. Each check
  // is proven by tampering ONE field of a good file (the builder cannot make
  // these, so the only way to test the net is to cut a hole in a real file).
  if (good.ok) {
    const rows = good.file.split("\n");
    const put = (i: number, from: number, text: string) => {
      const r = [...rows];
      r[i] = r[i]!.slice(0, from) + text + r[i]!.slice(from + text.length);
      return r.join("\n");
    };
    const i5 = rows.findIndex((r) => r[0] === "5");
    const i8 = rows.findIndex((r) => r[0] === "8");
    const i9 = rows.findIndex((r) => r[0] === "9");
    const i6 = rows.findIndex((r) => r[0] === "6");
    const has = (f: string, re: RegExp) => checkBuiltFileShape(f, GW).some((m) => re.test(m));
    ok(checkBuiltFileShape(good.file, GW).length === 0, "shape: a good file has no problems");
    ok(has(put(i5, 4, "GREENWAY CANNABI"), /Company Name is not/), "shape: a wrong batch name is caught");
    ok(has(put(i5, 79, "12500010"), /Originating DFI is not Timberland/), "shape: a wrong batch ODFI is caught");
    ok(has(put(i5, 40, "1999999999"), /batch Company ID/), "shape: a wrong batch Company ID is caught");
    ok(has(put(i5, 50, "CTX"), /entry type "CTX"/), "shape: a restricted SEC in the batch is caught");
    ok(has(put(i5, 1, "200"), /credits-only/), "shape: a mixed (200) batch is caught (Brenda: unbalanced)");
    ok(has(put(i8, 1, "200"), /batch control is not service class 220/), "shape: a mixed batch control is caught");
    ok(has(put(i8, 20, "000000000001"), /batch has a debit total/), "shape: a batch debit total is caught");
    ok(has(put(i9, 31, "000000000001"), /file has a debit total/), "shape: a file debit total is caught");
    ok(has(put(i6, 1, "27"), /transaction code 27/), "shape: a debit entry (27) is caught (no offset)");
    ok(has(put(0, 3, " 125000105"), /routing number/), "shape: another bank in the file header is caught");
    ok(has(put(0, 13, "1999999999"), /Immediate Origin/), "shape: a wrong Immediate Origin is caught");
    ok(has(rows.slice(1).join("\n"), /not a file header/), "shape: a missing file header is caught");
    ok(has(rows.map((r, i) => (i === 0 ? r + " " : r)).join("\n"), /94 characters/), "shape: a 95-character record is caught");
  }

  console.log(`nacha-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
