/**
 * src/lib/atm/atm-core.ts  (SLICE A-1)
 *
 * PURE core for the ATM / PAI reporting feature. No I/O, no `server-only`, no
 * Supabase — unit-testable with `npx tsx scripts/compliance/run-pure-selftests.ts`.
 *
 * WHAT THIS DOES
 * --------------
 * PAI Reports (paireports.com) exposes each report as a `*.event` endpoint whose
 * "Open CSV file in Excel" custom command returns CSV (see
 * outputs/PAI_PORTAL_REFERENCE.md — verified from Michael's own portal). This
 * module turns that CSV text into typed, cents-based rows we can store and
 * reconcile. The network fetch (Login.event → report → DownloadCSV) lives in a
 * separate server-only client added in a later slice; keeping the parsing/money
 * math PURE means it is fully regression-tested with zero secrets.
 *
 * STANDING RULES
 * --------------
 *  • MONEY IN CENTS. Dollars from the CSV are converted to integer cents ONCE,
 *    here at the boundary (dollarsToCents), then only integer math downstream.
 *  • NEVER GUESS. Column matching is tolerant (case/space/punct-insensitive) and
 *    driven by the VERIFIED column labels from Michael's portal. If a required
 *    column is absent, the mapper reports a problem rather than inventing a value.
 *  • READ-ONLY. Nothing here moves money; these are report readers.
 *
 * VERIFIED report columns (outputs/PAI_PORTAL_REFERENCE.md):
 *  • ATM Cash Load Report : Terminal Number | Location | Group | Trx Time | Cash Load | Balance
 *  • Simple Summary Report: Terminal | Location | Settlement Date | Total Trxs | WO Trxs |
 *                           Surch WDs | Surch | Settlement
 */

// ---------------------------------------------------------------------------
// Money: dollars → integer cents, ONCE, at the boundary.
// ---------------------------------------------------------------------------

/**
 * Parse a money string from a PAI CSV cell into integer CENTS.
 * Accepts "$1,800.00", "1800", "1,800.5", "(2.50)" (accounting negative),
 * "-2.50", " $20 ". Returns null for blank/garbage (caller decides how strict).
 * Rounds to the nearest cent to avoid float drift (e.g. 10.005 → 1001? no: we
 * round half-away-from-zero on the cent, matching how currency reports round).
 */
export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return roundToCents(input);
  }
  let s = input.trim();
  if (s === "") return null;

  // Accounting negatives: (1,234.56) => -1234.56
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }

  // Strip currency symbol and thousands separators / stray spaces.
  s = s.replace(/[$\s]/g, "").replace(/,/g, "");

  // Must now look like a plain decimal number.
  if (!/^\d+(\.\d+)?$/.test(s)) return null;

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const cents = roundToCents(value);
  return negative ? -cents : cents;
}

/** Round a dollar amount to integer cents, half-away-from-zero. */
function roundToCents(dollars: number): number {
  const sign = dollars < 0 ? -1 : 1;
  // Add a tiny epsilon before flooring to defeat binary-float undershoot
  // (e.g. 10.005 * 100 = 1000.4999999). 1e-6 of a cent is safe.
  return sign * Math.floor(Math.abs(dollars) * 100 + 0.5 + 1e-9);
}

// ---------------------------------------------------------------------------
// CSV: minimal, correct RFC-4180-style parser (quotes, escaped quotes, CRLF).
// ---------------------------------------------------------------------------

/** Parse CSV text into an array of string-cell rows. Handles quoted fields
 * containing commas, embedded quotes ("") and newlines. Skips a trailing blank
 * line. Does NOT interpret headers — that is the mapper's job. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    row.push(field);
    field = "";
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      // swallow CR; handle the row on the following LF (or end)
      if (text[i + 1] === "\n") {
        pushRow();
        i += 2;
        continue;
      }
      pushRow();
      i += 1;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Flush the final field/row unless the text ended exactly on a newline.
  if (field !== "" || row.length > 0) {
    pushRow();
  }
  // Drop a single trailing empty row (common when files end with a newline).
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }
  return rows;
}

/** Normalize a header label for tolerant matching: lowercase, strip all
 * non-alphanumerics. "Trx Time" → "trxtime"; "Surch WDs" → "surchwds". */
