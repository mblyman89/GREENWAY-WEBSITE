/**
 * src/lib/registers/master-till-core.ts  (Fix Phase 2.7a: G-08, G-09, G-13)
 *
 * PURE rules for the master till ($1,000 change fund) sheet. Zero I/O.
 *
 * Owner, verbatim:
 *   D11  "The master till has 1000. 32 tens, 64 fives, 318 ones, 95 quarters,
 *         120 dimes, 100 nickels, and 125 pennies."
 *   G-09 "I want to make sure the master till spreadsheet is built … This
 *         should be exportable and printable."
 *   D15  "anyone can count and record the master count"
 *
 * What lives here:
 *   - MASTER_TILL_STANDARD: the one source of the D11 mix (rule 25). The EOD
 *     worked example re-exports it instead of keeping its own copy.
 *   - mixRows / mixCheck: per denomination Standard, Counted and Diff, and a
 *     plain "mix off: +10 × $20, −20 × $10" line. Total variance and the mix
 *     are reported SEPARATELY: a $1,000.00 count can still be off the mix.
 *   - parseDayRange: the history / export date range. A bad date is an error,
 *     never silently replaced (same rule as the EOD date, F-03-8).
 *   - safeSheetWorkbook: the CSV / Excel export (Counts, Mix, Swaps).
 */

import { DENOM_FIELDS, EMPTY_DENOMS, denomTotalMinor, formatCents, type DenomCounts } from "@/lib/registers/cash";
import { SAFE_TARGET_MINOR, MASTER_TILL_STANDARD } from "@/lib/registers/safe-core";
import { parseBusinessDay } from "@/lib/registers/deposit-bag-flow-core";
import type { WorkbookSpec, TableRow } from "@/lib/reports/workbook";
import { swapBillWords, type SheetExchange } from "@/lib/registers/little-safe-core";

/** PIN throttle scope for the master till count (separate from the till pad). */
export const SAFE_COUNT_PIN_SCOPE = "backoffice-safe-count";

/** D11, verbatim quantities (kept in safe-core.ts, the one source). */
export { MASTER_TILL_STANDARD };

const LABEL = new Map(DENOM_FIELDS.map((d) => [d.key, d.label]));
const CENTS: Record<keyof DenomCounts, number> = {
  pennies: 1, nickels: 5, dimes: 10, quarters: 25, half_dollars: 50, dollar_coins: 100,
  ones: 100, twos: 200, fives: 500, tens: 1000, twenties: 2000, fifties: 5000, hundreds: 10000,
};

