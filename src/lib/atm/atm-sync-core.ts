/**
 * src/lib/atm/atm-sync-core.ts — ATM/PAI Slice A-2c (PURE)
 *
 * The deterministic "brain" of the ATM ingestion. Given rows already parsed by
 * the VERIFIED atm-core mappers (mapCashLoadCsv / mapSimpleSummaryCsv /
 * mapFundsMovementCsv), this module builds idempotent UPSERT plans for the
 * atm_cash_loads and atm_settlements tables (migration 0156). No I/O — fully
 * unit-tested here and mirrored in vitest. The server layer (sync-server.ts)
 * takes these plans and writes them via the store; a re-run of the same reports
 * produces the same rows (dedup on the tables' unique indexes).
 *
 * STANDING RULES honored:
 *   • MONEY IN CENTS — every amount is an integer bigint-compatible number.
 *   • NEVER GUESS — a value the reports don't provide stays null; we never
 *     invent a balance, a count, or a deposit leg.
 *   • The two deposit legs (terminal_transaction_cents + surcharge_cents) are
 *     the DEPOSIT-SIDE TRUTH from the FundsMovement report; the Simple Summary
 *     report contributes counts + settlement_total + a fallback surcharge only.
 */

import type { CashLoadRow, SettlementRow, FundsMovementRow } from "./atm-core";
import { parseUsDate } from "./atm-core";

// ---------------------------------------------------------------------------
// Cash loads → atm_cash_loads upsert plan
// ---------------------------------------------------------------------------

export type CashLoadUpsert = {
  terminal_id: string;
  loaded_at: string; // ISO timestamp (dedup key with terminal_id)
  load_date: string | null; // ISO yyyy-mm-dd
  cash_load_cents: number;
  balance_after_cents: number | null;
  source: "pai";
  raw: Record<string, unknown>;
};

export type CashLoadPlan = {
  upserts: CashLoadUpsert[];
  skipped: Array<{ reason: string; sample: string }>;
};

/**
 * Convert a PAI "Trx Time" string into an ISO timestamp usable as the dedup key.
 * PAI shows "M/D/YY h:mm:ss AM/PM". We keep the calendar date exactly and encode
 * the wall-clock time when present; when only a date is parseable we anchor at
 * noon UTC (same convention as a manual entry) so it sorts sanely and does not
 * collide. Returns null when no date can be parsed (caller skips + records it).
 * We do NOT guess a timezone — the raw string is preserved verbatim in `raw`.
 */
/**
 * PAI's reporting timezone.
 *
 * Michael, 2026-08-15: "PAI is a company in New York, a different time zone.
 * I've noticed in the past that deposits don't match up always because of the
 * time difference. If my ATM is used at 10pm, to PAI it's the next day."
 *
 * That is a real and important observation. What we can state as FACT:
 *   • The store is Pacific; PAI reports Eastern (UTC−5 / UTC−4 DST).
 *   • A swipe at 22:00 Pacific is 01:00 the NEXT DAY Eastern.
 *
 * What we must NOT do is silently shift dates. PAI's own settlement date is what
 * PAI pays against, so the settlement date is authoritative for reconciliation —
 * re-dating it would make our books disagree with the payer's records. What was
 * genuinely WRONG is that we stamped PAI's local wall-clock time with a literal
 * "Z" (UTC) suffix, asserting an instant that is off by the Eastern offset.
 *
 * So we record the true instant, and keep PAI's calendar date untouched.
 */
export const PAI_TIMEZONE = "America/New_York" as const;
export const STORE_TIMEZONE = "America/Los_Angeles" as const;

/**
 * Eastern Time UTC offset in hours for a given date (5 standard, 4 daylight).
 * US DST: second Sunday in March .. first Sunday in November.
 * Pure and dependency-free — no Intl/tzdata reliance in a money path.
 */