export function normalizeHeader(label: string): string {
  return (label ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Build a header→columnIndex map from the first row of a parsed CSV. */
export function headerIndex(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((label, idx) => {
    const key = normalizeHeader(label);
    if (key && !(key in map)) map[key] = idx;
  });
  return map;
}

/** Find the first present column index among a list of accepted header aliases
 * (already normalized). Returns -1 if none present. */
export function pickColumn(map: Record<string, number>, aliases: string[]): number {
  for (const a of aliases) {
    if (a in map) return map[a];
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Dates: PAI shows M/D/YY and MM/DD/YYYY. Normalize to ISO yyyy-mm-dd (date-only).
// ---------------------------------------------------------------------------

/** Parse a US-style date (M/D/YY, MM/DD/YYYY, optional trailing time) to an ISO
 * date string yyyy-mm-dd, or null if unparseable. 2-digit years map to 2000+. */
export function parseUsDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (s === "") return null;
  // Take the date part before any space (drops the time when present).
  const datePart = s.split(/\s+/)[0];
  const m = datePart.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) {
    // Already ISO?
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    return null;
  }
  const [, mm, dd, yy] = m;
  let year = Number(yy);
  if (yy.length === 2) year += 2000;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const p2 = (x: number) => String(x).padStart(2, "0");
  return `${year}-${p2(month)}-${p2(day)}`;
}

// ---------------------------------------------------------------------------
// Mapped row types (all money in CENTS).
// ---------------------------------------------------------------------------

export type CashLoadRow = {
  terminalId: string;
  loadedAtRaw: string; // original "Trx Time" text (kept for exact loaded_at)
  loadDate: string | null; // ISO yyyy-mm-dd
  cashLoadCents: number;
  balanceAfterCents: number | null;
  raw: Record<string, string>;
};

export type SettlementRow = {
  terminalId: string;
  settlementDate: string; // ISO yyyy-mm-dd
  totalTrx: number | null;
  withdrawalTrx: number | null; // "WD Trxs"
  surchargedWdTrx: number | null; // "Surcharge WDs"
  terminalTransactionCents: number | null; // vault-cash deposit leg (from FundsMovement "Transaction")
  surchargeCents: number | null; // fee revenue ("Surch", or FundsMovement "Surcharge")
  settlementTotalCents: number | null; // "Settlement" column (Simple Summary only)
  raw: Record<string, string>;
};

export type MapProblem = { row: number; message: string };

export type MapResult<T> = { rows: T[]; problems: MapProblem[] };

function rowObject(header: string[], cells: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  header.forEach((h, idx) => {
    o[h] = cells[idx] ?? "";
  });
  return o;
}

// ---------------------------------------------------------------------------
// Mapper: ATM Cash Load Report → CashLoadRow[]  (Q4 auto cash-load source)
// Verified columns: Terminal Number | Location | Group | Trx Time | Cash Load | Balance
// ---------------------------------------------------------------------------
export function mapCashLoadCsv(csv: string): MapResult<CashLoadRow> {
  const table = parseCsv(csv);
  const problems: MapProblem[] = [];
  const rows: CashLoadRow[] = [];
  if (table.length === 0) return { rows, problems };

  const header = table[0];
  const map = headerIndex(header);
  const iTerminal = pickColumn(map, ["terminalnumber", "terminal", "terminalid"]);
  const iTrxTime = pickColumn(map, ["trxtime", "loaddate", "date", "datetime"]);
  const iCashLoad = pickColumn(map, ["cashload", "load", "amount"]);
  const iBalance = pickColumn(map, ["balance"]);

  if (iTerminal < 0 || iCashLoad < 0) {
    problems.push({
      row: 0,
      message:
        "cash-load CSV missing required column(s): need a terminal column and a 'Cash Load' column",
    });
    return { rows, problems };
  }

  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r];
    if (cells.length === 1 && cells[0].trim() === "") continue; // blank line
    const terminalId = (cells[iTerminal] ?? "").trim();
    const cashLoadCents = dollarsToCents(cells[iCashLoad]);
    if (!terminalId) {
      problems.push({ row: r, message: "missing terminal id" });
      continue;
    }
    if (cashLoadCents === null) {
      problems.push({ row: r, message: `unparseable Cash Load value: "${cells[iCashLoad] ?? ""}"` });
      continue;
    }
    const loadedAtRaw = iTrxTime >= 0 ? (cells[iTrxTime] ?? "").trim() : "";
    rows.push({
      terminalId,
      loadedAtRaw,
      loadDate: parseUsDate(loadedAtRaw),
      cashLoadCents,
      balanceAfterCents: iBalance >= 0 ? dollarsToCents(cells[iBalance]) : null,
      raw: rowObject(header, cells),
    });
  }
  return { rows, problems };
}

