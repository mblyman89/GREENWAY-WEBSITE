/**
 * src/lib/registers/close-count-check-core.ts  (D204a)
 *
 * Owner (verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, D204):
 *   "They are certain they are counting and entering in the correct amounts.
 *    But the tills still aren't lining up."
 *
 * What production showed (D204 findings): a closer left out 55 $1 bills, two
 * closers entered no coins at all, a $50 and a $100 were swapped, and a $0.00
 * close was followed by a $2,678.10 second count. So the iPad close now asks
 * the closer to LOOK AGAIN before saving when:
 *
 *   1. a whole denomination group is empty (no coins at all, or no $1s), or
 *   2. the total is far BELOW what the register expects.
 *
 * The count stays BLIND: the expected figure and the size of the gap are never
 * shown. Check 2 runs on the server, which alone knows the expected figure.
 * Both are "look again, then confirm" — never a hard block, because a drawer
 * really can be short or hold no coins.
 *
 * PURE: no I/O.
 */
import { denomTotalMinor, type DenomCounts } from "./cash";

/** A count this far (or more) below expected asks for a recount. */
export const RECHECK_SHORT_MINOR = 4000; // $40.00

export const RECHECK_COUNT_CODE = "recheck_count";

export const RECHECK_COUNT_MESSAGE =
  "This count is much lower than the register expects. Please count the drawer again: " +
  "check every coin roll, the $1 stack, and that $50s and $100s are in the right boxes. " +
  "If you counted again and the count is right, tick \u201cI counted again\u201d and save.";

export type CountGroupWarning = { key: "coins" | "ones"; text: string };

/** Denomination groups left empty on a non-zero close count. */
export function emptyGroupWarnings(d: DenomCounts): CountGroupWarning[] {
  if (denomTotalMinor(d) <= 0) return []; // the $0.00 close has its own confirm (D125)
  const out: CountGroupWarning[] = [];
  const coins = d.pennies + d.nickels + d.dimes + d.quarters + d.half_dollars + d.dollar_coins;
  if (coins === 0) out.push({ key: "coins", text: "No coins entered. Count the coins (pennies to $1 coins) too." });
  if (d.ones === 0) out.push({ key: "ones", text: "No $1 bills entered. Count the $1 stack too." });
  return out;
}

export type ShortCheck = { ok: true; flagged: boolean } | { ok: false; code: typeof RECHECK_COUNT_CODE; error: string };

/**
 * Server-side: is this blind count far below expected? `expectedMinor` null
 * (the figure could not be worked out) never blocks a close.
 */
export function closeShortCheck(input: {
  countedMinor: number;
  expectedMinor: number | null;
  recountConfirmed: boolean;
}): ShortCheck {
  if (input.expectedMinor === null || !Number.isFinite(input.expectedMinor)) return { ok: true, flagged: false };
  const shortBy = input.expectedMinor - input.countedMinor;
  if (shortBy < RECHECK_SHORT_MINOR) return { ok: true, flagged: false };
  if (input.recountConfirmed) return { ok: true, flagged: true };
  return { ok: false, code: RECHECK_COUNT_CODE, error: RECHECK_COUNT_MESSAGE };
}

// ---------------------------------------------------------------------------
// D204b: the two counts, row by row
// ---------------------------------------------------------------------------

export const DENOM_ROW_ORDER: { key: keyof DenomCounts; label: string; cents: number }[] = [
  { key: "hundreds", label: "$100", cents: 10000 },
  { key: "fifties", label: "$50", cents: 5000 },
  { key: "twenties", label: "$20", cents: 2000 },
  { key: "tens", label: "$10", cents: 1000 },
  { key: "fives", label: "$5", cents: 500 },
  { key: "twos", label: "$2", cents: 200 },
  { key: "ones", label: "$1", cents: 100 },
  { key: "dollar_coins", label: "$1 coin", cents: 100 },
  { key: "half_dollars", label: "50\u00a2", cents: 50 },
  { key: "quarters", label: "25\u00a2", cents: 25 },
  { key: "dimes", label: "10\u00a2", cents: 10 },
  { key: "nickels", label: "5\u00a2", cents: 5 },
  { key: "pennies", label: "1\u00a2", cents: 1 },
];