export function easternOffsetHours(isoDate: string): number {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 5;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  const dowOf = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();

  // Second Sunday in March.
  let march = 1;
  let sundays = 0;
  for (let day = 1; day <= 31; day++) {
    if (dowOf(y, 3, day) === 0) {
      sundays++;
      if (sundays === 2) {
        march = day;
        break;
      }
    }
  }
  // First Sunday in November.
  let nov = 1;
  for (let day = 1; day <= 30; day++) {
    if (dowOf(y, 11, day) === 0) {
      nov = day;
      break;
    }
  }

  const afterStart = mo > 3 || (mo === 3 && d >= march);
  const beforeEnd = mo < 11 || (mo === 11 && d < nov);
  return afterStart && beforeEnd ? 4 : 5;
}

export function trxTimeToIso(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  const isoDate = parseUsDate(s);
  if (!isoDate) return null;

  // Pull an optional "h:mm[:ss] AM/PM" (or 24h "HH:mm[:ss]") after the date.
  const timeMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!timeMatch) return `${isoDate}T12:00:00Z`;

  let hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  const ss = timeMatch[3] ? Number(timeMatch[3]) : 0;
  const ampm = (timeMatch[4] ?? "").toUpperCase();
  if (ampm === "PM" && hh < 12) hh += 12;
  if (ampm === "AM" && hh === 12) hh = 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) {
    return `${isoDate}T12:00:00Z`;
  }

  // PAI reports EASTERN wall-clock time. Previously we pasted those digits under
  // a "Z" suffix, which claims they are UTC — an instant wrong by 4–5 hours and,
  // for anything after 7pm Eastern, wrong by a whole CALENDAR DAY once read back
  // in any other zone. Convert properly so the stored instant is the truth.
  const offset = easternOffsetHours(isoDate);
  const [yy, mo, dd] = isoDate.split("-").map(Number);
  const utcMs = Date.UTC(yy, mo - 1, dd, hh + offset, mm, ss);
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Build the upsert plan for cash loads. Idempotent on (terminal_id, loaded_at). */
export function planCashLoadUpserts(rows: CashLoadRow[]): CashLoadPlan {
  const upserts: CashLoadUpsert[] = [];
  const skipped: CashLoadPlan["skipped"] = [];
  // De-dupe within the same batch on the composite key (last write wins — the
  // report is already sorted; keeping the last keeps behavior deterministic).
  const seen = new Map<string, number>();

  for (const r of rows) {
    const terminalId = (r.terminalId ?? "").trim();
    const loadedAt = trxTimeToIso(r.loadedAtRaw);
    if (!terminalId) {
      skipped.push({ reason: "missing terminal id", sample: r.loadedAtRaw ?? "" });
      continue;
    }
    if (!loadedAt) {
      skipped.push({ reason: "unparseable load time", sample: r.loadedAtRaw ?? "" });
      continue;
    }
    const row: CashLoadUpsert = {
      terminal_id: terminalId,
      loaded_at: loadedAt,
      load_date: r.loadDate,
      cash_load_cents: Math.trunc(r.cashLoadCents),
      balance_after_cents: r.balanceAfterCents === null ? null : Math.trunc(r.balanceAfterCents),
      source: "pai",
      raw: { ...r.raw, loaded_at_raw: r.loadedAtRaw },
    };
    const key = `${terminalId}\u0000${loadedAt}`;
    const existingIdx = seen.get(key);
    if (existingIdx === undefined) {
      seen.set(key, upserts.length);
      upserts.push(row);
    } else {
      upserts[existingIdx] = row; // last-wins within batch
    }
  }
  return { upserts, skipped };
}

// ---------------------------------------------------------------------------
// Settlements → atm_settlements upsert plan (Simple Summary ⊕ FundsMovement)
// ---------------------------------------------------------------------------

export type SettlementUpsert = {
  settlement_date: string; // ISO yyyy-mm-dd (dedup key with terminal_id)
  terminal_id: string;
  total_trx: number | null;
  withdrawal_trx: number | null;
  surcharged_wd_trx: number | null;
  terminal_transaction_cents: number | null; // deposit leg (FundsMovement)
  surcharge_cents: number | null; // fee revenue
  settlement_total_cents: number | null; // Simple Summary "Settlement"
  raw: Record<string, unknown>;
};