// ---------------------------------------------------------------------------
// Mapper: Simple Summary / Terminal Trx Data → SettlementRow[]
//   (transaction counts + surcharge & settlement totals by settlement date)
// CONFIRMED columns from Michael's REAL export (TerminalTrxData-*.csv):
//   Terminal | Location | Settlement Date | Total Trxs | WD Trxs | Surcharge WDs | Surch | Settlement
// (The PAI portal reference had earlier GUESSED "WO Trxs"/"Surch WDs"; the real
//  labels are "WD Trxs" and "Surcharge WDs". We accept both, real first.)
// NOTE: this report does NOT carry the vault-cash (terminal_transaction) deposit
// leg. That leg is the deposit-side truth from the FundsMovement report
// (Settlement Type = "Transaction"); see mapFundsMovementCsv below. So we leave
// terminalTransactionCents null here and capture Surch (fee) + Settlement total.
// ---------------------------------------------------------------------------
export function mapSimpleSummaryCsv(csv: string): MapResult<SettlementRow> {
  const table = parseCsv(csv);
  const problems: MapProblem[] = [];
  const rows: SettlementRow[] = [];
  if (table.length === 0) return { rows, problems };

  const header = table[0];
  const map = headerIndex(header);
  const iTerminal = pickColumn(map, ["terminal", "terminalnumber", "terminalid"]);
  const iDate = pickColumn(map, ["settlementdate", "settlement", "date"]);
  const iTotal = pickColumn(map, ["totaltrxs", "totaltrx", "totaltransactions"]);
  // "WD Trxs" (real) -> "wdtrxs"; legacy-guessed "WO Trxs" -> "wotrxs" kept as fallback.
  const iWo = pickColumn(map, ["wdtrxs", "wdtrx", "wotrxs", "wotrx", "withdrawaltrxs"]);
  // "Surcharge WDs" (real) -> "surchargewds"; legacy-guessed "Surch WDs" -> "surchwds".
  const iSurchWd = pickColumn(map, ["surchargewds", "surchargewd", "surchwds", "surchargedwds", "surchwd"]);
  const iSurch = pickColumn(map, ["surch", "surcharge", "surchargeamount"]);
  // The amount column is labeled just "Settlement" (normalizes to "settlement").
  // The date column is "Settlement Date" (normalizes to "settlementdate"), so
  // there is NO collision — "settlement" unambiguously means the amount here.
  const iSettlement = pickColumn(map, [
    "settlement",
    "settlementamount",
    "settlementtotal",
    "settled",
  ]);

  if (iTerminal < 0 || iDate < 0) {
    problems.push({
      row: 0,
      message: "simple-summary CSV missing required column(s): need Terminal and Settlement Date",
    });
    return { rows, problems };
  }

  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r];
    if (cells.length === 1 && cells[0].trim() === "") continue;
    const terminalId = (cells[iTerminal] ?? "").trim();
    const settlementDate = parseUsDate(cells[iDate]);
    if (!terminalId) {
      problems.push({ row: r, message: "missing terminal id" });
      continue;
    }
    if (!settlementDate) {
      problems.push({ row: r, message: `unparseable Settlement Date: "${cells[iDate] ?? ""}"` });
      continue;
    }
    rows.push({
      terminalId,
      settlementDate,
      totalTrx: iTotal >= 0 ? toIntOrNull(cells[iTotal]) : null,
      withdrawalTrx: iWo >= 0 ? toIntOrNull(cells[iWo]) : null,
      surchargedWdTrx: iSurchWd >= 0 ? toIntOrNull(cells[iSurchWd]) : null,
      terminalTransactionCents: null,
      surchargeCents: iSurch >= 0 ? dollarsToCents(cells[iSurch]) : null,
      settlementTotalCents: iSettlement >= 0 ? dollarsToCents(cells[iSettlement]) : null,
      raw: rowObject(header, cells),
    });
  }
  return { rows, problems };
}

// ---------------------------------------------------------------------------
// Mapper: FundsMovement By Account By Day → grouped deposit legs
//   (the DEPOSIT-SIDE TRUTH; PAI's equivalent of the "Bank Deposits" report)
// CONFIRMED columns from Michael's REAL export (FundsMovementByAccountByDay-*.csv):
//   Market Partner Code | Market Partner | Acct # | Group | Location |
//   Settlement Date | Terminal | Settlement Type | Amount
//
// LONG/tidy format: one row per money leg, and there can be MULTIPLE rows per
// (Settlement Date, Terminal) for the SAME Settlement Type. "Settlement Type" is
// one of {"Transaction", "Surcharge"}:
//   • Transaction = the vault-cash re-deposit the bank receives  → terminalTransactionCents
//   • Surcharge   = the fee revenue (Michael keeps 100%)         → surchargeCents
// The bank posts these as TWO SEPARATE deposits per settlement (Michael's Q5).
//
// We GROUP by (settlementDate, terminalId) and SUM each leg, so the result is one
// FundsMovementRow per settlement day carrying both expected deposit legs. Rows
// are returned sorted by (date, terminal) for stable output. Unknown Settlement
// Type values are recorded as problems and skipped — we never guess.
// ---------------------------------------------------------------------------