function qty(v: unknown): number {
  const n = Math.floor(Number(v ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Pull the 13 denomination columns off any row (a safe_counts row has them flat). */
export function denomsOf(row: Partial<Record<keyof DenomCounts, unknown>>): DenomCounts {
  const out = { ...EMPTY_DENOMS };
  for (const k of Object.keys(out) as (keyof DenomCounts)[]) out[k] = qty(row[k]);
  return out;
}

export type MixRow = {
  key: keyof DenomCounts;
  label: string;
  standard: number;
  counted: number;
  /** counted − standard (pieces). */
  diff: number;
  /** diff × face value, cents. */
  diffMinor: number;
};

/** Every denomination, high to low, with Standard / Counted / Diff. */
export function mixRows(counted: Partial<DenomCounts>): MixRow[] {
  return DENOM_FIELDS.map((d) => {
    const standard = MASTER_TILL_STANDARD[d.key];
    const c = qty(counted[d.key]);
    const diff = c - standard;
    return { key: d.key, label: d.label, standard, counted: c, diff, diffMinor: diff * CENTS[d.key] };
  });
}

export type MixCheck = {
  onStandard: boolean;
  /** e.g. "+10 × $20, −20 × $10"; null when on standard. */
  offText: string | null;
  totalMinor: number;
  varianceMinor: number;
};

function signed(n: number): string {
  return n > 0 ? `+${n}` : `\u2212${Math.abs(n)}`;
}

/** Total variance against $1,000.00 and the mix against D11, kept apart. */
export function mixCheck(counted: Partial<DenomCounts>): MixCheck {
  const rows = mixRows(counted);
  const off = rows.filter((r) => r.diff !== 0);
  const totalMinor = denomTotalMinor(counted);
  return {
    onStandard: off.length === 0,
    offText: off.length === 0 ? null : off.map((r) => `${signed(r.diff)} \u00d7 ${r.label}`).join(", "),
    totalMinor,
    varianceMinor: totalMinor - SAFE_TARGET_MINOR,
  };
}

/** "Balanced · mix on standard" / "Short $2.00 · mix off: −8 × 25¢". */
export function countResultWords(counted: Partial<DenomCounts>): string {
  const m = mixCheck(counted);
  const total =
    m.varianceMinor === 0
      ? "Balanced"
      : m.varianceMinor > 0
        ? `Over ${formatCents(m.varianceMinor)}`
        : `Short ${formatCents(Math.abs(m.varianceMinor))}`;
  return `${total} \u00b7 ${m.onStandard ? "mix on standard" : `mix off: ${m.offText}`}`;
}

/** The banner sentence: "Mix on standard." / "Mix off standard: +10 × $20, −20 × $10." */
export function mixSentence(counted: Partial<DenomCounts>): string {
  const m = mixCheck(counted);
  return m.onStandard ? "Mix on standard." : `Mix off standard: ${m.offText}.`;
}

/**
 * F-02-5 (the selector always started on AM, even at night): start on the
 * first official count not yet done today: AM, then PM, then Extra. The
 * counter can still change it.
 */
export function defaultCountWindow(todayAmDone: boolean, todayPmDone: boolean): "am" | "pm" | "other" {
  if (!todayAmDone) return "am";
  if (!todayPmDone) return "pm";
  return "other";
}

/* ── Date range for history and export (G-09 requirement 2–3; F-02-13) ── */

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return t.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export type DayRange = { ok: true; from: string; to: string } | { ok: false; error: string };

/**
 * From / To for the history and the export. Blank To = today; blank From = 29
 * days before To (30 days). A bad date, From after To, or more than 366 days
 * is an error, never silently "fixed".
 */
export function parseDayRange(fromRaw: string | null | undefined, toRaw: string | null | undefined, today: string): DayRange {
  const to = parseBusinessDay(toRaw, today);
  if (!to.ok) return { ok: false, error: `To: ${to.error}` };
  const from = parseBusinessDay(fromRaw, addDays(to.day, -(DEFAULT_RANGE_DAYS - 1)));
  if (!from.ok) return { ok: false, error: `From: ${from.error}` };
  if (from.day > to.day) return { ok: false, error: `From (${from.day}) is after To (${to.day}). Pick From first, then a later To.` };
  if (daysBetween(from.day, to.day) + 1 > MAX_RANGE_DAYS) {
    return { ok: false, error: `Pick ${MAX_RANGE_DAYS} days or fewer (${from.day} to ${to.day} is longer).` };
  }
  return { ok: true, from: from.day, to: to.day };
}

/* ── The sheet (print and export) ── */

export type SheetCount = {
  id: string;
  businessDay: string;
  window: string;
  countedAt: string;
  countedByName: string;
  denoms: DenomCounts;
  totalMinor: number;
  expectedMinor: number;
  varianceMinor: number;
  reason: string | null;
  notes: string | null;
};

export type SheetSwap = {
  id: string;
  occurredAt: string;
  amountMinor: number;
  performedByName: string;
  approvedByName: string;
  notes: string | null;
  /** Fix Phase 2.7b (F-01-8): big bills IN from the till, or "not recorded (value only)". */
  inWords: string;
  /** Fix Phase 2.7b (F-01-8): change OUT to the till, or "not recorded (value only)". */
  outWords: string;
};

export const WINDOW_WORD: Record<string, string> = { am: "AM", pm: "PM", other: "Extra" };

/** A safe_counts row as read (structural; safe-store.ts SafeCountRow fits). */
export type SafeCountRowLike = {
  id: string;
  business_day: string;
  count_window: string;
  counted_by: string | null;
  total_minor: number;
  expected_minor: number;
  variance_minor: number;
  notes: string | null;
  variance_reason?: string | null;
  counted_at: string;
} & Partial<Record<keyof DenomCounts, unknown>>;

export type SafeSwapRowLike = {
  id: string;
  amount_minor: number;
  performed_by: string | null;
  approved_by: string | null;
  notes: string | null;
  occurred_at: string;
  /** 0317 (F-01-8); absent or null on swaps recorded before it. */
  in_denoms?: unknown;
  out_denoms?: unknown;
};

/** One mapping from database rows to sheet rows (page, print sheet and export). */
export function sheetCountFromRow(r: SafeCountRowLike, nameFor: (id: string | null) => string): SheetCount {
  return {
    id: r.id,
    businessDay: r.business_day,
    window: r.count_window,
    countedAt: r.counted_at,
    countedByName: nameFor(r.counted_by),
    denoms: denomsOf(r),
    totalMinor: r.total_minor,
    expectedMinor: r.expected_minor,
    varianceMinor: r.variance_minor,
    reason: r.variance_reason ?? null,
    notes: r.notes,
  };
}

export function sheetSwapFromRow(r: SafeSwapRowLike, nameFor: (id: string | null) => string): SheetSwap {
  return {
    id: r.id,
    occurredAt: r.occurred_at,
    amountMinor: r.amount_minor,
    performedByName: nameFor(r.performed_by),
    approvedByName: nameFor(r.approved_by),
    notes: r.notes,
    ...swapBillWords(r.in_denoms, r.out_denoms),
  };
}

/** Window order on a day's sheet: AM, PM, then extras, each oldest first. */
export function sortForSheet(counts: readonly SheetCount[]): SheetCount[] {
  const rank = (w: string) => (w === "am" ? 0 : w === "pm" ? 1 : 2);
  return [...counts].sort((a, b) => rank(a.window) - rank(b.window) || a.countedAt.localeCompare(b.countedAt));
}

export function pacificTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * CSV / Excel: one Counts row per count (every denomination, total, target,
 * variance, mix vs standard; the first row is the D11 standard), Swaps (with
 * the bills both ways, Fix Phase 2.7b F-01-8) and Exchanges (master till <->
 * little safe, Fix Phase 2.7b G-02, owner D3).
 */
export function safeSheetWorkbook(
  range: { from: string; to: string },
  counts: readonly SheetCount[],
  swaps: readonly SheetSwap[],
  exchanges: readonly SheetExchange[] = [],
): WorkbookSpec {
  const denomCols = DENOM_FIELDS.map((d) => ({ key: d.key, header: d.label, type: "integer" as const }));
  const countRows: TableRow[] = counts.map((c) => {
    const m = mixCheck(c.denoms);
    const row: TableRow = {
      day: c.businessDay,
      time: pacificTime(c.countedAt),
      window: WINDOW_WORD[c.window] ?? c.window,
      by: c.countedByName,
      total: c.totalMinor / 100,
      target: c.expectedMinor / 100,
      variance: c.varianceMinor / 100,
      mix: m.onStandard ? "on standard" : `off: ${m.offText}`,
      reason: c.reason ?? "",
      notes: c.notes ?? "",
    };
    for (const d of DENOM_FIELDS) row[d.key] = c.denoms[d.key];
    return row;
  });
  const std: TableRow = { day: "", time: "", window: "Standard (D11)", by: "" };
  for (const d of DENOM_FIELDS) std[d.key] = MASTER_TILL_STANDARD[d.key];
  std.total = denomTotalMinor(MASTER_TILL_STANDARD) / 100;

  return {
    filename: `master-till-${range.from}-to-${range.to}`,
    title: `Greenway Marijuana \u00b7 Master till sheet \u00b7 ${range.from} to ${range.to}`,
    sheets: [
      {
        name: "Counts",
        caption: `Master till counts, ${range.from} to ${range.to}. Target ${formatCents(SAFE_TARGET_MINOR)}; standard mix per owner D11.`,
        columns: [
          { key: "day", header: "Business day" },
          { key: "time", header: "Counted at (Pacific)" },
          { key: "window", header: "Window" },
          { key: "by", header: "Counted by" },
          ...denomCols,
          { key: "total", header: "Total", type: "currency" },
          { key: "target", header: "Target", type: "currency" },
          { key: "variance", header: "Over (+) / short (\u2212)", type: "currency" },
          { key: "mix", header: "Mix vs standard" },
          { key: "reason", header: "Reason" },
          { key: "notes", header: "Notes" },
        ],
        rows: [std, ...countRows],
      },
      {
        name: "Swaps",
        caption: "Register change swaps (value-neutral; the same value each way).",
        columns: [
          { key: "time", header: "When (Pacific)" },
          { key: "amount", header: "Amount (one side)", type: "currency" },
          { key: "in", header: "Big bills IN from till \u2192 master till" },
          { key: "out", header: "Change OUT master till \u2192 till" },
          { key: "by", header: "Performed by" },
          { key: "approved", header: "Approved by" },
          { key: "notes", header: "Notes" },
        ],
        rows: swaps.map((s) => ({
          time: pacificTime(s.occurredAt),
          amount: s.amountMinor / 100,
          in: s.inWords,
          out: s.outWords,
          by: s.performedByName,
          approved: s.approvedByName,
          notes: s.notes ?? "",
        })),
        totals: { time: `${swaps.length} swaps`, amount: swaps.reduce((a, s) => a + s.amountMinor, 0) / 100 },
      },
      exchangesSheet(exchanges),
    ],
  };
}

/* ── Self-tests (scripts/compliance/run-pure-selftests.ts) ── */

/**
 * Fix Phase 2.7b (G-02): the "Exchanges" sheet lives here, not in
 * little-safe-core, because little-safe-core is bundled into the iPad register
 * (till-core imports checkSwapDenoms) and the register build must never reach
 * the workbook module (pos-register-app-guard).
 */
export function exchangesSheet(exchanges: readonly SheetExchange[]): WorkbookSpec["sheets"][number] {
  const rows: TableRow[] = exchanges.map((e) => ({
    day: e.businessDay,
    time: pacificTime(e.occurredAt),
    out: e.outWords,
    in: e.inWords,
    value: e.valueMinor / 100,
    by: e.recordedByName,
    notes: e.notes ?? "",
  }));
  return {
    name: "Exchanges",
    caption: "Master till \u2194 little safe exchanges (owner D3). Both sides are the same value. The little safe has no balance or target.",
    columns: [
      { key: "day", header: "Business day" },
      { key: "time", header: "When (Pacific)" },
      { key: "out", header: "OUT of master till \u2192 little safe" },
      { key: "in", header: "IN from little safe \u2192 master till" },
      { key: "value", header: "Value (each side)", type: "currency" },
      { key: "by", header: "Recorded by" },
      { key: "notes", header: "Notes" },
    ],
    rows,
    totals: { day: `${exchanges.length} exchanges`, value: exchanges.reduce((a, e) => a + e.valueMinor, 0) / 100 },
  };
}

export function __runMasterTillTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`FAIL master-till-core: ${m}`);
    }
  };

  ok(denomTotalMinor(MASTER_TILL_STANDARD) === 100_000, "D11 standard totals exactly $1,000.00");
  ok(denomTotalMinor(MASTER_TILL_STANDARD) === SAFE_TARGET_MINOR, "the standard equals the target");
  ok(MASTER_TILL_STANDARD.twenties === 0 && MASTER_TILL_STANDARD.twos === 0 && MASTER_TILL_STANDARD.dollar_coins === 0, "no $20s, $2s or $1 coins in the standard");

  const on = mixCheck(MASTER_TILL_STANDARD);
  ok(on.onStandard && on.offText === null && on.varianceMinor === 0, "the standard is on standard and balanced");
  ok(countResultWords(MASTER_TILL_STANDARD) === "Balanced \u00b7 mix on standard", "result words on standard");

  // F-02-3: 10 × $20 + 12 × $10 + the standard rest = $1,000.00 but off the mix.
  const offMix = { ...MASTER_TILL_STANDARD, twenties: 10, tens: 12 };
  const om = mixCheck(offMix);
  ok(om.varianceMinor === 0, "F-02-3 case totals $1,000.00");
  ok(!om.onStandard, "F-02-3 case is OFF the mix (the bug was 'Balanced' only)");
  ok(om.offText === "+10 \u00d7 $20, \u221220 \u00d7 $10", `off text names both sides: ${om.offText}`);
  ok(countResultWords(offMix) === "Balanced \u00b7 mix off: +10 \u00d7 $20, \u221220 \u00d7 $10", "result words keep total and mix apart");

  const short = { ...MASTER_TILL_STANDARD, quarters: 87 };
  ok(countResultWords(short) === "Short $2.00 \u00b7 mix off: \u22128 \u00d7 25\u00a2", "short and off");
  const rows = mixRows(short);
  ok(rows.length === 13 && rows[0].key === "hundreds", "13 rows, high to low");
  const q = rows.find((r) => r.key === "quarters")!;
  ok(q.standard === 95 && q.counted === 87 && q.diff === -8 && q.diffMinor === -200, "quarter row diff and value");
  ok(rows.reduce((a, r) => a + r.diffMinor, 0) === mixCheck(short).varianceMinor, "diff values add up to the variance");

  ok(denomsOf({ tens: "3", ones: -2, fives: 1.9 } as never).tens === 3, "denomsOf reads strings");
  ok(denomsOf({ ones: -2 } as never).ones === 0, "denomsOf drops negatives");
  ok(denomsOf({ fives: 1.9 } as never).fives === 1, "denomsOf floors");

  const r0 = parseDayRange("", "", "2026-11-30");
  ok(r0.ok && r0.from === "2026-11-01" && r0.to === "2026-11-30", "blank range = last 30 days");
  const r1 = parseDayRange("2026-11-02", "2026-11-02", "2026-11-30");
  ok(r1.ok && r1.from === "2026-11-02" && r1.to === "2026-11-02", "one-day range");
  const r2 = parseDayRange("2026-11-05", "2026-11-02", "2026-11-30");
  ok(!r2.ok && r2.error.startsWith("From (2026-11-05) is after To"), "From after To refused");
  const r3 = parseDayRange("2026-02-30", "", "2026-11-30");
  ok(!r3.ok && r3.error === "From: 2026-02-30 is not a real calendar day.", "bad From refused, not replaced");
  const r4 = parseDayRange("", "11/02/2026", "2026-11-30");
  ok(!r4.ok && r4.error.startsWith("To: "), "bad To refused");
  const r5 = parseDayRange("2025-01-01", "2026-11-30", "2026-11-30");
  ok(!r5.ok && r5.error.startsWith("Pick 366 days or fewer"), "over 366 days refused");
  const r6 = parseDayRange("2025-12-01", "2026-11-30", "2026-11-30");
  ok(r6.ok, "365 days allowed");
  const r7 = parseDayRange("", "2026-03-01", "2026-11-30");
  ok(r7.ok && r7.from === "2026-01-31", "blank From counts back from To (across February)");

  const c = (id: string, w: string, at: string): SheetCount => ({
    id, businessDay: "2026-11-02", window: w, countedAt: at, countedByName: "A", denoms: MASTER_TILL_STANDARD,
    totalMinor: 100_000, expectedMinor: 100_000, varianceMinor: 0, reason: null, notes: null,
  });
  const sorted = sortForSheet([c("x", "other", "2026-11-02T20:00:00Z"), c("p", "pm", "2026-11-03T04:00:00Z"), c("a", "am", "2026-11-02T16:00:00Z"), c("y", "other", "2026-11-02T18:00:00Z")]);
  ok(sorted.map((s) => s.id).join("") === "apyx", "sheet order AM, PM, extras oldest first");

  const wb = safeSheetWorkbook({ from: "2026-11-01", to: "2026-11-02" }, [{ ...c("a", "am", "2026-11-02T16:00:00Z"), denoms: offMix, reason: "r" }], [
    { id: "s", occurredAt: "2026-11-02T19:00:00Z", amountMinor: 10_000, performedByName: "B", approvedByName: "C", notes: null, inWords: "5 \u00d7 $20", outWords: "20 \u00d7 $5" },
  ]);
  ok(wb.filename === "master-till-2026-11-01-to-2026-11-02", "export filename");
  ok(wb.sheets.map((s) => s.name).join(",") === "Counts,Swaps,Exchanges", "export sheets (Exchanges added in Phase 2.7b)");
  ok(wb.sheets[1].rows[0].in === "5 \u00d7 $20" && wb.sheets[1].rows[0].out === "20 \u00d7 $5", "swaps sheet carries the bills both ways");
  ok(wb.sheets[0].rows[0].window === "Standard (D11)" && wb.sheets[0].rows[0].tens === 32, "first row is the D11 standard");
  ok(wb.sheets[0].rows[1].mix === "off: +10 \u00d7 $20, \u221220 \u00d7 $10" && wb.sheets[0].rows[1].twenties === 10, "count row has the mix and the denominations");
  ok(wb.sheets[0].rows[1].window === "AM" && wb.sheets[0].rows[1].reason === "r", "count row window and reason");
  ok(wb.sheets[1].totals?.amount === 100 && wb.sheets[1].rows[0].approved === "C", "swaps sheet and total");
  ok(SAFE_COUNT_PIN_SCOPE === "backoffice-safe-count", "PIN scope key");
  ok(mixSentence(MASTER_TILL_STANDARD) === "Mix on standard.", "banner: mix on standard");
  ok(defaultCountWindow(false, false) === "am" && defaultCountWindow(true, false) === "pm" && defaultCountWindow(true, true) === "other", "default window: AM, then PM, then Extra");
  ok(defaultCountWindow(false, true) === "am", "default window: AM still missing comes first");
  {
    const names = (id: string | null) => (id === "e1" ? "Ann" : "\u2014");
    const sc = sheetCountFromRow(
      { id: "c9", business_day: "2026-11-02", count_window: "pm", counted_by: "e1", total_minor: 100000, expected_minor: 100000, variance_minor: 0, notes: null, counted_at: "2026-11-03T05:00:00Z", ...MASTER_TILL_STANDARD, twenties: "2" as unknown as number },
      names,
    );
    ok(sc.countedByName === "Ann" && sc.denoms.tens === 32 && sc.denoms.twenties === 2 && sc.reason === null, "row mapping: name, denominations, missing reason \u2192 null");
    const sw = sheetSwapFromRow({ id: "s9", amount_minor: 2000, performed_by: "e1", approved_by: null, notes: null, occurred_at: "2026-11-02T20:00:00Z" }, names);
    ok(sw.performedByName === "Ann" && sw.approvedByName === "\u2014" && sw.amountMinor === 2000, "swap row mapping");
    ok(sw.inWords === "not recorded (value only)", "a swap before 0317 says value only");
    const ex = { id: "x1", businessDay: "2026-11-02", occurredAt: "2026-11-02T20:00:00Z", outWords: "5 \u00d7 $20", inWords: "20 \u00d7 $5", valueMinor: 10_000, recordedByName: "Ann", notes: null } as SheetExchange;
    const sh = exchangesSheet([ex, { ...ex, id: "x2", valueMinor: 2_000 }]);
    ok(sh.name === "Exchanges" && sh.rows.length === 2 && sh.rows[0].out === "5 \u00d7 $20", "exchanges sheet rows");
    ok(sh.totals?.value === 120 && sh.totals?.day === "2 exchanges", "exchanges sheet total");
  }
  ok(mixSentence({ ...MASTER_TILL_STANDARD, twenties: 10, tens: 12 }) === "Mix off standard: +10 \u00d7 $20, \u221220 \u00d7 $10.", "banner: mix off standard lists the differences");

  return { passed, failed };
}