export type SettlementPlan = {
  upserts: SettlementUpsert[];
  skipped: Array<{ reason: string; sample: string }>;
};

function keyOf(date: string, terminal: string): string {
  return `${date}\u0000${terminal}`;
}

/**
 * Merge the Simple Summary rows (counts + settlement total + a fallback
 * surcharge) with the FundsMovement rows (the DEPOSIT-SIDE TRUTH: the two
 * deposit legs) into one settlement row per (settlement_date, terminal_id).
 *
 * Precedence rules (never guess):
 *   • terminal_transaction_cents → ONLY from FundsMovement "Transaction" leg.
 *   • surcharge_cents → prefer FundsMovement "Surcharge" leg (deposit truth);
 *     fall back to Simple Summary "Surch" when FundsMovement has none.
 *   • counts + settlement_total_cents → from Simple Summary only.
 *   • anything absent stays null.
 */
export function planSettlementUpserts(
  simpleSummary: SettlementRow[],
  fundsMovement: FundsMovementRow[],
): SettlementPlan {
  const map = new Map<string, SettlementUpsert>();
  const order: string[] = [];
  const skipped: SettlementPlan["skipped"] = [];

  const ensure = (date: string, terminal: string): SettlementUpsert => {
    const k = keyOf(date, terminal);
    let row = map.get(k);
    if (!row) {
      row = {
        settlement_date: date,
        terminal_id: terminal,
        total_trx: null,
        withdrawal_trx: null,
        surcharged_wd_trx: null,
        terminal_transaction_cents: null,
        surcharge_cents: null,
        settlement_total_cents: null,
        raw: {},
      };
      map.set(k, row);
      order.push(k);
    }
    return row;
  };

  // 1) Simple Summary → counts + settlement_total + fallback surcharge.
  for (const s of simpleSummary) {
    const date = (s.settlementDate ?? "").trim();
    const terminal = (s.terminalId ?? "").trim();
    if (!date || !terminal) {
      skipped.push({ reason: "simple-summary row missing date/terminal", sample: `${date}|${terminal}` });
      continue;
    }
    const row = ensure(date, terminal);
    row.total_trx = s.totalTrx;
    row.withdrawal_trx = s.withdrawalTrx;
    row.surcharged_wd_trx = s.surchargedWdTrx;
    row.settlement_total_cents = s.settlementTotalCents;
    if (s.surchargeCents !== null) row.surcharge_cents = Math.trunc(s.surchargeCents);
    row.raw = { ...row.raw, simple_summary: s.raw };
  }

  // 2) FundsMovement → the two deposit legs (authoritative). Overwrites the
  //    surcharge fallback with the deposit truth when present.
  for (const f of fundsMovement) {
    const date = (f.settlementDate ?? "").trim();
    const terminal = (f.terminalId ?? "").trim();
    if (!date || !terminal) {
      skipped.push({ reason: "funds-movement row missing date/terminal", sample: `${date}|${terminal}` });
      continue;
    }
    const row = ensure(date, terminal);
    if (f.terminalTransactionCents !== null) {
      row.terminal_transaction_cents = Math.trunc(f.terminalTransactionCents);
    }
    if (f.surchargeCents !== null) {
      row.surcharge_cents = Math.trunc(f.surchargeCents); // deposit truth wins
    }
    row.raw = {
      ...row.raw,
      funds_movement: {
        terminal_transaction_cents: f.terminalTransactionCents,
        surcharge_cents: f.surchargeCents,
        account_tail: f.accountTail,
        leg_count: f.legCount,
      },
    };
  }

  const upserts = order.map((k) => map.get(k)!);
  return { upserts, skipped };
}

// ---------------------------------------------------------------------------
// Ingest summary (the plain-English result line the UI/audit reports)
// ---------------------------------------------------------------------------