export type FundsMovementRow = {
  terminalId: string;
  settlementDate: string; // ISO yyyy-mm-dd
  terminalTransactionCents: number | null; // summed "Transaction" legs
  surchargeCents: number | null; // summed "Surcharge" legs
  accountTail: string | null; // masked bank account (e.g. "******6228") if present
  legCount: number; // how many source rows folded into this group
  /**
   * How many source rows folded into EACH leg, kept separately from `legCount`.
   *
   * WHY THE PER-LEG COUNTS EXIST (books-69 step 3)
   * ---------------------------------------------
   * A settlement day normally contributes exactly two rows: one Transaction and
   * one Surcharge. When Payment Alliance corrects a day it does not restate the
   * original row - it appends a second row for the affected leg. Michael's real
   * export contains four such rows in one 115-day window:
   *
   *   2026-06-27  Transaction  $3,060.00  and  -$100.00
   *   2026-07-02  Transaction  $4,980.00  and  +$100.00
   *   2026-07-02  Surcharge      $157.50  and    +$5.00
   *   2026-07-09  Transaction  $2,500.00  and  +$100.00
   *
   * `legCount` alone cannot say WHICH leg was corrected: 2026-06-27 and
   * 2026-07-09 both fold to legCount 3, and on both of them it is the
   * transaction leg that carries the extra row. Without the split, a day whose
   * surcharge disagreed with the summary report for an entirely unrelated reason
   * would be waved through as "explained by a correction" purely because some
   * OTHER leg happened to have two rows. That is the kind of false all-clear the
   * corroboration in atm-corroborate-core.ts exists to prevent, so the counts
   * are recorded per leg at the only place that can still see the source rows.
   */
  transactionLegCount: number;
  surchargeLegCount: number;
};

/** Classify a "Settlement Type" cell into a known leg, or null if unrecognized. */
export function classifyFundsMovementLeg(
  settlementType: string | null | undefined,
): "transaction" | "surcharge" | null {
  const s = normalizeHeader(settlementType ?? "");
  if (s === "transaction" || s === "transactions" || s === "txn" || s === "trx") return "transaction";
  if (s === "surcharge" || s === "surcharges" || s === "surch") return "surcharge";
  return null;
}

export function mapFundsMovementCsv(csv: string): MapResult<FundsMovementRow> {
  const table = parseCsv(csv);
  const problems: MapProblem[] = [];
  const rows: FundsMovementRow[] = [];
  if (table.length === 0) return { rows, problems };

  const header = table[0];
  const map = headerIndex(header);
  const iTerminal = pickColumn(map, ["terminal", "terminalnumber", "terminalid"]);
  const iDate = pickColumn(map, ["settlementdate", "date"]);
  const iType = pickColumn(map, ["settlementtype", "type", "movementtype"]);
  const iAmount = pickColumn(map, ["amount", "amt", "settlement"]);
  const iAcct = pickColumn(map, ["acct", "acctnumber", "account", "accountnumber"]);

  if (iTerminal < 0 || iDate < 0 || iType < 0 || iAmount < 0) {
    problems.push({
      row: 0,
      message:
        "funds-movement CSV missing required column(s): need Terminal, Settlement Date, Settlement Type and Amount",
    });
    return { rows, problems };
  }

  // Accumulate legs into a keyed group; preserve first-seen order for stability.
  type Group = {
    terminalId: string;
    settlementDate: string;
    txnCents: number | null;
    surchargeCents: number | null;
    accountTail: string | null;
    legCount: number;
    transactionLegCount: number;
    surchargeLegCount: number;
    order: number;
  };
  const groups = new Map<string, Group>();
  let seq = 0;

  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r];
    if (cells.length === 1 && cells[0].trim() === "") continue; // blank line
    const terminalId = (cells[iTerminal] ?? "").trim();
    const settlementDate = parseUsDate(cells[iDate]);
    if (!terminalId) {
      problems.push({ row: r, message: "missing terminal id" });
      continue;
    }
    if (!settlementDate) {
      problems.push({ row: r, message: `unparseable Settlement Date: "${cells[iDate] ?? ""}"` });
      continue;
    }
    const leg = classifyFundsMovementLeg(cells[iType]);
    if (leg === null) {
      problems.push({
        row: r,
        message: `unrecognized Settlement Type: "${(cells[iType] ?? "").trim()}"`,
      });
      continue;
    }
    const amountCents = dollarsToCents(cells[iAmount]);
    if (amountCents === null) {
      problems.push({ row: r, message: `unparseable Amount: "${cells[iAmount] ?? ""}"` });
      continue;
    }

    const key = `${settlementDate}\u0000${terminalId}`;
    let g = groups.get(key);
    if (!g) {
      seq += 1;
      g = {
        terminalId,
        settlementDate,
        txnCents: null,
        surchargeCents: null,
        accountTail: iAcct >= 0 ? (cells[iAcct] ?? "").trim() || null : null,
        legCount: 0,
        transactionLegCount: 0,
        surchargeLegCount: 0,
        order: seq,
      };
      groups.set(key, g);
    }
    // Negative amounts are ADDED, never dropped and never made absolute. The
    // -$100.00 row on 2026-06-27 is a genuine reversal: dropping it would
    // overstate that day by $100 and absolutising it would overstate by $200.
    if (leg === "transaction") {
      g.txnCents = (g.txnCents ?? 0) + amountCents;
      g.transactionLegCount += 1;
    } else {
      g.surchargeCents = (g.surchargeCents ?? 0) + amountCents;
      g.surchargeLegCount += 1;
    }
    g.legCount += 1;
  }

  const ordered = Array.from(groups.values()).sort((a, b) => {
    if (a.settlementDate !== b.settlementDate) return a.settlementDate < b.settlementDate ? -1 : 1;
    if (a.terminalId !== b.terminalId) return a.terminalId < b.terminalId ? -1 : 1;
    return a.order - b.order;
  });
  for (const g of ordered) {
    rows.push({
      terminalId: g.terminalId,
      settlementDate: g.settlementDate,
      terminalTransactionCents: g.txnCents,
      surchargeCents: g.surchargeCents,
      accountTail: g.accountTail,
      legCount: g.legCount,
      transactionLegCount: g.transactionLegCount,
      surchargeLegCount: g.surchargeLegCount,
    });
  }
  return { rows, problems };
}

