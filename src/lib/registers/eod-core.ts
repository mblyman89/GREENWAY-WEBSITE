/**
 * src/lib/registers/eod-core.ts  (Feature slice 32 — printable EOD report)
 *
 * PURE model builder for the back-office END-OF-DAY summary report — the
 * store-wide physical record the owner prints and files each night. Zero
 * I/O — unit-testable with tsx.
 *
 * The store-wide sales figures reuse DaySummary from day-report-core (the
 * same verified-facts aggregation the register X/Z slips use). This module
 * adds what the register slip can't see: EVERY register's till on one
 * page, plus the safe.
 *
 * BLIND-COUNT DISCIPLINE: over/short appears ONLY from sessions a manager
 * has already reconciled (the value is stored on the session by then);
 * nothing here computes it early. This page is manager-territory
 * (inventory.manage) precisely because it reveals expected cash.
 *
 * Money is MINOR UNITS (cents) throughout.
 */

import { type DaySummary } from "@/lib/pos/day-report-core";

// ---------------------------------------------------------------------------
// Inputs (minimal typed shapes the server store maps rows into)
// ---------------------------------------------------------------------------

export type EodRegisterInput = { id: string; name: string };

export type EodSessionInput = {
  registerId: string;
  status: string; // open | closed | reconciled | verified
  openingCountMinor: number | null;
  closingCountMinor: number | null;
  overShortMinor: number | null;
  /** Tips at close (0134). null = not recorded. Employee money. */
  tipsMinor: number | null;
};

export type EodDropInput = { registerId: string; amountMinor: number };

export type EodSafeCountInput = {
  window: string; // am | pm | other
  totalMinor: number;
  varianceMinor: number;
};

export type EodSwapInput = { amountMinor: number };

// ---------------------------------------------------------------------------
// Output model
// ---------------------------------------------------------------------------

export type EodRegisterRow = {
  registerId: string;
  registerName: string;
  sessionCount: number;
  anyOpen: boolean;
  openingMinor: number;
  dropCount: number;
  dropsMinor: number;
  /** Sum of blind close counts across closed+ sessions; null if none closed. */
  closedMinor: number | null;
  /** Sum of manager-revealed over/short; null until at least one reveal. */
  overShortMinor: number | null;
  /** Sum of recorded tips; null if no session recorded tips. */
  tipsMinor: number | null;
};

export type EodTotals = {
  sessionCount: number;
  openRegisterCount: number;
  openingMinor: number;
  dropCount: number;
  dropsMinor: number;
  closedMinor: number | null;
  overShortMinor: number | null;
  tipsMinor: number | null;
};

export type EodSafeSection = {
  /** false = migration 0135 not applied — the page shows a note instead. */
  ready: boolean;
  amCount: EodSafeCountInput | null;
  pmCount: EodSafeCountInput | null;
  otherCount: number;
  swapCount: number;
  swapsMinor: number;
};