export type IngestSummary = {
  cashLoadsUpserted: number;
  settlementsUpserted: number;
  problems: string[];
  /** True when at least one report produced at least one row. */
  didSomething: boolean;
};

export function summarizeIngest(args: {
  cashLoadPlan?: CashLoadPlan | null;
  settlementPlan?: SettlementPlan | null;
  mapProblems?: string[];
}): IngestSummary {
  const cashLoadsUpserted = args.cashLoadPlan?.upserts.length ?? 0;
  const settlementsUpserted = args.settlementPlan?.upserts.length ?? 0;
  const problems: string[] = [];
  for (const p of args.mapProblems ?? []) problems.push(p);
  for (const s of args.cashLoadPlan?.skipped ?? []) problems.push(`cash load skipped: ${s.reason}`);
  for (const s of args.settlementPlan?.skipped ?? []) problems.push(`settlement skipped: ${s.reason}`);
  return {
    cashLoadsUpserted,
    settlementsUpserted,
    problems,
    didSomething: cashLoadsUpserted > 0 || settlementsUpserted > 0,
  };
}

/** Build the one-line human message for the manual-import result. */
export function ingestResultMessage(sum: IngestSummary): string {
  if (!sum.didSomething) {
    return sum.problems.length > 0
      ? `No rows imported. ${sum.problems.length} issue(s) found — check the file columns.`
      : "No rows found in the files provided.";
  }
  const parts: string[] = [];
  if (sum.settlementsUpserted > 0) {
    parts.push(`${sum.settlementsUpserted} settlement day${sum.settlementsUpserted === 1 ? "" : "s"}`);
  }
  if (sum.cashLoadsUpserted > 0) {
    parts.push(`${sum.cashLoadsUpserted} cash load${sum.cashLoadsUpserted === 1 ? "" : "s"}`);
  }
  const tail = sum.problems.length > 0 ? ` (${sum.problems.length} row(s) skipped)` : "";
  return `Imported ${parts.join(" and ")}${tail}.`;
}