/**
 * Format integer CENTS as US dollars for a sentence: `$1,234.56`.
 *
 * Negatives render with a real minus sign (`−$100.00`), not `$-100.00`.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED (books-69 step 3)
 * ------------------------------------------------------
 * Three separate one-line `money()` closures had grown inside src/lib/atm -
 * in atm-posting-core, atm-sweep-core and atm-corroborate-core - and they did
 * not agree. Two of them interpolated the sign straight from `toLocaleString`,
 * so a negative amount printed as `$-100.00`. That was harmless only for as
 * long as no negative could reach them, and books-69 ended that: the Funds
 * Movement report demonstrably carries reversal rows (-$100.00 on 2026-06-27),
 * and a surcharge total that nets negative is now reachable. One formatter,
 * defined at the base of the folder every ATM module already imports, is the
 * fix for the class rather than for the three instances.
 */
export function formatMoneyCents(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? "\u2212" : ""}$${dollars}`;
}

/** Parse an integer count cell ("1,234" → 1234); null on blank/garbage. */
export function toIntOrNull(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = input.trim().replace(/,/g, "");
  if (s === "") return null;
  if (!/^-?\d+$/.test(s)) return null;
  return Number(s);
}

// ---------------------------------------------------------------------------
// Reconciliation date window: bank deposits post T+1..T+3 business days after
// the PAI settlement date. Given a settlement ISO date, return the inclusive
// [earliest, latest] ISO window a matching bank deposit could post in.
// PURE (no timezone surprises — operates on the calendar date only).
// ---------------------------------------------------------------------------
export function bankPostingWindow(
  settlementIso: string,
  minBusinessDays = 1,
  maxBusinessDays = 3,
): { earliest: string; latest: string } | null {
  const start = isoToUtcDate(settlementIso);
  if (!start) return null;
  return {
    earliest: addBusinessDaysIso(start, minBusinessDays),
    latest: addBusinessDaysIso(start, maxBusinessDays),
  };
}

function isoToUtcDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Add N business days (skipping Sat/Sun) to a UTC date, return ISO date. */
function addBusinessDaysIso(start: Date, businessDays: number): string {
  const d = new Date(start.getTime());
  let added = 0;
  while (added < businessDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
    if (dow !== 0 && dow !== 6) added += 1;
  }
  const p2 = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts + vitest wrapper)
// ---------------------------------------------------------------------------
export function __runAtmCoreTests(): void {
  let failures = 0;
  const expect = (name: string, cond: boolean) => {
    if (cond) {
      console.log(`  ok - ${name}`);
    } else {
      failures += 1;
      console.error(`  FAIL - ${name}`);
    }
  };

  // --- dollarsToCents ---
  expect("dollars: $1,800.00 → 180000", dollarsToCents("$1,800.00") === 180000);
  expect("dollars: 20 → 2000", dollarsToCents("20") === 2000);
  expect("dollars: $2.50 → 250", dollarsToCents("$2.50") === 250);
  expect("dollars: 1,800.5 → 180050", dollarsToCents("1,800.5") === 180050);
  expect("dollars: 10.005 rounds to 1001", dollarsToCents("10.005") === 1001);
  expect("dollars: accounting negative (2.50) → -250", dollarsToCents("(2.50)") === -250);
  expect("dollars: -2.50 → -250", dollarsToCents("-2.50") === -250);
  expect("dollars: blank → null", dollarsToCents("") === null);
  expect("dollars: garbage → null", dollarsToCents("N/A") === null);
  expect("dollars: number 12.34 → 1234", dollarsToCents(12.34) === 1234);
  expect("dollars: null → null", dollarsToCents(null) === null);

  // --- parseCsv ---
  const t1 = parseCsv("a,b,c\r\n1,2,3\r\n");
  expect("csv: 2 rows", t1.length === 2);
  expect("csv: header a,b,c", t1[0].join("|") === "a|b|c");
  expect("csv: data 1,2,3", t1[1].join("|") === "1|2|3");
  const t2 = parseCsv('name,amt\r\n"Doe, John","$1,000.00"\r\n');
  expect("csv: quoted comma field", t2[1][0] === "Doe, John" && t2[1][1] === "$1,000.00");
  const t3 = parseCsv('a\n"line1\nline2"\n');
  expect("csv: quoted newline field", t3[1][0] === "line1\nline2");
  const t4 = parseCsv('a,b\n"He said ""hi""",x\n');
  expect("csv: escaped quotes", t4[1][0] === 'He said "hi"');
  expect("csv: empty string → []", parseCsv("").length === 0);

  // --- header helpers ---
  expect("normalizeHeader Trx Time", normalizeHeader("Trx Time") === "trxtime");
  expect("normalizeHeader Surch WDs", normalizeHeader("Surch WDs") === "surchwds");
  const hi = headerIndex(["Terminal Number", "Cash Load", "Balance"]);
  expect("headerIndex maps cashload", hi["cashload"] === 1);
  expect("pickColumn alias", pickColumn(hi, ["load", "cashload"]) === 1);
  expect("pickColumn missing → -1", pickColumn(hi, ["nope"]) === -1);

  // --- parseUsDate ---
  expect("date 8/9/26 → 2026-08-09", parseUsDate("8/9/26") === "2026-08-09");
  expect("date with time", parseUsDate("08/01/2026 9:54:19 AM") === "2026-08-01");
  expect("date iso passthrough", parseUsDate("2026-08-01") === "2026-08-01");
  expect("date invalid → null", parseUsDate("not a date") === null);
  expect("date blank → null", parseUsDate("") === null);
  expect("date bad month → null", parseUsDate("13/40/2026") === null);

  // --- toIntOrNull ---
  expect("int 1,234 → 1234", toIntOrNull("1,234") === 1234);
  expect("int blank → null", toIntOrNull("") === null);
  expect("int garbage → null", toIntOrNull("12x") === null);

  // --- mapCashLoadCsv (CONFIRMED real headers: quoted "$2,360" whole-dollars) ---
  // Header + rows mirror Michael's real ATMCashLoadReport-*.csv export exactly.
  const loadCsv =
    '"Terminal Number","Location","Group","Trx Time","Cash Load","Balance"\r\n' +
    '"HG26499","CASCADE GENERAL PARTNERS","","8/8/26 8:49:11 PM","$2,360","$3,080"\r\n';
  const lr = mapCashLoadCsv(loadCsv);
  expect("cashload: 1 row, 0 problems", lr.rows.length === 1 && lr.problems.length === 0);
  expect("cashload: terminal", lr.rows[0].terminalId === "HG26499");
  expect("cashload: cents", lr.rows[0].cashLoadCents === 236000);
  expect("cashload: balance cents", lr.rows[0].balanceAfterCents === 308000);
  expect("cashload: date (M/D/YY)", lr.rows[0].loadDate === "2026-08-08");
  expect("cashload: keeps raw Trx Time", lr.rows[0].loadedAtRaw === "8/8/26 8:49:11 PM");
  const lrBad = mapCashLoadCsv("Location,Group\r\nx,y\r\n");
  expect("cashload: missing cols → problem", lrBad.rows.length === 0 && lrBad.problems.length === 1);

  // --- mapSimpleSummaryCsv (CONFIRMED real headers: "WD Trxs" / "Surcharge WDs") ---
  // Header + row mirror Michael's real TerminalTrxData-*.csv export exactly.
  const sumCsv =
    '"Terminal","Location","Settlement Date","Total Trxs","WD Trxs","Surcharge WDs","Surch","Settlement"\r\n' +
    '"HG26499","CASCADE GENERAL PARTNERS","8/2/26","114","96","96","$240.00","$9,020.00"\r\n';
  const sr = mapSimpleSummaryCsv(sumCsv);
  expect("summary: 1 row, 0 problems", sr.rows.length === 1 && sr.problems.length === 0);
  expect("summary: date", sr.rows[0].settlementDate === "2026-08-02");
  expect("summary: total trx", sr.rows[0].totalTrx === 114);
  expect("summary: WD trx (real 'WD Trxs')", sr.rows[0].withdrawalTrx === 96);
  expect("summary: surcharge WD (real 'Surcharge WDs')", sr.rows[0].surchargedWdTrx === 96);
  expect("summary: surch cents", sr.rows[0].surchargeCents === 24000);
  expect("summary: settlement cents", sr.rows[0].settlementTotalCents === 902000);
  expect(
    "summary: txn leg null here (comes from FundsMovement 'Transaction')",
    sr.rows[0].terminalTransactionCents === null,
  );

  // Backward-compatible: still parses the legacy-guessed labels ("WO Trxs"/"Surch WDs").
  const srLegacy = mapSimpleSummaryCsv(
    "Terminal,Location,Settlement Date,Total Trxs,WO Trxs,Surch WDs,Surch,Settlement\r\n" +
      'HG26499,CASCADE,8/2/26,114,96,96,"$240.00","$9,020.00"\r\n',
  );
  expect(
    "summary: legacy labels still map WD/Surch",
    srLegacy.rows[0].withdrawalTrx === 96 && srLegacy.rows[0].surchargedWdTrx === 96,
  );

  // Idempotent-friendly: two identical rows both parse (dedupe is the store's job
  // via the unique index; the mapper is faithful to the source).
  const sr2 = mapSimpleSummaryCsv(sumCsv + '"HG26499","CASCADE","8/2/26","114","96","96","$240.00","$9,020.00"\r\n');
  expect("summary: faithful to duplicate source rows", sr2.rows.length === 2);

  // --- mapFundsMovementCsv (CONFIRMED real headers; deposit-side truth) ---
  // Mirrors Michael's real FundsMovementByAccountByDay-*.csv: long format, one row
  // per leg, MULTIPLE legs per (date, terminal). 7/2/26 has two "Transaction"
  // rows ($4,980.00 + $100.00) and two "Surcharge" rows ($157.50 + $5.00), which
  // must be SUMMED into a single grouped settlement row.
  const fmHeader =
    '"Market Partner Code","Market Partner","Acct #","Group","Location","Settlement Date","Terminal","Settlement Type","Amount"\r\n';
  const fmCsv =
    fmHeader +
    '"02-110K804","American ATM Network","******6228","","CASCADE GENERAL PARTNERS","7/1/26","HG26499","Transaction","$3,860.00"\r\n' +
    '"02-110K804","American ATM Network","******6228","","CASCADE GENERAL PARTNERS","7/1/26","HG26499","Surcharge","$120.00"\r\n' +
    '"02-110K804","American ATM Network","******6228","","CASCADE GENERAL PARTNERS","7/2/26","HG26499","Transaction","$4,980.00"\r\n' +
    '"02-110K804","American ATM Network","******6228","","CASCADE GENERAL PARTNERS","7/2/26","HG26499","Surcharge","$157.50"\r\n' +
    '"02-110K804","American ATM Network","******6228","","CASCADE GENERAL PARTNERS","7/2/26","HG26499","Transaction","$100.00"\r\n' +
    '"02-110K804","American ATM Network","******6228","","CASCADE GENERAL PARTNERS","7/2/26","HG26499","Surcharge","$5.00"\r\n';
  const fm = mapFundsMovementCsv(fmCsv);
  expect("funds: 2 grouped rows, 0 problems", fm.rows.length === 2 && fm.problems.length === 0);
  // Sorted by date ascending: 7/1 first, 7/2 second.
  expect("funds: 7/1 date", fm.rows[0].settlementDate === "2026-07-01");
  expect("funds: 7/1 terminal", fm.rows[0].terminalId === "HG26499");
  expect("funds: 7/1 txn leg", fm.rows[0].terminalTransactionCents === 386000);
  expect("funds: 7/1 surcharge leg", fm.rows[0].surchargeCents === 12000);
  expect("funds: 7/1 legCount 2", fm.rows[0].legCount === 2);
  expect("funds: 7/1 account tail masked", fm.rows[0].accountTail === "******6228");
  // 7/2 must SUM the two Transaction legs and the two Surcharge legs.
  expect("funds: 7/2 txn summed ($4,980 + $100)", fm.rows[1].terminalTransactionCents === 508000);
  expect("funds: 7/2 surcharge summed ($157.50 + $5.00)", fm.rows[1].surchargeCents === 16250);
  expect("funds: 7/2 legCount 4", fm.rows[1].legCount === 4);

  // Unknown Settlement Type is recorded as a problem and skipped (never guessed).
  const fmUnknown = mapFundsMovementCsv(
    fmHeader +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/3/26","HG26499","Chargeback","$10.00"\r\n',
  );
  expect(
    "funds: unknown type → 0 rows, 1 problem",
    fmUnknown.rows.length === 0 && fmUnknown.problems.length === 1,
  );
  // classifier is tolerant of case/spacing but strict on meaning.
  expect("funds: classify Transaction", classifyFundsMovementLeg("Transaction") === "transaction");
  expect("funds: classify Surcharge", classifyFundsMovementLeg(" surcharge ") === "surcharge");
  expect("funds: classify unknown → null", classifyFundsMovementLeg("Interchange") === null);
  // Missing required column → single header-level problem.
  const fmBad = mapFundsMovementCsv("Market Partner,Amount\r\nx,$1.00\r\n");
  expect("funds: missing cols → problem", fmBad.rows.length === 0 && fmBad.problems.length === 1);

  // --- per-leg counts: WHICH leg the correction landed on (books-69 step 3) ---
  // These are Michael's REAL rows, copied from
  // "Funds Movement By Account By Day 5.1.26-8.23.26.csv".
  const fmHdr =
    '"Market Partner Code","Market Partner","Acct #","Group","Location",' +
    '"Settlement Date","Terminal","Settlement Type","Amount"\r\n';
  const fmLegs = mapFundsMovementCsv(
    fmHdr +
      // 2026-06-27: the transaction leg was corrected, the surcharge was not.
      '"02-110K804","American ATM Network","******6228","","CASCADE","6/27/26","HG26499","Transaction","$3,060.00"\r\n' +
      '"02-110K804","American ATM Network","******6228","","CASCADE","6/27/26","HG26499","Surcharge","$107.50"\r\n' +
      '"02-110K804","American ATM Network","******6228","","CASCADE","6/27/26","HG26499","Transaction","-$100.00"\r\n' +
      // 2026-07-02: BOTH legs were corrected.
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/2/26","HG26499","Transaction","$4,980.00"\r\n' +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/2/26","HG26499","Surcharge","$157.50"\r\n' +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/2/26","HG26499","Transaction","$100.00"\r\n' +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/2/26","HG26499","Surcharge","$5.00"\r\n',
  );
  const jun27 = fmLegs.rows.find((r) => r.settlementDate === "2026-06-27");
  const jul2 = fmLegs.rows.find((r) => r.settlementDate === "2026-07-02");
  expect(
    "funds: -$100 REDUCES the day (2026-06-27 → $2,960.00)",
    jun27?.terminalTransactionCents === 296000,
  );
  expect(
    "funds: 2026-06-27 correction is on the TRANSACTION leg only",
    jun27?.transactionLegCount === 2 && jun27?.surchargeLegCount === 1,
  );
  expect(
    "funds: 2026-07-02 corrections land on BOTH legs",
    jul2?.transactionLegCount === 2 && jul2?.surchargeLegCount === 2,
  );
  expect(
    "funds: 2026-07-02 legs sum with their corrections ($5,080.00 / $162.50)",
    jul2?.terminalTransactionCents === 508000 && jul2?.surchargeCents === 16250,
  );
  expect(
    "funds: per-leg counts add up to legCount",
    jun27 !== undefined &&
      jun27.transactionLegCount + jun27.surchargeLegCount === jun27.legCount,
  );

  // --- formatMoneyCents (one formatter, and it survives a negative) ---
  expect("money: 0 → $0.00", formatMoneyCents(0) === "$0.00");
  expect("money: thousands separated", formatMoneyCents(526620_00) === "$526,620.00");
  expect("money: cents kept", formatMoneyCents(16250) === "$162.50");
  // The bug this replaces: `$${(-10000/100).toLocaleString(...)}` → "$-100.00".
  expect("money: negative uses a real minus, not $-", formatMoneyCents(-10000) === "\u2212$100.00");

  // --- bankPostingWindow (business-day math, weekend rollover) ---
  // 2026-08-05 is a Wednesday. +1 bday = Thu 08-06, +3 bday = Mon 08-10.
  const w1 = bankPostingWindow("2026-08-05");
  expect("window Wed: earliest Thu", w1?.earliest === "2026-08-06");
  expect("window Wed: latest next-Mon (weekend skipped)", w1?.latest === "2026-08-10");
  // 2026-08-07 is a Friday. +1 bday = Mon 08-10, +3 bday = Wed 08-12.
  const w2 = bankPostingWindow("2026-08-07");
  expect("window Fri: earliest Mon", w2?.earliest === "2026-08-10");
  expect("window Fri: latest Wed", w2?.latest === "2026-08-12");
  expect("window: bad date → null", bankPostingWindow("nope") === null);

  if (failures > 0) throw new Error(`atm-core self-tests: ${failures} failure(s)`);
  console.log("atm-core self-tests: all passed");
}