export type CountDiffRow = {
  key: keyof DenomCounts;
  label: string;
  closer: number;
  second: number;
  /** (second - closer) * value, cents. */
  diffMinor: number;
};

/** Rows where the closer's and the second counter's tables differ. */
export function countDiffRows(closer: DenomCounts, second: DenomCounts): CountDiffRow[] {
  const out: CountDiffRow[] = [];
  for (const r of DENOM_ROW_ORDER) {
    const a = closer[r.key] ?? 0;
    const b = second[r.key] ?? 0;
    if (a === b) continue;
    out.push({ key: r.key, label: r.label, closer: a, second: b, diffMinor: (b - a) * r.cents });
  }
  return out;
}

/** D204b: which count to suggest when the two disagree by more than the hold line. */
export function suggestedBasis(closingMinor: number | null, secondMinor: number | null, holdMinor: number): "second" | null {
  if (closingMinor == null || secondMinor == null) return null;
  return Math.abs(secondMinor - closingMinor) > holdMinor ? "second" : null;
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runCloseCountCheckTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  FAIL - ${name}`);
    }
  };
  const zero: DenomCounts = {
    pennies: 0, nickels: 0, dimes: 0, quarters: 0, half_dollars: 0, dollar_coins: 0,
    ones: 0, twos: 0, fives: 0, tens: 0, twenties: 0, fifties: 0, hundreds: 0,
  };

  ok("$0 close: no group warnings (D125 handles it)", emptyGroupWarnings(zero).length === 0);
  const billsOnly = { ...zero, twenties: 10, ones: 5 };
  const w1 = emptyGroupWarnings(billsOnly);
  ok("no coins flagged", w1.length === 1 && w1[0].key === "coins");
  const noOnes = { ...zero, twenties: 10, quarters: 8 };
  const w2 = emptyGroupWarnings(noOnes);
  ok("no ones flagged", w2.length === 1 && w2[0].key === "ones");
  ok("both flagged", emptyGroupWarnings({ ...zero, hundreds: 2 }).length === 2);
  ok("full count: none", emptyGroupWarnings({ ...zero, pennies: 3, ones: 12, twenties: 4 }).length === 0);
  ok("$1 coin counts as a coin", emptyGroupWarnings({ ...zero, dollar_coins: 1, ones: 1 }).length === 0);

  ok("no expected: never blocks", closeShortCheck({ countedMinor: 0, expectedMinor: null, recountConfirmed: false }).ok);
  ok("exact: fine", (() => { const r = closeShortCheck({ countedMinor: 50000, expectedMinor: 50000, recountConfirmed: false }); return r.ok && !r.flagged; })());
  ok("over: fine", closeShortCheck({ countedMinor: 60000, expectedMinor: 50000, recountConfirmed: false }).ok);
  ok("short $39.99: fine", closeShortCheck({ countedMinor: 46001, expectedMinor: 50000, recountConfirmed: false }).ok);
  const short = closeShortCheck({ countedMinor: 46000, expectedMinor: 50000, recountConfirmed: false });
  ok("short $40: recheck", !short.ok && short.code === RECHECK_COUNT_CODE);
  const conf = closeShortCheck({ countedMinor: 0, expectedMinor: 267810, recountConfirmed: true });
  ok("confirmed: saved, flagged", conf.ok && conf.flagged);
  const diffs = countDiffRows({ ...zero, ones: 55, fifties: 1 }, { ...zero, ones: 0, hundreds: 1 });
  ok("diff rows: three rows", diffs.length === 3);
  ok("diff rows: big bills first", diffs[0].key === "hundreds" && diffs[0].diffMinor === 10000);
  ok("diff rows: $1s missing", diffs.some((d) => d.key === "ones" && d.diffMinor === -5500));
  ok("diff rows: identical -> none", countDiffRows(billsOnly, billsOnly).length === 0);
  ok("suggest second when > hold", suggestedBasis(0, 267810, 500) === "second");
  ok("no suggestion within hold", suggestedBasis(1000, 1400, 500) === null);
  ok("no suggestion without second", suggestedBasis(1000, null, 500) === null);
  ok("message never shows a figure", !/\$[\d,]+\.\d\d/.test(RECHECK_COUNT_MESSAGE));

  return { passed, failed };
}
