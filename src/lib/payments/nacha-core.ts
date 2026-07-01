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
// Field helpers
// ---------------------------------------------------------------------------

/** Left-justify + blank-pad (alphanumeric), truncating to width. */
export function alpha(value: string | null | undefined, width: number): string {
  const s = sanitizeAlpha(value ?? "");
  if (s.length >= width) return s.slice(0, width);
  return s + " ".repeat(width - s.length);
}

/** Right-justify + zero-pad (numeric), truncating leftmost if too long. */
export function numeric(value: number | string, width: number): string {
  const digits = String(value).replace(/[^0-9]/g, "");
  if (digits.length >= width) return digits.slice(digits.length - width);
  return "0".repeat(width - digits.length) + digits;
}

/** Strip to the ASCII subset NACHA permits (upper-case, digits, space, basic). */
export function sanitizeAlpha(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 .,&/\-]/g, "")
    .replace(/\s+/g, " ")
    .trimEnd();
}

/** ABA routing number check-digit validation (mod-10, weights 3-7-1). */
export function isValidRouting(routing: string | null | undefined): boolean {
  const r = (routing ?? "").replace(/\D/g, "");
  if (r.length !== 9) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(r[i]) * w[i];
  return sum % 10 === 0;
}

/** First 8 digits of a 9-digit routing number (Receiving/Originating DFI ID). */
export function dfiId8(routing: string): string {
  return routing.replace(/\D/g, "").slice(0, 8);
}

/** Check digit = 9th digit of the routing number. */
export function routingCheckDigit(routing: string): string {
  return routing.replace(/\D/g, "").slice(8, 9);
}

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
};

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

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildNachaFile(input: BuildNachaInput): BuildNachaResult {
  const { originator, entries, secCode, effectiveDate } = input;

  // --- Validate ---
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
    if (!Number.isInteger(e.amountCents) || e.amountCents <= 0) {
      return { ok: false, error: `Entry ${i + 1} (${e.name || "?"}): amount must be a positive whole number of cents.` };
    }
  }

  const created = input.createdAt ?? effectiveDate;
  const fileIdModifier = (input.fileIdModifier ?? "A").slice(0, 1).toUpperCase();
  const originDfi8 = originator.originatingDfi.replace(/\D/g, "").slice(0, 8);

  const lines: string[] = [];

  // ---- 1: File Header ----
  lines.push(
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
      " ".repeat(8), // 87-94 reference code
  );

  // ---- 5: Batch Header (single batch, credits only = SCC 220) ----
  const batchNumber = 1;
  lines.push(
    "5" +
      "220" + // service class code: credits only
      alpha(originator.companyName, 16) + // 5-20
      " ".repeat(20) + // 21-40 discretionary data
      alpha(originator.companyId, 10) + // 41-50
      alpha(secCode, 3) + // 51-53
      alpha(input.companyEntryDescription, 10) + // 54-63
      yymmdd(effectiveDate) + // 64-69 descriptive date
      yymmdd(effectiveDate) + // 70-75 effective entry date
      " ".repeat(3) + // 76-78 reserved (settlement)
      "1" + // 79 originator status code
      numeric(originDfi8, 8) + // 80-87 originating DFI id
      numeric(batchNumber, 7), // 88-94
  );

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
        TXN_CODE[e.accountType] + // 2-3 transaction code
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
    originator: {
      destinationRouting: "125000105", // valid ABA (Washington Federal) for test
      destinationName: "Timberland Bank",
      immediateOrigin: "1911234567",
      companyName: "Greenway Marijuana",
      companyId: "1911234567",
      originatingDfi: "125000105",
    },
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
    originator: { destinationRouting: "125000105", destinationName: "T", immediateOrigin: "1", companyName: "G", companyId: "1", originatingDfi: "125000105" },
    entries: [{ accountType: "checking", routing: "021000022", accountNumber: "1", amountCents: 100, name: "X" }],
    secCode: "PPD",
    companyEntryDescription: "PAYROLL",
    effectiveDate: new Date(),
  });
  ok(!bad.ok, "bad receiver routing rejected");
  const noEntries = buildNachaFile({
    originator: { destinationRouting: "125000105", destinationName: "T", immediateOrigin: "1", companyName: "G", companyId: "1", originatingDfi: "125000105" },
    entries: [],
    secCode: "PPD",
    companyEntryDescription: "PAYROLL",
    effectiveDate: new Date(),
  });
  ok(!noEntries.ok, "empty entries rejected");
  const zeroAmt = buildNachaFile({
    originator: { destinationRouting: "125000105", destinationName: "T", immediateOrigin: "1", companyName: "G", companyId: "1", originatingDfi: "125000105" },
    entries: [{ accountType: "checking", routing: "021000021", accountNumber: "1", amountCents: 0, name: "X" }],
    secCode: "PPD",
    companyEntryDescription: "PAYROLL",
    effectiveDate: new Date(),
  });
  ok(!zeroAmt.ok, "zero amount rejected");

  console.log(`nacha-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