export type EodModel = {
  /** FINAL once every session is closed (and at least one exists). */
  final: boolean;
  registers: EodRegisterRow[];
  totals: EodTotals;
  sales: DaySummary;
  safe: EodSafeSection;
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function addNullable(acc: number | null, v: number | null): number | null {
  if (v == null) return acc;
  return (acc ?? 0) + v;
}

/**
 * Assemble the printable EOD model from typed inputs. Registers with no
 * sessions today are OMITTED (an idle register adds nothing to a physical
 * record); rows keep the input register order.
 */
export function buildEodModel(input: {
  registers: EodRegisterInput[];
  sessions: EodSessionInput[];
  drops: EodDropInput[];
  sales: DaySummary;
  safeReady: boolean;
  safeCounts: EodSafeCountInput[];
  swaps: EodSwapInput[];
}): EodModel {
  const rows: EodRegisterRow[] = [];
  for (const reg of input.registers) {
    const sessions = input.sessions.filter((s) => s.registerId === reg.id);
    if (sessions.length === 0) continue;
    const drops = input.drops.filter((d) => d.registerId === reg.id);
    let anyOpen = false;
    let openingMinor = 0;
    let closedMinor: number | null = null;
    let overShortMinor: number | null = null;
    let tipsMinor: number | null = null;
    for (const s of sessions) {
      if (s.status === "open") anyOpen = true;
      openingMinor += Number.isInteger(s.openingCountMinor) ? (s.openingCountMinor as number) : 0;
      if (s.status !== "open" && Number.isInteger(s.closingCountMinor)) {
        closedMinor = (closedMinor ?? 0) + (s.closingCountMinor as number);
      }
      // Over/short ONLY from manager-revealed sessions — blind stays blind.
      if ((s.status === "reconciled" || s.status === "verified") && Number.isInteger(s.overShortMinor)) {
        overShortMinor = (overShortMinor ?? 0) + (s.overShortMinor as number);
      }
      tipsMinor = addNullable(tipsMinor, Number.isInteger(s.tipsMinor) ? (s.tipsMinor as number) : null);
    }
    rows.push({
      registerId: reg.id,
      registerName: reg.name,
      sessionCount: sessions.length,
      anyOpen,
      openingMinor,
      dropCount: drops.length,
      dropsMinor: drops.reduce((sum, d) => sum + (Number.isInteger(d.amountMinor) ? d.amountMinor : 0), 0),
      closedMinor,
      overShortMinor,
      tipsMinor,
    });
  }

  const totals: EodTotals = rows.reduce<EodTotals>(
    (t, r) => ({
      sessionCount: t.sessionCount + r.sessionCount,
      openRegisterCount: t.openRegisterCount + (r.anyOpen ? 1 : 0),
      openingMinor: t.openingMinor + r.openingMinor,
      dropCount: t.dropCount + r.dropCount,
      dropsMinor: t.dropsMinor + r.dropsMinor,
      closedMinor: addNullable(t.closedMinor, r.closedMinor),
      overShortMinor: addNullable(t.overShortMinor, r.overShortMinor),
      tipsMinor: addNullable(t.tipsMinor, r.tipsMinor),
    }),
    {
      sessionCount: 0,
      openRegisterCount: 0,
      openingMinor: 0,
      dropCount: 0,
      dropsMinor: 0,
      closedMinor: null,
      overShortMinor: null,
      tipsMinor: null,
    },
  );

  // Safe rollup: the LATEST am and pm counts (inputs arrive newest-first).
  const amCount = input.safeCounts.find((c) => c.window === "am") ?? null;
  const pmCount = input.safeCounts.find((c) => c.window === "pm") ?? null;
  const otherCount = input.safeCounts.filter((c) => c.window === "other").length;
  const safe: EodSafeSection = {
    ready: input.safeReady,
    amCount,
    pmCount,
    otherCount,
    swapCount: input.swaps.length,
    swapsMinor: input.swaps.reduce((sum, s) => sum + (Number.isInteger(s.amountMinor) ? s.amountMinor : 0), 0),
  };

  return {
    final: totals.sessionCount > 0 && totals.openRegisterCount === 0,
    registers: rows,
    totals,
    sales: input.sales,
    safe,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runEodCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    console.log(`PASS: ${msg}`);
  };

  const sales: DaySummary = {
    saleCount: 12,
    grossMinor: 123_456,
    subtotalMinor: 100_000,
    taxMinor: 23_456,
    medicalSaleCount: 1,
    medicalSavingsMinor: 900,
    roundedSaleCount: 2,
    roundingMinor: -3,
    noSaleCount: 1,
    exceptionCount: 0,
    pendingCount: 0,
  };

  const base = {
    registers: [
      { id: "r1", name: "Register 1" },
      { id: "r2", name: "Register 2" },
      { id: "r3", name: "Register 3 (idle)" },
    ],
    drops: [
      { registerId: "r1", amountMinor: 20_000 },
      { registerId: "r1", amountMinor: 10_000 },
      { registerId: "r2", amountMinor: 5_000 },
    ],
    sales,
    safeReady: true,
    safeCounts: [
      { window: "pm", totalMinor: 100_300, varianceMinor: 300 },
      { window: "am", totalMinor: 100_000, varianceMinor: 0 },
      { window: "other", totalMinor: 99_000, varianceMinor: -1_000 },
    ],
    swaps: [{ amountMinor: 10_000 }, { amountMinor: 2_500 }],
  };

  // FINAL day: everything closed, one reconciled with over/short + tips.
  const finalDay = buildEodModel({
    ...base,
    sessions: [
      { registerId: "r1", status: "reconciled", openingCountMinor: 16_750, closingCountMinor: 52_000, overShortMinor: -150, tipsMinor: 4_250 },
      { registerId: "r2", status: "closed", openingCountMinor: 16_750, closingCountMinor: 40_000, overShortMinor: null, tipsMinor: null },
    ],
  });
  ok(finalDay.final, "eod: all sessions closed = FINAL report");
  ok(finalDay.registers.length === 2, "eod: idle register omitted from the physical record");
  const r1 = finalDay.registers[0];
  ok(r1.registerName === "Register 1" && r1.openingMinor === 16_750, "eod: register row carries name + opening float");
  ok(r1.dropCount === 2 && r1.dropsMinor === 30_000, "eod: drops summed per register");
  ok(r1.closedMinor === 52_000 && r1.overShortMinor === -150, "eod: revealed over/short shows on reconciled row");
  ok(r1.tipsMinor === 4_250, "eod: recorded tips carried on the row");
  const r2 = finalDay.registers[1];
  ok(r2.overShortMinor === null, "eod: closed-but-not-reconciled row hides over/short (blind stays blind)");
  ok(r2.tipsMinor === null, "eod: unrecorded tips stay null (not zero)");
  ok(finalDay.totals.openingMinor === 33_500 && finalDay.totals.dropsMinor === 35_000, "eod: totals sum opening + drops");
  ok(finalDay.totals.closedMinor === 92_000, "eod: totals sum blind close counts");
  ok(finalDay.totals.overShortMinor === -150, "eod: totals include only revealed over/short");
  ok(finalDay.totals.tipsMinor === 4_250, "eod: totals include only recorded tips");
  ok(finalDay.sales.grossMinor === 123_456, "eod: store-wide sales summary rides along unchanged");

  // Safe rollup
  ok(finalDay.safe.ready && finalDay.safe.amCount?.varianceMinor === 0, "eod: AM safe count balanced");
  ok(finalDay.safe.pmCount?.varianceMinor === 300, "eod: PM safe count variance carried");
  ok(finalDay.safe.otherCount === 1, "eod: ad-hoc recounts counted");
  ok(finalDay.safe.swapCount === 2 && finalDay.safe.swapsMinor === 12_500, "eod: change swaps counted and summed");

  // PRELIMINARY day: a drawer still open.
  const midDay = buildEodModel({
    ...base,
    sessions: [
      { registerId: "r1", status: "open", openingCountMinor: 16_750, closingCountMinor: null, overShortMinor: null, tipsMinor: null },
    ],
  });
  ok(!midDay.final, "eod: any open drawer = PRELIMINARY report");
  ok(midDay.totals.openRegisterCount === 1, "eod: open register counted in totals");
  ok(midDay.totals.closedMinor === null, "eod: no closes yet = null, not zero");

  // Empty day: nothing to report, never FINAL.
  const emptyDay = buildEodModel({ ...base, sessions: [], safeReady: false, safeCounts: [], swaps: [] });
  ok(!emptyDay.final && emptyDay.registers.length === 0, "eod: empty day is PRELIMINARY with no rows");
  ok(!emptyDay.safe.ready && emptyDay.safe.amCount === null, "eod: safe section degrades gracefully before 0135");

  console.log("eod-core: 22 self-tests passed");
}