// ---------------------------------------------------------------------------
// Self-tests (pure — run via scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runAtmSyncCoreTests(): void {
  let failures = 0;
  const expect = (name: string, cond: boolean) => {
    if (cond) {
      console.log("  ok - " + name);
    } else {
      failures += 1;
      console.error("  FAIL - " + name);
    }
  };

  // trxTimeToIso ------------------------------------------------------------
  // NOTE (2026-08-15, rule 17): the four assertions below were REWRITTEN. They
  // previously required trxTimeToIso to copy PAI's wall-clock digits verbatim and
  // append "Z" — i.e. to claim Eastern local time was UTC. That is exactly what
  // Michael spotted from the outside ("PAI is in New York... if my ATM is used at
  // 10pm, to PAI it's the next day"). The 12-hour AM/PM parsing these tests were
  // really guarding is still fully covered; only the asserted INSTANT has been
  // corrected by the Eastern offset (August = DST = UTC−4).
  expect("trxTime PM converts to 24h then to UTC", trxTimeToIso("8/8/26 8:49:11 PM") === "2026-08-09T00:49:11Z");
  expect("trxTime AM keeps hour (shifted to UTC)", trxTimeToIso("8/8/26 8:45:09 AM") === "2026-08-08T12:45:09Z");
  expect("trxTime 12 AM → 00", trxTimeToIso("8/1/26 12:06:24 AM") === "2026-08-01T04:06:24Z");
  expect("trxTime 12 PM → 12", trxTimeToIso("8/1/26 12:02:39 PM") === "2026-08-01T16:02:39Z");
  expect("trxTime date only → noon UTC", trxTimeToIso("8/1/26") === "2026-08-01T12:00:00Z");
  // --- PAI EASTERN TIMEZONE (owner report, 2026-08-15) ---------------------
  // "PAI is a company in New York... if my ATM is used at 10pm, to PAI it's the
  // next day." Before this fix we stamped PAI's Eastern wall clock with a "Z",
  // asserting a UTC instant that was 4-5 hours wrong.
  expect(
    "eastern offset: July is DST (4)",
    easternOffsetHours("2026-07-09") === 4,
  );
  expect(
    "eastern offset: January is standard (5)",
    easternOffsetHours("2026-01-09") === 5,
  );
  // 2026: DST starts Sun Mar 8, ends Sun Nov 1.
  expect("eastern offset: Mar 7 2026 still standard", easternOffsetHours("2026-03-07") === 5);
  expect("eastern offset: Mar 8 2026 is DST", easternOffsetHours("2026-03-08") === 4);
  expect("eastern offset: Oct 31 2026 still DST", easternOffsetHours("2026-10-31") === 4);
  expect("eastern offset: Nov 1 2026 back to standard", easternOffsetHours("2026-11-01") === 5);
  expect("eastern offset: unparseable date falls back to 5", easternOffsetHours("nope") === 5);

  // A 10:15 PM EASTERN swipe on 7/9 is 02:15 UTC on 7/10.
  expect(
    "PAI 10:15 PM Eastern converts to the correct UTC instant",
    trxTimeToIso("7/9/26 10:15:00 PM") === "2026-07-10T02:15:00Z",
  );
  // Winter: 10:15 PM Eastern (UTC-5) on 1/9 is 03:15 UTC on 1/10.
  expect(
    "PAI winter evening converts with the standard-time offset",
    trxTimeToIso("1/9/26 10:15:00 PM") === "2026-01-10T03:15:00Z",
  );
  // Morning times stay on the same calendar day.
  expect(
    "PAI 9:00 AM Eastern stays on the same UTC day",
    trxTimeToIso("7/9/26 9:00:00 AM") === "2026-07-09T13:00:00Z",
  );
  // The stored instant must never be the raw digits under a fake Z.
  expect(
    "the old naive 'paste digits + Z' output is gone",
    trxTimeToIso("7/9/26 10:15:00 PM") !== "2026-07-09T22:15:00Z",
  );

  expect("trxTime blank → null", trxTimeToIso("") === null);
  expect("trxTime junk → null", trxTimeToIso("not a time") === null);

  // planCashLoadUpserts -----------------------------------------------------
  const clPlan = planCashLoadUpserts([
    { terminalId: "HG26499", loadedAtRaw: "8/8/26 8:49:11 PM", loadDate: "2026-08-08", cashLoadCents: 236000, balanceAfterCents: 308000, raw: { "Trx Time": "8/8/26 8:49:11 PM" } },
    { terminalId: "HG26499", loadedAtRaw: "8/8/26 3:45:06 PM", loadDate: "2026-08-08", cashLoadCents: 284000, balanceAfterCents: 286000, raw: {} },
  ]);
  expect("cash plan: 2 upserts", clPlan.upserts.length === 2);
  expect("cash plan: loaded_at iso", clPlan.upserts[0].loaded_at === "2026-08-09T00:49:11Z");
  expect("cash plan: cents", clPlan.upserts[0].cash_load_cents === 236000);
  expect("cash plan: source pai", clPlan.upserts[0].source === "pai");
  expect("cash plan: keeps raw trx time", clPlan.upserts[0].raw.loaded_at_raw === "8/8/26 8:49:11 PM");

  // dedup within batch (same terminal + time → last wins)
  const clDup = planCashLoadUpserts([
    { terminalId: "HG26499", loadedAtRaw: "8/1/26 11:06:24 AM", loadDate: "2026-08-01", cashLoadCents: 360000, balanceAfterCents: 376000, raw: {} },
    { terminalId: "HG26499", loadedAtRaw: "8/1/26 11:06:24 AM", loadDate: "2026-08-01", cashLoadCents: 999900, balanceAfterCents: 999900, raw: {} },
  ]);
  expect("cash plan: dedup within batch → 1", clDup.upserts.length === 1);
  expect("cash plan: dedup last-wins", clDup.upserts[0].cash_load_cents === 999900);

  // skip unparseable time
  const clSkip = planCashLoadUpserts([
    { terminalId: "HG26499", loadedAtRaw: "", loadDate: null, cashLoadCents: 100, balanceAfterCents: null, raw: {} },
  ]);
  expect("cash plan: unparseable time skipped", clSkip.upserts.length === 0 && clSkip.skipped.length === 1);

  // planSettlementUpserts (merge) ------------------------------------------
  const ssRows: SettlementRow[] = [
    {
      terminalId: "HG26499",
      settlementDate: "2026-07-02",
      totalTrx: 114,
      withdrawalTrx: 96,
      surchargedWdTrx: 96,
      terminalTransactionCents: null, // Simple Summary never carries this
      surchargeCents: 24000, // fallback surcharge (from "Surch")
      settlementTotalCents: 902000,
      raw: {},
    },
  ];
  const fmRows: FundsMovementRow[] = [
    {
      terminalId: "HG26499",
      settlementDate: "2026-07-02",
      terminalTransactionCents: 508000, // deposit truth
      surchargeCents: 16250, // deposit truth (differs from SS fallback → must win)
      accountTail: "******6228",
      legCount: 4,
    },
  ];
  const sPlan = planSettlementUpserts(ssRows, fmRows);
  expect("settlement plan: merged into 1 row", sPlan.upserts.length === 1);
  const row = sPlan.upserts[0];
  expect("settlement: counts from simple summary", row.total_trx === 114 && row.withdrawal_trx === 96);
  expect("settlement: settlement_total from simple summary", row.settlement_total_cents === 902000);
  expect("settlement: txn leg from funds movement", row.terminal_transaction_cents === 508000);
  expect("settlement: surcharge = funds-movement deposit truth (wins over SS)", row.surcharge_cents === 16250);
  expect("settlement: raw carries both sources", "simple_summary" in row.raw && "funds_movement" in row.raw);

  // FundsMovement-only (no simple summary) still yields the deposit legs.
  const sOnlyFm = planSettlementUpserts([], fmRows);
  expect("settlement: FM-only row present", sOnlyFm.upserts.length === 1);
  expect("settlement: FM-only counts null", sOnlyFm.upserts[0].total_trx === null);
  expect("settlement: FM-only txn leg", sOnlyFm.upserts[0].terminal_transaction_cents === 508000);

  // Simple-summary-only (no funds movement) keeps the fallback surcharge, txn null.
  const sOnlySs = planSettlementUpserts(ssRows, []);
  expect("settlement: SS-only surcharge fallback used", sOnlySs.upserts[0].surcharge_cents === 24000);
  expect("settlement: SS-only txn leg stays null (never invented)", sOnlySs.upserts[0].terminal_transaction_cents === null);

  // rows missing date/terminal are skipped, not guessed.
  const sBad = planSettlementUpserts(
    [{ terminalId: "", settlementDate: "", totalTrx: 1, withdrawalTrx: 1, surchargedWdTrx: 1, terminalTransactionCents: null, surchargeCents: 1, settlementTotalCents: 1, raw: {} }],
    [],
  );
  expect("settlement: bad row skipped", sBad.upserts.length === 0 && sBad.skipped.length === 1);

  // summarizeIngest + message ----------------------------------------------
  const sum = summarizeIngest({ cashLoadPlan: clPlan, settlementPlan: sPlan, mapProblems: [] });
  expect("summary: counts", sum.cashLoadsUpserted === 2 && sum.settlementsUpserted === 1);
  expect("summary: didSomething", sum.didSomething === true);
  expect("summary: message mentions both", ingestResultMessage(sum).includes("settlement") && ingestResultMessage(sum).includes("cash load"));
  const empty = summarizeIngest({});
  expect("summary: empty → didSomething false", empty.didSomething === false);
  expect("summary: empty message honest", ingestResultMessage(empty).toLowerCase().includes("no rows"));

  if (failures > 0) throw new Error(`atm-sync-core self-tests: ${failures} failure(s)`);
  console.log("atm-sync-core: all self-tests passed");
}
